use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static BUTTON_STATE_COMMIT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitButtonStateRequest {
    document: Value,
    expected_revision: u64,
    #[serde(default)]
    uninstall_owner_button_ids: Vec<String>,
    #[serde(default)]
    migration_token: Option<String>,
}

fn button_state_path() -> Result<PathBuf, String> {
    Ok(crate::resolve_flowcell_local_root()?
        .join("button-system")
        .join("button-state.json"))
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

fn temporary_sibling(path: &Path, suffix: &str) -> PathBuf {
    let token = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("button-state.json");
    path.with_file_name(format!(".{file_name}.{token}.{suffix}"))
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

fn atomic_write_json(path: &Path, document: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Button state path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;

    let content = serde_json::to_string_pretty(document)
        .map_err(|error| format!("Failed to serialize Button state: {error}"))?;
    let staged = temporary_sibling(path, "writing");
    let backup = temporary_sibling(path, "backup");
    fs::write(&staged, content)
        .map_err(|error| format!("Failed to stage {}: {error}", staged.display()))?;

    let had_existing = path.is_file();
    if had_existing {
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
        return Err(format!(
            "Failed to commit Button state at {}: {error}",
            path.display()
        ));
    }

    if had_existing {
        if let Err(recycle_error) = crate::recycle_file_path(&backup) {
            let failed_commit = temporary_sibling(path, "recycle-failed");
            if fs::rename(path, &failed_commit).is_ok() {
                if fs::rename(&backup, path).is_ok() {
                    let _ = fs::remove_file(&failed_commit);
                } else {
                    let _ = fs::rename(&failed_commit, path);
                }
            }
            return Err(format!(
                "Committed {}, but could not recycle its previous Button state: {recycle_error}",
                path.display()
            ));
        }
    }
    Ok(())
}

fn document_revision(document: &Value) -> Result<u64, String> {
    document
        .get("revision")
        .and_then(Value::as_u64)
        .ok_or_else(|| "Button state is missing a numeric revision.".to_string())
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

#[tauri::command]
pub(crate) fn load_button_state() -> Result<Option<Value>, String> {
    let path = button_state_path()?;
    if !path.is_file() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let document = serde_json::from_str::<Value>(&raw).map_err(|error| {
        format!(
            "Button state at {} is invalid JSON: {error}",
            path.display()
        )
    })?;
    validate_button_state(&document)?;
    Ok(Some(document))
}

#[tauri::command]
pub(crate) fn commit_button_state(request: CommitButtonStateRequest) -> Result<(), String> {
    let lock = BUTTON_STATE_COMMIT_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Button state commit lock is poisoned.".to_string())?;
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
    let previous_document = if state_path.is_file() {
        let raw = fs::read_to_string(&state_path)
            .map_err(|error| format!("Failed to read {}: {error}", state_path.display()))?;
        Some(serde_json::from_str::<Value>(&raw).map_err(|error| {
            format!(
                "Button state at {} is invalid JSON: {error}",
                state_path.display()
            )
        })?)
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
    let transaction_root = crate::resolve_flowcell_local_root()?
        .join("button-system")
        .join("quarantine")
        .join(format!(
            "commit-{}",
            temporary_sibling(&state_path, "tx")
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
        ));
    let mut quarantined = Vec::<crate::program_sources::QuarantinedOwnedSource>::new();
    for owner in &owner_ids {
        match crate::program_sources::quarantine_owned_source(owner, &transaction_root) {
            Ok(source) => quarantined.push(source),
            Err(error) => {
                let mut rollback_errors = Vec::new();
                for source in quarantined.iter().rev() {
                    if let Err(rollback_error) =
                        crate::program_sources::rollback_quarantined_source(source)
                    {
                        rollback_errors.push(rollback_error);
                    }
                }
                return Err(if rollback_errors.is_empty() {
                    error
                } else {
                    format!("{error} Rollback failed: {}", rollback_errors.join(" | "))
                });
            }
        }
    }

    if let Err(error) = atomic_write_json(&state_path, &request.document) {
        let mut rollback_errors = Vec::new();
        for source in quarantined.iter().rev() {
            if let Err(rollback_error) = crate::program_sources::rollback_quarantined_source(source)
            {
                rollback_errors.push(rollback_error);
            }
        }
        return Err(if rollback_errors.is_empty() {
            error
        } else {
            format!("{error} Rollback failed: {}", rollback_errors.join(" | "))
        });
    }

    if let Some(token) = request
        .migration_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if let Err(error) = crate::program_sources::finalize_migration_token(token) {
            let _ = restore_previous_state(&state_path, previous_document.as_ref());
            let mut rollback_errors = Vec::new();
            for candidate in quarantined.iter().rev() {
                if let Err(rollback_error) =
                    crate::program_sources::rollback_quarantined_source(candidate)
                {
                    rollback_errors.push(rollback_error);
                }
            }
            return Err(if rollback_errors.is_empty() {
                error
            } else {
                format!("{error} Rollback failed: {}", rollback_errors.join(" | "))
            });
        }
    }
    if transaction_root.is_dir() {
        if let Err(error) = crate::recycle_directory_path(&transaction_root) {
            let _ = restore_previous_state(&state_path, previous_document.as_ref());
            let mut rollback_errors = Vec::new();
            for source in quarantined.iter().rev() {
                if let Err(rollback_error) =
                    crate::program_sources::rollback_quarantined_source(source)
                {
                    rollback_errors.push(rollback_error);
                }
            }
            return Err(if rollback_errors.is_empty() {
                error
            } else {
                format!("{error} Rollback failed: {}", rollback_errors.join(" | "))
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{document_source_owners, validate_button_state};
    use serde_json::json;

    #[test]
    fn button_state_requires_positive_schema_version() {
        assert!(validate_button_state(&json!({ "schemaVersion": 1 })).is_ok());
        assert!(validate_button_state(&json!({ "schemaVersion": 0 })).is_err());
        assert!(validate_button_state(&json!({})).is_err());
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
}
