use crate::*;
use std::io::Read;

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
