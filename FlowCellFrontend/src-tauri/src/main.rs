#![cfg_attr(windows, windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::utils::config::WindowConfig;
use tauri::{AppHandle, Manager, State, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use windows_sys::Win32::Foundation::CloseHandle;
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, CREATE_NO_WINDOW, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

#[derive(Clone)]
struct AppPaths {
    repo_root: PathBuf,
    flowcell_root: PathBuf,
    local_root: PathBuf,
    logs_root: PathBuf,
    frontend_log_path: PathBuf,
}

#[derive(Default)]
struct RuntimeState {
    paths: Mutex<Option<AppPaths>>,
    window_contexts: Mutex<HashMap<String, WindowContext>>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    repo_root: String,
    flow_cell_root: String,
    state_path: String,
    frontend_log_path: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct ForegroundProcessInfo {
    process_name: String,
    process_path: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct LoadStateResponse {
    state: Value,
    runtime: RuntimeInfo,
    bindings: FlowCellBindingsState,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct FlowCellScriptBinding {
    id: i64,
    shortcut: String,
    target: String,
    status: String,
    program_tab_id: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct FlowCellBindingsState {
    next_id: i64,
    script_bindings: Vec<FlowCellScriptBinding>,
    action_hotkeys: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct ButtonBindingMutationRequest {
    kind: String,
    program_tab_id: i64,
    target: String,
    shortcut: Option<String>,
    binding_id: Option<i64>,
    label: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct BindingMutationResult {
    message: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct WindowContext {
    kind: String,
    program_id: Option<i64>,
    panel_id: Option<String>,
    panel_name: Option<String>,
    owner_button_id: Option<String>,
    button_ids: Option<Vec<String>>,
    layout_mode: Option<String>,
    button_label: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct FlowCellBounds {
    #[serde(rename = "Left")]
    left: f64,
    #[serde(rename = "Top")]
    top: f64,
    #[serde(rename = "Width")]
    width: f64,
    #[serde(rename = "Height")]
    height: f64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct FlowCellCommandEnvelope {
    command_id: String,
    program_id: i64,
    panel_id: String,
    button_id: String,
    owner_button_id: Option<String>,
    child_slot_id: Option<String>,
    tool_action: Option<String>,
    #[serde(default)]
    payload: Value,
    source_surface: Option<String>,
    request_id: Option<String>,
    timestamp: String,
    style_group_id: Option<String>,
    tool_option_state: Option<Value>,
    #[serde(default)]
    program: Value,
}

#[derive(Serialize, Deserialize, Clone)]
struct GatewayCommandResult {
    ok: bool,
    request_id: String,
    status: String,
    message: String,
    details: Value,
    logs: Vec<String>,
    exit_code: i32,
    duration_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct SavedLayoutFile {
    name: String,
    display_name: String,
    path: String,
    details: String,
    saved_at: Option<String>,
    modified_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct RecordedMacroChoice {
    id: String,
    label: String,
    path: String,
    created_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct RecordedMacroStep {
    section: Option<String>,
    #[serde(rename = "type")]
    step_type: String,
    delay_ms: i64,
    x: Option<String>,
    y: Option<String>,
    button: Option<String>,
    count: Option<String>,
    direction: Option<String>,
    text: Option<String>,
    keys: Option<String>,
    script_path: Option<String>,
    macro_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct RecordedMacroDefinition {
    path: String,
    file_name: String,
    id: String,
    label: String,
    created_at: Option<String>,
    steps: Vec<RecordedMacroStep>,
}

#[derive(Clone, Default)]
struct ScriptBindingEntry {
    id: i64,
    shortcut: String,
    target: String,
    program_tab_id: i64,
}

#[derive(Clone, Default)]
struct RawIniSection {
    name: String,
    entries: Vec<(String, String)>,
}

#[derive(Clone, Default)]
struct BindingsConfig {
    next_id: i64,
    program_tab_next_id: i64,
    selected_program_tab_id: i64,
    program_tab_ids: Vec<i64>,
    program_tabs: Vec<(i64, Vec<(String, String)>)>,
    script_bindings: Vec<ScriptBindingEntry>,
    action_hotkeys: BTreeMap<String, String>,
    macro_editor_columns: Vec<(String, String)>,
    other_sections: Vec<RawIniSection>,
}

fn ensure_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| error.to_string())
}

fn locate_repo_root() -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir);
    }

    if let Ok(executable_path) = std::env::current_exe() {
        if let Some(parent) = executable_path.parent() {
            candidates.push(parent.to_path_buf());
        }
    }

    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        candidates.push(PathBuf::from(manifest_dir));
    }

    for candidate in candidates {
        for parent in candidate.ancestors() {
            let repo_marker = parent.join("PROGRAM_SUMMARY.txt");
            let backend_marker = parent.join("FlowCell").join("FlowCellCommandBackend.ps1");
            if repo_marker.exists() && backend_marker.exists() {
                return Ok(parent.to_path_buf());
            }
        }
    }

    Err("Unable to locate the FlowCell repository root.".to_string())
}

fn build_paths() -> Result<AppPaths, String> {
    let repo_root = locate_repo_root()?;
    let flowcell_root = repo_root.join("FlowCell");
    let local_root = flowcell_root.join("local");
    let logs_root = local_root.join("logs");
    ensure_directory(&logs_root)?;

    Ok(AppPaths {
        repo_root,
        flowcell_root,
        local_root,
        logs_root: logs_root.clone(),
        frontend_log_path: logs_root.join("frontend-tauri.log"),
    })
}

fn with_paths(state: &RuntimeState) -> Result<AppPaths, String> {
    state
        .paths
        .lock()
        .map_err(|_| "Runtime path lock failed.".to_string())?
        .clone()
        .ok_or_else(|| "Runtime paths are not initialized.".to_string())
}

fn write_frontend_log(paths: &AppPaths, message: &str) -> Result<(), String> {
    ensure_directory(&paths.logs_root)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let mut handle = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.frontend_log_path)
        .map_err(|error| error.to_string())?;
    writeln!(handle, "[{}] {}", timestamp, message).map_err(|error| error.to_string())
}

fn state_path(paths: &AppPaths) -> PathBuf {
    paths.local_root.join("flowcell_state.json")
}

fn layouts_root(paths: &AppPaths) -> PathBuf {
    paths.local_root.join("layouts")
}

fn recorded_actions_root(paths: &AppPaths) -> PathBuf {
    paths.local_root.join("recorded_actions")
}

fn bindings_path(paths: &AppPaths) -> PathBuf {
    paths.local_root.join("bindings.ini")
}

fn decode_utf16_le(bytes: &[u8]) -> String {
    let values = bytes
        .chunks(2)
        .filter(|chunk| chunk.len() == 2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect::<Vec<_>>();
    String::from_utf16_lossy(&values)
}

fn decode_utf16_be(bytes: &[u8]) -> String {
    let values = bytes
        .chunks(2)
        .filter(|chunk| chunk.len() == 2)
        .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
        .collect::<Vec<_>>();
    String::from_utf16_lossy(&values)
}

fn read_text_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Ok(decode_utf16_le(&bytes[2..]));
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Ok(decode_utf16_be(&bytes[2..]));
    }
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Ok(String::from_utf8_lossy(&bytes[3..]).to_string());
    }
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

fn write_utf16le_text(path: &Path, text: &str) -> Result<(), String> {
    let mut bytes = vec![0xFF, 0xFE];
    text.encode_utf16()
        .for_each(|unit| bytes.extend_from_slice(&unit.to_le_bytes()));
    fs::write(path, bytes).map_err(|error| error.to_string())
}

fn default_macro_editor_columns() -> Vec<(String, String)> {
    vec![
        ("Number".to_string(), "44".to_string()),
        ("Type".to_string(), "130".to_string()),
        ("Delay".to_string(), "84".to_string()),
        ("X".to_string(), "84".to_string()),
        ("Y".to_string(), "84".to_string()),
        ("Button".to_string(), "94".to_string()),
        ("Count".to_string(), "78".to_string()),
        ("Direction".to_string(), "104".to_string()),
        ("Text".to_string(), "260".to_string()),
        ("Keys".to_string(), "230".to_string()),
        ("Script".to_string(), "320".to_string()),
    ]
}

fn canonicalize_shortcut(value: &str) -> String {
    let compact = value.split_whitespace().collect::<String>();
    if compact.is_empty() {
        return String::new();
    }

    compact
        .replace("<^>!", "__FLOWCELL_ALTGR__")
        .replace("<^", "^")
        .replace(">^", "^")
        .replace("<!", "!")
        .replace(">!", "!")
        .replace("<+", "+")
        .replace(">+", "+")
        .replace("<#", "#")
        .replace(">#", "#")
        .replace("__FLOWCELL_ALTGR__", "<^>!")
}

fn normalize_shortcut(value: &str) -> String {
    canonicalize_shortcut(value)
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>()
        .to_lowercase()
}

fn parse_i64(value: &str) -> Option<i64> {
    value.trim().parse::<i64>().ok()
}

fn parse_ini_sections(text: &str) -> Vec<RawIniSection> {
    let mut sections: Vec<RawIniSection> = Vec::new();
    let mut current_name: Option<String> = None;
    let mut current_entries: Vec<(String, String)> = Vec::new();

    for raw_line in text.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') {
            continue;
        }
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            if let Some(name) = current_name.take() {
                sections.push(RawIniSection {
                    name,
                    entries: current_entries,
                });
            }
            current_name = Some(trimmed[1..trimmed.len() - 1].trim().to_string());
            current_entries = Vec::new();
            continue;
        }
        if let Some((key, value)) = trimmed.split_once('=') {
            current_entries.push((key.trim().to_string(), value.trim().to_string()));
        }
    }

    if let Some(name) = current_name.take() {
        sections.push(RawIniSection {
            name,
            entries: current_entries,
        });
    }

    sections
}

fn parse_bindings_config(path: &Path) -> Result<BindingsConfig, String> {
    if !path.exists() {
        return Ok(BindingsConfig {
            next_id: 1,
            macro_editor_columns: default_macro_editor_columns(),
            ..BindingsConfig::default()
        });
    }

    let text = read_text_file(path)?;
    let sections = parse_ini_sections(&text);

    let mut config = BindingsConfig {
        next_id: 1,
        macro_editor_columns: default_macro_editor_columns(),
        ..BindingsConfig::default()
    };
    let mut discovered_program_tabs: BTreeMap<i64, Vec<(String, String)>> = BTreeMap::new();

    sections.into_iter().for_each(|section| match section.name.as_str() {
        "Meta" => {
            section.entries.iter().for_each(|(key, value)| match key.as_str() {
                "NextId" => {
                    if let Some(parsed) = parse_i64(value) {
                        config.next_id = parsed.max(1);
                    }
                }
                "ProgramTabNextId" => {
                    if let Some(parsed) = parse_i64(value) {
                        config.program_tab_next_id = parsed.max(1);
                    }
                }
                "SelectedProgramTabId" => {
                    if let Some(parsed) = parse_i64(value) {
                        config.selected_program_tab_id = parsed.max(1);
                    }
                }
                "ProgramTabIds" => {
                    config.program_tab_ids = value
                        .split('|')
                        .filter_map(parse_i64)
                        .collect::<Vec<_>>();
                }
                _ => {}
            });
        }
        "ActionHotkeys" => {
            config.action_hotkeys = section
                .entries
                .iter()
                .filter_map(|(key, value)| {
                    let shortcut = canonicalize_shortcut(value);
                    if key.trim().is_empty() || shortcut.is_empty() {
                        None
                    } else {
                        Some((key.clone(), shortcut))
                    }
                })
                .collect::<BTreeMap<_, _>>();
        }
        "MacroEditorColumns" => {
            if !section.entries.is_empty() {
                config.macro_editor_columns = section.entries.clone();
            }
        }
        _ if section.name.starts_with("Binding_") => {
            if let Some(id) = parse_i64(section.name.trim_start_matches("Binding_")) {
                let mut shortcut = String::new();
                let mut target = String::new();
                let mut program_tab_id = 0_i64;
                section.entries.iter().for_each(|(key, value)| match key.as_str() {
                    "Shortcut" => shortcut = canonicalize_shortcut(value),
                    "ScriptPath" => target = value.clone(),
                    "ProgramTabId" => {
                        if let Some(parsed) = parse_i64(value) {
                            program_tab_id = parsed;
                        }
                    }
                    _ => {}
                });
                if !shortcut.is_empty() && !target.trim().is_empty() {
                    config.script_bindings.push(ScriptBindingEntry {
                        id,
                        shortcut,
                        target,
                        program_tab_id,
                    });
                }
            }
        }
        _ if section.name.starts_with("ProgramTab_") => {
            if let Some(id) = parse_i64(section.name.trim_start_matches("ProgramTab_")) {
                discovered_program_tabs.insert(id, section.entries.clone());
            }
        }
        _ => config.other_sections.push(section),
    });

    if config.program_tab_ids.is_empty() {
        config.program_tab_ids = discovered_program_tabs.keys().copied().collect::<Vec<_>>();
    }

    config.program_tabs = config
        .program_tab_ids
        .iter()
        .filter_map(|id| discovered_program_tabs.remove(id).map(|entries| (*id, entries)))
        .collect::<Vec<_>>();
    discovered_program_tabs
        .into_iter()
        .for_each(|entry| config.program_tabs.push(entry));

    config.program_tab_ids = config
        .program_tabs
        .iter()
        .map(|(id, _)| *id)
        .collect::<Vec<_>>();
    config.script_bindings.sort_by_key(|binding| binding.id);
    config.next_id = config.next_id.max(
        config
            .script_bindings
            .iter()
            .map(|binding| binding.id)
            .max()
            .unwrap_or(0)
            + 1,
    );

    if config.program_tab_next_id <= 0 {
        config.program_tab_next_id = config
            .program_tab_ids
            .iter()
            .max()
            .map(|value| value + 1)
            .unwrap_or(1);
    }

    Ok(config)
}

fn load_bindings_state(paths: &AppPaths) -> Result<FlowCellBindingsState, String> {
    let config = parse_bindings_config(&bindings_path(paths))?;
    Ok(FlowCellBindingsState {
        next_id: config.next_id.max(1),
        script_bindings: config
            .script_bindings
            .iter()
            .map(|binding| FlowCellScriptBinding {
                id: binding.id,
                shortcut: binding.shortcut.clone(),
                target: binding.target.clone(),
                status: "Active".to_string(),
                program_tab_id: (binding.program_tab_id > 0).then_some(binding.program_tab_id),
            })
            .collect::<Vec<_>>(),
        action_hotkeys: config
            .action_hotkeys
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect::<HashMap<_, _>>(),
    })
}

fn write_bindings_config(path: &Path, config: &BindingsConfig) -> Result<(), String> {
    let mut lines: Vec<String> = Vec::new();
    let binding_ids = config
        .script_bindings
        .iter()
        .map(|binding| binding.id.to_string())
        .collect::<Vec<_>>();
    let program_tab_ids = config
        .program_tabs
        .iter()
        .map(|(id, _)| id.to_string())
        .collect::<Vec<_>>();

    lines.push("[Meta]".to_string());
    lines.push(format!("NextId={}", config.next_id.max(1)));
    lines.push(format!("Ids={}", binding_ids.join("|")));
    lines.push(format!("ProgramTabNextId={}", config.program_tab_next_id.max(1)));
    lines.push(format!("ProgramTabIds={}", program_tab_ids.join("|")));
    lines.push(format!(
        "SelectedProgramTabId={}",
        config.selected_program_tab_id.max(1)
    ));
    lines.push(String::new());

    config.script_bindings.iter().for_each(|binding| {
        lines.push(format!("[Binding_{}]", binding.id));
        lines.push(format!(
            "Shortcut={}",
            canonicalize_shortcut(&binding.shortcut)
        ));
        lines.push(format!("ScriptPath={}", binding.target));
        if binding.program_tab_id > 0 {
            lines.push(format!("ProgramTabId={}", binding.program_tab_id));
        }
        lines.push(String::new());
    });

    config.program_tabs.iter().for_each(|(id, entries)| {
        lines.push(format!("[ProgramTab_{}]", id));
        entries
            .iter()
            .for_each(|(key, value)| lines.push(format!("{}={}", key, value)));
        lines.push(String::new());
    });

    lines.push("[ActionHotkeys]".to_string());
    config.action_hotkeys.iter().for_each(|(key, value)| {
        let shortcut = canonicalize_shortcut(value);
        if !key.trim().is_empty() && !shortcut.is_empty() {
            lines.push(format!("{}={}", key, shortcut));
        }
    });
    lines.push(String::new());

    lines.push("[MacroEditorColumns]".to_string());
    config
        .macro_editor_columns
        .iter()
        .for_each(|(key, value)| lines.push(format!("{}={}", key, value)));

    config.other_sections.iter().for_each(|section| {
        lines.push(String::new());
        lines.push(format!("[{}]", section.name));
        section
            .entries
            .iter()
            .for_each(|(key, value)| lines.push(format!("{}={}", key, value)));
    });

    write_utf16le_text(path, &lines.join("\r\n"))
}

fn resolve_existing_script_binding_index(
    config: &BindingsConfig,
    binding_id: i64,
    target: &str,
    program_tab_id: i64,
) -> Option<usize> {
    if binding_id > 0 {
        if let Some(index) = config
            .script_bindings
            .iter()
            .position(|binding| binding.id == binding_id)
        {
            return Some(index);
        }
    }

    let trimmed_target = target.trim();
    if trimmed_target.is_empty() {
        return None;
    }

    config
        .script_bindings
        .iter()
        .position(|binding| binding.target == trimmed_target && binding.program_tab_id == program_tab_id)
        .or_else(|| {
            config
                .script_bindings
                .iter()
                .position(|binding| binding.target == trimmed_target)
        })
}

fn binding_label(request: &ButtonBindingMutationRequest) -> String {
    request
        .label
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(request.target.as_str())
        .to_string()
}

fn powershell_single_quote(value: &str) -> String {
    value.replace('\'', "''")
}

fn restart_headless_backend(paths: &AppPaths) -> Result<(), String> {
    let backend_script = powershell_single_quote(&paths.flowcell_root.join("FlowCellBackend.ahk").display().to_string());
    let launcher_path = powershell_single_quote(&paths.flowcell_root.join("run_backend_hidden.vbs").display().to_string());
    let script = format!(
        "$backendScript = '{backend_script}'; \
         $launcherPath = '{launcher_path}'; \
         Get-CimInstance Win32_Process | Where-Object {{ \
           ($_.Name -eq 'AutoHotkey64.exe' -or $_.Name -eq 'AutoHotkey.exe') -and \
           $_.CommandLine -and \
           $_.CommandLine.IndexOf($backendScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and \
           $_.CommandLine.IndexOf('--headless', [System.StringComparison]::OrdinalIgnoreCase) -ge 0 \
         }} | ForEach-Object {{ \
           try {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }} catch {{ }} \
         }}; \
         if (Test-Path -LiteralPath $launcherPath -PathType Leaf) {{ \
           Start-Process -FilePath 'wscript.exe' -ArgumentList @('//nologo', $launcherPath) -WindowStyle Hidden | Out-Null \
         }}"
    );

    let output = Command::new(powershell_exe())
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Restarting the FlowCell backend failed.".to_string()
        } else {
            stderr
        });
    }

    Ok(())
}

fn strip_utf8_bom(value: &str) -> &str {
    value.trim_start_matches('\u{feff}')
}

fn sanitize_layout_name(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| match character {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' => character,
            _ => '_',
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();

    if sanitized.is_empty() {
        "layout".to_string()
    } else {
        sanitized
    }
}

fn system_time_string(value: SystemTime) -> Option<String> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs().to_string())
}

fn get_section_value(entries: &[(String, String)], key: &str) -> Option<String> {
    entries
        .iter()
        .find(|(candidate, _)| candidate.eq_ignore_ascii_case(key))
        .map(|(_, value)| value.clone())
}

fn is_step_section_name(name: &str) -> bool {
    name.strip_prefix("Step_")
        .map(|suffix| !suffix.is_empty() && suffix.chars().all(|character| character.is_ascii_digit()))
        .unwrap_or(false)
}

fn sanitize_macro_slug(value: &str) -> String {
    let mut slug = String::new();
    let mut previous_was_separator = false;
    for character in value.trim().to_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character);
            previous_was_separator = false;
        } else if !previous_was_separator {
            slug.push('_');
            previous_was_separator = true;
        }
    }

    let trimmed = slug.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "recorded_action".to_string()
    } else {
        trimmed
    }
}

fn sanitize_macro_file_token(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| match character {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' => character,
            _ => '_',
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();

    if sanitized.is_empty() {
        "recorded_action".to_string()
    } else {
        sanitized
    }
}

fn powershell_date_string(format_string: &str) -> Option<String> {
    let script = format!(
        "Get-Date -Format '{}'",
        powershell_single_quote(format_string)
    );
    let output = Command::new(powershell_exe())
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!stdout.is_empty()).then_some(stdout)
}

fn build_recorded_action_id(label: &str) -> String {
    let slug = sanitize_macro_slug(label);
    let timestamp = powershell_date_string("yyyyMMdd_HHmmss").unwrap_or_else(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .map(|duration| duration.as_secs().to_string())
            .unwrap_or_else(|| "now".to_string())
    });
    format!("recorded_{}_{}", slug, timestamp)
}

fn default_recorded_macro_created_at() -> Option<String> {
    powershell_date_string("yyyy-MM-dd HH:mm:ss")
        .or_else(|| system_time_string(SystemTime::now()))
}

fn clean_ini_value(value: &str) -> String {
    value.replace(['\r', '\n'], " ")
}

fn list_recorded_macro_paths(root: &Path) -> Result<Vec<PathBuf>, String> {
    ensure_directory(root)?;
    let mut paths = fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .map(|extension| extension.to_string_lossy().eq_ignore_ascii_case("ini"))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    paths.sort();
    Ok(paths)
}

fn parse_recorded_macro_definition(
    path: &Path,
    include_steps: bool,
) -> Result<RecordedMacroDefinition, String> {
    let text = read_text_file(path)?;
    let sections = parse_ini_sections(&text);
    let action_section = sections
        .iter()
        .find(|section| section.name.eq_ignore_ascii_case("Action"))
        .ok_or_else(|| format!("Macro file is missing [Action]: {}", path.display()))?;
    let id = get_section_value(&action_section.entries, "Id")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("Macro file is missing Id: {}", path.display()))?;
    let label = get_section_value(&action_section.entries, "Label")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("Macro file is missing Label: {}", path.display()))?;
    let created_at = get_section_value(&action_section.entries, "CreatedAt")
        .filter(|value| !value.trim().is_empty());

    let steps = if include_steps {
        sections
            .iter()
            .filter(|section| is_step_section_name(&section.name))
            .filter_map(|section| {
                let raw_type = get_section_value(&section.entries, "Type")?;
                let script_path =
                    get_section_value(&section.entries, "ScriptPath").filter(|value| !value.trim().is_empty());
                let macro_path =
                    get_section_value(&section.entries, "MacroPath").filter(|value| !value.trim().is_empty());
                let step_type = if macro_path.is_some() {
                    "Macro".to_string()
                } else if script_path.is_some() {
                    "Script".to_string()
                } else {
                    raw_type.trim().to_string()
                };
                (!step_type.is_empty()).then_some(RecordedMacroStep {
                    section: Some(section.name.clone()),
                    step_type,
                    delay_ms: get_section_value(&section.entries, "DelayMs")
                        .and_then(|value| parse_i64(&value))
                        .unwrap_or(0),
                    x: get_section_value(&section.entries, "X"),
                    y: get_section_value(&section.entries, "Y"),
                    button: get_section_value(&section.entries, "Button"),
                    count: get_section_value(&section.entries, "Count"),
                    direction: get_section_value(&section.entries, "Direction"),
                    text: get_section_value(&section.entries, "Text"),
                    keys: get_section_value(&section.entries, "Keys"),
                    script_path,
                    macro_path,
                })
            })
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    Ok(RecordedMacroDefinition {
        path: path.display().to_string(),
        file_name: path
            .file_stem()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default(),
        id,
        label,
        created_at,
        steps,
    })
}

fn find_recorded_macro_path_by_id(root: &Path, action_id: &str) -> Result<Option<PathBuf>, String> {
    let direct_path = root.join(format!("{}.ini", sanitize_macro_file_token(action_id)));
    if direct_path.exists() {
        return Ok(Some(direct_path));
    }

    for path in list_recorded_macro_paths(root)? {
        if let Ok(definition) = parse_recorded_macro_definition(&path, false) {
            if definition.id.eq_ignore_ascii_case(action_id) {
                return Ok(Some(path));
            }
        }
    }

    Ok(None)
}

fn write_recorded_macro_definition(
    root: &Path,
    definition: &RecordedMacroDefinition,
) -> Result<RecordedMacroDefinition, String> {
    let id = definition.id.trim();
    if id.is_empty() {
        return Err("Macro id is required.".to_string());
    }
    let label = definition.label.trim();
    if label.is_empty() {
        return Err("Macro name is required.".to_string());
    }

    ensure_directory(root)?;
    let path = find_recorded_macro_path_by_id(root, id)?.unwrap_or_else(|| {
        root.join(format!("{}.ini", sanitize_macro_file_token(id)))
    });

    let created_at = definition
        .created_at
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(default_recorded_macro_created_at);

    let mut lines = vec![
        "[Action]".to_string(),
        format!("Id={}", id),
        format!("Label={}", clean_ini_value(label)),
    ];
    if let Some(created_at_value) = created_at.as_deref() {
        lines.push(format!("CreatedAt={}", clean_ini_value(created_at_value)));
    }
    lines.push(String::new());

    for (index, step) in definition.steps.iter().enumerate() {
        let normalized_type = match step.step_type.trim().to_ascii_lowercase().as_str() {
            "activateillustrator" => "ActivateIllustrator",
            "activateblender" => "ActivateBlender",
            "activatephotoshop" => "ActivatePhotoshop",
            "activatewindows" => "ActivateWindows",
            "click" => "Click",
            "wheel" => "Wheel",
            "text" => "Text",
            "key" => "Key",
            "script" => "Script",
            "macro" => "Macro",
            _ => "Click",
        };

        lines.push(format!("[Step_{:03}]", index + 1));
        lines.push(format!("Type={}", normalized_type));
        lines.push(format!("DelayMs={}", step.delay_ms.max(0)));

        match normalized_type {
            "Click" => {
                lines.push(format!("X={}", step.x.as_deref().unwrap_or("0").trim()));
                lines.push(format!("Y={}", step.y.as_deref().unwrap_or("0").trim()));
                lines.push(format!(
                    "Button={}",
                    step.button.as_deref().unwrap_or("Left").trim()
                ));
                lines.push(format!("Count={}", step.count.as_deref().unwrap_or("1").trim()));
            }
            "Wheel" => {
                lines.push(format!("X={}", step.x.as_deref().unwrap_or("0").trim()));
                lines.push(format!("Y={}", step.y.as_deref().unwrap_or("0").trim()));
                lines.push(format!(
                    "Direction={}",
                    step.direction.as_deref().unwrap_or("Down").trim()
                ));
                lines.push(format!("Count={}", step.count.as_deref().unwrap_or("1").trim()));
            }
            "Text" => {
                lines.push(format!(
                    "Text={}",
                    clean_ini_value(step.text.as_deref().unwrap_or(""))
                ));
            }
            "Key" => {
                lines.push(format!(
                    "Keys={}",
                    clean_ini_value(step.keys.as_deref().unwrap_or(""))
                ));
            }
            "Script" => {
                let script_path = step.script_path.as_deref().unwrap_or("").trim().to_string();
                if script_path.is_empty() {
                    return Err("Script steps require a script path.".to_string());
                }
                lines.push(format!("ScriptPath={}", script_path));
            }
            "Macro" => {
                let macro_path = step.macro_path.as_deref().unwrap_or("").trim().to_string();
                if macro_path.is_empty() {
                    return Err("Nested macro steps require a macro path.".to_string());
                }
                lines.push(format!("MacroPath={}", macro_path));
            }
            _ => {}
        }

        lines.push(String::new());
    }

    fs::write(&path, lines.join("\r\n")).map_err(|error| error.to_string())?;
    parse_recorded_macro_definition(&path, true)
}

fn move_file_to_recycle_bin(path: &Path) -> Result<(), String> {
    let quoted_path = powershell_single_quote(&path.display().to_string());
    let script = format!(
        "Add-Type -AssemblyName Microsoft.VisualBasic; \
         [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(\
         '{quoted_path}', \
         [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, \
         [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)"
    );
    let output = Command::new(powershell_exe())
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!("Failed to move {} to the Recycle Bin.", path.display())
        } else {
            stderr
        })
    }
}

fn find_autohotkey_exe(paths: &AppPaths) -> Result<PathBuf, String> {
    let candidates = [
        paths.flowcell_root.join("runtime").join("AutoHotkey64.exe"),
        paths.flowcell_root.join("runtime").join("AutoHotkey.exe"),
        paths.local_root.join("bin").join("AutoHotkey64.exe"),
        paths.local_root.join("bin").join("AutoHotkey.exe"),
        PathBuf::from(r"C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe"),
        PathBuf::from(r"C:\Program Files\AutoHotkey\v2\AutoHotkey.exe"),
    ];

    candidates
        .into_iter()
        .find(|candidate| candidate.exists())
        .ok_or_else(|| "AutoHotkey v2 executable was not found.".to_string())
}

fn last_action_status_path(paths: &AppPaths) -> PathBuf {
    paths.logs_root.join("last_action_status.txt")
}

fn parse_dialog_filters(filter: &str) -> Vec<(String, Vec<String>)> {
    let segments: Vec<&str> = filter
        .split('|')
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .collect();
    let mut parsed = Vec::new();

    let mut index = 0usize;
    while index + 1 < segments.len() {
        let name = segments[index].to_string();
        let extensions = segments[index + 1]
            .split(';')
            .map(str::trim)
            .map(|entry| entry.trim_start_matches("*.").trim_start_matches('.'))
            .filter(|entry| !entry.is_empty() && *entry != "*" && *entry != "*.*")
            .map(str::to_string)
            .collect::<Vec<_>>();
        if !extensions.is_empty() {
            parsed.push((name, extensions));
        }
        index += 2;
    }

    parsed
}

fn clone_popout_window_config(
    app: &AppHandle,
    label: String,
    title: String,
    width: f64,
    height: f64,
    bounds: Option<FlowCellBounds>,
) -> Result<WindowConfig, String> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .or_else(|| app.config().app.windows.first())
        .cloned()
        .ok_or_else(|| "Missing base window config.".to_string())?;

    config.label = label;
    config.title = title;
    config.create = true;
    config.visible = true;
    config.resizable = true;
    config.width = width;
    config.height = height;

    if let Some(bounds) = bounds {
        config.x = Some(bounds.left);
        config.y = Some(bounds.top);
        config.width = width.max(bounds.width);
        config.height = height.max(bounds.height);
    } else {
        config.x = None;
        config.y = None;
    }

    Ok(config)
}

fn powershell_exe() -> String {
    std::env::var("SystemRoot")
        .map(|root| format!(r"{}\System32\WindowsPowerShell\v1.0\powershell.exe", root))
        .unwrap_or_else(|_| "powershell.exe".to_string())
}

fn sanitize_token(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '/') {
                character
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "flowcell".to_string()
    } else {
        sanitized
    }
}

fn get_foreground_process_info_impl() -> ForegroundProcessInfo {
    unsafe {
        let foreground_window = GetForegroundWindow();
        if foreground_window.is_null() {
            return ForegroundProcessInfo::default();
        }

        let mut process_id = 0u32;
        GetWindowThreadProcessId(foreground_window, &mut process_id);
        if process_id == 0 {
            return ForegroundProcessInfo::default();
        }

        let process_handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
        if process_handle.is_null() {
            return ForegroundProcessInfo::default();
        }

        let mut buffer = vec![0u16; 1024];
        let mut length = buffer.len() as u32;
        let query_result =
            QueryFullProcessImageNameW(process_handle, 0, buffer.as_mut_ptr(), &mut length);
        let _ = CloseHandle(process_handle);

        if query_result == 0 || length == 0 {
            return ForegroundProcessInfo::default();
        }

        let process_path = String::from_utf16_lossy(&buffer[..length as usize]);
        let process_name = Path::new(&process_path)
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();

        ForegroundProcessInfo {
            process_name,
            process_path,
        }
    }
}

fn build_tool_popout_label(program_id: i64, panel_id: &str, owner_button_id: &str) -> String {
    format!(
        "popout-tool-{}-{}-{}",
        program_id,
        sanitize_token(panel_id),
        sanitize_token(owner_button_id)
    )
}

fn request_id_from_envelope(envelope: &FlowCellCommandEnvelope) -> String {
    envelope
        .request_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            format!(
                "{}-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|duration| duration.as_millis())
                    .unwrap_or(0),
                sanitize_token(&envelope.button_id)
            )
        })
}

fn collect_output_logs(stdout_text: &str, stderr_text: &str) -> Vec<String> {
    let mut logs = Vec::new();

    for line in stdout_text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(16)
    {
        logs.push(format!("stdout: {}", line));
    }

    for line in stderr_text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(16)
    {
        logs.push(format!("stderr: {}", line));
    }

    logs
}

fn failure_result(
    request_id: String,
    message: String,
    details: Value,
    logs: Vec<String>,
    exit_code: i32,
    duration_ms: u64,
) -> GatewayCommandResult {
    GatewayCommandResult {
        ok: false,
        request_id,
        status: "error".to_string(),
        message,
        details,
        logs,
        exit_code,
        duration_ms,
    }
}

fn success_status(ok: bool) -> String {
    if ok {
        "ok".to_string()
    } else {
        "error".to_string()
    }
}

fn normalize_backend_result(
    request_id: String,
    legacy_result: Value,
    stdout_text: String,
    stderr_text: String,
    exit_code: i32,
    duration_ms: u64,
) -> GatewayCommandResult {
    let ok = legacy_result
        .get("Succeeded")
        .and_then(Value::as_bool)
        .unwrap_or(exit_code == 0);

    let message = legacy_result
        .get("Message")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            if !stderr_text.is_empty() {
                Some(stderr_text.clone())
            } else if !stdout_text.is_empty() {
                Some(stdout_text.clone())
            } else if ok {
                Some("FlowCell command completed.".to_string())
            } else {
                Some("FlowCell command failed.".to_string())
            }
        })
        .unwrap_or_else(|| "FlowCell command failed.".to_string());

    let mut details = Map::new();

    for (detail_key, legacy_key) in [
        ("resolved_target", "ResolvedTarget"),
        ("execution_method", "ExecutionMethod"),
        ("client_action", "ClientAction"),
    ] {
        if let Some(value) = legacy_result.get(legacy_key).cloned() {
            details.insert(detail_key.to_string(), value);
        }
    }

    if let Some(value) = legacy_result.get("SmartAxisResult").cloned() {
        details.insert("smart_axis_result".to_string(), value);
    }
    if let Some(value) = legacy_result.get("ToolOptionState").cloned() {
        details.insert("tool_option_state".to_string(), value);
    }
    if !stdout_text.is_empty() {
        details.insert(
            "backend_stdout".to_string(),
            Value::String(stdout_text.clone()),
        );
    }
    if !stderr_text.is_empty() {
        details.insert(
            "backend_stderr".to_string(),
            Value::String(stderr_text.clone()),
        );
    }
    details.insert("legacy_result".to_string(), legacy_result);

    GatewayCommandResult {
        ok,
        request_id,
        status: success_status(ok),
        message,
        details: Value::Object(details),
        logs: collect_output_logs(&stdout_text, &stderr_text),
        exit_code,
        duration_ms,
    }
}

fn emit_command_impl(
    paths: &AppPaths,
    window_label: &str,
    envelope: FlowCellCommandEnvelope,
) -> GatewayCommandResult {
    let request_id = request_id_from_envelope(&envelope);
    let command_id = envelope.command_id.clone();
    let button_id = envelope.button_id.clone();
    let child_slot_id = envelope.child_slot_id.clone().unwrap_or_default();

    if envelope.command_id.trim().is_empty() {
        return failure_result(
            request_id,
            "Command envelope is missing command_id.".to_string(),
            json!({}),
            vec![],
            -1,
            0,
        );
    }

    if envelope.payload.is_null() {
        return failure_result(
            request_id,
            "Command envelope is missing payload.".to_string(),
            json!({}),
            vec![],
            -1,
            0,
        );
    }

    let _ = write_frontend_log(
        paths,
        &format!(
            "Gateway received command. RequestId={}; Window={}; CommandId={}; ButtonId={}; ChildSlotId={}",
            request_id, window_label, command_id, button_id, child_slot_id
        ),
    );

    let temp_root = paths.local_root.join("temp").join("tauri_command_host");
    if let Err(error) = ensure_directory(&temp_root) {
        return failure_result(request_id, error, json!({}), vec![], -1, 0);
    }

    let temp_token = sanitize_token(&request_id);
    let envelope_path = temp_root.join(format!("envelope-{}.json", temp_token));
    let result_path = temp_root.join(format!("result-{}.json", temp_token));

    let rendered_envelope = match serde_json::to_string_pretty(&envelope) {
        Ok(rendered) => rendered,
        Err(error) => {
            return failure_result(request_id, error.to_string(), json!({}), vec![], -1, 0)
        }
    };

    if let Err(error) = fs::write(&envelope_path, rendered_envelope) {
        return failure_result(request_id, error.to_string(), json!({}), vec![], -1, 0);
    }

    let backend_script = paths.flowcell_root.join("FlowCellCommandBackend.ps1");
    let _ = write_frontend_log(
        paths,
        &format!(
            "Gateway called backend host. RequestId={}; Script={}",
            request_id,
            backend_script.display()
        ),
    );

    let started = Instant::now();
    let output = Command::new(powershell_exe())
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            &backend_script.display().to_string(),
            "-EnvelopePath",
            &envelope_path.display().to_string(),
            "-ResultPath",
            &result_path.display().to_string(),
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    let duration_ms = started.elapsed().as_millis() as u64;

    let result = match output {
        Ok(output) => {
            let exit_code = output.status.code().unwrap_or(-1);
            let stdout_text = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr_text = String::from_utf8_lossy(&output.stderr).trim().to_string();

            let legacy_result = if result_path.exists() {
                match fs::read_to_string(&result_path) {
                    Ok(result_text) => {
                        let sanitized_result_text = result_text.trim_start_matches('\u{feff}');
                        match serde_json::from_str::<Value>(sanitized_result_text) {
                            Ok(result_value) => result_value,
                            Err(error) => json!({
                                "Succeeded": false,
                                "Message": format!("Backend result was not valid JSON: {}", error),
                                "RawResult": sanitized_result_text
                            }),
                        }
                    }
                    Err(error) => json!({
                        "Succeeded": false,
                        "Message": error.to_string()
                    }),
                }
            } else {
                json!({
                    "Succeeded": output.status.success(),
                    "Message": if !stderr_text.is_empty() {
                        stderr_text.clone()
                    } else if !stdout_text.is_empty() {
                        stdout_text.clone()
                    } else if output.status.success() {
                        "FlowCell command completed.".to_string()
                    } else {
                        "The backend host did not produce a result file.".to_string()
                    }
                })
            };

            normalize_backend_result(
                request_id.clone(),
                legacy_result,
                stdout_text,
                stderr_text,
                exit_code,
                duration_ms,
            )
        }
        Err(error) => failure_result(
            request_id.clone(),
            error.to_string(),
            json!({ "backend_script": backend_script.display().to_string() }),
            vec![],
            -1,
            duration_ms,
        ),
    };

    let _ = write_frontend_log(
        paths,
        &format!(
            "Gateway received backend result. RequestId={}; Ok={}; ExitCode={}; Message={}",
            result.request_id, result.ok, result.exit_code, result.message
        ),
    );

    let _ = fs::remove_file(&envelope_path);
    let _ = fs::remove_file(&result_path);

    result
}

#[tauri::command]
fn load_state(state: State<'_, RuntimeState>) -> Result<LoadStateResponse, String> {
    let paths = with_paths(&state)?;
    let state_path = state_path(&paths);
    let state_text = fs::read_to_string(&state_path).map_err(|error| error.to_string())?;
    let state_value: Value =
        serde_json::from_str(strip_utf8_bom(&state_text)).map_err(|error| error.to_string())?;
    let bindings = match load_bindings_state(&paths) {
        Ok(loaded) => loaded,
        Err(error) => {
            let _ = write_frontend_log(
                &paths,
                &format!("Bindings load failed. Path={}; Error={}", bindings_path(&paths).display(), error),
            );
            FlowCellBindingsState {
                next_id: 1,
                ..FlowCellBindingsState::default()
            }
        }
    };
    let program_count = state_value
        .get("Programs")
        .and_then(Value::as_array)
        .map(|programs| programs.len())
        .unwrap_or(0);
    write_frontend_log(
        &paths,
        &format!(
            "Frontend loaded state. Path={}; Programs={}",
            state_path.display(),
            program_count
        ),
    )?;

    Ok(LoadStateResponse {
        state: state_value,
        runtime: RuntimeInfo {
            repo_root: paths.repo_root.display().to_string(),
            flow_cell_root: paths.flowcell_root.display().to_string(),
            state_path: state_path.display().to_string(),
            frontend_log_path: paths.frontend_log_path.display().to_string(),
        },
        bindings,
    })
}

#[tauri::command]
fn save_state(state: State<'_, RuntimeState>, next_state: Value) -> Result<(), String> {
    let paths = with_paths(&state)?;
    let rendered = serde_json::to_string_pretty(&next_state).map_err(|error| error.to_string())?;
    fs::write(state_path(&paths), rendered).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_button_binding(
    state: State<'_, RuntimeState>,
    request: ButtonBindingMutationRequest,
) -> Result<BindingMutationResult, String> {
    let paths = with_paths(&state)?;
    let path = bindings_path(&paths);
    let mut config = parse_bindings_config(&path)?;
    let kind = request.kind.trim().to_lowercase();
    if kind != "script" && kind != "macro" {
        return Err("Only script and macro buttons can be bound.".to_string());
    }

    let shortcut = canonicalize_shortcut(request.shortcut.as_deref().unwrap_or(""));
    if shortcut.is_empty() {
        return Err("Choose or enter a shortcut first.".to_string());
    }

    let normalized_shortcut = normalize_shortcut(&shortcut);
    let message = if kind == "script" {
        let target = request.target.trim();
        if target.is_empty() {
            return Err("Choose a script target first.".to_string());
        }

        let existing_index = resolve_existing_script_binding_index(
            &config,
            request.binding_id.unwrap_or_default(),
            target,
            request.program_tab_id,
        );
        for (index, binding) in config.script_bindings.iter().enumerate() {
            if normalize_shortcut(&binding.shortcut) == normalized_shortcut
                && Some(index) != existing_index
            {
                return Err(format!("That shortcut is already bound to:\n{}", binding.target));
            }
        }
        for existing_shortcut in config.action_hotkeys.values() {
            if normalize_shortcut(existing_shortcut) == normalized_shortcut {
                return Err("That shortcut is already used by another action binding.".to_string());
            }
        }

        if let Some(index) = existing_index {
            config.script_bindings[index].shortcut = shortcut.clone();
            config.script_bindings[index].target = target.to_string();
            config.script_bindings[index].program_tab_id = request.program_tab_id.max(0);
        } else {
            let next_id = config.next_id.max(
                config
                    .script_bindings
                    .iter()
                    .map(|binding| binding.id)
                    .max()
                    .unwrap_or(0)
                    + 1,
            );
            config.next_id = next_id + 1;
            config.script_bindings.push(ScriptBindingEntry {
                id: next_id,
                shortcut: shortcut.clone(),
                target: target.to_string(),
                program_tab_id: request.program_tab_id.max(0),
            });
            config.script_bindings.sort_by_key(|binding| binding.id);
        }

        format!("Saved shortcut {} for {}.", shortcut, binding_label(&request))
    } else {
        let action_id = request.target.trim();
        if action_id.is_empty() {
            return Err("Choose a macro target first.".to_string());
        }

        for binding in &config.script_bindings {
            if normalize_shortcut(&binding.shortcut) == normalized_shortcut {
                return Err(format!("That shortcut is already bound to:\n{}", binding.target));
            }
        }
        for (existing_action_id, existing_shortcut) in &config.action_hotkeys {
            if normalize_shortcut(existing_shortcut) == normalized_shortcut
                && !existing_action_id.eq_ignore_ascii_case(action_id)
            {
                return Err("That shortcut is already used by another action binding.".to_string());
            }
        }

        config
            .action_hotkeys
            .insert(action_id.to_string(), shortcut.clone());
        format!("Saved shortcut {} for {}.", shortcut, binding_label(&request))
    };

    write_bindings_config(&path, &config)?;
    restart_headless_backend(&paths)?;
    write_frontend_log(
        &paths,
        &format!(
            "Saved button binding. Kind={}; Target={}; Shortcut={}",
            kind, request.target, shortcut
        ),
    )?;

    Ok(BindingMutationResult { message })
}

#[tauri::command]
fn clear_button_binding(
    state: State<'_, RuntimeState>,
    request: ButtonBindingMutationRequest,
) -> Result<BindingMutationResult, String> {
    let paths = with_paths(&state)?;
    let path = bindings_path(&paths);
    let mut config = parse_bindings_config(&path)?;
    let kind = request.kind.trim().to_lowercase();
    if kind != "script" && kind != "macro" {
        return Err("Only script and macro buttons can clear bindings.".to_string());
    }

    let mut changed = false;
    let message = if kind == "script" {
        let existing_index = resolve_existing_script_binding_index(
            &config,
            request.binding_id.unwrap_or_default(),
            request.target.trim(),
            request.program_tab_id,
        );
        if let Some(index) = existing_index {
            config.script_bindings.remove(index);
            changed = true;
            format!("Cleared shortcut for {}.", binding_label(&request))
        } else {
            format!("No shortcut was saved for {}.", binding_label(&request))
        }
    } else {
        if config.action_hotkeys.remove(request.target.trim()).is_some() {
            changed = true;
            format!("Cleared shortcut for {}.", binding_label(&request))
        } else {
            format!("No shortcut was saved for {}.", binding_label(&request))
        }
    };

    if !changed {
        return Ok(BindingMutationResult { message });
    }

    write_bindings_config(&path, &config)?;
    restart_headless_backend(&paths)?;
    write_frontend_log(
        &paths,
        &format!(
            "Cleared button binding. Kind={}; Target={}",
            kind, request.target
        ),
    )?;

    Ok(BindingMutationResult { message })
}

#[tauri::command]
fn get_window_context(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
) -> Result<WindowContext, String> {
    let contexts = state
        .window_contexts
        .lock()
        .map_err(|_| "Window context lock failed.".to_string())?;
    Ok(contexts
        .get(window.label())
        .cloned()
        .unwrap_or(WindowContext {
            kind: "main".to_string(),
            ..WindowContext::default()
        }))
}

#[tauri::command]
fn log_frontend_event(
    state: State<'_, RuntimeState>,
    surface: String,
    message: String,
) -> Result<(), String> {
    let paths = with_paths(&state)?;
    write_frontend_log(&paths, &format!("{}; Surface={}", message, surface))
}

#[tauri::command]
fn get_foreground_process_info() -> Result<ForegroundProcessInfo, String> {
    Ok(get_foreground_process_info_impl())
}

#[tauri::command]
fn show_open_file_dialog(
    window: WebviewWindow,
    title: String,
    filter: String,
    initial_directory: Option<String>,
    multiselect: Option<bool>,
) -> Result<Vec<String>, String> {
    let mut builder = window.dialog().file().set_title(title);

    if let Some(directory) = initial_directory
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        if Path::new(directory).is_dir() {
            builder = builder.set_directory(directory);
        }
    }

    let parsed_filters = parse_dialog_filters(&filter);
    for (name, extensions) in parsed_filters {
        let ext_refs = extensions.iter().map(String::as_str).collect::<Vec<_>>();
        builder = builder.add_filter(name, &ext_refs);
    }

    let selected = if multiselect.unwrap_or(false) {
        builder
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|entry| {
                entry
                    .into_path()
                    .map(|path| path.display().to_string())
                    .map_err(|error| error.to_string())
            })
            .collect::<Result<Vec<_>, _>>()?
    } else {
        builder
            .blocking_pick_file()
            .map(|entry| {
                entry
                    .into_path()
                    .map(|path| vec![path.display().to_string()])
                    .map_err(|error| error.to_string())
            })
            .transpose()?
            .unwrap_or_default()
    };

    Ok(selected)
}

#[tauri::command]
fn list_layout_files(state: State<'_, RuntimeState>) -> Result<Vec<SavedLayoutFile>, String> {
    let paths = with_paths(&state)?;
    let root = layouts_root(&paths);
    ensure_directory(&root)?;

    let mut files: Vec<SavedLayoutFile> = fs::read_dir(&root)
        .map_err(|error| error.to_string())?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            let extension = path.extension()?.to_string_lossy().to_lowercase();
            if extension != "json" {
                return None;
            }
            let display_name = path.file_name()?.to_string_lossy().to_string();
            let text = fs::read_to_string(&path).ok()?;
            let payload: Value = serde_json::from_str(strip_utf8_bom(&text)).ok()?;
            let saved_at = payload
                .get("SavedAt")
                .and_then(Value::as_str)
                .map(|value| value.to_string());
            let panel_count = payload
                .get("PanelPopouts")
                .and_then(Value::as_array)
                .map(|entries| entries.len())
                .unwrap_or(0);
            let tool_count = payload
                .get("ToolPopouts")
                .and_then(Value::as_array)
                .map(|entries| entries.len())
                .unwrap_or(0);
            let modified_at = entry
                .metadata()
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(system_time_string);

            Some(SavedLayoutFile {
                name: path
                    .file_stem()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_else(|| display_name.clone()),
                display_name,
                path: path.display().to_string(),
                details: format!("Panels {}  Tools {}", panel_count, tool_count),
                saved_at,
                modified_at,
            })
        })
        .collect();

    files.sort_by(|left, right| right.modified_at.cmp(&left.modified_at));
    Ok(files)
}

#[tauri::command]
fn load_layout_snapshot(state: State<'_, RuntimeState>, path: String) -> Result<Value, String> {
    let _paths = with_paths(&state)?;
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(strip_utf8_bom(&text)).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_layout_snapshot(
    state: State<'_, RuntimeState>,
    suggested_name: Option<String>,
    snapshot: Value,
) -> Result<String, String> {
    let paths = with_paths(&state)?;
    let root = layouts_root(&paths);
    ensure_directory(&root)?;

    let base_name = suggested_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(sanitize_layout_name)
        .unwrap_or_else(|| {
            format!(
                "layout-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|duration| duration.as_secs().to_string())
                    .unwrap_or_else(|_| "now".to_string())
            )
        });
    let file_name = if base_name.to_lowercase().ends_with(".flowlayout.json") {
        base_name
    } else {
        format!("{}.flowlayout.json", base_name)
    };
    let path = root.join(file_name);
    let rendered = serde_json::to_string_pretty(&snapshot).map_err(|error| error.to_string())?;
    fs::write(&path, rendered).map_err(|error| error.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn list_recorded_macros(state: State<'_, RuntimeState>) -> Result<Vec<RecordedMacroChoice>, String> {
    let paths = with_paths(&state)?;
    let root = recorded_actions_root(&paths);
    let mut macros: Vec<RecordedMacroChoice> = list_recorded_macro_paths(&root)?
        .into_iter()
        .filter_map(|path| parse_recorded_macro_definition(&path, false).ok())
        .map(|definition| RecordedMacroChoice {
            id: definition.id,
            label: definition.label,
            path: definition.path,
            created_at: definition.created_at,
        })
        .collect();

    macros.sort_by(|left, right| left.label.to_lowercase().cmp(&right.label.to_lowercase()));
    Ok(macros)
}

#[tauri::command]
fn create_recorded_macro_draft(
    state: State<'_, RuntimeState>,
    label: Option<String>,
) -> Result<RecordedMacroDefinition, String> {
    let paths = with_paths(&state)?;
    let normalized_label = label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("New Macro");
    let action_id = build_recorded_action_id(normalized_label);
    let path = recorded_actions_root(&paths)
        .join(format!("{}.ini", sanitize_macro_file_token(&action_id)));

    Ok(RecordedMacroDefinition {
        path: path.display().to_string(),
        file_name: path
            .file_stem()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default(),
        id: action_id,
        label: normalized_label.to_string(),
        created_at: default_recorded_macro_created_at(),
        steps: Vec::new(),
    })
}

#[tauri::command]
fn load_recorded_macro(
    state: State<'_, RuntimeState>,
    action_id: String,
) -> Result<RecordedMacroDefinition, String> {
    let paths = with_paths(&state)?;
    let root = recorded_actions_root(&paths);
    let path = find_recorded_macro_path_by_id(&root, action_id.trim())?
        .ok_or_else(|| format!("Recorded macro not found: {}", action_id.trim()))?;
    parse_recorded_macro_definition(&path, true)
}

#[tauri::command]
fn save_recorded_macro(
    state: State<'_, RuntimeState>,
    definition: RecordedMacroDefinition,
) -> Result<RecordedMacroDefinition, String> {
    let paths = with_paths(&state)?;
    let root = recorded_actions_root(&paths);
    let saved = write_recorded_macro_definition(&root, &definition)?;
    write_frontend_log(
        &paths,
        &format!("Saved recorded macro. Id={}; Label={}", saved.id, saved.label),
    )?;
    Ok(saved)
}

#[tauri::command]
fn delete_recorded_macro(
    state: State<'_, RuntimeState>,
    action_id: String,
) -> Result<String, String> {
    let paths = with_paths(&state)?;
    let root = recorded_actions_root(&paths);
    let normalized_action_id = action_id.trim();
    if normalized_action_id.is_empty() {
        return Err("Choose a recorded macro first.".to_string());
    }

    let path = find_recorded_macro_path_by_id(&root, normalized_action_id)?
        .ok_or_else(|| format!("Recorded macro not found: {}", normalized_action_id))?;
    let definition = parse_recorded_macro_definition(&path, false)?;
    move_file_to_recycle_bin(&path)?;

    let bindings_file = bindings_path(&paths);
    let mut config = parse_bindings_config(&bindings_file)?;
    let removed_binding = config.action_hotkeys.remove(normalized_action_id).is_some();
    if removed_binding {
        write_bindings_config(&bindings_file, &config)?;
        restart_headless_backend(&paths)?;
    }

    let message = if removed_binding {
        format!(
            "Recycled macro {} and cleared its shortcut binding.",
            definition.label
        )
    } else {
        format!("Recycled macro {}.", definition.label)
    };

    write_frontend_log(
        &paths,
        &format!("Deleted recorded macro. Id={}; Label={}", definition.id, definition.label),
    )?;
    Ok(message)
}

#[tauri::command]
fn record_macro(
    state: State<'_, RuntimeState>,
    label: String,
) -> Result<RecordedMacroDefinition, String> {
    let paths = with_paths(&state)?;
    let normalized_label = label.trim();
    if normalized_label.is_empty() {
        return Err("Enter a macro name first.".to_string());
    }

    let helper_path = paths.flowcell_root.join("helpers").join("RecordMacro.ahk");
    if !helper_path.exists() {
        return Err("helpers\\RecordMacro.ahk was not found.".to_string());
    }

    let ahk_exe = find_autohotkey_exe(&paths)?;
    let action_id = build_recorded_action_id(normalized_label);
    let output_path = recorded_actions_root(&paths)
        .join(format!("{}.ini", sanitize_macro_file_token(&action_id)));

    let output = Command::new(ahk_exe)
        .args([
            "/ErrorStdOut",
            &helper_path.display().to_string(),
            &format!("--out={}", output_path.display()),
            &format!("--name={}", normalized_label),
            &format!("--id={}", action_id),
        ])
        .current_dir(helper_path.parent().unwrap_or(paths.flowcell_root.as_path()))
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| error.to_string())?;

    match output.status.code().unwrap_or(1) {
        0 => {
            let definition = parse_recorded_macro_definition(&output_path, true)?;
            write_frontend_log(
                &paths,
                &format!("Recorded macro saved. Id={}; Label={}", definition.id, definition.label),
            )?;
            Ok(definition)
        }
        2 => Err("Macro recording was cancelled.".to_string()),
        3 => Err("Macro recording ended before any steps were saved.".to_string()),
        _ => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(if stderr.is_empty() {
                "Macro recording failed.".to_string()
            } else {
                stderr
            })
        }
    }
}

#[tauri::command]
fn run_recorded_macro(
    state: State<'_, RuntimeState>,
    action_id: String,
) -> Result<String, String> {
    let paths = with_paths(&state)?;
    let normalized_action_id = action_id.trim();
    if normalized_action_id.is_empty() {
        return Err("Choose a recorded macro first.".to_string());
    }

    let ahk_exe = find_autohotkey_exe(&paths)?;
    let backend_path = paths.flowcell_root.join("FlowCellBackend.ahk");
    if !backend_path.exists() {
        return Err("FlowCellBackend.ahk was not found.".to_string());
    }

    let status_path = last_action_status_path(&paths);
    let _ = fs::remove_file(&status_path);

    let output = Command::new(ahk_exe)
        .args([
            "/ErrorStdOut",
            &backend_path.display().to_string(),
            &format!("--run-action={}", normalized_action_id),
        ])
        .current_dir(&paths.flowcell_root)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| error.to_string())?;

    let status_text = read_text_file(&status_path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(status_text
            .or_else(|| (!stderr.is_empty()).then_some(stderr))
            .unwrap_or_else(|| "Recorded macro run failed.".to_string()));
    }

    Ok(status_text.unwrap_or_else(|| {
        format!("Ran recorded macro {}.", normalized_action_id)
    }))
}

#[tauri::command]
fn install_blender_buttons(
    state: State<'_, RuntimeState>,
    selected_paths: Vec<String>,
    panel_name: String,
) -> Result<Value, String> {
    let paths = with_paths(&state)?;
    let installer_path = paths
        .repo_root
        .join("Blender")
        .join("SupportScripts")
        .join("Install-BlenderFlowCellButtons.ps1");

    let mut command = Command::new(powershell_exe());
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            &installer_path.display().to_string(),
            "-PanelName",
            &panel_name,
            "-SelectedPaths",
        ])
        .args(selected_paths.iter().cloned())
        .creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|error| error.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Blender Add Button installer failed.".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let sanitized_stdout = strip_utf8_bom(&stdout).trim();
    serde_json::from_str(sanitized_stdout).map_err(|error| {
        if sanitized_stdout.is_empty() {
            "Blender Add Button installer returned no JSON output.".to_string()
        } else {
            format!(
                "{}. Raw installer output: {}",
                error,
                sanitized_stdout.chars().take(240).collect::<String>()
            )
        }
    })
}

#[tauri::command]
fn delete_blender_button(
    state: State<'_, RuntimeState>,
    button_target: String,
) -> Result<Value, String> {
    let paths = with_paths(&state)?;
    let remover_path = paths
        .repo_root
        .join("Blender")
        .join("SupportScripts")
        .join("Remove-BlenderFlowCellButton.ps1");

    let mut command = Command::new(powershell_exe());
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            &remover_path.display().to_string(),
            "-ButtonTarget",
            &button_target,
        ])
        .creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|error| error.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Blender button delete cleanup failed.".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let sanitized_stdout = strip_utf8_bom(&stdout).trim();
    serde_json::from_str(sanitized_stdout).map_err(|error| {
        if sanitized_stdout.is_empty() {
            "Blender button delete cleanup returned no JSON output.".to_string()
        } else {
            format!(
                "{}. Raw delete output: {}",
                error,
                sanitized_stdout.chars().take(240).collect::<String>()
            )
        }
    })
}

#[tauri::command]
fn open_panel_popout(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    program_id: i64,
    panel_id: String,
    panel_name: String,
    bounds: Option<FlowCellBounds>,
) -> Result<(), String> {
    let label = format!("popout-panel-{}", sanitize_token(&panel_id));

    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    {
        let mut contexts = state
            .window_contexts
            .lock()
            .map_err(|_| "Window context lock failed.".to_string())?;
        contexts.insert(
            label.clone(),
            WindowContext {
                kind: "panel-popout".to_string(),
                program_id: Some(program_id),
                panel_id: Some(panel_id.clone()),
                panel_name: Some(panel_name.clone()),
                ..WindowContext::default()
            },
        );
    }

    let config = clone_popout_window_config(
        &app,
        label,
        format!("FlowCell - {}", panel_name),
        860.0,
        520.0,
        bounds,
    )?;

    WebviewWindowBuilder::from_config(&app, &config)
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn close_panel_popout(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    panel_id: String,
) -> Result<(), String> {
    let label = format!("popout-panel-{}", sanitize_token(&panel_id));
    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(|error| error.to_string())?;
    }
    let mut contexts = state
        .window_contexts
        .lock()
        .map_err(|_| "Window context lock failed.".to_string())?;
    contexts.remove(&label);
    Ok(())
}

#[tauri::command]
fn open_tool_popout(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    program_id: i64,
    panel_id: String,
    panel_name: String,
    owner_button_id: String,
    button_ids: Vec<String>,
    layout_mode: String,
    button_label: String,
    bounds: Option<FlowCellBounds>,
) -> Result<(), String> {
    let paths = with_paths(&state)?;
    let label = build_tool_popout_label(program_id, &panel_id, &owner_button_id);

    if let Some(window) = app.get_webview_window(&label) {
        let _ = write_frontend_log(
            &paths,
            &format!(
                "Closing existing tool popout before reopen. Label={}; Owner={}; Layout={}",
                label, owner_button_id, layout_mode
            ),
        );
        window.close().map_err(|error| error.to_string())?;
        let mut contexts = state
            .window_contexts
            .lock()
            .map_err(|_| "Window context lock failed.".to_string())?;
        contexts.remove(&label);
    }

    {
        let mut contexts = state
            .window_contexts
            .lock()
            .map_err(|_| "Window context lock failed.".to_string())?;
        contexts.insert(
            label.clone(),
            WindowContext {
                kind: "tool-popout".to_string(),
                program_id: Some(program_id),
                panel_id: Some(panel_id.clone()),
                panel_name: Some(panel_name),
                owner_button_id: Some(owner_button_id.clone()),
                button_ids: Some(button_ids.clone()),
                layout_mode: Some(layout_mode.clone()),
                button_label: Some(button_label.clone()),
            },
        );
    }

    let _ = write_frontend_log(
        &paths,
        &format!(
            "Creating tool popout window. Label={}; PanelId={}; Owner={}; Buttons={:?}; Layout={}",
            label, panel_id, owner_button_id, button_ids, layout_mode
        ),
    );

    let config = clone_popout_window_config(
        &app,
        label,
        format!("FlowCell - {}", button_label),
        520.0,
        360.0,
        bounds,
    )?;

    WebviewWindowBuilder::from_config(&app, &config)
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn emit_command(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    envelope: FlowCellCommandEnvelope,
) -> GatewayCommandResult {
    match with_paths(&state) {
        Ok(paths) => emit_command_impl(&paths, window.label(), envelope),
        Err(error) => failure_result(
            request_id_from_envelope(&envelope),
            error,
            json!({}),
            vec![],
            -1,
            0,
        ),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(RuntimeState::default())
        .setup(|app| {
            let paths =
                build_paths().map_err(|error| -> Box<dyn std::error::Error> { error.into() })?;
            let state = app.state::<RuntimeState>();

            {
                let mut path_slot = state
                    .paths
                    .lock()
                    .map_err(|_| "Runtime path lock failed.")?;
                *path_slot = Some(paths);
            }

            {
                let mut contexts = state
                    .window_contexts
                    .lock()
                    .map_err(|_| "Window context lock failed.")?;
                contexts.insert(
                    "main".to_string(),
                    WindowContext {
                        kind: "main".to_string(),
                        ..WindowContext::default()
                    },
                );
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            save_button_binding,
            clear_button_binding,
            get_window_context,
            log_frontend_event,
            get_foreground_process_info,
            show_open_file_dialog,
            list_layout_files,
            load_layout_snapshot,
            save_layout_snapshot,
            list_recorded_macros,
            create_recorded_macro_draft,
            load_recorded_macro,
            save_recorded_macro,
            delete_recorded_macro,
            record_macro,
            run_recorded_macro,
            install_blender_buttons,
            delete_blender_button,
            open_panel_popout,
            close_panel_popout,
            open_tool_popout,
            emit_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
