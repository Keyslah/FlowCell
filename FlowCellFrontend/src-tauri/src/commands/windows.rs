use crate::*;

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ForegroundProcessInfo {
    pub(crate) process_name: String,
    pub(crate) process_path: String,
}

#[derive(Serialize, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeInputSnapshot {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) space_down: bool,
    pub(crate) primary_button_down: bool,
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

#[derive(Clone)]
struct ScopedTopmostEntry {
    process_names: Vec<String>,
    bind_owner: bool,
    selective_input: bool,
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
fn read_native_input_snapshot() -> Result<NativeInputSnapshot, String> {
    let mut cursor = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut cursor) } == 0 {
        return Err("Could not read the native cursor position.".to_string());
    }
    let swapped = unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0;
    let primary_button = if swapped { VK_RBUTTON } else { VK_LBUTTON };
    Ok(NativeInputSnapshot {
        x: cursor.x,
        y: cursor.y,
        space_down: (unsafe { GetAsyncKeyState(VK_SPACE as i32) } as u16 & 0x8000) != 0,
        primary_button_down: (unsafe { GetAsyncKeyState(primary_button as i32) } as u16 & 0x8000)
            != 0,
    })
}

#[tauri::command]
pub(crate) fn get_native_input_snapshot() -> Result<NativeInputSnapshot, String> {
    #[cfg(windows)]
    {
        return read_native_input_snapshot();
    }

    #[cfg(not(windows))]
    {
        Err("Native input snapshots are available only on Windows.".to_string())
    }
}

#[cfg(windows)]
pub(crate) fn start_native_input_worker(app: AppHandle) {
    thread::spawn(move || {
        let mut previous_snapshot = None;
        loop {
            if let Ok(snapshot) = read_native_input_snapshot() {
                if previous_snapshot != Some(snapshot) {
                    let _ = app.emit(NATIVE_INPUT_SNAPSHOT_EVENT, snapshot);
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
fn clear_last_external_foreground(registry: &ScopedTopmostRegistry) -> Result<(), String> {
    let mut last_external = registry
        .last_external_foreground
        .lock()
        .map_err(|_| String::from("Scoped topmost external-foreground lock failed."))?;
    *last_external = None;
    Ok(())
}

#[cfg(any(windows, test))]
fn resolve_behind_anchor(
    external_foreground_hwnd: Option<isize>,
    window_hwnd: isize,
    last_external_hwnd: Option<isize>,
) -> Option<isize> {
    [external_foreground_hwnd, last_external_hwnd]
        .into_iter()
        .flatten()
        .find(|candidate| *candidate != 0 && *candidate != window_hwnd)
}

#[cfg(any(windows, test))]
fn resolve_scoped_window_placement(
    matches_target_process: bool,
    foreground_is_scoped_window: bool,
    foreground_scoped_group_matches: bool,
    last_external_matches_target: bool,
    cursor_over_taskbar_or_preview: bool,
    foreground_hwnd: isize,
    window_hwnd: isize,
    external_foreground_hwnd: Option<isize>,
    last_external_hwnd: Option<isize>,
) -> (ScopedWindowPlacement, bool) {
    let behind_anchor =
        resolve_behind_anchor(external_foreground_hwnd, window_hwnd, last_external_hwnd);

    if cursor_over_taskbar_or_preview {
        return (
            behind_anchor
                .map(ScopedWindowPlacement::Behind)
                .unwrap_or(ScopedWindowPlacement::Bottom),
            false,
        );
    }

    if matches_target_process {
        return (ScopedWindowPlacement::Topmost, true);
    }

    // A FlowCell button may become the foreground window while it is being
    // clicked. That is a continuation of the last proven owning application,
    // never a new topmost match. Keep the matching group in the normal band so
    // it remains usable over its owner without floating above other programs.
    if foreground_is_scoped_window && last_external_matches_target {
        if foreground_scoped_group_matches && foreground_hwnd != window_hwnd {
            return (ScopedWindowPlacement::Behind(foreground_hwnd), true);
        }
        return (ScopedWindowPlacement::Normal, true);
    }

    (
        behind_anchor
            .map(ScopedWindowPlacement::Behind)
            .unwrap_or(ScopedWindowPlacement::Bottom),
        false,
    )
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
    let (placement, input_active) = resolve_scoped_window_placement(
        matches_target_process,
        foreground_is_scoped_window,
        foreground_scoped_group_matches,
        last_external_matches_target,
        cursor_over_taskbar_or_preview,
        foreground.hwnd,
        window_hwnd,
        foreground_is_valid_external.then_some(foreground.hwnd),
        last_external_hwnd,
    );
    // Opaque tool pages are ordinary interactive windows, so focusing one is
    // enough to continue in the normal band. Transparent Pop/Fan hosts still
    // require a proven owning-program foreground before they accept input.
    let valid_scoped_continuation =
        foreground_is_scoped_window && (last_external_matches_target || !entry.selective_input);
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

    // Full interactive tool pages always retain normal native input, including
    // when they are behind an unrelated foreground app. Transparent Pop/Fan
    // hosts fail closed while inactive and delegate active hit testing to their
    // selective frontend controller.
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
    // Inactive windows are placed behind the real foreground HWND instead of
    // merely using HWND_NOTOPMOST, which would put them at the top of the normal
    // band and could still cover the newly selected application.
    if should_reapply {
        set_scoped_native_window_placement(window, placement, matches_target_process)?;
    }

    Ok(ScopedWindowStateUpdate {
        placement,
        observed_foreground_hwnd: foreground.hwnd,
        input_active,
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
    window
        .set_always_on_top(false)
        .map_err(|error| error.to_string())?;
    let hwnd = window
        .hwnd()
        .map_err(|error| format!("Failed to resolve window handle: {error}"))?;
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
// Keep every command that waits on `apply_lock` asynchronous. The scoped
// worker holds that lock while Tauri window getters dispatch to the main
// thread; a synchronous IPC command would otherwise block that same thread
// while waiting for the worker, deadlocking re-entrant WebView focus events.
pub(crate) async fn register_scoped_window_topmost(
    label: String,
    program_name: String,
    _bind_owner: Option<bool>,
    selective_input: Option<bool>,
    registry: State<'_, ScopedTopmostRegistry>,
) -> Result<Vec<String>, String> {
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
    entries.insert(
        label,
        ScopedTopmostEntry {
            process_names,
            bind_owner,
            selective_input: selective_input.unwrap_or(false),
            last_placement: None,
            last_observed_foreground_hwnd: None,
            last_input_active: None,
            last_preview_suppressed: None,
            cursor_input_applied: false,
            last_owner_hwnd: None,
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
pub(crate) async fn refresh_scoped_window_topmost(
    app: AppHandle,
    label: String,
    registry: State<'_, ScopedTopmostRegistry>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _apply_guard = registry
            .apply_lock
            .lock()
            .map_err(|_| String::from("Scoped topmost apply lock failed."))?;
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
                entry.last_preview_suppressed = Some(update.preview_suppressed);
                entry.cursor_input_applied = update.cursor_input_applied;
                entry.last_owner_hwnd = update.remembered_owner_hwnd;
            }
        }
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

        if snapshot.is_empty() {
            let _ = clear_last_external_foreground(&registry);
            drop(apply_guard);
            thread::sleep(Duration::from_millis(SCOPED_TOPMOST_POLL_MS));
            continue;
        }

        let foreground = get_foreground_window_state_impl();
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
    use super::{
        clear_last_external_foreground, ForegroundProcessInfo, ForegroundWindowState,
        ScopedTopmostRegistry,
    };
    use super::{
        matches_process_token, resolve_scoped_owner_hwnds, resolve_scoped_window_placement,
        should_reapply_scoped_window_state, NativeInputSnapshot, ScopedWindowPlacement,
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
        })
        .expect("native input snapshot should serialize");

        assert_eq!(
            value,
            serde_json::json!({
                "x": -1920,
                "y": 24,
                "spaceDown": true,
                "primaryButtonDown": false
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
                200,
                100,
                Some(200),
                Some(200),
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
                300,
                100,
                Some(300),
                Some(200),
            ),
            (ScopedWindowPlacement::Behind(300), false)
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
                100,
                100,
                None,
                Some(200),
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
                100,
                100,
                None,
                Some(300),
            ),
            (ScopedWindowPlacement::Behind(300), false)
        );
    }

    #[test]
    fn wrong_scoped_group_anchors_behind_the_real_external_program() {
        assert_eq!(
            resolve_scoped_window_placement(
                false,
                true,
                true,
                false,
                false,
                100,
                101,
                None,
                Some(200),
            ),
            (ScopedWindowPlacement::Behind(200), false)
        );
        assert_eq!(
            resolve_scoped_window_placement(
                false,
                true,
                false,
                true,
                false,
                100,
                110,
                None,
                Some(200),
            ),
            (ScopedWindowPlacement::Normal, true)
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
                true,
                200,
                100,
                Some(200),
                Some(200),
            ),
            (ScopedWindowPlacement::Behind(200), false)
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
