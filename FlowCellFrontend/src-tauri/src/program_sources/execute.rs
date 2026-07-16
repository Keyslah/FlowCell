use super::install::merge_toolset_payload;
use super::manifest::load_program_manifest;
use super::records::{
    active_record_file_name, read_active_record, validate_owner_button_id, ActiveSourceRecord,
    ACTIVE_SOURCE_RECORD_SUFFIX,
};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug)]
pub(crate) struct ActiveSourceResolution {
    pub file_name: String,
    pub record: ActiveSourceRecord,
}

fn path_is_within(child: &Path, parent: &Path) -> bool {
    let child = child.canonicalize().unwrap_or_else(|_| child.to_path_buf());
    let parent = parent
        .canonicalize()
        .unwrap_or_else(|_| parent.to_path_buf());
    child.starts_with(parent)
}

fn validate_resolution(
    program_name: &str,
    panel_name: &str,
    resolution: ActiveSourceResolution,
) -> Result<ActiveSourceResolution, String> {
    let manifest = load_program_manifest(program_name)?;
    let owner_button_id = validate_owner_button_id(&resolution.record.owner_button_id)?;
    if !resolution
        .record
        .program_name
        .eq_ignore_ascii_case(program_name.trim())
        || !resolution
            .record
            .program_id
            .eq_ignore_ascii_case(&manifest.program_id)
        || !resolution
            .record
            .panel_name
            .eq_ignore_ascii_case(panel_name.trim())
        || resolution.record.install_id != owner_button_id
        || !resolution
            .file_name
            .eq_ignore_ascii_case(&active_record_file_name(&owner_button_id))
        || resolution.record.runner != manifest.runner.kind
    {
        return Err(format!(
            "Active source record '{}' does not belong to {}/{}.",
            resolution.file_name, program_name, panel_name
        ));
    }
    let program_root = crate::resolve_program_directory(program_name)?;
    let local_root = program_root.join(&manifest.local_scripts_folder);
    let package_path = PathBuf::from(&resolution.record.local_package_path);
    let source_path = PathBuf::from(&resolution.record.source_path);
    let expected_package_path = local_root.join(&owner_button_id);
    if !package_path.is_dir()
        || !source_path.is_file()
        || !path_is_within(&package_path, &local_root)
        || package_path.canonicalize().ok() != expected_package_path.canonicalize().ok()
        || !path_is_within(&source_path, &package_path)
    {
        return Err(format!(
            "Button '{}' no longer has a valid owned Local Scripts package.",
            resolution.record.label
        ));
    }
    Ok(resolution)
}

pub(crate) fn resolve_active_source_record(
    program_name: &str,
    panel_name: &str,
    file_name: &str,
) -> Result<Option<ActiveSourceResolution>, String> {
    let validated_file_name = crate::validate_panel_script_file_name(file_name)?;
    if !validated_file_name
        .to_ascii_lowercase()
        .ends_with(ACTIVE_SOURCE_RECORD_SUFFIX)
    {
        return Ok(None);
    }
    let panel_directory = crate::resolve_panel_directory(program_name, panel_name)?;
    let record_path = panel_directory.join(&validated_file_name);
    if !record_path.is_file() {
        return Err(format!(
            "Active Button source '{}' was not found in {}.",
            validated_file_name,
            panel_directory.display()
        ));
    }
    let record = read_active_record(&record_path)?;
    validate_resolution(
        program_name,
        panel_name,
        ActiveSourceResolution {
            file_name: validated_file_name,
            record,
        },
    )
    .map(Some)
}

pub(crate) fn list_active_source_records(
    program_name: &str,
    panel_name: &str,
) -> Result<Vec<ActiveSourceResolution>, String> {
    let panel_directory = crate::resolve_panel_directory(program_name, panel_name)?;
    let mut records = Vec::new();
    for entry in fs::read_dir(&panel_directory)
        .map_err(|error| format!("Failed to read {}: {error}", panel_directory.display()))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to inspect {}: {error}", panel_directory.display()))?;
        if !entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?
            .is_file()
        {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_string();
        if !file_name
            .to_ascii_lowercase()
            .ends_with(ACTIVE_SOURCE_RECORD_SUFFIX)
        {
            continue;
        }
        match resolve_active_source_record(program_name, panel_name, &file_name)? {
            Some(record) => records.push(record),
            None => {
                return Err(format!(
                    "Active Button source '{}' could not be resolved.",
                    entry.path().display()
                ))
            }
        }
    }
    records.sort_by_cached_key(|entry| entry.record.label.to_ascii_lowercase());
    Ok(records)
}

fn record_declares_capability(record: &ActiveSourceRecord, capability: &str) -> bool {
    let normalized = capability.trim();
    if normalized.is_empty() {
        return false;
    }
    record
        .bridge_data
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|data| data.get("capabilities"))
        .and_then(Value::as_array)
        .is_some_and(|values| {
            values.iter().any(|value| {
                value
                    .as_str()
                    .is_some_and(|value| value.trim().eq_ignore_ascii_case(normalized))
            })
        })
}

pub(crate) fn resolve_capability_source(
    program_name: &str,
    panel_name: &str,
    file_name: &str,
    capability: &str,
) -> Result<ActiveSourceResolution, String> {
    let resolution = resolve_active_source_record(program_name, panel_name, file_name)?
        .ok_or_else(|| {
            format!(
                "Installed Button source '{}' could not be resolved for {}/{}.",
                file_name.trim(),
                program_name.trim(),
                panel_name.trim()
            )
        })?;
    if !record_declares_capability(&resolution.record, capability) {
        return Err(format!(
            "Installed Button '{}' does not declare required capability '{}'.",
            resolution.record.label,
            capability.trim()
        ));
    }
    Ok(resolution)
}

pub(crate) fn run_active_source(resolution: &ActiveSourceResolution) -> Result<Value, String> {
    let record = &resolution.record;
    if !record.children.is_empty() {
        return Ok(json!({ "message": format!("Loaded {}.", record.label) }));
    }
    let source_path = PathBuf::from(&record.source_path);
    let manifest = load_program_manifest(&record.program_name)?;
    match record.runner.as_str() {
        "windows-script" => {
            crate::run_windows_panel_script_file(&source_path)?;
            Ok(json!({ "message": format!("Started {}.", record.label) }))
        }
        "illustrator-direct" => {
            if manifest.runner.program_key.trim().is_empty() {
                return Err(
                    "Illustrator program manifest is missing runner.programKey.".to_string()
                );
            }
            crate::run_illustrator_backend_script_direct(
                &source_path,
                manifest.runner.program_key.trim(),
            )
            .map(|message| json!({ "message": message }))
        }
        "photoshop-direct" => {
            if manifest.runner.program_key.trim().is_empty() {
                return Err("Photoshop program manifest is missing runner.programKey.".to_string());
            }
            crate::run_flowcell_controller_script(&source_path, manifest.runner.program_key.trim())
                .map(|message| json!({ "message": message }))
        }
        "blender-bridge" => {
            if record.bridge_action.trim().is_empty() {
                return Err(format!(
                    "Installed Blender Button '{}' is missing bridgeAction.",
                    record.label
                ));
            }
            crate::run_blender_bridge_action_direct(
                record.bridge_action.trim(),
                record.bridge_data.clone().unwrap_or_else(|| json!({})),
            )
        }
        value => Err(format!("Unsupported installed Button runner '{value}'.")),
    }
}

pub(crate) fn run_active_toolset_action(
    resolution: &ActiveSourceResolution,
    slot: &str,
    runtime_payload: Option<Value>,
) -> Result<Value, String> {
    let record = &resolution.record;
    if record.children.is_empty() {
        return Err(format!("Button '{}' is not a tool set.", record.label));
    }
    let payload = merge_toolset_payload(record, slot, runtime_payload)?;
    let manifest = load_program_manifest(&record.program_name)?;
    match record.runner.as_str() {
        "blender-bridge" => {
            if record.bridge_action.trim().is_empty() {
                return Err(format!(
                    "The toolset manifest for '{}' is missing bridgeAction.",
                    record.label
                ));
            }
            crate::run_blender_bridge_action_direct(record.bridge_action.trim(), payload)
        }
        "illustrator-direct" => {
            let execution = record
                .runner_data
                .as_ref()
                .and_then(Value::as_object)
                .ok_or_else(|| {
                    format!(
                        "Tool-set manifest for '{}' requires an execution object.",
                        record.label
                    )
                })?;
            let command_file = execution
                .get("commandFile")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    format!(
                        "Tool-set manifest for '{}' is missing execution.commandFile.",
                        record.label
                    )
                })?;
            let command_path = Path::new(command_file.trim());
            if command_path.is_absolute()
                || command_path.components().count() != 1
                || command_path.file_name().and_then(|value| value.to_str())
                    != Some(command_file.trim())
            {
                return Err("execution.commandFile must be a single JSON file name.".to_string());
            }
            if !command_file.to_ascii_lowercase().ends_with(".json") {
                return Err("execution.commandFile must use the .json extension.".to_string());
            }
            let program_key = execution
                .get("programKey")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(manifest.runner.program_key.trim());
            if program_key.is_empty() {
                return Err(
                    "Illustrator program manifest is missing runner.programKey.".to_string()
                );
            }
            let local_root = crate::resolve_flowcell_local_root()?;
            fs::create_dir_all(&local_root)
                .map_err(|error| format!("Failed to create {}: {error}", local_root.display()))?;
            let command_path = local_root.join(command_file.trim());
            let created_at_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            let envelope = json!({
                "programName": record.program_name,
                "panelName": record.panel_name,
                "fileName": resolution.file_name,
                "command": slot.trim(),
                "createdAtMs": created_at_ms,
                "payload": payload
            });
            super::records::atomic_replace_json(&command_path, &envelope)?;
            let source_path = PathBuf::from(&record.source_path);
            let message = crate::run_illustrator_backend_script_direct(&source_path, program_key)?;
            Ok(json!({ "message": message }))
        }
        _ => Err(format!(
            "Tool-set execution is not supported by runner '{}'.",
            record.runner
        )),
    }
}

fn declared_blender_button_event_action<'a>(
    event: &'a Map<String, Value>,
    event_name: &str,
) -> Result<&'a str, String> {
    event
        .get("action")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|action| !action.is_empty())
        .ok_or_else(|| format!("Button event '{}' is missing an action.", event_name))
}

pub(crate) fn run_active_button_event(
    resolution: &ActiveSourceResolution,
    event_name: &str,
) -> Result<String, String> {
    let normalized = crate::normalize_panel_button_event_name(event_name)
        .ok_or_else(|| format!("Unsupported button event '{}'.", event_name.trim()))?;
    let events = resolution.record.events.as_ref().ok_or_else(|| {
        format!(
            "Button '{}' does not declare events.",
            resolution.record.label
        )
    })?;
    let event = events
        .get(&normalized)
        .and_then(Value::as_object)
        .ok_or_else(|| {
            format!(
                "Button '{}' does not declare event '{}'.",
                resolution.record.label, normalized
            )
        })?;
    let action_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("blenderBridge");
    if action_type.eq_ignore_ascii_case("none") {
        return Ok("Button event has no action.".to_string());
    }
    if !action_type.eq_ignore_ascii_case("blenderBridge")
        || resolution.record.runner != "blender-bridge"
    {
        return Err(format!(
            "Button event type '{action_type}' is not supported by this runner."
        ));
    }
    let action = declared_blender_button_event_action(event, &normalized)?;
    let data = event.get("data").cloned().unwrap_or_else(|| json!({}));
    let response = crate::run_blender_bridge_action_direct(action, data)?;
    Ok(crate::extract_blender_bridge_response_message(&response))
}

#[cfg(test)]
mod tests {
    use super::declared_blender_button_event_action;
    use serde_json::json;

    #[test]
    fn declared_button_event_uses_its_own_bridge_action() {
        let event = json!({
            "type": "blenderBridge",
            "action": "cycle_collection_hover_save_visibility"
        });
        assert_eq!(
            declared_blender_button_event_action(
                event.as_object().expect("event object"),
                "hoverEnter"
            )
            .expect("declared event action"),
            "cycle_collection_hover_save_visibility"
        );
    }

    #[test]
    fn declared_button_event_rejects_a_missing_action() {
        let event = json!({ "type": "blenderBridge", "action": "  " });
        let error = declared_blender_button_event_action(
            event.as_object().expect("event object"),
            "pressUp",
        )
        .expect_err("blank action should fail");
        assert_eq!(error, "Button event 'pressUp' is missing an action.");
    }
}
