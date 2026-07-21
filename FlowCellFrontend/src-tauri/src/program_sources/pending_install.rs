use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

use super::delete::UninstallButtonSourceRequest;
use super::manifest::load_program_manifest;
use super::records::{
    active_record_file_name, read_active_record, recover_active_record, validate_owner_button_id,
};
use super::transaction::{self, AtomicWriteMode};

const PENDING_INSTALL_FOLDER: &str = "pending-canonical-installs";
const PENDING_INSTALL_JOURNAL_FILE_NAME: &str = "pending-canonical-install.json";
const PENDING_INSTALL_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum PendingCanonicalInstallPhase {
    Prepared,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PendingCanonicalInstallJournal {
    schema_version: u32,
    phase: PendingCanonicalInstallPhase,
    owner_button_id: String,
    program_name: String,
    panel_name: String,
}

#[derive(Clone, Debug)]
struct CanonicalSourceIdentity {
    owner_button_id: String,
    program_name: String,
    panel_name: String,
    file_name: String,
}

#[derive(Clone, Debug)]
pub(crate) struct PreparedPendingCanonicalInstall {
    journal: PendingCanonicalInstallJournal,
}

#[cfg(windows)]
fn metadata_is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn metadata_is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

fn reject_link_or_reparse(path: &Path, subject: &str) -> Result<fs::Metadata, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to inspect {subject} {}: {error}", path.display()))?;
    if metadata.file_type().is_symlink() || metadata_is_reparse_point(&metadata) {
        return Err(format!(
            "Pending Button install {subject} cannot be a symbolic link or reparse point: {}.",
            path.display()
        ));
    }
    Ok(metadata)
}

fn ensure_strict_directory(path: &Path, create: bool, subject: &str) -> Result<bool, String> {
    if !path.exists() {
        if !create {
            return Ok(false);
        }
        fs::create_dir(path)
            .map_err(|error| format!("Failed to create {subject} {}: {error}", path.display()))?;
    }
    let metadata = reject_link_or_reparse(path, subject)?;
    if !metadata.is_dir() {
        return Err(format!(
            "Pending Button install {subject} is not a directory: {}.",
            path.display()
        ));
    }
    Ok(true)
}

fn pending_installs_root(create: bool) -> Result<PathBuf, String> {
    let local_root = crate::resolve_flowcell_local_root()?;
    if !local_root.is_dir() {
        return Err(format!(
            "FlowCell local root was not found at {}.",
            local_root.display()
        ));
    }
    reject_link_or_reparse(&local_root, "local root")?;
    let final_root = local_root
        .join("button-system")
        .join("transactions")
        .join(PENDING_INSTALL_FOLDER);
    let mut current = local_root;
    let mut missing = false;
    for (segment, subject) in [
        ("button-system", "Button system directory"),
        ("transactions", "transaction directory"),
        (PENDING_INSTALL_FOLDER, "pending-install directory"),
    ] {
        current = current.join(segment);
        if missing {
            continue;
        }
        if !ensure_strict_directory(&current, create, subject)? {
            missing = true;
        }
    }
    Ok(final_root)
}

fn owner_root(root: &Path, owner_button_id: &str, create: bool) -> Result<PathBuf, String> {
    let owner = validate_owner_button_id(owner_button_id)?;
    let path = root.join(&owner);
    if path.parent() != Some(root) {
        return Err("Pending Button install owner path escaped its transaction root.".to_string());
    }
    if root.is_dir() && !ensure_strict_directory(&path, create, "owner directory")? {
        return Ok(path);
    }
    Ok(path)
}

fn journal_path(owner_root: &Path) -> PathBuf {
    owner_root.join(PENDING_INSTALL_JOURNAL_FILE_NAME)
}

fn validate_journal(journal: &PendingCanonicalInstallJournal) -> Result<(), String> {
    if journal.schema_version != PENDING_INSTALL_SCHEMA_VERSION {
        return Err(format!(
            "Pending Button install has unsupported schemaVersion {}.",
            journal.schema_version
        ));
    }
    if journal.phase != PendingCanonicalInstallPhase::Prepared {
        return Err("Pending Button install is not in its prepared phase.".to_string());
    }
    validate_owner_button_id(&journal.owner_button_id)?;
    crate::validate_folder_name(&journal.program_name, "Program")?;
    crate::validate_folder_name(&journal.panel_name, "Panel")?;
    Ok(())
}

fn parse_journal(path: &Path) -> Result<PendingCanonicalInstallJournal, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let journal =
        serde_json::from_str::<PendingCanonicalInstallJournal>(&raw).map_err(|error| {
            format!(
                "Pending Button install journal {} is invalid: {error}",
                path.display()
            )
        })?;
    validate_journal(&journal)?;
    Ok(journal)
}

fn directory_is_empty(path: &Path) -> Result<bool, String> {
    Ok(fs::read_dir(path)
        .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?
        .next()
        .transpose()
        .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?
        .is_none())
}

fn validate_owner_directory_contents(owner_root: &Path) -> Result<(), String> {
    let mut entries = fs::read_dir(owner_root)
        .map_err(|error| format!("Failed to inspect {}: {error}", owner_root.display()))?;
    let Some(entry) = entries
        .next()
        .transpose()
        .map_err(|error| format!("Failed to inspect {}: {error}", owner_root.display()))?
    else {
        return Ok(());
    };
    if entry.file_name().to_string_lossy() != PENDING_INSTALL_JOURNAL_FILE_NAME
        || entries
            .next()
            .transpose()
            .map_err(|error| format!("Failed to inspect {}: {error}", owner_root.display()))?
            .is_some()
    {
        return Err(format!(
            "Pending Button install owner directory {} contains unrecognized artifacts.",
            owner_root.display()
        ));
    }
    let metadata = reject_link_or_reparse(&entry.path(), "journal")?;
    if !metadata.is_file() {
        return Err(format!(
            "Pending Button install journal is not a file: {}.",
            entry.path().display()
        ));
    }
    Ok(())
}

fn read_journal_at_root(
    root: &Path,
    owner_button_id: &str,
) -> Result<Option<PendingCanonicalInstallJournal>, String> {
    if !root.is_dir() {
        return Ok(None);
    }
    let owner_root = owner_root(root, owner_button_id, false)?;
    if !owner_root.is_dir() {
        return Ok(None);
    }
    let path = journal_path(&owner_root);
    if path.exists() {
        reject_link_or_reparse(&path, "journal")?;
    }
    transaction::recover_json_file(&path, |candidate| parse_journal(candidate).map(|_| ()))?;
    if !path.is_file() {
        if directory_is_empty(&owner_root)? {
            return Ok(None);
        }
        return Err(format!(
            "Pending Button install {} has artifacts but no recoverable journal.",
            owner_root.display()
        ));
    }
    validate_owner_directory_contents(&owner_root)?;
    let journal = parse_journal(&path)?;
    if !journal
        .owner_button_id
        .eq_ignore_ascii_case(owner_button_id)
    {
        return Err(format!(
            "Pending Button install journal owner '{}' does not match directory owner '{}'.",
            journal.owner_button_id, owner_button_id
        ));
    }
    Ok(Some(journal))
}

fn write_journal_at_root(
    root: &Path,
    journal: &PendingCanonicalInstallJournal,
) -> Result<(), String> {
    validate_journal(journal)?;
    ensure_strict_directory(root, true, "pending-install directory")?;
    let owner_root = owner_root(root, &journal.owner_button_id, true)?;
    if let Some(existing) = read_journal_at_root(root, &journal.owner_button_id)? {
        return if existing == *journal {
            Ok(())
        } else {
            Err(format!(
                "Button '{}' already has a different pending canonical install.",
                journal.owner_button_id
            ))
        };
    }
    let raw = serde_json::to_string_pretty(journal)
        .map_err(|error| format!("Failed to serialize pending Button install: {error}"))?;
    transaction::write_json_file(
        &journal_path(&owner_root),
        raw.as_bytes(),
        AtomicWriteMode::Create,
    )
}

fn discard_journal_at_root(
    root: &Path,
    owner_button_id: &str,
    expected: Option<&PendingCanonicalInstallJournal>,
) -> Result<(), String> {
    if !root.is_dir() {
        return Ok(());
    }
    let owner_root = owner_root(root, owner_button_id, false)?;
    if !owner_root.exists() {
        return Ok(());
    }
    let actual = read_journal_at_root(root, owner_button_id)?;
    if let Some(expected) = expected {
        if actual.as_ref() != Some(expected) {
            return Err(format!(
                "Pending canonical install for Button '{}' changed before finalization.",
                owner_button_id
            ));
        }
    }
    fs::remove_dir_all(&owner_root).map_err(|error| {
        format!(
            "Failed to discard pending Button install {}: {error}",
            owner_root.display()
        )
    })
}

fn required_identity_field<'a>(
    identity: &'a serde_json::Map<String, Value>,
    owner: &str,
    field: &str,
) -> Result<&'a str, String> {
    identity
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Button '{owner}' sourceIdentity is missing {field}."))
}

fn canonical_source_identities(document: &Value) -> Result<Vec<CanonicalSourceIdentity>, String> {
    let buttons = document
        .get("buttons")
        .and_then(Value::as_object)
        .ok_or_else(|| "Button state is missing its buttons object.".to_string())?;
    let mut identities = Vec::<CanonicalSourceIdentity>::new();
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
        let Some(source_identity) = button
            .get("sourceIdentity")
            .filter(|value| !value.is_null())
        else {
            continue;
        };
        let owner_button_id = validate_owner_button_id(button_id)?;
        if identities.iter().any(|identity| {
            identity
                .owner_button_id
                .eq_ignore_ascii_case(&owner_button_id)
        }) {
            return Err(format!(
                "Canonical Button state contains duplicate source owner '{owner_button_id}'."
            ));
        }
        let identity = source_identity
            .as_object()
            .ok_or_else(|| format!("Button '{button_id}' has an invalid sourceIdentity."))?;
        identities.push(CanonicalSourceIdentity {
            owner_button_id,
            program_name: required_identity_field(identity, button_id, "displayProgramName")?
                .to_string(),
            panel_name: required_identity_field(identity, button_id, "displayPanelName")?
                .to_string(),
            file_name: required_identity_field(identity, button_id, "displayFileName")?.to_string(),
        });
    }
    identities.sort_by_key(|identity| identity.owner_button_id.to_ascii_lowercase());
    Ok(identities)
}

fn validate_canonical_identity(
    journal: &PendingCanonicalInstallJournal,
    identity: &CanonicalSourceIdentity,
) -> Result<(), String> {
    let expected_file_name = active_record_file_name(&journal.owner_button_id);
    if !identity
        .owner_button_id
        .eq_ignore_ascii_case(&journal.owner_button_id)
        || !identity
            .program_name
            .eq_ignore_ascii_case(&journal.program_name)
        || !identity
            .panel_name
            .eq_ignore_ascii_case(&journal.panel_name)
        || !identity.file_name.eq_ignore_ascii_case(&expected_file_name)
    {
        return Err(format!(
            "Canonical Button '{}' source identity does not match its pending install intent.",
            journal.owner_button_id
        ));
    }
    Ok(())
}

fn resolve_exact_active_source(
    journal: &PendingCanonicalInstallJournal,
) -> Result<Option<String>, String> {
    let registered_program = crate::require_registered_program_name(&journal.program_name)?;
    if !registered_program.eq_ignore_ascii_case(&journal.program_name) {
        return Err(format!(
            "Pending Button install program '{}' changed identity.",
            journal.program_name
        ));
    }
    let manifest = load_program_manifest(&registered_program)?;
    if !manifest.label.eq_ignore_ascii_case(&journal.program_name) {
        return Err(format!(
            "Pending Button install program '{}' does not match its manifest label '{}'.",
            journal.program_name, manifest.label
        ));
    }
    let panel_name = crate::validate_folder_name(&journal.panel_name, "Panel")?;
    let panel_root = crate::resolve_panel_directory(&registered_program, &panel_name)?;
    reject_link_or_reparse(&panel_root, "panel directory")?;
    let file_name = active_record_file_name(&journal.owner_button_id);
    let record_path = panel_root.join(&file_name);
    if !record_path.exists() {
        recover_active_record(&record_path)?;
    }
    if !record_path.exists() {
        return Ok(None);
    }
    reject_link_or_reparse(&record_path, "active source record")?;
    recover_active_record(&record_path)?;
    if !record_path.is_file() {
        return Ok(None);
    }
    let record = read_active_record(&record_path)?;
    if !record
        .owner_button_id
        .eq_ignore_ascii_case(&journal.owner_button_id)
        || !record
            .install_id
            .eq_ignore_ascii_case(&journal.owner_button_id)
        || !record.program_id.eq_ignore_ascii_case(&manifest.program_id)
        || !record.program_name.eq_ignore_ascii_case(&manifest.label)
        || !record.panel_name.eq_ignore_ascii_case(&panel_name)
        || record.runner != manifest.runner.kind
    {
        return Err(format!(
            "Active source record for Button '{}' does not match its pending install intent.",
            journal.owner_button_id
        ));
    }
    super::execute::resolve_owned_source_paths(&manifest, &record)?;
    Ok(Some(file_name))
}

fn recover_pending_installs_at_root_with<L, U>(
    root: &Path,
    current_document: Option<&Value>,
    mut locate: L,
    mut uninstall: U,
) -> Result<usize, String>
where
    L: FnMut(&PendingCanonicalInstallJournal) -> Result<Option<String>, String>,
    U: FnMut(&PendingCanonicalInstallJournal, &str) -> Result<(), String>,
{
    if !root.is_dir() {
        return Ok(0);
    }
    ensure_strict_directory(root, false, "pending-install directory")?;
    let identities = current_document
        .map(canonical_source_identities)
        .transpose()?
        .unwrap_or_default();
    let mut owners = Vec::new();
    for entry in fs::read_dir(root)
        .map_err(|error| format!("Failed to inspect {}: {error}", root.display()))?
    {
        let entry =
            entry.map_err(|error| format!("Failed to inspect {}: {error}", root.display()))?;
        let owner = entry.file_name().to_string_lossy().to_string();
        validate_owner_button_id(&owner)?;
        let expected = owner_root(root, &owner, false)?;
        if entry.path() != expected {
            return Err(format!(
                "Pending Button install entry escaped its transaction root: {}.",
                entry.path().display()
            ));
        }
        let metadata = reject_link_or_reparse(&entry.path(), "owner directory")?;
        if !metadata.is_dir() {
            return Err(format!(
                "Pending Button install root contains a non-directory entry: {}.",
                entry.path().display()
            ));
        }
        owners.push(owner);
    }
    owners.sort_by_key(|owner| owner.to_ascii_lowercase());

    let mut recovered = 0usize;
    for owner in owners {
        let Some(journal) = read_journal_at_root(root, &owner)? else {
            discard_journal_at_root(root, &owner, None)?;
            recovered += 1;
            continue;
        };
        if let Some(identity) = identities.iter().find(|identity| {
            identity
                .owner_button_id
                .eq_ignore_ascii_case(&journal.owner_button_id)
        }) {
            validate_canonical_identity(&journal, identity)?;
            discard_journal_at_root(root, &owner, Some(&journal))?;
            recovered += 1;
            continue;
        }
        if let Some(file_name) = locate(&journal)? {
            if !file_name.eq_ignore_ascii_case(&active_record_file_name(&journal.owner_button_id)) {
                return Err(format!(
                    "Pending Button install source locator returned an unexpected record for '{}'.",
                    journal.owner_button_id
                ));
            }
            uninstall(&journal, &file_name)?;
        }
        discard_journal_at_root(root, &owner, Some(&journal))?;
        recovered += 1;
    }
    Ok(recovered)
}

pub(crate) fn prepare_pending_canonical_install(
    program_name: &str,
    panel_name: &str,
    owner_button_id: &str,
) -> Result<(), String> {
    let journal = PendingCanonicalInstallJournal {
        schema_version: PENDING_INSTALL_SCHEMA_VERSION,
        phase: PendingCanonicalInstallPhase::Prepared,
        owner_button_id: validate_owner_button_id(owner_button_id)?,
        program_name: crate::validate_folder_name(program_name, "Program")?,
        panel_name: crate::validate_folder_name(panel_name, "Panel")?,
    };
    let root = pending_installs_root(true)?;
    write_journal_at_root(&root, &journal)
}

pub(crate) fn prepare_pending_canonical_finalizations(
    document: &Value,
) -> Result<Vec<PreparedPendingCanonicalInstall>, String> {
    let root = pending_installs_root(false)?;
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut prepared = Vec::new();
    for identity in canonical_source_identities(document)? {
        let Some(journal) = read_journal_at_root(&root, &identity.owner_button_id)? else {
            continue;
        };
        validate_canonical_identity(&journal, &identity)?;
        if resolve_exact_active_source(&journal)?.is_none() {
            return Err(format!(
                "Button '{}' has a pending canonical install but no exact active source record.",
                journal.owner_button_id
            ));
        }
        prepared.push(PreparedPendingCanonicalInstall { journal });
    }
    Ok(prepared)
}

pub(crate) fn finalize_prepared_pending_canonical_installs(
    prepared: &[PreparedPendingCanonicalInstall],
) -> Vec<String> {
    if prepared.is_empty() {
        return Vec::new();
    }
    let root = match pending_installs_root(false) {
        Ok(root) => root,
        Err(error) => return vec![error],
    };
    prepared
        .iter()
        .filter_map(|entry| {
            discard_journal_at_root(&root, &entry.journal.owner_button_id, Some(&entry.journal))
                .err()
        })
        .collect()
}

pub(crate) fn clear_pending_canonical_install(owner_button_id: &str) -> Result<(), String> {
    let owner = validate_owner_button_id(owner_button_id)?;
    let root = pending_installs_root(false)?;
    discard_journal_at_root(&root, &owner, None)
}

pub(crate) fn recover_pending_canonical_installs_on_startup(
    app: &tauri::AppHandle,
) -> Result<usize, String> {
    let current_document = crate::button_state::load_button_state()?;
    let root = pending_installs_root(false)?;
    recover_pending_installs_at_root_with(
        &root,
        current_document.as_ref(),
        resolve_exact_active_source,
        |journal, file_name| {
            super::delete::uninstall_button_source(
                app.clone(),
                UninstallButtonSourceRequest {
                    owner_button_id: journal.owner_button_id.clone(),
                    program_name: journal.program_name.clone(),
                    panel_name: journal.panel_name.clone(),
                    file_name: file_name.to_string(),
                },
            )
            .map(|_| ())
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{
        read_journal_at_root, recover_pending_installs_at_root_with, write_journal_at_root,
        PendingCanonicalInstallJournal, PendingCanonicalInstallPhase,
        PENDING_INSTALL_JOURNAL_FILE_NAME, PENDING_INSTALL_SCHEMA_VERSION,
    };
    use serde_json::json;
    use std::cell::Cell;
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
                "flowcell-pending-install-{label}-{}-{token}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create pending-install test root");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn owner(&self, owner: &str) -> PathBuf {
            self.0.join(owner)
        }
    }

    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn journal(owner: &str) -> PendingCanonicalInstallJournal {
        PendingCanonicalInstallJournal {
            schema_version: PENDING_INSTALL_SCHEMA_VERSION,
            phase: PendingCanonicalInstallPhase::Prepared,
            owner_button_id: owner.to_string(),
            program_name: "Windows".to_string(),
            panel_name: "Files".to_string(),
        }
    }

    fn canonical(owner: &str) -> serde_json::Value {
        json!({
            "schemaVersion": 1,
            "revision": 3,
            "buttons": {
                owner: {
                    "sourceIdentity": {
                        "displayProgramName": "Windows",
                        "displayPanelName": "Files",
                        "displayFileName": format!("{owner}.flowcell-source.json")
                    }
                }
            }
        })
    }

    #[test]
    fn committed_canonical_owner_discards_the_prepared_intent_without_uninstalling() {
        let root = TestRoot::new("canonical-commit");
        write_journal_at_root(root.path(), &journal("owner-one")).expect("write journal");
        let recovered = recover_pending_installs_at_root_with(
            root.path(),
            Some(&canonical("owner-one")),
            |_| panic!("committed source must not be located for uninstall"),
            |_, _| panic!("committed source must not be uninstalled"),
        )
        .expect("recover committed canonical install");
        assert_eq!(recovered, 1);
        assert!(!root.owner("owner-one").exists());
    }

    #[test]
    fn missing_canonical_commit_uses_the_exact_active_source_uninstall() {
        let root = TestRoot::new("missing-canonical");
        write_journal_at_root(root.path(), &journal("owner-two")).expect("write journal");
        let locate_calls = Cell::new(0);
        let uninstall_calls = Cell::new(0);
        let document = json!({"schemaVersion":1,"revision":2,"buttons":{}});
        let recovered = recover_pending_installs_at_root_with(
            root.path(),
            Some(&document),
            |intent| {
                locate_calls.set(locate_calls.get() + 1);
                assert_eq!(intent.program_name, "Windows");
                assert_eq!(intent.panel_name, "Files");
                Ok(Some("owner-two.flowcell-source.json".to_string()))
            },
            |intent, file_name| {
                uninstall_calls.set(uninstall_calls.get() + 1);
                assert_eq!(intent.owner_button_id, "owner-two");
                assert_eq!(file_name, "owner-two.flowcell-source.json");
                Ok(())
            },
        )
        .expect("recover missing canonical commit");
        assert_eq!(recovered, 1);
        assert_eq!(locate_calls.get(), 1);
        assert_eq!(uninstall_calls.get(), 1);
        assert!(!root.owner("owner-two").exists());
    }

    #[test]
    fn interrupted_install_without_an_active_source_discards_only_the_intent() {
        let root = TestRoot::new("no-active-source");
        write_journal_at_root(root.path(), &journal("owner-three")).expect("write journal");
        let uninstall_calls = Cell::new(0);
        let recovered = recover_pending_installs_at_root_with(
            root.path(),
            None,
            |_| Ok(None),
            |_, _| {
                uninstall_calls.set(uninstall_calls.get() + 1);
                Ok(())
            },
        )
        .expect("recover interrupted native install");
        assert_eq!(recovered, 1);
        assert_eq!(uninstall_calls.get(), 0);
        assert!(!root.owner("owner-three").exists());
    }

    #[test]
    fn mismatched_canonical_identity_fails_closed_and_retains_the_journal() {
        let root = TestRoot::new("identity-mismatch");
        write_journal_at_root(root.path(), &journal("owner-four")).expect("write journal");
        let mut document = canonical("owner-four");
        document["buttons"]["owner-four"]["sourceIdentity"]["displayPanelName"] = json!("Utility");
        let error = recover_pending_installs_at_root_with(
            root.path(),
            Some(&document),
            |_| Ok(None),
            |_, _| Ok(()),
        )
        .expect_err("mismatched identity must fail");
        assert!(error.contains("does not match"));
        assert!(root.owner("owner-four").is_dir());
    }

    #[test]
    fn journal_schema_rejects_unknown_fields() {
        let root = TestRoot::new("strict-schema");
        let owner_root = root.owner("owner-five");
        fs::create_dir(&owner_root).expect("create owner root");
        fs::write(
            owner_root.join(PENDING_INSTALL_JOURNAL_FILE_NAME),
            r#"{
                "schemaVersion": 1,
                "phase": "prepared",
                "ownerButtonId": "owner-five",
                "programName": "Windows",
                "panelName": "Files",
                "unexpected": true
            }"#,
        )
        .expect("write invalid journal");
        let error = read_journal_at_root(root.path(), "owner-five")
            .expect_err("unknown field must be rejected");
        assert!(error.contains("unknown field"));
    }
}
