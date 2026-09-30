use crate::*;

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ForegroundProcessInfo {
    pub(crate) process_name: String,
    pub(crate) process_path: String,
}

#[derive(Serialize, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeInputSnapshot {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) space_down: bool,
    pub(crate) primary_button_down: bool,
    pub(crate) covered_button_windows: Vec<String>,
}

#[cfg(windows)]
const NATIVE_INPUT_SNAPSHOT_EVENT: &str = "flowcell-native-input-snapshot";

#[cfg(windows)]
const SCOPED_WINDOW_INPUT_STATE_EVENT: &str = "flowcell-scoped-window-input-state";

#[cfg(windows)]
const NATIVE_INPUT_POLL_MS: u64 = 16;

#[derive(Clone, Default)]
pub(crate) struct ScopedTopmostRegistry {
    entries: Arc<Mutex<HashMap<String, ScopedTopmostEntry>>>,
    #[cfg(windows)]
    last_external_foreground: Arc<Mutex<Option<ForegroundWindowState>>>,
    #[cfg(windows)]
    apply_lock: Arc<Mutex<()>>,
}

#[derive(Clone, Default)]
struct ScopedTopmostEntry {
    native_hwnd: isize,
    fan_open_order: u64,
    process_names: Vec<String>,
    bind_owner: bool,
    selective_input: bool,
    initial_reveal: bool,
    last_placement: Option<ScopedWindowPlacement>,
    last_observed_foreground_hwnd: Option<isize>,
    last_input_active: Option<bool>,
    last_preview_suppressed: Option<bool>,
    cursor_input_applied: bool,
    last_owner_hwnd: Option<isize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ScopedWindowPlacement {
    Topmost,
    Normal,
    Behind(isize),
    Bottom,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ScopedWindowStateUpdate {
    placement: ScopedWindowPlacement,
    observed_foreground_hwnd: isize,
    input_active: bool,
    initial_reveal_active: bool,
    preview_suppressed: bool,
    cursor_input_applied: bool,
    remembered_owner_hwnd: Option<isize>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScopedWindowInputState {
    label: String,
    active: bool,
}

#[cfg(windows)]
#[derive(Clone, Default)]
struct ForegroundWindowState {
    hwnd: isize,
    process_id: u32,
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

#[cfg(windows)]
fn covered_button_windows_below(cursor_hwnd: isize, buttons: &HashMap<isize, String>) -> Vec<String> {
    let mut covered = Vec::new();
    if buttons.contains_key(&cursor_hwnd) {
        let mut below = cursor_hwnd;
        for _ in 0..250 {
            below = unsafe { GetWindow(below as _, GW_HWNDNEXT as u32) } as isize;
            if below == 0 { break; }
            if let Some(label) = buttons.get(&below) { covered.push(label.clone()); }
        }
    }
    covered.sort();
    covered
}

#[cfg(windows)]
fn read_native_input_snapshot(registry: &ScopedTopmostRegistry) -> Result<NativeInputSnapshot, String> {
    let mut cursor = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut cursor) } == 0 {
        return Err("Could not read the native cursor position.".to_string());
    }
    let swapped = unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0;
    let primary_button = if swapped { VK_RBUTTON } else { VK_LBUTTON };
    let buttons = registry.entries.lock().map_err(|_| "Scoped window registry lock failed.")?
        .iter().filter(|(_, entry)| entry.selective_input && entry.native_hwnd != 0)
        .map(|(label, entry)| (entry.native_hwnd, label.clone())).collect::<HashMap<_, _>>();
    let cursor_hwnd = unsafe { GetAncestor(WindowFromPoint(cursor), GA_ROOT) } as isize;
    let covered_button_windows = covered_button_windows_below(cursor_hwnd, &buttons);
    Ok(NativeInputSnapshot {
        x: cursor.x,
        y: cursor.y,
        space_down: (unsafe { GetAsyncKeyState(VK_SPACE as i32) } as u16 & 0x8000) != 0,
        primary_button_down: (unsafe { GetAsyncKeyState(primary_button as i32) } as u16 & 0x8000)
            != 0,
        covered_button_windows,
    })
}

#[tauri::command]
pub(crate) fn get_native_input_snapshot(registry: State<'_, ScopedTopmostRegistry>) -> Result<NativeInputSnapshot, String> {
    #[cfg(windows)]
    {
        return read_native_input_snapshot(&registry);
    }

    #[cfg(not(windows))]
    {
        let _ = registry;
        Err("Native input snapshots are available only on Windows.".to_string())
    }
}

#[cfg(windows)]
pub(crate) fn start_native_input_worker(app: AppHandle) {
    thread::spawn(move || {
        let registry = app.state::<ScopedTopmostRegistry>().inner().clone();
        let mut previous_snapshot = None;
        loop {
            if let Ok(snapshot) = read_native_input_snapshot(&registry) {
                if previous_snapshot.as_ref() != Some(&snapshot) {
                    let _ = app.emit(NATIVE_INPUT_SNAPSHOT_EVENT, snapshot.clone());
                    previous_snapshot = Some(snapshot);
                }
            }
            thread::sleep(Duration::from_millis(NATIVE_INPUT_POLL_MS));
        }
    });
}

fn resolve_program_window_scope(program_name: &str) -> Result<(Vec<String>, bool), String> {
    let program_name = crate::require_registered_program_name(program_name)?;
    let manifest = program_sources::manifest::load_program_manifest(&program_name)?;
    let process_names = normalize_configured_process_names(&manifest.process_names);
    if process_names.is_empty() {
        return Err(format!(
            "Program manifest for '{}' has no usable processNames.",
            manifest.label
        ));
    }
    Ok((process_names, manifest.bind_scoped_native_owner))
}

fn matches_process_token(process_names: &[String], candidate: &str) -> bool {
    let normalized_candidate = normalize_process_token(candidate);
    if normalized_candidate.is_empty() {
        return false;
    }

    process_names
        .iter()
        .any(|process_name| process_name == &normalized_candidate)
}

#[cfg(windows)]
fn process_groups_overlap(left: &[String], right: &[String]) -> bool {
    left.iter()
        .any(|left_name| right.iter().any(|right_name| left_name == right_name))
}

#[cfg(any(windows, test))]
fn matches_foreground_process(
    process_names: &[String],
    process_info: &ForegroundProcessInfo,
) -> bool {
    matches_process_token(process_names, &process_info.process_name)
        || matches_process_token(process_names, &process_info.process_path)
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
fn is_shell_surface_window(window_handle: isize) -> bool {
    if is_taskbar_or_preview_window(window_handle) {
        return true;
    }

    matches!(
        get_window_class_name(window_handle)
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "progman" | "workerw" | "shelldll_defview"
    )
}

#[cfg(windows)]
fn is_valid_external_foreground(foreground: &ForegroundWindowState) -> bool {
    foreground.hwnd != 0
        && foreground.process_id != 0
        && foreground.process_id != std::process::id()
        && !is_shell_surface_window(foreground.hwnd)
        && unsafe { IsWindow(foreground.hwnd as _) } != 0
        && unsafe { IsWindowVisible(foreground.hwnd as _) } != 0
        && unsafe { IsIconic(foreground.hwnd as _) } == 0
}

#[cfg(windows)]
fn is_valid_cached_external(foreground: &ForegroundWindowState) -> bool {
    is_valid_external_foreground(foreground)
        && get_window_process_id_by_handle(foreground.hwnd) == foreground.process_id
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
fn resolve_last_external_foreground(
    registry: &ScopedTopmostRegistry,
    foreground: &ForegroundWindowState,
) -> Option<ForegroundWindowState> {
    let mut last_external = registry.last_external_foreground.lock().ok()?;
    if is_valid_external_foreground(foreground) {
        *last_external = Some(foreground.clone());
    } else if last_external
        .as_ref()
        .is_some_and(|cached| !is_valid_cached_external(cached))
    {
        *last_external = None;
    }
    last_external.clone()
}

#[cfg(windows)]
static SCRIPT_TARGET_WINDOW: OnceLock<Mutex<Option<ForegroundWindowState>>> = OnceLock::new();

#[cfg(windows)]
fn remember_script_target(foreground: &ForegroundWindowState) -> Option<ForegroundWindowState> {
    let mut cached = SCRIPT_TARGET_WINDOW
        .get_or_init(|| Mutex::new(None))
        .lock()
        .ok()?;
    if is_valid_external_foreground(foreground) {
        *cached = Some(foreground.clone());
    }
    if cached
        .as_ref()
        .is_some_and(|window| !is_valid_cached_external(window))
    {
        *cached = None;
    }
    cached.clone()
}

/// Use the same validated last external application as scoped Button windows.
pub(crate) fn script_target_window_handle() -> isize {
    #[cfg(windows)]
    {
        let current = get_foreground_window_state_impl();
        let target = remember_script_target(&current);
        if is_valid_external_foreground(&current) || current.process_id == std::process::id() {
            return target.map(|window| window.hwnd).unwrap_or(0);
        }
        return 0;
    }
    #[cfg(not(windows))]
    {
        0
    }
}

#[cfg(windows)]
fn clear_last_external_foreground(registry: &ScopedTopmostRegistry) -> Result<(), String> {
    let mut last_external = registry
        .last_external_foreground
        .lock()
        .map_err(|_| String::from("Scoped topmost external-foreground lock failed."))?;
    *last_external = None;
    Ok(())
}

#[cfg(any(windows, test))]
fn resolve_scoped_window_placement(
    matches_target_process: bool,
    foreground_is_scoped_window: bool,
    foreground_scoped_group_matches: bool,
    last_external_matches_target: bool,
    explicit_open_reveal: bool,
    cursor_over_taskbar_or_preview: bool,
    foreground_hwnd: isize,
    window_hwnd: isize,
) -> (ScopedWindowPlacement, bool) {
    if cursor_over_taskbar_or_preview {
        return (ScopedWindowPlacement::Bottom, false);
    }

    if matches_target_process {
        return (ScopedWindowPlacement::Topmost, true);
    }

    // A Pop/Fan explicitly opened from FlowCell must be visible and usable
    // immediately, even though Main is not itself a program-scoped window.
    // Keep that reveal in the normal band; only the exact owning application
    // is ever allowed to promote the window to TOPMOST.
    if explicit_open_reveal {
        if foreground_is_scoped_window && foreground_hwnd != window_hwnd {
            return (
                ScopedWindowPlacement::Behind(foreground_hwnd),
                foreground_scoped_group_matches,
            );
        }
        return (ScopedWindowPlacement::Normal, true);
    }

    // A FlowCell button may become the foreground window while it is being
    // clicked. That is a continuation of the last proven owning application,
    // never a new topmost match. Keep the matching group in the normal band so
    // it remains usable over its owner without floating above other programs.
    if foreground_is_scoped_window
        && foreground_scoped_group_matches
        && last_external_matches_target
    {
        if foreground_hwnd != window_hwnd {
            return (ScopedWindowPlacement::Behind(foreground_hwnd), true);
        }
        return (ScopedWindowPlacement::Normal, true);
    }

    // Inactive program windows may only move down. Inserting directly behind
    // the foreground would lift them above other apps on another monitor:
    // [Blender, Chrome, Layer Tree] would become [Blender, Layer Tree, Chrome].
    (ScopedWindowPlacement::Bottom, false)
}

#[cfg(any(windows, test))]
fn resolve_selective_window_interactivity(
    placement: ScopedWindowPlacement,
    input_active: bool,
    selective_input: bool,
    cursor_over_taskbar_or_preview: bool,
) -> (ScopedWindowPlacement, bool) {
    if !selective_input || cursor_over_taskbar_or_preview || input_active {
        return (placement, input_active);
    }

    // A visible transparent Pop/Fan must never become a click-through copy of
    // its controls merely because its owning program is closed or inactive.
    // Keep the resolved Z order and let the frontend's exact geometry decide
    // which exposed controls receive input. Moving to Normal here would raise
    // every inactive program's Pop/Fan on each foreground change.
    (placement, true)
}

#[cfg(any(windows, test))]
fn continues_explicit_open_reveal(
    initial_reveal: bool,
    foreground_is_flowcell_window: bool,
    foreground_hwnd: isize,
    window_hwnd: isize,
    last_observed_foreground_hwnd: Option<isize>,
) -> bool {
    initial_reveal
        && foreground_is_flowcell_window
        && foreground_hwnd != 0
        && (foreground_hwnd == window_hwnd
            || last_observed_foreground_hwnd
                .map(|last_hwnd| last_hwnd == foreground_hwnd)
                .unwrap_or(true))
}

#[cfg(any(windows, test))]
fn resolve_scoped_owner_hwnds(
    bind_owner: bool,
    cursor_over_taskbar_or_preview: bool,
    owner_candidate_hwnd: Option<isize>,
    window_hwnd: isize,
    last_owner_hwnd: Option<isize>,
) -> (Option<isize>, Option<isize>) {
    if !bind_owner {
        return (None, None);
    }

    let remembered_owner_hwnd = owner_candidate_hwnd
        .filter(|owner_hwnd| *owner_hwnd != 0 && *owner_hwnd != window_hwnd)
        .or(last_owner_hwnd);
    let native_owner_hwnd = if cursor_over_taskbar_or_preview {
        None
    } else {
        remembered_owner_hwnd
    };

    (native_owner_hwnd, remembered_owner_hwnd)
}

#[cfg(any(windows, test))]
fn should_reapply_scoped_window_state(
    owner_changed: bool,
    last_placement: Option<ScopedWindowPlacement>,
    placement: ScopedWindowPlacement,
    last_observed_foreground_hwnd: Option<isize>,
    observed_foreground_hwnd: isize,
    last_input_active: Option<bool>,
    input_active: bool,
    last_preview_suppressed: Option<bool>,
    preview_suppressed: bool,
) -> bool {
    owner_changed
        || last_placement != Some(placement)
        || last_observed_foreground_hwnd != Some(observed_foreground_hwnd)
        || last_input_active != Some(input_active)
        || last_preview_suppressed != Some(preview_suppressed)
        || preview_suppressed
}

#[cfg(windows)]
fn apply_scoped_window_state<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
    entry: &ScopedTopmostEntry,
    foreground: &ForegroundWindowState,
    foreground_scoped_process_names: Option<&[String]>,
    last_external_foreground: Option<&ForegroundWindowState>,
    cursor_over_taskbar_or_preview: bool,
) -> Result<ScopedWindowStateUpdate, String> {
    let window_hwnd = window
        .hwnd()
        .map_err(|error| format!("Failed to resolve window handle: {error}"))?
        .0 as isize;
    let foreground_is_valid_external = is_valid_external_foreground(foreground);
    let foreground_is_flowcell_window =
        foreground.hwnd != 0 && foreground.process_id == std::process::id();
    let explicit_open_reveal = continues_explicit_open_reveal(
        entry.initial_reveal,
        foreground_is_flowcell_window,
        foreground.hwnd,
        window_hwnd,
        entry.last_observed_foreground_hwnd,
    );
    let matches_target_process = foreground_is_valid_external
        && matches_foreground_process(&entry.process_names, &foreground.process_info);
    let foreground_is_scoped_window = foreground_scoped_process_names.is_some();
    let foreground_scoped_group_matches = foreground_scoped_process_names
        .map(|process_names| process_groups_overlap(&entry.process_names, process_names))
        .unwrap_or(false);
    let last_external_matches_target = last_external_foreground
        .map(|last_external| {
            matches_foreground_process(&entry.process_names, &last_external.process_info)
        })
        .unwrap_or(false);
    let last_external_hwnd = last_external_foreground.map(|last_external| last_external.hwnd);
    let (scoped_placement, scoped_input_active) = resolve_scoped_window_placement(
        matches_target_process,
        foreground_is_scoped_window,
        foreground_scoped_group_matches,
        last_external_matches_target,
        explicit_open_reveal,
        cursor_over_taskbar_or_preview,
        foreground.hwnd,
        window_hwnd,
    );
    let (placement, input_active) = resolve_selective_window_interactivity(
        scoped_placement,
        scoped_input_active,
        entry.selective_input,
        cursor_over_taskbar_or_preview,
    );
    // Input eligibility never grants native ownership. Both opaque tool pages
    // and transparent Pop/Fan hosts may only bind to their proven program.
    let valid_scoped_continuation =
        foreground_is_scoped_window && last_external_matches_target;
    let owner_candidate_hwnd = if matches_target_process {
        Some(foreground.hwnd)
    } else if valid_scoped_continuation {
        last_external_hwnd
    } else {
        None
    };
    // Taskbar previews need the native owner detached temporarily, but that
    // preview-only state must not erase the real program owner. Remember a
    // matching target even when it is first observed under the taskbar so a
    // fast click back to another app can restore the owner immediately.
    let (native_owner_hwnd, remembered_owner_hwnd) = resolve_scoped_owner_hwnds(
        entry.bind_owner,
        cursor_over_taskbar_or_preview,
        owner_candidate_hwnd,
        window_hwnd,
        entry.last_owner_hwnd,
    );

    let current_owner_hwnd = {
        let owner_hwnd = unsafe { GetWindowLongPtrW(window_hwnd as _, GWLP_HWNDPARENT) };
        if owner_hwnd == 0 {
            None
        } else {
            Some(owner_hwnd)
        }
    };
    let owner_changed = native_owner_hwnd != current_owner_hwnd;
    let should_reapply = should_reapply_scoped_window_state(
        owner_changed,
        entry.last_placement,
        placement,
        entry.last_observed_foreground_hwnd,
        foreground.hwnd,
        entry.last_input_active,
        input_active,
        entry.last_preview_suppressed,
        cursor_over_taskbar_or_preview,
    );

    // Full interactive tool pages always retain normal native input. Transparent
    // Pop/Fan hosts delegate exact hit testing to their selective frontend
    // controller, including while the owning program is closed or inactive.
    let cursor_input_applied = if !entry.selective_input {
        window.set_ignore_cursor_events(false).is_ok()
    } else if !input_active {
        window.set_ignore_cursor_events(true).is_ok()
    } else {
        true
    };

    if owner_changed {
        set_native_window_owner(window, native_owner_hwnd)?;
    }

    // Only an exact external process match is ever allowed to select TOPMOST.
    // Inactive windows go to the bottom, never directly behind the foreground:
    // even that insertion can raise them above apps on another monitor.
    if should_reapply {
        set_scoped_native_window_placement(window, placement, matches_target_process)?;
    }

    Ok(ScopedWindowStateUpdate {
        placement,
        observed_foreground_hwnd: foreground.hwnd,
        input_active,
        initial_reveal_active: explicit_open_reveal
            && !foreground_is_valid_external
            && (!foreground_is_scoped_window || foreground_scoped_group_matches)
            && !cursor_over_taskbar_or_preview,
        preview_suppressed: cursor_over_taskbar_or_preview,
        cursor_input_applied,
        remembered_owner_hwnd,
    })
}

#[cfg(windows)]
fn is_native_window_topmost(window_hwnd: isize) -> bool {
    window_hwnd != 0
        && (unsafe { GetWindowLongPtrW(window_hwnd as _, GWL_EXSTYLE) } as u32 & WS_EX_TOPMOST) != 0
}

#[cfg(windows)]
fn set_scoped_native_window_placement<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
    placement: ScopedWindowPlacement,
    promote: bool,
) -> Result<(), String> {
    // Apply the final native placement directly. A preliminary Tauri demotion
    // queues another Z-order change and can raise inactive windows into the
    // normal foreground band (or undo the placement below after it returns).
    let hwnd = window
        .hwnd()
        .map_err(|error| format!("Failed to resolve window handle: {error}"))?;
    set_scoped_native_hwnd_placement(hwnd, placement, promote)
}

fn update_fan_open_order(entries: &mut HashMap<String, ScopedTopmostEntry>, label: &str, expanded: bool) {
    let order = if expanded { entries.values().map(|entry| entry.fan_open_order).max().unwrap_or(0) + 1 } else { 0 };
    if let Some(entry) = entries.get_mut(label) { entry.fan_open_order = order; }
}

fn expanded_fan_stack(entries: &HashMap<String, ScopedTopmostEntry>) -> Vec<String> {
    let mut fans = entries.iter().filter(|(_, entry)| entry.fan_open_order > 0).collect::<Vec<_>>();
    fans.sort_by_key(|(_, entry)| entry.fan_open_order);
    fans.into_iter().map(|(label, _)| label.clone()).collect()
}

fn expanded_fan_placement(placement: ScopedWindowPlacement) -> Option<ScopedWindowPlacement> {
    match placement {
        ScopedWindowPlacement::Topmost => Some(ScopedWindowPlacement::Topmost),
        ScopedWindowPlacement::Normal | ScopedWindowPlacement::Behind(_) => Some(ScopedWindowPlacement::Normal),
        ScopedWindowPlacement::Bottom => None,
    }
}

#[cfg(windows)]
fn raise_expanded_fan_hwnd(hwnd: Win32Hwnd, placement: ScopedWindowPlacement) -> Result<(), String> {
    set_scoped_native_hwnd_placement(hwnd, placement, false)?;
    if placement == ScopedWindowPlacement::Normal {
        // HWND_NOTOPMOST does not raise a window already in the normal band.
        unsafe {
            SetWindowPos(hwnd, Some(windows::Win32::UI::WindowsAndMessaging::HWND_TOP), 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER)
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn raise_expanded_fans(
    app: &AppHandle, entries: &HashMap<String, ScopedTopmostEntry>, foreground: &ForegroundWindowState,
    last_external: Option<&ForegroundWindowState>, preview_suppressed: bool,
) -> Result<(), String> {
    let foreground_group = resolve_foreground_scoped_process_names(app, entries, foreground);
    // Oldest first: the latest hover-open or owner pin click wins, including over pinned fans.
    for label in expanded_fan_stack(entries) {
        let entry = &entries[&label];
        let Some(window) = app.get_webview_window(&label) else { continue; };
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
        let (placement, _) = resolve_scoped_window_placement(
            is_valid_external_foreground(foreground) && matches_foreground_process(&entry.process_names, &foreground.process_info),
            foreground_group.is_some(),
            foreground_group.as_ref().is_some_and(|group| process_groups_overlap(&entry.process_names, group)),
            last_external.is_some_and(|external| matches_foreground_process(&entry.process_names, &external.process_info)),
            continues_explicit_open_reveal(entry.initial_reveal, foreground.process_id == std::process::id(), foreground.hwnd, hwnd, entry.last_observed_foreground_hwnd),
            preview_suppressed, foreground.hwnd, hwnd,
        );
        if let Some(placement) = expanded_fan_placement(placement) {
            raise_expanded_fan_hwnd(Win32Hwnd(hwnd as _), placement)?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn set_scoped_native_hwnd_placement(
    hwnd: Win32Hwnd,
    placement: ScopedWindowPlacement,
    promote: bool,
) -> Result<(), String> {
    let mut resolved_placement = match placement {
        ScopedWindowPlacement::Behind(anchor)
            if anchor == 0
                || anchor == hwnd.0 as isize
                || unsafe { IsWindow(anchor as _) } == 0 =>
        {
            ScopedWindowPlacement::Bottom
        }
        other => other,
    };
    if let ScopedWindowPlacement::Behind(anchor) = resolved_placement {
        if get_window_process_id_by_handle(anchor) == std::process::id()
            && is_native_window_topmost(anchor)
        {
            unsafe {
                SetWindowPos(
                    Win32Hwnd(anchor as *mut c_void),
                    Some(HWND_NOTOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
                )
                .map_err(|error| error.to_string())?;
            }
        }
        if is_native_window_topmost(anchor) {
            resolved_placement = ScopedWindowPlacement::Bottom;
        }
    }
    let insert_after = match resolved_placement {
        ScopedWindowPlacement::Topmost => HWND_TOPMOST,
        ScopedWindowPlacement::Normal => HWND_NOTOPMOST,
        ScopedWindowPlacement::Behind(anchor) => Win32Hwnd(anchor as *mut c_void),
        ScopedWindowPlacement::Bottom => HWND_BOTTOM,
    };

    unsafe {
        let is_minimized = IsIconic(hwnd.0 as _) != 0;
        let should_show_window = matches!(resolved_placement, ScopedWindowPlacement::Topmost)
            && promote
            && !is_minimized;

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
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW
            } else {
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER
            },
        )
        .map_err(|error| error.to_string())?;
    }

    Ok(())
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
            process_id,
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

fn select_existing_matching_process_path(
    process_names: &[String],
    candidate_paths: &[String],
) -> Option<String> {
    let normalized_process_names = normalize_configured_process_names(process_names);
    candidate_paths
        .iter()
        .find(|candidate| {
            Path::new(candidate.as_str()).is_file()
                && matches_process_token(&normalized_process_names, candidate)
        })
        .cloned()
}

#[cfg(windows)]
#[derive(Default)]
struct RunningProcessPathSearch {
    paths: Vec<String>,
}

#[cfg(windows)]
unsafe extern "system" fn enum_running_process_paths(hwnd: HWND, lparam: LPARAM) -> BOOL {
    if hwnd.is_null() {
        return 1;
    }
    let mut process_id = 0u32;
    GetWindowThreadProcessId(hwnd, &mut process_id);
    let Some(process_path) = query_process_path_by_id(process_id) else {
        return 1;
    };
    let search = &mut *(lparam as *mut RunningProcessPathSearch);
    if !search
        .paths
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(&process_path))
    {
        search.paths.push(process_path);
    }
    1
}

#[cfg(windows)]
pub(crate) fn find_running_process_executable(process_names: &[String]) -> Option<String> {
    let mut candidates = Vec::new();
    let foreground = get_foreground_process_info_impl();
    if !foreground.process_path.trim().is_empty() {
        candidates.push(foreground.process_path);
    }
    let mut search = RunningProcessPathSearch::default();
    unsafe {
        EnumWindows(
            Some(enum_running_process_paths),
            &mut search as *mut RunningProcessPathSearch as LPARAM,
        );
    }
    candidates.extend(search.paths);
    select_existing_matching_process_path(process_names, &candidates)
}

#[cfg(not(windows))]
pub(crate) fn find_running_process_executable(_process_names: &[String]) -> Option<String> {
    None
}

#[cfg(windows)]
fn is_blender_process_id(process_id: u32) -> bool {
    process_id_has_name(process_id, &["blender.exe", "blender"])
}

#[cfg(windows)]
fn is_fusion_process_id(process_id: u32) -> bool {
    process_id_has_name(
        process_id,
        &[
            "fusion360.exe",
            "fusion360",
            "fusionlauncher.exe",
            "fusionlauncher",
        ],
    )
}

#[cfg(windows)]
fn process_id_has_name(process_id: u32, expected_names: &[&str]) -> bool {
    query_process_path_by_id(process_id)
        .and_then(|process_path| {
            Path::new(&process_path)
                .file_name()
                .map(|value| value.to_string_lossy().to_ascii_lowercase())
        })
        .map(|process_name| expected_names.contains(&process_name.as_str()))
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
fn find_process_id_below_window(start_window: isize, matches_process: impl Fn(u32) -> bool) -> u32 {
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
        if process_id > 0 && matches_process(process_id) {
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

    let below_foreground_process_id =
        find_process_id_below_window(foreground_window, is_blender_process_id);
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

#[cfg(windows)]
pub(crate) fn resolve_target_fusion_process_id(bridge_root: &Path) -> Result<u32, String> {
    let runtime_process_ids = read_fusion_bridge_runtime_process_ids(bridge_root);
    let is_ready_fusion_process = |process_id: u32| {
        runtime_process_ids.contains(&process_id) && is_fusion_process_id(process_id)
    };
    let foreground_window = get_root_foreground_window_handle();
    let foreground_process_id = get_window_process_id_by_handle(foreground_window);
    if foreground_process_id > 0 && is_ready_fusion_process(foreground_process_id) {
        return Ok(foreground_process_id);
    }

    let below_foreground_process_id =
        find_process_id_below_window(foreground_window, is_ready_fusion_process);
    if below_foreground_process_id > 0 {
        return Ok(below_foreground_process_id);
    }

    if let Some(runtime_process_id) = runtime_process_ids
        .into_iter()
        .find(|process_id| is_fusion_process_id(*process_id))
    {
        return Ok(runtime_process_id);
    }

    Err(
        "Could not determine which Fusion 360 bridge process is active. Activate Fusion 360 and try again."
            .to_string(),
    )
}

#[cfg(not(windows))]
pub(crate) fn resolve_target_fusion_process_id(_bridge_root: &Path) -> Result<u32, String> {
    Err("Direct Fusion bridge requests are only supported on Windows.".to_string())
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
// Keep every command that waits on `apply_lock` asynchronous. The scoped
// worker holds that lock while Tauri window getters dispatch to the main
// thread; a synchronous IPC command would otherwise block that same thread
// while waiting for the worker, deadlocking re-entrant WebView focus events.
pub(crate) async fn register_scoped_window_topmost(
    app: AppHandle,
    label: String,
    program_name: String,
    _bind_owner: Option<bool>,
    selective_input: Option<bool>,
    registry: State<'_, ScopedTopmostRegistry>,
) -> Result<Vec<String>, String> {
    #[cfg(windows)]
    let native_hwnd = app.get_webview_window(&label).and_then(|window| window.hwnd().ok()).map_or(0, |hwnd| hwnd.0 as isize);
    #[cfg(not(windows))]
    let native_hwnd = { let _ = app; 0 };
    let window_scope_result = resolve_program_window_scope(&program_name);
    #[cfg(windows)]
    let _apply_guard = registry
        .apply_lock
        .lock()
        .map_err(|_| String::from("Scoped topmost apply lock failed."))?;
    let mut entries = registry
        .entries
        .lock()
        .map_err(|_| String::from("Scoped topmost registry lock failed."))?;

    let (process_names, bind_owner) = match window_scope_result {
        Ok(window_scope) => window_scope,
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
    let selective_input = selective_input.unwrap_or(false);
    let previous_entry = entries.get(&label).cloned().filter(|entry| {
        entry.process_names == process_names
            && entry.bind_owner == bind_owner
            && entry.selective_input == selective_input
    });
    entries.insert(
        label,
        ScopedTopmostEntry {
            native_hwnd,
            fan_open_order: previous_entry.as_ref().map_or(0, |entry| entry.fan_open_order),
            process_names,
            bind_owner,
            selective_input,
            initial_reveal: previous_entry
                .as_ref()
                .is_some_and(|entry| entry.initial_reveal),
            last_placement: previous_entry
                .as_ref()
                .and_then(|entry| entry.last_placement),
            last_observed_foreground_hwnd: previous_entry
                .as_ref()
                .and_then(|entry| entry.last_observed_foreground_hwnd),
            last_input_active: previous_entry
                .as_ref()
                .and_then(|entry| entry.last_input_active),
            last_preview_suppressed: previous_entry
                .as_ref()
                .and_then(|entry| entry.last_preview_suppressed),
            cursor_input_applied: previous_entry
                .as_ref()
                .is_some_and(|entry| entry.cursor_input_applied),
            last_owner_hwnd: previous_entry
                .as_ref()
                .and_then(|entry| entry.last_owner_hwnd),
        },
    );

    Ok(response)
}

#[tauri::command]
pub(crate) async fn unregister_scoped_window_topmost(
    label: String,
    registry: State<'_, ScopedTopmostRegistry>,
) -> Result<(), String> {
    #[cfg(windows)]
    let _apply_guard = registry
        .apply_lock
        .lock()
        .map_err(|_| String::from("Scoped topmost apply lock failed."))?;
    let mut entries = registry
        .entries
        .lock()
        .map_err(|_| String::from("Scoped topmost registry lock failed."))?;
    entries.remove(&label);
    let registry_is_empty = entries.is_empty();
    drop(entries);
    #[cfg(windows)]
    if registry_is_empty {
        clear_last_external_foreground(&registry)?;
    }
    #[cfg(not(windows))]
    let _ = registry_is_empty;
    Ok(())
}

#[tauri::command]
pub(crate) async fn get_scoped_window_input_state(
    label: String,
    registry: State<'_, ScopedTopmostRegistry>,
) -> Result<bool, String> {
    #[cfg(windows)]
    let _apply_guard = registry
        .apply_lock
        .lock()
        .map_err(|_| String::from("Scoped topmost apply lock failed."))?;
    let entries = registry
        .entries
        .lock()
        .map_err(|_| String::from("Scoped topmost registry lock failed."))?;
    Ok(entries
        .get(&label)
        .and_then(|entry| entry.last_input_active)
        .unwrap_or(false))
}

#[tauri::command]
pub(crate) async fn set_button_fan_expanded(
    app: AppHandle,
    window: WebviewWindow,
    expanded: bool,
    registry: State<'_, ScopedTopmostRegistry>,
) -> Result<(), String> {
    let label = window.label();
    if !label.starts_with("button-fan-") { return Err("Only a Button Fan can set fan stacking.".to_string()); }
    #[cfg(windows)]
    let _apply_guard = registry.apply_lock.lock().map_err(|_| "Scoped topmost apply lock failed.")?;
    let snapshot = {
        let mut entries = registry.entries.lock().map_err(|_| "Scoped topmost registry lock failed.")?;
        if !entries.contains_key(label) { return Err("Button Fan has not registered its program scope.".to_string()); }
        update_fan_open_order(&mut entries, label, expanded);
        entries.clone()
    };
    #[cfg(windows)]
    {
        let foreground = get_foreground_window_state_impl();
        let last_external = resolve_last_external_foreground(&registry, &foreground);
        raise_expanded_fans(&app, &snapshot, &foreground, last_external.as_ref(), is_cursor_over_taskbar_or_preview_surface())?;
    }
    #[cfg(not(windows))]
    let _ = (app, snapshot);
    Ok(())
}

#[tauri::command]
pub(crate) async fn refresh_scoped_window_topmost(
    app: AppHandle,
    label: String,
    reveal: Option<bool>,
    force: Option<bool>,
    registry: State<'_, ScopedTopmostRegistry>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _apply_guard = registry
            .apply_lock
            .lock()
            .map_err(|_| String::from("Scoped topmost apply lock failed."))?;
        let foreground = get_foreground_window_state_impl();
        let entries_snapshot = {
            let mut entries = registry
                .entries
                .lock()
                .map_err(|_| String::from("Scoped topmost registry lock failed."))?;
            if let Some(entry) = entries.get_mut(&label) {
                if reveal.unwrap_or(false)
                    && foreground.hwnd != 0
                    && foreground.process_id == std::process::id()
                {
                    entry.initial_reveal = true;
                }
                if force.unwrap_or(false) {
                    // Presentation happens after show. Force the resolved
                    // placement to be applied again even if the hidden
                    // pre-show refresh cached the same state.
                    entry.last_placement = None;
                }
            }
            entries.clone()
        };
        let entry = entries_snapshot.get(&label).cloned();

        let Some(entry) = entry else {
            return Ok(());
        };
        let window = app
            .get_webview_window(&label)
            .ok_or_else(|| format!("Window '{}' was not found.", label))?;
        let cursor_over_taskbar_or_preview = is_cursor_over_taskbar_or_preview_surface();
        let last_external_foreground = resolve_last_external_foreground(&registry, &foreground);
        let foreground_scoped_process_names =
            resolve_foreground_scoped_process_names(&app, &entries_snapshot, &foreground);
        let update = apply_scoped_window_state(
            &window,
            &entry,
            &foreground,
            foreground_scoped_process_names.as_deref(),
            last_external_foreground.as_ref(),
            cursor_over_taskbar_or_preview,
        )?;

        {
            let mut entries = registry
                .entries
                .lock()
                .map_err(|_| String::from("Scoped topmost registry lock failed."))?;
            if let Some(entry) = entries.get_mut(&label) {
                entry.last_placement = Some(update.placement);
                entry.last_observed_foreground_hwnd = Some(update.observed_foreground_hwnd);
                entry.last_input_active = Some(update.input_active);
                entry.initial_reveal = update.initial_reveal_active;
                entry.last_preview_suppressed = Some(update.preview_suppressed);
                entry.cursor_input_applied = update.cursor_input_applied;
                entry.last_owner_hwnd = update.remembered_owner_hwnd;
            }
        }
        let stack = registry.entries.lock().map_err(|_| "Scoped topmost registry lock failed.")?.clone();
        raise_expanded_fans(&app, &stack, &foreground, last_external_foreground.as_ref(), cursor_over_taskbar_or_preview)?;
        app.emit(
            SCOPED_WINDOW_INPUT_STATE_EVENT,
            ScopedWindowInputState {
                label,
                active: update.input_active,
            },
        )
        .map_err(|error| error.to_string())?;
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
pub(crate) fn refresh_frontend_host(app: AppHandle) -> Result<(), String> {
    if installed_resource_root().is_some() {
        app.restart();
    }
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
        let apply_guard = match registry.apply_lock.lock() {
            Ok(guard) => guard,
            Err(_) => {
                thread::sleep(Duration::from_millis(SCOPED_TOPMOST_POLL_MS));
                continue;
            }
        };
        let snapshot = match registry.entries.lock() {
            Ok(entries) => entries.clone(),
            Err(_) => {
                drop(apply_guard);
                thread::sleep(Duration::from_millis(SCOPED_TOPMOST_POLL_MS));
                continue;
            }
        };

        // Shortcut scripts need the last external target even with no Pop/Fan open.
        let foreground = get_foreground_window_state_impl();
        remember_script_target(&foreground);
        if snapshot.is_empty() {
            let _ = clear_last_external_foreground(&registry);
            drop(apply_guard);
            thread::sleep(Duration::from_millis(SCOPED_TOPMOST_POLL_MS));
            continue;
        }

        let cursor_over_taskbar_or_preview = is_cursor_over_taskbar_or_preview_surface();
        let last_external_foreground = resolve_last_external_foreground(&registry, &foreground);
        let foreground_scoped_process_names =
            resolve_foreground_scoped_process_names(&app, &snapshot, &foreground);
        let mut missing_labels = Vec::new();
        let mut applied_updates = Vec::new();
        let mut input_state_updates = Vec::new();

        for (label, entry) in &snapshot {
            let Some(window) = app.get_webview_window(&label) else {
                missing_labels.push(label.clone());
                continue;
            };

            if let Ok(update) = apply_scoped_window_state(
                &window,
                entry,
                &foreground,
                foreground_scoped_process_names.as_deref(),
                last_external_foreground.as_ref(),
                cursor_over_taskbar_or_preview,
            ) {
                if entry.last_input_active != Some(update.input_active) {
                    input_state_updates.push((label.clone(), update.input_active));
                }
                if entry.last_placement != Some(update.placement)
                    || entry.last_observed_foreground_hwnd != Some(update.observed_foreground_hwnd)
                    || entry.last_input_active != Some(update.input_active)
                    || entry.last_preview_suppressed != Some(update.preview_suppressed)
                    || entry.cursor_input_applied != update.cursor_input_applied
                    || entry.last_owner_hwnd != update.remembered_owner_hwnd
                {
                    applied_updates.push((label.clone(), update));
                }
            }
        }

        let stack_changed = !missing_labels.is_empty() || !applied_updates.is_empty();
        let mut registry_became_empty = false;
        if !missing_labels.is_empty() || !applied_updates.is_empty() {
            if let Ok(mut entries) = registry.entries.lock() {
                for label in missing_labels {
                    entries.remove(&label);
                }
                for (label, update) in applied_updates {
                    if let Some(entry) = entries.get_mut(&label) {
                        entry.last_placement = Some(update.placement);
                        entry.last_observed_foreground_hwnd = Some(update.observed_foreground_hwnd);
                        entry.last_input_active = Some(update.input_active);
                        entry.initial_reveal = update.initial_reveal_active;
                        entry.last_preview_suppressed = Some(update.preview_suppressed);
                        entry.cursor_input_applied = update.cursor_input_applied;
                        entry.last_owner_hwnd = update.remembered_owner_hwnd;
                    }
                }
                registry_became_empty = entries.is_empty();
            }
        }
        if registry_became_empty {
            let _ = clear_last_external_foreground(&registry);
        }
        if stack_changed {
            if let Ok(entries) = registry.entries.lock() {
                let stack = entries.clone();
                drop(entries);
                let _ = raise_expanded_fans(&app, &stack, &foreground, last_external_foreground.as_ref(), cursor_over_taskbar_or_preview);
            }
        }

        for (label, active) in input_state_updates {
            let _ = app.emit(
                SCOPED_WINDOW_INPUT_STATE_EVENT,
                ScopedWindowInputState { label, active },
            );
        }

        drop(apply_guard);
        thread::sleep(Duration::from_millis(SCOPED_TOPMOST_POLL_MS));
    });
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn native_new_fan_covers_pinned_fan_and_masks_underlying_hover_without_focus() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, GetForegroundWindow, SetLayeredWindowAttributes, ShowWindow, LWA_ALPHA, SW_SHOWNOACTIVATE, WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_POPUP};
        struct HiddenWindow(super::HWND);
        impl Drop for HiddenWindow {
            fn drop(&mut self) { unsafe { DestroyWindow(self.0); } }
        }
        let foreground = unsafe { GetForegroundWindow() };
        let mut windows = Vec::new();
        let mut entries = std::collections::HashMap::new();
        let mut labels = std::collections::HashMap::new();
        for label in ["first", "second", "pop"] {
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            // Windows does not raise hidden HWNDs. Use fully transparent,
            // offscreen disposable windows without activating any of them.
            let hwnd = unsafe { CreateWindowExW(WS_EX_LAYERED | WS_EX_TOOLWINDOW, class.as_ptr(), class.as_ptr(), WS_POPUP,
                -30000, -30000, 64, 64, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null()) };
            assert!(!hwnd.is_null());
            windows.push(HiddenWindow(hwnd));
            assert_ne!(unsafe { SetLayeredWindowAttributes(hwnd, 0, 0, LWA_ALPHA) }, 0);
            unsafe { ShowWindow(hwnd, SW_SHOWNOACTIVATE); }
            labels.insert(hwnd as isize, label.to_string());
            entries.insert(label.to_string(), super::ScopedTopmostEntry { native_hwnd: hwnd as isize, ..Default::default() });
        }
        let apply = |entries: &std::collections::HashMap<String, super::ScopedTopmostEntry>| {
            for label in super::expanded_fan_stack(entries) {
                super::raise_expanded_fan_hwnd(super::Win32Hwnd(entries[&label].native_hwnd as _), super::ScopedWindowPlacement::Normal).unwrap();
            }
        };
        super::update_fan_open_order(&mut entries, "first", true);
        super::update_fan_open_order(&mut entries, "first", true); // Pinned.
        apply(&entries);
        assert!(super::covered_button_windows_below(entries["first"].native_hwnd, &labels).contains(&"pop".to_string()));
        super::update_fan_open_order(&mut entries, "second", true); // Hover or click new fan.
        apply(&entries);
        assert_eq!(super::covered_button_windows_below(entries["second"].native_hwnd, &labels), vec!["first", "pop"]);
        assert!(!super::covered_button_windows_below(entries["first"].native_hwnd, &labels).contains(&"second".to_string()));
        super::update_fan_open_order(&mut entries, "second", false);
        apply(&entries);
        assert!(super::covered_button_windows_below(entries["first"].native_hwnd, &labels).contains(&"second".to_string()));
        assert_eq!(unsafe { GetForegroundWindow() }, foreground);
    }

    #[test]
    fn expanded_fans_follow_hover_and_pin_order_without_permanent_pin_priority() {
        let mut entries = std::collections::HashMap::new();
        for label in ["first", "second", "third", "pop"] {
            entries.insert(label.to_string(), super::ScopedTopmostEntry::default());
        }
        super::update_fan_open_order(&mut entries, "first", true); // Hover.
        super::update_fan_open_order(&mut entries, "first", true); // Pin click.
        super::update_fan_open_order(&mut entries, "second", true); // Later hover wins.
        assert_eq!(super::expanded_fan_stack(&entries), vec!["first", "second"]);
        super::update_fan_open_order(&mut entries, "second", false);
        assert_eq!(super::expanded_fan_stack(&entries), vec!["first"]);
        super::update_fan_open_order(&mut entries, "third", true); // Click-open and pin.
        assert_eq!(super::expanded_fan_stack(&entries), vec!["first", "third"]);
        super::update_fan_open_order(&mut entries, "third", false);
        assert_eq!(super::expanded_fan_stack(&entries), vec!["first"]);
    }

    #[test]
    fn expanded_fan_stacking_cannot_promote_an_inactive_or_preview_suppressed_group() {
        use super::ScopedWindowPlacement as Placement;
        for preview in [false, true] {
            let (placement, _) = super::resolve_scoped_window_placement(false, false, false, false, false, preview, 99, 22);
            assert_eq!(super::expanded_fan_placement(placement), None);
        }
        assert_eq!(super::expanded_fan_placement(Placement::Topmost), Some(Placement::Topmost));
        assert_eq!(super::expanded_fan_placement(Placement::Behind(99)), Some(Placement::Normal));
        assert_eq!(super::expanded_fan_placement(Placement::Normal), Some(Placement::Normal));
    }

    #[cfg(windows)]
    use super::{
        clear_last_external_foreground, ForegroundProcessInfo, ForegroundWindowState,
        ScopedTopmostRegistry,
    };
    use super::{
        continues_explicit_open_reveal, matches_process_token, resolve_scoped_owner_hwnds,
        resolve_scoped_window_placement, resolve_selective_window_interactivity,
        select_existing_matching_process_path, should_reapply_scoped_window_state,
        NativeInputSnapshot, ScopedWindowPlacement,
    };

    #[test]
    fn scoped_process_matching_is_exact_after_executable_normalization() {
        let configured = vec!["blender".to_string(), "app".to_string()];
        assert!(matches_process_token(
            &configured,
            r"C:\Program Files\Blender\blender.exe"
        ));
        assert!(!matches_process_token(&configured, "blender-launcher.exe"));
        assert!(!matches_process_token(&configured, "WhatsApp.exe"));
        assert!(!matches_process_token(
            &configured,
            "ApplicationFrameHost.exe"
        ));
    }

    #[test]
    fn running_process_executable_selection_requires_an_existing_exact_name() {
        let current_executable = std::env::current_exe().expect("current test executable");
        let process_name = current_executable
            .file_name()
            .expect("test executable file name")
            .to_string_lossy()
            .to_string();
        let candidates = vec![
            current_executable
                .with_file_name(format!("not-{process_name}"))
                .to_string_lossy()
                .to_string(),
            current_executable.to_string_lossy().to_string(),
        ];

        assert_eq!(
            select_existing_matching_process_path(&[process_name], &candidates),
            Some(current_executable.to_string_lossy().to_string())
        );
    }

    #[cfg(windows)]
    #[test]
    fn empty_registry_clears_stale_external_authorization() {
        let registry = ScopedTopmostRegistry::default();
        *registry
            .last_external_foreground
            .lock()
            .expect("external foreground lock") = Some(ForegroundWindowState {
            hwnd: 200,
            process_id: 42,
            process_info: ForegroundProcessInfo {
                process_name: "blender.exe".to_string(),
                process_path: r"C:\Blender\blender.exe".to_string(),
            },
        });

        clear_last_external_foreground(&registry).expect("clear should succeed");

        assert!(registry
            .last_external_foreground
            .lock()
            .expect("external foreground lock")
            .is_none());
    }

    #[test]
    fn native_input_snapshot_uses_frontend_camel_case_fields() {
        let value = serde_json::to_value(NativeInputSnapshot {
            x: -1920,
            y: 24,
            space_down: true,
            primary_button_down: false,
            covered_button_windows: vec!["button-fan-covered".to_string()],
        })
        .expect("native input snapshot should serialize");

        assert_eq!(
            value,
            serde_json::json!({
                "x": -1920,
                "y": 24,
                "spaceDown": true,
                "primaryButtonDown": false,
                "coveredButtonWindows": ["button-fan-covered"]
            })
        );
    }

    #[test]
    fn taskbar_preview_detaches_without_forgetting_the_program_owner() {
        assert_eq!(
            resolve_scoped_owner_hwnds(true, true, None, 100, Some(200)),
            (None, Some(200))
        );
    }

    #[test]
    fn taskbar_activation_remembers_an_owner_for_fast_return_to_another_app() {
        let (_, remembered_owner_hwnd) =
            resolve_scoped_owner_hwnds(true, true, Some(200), 100, None);

        assert_eq!(remembered_owner_hwnd, Some(200));
        assert_eq!(
            resolve_scoped_owner_hwnds(true, false, None, 100, remembered_owner_hwnd),
            (Some(200), Some(200))
        );
    }

    #[test]
    fn only_the_actual_owning_process_resolves_to_topmost() {
        assert_eq!(
            resolve_scoped_window_placement(
                true,
                false,
                false,
                true,
                false,
                false,
                200,
                100,
            ),
            (ScopedWindowPlacement::Topmost, true)
        );
        assert_eq!(
            resolve_scoped_window_placement(
                false,
                false,
                false,
                false,
                false,
                false,
                300,
                100,
            ),
            (ScopedWindowPlacement::Bottom, false)
        );
    }

    #[test]
    fn scoped_button_focus_is_normal_band_continuation_not_topmost() {
        assert_eq!(
            resolve_scoped_window_placement(
                false,
                true,
                true,
                true,
                false,
                false,
                100,
                100,
            ),
            (ScopedWindowPlacement::Normal, true)
        );
        assert_eq!(
            resolve_scoped_window_placement(
                false,
                true,
                true,
                false,
                false,
                false,
                100,
                100,
            ),
            (ScopedWindowPlacement::Bottom, false)
        );
    }

    #[test]
    fn unrelated_scoped_group_cannot_raise_windows_of_the_previous_program() {
        assert_eq!(
            resolve_scoped_window_placement(
                false,
                true,
                true,
                false,
                false,
                false,
                100,
                101,
            ),
            (ScopedWindowPlacement::Bottom, false)
        );
        assert_eq!(
            resolve_scoped_window_placement(
                false,
                true,
                false,
                true,
                false,
                false,
                100,
                110,
            ),
            (ScopedWindowPlacement::Bottom, false)
        );
    }

    #[test]
    fn taskbar_preview_always_demotes_and_disables_input() {
        assert_eq!(
            resolve_scoped_window_placement(
                true,
                false,
                false,
                true,
                false,
                true,
                200,
                100,
            ),
            (ScopedWindowPlacement::Bottom, false)
        );
    }

    #[test]
    fn transparent_controls_remain_interactive_without_the_owner_program() {
        assert_eq!(
            resolve_selective_window_interactivity(
                ScopedWindowPlacement::Behind(300),
                false,
                true,
                false,
            ),
            (ScopedWindowPlacement::Behind(300), true)
        );
        assert_eq!(
            resolve_selective_window_interactivity(
                ScopedWindowPlacement::Behind(300),
                false,
                true,
                true,
            ),
            (ScopedWindowPlacement::Behind(300), false)
        );
    }

    #[test]
    fn unrelated_program_windows_stay_behind_during_repeated_button_focus_changes() {
        // 200 is the working app, 100 its FlowCell button, 300 another app's
        // window. Exercise both transparent Pop/Fan hosts and opaque pages.
        for selective_input in [false, true] {
            for foreground in [200, 100, 200, 100, 200] {
                let (placement, active) = resolve_scoped_window_placement(
                    false,
                    foreground == 100,
                    false,
                    false,
                    false,
                    false,
                    foreground,
                    300,
                );
                let (placement, _) =
                    resolve_selective_window_interactivity(placement, active, selective_input, false);
                assert_eq!(placement, ScopedWindowPlacement::Bottom);
            }
        }
    }

    #[cfg(windows)]
    #[test]
    fn native_inactive_page_never_rises_above_other_monitor_windows() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, GetWindow, SetWindowPos, GW_HWNDNEXT,
            HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
            WS_EX_TOOLWINDOW, WS_POPUP,
        };
        // Hidden disposable HWNDs exercise the production native placement
        // without activating, showing, or changing any user application.
        struct TestWindow(super::HWND);
        impl TestWindow {
            fn new(owner: super::HWND, x: i32) -> Self {
                let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
                let hwnd = unsafe {
                    CreateWindowExW(
                        WS_EX_TOOLWINDOW, class.as_ptr(), class.as_ptr(), WS_POPUP,
                        x, 0, 64, 64, owner, std::ptr::null_mut(),
                        std::ptr::null_mut(), std::ptr::null(),
                    )
                };
                assert!(!hwnd.is_null());
                Self(hwnd)
            }
            fn raise_without_focus(&self) {
                assert_ne!(unsafe {
                    SetWindowPos(self.0, HWND_TOP, 0, 0, 0, 0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER)
                }, 0);
            }
            fn is_above(&self, other: &Self) -> bool {
                let mut next = unsafe { GetWindow(self.0, GW_HWNDNEXT) };
                while !next.is_null() {
                    if next == other.0 { return true; }
                    next = unsafe { GetWindow(next, GW_HWNDNEXT) };
                }
                false
            }
        }
        impl Drop for TestWindow {
            fn drop(&mut self) { unsafe { DestroyWindow(self.0); } }
        }
        for owned in [false, true] {
            let illustrator = TestWindow::new(std::ptr::null_mut(), 2000);
            let page = TestWindow::new(
                if owned { illustrator.0 } else { std::ptr::null_mut() }, 2000);
            let chrome = TestWindow::new(std::ptr::null_mut(), 2000);
            let blender = TestWindow::new(std::ptr::null_mut(), 0);
            let button = TestWindow::new(std::ptr::null_mut(), 0);
            page.raise_without_focus();
            chrome.raise_without_focus();
            assert!(chrome.is_above(&page));
            for foreground in [&blender, &button, &blender, &chrome, &blender] {
                foreground.raise_without_focus();
                let (placement, _) = resolve_scoped_window_placement(
                    false, foreground.0 == button.0, false, false, false, false,
                    foreground.0 as isize, page.0 as isize,
                );
                super::set_scoped_native_hwnd_placement(
                    super::Win32Hwnd(page.0), placement, false).unwrap();
                assert!(chrome.is_above(&page),
                    "inactive page rose above Chrome when another program was clicked (owned={owned})");
            }
            let (placement, _) = resolve_scoped_window_placement(
                true, false, false, true, false, false,
                illustrator.0 as isize, page.0 as isize,
            );
            super::set_scoped_native_hwnd_placement(
                super::Win32Hwnd(page.0), placement, false).unwrap();
            assert!(page.is_above(&chrome), "the matching program must still raise its page");
            assert!(super::is_native_window_topmost(page.0 as isize));
        }
    }

    #[test]
    fn selective_input_never_changes_the_resolved_window_order() {
        for placement in [
            ScopedWindowPlacement::Topmost,
            ScopedWindowPlacement::Normal,
            ScopedWindowPlacement::Behind(200),
            ScopedWindowPlacement::Bottom,
        ] {
            for active in [false, true] {
                for preview in [false, true] {
                    let (resolved, input) =
                        resolve_selective_window_interactivity(placement, active, true, preview);
                    assert_eq!(resolved, placement);
                    assert_eq!(input, active || !preview);
                }
            }
        }
    }

    #[test]
    fn explicit_open_from_flowcell_reveals_in_the_normal_band_only() {
        assert!(continues_explicit_open_reveal(
            true,
            true,
            100,
            110,
            Some(100),
        ));
        assert!(continues_explicit_open_reveal(
            true,
            true,
            110,
            110,
            Some(100),
        ));
        assert!(!continues_explicit_open_reveal(
            true,
            true,
            120,
            110,
            Some(110),
        ));
        assert_eq!(
            resolve_scoped_window_placement(
                false,
                false,
                false,
                false,
                true,
                false,
                100,
                110,
            ),
            (ScopedWindowPlacement::Normal, true)
        );
        assert_eq!(
            resolve_scoped_window_placement(
                false,
                false,
                false,
                false,
                true,
                true,
                100,
                110,
            ),
            (ScopedWindowPlacement::Bottom, false)
        );
        assert_eq!(
            resolve_scoped_window_placement(
                false,
                true,
                true,
                false,
                true,
                false,
                120,
                110,
            ),
            (ScopedWindowPlacement::Behind(120), true)
        );
        assert_eq!(
            resolve_scoped_window_placement(
                false,
                true,
                false,
                false,
                true,
                false,
                120,
                110,
            ),
            (ScopedWindowPlacement::Behind(120), false)
        );
    }

    #[test]
    fn foreground_handle_changes_reapply_without_steady_state_churn() {
        assert!(should_reapply_scoped_window_state(
            false,
            Some(ScopedWindowPlacement::Behind(200)),
            ScopedWindowPlacement::Behind(300),
            Some(200),
            300,
            Some(false),
            false,
            Some(false),
            false,
        ));
        assert!(should_reapply_scoped_window_state(
            false,
            Some(ScopedWindowPlacement::Topmost),
            ScopedWindowPlacement::Topmost,
            Some(200),
            201,
            Some(true),
            true,
            Some(false),
            false,
        ));
        assert!(!should_reapply_scoped_window_state(
            false,
            Some(ScopedWindowPlacement::Behind(300)),
            ScopedWindowPlacement::Behind(300),
            Some(300),
            300,
            Some(false),
            false,
            Some(false),
            false,
        ));
        assert!(should_reapply_scoped_window_state(
            false,
            Some(ScopedWindowPlacement::Behind(300)),
            ScopedWindowPlacement::Behind(300),
            Some(300),
            300,
            Some(false),
            false,
            Some(true),
            true,
        ));
    }
}
