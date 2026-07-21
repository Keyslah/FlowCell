use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use super::transaction::{self, AtomicWriteMode};

pub(crate) const ACTIVE_SOURCE_RECORD_SUFFIX: &str = ".flowcell-source.json";
pub(crate) const INSTALL_RECORD_FILE_NAME: &str = "flowcell.install.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActiveSourceChild {
    pub slot: String,
    pub label: String,
    #[serde(default)]
    pub tooltip: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_target: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActiveSourceRecord {
    pub schema_version: u32,
    pub owner_button_id: String,
    pub install_id: String,
    pub program_id: String,
    pub program_name: String,
    pub panel_name: String,
    pub label: String,
    #[serde(default)]
    pub tooltip: String,
    pub kind: String,
    pub local_package_path: String,
    pub source_path: String,
    pub runner: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runner_data: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_target: Option<Value>,
    #[serde(default)]
    pub bridge_action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bridge_data: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub events: Option<BTreeMap<String, Value>>,
    #[serde(default)]
    pub children: Vec<ActiveSourceChild>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<super::installed_page::InstalledPageManifest>,
    #[serde(default)]
    pub source_display_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundled_source_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundled_source_version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalInstallRecord {
    pub schema_version: u32,
    pub owner_button_id: String,
    pub install_id: String,
    pub program_id: String,
    pub program_name: String,
    pub panel_name: String,
    pub source_relative_path: String,
    pub source_display_path: String,
    pub installed_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundled_source_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundled_source_version: Option<String>,
}

pub(crate) fn validate_owner_button_id(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return Err("ownerButtonId must contain 1 to 128 characters.".to_string());
    }
    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("ownerButtonId may contain only letters, numbers, '-' and '_'.".to_string());
    }
    Ok(trimmed.to_string())
}

pub(crate) fn active_record_file_name(owner_button_id: &str) -> String {
    format!("{owner_button_id}{ACTIVE_SOURCE_RECORD_SUFFIX}")
}

fn parse_active_record(path: &Path) -> Result<ActiveSourceRecord, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let record = serde_json::from_str::<ActiveSourceRecord>(&raw).map_err(|error| {
        format!(
            "Active source record {} is invalid: {error}",
            path.display()
        )
    })?;
    if record.schema_version != 1 {
        return Err(format!(
            "Active source record {} has unsupported schemaVersion {}.",
            path.display(),
            record.schema_version
        ));
    }
    validate_owner_button_id(&record.owner_button_id)?;
    Ok(record)
}

pub(crate) fn recover_active_record(path: &Path) -> Result<(), String> {
    transaction::recover_json_file(path, |candidate| parse_active_record(candidate).map(|_| ()))
}

fn active_record_name_from_artifact(file_name: &str) -> Option<String> {
    let lower = file_name.to_ascii_lowercase();
    if !lower.starts_with('.') {
        return None;
    }
    let suffix_start = lower.find(ACTIVE_SOURCE_RECORD_SUFFIX)?;
    let suffix_end = suffix_start + ACTIVE_SOURCE_RECORD_SUFFIX.len();
    let artifact_suffix = &lower[suffix_end..];
    if artifact_suffix != ".backup"
        && !(artifact_suffix.starts_with('.')
            && (artifact_suffix.ends_with(".writing")
                || artifact_suffix.ends_with(".backup")
                || artifact_suffix.ends_with(".recycle-failed")
                || artifact_suffix.ends_with(".corrupt")))
    {
        return None;
    }
    let canonical_name = &file_name[1..suffix_end];
    let owner = canonical_name.strip_suffix(ACTIVE_SOURCE_RECORD_SUFFIX)?;
    validate_owner_button_id(owner).ok()?;
    Some(canonical_name.to_string())
}

pub(crate) fn recover_active_records_in_directory(directory: &Path) -> Result<(), String> {
    if !directory.is_dir() {
        return Ok(());
    }
    let mut canonical_names = BTreeSet::new();
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("Failed to inspect {}: {error}", directory.display()))?
    {
        let entry =
            entry.map_err(|error| format!("Failed to inspect {}: {error}", directory.display()))?;
        if !entry.path().is_file() {
            continue;
        }
        if let Some(canonical_name) =
            active_record_name_from_artifact(&entry.file_name().to_string_lossy())
        {
            canonical_names.insert(canonical_name);
        }
    }
    for canonical_name in canonical_names {
        recover_active_record(&directory.join(canonical_name))?;
    }
    Ok(())
}

pub(crate) fn read_active_record(path: &Path) -> Result<ActiveSourceRecord, String> {
    transaction::read_json_file(path, parse_active_record)
}

pub(crate) fn atomic_write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Failed to serialize {}: {error}", path.display()))?;
    transaction::write_json_file(path, raw.as_bytes(), AtomicWriteMode::Create)
}

pub(crate) fn atomic_replace_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Failed to serialize {}: {error}", path.display()))?;
    transaction::write_json_file(path, raw.as_bytes(), AtomicWriteMode::Replace)
}

pub(crate) fn empty_object() -> Value {
    Value::Object(Map::new())
}

#[cfg(test)]
mod tests {
    use super::{recover_active_record, recover_active_records_in_directory};
    use serde_json::json;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn missing_active_record_is_recovered_from_legacy_fixed_backup() {
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "flowcell-active-record-recovery-{}-{token}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create recovery test root");
        let record_path = root.join("owner.flowcell-source.json");
        let backup_path = root.join(".owner.flowcell-source.json.backup");
        fs::write(
            &backup_path,
            serde_json::to_string(&json!({
                "schemaVersion": 1,
                "ownerButtonId": "owner",
                "installId": "owner",
                "programId": "program",
                "programName": "Program",
                "panelName": "Panel",
                "label": "Tool",
                "kind": "script",
                "localPackagePath": "local",
                "sourcePath": "source.py",
                "runner": "test"
            }))
            .expect("serialize backup"),
        )
        .expect("write backup");

        recover_active_record(&record_path).expect("recover active record");

        assert!(record_path.is_file());
        assert!(!backup_path.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn directory_recovery_discovers_hidden_active_record_artifacts() {
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "flowcell-active-record-sweep-{}-{token}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create recovery test root");
        let record_path = root.join("owner.flowcell-source.json");
        let backup_path = root.join(".owner.flowcell-source.json.1.backup");
        fs::write(
            &backup_path,
            serde_json::to_string(&json!({
                "schemaVersion": 1,
                "ownerButtonId": "owner",
                "installId": "owner",
                "programId": "program",
                "programName": "Program",
                "panelName": "Panel",
                "label": "Tool",
                "kind": "script",
                "localPackagePath": "local",
                "sourcePath": "source.py",
                "runner": "test"
            }))
            .expect("serialize backup"),
        )
        .expect("write backup");

        recover_active_records_in_directory(&root).expect("recover directory records");

        assert!(record_path.is_file());
        assert!(!backup_path.exists());
        let _ = fs::remove_dir_all(root);
    }
}
