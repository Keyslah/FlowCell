use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProgramManifest {
    pub schema_version: u32,
    pub program_id: String,
    pub label: String,
    pub program_type: String,
    pub process_names: Vec<String>,
    pub git_scripts_folder: String,
    pub panels_folder: String,
    pub local_scripts_folder: String,
    pub support_scripts_folder: String,
    #[serde(default)]
    pub allowed_script_extensions: Vec<String>,
    #[serde(default)]
    pub allowed_manifest_file_names: Vec<String>,
    #[serde(default)]
    pub supports_toolset_manifests: bool,
    pub runner: ProgramRunnerManifest,
    #[serde(default)]
    pub addon_reload_notes: String,
    #[serde(default)]
    pub app_restart_notes: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProgramRunnerManifest {
    pub kind: String,
    #[serde(default)]
    pub program_key: String,
    #[serde(default)]
    pub install_script: String,
    #[serde(default)]
    pub delete_script: String,
}

fn validate_relative_folder(value: &str, field: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("Program manifest field '{field}' cannot be empty."));
    }
    let path = Path::new(trimmed);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(format!(
            "Program manifest field '{field}' must be a relative folder path."
        ));
    }
    Ok(())
}

fn validate_manifest(manifest: &ProgramManifest, requested_program: &str) -> Result<(), String> {
    if manifest.schema_version != 1 {
        return Err(format!(
            "Program manifest for '{}' uses unsupported schemaVersion {}.",
            requested_program, manifest.schema_version
        ));
    }
    if manifest.program_id.trim().is_empty() || manifest.label.trim().is_empty() {
        return Err("Program manifest requires programId and label.".to_string());
    }
    if manifest.process_names.is_empty()
        || manifest
            .process_names
            .iter()
            .any(|process_name| process_name.trim().is_empty())
    {
        return Err(format!(
            "Program manifest for '{}' requires non-empty processNames.",
            manifest.label
        ));
    }
    if !manifest
        .label
        .trim()
        .eq_ignore_ascii_case(requested_program.trim())
    {
        return Err(format!(
            "Program manifest label '{}' does not match program folder '{}'.",
            manifest.label, requested_program
        ));
    }
    validate_relative_folder(&manifest.git_scripts_folder, "gitScriptsFolder")?;
    validate_relative_folder(&manifest.panels_folder, "panelsFolder")?;
    validate_relative_folder(&manifest.local_scripts_folder, "localScriptsFolder")?;
    validate_relative_folder(&manifest.support_scripts_folder, "supportScriptsFolder")?;
    match manifest.runner.kind.trim() {
        "windows-script" | "illustrator-direct" | "photoshop-direct" | "blender-bridge" => {}
        value => return Err(format!("Unsupported program runner kind '{value}'.")),
    }
    if manifest.allowed_script_extensions.is_empty() {
        return Err(format!(
            "Program manifest for '{}' has no allowedScriptExtensions.",
            manifest.label
        ));
    }
    Ok(())
}

pub(crate) fn load_program_manifest(program_name: &str) -> Result<ProgramManifest, String> {
    let program_root = crate::resolve_program_directory(program_name)?;
    let manifest_path = program_root.join("flowcell.program.json");
    let raw = fs::read_to_string(&manifest_path).map_err(|error| {
        format!(
            "Program package '{}' is missing {}: {error}",
            program_name,
            manifest_path.display()
        )
    })?;
    let manifest = serde_json::from_str::<ProgramManifest>(&raw).map_err(|error| {
        format!(
            "Program manifest at {} is invalid JSON: {error}",
            manifest_path.display()
        )
    })?;
    validate_manifest(&manifest, program_name)?;
    Ok(manifest)
}

pub(crate) fn extension_is_allowed(manifest: &ProgramManifest, path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    manifest
        .allowed_script_extensions
        .iter()
        .any(|allowed| extension.eq_ignore_ascii_case(allowed.trim().trim_start_matches('.')))
}
