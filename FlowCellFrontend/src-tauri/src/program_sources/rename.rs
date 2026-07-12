use super::manifest::{load_program_manifest, ProgramManifest};
use super::records::{
    active_record_file_name, read_active_record, ActiveSourceRecord, LocalInstallRecord,
    ACTIVE_SOURCE_RECORD_SUFFIX, INSTALL_RECORD_FILE_NAME,
};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

struct OwnedRecordUpdate {
    active_path: PathBuf,
    active_record: ActiveSourceRecord,
    install_path: PathBuf,
    install_record: LocalInstallRecord,
}

struct JsonReplacement {
    path: PathBuf,
    raw: String,
}

impl JsonReplacement {
    fn new<T: Serialize>(path: PathBuf, value: &T) -> Result<Self, String> {
        Ok(Self {
            raw: serde_json::to_string_pretty(value)
                .map_err(|error| format!("Failed to serialize {}: {error}", path.display()))?,
            path,
        })
    }
}

fn names_match(left: &str, right: &str) -> bool {
    left.trim().eq_ignore_ascii_case(right.trim())
}

fn replace_program_root_prefix(value: &str, previous_root: &Path, next_root: &Path) -> String {
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

fn normalized_path_text(value: &str) -> String {
    value
        .trim()
        .strip_prefix(r"\\?\")
        .unwrap_or(value.trim())
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn path_text_matches(value: &str, expected: &Path) -> bool {
    normalized_path_text(value) == normalized_path_text(&expected.to_string_lossy())
}

fn safe_relative_source_path(value: &str) -> bool {
    let path = Path::new(value);
    !path.is_absolute()
        && !path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
}

fn rewrite_identity_field(
    object: &mut serde_json::Map<String, Value>,
    key: &str,
    previous: &str,
    next: &str,
) {
    if object
        .get(key)
        .and_then(Value::as_str)
        .is_some_and(|current| names_match(current, previous))
    {
        object.insert(key.to_string(), Value::String(next.to_string()));
    }
}

fn rewrite_execution_target(
    target: &mut Value,
    previous_program: &str,
    next_program: &str,
    previous_panel: Option<&str>,
    next_panel: Option<&str>,
) {
    let Some(object) = target.as_object_mut() else {
        return;
    };
    match object.get("kind").and_then(Value::as_str) {
        Some("panel-script" | "tool-set-action") => {
            rewrite_identity_field(object, "programName", previous_program, next_program);
            if let (Some(previous), Some(next)) = (previous_panel, next_panel) {
                rewrite_identity_field(object, "panelName", previous, next);
            }
        }
        Some("core-action") => {
            let Some(payload) = object.get_mut("payload").and_then(Value::as_object_mut) else {
                return;
            };
            rewrite_identity_field(payload, "programName", previous_program, next_program);
            if let (Some(previous), Some(next)) = (previous_panel, next_panel) {
                rewrite_identity_field(payload, "panelName", previous, next);
            }
        }
        _ => {}
    }
}

fn rewrite_optional_execution_target(
    target: &mut Option<Value>,
    previous_program: &str,
    next_program: &str,
    previous_panel: Option<&str>,
    next_panel: Option<&str>,
) {
    if let Some(target) = target {
        rewrite_execution_target(
            target,
            previous_program,
            next_program,
            previous_panel,
            next_panel,
        );
    }
}

fn rewrite_layout_service_targets(
    layout: &mut Option<Value>,
    previous_program: &str,
    next_program: &str,
    previous_panel: Option<&str>,
    next_panel: Option<&str>,
) {
    let Some(fields) = layout
        .as_mut()
        .and_then(Value::as_object_mut)
        .and_then(|object| object.get_mut("fields"))
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    for field in fields {
        let Some(target) = field
            .as_object_mut()
            .and_then(|object| object.get_mut("serviceTarget"))
        else {
            continue;
        };
        rewrite_execution_target(
            target,
            previous_program,
            next_program,
            previous_panel,
            next_panel,
        );
    }
}

fn active_record_paths(panel_root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::new();
    for entry in fs::read_dir(panel_root)
        .map_err(|error| format!("Failed to read {}: {error}", panel_root.display()))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to inspect {}: {error}", panel_root.display()))?;
        if !entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?
            .is_file()
        {
            continue;
        }
        let path = entry.path();
        if path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|name| {
                name.to_ascii_lowercase()
                    .ends_with(ACTIVE_SOURCE_RECORD_SUFFIX)
            })
        {
            paths.push(path);
        }
    }
    paths.sort();
    Ok(paths)
}

fn prepare_panel_updates(
    program_root: &Path,
    manifest: &ProgramManifest,
    panel_root: &Path,
    previous_program: &str,
    next_program: &str,
    previous_panel: &str,
    next_panel: &str,
    previous_root: Option<&Path>,
    next_root: Option<&Path>,
) -> Result<Vec<OwnedRecordUpdate>, String> {
    let mut updates = Vec::new();
    for active_path in active_record_paths(panel_root)? {
        let mut active_record = read_active_record(&active_path)?;
        let owner_button_id =
            super::records::validate_owner_button_id(&active_record.owner_button_id)?;
        if !active_record
            .program_id
            .eq_ignore_ascii_case(&manifest.program_id)
            || !active_record
                .install_id
                .eq_ignore_ascii_case(&owner_button_id)
            || !active_path
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| {
                    name.eq_ignore_ascii_case(&active_record_file_name(&owner_button_id))
                })
            || (!names_match(&active_record.program_name, previous_program)
                && !names_match(&active_record.program_name, next_program))
            || (!names_match(&active_record.panel_name, previous_panel)
                && !names_match(&active_record.panel_name, next_panel))
            || active_record.runner != manifest.runner.kind
        {
            return Err(format!(
                "Active source record {} does not match its stable Button owner.",
                active_path.display()
            ));
        }

        let package_root = program_root
            .join(&manifest.local_scripts_folder)
            .join(&owner_button_id);
        if !package_root.is_dir() {
            return Err(format!(
                "Owned Local Scripts package was not found at {}.",
                package_root.display()
            ));
        }
        let install_path = package_root.join(INSTALL_RECORD_FILE_NAME);
        let install_raw = fs::read_to_string(&install_path)
            .map_err(|error| format!("Failed to read {}: {error}", install_path.display()))?;
        let mut install_record =
            serde_json::from_str::<LocalInstallRecord>(&install_raw).map_err(|error| {
                format!(
                    "Installed package record {} is invalid: {error}",
                    install_path.display()
                )
            })?;
        if install_record.schema_version != 1
            || !install_record
                .owner_button_id
                .eq_ignore_ascii_case(&owner_button_id)
            || !install_record
                .install_id
                .eq_ignore_ascii_case(&owner_button_id)
            || !install_record
                .program_id
                .eq_ignore_ascii_case(&manifest.program_id)
            || (!names_match(&install_record.program_name, previous_program)
                && !names_match(&install_record.program_name, next_program))
            || (!names_match(&install_record.panel_name, previous_panel)
                && !names_match(&install_record.panel_name, next_panel))
            || !safe_relative_source_path(&install_record.source_relative_path)
        {
            return Err(format!(
                "Installed package record {} does not match its stable Button owner.",
                install_path.display()
            ));
        }
        let source_path = package_root.join(&install_record.source_relative_path);
        if !source_path.is_file() {
            return Err(format!(
                "Installed Button source was not found at {}.",
                source_path.display()
            ));
        }
        let previous_package_root = previous_root
            .map(|root| {
                root.join(&manifest.local_scripts_folder)
                    .join(&owner_button_id)
            })
            .unwrap_or_else(|| package_root.clone());
        let previous_source_path = previous_package_root.join(&install_record.source_relative_path);
        if (!path_text_matches(&active_record.local_package_path, &package_root)
            && !path_text_matches(&active_record.local_package_path, &previous_package_root))
            || (!path_text_matches(&active_record.source_path, &source_path)
                && !path_text_matches(&active_record.source_path, &previous_source_path))
        {
            return Err(format!(
                "Active source record {} points outside its owned Local Scripts package.",
                active_path.display()
            ));
        }

        active_record.program_name = next_program.to_string();
        active_record.panel_name = next_panel.to_string();
        active_record.local_package_path = package_root.to_string_lossy().to_string();
        active_record.source_path = source_path.to_string_lossy().to_string();
        if let (Some(previous), Some(next)) = (previous_root, next_root) {
            active_record.source_display_path =
                replace_program_root_prefix(&active_record.source_display_path, previous, next);
            install_record.source_display_path =
                replace_program_root_prefix(&install_record.source_display_path, previous, next);
        }
        rewrite_optional_execution_target(
            &mut active_record.execution_target,
            previous_program,
            next_program,
            Some(previous_panel),
            Some(next_panel),
        );
        rewrite_layout_service_targets(
            &mut active_record.layout,
            previous_program,
            next_program,
            Some(previous_panel),
            Some(next_panel),
        );
        for child in &mut active_record.children {
            rewrite_optional_execution_target(
                &mut child.execution_target,
                previous_program,
                next_program,
                Some(previous_panel),
                Some(next_panel),
            );
        }
        install_record.program_name = next_program.to_string();
        install_record.panel_name = next_panel.to_string();
        updates.push(OwnedRecordUpdate {
            active_path,
            active_record,
            install_path,
            install_record,
        });
    }
    Ok(updates)
}

fn owned_replacements(updates: Vec<OwnedRecordUpdate>) -> Result<Vec<JsonReplacement>, String> {
    let mut replacements = Vec::new();
    for update in updates {
        replacements.push(JsonReplacement::new(
            update.install_path,
            &update.install_record,
        )?);
        replacements.push(JsonReplacement::new(
            update.active_path,
            &update.active_record,
        )?);
    }
    Ok(replacements)
}

fn rollback_json_batch(
    replacements: &[JsonReplacement],
    backups: &[PathBuf],
    transaction_root: &Path,
    committed: usize,
) -> Vec<String> {
    let mut errors = Vec::new();
    for index in (0..committed).rev() {
        let discard = transaction_root.join(format!("discard-{index}.json"));
        if replacements[index].path.is_file() {
            if let Err(error) = fs::rename(&replacements[index].path, &discard) {
                errors.push(format!(
                    "Failed to move new {} aside: {error}",
                    replacements[index].path.display()
                ));
                continue;
            }
        }
        if let Err(error) = fs::rename(&backups[index], &replacements[index].path) {
            errors.push(format!(
                "Failed to restore {}: {error}",
                replacements[index].path.display()
            ));
        }
    }
    errors
}

fn apply_json_batch(program_root: &Path, replacements: Vec<JsonReplacement>) -> Result<(), String> {
    apply_json_batch_inner(program_root, replacements, None)
}

fn apply_json_batch_inner(
    program_root: &Path,
    replacements: Vec<JsonReplacement>,
    forced_failure_index: Option<usize>,
) -> Result<(), String> {
    if replacements.is_empty() {
        return Ok(());
    }
    let mut seen = HashSet::new();
    for replacement in &replacements {
        let key = normalized_path_text(&replacement.path.to_string_lossy());
        if !seen.insert(key) {
            return Err(format!(
                "Rename transaction contains duplicate path {}.",
                replacement.path.display()
            ));
        }
        if !replacement.path.is_file() {
            return Err(format!(
                "Rename transaction source was not found at {}.",
                replacement.path.display()
            ));
        }
    }
    let token = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let transaction_root = program_root.join(format!(".flowcell-source-rename-{token}"));
    fs::create_dir(&transaction_root).map_err(|error| {
        format!(
            "Failed to create rename transaction {}: {error}",
            transaction_root.display()
        )
    })?;
    let stages = replacements
        .iter()
        .enumerate()
        .map(|(index, _)| transaction_root.join(format!("new-{index}.json")))
        .collect::<Vec<_>>();
    let backups = replacements
        .iter()
        .enumerate()
        .map(|(index, _)| transaction_root.join(format!("old-{index}.json")))
        .collect::<Vec<_>>();
    for (index, replacement) in replacements.iter().enumerate() {
        if let Err(error) = fs::write(&stages[index], &replacement.raw) {
            let _ = fs::remove_dir_all(&transaction_root);
            return Err(format!(
                "Failed to stage replacement for {}: {error}",
                replacement.path.display()
            ));
        }
    }

    let mut committed = 0usize;
    for index in 0..replacements.len() {
        if forced_failure_index == Some(index) {
            let rollback_errors =
                rollback_json_batch(&replacements, &backups, &transaction_root, committed);
            let _ = fs::remove_dir_all(&transaction_root);
            return Err(if rollback_errors.is_empty() {
                format!("Forced rename transaction failure at replacement {index}.")
            } else {
                format!(
                    "Forced rename transaction failure at replacement {index}. Rollback failed: {}",
                    rollback_errors.join(" | ")
                )
            });
        }
        if let Err(error) = fs::rename(&replacements[index].path, &backups[index]) {
            let rollback_errors =
                rollback_json_batch(&replacements, &backups, &transaction_root, committed);
            let _ = fs::remove_dir_all(&transaction_root);
            return Err(if rollback_errors.is_empty() {
                format!(
                    "Failed to prepare {} for rename migration: {error}",
                    replacements[index].path.display()
                )
            } else {
                format!(
                    "Failed to prepare {} for rename migration: {error} Rollback failed: {}",
                    replacements[index].path.display(),
                    rollback_errors.join(" | ")
                )
            });
        }
        if let Err(error) = fs::rename(&stages[index], &replacements[index].path) {
            let mut rollback_errors = Vec::new();
            if let Err(restore_error) = fs::rename(&backups[index], &replacements[index].path) {
                rollback_errors.push(format!(
                    "Failed to restore {}: {restore_error}",
                    replacements[index].path.display()
                ));
            }
            rollback_errors.extend(rollback_json_batch(
                &replacements,
                &backups,
                &transaction_root,
                committed,
            ));
            let _ = fs::remove_dir_all(&transaction_root);
            return Err(if rollback_errors.is_empty() {
                format!(
                    "Failed to commit rename migration for {}: {error}",
                    replacements[index].path.display()
                )
            } else {
                format!(
                    "Failed to commit rename migration for {}: {error} Rollback failed: {}",
                    replacements[index].path.display(),
                    rollback_errors.join(" | ")
                )
            });
        }
        committed += 1;
    }

    if let Err(error) = crate::recycle_directory_path(&transaction_root) {
        let rollback_errors =
            rollback_json_batch(&replacements, &backups, &transaction_root, committed);
        let _ = fs::remove_dir_all(&transaction_root);
        return Err(if rollback_errors.is_empty() {
            format!("Could not recycle previous rename metadata: {error}")
        } else {
            format!(
                "Could not recycle previous rename metadata: {error} Rollback failed: {}",
                rollback_errors.join(" | ")
            )
        });
    }
    Ok(())
}

fn collect_manifest_paths(
    root: &Path,
    file_names: &[String],
    output: &mut Vec<PathBuf>,
) -> Result<(), String> {
    if !root.is_dir() {
        return Ok(());
    }
    for entry in
        fs::read_dir(root).map_err(|error| format!("Failed to read {}: {error}", root.display()))?
    {
        let entry = entry.map_err(|error| format!("Failed to read {}: {error}", root.display()))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?;
        if file_type.is_dir() {
            collect_manifest_paths(&path, file_names, output)?;
        } else if file_type.is_file()
            && path
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| {
                    file_names
                        .iter()
                        .any(|candidate| name.eq_ignore_ascii_case(candidate))
                })
        {
            output.push(path);
        }
    }
    Ok(())
}

fn prepare_source_manifest_replacements(
    program_root: &Path,
    manifest: &ProgramManifest,
    previous_program: &str,
    next_program: &str,
) -> Result<Vec<JsonReplacement>, String> {
    let mut file_names = manifest.allowed_manifest_file_names.clone();
    if manifest.supports_toolset_manifests
        && !file_names
            .iter()
            .any(|name| name.eq_ignore_ascii_case("flowcell.toolset.json"))
    {
        file_names.push("flowcell.toolset.json".to_string());
    }
    let mut paths = Vec::new();
    collect_manifest_paths(
        &program_root.join(&manifest.git_scripts_folder),
        &file_names,
        &mut paths,
    )?;
    collect_manifest_paths(
        &program_root.join(&manifest.local_scripts_folder),
        &file_names,
        &mut paths,
    )?;
    paths.sort();
    paths.dedup();
    let mut replacements = Vec::new();
    for path in paths {
        let raw = fs::read_to_string(&path)
            .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
        let mut value = serde_json::from_str::<Value>(&raw)
            .map_err(|error| format!("Source manifest {} is invalid: {error}", path.display()))?;
        let Some(program) = value.get_mut("program") else {
            continue;
        };
        if !program
            .as_str()
            .is_some_and(|current| names_match(current, previous_program))
        {
            continue;
        }
        *program = Value::String(next_program.to_string());
        replacements.push(JsonReplacement::new(path, &value)?);
    }
    Ok(replacements)
}

pub(crate) fn validate_panel_folder_rename(
    program_name: &str,
    panel_name: &str,
) -> Result<(), String> {
    let manifest = load_program_manifest(program_name)?;
    let program_root = crate::resolve_program_directory(program_name)?;
    let panel_root = program_root.join(&manifest.panels_folder).join(panel_name);
    prepare_panel_updates(
        &program_root,
        &manifest,
        &panel_root,
        &manifest.label,
        &manifest.label,
        panel_name,
        panel_name,
        None,
        None,
    )?;
    Ok(())
}

pub(crate) fn validate_program_folder_rename(program_name: &str) -> Result<(), String> {
    let manifest = load_program_manifest(program_name)?;
    let program_root = crate::resolve_program_directory(program_name)?;
    let panels_root = program_root.join(&manifest.panels_folder);
    if panels_root.is_dir() {
        let mut panels = fs::read_dir(&panels_root)
            .map_err(|error| format!("Failed to read {}: {error}", panels_root.display()))?
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_type()
                    .map(|value| value.is_dir())
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        panels.sort_by_key(|entry| entry.file_name().to_string_lossy().to_ascii_lowercase());
        for panel in panels {
            let panel_name = panel.file_name().to_string_lossy().to_string();
            prepare_panel_updates(
                &program_root,
                &manifest,
                &panel.path(),
                &manifest.label,
                &manifest.label,
                &panel_name,
                &panel_name,
                Some(&program_root),
                Some(&program_root),
            )?;
        }
    }
    prepare_source_manifest_replacements(
        &program_root,
        &manifest,
        &manifest.label,
        &manifest.label,
    )?;
    Ok(())
}

pub(crate) fn migrate_panel_folder_identity(
    program_name: &str,
    previous_panel_name: &str,
    next_panel_name: &str,
) -> Result<(), String> {
    let manifest = load_program_manifest(program_name)?;
    let program_root = crate::resolve_program_directory(program_name)?;
    let panel_root = program_root
        .join(&manifest.panels_folder)
        .join(next_panel_name);
    let updates = prepare_panel_updates(
        &program_root,
        &manifest,
        &panel_root,
        &manifest.label,
        &manifest.label,
        previous_panel_name,
        next_panel_name,
        None,
        None,
    )?;
    apply_json_batch(&program_root, owned_replacements(updates)?)
}

pub(crate) fn migrate_program_folder_identity(
    program_root: &Path,
    previous_program_name: &str,
    next_program_name: &str,
) -> Result<(), String> {
    let manifest_path = program_root.join("flowcell.program.json");
    let manifest_raw = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("Failed to read {}: {error}", manifest_path.display()))?;
    let mut manifest_value = serde_json::from_str::<Value>(&manifest_raw).map_err(|error| {
        format!(
            "Program manifest {} is invalid: {error}",
            manifest_path.display()
        )
    })?;
    let manifest =
        serde_json::from_value::<ProgramManifest>(manifest_value.clone()).map_err(|error| {
            format!(
                "Program manifest {} is invalid: {error}",
                manifest_path.display()
            )
        })?;
    let programs_root = program_root
        .parent()
        .ok_or_else(|| format!("Program folder has no parent: {}", program_root.display()))?;
    let previous_root = programs_root.join(previous_program_name);

    let panels_root = program_root.join(&manifest.panels_folder);
    let mut updates = Vec::new();
    if panels_root.is_dir() {
        let mut panels = fs::read_dir(&panels_root)
            .map_err(|error| format!("Failed to read {}: {error}", panels_root.display()))?
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_type()
                    .map(|value| value.is_dir())
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        panels.sort_by_key(|entry| entry.file_name().to_string_lossy().to_ascii_lowercase());
        for panel in panels {
            let panel_name = panel.file_name().to_string_lossy().to_string();
            updates.extend(prepare_panel_updates(
                program_root,
                &manifest,
                &panel.path(),
                previous_program_name,
                next_program_name,
                &panel_name,
                &panel_name,
                Some(&previous_root),
                Some(program_root),
            )?);
        }
    }

    let label = manifest_value
        .get_mut("label")
        .ok_or_else(|| "Program manifest requires label.".to_string())?;
    *label = Value::String(next_program_name.to_string());
    let mut replacements = vec![JsonReplacement::new(manifest_path, &manifest_value)?];
    replacements.extend(prepare_source_manifest_replacements(
        program_root,
        &manifest,
        previous_program_name,
        next_program_name,
    )?);
    replacements.extend(owned_replacements(updates)?);
    apply_json_batch(program_root, replacements)
}

#[cfg(test)]
mod tests {
    use super::{
        apply_json_batch_inner, migrate_program_folder_identity, rewrite_execution_target,
        JsonReplacement,
    };
    use serde_json::{json, Value};
    use std::fs;

    #[test]
    fn typed_execution_targets_rewrite_without_touching_unrelated_payload_values() {
        let mut value = json!({
            "kind": "core-action",
            "actionId": "open-test",
            "payload": {"programName":"Windows","panelName":"Files","unrelated":"Windows"}
        });
        rewrite_execution_target(
            &mut value,
            "Windows",
            "Desktop",
            Some("Files"),
            Some("Documents"),
        );
        assert_eq!(value["payload"]["programName"], "Desktop");
        assert_eq!(value["payload"]["panelName"], "Documents");
        assert_eq!(value["payload"]["unrelated"], "Windows");
    }

    #[test]
    fn program_migration_preserves_unknown_manifest_fields_and_updates_catalog_identity() {
        let root = std::env::temp_dir().join(format!(
            "flowcell-program-rename-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let program_root = root.join("Desktop");
        let catalog = program_root.join("Windows Git Scripts/Package");
        fs::create_dir_all(&catalog).expect("create catalog");
        fs::create_dir_all(program_root.join("Panels")).expect("create panels");
        fs::write(
            program_root.join("flowcell.program.json"),
            serde_json::to_string_pretty(&json!({
                "schemaVersion": 1,
                "programId": "windows",
                "label": "Windows",
                "programType": "local-script",
                "defaultPanels": ["Files"],
                "processNames": ["explorer"],
                "gitScriptsFolder": "Windows Git Scripts",
                "panelsFolder": "Panels",
                "localScriptsFolder": "Windows Local Scripts",
                "supportScriptsFolder": "SupportScripts",
                "allowedScriptExtensions": ["ps1"],
                "allowedManifestFileNames": ["flowcell.script.json"],
                "supportsToolsetManifests": false,
                "runner": {"kind":"windows-script","programKey":"windows_generic","installScript":"","deleteScript":""},
                "addonReloadNotes": "",
                "appRestartNotes": ""
            }))
            .expect("serialize manifest"),
        )
        .expect("write manifest");
        fs::write(
            catalog.join("flowcell.script.json"),
            r#"{"schemaVersion":1,"id":"test","label":"Test","program":"Windows","source":"run.ps1"}"#,
        )
        .expect("write catalog manifest");

        migrate_program_folder_identity(&program_root, "Windows", "Desktop")
            .expect("migrate program identity");
        let manifest: Value = serde_json::from_str(
            &fs::read_to_string(program_root.join("flowcell.program.json")).expect("read manifest"),
        )
        .expect("parse manifest");
        let source: Value = serde_json::from_str(
            &fs::read_to_string(catalog.join("flowcell.script.json"))
                .expect("read source manifest"),
        )
        .expect("parse source manifest");
        assert_eq!(manifest["label"], "Desktop");
        assert_eq!(manifest["defaultPanels"], json!(["Files"]));
        assert_eq!(source["program"], "Desktop");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn program_migration_updates_owned_active_and_install_records() {
        let root = std::env::temp_dir().join(format!(
            "flowcell-installed-program-rename-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let previous_root = root.join("Windows");
        let program_root = root.join("Desktop");
        let panel_root = program_root.join("Panels/Utility");
        let owner_button_id = "button-owner-1";
        let package_root = program_root
            .join("Windows Local Scripts")
            .join(owner_button_id);
        let source_path = package_root.join("source/run.ps1");
        fs::create_dir_all(&panel_root).expect("create panel");
        fs::create_dir_all(source_path.parent().expect("source parent"))
            .expect("create local package");
        fs::write(&source_path, "Write-Output 'ok'").expect("write installed source");
        fs::write(
            program_root.join("flowcell.program.json"),
            serde_json::to_string_pretty(&json!({
                "schemaVersion": 1,
                "programId": "windows",
                "label": "Windows",
                "programType": "local-script",
                "processNames": ["explorer"],
                "gitScriptsFolder": "Windows Git Scripts",
                "panelsFolder": "Panels",
                "localScriptsFolder": "Windows Local Scripts",
                "supportScriptsFolder": "SupportScripts",
                "allowedScriptExtensions": ["ps1"],
                "allowedManifestFileNames": ["flowcell.script.json"],
                "supportsToolsetManifests": false,
                "runner": {"kind":"windows-script","programKey":"windows_generic","installScript":"","deleteScript":""},
                "addonReloadNotes": "",
                "appRestartNotes": ""
            }))
            .expect("serialize manifest"),
        )
        .expect("write manifest");
        let previous_package_root = previous_root
            .join("Windows Local Scripts")
            .join(owner_button_id);
        let previous_source_path = previous_package_root.join("source/run.ps1");
        let previous_catalog_path = previous_root.join("Windows Git Scripts/Utility/run.ps1");
        fs::write(
            package_root.join("flowcell.install.json"),
            serde_json::to_string_pretty(&json!({
                "schemaVersion": 1,
                "ownerButtonId": owner_button_id,
                "installId": owner_button_id,
                "programId": "windows",
                "programName": "Windows",
                "panelName": "Utility",
                "sourceRelativePath": "source/run.ps1",
                "sourceDisplayPath": previous_catalog_path,
                "installedAt": "2026-01-01T00:00:00Z"
            }))
            .expect("serialize install record"),
        )
        .expect("write install record");
        let active_path = panel_root.join(format!("{owner_button_id}.flowcell-source.json"));
        fs::write(
            &active_path,
            serde_json::to_string_pretty(&json!({
                "schemaVersion": 1,
                "ownerButtonId": owner_button_id,
                "installId": owner_button_id,
                "programId": "windows",
                "programName": "Windows",
                "panelName": "Utility",
                "label": "Run",
                "tooltip": "",
                "kind": "single-script",
                "localPackagePath": previous_package_root,
                "sourcePath": previous_source_path,
                "runner": "windows-script",
                "runnerData": {"programName": "Windows", "untouched": true},
                "executionTarget": {
                    "kind": "panel-script",
                    "programName": "Windows",
                    "panelName": "Utility",
                    "fileName": "run.ps1"
                },
                "bridgeAction": "",
                "children": [],
                "layout": {"fields": [{"serviceTarget": {
                    "kind": "core-action",
                    "actionId": "test",
                    "payload": {"programName": "Windows", "panelName": "Utility"}
                }}]},
                "sourceDisplayPath": previous_catalog_path
            }))
            .expect("serialize active record"),
        )
        .expect("write active record");

        migrate_program_folder_identity(&program_root, "Windows", "Desktop")
            .expect("migrate installed program identity");

        let active: Value =
            serde_json::from_str(&fs::read_to_string(&active_path).expect("read active record"))
                .expect("parse active record");
        let install: Value = serde_json::from_str(
            &fs::read_to_string(package_root.join("flowcell.install.json"))
                .expect("read install record"),
        )
        .expect("parse install record");
        assert_eq!(active["programName"], "Desktop");
        assert_eq!(active["panelName"], "Utility");
        assert_eq!(
            active["localPackagePath"],
            package_root.to_string_lossy().as_ref()
        );
        assert_eq!(active["sourcePath"], source_path.to_string_lossy().as_ref());
        assert_eq!(active["executionTarget"]["programName"], "Desktop");
        assert_eq!(
            active["layout"]["fields"][0]["serviceTarget"]["payload"]["programName"],
            "Desktop"
        );
        assert_eq!(active["runnerData"]["programName"], "Windows");
        assert_eq!(install["programName"], "Desktop");
        assert_eq!(install["panelName"], "Utility");
        assert_eq!(
            install["sourceDisplayPath"],
            program_root
                .join("Windows Git Scripts/Utility/run.ps1")
                .to_string_lossy()
                .as_ref()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn batch_failure_restores_every_original_json_file() {
        let root = std::env::temp_dir().join(format!(
            "flowcell-rename-rollback-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("create rollback root");
        let first = root.join("first.json");
        let second = root.join("second.json");
        fs::write(&first, r#"{"value":"old-first"}"#).expect("write first");
        fs::write(&second, r#"{"value":"old-second"}"#).expect("write second");
        let replacements = vec![
            JsonReplacement::new(first.clone(), &json!({"value":"new-first"}))
                .expect("prepare first"),
            JsonReplacement::new(second.clone(), &json!({"value":"new-second"}))
                .expect("prepare second"),
        ];
        assert!(apply_json_batch_inner(&root, replacements, Some(1)).is_err());
        assert_eq!(
            serde_json::from_str::<Value>(&fs::read_to_string(&first).expect("read first"))
                .expect("parse first"),
            json!({"value":"old-first"})
        );
        assert_eq!(
            serde_json::from_str::<Value>(&fs::read_to_string(&second).expect("read second"))
                .expect("parse second"),
            json!({"value":"old-second"})
        );
        let _ = fs::remove_dir_all(root);
    }
}
