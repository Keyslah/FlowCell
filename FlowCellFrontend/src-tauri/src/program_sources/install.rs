use super::manifest::{extension_is_allowed, load_program_manifest, ProgramManifest};
use super::records::{
    active_record_file_name, atomic_replace_json, atomic_write_json, empty_object,
    read_active_record, validate_owner_button_id, ActiveSourceChild, ActiveSourceRecord,
    LocalInstallRecord, INSTALL_RECORD_FILE_NAME,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const TOOLSET_MANIFEST_FILE_NAME: &str = "flowcell.toolset.json";
const SCRIPT_MANIFEST_FILE_NAME: &str = "flowcell.script.json";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallButtonSourceRequest {
    pub owner_button_id: String,
    pub program_name: String,
    pub panel_name: String,
    pub source_path: String,
    #[serde(default)]
    pub import_kind: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledSourceIdentity {
    pub program_name: String,
    pub panel_name: String,
    pub file_name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledButtonSnapshot {
    pub label: String,
    pub tooltip: String,
    pub role: String,
    pub execution_target: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledChildSnapshot {
    pub slot: String,
    pub label: String,
    pub tooltip: String,
    pub execution_target: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallButtonSourceResponse {
    pub owner_button_id: String,
    pub source_identity: InstalledSourceIdentity,
    pub owner: InstalledButtonSnapshot,
    pub children: Vec<InstalledChildSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events: Option<BTreeMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<Value>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ToolsetManifest {
    schema_version: u32,
    id: String,
    #[serde(default)]
    version: String,
    label: String,
    #[serde(default)]
    tooltip: String,
    #[serde(default = "default_toolset_kind")]
    kind: String,
    #[serde(default)]
    program: String,
    source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    bridge_data: Option<Value>,
    children: Vec<ToolsetChildManifest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    layout: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    events: Option<BTreeMap<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    execution: Option<Value>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ScriptManifest {
    schema_version: u32,
    #[serde(default)]
    id: String,
    label: String,
    #[serde(default)]
    tooltip: String,
    #[serde(default)]
    program: String,
    source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    bridge_data: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    events: Option<BTreeMap<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    execution: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    execution_target: Option<Value>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ToolsetChildManifest {
    slot: String,
    label: String,
    #[serde(default)]
    tooltip: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    payload: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    execution_target: Option<Value>,
}

fn default_toolset_kind() -> String {
    "toolset".to_string()
}

const CATALOG_CORE_ACTION_IDS: &[&str] = &[
    "open-illustrator-layer-tree",
    "open-window-grid",
    "sample-blender-theme-image",
    "save-blender-theme-fields",
    "load-blender-theme-fields",
];

fn validate_core_execution_target(subject: &str, target: &Value) -> Result<(), String> {
    let object = target
        .as_object()
        .ok_or_else(|| format!("executionTarget for {subject} must be a JSON object."))?;
    if object.get("kind").and_then(Value::as_str) != Some("core-action") {
        return Err(format!(
            "executionTarget for {subject} may only name a registered core-action service."
        ));
    }
    let action_id = object
        .get("actionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("executionTarget for {subject} requires a non-empty actionId."))?;
    if !CATALOG_CORE_ACTION_IDS
        .iter()
        .any(|registered| action_id.eq_ignore_ascii_case(registered))
    {
        return Err(format!(
            "executionTarget for {subject} names unregistered catalog core action '{action_id}'."
        ));
    }
    if object
        .get("payload")
        .is_some_and(|value| !value.is_object())
    {
        return Err(format!(
            "executionTarget payload for {subject} must be a JSON object."
        ));
    }
    if object.get("events").is_some_and(|value| !value.is_object()) {
        return Err(format!(
            "executionTarget events for {subject} must be a JSON object."
        ));
    }
    Ok(())
}

struct PreparedSource {
    package_source_root: PathBuf,
    source_relative_to_package: PathBuf,
    label: String,
    tooltip: String,
    kind: String,
    bridge_data: Option<Value>,
    execution_target: Option<Value>,
    events: Option<BTreeMap<String, Value>>,
    children: Vec<ActiveSourceChild>,
    layout: Option<Value>,
    runner_data: Option<Value>,
}

fn validate_update_shape(
    previous: &ActiveSourceRecord,
    prepared: &PreparedSource,
) -> Result<(), String> {
    let previous_is_toolset = !previous.children.is_empty();
    let next_is_toolset = !prepared.children.is_empty();
    if previous_is_toolset != next_is_toolset {
        return Err(
            "Update cannot change a single-script Button into a tool set or a tool set into a single-script Button. Delete and re-add it so the canonical graph can change safely."
                .to_string(),
        );
    }
    if !previous_is_toolset {
        return Ok(());
    }
    let mut previous_slots = previous
        .children
        .iter()
        .map(|child| child.slot.trim().to_ascii_lowercase())
        .collect::<Vec<_>>();
    let mut next_slots = prepared
        .children
        .iter()
        .map(|child| child.slot.trim().to_ascii_lowercase())
        .collect::<Vec<_>>();
    previous_slots.sort();
    next_slots.sort();
    if previous_slots != next_slots {
        return Err(format!(
            "Update cannot add, remove, or rename tool-set child slots. Installed: [{}]. Selected: [{}]. Delete and re-add the tool set to change its Button graph.",
            previous_slots.join(", "),
            next_slots.join(", ")
        ));
    }
    Ok(())
}

fn normalize_import_kind(value: &str) -> Result<&'static str, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "" | "script" | "single-script" => Ok("script"),
        "tool-set" | "toolset" => Ok("tool-set"),
        _ => Err("importKind must be 'script' or 'tool-set'.".to_string()),
    }
}

fn ensure_relative_source_path(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value.trim());
    if value.trim().is_empty()
        || path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Tool-set source must be a relative path inside its package.".to_string());
    }
    Ok(path)
}

fn prepare_source(
    manifest: &ProgramManifest,
    source_path: &Path,
    import_kind: &str,
) -> Result<PreparedSource, String> {
    if import_kind == "script" {
        let selected_package_file = source_path
            .is_file()
            .then(|| source_path.to_path_buf())
            .filter(|path| {
                !path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(|value| value.eq_ignore_ascii_case(SCRIPT_MANIFEST_FILE_NAME))
                    .unwrap_or(false)
            });
        let script_manifest_path = if source_path.is_dir() {
            Some(source_path.join(SCRIPT_MANIFEST_FILE_NAME))
        } else if source_path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case(SCRIPT_MANIFEST_FILE_NAME))
            .unwrap_or(false)
        {
            Some(source_path.to_path_buf())
        } else if let Some(parent) = source_path.parent() {
            let sibling = parent.join(SCRIPT_MANIFEST_FILE_NAME);
            sibling.is_file().then_some(sibling)
        } else {
            None
        };
        if script_manifest_path.is_none()
            && source_path.is_file()
            && source_path
                .parent()
                .map(|parent| parent.join(TOOLSET_MANIFEST_FILE_NAME).is_file())
                .unwrap_or(false)
        {
            return Err(format!(
                "'{}' belongs to a tool-set package. Use Add Tool Set and select its {}.",
                source_path.display(),
                TOOLSET_MANIFEST_FILE_NAME
            ));
        }
        if let Some(script_manifest_path) = script_manifest_path {
            if !script_manifest_path.is_file() {
                return Err(format!(
                    "Script package is missing {}.",
                    script_manifest_path.display()
                ));
            }
            let package_root = script_manifest_path
                .parent()
                .ok_or_else(|| "Script manifest has no package folder.".to_string())?;
            let raw = fs::read_to_string(&script_manifest_path).map_err(|error| {
                format!("Failed to read {}: {error}", script_manifest_path.display())
            })?;
            let script = serde_json::from_str::<ScriptManifest>(&raw).map_err(|error| {
                format!(
                    "Script manifest {} is invalid: {error}",
                    script_manifest_path.display()
                )
            })?;
            if script.schema_version != 1 || script.label.trim().is_empty() {
                return Err("Script manifest requires schemaVersion 1 and label.".to_string());
            }
            if !script.program.trim().is_empty()
                && !script.program.trim().eq_ignore_ascii_case(&manifest.label)
            {
                return Err(format!(
                    "Script program '{}' does not match '{}'.",
                    script.program, manifest.label
                ));
            }
            let source_relative = ensure_relative_source_path(&script.source)?;
            let executable = package_root.join(&source_relative);
            if !executable.is_file() || !extension_is_allowed(manifest, &executable) {
                return Err(format!(
                    "Script package source '{}' is missing or unsupported.",
                    executable.display()
                ));
            }
            if let Some(selected) = selected_package_file.as_ref() {
                let selected = selected.canonicalize().map_err(|error| {
                    format!(
                        "Selected package file '{}' could not be resolved: {error}",
                        selected.display()
                    )
                })?;
                let executable = executable.canonicalize().map_err(|error| {
                    format!(
                        "Script package source '{}' could not be resolved: {error}",
                        executable.display()
                    )
                })?;
                if selected != executable {
                    return Err(format!(
                        "'{}' is a companion file in a script package. Add the declared source '{}' or its {} instead.",
                        selected.display(),
                        executable.display(),
                        SCRIPT_MANIFEST_FILE_NAME
                    ));
                }
            }
            if let Some(execution_target) = script.execution_target.as_ref() {
                validate_core_execution_target("script package", execution_target)?;
            }
            let _manifest_id = script.id;
            return Ok(PreparedSource {
                package_source_root: package_root.to_path_buf(),
                source_relative_to_package: source_relative,
                label: script.label.trim().to_string(),
                tooltip: script.tooltip.trim().to_string(),
                kind: "script".to_string(),
                bridge_data: script.bridge_data,
                execution_target: script.execution_target,
                events: script.events,
                children: Vec::new(),
                layout: None,
                runner_data: script.execution,
            });
        }
        if !source_path.is_file() {
            return Err(format!(
                "Script source was not found: {}",
                source_path.display()
            ));
        }
        if !extension_is_allowed(manifest, source_path) {
            return Err(format!(
                "'{}' is not an allowed {} script type.",
                source_path.display(),
                manifest.label
            ));
        }
        let file_name = source_path
            .file_name()
            .ok_or_else(|| "Selected script has no file name.".to_string())?;
        let label = source_path
            .file_stem()
            .and_then(|value| value.to_str())
            .map(crate::format_panel_script_label)
            .unwrap_or_else(|| "Button".to_string());
        return Ok(PreparedSource {
            package_source_root: source_path.to_path_buf(),
            source_relative_to_package: PathBuf::from(file_name),
            label,
            tooltip: crate::read_top_description(source_path).unwrap_or_default(),
            kind: "script".to_string(),
            bridge_data: None,
            execution_target: None,
            events: None,
            children: Vec::new(),
            layout: None,
            runner_data: None,
        });
    }

    if !manifest.supports_toolset_manifests {
        return Err(format!(
            "{} does not support tool-set manifests.",
            manifest.label
        ));
    }
    let manifest_path = if source_path.is_dir() {
        source_path.join(TOOLSET_MANIFEST_FILE_NAME)
    } else if source_path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case(TOOLSET_MANIFEST_FILE_NAME))
        .unwrap_or(false)
    {
        source_path.to_path_buf()
    } else {
        return Err(format!(
            "Tool-set import requires a folder or {} file.",
            TOOLSET_MANIFEST_FILE_NAME
        ));
    };
    let package_root = manifest_path
        .parent()
        .ok_or_else(|| "Tool-set manifest has no package folder.".to_string())?;
    let raw = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("Failed to read {}: {error}", manifest_path.display()))?;
    let toolset = serde_json::from_str::<ToolsetManifest>(&raw).map_err(|error| {
        format!(
            "Tool-set manifest {} is invalid: {error}",
            manifest_path.display()
        )
    })?;
    if toolset.schema_version != 1 || toolset.id.trim().is_empty() {
        return Err("Tool-set manifest requires schemaVersion 1 and a non-empty id.".to_string());
    }
    if !toolset.program.trim().is_empty()
        && !toolset.program.trim().eq_ignore_ascii_case(&manifest.label)
    {
        return Err(format!(
            "Tool-set program '{}' does not match '{}'.",
            toolset.program, manifest.label
        ));
    }
    if toolset.label.trim().is_empty() {
        return Err("Tool-set manifest requires label.".to_string());
    }
    if toolset.children.is_empty() {
        return Err("Tool-set manifest must define at least one child.".to_string());
    }
    let source_relative = ensure_relative_source_path(&toolset.source)?;
    let executable = package_root.join(&source_relative);
    if !executable.is_file() || !extension_is_allowed(manifest, &executable) {
        return Err(format!(
            "Tool-set source '{}' is missing or unsupported.",
            executable.display()
        ));
    }
    let mut seen_slots = Vec::<String>::new();
    let mut children = Vec::new();
    for child in toolset.children {
        let slot = child.slot.trim().to_string();
        if slot.is_empty() || child.label.trim().is_empty() {
            return Err("Every tool-set child requires slot and label.".to_string());
        }
        if seen_slots
            .iter()
            .any(|seen| seen.eq_ignore_ascii_case(&slot))
        {
            return Err(format!("Tool-set child slot '{slot}' is duplicated."));
        }
        if let Some(payload) = child.payload.as_ref() {
            if !payload.is_object() {
                return Err(format!(
                    "Payload for child slot '{slot}' must be a JSON object."
                ));
            }
        }
        if let Some(execution_target) = child.execution_target.as_ref() {
            validate_core_execution_target(&format!("child slot '{slot}'"), execution_target)?;
        }
        seen_slots.push(slot.clone());
        children.push(ActiveSourceChild {
            slot,
            label: child.label.trim().to_string(),
            tooltip: child.tooltip.trim().to_string(),
            payload: child.payload,
            execution_target: child.execution_target,
        });
    }
    let _manifest_version = toolset.version;
    Ok(PreparedSource {
        package_source_root: package_root.to_path_buf(),
        source_relative_to_package: source_relative,
        label: toolset.label.trim().to_string(),
        tooltip: toolset.tooltip.trim().to_string(),
        kind: if toolset.kind.trim().is_empty() {
            "toolset".to_string()
        } else {
            toolset.kind.trim().to_string()
        },
        bridge_data: toolset.bridge_data,
        execution_target: None,
        events: toolset.events,
        children,
        layout: toolset.layout,
        runner_data: toolset.execution,
    })
}

fn copy_package_source(source: &Path, destination: &Path) -> Result<(), String> {
    if source.is_file() {
        fs::create_dir_all(destination)
            .map_err(|error| format!("Failed to create {}: {error}", destination.display()))?;
        let file_name = source
            .file_name()
            .ok_or_else(|| "Selected source has no file name.".to_string())?;
        fs::copy(source, destination.join(file_name)).map_err(|error| {
            format!(
                "Failed to copy {} into {}: {error}",
                source.display(),
                destination.display()
            )
        })?;
        return Ok(());
    }
    if !source.is_dir() {
        return Err(format!(
            "Package source was not found: {}",
            source.display()
        ));
    }
    fs::create_dir_all(destination)
        .map_err(|error| format!("Failed to create {}: {error}", destination.display()))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("Failed to read {}: {error}", source.display()))?
    {
        let entry =
            entry.map_err(|error| format!("Failed to inspect {}: {error}", source.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;
        if file_type.is_symlink() {
            return Err(format!(
                "Tool-set packages cannot contain symbolic links: {}",
                entry.path().display()
            ));
        }
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_package_source(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &target)
                .map_err(|error| format!("Failed to copy {}: {error}", entry.path().display()))?;
        }
    }
    Ok(())
}

fn preserve_runtime_directory(
    previous_package: &Path,
    staging_package: &Path,
) -> Result<(), String> {
    let previous_runtime = previous_package.join("runtime");
    if !previous_runtime.is_dir() {
        return Ok(());
    }
    let staged_runtime = staging_package.join("runtime");
    if staged_runtime.exists() {
        return Err(format!(
            "Install staging unexpectedly contains runtime state at {}.",
            staged_runtime.display()
        ));
    }
    copy_package_source(&previous_runtime, &staged_runtime)
}

fn timestamp() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:09}Z", now.as_secs(), now.subsec_nanos())
}

fn owned_bridge_action(owner_button_id: &str) -> String {
    format!("flowcell_button_{}", owner_button_id.to_ascii_lowercase())
}

fn blender_install_arguments(
    script_path: &Path,
    owner_button_id: &str,
    panel_name: &str,
    installed_source: &Path,
    bridge_data: Option<&Value>,
) -> Result<Vec<String>, String> {
    let selected_paths_json =
        serde_json::to_string(&vec![installed_source.to_string_lossy().to_string()])
            .map_err(|error| format!("Failed to encode Blender install source: {error}"))?;
    let bridge_data_json = match bridge_data {
        Some(value) => serde_json::to_string(value)
            .map_err(|error| format!("Failed to encode Blender bridgeData: {error}"))?,
        None => "{}".to_string(),
    };
    Ok(vec![
        "-File".to_string(),
        script_path.to_string_lossy().to_string(),
        "-PanelName".to_string(),
        panel_name.to_string(),
        "-SelectedPathsJson".to_string(),
        selected_paths_json,
        "-OwnerButtonId".to_string(),
        owner_button_id.to_string(),
        "-BridgeDataJson".to_string(),
        bridge_data_json,
    ])
}

pub(crate) fn deploy_blender_source(
    manifest: &ProgramManifest,
    owner_button_id: &str,
    panel_name: &str,
    installed_source: &Path,
    bridge_data: Option<&Value>,
) -> Result<String, String> {
    let program_root = crate::resolve_program_directory(&manifest.label)?;
    let script_path = program_root
        .join(&manifest.support_scripts_folder)
        .join(&manifest.runner.install_script);
    if !script_path.is_file() {
        return Err(format!(
            "Blender install adapter was not found at {}.",
            script_path.display()
        ));
    }
    let arguments = blender_install_arguments(
        &script_path,
        owner_button_id,
        panel_name,
        installed_source,
        bridge_data,
    )?;
    let output = crate::spawn_powershell_output(&arguments)?;
    if !output.status.success() {
        return Err(crate::format_process_failure(
            &output,
            "Blender Button source deployment failed.",
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parsed = serde_json::from_str::<Value>(&stdout).map_err(|error| {
        format!("Blender install adapter returned invalid JSON: {error}. Output: {stdout}")
    })?;
    let result = parsed
        .get("results")
        .and_then(Value::as_array)
        .and_then(|values| values.first())
        .ok_or_else(|| "Blender install adapter returned no result.".to_string())?;
    if result.get("installed").and_then(Value::as_bool) != Some(true) {
        return Err(result
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Blender install adapter rejected the source.")
            .to_string());
    }
    Ok(result
        .get("action")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| owned_bridge_action(owner_button_id)))
}

fn rollback_blender_deployment(
    manifest: &ProgramManifest,
    owner_button_id: &str,
    label: &str,
    previous_record: Option<&ActiveSourceRecord>,
) -> Result<(), String> {
    if manifest.runner.kind != "blender-bridge" {
        return Ok(());
    }
    if let Some(previous) = previous_record {
        return deploy_blender_source(
            manifest,
            owner_button_id,
            &previous.panel_name,
            Path::new(&previous.source_path),
            previous.bridge_data.as_ref(),
        )
        .map(|_| ());
    }
    super::delete::cleanup_blender_owner(
        &manifest.label,
        owner_button_id,
        label,
        &owned_bridge_action(owner_button_id),
    )
}

pub(crate) fn build_response(
    record: &ActiveSourceRecord,
    file_name: String,
) -> InstallButtonSourceResponse {
    let source_identity = InstalledSourceIdentity {
        program_name: record.program_name.clone(),
        panel_name: record.panel_name.clone(),
        file_name: file_name.clone(),
    };
    let panel_target = json!({
        "kind": "panel-script",
        "programName": record.program_name,
        "panelName": record.panel_name,
        "fileName": file_name,
        "events": record.events
    });
    let is_toolset = !record.children.is_empty();
    let owner_execution_target = if is_toolset {
        None
    } else if let Some(mut target) = record.execution_target.clone() {
        if let Some(target_object) = target.as_object_mut() {
            let payload = target_object.entry("payload").or_insert_with(|| json!({}));
            if let Some(payload_object) = payload.as_object_mut() {
                payload_object.insert("programName".to_string(), json!(record.program_name));
                payload_object.insert("panelName".to_string(), json!(record.panel_name));
                payload_object.insert("fileName".to_string(), json!(source_identity.file_name));
                payload_object.insert("ownerButtonId".to_string(), json!(record.owner_button_id));
            }
        }
        Some(target)
    } else {
        Some(panel_target)
    };
    let owner = InstalledButtonSnapshot {
        label: record.label.clone(),
        tooltip: record.tooltip.clone(),
        role: if is_toolset {
            "tool-set-owner"
        } else {
            "single-script"
        }
        .to_string(),
        execution_target: owner_execution_target,
    };
    let children = record
        .children
        .iter()
        .map(|child| InstalledChildSnapshot {
            slot: child.slot.clone(),
            label: child.label.clone(),
            tooltip: child.tooltip.clone(),
            execution_target: child.execution_target.clone().unwrap_or_else(|| {
                json!({
                    "kind": "tool-set-action",
                    "programName": record.program_name,
                    "panelName": record.panel_name,
                    "ownerFileName": source_identity.file_name,
                    "command": child.slot,
                    "payload": child.payload
                })
            }),
        })
        .collect();
    InstallButtonSourceResponse {
        owner_button_id: record.owner_button_id.clone(),
        source_identity,
        owner,
        children,
        events: record.events.clone(),
        layout: record.layout.clone(),
    }
}

pub(crate) fn install_from_path(
    request: InstallButtonSourceRequest,
    replace_existing: bool,
) -> Result<InstallButtonSourceResponse, String> {
    let owner_button_id = validate_owner_button_id(&request.owner_button_id)?;
    let program_name = request.program_name.trim();
    let panel_name = crate::validate_folder_name(&request.panel_name, "Panel")?;
    let manifest = load_program_manifest(program_name)?;
    let source_display_path = PathBuf::from(request.source_path.trim());
    let source_path = source_display_path.canonicalize().map_err(|error| {
        format!(
            "Selected Button source '{}' could not be resolved: {error}",
            source_display_path.display()
        )
    })?;
    let import_kind = normalize_import_kind(&request.import_kind)?;
    let prepared = prepare_source(&manifest, &source_path, import_kind)?;
    let program_root = crate::resolve_program_directory(program_name)?;
    let local_root = program_root.join(&manifest.local_scripts_folder);
    let panel_root = program_root.join(&manifest.panels_folder).join(&panel_name);
    fs::create_dir_all(&local_root)
        .map_err(|error| format!("Failed to create {}: {error}", local_root.display()))?;
    fs::create_dir_all(&panel_root)
        .map_err(|error| format!("Failed to create {}: {error}", panel_root.display()))?;
    let final_package = local_root.join(&owner_button_id);
    let active_file_name = active_record_file_name(&owner_button_id);
    let active_path = panel_root.join(&active_file_name);
    if !replace_existing && (final_package.exists() || active_path.exists()) {
        return Err(format!(
            "Button '{}' already owns an installed source. Add creates a fresh Button; use Update to replace this one.",
            owner_button_id
        ));
    }
    if replace_existing && (!final_package.is_dir() || !active_path.is_file()) {
        return Err(format!(
            "Button '{}' has no installed source to update.",
            owner_button_id
        ));
    }
    let previous_record = if replace_existing {
        Some(read_active_record(&active_path)?)
    } else {
        None
    };
    if let Some(previous) = previous_record.as_ref() {
        validate_update_shape(previous, &prepared)?;
    }
    let staging = local_root.join(format!(
        ".installing-{owner_button_id}-{}",
        timestamp().replace(['.', ':'], "-")
    ));
    if staging.exists() {
        return Err(format!(
            "Install staging path already exists: {}",
            staging.display()
        ));
    }
    let staged_source_root = staging.join("source");
    if let Err(error) = copy_package_source(&prepared.package_source_root, &staged_source_root) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let installed_source = staged_source_root.join(&prepared.source_relative_to_package);
    if !installed_source.is_file() {
        let _ = fs::remove_dir_all(&staging);
        return Err(format!(
            "Installed source was not staged at {}.",
            installed_source.display()
        ));
    }
    let install_record = LocalInstallRecord {
        schema_version: 1,
        owner_button_id: owner_button_id.clone(),
        install_id: owner_button_id.clone(),
        program_id: manifest.program_id.clone(),
        program_name: manifest.label.clone(),
        panel_name: panel_name.clone(),
        source_relative_path: format!(
            "source\\{}",
            prepared.source_relative_to_package.to_string_lossy()
        ),
        source_display_path: source_path.to_string_lossy().to_string(),
        installed_at: timestamp(),
    };
    if let Err(error) = atomic_write_json(&staging.join(INSTALL_RECORD_FILE_NAME), &install_record)
    {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    if replace_existing {
        if let Err(error) = preserve_runtime_directory(&final_package, &staging) {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    }

    let previous_package = local_root.join(format!(".replacing-{owner_button_id}"));
    if replace_existing {
        if previous_package.exists() {
            let _ = fs::remove_dir_all(&staging);
            return Err(format!(
                "A previous Button update is pending at {}.",
                previous_package.display()
            ));
        }
        fs::rename(&final_package, &previous_package).map_err(|error| {
            let _ = fs::remove_dir_all(&staging);
            format!("Failed to stage existing install for update: {error}")
        })?;
    }
    if let Err(error) = fs::rename(&staging, &final_package) {
        if replace_existing {
            let _ = fs::rename(&previous_package, &final_package);
        }
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("Failed to commit Local Scripts package: {error}"));
    }
    let committed_source = final_package
        .join("source")
        .join(&prepared.source_relative_to_package);
    let bridge_action = if manifest.runner.kind == "blender-bridge" {
        match deploy_blender_source(
            &manifest,
            &owner_button_id,
            &panel_name,
            &committed_source,
            prepared.bridge_data.as_ref(),
        ) {
            Ok(action) => action,
            Err(error) => {
                let _ = crate::recycle_directory_path(&final_package);
                if replace_existing {
                    let _ = fs::rename(&previous_package, &final_package);
                }
                let rollback = rollback_blender_deployment(
                    &manifest,
                    &owner_button_id,
                    &prepared.label,
                    previous_record.as_ref(),
                );
                return Err(match rollback {
                    Ok(()) => error,
                    Err(rollback_error) => {
                        format!("{error} Blender rollback also failed: {rollback_error}")
                    }
                });
            }
        }
    } else {
        String::new()
    };
    let record = ActiveSourceRecord {
        schema_version: 1,
        owner_button_id: owner_button_id.clone(),
        install_id: owner_button_id.clone(),
        program_id: manifest.program_id.clone(),
        program_name: manifest.label.clone(),
        panel_name,
        label: prepared.label,
        tooltip: prepared.tooltip,
        kind: prepared.kind,
        local_package_path: final_package.to_string_lossy().to_string(),
        source_path: committed_source.to_string_lossy().to_string(),
        runner: manifest.runner.kind.clone(),
        runner_data: prepared.runner_data,
        execution_target: prepared.execution_target,
        bridge_action,
        bridge_data: prepared.bridge_data,
        events: prepared.events,
        children: prepared.children,
        layout: prepared.layout,
        source_display_path: source_path.to_string_lossy().to_string(),
    };
    let record_write_result = if replace_existing {
        atomic_replace_json(&active_path, &record)
    } else {
        atomic_write_json(&active_path, &record)
    };
    if let Err(error) = record_write_result {
        let _ = crate::recycle_directory_path(&final_package);
        if replace_existing {
            let _ = fs::rename(&previous_package, &final_package);
        }
        let rollback = rollback_blender_deployment(
            &manifest,
            &owner_button_id,
            &record.label,
            previous_record.as_ref(),
        );
        return Err(match rollback {
            Ok(()) => error,
            Err(rollback_error) => {
                format!("{error} Blender rollback also failed: {rollback_error}")
            }
        });
    }
    if replace_existing && previous_package.is_dir() {
        crate::recycle_directory_path(&previous_package)?;
    }
    Ok(build_response(&record, active_file_name))
}

#[tauri::command]
pub(crate) fn install_button_source(
    request: InstallButtonSourceRequest,
) -> Result<InstallButtonSourceResponse, String> {
    install_from_path(request, false)
}

#[tauri::command]
pub(crate) fn update_button_source(
    request: InstallButtonSourceRequest,
) -> Result<InstallButtonSourceResponse, String> {
    install_from_path(request, true)
}

pub(crate) fn merge_toolset_payload(
    record: &ActiveSourceRecord,
    slot: &str,
    runtime_payload: Option<Value>,
) -> Result<Value, String> {
    let child = record
        .children
        .iter()
        .find(|child| child.slot.eq_ignore_ascii_case(slot.trim()))
        .ok_or_else(|| {
            format!(
                "Tool set '{}' does not define child slot '{}'.",
                record.label,
                slot.trim()
            )
        })?;
    let mut merged = match record.bridge_data.clone().unwrap_or_else(empty_object) {
        Value::Object(map) => map,
        _ => return Err("Tool-set bridgeData must be a JSON object.".to_string()),
    };
    if let Some(payload) = child.payload.clone() {
        let Value::Object(values) = payload else {
            return Err(format!(
                "Payload for child slot '{}' must be a JSON object.",
                child.slot
            ));
        };
        merged.extend(values);
    }
    if let Some(payload) = runtime_payload {
        let Value::Object(values) = payload else {
            return Err("Runtime tool-set payload must be a JSON object.".to_string());
        };
        merged.extend(values);
    }
    merged
        .entry("command".to_string())
        .or_insert_with(|| Value::String(child.slot.clone()));
    merged
        .entry("action".to_string())
        .or_insert_with(|| Value::String(child.slot.clone()));
    Ok(Value::Object(merged))
}

#[cfg(test)]
mod tests {
    use super::{
        blender_install_arguments, build_response, merge_toolset_payload, prepare_source,
        preserve_runtime_directory, validate_core_execution_target, validate_update_shape,
        PreparedSource, ScriptManifest, ToolsetManifest, SCRIPT_MANIFEST_FILE_NAME,
        TOOLSET_MANIFEST_FILE_NAME,
    };
    use crate::program_sources::manifest::{ProgramManifest, ProgramRunnerManifest};
    use crate::program_sources::records::{ActiveSourceChild, ActiveSourceRecord};
    use serde_json::json;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn collect_shipped_source_manifests(folder: &Path, output: &mut Vec<PathBuf>) {
        for entry in fs::read_dir(folder).expect("read source manifest folder") {
            let path = entry.expect("read source manifest entry").path();
            if path.is_dir() {
                collect_shipped_source_manifests(&path, output);
            } else if path
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| {
                    name == TOOLSET_MANIFEST_FILE_NAME || name == SCRIPT_MANIFEST_FILE_NAME
                })
                && path.components().any(|component| {
                    component
                        .as_os_str()
                        .to_string_lossy()
                        .ends_with(" Git Scripts")
                })
            {
                output.push(path);
            }
        }
    }

    fn record() -> ActiveSourceRecord {
        ActiveSourceRecord {
            schema_version: 1,
            owner_button_id: "button_1".into(),
            install_id: "button_1".into(),
            program_id: "blender".into(),
            program_name: "Blender".into(),
            panel_name: "Tools".into(),
            label: "Tool".into(),
            tooltip: String::new(),
            kind: "toolset".into(),
            local_package_path: String::new(),
            source_path: String::new(),
            runner: "blender-bridge".into(),
            runner_data: None,
            execution_target: None,
            bridge_action: "flowcell_button_button_1".into(),
            bridge_data: Some(json!({"axis":"X","shared":1})),
            events: None,
            children: vec![ActiveSourceChild {
                slot: "go".into(),
                label: "Go".into(),
                tooltip: String::new(),
                payload: Some(json!({"axis":"Y","child":2})),
                execution_target: None,
            }],
            layout: None,
            source_display_path: String::new(),
        }
    }

    fn windows_manifest() -> ProgramManifest {
        ProgramManifest {
            schema_version: 1,
            program_id: "windows".into(),
            label: "Windows".into(),
            program_type: "local-script".into(),
            process_names: vec!["explorer".into()],
            git_scripts_folder: "Windows Git Scripts".into(),
            panels_folder: "Panels".into(),
            local_scripts_folder: "Windows Local Scripts".into(),
            support_scripts_folder: "SupportScripts".into(),
            allowed_script_extensions: vec!["ps1".into(), "vbs".into()],
            allowed_manifest_file_names: vec![SCRIPT_MANIFEST_FILE_NAME.into()],
            supports_toolset_manifests: false,
            runner: ProgramRunnerManifest {
                kind: "windows-script".into(),
                program_key: "windows_generic".into(),
                install_script: String::new(),
                delete_script: String::new(),
            },
            addon_reload_notes: String::new(),
            app_restart_notes: String::new(),
        }
    }

    #[test]
    fn selected_package_entry_promotes_manifest_and_companion_is_rejected() {
        let root = std::env::temp_dir().join(format!(
            "flowcell-script-package-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("create script package");
        fs::write(root.join("entry.vbs"), "' entry\n").expect("write entry");
        fs::write(root.join("helper.ps1"), "# helper\n").expect("write helper");
        fs::write(
            root.join(SCRIPT_MANIFEST_FILE_NAME),
            r#"{
                "schemaVersion": 1,
                "id": "windows.test-package",
                "label": "Test Package",
                "program": "Windows",
                "source": "entry.vbs"
            }"#,
        )
        .expect("write manifest");
        let prepared = prepare_source(&windows_manifest(), &root.join("entry.vbs"), "script")
            .expect("promote entry to package");
        assert_eq!(prepared.package_source_root, root);
        assert_eq!(
            prepared.source_relative_to_package,
            PathBuf::from("entry.vbs")
        );
        assert!(prepare_source(&windows_manifest(), &root.join("helper.ps1"), "script").is_err());

        fs::remove_file(root.join(SCRIPT_MANIFEST_FILE_NAME)).expect("remove script manifest");
        fs::write(root.join(TOOLSET_MANIFEST_FILE_NAME), "{}").expect("write tool-set marker");
        let error = match prepare_source(&windows_manifest(), &root.join("entry.vbs"), "script") {
            Ok(_) => panic!("script import must reject a tool-set entry"),
            Err(error) => error,
        };
        assert!(error.contains("Use Add Tool Set"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn update_preserves_only_package_runtime_state() {
        let root = std::env::temp_dir().join(format!(
            "flowcell-runtime-preserve-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let previous = root.join("previous");
        let staging = root.join("staging");
        fs::create_dir_all(previous.join("runtime/nested")).expect("create previous runtime");
        fs::create_dir_all(staging.join("source")).expect("create staging source");
        fs::write(previous.join("runtime/nested/settings.txt"), "kept")
            .expect("write runtime state");
        fs::write(previous.join("source.txt"), "not copied").expect("write non-runtime source");
        preserve_runtime_directory(&previous, &staging).expect("preserve runtime");
        assert_eq!(
            fs::read_to_string(staging.join("runtime/nested/settings.txt"))
                .expect("read preserved state"),
            "kept"
        );
        assert!(!staging.join("source.txt").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn update_shape_keeps_role_and_toolset_slots_stable() {
        let previous = record();
        let mut prepared = PreparedSource {
            package_source_root: PathBuf::from("package"),
            source_relative_to_package: PathBuf::from("source.py"),
            label: "Tool".into(),
            tooltip: String::new(),
            kind: "toolset".into(),
            bridge_data: None,
            execution_target: None,
            events: None,
            children: previous.children.clone(),
            layout: None,
            runner_data: None,
        };
        assert!(validate_update_shape(&previous, &prepared).is_ok());
        prepared.children[0].slot = "other".into();
        assert!(validate_update_shape(&previous, &prepared).is_err());
        prepared.children.clear();
        assert!(validate_update_shape(&previous, &prepared).is_err());
    }

    #[test]
    fn runtime_payload_wins_and_slot_defaults_are_present() {
        let payload = merge_toolset_payload(&record(), "go", Some(json!({"axis":"Z","runtime":3})))
            .expect("payload");
        assert_eq!(payload["axis"], "Z");
        assert_eq!(payload["shared"], 1);
        assert_eq!(payload["child"], 2);
        assert_eq!(payload["runtime"], 3);
        assert_eq!(payload["command"], "go");
        assert_eq!(payload["action"], "go");
    }

    #[test]
    fn blender_install_receives_manifest_bridge_data() {
        let arguments = blender_install_arguments(
            Path::new("Install-BlenderFlowCellButtons.ps1"),
            "button_1",
            "Tools",
            Path::new("theme.py"),
            Some(&json!({"capabilities":["restore-project-theme-state"]})),
        )
        .expect("arguments");
        let value_index = arguments
            .iter()
            .position(|argument| argument == "-BridgeDataJson")
            .expect("BridgeDataJson argument")
            + 1;
        let bridge_data: serde_json::Value =
            serde_json::from_str(&arguments[value_index]).expect("bridgeData JSON");
        assert_eq!(
            bridge_data["capabilities"],
            json!(["restore-project-theme-state"])
        );
    }

    #[test]
    fn script_core_action_receives_installed_owner_identity() {
        let mut source = record();
        source.program_id = "illustrator".into();
        source.program_name = "Illustrator".into();
        source.panel_name = "Layers".into();
        source.runner = "illustrator-direct".into();
        source.kind = "script".into();
        source.children.clear();
        source.execution_target = Some(json!({
            "kind": "core-action",
            "actionId": "open-illustrator-layer-tree"
        }));
        let response = build_response(&source, "button_1.flowcell-source.json".into());
        let target = response.owner.execution_target.expect("execution target");
        assert_eq!(target["kind"], "core-action");
        assert_eq!(target["payload"]["programName"], "Illustrator");
        assert_eq!(target["payload"]["panelName"], "Layers");
        assert_eq!(
            target["payload"]["fileName"],
            "button_1.flowcell-source.json"
        );
        assert_eq!(target["payload"]["ownerButtonId"], "button_1");
    }

    #[test]
    fn catalog_manifests_cannot_name_arbitrary_core_actions() {
        assert!(validate_core_execution_target(
            "script package",
            &json!({
                "kind": "core-action",
                "actionId": "open-illustrator-layer-tree"
            })
        )
        .is_ok());
        assert!(validate_core_execution_target(
            "script package",
            &json!({
                "kind": "core-action",
                "actionId": "open-window-grid"
            })
        )
        .is_ok());
        assert!(validate_core_execution_target(
            "script package",
            &json!({
                "kind": "core-action",
                "actionId": "frontend-macro:unowned"
            })
        )
        .is_err());
    }

    #[test]
    fn every_shipped_source_manifest_matches_the_strict_schema() {
        let programs_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("Programs");
        let mut manifests = Vec::new();
        collect_shipped_source_manifests(&programs_root, &mut manifests);
        manifests.sort();
        assert!(!manifests.is_empty(), "no shipped source manifests found");

        for path in manifests {
            let raw = fs::read_to_string(&path).expect("read shipped source manifest");
            match path.file_name().and_then(|value| value.to_str()) {
                Some(TOOLSET_MANIFEST_FILE_NAME) => {
                    serde_json::from_str::<ToolsetManifest>(&raw).unwrap_or_else(|error| {
                        panic!("{} does not match ToolsetManifest: {error}", path.display())
                    });
                }
                Some(SCRIPT_MANIFEST_FILE_NAME) => {
                    serde_json::from_str::<ScriptManifest>(&raw).unwrap_or_else(|error| {
                        panic!("{} does not match ScriptManifest: {error}", path.display())
                    });
                }
                _ => unreachable!("unexpected source manifest path"),
            }
        }
    }
}
