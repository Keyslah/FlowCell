use super::manifest::load_program_manifest;
use super::records::{
    active_record_file_name, read_active_record, recover_active_record, validate_owner_button_id,
    ActiveSourceRecord,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const SOURCE_QUARANTINE_JOURNAL_FILE_NAME: &str = "source-quarantine.json";
const SOURCE_QUARANTINE_JOURNAL_SCHEMA_VERSION: u32 = 1;
const UNINSTALL_TRANSACTION_JOURNAL_FILE_NAME: &str = "uninstall-transaction.json";
const UNINSTALL_TRANSACTION_SCHEMA_VERSION: u32 = 1;
static SOURCE_QUARANTINE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub(crate) fn source_quarantine_guard() -> Result<MutexGuard<'static, ()>, String> {
    SOURCE_QUARANTINE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Button source quarantine lock is poisoned.".to_string())
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UninstallButtonSourceRequest {
    pub owner_button_id: String,
    pub program_name: String,
    pub panel_name: String,
    pub file_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UninstallButtonSourceResponse {
    pub owner_button_id: String,
    pub recycled_paths: Vec<String>,
    pub removed_binding_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuarantinedOwnedSource {
    pub record: ActiveSourceRecord,
    pub original_record_path: PathBuf,
    pub original_package_path: PathBuf,
    pub quarantine_record_path: PathBuf,
    pub quarantine_package_path: PathBuf,
    pub bindings_path: PathBuf,
    pub bindings_backup: Option<String>,
    pub enabled_contributions_path: Option<PathBuf>,
    pub enabled_contributions_before: Option<String>,
    pub enabled_contributions_after: Option<String>,
    pub removed_binding_count: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OwnedSourceQuarantineJournal {
    schema_version: u32,
    source: QuarantinedOwnedSource,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum UninstallTransactionPhase {
    Prepared,
    Committed,
    RolledBack,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct UninstallTransactionJournal {
    schema_version: u32,
    phase: UninstallTransactionPhase,
    owner_button_id: String,
}

fn path_text_key(value: &str) -> String {
    let normalized = value
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase();
    if let Some(rest) = normalized.strip_prefix("\\\\?\\unc\\") {
        return format!("\\\\{rest}");
    }
    if let Some(rest) = normalized.strip_prefix("\\\\?\\") {
        return rest.to_string();
    }
    if let Some(rest) = normalized.strip_prefix("\\??\\") {
        return rest.to_string();
    }
    normalized
}

fn path_key(path: &Path) -> String {
    path_text_key(&path.to_string_lossy())
}

fn path_is_under(path: &str, root: &Path) -> bool {
    let path = path_text_key(path);
    let root = path_key(root);
    path == root || path.starts_with(&(root + "\\"))
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    path_key(left) == path_key(right)
}

fn source_quarantine_journal_path(owner_root: &Path) -> PathBuf {
    owner_root.join(SOURCE_QUARANTINE_JOURNAL_FILE_NAME)
}

fn parse_source_quarantine_journal(path: &Path) -> Result<OwnedSourceQuarantineJournal, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let journal = serde_json::from_str::<OwnedSourceQuarantineJournal>(&raw).map_err(|error| {
        format!(
            "Button source quarantine journal {} is invalid: {error}",
            path.display()
        )
    })?;
    if journal.schema_version != SOURCE_QUARANTINE_JOURNAL_SCHEMA_VERSION {
        return Err(format!(
            "Button source quarantine journal {} has unsupported schemaVersion {}.",
            path.display(),
            journal.schema_version
        ));
    }
    Ok(journal)
}

fn validate_persisted_quarantine(
    owner_root: &Path,
    source: &QuarantinedOwnedSource,
) -> Result<(), String> {
    let owner_button_id = validate_owner_button_id(&source.record.owner_button_id)?;
    if !source
        .record
        .install_id
        .eq_ignore_ascii_case(&owner_button_id)
    {
        return Err(
            "Persisted Button source quarantine has mismatched owner identity.".to_string(),
        );
    }
    let expected_owner_root = owner_root
        .parent()
        .ok_or_else(|| "Button source quarantine owner has no transaction root.".to_string())?
        .join(&owner_button_id);
    if !paths_equal(owner_root, &expected_owner_root) {
        return Err(format!(
            "Persisted Button source quarantine owner path does not match '{}'.",
            owner_button_id
        ));
    }

    let manifest = load_program_manifest(&source.record.program_name)?;
    if !source
        .record
        .program_id
        .eq_ignore_ascii_case(&manifest.program_id)
        || !source
            .record
            .program_name
            .eq_ignore_ascii_case(&manifest.label)
        || source.record.runner != manifest.runner.kind
    {
        return Err(
            "Persisted Button source quarantine does not match its program manifest.".to_string(),
        );
    }
    let expected_record =
        crate::resolve_panel_directory(&source.record.program_name, &source.record.panel_name)?
            .join(active_record_file_name(&owner_button_id));
    let expected_package = crate::resolve_program_directory(&source.record.program_name)?
        .join(&manifest.local_scripts_folder)
        .join(&owner_button_id);
    let expected_bindings = crate::resolve_bindings_file_path()?;
    let expected_quarantine_record = owner_root.join(
        expected_record
            .file_name()
            .ok_or_else(|| "Expected active record has no file name.".to_string())?,
    );
    let expected_quarantine_package = owner_root.join("local-package");
    for (actual, expected, description) in [
        (
            &source.original_record_path,
            &expected_record,
            "original active record",
        ),
        (
            &source.original_package_path,
            &expected_package,
            "original Local package",
        ),
        (
            &source.quarantine_record_path,
            &expected_quarantine_record,
            "quarantined active record",
        ),
        (
            &source.quarantine_package_path,
            &expected_quarantine_package,
            "quarantined Local package",
        ),
        (&source.bindings_path, &expected_bindings, "bindings file"),
    ] {
        if !paths_equal(actual, expected) {
            return Err(format!(
                "Persisted Button source quarantine {description} path is outside its manifest-defined location."
            ));
        }
    }
    if let Some(actual) = source.enabled_contributions_path.as_ref() {
        let expected = super::manifest::enabled_program_contributions_path(&manifest)?;
        if !paths_equal(actual, &expected) {
            return Err(
                "Persisted Button source quarantine enabled-contribution path is outside its program registration state."
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn write_source_quarantine_journal(source: &QuarantinedOwnedSource) -> Result<(), String> {
    let owner_root = source
        .quarantine_record_path
        .parent()
        .ok_or_else(|| "Quarantined Button source has no owner directory.".to_string())?;
    validate_persisted_quarantine(owner_root, source)?;
    let journal = OwnedSourceQuarantineJournal {
        schema_version: SOURCE_QUARANTINE_JOURNAL_SCHEMA_VERSION,
        source: source.clone(),
    };
    let raw = serde_json::to_string_pretty(&journal)
        .map_err(|error| format!("Failed to serialize Button source quarantine: {error}"))?;
    super::transaction::write_json_file(
        &source_quarantine_journal_path(owner_root),
        raw.as_bytes(),
        super::transaction::AtomicWriteMode::Create,
    )
}

fn read_source_quarantine_journal(
    owner_root: &Path,
) -> Result<Option<QuarantinedOwnedSource>, String> {
    if !owner_root.is_dir() {
        return Ok(None);
    }
    let path = source_quarantine_journal_path(owner_root);
    super::transaction::recover_json_file(&path, |candidate| {
        let journal = parse_source_quarantine_journal(candidate)?;
        validate_persisted_quarantine(owner_root, &journal.source)
    })?;
    if !path.is_file() {
        let has_artifacts = fs::read_dir(owner_root)
            .map_err(|error| format!("Failed to inspect {}: {error}", owner_root.display()))?
            .next()
            .transpose()
            .map_err(|error| format!("Failed to inspect {}: {error}", owner_root.display()))?
            .is_some();
        return if has_artifacts {
            Err(format!(
                "Button source quarantine {} has artifacts but no recoverable journal.",
                owner_root.display()
            ))
        } else {
            Ok(None)
        };
    }
    let journal = parse_source_quarantine_journal(&path)?;
    validate_persisted_quarantine(owner_root, &journal.source)?;
    Ok(Some(journal.source))
}

fn uninstall_transaction_journal_path(transaction_root: &Path) -> PathBuf {
    transaction_root.join(UNINSTALL_TRANSACTION_JOURNAL_FILE_NAME)
}

fn validate_uninstall_transaction_journal(
    journal: &UninstallTransactionJournal,
) -> Result<(), String> {
    if journal.schema_version != UNINSTALL_TRANSACTION_SCHEMA_VERSION {
        return Err(format!(
            "Button uninstall transaction has unsupported schemaVersion {}.",
            journal.schema_version
        ));
    }
    validate_owner_button_id(&journal.owner_button_id)?;
    Ok(())
}

fn parse_uninstall_transaction_journal(path: &Path) -> Result<UninstallTransactionJournal, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let journal = serde_json::from_str::<UninstallTransactionJournal>(&raw).map_err(|error| {
        format!(
            "Button uninstall transaction journal {} is invalid: {error}",
            path.display()
        )
    })?;
    validate_uninstall_transaction_journal(&journal)?;
    Ok(journal)
}

fn write_uninstall_transaction_journal(
    transaction_root: &Path,
    journal: &UninstallTransactionJournal,
    mode: super::transaction::AtomicWriteMode,
) -> Result<(), String> {
    validate_uninstall_transaction_journal(journal)?;
    let raw = serde_json::to_string_pretty(journal)
        .map_err(|error| format!("Failed to serialize Button uninstall transaction: {error}"))?;
    super::transaction::write_json_file(
        &uninstall_transaction_journal_path(transaction_root),
        raw.as_bytes(),
        mode,
    )
}

fn read_uninstall_transaction_journal(
    transaction_root: &Path,
) -> Result<Option<UninstallTransactionJournal>, String> {
    let path = uninstall_transaction_journal_path(transaction_root);
    super::transaction::recover_json_file(&path, |candidate| {
        parse_uninstall_transaction_journal(candidate).map(|_| ())
    })?;
    if path.is_file() {
        parse_uninstall_transaction_journal(&path).map(Some)
    } else {
        Ok(None)
    }
}

fn directory_is_empty(path: &Path) -> Result<bool, String> {
    Ok(fs::read_dir(path)
        .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?
        .next()
        .transpose()
        .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?
        .is_none())
}

fn finalize_standalone_transaction_roots(paths: &[PathBuf]) {
    let existing = paths
        .iter()
        .filter(|path| path.is_dir())
        .cloned()
        .collect::<Vec<_>>();
    if !existing.is_empty() {
        let _ = crate::recycle_directory_paths(&existing);
    }
}

pub(crate) fn recover_standalone_source_transactions_locked() -> Result<Vec<PathBuf>, String> {
    let quarantine_root = crate::resolve_flowcell_local_root()?
        .join("button-system")
        .join("quarantine");
    if !quarantine_root.is_dir() {
        return Ok(Vec::new());
    }
    let mut roots = Vec::new();
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
                .starts_with("uninstall-")
        {
            roots.push(entry.path());
        }
    }
    roots.sort_by_key(|path| path.to_string_lossy().to_ascii_lowercase());

    let mut finalize = Vec::new();
    for root in roots {
        let Some(mut journal) = read_uninstall_transaction_journal(&root)? else {
            if directory_is_empty(&root)? {
                finalize.push(root);
                continue;
            }
            return Err(format!(
                "Button uninstall transaction {} has quarantined data but no recoverable journal.",
                root.display()
            ));
        };
        if journal.phase == UninstallTransactionPhase::Prepared {
            rollback_quarantined_transaction(&root, &[journal.owner_button_id.clone()])?;
            journal.phase = UninstallTransactionPhase::RolledBack;
            write_uninstall_transaction_journal(
                &root,
                &journal,
                super::transaction::AtomicWriteMode::Replace,
            )?;
        }
        finalize.push(root);
    }
    Ok(finalize)
}

fn canonical_existing(path: &Path, description: &str) -> Result<PathBuf, String> {
    path.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve {description} at {}: {error}",
            path.display()
        )
    })
}

fn validate_owned_source_location(
    record_path: &Path,
    record: &ActiveSourceRecord,
    owner_button_id: &str,
) -> Result<super::execute::ResolvedOwnedSourcePaths, String> {
    let manifest = load_program_manifest(&record.program_name)?;
    if !record.owner_button_id.eq_ignore_ascii_case(owner_button_id)
        || !record.install_id.eq_ignore_ascii_case(owner_button_id)
        || !record.program_id.eq_ignore_ascii_case(&manifest.program_id)
        || !record.program_name.eq_ignore_ascii_case(&manifest.label)
        || record.runner != manifest.runner.kind
    {
        return Err(format!(
            "Active source record '{}' does not match owner or program manifest identity.",
            record_path.display()
        ));
    }

    let panel_root = crate::resolve_panel_directory(&record.program_name, &record.panel_name)?;
    let expected_record = panel_root.join(active_record_file_name(owner_button_id));
    if canonical_existing(record_path, "active source record")?
        != canonical_existing(&expected_record, "expected active source record")?
    {
        return Err(format!(
            "Active source record '{}' is outside its manifest-defined panel owner path.",
            record_path.display()
        ));
    }

    super::execute::resolve_owned_source_paths(&manifest, record)
}

fn locate_owned_source(
    owner_button_id: &str,
    expected_program: Option<&str>,
    expected_panel: Option<&str>,
    expected_file: Option<&str>,
) -> Result<(PathBuf, ActiveSourceRecord), String> {
    if let (Some(program_name), Some(panel_name), Some(file_name)) =
        (expected_program, expected_panel, expected_file)
    {
        let owner_button_id = validate_owner_button_id(owner_button_id)?;
        let program_name = crate::validate_folder_name(program_name, "Program")?;
        let panel_name = crate::validate_folder_name(panel_name, "Panel")?;
        let expected_file_name = active_record_file_name(&owner_button_id);
        if !file_name.trim().eq_ignore_ascii_case(&expected_file_name) {
            return Err(format!(
                "Button '{}' uninstall request names an unexpected active source record '{}'.",
                owner_button_id,
                file_name.trim()
            ));
        }
        let panel_root = crate::resolve_panel_directory(&program_name, &panel_name)?;
        let record_path = panel_root.join(&expected_file_name);
        recover_active_record(&record_path)?;
        if !record_path.is_file() {
            return Err(format!(
                "No installed source belongs to Button '{owner_button_id}' in {program_name}/{panel_name}."
            ));
        }
        let record = read_active_record(&record_path)?;
        if !record
            .owner_button_id
            .eq_ignore_ascii_case(&owner_button_id)
            || !record.install_id.eq_ignore_ascii_case(&owner_button_id)
            || !record.program_name.eq_ignore_ascii_case(&program_name)
            || !record.panel_name.eq_ignore_ascii_case(&panel_name)
        {
            return Err(format!(
                "Active source record for Button '{}' does not match the exact uninstall identity {}/{}.",
                owner_button_id, program_name, panel_name
            ));
        }
        validate_owned_source_location(&record_path, &record, &owner_button_id)?;
        return Ok((record_path, record));
    }

    let programs_root = crate::resolve_programs_root()?;
    let mut matches = Vec::new();
    for program_entry in fs::read_dir(&programs_root)
        .map_err(|error| format!("Failed to read {}: {error}", programs_root.display()))?
    {
        let program_entry = program_entry
            .map_err(|error| format!("Failed to inspect {}: {error}", programs_root.display()))?;
        if !program_entry.path().is_dir()
            || !program_entry.path().join("flowcell.program.json").is_file()
        {
            continue;
        }
        let program_name = program_entry.file_name().to_string_lossy().to_string();
        if expected_program
            .map(|value| !value.eq_ignore_ascii_case(&program_name))
            .unwrap_or(false)
        {
            continue;
        }
        let manifest = load_program_manifest(&program_name)?;
        let panels_root = program_entry.path().join(&manifest.panels_folder);
        if !panels_root.is_dir() {
            continue;
        }
        for panel_entry in fs::read_dir(&panels_root)
            .map_err(|error| format!("Failed to read {}: {error}", panels_root.display()))?
        {
            let panel_entry = panel_entry
                .map_err(|error| format!("Failed to inspect {}: {error}", panels_root.display()))?;
            if !panel_entry.path().is_dir() {
                continue;
            }
            super::records::recover_active_records_in_directory(&panel_entry.path())?;
            let panel_name = panel_entry.file_name().to_string_lossy().to_string();
            if expected_panel
                .map(|value| !value.eq_ignore_ascii_case(&panel_name))
                .unwrap_or(false)
            {
                continue;
            }
            for record_entry in fs::read_dir(panel_entry.path()).map_err(|error| {
                format!("Failed to read {}: {error}", panel_entry.path().display())
            })? {
                let record_entry = record_entry.map_err(|error| {
                    format!(
                        "Failed to inspect {}: {error}",
                        panel_entry.path().display()
                    )
                })?;
                let file_name = record_entry.file_name().to_string_lossy().to_string();
                if expected_file
                    .map(|value| !value.eq_ignore_ascii_case(&file_name))
                    .unwrap_or(false)
                    || !file_name
                        .to_ascii_lowercase()
                        .ends_with(super::records::ACTIVE_SOURCE_RECORD_SUFFIX)
                {
                    continue;
                }
                let record = read_active_record(&record_entry.path())?;
                if record.owner_button_id.eq_ignore_ascii_case(owner_button_id) {
                    matches.push((record_entry.path(), record));
                }
            }
        }
    }
    match matches.len() {
        1 => Ok(matches.remove(0)),
        0 => Err(format!("No installed source belongs to Button '{owner_button_id}'.")),
        _ => Err(format!(
            "Button '{owner_button_id}' has multiple active source records; refusing ambiguous cleanup."
        )),
    }
}

fn read_bindings_backup(path: &Path) -> Result<Option<String>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|error| format!("Failed to back up {}: {error}", path.display()))
}

fn binding_section_belongs_to_owner(
    section: &HashMap<String, String>,
    package_root: &Path,
    owner_button_id: &str,
) -> bool {
    let owns_script_path = section
        .get("ScriptPath")
        .map(|path| path_is_under(path, package_root))
        .unwrap_or(false);
    let owns_tool_set_button = section
        .get("TargetKind")
        .map(|kind| {
            let kind = kind.trim();
            kind.eq_ignore_ascii_case("tool-set-child")
                || kind.eq_ignore_ascii_case("tool-set-owner")
        })
        .unwrap_or(false)
        && section
            .get("OwnerButtonId")
            .map(|candidate| {
                candidate
                    .trim()
                    .eq_ignore_ascii_case(owner_button_id.trim())
            })
            .unwrap_or(false);
    owns_script_path || owns_tool_set_button
}

// Callers hold the shared bindings-state guard across the complete source
// transaction, including rollback, so this read/modify/write cannot race Binds.
fn remove_owned_bindings(record: &ActiveSourceRecord) -> Result<(PathBuf, usize), String> {
    let bindings_path = crate::resolve_bindings_file_path()?;
    let (_bindings, mut document, _) = crate::read_bindings_file_state()?;
    let package_root = PathBuf::from(&record.local_package_path);
    let binding_sections = document
        .keys()
        .filter(|section| section.starts_with("Binding_"))
        .cloned()
        .collect::<Vec<_>>();
    let mut removed = 0usize;
    for section_name in binding_sections {
        let owned = document
            .get(&section_name)
            .map(|section| {
                binding_section_belongs_to_owner(section, &package_root, &record.owner_button_id)
            })
            .unwrap_or(false);
        if owned {
            document.remove(&section_name);
            removed += 1;
        }
    }
    if let Some(action_hotkeys) = document.get_mut("ActionHotkeys") {
        if !record.bridge_action.trim().is_empty()
            && action_hotkeys.remove(record.bridge_action.trim()).is_some()
        {
            removed += 1;
        }
    }
    if document
        .get("ActionHotkeys")
        .map(|section| section.is_empty())
        .unwrap_or(false)
    {
        document.remove("ActionHotkeys");
    }
    let mut ids = document
        .keys()
        .filter_map(|section| section.strip_prefix("Binding_"))
        .filter_map(|value| value.parse::<u64>().ok())
        .collect::<Vec<_>>();
    ids.sort_unstable();
    let meta = document.entry("Meta".to_string()).or_default();
    meta.insert(
        "Ids".to_string(),
        ids.iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("|"),
    );
    meta.insert(
        "NextId".to_string(),
        (ids.last().copied().unwrap_or(0) + 1).max(1).to_string(),
    );
    crate::write_bindings_file_state(&bindings_path, &document)?;
    if removed > 0 {
        crate::restart_flowcell_headless_backend()?;
    }
    Ok((bindings_path, removed))
}

pub(crate) fn cleanup_blender_owner(
    program_name: &str,
    owner_button_id: &str,
    label: &str,
    bridge_action: &str,
) -> Result<(), String> {
    if bridge_action.trim().is_empty() {
        return Ok(());
    }
    let manifest = load_program_manifest(program_name)?;
    let program_root = crate::resolve_program_directory(program_name)?;
    let helper = super::manifest::resolve_runner_script_path(
        &program_root,
        &manifest,
        &manifest.runner.delete_script,
        "runner.deleteScript",
    )?
    .ok_or_else(|| "Blender program manifest is missing runner.deleteScript.".to_string())?;
    if !helper.is_file() {
        return Err(format!(
            "Blender delete adapter was not found at {}.",
            helper.display()
        ));
    }
    let arguments = vec![
        "-File".to_string(),
        helper.to_string_lossy().to_string(),
        "-OwnerButtonId".to_string(),
        owner_button_id.to_string(),
        "-ButtonTarget".to_string(),
        format!("action:{}", bridge_action.trim()),
    ];
    let output = crate::spawn_powershell_output(&arguments)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(crate::format_process_failure(
            &output,
            &format!("Blender cleanup failed for '{label}'."),
        ))
    }
}

fn cleanup_blender_runtime(record: &ActiveSourceRecord) -> Result<(), String> {
    if record.runner != "blender-bridge" {
        return Ok(());
    }
    cleanup_blender_owner(
        &record.program_name,
        &record.owner_button_id,
        &record.label,
        &record.bridge_action,
    )
}

fn stop_toolset_runtime_with_script(
    record: &ActiveSourceRecord,
    lifecycle: super::install::ToolsetRuntimeLifecycle,
    stop_script: &Path,
    allowed_script_root: &Path,
) -> Result<(), String> {
    let allowed_script_root = allowed_script_root.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve Tool Set lifecycle script root {}: {error}",
            allowed_script_root.display()
        )
    })?;
    let stop_script = stop_script.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve Tool Set lifecycle stop script '{}': {error}",
            lifecycle.stop_script
        )
    })?;
    if !stop_script.is_file() || !stop_script.starts_with(&allowed_script_root) {
        return Err(format!(
            "Tool Set lifecycle stop script is outside its owned source package: {}.",
            stop_script.display()
        ));
    }
    let manifest = load_program_manifest(&record.program_name)?;
    let owned = super::execute::resolve_owned_source_paths(&manifest, record)?;
    let runtime = owned.package_path.join("runtime");
    if runtime.exists() {
        let resolved_runtime = runtime.canonicalize().map_err(|error| {
            format!(
                "Failed to resolve owned Tool Set runtime {}: {error}",
                runtime.display()
            )
        })?;
        if !resolved_runtime.is_dir() || !resolved_runtime.starts_with(&owned.package_path) {
            return Err(format!(
                "Tool Set runtime is outside its owned Local Scripts package: {}.",
                resolved_runtime.display()
            ));
        }
    }

    // Ownership resolution canonicalizes package paths. Windows PowerShell
    // 5.1 cannot use Join-Path on verbatim `\\?\` values, so lifecycle
    // scripts receive the equivalent ordinary DOS/UNC spellings.
    let arguments = toolset_runtime_stop_arguments(
        &stop_script,
        &runtime,
        &owned.source_path,
        &record.owner_button_id,
        &lifecycle.owner_token,
    );
    let output = crate::spawn_powershell_output(&arguments)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(crate::format_process_failure(
            &output,
            &format!("Tool Set runtime cleanup failed for '{}'.", record.label),
        ))
    }
}

fn toolset_runtime_stop_arguments(
    stop_script: &Path,
    runtime: &Path,
    source_path: &Path,
    owner_button_id: &str,
    owner_token: &str,
) -> Vec<String> {
    let child_stop_script = crate::commands::execution::windows_child_process_path(stop_script);
    let child_runtime = crate::commands::execution::windows_child_process_path(runtime);
    let child_source_path = crate::commands::execution::windows_child_process_path(source_path);
    vec![
        "-File".to_string(),
        child_stop_script.to_string_lossy().to_string(),
        "-RuntimeFolder".to_string(),
        child_runtime.to_string_lossy().to_string(),
        "-SourcePath".to_string(),
        child_source_path.to_string_lossy().to_string(),
        "-OwnerButtonId".to_string(),
        owner_button_id.to_string(),
        "-OwnerToken".to_string(),
        owner_token.to_string(),
        "-TimeoutMilliseconds".to_string(),
        "5000".to_string(),
    ]
}

fn refuse_symmetry_delete_without_recorded_lifecycle(
    record: &ActiveSourceRecord,
    source_root: &Path,
    source_path: &Path,
) -> Result<(), String> {
    if !record.program_id.eq_ignore_ascii_case("illustrator")
        || !record.kind.eq_ignore_ascii_case("toolset")
        || source_path.file_name().and_then(|value| value.to_str())
            != Some("Illustrator Symmetry.jsx")
    {
        return Ok(());
    }

    let manifest_path = source_root.join("flowcell.toolset.json");
    let raw = fs::read_to_string(&manifest_path).map_err(|error| {
        format!(
            "Cannot verify whether installed Illustrator Symmetry can stop safely before Delete at {}: {error}",
            manifest_path.display()
        )
    })?;
    let manifest = serde_json::from_str::<serde_json::Value>(&raw).map_err(|error| {
        format!(
            "Cannot verify whether installed Illustrator Symmetry can stop safely before Delete at {}: {error}",
            manifest_path.display()
        )
    })?;
    let is_symmetry = manifest
        .get("id")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|id| id == "illustrator.symmetry")
        && manifest.get("source").and_then(serde_json::Value::as_str)
            == Some("Illustrator Symmetry.jsx");
    if !is_symmetry {
        return Ok(());
    }

    Err(
        "Installed Illustrator Symmetry has no recorded stop lifecycle. Use 'Update selected Button content' to install version 1.1 before deleting this owner."
            .to_string(),
    )
}

// A Tool Set may declare a source-local stop script for a runtime process it
// owns. The script is opt-in and runs before its package can be quarantined,
// so a stale process can never keep reading a deleted package after Delete.
pub(crate) fn stop_declared_toolset_runtime(record: &ActiveSourceRecord) -> Result<(), String> {
    if !record.kind.eq_ignore_ascii_case("toolset") {
        return Ok(());
    }
    let manifest = load_program_manifest(&record.program_name)?;
    let owned = super::execute::resolve_owned_source_paths(&manifest, record)?;
    let source_root = owned.package_path.join("source");
    let Some(lifecycle) = super::install::declared_toolset_runtime_lifecycle(record)? else {
        refuse_symmetry_delete_without_recorded_lifecycle(
            record,
            &source_root,
            &owned.source_path,
        )?;
        return Ok(());
    };
    let stop_script = source_root.join(&lifecycle.stop_script);
    stop_toolset_runtime_with_script(record, lifecycle, &stop_script, &source_root)
}

// Update must use the incoming lifecycle declaration when available: it lets a
// new package safely stop a predecessor that was installed before lifecycle
// metadata existed. The incoming script still receives the predecessor's
// source path and runtime folder, so it cannot cross the owner boundary.
pub(crate) fn stop_toolset_runtime_before_update(
    previous: &ActiveSourceRecord,
    replacement: &ActiveSourceRecord,
    staged_source_root: &Path,
) -> Result<(), String> {
    if !replacement.kind.eq_ignore_ascii_case("toolset") {
        return stop_declared_toolset_runtime(previous);
    }
    let Some(lifecycle) = super::install::declared_toolset_runtime_lifecycle(replacement)? else {
        return stop_declared_toolset_runtime(previous);
    };
    let stop_script = staged_source_root.join(&lifecycle.stop_script);
    stop_toolset_runtime_with_script(previous, lifecycle, &stop_script, staged_source_root)
}

fn transaction_token() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}-{}", now.as_secs(), now.subsec_nanos())
}

fn prepare_enabled_contribution_removal(
    record: &ActiveSourceRecord,
) -> Result<(Option<PathBuf>, Option<String>, Option<String>), String> {
    let Some(source_id) = record
        .bundled_source_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok((None, None, None));
    };
    let manifest = load_program_manifest(&record.program_name)?;
    let path = super::manifest::enabled_program_contributions_path(&manifest)?;
    if !path.is_file() {
        return Ok((Some(path), None, None));
    }
    let before = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let mut state = serde_json::from_str::<super::manifest::EnabledProgramContributions>(&before)
        .map_err(|error| {
        format!(
            "Enabled contribution state at {} is invalid: {error}",
            path.display()
        )
    })?;
    super::manifest::validate_enabled_program_contributions(&mut state, &manifest)?;
    state
        .enabled_sources
        .retain(|source| !source.source_id.eq_ignore_ascii_case(source_id));
    let after = serde_json::to_string_pretty(&state)
        .map_err(|error| format!("Failed to serialize enabled contribution state: {error}"))?;
    Ok((Some(path), Some(before), Some(after)))
}

fn apply_enabled_contribution_change(source: &QuarantinedOwnedSource) -> Result<(), String> {
    let (Some(path), Some(after)) = (
        source.enabled_contributions_path.as_ref(),
        source.enabled_contributions_after.as_ref(),
    ) else {
        return Ok(());
    };
    super::transaction::write_json_file(
        path,
        after.as_bytes(),
        super::transaction::AtomicWriteMode::Replace,
    )
}

fn rollback_enabled_contribution_change(source: &QuarantinedOwnedSource) -> Result<(), String> {
    let Some(path) = source.enabled_contributions_path.as_ref() else {
        return Ok(());
    };
    match (
        source.enabled_contributions_before.as_ref(),
        source.enabled_contributions_after.as_ref(),
    ) {
        (Some(before), Some(after)) => {
            let current = fs::read_to_string(path)
                .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
            if current.trim() != after.trim() {
                return Err(format!(
                    "Enabled contribution state changed while Button '{}' was quarantined.",
                    source.record.owner_button_id
                ));
            }
            super::transaction::write_json_file(
                path,
                before.as_bytes(),
                super::transaction::AtomicWriteMode::Replace,
            )
        }
        (None, None) => Ok(()),
        _ => Err("Button quarantine has an incomplete enabled-contribution snapshot.".to_string()),
    }
}

pub(crate) fn quarantine_owned_source(
    owner_button_id: &str,
    transaction_root: &Path,
) -> Result<QuarantinedOwnedSource, String> {
    let owner_button_id = validate_owner_button_id(owner_button_id)?;
    super::install::ensure_no_awaiting_canonical_update_for_owner(&owner_button_id)?;
    let (record_path, mut record) = locate_owned_source(&owner_button_id, None, None, None)?;
    let resolved = validate_owned_source_location(&record_path, &record, &owner_button_id)?;
    let package_path = resolved.package_path;
    record.local_package_path = package_path.to_string_lossy().to_string();
    record.source_path = resolved.source_path.to_string_lossy().to_string();
    let owner_root = transaction_root.join(&owner_button_id);
    fs::create_dir_all(&owner_root)
        .map_err(|error| format!("Failed to create {}: {error}", owner_root.display()))?;
    let quarantined_record = owner_root.join(
        record_path
            .file_name()
            .ok_or_else(|| "Active record has no file name.".to_string())?,
    );
    let quarantined_package = owner_root.join("local-package");
    let bindings_path = crate::resolve_bindings_file_path()?;
    let bindings_backup = read_bindings_backup(&bindings_path)?;
    let (enabled_contributions_path, enabled_contributions_before, enabled_contributions_after) =
        prepare_enabled_contribution_removal(&record)?;
    let mut source = QuarantinedOwnedSource {
        record,
        original_record_path: record_path,
        original_package_path: package_path,
        quarantine_record_path: quarantined_record,
        quarantine_package_path: quarantined_package,
        bindings_path,
        bindings_backup,
        enabled_contributions_path,
        enabled_contributions_before,
        enabled_contributions_after,
        removed_binding_count: 0,
    };

    // This immutable journal is the write-ahead boundary. Nothing owned by the
    // Button moves, and no external runtime state changes, until recovery has a
    // complete description of how to put it back.
    write_source_quarantine_journal(&source)?;

    let apply_result = (|| {
        stop_declared_toolset_runtime(&source.record)?;
        move_into_quarantine(
            &source.original_record_path,
            &source.quarantine_record_path,
            "active source record",
        )?;
        move_into_quarantine(
            &source.original_package_path,
            &source.quarantine_package_path,
            "Local source package",
        )?;
        let current_bindings = read_bindings_backup(&source.bindings_path)?;
        if current_bindings != source.bindings_backup {
            return Err(format!(
                "FlowCell bindings changed while Button '{}' was being quarantined.",
                source.record.owner_button_id
            ));
        }
        let (bindings_path, removed_binding_count) = remove_owned_bindings(&source.record)?;
        if !paths_equal(&bindings_path, &source.bindings_path) {
            return Err("FlowCell bindings path changed during Button quarantine.".to_string());
        }
        source.removed_binding_count = removed_binding_count;
        apply_enabled_contribution_change(&source)?;
        cleanup_blender_runtime(&source.record)
    })();

    if let Err(error) = apply_result {
        let rollback_error = rollback_quarantined_source(&source).err();
        return Err(match rollback_error {
            Some(rollback_error) => {
                format!("{error} Rollback also failed: {rollback_error}")
            }
            None => error,
        });
    }
    Ok(source)
}

fn move_into_quarantine(
    original: &Path,
    quarantined: &Path,
    description: &str,
) -> Result<(), String> {
    match (original.exists(), quarantined.exists()) {
        (true, false) => fs::rename(original, quarantined).map_err(|error| {
            format!(
                "Failed to quarantine {description} {}: {error}",
                original.display()
            )
        }),
        (false, true) => Ok(()),
        (true, true) => Err(format!(
            "Button source quarantine found both original and quarantined {description} copies."
        )),
        (false, false) => Err(format!(
            "Button source quarantine could not find {description} {}.",
            original.display()
        )),
    }
}

fn restore_quarantined_path(
    original: &Path,
    quarantined: &Path,
    is_expected_kind: impl Fn(&Path) -> bool,
    description: &str,
) -> Result<(), String> {
    let original_exists = is_expected_kind(original);
    let quarantined_exists = is_expected_kind(quarantined);
    match (original_exists, quarantined_exists) {
        (true, false) => Ok(()),
        (false, true) => fs::rename(quarantined, original).map_err(|error| {
            format!(
                "Failed to restore {description} {}: {error}",
                original.display()
            )
        }),
        (true, true) => Err(format!(
            "Button source recovery found both original and quarantined {description} copies."
        )),
        (false, false) => Err(format!(
            "Button source recovery found neither original nor quarantined {description} {}.",
            original.display()
        )),
    }
}

fn rollback_quarantined_source_with<F, R>(
    source: &QuarantinedOwnedSource,
    mut restore_runtime: F,
    mut reload_bindings: R,
) -> Result<(), String>
where
    F: FnMut(&ActiveSourceRecord) -> Result<(), String>,
    R: FnMut(),
{
    restore_quarantined_path(
        &source.original_package_path,
        &source.quarantine_package_path,
        Path::is_dir,
        "Local source package",
    )?;
    restore_quarantined_path(
        &source.original_record_path,
        &source.quarantine_record_path,
        Path::is_file,
        "active source record",
    )?;
    if let Some(backup) = source.bindings_backup.as_ref() {
        fs::write(&source.bindings_path, backup).map_err(|error| {
            format!(
                "Failed to restore {}: {error}",
                source.bindings_path.display()
            )
        })?;
        reload_bindings();
    } else if source.bindings_path.is_file() {
        let owner_root = source
            .quarantine_record_path
            .parent()
            .ok_or_else(|| "Quarantined Button source has no owner directory.".to_string())?;
        let rollback_copy = owner_root.join("bindings-created-during-quarantine.ini");
        if !rollback_copy.exists() {
            fs::rename(&source.bindings_path, &rollback_copy).map_err(|error| {
                format!(
                    "Failed to quarantine bindings created during rollback at {}: {error}",
                    source.bindings_path.display()
                )
            })?;
        }
        reload_bindings();
    }
    rollback_enabled_contribution_change(source)?;
    restore_runtime(&source.record)
}

pub(crate) fn rollback_quarantined_source(source: &QuarantinedOwnedSource) -> Result<(), String> {
    rollback_quarantined_source_with(
        source,
        |record| {
            if record.runner != "blender-bridge" {
                return Ok(());
            }
            let manifest = load_program_manifest(&record.program_name)?;
            let installed_source = PathBuf::from(&record.source_path);
            super::install::deploy_blender_source(
                &manifest,
                &record.owner_button_id,
                &record.panel_name,
                &installed_source,
                record.bridge_data.as_ref(),
            )?;
            Ok(())
        },
        || {
            let _ = crate::restart_flowcell_headless_backend();
        },
    )
}

pub(crate) fn rollback_quarantined_transaction(
    transaction_root: &Path,
    owner_button_ids: &[String],
) -> Result<(), String> {
    let mut errors = Vec::new();
    for owner_button_id in owner_button_ids.iter().rev() {
        let owner = match validate_owner_button_id(owner_button_id) {
            Ok(owner) => owner,
            Err(error) => {
                errors.push(error);
                continue;
            }
        };
        let owner_root = transaction_root.join(owner);
        match read_source_quarantine_journal(&owner_root) {
            Ok(Some(source)) => {
                if let Err(error) = rollback_quarantined_source(&source) {
                    errors.push(format!(
                        "Button source '{}' restore failed: {error}",
                        source.record.owner_button_id
                    ));
                }
            }
            Ok(None) => {}
            Err(error) => errors.push(error),
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join(" | "))
    }
}

#[tauri::command]
pub(crate) fn uninstall_button_source(
    app: tauri::AppHandle,
    request: UninstallButtonSourceRequest,
) -> Result<UninstallButtonSourceResponse, String> {
    crate::require_registered_program_name(&request.program_name)?;
    let guard = source_quarantine_guard()?;
    // Keep binding removal/rollback atomic with Binds saves. This lock order is
    // source quarantine -> bindings state everywhere source transactions run.
    let bindings_guard = crate::commands::bindings::bindings_state_guard()?;
    let mut cleanup = recover_standalone_source_transactions_locked()?;
    let owner_button_id = validate_owner_button_id(&request.owner_button_id)?;
    if crate::button_state::canonical_state_references_source_owner_while_source_locked(
        &owner_button_id,
    )? {
        return Err(format!(
            "Button source '{owner_button_id}' is still referenced by canonical Button state; remove it through a Button state commit."
        ));
    }
    let (record_path, _) = locate_owned_source(
        &owner_button_id,
        Some(request.program_name.trim()),
        Some(request.panel_name.trim()),
        Some(request.file_name.trim()),
    )?;
    let local_root = crate::resolve_flowcell_local_root()?
        .join("button-system")
        .join("quarantine");
    let transaction_root = local_root.join(format!("uninstall-{}", transaction_token()));
    let mut journal = UninstallTransactionJournal {
        schema_version: UNINSTALL_TRANSACTION_SCHEMA_VERSION,
        phase: UninstallTransactionPhase::Prepared,
        owner_button_id: owner_button_id.clone(),
    };
    write_uninstall_transaction_journal(
        &transaction_root,
        &journal,
        super::transaction::AtomicWriteMode::Create,
    )?;
    let source = match quarantine_owned_source(&owner_button_id, &transaction_root) {
        Ok(source) => source,
        Err(error) => {
            let rollback_error =
                rollback_quarantined_transaction(&transaction_root, &[owner_button_id.clone()])
                    .err();
            if rollback_error.is_none() {
                journal.phase = UninstallTransactionPhase::RolledBack;
                if write_uninstall_transaction_journal(
                    &transaction_root,
                    &journal,
                    super::transaction::AtomicWriteMode::Replace,
                )
                .is_ok()
                {
                    cleanup.push(transaction_root.clone());
                }
            }
            drop(bindings_guard);
            drop(guard);
            finalize_standalone_transaction_roots(&cleanup);
            return Err(match rollback_error {
                Some(rollback_error) => {
                    format!("{error} Rollback also failed: {rollback_error}")
                }
                None => error,
            });
        }
    };
    if source.original_record_path != record_path {
        let rollback =
            rollback_quarantined_transaction(&transaction_root, &[owner_button_id.clone()]);
        if rollback.is_ok() {
            journal.phase = UninstallTransactionPhase::RolledBack;
            if write_uninstall_transaction_journal(
                &transaction_root,
                &journal,
                super::transaction::AtomicWriteMode::Replace,
            )
            .is_ok()
            {
                cleanup.push(transaction_root.clone());
            }
        }
        drop(bindings_guard);
        drop(guard);
        finalize_standalone_transaction_roots(&cleanup);
        return Err(match rollback {
            Ok(()) => "Owned source identity changed during uninstall.".to_string(),
            Err(error) => format!(
                "Owned source identity changed during uninstall. Rollback also failed: {error}"
            ),
        });
    }

    journal.phase = UninstallTransactionPhase::Committed;
    write_uninstall_transaction_journal(
        &transaction_root,
        &journal,
        super::transaction::AtomicWriteMode::Replace,
    )?;
    cleanup.push(transaction_root);
    let pending_install_cleanup_error =
        super::pending_install::clear_pending_canonical_install(&owner_button_id).err();
    let response = UninstallButtonSourceResponse {
        owner_button_id,
        recycled_paths: vec![
            source.original_record_path.display().to_string(),
            source.original_package_path.display().to_string(),
        ],
        removed_binding_count: source.removed_binding_count,
    };
    drop(bindings_guard);
    drop(guard);
    finalize_standalone_transaction_roots(&cleanup);
    if let Some(error) = pending_install_cleanup_error {
        let message = format!(
            "Button '{}' source was uninstalled, but its pending canonical-install intent could not be cleared: {error}",
            response.owner_button_id
        );
        eprintln!("{message}");
        crate::append_flowcell_local_log("button_state.log", &message);
    }
    if response.removed_binding_count > 0 {
        if let Err(error) = crate::synchronize_tool_set_hotkeys(&app) {
            let message = format!(
                "Tool Set hotkeys could not be synchronized after uninstalling '{}': {error}",
                response.owner_button_id
            );
            eprintln!("{message}");
            crate::append_flowcell_local_log("child_hotkeys.log", &message);
        }
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::{
        binding_section_belongs_to_owner, refuse_symmetry_delete_without_recorded_lifecycle,
        rollback_quarantined_source_with, toolset_runtime_stop_arguments, ActiveSourceRecord,
        QuarantinedOwnedSource,
    };
    use std::collections::HashMap;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestRoot(PathBuf);

    impl TestRoot {
        fn new(label: &str) -> Self {
            let token = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "flowcell-source-quarantine-{label}-{}-{token}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create source quarantine test root");
            Self(path)
        }

        fn join(&self, value: &str) -> PathBuf {
            self.0.join(value)
        }
    }

    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn lifecycle_stop_arguments_strip_verbatim_windows_path_prefixes() {
        let arguments = toolset_runtime_stop_arguments(
            Path::new(r"\\?\D:\FlowCell\Programs\Illustrator\Local\owner\source\Stop.ps1"),
            Path::new(r"\\?\D:\FlowCell\Programs\Illustrator\Local\owner\runtime"),
            Path::new(r"\\?\D:\FlowCell\Programs\Illustrator\Local\owner\source\Symmetry.jsx"),
            "owner",
            "token",
        );

        let expected = vec![
            "-File",
            r"D:\FlowCell\Programs\Illustrator\Local\owner\source\Stop.ps1",
            "-RuntimeFolder",
            r"D:\FlowCell\Programs\Illustrator\Local\owner\runtime",
            "-SourcePath",
            r"D:\FlowCell\Programs\Illustrator\Local\owner\source\Symmetry.jsx",
            "-OwnerButtonId",
            "owner",
            "-OwnerToken",
            "token",
            "-TimeoutMilliseconds",
            "5000",
        ]
        .into_iter()
        .map(String::from)
        .collect::<Vec<_>>();
        assert_eq!(arguments, expected);
    }

    #[test]
    fn owner_binding_cleanup_matches_typed_buttons_by_owner_id() {
        let package_root = Path::new(r"D:\FlowCell\owner-package");
        let mut section = HashMap::from([
            ("TargetKind".to_string(), "tool-set-child".to_string()),
            ("ButtonId".to_string(), "child-negative".to_string()),
            ("OwnerButtonId".to_string(), "owner-rotate".to_string()),
        ]);
        assert!(binding_section_belongs_to_owner(
            &section,
            package_root,
            "owner-rotate"
        ));
        assert!(!binding_section_belongs_to_owner(
            &section,
            package_root,
            "different-owner"
        ));

        section.insert("TargetKind".to_string(), "tool-set-owner".to_string());
        section.insert("ButtonId".to_string(), "owner-rotate".to_string());
        assert!(binding_section_belongs_to_owner(
            &section,
            package_root,
            "owner-rotate"
        ));
        assert!(!binding_section_belongs_to_owner(
            &section,
            package_root,
            "different-owner"
        ));

        section.insert("TargetKind".to_string(), "script".to_string());
        assert!(!binding_section_belongs_to_owner(
            &section,
            package_root,
            "owner-rotate"
        ));
    }

    #[test]
    fn legacy_symmetry_owner_must_update_before_delete_without_a_lifecycle() {
        let root = TestRoot::new("legacy-symmetry-delete");
        let source_root = root.join("owner/source");
        fs::create_dir_all(&source_root).expect("create installed symmetry source");
        let source_path = source_root.join("Illustrator Symmetry.jsx");
        fs::write(&source_path, "// symmetry").expect("write installed symmetry entrypoint");
        fs::write(
            source_root.join("flowcell.toolset.json"),
            r#"{
                "schemaVersion": 1,
                "id": "illustrator.symmetry",
                "version": "1.0.0",
                "source": "Illustrator Symmetry.jsx",
                "execution": {
                    "programKey": "illustrator_automation",
                    "commandFile": "illustrator_symmetry_command.json"
                }
            }"#,
        )
        .expect("write legacy symmetry manifest");
        let mut record = test_source(&root, None).record;
        record.program_id = "illustrator".to_string();
        record.program_name = "Illustrator".to_string();
        record.kind = "toolset".to_string();
        assert!(refuse_symmetry_delete_without_recorded_lifecycle(
            &record,
            &source_root,
            &source_path
        )
        .expect_err("legacy owner must not delete without a stop lifecycle")
        .contains("Update selected Button content"));

        fs::write(
            source_root.join("flowcell.toolset.json"),
            r#"{
                "schemaVersion": 1,
                "id": "illustrator.symmetry",
                "version": "1.1.0",
                "source": "Illustrator Symmetry.jsx",
                "execution": {
                    "programKey": "illustrator_automation",
                    "commandFile": "illustrator_symmetry_command.json",
                    "lifecycle": {
                        "stopScript": "Stop Illustrator Symmetry Watcher.ps1",
                        "ownerToken": "flowcell-illustrator-symmetry-v1"
                    }
                }
            }"#,
        )
        .expect("write current symmetry manifest");
        assert!(refuse_symmetry_delete_without_recorded_lifecycle(&record, &source_root, &source_path).is_err(),
            "a lifecycle-record drift must remain fail-closed until Update repairs the active record");

        record.kind = "script".to_string();
        assert!(refuse_symmetry_delete_without_recorded_lifecycle(
            &record,
            &source_root,
            &source_path
        )
        .is_ok());
    }

    fn test_source(root: &TestRoot, bindings_backup: Option<String>) -> QuarantinedOwnedSource {
        let owner_root = root.join("transaction/owner-one");
        fs::create_dir_all(&owner_root).expect("create owner quarantine directory");
        QuarantinedOwnedSource {
            record: ActiveSourceRecord {
                schema_version: 1,
                owner_button_id: "owner-one".to_string(),
                install_id: "owner-one".to_string(),
                program_id: "program.test".to_string(),
                program_name: "Program".to_string(),
                panel_name: "Panel".to_string(),
                label: "Source".to_string(),
                tooltip: String::new(),
                kind: "script".to_string(),
                local_package_path: root.join("local-package").display().to_string(),
                source_path: root
                    .join("local-package/source/action.py")
                    .display()
                    .to_string(),
                runner: "blender-bridge".to_string(),
                runner_data: None,
                execution_target: None,
                bridge_action: "flowcell_test".to_string(),
                bridge_data: None,
                state_query: None,
                events: None,
                children: Vec::new(),
                layout: None,
                page: None,
                source_display_path: "action.py".to_string(),
                bundled_source_id: None,
                bundled_source_version: None,
            },
            original_record_path: root.join("owner.flowcell-source.json"),
            original_package_path: root.join("local-package"),
            quarantine_record_path: owner_root.join("owner.flowcell-source.json"),
            quarantine_package_path: owner_root.join("local-package"),
            bindings_path: root.join("bindings.ini"),
            bindings_backup,
            enabled_contributions_path: None,
            enabled_contributions_before: None,
            enabled_contributions_after: None,
            removed_binding_count: 1,
        }
    }

    fn create_original_source(source: &QuarantinedOwnedSource) {
        fs::write(&source.original_record_path, "record").expect("write active record");
        fs::create_dir_all(source.original_package_path.join("source"))
            .expect("create Local package");
        fs::write(
            source.original_package_path.join("source/action.py"),
            "action",
        )
        .expect("write installed action");
        if let Some(backup) = source.bindings_backup.as_ref() {
            fs::write(&source.bindings_path, backup).expect("write original bindings");
        }
    }

    fn assert_source_restored(source: &QuarantinedOwnedSource) {
        assert!(source.original_record_path.is_file());
        assert!(source.original_package_path.is_dir());
        assert!(!source.quarantine_record_path.exists());
        assert!(!source.quarantine_package_path.exists());
    }

    #[test]
    fn rollback_is_idempotent_across_quarantine_fault_cuts() {
        let first_root = TestRoot::new("after-record-move");
        let first = test_source(&first_root, Some("old-bindings".to_string()));
        create_original_source(&first);
        fs::rename(&first.original_record_path, &first.quarantine_record_path)
            .expect("quarantine active record");
        let mut runtime_restores = 0;
        rollback_quarantined_source_with(
            &first,
            |_| {
                runtime_restores += 1;
                Ok(())
            },
            || {},
        )
        .expect("recover after record move");
        assert_source_restored(&first);
        assert_eq!(
            fs::read_to_string(&first.bindings_path).expect("read restored bindings"),
            "old-bindings"
        );
        assert_eq!(runtime_restores, 1);

        // Re-running recovery after the same journal survived is harmless.
        rollback_quarantined_source_with(&first, |_| Ok(()), || {})
            .expect("repeat completed rollback");
        assert_source_restored(&first);

        let second_root = TestRoot::new("after-runtime-cleanup");
        let second = test_source(&second_root, Some("original-bindings".to_string()));
        create_original_source(&second);
        fs::rename(&second.original_record_path, &second.quarantine_record_path)
            .expect("quarantine second active record");
        fs::rename(
            &second.original_package_path,
            &second.quarantine_package_path,
        )
        .expect("quarantine second Local package");
        fs::write(&second.bindings_path, "bindings-after-delete").expect("write modified bindings");
        let mut blender_redeploys = 0;
        rollback_quarantined_source_with(
            &second,
            |record| {
                assert_eq!(record.runner, "blender-bridge");
                blender_redeploys += 1;
                Ok(())
            },
            || {},
        )
        .expect("recover after all external resources changed");
        assert_source_restored(&second);
        assert_eq!(
            fs::read_to_string(&second.bindings_path).expect("read second restored bindings"),
            "original-bindings"
        );
        assert_eq!(blender_redeploys, 1);

        let no_bindings_root = TestRoot::new("bindings-created");
        let no_bindings = test_source(&no_bindings_root, None);
        create_original_source(&no_bindings);
        fs::write(&no_bindings.bindings_path, "created-during-quarantine")
            .expect("write newly created bindings");
        rollback_quarantined_source_with(&no_bindings, |_| Ok(()), || {})
            .expect("recover originally absent bindings");
        assert!(!no_bindings.bindings_path.exists());
        assert!(Path::new(&no_bindings.quarantine_record_path)
            .parent()
            .expect("owner quarantine parent")
            .join("bindings-created-during-quarantine.ini")
            .is_file());
    }
}
#[test]
fn windows_verbatim_paths_match_ordinary_owned_paths() {
    assert!(paths_equal(
        Path::new(r"\\?\D:\FlowCell\Programs\Illustrator\Local\owner"),
        Path::new(r"D:\FlowCell\Programs\Illustrator\Local\owner")
    ));
    assert!(path_is_under(
        r"D:\FlowCell\Programs\Illustrator\Local\owner\source\action.jsx",
        Path::new(r"\\?\D:\FlowCell\Programs\Illustrator\Local\owner")
    ));
    assert!(paths_equal(
        Path::new(r"\\?\UNC\server\share\FlowCell\owner"),
        Path::new(r"\\server\share\FlowCell\owner")
    ));
}
