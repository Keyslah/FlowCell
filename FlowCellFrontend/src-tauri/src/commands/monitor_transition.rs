use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::{ErrorKind, Read};
use std::path::Path;

const MAX_TRANSITION_BYTES: usize = 64 * 1024;
const MAX_EXPECTED_DISPLAYS: usize = 64;
const MAX_SAFE_JSON_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MonitorLayoutTransition {
    schema_version: u32,
    id: String,
    phase: TransitionPhase,
    updated_at_ms: u64,
    expected_displays: Vec<ExpectedDisplay>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum TransitionPhase {
    Switching,
    Complete,
    Failed,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ExpectedDisplay {
    left: i32,
    top: i32,
    width: i32,
    height: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MonitorLayoutTransitionStatus {
    namespace: String,
    process_id: u32,
    busy: bool,
    transition: Option<MonitorLayoutTransition>,
}

fn parse_transition(bytes: &[u8]) -> Result<MonitorLayoutTransition, String> {
    if bytes.len() > MAX_TRANSITION_BYTES {
        return Err(format!(
            "Monitor transition exceeds {MAX_TRANSITION_BYTES} bytes."
        ));
    }
    let value: MonitorLayoutTransition = serde_json::from_slice(bytes)
        .map_err(|error| format!("Invalid monitor transition JSON: {error}"))?;
    let valid_id = value.id.len() == 36
        && value.id.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        });
    if value.schema_version != 1 || !valid_id {
        return Err("Monitor transition requires schemaVersion 1 and a UUID id.".into());
    }
    if value.updated_at_ms == 0 || value.updated_at_ms > MAX_SAFE_JSON_INTEGER {
        return Err("Monitor transition updatedAtMs must be a positive safe JSON integer.".into());
    }
    if value.expected_displays.len() > MAX_EXPECTED_DISPLAYS
        || (value.phase == TransitionPhase::Complete && value.expected_displays.is_empty())
    {
        return Err("Monitor transition requires at most 64 displays and a complete transition requires at least 1 display.".into());
    }
    let mut rectangles = BTreeSet::new();
    for display in &value.expected_displays {
        if display.width <= 0
            || display.height <= 0
            || display.left.checked_add(display.width).is_none()
            || display.top.checked_add(display.height).is_none()
            || !rectangles.insert((display.left, display.top, display.width, display.height))
        {
            return Err("Monitor transition displays require unique positive-size rectangles within signed 32-bit desktop coordinates.".into());
        }
    }
    Ok(value)
}

fn read_transition(path: &Path) -> Result<Option<MonitorLayoutTransition>, String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Cannot open monitor transition {}: {error}",
                path.display()
            ))
        }
    };
    if !file
        .metadata()
        .map_err(|error| error.to_string())?
        .is_file()
    {
        return Err("Monitor transition path must be a regular file.".into());
    }
    let mut bytes = Vec::new();
    file.take((MAX_TRANSITION_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Cannot read monitor transition {}: {error}", path.display()))?;
    parse_transition(&bytes).map(Some)
}

fn runtime_namespace(role: &str, local_root: &Path) -> Result<String, String> {
    let canonical = fs::canonicalize(local_root)
        .map_err(|error| format!("Cannot resolve monitor layout runtime root: {error}"))?;
    let path = super::execution::windows_child_process_path(&canonical);
    Ok(format!("{role}:{}", path.to_string_lossy().to_lowercase()))
}

#[cfg(windows)]
fn topology_mutation_busy() -> Result<bool, String> {
    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_FILE_NOT_FOUND, WAIT_ABANDONED, WAIT_FAILED,
        WAIT_OBJECT_0, WAIT_TIMEOUT,
    };
    use windows_sys::Win32::System::Threading::{
        OpenMutexW, ReleaseMutex, WaitForSingleObject, MUTEX_MODIFY_STATE,
        SYNCHRONIZATION_SYNCHRONIZE,
    };

    let name: Vec<u16> = "Local\\ToggleMonitorsTopologyMutation"
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let handle = unsafe {
        OpenMutexW(
            SYNCHRONIZATION_SYNCHRONIZE | MUTEX_MODIFY_STATE,
            0,
            name.as_ptr(),
        )
    };
    if handle.is_null() {
        let error = unsafe { GetLastError() };
        return if error == ERROR_FILE_NOT_FOUND {
            Ok(false)
        } else {
            Err(format!(
                "Cannot inspect monitor topology mutex: Windows error {error}."
            ))
        };
    }
    let result = match unsafe { WaitForSingleObject(handle, 0) } {
        WAIT_TIMEOUT => Ok(true),
        WAIT_OBJECT_0 | WAIT_ABANDONED => {
            if unsafe { ReleaseMutex(handle) } == 0 {
                Err(format!(
                    "Cannot release monitor topology mutex probe: Windows error {}.",
                    unsafe { GetLastError() }
                ))
            } else {
                Ok(false)
            }
        }
        WAIT_FAILED => Err(format!(
            "Cannot probe monitor topology mutex: Windows error {}.",
            unsafe { GetLastError() }
        )),
        result => Err(format!(
            "Unexpected monitor topology mutex result {result}."
        )),
    };
    if unsafe { CloseHandle(handle) } == 0 {
        return Err(format!(
            "Cannot close monitor topology mutex probe: Windows error {}.",
            unsafe { GetLastError() }
        ));
    }
    result
}

#[cfg(not(windows))]
fn topology_mutation_busy() -> Result<bool, String> {
    Err("Monitor layout transitions are available only on Windows.".into())
}

#[tauri::command]
pub(crate) fn get_monitor_layout_transition() -> Result<MonitorLayoutTransitionStatus, String> {
    let namespace = runtime_namespace(
        super::filesystem::flowcell_backend_role(),
        &super::filesystem::resolve_flowcell_local_root()?,
    )?;
    let app_data = std::env::var_os("LOCALAPPDATA")
        .filter(|value| !value.is_empty())
        .ok_or("LOCALAPPDATA is unavailable for monitor transition state.")?;
    let app_data = std::path::PathBuf::from(app_data);
    if !app_data.is_absolute() {
        return Err("LOCALAPPDATA must be absolute for monitor transition state.".into());
    }
    // Probe on both sides of the atomic file read so an in-progress native
    // switch cannot appear idle while it replaces its transition marker.
    let busy_before = topology_mutation_busy()?;
    let transition = read_transition(&app_data.join("ToggleMonitors").join("transition.json"))?;
    let busy_after = topology_mutation_busy()?;
    Ok(MonitorLayoutTransitionStatus {
        namespace,
        process_id: std::process::id(),
        busy: busy_before || busy_after,
        transition,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid_transition() -> serde_json::Value {
        json!({"schemaVersion": 1, "id": "c654cdec-7674-4428-a073-0472c6831b5d",
            "phase": "complete", "updatedAtMs": 1793800000000u64,
            "expectedDisplays": [{"left": -1920, "top": 0, "width": 1920, "height": 1080}]})
    }

    #[test]
    fn valid_transition_round_trips_exactly_and_supports_noncomplete_empty_targets() {
        let mut value = valid_transition();
        let parsed = parse_transition(&serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(serde_json::to_value(parsed).unwrap(), value);
        value["expectedDisplays"] = json!([]);
        assert!(parse_transition(&serde_json::to_vec(&value).unwrap()).is_err());
        for phase in ["switching", "failed"] {
            value["phase"] = json!(phase);
            assert!(parse_transition(&serde_json::to_vec(&value).unwrap()).is_ok());
        }
    }

    #[test]
    fn malformed_contract_fields_fail_closed() {
        for (field, invalid) in [
            ("schemaVersion", json!(2)),
            ("id", json!("not-a-uuid")),
            ("phase", json!("ready")),
            ("updatedAtMs", json!(0)),
            ("updatedAtMs", json!(-1)),
            ("updatedAtMs", json!(1.25)),
            ("updatedAtMs", json!(MAX_SAFE_JSON_INTEGER + 1)),
            ("unexpected", json!(true)),
        ] {
            let mut value = valid_transition();
            value[field] = invalid;
            assert!(
                parse_transition(&serde_json::to_vec(&value).unwrap()).is_err(),
                "accepted {value}"
            );
        }
        for field in [
            "id",
            "phase",
            "schemaVersion",
            "updatedAtMs",
            "expectedDisplays",
        ] {
            let mut value = valid_transition();
            value.as_object_mut().unwrap().remove(field);
            assert!(parse_transition(&serde_json::to_vec(&value).unwrap()).is_err());
        }
        assert!(parse_transition(b"{broken").is_err());
    }

    #[test]
    fn invalid_duplicate_and_excessive_display_rectangles_fail_closed() {
        for invalid in [
            json!({"left": 0, "top": 0, "width": 0, "height": 1080}),
            json!({"left": 0, "top": 0, "width": 1920, "height": -1}),
            json!({"left": i32::MAX, "top": 0, "width": 1920, "height": 1080}),
            json!({"left": 0.5, "top": 0, "width": 1920, "height": 1080}),
            json!({"left": 0, "top": 0, "width": 1920, "height": 1080, "extra": 1}),
        ] {
            let mut value = valid_transition();
            value["expectedDisplays"] = json!([invalid]);
            assert!(parse_transition(&serde_json::to_vec(&value).unwrap()).is_err());
        }
        for count in [2, MAX_EXPECTED_DISPLAYS + 1] {
            let mut value = valid_transition();
            value["expectedDisplays"] = json!(vec![value["expectedDisplays"][0].clone(); count]);
            assert!(parse_transition(&serde_json::to_vec(&value).unwrap()).is_err());
        }
    }

    #[test]
    fn file_read_is_bounded_and_missing_is_the_only_legacy_fallback() {
        let root = std::env::temp_dir().join(format!(
            "flowcell-monitor-transition-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("transition.json");
        assert!(read_transition(&path).unwrap().is_none());
        fs::write(&path, serde_json::to_vec(&valid_transition()).unwrap()).unwrap();
        assert!(read_transition(&path).unwrap().is_some());
        fs::write(&path, b"{broken").unwrap();
        assert!(read_transition(&path).is_err());
        fs::write(&path, vec![b' '; MAX_TRANSITION_BYTES + 1]).unwrap();
        assert!(read_transition(&path).unwrap_err().contains("65536 bytes"));
        assert!(read_transition(&root).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn runtime_namespace_is_stable_but_separates_roles_and_local_roots() {
        let root = std::env::temp_dir().join(format!(
            "flowcell-monitor-namespace-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("second")).unwrap();
        let installed = runtime_namespace("installed", &root).unwrap();
        assert_eq!(
            installed,
            runtime_namespace("installed", &root.join(".")).unwrap()
        );
        assert_ne!(installed, runtime_namespace("development", &root).unwrap());
        assert_ne!(
            installed,
            runtime_namespace("installed", &root.join("second")).unwrap()
        );
        fs::remove_dir_all(root).unwrap();
    }
}
