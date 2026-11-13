//! One hidden PowerShell session for an Add Program transaction. Each request
//! still registers exactly one owner and must acknowledge success before Rust
//! commits that owner's existing source transaction.
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

const MAXIMUM_MESSAGE_BYTES: usize = 1024 * 1024;
const MAXIMUM_ERROR_BYTES: usize = 8192;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const WORKER_SCRIPT: &str = r#"
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'Stop'
while ($null -ne ($line = [Console]::In.ReadLine())) {
    $requestId = 0
    try {
        $request = ConvertFrom-Json -InputObject $line -ErrorAction Stop
        $requestId = [long]$request.requestId
        if ($request.operation -eq 'install') {
            $output = & $env:FLOWCELL_SETUP_INSTALL_SCRIPT -PanelName ([string]$request.panelName) -SelectedPathsJson ([string]$request.selectedPathsJson) -OwnerButtonId ([string]$request.ownerButtonId) -BridgeDataJson ([string]$request.bridgeDataJson) -SkipSync
        }
        elseif ($request.operation -eq 'sync') {
            $output = & $env:FLOWCELL_SETUP_SYNC_SCRIPT
        }
        else { throw 'Unknown setup bridge operation.' }
        $result = ConvertFrom-Json -InputObject ($output -join "`n") -ErrorAction Stop
        [Console]::Out.WriteLine((@{ ok = $true; requestId = $requestId; result = $result } | ConvertTo-Json -Depth 64 -Compress))
    }
    catch {
        [Console]::Out.WriteLine((@{ ok = $false; requestId = $requestId; error = [string]$_.Exception.Message } | ConvertTo-Json -Depth 8 -Compress))
        break
    }
}
"#;

pub(crate) struct ProgramSetupBridgeSession {
    program_name: String,
    child: Option<Child>,
    input: Option<ChildStdin>,
    replies: mpsc::Receiver<Result<Value, String>>,
    output_reader: Option<JoinHandle<()>>,
    error_reader: Option<JoinHandle<()>>,
    errors: Arc<Mutex<Vec<u8>>>,
    request_id: u64,
}

impl ProgramSetupBridgeSession {
    pub(crate) fn new(
        program_name: &str,
        installer: &Path,
        synchronizer: &Path,
    ) -> Result<Self, String> {
        if !installer.is_file() || !synchronizer.is_file() {
            return Err(
                "Blender setup requires its install and synchronization adapters.".to_string(),
            );
        }
        let mut command = Command::new(crate::commands::filesystem::resolve_powershell_path());
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            WORKER_SCRIPT,
        ]);
        command.env(
            "FLOWCELL_SETUP_INSTALL_SCRIPT",
            crate::commands::execution::windows_child_process_path(installer),
        );
        command.env(
            "FLOWCELL_SETUP_SYNC_SCRIPT",
            crate::commands::execution::windows_child_process_path(synchronizer),
        );
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = command
            .spawn()
            .map_err(|error| format!("Failed to start Blender setup worker: {error}"))?;
        let input = child.stdin.take().expect("piped worker stdin");
        let output = child.stdout.take().expect("piped worker stdout");
        let mut error_stream = child.stderr.take().expect("piped worker stderr");
        let (sender, replies) = mpsc::sync_channel(1);
        let output_reader = std::thread::spawn(move || {
            let mut reader = BufReader::new(output);
            loop {
                let mut bytes = Vec::new();
                let result = (&mut reader).take((MAXIMUM_MESSAGE_BYTES + 1) as u64).read_until(b'\n', &mut bytes)
                    .map_err(|error| format!("Cannot read Blender setup acknowledgement: {error}"))
                    .and_then(|count| {
                        if count == 0 { return Err("Blender setup worker exited without acknowledging the source.".to_string()); }
                        if bytes.len() > MAXIMUM_MESSAGE_BYTES || !bytes.ends_with(b"\n") {
                            return Err("Blender setup acknowledgement exceeded its size limit or was incomplete.".to_string());
                        }
                        serde_json::from_slice(&bytes).map_err(|error| format!("Invalid Blender setup acknowledgement: {error}"))
                    });
                let failed = result.is_err();
                // Never block cleanup on unsolicited or duplicate worker output.
                if sender.try_send(result).is_err() || failed {
                    break;
                }
            }
        });
        let errors = Arc::new(Mutex::new(Vec::new()));
        let captured_errors = errors.clone();
        let error_reader = std::thread::spawn(move || {
            let mut buffer = [0; 4096];
            while let Ok(count) = error_stream.read(&mut buffer) {
                if count == 0 {
                    break;
                }
                if let Ok(mut errors) = captured_errors.lock() {
                    let remaining = MAXIMUM_ERROR_BYTES.saturating_sub(errors.len());
                    errors.extend_from_slice(&buffer[..count.min(remaining)]);
                }
            }
        });
        Ok(Self {
            program_name: program_name.to_string(),
            child: Some(child),
            input: Some(input),
            replies,
            output_reader: Some(output_reader),
            error_reader: Some(error_reader),
            errors,
            request_id: 0,
        })
    }

    pub(crate) fn install(
        &mut self,
        program_name: &str,
        owner: &str,
        panel: &str,
        source: &Path,
        bridge_data: Option<&Value>,
    ) -> Result<Value, String> {
        if self.program_name != program_name {
            return Err("Setup worker belongs to another program.".to_string());
        }
        self.request(json!({"operation":"install", "ownerButtonId":owner, "panelName":panel,
            "selectedPathsJson":serde_json::to_string(&[crate::commands::execution::windows_child_process_path(source)]).map_err(|e| e.to_string())?,
            "bridgeDataJson":serde_json::to_string(&bridge_data.cloned().unwrap_or_else(|| json!({}))).map_err(|e| e.to_string())?
        }), REQUEST_TIMEOUT)
    }

    pub(crate) fn synchronize(&mut self) -> Result<Value, String> {
        self.request(json!({"operation":"sync"}), REQUEST_TIMEOUT)
    }

    fn request(&mut self, mut request: Value, timeout: Duration) -> Result<Value, String> {
        self.request_id += 1;
        request["requestId"] = json!(self.request_id);
        let result = (|| {
            let mut bytes = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
            if bytes.len() > MAXIMUM_MESSAGE_BYTES {
                return Err("Blender setup request exceeded its size limit.".to_string());
            }
            bytes.push(b'\n');
            let input = self
                .input
                .as_mut()
                .ok_or_else(|| "Blender setup worker is no longer available.".to_string())?;
            input
                .write_all(&bytes)
                .and_then(|_| input.flush())
                .map_err(|error| format!("Cannot send Blender setup request: {error}"))?;
            let reply = self.replies.recv_timeout(timeout).map_err(|error| {
                format!("Blender setup worker did not acknowledge its request: {error}")
            })??;
            if reply.get("requestId").and_then(Value::as_u64) != Some(self.request_id) {
                return Err("Blender setup worker acknowledged a different request.".to_string());
            }
            if reply.get("ok").and_then(Value::as_bool) != Some(true) {
                return Err(reply
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Blender setup worker failed.")
                    .to_string());
            }
            reply
                .get("result")
                .cloned()
                .ok_or_else(|| "Blender setup worker returned no result.".to_string())
        })();
        match result {
            Ok(value) => Ok(value),
            Err(error) => {
                self.stop();
                let detail = self
                    .errors
                    .lock()
                    .map(|errors| String::from_utf8_lossy(&errors).trim().to_string())
                    .unwrap_or_default();
                Err(if detail.is_empty() {
                    error
                } else {
                    format!("{error} {detail}")
                })
            }
        }
    }

    fn stop(&mut self) {
        self.input.take();
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(reader) = self.output_reader.take() {
            let _ = reader.join();
        }
        if let Some(reader) = self.error_reader.take() {
            let _ = reader.join();
        }
    }
}

impl Drop for ProgramSetupBridgeSession {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    struct Fixture {
        root: PathBuf,
        installer: PathBuf,
        synchronizer: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let token = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "flowcell-setup-worker-{}-{token}",
                std::process::id()
            ));
            fs::create_dir_all(&root).unwrap();
            let installer = root.join("install.ps1");
            let synchronizer = root.join("sync.ps1");
            fs::write(&installer, r#"param([string]$PanelName,[string]$SelectedPathsJson,[string]$OwnerButtonId,[string]$BridgeDataJson,[switch]$SkipSync)
$decodedPaths = @(ConvertFrom-Json $SelectedPathsJson)
@{processId=$PID;owner=$OwnerButtonId;panel=$PanelName;path=[string]$decodedPaths[0];data=(ConvertFrom-Json $BridgeDataJson);skipSync=[bool]$SkipSync} | ConvertTo-Json -Depth 20 -Compress
"#).unwrap();
            fs::write(
                &synchronizer,
                "@{UpdatedActions=2;processId=$PID} | ConvertTo-Json -Compress",
            )
            .unwrap();
            Self {
                root,
                installer,
                synchronizer,
            }
        }
        fn session(&self) -> ProgramSetupBridgeSession {
            ProgramSetupBridgeSession::new("Blender", &self.installer, &self.synchronizer).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn setup_worker_reuses_process_and_preserves_typed_unicode_arguments() {
        let fixture = Fixture::new();
        let mut session = fixture.session();
        let path = fixture.root.join("quoted ' α source.py");
        let data = json!({"text":"literal $(throw 'never execute')\nユニコード", "number":42});
        let first = session
            .install("Blender", "owner-one", "Files α", &path, Some(&data))
            .unwrap();
        let second = session
            .install("Blender", "owner-two", "Files", &path, None)
            .unwrap();
        let synced = session.synchronize().unwrap();
        assert_eq!(first["processId"], second["processId"]);
        assert_eq!(first["processId"], synced["processId"]);
        assert_eq!(first["owner"], "owner-one");
        assert_eq!(second["owner"], "owner-two");
        assert_eq!(first["panel"], "Files α");
        assert_eq!(
            first["path"],
            json!(crate::commands::execution::windows_child_process_path(
                &path
            ))
        );
        assert_eq!(first["data"], data);
        assert_eq!(first["skipSync"], true);
        assert_eq!(synced["UpdatedActions"], 2);
    }

    #[test]
    fn setup_worker_propagates_adapter_exit_and_reaps_its_process() {
        let fixture = Fixture::new();
        fs::write(&fixture.installer, "[System.Environment]::Exit(9)").unwrap();
        let mut session = fixture.session();
        let error = session
            .install("Blender", "owner", "Files", Path::new("source.py"), None)
            .unwrap_err();
        assert!(error.contains("exited without acknowledging"), "{error}");
        assert!(session.child.is_none());
        assert!(session.synchronize().is_err());
    }

    #[test]
    fn setup_worker_rejects_failed_final_sync_and_stops() {
        let fixture = Fixture::new();
        let mut session = fixture.session();
        session
            .install("Blender", "owner", "Files", Path::new("source.py"), None)
            .unwrap();
        fs::write(&fixture.synchronizer, "throw 'injected final sync failure'").unwrap();
        let error = session.synchronize().unwrap_err();
        assert!(error.contains("injected final sync failure"));
        assert!(session.child.is_none());
    }

    #[test]
    fn setup_worker_timeout_terminates_and_reaps_owned_child() {
        let fixture = Fixture::new();
        fs::write(&fixture.synchronizer, "Start-Sleep -Seconds 30").unwrap();
        let mut session = fixture.session();
        let error = session
            .request(json!({"operation":"sync"}), Duration::from_millis(200))
            .unwrap_err();
        assert!(error.contains("did not acknowledge"));
        assert!(session.child.is_none());
    }
}
