//! Bind-only actions are declared by their program package, never synthesized by core.
use super::manifest::ProgramManifest;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub(crate) struct ProgramBindAction {
    pub id: String,
    pub label: String,
    pub panel: String,
    pub source: String,
    pub pass_through: bool,
    pub success_return_value: String,
    pub success_note: String,
    pub failure_note: String,
}

pub(crate) fn validate_relative_file(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 1024 || value.trim() != value
        || value.split(['/', '\\']).any(|part| {
            part.is_empty() || matches!(part, "." | "..") || part.ends_with([' ', '.'])
                || part.chars().any(|c| c.is_control() || "<>:\"|?*[]".contains(c))
        })
    {
        return Err("Program bind action files must be plain relative paths inside their program package.".into());
    }
    Ok(())
}

pub(crate) fn resolve_file(root: &Path, value: &str) -> Result<PathBuf, String> {
    validate_relative_file(value)?;
    let path = super::manifest::resolve_relative_manifest_path(root, value, "bind action file", false)?
        .ok_or("Program bind action file is missing.")?;
    super::installed_page::reject_selected_source_reparse_point(&path)?;
    if !path.is_file() { return Err(format!("Program bind action file is missing: {}", path.display())); }
    Ok(path)
}

pub(crate) fn parse_actions(contents: &str) -> Result<Vec<ProgramBindAction>, String> {
    if contents.len() > 65536 || contents.contains('\0') {
        return Err("Program bind action declarations must be UTF-8 text no larger than 64 KiB.".into());
    }
    let mut sections: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    let mut section = String::new();
    for raw in contents.trim_start_matches('\u{feff}').lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') { continue; }
        if line.starts_with('[') && line.ends_with(']') {
            section = line[1..line.len() - 1].to_string();
            if sections.keys().any(|key| key.eq_ignore_ascii_case(&section)) {
                return Err("Program bind action declarations contain duplicate sections.".into());
            }
            sections.insert(section.clone(), BTreeMap::new());
            continue;
        }
        let (key, value) = line.split_once('=').ok_or("Invalid program bind action declaration.")?;
        let (key, value) = (key.trim(), value.trim());
        if key.is_empty() || value.chars().any(char::is_control) {
            return Err("Program bind action declarations contain invalid values.".into());
        }
        let fields = sections.get_mut(&section).ok_or("Program bind action value has no section.")?;
        if fields.keys().any(|existing| existing.eq_ignore_ascii_case(key)) {
            return Err("Program bind action declarations contain duplicate fields.".into());
        }
        fields.insert(key.to_string(), value.to_string());
    }
    let meta = sections.remove("Meta").ok_or("Program bind action declarations need [Meta].")?;
    if meta.len() != 1 || meta.get("SchemaVersion").map(String::as_str) != Some("1") {
        return Err("Program bind action declarations require SchemaVersion=1.".into());
    }
    if sections.len() > 64 { return Err("Program packages permit at most 64 bind actions.".into()); }
    let mut actions = Vec::new();
    let mut ids = BTreeSet::new();
    for (section, fields) in sections {
        let id = section.strip_prefix("Action_").ok_or("Unknown program bind action section.")?;
        if id.is_empty() || id.len() > 128 || !id.chars().all(|c| c.is_ascii_alphanumeric() || "_.-".contains(c))
            || !ids.insert(id.to_ascii_lowercase()) {
            return Err("Program bind action IDs must be unique plain identifiers.".into());
        }
        let allowed = ["Label", "Panel", "Source", "PassThrough", "SuccessReturnValue", "SuccessNote", "FailureNote"];
        if fields.keys().any(|key| !allowed.contains(&key.as_str())) {
            return Err("Unknown program bind action field.".into());
        }
        let required = |key: &str| -> Result<String, String> {
            fields.get(key).filter(|value| !value.is_empty()).cloned()
                .ok_or_else(|| format!("Program bind action '{id}' requires {key}."))
        };
        let source = required("Source")?;
        validate_relative_file(&source)?;
        let extension = Path::new(&source).extension().and_then(|value| value.to_str()).unwrap_or("");
        if !matches!(extension.to_ascii_lowercase().as_str(), "jsx" | "js") {
            return Err("Foreground program bind actions require a direct host .jsx or .js script.".into());
        }
        let pass_through = match fields.get("PassThrough").map(String::as_str) {
            Some("1") => true,
            Some("0") => false,
            _ => return Err("Program bind actions require PassThrough=0 or PassThrough=1.".into()),
        };
        let panel = required("Panel")?;
        crate::validate_folder_name(&panel, "Bind action panel")?;
        actions.push(ProgramBindAction {
            id: id.to_string(), label: required("Label")?, panel, source, pass_through,
            success_return_value: required("SuccessReturnValue")?,
            success_note: required("SuccessNote")?, failure_note: required("FailureNote")?,
        });
    }
    Ok(actions)
}

pub(crate) fn load_actions(root: &Path, manifest: &ProgramManifest) -> Result<Vec<ProgramBindAction>, String> {
    let Some(file) = &manifest.bind_actions_file else { return Ok(Vec::new()) };
    if !matches!(manifest.runner.kind.as_str(), "illustrator-direct" | "photoshop-direct") {
        return Err("Foreground program bind actions require a direct script runner.".into());
    }
    let path = resolve_file(root, file)?;
    if fs::metadata(&path).map_err(|error| error.to_string())?.len() > 65536 {
        return Err("Program bind action declarations exceed 64 KiB.".into());
    }
    let actions = parse_actions(&fs::read_to_string(&path).map_err(|error| error.to_string())?)?;
    for action in &actions { resolve_file(root, &action.source)?; }
    Ok(actions)
}

#[cfg(test)]
mod tests {
    use super::*;
    const ACTION: &str = "[Meta]\nSchemaVersion=1\n[Action_sample_capture]\nLabel=Capture\nPanel=Actions\nSource=Helpers/capture.jsx\nPassThrough=1\nSuccessReturnValue=captured\nSuccessNote=Captured.\nFailureNote=Choose an object.\n";

    #[test]
    fn declared_actions_keep_their_saved_identifier_and_observe_native_keys() {
        let actions = parse_actions(ACTION).unwrap();
        assert_eq!(actions[0].id, "sample_capture");
        assert!(actions[0].pass_through);
        assert_eq!(actions[0].success_return_value, "captured");
    }

    #[test]
    fn unsafe_and_ambiguous_action_declarations_are_rejected() {
        for invalid in [ACTION.replace("Helpers/capture.jsx", "../capture.jsx"), ACTION.replace("Helpers/capture.jsx", "C:/capture.jsx"), ACTION.replace("PassThrough=1", "PassThrough=yes"), format!("{ACTION}Source=other.jsx\n"), format!("{ACTION}[Action_sample_capture]\n")] {
            assert!(parse_actions(&invalid).is_err());
        }
    }
}
