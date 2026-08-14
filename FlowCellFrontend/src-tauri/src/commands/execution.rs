use crate::*;

#[cfg(windows)]
use windows_sys::Win32::Foundation::{
    ERROR_BROKEN_PIPE, ERROR_IO_PENDING, GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE,
    WAIT_TIMEOUT,
};
#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, WriteFile, FILE_ATTRIBUTE_NORMAL, FILE_FLAG_OVERLAPPED, OPEN_EXISTING,
};
#[cfg(windows)]
use windows_sys::Win32::System::Threading::CreateEventW;
#[cfg(windows)]
use windows_sys::Win32::System::IO::{
    CancelIoEx, GetOverlappedResult, GetOverlappedResultEx, OVERLAPPED,
};

pub(crate) static BLENDER_BRIDGE_REQUEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[cfg(windows)]
const ILLUSTRATOR_BRIDGE_PIPE_PATH: &str = r"\\.\pipe\FlowCell.Illustrator.Bridge.v2";
#[cfg(windows)]
const ILLUSTRATOR_BRIDGE_PROTOCOL_VERSION: u64 = 2;
#[cfg(windows)]
const ILLUSTRATOR_BRIDGE_STARTUP_WAIT_MS: u64 = 4_000;
#[cfg(windows)]
const ILLUSTRATOR_BRIDGE_ACTION_WAIT_MS: u64 = 25_000;
#[cfg(windows)]
const ILLUSTRATOR_BRIDGE_POLL_MS: u64 = 40;
#[cfg(windows)]
const ILLUSTRATOR_BRIDGE_MAX_RESPONSE_BYTES: usize = 1024 * 1024;
#[cfg(windows)]
const ILLUSTRATOR_BRIDGE_COMPLETION_RESPONSE_WAIT_MS: u64 = 10 * 60 * 1_000;
#[cfg(windows)]
const ILLUSTRATOR_BRIDGE_READ_BUFFER_BYTES: usize = 8 * 1024;
#[cfg(windows)]
static ILLUSTRATOR_BRIDGE_START_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
#[cfg(windows)]
static ILLUSTRATOR_BRIDGE_PREWARM_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
#[cfg(windows)]
const ILLUSTRATOR_PROCESS_POLL_MS: u64 = 1_000;
#[cfg(windows)]
const WINDOWS_ERROR_PIPE_BUSY: i32 = 231;

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
enum IllustratorBridgeSendFailure {
    Busy(String),
    Unavailable(String),
    Failed(String),
}

#[cfg(windows)]
struct IllustratorBridgeHandle(HANDLE);

#[cfg(windows)]
impl Drop for IllustratorBridgeHandle {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
}

#[cfg(windows)]
#[derive(Debug)]
enum IllustratorBridgeIoFailure {
    BrokenPipe,
    TimedOut,
    Failed(std::io::Error),
}

#[cfg(windows)]
fn illustrator_bridge_response_timeout(request: &Value) -> Duration {
    let command = request
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or("run");
    if command == "ping" {
        return Duration::from_millis(ILLUSTRATOR_BRIDGE_STARTUP_WAIT_MS);
    }
    if command == "run"
        && request
            .get("wait")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return Duration::from_millis(ILLUSTRATOR_BRIDGE_COMPLETION_RESPONSE_WAIT_MS);
    }
    Duration::from_millis(ILLUSTRATOR_BRIDGE_ACTION_WAIT_MS)
}

#[cfg(windows)]
fn open_illustrator_bridge_pipe(
    pipe_path: &str,
) -> Result<IllustratorBridgeHandle, std::io::Error> {
    let mut wide_path = pipe_path.encode_utf16().collect::<Vec<_>>();
    wide_path.push(0);
    let handle = unsafe {
        CreateFileW(
            wide_path.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OVERLAPPED,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(IllustratorBridgeHandle(handle))
    }
}

#[cfg(windows)]
fn create_illustrator_bridge_overlapped(
) -> Result<(IllustratorBridgeHandle, OVERLAPPED), IllustratorBridgeIoFailure> {
    let event = unsafe { CreateEventW(std::ptr::null(), 1, 0, std::ptr::null()) };
    if event.is_null() {
        return Err(IllustratorBridgeIoFailure::Failed(
            std::io::Error::last_os_error(),
        ));
    }
    let event = IllustratorBridgeHandle(event);
    let mut overlapped = unsafe { std::mem::zeroed::<OVERLAPPED>() };
    overlapped.hEvent = event.0;
    Ok((event, overlapped))
}

#[cfg(windows)]
fn illustrator_bridge_io_failure_from_last_error() -> IllustratorBridgeIoFailure {
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(ERROR_BROKEN_PIPE as i32) {
        IllustratorBridgeIoFailure::BrokenPipe
    } else {
        IllustratorBridgeIoFailure::Failed(error)
    }
}

#[cfg(windows)]
fn cancel_illustrator_bridge_io(handle: HANDLE, overlapped: &OVERLAPPED) {
    unsafe {
        let _ = CancelIoEx(handle, overlapped);
        let mut ignored = 0u32;
        let _ = GetOverlappedResult(handle, overlapped, &mut ignored, 1);
    }
}

#[cfg(windows)]
fn complete_illustrator_bridge_io(
    handle: HANDLE,
    overlapped: &OVERLAPPED,
    started: BOOL,
    deadline: Instant,
) -> Result<u32, IllustratorBridgeIoFailure> {
    let mut transferred = 0u32;
    if started != 0 {
        let completed = unsafe { GetOverlappedResult(handle, overlapped, &mut transferred, 0) };
        return if completed != 0 {
            Ok(transferred)
        } else {
            Err(illustrator_bridge_io_failure_from_last_error())
        };
    }

    let start_error = std::io::Error::last_os_error();
    if start_error.raw_os_error() != Some(ERROR_IO_PENDING as i32) {
        return if start_error.raw_os_error() == Some(ERROR_BROKEN_PIPE as i32) {
            Err(IllustratorBridgeIoFailure::BrokenPipe)
        } else {
            Err(IllustratorBridgeIoFailure::Failed(start_error))
        };
    }

    let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
        cancel_illustrator_bridge_io(handle, overlapped);
        return Err(IllustratorBridgeIoFailure::TimedOut);
    };
    let timeout_ms = remaining.as_millis().max(1).min(u32::MAX as u128) as u32;
    let completed =
        unsafe { GetOverlappedResultEx(handle, overlapped, &mut transferred, timeout_ms, 0) };
    if completed != 0 {
        return Ok(transferred);
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(WAIT_TIMEOUT as i32) {
        cancel_illustrator_bridge_io(handle, overlapped);
        Err(IllustratorBridgeIoFailure::TimedOut)
    } else if error.raw_os_error() == Some(ERROR_BROKEN_PIPE as i32) {
        Err(IllustratorBridgeIoFailure::BrokenPipe)
    } else {
        Err(IllustratorBridgeIoFailure::Failed(error))
    }
}

#[cfg(windows)]
fn illustrator_bridge_io_error(
    failure: IllustratorBridgeIoFailure,
    operation: &str,
    request_id: &str,
    timeout: Duration,
) -> IllustratorBridgeSendFailure {
    match failure {
        IllustratorBridgeIoFailure::TimedOut => IllustratorBridgeSendFailure::Failed(format!(
            "Illustrator bridge response timed out after {} seconds for request '{request_id}' while {operation}. The local pipe operation was cancelled; Illustrator may still be completing the action.",
            timeout.as_secs()
        )),
        // The bridge dispatches only after it has read one complete newline-
        // terminated request. A broken pipe during the write therefore did
        // not acknowledge this request and can safely use the existing
        // reconnect/start path. A broken pipe while reading remains terminal:
        // Illustrator may already have performed a mutating action.
        IllustratorBridgeIoFailure::BrokenPipe if operation == "writing the request" => {
            IllustratorBridgeSendFailure::Unavailable(format!(
                "Illustrator bridge closed the pipe while {operation} for request '{request_id}'."
            ))
        }
        IllustratorBridgeIoFailure::BrokenPipe => IllustratorBridgeSendFailure::Failed(format!(
            "Illustrator bridge closed the pipe while {operation} for request '{request_id}'."
        )),
        IllustratorBridgeIoFailure::Failed(error) => IllustratorBridgeSendFailure::Failed(
            format!("Illustrator bridge failed while {operation} for request '{request_id}': {error}"),
        ),
    }
}

#[cfg(windows)]
fn illustrator_bridge_stable_failure_key(error: &str) -> String {
    error
        .split_once(" for request '")
        .map(|(prefix, _)| prefix.to_string())
        .unwrap_or_else(|| error.to_string())
}

#[cfg(windows)]
fn write_illustrator_bridge_request(
    pipe: &IllustratorBridgeHandle,
    request_line: &[u8],
    deadline: Instant,
) -> Result<(), IllustratorBridgeIoFailure> {
    let mut written = 0usize;
    while written < request_line.len() {
        let (_event, mut overlapped) = create_illustrator_bridge_overlapped()?;
        let remaining = &request_line[written..];
        let byte_count = u32::try_from(remaining.len()).map_err(|_| {
            IllustratorBridgeIoFailure::Failed(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Illustrator bridge request is too large.",
            ))
        })?;
        let started = unsafe {
            WriteFile(
                pipe.0,
                remaining.as_ptr(),
                byte_count,
                std::ptr::null_mut(),
                &mut overlapped,
            )
        };
        let transferred = complete_illustrator_bridge_io(pipe.0, &overlapped, started, deadline)?;
        if transferred == 0 {
            return Err(IllustratorBridgeIoFailure::Failed(std::io::Error::new(
                std::io::ErrorKind::WriteZero,
                "Illustrator bridge accepted no request bytes.",
            )));
        }
        written += transferred as usize;
    }
    Ok(())
}

#[cfg(windows)]
fn read_illustrator_bridge_response(
    pipe: &IllustratorBridgeHandle,
    deadline: Instant,
) -> Result<String, IllustratorBridgeIoFailure> {
    let mut response = Vec::<u8>::new();
    loop {
        if response.len() > ILLUSTRATOR_BRIDGE_MAX_RESPONSE_BYTES {
            return Err(IllustratorBridgeIoFailure::Failed(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!(
                    "Illustrator bridge response exceeded {ILLUSTRATOR_BRIDGE_MAX_RESPONSE_BYTES} bytes."
                ),
            )));
        }
        let remaining_capacity = ILLUSTRATOR_BRIDGE_MAX_RESPONSE_BYTES + 1 - response.len();
        let mut buffer = [0u8; ILLUSTRATOR_BRIDGE_READ_BUFFER_BYTES];
        let read_capacity = remaining_capacity.min(buffer.len());
        let (_event, mut overlapped) = create_illustrator_bridge_overlapped()?;
        let started = unsafe {
            ReadFile(
                pipe.0,
                buffer.as_mut_ptr(),
                read_capacity as u32,
                std::ptr::null_mut(),
                &mut overlapped,
            )
        };
        let transferred =
            match complete_illustrator_bridge_io(pipe.0, &overlapped, started, deadline) {
                Ok(transferred) => transferred as usize,
                Err(IllustratorBridgeIoFailure::BrokenPipe) if !response.is_empty() => break,
                Err(failure) => return Err(failure),
            };
        if transferred == 0 {
            break;
        }
        response.extend_from_slice(&buffer[..transferred]);
        if let Some(line_end) = response.iter().position(|byte| *byte == b'\n') {
            response.truncate(line_end);
            break;
        }
    }
    if response.len() > ILLUSTRATOR_BRIDGE_MAX_RESPONSE_BYTES {
        return Err(IllustratorBridgeIoFailure::Failed(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "Illustrator bridge response exceeded {ILLUSTRATOR_BRIDGE_MAX_RESPONSE_BYTES} bytes."
            ),
        )));
    }
    String::from_utf8(response).map_err(|error| {
        IllustratorBridgeIoFailure::Failed(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("Illustrator bridge response was not valid UTF-8: {error}"),
        ))
    })
}

#[cfg(windows)]
fn parse_illustrator_bridge_response(raw: &str, request: &Value) -> Result<Value, String> {
    let request_id = request
        .get("requestId")
        .and_then(Value::as_str)
        .ok_or_else(|| "Illustrator bridge request is missing requestId.".to_string())?;
    let response = serde_json::from_str::<Value>(raw.trim())
        .map_err(|error| format!("Illustrator bridge returned invalid JSON: {error}"))?;
    let protocol_version = response
        .get("protocolVersion")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    if protocol_version != ILLUSTRATOR_BRIDGE_PROTOCOL_VERSION {
        return Err(format!(
            "Illustrator bridge protocol mismatch: expected {ILLUSTRATOR_BRIDGE_PROTOCOL_VERSION}, received {protocol_version}."
        ));
    }
    if !response.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        return Err(response
            .get("error")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("Illustrator bridge rejected the action.")
            .to_string());
    }
    let response_id = response
        .get("requestId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if response_id != request_id {
        return Err(format!(
            "Illustrator bridge response did not match request '{request_id}'."
        ));
    }
    let is_async_run = request
        .get("command")
        .and_then(Value::as_str)
        .is_some_and(|value| value == "run")
        && !request
            .get("wait")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    if is_async_run
        && !response
            .get("accepted")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return Err("Illustrator bridge did not acknowledge the action as accepted.".to_string());
    }
    Ok(response)
}

#[cfg(windows)]
fn try_send_illustrator_bridge_request(
    request: &Value,
) -> Result<Value, IllustratorBridgeSendFailure> {
    let request_id = request
        .get("requestId")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            IllustratorBridgeSendFailure::Failed(
                "Illustrator bridge request is missing requestId.".to_string(),
            )
        })?;
    let pipe = open_illustrator_bridge_pipe(ILLUSTRATOR_BRIDGE_PIPE_PATH).map_err(|error| {
        let message = format!("Illustrator bridge pipe is unavailable: {error}");
        if error.raw_os_error() == Some(WINDOWS_ERROR_PIPE_BUSY) {
            IllustratorBridgeSendFailure::Busy(message)
        } else {
            IllustratorBridgeSendFailure::Unavailable(message)
        }
    })?;
    let response_timeout = illustrator_bridge_response_timeout(request);
    let deadline = Instant::now() + response_timeout;
    let mut request_line = serde_json::to_string(request).map_err(|error| {
        IllustratorBridgeSendFailure::Failed(format!(
            "Failed to encode Illustrator bridge request: {error}"
        ))
    })?;
    request_line.push('\n');
    write_illustrator_bridge_request(&pipe, request_line.as_bytes(), deadline).map_err(
        |failure| {
            illustrator_bridge_io_error(
                failure,
                "writing the request",
                request_id,
                response_timeout,
            )
        },
    )?;
    let response = read_illustrator_bridge_response(&pipe, deadline).map_err(|failure| {
        illustrator_bridge_io_error(
            failure,
            "waiting for the response",
            request_id,
            response_timeout,
        )
    })?;
    parse_illustrator_bridge_response(&response, request)
        .map_err(IllustratorBridgeSendFailure::Failed)
}

#[cfg(windows)]
fn process_id_is_alive(process_id: u32) -> bool {
    if process_id == 0 {
        return false;
    }
    let process_handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if process_handle.is_null() {
        return false;
    }
    unsafe {
        let _ = CloseHandle(process_handle);
    }
    true
}

#[cfg(windows)]
struct IllustratorProcessWindowSearch {
    process_id: u32,
}

#[cfg(windows)]
unsafe extern "system" fn enum_illustrator_process_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    if hwnd.is_null() || (IsWindowVisible(hwnd) == 0 && IsIconic(hwnd) == 0) {
        return 1;
    }

    let mut process_id = 0u32;
    GetWindowThreadProcessId(hwnd, &mut process_id);
    let Some(process_path) = query_process_path_by_id(process_id) else {
        return 1;
    };
    let process_name = Path::new(&process_path)
        .file_name()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if process_name != "illustrator.exe" && process_name != "illustrator" {
        return 1;
    }

    let search = &mut *(lparam as *mut IllustratorProcessWindowSearch);
    search.process_id = process_id;
    0
}

#[cfg(windows)]
fn find_running_illustrator_process_id() -> Option<u32> {
    let mut search = IllustratorProcessWindowSearch { process_id: 0 };
    unsafe {
        EnumWindows(
            Some(enum_illustrator_process_window),
            &mut search as *mut IllustratorProcessWindowSearch as LPARAM,
        );
    }
    (search.process_id != 0).then_some(search.process_id)
}

#[cfg(windows)]
fn spawn_illustrator_bridge_process() -> Result<(), String> {
    let repo_root = resolve_repo_root()
        .ok_or_else(|| "FlowCell repo root could not be resolved for Illustrator.".to_string())?;
    let bridge_script = repo_root
        .join("Programs")
        .join("Illustrator")
        .join("SupportScripts")
        .join("Start-IllustratorFlowCellBridge.ps1");
    if !bridge_script.is_file() {
        return Err(format!(
            "Illustrator bridge script was not found at {}.",
            bridge_script.display()
        ));
    }
    let launch_script = windows_child_process_path(&bridge_script);
    let launch_root = windows_child_process_path(&repo_root);
    let mut command = Command::new(resolve_powershell_path());
    command
        .arg("-NoLogo")
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Sta")
        .arg("-File")
        .arg(&launch_script)
        .arg("-RepoRoot")
        .arg(&launch_root)
        .arg("-NoPrewarm")
        .current_dir(launch_script.parent().unwrap_or_else(|| Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to start Illustrator bridge: {error}"))
}

#[cfg(windows)]
fn wait_for_illustrator_bridge_request(
    request: &Value,
    timeout: Duration,
) -> Result<Value, String> {
    let started = Instant::now();
    loop {
        let unavailable = match try_send_illustrator_bridge_request(request) {
            Ok(response) => return Ok(response),
            Err(IllustratorBridgeSendFailure::Failed(error)) => return Err(error),
            Err(IllustratorBridgeSendFailure::Busy(error))
            | Err(IllustratorBridgeSendFailure::Unavailable(error)) => error,
        };
        if started.elapsed() >= timeout {
            return Err(format!(
                "Illustrator bridge did not become ready. {unavailable}"
            ));
        }
        thread::sleep(Duration::from_millis(ILLUSTRATOR_BRIDGE_POLL_MS));
    }
}

#[cfg(windows)]
fn illustrator_bridge_ping_request() -> Value {
    json!({
        "command": "ping",
        "requestId": format!("illustrator-bridge-ping-{}", current_precise_timestamp_token())
    })
}

#[cfg(windows)]
pub(crate) fn ensure_illustrator_bridge_started() -> Result<(), String> {
    match try_send_illustrator_bridge_request(&illustrator_bridge_ping_request()) {
        Ok(_) => return Ok(()),
        Err(IllustratorBridgeSendFailure::Failed(error)) => return Err(error),
        Err(IllustratorBridgeSendFailure::Busy(_)) => return Ok(()),
        Err(IllustratorBridgeSendFailure::Unavailable(_)) => {}
    }
    let start_lock = ILLUSTRATOR_BRIDGE_START_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = start_lock
        .lock()
        .map_err(|_| "Illustrator bridge start lock is unavailable.".to_string())?;
    match try_send_illustrator_bridge_request(&illustrator_bridge_ping_request()) {
        Ok(_) => return Ok(()),
        Err(IllustratorBridgeSendFailure::Failed(error)) => return Err(error),
        Err(IllustratorBridgeSendFailure::Busy(_)) => return Ok(()),
        Err(IllustratorBridgeSendFailure::Unavailable(_)) => {}
    }
    spawn_illustrator_bridge_process()?;
    wait_for_illustrator_bridge_request(
        &illustrator_bridge_ping_request(),
        Duration::from_millis(ILLUSTRATOR_BRIDGE_STARTUP_WAIT_MS),
    )?;
    append_flowcell_local_log(
        "command_host.log",
        "Started persistent Illustrator bridge for native Button dispatch.",
    );
    Ok(())
}

#[cfg(windows)]
struct IllustratorBridgePrewarmGuard;

#[cfg(windows)]
impl Drop for IllustratorBridgePrewarmGuard {
    fn drop(&mut self) {
        ILLUSTRATOR_BRIDGE_PREWARM_IN_PROGRESS.store(false, Ordering::Release);
    }
}

#[cfg(windows)]
fn prewarm_illustrator_bridge(illustrator_process_id: u32) -> Result<u32, String> {
    ILLUSTRATOR_BRIDGE_PREWARM_IN_PROGRESS.store(true, Ordering::Release);
    let _prewarm_guard = IllustratorBridgePrewarmGuard;
    ensure_illustrator_bridge_started()?;

    let request = json!({
        "command": "prewarm",
        "requestId": format!("illustrator-bridge-prewarm-{}", current_precise_timestamp_token()),
        "illustratorProcessId": illustrator_process_id
    });
    let response = match try_send_illustrator_bridge_request(&request) {
        Ok(response) => response,
        Err(IllustratorBridgeSendFailure::Failed(error)) => return Err(error),
        Err(IllustratorBridgeSendFailure::Busy(_))
        | Err(IllustratorBridgeSendFailure::Unavailable(_)) => wait_for_illustrator_bridge_request(
            &request,
            Duration::from_millis(ILLUSTRATOR_BRIDGE_ACTION_WAIT_MS),
        )?,
    };
    let bridge_process_id = response
        .get("pid")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| "Illustrator bridge prewarm returned no live bridge PID.".to_string())?;
    append_flowcell_local_log(
        "command_host.log",
        &format!(
            "Illustrator COM prewarmed in the persistent bridge. IllustratorPid={illustrator_process_id}; BridgePid={bridge_process_id}"
        ),
    );
    Ok(bridge_process_id)
}

#[cfg(windows)]
pub(crate) fn start_illustrator_bridge_prewarm_worker() {
    thread::spawn(|| {
        let mut warmed_process_pair: Option<(u32, u32)> = None;
        let mut last_error = String::new();
        loop {
            if require_registered_program_name("Illustrator").is_err() {
                warmed_process_pair = None;
                thread::sleep(Duration::from_millis(ILLUSTRATOR_PROCESS_POLL_MS));
                continue;
            }

            let Some(illustrator_process_id) = find_running_illustrator_process_id() else {
                warmed_process_pair = None;
                last_error.clear();
                thread::sleep(Duration::from_millis(ILLUSTRATOR_PROCESS_POLL_MS));
                continue;
            };
            if let Some((warmed_illustrator_process_id, warmed_bridge_process_id)) =
                warmed_process_pair
            {
                if warmed_illustrator_process_id == illustrator_process_id
                    && process_id_is_alive(warmed_bridge_process_id)
                {
                    thread::sleep(Duration::from_millis(ILLUSTRATOR_PROCESS_POLL_MS));
                    continue;
                }
            }

            match prewarm_illustrator_bridge(illustrator_process_id) {
                Ok(warmed_bridge_process_id) => {
                    warmed_process_pair = Some((illustrator_process_id, warmed_bridge_process_id));
                    last_error.clear();
                }
                Err(error) => {
                    warmed_process_pair = None;
                    let error_key = illustrator_bridge_stable_failure_key(&error);
                    if error_key != last_error {
                        append_flowcell_local_log(
                            "command_host.log",
                            &format!(
                                "Illustrator COM could not be prewarmed in the background: {error}"
                            ),
                        );
                        last_error = error_key;
                    }
                }
            }
            thread::sleep(Duration::from_millis(ILLUSTRATOR_PROCESS_POLL_MS));
        }
    });
}

pub(crate) fn run_illustrator_bridge_action_direct(
    script_path: &Path,
    action_id: &str,
    args: Option<Value>,
    wait: bool,
) -> Result<Value, String> {
    if !script_path.is_file() {
        return Err(format!(
            "Script file was not found at {}.",
            script_path.display()
        ));
    }
    if action_id.trim().is_empty() {
        return Err("Illustrator bridge actionId cannot be empty.".to_string());
    }

    #[cfg(windows)]
    {
        let dispatch_started = Instant::now();
        let request_id = format!("illustrator-bridge-{}", current_precise_timestamp_token());
        let mut request = json!({
            "command": "run",
            "requestId": request_id,
            "actionId": action_id.trim(),
            "scriptPath": windows_child_process_path(script_path).display().to_string(),
            "wait": wait
        });
        if let Some(args) = args {
            request
                .as_object_mut()
                .expect("Illustrator bridge request is an object")
                .insert("args".to_string(), args);
        }

        let response = match try_send_illustrator_bridge_request(&request) {
            Ok(response) => response,
            Err(IllustratorBridgeSendFailure::Failed(error)) => return Err(error),
            Err(IllustratorBridgeSendFailure::Busy(_)) => {
                if wait || ILLUSTRATOR_BRIDGE_PREWARM_IN_PROGRESS.load(Ordering::Acquire) {
                    return wait_for_illustrator_bridge_request(
                        &request,
                        Duration::from_millis(ILLUSTRATOR_BRIDGE_ACTION_WAIT_MS),
                    );
                }
                return Err(
                    "Illustrator bridge is already running an action. Nothing was queued; wait for it to finish and click again."
                        .to_string(),
                );
            }
            Err(IllustratorBridgeSendFailure::Unavailable(unavailable)) => {
                let start_lock = ILLUSTRATOR_BRIDGE_START_LOCK.get_or_init(|| Mutex::new(()));
                let _guard = start_lock
                    .lock()
                    .map_err(|_| "Illustrator bridge start lock is unavailable.".to_string())?;
                match try_send_illustrator_bridge_request(&request) {
                    Ok(response) => response,
                    Err(IllustratorBridgeSendFailure::Failed(error)) => return Err(error),
                    Err(IllustratorBridgeSendFailure::Busy(_)) => {
                        if wait || ILLUSTRATOR_BRIDGE_PREWARM_IN_PROGRESS.load(Ordering::Acquire) {
                            drop(_guard);
                            return wait_for_illustrator_bridge_request(
                                &request,
                                Duration::from_millis(ILLUSTRATOR_BRIDGE_ACTION_WAIT_MS),
                            );
                        }
                        return Err(
                            "Illustrator bridge is already running an action. Nothing was queued; wait for it to finish and click again."
                                .to_string(),
                        );
                    }
                    Err(IllustratorBridgeSendFailure::Unavailable(_)) => {
                        spawn_illustrator_bridge_process()?;
                        wait_for_illustrator_bridge_request(
                            &request,
                            Duration::from_millis(ILLUSTRATOR_BRIDGE_STARTUP_WAIT_MS),
                        )
                        .map_err(|error| format!("{error} Initial connection: {unavailable}"))?
                    }
                }
            }
        };
        append_flowcell_local_log(
            "command_host.log",
            &format!(
                "Illustrator action accepted by persistent bridge in {} ms. ActionId={}; Wait={wait}; Script={}",
                dispatch_started.elapsed().as_millis(),
                action_id.trim(),
                script_path.display()
            ),
        );
        Ok(response)
    }

    #[cfg(not(windows))]
    {
        let _ = (script_path, action_id, args, wait);
        Err("Illustrator bridge execution is available only on Windows.".to_string())
    }
}

#[cfg(all(test, windows))]
fn illustrator_bridge_test_response(request_id: &str) -> String {
    json!({
        "ok": true,
        "accepted": true,
        "protocolVersion": ILLUSTRATOR_BRIDGE_PROTOCOL_VERSION,
        "requestId": request_id,
        "actionId": "flowcell_button_test"
    })
    .to_string()
}

#[cfg(all(test, windows))]
mod illustrator_bridge_tests {
    use super::{
        illustrator_bridge_io_error, illustrator_bridge_response_timeout,
        illustrator_bridge_stable_failure_key, illustrator_bridge_test_response,
        open_illustrator_bridge_pipe, parse_illustrator_bridge_response,
        read_illustrator_bridge_response, write_illustrator_bridge_request,
        IllustratorBridgeHandle, IllustratorBridgeIoFailure, IllustratorBridgeSendFailure,
        ILLUSTRATOR_BRIDGE_ACTION_WAIT_MS, ILLUSTRATOR_BRIDGE_COMPLETION_RESPONSE_WAIT_MS,
        ILLUSTRATOR_BRIDGE_STARTUP_WAIT_MS,
    };
    use serde_json::json;
    use std::sync::mpsc;
    use std::thread;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{ERROR_PIPE_CONNECTED, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{ReadFile, PIPE_ACCESS_DUPLEX};
    use windows_sys::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_TYPE_BYTE, PIPE_WAIT,
    };

    fn async_request(request_id: &str) -> serde_json::Value {
        json!({
            "command": "run",
            "requestId": request_id,
            "wait": false
        })
    }

    #[test]
    fn bridge_response_requires_exact_request_identity() {
        let response = illustrator_bridge_test_response("request-a");
        assert!(parse_illustrator_bridge_response(&response, &async_request("request-a")).is_ok());
        assert!(parse_illustrator_bridge_response(&response, &async_request("request-b")).is_err());
    }

    #[test]
    fn bridge_response_surfaces_bridge_errors() {
        let response = r#"{"protocolVersion":2,"ok":false,"error":"Illustrator failed."}"#;
        assert_eq!(
            parse_illustrator_bridge_response(response, &async_request("request-a")).unwrap_err(),
            "Illustrator failed."
        );
    }

    #[test]
    fn asynchronous_bridge_response_requires_acceptance() {
        let response = r#"{"protocolVersion":2,"ok":true,"requestId":"request-a"}"#;
        assert_eq!(
            parse_illustrator_bridge_response(response, &async_request("request-a")).unwrap_err(),
            "Illustrator bridge did not acknowledge the action as accepted."
        );
        let waited_request = json!({
            "command": "run",
            "requestId": "request-a",
            "wait": true
        });
        assert!(parse_illustrator_bridge_response(response, &waited_request).is_ok());
    }

    #[test]
    fn bridge_response_deadlines_are_finite_and_allow_completion_waits() {
        let ping = json!({ "command": "ping", "requestId": "ping" });
        assert_eq!(
            illustrator_bridge_response_timeout(&ping),
            Duration::from_millis(ILLUSTRATOR_BRIDGE_STARTUP_WAIT_MS)
        );
        assert_eq!(
            illustrator_bridge_response_timeout(&async_request("async")),
            Duration::from_millis(ILLUSTRATOR_BRIDGE_ACTION_WAIT_MS)
        );
        let waited_request = json!({
            "command": "run",
            "requestId": "waited",
            "wait": true
        });
        assert_eq!(
            illustrator_bridge_response_timeout(&waited_request),
            Duration::from_millis(ILLUSTRATOR_BRIDGE_COMPLETION_RESPONSE_WAIT_MS)
        );
    }

    #[test]
    fn write_side_broken_pipe_reconnects_but_response_side_does_not_replay() {
        let writing = illustrator_bridge_io_error(
            IllustratorBridgeIoFailure::BrokenPipe,
            "writing the request",
            "request-a",
            Duration::from_secs(1),
        );
        assert!(matches!(
            writing,
            IllustratorBridgeSendFailure::Unavailable(message)
                if message.contains("closed the pipe while writing the request")
        ));

        let reading = illustrator_bridge_io_error(
            IllustratorBridgeIoFailure::BrokenPipe,
            "waiting for the response",
            "request-a",
            Duration::from_secs(1),
        );
        assert!(matches!(
            reading,
            IllustratorBridgeSendFailure::Failed(message)
                if message.contains("closed the pipe while waiting for the response")
        ));
    }

    #[test]
    fn prewarm_error_deduplication_ignores_request_ids() {
        assert_eq!(
            illustrator_bridge_stable_failure_key(
                "Illustrator bridge closed the pipe while writing the request for request 'ping-a'."
            ),
            "Illustrator bridge closed the pipe while writing the request"
        );
    }

    #[test]
    fn silent_connected_bridge_read_is_cancelled_at_deadline() {
        let pipe_path = format!(
            r"\\.\pipe\FlowCell.Illustrator.Bridge.TimeoutTest.{}.{}",
            std::process::id(),
            crate::current_precise_timestamp_token()
        );
        let server_pipe_path = pipe_path.clone();
        let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<(), String>>(1);
        let (release_tx, release_rx) = mpsc::sync_channel::<()>(1);
        let server = thread::spawn(move || -> Result<(), String> {
            let mut wide_path = server_pipe_path.encode_utf16().collect::<Vec<_>>();
            wide_path.push(0);
            let handle = unsafe {
                CreateNamedPipeW(
                    wide_path.as_ptr(),
                    PIPE_ACCESS_DUPLEX,
                    PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                    1,
                    4 * 1024,
                    4 * 1024,
                    0,
                    std::ptr::null(),
                )
            };
            if handle == INVALID_HANDLE_VALUE {
                let message = format!(
                    "Failed to create silent Illustrator test pipe: {}",
                    std::io::Error::last_os_error()
                );
                let _ = ready_tx.send(Err(message.clone()));
                return Err(message);
            }
            let _server_handle = IllustratorBridgeHandle(handle);
            ready_tx
                .send(Ok(()))
                .map_err(|error| format!("Failed to publish test-pipe readiness: {error}"))?;
            let connected = unsafe { ConnectNamedPipe(handle, std::ptr::null_mut()) };
            if connected == 0 {
                let error = std::io::Error::last_os_error();
                if error.raw_os_error() != Some(ERROR_PIPE_CONNECTED as i32) {
                    return Err(format!(
                        "Failed to connect silent Illustrator test pipe: {error}"
                    ));
                }
            }
            let mut request = [0u8; 4 * 1024];
            let mut bytes_read = 0u32;
            let read = unsafe {
                ReadFile(
                    handle,
                    request.as_mut_ptr(),
                    request.len() as u32,
                    &mut bytes_read,
                    std::ptr::null_mut(),
                )
            };
            if read == 0 {
                return Err(format!(
                    "Failed to read the silent Illustrator test request: {}",
                    std::io::Error::last_os_error()
                ));
            }
            release_rx
                .recv_timeout(Duration::from_secs(2))
                .map_err(|error| {
                    format!("Silent Illustrator test pipe was not released: {error}")
                })?;
            Ok(())
        });

        ready_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("silent Illustrator test pipe did not become ready")
            .expect("silent Illustrator test pipe could not be created");
        let pipe =
            open_illustrator_bridge_pipe(&pipe_path).expect("test pipe client could not connect");
        write_illustrator_bridge_request(
            &pipe,
            b"{\"command\":\"ping\",\"requestId\":\"timeout-test\"}\n",
            Instant::now() + Duration::from_secs(1),
        )
        .expect("test pipe request could not be written");

        let started = Instant::now();
        let response =
            read_illustrator_bridge_response(&pipe, Instant::now() + Duration::from_millis(50));
        release_tx
            .send(())
            .expect("silent Illustrator test pipe could not be released");
        let failure = response
            .err()
            .expect("silent test pipe unexpectedly returned a response");
        assert!(matches!(failure, IllustratorBridgeIoFailure::TimedOut));
        assert!(started.elapsed() < Duration::from_secs(1));
        drop(pipe);
        server
            .join()
            .expect("silent Illustrator test-pipe thread panicked")
            .expect("silent Illustrator test-pipe thread failed");
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
        .join("flowcellbackend")
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

pub(crate) fn windows_child_process_path(path: &Path) -> PathBuf {
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
pub(crate) async fn run_panel_script_response(
    app: AppHandle,
    program_name: String,
    panel_name: String,
    file_name: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_panel_script_response_impl(&app, program_name, panel_name, file_name)
    })
    .await
    .map_err(|error| format!("Panel script task failed: {error}"))?
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

#[tauri::command]
pub(crate) fn query_toolset_state(
    program_name: String,
    panel_name: String,
    file_name: String,
) -> Result<Option<Value>, String> {
    if let Some(resolution) = program_sources::execute::resolve_active_source_record(
        &program_name,
        &panel_name,
        &file_name,
    )? {
        return program_sources::execute::run_active_toolset_state_query(&resolution);
    }

    Err(format!(
        "Button source '{}' is not installed in the active Button system. Complete migration before querying tool-set state.",
        file_name.trim()
    ))
}

#[cfg(test)]
mod tests {
    use super::{resolve_macro_recorder_script_path, windows_child_process_path};
    use std::path::{Path, PathBuf};

    #[test]
    fn macro_recorder_path_uses_canonical_backend_helper() {
        let recorder_path = resolve_macro_recorder_script_path()
            .expect("the tracked Macro Lab recorder helper should resolve");

        assert!(recorder_path.ends_with(
            Path::new("flowcellbackend")
                .join("helpers")
                .join("RecordMacro.ahk")
        ));
    }

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
