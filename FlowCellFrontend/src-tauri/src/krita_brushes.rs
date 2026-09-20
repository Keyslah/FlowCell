//! Fixed-data handoff from Krita's successful preset save to ordinary Buttons.
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Brush {
    id: String,
    revision: String,
    name: String,
    filename: String,
    size: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrushButton {
    id: String,
    revision: String,
    label: String,
    source_path: String,
}

fn root() -> Result<PathBuf, String> {
    Ok(
        PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?)
            .join("FlowCell/KritaLayers/brush-buttons"),
    )
}

fn valid_id(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|c| c.is_ascii_hexdigit())
}

fn read_brush(id: &str) -> Result<Brush, String> {
    if !valid_id(id) {
        return Err("Invalid brush identity".into());
    }
    let path = root()?.join(format!("{id}.json"));
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 16384 {
        return Err("Brush handoff is too large".into());
    }
    let brush: Brush = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if brush.id != id
        || brush.revision.is_empty()
        || brush.revision.len() > 80
        || brush.name.trim().is_empty()
        || brush.name.len() > 2048
        || brush.filename.is_empty()
        || brush.filename.len() > 4096
        || !brush.size.is_finite()
        || brush.size <= 0.0
        || brush.size > 1_000_000.0
    {
        return Err("Invalid saved brush data".into());
    }
    Ok(brush)
}

#[tauri::command]
pub(crate) fn prepare_krita_brush_button(id: String) -> Result<BrushButton, String> {
    let brush = read_brush(&id)?;
    let program = crate::resolve_program_directory("Krita")?;
    let package = program.join("SupportScripts/GeneratedBrushes").join(&id);
    fs::create_dir_all(&package).map_err(|e| e.to_string())?;
    let size = format!("{:.2}", brush.size)
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_string();
    let label = format!("{} · {size} px", brush.name);
    let manifest = serde_json::json!({"schemaVersion":1,"id":format!("krita.brush.{id}"),
        "label":label,"tooltip":format!("Select {} at {} px",brush.name,brush.size),
        "program":"Krita","source":"run.ps1"});
    fs::write(
        package.join("flowcell.script.json"),
        serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    // Only the validated hex identity enters executable text. Names remain JSON data.
    fs::write(package.join("run.ps1"), format!(
        "$ErrorActionPreference = 'Stop'\n& (Join-Path $PSScriptRoot 'Invoke-KritaLayers.ps1') -Action 'select_brush' -BrushId '{id}'\n"
    )).map_err(|e| e.to_string())?;
    fs::copy(
        program.join("SupportScripts/Invoke-KritaLayers.ps1"),
        package.join("Invoke-KritaLayers.ps1"),
    )
    .map_err(|e| e.to_string())?;
    Ok(BrushButton {
        id,
        revision: brush.revision,
        label,
        source_path: package.to_string_lossy().into(),
    })
}

#[tauri::command]
pub(crate) fn pending_krita_brush_buttons() -> Result<Vec<String>, String> {
    let directory = root()?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut pending = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if path.extension().and_then(|s| s.to_str()) != Some("json") || !valid_id(id) {
            continue;
        }
        let brush = read_brush(id)?;
        if fs::read_to_string(directory.join(format!("{id}.ack"))).unwrap_or_default()
            != brush.revision
        {
            pending.push(id.to_string());
        }
    }
    pending.sort();
    Ok(pending)
}

#[tauri::command]
pub(crate) fn acknowledge_krita_brush_button(id: String, revision: String) -> Result<(), String> {
    let brush = read_brush(&id)?;
    if brush.revision != revision {
        return Ok(());
    }
    // A newer save racing this acknowledgement remains pending on the next scan.
    fs::write(root()?.join(format!("{id}.ack")), revision).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn brush_identity_cannot_escape_transport_or_enter_script_text() {
        assert!(valid_id(&"a".repeat(64)));
        for id in ["../brush", "a';exit;#", "", "a.json"] {
            assert!(!valid_id(id));
        }
    }
}
