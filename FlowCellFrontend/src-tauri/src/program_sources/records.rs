use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

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
    #[serde(default)]
    pub source_display_path: String,
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

pub(crate) fn read_active_record(path: &Path) -> Result<ActiveSourceRecord, String> {
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

fn temporary_sibling(path: &Path) -> PathBuf {
    let token = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("record");
    path.with_file_name(format!(".{name}.{token}.writing"))
}

pub(crate) fn atomic_write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Failed to serialize {}: {error}", path.display()))?;
    let staged = temporary_sibling(path);
    fs::write(&staged, raw)
        .map_err(|error| format!("Failed to stage {}: {error}", staged.display()))?;
    if path.exists() {
        let _ = fs::remove_file(&staged);
        return Err(format!(
            "Refusing to overwrite existing owned record {}.",
            path.display()
        ));
    }
    fs::rename(&staged, path).map_err(|error| {
        let _ = fs::remove_file(&staged);
        format!("Failed to commit {}: {error}", path.display())
    })
}

pub(crate) fn atomic_replace_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Failed to serialize {}: {error}", path.display()))?;
    let staged = temporary_sibling(path);
    let backup = path.with_file_name(format!(
        ".{}.backup",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("record")
    ));
    fs::write(&staged, raw)
        .map_err(|error| format!("Failed to stage {}: {error}", staged.display()))?;
    let had_existing = path.is_file();
    if had_existing {
        if backup.exists() {
            let _ = fs::remove_file(&staged);
            return Err(format!(
                "A previous record replacement is still pending at {}.",
                backup.display()
            ));
        }
        fs::rename(path, &backup).map_err(|error| {
            let _ = fs::remove_file(&staged);
            format!(
                "Failed to prepare {} for replacement: {error}",
                path.display()
            )
        })?;
    }
    if let Err(error) = fs::rename(&staged, path) {
        if had_existing {
            let _ = fs::rename(&backup, path);
        }
        let _ = fs::remove_file(&staged);
        return Err(format!("Failed to replace {}: {error}", path.display()));
    }
    if had_existing {
        if let Err(recycle_error) = crate::recycle_file_path(&backup) {
            let failed_commit = temporary_sibling(path);
            if fs::rename(path, &failed_commit).is_ok() {
                if fs::rename(&backup, path).is_ok() {
                    let _ = fs::remove_file(&failed_commit);
                } else {
                    let _ = fs::rename(&failed_commit, path);
                }
            }
            return Err(format!(
                "Replaced {}, but could not recycle its previous owned record: {recycle_error}",
                path.display()
            ));
        }
    }
    Ok(())
}

pub(crate) fn empty_object() -> Value {
    Value::Object(Map::new())
}
