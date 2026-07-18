use crate::*;

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct SavedToolFieldFile {
    format: String,
    saved_at: String,
    values: Value,
}

fn normalize_tool_field_file_path(path: &Path) -> PathBuf {
    if path.extension().is_some() {
        path.to_path_buf()
    } else {
        let mut next_path = path.to_path_buf();
        next_path.set_extension("json");
        next_path
    }
}

fn sanitize_package_file_stem(value: &str) -> String {
    let trimmed = value.trim();
    let mut sanitized = String::with_capacity(trimmed.len());
    let mut last_was_separator = false;
    for character in trimmed.chars() {
        if character.is_ascii_alphanumeric() {
            sanitized.push(character);
            last_was_separator = false;
        } else if matches!(character, ' ' | '-' | '_' | '.') && !last_was_separator {
            sanitized.push('_');
            last_was_separator = true;
        }
    }
    let cleaned = sanitized.trim_matches('_').to_string();
    if cleaned.is_empty() {
        "tool_package".to_string()
    } else {
        cleaned
    }
}

fn validate_tool_field_format_id(value: &str) -> Result<String, String> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty()
        || normalized.len() > 64
        || !normalized.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return Err(
            "Tool-field formatId must contain only letters, numbers, '.', '-', or '_'.".to_string(),
        );
    }
    Ok(normalized)
}

#[tauri::command]
pub(crate) fn save_tool_field_file(
    format_id: String,
    path: String,
    value_fields: Vec<String>,
    values: Value,
) -> Result<String, String> {
    let format_id = validate_tool_field_format_id(&format_id)?;
    let values = filter_declared_values(&values, &value_fields, "Tool-field")?;
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("Tool-field file path is required.".to_string());
    }
    let file_path = normalize_tool_field_file_path(Path::new(trimmed_path));
    if let Some(parent) = file_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Failed to create tool-field folder at {}: {error}",
                    parent.display()
                )
            })?;
        }
    }
    let payload = SavedToolFieldFile {
        format: format!("flowcell-tool-fields/{format_id}/v1"),
        saved_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_secs()
            .to_string(),
        values,
    };
    let serialized = serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?;
    fs::write(&file_path, serialized).map_err(|error| {
        format!(
            "Failed to write tool-field file at {}: {error}",
            file_path.display()
        )
    })?;
    Ok(file_path.display().to_string())
}

#[tauri::command]
pub(crate) fn load_tool_field_file(
    format_id: String,
    path: String,
    legacy_formats: Vec<String>,
    value_fields: Vec<String>,
    legacy_value_keys: Vec<String>,
) -> Result<Value, String> {
    let format_id = validate_tool_field_format_id(&format_id)?;
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("Tool-field file path is required.".to_string());
    }
    let file_path = PathBuf::from(trimmed_path);
    if !file_path.is_file() {
        return Err(format!(
            "Tool-field file was not found: {}",
            file_path.display()
        ));
    }
    let raw = fs::read_to_string(&file_path).map_err(|error| {
        format!(
            "Failed to read tool-field file at {}: {error}",
            file_path.display()
        )
    })?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|error| {
        format!(
            "Failed to parse tool-field file at {}: {error}",
            file_path.display()
        )
    })?;
    let expected = format!("flowcell-tool-fields/{format_id}/v1");
    let saved_format = parsed
        .get("format")
        .and_then(Value::as_str)
        .unwrap_or(&expected);
    let is_legacy = saved_format != expected;
    if is_legacy && !legacy_formats.iter().any(|value| value == saved_format) {
        return Err(format!(
            "Tool-field file format '{saved_format}' does not match '{expected}'."
        ));
    }
    let values = parsed
        .get("values")
        .cloned()
        .unwrap_or_else(|| parsed.clone());
    let allowed_fields = if is_legacy {
        &legacy_value_keys
    } else {
        &value_fields
    };
    let values = filter_declared_values(&values, allowed_fields, "Tool-field")?;
    Ok(json!({ "format": saved_format, "values": values }))
}

fn validate_tool_package_storage_folder(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.len() > 80
        || !trimmed
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(
            "Tool-package storageFolder must contain only letters, numbers, '-', or '_'."
                .to_string(),
        );
    }
    Ok(trimmed.to_string())
}

fn validate_tool_package_manifest_suffix(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if !trimmed.starts_with('.')
        || !trimmed.to_ascii_lowercase().ends_with(".json")
        || trimmed.len() > 80
        || !trimmed.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return Err("Tool-package manifestSuffix must be a safe JSON suffix.".to_string());
    }
    Ok(trimmed.to_string())
}

fn authorize_tool_package_source(
    program_name: &str,
    panel_name: &str,
    file_name: &str,
    capability: &str,
) -> Result<(), String> {
    crate::program_sources::execute::resolve_capability_source(
        program_name,
        panel_name,
        file_name,
        capability,
    )?;
    Ok(())
}

fn tool_package_root(storage_folder: &str) -> Result<PathBuf, String> {
    let storage_folder = validate_tool_package_storage_folder(storage_folder)?;
    let root = resolve_flowcell_local_root()?.join(storage_folder);
    fs::create_dir_all(&root).map_err(|error| {
        format!(
            "Failed to create tool-package folder at {}: {error}",
            root.display()
        )
    })?;
    Ok(root)
}

#[tauri::command]
pub(crate) fn resolve_tool_package_root(
    program_name: String,
    panel_name: String,
    file_name: String,
    capability: String,
    storage_folder: String,
    format_id: String,
) -> Result<String, String> {
    authorize_tool_package_source(&program_name, &panel_name, &file_name, &capability)?;
    validate_tool_field_format_id(&format_id)?;
    Ok(tool_package_root(&storage_folder)?.display().to_string())
}

fn tool_package_stem(selected_path: &Path, manifest_suffix: &str) -> String {
    let file_name = selected_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("tool_package");
    let lower_name = file_name.to_ascii_lowercase();
    let lower_suffix = manifest_suffix.to_ascii_lowercase();
    let raw_stem = if lower_name.ends_with(&lower_suffix) {
        &file_name[..file_name.len().saturating_sub(manifest_suffix.len())]
    } else {
        selected_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(file_name)
    };
    sanitize_package_file_stem(raw_stem)
}

fn package_asset_file_name(source: &Path, field_id: &str, used: &mut HashSet<String>) -> String {
    let original = source
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("asset.bin");
    let mut candidate = original.to_string();
    if used.contains(&candidate.to_ascii_lowercase()) {
        candidate = format!("{}_{}", sanitize_package_file_stem(field_id), original);
    }
    let mut disambiguator = 2usize;
    while used.contains(&candidate.to_ascii_lowercase()) {
        candidate = format!(
            "{}_{}_{}",
            sanitize_package_file_stem(field_id),
            disambiguator,
            original
        );
        disambiguator += 1;
    }
    used.insert(candidate.to_ascii_lowercase());
    candidate
}

#[tauri::command]
pub(crate) fn save_tool_package(
    program_name: String,
    panel_name: String,
    file_name: String,
    capability: String,
    storage_folder: String,
    format_id: String,
    manifest_path: String,
    manifest_suffix: String,
    value_fields: Vec<String>,
    asset_fields: Vec<String>,
    values: Value,
) -> Result<String, String> {
    authorize_tool_package_source(&program_name, &panel_name, &file_name, &capability)?;
    let format_id = validate_tool_field_format_id(&format_id)?;
    let manifest_suffix = validate_tool_package_manifest_suffix(&manifest_suffix)?;
    let root = tool_package_root(&storage_folder)?;
    save_tool_package_to_root(
        &root,
        &format_id,
        &manifest_path,
        &manifest_suffix,
        &value_fields,
        &asset_fields,
        &values,
    )
}

fn save_tool_package_to_root(
    root: &Path,
    format_id: &str,
    manifest_path: &str,
    manifest_suffix: &str,
    value_fields: &[String],
    asset_fields: &[String],
    values: &Value,
) -> Result<String, String> {
    if !values.is_object() {
        return Err("Tool-package values must be a JSON object.".to_string());
    }
    let selected_path = PathBuf::from(manifest_path.trim());
    if manifest_path.trim().is_empty() || selected_path.file_name().is_none() {
        return Err("Tool-package manifest path is required.".to_string());
    }
    let selected_parent = selected_path.parent().ok_or_else(|| {
        "Tool-package manifest must be selected inside its package library.".to_string()
    })?;
    let canonical_root = fs::canonicalize(root).map_err(|error| {
        format!(
            "Failed to resolve tool-package library at {}: {error}",
            root.display()
        )
    })?;
    let canonical_parent = fs::canonicalize(selected_parent).map_err(|error| {
        format!(
            "Failed to resolve selected tool-package folder at {}: {error}",
            selected_parent.display()
        )
    })?;
    if canonical_parent != canonical_root {
        return Err(format!(
            "Tool packages must be saved directly inside the package library at {}.",
            root.display()
        ));
    }

    let stem = tool_package_stem(&selected_path, manifest_suffix);
    let package_dir = root.join(&stem);
    if package_dir.exists() {
        return Err(format!(
            "Tool package '{}' already exists. Choose a new package name.",
            stem
        ));
    }
    let values_object = values
        .as_object()
        .ok_or_else(|| "Tool-package values must be a JSON object.".to_string())?;
    if value_fields.is_empty() {
        return Err("Tool-package valueFields must declare at least one field.".to_string());
    }
    let mut stored_values = serde_json::Map::new();
    let mut seen_value_fields = HashSet::new();
    for field_id in value_fields.iter().map(|value| value.trim()) {
        let normalized = validate_tool_field_format_id(field_id)?;
        if !seen_value_fields.insert(normalized) {
            return Err(format!(
                "Tool-package valueFields contains duplicate field '{field_id}'."
            ));
        }
        if let Some(value) = values_object.get(field_id) {
            stored_values.insert(field_id.to_string(), value.clone());
        }
    }
    let staging_token = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let staging_dir = root.join(format!(
        ".flowcell-package-staging-{stem}-{}-{staging_token}",
        std::process::id()
    ));
    fs::create_dir(&staging_dir).map_err(|error| {
        format!(
            "Failed to stage tool package at {}: {error}",
            staging_dir.display()
        )
    })?;

    let staged_result = (|| {
        let mut assets = serde_json::Map::new();
        let mut used_file_names = HashSet::new();
        let mut seen_asset_fields = HashSet::new();
        for field_id in asset_fields
            .iter()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            let normalized = validate_tool_field_format_id(field_id)?;
            if !seen_asset_fields.insert(normalized.clone()) {
                return Err(format!(
                    "Tool-package assetFields contains duplicate field '{field_id}'."
                ));
            }
            if !seen_value_fields.contains(&normalized) {
                return Err(format!(
                    "Tool-package asset field '{field_id}' must also be declared in valueFields."
                ));
            }
            let Some(source_path) = values_object
                .get(field_id)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
            else {
                continue;
            };
            if !source_path.is_file() {
                return Err(format!(
                    "Package asset was not found: {}",
                    source_path.display()
                ));
            }
            let destination_name =
                package_asset_file_name(&source_path, field_id, &mut used_file_names);
            let destination = staging_dir.join(&destination_name);
            fs::copy(&source_path, &destination).map_err(|error| {
                format!(
                    "Failed to copy package asset {}: {error}",
                    source_path.display()
                )
            })?;
            assets.insert(field_id.to_string(), Value::String(destination_name));
        }
        if !asset_fields.is_empty() && assets.is_empty() {
            return Err("Add at least one package asset before saving.".to_string());
        }

        let staged_manifest_path = staging_dir.join(format!("{stem}{manifest_suffix}"));
        let payload = json!({
            "format": format!("flowcell-tool-package/{format_id}/v1"),
            "savedAt": SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|error| error.to_string())?
                .as_secs()
                .to_string(),
            "name": stem,
            "assets": Value::Object(assets),
            "values": Value::Object(stored_values),
        });
        let serialized =
            serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?;
        fs::write(&staged_manifest_path, serialized).map_err(|error| {
            format!(
                "Failed to write staged tool-package manifest at {}: {error}",
                staged_manifest_path.display()
            )
        })?;
        fs::rename(&staging_dir, &package_dir).map_err(|error| {
            format!(
                "Failed to publish tool package at {}: {error}",
                package_dir.display()
            )
        })?;
        Ok(package_dir.join(format!("{stem}{manifest_suffix}")))
    })();

    if staged_result.is_err() && staging_dir.exists() {
        let _ = fs::remove_dir_all(&staging_dir);
    }
    staged_result.map(|path| path.display().to_string())
}

fn resolve_package_asset(parent: &Path, relative: &str) -> Result<String, String> {
    let relative_path = Path::new(relative.trim());
    if relative_path.as_os_str().is_empty()
        || relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err("Tool-package asset path must stay inside its package folder.".to_string());
    }
    let resolved = parent.join(relative_path);
    if !resolved.is_file() {
        return Err(format!(
            "Tool-package asset was not found: {}",
            resolved.display()
        ));
    }
    let canonical_parent = fs::canonicalize(parent).map_err(|error| {
        format!(
            "Failed to resolve tool-package folder at {}: {error}",
            parent.display()
        )
    })?;
    let canonical_resolved = fs::canonicalize(&resolved).map_err(|error| {
        format!(
            "Failed to resolve tool-package asset at {}: {error}",
            resolved.display()
        )
    })?;
    if !canonical_resolved.starts_with(&canonical_parent) {
        return Err("Tool-package asset must stay inside its package folder.".to_string());
    }
    Ok(canonical_resolved.display().to_string())
}

#[tauri::command]
pub(crate) fn load_tool_package(
    program_name: String,
    panel_name: String,
    file_name: String,
    capability: String,
    storage_folder: String,
    format_id: String,
    manifest_path: String,
    legacy_formats: Vec<String>,
    value_fields: Vec<String>,
    asset_fields: Vec<String>,
    legacy_value_keys: Vec<String>,
    legacy_asset_keys: Vec<String>,
) -> Result<Value, String> {
    authorize_tool_package_source(&program_name, &panel_name, &file_name, &capability)?;
    validate_tool_package_storage_folder(&storage_folder)?;
    let format_id = validate_tool_field_format_id(&format_id)?;
    let file_path = PathBuf::from(manifest_path.trim());
    if !file_path.is_file() {
        return Err(format!(
            "Tool-package manifest was not found: {}",
            file_path.display()
        ));
    }
    load_tool_package_manifest(
        &file_path,
        &format_id,
        &legacy_formats,
        &value_fields,
        &asset_fields,
        &legacy_value_keys,
        &legacy_asset_keys,
    )
}

fn load_tool_package_manifest(
    file_path: &Path,
    format_id: &str,
    legacy_formats: &[String],
    value_fields: &[String],
    asset_fields: &[String],
    legacy_value_keys: &[String],
    legacy_asset_keys: &[String],
) -> Result<Value, String> {
    let parsed: Value = serde_json::from_str(&fs::read_to_string(&file_path).map_err(|error| {
        format!(
            "Failed to read tool-package manifest at {}: {error}",
            file_path.display()
        )
    })?)
    .map_err(|error| {
        format!(
            "Failed to parse tool-package manifest at {}: {error}",
            file_path.display()
        )
    })?;
    let saved_format = parsed
        .get("format")
        .and_then(Value::as_str)
        .ok_or_else(|| "Tool-package manifest is missing its format.".to_string())?;
    let expected_format = format!("flowcell-tool-package/{format_id}/v1");
    let is_legacy = saved_format != expected_format;
    if is_legacy && !legacy_formats.iter().any(|value| value == saved_format) {
        return Err(format!(
            "Tool-package format '{saved_format}' does not match '{expected_format}'."
        ));
    }
    let selected_value_fields = if is_legacy {
        legacy_value_keys
    } else {
        value_fields
    };
    let selected_asset_fields = if is_legacy {
        legacy_asset_keys
    } else {
        asset_fields
    };
    let values = parsed
        .get("values")
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| Value::Object(Default::default()));
    let values = filter_declared_values(&values, selected_value_fields, "Tool-package")?;
    let allowed_assets =
        normalized_tool_package_field_allowlist(selected_asset_fields, "assetFields", false)?;
    let parent = file_path.parent().unwrap_or_else(|| Path::new("."));
    let mut assets = serde_json::Map::new();
    if !is_legacy {
        let current_assets = parsed.get("assets").and_then(Value::as_object);
        for (field_id, relative) in current_assets.into_iter().flatten() {
            if !allowed_assets.contains(&field_id.trim().to_ascii_lowercase()) {
                continue;
            }
            if let Some(relative) = relative
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                assets.insert(
                    field_id.clone(),
                    Value::String(resolve_package_asset(parent, relative)?),
                );
            }
        }
    } else {
        for key in legacy_asset_keys {
            if let Some(relative) = parsed
                .get(key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                assets.insert(
                    key.clone(),
                    Value::String(resolve_package_asset(parent, relative)?),
                );
            }
        }
    }
    let name = parsed
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            file_path
                .parent()
                .and_then(Path::file_name)
                .and_then(|value| value.to_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "Tool Package".to_string());
    Ok(json!({
        "format": saved_format,
        "name": name,
        "manifestPath": file_path.display().to_string(),
        "values": values,
        "assets": Value::Object(assets),
    }))
}

fn filter_declared_values(
    values: &Value,
    value_fields: &[String],
    subject: &str,
) -> Result<Value, String> {
    let allowed = normalized_tool_package_field_allowlist(value_fields, "valueFields", true)?;
    let object = values
        .as_object()
        .ok_or_else(|| format!("{subject} values must be a JSON object."))?;
    Ok(Value::Object(
        object
            .iter()
            .filter(|(field_id, _)| allowed.contains(&field_id.trim().to_ascii_lowercase()))
            .map(|(field_id, value)| (field_id.clone(), value.clone()))
            .collect(),
    ))
}

fn normalized_tool_package_field_allowlist(
    fields: &[String],
    label: &str,
    require_nonempty: bool,
) -> Result<HashSet<String>, String> {
    if require_nonempty && fields.is_empty() {
        return Err(format!(
            "Tool-package {label} must declare at least one field."
        ));
    }
    let mut allowed = HashSet::new();
    for field_id in fields.iter().map(|value| value.trim()) {
        let normalized = validate_tool_field_format_id(field_id)?;
        if !allowed.insert(normalized) {
            return Err(format!(
                "Tool-package {label} contains duplicate field '{field_id}'."
            ));
        }
    }
    Ok(allowed)
}

#[tauri::command]
pub(crate) fn list_tool_packages(
    program_name: String,
    panel_name: String,
    file_name: String,
    capability: String,
    storage_folder: String,
    format_id: String,
    manifest_suffix: String,
) -> Result<Vec<Value>, String> {
    authorize_tool_package_source(&program_name, &panel_name, &file_name, &capability)?;
    validate_tool_field_format_id(&format_id)?;
    let suffix = validate_tool_package_manifest_suffix(&manifest_suffix)?.to_ascii_lowercase();
    let root = tool_package_root(&storage_folder)?;
    list_tool_packages_in_root(&root, &suffix)
}

fn list_tool_packages_in_root(root: &Path, suffix: &str) -> Result<Vec<Value>, String> {
    let mut packages = Vec::<(String, String)>::new();
    let canonical_root = fs::canonicalize(root).map_err(|error| {
        format!(
            "Failed to resolve tool-package library at {}: {error}",
            root.display()
        )
    })?;
    for entry in fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .flatten()
    {
        let package_dir = entry.path();
        if !package_dir.is_dir() {
            continue;
        }
        if entry
            .file_type()
            .is_ok_and(|file_type| file_type.is_symlink())
        {
            continue;
        }
        let Ok(canonical_package_dir) = fs::canonicalize(&package_dir) else {
            continue;
        };
        if canonical_package_dir.parent() != Some(canonical_root.as_path()) {
            continue;
        }
        if package_dir
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.starts_with(".flowcell-package-staging-"))
        {
            continue;
        }
        let Ok(files) = fs::read_dir(&canonical_package_dir) else {
            continue;
        };
        for file in files.flatten() {
            let file_path = file.path();
            let matches_suffix = file_path
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.to_ascii_lowercase().ends_with(&suffix))
                .unwrap_or(false);
            if !file_path.is_file() || !matches_suffix {
                continue;
            }
            let name = fs::read_to_string(&file_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                .and_then(|parsed| {
                    parsed
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                })
                .or_else(|| {
                    package_dir
                        .file_name()
                        .and_then(|value| value.to_str())
                        .map(str::to_string)
                })
                .unwrap_or_else(|| "Tool Package".to_string());
            packages.push((name, file_path.display().to_string()));
            break;
        }
    }
    packages.sort_by(|left, right| left.0.to_lowercase().cmp(&right.0.to_lowercase()));
    Ok(packages
        .into_iter()
        .map(|(name, manifest_path)| json!({ "name": name, "manifestPath": manifest_path }))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{
        list_tool_packages_in_root, load_tool_field_file, load_tool_package_manifest,
        save_tool_package_to_root,
    };
    use serde_json::json;
    use std::fs;
    use std::path::{Path, PathBuf};

    fn temporary_root(name: &str) -> PathBuf {
        let token = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "flowcell-tool-package-{name}-{}-{token}",
            std::process::id()
        ))
    }

    fn try_create_file_symlink(source: &Path, link: &Path) -> bool {
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(source, link).is_ok()
        }
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_file(source, link).is_ok()
        }
        #[cfg(not(any(unix, windows)))]
        {
            let _ = (source, link);
            false
        }
    }

    #[test]
    fn save_requires_the_declared_library_root_and_refuses_replacement() {
        let root = temporary_root("root-contract");
        let outside = temporary_root("outside");
        fs::create_dir_all(&root).expect("create root");
        fs::create_dir_all(&outside).expect("create outside");
        let asset = root.join("source.png");
        fs::write(&asset, b"image").expect("write asset");
        let values = json!({
            "image_path": asset.display().to_string(),
            "environment": "must-not-be-packaged"
        });
        let value_fields = vec!["image_path".to_string()];
        let asset_fields = vec!["image_path".to_string()];

        let outside_result = save_tool_package_to_root(
            &root,
            "sample",
            &outside
                .join("Outside.flowcell-tool-package.json")
                .display()
                .to_string(),
            ".flowcell-tool-package.json",
            &value_fields,
            &asset_fields,
            &values,
        );
        assert!(outside_result
            .expect_err("outside library must fail")
            .contains("directly inside the package library"));

        let selected = root.join("Sample.flowcell-tool-package.json");
        let saved = save_tool_package_to_root(
            &root,
            "sample",
            &selected.display().to_string(),
            ".flowcell-tool-package.json",
            &value_fields,
            &asset_fields,
            &values,
        )
        .expect("save package");
        assert!(PathBuf::from(&saved).is_file());
        assert!(root.join("Sample/source.png").is_file());
        let manifest: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&saved).expect("read manifest"))
                .expect("parse manifest");
        assert_eq!(manifest["values"]["image_path"], values["image_path"]);
        assert!(manifest["values"].get("environment").is_none());

        let replacement = save_tool_package_to_root(
            &root,
            "sample",
            &selected.display().to_string(),
            ".flowcell-tool-package.json",
            &value_fields,
            &asset_fields,
            &values,
        );
        assert!(replacement
            .expect_err("replacement must fail")
            .contains("already exists"));
        assert_eq!(
            fs::read(root.join("Sample/source.png")).expect("read asset"),
            b"image"
        );

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn failed_staged_save_leaves_no_visible_or_partial_package() {
        let root = temporary_root("staging-cleanup");
        fs::create_dir_all(&root).expect("create root");
        let selected = root.join("Broken.flowcell-tool-package.json");
        let result = save_tool_package_to_root(
            &root,
            "sample",
            &selected.display().to_string(),
            ".flowcell-tool-package.json",
            &["image_path".to_string()],
            &["image_path".to_string()],
            &json!({ "image_path": root.join("missing.png").display().to_string() }),
        );
        assert!(result
            .expect_err("missing asset must fail")
            .contains("was not found"));
        assert!(!root.join("Broken").exists());
        assert!(fs::read_dir(&root)
            .expect("read root")
            .flatten()
            .all(|entry| !entry
                .file_name()
                .to_string_lossy()
                .starts_with(".flowcell-package-staging-")));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn package_listing_never_surfaces_crash_staging_directories() {
        let root = temporary_root("staging-list");
        let committed = root.join("Committed");
        let staging = root.join(".flowcell-package-staging-Hidden-1-1");
        fs::create_dir_all(&committed).expect("create committed");
        fs::create_dir_all(&staging).expect("create staging");
        fs::write(
            committed.join("Committed.flowcell-tool-package.json"),
            r#"{"name":"Committed"}"#,
        )
        .expect("write committed manifest");
        fs::write(
            staging.join("Hidden.flowcell-tool-package.json"),
            r#"{"name":"Hidden"}"#,
        )
        .expect("write staging manifest");

        let packages = list_tool_packages_in_root(&root, ".flowcell-tool-package.json")
            .expect("list packages");
        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0]["name"], "Committed");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn current_package_load_filters_values_and_assets_by_declared_fields() {
        let root = temporary_root("current-load-fields");
        fs::create_dir_all(&root).expect("create root");
        fs::write(root.join("allowed.png"), b"allowed").expect("write allowed asset");
        fs::write(root.join("injected.png"), b"injected").expect("write injected asset");
        let manifest_path = root.join("Current.flowcell-tool-package.json");
        fs::write(
            &manifest_path,
            serde_json::to_string(&json!({
                "format": "flowcell-tool-package/sample/v1",
                "name": "Current",
                "values": {
                    "color": "#ABCDEF",
                    "environment": "must-not-load"
                },
                "assets": {
                    "image_path": "allowed.png",
                    "injected_path": "injected.png"
                }
            }))
            .expect("serialize manifest"),
        )
        .expect("write manifest");

        let loaded = load_tool_package_manifest(
            &manifest_path,
            "sample",
            &[],
            &["color".to_string(), "image_path".to_string()],
            &["image_path".to_string()],
            &[],
            &[],
        )
        .expect("load current package");
        assert_eq!(loaded["values"]["color"], "#ABCDEF");
        assert!(loaded["values"].get("environment").is_none());
        assert!(loaded["assets"].get("image_path").is_some());
        assert!(loaded["assets"].get("injected_path").is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn package_asset_symlink_cannot_escape_its_package_folder() {
        let root = temporary_root("asset-containment");
        let package = root.join("Package");
        let outside = temporary_root("asset-containment-outside");
        fs::create_dir_all(&package).expect("create package");
        fs::create_dir_all(&outside).expect("create outside");
        let outside_asset = outside.join("outside.png");
        fs::write(&outside_asset, b"outside").expect("write outside asset");
        let linked_asset = package.join("linked.png");
        if !try_create_file_symlink(&outside_asset, &linked_asset) {
            let _ = fs::remove_dir_all(&root);
            let _ = fs::remove_dir_all(&outside);
            return;
        }
        let manifest_path = package.join("Package.flowcell-tool-package.json");
        fs::write(
            &manifest_path,
            serde_json::to_string(&json!({
                "format": "flowcell-tool-package/sample/v1",
                "values": { "image_path": "linked.png" },
                "assets": { "image_path": "linked.png" }
            }))
            .expect("serialize manifest"),
        )
        .expect("write manifest");

        let error = load_tool_package_manifest(
            &manifest_path,
            "sample",
            &[],
            &["image_path".to_string()],
            &["image_path".to_string()],
            &[],
            &[],
        )
        .expect_err("escaping symlink must fail");
        assert!(error.contains("inside its package folder"));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn legacy_theme_load_preserves_only_declared_theme_grid_values_and_assets() {
        let root = temporary_root("legacy-theme-load");
        fs::create_dir_all(&root).expect("create root");
        fs::write(root.join("buckets.png"), b"buckets").expect("write buckets asset");
        fs::write(root.join("background.png"), b"background").expect("write background asset");
        let manifest_path = root.join("Legacy.flowcell-theme-pack.json");
        fs::write(
            &manifest_path,
            serde_json::to_string(&json!({
                "format": "flowcell-blender-theme-pack-v1",
                "name": "Legacy",
                "values": {
                    "ThemeTabsHex": "#ABCDEF",
                    "StaticBackgroundPath": "C:/old/background.png",
                    "GridSpacing": "1 m",
                    "GridDistance": "5 m",
                    "GridFarSpacing": "1 m",
                    "WorldStrength": "0.75"
                },
                "bucketsImage": "buckets.png",
                "backgroundImage": "background.png",
                "unknownImage": "background.png"
            }))
            .expect("serialize manifest"),
        )
        .expect("write manifest");

        let loaded = load_tool_package_manifest(
            &manifest_path,
            "blender-theme",
            &["flowcell-blender-theme-pack-v1".to_string()],
            &["tabs_hex".to_string()],
            &["theme_image_path".to_string()],
            &[
                "ThemeTabsHex".to_string(),
                "StaticBackgroundPath".to_string(),
                "GridSpacing".to_string(),
                "GridDistance".to_string(),
                "GridFarSpacing".to_string(),
            ],
            &["bucketsImage".to_string(), "backgroundImage".to_string()],
        )
        .expect("load legacy package");
        assert_eq!(loaded["values"]["ThemeTabsHex"], "#ABCDEF");
        assert_eq!(loaded["values"]["GridSpacing"], "1 m");
        assert_eq!(loaded["values"]["GridDistance"], "5 m");
        assert_eq!(loaded["values"]["GridFarSpacing"], "1 m");
        assert!(loaded["values"].get("WorldStrength").is_none());
        assert!(loaded["assets"].get("bucketsImage").is_some());
        assert!(loaded["assets"].get("backgroundImage").is_some());
        assert!(loaded["assets"].get("unknownImage").is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn tool_field_legacy_formats_are_caller_data_not_program_rules() {
        let root = temporary_root("legacy-field-format");
        fs::create_dir_all(&root).expect("create root");
        let path = root.join("legacy.json");
        fs::write(
            &path,
            r##"{"format":"package-owned-legacy-v1","values":{"color":"#ABCDEF"}}"##,
        )
        .expect("write legacy field file");
        assert!(load_tool_field_file(
            "sample".to_string(),
            path.display().to_string(),
            Vec::new(),
            vec!["color".to_string()],
            vec!["color".to_string()],
        )
        .is_err());
        let loaded = load_tool_field_file(
            "sample".to_string(),
            path.display().to_string(),
            vec!["package-owned-legacy-v1".to_string()],
            vec!["current_color".to_string()],
            vec!["color".to_string()],
        )
        .expect("load declared legacy format");
        assert_eq!(loaded["values"]["color"], "#ABCDEF");
        assert!(loaded["values"].get("current_color").is_none());
        let _ = fs::remove_dir_all(&root);
    }
}
