use crate::*;

fn resolve_illustrator_bridge_invoke_script(program_name: &str) -> Result<PathBuf, String> {
    let manifest = program_sources::manifest::load_program_manifest(program_name)?;
    let script_path = resolve_program_directory(program_name)?
        .join(&manifest.support_scripts_folder)
        .join("Invoke-IllustratorFlowCellAction.ps1");
    if !script_path.is_file() {
        return Err(format!(
            "Illustrator bridge invoke script was not found at {}.",
            script_path.display()
        ));
    }
    Ok(script_path)
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

fn run_illustrator_layers_action_blocking(
    program_name: String,
    panel_name: String,
    file_name: String,
    args_json: String,
) -> Result<String, String> {
    const LAYER_TREE_CAPABILITY: &str = "illustrator-layer-tree";
    let resolution = program_sources::execute::resolve_capability_source(
        &program_name,
        &panel_name,
        &file_name,
        LAYER_TREE_CAPABILITY,
    )?;
    let invoke_script = resolve_illustrator_bridge_invoke_script(&program_name)?;
    let action_id = format!("flowcell_button_{}", resolution.record.owner_button_id);
    let command = format!(
        "& '{}' -ActionId '{}' -ScriptPath '{}' -ArgsJson '{}' -ConnectTimeoutMs 2000 -StartTimeoutMs 25000 -Wait",
        escape_powershell_single_quoted(&invoke_script.to_string_lossy()),
        escape_powershell_single_quoted(&action_id),
        escape_powershell_single_quoted(&resolution.record.source_path),
        escape_powershell_single_quoted(&args_json)
    );
    let output = spawn_powershell_output(&[
        "-EncodedCommand".to_string(),
        encode_powershell_command(&command),
    ])?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    append_flowcell_local_log(
        "layers-builder.log",
        &format!(
            "args={} exit={:?} stdout_len={} stderr={}",
            args_json,
            output.status.code(),
            stdout.len(),
            stderr.chars().take(600).collect::<String>()
        ),
    );
    if !output.status.success() {
        return Err(format_process_failure(
            &output,
            "Illustrator layers action failed.",
        ));
    }
    if stdout.is_empty() {
        return Err("Illustrator layers action returned no response.".to_string());
    }
    Ok(stdout)
}

#[tauri::command]
pub(crate) async fn run_illustrator_layers_action(
    program_name: String,
    panel_name: String,
    file_name: String,
    args_json: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_illustrator_layers_action_blocking(program_name, panel_name, file_name, args_json)
    })
    .await
    .map_err(|error| format!("Illustrator layers task failed: {error}"))?
}

#[tauri::command]
pub(crate) fn set_illustrator_layers_highlight(keys: Vec<String>) -> Result<(), String> {
    require_registered_program_name("Illustrator")?;
    let body = serde_json::to_string(&json!({ "keys": keys }))
        .map_err(|error| format!("Failed to serialize highlight set: {error}"))?;
    let local_root = resolve_flowcell_local_root()?;
    fs::create_dir_all(&local_root)
        .map_err(|error| format!("Failed to create FlowCell local folder: {error}"))?;
    fs::write(local_root.join("illustrator-layers-highlight.json"), &body)
        .map_err(|error| format!("Failed to write highlight set: {error}"))?;
    let temp_path = std::env::temp_dir().join("flowcell-illustrator-layers-highlight.json");
    fs::write(&temp_path, &body)
        .map_err(|error| format!("Failed to write highlight mirror: {error}"))
}
