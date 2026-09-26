use crate::*;
use std::io::Read;

pub(crate) fn resolve_flowcell_local_root() -> Result<PathBuf, String> {
    if let Some(root) = env::var_os("FLOWCELL_LOCAL_ROOT").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(root));
    }
    if let Some(resource) = installed_resource_root() {
        let local = env::var_os("APPDATA")
            .map(|root| PathBuf::from(root).join("FlowCell").join("local"))
            .ok_or_else(|| "APPDATA is unavailable for installed FlowCell.".to_string())?;
        let local = configured_installed_local_root(&resource, &local)?;
        return installed_local_data_root(&local);
    }
    let repo_root = resolve_repo_root()
        .ok_or_else(|| "FlowCell repo root could not be resolved for local data.".to_string())?;
    Ok(repo_root.join("flowcellbackend").join("local"))
}

fn configured_installed_local_root(resource: &Path, default: &Path) -> Result<PathBuf, String> {
    let config = resource.join("flowcell.runtime.json");
    if !config.is_file() { return Ok(default.to_path_buf()); }
    let raw = fs::read_to_string(&config).map_err(|error| error.to_string())?;
    let value: serde_json::Value = serde_json::from_str(raw.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("Invalid {}: {error}", config.display()))?;
    let local = value.get("localRoot").and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or("flowcell.runtime.json requires localRoot.")?;
    let local = PathBuf::from(local);
    if !local.is_absolute() { return Err("Installed localRoot must be an absolute path.".into()); }
    Ok(local)
}

fn installed_local_data_root(local: &Path) -> Result<PathBuf, String> {
    // Packaged launchers can merge real AppData directories with redirected
    // children. Resolve the existing state file, not an empty directory shadow,
    // so every program package is checked against the same physical data root.
    let state = local.join("button-system").join("button-state.json");
    if state.is_file() {
        let state = fs::canonicalize(&state)
            .map_err(|error| format!("Failed to resolve installed Button state: {error}"))?;
        return state.parent().and_then(Path::parent).map(Path::to_path_buf)
            .ok_or_else(|| "Installed Button state has no data root.".to_string());
    }
    Ok(local.to_path_buf())
}

pub(crate) fn resolve_flowcell_config_root() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root()
        .ok_or_else(|| "FlowCell repo root could not be resolved for config data.".to_string())?;
    Ok(repo_root.join("flowcellbackend").join("config"))
}

pub(crate) fn normalize_path_for_compare(path: &Path) -> String {
    fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_ascii_lowercase()
}

pub(crate) fn resolve_powershell_path() -> PathBuf {
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

pub(crate) fn resolve_repo_root() -> Option<PathBuf> {
    if let Some(root) = installed_resource_root() {
        return Some(root);
    }
    let launcher_path = resolve_frontend_launcher_path()?;
    launcher_path
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
}

pub(crate) fn installed_resource_root() -> Option<PathBuf> {
    // Tauri copies resources into target/release while bundling. A leftover marker
    // must not turn a later ordinary source/portable build into an installation.
    if !matches!(tauri::utils::platform::bundle_type(), Some(tauri::utils::config::BundleType::Nsis)) {
        return None;
    }
    let executable = env::current_exe().ok()?;
    let root = executable.parent()?;
    root.join("flowcell-installed.json").is_file().then(|| root.to_path_buf())
}

fn runtime_programs_root(resource: &Path, local: &Path, use_local: bool, inherited: Option<PathBuf>) -> PathBuf {
    // Preflight initializes both variables, including the normal development local
    // root. Its presence alone must not relocate the already-resolved Programs root.
    inherited.unwrap_or_else(|| if use_local { local.join("Programs") } else { resource.join("Programs") })
}

pub(crate) fn initialize_runtime_paths() -> Result<(), String> {
    let explicit_local = env::var_os("FLOWCELL_LOCAL_ROOT").filter(|value| !value.is_empty()).is_some();
    let installed = installed_resource_root().is_some();
    let resource = resolve_repo_root().ok_or("FlowCell resources could not be resolved.")?;
    let local = resolve_flowcell_local_root()?;
    let programs = runtime_programs_root(&resource, &local, installed || explicit_local,
        env::var_os("FLOWCELL_PROGRAMS_ROOT").filter(|value| !value.is_empty()).map(PathBuf::from));
    fs::create_dir_all(&local).map_err(|e| e.to_string())?;
    fs::create_dir_all(&programs).map_err(|e| e.to_string())?;
    if installed { fs::create_dir_all(programs.join("Windows")).map_err(|e| e.to_string())?; }
    // Source ownership resolves real filesystem paths. Use the same identities for
    // runtime roots so redirected AppData paths also match during quarantine/recovery.
    let local = super::execution::windows_child_process_path(
        &fs::canonicalize(&local).map_err(|e| e.to_string())?);
    let programs = super::execution::windows_child_process_path(
        &fs::canonicalize(&programs).map_err(|e| e.to_string())?);
    env::set_var("FLOWCELL_LOCAL_ROOT", &local);
    env::set_var("FLOWCELL_PROGRAMS_ROOT", &programs);
    env::set_var("FLOWCELL_RESOURCE_ROOT", &resource);
    Ok(())
}

#[cfg(test)]
mod runtime_path_tests {
    use super::{configured_installed_local_root, installed_local_data_root, runtime_programs_root};
    use std::path::Path;

    #[test]
    fn installed_explicit_data_root_survives_different_launch_environments() {
        let resource = std::env::temp_dir().join(format!("flowcell-runtime-root-{}", std::process::id()));
        std::fs::create_dir_all(&resource).unwrap();
        let owner = resource.join("physical-user-data");
        let config = resource.join("flowcell.runtime.json");
        std::fs::write(&config, serde_json::json!({"localRoot": owner}).to_string()).unwrap();
        for default in [resource.join("normal-appdata"), resource.join("redirected-appdata")] {
            assert_eq!(configured_installed_local_root(&resource, &default).unwrap(), owner);
        }
        std::fs::write(&config, r#"{"localRoot":"relative"}"#).unwrap();
        assert!(configured_installed_local_root(&resource, &owner).is_err());
        std::fs::remove_dir_all(&resource).unwrap();
    }

    #[test]
    fn preflight_initialized_development_paths_keep_existing_programs() {
        let resource = Path::new("C:/FlowCell Source");
        let local = resource.join("flowcellbackend/local");
        let programs = resource.join("Programs");
        assert_eq!(runtime_programs_root(resource, &local, true, Some(programs.clone())), programs);
    }

    #[test]
    fn installed_and_direct_override_paths_use_local_programs_without_preflight() {
        let resource = Path::new("C:/FlowCell Install");
        let local = Path::new("C:/User Data/FlowCell/local");
        assert_eq!(runtime_programs_root(resource, local, true, None), local.join("Programs"));
        assert_eq!(runtime_programs_root(resource, local, false, None), resource.join("Programs"));
    }

    #[cfg(windows)]
    #[test]
    fn installed_state_redirect_uses_its_physical_program_root() {
        use std::{fs, process::Command};
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let temp = std::env::temp_dir().join(format!("flowcell-state-root-{}-{nonce}", std::process::id()));
        let overlay = temp.join("overlay");
        let owner = temp.join("owner");
        fs::create_dir_all(&overlay).unwrap();
        fs::create_dir_all(owner.join("button-system")).unwrap();
        fs::create_dir_all(owner.join("Programs")).unwrap();
        fs::write(owner.join("button-system/button-state.json"), "{}").unwrap();
        // A directory junction reproduces a real root with redirected state.
        let output = Command::new("cmd.exe").args(["/d", "/c", "mklink", "/J"])
            .arg(overlay.join("button-system")).arg(owner.join("button-system"))
            .output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        assert_eq!(installed_local_data_root(&overlay).unwrap(), fs::canonicalize(&owner).unwrap());
        assert_eq!(installed_local_data_root(&temp.join("fresh")).unwrap(), temp.join("fresh"));
        fs::remove_dir(overlay.join("button-system")).unwrap();
        fs::remove_dir_all(&temp).unwrap();
    }
}

pub(crate) fn start_installed_backend() -> Result<(), String> {
    if installed_resource_root().is_none() { return Ok(()); }
    let preflight = resolve_repo_root().ok_or("Missing resources")?
        .join("flowcellbackend/helpers/Start-FlowCellPreflight.ps1");
    let output = spawn_powershell_output(&["-File".into(), preflight.to_string_lossy().into_owned()])?;
    if !output.status.success() {
        return Err(format_process_failure(&output, "FlowCell startup preflight failed."));
    }
    let mut command = Command::new("wscript.exe");
    command.arg(resolve_flowcell_backend_launcher_path()?);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let status = command.status().map_err(|e| e.to_string())?;
    if !status.success() { return Err("FlowCell backend launcher failed.".into()); }
    Ok(())
}

pub(crate) fn escape_powershell_single_quoted(value: &str) -> String {
    value.replace('\'', "''")
}

fn build_powershell_output_command(arguments: &[String]) -> Command {
    let mut command = Command::new(resolve_powershell_path());
    command
        .arg("-NoProfile")
        .arg("-WindowStyle")
        .arg("Hidden")
        .arg("-ExecutionPolicy")
        .arg("Bypass");
    for argument in arguments {
        command.arg(argument);
    }
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

pub(crate) fn spawn_powershell_output(
    arguments: &[String],
) -> Result<std::process::Output, String> {
    let mut command = build_powershell_output_command(arguments);
    command
        .output()
        .map_err(|error| format!("Failed to start PowerShell: {error}"))
}

fn read_bounded_process_stream(
    stream: impl Read,
    maximum_bytes: usize,
    label: &str,
) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::with_capacity(maximum_bytes.min(64 * 1024));
    stream
        .take(maximum_bytes.saturating_add(1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Failed to read PowerShell {label}: {error}"))?;
    if bytes.len() > maximum_bytes {
        return Err(format!(
            "PowerShell {label} exceeded its {maximum_bytes}-byte capture limit."
        ));
    }
    Ok(bytes)
}

pub(crate) fn spawn_powershell_output_bounded(
    arguments: &[String],
    maximum_stdout_bytes: usize,
    maximum_stderr_bytes: usize,
) -> Result<std::process::Output, String> {
    let mut command = build_powershell_output_command(arguments);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start PowerShell: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture PowerShell stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture PowerShell stderr.".to_string())?;
    let stdout_reader =
        thread::spawn(move || read_bounded_process_stream(stdout, maximum_stdout_bytes, "stdout"));
    let stderr_reader =
        thread::spawn(move || read_bounded_process_stream(stderr, maximum_stderr_bytes, "stderr"));
    let status = child
        .wait()
        .map_err(|error| format!("Failed while waiting for PowerShell: {error}"))?;
    let stdout = stdout_reader
        .join()
        .map_err(|_| "PowerShell stdout reader stopped unexpectedly.".to_string())??;
    let stderr = stderr_reader
        .join()
        .map_err(|_| "PowerShell stderr reader stopped unexpectedly.".to_string())??;
    Ok(std::process::Output {
        status,
        stdout,
        stderr,
    })
}

pub(crate) fn format_process_failure(output: &std::process::Output, fallback: &str) -> String {
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

#[cfg(test)]
mod bounded_process_output_tests {
    use super::read_bounded_process_stream;
    use std::io::Cursor;

    #[test]
    fn bounded_process_stream_accepts_output_at_the_limit() {
        assert_eq!(
            read_bounded_process_stream(Cursor::new(b"1234"), 4, "stdout").expect("bounded output"),
            b"1234"
        );
    }

    #[test]
    fn bounded_process_stream_rejects_output_past_the_limit() {
        let error = read_bounded_process_stream(Cursor::new(b"12345"), 4, "stderr")
            .expect_err("oversized output should fail");
        assert_eq!(
            error,
            "PowerShell stderr exceeded its 4-byte capture limit."
        );
    }
}

pub(crate) fn wait_for_child_output_with_timeout(
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

pub(crate) fn recycle_file_paths(paths: &[PathBuf]) -> Result<(), String> {
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

pub(crate) fn recycle_file_path(path: &Path) -> Result<(), String> {
    recycle_file_paths(&[path.to_path_buf()])
}

pub(crate) fn recycle_directory_paths(paths: &[PathBuf]) -> Result<(), String> {
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

pub(crate) fn recycle_directory_path(path: &Path) -> Result<(), String> {
    recycle_directory_paths(&[path.to_path_buf()])
}
