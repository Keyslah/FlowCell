use super::install::{install_from_path, InstallButtonSourceRequest, InstallButtonSourceResponse};
use super::manifest::{extension_is_allowed, load_program_manifest, ProgramManifest};
use super::records::{atomic_write_json, recover_active_record, ACTIVE_SOURCE_RECORD_SUFFIX};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static LEGACY_BUTTON_BOOTSTRAP_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
const LEGACY_PANEL_ITEM_SUFFIX: &str = ".flowcell-panel-item.json";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyPanelItemRecord {
    label: String,
    #[serde(default)]
    tooltip: String,
    #[serde(default)]
    source_path: String,
    #[serde(default)]
    bridge_action: String,
    #[serde(default)]
    bridge_data: Option<Value>,
    #[serde(default)]
    events: Option<BTreeMap<String, Value>>,
    #[serde(default)]
    execution_target: Option<Value>,
    #[serde(default)]
    macro_id: String,
    #[serde(default)]
    children: Vec<Value>,
}

#[derive(Clone, Debug)]
struct LegacyButtonMetadata {
    label: String,
    tooltip: String,
    bridge_data: Option<Value>,
    events: Option<BTreeMap<String, Value>>,
    execution_target: Option<Value>,
}

fn legacy_button_metadata(
    record: &LegacyPanelItemRecord,
    legacy_path: &Path,
) -> Result<LegacyButtonMetadata, String> {
    if record.label.trim().is_empty() {
        return Err(format!(
            "Legacy panel record {} has no label.",
            legacy_path.display()
        ));
    }
    if !record.macro_id.trim().is_empty() {
        return Err(format!(
            "Legacy panel record {} uses macroId '{}'; migrate it through an explicit canonical package.",
            legacy_path.display(),
            record.macro_id
        ));
    }
    let bridge_data = match record.bridge_data.as_ref() {
        None | Some(Value::Null) => None,
        Some(value) if value.is_object() => Some(value.clone()),
        Some(_) => {
            return Err(format!(
                "Legacy panel record {} has non-object bridgeData.",
                legacy_path.display()
            ))
        }
    };
    let execution_target = match record.execution_target.as_ref() {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) if value.trim().is_empty() => None,
        Some(value) if value.is_object() => Some(value.clone()),
        Some(_) => {
            return Err(format!(
                "Legacy panel record {} has an unsupported executionTarget.",
                legacy_path.display()
            ))
        }
    };
    Ok(LegacyButtonMetadata {
        label: record.label.trim().to_string(),
        tooltip: record.tooltip.trim().to_string(),
        bridge_data,
        events: record.events.clone(),
        execution_target,
    })
}

fn read_legacy_panel_item(path: &Path) -> Result<LegacyPanelItemRecord, String> {
    let mut last_error = String::new();
    for attempt in 0..5 {
        match fs::read_to_string(path) {
            Ok(content) => {
                let content = content.trim_start_matches('\u{feff}');
                if content.trim().is_empty() {
                    last_error = format!("{} is empty.", path.display());
                } else {
                    match serde_json::from_str::<LegacyPanelItemRecord>(content) {
                        Ok(record) => return Ok(record),
                        Err(error) => {
                            last_error = format!("Failed to parse {}: {error}", path.display());
                        }
                    }
                }
            }
            Err(error) => {
                last_error = format!("Failed to read {}: {error}", path.display());
            }
        }
        if attempt < 4 {
            std::thread::sleep(std::time::Duration::from_millis(40));
        }
    }
    Err(last_error)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LegacySourceMigrationRequest {
    pub owner_button_id: String,
    pub program_name: String,
    pub panel_name: String,
    pub file_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LegacySourceMigrationResponse {
    pub migration_token: String,
    pub installs: Vec<InstallButtonSourceResponse>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MigrationJournal {
    schema_version: u32,
    migration_token: String,
    #[serde(default)]
    requests: Vec<LegacySourceMigrationRequest>,
    entries: Vec<MigrationJournalEntry>,
    #[serde(default)]
    installs: Vec<InstallButtonSourceResponse>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MigrationJournalEntry {
    request: LegacySourceMigrationRequest,
    legacy_path: String,
    #[serde(default)]
    legacy_owned_paths: Vec<String>,
    #[serde(default)]
    legacy_binding_paths: Vec<String>,
    legacy_bridge_action: String,
    new_file_name: String,
    new_source_path: String,
}

fn migration_token() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("migration-{}-{}", now.as_secs(), now.subsec_nanos())
}

fn journal_path(token: &str) -> Result<PathBuf, String> {
    Ok(crate::resolve_flowcell_local_root()?
        .join("button-system")
        .join("migrations")
        .join(format!("{token}.json")))
}

fn find_source_manifest_for_action(
    program_name: &str,
    bridge_action: &str,
    legacy_file_name: Option<&str>,
    manifest_file_name: &str,
    package_kind: &str,
) -> Result<Option<PathBuf>, String> {
    if bridge_action.trim().is_empty()
        && legacy_file_name
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
    {
        return Ok(None);
    }
    let manifest = load_program_manifest(program_name)?;
    let root = crate::resolve_program_directory(program_name)?.join(&manifest.git_scripts_folder);
    if !root.is_dir() {
        return Ok(None);
    }
    let mut pending = vec![root];
    let mut matches = Vec::new();
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory)
            .map_err(|error| format!("Failed to read {}: {error}", directory.display()))?
        {
            let entry = entry
                .map_err(|error| format!("Failed to inspect {}: {error}", directory.display()))?;
            let file_type = entry.file_type().map_err(|error| {
                format!("Failed to inspect {}: {error}", entry.path().display())
            })?;
            if file_type.is_dir() {
                pending.push(entry.path());
                continue;
            }
            if !file_type.is_file()
                || !entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(manifest_file_name)
            {
                continue;
            }
            let raw = fs::read_to_string(entry.path())
                .map_err(|error| format!("Failed to read {}: {error}", entry.path().display()))?;
            let document = serde_json::from_str::<Value>(&raw).map_err(|error| {
                format!(
                    "Tool-set manifest {} is invalid: {error}",
                    entry.path().display()
                )
            })?;
            let action_matches = document
                .get("bridgeAction")
                .and_then(Value::as_str)
                .map(|value| value.eq_ignore_ascii_case(bridge_action.trim()))
                .unwrap_or(false);
            let source_matches = legacy_file_name
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .and_then(|legacy| {
                    document
                        .get("source")
                        .and_then(Value::as_str)
                        .and_then(|source| {
                            Path::new(source)
                                .file_name()
                                .and_then(|value| value.to_str())
                        })
                        .map(|source_name| source_name.eq_ignore_ascii_case(legacy))
                })
                .unwrap_or(false);
            if action_matches || source_matches {
                matches.push(entry.path());
            }
        }
    }
    match matches.len() {
        0 => Ok(None),
        1 => Ok(matches.pop()),
        _ => Err(format!(
            "Multiple {package_kind} manifests match bridgeAction '{}' or source '{}'.",
            bridge_action,
            legacy_file_name.unwrap_or_default()
        )),
    }
}

fn find_toolset_manifest_for_action(
    program_name: &str,
    bridge_action: &str,
    legacy_file_name: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    find_source_manifest_for_action(
        program_name,
        bridge_action,
        legacy_file_name,
        "flowcell.toolset.json",
        "tool-set",
    )
}

fn find_script_manifest_for_action(
    program_name: &str,
    bridge_action: &str,
    legacy_file_name: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    find_source_manifest_for_action(
        program_name,
        bridge_action,
        legacy_file_name,
        "flowcell.script.json",
        "script",
    )
}

fn live_blender_source_for_action(action: &str) -> Option<PathBuf> {
    let config = crate::read_blender_bridge_config().ok()?;
    let bridge_root = crate::resolve_blender_bridge_root(&config)?;
    let registry_name = if config.custom_actions_file_name.trim().is_empty() {
        "flowcell_custom_actions.json"
    } else {
        config.custom_actions_file_name.trim()
    };
    let registry_path = bridge_root.join(registry_name);
    let raw = fs::read_to_string(registry_path).ok()?;
    let registry = serde_json::from_str::<Value>(&raw).ok()?;
    let entry = registry.get("actions")?.as_array()?.iter().find(|entry| {
        entry
            .get("action")
            .and_then(Value::as_str)
            .map(|value| value.eq_ignore_ascii_case(action.trim()))
            .unwrap_or(false)
    })?;
    let path = PathBuf::from(entry.get("pythonPath")?.as_str()?);
    path.is_file().then_some(path)
}

fn legacy_directive_value<'a>(line: &'a str, directive: &str) -> Option<&'a str> {
    let trimmed = line.trim_start();
    let body = trimmed
        .strip_prefix('#')
        .or_else(|| trimmed.strip_prefix("//"))
        .or_else(|| trimmed.strip_prefix(';'))
        .or_else(|| trimmed.strip_prefix('\''))?;
    let body = body.trim_start();
    let prefix = body.get(..directive.len())?;
    if !prefix.eq_ignore_ascii_case(directive) {
        return None;
    }
    body[directive.len()..]
        .trim_start()
        .strip_prefix(':')
        .map(str::trim)
}

fn has_legacy_flowcell_children(path: &Path) -> Result<bool, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    Ok(content.lines().any(|line| {
        legacy_directive_value(line, "FLOWCELL_CHILD")
            .map(|value| {
                let fields = value.splitn(3, '|').map(str::trim).collect::<Vec<_>>();
                fields.len() == 3 && !fields[0].is_empty() && !fields[1].is_empty()
            })
            .unwrap_or(false)
    }))
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    let comparable_key = |value: &Path| {
        let absolute = value.canonicalize().unwrap_or_else(|_| {
            let mut cursor = value.to_path_buf();
            let mut missing = Vec::new();
            let mut resolved = None;
            loop {
                if let Ok(existing) = cursor.canonicalize() {
                    resolved = Some(existing);
                    break;
                }
                let Some(file_name) = cursor.file_name().map(|name| name.to_os_string()) else {
                    break;
                };
                missing.push(file_name);
                if !cursor.pop() {
                    break;
                }
            }
            let Some(mut base) = resolved else {
                if value.is_absolute() {
                    return value.to_path_buf();
                } else {
                    return std::env::current_dir().unwrap_or_default().join(value);
                }
            };
            for component in missing.into_iter().rev() {
                base.push(component);
            }
            base
        });
        let mut key = absolute
            .to_string_lossy()
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_ascii_lowercase();
        if let Some(unc) = key.strip_prefix("\\\\?\\unc\\") {
            key = format!("\\\\{unc}");
        } else if let Some(plain) = key.strip_prefix("\\\\?\\") {
            key = plain.to_string();
        }
        key
    };
    let path = comparable_key(path);
    let root = comparable_key(root);
    path == root || path.starts_with(&(root + "\\"))
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    left.to_string_lossy()
        .eq_ignore_ascii_case(&right.to_string_lossy())
}

fn validated_legacy_cleanup_paths(entry: &MigrationJournalEntry) -> Result<Vec<PathBuf>, String> {
    let expected_panel_path =
        crate::resolve_panel_directory(&entry.request.program_name, &entry.request.panel_name)?
            .join(crate::validate_panel_script_file_name(
                &entry.request.file_name,
            )?);
    let legacy_panel_path = PathBuf::from(&entry.legacy_path);
    if !paths_equal(&legacy_panel_path, &expected_panel_path) {
        return Err(format!(
            "Migration journal legacy path does not match its Button identity: {}.",
            legacy_panel_path.display()
        ));
    }
    let manifest = load_program_manifest(&entry.request.program_name)?;
    let local_root = crate::resolve_program_directory(&entry.request.program_name)?
        .join(&manifest.local_scripts_folder);
    let mut paths = vec![legacy_panel_path];
    for value in &entry.legacy_owned_paths {
        let candidate = PathBuf::from(value);
        if !path_is_within(&candidate, &local_root) {
            return Err(format!(
                "Migration journal owned path is outside Local Scripts: {}.",
                candidate.display()
            ));
        }
        if !paths
            .iter()
            .any(|existing| paths_equal(existing, &candidate))
        {
            paths.push(candidate);
        }
    }
    Ok(paths)
}

fn validated_legacy_binding_paths(entry: &MigrationJournalEntry) -> Result<Vec<PathBuf>, String> {
    let program_root = crate::resolve_program_directory(&entry.request.program_name)?;
    let mut paths = validated_legacy_cleanup_paths(entry)?;
    for value in &entry.legacy_binding_paths {
        let candidate = PathBuf::from(value);
        if !path_is_within(&candidate, &program_root) {
            return Err(format!(
                "Migration journal binding alias is outside the program package: {}.",
                candidate.display()
            ));
        }
        if !paths
            .iter()
            .any(|existing| paths_equal(existing, &candidate))
        {
            paths.push(candidate);
        }
    }
    Ok(paths)
}

fn legacy_binding_paths(
    request: &LegacySourceMigrationRequest,
    legacy_path: &Path,
) -> Result<Vec<String>, String> {
    let manifest = load_program_manifest(&request.program_name)?;
    let program_root = crate::resolve_program_directory(&request.program_name)?;
    let file_name = legacy_path
        .file_name()
        .ok_or_else(|| format!("Legacy source has no file name: {}", legacy_path.display()))?;
    let mut paths = vec![
        legacy_path.to_path_buf(),
        program_root
            .join(&manifest.local_scripts_folder)
            .join(file_name),
        program_root
            .join(&manifest.git_scripts_folder)
            .join(&request.panel_name)
            .join(file_name),
    ];
    if request
        .file_name
        .to_ascii_lowercase()
        .ends_with(LEGACY_PANEL_ITEM_SUFFIX)
    {
        let record = read_legacy_panel_item(legacy_path)?;
        let recorded_source = PathBuf::from(record.source_path.trim());
        if !recorded_source.as_os_str().is_empty()
            && path_is_within(&recorded_source, &program_root)
        {
            paths.push(recorded_source);
        }
    }
    paths.sort_by_key(|path| path.to_string_lossy().to_ascii_lowercase());
    paths.dedup_by(|left, right| paths_equal(left, right));
    Ok(paths
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect())
}

fn legacy_local_copy(
    request: &LegacySourceMigrationRequest,
    legacy_path: &Path,
) -> Result<Option<PathBuf>, String> {
    let manifest = load_program_manifest(&request.program_name)?;
    let local_root = crate::resolve_program_directory(&request.program_name)?
        .join(&manifest.local_scripts_folder);
    let Some(file_name) = legacy_path.file_name() else {
        return Ok(None);
    };
    let candidate = local_root.join(file_name);
    if !candidate.is_file() {
        return Ok(None);
    }
    Ok(Some(candidate))
}

fn normalized_legacy_source_stem(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_lowercase())
        .collect()
}

fn unique_flat_local_source_for_panel_record(
    local_root: &Path,
    legacy_panel_path: &Path,
    manifest: &ProgramManifest,
) -> Result<Option<PathBuf>, String> {
    let legacy_file_name = legacy_panel_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            format!(
                "Legacy panel record has no UTF-8 file name: {}.",
                legacy_panel_path.display()
            )
        })?;
    let lowercase_name = legacy_file_name.to_ascii_lowercase();
    let Some(legacy_stem) = lowercase_name.strip_suffix(LEGACY_PANEL_ITEM_SUFFIX) else {
        return Ok(None);
    };
    let expected_stem = normalized_legacy_source_stem(legacy_stem);
    if expected_stem.is_empty() || !local_root.is_dir() {
        return Ok(None);
    }

    let mut matches = Vec::new();
    for entry in fs::read_dir(local_root)
        .map_err(|error| format!("Failed to read {}: {error}", local_root.display()))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to inspect {}: {error}", local_root.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;
        let path = entry.path();
        if !file_type.is_file() || !extension_is_allowed(manifest, &path) {
            continue;
        }
        let source_stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .map(normalized_legacy_source_stem)
            .unwrap_or_default();
        if source_stem == expected_stem {
            matches.push(path);
        }
    }
    matches.sort_by_key(|path| path.to_string_lossy().to_ascii_lowercase());
    match matches.len() {
        0 => Ok(None),
        1 => Ok(matches.pop()),
        _ => Err(format!(
            "Legacy panel record '{}' matches more than one flat Local Scripts source: {}.",
            legacy_panel_path.display(),
            matches
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )),
    }
}

fn catalog_source_for_panel_record(
    program_root: &Path,
    panel_name: &str,
    recorded_source: &Path,
    manifest: &ProgramManifest,
) -> Result<Option<PathBuf>, String> {
    let Some(file_name) = recorded_source.file_name() else {
        return Ok(None);
    };
    let panel_name = crate::validate_folder_name(panel_name, "Panel")?;
    let catalog_root = super::manifest::resolve_manifest_folder(
        program_root,
        &manifest.git_scripts_folder,
        "gitScriptsFolder",
    )?;
    if recorded_source.is_file()
        && path_is_within(recorded_source, &catalog_root)
        && extension_is_allowed(manifest, recorded_source)
    {
        return Ok(Some(recorded_source.to_path_buf()));
    }
    let candidate = catalog_root.join(panel_name).join(file_name);
    Ok((candidate.is_file() && extension_is_allowed(manifest, &candidate)).then_some(candidate))
}

fn choose_legacy_panel_source(
    catalog_source: Option<PathBuf>,
    local_source: Option<PathBuf>,
    bridge_action: &str,
    recorded_source: &Path,
) -> Option<PathBuf> {
    catalog_source
        .or(local_source)
        .or_else(|| live_blender_source_for_action(bridge_action))
        .or_else(|| {
            recorded_source
                .is_file()
                .then(|| recorded_source.to_path_buf())
        })
}

fn prepare_legacy_request(
    request: &LegacySourceMigrationRequest,
) -> Result<
    (
        PathBuf,
        String,
        String,
        Vec<PathBuf>,
        Option<PathBuf>,
        Option<LegacyButtonMetadata>,
    ),
    String,
> {
    let panel_directory =
        crate::resolve_panel_directory(&request.program_name, &request.panel_name)?;
    let file_name = crate::validate_panel_script_file_name(&request.file_name)?;
    if file_name
        .to_ascii_lowercase()
        .ends_with(ACTIVE_SOURCE_RECORD_SUFFIX)
    {
        return Err(format!(
            "'{}' is already a new active source record.",
            file_name
        ));
    }
    let legacy_path = panel_directory.join(&file_name);
    if !legacy_path.is_file() {
        return Err(format!(
            "Legacy source was not found at {}.",
            legacy_path.display()
        ));
    }
    if file_name
        .to_ascii_lowercase()
        .ends_with(LEGACY_PANEL_ITEM_SUFFIX)
    {
        let record = read_legacy_panel_item(&legacy_path)?;
        let metadata = legacy_button_metadata(&record, &legacy_path)?;
        let manifest_rules = load_program_manifest(&request.program_name)?;
        let program_root = crate::resolve_program_directory(&request.program_name)?;
        let local_root = program_root.join(&manifest_rules.local_scripts_folder);
        let recorded_source = PathBuf::from(record.source_path.trim());
        let catalog_source = catalog_source_for_panel_record(
            &program_root,
            &request.panel_name,
            &recorded_source,
            &manifest_rules,
        )?;
        // Old panel metadata could point at another Button's source after a
        // filename collision. The panel record's own deterministic filename is
        // stronger identity evidence, but only when it has one unambiguous flat
        // Local Scripts match.
        let local_source =
            unique_flat_local_source_for_panel_record(&local_root, &legacy_path, &manifest_rules)?
                .or_else(|| {
                    recorded_source
                        .file_name()
                        .map(|file_name| local_root.join(file_name))
                        .filter(|path| path.is_file())
                        .or_else(|| {
                            (recorded_source.is_file()
                                && path_is_within(&recorded_source, &local_root))
                            .then(|| recorded_source.clone())
                        })
                });
        let legacy_owned_paths = local_source.iter().cloned().collect::<Vec<_>>();
        if !record.children.is_empty() {
            let manifest = find_toolset_manifest_for_action(
                &request.program_name,
                &record.bridge_action,
                Path::new(record.source_path.trim())
                    .file_name()
                    .and_then(|value| value.to_str()),
            )?
            .ok_or_else(|| {
                format!(
                    "Tool set '{}' has no flowcell.toolset.json with bridgeAction '{}'.",
                    record.label, record.bridge_action
                )
            })?;
            return Ok((
                manifest,
                "tool-set".to_string(),
                record.bridge_action,
                legacy_owned_paths,
                local_source,
                Some(metadata),
            ));
        }
        let source = choose_legacy_panel_source(
            catalog_source,
            local_source,
            &record.bridge_action,
            &recorded_source,
        )
        .ok_or_else(|| {
            format!(
                "No installed source could be proved for '{}'.",
                record.label
            )
        })?;
        if let Some(manifest) = find_script_manifest_for_action(
            &request.program_name,
            &record.bridge_action,
            source.file_name().and_then(|value| value.to_str()),
        )? {
            return Ok((
                manifest,
                "script".to_string(),
                record.bridge_action,
                legacy_owned_paths,
                Some(source),
                Some(metadata),
            ));
        }
        return Ok((
            source,
            "script".to_string(),
            record.bridge_action,
            legacy_owned_paths,
            None,
            Some(metadata),
        ));
    }
    let legacy_local_copy = legacy_local_copy(request, &legacy_path)?;
    let legacy_owned_paths = legacy_local_copy.iter().cloned().collect::<Vec<_>>();
    if has_legacy_flowcell_children(&legacy_path)? {
        if let Some(manifest) = find_toolset_manifest_for_action(
            &request.program_name,
            "",
            legacy_path.file_name().and_then(|value| value.to_str()),
        )? {
            return Ok((
                manifest,
                "tool-set".to_string(),
                String::new(),
                legacy_owned_paths,
                Some(
                    legacy_local_copy
                        .clone()
                        .unwrap_or_else(|| legacy_path.clone()),
                ),
                None,
            ));
        }
        return Err(format!(
            "Legacy tool set '{}' has no explicit flowcell.toolset.json package.",
            legacy_path.display()
        ));
    }
    Ok((
        legacy_path,
        "script".to_string(),
        String::new(),
        legacy_owned_paths,
        None,
        None,
    ))
}

fn copy_migration_package(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("Failed to create {}: {error}", destination.display()))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("Failed to read {}: {error}", source.display()))?
    {
        let entry =
            entry.map_err(|error| format!("Failed to inspect {}: {error}", source.display()))?;
        let kind = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;
        let target = destination.join(entry.file_name());
        if kind.is_symlink() {
            return Err(format!(
                "Migration package cannot contain symbolic links: {}.",
                entry.path().display()
            ));
        }
        if kind.is_dir() {
            copy_migration_package(&entry.path(), &target)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), &target).map_err(|error| {
                format!(
                    "Failed to copy migration package file {}: {error}",
                    entry.path().display()
                )
            })?;
        }
    }
    Ok(())
}

fn strip_legacy_directives_from_staged_source(path: &Path) -> Result<(), String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let directive_names = ["FLOWCELL_KIND", "FLOWCELL_CHILD", "FLOWCELL_EVENT"];
    if !content.lines().any(|line| {
        directive_names
            .iter()
            .any(|directive| legacy_directive_value(line, directive).is_some())
    }) {
        return Ok(());
    }
    let newline = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let had_trailing_newline = content.ends_with('\n');
    let mut cleaned = content
        .lines()
        .filter(|line| {
            !directive_names
                .iter()
                .any(|directive| legacy_directive_value(line, directive).is_some())
        })
        .collect::<Vec<_>>()
        .join(newline);
    if had_trailing_newline {
        cleaned.push_str(newline);
    }
    fs::write(path, cleaned).map_err(|error| {
        format!(
            "Failed to clean migration source {}: {error}",
            path.display()
        )
    })
}

fn prepare_raw_legacy_script_package(
    source: &Path,
    program_name: &str,
    metadata: &LegacyButtonMetadata,
    staging_root: &Path,
    owner_button_id: &str,
) -> Result<PathBuf, String> {
    if !source.is_file() {
        return Err(format!(
            "Legacy script source was not found: {}.",
            source.display()
        ));
    }
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            format!(
                "Legacy script has no UTF-8 file name: {}.",
                source.display()
            )
        })?;
    let staged_package = staging_root.join(owner_button_id);
    if staged_package.exists() {
        fs::remove_dir_all(&staged_package).map_err(|error| {
            format!(
                "Failed to clear temporary migration package {}: {error}",
                staged_package.display()
            )
        })?;
    }
    fs::create_dir_all(&staged_package)
        .map_err(|error| format!("Failed to create {}: {error}", staged_package.display()))?;
    let staged_source = staged_package.join(file_name);
    fs::copy(source, &staged_source).map_err(|error| {
        format!(
            "Failed to preserve installed script source {}: {error}",
            source.display()
        )
    })?;
    strip_legacy_directives_from_staged_source(&staged_source)?;

    let mut manifest = json!({
        "schemaVersion": 1,
        "id": format!("legacy-migration.{owner_button_id}"),
        "label": metadata.label,
        "tooltip": metadata.tooltip,
        "program": program_name,
        "source": file_name
    });
    let object = manifest
        .as_object_mut()
        .ok_or_else(|| "Generated migration manifest is not an object.".to_string())?;
    if let Some(bridge_data) = metadata.bridge_data.as_ref() {
        object.insert("bridgeData".to_string(), bridge_data.clone());
    }
    if let Some(events) = metadata.events.as_ref() {
        object.insert(
            "events".to_string(),
            serde_json::to_value(events)
                .map_err(|error| format!("Failed to preserve legacy Button events: {error}"))?,
        );
    }
    if let Some(execution_target) = metadata.execution_target.as_ref() {
        object.insert("executionTarget".to_string(), execution_target.clone());
    }
    let manifest_path = staged_package.join("flowcell.script.json");
    atomic_write_json(&manifest_path, &manifest)?;
    Ok(manifest_path)
}

fn prepare_manifest_migration_source(
    manifest_path: &Path,
    installed_source: &Path,
    staging_root: &Path,
    owner_button_id: &str,
) -> Result<PathBuf, String> {
    let package_root = manifest_path.parent().ok_or_else(|| {
        format!(
            "Source manifest has no package folder: {}",
            manifest_path.display()
        )
    })?;
    let raw = fs::read_to_string(manifest_path)
        .map_err(|error| format!("Failed to read {}: {error}", manifest_path.display()))?;
    let document = serde_json::from_str::<Value>(&raw).map_err(|error| {
        format!(
            "Tool-set manifest {} is invalid: {error}",
            manifest_path.display()
        )
    })?;
    let relative_source = document
        .get("source")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Source manifest {} has no source.", manifest_path.display()))?;
    let relative_source_path = PathBuf::from(relative_source);
    if relative_source_path.is_absolute()
        || relative_source_path.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(format!(
            "Source manifest {} has an unsafe source path.",
            manifest_path.display()
        ));
    }
    let staged_package = staging_root.join(owner_button_id);
    if staged_package.exists() {
        fs::remove_dir_all(&staged_package).map_err(|error| {
            format!(
                "Failed to clear temporary migration package {}: {error}",
                staged_package.display()
            )
        })?;
    }
    copy_migration_package(package_root, &staged_package)?;
    let staged_source = staged_package.join(relative_source_path);
    let staged_parent = staged_source.parent().ok_or_else(|| {
        format!(
            "Temporary tool-set source has no parent: {}",
            staged_source.display()
        )
    })?;
    fs::create_dir_all(staged_parent)
        .map_err(|error| format!("Failed to create {}: {error}", staged_parent.display()))?;
    fs::copy(installed_source, &staged_source).map_err(|error| {
        format!(
            "Failed to preserve installed tool-set source {}: {error}",
            installed_source.display()
        )
    })?;
    strip_legacy_directives_from_staged_source(&staged_source)?;
    Ok(
        staged_package.join(manifest_path.file_name().ok_or_else(|| {
            format!(
                "Source manifest has no file name: {}",
                manifest_path.display()
            )
        })?),
    )
}

fn stable_migration_owner_id(program_name: &str, panel_name: &str, file_name: &str) -> String {
    // FNV-1a keeps the ID deterministic without making a filename or a legacy
    // classifier part of the active runtime contract.
    let identity = format!(
        "{}\0{}\0{}",
        program_name.trim().to_lowercase(),
        panel_name.trim().to_lowercase(),
        file_name.trim().to_lowercase()
    );
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in identity.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("button-migrated-{hash:016x}")
}

fn discover_legacy_button_sources() -> Result<Vec<LegacySourceMigrationRequest>, String> {
    let mut requests = Vec::new();
    let mut owner_ids = HashSet::new();
    for program_name in crate::list_program_folders()? {
        let manifest = load_program_manifest(&program_name)?;
        for panel_name in crate::list_panel_folders(program_name.clone())? {
            let panel_directory = crate::resolve_panel_directory(&program_name, &panel_name)?;
            let mut files = Vec::new();
            for entry in fs::read_dir(&panel_directory)
                .map_err(|error| format!("Failed to read {}: {error}", panel_directory.display()))?
            {
                let entry = entry.map_err(|error| {
                    format!("Failed to inspect {}: {error}", panel_directory.display())
                })?;
                let kind = entry.file_type().map_err(|error| {
                    format!("Failed to inspect {}: {error}", entry.path().display())
                })?;
                if !kind.is_file() {
                    continue;
                }
                let path = entry.path();
                let file_name = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                let is_legacy_source = if file_name.ends_with(ACTIVE_SOURCE_RECORD_SUFFIX) {
                    false
                } else if manifest.runner.kind == "blender-bridge" {
                    file_name.ends_with(LEGACY_PANEL_ITEM_SUFFIX)
                } else {
                    super::manifest::extension_is_allowed(&manifest, &path)
                };
                if is_legacy_source {
                    files.push(path);
                }
            }
            files.sort_by_key(|path| {
                path.file_name()
                    .map(|value| value.to_string_lossy().to_ascii_lowercase())
                    .unwrap_or_default()
            });
            for path in files {
                let file_name = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .ok_or_else(|| {
                        format!("Legacy Button path has no file name: {}", path.display())
                    })?
                    .to_string();
                let owner_button_id =
                    stable_migration_owner_id(&program_name, &panel_name, &file_name);
                if !owner_ids.insert(owner_button_id.clone()) {
                    return Err(format!(
                        "Legacy Button identities produced duplicate owner ID '{owner_button_id}'."
                    ));
                }
                requests.push(LegacySourceMigrationRequest {
                    owner_button_id,
                    program_name: program_name.clone(),
                    panel_name: panel_name.clone(),
                    file_name,
                });
            }
        }
    }
    Ok(requests)
}

fn pending_migration_journals() -> Result<Vec<MigrationJournal>, String> {
    let button_system_root = crate::resolve_flowcell_local_root()?.join("button-system");
    let directory = button_system_root.join("migrations");
    let mut paths = Vec::new();
    if directory.is_dir() {
        for entry in fs::read_dir(&directory)
            .map_err(|error| format!("Failed to read {}: {error}", directory.display()))?
        {
            let entry = entry
                .map_err(|error| format!("Failed to inspect {}: {error}", directory.display()))?;
            let kind = entry.file_type().map_err(|error| {
                format!("Failed to inspect {}: {error}", entry.path().display())
            })?;
            let path = entry.path();
            if kind.is_file()
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(|value| value.eq_ignore_ascii_case("json"))
                    .unwrap_or(false)
            {
                paths.push(path);
            }
        }
    }
    let quarantine = button_system_root.join("quarantine");
    if quarantine.is_dir() {
        for entry in fs::read_dir(&quarantine)
            .map_err(|error| format!("Failed to read {}: {error}", quarantine.display()))?
        {
            let entry = entry
                .map_err(|error| format!("Failed to inspect {}: {error}", quarantine.display()))?;
            let kind = entry.file_type().map_err(|error| {
                format!("Failed to inspect {}: {error}", entry.path().display())
            })?;
            if kind.is_dir()
                && entry
                    .file_name()
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .starts_with("finalize-migration-")
            {
                let journal = entry.path().join("migration-journal.json");
                if journal.is_file() {
                    paths.push(journal);
                }
            }
        }
    }
    paths.sort_by_key(|path| {
        path.file_name()
            .map(|value| value.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default()
    });
    paths
        .into_iter()
        .map(|path| {
            let raw = fs::read_to_string(&path)
                .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
            let journal = serde_json::from_str::<MigrationJournal>(&raw).map_err(|error| {
                format!("Migration journal {} is invalid: {error}", path.display())
            })?;
            if journal.schema_version != 1 || journal.migration_token.trim().is_empty() {
                return Err(format!(
                    "Migration journal {} has an invalid identity.",
                    path.display()
                ));
            }
            Ok(journal)
        })
        .collect()
}

fn empty_migration_work_directories(button_system_root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut empty = Vec::new();
    for name in ["migrations", "migration-staging", "quarantine"] {
        let path = button_system_root.join(name);
        if !path.is_dir() {
            continue;
        }
        let mut entries = fs::read_dir(&path)
            .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
        if entries.next().is_none() {
            empty.push(path);
        }
    }
    Ok(empty)
}

fn recycle_empty_migration_work_directories() -> Result<(), String> {
    let root = crate::resolve_flowcell_local_root()?.join("button-system");
    let empty = empty_migration_work_directories(&root)?;
    if empty.is_empty() {
        return Ok(());
    }
    crate::recycle_directory_paths(&empty)
}

fn journal_installs(
    journal: &MigrationJournal,
) -> Result<Vec<InstallButtonSourceResponse>, String> {
    if !journal.installs.is_empty() {
        return Ok(journal.installs.clone());
    }
    journal
        .entries
        .iter()
        .map(|entry| {
            let resolution = super::execute::resolve_active_source_record(
                &entry.request.program_name,
                &entry.request.panel_name,
                &entry.new_file_name,
            )?
            .ok_or_else(|| {
                format!(
                    "Pending migration '{}' is missing its owned active record.",
                    journal.migration_token
                )
            })?;
            Ok(super::install::build_response(
                &resolution.record,
                resolution.file_name,
            ))
        })
        .collect()
}

fn journal_is_represented_in_state(
    journal: &MigrationJournal,
    state: &Value,
) -> Result<bool, String> {
    let Some(buttons) = state.get("buttons").and_then(Value::as_object) else {
        return Ok(false);
    };
    for install in journal_installs(journal)? {
        let Some(button) = buttons.get(&install.owner_button_id) else {
            return Ok(false);
        };
        let Some(identity) = button.get("sourceIdentity").and_then(Value::as_object) else {
            return Ok(false);
        };
        let matches = [
            (
                "displayProgramName",
                install.source_identity.program_name.as_str(),
            ),
            (
                "displayPanelName",
                install.source_identity.panel_name.as_str(),
            ),
            (
                "displayFileName",
                install.source_identity.file_name.as_str(),
            ),
        ]
        .iter()
        .all(|(field, expected)| {
            identity
                .get(*field)
                .and_then(Value::as_str)
                .map(|value| value.eq_ignore_ascii_case(expected))
                .unwrap_or(false)
        });
        if !matches {
            return Ok(false);
        }
    }
    Ok(true)
}

#[tauri::command]
pub(crate) fn prepare_legacy_button_bootstrap(
) -> Result<Option<LegacySourceMigrationResponse>, String> {
    let lock = LEGACY_BUTTON_BOOTSTRAP_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Legacy Button bootstrap lock is poisoned.".to_string())?;

    let state = crate::button_state::load_button_state()?;
    let mut pending = pending_migration_journals()?;
    if pending.len() > 1 {
        return Err("More than one legacy Button migration is pending; refusing to guess which transaction owns canonical state.".to_string());
    }
    if let Some(pending_journal) = pending.pop() {
        let journal = if migration_is_complete(&pending_journal)? {
            pending_journal
        } else {
            resume_migration(pending_journal)?
        };
        if state
            .as_ref()
            .map(|document| journal_is_represented_in_state(&journal, document))
            .transpose()?
            .unwrap_or(false)
        {
            finalize_migration_token(&journal.migration_token)?;
        } else {
            return Ok(Some(LegacySourceMigrationResponse {
                migration_token: journal.migration_token.clone(),
                installs: journal_installs(&journal)?,
            }));
        }
    }

    // Canonical state itself is the durable completion boundary. Once it
    // exists and no migration journal is pending, normal startup must not
    // rediscover or interpret legacy panel files.
    if state.is_some() {
        recycle_empty_migration_work_directories()?;
        return Ok(None);
    }

    let requests = discover_legacy_button_sources()?;
    if requests.is_empty() {
        return Ok(None);
    }
    migrate_legacy_button_sources_unlocked(requests).map(Some)
}

fn migration_is_complete(journal: &MigrationJournal) -> Result<bool, String> {
    if journal.requests.is_empty() {
        return Ok(!journal.entries.is_empty()
            && journal.entries.len() == journal_installs(journal)?.len());
    }
    Ok(journal.entries.len() == journal.requests.len()
        && journal.installs.len() == journal.requests.len())
}

fn resume_migration(mut journal: MigrationJournal) -> Result<MigrationJournal, String> {
    if journal.requests.is_empty() {
        if migration_is_complete(&journal)? {
            return Ok(journal);
        }
        return Err(format!(
            "Pending migration '{}' has no resumable request inventory.",
            journal.migration_token
        ));
    }
    let journal_file = journal_path(&journal.migration_token)?;
    let staging_root = crate::resolve_flowcell_local_root()?
        .join("button-system")
        .join("migration-staging")
        .join(&journal.migration_token);
    let requests = journal.requests.clone();
    for request in requests {
        if journal.installs.iter().any(|install| {
            install
                .owner_button_id
                .eq_ignore_ascii_case(&request.owner_button_id)
        }) {
            continue;
        }
        let (
            source,
            import_kind,
            old_action,
            legacy_owned_paths,
            installed_source_override,
            legacy_metadata,
        ) = prepare_legacy_request(&request)?;
        let legacy_path =
            crate::resolve_panel_directory(&request.program_name, &request.panel_name)?
                .join(crate::validate_panel_script_file_name(&request.file_name)?);
        let active_file_name = super::records::active_record_file_name(&request.owner_button_id);
        let active_path =
            crate::resolve_panel_directory(&request.program_name, &request.panel_name)?
                .join(&active_file_name);
        recover_active_record(&active_path)?;
        let response = if active_path.is_file() {
            let resolution = super::execute::resolve_active_source_record(
                &request.program_name,
                &request.panel_name,
                &active_file_name,
            )?
            .ok_or_else(|| "Pending migration active source could not be resolved.".to_string())?;
            if !resolution
                .record
                .owner_button_id
                .eq_ignore_ascii_case(&request.owner_button_id)
            {
                return Err(format!(
                    "Pending migration owner '{}' conflicts with an active source.",
                    request.owner_button_id
                ));
            }
            super::install::build_response(&resolution.record, resolution.file_name)
        } else {
            let manifest = load_program_manifest(&request.program_name)?;
            let orphan_package = crate::resolve_program_directory(&request.program_name)?
                .join(&manifest.local_scripts_folder)
                .join(&request.owner_button_id);
            if orphan_package.is_dir() {
                crate::recycle_directory_path(&orphan_package)?;
            }
            let install_source = if let Some(installed_source) = installed_source_override.as_ref()
            {
                prepare_manifest_migration_source(
                    &source,
                    installed_source,
                    &staging_root,
                    &request.owner_button_id,
                )?
            } else if let Some(metadata) = legacy_metadata.as_ref() {
                prepare_raw_legacy_script_package(
                    &source,
                    &request.program_name,
                    metadata,
                    &staging_root,
                    &request.owner_button_id,
                )?
            } else {
                source.clone()
            };
            let result = install_from_path(
                InstallButtonSourceRequest {
                    owner_button_id: request.owner_button_id.clone(),
                    program_name: request.program_name.clone(),
                    panel_name: request.panel_name.clone(),
                    source_path: install_source.to_string_lossy().to_string(),
                    import_kind,
                    bundled_source_id: None,
                    bundled_source_version: None,
                },
                false,
            );
            let owner_staging = staging_root.join(&request.owner_button_id);
            if owner_staging.is_dir() {
                let _ = fs::remove_dir_all(&owner_staging);
            }
            result?
        };
        let new_record = super::execute::resolve_active_source_record(
            &response.source_identity.program_name,
            &response.source_identity.panel_name,
            &response.source_identity.file_name,
        )?
        .ok_or_else(|| "Migration did not produce an active source record.".to_string())?;
        let binding_paths = legacy_binding_paths(&request, &legacy_path)?;
        journal.entries.push(MigrationJournalEntry {
            request,
            legacy_path: legacy_path.to_string_lossy().to_string(),
            legacy_owned_paths: legacy_owned_paths
                .into_iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect(),
            legacy_binding_paths: binding_paths,
            legacy_bridge_action: old_action,
            new_file_name: response.source_identity.file_name.clone(),
            new_source_path: new_record.record.source_path,
        });
        journal.installs.push(response);
        super::records::atomic_replace_json(&journal_file, &journal)?;
    }
    if staging_root.is_dir() {
        let _ = fs::remove_dir_all(&staging_root);
    }
    if !migration_is_complete(&journal)? {
        return Err(format!(
            "Migration '{}' did not install every discovered Button source.",
            journal.migration_token
        ));
    }
    Ok(journal)
}

fn migrate_legacy_button_sources_unlocked(
    requests: Vec<LegacySourceMigrationRequest>,
) -> Result<LegacySourceMigrationResponse, String> {
    if requests.is_empty() {
        return Err("No legacy Button sources were supplied for migration.".to_string());
    }
    let mut owner_ids = HashSet::new();
    for request in &requests {
        let owner = super::validate_owner_button_id(&request.owner_button_id)?;
        if !owner_ids.insert(owner.to_ascii_lowercase()) {
            return Err(format!(
                "Legacy migration contains duplicate owner '{}'.",
                request.owner_button_id
            ));
        }
    }
    let token = migration_token();
    let journal = MigrationJournal {
        schema_version: 1,
        migration_token: token.clone(),
        requests,
        entries: Vec::new(),
        installs: Vec::new(),
    };
    atomic_write_json(&journal_path(&token)?, &journal)?;
    let journal = resume_migration(journal)?;
    Ok(LegacySourceMigrationResponse {
        migration_token: token,
        installs: journal_installs(&journal)?,
    })
}

fn update_migrated_bindings(entries: &[MigrationJournalEntry]) -> Result<Option<String>, String> {
    let (_state, mut document, bindings_path) = crate::read_bindings_file_state()?;
    let backup =
        if bindings_path.is_file() {
            Some(fs::read_to_string(&bindings_path).map_err(|error| {
                format!("Failed to back up {}: {error}", bindings_path.display())
            })?)
        } else {
            None
        };
    let mut changed = false;
    for section in document.values_mut() {
        let Some(script_path) = section.get_mut("ScriptPath") else {
            continue;
        };
        for entry in entries {
            let legacy_paths = validated_legacy_binding_paths(entry)?;
            if legacy_paths
                .iter()
                .any(|legacy_path| paths_equal(Path::new(script_path.as_str()), legacy_path))
            {
                *script_path = entry.new_source_path.clone();
                changed = true;
                break;
            }
        }
    }
    if changed {
        crate::write_bindings_file_state(&bindings_path, &document)?;
        crate::restart_flowcell_headless_backend()?;
    }
    Ok(backup)
}

fn action_is_still_referenced(
    entry: &MigrationJournalEntry,
    entries: &[MigrationJournalEntry],
) -> Result<bool, String> {
    if entry.legacy_bridge_action.trim().is_empty()
        || !entry.request.program_name.eq_ignore_ascii_case("Blender")
    {
        return Ok(false);
    }
    let migrated_paths = entries
        .iter()
        .map(|value| PathBuf::from(&value.legacy_path))
        .collect::<Vec<_>>();
    let panels_root = crate::resolve_program_directory(&entry.request.program_name)?.join("Panels");
    if !panels_root.is_dir() {
        return Ok(false);
    }
    let mut pending = vec![panels_root];
    while let Some(directory) = pending.pop() {
        for candidate in fs::read_dir(&directory)
            .map_err(|error| format!("Failed to read {}: {error}", directory.display()))?
        {
            let candidate = candidate
                .map_err(|error| format!("Failed to inspect {}: {error}", directory.display()))?;
            if candidate.path().is_dir() {
                pending.push(candidate.path());
                continue;
            }
            if migrated_paths.iter().any(|path| path == &candidate.path())
                || !candidate
                    .file_name()
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .ends_with(LEGACY_PANEL_ITEM_SUFFIX)
            {
                continue;
            }
            let record = read_legacy_panel_item(&candidate.path())?;
            if record
                .bridge_action
                .eq_ignore_ascii_case(entry.legacy_bridge_action.trim())
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn cleanup_unreferenced_legacy_actions(entries: &[MigrationJournalEntry]) -> Result<(), String> {
    let mut cleaned = Vec::<String>::new();
    for entry in entries {
        let action = entry.legacy_bridge_action.trim();
        if action.is_empty()
            || !entry.request.program_name.eq_ignore_ascii_case("Blender")
            || cleaned
                .iter()
                .any(|value| value.eq_ignore_ascii_case(action))
            || action_is_still_referenced(entry, entries)?
        {
            continue;
        }
        let manifest = load_program_manifest(&entry.request.program_name)?;
        let helper = crate::resolve_program_directory(&entry.request.program_name)?
            .join(&manifest.support_scripts_folder)
            .join(&manifest.runner.delete_script);
        let arguments = vec![
            "-File".to_string(),
            helper.to_string_lossy().to_string(),
            "-ButtonTarget".to_string(),
            format!("action:{action}"),
        ];
        let output = crate::spawn_powershell_output(&arguments)?;
        if !output.status.success() {
            return Err(crate::format_process_failure(
                &output,
                &format!("Legacy Blender action cleanup failed for '{action}'."),
            ));
        }
        cleaned.push(action.to_string());
    }
    Ok(())
}

pub(crate) fn finalize_migration_token(token: &str) -> Result<usize, String> {
    let token = token.trim();
    if token.is_empty()
        || !token
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-')
    {
        return Err("Migration token is invalid.".to_string());
    }
    let path = journal_path(token)?;
    let quarantine_root = crate::resolve_flowcell_local_root()?
        .join("button-system")
        .join("quarantine")
        .join(format!("finalize-{token}"));
    let journal_target = quarantine_root.join("migration-journal.json");
    let journal_source = if path.is_file() {
        path.clone()
    } else if journal_target.is_file() {
        journal_target.clone()
    } else {
        return Err(format!(
            "Migration journal for token '{token}' was not found."
        ));
    };
    let raw = fs::read_to_string(&journal_source)
        .map_err(|error| format!("Failed to read {}: {error}", journal_source.display()))?;
    let journal = serde_json::from_str::<MigrationJournal>(&raw).map_err(|error| {
        format!(
            "Migration journal {} is invalid: {error}",
            journal_source.display()
        )
    })?;
    if journal.schema_version != 1 || journal.migration_token != token {
        return Err("Migration journal identity is invalid.".to_string());
    }
    let bindings_path = crate::resolve_bindings_file_path()?;
    let bindings_backup = update_migrated_bindings(&journal.entries)?;
    fs::create_dir_all(&quarantine_root)
        .map_err(|error| format!("Failed to create {}: {error}", quarantine_root.display()))?;
    let mut moved = Vec::<(PathBuf, PathBuf)>::new();
    let mut cleanup_index = 0usize;
    for entry in &journal.entries {
        for legacy_path in validated_legacy_cleanup_paths(entry)? {
            let target = quarantine_root.join(format!(
                "legacy-{cleanup_index}-{}",
                legacy_path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("source")
            ));
            cleanup_index += 1;
            if target.is_file() {
                if legacy_path.exists() {
                    for (original, quarantined) in moved.iter().rev() {
                        if !original.exists() && quarantined.exists() {
                            let _ = fs::rename(quarantined, original);
                        }
                    }
                    if let Some(backup) = bindings_backup.as_ref() {
                        let _ = fs::write(&bindings_path, backup);
                        let _ = crate::restart_flowcell_headless_backend();
                    }
                    return Err(format!(
                        "Migration finalization found both source and quarantine copies for {}.",
                        legacy_path.display()
                    ));
                }
                moved.push((legacy_path, target));
                continue;
            }
            if !legacy_path.is_file() {
                continue;
            }
            if let Err(error) = fs::rename(&legacy_path, &target) {
                for (original, quarantined) in moved.iter().rev() {
                    if !original.exists() && quarantined.exists() {
                        let _ = fs::rename(quarantined, original);
                    }
                }
                if let Some(backup) = bindings_backup.as_ref() {
                    let _ = fs::write(&bindings_path, backup);
                    let _ = crate::restart_flowcell_headless_backend();
                }
                let _ = fs::remove_dir(&quarantine_root);
                return Err(format!(
                    "Failed to quarantine {}: {error}",
                    legacy_path.display()
                ));
            }
            moved.push((legacy_path, target));
        }
    }
    if journal_source != journal_target {
        if journal_target.exists() {
            for (original, quarantined) in moved.iter().rev() {
                if !original.exists() && quarantined.exists() {
                    let _ = fs::rename(quarantined, original);
                }
            }
            if let Some(backup) = bindings_backup.as_ref() {
                let _ = fs::write(&bindings_path, backup);
                let _ = crate::restart_flowcell_headless_backend();
            }
            return Err(format!(
                "Migration finalization found two journals for token '{token}'."
            ));
        }
        if let Err(error) = fs::rename(&journal_source, &journal_target) {
            for (original, quarantined) in moved.iter().rev() {
                if !original.exists() && quarantined.exists() {
                    let _ = fs::rename(quarantined, original);
                }
            }
            if let Some(backup) = bindings_backup.as_ref() {
                let _ = fs::write(&bindings_path, backup);
                let _ = crate::restart_flowcell_headless_backend();
            }
            let _ = fs::remove_dir(&quarantine_root);
            return Err(format!(
                "Failed to quarantine {}: {error}",
                journal_source.display()
            ));
        }
    }
    if let Err(error) = cleanup_unreferenced_legacy_actions(&journal.entries) {
        if !path.exists() && journal_target.exists() {
            let _ = fs::rename(&journal_target, &path);
        }
        for (original, quarantined) in moved.iter().rev() {
            if !original.exists() && quarantined.exists() {
                let _ = fs::rename(quarantined, original);
            }
        }
        if let Some(backup) = bindings_backup.as_ref() {
            let _ = fs::write(&bindings_path, backup);
            let _ = crate::restart_flowcell_headless_backend();
        }
        let _ = fs::remove_dir(&quarantine_root);
        return Err(error);
    }
    if let Err(error) = crate::recycle_directory_path(&quarantine_root) {
        if !path.exists() && journal_target.exists() {
            let _ = fs::rename(&journal_target, &path);
        }
        for (original, quarantined) in moved.iter().rev() {
            if !original.exists() && quarantined.exists() {
                let _ = fs::rename(quarantined, original);
            }
        }
        if let Some(backup) = bindings_backup.as_ref() {
            let _ = fs::write(&bindings_path, backup);
            let _ = crate::restart_flowcell_headless_backend();
        }
        return Err(error);
    }
    Ok(moved.len())
}

#[cfg(test)]
mod tests {
    use super::{
        catalog_source_for_panel_record, choose_legacy_panel_source,
        discover_legacy_button_sources, empty_migration_work_directories, legacy_button_metadata,
        path_is_within, prepare_legacy_request, prepare_raw_legacy_script_package,
        read_legacy_panel_item, stable_migration_owner_id,
        strip_legacy_directives_from_staged_source, unique_flat_local_source_for_panel_record,
    };
    use crate::program_sources::manifest::{ProgramManifest, ProgramRunnerManifest};
    use serde_json::Value;
    use std::fs;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn migration_owner_id_is_stable_and_case_insensitive() {
        let first = stable_migration_owner_id("Blender", "Collections", "Cycle.py");
        let same = stable_migration_owner_id("blender", "collections", "cycle.PY");
        let other = stable_migration_owner_id("Blender", "Files", "Cycle.py");
        assert_eq!(first, same);
        assert_ne!(first, other);
        assert!(first.starts_with("button-migrated-"));
    }

    #[test]
    fn missing_legacy_aliases_compare_inside_canonical_program_roots() {
        let program_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join("Programs")
            .join("Illustrator");
        let missing_alias = program_root
            .join("Illustrator Git Scripts")
            .join("Toolset")
            .join("missing-legacy-alias.jsx");
        assert!(program_root.is_dir());
        assert!(!missing_alias.exists());
        assert!(path_is_within(&missing_alias, &program_root));
        assert!(!path_is_within(
            &program_root.join("..").join("Blender").join("source.py"),
            &program_root
        ));
    }

    #[test]
    fn panel_record_filename_selects_one_exact_flat_local_source() {
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("flowcell-flat-source-match-{token}"));
        fs::create_dir_all(&root).expect("create flat Local Scripts root");
        let expected = root.join("cycle versions back.py");
        fs::write(&expected, "print('back')\n").expect("write matching source");
        fs::write(root.join("cycle versions forward.py"), "print('forward')\n")
            .expect("write non-matching source");
        let manifest = ProgramManifest {
            schema_version: 1,
            program_id: "blender".to_string(),
            label: "Blender".to_string(),
            program_type: "bridge".to_string(),
            default_panels: vec!["Files".to_string()],
            process_names: vec!["blender".to_string()],
            exe_path: String::new(),
            bind_scoped_native_owner: false,
            shortcut_profile_id: "blender.windows".to_string(),
            git_scripts_folder: "Blender Git Scripts".to_string(),
            panels_folder: "Panels".to_string(),
            local_scripts_folder: "Blender Local Scripts".to_string(),
            support_scripts_folder: "SupportScripts".to_string(),
            allowed_script_extensions: vec!["py".to_string()],
            allowed_manifest_file_names: Vec::new(),
            supports_toolset_manifests: true,
            bundled_sources: Vec::new(),
            runner: ProgramRunnerManifest {
                kind: "blender-bridge".to_string(),
                program_key: String::new(),
                install_script: String::new(),
                delete_script: String::new(),
                capability_script: String::new(),
            },
            addon_reload_notes: String::new(),
            app_restart_notes: String::new(),
        };
        let panel_record = root.join("cycle_versions_back.flowcell-panel-item.json");
        let result = unique_flat_local_source_for_panel_record(&root, &panel_record, &manifest)
            .expect("match flat source");
        assert_eq!(result, Some(expected));

        fs::write(root.join("cycle-versions-back.py"), "print('duplicate')\n")
            .expect("write ambiguous source");
        assert!(
            unique_flat_local_source_for_panel_record(&root, &panel_record, &manifest).is_err()
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn panel_catalog_source_precedes_same_named_flat_local_copy() {
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("flowcell-catalog-precedence-{token}"));
        let catalog_root = root.join("Illustrator Git Scripts").join("Layers Builder");
        let local_root = root.join("Illustrator Local Scripts");
        fs::create_dir_all(&catalog_root).expect("create catalog panel");
        fs::create_dir_all(&local_root).expect("create flat local root");
        let catalog_source = catalog_root.join("make layers.jsx");
        let local_source = local_root.join("make layers.jsx");
        fs::write(&catalog_source, "// FlowCell-highlighted layers\n")
            .expect("write catalog source");
        fs::write(&local_source, "// stale flat copy\n").expect("write local source");
        let manifest = ProgramManifest {
            schema_version: 1,
            program_id: "illustrator".to_string(),
            label: "Illustrator".to_string(),
            program_type: "direct-script".to_string(),
            default_panels: vec!["Layers Builder".to_string()],
            process_names: vec!["illustrator".to_string()],
            exe_path: String::new(),
            bind_scoped_native_owner: true,
            shortcut_profile_id: "adobe.illustrator.windows".to_string(),
            git_scripts_folder: "Illustrator Git Scripts".to_string(),
            panels_folder: "Panels".to_string(),
            local_scripts_folder: "Illustrator Local Scripts".to_string(),
            support_scripts_folder: "SupportScripts".to_string(),
            allowed_script_extensions: vec!["jsx".to_string()],
            allowed_manifest_file_names: vec!["flowcell.script.json".to_string()],
            supports_toolset_manifests: true,
            bundled_sources: Vec::new(),
            runner: ProgramRunnerManifest {
                kind: "illustrator-direct".to_string(),
                program_key: "illustrator_automation".to_string(),
                install_script: String::new(),
                delete_script: String::new(),
                capability_script: String::new(),
            },
            addon_reload_notes: String::new(),
            app_restart_notes: String::new(),
        };

        let resolved_catalog =
            catalog_source_for_panel_record(&root, "Layers Builder", &local_source, &manifest)
                .expect("resolve catalog source");
        let selected = choose_legacy_panel_source(
            resolved_catalog,
            Some(local_source),
            "",
            Path::new("missing.jsx"),
        )
        .expect("select legacy source");
        assert_eq!(selected, catalog_source);
        assert!(fs::read_to_string(selected)
            .expect("read selected source")
            .contains("FlowCell-highlighted"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn raw_legacy_script_package_preserves_button_metadata() {
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("flowcell-legacy-metadata-{token}"));
        fs::create_dir_all(&root).expect("create migration metadata root");
        let source = root.join("snap.py");
        fs::write(&source, "print('snap')\n").expect("write shared source");
        let record_path = root.join("active.flowcell-panel-item.json");
        fs::write(
            &record_path,
            r#"{
                "label": "Active",
                "tooltip": "Toggle Active snap.",
                "sourcePath": "snap.py",
                "bridgeAction": "flowcell_custom_snap",
                "bridgeData": { "command": "active" },
                "events": { "hoverEnter": { "type": "blenderBridge", "action": "probe" } },
                "executionTarget": "",
                "macroId": "",
                "children": []
            }"#,
        )
        .expect("write legacy panel record");
        let record = read_legacy_panel_item(&record_path).expect("read legacy panel record");
        let metadata = legacy_button_metadata(&record, &record_path).expect("read metadata");
        let manifest_path = prepare_raw_legacy_script_package(
            &source,
            "Blender",
            &metadata,
            &root.join("staging"),
            "button-test-snap",
        )
        .expect("stage raw legacy package");
        let manifest: Value = serde_json::from_str(
            &fs::read_to_string(&manifest_path).expect("read generated manifest"),
        )
        .expect("parse generated manifest");
        assert_eq!(manifest["label"], "Active");
        assert_eq!(manifest["tooltip"], "Toggle Active snap.");
        assert_eq!(manifest["source"], "snap.py");
        assert_eq!(manifest["bridgeData"]["command"], "active");
        assert_eq!(manifest["events"]["hoverEnter"]["action"], "probe");
        assert_eq!(
            fs::read_to_string(manifest_path.parent().unwrap().join("snap.py"))
                .expect("read staged source"),
            "print('snap')\n"
        );

        fs::write(
            &record_path,
            r#"{
                "label": "Plain",
                "sourcePath": "plain.py",
                "children": []
            }"#,
        )
        .expect("write record without optional metadata");
        let plain = read_legacy_panel_item(&record_path).expect("read plain record");
        let plain_metadata = legacy_button_metadata(&plain, &record_path).expect("plain metadata");
        assert!(plain_metadata.bridge_data.is_none());
        assert!(plain_metadata.events.is_none());
        assert!(plain_metadata.execution_target.is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn migration_work_cleanup_selects_only_empty_directories() {
        let root = std::env::temp_dir().join(format!(
            "flowcell-migration-workdirs-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        for name in ["migrations", "migration-staging", "quarantine"] {
            fs::create_dir_all(root.join(name)).expect("create work directory");
        }
        fs::write(root.join("quarantine/active-transaction"), "keep")
            .expect("write active transaction marker");
        let selected = empty_migration_work_directories(&root).expect("find empty work dirs");
        assert_eq!(selected.len(), 2);
        assert!(selected.contains(&root.join("migrations")));
        assert!(selected.contains(&root.join("migration-staging")));
        assert!(!selected.contains(&root.join("quarantine")));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn staged_source_cleanup_removes_only_legacy_directive_comments() {
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("flowcell-migration-directives-{token}.py"));
        fs::write(
            &path,
            "# Description: keep this\n# FLOWCELL_KIND: old\n# FLOWCELL_CHILD: a | A | old\nprint('FLOWCELL_CHILD: runtime text stays')\n",
        )
        .expect("write staged source");
        strip_legacy_directives_from_staged_source(&path).expect("strip legacy directives");
        let cleaned = fs::read_to_string(&path).expect("read cleaned source");
        let _ = fs::remove_file(&path);
        assert!(cleaned.contains("# Description: keep this"));
        assert!(cleaned.contains("runtime text stays"));
        assert!(!cleaned.contains("# FLOWCELL_KIND"));
        assert!(!cleaned.contains("# FLOWCELL_CHILD"));
    }

    #[test]
    fn discovered_legacy_inventory_has_a_provable_migration_source() {
        let Ok(requests) = discover_legacy_button_sources() else {
            // Unit-test binaries outside a FlowCell checkout do not have a
            // program registry to inventory.
            return;
        };
        for request in requests {
            prepare_legacy_request(&request).unwrap_or_else(|error| {
                panic!(
                    "Legacy source {}/{}/{} is not migratable: {error}",
                    request.program_name, request.panel_name, request.file_name
                )
            });
        }
    }
}
