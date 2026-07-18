use crate::*;

pub(crate) static BLENDER_BRIDGE_REQUEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PanelScriptChildRecord {
    pub(crate) slot: String,
    pub(crate) label: String,
    pub(crate) tooltip: String,
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PanelButtonEventActionRecord {
    #[serde(rename = "type", default, skip_serializing_if = "String::is_empty")]
    pub(crate) action_type: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(crate) action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) data: Option<Value>,
}

pub(crate) type PanelButtonEventsRecord = BTreeMap<String, PanelButtonEventActionRecord>;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PanelScriptFileRecord {
    pub(crate) file_name: String,
    pub(crate) label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) tooltip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) execution_target: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) bridge_action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) bridge_data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) events: Option<PanelButtonEventsRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) children: Option<Vec<PanelScriptChildRecord>>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BlenderAutomationConfig {
    #[serde(default)]
    pub(crate) bridge_folder: String,
    pub(crate) response_timeout_seconds: Option<u64>,
    #[serde(default)]
    pub(crate) custom_actions_file_name: String,
    #[serde(default)]
    pub(crate) addon_actions_file_name: String,
    #[serde(default)]
    pub(crate) addon_bridge_file_name: String,
    #[serde(default)]
    pub(crate) addon_display_name: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BlenderBridgeConfigFile {
    #[serde(default)]
    pub(crate) automation: BlenderAutomationConfig,
}

pub(crate) fn write_last_action_status_message(message: &str) {
    let Ok(local_root) = resolve_flowcell_local_root() else {
        return;
    };
    let status_path = local_root.join("logs").join("last_action_status.txt");
    if let Some(parent) = status_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(status_path, message);
}

pub(crate) fn resolve_blender_config_path() -> Result<PathBuf, String> {
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

pub(crate) fn read_blender_bridge_config() -> Result<BlenderAutomationConfig, String> {
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

pub(crate) fn resolve_blender_bridge_leaf_name(config: &BlenderAutomationConfig) -> String {
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

pub(crate) fn resolve_blender_bridge_root(config: &BlenderAutomationConfig) -> Option<PathBuf> {
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

pub(crate) fn resolve_blender_bridge_runtime_status_file_name(bridge_root: &Path) -> &'static str {
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

pub(crate) fn read_blender_bridge_runtime_pid(bridge_root: &Path) -> Option<u32> {
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

pub(crate) fn build_blender_bridge_request_id() -> String {
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

pub(crate) fn wait_for_blender_bridge_response(
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

pub(crate) fn did_blender_bridge_response_succeed(response: &Value) -> bool {
    let normalized_status = response
        .get("status")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    normalized_status.is_empty()
        || matches!(normalized_status.as_str(), "ok" | "finished" | "success")
}

pub(crate) fn extract_blender_bridge_response_message(response: &Value) -> String {
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

pub(crate) fn normalize_panel_button_event_name(name: &str) -> Option<String> {
    let normalized = name
        .trim()
        .replace(['_', '-', ' '], "")
        .to_ascii_lowercase();
    match normalized.as_str() {
        "click" => Some("click".to_string()),
        "doubleclick" => Some("doubleClick".to_string()),
        "contextmenu" | "rightclick" => Some("contextMenu".to_string()),
        "hoverenter" | "pointerenter" | "mouseenter" => Some("hoverEnter".to_string()),
        "hoverleave" | "pointerleave" | "mouseleave" => Some("hoverLeave".to_string()),
        "pressdown" | "pointerdown" | "mousedown" => Some("pressDown".to_string()),
        "pressup" | "pointerup" | "mouseup" | "pointercancel" | "mousecancel" => {
            Some("pressUp".to_string())
        }
        "focus" => Some("focus".to_string()),
        "blur" => Some("blur".to_string()),
        _ => None,
    }
}

pub(crate) fn resolve_flowcell_backend_script_path() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root().ok_or_else(|| {
        "FlowCell repo root could not be resolved for backend execution.".to_string()
    })?;
    let backend_script_path = repo_root
        .join("flowcellbackend")
        .join("FlowCellBackend.ahk");
    if backend_script_path.is_file() {
        Ok(backend_script_path)
    } else {
        Err(format!(
            "FlowCell backend adapter was not found at {}.",
            backend_script_path.display()
        ))
    }
}

pub(crate) fn resolve_flowcell_command_backend_script_path() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root().ok_or_else(|| {
        "FlowCell repo root could not be resolved for command backend execution.".to_string()
    })?;
    let backend_path = repo_root
        .join("flowcellbackend")
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

pub(crate) fn resolve_flowcell_backend_launcher_path() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root().ok_or_else(|| {
        "FlowCell repo root could not be resolved for backend launch.".to_string()
    })?;
    let launcher_path = repo_root
        .join("flowcellbackend")
        .join("run_backend_hidden.vbs");
    if launcher_path.is_file() {
        Ok(launcher_path)
    } else {
        Err(format!(
            "FlowCell backend launcher was not found at {}.",
            launcher_path.display()
        ))
    }
}

pub(crate) fn resolve_flowcell_autohotkey_exe_path() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root()
        .ok_or_else(|| "FlowCell repo root could not be resolved for AutoHotkey.".to_string())?;
    let flowcell_root = repo_root.join("flowcellbackend");
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

pub(crate) fn read_last_action_status_message() -> Option<String> {
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

pub(crate) fn append_flowcell_local_log(file_name: &str, message: &str) {
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

pub(crate) fn build_flowcell_controller_script_command(
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
pub(crate) fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
pub(crate) fn find_flowcell_direct_script_receiver() -> HWND {
    let class_name = wide_null(FLOWCELL_DIRECT_SCRIPT_RECEIVER_CLASS);
    let title = wide_null(FLOWCELL_DIRECT_SCRIPT_RECEIVER_TITLE);
    unsafe { FindWindowW(class_name.as_ptr(), title.as_ptr()) }
}

#[cfg(windows)]
pub(crate) fn wait_for_flowcell_direct_script_receiver(timeout: Duration) -> HWND {
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
pub(crate) fn send_flowcell_direct_script_copydata(
    hwnd: HWND,
    payload: &str,
) -> Result<usize, String> {
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

pub(crate) fn run_illustrator_backend_script_direct(
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

pub(crate) fn clear_last_action_status_file() -> Result<(), String> {
    let status_path = resolve_flowcell_local_root()?
        .join("logs")
        .join("last_action_status.txt");
    let _ = fs::remove_file(&status_path);
    Ok(())
}

pub(crate) fn run_flowcell_controller_script(
    script_path: &Path,
    program_key: &str,
) -> Result<String, String> {
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

pub(crate) fn run_flowcell_macro_action(action_id: &str) -> Result<String, String> {
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

pub(crate) fn resolve_macro_recorder_script_path() -> Result<PathBuf, String> {
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

pub(crate) fn record_frontend_macro_to_path(
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

pub(crate) fn restart_flowcell_headless_backend() -> Result<(), String> {
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

pub(crate) fn bootstrap_blender_program(
    program_name: &str,
    exe_path: Option<&str>,
) -> Result<String, String> {
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

pub(crate) fn current_timestamp_string() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:09}Z", now.as_secs(), now.subsec_nanos())
}

pub(crate) fn spawn_via_cmd_start(script_path: &Path) -> Result<(), String> {
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

fn windows_child_process_path(path: &Path) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

pub(crate) fn run_windows_panel_script_file_with_window_mode(
    script_path: &Path,
    hide_window: bool,
) -> Result<(), String> {
    // Installed sources are canonicalized and ownership-checked before this
    // runner receives them. Windows PowerShell 5.1 cannot provider-resolve the
    // resulting verbatim path through $PSScriptRoot, so child processes receive
    // the equivalent ordinary DOS/UNC spelling.
    let launch_path = windows_child_process_path(script_path);
    let script_path = launch_path.as_path();
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
                .arg("-WindowStyle")
                .arg("Hidden")
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

pub(crate) fn run_windows_panel_script_file(script_path: &Path) -> Result<(), String> {
    run_windows_panel_script_file_with_window_mode(script_path, true)
}

pub(crate) fn run_blender_bridge_action_direct(action: &str, data: Value) -> Result<Value, String> {
    run_blender_bridge_action_direct_with_options(action, data, None, false)
}

pub(crate) fn run_blender_bridge_action_direct_with_options(
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

pub(crate) fn run_panel_script_response_impl(
    _app: &AppHandle,
    program_name: String,
    panel_name: String,
    file_name: String,
) -> Result<Value, String> {
    let validated_file_name = validate_panel_script_file_name(&file_name)?;
    if let Some(resolution) = program_sources::execute::resolve_active_source_record(
        &program_name,
        &panel_name,
        &validated_file_name,
    )? {
        return program_sources::execute::run_active_source(&resolution);
    }
    Err(format!(
        "Button source '{}' is not installed in the active Button system. Complete migration before running it.",
        validated_file_name
    ))
}

#[tauri::command]
pub(crate) fn run_panel_script_response(
    app: AppHandle,
    program_name: String,
    panel_name: String,
    file_name: String,
) -> Result<Value, String> {
    run_panel_script_response_impl(&app, program_name, panel_name, file_name)
}

#[tauri::command]
pub(crate) fn run_panel_button_event(
    program_name: String,
    panel_name: String,
    file_name: String,
    event_name: String,
) -> Result<String, String> {
    if let Some(resolution) = program_sources::execute::resolve_active_source_record(
        &program_name,
        &panel_name,
        &file_name,
    )? {
        return program_sources::execute::run_active_button_event(&resolution, &event_name);
    }
    Err(format!(
        "Button source '{}' is not installed in the active Button system. Complete migration before running event '{}'.",
        file_name.trim(),
        event_name.trim()
    ))
}

#[tauri::command]
pub(crate) fn run_toolset_action(
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
    if let Some(resolution) = program_sources::execute::resolve_active_source_record(
        &program_name,
        &panel_name,
        &file_name,
    )? {
        return program_sources::execute::run_active_toolset_action(
            &resolution,
            &normalized_command,
            payload,
        );
    }

    Err(format!(
        "Button source '{}' is not installed in the active Button system. Complete migration before running tool-set command '{}'.",
        file_name.trim(), normalized_command
    ))
}

#[cfg(test)]
mod tests {
    use super::windows_child_process_path;
    use std::path::{Path, PathBuf};

    #[test]
    fn windows_child_process_paths_remove_verbatim_drive_prefixes() {
        assert_eq!(
            windows_child_process_path(Path::new(
                r"\\?\D:\FlowCell\Programs\Windows\Local\owner\source\action.ps1"
            )),
            PathBuf::from(r"D:\FlowCell\Programs\Windows\Local\owner\source\action.ps1")
        );
    }

    #[test]
    fn windows_child_process_paths_convert_verbatim_unc_prefixes() {
        assert_eq!(
            windows_child_process_path(Path::new(
                r"\\?\UNC\server\share\FlowCell\owner\source\action.ps1"
            )),
            PathBuf::from(r"\\server\share\FlowCell\owner\source\action.ps1")
        );
    }

    #[test]
    fn windows_child_process_paths_preserve_ordinary_paths() {
        let path = Path::new(r"D:\FlowCell\Programs\Windows\action.ps1");
        assert_eq!(windows_child_process_path(path), path);
    }
}
