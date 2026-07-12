use crate::*;

const LAYOUT_SNAPSHOT_VERSION: u64 = 8;
const LAYOUT_SNAPSHOT_KIND: &str = "FlowCellWindowLayout";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase", deny_unknown_fields)]
pub(crate) struct LayoutSnapshotBounds {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum LayoutSnapshotWindowKind {
    ButtonEditor,
    ButtonPopout,
    ButtonFan,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum LayoutSnapshotButtonDisplayMode {
    Collapsed,
    Expanded,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase", deny_unknown_fields)]
pub(crate) struct LayoutSnapshotWindow {
    kind: LayoutSnapshotWindowKind,
    program_name: Option<String>,
    panel_name: Option<String>,
    button_popout_unit_id: Option<String>,
    button_fan_setup_id: Option<String>,
    button_owner_id: Option<String>,
    button_display_mode: Option<LayoutSnapshotButtonDisplayMode>,
    bounds: LayoutSnapshotBounds,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "PascalCase", deny_unknown_fields)]
pub(crate) struct LayoutSnapshotFile {
    saved_at: Option<String>,
    version: Option<u64>,
    layout_kind: Option<String>,
    selected_program_name: Option<String>,
    selected_panel_name: Option<String>,
    selected_file_names: Option<Vec<String>>,
    main_window_bounds: Option<LayoutSnapshotBounds>,
    windows: Option<Vec<LayoutSnapshotWindow>>,
}

fn validate_layout_snapshot(snapshot: &LayoutSnapshotFile) -> Result<(), String> {
    if snapshot.version != Some(LAYOUT_SNAPSHOT_VERSION) {
        return Err(format!(
            "Unsupported FlowCell layout version. Expected version {LAYOUT_SNAPSHOT_VERSION}."
        ));
    }
    if snapshot.layout_kind.as_deref() != Some(LAYOUT_SNAPSHOT_KIND) {
        return Err(format!(
            "Unsupported FlowCell layout kind. Expected {LAYOUT_SNAPSHOT_KIND}."
        ));
    }
    Ok(())
}

fn resolve_flowcell_layouts_root() -> Result<PathBuf, String> {
    let layouts_root = resolve_flowcell_local_root()?.join("layouts");
    fs::create_dir_all(&layouts_root).map_err(|error| {
        format!(
            "Failed to create layout folder at {}: {error}",
            layouts_root.display()
        )
    })?;
    Ok(layouts_root)
}

fn resolve_layout_dialog_directory(initial_directory: Option<String>) -> Result<PathBuf, String> {
    if let Some(raw_directory) = initial_directory {
        let trimmed_directory = raw_directory.trim();
        if !trimmed_directory.is_empty() {
            let candidate = PathBuf::from(trimmed_directory);
            if candidate.is_dir() {
                return Ok(candidate);
            }
        }
    }

    resolve_flowcell_layouts_root()
}

fn normalize_layout_file_path(path: &Path) -> PathBuf {
    let path_text = path.to_string_lossy().to_string();
    let lower_path = path_text.to_ascii_lowercase();
    if lower_path.ends_with(".flowlayout.json") || lower_path.ends_with(".json") {
        return PathBuf::from(path_text);
    }

    PathBuf::from(format!("{path_text}.flowlayout.json"))
}

fn resolve_existing_dialog_directory(initial_directory: Option<String>) -> Option<PathBuf> {
    let initial_directory = initial_directory?;
    let trimmed = initial_directory.trim();
    if trimmed.is_empty() {
        return None;
    }

    let candidate = PathBuf::from(trimmed);
    if candidate.is_dir() {
        return Some(candidate);
    }

    if candidate.is_file() {
        return candidate.parent().map(Path::to_path_buf);
    }

    candidate
        .parent()
        .filter(|parent| parent.is_dir())
        .map(Path::to_path_buf)
}

fn parse_dialog_filter_spec(filter: &str) -> Vec<(String, Vec<String>)> {
    let parts = filter
        .split('|')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let mut filters = Vec::new();
    let mut index = 0;

    while index + 1 < parts.len() {
        let label = parts[index].to_string();
        let patterns = parts[index + 1]
            .split(';')
            .map(str::trim)
            .filter_map(|pattern| {
                let normalized = pattern.trim().trim_matches('"').trim();
                if normalized.is_empty() || normalized == "*.*" || normalized == "*" {
                    return None;
                }

                let normalized = normalized
                    .trim_start_matches("*.")
                    .trim_start_matches('.')
                    .trim()
                    .to_ascii_lowercase();
                if normalized.is_empty() {
                    None
                } else {
                    Some(normalized)
                }
            })
            .collect::<Vec<_>>();

        if !patterns.is_empty() {
            filters.push((label, patterns));
        }

        index += 2;
    }

    filters
}

fn set_dialog_parent(
    app: &AppHandle,
    dialog: FileDialog,
    parent_label: Option<String>,
) -> FileDialog {
    let Some(label) = parent_label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return dialog;
    };
    let Some(parent_window) = app.get_webview_window(label) else {
        return dialog;
    };

    #[cfg(windows)]
    if let Ok(hwnd) = parent_window.hwnd() {
        let _ = unsafe { ShowWindowAsync(hwnd, SW_RESTORE) };
        let _ = unsafe { SetForegroundWindow(hwnd) };
    }

    let _ = parent_window.set_focus();

    dialog.set_parent(&parent_window)
}

#[tauri::command]
pub(crate) fn show_save_layout_dialog(
    app: AppHandle,
    suggested_name: String,
    initial_directory: Option<String>,
    parent_label: Option<String>,
) -> Result<Option<String>, String> {
    let initial_directory = resolve_layout_dialog_directory(initial_directory)?;
    let file_name = if suggested_name.trim().is_empty() {
        "layout.flowlayout.json".to_string()
    } else {
        suggested_name.trim().to_string()
    };
    let parent_label = parent_label.or_else(|| Some("main".to_string()));

    let selected_path = set_dialog_parent(
        &app,
        FileDialog::new()
            .set_title("Save Layout")
            .set_directory(initial_directory)
            .set_file_name(&file_name)
            .add_filter("FlowCell Layout", &["json"]),
        parent_label,
    )
    .save_file();

    Ok(selected_path.map(|path| normalize_layout_file_path(&path).display().to_string()))
}

#[tauri::command]
pub(crate) fn show_open_layout_dialog(
    app: AppHandle,
    initial_directory: Option<String>,
    parent_label: Option<String>,
) -> Result<Option<String>, String> {
    let initial_directory = resolve_layout_dialog_directory(initial_directory)?;
    let parent_label = parent_label.or_else(|| Some("main".to_string()));
    let selected_path = set_dialog_parent(
        &app,
        FileDialog::new()
            .set_title("Load Layout")
            .set_directory(initial_directory)
            .add_filter("FlowCell Layout", &["json"]),
        parent_label,
    )
    .pick_file();

    Ok(selected_path.map(|path| path.display().to_string()))
}

#[tauri::command]
pub(crate) fn show_open_file_dialog(
    app: AppHandle,
    title: String,
    filter: String,
    initial_directory: Option<String>,
    multiselect: bool,
    parent_label: Option<String>,
) -> Result<Vec<String>, String> {
    let mut dialog = set_dialog_parent(&app, FileDialog::new().set_title(&title), parent_label);
    if let Some(directory) = resolve_existing_dialog_directory(initial_directory) {
        dialog = dialog.set_directory(directory);
    }

    for (label, extensions) in parse_dialog_filter_spec(&filter) {
        let extension_refs = extensions.iter().map(String::as_str).collect::<Vec<_>>();
        dialog = dialog.add_filter(&label, &extension_refs);
    }

    let selected_paths = if multiselect {
        dialog.pick_files().unwrap_or_default()
    } else {
        dialog.pick_file().into_iter().collect()
    };

    Ok(selected_paths
        .into_iter()
        .map(|path| path.display().to_string())
        .collect())
}

#[tauri::command]
pub(crate) fn show_open_folder_dialog(
    app: AppHandle,
    title: String,
    initial_directory: Option<String>,
    multiselect: bool,
    parent_label: Option<String>,
) -> Result<Vec<String>, String> {
    let mut dialog = set_dialog_parent(&app, FileDialog::new().set_title(&title), parent_label);
    if let Some(directory) = resolve_existing_dialog_directory(initial_directory) {
        dialog = dialog.set_directory(directory);
    }

    let selected_paths = if multiselect {
        dialog.pick_folders().unwrap_or_default()
    } else {
        dialog.pick_folder().into_iter().collect()
    };

    Ok(selected_paths
        .into_iter()
        .map(|path| path.display().to_string())
        .collect())
}

#[tauri::command]
pub(crate) fn show_save_file_dialog(
    app: AppHandle,
    title: String,
    filter: String,
    default_file_name: Option<String>,
    initial_directory: Option<String>,
    parent_label: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = set_dialog_parent(&app, FileDialog::new().set_title(&title), parent_label);
    if let Some(directory) = resolve_existing_dialog_directory(initial_directory) {
        dialog = dialog.set_directory(directory);
    }
    if let Some(file_name) = default_file_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        dialog = dialog.set_file_name(file_name);
    }

    for (label, extensions) in parse_dialog_filter_spec(&filter) {
        let extension_refs = extensions.iter().map(String::as_str).collect::<Vec<_>>();
        dialog = dialog.add_filter(&label, &extension_refs);
    }

    Ok(dialog.save_file().map(|path| path.display().to_string()))
}

#[tauri::command]
pub(crate) fn save_layout_snapshot(
    path: String,
    snapshot: LayoutSnapshotFile,
) -> Result<String, String> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("Layout save path cannot be empty.".to_string());
    }
    validate_layout_snapshot(&snapshot)?;

    let layout_path = normalize_layout_file_path(Path::new(trimmed_path));
    if let Some(parent) = layout_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create layout folder at {}: {error}",
                parent.display()
            )
        })?;
    }

    let contents = serde_json::to_string_pretty(&snapshot)
        .map_err(|error| format!("Failed to serialize layout snapshot: {error}"))?;
    fs::write(&layout_path, contents).map_err(|error| {
        format!(
            "Failed to write layout snapshot at {}: {error}",
            layout_path.display()
        )
    })?;

    Ok(layout_path.display().to_string())
}

#[tauri::command]
pub(crate) fn load_layout_snapshot(path: String) -> Result<LayoutSnapshotFile, String> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("Layout load path cannot be empty.".to_string());
    }

    let layout_path = PathBuf::from(trimmed_path);
    let contents = fs::read_to_string(&layout_path).map_err(|error| {
        format!(
            "Failed to read layout snapshot at {}: {error}",
            layout_path.display()
        )
    })?;

    let snapshot = serde_json::from_str::<LayoutSnapshotFile>(&contents).map_err(|error| {
        format!(
            "Layout snapshot at {} is not valid JSON: {error}",
            layout_path.display()
        )
    })?;
    validate_layout_snapshot(&snapshot)?;
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn current_layout_json() -> &'static str {
        r#"{
            "SavedAt": "2026-07-10T00:00:00.000Z",
            "Version": 8,
            "LayoutKind": "FlowCellWindowLayout",
            "Windows": [{
                "Kind": "button-popout",
                "ButtonPopoutUnitId": "popout-1",
                "Bounds": { "Left": 10.0, "Top": 20.0, "Width": 300.0, "Height": 200.0 }
            }]
        }"#
    }

    #[test]
    fn current_button_layout_schema_is_accepted() {
        let snapshot = serde_json::from_str::<LayoutSnapshotFile>(current_layout_json())
            .expect("current layout should deserialize");
        assert!(validate_layout_snapshot(&snapshot).is_ok());
    }

    #[test]
    fn legacy_layout_fields_and_window_kinds_are_rejected() {
        let legacy_state_path = current_layout_json().replace(
            "\"Windows\"",
            "\"FlowCellStatePath\": \"old-state.json\", \"Windows\"",
        );
        assert!(serde_json::from_str::<LayoutSnapshotFile>(&legacy_state_path).is_err());

        let legacy_window = current_layout_json().replace("button-popout", "panel-fan");
        assert!(serde_json::from_str::<LayoutSnapshotFile>(&legacy_window).is_err());
    }

    #[test]
    fn non_current_layout_versions_are_rejected() {
        let old_version = current_layout_json().replace("\"Version\": 8", "\"Version\": 7");
        let snapshot = serde_json::from_str::<LayoutSnapshotFile>(&old_version)
            .expect("known fields should deserialize before version validation");
        assert!(validate_layout_snapshot(&snapshot).is_err());
    }
}
