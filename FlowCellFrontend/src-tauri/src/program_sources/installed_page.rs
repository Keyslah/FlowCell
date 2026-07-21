use super::execute::{
    resolve_active_source_record, resolve_owned_source_paths, ActiveSourceResolution,
};
use super::manifest::load_program_manifest;
use super::records::ActiveSourceRecord;
use super::transaction::{write_json_file, AtomicWriteMode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const MAX_PAGE_RESOURCES: usize = 256;
const MAX_PAGE_ACTIONS: usize = 128;
const MAX_SCHEMA_DEPTH: usize = 32;
const MAX_TEXT_RESOURCE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_ASSET_RESOURCE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_GENERATED_STAGE_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_GENERATED_SOURCE_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_GENERATED_SCRIPT_BYTES: u64 = 32 * 1024 * 1024;
const MAX_GENERATED_STAGE_ENTRIES: usize = 4096;
const MAX_GENERATED_STAGE_DEPTH: usize = 32;
const GENERATED_STAGE_CLEANUP_SCHEMA_VERSION: u32 = 1;
const GENERATED_STAGE_CLEANUP_DIRECTORY: &str = "generated-stage-transactions";
const GENERATED_STAGE_CLEANUP_JOURNAL: &str = "journal.json";
const OWNER_STATE_FILE_NAME: &str = "installed-page-state.json";
static GENERATED_STAGE_CLEANUP_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
const CORE_PAGE_CAPABILITIES: &[&str] = &[
    "file.select",
    "folder.select",
    "image.sample-palette",
    "tool-fields.save",
    "tool-fields.load",
    "tool-package.save",
    "tool-package.open",
    "tool-package.cycle",
    "button.install-generated",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InstalledPageWindow {
    pub title: String,
    pub width: u32,
    pub height: u32,
    pub min_width: u32,
    pub min_height: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub(crate) enum InstalledPageActionHandler {
    Program {
        capability: String,
        payload: Map<String, Value>,
    },
    OwnerState {
        operation: OwnerStateOperation,
    },
    Core {
        capability: String,
        options: Map<String, Value>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum OwnerStateOperation {
    Read,
    Write,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InstalledPageAction {
    pub id: String,
    pub handler: InstalledPageActionHandler,
    pub request_schema: Value,
    pub response_schema: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InstalledPageManifest {
    pub schema_version: u32,
    pub id: String,
    pub program: String,
    pub label: String,
    pub tooltip: String,
    pub entry: String,
    pub scripts: Vec<String>,
    pub styles: Vec<String>,
    pub assets: Vec<String>,
    pub window: InstalledPageWindow,
    pub actions: Vec<InstalledPageAction>,
    pub capabilities: Vec<String>,
    pub owner_state_format: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shared_program_data_namespace: Option<String>,
    pub supported_data_formats: Vec<String>,
    pub refresh_events: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<Value>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledPageTextResource {
    pub path: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledPageAssetResource {
    pub path: String,
    pub mime_type: String,
    pub base64: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledPageDescriptor {
    pub owner_button_id: String,
    pub program_id: String,
    pub program_name: String,
    pub panel_name: String,
    pub file_name: String,
    pub source_record_id: String,
    pub installed_owner_root: String,
    pub page_id: String,
    pub label: String,
    pub tooltip: String,
    pub entry_html: String,
    pub scripts: Vec<InstalledPageTextResource>,
    pub styles: Vec<InstalledPageTextResource>,
    pub assets: Vec<InstalledPageAssetResource>,
    pub window: InstalledPageWindow,
    pub declared_resource_paths: Vec<String>,
    pub declared_actions: Vec<InstalledPageAction>,
    pub declared_capabilities: Vec<String>,
    pub owner_runtime_state_namespace: String,
    pub shared_program_data_namespace: Option<String>,
    pub supported_data_formats: Vec<String>,
    pub config: Value,
    pub refresh_events: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum InstalledPageActionRunResult {
    Complete {
        value: Value,
    },
    CoreAction {
        capability: String,
        options: Map<String, Value>,
        payload: Value,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OwnerStateEnvelope {
    schema_version: u32,
    page_id: String,
    format: String,
    value: Value,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GeneratedStageManifest {
    schema_version: u32,
    format: String,
    namespace: String,
    stage_token: String,
    created_at: String,
    program_name: String,
    import_kind: String,
    package_id: String,
    source_manifest_relative_path: String,
    source_manifest_sha256: String,
    script_sha256: String,
    #[serde(default)]
    metadata: Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GeneratedScriptSourceManifest {
    schema_version: u32,
    id: String,
    label: String,
    #[serde(default)]
    tooltip: String,
    program: String,
    source: String,
}

#[derive(Clone, Debug)]
struct GeneratedStagePolicy {
    program_name: String,
    import_kind: String,
    stage_namespace: String,
    stage_format: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthorizedGeneratedStage {
    manifest_path: String,
    stage_root: String,
}

#[derive(Clone, Debug)]
struct AuthorizedGeneratedStagePaths {
    staging_root: PathBuf,
    manifest_path: PathBuf,
    stage_root: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GeneratedStageCleanupJournal {
    schema_version: u32,
    owner_button_id: String,
    program_id: String,
    program_name: String,
    panel_name: String,
    file_name: String,
    page_id: String,
    action_id: String,
    shared_program_data_namespace: String,
    stage_token: String,
    staging_root: String,
    stage_root: String,
    manifest_path: String,
}

#[derive(Clone, Debug)]
struct ResolvedGeneratedStage {
    paths: AuthorizedGeneratedStagePaths,
    cleanup_journal: GeneratedStageCleanupJournal,
}

fn normalize_identifier(value: &str, field: &str, allow_colon: bool) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() || normalized.len() > 128 {
        return Err(format!(
            "Page field '{field}' must contain 1 to 128 characters."
        ));
    }
    if !normalized.chars().all(|character| {
        character.is_ascii_alphanumeric()
            || matches!(character, '.' | '-' | '_')
            || (allow_colon && character == ':')
    }) {
        return Err(format!(
            "Page field '{field}' contains unsupported characters."
        ));
    }
    Ok(normalized.to_string())
}

fn normalize_display_text(
    value: &str,
    field: &str,
    allow_empty: bool,
    maximum: usize,
) -> Result<String, String> {
    let normalized = value.trim();
    if (!allow_empty && normalized.is_empty()) || normalized.len() > maximum {
        let minimum = if allow_empty { 0 } else { 1 };
        return Err(format!(
            "Page field '{field}' must contain {minimum} to {maximum} characters."
        ));
    }
    Ok(normalized.to_string())
}

fn normalized_relative_resource_path(value: &str, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    let path = Path::new(trimmed);
    if trimmed.is_empty() || path.is_absolute() {
        return Err(format!(
            "Page field '{field}' must be a non-empty relative package path."
        ));
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => normalized.push(segment),
            _ => {
                return Err(format!(
                    "Page field '{field}' may not contain traversal, roots, prefixes, or current-directory components."
                ))
            }
        }
    }
    if normalized.as_os_str().is_empty() {
        return Err(format!("Page field '{field}' cannot be empty."));
    }
    Ok(normalized.to_string_lossy().replace('\\', "/"))
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
            "Installed page {subject} cannot be a symbolic link or reparse point: {}.",
            path.display()
        ));
    }
    Ok(metadata)
}

pub(crate) fn reject_selected_source_reparse_point(path: &Path) -> Result<(), String> {
    if path.exists() {
        for ancestor in path.ancestors() {
            if ancestor.as_os_str().is_empty() {
                continue;
            }
            reject_link_or_reparse(ancestor, "selected source path component")?;
        }
    }
    Ok(())
}

pub(crate) fn reject_package_source_reparse_point(path: &Path) -> Result<(), String> {
    reject_link_or_reparse(path, "package source entry").map(|_| ())
}

fn resolve_declared_resource(
    package_root: &Path,
    relative: &str,
    field: &str,
) -> Result<PathBuf, String> {
    let normalized = normalized_relative_resource_path(relative, field)?;
    let canonical_root = package_root.canonicalize().map_err(|error| {
        format!(
            "Installed page package root {} could not be resolved: {error}",
            package_root.display()
        )
    })?;
    let root_metadata = reject_link_or_reparse(package_root, "package root")?;
    if !root_metadata.is_dir() {
        return Err(format!(
            "Installed page package root is not a directory: {}.",
            package_root.display()
        ));
    }
    let mut candidate = package_root.to_path_buf();
    for component in Path::new(&normalized).components() {
        let Component::Normal(segment) = component else {
            return Err(format!(
                "Page field '{field}' is not a normalized relative path."
            ));
        };
        candidate.push(segment);
        reject_link_or_reparse(&candidate, "resource path component")?;
    }
    let canonical = candidate.canonicalize().map_err(|error| {
        format!(
            "Installed page resource {} could not be resolved: {error}",
            candidate.display()
        )
    })?;
    if !canonical.starts_with(&canonical_root) || !canonical.is_file() {
        return Err(format!(
            "Installed page resource '{}' must be a file inside its package.",
            relative
        ));
    }
    Ok(canonical)
}

fn normalize_unique_tokens(
    values: &mut [String],
    field: &str,
    allow_colon: bool,
) -> Result<(), String> {
    let mut seen = BTreeSet::new();
    for value in values {
        *value = normalize_identifier(value, field, allow_colon)?;
        if !seen.insert(value.to_ascii_lowercase()) {
            return Err(format!(
                "Page field '{field}' contains duplicate '{}'.",
                value
            ));
        }
    }
    Ok(())
}

fn normalize_unique_refresh_events(values: &mut [String]) -> Result<(), String> {
    let mut seen = BTreeSet::new();
    for value in values {
        let normalized = value.trim();
        if normalized.is_empty() || normalized.len() > 256 {
            return Err(
                "Page field 'page.refreshEvents' must contain 1 to 256 characters.".to_string(),
            );
        }
        if !normalized.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_' | ':' | '/')
        }) || normalized
            .split('/')
            .any(|component| matches!(component, "." | ".."))
        {
            return Err(
                "Page field 'page.refreshEvents' contains unsupported characters or path traversal."
                    .to_string(),
            );
        }
        *value = normalized.to_string();
        if !seen.insert(value.to_ascii_lowercase()) {
            return Err(format!(
                "Page field 'page.refreshEvents' contains duplicate '{}'.",
                value
            ));
        }
    }
    Ok(())
}

fn schema_type(value: &Value) -> Option<&str> {
    value.get("type").and_then(Value::as_str)
}

pub(crate) fn validate_schema_definition(schema: &Value, field: &str) -> Result<(), String> {
    validate_schema_definition_inner(schema, field, 0)
}

fn validate_schema_definition_inner(
    schema: &Value,
    field: &str,
    depth: usize,
) -> Result<(), String> {
    if depth > MAX_SCHEMA_DEPTH {
        return Err(format!("{field} exceeds the maximum schema depth."));
    }
    let object = schema
        .as_object()
        .ok_or_else(|| format!("{field} must be a JSON schema object."))?;
    let supported = [
        "type",
        "properties",
        "required",
        "additionalProperties",
        "items",
        "enum",
    ];
    for keyword in object.keys() {
        if !supported.contains(&keyword.as_str()) {
            return Err(format!(
                "{field} uses unsupported JSON schema keyword '{keyword}'."
            ));
        }
    }
    if let Some(kind) = object.get("type") {
        let kind = kind
            .as_str()
            .ok_or_else(|| format!("{field}.type must be a string."))?;
        if ![
            "null", "boolean", "number", "integer", "string", "object", "array",
        ]
        .contains(&kind)
        {
            return Err(format!("{field}.type '{kind}' is unsupported."));
        }
    }
    if let Some(properties) = object.get("properties") {
        if schema_type(schema) != Some("object") {
            return Err(format!("{field}.properties requires type 'object'."));
        }
        let properties = properties
            .as_object()
            .ok_or_else(|| format!("{field}.properties must be an object."))?;
        for (name, child) in properties {
            if name.trim().is_empty()
                || matches!(name.as_str(), "__proto__" | "prototype" | "constructor")
            {
                return Err(format!(
                    "{field}.properties contains unsafe property '{name}'."
                ));
            }
            validate_schema_definition_inner(
                child,
                &format!("{field}.properties.{name}"),
                depth + 1,
            )?;
        }
    }
    if let Some(required) = object.get("required") {
        if schema_type(schema) != Some("object") {
            return Err(format!("{field}.required requires type 'object'."));
        }
        let required = required
            .as_array()
            .ok_or_else(|| format!("{field}.required must be an array."))?;
        let properties = object
            .get("properties")
            .and_then(Value::as_object)
            .ok_or_else(|| format!("{field}.required requires properties."))?;
        let mut seen = BTreeSet::new();
        for required_name in required {
            let required_name = required_name
                .as_str()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| format!("{field}.required must contain non-empty strings."))?;
            if !properties.contains_key(required_name) {
                return Err(format!(
                    "{field}.required names undeclared property '{required_name}'."
                ));
            }
            if !seen.insert(required_name) {
                return Err(format!(
                    "{field}.required duplicates property '{required_name}'."
                ));
            }
        }
    }
    if let Some(additional) = object.get("additionalProperties") {
        if schema_type(schema) != Some("object") {
            return Err(format!(
                "{field}.additionalProperties requires type 'object'."
            ));
        }
        if !additional.is_boolean() {
            validate_schema_definition_inner(
                additional,
                &format!("{field}.additionalProperties"),
                depth + 1,
            )?;
        }
    }
    if let Some(items) = object.get("items") {
        if schema_type(schema) != Some("array") {
            return Err(format!("{field}.items requires type 'array'."));
        }
        validate_schema_definition_inner(items, &format!("{field}.items"), depth + 1)?;
    }
    if let Some(values) = object.get("enum") {
        let values = values
            .as_array()
            .filter(|values| !values.is_empty())
            .ok_or_else(|| format!("{field}.enum must be a non-empty array."))?;
        for (index, value) in values.iter().enumerate() {
            if values[..index].contains(value) {
                return Err(format!("{field}.enum contains duplicate values."));
            }
        }
    }
    if object.is_empty() {
        return Err(format!(
            "{field} must declare at least one supported schema keyword."
        ));
    }
    Ok(())
}

pub(crate) fn validate_json_schema_value(
    schema: &Value,
    value: &Value,
    field: &str,
) -> Result<(), String> {
    validate_json_schema_value_inner(schema, value, field, 0)
}

fn validate_json_schema_value_inner(
    schema: &Value,
    value: &Value,
    field: &str,
    depth: usize,
) -> Result<(), String> {
    if depth > MAX_SCHEMA_DEPTH {
        return Err(format!("{field} exceeds the maximum validation depth."));
    }
    let object = schema
        .as_object()
        .ok_or_else(|| format!("{field} schema is not an object."))?;
    if let Some(values) = object.get("enum").and_then(Value::as_array) {
        if !values.contains(value) {
            return Err(format!("{field} is not one of the declared enum values."));
        }
    }
    if let Some(kind) = object.get("type").and_then(Value::as_str) {
        let matches = match kind {
            "null" => value.is_null(),
            "boolean" => value.is_boolean(),
            "number" => value.is_number(),
            "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
            "string" => value.is_string(),
            "object" => value.is_object(),
            "array" => value.is_array(),
            _ => false,
        };
        if !matches {
            return Err(format!("{field} must have JSON type '{kind}'."));
        }
    }
    if schema_type(schema) == Some("object") {
        let candidate = value
            .as_object()
            .ok_or_else(|| format!("{field} must be an object."))?;
        let properties = object
            .get("properties")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        for required in object
            .get("required")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            if !candidate.contains_key(required) {
                return Err(format!(
                    "{field} is missing required property '{required}'."
                ));
            }
        }
        for (name, child_value) in candidate {
            if let Some(child_schema) = properties.get(name) {
                validate_json_schema_value_inner(
                    child_schema,
                    child_value,
                    &format!("{field}.{name}"),
                    depth + 1,
                )?;
                continue;
            }
            match object.get("additionalProperties") {
                Some(Value::Bool(false)) => {
                    return Err(format!("{field} contains undeclared property '{name}'."))
                }
                Some(Value::Object(_)) => validate_json_schema_value_inner(
                    &object["additionalProperties"],
                    child_value,
                    &format!("{field}.{name}"),
                    depth + 1,
                )?,
                _ => {}
            }
        }
    }
    if let Some(items) = object.get("items") {
        let values = value
            .as_array()
            .ok_or_else(|| format!("{field} must be an array."))?;
        for (index, item) in values.iter().enumerate() {
            validate_json_schema_value_inner(items, item, &format!("{field}[{index}]"), depth + 1)?;
        }
    }
    Ok(())
}

pub(crate) fn validate_and_normalize_page_manifest(
    page: &mut InstalledPageManifest,
    package_root: &Path,
    destination_program: &str,
) -> Result<(), String> {
    if page.schema_version != 1 {
        return Err(format!(
            "Installed page '{}' has unsupported schemaVersion {}.",
            page.id, page.schema_version
        ));
    }
    page.id = normalize_identifier(&page.id, "page.id", false)?;
    page.program = normalize_display_text(&page.program, "page.program", false, 128)?;
    if !page
        .program
        .eq_ignore_ascii_case(destination_program.trim())
    {
        return Err(format!(
            "Page program '{}' does not match '{}'.",
            page.program,
            destination_program.trim()
        ));
    }
    page.label = normalize_display_text(&page.label, "page.label", false, 256)?;
    page.tooltip = normalize_display_text(&page.tooltip, "page.tooltip", true, 2048)?;
    page.window.title =
        normalize_display_text(&page.window.title, "page.window.title", false, 256)?;
    if page.window.width == 0
        || page.window.height == 0
        || page.window.min_width == 0
        || page.window.min_height == 0
        || page.window.width < page.window.min_width
        || page.window.height < page.window.min_height
    {
        return Err(
            "Page window dimensions must be positive and initial size must meet its minimum size."
                .to_string(),
        );
    }
    if page.scripts.len() + page.styles.len() + page.assets.len() + 1 > MAX_PAGE_RESOURCES {
        return Err(format!(
            "Installed page '{}' declares more than {MAX_PAGE_RESOURCES} resources.",
            page.id
        ));
    }
    let mut resources = BTreeSet::new();
    page.entry = normalized_relative_resource_path(&page.entry, "page.entry")?;
    resolve_declared_resource(package_root, &page.entry, "page.entry")?;
    resources.insert(page.entry.to_ascii_lowercase());
    for (field, values) in [
        ("page.scripts", &mut page.scripts),
        ("page.styles", &mut page.styles),
        ("page.assets", &mut page.assets),
    ] {
        for value in values.iter_mut() {
            *value = normalized_relative_resource_path(value, field)?;
            if !resources.insert(value.to_ascii_lowercase()) {
                return Err(format!(
                    "Installed page '{}' declares resource '{}' more than once.",
                    page.id, value
                ));
            }
            resolve_declared_resource(package_root, value, field)?;
        }
    }
    normalize_unique_tokens(&mut page.capabilities, "page.capabilities", true)?;
    page.owner_state_format =
        normalize_identifier(&page.owner_state_format, "page.ownerStateFormat", true)?;
    if let Some(namespace) = page.shared_program_data_namespace.as_mut() {
        *namespace = normalize_identifier(namespace, "page.sharedProgramDataNamespace", false)?;
    }
    normalize_unique_tokens(
        &mut page.supported_data_formats,
        "page.supportedDataFormats",
        true,
    )?;
    normalize_unique_refresh_events(&mut page.refresh_events)?;
    if page.actions.len() > MAX_PAGE_ACTIONS {
        return Err(format!(
            "Installed page '{}' declares more than {MAX_PAGE_ACTIONS} actions.",
            page.id
        ));
    }
    let declared_capabilities = page
        .capabilities
        .iter()
        .map(|value| value.to_ascii_lowercase())
        .collect::<BTreeSet<_>>();
    let mut action_ids = BTreeSet::new();
    for action in &mut page.actions {
        action.id = normalize_identifier(&action.id, "page.actions.id", false)?;
        if !action_ids.insert(action.id.to_ascii_lowercase()) {
            return Err(format!(
                "Installed page '{}' duplicates action ID '{}'.",
                page.id, action.id
            ));
        }
        validate_schema_definition(
            &action.request_schema,
            &format!("page.actions.{}.requestSchema", action.id),
        )?;
        validate_schema_definition(
            &action.response_schema,
            &format!("page.actions.{}.responseSchema", action.id),
        )?;
        match &mut action.handler {
            InstalledPageActionHandler::Program { capability, .. } => {
                *capability =
                    normalize_identifier(capability, "page.actions.handler.capability", true)?;
                if !declared_capabilities.contains(&capability.to_ascii_lowercase()) {
                    return Err(format!(
                        "Page action '{}' uses undeclared capability '{}'.",
                        action.id, capability
                    ));
                }
            }
            InstalledPageActionHandler::Core { capability, .. } => {
                *capability =
                    normalize_identifier(capability, "page.actions.handler.capability", true)?;
                if !CORE_PAGE_CAPABILITIES.contains(&capability.as_str()) {
                    return Err(format!(
                        "Page action '{}' uses unsupported Core capability '{}'.",
                        action.id, capability
                    ));
                }
                if !declared_capabilities.contains(&capability.to_ascii_lowercase()) {
                    return Err(format!(
                        "Page action '{}' uses undeclared capability '{}'.",
                        action.id, capability
                    ));
                }
            }
            InstalledPageActionHandler::OwnerState { .. } => {}
        }
    }
    Ok(())
}

fn resolve_page_identity(
    owner_button_id: &str,
    program_name: &str,
    panel_name: &str,
    file_name: &str,
    page_id: &str,
) -> Result<(ActiveSourceResolution, InstalledPageManifest, PathBuf), String> {
    let (resolution, mut page) = require_active_page_identity(
        resolve_active_source_record(program_name, panel_name, file_name)?,
        owner_button_id,
        program_name,
        panel_name,
        page_id,
    )?;
    let manifest = load_program_manifest(&resolution.record.program_name)?;
    let resolved_paths = resolve_owned_source_paths(&manifest, &resolution.record)?;
    let source_root = resolved_paths.package_path.join("source");
    validate_and_normalize_page_manifest(&mut page, &source_root, &resolution.record.program_name)?;
    Ok((resolution, page, source_root))
}

fn generated_stage_policy(
    page: &InstalledPageManifest,
    action: &InstalledPageAction,
    active_program_name: &str,
) -> Result<GeneratedStagePolicy, String> {
    let InstalledPageActionHandler::Core {
        capability,
        options,
    } = &action.handler
    else {
        return Err(
            "Generated Button staging is only valid for a declared Core action.".to_string(),
        );
    };
    if capability != "button.install-generated" {
        return Err(
            "Generated Button staging is only valid for a declared button.install-generated action."
                .to_string(),
        );
    }
    let expected_keys = ["programName", "importKind", "stageNamespace", "stageFormat"]
        .into_iter()
        .collect::<BTreeSet<_>>();
    let actual_keys = options.keys().map(String::as_str).collect::<BTreeSet<_>>();
    if actual_keys != expected_keys {
        return Err(
            "Generated Button action options must declare exactly programName, importKind, stageNamespace, and stageFormat."
                .to_string(),
        );
    }
    let option = |name: &str| -> Result<&str, String> {
        options
            .get(name)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                format!("Generated Button action option '{name}' must be a non-empty string.")
            })
    };
    let program_name =
        normalize_display_text(option("programName")?, "generated.programName", false, 128)?;
    if !program_name.eq_ignore_ascii_case(active_program_name.trim()) {
        return Err(
            "Generated Button action program must match the active installed page owner program."
                .to_string(),
        );
    }
    let import_kind = normalize_identifier(option("importKind")?, "generated.importKind", false)?;
    if !import_kind.eq_ignore_ascii_case("script") {
        return Err(
            "Generated Button stages must use the ordinary script source lifecycle.".to_string(),
        );
    }
    let stage_namespace =
        normalize_identifier(option("stageNamespace")?, "generated.stageNamespace", false)?;
    let stage_format =
        normalize_identifier(option("stageFormat")?, "generated.stageFormat", false)?;
    if !page
        .supported_data_formats
        .iter()
        .any(|format| format.eq_ignore_ascii_case(&stage_format))
    {
        return Err(
            "Generated Button stage format must be declared in page.supportedDataFormats."
                .to_string(),
        );
    }
    Ok(GeneratedStagePolicy {
        program_name,
        import_kind: import_kind.to_ascii_lowercase(),
        stage_namespace,
        stage_format,
    })
}

fn bounded_file_bytes(path: &Path, maximum: u64, subject: &str) -> Result<Vec<u8>, String> {
    let metadata = reject_link_or_reparse(path, subject)?;
    if !metadata.is_file() {
        return Err(format!("{subject} must be a file: {}.", path.display()));
    }
    if metadata.len() > maximum {
        return Err(format!(
            "{subject} exceeds the {maximum}-byte limit: {}.",
            path.display()
        ));
    }
    fs::read(path).map_err(|error| format!("Failed to read {subject} {}: {error}", path.display()))
}

fn sha256_file(path: &Path, maximum: u64, subject: &str) -> Result<String, String> {
    let metadata = reject_link_or_reparse(path, subject)?;
    if !metadata.is_file() {
        return Err(format!("{subject} must be a file: {}.", path.display()));
    }
    if metadata.len() > maximum {
        return Err(format!(
            "{subject} exceeds the {maximum}-byte limit: {}.",
            path.display()
        ));
    }
    let mut file = fs::File::open(path)
        .map_err(|error| format!("Failed to open {subject} {}: {error}", path.display()))?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("Failed to hash {subject} {}: {error}", path.display()))?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn reject_generated_stage_tree_links(stage_root: &Path) -> Result<BTreeSet<PathBuf>, String> {
    let mut pending = vec![(stage_root.to_path_buf(), 0usize)];
    let mut entries = 0usize;
    let mut files = BTreeSet::new();
    while let Some((directory, depth)) = pending.pop() {
        if depth > MAX_GENERATED_STAGE_DEPTH {
            return Err(format!(
                "Generated Button stage exceeds the maximum directory depth of {MAX_GENERATED_STAGE_DEPTH}."
            ));
        }
        let directory_metadata =
            reject_link_or_reparse(&directory, "generated Button stage directory")?;
        if !directory_metadata.is_dir() {
            return Err(format!(
                "Generated Button stage entry is not a directory: {}.",
                directory.display()
            ));
        }
        for entry in fs::read_dir(&directory)
            .map_err(|error| format!("Failed to inspect {}: {error}", directory.display()))?
        {
            let entry = entry.map_err(|error| error.to_string())?;
            entries += 1;
            if entries > MAX_GENERATED_STAGE_ENTRIES {
                return Err(format!(
                    "Generated Button stage exceeds the maximum entry count of {MAX_GENERATED_STAGE_ENTRIES}."
                ));
            }
            let metadata = reject_link_or_reparse(&entry.path(), "generated Button stage entry")?;
            if metadata.is_dir() {
                pending.push((entry.path(), depth + 1));
            } else if metadata.is_file() {
                files.insert(entry.path().canonicalize().map_err(|error| {
                    format!(
                        "Generated Button stage entry {} could not be resolved: {error}",
                        entry.path().display()
                    )
                })?);
            } else {
                return Err(format!(
                    "Generated Button stage contains an unsupported filesystem entry: {}.",
                    entry.path().display()
                ));
            }
        }
    }
    Ok(files)
}

fn authorize_generated_stage_at(
    staging_root: &Path,
    stage_token: &str,
    staged_source_path: &str,
    policy: &GeneratedStagePolicy,
) -> Result<AuthorizedGeneratedStagePaths, String> {
    let normalized_token = normalize_identifier(stage_token, "generated.stageToken", false)?;
    if normalized_token != stage_token
        || matches!(normalized_token.as_str(), "." | "..")
        || Path::new(&normalized_token).components().count() != 1
    {
        return Err("Generated Button stage token must be one safe path component.".to_string());
    }
    reject_selected_source_reparse_point(staging_root)?;
    let root_metadata = reject_link_or_reparse(staging_root, "generated Button staging root")?;
    if !root_metadata.is_dir() {
        return Err(format!(
            "Generated Button staging root is not a directory: {}.",
            staging_root.display()
        ));
    }
    let canonical_root = staging_root.canonicalize().map_err(|error| {
        format!(
            "Generated Button staging root {} could not be resolved: {error}",
            staging_root.display()
        )
    })?;
    let stage_root = staging_root.join(&normalized_token);
    let stage_metadata = reject_link_or_reparse(&stage_root, "generated Button stage root")?;
    if !stage_metadata.is_dir() {
        return Err(format!(
            "Generated Button stage root is not a directory: {}.",
            stage_root.display()
        ));
    }
    let canonical_stage_root = stage_root.canonicalize().map_err(|error| {
        format!(
            "Generated Button stage root {} could not be resolved: {error}",
            stage_root.display()
        )
    })?;
    if canonical_stage_root.parent() != Some(canonical_root.as_path()) {
        return Err(
            "Generated Button stage root must be the declared token's immediate staging child."
                .to_string(),
        );
    }
    let stage_files = reject_generated_stage_tree_links(&canonical_stage_root)?;

    let requested_text = staged_source_path.trim();
    if requested_text.is_empty() || requested_text != staged_source_path {
        return Err(
            "Generated Button staged manifest path must be a non-empty normalized path."
                .to_string(),
        );
    }
    let requested = PathBuf::from(requested_text);
    if !requested.is_absolute() {
        return Err("Generated Button staged manifest path must be absolute.".to_string());
    }
    if requested
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err("Generated Button staged manifest path may not contain traversal.".to_string());
    }
    let expected_manifest = canonical_stage_root
        .join("source")
        .join("flowcell.script.json");
    let requested_metadata =
        reject_link_or_reparse(&requested, "generated Button staged manifest")?;
    if !requested_metadata.is_file() {
        return Err("Generated Button staged source must be a script manifest file.".to_string());
    }
    let canonical_requested = requested.canonicalize().map_err(|error| {
        format!(
            "Generated Button staged manifest {} could not be resolved: {error}",
            requested.display()
        )
    })?;
    let canonical_expected = expected_manifest.canonicalize().map_err(|error| {
        format!(
            "Generated Button expected manifest {} could not be resolved: {error}",
            expected_manifest.display()
        )
    })?;
    if canonical_requested != canonical_expected {
        return Err(
            "Generated Button staged manifest must be exactly staging/<token>/source/flowcell.script.json."
                .to_string(),
        );
    }

    let stage_manifest_path = canonical_stage_root.join("stage.json");
    let stage_manifest_bytes = bounded_file_bytes(
        &stage_manifest_path,
        MAX_GENERATED_STAGE_MANIFEST_BYTES,
        "generated Button stage manifest",
    )?;
    let stage = serde_json::from_slice::<GeneratedStageManifest>(&stage_manifest_bytes)
        .map_err(|error| format!("Generated Button stage.json is invalid: {error}"))?;
    if stage.schema_version != 1 {
        return Err("Generated Button stage.json has an unsupported schemaVersion.".to_string());
    }
    if stage.format != policy.stage_format {
        return Err(
            "Generated Button stage format does not match the declared action.".to_string(),
        );
    }
    if stage.namespace != policy.stage_namespace {
        return Err(
            "Generated Button stage namespace does not match the declared action.".to_string(),
        );
    }
    if stage.stage_token != normalized_token {
        return Err("Generated Button stage token does not match stage.json.".to_string());
    }
    if stage.created_at.trim().is_empty()
        || stage.created_at.trim() != stage.created_at
        || stage.created_at.len() > 128
    {
        return Err("Generated Button stage createdAt is invalid.".to_string());
    }
    if !stage
        .program_name
        .eq_ignore_ascii_case(policy.program_name.as_str())
    {
        return Err("Generated Button stage program does not match the active owner.".to_string());
    }
    if !stage.import_kind.eq_ignore_ascii_case(&policy.import_kind) {
        return Err(
            "Generated Button stage import kind does not match the declared action.".to_string(),
        );
    }
    let package_id = normalize_identifier(&stage.package_id, "generated.packageId", false)?;
    if package_id != stage.package_id {
        return Err("Generated Button stage packageId must be normalized.".to_string());
    }
    let source_manifest_relative = normalized_relative_resource_path(
        &stage.source_manifest_relative_path,
        "generated.sourceManifestRelativePath",
    )?;
    if source_manifest_relative != "source/flowcell.script.json" {
        return Err(
            "Generated Button stage sourceManifestRelativePath must be source/flowcell.script.json."
                .to_string(),
        );
    }
    if !is_sha256(&stage.source_manifest_sha256) || !is_sha256(&stage.script_sha256) {
        return Err("Generated Button stage hashes must be lowercase SHA-256 values.".to_string());
    }
    if stage.metadata.len() > 128 {
        return Err("Generated Button stage metadata contains too many entries.".to_string());
    }

    let source_manifest_bytes = bounded_file_bytes(
        &canonical_requested,
        MAX_GENERATED_SOURCE_MANIFEST_BYTES,
        "generated Button source manifest",
    )?;
    let actual_manifest_hash = sha256_file(
        &canonical_requested,
        MAX_GENERATED_SOURCE_MANIFEST_BYTES,
        "generated Button source manifest",
    )?;
    if actual_manifest_hash != stage.source_manifest_sha256 {
        return Err(
            "Generated Button source manifest SHA-256 does not match stage.json.".to_string(),
        );
    }
    let source_manifest =
        serde_json::from_slice::<GeneratedScriptSourceManifest>(&source_manifest_bytes)
            .map_err(|error| format!("Generated Button source manifest is invalid: {error}"))?;
    if source_manifest.schema_version != 1 {
        return Err("Generated Button source manifest schemaVersion must be 1.".to_string());
    }
    let source_id = normalize_identifier(&source_manifest.id, "generated.source.id", false)?;
    if source_id != source_manifest.id || source_id != package_id {
        return Err("Generated Button source manifest id does not match stage.json.".to_string());
    }
    normalize_display_text(&source_manifest.label, "generated.source.label", false, 256)?;
    normalize_display_text(
        &source_manifest.tooltip,
        "generated.source.tooltip",
        true,
        2048,
    )?;
    let source_program = source_manifest.program.trim();
    if source_program != source_manifest.program
        || !source_program.eq_ignore_ascii_case(&stage.program_name)
        || !source_program.eq_ignore_ascii_case(&policy.program_name)
    {
        return Err(
            "Generated Button source manifest program does not match stage.json.".to_string(),
        );
    }
    let source_relative =
        normalized_relative_resource_path(&source_manifest.source, "generated.source.source")?;
    let source_root = canonical_stage_root.join("source");
    let source_path =
        resolve_declared_resource(&source_root, &source_relative, "generated.source.source")?;
    let actual_script_hash = sha256_file(
        &source_path,
        MAX_GENERATED_SCRIPT_BYTES,
        "generated Button script source",
    )?;
    if actual_script_hash != stage.script_sha256 {
        return Err("Generated Button script SHA-256 does not match stage.json.".to_string());
    }
    let expected_stage_files = [
        stage_manifest_path.canonicalize().map_err(|error| {
            format!(
                "Generated Button stage manifest {} could not be resolved: {error}",
                stage_manifest_path.display()
            )
        })?,
        canonical_requested.clone(),
        source_path,
    ]
    .into_iter()
    .collect::<BTreeSet<_>>();
    if stage_files != expected_stage_files {
        return Err(
            "Generated Button stage contains files outside its authenticated manifest and script."
                .to_string(),
        );
    }

    Ok(AuthorizedGeneratedStagePaths {
        staging_root: canonical_root,
        manifest_path: canonical_requested,
        stage_root: canonical_stage_root,
    })
}

fn generated_stage_cleanup_lock() -> &'static Mutex<()> {
    GENERATED_STAGE_CLEANUP_LOCK.get_or_init(|| Mutex::new(()))
}

fn generated_stage_cleanup_root() -> Result<PathBuf, String> {
    Ok(crate::commands::filesystem::resolve_flowcell_local_root()?
        .join("button-system")
        .join(GENERATED_STAGE_CLEANUP_DIRECTORY))
}

fn generated_stage_program_data_root() -> Result<PathBuf, String> {
    Ok(crate::commands::filesystem::resolve_flowcell_local_root()?.join("program-data"))
}

fn generated_stage_cleanup_key(journal: &GeneratedStageCleanupJournal) -> String {
    let mut digest = Sha256::new();
    for value in [
        journal.owner_button_id.as_str(),
        journal.program_id.as_str(),
        journal.program_name.as_str(),
        journal.panel_name.as_str(),
        journal.file_name.as_str(),
        journal.page_id.as_str(),
        journal.action_id.as_str(),
        journal.shared_program_data_namespace.as_str(),
        journal.stage_token.as_str(),
        journal.staging_root.as_str(),
        journal.stage_root.as_str(),
        journal.manifest_path.as_str(),
    ] {
        digest.update(value.as_bytes());
        digest.update([0]);
    }
    digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn normalized_journal_path(value: &str, field: &str) -> Result<PathBuf, String> {
    if value.trim() != value || value.is_empty() {
        return Err(format!(
            "Generated stage cleanup journal {field} is not normalized."
        ));
    }
    let path = PathBuf::from(value);
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err(format!(
            "Generated stage cleanup journal {field} must be an absolute traversal-free path."
        ));
    }
    Ok(path)
}

fn canonical_or_absolute(path: &Path, subject: &str) -> Result<PathBuf, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => path.canonicalize().map_err(|error| {
            format!(
                "Generated stage cleanup {subject} {} could not be resolved: {error}",
                path.display()
            )
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if path.is_absolute() {
                Ok(path.to_path_buf())
            } else {
                Err(format!(
                    "Generated stage cleanup {subject} must be absolute: {}.",
                    path.display()
                ))
            }
        }
        Err(error) => Err(format!(
            "Failed to inspect generated stage cleanup {subject} {}: {error}",
            path.display()
        )),
    }
}

fn validate_generated_stage_cleanup_journal(
    journal: &GeneratedStageCleanupJournal,
    program_data_root: &Path,
) -> Result<(), String> {
    if journal.schema_version != GENERATED_STAGE_CLEANUP_SCHEMA_VERSION {
        return Err(format!(
            "Generated stage cleanup journal has unsupported schemaVersion {}.",
            journal.schema_version
        ));
    }
    if super::validate_owner_button_id(&journal.owner_button_id)? != journal.owner_button_id {
        return Err("Generated stage cleanup owner identity is not normalized.".to_string());
    }
    for (value, field, maximum) in [
        (journal.program_name.as_str(), "programName", 128usize),
        (journal.panel_name.as_str(), "panelName", 256usize),
        (journal.file_name.as_str(), "fileName", 512usize),
    ] {
        if normalize_display_text(value, field, false, maximum)? != value
            || value.chars().any(char::is_control)
        {
            return Err(format!(
                "Generated stage cleanup journal {field} is not normalized."
            ));
        }
    }
    for (value, field) in [
        (journal.program_id.as_str(), "programId"),
        (journal.page_id.as_str(), "pageId"),
        (journal.action_id.as_str(), "actionId"),
        (
            journal.shared_program_data_namespace.as_str(),
            "sharedProgramDataNamespace",
        ),
        (journal.stage_token.as_str(), "stageToken"),
    ] {
        if normalize_identifier(value, field, false)? != value || matches!(value, "." | "..") {
            return Err(format!(
                "Generated stage cleanup journal {field} is not normalized."
            ));
        }
    }
    let recorded_staging_root = normalized_journal_path(&journal.staging_root, "stagingRoot")?;
    let recorded_stage_root = normalized_journal_path(&journal.stage_root, "stageRoot")?;
    let recorded_manifest_path = normalized_journal_path(&journal.manifest_path, "manifestPath")?;
    let canonical_program_data_root =
        canonical_or_absolute(program_data_root, "program-data root")?;
    let expected_staging_root = canonical_program_data_root
        .join(&journal.program_id)
        .join(&journal.shared_program_data_namespace)
        .join("staging");
    if recorded_staging_root != expected_staging_root {
        return Err(
            "Generated stage cleanup journal staging root is outside its generic program-data namespace."
                .to_string(),
        );
    }
    if recorded_stage_root != expected_staging_root.join(&journal.stage_token) {
        return Err(
            "Generated stage cleanup journal stage root is not the token's immediate child."
                .to_string(),
        );
    }
    if recorded_manifest_path
        != recorded_stage_root
            .join("source")
            .join("flowcell.script.json")
    {
        return Err(
            "Generated stage cleanup journal manifest path is not the authorized staged manifest."
                .to_string(),
        );
    }
    Ok(())
}

fn parse_generated_stage_cleanup_journal(
    path: &Path,
    program_data_root: &Path,
) -> Result<GeneratedStageCleanupJournal, String> {
    let raw = bounded_file_bytes(
        path,
        MAX_GENERATED_STAGE_MANIFEST_BYTES,
        "generated stage cleanup journal",
    )?;
    let journal = serde_json::from_slice::<GeneratedStageCleanupJournal>(&raw)
        .map_err(|error| format!("Generated stage cleanup journal is invalid: {error}"))?;
    validate_generated_stage_cleanup_journal(&journal, program_data_root)?;
    Ok(journal)
}

fn prepare_generated_stage_cleanup_root(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| {
        format!(
            "Failed to create generated stage cleanup root {}: {error}",
            root.display()
        )
    })?;
    reject_selected_source_reparse_point(root)?;
    let metadata = reject_link_or_reparse(root, "generated stage cleanup root")?;
    if !metadata.is_dir() {
        return Err(format!(
            "Generated stage cleanup root is not a directory: {}.",
            root.display()
        ));
    }
    Ok(())
}

fn generated_stage_transaction_is_empty(path: &Path) -> Result<bool, String> {
    Ok(fs::read_dir(path)
        .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?
        .next()
        .is_none())
}

fn write_generated_stage_cleanup_journal_in(
    cleanup_root: &Path,
    program_data_root: &Path,
    journal: &GeneratedStageCleanupJournal,
) -> Result<PathBuf, String> {
    validate_generated_stage_cleanup_journal(journal, program_data_root)?;
    prepare_generated_stage_cleanup_root(cleanup_root)?;
    let transaction_root = cleanup_root.join(generated_stage_cleanup_key(journal));
    if !transaction_root.exists() {
        fs::create_dir(&transaction_root).map_err(|error| {
            format!(
                "Failed to create generated stage cleanup transaction {}: {error}",
                transaction_root.display()
            )
        })?;
    }
    let metadata = reject_link_or_reparse(
        &transaction_root,
        "generated stage cleanup transaction root",
    )?;
    if !metadata.is_dir() || transaction_root.parent() != Some(cleanup_root) {
        return Err(
            "Generated stage cleanup transaction is not a regular immediate child.".to_string(),
        );
    }
    let journal_path = transaction_root.join(GENERATED_STAGE_CLEANUP_JOURNAL);
    super::transaction::recover_json_file(&journal_path, |candidate| {
        parse_generated_stage_cleanup_journal(candidate, program_data_root).map(|_| ())
    })?;
    if journal_path.is_file() {
        let existing = parse_generated_stage_cleanup_journal(&journal_path, program_data_root)?;
        if existing != *journal {
            return Err(
                "Generated stage cleanup transaction conflicts with an existing journal."
                    .to_string(),
            );
        }
        return Ok(transaction_root);
    }
    if !generated_stage_transaction_is_empty(&transaction_root)? {
        return Err(format!(
            "Generated stage cleanup transaction {} contains unrecognized artifacts.",
            transaction_root.display()
        ));
    }
    let raw = serde_json::to_string_pretty(journal)
        .map_err(|error| format!("Failed to serialize generated stage cleanup journal: {error}"))?;
    write_json_file(&journal_path, raw.as_bytes(), AtomicWriteMode::Create)?;
    Ok(transaction_root)
}

fn clear_generated_stage_cleanup_transaction_in(
    cleanup_root: &Path,
    journal: &GeneratedStageCleanupJournal,
) -> Result<(), String> {
    let cleanup_metadata = match fs::symlink_metadata(cleanup_root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Failed to inspect generated stage cleanup root {}: {error}",
                cleanup_root.display()
            ))
        }
    };
    if cleanup_metadata.file_type().is_symlink()
        || metadata_is_reparse_point(&cleanup_metadata)
        || !cleanup_metadata.is_dir()
    {
        return Err(
            "Generated stage cleanup root drifted to a link, reparse point, or non-directory."
                .to_string(),
        );
    }
    reject_selected_source_reparse_point(cleanup_root)?;
    let transaction_root = cleanup_root.join(generated_stage_cleanup_key(journal));
    let metadata = match fs::symlink_metadata(&transaction_root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Failed to inspect generated stage cleanup transaction {}: {error}",
                transaction_root.display()
            ))
        }
    };
    if metadata.file_type().is_symlink()
        || metadata_is_reparse_point(&metadata)
        || !metadata.is_dir()
        || transaction_root.parent() != Some(cleanup_root)
    {
        return Err(
            "Generated stage cleanup transaction drifted from its regular immediate-child path."
                .to_string(),
        );
    }
    reject_generated_stage_tree_links(&transaction_root)?;
    fs::remove_dir_all(&transaction_root).map_err(|error| {
        format!(
            "Failed to clear generated stage cleanup transaction {}: {error}",
            transaction_root.display()
        )
    })
}

fn recover_generated_stage_cleanup_journal(
    cleanup_root: &Path,
    program_data_root: &Path,
    transaction_root: &Path,
    journal: &GeneratedStageCleanupJournal,
) -> Result<(), String> {
    validate_generated_stage_cleanup_journal(journal, program_data_root)?;
    if transaction_root != cleanup_root.join(generated_stage_cleanup_key(journal)) {
        return Err(
            "Generated stage cleanup journal identity does not match its transaction directory."
                .to_string(),
        );
    }
    let stage_root = PathBuf::from(&journal.stage_root);
    let stage_metadata = match fs::symlink_metadata(&stage_root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return clear_generated_stage_cleanup_transaction_in(cleanup_root, journal)
        }
        Err(error) => {
            return Err(format!(
                "Failed to inspect authorized generated stage {}: {error}",
                stage_root.display()
            ))
        }
    };
    if stage_metadata.file_type().is_symlink()
        || metadata_is_reparse_point(&stage_metadata)
        || !stage_metadata.is_dir()
    {
        return Err(
            "Authorized generated stage drifted to a link, reparse point, or non-directory; it was preserved."
                .to_string(),
        );
    }
    let staging_root = PathBuf::from(&journal.staging_root);
    reject_selected_source_reparse_point(&staging_root)?;
    let staging_metadata =
        reject_link_or_reparse(&staging_root, "authorized generated Button staging root")?;
    if !staging_metadata.is_dir() {
        return Err(
            "Authorized generated Button staging root is not a directory; the stage was preserved."
                .to_string(),
        );
    }
    let canonical_staging_root = staging_root.canonicalize().map_err(|error| {
        format!(
            "Authorized generated Button staging root {} could not be resolved: {error}",
            staging_root.display()
        )
    })?;
    let canonical_stage_root = stage_root.canonicalize().map_err(|error| {
        format!(
            "Authorized generated Button stage root {} could not be resolved: {error}",
            stage_root.display()
        )
    })?;
    if canonical_staging_root != staging_root
        || canonical_stage_root != stage_root
        || canonical_stage_root.parent() != Some(canonical_staging_root.as_path())
    {
        return Err(
            "Authorized generated Button stage containment drifted; the stage was preserved."
                .to_string(),
        );
    }
    reject_generated_stage_tree_links(&canonical_stage_root)?;
    fs::remove_dir_all(&canonical_stage_root).map_err(|error| {
        format!(
            "Failed to recover authorized short-lived generated Button stage {}: {error}",
            canonical_stage_root.display()
        )
    })?;
    clear_generated_stage_cleanup_transaction_in(cleanup_root, journal)
}

fn recover_generated_stage_cleanup_journals_in(
    cleanup_root: &Path,
    program_data_root: &Path,
) -> Result<usize, String> {
    let cleanup_metadata = match fs::symlink_metadata(cleanup_root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => {
            return Err(format!(
                "Failed to inspect generated stage cleanup root {}: {error}",
                cleanup_root.display()
            ))
        }
    };
    if cleanup_metadata.file_type().is_symlink()
        || metadata_is_reparse_point(&cleanup_metadata)
        || !cleanup_metadata.is_dir()
    {
        return Err(
            "Generated stage cleanup root is a link, reparse point, or non-directory.".to_string(),
        );
    }
    reject_selected_source_reparse_point(cleanup_root)?;
    let mut transactions = fs::read_dir(cleanup_root)
        .map_err(|error| format!("Failed to inspect {}: {error}", cleanup_root.display()))?
        .map(|entry| {
            entry
                .map(|value| value.path())
                .map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    transactions.sort();
    let mut recovered = 0usize;
    for transaction_root in transactions {
        let metadata = reject_link_or_reparse(
            &transaction_root,
            "generated stage cleanup transaction root",
        )?;
        if !metadata.is_dir() || transaction_root.parent() != Some(cleanup_root) {
            return Err(
                "Generated stage cleanup root contains a non-directory transaction artifact."
                    .to_string(),
            );
        }
        let journal_path = transaction_root.join(GENERATED_STAGE_CLEANUP_JOURNAL);
        super::transaction::recover_json_file(&journal_path, |candidate| {
            parse_generated_stage_cleanup_journal(candidate, program_data_root).map(|_| ())
        })?;
        if !journal_path.is_file() {
            if generated_stage_transaction_is_empty(&transaction_root)? {
                fs::remove_dir(&transaction_root).map_err(|error| {
                    format!(
                        "Failed to clear empty generated stage transaction {}: {error}",
                        transaction_root.display()
                    )
                })?;
                continue;
            }
            return Err(format!(
                "Generated stage cleanup transaction {} has artifacts but no recoverable journal.",
                transaction_root.display()
            ));
        }
        let journal = parse_generated_stage_cleanup_journal(&journal_path, program_data_root)?;
        recover_generated_stage_cleanup_journal(
            cleanup_root,
            program_data_root,
            &transaction_root,
            &journal,
        )?;
        recovered += 1;
    }
    Ok(recovered)
}

pub(crate) fn recover_generated_stage_cleanup_journals_on_startup() -> Result<usize, String> {
    let _guard = generated_stage_cleanup_lock()
        .lock()
        .map_err(|_| "Generated stage cleanup transaction lock is poisoned.".to_string())?;
    recover_generated_stage_cleanup_journals_in(
        &generated_stage_cleanup_root()?,
        &generated_stage_program_data_root()?,
    )
}

fn resolve_generated_stage(
    owner_button_id: &str,
    program_name: &str,
    panel_name: &str,
    file_name: &str,
    page_id: &str,
    action_id: &str,
    stage_token: &str,
    staged_source_path: &str,
) -> Result<ResolvedGeneratedStage, String> {
    let (resolution, page, _) = resolve_page_identity(
        owner_button_id,
        program_name,
        panel_name,
        file_name,
        page_id,
    )?;
    let action = declared_page_action(&page, action_id)?;
    let policy = generated_stage_policy(&page, action, &resolution.record.program_name)?;
    let namespace = page
        .shared_program_data_namespace
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "Generated Button staging requires a declared shared program-data namespace."
                .to_string()
        })?;
    let manifest = load_program_manifest(&resolution.record.program_name)?;
    let staging_root = crate::commands::filesystem::resolve_flowcell_local_root()?
        .join("program-data")
        .join(&manifest.program_id)
        .join(namespace)
        .join("staging");
    let paths =
        authorize_generated_stage_at(&staging_root, stage_token, staged_source_path, &policy)?;
    let cleanup_journal = GeneratedStageCleanupJournal {
        schema_version: GENERATED_STAGE_CLEANUP_SCHEMA_VERSION,
        owner_button_id: resolution.record.owner_button_id.clone(),
        program_id: manifest.program_id,
        program_name: resolution.record.program_name.clone(),
        panel_name: resolution.record.panel_name.clone(),
        file_name: resolution.file_name.clone(),
        page_id: page.id.clone(),
        action_id: action.id.clone(),
        shared_program_data_namespace: namespace.to_string(),
        stage_token: stage_token.to_string(),
        staging_root: paths.staging_root.display().to_string(),
        stage_root: paths.stage_root.display().to_string(),
        manifest_path: paths.manifest_path.display().to_string(),
    };
    validate_generated_stage_cleanup_journal(
        &cleanup_journal,
        &generated_stage_program_data_root()?,
    )?;
    Ok(ResolvedGeneratedStage {
        paths,
        cleanup_journal,
    })
}

fn require_active_page_identity(
    resolution: Option<ActiveSourceResolution>,
    owner_button_id: &str,
    program_name: &str,
    panel_name: &str,
    page_id: &str,
) -> Result<(ActiveSourceResolution, InstalledPageManifest), String> {
    let resolution = resolution.ok_or_else(|| {
        format!(
            "Installed page owner '{}' is no longer active for {}/{}.",
            owner_button_id.trim(),
            program_name.trim(),
            panel_name.trim()
        )
    })?;
    if !resolution
        .record
        .owner_button_id
        .eq_ignore_ascii_case(owner_button_id.trim())
    {
        return Err("Installed page request does not match its active owner.".to_string());
    }
    let page = resolution
        .record
        .page
        .clone()
        .ok_or_else(|| "Installed Button does not declare a page.".to_string())?;
    if page.id != page_id.trim() {
        return Err("Installed page request does not match its declared page ID.".to_string());
    }
    Ok((resolution, page))
}

fn declared_page_action<'a>(
    page: &'a InstalledPageManifest,
    action_id: &str,
) -> Result<&'a InstalledPageAction, String> {
    page.actions
        .iter()
        .find(|candidate| candidate.id == action_id.trim())
        .ok_or_else(|| {
            format!(
                "Installed page '{}' does not declare action '{}'.",
                page.id,
                action_id.trim()
            )
        })
}

fn parse_page_action_payload(
    action: &InstalledPageAction,
    payload_json: &str,
) -> Result<Value, String> {
    let payload = serde_json::from_str::<Value>(payload_json)
        .map_err(|error| format!("Installed page action payload is invalid JSON: {error}"))?;
    validate_json_schema_value(
        &action.request_schema,
        &payload,
        "Installed page action payload",
    )?;
    Ok(payload)
}

fn read_text_resource(package_root: &Path, path: &str, field: &str) -> Result<String, String> {
    let resolved = resolve_declared_resource(package_root, path, field)?;
    let length = fs::metadata(&resolved)
        .map_err(|error| format!("Failed to inspect {}: {error}", resolved.display()))?
        .len();
    if length > MAX_TEXT_RESOURCE_BYTES {
        return Err(format!(
            "Installed page text resource '{}' is too large.",
            path
        ));
    }
    fs::read_to_string(&resolved).map_err(|error| {
        format!(
            "Installed page text resource '{}' is not valid UTF-8: {error}",
            path
        )
    })
}

fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        output.push(TABLE[((triple >> 18) & 63) as usize] as char);
        output.push(TABLE[((triple >> 12) & 63) as usize] as char);
        output.push(if chunk.len() > 1 {
            TABLE[((triple >> 6) & 63) as usize] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            TABLE[(triple & 63) as usize] as char
        } else {
            '='
        });
    }
    output
}

fn asset_mime_type(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "json" => "application/json",
        "txt" => "text/plain",
        _ => "application/octet-stream",
    }
}

#[tauri::command]
pub(crate) fn resolve_installed_page(
    owner_button_id: String,
    program_name: String,
    panel_name: String,
    file_name: String,
    page_id: String,
) -> Result<InstalledPageDescriptor, String> {
    let (resolution, page, source_root) = resolve_page_identity(
        &owner_button_id,
        &program_name,
        &panel_name,
        &file_name,
        &page_id,
    )?;
    let entry_html = read_text_resource(&source_root, &page.entry, "page.entry")?;
    let scripts = page
        .scripts
        .iter()
        .map(|path| {
            Ok(InstalledPageTextResource {
                path: path.clone(),
                content: read_text_resource(&source_root, path, "page.scripts")?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let styles = page
        .styles
        .iter()
        .map(|path| {
            Ok(InstalledPageTextResource {
                path: path.clone(),
                content: read_text_resource(&source_root, path, "page.styles")?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let assets = page
        .assets
        .iter()
        .map(|path| {
            let resolved = resolve_declared_resource(&source_root, path, "page.assets")?;
            let metadata = fs::metadata(&resolved)
                .map_err(|error| format!("Failed to inspect {}: {error}", resolved.display()))?;
            if metadata.len() > MAX_ASSET_RESOURCE_BYTES {
                return Err(format!("Installed page asset '{}' is too large.", path));
            }
            let bytes = fs::read(&resolved)
                .map_err(|error| format!("Failed to read page asset '{}': {error}", path))?;
            Ok(InstalledPageAssetResource {
                path: path.clone(),
                mime_type: asset_mime_type(path).to_string(),
                base64: base64_encode(&bytes),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut declared_resource_paths =
        Vec::with_capacity(page.scripts.len() + page.styles.len() + page.assets.len() + 1);
    declared_resource_paths.push(page.entry.clone());
    declared_resource_paths.extend(page.scripts.iter().cloned());
    declared_resource_paths.extend(page.styles.iter().cloned());
    declared_resource_paths.extend(page.assets.iter().cloned());
    let installed_owner_root = source_root
        .parent()
        .ok_or_else(|| "Installed page source root has no owner directory.".to_string())?
        .display()
        .to_string();
    Ok(InstalledPageDescriptor {
        owner_button_id: resolution.record.owner_button_id,
        program_id: resolution.record.program_id,
        program_name: resolution.record.program_name,
        panel_name: resolution.record.panel_name,
        file_name: resolution.file_name,
        source_record_id: resolution.record.install_id,
        installed_owner_root,
        page_id: page.id,
        label: page.label,
        tooltip: page.tooltip,
        entry_html,
        scripts,
        styles,
        assets,
        window: page.window,
        declared_resource_paths,
        declared_actions: page.actions,
        declared_capabilities: page.capabilities,
        owner_runtime_state_namespace: format!("runtime/{OWNER_STATE_FILE_NAME}"),
        shared_program_data_namespace: page.shared_program_data_namespace,
        supported_data_formats: page.supported_data_formats,
        config: page.config.unwrap_or(Value::Null),
        refresh_events: page.refresh_events,
    })
}

fn owner_state_path(
    record: &ActiveSourceRecord,
    create_runtime: bool,
) -> Result<Option<PathBuf>, String> {
    let manifest = load_program_manifest(&record.program_name)?;
    let resolved = resolve_owned_source_paths(&manifest, record)?;
    let runtime = resolved.package_path.join("runtime");
    if runtime.exists() {
        let metadata = reject_link_or_reparse(&runtime, "owner runtime directory")?;
        if !metadata.is_dir() {
            return Err(format!(
                "Installed page owner runtime path is not a directory: {}.",
                runtime.display()
            ));
        }
    } else if create_runtime {
        fs::create_dir(&runtime)
            .map_err(|error| format!("Failed to create {}: {error}", runtime.display()))?;
    } else {
        return Ok(None);
    }
    let state_path = runtime.join(OWNER_STATE_FILE_NAME);
    if state_path.exists() {
        let metadata = reject_link_or_reparse(&state_path, "owner state file")?;
        if !metadata.is_file() {
            return Err(format!(
                "Installed page owner state path is not a file: {}.",
                state_path.display()
            ));
        }
    }
    Ok(Some(state_path))
}

fn read_owner_state(
    record: &ActiveSourceRecord,
    page: &InstalledPageManifest,
) -> Result<Value, String> {
    let Some(path) = owner_state_path(record, false)? else {
        return Ok(json!({}));
    };
    if !path.is_file() {
        return Ok(json!({}));
    }
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let envelope = serde_json::from_str::<OwnerStateEnvelope>(&raw)
        .map_err(|error| format!("Installed page owner state is invalid: {error}"))?;
    if envelope.schema_version != 1
        || envelope.page_id != page.id
        || envelope.format != page.owner_state_format
    {
        return Err(
            "Installed page owner state does not match its declared page format.".to_string(),
        );
    }
    Ok(envelope.value)
}

fn write_owner_state(
    record: &ActiveSourceRecord,
    page: &InstalledPageManifest,
    value: Value,
) -> Result<Value, String> {
    let path = owner_state_path(record, true)?
        .ok_or_else(|| "Installed page owner runtime directory was not created.".to_string())?;
    let envelope = OwnerStateEnvelope {
        schema_version: 1,
        page_id: page.id.clone(),
        format: page.owner_state_format.clone(),
        value: value.clone(),
    };
    let body = serde_json::to_vec_pretty(&envelope)
        .map_err(|error| format!("Failed to serialize installed page owner state: {error}"))?;
    write_json_file(&path, &body, AtomicWriteMode::Replace)?;
    Ok(value)
}

fn parse_program_response(raw: &str) -> Result<Value, String> {
    let mut value = serde_json::from_str::<Value>(raw)
        .map_err(|error| format!("Installed page program action returned invalid JSON: {error}"))?;
    for _ in 0..3 {
        if let Some(text) = value.as_str() {
            value = serde_json::from_str::<Value>(text).map_err(|error| {
                format!("Installed page program action returned invalid nested JSON: {error}")
            })?;
            continue;
        }
        let Some(object) = value.as_object() else {
            break;
        };
        if object.get("ok") == Some(&Value::Bool(false)) {
            let error = object
                .get("error")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("Installed page program action failed.");
            return Err(error.to_string());
        }
        let Some(result) = object.get("result") else {
            break;
        };
        value = result.clone();
    }
    Ok(value)
}

fn run_installed_page_action_blocking(
    owner_button_id: String,
    program_name: String,
    panel_name: String,
    file_name: String,
    page_id: String,
    action_id: String,
    payload_json: String,
) -> Result<InstalledPageActionRunResult, String> {
    let (resolution, page, _) = resolve_page_identity(
        &owner_button_id,
        &program_name,
        &panel_name,
        &file_name,
        &page_id,
    )?;
    let action = declared_page_action(&page, &action_id)?;
    let payload = parse_page_action_payload(action, &payload_json)?;
    let response = match &action.handler {
        InstalledPageActionHandler::Program {
            capability,
            payload: fixed_payload,
        } => {
            let mut merged = payload.as_object().cloned().ok_or_else(|| {
                "Program-backed installed page actions require an object payload.".to_string()
            })?;
            for (key, value) in fixed_payload {
                merged.insert(key.clone(), value.clone());
            }
            let args_json = serde_json::to_string(&Value::Object(merged)).map_err(|error| {
                format!("Failed to encode installed page action payload: {error}")
            })?;
            let raw = super::execute::run_program_capability_action_blocking(
                resolution.record.program_name.clone(),
                resolution.record.panel_name.clone(),
                resolution.file_name.clone(),
                capability.clone(),
                args_json,
            )?;
            parse_program_response(&raw)?
        }
        InstalledPageActionHandler::OwnerState { operation } => match operation {
            OwnerStateOperation::Read => {
                json!({ "state": read_owner_state(&resolution.record, &page)? })
            }
            OwnerStateOperation::Write => {
                let state = payload
                    .as_object()
                    .and_then(|value| value.get("state"))
                    .cloned()
                    .ok_or_else(|| {
                        "Installed page owner-state write requires an object payload with 'state'."
                            .to_string()
                    })?;
                write_owner_state(&resolution.record, &page, state)?;
                json!({ "written": true })
            }
        },
        InstalledPageActionHandler::Core {
            capability,
            options,
        } => {
            return Ok(InstalledPageActionRunResult::CoreAction {
                capability: capability.clone(),
                options: options.clone(),
                payload,
            })
        }
    };
    validate_json_schema_value(
        &action.response_schema,
        &response,
        "Installed page action response",
    )?;
    Ok(InstalledPageActionRunResult::Complete { value: response })
}

#[tauri::command]
pub(crate) async fn run_installed_page_action(
    owner_button_id: String,
    program_name: String,
    panel_name: String,
    file_name: String,
    page_id: String,
    action_id: String,
    payload_json: String,
) -> Result<InstalledPageActionRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_installed_page_action_blocking(
            owner_button_id,
            program_name,
            panel_name,
            file_name,
            page_id,
            action_id,
            payload_json,
        )
    })
    .await
    .map_err(|error| format!("Installed page action task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn complete_installed_page_core_action(
    owner_button_id: String,
    program_name: String,
    panel_name: String,
    file_name: String,
    page_id: String,
    action_id: String,
    response_json: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (_, page, _) = resolve_page_identity(
            &owner_button_id,
            &program_name,
            &panel_name,
            &file_name,
            &page_id,
        )?;
        let action = declared_page_action(&page, &action_id)?;
        if !matches!(action.handler, InstalledPageActionHandler::Core { .. }) {
            return Err(
                "Installed page completion is only valid for a declared Core action.".to_string(),
            );
        }
        let response = serde_json::from_str::<Value>(&response_json).map_err(|error| {
            format!("Installed page Core action response is invalid JSON: {error}")
        })?;
        validate_json_schema_value(
            &action.response_schema,
            &response,
            "Installed page action response",
        )?;
        Ok(response)
    })
    .await
    .map_err(|error| format!("Installed page action completion task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn authorize_installed_page_generated_stage(
    owner_button_id: String,
    program_name: String,
    panel_name: String,
    file_name: String,
    page_id: String,
    action_id: String,
    stage_token: String,
    staged_source_path: String,
) -> Result<AuthorizedGeneratedStage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let stage = resolve_generated_stage(
            &owner_button_id,
            &program_name,
            &panel_name,
            &file_name,
            &page_id,
            &action_id,
            &stage_token,
            &staged_source_path,
        )?;
        let _guard = generated_stage_cleanup_lock()
            .lock()
            .map_err(|_| "Generated stage cleanup transaction lock is poisoned.".to_string())?;
        write_generated_stage_cleanup_journal_in(
            &generated_stage_cleanup_root()?,
            &generated_stage_program_data_root()?,
            &stage.cleanup_journal,
        )?;
        Ok(AuthorizedGeneratedStage {
            manifest_path: stage.paths.manifest_path.display().to_string(),
            stage_root: stage.paths.stage_root.display().to_string(),
        })
    })
    .await
    .map_err(|error| format!("Generated Button stage authorization task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn discard_installed_page_generated_stage(
    owner_button_id: String,
    program_name: String,
    panel_name: String,
    file_name: String,
    page_id: String,
    action_id: String,
    stage_token: String,
    staged_source_path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let stage = resolve_generated_stage(
            &owner_button_id,
            &program_name,
            &panel_name,
            &file_name,
            &page_id,
            &action_id,
            &stage_token,
            &staged_source_path,
        )?;
        let _guard = generated_stage_cleanup_lock()
            .lock()
            .map_err(|_| "Generated stage cleanup transaction lock is poisoned.".to_string())?;
        reject_generated_stage_tree_links(&stage.paths.stage_root)?;
        fs::remove_dir_all(&stage.paths.stage_root).map_err(|error| {
            format!(
                "Failed to discard short-lived generated Button stage {}: {error}",
                stage.paths.stage_root.display()
            )
        })?;
        clear_generated_stage_cleanup_transaction_in(
            &generated_stage_cleanup_root()?,
            &stage.cleanup_journal,
        )
    })
    .await
    .map_err(|error| format!("Generated Button stage cleanup task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::{
        authorize_generated_stage_at, declared_page_action, normalized_relative_resource_path,
        parse_page_action_payload, recover_generated_stage_cleanup_journals_in,
        require_active_page_identity, resolve_declared_resource, sha256_file,
        validate_and_normalize_page_manifest, validate_json_schema_value,
        validate_schema_definition, write_generated_stage_cleanup_journal_in,
        GeneratedStageCleanupJournal, GeneratedStagePolicy, InstalledPageAction,
        InstalledPageActionHandler, InstalledPageManifest, InstalledPageWindow,
        OwnerStateOperation, GENERATED_STAGE_CLEANUP_SCHEMA_VERSION,
        MAX_GENERATED_SOURCE_MANIFEST_BYTES,
    };
    use serde_json::{json, Map, Value};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestRoot(PathBuf);

    impl TestRoot {
        fn new(label: &str) -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "flowcell-installed-page-{label}-{}-{stamp}",
                std::process::id()
            ));
            fs::create_dir_all(&root).expect("create installed page test root");
            Self(root)
        }
    }

    impl std::ops::Deref for TestRoot {
        type Target = Path;
        fn deref(&self) -> &Self::Target {
            &self.0
        }
    }

    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn object_schema() -> Value {
        json!({
            "type": "object",
            "properties": { "value": { "type": "string" } },
            "required": ["value"],
            "additionalProperties": false
        })
    }

    fn owner_state_write_request_schema() -> Value {
        json!({
            "type": "object",
            "properties": { "state": { "type": "object", "additionalProperties": true } },
            "required": ["state"],
            "additionalProperties": false
        })
    }

    fn owner_state_write_response_schema() -> Value {
        json!({
            "type": "object",
            "properties": { "written": { "enum": [true] } },
            "required": ["written"],
            "additionalProperties": false
        })
    }

    fn page(root: &Path) -> InstalledPageManifest {
        fs::write(root.join("index.html"), "<main>Page</main>").expect("write entry");
        fs::write(root.join("page.js"), "postMessage({ ready: true });").expect("write script");
        fs::write(root.join("page.css"), "main { color: white; }").expect("write style");
        fs::write(root.join("icon.png"), [1u8, 2, 3]).expect("write asset");
        InstalledPageManifest {
            schema_version: 1,
            id: "example.page".to_string(),
            program: "Example".to_string(),
            label: "Example Page".to_string(),
            tooltip: "Example tooltip".to_string(),
            entry: "index.html".to_string(),
            scripts: vec!["page.js".to_string()],
            styles: vec!["page.css".to_string()],
            assets: vec!["icon.png".to_string()],
            window: InstalledPageWindow {
                title: "Example Page".to_string(),
                width: 640,
                height: 480,
                min_width: 320,
                min_height: 240,
            },
            actions: vec![InstalledPageAction {
                id: "state.write".to_string(),
                handler: InstalledPageActionHandler::OwnerState {
                    operation: OwnerStateOperation::Write,
                },
                request_schema: owner_state_write_request_schema(),
                response_schema: owner_state_write_response_schema(),
            }],
            capabilities: Vec::new(),
            owner_state_format: "example.state.v1".to_string(),
            shared_program_data_namespace: None,
            supported_data_formats: vec!["example.data.v1".to_string()],
            refresh_events: vec!["example:refresh".to_string()],
            config: Some(json!({ "mode": "example" })),
        }
    }

    fn generated_stage_policy() -> GeneratedStagePolicy {
        GeneratedStagePolicy {
            program_name: "Example".to_string(),
            import_kind: "script".to_string(),
            stage_namespace: "example.generated-buttons".to_string(),
            stage_format: "flowcell.example.generated-stage.v1".to_string(),
        }
    }

    fn write_generated_stage(root: &Path, stage_token: &str) -> (PathBuf, PathBuf) {
        let staging_root = root.join("staging");
        let stage_root = staging_root.join(stage_token);
        let source_root = stage_root.join("source");
        fs::create_dir_all(&source_root).expect("create generated stage source");
        let script_path = source_root.join("generated.ps1");
        fs::write(&script_path, "Write-Output 'generated'\n").expect("write generated script");
        let source_manifest_path = source_root.join("flowcell.script.json");
        fs::write(
            &source_manifest_path,
            serde_json::to_vec_pretty(&json!({
                "schemaVersion": 1,
                "id": "example.generated-button",
                "label": "Generated",
                "tooltip": "Generated test Button",
                "program": "Example",
                "source": "generated.ps1"
            }))
            .expect("serialize generated source manifest"),
        )
        .expect("write generated source manifest");
        let source_manifest_sha256 = sha256_file(
            &source_manifest_path,
            MAX_GENERATED_SOURCE_MANIFEST_BYTES,
            "test source manifest",
        )
        .expect("hash generated source manifest");
        let script_sha256 = sha256_file(
            &script_path,
            super::MAX_GENERATED_SCRIPT_BYTES,
            "test generated script",
        )
        .expect("hash generated script");
        fs::write(
            stage_root.join("stage.json"),
            serde_json::to_vec_pretty(&json!({
                "schemaVersion": 1,
                "format": "flowcell.example.generated-stage.v1",
                "namespace": "example.generated-buttons",
                "stageToken": stage_token,
                "createdAt": "2026-07-18T00:00:00Z",
                "programName": "Example",
                "importKind": "script",
                "packageId": "example.generated-button",
                "sourceManifestRelativePath": "source/flowcell.script.json",
                "sourceManifestSha256": source_manifest_sha256,
                "scriptSha256": script_sha256,
                "metadata": { "opaqueKey": "opaque-value" }
            }))
            .expect("serialize generated stage manifest"),
        )
        .expect("write generated stage manifest");
        (staging_root, source_manifest_path)
    }

    fn generated_stage_cleanup_journal(
        authorized: &super::AuthorizedGeneratedStagePaths,
        stage_token: &str,
    ) -> GeneratedStageCleanupJournal {
        GeneratedStageCleanupJournal {
            schema_version: GENERATED_STAGE_CLEANUP_SCHEMA_VERSION,
            owner_button_id: "button-generated-test".to_string(),
            program_id: "example".to_string(),
            program_name: "Example".to_string(),
            panel_name: "Files".to_string(),
            file_name: "flowcell.script.json".to_string(),
            page_id: "example.page".to_string(),
            action_id: "install-generated-button".to_string(),
            shared_program_data_namespace: "generated-buttons".to_string(),
            stage_token: stage_token.to_string(),
            staging_root: authorized.staging_root.display().to_string(),
            stage_root: authorized.stage_root.display().to_string(),
            manifest_path: authorized.manifest_path.display().to_string(),
        }
    }

    #[test]
    fn page_manifest_rejects_unknown_fields() {
        let raw = json!({
            "schemaVersion": 1,
            "id": "example.page",
            "program": "Example",
            "label": "Example",
            "tooltip": "",
            "entry": "index.html",
            "scripts": [],
            "styles": [],
            "assets": [],
            "window": { "title": "Example", "width": 1, "height": 1, "minWidth": 1, "minHeight": 1 },
            "actions": [],
            "capabilities": [],
            "ownerStateFormat": "example.v1",
            "supportedDataFormats": [],
            "refreshEvents": [],
            "unknown": true
        });
        assert!(serde_json::from_value::<InstalledPageManifest>(raw).is_err());
    }

    #[test]
    fn refresh_events_allow_protocol_tokens_but_reject_traversal() {
        let root = TestRoot::new("refresh-events");
        let mut candidate = page(&root);
        candidate.refresh_events = vec!["flowcell://program-data-invalidated".to_string()];
        validate_and_normalize_page_manifest(&mut candidate, &root, "Example")
            .expect("protocol refresh event should validate");

        let mut traversal = page(&root);
        traversal.refresh_events = vec!["flowcell://../secrets".to_string()];
        assert!(validate_and_normalize_page_manifest(&mut traversal, &root, "Example").is_err());

        let mut whitespace = page(&root);
        whitespace.refresh_events = vec!["flowcell://program data".to_string()];
        assert!(validate_and_normalize_page_manifest(&mut whitespace, &root, "Example").is_err());

        let mut data_format = page(&root);
        data_format.supported_data_formats = vec!["flowcell://program-data".to_string()];
        assert!(validate_and_normalize_page_manifest(&mut data_format, &root, "Example").is_err());
    }

    #[test]
    fn page_manifest_rejects_duplicate_actions_and_resources() {
        let root = TestRoot::new("duplicates");
        let mut duplicate_resource = page(&root);
        duplicate_resource.assets.push("PAGE.JS".to_string());
        assert!(
            validate_and_normalize_page_manifest(&mut duplicate_resource, &root, "Example")
                .is_err()
        );

        let mut duplicate_action = page(&root);
        duplicate_action.actions.push(InstalledPageAction {
            id: "STATE.WRITE".to_string(),
            handler: InstalledPageActionHandler::OwnerState {
                operation: OwnerStateOperation::Read,
            },
            request_schema: json!({ "type": "null" }),
            response_schema: object_schema(),
        });
        assert!(
            validate_and_normalize_page_manifest(&mut duplicate_action, &root, "Example").is_err()
        );
    }

    #[test]
    fn page_manifest_rejects_traversal_and_absolute_paths() {
        assert!(normalized_relative_resource_path("../escape.html", "entry").is_err());
        assert!(normalized_relative_resource_path(r"C:\\escape.html", "entry").is_err());
        assert!(normalized_relative_resource_path("./entry.html", "entry").is_err());
    }

    #[test]
    fn schema_subset_rejects_malformed_and_unsupported_keywords() {
        assert!(validate_schema_definition(&json!({ "oneOf": [] }), "schema").is_err());
        assert!(validate_schema_definition(
            &json!({ "type": "object", "required": ["missing"], "properties": {} }),
            "schema"
        )
        .is_err());
        assert!(validate_schema_definition(
            &json!({ "type": "array", "items": { "minimum": 1 } }),
            "schema"
        )
        .is_err());
        assert!(
            validate_json_schema_value(&object_schema(), &json!({ "other": true }), "payload")
                .is_err()
        );
        assert!(validate_json_schema_value(
            &json!({ "type": "object", "additionalProperties": false }),
            &json!({ "other": true }),
            "payload"
        )
        .is_err());
    }

    #[test]
    fn descriptor_resource_resolution_stays_inside_package() {
        let root = TestRoot::new("containment");
        let outside = root.parent().unwrap().join(format!(
            "{}-outside.txt",
            root.file_name().unwrap().to_string_lossy()
        ));
        fs::write(&outside, "outside").expect("write outside resource");
        fs::write(root.join("inside.txt"), "inside").expect("write inside resource");
        assert!(resolve_declared_resource(&root, "inside.txt", "asset").is_ok());
        assert!(resolve_declared_resource(&root, "../outside.txt", "asset").is_err());
        let _ = fs::remove_file(outside);
    }

    #[cfg(windows)]
    #[test]
    fn page_manifest_rejects_symlink_or_reparse_resources_when_creation_is_available() {
        use std::os::windows::fs::symlink_file;
        let root = TestRoot::new("reparse");
        let outside = root.parent().unwrap().join(format!(
            "{}-target.txt",
            root.file_name().unwrap().to_string_lossy()
        ));
        fs::write(&outside, "outside").expect("write symlink target");
        let linked = root.join("linked.txt");
        if symlink_file(&outside, &linked).is_ok() {
            assert!(resolve_declared_resource(&root, "linked.txt", "asset").is_err());
        }
        let _ = fs::remove_file(linked);
        let _ = fs::remove_file(outside);
    }

    #[test]
    fn undeclared_core_capabilities_are_rejected() {
        let root = TestRoot::new("core-capability");
        let mut candidate = page(&root);
        candidate.actions[0].handler = InstalledPageActionHandler::Core {
            capability: "arbitrary.command".to_string(),
            options: Map::new(),
        };
        assert!(validate_and_normalize_page_manifest(&mut candidate, &root, "Example").is_err());
    }

    #[test]
    fn undeclared_actions_and_malformed_payloads_are_rejected() {
        let root = TestRoot::new("action-validation");
        let mut candidate = page(&root);
        validate_and_normalize_page_manifest(&mut candidate, &root, "Example")
            .expect("validate page");
        assert!(declared_page_action(&candidate, "missing").is_err());
        let action = declared_page_action(&candidate, "state.write").expect("declared action");
        assert!(parse_page_action_payload(action, "not-json").is_err());
        assert!(parse_page_action_payload(action, r#"{"state":"not-an-object"}"#).is_err());
        assert!(parse_page_action_payload(action, r#"{"state":{}}"#).is_ok());
    }

    #[test]
    fn deleted_or_stale_active_page_records_fail_closed() {
        let error =
            require_active_page_identity(None, "owner-one", "Example", "Files", "example.page")
                .expect_err("missing active record must fail");
        assert!(error.contains("no longer active"));
    }

    #[test]
    fn generated_stage_authorization_accepts_exact_authenticated_manifest() {
        let root = TestRoot::new("generated-stage-valid");
        let token = "stage-token-01";
        let (staging_root, manifest_path) = write_generated_stage(&root, token);
        let authorized = authorize_generated_stage_at(
            &staging_root,
            token,
            manifest_path.to_str().expect("manifest path text"),
            &generated_stage_policy(),
        )
        .expect("authorize generated stage");
        assert_eq!(
            authorized.manifest_path,
            manifest_path.canonicalize().expect("canonical manifest")
        );
        assert_eq!(
            authorized.stage_root,
            staging_root
                .join(token)
                .canonicalize()
                .expect("canonical stage root")
        );
    }

    #[test]
    fn generated_stage_authorization_rejects_token_and_path_mismatches() {
        let root = TestRoot::new("generated-stage-path");
        let token = "stage-token-02";
        let (staging_root, manifest_path) = write_generated_stage(&root, token);
        let traversal_path = manifest_path
            .parent()
            .expect("source root")
            .join("..")
            .join("source")
            .join("flowcell.script.json");
        assert!(authorize_generated_stage_at(
            &staging_root,
            token,
            traversal_path.to_str().expect("traversal path text"),
            &generated_stage_policy(),
        )
        .is_err());

        let stage_manifest_path = staging_root.join(token).join("stage.json");
        let mut stage_manifest: Value =
            serde_json::from_slice(&fs::read(&stage_manifest_path).expect("read stage manifest"))
                .expect("parse stage manifest");
        stage_manifest["stageToken"] = json!("different-token");
        fs::write(
            &stage_manifest_path,
            serde_json::to_vec_pretty(&stage_manifest).expect("serialize changed stage manifest"),
        )
        .expect("write changed stage manifest");
        assert!(authorize_generated_stage_at(
            &staging_root,
            token,
            manifest_path.to_str().expect("manifest path text"),
            &generated_stage_policy(),
        )
        .is_err());
    }

    #[test]
    fn generated_stage_authorization_rejects_hash_and_identity_tampering() {
        let root = TestRoot::new("generated-stage-tamper");
        let token = "stage-token-03";
        let (staging_root, manifest_path) = write_generated_stage(&root, token);
        let script_path = manifest_path
            .parent()
            .expect("source root")
            .join("generated.ps1");
        fs::write(&script_path, "Write-Output 'tampered'\n").expect("tamper generated script");
        let error = authorize_generated_stage_at(
            &staging_root,
            token,
            manifest_path.to_str().expect("manifest path text"),
            &generated_stage_policy(),
        )
        .expect_err("tampered script must fail");
        assert!(error.contains("script SHA-256"));

        let root = TestRoot::new("generated-stage-identity");
        let (staging_root, manifest_path) = write_generated_stage(&root, token);
        let mut source_manifest: Value =
            serde_json::from_slice(&fs::read(&manifest_path).expect("read source manifest"))
                .expect("parse source manifest");
        source_manifest["id"] = json!("example.other-button");
        fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&source_manifest).expect("serialize changed source manifest"),
        )
        .expect("write changed source manifest");
        let stage_manifest_path = staging_root.join(token).join("stage.json");
        let mut stage_manifest: Value =
            serde_json::from_slice(&fs::read(&stage_manifest_path).expect("read stage manifest"))
                .expect("parse stage manifest");
        stage_manifest["sourceManifestSha256"] = json!(sha256_file(
            &manifest_path,
            MAX_GENERATED_SOURCE_MANIFEST_BYTES,
            "changed source manifest",
        )
        .expect("hash changed source manifest"));
        fs::write(
            &stage_manifest_path,
            serde_json::to_vec_pretty(&stage_manifest).expect("serialize changed stage manifest"),
        )
        .expect("write changed stage manifest");
        let error = authorize_generated_stage_at(
            &staging_root,
            token,
            manifest_path.to_str().expect("manifest path text"),
            &generated_stage_policy(),
        )
        .expect_err("mismatched package identity must fail");
        assert!(error.contains("id does not match"));
    }

    #[test]
    fn generated_stage_authorization_rejects_format_namespace_and_unknown_fields() {
        for (label, field, value) in [
            ("format", "format", json!("flowcell.example.other-stage.v1")),
            ("namespace", "namespace", json!("example.other-buttons")),
            ("unknown", "unexpected", json!(true)),
        ] {
            let root = TestRoot::new(&format!("generated-stage-{label}"));
            let token = "stage-token-04";
            let (staging_root, manifest_path) = write_generated_stage(&root, token);
            let stage_manifest_path = staging_root.join(token).join("stage.json");
            let mut stage_manifest: Value = serde_json::from_slice(
                &fs::read(&stage_manifest_path).expect("read stage manifest"),
            )
            .expect("parse stage manifest");
            stage_manifest[field] = value;
            fs::write(
                &stage_manifest_path,
                serde_json::to_vec_pretty(&stage_manifest)
                    .expect("serialize changed stage manifest"),
            )
            .expect("write changed stage manifest");
            assert!(authorize_generated_stage_at(
                &staging_root,
                token,
                manifest_path.to_str().expect("manifest path text"),
                &generated_stage_policy(),
            )
            .is_err());
        }
    }

    #[test]
    fn generated_stage_cleanup_journal_recovers_interrupted_authorization() {
        let root = TestRoot::new("generated-stage-recovery");
        let program_data_root = root.join("program-data");
        let namespace_root = program_data_root.join("example").join("generated-buttons");
        let cleanup_root = root
            .join("button-system")
            .join("generated-stage-transactions");
        let token = "stage-token-05";
        let (staging_root, manifest_path) = write_generated_stage(&namespace_root, token);
        let authorized = authorize_generated_stage_at(
            &staging_root,
            token,
            manifest_path.to_str().expect("manifest path text"),
            &generated_stage_policy(),
        )
        .expect("authorize generated stage");
        let journal = generated_stage_cleanup_journal(&authorized, token);
        let transaction_root =
            write_generated_stage_cleanup_journal_in(&cleanup_root, &program_data_root, &journal)
                .expect("write generated stage cleanup journal");
        assert!(transaction_root.is_dir());
        assert!(authorized.stage_root.is_dir());

        assert_eq!(
            recover_generated_stage_cleanup_journals_in(&cleanup_root, &program_data_root)
                .expect("recover generated stage cleanup journal"),
            1
        );
        assert!(!authorized.stage_root.exists());
        assert!(!transaction_root.exists());
    }

    #[test]
    fn generated_stage_cleanup_rejects_containment_drift_and_preserves_stage() {
        let root = TestRoot::new("generated-stage-recovery-drift");
        let program_data_root = root.join("program-data");
        let namespace_root = program_data_root.join("example").join("generated-buttons");
        let cleanup_root = root
            .join("button-system")
            .join("generated-stage-transactions");
        let token = "stage-token-06";
        let (staging_root, manifest_path) = write_generated_stage(&namespace_root, token);
        let authorized = authorize_generated_stage_at(
            &staging_root,
            token,
            manifest_path.to_str().expect("manifest path text"),
            &generated_stage_policy(),
        )
        .expect("authorize generated stage");
        let journal = generated_stage_cleanup_journal(&authorized, token);
        let transaction_root =
            write_generated_stage_cleanup_journal_in(&cleanup_root, &program_data_root, &journal)
                .expect("write generated stage cleanup journal");
        let journal_path = transaction_root.join(super::GENERATED_STAGE_CLEANUP_JOURNAL);
        let mut drifted: Value =
            serde_json::from_slice(&fs::read(&journal_path).expect("read cleanup journal"))
                .expect("parse cleanup journal");
        drifted["stageRoot"] = json!(root.join("outside-stage").display().to_string());
        fs::write(
            &journal_path,
            serde_json::to_vec_pretty(&drifted).expect("serialize drifted cleanup journal"),
        )
        .expect("write drifted cleanup journal");

        assert!(
            recover_generated_stage_cleanup_journals_in(&cleanup_root, &program_data_root).is_err()
        );
        assert!(authorized.stage_root.is_dir());
        assert!(transaction_root.exists());
    }
}
