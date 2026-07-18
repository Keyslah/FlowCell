use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProgramManifest {
    pub schema_version: u32,
    pub program_id: String,
    pub label: String,
    pub program_type: String,
    #[serde(default)]
    pub default_panels: Vec<String>,
    pub process_names: Vec<String>,
    #[serde(default)]
    pub exe_path: String,
    #[serde(default)]
    pub bind_scoped_native_owner: bool,
    #[serde(default)]
    pub shortcut_profile_id: String,
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
    #[serde(default)]
    pub bundled_sources: Vec<BundledSourceManifest>,
    pub runner: ProgramRunnerManifest,
    #[serde(default)]
    pub addon_reload_notes: String,
    #[serde(default)]
    pub app_restart_notes: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BundledSourceManifest {
    pub id: String,
    pub version: String,
    pub panel_name: String,
    pub source_path: String,
    #[serde(default)]
    pub import_kind: String,
    #[serde(default)]
    pub install_if_missing: bool,
    #[serde(default)]
    pub install_on_add: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legacy_match_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legacy_match_kind: Option<String>,
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
    #[serde(default)]
    pub capability_script: String,
}

pub(crate) fn normalize_import_kind(value: &str) -> Result<&'static str, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "" | "script" | "single-script" => Ok("script"),
        "tool-set" | "toolset" => Ok("tool-set"),
        _ => Err("importKind must be 'script' or 'tool-set'.".to_string()),
    }
}

fn normalize_bundled_token(value: &str, field: &str, version: bool) -> Result<String, String> {
    let trimmed = value.trim();
    let max_length = if version { 64 } else { 128 };
    if trimmed.is_empty() || trimmed.len() > max_length {
        return Err(format!(
            "Program manifest field '{field}' must contain 1 to {max_length} characters."
        ));
    }
    if !trimmed.chars().all(|character| {
        character.is_ascii_alphanumeric()
            || matches!(character, '.' | '-' | '_')
            || (version && character == '+')
    }) {
        return Err(format!(
            "Program manifest field '{field}' contains unsupported characters."
        ));
    }
    Ok(trimmed.to_string())
}

pub(crate) fn validate_bundled_source_id(value: &str) -> Result<String, String> {
    normalize_bundled_token(value, "bundledSources.id", false)
}

pub(crate) fn validate_bundled_source_version(value: &str) -> Result<String, String> {
    normalize_bundled_token(value, "bundledSources.version", true)
}

pub(crate) fn normalize_relative_manifest_path(
    value: &str,
    field: &str,
    allow_empty: bool,
) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return if allow_empty {
            Ok(String::new())
        } else {
            Err(format!("Program manifest field '{field}' cannot be empty."))
        };
    }
    let path = Path::new(trimmed);
    if path.is_absolute() {
        return Err(format!(
            "Program manifest field '{field}' must be a relative path inside the program package."
        ));
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => normalized.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!(
                    "Program manifest field '{field}' must not contain parent traversal or a path root."
                ));
            }
        }
    }
    if normalized.as_os_str().is_empty() {
        return if allow_empty {
            Ok(String::new())
        } else {
            Err(format!("Program manifest field '{field}' cannot be empty."))
        };
    }
    Ok(normalized.to_string_lossy().to_string())
}

fn canonical_existing_ancestor(path: &Path) -> Result<PathBuf, String> {
    let mut candidate = path;
    loop {
        if candidate.exists() {
            return candidate.canonicalize().map_err(|error| {
                format!(
                    "Failed to resolve manifest-owned path {}: {error}",
                    candidate.display()
                )
            });
        }
        candidate = candidate.parent().ok_or_else(|| {
            format!(
                "Manifest-owned path {} has no existing ancestor.",
                path.display()
            )
        })?;
    }
}

pub(crate) fn resolve_relative_manifest_path(
    root: &Path,
    value: &str,
    field: &str,
    allow_empty: bool,
) -> Result<Option<PathBuf>, String> {
    let normalized = normalize_relative_manifest_path(value, field, allow_empty)?;
    if normalized.is_empty() {
        return Ok(None);
    }
    let canonical_root = canonical_existing_ancestor(root)?;
    let candidate = root.join(&normalized);
    let resolved_boundary = canonical_existing_ancestor(&candidate)?;
    if !resolved_boundary.starts_with(&canonical_root) {
        return Err(format!(
            "Program manifest field '{field}' resolves outside {}.",
            root.display()
        ));
    }
    Ok(Some(candidate))
}

pub(crate) fn resolve_manifest_folder(
    program_root: &Path,
    value: &str,
    field: &str,
) -> Result<PathBuf, String> {
    resolve_relative_manifest_path(program_root, value, field, false)?
        .ok_or_else(|| format!("Program manifest field '{field}' cannot be empty."))
}

pub(crate) fn resolve_runner_script_path(
    program_root: &Path,
    manifest: &ProgramManifest,
    value: &str,
    field: &str,
) -> Result<Option<PathBuf>, String> {
    let support_root = resolve_manifest_folder(
        program_root,
        &manifest.support_scripts_folder,
        "supportScriptsFolder",
    )?;
    let script = resolve_relative_manifest_path(&support_root, value, field, true)?;
    if let Some(script) = script.as_ref() {
        let canonical_program_root = program_root.canonicalize().map_err(|error| {
            format!(
                "Failed to resolve program package root {}: {error}",
                program_root.display()
            )
        })?;
        let boundary = canonical_existing_ancestor(script)?;
        if !boundary.starts_with(canonical_program_root) {
            return Err(format!(
                "Program manifest field '{field}' resolves outside {}.",
                program_root.display()
            ));
        }
    }
    Ok(script)
}

pub(crate) fn validate_manifest(
    manifest: &mut ProgramManifest,
    requested_program: &str,
    program_root: &Path,
) -> Result<(), String> {
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
    for panel in &manifest.default_panels {
        crate::validate_folder_name(panel, "Default panel").map_err(|error| {
            format!(
                "Program manifest for '{}' has an invalid defaultPanels entry: {error}",
                manifest.label
            )
        })?;
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
    manifest.git_scripts_folder =
        normalize_relative_manifest_path(&manifest.git_scripts_folder, "gitScriptsFolder", false)?;
    manifest.panels_folder =
        normalize_relative_manifest_path(&manifest.panels_folder, "panelsFolder", false)?;
    manifest.local_scripts_folder = normalize_relative_manifest_path(
        &manifest.local_scripts_folder,
        "localScriptsFolder",
        false,
    )?;
    manifest.support_scripts_folder = normalize_relative_manifest_path(
        &manifest.support_scripts_folder,
        "supportScriptsFolder",
        false,
    )?;
    manifest.runner.install_script = normalize_relative_manifest_path(
        &manifest.runner.install_script,
        "runner.installScript",
        true,
    )?;
    manifest.runner.delete_script = normalize_relative_manifest_path(
        &manifest.runner.delete_script,
        "runner.deleteScript",
        true,
    )?;
    manifest.runner.capability_script = normalize_relative_manifest_path(
        &manifest.runner.capability_script,
        "runner.capabilityScript",
        true,
    )?;
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
    if manifest.runner.kind.trim() == "blender-bridge"
        && (manifest.runner.install_script.is_empty() || manifest.runner.delete_script.is_empty())
    {
        return Err(
            "Blender program manifests require runner.installScript and runner.deleteScript."
                .to_string(),
        );
    }
    for (value, field) in [
        (&manifest.git_scripts_folder, "gitScriptsFolder"),
        (&manifest.panels_folder, "panelsFolder"),
        (&manifest.local_scripts_folder, "localScriptsFolder"),
        (&manifest.support_scripts_folder, "supportScriptsFolder"),
    ] {
        resolve_manifest_folder(program_root, value, field)?;
    }
    for (value, field) in [
        (&manifest.runner.install_script, "runner.installScript"),
        (&manifest.runner.delete_script, "runner.deleteScript"),
        (
            &manifest.runner.capability_script,
            "runner.capabilityScript",
        ),
    ] {
        resolve_runner_script_path(program_root, manifest, value, field)?;
    }
    let mut bundled_ids = BTreeSet::new();
    for source in &mut manifest.bundled_sources {
        source.id = validate_bundled_source_id(&source.id)?;
        source.version = validate_bundled_source_version(&source.version)?;
        if !bundled_ids.insert(source.id.to_ascii_lowercase()) {
            return Err(format!(
                "Program manifest for '{}' duplicates bundledSources id '{}'.",
                manifest.label, source.id
            ));
        }
        source.panel_name = crate::validate_folder_name(&source.panel_name, "Bundled source panel")
            .map_err(|error| {
                format!(
                    "Program manifest for '{}' has an invalid bundledSources panelName: {error}",
                    manifest.label
                )
            })?;
        source.source_path = normalize_relative_manifest_path(
            &source.source_path,
            "bundledSources.sourcePath",
            false,
        )?;
        source.import_kind = normalize_import_kind(&source.import_kind)?.to_string();
        if source.install_if_missing && source.install_on_add {
            return Err(format!(
                "Program manifest bundled source '{}' cannot set both installIfMissing and installOnAdd.",
                source.id
            ));
        }
        let declared_path = resolve_relative_manifest_path(
            program_root,
            &source.source_path,
            "bundledSources.sourcePath",
            false,
        )?
        .ok_or_else(|| "bundledSources.sourcePath cannot be empty.".to_string())?;
        if !declared_path.exists() {
            return Err(format!(
                "Program manifest bundled source '{}' was not found at {}.",
                source.id,
                declared_path.display()
            ));
        }
        source.legacy_match_label = source
            .legacy_match_label
            .take()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        source.legacy_match_kind = source
            .legacy_match_kind
            .take()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(|value| normalize_import_kind(&value).map(str::to_string))
            .transpose()?;
        if source.legacy_match_kind.is_some() && source.legacy_match_label.is_none() {
            return Err(format!(
                "Program manifest bundled source '{}' requires legacyMatchLabel when legacyMatchKind is set.",
                source.id
            ));
        }
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
    let mut manifest = serde_json::from_str::<ProgramManifest>(&raw).map_err(|error| {
        format!(
            "Program manifest at {} is invalid JSON: {error}",
            manifest_path.display()
        )
    })?;
    validate_manifest(&mut manifest, program_name, &program_root)?;
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

#[cfg(test)]
mod tests {
    use super::{
        normalize_import_kind, normalize_relative_manifest_path, validate_bundled_source_id,
        validate_bundled_source_version, validate_manifest, ProgramManifest,
    };
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn relative_manifest_paths_are_normalized() {
        assert_eq!(
            normalize_relative_manifest_path(r"SupportScripts\.\Adapters", "field", false)
                .expect("normalized path"),
            r"SupportScripts\Adapters"
        );
    }

    #[test]
    fn relative_manifest_paths_reject_escape_and_absolute_paths() {
        for invalid in [
            r"..\outside",
            r"inside\..\outside",
            r"C:\outside",
            r"\\server\share",
        ] {
            assert!(normalize_relative_manifest_path(invalid, "field", false).is_err());
        }
    }

    #[test]
    fn optional_runner_paths_allow_only_truly_empty_values() {
        assert_eq!(
            normalize_relative_manifest_path("  ", "runner.installScript", true)
                .expect("empty optional path"),
            ""
        );
        assert!(normalize_relative_manifest_path("..", "runner.installScript", true).is_err());
    }

    #[test]
    fn bundled_source_tokens_and_import_kinds_are_bounded() {
        assert_eq!(
            validate_bundled_source_id("illustrator.layers-tree").expect("valid id"),
            "illustrator.layers-tree"
        );
        assert_eq!(
            validate_bundled_source_version("2.0.1+repair").expect("valid version"),
            "2.0.1+repair"
        );
        assert_eq!(normalize_import_kind("toolset").unwrap(), "tool-set");
        assert!(validate_bundled_source_id("layers/tree").is_err());
        assert!(validate_bundled_source_version("version with spaces").is_err());
        assert!(normalize_import_kind("panel").is_err());
    }

    #[test]
    fn shipped_program_manifests_match_the_runtime_schema() {
        let programs_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("Programs");
        for entry in fs::read_dir(&programs_root).expect("Programs directory") {
            let entry = entry.expect("program directory entry");
            if !entry.file_type().expect("program entry type").is_dir() {
                continue;
            }
            let manifest_path = entry.path().join("flowcell.program.json");
            if !manifest_path.is_file() {
                continue;
            }
            let program_name = entry.file_name().to_string_lossy().to_string();
            let raw = fs::read_to_string(&manifest_path).expect("shipped program manifest");
            let mut manifest = serde_json::from_str::<ProgramManifest>(&raw)
                .expect("shipped program manifest schema");
            validate_manifest(&mut manifest, &program_name, &entry.path())
                .unwrap_or_else(|error| panic!("{}: {error}", manifest_path.display()));
        }
    }
}
