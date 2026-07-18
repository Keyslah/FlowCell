use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::program_sources::transaction::{self, AtomicWriteMode};

const PROGRAM_RENAME_TRANSACTION_FOLDER: &str = "program-rename-transactions";
const PROGRAM_RENAME_JOURNAL_FILE: &str = "journal.json";
const PROGRAM_RENAME_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum ProgramRenamePhase {
    Prepared,
    NativeCommitted,
    CanonicalPrepared,
    CanonicalCommitted,
    RolledBack,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgramRenameJournal {
    schema_version: u32,
    token: String,
    phase: ProgramRenamePhase,
    current_name: String,
    next_name: String,
    temporary_name: Option<String>,
    previous_bindings: Option<Vec<u8>>,
    next_bindings: Vec<u8>,
    previous_button_document: Option<Value>,
    next_button_document: Option<Value>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BeginProgramRenameResult {
    pub(crate) program_name: String,
    pub(crate) rename_token: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RenameDirection {
    Previous,
    Next,
}

fn transaction_root() -> Result<PathBuf, String> {
    Ok(crate::resolve_flowcell_local_root()?.join(PROGRAM_RENAME_TRANSACTION_FOLDER))
}

fn journal_path(root: &Path) -> PathBuf {
    root.join(PROGRAM_RENAME_JOURNAL_FILE)
}

fn validate_token(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 160
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("Program rename transaction token is invalid.".to_string());
    }
    Ok(value.to_string())
}

fn validate_journal(journal: &ProgramRenameJournal, root: &Path) -> Result<(), String> {
    if journal.schema_version != PROGRAM_RENAME_SCHEMA_VERSION {
        return Err(format!(
            "Program rename transaction uses unsupported schemaVersion {}.",
            journal.schema_version
        ));
    }
    let token = validate_token(&journal.token)?;
    if root.file_name().and_then(|value| value.to_str()) != Some(token.as_str()) {
        return Err("Program rename transaction token does not match its folder.".to_string());
    }
    crate::validate_folder_name(&journal.current_name, "Program")?;
    crate::validate_folder_name(&journal.next_name, "Program")?;
    if journal.current_name == journal.next_name {
        return Err("Program rename transaction must change the program name.".to_string());
    }
    if let Some(temporary_name) = &journal.temporary_name {
        crate::validate_folder_name(temporary_name, "Program rename temporary")?;
    }
    if journal.next_bindings.len() > 16 * 1024 * 1024
        || journal
            .previous_bindings
            .as_ref()
            .is_some_and(|value| value.len() > 16 * 1024 * 1024)
    {
        return Err("Program rename bindings snapshot is unexpectedly large.".to_string());
    }
    Ok(())
}

fn parse_journal(root: &Path, path: &Path) -> Result<ProgramRenameJournal, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let journal = serde_json::from_str::<ProgramRenameJournal>(&raw).map_err(|error| {
        format!(
            "Program rename journal {} is invalid: {error}",
            path.display()
        )
    })?;
    validate_journal(&journal, root)?;
    Ok(journal)
}

fn read_journal(root: &Path) -> Result<ProgramRenameJournal, String> {
    let path = journal_path(root);
    transaction::recover_json_file(&path, |candidate| {
        parse_journal(root, candidate).map(|_| ())
    })?;
    parse_journal(root, &path)
}

fn write_journal(
    root: &Path,
    journal: &ProgramRenameJournal,
    mode: AtomicWriteMode,
) -> Result<(), String> {
    validate_journal(journal, root)?;
    let raw = serde_json::to_vec_pretty(journal)
        .map_err(|error| format!("Failed to serialize program rename journal: {error}"))?;
    transaction::write_json_file(&journal_path(root), &raw, mode)
}

fn transaction_directories() -> Result<Vec<PathBuf>, String> {
    let root = transaction_root()?;
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut paths = fs::read_dir(&root)
        .map_err(|error| format!("Failed to inspect {}: {error}", root.display()))?
        .filter_map(Result::ok)
        .filter_map(|entry| match entry.file_type() {
            Ok(file_type) if file_type.is_dir() && !file_type.is_symlink() => Some(entry.path()),
            _ => None,
        })
        .collect::<Vec<_>>();
    paths.sort();
    Ok(paths)
}

pub(crate) fn has_pending_program_rename_transaction() -> Result<bool, String> {
    Ok(!transaction_directories()?.is_empty())
}

fn locate_transaction(token: &str) -> Result<PathBuf, String> {
    let token = validate_token(token)?;
    transaction_directories()?
        .into_iter()
        .find(|path| path.file_name().and_then(|value| value.to_str()) == Some(token.as_str()))
        .ok_or_else(|| "Program rename transaction is unknown or already finalized.".to_string())
}

fn exact_directory(root: &Path, name: &str) -> Result<Option<PathBuf>, String> {
    for entry in fs::read_dir(root)
        .map_err(|error| format!("Failed to inspect {}: {error}", root.display()))?
    {
        let entry =
            entry.map_err(|error| format!("Failed to inspect {}: {error}", root.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() && entry.file_name().to_string_lossy() == name {
            return Ok(Some(entry.path()));
        }
    }
    Ok(None)
}

fn reconcile_program_folder(
    programs_root: &Path,
    journal: &ProgramRenameJournal,
    direction: RenameDirection,
) -> Result<PathBuf, String> {
    let desired_name = match direction {
        RenameDirection::Previous => &journal.current_name,
        RenameDirection::Next => &journal.next_name,
    };
    let source_name = match direction {
        RenameDirection::Previous => &journal.next_name,
        RenameDirection::Next => &journal.current_name,
    };
    let desired_path = programs_root.join(desired_name);

    if journal
        .current_name
        .eq_ignore_ascii_case(&journal.next_name)
    {
        let temporary_name = journal
            .temporary_name
            .as_deref()
            .ok_or_else(|| "Case-only program rename is missing its temporary name.".to_string())?;
        let temporary_path = programs_root.join(temporary_name);
        if let Some(path) = exact_directory(programs_root, desired_name)? {
            return Ok(path);
        }
        if let Some(path) = exact_directory(programs_root, temporary_name)? {
            fs::rename(&path, &desired_path).map_err(|error| {
                format!(
                    "Failed to finish case-only program rename from {} to {}: {error}",
                    path.display(),
                    desired_path.display()
                )
            })?;
            return Ok(desired_path);
        }
        let source_path = exact_directory(programs_root, source_name)?.ok_or_else(|| {
            format!(
                "Program rename found neither '{}' nor its temporary folder '{}'.",
                source_name, temporary_name
            )
        })?;
        fs::rename(&source_path, &temporary_path).map_err(|error| {
            format!(
                "Failed to stage case-only program rename at {}: {error}",
                temporary_path.display()
            )
        })?;
        fs::rename(&temporary_path, &desired_path).map_err(|error| {
            format!(
                "Failed to finish case-only program rename at {}: {error}",
                desired_path.display()
            )
        })?;
        return Ok(desired_path);
    }

    let desired = exact_directory(programs_root, desired_name)?;
    let source = exact_directory(programs_root, source_name)?;
    match (desired, source) {
        (Some(path), None) => Ok(path),
        (None, Some(path)) => {
            fs::rename(&path, &desired_path).map_err(|error| {
                format!(
                    "Failed to reconcile program folder '{}' to '{}': {error}",
                    source_name, desired_name
                )
            })?;
            Ok(desired_path)
        }
        (Some(_), Some(_)) => Err(format!(
            "Program rename found both '{}' and '{}'; refusing to merge them.",
            journal.current_name, journal.next_name
        )),
        (None, None) => Err(format!(
            "Program rename found neither '{}' nor '{}'.",
            journal.current_name, journal.next_name
        )),
    }
}

fn read_program_manifest_label(program_root: &Path) -> Result<String, String> {
    let manifest_path = program_root.join("flowcell.program.json");
    let raw = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("Failed to read {}: {error}", manifest_path.display()))?;
    let value = serde_json::from_str::<Value>(&raw).map_err(|error| {
        format!(
            "Program manifest {} is invalid: {error}",
            manifest_path.display()
        )
    })?;
    value
        .get("label")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            format!(
                "Program manifest {} requires label.",
                manifest_path.display()
            )
        })
}

fn validate_program_manifest_label(
    program_root: &Path,
    journal: &ProgramRenameJournal,
    current_label: &str,
) -> Result<(), String> {
    if current_label != journal.current_name && current_label != journal.next_name {
        return Err(format!(
            "Program manifest {} changed outside the pending rename: label '{}' matches neither '{}' nor '{}'.",
            program_root.join("flowcell.program.json").display(),
            current_label,
            journal.current_name,
            journal.next_name
        ));
    }
    Ok(())
}

fn validate_program_manifest_side_at(
    programs_root: &Path,
    journal: &ProgramRenameJournal,
) -> Result<(), String> {
    for name in [
        Some(journal.current_name.as_str()),
        Some(journal.next_name.as_str()),
        journal.temporary_name.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        let Some(program_root) = exact_directory(programs_root, name)? else {
            continue;
        };
        crate::program_sources::rename::recover_rename_transactions_in_program(&program_root)?;
        let label = read_program_manifest_label(&program_root)?;
        validate_program_manifest_label(&program_root, journal, &label)?;
    }
    Ok(())
}

fn reconcile_program_identity(
    program_root: &Path,
    journal: &ProgramRenameJournal,
    desired_name: &str,
) -> Result<(), String> {
    crate::program_sources::rename::recover_rename_transactions_in_program(program_root)?;
    let current_label = read_program_manifest_label(program_root)?;
    validate_program_manifest_label(program_root, journal, &current_label)?;
    if current_label == desired_name {
        return Ok(());
    }
    crate::program_sources::rename::migrate_program_folder_identity(
        program_root,
        &current_label,
        desired_name,
    )
}

fn read_bindings_bytes_at(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(format!(
                "FlowCell bindings path {} must not be a symbolic link.",
                path.display()
            ));
        }
        Ok(metadata) if !metadata.is_file() => {
            return Err(format!(
                "FlowCell bindings path {} is not a regular file.",
                path.display()
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Failed to inspect {}: {error}", path.display())),
    }
    transaction::recover_json_file(path, |candidate| {
        fs::read(candidate)
            .map(|_| ())
            .map_err(|error| format!("Failed to read {}: {error}", candidate.display()))
    })?;
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(format!(
            "FlowCell bindings path {} must not be a symbolic link.",
            path.display()
        )),
        Ok(metadata) if metadata.is_file() => fs::read(path)
            .map(Some)
            .map_err(|error| format!("Failed to read {}: {error}", path.display())),
        Ok(_) => Err(format!(
            "FlowCell bindings path {} is not a regular file.",
            path.display()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Failed to inspect {}: {error}", path.display())),
    }
}

fn bindings_match_side(current: Option<&[u8]>, expected: Option<&[u8]>) -> bool {
    match (current, expected) {
        (None, None) => true,
        (Some(current), Some(expected)) => current == expected,
        _ => false,
    }
}

fn validate_bindings_side_at(
    path: &Path,
    journal: &ProgramRenameJournal,
) -> Result<Option<Vec<u8>>, String> {
    let current = read_bindings_bytes_at(path)?;
    let current_side = current.as_deref();
    if bindings_match_side(current_side, journal.previous_bindings.as_deref())
        || bindings_match_side(current_side, Some(journal.next_bindings.as_slice()))
    {
        return Ok(current);
    }
    Err(format!(
        "FlowCell bindings at {} changed outside the pending program rename; refusing to overwrite unrelated edits.",
        path.display()
    ))
}

fn reconcile_bindings_at(
    path: &Path,
    journal: &ProgramRenameJournal,
    direction: RenameDirection,
) -> Result<(), String> {
    let current = validate_bindings_side_at(path, journal)?;
    let desired = match direction {
        RenameDirection::Previous => journal.previous_bindings.as_deref(),
        RenameDirection::Next => Some(journal.next_bindings.as_slice()),
    };
    if bindings_match_side(current.as_deref(), desired) {
        return Ok(());
    }
    match desired {
        Some(contents) => super::bindings::write_bindings_bytes_atomic_unchecked(path, contents),
        None if current.is_some() => crate::recycle_file_path(path),
        None => Ok(()),
    }
}

fn reconcile_native_at(
    programs_root: &Path,
    bindings_path: &Path,
    journal: &ProgramRenameJournal,
    direction: RenameDirection,
) -> Result<(), String> {
    let desired_name = match direction {
        RenameDirection::Previous => &journal.current_name,
        RenameDirection::Next => &journal.next_name,
    };
    // Validate drift before moving the folder or rewriting any manifest-owned
    // identity, then validate again immediately before the bindings write.
    validate_bindings_side_at(bindings_path, journal)?;
    validate_program_manifest_side_at(programs_root, journal)?;
    let program_root = reconcile_program_folder(programs_root, journal, direction)?;
    reconcile_program_identity(&program_root, journal, desired_name)?;
    reconcile_bindings_at(bindings_path, journal, direction)
}

fn reconcile_native(
    journal: &ProgramRenameJournal,
    direction: RenameDirection,
) -> Result<(), String> {
    reconcile_native_at(
        &crate::resolve_programs_root()?,
        &super::bindings::resolve_bindings_file_path()?,
        journal,
        direction,
    )
}

fn finalize_root_with<F>(root: &Path, recycle: F) -> Result<(), String>
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    if root.is_dir() {
        recycle(root)?;
    }
    Ok(())
}

fn finalize_root(root: &Path) -> Result<(), String> {
    finalize_root_with(root, crate::recycle_directory_path)
}

fn compensate_failed_begin_with<R, W, F>(
    root: &Path,
    journal: &mut ProgramRenameJournal,
    failure: String,
    reconcile: &mut R,
    write: &mut W,
    finalize: &mut F,
) -> String
where
    R: FnMut(&ProgramRenameJournal, RenameDirection) -> Result<(), String>,
    W: FnMut(&Path, &ProgramRenameJournal, AtomicWriteMode) -> Result<(), String>,
    F: FnMut(&Path) -> Result<(), String>,
{
    if let Err(rollback_error) = reconcile(journal, RenameDirection::Previous) {
        return format!(
            "{failure} Rollback also failed: {rollback_error}. The recovery journal was retained at {}.",
            root.display()
        );
    }

    journal.phase = ProgramRenamePhase::RolledBack;
    if let Err(journal_error) = write(root, journal, AtomicWriteMode::Replace) {
        return format!(
            "{failure} Native state was rolled back, but recording the rollback failed: {journal_error}. The recovery journal was retained at {}.",
            root.display()
        );
    }
    if let Err(cleanup_error) = finalize(root) {
        return format!(
            "{failure} Native state was rolled back, but transaction cleanup failed: {cleanup_error}. The recovery journal was retained at {}.",
            root.display()
        );
    }
    format!("{failure} Native state was rolled back.")
}

fn commit_begin_native_with<R, W, F>(
    root: &Path,
    journal: &mut ProgramRenameJournal,
    mut reconcile: R,
    mut write: W,
    mut finalize: F,
) -> Result<(), String>
where
    R: FnMut(&ProgramRenameJournal, RenameDirection) -> Result<(), String>,
    W: FnMut(&Path, &ProgramRenameJournal, AtomicWriteMode) -> Result<(), String>,
    F: FnMut(&Path) -> Result<(), String>,
{
    if let Err(error) = reconcile(journal, RenameDirection::Next) {
        return Err(compensate_failed_begin_with(
            root,
            journal,
            format!("Program rename failed: {error}"),
            &mut reconcile,
            &mut write,
            &mut finalize,
        ));
    }

    journal.phase = ProgramRenamePhase::NativeCommitted;
    if let Err(error) = write(root, journal, AtomicWriteMode::Replace) {
        return Err(compensate_failed_begin_with(
            root,
            journal,
            format!(
                "Program rename changed native state, but recording the NativeCommitted phase failed: {error}."
            ),
            &mut reconcile,
            &mut write,
            &mut finalize,
        ));
    }
    Ok(())
}

pub(crate) fn begin_program_rename_locked(
    current_name: String,
    next_name: String,
    previous_bindings: Option<Vec<u8>>,
    next_bindings: Vec<u8>,
    previous_button_document: Option<Value>,
) -> Result<BeginProgramRenameResult, String> {
    if has_pending_program_rename_transaction()? {
        return Err("Another program rename transaction is still pending recovery.".to_string());
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let token = format!("rename-{}-{stamp}", std::process::id());
    let root = transaction_root()?.join(&token);
    fs::create_dir_all(&root)
        .map_err(|error| format!("Failed to create {}: {error}", root.display()))?;
    let temporary_name = current_name
        .eq_ignore_ascii_case(&next_name)
        .then(|| format!(".flowcell-program-{token}"));
    let mut journal = ProgramRenameJournal {
        schema_version: PROGRAM_RENAME_SCHEMA_VERSION,
        token: token.clone(),
        phase: ProgramRenamePhase::Prepared,
        current_name,
        next_name: next_name.clone(),
        temporary_name,
        previous_bindings,
        next_bindings,
        previous_button_document,
        next_button_document: None,
    };
    if let Err(error) = write_journal(&root, &journal, AtomicWriteMode::Create) {
        return match finalize_root(&root) {
            Ok(()) => Err(error),
            Err(cleanup_error) => Err(format!(
                "{error} Empty program rename transaction cleanup also failed: {cleanup_error}"
            )),
        };
    }

    commit_begin_native_with(
        &root,
        &mut journal,
        reconcile_native,
        write_journal,
        finalize_root,
    )?;
    Ok(BeginProgramRenameResult {
        program_name: next_name,
        rename_token: token,
    })
}

pub(crate) fn prepare_canonical_commit_locked(
    token: &str,
    current_document: Option<&Value>,
    next_document: &Value,
) -> Result<(), String> {
    let root = locate_transaction(token)?;
    let mut journal = read_journal(&root)?;
    if current_document != journal.previous_button_document.as_ref() {
        return Err(
            "Canonical Button state changed after the program rename began; refusing an ambiguous commit."
                .to_string(),
        );
    }
    journal.next_button_document = Some(next_document.clone());
    journal.phase = ProgramRenamePhase::CanonicalPrepared;
    write_journal(&root, &journal, AtomicWriteMode::Replace)
}

pub(crate) fn complete_canonical_commit_locked(
    token: &str,
    document: &Value,
) -> Result<(), String> {
    let root = locate_transaction(token)?;
    let mut journal = read_journal(&root)?;
    if journal.next_button_document.as_ref() != Some(document) {
        return Err(
            "Committed Button state does not match the program rename journal.".to_string(),
        );
    }
    journal.phase = ProgramRenamePhase::CanonicalCommitted;
    write_journal(&root, &journal, AtomicWriteMode::Replace)?;
    finalize_root(&root)
}

pub(crate) fn finalize_without_canonical_change_locked(
    token: &str,
    current_document: Option<&Value>,
) -> Result<(), String> {
    let root = locate_transaction(token)?;
    let mut journal = read_journal(&root)?;
    if current_document != journal.previous_button_document.as_ref() {
        return Err(
            "Canonical Button state changed before program rename finalization.".to_string(),
        );
    }
    journal.next_button_document = journal.previous_button_document.clone();
    journal.phase = ProgramRenamePhase::CanonicalCommitted;
    write_journal(&root, &journal, AtomicWriteMode::Replace)?;
    finalize_root(&root)
}

fn recovery_direction(
    journal: &ProgramRenameJournal,
    current_document: Option<&Value>,
) -> Result<RenameDirection, String> {
    if let Some(next) = journal.next_button_document.as_ref() {
        if current_document == Some(next) {
            return Ok(RenameDirection::Next);
        }
    }
    if current_document == journal.previous_button_document.as_ref() {
        return Ok(RenameDirection::Previous);
    }
    Err(format!(
        "Canonical Button state matches neither side of pending program rename '{}' -> '{}'.",
        journal.current_name, journal.next_name
    ))
}

fn recover_root_at(
    root: &Path,
    current_document: Option<&Value>,
    programs_root: &Path,
    bindings_path: &Path,
) -> Result<(), String> {
    let mut journal = read_journal(root)?;
    let direction = recovery_direction(&journal, current_document)?;
    reconcile_native_at(programs_root, bindings_path, &journal, direction)?;
    journal.phase = match direction {
        RenameDirection::Previous => ProgramRenamePhase::RolledBack,
        RenameDirection::Next => ProgramRenamePhase::CanonicalCommitted,
    };
    write_journal(root, &journal, AtomicWriteMode::Replace)?;
    finalize_root(root)
}

fn recover_root(root: &Path, current_document: Option<&Value>) -> Result<(), String> {
    recover_root_at(
        root,
        current_document,
        &crate::resolve_programs_root()?,
        &super::bindings::resolve_bindings_file_path()?,
    )
}

pub(crate) fn rollback_program_rename_locked(
    token: &str,
    current_document: Option<&Value>,
) -> Result<(), String> {
    let root = locate_transaction(token)?;
    let journal = read_journal(&root)?;
    if current_document != journal.previous_button_document.as_ref() {
        return Err(
            "Canonical Button state is no longer the pre-rename state; refusing rollback."
                .to_string(),
        );
    }
    reconcile_native(&journal, RenameDirection::Previous)?;
    let mut journal = journal;
    journal.phase = ProgramRenamePhase::RolledBack;
    write_journal(&root, &journal, AtomicWriteMode::Replace)?;
    finalize_root(&root)
}

pub(crate) fn resolve_program_rename_locked(
    token: &str,
    current_document: Option<&Value>,
) -> Result<bool, String> {
    let token = validate_token(token)?;
    match locate_transaction(&token) {
        Ok(root) => recover_root(&root, current_document).map(|()| true),
        Err(_) if !has_pending_program_rename_transaction()? => Ok(false),
        Err(error) => Err(error),
    }
}

fn recover_program_rename_roots_with<F>(
    roots: Vec<PathBuf>,
    mut recover: F,
) -> Result<usize, String>
where
    F: FnMut(&Path) -> Result<(), String>,
{
    let recovered = roots.len();
    for root in roots {
        recover(&root)?;
    }
    Ok(recovered)
}

pub(crate) fn recover_program_renames_locked(
    current_document: Option<&Value>,
) -> Result<usize, String> {
    recover_program_rename_roots_with(transaction_directories()?, |root| {
        recover_root(root, current_document)
    })
}

#[cfg(test)]
mod tests {
    use super::{
        commit_begin_native_with, finalize_root_with, recover_program_rename_roots_with,
        recover_root_at, recovery_direction, write_journal, ProgramRenameJournal,
        ProgramRenamePhase, RenameDirection,
    };
    use crate::program_sources::transaction::AtomicWriteMode;
    use serde_json::json;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "flowcell-program-rename-{}-{}",
            label,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }

    fn write_program_manifest(root: &Path, label: &str) {
        fs::create_dir_all(root).expect("create program root");
        fs::write(
            root.join("flowcell.program.json"),
            serde_json::to_vec_pretty(&json!({
                "schemaVersion": 1,
                "programId": "test",
                "label": label,
                "programType": "local-script",
                "defaultPanels": [],
                "processNames": ["test"],
                "gitScriptsFolder": "Git Scripts",
                "panelsFolder": "Panels",
                "localScriptsFolder": "Local Scripts",
                "supportScriptsFolder": "SupportScripts",
                "allowedScriptExtensions": ["ps1"],
                "allowedManifestFileNames": ["flowcell.script.json"],
                "supportsToolsetManifests": false,
                "runner": {
                    "kind": "windows-script",
                    "programKey": "test",
                    "installScript": "",
                    "deleteScript": ""
                },
                "addonReloadNotes": "",
                "appRestartNotes": ""
            }))
            .expect("serialize manifest"),
        )
        .expect("write manifest");
    }

    fn disk_journal(
        transaction_root: &Path,
        current_name: &str,
        next_name: &str,
        temporary_name: Option<String>,
        phase: ProgramRenamePhase,
        next_document: Option<serde_json::Value>,
    ) -> ProgramRenameJournal {
        let journal = ProgramRenameJournal {
            schema_version: 1,
            token: transaction_root
                .file_name()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            phase,
            current_name: current_name.to_string(),
            next_name: next_name.to_string(),
            temporary_name,
            previous_bindings: Some(b"old-bindings".to_vec()),
            next_bindings: b"new-bindings".to_vec(),
            previous_button_document: Some(json!({"revision": 1, "side": "old"})),
            next_button_document: next_document,
        };
        write_journal(transaction_root, &journal, AtomicWriteMode::Create)
            .expect("write outer journal");
        journal
    }

    fn journal() -> ProgramRenameJournal {
        ProgramRenameJournal {
            schema_version: 1,
            token: "rename-1-1".to_string(),
            phase: ProgramRenamePhase::CanonicalPrepared,
            current_name: "Blender".to_string(),
            next_name: "Blender 2".to_string(),
            temporary_name: None,
            previous_bindings: Some(b"old".to_vec()),
            next_bindings: b"new".to_vec(),
            previous_button_document: Some(json!({"revision": 1})),
            next_button_document: Some(json!({"revision": 2})),
        }
    }

    #[test]
    fn exact_pre_and_post_documents_choose_deterministic_recovery_direction() {
        let journal = journal();
        assert_eq!(
            recovery_direction(&journal, Some(&json!({"revision": 1}))).unwrap(),
            RenameDirection::Previous
        );
        assert_eq!(
            recovery_direction(&journal, Some(&json!({"revision": 2}))).unwrap(),
            RenameDirection::Next
        );
        assert!(recovery_direction(&journal, Some(&json!({"revision": 3}))).is_err());
    }

    #[test]
    fn transaction_cleanup_failure_is_returned_and_retains_the_journal_root() {
        let root = test_root("cleanup-failure");
        fs::create_dir_all(&root).expect("create cleanup test root");
        let error = finalize_root_with(&root, |_| Err("forced recycle failure".to_string()))
            .expect_err("cleanup failure must be visible");
        assert!(error.contains("forced recycle failure"));
        assert!(root.is_dir());
        fs::remove_dir_all(root).expect("remove cleanup test root");
    }

    #[test]
    fn failed_native_begin_reports_cleanup_failure_after_successful_compensation() {
        let root = test_root("begin-cleanup-failure");
        fs::create_dir_all(&root).expect("create transaction root");
        let mut journal = journal();
        let mut directions = Vec::new();
        let error = commit_begin_native_with(
            &root,
            &mut journal,
            |_, direction| {
                directions.push(direction);
                match direction {
                    RenameDirection::Next => Err("forced native failure".to_string()),
                    RenameDirection::Previous => Ok(()),
                }
            },
            |_, _, _| Ok(()),
            |_| Err("forced recycle failure".to_string()),
        )
        .expect_err("cleanup failure must remain visible");

        assert_eq!(
            directions,
            vec![RenameDirection::Next, RenameDirection::Previous]
        );
        assert_eq!(journal.phase, ProgramRenamePhase::RolledBack);
        assert!(error.contains("forced native failure"));
        assert!(error.contains("forced recycle failure"));
        assert!(error.contains("retained"));
        fs::remove_dir_all(root).expect("remove cleanup test root");
    }

    #[test]
    fn native_committed_journal_write_failure_rolls_back_before_returning() {
        let root = test_root("native-phase-write-failure");
        fs::create_dir_all(&root).expect("create transaction root");
        let mut journal = journal();
        let mut directions = Vec::new();
        let mut written_phases = Vec::new();
        let mut failed_native_write = false;
        let error = commit_begin_native_with(
            &root,
            &mut journal,
            |_, direction| {
                directions.push(direction);
                Ok(())
            },
            |_, journal, _| {
                written_phases.push(journal.phase);
                if journal.phase == ProgramRenamePhase::NativeCommitted && !failed_native_write {
                    failed_native_write = true;
                    Err("forced NativeCommitted write failure".to_string())
                } else {
                    Ok(())
                }
            },
            |_| Ok(()),
        )
        .expect_err("phase write failure must abort the begin");

        assert_eq!(
            directions,
            vec![RenameDirection::Next, RenameDirection::Previous]
        );
        assert_eq!(
            written_phases,
            vec![
                ProgramRenamePhase::NativeCommitted,
                ProgramRenamePhase::RolledBack
            ]
        );
        assert_eq!(journal.phase, ProgramRenamePhase::RolledBack);
        assert!(error.contains("forced NativeCommitted write failure"));
        assert!(error.contains("rolled back"));
        fs::remove_dir_all(root).expect("remove phase write test root");
    }

    #[test]
    fn startup_recovery_reports_reconciled_outer_journal_count() {
        let roots = vec![PathBuf::from("rename-1"), PathBuf::from("rename-2")];
        let mut recovered = Vec::new();
        let count = recover_program_rename_roots_with(roots, |root| {
            recovered.push(root.to_path_buf());
            Ok(())
        })
        .expect("recover roots");

        assert_eq!(count, 2);
        assert_eq!(recovered.len(), 2);
    }

    #[test]
    fn cuts_after_folder_identity_and_bindings_steps_roll_back_to_exact_previous_side() {
        for (label, manifest_label, bindings) in [
            ("folder", "Old", b"old-bindings".as_slice()),
            ("identity", "New", b"old-bindings".as_slice()),
            ("bindings", "New", b"new-bindings".as_slice()),
        ] {
            let root = test_root(label);
            let programs = root.join("Programs");
            let transaction = root.join("transaction").join(format!("rename-1-{label}"));
            let bindings_path = root.join("bindings.ini");
            fs::create_dir_all(&transaction).expect("create transaction root");
            write_program_manifest(&programs.join("New"), manifest_label);
            fs::write(&bindings_path, bindings).expect("write bindings");
            let journal = disk_journal(
                &transaction,
                "Old",
                "New",
                None,
                ProgramRenamePhase::Prepared,
                None,
            );

            recover_root_at(
                &transaction,
                journal.previous_button_document.as_ref(),
                &programs,
                &bindings_path,
            )
            .expect("recover previous side");

            assert!(programs.join("Old").is_dir());
            assert!(!programs.join("New").exists());
            let manifest: serde_json::Value = serde_json::from_slice(
                &fs::read(programs.join("Old/flowcell.program.json")).expect("read manifest"),
            )
            .expect("parse manifest");
            assert_eq!(manifest["label"], "Old");
            assert_eq!(
                fs::read(&bindings_path).expect("read bindings"),
                b"old-bindings"
            );
            let _ = fs::remove_dir_all(root);
        }
    }

    #[test]
    fn cut_after_canonical_file_commit_rolls_forward_from_exact_post_document() {
        let root = test_root("canonical");
        let programs = root.join("Programs");
        let transaction = root.join("transaction/rename-1-canonical");
        let bindings_path = root.join("bindings.ini");
        fs::create_dir_all(&transaction).expect("create transaction root");
        write_program_manifest(&programs.join("New"), "New");
        fs::write(&bindings_path, b"new-bindings").expect("write bindings");
        let next_document = json!({"revision": 2, "side": "new"});
        disk_journal(
            &transaction,
            "Old",
            "New",
            None,
            ProgramRenamePhase::CanonicalPrepared,
            Some(next_document.clone()),
        );

        recover_root_at(
            &transaction,
            Some(&next_document),
            &programs,
            &bindings_path,
        )
        .expect("recover committed side");

        assert!(programs.join("New").is_dir());
        assert_eq!(
            fs::read(&bindings_path).expect("read bindings"),
            b"new-bindings"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn recovery_refuses_unjournaled_bindings_drift_without_overwriting_it() {
        let root = test_root("bindings-drift");
        let programs = root.join("Programs");
        let transaction = root.join("transaction/rename-1-bindings-drift");
        let bindings_path = root.join("bindings.ini");
        fs::create_dir_all(&transaction).expect("create transaction root");
        write_program_manifest(&programs.join("New"), "New");
        fs::write(&bindings_path, b"external-bindings-edit").expect("write drifted bindings");
        let next_document = json!({"revision": 2, "side": "new"});
        disk_journal(
            &transaction,
            "Old",
            "New",
            None,
            ProgramRenamePhase::CanonicalPrepared,
            Some(next_document.clone()),
        );

        let error = recover_root_at(
            &transaction,
            Some(&next_document),
            &programs,
            &bindings_path,
        )
        .expect_err("external bindings drift must fail closed");

        assert!(error.contains("unrelated edits"));
        assert_eq!(
            fs::read(&bindings_path).expect("read drifted bindings"),
            b"external-bindings-edit"
        );
        assert!(programs.join("New").is_dir());
        assert!(transaction.is_dir());
        fs::remove_dir_all(root).expect("remove bindings drift test root");
    }

    #[test]
    fn recovery_treats_absent_bindings_as_distinct_from_journaled_file_bytes() {
        let root = test_root("bindings-absent-drift");
        let programs = root.join("Programs");
        let transaction = root.join("transaction/rename-1-bindings-absent");
        let bindings_path = root.join("bindings.ini");
        fs::create_dir_all(&transaction).expect("create transaction root");
        write_program_manifest(&programs.join("Old"), "Old");
        let journal = disk_journal(
            &transaction,
            "Old",
            "New",
            None,
            ProgramRenamePhase::Prepared,
            None,
        );

        let error = recover_root_at(
            &transaction,
            journal.previous_button_document.as_ref(),
            &programs,
            &bindings_path,
        )
        .expect_err("missing file must not equal journaled bytes");

        assert!(error.contains("unrelated edits"));
        assert!(!bindings_path.exists());
        assert!(programs.join("Old").is_dir());
        fs::remove_dir_all(root).expect("remove absent bindings test root");
    }

    #[test]
    fn recovery_accepts_absent_bindings_only_when_absence_is_the_journaled_side() {
        let root = test_root("bindings-journaled-absent");
        let programs = root.join("Programs");
        let transaction = root.join("transaction/rename-1-bindings-journaled-absent");
        let bindings_path = root.join("bindings.ini");
        fs::create_dir_all(&transaction).expect("create transaction root");
        write_program_manifest(&programs.join("Old"), "Old");
        let mut journal = disk_journal(
            &transaction,
            "Old",
            "New",
            None,
            ProgramRenamePhase::Prepared,
            None,
        );
        journal.previous_bindings = None;
        write_journal(&transaction, &journal, AtomicWriteMode::Replace)
            .expect("record absent previous bindings");

        recover_root_at(
            &transaction,
            journal.previous_button_document.as_ref(),
            &programs,
            &bindings_path,
        )
        .expect("journaled absence is a valid previous side");

        assert!(!bindings_path.exists());
        assert!(programs.join("Old").is_dir());
        fs::remove_dir_all(root).expect("remove journaled absent test root");
    }

    #[test]
    fn recovery_refuses_unjournaled_manifest_label_without_rewriting_it() {
        let root = test_root("manifest-drift");
        let programs = root.join("Programs");
        let transaction = root.join("transaction/rename-1-manifest-drift");
        let bindings_path = root.join("bindings.ini");
        fs::create_dir_all(&transaction).expect("create transaction root");
        write_program_manifest(&programs.join("New"), "External");
        fs::write(&bindings_path, b"new-bindings").expect("write next bindings");
        let next_document = json!({"revision": 2, "side": "new"});
        disk_journal(
            &transaction,
            "Old",
            "New",
            None,
            ProgramRenamePhase::CanonicalPrepared,
            Some(next_document.clone()),
        );

        let error = recover_root_at(
            &transaction,
            Some(&next_document),
            &programs,
            &bindings_path,
        )
        .expect_err("external manifest drift must fail closed");

        assert!(error.contains("matches neither 'Old' nor 'New'"));
        assert!(programs.join("New").is_dir());
        let manifest: serde_json::Value = serde_json::from_slice(
            &fs::read(programs.join("New/flowcell.program.json")).expect("read manifest"),
        )
        .expect("parse manifest");
        assert_eq!(manifest["label"], "External");
        assert_eq!(
            fs::read(&bindings_path).expect("read bindings"),
            b"new-bindings"
        );
        assert!(transaction.is_dir());
        fs::remove_dir_all(root).expect("remove manifest drift test root");
    }

    #[test]
    fn case_only_cut_in_temporary_folder_is_recovered_to_exact_original_casing() {
        let root = test_root("case");
        let programs = root.join("Programs");
        let temporary_name = ".flowcell-program-rename-1-case";
        let transaction = root.join("transaction/rename-1-case");
        let bindings_path = root.join("bindings.ini");
        fs::create_dir_all(&transaction).expect("create transaction root");
        write_program_manifest(&programs.join(temporary_name), "Blender");
        fs::write(&bindings_path, b"old-bindings").expect("write bindings");
        let journal = disk_journal(
            &transaction,
            "Blender",
            "blender",
            Some(temporary_name.to_string()),
            ProgramRenamePhase::Prepared,
            None,
        );

        recover_root_at(
            &transaction,
            journal.previous_button_document.as_ref(),
            &programs,
            &bindings_path,
        )
        .expect("recover case-only temporary move");

        let names = fs::read_dir(&programs)
            .expect("read programs")
            .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert!(names.iter().any(|name| name == "Blender"));
        assert!(!names.iter().any(|name| name == temporary_name));
        let _ = fs::remove_dir_all(root);
    }
}
