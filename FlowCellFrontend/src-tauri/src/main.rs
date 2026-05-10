#![cfg_attr(windows, windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
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

fn read_ini_value(path: &Path, key: &str) -> Option<String> {
    let prefix = format!("{}=", key);
    fs::read_to_string(path)
        .ok()?
        .lines()
        .find_map(|line| line.strip_prefix(&prefix).map(|value| value.trim().to_string()))
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
    })
}

#[tauri::command]
fn save_state(state: State<'_, RuntimeState>, next_state: Value) -> Result<(), String> {
    let paths = with_paths(&state)?;
    let rendered = serde_json::to_string_pretty(&next_state).map_err(|error| error.to_string())?;
    fs::write(state_path(&paths), rendered).map_err(|error| error.to_string())
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
    ensure_directory(&root)?;

    let mut macros: Vec<RecordedMacroChoice> = fs::read_dir(&root)
        .map_err(|error| error.to_string())?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .map(|extension| extension.to_string_lossy().eq_ignore_ascii_case("ini"))
                .unwrap_or(false)
        })
        .filter_map(|path| {
            let id = read_ini_value(&path, "Id")?;
            let label = read_ini_value(&path, "Label")?;
            let created_at = read_ini_value(&path, "CreatedAt");
            Some(RecordedMacroChoice {
                id,
                label,
                path: path.display().to_string(),
                created_at,
            })
        })
        .collect();

    macros.sort_by(|left, right| left.label.to_lowercase().cmp(&right.label.to_lowercase()));
    Ok(macros)
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
        .creation_flags(CREATE_NO_WINDOW)
        ;
    let output = command
        .output()
        .map_err(|error| error.to_string())?;

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
            get_window_context,
            log_frontend_event,
            get_foreground_process_info,
            show_open_file_dialog,
            list_layout_files,
            load_layout_snapshot,
            save_layout_snapshot,
            list_recorded_macros,
            install_blender_buttons,
            open_panel_popout,
            close_panel_popout,
            open_tool_popout,
            emit_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
