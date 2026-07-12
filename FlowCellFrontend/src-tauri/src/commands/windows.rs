use crate::*;

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ForegroundProcessInfo {
    pub(crate) process_name: String,
    pub(crate) process_path: String,
}

#[derive(Clone, Default)]
pub(crate) struct ScopedTopmostRegistry {
    entries: Arc<Mutex<HashMap<String, ScopedTopmostEntry>>>,
}

#[derive(Clone)]
struct ScopedTopmostEntry {
    process_names: Vec<String>,
    bind_owner: bool,
    last_applied: Option<bool>,
    last_target_match: Option<bool>,
    last_owner_hwnd: Option<isize>,
}

#[cfg(windows)]
#[derive(Clone, Default)]
struct ForegroundWindowState {
    hwnd: isize,
    process_info: ForegroundProcessInfo,
}

fn normalize_process_token(value: &str) -> String {
    let trimmed = value.trim().trim_matches('"');
    if trimmed.is_empty() {
        return String::new();
    }

    let file_name = trimmed.rsplit(['\\', '/']).next().unwrap_or(trimmed);
    let lower = file_name.to_ascii_lowercase();
    lower
        .strip_suffix(".exe")
        .unwrap_or(lower.as_str())
        .to_string()
}

pub(crate) fn normalize_configured_process_names(process_names: &[String]) -> Vec<String> {
    let mut resolved = process_names
        .iter()
        .map(|process_name| normalize_process_token(process_name))
        .filter(|process_name| !process_name.is_empty())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    resolved.sort();
    resolved
}

fn resolve_program_process_names(program_name: &str) -> Result<Vec<String>, String> {
    let manifest = program_sources::manifest::load_program_manifest(program_name)?;
    let process_names = normalize_configured_process_names(&manifest.process_names);
    if process_names.is_empty() {
        return Err(format!(
            "Program manifest for '{}' has no usable processNames.",
            manifest.label
        ));
    }
    Ok(process_names)
}

fn matches_process_token(process_names: &[String], candidate: &str) -> bool {
    let normalized_candidate = normalize_process_token(candidate);
    if normalized_candidate.is_empty() {
        return false;
    }

    process_names.iter().any(|process_name| {
        process_name == &normalized_candidate
            || process_name.contains(&normalized_candidate)
            || normalized_candidate.contains(process_name)
    })
}

#[cfg(windows)]
fn process_groups_overlap(left: &[String], right: &[String]) -> bool {
    left.iter().any(|left_name| {
        right.iter().any(|right_name| {
            normalize_process_token(left_name) == normalize_process_token(right_name)
        })
    })
}

#[cfg(windows)]
fn resolve_foreground_scoped_process_names(
    app: &AppHandle,
    entries: &HashMap<String, ScopedTopmostEntry>,
    foreground: &ForegroundWindowState,
) -> Option<Vec<String>> {
    if foreground.hwnd == 0 {
        return None;
    }

    entries.iter().find_map(|(label, entry)| {
        let window = app.get_webview_window(label)?;
        let hwnd = window.hwnd().ok()?.0 as isize;
        if hwnd == foreground.hwnd {
            Some(entry.process_names.clone())
        } else {
            None
        }
    })
}

fn frontend_launcher_path_from_repo_root(root: &Path) -> PathBuf {
    root.join("flowcellbackend")
        .join("helpers")
        .join("Start-FlowCellFrontend.ps1")
}

pub(crate) fn resolve_frontend_launcher_path() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(frontend_launcher_path_from_repo_root(&current_dir));
        if let Some(parent) = current_dir.parent() {
            candidates.push(frontend_launcher_path_from_repo_root(parent));
        }
    }

    if let Ok(current_exe) = std::env::current_exe() {
        for ancestor in current_exe.ancestors().take(8) {
            candidates.push(frontend_launcher_path_from_repo_root(ancestor));
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(frontend_root) = manifest_dir.parent() {
        if let Some(repo_root) = frontend_root.parent() {
            candidates.push(frontend_launcher_path_from_repo_root(repo_root));
        }
    }

    candidates.into_iter().find(|candidate| candidate.is_file())
}

#[cfg(windows)]
pub(crate) fn apply_square_corner_preference<R: tauri::Runtime>(window: &WebviewWindow<R>) {
    if let Ok(hwnd) = window.hwnd() {
        let preference = DWM_WINDOW_CORNER_PREFERENCE(DWMWCP_DONOTROUND.0);
        let _ = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &preference as *const _ as _,
                std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
            )
        };
    }
}

fn set_window_topmost_impl<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
    topmost: bool,
    promote: bool,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        window
            .set_always_on_top(false)
            .map_err(|error| error.to_string())?;
        set_native_window_topmost(window, topmost, promote)?;
    }

    #[cfg(not(windows))]
    {
        window
            .set_always_on_top(topmost)
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[cfg(windows)]
fn get_window_class_name(window_handle: isize) -> String {
    if window_handle == 0 {
        return String::new();
    }

    let mut buffer = vec![0u16; 256];
    let length =
        unsafe { GetClassNameW(window_handle as _, buffer.as_mut_ptr(), buffer.len() as i32) };
    if length <= 0 {
        return String::new();
    }

    String::from_utf16_lossy(&buffer[..length as usize])
}

#[cfg(windows)]
fn is_shell_taskbar_process_name(process_name: &str) -> bool {
    matches!(
        process_name.trim().to_ascii_lowercase().as_str(),
        "explorer.exe" | "explorer" | "shellexperiencehost.exe" | "shellexperiencehost"
    )
}

#[cfg(windows)]
fn is_taskbar_or_preview_window(window_handle: isize) -> bool {
    let class_name = get_window_class_name(window_handle)
        .trim()
        .to_ascii_lowercase();
    if matches!(
        class_name.as_str(),
        "shell_traywnd"
            | "shell_secondarytraywnd"
            | "mstasklistwclass"
            | "tasklistthumbnailwnd"
            | "tasklistoverlaywnd"
            | "taskbarglimpsewnd"
    ) {
        return true;
    }

    if matches!(
        class_name.as_str(),
        "windows.ui.core.corewindow"
            | "xamlexplorerhostislandwindow"
            | "windows.ui.composition.desktopwindowcontentbridge"
    ) {
        let process_id = get_window_process_id_by_handle(window_handle);
        return query_process_path_by_id(process_id)
            .and_then(|process_path| {
                Path::new(&process_path)
                    .file_name()
                    .map(|value| value.to_string_lossy().to_string())
            })
            .map(|process_name| is_shell_taskbar_process_name(&process_name))
            .unwrap_or(false);
    }

    false
}

#[cfg(windows)]
fn is_cursor_over_taskbar_or_preview_surface() -> bool {
    unsafe {
        let mut cursor = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut cursor) == 0 {
            return false;
        }

        let cursor_window = WindowFromPoint(cursor) as isize;
        if cursor_window == 0 {
            return false;
        }

        let root_window = GetAncestor(cursor_window as _, GA_ROOT) as isize;
        [cursor_window, root_window]
            .into_iter()
            .filter(|window_handle| *window_handle != 0)
            .any(is_taskbar_or_preview_window)
    }
}

#[cfg(windows)]
fn apply_scoped_window_state<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
    entry: &ScopedTopmostEntry,
    foreground: &ForegroundWindowState,
    foreground_scoped_process_names: Option<&[String]>,
) -> Result<(bool, bool, Option<isize>), String> {
    let window_hwnd = window
        .hwnd()
        .map_err(|error| format!("Failed to resolve window handle: {error}"))?
        .0 as isize;
    let foreground_name =
        normalize_process_token(if foreground.process_info.process_name.is_empty() {
            foreground.process_info.process_path.as_str()
        } else {
            foreground.process_info.process_name.as_str()
        });
    let foreground_path_token = normalize_process_token(&foreground.process_info.process_path);
    let matches_target_process = matches_process_token(&entry.process_names, &foreground_name)
        || matches_process_token(&entry.process_names, &foreground_path_token);
    let matches_own_window = foreground.hwnd != 0 && foreground.hwnd == window_hwnd;
    let matches_scoped_sibling = foreground_scoped_process_names
        .map(|process_names| process_groups_overlap(&entry.process_names, process_names))
        .unwrap_or(false);
    let matches_target = matches_target_process || matches_own_window || matches_scoped_sibling;
    let cursor_over_taskbar_or_preview = is_cursor_over_taskbar_or_preview_surface();
    let target_owner_hwnd = if entry.bind_owner {
        if cursor_over_taskbar_or_preview {
            None
        } else if matches_target_process && foreground.hwnd != 0 && foreground.hwnd != window_hwnd {
            Some(foreground.hwnd)
        } else {
            entry.last_owner_hwnd
        }
    } else {
        None
    };

    let current_owner_hwnd = {
        let owner_hwnd = unsafe { GetWindowLongPtrW(window_hwnd as _, GWLP_HWNDPARENT) };
        if owner_hwnd == 0 {
            None
        } else {
            Some(owner_hwnd)
        }
    };
    let owner_changed = target_owner_hwnd != current_owner_hwnd;
    if owner_changed {
        set_native_window_owner(window, target_owner_hwnd)?;
    }

    let should_stay_on_top = matches_target && !cursor_over_taskbar_or_preview;
    let should_promote = should_stay_on_top
        && matches_target_process
        && foreground.hwnd != 0
        && foreground.hwnd != window_hwnd;
    // Only re-issue the native topmost/show calls when the resolved state
    // actually changes. set_window_topmost_impl clears always-on-top then sets
    // SetWindowPos(TOPMOST); running it every poll churns the z-order NOTOPMOST
    // -> TOPMOST continuously and visibly flickers the taskbar while a target
    // (e.g. Blender) is foreground. An already-topmost window stays above the
    // non-topmost target, so steady-state re-asserts are unnecessary; genuine
    // changes (target gains/loses foreground, cursor crosses the taskbar, owner
    // change) still re-apply.
    if owner_changed || entry.last_applied != Some(should_stay_on_top) {
        set_window_topmost_impl(window, should_stay_on_top, should_promote)?;
    }

    Ok((should_stay_on_top, matches_target, target_owner_hwnd))
}

#[cfg(windows)]
fn set_native_window_topmost<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
    topmost: bool,
    promote: bool,
) -> Result<(), String> {
    let hwnd = window
        .hwnd()
        .map_err(|error| format!("Failed to resolve window handle: {error}"))?;
    let insert_after = if topmost {
        HWND_TOPMOST
    } else {
        HWND_NOTOPMOST
    };

    unsafe {
        let is_minimized = IsIconic(hwnd.0 as _) != 0;
        let should_show_window = topmost && promote && !is_minimized;

        if should_show_window {
            let _ = ShowWindowAsync(hwnd, SW_SHOWNOACTIVATE);
        }

        SetWindowPos(
            hwnd,
            Some(insert_after),
            0,
            0,
            0,
            0,
            if should_show_window {
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW
            } else {
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
            },
        )
        .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[cfg(windows)]
fn set_native_window_owner<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
    owner_hwnd: Option<isize>,
) -> Result<(), String> {
    let hwnd = window
        .hwnd()
        .map_err(|error| format!("Failed to resolve window handle: {error}"))?;
    unsafe {
        SetWindowLongPtrW(hwnd.0, GWLP_HWNDPARENT, owner_hwnd.unwrap_or_default());
    }
    Ok(())
}

#[cfg(windows)]
fn get_foreground_window_state_impl() -> ForegroundWindowState {
    unsafe {
        let foreground_window = GetForegroundWindow();
        if foreground_window.is_null() {
            return ForegroundWindowState::default();
        }
        let root_window = GetAncestor(foreground_window, GA_ROOT);
        let foreground_window = if root_window.is_null() {
            foreground_window
        } else {
            root_window
        };

        let mut process_id = 0u32;
        GetWindowThreadProcessId(foreground_window, &mut process_id);
        if process_id == 0 {
            return ForegroundWindowState::default();
        }

        let process_handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
        if process_handle.is_null() {
            return ForegroundWindowState::default();
        }

        let mut buffer = vec![0u16; 1024];
        let mut length = buffer.len() as u32;
        let query_result =
            QueryFullProcessImageNameW(process_handle, 0, buffer.as_mut_ptr(), &mut length);
        let _ = CloseHandle(process_handle);

        if query_result == 0 || length == 0 {
            return ForegroundWindowState::default();
        }

        let process_path = String::from_utf16_lossy(&buffer[..length as usize]);
        let process_name = Path::new(&process_path)
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();

        ForegroundWindowState {
            hwnd: foreground_window as isize,
            process_info: ForegroundProcessInfo {
                process_name,
                process_path,
            },
        }
    }
}

#[cfg(windows)]
pub(crate) fn get_foreground_process_info_impl() -> ForegroundProcessInfo {
    get_foreground_window_state_impl().process_info
}

#[cfg(not(windows))]
pub(crate) fn get_foreground_process_info_impl() -> ForegroundProcessInfo {
    ForegroundProcessInfo::default()
}

#[cfg(windows)]
pub(crate) fn query_process_path_by_id(process_id: u32) -> Option<String> {
    if process_id == 0 {
        return None;
    }

    unsafe {
        let process_handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
        if process_handle.is_null() {
            return None;
        }

        let mut buffer = vec![0u16; 1024];
        let mut length = buffer.len() as u32;
        let query_result =
            QueryFullProcessImageNameW(process_handle, 0, buffer.as_mut_ptr(), &mut length);
        let _ = CloseHandle(process_handle);
        if query_result == 0 || length == 0 {
            return None;
        }

        Some(String::from_utf16_lossy(&buffer[..length as usize]))
    }
}

#[cfg(windows)]
fn is_blender_process_id(process_id: u32) -> bool {
    query_process_path_by_id(process_id)
        .and_then(|process_path| {
            Path::new(&process_path)
                .file_name()
                .map(|value| value.to_string_lossy().to_ascii_lowercase())
        })
        .map(|process_name| process_name == "blender.exe" || process_name == "blender")
        .unwrap_or(false)
}

#[cfg(windows)]
fn get_root_foreground_window_handle() -> isize {
    unsafe {
        let foreground_window = GetForegroundWindow() as isize;
        if foreground_window == 0 {
            return 0;
        }
        let root_window = GetAncestor(foreground_window as _, GA_ROOT) as isize;
        if root_window == 0 {
            foreground_window
        } else {
            root_window
        }
    }
}

#[cfg(windows)]
fn get_window_process_id_by_handle(window_handle: isize) -> u32 {
    if window_handle == 0 {
        return 0;
    }

    let mut process_id = 0u32;
    unsafe {
        GetWindowThreadProcessId(window_handle as _, &mut process_id);
    }
    process_id
}

#[cfg(windows)]
fn find_blender_process_id_below_window(start_window: isize) -> u32 {
    if start_window == 0 {
        return 0;
    }

    let mut current_window = start_window;
    let mut visited_windows = HashSet::new();
    for _ in 0..250 {
        current_window = unsafe { GetWindow(current_window as _, GW_HWNDNEXT as u32) as isize };
        if current_window == 0 || !visited_windows.insert(current_window) {
            break;
        }
        if unsafe { IsWindowVisible(current_window as _) } == 0 {
            continue;
        }

        let process_id = get_window_process_id_by_handle(current_window);
        if process_id > 0 && is_blender_process_id(process_id) {
            return process_id;
        }
    }

    0
}

#[cfg(windows)]
pub(crate) fn resolve_target_blender_process_id(bridge_root: &Path) -> Result<u32, String> {
    let foreground_window = get_root_foreground_window_handle();
    let foreground_process_id = get_window_process_id_by_handle(foreground_window);
    if foreground_process_id > 0 && is_blender_process_id(foreground_process_id) {
        return Ok(foreground_process_id);
    }

    let below_foreground_process_id = find_blender_process_id_below_window(foreground_window);
    if below_foreground_process_id > 0 {
        return Ok(below_foreground_process_id);
    }

    if let Some(runtime_pid) = read_blender_bridge_runtime_pid(bridge_root) {
        if !is_blender_process_id(runtime_pid) {
            return Err(BLENDER_BRIDGE_NOT_RUNNING_MESSAGE.to_string());
        }
        return Ok(runtime_pid);
    }

    Err(
        "Could not determine which Blender window is active. Activate the target Blender window and try again."
            .to_string(),
    )
}

#[cfg(not(windows))]
pub(crate) fn resolve_target_blender_process_id(_bridge_root: &Path) -> Result<u32, String> {
    Err("Direct Blender bridge requests are only supported on Windows.".to_string())
}

#[tauri::command]
pub(crate) fn set_host_window_topmost(
    app: AppHandle,
    label: String,
    topmost: bool,
    promote: Option<bool>,
) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Window '{}' was not found.", label))?;
    set_window_topmost_impl(&window, topmost, promote.unwrap_or(false))
}

#[tauri::command]
pub(crate) fn register_scoped_window_topmost(
    label: String,
    program_name: String,
    bind_owner: Option<bool>,
    registry: State<ScopedTopmostRegistry>,
) -> Result<Vec<String>, String> {
    let process_names_result = resolve_program_process_names(&program_name);
    let mut entries = registry
        .entries
        .lock()
        .map_err(|_| String::from("Scoped topmost registry lock failed."))?;

    let process_names = match process_names_result {
        Ok(process_names) => process_names,
        Err(error) => {
            entries.remove(&label);
            return Err(error);
        }
    };

    if process_names.is_empty() {
        entries.remove(&label);
        return Ok(Vec::new());
    }

    let response = process_names.clone();
    entries.insert(
        label,
        ScopedTopmostEntry {
            process_names,
            bind_owner: bind_owner.unwrap_or(true),
            last_applied: None,
            last_target_match: None,
            last_owner_hwnd: None,
        },
    );

    Ok(response)
}

#[tauri::command]
pub(crate) fn unregister_scoped_window_topmost(
    label: String,
    registry: State<ScopedTopmostRegistry>,
) -> Result<(), String> {
    let mut entries = registry
        .entries
        .lock()
        .map_err(|_| String::from("Scoped topmost registry lock failed."))?;
    entries.remove(&label);
    Ok(())
}

#[tauri::command]
pub(crate) fn refresh_scoped_window_topmost(
    app: AppHandle,
    label: String,
    registry: State<ScopedTopmostRegistry>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let entries_snapshot = {
            let entries = registry
                .entries
                .lock()
                .map_err(|_| String::from("Scoped topmost registry lock failed."))?;
            entries.clone()
        };
        let entry = entries_snapshot.get(&label).cloned();

        let Some(entry) = entry else {
            return Ok(());
        };
        let window = app
            .get_webview_window(&label)
            .ok_or_else(|| format!("Window '{}' was not found.", label))?;
        let foreground = get_foreground_window_state_impl();
        let foreground_scoped_process_names =
            resolve_foreground_scoped_process_names(&app, &entries_snapshot, &foreground);
        let (should_stay_on_top, matches_target, last_owner_hwnd) = apply_scoped_window_state(
            &window,
            &entry,
            &foreground,
            foreground_scoped_process_names.as_deref(),
        )?;

        let mut entries = registry
            .entries
            .lock()
            .map_err(|_| String::from("Scoped topmost registry lock failed."))?;
        if let Some(entry) = entries.get_mut(&label) {
            entry.last_applied = Some(should_stay_on_top);
            entry.last_target_match = Some(matches_target);
            entry.last_owner_hwnd = last_owner_hwnd;
        }
    }

    #[cfg(not(windows))]
    {
        let _ = app;
        let _ = label;
        let _ = registry;
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn refresh_frontend_host() -> Result<(), String> {
    let launcher_path = resolve_frontend_launcher_path().ok_or_else(|| {
        "FlowCell frontend launcher script was not found for host refresh.".to_string()
    })?;

    let mut command = Command::new(resolve_powershell_path());
    command
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(&launcher_path)
        .arg("-ForceRestart");

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to start frontend refresh launcher: {error}"))
}

#[tauri::command]
pub(crate) fn get_foreground_process_info() -> Result<ForegroundProcessInfo, String> {
    Ok(get_foreground_process_info_impl())
}

#[cfg(windows)]
pub(crate) fn start_scoped_topmost_worker(app: AppHandle, registry: ScopedTopmostRegistry) {
    thread::spawn(move || loop {
        let snapshot = match registry.entries.lock() {
            Ok(entries) => entries.clone(),
            Err(_) => {
                thread::sleep(Duration::from_millis(SCOPED_TOPMOST_POLL_MS));
                continue;
            }
        };

        if snapshot.is_empty() {
            thread::sleep(Duration::from_millis(SCOPED_TOPMOST_POLL_MS));
            continue;
        }

        let foreground = get_foreground_window_state_impl();
        let foreground_scoped_process_names =
            resolve_foreground_scoped_process_names(&app, &snapshot, &foreground);
        let mut missing_labels = Vec::new();
        let mut applied_updates = Vec::new();

        for (label, entry) in &snapshot {
            let Some(window) = app.get_webview_window(&label) else {
                missing_labels.push(label.clone());
                continue;
            };

            if let Ok((should_stay_on_top, matches_target, last_owner_hwnd)) =
                apply_scoped_window_state(
                    &window,
                    &entry,
                    &foreground,
                    foreground_scoped_process_names.as_deref(),
                )
            {
                if entry.last_applied == Some(should_stay_on_top)
                    && entry.last_target_match == Some(matches_target)
                    && entry.last_owner_hwnd == last_owner_hwnd
                    && !matches_target
                {
                    continue;
                }

                applied_updates.push((
                    label.clone(),
                    should_stay_on_top,
                    matches_target,
                    last_owner_hwnd,
                ));
            }
        }

        if !missing_labels.is_empty() || !applied_updates.is_empty() {
            if let Ok(mut entries) = registry.entries.lock() {
                for label in missing_labels {
                    entries.remove(&label);
                }
                for (label, last_applied, last_target_match, last_owner_hwnd) in applied_updates {
                    if let Some(entry) = entries.get_mut(&label) {
                        entry.last_applied = Some(last_applied);
                        entry.last_target_match = Some(last_target_match);
                        entry.last_owner_hwnd = last_owner_hwnd;
                    }
                }
            }
        }

        thread::sleep(Duration::from_millis(SCOPED_TOPMOST_POLL_MS));
    });
}
