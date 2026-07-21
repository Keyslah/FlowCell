use super::install::{
    build_response, install_from_path, InstallButtonSourceRequest, InstallButtonSourceResponse,
};
use super::manifest::{
    load_enabled_program_contributions, load_program_manifest, resolve_manifest_folder,
    resolve_relative_manifest_path, write_enabled_program_contributions, BundledSourceManifest,
    EnabledProgramContribution, EnabledProgramContributions, ProgramManifest,
};
use super::records::{
    active_record_file_name, read_active_record, recover_active_records_in_directory,
    validate_owner_button_id, ActiveSourceRecord, ACTIVE_SOURCE_RECORD_SUFFIX,
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

static BUNDLED_SOURCE_SYNC_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SynchronizeBundledProgramSourcesResponse {
    pub sources: Vec<BundledProgramSourceSyncResult>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BundledProgramSourceSyncResult {
    pub program_name: String,
    pub program_id: String,
    pub bundled_source_id: String,
    pub bundled_source_version: String,
    pub panel_name: String,
    pub import_kind: String,
    pub install_policy: String,
    pub operation: String,
    pub status: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_button_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub descriptor: Option<InstallButtonSourceResponse>,
}

#[derive(Clone, Debug)]
struct ActiveRecordEntry {
    file_name: String,
    record: ActiveSourceRecord,
}

#[derive(Clone, Debug)]
struct RecordMatchView {
    owner_button_id: String,
    panel_name: String,
    label: String,
    kind: String,
    source_display_leaf: String,
    bundled_source_id: Option<String>,
    bundled_source_version: Option<String>,
}

impl From<&ActiveRecordEntry> for RecordMatchView {
    fn from(entry: &ActiveRecordEntry) -> Self {
        Self {
            owner_button_id: entry.record.owner_button_id.clone(),
            panel_name: entry.record.panel_name.clone(),
            label: entry.record.label.clone(),
            kind: if entry.record.children.is_empty() {
                "script"
            } else {
                "tool-set"
            }
            .to_string(),
            source_display_leaf: path_leaf(&entry.record.source_display_path),
            bundled_source_id: entry.record.bundled_source_id.clone(),
            bundled_source_version: entry.record.bundled_source_version.clone(),
        }
    }
}

fn path_leaf(value: &str) -> String {
    value
        .trim()
        .trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .to_string()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ExistingMatch {
    Current(usize),
    Update(usize),
    Missing,
}

#[derive(Clone, Debug)]
enum PlannedAction {
    Current(ActiveRecordEntry),
    Update(ActiveRecordEntry),
    Install(String),
    Missing,
}

#[derive(Clone, Debug)]
struct BundledSourcePlan {
    program_name: String,
    manifest: ProgramManifest,
    source: BundledSourceManifest,
    source_path: PathBuf,
    action: PlannedAction,
}

#[derive(Clone, Debug)]
struct ProgramInventory {
    program_name: String,
    manifest: ProgramManifest,
    program_root: PathBuf,
    records: Vec<ActiveRecordEntry>,
    enabled_sources: BTreeMap<String, EnabledProgramContribution>,
}

fn fnv1a_64(value: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in value {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn owner_segment(value: &str) -> String {
    let mut result = String::new();
    let mut separator = false;
    for character in value.trim().chars() {
        if character.is_ascii_alphanumeric() {
            result.push(character.to_ascii_lowercase());
            separator = false;
        } else if !separator && !result.is_empty() {
            result.push('-');
            separator = true;
        }
    }
    while result.ends_with('-') {
        result.pop();
    }
    result
}

pub(crate) fn deterministic_bundled_owner_id(program_id: &str, bundled_source_id: &str) -> String {
    let canonical_identity = format!(
        "{}\0{}",
        program_id.trim().to_ascii_lowercase(),
        bundled_source_id.trim().to_ascii_lowercase()
    );
    let mut stem = owner_segment(&format!("{program_id}-{bundled_source_id}"));
    stem.truncate(80);
    while stem.ends_with('-') {
        stem.pop();
    }
    if stem.is_empty() {
        stem = "source".to_string();
    }
    format!(
        "bundled-{stem}-{:016x}",
        fnv1a_64(canonical_identity.as_bytes())
    )
}

fn should_install_missing(source: &BundledSourceManifest) -> bool {
    source.install_if_missing
}

fn select_existing_record(
    source: &BundledSourceManifest,
    records: &[RecordMatchView],
) -> Result<ExistingMatch, String> {
    let managed = records
        .iter()
        .enumerate()
        .filter(|(_, record)| {
            record
                .bundled_source_id
                .as_deref()
                .is_some_and(|id| id.eq_ignore_ascii_case(&source.id))
        })
        .collect::<Vec<_>>();
    if managed.len() > 1 {
        return Err(format!(
            "Bundled source '{}' has multiple active owners: {}. Refusing ambiguous synchronization.",
            source.id,
            managed
                .iter()
                .map(|(_, record)| record.owner_button_id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if let Some((index, record)) = managed.first().copied() {
        if !record.panel_name.eq_ignore_ascii_case(&source.panel_name) {
            return Err(format!(
                "Bundled source '{}' is active in panel '{}' instead of its declared panel '{}'.",
                source.id, record.panel_name, source.panel_name
            ));
        }
        return if record.bundled_source_version.as_deref() == Some(source.version.as_str()) {
            Ok(ExistingMatch::Current(index))
        } else {
            Ok(ExistingMatch::Update(index))
        };
    }

    let Some(legacy_label) = source.legacy_match_label.as_deref() else {
        return Ok(ExistingMatch::Missing);
    };
    let legacy_kind = source
        .legacy_match_kind
        .as_deref()
        .unwrap_or(&source.import_kind);
    let expected_source_leaf = path_leaf(&source.source_path);
    let legacy = records
        .iter()
        .enumerate()
        .filter(|(_, record)| {
            record.bundled_source_id.is_none()
                && record.owner_button_id.starts_with("button-migrated-")
                && record.panel_name.eq_ignore_ascii_case(&source.panel_name)
                && record.label.eq_ignore_ascii_case(legacy_label)
                && record.kind.eq_ignore_ascii_case(legacy_kind)
                && record
                    .source_display_leaf
                    .eq_ignore_ascii_case(&expected_source_leaf)
        })
        .collect::<Vec<_>>();
    match legacy.as_slice() {
        [] => Ok(ExistingMatch::Missing),
        [(index, _)] => Ok(ExistingMatch::Update(*index)),
        _ => Err(format!(
            "Bundled source '{}' legacy match '{}' found multiple active owners: {}. Refusing ambiguous synchronization.",
            source.id,
            legacy_label,
            legacy
                .iter()
                .map(|(_, record)| record.owner_button_id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )),
    }
}

fn resolve_bundled_source_path(
    program_root: &Path,
    source: &BundledSourceManifest,
) -> Result<PathBuf, String> {
    let canonical_root = program_root.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve program package root {}: {error}",
            program_root.display()
        )
    })?;
    let declared_path = resolve_relative_manifest_path(
        program_root,
        &source.source_path,
        "bundledSources.sourcePath",
        false,
    )?
    .ok_or_else(|| "bundledSources.sourcePath cannot be empty.".to_string())?;
    let canonical_source = declared_path.canonicalize().map_err(|error| {
        format!(
            "Bundled source '{}' could not be resolved at {}: {error}",
            source.id,
            declared_path.display()
        )
    })?;
    if !canonical_source.starts_with(&canonical_root) {
        return Err(format!(
            "Bundled source '{}' resolves outside its program package.",
            source.id
        ));
    }
    Ok(canonical_source)
}

fn load_active_records(
    program_root: &Path,
    manifest: &ProgramManifest,
) -> Result<Vec<ActiveRecordEntry>, String> {
    let panels_root =
        resolve_manifest_folder(program_root, &manifest.panels_folder, "panelsFolder")?;
    if !panels_root.is_dir() {
        return Ok(Vec::new());
    }
    let canonical_panels_root = panels_root.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve panels folder {}: {error}",
            panels_root.display()
        )
    })?;
    let mut records = Vec::new();
    let mut owners = BTreeSet::new();
    for panel_entry in fs::read_dir(&panels_root)
        .map_err(|error| format!("Failed to inspect {}: {error}", panels_root.display()))?
    {
        let panel_entry = panel_entry
            .map_err(|error| format!("Failed to inspect {}: {error}", panels_root.display()))?;
        let file_type = panel_entry.file_type().map_err(|error| {
            format!(
                "Failed to inspect {}: {error}",
                panel_entry.path().display()
            )
        })?;
        if file_type.is_symlink() {
            return Err(format!(
                "Panel folder {} is a symbolic link; refusing bundled-source discovery.",
                panel_entry.path().display()
            ));
        }
        if !file_type.is_dir() {
            continue;
        }
        let canonical_panel = panel_entry.path().canonicalize().map_err(|error| {
            format!(
                "Failed to resolve panel folder {}: {error}",
                panel_entry.path().display()
            )
        })?;
        if !canonical_panel.starts_with(&canonical_panels_root) {
            return Err(format!(
                "Panel folder {} resolves outside the manifest-owned panels root.",
                panel_entry.path().display()
            ));
        }
        recover_active_records_in_directory(&canonical_panel)?;
        for record_entry in fs::read_dir(&canonical_panel)
            .map_err(|error| format!("Failed to inspect {}: {error}", canonical_panel.display()))?
        {
            let record_entry = record_entry.map_err(|error| {
                format!("Failed to inspect {}: {error}", canonical_panel.display())
            })?;
            if !record_entry
                .file_type()
                .map_err(|error| {
                    format!(
                        "Failed to inspect {}: {error}",
                        record_entry.path().display()
                    )
                })?
                .is_file()
            {
                continue;
            }
            let file_name = record_entry.file_name().to_string_lossy().to_string();
            if !file_name
                .to_ascii_lowercase()
                .ends_with(ACTIVE_SOURCE_RECORD_SUFFIX)
            {
                continue;
            }
            let record = read_active_record(&record_entry.path())?;
            let owner = validate_owner_button_id(&record.owner_button_id)?;
            let panel_name = panel_entry.file_name().to_string_lossy().to_string();
            if !file_name.eq_ignore_ascii_case(&active_record_file_name(&owner))
                || !record.install_id.eq_ignore_ascii_case(&owner)
                || !record.program_id.eq_ignore_ascii_case(&manifest.program_id)
                || !record.program_name.eq_ignore_ascii_case(&manifest.label)
                || !record.panel_name.eq_ignore_ascii_case(&panel_name)
                || record.runner != manifest.runner.kind
            {
                return Err(format!(
                    "Active source record {} does not match its manifest-owned program/panel/owner location.",
                    record_entry.path().display()
                ));
            }
            if !owners.insert(owner.to_ascii_lowercase()) {
                return Err(format!(
                    "Program '{}' has multiple active source records for owner '{}'.",
                    manifest.label, owner
                ));
            }
            records.push(ActiveRecordEntry { file_name, record });
        }
    }
    records.sort_by(|left, right| {
        left.record
            .owner_button_id
            .to_ascii_lowercase()
            .cmp(&right.record.owner_button_id.to_ascii_lowercase())
    });
    Ok(records)
}

fn initialize_enabled_state_from_active(
    manifest: &ProgramManifest,
    records: &[ActiveRecordEntry],
) -> Result<EnabledProgramContributions, String> {
    let views = records
        .iter()
        .map(RecordMatchView::from)
        .collect::<Vec<_>>();
    let mut enabled_sources = Vec::new();
    for source in &manifest.bundled_sources {
        let existing = select_existing_record(source, &views)?;
        let index = match existing {
            ExistingMatch::Current(index) | ExistingMatch::Update(index) => index,
            ExistingMatch::Missing => continue,
        };
        enabled_sources.push(EnabledProgramContribution {
            source_id: source.id.clone(),
            panel_name: records[index].record.panel_name.clone(),
            version: source.version.clone(),
        });
    }
    Ok(EnabledProgramContributions {
        schema_version: 1,
        program_id: manifest.program_id.clone(),
        program_name: manifest.label.clone(),
        enabled_sources,
    })
}

fn plan_registered_program_sources(
    registered_programs: &[String],
    _include_starters: bool,
) -> Result<Vec<BundledSourcePlan>, String> {
    let mut plans = Vec::new();
    let mut claimed_owners = BTreeMap::<String, String>::new();
    let mut active_owners = BTreeMap::<String, (String, String)>::new();
    let mut inventories = Vec::new();
    for program_name in registered_programs {
        let manifest = load_program_manifest(program_name)?;
        let program_root = crate::resolve_program_directory(program_name)?;
        let records = load_active_records(&program_root, &manifest)?;
        let enabled_state = match load_enabled_program_contributions(&manifest)? {
            Some(state) => state,
            None => {
                let state = initialize_enabled_state_from_active(&manifest, &records)?;
                write_enabled_program_contributions(&manifest, state.clone())?;
                state
            }
        };
        let enabled_sources = enabled_state
            .enabled_sources
            .into_iter()
            .map(|source| (source.source_id.to_ascii_lowercase(), source))
            .collect::<BTreeMap<_, _>>();
        for entry in &records {
            let owner = entry.record.owner_button_id.to_ascii_lowercase();
            if let Some((previous_program, previous_label)) =
                active_owners.insert(owner, (manifest.label.clone(), entry.record.label.clone()))
            {
                return Err(format!(
                    "Active owner '{}' is duplicated by '{} / {}' and '{} / {}'. Refusing bundled-source synchronization.",
                    entry.record.owner_button_id,
                    previous_program,
                    previous_label,
                    manifest.label,
                    entry.record.label
                ));
            }
        }
        inventories.push(ProgramInventory {
            program_name: program_name.clone(),
            manifest,
            program_root,
            records,
            enabled_sources,
        });
    }
    for inventory in inventories {
        let ProgramInventory {
            program_name,
            manifest,
            program_root,
            records,
            enabled_sources,
        } = inventory;
        let views = records
            .iter()
            .map(RecordMatchView::from)
            .collect::<Vec<_>>();
        for source in &manifest.bundled_sources {
            let Some(enabled) = enabled_sources.get(&source.id.to_ascii_lowercase()) else {
                continue;
            };
            let mut source = source.clone();
            source.panel_name = enabled.panel_name.clone();
            let source_path = resolve_bundled_source_path(&program_root, &source)?;
            let action = match select_existing_record(&source, &views)? {
                ExistingMatch::Current(index) => PlannedAction::Current(records[index].clone()),
                ExistingMatch::Update(index) => PlannedAction::Update(records[index].clone()),
                ExistingMatch::Missing if should_install_missing(&source) => {
                    PlannedAction::Install(deterministic_bundled_owner_id(
                        &manifest.program_id,
                        &source.id,
                    ))
                }
                ExistingMatch::Missing => PlannedAction::Missing,
            };
            let claimed_owner = match &action {
                PlannedAction::Current(entry) | PlannedAction::Update(entry) => {
                    Some(entry.record.owner_button_id.clone())
                }
                PlannedAction::Install(owner) => Some(owner.clone()),
                PlannedAction::Missing => None,
            };
            if let Some(owner) = claimed_owner {
                if matches!(&action, PlannedAction::Install(_)) {
                    if let Some((record_program, record_label)) =
                        active_owners.get(&owner.to_ascii_lowercase())
                    {
                        return Err(format!(
                            "Bundled source '{}@{}' deterministic owner '{}' is already used by manual source '{} / {}'.",
                            source.id,
                            source.version,
                            owner,
                            record_program,
                            record_label
                        ));
                    }
                }
                let source_key = format!("{}@{}", source.id, source.version);
                if let Some(previous) =
                    claimed_owners.insert(owner.to_ascii_lowercase(), source_key.clone())
                {
                    return Err(format!(
                        "Bundled sources '{previous}' and '{source_key}' both claim owner '{owner}'. Refusing ambiguous synchronization."
                    ));
                }
            }
            plans.push(BundledSourcePlan {
                program_name: program_name.clone(),
                manifest: manifest.clone(),
                source,
                source_path,
                action,
            });
        }
    }
    Ok(plans)
}

fn synchronize_registered_program_sources(
    registered_programs: &[String],
    include_starters: bool,
) -> Result<SynchronizeBundledProgramSourcesResponse, String> {
    let plans = plan_registered_program_sources(registered_programs, include_starters)?;
    let mut sources = Vec::with_capacity(plans.len());
    for plan in plans {
        let attempted_operation = match &plan.action {
            PlannedAction::Current(_) | PlannedAction::Missing => "none",
            PlannedAction::Update(_) => "update",
            PlannedAction::Install(_) => "install",
        };
        let attempted_owner = match &plan.action {
            PlannedAction::Current(entry) | PlannedAction::Update(entry) => {
                Some(entry.record.owner_button_id.clone())
            }
            PlannedAction::Install(owner) => Some(owner.clone()),
            PlannedAction::Missing => None,
        };
        let outcome: Result<(&str, &str, String, Option<String>, Option<InstallButtonSourceResponse>), String> = match &plan.action {
            PlannedAction::Current(entry) => {
                super::execute::resolve_owned_source_paths(&plan.manifest, &entry.record).map(|_| {
                let owner = entry.record.owner_button_id.clone();
                (
                    "none",
                    "current",
                    format!(
                        "Bundled source '{}@{}' is current.",
                        plan.source.id, plan.source.version
                    ),
                    Some(owner),
                    Some(build_response(&entry.record, entry.file_name.clone())),
                )
                })
            }
            PlannedAction::Update(entry) => {
                let owner = entry.record.owner_button_id.clone();
                install_from_path(
                    InstallButtonSourceRequest {
                        owner_button_id: owner.clone(),
                        program_name: plan.program_name.clone(),
                        panel_name: plan.source.panel_name.clone(),
                        source_path: plan.source_path.to_string_lossy().to_string(),
                        import_kind: plan.source.import_kind.clone(),
                        bundled_source_id: Some(plan.source.id.clone()),
                        bundled_source_version: Some(plan.source.version.clone()),
                    },
                    true,
                ).map(|descriptor| (
                    "update",
                    "updated",
                    format!(
                        "Bundled source '{}@{}' updated its existing owner.",
                        plan.source.id, plan.source.version
                    ),
                    Some(owner),
                    Some(descriptor),
                ))
            }
            PlannedAction::Install(owner) => {
                install_from_path(
                    InstallButtonSourceRequest {
                        owner_button_id: owner.clone(),
                        program_name: plan.program_name.clone(),
                        panel_name: plan.source.panel_name.clone(),
                        source_path: plan.source_path.to_string_lossy().to_string(),
                        import_kind: plan.source.import_kind.clone(),
                        bundled_source_id: Some(plan.source.id.clone()),
                        bundled_source_version: Some(plan.source.version.clone()),
                    },
                    false,
                ).map(|descriptor| (
                    "install",
                    "installed",
                    format!(
                        "Bundled source '{}@{}' installed its deterministic owner.",
                        plan.source.id, plan.source.version
                    ),
                    Some(owner.clone()),
                    Some(descriptor),
                ))
            }
            PlannedAction::Missing => Ok((
                "none",
                "not-installed",
                format!(
                    "Bundled source '{}@{}' is not installed under the current synchronization policy.",
                    plan.source.id, plan.source.version,
                ),
                None,
                None,
            )),
        };
        let (operation, status, message, owner_button_id, descriptor) = match outcome {
            Ok(result) => result,
            Err(error) => (
                attempted_operation,
                "failed",
                format!(
                    "Bundled source '{}@{}' failed to synchronize: {error}",
                    plan.source.id, plan.source.version
                ),
                attempted_owner,
                None,
            ),
        };
        sources.push(BundledProgramSourceSyncResult {
            program_name: plan.program_name,
            program_id: plan.manifest.program_id,
            bundled_source_id: plan.source.id,
            bundled_source_version: plan.source.version,
            panel_name: plan.source.panel_name,
            import_kind: plan.source.import_kind,
            install_policy: if plan.source.install_if_missing {
                "required"
            } else if plan.source.install_on_add {
                "starter"
            } else {
                "manual"
            }
            .to_string(),
            operation: operation.to_string(),
            status: status.to_string(),
            message,
            owner_button_id,
            descriptor,
        });
    }
    Ok(SynchronizeBundledProgramSourcesResponse { sources })
}

#[tauri::command]
pub(crate) fn synchronize_bundled_program_sources(
    include_starters: Option<bool>,
    program_name: Option<String>,
) -> Result<SynchronizeBundledProgramSourcesResponse, String> {
    let lock = BUNDLED_SOURCE_SYNC_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Bundled-source synchronization lock was poisoned.".to_string())?;
    let registered_programs = crate::list_program_folders()?;
    let selected_programs = if let Some(requested) = program_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        let registered = registered_programs
            .iter()
            .find(|candidate| candidate.eq_ignore_ascii_case(&requested))
            .ok_or_else(|| format!("Program '{requested}' is not registered."))?;
        vec![registered.clone()]
    } else {
        registered_programs
    };
    synchronize_registered_program_sources(&selected_programs, include_starters.unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::{
        deterministic_bundled_owner_id, initialize_enabled_state_from_active,
        resolve_bundled_source_path, select_existing_record, should_install_missing,
        synchronize_registered_program_sources, ActiveRecordEntry, ExistingMatch, RecordMatchView,
    };
    use crate::program_sources::manifest::{BundledSourceManifest, ProgramManifest};
    use crate::program_sources::records::{validate_owner_button_id, ActiveSourceRecord};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn bundled_source() -> BundledSourceManifest {
        BundledSourceManifest {
            id: "example.page".to_string(),
            version: "2.0.0".to_string(),
            panel_name: "Tools".to_string(),
            source_path: "Example Git Scripts/Page".to_string(),
            import_kind: "script".to_string(),
            install_if_missing: true,
            install_on_add: false,
            display_label: String::new(),
            source_kind: String::new(),
            required: false,
            dependencies: Vec::new(),
            install_effects: Vec::new(),
            legacy_match_label: Some("Page".to_string()),
            legacy_match_kind: Some("script".to_string()),
        }
    }

    fn record(owner: &str, version: Option<&str>) -> RecordMatchView {
        RecordMatchView {
            owner_button_id: owner.to_string(),
            panel_name: "Tools".to_string(),
            label: "Page".to_string(),
            kind: "script".to_string(),
            source_display_leaf: "Page".to_string(),
            bundled_source_id: version.map(|_| "example.page".to_string()),
            bundled_source_version: version.map(str::to_string),
        }
    }

    fn temporary_root(name: &str) -> PathBuf {
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("flowcell-{name}-{}-{token}", std::process::id()))
    }

    #[test]
    fn deterministic_owner_ids_are_stable_and_valid() {
        let first = deterministic_bundled_owner_id("example", "example.page");
        let same = deterministic_bundled_owner_id("Example", "EXAMPLE.PAGE");
        let other = deterministic_bundled_owner_id("example", "example.other");
        assert_eq!(first, same);
        assert!(first.starts_with("bundled-example-example-page-"));
        assert_ne!(first, other);
        assert_eq!(validate_owner_button_id(&first).unwrap(), first);
    }

    #[test]
    fn legacy_matching_requires_migrated_owner_provenance() {
        let source = bundled_source();
        let records = vec![record("one", None), record("two", None)];
        assert_eq!(
            select_existing_record(&source, &records).unwrap(),
            ExistingMatch::Missing
        );

        let records = vec![
            record("button-migrated-one", None),
            record("button-migrated-two", None),
        ];
        assert!(select_existing_record(&source, &records).is_err());
    }

    #[test]
    fn equal_recorded_version_is_a_no_op_and_older_version_updates() {
        let source = bundled_source();
        assert_eq!(
            select_existing_record(&source, &[record("owner", Some("2.0.0"))]).unwrap(),
            ExistingMatch::Current(0)
        );
        assert_eq!(
            select_existing_record(&source, &[record("owner", Some("1.0.0"))]).unwrap(),
            ExistingMatch::Update(0)
        );
    }

    #[test]
    fn bundled_source_resolution_rejects_parent_escape() {
        let root = temporary_root("bundled-containment");
        let program_root = root.join("Program");
        fs::create_dir_all(&program_root).expect("create program root");
        fs::write(root.join("outside.jsx"), "// outside\n").expect("write outside source");
        let mut source = bundled_source();
        source.source_path = "../outside.jsx".to_string();
        assert!(resolve_bundled_source_path(&program_root, &source).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn empty_registered_selection_does_not_discover_available_packages() {
        let response = synchronize_registered_program_sources(&[], false).expect("empty sync");
        assert!(response.sources.is_empty());
    }

    #[test]
    fn starter_defaults_never_trigger_startup_repair() {
        let mut source = bundled_source();
        source.install_if_missing = false;
        source.install_on_add = true;
        assert!(!should_install_missing(&source));

        source.install_on_add = false;
        source.install_if_missing = true;
        assert!(should_install_missing(&source));
    }

    #[test]
    fn first_enabled_state_infers_only_an_existing_active_bundled_owner() {
        let manifest = serde_json::from_value::<ProgramManifest>(serde_json::json!({
            "schemaVersion": 1,
            "programId": "example",
            "label": "Example",
            "programType": "native",
            "defaultPanels": ["Tools"],
            "processNames": ["example.exe"],
            "gitScriptsFolder": "Example Git Scripts",
            "panelsFolder": "Panels",
            "localScriptsFolder": "Example Local Scripts",
            "supportScriptsFolder": "Support",
            "bundledSources": [{
                "id": "example.page",
                "version": "2.0.0",
                "panelName": "Tools",
                "sourcePath": "Example Git Scripts/Page",
                "importKind": "script",
                "installIfMissing": true
            }],
            "runner": { "kind": "file" }
        }))
        .expect("manifest schema");
        let empty = initialize_enabled_state_from_active(&manifest, &[]).expect("empty inference");
        assert!(empty.enabled_sources.is_empty());

        let source = manifest
            .bundled_sources
            .iter()
            .find(|source| source.id == "example.page")
            .expect("page declaration");
        let owner = deterministic_bundled_owner_id(&manifest.program_id, &source.id);
        let records = vec![ActiveRecordEntry {
            file_name: format!("{owner}.flowcell-source.json"),
            record: ActiveSourceRecord {
                schema_version: 1,
                owner_button_id: owner.clone(),
                install_id: owner,
                program_id: manifest.program_id.clone(),
                program_name: manifest.label.clone(),
                panel_name: source.panel_name.clone(),
                label: "Example Page".to_string(),
                tooltip: String::new(),
                kind: "script".to_string(),
                local_package_path: String::new(),
                source_path: String::new(),
                runner: manifest.runner.kind.clone(),
                runner_data: None,
                execution_target: None,
                bridge_action: String::new(),
                bridge_data: None,
                events: None,
                children: Vec::new(),
                layout: None,
                page: None,
                source_display_path: source.source_path.clone(),
                bundled_source_id: Some(source.id.clone()),
                bundled_source_version: Some("2.0.0".to_string()),
            },
        }];
        let inferred =
            initialize_enabled_state_from_active(&manifest, &records).expect("active inference");
        assert_eq!(inferred.enabled_sources.len(), 1);
        assert_eq!(inferred.enabled_sources[0].source_id, source.id);
        assert_eq!(inferred.enabled_sources[0].version, source.version);
    }
}
