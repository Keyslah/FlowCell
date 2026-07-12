use crate::*;

const ORCA_LAUNCHER_CONFIG_FILE_NAME: &str = "orca_launcher.json";
const CURA_LAUNCHER_CONFIG_FILE_NAME: &str = "cura_launcher.json";

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
pub(crate) fn load_slicer_executable(slicer_id: String) -> Result<Option<String>, String> {
    read_saved_slicer_executable(&slicer_id)
}

#[tauri::command]
pub(crate) fn launch_slicer(
    slicer_id: String,
    executable_path: String,
    exported_paths: Vec<String>,
) -> Result<String, String> {
    launch_slicer_impl(&slicer_id, &executable_path, exported_paths)
}
