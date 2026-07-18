use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::program_sources::transaction::{self, AtomicWriteMode};

static BUTTON_STATE_COMMIT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
const SOURCE_TRANSACTION_JOURNAL_FILE_NAME: &str = "button-source-transaction.json";
const SOURCE_TRANSACTION_SCHEMA_VERSION: u32 = 1;

fn synchronize_child_hotkeys_after_commit(app: &tauri::AppHandle) {
    if let Err(error) = crate::synchronize_tool_set_child_hotkeys(app) {
        let message = format!(
            "Tool-set child hotkeys could not be synchronized after Button state commit: {error}"
        );
        eprintln!("{message}");
        crate::append_flowcell_local_log("child_hotkeys.log", &message);
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitButtonStateRequest {
    document: Value,
    expected_revision: u64,
    #[serde(default)]
    uninstall_owner_button_ids: Vec<String>,
    #[serde(default)]
    migration_token: Option<String>,
    #[serde(default)]
    program_rename_token: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
enum SourceTransactionPhase {
    Prepared,
    StateCommitted,
    RolledBack,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ButtonSourceTransactionJournal {
    schema_version: u32,
    phase: SourceTransactionPhase,
    previous_document: Option<Value>,
    next_document: Value,
    owner_button_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SourceTransactionRecovery {
    RollBack,
    Finalize,
}

fn button_state_path() -> Result<PathBuf, String> {
    Ok(crate::resolve_flowcell_local_root()?
        .join("button-system")
        .join("button-state.json"))
}

fn source_quarantine_root() -> Result<PathBuf, String> {
    Ok(crate::resolve_flowcell_local_root()?
        .join("button-system")
        .join("quarantine"))
}

fn source_transaction_journal_path(transaction_root: &Path) -> PathBuf {
    transaction_root.join(SOURCE_TRANSACTION_JOURNAL_FILE_NAME)
}

fn button_bootstrap_error_path() -> Result<PathBuf, String> {
    Ok(crate::resolve_flowcell_local_root()?
        .join("button-system")
        .join("last-bootstrap-error.log"))
}

#[tauri::command]
pub(crate) fn set_button_bootstrap_failure(message: Option<String>) -> Result<(), String> {
    let path = button_bootstrap_error_path()?;
    if let Some(message) = message
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        let parent = path
            .parent()
            .ok_or_else(|| "Button bootstrap error path has no parent.".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
        return fs::write(&path, message)
            .map_err(|error| format!("Failed to write {}: {error}", path.display()));
    }
    if path.is_file() {
        crate::recycle_file_path(&path)?;
    }
    Ok(())
}

fn validate_button_state(document: &Value) -> Result<(), String> {
    let object = document
        .as_object()
        .ok_or_else(|| "Button state must be a JSON object.".to_string())?;
    let schema_version = object
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| "Button state is missing a numeric schemaVersion.".to_string())?;
    if schema_version == 0 {
        return Err("Button state schemaVersion must be greater than zero.".to_string());
    }
    Ok(())
}

fn read_button_state_document(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let document = serde_json::from_str::<Value>(&raw).map_err(|error| {
        format!(
            "Button state at {} is invalid JSON: {error}",
            path.display()
        )
    })?;
    validate_button_state(&document)?;
    Ok(document)
}

pub(crate) fn button_state_commit_guard() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    BUTTON_STATE_COMMIT_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Button state commit lock is poisoned.".to_string())
}

pub(crate) fn read_button_state_for_program_rename_locked() -> Result<Option<Value>, String> {
    let path = button_state_path()?;
    recover_button_state(&path)?;
    if path.is_file() {
        read_button_state_document(&path).map(Some)
    } else {
        Ok(None)
    }
}

fn recover_button_state(path: &Path) -> Result<(), String> {
    transaction::recover_json_file(path, |candidate| {
        read_button_state_document(candidate).map(|_| ())
    })
}

fn atomic_write_json(path: &Path, document: &Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(document)
        .map_err(|error| format!("Failed to serialize Button state: {error}"))?;
    transaction::write_json_file(path, content.as_bytes(), AtomicWriteMode::Replace)
}

fn document_revision(document: &Value) -> Result<u64, String> {
    document
        .get("revision")
        .and_then(Value::as_u64)
        .ok_or_else(|| "Button state is missing a numeric revision.".to_string())
}

fn validate_source_transaction_journal(
    journal: &ButtonSourceTransactionJournal,
) -> Result<(), String> {
    if journal.schema_version != SOURCE_TRANSACTION_SCHEMA_VERSION {
        return Err(format!(
            "Button source transaction has unsupported schemaVersion {}.",
            journal.schema_version
        ));
    }
    validate_button_state(&journal.next_document)?;
    let next_revision = document_revision(&journal.next_document)?;
    let previous_revision = journal
        .previous_document
        .as_ref()
        .map(|document| {
            validate_button_state(document)?;
            document_revision(document)
        })
        .transpose()?
        .unwrap_or(0);
    let required_next_revision = previous_revision
        .checked_add(1)
        .ok_or_else(|| "Button source transaction revision cannot exceed u64::MAX.".to_string())?;
    if next_revision != required_next_revision {
        return Err(format!(
            "Button source transaction revision {} does not follow {}.",
            next_revision, previous_revision
        ));
    }
    if journal.owner_button_ids.is_empty() {
        return Err("Button source transaction has no source owners.".to_string());
    }
    let mut owners = Vec::<String>::new();
    for owner in &journal.owner_button_ids {
        let owner = crate::program_sources::validate_owner_button_id(owner)?;
        if owners
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&owner))
        {
            return Err(format!(
                "Button source transaction contains duplicate owner '{owner}'."
            ));
        }
        owners.push(owner);
    }
    Ok(())
}

fn parse_source_transaction_journal(path: &Path) -> Result<ButtonSourceTransactionJournal, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let journal =
        serde_json::from_str::<ButtonSourceTransactionJournal>(&raw).map_err(|error| {
            format!(
                "Button source transaction journal {} is invalid: {error}",
                path.display()
            )
        })?;
    validate_source_transaction_journal(&journal)?;
    Ok(journal)
}

fn write_source_transaction_journal(
    transaction_root: &Path,
    journal: &ButtonSourceTransactionJournal,
    mode: AtomicWriteMode,
) -> Result<(), String> {
    validate_source_transaction_journal(journal)?;
    let raw = serde_json::to_string_pretty(journal)
        .map_err(|error| format!("Failed to serialize Button source transaction: {error}"))?;
    transaction::write_json_file(
        &source_transaction_journal_path(transaction_root),
        raw.as_bytes(),
        mode,
    )
}

fn read_source_transaction_journal(
    transaction_root: &Path,
) -> Result<Option<ButtonSourceTransactionJournal>, String> {
    let path = source_transaction_journal_path(transaction_root);
    transaction::recover_json_file(&path, |candidate| {
        parse_source_transaction_journal(candidate).map(|_| ())
    })?;
    if path.is_file() {
        parse_source_transaction_journal(&path).map(Some)
    } else {
        Ok(None)
    }
}

fn classify_source_transaction(
    journal: &ButtonSourceTransactionJournal,
    current_document: Option<&Value>,
) -> Result<SourceTransactionRecovery, String> {
    let next_revision = document_revision(&journal.next_document)?;
    let previous_revision = journal
        .previous_document
        .as_ref()
        .map(document_revision)
        .transpose()?
        .unwrap_or(0);
    let (inferred, current_revision) = if let Some(current) = current_document {
        let current_revision = document_revision(current)?;
        let inferred = if current_revision > next_revision {
            SourceTransactionRecovery::Finalize
        } else if current_revision == next_revision {
            if current == &journal.next_document {
                SourceTransactionRecovery::Finalize
            } else {
                return Err(format!(
                    "Canonical Button state revision {current_revision} does not match the source transaction commit."
                ));
            }
        } else if current_revision == previous_revision {
            if journal.previous_document.as_ref() == Some(current) {
                SourceTransactionRecovery::RollBack
            } else {
                return Err(format!(
                    "Canonical Button state revision {current_revision} does not match the source transaction rollback boundary."
                ));
            }
        } else {
            return Err(format!(
                "Canonical Button state revision {current_revision} is outside source transaction revisions {previous_revision}..={next_revision}."
            ));
        };
        (inferred, Some(current_revision))
    } else if journal.previous_document.is_none() {
        (SourceTransactionRecovery::RollBack, None)
    } else {
        return Err("Canonical Button state disappeared during a source transaction.".to_string());
    };

    match journal.phase {
        SourceTransactionPhase::Prepared => Ok(inferred),
        SourceTransactionPhase::StateCommitted
            if inferred == SourceTransactionRecovery::Finalize =>
        {
            Ok(SourceTransactionRecovery::Finalize)
        }
        SourceTransactionPhase::RolledBack
            if inferred == SourceTransactionRecovery::RollBack
                || current_revision.is_some_and(|revision| revision > next_revision) =>
        {
            Ok(SourceTransactionRecovery::RollBack)
        }
        SourceTransactionPhase::StateCommitted => Err(
            "Button source transaction is marked committed, but canonical Button state is still at its rollback boundary."
                .to_string(),
        ),
        SourceTransactionPhase::RolledBack => Err(
            "Button source transaction is marked rolled back, but canonical Button state contains its commit."
                .to_string(),
        ),
    }
}

fn transaction_root_is_empty(path: &Path) -> Result<bool, String> {
    Ok(fs::read_dir(path)
        .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?
        .next()
        .transpose()
        .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?
        .is_none())
}

fn recover_source_transactions_locked(state_path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut finalize = crate::program_sources::recover_standalone_source_transactions_locked()?;
    recover_button_state(state_path)?;
    let current_document = if state_path.is_file() {
        Some(read_button_state_document(state_path)?)
    } else {
        None
    };
    let quarantine_root = source_quarantine_root()?;
    if !quarantine_root.is_dir() {
        return Ok(finalize);
    }

    let mut transaction_roots = Vec::new();
    for entry in fs::read_dir(&quarantine_root)
        .map_err(|error| format!("Failed to inspect {}: {error}", quarantine_root.display()))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to inspect {}: {error}", quarantine_root.display()))?;
        if entry.path().is_dir()
            && entry
                .file_name()
                .to_string_lossy()
                .to_ascii_lowercase()
                .starts_with("commit-")
        {
            transaction_roots.push(entry.path());
        }
    }
    transaction_roots.sort_by_key(|path| path.to_string_lossy().to_ascii_lowercase());

    for transaction_root in transaction_roots {
        let Some(mut journal) = read_source_transaction_journal(&transaction_root)? else {
            if transaction_root_is_empty(&transaction_root)? {
                finalize.push(transaction_root);
                continue;
            }
            return Err(format!(
                "Button source transaction {} has quarantined data but no recoverable journal.",
                transaction_root.display()
            ));
        };
        match classify_source_transaction(&journal, current_document.as_ref())? {
            SourceTransactionRecovery::Finalize => {
                if journal.phase == SourceTransactionPhase::Prepared {
                    journal.phase = SourceTransactionPhase::StateCommitted;
                    write_source_transaction_journal(
                        &transaction_root,
                        &journal,
                        AtomicWriteMode::Replace,
                    )?;
                }
                finalize.push(transaction_root);
            }
            SourceTransactionRecovery::RollBack => {
                if journal.phase == SourceTransactionPhase::Prepared {
                    crate::program_sources::rollback_quarantined_transaction(
                        &transaction_root,
                        &journal.owner_button_ids,
                    )?;
                    journal.phase = SourceTransactionPhase::RolledBack;
                    write_source_transaction_journal(
                        &transaction_root,
                        &journal,
                        AtomicWriteMode::Replace,
                    )?;
                }
                finalize.push(transaction_root);
            }
        }
    }
    Ok(finalize)
}

fn finalize_source_transaction_roots(paths: &[PathBuf]) {
    let existing = paths
        .iter()
        .filter(|path| path.is_dir())
        .cloned()
        .collect::<Vec<_>>();
    if !existing.is_empty() {
        let _ = crate::recycle_directory_paths(&existing);
    }
}

fn document_source_owners(document: &Value, verify_active: bool) -> Result<Vec<String>, String> {
    let buttons = document
        .get("buttons")
        .and_then(Value::as_object)
        .ok_or_else(|| "Button state is missing its buttons object.".to_string())?;
    let mut owners = Vec::new();
    for (button_id, button) in buttons {
        let is_frontend_macro = button
            .get("metadata")
            .and_then(Value::as_object)
            .and_then(|metadata| metadata.get("sourceKind"))
            .and_then(Value::as_str)
            .is_some_and(|kind| kind.eq_ignore_ascii_case("frontend-macro"));
        if is_frontend_macro {
            continue;
        }
        let source_identity = button
            .get("sourceIdentity")
            .filter(|value| !value.is_null());
        let Some(source_identity) = source_identity else {
            continue;
        };
        let owner = crate::program_sources::validate_owner_button_id(button_id)?;
        let identity = source_identity
            .as_object()
            .ok_or_else(|| format!("Button '{button_id}' has an invalid sourceIdentity."))?;
        let field = |name: &str| {
            identity
                .get(name)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| format!("Button '{button_id}' sourceIdentity is missing {name}."))
        };
        let program_name = field("displayProgramName")?;
        let panel_name = field("displayPanelName")?;
        let file_name = field("displayFileName")?;
        if verify_active {
            let resolution = crate::program_sources::execute::resolve_active_source_record(
                program_name,
                panel_name,
                file_name,
            )?
            .ok_or_else(|| {
                format!("Button '{button_id}' does not reference an active owned source record.")
            })?;
            if resolution.record.owner_button_id != owner {
                return Err(format!(
                    "Button '{button_id}' references source owned by '{}'.",
                    resolution.record.owner_button_id
                ));
            }
        }
        owners.push(owner);
    }
    owners.sort_by_key(|value| value.to_ascii_lowercase());
    owners.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    Ok(owners)
}

fn restore_previous_state(path: &Path, previous: Option<&Value>) -> Result<(), String> {
    if let Some(previous) = previous {
        atomic_write_json(path, previous)
    } else if path.is_file() {
        crate::recycle_file_path(path)
    } else {
        Ok(())
    }
}

fn rollback_source_transaction(
    transaction_root: &Path,
    journal: &mut ButtonSourceTransactionJournal,
    state_path: &Path,
    restore_state: bool,
) -> (Vec<String>, bool) {
    let mut rollback_errors = Vec::new();
    if restore_state {
        if let Err(error) = restore_previous_state(state_path, journal.previous_document.as_ref()) {
            rollback_errors.push(format!("Button state restore failed: {error}"));
        }
    }
    if let Err(error) = crate::program_sources::rollback_quarantined_transaction(
        transaction_root,
        &journal.owner_button_ids,
    ) {
        rollback_errors.push(format!("owned source restore failed: {error}"));
    }
    if rollback_errors.is_empty() {
        journal.phase = SourceTransactionPhase::RolledBack;
        if let Err(error) =
            write_source_transaction_journal(transaction_root, journal, AtomicWriteMode::Replace)
        {
            rollback_errors.push(format!("rollback journal update failed: {error}"));
        }
    }
    let can_finalize = rollback_errors.is_empty();
    (rollback_errors, can_finalize)
}

fn compound_rollback_error(error: String, rollback_errors: Vec<String>) -> String {
    if rollback_errors.is_empty() {
        error
    } else {
        format!("{error} Rollback failed: {}", rollback_errors.join(" | "))
    }
}

fn resolve_program_rename_post_commit<F>(
    completion: Result<(), String>,
    recover: F,
) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    match completion {
        Ok(()) => Ok(()),
        Err(completion_error) => recover().map_err(|recovery_error| {
            format!(
                "Canonical Button state was saved, but program rename finalization failed: {completion_error} Recovery also failed: {recovery_error}"
            )
        }),
    }
}

#[tauri::command]
pub(crate) fn load_button_state() -> Result<Option<Value>, String> {
    let lock = BUTTON_STATE_COMMIT_LOCK.get_or_init(|| Mutex::new(()));
    let guard = lock
        .lock()
        .map_err(|_| "Button state commit lock is poisoned.".to_string())?;
    let source_guard = crate::program_sources::source_quarantine_guard()?;
    let path = button_state_path()?;
    let cleanup = recover_source_transactions_locked(&path)?;
    let result = if path.is_file() {
        read_button_state_document(&path).map(Some)
    } else {
        Ok(None)
    };
    drop(source_guard);
    drop(guard);
    finalize_source_transaction_roots(&cleanup);
    result
}

pub(crate) fn recover_button_source_transactions_on_startup() -> Result<(), String> {
    let lock = BUTTON_STATE_COMMIT_LOCK.get_or_init(|| Mutex::new(()));
    let guard = lock
        .lock()
        .map_err(|_| "Button state commit lock is poisoned.".to_string())?;
    let source_guard = crate::program_sources::source_quarantine_guard()?;
    let path = button_state_path()?;
    let cleanup = recover_source_transactions_locked(&path)?;
    drop(source_guard);
    drop(guard);
    finalize_source_transaction_roots(&cleanup);
    Ok(())
}

pub(crate) fn recover_program_rename_transactions_on_startup() -> Result<usize, String> {
    let guard = button_state_commit_guard()?;
    let source_guard = crate::program_sources::source_quarantine_guard()?;
    let current = read_button_state_for_program_rename_locked()?;
    let result = crate::commands::program_rename::recover_program_renames_locked(current.as_ref());
    drop(source_guard);
    drop(guard);
    result
}

// The caller must hold the Button source quarantine lock. Canonical commits
// acquire that lock before reading or writing source ownership, so this check
// cannot race a commit that is adding or removing the same installed source.
pub(crate) fn canonical_state_references_source_owner_while_source_locked(
    owner_button_id: &str,
) -> Result<bool, String> {
    let owner = crate::program_sources::validate_owner_button_id(owner_button_id)?;
    let path = button_state_path()?;
    recover_button_state(&path)?;
    if !path.is_file() {
        return Ok(false);
    }
    Ok(
        document_source_owners(&read_button_state_document(&path)?, false)?
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(&owner)),
    )
}

#[tauri::command]
pub(crate) fn commit_button_state(
    app: tauri::AppHandle,
    request: CommitButtonStateRequest,
) -> Result<(), String> {
    let lock = BUTTON_STATE_COMMIT_LOCK.get_or_init(|| Mutex::new(()));
    let guard = lock
        .lock()
        .map_err(|_| "Button state commit lock is poisoned.".to_string())?;
    let source_guard = crate::program_sources::source_quarantine_guard()?;
    validate_button_state(&request.document)?;
    let next_revision = document_revision(&request.document)?;
    let required_revision = request
        .expected_revision
        .checked_add(1)
        .ok_or_else(|| "Button state revision cannot advance beyond u64::MAX.".to_string())?;
    if next_revision != required_revision {
        return Err(format!(
            "Button state revision {} must follow expected revision {}.",
            next_revision, request.expected_revision
        ));
    }

    let state_path = button_state_path()?;
    let mut cleanup = recover_source_transactions_locked(&state_path)?;
    let previous_document = if state_path.is_file() {
        Some(read_button_state_document(&state_path)?)
    } else {
        None
    };
    let current_revision = previous_document
        .as_ref()
        .map(document_revision)
        .transpose()?
        .unwrap_or(0);
    if current_revision != request.expected_revision {
        return Err(format!(
            "Button state changed before Save. Expected revision {}, found {}.",
            request.expected_revision, current_revision
        ));
    }

    let program_rename_token = request
        .program_rename_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if crate::commands::program_rename::has_pending_program_rename_transaction()?
        && program_rename_token.is_none()
    {
        return Err(
            "Canonical Button state is locked by a pending program rename transaction.".to_string(),
        );
    }
    let mut program_rename_post_commit_error = None;
    if let Some(token) = program_rename_token.as_deref() {
        crate::commands::program_rename::prepare_canonical_commit_locked(
            token,
            previous_document.as_ref(),
            &request.document,
        )?;
    }

    let previous_source_owners = previous_document
        .as_ref()
        .map(|document| document_source_owners(document, false))
        .transpose()?
        .unwrap_or_default();
    let next_source_owners = document_source_owners(&request.document, true)?;

    let mut owner_ids = Vec::new();
    for value in request.uninstall_owner_button_ids {
        let owner = crate::program_sources::validate_owner_button_id(&value)?;
        if !owner_ids
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(&owner))
        {
            owner_ids.push(owner);
        }
    }
    let mut required_uninstalls = previous_source_owners
        .into_iter()
        .filter(|owner| {
            !next_source_owners
                .iter()
                .any(|next| next.eq_ignore_ascii_case(owner))
        })
        .collect::<Vec<_>>();
    required_uninstalls.sort_by_key(|value| value.to_ascii_lowercase());
    let mut supplied_uninstalls = owner_ids.clone();
    supplied_uninstalls.sort_by_key(|value| value.to_ascii_lowercase());
    if required_uninstalls.len() != supplied_uninstalls.len()
        || required_uninstalls.iter().any(|required| {
            !supplied_uninstalls
                .iter()
                .any(|supplied| supplied.eq_ignore_ascii_case(required))
        })
    {
        return Err(format!(
            "Button source uninstall set does not match removed source owners. Required: [{}]. Supplied: [{}].",
            required_uninstalls.join(", "),
            supplied_uninstalls.join(", ")
        ));
    }

    let transaction = if owner_ids.is_empty() {
        None
    } else {
        let transaction_root = source_quarantine_root()?.join(format!(
            "commit-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let journal = ButtonSourceTransactionJournal {
            schema_version: SOURCE_TRANSACTION_SCHEMA_VERSION,
            phase: SourceTransactionPhase::Prepared,
            previous_document: previous_document.clone(),
            next_document: request.document.clone(),
            owner_button_ids: owner_ids.clone(),
        };
        write_source_transaction_journal(&transaction_root, &journal, AtomicWriteMode::Create)?;
        Some((transaction_root, journal))
    };

    if let Some((transaction_root, journal)) = transaction.as_ref() {
        for owner in &owner_ids {
            if let Err(error) =
                crate::program_sources::quarantine_owned_source(owner, transaction_root)
            {
                let mut journal = journal.clone();
                let (rollback_errors, can_finalize) =
                    rollback_source_transaction(transaction_root, &mut journal, &state_path, false);
                if can_finalize {
                    cleanup.push(transaction_root.clone());
                }
                let result = Err(compound_rollback_error(error, rollback_errors));
                drop(source_guard);
                drop(guard);
                finalize_source_transaction_roots(&cleanup);
                return result;
            }
        }
    }

    if let Err(error) = atomic_write_json(&state_path, &request.document) {
        if let Some((transaction_root, journal)) = transaction.as_ref() {
            let mut journal = journal.clone();
            let (rollback_errors, can_finalize) =
                rollback_source_transaction(transaction_root, &mut journal, &state_path, false);
            if can_finalize {
                cleanup.push(transaction_root.clone());
            }
            let result = Err(compound_rollback_error(error, rollback_errors));
            drop(source_guard);
            drop(guard);
            finalize_source_transaction_roots(&cleanup);
            return result;
        }
        drop(source_guard);
        drop(guard);
        finalize_source_transaction_roots(&cleanup);
        return Err(error);
    }

    if let Some(token) = request
        .migration_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if let Err(error) = crate::program_sources::finalize_migration_token(token) {
            if let Some((transaction_root, journal)) = transaction.as_ref() {
                let mut journal = journal.clone();
                let (rollback_errors, can_finalize) =
                    rollback_source_transaction(transaction_root, &mut journal, &state_path, true);
                if can_finalize {
                    cleanup.push(transaction_root.clone());
                }
                let result = Err(compound_rollback_error(error, rollback_errors));
                drop(source_guard);
                drop(guard);
                finalize_source_transaction_roots(&cleanup);
                return result;
            }
            let rollback_errors = restore_previous_state(&state_path, previous_document.as_ref())
                .err()
                .map(|rollback_error| {
                    vec![format!("Button state restore failed: {rollback_error}")]
                })
                .unwrap_or_default();
            let result = Err(compound_rollback_error(error, rollback_errors));
            drop(source_guard);
            drop(guard);
            finalize_source_transaction_roots(&cleanup);
            return result;
        }
    }

    if let Some(token) = program_rename_token.as_deref() {
        // The canonical file is already committed. If the final journal update
        // is interrupted, startup compares the exact pre/post documents and
        // deterministically completes this same side of the transaction.
        let completion = crate::commands::program_rename::complete_canonical_commit_locked(
            token,
            &request.document,
        );
        if let Err(error) = resolve_program_rename_post_commit(completion, || {
            crate::commands::program_rename::resolve_program_rename_locked(
                token,
                Some(&request.document),
            )
            .map(|_| ())
        }) {
            program_rename_post_commit_error = Some(error);
        }
    }

    if let Some((transaction_root, mut journal)) = transaction {
        journal.phase = SourceTransactionPhase::StateCommitted;
        if let Err(error) =
            write_source_transaction_journal(&transaction_root, &journal, AtomicWriteMode::Replace)
        {
            // Canonical state is already committed. Leave the prepared journal
            // in place so startup recovery can infer the same commit boundary.
            let _ = error;
            drop(source_guard);
            drop(guard);
            finalize_source_transaction_roots(&cleanup);
            synchronize_child_hotkeys_after_commit(&app);
            return match program_rename_post_commit_error {
                Some(program_error) => Err(program_error),
                None => Ok(()),
            };
        }
        cleanup.push(transaction_root);
    }
    drop(source_guard);
    drop(guard);
    finalize_source_transaction_roots(&cleanup);
    synchronize_child_hotkeys_after_commit(&app);
    match program_rename_post_commit_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        classify_source_transaction, document_source_owners, read_button_state_document,
        recover_button_state, resolve_program_rename_post_commit, validate_button_state,
        ButtonSourceTransactionJournal, SourceTransactionPhase, SourceTransactionRecovery,
        SOURCE_TRANSACTION_SCHEMA_VERSION,
    };
    use serde_json::json;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn button_state_requires_positive_schema_version() {
        assert!(validate_button_state(&json!({ "schemaVersion": 1 })).is_ok());
        assert!(validate_button_state(&json!({ "schemaVersion": 0 })).is_err());
        assert!(validate_button_state(&json!({})).is_err());
    }

    #[test]
    fn post_commit_program_rename_failure_is_hidden_only_when_recovery_succeeds() {
        assert!(
            resolve_program_rename_post_commit(Err("finalize failed".to_string()), || Ok(()))
                .is_ok()
        );
        let error = resolve_program_rename_post_commit(Err("finalize failed".to_string()), || {
            Err("recovery failed".to_string())
        })
        .expect_err("double failure must be returned after canonical commit");
        assert!(error.contains("Canonical Button state was saved"));
        assert!(error.contains("finalize failed"));
        assert!(error.contains("recovery failed"));
    }

    #[test]
    fn frontend_macro_identity_is_not_treated_as_an_installed_source_owner() {
        let document = json!({
            "buttons": {
                "macro-one": {
                    "sourceIdentity": {
                        "displayProgramName": "Windows",
                        "displayPanelName": "Files",
                        "displayFileName": "macro:one"
                    },
                    "metadata": {"sourceKind":"frontend-macro"}
                }
            }
        });
        assert!(document_source_owners(&document, false)
            .expect("collect source owners")
            .is_empty());
    }

    #[test]
    fn missing_button_state_is_recovered_from_a_valid_backup() {
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "flowcell-button-state-recovery-{}-{token}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create recovery test root");
        let state_path = root.join("button-state.json");
        let backup_path = root.join(".button-state.json.1.backup");
        fs::write(
            &backup_path,
            serde_json::to_string(&json!({"schemaVersion": 1, "revision": 7}))
                .expect("serialize backup"),
        )
        .expect("write backup");

        recover_button_state(&state_path).expect("recover Button state");

        assert!(state_path.is_file());
        assert!(!backup_path.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn source_transaction_recovery_uses_the_canonical_state_commit_boundary() {
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "flowcell-source-transaction-cut-{}-{token}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create transaction cut test root");
        let previous = json!({"schemaVersion": 1, "revision": 4});
        let next = json!({"schemaVersion": 1, "revision": 5});
        let journal = ButtonSourceTransactionJournal {
            schema_version: SOURCE_TRANSACTION_SCHEMA_VERSION,
            phase: SourceTransactionPhase::Prepared,
            previous_document: Some(previous.clone()),
            next_document: next.clone(),
            owner_button_ids: vec!["owner-one".to_string()],
        };

        // Cut before the staged next state is renamed into place: the atomic
        // state recovery selects the old backup, so owned resources roll back.
        let before_commit = root.join("before/button-state.json");
        fs::create_dir_all(before_commit.parent().expect("before parent"))
            .expect("create before directory");
        fs::write(
            before_commit.with_file_name(".button-state.json.1.backup"),
            serde_json::to_vec(&previous).expect("serialize previous"),
        )
        .expect("write previous backup");
        fs::write(
            before_commit.with_file_name(".button-state.json.2.writing"),
            serde_json::to_vec(&next).expect("serialize next"),
        )
        .expect("write staged next");
        recover_button_state(&before_commit).expect("recover pre-commit state");
        let recovered_previous =
            read_button_state_document(&before_commit).expect("read recovered previous state");
        assert_eq!(
            classify_source_transaction(&journal, Some(&recovered_previous))
                .expect("classify pre-commit cut"),
            SourceTransactionRecovery::RollBack
        );

        // Cut after the rename commit point but before source cleanup: the
        // canonical next state wins even while the old backup still exists.
        let after_commit = root.join("after/button-state.json");
        fs::create_dir_all(after_commit.parent().expect("after parent"))
            .expect("create after directory");
        fs::write(
            &after_commit,
            serde_json::to_vec(&next).expect("serialize canonical next"),
        )
        .expect("write canonical next");
        fs::write(
            after_commit.with_file_name(".button-state.json.3.backup"),
            serde_json::to_vec(&previous).expect("serialize previous backup"),
        )
        .expect("write stale previous backup");
        recover_button_state(&after_commit).expect("recover post-commit state");
        let recovered_next =
            read_button_state_document(&after_commit).expect("read recovered next state");
        assert_eq!(
            classify_source_transaction(&journal, Some(&recovered_next))
                .expect("classify post-commit cut"),
            SourceTransactionRecovery::Finalize
        );

        let divergent = json!({"schemaVersion": 1, "revision": 5, "different": true});
        assert!(classify_source_transaction(&journal, Some(&divergent)).is_err());
        let later = json!({"schemaVersion": 1, "revision": 6});
        assert_eq!(
            classify_source_transaction(&journal, Some(&later))
                .expect("classify later canonical state"),
            SourceTransactionRecovery::Finalize
        );

        let _ = fs::remove_dir_all(root);
    }
}
