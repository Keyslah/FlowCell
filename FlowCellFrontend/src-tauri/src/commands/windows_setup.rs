//! The Windows catalog is bundled with Core. Main offers its panel choices once;
//! the ordinary managed-program transaction owns registration and Button creation.
use crate::*;
use super::program_packages::{plain_path, seed_installed_windows_catalog};

const WINDOWS_RECEIPT: &str = "77696e646f7773.json";
static WINDOWS_SETUP_LOCK: Mutex<()> = Mutex::new(());

fn read_setup_json(path: &Path) -> Result<Option<Value>, String> {
    read_setup_json_with_limit(path, 65_536)
}

fn read_setup_json_with_limit(path: &Path, maximum_bytes: u64) -> Result<Option<Value>, String> {
    plain_path(path)?;
    match fs::metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
        Ok(metadata) if !metadata.is_file() || metadata.len() > maximum_bytes =>
            return Err(format!("Invalid Windows setup record at {}.", path.display())),
        Ok(_) => {}
    }
    let value = serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?)
        .map_err(|error| format!("Invalid Windows setup record at {}: {error}", path.display()))?;
    Ok(Some(value))
}

fn windows_setup_transaction_is_pending(local: &Path) -> Result<bool, String> {
    let transactions = local.join("program-setup-transactions");
    plain_path(&transactions)?;
    let entries = match fs::read_dir(&transactions) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("Could not inspect Windows setup transactions: {error}")),
    };
    for (index, entry) in entries.enumerate() {
        if index >= 1024 { return Err("Too many setup records to safely inspect Windows setup.".into()); }
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        plain_path(&path)?;
        if !entry.file_type().map_err(|error| error.to_string())?.is_dir() { continue; }
        // Journals include complete binding snapshots, so their bound is larger
        // than the small completion receipt. Unrelated program journals are inert.
        let Some(journal) = read_setup_json_with_limit(&path.join("add-program-transaction.json"), 8 * 1024 * 1024)? else { continue; };
        let requested = journal.pointer("/request/programName").and_then(Value::as_str);
        let planned = journal.pointer("/preflight/programName").and_then(Value::as_str);
        if ![requested, planned].iter().any(|name| name.is_some_and(|name| name.eq_ignore_ascii_case("Windows"))) {
            continue;
        }
        if journal.get("schemaVersion").and_then(Value::as_u64) != Some(1)
            || !requested.is_some_and(|name| name.eq_ignore_ascii_case("Windows"))
            || !planned.is_some_and(|name| name.eq_ignore_ascii_case("Windows")) {
            return Err("The pending Windows setup transaction has an invalid identity.".into());
        }
        match journal.get("phase").and_then(Value::as_str) {
            Some("prepared" | "nativeApplied" | "awaitingCanonical") => return Ok(true),
            Some("committed" | "rolledBack") => {},
            _ => return Err("The Windows setup transaction has an invalid phase.".into()),
        }
    }
    Ok(false)
}

fn windows_setup_was_completed(local: &Path) -> Result<bool, String> {
    // Setup receipts survive normal program deletion. Checking the receipt rather
    // than the catalog prevents startup/upgrade from resurrecting removed tools.
    if let Some(receipt) = read_setup_json(&local.join("program-setup-status").join(WINDOWS_RECEIPT))? {
        let result = receipt.get("result").unwrap_or(&receipt);
        if !result.get("programName").and_then(Value::as_str)
            .is_some_and(|name| name.eq_ignore_ascii_case("Windows")) {
            return Err("The Windows setup receipt has a different program identity.".into());
        }
        match result.get("status").and_then(Value::as_str) {
            Some("ready") => return Ok(true),
            Some("needsHostInitialization") => {},
            _ => return Err("The Windows setup receipt has an invalid status.".into()),
        }
    }
    if let Some(marker) = read_setup_json(&local.join("installation-defaults").join("windows.json"))? {
        if marker.get("schemaVersion").and_then(Value::as_u64) != Some(1)
            || marker.get("programName").and_then(Value::as_str) != Some("Windows") {
            return Err("The existing Windows registration marker is invalid.".into());
        }
        return Ok(true);
    }
    Ok(false)
}

fn remember_existing_windows_registration(local: &Path) -> Result<(), String> {
    let path = local.join("installation-defaults").join("windows.json");
    plain_path(&path)?;
    program_sources::transaction::write_json_file(
        &path,
        br#"{"schemaVersion":1,"programName":"Windows"}"#,
        program_sources::transaction::AtomicWriteMode::Create,
    )
}

fn windows_setup_required(local: &Path, registered: bool) -> Result<bool, String> {
    if windows_setup_was_completed(local)? { return Ok(false); }
    if registered {
        if windows_setup_transaction_is_pending(local)? {
            return Err("Windows setup is still in progress or awaiting recovery. Finish that setup or restart FlowCell to recover it, then retry.".into());
        }
        // Older installations can predate setup receipts. Preserve their exact
        // chosen tools and remember that a later deletion is intentional.
        remember_existing_windows_registration(local)?;
        return Ok(false);
    }
    Ok(true)
}

#[tauri::command]
pub(crate) async fn get_windows_setup_requirement()
    -> Result<Option<super::programs::AvailableProgramPackage>, String>
{
    let Some(resource) = super::filesystem::installed_resource_root() else { return Ok(None); };
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = WINDOWS_SETUP_LOCK.lock().map_err(|_| "Windows setup lock is unavailable.")?;
        let local = resolve_flowcell_local_root()?;
        {
            let _bindings_guard = super::bindings::bindings_state_guard()?;
            let (_, bindings, _) = read_bindings_file_state()?;
            if !windows_setup_required(&local, find_registered_program(&bindings, "Windows").is_some())? {
                return Ok(None);
            }
        }
        let programs = super::programs::resolve_programs_root()?;
        seed_installed_windows_catalog(&resource, &programs)?;
        let mut package = super::programs::validate_available_program_package("Windows")?;
        let explorer = env::var_os("SystemRoot").map(PathBuf::from)
            .ok_or("Windows SystemRoot is unavailable.")?.join("explorer.exe");
        if !explorer.is_file() { return Err("Windows Explorer could not be located for Windows setup.".into()); }
        package.suggested_executable = explorer.to_string_lossy().into_owned();
        Ok(Some(package))
    }).await.map_err(|error| format!("Windows setup inspection did not finish: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        let token = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let root = env::temp_dir().join(format!("flowcell-windows-default-{}-{token}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn receipt(root: &Path, value: Value) {
        let directory = root.join("program-setup-status");
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join(WINDOWS_RECEIPT), serde_json::to_vec(&value).unwrap()).unwrap();
    }

    #[test]
    fn fresh_windows_setup_stays_pending_until_registration_commits() {
        let root = fixture();
        assert!(windows_setup_required(&root, false).unwrap());
        assert!(windows_setup_required(&root, false).unwrap());
        assert!(!root.join("installation-defaults").exists());
        receipt(&root, json!({"result":{"programName":"Windows","status":"ready"},
            "committedTransaction":{"transactionToken":"add-program-test","executablePath":"explorer.exe"}}));
        assert!(!windows_setup_required(&root, true).unwrap());
        // A later removal must not trigger the chooser or recreate the program.
        assert!(!windows_setup_required(&root, false).unwrap());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn existing_windows_and_later_deletion_preserve_user_files_and_choices() {
        let root = fixture();
        let sentinel = root.join("bindings.ini");
        fs::write(&sentinel, "custom Windows bindings").unwrap();
        assert!(!windows_setup_required(&root, true).unwrap());
        assert!(!windows_setup_required(&root, false).unwrap());
        assert_eq!(fs::read_to_string(sentinel).unwrap(), "custom Windows bindings");
        assert!(!root.join("Programs").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_ready_receipt_is_retained_but_incomplete_setup_remains_retryable() {
        let root = fixture();
        receipt(&root, json!({"programName":"Windows","status":"needsHostInitialization"}));
        assert!(windows_setup_required(&root, false).unwrap());
        receipt(&root, json!({"programName":"Windows","status":"ready"}));
        assert!(!windows_setup_required(&root, false).unwrap());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_setup_records_do_not_silently_reinstall_or_mark_completed() {
        let root = fixture();
        receipt(&root, json!({"result":{"programName":"Blender","status":"ready"}}));
        assert!(windows_setup_required(&root, false).is_err());
        receipt(&root, json!({"programName":"Windows","status":"unknown"}));
        assert!(windows_setup_required(&root, false).is_err());
        fs::write(root.join("program-setup-status").join(WINDOWS_RECEIPT), "not JSON").unwrap();
        assert!(windows_setup_required(&root, false).is_err());
        assert!(!root.join("installation-defaults").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pending_registration_is_not_adopted_and_rollback_keeps_setup_required() {
        let root = fixture();
        let pending = root.join("program-setup-transactions/add-program-fixture");
        fs::create_dir_all(&pending).unwrap();
        for phase in ["prepared", "nativeApplied", "awaitingCanonical"] {
            let journal = json!({"schemaVersion":1,"phase":phase,
                "request":{"programName":"Windows"},"preflight":{"programName":"Windows"}});
            fs::write(pending.join("add-program-transaction.json"), serde_json::to_vec(&journal).unwrap()).unwrap();
            assert!(windows_setup_required(&root, true).unwrap_err().contains("in progress"));
            assert!(!root.join("installation-defaults").exists());
        }
        fs::remove_dir_all(&pending).unwrap();
        assert!(windows_setup_required(&root, false).unwrap());
        assert!(!root.join("installation-defaults").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unrelated_pending_setup_does_not_block_adopting_existing_windows() {
        let root = fixture();
        let pending = root.join("program-setup-transactions/add-program-fixture");
        fs::create_dir_all(&pending).unwrap();
        let journal = json!({"schemaVersion":1,"phase":"nativeApplied",
            "request":{"programName":"Blender"},"preflight":{"programName":"Blender"}});
        fs::write(pending.join("add-program-transaction.json"), serde_json::to_vec(&journal).unwrap()).unwrap();
        assert!(!windows_setup_required(&root, true).unwrap());
        assert!(root.join("installation-defaults/windows.json").is_file());
        fs::remove_dir_all(root).unwrap();
    }
}
