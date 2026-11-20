//! First-use recovery for already-bound Startup shortcuts.
//!
//! The backend queues only a binding ID, never an arbitrary executable path.
//! The sole frontend instance validates that ID against persisted bindings and
//! the installed source record before using the ordinary input transaction.
use crate::*;
use std::collections::HashSet;
use std::fs::OpenOptions;
use std::time::SystemTime;

const ARG: &str = "--flowcell-hotkey-input=";

pub(crate) fn requested_binding_id() -> Result<Option<u64>, String> {
    for arg in env::args() {
        if let Some(value) = arg.strip_prefix(ARG) {
            return value.parse::<u64>().ok().filter(|id| *id > 0).map(Some)
                .ok_or_else(|| "Invalid Startup shortcut request.".into());
        }
    }
    Ok(None)
}

fn request_directory() -> Result<PathBuf, String> {
    Ok(resolve_flowcell_local_root()?.join("hotkey-input-requests"))
}

pub(crate) fn enqueue(id: u64) -> Result<PathBuf, String> {
    let root = request_directory()?;
    fs::create_dir_all(&root).map_err(|e| format!("Cannot create shortcut setup queue: {e}"))?;
    enqueue_in(&root, id)
}

fn enqueue_in(root: &Path, id: u64) -> Result<PathBuf, String> {
    if id == 0 { return Err("Invalid shortcut binding ID.".into()); }
    let stamp = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|e| format!("Cannot timestamp shortcut request: {e}"))?.as_nanos();
    for sequence in 0..1000 {
        let path = root.join(format!("binding-{id}-{}-{stamp}-{sequence}.request", std::process::id()));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(_) => return Ok(path),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Cannot queue shortcut setup: {e}")),
        }
    }
    Err("Cannot allocate shortcut setup request.".into())
}

fn binding_id_from_name(name: &str) -> Option<u64> {
    let mut parts = name.strip_prefix("binding-")?.strip_suffix(".request")?.split('-');
    let id = parts.next()?.parse::<u64>().ok().filter(|id| *id > 0)?;
    for _ in 0..3 { parts.next()?.parse::<u128>().ok()?; }
    if parts.next().is_some() { return None; }
    Some(id)
}

fn request_invoker_alive(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("binding-") else { return false; };
    let mut parts = rest.split('-');
    let _id = parts.next();
    let Some(pid) = parts.next().and_then(|v| v.parse::<u32>().ok()) else { return false; };
    let Some(request_nanos) = parts.next().and_then(|v| v.parse::<u128>().ok()) else { return false; };
    // SYNCHRONIZE permits checking whether our same-user invoking process has
    // exited. A live request can wait for a dialog for any length of time.
    let process = unsafe { OpenProcess(0x0010_0000 | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() { return false; }
    let zero = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let (mut created, mut exited, mut kernel, mut user) = (zero, zero, zero, zero);
    let time_ok = unsafe { GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user) } != 0;
    let created_ticks = (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime);
    let request_ticks = request_nanos / 100 + 116_444_736_000_000_000;
    let alive = time_ok && u128::from(created_ticks) <= request_ticks
        && unsafe { WaitForSingleObject(process, 0) } == 258;
    unsafe { let _ = CloseHandle(process); }
    alive
}

/// Only show failures; cancellation is handled by the normal input transaction.
pub(crate) fn report_error(message: &str) {
    append_flowcell_local_log("hotkey-input-setup.log", message);
    let _ = rfd::MessageDialog::new().set_title("FlowCell Startup shortcut")
        .set_description(message).set_level(rfd::MessageLevel::Error).show();
}

fn read_binding(id: u64) -> Result<commands::bindings::FrontendScriptBindingRecord, String> {
    let (state, _, _) = commands::bindings::read_bindings_file_state()?;
    state.script_bindings.into_iter()
        .find(|binding| binding.id.or(binding.binding_id) == Some(id) && !binding.shortcut.trim().is_empty())
        .ok_or_else(|| "This Startup shortcut no longer exists.".into())
}

fn text_field<'a>(value: &'a Value, name: &str) -> Result<&'a str, String> {
    value.get(name).and_then(Value::as_str).filter(|s| !s.trim().is_empty())
        .ok_or_else(|| format!("Startup shortcut package is missing {name}."))
}

fn run_request(app: &AppHandle, id: u64) -> Result<(), String> {
    let binding = read_binding(id)?;
    let target = PathBuf::from(&binding.target);
    let canonical_target = fs::canonicalize(&target)
        .map_err(|e| format!("Cannot find the Startup shortcut's script: {e}"))?;
    let source_dir = target.ancestors().skip(1).find(|path|
        path.file_name().and_then(|s| s.to_str()).is_some_and(|s| s.eq_ignore_ascii_case("source"))
            && path.parent().is_some_and(|parent| parent.join("flowcell.install.json").is_file()))
        .ok_or("Startup shortcut is not in an owned source package.")?;
    let package = source_dir.parent().ok_or("Shortcut package is missing.")?;
    let install: Value = serde_json::from_slice(&fs::read(package.join("flowcell.install.json"))
        .map_err(|e| format!("Cannot read the Startup package: {e}"))?)
        .map_err(|e| format!("Invalid Startup package: {e}"))?;
    let owner = program_sources::validate_owner_button_id(text_field(&install, "ownerButtonId")?)?;
    let program = text_field(&install, "programName")?;
    let panel = text_field(&install, "panelName")?;
    if !is_windows_startup(program, panel) {
        return Err("This shortcut is not owned by the Windows Startup panel.".into());
    }
    let file_name = format!("{owner}.flowcell-source.json");
    let resolution = program_sources::execute::resolve_active_source_record(program, panel, &file_name)?
        .ok_or("Startup shortcut source is no longer installed.")?;
    let record_target = fs::canonicalize(&resolution.record.source_path)
        .map_err(|e| format!("Cannot verify Startup shortcut source: {e}"))?;
    if !record_target.eq(&canonical_target)
        || !resolution.record.owner_button_id.eq_ignore_ascii_case(&owner)
        || !resolution.record.input_setup.as_ref().and_then(|v| v.get("firstRun")).and_then(Value::as_bool).unwrap_or(false) {
        return Err("Startup shortcut source no longer matches its installed Button.".into());
    }
    // Prepare through the ordinary transaction, then revalidate after the
    // potentially long-lived native dialogs. A removed/reassigned binding must
    // never run merely because it existed when setup began.
    let is_screenshot = target.file_name().and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("screenshots.vbs") || s.eq_ignore_ascii_case("temp_shots.vbs"));
    let state = crate::button_state::load_button_state_sync()?.ok_or("Button state is unavailable.")?;
    let values = state.get("buttons").and_then(|v| v.get(&owner))
        .and_then(|v| v.pointer("/metadata/buttonInputs"));
    let invalid_folder = is_screenshot && values.is_some_and(|v|
        v.get("folder").and_then(Value::as_str)
            .map_or(true, |folder| folder.trim().is_empty() || !Path::new(folder).is_dir()));
    if !commands::execution::prepare_button_inputs(app, &resolution, invalid_folder)? {
        return Ok(());
    }
    let latest_binding = read_binding(id)?;
    if latest_binding.shortcut != binding.shortcut
        || fs::canonicalize(&latest_binding.target).ok().as_ref() != Some(&canonical_target) {
        return Err("This Startup shortcut changed while its setup was open. Run it again.".into());
    }
    let current = program_sources::execute::resolve_active_source_record(program, panel, &file_name)?
        .ok_or("The Startup Button was removed while setup was open.")?;
    if fs::canonicalize(&current.record.source_path).ok().as_ref() != Some(&canonical_target)
        || !current.record.owner_button_id.eq_ignore_ascii_case(&owner)
        || current.record.input_setup != resolution.record.input_setup {
        return Err("The Startup Button changed while setup was open. Run it again.".into());
    }
    program_sources::execute::run_active_source(&current, None, None)?;
    Ok(())
}

pub(crate) fn start_worker(app: AppHandle, exit_when_done: bool) {
    let foregrounded = Arc::new(AtomicBool::new(false));
    if exit_when_done {
        let app = app.clone();
        let foregrounded = foregrounded.clone();
        thread::spawn(move || loop {
            // Do not wait for a setup dialog to finish before restoring
            // normal frontend-owned shortcuts.
            let shown = app.get_webview_window("main")
                .and_then(|window| window.is_visible().ok()).unwrap_or(false);
            if shown {
                let Ok(_handover) = acquire_frontend_handover_guard() else { return; };
                transition_to_foreground(&app, &foregrounded);
                return;
            }
            thread::sleep(Duration::from_millis(100));
        });
    }
    thread::spawn(move || {
        let mut exit_when_done = exit_when_done;
        let mut seen = HashSet::new();
        loop {
            let root = match request_directory() {
                Ok(root) => root,
                Err(error) => { report_error(&error); if exit_when_done { app.exit(1); } return; }
            };
            let paths = fs::read_dir(&root).ok().into_iter().flatten().flatten().map(|e| e.path()).collect::<Vec<_>>();
            for path in paths {
                let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue; };
                let Some(id) = binding_id_from_name(name) else { continue; };
                if !seen.insert(id) { continue; }
                let live = path.file_name().and_then(|n| n.to_str()).is_some_and(request_invoker_alive);
                if live {
                    if let Err(error) = run_request(&app, id) { report_error(&error); }
                }
                let _ = fs::remove_file(&path);
                seen.remove(&id);
            }
            if exit_when_done {
                let handover = match acquire_frontend_handover_guard() {
                    Ok(guard) => guard,
                    Err(error) => { report_error(&error); app.exit(1); return; }
                };
                // A normal user launch may have shown our singleton main
                // window while setup was open. Do not close their app.
                let shown = app.get_webview_window("main")
                    .and_then(|window| window.is_visible().ok()).unwrap_or(false);
                if shown {
                    transition_to_foreground(&app, &foregrounded);
                    exit_when_done = false;
                    drop(handover);
                }
                else {
                    // Keep the handover mutex until process exit, so a normal
                    // launcher cannot restore a window already being closed.
                    std::mem::forget(handover);
                    app.exit(0);
                    loop { thread::park(); }
                }
            }
            thread::sleep(Duration::from_millis(350));
        }
    });
}

fn transition_to_foreground(app: &AppHandle, foregrounded: &AtomicBool) {
    if foregrounded.swap(true, Ordering::SeqCst) { return; }
    env::remove_var("FLOWCELL_HOTKEY_RECOVERY");
    if let Err(error) = synchronize_tool_set_hotkeys(app) { report_error(&error); }
}

fn is_windows_startup(program: &str, panel: &str) -> bool {
    program.trim().eq_ignore_ascii_case("Windows") && panel.trim().eq_ignore_ascii_case("Startup")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_is_only_for_windows_startup() {
        assert!(is_windows_startup("Windows", "Startup"));
        assert!(is_windows_startup("windows", "startup"));
        assert!(!is_windows_startup("Blender", "Startup"));
        assert!(!is_windows_startup("Windows", "Utility"));
        assert!(!is_windows_startup("Other Windows", "Startup"));
    }

    #[test]
    fn request_names_require_positive_binding_ids() {
        assert_eq!(binding_id_from_name("binding-42-123-456-0.request"), Some(42));
        for name in ["binding-0.request", "binding-../1.request", "binding-2.txt", "other-2.request"] {
            assert_eq!(binding_id_from_name(name), None);
        }
    }

    #[test]
    fn repeated_presses_queue_independently() {
        let dir = env::temp_dir().join(format!("flowcell-hotkey-input-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let first = enqueue_in(&dir, 24).unwrap();
        let second = enqueue_in(&dir, 24).unwrap();
        assert_ne!(first, second);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
        assert!(enqueue_in(&dir, 0).is_err());
        fs::remove_file(first).unwrap();
        fs::remove_file(second).unwrap();
        fs::remove_dir(&dir).unwrap();
    }

    #[test]
    fn queue_recognizes_a_live_invoker() {
        let now = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos();
        let name = format!("binding-24-{}-{now}-0.request", std::process::id());
        assert!(request_invoker_alive(&name));
        let stale = format!("binding-24-{}-456-0.request", std::process::id());
        assert!(!request_invoker_alive(&stale));
        assert!(!request_invoker_alive("binding-24-invalid-456-0.request"));
    }
}
