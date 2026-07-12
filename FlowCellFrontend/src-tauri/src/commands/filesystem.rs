use crate::*;

pub(crate) fn resolve_flowcell_local_root() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root()
        .ok_or_else(|| "FlowCell repo root could not be resolved for local data.".to_string())?;
    Ok(repo_root.join("flowcellbackend").join("local"))
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
    let launcher_path = resolve_frontend_launcher_path()?;
    launcher_path
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
}

pub(crate) fn escape_powershell_single_quoted(value: &str) -> String {
    value.replace('\'', "''")
}

pub(crate) fn spawn_powershell_output(
    arguments: &[String],
) -> Result<std::process::Output, String> {
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
        .output()
        .map_err(|error| format!("Failed to start PowerShell: {error}"))
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
