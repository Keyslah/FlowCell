use super::manifest::load_program_manifest;
use super::records::{
    active_record_file_name, read_active_record, validate_owner_button_id, ActiveSourceRecord,
    LocalInstallRecord, INSTALL_RECORD_FILE_NAME,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UninstallButtonSourceRequest {
    pub owner_button_id: String,
    pub program_name: String,
    pub panel_name: String,
    pub file_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UninstallButtonSourceResponse {
    pub owner_button_id: String,
    pub recycled_paths: Vec<String>,
    pub removed_binding_count: usize,
}

pub(crate) struct QuarantinedOwnedSource {
    pub record: ActiveSourceRecord,
    pub original_record_path: PathBuf,
    pub original_package_path: PathBuf,
    pub quarantine_record_path: PathBuf,
    pub quarantine_package_path: PathBuf,
    pub bindings_path: PathBuf,
    pub bindings_backup: Option<String>,
    pub removed_binding_count: usize,
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn path_is_under(path: &str, root: &Path) -> bool {
    let path = path.replace('/', "\\").to_ascii_lowercase();
    let root = path_key(root);
    path == root || path.starts_with(&(root + "\\"))
}

fn canonical_existing(path: &Path, description: &str) -> Result<PathBuf, String> {
    path.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve {description} at {}: {error}",
            path.display()
        )
    })
}

fn validate_owned_source_location(
    record_path: &Path,
    record: &ActiveSourceRecord,
    owner_button_id: &str,
) -> Result<PathBuf, String> {
    let manifest = load_program_manifest(&record.program_name)?;
    if !record.owner_button_id.eq_ignore_ascii_case(owner_button_id)
        || !record.install_id.eq_ignore_ascii_case(owner_button_id)
        || !record.program_id.eq_ignore_ascii_case(&manifest.program_id)
        || !record.program_name.eq_ignore_ascii_case(&manifest.label)
        || record.runner != manifest.runner.kind
    {
        return Err(format!(
            "Active source record '{}' does not match owner or program manifest identity.",
            record_path.display()
        ));
    }

    let panel_root = crate::resolve_panel_directory(&record.program_name, &record.panel_name)?;
    let expected_record = panel_root.join(active_record_file_name(owner_button_id));
    if canonical_existing(record_path, "active source record")?
        != canonical_existing(&expected_record, "expected active source record")?
    {
        return Err(format!(
            "Active source record '{}' is outside its manifest-defined panel owner path.",
            record_path.display()
        ));
    }

    let program_root = crate::resolve_program_directory(&record.program_name)?;
    let expected_package = program_root
        .join(&manifest.local_scripts_folder)
        .join(owner_button_id);
    let recorded_package = PathBuf::from(&record.local_package_path);
    let expected_package_canonical = canonical_existing(&expected_package, "owned Local package")?;
    let recorded_package_canonical =
        canonical_existing(&recorded_package, "recorded Local package")?;
    if recorded_package_canonical != expected_package_canonical {
        return Err(format!(
            "Button '{}' Local package must be exactly {}.",
            owner_button_id,
            expected_package.display()
        ));
    }

    let source_path = PathBuf::from(&record.source_path);
    let source_canonical = canonical_existing(&source_path, "installed Button source")?;
    let expected_source_root = canonical_existing(
        &expected_package.join("source"),
        "owned Local package source root",
    )?;
    if !source_canonical.is_file() || !source_canonical.starts_with(&expected_source_root) {
        return Err(format!(
            "Button '{}' installed source is outside its owned Local package source root.",
            owner_button_id
        ));
    }

    let install_path = expected_package.join(INSTALL_RECORD_FILE_NAME);
    let install_raw = fs::read_to_string(&install_path)
        .map_err(|error| format!("Failed to read {}: {error}", install_path.display()))?;
    let install = serde_json::from_str::<LocalInstallRecord>(&install_raw).map_err(|error| {
        format!(
            "Installed package record {} is invalid: {error}",
            install_path.display()
        )
    })?;
    let installed_source = expected_package.join(&install.source_relative_path);
    if install.schema_version != 1
        || !install
            .owner_button_id
            .eq_ignore_ascii_case(owner_button_id)
        || !install.install_id.eq_ignore_ascii_case(owner_button_id)
        || !install
            .program_id
            .eq_ignore_ascii_case(&manifest.program_id)
        || !install
            .program_name
            .eq_ignore_ascii_case(&record.program_name)
        || !install.panel_name.eq_ignore_ascii_case(&record.panel_name)
        || canonical_existing(&installed_source, "package source")? != source_canonical
    {
        return Err(format!(
            "Installed package record '{}' does not match its active Button owner.",
            install_path.display()
        ));
    }
    Ok(recorded_package)
}

fn locate_owned_source(
    owner_button_id: &str,
    expected_program: Option<&str>,
    expected_panel: Option<&str>,
    expected_file: Option<&str>,
) -> Result<(PathBuf, ActiveSourceRecord), String> {
    let programs_root = crate::resolve_programs_root()?;
    let mut matches = Vec::new();
    for program_entry in fs::read_dir(&programs_root)
        .map_err(|error| format!("Failed to read {}: {error}", programs_root.display()))?
    {
        let program_entry = program_entry
            .map_err(|error| format!("Failed to inspect {}: {error}", programs_root.display()))?;
        if !program_entry.path().is_dir()
            || !program_entry.path().join("flowcell.program.json").is_file()
        {
            continue;
        }
        let program_name = program_entry.file_name().to_string_lossy().to_string();
        if expected_program
            .map(|value| !value.eq_ignore_ascii_case(&program_name))
            .unwrap_or(false)
        {
            continue;
        }
        let manifest = load_program_manifest(&program_name)?;
        let panels_root = program_entry.path().join(&manifest.panels_folder);
        if !panels_root.is_dir() {
            continue;
        }
        for panel_entry in fs::read_dir(&panels_root)
            .map_err(|error| format!("Failed to read {}: {error}", panels_root.display()))?
        {
            let panel_entry = panel_entry
                .map_err(|error| format!("Failed to inspect {}: {error}", panels_root.display()))?;
            if !panel_entry.path().is_dir() {
                continue;
            }
            let panel_name = panel_entry.file_name().to_string_lossy().to_string();
            if expected_panel
                .map(|value| !value.eq_ignore_ascii_case(&panel_name))
                .unwrap_or(false)
            {
                continue;
            }
            for record_entry in fs::read_dir(panel_entry.path()).map_err(|error| {
                format!("Failed to read {}: {error}", panel_entry.path().display())
            })? {
                let record_entry = record_entry.map_err(|error| {
                    format!(
                        "Failed to inspect {}: {error}",
                        panel_entry.path().display()
                    )
                })?;
                let file_name = record_entry.file_name().to_string_lossy().to_string();
                if expected_file
                    .map(|value| !value.eq_ignore_ascii_case(&file_name))
                    .unwrap_or(false)
                    || !file_name
                        .to_ascii_lowercase()
                        .ends_with(super::records::ACTIVE_SOURCE_RECORD_SUFFIX)
                {
                    continue;
                }
                let record = read_active_record(&record_entry.path())?;
                if record.owner_button_id.eq_ignore_ascii_case(owner_button_id) {
                    matches.push((record_entry.path(), record));
                }
            }
        }
    }
    match matches.len() {
        1 => Ok(matches.remove(0)),
        0 => Err(format!("No installed source belongs to Button '{owner_button_id}'.")),
        _ => Err(format!(
            "Button '{owner_button_id}' has multiple active source records; refusing ambiguous cleanup."
        )),
    }
}

fn remove_owned_bindings(
    record: &ActiveSourceRecord,
) -> Result<(PathBuf, Option<String>, usize), String> {
    let bindings_path = crate::resolve_bindings_file_path()?;
    let backup =
        if bindings_path.is_file() {
            Some(fs::read_to_string(&bindings_path).map_err(|error| {
                format!("Failed to back up {}: {error}", bindings_path.display())
            })?)
        } else {
            None
        };
    let (_bindings, mut document, _) = crate::read_bindings_file_state()?;
    let package_root = PathBuf::from(&record.local_package_path);
    let binding_sections = document
        .keys()
        .filter(|section| section.starts_with("Binding_"))
        .cloned()
        .collect::<Vec<_>>();
    let mut removed = 0usize;
    for section_name in binding_sections {
        let owned = document
            .get(&section_name)
            .and_then(|section| section.get("ScriptPath"))
            .map(|path| path_is_under(path, &package_root))
            .unwrap_or(false);
        if owned {
            document.remove(&section_name);
            removed += 1;
        }
    }
    if let Some(action_hotkeys) = document.get_mut("ActionHotkeys") {
        if !record.bridge_action.trim().is_empty()
            && action_hotkeys.remove(record.bridge_action.trim()).is_some()
        {
            removed += 1;
        }
    }
    if document
        .get("ActionHotkeys")
        .map(|section| section.is_empty())
        .unwrap_or(false)
    {
        document.remove("ActionHotkeys");
    }
    let mut ids = document
        .keys()
        .filter_map(|section| section.strip_prefix("Binding_"))
        .filter_map(|value| value.parse::<u64>().ok())
        .collect::<Vec<_>>();
    ids.sort_unstable();
    let meta = document.entry("Meta".to_string()).or_default();
    meta.insert(
        "Ids".to_string(),
        ids.iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("|"),
    );
    meta.insert(
        "NextId".to_string(),
        (ids.last().copied().unwrap_or(0) + 1).max(1).to_string(),
    );
    crate::write_bindings_file_state(&bindings_path, &document)?;
    if removed > 0 {
        crate::restart_flowcell_headless_backend()?;
    }
    Ok((bindings_path, backup, removed))
}

pub(crate) fn cleanup_blender_owner(
    program_name: &str,
    owner_button_id: &str,
    label: &str,
    bridge_action: &str,
) -> Result<(), String> {
    if bridge_action.trim().is_empty() {
        return Ok(());
    }
    let manifest = load_program_manifest(program_name)?;
    let helper = crate::resolve_program_directory(program_name)?
        .join(&manifest.support_scripts_folder)
        .join(&manifest.runner.delete_script);
    if !helper.is_file() {
        return Err(format!(
            "Blender delete adapter was not found at {}.",
            helper.display()
        ));
    }
    let arguments = vec![
        "-File".to_string(),
        helper.to_string_lossy().to_string(),
        "-OwnerButtonId".to_string(),
        owner_button_id.to_string(),
        "-ButtonTarget".to_string(),
        format!("action:{}", bridge_action.trim()),
    ];
    let output = crate::spawn_powershell_output(&arguments)?;
    if output.status.success() {
        Ok(())
    } else {
        Err(crate::format_process_failure(
            &output,
            &format!("Blender cleanup failed for '{label}'."),
        ))
    }
}

fn cleanup_blender_runtime(record: &ActiveSourceRecord) -> Result<(), String> {
    if record.runner != "blender-bridge" {
        return Ok(());
    }
    cleanup_blender_owner(
        &record.program_name,
        &record.owner_button_id,
        &record.label,
        &record.bridge_action,
    )
}

fn transaction_token() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}-{}", now.as_secs(), now.subsec_nanos())
}

pub(crate) fn quarantine_owned_source(
    owner_button_id: &str,
    transaction_root: &Path,
) -> Result<QuarantinedOwnedSource, String> {
    let owner_button_id = validate_owner_button_id(owner_button_id)?;
    let (record_path, record) = locate_owned_source(&owner_button_id, None, None, None)?;
    let package_path = validate_owned_source_location(&record_path, &record, &owner_button_id)?;
    let owner_root = transaction_root.join(&owner_button_id);
    fs::create_dir_all(&owner_root)
        .map_err(|error| format!("Failed to create {}: {error}", owner_root.display()))?;
    let quarantined_record = owner_root.join(
        record_path
            .file_name()
            .ok_or_else(|| "Active record has no file name.".to_string())?,
    );
    let quarantined_package = owner_root.join("local-package");
    fs::rename(&record_path, &quarantined_record)
        .map_err(|error| format!("Failed to quarantine {}: {error}", record_path.display()))?;
    if let Err(error) = fs::rename(&package_path, &quarantined_package) {
        let _ = fs::rename(&quarantined_record, &record_path);
        return Err(format!(
            "Failed to quarantine {}: {error}",
            package_path.display()
        ));
    }
    let (bindings_path, bindings_backup, removed_binding_count) =
        match remove_owned_bindings(&record) {
            Ok(value) => value,
            Err(error) => {
                let _ = fs::rename(&quarantined_package, &package_path);
                let _ = fs::rename(&quarantined_record, &record_path);
                return Err(error);
            }
        };
    if let Err(error) = cleanup_blender_runtime(&record) {
        if let Some(backup) = bindings_backup.as_ref() {
            let _ = fs::write(&bindings_path, backup);
            let _ = crate::restart_flowcell_headless_backend();
        }
        let _ = fs::rename(&quarantined_package, &package_path);
        let _ = fs::rename(&quarantined_record, &record_path);
        return Err(error);
    }
    Ok(QuarantinedOwnedSource {
        record,
        original_record_path: record_path,
        original_package_path: package_path,
        quarantine_record_path: quarantined_record,
        quarantine_package_path: quarantined_package,
        bindings_path,
        bindings_backup,
        removed_binding_count,
    })
}

pub(crate) fn rollback_quarantined_source(source: &QuarantinedOwnedSource) -> Result<(), String> {
    if source.quarantine_package_path.is_dir() {
        fs::rename(
            &source.quarantine_package_path,
            &source.original_package_path,
        )
        .map_err(|error| {
            format!(
                "Failed to restore {}: {error}",
                source.original_package_path.display()
            )
        })?;
    }
    if source.quarantine_record_path.is_file() {
        fs::rename(&source.quarantine_record_path, &source.original_record_path).map_err(
            |error| {
                format!(
                    "Failed to restore {}: {error}",
                    source.original_record_path.display()
                )
            },
        )?;
    }
    if let Some(backup) = source.bindings_backup.as_ref() {
        fs::write(&source.bindings_path, backup).map_err(|error| {
            format!(
                "Failed to restore {}: {error}",
                source.bindings_path.display()
            )
        })?;
        let _ = crate::restart_flowcell_headless_backend();
    }
    if source.record.runner == "blender-bridge" {
        let manifest = load_program_manifest(&source.record.program_name)?;
        let installed_source = PathBuf::from(&source.record.source_path);
        super::install::deploy_blender_source(
            &manifest,
            &source.record.owner_button_id,
            &source.record.panel_name,
            &installed_source,
            source.record.bridge_data.as_ref(),
        )?;
    }
    Ok(())
}

pub(crate) fn recycle_quarantined_source(
    source: &QuarantinedOwnedSource,
) -> Result<Vec<String>, String> {
    let owner_root = source
        .quarantine_record_path
        .parent()
        .ok_or_else(|| "Quarantined Button source has no owner directory.".to_string())?;
    let paths = vec![
        source.original_record_path.display().to_string(),
        source.original_package_path.display().to_string(),
    ];
    crate::recycle_directory_path(owner_root)?;
    Ok(paths)
}

#[tauri::command]
pub(crate) fn uninstall_button_source(
    request: UninstallButtonSourceRequest,
) -> Result<UninstallButtonSourceResponse, String> {
    let owner_button_id = validate_owner_button_id(&request.owner_button_id)?;
    let (record_path, _) = locate_owned_source(
        &owner_button_id,
        Some(request.program_name.trim()),
        Some(request.panel_name.trim()),
        Some(request.file_name.trim()),
    )?;
    let local_root = crate::resolve_flowcell_local_root()?
        .join("button-system")
        .join("quarantine");
    let transaction_root = local_root.join(transaction_token());
    let source = quarantine_owned_source(&owner_button_id, &transaction_root)?;
    if source.original_record_path != record_path {
        let _ = rollback_quarantined_source(&source);
        return Err("Owned source identity changed during uninstall.".to_string());
    }
    match recycle_quarantined_source(&source) {
        Ok(recycled_paths) => {
            if transaction_root.is_dir() {
                let _ = fs::remove_dir(&transaction_root);
            }
            Ok(UninstallButtonSourceResponse {
                owner_button_id,
                recycled_paths,
                removed_binding_count: source.removed_binding_count,
            })
        }
        Err(error) => {
            let rollback = rollback_quarantined_source(&source);
            Err(match rollback {
                Ok(()) => error,
                Err(rollback_error) => format!("{error} Rollback also failed: {rollback_error}"),
            })
        }
    }
}
