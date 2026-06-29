#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use chrono::{DateTime, Utc};
use image::imageops::FilterType;
use rfd::FileDialog;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::env;
#[cfg(windows)]
use std::ffi::c_void;
use std::fs;
use std::io::{ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use tauri::Manager;
use tauri::{AppHandle, LogicalPosition, LogicalSize, State, WebviewWindow};
#[cfg(windows)]
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
    DWM_WINDOW_CORNER_PREFERENCE,
};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    SetForegroundWindow, ShowWindowAsync, SW_MINIMIZE, SW_RESTORE,
};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SWP_SHOWWINDOW, SW_SHOWNOACTIVATE,
};
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM, POINT};
#[cfg(windows)]
use windows_sys::Win32::System::DataExchange::COPYDATASTRUCT;
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowW, GetAncestor, GetClassNameW, GetCursorPos, GetForegroundWindow,
    GetWindow, GetWindowLongPtrW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
    SendMessageTimeoutW, SetWindowLongPtrW, WindowFromPoint, GA_ROOT,
    GWLP_HWNDPARENT, GW_HWNDNEXT, SMTO_ABORTIFHUNG, WM_COPYDATA,
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const BLENDER_PANEL_ITEM_SUFFIX: &str = ".flowcell-panel-item.json";
const FRONTEND_MACRO_OWNER: &str = "flowcell_frontend";
const FRONTEND_MACRO_SCHEMA_VERSION: &str = "2";
const FRONTEND_MACRO_KIND: &str = "macro";
const FRONTEND_RECORDED_ACTIONS_FOLDER: &str = "recorded_actions";
const TOOLSET_KIND: &str = "toolset";
const ALIGNMENT_TOOL_KIND: &str = "alignment_toolset";
const ILLUSTRATOR_ALIGNMENT_TOOL_KIND: &str = "illustrator_alignment_toolset";
const ILLUSTRATOR_ROTATE_TOOL_KIND: &str = "illustrator_rotate_toolset";
const CORE_ACTION_KIND: &str = "core_action";
const ILLUSTRATOR_SET_ANCHOR_ACTION_ID: &str = "illustrator_set_anchor";
const CORE_ACTIONS_PANEL_NAME: &str = "Actions";
const BOOLEAN_TOOL_KIND: &str = "boolean_toolset";
const DIMENSIONS_TOOL_KIND: &str = "dimensions_toolset";
const REMESH_TOOL_KIND: &str = "remesh_toolset";
const TRI_POLY_TOOL_KIND: &str = "tri_poly_toolset";
const ROTATE_TOOL_KIND: &str = "rotate_toolset";
const SMART_AXIS_TOOL_KIND: &str = "smart_axis_toolset";
const DEFAULT_ALIGNMENT_BRIDGE_ACTION: &str = "alignment_tools";
const DEFAULT_BOOLEAN_BRIDGE_ACTION: &str = "flowcell_custom_boolean";
const DEFAULT_DIMENSIONS_BRIDGE_ACTION: &str = "flowcell_custom_xyz_dimensions";
const DEFAULT_REMESH_BRIDGE_ACTION: &str = "flowcell_custom_remesh";
const DEFAULT_ROTATE_BRIDGE_ACTION: &str = "flowcell_custom_rotate";
const DEFAULT_SMART_AXIS_BRIDGE_ACTION: &str = "smart_axis_lock";
#[cfg(windows)]
const SCOPED_TOPMOST_POLL_MS: u64 = 180;
const DEFAULT_BLENDER_BRIDGE_TIMEOUT_SECONDS: u64 = 20;
const BLENDER_BRIDGE_RESPONSE_POLL_MS: u64 = 4;
const BLENDER_BRIDGE_STATUS_TIMEOUT_MS: u64 = 450;
const BLENDER_BRIDGE_NOT_RUNNING_MESSAGE: &str = "Open Blender first, then run the button again.";
const ORCA_LAUNCHER_CONFIG_FILE_NAME: &str = "orca_launcher.json";
const CURA_LAUNCHER_CONFIG_FILE_NAME: &str = "cura_launcher.json";
const FLOWCELL_CONTROLLER_SCRIPT_TIMEOUT_SECONDS: u64 = 25;
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_RECEIVER_TITLE: &str = "FlowCellBackendDirectScriptReceiver";
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_RECEIVER_CLASS: &str = "AutoHotkeyGUI";
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_COPYDATA_ID: usize = 0x4643_5344;
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_ACCEPTED: usize = 1;
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_BUSY: usize = 2;
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_BAD_PAYLOAD: usize = 3;
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_BAD_SCRIPT: usize = 4;
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_SEND_TIMEOUT_MS: u32 = 160;
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_STARTUP_WAIT_MS: u64 = 3500;
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_RECEIVER_POLL_MS: u64 = 40;
const ILLUSTRATOR_ALIGNMENT_ACTIONS_ENABLED: bool = true;
const CODEX_SESSION_SCAN_LIMIT: usize = 96;
const CODEX_SESSION_TAIL_BYTES: u64 = 8_388_608;
const CODEX_USAGE_WEEKLY_BASELINE_TOLERANCE_PERCENT: f64 = 0.5;

static BLENDER_BRIDGE_REQUEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static ILLUSTRATOR_ROTATE_ACTION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PanelScriptChildRecord {
    slot: String,
    label: String,
    tooltip: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PanelScriptFileRecord {
    file_name: String,
    label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tooltip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    execution_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bridge_action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bridge_data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<PanelScriptChildRecord>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    macro_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OrganizationLooseFileInfo {
    path: String,
    file_name: String,
    extension: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OrganizationProjectScan {
    project_root: String,
    folders: Vec<String>,
    loose_files: Vec<OrganizationLooseFileInfo>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct BlenderPanelItemRecord {
    label: String,
    tooltip: String,
    kind: String,
    source_path: String,
    #[serde(default)]
    execution_target: String,
    #[serde(default)]
    bridge_action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    bridge_data: Option<Value>,
    #[serde(default)]
    children: Vec<PanelScriptChildRecord>,
    #[serde(default)]
    macro_id: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct SampledPhotoThemeColors {
    headers_hex: String,
    text_hex: String,
    scene_hex: String,
    controls_hex: String,
    misc_hex: String,
    highlights_hex: String,
    palette_hexes: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct SavedBlenderThemeFile {
    format: String,
    saved_at: String,
    values: Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SampleRgb {
    r: u8,
    g: u8,
    b: u8,
}

#[derive(Default)]
struct ColorBucketStats {
    count: u32,
    r_sum: u64,
    g_sum: u64,
    b_sum: u64,
}

#[derive(Clone, Copy)]
struct PaletteCandidate {
    color: SampleRgb,
    count: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct BlenderInstallResultItem {
    source: String,
    installed: bool,
    action: Option<String>,
    label: Option<String>,
    tooltip: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct BlenderInstallResult {
    #[allow(dead_code)]
    installed_count: Option<u64>,
    #[allow(dead_code)]
    failed_count: Option<u64>,
    #[allow(dead_code)]
    status_message: Option<String>,
    #[allow(dead_code)]
    reload_required: Option<bool>,
    #[allow(dead_code)]
    reload_reason: Option<String>,
    results: Vec<BlenderInstallResultItem>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BlenderAutomationConfig {
    #[serde(default)]
    bridge_folder: String,
    response_timeout_seconds: Option<u64>,
    #[serde(default)]
    custom_actions_file_name: String,
    #[serde(default)]
    addon_actions_file_name: String,
    #[serde(default)]
    addon_bridge_file_name: String,
    #[serde(default)]
    addon_display_name: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BlenderBridgeConfigFile {
    #[serde(default)]
    automation: BlenderAutomationConfig,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SlicerLauncherConfig {
    executable: String,
}

#[derive(Clone, Copy)]
struct SlicerLauncherSpec {
    id: &'static str,
    display_name: &'static str,
    executable_label: &'static str,
    config_file_name: Option<&'static str>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DetectedSlicerExecutable {
    executable_path: String,
    display_name: String,
    source: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct InstalledSlicerRegistryEntry {
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    display_icon: String,
    #[serde(default)]
    install_location: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct InstalledSlicerRegistryResponse {
    #[serde(default)]
    entries: Vec<InstalledSlicerRegistryEntry>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SlicerChoiceDialogChoice {
    display_name: String,
    executable_path: String,
    source: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SlicerChoiceDialogResult {
    kind: String,
    executable_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
struct LayoutSnapshotBounds {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "kebab-case")]
enum LayoutSnapshotWindowKind {
    FlattenRevolveToolbox,
    GenericToolbox,
    DimensionsToolbox,
    ThemeToolbox,
    RotateToolbox,
    AlignmentToolbox,
    BooleanToolbox,
    RemeshToolbox,
    SmartAxisToolbox,
    TriPolyToolbox,
    PanelFan,
    PanelFanOptions,
    ScriptGroupPopout,
    CodexUsagePopout,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase")]
struct LayoutSnapshotWindow {
    kind: LayoutSnapshotWindowKind,
    program_name: Option<String>,
    panel_name: Option<String>,
    file_name: Option<String>,
    label: Option<String>,
    selected_file_names: Option<Vec<String>>,
    bounds: LayoutSnapshotBounds,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostWindowBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "PascalCase")]
struct LayoutSnapshotFile {
    saved_at: Option<String>,
    version: Option<u64>,
    layout_kind: Option<String>,
    flow_cell_state_path: Option<String>,
    selected_program_name: Option<String>,
    selected_panel_name: Option<String>,
    selected_file_names: Option<Vec<String>>,
    main_window_bounds: Option<LayoutSnapshotBounds>,
    windows: Option<Vec<LayoutSnapshotWindow>>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct FlowCellWindowToggleState {
    saved_at: String,
    windows: Vec<FlowCellWindowToggleStateEntry>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct FlowCellWindowToggleStateEntry {
    label: Option<String>,
    handle: Option<String>,
    title: Option<String>,
}

#[cfg(windows)]
#[derive(Clone)]
struct FlowCellNativeWindowRecord {
    label: String,
    handle_key: String,
    title: String,
    hwnd: windows::Win32::Foundation::HWND,
    is_main: bool,
    is_minimized: bool,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct ForegroundProcessInfo {
    process_name: String,
    process_path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CreateProgramFolderResult {
    program_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    status_message: Option<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct FrontendScriptBindingRecord {
    id: Option<u64>,
    binding_id: Option<u64>,
    kind: Option<String>,
    label: Option<String>,
    status: Option<String>,
    program_tab_id: Option<i64>,
    shortcut: String,
    target: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct FrontendBindingsState {
    next_id: Option<u64>,
    script_bindings: Vec<FrontendScriptBindingRecord>,
    action_hotkeys: HashMap<String, String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct BindableButtonRecord {
    id: String,
    label: String,
    kind: String,
    target: String,
    execution_target: Option<String>,
    binding_id: Option<u64>,
    shortcut: Option<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct BindablePanelRecord {
    name: String,
    buttons: Vec<BindableButtonRecord>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct BindableProgramRecord {
    name: String,
    program_tab_id: i64,
    panels: Vec<BindablePanelRecord>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct ShortcutProfileEntry {
    shortcut: String,
    #[serde(default)]
    display: String,
    #[serde(default)]
    reason: String,
    #[serde(default)]
    source: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct ShortcutProfileFile {
    #[serde(default)]
    id: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    platform: String,
    #[serde(default)]
    process_names: Vec<String>,
    #[serde(default)]
    blocked: Vec<ShortcutProfileEntry>,
    #[serde(default)]
    reserved: Vec<ShortcutProfileEntry>,
    #[serde(default)]
    preferred: Vec<String>,
    #[serde(default)]
    notes: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct ShortcutProfileDocumentRecord {
    file_name: String,
    profile_id: String,
    is_local_override: bool,
    profile: ShortcutProfileFile,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct BindsWorkspaceResponse {
    programs: Vec<BindableProgramRecord>,
    macros: Vec<FrontendMacroSummaryRecord>,
    bindings: FrontendBindingsState,
    shortcut_profiles: Vec<ShortcutProfileDocumentRecord>,
    warnings: Vec<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "PascalCase")]
struct FlowCellCommandBackendResult {
    succeeded: bool,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveBindShortcutRequest {
    program_name: String,
    program_tab_id: i64,
    target: String,
    binding_id: Option<u64>,
    shortcut: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveCoreActionShortcutRequest {
    action_id: String,
    shortcut: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct SaveBindShortcutResponse {
    message: String,
    bindings: FrontendBindingsState,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct FrontendMacroStepRecord {
    id: String,
    #[serde(rename = "type")]
    step_type: String,
    delay_ms: i64,
    x: Option<i64>,
    y: Option<i64>,
    button: Option<String>,
    count: Option<i64>,
    direction: Option<String>,
    text: Option<String>,
    keys: Option<String>,
    target: Option<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct FrontendMacroSummaryRecord {
    id: String,
    label: String,
    program_name: String,
    panel_name: String,
    file_name: String,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct FrontendMacroDocumentRecord {
    id: String,
    label: String,
    program_name: String,
    panel_name: String,
    file_name: String,
    created_at: String,
    updated_at: String,
    steps: Vec<FrontendMacroStepRecord>,
    shortcut: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SaveFrontendMacroRequest {
    current_id: Option<String>,
    program_name: String,
    panel_name: String,
    label: String,
    steps: Vec<FrontendMacroStepRecord>,
    force_new_id: Option<bool>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RecordFrontendMacroRequest {
    current_id: Option<String>,
    program_name: String,
    panel_name: String,
    label: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LoadFrontendMacroFromPathRequest {
    path: String,
    fallback_program_name: String,
    fallback_panel_name: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SaveMacroShortcutRequest {
    action_id: String,
    shortcut: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct SaveMacroShortcutResponse {
    message: String,
    bindings: FrontendBindingsState,
}

#[derive(Serialize, Clone, Copy, Default)]
#[serde(rename_all = "camelCase")]
struct CursorPositionRecord {
    x: i32,
    y: i32,
}

#[derive(Clone, Default)]
struct ParsedFrontendMacroDefinition {
    id: String,
    label: String,
    program_name: String,
    panel_name: String,
    file_name: String,
    created_at: String,
    updated_at: String,
    steps: Vec<FrontendMacroStepRecord>,
}

#[derive(Clone, Default)]
struct ScopedTopmostRegistry {
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

fn resolve_program_process_names(program_name: &str) -> Vec<String> {
    let normalized_program_name = normalize_process_token(program_name);
    if normalized_program_name.is_empty() {
        return Vec::new();
    }

    let mut names = HashSet::new();
    names.insert(normalized_program_name.clone());

    if normalized_program_name.contains("blender") {
        names.insert(String::from("blender"));
        names.insert(String::from("blender-launcher"));
    }
    if normalized_program_name.contains("illustrator") {
        names.insert(String::from("illustrator"));
    }
    if normalized_program_name.contains("photoshop") {
        names.insert(String::from("photoshop"));
    }
    if normalized_program_name.contains("windows") {
        names.insert(String::from("explorer"));
    }

    let mut resolved = names.into_iter().collect::<Vec<_>>();
    resolved.sort();
    resolved
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
    root.join("FlowCell")
        .join("helpers")
        .join("Start-FlowCellFrontend.ps1")
}

fn resolve_frontend_launcher_path() -> Option<PathBuf> {
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

fn resolve_powershell_path() -> PathBuf {
    if let Ok(system_root) = std::env::var("SystemRoot") {
        let candidate = PathBuf::from(system_root)
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe");
        if candidate.is_file() {
            return candidate;
        }
    }

    PathBuf::from("powershell.exe")
}

#[cfg(windows)]
fn powershell_single_quoted_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn resolve_repo_root() -> Option<PathBuf> {
    let launcher_path = resolve_frontend_launcher_path()?;
    launcher_path
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
}

fn resolve_programs_root() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root().ok_or_else(|| {
        "FlowCell repo root could not be resolved for program folders.".to_string()
    })?;
    let programs_root = repo_root.join("Programs");
    if programs_root.is_dir() {
        Ok(programs_root)
    } else {
        Err(format!(
            "Programs folder was not found at {}.",
            programs_root.display()
        ))
    }
}

fn validate_folder_name(raw_name: &str, kind: &str) -> Result<String, String> {
    let name = raw_name.trim();
    if name.is_empty() {
        return Err(format!("{kind} name cannot be empty."));
    }

    if matches!(name, "." | "..") {
        return Err(format!("{kind} name is not valid."));
    }

    if name.ends_with(' ') || name.ends_with('.') {
        return Err(format!("{kind} name cannot end with a space or period."));
    }

    if name.chars().any(|character| {
        character.is_control()
            || matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
    }) {
        return Err(format!("{kind} name contains invalid filename characters."));
    }

    Ok(name.to_string())
}

fn list_child_directory_names(parent: &Path) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    let entries = fs::read_dir(parent)
        .map_err(|error| format!("Failed to read {}: {error}", parent.display()))?;

    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Failed to read {}: {error}", parent.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;

        if !file_type.is_dir() {
            continue;
        }

        names.push(entry.file_name().to_string_lossy().to_string());
    }

    names.sort_by_cached_key(|name| name.to_ascii_lowercase());
    Ok(names)
}

fn find_named_child_directory(parent: &Path, name: &str) -> Result<Option<PathBuf>, String> {
    let entries = fs::read_dir(parent)
        .map_err(|error| format!("Failed to read {}: {error}", parent.display()))?;

    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Failed to read {}: {error}", parent.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;

        if !file_type.is_dir() {
            continue;
        }

        let candidate_name = entry.file_name().to_string_lossy().to_string();
        if candidate_name.eq_ignore_ascii_case(name) {
            return Ok(Some(entry.path()));
        }
    }

    Ok(None)
}

fn paths_refer_to_same_existing_entry(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }

    let Ok(left_canonical) = fs::canonicalize(left) else {
        return false;
    };
    let Ok(right_canonical) = fs::canonicalize(right) else {
        return false;
    };

    if left_canonical == right_canonical {
        return true;
    }

    left_canonical
        .to_string_lossy()
        .eq_ignore_ascii_case(right_canonical.to_string_lossy().as_ref())
}

fn unique_temporary_rename_path(parent: &Path, kind: &str) -> Result<PathBuf, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let normalized_kind = kind.trim().to_ascii_lowercase();

    for attempt in 0..100 {
        let candidate = parent.join(format!(
            ".flowcell-{}-rename-{}-{}",
            normalized_kind, stamp, attempt
        ));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "Could not find a temporary folder name in {}.",
        parent.display()
    ))
}

fn rename_directory_path(
    current_path: &Path,
    target_path: &Path,
    final_name: &str,
    kind: &str,
) -> Result<(), String> {
    let current_name = current_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();

    if current_name == final_name {
        return Ok(());
    }

    if current_name.eq_ignore_ascii_case(final_name) {
        let parent = current_path.parent().ok_or_else(|| {
            format!(
                "{} folder parent could not be resolved for {}.",
                kind,
                current_path.display()
            )
        })?;
        let temporary_path = unique_temporary_rename_path(parent, kind)?;
        fs::rename(current_path, &temporary_path).map_err(|error| {
            format!(
                "Failed to prepare {} for case-only rename at {}: {error}",
                kind.to_ascii_lowercase(),
                current_path.display()
            )
        })?;
        if let Err(error) = fs::rename(&temporary_path, target_path) {
            let _ = fs::rename(&temporary_path, current_path);
            return Err(format!(
                "Failed to rename {} folder to '{}': {error}",
                kind.to_ascii_lowercase(),
                final_name
            ));
        }
        return Ok(());
    }

    fs::rename(current_path, target_path).map_err(|error| {
        format!(
            "Failed to rename {} folder '{}' to '{}': {error}",
            kind.to_ascii_lowercase(),
            current_name,
            final_name
        )
    })
}

fn rename_child_directory(
    parent: &Path,
    current_name: &str,
    next_name: &str,
    kind: &str,
) -> Result<String, String> {
    let current_name = validate_folder_name(current_name, kind)?;
    let next_name = validate_folder_name(next_name, kind)?;
    let current_path = find_named_child_directory(parent, &current_name)?.ok_or_else(|| {
        format!(
            "{} folder '{}' was not found in {}.",
            kind,
            current_name,
            parent.display()
        )
    })?;

    if let Some(existing_target_path) = find_named_child_directory(parent, &next_name)? {
        if !paths_refer_to_same_existing_entry(&existing_target_path, &current_path) {
            return Err(format!("{} folder '{}' already exists.", kind, next_name));
        }
    }

    let target_path = parent.join(&next_name);
    rename_directory_path(&current_path, &target_path, &next_name, kind)?;
    Ok(next_name)
}

fn resolve_program_directory(program_name: &str) -> Result<PathBuf, String> {
    let normalized_name = validate_folder_name(program_name, "Program")?;
    let programs_root = resolve_programs_root()?;
    find_named_child_directory(&programs_root, &normalized_name)?.ok_or_else(|| {
        format!(
            "Program folder '{}' was not found in {}.",
            normalized_name,
            programs_root.display()
        )
    })
}

fn find_panels_root(program_directory: &Path) -> Result<Option<PathBuf>, String> {
    if let Some(panels_root) = find_named_child_directory(program_directory, "Panels")? {
        return Ok(Some(panels_root));
    }

    Ok(None)
}

fn resolve_panels_root(
    program_name: &str,
    create_if_missing: bool,
) -> Result<Option<PathBuf>, String> {
    let program_directory = resolve_program_directory(program_name)?;

    if let Some(panels_root) = find_panels_root(&program_directory)? {
        return Ok(Some(panels_root));
    }

    if !create_if_missing {
        return Ok(None);
    }

    let panels_root = program_directory.join("Panels");
    fs::create_dir_all(&panels_root)
        .map_err(|error| format!("Failed to create {}: {error}", panels_root.display()))?;
    Ok(Some(panels_root))
}

fn resolve_panel_directory(program_name: &str, panel_name: &str) -> Result<PathBuf, String> {
    let normalized_panel_name = validate_folder_name(panel_name, "Panel")?;
    let panels_root = resolve_panels_root(program_name, false)?.ok_or_else(|| {
        format!(
            "Panels folder for '{}' could not be resolved.",
            program_name
        )
    })?;

    find_named_child_directory(&panels_root, &normalized_panel_name)?.ok_or_else(|| {
        format!(
            "Panel folder '{}' was not found in {}.",
            normalized_panel_name,
            panels_root.display()
        )
    })
}

fn is_windows_program_name(program_name: &str) -> bool {
    program_name.eq_ignore_ascii_case("windows")
}

fn is_blender_program_name(program_name: &str) -> bool {
    infer_program_template_key(program_name, None) == "blender"
}

fn is_illustrator_program_name(program_name: &str) -> bool {
    infer_program_template_key(program_name, None) == "illustrator"
}

fn is_photoshop_program_name(program_name: &str) -> bool {
    infer_program_template_key(program_name, None) == "photoshop"
}

fn is_adobe_program_name(program_name: &str) -> bool {
    is_illustrator_program_name(program_name) || is_photoshop_program_name(program_name)
}

fn infer_program_template_key(program_name: &str, exe_path: Option<&str>) -> &'static str {
    let normalized_program_name = program_name.trim().to_ascii_lowercase();
    let exe_name = exe_path
        .and_then(|value| {
            Path::new(value.trim())
                .file_name()
                .and_then(|name| name.to_str())
        })
        .unwrap_or("")
        .to_ascii_lowercase();

    if normalized_program_name.contains("blender") || exe_name.contains("blender") {
        return "blender";
    }
    if normalized_program_name.contains("illustrator") || exe_name.contains("illustrator") {
        return "illustrator";
    }
    if normalized_program_name.contains("photoshop") || exe_name.contains("photoshop") {
        return "photoshop";
    }
    if normalized_program_name.contains("windows") || exe_name.contains("explorer") {
        return "windows";
    }

    "generic"
}

fn allowed_windows_script_extensions() -> &'static [&'static str] {
    &["ps1", "cmd", "bat", "exe", "lnk", "vbs", "ahk"]
}

fn allowed_generic_script_extensions() -> &'static [&'static str] {
    &[
        "ps1", "cmd", "bat", "exe", "lnk", "vbs", "ahk", "jsx", "js", "py",
    ]
}

fn allowed_adobe_script_extensions() -> &'static [&'static str] {
    &["jsx", "js"]
}

fn is_allowed_windows_script_path(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };

    allowed_windows_script_extensions()
        .iter()
        .any(|allowed| extension.eq_ignore_ascii_case(allowed))
}

fn is_allowed_generic_script_path(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };

    allowed_generic_script_extensions()
        .iter()
        .any(|allowed| extension.eq_ignore_ascii_case(allowed))
}

fn is_allowed_adobe_script_path(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };

    allowed_adobe_script_extensions()
        .iter()
        .any(|allowed| extension.eq_ignore_ascii_case(allowed))
}

fn allowed_blender_script_extensions() -> &'static [&'static str] {
    &["py"]
}

fn is_allowed_blender_script_path(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };

    allowed_blender_script_extensions()
        .iter()
        .any(|allowed| extension.eq_ignore_ascii_case(allowed))
}

fn validate_panel_script_file_name(raw_name: &str) -> Result<String, String> {
    let trimmed_name = raw_name.trim();
    if trimmed_name.is_empty() {
        return Err("Script file name cannot be empty.".to_string());
    }

    let path = Path::new(trimmed_name);
    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return Err("Script file name is not valid.".to_string());
    };

    if file_name != trimmed_name {
        return Err("Script file name must not include folder separators.".to_string());
    }

    Ok(file_name.to_string())
}

fn format_panel_script_label(file_name: &str) -> String {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name)
        .trim();
    if stem.is_empty() {
        return file_name.to_string();
    }

    let mut label = stem.to_string();
    let lower_label = label.to_ascii_lowercase();
    for prefix in ["file_", "util_", "org_"] {
        if lower_label.starts_with(prefix) && label.len() > prefix.len() {
            label = label[prefix.len()..].to_string();
            break;
        }
    }

    let normalized = label.replace('_', " ").replace('-', " ").trim().to_string();
    if normalized.is_empty() {
        file_name.to_string()
    } else {
        normalized
    }
}

fn description_comment_prefix(path: &Path) -> Option<&'static str> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();

    if ["ps1", "py"]
        .iter()
        .any(|candidate| extension.eq_ignore_ascii_case(candidate))
    {
        return Some("#");
    }

    if extension.eq_ignore_ascii_case("ahk") {
        return Some(";");
    }

    if ["js", "jsx"]
        .iter()
        .any(|candidate| extension.eq_ignore_ascii_case(candidate))
    {
        return Some("//");
    }

    if ["cmd", "bat"]
        .iter()
        .any(|candidate| extension.eq_ignore_ascii_case(candidate))
    {
        return Some("REM");
    }

    if extension.eq_ignore_ascii_case("vbs") {
        return Some("'");
    }

    None
}

fn description_comment_line(prefix: &str, description: &str) -> String {
    if prefix.eq_ignore_ascii_case("REM") {
        format!("REM Description: {}", description.trim())
    } else if prefix == "'" {
        format!("' Description: {}", description.trim())
    } else if prefix == ";" {
        format!("; Description: {}", description.trim())
    } else {
        format!("{prefix} Description: {}", description.trim())
    }
}

fn strip_case_insensitive_prefix<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    if value.len() < prefix.len() {
        return None;
    }

    let candidate = value.get(..prefix.len())?;
    if candidate.eq_ignore_ascii_case(prefix) {
        Some(&value[prefix.len()..])
    } else {
        None
    }
}

fn parse_description_comment(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    let rest = if let Some(rest) = trimmed.strip_prefix('#') {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("//") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix(';') {
        rest
    } else if let Some(rest) = trimmed.strip_prefix('\'') {
        rest
    } else if let Some(rest) = strip_case_insensitive_prefix(trimmed, "REM") {
        let Some(first_character) = rest.chars().next() else {
            return None;
        };
        if !first_character.is_whitespace() {
            return None;
        }
        rest
    } else {
        return None;
    };

    let rest = rest.trim_start();
    let rest = strip_case_insensitive_prefix(rest, "Description")?;
    let rest = rest.trim_start();
    let rest = rest.strip_prefix(':')?;
    Some(rest.trim().to_string())
}

fn parse_supported_comment_body(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    if let Some(rest) = trimmed.strip_prefix('#') {
        Some(rest)
    } else if let Some(rest) = trimmed.strip_prefix("//") {
        Some(rest)
    } else if let Some(rest) = trimmed.strip_prefix(';') {
        Some(rest)
    } else if let Some(rest) = trimmed.strip_prefix('\'') {
        Some(rest)
    } else if let Some(rest) = strip_case_insensitive_prefix(trimmed, "REM") {
        let first_character = rest.chars().next()?;
        if first_character.is_whitespace() {
            Some(rest)
        } else {
            None
        }
    } else {
        None
    }
}

fn parse_flowcell_directive_value<'a>(line: &'a str, directive: &str) -> Option<&'a str> {
    let body = parse_supported_comment_body(line)?.trim_start();
    let rest = strip_case_insensitive_prefix(body, directive)?;
    let rest = rest.trim_start();
    let rest = rest.strip_prefix(':')?;
    Some(rest.trim())
}

fn is_supported_header_comment(line: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed.starts_with('#')
        || trimmed.starts_with("//")
        || trimmed.starts_with(';')
        || trimmed.starts_with('\'')
        || strip_case_insensitive_prefix(trimmed, "REM")
            .and_then(|rest| rest.chars().next())
            .map(|character| character.is_whitespace())
            .unwrap_or(false)
}

fn read_top_description(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;

    for (index, line) in content.lines().enumerate() {
        if index == 0 && line.starts_with("#!") {
            continue;
        }

        if let Some(description) = parse_description_comment(line) {
            return Some(description);
        }

        let trimmed = line.trim();
        if trimmed.is_empty() || is_supported_header_comment(line) {
            continue;
        }

        break;
    }

    None
}

fn set_top_description(path: &Path, description: &str) -> Result<bool, String> {
    let prefix = description_comment_prefix(path).ok_or_else(|| {
        format!(
            "Descriptions can only be written for supported text script files, not {}.",
            path.display()
        )
    })?;
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let newline = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let lines = content.lines().map(ToString::to_string).collect::<Vec<_>>();

    let mut line_index = 0usize;
    let shebang = if lines
        .first()
        .map(|line| line.starts_with("#!"))
        .unwrap_or(false)
    {
        line_index = 1;
        lines.first().cloned()
    } else {
        None
    };

    let mut leading_header = Vec::new();
    while line_index < lines.len() {
        let current_line = &lines[line_index];
        if current_line.trim().is_empty() || is_supported_header_comment(current_line) {
            if parse_description_comment(current_line).is_none() {
                leading_header.push(current_line.clone());
            }
            line_index += 1;
            continue;
        }
        break;
    }

    while leading_header
        .last()
        .map(|line| line.trim().is_empty())
        .unwrap_or(false)
    {
        leading_header.pop();
    }

    let body_lines = if line_index < lines.len() {
        lines[line_index..].to_vec()
    } else {
        Vec::new()
    };

    let mut next_lines = Vec::new();
    if let Some(shebang) = shebang {
        next_lines.push(shebang);
    }
    next_lines.push(description_comment_line(prefix, description));
    next_lines.push(String::new());
    next_lines.extend(leading_header.iter().cloned());
    if !leading_header.is_empty()
        && !body_lines.is_empty()
        && leading_header
            .last()
            .map(|line| !line.trim().is_empty())
            .unwrap_or(false)
    {
        next_lines.push(String::new());
    }
    next_lines.extend(body_lines);

    let next_content = format!("{}{}", next_lines.join(newline), newline);
    if next_content == content {
        return Ok(false);
    }

    fs::write(path, next_content)
        .map_err(|error| format!("Failed to write {}: {error}", path.display()))?;
    Ok(true)
}

fn try_set_description_at_path(path_value: &str, description: &str) -> Result<(), String> {
    let trimmed_path = path_value.trim();
    if trimmed_path.is_empty() {
        return Ok(());
    }

    let path = PathBuf::from(trimmed_path);
    if !path.is_file() || description_comment_prefix(&path).is_none() {
        return Ok(());
    }

    set_top_description(&path, description).map(|_| ())
}

fn resolve_flowcell_local_debug_root() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root()
        .ok_or_else(|| "FlowCell repo root could not be resolved for debug dumps.".to_string())?;
    Ok(repo_root.join("FlowCell").join("local").join("debug"))
}

fn resolve_flowcell_local_root() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root()
        .ok_or_else(|| "FlowCell repo root could not be resolved for local data.".to_string())?;
    Ok(repo_root.join("FlowCell").join("local"))
}

fn resolve_flowcell_config_root() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root()
        .ok_or_else(|| "FlowCell repo root could not be resolved for config data.".to_string())?;
    Ok(repo_root.join("FlowCell").join("config"))
}

fn resolve_shortcut_profiles_config_root() -> Result<PathBuf, String> {
    Ok(resolve_flowcell_config_root()?.join("shortcut_profiles"))
}

fn resolve_shortcut_profiles_local_root() -> Result<PathBuf, String> {
    Ok(resolve_flowcell_local_root()?.join("shortcut_profiles"))
}

fn canonical_program_tab_id(program_name: &str) -> i64 {
    match infer_program_template_key(program_name, None) {
        "illustrator" => 1,
        "windows" => 2,
        "blender" => 3,
        "photoshop" => 4,
        _ => 0,
    }
}

fn resolve_program_tab_id(program_name: &str) -> i64 {
    let registered_id = resolve_bindings_file_path()
        .ok()
        .filter(|path| path.is_file())
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|contents| parse_ini_document(&contents))
        .and_then(|document| {
            find_registered_program(&document, program_name).map(|program| program.id)
        });
    registered_id.unwrap_or_else(|| canonical_program_tab_id(program_name))
}

fn resolve_shortcut_profile_id_from_file_name(file_name: &str) -> Option<String> {
    let normalized = file_name.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "windows.json" | "windows.user.json" => Some(String::from("windows")),
        "flowcell.json" | "flowcell.user.json" => Some(String::from("flowcell")),
        "adobe.photoshop.windows.json" | "photoshop.user.json" => {
            Some(String::from("adobe.photoshop.windows"))
        }
        "adobe.illustrator.windows.json" | "illustrator.user.json" => {
            Some(String::from("adobe.illustrator.windows"))
        }
        "blender.windows.json" | "blender.user.json" => Some(String::from("blender.windows")),
        _ => None,
    }
}

fn program_scripts_folder_name(program_name: &str, bucket_name: &str) -> Result<String, String> {
    let normalized_program_name = validate_folder_name(program_name, "Program")?;
    Ok(format!("{normalized_program_name} {bucket_name} Scripts"))
}

fn resolve_program_git_scripts_directory(program_name: &str) -> Result<PathBuf, String> {
    let program_directory = resolve_program_directory(program_name)?;
    let folder_name = program_scripts_folder_name(program_name, "Git")?;
    Ok(program_directory.join(folder_name))
}

fn resolve_program_git_scripts_picker_directory(
    program_name: &str,
    panel_name: &str,
) -> Result<PathBuf, String> {
    let scripts_directory = resolve_program_git_scripts_directory(program_name)?;
    if !scripts_directory.is_dir() {
        return Err(format!(
            "Program Git Scripts folder was not found at {}.",
            scripts_directory.display()
        ));
    }
    if panel_name.trim().is_empty() {
        return Ok(scripts_directory);
    }

    let panel_directory = scripts_directory.join(panel_name.trim());
    if panel_directory.is_dir() {
        Ok(panel_directory)
    } else {
        Ok(scripts_directory)
    }
}

fn resolve_program_local_scripts_directory(program_name: &str) -> Result<PathBuf, String> {
    let program_directory = resolve_program_directory(program_name)?;
    let folder_name = program_scripts_folder_name(program_name, "Local")?;
    Ok(program_directory.join(folder_name))
}

fn resolve_legacy_windows_binding_path(raw_path: &str) -> String {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let normalized = trimmed.replace('/', "\\");
    let Some(repo_root) = resolve_repo_root() else {
        return normalized;
    };

    let legacy_root = repo_root
        .join("Windows")
        .to_string_lossy()
        .replace('/', "\\");
    let managed_root = repo_root
        .join("Programs")
        .join("Windows")
        .to_string_lossy()
        .replace('/', "\\");
    let normalized_lower = normalized.to_ascii_lowercase();
    let legacy_lower = legacy_root.to_ascii_lowercase();
    if normalized_lower == legacy_lower {
        return managed_root;
    }
    if let Some(rest) = normalized.strip_prefix(&(legacy_root.clone() + "\\")) {
        return format!("{managed_root}\\{rest}");
    }

    normalized
}

fn normalize_binding_target_for_compare(raw_path: &str) -> String {
    let resolved = resolve_legacy_windows_binding_path(raw_path);
    let candidate = PathBuf::from(&resolved);
    if candidate.exists() {
        return normalize_path_for_compare(&candidate);
    }

    resolved.to_ascii_lowercase()
}

fn write_last_action_status_message(message: &str) {
    let Ok(local_root) = resolve_flowcell_local_root() else {
        return;
    };
    let status_path = local_root.join("logs").join("last_action_status.txt");
    if let Some(parent) = status_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(status_path, message);
}

fn are_names_equal(left: &str, right: &str) -> bool {
    left.trim().eq_ignore_ascii_case(right.trim())
}

fn is_flowcell_window_toggle_launcher(
    program_name: &str,
    panel_name: &str,
    file_name: &str,
) -> bool {
    are_names_equal(program_name, "Windows")
        && are_names_equal(panel_name, "Utility")
        && file_name
            .trim()
            .eq_ignore_ascii_case("toggle_flowcell_windows.ps1")
}

fn flowcell_window_toggle_state_path() -> Result<PathBuf, String> {
    Ok(resolve_flowcell_local_root()?
        .join("windows")
        .join("flowcell_window_toggle_state.json"))
}

fn clear_flowcell_window_toggle_state() -> Result<(), String> {
    let state_path = flowcell_window_toggle_state_path()?;
    if let Some(parent) = state_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create FlowCell window state folder at {}: {error}",
                parent.display()
            )
        })?;
    }

    let state = FlowCellWindowToggleState {
        saved_at: String::new(),
        windows: Vec::new(),
    };
    let contents = serde_json::to_string_pretty(&state)
        .map_err(|error| format!("Failed to serialize FlowCell window toggle state: {error}"))?;
    fs::write(&state_path, contents).map_err(|error| {
        format!(
            "Failed to write FlowCell window toggle state at {}: {error}",
            state_path.display()
        )
    })
}

fn read_flowcell_window_toggle_state() -> Option<FlowCellWindowToggleState> {
    let state_path = flowcell_window_toggle_state_path().ok()?;
    let raw = fs::read_to_string(state_path).ok()?;
    if raw.trim().is_empty() {
        return None;
    }

    serde_json::from_str(&raw).ok()
}

#[cfg(windows)]
fn write_flowcell_window_toggle_state(
    windows: &[FlowCellNativeWindowRecord],
) -> Result<(), String> {
    let state_path = flowcell_window_toggle_state_path()?;
    if let Some(parent) = state_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create FlowCell window state folder at {}: {error}",
                parent.display()
            )
        })?;
    }

    let state = FlowCellWindowToggleState {
        saved_at: Utc::now().to_rfc3339(),
        windows: windows
            .iter()
            .map(|window| FlowCellWindowToggleStateEntry {
                label: Some(window.label.clone()),
                handle: Some(window.handle_key.clone()),
                title: Some(window.title.clone()),
            })
            .collect(),
    };
    let contents = serde_json::to_string_pretty(&state)
        .map_err(|error| format!("Failed to serialize FlowCell window toggle state: {error}"))?;
    fs::write(&state_path, contents).map_err(|error| {
        format!(
            "Failed to write FlowCell window toggle state at {}: {error}",
            state_path.display()
        )
    })
}

#[cfg(windows)]
fn collect_flowcell_native_windows(app: &AppHandle) -> Vec<FlowCellNativeWindowRecord> {
    let mut windows = Vec::new();
    for (label, window) in app.webview_windows() {
        let Ok(hwnd) = window.hwnd() else {
            continue;
        };
        let is_visible = unsafe { IsWindowVisible(hwnd.0 as _) != 0 };
        let is_minimized = unsafe { IsIconic(hwnd.0 as _) != 0 };
        if !is_visible && !is_minimized {
            continue;
        }

        let is_main = label == "main";
        windows.push(FlowCellNativeWindowRecord {
            title: if is_main {
                "FlowCell".to_string()
            } else {
                format!("FlowCell - {label}")
            },
            handle_key: (hwnd.0 as isize).to_string(),
            hwnd,
            is_main,
            is_minimized,
            label,
        });
    }

    windows.sort_by_cached_key(|window| {
        (
            if window.is_main { 0 } else { 1 },
            window.title.to_ascii_lowercase(),
        )
    });
    windows
}

#[cfg(windows)]
fn saved_toggle_entry_matches_window(
    entry: &FlowCellWindowToggleStateEntry,
    window: &FlowCellNativeWindowRecord,
) -> bool {
    entry
        .label
        .as_deref()
        .map(|label| label == window.label)
        .unwrap_or(false)
        || entry
            .handle
            .as_deref()
            .map(|handle| handle == window.handle_key)
            .unwrap_or(false)
}

#[cfg(windows)]
fn restore_flowcell_native_windows(
    windows: &[FlowCellNativeWindowRecord],
    focus_window: Option<&FlowCellNativeWindowRecord>,
) {
    for window in windows {
        let _ = unsafe { ShowWindowAsync(window.hwnd, SW_RESTORE) };
    }

    thread::sleep(Duration::from_millis(24));

    if let Some(window) = focus_window.or_else(|| windows.first()) {
        let _ = unsafe { ShowWindowAsync(window.hwnd, SW_RESTORE) };
        let _ = unsafe { SetForegroundWindow(window.hwnd) };
    }
}

#[cfg(windows)]
fn minimize_flowcell_native_windows(windows: &[FlowCellNativeWindowRecord]) {
    for window in windows {
        let _ = unsafe { ShowWindowAsync(window.hwnd, SW_MINIMIZE) };
    }
}

#[cfg(windows)]
fn toggle_flowcell_windows_native(app: &AppHandle) -> Result<String, String> {
    let open_windows = collect_flowcell_native_windows(app);
    if open_windows.is_empty() {
        return Err("No FlowCell windows are currently open.".to_string());
    }

    let main_window = open_windows.iter().find(|window| window.is_main);
    let secondary_windows: Vec<FlowCellNativeWindowRecord> = open_windows
        .iter()
        .filter(|window| !window.is_main)
        .cloned()
        .collect();
    let saved_state = read_flowcell_window_toggle_state();
    let saved_windows: Vec<FlowCellNativeWindowRecord> = saved_state
        .as_ref()
        .map(|state| {
            state
                .windows
                .iter()
                .filter_map(|entry| {
                    secondary_windows
                        .iter()
                        .find(|window| saved_toggle_entry_matches_window(entry, window))
                        .cloned()
                })
                .collect()
        })
        .unwrap_or_default();

    let message = if !saved_windows.is_empty() {
        restore_flowcell_native_windows(&saved_windows, main_window);
        clear_flowcell_window_toggle_state()?;
        format!(
            "Restored {} FlowCell utility window(s).",
            saved_windows.len()
        )
    } else {
        if saved_state
            .as_ref()
            .map(|state| !state.windows.is_empty())
            .unwrap_or(false)
        {
            clear_flowcell_window_toggle_state()?;
        }

        let windows_to_minimize: Vec<FlowCellNativeWindowRecord> = secondary_windows
            .iter()
            .filter(|window| !window.is_minimized)
            .cloned()
            .collect();
        if !windows_to_minimize.is_empty() {
            minimize_flowcell_native_windows(&windows_to_minimize);
            write_flowcell_window_toggle_state(&windows_to_minimize)?;
            if let Some(window) = main_window {
                let _ = unsafe { ShowWindowAsync(window.hwnd, SW_RESTORE) };
                let _ = unsafe { SetForegroundWindow(window.hwnd) };
            }
            format!(
                "Minimized {} FlowCell utility window(s). Run the button again to restore them.",
                windows_to_minimize.len()
            )
        } else {
            let minimized_secondary_windows: Vec<FlowCellNativeWindowRecord> = secondary_windows
                .iter()
                .filter(|window| window.is_minimized)
                .cloned()
                .collect();
            if !minimized_secondary_windows.is_empty() {
                restore_flowcell_native_windows(&minimized_secondary_windows, main_window);
                clear_flowcell_window_toggle_state()?;
                format!(
                    "Restored {} minimized FlowCell utility window(s).",
                    minimized_secondary_windows.len()
                )
            } else {
                "No additional FlowCell windows are open to toggle.".to_string()
            }
        }
    };

    write_last_action_status_message(&message);
    Ok(message)
}

#[cfg(not(windows))]
fn toggle_flowcell_windows_native(_app: &AppHandle) -> Result<String, String> {
    Err("FlowCell window toggle is only available on Windows.".to_string())
}

fn resolve_blender_config_path() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root().ok_or_else(|| {
        "FlowCell repo root could not be resolved for Blender config.".to_string()
    })?;
    let local_config_path = resolve_flowcell_local_root()?
        .join("private")
        .join("blender.config.local.json");
    if local_config_path.is_file() {
        return Ok(local_config_path);
    }

    let repo_config_path = repo_root
        .join("Programs")
        .join("Blender")
        .join("config.json");
    if repo_config_path.is_file() {
        return Ok(repo_config_path);
    }

    Ok(repo_root.join("Blender").join("config.json"))
}

fn read_blender_bridge_config() -> Result<BlenderAutomationConfig, String> {
    let config_path = resolve_blender_config_path()?;
    let raw = fs::read_to_string(&config_path).map_err(|error| {
        format!(
            "Blender config not found at {}: {error}",
            config_path.display()
        )
    })?;
    let mut config = serde_json::from_str::<BlenderBridgeConfigFile>(&raw).map_err(|error| {
        format!(
            "Blender config at {} is not valid JSON: {error}",
            config_path.display()
        )
    })?;
    if config.automation.response_timeout_seconds.is_none() {
        config.automation.response_timeout_seconds = Some(DEFAULT_BLENDER_BRIDGE_TIMEOUT_SECONDS);
    }
    Ok(config.automation)
}

fn resolve_blender_bridge_leaf_name(config: &BlenderAutomationConfig) -> String {
    let configured_bridge_root = config.bridge_folder.trim();
    if !configured_bridge_root.is_empty() {
        if let Some(file_name) = Path::new(configured_bridge_root).file_name() {
            let leaf_name = file_name.to_string_lossy().trim().to_string();
            if !leaf_name.is_empty() {
                return leaf_name;
            }
        }
    }

    let signals = [
        config.custom_actions_file_name.as_str(),
        config.addon_actions_file_name.as_str(),
        config.addon_bridge_file_name.as_str(),
        config.addon_display_name.as_str(),
    ]
    .join(" ")
    .to_ascii_lowercase();

    if signals.contains("flowcell") {
        "blender_bridge_flowcell".to_string()
    } else {
        "blender_bridge".to_string()
    }
}

fn resolve_blender_bridge_root(config: &BlenderAutomationConfig) -> Option<PathBuf> {
    let configured_bridge_root = config.bridge_folder.trim();
    if !configured_bridge_root.is_empty() {
        return Some(PathBuf::from(configured_bridge_root));
    }

    let blender_appdata_root = env::var_os("APPDATA")
        .map(PathBuf::from)?
        .join("Blender Foundation")
        .join("Blender");
    if !blender_appdata_root.is_dir() {
        return None;
    }

    let bridge_leaf_name = resolve_blender_bridge_leaf_name(config);
    let mut version_directories = fs::read_dir(&blender_appdata_root)
        .ok()?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            if !file_type.is_dir() {
                return None;
            }
            Some(entry.path())
        })
        .collect::<Vec<_>>();
    version_directories.sort();
    version_directories.reverse();

    for version_directory in &version_directories {
        let candidate = version_directory
            .join("scripts")
            .join("addons")
            .join(&bridge_leaf_name);
        if candidate.is_dir() {
            return Some(candidate);
        }
    }

    version_directories.first().map(|version_directory| {
        version_directory
            .join("scripts")
            .join("addons")
            .join(bridge_leaf_name)
    })
}

fn resolve_blender_bridge_runtime_status_file_name(bridge_root: &Path) -> &'static str {
    match bridge_root
        .file_name()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
        .as_str()
    {
        "blender_bridge_flowcell" => "flowcell_bridge_runtime_status.json",
        _ => "flowcell_bridge_runtime_status.json",
    }
}

fn read_blender_bridge_runtime_pid(bridge_root: &Path) -> Option<u32> {
    let status_path =
        bridge_root.join(resolve_blender_bridge_runtime_status_file_name(bridge_root));
    let raw = fs::read_to_string(status_path).ok()?;
    let payload = serde_json::from_str::<Value>(&raw).ok()?;
    let pid_value = payload
        .get("last_event")
        .and_then(|value| value.get("pid"))
        .and_then(|value| value.as_u64())?;
    u32::try_from(pid_value).ok()
}

fn build_blender_bridge_request_id() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!(
        "flowcell-{pid}-{secs}-{nanos}",
        pid = std::process::id(),
        secs = timestamp.as_secs(),
        nanos = timestamp.subsec_nanos()
    )
}

fn wait_for_blender_bridge_response(
    response_path: &Path,
    request_id: &str,
    timeout: Duration,
) -> Option<Value> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Ok(raw) = fs::read_to_string(response_path) {
            if let Ok(response) = serde_json::from_str::<Value>(&raw) {
                let response_id = response
                    .get("id")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default();
                if response_id.eq(request_id) {
                    return Some(response);
                }
            }
        }
        thread::sleep(Duration::from_millis(BLENDER_BRIDGE_RESPONSE_POLL_MS));
    }

    None
}

fn did_blender_bridge_response_succeed(response: &Value) -> bool {
    let normalized_status = response
        .get("status")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    normalized_status.is_empty()
        || matches!(normalized_status.as_str(), "ok" | "finished" | "success")
}

fn extract_blender_bridge_response_message(response: &Value) -> String {
    response
        .get("display")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            response
                .get("message")
                .and_then(|value| value.as_str())
                .filter(|value| !value.trim().is_empty())
        })
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|| "Blender action completed.".to_string())
}

fn resolve_slicer_launcher_spec(slicer_id: &str) -> Result<SlicerLauncherSpec, String> {
    match slicer_id.trim().to_ascii_lowercase().as_str() {
        "orca" | "orcaslicer" | "orca_slicer" | "orca-slicer" => Ok(SlicerLauncherSpec {
            id: "orca",
            display_name: "OrcaSlicer",
            executable_label: "Orca EXE",
            config_file_name: Some(ORCA_LAUNCHER_CONFIG_FILE_NAME),
        }),
        "cura" | "ultimaker_cura" | "ultimaker-cura" => Ok(SlicerLauncherSpec {
            id: "cura",
            display_name: "UltiMaker Cura",
            executable_label: "Cura EXE",
            config_file_name: Some(CURA_LAUNCHER_CONFIG_FILE_NAME),
        }),
        "slicer" | "generic" | "custom" => Ok(SlicerLauncherSpec {
            id: "slicer",
            display_name: "Slicer",
            executable_label: "Slicer EXE",
            config_file_name: None,
        }),
        _ => Err("Unknown slicer launcher.".to_string()),
    }
}

fn resolve_slicer_launcher_config_path(
    spec: SlicerLauncherSpec,
) -> Result<Option<PathBuf>, String> {
    let Some(config_file_name) = spec.config_file_name else {
        return Ok(None);
    };

    let local_root = resolve_flowcell_local_root()?;
    fs::create_dir_all(&local_root)
        .map_err(|error| format!("Failed to create {}: {error}", local_root.display()))?;
    Ok(Some(local_root.join(config_file_name)))
}

fn validate_slicer_executable_path(
    path_text: &str,
    spec: SlicerLauncherSpec,
) -> Result<PathBuf, String> {
    let trimmed = path_text.trim().trim_matches('"').trim();
    if trimmed.is_empty() {
        return Err(format!("Choose a {} file.", spec.executable_label));
    }

    let executable = PathBuf::from(trimmed);
    if !executable.is_file() {
        return Err(format!(
            "{} was not found: {}",
            spec.executable_label,
            executable.display()
        ));
    }

    if executable
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| !extension.eq_ignore_ascii_case("exe"))
        .unwrap_or(true)
    {
        return Err(format!(
            "{} path must be an .exe file: {}",
            spec.executable_label,
            executable.display()
        ));
    }

    Ok(executable)
}

fn read_saved_slicer_executable(slicer_id: &str) -> Result<Option<String>, String> {
    let spec = resolve_slicer_launcher_spec(slicer_id)?;
    let Some(config_path) = resolve_slicer_launcher_config_path(spec)? else {
        return Ok(None);
    };
    if !config_path.is_file() {
        return Ok(None);
    }

    let raw = fs::read_to_string(&config_path)
        .map_err(|error| format!("Failed to read {}: {error}", config_path.display()))?;
    let config = serde_json::from_str::<SlicerLauncherConfig>(raw.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("Failed to parse {}: {error}", config_path.display()))?;

    match validate_slicer_executable_path(&config.executable, spec) {
        Ok(path) => Ok(Some(path.display().to_string())),
        Err(_) => Ok(None),
    }
}

fn write_slicer_executable(slicer_id: &str, executable: &Path) -> Result<(), String> {
    let spec = resolve_slicer_launcher_spec(slicer_id)?;
    let Some(config_path) = resolve_slicer_launcher_config_path(spec)? else {
        return Ok(());
    };
    let payload = SlicerLauncherConfig {
        executable: executable.display().to_string(),
    };
    let content = serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("Failed to serialize slicer launcher config: {error}"))?;
    fs::write(&config_path, content)
        .map_err(|error| format!("Failed to write {}: {error}", config_path.display()))
}

fn normalized_path_key(path: &Path) -> String {
    fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase()
}

const SLICER_DIRECTORY_TOKENS: &[&str] = &[
    "anycubic",
    "bambu",
    "chitubox",
    "creality",
    "cura",
    "elegoo",
    "flashprint",
    "ideamaker",
    "lychee",
    "mattercontrol",
    "orca",
    "prusa",
    "slicer",
    "superslicer",
    "ultimaker",
];

const SLICER_EXECUTABLE_TOKENS: &[&str] = &[
    "anycubic",
    "bambu",
    "chitubox",
    "creality",
    "cura",
    "elegoo",
    "flashprint",
    "ideamaker",
    "lychee",
    "mattercontrol",
    "orca",
    "prusa",
    "slicer",
    "superslicer",
    "ultimaker",
];

const SLICER_HELPER_EXECUTABLE_TOKENS: &[&str] = &[
    "arduino",
    "crash",
    "crashpad",
    "dpinst",
    "driver",
    "engine",
    "helper",
    "maintenancetool",
    "plugin",
    "repair",
    "setup",
    "unins",
    "uninstall",
    "update",
    "updater",
    "vc_redist",
];

fn lower_file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn name_contains_any_token(name: &str, tokens: &[&str]) -> bool {
    tokens.iter().any(|token| name.contains(token))
}

fn is_slicer_candidate_executable(path: &Path, ancestor_matched: bool) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !extension.eq_ignore_ascii_case("exe") {
        return false;
    }

    let file_name = lower_file_name(path);
    if name_contains_any_token(&file_name, SLICER_HELPER_EXECUTABLE_TOKENS) {
        return false;
    }

    let _ = ancestor_matched;
    name_contains_any_token(&file_name, SLICER_EXECUTABLE_TOKENS)
}

fn readable_display_stem(path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Slicer")
        .replace(['-', '_'], " ");
    let mut words = Vec::new();
    for word in stem.split_whitespace() {
        let mut chars = word.chars();
        let Some(first) = chars.next() else {
            continue;
        };
        words.push(format!(
            "{}{}",
            first.to_uppercase(),
            chars.as_str().to_lowercase()
        ));
    }
    if words.is_empty() {
        "Slicer".to_string()
    } else {
        words.join(" ")
    }
}

fn infer_detected_slicer_display_name(path: &Path) -> String {
    let file_name = lower_file_name(path);
    let parent_name = path.parent().map(lower_file_name).unwrap_or_default();
    let haystack = format!("{file_name} {parent_name}");

    if haystack.contains("orca") {
        return "Orca".to_string();
    }
    if haystack.contains("ultimaker") || haystack.contains("cura") {
        return "UltiMaker Cura".to_string();
    }
    if haystack.contains("prusa") {
        return "PrusaSlicer".to_string();
    }
    if haystack.contains("bambu") {
        return "Bambu Studio".to_string();
    }
    if haystack.contains("anycubic") {
        return "Anycubic Slicer".to_string();
    }
    if haystack.contains("creality") {
        return "Creality Print".to_string();
    }
    if haystack.contains("superslicer") || haystack.contains("super slicer") {
        return "SuperSlicer".to_string();
    }
    if haystack.contains("chitubox") {
        return "CHITUBOX".to_string();
    }
    if haystack.contains("lychee") {
        return "Lychee Slicer".to_string();
    }
    if haystack.contains("ideamaker") {
        return "ideaMaker".to_string();
    }
    if haystack.contains("flashprint") {
        return "FlashPrint".to_string();
    }
    if haystack.contains("mattercontrol") {
        return "MatterControl".to_string();
    }
    if haystack.contains("elegoo") {
        return "ELEGOO Slicer".to_string();
    }

    readable_display_stem(path)
}

fn detected_slicer_family_key(path: &Path, display_name: &str) -> String {
    let file_name = lower_file_name(path);
    let parent_name = path.parent().map(lower_file_name).unwrap_or_default();
    let haystack = format!("{file_name} {parent_name}");

    for token in [
        "anycubic",
        "bambu",
        "chitubox",
        "creality",
        "cura",
        "elegoo",
        "flashprint",
        "ideamaker",
        "lychee",
        "mattercontrol",
        "orca",
        "prusa",
        "superslicer",
        "ultimaker",
    ] {
        if haystack.contains(token) {
            return token.to_string();
        }
    }

    display_name.to_ascii_lowercase()
}

fn version_vector_from_text(text: &str) -> Vec<u32> {
    let mut best = Vec::new();
    for token in text.split(|character: char| !(character.is_ascii_digit() || character == '.')) {
        if !token.contains('.') {
            continue;
        }
        let parts = token
            .split('.')
            .filter_map(|part| part.parse::<u32>().ok())
            .collect::<Vec<_>>();
        if compare_version_vectors(&parts, &best).is_gt() {
            best = parts;
        }
    }
    best
}

fn compare_version_vectors(left: &[u32], right: &[u32]) -> std::cmp::Ordering {
    let length = left.len().max(right.len());
    for index in 0..length {
        let left_part = left.get(index).copied().unwrap_or(0);
        let right_part = right.get(index).copied().unwrap_or(0);
        match left_part.cmp(&right_part) {
            std::cmp::Ordering::Equal => continue,
            ordering => return ordering,
        }
    }
    std::cmp::Ordering::Equal
}

fn detected_slicer_version(path: &Path) -> Vec<u32> {
    version_vector_from_text(&path.display().to_string())
}

fn latest_detected_slicer_executables(
    found: Vec<DetectedSlicerExecutable>,
) -> Vec<DetectedSlicerExecutable> {
    let mut latest_by_family: HashMap<String, DetectedSlicerExecutable> = HashMap::new();

    for candidate in found {
        let candidate_path = Path::new(&candidate.executable_path);
        let family_key = detected_slicer_family_key(candidate_path, &candidate.display_name);
        let candidate_version = detected_slicer_version(candidate_path);
        match latest_by_family.get(&family_key) {
            Some(existing) => {
                let existing_version =
                    detected_slicer_version(Path::new(&existing.executable_path));
                let should_replace = compare_version_vectors(&candidate_version, &existing_version)
                    .is_gt()
                    || (candidate_version == existing_version
                        && candidate.executable_path.len() < existing.executable_path.len());
                if should_replace {
                    latest_by_family.insert(family_key, candidate);
                }
            }
            None => {
                latest_by_family.insert(family_key, candidate);
            }
        }
    }

    latest_by_family.into_values().collect()
}

fn push_slicer_search_root(roots: &mut Vec<PathBuf>, seen: &mut HashSet<String>, path: PathBuf) {
    if !path.is_dir() {
        return;
    }
    let key = normalized_path_key(&path);
    if seen.insert(key) {
        roots.push(path);
    }
}

fn detected_slicer_search_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut seen = HashSet::new();

    for variable in ["ProgramFiles", "ProgramFiles(x86)", "ProgramData"] {
        if let Ok(value) = env::var(variable) {
            push_slicer_search_root(&mut roots, &mut seen, PathBuf::from(value));
        }
    }

    if let Ok(value) = env::var("LOCALAPPDATA") {
        let local_app_data = PathBuf::from(value);
        push_slicer_search_root(&mut roots, &mut seen, local_app_data.join("Programs"));
        push_slicer_search_root(&mut roots, &mut seen, local_app_data);
    }

    if let Ok(value) = env::var("APPDATA") {
        push_slicer_search_root(&mut roots, &mut seen, PathBuf::from(value));
    }

    roots
}

fn push_detected_slicer_executable(
    found: &mut Vec<DetectedSlicerExecutable>,
    seen: &mut HashSet<String>,
    path: PathBuf,
) {
    push_detected_slicer_executable_with_metadata(found, seen, path, None, "Detected");
}

fn push_detected_slicer_executable_with_metadata(
    found: &mut Vec<DetectedSlicerExecutable>,
    seen: &mut HashSet<String>,
    path: PathBuf,
    display_name: Option<String>,
    source: &str,
) {
    let key = normalized_path_key(&path);
    if !seen.insert(key) {
        return;
    }
    let fallback_display_name = infer_detected_slicer_display_name(&path);
    found.push(DetectedSlicerExecutable {
        display_name: display_name
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty())
            .unwrap_or(fallback_display_name),
        executable_path: path.display().to_string(),
        source: source.to_string(),
    });
}

fn registry_icon_executable_path(value: &str) -> Option<PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix('"') {
        if let Some(end_quote) = rest.find('"') {
            let path = rest[..end_quote].trim();
            return (!path.is_empty()).then(|| PathBuf::from(path));
        }
    }
    let lower = trimmed.to_ascii_lowercase();
    lower
        .find(".exe")
        .map(|index| PathBuf::from(trimmed[..index + 4].trim().trim_matches('"')))
}

fn registry_slicer_executable_candidate(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !extension.eq_ignore_ascii_case("exe") {
        return false;
    }
    let file_name = lower_file_name(path);
    !name_contains_any_token(&file_name, SLICER_HELPER_EXECUTABLE_TOKENS)
}

fn collect_registry_install_location_executables(
    root: &Path,
    found: &mut Vec<DetectedSlicerExecutable>,
    seen: &mut HashSet<String>,
    display_name: &str,
) {
    const MAX_DEPTH: usize = 2;
    const MAX_VISITED_DIRECTORIES: usize = 128;

    if !root.is_dir() {
        return;
    }

    let mut stack = vec![(root.to_path_buf(), 0usize)];
    let mut visited = HashSet::new();
    while let Some((directory, depth)) = stack.pop() {
        if visited.len() >= MAX_VISITED_DIRECTORIES {
            break;
        }
        let directory_key = normalized_path_key(&directory);
        if !visited.insert(directory_key) {
            continue;
        }

        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_file() {
                if registry_slicer_executable_candidate(&path) {
                    push_detected_slicer_executable_with_metadata(
                        found,
                        seen,
                        path,
                        Some(display_name.to_string()),
                        "Installed",
                    );
                }
                continue;
            }
            if file_type.is_dir() && depth < MAX_DEPTH {
                stack.push((path, depth + 1));
            }
        }
    }
}

#[cfg(windows)]
fn read_installed_slicer_registry_entries() -> Vec<InstalledSlicerRegistryEntry> {
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
$tokens = @(
  'slicer', '3d print', '3d-print', '3d printer', 'gcode', 'g-code',
  'cura', 'orca', 'prusa', 'bambu', 'anycubic', 'creality', 'chitubox',
  'lychee', 'ideamaker', 'flashprint', 'mattercontrol', 'elegoo', 'superslicer'
)
$registryRoots = @(
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$entries = @()
foreach ($root in $registryRoots) {
  foreach ($item in Get-ItemProperty -Path $root -ErrorAction SilentlyContinue) {
    $displayName = [string]$item.DisplayName
    if ([string]::IsNullOrWhiteSpace($displayName)) { continue }
    $displayIcon = [Environment]::ExpandEnvironmentVariables([string]$item.DisplayIcon)
    $installLocation = [Environment]::ExpandEnvironmentVariables([string]$item.InstallLocation)
    $haystack = "$displayName $($item.Publisher) $displayIcon $installLocation"
    $matched = $false
    foreach ($token in $tokens) {
      if ($haystack.IndexOf($token, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $matched = $true
        break
      }
    }
    if (-not $matched) { continue }
    $entries += [pscustomobject]@{
      displayName = $displayName
      displayIcon = $displayIcon
      installLocation = $installLocation
    }
  }
}
[pscustomobject]@{ entries = @($entries) } | ConvertTo-Json -Compress -Depth 4
"#;

    let mut command = Command::new(resolve_powershell_path());
    command
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .creation_flags(CREATE_NO_WINDOW);

    let Ok(output) = command.output() else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        return Vec::new();
    }

    serde_json::from_str::<InstalledSlicerRegistryResponse>(&raw)
        .map(|response| response.entries)
        .unwrap_or_default()
}

#[cfg(not(windows))]
fn read_installed_slicer_registry_entries() -> Vec<InstalledSlicerRegistryEntry> {
    Vec::new()
}

fn push_registry_detected_slicer_executables(
    found: &mut Vec<DetectedSlicerExecutable>,
    seen: &mut HashSet<String>,
) {
    for entry in read_installed_slicer_registry_entries() {
        let display_name = entry.display_name.trim().to_string();
        if let Some(path) = registry_icon_executable_path(&entry.display_icon) {
            if path.is_file() && registry_slicer_executable_candidate(&path) {
                push_detected_slicer_executable_with_metadata(
                    found,
                    seen,
                    path,
                    Some(display_name.clone()),
                    "Installed",
                );
            }
        }

        let install_location = entry.install_location.trim();
        if !install_location.is_empty() {
            collect_registry_install_location_executables(
                &PathBuf::from(install_location),
                found,
                seen,
                &display_name,
            );
        }
    }
}

fn collect_detected_slicer_executables_from_root(
    root: &Path,
    found: &mut Vec<DetectedSlicerExecutable>,
    seen: &mut HashSet<String>,
) {
    const MAX_DEPTH: usize = 5;
    const MAX_VISITED_DIRECTORIES: usize = 8000;

    let mut stack = vec![(root.to_path_buf(), 0usize, false)];
    let mut visited = HashSet::new();

    while let Some((directory, depth, ancestor_matched)) = stack.pop() {
        if visited.len() >= MAX_VISITED_DIRECTORIES {
            break;
        }
        let directory_key = normalized_path_key(&directory);
        if !visited.insert(directory_key) {
            continue;
        }

        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };

            if file_type.is_file() {
                if is_slicer_candidate_executable(&path, ancestor_matched) {
                    push_detected_slicer_executable(found, seen, path);
                }
                continue;
            }

            if !file_type.is_dir() || depth >= MAX_DEPTH {
                continue;
            }

            let directory_name = lower_file_name(&path);
            let directory_matched = ancestor_matched
                || name_contains_any_token(&directory_name, SLICER_DIRECTORY_TOKENS);
            if depth == 0 || directory_matched {
                stack.push((path, depth + 1, directory_matched));
            }
        }
    }
}

fn detect_installed_slicer_executables() -> Vec<DetectedSlicerExecutable> {
    let mut found = Vec::new();
    let mut seen = HashSet::new();
    for root in detected_slicer_search_roots() {
        collect_detected_slicer_executables_from_root(&root, &mut found, &mut seen);
    }
    push_registry_detected_slicer_executables(&mut found, &mut seen);
    let mut found = latest_detected_slicer_executables(found);
    found.sort_by(|a, b| {
        a.display_name
            .to_ascii_lowercase()
            .cmp(&b.display_name.to_ascii_lowercase())
            .then_with(|| {
                a.executable_path
                    .to_ascii_lowercase()
                    .cmp(&b.executable_path.to_ascii_lowercase())
            })
    });
    found
}

#[tauri::command]
fn list_detected_slicer_executables() -> Result<Vec<DetectedSlicerExecutable>, String> {
    Ok(detect_installed_slicer_executables())
}

#[cfg(windows)]
struct RunningExecutableWindowSearch {
    executable_path_key: String,
    hwnd: HWND,
}

#[cfg(windows)]
unsafe extern "system" fn enum_running_executable_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    if hwnd.is_null() {
        return 1;
    }

    if IsWindowVisible(hwnd) == 0 && IsIconic(hwnd) == 0 {
        return 1;
    }

    let search = &mut *(lparam as *mut RunningExecutableWindowSearch);
    let mut process_id = 0u32;
    GetWindowThreadProcessId(hwnd, &mut process_id);
    let Some(process_path) = query_process_path_by_id(process_id) else {
        return 1;
    };

    if normalized_path_key(Path::new(&process_path)) == search.executable_path_key {
        search.hwnd = hwnd;
        return 0;
    }

    1
}

#[cfg(windows)]
fn running_executable_window(executable: &Path) -> Option<HWND> {
    let mut search = RunningExecutableWindowSearch {
        executable_path_key: normalized_path_key(executable),
        hwnd: std::ptr::null_mut(),
    };

    unsafe {
        EnumWindows(
            Some(enum_running_executable_window),
            &mut search as *mut RunningExecutableWindowSearch as LPARAM,
        );
    }

    (!search.hwnd.is_null()).then_some(search.hwnd)
}

#[cfg(not(windows))]
fn running_executable_window(_executable: &Path) -> Option<()> {
    None
}

fn launch_slicer_impl(
    slicer_id: &str,
    executable_path: &str,
    exported_paths: Vec<String>,
) -> Result<String, String> {
    let spec = resolve_slicer_launcher_spec(slicer_id)?;
    let executable = validate_slicer_executable_path(executable_path, spec)?;
    let model_paths = exported_paths
        .iter()
        .map(|path| PathBuf::from(path.trim().trim_matches('"').trim()))
        .filter(|path| !path.as_os_str().is_empty())
        .collect::<Vec<_>>();

    if model_paths.is_empty() {
        return Err(format!(
            "No model files were exported for {}.",
            spec.display_name
        ));
    }

    for path in &model_paths {
        if !path.is_file() {
            return Err(format!(
                "Exported model file was not found: {}",
                path.display()
            ));
        }
    }

    // Hand the model files to the slicer by launching its own executable with the
    // file paths as arguments, and let the slicer's own single-instance setting
    // decide where they land (its running window when single-instance is enabled,
    // otherwise a new window) — either way the model loads. We intentionally do
    // NOT force a `--single-instance` flag: when the user's slicer has that option
    // turned off, forcing it makes the launch try to hand off to a window that is
    // not listening, so the files are silently dropped and nothing loads. We also
    // cannot post a cross-process WM_DROPFILES message: the HDROP handle is only
    // valid in this process, so the slicer would receive an unreadable handle
    // while the post still reports success.
    let was_running = running_executable_window(&executable).is_some();

    let mut command = Command::new(&executable);
    command.args(&model_paths);
    if let Some(parent) = executable.parent() {
        command.current_dir(parent);
    }
    command.spawn().map_err(|error| {
        format!(
            "Failed to launch {} at {}: {error}",
            spec.display_name,
            executable.display()
        )
    })?;

    write_slicer_executable(spec.id, &executable)?;

    let count = model_paths.len();
    let file_label = if count == 1 { "file" } else { "files" };
    if was_running {
        Ok(format!(
            "Sent {count} model {file_label} to {}.",
            spec.display_name
        ))
    } else {
        Ok(format!(
            "Launched {} with {count} model {file_label}.",
            spec.display_name
        ))
    }
}

#[tauri::command]
fn load_slicer_executable(slicer_id: String) -> Result<Option<String>, String> {
    read_saved_slicer_executable(&slicer_id)
}

#[tauri::command]
fn launch_slicer(
    slicer_id: String,
    executable_path: String,
    exported_paths: Vec<String>,
) -> Result<String, String> {
    launch_slicer_impl(&slicer_id, &executable_path, exported_paths)
}

#[tauri::command]
fn load_orca_slicer_executable() -> Result<Option<String>, String> {
    read_saved_slicer_executable("orca")
}

#[tauri::command]
fn launch_orca_slicer(
    executable_path: String,
    exported_paths: Vec<String>,
) -> Result<String, String> {
    launch_slicer_impl("orca", &executable_path, exported_paths)
}

fn resolve_flowcell_layouts_root() -> Result<PathBuf, String> {
    let layouts_root = resolve_flowcell_local_root()?.join("layouts");
    fs::create_dir_all(&layouts_root).map_err(|error| {
        format!(
            "Failed to create layout folder at {}: {error}",
            layouts_root.display()
        )
    })?;
    Ok(layouts_root)
}

fn resolve_layout_dialog_directory(initial_directory: Option<String>) -> Result<PathBuf, String> {
    if let Some(raw_directory) = initial_directory {
        let trimmed_directory = raw_directory.trim();
        if !trimmed_directory.is_empty() {
            let candidate = PathBuf::from(trimmed_directory);
            if candidate.is_dir() {
                return Ok(candidate);
            }
        }
    }

    resolve_flowcell_layouts_root()
}

fn normalize_layout_file_path(path: &Path) -> PathBuf {
    let path_text = path.to_string_lossy().to_string();
    let lower_path = path_text.to_ascii_lowercase();
    if lower_path.ends_with(".flowlayout.json") || lower_path.ends_with(".json") {
        return PathBuf::from(path_text);
    }

    PathBuf::from(format!("{path_text}.flowlayout.json"))
}

fn resolve_existing_dialog_directory(initial_directory: Option<String>) -> Option<PathBuf> {
    let initial_directory = initial_directory?;
    let trimmed = initial_directory.trim();
    if trimmed.is_empty() {
        return None;
    }

    let candidate = PathBuf::from(trimmed);
    if candidate.is_dir() {
        return Some(candidate);
    }

    if candidate.is_file() {
        return candidate.parent().map(Path::to_path_buf);
    }

    candidate
        .parent()
        .filter(|parent| parent.is_dir())
        .map(Path::to_path_buf)
}

fn parse_dialog_filter_spec(filter: &str) -> Vec<(String, Vec<String>)> {
    let parts = filter
        .split('|')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let mut filters = Vec::new();
    let mut index = 0;

    while index + 1 < parts.len() {
        let label = parts[index].to_string();
        let patterns = parts[index + 1]
            .split(';')
            .map(str::trim)
            .filter_map(|pattern| {
                let normalized = pattern.trim().trim_matches('"').trim();
                if normalized.is_empty() || normalized == "*.*" || normalized == "*" {
                    return None;
                }

                let normalized = normalized
                    .trim_start_matches("*.")
                    .trim_start_matches('.')
                    .trim()
                    .to_ascii_lowercase();
                if normalized.is_empty() {
                    None
                } else {
                    Some(normalized)
                }
            })
            .collect::<Vec<_>>();

        if !patterns.is_empty() {
            filters.push((label, patterns));
        }

        index += 2;
    }

    filters
}

fn set_dialog_parent(
    app: &AppHandle,
    dialog: FileDialog,
    parent_label: Option<String>,
) -> FileDialog {
    let Some(label) = parent_label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return dialog;
    };
    let Some(parent_window) = app.get_webview_window(label) else {
        return dialog;
    };

    let _ = parent_window.set_focus();

    #[cfg(windows)]
    if let Ok(hwnd) = parent_window.hwnd() {
        let _ = unsafe { ShowWindowAsync(hwnd, SW_RESTORE) };
        let _ = unsafe { SetForegroundWindow(hwnd) };
    }

    dialog.set_parent(&parent_window)
}

fn rgb_to_hex(color: SampleRgb) -> String {
    format!("#{:02X}{:02X}{:02X}", color.r, color.g, color.b)
}

fn srgb_channel_to_linear(value: u8) -> f64 {
    let normalized = f64::from(value) / 255.0;
    if normalized <= 0.04045 {
        normalized / 12.92
    } else {
        ((normalized + 0.055) / 1.055).powf(2.4)
    }
}

fn relative_luminance(color: SampleRgb) -> f64 {
    0.2126 * srgb_channel_to_linear(color.r)
        + 0.7152 * srgb_channel_to_linear(color.g)
        + 0.0722 * srgb_channel_to_linear(color.b)
}

fn contrast_ratio(left: SampleRgb, right: SampleRgb) -> f64 {
    let left_luma = relative_luminance(left);
    let right_luma = relative_luminance(right);
    let (lighter, darker) = if left_luma >= right_luma {
        (left_luma, right_luma)
    } else {
        (right_luma, left_luma)
    };
    (lighter + 0.05) / (darker + 0.05)
}

fn color_distance_sq(left: SampleRgb, right: SampleRgb) -> u32 {
    let dr = i32::from(left.r) - i32::from(right.r);
    let dg = i32::from(left.g) - i32::from(right.g);
    let db = i32::from(left.b) - i32::from(right.b);
    (dr * dr + dg * dg + db * db) as u32
}

fn color_saturation(color: SampleRgb) -> f64 {
    let red = f64::from(color.r) / 255.0;
    let green = f64::from(color.g) / 255.0;
    let blue = f64::from(color.b) / 255.0;
    let max_value = red.max(green).max(blue);
    let min_value = red.min(green).min(blue);
    if max_value <= 0.0 {
        0.0
    } else {
        (max_value - min_value) / max_value
    }
}

fn color_hue_degrees(color: SampleRgb) -> Option<f64> {
    let red = f64::from(color.r) / 255.0;
    let green = f64::from(color.g) / 255.0;
    let blue = f64::from(color.b) / 255.0;
    let max_value = red.max(green).max(blue);
    let min_value = red.min(green).min(blue);
    let delta = max_value - min_value;
    if delta <= 0.0001 || max_value <= 0.0 {
        return None;
    }

    let hue = if (max_value - red).abs() <= f64::EPSILON {
        60.0 * ((green - blue) / delta).rem_euclid(6.0)
    } else if (max_value - green).abs() <= f64::EPSILON {
        60.0 * (((blue - red) / delta) + 2.0)
    } else {
        60.0 * (((red - green) / delta) + 4.0)
    };
    Some(hue)
}

fn hue_distance_degrees(left: f64, right: f64) -> f64 {
    let distance = (left - right).abs().rem_euclid(360.0);
    distance.min(360.0 - distance)
}

fn select_hue_diverse_candidates(
    candidates: &[PaletteCandidate],
    target_len: usize,
) -> Vec<PaletteCandidate> {
    let mut selected = Vec::<PaletteCandidate>::new();
    if candidates.is_empty() {
        return selected;
    }

    let first = candidates
        .iter()
        .copied()
        .max_by(|left, right| {
            let score = |candidate: PaletteCandidate| {
                let saturation = color_saturation(candidate.color);
                let luminance = relative_luminance(candidate.color);
                saturation * 120.0 + f64::from(candidate.count.max(1)).ln() * 3.0
                    - (luminance - 0.45).abs() * 20.0
            };
            score(*left)
                .partial_cmp(&score(*right))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .unwrap_or(candidates[0]);
    selected.push(first);

    while selected.len() < target_len && selected.len() < candidates.len() {
        let next = candidates
            .iter()
            .copied()
            .filter(|candidate| {
                !selected
                    .iter()
                    .any(|existing| existing.color == candidate.color)
            })
            .max_by(|left, right| {
                let score = |candidate: PaletteCandidate| {
                    let min_rgb_distance = selected
                        .iter()
                        .map(|existing| {
                            f64::from(color_distance_sq(candidate.color, existing.color)).sqrt()
                        })
                        .fold(f64::INFINITY, f64::min);
                    let hue = color_hue_degrees(candidate.color);
                    let min_hue_distance = hue
                        .map(|candidate_hue| {
                            selected
                                .iter()
                                .filter_map(|existing| {
                                    color_hue_degrees(existing.color).map(|existing_hue| {
                                        hue_distance_degrees(candidate_hue, existing_hue)
                                    })
                                })
                                .fold(180.0, f64::min)
                        })
                        .unwrap_or(0.0);
                    let saturation = color_saturation(candidate.color);
                    let luminance = relative_luminance(candidate.color);
                    min_hue_distance * 2.2
                        + min_rgb_distance * 0.85
                        + saturation * 75.0
                        + f64::from(candidate.count.max(1)).ln() * 3.0
                        - (luminance - 0.48).abs() * 12.0
                };
                score(*left)
                    .partial_cmp(&score(*right))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });

        if let Some(candidate) = next {
            selected.push(candidate);
        } else {
            break;
        }
    }

    selected
}

fn pick_sampled_highlight_color(
    candidates: &[PaletteCandidate],
    scene_color: SampleRgb,
    controls_color: SampleRgb,
) -> SampleRgb {
    candidates
        .iter()
        .copied()
        .max_by(|left, right| {
            let score = |candidate: PaletteCandidate| {
                let saturation = color_saturation(candidate.color);
                let contrast = contrast_ratio(candidate.color, scene_color);
                let luminance = relative_luminance(candidate.color);
                let scene_distance =
                    f64::from(color_distance_sq(candidate.color, scene_color)).sqrt();
                let distance_bonus = (scene_distance / 255.0).min(1.0) * 20.0;
                let count_bonus = f64::from(candidate.count.max(1)).ln() * 2.0;
                saturation * 150.0
                    + contrast * 10.0
                    + luminance * 18.0
                    + distance_bonus
                    + count_bonus
            };
            score(*left)
                .partial_cmp(&score(*right))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|candidate| candidate.color)
        .unwrap_or(controls_color)
}

fn quantize_channel(value: u8) -> u8 {
    value / 24
}

fn resolve_sampled_text_color(text_color: SampleRgb, background_color: SampleRgb) -> SampleRgb {
    if contrast_ratio(text_color, background_color) >= 4.5 {
        return text_color;
    }
    let black = SampleRgb {
        r: 12,
        g: 12,
        b: 12,
    };
    let white = SampleRgb {
        r: 244,
        g: 244,
        b: 244,
    };
    if contrast_ratio(black, background_color) >= contrast_ratio(white, background_color) {
        black
    } else {
        white
    }
}

fn fill_palette_to_five(colors: &mut Vec<SampleRgb>) {
    let fallbacks = [
        SampleRgb {
            r: 32,
            g: 32,
            b: 32,
        },
        SampleRgb {
            r: 240,
            g: 240,
            b: 240,
        },
        SampleRgb {
            r: 96,
            g: 96,
            b: 96,
        },
    ];
    let seed = colors.first().copied().unwrap_or(fallbacks[0]);
    while colors.len() < 5 {
        let next = fallbacks
            .get(colors.len().saturating_sub(1))
            .copied()
            .unwrap_or(seed);
        colors.push(next);
    }
}

fn pick_photo_theme_colors(path: &Path) -> Result<SampledPhotoThemeColors, String> {
    if !path.is_file() {
        return Err(format!("Image file was not found: {}", path.display()));
    }

    let image = image::open(path).map_err(|error| format!("Unable to read image: {error}"))?;
    let resized = image.resize(160, 160, FilterType::Triangle).to_rgba8();
    let mut buckets: HashMap<(u8, u8, u8), ColorBucketStats> = HashMap::new();

    for pixel in resized.pixels() {
        if pixel[3] < 24 {
            continue;
        }
        let key = (
            quantize_channel(pixel[0]),
            quantize_channel(pixel[1]),
            quantize_channel(pixel[2]),
        );
        let entry = buckets.entry(key).or_default();
        entry.count += 1;
        entry.r_sum += u64::from(pixel[0]);
        entry.g_sum += u64::from(pixel[1]);
        entry.b_sum += u64::from(pixel[2]);
    }

    if buckets.is_empty() {
        return Err("Image did not contain enough readable opaque pixels.".to_string());
    }

    let mut candidates = buckets
        .into_iter()
        .filter_map(|(_key, bucket)| {
            (bucket.count > 0).then_some(PaletteCandidate {
                color: SampleRgb {
                    r: (bucket.r_sum / u64::from(bucket.count)) as u8,
                    g: (bucket.g_sum / u64::from(bucket.count)) as u8,
                    b: (bucket.b_sum / u64::from(bucket.count)) as u8,
                },
                count: bucket.count,
            })
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| right.count.cmp(&left.count));

    let mut distance_distinct = Vec::<PaletteCandidate>::new();
    for threshold in [42_u32, 28_u32, 18_u32, 0_u32] {
        for candidate in &candidates {
            if distance_distinct
                .iter()
                .any(|existing| existing.color == candidate.color)
            {
                continue;
            }
            if distance_distinct.iter().all(|existing| {
                color_distance_sq(existing.color, candidate.color) >= threshold * threshold
            }) {
                distance_distinct.push(*candidate);
            }
            if distance_distinct.len() >= 24 {
                break;
            }
        }
        if distance_distinct.len() >= 12 {
            break;
        }
    }

    let distinct = select_hue_diverse_candidates(&distance_distinct, 16);
    if distinct.is_empty() {
        return Err("Image sampling did not produce a usable palette.".to_string());
    }

    let palette_hexes = distinct
        .iter()
        .map(|candidate| rgb_to_hex(candidate.color))
        .collect::<Vec<_>>();
    let highlight_candidates = distinct.clone();
    let mut available = distinct;
    let scene_index = available
        .iter()
        .enumerate()
        .max_by(|(_left_index, left), (_right_index, right)| {
            let left_luma = relative_luminance(left.color);
            let right_luma = relative_luminance(right.color);
            let left_score = f64::from(left.count) - ((left_luma - 0.45).abs() * 120.0);
            let right_score = f64::from(right.count) - ((right_luma - 0.45).abs() * 120.0);
            left_score
                .partial_cmp(&right_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(index, _)| index)
        .unwrap_or(0);
    let scene_color = available.remove(scene_index).color;

    let text_index = available
        .iter()
        .enumerate()
        .max_by(|(_left_index, left), (_right_index, right)| {
            contrast_ratio(left.color, scene_color)
                .partial_cmp(&contrast_ratio(right.color, scene_color))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(index, _)| index)
        .unwrap_or(0);
    let text_color = if available.is_empty() {
        resolve_sampled_text_color(scene_color, scene_color)
    } else {
        resolve_sampled_text_color(available.remove(text_index).color, scene_color)
    };

    let controls_index = available
        .iter()
        .enumerate()
        .max_by(|(_left_index, left), (_right_index, right)| {
            let left_score = color_saturation(left.color) * 100.0 + f64::from(left.count) * 0.01;
            let right_score = color_saturation(right.color) * 100.0 + f64::from(right.count) * 0.01;
            left_score
                .partial_cmp(&right_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(index, _)| index)
        .unwrap_or(0);
    let controls_color = if available.is_empty() {
        scene_color
    } else {
        available.remove(controls_index).color
    };

    let headers_index = available
        .iter()
        .enumerate()
        .max_by(|(_left_index, left), (_right_index, right)| {
            let left_score = f64::from(left.count) + contrast_ratio(left.color, scene_color) * 10.0;
            let right_score =
                f64::from(right.count) + contrast_ratio(right.color, scene_color) * 10.0;
            left_score
                .partial_cmp(&right_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(index, _)| index)
        .unwrap_or(0);
    let headers_color = if available.is_empty() {
        controls_color
    } else {
        available.remove(headers_index).color
    };

    let misc_color = available
        .first()
        .map(|candidate| candidate.color)
        .unwrap_or(headers_color);
    let highlights_color =
        pick_sampled_highlight_color(&highlight_candidates, scene_color, controls_color);

    let mut palette = vec![
        headers_color,
        text_color,
        scene_color,
        controls_color,
        misc_color,
    ];
    fill_palette_to_five(&mut palette);

    Ok(SampledPhotoThemeColors {
        headers_hex: rgb_to_hex(palette[0]),
        text_hex: rgb_to_hex(palette[1]),
        scene_hex: rgb_to_hex(palette[2]),
        controls_hex: rgb_to_hex(palette[3]),
        misc_hex: rgb_to_hex(palette[4]),
        highlights_hex: rgb_to_hex(highlights_color),
        palette_hexes,
    })
}

fn sanitize_theme_file_stem(value: &str) -> String {
    let trimmed = value.trim();
    let mut sanitized = String::with_capacity(trimmed.len());
    let mut last_was_separator = false;
    for character in trimmed.chars() {
        if character.is_ascii_alphanumeric() {
            sanitized.push(character);
            last_was_separator = false;
            continue;
        }
        if matches!(character, ' ' | '-' | '_' | '.') && !last_was_separator {
            sanitized.push('_');
            last_was_separator = true;
        }
    }
    let cleaned = sanitized.trim_matches('_').to_string();
    if cleaned.is_empty() {
        "blender_theme".to_string()
    } else {
        cleaned
    }
}

fn normalize_theme_file_path(path: &Path) -> PathBuf {
    if path.extension().is_some() {
        path.to_path_buf()
    } else {
        let mut next_path = path.to_path_buf();
        next_path.set_extension("json");
        next_path
    }
}

fn resolve_default_blender_theme_root() -> Result<PathBuf, String> {
    let root = resolve_flowcell_local_root()?.join("blender_themes");
    fs::create_dir_all(&root).map_err(|error| {
        format!(
            "Failed to create Blender theme folder at {}: {error}",
            root.display()
        )
    })?;
    Ok(root)
}

fn resolve_blender_theme_darkness_profiles_path() -> Result<PathBuf, String> {
    Ok(resolve_flowcell_local_root()?.join("blender_theme_darkness_profiles.json"))
}

fn validate_debug_file_name(raw_name: &str) -> Result<String, String> {
    let name = raw_name.trim();
    if name.is_empty() {
        return Err("Debug dump file name cannot be empty.".to_string());
    }

    if name.contains('/') || name.contains('\\') {
        return Err("Debug dump file name must not contain folder separators.".to_string());
    }

    if !name
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-'))
    {
        return Err("Debug dump file name contains unsupported characters.".to_string());
    }

    Ok(name.to_string())
}

#[tauri::command]
fn show_save_layout_dialog(
    suggested_name: String,
    initial_directory: Option<String>,
) -> Result<Option<String>, String> {
    let initial_directory = resolve_layout_dialog_directory(initial_directory)?;
    let file_name = if suggested_name.trim().is_empty() {
        "layout.flowlayout.json".to_string()
    } else {
        suggested_name.trim().to_string()
    };

    let selected_path = FileDialog::new()
        .set_title("Save Layout")
        .set_directory(initial_directory)
        .set_file_name(&file_name)
        .add_filter("FlowCell Layout", &["json"])
        .save_file();

    Ok(selected_path.map(|path| normalize_layout_file_path(&path).display().to_string()))
}

#[tauri::command]
fn show_open_layout_dialog(initial_directory: Option<String>) -> Result<Option<String>, String> {
    let initial_directory = resolve_layout_dialog_directory(initial_directory)?;
    let selected_path = FileDialog::new()
        .set_title("Load Layout")
        .set_directory(initial_directory)
        .add_filter("FlowCell Layout", &["json"])
        .pick_file();

    Ok(selected_path.map(|path| path.display().to_string()))
}

#[tauri::command]
fn show_open_file_dialog(
    app: AppHandle,
    title: String,
    filter: String,
    initial_directory: Option<String>,
    multiselect: bool,
    parent_label: Option<String>,
) -> Result<Vec<String>, String> {
    let mut dialog = set_dialog_parent(&app, FileDialog::new().set_title(&title), parent_label);
    if let Some(directory) = resolve_existing_dialog_directory(initial_directory) {
        dialog = dialog.set_directory(directory);
    }

    for (label, extensions) in parse_dialog_filter_spec(&filter) {
        let extension_refs = extensions.iter().map(String::as_str).collect::<Vec<_>>();
        dialog = dialog.add_filter(&label, &extension_refs);
    }

    let selected_paths = if multiselect {
        dialog.pick_files().unwrap_or_default()
    } else {
        dialog.pick_file().into_iter().collect()
    };

    Ok(selected_paths
        .into_iter()
        .map(|path| path.display().to_string())
        .collect())
}

#[tauri::command]
fn show_open_folder_dialog(
    app: AppHandle,
    title: String,
    initial_directory: Option<String>,
    multiselect: bool,
    parent_label: Option<String>,
) -> Result<Vec<String>, String> {
    let mut dialog = set_dialog_parent(&app, FileDialog::new().set_title(&title), parent_label);
    if let Some(directory) = resolve_existing_dialog_directory(initial_directory) {
        dialog = dialog.set_directory(directory);
    }

    let selected_paths = if multiselect {
        dialog.pick_folders().unwrap_or_default()
    } else {
        dialog.pick_folder().into_iter().collect()
    };

    Ok(selected_paths
        .into_iter()
        .map(|path| path.display().to_string())
        .collect())
}

#[tauri::command]
fn show_save_file_dialog(
    app: AppHandle,
    title: String,
    filter: String,
    initial_directory: Option<String>,
    parent_label: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = set_dialog_parent(&app, FileDialog::new().set_title(&title), parent_label);
    if let Some(directory) = resolve_existing_dialog_directory(initial_directory) {
        dialog = dialog.set_directory(directory);
    }

    for (label, extensions) in parse_dialog_filter_spec(&filter) {
        let extension_refs = extensions.iter().map(String::as_str).collect::<Vec<_>>();
        dialog = dialog.add_filter(&label, &extension_refs);
    }

    Ok(dialog.save_file().map(|path| path.display().to_string()))
}

#[tauri::command]
fn show_text_input_dialog(
    title: String,
    prompt: String,
    default_value: String,
) -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        let script = format!(
            r#"
$Title = {title}
$Prompt = {prompt}
$DefaultValue = {default_value}
Add-Type -AssemblyName Microsoft.VisualBasic
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding -ArgumentList $false
$value = [Microsoft.VisualBasic.Interaction]::InputBox($Prompt, $Title, $DefaultValue)
[Console]::Out.Write($value)
"#,
            title = powershell_single_quoted_string(&title),
            prompt = powershell_single_quoted_string(&prompt),
            default_value = powershell_single_quoted_string(&default_value)
        );
        let mut command = Command::new(resolve_powershell_path());
        command
            .args([
                "-NoProfile",
                "-Sta",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &script,
            ])
            .creation_flags(CREATE_NO_WINDOW);

        let output = command
            .output()
            .map_err(|error| format!("Failed to open text input dialog: {error}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "Text input dialog failed.".to_string()
            } else {
                stderr
            });
        }

        let value = String::from_utf8_lossy(&output.stdout)
            .trim_end_matches(['\r', '\n'])
            .trim()
            .to_string();
        return Ok((!value.is_empty()).then_some(value));
    }

    #[cfg(not(windows))]
    {
        let _ = (title, prompt, default_value);
        Err("Text input dialog is only available on Windows.".to_string())
    }
}

#[tauri::command]
fn show_slicer_choice_dialog(
    title: String,
    choices: Vec<SlicerChoiceDialogChoice>,
) -> Result<Option<SlicerChoiceDialogResult>, String> {
    #[cfg(windows)]
    {
        let choices_json = serde_json::to_string(&choices)
            .map_err(|error| format!("Failed to serialize slicer choices: {error}"))?;
        let script = format!(
            r#"
$Title = {title}
$ChoicesJson = @'
{choices_json}
'@
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding -ArgumentList $false
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$choices = @()
if (-not [string]::IsNullOrWhiteSpace($ChoicesJson)) {{
    # Windows PowerShell 5.1 emits ConvertFrom-Json's array as a single pipeline
    # item, so wrapping the call in @(...) would yield one element holding the
    # whole array. Assign first, then normalize to an array so each slicer keeps
    # its own button.
    $choices = ConvertFrom-Json -InputObject $ChoicesJson
}}
$choices = @($choices)

$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ClientSize = New-Object System.Drawing.Size(420, ([Math]::Min(680, [Math]::Max(220, 132 + ([Math]::Max(1, @($choices).Count) * 58)))))

$header = New-Object System.Windows.Forms.Label
$header.Dock = 'Top'
$header.Height = 48
$header.Padding = New-Object System.Windows.Forms.Padding(12, 10, 12, 4)
$header.Text = 'Click a slicer button, or browse for another EXE.'
$header.TextAlign = 'MiddleLeft'

$tooltip = New-Object System.Windows.Forms.ToolTip
$tooltip.AutoPopDelay = 20000
$tooltip.InitialDelay = 250
$tooltip.ReshowDelay = 100

$footer = New-Object System.Windows.Forms.Panel
$footer.Dock = 'Bottom'
$footer.Height = 58
$footer.Padding = New-Object System.Windows.Forms.Padding(12)

$browse = New-Object System.Windows.Forms.Button
$browse.Text = 'Browse...'
$browse.Width = 128
$browse.Height = 34
$browse.Anchor = 'Right,Top'
$browse.Left = $footer.ClientSize.Width - $browse.Width - 12
$browse.Top = 12
$browse.Add_Click({{
    $form.Tag = (@{{ kind = 'browse'; executablePath = $null }} | ConvertTo-Json -Compress)
    $form.Close()
}})
$footer.Controls.Add($browse) | Out-Null
$footer.Add_Resize({{
    $browse.Left = $footer.ClientSize.Width - $browse.Width - 12
}})

$list = New-Object System.Windows.Forms.FlowLayoutPanel
$list.Dock = 'Fill'
$list.FlowDirection = 'TopDown'
$list.WrapContents = $false
$list.AutoScroll = $true
$list.Padding = New-Object System.Windows.Forms.Padding(12, 4, 12, 4)

foreach ($choice in $choices) {{
    $displayName = [string]$choice.displayName
    $executablePath = [string]$choice.executablePath
    $source = [string]$choice.source
    if ([string]::IsNullOrWhiteSpace($displayName)) {{
        $displayName = 'Slicer'
    }}
    if ([string]::IsNullOrWhiteSpace($executablePath)) {{
        continue
    }}

    $button = New-Object System.Windows.Forms.Button
    $button.Width = 370
    $button.Height = 46
    $button.Margin = New-Object System.Windows.Forms.Padding(6, 6, 6, 6)
    $button.TextAlign = 'MiddleCenter'
    $button.AutoEllipsis = $true
    $button.Text = $displayName
    $tooltip.SetToolTip($button, $executablePath)
    $pathForButton = $executablePath
    $button.Add_Click({{
        $form.Tag = (@{{ kind = 'path'; executablePath = $pathForButton }} | ConvertTo-Json -Compress)
        $form.Close()
    }}.GetNewClosure())
    $list.Controls.Add($button) | Out-Null
}}

$form.Controls.Add($list)
$form.Controls.Add($footer)
$form.Controls.Add($header)
$form.Add_Shown({{ $form.Activate() }})
[void]$form.ShowDialog()
if ($form.Tag) {{
    [Console]::Out.Write([string]$form.Tag)
}}
"#,
            title = powershell_single_quoted_string(&title),
            choices_json = choices_json
        );

        let mut command = Command::new(resolve_powershell_path());
        command
            .args([
                "-NoProfile",
                "-Sta",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &script,
            ])
            .creation_flags(CREATE_NO_WINDOW);

        let output = command
            .output()
            .map_err(|error| format!("Failed to open slicer choice dialog: {error}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "Slicer choice dialog failed.".to_string()
            } else {
                stderr
            });
        }

        let raw = String::from_utf8_lossy(&output.stdout)
            .trim_end_matches(['\r', '\n'])
            .trim()
            .to_string();
        if raw.is_empty() {
            return Ok(None);
        }

        let result = serde_json::from_str::<SlicerChoiceDialogResult>(&raw)
            .map_err(|error| format!("Failed to parse slicer choice dialog result: {error}"))?;
        return Ok(Some(result));
    }

    #[cfg(not(windows))]
    {
        let _ = (title, choices);
        Err("Slicer choice dialog is only available on Windows.".to_string())
    }
}

#[tauri::command]
fn sample_photo_theme_colors(image_path: String) -> Result<SampledPhotoThemeColors, String> {
    let trimmed_path = image_path.trim();
    if trimmed_path.is_empty() {
        return Err("Image path is required.".to_string());
    }

    pick_photo_theme_colors(Path::new(trimmed_path))
}

#[tauri::command]
fn load_blender_theme_darkness_profiles() -> Result<Value, String> {
    let file_path = resolve_blender_theme_darkness_profiles_path()?;
    if !file_path.is_file() {
        return Ok(json!({
            "profiles": [],
            "activeProfileId": ""
        }));
    }

    let raw = fs::read_to_string(&file_path).map_err(|error| {
        format!(
            "Failed to read Blender darkness profiles at {}: {error}",
            file_path.display()
        )
    })?;
    let parsed = serde_json::from_str::<Value>(&raw).map_err(|error| {
        format!(
            "Blender darkness profiles are malformed at {}: {error}",
            file_path.display()
        )
    })?;

    if parsed.is_array() {
        return Ok(json!({
            "profiles": parsed,
            "activeProfileId": ""
        }));
    }

    Ok(parsed)
}

#[tauri::command]
fn save_blender_theme_darkness_profiles(document: Value) -> Result<(), String> {
    let file_path = resolve_blender_theme_darkness_profiles_path()?;
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create FlowCell local folder at {}: {error}",
                parent.display()
            )
        })?;
    }

    let payload = if document.is_array() {
        json!({
            "format": "flowcell-blender-darkness-profiles-v1",
            "profiles": document,
            "activeProfileId": ""
        })
    } else {
        document
    };
    let serialized = serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?;
    fs::write(&file_path, serialized).map_err(|error| {
        format!(
            "Failed to write Blender darkness profiles at {}: {error}",
            file_path.display()
        )
    })
}

#[tauri::command]
fn save_blender_theme_file(
    suggested_name: String,
    path: Option<String>,
    values: Value,
) -> Result<String, String> {
    let file_path = if let Some(raw_path) = path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        normalize_theme_file_path(Path::new(raw_path))
    } else {
        let theme_root = resolve_default_blender_theme_root()?;
        theme_root.join(format!(
            "{}.json",
            sanitize_theme_file_stem(&suggested_name)
        ))
    };

    if let Some(parent) = file_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Failed to create Blender theme folder at {}: {error}",
                    parent.display()
                )
            })?;
        }
    }

    let payload = SavedBlenderThemeFile {
        format: "flowcell-blender-theme-v1".to_string(),
        saved_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_secs()
            .to_string(),
        values,
    };
    let serialized = serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?;
    fs::write(&file_path, serialized).map_err(|error| {
        format!(
            "Failed to write Blender theme file at {}: {error}",
            file_path.display()
        )
    })?;

    Ok(file_path.display().to_string())
}

#[tauri::command]
fn load_blender_theme_file(path: String) -> Result<Value, String> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("Blender theme file path is required.".to_string());
    }

    let file_path = PathBuf::from(trimmed_path);
    if !file_path.is_file() {
        return Err(format!(
            "Blender theme file was not found: {}",
            file_path.display()
        ));
    }

    let raw = fs::read_to_string(&file_path).map_err(|error| {
        format!(
            "Failed to read Blender theme file at {}: {error}",
            file_path.display()
        )
    })?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|error| {
        format!(
            "Failed to parse Blender theme file at {}: {error}",
            file_path.display()
        )
    })?;
    let values = parsed.get("values").cloned().unwrap_or(parsed);
    if !values.is_object() {
        return Err("Blender theme file did not contain a valid theme object.".to_string());
    }

    Ok(values)
}

#[tauri::command]
fn save_layout_snapshot(path: String, snapshot: LayoutSnapshotFile) -> Result<String, String> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("Layout save path cannot be empty.".to_string());
    }

    let layout_path = normalize_layout_file_path(Path::new(trimmed_path));
    if let Some(parent) = layout_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create layout folder at {}: {error}",
                parent.display()
            )
        })?;
    }

    let contents = serde_json::to_string_pretty(&snapshot)
        .map_err(|error| format!("Failed to serialize layout snapshot: {error}"))?;
    fs::write(&layout_path, contents).map_err(|error| {
        format!(
            "Failed to write layout snapshot at {}: {error}",
            layout_path.display()
        )
    })?;

    Ok(layout_path.display().to_string())
}

#[tauri::command]
fn load_layout_snapshot(path: String) -> Result<LayoutSnapshotFile, String> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("Layout load path cannot be empty.".to_string());
    }

    let layout_path = PathBuf::from(trimmed_path);
    let contents = fs::read_to_string(&layout_path).map_err(|error| {
        format!(
            "Failed to read layout snapshot at {}: {error}",
            layout_path.display()
        )
    })?;

    serde_json::from_str::<LayoutSnapshotFile>(&contents).map_err(|error| {
        format!(
            "Layout snapshot at {} is not valid JSON: {error}",
            layout_path.display()
        )
    })
}

fn list_simple_panel_script_files(
    panel_directory: &Path,
    is_allowed_path: fn(&Path) -> bool,
) -> Result<Vec<PanelScriptFileRecord>, String> {
    let mut records = Vec::new();
    let entries = fs::read_dir(panel_directory)
        .map_err(|error| format!("Failed to read {}: {error}", panel_directory.display()))?;

    for entry in entries {
        let entry = entry
            .map_err(|error| format!("Failed to read {}: {error}", panel_directory.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;

        if !file_type.is_file() {
            continue;
        }

        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name
            .to_ascii_lowercase()
            .ends_with(BLENDER_PANEL_ITEM_SUFFIX)
        {
            let record = read_panel_item_file(&path)?;
            if is_frontend_macro_panel_item(&record) {
                records.push(PanelScriptFileRecord {
                    label: record.label,
                    file_name,
                    tooltip: if record.tooltip.trim().is_empty() {
                        None
                    } else {
                        Some(record.tooltip)
                    },
                    kind: Some(record.kind),
                    execution_target: None,
                    bridge_action: None,
                    bridge_data: None,
                    children: None,
                    macro_id: Some(record.macro_id),
                });
            }
            continue;
        }
        if !is_allowed_path(&path) {
            continue;
        }

        let tooltip = read_top_description(&path).filter(|value| !value.trim().is_empty());
        records.push(PanelScriptFileRecord {
            label: format_panel_script_label(&file_name),
            file_name,
            tooltip,
            kind: None,
            execution_target: None,
            bridge_action: None,
            bridge_data: None,
            children: None,
            macro_id: None,
        });
    }

    records.sort_by_cached_key(|record| record.label.to_ascii_lowercase());
    Ok(records)
}

fn list_windows_panel_script_files(
    panel_directory: &Path,
) -> Result<Vec<PanelScriptFileRecord>, String> {
    list_simple_panel_script_files(panel_directory, is_allowed_windows_script_path)
}

fn list_generic_panel_script_files(
    panel_directory: &Path,
) -> Result<Vec<PanelScriptFileRecord>, String> {
    list_simple_panel_script_files(panel_directory, is_allowed_generic_script_path)
}

fn classify_adobe_panel_script_kind(
    path: &Path,
    children: &[PanelScriptChildRecord],
) -> Option<String> {
    if let Ok(Some(kind)) = parse_flowcell_kind(path) {
        if kind.eq_ignore_ascii_case(ILLUSTRATOR_ALIGNMENT_TOOL_KIND) {
            return Some(ILLUSTRATOR_ALIGNMENT_TOOL_KIND.to_string());
        }
        if kind.eq_ignore_ascii_case(ILLUSTRATOR_ROTATE_TOOL_KIND) {
            return Some(ILLUSTRATOR_ROTATE_TOOL_KIND.to_string());
        }
    }

    if is_illustrator_alignment_tool_children(children) {
        return Some(ILLUSTRATOR_ALIGNMENT_TOOL_KIND.to_string());
    }

    if is_illustrator_rotate_tool_children(children)
        || source_file_name_matches(
            path,
            &[
                "illustrator rotate.jsx",
                "illustrator_rotate.jsx",
                "flowcell illustrator rotate.jsx",
            ],
        )
    {
        return Some(ILLUSTRATOR_ROTATE_TOOL_KIND.to_string());
    }

    None
}

fn list_adobe_panel_script_files(
    panel_directory: &Path,
) -> Result<Vec<PanelScriptFileRecord>, String> {
    let mut records = Vec::new();
    let entries = fs::read_dir(panel_directory)
        .map_err(|error| format!("Failed to read {}: {error}", panel_directory.display()))?;

    for entry in entries {
        let entry = entry
            .map_err(|error| format!("Failed to read {}: {error}", panel_directory.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;

        if !file_type.is_file() {
            continue;
        }

        let path = entry.path();
        if !is_allowed_adobe_script_path(&path) {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();
        records.push(read_adobe_panel_script_record(&path, file_name));
    }

    records.sort_by_cached_key(|record| record.label.to_ascii_lowercase());
    Ok(records)
}

fn read_adobe_panel_script_record(path: &Path, file_name: String) -> PanelScriptFileRecord {
    let tooltip = read_top_description(path).filter(|value| !value.trim().is_empty());
    let children = parse_flowcell_children(path).unwrap_or_default();
    let kind = classify_adobe_panel_script_kind(path, &children);
    PanelScriptFileRecord {
        label: format_panel_script_label(&file_name),
        file_name,
        tooltip,
        kind,
        execution_target: None,
        bridge_action: None,
        bridge_data: None,
        children: if children.is_empty() {
            None
        } else {
            Some(children)
        },
        macro_id: None,
    }
}

fn resolve_bindable_button_target(
    program_name: &str,
    panel_directory: &Path,
    record: &PanelScriptFileRecord,
) -> String {
    let execution_target = record
        .execution_target
        .as_deref()
        .map(str::trim)
        .unwrap_or_default();
    if !execution_target.is_empty() {
        return resolve_legacy_windows_binding_path(execution_target);
    }

    if matches!(
        infer_program_template_key(program_name, None),
        "illustrator" | "photoshop"
    ) {
        let panel_name = panel_directory
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if panel_name.eq_ignore_ascii_case("Files") {
            if let Ok(local_directory) = resolve_program_local_scripts_directory(program_name) {
                let local_path = local_directory.join(&record.file_name);
                if local_path.is_file() {
                    return local_path.to_string_lossy().to_string();
                }
            }
            if let Ok(git_panel_directory) =
                resolve_program_git_scripts_picker_directory(program_name, panel_name)
            {
                let git_path = git_panel_directory.join(&record.file_name);
                if git_path.is_file() {
                    return git_path.to_string_lossy().to_string();
                }
            }
        }
    }

    panel_directory
        .join(&record.file_name)
        .to_string_lossy()
        .to_string()
}

fn find_binding_for_target(
    bindings: &FrontendBindingsState,
    program_tab_id: i64,
    target: &str,
) -> Option<(u64, String)> {
    let normalized_target = normalize_binding_target_for_compare(target);
    if normalized_target.is_empty() {
        return None;
    }

    bindings.script_bindings.iter().find_map(|binding| {
        let binding_id = binding.id.or(binding.binding_id).unwrap_or(0);
        let binding_program_tab_id = binding.program_tab_id.unwrap_or(0);
        let same_target =
            normalize_binding_target_for_compare(&binding.target) == normalized_target;
        if same_target && (binding_program_tab_id == program_tab_id || program_tab_id == 0) {
            return Some((binding_id, binding.shortcut.clone()));
        }
        None
    })
}

fn list_bindable_buttons_for_panel(
    program_name: &str,
    panel_name: &str,
    bindings: &FrontendBindingsState,
) -> Result<Vec<BindableButtonRecord>, String> {
    let panel_directory = resolve_panel_directory(program_name, panel_name)?;
    let records = if is_windows_program_name(program_name) {
        list_windows_panel_script_files(&panel_directory)?
    } else if is_blender_program_name(program_name) {
        list_blender_panel_script_files(&panel_directory)?
    } else if matches!(
        infer_program_template_key(program_name, None),
        "illustrator" | "photoshop"
    ) {
        list_adobe_panel_script_files(&panel_directory)?
    } else {
        list_generic_panel_script_files(&panel_directory)?
    };

    let program_tab_id = resolve_program_tab_id(program_name);
    let mut buttons = records
        .into_iter()
        .map(|record| {
            let is_macro_button = record
                .kind
                .as_deref()
                .map(|kind| kind.eq_ignore_ascii_case(FRONTEND_MACRO_KIND))
                .unwrap_or(false);
            let macro_id = if is_macro_button {
                let record_path = panel_directory.join(&record.file_name);
                read_panel_item_file(&record_path)
                    .ok()
                    .map(|item| item.macro_id.trim().to_string())
                    .unwrap_or_default()
            } else {
                String::new()
            };
            let target = resolve_bindable_button_target(program_name, &panel_directory, &record);
            let binding = if is_macro_button && !macro_id.is_empty() {
                bindings
                    .action_hotkeys
                    .get(&macro_id)
                    .cloned()
                    .map(|shortcut| (0, shortcut))
            } else {
                find_binding_for_target(bindings, program_tab_id, &target)
            };
            BindableButtonRecord {
                id: format!("{program_name}::{panel_name}::{}", record.file_name),
                label: record.label,
                kind: record.kind.unwrap_or_else(|| String::from("script")),
                target: if is_macro_button && !macro_id.is_empty() {
                    macro_id
                } else {
                    target
                },
                execution_target: None,
                binding_id: binding.as_ref().map(|(binding_id, _)| *binding_id),
                shortcut: binding.map(|(_, shortcut)| shortcut),
            }
        })
        .collect::<Vec<_>>();
    buttons.sort_by_cached_key(|button| button.label.to_ascii_lowercase());
    Ok(buttons)
}

fn append_core_bind_actions_for_program(
    program_name: &str,
    panels: &mut Vec<BindablePanelRecord>,
    bindings: &FrontendBindingsState,
) {
    let helper_is_available = resolve_program_directory(program_name)
        .map(|directory| {
            directory
                .join("HelperScripts")
                .join("FlowCell_Illustrator_SetAnchorHotkey.jsx")
                .is_file()
        })
        .unwrap_or(false);
    append_core_bind_actions_for_program_with_availability(
        program_name,
        helper_is_available,
        panels,
        bindings,
    );
}

fn append_core_bind_actions_for_program_with_availability(
    program_name: &str,
    helper_is_available: bool,
    panels: &mut Vec<BindablePanelRecord>,
    bindings: &FrontendBindingsState,
) {
    if !is_illustrator_program_name(program_name) || !helper_is_available {
        return;
    }

    let button = BindableButtonRecord {
        id: format!("{program_name}::core-action::{ILLUSTRATOR_SET_ANCHOR_ACTION_ID}"),
        label: String::from("Set Anchor"),
        kind: String::from(CORE_ACTION_KIND),
        target: String::from(ILLUSTRATOR_SET_ANCHOR_ACTION_ID),
        execution_target: None,
        binding_id: None,
        shortcut: bindings
            .action_hotkeys
            .get(ILLUSTRATOR_SET_ANCHOR_ACTION_ID)
            .cloned(),
    };

    if let Some(panel) = panels
        .iter_mut()
        .find(|panel| panel.name.eq_ignore_ascii_case(CORE_ACTIONS_PANEL_NAME))
    {
        panel.buttons.push(button);
        panel
            .buttons
            .sort_by_cached_key(|entry| entry.label.to_ascii_lowercase());
        return;
    }

    panels.insert(
        0,
        BindablePanelRecord {
            name: String::from(CORE_ACTIONS_PANEL_NAME),
            buttons: vec![button],
        },
    );
}

#[cfg(test)]
mod core_bind_action_tests {
    use super::*;

    #[test]
    fn set_anchor_is_only_added_for_illustrator() {
        let bindings = FrontendBindingsState::default();
        let mut photoshop_panels = Vec::new();
        append_core_bind_actions_for_program_with_availability(
            "Photoshop",
            true,
            &mut photoshop_panels,
            &bindings,
        );
        assert!(photoshop_panels.is_empty());

        let mut missing_payload_panels = Vec::new();
        append_core_bind_actions_for_program_with_availability(
            "Illustrator",
            false,
            &mut missing_payload_panels,
            &bindings,
        );
        assert!(missing_payload_panels.is_empty());

        let mut illustrator_panels = Vec::new();
        append_core_bind_actions_for_program_with_availability(
            "Illustrator",
            true,
            &mut illustrator_panels,
            &bindings,
        );
        assert_eq!(illustrator_panels.len(), 1);
        assert_eq!(illustrator_panels[0].name, CORE_ACTIONS_PANEL_NAME);
        assert_eq!(illustrator_panels[0].buttons.len(), 1);
        assert_eq!(
            illustrator_panels[0].buttons[0].target,
            ILLUSTRATOR_SET_ANCHOR_ACTION_ID
        );
    }

    #[test]
    fn set_anchor_uses_the_saved_action_shortcut() {
        let mut bindings = FrontendBindingsState::default();
        bindings.action_hotkeys.insert(
            String::from(ILLUSTRATOR_SET_ANCHOR_ACTION_ID),
            String::from("^!a"),
        );
        let mut panels = Vec::new();
        append_core_bind_actions_for_program_with_availability(
            "Illustrator",
            true,
            &mut panels,
            &bindings,
        );
        assert_eq!(panels[0].buttons[0].shortcut.as_deref(), Some("^!a"));
    }
}

fn read_shortcut_profile_documents(
) -> Result<(Vec<ShortcutProfileDocumentRecord>, Vec<String>), String> {
    let mut documents = Vec::new();
    let mut warnings = Vec::new();
    let roots = vec![
        (resolve_shortcut_profiles_config_root()?, false),
        (resolve_shortcut_profiles_local_root()?, true),
    ];

    for (root, is_local_override) in roots {
        if !root.is_dir() {
            continue;
        }

        let mut entries = fs::read_dir(&root)
            .map_err(|error| format!("Failed to read {}: {error}", root.display()))?
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_file())
            .collect::<Vec<_>>();
        entries
            .sort_by_cached_key(|entry| entry.file_name().to_string_lossy().to_ascii_lowercase());

        for entry in entries {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if !file_name.to_ascii_lowercase().ends_with(".json") {
                continue;
            }

            let path = entry.path();
            let raw_contents = match fs::read_to_string(&path) {
                Ok(contents) => contents,
                Err(error) => {
                    warnings.push(format!(
                        "Shortcut profile {} could not be read: {error}",
                        file_name
                    ));
                    continue;
                }
            };

            let mut profile = match serde_json::from_str::<ShortcutProfileFile>(&raw_contents) {
                Ok(profile) => profile,
                Err(error) => {
                    warnings.push(format!(
                        "Shortcut profile {} is malformed: {error}",
                        file_name
                    ));
                    continue;
                }
            };

            let inferred_profile_id =
                resolve_shortcut_profile_id_from_file_name(&file_name).unwrap_or_default();
            let profile_id = if profile.id.trim().is_empty() {
                inferred_profile_id
            } else {
                profile.id.trim().to_string()
            };
            if profile_id.trim().is_empty() {
                warnings.push(format!(
                    "Shortcut profile {} is missing a profile id and was ignored.",
                    file_name
                ));
                continue;
            }

            profile.id = profile_id.clone();
            documents.push(ShortcutProfileDocumentRecord {
                file_name,
                profile_id,
                is_local_override,
                profile,
            });
        }
    }

    Ok((documents, warnings))
}

fn resolve_blender_scripts_library_directory() -> Result<PathBuf, String> {
    let program_directory = resolve_program_directory("Blender")?;
    let scripts_directory = resolve_program_git_scripts_directory("Blender")?;
    if scripts_directory.is_dir() {
        Ok(scripts_directory)
    } else {
        Ok(program_directory)
    }
}

fn resolve_blender_scripts_picker_directory(panel_name: &str) -> Result<PathBuf, String> {
    resolve_program_git_scripts_picker_directory("Blender", panel_name)
        .or_else(|_| resolve_blender_scripts_library_directory())
}

fn resolve_illustrator_scripts_library_directory() -> Result<PathBuf, String> {
    let program_directory = resolve_program_directory("Illustrator")?;
    let scripts_directory = resolve_program_git_scripts_directory("Illustrator")?;
    if scripts_directory.is_dir() {
        Ok(scripts_directory)
    } else {
        Ok(program_directory)
    }
}

fn resolve_photoshop_scripts_library_directory() -> Result<PathBuf, String> {
    let program_directory = resolve_program_directory("Photoshop")?;
    let scripts_directory = resolve_program_git_scripts_directory("Photoshop")?;
    if scripts_directory.is_dir() {
        Ok(scripts_directory)
    } else {
        Ok(program_directory)
    }
}

fn resolve_adobe_scripts_library_directory(program_name: &str) -> Result<PathBuf, String> {
    if is_illustrator_program_name(program_name) {
        return resolve_illustrator_scripts_library_directory();
    }
    if is_photoshop_program_name(program_name) {
        return resolve_photoshop_scripts_library_directory();
    }

    Err(format!(
        "Adobe script library resolution is not wired for '{}'.",
        program_name
    ))
}

fn format_panel_item_stem(label: &str) -> String {
    let mut stem = label
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    while stem.contains("__") {
        stem = stem.replace("__", "_");
    }
    stem = stem.trim_matches('_').to_string();
    if stem.is_empty() {
        "button".to_string()
    } else {
        stem
    }
}

fn panel_item_path_for_label(panel_directory: &Path, label: &str) -> PathBuf {
    panel_directory.join(format!(
        "{}{}",
        format_panel_item_stem(label),
        BLENDER_PANEL_ITEM_SUFFIX
    ))
}

fn read_panel_item_file(path: &Path) -> Result<BlenderPanelItemRecord, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    serde_json::from_str::<BlenderPanelItemRecord>(&content)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))
}

fn write_panel_item_file(path: &Path, record: &BlenderPanelItemRecord) -> Result<(), String> {
    let content = serde_json::to_string_pretty(record)
        .map_err(|error| format!("Failed to serialize panel item '{}': {error}", record.label))?;
    fs::write(path, content).map_err(|error| format!("Failed to write {}: {error}", path.display()))
}

fn parse_flowcell_children(path: &Path) -> Result<Vec<PanelScriptChildRecord>, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let mut children = Vec::new();

    for line in content.lines() {
        let Some(rest) = parse_flowcell_directive_value(line, "FLOWCELL_CHILD") else {
            continue;
        };
        let parts = rest
            .splitn(3, '|')
            .map(|part| part.trim())
            .collect::<Vec<_>>();
        if parts.len() < 3 {
            continue;
        }
        if parts[0].is_empty() || parts[1].is_empty() {
            continue;
        }
        children.push(PanelScriptChildRecord {
            slot: parts[0].to_string(),
            label: parts[1].to_string(),
            tooltip: parts[2].to_string(),
        });
    }

    Ok(children)
}

fn parse_flowcell_kind(path: &Path) -> Result<Option<String>, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;

    for line in content.lines() {
        if let Some(kind) = parse_flowcell_directive_value(line, "FLOWCELL_KIND") {
            if !kind.trim().is_empty() {
                return Ok(Some(kind.trim().to_string()));
            }
        }
    }

    Ok(None)
}

fn is_rotate_tool_children(children: &[PanelScriptChildRecord]) -> bool {
    const REQUIRED_SLOTS: &[&str] = &[
        "axis_z",
        "axis_y",
        "axis_x",
        "preset_30",
        "preset_45",
        "preset_90",
        "preset_180",
        "preset_270",
        "center_geometry",
        "center_origin",
        "center_world",
        "center_cursor",
        "center_object",
        "mode_transform",
        "mode_distribute",
        "apply_negative",
        "apply_positive",
    ];

    REQUIRED_SLOTS.iter().all(|required| {
        children
            .iter()
            .any(|child| child.slot.eq_ignore_ascii_case(required))
    })
}

fn is_illustrator_rotate_tool_children(children: &[PanelScriptChildRecord]) -> bool {
    const REQUIRED_SLOTS: &[&str] = &[
        "preset_30",
        "preset_45",
        "preset_90",
        "center_world",
        "center_cursor",
        "mode_transform",
        "mode_distribute",
        "apply_negative",
        "apply_positive",
    ];

    REQUIRED_SLOTS.iter().all(|required| {
        children
            .iter()
            .any(|child| child.slot.eq_ignore_ascii_case(required))
    })
}

fn is_alignment_tool_children(children: &[PanelScriptChildRecord]) -> bool {
    const REQUIRED_SLOTS: &[&str] = &[
        "z_min",
        "z_center",
        "z_max",
        "z_surface",
        "z_geo",
        "y_min",
        "y_center",
        "y_max",
        "y_surface",
        "y_geo",
        "x_min",
        "x_center",
        "x_max",
        "x_surface",
        "x_geo",
        "center_everything",
    ];

    REQUIRED_SLOTS.iter().all(|required| {
        children
            .iter()
            .any(|child| child.slot.eq_ignore_ascii_case(required))
    })
}

fn is_illustrator_alignment_tool_children(children: &[PanelScriptChildRecord]) -> bool {
    const REQUIRED_SLOTS: &[&str] = &[
        "x_min",
        "x_center",
        "x_max",
        "x_surface",
        "x_geo",
        "y_min",
        "y_center",
        "y_max",
        "y_surface",
        "y_geo",
        "center_artboard",
        "center_everything",
    ];

    REQUIRED_SLOTS.iter().all(|required| {
        children
            .iter()
            .any(|child| child.slot.eq_ignore_ascii_case(required))
    })
}

fn is_smart_axis_tool_children(children: &[PanelScriptChildRecord]) -> bool {
    const REQUIRED_SLOTS: &[&str] = &["baseline", "cycle_x", "cycle_y", "cycle_z", "toggle_live"];

    REQUIRED_SLOTS.iter().all(|required| {
        children
            .iter()
            .any(|child| child.slot.eq_ignore_ascii_case(required))
    })
}

fn is_boolean_tool_children(children: &[PanelScriptChildRecord]) -> bool {
    const REQUIRED_SLOTS: &[&str] = &[
        "operation_intersect",
        "operation_union",
        "operation_difference",
        "toggle_self_intersection",
        "toggle_hole_tolerant",
        "toggle_hide_cutter",
        "toggle_backup_active",
        "run_boolean",
    ];

    REQUIRED_SLOTS.iter().all(|required| {
        children
            .iter()
            .any(|child| child.slot.eq_ignore_ascii_case(required))
    })
}

fn is_remesh_tool_children(children: &[PanelScriptChildRecord]) -> bool {
    const REQUIRED_SLOTS: &[&str] = &[
        "mode_voxel",
        "mode_smooth",
        "mode_sharp",
        "mode_blocks",
        "create_update_remesh",
        "apply_remesh",
    ];

    REQUIRED_SLOTS.iter().all(|required| {
        children
            .iter()
            .any(|child| child.slot.eq_ignore_ascii_case(required))
    })
}

fn is_tri_poly_tool_children(children: &[PanelScriptChildRecord]) -> bool {
    const REQUIRED_SLOTS: &[&str] = &[
        "triangle_equilateral",
        "triangle_isosceles",
        "triangle_50",
        "triangle_right",
        "triangle_scalene",
        "polygon_create",
    ];

    REQUIRED_SLOTS.iter().all(|required| {
        children
            .iter()
            .any(|child| child.slot.eq_ignore_ascii_case(required))
    })
}

fn is_dimensions_tool_children(children: &[PanelScriptChildRecord]) -> bool {
    const REQUIRED_SLOTS: &[&str] = &["dimension_x", "dimension_y", "dimension_z"];

    REQUIRED_SLOTS.iter().all(|required| {
        children
            .iter()
            .any(|child| child.slot.eq_ignore_ascii_case(required))
    })
}

fn has_toolset_children(children: &[PanelScriptChildRecord]) -> bool {
    !children.is_empty()
}

fn is_blender_toolset_kind(kind: &str) -> bool {
    kind.eq_ignore_ascii_case(ROTATE_TOOL_KIND)
        || kind.eq_ignore_ascii_case(ALIGNMENT_TOOL_KIND)
        || kind.eq_ignore_ascii_case(BOOLEAN_TOOL_KIND)
        || kind.eq_ignore_ascii_case(DIMENSIONS_TOOL_KIND)
        || kind.eq_ignore_ascii_case(REMESH_TOOL_KIND)
        || kind.eq_ignore_ascii_case(TRI_POLY_TOOL_KIND)
        || kind.eq_ignore_ascii_case(SMART_AXIS_TOOL_KIND)
        || kind.eq_ignore_ascii_case(TOOLSET_KIND)
}

fn is_blender_toolset_record(record: &BlenderPanelItemRecord) -> bool {
    is_blender_toolset_kind(&record.kind) || has_toolset_children(&record.children)
}

fn source_file_name_matches(source_path: &Path, expected_names: &[&str]) -> bool {
    source_path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| {
            expected_names
                .iter()
                .any(|expected| value.eq_ignore_ascii_case(expected))
        })
        .unwrap_or(false)
}

fn classify_blender_panel_item_kind(
    label: &str,
    source_path: &Path,
    children: &[PanelScriptChildRecord],
) -> Option<&'static str> {
    if is_smart_axis_tool_children(children)
        || label.eq_ignore_ascii_case("smart axis")
        || label.eq_ignore_ascii_case("smart axis lock")
        || source_file_name_matches(
            source_path,
            &[
                "smart axis.py",
                "smart_axis.py",
                "smart axis lock.py",
                "smart_axis_lock.py",
            ],
        )
    {
        return Some(SMART_AXIS_TOOL_KIND);
    }

    if is_alignment_tool_children(children)
        || label.eq_ignore_ascii_case("alignment tools")
        || source_file_name_matches(source_path, &["alignment tools.py", "alignment_tools.py"])
    {
        return Some(ALIGNMENT_TOOL_KIND);
    }

    if is_rotate_tool_children(children)
        || label.eq_ignore_ascii_case("rotate")
        || source_file_name_matches(source_path, &["rotate.py"])
    {
        return Some(ROTATE_TOOL_KIND);
    }

    if is_boolean_tool_children(children)
        || label.eq_ignore_ascii_case("boolean")
        || label.eq_ignore_ascii_case("quick boolean")
        || source_file_name_matches(source_path, &["boolean.py"])
    {
        return Some(BOOLEAN_TOOL_KIND);
    }

    if is_remesh_tool_children(children)
        || label.eq_ignore_ascii_case("remesh")
        || source_file_name_matches(source_path, &["remesh.py"])
    {
        return Some(REMESH_TOOL_KIND);
    }

    if is_tri_poly_tool_children(children)
        || label.eq_ignore_ascii_case("tri poly")
        || label.eq_ignore_ascii_case("tri & poly")
        || source_file_name_matches(source_path, &["tri poly.py", "tri_poly.py"])
    {
        return Some(TRI_POLY_TOOL_KIND);
    }

    if is_dimensions_tool_children(children)
        || label.eq_ignore_ascii_case("xyz dimensions")
        || label.eq_ignore_ascii_case("dimensions")
        || source_file_name_matches(source_path, &["xyz dimensions.py", "xyz_dimensions.py"])
    {
        return Some(DIMENSIONS_TOOL_KIND);
    }

    if has_toolset_children(children) {
        return Some(TOOLSET_KIND);
    }

    None
}

fn default_blender_tool_bridge_action(kind: &str) -> &'static str {
    if kind.eq_ignore_ascii_case(ALIGNMENT_TOOL_KIND) {
        DEFAULT_ALIGNMENT_BRIDGE_ACTION
    } else if kind.eq_ignore_ascii_case(BOOLEAN_TOOL_KIND) {
        DEFAULT_BOOLEAN_BRIDGE_ACTION
    } else if kind.eq_ignore_ascii_case(DIMENSIONS_TOOL_KIND) {
        DEFAULT_DIMENSIONS_BRIDGE_ACTION
    } else if kind.eq_ignore_ascii_case(REMESH_TOOL_KIND) {
        DEFAULT_REMESH_BRIDGE_ACTION
    } else if kind.eq_ignore_ascii_case(ROTATE_TOOL_KIND) {
        DEFAULT_ROTATE_BRIDGE_ACTION
    } else if kind.eq_ignore_ascii_case(SMART_AXIS_TOOL_KIND) {
        DEFAULT_SMART_AXIS_BRIDGE_ACTION
    } else {
        ""
    }
}

fn normalize_blender_panel_item_record(record: &BlenderPanelItemRecord) -> BlenderPanelItemRecord {
    if is_frontend_macro_panel_item(record) {
        return BlenderPanelItemRecord {
            label: record.label.trim().to_string(),
            tooltip: record.tooltip.trim().to_string(),
            kind: FRONTEND_MACRO_KIND.to_string(),
            source_path: String::new(),
            execution_target: String::new(),
            bridge_action: String::new(),
            bridge_data: None,
            children: Vec::new(),
            macro_id: record.macro_id.trim().to_string(),
        };
    }

    let source_path = PathBuf::from(record.source_path.trim());
    let children = if source_path.is_file() {
        parse_flowcell_children(&source_path).unwrap_or_else(|_| record.children.clone())
    } else {
        record.children.clone()
    };
    let tool_kind = classify_blender_panel_item_kind(&record.label, &source_path, &children);
    let bridge_action = match tool_kind {
        Some(kind) => {
            let trimmed = record.bridge_action.trim();
            if trimmed.is_empty() {
                default_blender_tool_bridge_action(kind).to_string()
            } else {
                trimmed.to_string()
            }
        }
        None => record.bridge_action.trim().to_string(),
    };

    BlenderPanelItemRecord {
        label: record.label.clone(),
        tooltip: record.tooltip.clone(),
        kind: tool_kind.unwrap_or("script").to_string(),
        source_path: record.source_path.clone(),
        execution_target: record.execution_target.clone(),
        bridge_action,
        bridge_data: record.bridge_data.clone(),
        children,
        macro_id: String::new(),
    }
}

fn read_normalized_panel_item_file(path: &Path) -> Result<BlenderPanelItemRecord, String> {
    let record = read_panel_item_file(path)?;
    let normalized = normalize_blender_panel_item_record(&record);
    if normalized != record {
        write_panel_item_file(path, &normalized)?;
    }
    Ok(normalized)
}

fn list_blender_panel_script_files(
    panel_directory: &Path,
) -> Result<Vec<PanelScriptFileRecord>, String> {
    let mut records = Vec::new();
    let entries = fs::read_dir(panel_directory)
        .map_err(|error| format!("Failed to read {}: {error}", panel_directory.display()))?;

    for entry in entries {
        let entry = entry
            .map_err(|error| format!("Failed to read {}: {error}", panel_directory.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;

        if !file_type.is_file() {
            continue;
        }

        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if !file_name
            .to_ascii_lowercase()
            .ends_with(BLENDER_PANEL_ITEM_SUFFIX)
        {
            continue;
        }

        let record = read_normalized_panel_item_file(&path)?;
        let is_macro_record = is_frontend_macro_panel_item(&record);
        records.push(PanelScriptFileRecord {
            file_name,
            label: record.label,
            tooltip: if record.tooltip.trim().is_empty() {
                None
            } else {
                Some(record.tooltip)
            },
            kind: Some(record.kind),
            execution_target: if record.execution_target.trim().is_empty() {
                None
            } else {
                Some(record.execution_target)
            },
            bridge_action: if record.bridge_action.trim().is_empty() {
                None
            } else {
                Some(record.bridge_action)
            },
            bridge_data: record.bridge_data,
            children: if record.children.is_empty() {
                None
            } else {
                Some(record.children)
            },
            macro_id: if is_macro_record {
                Some(record.macro_id)
            } else {
                None
            },
        });
    }

    records.sort_by_cached_key(|record| record.label.to_ascii_lowercase());
    Ok(records)
}

fn resolve_blender_panel_item_path(
    panel_directory: &Path,
    file_name: &str,
) -> Result<PathBuf, String> {
    let validated_file_name = validate_panel_script_file_name(file_name)?;
    if !validated_file_name
        .to_ascii_lowercase()
        .ends_with(BLENDER_PANEL_ITEM_SUFFIX)
    {
        return Err(format!(
            "Panel item '{}' is not a supported Blender panel record.",
            validated_file_name
        ));
    }

    let record_path = panel_directory.join(&validated_file_name);
    if !record_path.is_file() {
        return Err(format!(
            "Panel item '{}' was not found in {}.",
            validated_file_name,
            panel_directory.display()
        ));
    }

    Ok(record_path)
}

fn resolve_blender_panel_item_record(
    program_name: &str,
    panel_name: &str,
    file_name: &str,
) -> Result<BlenderPanelItemRecord, String> {
    if !is_blender_program_name(program_name) {
        return Err(format!(
            "Blender panel items are only available for Blender, not '{}'.",
            program_name
        ));
    }

    let panel_directory = resolve_panel_directory(program_name, panel_name)?;
    let record_path = resolve_blender_panel_item_path(&panel_directory, file_name)?;

    read_normalized_panel_item_file(&record_path)
}

fn escape_powershell_single_quoted(value: &str) -> String {
    value.replace('\'', "''")
}

fn should_return_blender_bridge_message_without_alert(message: &str) -> bool {
    let normalized = message.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }

    !normalized.starts_with("timed out")
        && !normalized.contains("could not resolve")
        && !normalized.contains("could not determine")
        && !normalized.contains("not running")
        && !normalized.contains("failed to ")
        && !normalized.contains("request lock")
}

fn normalize_blender_bridge_data(data: Option<Value>) -> Value {
    match data {
        Some(Value::Null) | None => Value::Object(Map::new()),
        Some(value) => value,
    }
}

fn spawn_powershell_output(arguments: &[String]) -> Result<std::process::Output, String> {
    let mut command = Command::new(resolve_powershell_path());
    command
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass");
    for argument in arguments {
        command.arg(argument);
    }
    command
        .output()
        .map_err(|error| format!("Failed to start PowerShell: {error}"))
}

fn format_process_failure(output: &std::process::Output, fallback: &str) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        return stdout;
    }

    fallback.to_string()
}

fn resolve_illustrator_bridge_invoke_script() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root()
        .ok_or_else(|| "FlowCell repo root could not be resolved for Illustrator bridge.".to_string())?;
    let invoke_script = repo_root
        .join("Programs")
        .join("Illustrator")
        .join("SupportScripts")
        .join("Invoke-IllustratorFlowCellAction.ps1");
    if !invoke_script.is_file() {
        return Err(format!(
            "Illustrator bridge runner was not found at {}.",
            invoke_script.display()
        ));
    }
    Ok(invoke_script)
}

fn base64_encode_standard(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 63) as usize] as char);
        out.push(TABLE[((triple >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// Encodes a PowerShell command for `-EncodedCommand` (base64 of UTF-16LE).
/// This is the only reliable way to pass a JSON argument (with embedded double
/// quotes) to powershell.exe — `-File`/`-Command` quoting strips the quotes.
fn encode_powershell_command(command: &str) -> String {
    let mut bytes = Vec::with_capacity(command.len() * 2);
    for unit in command.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    base64_encode_standard(&bytes)
}

fn run_illustrator_layers_action_blocking(args_json: String) -> Result<String, String> {
    let invoke_script = resolve_illustrator_bridge_invoke_script()?;
    // Generous cold-start budget: the warm bridge replies in milliseconds, but a
    // first call may have to launch the STA bridge and activate Illustrator COM.
    let command = format!(
        "& '{}' -ActionId 'ill-layers' -ArgsJson '{}' -ConnectTimeoutMs 2000 -StartTimeoutMs 25000 -Wait",
        escape_powershell_single_quoted(&invoke_script.to_string_lossy()),
        escape_powershell_single_quoted(&args_json)
    );
    let arguments = vec![
        "-EncodedCommand".to_string(),
        encode_powershell_command(&command),
    ];

    let output = spawn_powershell_output(&arguments)?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    append_flowcell_local_log(
        "layers-builder.log",
        &format!(
            "args={} exit={:?} stdout_len={} stderr={}",
            args_json,
            output.status.code(),
            stdout.len(),
            stderr.chars().take(600).collect::<String>()
        ),
    );

    if !output.status.success() {
        return Err(format_process_failure(
            &output,
            "Illustrator layers action failed.",
        ));
    }
    if stdout.is_empty() {
        return Err("Illustrator layers action returned no response.".to_string());
    }
    Ok(stdout)
}

/// Runs the `ill-layers` bridge action (scan or mutate the layer tree) and
/// returns the raw response JSON printed by Invoke-IllustratorFlowCellAction.ps1
/// (`-Wait`). The frontend parses the nested `result` payload built by the JSX.
/// Async + spawn_blocking so the (possibly multi-second cold-start) PowerShell
/// call never blocks the WebView main thread / freezes the window.
#[tauri::command]
async fn run_illustrator_layers_action(args_json: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run_illustrator_layers_action_blocking(args_json))
        .await
        .map_err(|error| format!("Illustrator layers task failed: {error}"))?
}

/// Persists the FlowCell-highlighted layer keys so the Layers Builder panel
/// buttons (which run inside Illustrator) can resolve the same targets. The
/// canonical copy lives under FlowCell/local; a mirror is written to the OS temp
/// folder because the in-Illustrator `.jsx` reads it via ExtendScript's
/// `Folder.temp` (no repo-root path derivation needed).
#[tauri::command]
fn set_illustrator_layers_highlight(keys: Vec<String>) -> Result<(), String> {
    let body = serde_json::to_string(&json!({ "keys": keys }))
        .map_err(|error| format!("Failed to serialize highlight set: {error}"))?;

    let local_root = resolve_flowcell_local_root()?;
    fs::create_dir_all(&local_root)
        .map_err(|error| format!("Failed to create FlowCell local folder: {error}"))?;
    fs::write(local_root.join("illustrator-layers-highlight.json"), &body)
        .map_err(|error| format!("Failed to write highlight set: {error}"))?;

    let temp_path = std::env::temp_dir().join("flowcell-illustrator-layers-highlight.json");
    fs::write(&temp_path, &body)
        .map_err(|error| format!("Failed to write highlight mirror: {error}"))?;

    Ok(())
}

fn wait_for_child_output_with_timeout(
    mut child: std::process::Child,
    timeout: Duration,
    timeout_message: &str,
) -> Result<std::process::Output, String> {
    let start = Instant::now();
    loop {
        match child
            .try_wait()
            .map_err(|error| format!("Failed while waiting for child process: {error}"))?
        {
            Some(_) => {
                return child
                    .wait_with_output()
                    .map_err(|error| format!("Failed to read child process output: {error}"));
            }
            None if start.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(timeout_message.to_string());
            }
            None => thread::sleep(Duration::from_millis(50)),
        }
    }
}

fn resolve_windows_scripts_library_directory() -> Result<PathBuf, String> {
    let program_directory = resolve_program_directory("Windows")?;
    let scripts_directory = resolve_program_git_scripts_directory("Windows")?;
    if scripts_directory.is_dir() {
        Ok(scripts_directory)
    } else {
        Ok(program_directory)
    }
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct CodexUsageSnapshot {
    five_hour_remaining_percent: Option<f64>,
    weekly_remaining_percent: Option<f64>,
    source_timestamp: Option<String>,
    source_path: Option<String>,
}

struct CodexUsageCandidate {
    timestamp: String,
    timestamp_millis: i64,
    source_path: PathBuf,
    five_hour_remaining_percent: f64,
    weekly_remaining_percent: f64,
}

fn resolve_codex_home_directory() -> Option<PathBuf> {
    if let Some(path) = env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
    {
        return Some(path);
    }

    if let Some(path) = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|path| path.join("CodexClean"))
        .filter(|path| path.is_dir())
    {
        return Some(path);
    }

    for key in ["USERPROFILE", "HOME"] {
        let Some(home_directory) = env::var_os(key).map(PathBuf::from) else {
            continue;
        };
        let candidate = home_directory
            .join("AppData")
            .join("Local")
            .join("CodexClean");
        if candidate.is_dir() {
            return Some(candidate);
        }
    }

    for key in ["USERPROFILE", "HOME"] {
        let Some(home_directory) = env::var_os(key).map(PathBuf::from) else {
            continue;
        };
        let candidate = home_directory.join(".codex");
        if candidate.is_dir() {
            return Some(candidate);
        }
    }

    None
}

fn is_codex_session_file(path: &Path) -> bool {
    let extension_matches = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("jsonl"))
        .unwrap_or(false);
    if !extension_matches {
        return false;
    }

    path.file_name()
        .and_then(|file_name| file_name.to_str())
        .map(|file_name| file_name.to_ascii_lowercase().starts_with("rollout-"))
        .unwrap_or(false)
}

fn collect_codex_session_files_recursive(
    directory: &Path,
    remaining_depth: usize,
    files: &mut Vec<(SystemTime, PathBuf)>,
) {
    if remaining_depth == 0 {
        return;
    }

    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };

        if metadata.is_dir() {
            collect_codex_session_files_recursive(&path, remaining_depth - 1, files);
            continue;
        }

        if metadata.is_file() && is_codex_session_file(&path) {
            files.push((metadata.modified().unwrap_or(UNIX_EPOCH), path));
        }
    }
}

fn collect_recent_codex_session_files(sessions_directory: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    collect_codex_session_files_recursive(sessions_directory, 5, &mut files);
    files.sort_by(|left, right| right.0.cmp(&left.0));
    files.truncate(CODEX_SESSION_SCAN_LIMIT);
    files.into_iter().map(|(_, path)| path).collect()
}

fn read_codex_session_tail(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    let start_offset = length.saturating_sub(CODEX_SESSION_TAIL_BYTES);
    file.seek(SeekFrom::Start(start_offset)).ok()?;

    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    let mut tail = String::from_utf8_lossy(&bytes).into_owned();
    if start_offset > 0 {
        if let Some(line_break_index) = tail.find('\n') {
            tail = tail[line_break_index + 1..].to_string();
        }
    }

    Some(tail)
}

fn codex_window_minutes(record: &Value) -> Option<i64> {
    let value = record.get("window_minutes")?;
    if let Some(minutes) = value.as_i64() {
        return Some(minutes);
    }

    let minutes = value.as_f64()?;
    if !minutes.is_finite() {
        return None;
    }

    Some(minutes.round() as i64)
}

fn codex_remaining_percent(record: &Value) -> Option<f64> {
    let used_percent = record.get("used_percent")?.as_f64()?;
    if !used_percent.is_finite() {
        return None;
    }

    Some((100.0 - used_percent).clamp(0.0, 100.0))
}

fn codex_weekly_used_percent(candidate: &CodexUsageCandidate) -> f64 {
    (100.0 - candidate.weekly_remaining_percent).clamp(0.0, 100.0)
}

fn codex_candidate_meets_weekly_baseline(
    candidate: &CodexUsageCandidate,
    minimum_weekly_used_percent: Option<f64>,
) -> bool {
    let Some(minimum_weekly_used_percent) = minimum_weekly_used_percent else {
        return true;
    };

    codex_weekly_used_percent(candidate) + CODEX_USAGE_WEEKLY_BASELINE_TOLERANCE_PERCENT
        >= minimum_weekly_used_percent
}

fn parse_codex_rfc3339_timestamp_millis(timestamp: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|value| value.with_timezone(&Utc).timestamp_millis())
}

fn codex_usage_candidate_from_rate_limits(
    rate_limits: &Value,
    timestamp: String,
    timestamp_millis: i64,
    source_path: &Path,
) -> Option<CodexUsageCandidate> {
    let primary = rate_limits.get("primary")?;
    let secondary = rate_limits.get("secondary")?;
    if codex_window_minutes(primary)? != 300 || codex_window_minutes(secondary)? != 10080 {
        return None;
    }

    Some(CodexUsageCandidate {
        timestamp,
        timestamp_millis,
        source_path: source_path.to_path_buf(),
        five_hour_remaining_percent: codex_remaining_percent(primary)?,
        weekly_remaining_percent: codex_remaining_percent(secondary)?,
    })
}

fn parse_codex_usage_event(line: &str, source_path: &Path) -> Option<CodexUsageCandidate> {
    if !line.contains("\"rate_limits\"") || !line.contains("\"token_count\"") {
        return None;
    }

    let parsed = serde_json::from_str::<Value>(line).ok()?;
    let payload = parsed.get("payload").unwrap_or(&parsed);
    let event_type = payload
        .get("type")
        .and_then(Value::as_str)
        .or_else(|| parsed.get("type").and_then(Value::as_str))?;
    if event_type != "token_count" {
        return None;
    }

    let timestamp = parsed
        .get("timestamp")
        .or_else(|| payload.get("timestamp"))
        .and_then(Value::as_str)?
        .trim()
        .to_string();
    if timestamp.is_empty() {
        return None;
    }

    let timestamp_millis = parse_codex_rfc3339_timestamp_millis(&timestamp)?;
    let rate_limits = payload
        .get("rate_limits")
        .or_else(|| parsed.get("rate_limits"))?;
    codex_usage_candidate_from_rate_limits(rate_limits, timestamp, timestamp_millis, source_path)
}

fn parse_codex_rate_limits_log_body(
    body: &str,
    timestamp_seconds: i64,
    source_path: &Path,
) -> Option<CodexUsageCandidate> {
    let parsed = parse_codex_rate_limits_log_payload(body)?;
    if parsed.get("type").and_then(Value::as_str)? != "codex.rate_limits" {
        return None;
    }

    let timestamp_millis = timestamp_seconds.checked_mul(1000)?;
    codex_usage_candidate_from_rate_limits(
        parsed.get("rate_limits")?,
        DateTime::<Utc>::from_timestamp(timestamp_seconds, 0)
            .map(|timestamp| timestamp.to_rfc3339())
            .unwrap_or_else(|| timestamp_seconds.to_string()),
        timestamp_millis,
        source_path,
    )
}

fn parse_json_value_prefix(raw_json: &str) -> Option<Value> {
    let mut deserializer = serde_json::Deserializer::from_str(raw_json.trim());
    Value::deserialize(&mut deserializer).ok()
}

fn parse_codex_rate_limits_log_payload(body: &str) -> Option<Value> {
    for marker in ["websocket event: ", "Received message "] {
        if let Some(marker_index) = body.find(marker) {
            if let Some(parsed) = parse_json_value_prefix(&body[marker_index + marker.len()..]) {
                if parsed.get("type").and_then(Value::as_str) == Some("codex.rate_limits") {
                    return Some(parsed);
                }
            }
        }
    }

    let object_index = body.find('{')?;
    let parsed = parse_json_value_prefix(&body[object_index..])?;
    if parsed.get("type").and_then(Value::as_str) == Some("codex.rate_limits") {
        Some(parsed)
    } else {
        None
    }
}

fn read_latest_codex_rate_limits_log_candidate(
    codex_home_directory: &Path,
) -> Option<CodexUsageCandidate> {
    let logs_database_path = codex_home_directory.join("logs_2.sqlite");
    if !logs_database_path.is_file() {
        return None;
    }

    let connection = Connection::open_with_flags(
        &logs_database_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    let mut statement = connection
        .prepare(
            "select ts, feedback_log_body \
         from logs \
         where feedback_log_body like '%codex.rate_limits%' \
         order by id desc \
         limit 65536",
        )
        .ok()?;
    let mut rows = statement.query([]).ok()?;

    while let Some(row) = rows.next().ok()? {
        let Ok(timestamp_seconds) = row.get::<_, i64>(0) else {
            continue;
        };
        let Ok(body) = row.get::<_, String>(1) else {
            continue;
        };
        if let Some(candidate) =
            parse_codex_rate_limits_log_body(&body, timestamp_seconds, &logs_database_path)
        {
            return Some(candidate);
        }
    }

    None
}

fn read_latest_codex_session_candidate(
    codex_home_directory: &Path,
    minimum_weekly_used_percent: Option<f64>,
) -> Option<CodexUsageCandidate> {
    let sessions_directory = codex_home_directory.join("sessions");
    if !sessions_directory.is_dir() {
        return None;
    }

    let mut latest: Option<CodexUsageCandidate> = None;
    for path in collect_recent_codex_session_files(&sessions_directory) {
        let Some(tail) = read_codex_session_tail(&path) else {
            continue;
        };

        for line in tail.lines().rev() {
            let Some(candidate) = parse_codex_usage_event(line, &path) else {
                continue;
            };
            if !codex_candidate_meets_weekly_baseline(&candidate, minimum_weekly_used_percent) {
                continue;
            }

            if latest
                .as_ref()
                .map(|current| candidate.timestamp_millis > current.timestamp_millis)
                .unwrap_or(true)
            {
                latest = Some(candidate);
            }
            break;
        }
    }

    latest
}

fn select_codex_usage_candidate(
    rate_limits_log_candidate: Option<CodexUsageCandidate>,
    session_candidate: Option<CodexUsageCandidate>,
) -> Option<CodexUsageCandidate> {
    match (rate_limits_log_candidate, session_candidate) {
        (Some(rate_limits_log_candidate), Some(session_candidate)) => {
            if session_candidate.timestamp_millis > rate_limits_log_candidate.timestamp_millis {
                Some(session_candidate)
            } else {
                Some(rate_limits_log_candidate)
            }
        }
        (Some(candidate), None) | (None, Some(candidate)) => Some(candidate),
        (None, None) => None,
    }
}

fn read_latest_codex_usage_candidate() -> Option<CodexUsageCandidate> {
    let codex_home_directory = resolve_codex_home_directory()?;
    let rate_limits_log_candidate =
        read_latest_codex_rate_limits_log_candidate(&codex_home_directory);
    let minimum_weekly_used_percent = rate_limits_log_candidate
        .as_ref()
        .map(codex_weekly_used_percent);
    let session_candidate =
        read_latest_codex_session_candidate(&codex_home_directory, minimum_weekly_used_percent);

    select_codex_usage_candidate(rate_limits_log_candidate, session_candidate)
}

#[tauri::command]
fn get_codex_usage_snapshot() -> Result<CodexUsageSnapshot, String> {
    let Some(candidate) = read_latest_codex_usage_candidate() else {
        return Ok(CodexUsageSnapshot::default());
    };

    Ok(CodexUsageSnapshot {
        five_hour_remaining_percent: Some(candidate.five_hour_remaining_percent),
        weekly_remaining_percent: Some(candidate.weekly_remaining_percent),
        source_timestamp: Some(candidate.timestamp),
        source_path: Some(candidate.source_path.display().to_string()),
    })
}

#[cfg(test)]
mod codex_usage_tests {
    use super::*;
    use serde_json::json;

    fn candidate(
        source_path: &str,
        timestamp_millis: i64,
        five_hour_remaining_percent: f64,
        weekly_remaining_percent: f64,
    ) -> CodexUsageCandidate {
        CodexUsageCandidate {
            timestamp: format!("timestamp-{timestamp_millis}"),
            timestamp_millis,
            source_path: PathBuf::from(source_path),
            five_hour_remaining_percent,
            weekly_remaining_percent,
        }
    }

    #[test]
    fn newer_session_candidate_wins_when_weekly_usage_has_not_gone_backwards() {
        let selected = select_codex_usage_candidate(
            Some(candidate("logs_2.sqlite", 1_000, 74.0, 83.0)),
            Some(candidate("rollout-newer.jsonl", 2_000, 68.0, 82.0)),
        )
        .expect("expected a selected Codex usage candidate");

        assert_eq!(selected.source_path, PathBuf::from("rollout-newer.jsonl"));
        assert_eq!(selected.five_hour_remaining_percent, 68.0);
        assert_eq!(selected.weekly_remaining_percent, 82.0);
    }

    #[test]
    fn session_candidate_below_sqlite_weekly_usage_is_rejected() {
        let sqlite_candidate = candidate("logs_2.sqlite", 1_000, 74.0, 83.0);
        let stale_session_candidate = candidate("rollout-stale.jsonl", 2_000, 97.0, 87.0);

        assert!(!codex_candidate_meets_weekly_baseline(
            &stale_session_candidate,
            Some(codex_weekly_used_percent(&sqlite_candidate))
        ));
    }

    #[test]
    fn session_candidate_is_used_without_sqlite_candidate() {
        let selected = select_codex_usage_candidate(
            None,
            Some(candidate("rollout-fallback.jsonl", 2_000, 97.0, 87.0)),
        )
        .expect("expected session fallback candidate");

        assert_eq!(
            selected.source_path,
            PathBuf::from("rollout-fallback.jsonl")
        );
        assert_eq!(selected.five_hour_remaining_percent, 97.0);
        assert_eq!(selected.weekly_remaining_percent, 87.0);
    }

    #[test]
    fn parses_rate_limit_payload_from_log_prefix() {
        let body = r#"session trace websocket event: {"type":"codex.rate_limits","rate_limits":{"primary":{"window_minutes":300,"used_percent":34.0},"secondary":{"window_minutes":10080,"used_percent":18.0}}}"#;
        let candidate =
            parse_codex_rate_limits_log_body(body, 1_780_340_520, Path::new("logs_2.sqlite"))
                .expect("expected rate-limit candidate from websocket log body");

        assert_eq!(candidate.five_hour_remaining_percent, 66.0);
        assert_eq!(candidate.weekly_remaining_percent, 82.0);
    }

    #[test]
    fn ignores_non_rate_limit_log_payloads_that_mention_rate_limits() {
        let body = r#"Received message {"type":"response.output_item.done","arguments":"{\"rate_limits\":true}"}"#;

        assert!(
            parse_codex_rate_limits_log_body(body, 1_780_340_520, Path::new("logs_2.sqlite"))
                .is_none()
        );
    }

    #[test]
    fn nonmatching_rate_limit_windows_are_ignored() {
        let source_path = Path::new("logs_2.sqlite");
        let invalid_primary_window = json!({
            "primary": { "window_minutes": 60, "used_percent": 10.0 },
            "secondary": { "window_minutes": 10080, "used_percent": 20.0 }
        });
        let invalid_secondary_window = json!({
            "primary": { "window_minutes": 300, "used_percent": 10.0 },
            "secondary": { "window_minutes": 1440, "used_percent": 20.0 }
        });

        assert!(codex_usage_candidate_from_rate_limits(
            &invalid_primary_window,
            "2026-06-01T18:00:00Z".to_string(),
            1_000,
            source_path
        )
        .is_none());
        assert!(codex_usage_candidate_from_rate_limits(
            &invalid_secondary_window,
            "2026-06-01T18:00:00Z".to_string(),
            1_000,
            source_path
        )
        .is_none());
    }
}

fn is_codex_usage_launcher(program_name: &str, panel_name: &str, file_name: &str) -> bool {
    is_windows_program_name(program_name)
        && panel_name.trim().eq_ignore_ascii_case("Utility")
        && file_name.trim().eq_ignore_ascii_case("codex_usage.vbs")
}

fn normalize_path_for_compare(path: &Path) -> String {
    fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_ascii_lowercase()
}

fn path_is_under_directory(path: &Path, directory: &Path) -> bool {
    let normalized_path = normalize_path_for_compare(path);
    let mut normalized_directory = normalize_path_for_compare(directory);
    if normalized_path == normalized_directory {
        return true;
    }
    if !normalized_directory.ends_with('\\') && !normalized_directory.ends_with('/') {
        normalized_directory.push('\\');
    }
    normalized_path.starts_with(&normalized_directory)
}

type IniDocument = HashMap<String, HashMap<String, String>>;

#[derive(Clone, Debug, PartialEq, Eq)]
struct RegisteredProgram {
    id: i64,
    label: String,
}

fn parse_program_tab_section_id(section_name: &str) -> Option<i64> {
    section_name
        .strip_prefix("ProgramTab_")?
        .parse::<i64>()
        .ok()
        .filter(|id| *id > 0)
}

fn registered_programs_from_document(document: &IniDocument) -> Vec<RegisteredProgram> {
    let mut programs = document
        .iter()
        .filter_map(|(section_name, section)| {
            let id = parse_program_tab_section_id(section_name)?;
            let label = section.get("Label")?.trim();
            if label.is_empty() {
                return None;
            }
            Some(RegisteredProgram {
                id,
                label: label.to_string(),
            })
        })
        .collect::<Vec<_>>();
    programs.sort_by_key(|program| program.id);
    programs
}

fn find_registered_program(
    document: &IniDocument,
    program_name: &str,
) -> Option<RegisteredProgram> {
    registered_programs_from_document(document)
        .into_iter()
        .find(|program| program.label.eq_ignore_ascii_case(program_name.trim()))
}

fn registered_program_folder_names(
    available_folder_names: &[String],
    document: &IniDocument,
) -> Vec<String> {
    registered_programs_from_document(document)
        .into_iter()
        .filter_map(|program| {
            available_folder_names
                .iter()
                .find(|folder_name| {
                    !folder_name.to_ascii_lowercase().starts_with("flowcell-")
                        && folder_name.eq_ignore_ascii_case(&program.label)
                })
                .cloned()
        })
        .collect()
}

fn sync_program_registration_meta(document: &mut IniDocument, selected_program_id: Option<i64>) {
    let program_ids = registered_programs_from_document(document)
        .into_iter()
        .map(|program| program.id)
        .collect::<Vec<_>>();
    let next_id = program_ids.iter().copied().max().unwrap_or(0) + 1;
    let meta = document.entry(String::from("Meta")).or_default();
    meta.insert(
        String::from("ProgramTabIds"),
        program_ids
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("|"),
    );
    meta.insert(String::from("ProgramTabNextId"), next_id.max(1).to_string());
    let existing_selected_id = meta
        .get("SelectedProgramTabId")
        .and_then(|value| value.parse::<i64>().ok());
    let effective_selected_id = selected_program_id
        .filter(|program_id| program_ids.contains(program_id))
        .or_else(|| existing_selected_id.filter(|program_id| program_ids.contains(program_id)))
        .or_else(|| program_ids.first().copied())
        .unwrap_or(0);
    meta.insert(
        String::from("SelectedProgramTabId"),
        effective_selected_id.to_string(),
    );
}

fn program_registration_id(document: &IniDocument, program_name: &str) -> i64 {
    if let Some(program) = find_registered_program(document, program_name) {
        return program.id;
    }

    let used_ids = registered_programs_from_document(document)
        .into_iter()
        .map(|program| program.id)
        .collect::<HashSet<_>>();
    let preferred_id = canonical_program_tab_id(program_name);
    if preferred_id > 0 && !used_ids.contains(&preferred_id) {
        return preferred_id;
    }

    document
        .get("Meta")
        .and_then(|section| section.get("ProgramTabNextId"))
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or_else(|| used_ids.iter().copied().max().unwrap_or(0) + 1)
        .max(used_ids.iter().copied().max().unwrap_or(0) + 1)
        .max(1)
}

fn write_program_registration_section(
    document: &mut IniDocument,
    program_id: i64,
    program_name: &str,
    program_path: &Path,
    exe_path: &str,
) {
    let template_key = infer_program_template_key(program_name, Some(exe_path));
    let process_name = Path::new(exe_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let git_scripts_path = program_path.join(format!("{program_name} Git Scripts"));
    let script_folder = match template_key {
        "illustrator" | "photoshop" | "blender" | "windows" => git_scripts_path,
        _ => Path::new(exe_path)
            .parent()
            .unwrap_or(program_path)
            .to_path_buf(),
    };
    let (program_type, run_method, extensions, default_panels, process_names) = match template_key {
        "illustrator" => (
            "adobe_direct_script_runner",
            "illustrator_direct",
            ".jsx|.js",
            "Layers|Files|Utility",
            if process_name.is_empty() {
                String::from("illustrator")
            } else {
                process_name.clone()
            },
        ),
        "photoshop" => (
            "adobe_direct_script_runner",
            "photoshop_direct",
            ".jsx|.js",
            "Layers|Files|Utility",
            if process_name.is_empty() {
                String::from("photoshop")
            } else {
                process_name.clone()
            },
        ),
        "blender" => (
            "bridge_runner",
            "blender_bridge",
            ".ps1|.py|.blend|.exe|.lnk",
            "Collections|Files|Utility",
            if process_name.is_empty() {
                String::from("blender")
            } else {
                process_name.clone()
            },
        ),
        "windows" => (
            "generic",
            "generic",
            "",
            "Files|Utility",
            String::from("explorer|dopus|dopusrt"),
        ),
        _ => (
            "generic",
            "generic",
            "",
            "Files|Utility",
            process_name.clone(),
        ),
    };

    let mut section = HashMap::new();
    section.insert(String::from("Label"), program_name.trim().to_string());
    section.insert(
        String::from("NormalizedName"),
        program_name.trim().to_ascii_lowercase(),
    );
    section.insert(
        String::from("ScriptFolder"),
        script_folder.to_string_lossy().to_string(),
    );
    section.insert(String::from("ProgramType"), program_type.to_string());
    section.insert(String::from("ExePath"), exe_path.trim().to_string());
    section.insert(String::from("RunMethod"), run_method.to_string());
    section.insert(
        String::from("AllowedScriptExtensions"),
        extensions.to_string(),
    );
    section.insert(String::from("BridgeFolder"), String::new());
    section.insert(String::from("RequiresRestart"), String::from("0"));
    section.insert(String::from("DefaultPanels"), default_panels.to_string());
    section.insert(String::from("ProcessNames"), process_names);
    document.insert(format!("ProgramTab_{program_id}"), section);
}

fn upsert_program_registration(
    document: &mut IniDocument,
    program_name: &str,
    program_path: &Path,
    exe_path: &str,
) -> i64 {
    let program_id = program_registration_id(document, program_name);
    write_program_registration_section(document, program_id, program_name, program_path, exe_path);
    sync_program_registration_meta(document, Some(program_id));
    program_id
}

fn remove_program_registration(document: &mut IniDocument, program_name: &str) {
    let Some(program) = find_registered_program(document, program_name) else {
        return;
    };
    document.remove(&format!("ProgramTab_{}", program.id));

    let binding_sections = document
        .iter()
        .filter_map(|(section_name, section)| {
            if !section_name.starts_with("Binding_") {
                return None;
            }
            let program_tab_id = section
                .get("ProgramTabId")
                .and_then(|value| value.parse::<i64>().ok())
                .unwrap_or(0);
            (program_tab_id == program.id).then(|| section_name.clone())
        })
        .collect::<Vec<_>>();
    for section_name in binding_sections {
        document.remove(&section_name);
    }

    let mut remaining_binding_ids = document
        .keys()
        .filter_map(|section_name| section_name.strip_prefix("Binding_"))
        .filter_map(|value| value.parse::<u64>().ok())
        .collect::<Vec<_>>();
    remaining_binding_ids.sort_unstable();
    let meta = document.entry(String::from("Meta")).or_default();
    meta.insert(
        String::from("Ids"),
        remaining_binding_ids
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("|"),
    );
    sync_program_registration_meta(document, None);
}

#[cfg(test)]
mod program_registration_tests {
    use super::*;

    #[test]
    fn payload_folder_is_hidden_until_program_is_registered() {
        let available = vec![String::from("Illustrator")];
        let mut document = IniDocument::new();
        assert!(registered_program_folder_names(&available, &document).is_empty());

        upsert_program_registration(
            &mut document,
            "Illustrator",
            Path::new(r"D:\FlowCell\Programs\Illustrator"),
            r"C:\Program Files\Adobe\Adobe Illustrator 2026\Support Files\Contents\Windows\Illustrator.exe",
        );
        assert_eq!(
            registered_program_folder_names(&available, &document),
            vec![String::from("Illustrator")]
        );
    }

    #[test]
    fn illustrator_registration_persists_selected_executable() {
        let mut document = IniDocument::new();
        let exe_path = r"C:\Program Files\Adobe\Adobe Illustrator 2026\Support Files\Contents\Windows\Illustrator.exe";
        let program_id = upsert_program_registration(
            &mut document,
            "Illustrator",
            Path::new(r"D:\FlowCell\Programs\Illustrator"),
            exe_path,
        );

        assert_eq!(program_id, 1);
        assert_eq!(
            document
                .get("ProgramTab_1")
                .and_then(|section| section.get("ExePath"))
                .map(String::as_str),
            Some(exe_path)
        );
        assert_eq!(
            document
                .get("Meta")
                .and_then(|section| section.get("ProgramTabIds"))
                .map(String::as_str),
            Some("1")
        );
    }

    #[test]
    fn blender_folder_prefers_blender_exe_over_launcher() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be after Unix epoch")
            .as_nanos();
        let folder = std::env::temp_dir().join(format!(
            "flowcell-program-exe-test-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&folder).expect("test folder should be created");
        fs::write(folder.join("blender-launcher.exe"), []).expect("launcher fixture should exist");
        fs::write(folder.join("blender.exe"), []).expect("Blender fixture should exist");

        let resolved = resolve_program_executable("Blender", &folder.to_string_lossy())
            .expect("Blender folder should resolve");
        assert_eq!(
            resolved.file_name().and_then(|value| value.to_str()),
            Some("blender.exe")
        );

        fs::remove_dir_all(&folder).expect("temporary test folder should be removed");
    }
}

fn parse_ini_document(contents: &str) -> IniDocument {
    let mut document = IniDocument::new();
    let mut current_section = String::new();

    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('#') {
            continue;
        }

        if trimmed.starts_with('[') && trimmed.ends_with(']') && trimmed.len() >= 2 {
            current_section = trimmed[1..trimmed.len() - 1].trim().to_string();
            document.entry(current_section.clone()).or_default();
            continue;
        }

        let Some((key, value)) = trimmed.split_once('=') else {
            continue;
        };
        document
            .entry(current_section.clone())
            .or_default()
            .insert(key.trim().to_string(), value.trim().to_string());
    }

    document
}

fn section_sort_rank(section: &str) -> (u8, String) {
    if section.eq_ignore_ascii_case("Meta") {
        return (0, String::from("meta"));
    }
    if section.eq_ignore_ascii_case("ActionHotkeys") {
        return (1, String::from("actionhotkeys"));
    }
    if section.starts_with("ProgramTab_") {
        return (2, section.to_ascii_lowercase());
    }
    if section.starts_with("Binding_") {
        return (3, section.to_ascii_lowercase());
    }

    (4, section.to_ascii_lowercase())
}

fn serialize_ini_document(document: &IniDocument) -> String {
    let mut sections = document.keys().cloned().collect::<Vec<_>>();
    sections.sort_by(|left, right| {
        let left_key = section_sort_rank(left);
        let right_key = section_sort_rank(right);
        left_key.cmp(&right_key)
    });

    let mut blocks = Vec::new();
    for section in sections {
        let mut lines = Vec::new();
        if !section.is_empty() {
            lines.push(format!("[{section}]"));
        }

        let mut keys = document
            .get(&section)
            .map(|entries| entries.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        keys.sort_by(|left, right| left.to_ascii_lowercase().cmp(&right.to_ascii_lowercase()));
        for key in keys {
            if let Some(value) = document.get(&section).and_then(|entries| entries.get(&key)) {
                lines.push(format!("{key}={value}"));
            }
        }

        if !lines.is_empty() {
            blocks.push(lines.join("\r\n"));
        }
    }

    if blocks.is_empty() {
        String::new()
    } else {
        format!("{}\r\n", blocks.join("\r\n\r\n"))
    }
}

fn resolve_bindings_file_path() -> Result<PathBuf, String> {
    Ok(resolve_flowcell_local_root()?.join("bindings.ini"))
}

fn resolve_dummy_monitor_binding() -> Option<(String, String, i64)> {
    let repo_root = resolve_repo_root()?;
    let script_path = repo_root
        .join("Programs")
        .join("Windows")
        .join("toggle_dummy_monitor.ps1");
    if !script_path.is_file() {
        return None;
    }

    Some((
        String::from("^+F2"),
        script_path.to_string_lossy().to_string(),
        2,
    ))
}

fn should_restore_default_dummy_monitor(document: &IniDocument) -> bool {
    let Some(meta_section) = document.get("Meta") else {
        return true;
    };
    let Some(raw_value) = meta_section.get("DummyMonitorDefaultEnabled") else {
        return true;
    };
    !matches!(
        raw_value.trim().to_ascii_lowercase().as_str(),
        "0" | "false" | "no"
    )
}

fn ensure_default_dummy_monitor_binding(
    bindings: &mut FrontendBindingsState,
    document: &IniDocument,
) {
    if !should_restore_default_dummy_monitor(document) {
        return;
    }

    let Some((default_shortcut, default_target, program_tab_id)) = resolve_dummy_monitor_binding()
    else {
        return;
    };
    let default_shortcut_normalized = default_shortcut.to_ascii_lowercase();
    let default_target_normalized = normalize_binding_target_for_compare(&default_target);
    if bindings.script_bindings.iter().any(|binding| {
        binding
            .shortcut
            .trim()
            .eq_ignore_ascii_case(&default_shortcut_normalized)
            || normalize_binding_target_for_compare(&binding.target) == default_target_normalized
    }) {
        return;
    }

    let next_id = bindings.next_id.unwrap_or(1).max(1);
    bindings.script_bindings.push(FrontendScriptBindingRecord {
        id: Some(next_id),
        binding_id: Some(next_id),
        kind: Some(String::from("script")),
        label: None,
        status: Some(String::from("Loaded")),
        program_tab_id: Some(program_tab_id),
        shortcut: default_shortcut,
        target: default_target,
    });
    bindings.next_id = Some(next_id + 1);
}

fn read_bindings_file_state() -> Result<(FrontendBindingsState, IniDocument, PathBuf), String> {
    let bindings_path = resolve_bindings_file_path()?;
    let raw_contents = if bindings_path.is_file() {
        fs::read_to_string(&bindings_path).map_err(|error| {
            format!(
                "Failed to read FlowCell bindings at {}: {error}",
                bindings_path.display()
            )
        })?
    } else {
        String::new()
    };
    let document = parse_ini_document(&raw_contents);

    let mut next_id = document
        .get("Meta")
        .and_then(|section| section.get("NextId"))
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(1)
        .max(1);
    let id_tokens = document
        .get("Meta")
        .and_then(|section| section.get("Ids"))
        .cloned()
        .unwrap_or_default();
    let mut script_bindings = Vec::new();
    for token in id_tokens.split('|') {
        let trimmed = token.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(binding_id) = trimmed.parse::<u64>() else {
            continue;
        };
        let section_name = format!("Binding_{binding_id}");
        let Some(section) = document.get(&section_name) else {
            continue;
        };
        let shortcut = section
            .get("Shortcut")
            .cloned()
            .unwrap_or_default()
            .trim()
            .to_string();
        let target = resolve_legacy_windows_binding_path(
            section
                .get("ScriptPath")
                .map(String::as_str)
                .unwrap_or_default(),
        );
        let program_tab_id = section
            .get("ProgramTabId")
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0);
        if shortcut.is_empty() || target.is_empty() {
            continue;
        }
        next_id = next_id.max(binding_id + 1);
        script_bindings.push(FrontendScriptBindingRecord {
            id: Some(binding_id),
            binding_id: Some(binding_id),
            kind: Some(String::from("script")),
            label: None,
            status: Some(String::from("Loaded")),
            program_tab_id: Some(program_tab_id),
            shortcut,
            target,
        });
    }

    let mut action_hotkeys = HashMap::new();
    if let Some(section) = document.get("ActionHotkeys") {
        for (action_id, shortcut) in section {
            let trimmed_shortcut = shortcut.trim();
            if trimmed_shortcut.is_empty() {
                continue;
            }
            action_hotkeys.insert(action_id.clone(), trimmed_shortcut.to_string());
        }
    }

    let mut bindings = FrontendBindingsState {
        next_id: Some(next_id),
        script_bindings,
        action_hotkeys,
    };
    ensure_default_dummy_monitor_binding(&mut bindings, &document);
    Ok((bindings, document, bindings_path))
}

fn write_bindings_file_state(path: &Path, document: &IniDocument) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create bindings folder at {}: {error}",
                parent.display()
            )
        })?;
    }

    let serialized = serialize_ini_document(document);
    fs::write(path, serialized).map_err(|error| {
        format!(
            "Failed to write FlowCell bindings at {}: {error}",
            path.display()
        )
    })
}

fn resolve_frontend_recorded_actions_directory() -> Result<PathBuf, String> {
    let directory = resolve_flowcell_local_root()?.join(FRONTEND_RECORDED_ACTIONS_FOLDER);
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Failed to create frontend macro folder at {}: {error}",
            directory.display()
        )
    })?;
    Ok(directory)
}

fn current_timestamp_token() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

fn current_precise_timestamp_token() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .to_string()
}

fn current_command_timestamp() -> String {
    current_timestamp_token()
}

fn validate_frontend_macro_id(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Macro id is required.".to_string());
    }
    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
    {
        return Err(format!("Macro id '{}' is not valid.", trimmed));
    }
    Ok(trimmed.to_string())
}

fn build_frontend_macro_id(label: &str) -> String {
    let stem = format_panel_item_stem(label);
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("macro_{}_{}", stem, millis)
}

fn resolve_frontend_macro_file_path(action_id: &str) -> Result<PathBuf, String> {
    let validated_action_id = validate_frontend_macro_id(action_id)?;
    Ok(resolve_frontend_recorded_actions_directory()?.join(format!("{validated_action_id}.ini")))
}

fn resolve_frontend_macro_panel_item_path(
    panel_directory: &Path,
    action_id: &str,
) -> Result<PathBuf, String> {
    let validated_action_id = validate_frontend_macro_id(action_id)?;
    Ok(panel_directory.join(format!(
        "macro_{}{}",
        format_panel_item_stem(&validated_action_id),
        BLENDER_PANEL_ITEM_SUFFIX
    )))
}

fn build_frontend_macro_panel_item(
    action_id: &str,
    label: &str,
    tooltip: &str,
) -> BlenderPanelItemRecord {
    BlenderPanelItemRecord {
        label: label.trim().to_string(),
        tooltip: tooltip.trim().to_string(),
        kind: FRONTEND_MACRO_KIND.to_string(),
        source_path: String::new(),
        execution_target: String::new(),
        bridge_action: String::new(),
        bridge_data: None,
        children: Vec::new(),
        macro_id: action_id.trim().to_string(),
    }
}

fn is_frontend_macro_panel_item(record: &BlenderPanelItemRecord) -> bool {
    record.kind.eq_ignore_ascii_case(FRONTEND_MACRO_KIND) && !record.macro_id.trim().is_empty()
}

fn parse_optional_i64(value: Option<&String>) -> Option<i64> {
    value
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse::<i64>().ok())
}

fn clean_ini_value(value: &str) -> String {
    value.replace('\r', " ").replace('\n', " ")
}

fn is_frontend_macro_document(document: &IniDocument) -> bool {
    let Some(action_section) = document.get("Action") else {
        return false;
    };
    action_section
        .get("Owner")
        .map(|value| value.trim().eq_ignore_ascii_case(FRONTEND_MACRO_OWNER))
        .unwrap_or(false)
        && action_section
            .get("SchemaVersion")
            .map(|value| value.trim() == FRONTEND_MACRO_SCHEMA_VERSION)
            .unwrap_or(false)
}

fn build_macro_definition_from_document(
    path: &Path,
    document: &IniDocument,
    id: String,
    label: String,
    program_name: String,
    panel_name: String,
    created_at: String,
    updated_at: String,
) -> ParsedFrontendMacroDefinition {
    let mut step_sections = document
        .keys()
        .filter(|section| section.starts_with("Step_"))
        .cloned()
        .collect::<Vec<_>>();
    step_sections.sort();

    let mut steps = Vec::new();
    for (index, section_name) in step_sections.iter().enumerate() {
        let Some(section) = document.get(section_name) else {
            continue;
        };
        let raw_type = section
            .get("Type")
            .map(String::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        let button = section
            .get("Button")
            .map(String::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        let macro_id = section
            .get("MacroId")
            .map(String::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        let macro_path = section
            .get("MacroPath")
            .map(String::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        let script_path = section
            .get("ScriptPath")
            .map(String::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();

        let step_type = if !macro_id.is_empty() || !macro_path.is_empty() {
            FRONTEND_MACRO_KIND.to_string()
        } else if !script_path.is_empty() {
            String::from("Script")
        } else if raw_type.eq_ignore_ascii_case("Click") && button.eq_ignore_ascii_case("Right") {
            String::from("RightClick")
        } else {
            raw_type
        };

        let target = if step_type.eq_ignore_ascii_case(FRONTEND_MACRO_KIND) {
            if !macro_id.is_empty() {
                Some(macro_id)
            } else if !macro_path.is_empty() {
                Some(macro_path)
            } else {
                None
            }
        } else if step_type.eq_ignore_ascii_case("Script") {
            if script_path.is_empty() {
                None
            } else {
                Some(script_path)
            }
        } else {
            None
        };

        steps.push(FrontendMacroStepRecord {
            id: format!("step_{:03}", index + 1),
            step_type,
            delay_ms: parse_optional_i64(section.get("DelayMs")).unwrap_or(0),
            x: parse_optional_i64(section.get("X")),
            y: parse_optional_i64(section.get("Y")),
            button: if button.is_empty() {
                None
            } else {
                Some(button)
            },
            count: parse_optional_i64(section.get("Count")),
            direction: section
                .get("Direction")
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
            text: section
                .get("Text")
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
            keys: section
                .get("Keys")
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
            target,
        });
    }

    ParsedFrontendMacroDefinition {
        id,
        label,
        program_name,
        panel_name,
        file_name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string(),
        created_at,
        updated_at,
        steps: steps
            .into_iter()
            .map(|mut step| {
                if step.id.trim().is_empty() {
                    step.id = format!("step_{}", current_timestamp_token());
                }
                step
            })
            .collect(),
    }
}

fn read_frontend_macro_definition_from_path(
    path: &Path,
    _bindings: Option<&FrontendBindingsState>,
) -> Result<Option<ParsedFrontendMacroDefinition>, String> {
    let raw_contents = fs::read_to_string(path).map_err(|error| {
        format!(
            "Failed to read frontend macro at {}: {error}",
            path.display()
        )
    })?;
    let document = parse_ini_document(&raw_contents);
    if !is_frontend_macro_document(&document) {
        return Ok(None);
    }

    let action_section = document.get("Action").ok_or_else(|| {
        format!(
            "Frontend macro {} is missing an Action section.",
            path.display()
        )
    })?;
    let id = validate_frontend_macro_id(
        action_section
            .get("Id")
            .map(String::as_str)
            .unwrap_or_default(),
    )?;
    let label = action_section
        .get("Label")
        .map(String::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let program_name = action_section
        .get("ProgramName")
        .map(String::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let panel_name = action_section
        .get("PanelName")
        .map(String::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if label.is_empty() || program_name.is_empty() || panel_name.is_empty() {
        return Err(format!(
            "Frontend macro {} is missing its label or ownership metadata.",
            path.display()
        ));
    }

    let created_at = action_section
        .get("CreatedAt")
        .cloned()
        .unwrap_or_else(current_timestamp_token);
    let updated_at = action_section
        .get("UpdatedAt")
        .cloned()
        .unwrap_or_else(|| created_at.clone());

    Ok(Some(build_macro_definition_from_document(
        path,
        &document,
        id,
        label,
        program_name,
        panel_name,
        created_at,
        updated_at,
    )))
}

fn parsed_frontend_macro_to_document(
    definition: ParsedFrontendMacroDefinition,
    bindings: Option<&FrontendBindingsState>,
) -> FrontendMacroDocumentRecord {
    let shortcut = bindings
        .and_then(|state| state.action_hotkeys.get(&definition.id))
        .cloned();
    FrontendMacroDocumentRecord {
        id: definition.id,
        label: definition.label,
        program_name: definition.program_name,
        panel_name: definition.panel_name,
        file_name: definition.file_name,
        created_at: definition.created_at,
        updated_at: definition.updated_at,
        steps: definition.steps,
        shortcut,
    }
}

fn list_frontend_macro_summaries(
    program_name_filter: Option<&str>,
    panel_name_filter: Option<&str>,
) -> Result<Vec<FrontendMacroSummaryRecord>, String> {
    let recorded_actions_directory = resolve_frontend_recorded_actions_directory()?;
    let entries = fs::read_dir(&recorded_actions_directory).map_err(|error| {
        format!(
            "Failed to read frontend macro folder at {}: {error}",
            recorded_actions_directory.display()
        )
    })?;

    let mut records = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "Failed to inspect frontend macro folder at {}: {error}",
                recorded_actions_directory.display()
            )
        })?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let is_ini = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("ini"))
            .unwrap_or(false);
        if !is_ini {
            continue;
        }
        let Some(definition) = read_frontend_macro_definition_from_path(&path, None)? else {
            continue;
        };
        if let Some(program_name) = program_name_filter {
            if !definition.program_name.eq_ignore_ascii_case(program_name) {
                continue;
            }
        }
        if let Some(panel_name) = panel_name_filter {
            if !definition.panel_name.eq_ignore_ascii_case(panel_name) {
                continue;
            }
        }
        records.push(FrontendMacroSummaryRecord {
            id: definition.id,
            label: definition.label,
            program_name: definition.program_name,
            panel_name: definition.panel_name,
            file_name: definition.file_name,
            created_at: definition.created_at,
            updated_at: definition.updated_at,
        });
    }

    records.sort_by_cached_key(|record| record.label.to_ascii_lowercase());
    Ok(records)
}

fn list_frontend_macros_for_panel(
    program_name: &str,
    panel_name: &str,
) -> Result<Vec<FrontendMacroSummaryRecord>, String> {
    list_frontend_macro_summaries(Some(program_name), Some(panel_name))
}

fn load_frontend_macro_definition(
    action_id: &str,
) -> Result<ParsedFrontendMacroDefinition, String> {
    let macro_path = resolve_frontend_macro_file_path(action_id)?;
    if !macro_path.is_file() {
        return Err(format!(
            "Macro '{}' was not found at {}.",
            action_id.trim(),
            macro_path.display()
        ));
    }
    read_frontend_macro_definition_from_path(&macro_path, None)?.ok_or_else(|| {
        format!(
            "Macro '{}' is not managed by the new frontend.",
            action_id.trim()
        )
    })
}

fn resolve_macro_step_storage(
    step: &FrontendMacroStepRecord,
    current_action_id: &str,
) -> Result<(String, String, String), String> {
    let step_type = step.step_type.trim();
    if step_type.eq_ignore_ascii_case(FRONTEND_MACRO_KIND) {
        let target_id = validate_frontend_macro_id(step.target.as_deref().unwrap_or_default())?;
        let target_path = resolve_frontend_macro_file_path(&target_id)?;
        if target_id != current_action_id && !target_path.is_file() {
            return Err(format!("Nested macro '{}' was not found.", target_id));
        }
        return Ok((
            target_id,
            target_path.to_string_lossy().to_string(),
            String::new(),
        ));
    }
    if step_type.eq_ignore_ascii_case("Script") {
        return Ok((
            String::new(),
            String::new(),
            step.target
                .as_deref()
                .unwrap_or_default()
                .trim()
                .to_string(),
        ));
    }
    Ok((String::new(), String::new(), String::new()))
}

fn write_frontend_macro_definition_file(
    path: &Path,
    action_id: &str,
    label: &str,
    program_name: &str,
    panel_name: &str,
    created_at: Option<&str>,
    steps: &[FrontendMacroStepRecord],
) -> Result<(), String> {
    let mut document = IniDocument::new();
    let mut action_section = HashMap::new();
    let created_at_value = created_at
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(current_timestamp_token);
    action_section.insert(String::from("Id"), action_id.trim().to_string());
    action_section.insert(String::from("Label"), clean_ini_value(label));
    action_section.insert(String::from("Owner"), FRONTEND_MACRO_OWNER.to_string());
    action_section.insert(
        String::from("SchemaVersion"),
        FRONTEND_MACRO_SCHEMA_VERSION.to_string(),
    );
    action_section.insert(String::from("ProgramName"), clean_ini_value(program_name));
    action_section.insert(String::from("PanelName"), clean_ini_value(panel_name));
    action_section.insert(String::from("CreatedAt"), created_at_value);
    action_section.insert(String::from("UpdatedAt"), current_timestamp_token());
    document.insert(String::from("Action"), action_section);

    for (index, step) in steps.iter().enumerate() {
        let section_name = format!("Step_{:03}", index + 1);
        let mut section = HashMap::new();
        let normalized_type = step.step_type.trim();
        let (macro_id, macro_path, script_path) = resolve_macro_step_storage(step, action_id)?;
        section.insert(String::from("Type"), normalized_type.to_string());
        section.insert(String::from("DelayMs"), step.delay_ms.max(0).to_string());

        if let Some(x) = step.x {
            section.insert(String::from("X"), x.to_string());
        }
        if let Some(y) = step.y {
            section.insert(String::from("Y"), y.to_string());
        }
        if let Some(text) = step
            .text
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            section.insert(String::from("Text"), clean_ini_value(text));
        }
        if let Some(keys) = step
            .keys
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            section.insert(String::from("Keys"), clean_ini_value(keys));
        }

        if normalized_type.eq_ignore_ascii_case("Click")
            || normalized_type.eq_ignore_ascii_case("RightClick")
        {
            let button = if normalized_type.eq_ignore_ascii_case("RightClick") {
                "Right".to_string()
            } else {
                step.button
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("Left")
                    .to_string()
            };
            section.insert(String::from("Button"), button);
            section.insert(
                String::from("Count"),
                step.count.unwrap_or(1).max(1).to_string(),
            );
        }

        if normalized_type.eq_ignore_ascii_case("Wheel") {
            section.insert(
                String::from("Direction"),
                step.direction
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("Down")
                    .to_string(),
            );
            section.insert(
                String::from("Count"),
                step.count.unwrap_or(1).max(1).to_string(),
            );
        }

        if !script_path.is_empty() {
            section.insert(String::from("ScriptPath"), script_path);
        }
        if !macro_path.is_empty() {
            section.insert(String::from("MacroPath"), macro_path);
        }
        if !macro_id.is_empty() {
            section.insert(String::from("MacroId"), macro_id);
        }

        document.insert(section_name, section);
    }

    let serialized = serialize_ini_document(&document);
    fs::write(path, serialized).map_err(|error| {
        format!(
            "Failed to write frontend macro at {}: {error}",
            path.display()
        )
    })
}

fn stamp_frontend_macro_metadata(
    path: &Path,
    action_id: &str,
    label: &str,
    program_name: &str,
    panel_name: &str,
    created_at_override: Option<&str>,
) -> Result<(), String> {
    let raw_contents = fs::read_to_string(path).map_err(|error| {
        format!(
            "Failed to read recorded macro at {}: {error}",
            path.display()
        )
    })?;
    let mut document = parse_ini_document(&raw_contents);
    let action_section = document.entry(String::from("Action")).or_default();
    let created_at = created_at_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            action_section
                .get("CreatedAt")
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
        .unwrap_or_else(current_timestamp_token);

    action_section.insert(String::from("Id"), action_id.trim().to_string());
    action_section.insert(String::from("Label"), clean_ini_value(label));
    action_section.insert(String::from("Owner"), FRONTEND_MACRO_OWNER.to_string());
    action_section.insert(
        String::from("SchemaVersion"),
        FRONTEND_MACRO_SCHEMA_VERSION.to_string(),
    );
    action_section.insert(String::from("ProgramName"), clean_ini_value(program_name));
    action_section.insert(String::from("PanelName"), clean_ini_value(panel_name));
    action_section.insert(String::from("CreatedAt"), created_at);
    action_section.insert(String::from("UpdatedAt"), current_timestamp_token());

    let serialized = serialize_ini_document(&document);
    fs::write(path, serialized).map_err(|error| {
        format!(
            "Failed to stamp frontend macro at {}: {error}",
            path.display()
        )
    })
}

fn load_frontend_macro_document_with_bindings(
    action_id: &str,
) -> Result<FrontendMacroDocumentRecord, String> {
    let (bindings, _, _) = read_bindings_file_state()?;
    let definition = load_frontend_macro_definition(action_id)?;
    Ok(parsed_frontend_macro_to_document(
        definition,
        Some(&bindings),
    ))
}

fn resolve_macro_load_destination(
    action_section: &HashMap<String, String>,
    fallback_program_name: &str,
    fallback_panel_name: &str,
) -> Result<(String, String), String> {
    let metadata_program_name = action_section
        .get("ProgramName")
        .map(String::as_str)
        .unwrap_or_default()
        .trim();
    let metadata_panel_name = action_section
        .get("PanelName")
        .map(String::as_str)
        .unwrap_or_default()
        .trim();
    if !metadata_program_name.is_empty()
        && !metadata_panel_name.is_empty()
        && resolve_panel_directory(metadata_program_name, metadata_panel_name).is_ok()
    {
        return Ok((
            metadata_program_name.to_string(),
            metadata_panel_name.to_string(),
        ));
    }

    let fallback_program_name = fallback_program_name.trim();
    let fallback_panel_name = fallback_panel_name.trim();
    if !fallback_program_name.is_empty() && !fallback_panel_name.is_empty() {
        resolve_panel_directory(fallback_program_name, fallback_panel_name)?;
        return Ok((
            fallback_program_name.to_string(),
            fallback_panel_name.to_string(),
        ));
    }

    Err("The selected macro has no valid saved program/panel. Pick a program and panel before loading it.".to_string())
}

fn load_frontend_macro_document_from_path(
    request: LoadFrontendMacroFromPathRequest,
) -> Result<FrontendMacroDocumentRecord, String> {
    let raw_path = request.path.trim();
    if raw_path.is_empty() {
        return Err("Choose a macro file to load.".to_string());
    }

    let macro_path = PathBuf::from(raw_path);
    if !macro_path.is_file() {
        return Err(format!(
            "Macro file was not found at {}.",
            macro_path.display()
        ));
    }

    let is_ini = macro_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("ini"))
        .unwrap_or(false);
    if !is_ini {
        return Err("Macro files must be .ini files.".to_string());
    }

    let raw_contents = fs::read_to_string(&macro_path).map_err(|error| {
        format!(
            "Failed to read macro file at {}: {error}",
            macro_path.display()
        )
    })?;
    let document = parse_ini_document(&raw_contents);
    let action_section = document.get("Action").ok_or_else(|| {
        format!(
            "Macro file {} is missing an Action section.",
            macro_path.display()
        )
    })?;

    let (program_name, panel_name) = resolve_macro_load_destination(
        action_section,
        &request.fallback_program_name,
        &request.fallback_panel_name,
    )?;
    let fallback_label = macro_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Loaded Macro")
        .trim()
        .to_string();
    let label = action_section
        .get("Label")
        .map(String::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let label = if label.is_empty() {
        fallback_label
    } else {
        label
    };
    let created_at = action_section
        .get("CreatedAt")
        .cloned()
        .unwrap_or_else(current_timestamp_token);
    let updated_at = action_section
        .get("UpdatedAt")
        .cloned()
        .unwrap_or_else(|| created_at.clone());
    let saved_id = action_section
        .get("Id")
        .map(String::as_str)
        .unwrap_or_default()
        .trim();
    let managed_id = validate_frontend_macro_id(saved_id)
        .ok()
        .filter(|candidate_id| {
            if !is_frontend_macro_document(&document) {
                return false;
            }
            resolve_frontend_macro_file_path(candidate_id)
                .map(|managed_path| {
                    normalize_path_for_compare(&managed_path)
                        == normalize_path_for_compare(&macro_path)
                })
                .unwrap_or(false)
        })
        .unwrap_or_default();

    let definition = build_macro_definition_from_document(
        &macro_path,
        &document,
        managed_id,
        label,
        program_name,
        panel_name,
        created_at,
        updated_at,
    );
    let bindings = if definition.id.trim().is_empty() {
        None
    } else {
        Some(read_bindings_file_state()?.0)
    };

    Ok(parsed_frontend_macro_to_document(
        definition,
        bindings.as_ref(),
    ))
}

fn upsert_frontend_macro_panel_item(
    program_name: &str,
    panel_name: &str,
    action_id: &str,
    label: &str,
) -> Result<(), String> {
    let panel_directory = resolve_panel_directory(program_name, panel_name)?;
    let record_path = resolve_frontend_macro_panel_item_path(&panel_directory, action_id)?;
    let existing_tooltip = if record_path.is_file() {
        read_panel_item_file(&record_path)
            .ok()
            .map(|record| record.tooltip)
            .unwrap_or_default()
    } else {
        String::new()
    };
    let record = build_frontend_macro_panel_item(action_id, label, &existing_tooltip);
    write_panel_item_file(&record_path, &record)
}

fn find_frontend_macro_panel_item_paths(action_id: &str) -> Result<Vec<PathBuf>, String> {
    let validated_action_id = validate_frontend_macro_id(action_id)?;
    let mut paths = Vec::new();

    for program_name in list_program_folders()? {
        for panel_name in list_panel_folders(program_name.clone())? {
            let panel_directory = resolve_panel_directory(&program_name, &panel_name)?;
            let entries = fs::read_dir(&panel_directory).map_err(|error| {
                format!(
                    "Failed to read panel folder at {}: {error}",
                    panel_directory.display()
                )
            })?;
            for entry in entries {
                let entry = entry.map_err(|error| {
                    format!(
                        "Failed to inspect panel folder at {}: {error}",
                        panel_directory.display()
                    )
                })?;
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let is_panel_item = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(|value| value.ends_with(BLENDER_PANEL_ITEM_SUFFIX))
                    .unwrap_or(false);
                if !is_panel_item {
                    continue;
                }
                let Ok(record) = read_panel_item_file(&path) else {
                    continue;
                };
                if is_frontend_macro_panel_item(&record)
                    && record.macro_id.eq_ignore_ascii_case(&validated_action_id)
                {
                    paths.push(path);
                }
            }
        }
    }

    Ok(paths)
}

fn remove_all_frontend_macro_panel_items(action_id: &str) -> Result<(), String> {
    recycle_file_paths(&find_frontend_macro_panel_item_paths(action_id)?)
}

fn remove_frontend_macro_hotkeys(action_ids: &[String]) -> Result<(), String> {
    let mut normalized_ids = Vec::new();
    for action_id in action_ids {
        let normalized_id = validate_frontend_macro_id(action_id)?;
        if !normalized_ids
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(&normalized_id))
        {
            normalized_ids.push(normalized_id);
        }
    }
    if normalized_ids.is_empty() {
        return Ok(());
    }

    let (_bindings, mut document, bindings_path) = read_bindings_file_state()?;
    let mut changed = false;
    let mut remove_action_hotkeys_section = false;
    if let Some(section) = document.get_mut("ActionHotkeys") {
        for action_id in &normalized_ids {
            changed = section.remove(action_id).is_some() || changed;
        }
        remove_action_hotkeys_section = section.is_empty();
    }
    if remove_action_hotkeys_section {
        document.remove("ActionHotkeys");
    }

    if changed {
        write_bindings_file_state(&bindings_path, &document)?;
        let _ = restart_flowcell_headless_backend();
    }

    Ok(())
}

fn recycle_file_paths(paths: &[PathBuf]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }

    let encoded_paths = paths
        .iter()
        .map(|path| {
            format!(
                "'{}'",
                escape_powershell_single_quoted(&path.to_string_lossy())
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    let command = format!(
        concat!(
            "Add-Type -AssemblyName Microsoft.VisualBasic; ",
            "$paths = @({encoded_paths}); ",
            "foreach ($path in $paths) {{ ",
            "if (Test-Path -LiteralPath $path -PathType Leaf) {{ ",
            "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(",
            "$path, ",
            "[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, ",
            "[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin",
            ") ",
            "}} ",
            "}}"
        ),
        encoded_paths = encoded_paths
    );
    let arguments = vec!["-Command".to_string(), command];
    let output = spawn_powershell_output(&arguments)?;
    if !output.status.success() {
        return Err(format_process_failure(
            &output,
            "Failed to move one or more files to the Recycle Bin.",
        ));
    }

    Ok(())
}

fn recycle_file_path(path: &Path) -> Result<(), String> {
    recycle_file_paths(&[path.to_path_buf()])
}

fn recycle_directory_paths(paths: &[PathBuf]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }

    let encoded_paths = paths
        .iter()
        .map(|path| {
            format!(
                "'{}'",
                escape_powershell_single_quoted(&path.to_string_lossy())
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    let command = format!(
        concat!(
            "Add-Type -AssemblyName Microsoft.VisualBasic; ",
            "$paths = @({encoded_paths}); ",
            "foreach ($path in $paths) {{ ",
            "if (Test-Path -LiteralPath $path -PathType Container) {{ ",
            "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(",
            "$path, ",
            "[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, ",
            "[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin",
            ") ",
            "}} ",
            "}}"
        ),
        encoded_paths = encoded_paths
    );
    let arguments = vec!["-Command".to_string(), command];
    let output = spawn_powershell_output(&arguments)?;
    if !output.status.success() {
        return Err(format_process_failure(
            &output,
            "Failed to move one or more folders to the Recycle Bin.",
        ));
    }

    Ok(())
}

fn recycle_directory_path(path: &Path) -> Result<(), String> {
    recycle_directory_paths(&[path.to_path_buf()])
}

fn resolve_flowcell_backend_script_path() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root().ok_or_else(|| {
        "FlowCell repo root could not be resolved for backend execution.".to_string()
    })?;
    let backend_script_path = repo_root.join("FlowCell").join("FlowCellBackend.ahk");
    if backend_script_path.is_file() {
        Ok(backend_script_path)
    } else {
        Err(format!(
            "FlowCell backend adapter was not found at {}.",
            backend_script_path.display()
        ))
    }
}

fn resolve_flowcell_command_backend_script_path() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root().ok_or_else(|| {
        "FlowCell repo root could not be resolved for command backend execution.".to_string()
    })?;
    let backend_path = repo_root
        .join("FlowCell")
        .join("FlowCellCommandBackend.ps1");
    if backend_path.is_file() {
        Ok(backend_path)
    } else {
        Err(format!(
            "FlowCell command backend was not found at {}.",
            backend_path.display()
        ))
    }
}

fn resolve_flowcell_backend_launcher_path() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root().ok_or_else(|| {
        "FlowCell repo root could not be resolved for backend launch.".to_string()
    })?;
    let launcher_path = repo_root.join("FlowCell").join("run_backend_hidden.vbs");
    if launcher_path.is_file() {
        Ok(launcher_path)
    } else {
        Err(format!(
            "FlowCell backend launcher was not found at {}.",
            launcher_path.display()
        ))
    }
}

fn resolve_flowcell_autohotkey_exe_path() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root()
        .ok_or_else(|| "FlowCell repo root could not be resolved for AutoHotkey.".to_string())?;
    let flowcell_root = repo_root.join("FlowCell");
    let candidates = [
        flowcell_root.join("runtime").join("AutoHotkey64.exe"),
        flowcell_root.join("runtime").join("AutoHotkey.exe"),
        flowcell_root
            .join("local")
            .join("bin")
            .join("AutoHotkey64.exe"),
        flowcell_root
            .join("local")
            .join("bin")
            .join("AutoHotkey.exe"),
        PathBuf::from(r"C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe"),
        PathBuf::from(r"C:\Program Files\AutoHotkey\v2\AutoHotkey.exe"),
        PathBuf::from(r"C:\Program Files\AutoHotkey\AutoHotkey64.exe"),
        PathBuf::from(r"C:\Program Files\AutoHotkey\AutoHotkey.exe"),
    ];

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            "AutoHotkey v2 runtime was not found for FlowCell backend execution.".to_string()
        })
}

fn read_last_action_status_message() -> Option<String> {
    let status_path = resolve_flowcell_local_root()
        .ok()?
        .join("logs")
        .join("last_action_status.txt");
    let message = fs::read_to_string(status_path).ok()?;
    let trimmed = message.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn append_flowcell_local_log(file_name: &str, message: &str) {
    let Ok(local_root) = resolve_flowcell_local_root() else {
        return;
    };
    let log_root = local_root.join("logs");
    if fs::create_dir_all(&log_root).is_err() {
        return;
    }
    let log_path = log_root.join(file_name);
    let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    else {
        return;
    };
    let _ = writeln!(file, "[{}] {}", current_timestamp_string(), message);
}

fn build_flowcell_controller_script_command(
    script_path: &Path,
    program_key: &str,
    pipe_output: bool,
) -> Result<Command, String> {
    let backend_script_path = resolve_flowcell_backend_script_path()?;
    let ahk_exe = resolve_flowcell_autohotkey_exe_path()?;
    let flowcell_root = backend_script_path
        .parent()
        .ok_or_else(|| "FlowCell backend root could not be resolved.".to_string())?;

    let mut command = Command::new(ahk_exe);
    command
        .arg("/ErrorStdOut")
        .arg(&backend_script_path)
        .arg(format!("--run-script-path={}", script_path.display()))
        .arg(format!("--run-script-program={program_key}"))
        .arg("--run-script-program-tab-id=0")
        .current_dir(flowcell_root);

    if pipe_output {
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
    } else {
        command.stdout(Stdio::null()).stderr(Stdio::null());
    }

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    Ok(command)
}

#[cfg(windows)]
fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn find_flowcell_direct_script_receiver() -> HWND {
    let class_name = wide_null(FLOWCELL_DIRECT_SCRIPT_RECEIVER_CLASS);
    let title = wide_null(FLOWCELL_DIRECT_SCRIPT_RECEIVER_TITLE);
    unsafe { FindWindowW(class_name.as_ptr(), title.as_ptr()) }
}

#[cfg(windows)]
fn wait_for_flowcell_direct_script_receiver(timeout: Duration) -> HWND {
    let start = Instant::now();
    loop {
        let hwnd = find_flowcell_direct_script_receiver();
        if !hwnd.is_null() {
            return hwnd;
        }
        if start.elapsed() >= timeout {
            return std::ptr::null_mut();
        }
        thread::sleep(Duration::from_millis(
            FLOWCELL_DIRECT_SCRIPT_RECEIVER_POLL_MS,
        ));
    }
}

#[cfg(windows)]
fn send_flowcell_direct_script_copydata(hwnd: HWND, payload: &str) -> Result<usize, String> {
    let mut payload_wide: Vec<u16> = payload.encode_utf16().collect();
    let byte_count = payload_wide
        .len()
        .checked_mul(std::mem::size_of::<u16>())
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| "FlowCell direct script request was too large.".to_string())?;

    let mut copy_data = COPYDATASTRUCT {
        dwData: FLOWCELL_DIRECT_SCRIPT_COPYDATA_ID,
        cbData: byte_count,
        lpData: payload_wide.as_mut_ptr() as *mut c_void,
    };
    let mut response: usize = 0;
    let send_result = unsafe {
        SendMessageTimeoutW(
            hwnd,
            WM_COPYDATA,
            0,
            &mut copy_data as *mut COPYDATASTRUCT as isize,
            SMTO_ABORTIFHUNG,
            FLOWCELL_DIRECT_SCRIPT_SEND_TIMEOUT_MS,
            &mut response as *mut usize,
        )
    };

    if send_result == 0 {
        return Err(
            "FlowCell backend is busy or did not answer. Nothing was queued; wait for the current Illustrator action to finish and click again."
                .to_string(),
        );
    }

    Ok(response)
}

fn run_illustrator_backend_script_direct(
    script_path: &Path,
    program_key: &str,
) -> Result<String, String> {
    if !script_path.is_file() {
        return Err(format!(
            "Script file was not found at {}.",
            script_path.display()
        ));
    }

    #[cfg(windows)]
    {
        let dispatch_started = Instant::now();
        let mut hwnd = find_flowcell_direct_script_receiver();
        if hwnd.is_null() {
            restart_flowcell_headless_backend()?;
            hwnd = wait_for_flowcell_direct_script_receiver(Duration::from_millis(
                FLOWCELL_DIRECT_SCRIPT_STARTUP_WAIT_MS,
            ));
        }
        if hwnd.is_null() {
            return Err(
                "FlowCell backend receiver is not available. Restart FlowCell so the hidden backend can load the direct script receiver."
                    .to_string(),
            );
        }

        let script_name = script_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("script");
        let payload = serde_json::to_string(&json!({
            "command": "run_script_now",
            "scriptPath": script_path.display().to_string(),
            "programKey": program_key,
            "requestId": format!("illustrator-script-{}", current_precise_timestamp_token())
        }))
        .map_err(|error| format!("Failed to serialize FlowCell direct script request: {error}"))?;

        let response = send_flowcell_direct_script_copydata(hwnd, &payload)?;
        match response {
            FLOWCELL_DIRECT_SCRIPT_ACCEPTED => {
                append_flowcell_local_log(
                    "command_host.log",
                    &format!(
                        "Illustrator script accepted by live backend in {} ms. ProgramKey={program_key}; Script={}",
                        dispatch_started.elapsed().as_millis(),
                        script_path.display()
                    ),
                );
                Ok(format!("Started {script_name}."))
            }
            FLOWCELL_DIRECT_SCRIPT_BUSY => Err(
                "FlowCell backend is already running an Illustrator script. Nothing was queued; wait for it to finish and click again."
                    .to_string(),
            ),
            FLOWCELL_DIRECT_SCRIPT_BAD_PAYLOAD => {
                Err("FlowCell backend could not read the direct script request.".to_string())
            }
            FLOWCELL_DIRECT_SCRIPT_BAD_SCRIPT => Err(format!(
                "FlowCell backend rejected the script path for {}.",
                script_path.display()
            )),
            other => Err(format!(
                "FlowCell backend returned an unexpected direct script response: {other}."
            )),
        }
    }

    #[cfg(not(windows))]
    {
        run_flowcell_controller_script(script_path, program_key)
    }
}

fn clear_last_action_status_file() -> Result<(), String> {
    let status_path = resolve_flowcell_local_root()?
        .join("logs")
        .join("last_action_status.txt");
    let _ = fs::remove_file(&status_path);
    Ok(())
}

fn run_flowcell_controller_script(script_path: &Path, program_key: &str) -> Result<String, String> {
    if !script_path.is_file() {
        return Err(format!(
            "Script file was not found at {}.",
            script_path.display()
        ));
    }

    clear_last_action_status_file()?;
    let mut command = build_flowcell_controller_script_command(script_path, program_key, true)?;

    let child = command
        .spawn()
        .map_err(|error| format!("Failed to start FlowCell backend runner: {error}"))?;
    let output = wait_for_child_output_with_timeout(
        child,
        Duration::from_secs(FLOWCELL_CONTROLLER_SCRIPT_TIMEOUT_SECONDS),
        &format!(
            "FlowCell backend runner timed out after {} seconds while running {}.",
            FLOWCELL_CONTROLLER_SCRIPT_TIMEOUT_SECONDS,
            script_path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("script")
        ),
    )?;
    let status_message = read_last_action_status_message();

    if output.status.success() {
        return Ok(status_message.unwrap_or_else(|| {
            format!(
                "Started {}.",
                script_path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("script")
            )
        }));
    }

    if let Some(message) = status_message {
        return Err(message);
    }

    Err(format_process_failure(
        &output,
        "FlowCell backend runner reported a script failure.",
    ))
}

fn run_flowcell_macro_action(action_id: &str) -> Result<String, String> {
    let validated_action_id = validate_frontend_macro_id(action_id)?;
    let command_backend_path = resolve_flowcell_command_backend_script_path()?;
    let local_root = resolve_flowcell_local_root()?;
    let status_path = local_root.join("logs").join("last_action_status.txt");
    let _ = fs::remove_file(&status_path);
    let temp_dir = local_root.join("temp");
    fs::create_dir_all(&temp_dir).map_err(|error| {
        format!(
            "Failed to create FlowCell temp folder at {}: {error}",
            temp_dir.display()
        )
    })?;
    let stamp = current_timestamp_token();
    let envelope_path = temp_dir.join(format!(
        "flowcell_run_macro_{}_{}.json",
        validated_action_id, stamp
    ));
    let result_path = temp_dir.join(format!(
        "flowcell_run_macro_{}_{}_result.json",
        validated_action_id, stamp
    ));
    let envelope = json!({
        "command_id": "flowcell.run_macro",
        "program_id": 0,
        "panel_id": "",
        "button_id": validated_action_id,
        "source_surface": "PanelMacroButton",
        "request_id": format!("macro-{}-{}", validated_action_id, stamp),
        "timestamp": current_command_timestamp(),
        "payload": {
            "kind": FRONTEND_MACRO_KIND,
            "target": validated_action_id,
            "label": validated_action_id
        }
    });
    let envelope_text = serde_json::to_string_pretty(&envelope)
        .map_err(|error| format!("Failed to serialize macro command envelope: {error}"))?;
    fs::write(&envelope_path, envelope_text).map_err(|error| {
        format!(
            "Failed to write macro command envelope at {}: {error}",
            envelope_path.display()
        )
    })?;

    let arguments = vec![
        "-File".to_string(),
        command_backend_path.display().to_string(),
        "-EnvelopePath".to_string(),
        envelope_path.display().to_string(),
        "-ResultPath".to_string(),
        result_path.display().to_string(),
    ];
    let output = spawn_powershell_output(&arguments)?;
    let status_message = read_last_action_status_message();
    let command_result = fs::read_to_string(&result_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<FlowCellCommandBackendResult>(&raw).ok());
    let _ = fs::remove_file(&envelope_path);
    let _ = fs::remove_file(&result_path);

    if output.status.success() {
        if let Some(result) = command_result {
            if result.succeeded {
                return Ok(if result.message.trim().is_empty() {
                    format!("Ran {}.", validated_action_id)
                } else {
                    result.message
                });
            }
            if !result.message.trim().is_empty() {
                return Err(result.message);
            }
        }
        return Ok(status_message.unwrap_or_else(|| format!("Ran {}.", validated_action_id)));
    }

    if let Some(result) = command_result {
        if !result.message.trim().is_empty() {
            return Err(result.message);
        }
    }

    if let Some(message) = status_message {
        return Err(message);
    }

    Err(format_process_failure(
        &output,
        "FlowCell backend runner reported a macro failure.",
    ))
}

fn resolve_macro_recorder_script_path() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root().ok_or_else(|| {
        "FlowCell repo root could not be resolved for macro recording.".to_string()
    })?;
    let recorder_path = repo_root
        .join("FlowCell")
        .join("helpers")
        .join("RecordMacro.ahk");
    if recorder_path.is_file() {
        Ok(recorder_path)
    } else {
        Err(format!(
            "Macro recorder helper was not found at {}.",
            recorder_path.display()
        ))
    }
}

fn record_frontend_macro_to_path(
    macro_path: &Path,
    action_id: &str,
    label: &str,
) -> Result<(), String> {
    let recorder_path = resolve_macro_recorder_script_path()?;
    let ahk_exe = resolve_flowcell_autohotkey_exe_path()?;
    let flowcell_root = recorder_path
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "FlowCell root could not be resolved for macro recording.".to_string())?;

    let mut command = Command::new(ahk_exe);
    command
        .arg("/ErrorStdOut")
        .arg(&recorder_path)
        .arg(format!("--out={}", macro_path.display()))
        .arg(format!("--name={}", label.trim()))
        .arg(format!("--id={}", action_id.trim()))
        .arg("--process=")
        .arg("--activate=")
        .arg("--display=All windows")
        .current_dir(flowcell_root);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command
        .output()
        .map_err(|error| format!("Failed to start FlowCell macro recorder: {error}"))?;

    if output.status.success() {
        return Ok(());
    }

    let exit_code = output.status.code().unwrap_or(-1);
    if exit_code == 2 {
        return Err("Macro recording was canceled.".to_string());
    }
    if exit_code == 3 {
        return Err("Macro recording finished without any usable steps.".to_string());
    }

    Err(format_process_failure(
        &output,
        "FlowCell macro recorder failed.",
    ))
}

fn restart_flowcell_headless_backend() -> Result<(), String> {
    let backend_script_path = resolve_flowcell_backend_script_path()?;
    let launcher_path = resolve_flowcell_backend_launcher_path()?;
    let powershell_script = format!(
        concat!(
            "$ErrorActionPreference = 'Stop'; ",
            "$backendScript = '{backend_script}'; ",
            "Get-CimInstance Win32_Process -Filter \"Name = 'AutoHotkey64.exe' OR Name = 'AutoHotkey.exe'\" | ",
            "Where-Object {{ ($_.CommandLine -like \"*$backendScript*\") -and ($_.CommandLine -like '*--headless*') }} | ",
            "ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}; ",
            "Start-Sleep -Milliseconds 500; ",
            "& wscript.exe '{launcher_path}'"
        ),
        backend_script = escape_powershell_single_quoted(&backend_script_path.to_string_lossy()),
        launcher_path = escape_powershell_single_quoted(&launcher_path.to_string_lossy()),
    );

    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(powershell_script);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command.output().map_err(|error| {
        format!("Failed to restart the FlowCell backend after saving bindings: {error}")
    })?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format_process_failure(
            &output,
            "FlowCell backend restart failed after saving bindings.",
        ))
    }
}

fn file_name_for_copy(source_path: &Path) -> Result<String, String> {
    source_path
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .ok_or_else(|| {
            format!(
                "Could not resolve a file name for {}.",
                source_path.display()
            )
        })
}

fn files_are_byte_identical(left_path: &Path, right_path: &Path) -> Result<bool, String> {
    if paths_refer_to_same_existing_entry(left_path, right_path) {
        return Ok(true);
    }

    let left_metadata = fs::metadata(left_path)
        .map_err(|error| format!("Failed to inspect {}: {error}", left_path.display()))?;
    let right_metadata = fs::metadata(right_path)
        .map_err(|error| format!("Failed to inspect {}: {error}", right_path.display()))?;
    if left_metadata.len() != right_metadata.len() {
        return Ok(false);
    }

    let left_bytes = fs::read(left_path)
        .map_err(|error| format!("Failed to read {}: {error}", left_path.display()))?;
    let right_bytes = fs::read(right_path)
        .map_err(|error| format!("Failed to read {}: {error}", right_path.display()))?;
    Ok(left_bytes == right_bytes)
}

fn copy_script_to_program_local_scripts(
    program_name: &str,
    source_path: &Path,
) -> Result<PathBuf, String> {
    if !source_path.is_file() {
        return Err(format!(
            "Script file was not found: {}.",
            source_path.display()
        ));
    }

    let local_scripts_directory = resolve_program_local_scripts_directory(program_name)?;
    fs::create_dir_all(&local_scripts_directory).map_err(|error| {
        format!(
            "Failed to create {}: {error}",
            local_scripts_directory.display()
        )
    })?;

    let file_name = file_name_for_copy(source_path)?;
    let source_stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("script");
    let source_extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();

    for attempt in 0..1000 {
        let candidate_file_name = if attempt == 0 {
            file_name.clone()
        } else {
            format!("{source_stem}__{}{source_extension}", attempt + 1)
        };
        let candidate_path = local_scripts_directory.join(candidate_file_name);
        if candidate_path.is_file() {
            if files_are_byte_identical(source_path, &candidate_path)? {
                return Ok(candidate_path);
            }
            continue;
        }
        if candidate_path.exists() {
            continue;
        }

        fs::copy(source_path, &candidate_path).map_err(|error| {
            format!(
                "Failed to copy {} into {}: {error}",
                source_path.display(),
                candidate_path.display()
            )
        })?;
        return Ok(candidate_path);
    }

    Err(format!(
        "Could not find a unique local script name for {}.",
        source_path.display()
    ))
}

fn copy_script_to_panel_directory(
    panel_directory: &Path,
    source_path: &Path,
) -> Result<PathBuf, String> {
    if !source_path.is_file() {
        return Err(format!(
            "Script file was not found: {}.",
            source_path.display()
        ));
    }

    fs::create_dir_all(panel_directory)
        .map_err(|error| format!("Failed to create {}: {error}", panel_directory.display()))?;
    let file_name = file_name_for_copy(source_path)?;
    let target_path = panel_directory.join(file_name);

    if paths_refer_to_same_existing_entry(source_path, &target_path) {
        return Ok(target_path);
    }

    fs::copy(source_path, &target_path).map_err(|error| {
        format!(
            "Failed to copy {} into {}: {error}",
            source_path.display(),
            target_path.display()
        )
    })?;
    Ok(target_path)
}

fn copy_script_into_panel_workflow(
    program_name: &str,
    panel_directory: &Path,
    source_path: &Path,
) -> Result<(PathBuf, PathBuf), String> {
    let local_path = copy_script_to_program_local_scripts(program_name, source_path)?;
    let panel_path = copy_script_to_panel_directory(panel_directory, source_path)?;
    Ok((local_path, panel_path))
}

fn bootstrap_blender_program(program_name: &str, exe_path: Option<&str>) -> Result<String, String> {
    let blender_program_directory = resolve_program_directory("Blender")?;
    let installer_path = blender_program_directory
        .join("SupportScripts")
        .join("Install-FlowCellBlenderAddon.ps1");
    if !installer_path.is_file() {
        return Ok(format!(
            "{} was added, but the Blender payload installer is missing. Extract FlowCell-Blender.zip into the FlowCell Core root, then add Blender again.",
            program_name
        ));
    }

    let mut command = Command::new(resolve_powershell_path());
    command
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(&installer_path);
    if let Some(exe_path) = exe_path.map(str::trim).filter(|value| !value.is_empty()) {
        command.arg("-BlenderExePath").arg(exe_path);
    }

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command.output().map_err(|error| {
        format!(
            "Failed to start the Blender bridge installer at {}: {error}",
            installer_path.display()
        )
    })?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let message = if !stdout.is_empty() { stdout } else { stderr };

    if output.status.success() {
        if message.is_empty() {
            Ok(
                "Blender bridge installed. Restart Blender once after adding Blender in FlowCell."
                    .to_string(),
            )
        } else {
            Ok(message)
        }
    } else if message.is_empty() {
        Err(format!(
            "Blender bridge installation failed with exit code {:?}.",
            output.status.code()
        ))
    } else {
        Err(message)
    }
}

fn current_timestamp_string() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:09}Z", now.as_secs(), now.subsec_nanos())
}

fn resolve_blender_remove_button_script_path() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root().ok_or_else(|| {
        "FlowCell repo root could not be resolved for Blender button deletion.".to_string()
    })?;
    let script_path = repo_root
        .join("Programs")
        .join("Blender")
        .join("SupportScripts")
        .join("Remove-BlenderFlowCellButton.ps1");
    if script_path.is_file() {
        Ok(script_path)
    } else {
        Err(format!(
            "Blender delete helper was not found at {}.",
            script_path.display()
        ))
    }
}

fn delete_simple_panel_scripts(
    panel_directory: &Path,
    file_names: &[String],
    is_allowed_path: fn(&Path) -> bool,
    script_kind_label: &str,
) -> Result<(), String> {
    let mut recycle_paths = Vec::with_capacity(file_names.len());
    let mut macro_ids = Vec::new();

    for file_name in file_names {
        let validated_file_name = validate_panel_script_file_name(file_name)?;
        let script_path = panel_directory.join(&validated_file_name);

        if !script_path.is_file() {
            return Err(format!(
                "Script '{}' was not found in {}.",
                validated_file_name,
                panel_directory.display()
            ));
        }

        if validated_file_name
            .to_ascii_lowercase()
            .ends_with(BLENDER_PANEL_ITEM_SUFFIX)
        {
            let record = read_panel_item_file(&script_path)?;
            if !is_frontend_macro_panel_item(&record) {
                return Err(format!(
                    "Panel item '{}' is not a supported macro button.",
                    validated_file_name
                ));
            }
            let macro_path = resolve_frontend_macro_file_path(&record.macro_id)?;
            recycle_paths.push(script_path);
            if macro_path.is_file() {
                recycle_paths.push(macro_path);
            }
            macro_ids.push(record.macro_id);
            continue;
        }

        if !is_allowed_path(&script_path) {
            return Err(format!(
                "Script '{}' does not use a supported {} Add Script file type.",
                validated_file_name, script_kind_label
            ));
        }

        recycle_paths.push(script_path);
    }

    recycle_file_paths(&recycle_paths)?;
    remove_frontend_macro_hotkeys(&macro_ids)
}

fn delete_windows_panel_scripts(
    panel_directory: &Path,
    file_names: &[String],
) -> Result<(), String> {
    delete_simple_panel_scripts(
        panel_directory,
        file_names,
        is_allowed_windows_script_path,
        "Windows",
    )
}

fn delete_blender_panel_scripts(
    panel_directory: &Path,
    file_names: &[String],
) -> Result<(), String> {
    let delete_helper_path = resolve_blender_remove_button_script_path()?;
    let mut macro_ids = Vec::new();
    let mut record_entries = Vec::new();
    let mut deleting_record_keys = HashSet::new();

    for file_name in file_names {
        let record_path = resolve_blender_panel_item_path(panel_directory, file_name)?;
        let record = read_panel_item_file(&record_path)?;
        deleting_record_keys.insert(normalize_path_for_compare(&record_path));
        record_entries.push((record_path, record));
    }

    let mut recycle_panel_source_paths = Vec::new();
    for (record_path, record) in record_entries {
        if is_frontend_macro_panel_item(&record) {
            let macro_path = resolve_frontend_macro_file_path(&record.macro_id)?;
            if macro_path.is_file() {
                recycle_file_path(&macro_path)?;
            }
            recycle_file_path(&record_path)?;
            macro_ids.push(record.macro_id);
            continue;
        }
        let button_target = if !record.execution_target.trim().is_empty() {
            Some(record.execution_target.trim().to_string())
        } else if !record.bridge_action.trim().is_empty() {
            Some(format!("action:{}", record.bridge_action.trim()))
        } else if !record.source_path.trim().is_empty() {
            Some(record.source_path.trim().to_string())
        } else {
            None
        };

        if let Some(target) = button_target {
            let arguments = vec![
                "-File".to_string(),
                delete_helper_path.to_string_lossy().to_string(),
                "-ButtonTarget".to_string(),
                target,
            ];
            let output = spawn_powershell_output(&arguments)?;
            if !output.status.success() {
                return Err(format_process_failure(
                    &output,
                    &format!(
                        "Blender button delete cleanup failed for '{}'.",
                        record.label
                    ),
                ));
            }
        }

        let source_path = PathBuf::from(record.source_path.trim());
        if source_path.is_file() && path_is_under_directory(&source_path, panel_directory) {
            let normalized_source_path = normalize_path_for_compare(&source_path);
            let mut source_used_by_remaining_record = false;
            let entries = fs::read_dir(panel_directory).map_err(|error| {
                format!("Failed to read {}: {error}", panel_directory.display())
            })?;
            for entry in entries {
                let entry = entry.map_err(|error| {
                    format!("Failed to read {}: {error}", panel_directory.display())
                })?;
                let candidate_path = entry.path();
                let Some(candidate_file_name) =
                    candidate_path.file_name().and_then(|value| value.to_str())
                else {
                    continue;
                };
                if !candidate_file_name
                    .to_ascii_lowercase()
                    .ends_with(BLENDER_PANEL_ITEM_SUFFIX)
                {
                    continue;
                }
                if deleting_record_keys.contains(&normalize_path_for_compare(&candidate_path)) {
                    continue;
                }
                let candidate_record = read_panel_item_file(&candidate_path)?;
                if normalize_path_for_compare(Path::new(candidate_record.source_path.trim()))
                    == normalized_source_path
                {
                    source_used_by_remaining_record = true;
                    break;
                }
            }
            if !source_used_by_remaining_record
                && !recycle_panel_source_paths.iter().any(|path: &PathBuf| {
                    normalize_path_for_compare(path) == normalized_source_path
                })
            {
                recycle_panel_source_paths.push(source_path);
            }
        }

        recycle_file_path(&record_path)?;
    }

    recycle_file_paths(&recycle_panel_source_paths)?;
    remove_frontend_macro_hotkeys(&macro_ids)
}

fn resolve_windows_panel_script_path(
    program_name: &str,
    panel_name: &str,
    file_name: &str,
) -> Result<PathBuf, String> {
    if !is_windows_program_name(program_name) {
        return Err(format!(
            "Panel script execution is only wired for Windows right now, not '{}'.",
            program_name
        ));
    }

    let validated_file_name = validate_panel_script_file_name(file_name)?;
    let panel_directory = resolve_panel_directory(program_name, panel_name)?;
    let script_path = panel_directory.join(&validated_file_name);

    if !script_path.is_file() {
        return Err(format!(
            "Script '{}' was not found in {}.",
            validated_file_name,
            panel_directory.display()
        ));
    }

    if !is_allowed_windows_script_path(&script_path) {
        return Err(format!(
            "Script '{}' does not use a supported Windows Add Script file type.",
            validated_file_name
        ));
    }

    Ok(script_path)
}

fn spawn_via_cmd_start(script_path: &Path) -> Result<(), String> {
    let script_directory = script_path.parent().unwrap_or_else(|| Path::new("."));
    Command::new("cmd.exe")
        .arg("/c")
        .arg("start")
        .arg("")
        .arg(script_path)
        .current_dir(script_directory)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to start {}: {error}", script_path.display()))
}

fn run_windows_panel_script_file_with_window_mode(
    script_path: &Path,
    hide_window: bool,
) -> Result<(), String> {
    let script_directory = script_path.parent().unwrap_or_else(|| Path::new("."));
    let extension = script_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let mut command = match extension.as_str() {
        "ps1" => {
            let mut command = Command::new(resolve_powershell_path());
            command
                .arg("-NoProfile")
                .arg("-ExecutionPolicy")
                .arg("Bypass")
                .arg("-File")
                .arg(script_path);
            command
        }
        "cmd" | "bat" => {
            let mut command = Command::new("cmd.exe");
            command.arg("/c").arg(script_path);
            command
        }
        "exe" => Command::new(script_path),
        "vbs" => {
            let mut command = Command::new("wscript.exe");
            command.arg(script_path);
            command
        }
        "lnk" | "ahk" => return spawn_via_cmd_start(script_path),
        _ => return spawn_via_cmd_start(script_path),
    };

    #[cfg(windows)]
    if hide_window {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
        .current_dir(script_directory)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to run {}: {error}", script_path.display()))
}

fn run_windows_panel_script_file(script_path: &Path) -> Result<(), String> {
    run_windows_panel_script_file_with_window_mode(script_path, false)
}

fn add_blender_panel_scripts(
    panel_directory: &Path,
    panel_name: &str,
) -> Result<Vec<PanelScriptFileRecord>, String> {
    let initial_directory = resolve_blender_scripts_picker_directory(panel_name)
        .unwrap_or_else(|_| panel_directory.to_path_buf());
    let selected_paths = FileDialog::new()
        .set_title("Add Script")
        .set_directory(initial_directory)
        .add_filter("Blender Git Scripts", allowed_blender_script_extensions())
        .pick_files();

    if let Some(paths) = selected_paths {
        if paths.is_empty() {
            return list_blender_panel_script_files(panel_directory);
        }

        for source_path in &paths {
            if !source_path.is_file() {
                continue;
            }

            if !is_allowed_blender_script_path(source_path) {
                return Err(format!(
                    "Only Blender Python Add Script files are supported right now. Rejected '{}'.",
                    source_path.display()
                ));
            }
        }

        let repo_root = resolve_repo_root().ok_or_else(|| {
            "FlowCell repo root could not be resolved for Blender Add Script.".to_string()
        })?;
        let install_script_path = repo_root
            .join("Programs")
            .join("Blender")
            .join("SupportScripts")
            .join("Install-BlenderFlowCellButtons.ps1");
        if !install_script_path.is_file() {
            return Err(format!(
                "Blender install script was not found at {}.",
                install_script_path.display()
            ));
        }

        let mut panel_paths = Vec::new();
        for source_path in &paths {
            let (_local_path, panel_path) =
                copy_script_into_panel_workflow("Blender", panel_directory, source_path)?;
            panel_paths.push(panel_path);
        }

        let selected_paths_json = serde_json::to_string(
            &panel_paths
                .iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect::<Vec<_>>(),
        )
        .map_err(|error| format!("Could not serialize Blender Add Script selection: {error}"))?;

        let arguments = vec![
            "-File".to_string(),
            install_script_path.to_string_lossy().to_string(),
            "-PanelName".to_string(),
            panel_name.to_string(),
            "-SelectedPathsJson".to_string(),
            selected_paths_json,
        ];

        let output = spawn_powershell_output(&arguments)?;
        if !output.status.success() {
            return Err(format_process_failure(
                &output,
                "Blender Add Script failed before returning a result.",
            ));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let install_result =
            serde_json::from_str::<BlenderInstallResult>(&stdout).map_err(|error| {
                format!(
                    "Blender Add Script returned unreadable JSON: {error}. Output: {}",
                    stdout.chars().take(300).collect::<String>()
                )
            })?;

        for result in install_result.results {
            if !result.installed {
                continue;
            }

            let source_path = PathBuf::from(result.source.trim());
            let label = result
                .label
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(|value| value.trim().to_string())
                .unwrap_or_else(|| {
                    source_path
                        .file_stem()
                        .and_then(|value| value.to_str())
                        .map(format_panel_script_label)
                        .unwrap_or_else(|| "button".to_string())
                });
            let tooltip = result
                .tooltip
                .as_deref()
                .map(str::trim)
                .unwrap_or_default()
                .to_string();
            let children = if source_path.is_file() {
                parse_flowcell_children(&source_path).unwrap_or_default()
            } else {
                Vec::new()
            };
            let tool_kind = classify_blender_panel_item_kind(&label, &source_path, &children);
            let bridge_action = result
                .action
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .or_else(|| {
                    tool_kind
                        .map(default_blender_tool_bridge_action)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                })
                .ok_or_else(|| {
                    format!(
                        "Blender Add Script did not return a bridge action for '{}'.",
                        label
                    )
                })?;
            let panel_item = BlenderPanelItemRecord {
                label: label.clone(),
                tooltip,
                kind: tool_kind.unwrap_or("script").to_string(),
                source_path: source_path.to_string_lossy().to_string(),
                execution_target: String::new(),
                bridge_action,
                bridge_data: None,
                children,
                macro_id: String::new(),
            };
            let record_path = panel_item_path_for_label(panel_directory, &label);
            write_panel_item_file(&record_path, &panel_item)?;
        }
    }

    list_blender_panel_script_files(panel_directory)
}

fn add_adobe_panel_scripts(
    panel_directory: &Path,
    program_name: &str,
) -> Result<Vec<PanelScriptFileRecord>, String> {
    let panel_name = panel_directory
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let initial_directory = resolve_program_git_scripts_picker_directory(program_name, panel_name)
        .or_else(|_| resolve_adobe_scripts_library_directory(program_name))
        .unwrap_or_else(|_| panel_directory.to_path_buf());
    let selected_paths = FileDialog::new()
        .set_title("Add Script")
        .set_directory(initial_directory)
        .add_filter("Adobe Scripts", allowed_adobe_script_extensions())
        .pick_files();

    if let Some(paths) = selected_paths {
        for source_path in paths {
            if !source_path.is_file() {
                continue;
            }

            if !is_allowed_adobe_script_path(&source_path) {
                return Err(format!(
                    "Only Illustrator and Photoshop script files are supported right now. Rejected '{}'.",
                    source_path.display()
                ));
            }

            let (_local_path, _panel_path) =
                copy_script_into_panel_workflow(program_name, panel_directory, &source_path)?;
        }
    }

    list_adobe_panel_script_files(panel_directory)
}

fn run_blender_rotate_tool_action(
    item: &BlenderPanelItemRecord,
    axis: &str,
    center_mode: &str,
    operation_mode: &str,
    angle_deg: f64,
    distribute_count: i64,
) -> Result<String, String> {
    let action = if item.bridge_action.trim().is_empty() {
        DEFAULT_ROTATE_BRIDGE_ACTION.to_string()
    } else {
        item.bridge_action.trim().to_string()
    };
    let response = run_blender_bridge_action_direct(
        &action,
        json!({
            "command": "apply",
            "axis": axis,
            "center_mode": center_mode,
            "operation_mode": operation_mode,
            "angle_deg": angle_deg,
            "distribute_count": distribute_count
        }),
    )?;

    if let Some(message) = response
        .get("display")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(message.trim().to_string());
    }
    if let Some(message) = response
        .get("message")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(message.trim().to_string());
    }

    Ok(format!("Ran {}.", item.label))
}

fn run_blender_alignment_tool_action(
    item: &BlenderPanelItemRecord,
    command: &str,
    axis: &str,
    mode: &str,
    modifier: &str,
) -> Result<String, String> {
    let normalized_command = command.trim().to_ascii_lowercase();
    let data = match normalized_command.as_str() {
        "center_all" => json!({
            "command": "center_all"
        }),
        "align_axis" => json!({
            "command": "align_axis",
            "axis": axis,
            "mode": mode,
            "modifier": modifier
        }),
        _ => {
            return Err(format!(
                "Unsupported alignment tool command '{}'.",
                command.trim()
            ))
        }
    };
    let action = if item.bridge_action.trim().is_empty() {
        DEFAULT_ALIGNMENT_BRIDGE_ACTION.to_string()
    } else {
        item.bridge_action.trim().to_string()
    };
    let response = run_blender_bridge_action_direct(&action, data)?;

    if let Some(message) = response
        .get("display")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(message.trim().to_string());
    }
    if let Some(message) = response
        .get("message")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(message.trim().to_string());
    }

    Ok(format!("Ran {}.", item.label))
}

fn resolve_illustrator_anchor_engine_script_path() -> Result<PathBuf, String> {
    let program_directory = resolve_program_directory("Illustrator")?;
    let script_path = program_directory
        .join("HelperScripts")
        .join("FlowCell_Illustrator_Anchor.jsx");
    if script_path.is_file() {
        Ok(script_path)
    } else {
        Err(format!(
            "Illustrator anchor helper script was not found at {}.",
            script_path.display()
        ))
    }
}

fn write_illustrator_alignment_command_file(
    command: &str,
    axis: &str,
    mode: &str,
    modifier: &str,
    group_mode: bool,
) -> Result<PathBuf, String> {
    let local_root = resolve_flowcell_local_root()?;
    fs::create_dir_all(&local_root)
        .map_err(|error| format!("Failed to create {}: {error}", local_root.display()))?;
    let command_path = local_root.join("illustrator_anchor_command.json");
    let payload = json!({
        "command": command,
        "axis": axis,
        "mode": mode,
        "modifier": modifier,
        "group": group_mode
    });
    let content = serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("Failed to serialize Illustrator command payload: {error}"))?;
    fs::write(&command_path, content)
        .map_err(|error| format!("Failed to write {}: {error}", command_path.display()))?;
    Ok(command_path)
}

fn clear_illustrator_alignment_command_file() -> Result<(), String> {
    let command_path = resolve_flowcell_local_root()?.join("illustrator_anchor_command.json");
    match fs::remove_file(&command_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Failed to remove {}: {error}",
            command_path.display()
        )),
    }
}

fn write_illustrator_alignment_status(message: &str) -> Result<(), String> {
    let log_root = resolve_flowcell_local_root()?.join("logs");
    fs::create_dir_all(&log_root)
        .map_err(|error| format!("Failed to create {}: {error}", log_root.display()))?;
    let status_path = log_root.join("illustrator-anchor-status.txt");
    fs::write(&status_path, message)
        .map_err(|error| format!("Failed to write {}: {error}", status_path.display()))
}

fn disabled_illustrator_alignment_message() -> String {
    "Ill Align actions are disabled because this JSX path is hanging Illustrator; Set Anchor remains available.".to_string()
}

fn run_illustrator_alignment_tool_action(
    command: &str,
    axis: &str,
    mode: &str,
    modifier: &str,
    group_mode: bool,
) -> Result<String, String> {
    if !ILLUSTRATOR_ALIGNMENT_ACTIONS_ENABLED {
        let message = disabled_illustrator_alignment_message();
        clear_illustrator_alignment_command_file()?;
        write_illustrator_alignment_status(&message)?;
        return Ok(message);
    }

    let normalized_command = command.trim().to_ascii_lowercase();
    match normalized_command.as_str() {
        "align_axis" | "center_all" | "center_artboard" => {}
        _ => {
            return Err(format!(
                "Unsupported Illustrator alignment command '{}'.",
                command.trim()
            ))
        }
    }

    let normalized_axis = axis.trim().to_ascii_uppercase();
    if normalized_command == "align_axis" && !matches!(normalized_axis.as_str(), "X" | "Y") {
        return Err(format!(
            "Unsupported Illustrator alignment axis '{}'.",
            axis.trim()
        ));
    }

    let normalized_mode = mode.trim().to_ascii_uppercase();
    if normalized_command == "align_axis"
        && !matches!(normalized_mode.as_str(), "MIN" | "CENTER" | "MAX")
    {
        return Err(format!(
            "Unsupported Illustrator alignment mode '{}'.",
            mode.trim()
        ));
    }

    let normalized_modifier = modifier.trim().to_ascii_uppercase();
    if !matches!(
        normalized_modifier.as_str(),
        "" | "SURFACE" | "GEOCENTER" | "ORIGIN"
    ) {
        return Err(format!(
            "Unsupported Illustrator alignment modifier '{}'.",
            modifier.trim()
        ));
    }

    clear_illustrator_alignment_command_file()?;
    write_illustrator_alignment_command_file(
        &normalized_command,
        &normalized_axis,
        &normalized_mode,
        &normalized_modifier,
        group_mode,
    )?;
    let script_path = resolve_illustrator_anchor_engine_script_path()?;
    run_illustrator_backend_script_direct(&script_path, "illustrator_automation")
}

fn toolset_message_response(message: String) -> Value {
    json!({
        "message": message,
        "display": message
    })
}

fn validate_toolset_child_slot(
    children: &[PanelScriptChildRecord],
    command: &str,
    label: &str,
) -> Result<(), String> {
    let normalized_command = command.trim();
    if normalized_command.is_empty() {
        return Err("Tool-set actions require a non-empty command.".to_string());
    }

    if children
        .iter()
        .any(|child| child.slot.eq_ignore_ascii_case(normalized_command))
    {
        return Ok(());
    }

    Err(format!(
        "Tool set '{}' does not define child slot '{}'.",
        label, normalized_command
    ))
}

fn run_illustrator_alignment_tool_slot_action(slot: &str) -> Result<String, String> {
    let normalized_slot = slot.trim().to_ascii_lowercase();
    if normalized_slot == "toggle_group" {
        return Ok("Group is toggled inside the Ill Align popout.".to_string());
    }

    let (command, axis, mode, modifier) = match normalized_slot.as_str() {
        "x_min" => ("align_axis", "X", "MIN", ""),
        "x_center" => ("align_axis", "X", "CENTER", ""),
        "x_max" => ("align_axis", "X", "MAX", ""),
        "x_surface" => ("align_axis", "X", "CENTER", "SURFACE"),
        "x_geo" => ("align_axis", "X", "CENTER", "GEOCENTER"),
        "y_min" => ("align_axis", "Y", "MIN", ""),
        "y_center" => ("align_axis", "Y", "CENTER", ""),
        "y_max" => ("align_axis", "Y", "MAX", ""),
        "y_surface" => ("align_axis", "Y", "CENTER", "SURFACE"),
        "y_geo" => ("align_axis", "Y", "CENTER", "GEOCENTER"),
        "center_artboard" => ("center_artboard", "", "", ""),
        "center_everything" | "center_xy" => ("center_all", "", "", ""),
        _ => {
            return Err(format!(
                "Ill Align does not support child slot '{}'.",
                slot.trim()
            ))
        }
    };

    run_illustrator_alignment_tool_action(command, axis, mode, modifier, false)
}

fn resolve_illustrator_toolset_record(
    program_name: &str,
    panel_name: &str,
    file_name: &str,
) -> Result<(PathBuf, PanelScriptFileRecord), String> {
    let panel_directory = resolve_panel_directory(program_name, panel_name)?;
    let validated_file_name = validate_panel_script_file_name(file_name)?;
    let script_path = panel_directory.join(&validated_file_name);
    if !script_path.is_file() {
        return Err(format!(
            "Illustrator toolset '{}' was not found in {}.",
            validated_file_name,
            panel_directory.display()
        ));
    }
    if !is_allowed_adobe_script_path(&script_path) {
        return Err(format!(
            "Only Illustrator script files can be run as Illustrator toolsets from '{}'.",
            validated_file_name
        ));
    }

    let record = read_adobe_panel_script_record(&script_path, validated_file_name);

    Ok((script_path, record))
}

fn write_generic_toolset_command_file(
    program_name: &str,
    panel_name: &str,
    file_name: &str,
    command: &str,
    payload: Option<Value>,
) -> Result<PathBuf, String> {
    let local_root = resolve_flowcell_local_root()?;
    fs::create_dir_all(&local_root)
        .map_err(|error| format!("Failed to create {}: {error}", local_root.display()))?;
    let command_path = local_root.join("toolset_action.json");
    let content = serde_json::to_string_pretty(&json!({
        "programName": program_name,
        "panelName": panel_name,
        "fileName": file_name,
        "command": command,
        "payload": payload.unwrap_or_else(|| Value::Object(Map::new()))
    }))
    .map_err(|error| format!("Failed to serialize toolset command payload: {error}"))?;
    fs::write(&command_path, content)
        .map_err(|error| format!("Failed to write {}: {error}", command_path.display()))?;
    Ok(command_path)
}

fn write_illustrator_rotate_command_file(
    program_name: &str,
    panel_name: &str,
    file_name: &str,
    command: &str,
    payload: Option<Value>,
) -> Result<PathBuf, String> {
    let local_root = resolve_flowcell_local_root()?;
    fs::create_dir_all(&local_root)
        .map_err(|error| format!("Failed to create {}: {error}", local_root.display()))?;
    let command_path = local_root.join("illustrator_rotate_command.json");
    let created_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let content = serde_json::to_string_pretty(&json!({
        "programName": program_name,
        "panelName": panel_name,
        "fileName": file_name,
        "command": command,
        "createdAtMs": created_at_ms,
        "payload": payload.unwrap_or_else(|| Value::Object(Map::new()))
    }))
    .map_err(|error| format!("Failed to serialize Illustrator rotate command payload: {error}"))?;
    fs::write(&command_path, content)
        .map_err(|error| format!("Failed to write {}: {error}", command_path.display()))?;
    Ok(command_path)
}

fn clear_illustrator_rotate_command_file() -> Result<(), String> {
    let command_path = resolve_flowcell_local_root()?.join("illustrator_rotate_command.json");
    match fs::remove_file(&command_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Failed to remove {}: {error}",
            command_path.display()
        )),
    }
}

fn run_illustrator_toolset_action(
    program_name: &str,
    panel_name: &str,
    file_name: &str,
    command: &str,
    payload: Option<Value>,
) -> Result<Value, String> {
    let normalized_command = command.trim();
    let (script_path, record) =
        resolve_illustrator_toolset_record(program_name, panel_name, file_name)?;
    let children = record.children.as_deref().unwrap_or(&[]);
    validate_toolset_child_slot(children, normalized_command, &record.label)?;

    if record
        .kind
        .as_deref()
        .map(|kind| kind.eq_ignore_ascii_case(ILLUSTRATOR_ALIGNMENT_TOOL_KIND))
        .unwrap_or(false)
    {
        let message = run_illustrator_alignment_tool_slot_action(normalized_command)?;
        return Ok(toolset_message_response(message));
    }

    if record
        .kind
        .as_deref()
        .map(|kind| kind.eq_ignore_ascii_case(ILLUSTRATOR_ROTATE_TOOL_KIND))
        .unwrap_or(false)
    {
        let action_lock = ILLUSTRATOR_ROTATE_ACTION_LOCK.get_or_init(|| Mutex::new(()));
        let _action_guard = action_lock.try_lock().map_err(|_| {
            "Illustrator Rotate action is still running. Wait for it to finish before pressing another button."
                .to_string()
        })?;
        clear_illustrator_rotate_command_file()?;
        write_illustrator_rotate_command_file(
            program_name,
            panel_name,
            file_name,
            normalized_command,
            payload,
        )?;
        let result = run_illustrator_backend_script_direct(&script_path, "illustrator_automation");
        let message = result?;
        return Ok(toolset_message_response(message));
    }

    write_generic_toolset_command_file(
        program_name,
        panel_name,
        file_name,
        normalized_command,
        payload,
    )?;
    let message = run_flowcell_controller_script(&script_path, "illustrator_automation")?;
    Ok(toolset_message_response(message))
}

fn run_blender_smart_axis_tool_action(
    item: &BlenderPanelItemRecord,
    command: &str,
) -> Result<serde_json::Value, String> {
    let normalized_command = command.trim().to_ascii_lowercase();
    let action = if item.bridge_action.trim().is_empty() {
        DEFAULT_SMART_AXIS_BRIDGE_ACTION.to_string()
    } else {
        item.bridge_action.trim().to_string()
    };

    let data = json!({
        "action": normalized_command,
        "command": normalized_command
    });
    if normalized_command == "status" {
        return run_blender_bridge_status_action_or_fallback(
            &action,
            data,
            "Smart Axis status is pending.",
        );
    }

    run_blender_bridge_action_direct(&action, data)
}

fn run_blender_generic_toolset_action(
    item: &BlenderPanelItemRecord,
    command: &str,
    payload: Option<Value>,
) -> Result<Value, String> {
    let normalized_command = command.trim();
    if normalized_command.is_empty() {
        return Err("Tool-set actions require a non-empty command.".to_string());
    }

    let action = item.bridge_action.trim();
    if action.is_empty() {
        return Err(format!(
            "Tool set '{}' is missing a bridge action.",
            item.label
        ));
    }

    let mut request_payload = match payload {
        Some(Value::Object(map)) => map,
        Some(_) => return Err("Tool-set payload must be a JSON object when provided.".to_string()),
        None => Map::new(),
    };
    request_payload
        .entry("command".to_string())
        .or_insert_with(|| Value::String(normalized_command.to_string()));
    request_payload
        .entry("action".to_string())
        .or_insert_with(|| Value::String(normalized_command.to_string()));
    if normalized_command.eq_ignore_ascii_case("status") {
        return run_blender_bridge_status_action_or_fallback(
            action,
            Value::Object(request_payload),
            "Blender tool status is pending.",
        );
    }

    run_blender_bridge_action_direct_with_fallback(action, Value::Object(request_payload))
}

#[cfg(windows)]
fn apply_square_corner_preference<R: tauri::Runtime>(window: &WebviewWindow<R>) {
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

fn show_and_focus_window<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    let _ = window.unminimize();
    window.set_focus().map_err(|error| error.to_string())?;

    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        let _ = unsafe { ShowWindowAsync(hwnd, SW_RESTORE) };
        let _ = unsafe { SetForegroundWindow(hwnd) };
    }

    Ok(())
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
    if target_owner_hwnd != current_owner_hwnd {
        set_native_window_owner(window, target_owner_hwnd)?;
    }

    let should_stay_on_top = matches_target && !cursor_over_taskbar_or_preview;
    let should_promote = should_stay_on_top
        && matches_target_process
        && foreground.hwnd != 0
        && foreground.hwnd != window_hwnd;
    set_window_topmost_impl(window, should_stay_on_top, should_promote)?;

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
fn get_foreground_process_info_impl() -> ForegroundProcessInfo {
    get_foreground_window_state_impl().process_info
}

#[cfg(not(windows))]
fn get_foreground_process_info_impl() -> ForegroundProcessInfo {
    ForegroundProcessInfo::default()
}

#[cfg(windows)]
fn query_process_path_by_id(process_id: u32) -> Option<String> {
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
fn resolve_target_blender_process_id(bridge_root: &Path) -> Result<u32, String> {
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
fn resolve_target_blender_process_id(_bridge_root: &Path) -> Result<u32, String> {
    Err("Direct Blender bridge requests are only supported on Windows.".to_string())
}

fn run_blender_bridge_action_direct(action: &str, data: Value) -> Result<Value, String> {
    run_blender_bridge_action_direct_with_options(action, data, None, false)
}

fn blender_bridge_action_fallback(action: &str) -> Option<&'static str> {
    match action.trim().to_ascii_lowercase().as_str() {
        "flowcell_custom_theme" | "flowcell_custom_hdri_world_tools" => {
            Some("custom_hdri_world_tools")
        }
        _ => None,
    }
}

fn is_blender_bridge_unsupported_action_error(message: &str, action: &str) -> bool {
    let expected = format!("unsupported action: {}", action.trim().to_ascii_lowercase());
    message.trim().to_ascii_lowercase().contains(&expected)
}

fn run_blender_bridge_action_direct_with_fallback(
    action: &str,
    data: Value,
) -> Result<Value, String> {
    match run_blender_bridge_action_direct(action, data.clone()) {
        Ok(response) => Ok(response),
        Err(message) => {
            let Some(fallback_action) = blender_bridge_action_fallback(action) else {
                return Err(message);
            };
            if fallback_action.eq_ignore_ascii_case(action)
                || !is_blender_bridge_unsupported_action_error(&message, action)
            {
                return Err(message);
            }

            run_blender_bridge_action_direct(fallback_action, data)
        }
    }
}

fn run_blender_bridge_status_action_or_fallback(
    action: &str,
    data: Value,
    fallback_message: &str,
) -> Result<Value, String> {
    match run_blender_bridge_action_direct_with_options(
        action,
        data,
        Some(Duration::from_millis(BLENDER_BRIDGE_STATUS_TIMEOUT_MS)),
        true,
    ) {
        Ok(response) => Ok(response),
        Err(_) => Ok(json!({
            "status": "ok",
            "message": fallback_message,
            "display": fallback_message,
            "registered": false,
            "runner_active": false,
            "enabled_tool_count": 0,
            "selected": 0,
            "modes": {
                "X": "NONE",
                "Y": "NONE",
                "Z": "NONE"
            }
        })),
    }
}

fn run_blender_bridge_action_direct_with_options(
    action: &str,
    data: Value,
    timeout_override: Option<Duration>,
    skip_if_busy: bool,
) -> Result<Value, String> {
    let lock = BLENDER_BRIDGE_REQUEST_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = if skip_if_busy {
        lock.try_lock().map_err(|_| {
            "Blender bridge status request skipped because another request is running.".to_string()
        })?
    } else {
        lock.lock()
            .map_err(|_| "Blender bridge request lock was poisoned.".to_string())?
    };

    let config = read_blender_bridge_config()?;
    let bridge_root = resolve_blender_bridge_root(&config)
        .ok_or_else(|| BLENDER_BRIDGE_NOT_RUNNING_MESSAGE.to_string())?;
    let target_blender_process_id = resolve_target_blender_process_id(&bridge_root)
        .map_err(|_| BLENDER_BRIDGE_NOT_RUNNING_MESSAGE.to_string())?;
    let bridge_folder = bridge_root.join(target_blender_process_id.to_string());
    fs::create_dir_all(&bridge_folder).map_err(|error| {
        format!(
            "Failed to create Blender bridge folder at {}: {error}",
            bridge_folder.display()
        )
    })?;

    let request_id = build_blender_bridge_request_id();
    let request_path = bridge_folder.join("request.json");
    let response_path = bridge_folder.join("response.json");
    if response_path.exists() {
        let _ = fs::remove_file(&response_path);
    }

    let request_payload = json!({
        "id": request_id,
        "action": action,
        "data": data,
        "requested": SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .to_string()
    });
    fs::write(&request_path, request_payload.to_string()).map_err(|error| {
        format!(
            "Failed to write Blender bridge request at {}: {error}",
            request_path.display()
        )
    })?;

    let timeout_duration = timeout_override.unwrap_or_else(|| {
        Duration::from_secs(
            config
                .response_timeout_seconds
                .unwrap_or(DEFAULT_BLENDER_BRIDGE_TIMEOUT_SECONDS)
                .max(1),
        )
    });
    let response = wait_for_blender_bridge_response(&response_path, &request_id, timeout_duration)
        .ok_or_else(|| BLENDER_BRIDGE_NOT_RUNNING_MESSAGE.to_string())?;

    let message = extract_blender_bridge_response_message(&response);
    write_last_action_status_message(&message);

    if !did_blender_bridge_response_succeed(&response) {
        return Err(message);
    }

    Ok(response)
}

#[tauri::command]
fn set_host_window_bounds(
    app: AppHandle,
    label: String,
    bounds: HostWindowBounds,
    #[allow(unused_variables)] registry: State<ScopedTopmostRegistry>,
) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Window '{}' was not found.", label))?;

    window
        .set_resizable(true)
        .map_err(|error| error.to_string())?;
    window
        .set_min_size(None::<LogicalSize<f64>>)
        .map_err(|error| error.to_string())?;
    window
        .set_max_size(None::<LogicalSize<f64>>)
        .map_err(|error| error.to_string())?;
    window
        .set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|error| error.to_string())?;
    window
        .set_size(LogicalSize::new(bounds.width, bounds.height))
        .map_err(|error| error.to_string())?;

    #[cfg(windows)]
    {
        let entries_snapshot = {
            let entries = registry
                .entries
                .lock()
                .map_err(|_| String::from("Scoped topmost registry lock failed."))?;
            entries.clone()
        };
        let scoped_entry = entries_snapshot.get(&label).cloned();

        if let Some(entry) = scoped_entry {
            let foreground = get_foreground_window_state_impl();
            let foreground_scoped_process_names =
                resolve_foreground_scoped_process_names(&app, &entries_snapshot, &foreground);
            if let Ok((last_applied, last_target_match, last_owner_hwnd)) =
                apply_scoped_window_state(
                    &window,
                    &entry,
                    &foreground,
                    foreground_scoped_process_names.as_deref(),
                )
            {
                if let Ok(mut entries) = registry.entries.lock() {
                    if let Some(next_entry) = entries.get_mut(&label) {
                        next_entry.last_applied = Some(last_applied);
                        next_entry.last_target_match = Some(last_target_match);
                        next_entry.last_owner_hwnd = last_owner_hwnd;
                    }
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn set_host_window_topmost(
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
fn register_scoped_window_topmost(
    label: String,
    program_name: String,
    bind_owner: Option<bool>,
    registry: State<ScopedTopmostRegistry>,
) -> Result<(), String> {
    let process_names = resolve_program_process_names(&program_name);
    let mut entries = registry
        .entries
        .lock()
        .map_err(|_| String::from("Scoped topmost registry lock failed."))?;

    if process_names.is_empty() {
        entries.remove(&label);
        return Ok(());
    }

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

    Ok(())
}

#[tauri::command]
fn unregister_scoped_window_topmost(
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
fn refresh_scoped_window_topmost(
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
fn refresh_frontend_host() -> Result<(), String> {
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
fn get_foreground_process_info() -> Result<ForegroundProcessInfo, String> {
    Ok(get_foreground_process_info_impl())
}

#[tauri::command]
fn list_program_folders() -> Result<Vec<String>, String> {
    let programs_root = resolve_programs_root()?;
    let available_folder_names = list_child_directory_names(&programs_root)?;
    let (_, document, _) = read_bindings_file_state()?;
    Ok(registered_program_folder_names(
        &available_folder_names,
        &document,
    ))
}

#[tauri::command]
fn list_panel_folders(program_name: String) -> Result<Vec<String>, String> {
    let Some(panels_root) = resolve_panels_root(&program_name, false)? else {
        return Ok(Vec::new());
    };

    list_child_directory_names(&panels_root)
}

fn resolve_program_executable(
    program_name: &str,
    selected_location: &str,
) -> Result<PathBuf, String> {
    let selected_location = selected_location.trim().trim_matches('"');
    let selected_path = PathBuf::from(selected_location);
    if selected_path.is_file() {
        let is_exe = selected_path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("exe"));
        return is_exe.then_some(selected_path).ok_or_else(|| {
            format!("The selected program file is not an EXE: {selected_location}")
        });
    }
    if !selected_path.is_dir() {
        return Err(format!(
            "Program executable or containing folder was not found: {selected_location}"
        ));
    }

    let mut candidates = fs::read_dir(&selected_path)
        .map_err(|error| format!("Unable to inspect {}: {error}", selected_path.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case("exe"))
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|path| {
        path.file_name()
            .map(|value| value.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default()
    });
    if candidates.is_empty() {
        return Err(format!(
            "No EXE was found directly inside {}.",
            selected_path.display()
        ));
    }

    let normalize = |value: &str| {
        value
            .chars()
            .filter(|character| character.is_ascii_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect::<String>()
    };
    let stem = |path: &Path| {
        path.file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
    };
    let template_key = infer_program_template_key(program_name, Some(selected_location));
    let preferred_stem = match template_key {
        "blender" => Some("blender"),
        "illustrator" => Some("illustrator"),
        "photoshop" => Some("photoshop"),
        "windows" => Some("explorer"),
        _ => None,
    };
    if let Some(preferred_stem) = preferred_stem {
        if let Some(candidate) = candidates
            .iter()
            .find(|candidate| stem(candidate).eq_ignore_ascii_case(preferred_stem))
        {
            return Ok(candidate.clone());
        }
    }

    let normalized_program_name = normalize(program_name);
    if let Some(candidate) = candidates
        .iter()
        .find(|candidate| normalize(&stem(candidate)) == normalized_program_name)
    {
        return Ok(candidate.clone());
    }

    let auxiliary_terms = [
        "crash",
        "helper",
        "launcher",
        "setup",
        "uninstall",
        "update",
        "report",
        "service",
    ];
    let primary_candidates = candidates
        .iter()
        .filter(|candidate| {
            let candidate_stem = stem(candidate);
            !auxiliary_terms
                .iter()
                .any(|term| candidate_stem.contains(term))
        })
        .cloned()
        .collect::<Vec<_>>();
    if primary_candidates.len() == 1 {
        return Ok(primary_candidates[0].clone());
    }
    if candidates.len() == 1 {
        return Ok(candidates.remove(0));
    }

    let candidate_names = candidates
        .iter()
        .filter_map(|path| path.file_name().and_then(|value| value.to_str()))
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "Multiple EXEs were found in {}: {}. Run Add Program again and paste the full path to the correct EXE.",
        selected_path.display(),
        candidate_names
    ))
}

#[tauri::command]
fn create_program_folder(
    name: String,
    exe_path: Option<String>,
) -> Result<CreateProgramFolderResult, String> {
    let requested_program_name = validate_folder_name(&name, "Program")?;
    let selected_location = exe_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Choose the program executable or its containing folder.".to_string())?;
    let exe_path = resolve_program_executable(&requested_program_name, selected_location)?;
    let exe_path = exe_path.to_string_lossy().into_owned();
    let programs_root = resolve_programs_root()?;
    let program_path = if let Some(existing_path) =
        find_named_child_directory(&programs_root, &requested_program_name)?
    {
        existing_path
    } else {
        let program_path = programs_root.join(&requested_program_name);
        fs::create_dir(&program_path)
            .map_err(|error| format!("Failed to create {}: {error}", program_path.display()))?;
        program_path
    };
    let program_name = program_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&requested_program_name)
        .to_string();

    let bootstrap_message =
        if infer_program_template_key(&program_name, Some(&exe_path)) == "blender" {
            Some(bootstrap_blender_program(&program_name, Some(&exe_path))?)
        } else {
            None
        };

    let (_, mut document, bindings_path) = read_bindings_file_state()?;
    upsert_program_registration(&mut document, &program_name, &program_path, &exe_path);
    write_bindings_file_state(&bindings_path, &document)?;
    let reload_error = restart_flowcell_headless_backend().err();
    let mut status_message = format!("{program_name} registered with {exe_path}.");
    if let Some(message) = bootstrap_message.filter(|message| !message.trim().is_empty()) {
        status_message.push_str("\n\n");
        status_message.push_str(&message);
    }
    if let Some(error) = reload_error {
        status_message.push_str("\n\nBackend reload failed: ");
        status_message.push_str(&error);
    }

    Ok(CreateProgramFolderResult {
        program_name,
        status_message: Some(status_message),
    })
}

#[tauri::command]
fn rename_program_folder(current_name: String, name: String) -> Result<String, String> {
    let programs_root = resolve_programs_root()?;
    let final_name = rename_child_directory(&programs_root, &current_name, &name, "Program")?;
    let (_, mut document, bindings_path) = read_bindings_file_state()?;
    if let Some(program) = find_registered_program(&document, &current_name) {
        let exe_path = document
            .get(&format!("ProgramTab_{}", program.id))
            .and_then(|section| section.get("ExePath"))
            .cloned()
            .unwrap_or_default();
        let program_path = resolve_program_directory(&final_name)?;
        document.remove(&format!("ProgramTab_{}", program.id));
        write_program_registration_section(
            &mut document,
            program.id,
            &final_name,
            &program_path,
            &exe_path,
        );
        sync_program_registration_meta(&mut document, Some(program.id));
        write_bindings_file_state(&bindings_path, &document)?;
        let _ = restart_flowcell_headless_backend();
    }
    Ok(final_name)
}

#[tauri::command]
fn delete_program_folder(name: String) -> Result<(), String> {
    let program_path = resolve_program_directory(&name)?;
    recycle_directory_path(&program_path)?;
    let (_, mut document, bindings_path) = read_bindings_file_state()?;
    remove_program_registration(&mut document, &name);
    write_bindings_file_state(&bindings_path, &document)?;
    let _ = restart_flowcell_headless_backend();
    Ok(())
}

#[tauri::command]
fn create_panel_folder(program_name: String, name: String) -> Result<String, String> {
    let panel_name = validate_folder_name(&name, "Panel")?;
    let panels_root = resolve_panels_root(&program_name, true)?.ok_or_else(|| {
        format!(
            "Panels folder for '{}' could not be resolved.",
            program_name
        )
    })?;
    let panel_path = panels_root.join(&panel_name);

    fs::create_dir(&panel_path).map_err(|error| match error.kind() {
        ErrorKind::AlreadyExists => format!("Panel folder '{}' already exists.", panel_name),
        _ => format!("Failed to create {}: {error}", panel_path.display()),
    })?;

    Ok(panel_name)
}

#[tauri::command]
fn rename_panel_folder(
    program_name: String,
    current_name: String,
    name: String,
) -> Result<String, String> {
    let panels_root = resolve_panels_root(&program_name, false)?.ok_or_else(|| {
        format!(
            "Panels folder for '{}' could not be resolved.",
            program_name
        )
    })?;
    rename_child_directory(&panels_root, &current_name, &name, "Panel")
}

#[tauri::command]
fn delete_panel_folder(program_name: String, name: String) -> Result<(), String> {
    let panel_path = resolve_panel_directory(&program_name, &name)?;
    recycle_directory_path(&panel_path)
}

#[tauri::command]
fn list_panel_script_files(
    program_name: String,
    panel_name: String,
) -> Result<Vec<PanelScriptFileRecord>, String> {
    let panel_directory = resolve_panel_directory(&program_name, &panel_name)?;
    if is_windows_program_name(&program_name) {
        return list_windows_panel_script_files(&panel_directory);
    }
    if is_adobe_program_name(&program_name) {
        return list_adobe_panel_script_files(&panel_directory);
    }
    if is_blender_program_name(&program_name) {
        return list_blender_panel_script_files(&panel_directory);
    }

    list_generic_panel_script_files(&panel_directory)
}

#[tauri::command]
fn load_binds_workspace() -> Result<BindsWorkspaceResponse, String> {
    let (bindings, _document, _bindings_path) = read_bindings_file_state()?;
    let (shortcut_profiles, warnings) = read_shortcut_profile_documents()?;
    let program_names = list_program_folders()?;
    let mut programs = Vec::new();

    for program_name in program_names {
        let panel_names = list_panel_folders(program_name.clone())?;
        let mut panels = Vec::new();
        for panel_name in panel_names {
            panels.push(BindablePanelRecord {
                name: panel_name.clone(),
                buttons: list_bindable_buttons_for_panel(&program_name, &panel_name, &bindings)?,
            });
        }
        append_core_bind_actions_for_program(&program_name, &mut panels, &bindings);

        programs.push(BindableProgramRecord {
            name: program_name.clone(),
            program_tab_id: resolve_program_tab_id(&program_name),
            panels,
        });
    }

    Ok(BindsWorkspaceResponse {
        programs,
        macros: list_frontend_macro_summaries(None, None)?,
        bindings,
        shortcut_profiles,
        warnings,
    })
}

#[tauri::command]
fn save_bind_shortcut(
    request: SaveBindShortcutRequest,
) -> Result<SaveBindShortcutResponse, String> {
    let program_name = request.program_name.trim();
    if program_name.is_empty() {
        return Err("Pick a program and panel.".to_string());
    }
    resolve_program_directory(program_name)?;

    let target = resolve_legacy_windows_binding_path(&request.target);
    if target.trim().is_empty() {
        return Err("No buttons in this panel.".to_string());
    }
    let target_path = PathBuf::from(&target);
    if !target_path.is_file() {
        return Err(format!(
            "Binding target was not found at {}.",
            target_path.display()
        ));
    }

    let (bindings, mut document, bindings_path) = read_bindings_file_state()?;
    let mut script_bindings = bindings.script_bindings.clone();
    let normalized_target = normalize_binding_target_for_compare(&target);
    let normalized_shortcut = request.shortcut.trim().to_ascii_lowercase();
    let requested_binding_id = request.binding_id.unwrap_or(0);
    let effective_program_tab_id = if request.program_tab_id > 0 {
        request.program_tab_id
    } else {
        resolve_program_tab_id(program_name)
    };
    let binding_index = script_bindings.iter().position(|binding| {
        let binding_id = binding.id.or(binding.binding_id).unwrap_or(0);
        if requested_binding_id > 0 && binding_id == requested_binding_id {
            return true;
        }

        binding.program_tab_id.unwrap_or(0) == effective_program_tab_id
            && normalize_binding_target_for_compare(&binding.target) == normalized_target
    });

    if !normalized_shortcut.is_empty() {
        if script_bindings.iter().enumerate().any(|(index, binding)| {
            if Some(index) == binding_index {
                return false;
            }

            binding
                .shortcut
                .trim()
                .eq_ignore_ascii_case(&normalized_shortcut)
        }) {
            return Err("That shortcut is already in use.".to_string());
        }
        if bindings
            .action_hotkeys
            .values()
            .any(|shortcut| shortcut.trim().eq_ignore_ascii_case(&normalized_shortcut))
        {
            return Err("That shortcut is already in use.".to_string());
        }
    }

    if resolve_dummy_monitor_binding()
        .map(|(_, dummy_target, _)| {
            normalize_binding_target_for_compare(&dummy_target) == normalized_target
        })
        .unwrap_or(false)
    {
        document.entry(String::from("Meta")).or_default().insert(
            String::from("DummyMonitorDefaultEnabled"),
            if normalized_shortcut.is_empty() {
                String::from("0")
            } else {
                String::from("1")
            },
        );
    }

    if normalized_shortcut.is_empty() {
        if let Some(index) = binding_index {
            script_bindings.remove(index);
        }
    } else if let Some(index) = binding_index {
        let binding_id = script_bindings[index]
            .id
            .or(script_bindings[index].binding_id)
            .unwrap_or(0);
        script_bindings[index].shortcut = request.shortcut.trim().to_string();
        script_bindings[index].target = target.clone();
        script_bindings[index].program_tab_id = Some(effective_program_tab_id);
        script_bindings[index].id = Some(binding_id);
        script_bindings[index].binding_id = Some(binding_id);
    } else {
        let next_id = bindings.next_id.unwrap_or(1).max(1);
        script_bindings.push(FrontendScriptBindingRecord {
            id: Some(next_id),
            binding_id: Some(next_id),
            kind: Some(String::from("script")),
            label: None,
            status: Some(String::from("Saved")),
            program_tab_id: Some(effective_program_tab_id),
            shortcut: request.shortcut.trim().to_string(),
            target: target.clone(),
        });
        document
            .entry(String::from("Meta"))
            .or_default()
            .insert(String::from("NextId"), (next_id + 1).to_string());
    }

    script_bindings.sort_by_key(|binding| binding.id.or(binding.binding_id).unwrap_or(0));
    let ids = script_bindings
        .iter()
        .filter_map(|binding| binding.id.or(binding.binding_id))
        .collect::<Vec<_>>();
    let meta_section = document.entry(String::from("Meta")).or_default();
    meta_section.insert(
        String::from("NextId"),
        (ids.iter().copied().max().unwrap_or(0) + 1)
            .max(1)
            .to_string(),
    );
    meta_section.insert(
        String::from("Ids"),
        ids.iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("|"),
    );

    let existing_binding_sections = document
        .keys()
        .filter(|section| section.starts_with("Binding_"))
        .cloned()
        .collect::<Vec<_>>();
    for section in existing_binding_sections {
        document.remove(&section);
    }

    for binding in &script_bindings {
        let binding_id = binding.id.or(binding.binding_id).unwrap_or(0);
        if binding_id == 0 || binding.shortcut.trim().is_empty() || binding.target.trim().is_empty()
        {
            continue;
        }

        let section_name = format!("Binding_{binding_id}");
        let section = document.entry(section_name).or_default();
        section.insert(
            String::from("Shortcut"),
            binding.shortcut.trim().to_string(),
        );
        section.insert(
            String::from("ScriptPath"),
            binding.target.trim().to_string(),
        );
        if binding.program_tab_id.unwrap_or(0) > 0 {
            section.insert(
                String::from("ProgramTabId"),
                binding.program_tab_id.unwrap_or(0).to_string(),
            );
        }
    }

    write_bindings_file_state(&bindings_path, &document)?;
    let (next_bindings, _, _) = read_bindings_file_state()?;
    let reload_result = restart_flowcell_headless_backend();
    let mut message = if normalized_shortcut.is_empty() {
        String::from("Bind cleared.")
    } else {
        String::from("Bind saved.")
    };
    if let Err(error) = reload_result {
        message.push_str(" Backend reload failed.");
        eprintln!("{error}");
    }

    Ok(SaveBindShortcutResponse {
        message,
        bindings: next_bindings,
    })
}

#[tauri::command]
fn get_cursor_position() -> Result<CursorPositionRecord, String> {
    #[cfg(windows)]
    {
        let mut point = POINT { x: 0, y: 0 };
        let ok = unsafe { GetCursorPos(&mut point) };
        if ok == 0 {
            return Err("Current mouse position could not be read.".to_string());
        }
        return Ok(CursorPositionRecord {
            x: point.x,
            y: point.y,
        });
    }

    #[cfg(not(windows))]
    {
        Err("Current mouse position is only wired on Windows.".to_string())
    }
}

#[tauri::command]
fn list_frontend_macros() -> Result<Vec<FrontendMacroSummaryRecord>, String> {
    list_frontend_macro_summaries(None, None)
}

#[tauri::command]
fn list_frontend_panel_macros(
    program_name: String,
    panel_name: String,
) -> Result<Vec<FrontendMacroSummaryRecord>, String> {
    resolve_panel_directory(&program_name, &panel_name)?;
    list_frontend_macros_for_panel(program_name.trim(), panel_name.trim())
}

#[tauri::command]
fn load_frontend_macro(action_id: String) -> Result<FrontendMacroDocumentRecord, String> {
    let validated_action_id = validate_frontend_macro_id(&action_id)?;
    load_frontend_macro_document_with_bindings(&validated_action_id)
}

#[tauri::command]
fn load_frontend_macro_from_path(
    request: LoadFrontendMacroFromPathRequest,
) -> Result<FrontendMacroDocumentRecord, String> {
    load_frontend_macro_document_from_path(request)
}

#[tauri::command]
fn get_frontend_macro_directory() -> Result<String, String> {
    Ok(resolve_frontend_recorded_actions_directory()?
        .display()
        .to_string())
}

#[tauri::command]
fn save_frontend_macro(
    request: SaveFrontendMacroRequest,
) -> Result<FrontendMacroDocumentRecord, String> {
    let program_name = request.program_name.trim();
    let panel_name = request.panel_name.trim();
    let label = request.label.trim();
    if program_name.is_empty() || panel_name.is_empty() {
        return Err("Select a program and panel before saving a macro.".to_string());
    }
    if label.is_empty() {
        return Err("Macro name cannot be empty.".to_string());
    }
    if request.steps.is_empty() {
        return Err("Add at least one step before saving a macro.".to_string());
    }

    resolve_panel_directory(program_name, panel_name)?;

    let current_id = request.current_id.unwrap_or_default();
    let existing_definition = if current_id.trim().is_empty() {
        None
    } else {
        Some(load_frontend_macro_definition(&current_id)?)
    };
    let force_new_id = request.force_new_id.unwrap_or(false)
        || existing_definition.is_none() && current_id.trim().is_empty();
    let action_id = if force_new_id {
        build_frontend_macro_id(label)
    } else {
        validate_frontend_macro_id(if current_id.trim().is_empty() {
            existing_definition
                .as_ref()
                .map(|definition| definition.id.as_str())
                .unwrap_or_default()
        } else {
            current_id.trim()
        })?
    };
    let macro_path = resolve_frontend_macro_file_path(&action_id)?;

    write_frontend_macro_definition_file(
        &macro_path,
        &action_id,
        label,
        program_name,
        panel_name,
        if force_new_id {
            None
        } else {
            existing_definition
                .as_ref()
                .map(|definition| definition.created_at.as_str())
        },
        &request.steps,
    )?;
    load_frontend_macro_document_with_bindings(&action_id)
}

#[tauri::command]
fn add_frontend_macro_panel_button(
    program_name: String,
    panel_name: String,
    action_id: String,
) -> Result<FrontendMacroDocumentRecord, String> {
    let program_name = program_name.trim();
    let panel_name = panel_name.trim();
    if program_name.is_empty() || panel_name.is_empty() {
        return Err("Select a program and panel before adding a macro button.".to_string());
    }

    resolve_panel_directory(program_name, panel_name)?;
    let validated_action_id = validate_frontend_macro_id(&action_id)?;
    let definition = load_frontend_macro_definition(&validated_action_id)?;
    if definition.steps.is_empty() {
        return Err("Add at least one step before adding this macro to a panel.".to_string());
    }

    upsert_frontend_macro_panel_item(program_name, panel_name, &definition.id, &definition.label)?;
    load_frontend_macro_document_with_bindings(&definition.id)
}

#[tauri::command]
fn delete_frontend_macro(action_id: String) -> Result<Vec<FrontendMacroSummaryRecord>, String> {
    let validated_action_id = validate_frontend_macro_id(&action_id)?;
    let definition = load_frontend_macro_definition(&validated_action_id)?;
    let macro_path = resolve_frontend_macro_file_path(&validated_action_id)?;
    if macro_path.is_file() {
        recycle_file_path(&macro_path)?;
    }
    remove_all_frontend_macro_panel_items(&definition.id)?;
    remove_frontend_macro_hotkeys(&[validated_action_id])?;

    list_frontend_macros_for_panel(&definition.program_name, &definition.panel_name)
}

#[tauri::command]
fn run_frontend_macro(action_id: String) -> Result<String, String> {
    run_flowcell_macro_action(&action_id)
}

#[tauri::command]
fn record_frontend_macro(
    request: RecordFrontendMacroRequest,
) -> Result<FrontendMacroDocumentRecord, String> {
    let program_name = request.program_name.trim();
    let panel_name = request.panel_name.trim();
    let label = request.label.trim();
    if program_name.is_empty() || panel_name.is_empty() {
        return Err("Select a program and panel before recording a macro.".to_string());
    }
    if label.is_empty() {
        return Err("Macro name cannot be empty.".to_string());
    }

    resolve_panel_directory(program_name, panel_name)?;

    let existing_definition = if request
        .current_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        Some(load_frontend_macro_definition(
            request.current_id.as_deref().unwrap_or_default(),
        )?)
    } else {
        None
    };
    let action_id = existing_definition
        .as_ref()
        .map(|definition| definition.id.clone())
        .unwrap_or_else(|| build_frontend_macro_id(label));
    let macro_path = resolve_frontend_macro_file_path(&action_id)?;

    record_frontend_macro_to_path(&macro_path, &action_id, label)?;
    stamp_frontend_macro_metadata(
        &macro_path,
        &action_id,
        label,
        program_name,
        panel_name,
        existing_definition
            .as_ref()
            .map(|definition| definition.created_at.as_str()),
    )?;
    load_frontend_macro_document_with_bindings(&action_id)
}

#[tauri::command]
fn save_core_action_shortcut(
    request: SaveCoreActionShortcutRequest,
) -> Result<SaveBindShortcutResponse, String> {
    let action_id = request.action_id.trim();
    if !action_id.eq_ignore_ascii_case(ILLUSTRATOR_SET_ANCHOR_ACTION_ID) {
        return Err("Unsupported Core bind action.".to_string());
    }

    let (bindings, mut document, bindings_path) = read_bindings_file_state()?;
    let normalized_shortcut = request.shortcut.trim().to_ascii_lowercase();
    if !normalized_shortcut.is_empty() {
        if bindings.script_bindings.iter().any(|binding| {
            binding
                .shortcut
                .trim()
                .eq_ignore_ascii_case(&normalized_shortcut)
        }) {
            return Err("That shortcut is already in use.".to_string());
        }
        if bindings
            .action_hotkeys
            .iter()
            .any(|(existing_action_id, shortcut)| {
                !existing_action_id.eq_ignore_ascii_case(action_id)
                    && shortcut.trim().eq_ignore_ascii_case(&normalized_shortcut)
            })
        {
            return Err("That shortcut is already in use.".to_string());
        }
    }

    if normalized_shortcut.is_empty() {
        let mut remove_action_hotkeys_section = false;
        if let Some(section) = document.get_mut("ActionHotkeys") {
            section.remove(ILLUSTRATOR_SET_ANCHOR_ACTION_ID);
            remove_action_hotkeys_section = section.is_empty();
        }
        if remove_action_hotkeys_section {
            document.remove("ActionHotkeys");
        }
    } else {
        document
            .entry(String::from("ActionHotkeys"))
            .or_default()
            .insert(
                String::from(ILLUSTRATOR_SET_ANCHOR_ACTION_ID),
                request.shortcut.trim().to_string(),
            );
    }

    write_bindings_file_state(&bindings_path, &document)?;
    let (next_bindings, _, _) = read_bindings_file_state()?;
    let reload_result = restart_flowcell_headless_backend();
    let mut message = if normalized_shortcut.is_empty() {
        String::from("Set Anchor shortcut cleared.")
    } else {
        String::from("Set Anchor shortcut saved.")
    };
    if let Err(error) = reload_result {
        message.push_str(" Backend reload failed.");
        eprintln!("{error}");
    }

    Ok(SaveBindShortcutResponse {
        message,
        bindings: next_bindings,
    })
}

#[tauri::command]
fn save_macro_shortcut(
    request: SaveMacroShortcutRequest,
) -> Result<SaveMacroShortcutResponse, String> {
    let action_id = validate_frontend_macro_id(&request.action_id)?;
    load_frontend_macro_definition(&action_id)?;

    let (bindings, mut document, bindings_path) = read_bindings_file_state()?;
    let normalized_shortcut = request.shortcut.trim().to_ascii_lowercase();
    if !normalized_shortcut.is_empty() {
        if bindings.script_bindings.iter().any(|binding| {
            binding
                .shortcut
                .trim()
                .eq_ignore_ascii_case(&normalized_shortcut)
        }) {
            return Err("That shortcut is already in use.".to_string());
        }
        if bindings
            .action_hotkeys
            .iter()
            .any(|(existing_action_id, shortcut)| {
                !existing_action_id.eq_ignore_ascii_case(&action_id)
                    && shortcut.trim().eq_ignore_ascii_case(&normalized_shortcut)
            })
        {
            return Err("That shortcut is already in use.".to_string());
        }
    }

    if normalized_shortcut.is_empty() {
        let mut remove_action_hotkeys_section = false;
        if let Some(section) = document.get_mut("ActionHotkeys") {
            section.remove(&action_id);
            remove_action_hotkeys_section = section.is_empty();
        }
        if remove_action_hotkeys_section {
            document.remove("ActionHotkeys");
        }
    } else {
        document
            .entry(String::from("ActionHotkeys"))
            .or_default()
            .insert(action_id.clone(), request.shortcut.trim().to_string());
    }

    write_bindings_file_state(&bindings_path, &document)?;
    let (next_bindings, _, _) = read_bindings_file_state()?;
    let reload_result = restart_flowcell_headless_backend();
    let mut message = if normalized_shortcut.is_empty() {
        String::from("Macro shortcut cleared.")
    } else {
        String::from("Macro shortcut saved.")
    };
    if let Err(error) = reload_result {
        message.push_str(" Backend reload failed.");
        eprintln!("{error}");
    }

    Ok(SaveMacroShortcutResponse {
        message,
        bindings: next_bindings,
    })
}

#[tauri::command]
fn add_panel_scripts(
    program_name: String,
    panel_name: String,
) -> Result<Vec<PanelScriptFileRecord>, String> {
    let panel_directory = resolve_panel_directory(&program_name, &panel_name)?;
    if is_windows_program_name(&program_name) {
        let initial_directory =
            resolve_program_git_scripts_picker_directory(&program_name, &panel_name)
                .or_else(|_| resolve_windows_scripts_library_directory())
                .unwrap_or_else(|_| panel_directory.clone());
        let selected_paths = FileDialog::new()
            .set_title("Add Script")
            .set_directory(initial_directory)
            .add_filter("Windows Git Scripts", allowed_windows_script_extensions())
            .pick_files();

        if let Some(paths) = selected_paths {
            for source_path in paths {
                if !source_path.is_file() {
                    continue;
                }

                if !is_allowed_windows_script_path(&source_path) {
                    return Err(format!(
                        "Only Windows Add Script file types are supported right now. Rejected '{}'.",
                        source_path.display()
                    ));
                }

                let (_local_path, _panel_path) =
                    copy_script_into_panel_workflow(&program_name, &panel_directory, &source_path)?;
            }
        }

        return list_windows_panel_script_files(&panel_directory);
    }

    if is_adobe_program_name(&program_name) {
        return add_adobe_panel_scripts(&panel_directory, &program_name);
    }

    if is_blender_program_name(&program_name) {
        return add_blender_panel_scripts(&panel_directory, &panel_name);
    }

    let initial_directory =
        resolve_program_git_scripts_picker_directory(&program_name, &panel_name)
            .unwrap_or_else(|_| panel_directory.clone());
    let selected_paths = FileDialog::new()
        .set_title("Add Script")
        .set_directory(initial_directory)
        .add_filter("Program Scripts", allowed_generic_script_extensions())
        .pick_files();

    if let Some(paths) = selected_paths {
        for source_path in paths {
            if !source_path.is_file() {
                continue;
            }

            if !is_allowed_generic_script_path(&source_path) {
                return Err(format!(
                    "Only supported Add Script file types are supported right now. Rejected '{}'.",
                    source_path.display()
                ));
            }

            let (_local_path, _panel_path) =
                copy_script_into_panel_workflow(&program_name, &panel_directory, &source_path)?;
        }
    }

    list_generic_panel_script_files(&panel_directory)
}

fn update_simple_panel_script_description(
    panel_directory: &Path,
    file_name: &str,
    is_allowed_path: fn(&Path) -> bool,
    description: &str,
) -> Result<(), String> {
    let validated_file_name = validate_panel_script_file_name(file_name)?;
    let script_path = panel_directory.join(&validated_file_name);
    if !script_path.is_file() {
        return Err(format!(
            "Script file '{}' was not found in {}.",
            validated_file_name,
            panel_directory.display()
        ));
    }
    if validated_file_name
        .to_ascii_lowercase()
        .ends_with(BLENDER_PANEL_ITEM_SUFFIX)
    {
        let mut record = read_panel_item_file(&script_path)?;
        if !is_frontend_macro_panel_item(&record) {
            return Err(format!(
                "Panel item '{}' is not a supported macro button.",
                validated_file_name
            ));
        }
        record.tooltip = description.trim().to_string();
        write_panel_item_file(&script_path, &record)?;
        return Ok(());
    }
    if !is_allowed_path(&script_path) {
        return Err(format!(
            "Script '{}' does not use a supported Add Script file type.",
            validated_file_name
        ));
    }

    set_top_description(&script_path, description).map(|_| ())
}

fn update_blender_panel_script_description(
    panel_directory: &Path,
    file_name: &str,
    description: &str,
) -> Result<(), String> {
    let record_path = resolve_blender_panel_item_path(panel_directory, file_name)?;
    let mut record = read_normalized_panel_item_file(&record_path)?;
    record.tooltip = description.trim().to_string();
    write_panel_item_file(&record_path, &record)?;

    if is_frontend_macro_panel_item(&record) {
        return Ok(());
    }

    try_set_description_at_path(&record.source_path, description)?;
    try_set_description_at_path(&record.execution_target, description)?;

    Ok(())
}

#[tauri::command]
fn update_panel_script_description(
    program_name: String,
    panel_name: String,
    file_name: String,
    description: String,
) -> Result<Vec<PanelScriptFileRecord>, String> {
    let panel_directory = resolve_panel_directory(&program_name, &panel_name)?;
    let normalized_description = description.trim().to_string();

    if is_windows_program_name(&program_name) {
        update_simple_panel_script_description(
            &panel_directory,
            &file_name,
            is_allowed_windows_script_path,
            &normalized_description,
        )?;
        return list_windows_panel_script_files(&panel_directory);
    }

    if is_adobe_program_name(&program_name) {
        update_simple_panel_script_description(
            &panel_directory,
            &file_name,
            is_allowed_adobe_script_path,
            &normalized_description,
        )?;
        return list_adobe_panel_script_files(&panel_directory);
    }

    if is_blender_program_name(&program_name) {
        update_blender_panel_script_description(
            &panel_directory,
            &file_name,
            &normalized_description,
        )?;
        return list_blender_panel_script_files(&panel_directory);
    }

    update_simple_panel_script_description(
        &panel_directory,
        &file_name,
        is_allowed_generic_script_path,
        &normalized_description,
    )?;
    list_generic_panel_script_files(&panel_directory)
}

#[tauri::command]
fn delete_panel_scripts(
    program_name: String,
    panel_name: String,
    file_names: Vec<String>,
) -> Result<Vec<PanelScriptFileRecord>, String> {
    let panel_directory = resolve_panel_directory(&program_name, &panel_name)?;
    let mut unique_file_names = Vec::new();
    for file_name in file_names {
        let validated_file_name = validate_panel_script_file_name(&file_name)?;
        if unique_file_names
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(&validated_file_name))
        {
            continue;
        }
        unique_file_names.push(validated_file_name);
    }

    if unique_file_names.is_empty() {
        return list_panel_script_files(program_name, panel_name);
    }

    if is_windows_program_name(&program_name) {
        delete_windows_panel_scripts(&panel_directory, &unique_file_names)?;
        return list_windows_panel_script_files(&panel_directory);
    }

    if is_adobe_program_name(&program_name) {
        delete_simple_panel_scripts(
            &panel_directory,
            &unique_file_names,
            is_allowed_adobe_script_path,
            "Adobe",
        )?;
        return list_adobe_panel_script_files(&panel_directory);
    }

    if is_blender_program_name(&program_name) {
        delete_blender_panel_scripts(&panel_directory, &unique_file_names)?;
        return list_blender_panel_script_files(&panel_directory);
    }

    delete_simple_panel_scripts(
        &panel_directory,
        &unique_file_names,
        is_allowed_generic_script_path,
        "Program",
    )?;
    list_generic_panel_script_files(&panel_directory)
}

fn panel_script_message_response(message: String) -> Value {
    json!({ "message": message })
}

fn organization_setup_launcher_response() -> Value {
    json!({
        "message": "Setup Organization opens as a FlowCell managed window.",
        "requires_flowcell_organization_setup_open": true
    })
}

fn is_organization_setup_launcher(file_name: &str) -> bool {
    file_name
        .trim()
        .eq_ignore_ascii_case("setup_organization.ps1")
}

fn extract_panel_script_response_message(response: &Value) -> String {
    if let Some(message) = response.as_str().filter(|value| !value.trim().is_empty()) {
        return message.trim().to_string();
    }

    extract_blender_bridge_response_message(response)
}

fn run_panel_script_response_impl(
    app: &AppHandle,
    program_name: String,
    panel_name: String,
    file_name: String,
) -> Result<Value, String> {
    let panel_directory = resolve_panel_directory(&program_name, &panel_name)?;
    let validated_file_name = validate_panel_script_file_name(&file_name)?;
    let panel_item_path = panel_directory.join(&validated_file_name);
    if validated_file_name
        .to_ascii_lowercase()
        .ends_with(BLENDER_PANEL_ITEM_SUFFIX)
        && panel_item_path.is_file()
    {
        let record = read_panel_item_file(&panel_item_path)?;
        if is_frontend_macro_panel_item(&record) {
            let macro_id = validate_frontend_macro_id(&record.macro_id)?;
            return run_flowcell_macro_action(&macro_id).map(panel_script_message_response);
        }
    }

    if is_windows_program_name(&program_name) {
        if is_organization_setup_launcher(&validated_file_name) {
            return Ok(organization_setup_launcher_response());
        }

        if is_flowcell_window_toggle_launcher(&program_name, &panel_name, &validated_file_name) {
            return toggle_flowcell_windows_native(app).map(panel_script_message_response);
        }

        if is_codex_usage_launcher(&program_name, &panel_name, &validated_file_name) {
            return Ok(panel_script_message_response(
                "Codex Usage opens as a FlowCell managed popout.".to_string(),
            ));
        }

        let script_path =
            resolve_windows_panel_script_path(&program_name, &panel_name, &file_name)?;
        run_windows_panel_script_file(&script_path)?;
        return Ok(panel_script_message_response(format!(
            "Started {}.",
            file_name
        )));
    }

    if is_adobe_program_name(&program_name) {
        let script_path = panel_directory.join(&validated_file_name);
        if !script_path.is_file() {
            return Err(format!(
                "Script file '{}' was not found in {}.",
                validated_file_name,
                panel_directory.display()
            ));
        }
        if !is_allowed_adobe_script_path(&script_path) {
            return Err(format!(
                "Only Illustrator and Photoshop script files can be run from '{}'.",
                validated_file_name
            ));
        }

        if is_illustrator_program_name(&program_name) {
            return run_illustrator_backend_script_direct(&script_path, "illustrator_automation")
                .map(panel_script_message_response);
        }

        let program_key = "photoshop_direct";
        return run_flowcell_controller_script(&script_path, program_key)
            .map(panel_script_message_response);
    }

    if is_blender_program_name(&program_name) {
        let item = resolve_blender_panel_item_record(&program_name, &panel_name, &file_name)?;
        if is_blender_toolset_record(&item) {
            return Ok(panel_script_message_response(format!(
                "Loaded {}.",
                item.label
            )));
        }

        let bridge_action = item.bridge_action.trim().to_string();
        if bridge_action.is_empty() {
            return Err(format!(
                "Blender panel item '{}' is missing bridgeAction. Repair its panel metadata; Blender wrapper fallback is disabled.",
                item.label
            ));
        }

        let data = normalize_blender_bridge_data(item.bridge_data.clone());
        return match run_blender_bridge_action_direct(&bridge_action, data) {
            Ok(response) => Ok(response),
            Err(message) if should_return_blender_bridge_message_without_alert(&message) => {
                Ok(panel_script_message_response(message))
            }
            Err(message) => Err(message),
        };
    }

    let script_path = panel_directory.join(&validated_file_name);
    if !script_path.is_file() {
        return Err(format!(
            "Script file '{}' was not found in {}.",
            validated_file_name,
            panel_directory.display()
        ));
    }
    if !is_allowed_generic_script_path(&script_path) {
        return Err(format!(
            "Script '{}' does not use a supported Add Script file type.",
            validated_file_name
        ));
    }

    run_windows_panel_script_file(&script_path)?;
    Ok(panel_script_message_response(format!(
        "Started {}.",
        file_name
    )))
}

#[tauri::command]
fn run_panel_script_response(
    app: AppHandle,
    program_name: String,
    panel_name: String,
    file_name: String,
) -> Result<Value, String> {
    run_panel_script_response_impl(&app, program_name, panel_name, file_name)
}

#[tauri::command]
fn run_panel_script(
    app: AppHandle,
    program_name: String,
    panel_name: String,
    file_name: String,
) -> Result<String, String> {
    let response = run_panel_script_response_impl(&app, program_name, panel_name, file_name)?;
    Ok(extract_panel_script_response_message(&response))
}

#[tauri::command]
fn run_blender_rotate_tool(
    program_name: String,
    panel_name: String,
    file_name: String,
    axis: String,
    center_mode: String,
    operation_mode: String,
    angle_deg: f64,
    distribute_count: i64,
) -> Result<String, String> {
    let item = resolve_blender_panel_item_record(&program_name, &panel_name, &file_name)?;
    if !item.kind.eq_ignore_ascii_case(ROTATE_TOOL_KIND) {
        return Err(format!(
            "Panel item '{}' is not a rotate toolbox.",
            item.label
        ));
    }

    run_blender_rotate_tool_action(
        &item,
        axis.trim(),
        center_mode.trim(),
        operation_mode.trim(),
        angle_deg,
        distribute_count,
    )
}

#[tauri::command]
fn run_blender_alignment_tool(
    program_name: String,
    panel_name: String,
    file_name: String,
    command: String,
    axis: String,
    mode: String,
    modifier: String,
) -> Result<String, String> {
    let item = resolve_blender_panel_item_record(&program_name, &panel_name, &file_name)?;
    if !item.kind.eq_ignore_ascii_case(ALIGNMENT_TOOL_KIND) {
        return Err(format!(
            "Panel item '{}' is not an alignment toolbox.",
            item.label
        ));
    }

    run_blender_alignment_tool_action(
        &item,
        command.trim(),
        axis.trim(),
        mode.trim(),
        modifier.trim(),
    )
}

#[tauri::command]
fn run_illustrator_alignment_tool(
    program_name: String,
    panel_name: String,
    file_name: String,
    command: String,
    axis: String,
    mode: String,
    modifier: String,
    group_mode: bool,
) -> Result<String, String> {
    if !is_illustrator_program_name(&program_name) {
        return Err(format!(
            "Illustrator alignment tools are not wired for '{}'.",
            program_name
        ));
    }

    let panel_directory = resolve_panel_directory(&program_name, &panel_name)?;
    let validated_file_name = validate_panel_script_file_name(&file_name)?;
    let script_path = panel_directory.join(&validated_file_name);
    if !script_path.is_file() {
        return Err(format!(
            "Illustrator alignment toolbox '{}' was not found in {}.",
            validated_file_name,
            panel_directory.display()
        ));
    }

    let record = read_adobe_panel_script_record(&script_path, validated_file_name);
    if !record
        .kind
        .as_deref()
        .map(|kind| kind.eq_ignore_ascii_case(ILLUSTRATOR_ALIGNMENT_TOOL_KIND))
        .unwrap_or(false)
    {
        return Err(format!(
            "Panel item '{}' is not an Illustrator alignment toolbox.",
            record.label
        ));
    }

    run_illustrator_alignment_tool_action(
        command.trim(),
        axis.trim(),
        mode.trim(),
        modifier.trim(),
        group_mode,
    )
}

#[tauri::command]
fn run_blender_smart_axis_tool(
    program_name: String,
    panel_name: String,
    file_name: String,
    command: String,
) -> Result<serde_json::Value, String> {
    let item = resolve_blender_panel_item_record(&program_name, &panel_name, &file_name)?;
    if !item.kind.eq_ignore_ascii_case(SMART_AXIS_TOOL_KIND) {
        return Err(format!(
            "Panel item '{}' is not a Smart Axis toolbox.",
            item.label
        ));
    }

    run_blender_smart_axis_tool_action(&item, command.trim())
}

#[tauri::command]
fn run_blender_toolset_action(
    program_name: String,
    panel_name: String,
    file_name: String,
    command: String,
    payload: Option<Value>,
) -> Result<Value, String> {
    let item = resolve_blender_panel_item_record(&program_name, &panel_name, &file_name)?;
    if !is_blender_toolset_record(&item) {
        return Err(format!(
            "Panel item '{}' is not a recognized Blender tool set.",
            item.label
        ));
    }

    run_blender_generic_toolset_action(&item, command.trim(), payload)
}

#[tauri::command]
fn run_toolset_action(
    program_name: String,
    panel_name: String,
    file_name: String,
    command: String,
    payload: Option<Value>,
) -> Result<Value, String> {
    let normalized_command = command.trim().to_string();
    if normalized_command.is_empty() {
        return Err("Tool-set actions require a non-empty command.".to_string());
    }

    if is_blender_program_name(&program_name) {
        let item = resolve_blender_panel_item_record(&program_name, &panel_name, &file_name)?;
        if !is_blender_toolset_record(&item) {
            return Err(format!(
                "Panel item '{}' is not a recognized Blender tool set.",
                item.label
            ));
        }
        validate_toolset_child_slot(&item.children, &normalized_command, &item.label)?;
        return run_blender_toolset_action(
            program_name,
            panel_name,
            file_name,
            normalized_command,
            payload,
        );
    }

    if is_illustrator_program_name(&program_name) {
        return run_illustrator_toolset_action(
            &program_name,
            &panel_name,
            &file_name,
            &normalized_command,
            payload,
        );
    }

    Err(format!(
        "Toolset actions are not wired for '{}'.",
        program_name
    ))
}

fn resolve_organization_project_root(project_root: &str) -> Result<PathBuf, String> {
    let trimmed = project_root.trim().trim_matches('"');
    if trimmed.is_empty() {
        return Err("Choose a project root first.".to_string());
    }

    let root = PathBuf::from(trimmed);
    if !root.is_absolute() {
        return Err("Project root must be an absolute folder path.".to_string());
    }
    if !root.is_dir() {
        return Err(format!("Project folder does not exist: {}", root.display()));
    }

    Ok(root)
}

// The organization profile is a single visible file at the project root,
// alongside the organizer's other organize-folder.* sidecars. No hidden
// .flowcell folder is created.
fn organization_profile_path(project_root: &Path) -> PathBuf {
    project_root.join("organize-folder.profile.json")
}

// Older profiles lived in a .flowcell folder; read them as a fallback so
// existing setups keep working until the next save migrates them.
fn legacy_organization_profile_path(project_root: &Path) -> PathBuf {
    project_root
        .join(".flowcell")
        .join("organization-profile.json")
}

// Files the organizer manages itself — they must never be listed as loose
// files or organized into folders.
fn is_organization_sidecar_file(file_name: &str) -> bool {
    file_name.to_lowercase().starts_with("organize-folder.")
}

#[tauri::command]
fn scan_organization_project(project_root: String) -> Result<OrganizationProjectScan, String> {
    let root = resolve_organization_project_root(&project_root)?;
    let mut folders = vec![".".to_string()];
    let mut loose_files = Vec::new();
    let mut pending_directories = vec![root.clone()];

    while let Some(directory) = pending_directories.pop() {
        let mut entries = fs::read_dir(&directory)
            .map_err(|error| format!("Unable to scan {}: {error}", directory.display()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Unable to scan {}: {error}", directory.display()))?;
        entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());

        for entry in entries {
            let path = entry.path();
            let file_type = entry
                .file_type()
                .map_err(|error| format!("Unable to inspect {}: {error}", path.display()))?;

            if file_type.is_dir() && !file_type.is_symlink() {
                // Skip FlowCell's legacy metadata folder so it never shows in
                // the Project Tree.
                if directory == root && entry.file_name().to_string_lossy() == ".flowcell" {
                    continue;
                }
                let relative = path
                    .strip_prefix(&root)
                    .map_err(|error| {
                        format!("Unable to make {} relative: {error}", path.display())
                    })?
                    .to_string_lossy()
                    .replace('\\', "/");
                folders.push(relative);
                pending_directories.push(path);
                continue;
            }

            if directory == root && file_type.is_file() {
                let file_name = entry.file_name().to_string_lossy().to_string();
                if is_organization_sidecar_file(&file_name) {
                    continue;
                }
                let extension = path
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(|value| format!(".{}", value.to_lowercase()))
                    .unwrap_or_default();
                loose_files.push(OrganizationLooseFileInfo {
                    path: path.display().to_string(),
                    file_name,
                    extension,
                });
            }
        }
    }

    folders.sort_by_key(|folder| folder.to_lowercase());
    if let Some(root_index) = folders.iter().position(|folder| folder == ".") {
        folders.swap(0, root_index);
    }
    loose_files.sort_by_key(|file| file.file_name.to_lowercase());

    Ok(OrganizationProjectScan {
        project_root: root.display().to_string(),
        folders,
        loose_files,
    })
}

#[tauri::command]
fn read_organization_profile(project_root: String) -> Result<Option<Value>, String> {
    let root = resolve_organization_project_root(&project_root)?;
    let profile_path = if organization_profile_path(&root).is_file() {
        organization_profile_path(&root)
    } else if legacy_organization_profile_path(&root).is_file() {
        legacy_organization_profile_path(&root)
    } else {
        return Ok(None);
    };

    let contents = fs::read_to_string(&profile_path).map_err(|error| {
        format!(
            "Unable to read organization profile at {}: {error}",
            profile_path.display()
        )
    })?;
    // Strip a leading UTF-8 BOM — PowerShell's Set-Content -Encoding UTF8 writes
    // one, and serde_json otherwise fails with "expected value at line 1 column 1".
    let profile = serde_json::from_str::<Value>(contents.trim_start_matches('\u{feff}')).map_err(
        |error| {
            format!(
                "Organization profile at {} is not valid JSON: {error}",
                profile_path.display()
            )
        },
    )?;

    if !profile.is_object() {
        return Err(format!(
            "Organization profile at {} must contain a JSON object.",
            profile_path.display()
        ));
    }

    Ok(Some(profile))
}

#[tauri::command]
fn write_organization_profile(project_root: String, mut profile: Value) -> Result<String, String> {
    let root = resolve_organization_project_root(&project_root)?;
    let profile_object = profile
        .as_object_mut()
        .ok_or_else(|| "Organization profile must be a JSON object.".to_string())?;

    if profile_object.get("profileVersion").and_then(Value::as_u64) != Some(1) {
        return Err("Organization profileVersion must be 1.".to_string());
    }
    if !profile_object.get("roles").is_some_and(Value::is_array) {
        return Err("Organization profile roles must be an array.".to_string());
    }
    if !profile_object
        .get("programFolders")
        .is_some_and(Value::is_array)
    {
        return Err("Organization profile programFolders must be an array.".to_string());
    }

    profile_object.insert(
        "projectRoot".to_string(),
        Value::String(root.display().to_string()),
    );

    let profile_path = organization_profile_path(&root);
    let profile_folder = profile_path
        .parent()
        .ok_or_else(|| "Unable to resolve the organization profile folder.".to_string())?;
    fs::create_dir_all(profile_folder).map_err(|error| {
        format!(
            "Unable to create organization profile folder at {}: {error}",
            profile_folder.display()
        )
    })?;
    let serialized = format!(
        "{}\n",
        serde_json::to_string_pretty(&profile)
            .map_err(|error| format!("Unable to serialize organization profile: {error}"))?
    );
    fs::write(&profile_path, serialized).map_err(|error| {
        format!(
            "Unable to write organization profile at {}: {error}",
            profile_path.display()
        )
    })?;

    Ok(profile_path.display().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OrganizationProfileSummary {
    name: String,
    path: String,
}

// The empty folder skeletons (folder structure only) live here.
fn resolve_folder_trees_root() -> Result<PathBuf, String> {
    Ok(resolve_flowcell_local_root()?.join("Folder Trees"))
}

// The profile data (roles, file-type assignments, etc.) lives here, kept
// separate from the folder structure on purpose.
fn resolve_folder_tree_profiles_root() -> Result<PathBuf, String> {
    Ok(resolve_flowcell_local_root()?.join("Folder Tree Profiles"))
}

fn folder_tree_profile_path(name: &str) -> Result<PathBuf, String> {
    Ok(resolve_folder_tree_profiles_root()?.join(format!("{name}.json")))
}

// Create the empty folder skeleton from an explicit list of relative folder
// paths (the project's actual folder structure). Nothing else is created here —
// no .flowcell folder, no per-role folders.
fn materialize_folder_tree(target: &Path, folders: &[String]) -> Result<(), String> {
    for folder in folders {
        let normalized = folder.replace('\\', "/");
        let mut directory = target.to_path_buf();
        let mut has_component = false;
        let mut first = true;
        let mut skip = false;
        for component in normalized.split('/') {
            let part = component.trim();
            if part.is_empty() || part == "." {
                continue;
            }
            if part == ".." {
                return Err(format!("Folder path is not allowed: {folder}"));
            }
            // Never recreate FlowCell's own metadata folder in the skeleton.
            if first && part.eq_ignore_ascii_case(".flowcell") {
                skip = true;
                break;
            }
            first = false;
            directory.push(part);
            has_component = true;
        }
        if skip || !has_component {
            continue;
        }
        fs::create_dir_all(&directory).map_err(|error| {
            format!(
                "Unable to create folder at {}: {error}",
                directory.display()
            )
        })?;
    }
    Ok(())
}

// Every subdirectory under `base`, as relative forward-slash paths.
fn list_relative_subdirectories(base: &Path) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut pending = vec![base.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries {
            let entry =
                entry.map_err(|error| format!("Failed to read {}: {error}", dir.display()))?;
            let file_type = entry.file_type().map_err(|error| {
                format!("Failed to inspect {}: {error}", entry.path().display())
            })?;
            if file_type.is_dir() && !file_type.is_symlink() {
                let path = entry.path();
                if let Ok(relative) = path.strip_prefix(base) {
                    let relative = relative.to_string_lossy().replace('\\', "/");
                    if !relative.is_empty() {
                        out.push(relative);
                    }
                }
                pending.push(path);
            }
        }
    }
    Ok(out)
}

#[tauri::command]
fn list_organization_profiles() -> Result<Vec<OrganizationProfileSummary>, String> {
    let profiles_root = resolve_folder_tree_profiles_root()?;
    if !profiles_root.is_dir() {
        return Ok(Vec::new());
    }

    let trees_root = resolve_folder_trees_root()?;
    let mut summaries = Vec::new();
    let entries = fs::read_dir(&profiles_root)
        .map_err(|error| format!("Failed to read {}: {error}", profiles_root.display()))?;
    for entry in entries {
        let entry = entry
            .map_err(|error| format!("Failed to read {}: {error}", profiles_root.display()))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Some(name) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        summaries.push(OrganizationProfileSummary {
            name: name.to_string(),
            path: trees_root.join(name).display().to_string(),
        });
    }
    summaries.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(summaries)
}

#[tauri::command]
fn read_organization_profile_named(name: String) -> Result<Option<Value>, String> {
    let safe_name = validate_folder_name(&name, "Profile")?;
    let profile_path = folder_tree_profile_path(&safe_name)?;
    if !profile_path.is_file() {
        return Ok(None);
    }

    let contents = fs::read_to_string(&profile_path).map_err(|error| {
        format!(
            "Unable to read profile at {}: {error}",
            profile_path.display()
        )
    })?;
    // Strip a leading UTF-8 BOM — PowerShell's Set-Content -Encoding UTF8 writes
    // one, and serde_json otherwise fails with "expected value at line 1 column 1".
    let profile = serde_json::from_str::<Value>(contents.trim_start_matches('\u{feff}')).map_err(
        |error| {
            format!(
                "Profile at {} is not valid JSON: {error}",
                profile_path.display()
            )
        },
    )?;
    if !profile.is_object() {
        return Err(format!(
            "Profile at {} must contain a JSON object.",
            profile_path.display()
        ));
    }
    Ok(Some(profile))
}

#[tauri::command]
fn save_organization_profile_as(
    name: String,
    mut profile: Value,
    folders: Vec<String>,
) -> Result<String, String> {
    let safe_name = validate_folder_name(&name, "Profile")?;

    // 1. Build the clean, empty folder skeleton from the project's folders.
    let trees_root = resolve_folder_trees_root()?;
    fs::create_dir_all(&trees_root).map_err(|error| {
        format!(
            "Unable to create Folder Trees folder at {}: {error}",
            trees_root.display()
        )
    })?;
    let tree_dir = trees_root.join(&safe_name);
    // Reset the skeleton so re-saving never leaves stale folders. Per AGENTS.md
    // the old copy goes to the Recycle Bin (recoverable), never a permanent delete.
    if tree_dir.is_dir() {
        recycle_directory_path(&tree_dir)?;
    }
    fs::create_dir_all(&tree_dir).map_err(|error| {
        format!(
            "Unable to create folder tree at {}: {error}",
            tree_dir.display()
        )
    })?;
    materialize_folder_tree(&tree_dir, &folders)?;

    // 2. Save the profile data separately, pointing its project root at the
    //    skeleton so loading scans the empty tree.
    let profiles_root = resolve_folder_tree_profiles_root()?;
    fs::create_dir_all(&profiles_root).map_err(|error| {
        format!(
            "Unable to create Folder Tree Profiles folder at {}: {error}",
            profiles_root.display()
        )
    })?;

    let profile_object = profile
        .as_object_mut()
        .ok_or_else(|| "Organization profile must be a JSON object.".to_string())?;
    if profile_object.get("profileVersion").and_then(Value::as_u64) != Some(1) {
        return Err("Organization profileVersion must be 1.".to_string());
    }
    if !profile_object.get("roles").is_some_and(Value::is_array) {
        return Err("Organization profile roles must be an array.".to_string());
    }
    if !profile_object
        .get("programFolders")
        .is_some_and(Value::is_array)
    {
        return Err("Organization profile programFolders must be an array.".to_string());
    }
    profile_object.insert(
        "projectRoot".to_string(),
        Value::String(tree_dir.display().to_string()),
    );

    let profile_path = folder_tree_profile_path(&safe_name)?;
    let serialized = format!(
        "{}\n",
        serde_json::to_string_pretty(&profile)
            .map_err(|error| format!("Unable to serialize profile: {error}"))?
    );
    fs::write(&profile_path, serialized).map_err(|error| {
        format!(
            "Unable to write profile at {}: {error}",
            profile_path.display()
        )
    })?;

    Ok(tree_dir.display().to_string())
}

// Apply a saved profile to an arbitrary, existing project root: recreate its
// skeleton, write organize-folder.profile.json, then run the profile's
// conditional program-folder organization rules.
#[tauri::command]
fn apply_organization_profile_to_root(
    name: String,
    project_root: String,
) -> Result<String, String> {
    let safe_name = validate_folder_name(&name, "Profile")?;
    let root = resolve_organization_project_root(&project_root)?;

    if !folder_tree_profile_path(&safe_name)?.is_file() {
        return Err(format!("Profile \"{safe_name}\" was not found."));
    }

    let repo_root = resolve_repo_root()
        .ok_or_else(|| "FlowCell repo root could not be resolved.".to_string())?;
    let core_path = repo_root
        .join("Programs")
        .join("Windows")
        .join("SupportScripts")
        .join("Apply-OrganizationProfileCore.ps1");
    if !core_path.is_file() {
        return Err(format!(
            "Apply Organization Profile core was not found: {}",
            core_path.display()
        ));
    }

    let arguments = vec![
        "-File".to_string(),
        core_path.display().to_string(),
        "-ProfileName".to_string(),
        safe_name,
        "-ProjectPath".to_string(),
        root.display().to_string(),
        "-PassThruJson".to_string(),
    ];
    let output = spawn_powershell_output(&arguments)?;
    if !output.status.success() {
        return Err(format_process_failure(
            &output,
            "Failed to apply the organization profile.",
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let result = serde_json::from_str::<Value>(&stdout)
        .map_err(|error| format!("Apply Organization Profile returned invalid JSON: {error}"))?;
    result
        .get("profilePath")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Apply Organization Profile did not return profilePath.".to_string())
}

// Build a saved profile's folder structure inside any existing folder (no
// profile file is written). Used to apply a profile to a selected subfolder.
#[tauri::command]
fn apply_organization_profile_folders(name: String, target_path: String) -> Result<String, String> {
    let safe_name = validate_folder_name(&name, "Profile")?;
    let target = resolve_organization_project_root(&target_path)?;
    let skeleton = resolve_folder_trees_root()?.join(&safe_name);
    if skeleton.is_dir() {
        let folders = list_relative_subdirectories(&skeleton)?;
        materialize_folder_tree(&target, &folders)?;
    }
    Ok(target.display().to_string())
}

// Generate a Windows Git Script that applies a saved profile to whatever folder
// path is on the clipboard, so it can be added as a panel button via Add Script.
#[tauri::command]
fn make_organization_profile_script(name: String) -> Result<String, String> {
    let safe_name = validate_folder_name(&name, "Profile")?;

    if !folder_tree_profile_path(&safe_name)?.is_file() {
        return Err(format!(
            "Save the profile \"{safe_name}\" first, then Make Script."
        ));
    }

    let scripts_dir = resolve_program_git_scripts_directory("Windows")?.join("Files");
    fs::create_dir_all(&scripts_dir).map_err(|error| {
        format!(
            "Unable to create scripts folder at {}: {error}",
            scripts_dir.display()
        )
    })?;

    let slug = {
        let raw: String = safe_name
            .to_lowercase()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .collect();
        let trimmed = raw.trim_matches('_').to_string();
        if trimmed.is_empty() {
            "profile".to_string()
        } else {
            trimmed
        }
    };
    let script_path = scripts_dir.join(format!("apply_profile_{slug}.ps1"));

    let escaped_name = safe_name.replace('\'', "''");
    let template = r##"# Description: Apply "__DESC_NAME__" profile to the clipboard folder.
param([string]$ProjectPath = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProfileName = '__PROFILE_NAME_ESCAPED__'

function Find-FlowCellRoot([string]$StartPath) {
    $current = [System.IO.Path]::GetFullPath($StartPath)
    while (-not [string]::IsNullOrWhiteSpace($current) -and (Test-Path -LiteralPath $current -PathType Container)) {
        if ((Test-Path -LiteralPath (Join-Path $current 'PROGRAM_SUMMARY.txt') -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $current 'FlowCell') -PathType Container)) { return $current }
        $parent = Split-Path -Parent $current
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current) { break }
        $current = $parent
    }
    throw 'Could not locate the FlowCell repository root from this script location.'
}

function Get-ClipboardProjectPath {
    try { $text = Get-Clipboard -Raw -ErrorAction Stop } catch { return '' }
    $candidate = ([string]$text).Trim().Trim('"')
    if ([string]::IsNullOrWhiteSpace($candidate)) { return '' }
    if (Test-Path -LiteralPath $candidate -PathType Container) { return (Get-Item -LiteralPath $candidate).FullName }
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return (Split-Path -Parent (Get-Item -LiteralPath $candidate).FullName) }
    return ''
}

function Write-FlowCellStatus([string]$Message) {
    try {
        $repo = Find-FlowCellRoot -StartPath $PSScriptRoot
        $statusPath = Join-Path $repo 'FlowCell\local\logs\last_action_status.txt'
        New-Item -ItemType Directory -Path (Split-Path -Parent $statusPath) -Force | Out-Null
        Set-Content -LiteralPath $statusPath -Value $Message -Encoding UTF8
    } catch { }
}

try {
    $repo = Find-FlowCellRoot -StartPath $PSScriptRoot
    $core = Join-Path $repo 'Programs\Windows\SupportScripts\Apply-OrganizationProfileCore.ps1'
    if (-not (Test-Path -LiteralPath $core -PathType Leaf)) { throw "Apply profile core not found: $core" }
    if ([string]::IsNullOrWhiteSpace($ProjectPath)) { $ProjectPath = Get-ClipboardProjectPath }
    if ([string]::IsNullOrWhiteSpace($ProjectPath)) { throw 'Copy a destination folder path to the clipboard first, then run this.' }

    $json = & $core -ProfileName $ProfileName -ProjectPath $ProjectPath -PassThruJson
    $result = $json | ConvertFrom-Json
    $message = @(
        "Applied profile: $ProfileName",
        "Target: $($result.projectRoot)",
        "Folders ensured: $($result.foldersCreated)",
        "Program folders created: $(@($result.programFoldersCreated).Count)",
        "Program folders reused: $(@($result.programFoldersUsed).Count)",
        "Files moved: $($result.filesMoved)",
        "Snapshots created: $($result.snapshotsCreated)",
        "Conflicts: $(@($result.conflicts).Count)"
    ) -join [Environment]::NewLine
    Write-FlowCellStatus $message
    $message
    exit 0
}
catch {
    Write-FlowCellStatus $_.Exception.Message
    Write-Error $_.Exception.Message
    exit 1
}
"##;

    let script = template
        .replace("__DESC_NAME__", &safe_name)
        .replace("__PROFILE_NAME_ESCAPED__", &escaped_name);

    fs::write(&script_path, script).map_err(|error| {
        format!(
            "Unable to write script at {}: {error}",
            script_path.display()
        )
    })?;

    Ok(script_path.display().to_string())
}

// Create (or refresh) a button in the Windows "Files" panel that applies a saved
// profile to a clipboard folder. Reuses the apply-profile script generator, then
// drops the script straight into the panel directory named after the profile, so
// the panel button is labeled with the profile name without a manual Add Script.
#[tauri::command]
fn make_organization_profile_button(name: String) -> Result<String, String> {
    let safe_name = validate_folder_name(&name, "Profile")?;

    let file_name = format!("{safe_name}.ps1");
    if file_name.eq_ignore_ascii_case("setup_organization.ps1") {
        return Err(
            "Choose a different profile name — \"setup_organization\" is reserved for the Setup Organization launcher button."
                .to_string(),
        );
    }

    let panel_directory = resolve_panel_directory("Windows", "Files")?;
    let button_path = panel_directory.join(&file_name);

    // Generating the script also validates that the profile has been saved.
    let library_path = PathBuf::from(make_organization_profile_script(safe_name)?);

    fs::copy(&library_path, &button_path).map_err(|error| {
        format!(
            "Unable to add the panel button at {}: {error}",
            button_path.display()
        )
    })?;

    Ok(button_path.display().to_string())
}

// Resolve a relative folder path under a project root, rejecting traversal and
// the root itself.
fn resolve_organization_subfolder(project_root: &Path, relative: &str) -> Result<PathBuf, String> {
    let normalized = relative.replace('\\', "/");
    let mut directory = project_root.to_path_buf();
    let mut has_component = false;
    for component in normalized.split('/') {
        let part = component.trim();
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err(format!("Folder path is not allowed: {relative}"));
        }
        directory.push(part);
        has_component = true;
    }
    if !has_component {
        return Err("Choose a folder other than the project root.".to_string());
    }
    Ok(directory)
}

#[tauri::command]
fn create_organization_folder(
    project_root: String,
    relative_path: String,
) -> Result<String, String> {
    let root = resolve_organization_project_root(&project_root)?;
    let directory = resolve_organization_subfolder(&root, &relative_path)?;
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Unable to create folder at {}: {error}",
            directory.display()
        )
    })?;
    Ok(directory.display().to_string())
}

// Delete a folder under the project root by sending it to the Recycle Bin.
#[tauri::command]
fn recycle_organization_folder(project_root: String, relative_path: String) -> Result<(), String> {
    let root = resolve_organization_project_root(&project_root)?;
    let directory = resolve_organization_subfolder(&root, &relative_path)?;
    if directory.is_dir() {
        recycle_directory_path(&directory)?;
    }
    Ok(())
}

// Best-effort restore of a folder from the Recycle Bin back to its original
// location, by absolute path. Used to undo a delete.
#[tauri::command]
fn restore_recycled_folder(path: String) -> Result<(), String> {
    let full = PathBuf::from(path.trim());
    if full.is_dir() {
        return Ok(());
    }
    let parent = full
        .parent()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    let name = full
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    if parent.is_empty() || name.is_empty() {
        return Err("Invalid path to restore.".to_string());
    }

    let command = format!(
        concat!(
            "$ErrorActionPreference='Stop'; ",
            "$parent='{parent}'; $name='{name}'; $done=$false; ",
            "$shell=New-Object -ComObject Shell.Application; ",
            "$bin=$shell.Namespace(0xA); ",
            "foreach($item in @($bin.Items())){{ ",
            "if($item.Name -ne $name){{continue}}; ",
            "$orig=[string]$bin.GetDetailsOf($item,1); ",
            "if(-not ($orig -ieq $parent)){{continue}}; ",
            "foreach($verb in @($item.Verbs())){{ ",
            "if(($verb.Name -replace '&','') -match 'Restore'){{ $verb.DoIt(); $done=$true; break }} }}; ",
            "if($done){{break}} }}; ",
            "if(-not $done){{ throw 'The folder was not found in the Recycle Bin.' }}"
        ),
        parent = escape_powershell_single_quoted(&parent),
        name = escape_powershell_single_quoted(&name),
    );
    let output = spawn_powershell_output(&["-Command".to_string(), command])?;
    if !output.status.success() {
        return Err(format_process_failure(
            &output,
            "Could not restore the folder from the Recycle Bin.",
        ));
    }
    Ok(())
}

#[tauri::command]
fn write_panel_fan_debug_dump(file_name: String, contents: String) -> Result<String, String> {
    let safe_file_name = validate_debug_file_name(&file_name)?;
    let debug_root = resolve_flowcell_local_debug_root()?;
    fs::create_dir_all(&debug_root).map_err(|error| {
        format!(
            "Failed to create panel fan debug folder at {}: {error}",
            debug_root.display()
        )
    })?;

    let debug_file_path = debug_root.join(safe_file_name);
    fs::write(&debug_file_path, contents).map_err(|error| {
        format!(
            "Failed to write panel fan debug dump at {}: {error}",
            debug_file_path.display()
        )
    })?;

    Ok(debug_file_path.display().to_string())
}

#[cfg(windows)]
fn start_scoped_topmost_worker(app: AppHandle, registry: ScopedTopmostRegistry) {
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

fn main() {
    tauri::Builder::default()
        .manage(ScopedTopmostRegistry::default())
        .invoke_handler(tauri::generate_handler![
            set_host_window_bounds,
            set_host_window_topmost,
            register_scoped_window_topmost,
            refresh_scoped_window_topmost,
            unregister_scoped_window_topmost,
            refresh_frontend_host,
            get_foreground_process_info,
            show_save_layout_dialog,
            show_open_layout_dialog,
            show_open_file_dialog,
            show_open_folder_dialog,
            show_save_file_dialog,
            show_text_input_dialog,
            show_slicer_choice_dialog,
            sample_photo_theme_colors,
            load_blender_theme_darkness_profiles,
            save_blender_theme_darkness_profiles,
            save_blender_theme_file,
            load_blender_theme_file,
            list_detected_slicer_executables,
            load_slicer_executable,
            launch_slicer,
            load_orca_slicer_executable,
            launch_orca_slicer,
            save_layout_snapshot,
            load_layout_snapshot,
            list_program_folders,
            list_panel_folders,
            create_program_folder,
            rename_program_folder,
            delete_program_folder,
            create_panel_folder,
            rename_panel_folder,
            delete_panel_folder,
            list_panel_script_files,
            run_illustrator_layers_action,
            set_illustrator_layers_highlight,
            load_binds_workspace,
            save_bind_shortcut,
            get_cursor_position,
            list_frontend_macros,
            list_frontend_panel_macros,
            load_frontend_macro,
            load_frontend_macro_from_path,
            get_frontend_macro_directory,
            save_frontend_macro,
            add_frontend_macro_panel_button,
            delete_frontend_macro,
            run_frontend_macro,
            record_frontend_macro,
            save_core_action_shortcut,
            save_macro_shortcut,
            get_codex_usage_snapshot,
            add_panel_scripts,
            update_panel_script_description,
            delete_panel_scripts,
            run_panel_script_response,
            run_panel_script,
            run_blender_rotate_tool,
            run_blender_alignment_tool,
            run_illustrator_alignment_tool,
            run_blender_smart_axis_tool,
            run_blender_toolset_action,
            run_toolset_action,
            scan_organization_project,
            read_organization_profile,
            write_organization_profile,
            list_organization_profiles,
            read_organization_profile_named,
            save_organization_profile_as,
            apply_organization_profile_to_root,
            apply_organization_profile_folders,
            make_organization_profile_script,
            make_organization_profile_button,
            create_organization_folder,
            recycle_organization_folder,
            restore_recycled_folder,
            write_panel_fan_debug_dump
        ])
        .setup(|app| {
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                apply_square_corner_preference(&window);
            }

            #[cfg(windows)]
            {
                let registry = app.state::<ScopedTopmostRegistry>().inner().clone();
                start_scoped_topmost_worker(app.handle().clone(), registry);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run FlowCell");
}
