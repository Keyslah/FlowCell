use crate::*;
use std::collections::HashSet;

const LAYOUT_SNAPSHOT_VERSION: u64 = 10;
const LEGACY_LAYOUT_SNAPSHOT_VERSION: u64 = 9;
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
    InstalledPage,
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
    panel_owner_button_id: Option<String>,
    button_display_mode: Option<LayoutSnapshotButtonDisplayMode>,
    button_popout_settings_path: Option<String>,
    button_popout_choice_id: Option<String>,
    installed_page_file_name: Option<String>,
    installed_page_id: Option<String>,
    bounds: LayoutSnapshotBounds,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "PascalCase", deny_unknown_fields)]
pub(crate) struct LayoutSnapshotFile {
    saved_at: String,
    version: u64,
    layout_kind: String,
    windows: Vec<LayoutSnapshotWindow>,
}

fn has_text(value: &Option<String>) -> bool {
    value.as_deref().is_some_and(|text| !text.trim().is_empty())
}

fn validate_layout_bounds(bounds: &LayoutSnapshotBounds) -> bool {
    bounds.left.is_finite()
        && bounds.top.is_finite()
        && bounds.width.is_finite()
        && bounds.height.is_finite()
        && bounds.width > 0.0
        && bounds.height > 0.0
        && !(bounds.left <= -30_000.0 && bounds.top <= -30_000.0)
}

fn validate_layout_snapshot(snapshot: &LayoutSnapshotFile) -> Result<(), String> {
    if snapshot.version != LAYOUT_SNAPSHOT_VERSION
        && snapshot.version != LEGACY_LAYOUT_SNAPSHOT_VERSION
    {
        return Err(format!(
            "Unsupported FlowCell layout version. Expected version {LEGACY_LAYOUT_SNAPSHOT_VERSION} or {LAYOUT_SNAPSHOT_VERSION}."
        ));
    }
    if snapshot.layout_kind != LAYOUT_SNAPSHOT_KIND {
        return Err(format!(
            "Unsupported FlowCell layout kind. Expected {LAYOUT_SNAPSHOT_KIND}."
        ));
    }
    if snapshot.saved_at.trim().is_empty() {
        return Err("FlowCell layout is missing its save timestamp.".to_string());
    }
    let mut stable_window_keys = HashSet::new();
    for window in &snapshot.windows {
        if snapshot.version == LEGACY_LAYOUT_SNAPSHOT_VERSION
            && (window.panel_owner_button_id.is_some()
                || window.button_popout_settings_path.is_some()
                || window.button_popout_choice_id.is_some())
        {
            return Err(
                "FlowCell layout version 9 does not support settings-backed Button Pop-outs."
                    .to_string(),
            );
        }
        if !validate_layout_bounds(&window.bounds) {
            return Err("FlowCell layout contains invalid window bounds.".to_string());
        }
        match &window.kind {
            LayoutSnapshotWindowKind::ButtonEditor => {
                if window.button_popout_unit_id.is_some()
                    || window.button_fan_setup_id.is_some()
                    || window.button_owner_id.is_some()
                    || window.panel_owner_button_id.is_some()
                    || window.button_display_mode.is_some()
                    || window.button_popout_settings_path.is_some()
                    || window.button_popout_choice_id.is_some()
                    || window.installed_page_file_name.is_some()
                    || window.installed_page_id.is_some()
                {
                    return Err(
                        "FlowCell layout contains fields that do not belong to a Button Editor."
                            .to_string(),
                    );
                }
            }
            LayoutSnapshotWindowKind::ButtonPopout => {
                if !has_text(&window.program_name)
                    || !has_text(&window.button_popout_unit_id)
                    || window.button_display_mode.is_none()
                {
                    return Err(
                        "FlowCell layout contains an incomplete Button Pop-out identity."
                            .to_string(),
                    );
                }
                if window.button_fan_setup_id.is_some()
                    || window.installed_page_file_name.is_some()
                    || window.installed_page_id.is_some()
                {
                    return Err(
                        "FlowCell layout contains fields that do not belong to a Button Pop-out."
                            .to_string(),
                    );
                }
                if window.panel_owner_button_id.is_some()
                    || window.button_popout_settings_path.is_some()
                    || window.button_popout_choice_id.is_some()
                {
                    if !has_text(&window.panel_name)
                        || !has_text(&window.panel_owner_button_id)
                        || !has_text(&window.button_popout_settings_path)
                        || !has_text(&window.button_popout_choice_id)
                    {
                        return Err(
                            "FlowCell layout contains an incomplete settings-backed Button Pop-out identity."
                                .to_string(),
                        );
                    }
                }
            }
            LayoutSnapshotWindowKind::ButtonFan => {
                if !has_text(&window.program_name)
                    || !has_text(&window.panel_name)
                    || !has_text(&window.button_fan_setup_id)
                    || !has_text(&window.button_owner_id)
                {
                    return Err(
                        "FlowCell layout contains an incomplete Button Fan identity.".to_string(),
                    );
                }
                if window.button_popout_unit_id.is_some()
                    || window.button_display_mode.is_some()
                    || window.panel_owner_button_id.is_some()
                    || window.button_popout_settings_path.is_some()
                    || window.button_popout_choice_id.is_some()
                    || window.installed_page_file_name.is_some()
                    || window.installed_page_id.is_some()
                {
                    return Err(
                        "FlowCell layout contains fields that do not belong to a Button Fan."
                            .to_string(),
                    );
                }
            }
            LayoutSnapshotWindowKind::InstalledPage => {
                if !has_text(&window.program_name)
                    || !has_text(&window.panel_name)
                    || !has_text(&window.button_owner_id)
                    || !has_text(&window.installed_page_file_name)
                    || !has_text(&window.installed_page_id)
                {
                    return Err(
                        "FlowCell layout contains an incomplete installed Page identity."
                            .to_string(),
                    );
                }
                if window.button_popout_unit_id.is_some()
                    || window.button_fan_setup_id.is_some()
                    || window.button_display_mode.is_some()
                    || window.panel_owner_button_id.is_some()
                    || window.button_popout_settings_path.is_some()
                    || window.button_popout_choice_id.is_some()
                {
                    return Err(
                        "FlowCell layout contains fields that do not belong to an installed Page."
                            .to_string(),
                    );
                }
            }
        }
        let mut window_keys = Vec::new();
        match &window.kind {
            LayoutSnapshotWindowKind::ButtonEditor => {
                window_keys.push("button-editor".to_string());
            }
            LayoutSnapshotWindowKind::ButtonPopout => {
                let stable_id = if has_text(&window.button_owner_id) {
                    window.button_owner_id.as_deref().unwrap_or_default()
                } else {
                    window.button_popout_unit_id.as_deref().unwrap_or_default()
                };
                window_keys.push(format!(
                    "button-popout:{}",
                    stable_id.trim()
                ));
            }
            LayoutSnapshotWindowKind::ButtonFan => {
                window_keys.push(format!(
                    "button-fan-owner:{}",
                    window.button_owner_id.as_deref().unwrap_or_default().trim()
                ));
            }
            LayoutSnapshotWindowKind::InstalledPage => {
                window_keys.push(format!(
                    "installed-page-owner:{}",
                    window.button_owner_id.as_deref().unwrap_or_default().trim()
                ));
            }
        }
        if window_keys
            .into_iter()
            .any(|key| !stable_window_keys.insert(key))
        {
            return Err("FlowCell layout contains a duplicate managed-window identity.".to_string());
        }
    }
    Ok(())
}

fn resolve_main_page_layouts_root() -> Result<PathBuf, String> {
    let layouts_root = resolve_flowcell_local_root()?
        .join("layouts")
        .join("Main Page");
    fs::create_dir_all(&layouts_root).map_err(|error| {
        format!(
            "Failed to create Main Page layout folder at {}: {error}",
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

    resolve_main_page_layouts_root()
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
            "Version": 10,
            "LayoutKind": "FlowCellWindowLayout",
            "Windows": [
                {
                    "Kind": "button-editor",
                    "Bounds": { "Left": 0.0, "Top": 0.0, "Width": 1200.0, "Height": 800.0 }
                },
                {
                    "Kind": "button-popout",
                    "ProgramName": "Blender",
                    "ButtonPopoutUnitId": "popout-1",
                    "ButtonDisplayMode": "expanded",
                    "Bounds": { "Left": 10.0, "Top": 20.0, "Width": 300.0, "Height": 200.0 }
                },
                {
                    "Kind": "button-fan",
                    "ProgramName": "Blender",
                    "PanelName": "Files",
                    "ButtonFanSetupId": "fan-1",
                    "ButtonOwnerId": "owner-1",
                    "Bounds": { "Left": 40.0, "Top": 50.0, "Width": 260.0, "Height": 180.0 }
                },
                {
                    "Kind": "button-popout",
                    "ProgramName": "Illustrator",
                    "PanelName": "Layers Builder",
                    "ButtonPopoutUnitId": "open-pop-unit-layers",
                    "PanelOwnerButtonId": "owner-layers",
                    "ButtonDisplayMode": "expanded",
                    "ButtonPopoutSettingsPath": "C:/FlowCell/layers.flowcell-button-settings.json",
                    "ButtonPopoutChoiceId": "layers-choice",
                    "Bounds": { "Left": 60.0, "Top": 70.0, "Width": 360.0, "Height": 220.0 }
                },
                {
                    "Kind": "installed-page",
                    "ProgramName": "Illustrator",
                    "PanelName": "Layers",
                    "ButtonOwnerId": "owner-page",
                    "InstalledPageFileName": "layers.jsx",
                    "InstalledPageId": "layers-builder",
                    "Bounds": { "Left": 80.0, "Top": 90.0, "Width": 900.0, "Height": 700.0 }
                }
            ]
        }"#
    }

    fn legacy_layout_json() -> &'static str {
        r#"{
            "SavedAt": "2026-07-10T00:00:00.000Z",
            "Version": 9,
            "LayoutKind": "FlowCellWindowLayout",
            "Windows": [
                {
                    "Kind": "button-popout",
                    "ProgramName": "Blender",
                    "ButtonPopoutUnitId": "popout-1",
                    "ButtonDisplayMode": "expanded",
                    "Bounds": { "Left": 10.0, "Top": 20.0, "Width": 300.0, "Height": 200.0 }
                }
            ]
        }"#
    }

    #[test]
    fn current_button_layout_schema_is_accepted() {
        let snapshot = serde_json::from_str::<LayoutSnapshotFile>(current_layout_json())
            .expect("current layout should deserialize");
        assert!(validate_layout_snapshot(&snapshot).is_ok());
    }

    #[test]
    fn legacy_button_layout_schema_is_accepted() {
        let snapshot = serde_json::from_str::<LayoutSnapshotFile>(legacy_layout_json())
            .expect("legacy layout should deserialize");
        assert!(validate_layout_snapshot(&snapshot).is_ok());
    }

    #[test]
    fn main_page_state_is_not_part_of_the_layout_schema() {
        let main_state = current_layout_json().replace(
            "\"Windows\"",
            "\"MainWindowBounds\": { \"Left\": 0.0, \"Top\": 0.0, \"Width\": 100.0, \"Height\": 100.0 }, \"Windows\"",
        );
        assert!(serde_json::from_str::<LayoutSnapshotFile>(&main_state).is_err());
    }

    #[test]
    fn non_current_layout_versions_are_rejected() {
        let old_version = current_layout_json().replace("\"Version\": 10", "\"Version\": 8");
        let snapshot = serde_json::from_str::<LayoutSnapshotFile>(&old_version)
            .expect("known fields should deserialize before version validation");
        assert!(validate_layout_snapshot(&snapshot).is_err());

        let settings_backed_v9 = current_layout_json().replace("\"Version\": 10", "\"Version\": 9");
        let snapshot = serde_json::from_str::<LayoutSnapshotFile>(&settings_backed_v9)
            .expect("known fields should deserialize before version validation");
        assert!(validate_layout_snapshot(&snapshot).is_err());
    }

    #[test]
    fn incomplete_window_identity_and_invalid_bounds_are_rejected() {
        let incomplete_popout = current_layout_json().replace(
            "\"ProgramName\": \"Blender\",\n                    \"ButtonPopoutUnitId\": \"popout-1\",",
            "\"ButtonPopoutUnitId\": \"popout-1\",",
        );
        let snapshot = serde_json::from_str::<LayoutSnapshotFile>(&incomplete_popout)
            .expect("known fields should deserialize");
        assert!(validate_layout_snapshot(&snapshot).is_err());

        let missing_display_mode = current_layout_json().replace(
            "\"ButtonDisplayMode\": \"expanded\",\n                    ",
            "",
        );
        let snapshot = serde_json::from_str::<LayoutSnapshotFile>(&missing_display_mode)
            .expect("known fields should deserialize");
        assert!(validate_layout_snapshot(&snapshot).is_err());

        let cross_kind_field = current_layout_json().replace(
            "\"ButtonFanSetupId\": \"fan-1\",",
            "\"ButtonFanSetupId\": \"fan-1\",\n                    \"InstalledPageId\": \"wrong-kind\",",
        );
        let snapshot = serde_json::from_str::<LayoutSnapshotFile>(&cross_kind_field)
            .expect("known fields should deserialize");
        assert!(validate_layout_snapshot(&snapshot).is_err());

        let incomplete_settings_backed_popout = current_layout_json().replace(
            "\"PanelOwnerButtonId\": \"owner-layers\",\n                    ",
            "",
        );
        let snapshot =
            serde_json::from_str::<LayoutSnapshotFile>(&incomplete_settings_backed_popout)
                .expect("known fields should deserialize");
        assert!(validate_layout_snapshot(&snapshot).is_err());

        let settings_backed_cross_kind_field = current_layout_json().replace(
            "\"ButtonPopoutChoiceId\": \"layers-choice\",",
            "\"ButtonPopoutChoiceId\": \"layers-choice\",\n                    \"ButtonFanSetupId\": \"wrong-kind\",",
        );
        let snapshot =
            serde_json::from_str::<LayoutSnapshotFile>(&settings_backed_cross_kind_field)
                .expect("known fields should deserialize");
        assert!(validate_layout_snapshot(&snapshot).is_err());

        let invalid_bounds = current_layout_json().replace("\"Width\": 900.0", "\"Width\": 0.0");
        let snapshot = serde_json::from_str::<LayoutSnapshotFile>(&invalid_bounds)
            .expect("known fields should deserialize");
        assert!(validate_layout_snapshot(&snapshot).is_err());

        let minimized_bounds = current_layout_json().replace(
            "\"Left\": 80.0, \"Top\": 90.0",
            "\"Left\": -32000.0, \"Top\": -32000.0",
        );
        let snapshot = serde_json::from_str::<LayoutSnapshotFile>(&minimized_bounds)
            .expect("known fields should deserialize");
        assert!(validate_layout_snapshot(&snapshot).is_err());
    }

    #[test]
    fn duplicate_stable_window_identities_are_rejected() {
        for index in 0..5 {
            let mut snapshot = serde_json::from_str::<LayoutSnapshotFile>(current_layout_json())
                .expect("current layout should deserialize");
            snapshot.windows.push(snapshot.windows[index].clone());
            assert!(validate_layout_snapshot(&snapshot).is_err());
        }

        let mut snapshot = serde_json::from_str::<LayoutSnapshotFile>(current_layout_json())
            .expect("current layout should deserialize");
        let mut colliding_popout = snapshot.windows[1].clone();
        colliding_popout.button_popout_unit_id = Some("different-unit".to_string());
        colliding_popout.button_owner_id = Some("popout-1".to_string());
        snapshot.windows.push(colliding_popout);
        assert!(validate_layout_snapshot(&snapshot).is_err());

        let mut snapshot = serde_json::from_str::<LayoutSnapshotFile>(current_layout_json())
            .expect("current layout should deserialize");
        let mut same_owner_different_settings_file = snapshot.windows[3].clone();
        same_owner_different_settings_file.button_popout_settings_path =
            Some("C:/FlowCell/other-layers.flowcell-button-settings.json".to_string());
        snapshot.windows.push(same_owner_different_settings_file);
        assert!(validate_layout_snapshot(&snapshot).is_err());
    }
}
