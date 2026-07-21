use crate::*;
use std::collections::BTreeSet;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AvailableProgramPackagesResponse {
    pub(crate) packages: Vec<AvailableProgramPackage>,
    pub(crate) rejected_packages: Vec<RejectedProgramPackage>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RejectedProgramPackage {
    pub(crate) folder_name: String,
    pub(crate) error: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AvailableProgramPackage {
    pub(crate) program_id: String,
    pub(crate) program_name: String,
    pub(crate) program_type: String,
    pub(crate) suggested_executable: String,
    pub(crate) panels: Vec<ProgramSetupPanel>,
    pub(crate) sources: Vec<ProgramSetupSource>,
    pub(crate) support_content: Vec<String>,
    pub(crate) required_versions: Vec<String>,
    pub(crate) install_effects: Vec<String>,
    pub(crate) addon_reload_notes: String,
    pub(crate) app_restart_notes: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProgramSetupPanel {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) default_selected: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProgramSetupSource {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) tooltip: String,
    pub(crate) version: String,
    pub(crate) panel_name: String,
    pub(crate) source_kind: String,
    pub(crate) required: bool,
    pub(crate) default_selected: bool,
    pub(crate) dependencies: Vec<String>,
    pub(crate) install_effects: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AddProgramSourceSelection {
    pub(crate) source_id: String,
    pub(crate) destination_panel: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AddProgramPlanRequest {
    pub(crate) program_name: String,
    pub(crate) executable_path: String,
    #[serde(default)]
    pub(crate) selected_panels: Vec<String>,
    #[serde(default)]
    pub(crate) selected_sources: Vec<AddProgramSourceSelection>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddProgramPreflight {
    pub(crate) program_id: String,
    pub(crate) program_name: String,
    pub(crate) executable_path: String,
    pub(crate) panels: Vec<String>,
    pub(crate) sources: Vec<ProgramSetupSource>,
    pub(crate) install_effects: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppliedProgramSetup {
    pub(crate) transaction_token: String,
    pub(crate) program_name: String,
    pub(crate) panels: Vec<String>,
    pub(crate) descriptors: Vec<program_sources::install::InstallButtonSourceResponse>,
    pub(crate) install_effects: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AddPanelPlanRequest {
    pub(crate) program_name: String,
    pub(crate) panel_name: String,
    #[serde(default)]
    pub(crate) source_folder: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddPanelPreflight {
    pub(crate) program_name: String,
    pub(crate) panel_name: String,
    pub(crate) source_folder: Option<String>,
    pub(crate) existing: bool,
    pub(crate) copy_file_count: u64,
    pub(crate) copy_byte_count: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppliedPanelSetup {
    pub(crate) transaction_token: String,
    pub(crate) program_name: String,
    pub(crate) panel_name: String,
    pub(crate) created: bool,
}

const DELETE_TRANSACTION_SCHEMA_VERSION: u32 = 1;
const PROGRAM_UNREGISTRATION_TRANSACTION_FILE_NAME: &str =
    "program-unregistration-transaction.json";
const PANEL_DELETION_TRANSACTION_FILE_NAME: &str = "panel-deletion-transaction.json";
const PANEL_DELETION_MARKER_FILE_NAME: &str = ".flowcell-panel-deletion-transaction.json";
static DELETE_LIFECYCLE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProgramUnregistrationTransactionJournal {
    schema_version: u32,
    transaction_token: String,
    program_name: String,
    bindings_path: PathBuf,
    bindings_before_existed: bool,
    bindings_before: Vec<u8>,
    bindings_after: Vec<u8>,
    enabled_state_path: PathBuf,
    enabled_state_before: Option<Vec<u8>>,
    enabled_state_after: Option<Vec<u8>>,
    expected_owner_button_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PanelDeletionTransactionJournal {
    schema_version: u32,
    transaction_token: String,
    program_name: String,
    panel_name: String,
    panels_root: PathBuf,
    panel_path: PathBuf,
    expected_owner_button_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PanelDeletionMarker {
    schema_version: u32,
    transaction_token: String,
    program_name: String,
    panel_name: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CanonicalDeleteBoundary {
    OwnersRemain,
    OwnersAbsent,
    PartialOrConflicting,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ExactFileBoundary {
    Before,
    After,
    Both,
}

pub(crate) fn resolve_programs_root() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root().ok_or_else(|| {
        "FlowCell repo root could not be resolved for program folders.".to_string()
    })?;
    let programs_root = repo_root.join("Programs");
    if programs_root.is_dir() {
        Ok(programs_root)
    } else {
        Err(format!(
            "Programs folder was not found at {}.",
            programs_root.display()
        ))
    }
}

pub(crate) fn validate_folder_name(raw_name: &str, kind: &str) -> Result<String, String> {
    let name = raw_name.trim();
    if name.is_empty() {
        return Err(format!("{kind} name cannot be empty."));
    }

    if matches!(name, "." | "..") {
        return Err(format!("{kind} name is not valid."));
    }

    if name.ends_with(' ') || name.ends_with('.') {
        return Err(format!("{kind} name cannot end with a space or period."));
    }

    if name.chars().any(|character| {
        character.is_control()
            || matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
    }) {
        return Err(format!("{kind} name contains invalid filename characters."));
    }

    Ok(name.to_string())
}

fn list_child_directory_names(parent: &Path) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    let entries = fs::read_dir(parent)
        .map_err(|error| format!("Failed to read {}: {error}", parent.display()))?;

    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Failed to read {}: {error}", parent.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;

        if !file_type.is_dir() {
            continue;
        }

        names.push(entry.file_name().to_string_lossy().to_string());
    }

    names.sort_by_cached_key(|name| name.to_ascii_lowercase());
    Ok(names)
}

fn find_named_child_directory(parent: &Path, name: &str) -> Result<Option<PathBuf>, String> {
    let entries = fs::read_dir(parent)
        .map_err(|error| format!("Failed to read {}: {error}", parent.display()))?;

    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Failed to read {}: {error}", parent.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;

        if !file_type.is_dir() {
            continue;
        }

        let candidate_name = entry.file_name().to_string_lossy().to_string();
        if candidate_name.eq_ignore_ascii_case(name) {
            return Ok(Some(entry.path()));
        }
    }

    Ok(None)
}

fn paths_refer_to_same_existing_entry(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }

    let Ok(left_canonical) = fs::canonicalize(left) else {
        return false;
    };
    let Ok(right_canonical) = fs::canonicalize(right) else {
        return false;
    };

    if left_canonical == right_canonical {
        return true;
    }

    left_canonical
        .to_string_lossy()
        .eq_ignore_ascii_case(right_canonical.to_string_lossy().as_ref())
}

fn unique_temporary_rename_path(parent: &Path, kind: &str) -> Result<PathBuf, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let normalized_kind = kind.trim().to_ascii_lowercase();

    for attempt in 0..100 {
        let candidate = parent.join(format!(
            ".flowcell-{}-rename-{}-{}",
            normalized_kind, stamp, attempt
        ));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "Could not find a temporary folder name in {}.",
        parent.display()
    ))
}

fn rename_directory_path(
    current_path: &Path,
    target_path: &Path,
    final_name: &str,
    kind: &str,
) -> Result<(), String> {
    let current_name = current_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();

    if current_name == final_name {
        return Ok(());
    }

    if current_name.eq_ignore_ascii_case(final_name) {
        let parent = current_path.parent().ok_or_else(|| {
            format!(
                "{} folder parent could not be resolved for {}.",
                kind,
                current_path.display()
            )
        })?;
        let temporary_path = unique_temporary_rename_path(parent, kind)?;
        fs::rename(current_path, &temporary_path).map_err(|error| {
            format!(
                "Failed to prepare {} for case-only rename at {}: {error}",
                kind.to_ascii_lowercase(),
                current_path.display()
            )
        })?;
        if let Err(error) = fs::rename(&temporary_path, target_path) {
            let _ = fs::rename(&temporary_path, current_path);
            return Err(format!(
                "Failed to rename {} folder to '{}': {error}",
                kind.to_ascii_lowercase(),
                final_name
            ));
        }
        return Ok(());
    }

    fs::rename(current_path, target_path).map_err(|error| {
        format!(
            "Failed to rename {} folder '{}' to '{}': {error}",
            kind.to_ascii_lowercase(),
            current_name,
            final_name
        )
    })
}

fn rename_child_directory(
    parent: &Path,
    current_name: &str,
    next_name: &str,
    kind: &str,
) -> Result<String, String> {
    let current_name = validate_folder_name(current_name, kind)?;
    let next_name = validate_folder_name(next_name, kind)?;
    let current_path = find_named_child_directory(parent, &current_name)?.ok_or_else(|| {
        format!(
            "{} folder '{}' was not found in {}.",
            kind,
            current_name,
            parent.display()
        )
    })?;

    if let Some(existing_target_path) = find_named_child_directory(parent, &next_name)? {
        if !paths_refer_to_same_existing_entry(&existing_target_path, &current_path) {
            return Err(format!("{} folder '{}' already exists.", kind, next_name));
        }
    }

    let target_path = parent.join(&next_name);
    rename_directory_path(&current_path, &target_path, &next_name, kind)?;
    Ok(next_name)
}

fn rebase_program_path_text(value: &str, previous_root: &Path, next_root: &Path) -> String {
    let previous = previous_root.to_string_lossy();
    let next = next_root.to_string_lossy();
    let lower_value = value.to_ascii_lowercase();
    let lower_previous = previous.to_ascii_lowercase();
    let Some(index) = lower_value.find(&lower_previous) else {
        return value.to_string();
    };
    let extended_prefix = value.starts_with(r"\\?\");
    if index != 0 && !(extended_prefix && index == 4) {
        return value.to_string();
    }
    let end = index + previous.len();
    if end < value.len() && !matches!(value.as_bytes()[end], b'\\' | b'/') {
        return value.to_string();
    }
    format!(
        "{}{}{}",
        &value[..index],
        next,
        &value[index + previous.len()..]
    )
}

fn prepare_program_rename_bindings(
    document: &mut IniDocument,
    current_name: &str,
    next_name: &str,
    previous_root: &Path,
    next_root: &Path,
    local_scripts_folder: &str,
) -> Result<bool, String> {
    let Some(program) = find_registered_program(document, current_name) else {
        return Ok(false);
    };
    let section_name = format!("ProgramTab_{}", program.id);
    let section = document.get_mut(&section_name).ok_or_else(|| {
        format!(
            "Registered program '{}' is missing bindings section '{}'.",
            current_name, section_name
        )
    })?;
    section.insert(String::from("Label"), next_name.to_string());
    section.insert(
        String::from("NormalizedName"),
        next_name.to_ascii_lowercase(),
    );
    section.insert(
        String::from("ScriptFolder"),
        next_root
            .join(local_scripts_folder)
            .to_string_lossy()
            .to_string(),
    );
    for key in ["BridgeFolder", "ExePath"] {
        if let Some(value) = section.get_mut(key) {
            *value = rebase_program_path_text(value, previous_root, next_root);
        }
    }

    let program_id = program.id.to_string();
    for binding in document.values_mut() {
        if binding.get("ProgramTabId").map(String::as_str) != Some(program_id.as_str()) {
            continue;
        }
        if let Some(script_path) = binding.get_mut("ScriptPath") {
            *script_path = rebase_program_path_text(script_path, previous_root, next_root);
        }
    }
    sync_program_registration_meta(document, Some(program.id));
    Ok(true)
}

fn delete_transactions_root() -> Result<PathBuf, String> {
    add_program_transactions_root()
}

fn program_unregistration_transaction_path(root: &Path) -> PathBuf {
    root.join(PROGRAM_UNREGISTRATION_TRANSACTION_FILE_NAME)
}

fn panel_deletion_transaction_path(root: &Path) -> PathBuf {
    root.join(PANEL_DELETION_TRANSACTION_FILE_NAME)
}

fn panel_deletion_marker_path(panel_path: &Path) -> PathBuf {
    panel_path.join(PANEL_DELETION_MARKER_FILE_NAME)
}

fn paths_match_case_insensitively(left: &Path, right: &Path) -> bool {
    left == right
        || left
            .to_string_lossy()
            .eq_ignore_ascii_case(right.to_string_lossy().as_ref())
}

fn validate_delete_transaction_root(
    root: &Path,
    transaction_token: &str,
    token_prefix: &str,
) -> Result<(), String> {
    let token = validate_folder_name(transaction_token, "Deletion transaction token")?;
    if token != transaction_token || !token.starts_with(token_prefix) {
        return Err("Deletion transaction token is invalid for its journal kind.".to_string());
    }
    if root.file_name().and_then(|value| value.to_str()) != Some(token.as_str()) {
        return Err(format!(
            "Deletion transaction token does not match its directory at {}.",
            root.display()
        ));
    }
    if root.exists() {
        program_sources::installed_page::reject_package_source_reparse_point(root)?;
        if !root.is_dir() {
            return Err(format!(
                "Deletion transaction path is not a directory: {}.",
                root.display()
            ));
        }
    }
    Ok(())
}

fn normalize_delete_expected_owner_ids(values: Vec<String>) -> Result<Vec<String>, String> {
    let mut values = normalize_expected_button_ids(values)?;
    values.sort_by_cached_key(|value| value.to_ascii_lowercase());
    Ok(values)
}

fn parse_bindings_bytes(contents: &[u8], label: &str) -> Result<IniDocument, String> {
    let raw = std::str::from_utf8(contents)
        .map_err(|error| format!("Stored {label} bindings are not UTF-8: {error}"))?;
    Ok(parse_ini_document(raw))
}

fn parse_stored_enabled_program_contributions(
    contents: &[u8],
    program_name: &str,
) -> Result<program_sources::manifest::EnabledProgramContributions, String> {
    let state =
        serde_json::from_slice::<program_sources::manifest::EnabledProgramContributions>(contents)
            .map_err(|error| format!("Stored enabled contribution state is invalid: {error}"))?;
    if state.schema_version != 1
        || state.program_id.trim().is_empty()
        || !state.program_name.eq_ignore_ascii_case(program_name)
    {
        return Err(format!(
            "Stored enabled contribution state does not match program '{}'.",
            program_name
        ));
    }
    Ok(state)
}

fn snapshot_enabled_program_contributions(
    manifest: &program_sources::manifest::ProgramManifest,
) -> Result<(PathBuf, Option<Vec<u8>>), String> {
    let path = program_sources::manifest::enabled_program_contributions_path(manifest)?;
    program_sources::transaction::recover_json_file(&path, |candidate| {
        let contents = fs::read(candidate)
            .map_err(|error| format!("Failed to read {}: {error}", candidate.display()))?;
        let mut state = parse_stored_enabled_program_contributions(&contents, &manifest.label)?;
        program_sources::manifest::validate_enabled_program_contributions(&mut state, manifest)
    })?;
    let contents = current_optional_file_bytes(&path, "Enabled program contribution state")?;
    if let Some(contents) = contents.as_deref() {
        let mut state = parse_stored_enabled_program_contributions(contents, &manifest.label)?;
        program_sources::manifest::validate_enabled_program_contributions(&mut state, manifest)?;
    }
    Ok((path, contents))
}

fn validate_program_unregistration_journal(
    root: &Path,
    journal: &ProgramUnregistrationTransactionJournal,
) -> Result<(), String> {
    if journal.schema_version != DELETE_TRANSACTION_SCHEMA_VERSION {
        return Err(format!(
            "Program unregistration transaction has unsupported schemaVersion {}.",
            journal.schema_version
        ));
    }
    validate_delete_transaction_root(root, &journal.transaction_token, "delete-program-")?;
    let program_name = validate_folder_name(&journal.program_name, "Program")?;
    if program_name != journal.program_name {
        return Err(
            "Program unregistration journal contains a non-canonical program name.".to_string(),
        );
    }
    if !journal.bindings_path.is_absolute() || !journal.enabled_state_path.is_absolute() {
        return Err("Program unregistration state paths must be absolute.".to_string());
    }
    if !journal.bindings_before_existed {
        return Err(
            "Program unregistration journal cannot remove a registration from a missing bindings file."
                .to_string(),
        );
    }
    let normalized =
        normalize_delete_expected_owner_ids(journal.expected_owner_button_ids.clone())?;
    if normalized != journal.expected_owner_button_ids {
        return Err(
            "Program unregistration expected owner IDs are not normalized and sorted.".to_string(),
        );
    }
    let before = parse_bindings_bytes(&journal.bindings_before, "pre-delete")?;
    if find_registered_program(&before, &journal.program_name).is_none() {
        return Err(format!(
            "Program unregistration pre-delete bindings do not register '{}'.",
            journal.program_name
        ));
    }
    let mut expected_after = before;
    remove_program_registration(&mut expected_after, &journal.program_name);
    if serialize_bindings_file_state(&expected_after) != journal.bindings_after {
        return Err(
            "Program unregistration post-delete bindings do not exactly match removal of the stored program registration."
                .to_string(),
        );
    }
    if journal.enabled_state_after.is_some() {
        return Err(
            "Program unregistration post-delete enabled contribution state must be absent."
                .to_string(),
        );
    }
    if let Some(contents) = journal.enabled_state_before.as_deref() {
        parse_stored_enabled_program_contributions(contents, &journal.program_name)?;
    }
    Ok(())
}

fn validate_panel_deletion_journal(
    root: &Path,
    journal: &PanelDeletionTransactionJournal,
) -> Result<(), String> {
    if journal.schema_version != DELETE_TRANSACTION_SCHEMA_VERSION {
        return Err(format!(
            "Panel deletion transaction has unsupported schemaVersion {}.",
            journal.schema_version
        ));
    }
    validate_delete_transaction_root(root, &journal.transaction_token, "delete-panel-")?;
    let program_name = validate_folder_name(&journal.program_name, "Program")?;
    let panel_name = validate_folder_name(&journal.panel_name, "Panel")?;
    if program_name != journal.program_name || panel_name != journal.panel_name {
        return Err("Panel deletion journal contains a non-canonical name.".to_string());
    }
    if !journal.panels_root.is_absolute() || !journal.panel_path.is_absolute() {
        return Err("Panel deletion journal paths must be absolute.".to_string());
    }
    let parent = journal
        .panel_path
        .parent()
        .ok_or_else(|| "Panel deletion path has no parent.".to_string())?;
    if !paths_match_case_insensitively(parent, &journal.panels_root)
        || !journal
            .panel_path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case(&journal.panel_name))
            .unwrap_or(false)
    {
        return Err(
            "Panel deletion target is not the named immediate child of its owned Panels root."
                .to_string(),
        );
    }
    let normalized =
        normalize_delete_expected_owner_ids(journal.expected_owner_button_ids.clone())?;
    if normalized != journal.expected_owner_button_ids {
        return Err("Panel deletion expected owner IDs are not normalized and sorted.".to_string());
    }
    Ok(())
}

fn parse_program_unregistration_journal(
    root: &Path,
    path: &Path,
) -> Result<ProgramUnregistrationTransactionJournal, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let journal =
        serde_json::from_str::<ProgramUnregistrationTransactionJournal>(&raw).map_err(|error| {
            format!(
                "Program unregistration transaction {} is invalid: {error}",
                path.display()
            )
        })?;
    validate_program_unregistration_journal(root, &journal)?;
    Ok(journal)
}

fn read_program_unregistration_journal(
    root: &Path,
) -> Result<ProgramUnregistrationTransactionJournal, String> {
    let path = program_unregistration_transaction_path(root);
    program_sources::transaction::read_json_file(&path, |candidate| {
        parse_program_unregistration_journal(root, candidate)
    })
}

fn write_program_unregistration_journal(
    root: &Path,
    journal: &ProgramUnregistrationTransactionJournal,
) -> Result<(), String> {
    validate_program_unregistration_journal(root, journal)?;
    let body = serde_json::to_vec_pretty(journal).map_err(|error| {
        format!("Failed to serialize Program unregistration transaction: {error}")
    })?;
    program_sources::transaction::write_json_file(
        &program_unregistration_transaction_path(root),
        &body,
        program_sources::transaction::AtomicWriteMode::Create,
    )
}

fn parse_panel_deletion_journal(
    root: &Path,
    path: &Path,
) -> Result<PanelDeletionTransactionJournal, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let journal =
        serde_json::from_str::<PanelDeletionTransactionJournal>(&raw).map_err(|error| {
            format!(
                "Panel deletion transaction {} is invalid: {error}",
                path.display()
            )
        })?;
    validate_panel_deletion_journal(root, &journal)?;
    Ok(journal)
}

fn read_panel_deletion_journal(root: &Path) -> Result<PanelDeletionTransactionJournal, String> {
    let path = panel_deletion_transaction_path(root);
    program_sources::transaction::read_json_file(&path, |candidate| {
        parse_panel_deletion_journal(root, candidate)
    })
}

fn write_panel_deletion_journal(
    root: &Path,
    journal: &PanelDeletionTransactionJournal,
) -> Result<(), String> {
    validate_panel_deletion_journal(root, journal)?;
    let body = serde_json::to_vec_pretty(journal)
        .map_err(|error| format!("Failed to serialize Panel deletion transaction: {error}"))?;
    program_sources::transaction::write_json_file(
        &panel_deletion_transaction_path(root),
        &body,
        program_sources::transaction::AtomicWriteMode::Create,
    )
}

fn ensure_no_pending_delete_transaction(transactions_root: &Path) -> Result<(), String> {
    if !transactions_root.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(transactions_root)
        .map_err(|error| format!("Failed to read {}: {error}", transactions_root.display()))?
    {
        let entry = entry.map_err(|error| {
            format!("Failed to inspect {}: {error}", transactions_root.display())
        })?;
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        let has_delete_journal = path
            .join(PROGRAM_UNREGISTRATION_TRANSACTION_FILE_NAME)
            .exists()
            || path.join(PANEL_DELETION_TRANSACTION_FILE_NAME).exists();
        if !name.starts_with("delete-program-")
            && !name.starts_with("delete-panel-")
            && !has_delete_journal
        {
            continue;
        }
        program_sources::installed_page::reject_package_source_reparse_point(&path)?;
        return Err(format!(
            "Deletion transaction '{name}' is still awaiting finalization or rollback."
        ));
    }
    Ok(())
}

fn cleanup_delete_transaction_root(root: &Path, journal_file_name: &str) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    program_sources::installed_page::reject_package_source_reparse_point(root)?;
    let mut entries = fs::read_dir(root)
        .map_err(|error| format!("Failed to inspect {}: {error}", root.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to inspect {}: {error}", root.display()))?;
    entries.sort_by_key(|entry| entry.file_name());
    if entries.len() != 1 || entries[0].file_name().to_string_lossy() != journal_file_name {
        return Err(format!(
            "Deletion transaction {} contains unexpected artifacts; refusing recursive cleanup.",
            root.display()
        ));
    }
    let journal_path = entries.remove(0).path();
    program_sources::installed_page::reject_package_source_reparse_point(&journal_path)?;
    fs::remove_file(&journal_path)
        .map_err(|error| format!("Failed to remove {}: {error}", journal_path.display()))?;
    fs::remove_dir(root).map_err(|error| {
        format!(
            "Deletion committed, but temporary transaction cleanup failed at {}: {error}",
            root.display()
        )
    })
}

fn canonical_owner_ids_in_scope(
    document: Option<&Value>,
    program_name: &str,
    panel_name: Option<&str>,
) -> Vec<String> {
    let Some(buttons) = document
        .and_then(|document| document.get("buttons"))
        .and_then(Value::as_object)
    else {
        return Vec::new();
    };
    let mut owners = buttons
        .iter()
        .filter_map(|(button_id, button)| {
            let source_matches = button.get("role").and_then(Value::as_str)
                != Some("tool-set-child")
                && button
                    .get("sourceIdentity")
                    .and_then(Value::as_object)
                    .map(|identity| {
                        identity
                            .get("displayProgramName")
                            .and_then(Value::as_str)
                            .map(|value| {
                                normalize_canonical_source_part(value)
                                    == normalize_canonical_source_part(program_name)
                            })
                            .unwrap_or(false)
                            && panel_name
                                .map(|expected| {
                                    identity
                                        .get("displayPanelName")
                                        .and_then(Value::as_str)
                                        .map(|value| {
                                            normalize_canonical_source_part(value)
                                                == normalize_canonical_source_part(expected)
                                        })
                                        .unwrap_or(false)
                                })
                                .unwrap_or(true)
                    })
                    .unwrap_or(false);
            let panel_owner_matches = button.get("role").and_then(Value::as_str)
                == Some("panel-owner")
                && button
                    .get("metadata")
                    .and_then(Value::as_object)
                    .map(|metadata| {
                        metadata
                            .get("programName")
                            .and_then(Value::as_str)
                            .map(|value| {
                                normalize_canonical_source_part(value)
                                    == normalize_canonical_source_part(program_name)
                            })
                            .unwrap_or(false)
                            && panel_name
                                .map(|expected| {
                                    metadata
                                        .get("panelName")
                                        .and_then(Value::as_str)
                                        .map(|value| {
                                            normalize_canonical_source_part(value)
                                                == normalize_canonical_source_part(expected)
                                        })
                                        .unwrap_or(false)
                                })
                                .unwrap_or(true)
                    })
                    .unwrap_or(false);
            (source_matches || panel_owner_matches).then(|| button_id.clone())
        })
        .collect::<Vec<_>>();
    owners.sort_by_cached_key(|value| value.to_ascii_lowercase());
    owners
}

fn owner_id_sets_match(left: &[String], right: &[String]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
}

fn canonical_delete_boundary(
    document: Option<&Value>,
    program_name: &str,
    panel_name: Option<&str>,
    expected_owner_button_ids: &[String],
) -> CanonicalDeleteBoundary {
    let actual = canonical_owner_ids_in_scope(document, program_name, panel_name);
    if expected_owner_button_ids.is_empty() {
        return if actual.is_empty() {
            CanonicalDeleteBoundary::OwnersAbsent
        } else {
            CanonicalDeleteBoundary::PartialOrConflicting
        };
    }
    let present = expected_owner_button_ids
        .iter()
        .filter(|expected| {
            actual
                .iter()
                .any(|actual| actual.eq_ignore_ascii_case(expected))
        })
        .count();
    if present == expected_owner_button_ids.len()
        && owner_id_sets_match(&actual, expected_owner_button_ids)
    {
        CanonicalDeleteBoundary::OwnersRemain
    } else if present == 0 && actual.is_empty() {
        CanonicalDeleteBoundary::OwnersAbsent
    } else {
        CanonicalDeleteBoundary::PartialOrConflicting
    }
}

fn require_exact_canonical_owner_set(
    document: Option<&Value>,
    program_name: &str,
    panel_name: Option<&str>,
    expected_owner_button_ids: &[String],
) -> Result<(), String> {
    let actual = canonical_owner_ids_in_scope(document, program_name, panel_name);
    if !owner_id_sets_match(&actual, expected_owner_button_ids) {
        return Err(format!(
            "Deletion expected the exact canonical owner set [{}], but the current scope contains [{}].",
            expected_owner_button_ids.join(", "),
            actual.join(", ")
        ));
    }
    Ok(())
}

fn current_optional_file_bytes(path: &Path, subject: &str) -> Result<Option<Vec<u8>>, String> {
    if path.is_file() {
        fs::read(path)
            .map(Some)
            .map_err(|error| format!("Failed to read {}: {error}", path.display()))
    } else if path.exists() {
        Err(format!("{subject} path is not a file: {}.", path.display()))
    } else {
        Ok(None)
    }
}

fn exact_file_boundary(
    path: &Path,
    before: Option<&[u8]>,
    after: Option<&[u8]>,
    subject: &str,
) -> Result<ExactFileBoundary, String> {
    let current = current_optional_file_bytes(path, subject)?;
    let matches_before = current.as_deref() == before;
    let matches_after = current.as_deref() == after;
    match (matches_before, matches_after) {
        (true, true) => Ok(ExactFileBoundary::Both),
        (true, false) => Ok(ExactFileBoundary::Before),
        (false, true) => Ok(ExactFileBoundary::After),
        (false, false) => Err(format!(
            "{subject} changed while program unregistration was pending. Refusing to overwrite unrelated changes; the durable journal was retained."
        )),
    }
}

fn program_unregistration_native_boundaries(
    journal: &ProgramUnregistrationTransactionJournal,
) -> Result<(ExactFileBoundary, ExactFileBoundary), String> {
    let bindings = exact_file_boundary(
        &journal.bindings_path,
        Some(&journal.bindings_before),
        Some(&journal.bindings_after),
        "FlowCell bindings",
    )?;
    let enabled_state = exact_file_boundary(
        &journal.enabled_state_path,
        journal.enabled_state_before.as_deref(),
        journal.enabled_state_after.as_deref(),
        "Enabled program contribution state",
    )?;
    Ok((bindings, enabled_state))
}

fn restore_program_unregistration_native_state(
    journal: &ProgramUnregistrationTransactionJournal,
) -> Result<(), String> {
    let (bindings, enabled_state) = program_unregistration_native_boundaries(journal)?;
    if bindings == ExactFileBoundary::After {
        write_bindings_bytes_atomic(&journal.bindings_path, &journal.bindings_before)
            .map_err(|error| format!("Failed to restore pre-delete bindings: {error}"))?;
    }
    if enabled_state == ExactFileBoundary::After {
        if let Some(before) = journal.enabled_state_before.as_deref() {
            program_sources::transaction::write_json_file(
                &journal.enabled_state_path,
                before,
                program_sources::transaction::AtomicWriteMode::Replace,
            )
            .map_err(|error| {
                format!("Failed to restore pre-delete enabled contribution state: {error}")
            })?;
        }
    }
    Ok(())
}

fn apply_program_unregistration_native_state(
    journal: &ProgramUnregistrationTransactionJournal,
) -> Result<(), String> {
    let (bindings, enabled_state) = program_unregistration_native_boundaries(journal)?;
    if bindings == ExactFileBoundary::Before {
        write_bindings_bytes_atomic(&journal.bindings_path, &journal.bindings_after)
            .map_err(|error| format!("Failed to apply post-delete bindings: {error}"))?;
    }
    if enabled_state == ExactFileBoundary::Before && journal.enabled_state_before.is_some() {
        recycle_file_path(&journal.enabled_state_path).map_err(|error| {
            format!("Failed to recycle enabled contribution state during program removal: {error}")
        })?;
    }
    Ok(())
}

fn begin_program_unregistration_with_state(
    program_name: String,
    mut document: IniDocument,
    bindings_path: PathBuf,
    enabled_state_path: PathBuf,
    enabled_state_before: Option<Vec<u8>>,
    expected_owner_button_ids: Vec<String>,
    canonical_document: Option<&Value>,
    transactions_root: &Path,
) -> Result<String, String> {
    if find_registered_program(&document, &program_name).is_none() {
        return Err(format!(
            "Program '{}' is not registered in FlowCell.",
            program_name
        ));
    }
    let expected_owner_button_ids = normalize_delete_expected_owner_ids(expected_owner_button_ids)?;
    require_exact_canonical_owner_set(
        canonical_document,
        &program_name,
        None,
        &expected_owner_button_ids,
    )?;
    ensure_no_pending_delete_transaction(transactions_root)?;
    let bindings_before = fs::read(&bindings_path).map_err(|error| {
        format!(
            "Failed to snapshot FlowCell bindings at {}: {error}",
            bindings_path.display()
        )
    })?;
    remove_program_registration(&mut document, &program_name);
    let bindings_after = serialize_bindings_file_state(&document);
    let transaction_token = next_setup_transaction_token("delete-program");
    let transaction_root = transactions_root.join(&transaction_token);
    let journal = ProgramUnregistrationTransactionJournal {
        schema_version: DELETE_TRANSACTION_SCHEMA_VERSION,
        transaction_token: transaction_token.clone(),
        program_name,
        bindings_path,
        bindings_before_existed: true,
        bindings_before,
        bindings_after,
        enabled_state_path,
        enabled_state_before,
        enabled_state_after: None,
        expected_owner_button_ids,
    };
    write_program_unregistration_journal(&transaction_root, &journal)?;
    if let Err(error) = program_unregistration_native_boundaries(&journal) {
        let cleanup = cleanup_delete_transaction_root(
            &transaction_root,
            PROGRAM_UNREGISTRATION_TRANSACTION_FILE_NAME,
        );
        return Err(match cleanup {
            Ok(()) => format!(
                "Program native state changed while unregistration was being prepared; no state was removed: {error}"
            ),
            Err(cleanup_error) => format!(
                "Program native state changed while unregistration was being prepared: {error} The inert journal remains at {} because cleanup failed: {cleanup_error}",
                transaction_root.display()
            ),
        });
    }
    if let Err(error) = apply_program_unregistration_native_state(&journal) {
        let rollback = restore_program_unregistration_native_state(&journal).and_then(|_| {
            cleanup_delete_transaction_root(
                &transaction_root,
                PROGRAM_UNREGISTRATION_TRANSACTION_FILE_NAME,
            )
        });
        return Err(match rollback {
            Ok(()) => format!(
                "Program unregistration did not cross the canonical commit boundary and was rolled back: {error}"
            ),
            Err(rollback_error) => format!(
                "Program unregistration native state failed: {error} Recovery was retained at {}: {rollback_error}",
                transaction_root.display()
            ),
        });
    }
    Ok(transaction_token)
}

fn rollback_program_unregistration_transaction(
    root: &Path,
    canonical_document: Option<&Value>,
) -> Result<(), String> {
    let journal = read_program_unregistration_journal(root)?;
    match canonical_delete_boundary(
        canonical_document,
        &journal.program_name,
        None,
        &journal.expected_owner_button_ids,
    ) {
        CanonicalDeleteBoundary::OwnersRemain => {
            restore_program_unregistration_native_state(&journal)?;
            cleanup_delete_transaction_root(
                root,
                PROGRAM_UNREGISTRATION_TRANSACTION_FILE_NAME,
            )
        }
        CanonicalDeleteBoundary::OwnersAbsent => Err(format!(
            "Canonical owners for '{}' are already absent; refusing to roll back a committed deletion.",
            journal.program_name
        )),
        CanonicalDeleteBoundary::PartialOrConflicting => Err(format!(
            "Canonical owners for '{}' are partial or changed. The durable unregistration journal was retained.",
            journal.program_name
        )),
    }
}

fn finalize_program_unregistration_transaction(
    root: &Path,
    canonical_document: Option<&Value>,
) -> Result<(), String> {
    let journal = read_program_unregistration_journal(root)?;
    match canonical_delete_boundary(
        canonical_document,
        &journal.program_name,
        None,
        &journal.expected_owner_button_ids,
    ) {
        CanonicalDeleteBoundary::OwnersAbsent => {
            apply_program_unregistration_native_state(&journal)?;
            cleanup_delete_transaction_root(
                root,
                PROGRAM_UNREGISTRATION_TRANSACTION_FILE_NAME,
            )
        }
        CanonicalDeleteBoundary::OwnersRemain => Err(format!(
            "Canonical owners for '{}' still remain; refusing to finalize program unregistration.",
            journal.program_name
        )),
        CanonicalDeleteBoundary::PartialOrConflicting => Err(format!(
            "Canonical owners for '{}' are partial or changed. The durable unregistration journal was retained.",
            journal.program_name
        )),
    }
}

fn validate_panel_deletion_marker(
    marker: &PanelDeletionMarker,
    journal: &PanelDeletionTransactionJournal,
) -> Result<(), String> {
    if marker.schema_version != DELETE_TRANSACTION_SCHEMA_VERSION
        || marker.transaction_token != journal.transaction_token
        || marker.program_name != journal.program_name
        || marker.panel_name != journal.panel_name
    {
        return Err(format!(
            "Panel deletion marker for '{}/{}' does not match its durable journal.",
            journal.program_name, journal.panel_name
        ));
    }
    Ok(())
}

fn parse_panel_deletion_marker(
    path: &Path,
    journal: &PanelDeletionTransactionJournal,
) -> Result<PanelDeletionMarker, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let marker = serde_json::from_str::<PanelDeletionMarker>(&raw).map_err(|error| {
        format!(
            "Panel deletion marker {} is invalid: {error}",
            path.display()
        )
    })?;
    validate_panel_deletion_marker(&marker, journal)?;
    Ok(marker)
}

fn read_panel_deletion_marker(
    journal: &PanelDeletionTransactionJournal,
) -> Result<Option<PanelDeletionMarker>, String> {
    let path = panel_deletion_marker_path(&journal.panel_path);
    if !path.exists() {
        return Ok(None);
    }
    program_sources::installed_page::reject_package_source_reparse_point(&path)?;
    program_sources::transaction::read_json_file(&path, |candidate| {
        parse_panel_deletion_marker(candidate, journal)
    })
    .map(Some)
}

fn write_panel_deletion_marker(journal: &PanelDeletionTransactionJournal) -> Result<(), String> {
    let marker = PanelDeletionMarker {
        schema_version: DELETE_TRANSACTION_SCHEMA_VERSION,
        transaction_token: journal.transaction_token.clone(),
        program_name: journal.program_name.clone(),
        panel_name: journal.panel_name.clone(),
    };
    let body = serde_json::to_vec_pretty(&marker)
        .map_err(|error| format!("Failed to serialize Panel deletion marker: {error}"))?;
    program_sources::transaction::write_json_file(
        &panel_deletion_marker_path(&journal.panel_path),
        &body,
        program_sources::transaction::AtomicWriteMode::Create,
    )
}

fn validate_owned_panel_delete_target(
    journal: &PanelDeletionTransactionJournal,
    require_exists: bool,
) -> Result<bool, String> {
    if !journal.panels_root.is_dir() {
        return Err(format!(
            "Owned Panels root is missing during panel deletion: {}.",
            journal.panels_root.display()
        ));
    }
    program_sources::installed_page::reject_selected_source_reparse_point(&journal.panels_root)?;
    program_sources::installed_page::reject_package_source_reparse_point(&journal.panels_root)?;
    let root_canonical = journal.panels_root.canonicalize().map_err(|error| {
        format!(
            "Owned Panels root {} could not be resolved: {error}",
            journal.panels_root.display()
        )
    })?;
    let parent = journal
        .panel_path
        .parent()
        .ok_or_else(|| "Panel deletion target has no parent.".to_string())?;
    if !paths_match_case_insensitively(parent, &journal.panels_root) {
        return Err(
            "Panel deletion target is no longer an immediate child of its owned Panels root."
                .to_string(),
        );
    }
    if !journal.panel_path.exists() {
        if require_exists {
            return Err(format!(
                "Panel deletion target is missing: {}.",
                journal.panel_path.display()
            ));
        }
        return Ok(false);
    }
    program_sources::installed_page::reject_selected_source_reparse_point(&journal.panel_path)?;
    program_sources::installed_page::reject_package_source_reparse_point(&journal.panel_path)?;
    if !journal.panel_path.is_dir() {
        return Err(format!(
            "Panel deletion target is not a directory: {}.",
            journal.panel_path.display()
        ));
    }
    let panel_canonical = journal.panel_path.canonicalize().map_err(|error| {
        format!(
            "Panel deletion target {} could not be resolved: {error}",
            journal.panel_path.display()
        )
    })?;
    let canonical_parent = panel_canonical
        .parent()
        .ok_or_else(|| "Canonical panel deletion target has no parent.".to_string())?;
    if !paths_match_case_insensitively(canonical_parent, &root_canonical) {
        return Err(
            "Panel deletion target resolves outside its owned immediate-child boundary."
                .to_string(),
        );
    }
    Ok(true)
}

fn validate_panel_deletion_live_resolution(
    journal: &PanelDeletionTransactionJournal,
    require_exists: bool,
) -> Result<bool, String> {
    let program_name = require_registered_program_name(&journal.program_name)?;
    if !program_name.eq_ignore_ascii_case(&journal.program_name) {
        return Err("Panel deletion program registration changed identity.".to_string());
    }
    let current_root = resolve_panels_root(&program_name, false)?.ok_or_else(|| {
        format!(
            "Panels folder for '{}' could not be resolved.",
            journal.program_name
        )
    })?;
    if !paths_match_case_insensitively(&current_root, &journal.panels_root)
        && !paths_refer_to_same_existing_entry(&current_root, &journal.panels_root)
    {
        return Err(format!(
            "Panel deletion Panels root changed from {} to {}.",
            journal.panels_root.display(),
            current_root.display()
        ));
    }
    let current_panel = panel_child_entry(&current_root, &journal.panel_name)?;
    match current_panel {
        Some(current_panel)
            if !paths_match_case_insensitively(&current_panel, &journal.panel_path)
                && !paths_refer_to_same_existing_entry(&current_panel, &journal.panel_path) =>
        {
            return Err(format!(
                "Panel deletion target changed from {} to {}.",
                journal.panel_path.display(),
                current_panel.display()
            ));
        }
        Some(_) => {}
        None if require_exists => {
            return Err(format!(
                "Panel deletion target is missing: {}.",
                journal.panel_path.display()
            ));
        }
        None => {}
    }
    validate_owned_panel_delete_target(journal, require_exists)
}

fn panel_contains_active_source_records(panel_path: &Path) -> Result<bool, String> {
    for entry in fs::read_dir(panel_path)
        .map_err(|error| format!("Failed to inspect {}: {error}", panel_path.display()))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to inspect {}: {error}", panel_path.display()))?;
        let path = entry.path();
        program_sources::installed_page::reject_package_source_reparse_point(&path)?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?;
        if file_type.is_file()
            && entry
                .file_name()
                .to_string_lossy()
                .to_ascii_lowercase()
                .ends_with(program_sources::records::ACTIVE_SOURCE_RECORD_SUFFIX)
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn cancel_panel_deletion_transaction_with<V>(
    root: &Path,
    canonical_document: Option<&Value>,
    validate_live: V,
) -> Result<(), String>
where
    V: FnOnce(&PanelDeletionTransactionJournal, bool) -> Result<bool, String>,
{
    let journal = read_panel_deletion_journal(root)?;
    match canonical_delete_boundary(
        canonical_document,
        &journal.program_name,
        Some(&journal.panel_name),
        &journal.expected_owner_button_ids,
    ) {
        CanonicalDeleteBoundary::OwnersRemain => {
            validate_live(&journal, true)?;
            let marker_path = panel_deletion_marker_path(&journal.panel_path);
            if read_panel_deletion_marker(&journal)?.is_some() {
                fs::remove_file(&marker_path).map_err(|error| {
                    format!("Failed to remove {}: {error}", marker_path.display())
                })?;
            }
            cleanup_delete_transaction_root(root, PANEL_DELETION_TRANSACTION_FILE_NAME)
        }
        CanonicalDeleteBoundary::OwnersAbsent => Err(format!(
            "Canonical owners for '{}/{}' are already absent; refusing to cancel a committed panel deletion.",
            journal.program_name, journal.panel_name
        )),
        CanonicalDeleteBoundary::PartialOrConflicting => Err(format!(
            "Canonical owners for '{}/{}' are partial or changed. The durable panel deletion journal was retained.",
            journal.program_name, journal.panel_name
        )),
    }
}

fn cancel_panel_deletion_transaction(
    root: &Path,
    canonical_document: Option<&Value>,
) -> Result<(), String> {
    cancel_panel_deletion_transaction_with(
        root,
        canonical_document,
        validate_panel_deletion_live_resolution,
    )
}

fn finalize_panel_deletion_transaction_with<V, F>(
    root: &Path,
    canonical_document: Option<&Value>,
    validate_live: V,
    recycle_panel: F,
) -> Result<(), String>
where
    V: FnOnce(&PanelDeletionTransactionJournal, bool) -> Result<bool, String>,
    F: FnOnce(&Path) -> Result<(), String>,
{
    let journal = read_panel_deletion_journal(root)?;
    match canonical_delete_boundary(
        canonical_document,
        &journal.program_name,
        Some(&journal.panel_name),
        &journal.expected_owner_button_ids,
    ) {
        CanonicalDeleteBoundary::OwnersAbsent => {
            let panel_exists = validate_live(&journal, false)?;
            if panel_exists {
                if read_panel_deletion_marker(&journal)?.is_none() {
                    return Err(format!(
                        "Panel deletion target '{}' no longer carries transaction marker '{}'; refusing to recycle a possibly replaced folder.",
                        journal.panel_path.display(),
                        journal.transaction_token
                    ));
                }
                program_sources::records::recover_active_records_in_directory(
                    &journal.panel_path,
                )?;
                if panel_contains_active_source_records(&journal.panel_path)? {
                    return Err(format!(
                        "Panel '{}/{}' gained an installed Button while deletion was in progress. Its folder was preserved.",
                        journal.program_name, journal.panel_name
                    ));
                }
                recycle_panel(&journal.panel_path)?;
                if journal.panel_path.exists() {
                    return Err(format!(
                        "Panel deletion recycler returned successfully, but {} still exists.",
                        journal.panel_path.display()
                    ));
                }
            }
            cleanup_delete_transaction_root(root, PANEL_DELETION_TRANSACTION_FILE_NAME)
        }
        CanonicalDeleteBoundary::OwnersRemain => Err(format!(
            "Canonical owners for '{}/{}' still remain; refusing to finalize panel deletion.",
            journal.program_name, journal.panel_name
        )),
        CanonicalDeleteBoundary::PartialOrConflicting => Err(format!(
            "Canonical owners for '{}/{}' are partial or changed. The durable panel deletion journal was retained.",
            journal.program_name, journal.panel_name
        )),
    }
}

fn finalize_panel_deletion_transaction(
    root: &Path,
    canonical_document: Option<&Value>,
) -> Result<(), String> {
    finalize_panel_deletion_transaction_with(
        root,
        canonical_document,
        validate_panel_deletion_live_resolution,
        recycle_directory_path,
    )
}

fn prepare_panel_deletion_transaction(
    program_name: String,
    panel_name: String,
    panels_root: PathBuf,
    panel_path: PathBuf,
    expected_owner_button_ids: Vec<String>,
    canonical_document: Option<&Value>,
    transactions_root: &Path,
) -> Result<String, String> {
    let expected_owner_button_ids = normalize_delete_expected_owner_ids(expected_owner_button_ids)?;
    require_exact_canonical_owner_set(
        canonical_document,
        &program_name,
        Some(&panel_name),
        &expected_owner_button_ids,
    )?;
    ensure_no_pending_delete_transaction(transactions_root)?;
    let transaction_token = next_setup_transaction_token("delete-panel");
    let transaction_root = transactions_root.join(&transaction_token);
    let journal = PanelDeletionTransactionJournal {
        schema_version: DELETE_TRANSACTION_SCHEMA_VERSION,
        transaction_token: transaction_token.clone(),
        program_name,
        panel_name,
        panels_root,
        panel_path,
        expected_owner_button_ids,
    };
    validate_owned_panel_delete_target(&journal, true)?;
    if panel_deletion_marker_path(&journal.panel_path).exists() {
        return Err(format!(
            "Panel '{}' already contains a deletion marker.",
            journal.panel_path.display()
        ));
    }
    write_panel_deletion_journal(&transaction_root, &journal)?;
    if let Err(error) = write_panel_deletion_marker(&journal) {
        let rollback = cleanup_delete_transaction_root(
            &transaction_root,
            PANEL_DELETION_TRANSACTION_FILE_NAME,
        );
        return Err(match rollback {
            Ok(()) => format!("Panel deletion prepare was rolled back: {error}"),
            Err(rollback_error) => format!(
                "Panel deletion marker failed: {error} Recovery was retained at {}: {rollback_error}",
                transaction_root.display()
            ),
        });
    }
    Ok(transaction_token)
}

fn compensate_failed_program_rename_reload<R, L>(
    reload_error: String,
    rollback: R,
    reload_rollback: L,
) -> String
where
    R: FnOnce() -> Result<(), String>,
    L: FnOnce() -> Result<(), String>,
{
    let rollback = rollback();
    let rollback_reload = reload_rollback();
    match (rollback, rollback_reload) {
        (Ok(()), Ok(())) => format!(
            "Program rename backend reload failed and the rename was rolled back: {reload_error}"
        ),
        (Ok(()), Err(rollback_reload_error)) => format!(
            "Program rename backend reload failed and the rename was rolled back: {reload_error} Reloading the restored bindings also failed: {rollback_reload_error}"
        ),
        (Err(rollback_error), Ok(())) => format!(
            "Program rename reached the new native side, but the backend reload failed: {reload_error} Rollback also failed: {rollback_error}. The recovery journal was retained for startup recovery."
        ),
        (Err(rollback_error), Err(rollback_reload_error)) => format!(
            "Program rename reached the new native side, but the backend reload failed: {reload_error} Rollback also failed: {rollback_error}. Reloading the current bindings also failed: {rollback_reload_error}. The recovery journal was retained for startup recovery."
        ),
    }
}

#[cfg(test)]
mod program_rename_tests {
    use super::{compensate_failed_program_rename_reload, prepare_program_rename_bindings};
    use crate::commands::bindings::parse_ini_document;
    use std::path::Path;

    #[test]
    fn rename_bindings_preserves_registration_and_rebases_owned_paths_only() {
        let mut document = parse_ini_document(
            r#"
[Meta]
ProgramTabIds=2|3
ProgramTabNextId=4
SelectedProgramTabId=2

[ProgramTab_2]
Label=Windows
NormalizedName=windows
ScriptFolder=D:\FlowCell\Programs\Windows\Windows Local Scripts
BridgeFolder=D:\FlowCell\Programs\Windows\Bridge
ExePath=C:\Windows\explorer.exe
CustomValue=keep-me

[ProgramTab_3]
Label=Blender
NormalizedName=blender
ScriptFolder=D:\FlowCell\Programs\Blender\Blender Local Scripts

[Binding_1]
ProgramTabId=2
ScriptPath=D:\FlowCell\Programs\Windows\Windows Local Scripts\owner\source\run.ps1

[Binding_2]
ProgramTabId=2
ScriptPath=D:\FlowCell\Programs\Windows2\outside.ps1

[Binding_3]
ProgramTabId=3
ScriptPath=D:\FlowCell\Programs\Windows\unrelated.ps1
"#,
        );

        assert!(prepare_program_rename_bindings(
            &mut document,
            "Windows",
            "Desktop",
            Path::new(r"D:\FlowCell\Programs\Windows"),
            Path::new(r"D:\FlowCell\Programs\Desktop"),
            "Windows Local Scripts",
        )
        .expect("prepare bindings"));

        let program = &document["ProgramTab_2"];
        assert_eq!(program["Label"], "Desktop");
        assert_eq!(program["NormalizedName"], "desktop");
        assert_eq!(
            program["ScriptFolder"],
            r"D:\FlowCell\Programs\Desktop\Windows Local Scripts"
        );
        assert_eq!(
            program["BridgeFolder"],
            r"D:\FlowCell\Programs\Desktop\Bridge"
        );
        assert_eq!(program["ExePath"], r"C:\Windows\explorer.exe");
        assert_eq!(program["CustomValue"], "keep-me");
        assert_eq!(
            document["Binding_1"]["ScriptPath"],
            r"D:\FlowCell\Programs\Desktop\Windows Local Scripts\owner\source\run.ps1"
        );
        assert_eq!(
            document["Binding_2"]["ScriptPath"],
            r"D:\FlowCell\Programs\Windows2\outside.ps1"
        );
        assert_eq!(
            document["Binding_3"]["ScriptPath"],
            r"D:\FlowCell\Programs\Windows\unrelated.ps1"
        );
    }

    #[test]
    fn failed_rename_reload_rolls_native_state_back_and_reports_restore_reload_failure() {
        let mut rollback_called = false;
        let mut restored_reload_called = false;
        let error = compensate_failed_program_rename_reload(
            "new-side reload".to_string(),
            || {
                rollback_called = true;
                Ok(())
            },
            || {
                restored_reload_called = true;
                Err("old-side reload".to_string())
            },
        );
        assert!(rollback_called);
        assert!(restored_reload_called);
        assert!(error.contains("new-side reload"));
        assert!(error.contains("old-side reload"));
        assert!(error.contains("rolled back"));

        let mut reload_after_failed_rollback = false;
        let error = compensate_failed_program_rename_reload(
            "new-side reload".to_string(),
            || Err("rollback cleanup".to_string()),
            || {
                reload_after_failed_rollback = true;
                Ok(())
            },
        );
        assert!(reload_after_failed_rollback);
        assert!(error.contains("rollback cleanup"));
        assert!(error.contains("retained"));
    }
}

pub(crate) fn resolve_program_directory(program_name: &str) -> Result<PathBuf, String> {
    let normalized_name = validate_folder_name(program_name, "Program")?;
    let programs_root = resolve_programs_root()?;
    find_named_child_directory(&programs_root, &normalized_name)?.ok_or_else(|| {
        format!(
            "Program folder '{}' was not found in {}.",
            normalized_name,
            programs_root.display()
        )
    })
}

fn manifest_folder_path(
    program_directory: &Path,
    value: &str,
    field: &str,
) -> Result<PathBuf, String> {
    program_sources::manifest::resolve_manifest_folder(program_directory, value, field)
}

fn resolve_panels_root(
    program_name: &str,
    create_if_missing: bool,
) -> Result<Option<PathBuf>, String> {
    let program_directory = resolve_program_directory(program_name)?;
    let manifest = program_sources::manifest::load_program_manifest(program_name)?;
    let panels_root =
        manifest_folder_path(&program_directory, &manifest.panels_folder, "panelsFolder")?;

    if panels_root.is_dir() {
        return Ok(Some(panels_root));
    }

    if !create_if_missing {
        return Ok(None);
    }

    fs::create_dir_all(&panels_root)
        .map_err(|error| format!("Failed to create {}: {error}", panels_root.display()))?;
    Ok(Some(panels_root))
}

pub(crate) fn resolve_panel_directory(
    program_name: &str,
    panel_name: &str,
) -> Result<PathBuf, String> {
    let normalized_panel_name = validate_folder_name(panel_name, "Panel")?;
    let panels_root = resolve_panels_root(program_name, false)?.ok_or_else(|| {
        format!(
            "Panels folder for '{}' could not be resolved.",
            program_name
        )
    })?;

    find_named_child_directory(&panels_root, &normalized_panel_name)?.ok_or_else(|| {
        format!(
            "Panel folder '{}' was not found in {}.",
            normalized_panel_name,
            panels_root.display()
        )
    })
}

pub(crate) fn infer_program_template_key(
    program_name: &str,
    exe_path: Option<&str>,
) -> &'static str {
    let normalized_program_name = program_name.trim().to_ascii_lowercase();
    let exe_name = exe_path
        .and_then(|value| {
            Path::new(value.trim())
                .file_name()
                .and_then(|name| name.to_str())
        })
        .unwrap_or("")
        .to_ascii_lowercase();

    if normalized_program_name.contains("blender") || exe_name.contains("blender") {
        return "blender";
    }
    if normalized_program_name.contains("illustrator") || exe_name.contains("illustrator") {
        return "illustrator";
    }
    if normalized_program_name.contains("photoshop") || exe_name.contains("photoshop") {
        return "photoshop";
    }
    if normalized_program_name.contains("windows") || exe_name.contains("explorer") {
        return "windows";
    }

    "generic"
}

pub(crate) fn validate_panel_script_file_name(raw_name: &str) -> Result<String, String> {
    let trimmed_name = raw_name.trim();
    if trimmed_name.is_empty() {
        return Err("Script file name cannot be empty.".to_string());
    }

    let path = Path::new(trimmed_name);
    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return Err("Script file name is not valid.".to_string());
    };

    if file_name != trimmed_name {
        return Err("Script file name must not include folder separators.".to_string());
    }

    Ok(file_name.to_string())
}

pub(crate) fn format_panel_script_label(file_name: &str) -> String {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name)
        .trim();
    if stem.is_empty() {
        return file_name.to_string();
    }

    let mut label = stem.to_string();
    let lower_label = label.to_ascii_lowercase();
    for prefix in ["file_", "util_", "org_"] {
        if lower_label.starts_with(prefix) && label.len() > prefix.len() {
            label = label[prefix.len()..].to_string();
            break;
        }
    }

    let normalized = label.replace('_', " ").replace('-', " ").trim().to_string();
    if normalized.is_empty() {
        file_name.to_string()
    } else {
        normalized
    }
}

fn strip_case_insensitive_prefix<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    if value.len() < prefix.len() {
        return None;
    }

    let candidate = value.get(..prefix.len())?;
    if candidate.eq_ignore_ascii_case(prefix) {
        Some(&value[prefix.len()..])
    } else {
        None
    }
}

fn parse_description_comment(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    let rest = if let Some(rest) = trimmed.strip_prefix('#') {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("//") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix(';') {
        rest
    } else if let Some(rest) = trimmed.strip_prefix('\'') {
        rest
    } else if let Some(rest) = strip_case_insensitive_prefix(trimmed, "REM") {
        let Some(first_character) = rest.chars().next() else {
            return None;
        };
        if !first_character.is_whitespace() {
            return None;
        }
        rest
    } else {
        return None;
    };

    let rest = rest.trim_start();
    let rest = strip_case_insensitive_prefix(rest, "Description")?;
    let rest = rest.trim_start();
    let rest = rest.strip_prefix(':')?;
    Some(rest.trim().to_string())
}

fn is_supported_header_comment(line: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed.starts_with('#')
        || trimmed.starts_with("//")
        || trimmed.starts_with(';')
        || trimmed.starts_with('\'')
        || strip_case_insensitive_prefix(trimmed, "REM")
            .and_then(|rest| rest.chars().next())
            .map(|character| character.is_whitespace())
            .unwrap_or(false)
}

pub(crate) fn read_top_description(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;

    for (index, line) in content.lines().enumerate() {
        if index == 0 && line.starts_with("#!") {
            continue;
        }

        if let Some(description) = parse_description_comment(line) {
            return Some(description);
        }

        let trimmed = line.trim();
        if trimmed.is_empty() || is_supported_header_comment(line) {
            continue;
        }

        break;
    }

    None
}

#[tauri::command]
pub(crate) fn list_program_folders() -> Result<Vec<String>, String> {
    let programs_root = resolve_programs_root()?;
    let available_folder_names = list_child_directory_names(&programs_root)?;
    let (_, document, _) = read_bindings_file_state()?;
    Ok(registered_program_folder_names(
        &available_folder_names,
        &document,
    ))
}

fn suggested_program_executable(manifest: &program_sources::manifest::ProgramManifest) -> String {
    let declared = manifest.exe_path.trim().trim_matches('"');
    if declared.is_empty() {
        return String::new();
    }
    let declared_path = PathBuf::from(declared);
    if declared_path.is_file() {
        return declared_path.to_string_lossy().to_string();
    }
    let output = Command::new("where.exe").arg(declared).output();
    output
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty() && Path::new(line).is_file())
                .map(str::to_string)
        })
        .unwrap_or_default()
}

fn inventory_panels(
    manifest: &program_sources::manifest::ProgramManifest,
) -> Vec<ProgramSetupPanel> {
    let mut panels = if manifest.panels.is_empty() {
        manifest
            .default_panels
            .iter()
            .map(|label| ProgramSetupPanel {
                id: format!("{}.{}", manifest.program_id, stable_program_id(label)),
                label: label.clone(),
                default_selected: true,
            })
            .collect::<Vec<_>>()
    } else {
        manifest
            .panels
            .iter()
            .map(|panel| ProgramSetupPanel {
                id: panel.id.clone(),
                label: panel.label.clone(),
                default_selected: panel.default_selected,
            })
            .collect::<Vec<_>>()
    };
    if manifest.panels.is_empty() {
        for source in &manifest.bundled_sources {
            if panels
                .iter()
                .any(|panel| panel.label.eq_ignore_ascii_case(&source.panel_name))
            {
                continue;
            }
            panels.push(ProgramSetupPanel {
                id: format!(
                    "{}.{}",
                    manifest.program_id,
                    stable_program_id(&source.panel_name)
                ),
                label: source.panel_name.clone(),
                default_selected: source.install_on_add,
            });
        }
    }
    panels.sort_by_cached_key(|panel| panel.label.to_ascii_lowercase());
    panels
}

fn add_program_source_is_required(
    source: &program_sources::manifest::BundledSourceManifest,
) -> bool {
    source.required
}

fn validate_available_program_package(
    program_name: &str,
) -> Result<AvailableProgramPackage, String> {
    let program_root = resolve_program_directory(program_name)?;
    program_sources::installed_page::reject_selected_source_reparse_point(&program_root)?;
    let manifest = program_sources::manifest::load_program_manifest(program_name)?;
    let git_root = program_sources::manifest::resolve_manifest_folder(
        &program_root,
        &manifest.git_scripts_folder,
        "gitScriptsFolder",
    )?;
    if !git_root.is_dir() {
        return Err(format!(
            "Program package '{}' is missing its declared Git Scripts catalog at {}.",
            manifest.label,
            git_root.display()
        ));
    }
    let support_root = program_sources::manifest::resolve_manifest_folder(
        &program_root,
        &manifest.support_scripts_folder,
        "supportScriptsFolder",
    )?;
    if !support_root.is_dir() {
        return Err(format!(
            "Program package '{}' is missing required support content at {}.",
            manifest.label,
            support_root.display()
        ));
    }
    let mut support_content = vec![manifest.support_scripts_folder.clone()];
    for (value, field) in [
        (&manifest.runner.install_script, "runner.installScript"),
        (&manifest.runner.delete_script, "runner.deleteScript"),
        (
            &manifest.runner.capability_script,
            "runner.capabilityScript",
        ),
    ] {
        let Some(path) = program_sources::manifest::resolve_runner_script_path(
            &program_root,
            &manifest,
            value,
            field,
        )?
        else {
            continue;
        };
        if !path.is_file() {
            return Err(format!(
                "Program package '{}' is missing declared support file {}.",
                manifest.label,
                path.display()
            ));
        }
        support_content.push(
            path.strip_prefix(&program_root)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string(),
        );
    }

    let mut sources = Vec::new();
    for source in &manifest.bundled_sources {
        let source_path = program_sources::manifest::resolve_relative_manifest_path(
            &program_root,
            &source.source_path,
            "bundledSources.sourcePath",
            false,
        )?
        .ok_or_else(|| "bundledSources.sourcePath cannot be empty.".to_string())?;
        let preflight = program_sources::install::preflight_button_source(
            &manifest.label,
            &source_path,
            &source.import_kind,
        )?;
        if !source.source_kind.is_empty() && source.source_kind != preflight.source_kind {
            return Err(format!(
                "Bundled source '{}' declares sourceKind '{}' but validates as '{}'.",
                source.id, source.source_kind, preflight.source_kind
            ));
        }
        sources.push(ProgramSetupSource {
            id: source.id.clone(),
            label: if source.display_label.is_empty() {
                preflight.label
            } else {
                source.display_label.clone()
            },
            tooltip: preflight.tooltip,
            version: source.version.clone(),
            panel_name: source.panel_name.clone(),
            source_kind: preflight.source_kind,
            required: add_program_source_is_required(source),
            default_selected: source.install_on_add,
            dependencies: source.dependencies.clone(),
            install_effects: source.install_effects.clone(),
        });
    }
    sources.sort_by_cached_key(|source| source.label.to_ascii_lowercase());
    let mut install_effects = vec![
        format!(
            "Register {} and its host executable in FlowCell.",
            manifest.label
        ),
        "Persist the explicitly enabled Button contribution set in local registration state."
            .to_string(),
    ];
    if !manifest.runner.install_script.is_empty() {
        install_effects.push(format!(
            "Run the declared {} deployment adapter.",
            manifest.runner.install_script
        ));
    }
    if !manifest.addon_reload_notes.trim().is_empty() {
        install_effects.push(manifest.addon_reload_notes.clone());
    }
    if !manifest.app_restart_notes.trim().is_empty() {
        install_effects.push(manifest.app_restart_notes.clone());
    }
    Ok(AvailableProgramPackage {
        program_id: manifest.program_id.clone(),
        program_name: manifest.label.clone(),
        program_type: manifest.program_type.clone(),
        suggested_executable: suggested_program_executable(&manifest),
        panels: inventory_panels(&manifest),
        sources,
        support_content,
        required_versions: std::iter::once("Program manifest schema 1".to_string())
            .chain(
                manifest
                    .bundled_sources
                    .iter()
                    .map(|source| format!("{} @ {}", source.id, source.version)),
            )
            .collect(),
        install_effects,
        addon_reload_notes: manifest.addon_reload_notes,
        app_restart_notes: manifest.app_restart_notes,
    })
}

#[tauri::command]
pub(crate) fn list_available_program_packages() -> Result<AvailableProgramPackagesResponse, String>
{
    let programs_root = resolve_programs_root()?;
    let available = list_child_directory_names(&programs_root)?;
    let (_, bindings, _) = read_bindings_file_state()?;
    let mut packages = Vec::new();
    let mut rejected_packages = Vec::new();
    for folder_name in available {
        if find_registered_program(&bindings, &folder_name).is_some() {
            continue;
        }
        match validate_available_program_package(&folder_name) {
            Ok(package) => packages.push(package),
            Err(error) => rejected_packages.push(RejectedProgramPackage { folder_name, error }),
        }
    }
    packages.sort_by_cached_key(|package| package.program_name.to_ascii_lowercase());
    rejected_packages.sort_by_cached_key(|package| package.folder_name.to_ascii_lowercase());
    Ok(AvailableProgramPackagesResponse {
        packages,
        rejected_packages,
    })
}

fn preflight_add_program_plan_inner(
    request: &AddProgramPlanRequest,
) -> Result<AddProgramPreflight, String> {
    let requested_program = validate_folder_name(&request.program_name, "Program")?;
    let (_, bindings, _) = read_bindings_file_state()?;
    if find_registered_program(&bindings, &requested_program).is_some() {
        return Err(format!(
            "Program '{}' is already registered in FlowCell.",
            requested_program
        ));
    }
    let package = validate_available_program_package(&requested_program)?;
    let executable =
        resolve_program_executable(&package.program_name, request.executable_path.trim())?;
    let mut selected_panels = Vec::new();
    for requested in &request.selected_panels {
        let requested = validate_folder_name(requested, "Panel")?;
        let declared = package
            .panels
            .iter()
            .find(|panel| panel.label.eq_ignore_ascii_case(&requested))
            .ok_or_else(|| {
                format!(
                    "Panel '{}' is not declared by Program package '{}'.",
                    requested, package.program_name
                )
            })?;
        if selected_panels
            .iter()
            .any(|panel: &String| panel.eq_ignore_ascii_case(&declared.label))
        {
            return Err(format!(
                "Panel '{}' is selected more than once.",
                declared.label
            ));
        }
        selected_panels.push(declared.label.clone());
    }
    let mut source_destinations = BTreeMap::new();
    for selection in &request.selected_sources {
        let source_id =
            program_sources::manifest::validate_bundled_source_id(&selection.source_id)?;
        let declared = package
            .sources
            .iter()
            .find(|source| source.id.eq_ignore_ascii_case(&source_id))
            .ok_or_else(|| {
                format!(
                    "Button contribution '{}' is not declared by Program package '{}'.",
                    source_id, package.program_name
                )
            })?;
        let destination = validate_folder_name(&selection.destination_panel, "Destination panel")?;
        let destination = selected_panels
            .iter()
            .find(|panel| panel.eq_ignore_ascii_case(&destination))
            .cloned()
            .ok_or_else(|| {
                format!(
                    "Button contribution '{}' targets panel '{}', but that panel is not selected.",
                    declared.id, destination
                )
            })?;
        if source_destinations
            .insert(declared.id.to_ascii_lowercase(), destination)
            .is_some()
        {
            return Err(format!(
                "Button contribution '{}' is selected more than once.",
                declared.id
            ));
        }
    }
    for source in &package.sources {
        if !source_destinations.contains_key(&source.id.to_ascii_lowercase()) {
            continue;
        }
        for dependency in &source.dependencies {
            if !source_destinations.contains_key(&dependency.to_ascii_lowercase()) {
                return Err(format!(
                    "Button contribution '{}' requires selected dependency '{}'.",
                    source.id, dependency
                ));
            }
        }
    }
    let selected_sources = package
        .sources
        .iter()
        .filter_map(|source| {
            source_destinations
                .get(&source.id.to_ascii_lowercase())
                .map(|panel| {
                    let mut source = source.clone();
                    source.panel_name = panel.clone();
                    source
                })
        })
        .collect::<Vec<_>>();
    let mut install_effects = package.install_effects.clone();
    for source in &selected_sources {
        install_effects.extend(source.install_effects.clone());
    }
    install_effects.sort();
    install_effects.dedup();
    Ok(AddProgramPreflight {
        program_id: package.program_id,
        program_name: package.program_name,
        executable_path: executable.to_string_lossy().to_string(),
        panels: selected_panels,
        sources: selected_sources,
        install_effects,
    })
}

#[tauri::command]
pub(crate) fn preflight_add_program_plan(
    request: AddProgramPlanRequest,
) -> Result<AddProgramPreflight, String> {
    preflight_add_program_plan_inner(&request)
}

const ADD_PROGRAM_TRANSACTION_SCHEMA_VERSION: u32 = 1;
const ADD_PROGRAM_TRANSACTION_FILE_NAME: &str = "add-program-transaction.json";
static ADD_PROGRAM_TRANSACTION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum AddProgramTransactionPhase {
    Prepared,
    NativeApplied,
    AwaitingCanonical,
    Committed,
    RolledBack,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlannedProgramSourceOwner {
    owner_button_id: String,
    panel_name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AddProgramTransactionJournal {
    schema_version: u32,
    phase: AddProgramTransactionPhase,
    request: AddProgramPlanRequest,
    preflight: AddProgramPreflight,
    bindings_path: PathBuf,
    bindings_before: String,
    bindings_after_registration: String,
    enabled_state_path: PathBuf,
    enabled_state_before: Option<String>,
    enabled_state_after: String,
    created_directories: Vec<PathBuf>,
    planned_sources: Vec<PlannedProgramSourceOwner>,
    #[serde(default)]
    expected_button_ids: Vec<String>,
}

fn add_program_transactions_root() -> Result<PathBuf, String> {
    Ok(crate::resolve_flowcell_local_root()?.join("program-setup-transactions"))
}

fn next_setup_transaction_token(prefix: &str) -> String {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{prefix}-{}-{stamp}", std::process::id())
}

fn add_program_transaction_path(root: &Path) -> PathBuf {
    root.join(ADD_PROGRAM_TRANSACTION_FILE_NAME)
}

fn write_add_program_journal(
    root: &Path,
    journal: &AddProgramTransactionJournal,
    mode: program_sources::transaction::AtomicWriteMode,
) -> Result<(), String> {
    let body = serde_json::to_vec_pretty(journal)
        .map_err(|error| format!("Failed to serialize Add Program transaction: {error}"))?;
    program_sources::transaction::write_json_file(&add_program_transaction_path(root), &body, mode)
}

fn read_add_program_journal(root: &Path) -> Result<AddProgramTransactionJournal, String> {
    let path = add_program_transaction_path(root);
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let journal = serde_json::from_str::<AddProgramTransactionJournal>(&raw).map_err(|error| {
        format!(
            "Add Program transaction {} is invalid: {error}",
            path.display()
        )
    })?;
    if journal.schema_version != ADD_PROGRAM_TRANSACTION_SCHEMA_VERSION {
        return Err(format!(
            "Add Program transaction {} has unsupported schemaVersion {}.",
            path.display(),
            journal.schema_version
        ));
    }
    Ok(journal)
}

fn serialize_bindings(document: &IniDocument) -> String {
    serialize_ini_document(document)
}

fn enabled_state_for_plan(
    manifest: &program_sources::manifest::ProgramManifest,
    preflight: &AddProgramPreflight,
) -> program_sources::manifest::EnabledProgramContributions {
    program_sources::manifest::EnabledProgramContributions {
        schema_version: 1,
        program_id: manifest.program_id.clone(),
        program_name: manifest.label.clone(),
        enabled_sources: preflight
            .sources
            .iter()
            .map(
                |source| program_sources::manifest::EnabledProgramContribution {
                    source_id: source.id.clone(),
                    panel_name: source.panel_name.clone(),
                    version: source.version.clone(),
                },
            )
            .collect(),
    }
}

fn recover_planned_active_record_path(
    panel_path: &Path,
    owner_button_id: &str,
) -> Result<Option<PathBuf>, String> {
    let record_path = panel_path.join(program_sources::records::active_record_file_name(
        owner_button_id,
    ));
    program_sources::records::recover_active_record(&record_path)?;
    Ok(record_path.is_file().then_some(record_path))
}

fn active_source_for_planned_owner(
    program_name: &str,
    source: &PlannedProgramSourceOwner,
) -> Result<Option<program_sources::execute::ActiveSourceResolution>, String> {
    let program_root = resolve_program_directory(program_name)?;
    let manifest = program_sources::manifest::load_program_manifest(program_name)?;
    let panels_root = program_sources::manifest::resolve_manifest_folder(
        &program_root,
        &manifest.panels_folder,
        "panelsFolder",
    )?;
    let Some(panel_path) = panel_child_entry(&panels_root, &source.panel_name)? else {
        return Ok(None);
    };
    let Some(record_path) =
        recover_planned_active_record_path(&panel_path, &source.owner_button_id)?
    else {
        return Ok(None);
    };
    let record_file_name = record_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Planned active source record name is not valid UTF-8.".to_string())?;
    program_sources::execute::resolve_active_source_record(
        program_name,
        &source.panel_name,
        record_file_name,
    )
}

fn install_add_program_sources_while_source_locked(
    preflight: &AddProgramPreflight,
    planned_sources: &[PlannedProgramSourceOwner],
    manifest: &program_sources::manifest::ProgramManifest,
    program_root: &Path,
    source_guard: &std::sync::MutexGuard<'static, ()>,
) -> Result<Vec<program_sources::install::InstallButtonSourceResponse>, String> {
    if preflight.sources.len() != planned_sources.len() {
        return Err(
            "Add Program planned source ownership changed before native apply.".to_string(),
        );
    }
    let mut descriptors = Vec::with_capacity(preflight.sources.len());
    for (source, planned) in preflight.sources.iter().zip(planned_sources) {
        let declared = manifest
            .bundled_sources
            .iter()
            .find(|declared| declared.id.eq_ignore_ascii_case(&source.id))
            .ok_or_else(|| format!("Selected source '{}' is no longer declared.", source.id))?;
        let source_path = program_sources::manifest::resolve_relative_manifest_path(
            program_root,
            &declared.source_path,
            "bundledSources.sourcePath",
            false,
        )?
        .ok_or_else(|| "bundledSources.sourcePath cannot be empty.".to_string())?;
        descriptors.push(
            program_sources::install::install_from_path_while_source_locked(
                program_sources::install::InstallButtonSourceRequest {
                    owner_button_id: planned.owner_button_id.clone(),
                    program_name: preflight.program_name.clone(),
                    panel_name: source.panel_name.clone(),
                    source_path: source_path.to_string_lossy().to_string(),
                    import_kind: declared.import_kind.clone(),
                    bundled_source_id: Some(declared.id.clone()),
                    bundled_source_version: Some(declared.version.clone()),
                },
                false,
                source_guard,
            )?,
        );
    }
    Ok(descriptors)
}

fn mark_add_program_native_applied(
    root: &Path,
    journal: &mut AddProgramTransactionJournal,
) -> Result<(), String> {
    if journal.phase != AddProgramTransactionPhase::Prepared {
        return Err("Add Program transaction is not at its prepared native boundary.".to_string());
    }
    journal.phase = AddProgramTransactionPhase::NativeApplied;
    write_add_program_journal(
        root,
        journal,
        program_sources::transaction::AtomicWriteMode::Replace,
    )
}

fn rollback_add_program_transaction(
    app: &tauri::AppHandle,
    root: &Path,
    journal: &mut AddProgramTransactionJournal,
) -> Result<(), String> {
    let mut errors = Vec::new();
    for source in journal.planned_sources.iter().rev() {
        match active_source_for_planned_owner(&journal.preflight.program_name, source) {
            Ok(Some(resolution)) => {
                let request = program_sources::delete::UninstallButtonSourceRequest {
                    owner_button_id: source.owner_button_id.clone(),
                    program_name: journal.preflight.program_name.clone(),
                    panel_name: source.panel_name.clone(),
                    file_name: resolution.file_name,
                };
                if let Err(error) =
                    program_sources::delete::uninstall_button_source(app.clone(), request)
                {
                    errors.push(format!(
                        "Button source '{}' rollback failed: {error}",
                        source.owner_button_id
                    ));
                }
            }
            Ok(None) => {}
            Err(error) => errors.push(error),
        }
    }
    if errors.is_empty() {
        match read_bindings_file_state() {
            Ok((_, current, path)) => {
                let current = serialize_bindings(&current);
                if path != journal.bindings_path {
                    errors.push("Bindings path changed during Add Program rollback.".to_string());
                } else if current == journal.bindings_before {
                    // Registration never reached the durable apply boundary, or an earlier
                    // recovery pass already restored it.
                } else if current != journal.bindings_after_registration {
                    errors.push(
                        "FlowCell bindings changed after Add Program began; registration rollback was preserved for manual recovery."
                            .to_string(),
                    );
                } else {
                    let before = parse_ini_document(&journal.bindings_before);
                    if let Err(error) = write_bindings_file_state(&path, &before) {
                        errors.push(error);
                    }
                }
            }
            Err(error) => errors.push(error),
        }
    }
    if errors.is_empty() {
        let current = fs::read_to_string(&journal.enabled_state_path).ok();
        let already_before = match (&current, &journal.enabled_state_before) {
            (None, None) => true,
            (Some(current), Some(before)) => current.trim() == before.trim(),
            _ => false,
        };
        let expected_after = serde_json::from_str::<
            program_sources::manifest::EnabledProgramContributions,
        >(&journal.enabled_state_after)
        .map_err(|error| format!("Stored Add Program enabled state is invalid: {error}"))?;
        let is_expected_subset = current
            .as_deref()
            .and_then(|raw| {
                serde_json::from_str::<program_sources::manifest::EnabledProgramContributions>(raw)
                    .ok()
            })
            .map(|state| {
                state.schema_version == expected_after.schema_version
                    && state
                        .program_id
                        .eq_ignore_ascii_case(&expected_after.program_id)
                    && state
                        .program_name
                        .eq_ignore_ascii_case(&expected_after.program_name)
                    && state.enabled_sources.iter().all(|current| {
                        expected_after.enabled_sources.iter().any(|expected| {
                            current.source_id.eq_ignore_ascii_case(&expected.source_id)
                                && current
                                    .panel_name
                                    .eq_ignore_ascii_case(&expected.panel_name)
                                && current.version == expected.version
                        })
                    })
            })
            .unwrap_or(false);
        if already_before {
            // The mutation never reached the state write, or recovery already restored it.
        } else if !is_expected_subset {
            errors.push(
                "Enabled contribution state changed during Add Program rollback.".to_string(),
            );
        } else if let Some(before) = journal.enabled_state_before.as_ref() {
            if let Err(error) = program_sources::transaction::write_json_file(
                &journal.enabled_state_path,
                before.as_bytes(),
                program_sources::transaction::AtomicWriteMode::Replace,
            ) {
                errors.push(error);
            }
        } else if let Err(error) = recycle_file_path(&journal.enabled_state_path) {
            errors.push(error);
        }
    }
    if errors.is_empty() {
        for directory in journal.created_directories.iter().rev() {
            if directory.exists() {
                if let Err(error) = recycle_directory_path(directory) {
                    errors.push(error);
                    break;
                }
            }
        }
    }
    if !errors.is_empty() {
        return Err(errors.join(" | "));
    }
    journal.phase = AddProgramTransactionPhase::RolledBack;
    write_add_program_journal(
        root,
        journal,
        program_sources::transaction::AtomicWriteMode::Replace,
    )?;
    let _ = restart_flowcell_headless_backend();
    fs::remove_dir_all(root).map_err(|error| {
        format!(
            "Add Program rollback completed, but temporary transaction cleanup failed at {}: {error}",
            root.display()
        )
    })
}

fn finalize_add_program_transaction(
    root: &Path,
    journal: &mut AddProgramTransactionJournal,
) -> Result<(), String> {
    let manifest =
        program_sources::manifest::load_program_manifest(&journal.preflight.program_name)?;
    if manifest.runner.kind == "blender-bridge" {
        bootstrap_blender_program(
            &journal.preflight.program_name,
            Some(&journal.preflight.executable_path),
        )?;
    }
    restart_flowcell_headless_backend()?;
    journal.phase = AddProgramTransactionPhase::Committed;
    write_add_program_journal(
        root,
        journal,
        program_sources::transaction::AtomicWriteMode::Replace,
    )?;
    fs::remove_dir_all(root).map_err(|error| {
        format!(
            "Add Program committed, but temporary transaction cleanup failed at {}: {error}",
            root.display()
        )
    })
}

#[tauri::command]
pub(crate) fn apply_add_program_plan(
    app: tauri::AppHandle,
    request: AddProgramPlanRequest,
) -> Result<AppliedProgramSetup, String> {
    let lock = ADD_PROGRAM_TRANSACTION_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Add Program transaction lock was poisoned.".to_string())?;
    let source_guard = program_sources::source_quarantine_guard()?;
    let bindings_guard = super::bindings::bindings_state_guard()?;
    let preflight = preflight_add_program_plan_inner(&request)?;
    let program_root = resolve_program_directory(&preflight.program_name)?;
    let manifest = program_sources::manifest::load_program_manifest(&preflight.program_name)?;
    let (_, bindings_before_document, bindings_path) = read_bindings_file_state()?;
    let bindings_before = serialize_bindings(&bindings_before_document);
    let mut bindings_after_document = bindings_before_document.clone();
    let program_id = upsert_program_registration(
        &mut bindings_after_document,
        &preflight.program_name,
        &program_root,
        &preflight.executable_path,
    );
    apply_manifest_registration(
        &mut bindings_after_document,
        program_id,
        &program_root,
        &manifest,
        &preflight.executable_path,
    )?;
    let bindings_after_registration = serialize_bindings(&bindings_after_document);
    let enabled_state_path =
        program_sources::manifest::enabled_program_contributions_path(&manifest)?;
    let enabled_state_before = fs::read_to_string(&enabled_state_path).ok();
    let mut enabled_state = enabled_state_for_plan(&manifest, &preflight);
    program_sources::manifest::validate_enabled_program_contributions(
        &mut enabled_state,
        &manifest,
    )?;
    let enabled_state_after = serde_json::to_string_pretty(&enabled_state)
        .map_err(|error| format!("Failed to serialize enabled contribution state: {error}"))?;
    let panels_root = program_sources::manifest::resolve_manifest_folder(
        &program_root,
        &manifest.panels_folder,
        "panelsFolder",
    )?;
    let local_scripts_root = program_sources::manifest::resolve_manifest_folder(
        &program_root,
        &manifest.local_scripts_folder,
        "localScriptsFolder",
    )?;
    let mut created_directories = Vec::new();
    for directory in [&panels_root, &local_scripts_root] {
        if !directory.exists() {
            created_directories.push(directory.clone());
        }
    }
    for panel in &preflight.panels {
        if !panels_root.is_dir() || find_named_child_directory(&panels_root, panel)?.is_none() {
            created_directories.push(panels_root.join(panel));
        }
    }
    let planned_sources = preflight
        .sources
        .iter()
        .map(|source| PlannedProgramSourceOwner {
            owner_button_id: program_sources::synchronize::deterministic_bundled_owner_id(
                &manifest.program_id,
                &source.id,
            ),
            panel_name: source.panel_name.clone(),
        })
        .collect::<Vec<_>>();
    let transaction_token = next_setup_transaction_token("add-program");
    let transaction_root = add_program_transactions_root()?.join(&transaction_token);
    let mut journal = AddProgramTransactionJournal {
        schema_version: ADD_PROGRAM_TRANSACTION_SCHEMA_VERSION,
        phase: AddProgramTransactionPhase::Prepared,
        request,
        preflight: preflight.clone(),
        bindings_path: bindings_path.clone(),
        bindings_before,
        bindings_after_registration,
        enabled_state_path,
        enabled_state_before,
        enabled_state_after,
        created_directories,
        planned_sources,
        expected_button_ids: Vec::new(),
    };
    write_add_program_journal(
        &transaction_root,
        &journal,
        program_sources::transaction::AtomicWriteMode::Create,
    )?;

    let apply_result = (|| {
        fs::create_dir_all(&panels_root)
            .map_err(|error| format!("Failed to create {}: {error}", panels_root.display()))?;
        fs::create_dir_all(&local_scripts_root).map_err(|error| {
            format!("Failed to create {}: {error}", local_scripts_root.display())
        })?;
        for panel in &preflight.panels {
            if find_named_child_directory(&panels_root, panel)?.is_none() {
                fs::create_dir(panels_root.join(panel)).map_err(|error| {
                    format!("Failed to create selected panel '{}': {error}", panel)
                })?;
            }
        }
        write_bindings_file_state(&bindings_path, &bindings_after_document)?;
        program_sources::manifest::write_enabled_program_contributions(
            &manifest,
            enabled_state.clone(),
        )?;
        install_add_program_sources_while_source_locked(
            &preflight,
            &journal.planned_sources,
            &manifest,
            &program_root,
            &source_guard,
        )
    })();
    drop(bindings_guard);
    drop(source_guard);
    match apply_result {
        Ok(descriptors) => {
            mark_add_program_native_applied(&transaction_root, &mut journal)?;
            Ok(AppliedProgramSetup {
                transaction_token,
                program_name: preflight.program_name,
                panels: preflight.panels,
                descriptors,
                install_effects: preflight.install_effects,
            })
        }
        Err(error) => {
            let rollback = rollback_add_program_transaction(&app, &transaction_root, &mut journal);
            Err(match rollback {
                Ok(()) => format!("{error} The complete Add Program plan was rolled back."),
                Err(rollback_error) => format!(
                    "{error} Add Program rollback was retained at {}: {rollback_error}",
                    transaction_root.display()
                ),
            })
        }
    }
}

fn locate_add_program_transaction(token: &str) -> Result<PathBuf, String> {
    let token = validate_folder_name(token, "Add Program transaction token")?;
    if !token.starts_with("add-program-") {
        return Err("Add Program transaction token has the wrong kind.".to_string());
    }
    let root = add_program_transactions_root()?.join(&token);
    if !root.is_dir() {
        return Err(format!("Add Program transaction '{token}' does not exist."));
    }
    Ok(root)
}

fn canonical_button<'a>(document: &'a Value, button_id: &str) -> Option<&'a Value> {
    document
        .get("buttons")?
        .as_object()?
        .iter()
        .find(|(candidate, _)| candidate.eq_ignore_ascii_case(button_id))
        .map(|(_, button)| button)
}

fn normalize_canonical_source_part(value: &str) -> String {
    let mut normalized = String::new();
    let mut previous_separator = false;
    for character in value.trim().chars() {
        let character = if character == '/' { '\\' } else { character };
        if character == '\\' {
            if previous_separator {
                continue;
            }
            previous_separator = true;
        } else {
            previous_separator = false;
        }
        normalized.extend(character.to_lowercase());
    }
    normalized
}

fn canonical_source_identity_matches(
    button: &Value,
    resolution: &program_sources::execute::ActiveSourceResolution,
) -> bool {
    let Some(identity) = button.get("sourceIdentity").and_then(Value::as_object) else {
        return false;
    };
    let expected = [
        (
            "displayProgramName",
            resolution.record.program_name.as_str(),
        ),
        ("displayPanelName", resolution.record.panel_name.as_str()),
        ("displayFileName", resolution.file_name.as_str()),
    ];
    if expected
        .iter()
        .any(|(field, value)| identity.get(*field).and_then(Value::as_str) != Some(*value))
    {
        return false;
    }
    [
        (
            "normalizedProgramName",
            resolution.record.program_name.as_str(),
        ),
        ("normalizedPanelName", resolution.record.panel_name.as_str()),
        ("normalizedFileName", resolution.file_name.as_str()),
    ]
    .iter()
    .all(|(field, value)| {
        identity
            .get(*field)
            .and_then(Value::as_str)
            .map(normalize_canonical_source_part)
            == Some(normalize_canonical_source_part(value))
    })
}

fn canonical_source_graph_matches(
    document: &Value,
    resolution: &program_sources::execute::ActiveSourceResolution,
) -> bool {
    let owner_id = &resolution.record.owner_button_id;
    let Some(owner) = canonical_button(document, owner_id) else {
        return false;
    };
    if !canonical_source_identity_matches(owner, resolution) {
        return false;
    }
    let buttons = match document.get("buttons").and_then(Value::as_object) {
        Some(buttons) => buttons,
        None => return false,
    };
    let tool_set_units = document
        .get("popoutUnits")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|units| units.values())
        .filter(|unit| {
            unit.get("kind").and_then(Value::as_str) == Some("tool-set")
                && unit
                    .get("ownerButtonId")
                    .and_then(Value::as_str)
                    .map(|value| value.eq_ignore_ascii_case(owner_id))
                    .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    if resolution.record.children.is_empty() {
        return owner.get("role").and_then(Value::as_str) == Some("single-script")
            && tool_set_units.is_empty()
            && !buttons.values().any(|button| {
                button
                    .get("toolSetParentId")
                    .and_then(Value::as_str)
                    .map(|value| value.eq_ignore_ascii_case(owner_id))
                    .unwrap_or(false)
            });
    }
    if owner.get("role").and_then(Value::as_str) != Some("tool-set-owner")
        || !owner
            .get("executionTarget")
            .map(Value::is_null)
            .unwrap_or(false)
        || tool_set_units.len() != 1
    {
        return false;
    }
    let unit = tool_set_units[0];
    let Some(child_ids) = unit.get("childButtonIds").and_then(Value::as_array) else {
        return false;
    };
    let Some(placement_ids) = unit.get("childPlacementIds").and_then(Value::as_array) else {
        return false;
    };
    if child_ids.len() != resolution.record.children.len()
        || placement_ids.len() != resolution.record.children.len()
    {
        return false;
    }
    let Some(surface_id) = unit.get("surfaceId").and_then(Value::as_str) else {
        return false;
    };
    let Some(surface) = document
        .get("surfaces")
        .and_then(Value::as_object)
        .and_then(|surfaces| surfaces.get(surface_id))
    else {
        return false;
    };
    if surface.get("kind").and_then(Value::as_str) != Some("tool-set-popout") {
        return false;
    }
    let Some(surface_placements) = surface.get("placementIds").and_then(Value::as_array) else {
        return false;
    };
    let placement_set = placement_ids
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<BTreeSet<_>>();
    if placement_set.len() != placement_ids.len()
        || surface_placements
            .iter()
            .filter_map(Value::as_str)
            .collect::<BTreeSet<_>>()
            != placement_set
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>()
    {
        return false;
    }
    let expected_slots = resolution
        .record
        .children
        .iter()
        .map(|child| child.slot.as_str())
        .collect::<BTreeSet<_>>();
    let mut actual_slots = BTreeSet::new();
    let placements = match document.get("placements").and_then(Value::as_object) {
        Some(placements) => placements,
        None => return false,
    };
    for child_id in child_ids.iter().filter_map(Value::as_str) {
        let Some(child) = canonical_button(document, child_id) else {
            return false;
        };
        if child.get("role").and_then(Value::as_str) != Some("tool-set-child")
            || !child
                .get("sourceIdentity")
                .map(Value::is_null)
                .unwrap_or(false)
            || !child
                .get("toolSetParentId")
                .and_then(Value::as_str)
                .map(|value| value.eq_ignore_ascii_case(owner_id))
                .unwrap_or(false)
        {
            return false;
        }
        let Some(slot) = child
            .get("metadata")
            .and_then(Value::as_object)
            .and_then(|metadata| metadata.get("toolSetSlot"))
            .and_then(Value::as_str)
        else {
            return false;
        };
        if !actual_slots.insert(slot) {
            return false;
        }
        let matching_placements = placement_ids
            .iter()
            .filter_map(Value::as_str)
            .filter(|placement_id| {
                placements
                    .get(*placement_id)
                    .map(|placement| {
                        placement.get("buttonId").and_then(Value::as_str) == Some(child_id)
                            && placement.get("surfaceId").and_then(Value::as_str)
                                == Some(surface_id)
                    })
                    .unwrap_or(false)
            })
            .count();
        if matching_placements != 1 {
            return false;
        }
    }
    actual_slots == expected_slots
}

fn canonical_matches_add_program(journal: &AddProgramTransactionJournal) -> Result<bool, String> {
    let Some(document) = crate::button_state::load_button_state()? else {
        return Ok(journal.expected_button_ids.is_empty() && journal.preflight.panels.is_empty());
    };
    if journal
        .expected_button_ids
        .iter()
        .any(|button_id| canonical_button(&document, button_id).is_none())
    {
        return Ok(false);
    }
    for source in &journal.planned_sources {
        if !journal
            .expected_button_ids
            .iter()
            .any(|button_id| button_id.eq_ignore_ascii_case(&source.owner_button_id))
            || canonical_button(&document, &source.owner_button_id).is_none()
        {
            return Ok(false);
        }
        let Some(resolution) =
            active_source_for_planned_owner(&journal.preflight.program_name, source)?
        else {
            return Ok(false);
        };
        if !resolution
            .record
            .owner_button_id
            .eq_ignore_ascii_case(&source.owner_button_id)
            || !canonical_source_graph_matches(&document, &resolution)
        {
            return Ok(false);
        }
    }
    for panel_name in &journal.preflight.panels {
        let has_panel_owner = journal.expected_button_ids.iter().any(|button_id| {
            let Some(button) = canonical_button(&document, button_id) else {
                return false;
            };
            button.get("role").and_then(Value::as_str) == Some("panel-owner")
                && button
                    .get("metadata")
                    .and_then(Value::as_object)
                    .and_then(|metadata| metadata.get("programName"))
                    .and_then(Value::as_str)
                    .map(|program| program.eq_ignore_ascii_case(&journal.preflight.program_name))
                    .unwrap_or(false)
                && button
                    .get("metadata")
                    .and_then(Value::as_object)
                    .and_then(|metadata| metadata.get("panelName"))
                    .and_then(Value::as_str)
                    .map(|panel| panel.eq_ignore_ascii_case(panel_name))
                    .unwrap_or(false)
        });
        if !has_panel_owner {
            return Ok(false);
        }
    }
    Ok(true)
}

fn normalize_expected_button_ids(values: Vec<String>) -> Result<Vec<String>, String> {
    let mut normalized = Vec::new();
    for value in values {
        let value = program_sources::records::validate_owner_button_id(&value)?;
        if normalized
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(&value))
        {
            return Err(format!("Expected Button ID '{value}' is duplicated."));
        }
        normalized.push(value);
    }
    Ok(normalized)
}

#[tauri::command]
pub(crate) fn prepare_add_program_canonical_commit(
    transaction_token: String,
    expected_button_ids: Vec<String>,
) -> Result<(), String> {
    let lock = ADD_PROGRAM_TRANSACTION_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Add Program transaction lock was poisoned.".to_string())?;
    let root = locate_add_program_transaction(&transaction_token)?;
    let mut journal = read_add_program_journal(&root)?;
    let expected_button_ids = normalize_expected_button_ids(expected_button_ids)?;
    let required_count = journal.planned_sources.len() + journal.preflight.panels.len();
    if expected_button_ids.len() != required_count {
        return Err(format!(
            "Add Program expected {required_count} canonical owner Buttons, but received {}.",
            expected_button_ids.len()
        ));
    }
    if journal.planned_sources.iter().any(|source| {
        !expected_button_ids
            .iter()
            .any(|button_id| button_id.eq_ignore_ascii_case(&source.owner_button_id))
    }) {
        return Err(
            "Add Program canonical owner set is missing an installed source owner.".to_string(),
        );
    }
    match journal.phase {
        AddProgramTransactionPhase::NativeApplied => {
            journal.expected_button_ids = expected_button_ids;
            journal.phase = AddProgramTransactionPhase::AwaitingCanonical;
            write_add_program_journal(
                &root,
                &journal,
                program_sources::transaction::AtomicWriteMode::Replace,
            )
        }
        AddProgramTransactionPhase::AwaitingCanonical
            if journal.expected_button_ids == expected_button_ids =>
        {
            Ok(())
        }
        _ => Err("Add Program transaction is not ready for a canonical commit.".to_string()),
    }
}

#[tauri::command]
pub(crate) fn finalize_add_program_plan(transaction_token: String) -> Result<(), String> {
    let lock = ADD_PROGRAM_TRANSACTION_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Add Program transaction lock was poisoned.".to_string())?;
    let root = locate_add_program_transaction(&transaction_token)?;
    let mut journal = read_add_program_journal(&root)?;
    if journal.phase != AddProgramTransactionPhase::AwaitingCanonical {
        return Err("Add Program transaction is not awaiting canonical state.".to_string());
    }
    if !canonical_matches_add_program(&journal)? {
        return Err(
            "Canonical Button state does not contain the complete Add Program owner set."
                .to_string(),
        );
    }
    finalize_add_program_transaction(&root, &mut journal)
}

#[tauri::command]
pub(crate) fn rollback_add_program_plan(
    app: tauri::AppHandle,
    transaction_token: String,
) -> Result<String, String> {
    let lock = ADD_PROGRAM_TRANSACTION_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Add Program transaction lock was poisoned.".to_string())?;
    let root = locate_add_program_transaction(&transaction_token)?;
    let mut journal = read_add_program_journal(&root)?;
    if journal.phase == AddProgramTransactionPhase::AwaitingCanonical
        && canonical_matches_add_program(&journal)?
    {
        finalize_add_program_transaction(&root, &mut journal)?;
        return Ok("finalized".to_string());
    }
    if matches!(
        journal.phase,
        AddProgramTransactionPhase::Committed | AddProgramTransactionPhase::RolledBack
    ) {
        return Err("Add Program transaction is already complete.".to_string());
    }
    rollback_add_program_transaction(&app, &root, &mut journal)?;
    Ok("rolled-back".to_string())
}

pub(crate) fn recover_add_program_transactions_on_startup(
    app: &tauri::AppHandle,
) -> Result<usize, String> {
    let lock = ADD_PROGRAM_TRANSACTION_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Add Program transaction lock was poisoned.".to_string())?;
    let transactions_root = add_program_transactions_root()?;
    if !transactions_root.is_dir() {
        return Ok(0);
    }
    let mut roots = fs::read_dir(&transactions_root)
        .map_err(|error| format!("Failed to read {}: {error}", transactions_root.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir() && add_program_transaction_path(path).is_file())
        .collect::<Vec<_>>();
    roots.sort();
    let mut recovered = 0;
    for root in roots {
        let mut journal = read_add_program_journal(&root)?;
        match journal.phase {
            AddProgramTransactionPhase::AwaitingCanonical
                if canonical_matches_add_program(&journal)? =>
            {
                finalize_add_program_transaction(&root, &mut journal)?;
            }
            AddProgramTransactionPhase::Prepared
            | AddProgramTransactionPhase::NativeApplied
            | AddProgramTransactionPhase::AwaitingCanonical => {
                rollback_add_program_transaction(app, &root, &mut journal)?;
            }
            AddProgramTransactionPhase::Committed | AddProgramTransactionPhase::RolledBack => {
                fs::remove_dir_all(&root).map_err(|error| {
                    format!(
                        "Failed to clean temporary Add Program transaction {}: {error}",
                        root.display()
                    )
                })?;
            }
        }
        recovered += 1;
    }
    Ok(recovered)
}

const ADD_PANEL_TRANSACTION_SCHEMA_VERSION: u32 = 1;
const ADD_PANEL_TRANSACTION_FILE_NAME: &str = "add-panel-transaction.json";
const ADD_PANEL_MARKER_FILE_NAME: &str = ".flowcell-add-panel-transaction.json";
static ADD_PANEL_TRANSACTION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum AddPanelTransactionPhase {
    Prepared,
    NativeApplied,
    AwaitingCanonical,
    Committed,
    RolledBack,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AddPanelTransactionJournal {
    schema_version: u32,
    phase: AddPanelTransactionPhase,
    transaction_token: String,
    preflight: AddPanelPreflight,
    panels_root: PathBuf,
    destination_path: PathBuf,
    staging_path: PathBuf,
    panels_root_created: bool,
    panel_preexisted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    expected_button_id: Option<String>,
}

fn add_panel_transaction_path(root: &Path) -> PathBuf {
    root.join(ADD_PANEL_TRANSACTION_FILE_NAME)
}

fn write_add_panel_journal(
    root: &Path,
    journal: &AddPanelTransactionJournal,
    mode: program_sources::transaction::AtomicWriteMode,
) -> Result<(), String> {
    let body = serde_json::to_vec_pretty(journal)
        .map_err(|error| format!("Failed to serialize Add Panel transaction: {error}"))?;
    program_sources::transaction::write_json_file(&add_panel_transaction_path(root), &body, mode)
}

fn read_add_panel_journal(root: &Path) -> Result<AddPanelTransactionJournal, String> {
    let path = add_panel_transaction_path(root);
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let journal = serde_json::from_str::<AddPanelTransactionJournal>(&raw).map_err(|error| {
        format!(
            "Add Panel transaction {} is invalid: {error}",
            path.display()
        )
    })?;
    if journal.schema_version != ADD_PANEL_TRANSACTION_SCHEMA_VERSION {
        return Err(format!(
            "Add Panel transaction {} has unsupported schemaVersion {}.",
            path.display(),
            journal.schema_version
        ));
    }
    Ok(journal)
}

fn locate_add_panel_transaction(token: &str) -> Result<PathBuf, String> {
    let token = validate_folder_name(token, "Add Panel transaction token")?;
    if !token.starts_with("add-panel-") {
        return Err("Add Panel transaction token has the wrong kind.".to_string());
    }
    let root = add_program_transactions_root()?.join(&token);
    if !root.is_dir() {
        return Err(format!("Add Panel transaction '{token}' does not exist."));
    }
    Ok(root)
}

fn panel_child_entry(parent: &Path, panel_name: &str) -> Result<Option<PathBuf>, String> {
    if !parent.is_dir() {
        return Ok(None);
    }
    let mut matched = None;
    for entry in fs::read_dir(parent)
        .map_err(|error| format!("Failed to read {}: {error}", parent.display()))?
    {
        let entry =
            entry.map_err(|error| format!("Failed to inspect {}: {error}", parent.display()))?;
        if !entry
            .file_name()
            .to_string_lossy()
            .eq_ignore_ascii_case(panel_name)
        {
            continue;
        }
        if matched.is_some() {
            return Err(format!(
                "Panels folder '{}' contains ambiguous case-insensitive matches for '{}'.",
                parent.display(),
                panel_name
            ));
        }
        program_sources::installed_page::reject_package_source_reparse_point(&entry.path())?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;
        if !file_type.is_dir() {
            return Err(format!(
                "Panel destination '{}' exists but is not a directory.",
                entry.path().display()
            ));
        }
        matched = Some(entry.path());
    }
    Ok(matched)
}

fn is_flowcell_owned_panel_artifact(file_name: &str) -> bool {
    let lower = file_name.to_ascii_lowercase();
    lower.contains(program_sources::records::ACTIVE_SOURCE_RECORD_SUFFIX)
        || lower == program_sources::records::INSTALL_RECORD_FILE_NAME
        || lower == "source-quarantine.json"
        || lower == "uninstall-transaction.json"
        || lower == "rename-transaction.json"
        || lower == ADD_PROGRAM_TRANSACTION_FILE_NAME
        || lower == ADD_PANEL_TRANSACTION_FILE_NAME
        || lower == ADD_PANEL_MARKER_FILE_NAME
        || lower == PROGRAM_UNREGISTRATION_TRANSACTION_FILE_NAME
        || lower == PANEL_DELETION_TRANSACTION_FILE_NAME
        || lower == PANEL_DELETION_MARKER_FILE_NAME
        || lower == "installed-page-state.json"
        || lower.starts_with(".flowcell-install-transaction-")
        || lower.starts_with(".flowcell-source-rename-")
        || lower.starts_with(".flowcell-add-panel-staging-")
}

fn inspect_external_panel_tree(
    source_root: &Path,
    directory: &Path,
    file_count: &mut u64,
    byte_count: &mut u64,
) -> Result<(), String> {
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("Failed to read {}: {error}", directory.display()))?
    {
        let entry =
            entry.map_err(|error| format!("Failed to inspect {}: {error}", directory.display()))?;
        let path = entry.path();
        program_sources::installed_page::reject_package_source_reparse_point(&path)?;
        let canonical = path.canonicalize().map_err(|error| {
            format!(
                "Panel source entry {} could not be resolved: {error}",
                path.display()
            )
        })?;
        if !canonical.starts_with(source_root) {
            return Err(format!(
                "Panel source entry escapes the selected source folder: {}.",
                path.display()
            ));
        }
        let file_name = entry.file_name().to_string_lossy().to_string();
        if is_flowcell_owned_panel_artifact(&file_name) {
            return Err(format!(
                "Panel source contains FlowCell-owned runtime or transaction artifact '{}'.",
                path.display()
            ));
        }
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?;
        if file_type.is_dir() {
            inspect_external_panel_tree(source_root, &canonical, file_count, byte_count)?;
        } else if file_type.is_file() {
            *file_count = file_count
                .checked_add(1)
                .ok_or_else(|| "Panel source file count overflowed.".to_string())?;
            *byte_count = byte_count
                .checked_add(
                    entry
                        .metadata()
                        .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?
                        .len(),
                )
                .ok_or_else(|| "Panel source byte count overflowed.".to_string())?;
        } else {
            return Err(format!(
                "Panel source contains unsupported filesystem entry '{}'.",
                path.display()
            ));
        }
    }
    Ok(())
}

fn validate_external_panel_source(source_folder: &str) -> Result<(PathBuf, u64, u64), String> {
    let selected = PathBuf::from(source_folder.trim().trim_matches('"'));
    if !selected.is_absolute() {
        return Err("Panel source folder must be an absolute path.".to_string());
    }
    program_sources::installed_page::reject_selected_source_reparse_point(&selected)?;
    let source_root = selected.canonicalize().map_err(|error| {
        format!(
            "Selected panel source folder '{}' could not be resolved: {error}",
            selected.display()
        )
    })?;
    program_sources::installed_page::reject_package_source_reparse_point(&source_root)?;
    if !source_root.is_dir() {
        return Err(format!(
            "Selected panel source is not a directory: {}.",
            source_root.display()
        ));
    }
    let mut file_count = 0;
    let mut byte_count = 0;
    inspect_external_panel_tree(&source_root, &source_root, &mut file_count, &mut byte_count)?;
    Ok((source_root, file_count, byte_count))
}

fn validate_existing_panel_health(
    program_name: &str,
    panel_name: &str,
    panel_path: &Path,
) -> Result<(), String> {
    program_sources::installed_page::reject_selected_source_reparse_point(panel_path)?;
    program_sources::installed_page::reject_package_source_reparse_point(panel_path)?;
    for entry in fs::read_dir(panel_path)
        .map_err(|error| format!("Failed to read {}: {error}", panel_path.display()))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to inspect {}: {error}", panel_path.display()))?;
        program_sources::installed_page::reject_package_source_reparse_point(&entry.path())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        let lower = file_name.to_ascii_lowercase();
        if lower.ends_with(program_sources::records::ACTIVE_SOURCE_RECORD_SUFFIX) {
            let resolution = program_sources::execute::resolve_active_source_record(
                program_name,
                panel_name,
                &file_name,
            )?;
            if resolution.is_none() {
                return Err(format!(
                    "Panel '{}' contains an unresolved active Button record '{}'.",
                    panel_name, file_name
                ));
            }
        } else if is_flowcell_owned_panel_artifact(&file_name) {
            return Err(format!(
                "Panel '{}' contains unfinished FlowCell runtime artifact '{}'.",
                panel_name, file_name
            ));
        }
    }
    Ok(())
}

fn preflight_add_panel_plan_inner(
    request: &AddPanelPlanRequest,
) -> Result<AddPanelPreflight, String> {
    let program_name = require_registered_program_name(&request.program_name)?;
    let panel_name = validate_folder_name(&request.panel_name, "Panel")?;
    let program_root = resolve_program_directory(&program_name)?;
    let manifest = program_sources::manifest::load_program_manifest(&program_name)?;
    let panels_root = program_sources::manifest::resolve_manifest_folder(
        &program_root,
        &manifest.panels_folder,
        "panelsFolder",
    )?;
    let existing_path = panel_child_entry(&panels_root, &panel_name)?;
    if let Some(path) = existing_path.as_ref() {
        validate_existing_panel_health(&program_name, &panel_name, path)?;
    }
    let source = request
        .source_folder
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(validate_external_panel_source)
        .transpose()?;
    Ok(AddPanelPreflight {
        program_name,
        panel_name,
        source_folder: source
            .as_ref()
            .map(|(path, _, _)| path.to_string_lossy().to_string()),
        existing: existing_path.is_some(),
        copy_file_count: source.as_ref().map(|(_, count, _)| *count).unwrap_or(0),
        copy_byte_count: source.as_ref().map(|(_, _, bytes)| *bytes).unwrap_or(0),
    })
}

#[tauri::command]
pub(crate) fn preflight_add_panel_plan(
    request: AddPanelPlanRequest,
) -> Result<AddPanelPreflight, String> {
    preflight_add_panel_plan_inner(&request)
}

fn copy_external_panel_tree(
    source: &Path,
    destination: &Path,
    source_root: &Path,
) -> Result<(), String> {
    for entry in fs::read_dir(source)
        .map_err(|error| format!("Failed to read {}: {error}", source.display()))?
    {
        let entry =
            entry.map_err(|error| format!("Failed to inspect {}: {error}", source.display()))?;
        let path = entry.path();
        program_sources::installed_page::reject_package_source_reparse_point(&path)?;
        let canonical = path.canonicalize().map_err(|error| {
            format!(
                "Panel source entry {} could not be resolved: {error}",
                path.display()
            )
        })?;
        if !canonical.starts_with(source_root) {
            return Err(format!(
                "Panel source entry escapes the selected source folder: {}.",
                path.display()
            ));
        }
        let file_name = entry.file_name().to_string_lossy().to_string();
        if is_flowcell_owned_panel_artifact(&file_name) {
            return Err(format!(
                "Panel source gained FlowCell-owned runtime artifact '{}'.",
                path.display()
            ));
        }
        let target = destination.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?;
        if file_type.is_dir() {
            fs::create_dir(&target)
                .map_err(|error| format!("Failed to create {}: {error}", target.display()))?;
            copy_external_panel_tree(&canonical, &target, source_root)?;
        } else if file_type.is_file() {
            fs::copy(&canonical, &target).map_err(|error| {
                format!(
                    "Failed to copy {} into managed panel staging: {error}",
                    path.display()
                )
            })?;
        } else {
            return Err(format!(
                "Panel source contains unsupported filesystem entry '{}'.",
                path.display()
            ));
        }
    }
    Ok(())
}

fn write_add_panel_marker(directory: &Path, token: &str) -> Result<(), String> {
    let body = serde_json::to_vec_pretty(&json!({ "transactionToken": token }))
        .map_err(|error| format!("Failed to serialize Add Panel ownership marker: {error}"))?;
    program_sources::transaction::write_json_file(
        &directory.join(ADD_PANEL_MARKER_FILE_NAME),
        &body,
        program_sources::transaction::AtomicWriteMode::Create,
    )
}

fn add_panel_marker_matches(directory: &Path, token: &str) -> Result<bool, String> {
    let path = directory.join(ADD_PANEL_MARKER_FILE_NAME);
    if !path.is_file() {
        return Ok(false);
    }
    let value = serde_json::from_str::<Value>(
        &fs::read_to_string(&path)
            .map_err(|error| format!("Failed to read {}: {error}", path.display()))?,
    )
    .map_err(|error| format!("Add Panel marker {} is invalid: {error}", path.display()))?;
    Ok(value
        .get("transactionToken")
        .and_then(Value::as_str)
        .map(|value| value == token)
        .unwrap_or(false))
}

fn recycle_owned_add_panel_destination_with<F>(
    journal: &AddPanelTransactionJournal,
    recycle: F,
) -> Result<(), String>
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    if journal.panel_preexisted || !journal.destination_path.exists() {
        return Ok(());
    }
    if !add_panel_marker_matches(&journal.destination_path, &journal.transaction_token)? {
        return Err(format!(
            "Add Panel destination {} no longer carries this transaction's ownership marker; it was preserved for manual recovery.",
            journal.destination_path.display()
        ));
    }
    recycle(&journal.destination_path)
}

fn rollback_add_panel_transaction(
    root: &Path,
    journal: &mut AddPanelTransactionJournal,
) -> Result<(), String> {
    recycle_owned_add_panel_destination_with(journal, recycle_directory_path)?;
    if journal.staging_path.exists() {
        fs::remove_dir_all(&journal.staging_path).map_err(|error| {
            format!(
                "Failed to remove temporary Add Panel staging {}: {error}",
                journal.staging_path.display()
            )
        })?;
    }
    if journal.panels_root_created
        && journal.panels_root.is_dir()
        && fs::read_dir(&journal.panels_root)
            .map_err(|error| format!("Failed to read {}: {error}", journal.panels_root.display()))?
            .next()
            .is_none()
    {
        recycle_directory_path(&journal.panels_root)?;
    }
    journal.phase = AddPanelTransactionPhase::RolledBack;
    write_add_panel_journal(
        root,
        journal,
        program_sources::transaction::AtomicWriteMode::Replace,
    )?;
    fs::remove_dir_all(root).map_err(|error| {
        format!(
            "Add Panel rollback completed, but temporary transaction cleanup failed at {}: {error}",
            root.display()
        )
    })
}

fn canonical_matches_add_panel(journal: &AddPanelTransactionJournal) -> Result<bool, String> {
    let Some(expected) = journal.expected_button_id.as_deref() else {
        return Ok(false);
    };
    let Some(document) = crate::button_state::load_button_state()? else {
        return Ok(false);
    };
    let Some(button) = canonical_button(&document, expected) else {
        return Ok(false);
    };
    Ok(
        button.get("role").and_then(Value::as_str) == Some("panel-owner")
            && button
                .get("metadata")
                .and_then(Value::as_object)
                .and_then(|metadata| metadata.get("programName"))
                .and_then(Value::as_str)
                .map(|program| program.eq_ignore_ascii_case(&journal.preflight.program_name))
                .unwrap_or(false)
            && button
                .get("metadata")
                .and_then(Value::as_object)
                .and_then(|metadata| metadata.get("panelName"))
                .and_then(Value::as_str)
                .map(|panel| panel.eq_ignore_ascii_case(&journal.preflight.panel_name))
                .unwrap_or(false),
    )
}

fn finalize_add_panel_transaction(
    root: &Path,
    journal: &mut AddPanelTransactionJournal,
) -> Result<(), String> {
    if !journal.panel_preexisted {
        let marker = journal.destination_path.join(ADD_PANEL_MARKER_FILE_NAME);
        if marker.exists() {
            if !add_panel_marker_matches(&journal.destination_path, &journal.transaction_token)? {
                return Err("Add Panel destination ownership marker changed.".to_string());
            }
            fs::remove_file(&marker).map_err(|error| {
                format!(
                    "Failed to remove temporary marker {}: {error}",
                    marker.display()
                )
            })?;
        }
    }
    journal.phase = AddPanelTransactionPhase::Committed;
    write_add_panel_journal(
        root,
        journal,
        program_sources::transaction::AtomicWriteMode::Replace,
    )?;
    fs::remove_dir_all(root).map_err(|error| {
        format!(
            "Add Panel committed, but temporary transaction cleanup failed at {}: {error}",
            root.display()
        )
    })
}

#[tauri::command]
pub(crate) fn apply_add_panel_plan(
    request: AddPanelPlanRequest,
) -> Result<AppliedPanelSetup, String> {
    let lock = ADD_PANEL_TRANSACTION_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Add Panel transaction lock was poisoned.".to_string())?;
    let _source_guard = program_sources::source_quarantine_guard()?;
    let preflight = preflight_add_panel_plan_inner(&request)?;
    let program_root = resolve_program_directory(&preflight.program_name)?;
    let manifest = program_sources::manifest::load_program_manifest(&preflight.program_name)?;
    let panels_root = program_sources::manifest::resolve_manifest_folder(
        &program_root,
        &manifest.panels_folder,
        "panelsFolder",
    )?;
    let existing = panel_child_entry(&panels_root, &preflight.panel_name)?;
    if existing.is_some() != preflight.existing {
        return Err("Panel inventory changed after preflight; retry Add Panel.".to_string());
    }
    let transaction_token = next_setup_transaction_token("add-panel");
    let root = add_program_transactions_root()?.join(&transaction_token);
    let staging_path = panels_root.join(format!(".flowcell-add-panel-staging-{transaction_token}"));
    let destination_path = existing
        .clone()
        .unwrap_or_else(|| panels_root.join(&preflight.panel_name));
    let mut journal = AddPanelTransactionJournal {
        schema_version: ADD_PANEL_TRANSACTION_SCHEMA_VERSION,
        phase: AddPanelTransactionPhase::Prepared,
        transaction_token: transaction_token.clone(),
        preflight: preflight.clone(),
        panels_root: panels_root.clone(),
        destination_path: destination_path.clone(),
        staging_path: staging_path.clone(),
        panels_root_created: !panels_root.exists(),
        panel_preexisted: existing.is_some(),
        expected_button_id: None,
    };
    write_add_panel_journal(
        &root,
        &journal,
        program_sources::transaction::AtomicWriteMode::Create,
    )?;
    let apply_result = (|| {
        if !preflight.existing {
            fs::create_dir_all(&panels_root)
                .map_err(|error| format!("Failed to create {}: {error}", panels_root.display()))?;
            if panel_child_entry(&panels_root, &preflight.panel_name)?.is_some()
                || destination_path.exists()
            {
                return Err(
                    "Panel destination appeared after preflight; retry Add Panel.".to_string(),
                );
            }
            if staging_path.exists() {
                return Err(format!(
                    "Add Panel staging path unexpectedly exists: {}.",
                    staging_path.display()
                ));
            }
            fs::create_dir(&staging_path)
                .map_err(|error| format!("Failed to create {}: {error}", staging_path.display()))?;
            write_add_panel_marker(&staging_path, &transaction_token)?;
            if let Some(source) = preflight.source_folder.as_deref() {
                let (source, file_count, byte_count) = validate_external_panel_source(source)?;
                if file_count != preflight.copy_file_count
                    || byte_count != preflight.copy_byte_count
                {
                    return Err(
                        "Panel source contents changed after preflight; retry Add Panel."
                            .to_string(),
                    );
                }
                copy_external_panel_tree(&source, &staging_path, &source)?;
            }
            fs::rename(&staging_path, &destination_path).map_err(|error| {
                format!(
                    "Failed to atomically publish managed panel {}: {error}",
                    destination_path.display()
                )
            })?;
        }
        journal.phase = AddPanelTransactionPhase::NativeApplied;
        write_add_panel_journal(
            &root,
            &journal,
            program_sources::transaction::AtomicWriteMode::Replace,
        )
    })();
    if let Err(error) = apply_result {
        let rollback = rollback_add_panel_transaction(&root, &mut journal);
        return Err(match rollback {
            Ok(()) => format!("{error} Add Panel was rolled back."),
            Err(rollback_error) => format!(
                "{error} Add Panel rollback was retained at {}: {rollback_error}",
                root.display()
            ),
        });
    }
    Ok(AppliedPanelSetup {
        transaction_token,
        program_name: preflight.program_name,
        panel_name: preflight.panel_name,
        created: !preflight.existing,
    })
}

#[tauri::command]
pub(crate) fn prepare_add_panel_canonical_commit(
    transaction_token: String,
    expected_button_id: String,
) -> Result<(), String> {
    let lock = ADD_PANEL_TRANSACTION_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Add Panel transaction lock was poisoned.".to_string())?;
    let root = locate_add_panel_transaction(&transaction_token)?;
    let mut journal = read_add_panel_journal(&root)?;
    let expected_button_id =
        program_sources::records::validate_owner_button_id(&expected_button_id)?;
    match journal.phase {
        AddPanelTransactionPhase::NativeApplied => {
            journal.expected_button_id = Some(expected_button_id);
            journal.phase = AddPanelTransactionPhase::AwaitingCanonical;
            write_add_panel_journal(
                &root,
                &journal,
                program_sources::transaction::AtomicWriteMode::Replace,
            )
        }
        AddPanelTransactionPhase::AwaitingCanonical
            if journal.expected_button_id.as_deref() == Some(expected_button_id.as_str()) =>
        {
            Ok(())
        }
        _ => Err("Add Panel transaction is not ready for a canonical commit.".to_string()),
    }
}

#[tauri::command]
pub(crate) fn finalize_add_panel_plan(transaction_token: String) -> Result<(), String> {
    let lock = ADD_PANEL_TRANSACTION_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Add Panel transaction lock was poisoned.".to_string())?;
    let root = locate_add_panel_transaction(&transaction_token)?;
    let mut journal = read_add_panel_journal(&root)?;
    if journal.phase != AddPanelTransactionPhase::AwaitingCanonical {
        return Err("Add Panel transaction is not awaiting canonical state.".to_string());
    }
    if !canonical_matches_add_panel(&journal)? {
        return Err("Canonical Button state does not contain the Add Panel owner.".to_string());
    }
    finalize_add_panel_transaction(&root, &mut journal)
}

#[tauri::command]
pub(crate) fn rollback_add_panel_plan(transaction_token: String) -> Result<String, String> {
    let lock = ADD_PANEL_TRANSACTION_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Add Panel transaction lock was poisoned.".to_string())?;
    let root = locate_add_panel_transaction(&transaction_token)?;
    let mut journal = read_add_panel_journal(&root)?;
    if journal.phase == AddPanelTransactionPhase::AwaitingCanonical
        && canonical_matches_add_panel(&journal)?
    {
        finalize_add_panel_transaction(&root, &mut journal)?;
        return Ok("finalized".to_string());
    }
    if matches!(
        journal.phase,
        AddPanelTransactionPhase::Committed | AddPanelTransactionPhase::RolledBack
    ) {
        return Err("Add Panel transaction is already complete.".to_string());
    }
    rollback_add_panel_transaction(&root, &mut journal)?;
    Ok("rolled-back".to_string())
}

pub(crate) fn recover_add_panel_transactions_on_startup() -> Result<usize, String> {
    let lock = ADD_PANEL_TRANSACTION_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Add Panel transaction lock was poisoned.".to_string())?;
    let transactions_root = add_program_transactions_root()?;
    if !transactions_root.is_dir() {
        return Ok(0);
    }
    let mut roots = fs::read_dir(&transactions_root)
        .map_err(|error| format!("Failed to read {}: {error}", transactions_root.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir() && add_panel_transaction_path(path).is_file())
        .collect::<Vec<_>>();
    roots.sort();
    let mut recovered = 0;
    for root in roots {
        let mut journal = read_add_panel_journal(&root)?;
        match journal.phase {
            AddPanelTransactionPhase::AwaitingCanonical
                if canonical_matches_add_panel(&journal)? =>
            {
                finalize_add_panel_transaction(&root, &mut journal)?;
            }
            AddPanelTransactionPhase::Prepared
            | AddPanelTransactionPhase::NativeApplied
            | AddPanelTransactionPhase::AwaitingCanonical => {
                rollback_add_panel_transaction(&root, &mut journal)?;
            }
            AddPanelTransactionPhase::Committed | AddPanelTransactionPhase::RolledBack => {
                fs::remove_dir_all(&root).map_err(|error| {
                    format!(
                        "Failed to clean temporary Add Panel transaction {}: {error}",
                        root.display()
                    )
                })?;
            }
        }
        recovered += 1;
    }
    Ok(recovered)
}

fn locate_delete_transaction(
    transaction_token: &str,
    token_prefix: &str,
    journal_file_name: &str,
) -> Result<PathBuf, String> {
    let token = validate_folder_name(transaction_token, "Deletion transaction token")?;
    if token != transaction_token.trim() || !token.starts_with(token_prefix) {
        return Err("Deletion transaction token has the wrong kind.".to_string());
    }
    let root = delete_transactions_root()?.join(&token);
    if !root.is_dir() || !root.join(journal_file_name).is_file() {
        return Err(format!(
            "Deletion transaction '{token}' does not exist or is already complete."
        ));
    }
    validate_delete_transaction_root(&root, &token, token_prefix)?;
    Ok(root)
}

fn locate_program_unregistration_transaction(transaction_token: &str) -> Result<PathBuf, String> {
    locate_delete_transaction(
        transaction_token,
        "delete-program-",
        PROGRAM_UNREGISTRATION_TRANSACTION_FILE_NAME,
    )
}

fn locate_panel_deletion_transaction(transaction_token: &str) -> Result<PathBuf, String> {
    locate_delete_transaction(
        transaction_token,
        "delete-panel-",
        PANEL_DELETION_TRANSACTION_FILE_NAME,
    )
}

fn validate_program_unregistration_live_paths(
    journal: &ProgramUnregistrationTransactionJournal,
) -> Result<(), String> {
    let (_, _, current_path) = read_bindings_file_state()?;
    if !paths_match_case_insensitively(&current_path, &journal.bindings_path)
        && !paths_refer_to_same_existing_entry(&current_path, &journal.bindings_path)
    {
        return Err(format!(
            "FlowCell bindings path changed from {} to {} while program unregistration was pending.",
            journal.bindings_path.display(),
            current_path.display()
        ));
    }
    let manifest = program_sources::manifest::load_program_manifest(&journal.program_name)?;
    let enabled_state_path =
        program_sources::manifest::enabled_program_contributions_path(&manifest)?;
    if !paths_match_case_insensitively(&enabled_state_path, &journal.enabled_state_path)
        && !paths_refer_to_same_existing_entry(&enabled_state_path, &journal.enabled_state_path)
    {
        return Err(format!(
            "Enabled contribution state path changed from {} to {} while program unregistration was pending.",
            journal.enabled_state_path.display(),
            enabled_state_path.display()
        ));
    }
    if journal.enabled_state_path.exists() {
        program_sources::installed_page::reject_package_source_reparse_point(
            &journal.enabled_state_path,
        )?;
    }
    if let Some(before) = journal.enabled_state_before.as_deref() {
        let mut state = parse_stored_enabled_program_contributions(before, &journal.program_name)?;
        program_sources::manifest::validate_enabled_program_contributions(&mut state, &manifest)?;
    }
    Ok(())
}

enum DeleteTransactionKind {
    Program,
    Panel,
}

fn list_delete_transactions() -> Result<Vec<(PathBuf, DeleteTransactionKind)>, String> {
    let transactions_root = delete_transactions_root()?;
    if !transactions_root.is_dir() {
        return Ok(Vec::new());
    }
    let mut transactions = Vec::new();
    for entry in fs::read_dir(&transactions_root)
        .map_err(|error| format!("Failed to read {}: {error}", transactions_root.display()))?
    {
        let entry = entry.map_err(|error| {
            format!("Failed to inspect {}: {error}", transactions_root.display())
        })?;
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        let has_program_journal = path
            .join(PROGRAM_UNREGISTRATION_TRANSACTION_FILE_NAME)
            .exists();
        let has_panel_journal = path.join(PANEL_DELETION_TRANSACTION_FILE_NAME).exists();
        let kind = match (
            name.starts_with("delete-program-") || has_program_journal,
            name.starts_with("delete-panel-") || has_panel_journal,
        ) {
            (true, false) => Some(DeleteTransactionKind::Program),
            (false, true) => Some(DeleteTransactionKind::Panel),
            (false, false) => None,
            (true, true) => {
                return Err(format!(
                    "Deletion transaction entry '{}' has conflicting journal kinds.",
                    path.display()
                ));
            }
        };
        let Some(kind) = kind else {
            continue;
        };
        program_sources::installed_page::reject_package_source_reparse_point(&path)?;
        if !entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?
            .is_dir()
        {
            return Err(format!(
                "Deletion transaction entry is not a directory: {}.",
                path.display()
            ));
        }
        transactions.push((path, kind));
    }
    transactions.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(transactions)
}

pub(crate) fn recover_delete_lifecycle_transactions_on_startup() -> Result<usize, String> {
    let lock = DELETE_LIFECYCLE_LOCK.get_or_init(|| Mutex::new(()));
    let _delete_guard = lock
        .lock()
        .map_err(|_| "Deletion lifecycle transaction lock was poisoned.".to_string())?;
    let _button_guard = crate::button_state::button_state_commit_guard()?;
    let _source_guard = program_sources::source_quarantine_guard()?;
    let _bindings_guard = super::bindings::bindings_state_guard()?;
    let canonical = crate::button_state::read_button_state_for_program_rename_locked()?;
    let transactions = list_delete_transactions()?;
    let mut recovered = 0;
    for (root, kind) in transactions {
        match kind {
            DeleteTransactionKind::Program => {
                let journal = read_program_unregistration_journal(&root)?;
                validate_program_unregistration_live_paths(&journal)?;
                match canonical_delete_boundary(
                    canonical.as_ref(),
                    &journal.program_name,
                    None,
                    &journal.expected_owner_button_ids,
                ) {
                    CanonicalDeleteBoundary::OwnersRemain => {
                        rollback_program_unregistration_transaction(&root, canonical.as_ref())?
                    }
                    CanonicalDeleteBoundary::OwnersAbsent => {
                        finalize_program_unregistration_transaction(&root, canonical.as_ref())?
                    }
                    CanonicalDeleteBoundary::PartialOrConflicting => {
                        return Err(format!(
                            "Program deletion recovery found a partial or conflicting canonical owner set for '{}'; journal retained at {}.",
                            journal.program_name,
                            root.display()
                        ));
                    }
                }
            }
            DeleteTransactionKind::Panel => {
                let journal = read_panel_deletion_journal(&root)?;
                match canonical_delete_boundary(
                    canonical.as_ref(),
                    &journal.program_name,
                    Some(&journal.panel_name),
                    &journal.expected_owner_button_ids,
                ) {
                    CanonicalDeleteBoundary::OwnersRemain => {
                        cancel_panel_deletion_transaction(&root, canonical.as_ref())?
                    }
                    CanonicalDeleteBoundary::OwnersAbsent => {
                        finalize_panel_deletion_transaction(&root, canonical.as_ref())?
                    }
                    CanonicalDeleteBoundary::PartialOrConflicting => {
                        return Err(format!(
                            "Panel deletion recovery found a partial or conflicting canonical owner set for '{}/{}'; journal retained at {}.",
                            journal.program_name,
                            journal.panel_name,
                            root.display()
                        ));
                    }
                }
            }
        }
        recovered += 1;
    }
    Ok(recovered)
}

pub(crate) fn require_registered_program_name(program_name: &str) -> Result<String, String> {
    let requested = validate_folder_name(program_name, "Program")?;
    list_program_folders()?
        .into_iter()
        .find(|candidate| candidate.eq_ignore_ascii_case(&requested))
        .ok_or_else(|| format!("Program '{requested}' is not registered in FlowCell."))
}

#[tauri::command]
pub(crate) fn list_panel_folders(program_name: String) -> Result<Vec<String>, String> {
    let program_name = require_registered_program_name(&program_name)?;
    let Some(panels_root) = resolve_panels_root(&program_name, false)? else {
        return Ok(Vec::new());
    };

    list_child_directory_names(&panels_root)
}

pub(crate) fn resolve_program_executable(
    program_name: &str,
    selected_location: &str,
) -> Result<PathBuf, String> {
    let selected_location = selected_location.trim().trim_matches('"');
    let selected_path = PathBuf::from(selected_location);
    if selected_path.is_file() {
        let is_exe = selected_path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("exe"));
        return is_exe.then_some(selected_path).ok_or_else(|| {
            format!("The selected program file is not an EXE: {selected_location}")
        });
    }
    if !selected_path.is_dir() {
        return Err(format!(
            "Program executable or containing folder was not found: {selected_location}"
        ));
    }

    let mut candidates = fs::read_dir(&selected_path)
        .map_err(|error| format!("Unable to inspect {}: {error}", selected_path.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case("exe"))
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|path| {
        path.file_name()
            .map(|value| value.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default()
    });
    if candidates.is_empty() {
        return Err(format!(
            "No EXE was found directly inside {}.",
            selected_path.display()
        ));
    }

    let normalize = |value: &str| {
        value
            .chars()
            .filter(|character| character.is_ascii_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect::<String>()
    };
    let stem = |path: &Path| {
        path.file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
    };
    let template_key = infer_program_template_key(program_name, Some(selected_location));
    let preferred_stem = match template_key {
        "blender" => Some("blender"),
        "illustrator" => Some("illustrator"),
        "photoshop" => Some("photoshop"),
        "windows" => Some("explorer"),
        _ => None,
    };
    if let Some(preferred_stem) = preferred_stem {
        if let Some(candidate) = candidates
            .iter()
            .find(|candidate| stem(candidate).eq_ignore_ascii_case(preferred_stem))
        {
            return Ok(candidate.clone());
        }
    }

    let normalized_program_name = normalize(program_name);
    if let Some(candidate) = candidates
        .iter()
        .find(|candidate| normalize(&stem(candidate)) == normalized_program_name)
    {
        return Ok(candidate.clone());
    }

    let auxiliary_terms = [
        "crash",
        "helper",
        "launcher",
        "setup",
        "uninstall",
        "update",
        "report",
        "service",
    ];
    let primary_candidates = candidates
        .iter()
        .filter(|candidate| {
            let candidate_stem = stem(candidate);
            !auxiliary_terms
                .iter()
                .any(|term| candidate_stem.contains(term))
        })
        .cloned()
        .collect::<Vec<_>>();
    if primary_candidates.len() == 1 {
        return Ok(primary_candidates[0].clone());
    }
    if candidates.len() == 1 {
        return Ok(candidates.remove(0));
    }

    let candidate_names = candidates
        .iter()
        .filter_map(|path| path.file_name().and_then(|value| value.to_str()))
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "Multiple EXEs were found in {}: {}. Run Add Program again and paste the full path to the correct EXE.",
        selected_path.display(),
        candidate_names
    ))
}

fn stable_program_id(program_name: &str) -> String {
    let mut id = String::new();
    let mut pending_separator = false;
    for character in program_name.trim().chars() {
        if character.is_alphanumeric() {
            if pending_separator && !id.is_empty() {
                id.push('-');
            }
            id.extend(character.to_lowercase());
            pending_separator = false;
        } else {
            pending_separator = true;
        }
    }
    if id.is_empty() {
        "program".to_string()
    } else {
        id
    }
}

fn apply_manifest_registration(
    document: &mut IniDocument,
    program_id: i64,
    program_path: &Path,
    manifest: &program_sources::manifest::ProgramManifest,
    exe_path: &str,
) -> Result<(), String> {
    let section = document
        .get_mut(&format!("ProgramTab_{program_id}"))
        .ok_or_else(|| "Program registration was not created.".to_string())?;
    let local_scripts = manifest_folder_path(
        program_path,
        &manifest.local_scripts_folder,
        "localScriptsFolder",
    )?;
    let run_method = match manifest.runner.kind.as_str() {
        "windows-script" => "windows_generic",
        "illustrator-direct" => "illustrator_direct",
        "photoshop-direct" => "photoshop_direct",
        "blender-bridge" => "blender_bridge",
        value => return Err(format!("Unsupported program runner kind '{value}'.")),
    };
    section.insert("Label".to_string(), manifest.label.clone());
    section.insert(
        "NormalizedName".to_string(),
        manifest.label.to_ascii_lowercase(),
    );
    section.insert(
        "ScriptFolder".to_string(),
        local_scripts.to_string_lossy().to_string(),
    );
    section.insert("ProgramType".to_string(), manifest.program_type.clone());
    section.insert("ExePath".to_string(), exe_path.to_string());
    section.insert("RunMethod".to_string(), run_method.to_string());
    section.insert(
        "AllowedScriptExtensions".to_string(),
        manifest
            .allowed_script_extensions
            .iter()
            .map(|value| format!(".{}", value.trim().trim_start_matches('.')))
            .collect::<Vec<_>>()
            .join("|"),
    );
    section.insert(
        "DefaultPanels".to_string(),
        manifest.default_panels.join("|"),
    );
    section.insert("ProcessNames".to_string(), manifest.process_names.join("|"));
    section.insert(
        "BridgeFolder".to_string(),
        if manifest.runner.kind == "blender-bridge" {
            program_path.to_string_lossy().to_string()
        } else {
            String::new()
        },
    );
    Ok(())
}

#[tauri::command]
pub(crate) fn rename_program_folder(
    current_name: String,
    name: String,
) -> Result<super::program_rename::BeginProgramRenameResult, String> {
    let _button_guard = crate::button_state::button_state_commit_guard()?;
    let _source_guard = program_sources::source_quarantine_guard()?;
    let _bindings_guard = super::bindings::bindings_state_guard()?;
    let current_name = require_registered_program_name(&current_name)?;
    let programs_root = resolve_programs_root()?;
    program_sources::rename::validate_program_folder_rename(&current_name)?;
    let manifest = program_sources::manifest::load_program_manifest(&current_name)?;
    let current_program_path = resolve_program_directory(&current_name)?;
    let requested_final_name = validate_folder_name(&name, "Program")?;
    let requested_program_path = programs_root.join(&requested_final_name);
    if let Some(existing_target_path) =
        find_named_child_directory(&programs_root, &requested_final_name)?
    {
        if !paths_refer_to_same_existing_entry(&existing_target_path, &current_program_path) {
            return Err(format!(
                "Program folder '{}' already exists.",
                requested_final_name
            ));
        }
    }
    let (_, current_bindings, bindings_path) = read_bindings_file_state()?;
    let mut renamed_bindings = current_bindings.clone();
    prepare_program_rename_bindings(
        &mut renamed_bindings,
        &current_name,
        &requested_final_name,
        &current_program_path,
        &requested_program_path,
        &manifest.local_scripts_folder,
    )?;
    let bindings_snapshot = if bindings_path.is_file() {
        Some(fs::read(&bindings_path).map_err(|error| {
            format!(
                "Failed to back up bindings before program rename at {}: {error}",
                bindings_path.display()
            )
        })?)
    } else {
        None
    };
    let previous_button_document =
        crate::button_state::read_button_state_for_program_rename_locked()?;
    let result = super::program_rename::begin_program_rename_locked(
        current_name,
        requested_final_name,
        bindings_snapshot,
        super::bindings::serialize_bindings_file_state(&renamed_bindings),
        previous_button_document.clone(),
    )?;
    if let Err(reload_error) = restart_flowcell_headless_backend() {
        let error = compensate_failed_program_rename_reload(
            reload_error,
            || {
                super::program_rename::rollback_program_rename_locked(
                    &result.rename_token,
                    previous_button_document.as_ref(),
                )
            },
            restart_flowcell_headless_backend,
        );
        return Err(error);
    }
    Ok(result)
}

#[tauri::command]
pub(crate) fn rollback_program_rename(rename_token: String) -> Result<(), String> {
    {
        let _button_guard = crate::button_state::button_state_commit_guard()?;
        let _source_guard = program_sources::source_quarantine_guard()?;
        let _bindings_guard = super::bindings::bindings_state_guard()?;
        let current = crate::button_state::read_button_state_for_program_rename_locked()?;
        super::program_rename::rollback_program_rename_locked(&rename_token, current.as_ref())?;
    }
    restart_flowcell_headless_backend()
}

#[tauri::command]
pub(crate) fn finalize_program_rename(rename_token: String) -> Result<(), String> {
    let _button_guard = crate::button_state::button_state_commit_guard()?;
    let _source_guard = program_sources::source_quarantine_guard()?;
    let _bindings_guard = super::bindings::bindings_state_guard()?;
    let current = crate::button_state::read_button_state_for_program_rename_locked()?;
    super::program_rename::finalize_without_canonical_change_locked(&rename_token, current.as_ref())
}

#[tauri::command]
pub(crate) fn recover_program_rename(rename_token: String) -> Result<(), String> {
    {
        let _button_guard = crate::button_state::button_state_commit_guard()?;
        let _source_guard = program_sources::source_quarantine_guard()?;
        let _bindings_guard = super::bindings::bindings_state_guard()?;
        let current = crate::button_state::read_button_state_for_program_rename_locked()?;
        super::program_rename::resolve_program_rename_locked(&rename_token, current.as_ref())?;
    }
    // A lost response may mean the transaction has already been finalized,
    // so retry the reload even when the token itself is now gone.
    restart_flowcell_headless_backend()
}

#[tauri::command]
pub(crate) fn begin_program_unregistration(
    name: String,
    expected_owner_button_ids: Vec<String>,
) -> Result<String, String> {
    // Program packages are available payloads. Removing a program from FlowCell
    // unregisters it; it must not destroy the package that makes a later Add
    // Program possible.
    let lock = DELETE_LIFECYCLE_LOCK.get_or_init(|| Mutex::new(()));
    let _delete_guard = lock
        .lock()
        .map_err(|_| "Deletion lifecycle transaction lock was poisoned.".to_string())?;
    let _button_guard = crate::button_state::button_state_commit_guard()?;
    let _source_guard = program_sources::source_quarantine_guard()?;
    let _bindings_guard = super::bindings::bindings_state_guard()?;
    let name = require_registered_program_name(&name)?;
    let (_, document, bindings_path) = read_bindings_file_state()?;
    let manifest = program_sources::manifest::load_program_manifest(&name)?;
    let (enabled_state_path, enabled_state_before) =
        snapshot_enabled_program_contributions(&manifest)?;
    let canonical = crate::button_state::read_button_state_for_program_rename_locked()?;
    let transactions_root = delete_transactions_root()?;
    begin_program_unregistration_with_state(
        name,
        document,
        bindings_path,
        enabled_state_path,
        enabled_state_before,
        expected_owner_button_ids,
        canonical.as_ref(),
        &transactions_root,
    )
}

#[tauri::command]
pub(crate) fn rollback_program_unregistration(rollback_token: String) -> Result<(), String> {
    {
        let lock = DELETE_LIFECYCLE_LOCK.get_or_init(|| Mutex::new(()));
        let _delete_guard = lock
            .lock()
            .map_err(|_| "Deletion lifecycle transaction lock was poisoned.".to_string())?;
        let _button_guard = crate::button_state::button_state_commit_guard()?;
        let _source_guard = program_sources::source_quarantine_guard()?;
        let _bindings_guard = super::bindings::bindings_state_guard()?;
        let root = locate_program_unregistration_transaction(&rollback_token)?;
        let journal = read_program_unregistration_journal(&root)?;
        validate_program_unregistration_live_paths(&journal)?;
        let canonical = crate::button_state::read_button_state_for_program_rename_locked()?;
        rollback_program_unregistration_transaction(&root, canonical.as_ref())?;
    }
    let _ = restart_flowcell_headless_backend();
    Ok(())
}

#[tauri::command]
pub(crate) fn finalize_program_unregistration(rollback_token: String) -> Result<(), String> {
    {
        let lock = DELETE_LIFECYCLE_LOCK.get_or_init(|| Mutex::new(()));
        let _delete_guard = lock
            .lock()
            .map_err(|_| "Deletion lifecycle transaction lock was poisoned.".to_string())?;
        let _button_guard = crate::button_state::button_state_commit_guard()?;
        let _source_guard = program_sources::source_quarantine_guard()?;
        let _bindings_guard = super::bindings::bindings_state_guard()?;
        let root = locate_program_unregistration_transaction(&rollback_token)?;
        let journal = read_program_unregistration_journal(&root)?;
        validate_program_unregistration_live_paths(&journal)?;
        let canonical = crate::button_state::read_button_state_for_program_rename_locked()?;
        finalize_program_unregistration_transaction(&root, canonical.as_ref())?;
    }
    let _ = restart_flowcell_headless_backend();
    Ok(())
}

#[tauri::command]
pub(crate) fn rename_panel_folder(
    program_name: String,
    current_name: String,
    name: String,
) -> Result<String, String> {
    let _source_guard = program_sources::source_quarantine_guard()?;
    let program_name = require_registered_program_name(&program_name)?;
    let panels_root = resolve_panels_root(&program_name, false)?.ok_or_else(|| {
        format!(
            "Panels folder for '{}' could not be resolved.",
            program_name
        )
    })?;
    program_sources::rename::validate_panel_folder_rename(&program_name, &current_name)?;
    let final_name = rename_child_directory(&panels_root, &current_name, &name, "Panel")?;
    if let Err(migration_error) = program_sources::rename::migrate_panel_folder_identity(
        &program_name,
        &current_name,
        &final_name,
    ) {
        let rollback =
            rename_child_directory(&panels_root, &final_name, &current_name, "Panel rollback");
        let rollback_error = match rollback {
            Ok(_) => program_sources::rename::migrate_panel_folder_identity(
                &program_name,
                &final_name,
                &current_name,
            )
            .err(),
            Err(error) => Some(error),
        };
        return Err(match rollback_error {
            Some(error) => format!(
                "Panel source identity migration failed: {migration_error} Rollback failed: {error}"
            ),
            None => format!(
                "Panel source identity migration failed and the folder rename was rolled back: {migration_error}"
            ),
        });
    }
    Ok(final_name)
}

#[tauri::command]
pub(crate) fn prepare_panel_deletion(
    program_name: String,
    panel_name: String,
    expected_owner_button_ids: Vec<String>,
) -> Result<String, String> {
    let lock = DELETE_LIFECYCLE_LOCK.get_or_init(|| Mutex::new(()));
    let _delete_guard = lock
        .lock()
        .map_err(|_| "Deletion lifecycle transaction lock was poisoned.".to_string())?;
    let _button_guard = crate::button_state::button_state_commit_guard()?;
    let _source_guard = program_sources::source_quarantine_guard()?;
    let _bindings_guard = super::bindings::bindings_state_guard()?;
    let program_name = require_registered_program_name(&program_name)?;
    let requested_panel_name = validate_folder_name(&panel_name, "Panel")?;
    let panels_root = resolve_panels_root(&program_name, false)?.ok_or_else(|| {
        format!(
            "Panels folder for '{}' could not be resolved.",
            program_name
        )
    })?;
    let panel_path = panel_child_entry(&panels_root, &requested_panel_name)?.ok_or_else(|| {
        format!(
            "Panel folder '{}' was not found in {}.",
            requested_panel_name,
            panels_root.display()
        )
    })?;
    let panel_name = panel_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Panel folder name is not valid UTF-8.".to_string())?
        .to_string();
    let canonical = crate::button_state::read_button_state_for_program_rename_locked()?;
    let transactions_root = delete_transactions_root()?;
    prepare_panel_deletion_transaction(
        program_name,
        panel_name,
        panels_root,
        panel_path,
        expected_owner_button_ids,
        canonical.as_ref(),
        &transactions_root,
    )
}

#[tauri::command]
pub(crate) fn rollback_panel_deletion(transaction_token: String) -> Result<(), String> {
    let lock = DELETE_LIFECYCLE_LOCK.get_or_init(|| Mutex::new(()));
    let _delete_guard = lock
        .lock()
        .map_err(|_| "Deletion lifecycle transaction lock was poisoned.".to_string())?;
    let _button_guard = crate::button_state::button_state_commit_guard()?;
    let _source_guard = program_sources::source_quarantine_guard()?;
    let _bindings_guard = super::bindings::bindings_state_guard()?;
    let root = locate_panel_deletion_transaction(&transaction_token)?;
    let canonical = crate::button_state::read_button_state_for_program_rename_locked()?;
    cancel_panel_deletion_transaction(&root, canonical.as_ref())
}

#[tauri::command]
pub(crate) fn finalize_panel_deletion(transaction_token: String) -> Result<(), String> {
    let lock = DELETE_LIFECYCLE_LOCK.get_or_init(|| Mutex::new(()));
    let _delete_guard = lock
        .lock()
        .map_err(|_| "Deletion lifecycle transaction lock was poisoned.".to_string())?;
    let _button_guard = crate::button_state::button_state_commit_guard()?;
    let _source_guard = program_sources::source_quarantine_guard()?;
    let _bindings_guard = super::bindings::bindings_state_guard()?;
    let root = locate_panel_deletion_transaction(&transaction_token)?;
    let canonical = crate::button_state::read_button_state_for_program_rename_locked()?;
    finalize_panel_deletion_transaction(&root, canonical.as_ref())
}

#[tauri::command]
pub(crate) fn list_panel_script_files(
    program_name: String,
    panel_name: String,
) -> Result<Vec<PanelScriptFileRecord>, String> {
    let program_name = require_registered_program_name(&program_name)?;
    let mut records =
        program_sources::execute::list_active_source_records(&program_name, &panel_name)?
            .into_iter()
            .map(|resolution| {
                let record = resolution.record;
                let execution_file_name = resolution.file_name.clone();
                let execution_events = record.events.clone();
                let events = record.events.and_then(|events| {
                    serde_json::to_value(events).ok().and_then(|value| {
                        serde_json::from_value::<PanelButtonEventsRecord>(value).ok()
                    })
                });
                PanelScriptFileRecord {
                    file_name: resolution.file_name,
                    label: record.label,
                    tooltip: (!record.tooltip.trim().is_empty()).then_some(record.tooltip),
                    kind: Some(record.kind),
                    execution_target: Some(json!({
                        "kind": "panel-script",
                        "programName": record.program_name,
                        "panelName": record.panel_name,
                        "fileName": execution_file_name,
                        "events": execution_events,
                    })),
                    bridge_action: (!record.bridge_action.trim().is_empty())
                        .then_some(record.bridge_action),
                    bridge_data: record.bridge_data,
                    events,
                    children: (!record.children.is_empty()).then_some(
                        record
                            .children
                            .into_iter()
                            .map(|child| PanelScriptChildRecord {
                                slot: child.slot,
                                label: child.label,
                                tooltip: child.tooltip,
                            })
                            .collect(),
                    ),
                }
            })
            .collect::<Vec<_>>();
    records.sort_by_cached_key(|record| record.label.to_ascii_lowercase());
    Ok(records)
}

#[cfg(test)]
mod durable_delete_lifecycle_tests {
    use super::{
        begin_program_unregistration_with_state, cancel_panel_deletion_transaction_with,
        canonical_delete_boundary, current_optional_file_bytes,
        finalize_panel_deletion_transaction_with, finalize_program_unregistration_transaction,
        panel_deletion_marker_path, panel_deletion_transaction_path,
        prepare_panel_deletion_transaction, program_unregistration_transaction_path,
        read_panel_deletion_journal, read_program_unregistration_journal,
        rollback_program_unregistration_transaction, validate_owned_panel_delete_target,
        CanonicalDeleteBoundary,
    };
    use crate::commands::bindings::{
        find_registered_program, parse_ini_document, serialize_bindings_file_state,
    };
    use serde_json::{json, Value};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_root(label: &str) -> PathBuf {
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "flowcell-delete-{label}-{}-{token}",
            std::process::id()
        ))
    }

    fn initial_bindings() -> crate::commands::bindings::IniDocument {
        parse_ini_document(
            r#"
[Meta]
ProgramTabIds=1|2
ProgramTabNextId=3
SelectedProgramTabId=1
Ids=9

[ProgramTab_1]
Label=Illustrator
NormalizedName=illustrator

[ProgramTab_2]
Label=Windows
NormalizedName=windows

[Binding_9]
ProgramTabId=1
Shortcut=Ctrl+9
ScriptPath=C:\FlowCell\Illustrator.jsx
"#,
        )
    }

    fn source_owner_document(owner_id: &str, program_name: &str, panel_name: &str) -> Value {
        json!({
            "buttons": {
                owner_id: {
                    "id": owner_id,
                    "role": "single-script",
                    "sourceIdentity": {
                        "displayProgramName": program_name,
                        "displayPanelName": panel_name,
                        "displayFileName": "source.jsx"
                    },
                    "metadata": {}
                }
            }
        })
    }

    fn panel_owner_document(owner_id: &str, program_name: &str, panel_name: &str) -> Value {
        json!({
            "buttons": {
                owner_id: {
                    "id": owner_id,
                    "role": "panel-owner",
                    "sourceIdentity": null,
                    "metadata": {
                        "programName": program_name,
                        "panelName": panel_name
                    }
                }
            }
        })
    }

    fn begin_program_fixture(
        root: &Path,
        canonical: &Value,
    ) -> (String, PathBuf, Vec<u8>, PathBuf, Vec<u8>) {
        fs::create_dir_all(root).expect("create temporary root");
        let transactions = root.join("transactions");
        fs::create_dir_all(&transactions).expect("create temporary transactions root");
        let bindings_path = root.join("bindings.ini");
        let initial = initial_bindings();
        let initial_bytes = serialize_bindings_file_state(&initial);
        fs::write(&bindings_path, &initial_bytes).expect("write temporary bindings");
        let enabled_state_path = root.join("illustrator.json");
        let enabled_state_before = serde_json::to_vec_pretty(&json!({
            "schemaVersion": 1,
            "programId": "illustrator",
            "programName": "Illustrator",
            "enabledSources": []
        }))
        .expect("serialize temporary enabled state");
        fs::write(&enabled_state_path, &enabled_state_before)
            .expect("write temporary enabled state");
        let token = begin_program_unregistration_with_state(
            "Illustrator".to_string(),
            initial,
            bindings_path.clone(),
            enabled_state_path.clone(),
            Some(enabled_state_before.clone()),
            vec!["owner-illustrator".to_string()],
            Some(canonical),
            &transactions,
        )
        .expect("begin durable program unregistration");
        (
            token,
            bindings_path,
            initial_bytes,
            enabled_state_path,
            enabled_state_before,
        )
    }

    #[test]
    fn program_unregistration_recovers_both_sides_of_canonical_commit() {
        let canonical = source_owner_document("owner-illustrator", "Illustrator", "Layers");
        let root = temporary_root("program-cut-points");
        let (token, bindings_path, initial_bytes, enabled_state_path, enabled_state_before) =
            begin_program_fixture(&root, &canonical);
        let transaction_root = root.join("transactions").join(&token);
        assert!(program_unregistration_transaction_path(&transaction_root).is_file());
        assert!(!enabled_state_path.exists());
        assert!(find_registered_program(
            &parse_ini_document(
                std::str::from_utf8(
                    &current_optional_file_bytes(&bindings_path, "Bindings")
                        .expect("read bindings")
                        .expect("bindings exist")
                )
                .expect("bindings utf8")
            ),
            "Illustrator"
        )
        .is_none());

        rollback_program_unregistration_transaction(&transaction_root, Some(&canonical))
            .expect("owners remain, so startup restores registration");
        assert_eq!(
            fs::read(&bindings_path).expect("read restored"),
            initial_bytes
        );
        assert_eq!(
            fs::read(&enabled_state_path).expect("read restored enabled state"),
            enabled_state_before
        );
        assert!(!transaction_root.exists());

        let (token, bindings_path, initial_bytes, enabled_state_path, enabled_state_before) =
            begin_program_fixture(&root, &canonical);
        let transaction_root = root.join("transactions").join(&token);
        fs::write(&bindings_path, &initial_bytes)
            .expect("simulate crash after journal but before bindings publish");
        fs::write(&enabled_state_path, &enabled_state_before)
            .expect("simulate crash before enabled state recycle");
        let absent = json!({ "buttons": {} });
        finalize_program_unregistration_transaction(&transaction_root, Some(&absent))
            .expect("owners absent, so startup finishes registration removal");
        let finalized = parse_ini_document(
            std::str::from_utf8(&fs::read(&bindings_path).expect("read finalized"))
                .expect("bindings utf8"),
        );
        assert!(find_registered_program(&finalized, "Illustrator").is_none());
        assert!(!enabled_state_path.exists());
        assert!(!transaction_root.exists());
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[test]
    fn program_unregistration_refuses_drift_and_strict_json_extensions() {
        let canonical = source_owner_document("owner-illustrator", "Illustrator", "Layers");
        let root = temporary_root("program-drift");
        let (token, bindings_path, _, enabled_state_path, _) =
            begin_program_fixture(&root, &canonical);
        let transaction_root = root.join("transactions").join(&token);
        let expected_after = fs::read(&bindings_path).expect("read expected after");
        fs::write(&bindings_path, b"[ActionHotkeys]\r\nChanged=Ctrl+9\r\n")
            .expect("write unrelated drift");
        let error =
            rollback_program_unregistration_transaction(&transaction_root, Some(&canonical))
                .expect_err("rollback must refuse drift");
        assert!(error.contains("Refusing to overwrite unrelated changes"));
        assert!(transaction_root.is_dir());
        fs::write(&bindings_path, expected_after).expect("restore expected post-delete bindings");
        fs::write(&enabled_state_path, b"{\"unexpected\":true}")
            .expect("write unrelated enabled-state drift");
        let expected_post_delete_bindings = fs::read(&bindings_path).expect("read post-delete");
        let error =
            rollback_program_unregistration_transaction(&transaction_root, Some(&canonical))
                .expect_err("rollback must refuse enabled-state drift");
        assert!(error.contains("Enabled program contribution state changed"));
        assert_eq!(
            fs::read(&bindings_path).expect("bindings remain at delete boundary"),
            expected_post_delete_bindings
        );
        fs::remove_file(&enabled_state_path).expect("remove temporary drift file");

        let journal_path = program_unregistration_transaction_path(&transaction_root);
        let mut journal_json = serde_json::from_str::<Value>(
            &fs::read_to_string(&journal_path).expect("read program journal"),
        )
        .expect("parse program journal value");
        journal_json
            .as_object_mut()
            .expect("journal object")
            .insert("unexpected".to_string(), json!(true));
        fs::write(
            &journal_path,
            serde_json::to_vec_pretty(&journal_json).expect("serialize corrupt journal"),
        )
        .expect("write strict-json probe");
        let error = read_program_unregistration_journal(&transaction_root)
            .expect_err("unknown journal fields must be rejected");
        assert!(error.contains("unknown field"));
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[test]
    fn canonical_delete_boundary_rejects_partial_conflicting_and_unsafe_empty_sets() {
        let canonical = source_owner_document("owner-illustrator", "Illustrator", "Layers");
        assert_eq!(
            canonical_delete_boundary(
                Some(&canonical),
                "Illustrator",
                None,
                &["owner-illustrator".to_string()]
            ),
            CanonicalDeleteBoundary::OwnersRemain
        );
        assert_eq!(
            canonical_delete_boundary(Some(&canonical), "Illustrator", None, &[]),
            CanonicalDeleteBoundary::PartialOrConflicting
        );
        assert_eq!(
            canonical_delete_boundary(
                Some(&canonical),
                "Illustrator",
                None,
                &["owner-illustrator".to_string(), "owner-missing".to_string()]
            ),
            CanonicalDeleteBoundary::PartialOrConflicting
        );
        let absent = json!({ "buttons": {} });
        assert_eq!(
            canonical_delete_boundary(Some(&absent), "Illustrator", None, &[]),
            CanonicalDeleteBoundary::OwnersAbsent
        );
    }

    fn prepare_panel_fixture(root: &Path) -> (String, PathBuf, PathBuf, Value) {
        let transactions = root.join("transactions");
        let panels_root = root.join("Panels");
        let panel_path = panels_root.join("Layers");
        fs::create_dir_all(&panel_path).expect("create temporary panel");
        fs::create_dir_all(&transactions).expect("create temporary transactions root");
        let canonical = panel_owner_document("panel-owner-layers", "Illustrator", "Layers");
        let token = prepare_panel_deletion_transaction(
            "Illustrator".to_string(),
            "Layers".to_string(),
            panels_root.clone(),
            panel_path.clone(),
            vec!["panel-owner-layers".to_string()],
            Some(&canonical),
            &transactions,
        )
        .expect("prepare durable panel deletion");
        (token, panels_root, panel_path, canonical)
    }

    #[test]
    fn panel_deletion_prepare_cancel_finalize_and_lost_cleanup_are_idempotent() {
        let root = temporary_root("panel-cut-points");
        let (token, _, panel_path, canonical) = prepare_panel_fixture(&root);
        let transaction_root = root.join("transactions").join(&token);
        assert!(panel_deletion_transaction_path(&transaction_root).is_file());
        assert!(panel_deletion_marker_path(&panel_path).is_file());
        cancel_panel_deletion_transaction_with(
            &transaction_root,
            Some(&canonical),
            validate_owned_panel_delete_target,
        )
        .expect("owners remain, so startup cancels panel deletion");
        assert!(panel_path.is_dir());
        assert!(!panel_deletion_marker_path(&panel_path).exists());
        assert!(!transaction_root.exists());

        let (token, _, panel_path, _) = prepare_panel_fixture(&root);
        let transaction_root = root.join("transactions").join(&token);
        let absent = json!({ "buttons": {} });
        finalize_panel_deletion_transaction_with(
            &transaction_root,
            Some(&absent),
            validate_owned_panel_delete_target,
            |path| fs::remove_dir_all(path).map_err(|error| error.to_string()),
        )
        .expect("owners absent, so startup finalizes panel recycle");
        assert!(!panel_path.exists());
        assert!(!transaction_root.exists());

        let (token, _, panel_path, _) = prepare_panel_fixture(&root);
        let transaction_root = root.join("transactions").join(&token);
        fs::remove_dir_all(&panel_path).expect("simulate recycle before journal cleanup");
        finalize_panel_deletion_transaction_with(
            &transaction_root,
            Some(&absent),
            validate_owned_panel_delete_target,
            |_| Err("recycler must not run twice".to_string()),
        )
        .expect("missing exact panel means recycle already crossed its boundary");
        assert!(!transaction_root.exists());
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[test]
    fn panel_deletion_rejects_active_records_collisions_and_nested_targets() {
        let root = temporary_root("panel-guards");
        let (token, panels_root, panel_path, canonical) = prepare_panel_fixture(&root);
        let transaction_root = root.join("transactions").join(&token);
        let collision = prepare_panel_deletion_transaction(
            "Illustrator".to_string(),
            "Layers".to_string(),
            panels_root.clone(),
            panel_path.clone(),
            vec!["panel-owner-layers".to_string()],
            Some(&canonical),
            &root.join("transactions"),
        )
        .expect_err("a second deletion must not overlap the first");
        assert!(collision.contains("still awaiting"));

        fs::write(panel_path.join("owner-late.flowcell-source.json"), b"{}")
            .expect("write late active source marker");
        let absent = json!({ "buttons": {} });
        let error = finalize_panel_deletion_transaction_with(
            &transaction_root,
            Some(&absent),
            validate_owned_panel_delete_target,
            |_| Err("recycler must not run".to_string()),
        )
        .expect_err("late active source must preserve panel");
        assert!(error.contains("gained an installed Button"));
        assert!(panel_path.is_dir());
        assert!(transaction_root.is_dir());

        let journal = read_panel_deletion_journal(&transaction_root).expect("read panel journal");
        let mut nested = journal;
        nested.panel_path = panels_root.join("Nested").join("Layers");
        let error = validate_owned_panel_delete_target(&nested, false)
            .expect_err("nested panel target must be rejected");
        assert!(error.contains("immediate child"));
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[cfg(windows)]
    #[test]
    fn panel_deletion_rejects_reparse_targets_when_windows_allows_the_probe() {
        use std::os::windows::fs::symlink_dir;
        let root = temporary_root("panel-reparse");
        let panels_root = root.join("Panels");
        let outside = root.join("Outside");
        fs::create_dir_all(&panels_root).expect("create panels root");
        fs::create_dir_all(&outside).expect("create outside root");
        let panel_path = panels_root.join("Layers");
        if symlink_dir(&outside, &panel_path).is_ok() {
            let journal = super::PanelDeletionTransactionJournal {
                schema_version: super::DELETE_TRANSACTION_SCHEMA_VERSION,
                transaction_token: "delete-panel-test".to_string(),
                program_name: "Illustrator".to_string(),
                panel_name: "Layers".to_string(),
                panels_root,
                panel_path,
                expected_owner_button_ids: Vec::new(),
            };
            let error = validate_owned_panel_delete_target(&journal, true)
                .expect_err("reparse panel must be rejected");
            assert!(error.contains("reparse point") || error.contains("symbolic link"));
        }
        fs::remove_dir_all(root).expect("remove temporary root");
    }
}

#[cfg(test)]
mod managed_program_setup_tests {
    use super::{
        add_program_source_is_required, canonical_source_graph_matches, copy_external_panel_tree,
        install_add_program_sources_while_source_locked, mark_add_program_native_applied,
        read_add_program_journal, recover_planned_active_record_path,
        recycle_owned_add_panel_destination_with, resolve_programs_root,
        validate_available_program_package, validate_external_panel_source, write_add_panel_marker,
        write_add_program_journal, AddPanelPreflight, AddPanelTransactionJournal,
        AddPanelTransactionPhase, AddProgramPlanRequest, AddProgramPreflight,
        AddProgramSourceSelection, AddProgramTransactionJournal, AddProgramTransactionPhase,
        PlannedProgramSourceOwner, ProgramSetupSource, ADD_PANEL_TRANSACTION_SCHEMA_VERSION,
        ADD_PROGRAM_TRANSACTION_SCHEMA_VERSION,
    };
    use crate::program_sources::execute::ActiveSourceResolution;
    use crate::program_sources::manifest::BundledSourceManifest;
    use crate::program_sources::records::{ActiveSourceChild, ActiveSourceRecord};
    use serde_json::json;
    use std::cell::Cell;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "flowcell-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }

    struct TestProgramPackage(PathBuf);

    impl Drop for TestProgramPackage {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn panel_journal(destination_path: PathBuf, token: &str) -> AddPanelTransactionJournal {
        let root = destination_path
            .parent()
            .expect("destination parent")
            .to_path_buf();
        AddPanelTransactionJournal {
            schema_version: ADD_PANEL_TRANSACTION_SCHEMA_VERSION,
            phase: AddPanelTransactionPhase::Prepared,
            transaction_token: token.to_string(),
            preflight: AddPanelPreflight {
                program_name: "Test Program".to_string(),
                panel_name: "Test Panel".to_string(),
                source_folder: None,
                existing: false,
                copy_file_count: 0,
                copy_byte_count: 0,
            },
            panels_root: root.clone(),
            destination_path,
            staging_path: root.join("staging"),
            panels_root_created: false,
            panel_preexisted: false,
            expected_button_id: None,
        }
    }

    #[test]
    fn external_panel_copy_is_read_only_and_rejects_owned_artifacts() {
        let root = temporary_root("add-panel-copy");
        let source = root.join("source");
        let nested = source.join("nested");
        let destination = root.join("destination");
        fs::create_dir_all(&nested).expect("create source");
        fs::write(source.join("one.jsx"), "one").expect("write source");
        fs::write(nested.join("two.js"), "two").expect("write nested source");

        let (canonical, count, bytes) =
            validate_external_panel_source(source.to_str().expect("source path"))
                .expect("safe source preflight");
        assert_eq!(count, 2);
        assert_eq!(bytes, 6);
        fs::create_dir(&destination).expect("create destination");
        copy_external_panel_tree(&canonical, &destination, &canonical).expect("copy source");
        assert_eq!(
            fs::read_to_string(source.join("one.jsx")).expect("source preserved"),
            "one"
        );
        assert_eq!(
            fs::read_to_string(destination.join("nested").join("two.js"))
                .expect("copied nested source"),
            "two"
        );

        fs::write(source.join("owner.flowcell-source.json"), "{}").expect("write artifact");
        let error = validate_external_panel_source(source.to_str().expect("source path"))
            .expect_err("active record artifact must be rejected");
        assert!(error.contains("FlowCell-owned runtime or transaction artifact"));
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[test]
    fn add_panel_rollback_recycles_only_a_marker_owned_destination() {
        let root = temporary_root("add-panel-marker");
        let destination = root.join("Test Panel");
        fs::create_dir_all(&destination).expect("create destination");
        let journal = panel_journal(destination.clone(), "add-panel-test");
        let called = Cell::new(false);
        let error = recycle_owned_add_panel_destination_with(&journal, |_| {
            called.set(true);
            Ok(())
        })
        .expect_err("unmarked destination must be preserved");
        assert!(!called.get());
        assert!(error.contains("preserved for manual recovery"));

        write_add_panel_marker(&destination, "add-panel-test").expect("write ownership marker");
        recycle_owned_add_panel_destination_with(&journal, |path| {
            assert_eq!(path, destination);
            called.set(true);
            Ok(())
        })
        .expect("owned destination can be recycled");
        assert!(called.get());
        fs::remove_dir_all(root).expect("remove temporary root");
    }

    #[test]
    fn canonical_add_program_match_requires_exact_source_identity_and_complete_toolset_graph() {
        let resolution = ActiveSourceResolution {
            file_name: "owner.flowcell-source.json".to_string(),
            record: ActiveSourceRecord {
                schema_version: 1,
                owner_button_id: "owner".to_string(),
                install_id: "owner".to_string(),
                program_id: "test-program".to_string(),
                program_name: "Test Program".to_string(),
                panel_name: "Tools".to_string(),
                label: "Owner".to_string(),
                tooltip: String::new(),
                kind: "toolset".to_string(),
                local_package_path: String::new(),
                source_path: String::new(),
                runner: "windows-script".to_string(),
                runner_data: None,
                execution_target: None,
                bridge_action: String::new(),
                bridge_data: None,
                events: None,
                children: vec![ActiveSourceChild {
                    slot: "run".to_string(),
                    label: "Run".to_string(),
                    tooltip: String::new(),
                    payload: None,
                    execution_target: Some(json!({"kind": "test"})),
                }],
                layout: None,
                page: None,
                source_display_path: String::new(),
                bundled_source_id: Some("test.owner".to_string()),
                bundled_source_version: Some("1.0.0".to_string()),
            },
        };
        let document = json!({
            "buttons": {
                "owner": {
                    "role": "tool-set-owner",
                    "executionTarget": null,
                    "sourceIdentity": {
                        "displayProgramName": "Test Program",
                        "displayPanelName": "Tools",
                        "displayFileName": "owner.flowcell-source.json",
                        "normalizedProgramName": "test program",
                        "normalizedPanelName": "tools",
                        "normalizedFileName": "owner.flowcell-source.json"
                    }
                },
                "child": {
                    "role": "tool-set-child",
                    "sourceIdentity": null,
                    "toolSetParentId": "owner",
                    "metadata": {"toolSetSlot": "run"}
                }
            },
            "placements": {
                "child-placement": {"buttonId": "child", "surfaceId": "toolset-surface"}
            },
            "surfaces": {
                "toolset-surface": {
                    "kind": "tool-set-popout",
                    "placementIds": ["child-placement"]
                }
            },
            "popoutUnits": {
                "toolset-unit": {
                    "kind": "tool-set",
                    "ownerButtonId": "owner",
                    "surfaceId": "toolset-surface",
                    "childButtonIds": ["child"],
                    "childPlacementIds": ["child-placement"]
                }
            }
        });
        assert!(canonical_source_graph_matches(&document, &resolution));

        let mut colliding_identity = document.clone();
        colliding_identity["buttons"]["owner"]["sourceIdentity"]["displayPanelName"] =
            json!("Wrong Panel");
        assert!(!canonical_source_graph_matches(
            &colliding_identity,
            &resolution
        ));

        let mut missing_child = document;
        missing_child["buttons"]
            .as_object_mut()
            .expect("buttons object")
            .remove("child");
        assert!(!canonical_source_graph_matches(&missing_child, &resolution));
    }

    #[test]
    fn add_program_required_flag_does_not_promote_repair_policy() {
        let mut source = BundledSourceManifest {
            id: "test.repairable".to_string(),
            version: "1.0.0".to_string(),
            panel_name: "Tools".to_string(),
            source_path: "Tools/Repairable".to_string(),
            import_kind: "script".to_string(),
            install_if_missing: true,
            install_on_add: false,
            display_label: "Repairable".to_string(),
            source_kind: "script".to_string(),
            required: false,
            dependencies: Vec::new(),
            install_effects: Vec::new(),
            legacy_match_label: None,
            legacy_match_kind: None,
        };
        assert!(!add_program_source_is_required(&source));
        source.required = true;
        assert!(add_program_source_is_required(&source));
    }

    #[test]
    fn add_program_rollback_accepts_a_planned_source_that_never_installed() {
        let root = temporary_root("missing-planned-source");
        fs::create_dir_all(&root).expect("create temporary panel");
        assert!(
            recover_planned_active_record_path(&root, "owner-never-installed")
                .expect("missing planned record is a valid rollback state")
                .is_none()
        );
        fs::remove_dir_all(root).expect("remove temporary panel");
    }

    #[test]
    fn selected_source_install_uses_outer_quarantine_guard_and_reaches_native_applied() {
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let program_name = format!("FlowCell Guard Test {token}");
        let program_id = format!("flowcell-guard-test-{token}");
        let source_id = format!("{program_id}.ping");
        let programs_root = resolve_programs_root().expect("resolve Programs root");
        let program_root = programs_root.join(&program_name);
        let _cleanup = TestProgramPackage(program_root.clone());
        let source_root = program_root.join("Git Scripts").join("Tools").join("Ping");
        fs::create_dir_all(&source_root).expect("create source package");
        fs::create_dir_all(program_root.join("Panels").join("Tools")).expect("create active panel");
        fs::create_dir_all(program_root.join("SupportScripts")).expect("create support folder");
        fs::write(
            program_root.join("flowcell.program.json"),
            serde_json::to_vec_pretty(&json!({
                "schemaVersion": 1,
                "programId": program_id,
                "label": program_name,
                "programType": "local-script",
                "defaultPanels": ["Tools"],
                "panels": [{"id": "tools", "label": "Tools", "defaultSelected": true}],
                "processNames": ["explorer"],
                "bindScopedNativeOwner": false,
                "shortcutProfileId": "windows",
                "exePath": "explorer.exe",
                "gitScriptsFolder": "Git Scripts",
                "panelsFolder": "Panels",
                "localScriptsFolder": "Local Scripts",
                "supportScriptsFolder": "SupportScripts",
                "allowedScriptExtensions": ["ps1"],
                "allowedManifestFileNames": ["flowcell.script.json"],
                "supportsToolsetManifests": false,
                "bundledSources": [{
                    "id": source_id,
                    "version": "1.0.0",
                    "panelName": "Tools",
                    "sourcePath": "Git Scripts/Tools/Ping",
                    "importKind": "script",
                    "displayLabel": "Guard Test Ping",
                    "sourceKind": "script",
                    "required": false,
                    "dependencies": [],
                    "installEffects": [],
                    "installOnAdd": true
                }],
                "runner": {
                    "kind": "windows-script",
                    "programKey": "windows_generic",
                    "installScript": "",
                    "deleteScript": ""
                },
                "addonReloadNotes": "",
                "appRestartNotes": ""
            }))
            .expect("serialize test Program manifest"),
        )
        .expect("write test Program manifest");
        fs::write(
            source_root.join("flowcell.script.json"),
            serde_json::to_vec_pretty(&json!({
                "schemaVersion": 1,
                "id": source_id,
                "label": "Guard Test Ping",
                "tooltip": "Exercises selected-source installation under Add Program's outer guard.",
                "program": program_name,
                "source": "ping.ps1"
            }))
            .expect("serialize test source manifest"),
        )
        .expect("write test source manifest");
        fs::write(source_root.join("ping.ps1"), "Write-Output 'guard test'\n")
            .expect("write test source");

        let manifest = crate::program_sources::manifest::load_program_manifest(&program_name)
            .expect("load test Program manifest");
        let selected_source = ProgramSetupSource {
            id: source_id.clone(),
            label: "Guard Test Ping".to_string(),
            tooltip: String::new(),
            version: "1.0.0".to_string(),
            panel_name: "Tools".to_string(),
            source_kind: "script".to_string(),
            required: false,
            default_selected: true,
            dependencies: Vec::new(),
            install_effects: Vec::new(),
        };
        let preflight = AddProgramPreflight {
            program_id: program_id.clone(),
            program_name: program_name.clone(),
            executable_path: "explorer.exe".to_string(),
            panels: vec!["Tools".to_string()],
            sources: vec![selected_source],
            install_effects: Vec::new(),
        };
        let planned_sources = vec![PlannedProgramSourceOwner {
            owner_button_id: crate::program_sources::synchronize::deterministic_bundled_owner_id(
                &program_id,
                &source_id,
            ),
            panel_name: "Tools".to_string(),
        }];
        let transaction_root = program_root.join("test-add-program-transaction");
        let mut journal = AddProgramTransactionJournal {
            schema_version: ADD_PROGRAM_TRANSACTION_SCHEMA_VERSION,
            phase: AddProgramTransactionPhase::Prepared,
            request: AddProgramPlanRequest {
                program_name: program_name.clone(),
                executable_path: "explorer.exe".to_string(),
                selected_panels: vec!["Tools".to_string()],
                selected_sources: vec![AddProgramSourceSelection {
                    source_id: source_id.clone(),
                    destination_panel: "Tools".to_string(),
                }],
            },
            preflight: preflight.clone(),
            bindings_path: program_root.join("bindings.ini"),
            bindings_before: String::new(),
            bindings_after_registration: String::new(),
            enabled_state_path: program_root.join("enabled-state.json"),
            enabled_state_before: None,
            enabled_state_after: "{}".to_string(),
            created_directories: Vec::new(),
            planned_sources: planned_sources.clone(),
            expected_button_ids: Vec::new(),
        };
        write_add_program_journal(
            &transaction_root,
            &journal,
            crate::program_sources::transaction::AtomicWriteMode::Create,
        )
        .expect("write prepared Add Program journal");

        let source_guard = crate::program_sources::source_quarantine_guard()
            .expect("acquire Add Program source guard");
        let descriptors = install_add_program_sources_while_source_locked(
            &preflight,
            &planned_sources,
            &manifest,
            &program_root,
            &source_guard,
        )
        .expect("selected source install returns while outer source guard is held");
        assert_eq!(descriptors.len(), 1);
        drop(source_guard);

        mark_add_program_native_applied(&transaction_root, &mut journal)
            .expect("record native Add Program boundary");
        assert_eq!(journal.phase, AddProgramTransactionPhase::NativeApplied);
        assert_eq!(
            read_add_program_journal(&transaction_root)
                .expect("read Add Program journal")
                .phase,
            AddProgramTransactionPhase::NativeApplied
        );
    }

    #[test]
    fn shipped_add_program_inventory_preflights_generic_page_packages() {
        let blender =
            validate_available_program_package("Blender").expect("validate Blender package");
        assert!(blender.panels.iter().any(|panel| panel.label == "toolset"));
        let blender_theme = blender
            .sources
            .iter()
            .find(|source| source.id == "blender.theme")
            .expect("Blender Theme source inventory");
        assert_eq!(blender_theme.source_kind, "page");
        assert!(blender_theme.default_selected);

        let illustrator = validate_available_program_package("Illustrator")
            .expect("validate Illustrator package");
        let layers_tree = illustrator
            .sources
            .iter()
            .find(|source| source.id == "illustrator.layer-tree")
            .expect("Illustrator Layers Tree source inventory");
        assert_eq!(layers_tree.source_kind, "page");
        assert!(layers_tree.default_selected);

        let windows =
            validate_available_program_package("Windows").expect("validate Windows package");
        let setup_organization = windows
            .sources
            .iter()
            .find(|source| source.id == "windows.setup-organization")
            .expect("Windows Setup Organization source inventory");
        assert_eq!(setup_organization.panel_name, "Files");
        assert_eq!(setup_organization.source_kind, "page");
        assert!(setup_organization.default_selected);
    }
}
