use super::install::merge_toolset_payload;
use super::manifest::load_program_manifest;
use super::records::{
    active_record_file_name, read_active_record, recover_active_record,
    recover_active_records_in_directory, validate_owner_button_id, ActiveSourceRecord,
    LocalInstallRecord, ACTIVE_SOURCE_RECORD_SUFFIX, INSTALL_RECORD_FILE_NAME,
};
use super::transaction::{write_json_file, AtomicWriteMode};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_WINDOWS_CAPABILITY_STDOUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_WINDOWS_CAPABILITY_STDERR_BYTES: usize = 256 * 1024;

#[derive(Clone, Debug)]
pub(crate) struct ActiveSourceResolution {
    pub file_name: String,
    pub record: ActiveSourceRecord,
}

#[derive(Clone, Debug)]
pub(crate) struct ResolvedOwnedSourcePaths {
    pub package_path: PathBuf,
    pub source_path: PathBuf,
}

fn illustrator_wait_for_completion(record: &ActiveSourceRecord) -> bool {
    record
        .runner_data
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|execution| execution.get("waitForCompletion"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn path_components_end_with(path: &Path, suffix: &Path) -> bool {
    let path = path
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_ascii_lowercase())
        .collect::<Vec<_>>();
    let suffix = suffix
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_ascii_lowercase())
        .collect::<Vec<_>>();
    suffix.len() <= path.len() && path[path.len() - suffix.len()..] == suffix
}

fn stored_path_matches_expected(
    stored: &str,
    program_root: &Path,
    expected: &Path,
    field: &str,
) -> Result<bool, String> {
    let stored_path = Path::new(stored.trim());
    if stored_path.as_os_str().is_empty() {
        return Ok(false);
    }
    let expected_canonical = expected.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve owned source path {}: {error}",
            expected.display()
        )
    })?;
    if !stored_path.is_absolute() {
        let Some(candidate) =
            super::manifest::resolve_relative_manifest_path(program_root, stored, field, false)?
        else {
            return Ok(false);
        };
        return Ok(candidate.canonicalize().ok().as_ref() == Some(&expected_canonical));
    }
    if stored_path.exists() {
        return Ok(stored_path.canonicalize().ok().as_ref() == Some(&expected_canonical));
    }
    // Legacy records stored an absolute repo path. After a portable move that
    // prefix is stale, but the manifest-owned suffix remains authoritative.
    let canonical_program_root = program_root.canonicalize().ok();
    let expected_relative = expected
        .strip_prefix(program_root)
        .ok()
        .or_else(|| {
            canonical_program_root
                .as_deref()
                .and_then(|root| expected.strip_prefix(root).ok())
        })
        .ok_or_else(|| {
            format!(
                "Expected owned source {} is outside program root {}.",
                expected.display(),
                program_root.display()
            )
        })?;
    Ok(path_components_end_with(stored_path, expected_relative))
}

pub(crate) fn resolve_owned_source_paths(
    manifest: &super::manifest::ProgramManifest,
    record: &ActiveSourceRecord,
) -> Result<ResolvedOwnedSourcePaths, String> {
    let owner_button_id = validate_owner_button_id(&record.owner_button_id)?;
    let program_root = crate::resolve_program_directory(&record.program_name)?;
    let local_root = super::manifest::resolve_manifest_folder(
        &program_root,
        &manifest.local_scripts_folder,
        "localScriptsFolder",
    )?;
    let expected_package = local_root.join(&owner_button_id);
    let package_path = expected_package.canonicalize().map_err(|error| {
        format!(
            "Button '{}' owned Local package could not be resolved at {}: {error}",
            record.label,
            expected_package.display()
        )
    })?;
    if !package_path.is_dir()
        || !stored_path_matches_expected(
            &record.local_package_path,
            &program_root,
            &expected_package,
            "localPackagePath",
        )?
    {
        return Err(format!(
            "Button '{}' no longer has its manifest-owned Local package.",
            record.label
        ));
    }

    let install_path = package_path.join(INSTALL_RECORD_FILE_NAME);
    let install = super::transaction::read_json_file(&install_path, |path| {
        let raw = fs::read_to_string(path)
            .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
        serde_json::from_str::<LocalInstallRecord>(&raw).map_err(|error| {
            format!(
                "Installed package record {} is invalid: {error}",
                path.display()
            )
        })
    })?;
    if install.schema_version != 1
        || !install
            .owner_button_id
            .eq_ignore_ascii_case(&owner_button_id)
        || !install.install_id.eq_ignore_ascii_case(&owner_button_id)
        || !install
            .program_id
            .eq_ignore_ascii_case(&manifest.program_id)
        || !install
            .program_name
            .eq_ignore_ascii_case(&record.program_name)
        || !install.panel_name.eq_ignore_ascii_case(&record.panel_name)
        || install.bundled_source_id != record.bundled_source_id
        || install.bundled_source_version != record.bundled_source_version
    {
        return Err(format!(
            "Installed package record '{}' does not match its active Button owner.",
            install_path.display()
        ));
    }
    let source_path = super::manifest::resolve_relative_manifest_path(
        &package_path,
        &install.source_relative_path,
        "sourceRelativePath",
        false,
    )?
    .ok_or_else(|| "Installed sourceRelativePath cannot be empty.".to_string())?
    .canonicalize()
    .map_err(|error| {
        format!(
            "Installed Button source '{}' could not be resolved: {error}",
            install.source_relative_path
        )
    })?;
    let source_root = package_path
        .join("source")
        .canonicalize()
        .map_err(|error| format!("Failed to resolve installed source root: {error}"))?;
    if !source_path.is_file()
        || !source_path.starts_with(&source_root)
        || !stored_path_matches_expected(
            &record.source_path,
            &program_root,
            &source_path,
            "sourcePath",
        )?
    {
        return Err(format!(
            "Button '{}' installed source is outside its owned package.",
            record.label
        ));
    }
    Ok(ResolvedOwnedSourcePaths {
        package_path,
        source_path,
    })
}

fn validate_resolution(
    program_name: &str,
    panel_name: &str,
    mut resolution: ActiveSourceResolution,
) -> Result<ActiveSourceResolution, String> {
    let registered_program_name = crate::require_registered_program_name(program_name)?;
    let manifest = load_program_manifest(&registered_program_name)?;
    let owner_button_id = validate_owner_button_id(&resolution.record.owner_button_id)?;
    if !resolution
        .record
        .program_name
        .eq_ignore_ascii_case(&registered_program_name)
        || !resolution
            .record
            .program_id
            .eq_ignore_ascii_case(&manifest.program_id)
        || !resolution
            .record
            .panel_name
            .eq_ignore_ascii_case(panel_name.trim())
        || resolution.record.install_id != owner_button_id
        || !resolution
            .file_name
            .eq_ignore_ascii_case(&active_record_file_name(&owner_button_id))
        || resolution.record.runner != manifest.runner.kind
    {
        return Err(format!(
            "Active source record '{}' does not belong to {}/{}.",
            resolution.file_name, program_name, panel_name
        ));
    }
    let paths = resolve_owned_source_paths(&manifest, &resolution.record)?;
    resolution.record.local_package_path = paths.package_path.to_string_lossy().to_string();
    resolution.record.source_path = paths.source_path.to_string_lossy().to_string();
    Ok(resolution)
}

pub(crate) fn resolve_active_source_record(
    program_name: &str,
    panel_name: &str,
    file_name: &str,
) -> Result<Option<ActiveSourceResolution>, String> {
    let validated_file_name = crate::validate_panel_script_file_name(file_name)?;
    if !validated_file_name
        .to_ascii_lowercase()
        .ends_with(ACTIVE_SOURCE_RECORD_SUFFIX)
    {
        return Ok(None);
    }
    let panel_directory = crate::resolve_panel_directory(program_name, panel_name)?;
    let record_path = panel_directory.join(&validated_file_name);
    recover_active_record(&record_path)?;
    if !record_path.is_file() {
        return Err(format!(
            "Active Button source '{}' was not found in {}.",
            validated_file_name,
            panel_directory.display()
        ));
    }
    let record = read_active_record(&record_path)?;
    validate_resolution(
        program_name,
        panel_name,
        ActiveSourceResolution {
            file_name: validated_file_name,
            record,
        },
    )
    .map(Some)
}

pub(crate) fn list_active_source_records(
    program_name: &str,
    panel_name: &str,
) -> Result<Vec<ActiveSourceResolution>, String> {
    let panel_directory = crate::resolve_panel_directory(program_name, panel_name)?;
    recover_active_records_in_directory(&panel_directory)?;
    let mut records = Vec::new();
    for entry in fs::read_dir(&panel_directory)
        .map_err(|error| format!("Failed to read {}: {error}", panel_directory.display()))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to inspect {}: {error}", panel_directory.display()))?;
        if !entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?
            .is_file()
        {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_string();
        if !file_name
            .to_ascii_lowercase()
            .ends_with(ACTIVE_SOURCE_RECORD_SUFFIX)
        {
            continue;
        }
        match resolve_active_source_record(program_name, panel_name, &file_name)? {
            Some(record) => records.push(record),
            None => {
                return Err(format!(
                    "Active Button source '{}' could not be resolved.",
                    entry.path().display()
                ))
            }
        }
    }
    records.sort_by_cached_key(|entry| entry.record.label.to_ascii_lowercase());
    Ok(records)
}

fn record_declares_capability(record: &ActiveSourceRecord, capability: &str) -> bool {
    let normalized = capability.trim();
    if normalized.is_empty() {
        return false;
    }
    let bridge_declares = record
        .bridge_data
        .as_ref()
        .and_then(Value::as_object)
        .and_then(|data| data.get("capabilities"))
        .and_then(Value::as_array)
        .is_some_and(|values| {
            values.iter().any(|value| {
                value
                    .as_str()
                    .is_some_and(|value| value.trim().eq_ignore_ascii_case(normalized))
            })
        });
    bridge_declares
        || record.page.as_ref().is_some_and(|page| {
            page.capabilities
                .iter()
                .any(|value| value.trim().eq_ignore_ascii_case(normalized))
        })
}

pub(crate) fn resolve_capability_source(
    program_name: &str,
    panel_name: &str,
    file_name: &str,
    capability: &str,
) -> Result<ActiveSourceResolution, String> {
    let resolution = resolve_active_source_record(program_name, panel_name, file_name)?
        .ok_or_else(|| {
            format!(
                "Installed Button source '{}' could not be resolved for {}/{}.",
                file_name.trim(),
                program_name.trim(),
                panel_name.trim()
            )
        })?;
    if !record_declares_capability(&resolution.record, capability) {
        return Err(format!(
            "Installed Button '{}' does not declare required capability '{}'.",
            resolution.record.label,
            capability.trim()
        ));
    }
    Ok(resolution)
}

fn base64_encode_standard(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
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

fn encode_powershell_command(command: &str) -> String {
    let mut bytes = Vec::with_capacity(command.len() * 2);
    for unit in command.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    base64_encode_standard(&bytes)
}

fn windows_script_capability_command(
    source_path: &Path,
    capability: &str,
    args_json: &str,
) -> Result<String, String> {
    if !source_path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("ps1"))
    {
        return Err(
            "Windows request/response capabilities require an installed .ps1 source.".to_string(),
        );
    }
    Ok(format!(
        "& '{}' -FlowCellCapability '{}' -ArgsJson '{}'",
        crate::escape_powershell_single_quoted(&source_path.to_string_lossy()),
        crate::escape_powershell_single_quoted(capability),
        crate::escape_powershell_single_quoted(args_json)
    ))
}

fn run_windows_script_capability(
    source_path: &Path,
    capability: &str,
    args_json: &str,
) -> Result<String, String> {
    let command = windows_script_capability_command(source_path, capability, args_json)?;
    let output = crate::spawn_powershell_output_bounded(
        &[
            "-EncodedCommand".to_string(),
            encode_powershell_command(&command),
        ],
        MAX_WINDOWS_CAPABILITY_STDOUT_BYTES,
        MAX_WINDOWS_CAPABILITY_STDERR_BYTES,
    )
    .map_err(|error| format!("Program capability '{capability}' output failed: {error}"))?;
    if !output.status.success() {
        return Err(crate::format_process_failure(
            &output,
            &format!("Program capability '{capability}' failed."),
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        Err(format!(
            "Program capability '{capability}' returned no response."
        ))
    } else {
        Ok(stdout)
    }
}

pub(crate) fn run_program_capability_action_blocking(
    program_name: String,
    panel_name: String,
    file_name: String,
    capability: String,
    args_json: String,
) -> Result<String, String> {
    let args = serde_json::from_str::<Value>(&args_json)
        .map_err(|error| format!("Capability request is invalid JSON: {error}"))?;
    let resolution =
        resolve_capability_source(&program_name, &panel_name, &file_name, &capability)?;
    match resolution.record.runner.as_str() {
        "windows-script" => run_windows_script_capability(
            Path::new(&resolution.record.source_path),
            &capability,
            &args_json,
        ),
        "illustrator-direct" => {
            let action_id = format!(
                "flowcell_button_{}",
                resolution.record.owner_button_id.to_ascii_lowercase()
            );
            let response = crate::run_illustrator_bridge_action_direct(
                Path::new(&resolution.record.source_path),
                &action_id,
                Some(args),
                true,
            )?;
            serde_json::to_string(&response).map_err(|error| {
                format!("Failed to encode program capability '{capability}' response: {error}")
            })
        }
        "blender-bridge" => {
            if resolution.record.bridge_action.trim().is_empty() {
                return Err(format!(
                    "Installed Button '{}' is missing bridgeAction.",
                    resolution.record.label
                ));
            }
            let response = crate::run_blender_bridge_action_direct(
                resolution.record.bridge_action.trim(),
                args,
            )?;
            serde_json::to_string(&response)
                .map_err(|error| format!("Failed to encode capability response: {error}"))
        }
        runner => Err(format!(
            "Runner '{runner}' does not support request/response capabilities."
        )),
    }
}

#[tauri::command]
pub(crate) async fn run_program_capability_action(
    program_name: String,
    panel_name: String,
    file_name: String,
    capability: String,
    args_json: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_program_capability_action_blocking(
            program_name,
            panel_name,
            file_name,
            capability,
            args_json,
        )
    })
    .await
    .map_err(|error| format!("Program capability task failed: {error}"))?
}

fn capability_state_file(record: &ActiveSourceRecord) -> Result<(&str, bool), String> {
    let execution = record
        .runner_data
        .as_ref()
        .and_then(Value::as_object)
        .ok_or_else(|| {
            format!(
                "Installed Button '{}' does not declare capability state storage.",
                record.label
            )
        })?;
    let file_name = execution
        .get("capabilityStateFile")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!(
                "Installed Button '{}' is missing execution.capabilityStateFile.",
                record.label
            )
        })?;
    let file_path = Path::new(file_name);
    if file_path.is_absolute()
        || file_path.components().count() != 1
        || file_path.file_name().and_then(|value| value.to_str()) != Some(file_name)
        || !file_name.to_ascii_lowercase().ends_with(".json")
    {
        return Err(
            "execution.capabilityStateFile must be a single file name with a .json extension."
                .to_string(),
        );
    }
    Ok((
        file_name,
        execution
            .get("mirrorCapabilityStateToTemp")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    ))
}

#[tauri::command]
pub(crate) fn set_program_capability_state(
    program_name: String,
    panel_name: String,
    file_name: String,
    capability: String,
    state_json: String,
) -> Result<(), String> {
    let resolution =
        resolve_capability_source(&program_name, &panel_name, &file_name, &capability)?;
    let state = serde_json::from_str::<Value>(&state_json)
        .map_err(|error| format!("Capability state is invalid JSON: {error}"))?;
    let (file_name, mirror_to_temp) = capability_state_file(&resolution.record)?;
    let body = serde_json::to_string(&state)
        .map_err(|error| format!("Failed to encode capability state: {error}"))?;
    let local_root = crate::resolve_flowcell_local_root()?;
    fs::create_dir_all(&local_root)
        .map_err(|error| format!("Failed to create {}: {error}", local_root.display()))?;
    write_json_file(
        &local_root.join(file_name),
        body.as_bytes(),
        AtomicWriteMode::Replace,
    )
    .map_err(|error| format!("Failed to write capability state: {error}"))?;
    if mirror_to_temp {
        write_json_file(
            &std::env::temp_dir().join(file_name),
            body.as_bytes(),
            AtomicWriteMode::Replace,
        )
        .map_err(|error| format!("Failed to write capability state mirror: {error}"))?;
    }
    Ok(())
}

pub(crate) fn run_active_source(resolution: &ActiveSourceResolution) -> Result<Value, String> {
    let record = &resolution.record;
    if !record.children.is_empty() {
        return Ok(json!({ "message": format!("Loaded {}.", record.label) }));
    }
    let source_path = PathBuf::from(&record.source_path);
    let manifest = load_program_manifest(&record.program_name)?;
    match record.runner.as_str() {
        "windows-script" => {
            crate::run_windows_panel_script_file(&source_path)?;
            Ok(json!({ "message": format!("Started {}.", record.label) }))
        }
        "illustrator-direct" => {
            if manifest.runner.program_key.trim().is_empty() {
                return Err(
                    "Illustrator program manifest is missing runner.programKey.".to_string()
                );
            }
            let action_id = format!(
                "flowcell_button_{}",
                record.owner_button_id.to_ascii_lowercase()
            );
            let wait_for_completion = illustrator_wait_for_completion(record);
            crate::run_illustrator_bridge_action_direct(
                &source_path,
                &action_id,
                None,
                wait_for_completion,
            )?;
            let message = if wait_for_completion {
                format!("Completed {}.", record.label)
            } else {
                format!("Started {}.", record.label)
            };
            Ok(json!({ "message": message }))
        }
        "photoshop-direct" => {
            if manifest.runner.program_key.trim().is_empty() {
                return Err("Photoshop program manifest is missing runner.programKey.".to_string());
            }
            crate::run_flowcell_controller_script(&source_path, manifest.runner.program_key.trim())
                .map(|message| json!({ "message": message }))
        }
        "blender-bridge" => {
            if record.bridge_action.trim().is_empty() {
                return Err(format!(
                    "Installed Blender Button '{}' is missing bridgeAction.",
                    record.label
                ));
            }
            crate::run_blender_bridge_action_direct(
                record.bridge_action.trim(),
                record.bridge_data.clone().unwrap_or_else(|| json!({})),
            )
        }
        value => Err(format!("Unsupported installed Button runner '{value}'.")),
    }
}

pub(crate) fn run_active_toolset_action(
    resolution: &ActiveSourceResolution,
    slot: &str,
    runtime_payload: Option<Value>,
) -> Result<Value, String> {
    let record = &resolution.record;
    if record.children.is_empty() {
        return Err(format!("Button '{}' is not a tool set.", record.label));
    }
    let payload = merge_toolset_payload(record, slot, runtime_payload)?;
    let manifest = load_program_manifest(&record.program_name)?;
    match record.runner.as_str() {
        "blender-bridge" => {
            if record.bridge_action.trim().is_empty() {
                return Err(format!(
                    "The toolset manifest for '{}' is missing bridgeAction.",
                    record.label
                ));
            }
            crate::run_blender_bridge_action_direct(record.bridge_action.trim(), payload)
        }
        "illustrator-direct" => {
            let execution = record
                .runner_data
                .as_ref()
                .and_then(Value::as_object)
                .ok_or_else(|| {
                    format!(
                        "Tool-set manifest for '{}' requires an execution object.",
                        record.label
                    )
                })?;
            let command_file = execution
                .get("commandFile")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    format!(
                        "Tool-set manifest for '{}' is missing execution.commandFile.",
                        record.label
                    )
                })?;
            let command_path = Path::new(command_file.trim());
            if command_path.is_absolute()
                || command_path.components().count() != 1
                || command_path.file_name().and_then(|value| value.to_str())
                    != Some(command_file.trim())
            {
                return Err("execution.commandFile must be a single JSON file name.".to_string());
            }
            if !command_file.to_ascii_lowercase().ends_with(".json") {
                return Err("execution.commandFile must use the .json extension.".to_string());
            }
            let program_key = execution
                .get("programKey")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(manifest.runner.program_key.trim());
            if program_key.is_empty() {
                return Err(
                    "Illustrator program manifest is missing runner.programKey.".to_string()
                );
            }
            let local_root = crate::resolve_flowcell_local_root()?;
            fs::create_dir_all(&local_root)
                .map_err(|error| format!("Failed to create {}: {error}", local_root.display()))?;
            let command_path = local_root.join(command_file.trim());
            let created_at_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            let envelope = json!({
                "programName": record.program_name,
                "panelName": record.panel_name,
                "fileName": resolution.file_name,
                "command": slot.trim(),
                "createdAtMs": created_at_ms,
                "payload": payload
            });
            super::records::atomic_replace_json(&command_path, &envelope)?;
            let source_path = PathBuf::from(&record.source_path);
            let action_id = format!(
                "flowcell_button_{}",
                record.owner_button_id.to_ascii_lowercase()
            );
            crate::run_illustrator_bridge_action_direct(&source_path, &action_id, None, false)?;
            Ok(json!({ "message": format!("Started {}.", record.label) }))
        }
        _ => Err(format!(
            "Tool-set execution is not supported by runner '{}'.",
            record.runner
        )),
    }
}

fn declared_blender_button_event_action<'a>(
    event: &'a Map<String, Value>,
    event_name: &str,
) -> Result<&'a str, String> {
    event
        .get("action")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|action| !action.is_empty())
        .ok_or_else(|| format!("Button event '{}' is missing an action.", event_name))
}

pub(crate) fn run_active_button_event(
    resolution: &ActiveSourceResolution,
    event_name: &str,
) -> Result<String, String> {
    let normalized = crate::normalize_panel_button_event_name(event_name)
        .ok_or_else(|| format!("Unsupported button event '{}'.", event_name.trim()))?;
    let events = resolution.record.events.as_ref().ok_or_else(|| {
        format!(
            "Button '{}' does not declare events.",
            resolution.record.label
        )
    })?;
    let event = events
        .get(&normalized)
        .and_then(Value::as_object)
        .ok_or_else(|| {
            format!(
                "Button '{}' does not declare event '{}'.",
                resolution.record.label, normalized
            )
        })?;
    let action_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("blenderBridge");
    if action_type.eq_ignore_ascii_case("none") {
        return Ok("Button event has no action.".to_string());
    }
    if !action_type.eq_ignore_ascii_case("blenderBridge")
        || resolution.record.runner != "blender-bridge"
    {
        return Err(format!(
            "Button event type '{action_type}' is not supported by this runner."
        ));
    }
    let action = declared_blender_button_event_action(event, &normalized)?;
    let data = event.get("data").cloned().unwrap_or_else(|| json!({}));
    let response = crate::run_blender_bridge_action_direct(action, data)?;
    Ok(crate::extract_blender_bridge_response_message(&response))
}

#[cfg(test)]
mod tests {
    use super::{
        declared_blender_button_event_action, illustrator_wait_for_completion,
        path_components_end_with, windows_script_capability_command,
    };
    use crate::program_sources::records::ActiveSourceRecord;
    use serde_json::json;
    use std::collections::BTreeMap;
    use std::path::Path;

    fn illustrator_record(runner_data: Option<serde_json::Value>) -> ActiveSourceRecord {
        ActiveSourceRecord {
            schema_version: 1,
            owner_button_id: "owner".to_string(),
            install_id: "install".to_string(),
            program_id: "illustrator".to_string(),
            program_name: "Illustrator".to_string(),
            panel_name: "Layers Builder".to_string(),
            label: "new sub".to_string(),
            tooltip: String::new(),
            kind: "script".to_string(),
            local_package_path: "package".to_string(),
            source_path: "source.jsx".to_string(),
            runner: "illustrator-direct".to_string(),
            runner_data,
            execution_target: None,
            bridge_action: String::new(),
            bridge_data: None,
            events: None::<BTreeMap<String, serde_json::Value>>,
            children: Vec::new(),
            layout: None,
            page: None,
            source_display_path: String::new(),
            bundled_source_id: None,
            bundled_source_version: None,
        }
    }

    #[test]
    fn illustrator_completion_wait_is_explicit_and_opt_in() {
        assert!(illustrator_wait_for_completion(&illustrator_record(Some(
            json!({
                "waitForCompletion": true
            })
        ))));
        assert!(!illustrator_wait_for_completion(&illustrator_record(Some(
            json!({
                "waitForCompletion": false
            })
        ))));
        assert!(!illustrator_wait_for_completion(&illustrator_record(None)));
    }

    #[test]
    fn relocated_legacy_absolute_paths_must_keep_the_manifest_owned_suffix() {
        assert!(path_components_end_with(
            Path::new(
                r"D:\OldFlowCell\Programs\Windows\Windows Local Scripts\owner\source\run.ps1"
            ),
            Path::new(r"Windows Local Scripts\owner\source\run.ps1")
        ));
        assert!(!path_components_end_with(
            Path::new(r"D:\OldFlowCell\Programs\Windows\Other Local Scripts\owner\source\run.ps1"),
            Path::new(r"Windows Local Scripts\owner\source\run.ps1")
        ));
    }

    #[test]
    fn declared_button_event_uses_its_own_bridge_action() {
        let event = json!({
            "type": "blenderBridge",
            "action": "cycle_collection_hover_save_visibility"
        });
        assert_eq!(
            declared_blender_button_event_action(
                event.as_object().expect("event object"),
                "hoverEnter"
            )
            .expect("declared event action"),
            "cycle_collection_hover_save_visibility"
        );
    }

    #[test]
    fn declared_button_event_rejects_a_missing_action() {
        let event = json!({ "type": "blenderBridge", "action": "  " });
        let error = declared_blender_button_event_action(
            event.as_object().expect("event object"),
            "pressUp",
        )
        .expect_err("blank action should fail");
        assert_eq!(error, "Button event 'pressUp' is missing an action.");
    }

    #[test]
    fn windows_capabilities_use_only_the_installed_powershell_source_and_typed_arguments() {
        let command = windows_script_capability_command(
            Path::new(r"D:\FlowCell\Windows Local Scripts\owner\source\handler.ps1"),
            "windows.example",
            r#"{"value":"Aaron's file"}"#,
        )
        .expect("PowerShell capability command");
        assert_eq!(
            command,
            r#"& 'D:\FlowCell\Windows Local Scripts\owner\source\handler.ps1' -FlowCellCapability 'windows.example' -ArgsJson '{"value":"Aaron''s file"}'"#
        );
    }

    #[test]
    fn windows_capabilities_reject_non_powershell_sources() {
        let error = windows_script_capability_command(
            Path::new(r"D:\FlowCell\Windows Local Scripts\owner\source\handler.cmd"),
            "windows.example",
            "{}",
        )
        .expect_err("non-PowerShell capability source should fail");
        assert_eq!(
            error,
            "Windows request/response capabilities require an installed .ps1 source."
        );
    }
}
