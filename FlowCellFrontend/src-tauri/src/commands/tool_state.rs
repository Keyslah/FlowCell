use crate::*;

fn validate_legacy_state_file_name(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.len() > 120
        || !trimmed.to_ascii_lowercase().ends_with(".json")
        || !trimmed.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return Err("Legacy tool-state fileName must be a safe JSON file name.".to_string());
    }
    Ok(trimmed.to_string())
}

fn validate_legacy_state_format(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.len() > 120
        || !trimmed.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | '/')
        })
    {
        return Err("Legacy tool-state expectedFormat is invalid.".to_string());
    }
    Ok(trimmed.to_string())
}

fn load_legacy_tool_state_file(
    root: &Path,
    state_file_name: &str,
    expected_format: &str,
) -> Result<Option<Value>, String> {
    let state_file_name = validate_legacy_state_file_name(state_file_name)?;
    let expected_format = validate_legacy_state_format(expected_format)?;
    let path = root.join(state_file_name);
    if !path.exists() {
        return Ok(None);
    }
    if !path.is_file() {
        return Err(format!(
            "Legacy tool-state path is not a file: {}",
            path.display()
        ));
    }
    let raw = fs::read_to_string(&path).map_err(|error| {
        format!(
            "Failed to read legacy tool state at {}: {error}",
            path.display()
        )
    })?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|error| {
        format!(
            "Failed to parse legacy tool state at {}: {error}",
            path.display()
        )
    })?;
    let saved_format = parsed
        .get("format")
        .and_then(Value::as_str)
        .ok_or_else(|| "Legacy tool-state file is missing its format.".to_string())?;
    if saved_format != expected_format {
        return Err(format!(
            "Legacy tool-state format '{saved_format}' does not match '{expected_format}'."
        ));
    }
    Ok(Some(parsed))
}

#[tauri::command]
pub(crate) fn load_legacy_tool_state(
    program_name: String,
    panel_name: String,
    file_name: String,
    capability: String,
    state_file_name: String,
    expected_format: String,
) -> Result<Option<Value>, String> {
    crate::program_sources::execute::resolve_capability_source(
        &program_name,
        &panel_name,
        &file_name,
        &capability,
    )?;
    let root = crate::commands::filesystem::resolve_flowcell_local_root()?;
    load_legacy_tool_state_file(&root, &state_file_name, &expected_format)
}

#[cfg(test)]
mod tests {
    use super::load_legacy_tool_state_file;
    use std::fs;

    #[test]
    fn legacy_tool_state_load_is_format_gated_and_non_destructive() {
        let root = std::env::temp_dir().join(format!(
            "flowcell-legacy-tool-state-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("create root");
        let path = root.join("profiles.json");
        let original = r#"{"format":"package-profile-v1","profiles":[{"id":"one"}]}"#;
        fs::write(&path, original).expect("write state");

        assert!(
            load_legacy_tool_state_file(&root, "../profiles.json", "package-profile-v1").is_err()
        );
        assert!(load_legacy_tool_state_file(&root, "profiles.json", "wrong-format").is_err());
        let loaded = load_legacy_tool_state_file(&root, "profiles.json", "package-profile-v1")
            .expect("load state")
            .expect("state exists");
        assert_eq!(loaded["profiles"][0]["id"], "one");
        assert_eq!(
            fs::read_to_string(&path).expect("read unchanged state"),
            original
        );
        let _ = fs::remove_dir_all(&root);
    }
}
