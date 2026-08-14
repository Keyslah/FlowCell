use super::installed_page::{
    reject_package_source_reparse_point, reject_selected_source_reparse_point,
    validate_and_normalize_page_manifest, InstalledPageManifest,
};
use super::manifest::{
    extension_is_allowed, load_program_manifest, normalize_import_kind, ProgramManifest,
};
use super::records::{
    active_record_file_name, atomic_replace_json, atomic_write_json, empty_object,
    read_active_record, recover_active_record, validate_owner_button_id,
    validate_toolset_state_query, ActiveSourceChild, ActiveSourceRecord, LocalInstallRecord,
    ToolsetStateQuery, INSTALL_RECORD_FILE_NAME,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const TOOLSET_MANIFEST_FILE_NAME: &str = "flowcell.toolset.json";
const SCRIPT_MANIFEST_FILE_NAME: &str = "flowcell.script.json";
const INSTALL_TRANSACTION_PREFIX: &str = ".flowcell-install-transaction-";
const INSTALL_TRANSACTION_JOURNAL_FILE_NAME: &str = "journal.json";
const INSTALL_TRANSACTION_NEW_PACKAGE: &str = "new-package";
const INSTALL_TRANSACTION_OLD_PACKAGE: &str = "old-package";
const INSTALL_TRANSACTION_DISCARD_PACKAGE: &str = "discard-package";
const INSTALL_TRANSACTION_DISCARD_ACTIVE: &str = "discard-active.json";
const INSTALL_TRANSACTION_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum InstallTransactionPhase {
    Prepared,
    CommitPending,
    AwaitingCanonical,
    Committed,
    RolledBack,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum InstallTransactionCompletionMode {
    #[default]
    Immediate,
    AwaitCanonical,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalSourceProjection {
    owner_button_id: String,
    role: String,
    source_identity: Value,
    execution_target: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_revision: Option<String>,
}

#[derive(Clone, Debug)]
struct DeferredCanonicalUpdate {
    previous_projection: CanonicalSourceProjection,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CanonicalUpdateDisposition {
    Finalize,
    RollBack,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InstallTransactionJournal {
    schema_version: u32,
    phase: InstallTransactionPhase,
    replace_existing: bool,
    owner_button_id: String,
    program_id: String,
    program_name: String,
    panel_name: String,
    previous_record: Option<ActiveSourceRecord>,
    previous_install: Option<LocalInstallRecord>,
    next_record: ActiveSourceRecord,
    next_install: LocalInstallRecord,
    #[serde(default)]
    completion_mode: InstallTransactionCompletionMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    previous_canonical_projection: Option<CanonicalSourceProjection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    next_canonical_projection: Option<CanonicalSourceProjection>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallButtonSourceRequest {
    pub owner_button_id: String,
    pub program_name: String,
    pub panel_name: String,
    pub source_path: String,
    #[serde(default)]
    pub import_kind: String,
    #[serde(default)]
    pub bundled_source_id: Option<String>,
    #[serde(default)]
    pub bundled_source_version: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_transaction_token: Option<String>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    state_query: Option<ToolsetStateQuery>,
    children: Vec<ToolsetChildManifest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    layout: Option<ToolsetLayoutManifest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    events: Option<BTreeMap<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    execution: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ToolsetLayoutManifest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    width: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    height: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    columns: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    gap: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    padding: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    placements: Option<BTreeMap<String, ToolsetLayoutRectManifest>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    fields: Option<Vec<ToolsetFieldManifest>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    child_behaviors: Option<BTreeMap<String, ToolsetChildBehaviorManifest>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    update_policy: Option<ToolsetUpdatePolicyManifest>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ToolsetLayoutRectManifest {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ToolsetFieldOptionManifest {
    id: String,
    label: String,
    value: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ToolsetFieldManifest {
    id: String,
    kind: String,
    label: String,
    payload_key: String,
    default_value: Value,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    z_index: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    hidden: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    disabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    service_trigger: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    service_target: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    placeholder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    minimum: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    maximum: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    step: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    options: Option<Vec<ToolsetFieldOptionManifest>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    path_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    filter: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    format: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ToolsetChildBehaviorManifest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    toggle_fields: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    field_patch: Option<BTreeMap<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    activation_patch: Option<BTreeMap<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    activate_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    inline_edit_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    select_field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    execute: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    payload_template: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ToolsetUpdatePolicyManifest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    append_missing_child_slots: Option<bool>,
}

fn validate_toolset_layout_number(value: f64, subject: &str) -> Result<(), String> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(format!(
            "Tool-set layout {subject} must be a finite number."
        ))
    }
}

fn validate_toolset_layout_rect(
    rect: &ToolsetLayoutRectManifest,
    subject: &str,
) -> Result<(), String> {
    validate_toolset_layout_number(rect.x, &format!("{subject}.x"))?;
    validate_toolset_layout_number(rect.y, &format!("{subject}.y"))?;
    validate_toolset_layout_number(rect.width, &format!("{subject}.width"))?;
    validate_toolset_layout_number(rect.height, &format!("{subject}.height"))?;
    if rect.width <= 0.0 || rect.height <= 0.0 {
        return Err(format!(
            "Tool-set layout {subject} must have positive width and height."
        ));
    }
    Ok(())
}

fn toolset_json_primitive(value: &Value) -> bool {
    value.is_null() || value.is_boolean() || value.is_number() || value.is_string()
}

fn validate_toolset_service_target(target: &Value, subject: &str) -> Result<(), String> {
    let object = target
        .as_object()
        .ok_or_else(|| format!("Tool-set layout {subject} must be a JSON object."))?;
    match object.get("kind").and_then(Value::as_str) {
        Some("core-action") => {
            let supported = ["kind", "actionId", "payload", "events"];
            if let Some(key) = object.keys().find(|key| !supported.contains(&key.as_str())) {
                return Err(format!("Tool-set layout {subject}.{key} is not supported."));
            }
            validate_core_execution_target(subject, target)
        }
        Some("tool-set-action") => {
            for key in ["programName", "panelName", "ownerFileName", "command"] {
                if object
                    .get(key)
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .is_none()
                {
                    return Err(format!(
                        "Tool-set layout {subject} tool-set-action is missing {key}."
                    ));
                }
            }
            if object
                .get("payload")
                .is_some_and(|value| !value.is_object())
            {
                return Err(format!(
                    "Tool-set layout {subject}.payload must be a JSON object."
                ));
            }
            if object.get("events").is_some_and(|value| !value.is_object()) {
                return Err(format!(
                    "Tool-set layout {subject}.events must be a JSON object."
                ));
            }
            let supported = [
                "kind",
                "programName",
                "panelName",
                "ownerFileName",
                "command",
                "payload",
                "events",
            ];
            if let Some(key) = object.keys().find(|key| !supported.contains(&key.as_str())) {
                return Err(format!("Tool-set layout {subject}.{key} is not supported."));
            }
            Ok(())
        }
        _ => Err(format!(
            "Tool-set layout {subject}.kind must be 'core-action' or 'tool-set-action'."
        )),
    }
}

fn validate_toolset_field(field: &ToolsetFieldManifest, index: usize) -> Result<(), String> {
    let subject = format!("fields[{index}]");
    if field.id.trim().is_empty() {
        return Err(format!("Tool-set layout {subject}.id cannot be empty."));
    }
    validate_toolset_layout_rect(
        &ToolsetLayoutRectManifest {
            x: field.x,
            y: field.y,
            width: field.width,
            height: field.height,
        },
        &subject,
    )?;
    if let Some(target) = field.service_target.as_ref() {
        validate_toolset_service_target(target, &format!("{subject}.serviceTarget"))?;
    }
    if let Some(trigger) = field.service_trigger.as_deref() {
        if trigger != "change" && trigger != "activate" {
            return Err(format!(
                "Tool-set layout {subject}.serviceTrigger must be 'change' or 'activate'."
            ));
        }
    }

    let reject_irrelevant = |present: bool, key: &str| {
        if present {
            Err(format!(
                "Tool-set layout {subject}.{key} is not supported for kind '{}'.",
                field.kind
            ))
        } else {
            Ok(())
        }
    };
    match field.kind.as_str() {
        "text" => {
            if !field.default_value.is_string() {
                return Err(format!(
                    "Tool-set layout {subject}.defaultValue must be a string."
                ));
            }
            reject_irrelevant(
                field.minimum.is_some()
                    || field.maximum.is_some()
                    || field.step.is_some()
                    || field.options.is_some()
                    || field.path_kind.is_some()
                    || field.filter.is_some()
                    || field.format.is_some(),
                "kind-specific property",
            )?;
        }
        "number" => {
            let value = field.default_value.as_f64().ok_or_else(|| {
                format!("Tool-set layout {subject}.defaultValue must be a finite number.")
            })?;
            validate_toolset_layout_number(value, &format!("{subject}.defaultValue"))?;
            if let (Some(minimum), Some(maximum)) = (field.minimum, field.maximum) {
                if minimum > maximum {
                    return Err(format!(
                        "Tool-set layout {subject}.minimum cannot exceed maximum."
                    ));
                }
            }
            if field.step.is_some_and(|step| step <= 0.0) {
                return Err(format!("Tool-set layout {subject}.step must be positive."));
            }
            reject_irrelevant(
                field.placeholder.is_some()
                    || field.options.is_some()
                    || field.path_kind.is_some()
                    || field.filter.is_some()
                    || field.format.is_some(),
                "kind-specific property",
            )?;
        }
        "select" => {
            if !toolset_json_primitive(&field.default_value) {
                return Err(format!(
                    "Tool-set layout {subject}.defaultValue must be a JSON primitive."
                ));
            }
            let options = field
                .options
                .as_ref()
                .filter(|values| !values.is_empty())
                .ok_or_else(|| {
                    format!("Tool-set layout {subject}.options must be a non-empty array.")
                })?;
            let mut ids = Vec::<String>::new();
            let mut values = Vec::<Value>::new();
            for (option_index, option) in options.iter().enumerate() {
                if option.id.trim().is_empty() || option.label.trim().is_empty() {
                    return Err(format!(
                        "Tool-set layout {subject}.options[{option_index}] requires non-empty id and label."
                    ));
                }
                let id = option.id.trim().to_ascii_lowercase();
                if ids.contains(&id) {
                    return Err(format!(
                        "Tool-set layout {subject}.options[{option_index}].id is duplicated."
                    ));
                }
                if !toolset_json_primitive(&option.value) {
                    return Err(format!(
                        "Tool-set layout {subject}.options[{option_index}].value must be a JSON primitive."
                    ));
                }
                if values.contains(&option.value) {
                    return Err(format!(
                        "Tool-set layout {subject}.options[{option_index}].value is duplicated."
                    ));
                }
                ids.push(id);
                values.push(option.value.clone());
            }
            if !values.contains(&field.default_value) {
                return Err(format!(
                    "Tool-set layout {subject}.defaultValue must match exactly one option value."
                ));
            }
            reject_irrelevant(
                field.placeholder.is_some()
                    || field.minimum.is_some()
                    || field.maximum.is_some()
                    || field.step.is_some()
                    || field.path_kind.is_some()
                    || field.filter.is_some()
                    || field.format.is_some(),
                "kind-specific property",
            )?;
        }
        "toggle" => {
            if !field.default_value.is_boolean() {
                return Err(format!(
                    "Tool-set layout {subject}.defaultValue must be boolean."
                ));
            }
            reject_irrelevant(
                field.placeholder.is_some()
                    || field.minimum.is_some()
                    || field.maximum.is_some()
                    || field.step.is_some()
                    || field.options.is_some()
                    || field.path_kind.is_some()
                    || field.filter.is_some()
                    || field.format.is_some(),
                "kind-specific property",
            )?;
        }
        "path" => {
            if !field.default_value.is_string() {
                return Err(format!(
                    "Tool-set layout {subject}.defaultValue must be a string."
                ));
            }
            if !matches!(field.path_kind.as_deref(), Some("file" | "folder")) {
                return Err(format!(
                    "Tool-set layout {subject}.pathKind must be 'file' or 'folder'."
                ));
            }
            reject_irrelevant(
                field.placeholder.is_some()
                    || field.minimum.is_some()
                    || field.maximum.is_some()
                    || field.step.is_some()
                    || field.options.is_some()
                    || field.format.is_some(),
                "kind-specific property",
            )?;
        }
        "color" => {
            if !field.default_value.is_string() {
                return Err(format!(
                    "Tool-set layout {subject}.defaultValue must be a string."
                ));
            }
            reject_irrelevant(
                field.placeholder.is_some()
                    || field.minimum.is_some()
                    || field.maximum.is_some()
                    || field.step.is_some()
                    || field.options.is_some()
                    || field.path_kind.is_some()
                    || field.filter.is_some()
                    || field.format.is_some(),
                "kind-specific property",
            )?;
        }
        "display" => {
            if !toolset_json_primitive(&field.default_value) {
                return Err(format!(
                    "Tool-set layout {subject}.defaultValue must be a JSON primitive."
                ));
            }
            reject_irrelevant(
                field.placeholder.is_some()
                    || field.minimum.is_some()
                    || field.maximum.is_some()
                    || field.step.is_some()
                    || field.options.is_some()
                    || field.path_kind.is_some()
                    || field.filter.is_some(),
                "kind-specific property",
            )?;
        }
        _ => {
            return Err(format!(
                "Tool-set layout {subject}.kind '{}' is not supported.",
                field.kind
            ))
        }
    }
    Ok(())
}

fn validate_toolset_layout(
    layout: &ToolsetLayoutManifest,
    children: &[ActiveSourceChild],
) -> Result<(), String> {
    if let Some(width) = layout.width {
        validate_toolset_layout_number(width, "width")?;
        if width <= 0.0 {
            return Err("Tool-set layout width must be positive.".to_string());
        }
    }
    if let Some(height) = layout.height {
        validate_toolset_layout_number(height, "height")?;
        if height <= 0.0 {
            return Err("Tool-set layout height must be positive.".to_string());
        }
    }
    if let Some(mode) = layout.mode.as_deref() {
        if mode != "grid" {
            return Err("Tool-set layout mode must be 'grid'.".to_string());
        }
    }
    if layout.columns == Some(0) {
        return Err("Tool-set layout columns must be positive.".to_string());
    }
    for (name, value) in [("gap", layout.gap), ("padding", layout.padding)] {
        if let Some(value) = value {
            validate_toolset_layout_number(value, name)?;
            if value < 0.0 {
                return Err(format!("Tool-set layout {name} cannot be negative."));
            }
        }
    }
    let child_exists = |slot: &str| {
        children
            .iter()
            .any(|child| child.slot.eq_ignore_ascii_case(slot.trim()))
    };
    if let Some(placements) = layout.placements.as_ref() {
        for (slot, rect) in placements {
            if slot.trim().is_empty() || !child_exists(slot) {
                return Err(format!(
                    "Tool-set layout placement '{slot}' does not name a declared child slot."
                ));
            }
            validate_toolset_layout_rect(rect, &format!("placements.{slot}"))?;
        }
    }
    let mut field_ids = Vec::<String>::new();
    let fields = layout.fields.as_deref().unwrap_or_default();
    for (index, field) in fields.iter().enumerate() {
        validate_toolset_field(field, index)?;
        let id = field.id.trim().to_ascii_lowercase();
        if field_ids.contains(&id) {
            return Err(format!(
                "Tool-set layout field '{}' is duplicated.",
                field.id
            ));
        }
        field_ids.push(id);
    }
    let field_exists = |field_id: &str| {
        field_ids
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(field_id.trim()))
    };
    if let Some(behaviors) = layout.child_behaviors.as_ref() {
        for (slot, behavior) in behaviors {
            if slot.trim().is_empty() || !child_exists(slot) {
                return Err(format!(
                    "Tool-set layout childBehavior '{slot}' does not name a declared child slot."
                ));
            }
            if behavior
                .payload_template
                .as_ref()
                .is_some_and(|value| !value.is_object())
            {
                return Err(format!(
                    "Tool-set layout childBehaviors.{slot}.payloadTemplate must be a JSON object."
                ));
            }
            let mut references = Vec::<&str>::new();
            references.extend(
                behavior
                    .toggle_fields
                    .as_deref()
                    .unwrap_or_default()
                    .iter()
                    .map(String::as_str),
            );
            references.extend(
                behavior
                    .field_patch
                    .as_ref()
                    .into_iter()
                    .flat_map(|patch| patch.keys().map(String::as_str)),
            );
            references.extend(
                behavior
                    .activation_patch
                    .as_ref()
                    .into_iter()
                    .flat_map(|patch| patch.keys().map(String::as_str)),
            );
            references.extend(behavior.activate_field.as_deref());
            references.extend(behavior.inline_edit_field.as_deref());
            references.extend(behavior.select_field.as_deref());
            if let Some(reference) = references
                .into_iter()
                .find(|reference| !field_exists(reference))
            {
                return Err(format!(
                    "Tool-set layout childBehaviors.{slot} references unknown field '{reference}'."
                ));
            }
            if let Some(template) = behavior.payload_template.as_ref() {
                validate_toolset_payload_template_fields(
                    template,
                    &field_exists,
                    &format!("childBehaviors.{slot}.payloadTemplate"),
                )?;
            }
            if behavior.inline_edit_field.is_some() && behavior.select_field.is_some() {
                return Err(format!(
                    "Tool-set layout childBehaviors.{slot} cannot declare both inlineEditField and selectField."
                ));
            }
            if let Some(field_id) = behavior.select_field.as_deref() {
                let field = fields
                    .iter()
                    .find(|field| field.id.eq_ignore_ascii_case(field_id))
                    .expect("field reference was validated");
                if field.kind != "select" || behavior.execute != Some(false) {
                    return Err(format!(
                        "Tool-set layout childBehaviors.{slot}.selectField requires a select field and execute false."
                    ));
                }
            }
            if let Some(field_id) = behavior.inline_edit_field.as_deref() {
                let field = fields
                    .iter()
                    .find(|field| field.id.eq_ignore_ascii_case(field_id))
                    .expect("field reference was validated");
                if !matches!(field.kind.as_str(), "text" | "number")
                    || behavior.execute != Some(false)
                {
                    return Err(format!(
                        "Tool-set layout childBehaviors.{slot}.inlineEditField requires a text or number field and execute false."
                    ));
                }
            }
        }
    }
    Ok(())
}

fn validate_toolset_payload_template_fields<F>(
    value: &Value,
    field_exists: &F,
    subject: &str,
) -> Result<(), String>
where
    F: Fn(&str) -> bool,
{
    match value {
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                validate_toolset_payload_template_fields(
                    value,
                    field_exists,
                    &format!("{subject}[{index}]"),
                )?;
            }
        }
        Value::Object(object) => {
            if let Some(reference) = object.get("$field") {
                let field_id = reference
                    .as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| {
                        format!("Tool-set layout {subject} has an invalid $field reference.")
                    })?;
                if object.len() != 1 || !field_exists(field_id) {
                    return Err(format!(
                        "Tool-set layout {subject} references unknown field '{field_id}'."
                    ));
                }
            } else {
                for (key, value) in object {
                    validate_toolset_payload_template_fields(
                        value,
                        field_exists,
                        &format!("{subject}.{key}"),
                    )?;
                }
            }
        }
        _ => {}
    }
    Ok(())
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    page: Option<InstalledPageManifest>,
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

const CATALOG_CORE_ACTION_IDS: &[&str] = &["open-installed-page", "open-window-grid"];

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
    if action_id.eq_ignore_ascii_case("open-installed-page") {
        return Err(
            "open-installed-page is reserved for a validated flowcell.script.json page declaration."
                .to_string(),
        );
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
    state_query: Option<ToolsetStateQuery>,
    execution_target: Option<Value>,
    events: Option<BTreeMap<String, Value>>,
    children: Vec<ActiveSourceChild>,
    layout: Option<Value>,
    page: Option<InstalledPageManifest>,
    runner_data: Option<Value>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreflightButtonSource {
    pub label: String,
    pub tooltip: String,
    pub import_kind: String,
    pub source_kind: String,
    pub child_slots: Vec<String>,
}

pub(crate) fn preflight_button_source(
    program_name: &str,
    source_path: &Path,
    import_kind: &str,
) -> Result<PreflightButtonSource, String> {
    reject_selected_source_reparse_point(source_path)?;
    let source_path = source_path.canonicalize().map_err(|error| {
        format!(
            "Selected Button source '{}' could not be resolved: {error}",
            source_path.display()
        )
    })?;
    let requested_import_kind = normalize_import_kind(import_kind)?;
    let resolved_import_kind = if requested_import_kind == "auto" {
        detect_import_kind(&source_path)?
    } else {
        requested_import_kind
    };
    let manifest = load_program_manifest(program_name)?;
    let prepared = prepare_source(&manifest, &source_path, resolved_import_kind)?;
    let source_kind = if prepared.page.is_some() {
        "page"
    } else if prepared.children.is_empty() {
        "script"
    } else {
        "tool-set"
    };
    Ok(PreflightButtonSource {
        label: prepared.label,
        tooltip: prepared.tooltip,
        import_kind: resolved_import_kind.to_string(),
        source_kind: source_kind.to_string(),
        child_slots: prepared
            .children
            .iter()
            .map(|child| child.slot.clone())
            .collect(),
    })
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
    let previous_is_page = previous.page.is_some();
    let next_is_page = prepared.page.is_some();
    if previous_is_page != next_is_page {
        return Err(
            "Update cannot change an ordinary script Button into a Page Button or a Page Button into an ordinary script Button. Delete and re-add it so the installed Page contract can change safely."
                .to_string(),
        );
    }
    if let (Some(previous_page), Some(next_page)) = (previous.page.as_ref(), prepared.page.as_ref())
    {
        if previous_page.id != next_page.id {
            return Err(format!(
                "Update cannot change installed Page id '{}' to '{}'. Delete and re-add the Page Button so its owner state stays compatible.",
                previous_page.id, next_page.id
            ));
        }
        if previous_page.owner_state_format != next_page.owner_state_format {
            return Err(format!(
                "Update cannot change installed Page ownerStateFormat '{}' to '{}'. Delete and re-add the Page Button so its owner state stays compatible.",
                previous_page.owner_state_format, next_page.owner_state_format
            ));
        }
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
    let append_missing_slots = prepared
        .layout
        .as_ref()
        .and_then(|layout| layout.get("updatePolicy"))
        .and_then(|policy| policy.get("appendMissingChildSlots"))
        .and_then(Value::as_bool)
        == Some(true);
    let append_is_safe = append_missing_slots
        && previous_slots
            .iter()
            .all(|slot| next_slots.binary_search(slot).is_ok());
    if previous_slots != next_slots && !append_is_safe {
        return Err(format!(
            "Update cannot add, remove, or rename tool-set child slots. Installed: [{}]. Selected: [{}]. Delete and re-add the tool set to change its Button graph.",
            previous_slots.join(", "),
            next_slots.join(", ")
        ));
    }
    Ok(())
}

fn execution_target_with_source_identity(
    mut target: Value,
    record: &ActiveSourceRecord,
    file_name: &str,
) -> Value {
    let Some(target_object) = target.as_object_mut() else {
        return target;
    };
    if target_object.get("kind").and_then(Value::as_str) != Some("core-action") {
        return target;
    }
    let payload = target_object.entry("payload").or_insert_with(|| json!({}));
    if let Some(payload_object) = payload.as_object_mut() {
        payload_object.insert("programName".to_string(), json!(record.program_name));
        payload_object.insert("panelName".to_string(), json!(record.panel_name));
        payload_object.insert("fileName".to_string(), json!(file_name));
        payload_object.insert("ownerButtonId".to_string(), json!(record.owner_button_id));
    }
    target
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

fn recognized_root_manifest(
    folder: &Path,
    manifest_file_name: &str,
) -> Result<Option<PathBuf>, String> {
    let mut matches = Vec::new();
    for entry in fs::read_dir(folder).map_err(|error| {
        format!(
            "Failed to inspect source folder {}: {error}",
            folder.display()
        )
    })? {
        let entry = entry.map_err(|error| {
            format!(
                "Failed to inspect source folder {}: {error}",
                folder.display()
            )
        })?;
        if entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.eq_ignore_ascii_case(manifest_file_name))
        {
            let path = entry.path();
            reject_selected_source_reparse_point(&path)?;
            if !entry
                .file_type()
                .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?
                .is_file()
            {
                return Err(format!(
                    "Recognized source manifest path is not a file: {}.",
                    path.display()
                ));
            }
            matches.push(path);
        }
    }
    match matches.len() {
        0 => Ok(None),
        1 => Ok(matches.pop()),
        _ => Err(format!(
            "Source folder '{}' contains multiple case-insensitive matches for {}.",
            folder.display(),
            manifest_file_name
        )),
    }
}

fn detect_import_kind(source_path: &Path) -> Result<&'static str, String> {
    if source_path.is_file() {
        let parent = source_path
            .parent()
            .ok_or_else(|| "Selected Button source has no parent folder.".to_string())?;
        let script_manifest = recognized_root_manifest(parent, SCRIPT_MANIFEST_FILE_NAME)?;
        let toolset_manifest = recognized_root_manifest(parent, TOOLSET_MANIFEST_FILE_NAME)?;
        if script_manifest.is_some() && toolset_manifest.is_some() {
            return Err(format!(
                "Source folder '{}' is ambiguous because it contains both {} and {}.",
                parent.display(),
                SCRIPT_MANIFEST_FILE_NAME,
                TOOLSET_MANIFEST_FILE_NAME
            ));
        }
        let file_name = source_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if file_name.eq_ignore_ascii_case(SCRIPT_MANIFEST_FILE_NAME) {
            return Ok("script");
        }
        if file_name.eq_ignore_ascii_case(TOOLSET_MANIFEST_FILE_NAME) {
            return Ok("tool-set");
        }
        return Ok(if toolset_manifest.is_some() {
            "tool-set"
        } else {
            "script"
        });
    }
    if !source_path.is_dir() {
        return Err(format!(
            "Selected Button source was not found: {}.",
            source_path.display()
        ));
    }
    let script_manifest = recognized_root_manifest(source_path, SCRIPT_MANIFEST_FILE_NAME)?;
    let toolset_manifest = recognized_root_manifest(source_path, TOOLSET_MANIFEST_FILE_NAME)?;
    match (script_manifest, toolset_manifest) {
        (Some(_), None) => Ok("script"),
        (None, Some(_)) => Ok("tool-set"),
        (Some(_), Some(_)) => Err(format!(
            "Source folder '{}' is ambiguous because it contains both {} and {}.",
            source_path.display(),
            SCRIPT_MANIFEST_FILE_NAME,
            TOOLSET_MANIFEST_FILE_NAME
        )),
        (None, None) => Err(format!(
            "Source folder '{}' contains neither {} nor {} at its root.",
            source_path.display(),
            SCRIPT_MANIFEST_FILE_NAME,
            TOOLSET_MANIFEST_FILE_NAME
        )),
    }
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
                "'{}' belongs to a tool-set package. Use Add Button and select its {}.",
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
            if script.page.is_some() && script.execution_target.is_some() {
                return Err(
                    "A page-enabled script package cannot also declare executionTarget; FlowCell supplies its generic installed-page opener."
                        .to_string(),
                );
            }
            if let Some(execution_target) = script.execution_target.as_ref() {
                validate_core_execution_target("script package", execution_target)?;
            }
            let mut page = script.page;
            if let Some(page_manifest) = page.as_mut() {
                validate_and_normalize_page_manifest(page_manifest, package_root, &manifest.label)?;
            }
            let execution_target = page
                .as_ref()
                .map(|page_manifest| {
                    json!({
                        "kind": "core-action",
                        "actionId": "open-installed-page",
                        "payload": { "pageId": page_manifest.id }
                    })
                })
                .or(script.execution_target);
            let _manifest_id = script.id;
            return Ok(PreparedSource {
                package_source_root: package_root.to_path_buf(),
                source_relative_to_package: source_relative,
                label: script.label.trim().to_string(),
                tooltip: script.tooltip.trim().to_string(),
                kind: "script".to_string(),
                bridge_data: script.bridge_data,
                state_query: None,
                execution_target,
                events: script.events,
                children: Vec::new(),
                layout: None,
                page,
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
            state_query: None,
            execution_target: None,
            events: None,
            children: Vec::new(),
            layout: None,
            page: None,
            runner_data: None,
        });
    }

    if !manifest.supports_toolset_manifests {
        return Err(format!(
            "{} does not support tool-set manifests.",
            manifest.label
        ));
    }
    let selected_package_file = source_path
        .is_file()
        .then(|| source_path.to_path_buf())
        .filter(|path| {
            !path
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case(TOOLSET_MANIFEST_FILE_NAME))
                .unwrap_or(false)
        });
    let manifest_path = if source_path.is_dir() {
        source_path.join(TOOLSET_MANIFEST_FILE_NAME)
    } else if source_path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case(TOOLSET_MANIFEST_FILE_NAME))
        .unwrap_or(false)
    {
        source_path.to_path_buf()
    } else if let Some(parent) = source_path.parent() {
        let sibling = parent.join(TOOLSET_MANIFEST_FILE_NAME);
        if sibling.is_file() {
            sibling
        } else {
            return Err(format!(
                "Tool-set import requires a folder, declared entry file, or {} file.",
                TOOLSET_MANIFEST_FILE_NAME
            ));
        }
    } else {
        return Err(format!(
            "Tool-set import requires a folder, declared entry file, or {} file.",
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
    if let Some(selected) = selected_package_file.as_ref() {
        let selected = selected.canonicalize().map_err(|error| {
            format!(
                "Selected package file '{}' could not be resolved: {error}",
                selected.display()
            )
        })?;
        let executable = executable.canonicalize().map_err(|error| {
            format!(
                "Tool-set package source '{}' could not be resolved: {error}",
                executable.display()
            )
        })?;
        if selected != executable {
            return Err(format!(
                "'{}' is a companion file in a tool-set package. Add the declared source '{}' or its {} instead.",
                selected.display(),
                executable.display(),
                TOOLSET_MANIFEST_FILE_NAME
            ));
        }
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
    let state_query = toolset
        .state_query
        .as_ref()
        .map(|query| validate_toolset_state_query(query, &children))
        .transpose()?;
    let layout = toolset
        .layout
        .as_ref()
        .map(|layout| {
            validate_toolset_layout(layout, &children)?;
            serde_json::to_value(layout)
                .map_err(|error| format!("Failed to serialize tool-set layout: {error}"))
        })
        .transpose()?;
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
        state_query,
        execution_target: None,
        events: toolset.events,
        children,
        layout,
        page: None,
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
        reject_package_source_reparse_point(&entry.path())?;
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

fn install_transaction_journal_path(transaction_root: &Path) -> PathBuf {
    transaction_root.join(INSTALL_TRANSACTION_JOURNAL_FILE_NAME)
}

fn install_transaction_new_package(transaction_root: &Path) -> PathBuf {
    transaction_root.join(INSTALL_TRANSACTION_NEW_PACKAGE)
}

fn install_transaction_old_package(transaction_root: &Path) -> PathBuf {
    transaction_root.join(INSTALL_TRANSACTION_OLD_PACKAGE)
}

fn install_transaction_discard_package(transaction_root: &Path) -> PathBuf {
    transaction_root.join(INSTALL_TRANSACTION_DISCARD_PACKAGE)
}

fn install_transaction_discard_active(transaction_root: &Path) -> PathBuf {
    transaction_root.join(INSTALL_TRANSACTION_DISCARD_ACTIVE)
}

fn serialized_values_match<T: Serialize>(left: &T, right: &T) -> bool {
    match (serde_json::to_value(left), serde_json::to_value(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn active_record_matches_next(
    candidate: &ActiveSourceRecord,
    expected: &ActiveSourceRecord,
) -> bool {
    let mut candidate = candidate.clone();
    candidate.bridge_action = expected.bridge_action.clone();
    serialized_values_match(&candidate, expected)
}

fn read_local_install_record(package_root: &Path) -> Result<LocalInstallRecord, String> {
    let path = package_root.join(INSTALL_RECORD_FILE_NAME);
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let record = serde_json::from_str::<LocalInstallRecord>(&raw)
        .map_err(|error| format!("Install record {} is invalid: {error}", path.display()))?;
    if record.schema_version != 1 {
        return Err(format!(
            "Install record {} has unsupported schemaVersion {}.",
            path.display(),
            record.schema_version
        ));
    }
    validate_owner_button_id(&record.owner_button_id)?;
    Ok(record)
}

fn package_matches_install_record(
    package_root: &Path,
    expected: &LocalInstallRecord,
) -> Result<bool, String> {
    if !package_root.exists() {
        return Ok(false);
    }
    if !package_root.is_dir() {
        return Err(format!(
            "Install package path is not a directory: {}.",
            package_root.display()
        ));
    }
    Ok(serialized_values_match(
        &read_local_install_record(package_root)?,
        expected,
    ))
}

fn normalized_relative_path(path: &str) -> String {
    path.replace('/', "\\").to_ascii_lowercase()
}

fn previous_owned_record_path_matches(
    recorded: &str,
    expected_relative: &str,
    expected_absolute: &Path,
) -> bool {
    if normalized_relative_path(recorded) == normalized_relative_path(expected_relative) {
        return true;
    }

    let recorded_absolute =
        crate::commands::execution::windows_child_process_path(Path::new(recorded));
    let expected_absolute =
        crate::commands::execution::windows_child_process_path(expected_absolute);
    normalized_relative_path(
        recorded_absolute
            .to_string_lossy()
            .trim_end_matches(['/', '\\']),
    ) == normalized_relative_path(
        expected_absolute
            .to_string_lossy()
            .trim_end_matches(['/', '\\']),
    )
}

fn validate_install_transaction_journal(
    manifest: &ProgramManifest,
    program_root: &Path,
    journal: &InstallTransactionJournal,
) -> Result<(), String> {
    if journal.schema_version != INSTALL_TRANSACTION_SCHEMA_VERSION {
        return Err(format!(
            "Install transaction has unsupported schemaVersion {}.",
            journal.schema_version
        ));
    }
    let owner = validate_owner_button_id(&journal.owner_button_id)?;
    let panel = crate::validate_folder_name(&journal.panel_name, "Panel")?;
    if !journal
        .program_id
        .eq_ignore_ascii_case(&manifest.program_id)
        || !journal.program_name.eq_ignore_ascii_case(&manifest.label)
    {
        return Err("Install transaction does not belong to this Program manifest.".to_string());
    }
    if journal.replace_existing
        != (journal.previous_record.is_some() && journal.previous_install.is_some())
    {
        return Err(
            "Install transaction previous-state metadata is incomplete or unexpected.".to_string(),
        );
    }
    match journal.completion_mode {
        InstallTransactionCompletionMode::Immediate => {
            if journal.previous_canonical_projection.is_some()
                || journal.next_canonical_projection.is_some()
                || journal.phase == InstallTransactionPhase::AwaitingCanonical
            {
                return Err(
                    "Immediate install transaction contains deferred canonical metadata."
                        .to_string(),
                );
            }
        }
        InstallTransactionCompletionMode::AwaitCanonical => {
            let previous_projection =
                journal
                    .previous_canonical_projection
                    .as_ref()
                    .ok_or_else(|| {
                        "Deferred canonical update is missing its previous projection.".to_string()
                    })?;
            let next_projection = journal.next_canonical_projection.as_ref().ok_or_else(|| {
                "Deferred canonical update is missing its next projection.".to_string()
            })?;
            if !journal.replace_existing
                || !journal.next_record.children.is_empty()
                || journal.next_record.page.is_some()
                || journal
                    .previous_record
                    .as_ref()
                    .is_none_or(|record| !record.children.is_empty() || record.page.is_some())
                || previous_projection.owner_button_id != owner
                || next_projection.owner_button_id != owner
                || previous_projection.role != "single-script"
                || next_projection.role != "single-script"
                || next_projection
                    .source_revision
                    .as_deref()
                    .map(str::trim)
                    .is_none_or(str::is_empty)
            {
                return Err(
                    "Deferred canonical update is not an ordinary single-script owner transaction."
                        .to_string(),
                );
            }
        }
    }
    for (record_owner, record_program_id, record_program, record_panel, subject) in [
        (
            journal.next_record.owner_button_id.as_str(),
            journal.next_record.program_id.as_str(),
            journal.next_record.program_name.as_str(),
            journal.next_record.panel_name.as_str(),
            "next active record",
        ),
        (
            journal.next_install.owner_button_id.as_str(),
            journal.next_install.program_id.as_str(),
            journal.next_install.program_name.as_str(),
            journal.next_install.panel_name.as_str(),
            "next install record",
        ),
    ] {
        if record_owner != owner
            || !record_program_id.eq_ignore_ascii_case(&manifest.program_id)
            || !record_program.eq_ignore_ascii_case(&manifest.label)
            || !record_panel.eq_ignore_ascii_case(&panel)
        {
            return Err(format!(
                "Install transaction {subject} has mismatched identity."
            ));
        }
    }
    if let (Some(previous_record), Some(previous_install)) = (
        journal.previous_record.as_ref(),
        journal.previous_install.as_ref(),
    ) {
        if previous_record.owner_button_id != owner
            || previous_install.owner_button_id != owner
            || !previous_record
                .program_id
                .eq_ignore_ascii_case(&manifest.program_id)
            || !previous_install
                .program_id
                .eq_ignore_ascii_case(&manifest.program_id)
            || !previous_record
                .program_name
                .eq_ignore_ascii_case(&manifest.label)
            || !previous_install
                .program_name
                .eq_ignore_ascii_case(&manifest.label)
            || !previous_record.panel_name.eq_ignore_ascii_case(&panel)
            || !previous_install.panel_name.eq_ignore_ascii_case(&panel)
        {
            return Err("Install transaction previous state has mismatched identity.".to_string());
        }
    }
    let source_relative = ensure_relative_source_path(&journal.next_install.source_relative_path)?;
    let local_root = program_root.join(&manifest.local_scripts_folder);
    let final_package = local_root.join(&owner);
    let expected_package = path_relative_to_program(program_root, &final_package)?;
    let expected_source =
        path_relative_to_program(program_root, &final_package.join(source_relative))?;
    if normalized_relative_path(&journal.next_record.local_package_path)
        != normalized_relative_path(&expected_package)
        || normalized_relative_path(&journal.next_record.source_path)
            != normalized_relative_path(&expected_source)
    {
        return Err(
            "Install transaction active record points outside its owned Local Scripts package."
                .to_string(),
        );
    }
    if let (Some(previous_record), Some(previous_install)) = (
        journal.previous_record.as_ref(),
        journal.previous_install.as_ref(),
    ) {
        let previous_source_relative =
            ensure_relative_source_path(&previous_install.source_relative_path)?;
        let expected_previous_source_absolute = final_package.join(previous_source_relative);
        let expected_previous_source =
            path_relative_to_program(program_root, &expected_previous_source_absolute)?;
        if !previous_owned_record_path_matches(
            &previous_record.local_package_path,
            &expected_package,
            &final_package,
        ) || !previous_owned_record_path_matches(
            &previous_record.source_path,
            &expected_previous_source,
            &expected_previous_source_absolute,
        ) {
            return Err(
                "Install transaction previous record points outside its owned Local Scripts package."
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn parse_install_transaction_journal(
    manifest: &ProgramManifest,
    program_root: &Path,
    path: &Path,
) -> Result<InstallTransactionJournal, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let journal = serde_json::from_str::<InstallTransactionJournal>(&raw).map_err(|error| {
        format!(
            "Install transaction journal {} is invalid: {error}",
            path.display()
        )
    })?;
    validate_install_transaction_journal(manifest, program_root, &journal)?;
    Ok(journal)
}

fn write_install_transaction_journal(
    manifest: &ProgramManifest,
    program_root: &Path,
    transaction_root: &Path,
    journal: &InstallTransactionJournal,
    mode: super::transaction::AtomicWriteMode,
) -> Result<(), String> {
    validate_install_transaction_journal(manifest, program_root, journal)?;
    validate_install_transaction_root_identity(transaction_root, journal)?;
    let raw = serde_json::to_string_pretty(journal)
        .map_err(|error| format!("Failed to serialize install transaction: {error}"))?;
    super::transaction::write_json_file(
        &install_transaction_journal_path(transaction_root),
        raw.as_bytes(),
        mode,
    )
}

fn read_install_transaction_journal(
    manifest: &ProgramManifest,
    program_root: &Path,
    transaction_root: &Path,
) -> Result<Option<InstallTransactionJournal>, String> {
    let path = install_transaction_journal_path(transaction_root);
    super::transaction::recover_json_file(&path, |candidate| {
        parse_install_transaction_journal(manifest, program_root, candidate).map(|_| ())
    })?;
    if path.is_file() {
        let journal = parse_install_transaction_journal(manifest, program_root, &path)?;
        validate_install_transaction_root_identity(transaction_root, &journal)?;
        Ok(Some(journal))
    } else {
        Ok(None)
    }
}

fn validate_install_transaction_root_identity(
    transaction_root: &Path,
    journal: &InstallTransactionJournal,
) -> Result<(), String> {
    if journal.completion_mode != InstallTransactionCompletionMode::AwaitCanonical {
        return Ok(());
    }
    let token = transaction_root
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Deferred canonical update has no transaction token.".to_string())?;
    let revision = journal
        .next_canonical_projection
        .as_ref()
        .and_then(|projection| projection.source_revision.as_deref());
    if revision != Some(token) {
        return Err(
            "Deferred canonical update token does not match its canonical revision marker."
                .to_string(),
        );
    }
    validate_update_transaction_token(token).map(|_| ())
}

fn replace_or_create_active_record(
    active_path: &Path,
    record: &ActiveSourceRecord,
) -> Result<(), String> {
    if active_path.is_file() {
        atomic_replace_json(active_path, record)
    } else if active_path.exists() {
        Err(format!(
            "Active source path is not a file: {}.",
            active_path.display()
        ))
    } else {
        atomic_write_json(active_path, record)
    }
}

fn rollback_prepared_install_transaction(
    manifest: &ProgramManifest,
    program_root: &Path,
    transaction_root: &Path,
    journal: &mut InstallTransactionJournal,
) -> Result<(), String> {
    validate_install_transaction_journal(manifest, program_root, journal)?;
    let local_root = program_root.join(&manifest.local_scripts_folder);
    let final_package = local_root.join(&journal.owner_button_id);
    let old_package = install_transaction_old_package(transaction_root);
    let discard_package = install_transaction_discard_package(transaction_root);
    let panel_root = program_root
        .join(&manifest.panels_folder)
        .join(&journal.panel_name);
    let active_path = panel_root.join(active_record_file_name(&journal.owner_button_id));

    if journal.replace_existing {
        let previous_install = journal.previous_install.as_ref().ok_or_else(|| {
            "Install rollback is missing its previous package record.".to_string()
        })?;
        if old_package.is_dir() {
            if !package_matches_install_record(&old_package, previous_install)? {
                return Err(format!(
                    "Install rollback backup {} does not match the journaled previous package.",
                    old_package.display()
                ));
            }
            if final_package.exists() {
                if !package_matches_install_record(&final_package, &journal.next_install)? {
                    return Err(format!(
                        "Install rollback found an unexpected package at {}.",
                        final_package.display()
                    ));
                }
                if discard_package.exists() {
                    return Err(format!(
                        "Install rollback found both current and discarded packages for '{}'.",
                        journal.owner_button_id
                    ));
                }
                fs::rename(&final_package, &discard_package).map_err(|error| {
                    format!(
                        "Failed to preserve uncommitted package {}: {error}",
                        final_package.display()
                    )
                })?;
            }
            fs::rename(&old_package, &final_package).map_err(|error| {
                format!(
                    "Failed to restore previous package {}: {error}",
                    final_package.display()
                )
            })?;
        } else if !package_matches_install_record(&final_package, previous_install)? {
            return Err(format!(
                "Install rollback cannot find the previous package for '{}'; transaction backups were retained.",
                journal.owner_button_id
            ));
        }
    } else if final_package.exists() {
        if !package_matches_install_record(&final_package, &journal.next_install)? {
            return Err(format!(
                "Install rollback found an unexpected package at {}.",
                final_package.display()
            ));
        }
        if discard_package.exists() {
            return Err(format!(
                "Install rollback found both current and discarded packages for '{}'.",
                journal.owner_button_id
            ));
        }
        fs::rename(&final_package, &discard_package).map_err(|error| {
            format!(
                "Failed to preserve uncommitted package {}: {error}",
                final_package.display()
            )
        })?;
    }

    fs::create_dir_all(&panel_root)
        .map_err(|error| format!("Failed to create {}: {error}", panel_root.display()))?;
    recover_active_record(&active_path)?;
    if let Some(previous) = journal.previous_record.as_ref() {
        if active_path.is_file() {
            let current = read_active_record(&active_path)?;
            if !serialized_values_match(&current, previous)
                && !active_record_matches_next(&current, &journal.next_record)
            {
                return Err(format!(
                    "Install rollback found a divergent active record at {}.",
                    active_path.display()
                ));
            }
        }
        if !active_path.is_file()
            || !serialized_values_match(&read_active_record(&active_path)?, previous)
        {
            replace_or_create_active_record(&active_path, previous)?;
        }
    } else if active_path.is_file() {
        let current = read_active_record(&active_path)?;
        if !active_record_matches_next(&current, &journal.next_record) {
            return Err(format!(
                "Install rollback found a divergent active record at {}.",
                active_path.display()
            ));
        }
        let discard_active = install_transaction_discard_active(transaction_root);
        if discard_active.exists() {
            return Err(format!(
                "Install rollback found both current and discarded active records for '{}'.",
                journal.owner_button_id
            ));
        }
        fs::rename(&active_path, &discard_active).map_err(|error| {
            format!(
                "Failed to preserve uncommitted active record {}: {error}",
                active_path.display()
            )
        })?;
    } else if active_path.exists() {
        return Err(format!(
            "Active source path is not a file: {}.",
            active_path.display()
        ));
    }

    rollback_blender_deployment(
        manifest,
        &journal.owner_button_id,
        &journal.next_record.label,
        journal.previous_record.as_ref(),
    )?;
    journal.phase = InstallTransactionPhase::RolledBack;
    write_install_transaction_journal(
        manifest,
        program_root,
        transaction_root,
        journal,
        super::transaction::AtomicWriteMode::Replace,
    )
}

fn complete_pending_install_transaction(
    manifest: &ProgramManifest,
    program_root: &Path,
    transaction_root: &Path,
    journal: &mut InstallTransactionJournal,
) -> Result<(), String> {
    validate_install_transaction_journal(manifest, program_root, journal)?;
    let local_root = program_root.join(&manifest.local_scripts_folder);
    let final_package = local_root.join(&journal.owner_button_id);
    if !package_matches_install_record(&final_package, &journal.next_install)? {
        return Err(format!(
            "Committed install package for '{}' is missing or does not match its transaction journal.",
            journal.owner_button_id
        ));
    }
    let committed_source = final_package.join(&journal.next_install.source_relative_path);
    if !committed_source.is_file() {
        return Err(format!(
            "Committed install source was not found at {}.",
            committed_source.display()
        ));
    }
    if manifest.runner.kind == "blender-bridge" {
        let action = deploy_blender_source(
            manifest,
            &journal.owner_button_id,
            &journal.panel_name,
            &committed_source,
            journal.next_record.bridge_data.as_ref(),
        )?;
        if action != journal.next_record.bridge_action {
            journal.next_record.bridge_action = action;
            write_install_transaction_journal(
                manifest,
                program_root,
                transaction_root,
                journal,
                super::transaction::AtomicWriteMode::Replace,
            )?;
        }
    }

    let panel_root = program_root
        .join(&manifest.panels_folder)
        .join(&journal.panel_name);
    fs::create_dir_all(&panel_root)
        .map_err(|error| format!("Failed to create {}: {error}", panel_root.display()))?;
    let active_path = panel_root.join(active_record_file_name(&journal.owner_button_id));
    recover_active_record(&active_path)?;
    if active_path.is_file() {
        let current = read_active_record(&active_path)?;
        let is_previous = journal
            .previous_record
            .as_ref()
            .is_some_and(|previous| serialized_values_match(&current, previous));
        if !is_previous && !active_record_matches_next(&current, &journal.next_record) {
            return Err(format!(
                "Install commit found a divergent active record at {}.",
                active_path.display()
            ));
        }
    } else if active_path.exists() {
        return Err(format!(
            "Active source path is not a file: {}.",
            active_path.display()
        ));
    }
    if !active_path.is_file()
        || !serialized_values_match(&read_active_record(&active_path)?, &journal.next_record)
    {
        replace_or_create_active_record(&active_path, &journal.next_record)?;
    }
    journal.phase = match journal.completion_mode {
        InstallTransactionCompletionMode::Immediate => InstallTransactionPhase::Committed,
        InstallTransactionCompletionMode::AwaitCanonical => {
            InstallTransactionPhase::AwaitingCanonical
        }
    };
    write_install_transaction_journal(
        manifest,
        program_root,
        transaction_root,
        journal,
        super::transaction::AtomicWriteMode::Replace,
    )
}

fn recover_install_transaction(
    manifest: &ProgramManifest,
    program_root: &Path,
    transaction_root: &Path,
) -> Result<(), String> {
    let Some(mut journal) =
        read_install_transaction_journal(manifest, program_root, transaction_root)?
    else {
        if install_transaction_old_package(transaction_root).exists()
            || install_transaction_discard_package(transaction_root).exists()
            || install_transaction_discard_active(transaction_root).exists()
        {
            return Err(format!(
                "Install transaction {} has mutation artifacts but no recoverable journal.",
                transaction_root.display()
            ));
        }
        return Ok(());
    };
    match journal.phase {
        InstallTransactionPhase::Prepared => rollback_prepared_install_transaction(
            manifest,
            program_root,
            transaction_root,
            &mut journal,
        ),
        InstallTransactionPhase::CommitPending => complete_pending_install_transaction(
            manifest,
            program_root,
            transaction_root,
            &mut journal,
        ),
        InstallTransactionPhase::AwaitingCanonical => Ok(()),
        InstallTransactionPhase::Committed | InstallTransactionPhase::RolledBack => Ok(()),
    }
}

fn resolve_awaiting_canonical_transaction(
    manifest: &ProgramManifest,
    program_root: &Path,
    transaction_root: &Path,
    canonical_document: &Value,
) -> Result<&'static str, String> {
    let mut journal = read_install_transaction_journal(manifest, program_root, transaction_root)?
        .ok_or_else(|| {
        format!(
            "Canonical update transaction {} has no recoverable journal.",
            transaction_root.display()
        )
    })?;
    if journal.phase != InstallTransactionPhase::AwaitingCanonical {
        return match journal.phase {
            InstallTransactionPhase::Committed => Ok("finalized"),
            InstallTransactionPhase::RolledBack => Ok("rolled-back"),
            _ => Err(format!(
                "Install transaction {} is not ready for canonical classification.",
                transaction_root.display()
            )),
        };
    }
    match classify_canonical_update(&journal, canonical_document)? {
        CanonicalUpdateDisposition::Finalize => {
            let local_root = program_root.join(&manifest.local_scripts_folder);
            let final_package = local_root.join(&journal.owner_button_id);
            if !package_matches_install_record(&final_package, &journal.next_install)? {
                return Err(format!(
                    "Updated source package for '{}' no longer matches its native transaction.",
                    journal.owner_button_id
                ));
            }
            let active_path = program_root
                .join(&manifest.panels_folder)
                .join(&journal.panel_name)
                .join(active_record_file_name(&journal.owner_button_id));
            recover_active_record(&active_path)?;
            if !active_path.is_file()
                || !serialized_values_match(
                    &read_active_record(&active_path)?,
                    &journal.next_record,
                )
            {
                return Err(format!(
                    "Updated active source record for '{}' no longer matches its native transaction.",
                    journal.owner_button_id
                ));
            }
            journal.phase = InstallTransactionPhase::Committed;
            write_install_transaction_journal(
                manifest,
                program_root,
                transaction_root,
                &journal,
                super::transaction::AtomicWriteMode::Replace,
            )?;
            Ok("finalized")
        }
        CanonicalUpdateDisposition::RollBack => {
            rollback_prepared_install_transaction(
                manifest,
                program_root,
                transaction_root,
                &mut journal,
            )?;
            Ok("rolled-back")
        }
    }
}

fn rollback_install_after_error(
    manifest: &ProgramManifest,
    program_root: &Path,
    transaction_root: &Path,
    error: String,
) -> String {
    match recover_install_transaction(manifest, program_root, transaction_root) {
        Ok(()) => {
            finalize_install_transaction(transaction_root);
            error
        }
        Err(recovery_error) => format!(
            "{error} Install rollback also failed; transaction backups were retained at {}: {recovery_error}",
            transaction_root.display()
        ),
    }
}

fn finalize_install_transaction(transaction_root: &Path) {
    if !transaction_root.is_dir() {
        return;
    }
    if let Err(error) = crate::recycle_directory_path(transaction_root) {
        crate::append_flowcell_local_log(
            "program-source-cleanup.log",
            &format!(
                "Install transaction cleanup is pending at {}: {error}",
                transaction_root.display()
            ),
        );
    }
}

fn transaction_awaits_canonical(
    manifest: &ProgramManifest,
    program_root: &Path,
    transaction_root: &Path,
) -> Result<bool, String> {
    Ok(
        read_install_transaction_journal(manifest, program_root, transaction_root)?
            .is_some_and(|journal| journal.phase == InstallTransactionPhase::AwaitingCanonical),
    )
}

fn ensure_no_awaiting_canonical_update_in_program(
    manifest: &ProgramManifest,
    program_root: &Path,
    owner_button_id: &str,
) -> Result<(), String> {
    let local_root = program_root.join(&manifest.local_scripts_folder);
    if !local_root.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(&local_root)
        .map_err(|error| format!("Failed to inspect {}: {error}", local_root.display()))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to inspect {}: {error}", local_root.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;
        if !file_type.is_dir()
            || file_type.is_symlink()
            || !entry
                .file_name()
                .to_string_lossy()
                .to_ascii_lowercase()
                .starts_with(INSTALL_TRANSACTION_PREFIX)
        {
            continue;
        }
        if let Some(journal) =
            read_install_transaction_journal(manifest, program_root, &entry.path())?
        {
            if journal.phase == InstallTransactionPhase::AwaitingCanonical
                && journal
                    .owner_button_id
                    .eq_ignore_ascii_case(owner_button_id)
            {
                return Err(format!(
                    "Button '{owner_button_id}' already has a native source update awaiting its canonical Button-state commit."
                ));
            }
        }
    }
    Ok(())
}

pub(crate) fn ensure_no_awaiting_canonical_update_for_owner(
    owner_button_id: &str,
) -> Result<(), String> {
    let owner = validate_owner_button_id(owner_button_id)?;
    let programs_root = crate::resolve_programs_root()?;
    for entry in fs::read_dir(&programs_root)
        .map_err(|error| format!("Failed to inspect {}: {error}", programs_root.display()))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to inspect {}: {error}", programs_root.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let program_name = entry.file_name().to_string_lossy().to_string();
        let Ok(manifest) = load_program_manifest(&program_name) else {
            continue;
        };
        ensure_no_awaiting_canonical_update_in_program(&manifest, &entry.path(), &owner)?;
    }
    Ok(())
}

fn recover_install_transactions_in_program_with_canonical(
    manifest: &ProgramManifest,
    program_root: &Path,
    canonical_document: Option<&Value>,
    require_canonical_resolution: bool,
) -> Result<(), String> {
    let local_root = program_root.join(&manifest.local_scripts_folder);
    if !local_root.is_dir() {
        return Ok(());
    }
    let mut transactions = fs::read_dir(&local_root)
        .map_err(|error| format!("Failed to inspect {}: {error}", local_root.display()))?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_type()
                .map(|kind| kind.is_dir() && !kind.is_symlink())
                .unwrap_or(false)
                && entry
                    .file_name()
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .starts_with(INSTALL_TRANSACTION_PREFIX)
        })
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    transactions.sort();
    for transaction_root in transactions {
        recover_install_transaction(manifest, program_root, &transaction_root)?;
        if transaction_awaits_canonical(manifest, program_root, &transaction_root)? {
            if require_canonical_resolution {
                let document = canonical_document.ok_or_else(|| {
                    format!(
                        "Native source update {} awaits canonical Button state, but canonical Button state is missing.",
                        transaction_root.display()
                    )
                })?;
                resolve_awaiting_canonical_transaction(
                    manifest,
                    program_root,
                    &transaction_root,
                    document,
                )?;
            }
        }
        if !transaction_awaits_canonical(manifest, program_root, &transaction_root)? {
            finalize_install_transaction(&transaction_root);
        }
    }
    Ok(())
}

fn recover_install_transactions_in_program(
    manifest: &ProgramManifest,
    program_root: &Path,
) -> Result<(), String> {
    recover_install_transactions_in_program_with_canonical(manifest, program_root, None, false)
}

pub(crate) fn recover_install_transactions_on_startup() -> Result<(), String> {
    let _button_state_guard = crate::button_state::button_state_commit_guard()?;
    let _source_guard = super::source_quarantine_guard()?;
    let canonical_document = crate::button_state::read_button_state_for_program_rename_locked()?;
    let programs_root = crate::resolve_programs_root()?;
    for entry in fs::read_dir(&programs_root)
        .map_err(|error| format!("Failed to inspect {}: {error}", programs_root.display()))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to inspect {}: {error}", programs_root.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let program_name = entry.file_name().to_string_lossy().to_string();
        let Ok(manifest) = load_program_manifest(&program_name) else {
            continue;
        };
        recover_install_transactions_in_program_with_canonical(
            &manifest,
            &entry.path(),
            canonical_document.as_ref(),
            true,
        )?;
    }
    Ok(())
}

fn update_residue_name(kind: &str, owner_button_id: &str) -> String {
    format!(
        ".{kind}-{owner_button_id}-{}",
        timestamp().replace(['.', ':'], "-")
    )
}

fn update_residue_paths(
    local_root: &Path,
    owner_button_id: &str,
) -> Result<(Vec<PathBuf>, Vec<PathBuf>), String> {
    let replacing_exact = format!(".replacing-{owner_button_id}").to_ascii_lowercase();
    let replacing_prefix = format!(".replacing-{owner_button_id}-").to_ascii_lowercase();
    let cleanup_prefix = format!(".cleanup-pending-{owner_button_id}-").to_ascii_lowercase();
    let mut replacing = Vec::new();
    let mut cleanup_pending = Vec::new();
    for entry in fs::read_dir(local_root)
        .map_err(|error| format!("Failed to inspect {}: {error}", local_root.display()))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to inspect {}: {error}", local_root.display()))?;
        if !entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?
            .is_dir()
        {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if name == replacing_exact || name.starts_with(&replacing_prefix) {
            replacing.push(entry.path());
        } else if name.starts_with(&cleanup_prefix) {
            cleanup_pending.push(entry.path());
        }
    }
    replacing.sort();
    cleanup_pending.sort();
    Ok((replacing, cleanup_pending))
}

fn mark_update_cleanup_pending(
    previous_package: &Path,
    local_root: &Path,
    owner_button_id: &str,
) -> Result<PathBuf, String> {
    let cleanup_path = local_root.join(update_residue_name("cleanup-pending", owner_button_id));
    fs::rename(previous_package, &cleanup_path).map_err(|error| {
        format!(
            "Failed to record committed update cleanup at {}: {error}",
            cleanup_path.display()
        )
    })?;
    Ok(cleanup_path)
}

fn recover_update_residues_with<F>(
    local_root: &Path,
    final_package: &Path,
    owner_button_id: &str,
    mut recycle: F,
) -> Result<(), String>
where
    F: FnMut(&Path) -> Result<(), String>,
{
    let (replacing, cleanup_pending) = update_residue_paths(local_root, owner_button_id)?;
    for path in cleanup_pending {
        let _ = recycle(&path);
    }
    if final_package.is_dir() {
        for path in replacing {
            if recycle(&path).is_err() {
                let _ = mark_update_cleanup_pending(&path, local_root, owner_button_id);
            }
        }
        return Ok(());
    }
    match replacing.len() {
        0 => Ok(()),
        1 => fs::rename(&replacing[0], final_package).map_err(|error| {
            format!(
                "Failed to recover interrupted Button update from {}: {error}",
                replacing[0].display()
            )
        }),
        _ => Err(format!(
            "Button '{owner_button_id}' has multiple interrupted update packages in {}; refusing ambiguous recovery.",
            local_root.display()
        )),
    }
}

fn recover_update_residues(
    local_root: &Path,
    final_package: &Path,
    owner_button_id: &str,
) -> Result<(), String> {
    recover_update_residues_with(
        local_root,
        final_package,
        owner_button_id,
        crate::recycle_directory_path,
    )
}

fn path_relative_to_program(program_root: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(program_root)
        .map(|relative| relative.to_string_lossy().to_string())
        .map_err(|_| {
            format!(
                "Owned source path {} is outside program root {}.",
                path.display(),
                program_root.display()
            )
        })
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
    let script_path = super::manifest::resolve_runner_script_path(
        &program_root,
        manifest,
        &manifest.runner.install_script,
        "runner.installScript",
    )?
    .ok_or_else(|| "Blender program manifest is missing runner.installScript.".to_string())?;
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
        let previous_source =
            super::execute::resolve_owned_source_paths(manifest, previous)?.source_path;
        return deploy_blender_source(
            manifest,
            owner_button_id,
            &previous.panel_name,
            &previous_source,
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
    } else if let Some(target) = record.execution_target.clone() {
        Some(execution_target_with_source_identity(
            target,
            record,
            &source_identity.file_name,
        ))
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
            execution_target: child
                .execution_target
                .clone()
                .map(|target| {
                    execution_target_with_source_identity(
                        target,
                        record,
                        &source_identity.file_name,
                    )
                })
                .unwrap_or_else(|| {
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
        update_transaction_token: None,
    }
}

fn canonical_source_projection(
    document: &Value,
    owner_button_id: &str,
) -> Result<CanonicalSourceProjection, String> {
    let owner = validate_owner_button_id(owner_button_id)?;
    let button = document
        .get("buttons")
        .and_then(Value::as_object)
        .and_then(|buttons| buttons.get(&owner))
        .and_then(Value::as_object)
        .ok_or_else(|| {
            format!("Canonical Button state is missing installed source owner '{owner}'.")
        })?;
    if button.get("id").and_then(Value::as_str) != Some(owner.as_str()) {
        return Err(format!(
            "Canonical Button '{owner}' has mismatched owner identity."
        ));
    }
    let role = button
        .get("role")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Canonical Button '{owner}' is missing role."))?;
    if role != "single-script" {
        return Err(format!(
            "Button source updates currently support ordinary single-script owners only; '{owner}' has role '{role}'."
        ));
    }
    let source_identity = button
        .get("sourceIdentity")
        .filter(|value| value.is_object())
        .cloned()
        .ok_or_else(|| {
            format!("Canonical Button '{owner}' has invalid sourceIdentity metadata.")
        })?;
    let identity = source_identity
        .as_object()
        .expect("source identity object was checked");
    for key in [
        "displayProgramName",
        "displayPanelName",
        "displayFileName",
        "normalizedProgramName",
        "normalizedPanelName",
        "normalizedFileName",
    ] {
        if identity
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
        {
            return Err(format!(
                "Canonical Button '{owner}' sourceIdentity is missing {key}."
            ));
        }
    }
    let execution_target = button
        .get("executionTarget")
        .filter(|value| value.is_object())
        .cloned()
        .ok_or_else(|| {
            format!("Canonical Button '{owner}' has invalid executionTarget metadata.")
        })?;
    let metadata = button
        .get("metadata")
        .and_then(Value::as_object)
        .ok_or_else(|| format!("Canonical Button '{owner}' has invalid metadata."))?;
    let source_revision = match metadata.get("flowcellSourceRevision") {
        None => None,
        Some(Value::String(value)) if !value.trim().is_empty() => Some(value.clone()),
        Some(_) => {
            return Err(format!(
                "Canonical Button '{owner}' has malformed metadata.flowcellSourceRevision."
            ))
        }
    };
    Ok(CanonicalSourceProjection {
        owner_button_id: owner,
        role: role.to_string(),
        source_identity,
        execution_target,
        source_revision,
    })
}

fn validate_projection_matches_active_record(
    projection: &CanonicalSourceProjection,
    record: &ActiveSourceRecord,
    active_file_name: &str,
) -> Result<(), String> {
    if projection.owner_button_id != record.owner_button_id || projection.role != "single-script" {
        return Err(format!(
            "Canonical Button '{}' does not match its installed source owner.",
            record.owner_button_id
        ));
    }
    let identity = projection
        .source_identity
        .as_object()
        .ok_or_else(|| "Canonical sourceIdentity projection is invalid.".to_string())?;
    for (key, expected) in [
        ("displayProgramName", record.program_name.as_str()),
        ("displayPanelName", record.panel_name.as_str()),
        ("displayFileName", active_file_name),
    ] {
        if identity.get(key).and_then(Value::as_str) != Some(expected) {
            return Err(format!(
                "Canonical Button '{}' sourceIdentity does not match its active source record.",
                record.owner_button_id
            ));
        }
    }
    let expected_target = canonical_owner_execution_target(record, active_file_name)?;
    if projection.execution_target != expected_target {
        return Err(format!(
            "Canonical Button '{}' executionTarget does not match its active source record.",
            record.owner_button_id
        ));
    }
    Ok(())
}

fn next_canonical_projection(
    previous: &CanonicalSourceProjection,
    record: &ActiveSourceRecord,
    active_file_name: &str,
    transaction_token: &str,
) -> Result<CanonicalSourceProjection, String> {
    let execution_target = canonical_owner_execution_target(record, active_file_name)?;
    Ok(CanonicalSourceProjection {
        owner_button_id: previous.owner_button_id.clone(),
        role: "single-script".to_string(),
        source_identity: previous.source_identity.clone(),
        execution_target,
        source_revision: Some(transaction_token.to_string()),
    })
}

fn canonical_owner_execution_target(
    record: &ActiveSourceRecord,
    active_file_name: &str,
) -> Result<Value, String> {
    let mut target = build_response(record, active_file_name.to_string())
        .owner
        .execution_target
        .ok_or_else(|| "Installed single-script source has no execution target.".to_string())?;
    let Some(shared_events) = record.events.as_ref() else {
        return Ok(target);
    };
    let target_object = target.as_object_mut().ok_or_else(|| {
        "Installed single-script source returned a non-object execution target.".to_string()
    })?;
    let mut merged_events = target_object
        .get("events")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for (event_name, event) in shared_events {
        merged_events.insert(event_name.clone(), event.clone());
    }
    target_object.insert("events".to_string(), Value::Object(merged_events));
    Ok(target)
}

fn classify_canonical_update(
    journal: &InstallTransactionJournal,
    canonical_document: &Value,
) -> Result<CanonicalUpdateDisposition, String> {
    if journal.completion_mode != InstallTransactionCompletionMode::AwaitCanonical {
        return Err("Install transaction does not await a canonical Button update.".to_string());
    }
    let previous = journal
        .previous_canonical_projection
        .as_ref()
        .ok_or_else(|| {
            "Canonical update transaction is missing its previous projection.".to_string()
        })?;
    let next = journal.next_canonical_projection.as_ref().ok_or_else(|| {
        "Canonical update transaction is missing its next projection.".to_string()
    })?;
    let current = canonical_source_projection(canonical_document, &journal.owner_button_id)?;
    if current == *next {
        Ok(CanonicalUpdateDisposition::Finalize)
    } else if current == *previous {
        Ok(CanonicalUpdateDisposition::RollBack)
    } else {
        Err(format!(
            "Canonical Button '{}' is neither the previous nor updated source projection; the native update transaction was retained.",
            journal.owner_button_id
        ))
    }
}

pub(crate) fn install_from_path(
    request: InstallButtonSourceRequest,
    replace_existing: bool,
) -> Result<InstallButtonSourceResponse, String> {
    let source_guard = super::source_quarantine_guard()?;
    install_from_path_while_source_locked(request, replace_existing, &source_guard)
}

/// Installs while the caller holds FlowCell's source-quarantine guard.
///
/// This is reserved for an outer transaction, such as Add Program, that must
/// serialize several source installs under one uninterrupted ownership lane.
pub(crate) fn install_from_path_while_source_locked(
    request: InstallButtonSourceRequest,
    replace_existing: bool,
    source_guard: &std::sync::MutexGuard<'static, ()>,
) -> Result<InstallButtonSourceResponse, String> {
    install_from_path_while_source_locked_with_completion(
        request,
        replace_existing,
        source_guard,
        None,
    )
}

fn install_from_path_while_source_locked_with_completion(
    request: InstallButtonSourceRequest,
    replace_existing: bool,
    _source_guard: &std::sync::MutexGuard<'static, ()>,
    deferred_canonical_update: Option<DeferredCanonicalUpdate>,
) -> Result<InstallButtonSourceResponse, String> {
    let owner_button_id = validate_owner_button_id(&request.owner_button_id)?;
    let program_name = request.program_name.trim();
    let panel_name = crate::validate_folder_name(&request.panel_name, "Panel")?;
    let manifest = load_program_manifest(program_name)?;
    let program_root = crate::resolve_program_directory(program_name)?;
    let source_display_path = PathBuf::from(request.source_path.trim());
    reject_selected_source_reparse_point(&source_display_path)?;
    let source_path = source_display_path.canonicalize().map_err(|error| {
        format!(
            "Selected Button source '{}' could not be resolved: {error}",
            source_display_path.display()
        )
    })?;
    let requested_import_kind = normalize_import_kind(&request.import_kind)?;
    let import_kind = if requested_import_kind == "auto" {
        detect_import_kind(&source_path)?
    } else {
        requested_import_kind
    };
    let bundled_identity = match (
        request.bundled_source_id.as_deref(),
        request.bundled_source_version.as_deref(),
    ) {
        (None, None) => None,
        (Some(id), Some(version)) => {
            let declared = manifest
                .bundled_sources
                .iter()
                .find(|source| source.id.eq_ignore_ascii_case(id.trim()))
                .ok_or_else(|| {
                    format!(
                        "Program '{}' does not declare bundled source '{}'.",
                        manifest.label,
                        id.trim()
                    )
                })?;
            let enabled_destination_matches =
                if declared.panel_name.eq_ignore_ascii_case(&panel_name) {
                    true
                } else {
                    super::manifest::load_enabled_program_contributions(&manifest)?
                        .map(|state| {
                            state.enabled_sources.iter().any(|source| {
                                source.source_id.eq_ignore_ascii_case(&declared.id)
                                    && source.panel_name.eq_ignore_ascii_case(&panel_name)
                            })
                        })
                        .unwrap_or(false)
                };
            if declared.version != version.trim()
                || !enabled_destination_matches
                || declared.import_kind != import_kind
            {
                return Err(format!(
                    "Bundled source '{}@{}' does not match its declared version, enabled destination panel, or import kind.",
                    id.trim(),
                    version.trim()
                ));
            }
            let declared_path = super::manifest::resolve_relative_manifest_path(
                &program_root,
                &declared.source_path,
                "bundledSources.sourcePath",
                false,
            )?
            .ok_or_else(|| "bundledSources.sourcePath cannot be empty.".to_string())?
            .canonicalize()
            .map_err(|error| {
                format!(
                    "Bundled source '{}' could not be resolved: {error}",
                    declared.id
                )
            })?;
            if declared_path != source_path {
                return Err(format!(
                    "Bundled source '{}' must install from its manifest-owned source path.",
                    declared.id
                ));
            }
            Some((declared.id.clone(), declared.version.clone()))
        }
        _ => {
            return Err(
                "bundledSourceId and bundledSourceVersion must be supplied together.".to_string(),
            )
        }
    };
    let prepared = prepare_source(&manifest, &source_path, import_kind)?;
    if deferred_canonical_update.is_some()
        && (!replace_existing
            || bundled_identity.is_some()
            || !prepared.children.is_empty()
            || prepared.page.is_some())
    {
        return Err(
            "Public Button source update transactions support ordinary, non-bundled single-script owners only."
                .to_string(),
        );
    }
    let local_root = program_root.join(&manifest.local_scripts_folder);
    let panel_root = program_root.join(&manifest.panels_folder).join(&panel_name);
    fs::create_dir_all(&local_root)
        .map_err(|error| format!("Failed to create {}: {error}", local_root.display()))?;
    fs::create_dir_all(&panel_root)
        .map_err(|error| format!("Failed to create {}: {error}", panel_root.display()))?;
    let final_package = local_root.join(&owner_button_id);
    let active_file_name = active_record_file_name(&owner_button_id);
    let active_path = panel_root.join(&active_file_name);
    recover_install_transactions_in_program(&manifest, &program_root)?;
    ensure_no_awaiting_canonical_update_in_program(&manifest, &program_root, &owner_button_id)?;
    recover_update_residues(&local_root, &final_package, &owner_button_id)?;
    recover_active_record(&active_path)?;
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
    let previous_install = if replace_existing {
        Some(read_local_install_record(&final_package)?)
    } else {
        None
    };
    if let Some(previous) = previous_record.as_ref() {
        if !previous.program_name.eq_ignore_ascii_case(&manifest.label)
            || !previous
                .program_id
                .eq_ignore_ascii_case(&manifest.program_id)
            || !previous.panel_name.eq_ignore_ascii_case(&panel_name)
            || previous.install_id != owner_button_id
        {
            return Err(format!(
                "Button '{}' active source record does not belong to {}/{}.",
                owner_button_id, manifest.label, panel_name
            ));
        }
        super::execute::resolve_owned_source_paths(&manifest, previous)?;
        match (
            previous.bundled_source_id.as_deref(),
            bundled_identity.as_ref(),
        ) {
            (Some(previous_id), Some((next_id, _)))
                if previous_id.eq_ignore_ascii_case(next_id) => {}
            (Some(previous_id), _) => {
                return Err(format!(
                    "Button '{}' is managed by bundled source '{}'; synchronize that source instead of manually updating it.",
                    owner_button_id, previous_id
                ));
            }
            (None, _) => {}
        }
        validate_update_shape(previous, &prepared)?;
        if let Some(deferred) = deferred_canonical_update.as_ref() {
            if !previous.children.is_empty() || previous.page.is_some() {
                return Err(
                    "Public Button source update transactions support ordinary single-script owners only."
                        .to_string(),
                );
            }
            validate_projection_matches_active_record(
                &deferred.previous_projection,
                previous,
                &active_file_name,
            )?;
        }
    }
    let transaction_token = format!(
        "{INSTALL_TRANSACTION_PREFIX}{owner_button_id}-{}",
        timestamp().replace(['.', ':'], "-")
    );
    let transaction_root = local_root.join(&transaction_token);
    fs::create_dir(&transaction_root).map_err(|error| {
        format!(
            "Failed to create install transaction {}: {error}",
            transaction_root.display()
        )
    })?;
    let staged_package = install_transaction_new_package(&transaction_root);
    let staged_source_root = staged_package.join("source");
    if let Err(error) = copy_package_source(&prepared.package_source_root, &staged_source_root) {
        finalize_install_transaction(&transaction_root);
        return Err(error);
    }
    let installed_source = staged_source_root.join(&prepared.source_relative_to_package);
    if !installed_source.is_file() {
        finalize_install_transaction(&transaction_root);
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
        bundled_source_id: bundled_identity.as_ref().map(|(id, _)| id.clone()),
        bundled_source_version: bundled_identity
            .as_ref()
            .map(|(_, version)| version.clone()),
    };
    if let Err(error) = atomic_write_json(
        &staged_package.join(INSTALL_RECORD_FILE_NAME),
        &install_record,
    ) {
        finalize_install_transaction(&transaction_root);
        return Err(error);
    }
    if replace_existing {
        if let Err(error) = preserve_runtime_directory(&final_package, &staged_package) {
            finalize_install_transaction(&transaction_root);
            return Err(error);
        }
    }
    let committed_source = final_package
        .join("source")
        .join(&prepared.source_relative_to_package);
    let mut record = ActiveSourceRecord {
        schema_version: 1,
        owner_button_id: owner_button_id.clone(),
        install_id: owner_button_id.clone(),
        program_id: manifest.program_id.clone(),
        program_name: manifest.label.clone(),
        panel_name: panel_name.clone(),
        label: prepared.label,
        tooltip: prepared.tooltip,
        kind: prepared.kind,
        local_package_path: path_relative_to_program(&program_root, &final_package)?,
        source_path: path_relative_to_program(&program_root, &committed_source)?,
        runner: manifest.runner.kind.clone(),
        runner_data: prepared.runner_data,
        execution_target: prepared.execution_target,
        bridge_action: if manifest.runner.kind == "blender-bridge" {
            owned_bridge_action(&owner_button_id)
        } else {
            String::new()
        },
        bridge_data: prepared.bridge_data,
        state_query: prepared.state_query,
        events: prepared.events,
        children: prepared.children,
        layout: prepared.layout,
        page: prepared.page,
        source_display_path: source_path.to_string_lossy().to_string(),
        bundled_source_id: bundled_identity.as_ref().map(|(id, _)| id.clone()),
        bundled_source_version: bundled_identity.map(|(_, version)| version),
    };
    let mut journal = InstallTransactionJournal {
        schema_version: INSTALL_TRANSACTION_SCHEMA_VERSION,
        phase: InstallTransactionPhase::Prepared,
        replace_existing,
        owner_button_id: owner_button_id.clone(),
        program_id: manifest.program_id.clone(),
        program_name: manifest.label.clone(),
        panel_name: panel_name.clone(),
        previous_record: previous_record.clone(),
        previous_install,
        next_record: record.clone(),
        next_install: install_record,
        completion_mode: if deferred_canonical_update.is_some() {
            InstallTransactionCompletionMode::AwaitCanonical
        } else {
            InstallTransactionCompletionMode::Immediate
        },
        previous_canonical_projection: deferred_canonical_update
            .as_ref()
            .map(|update| update.previous_projection.clone()),
        next_canonical_projection: deferred_canonical_update
            .as_ref()
            .map(|update| {
                next_canonical_projection(
                    &update.previous_projection,
                    &record,
                    &active_file_name,
                    &transaction_token,
                )
            })
            .transpose()?,
    };
    if let Err(error) = write_install_transaction_journal(
        &manifest,
        &program_root,
        &transaction_root,
        &journal,
        super::transaction::AtomicWriteMode::Create,
    ) {
        finalize_install_transaction(&transaction_root);
        return Err(error);
    }

    let previous_package = install_transaction_old_package(&transaction_root);
    if replace_existing {
        if let Err(error) = fs::rename(&final_package, &previous_package) {
            return Err(rollback_install_after_error(
                &manifest,
                &program_root,
                &transaction_root,
                format!("Failed to stage existing install for update: {error}"),
            ));
        }
    }
    if let Err(error) = fs::rename(&staged_package, &final_package) {
        return Err(rollback_install_after_error(
            &manifest,
            &program_root,
            &transaction_root,
            format!("Failed to commit Local Scripts package: {error}"),
        ));
    }

    if manifest.runner.kind == "blender-bridge" {
        match deploy_blender_source(
            &manifest,
            &owner_button_id,
            &panel_name,
            &committed_source,
            record.bridge_data.as_ref(),
        ) {
            Ok(action) => {
                record.bridge_action = action;
                journal.next_record = record.clone();
                if let Err(error) = write_install_transaction_journal(
                    &manifest,
                    &program_root,
                    &transaction_root,
                    &journal,
                    super::transaction::AtomicWriteMode::Replace,
                ) {
                    return Err(rollback_install_after_error(
                        &manifest,
                        &program_root,
                        &transaction_root,
                        error,
                    ));
                }
            }
            Err(error) => {
                return Err(rollback_install_after_error(
                    &manifest,
                    &program_root,
                    &transaction_root,
                    error,
                ));
            }
        }
    }

    journal.phase = InstallTransactionPhase::CommitPending;
    if let Err(error) = write_install_transaction_journal(
        &manifest,
        &program_root,
        &transaction_root,
        &journal,
        super::transaction::AtomicWriteMode::Replace,
    ) {
        return Err(rollback_install_after_error(
            &manifest,
            &program_root,
            &transaction_root,
            error,
        ));
    }

    let commit_result = replace_or_create_active_record(&active_path, &record).and_then(|_| {
        journal.phase = match journal.completion_mode {
            InstallTransactionCompletionMode::Immediate => InstallTransactionPhase::Committed,
            InstallTransactionCompletionMode::AwaitCanonical => {
                InstallTransactionPhase::AwaitingCanonical
            }
        };
        write_install_transaction_journal(
            &manifest,
            &program_root,
            &transaction_root,
            &journal,
            super::transaction::AtomicWriteMode::Replace,
        )
    });
    if let Err(error) = commit_result {
        if let Err(recovery_error) =
            recover_install_transaction(&manifest, &program_root, &transaction_root)
        {
            return Err(format!(
                "{error} Install commit recovery also failed; transaction backups were retained at {}: {recovery_error}",
                transaction_root.display()
            ));
        }
        journal = read_install_transaction_journal(
            &manifest,
            &program_root,
            &transaction_root,
        )?
        .ok_or_else(|| {
            format!(
                "{error} Install commit recovery completed, but its durable journal disappeared from {}.",
                transaction_root.display()
            )
        })?;
    }
    let mut response = build_response(&record, active_file_name);
    if journal.phase == InstallTransactionPhase::AwaitingCanonical {
        response.update_transaction_token = Some(transaction_token);
    } else {
        finalize_install_transaction(&transaction_root);
    }
    Ok(response)
}

#[tauri::command]
pub(crate) fn install_button_source(
    mut request: InstallButtonSourceRequest,
) -> Result<InstallButtonSourceResponse, String> {
    request.program_name = crate::require_registered_program_name(&request.program_name)?;
    request.panel_name = crate::validate_folder_name(&request.panel_name, "Panel")?;
    request.owner_button_id = validate_owner_button_id(&request.owner_button_id)?;
    let pending_guard = super::source_quarantine_guard()?;
    super::pending_install::prepare_pending_canonical_install(
        &request.program_name,
        &request.panel_name,
        &request.owner_button_id,
    )?;
    drop(pending_guard);
    install_from_path(request, false)
}

fn validate_update_transaction_token(value: &str) -> Result<String, String> {
    let token = value.trim();
    let path = Path::new(token);
    if token.is_empty()
        || token.len() > 240
        || !token
            .to_ascii_lowercase()
            .starts_with(INSTALL_TRANSACTION_PREFIX)
        || path.components().count() != 1
        || !matches!(path.components().next(), Some(Component::Normal(_)))
    {
        return Err("Button source update transaction token is invalid.".to_string());
    }
    Ok(token.to_string())
}

fn locate_update_transaction(
    transaction_token: &str,
    owner_button_id: &str,
) -> Result<Option<(ProgramManifest, PathBuf, PathBuf)>, String> {
    let token = validate_update_transaction_token(transaction_token)?;
    let owner = validate_owner_button_id(owner_button_id)?;
    let programs_root = crate::resolve_programs_root()?;
    let mut located = None;
    for entry in fs::read_dir(&programs_root)
        .map_err(|error| format!("Failed to inspect {}: {error}", programs_root.display()))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to inspect {}: {error}", programs_root.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let program_name = entry.file_name().to_string_lossy().to_string();
        let Ok(manifest) = load_program_manifest(&program_name) else {
            continue;
        };
        let transaction_root = entry
            .path()
            .join(&manifest.local_scripts_folder)
            .join(&token);
        let metadata = match fs::symlink_metadata(&transaction_root) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(format!(
                    "Failed to inspect Button source update transaction {}: {error}",
                    transaction_root.display()
                ))
            }
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(format!(
                "Button source update transaction path is unsafe: {}.",
                transaction_root.display()
            ));
        }
        let journal =
            read_install_transaction_journal(&manifest, &entry.path(), &transaction_root)?
                .ok_or_else(|| {
                    format!(
                        "Button source update transaction {} has no recoverable journal.",
                        transaction_root.display()
                    )
                })?;
        if !journal.owner_button_id.eq_ignore_ascii_case(&owner)
            || journal.completion_mode != InstallTransactionCompletionMode::AwaitCanonical
            || journal
                .next_canonical_projection
                .as_ref()
                .and_then(|projection| projection.source_revision.as_deref())
                != Some(token.as_str())
        {
            return Err(
                "Button source update transaction token does not match its owner or canonical revision."
                    .to_string(),
            );
        }
        if located.is_some() {
            return Err("Button source update transaction token is ambiguous.".to_string());
        }
        located = Some((manifest, entry.path(), transaction_root));
    }
    Ok(located)
}

fn complete_button_source_update(
    transaction_token: String,
    owner_button_id: String,
) -> Result<String, String> {
    let token = validate_update_transaction_token(&transaction_token)?;
    let owner = validate_owner_button_id(&owner_button_id)?;
    let _button_state_guard = crate::button_state::button_state_commit_guard()?;
    let _source_guard = super::source_quarantine_guard()?;
    let canonical_document = crate::button_state::read_button_state_for_program_rename_locked()?;
    let Some((manifest, program_root, transaction_root)) =
        locate_update_transaction(&token, &owner)?
    else {
        let document = canonical_document.as_ref().ok_or_else(|| {
            "Canonical Button state is missing while completing a source update.".to_string()
        })?;
        let projection = canonical_source_projection(document, &owner)?;
        if projection.source_revision.as_deref() == Some(token.as_str()) {
            return Ok("finalized".to_string());
        }
        return Err(format!(
            "Button source update transaction '{token}' was not found and canonical Button '{owner}' does not contain its committed revision."
        ));
    };

    recover_install_transaction(&manifest, &program_root, &transaction_root)?;
    let phase = read_install_transaction_journal(&manifest, &program_root, &transaction_root)?
        .ok_or_else(|| "Button source update transaction journal disappeared.".to_string())?
        .phase;
    let result = match phase {
        InstallTransactionPhase::AwaitingCanonical => {
            let document = canonical_document.as_ref().ok_or_else(|| {
                "Canonical Button state is missing while completing a source update.".to_string()
            })?;
            resolve_awaiting_canonical_transaction(
                &manifest,
                &program_root,
                &transaction_root,
                document,
            )?
            .to_string()
        }
        InstallTransactionPhase::Committed => "finalized".to_string(),
        InstallTransactionPhase::RolledBack => "rolled-back".to_string(),
        InstallTransactionPhase::Prepared | InstallTransactionPhase::CommitPending => {
            return Err(
                "Button source update transaction did not reach a durable completion boundary."
                    .to_string(),
            )
        }
    };
    finalize_install_transaction(&transaction_root);
    Ok(result)
}

#[tauri::command]
pub(crate) fn update_button_source(
    mut request: InstallButtonSourceRequest,
) -> Result<InstallButtonSourceResponse, String> {
    request.program_name = crate::require_registered_program_name(&request.program_name)?;
    request.panel_name = crate::validate_folder_name(&request.panel_name, "Panel")?;
    request.owner_button_id = validate_owner_button_id(&request.owner_button_id)?;
    let button_state_guard = crate::button_state::button_state_commit_guard()?;
    let source_guard = super::source_quarantine_guard()?;
    let canonical_document = crate::button_state::read_button_state_for_program_rename_locked()?
        .ok_or_else(|| "Canonical Button state is missing.".to_string())?;
    let previous_projection =
        canonical_source_projection(&canonical_document, &request.owner_button_id)?;
    let result = install_from_path_while_source_locked_with_completion(
        request,
        true,
        &source_guard,
        Some(DeferredCanonicalUpdate {
            previous_projection,
        }),
    );
    drop(source_guard);
    drop(button_state_guard);
    result
}

#[tauri::command]
pub(crate) fn finalize_button_source_update(
    transaction_token: String,
    owner_button_id: String,
) -> Result<String, String> {
    complete_button_source_update(transaction_token, owner_button_id)
}

#[tauri::command]
pub(crate) fn rollback_button_source_update(
    transaction_token: String,
    owner_button_id: String,
) -> Result<String, String> {
    complete_button_source_update(transaction_token, owner_button_id)
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
        blender_install_arguments, build_response, canonical_owner_execution_target,
        canonical_source_projection, classify_canonical_update, detect_import_kind,
        ensure_no_awaiting_canonical_update_in_program, install_transaction_old_package,
        merge_toolset_payload, path_relative_to_program, prepare_source,
        preserve_runtime_directory, previous_owned_record_path_matches,
        read_install_transaction_journal, recover_install_transaction,
        recover_update_residues_with, resolve_awaiting_canonical_transaction, update_residue_name,
        validate_core_execution_target, validate_toolset_layout, validate_update_shape,
        write_install_transaction_journal, CanonicalSourceProjection, CanonicalUpdateDisposition,
        InstallTransactionCompletionMode, InstallTransactionJournal, InstallTransactionPhase,
        PreparedSource, ScriptManifest, ToolsetManifest, INSTALL_TRANSACTION_SCHEMA_VERSION,
        SCRIPT_MANIFEST_FILE_NAME, TOOLSET_MANIFEST_FILE_NAME,
    };
    use crate::program_sources::installed_page::InstalledPageManifest;
    use crate::program_sources::manifest::{ProgramManifest, ProgramRunnerManifest};
    use crate::program_sources::records::{
        active_record_file_name, atomic_write_json, read_active_record, ActiveSourceChild,
        ActiveSourceRecord, LocalInstallRecord, INSTALL_RECORD_FILE_NAME,
    };
    use crate::program_sources::transaction::AtomicWriteMode;
    use serde_json::{json, Value};
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn temporary_test_root(name: &str) -> PathBuf {
        let token = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("flowcell-{name}-{}-{token}", std::process::id()))
    }

    #[test]
    fn previous_owned_paths_accept_exact_legacy_absolute_spelling_only() {
        let root = temporary_test_root("legacy-absolute-owned-path");
        let expected = root
            .join("Local Scripts")
            .join("owner")
            .join("source")
            .join("action.py");
        let relative = path_relative_to_program(&root, &expected).expect("relative owned path");
        let absolute = expected.to_string_lossy().to_string();
        let verbatim = format!(r"\\?\{absolute}");

        assert!(previous_owned_record_path_matches(
            &relative, &relative, &expected
        ));
        assert!(previous_owned_record_path_matches(
            &absolute, &relative, &expected
        ));
        assert!(previous_owned_record_path_matches(
            &verbatim, &relative, &expected
        ));
        assert!(!previous_owned_record_path_matches(
            &root.join("outside.py").to_string_lossy(),
            &relative,
            &expected,
        ));
    }

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

    #[test]
    fn auto_import_detection_is_exact_and_root_scoped() {
        let root = temporary_test_root("auto-import-detection");
        fs::create_dir_all(root.join("nested")).expect("create source folders");
        let raw_script = root.join("standalone.ps1");
        fs::write(&raw_script, "# standalone\n").expect("write raw script");
        assert_eq!(
            detect_import_kind(&raw_script).expect("detect raw script"),
            "script"
        );

        fs::write(root.join(SCRIPT_MANIFEST_FILE_NAME), "{}").expect("write script manifest");
        fs::write(root.join("nested").join(TOOLSET_MANIFEST_FILE_NAME), "{}")
            .expect("write nested tool-set manifest");
        assert_eq!(
            detect_import_kind(&root).expect("detect root script manifest"),
            "script"
        );
        assert_eq!(
            detect_import_kind(&raw_script).expect("detect declared script package entry"),
            "script"
        );

        fs::write(root.join(TOOLSET_MANIFEST_FILE_NAME), "{}")
            .expect("write root tool-set manifest");
        let error = detect_import_kind(&root).expect_err("dual manifests must be rejected");
        assert!(error.contains("ambiguous"));
        let error = detect_import_kind(&raw_script)
            .expect_err("a selected entry beside dual manifests must be rejected");
        assert!(error.contains("ambiguous"));

        fs::remove_file(root.join(SCRIPT_MANIFEST_FILE_NAME)).expect("remove script manifest");
        assert_eq!(
            detect_import_kind(&root).expect("detect root tool-set manifest"),
            "tool-set"
        );
        assert_eq!(
            detect_import_kind(&root.join(TOOLSET_MANIFEST_FILE_NAME))
                .expect("detect selected tool-set manifest"),
            "tool-set"
        );
        assert_eq!(
            detect_import_kind(&raw_script).expect("detect declared tool-set package entry"),
            "tool-set"
        );

        fs::remove_file(root.join(TOOLSET_MANIFEST_FILE_NAME)).expect("remove tool-set manifest");
        let error = detect_import_kind(&root).expect_err("manifest-free folder must be rejected");
        assert!(error.contains("neither"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn page_enabled_script_uses_only_the_generic_installed_page_opener() {
        let root = temporary_test_root("page-enabled-script");
        fs::create_dir_all(root.join("page")).expect("create page package");
        fs::write(root.join("entry.ps1"), "# entry\n").expect("write script entry");
        fs::write(root.join("page/index.html"), "<main>Page</main>").expect("write page entry");
        fs::write(
            root.join(SCRIPT_MANIFEST_FILE_NAME),
            r#"{
                "schemaVersion": 1,
                "id": "windows.page-test",
                "label": "Page Test",
                "program": "Windows",
                "source": "entry.ps1",
                "page": {
                    "schemaVersion": 1,
                    "id": "windows.page-test",
                    "program": "Windows",
                    "label": "Page Test",
                    "tooltip": "",
                    "entry": "page/index.html",
                    "scripts": [],
                    "styles": [],
                    "assets": [],
                    "window": {
                        "title": "Page Test",
                        "width": 480,
                        "height": 360,
                        "minWidth": 320,
                        "minHeight": 240
                    },
                    "actions": [],
                    "capabilities": [],
                    "ownerStateFormat": "windows.page-test.v1",
                    "supportedDataFormats": [],
                    "refreshEvents": []
                }
            }"#,
        )
        .expect("write page manifest");

        let prepared = prepare_source(&windows_manifest(), &root, "script")
            .expect("prepare page-enabled script");
        assert_eq!(
            prepared.page.as_ref().map(|page| page.id.as_str()),
            Some("windows.page-test")
        );
        assert_eq!(
            prepared
                .execution_target
                .as_ref()
                .and_then(|target| target.get("actionId"))
                .and_then(Value::as_str),
            Some("open-installed-page")
        );
        assert_eq!(
            prepared
                .execution_target
                .as_ref()
                .and_then(|target| target.pointer("/payload/pageId"))
                .and_then(Value::as_str),
            Some("windows.page-test")
        );
        let _ = fs::remove_dir_all(&root);
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
            state_query: None,
            events: None,
            children: vec![ActiveSourceChild {
                slot: "go".into(),
                label: "Go".into(),
                tooltip: String::new(),
                payload: Some(json!({"axis":"Y","child":2})),
                execution_target: None,
            }],
            layout: None,
            page: None,
            source_display_path: String::new(),
            bundled_source_id: None,
            bundled_source_version: None,
        }
    }

    fn windows_manifest() -> ProgramManifest {
        ProgramManifest {
            schema_version: 1,
            program_id: "windows".into(),
            label: "Windows".into(),
            program_type: "local-script".into(),
            default_panels: vec!["Files".into(), "Utility".into()],
            panels: Vec::new(),
            process_names: vec!["explorer".into()],
            exe_path: "explorer.exe".into(),
            bind_scoped_native_owner: false,
            shortcut_profile_id: "windows".into(),
            git_scripts_folder: "Windows Git Scripts".into(),
            panels_folder: "Panels".into(),
            local_scripts_folder: "Windows Local Scripts".into(),
            support_scripts_folder: "SupportScripts".into(),
            allowed_script_extensions: vec!["ps1".into(), "vbs".into()],
            allowed_manifest_file_names: vec![SCRIPT_MANIFEST_FILE_NAME.into()],
            supports_toolset_manifests: false,
            bundled_sources: Vec::new(),
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

    fn transaction_state(
        root: &Path,
        label: &str,
        installed_at: &str,
    ) -> (ActiveSourceRecord, LocalInstallRecord) {
        let manifest = windows_manifest();
        let package = root.join(&manifest.local_scripts_folder).join("button_1");
        let source = package.join("source").join("entry.ps1");
        (
            ActiveSourceRecord {
                schema_version: 1,
                owner_button_id: "button_1".into(),
                install_id: "button_1".into(),
                program_id: manifest.program_id.clone(),
                program_name: manifest.label.clone(),
                panel_name: "Tools".into(),
                label: label.into(),
                tooltip: String::new(),
                kind: "script".into(),
                local_package_path: path_relative_to_program(root, &package)
                    .expect("package relative path"),
                source_path: path_relative_to_program(root, &source).expect("source relative path"),
                runner: manifest.runner.kind,
                runner_data: None,
                execution_target: None,
                bridge_action: String::new(),
                bridge_data: None,
                state_query: None,
                events: None,
                children: Vec::new(),
                layout: None,
                page: None,
                source_display_path: format!("C:\\source\\{label}.ps1"),
                bundled_source_id: None,
                bundled_source_version: None,
            },
            LocalInstallRecord {
                schema_version: 1,
                owner_button_id: "button_1".into(),
                install_id: "button_1".into(),
                program_id: manifest.program_id,
                program_name: manifest.label,
                panel_name: "Tools".into(),
                source_relative_path: "source\\entry.ps1".into(),
                source_display_path: format!("C:\\source\\{label}.ps1"),
                installed_at: installed_at.into(),
                bundled_source_id: None,
                bundled_source_version: None,
            },
        )
    }

    fn write_package(path: &Path, install: &LocalInstallRecord, contents: &str) {
        fs::create_dir_all(path.join("source")).expect("create package source");
        fs::write(path.join("source/entry.ps1"), contents).expect("write package source");
        atomic_write_json(&path.join(INSTALL_RECORD_FILE_NAME), install)
            .expect("write package record");
    }

    fn update_transaction_journal(
        previous_record: ActiveSourceRecord,
        previous_install: LocalInstallRecord,
        next_record: ActiveSourceRecord,
        next_install: LocalInstallRecord,
        phase: InstallTransactionPhase,
    ) -> InstallTransactionJournal {
        InstallTransactionJournal {
            schema_version: INSTALL_TRANSACTION_SCHEMA_VERSION,
            phase,
            replace_existing: true,
            owner_button_id: "button_1".into(),
            program_id: "windows".into(),
            program_name: "Windows".into(),
            panel_name: "Tools".into(),
            previous_record: Some(previous_record),
            previous_install: Some(previous_install),
            next_record,
            next_install,
            completion_mode: InstallTransactionCompletionMode::Immediate,
            previous_canonical_projection: None,
            next_canonical_projection: None,
        }
    }

    fn canonical_projection(
        source_revision: Option<&str>,
        execution_target: Value,
    ) -> CanonicalSourceProjection {
        CanonicalSourceProjection {
            owner_button_id: "button_1".into(),
            role: "single-script".into(),
            source_identity: json!({
                "displayProgramName": "Windows",
                "displayPanelName": "Tools",
                "displayFileName": active_record_file_name("button_1"),
                "normalizedProgramName": "windows",
                "normalizedPanelName": "tools",
                "normalizedFileName": active_record_file_name("button_1").to_ascii_lowercase()
            }),
            execution_target,
            source_revision: source_revision.map(str::to_string),
        }
    }

    fn canonical_document(projection: &CanonicalSourceProjection) -> Value {
        let mut metadata = serde_json::Map::new();
        if let Some(revision) = projection.source_revision.as_ref() {
            metadata.insert(
                "flowcellSourceRevision".into(),
                Value::String(revision.clone()),
            );
        }
        json!({
            "schemaVersion": 1,
            "revision": 1,
            "buttons": {
                "button_1": {
                    "id": "button_1",
                    "role": projection.role,
                    "sourceIdentity": projection.source_identity,
                    "executionTarget": projection.execution_target,
                    "metadata": metadata
                }
            }
        })
    }

    fn deferred_update_transaction_journal(
        previous_record: ActiveSourceRecord,
        previous_install: LocalInstallRecord,
        next_record: ActiveSourceRecord,
        next_install: LocalInstallRecord,
        phase: InstallTransactionPhase,
        transaction_token: &str,
    ) -> InstallTransactionJournal {
        let previous_target = canonical_owner_execution_target(
            &previous_record,
            &active_record_file_name("button_1"),
        )
        .expect("previous canonical target");
        let next_target =
            canonical_owner_execution_target(&next_record, &active_record_file_name("button_1"))
                .expect("next canonical target");
        InstallTransactionJournal {
            schema_version: INSTALL_TRANSACTION_SCHEMA_VERSION,
            phase,
            replace_existing: true,
            owner_button_id: "button_1".into(),
            program_id: "windows".into(),
            program_name: "Windows".into(),
            panel_name: "Tools".into(),
            previous_record: Some(previous_record),
            previous_install: Some(previous_install),
            next_record,
            next_install,
            completion_mode: InstallTransactionCompletionMode::AwaitCanonical,
            previous_canonical_projection: Some(canonical_projection(None, previous_target)),
            next_canonical_projection: Some(canonical_projection(
                Some(transaction_token),
                next_target,
            )),
        }
    }

    fn installed_page(id: &str, owner_state_format: &str) -> InstalledPageManifest {
        serde_json::from_value(json!({
            "schemaVersion": 1,
            "id": id,
            "program": "Windows",
            "label": "Page",
            "tooltip": "",
            "entry": "page/index.html",
            "scripts": [],
            "styles": [],
            "assets": [],
            "window": {
                "title": "Page",
                "width": 480,
                "height": 360,
                "minWidth": 320,
                "minHeight": 240
            },
            "actions": [],
            "capabilities": [],
            "ownerStateFormat": owner_state_format,
            "supportedDataFormats": [],
            "refreshEvents": []
        }))
        .expect("installed page fixture")
    }

    fn toolset_manifest_with_layout(layout: Value) -> Result<ToolsetManifest, serde_json::Error> {
        serde_json::from_value(json!({
            "schemaVersion": 1,
            "id": "windows.layout-test",
            "version": "1.0.0",
            "label": "Layout Test",
            "program": "Windows",
            "source": "entry.ps1",
            "children": [{"slot":"run", "label":"Run"}],
            "layout": layout
        }))
    }

    fn layout_test_children() -> Vec<ActiveSourceChild> {
        vec![ActiveSourceChild {
            slot: "run".into(),
            label: "Run".into(),
            tooltip: String::new(),
            payload: None,
            execution_target: None,
        }]
    }

    #[test]
    fn prepared_update_recovers_after_process_cut_between_package_and_active_record() {
        let root = temporary_test_root("install-prepared-recovery");
        let manifest = windows_manifest();
        let local_root = root.join(&manifest.local_scripts_folder);
        let panel_root = root.join(&manifest.panels_folder).join("Tools");
        let final_package = local_root.join("button_1");
        let transaction_root = local_root.join(".flowcell-install-transaction-test");
        let old_package = install_transaction_old_package(&transaction_root);
        let active_path = panel_root.join(active_record_file_name("button_1"));
        let (previous_record, previous_install) = transaction_state(&root, "Old", "old");
        let (next_record, next_install) = transaction_state(&root, "New", "new");
        fs::create_dir_all(&transaction_root).expect("create transaction");
        fs::create_dir_all(&panel_root).expect("create panel");
        write_package(&old_package, &previous_install, "old");
        write_package(&final_package, &next_install, "new");
        atomic_write_json(&active_path, &previous_record).expect("write previous active");
        let journal = update_transaction_journal(
            previous_record.clone(),
            previous_install,
            next_record,
            next_install,
            InstallTransactionPhase::Prepared,
        );
        write_install_transaction_journal(
            &manifest,
            &root,
            &transaction_root,
            &journal,
            AtomicWriteMode::Create,
        )
        .expect("write transaction journal");

        recover_install_transaction(&manifest, &root, &transaction_root)
            .expect("recover prepared transaction");

        assert_eq!(
            fs::read_to_string(final_package.join("source/entry.ps1"))
                .expect("read restored source"),
            "old"
        );
        assert_eq!(
            read_active_record(&active_path)
                .expect("read restored active")
                .label,
            previous_record.label
        );
        assert_eq!(
            read_install_transaction_journal(&manifest, &root, &transaction_root)
                .expect("read journal")
                .expect("journal exists")
                .phase,
            InstallTransactionPhase::RolledBack
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn commit_pending_update_completes_after_process_cut_before_active_record() {
        let root = temporary_test_root("install-commit-recovery");
        let manifest = windows_manifest();
        let local_root = root.join(&manifest.local_scripts_folder);
        let panel_root = root.join(&manifest.panels_folder).join("Tools");
        let final_package = local_root.join("button_1");
        let transaction_root = local_root.join(".flowcell-install-transaction-test");
        let old_package = install_transaction_old_package(&transaction_root);
        let active_path = panel_root.join(active_record_file_name("button_1"));
        let (previous_record, previous_install) = transaction_state(&root, "Old", "old");
        let (next_record, next_install) = transaction_state(&root, "New", "new");
        fs::create_dir_all(&transaction_root).expect("create transaction");
        fs::create_dir_all(&panel_root).expect("create panel");
        write_package(&old_package, &previous_install, "old");
        write_package(&final_package, &next_install, "new");
        atomic_write_json(&active_path, &previous_record).expect("write previous active");
        let journal = update_transaction_journal(
            previous_record,
            previous_install,
            next_record.clone(),
            next_install,
            InstallTransactionPhase::CommitPending,
        );
        write_install_transaction_journal(
            &manifest,
            &root,
            &transaction_root,
            &journal,
            AtomicWriteMode::Create,
        )
        .expect("write transaction journal");

        recover_install_transaction(&manifest, &root, &transaction_root)
            .expect("complete pending transaction");

        assert_eq!(
            read_active_record(&active_path)
                .expect("read committed active")
                .label,
            next_record.label
        );
        assert_eq!(
            read_install_transaction_journal(&manifest, &root, &transaction_root)
                .expect("read journal")
                .expect("journal exists")
                .phase,
            InstallTransactionPhase::Committed
        );
        assert!(old_package.is_dir(), "backup remains until cleanup");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn deferred_commit_pending_waits_for_canonical_and_rolls_back_previous_projection() {
        let root = temporary_test_root("deferred-install-rollback");
        let manifest = windows_manifest();
        let local_root = root.join(&manifest.local_scripts_folder);
        let panel_root = root.join(&manifest.panels_folder).join("Tools");
        let final_package = local_root.join("button_1");
        let transaction_token = ".flowcell-install-transaction-test";
        let transaction_root = local_root.join(transaction_token);
        let old_package = install_transaction_old_package(&transaction_root);
        let active_path = panel_root.join(active_record_file_name("button_1"));
        let (previous_record, previous_install) = transaction_state(&root, "Old", "old");
        let (next_record, next_install) = transaction_state(&root, "New", "new");
        fs::create_dir_all(&transaction_root).expect("create transaction");
        fs::create_dir_all(&panel_root).expect("create panel");
        write_package(&old_package, &previous_install, "old");
        write_package(&final_package, &next_install, "new");
        atomic_write_json(&active_path, &previous_record).expect("write previous active");
        let journal = deferred_update_transaction_journal(
            previous_record.clone(),
            previous_install,
            next_record.clone(),
            next_install,
            InstallTransactionPhase::CommitPending,
            transaction_token,
        );
        let previous_projection = journal
            .previous_canonical_projection
            .clone()
            .expect("previous projection");
        write_install_transaction_journal(
            &manifest,
            &root,
            &transaction_root,
            &journal,
            AtomicWriteMode::Create,
        )
        .expect("write transaction journal");

        recover_install_transaction(&manifest, &root, &transaction_root)
            .expect("publish native update");
        assert_eq!(
            read_install_transaction_journal(&manifest, &root, &transaction_root)
                .expect("read journal")
                .expect("journal exists")
                .phase,
            InstallTransactionPhase::AwaitingCanonical
        );
        assert_eq!(
            read_active_record(&active_path)
                .expect("read published active")
                .label,
            next_record.label
        );

        assert_eq!(
            resolve_awaiting_canonical_transaction(
                &manifest,
                &root,
                &transaction_root,
                &canonical_document(&previous_projection),
            )
            .expect("roll back native update"),
            "rolled-back"
        );
        assert_eq!(
            fs::read_to_string(final_package.join("source/entry.ps1"))
                .expect("read restored source"),
            "old"
        );
        assert_eq!(
            read_active_record(&active_path)
                .expect("read restored active")
                .label,
            previous_record.label
        );
        assert_eq!(
            read_install_transaction_journal(&manifest, &root, &transaction_root)
                .expect("read journal")
                .expect("journal exists")
                .phase,
            InstallTransactionPhase::RolledBack
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn awaiting_canonical_finalizes_only_the_exact_marked_next_projection() {
        let root = temporary_test_root("deferred-install-finalize");
        let manifest = windows_manifest();
        let local_root = root.join(&manifest.local_scripts_folder);
        let panel_root = root.join(&manifest.panels_folder).join("Tools");
        let final_package = local_root.join("button_1");
        let transaction_token = ".flowcell-install-transaction-test";
        let transaction_root = local_root.join(transaction_token);
        let old_package = install_transaction_old_package(&transaction_root);
        let active_path = panel_root.join(active_record_file_name("button_1"));
        let (previous_record, previous_install) = transaction_state(&root, "Old", "old");
        let (next_record, next_install) = transaction_state(&root, "New", "new");
        fs::create_dir_all(&transaction_root).expect("create transaction");
        fs::create_dir_all(&panel_root).expect("create panel");
        write_package(&old_package, &previous_install, "old");
        write_package(&final_package, &next_install, "new");
        atomic_write_json(&active_path, &next_record).expect("write next active");
        let journal = deferred_update_transaction_journal(
            previous_record,
            previous_install,
            next_record.clone(),
            next_install,
            InstallTransactionPhase::AwaitingCanonical,
            transaction_token,
        );
        let next_projection = journal
            .next_canonical_projection
            .clone()
            .expect("next projection");
        write_install_transaction_journal(
            &manifest,
            &root,
            &transaction_root,
            &journal,
            AtomicWriteMode::Create,
        )
        .expect("write transaction journal");

        let mut divergent = next_projection.clone();
        divergent.execution_target = json!({"kind":"core-action","actionId":"different"});
        let error = resolve_awaiting_canonical_transaction(
            &manifest,
            &root,
            &transaction_root,
            &canonical_document(&divergent),
        )
        .expect_err("divergent canonical state must retain transaction");
        assert!(error.contains("neither the previous nor updated source projection"));
        assert_eq!(
            read_install_transaction_journal(&manifest, &root, &transaction_root)
                .expect("read retained journal")
                .expect("journal exists")
                .phase,
            InstallTransactionPhase::AwaitingCanonical
        );

        assert_eq!(
            resolve_awaiting_canonical_transaction(
                &manifest,
                &root,
                &transaction_root,
                &canonical_document(&next_projection),
            )
            .expect("finalize native update"),
            "finalized"
        );
        assert_eq!(
            read_install_transaction_journal(&manifest, &root, &transaction_root)
                .expect("read committed journal")
                .expect("journal exists")
                .phase,
            InstallTransactionPhase::Committed
        );
        assert!(old_package.is_dir(), "backup remains until cleanup");
        assert_eq!(
            read_active_record(&active_path)
                .expect("read committed active")
                .label,
            next_record.label
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn canonical_projection_rejects_missing_or_malformed_revision_markers() {
        let previous = canonical_projection(None, json!({"kind":"panel-script"}));
        let next = canonical_projection(
            Some(".flowcell-install-transaction-test"),
            json!({"kind":"panel-script"}),
        );
        let mut journal = update_transaction_journal(
            transaction_state(Path::new("C:\\Programs\\Windows"), "Old", "old").0,
            transaction_state(Path::new("C:\\Programs\\Windows"), "Old", "old").1,
            transaction_state(Path::new("C:\\Programs\\Windows"), "New", "new").0,
            transaction_state(Path::new("C:\\Programs\\Windows"), "New", "new").1,
            InstallTransactionPhase::AwaitingCanonical,
        );
        journal.completion_mode = InstallTransactionCompletionMode::AwaitCanonical;
        journal.previous_canonical_projection = Some(previous.clone());
        journal.next_canonical_projection = Some(next.clone());
        assert_eq!(
            classify_canonical_update(&journal, &canonical_document(&previous))
                .expect("previous projection"),
            CanonicalUpdateDisposition::RollBack
        );
        assert_eq!(
            classify_canonical_update(&journal, &canonical_document(&next))
                .expect("next projection"),
            CanonicalUpdateDisposition::Finalize
        );
        let mut malformed = canonical_document(&next);
        malformed["buttons"]["button_1"]["metadata"]["flowcellSourceRevision"] = json!(17);
        assert!(canonical_source_projection(&malformed, "button_1").is_err());
    }

    #[test]
    fn canonical_owner_target_merges_shared_events_like_the_frontend_normalizer() {
        let (mut record, _) = transaction_state(Path::new("C:\\Programs\\Windows"), "Tool", "now");
        record.execution_target = Some(json!({
            "kind": "core-action",
            "actionId": "open-window-grid",
            "events": {"existing": {"action":"old"}, "shared": {"action":"target"}}
        }));
        record.events = Some(BTreeMap::from([
            ("shared".into(), json!({"action":"source"})),
            ("added".into(), json!({"action":"new"})),
        ]));
        let target =
            canonical_owner_execution_target(&record, &active_record_file_name("button_1"))
                .expect("canonical target");
        assert_eq!(target["events"]["existing"]["action"], "old");
        assert_eq!(target["events"]["shared"]["action"], "source");
        assert_eq!(target["events"]["added"]["action"], "new");
    }

    #[test]
    fn awaiting_canonical_guard_blocks_only_the_transaction_owner() {
        let root = temporary_test_root("awaiting-owner-guard");
        let manifest = windows_manifest();
        let local_root = root.join(&manifest.local_scripts_folder);
        let transaction_token = ".flowcell-install-transaction-test";
        let transaction_root = local_root.join(transaction_token);
        let (previous_record, previous_install) = transaction_state(&root, "Old", "old");
        let (next_record, next_install) = transaction_state(&root, "New", "new");
        fs::create_dir_all(&transaction_root).expect("create transaction");
        let journal = deferred_update_transaction_journal(
            previous_record,
            previous_install,
            next_record,
            next_install,
            InstallTransactionPhase::AwaitingCanonical,
            transaction_token,
        );
        write_install_transaction_journal(
            &manifest,
            &root,
            &transaction_root,
            &journal,
            AtomicWriteMode::Create,
        )
        .expect("write transaction journal");

        let error = ensure_no_awaiting_canonical_update_in_program(&manifest, &root, "button_1")
            .expect_err("same owner must be blocked");
        assert!(error.contains("awaiting its canonical Button-state commit"));
        ensure_no_awaiting_canonical_update_in_program(&manifest, &root, "button_2")
            .expect("different owner remains available");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn failed_install_rollback_retains_transaction_artifacts() {
        let root = temporary_test_root("install-failed-rollback");
        let manifest = windows_manifest();
        let local_root = root.join(&manifest.local_scripts_folder);
        let panel_root = root.join(&manifest.panels_folder).join("Tools");
        let final_package = local_root.join("button_1");
        let transaction_root = local_root.join(".flowcell-install-transaction-test");
        let active_path = panel_root.join(active_record_file_name("button_1"));
        let (previous_record, previous_install) = transaction_state(&root, "Old", "old");
        let (next_record, next_install) = transaction_state(&root, "New", "new");
        fs::create_dir_all(&transaction_root).expect("create transaction");
        fs::create_dir_all(&panel_root).expect("create panel");
        write_package(&final_package, &next_install, "new");
        atomic_write_json(&active_path, &previous_record).expect("write previous active");
        let journal = update_transaction_journal(
            previous_record,
            previous_install,
            next_record,
            next_install,
            InstallTransactionPhase::Prepared,
        );
        write_install_transaction_journal(
            &manifest,
            &root,
            &transaction_root,
            &journal,
            AtomicWriteMode::Create,
        )
        .expect("write transaction journal");

        let error = recover_install_transaction(&manifest, &root, &transaction_root)
            .expect_err("missing previous package must fail closed");

        assert!(error.contains("cannot find the previous package"));
        assert!(transaction_root.is_dir());
        assert!(final_package.is_dir());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn selected_script_and_toolset_entries_promote_manifest_and_companions_are_rejected() {
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
        fs::write(
            root.join(TOOLSET_MANIFEST_FILE_NAME),
            r#"{
                "schemaVersion": 1,
                "id": "windows.test-toolset-package",
                "label": "Test Tool Set Package",
                "program": "Windows",
                "source": "entry.vbs",
                "children": [
                    { "slot": "run", "label": "Run", "payload": { "command": "run" } }
                ]
            }"#,
        )
        .expect("write tool-set manifest");
        let mut toolset_program = windows_manifest();
        toolset_program.supports_toolset_manifests = true;
        let prepared = prepare_source(&toolset_program, &root.join("entry.vbs"), "tool-set")
            .expect("promote declared tool-set entry to package");
        assert_eq!(prepared.package_source_root, root);
        assert_eq!(
            prepared.source_relative_to_package,
            PathBuf::from("entry.vbs")
        );
        assert_eq!(
            prepared
                .children
                .iter()
                .map(|child| child.slot.as_str())
                .collect::<Vec<_>>(),
            vec!["run"]
        );
        let error = match prepare_source(&toolset_program, &root.join("helper.ps1"), "tool-set") {
            Ok(_) => panic!("tool-set companion import must fail closed"),
            Err(error) => error,
        };
        assert!(error.contains("companion file in a tool-set package"));
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
            state_query: None,
            execution_target: None,
            events: None,
            children: previous.children.clone(),
            layout: None,
            page: None,
            runner_data: None,
        };
        assert!(validate_update_shape(&previous, &prepared).is_ok());
        let mut appended = prepared.children[0].clone();
        appended.slot = "appended".into();
        prepared.children.push(appended);
        assert!(validate_update_shape(&previous, &prepared).is_err());
        prepared.layout = Some(json!({
            "updatePolicy": { "appendMissingChildSlots": true }
        }));
        assert!(validate_update_shape(&previous, &prepared).is_ok());
        prepared.children.pop();
        prepared.layout = None;
        prepared.children[0].slot = "other".into();
        assert!(validate_update_shape(&previous, &prepared).is_err());
        prepared.children.clear();
        assert!(validate_update_shape(&previous, &prepared).is_err());
    }

    #[test]
    fn page_update_keeps_page_identity_and_owner_state_format_stable() {
        let mut previous = transaction_state(Path::new("C:\\Programs\\Windows"), "Page", "old").0;
        previous.page = Some(installed_page("windows.page", "windows.page.v1"));
        let mut prepared = PreparedSource {
            package_source_root: PathBuf::from("package"),
            source_relative_to_package: PathBuf::from("source.ps1"),
            label: "Page".into(),
            tooltip: String::new(),
            kind: "script".into(),
            bridge_data: None,
            state_query: None,
            execution_target: None,
            events: None,
            children: Vec::new(),
            layout: None,
            page: Some(installed_page("windows.page", "windows.page.v1")),
            runner_data: None,
        };
        assert!(validate_update_shape(&previous, &prepared).is_ok());
        prepared.page = Some(installed_page("windows.other", "windows.page.v1"));
        assert!(validate_update_shape(&previous, &prepared).is_err());
        prepared.page = Some(installed_page("windows.page", "windows.page.v2"));
        assert!(validate_update_shape(&previous, &prepared).is_err());
        prepared.page = None;
        assert!(validate_update_shape(&previous, &prepared).is_err());

        previous.page = None;
        prepared.page = Some(installed_page("windows.page", "windows.page.v1"));
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
            Path::new("tool.py"),
            Some(&json!({"capabilities":["example-capability"]})),
        )
        .expect("arguments");
        let value_index = arguments
            .iter()
            .position(|argument| argument == "-BridgeDataJson")
            .expect("BridgeDataJson argument")
            + 1;
        let bridge_data: serde_json::Value =
            serde_json::from_str(&arguments[value_index]).expect("bridgeData JSON");
        assert_eq!(bridge_data["capabilities"], json!(["example-capability"]));
    }

    #[test]
    fn script_core_action_receives_installed_owner_identity() {
        let mut source = record();
        source.program_id = "windows".into();
        source.program_name = "Windows".into();
        source.panel_name = "Files".into();
        source.runner = "file".into();
        source.kind = "script".into();
        source.children.clear();
        source.execution_target = Some(json!({
            "kind": "core-action",
            "actionId": "open-window-grid"
        }));
        let response = build_response(&source, "button_1.flowcell-source.json".into());
        let target = response.owner.execution_target.expect("execution target");
        assert_eq!(target["kind"], "core-action");
        assert_eq!(target["payload"]["programName"], "Windows");
        assert_eq!(target["payload"]["panelName"], "Files");
        assert_eq!(
            target["payload"]["fileName"],
            "button_1.flowcell-source.json"
        );
        assert_eq!(target["payload"]["ownerButtonId"], "button_1");
    }

    #[test]
    fn toolset_child_core_action_receives_installed_owner_identity() {
        let mut source = record();
        source.program_name = "Blender".into();
        source.panel_name = "toolset".into();
        source.children[0].execution_target = Some(json!({
            "kind": "core-action",
            "actionId": "open-window-grid"
        }));
        let response = build_response(&source, "tools.flowcell-source.json".into());
        let target = &response.children[0].execution_target;
        assert_eq!(target["payload"]["programName"], "Blender");
        assert_eq!(target["payload"]["panelName"], "toolset");
        assert_eq!(target["payload"]["fileName"], "tools.flowcell-source.json");
        assert_eq!(target["payload"]["ownerButtonId"], source.owner_button_id);
    }

    #[test]
    fn catalog_manifests_cannot_name_arbitrary_core_actions() {
        assert!(validate_core_execution_target(
            "script package",
            &json!({
                "kind": "core-action",
                "actionId": "open-window-grid"
            })
        )
        .is_ok());
        for retired_action in [
            "open-tool-page",
            "open-illustrator-layer-tree",
            "sample-blender-theme-image",
            "save-blender-theme-fields",
            "load-blender-theme-fields",
        ] {
            assert!(validate_core_execution_target(
                "script package",
                &json!({
                    "kind": "core-action",
                    "actionId": retired_action
                })
            )
            .is_err());
        }
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
    fn committed_update_cleanup_failure_is_recorded_without_blocking_recovery() {
        let root = temporary_test_root("update-cleanup");
        let final_package = root.join("owner_1");
        let replacing = root.join(update_residue_name("replacing", "owner_1"));
        fs::create_dir_all(&final_package).expect("create final package");
        fs::create_dir_all(&replacing).expect("create previous package");

        recover_update_residues_with(&root, &final_package, "owner_1", |_| {
            Err("recycle unavailable".to_string())
        })
        .expect("committed update remains successful");

        let names = fs::read_dir(&root)
            .expect("read update root")
            .map(|entry| {
                entry
                    .expect("read residue")
                    .file_name()
                    .to_string_lossy()
                    .to_string()
            })
            .collect::<Vec<_>>();
        assert!(names
            .iter()
            .any(|name| name.starts_with(".cleanup-pending-owner_1-")));

        let next_replacing = root.join(update_residue_name("replacing", "owner_1"));
        fs::create_dir_all(&next_replacing).expect("create next previous package");
        recover_update_residues_with(&root, &final_package, "owner_1", |_| {
            Err("recycle still unavailable".to_string())
        })
        .expect("pending cleanup does not block a later update");
        assert!(final_package.is_dir());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn interrupted_update_restores_the_only_replacing_package() {
        let root = temporary_test_root("update-restore");
        let final_package = root.join("owner_1");
        let replacing = root.join(update_residue_name("replacing", "owner_1"));
        fs::create_dir_all(&replacing).expect("create interrupted package");
        fs::write(replacing.join("sentinel"), "old").expect("write sentinel");

        recover_update_residues_with(&root, &final_package, "owner_1", |_| Ok(()))
            .expect("restore interrupted package");
        assert_eq!(
            fs::read_to_string(final_package.join("sentinel")).expect("read restored sentinel"),
            "old"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn shipped_flatten_revolve_entry_promotes_a_self_contained_toolset() {
        let package_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("Programs")
            .join("Blender")
            .join("Blender Git Scripts")
            .join("Toolsets")
            .join("flatten-revolve");
        let entry = package_root.join("flatten revolve.py");
        assert_eq!(
            detect_import_kind(&entry).expect("detect shipped tool-set entry"),
            "tool-set"
        );

        let mut manifest = windows_manifest();
        manifest.program_id = "blender".into();
        manifest.label = "Blender".into();
        manifest.allowed_script_extensions = vec!["py".into()];
        manifest.supports_toolset_manifests = true;
        manifest.runner.kind = "blender-bridge".into();
        let prepared = prepare_source(&manifest, &entry, "tool-set")
            .expect("promote shipped Flatten/Revolve entry");

        assert_eq!(prepared.package_source_root, package_root);
        assert_eq!(
            prepared.source_relative_to_package,
            PathBuf::from("flatten revolve.py")
        );
        assert_eq!(
            prepared
                .children
                .iter()
                .map(|child| child.slot.as_str())
                .collect::<Vec<_>>(),
            vec![
                "pivot_select",
                "flatten_profile",
                "flatten_axis_select",
                "generate_revolve",
                "revolve_axis_select",
                "angle_input",
                "steps_input",
                "merge_input",
            ]
        );
        let layout = prepared.layout.as_ref().expect("tool-set layout");
        assert_eq!(
            layout
                .pointer("/fields/0/defaultValue")
                .and_then(Value::as_str),
            Some("WORLD")
        );
        assert_eq!(
            layout
                .pointer("/fields/1/defaultValue")
                .and_then(Value::as_str),
            Some("Y")
        );
        assert_eq!(
            layout
                .pointer("/fields/2/defaultValue")
                .and_then(Value::as_str),
            Some("Z")
        );
        assert_eq!(
            layout
                .pointer("/childBehaviors/pivot_select/selectField")
                .and_then(Value::as_str),
            Some("center_mode")
        );
        assert_eq!(
            layout
                .pointer("/childBehaviors/merge_input/inlineEditField")
                .and_then(Value::as_str),
            Some("merge_distance")
        );

        let source = fs::read_to_string(&entry).expect("read shipped Flatten/Revolve source");
        assert!(source.contains("def run_flowcell_action"));
        assert!(!source.contains("flowcell_actions"));
        assert!(!source.contains("flatten_revolve_tools"));
    }

    #[test]
    fn toolset_layout_rejects_unsupported_keys_and_malformed_shapes() {
        assert!(toolset_manifest_with_layout(json!({
            "mode": "grid",
            "presentation": {"kind":"page"}
        }))
        .is_err());
        assert!(toolset_manifest_with_layout(json!({
            "mode": "grid",
            "fields": {}
        }))
        .is_err());

        let children = layout_test_children();
        let unsupported_mode = toolset_manifest_with_layout(json!({"mode":"page"}))
            .expect("typed unsupported mode")
            .layout
            .expect("layout");
        assert!(validate_toolset_layout(&unsupported_mode, &children).is_err());
        let invalid_rect = toolset_manifest_with_layout(json!({
            "mode": "grid",
            "placements": {"run":{"x":0,"y":0,"width":0,"height":20}}
        }))
        .expect("typed invalid rect")
        .layout
        .expect("layout");
        assert!(validate_toolset_layout(&invalid_rect, &children).is_err());
        let unknown_slot = toolset_manifest_with_layout(json!({
            "mode": "grid",
            "placements": {"missing":{"x":0,"y":0,"width":20,"height":20}}
        }))
        .expect("typed unknown slot")
        .layout
        .expect("layout");
        assert!(validate_toolset_layout(&unknown_slot, &children).is_err());
    }

    #[test]
    fn toolset_layout_rejects_late_canonical_field_failures_before_install() {
        let children = layout_test_children();
        let field = json!({
            "id":"value",
            "kind":"number",
            "label":"Value",
            "payloadKey":"value",
            "defaultValue":1,
            "x":0,
            "y":0,
            "width":20,
            "height":20,
            "zIndex":0
        });
        let unknown_service_key = toolset_manifest_with_layout(json!({
            "mode":"grid",
            "fields":[{
                "id":"service",
                "kind":"number",
                "label":"Service",
                "payloadKey":"service",
                "defaultValue":1,
                "x":0,
                "y":0,
                "width":20,
                "height":20,
                "zIndex":0,
                "serviceTarget":{
                    "kind":"core-action",
                    "actionId":"open-window-grid",
                    "unsupported":true
                }
            }]
        }))
        .expect("typed service target")
        .layout
        .expect("layout");
        assert!(validate_toolset_layout(&unknown_service_key, &children).is_err());

        let unknown_template_field = toolset_manifest_with_layout(json!({
            "mode":"grid",
            "fields":[field],
            "childBehaviors":{
                "run":{
                    "payloadTemplate":{
                        "nested":[{"$field":"missing"}]
                    }
                }
            }
        }))
        .expect("typed payload template")
        .layout
        .expect("layout");
        assert!(validate_toolset_layout(&unknown_template_field, &children).is_err());
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
                    let manifest =
                        serde_json::from_str::<ToolsetManifest>(&raw).unwrap_or_else(|error| {
                            panic!("{} does not match ToolsetManifest: {error}", path.display())
                        });
                    if let Some(layout) = manifest.layout.as_ref() {
                        let children = manifest
                            .children
                            .iter()
                            .map(|child| ActiveSourceChild {
                                slot: child.slot.clone(),
                                label: child.label.clone(),
                                tooltip: child.tooltip.clone(),
                                payload: child.payload.clone(),
                                execution_target: child.execution_target.clone(),
                            })
                            .collect::<Vec<_>>();
                        validate_toolset_layout(layout, &children).unwrap_or_else(|error| {
                            panic!("{} has unsupported layout: {error}", path.display())
                        });
                    }
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
