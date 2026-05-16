#![cfg_attr(windows, windows_subsystem = "windows")]

use image::imageops::FilterType;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::utils::config::WindowConfig;
use tauri::{AppHandle, Manager, State, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use windows_sys::Win32::Foundation::CloseHandle;
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, CREATE_NO_WINDOW, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

#[derive(Clone)]
struct AppPaths {
    repo_root: PathBuf,
    flowcell_root: PathBuf,
    local_root: PathBuf,
    logs_root: PathBuf,
    frontend_log_path: PathBuf,
}

#[derive(Default)]
struct RuntimeState {
    paths: Mutex<Option<AppPaths>>,
    window_contexts: Mutex<HashMap<String, WindowContext>>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    repo_root: String,
    flow_cell_root: String,
    state_path: String,
    frontend_log_path: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct ForegroundProcessInfo {
    process_name: String,
    process_path: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct SampledPhotoThemeColors {
    headers_hex: String,
    text_hex: String,
    section_fill_hex: String,
    controls_hex: String,
    misc_hex: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct SavedBlenderThemeFile {
    format: String,
    saved_at: String,
    values: Value,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct LoadStateResponse {
    state: Value,
    runtime: RuntimeInfo,
    bindings: FlowCellBindingsState,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct FlowCellScriptBinding {
    id: i64,
    shortcut: String,
    target: String,
    status: String,
    program_tab_id: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct FlowCellBindingsState {
    next_id: i64,
    script_bindings: Vec<FlowCellScriptBinding>,
    action_hotkeys: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct ButtonBindingMutationRequest {
    kind: String,
    program_tab_id: i64,
    target: String,
    shortcut: Option<String>,
    binding_id: Option<i64>,
    label: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct BindingMutationResult {
    message: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct WindowContext {
    kind: String,
    program_id: Option<i64>,
    panel_id: Option<String>,
    panel_name: Option<String>,
    owner_button_id: Option<String>,
    button_ids: Option<Vec<String>>,
    layout_mode: Option<String>,
    button_label: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct FlowCellBounds {
    #[serde(rename = "Left")]
    left: f64,
    #[serde(rename = "Top")]
    top: f64,
    #[serde(rename = "Width")]
    width: f64,
    #[serde(rename = "Height")]
    height: f64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct FlowCellCommandEnvelope {
    command_id: String,
    program_id: i64,
    panel_id: String,
    button_id: String,
    owner_button_id: Option<String>,
    child_slot_id: Option<String>,
    tool_action: Option<String>,
    #[serde(default)]
    payload: Value,
    source_surface: Option<String>,
    request_id: Option<String>,
    timestamp: String,
    style_group_id: Option<String>,
    tool_option_state: Option<Value>,
    #[serde(default)]
    program: Value,
}

#[derive(Serialize, Deserialize, Clone)]
struct GatewayCommandResult {
    ok: bool,
    request_id: String,
    status: String,
    message: String,
    details: Value,
    logs: Vec<String>,
    exit_code: i32,
    duration_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct SavedLayoutFile {
    name: String,
    display_name: String,
    path: String,
    details: String,
    saved_at: Option<String>,
    modified_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct RecordedMacroChoice {
    id: String,
    label: String,
    path: String,
    created_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct RecordedMacroStep {
    section: Option<String>,
    #[serde(rename = "type")]
    step_type: String,
    delay_ms: i64,
    x: Option<String>,
    y: Option<String>,
    button: Option<String>,
    count: Option<String>,
    direction: Option<String>,
    text: Option<String>,
    keys: Option<String>,
    script_path: Option<String>,
    macro_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct RecordedMacroDefinition {
    path: String,
    file_name: String,
    id: String,
    label: String,
    created_at: Option<String>,
    steps: Vec<RecordedMacroStep>,
}

#[derive(Clone, Default)]
struct ScriptBindingEntry {
    id: i64,
    shortcut: String,
    target: String,
    program_tab_id: i64,
}

#[derive(Clone, Default)]
struct RawIniSection {
    name: String,
    entries: Vec<(String, String)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SampleRgb {
    r: u8,
    g: u8,
    b: u8,
}

#[derive(Default)]
struct ColorBucketStats {
    count: u32,
    r_sum: u64,
    g_sum: u64,
    b_sum: u64,
}

#[derive(Clone, Copy)]
struct PaletteCandidate {
    color: SampleRgb,
    count: u32,
}

#[derive(Clone, Default)]
struct BindingsConfig {
    next_id: i64,
    program_tab_next_id: i64,
    selected_program_tab_id: i64,
    program_tab_ids: Vec<i64>,
    program_tabs: Vec<(i64, Vec<(String, String)>)>,
    script_bindings: Vec<ScriptBindingEntry>,
    action_hotkeys: BTreeMap<String, String>,
    macro_editor_columns: Vec<(String, String)>,
    other_sections: Vec<RawIniSection>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct ManagedScriptInstallResultItem {
    label: Option<String>,
    tooltip: Option<String>,
    source_path: String,
    active_path: String,
    execution_target: String,
    installed: bool,
    message: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct ManagedScriptInstallResult {
    installed_count: usize,
    failed_count: usize,
    status_message: String,
    reload_required: bool,
    reload_reason: Option<String>,
    results: Vec<ManagedScriptInstallResultItem>,
}

#[derive(Clone)]
struct ManagedProgramFolders {
    // active_root stores FlowTest-managed source copies; runtime_root is the actual execution layer.
    active_root: PathBuf,
    runtime_root: PathBuf,
    source_root: Option<PathBuf>,
    allowed_extensions: Vec<&'static str>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct BlenderButtonDescriptionUpdateRequest {
    button_target: String,
    execution_target: Option<String>,
    description: String,
}

#[derive(Clone, Default)]
struct ManagedInstallOptions {
    blender_bridge_folder: Option<PathBuf>,
    blender_skip_sync: bool,
}

fn ensure_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| error.to_string())
}

fn normalize_path_key(path: &Path) -> String {
    path.display()
        .to_string()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    let normalized_path = normalize_path_key(path);
    let normalized_root = normalize_path_key(root);
    normalized_path == normalized_root || normalized_path.starts_with(&(normalized_root + "\\"))
}

fn copy_file_overwrite(source: &Path, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        ensure_directory(parent)?;
    }
    fs::copy(source, destination).map(|_| ()).map_err(|error| {
        format!(
            "Could not copy {} to {}: {}",
            source.display(),
            destination.display(),
            error
        )
    })
}

fn copy_directory_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    ensure_directory(destination)?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_directory_recursive(&source_path, &destination_path)?;
        } else if source_path.is_file() {
            copy_file_overwrite(&source_path, &destination_path)?;
        }
    }
    Ok(())
}

fn stage_selected_path(
    source: &Path,
    target_root: &Path,
    source_root: Option<&Path>,
) -> Result<PathBuf, String> {
    let source_path = source
        .canonicalize()
        .unwrap_or_else(|_| source.to_path_buf());
    if path_is_within(&source_path, target_root) {
        return Ok(source_path);
    }

    if let Some(root) = source_root {
        let source_root_path = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
        if path_is_within(&source_path, &source_root_path) {
            if let Ok(relative_path) = source_path.strip_prefix(&source_root_path) {
                let destination_path = target_root.join(relative_path);
                if source_path.is_dir() {
                    copy_directory_recursive(&source_path, &destination_path)?;
                } else if source_path.is_file() {
                    copy_file_overwrite(&source_path, &destination_path)?;
                } else {
                    return Err(format!(
                        "Selected path was not a file or folder: {}",
                        source.display()
                    ));
                }
                return Ok(destination_path);
            }
        }
    }

    let leaf_name = source_path.file_name().ok_or_else(|| {
        format!(
            "Could not determine a file or folder name for {}",
            source.display()
        )
    })?;
    let destination_path = target_root.join(leaf_name);
    if source_path.is_dir() {
        copy_directory_recursive(&source_path, &destination_path)?;
    } else if source_path.is_file() {
        copy_file_overwrite(&source_path, &destination_path)?;
    } else {
        return Err(format!(
            "Selected path was not a file or folder: {}",
            source.display()
        ));
    }
    Ok(destination_path)
}

fn collect_files_recursive(root: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    if root.is_file() {
        files.push(root.to_path_buf());
        return Ok(());
    }
    if !root.is_dir() {
        return Ok(());
    }

    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            collect_files_recursive(&path, files)?;
        } else if path.is_file() {
            files.push(path);
        }
    }
    Ok(())
}

fn is_allowed_script_file(path: &Path, allowed_extensions: &[&str]) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{}", value).to_lowercase())
        .map(|value| {
            allowed_extensions
                .iter()
                .any(|candidate| *candidate == value)
        })
        .unwrap_or(false)
}

fn button_label_from_path(path: &Path) -> String {
    let file_stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path.display().to_string());
    let without_prefix = file_stem
        .strip_prefix("org_")
        .or_else(|| file_stem.strip_prefix("file_"))
        .or_else(|| file_stem.strip_prefix("util_"))
        .unwrap_or(&file_stem);
    without_prefix.replace(['_', '-'], " ").trim().to_string()
}

fn managed_program_folders(
    repo_root: &Path,
    program_key: &str,
) -> Result<ManagedProgramFolders, String> {
    match program_key.trim().to_lowercase().as_str() {
        "blender" => Ok(ManagedProgramFolders {
            active_root: repo_root.join("Blender").join("Blender Active Scripts"),
            runtime_root: repo_root.join("Blender").join("FlowCellButtons"),
            source_root: Some(repo_root.join("Blender").join("Blender Scripts")),
            allowed_extensions: vec![".py", ".ps1"],
        }),
        "windows" => Ok(ManagedProgramFolders {
            active_root: repo_root.join("Windows").join("Windows Active Scripts"),
            runtime_root: repo_root.join("Windows").join("Windows Active Scripts"),
            source_root: None,
            allowed_extensions: vec![".ps1", ".cmd", ".bat", ".exe", ".lnk", ".vbs", ".ahk"],
        }),
        "illustrator" => Ok(ManagedProgramFolders {
            active_root: repo_root
                .join("Illustrator")
                .join("Illustrator Active Scripts"),
            runtime_root: PathBuf::from(
                r"C:\Program Files\Adobe\Adobe Illustrator 2026\Presets\en_US\Scripts",
            ),
            source_root: None,
            allowed_extensions: vec![".jsx", ".js"],
        }),
        "photoshop" => Ok(ManagedProgramFolders {
            active_root: repo_root.join("Photoshop").join("Photoshop Active Scripts"),
            runtime_root: PathBuf::from(
                r"C:\Program Files\Adobe\Adobe Photoshop 2026\Presets\Scripts",
            ),
            source_root: None,
            allowed_extensions: vec![".jsx", ".js"],
        }),
        other => Err(format!("Unsupported program key: {}", other)),
    }
}

fn locate_repo_root() -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir);
    }

    if let Ok(executable_path) = std::env::current_exe() {
        if let Some(parent) = executable_path.parent() {
            candidates.push(parent.to_path_buf());
        }
    }

    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        candidates.push(PathBuf::from(manifest_dir));
    }

    for candidate in candidates {
        for parent in candidate.ancestors() {
            let repo_marker = parent.join("PROGRAM_SUMMARY.txt");
            let backend_marker = parent.join("FlowCell").join("FlowCellCommandBackend.ps1");
            if repo_marker.exists() && backend_marker.exists() {
                return Ok(parent.to_path_buf());
            }
        }
    }

    Err("Unable to locate the FlowCell repository root.".to_string())
}

fn build_paths() -> Result<AppPaths, String> {
    let repo_root = locate_repo_root()?;
    let flowcell_root = repo_root.join("FlowCell");
    let local_root = flowcell_root.join("local");
    let logs_root = local_root.join("logs");
    ensure_directory(&logs_root)?;

    Ok(AppPaths {
        repo_root,
        flowcell_root,
        local_root,
        logs_root: logs_root.clone(),
        frontend_log_path: logs_root.join("frontend-tauri.log"),
    })
}

fn with_paths(state: &RuntimeState) -> Result<AppPaths, String> {
    state
        .paths
        .lock()
        .map_err(|_| "Runtime path lock failed.".to_string())?
        .clone()
        .ok_or_else(|| "Runtime paths are not initialized.".to_string())
}

fn write_frontend_log(paths: &AppPaths, message: &str) -> Result<(), String> {
    ensure_directory(&paths.logs_root)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let mut handle = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.frontend_log_path)
        .map_err(|error| error.to_string())?;
    writeln!(handle, "[{}] {}", timestamp, message).map_err(|error| error.to_string())
}

fn rgb_to_hex(color: SampleRgb) -> String {
    format!("#{:02X}{:02X}{:02X}", color.r, color.g, color.b)
}

fn srgb_channel_to_linear(value: u8) -> f64 {
    let normalized = f64::from(value) / 255.0;
    if normalized <= 0.04045 {
        normalized / 12.92
    } else {
        ((normalized + 0.055) / 1.055).powf(2.4)
    }
}

fn relative_luminance(color: SampleRgb) -> f64 {
    0.2126 * srgb_channel_to_linear(color.r)
        + 0.7152 * srgb_channel_to_linear(color.g)
        + 0.0722 * srgb_channel_to_linear(color.b)
}

fn contrast_ratio(left: SampleRgb, right: SampleRgb) -> f64 {
    let left_luma = relative_luminance(left);
    let right_luma = relative_luminance(right);
    let (lighter, darker) = if left_luma >= right_luma {
        (left_luma, right_luma)
    } else {
        (right_luma, left_luma)
    };
    (lighter + 0.05) / (darker + 0.05)
}

fn color_distance_sq(left: SampleRgb, right: SampleRgb) -> u32 {
    let dr = i32::from(left.r) - i32::from(right.r);
    let dg = i32::from(left.g) - i32::from(right.g);
    let db = i32::from(left.b) - i32::from(right.b);
    (dr * dr + dg * dg + db * db) as u32
}

fn color_saturation(color: SampleRgb) -> f64 {
    let red = f64::from(color.r) / 255.0;
    let green = f64::from(color.g) / 255.0;
    let blue = f64::from(color.b) / 255.0;
    let max_value = red.max(green).max(blue);
    let min_value = red.min(green).min(blue);
    if max_value <= 0.0 {
        0.0
    } else {
        (max_value - min_value) / max_value
    }
}

fn quantize_channel(value: u8) -> u8 {
    value / 24
}

fn resolve_sampled_text_color(text_color: SampleRgb, section_fill_color: SampleRgb) -> SampleRgb {
    if contrast_ratio(text_color, section_fill_color) >= 4.5 {
        return text_color;
    }
    let black = SampleRgb {
        r: 12,
        g: 12,
        b: 12,
    };
    let white = SampleRgb {
        r: 244,
        g: 244,
        b: 244,
    };
    if contrast_ratio(black, section_fill_color) >= contrast_ratio(white, section_fill_color) {
        black
    } else {
        white
    }
}

fn fill_palette_to_five(colors: &mut Vec<SampleRgb>) {
    let fallbacks = [
        SampleRgb {
            r: 32,
            g: 32,
            b: 32,
        },
        SampleRgb {
            r: 240,
            g: 240,
            b: 240,
        },
        SampleRgb {
            r: 96,
            g: 96,
            b: 96,
        },
    ];
    let seed = colors.first().copied().unwrap_or(fallbacks[0]);
    while colors.len() < 5 {
        let next = fallbacks
            .get(colors.len().saturating_sub(1))
            .copied()
            .unwrap_or(seed);
        colors.push(next);
    }
}

fn pick_photo_theme_colors(path: &Path) -> Result<SampledPhotoThemeColors, String> {
    if !path.is_file() {
        return Err(format!("Image file was not found: {}", path.display()));
    }

    let image = image::open(path).map_err(|error| format!("Unable to read image: {}", error))?;
    let resized = image.resize(160, 160, FilterType::Triangle).to_rgba8();
    let mut buckets: HashMap<(u8, u8, u8), ColorBucketStats> = HashMap::new();

    for pixel in resized.pixels() {
        if pixel[3] < 24 {
            continue;
        }
        let key = (
            quantize_channel(pixel[0]),
            quantize_channel(pixel[1]),
            quantize_channel(pixel[2]),
        );
        let entry = buckets.entry(key).or_default();
        entry.count += 1;
        entry.r_sum += u64::from(pixel[0]);
        entry.g_sum += u64::from(pixel[1]);
        entry.b_sum += u64::from(pixel[2]);
    }

    if buckets.is_empty() {
        return Err("Image did not contain enough readable opaque pixels.".to_string());
    }

    let mut candidates = buckets
        .into_iter()
        .filter_map(|(_key, bucket)| {
            (bucket.count > 0).then_some(PaletteCandidate {
                color: SampleRgb {
                    r: (bucket.r_sum / u64::from(bucket.count)) as u8,
                    g: (bucket.g_sum / u64::from(bucket.count)) as u8,
                    b: (bucket.b_sum / u64::from(bucket.count)) as u8,
                },
                count: bucket.count,
            })
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| right.count.cmp(&left.count));

    let mut distinct = Vec::<PaletteCandidate>::new();
    for threshold in [42_u32, 28_u32, 18_u32, 0_u32] {
        for candidate in &candidates {
            if distinct
                .iter()
                .any(|existing| existing.color == candidate.color)
            {
                continue;
            }
            if distinct.iter().all(|existing| {
                color_distance_sq(existing.color, candidate.color) >= threshold * threshold
            }) {
                distinct.push(*candidate);
            }
            if distinct.len() >= 8 {
                break;
            }
        }
        if distinct.len() >= 5 {
            break;
        }
    }

    if distinct.is_empty() {
        return Err("Image sampling did not produce a usable palette.".to_string());
    }

    let mut available = distinct;
    let section_fill_index = available
        .iter()
        .enumerate()
        .max_by(|(_left_index, left), (_right_index, right)| {
            let left_luma = relative_luminance(left.color);
            let right_luma = relative_luminance(right.color);
            let left_score = f64::from(left.count) - ((left_luma - 0.45).abs() * 120.0);
            let right_score = f64::from(right.count) - ((right_luma - 0.45).abs() * 120.0);
            left_score
                .partial_cmp(&right_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(index, _)| index)
        .unwrap_or(0);
    let section_fill_color = available.remove(section_fill_index).color;

    let text_index = available
        .iter()
        .enumerate()
        .max_by(|(_left_index, left), (_right_index, right)| {
            contrast_ratio(left.color, section_fill_color)
                .partial_cmp(&contrast_ratio(right.color, section_fill_color))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(index, _)| index)
        .unwrap_or(0);
    let text_color = if available.is_empty() {
        resolve_sampled_text_color(section_fill_color, section_fill_color)
    } else {
        resolve_sampled_text_color(available.remove(text_index).color, section_fill_color)
    };

    let controls_index = available
        .iter()
        .enumerate()
        .max_by(|(_left_index, left), (_right_index, right)| {
            let left_score = color_saturation(left.color) * 100.0 + f64::from(left.count) * 0.01;
            let right_score = color_saturation(right.color) * 100.0 + f64::from(right.count) * 0.01;
            left_score
                .partial_cmp(&right_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(index, _)| index)
        .unwrap_or(0);
    let controls_color = if available.is_empty() {
        section_fill_color
    } else {
        available.remove(controls_index).color
    };

    let headers_index = available
        .iter()
        .enumerate()
        .max_by(|(_left_index, left), (_right_index, right)| {
            let left_score =
                f64::from(left.count) + contrast_ratio(left.color, section_fill_color) * 10.0;
            let right_score =
                f64::from(right.count) + contrast_ratio(right.color, section_fill_color) * 10.0;
            left_score
                .partial_cmp(&right_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(index, _)| index)
        .unwrap_or(0);
    let headers_color = if available.is_empty() {
        controls_color
    } else {
        available.remove(headers_index).color
    };

    let misc_color = available
        .first()
        .map(|candidate| candidate.color)
        .unwrap_or(headers_color);

    let mut palette = vec![
        headers_color,
        text_color,
        section_fill_color,
        controls_color,
        misc_color,
    ];
    fill_palette_to_five(&mut palette);

    Ok(SampledPhotoThemeColors {
        headers_hex: rgb_to_hex(palette[0]),
        text_hex: rgb_to_hex(palette[1]),
        section_fill_hex: rgb_to_hex(palette[2]),
        controls_hex: rgb_to_hex(palette[3]),
        misc_hex: rgb_to_hex(palette[4]),
    })
}

fn state_path(paths: &AppPaths) -> PathBuf {
    paths.local_root.join("flowcell_state.json")
}

fn layouts_root(paths: &AppPaths) -> PathBuf {
    paths.local_root.join("layouts")
}

fn blender_theme_root(paths: &AppPaths) -> PathBuf {
    paths
        .repo_root
        .join("Blender")
        .join("appearance")
        .join("themes")
}

fn recorded_actions_root(paths: &AppPaths) -> PathBuf {
    paths.local_root.join("recorded_actions")
}

fn sanitize_theme_file_stem(value: &str) -> String {
    let trimmed = value.trim();
    let mut sanitized = String::with_capacity(trimmed.len());
    let mut last_was_separator = false;
    for character in trimmed.chars() {
        if character.is_ascii_alphanumeric() {
            sanitized.push(character);
            last_was_separator = false;
            continue;
        }
        if matches!(character, ' ' | '-' | '_' | '.') && !last_was_separator {
            sanitized.push('_');
            last_was_separator = true;
        }
    }
    let cleaned = sanitized.trim_matches('_').to_string();
    if cleaned.is_empty() {
        "blender_theme".to_string()
    } else {
        cleaned
    }
}

fn bindings_path(paths: &AppPaths) -> PathBuf {
    paths.local_root.join("bindings.ini")
}

fn decode_utf16_le(bytes: &[u8]) -> String {
    let values = bytes
        .chunks(2)
        .filter(|chunk| chunk.len() == 2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect::<Vec<_>>();
    String::from_utf16_lossy(&values)
}

fn decode_utf16_be(bytes: &[u8]) -> String {
    let values = bytes
        .chunks(2)
        .filter(|chunk| chunk.len() == 2)
        .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
        .collect::<Vec<_>>();
    String::from_utf16_lossy(&values)
}

fn read_text_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Ok(decode_utf16_le(&bytes[2..]));
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Ok(decode_utf16_be(&bytes[2..]));
    }
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Ok(String::from_utf8_lossy(&bytes[3..]).to_string());
    }
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

fn write_utf16le_text(path: &Path, text: &str) -> Result<(), String> {
    let mut bytes = vec![0xFF, 0xFE];
    text.encode_utf16()
        .for_each(|unit| bytes.extend_from_slice(&unit.to_le_bytes()));
    fs::write(path, bytes).map_err(|error| error.to_string())
}

fn default_macro_editor_columns() -> Vec<(String, String)> {
    vec![
        ("Number".to_string(), "44".to_string()),
        ("Type".to_string(), "130".to_string()),
        ("Delay".to_string(), "84".to_string()),
        ("X".to_string(), "84".to_string()),
        ("Y".to_string(), "84".to_string()),
        ("Button".to_string(), "94".to_string()),
        ("Count".to_string(), "78".to_string()),
        ("Direction".to_string(), "104".to_string()),
        ("Text".to_string(), "260".to_string()),
        ("Keys".to_string(), "230".to_string()),
        ("Script".to_string(), "320".to_string()),
    ]
}

fn canonicalize_shortcut(value: &str) -> String {
    let compact = value.split_whitespace().collect::<String>();
    if compact.is_empty() {
        return String::new();
    }

    compact
        .replace("<^>!", "__FLOWCELL_ALTGR__")
        .replace("<^", "^")
        .replace(">^", "^")
        .replace("<!", "!")
        .replace(">!", "!")
        .replace("<+", "+")
        .replace(">+", "+")
        .replace("<#", "#")
        .replace(">#", "#")
        .replace("__FLOWCELL_ALTGR__", "<^>!")
}

fn normalize_shortcut(value: &str) -> String {
    canonicalize_shortcut(value)
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>()
        .to_lowercase()
}

fn parse_i64(value: &str) -> Option<i64> {
    value.trim().parse::<i64>().ok()
}

fn parse_ini_sections(text: &str) -> Vec<RawIniSection> {
    let mut sections: Vec<RawIniSection> = Vec::new();
    let mut current_name: Option<String> = None;
    let mut current_entries: Vec<(String, String)> = Vec::new();

    for raw_line in text.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') {
            continue;
        }
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            if let Some(name) = current_name.take() {
                sections.push(RawIniSection {
                    name,
                    entries: current_entries,
                });
            }
            current_name = Some(trimmed[1..trimmed.len() - 1].trim().to_string());
            current_entries = Vec::new();
            continue;
        }
        if let Some((key, value)) = trimmed.split_once('=') {
            current_entries.push((key.trim().to_string(), value.trim().to_string()));
        }
    }

    if let Some(name) = current_name.take() {
        sections.push(RawIniSection {
            name,
            entries: current_entries,
        });
    }

    sections
}

fn parse_bindings_config(path: &Path) -> Result<BindingsConfig, String> {
    if !path.exists() {
        return Ok(BindingsConfig {
            next_id: 1,
            macro_editor_columns: default_macro_editor_columns(),
            ..BindingsConfig::default()
        });
    }

    let text = read_text_file(path)?;
    let sections = parse_ini_sections(&text);

    let mut config = BindingsConfig {
        next_id: 1,
        macro_editor_columns: default_macro_editor_columns(),
        ..BindingsConfig::default()
    };
    let mut discovered_program_tabs: BTreeMap<i64, Vec<(String, String)>> = BTreeMap::new();

    sections
        .into_iter()
        .for_each(|section| match section.name.as_str() {
            "Meta" => {
                section
                    .entries
                    .iter()
                    .for_each(|(key, value)| match key.as_str() {
                        "NextId" => {
                            if let Some(parsed) = parse_i64(value) {
                                config.next_id = parsed.max(1);
                            }
                        }
                        "ProgramTabNextId" => {
                            if let Some(parsed) = parse_i64(value) {
                                config.program_tab_next_id = parsed.max(1);
                            }
                        }
                        "SelectedProgramTabId" => {
                            if let Some(parsed) = parse_i64(value) {
                                config.selected_program_tab_id = parsed.max(1);
                            }
                        }
                        "ProgramTabIds" => {
                            config.program_tab_ids =
                                value.split('|').filter_map(parse_i64).collect::<Vec<_>>();
                        }
                        _ => {}
                    });
            }
            "ActionHotkeys" => {
                config.action_hotkeys = section
                    .entries
                    .iter()
                    .filter_map(|(key, value)| {
                        let shortcut = canonicalize_shortcut(value);
                        if key.trim().is_empty() || shortcut.is_empty() {
                            None
                        } else {
                            Some((key.clone(), shortcut))
                        }
                    })
                    .collect::<BTreeMap<_, _>>();
            }
            "MacroEditorColumns" => {
                if !section.entries.is_empty() {
                    config.macro_editor_columns = section.entries.clone();
                }
            }
            _ if section.name.starts_with("Binding_") => {
                if let Some(id) = parse_i64(section.name.trim_start_matches("Binding_")) {
                    let mut shortcut = String::new();
                    let mut target = String::new();
                    let mut program_tab_id = 0_i64;
                    section
                        .entries
                        .iter()
                        .for_each(|(key, value)| match key.as_str() {
                            "Shortcut" => shortcut = canonicalize_shortcut(value),
                            "ScriptPath" => target = value.clone(),
                            "ProgramTabId" => {
                                if let Some(parsed) = parse_i64(value) {
                                    program_tab_id = parsed;
                                }
                            }
                            _ => {}
                        });
                    if !shortcut.is_empty() && !target.trim().is_empty() {
                        config.script_bindings.push(ScriptBindingEntry {
                            id,
                            shortcut,
                            target,
                            program_tab_id,
                        });
                    }
                }
            }
            _ if section.name.starts_with("ProgramTab_") => {
                if let Some(id) = parse_i64(section.name.trim_start_matches("ProgramTab_")) {
                    discovered_program_tabs.insert(id, section.entries.clone());
                }
            }
            _ => config.other_sections.push(section),
        });

    if config.program_tab_ids.is_empty() {
        config.program_tab_ids = discovered_program_tabs.keys().copied().collect::<Vec<_>>();
    }

    config.program_tabs = config
        .program_tab_ids
        .iter()
        .filter_map(|id| {
            discovered_program_tabs
                .remove(id)
                .map(|entries| (*id, entries))
        })
        .collect::<Vec<_>>();
    discovered_program_tabs
        .into_iter()
        .for_each(|entry| config.program_tabs.push(entry));

    config.program_tab_ids = config
        .program_tabs
        .iter()
        .map(|(id, _)| *id)
        .collect::<Vec<_>>();
    config.script_bindings.sort_by_key(|binding| binding.id);
    config.next_id = config.next_id.max(
        config
            .script_bindings
            .iter()
            .map(|binding| binding.id)
            .max()
            .unwrap_or(0)
            + 1,
    );

    if config.program_tab_next_id <= 0 {
        config.program_tab_next_id = config
            .program_tab_ids
            .iter()
            .max()
            .map(|value| value + 1)
            .unwrap_or(1);
    }

    Ok(config)
}

fn load_bindings_state(paths: &AppPaths) -> Result<FlowCellBindingsState, String> {
    let config = parse_bindings_config(&bindings_path(paths))?;
    Ok(FlowCellBindingsState {
        next_id: config.next_id.max(1),
        script_bindings: config
            .script_bindings
            .iter()
            .map(|binding| FlowCellScriptBinding {
                id: binding.id,
                shortcut: binding.shortcut.clone(),
                target: binding.target.clone(),
                status: "Active".to_string(),
                program_tab_id: (binding.program_tab_id > 0).then_some(binding.program_tab_id),
            })
            .collect::<Vec<_>>(),
        action_hotkeys: config
            .action_hotkeys
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect::<HashMap<_, _>>(),
    })
}

fn write_bindings_config(path: &Path, config: &BindingsConfig) -> Result<(), String> {
    let mut lines: Vec<String> = Vec::new();
    let binding_ids = config
        .script_bindings
        .iter()
        .map(|binding| binding.id.to_string())
        .collect::<Vec<_>>();
    let program_tab_ids = config
        .program_tabs
        .iter()
        .map(|(id, _)| id.to_string())
        .collect::<Vec<_>>();

    lines.push("[Meta]".to_string());
    lines.push(format!("NextId={}", config.next_id.max(1)));
    lines.push(format!("Ids={}", binding_ids.join("|")));
    lines.push(format!(
        "ProgramTabNextId={}",
        config.program_tab_next_id.max(1)
    ));
    lines.push(format!("ProgramTabIds={}", program_tab_ids.join("|")));
    lines.push(format!(
        "SelectedProgramTabId={}",
        config.selected_program_tab_id.max(1)
    ));
    lines.push(String::new());

    config.script_bindings.iter().for_each(|binding| {
        lines.push(format!("[Binding_{}]", binding.id));
        lines.push(format!(
            "Shortcut={}",
            canonicalize_shortcut(&binding.shortcut)
        ));
        lines.push(format!("ScriptPath={}", binding.target));
        if binding.program_tab_id > 0 {
            lines.push(format!("ProgramTabId={}", binding.program_tab_id));
        }
        lines.push(String::new());
    });

    config.program_tabs.iter().for_each(|(id, entries)| {
        lines.push(format!("[ProgramTab_{}]", id));
        entries
            .iter()
            .for_each(|(key, value)| lines.push(format!("{}={}", key, value)));
        lines.push(String::new());
    });

    lines.push("[ActionHotkeys]".to_string());
    config.action_hotkeys.iter().for_each(|(key, value)| {
        let shortcut = canonicalize_shortcut(value);
        if !key.trim().is_empty() && !shortcut.is_empty() {
            lines.push(format!("{}={}", key, shortcut));
        }
    });
    lines.push(String::new());

    lines.push("[MacroEditorColumns]".to_string());
    config
        .macro_editor_columns
        .iter()
        .for_each(|(key, value)| lines.push(format!("{}={}", key, value)));

    config.other_sections.iter().for_each(|section| {
        lines.push(String::new());
        lines.push(format!("[{}]", section.name));
        section
            .entries
            .iter()
            .for_each(|(key, value)| lines.push(format!("{}={}", key, value)));
    });

    write_utf16le_text(path, &lines.join("\r\n"))
}

fn resolve_existing_script_binding_index(
    config: &BindingsConfig,
    binding_id: i64,
    target: &str,
    program_tab_id: i64,
) -> Option<usize> {
    if binding_id > 0 {
        if let Some(index) = config
            .script_bindings
            .iter()
            .position(|binding| binding.id == binding_id)
        {
            return Some(index);
        }
    }

    let trimmed_target = target.trim();
    if trimmed_target.is_empty() {
        return None;
    }

    config
        .script_bindings
        .iter()
        .position(|binding| {
            binding.target == trimmed_target && binding.program_tab_id == program_tab_id
        })
        .or_else(|| {
            config
                .script_bindings
                .iter()
                .position(|binding| binding.target == trimmed_target)
        })
}

fn binding_label(request: &ButtonBindingMutationRequest) -> String {
    request
        .label
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(request.target.as_str())
        .to_string()
}

fn powershell_single_quote(value: &str) -> String {
    value.replace('\'', "''")
}

fn restart_headless_backend(paths: &AppPaths) -> Result<(), String> {
    let backend_script = powershell_single_quote(
        &paths
            .flowcell_root
            .join("FlowCellBackend.ahk")
            .display()
            .to_string(),
    );
    let launcher_path = powershell_single_quote(
        &paths
            .flowcell_root
            .join("run_backend_hidden.vbs")
            .display()
            .to_string(),
    );
    let script = format!(
        "$backendScript = '{backend_script}'; \
         $launcherPath = '{launcher_path}'; \
         Get-CimInstance Win32_Process | Where-Object {{ \
           ($_.Name -eq 'AutoHotkey64.exe' -or $_.Name -eq 'AutoHotkey.exe') -and \
           $_.CommandLine -and \
           $_.CommandLine.IndexOf($backendScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and \
           $_.CommandLine.IndexOf('--headless', [System.StringComparison]::OrdinalIgnoreCase) -ge 0 \
         }} | ForEach-Object {{ \
           try {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }} catch {{ }} \
         }}; \
         if (Test-Path -LiteralPath $launcherPath -PathType Leaf) {{ \
           Start-Process -FilePath 'wscript.exe' -ArgumentList @('//nologo', $launcherPath) -WindowStyle Hidden | Out-Null \
         }}"
    );

    let output = Command::new(powershell_exe())
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Restarting the FlowCell backend failed.".to_string()
        } else {
            stderr
        });
    }

    Ok(())
}

fn strip_utf8_bom(value: &str) -> &str {
    value.trim_start_matches('\u{feff}')
}

fn sanitize_layout_name(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| match character {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' => character,
            _ => '_',
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();

    if sanitized.is_empty() {
        "layout".to_string()
    } else {
        sanitized
    }
}

fn system_time_string(value: SystemTime) -> Option<String> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs().to_string())
}

fn get_section_value(entries: &[(String, String)], key: &str) -> Option<String> {
    entries
        .iter()
        .find(|(candidate, _)| candidate.eq_ignore_ascii_case(key))
        .map(|(_, value)| value.clone())
}

fn is_step_section_name(name: &str) -> bool {
    name.strip_prefix("Step_")
        .map(|suffix| {
            !suffix.is_empty() && suffix.chars().all(|character| character.is_ascii_digit())
        })
        .unwrap_or(false)
}

fn sanitize_macro_slug(value: &str) -> String {
    let mut slug = String::new();
    let mut previous_was_separator = false;
    for character in value.trim().to_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character);
            previous_was_separator = false;
        } else if !previous_was_separator {
            slug.push('_');
            previous_was_separator = true;
        }
    }

    let trimmed = slug.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "recorded_action".to_string()
    } else {
        trimmed
    }
}

fn sanitize_macro_file_token(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| match character {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' => character,
            _ => '_',
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();

    if sanitized.is_empty() {
        "recorded_action".to_string()
    } else {
        sanitized
    }
}

fn powershell_date_string(format_string: &str) -> Option<String> {
    let script = format!(
        "Get-Date -Format '{}'",
        powershell_single_quote(format_string)
    );
    let output = Command::new(powershell_exe())
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!stdout.is_empty()).then_some(stdout)
}

fn build_recorded_action_id(label: &str) -> String {
    let slug = sanitize_macro_slug(label);
    let timestamp = powershell_date_string("yyyyMMdd_HHmmss").unwrap_or_else(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .map(|duration| duration.as_secs().to_string())
            .unwrap_or_else(|| "now".to_string())
    });
    format!("recorded_{}_{}", slug, timestamp)
}

fn default_recorded_macro_created_at() -> Option<String> {
    powershell_date_string("yyyy-MM-dd HH:mm:ss").or_else(|| system_time_string(SystemTime::now()))
}

fn clean_ini_value(value: &str) -> String {
    value.replace(['\r', '\n'], " ")
}

fn list_recorded_macro_paths(root: &Path) -> Result<Vec<PathBuf>, String> {
    ensure_directory(root)?;
    let mut paths = fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .map(|extension| extension.to_string_lossy().eq_ignore_ascii_case("ini"))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    paths.sort();
    Ok(paths)
}

fn parse_recorded_macro_definition(
    path: &Path,
    include_steps: bool,
) -> Result<RecordedMacroDefinition, String> {
    let text = read_text_file(path)?;
    let sections = parse_ini_sections(&text);
    let action_section = sections
        .iter()
        .find(|section| section.name.eq_ignore_ascii_case("Action"))
        .ok_or_else(|| format!("Macro file is missing [Action]: {}", path.display()))?;
    let id = get_section_value(&action_section.entries, "Id")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("Macro file is missing Id: {}", path.display()))?;
    let label = get_section_value(&action_section.entries, "Label")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("Macro file is missing Label: {}", path.display()))?;
    let created_at = get_section_value(&action_section.entries, "CreatedAt")
        .filter(|value| !value.trim().is_empty());

    let steps = if include_steps {
        sections
            .iter()
            .filter(|section| is_step_section_name(&section.name))
            .filter_map(|section| {
                let raw_type = get_section_value(&section.entries, "Type")?;
                let script_path = get_section_value(&section.entries, "ScriptPath")
                    .filter(|value| !value.trim().is_empty());
                let macro_path = get_section_value(&section.entries, "MacroPath")
                    .filter(|value| !value.trim().is_empty());
                let step_type = if macro_path.is_some() {
                    "Macro".to_string()
                } else if script_path.is_some() {
                    "Script".to_string()
                } else {
                    raw_type.trim().to_string()
                };
                (!step_type.is_empty()).then_some(RecordedMacroStep {
                    section: Some(section.name.clone()),
                    step_type,
                    delay_ms: get_section_value(&section.entries, "DelayMs")
                        .and_then(|value| parse_i64(&value))
                        .unwrap_or(0),
                    x: get_section_value(&section.entries, "X"),
                    y: get_section_value(&section.entries, "Y"),
                    button: get_section_value(&section.entries, "Button"),
                    count: get_section_value(&section.entries, "Count"),
                    direction: get_section_value(&section.entries, "Direction"),
                    text: get_section_value(&section.entries, "Text"),
                    keys: get_section_value(&section.entries, "Keys"),
                    script_path,
                    macro_path,
                })
            })
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    Ok(RecordedMacroDefinition {
        path: path.display().to_string(),
        file_name: path
            .file_stem()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default(),
        id,
        label,
        created_at,
        steps,
    })
}

fn find_recorded_macro_path_by_id(root: &Path, action_id: &str) -> Result<Option<PathBuf>, String> {
    let direct_path = root.join(format!("{}.ini", sanitize_macro_file_token(action_id)));
    if direct_path.exists() {
        return Ok(Some(direct_path));
    }

    for path in list_recorded_macro_paths(root)? {
        if let Ok(definition) = parse_recorded_macro_definition(&path, false) {
            if definition.id.eq_ignore_ascii_case(action_id) {
                return Ok(Some(path));
            }
        }
    }

    Ok(None)
}

fn write_recorded_macro_definition(
    root: &Path,
    definition: &RecordedMacroDefinition,
) -> Result<RecordedMacroDefinition, String> {
    let id = definition.id.trim();
    if id.is_empty() {
        return Err("Macro id is required.".to_string());
    }
    let label = definition.label.trim();
    if label.is_empty() {
        return Err("Macro name is required.".to_string());
    }

    ensure_directory(root)?;
    let path = find_recorded_macro_path_by_id(root, id)?
        .unwrap_or_else(|| root.join(format!("{}.ini", sanitize_macro_file_token(id))));

    let created_at = definition
        .created_at
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(default_recorded_macro_created_at);

    let mut lines = vec![
        "[Action]".to_string(),
        format!("Id={}", id),
        format!("Label={}", clean_ini_value(label)),
    ];
    if let Some(created_at_value) = created_at.as_deref() {
        lines.push(format!("CreatedAt={}", clean_ini_value(created_at_value)));
    }
    lines.push(String::new());

    for (index, step) in definition.steps.iter().enumerate() {
        let normalized_type = match step.step_type.trim().to_ascii_lowercase().as_str() {
            "activateillustrator" => "ActivateIllustrator",
            "activateblender" => "ActivateBlender",
            "activatephotoshop" => "ActivatePhotoshop",
            "activatewindows" => "ActivateWindows",
            "click" => "Click",
            "wheel" => "Wheel",
            "text" => "Text",
            "key" => "Key",
            "script" => "Script",
            "macro" => "Macro",
            _ => "Click",
        };

        lines.push(format!("[Step_{:03}]", index + 1));
        lines.push(format!("Type={}", normalized_type));
        lines.push(format!("DelayMs={}", step.delay_ms.max(0)));

        match normalized_type {
            "Click" => {
                lines.push(format!("X={}", step.x.as_deref().unwrap_or("0").trim()));
                lines.push(format!("Y={}", step.y.as_deref().unwrap_or("0").trim()));
                lines.push(format!(
                    "Button={}",
                    step.button.as_deref().unwrap_or("Left").trim()
                ));
                lines.push(format!(
                    "Count={}",
                    step.count.as_deref().unwrap_or("1").trim()
                ));
            }
            "Wheel" => {
                lines.push(format!("X={}", step.x.as_deref().unwrap_or("0").trim()));
                lines.push(format!("Y={}", step.y.as_deref().unwrap_or("0").trim()));
                lines.push(format!(
                    "Direction={}",
                    step.direction.as_deref().unwrap_or("Down").trim()
                ));
                lines.push(format!(
                    "Count={}",
                    step.count.as_deref().unwrap_or("1").trim()
                ));
            }
            "Text" => {
                lines.push(format!(
                    "Text={}",
                    clean_ini_value(step.text.as_deref().unwrap_or(""))
                ));
            }
            "Key" => {
                lines.push(format!(
                    "Keys={}",
                    clean_ini_value(step.keys.as_deref().unwrap_or(""))
                ));
            }
            "Script" => {
                let script_path = step.script_path.as_deref().unwrap_or("").trim().to_string();
                if script_path.is_empty() {
                    return Err("Script steps require a script path.".to_string());
                }
                lines.push(format!("ScriptPath={}", script_path));
            }
            "Macro" => {
                let macro_path = step.macro_path.as_deref().unwrap_or("").trim().to_string();
                if macro_path.is_empty() {
                    return Err("Nested macro steps require a macro path.".to_string());
                }
                lines.push(format!("MacroPath={}", macro_path));
            }
            _ => {}
        }

        lines.push(String::new());
    }

    fs::write(&path, lines.join("\r\n")).map_err(|error| error.to_string())?;
    parse_recorded_macro_definition(&path, true)
}

fn move_file_to_recycle_bin(path: &Path) -> Result<(), String> {
    let quoted_path = powershell_single_quote(&path.display().to_string());
    let script = format!(
        "Add-Type -AssemblyName Microsoft.VisualBasic; \
         [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(\
         '{quoted_path}', \
         [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, \
         [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)"
    );
    let output = Command::new(powershell_exe())
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!("Failed to move {} to the Recycle Bin.", path.display())
        } else {
            stderr
        })
    }
}

fn find_autohotkey_exe(paths: &AppPaths) -> Result<PathBuf, String> {
    let candidates = [
        paths.flowcell_root.join("runtime").join("AutoHotkey64.exe"),
        paths.flowcell_root.join("runtime").join("AutoHotkey.exe"),
        paths.local_root.join("bin").join("AutoHotkey64.exe"),
        paths.local_root.join("bin").join("AutoHotkey.exe"),
        PathBuf::from(r"C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe"),
        PathBuf::from(r"C:\Program Files\AutoHotkey\v2\AutoHotkey.exe"),
    ];

    candidates
        .into_iter()
        .find(|candidate| candidate.exists())
        .ok_or_else(|| "AutoHotkey v2 executable was not found.".to_string())
}

fn last_action_status_path(paths: &AppPaths) -> PathBuf {
    paths.logs_root.join("last_action_status.txt")
}

fn parse_dialog_filters(filter: &str) -> Vec<(String, Vec<String>)> {
    let segments: Vec<&str> = filter
        .split('|')
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .collect();
    let mut parsed = Vec::new();

    let mut index = 0usize;
    while index + 1 < segments.len() {
        let name = segments[index].to_string();
        let extensions = segments[index + 1]
            .split(';')
            .map(str::trim)
            .map(|entry| entry.trim_start_matches("*.").trim_start_matches('.'))
            .filter(|entry| !entry.is_empty() && *entry != "*" && *entry != "*.*")
            .map(str::to_string)
            .collect::<Vec<_>>();
        if !extensions.is_empty() {
            parsed.push((name, extensions));
        }
        index += 2;
    }

    parsed
}

fn clone_popout_window_config(
    app: &AppHandle,
    label: String,
    title: String,
    width: f64,
    height: f64,
    bounds: Option<FlowCellBounds>,
) -> Result<WindowConfig, String> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .or_else(|| app.config().app.windows.first())
        .cloned()
        .ok_or_else(|| "Missing base window config.".to_string())?;

    config.label = label;
    config.title = title;
    config.create = true;
    config.visible = true;
    config.resizable = true;
    config.width = width;
    config.height = height;

    if let Some(bounds) = bounds {
        config.x = Some(bounds.left);
        config.y = Some(bounds.top);
        config.width = width.max(bounds.width);
        config.height = height.max(bounds.height);
    } else {
        config.x = None;
        config.y = None;
    }

    Ok(config)
}

fn powershell_exe() -> String {
    std::env::var("SystemRoot")
        .map(|root| format!(r"{}\System32\WindowsPowerShell\v1.0\powershell.exe", root))
        .unwrap_or_else(|_| "powershell.exe".to_string())
}

fn sanitize_token(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '/') {
                character
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "flowcell".to_string()
    } else {
        sanitized
    }
}

fn get_foreground_process_info_impl() -> ForegroundProcessInfo {
    unsafe {
        let foreground_window = GetForegroundWindow();
        if foreground_window.is_null() {
            return ForegroundProcessInfo::default();
        }

        let mut process_id = 0u32;
        GetWindowThreadProcessId(foreground_window, &mut process_id);
        if process_id == 0 {
            return ForegroundProcessInfo::default();
        }

        let process_handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
        if process_handle.is_null() {
            return ForegroundProcessInfo::default();
        }

        let mut buffer = vec![0u16; 1024];
        let mut length = buffer.len() as u32;
        let query_result =
            QueryFullProcessImageNameW(process_handle, 0, buffer.as_mut_ptr(), &mut length);
        let _ = CloseHandle(process_handle);

        if query_result == 0 || length == 0 {
            return ForegroundProcessInfo::default();
        }

        let process_path = String::from_utf16_lossy(&buffer[..length as usize]);
        let process_name = Path::new(&process_path)
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();

        ForegroundProcessInfo {
            process_name,
            process_path,
        }
    }
}

fn build_tool_popout_label(program_id: i64, panel_id: &str, owner_button_id: &str) -> String {
    format!(
        "popout-tool-{}-{}-{}",
        program_id,
        sanitize_token(panel_id),
        sanitize_token(owner_button_id)
    )
}

fn request_id_from_envelope(envelope: &FlowCellCommandEnvelope) -> String {
    envelope
        .request_id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            format!(
                "{}-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|duration| duration.as_millis())
                    .unwrap_or(0),
                sanitize_token(&envelope.button_id)
            )
        })
}

fn collect_output_logs(stdout_text: &str, stderr_text: &str) -> Vec<String> {
    let mut logs = Vec::new();

    for line in stdout_text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(16)
    {
        logs.push(format!("stdout: {}", line));
    }

    for line in stderr_text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(16)
    {
        logs.push(format!("stderr: {}", line));
    }

    logs
}

fn failure_result(
    request_id: String,
    message: String,
    details: Value,
    logs: Vec<String>,
    exit_code: i32,
    duration_ms: u64,
) -> GatewayCommandResult {
    GatewayCommandResult {
        ok: false,
        request_id,
        status: "error".to_string(),
        message,
        details,
        logs,
        exit_code,
        duration_ms,
    }
}

fn success_status(ok: bool) -> String {
    if ok {
        "ok".to_string()
    } else {
        "error".to_string()
    }
}

fn normalize_backend_result(
    request_id: String,
    legacy_result: Value,
    stdout_text: String,
    stderr_text: String,
    exit_code: i32,
    duration_ms: u64,
) -> GatewayCommandResult {
    let ok = legacy_result
        .get("Succeeded")
        .and_then(Value::as_bool)
        .unwrap_or(exit_code == 0);

    let message = legacy_result
        .get("Message")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            if !stderr_text.is_empty() {
                Some(stderr_text.clone())
            } else if !stdout_text.is_empty() {
                Some(stdout_text.clone())
            } else if ok {
                Some("FlowCell command completed.".to_string())
            } else {
                Some("FlowCell command failed.".to_string())
            }
        })
        .unwrap_or_else(|| "FlowCell command failed.".to_string());

    let mut details = Map::new();

    for (detail_key, legacy_key) in [
        ("resolved_target", "ResolvedTarget"),
        ("execution_method", "ExecutionMethod"),
        ("client_action", "ClientAction"),
    ] {
        if let Some(value) = legacy_result.get(legacy_key).cloned() {
            details.insert(detail_key.to_string(), value);
        }
    }

    if let Some(value) = legacy_result.get("SmartAxisResult").cloned() {
        details.insert("smart_axis_result".to_string(), value);
    }
    if let Some(value) = legacy_result.get("ToolOptionState").cloned() {
        details.insert("tool_option_state".to_string(), value);
    }
    if !stdout_text.is_empty() {
        details.insert(
            "backend_stdout".to_string(),
            Value::String(stdout_text.clone()),
        );
    }
    if !stderr_text.is_empty() {
        details.insert(
            "backend_stderr".to_string(),
            Value::String(stderr_text.clone()),
        );
    }
    details.insert("legacy_result".to_string(), legacy_result);

    GatewayCommandResult {
        ok,
        request_id,
        status: success_status(ok),
        message,
        details: Value::Object(details),
        logs: collect_output_logs(&stdout_text, &stderr_text),
        exit_code,
        duration_ms,
    }
}

fn emit_command_impl(
    paths: &AppPaths,
    window_label: &str,
    envelope: FlowCellCommandEnvelope,
) -> GatewayCommandResult {
    let request_id = request_id_from_envelope(&envelope);
    let command_id = envelope.command_id.clone();
    let button_id = envelope.button_id.clone();
    let child_slot_id = envelope.child_slot_id.clone().unwrap_or_default();

    if envelope.command_id.trim().is_empty() {
        return failure_result(
            request_id,
            "Command envelope is missing command_id.".to_string(),
            json!({}),
            vec![],
            -1,
            0,
        );
    }

    if envelope.payload.is_null() {
        return failure_result(
            request_id,
            "Command envelope is missing payload.".to_string(),
            json!({}),
            vec![],
            -1,
            0,
        );
    }

    let _ = write_frontend_log(
        paths,
        &format!(
            "Gateway received command. RequestId={}; Window={}; CommandId={}; ButtonId={}; ChildSlotId={}",
            request_id, window_label, command_id, button_id, child_slot_id
        ),
    );

    let temp_root = paths.local_root.join("temp").join("tauri_command_host");
    if let Err(error) = ensure_directory(&temp_root) {
        return failure_result(request_id, error, json!({}), vec![], -1, 0);
    }

    let temp_token = sanitize_token(&request_id);
    let envelope_path = temp_root.join(format!("envelope-{}.json", temp_token));
    let result_path = temp_root.join(format!("result-{}.json", temp_token));

    let rendered_envelope = match serde_json::to_string_pretty(&envelope) {
        Ok(rendered) => rendered,
        Err(error) => {
            return failure_result(request_id, error.to_string(), json!({}), vec![], -1, 0)
        }
    };

    if let Err(error) = fs::write(&envelope_path, rendered_envelope) {
        return failure_result(request_id, error.to_string(), json!({}), vec![], -1, 0);
    }

    let backend_script = paths.flowcell_root.join("FlowCellCommandBackend.ps1");
    let _ = write_frontend_log(
        paths,
        &format!(
            "Gateway called backend host. RequestId={}; Script={}",
            request_id,
            backend_script.display()
        ),
    );

    let started = Instant::now();
    let output = Command::new(powershell_exe())
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            &backend_script.display().to_string(),
            "-EnvelopePath",
            &envelope_path.display().to_string(),
            "-ResultPath",
            &result_path.display().to_string(),
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    let duration_ms = started.elapsed().as_millis() as u64;

    let result = match output {
        Ok(output) => {
            let exit_code = output.status.code().unwrap_or(-1);
            let stdout_text = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr_text = String::from_utf8_lossy(&output.stderr).trim().to_string();

            let legacy_result = if result_path.exists() {
                match fs::read_to_string(&result_path) {
                    Ok(result_text) => {
                        let sanitized_result_text = result_text.trim_start_matches('\u{feff}');
                        match serde_json::from_str::<Value>(sanitized_result_text) {
                            Ok(result_value) => result_value,
                            Err(error) => json!({
                                "Succeeded": false,
                                "Message": format!("Backend result was not valid JSON: {}", error),
                                "RawResult": sanitized_result_text
                            }),
                        }
                    }
                    Err(error) => json!({
                        "Succeeded": false,
                        "Message": error.to_string()
                    }),
                }
            } else {
                json!({
                    "Succeeded": output.status.success(),
                    "Message": if !stderr_text.is_empty() {
                        stderr_text.clone()
                    } else if !stdout_text.is_empty() {
                        stdout_text.clone()
                    } else if output.status.success() {
                        "FlowCell command completed.".to_string()
                    } else {
                        "The backend host did not produce a result file.".to_string()
                    }
                })
            };

            normalize_backend_result(
                request_id.clone(),
                legacy_result,
                stdout_text,
                stderr_text,
                exit_code,
                duration_ms,
            )
        }
        Err(error) => failure_result(
            request_id.clone(),
            error.to_string(),
            json!({ "backend_script": backend_script.display().to_string() }),
            vec![],
            -1,
            duration_ms,
        ),
    };

    let _ = write_frontend_log(
        paths,
        &format!(
            "Gateway received backend result. RequestId={}; Ok={}; ExitCode={}; Message={}",
            result.request_id, result.ok, result.exit_code, result.message
        ),
    );

    let _ = fs::remove_file(&envelope_path);
    let _ = fs::remove_file(&result_path);

    result
}

#[tauri::command]
fn load_state(state: State<'_, RuntimeState>) -> Result<LoadStateResponse, String> {
    let paths = with_paths(&state)?;
    let state_path = state_path(&paths);
    let state_text = fs::read_to_string(&state_path).map_err(|error| error.to_string())?;
    let state_value: Value =
        serde_json::from_str(strip_utf8_bom(&state_text)).map_err(|error| error.to_string())?;
    let bindings = match load_bindings_state(&paths) {
        Ok(loaded) => loaded,
        Err(error) => {
            let _ = write_frontend_log(
                &paths,
                &format!(
                    "Bindings load failed. Path={}; Error={}",
                    bindings_path(&paths).display(),
                    error
                ),
            );
            FlowCellBindingsState {
                next_id: 1,
                ..FlowCellBindingsState::default()
            }
        }
    };
    let program_count = state_value
        .get("Programs")
        .and_then(Value::as_array)
        .map(|programs| programs.len())
        .unwrap_or(0);
    write_frontend_log(
        &paths,
        &format!(
            "Frontend loaded state. Path={}; Programs={}",
            state_path.display(),
            program_count
        ),
    )?;

    Ok(LoadStateResponse {
        state: state_value,
        runtime: RuntimeInfo {
            repo_root: paths.repo_root.display().to_string(),
            flow_cell_root: paths.flowcell_root.display().to_string(),
            state_path: state_path.display().to_string(),
            frontend_log_path: paths.frontend_log_path.display().to_string(),
        },
        bindings,
    })
}

#[tauri::command]
fn save_state(state: State<'_, RuntimeState>, next_state: Value) -> Result<(), String> {
    let paths = with_paths(&state)?;
    let rendered = serde_json::to_string_pretty(&next_state).map_err(|error| error.to_string())?;
    fs::write(state_path(&paths), rendered).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_button_binding(
    state: State<'_, RuntimeState>,
    request: ButtonBindingMutationRequest,
) -> Result<BindingMutationResult, String> {
    let paths = with_paths(&state)?;
    let path = bindings_path(&paths);
    let mut config = parse_bindings_config(&path)?;
    let kind = request.kind.trim().to_lowercase();
    if kind != "script" && kind != "macro" {
        return Err("Only script and macro buttons can be bound.".to_string());
    }

    let shortcut = canonicalize_shortcut(request.shortcut.as_deref().unwrap_or(""));
    if shortcut.is_empty() {
        return Err("Choose or enter a shortcut first.".to_string());
    }

    let normalized_shortcut = normalize_shortcut(&shortcut);
    let message = if kind == "script" {
        let target = request.target.trim();
        if target.is_empty() {
            return Err("Choose a script target first.".to_string());
        }

        let existing_index = resolve_existing_script_binding_index(
            &config,
            request.binding_id.unwrap_or_default(),
            target,
            request.program_tab_id,
        );
        for (index, binding) in config.script_bindings.iter().enumerate() {
            if normalize_shortcut(&binding.shortcut) == normalized_shortcut
                && Some(index) != existing_index
            {
                return Err(format!(
                    "That shortcut is already bound to:\n{}",
                    binding.target
                ));
            }
        }
        for existing_shortcut in config.action_hotkeys.values() {
            if normalize_shortcut(existing_shortcut) == normalized_shortcut {
                return Err("That shortcut is already used by another action binding.".to_string());
            }
        }

        if let Some(index) = existing_index {
            config.script_bindings[index].shortcut = shortcut.clone();
            config.script_bindings[index].target = target.to_string();
            config.script_bindings[index].program_tab_id = request.program_tab_id.max(0);
        } else {
            let next_id = config.next_id.max(
                config
                    .script_bindings
                    .iter()
                    .map(|binding| binding.id)
                    .max()
                    .unwrap_or(0)
                    + 1,
            );
            config.next_id = next_id + 1;
            config.script_bindings.push(ScriptBindingEntry {
                id: next_id,
                shortcut: shortcut.clone(),
                target: target.to_string(),
                program_tab_id: request.program_tab_id.max(0),
            });
            config.script_bindings.sort_by_key(|binding| binding.id);
        }

        format!(
            "Saved shortcut {} for {}.",
            shortcut,
            binding_label(&request)
        )
    } else {
        let action_id = request.target.trim();
        if action_id.is_empty() {
            return Err("Choose a macro target first.".to_string());
        }

        for binding in &config.script_bindings {
            if normalize_shortcut(&binding.shortcut) == normalized_shortcut {
                return Err(format!(
                    "That shortcut is already bound to:\n{}",
                    binding.target
                ));
            }
        }
        for (existing_action_id, existing_shortcut) in &config.action_hotkeys {
            if normalize_shortcut(existing_shortcut) == normalized_shortcut
                && !existing_action_id.eq_ignore_ascii_case(action_id)
            {
                return Err("That shortcut is already used by another action binding.".to_string());
            }
        }

        config
            .action_hotkeys
            .insert(action_id.to_string(), shortcut.clone());
        format!(
            "Saved shortcut {} for {}.",
            shortcut,
            binding_label(&request)
        )
    };

    write_bindings_config(&path, &config)?;
    restart_headless_backend(&paths)?;
    write_frontend_log(
        &paths,
        &format!(
            "Saved button binding. Kind={}; Target={}; Shortcut={}",
            kind, request.target, shortcut
        ),
    )?;

    Ok(BindingMutationResult { message })
}

#[tauri::command]
fn clear_button_binding(
    state: State<'_, RuntimeState>,
    request: ButtonBindingMutationRequest,
) -> Result<BindingMutationResult, String> {
    let paths = with_paths(&state)?;
    let path = bindings_path(&paths);
    let mut config = parse_bindings_config(&path)?;
    let kind = request.kind.trim().to_lowercase();
    if kind != "script" && kind != "macro" {
        return Err("Only script and macro buttons can clear bindings.".to_string());
    }

    let mut changed = false;
    let message = if kind == "script" {
        let existing_index = resolve_existing_script_binding_index(
            &config,
            request.binding_id.unwrap_or_default(),
            request.target.trim(),
            request.program_tab_id,
        );
        if let Some(index) = existing_index {
            config.script_bindings.remove(index);
            changed = true;
            format!("Cleared shortcut for {}.", binding_label(&request))
        } else {
            format!("No shortcut was saved for {}.", binding_label(&request))
        }
    } else {
        if config
            .action_hotkeys
            .remove(request.target.trim())
            .is_some()
        {
            changed = true;
            format!("Cleared shortcut for {}.", binding_label(&request))
        } else {
            format!("No shortcut was saved for {}.", binding_label(&request))
        }
    };

    if !changed {
        return Ok(BindingMutationResult { message });
    }

    write_bindings_config(&path, &config)?;
    restart_headless_backend(&paths)?;
    write_frontend_log(
        &paths,
        &format!(
            "Cleared button binding. Kind={}; Target={}",
            kind, request.target
        ),
    )?;

    Ok(BindingMutationResult { message })
}

#[tauri::command]
fn get_window_context(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
) -> Result<WindowContext, String> {
    let contexts = state
        .window_contexts
        .lock()
        .map_err(|_| "Window context lock failed.".to_string())?;
    Ok(contexts
        .get(window.label())
        .cloned()
        .unwrap_or(WindowContext {
            kind: "main".to_string(),
            ..WindowContext::default()
        }))
}

#[tauri::command]
fn log_frontend_event(
    state: State<'_, RuntimeState>,
    surface: String,
    message: String,
) -> Result<(), String> {
    let paths = with_paths(&state)?;
    write_frontend_log(&paths, &format!("{}; Surface={}", message, surface))
}

#[tauri::command]
fn get_foreground_process_info() -> Result<ForegroundProcessInfo, String> {
    Ok(get_foreground_process_info_impl())
}

#[tauri::command]
fn show_open_file_dialog(
    window: WebviewWindow,
    title: String,
    filter: String,
    initial_directory: Option<String>,
    multiselect: Option<bool>,
) -> Result<Vec<String>, String> {
    let mut builder = window.dialog().file().set_title(title);

    if let Some(directory) = initial_directory
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        if Path::new(directory).is_dir() {
            builder = builder.set_directory(directory);
        }
    }

    let parsed_filters = parse_dialog_filters(&filter);
    for (name, extensions) in parsed_filters {
        let ext_refs = extensions.iter().map(String::as_str).collect::<Vec<_>>();
        builder = builder.add_filter(name, &ext_refs);
    }

    let selected = if multiselect.unwrap_or(false) {
        builder
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|entry| {
                entry
                    .into_path()
                    .map(|path| path.display().to_string())
                    .map_err(|error| error.to_string())
            })
            .collect::<Result<Vec<_>, _>>()?
    } else {
        builder
            .blocking_pick_file()
            .map(|entry| {
                entry
                    .into_path()
                    .map(|path| vec![path.display().to_string()])
                    .map_err(|error| error.to_string())
            })
            .transpose()?
            .unwrap_or_default()
    };

    Ok(selected)
}

#[tauri::command]
fn show_open_folder_dialog(
    window: WebviewWindow,
    title: String,
    initial_directory: Option<String>,
    multiselect: Option<bool>,
) -> Result<Vec<String>, String> {
    let mut builder = window.dialog().file().set_title(title);

    if let Some(directory) = initial_directory
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        if Path::new(directory).is_dir() {
            builder = builder.set_directory(directory);
        }
    }

    let selected = if multiselect.unwrap_or(false) {
        builder
            .blocking_pick_folders()
            .unwrap_or_default()
            .into_iter()
            .map(|entry| {
                entry
                    .into_path()
                    .map(|path| path.display().to_string())
                    .map_err(|error| error.to_string())
            })
            .collect::<Result<Vec<_>, _>>()?
    } else {
        builder
            .blocking_pick_folder()
            .map(|entry| {
                entry
                    .into_path()
                    .map(|path| vec![path.display().to_string()])
                    .map_err(|error| error.to_string())
            })
            .transpose()?
            .unwrap_or_default()
    };

    Ok(selected)
}

#[tauri::command]
fn show_save_file_dialog(
    window: WebviewWindow,
    title: String,
    filter: String,
    initial_directory: Option<String>,
) -> Result<Option<String>, String> {
    let mut builder = window.dialog().file().set_title(title);

    if let Some(directory) = initial_directory
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        if Path::new(directory).is_dir() {
            builder = builder.set_directory(directory);
        }
    }

    let parsed_filters = parse_dialog_filters(&filter);
    for (name, extensions) in parsed_filters {
        let ext_refs = extensions.iter().map(String::as_str).collect::<Vec<_>>();
        builder = builder.add_filter(name, &ext_refs);
    }

    let selected = builder
        .blocking_save_file()
        .map(|entry| {
            entry
                .into_path()
                .map(|path| path.display().to_string())
                .map_err(|error| error.to_string())
        })
        .transpose()?;

    Ok(selected)
}

#[tauri::command]
fn sample_photo_theme_colors(
    state: State<'_, RuntimeState>,
    image_path: String,
) -> Result<SampledPhotoThemeColors, String> {
    let paths = with_paths(&state)?;
    let trimmed = image_path.trim();
    if trimmed.is_empty() {
        let message = "Theme sampling failed: image path was empty.".to_string();
        let _ = write_frontend_log(&paths, &message);
        return Err("Image path is required.".to_string());
    }

    let resolved_path = PathBuf::from(trimmed);
    match pick_photo_theme_colors(&resolved_path) {
        Ok(sampled) => {
            let _ = write_frontend_log(
                &paths,
                &format!(
                    "Theme photo sampled. Path={}; Headers={}; Text={}; SectionFill={}; Controls={}; Misc={}",
                    resolved_path.display(),
                    sampled.headers_hex,
                    sampled.text_hex,
                    sampled.section_fill_hex,
                    sampled.controls_hex,
                    sampled.misc_hex
                ),
            );
            Ok(sampled)
        }
        Err(error) => {
            let _ = write_frontend_log(
                &paths,
                &format!(
                    "Theme photo sampling failed. Path={}; Error={}",
                    resolved_path.display(),
                    error
                ),
            );
            Err(error)
        }
    }
}

#[tauri::command]
fn save_blender_theme_file(
    state: State<'_, RuntimeState>,
    suggested_name: String,
    path: Option<String>,
    values: Value,
) -> Result<String, String> {
    let paths = with_paths(&state)?;
    let file_path = if let Some(raw_path) = path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let mut explicit_path = PathBuf::from(raw_path);
        if explicit_path.extension().is_none() {
            explicit_path.set_extension("json");
        }
        if let Some(parent) = explicit_path.parent() {
            if !parent.as_os_str().is_empty() {
                ensure_directory(parent)?;
            }
        }
        explicit_path
    } else {
        let themes_root = blender_theme_root(&paths);
        ensure_directory(&themes_root)?;
        let file_stem = sanitize_theme_file_stem(&suggested_name);
        themes_root.join(format!("{}.json", file_stem))
    };
    let payload = SavedBlenderThemeFile {
        format: "flowtest-blender-theme-v1".to_string(),
        saved_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_secs()
            .to_string(),
        values,
    };
    let serialized = serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?;
    fs::write(&file_path, serialized).map_err(|error| error.to_string())?;
    let _ = write_frontend_log(
        &paths,
        &format!("Saved Blender theme file at {}", file_path.display()),
    );
    Ok(file_path.display().to_string())
}

#[tauri::command]
fn load_blender_theme_file(state: State<'_, RuntimeState>, path: String) -> Result<Value, String> {
    let paths = with_paths(&state)?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Blender theme file path is required.".to_string());
    }
    let file_path = PathBuf::from(trimmed);
    if !file_path.is_file() {
        return Err(format!(
            "Blender theme file was not found: {}",
            file_path.display()
        ));
    }
    let raw = fs::read_to_string(&file_path).map_err(|error| error.to_string())?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    let values = parsed
        .get("values")
        .cloned()
        .unwrap_or_else(|| parsed.clone());
    if !values.is_object() {
        return Err("Blender theme file did not contain a valid theme object.".to_string());
    }
    let _ = write_frontend_log(
        &paths,
        &format!("Loaded Blender theme file from {}", file_path.display()),
    );
    Ok(values)
}

#[tauri::command]
fn list_layout_files(state: State<'_, RuntimeState>) -> Result<Vec<SavedLayoutFile>, String> {
    let paths = with_paths(&state)?;
    let root = layouts_root(&paths);
    ensure_directory(&root)?;

    let mut files: Vec<SavedLayoutFile> = fs::read_dir(&root)
        .map_err(|error| error.to_string())?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            let extension = path.extension()?.to_string_lossy().to_lowercase();
            if extension != "json" {
                return None;
            }
            let display_name = path.file_name()?.to_string_lossy().to_string();
            let text = fs::read_to_string(&path).ok()?;
            let payload: Value = serde_json::from_str(strip_utf8_bom(&text)).ok()?;
            let saved_at = payload
                .get("SavedAt")
                .and_then(Value::as_str)
                .map(|value| value.to_string());
            let panel_count = payload
                .get("PanelPopouts")
                .and_then(Value::as_array)
                .map(|entries| entries.len())
                .unwrap_or(0);
            let tool_count = payload
                .get("ToolPopouts")
                .and_then(Value::as_array)
                .map(|entries| entries.len())
                .unwrap_or(0);
            let modified_at = entry
                .metadata()
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(system_time_string);

            Some(SavedLayoutFile {
                name: path
                    .file_stem()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_else(|| display_name.clone()),
                display_name,
                path: path.display().to_string(),
                details: format!("Panels {}  Tools {}", panel_count, tool_count),
                saved_at,
                modified_at,
            })
        })
        .collect();

    files.sort_by(|left, right| right.modified_at.cmp(&left.modified_at));
    Ok(files)
}

#[tauri::command]
fn load_layout_snapshot(state: State<'_, RuntimeState>, path: String) -> Result<Value, String> {
    let _paths = with_paths(&state)?;
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(strip_utf8_bom(&text)).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_layout_snapshot(
    state: State<'_, RuntimeState>,
    suggested_name: Option<String>,
    snapshot: Value,
) -> Result<String, String> {
    let paths = with_paths(&state)?;
    let root = layouts_root(&paths);
    ensure_directory(&root)?;

    let base_name = suggested_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(sanitize_layout_name)
        .unwrap_or_else(|| {
            format!(
                "layout-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|duration| duration.as_secs().to_string())
                    .unwrap_or_else(|_| "now".to_string())
            )
        });
    let file_name = if base_name.to_lowercase().ends_with(".flowlayout.json") {
        base_name
    } else {
        format!("{}.flowlayout.json", base_name)
    };
    let path = root.join(file_name);
    let rendered = serde_json::to_string_pretty(&snapshot).map_err(|error| error.to_string())?;
    fs::write(&path, rendered).map_err(|error| error.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn list_recorded_macros(
    state: State<'_, RuntimeState>,
) -> Result<Vec<RecordedMacroChoice>, String> {
    let paths = with_paths(&state)?;
    let root = recorded_actions_root(&paths);
    let mut macros: Vec<RecordedMacroChoice> = list_recorded_macro_paths(&root)?
        .into_iter()
        .filter_map(|path| parse_recorded_macro_definition(&path, false).ok())
        .map(|definition| RecordedMacroChoice {
            id: definition.id,
            label: definition.label,
            path: definition.path,
            created_at: definition.created_at,
        })
        .collect();

    macros.sort_by(|left, right| left.label.to_lowercase().cmp(&right.label.to_lowercase()));
    Ok(macros)
}

#[tauri::command]
fn create_recorded_macro_draft(
    state: State<'_, RuntimeState>,
    label: Option<String>,
) -> Result<RecordedMacroDefinition, String> {
    let paths = with_paths(&state)?;
    let normalized_label = label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("New Macro");
    let action_id = build_recorded_action_id(normalized_label);
    let path = recorded_actions_root(&paths)
        .join(format!("{}.ini", sanitize_macro_file_token(&action_id)));

    Ok(RecordedMacroDefinition {
        path: path.display().to_string(),
        file_name: path
            .file_stem()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default(),
        id: action_id,
        label: normalized_label.to_string(),
        created_at: default_recorded_macro_created_at(),
        steps: Vec::new(),
    })
}

#[tauri::command]
fn load_recorded_macro(
    state: State<'_, RuntimeState>,
    action_id: String,
) -> Result<RecordedMacroDefinition, String> {
    let paths = with_paths(&state)?;
    let root = recorded_actions_root(&paths);
    let path = find_recorded_macro_path_by_id(&root, action_id.trim())?
        .ok_or_else(|| format!("Recorded macro not found: {}", action_id.trim()))?;
    parse_recorded_macro_definition(&path, true)
}

#[tauri::command]
fn save_recorded_macro(
    state: State<'_, RuntimeState>,
    definition: RecordedMacroDefinition,
) -> Result<RecordedMacroDefinition, String> {
    let paths = with_paths(&state)?;
    let root = recorded_actions_root(&paths);
    let saved = write_recorded_macro_definition(&root, &definition)?;
    write_frontend_log(
        &paths,
        &format!(
            "Saved recorded macro. Id={}; Label={}",
            saved.id, saved.label
        ),
    )?;
    Ok(saved)
}

#[tauri::command]
fn delete_recorded_macro(
    state: State<'_, RuntimeState>,
    action_id: String,
) -> Result<String, String> {
    let paths = with_paths(&state)?;
    let root = recorded_actions_root(&paths);
    let normalized_action_id = action_id.trim();
    if normalized_action_id.is_empty() {
        return Err("Choose a recorded macro first.".to_string());
    }

    let path = find_recorded_macro_path_by_id(&root, normalized_action_id)?
        .ok_or_else(|| format!("Recorded macro not found: {}", normalized_action_id))?;
    let definition = parse_recorded_macro_definition(&path, false)?;
    move_file_to_recycle_bin(&path)?;

    let bindings_file = bindings_path(&paths);
    let mut config = parse_bindings_config(&bindings_file)?;
    let removed_binding = config.action_hotkeys.remove(normalized_action_id).is_some();
    if removed_binding {
        write_bindings_config(&bindings_file, &config)?;
        restart_headless_backend(&paths)?;
    }

    let message = if removed_binding {
        format!(
            "Recycled macro {} and cleared its shortcut binding.",
            definition.label
        )
    } else {
        format!("Recycled macro {}.", definition.label)
    };

    write_frontend_log(
        &paths,
        &format!(
            "Deleted recorded macro. Id={}; Label={}",
            definition.id, definition.label
        ),
    )?;
    Ok(message)
}

#[tauri::command]
fn record_macro(
    state: State<'_, RuntimeState>,
    label: String,
) -> Result<RecordedMacroDefinition, String> {
    let paths = with_paths(&state)?;
    let normalized_label = label.trim();
    if normalized_label.is_empty() {
        return Err("Enter a macro name first.".to_string());
    }

    let helper_path = paths.flowcell_root.join("helpers").join("RecordMacro.ahk");
    if !helper_path.exists() {
        return Err("helpers\\RecordMacro.ahk was not found.".to_string());
    }

    let ahk_exe = find_autohotkey_exe(&paths)?;
    let action_id = build_recorded_action_id(normalized_label);
    let output_path = recorded_actions_root(&paths)
        .join(format!("{}.ini", sanitize_macro_file_token(&action_id)));

    let output = Command::new(ahk_exe)
        .args([
            "/ErrorStdOut",
            &helper_path.display().to_string(),
            &format!("--out={}", output_path.display()),
            &format!("--name={}", normalized_label),
            &format!("--id={}", action_id),
        ])
        .current_dir(
            helper_path
                .parent()
                .unwrap_or(paths.flowcell_root.as_path()),
        )
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| error.to_string())?;

    match output.status.code().unwrap_or(1) {
        0 => {
            let definition = parse_recorded_macro_definition(&output_path, true)?;
            write_frontend_log(
                &paths,
                &format!(
                    "Recorded macro saved. Id={}; Label={}",
                    definition.id, definition.label
                ),
            )?;
            Ok(definition)
        }
        2 => Err("Macro recording was cancelled.".to_string()),
        3 => Err("Macro recording ended before any steps were saved.".to_string()),
        _ => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(if stderr.is_empty() {
                "Macro recording failed.".to_string()
            } else {
                stderr
            })
        }
    }
}

#[tauri::command]
fn run_recorded_macro(state: State<'_, RuntimeState>, action_id: String) -> Result<String, String> {
    let paths = with_paths(&state)?;
    let normalized_action_id = action_id.trim();
    if normalized_action_id.is_empty() {
        return Err("Choose a recorded macro first.".to_string());
    }

    let ahk_exe = find_autohotkey_exe(&paths)?;
    let backend_path = paths.flowcell_root.join("FlowCellBackend.ahk");
    if !backend_path.exists() {
        return Err("FlowCellBackend.ahk was not found.".to_string());
    }

    let status_path = last_action_status_path(&paths);
    let _ = fs::remove_file(&status_path);

    let output = Command::new(ahk_exe)
        .args([
            "/ErrorStdOut",
            &backend_path.display().to_string(),
            &format!("--run-action={}", normalized_action_id),
        ])
        .current_dir(&paths.flowcell_root)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| error.to_string())?;

    let status_text = read_text_file(&status_path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(status_text
            .or_else(|| (!stderr.is_empty()).then_some(stderr))
            .unwrap_or_else(|| "Recorded macro run failed.".to_string()));
    }

    Ok(status_text.unwrap_or_else(|| format!("Ran recorded macro {}.", normalized_action_id)))
}

#[tauri::command]
fn install_managed_program_scripts(
    state: State<'_, RuntimeState>,
    program_key: String,
    selected_paths: Vec<String>,
    panel_name: Option<String>,
) -> Result<ManagedScriptInstallResult, String> {
    let paths = with_paths(&state)?;
    let folders = managed_program_folders(&paths.repo_root, &program_key)?;
    install_managed_program_scripts_with_folders(
        &paths,
        &program_key,
        &folders,
        &selected_paths,
        panel_name.as_deref(),
        &ManagedInstallOptions::default(),
    )
}

fn install_managed_program_scripts_with_folders(
    paths: &AppPaths,
    program_key: &str,
    folders: &ManagedProgramFolders,
    selected_paths: &[String],
    panel_name: Option<&str>,
    options: &ManagedInstallOptions,
) -> Result<ManagedScriptInstallResult, String> {
    ensure_directory(&folders.active_root)?;
    if normalize_path_key(&folders.runtime_root) != normalize_path_key(&folders.active_root) {
        ensure_directory(&folders.runtime_root)?;
    }

    let mut staged_roots = Vec::new();
    let mut failures = Vec::new();

    for selected_path in selected_paths {
        let trimmed = selected_path.trim();
        if trimmed.is_empty() {
            continue;
        }
        let source_path = PathBuf::from(trimmed);
        if !source_path.exists() {
            failures.push(ManagedScriptInstallResultItem {
                label: None,
                tooltip: None,
                source_path: trimmed.to_string(),
                active_path: String::new(),
                execution_target: String::new(),
                installed: false,
                message: Some("Selected path was not found.".to_string()),
            });
            continue;
        }

        match stage_selected_path(
            &source_path,
            &folders.active_root,
            folders.source_root.as_deref(),
        ) {
            Ok(staged_root) => staged_roots.push(staged_root),
            Err(error) => failures.push(ManagedScriptInstallResultItem {
                label: Some(button_label_from_path(&source_path)),
                tooltip: None,
                source_path: source_path.display().to_string(),
                active_path: String::new(),
                execution_target: String::new(),
                installed: false,
                message: Some(error),
            }),
        }
    }

    let mut staged_files = Vec::new();
    for staged_root in &staged_roots {
        collect_files_recursive(staged_root, &mut staged_files)?;
    }
    staged_files.sort();
    staged_files.dedup();

    let eligible_files = staged_files
        .into_iter()
        .filter(|path| is_allowed_script_file(path, &folders.allowed_extensions))
        .collect::<Vec<_>>();

    if program_key.trim().eq_ignore_ascii_case("blender") {
        let installer_path = paths
            .repo_root
            .join("Blender")
            .join("SupportScripts")
            .join("Install-BlenderFlowCellButtons.ps1");
        let selected_paths_json = serde_json::to_string(
            &eligible_files
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>(),
        )
        .map_err(|error| format!("Could not serialize staged Blender paths: {}", error))?;

        let mut command = Command::new(powershell_exe());
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            &installer_path.display().to_string(),
            "-PanelName",
            panel_name
                .filter(|value| !value.trim().is_empty())
                .or(Some("Utility"))
                .unwrap_or("Utility"),
            "-SelectedPathsJson",
            &selected_paths_json,
        ]);

        if let Some(bridge_folder) = options.blender_bridge_folder.as_ref() {
            command.args(["-BridgeFolder", &bridge_folder.display().to_string()]);
        }
        if options.blender_skip_sync {
            command.arg("-SkipSync");
        }

        command.creation_flags(CREATE_NO_WINDOW);
        let output = command.output().map_err(|error| error.to_string())?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "Blender Add Button installer failed.".to_string()
            } else {
                stderr
            });
        }

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let parsed: Value = serde_json::from_str(strip_utf8_bom(&stdout)).map_err(|error| {
            if stdout.trim().is_empty() {
                "Blender Add Button installer returned no JSON output.".to_string()
            } else {
                format!(
                    "{}. Raw installer output: {}",
                    error,
                    stdout.chars().take(240).collect::<String>()
                )
            }
        })?;

        let mut results = failures;
        if let Some(entries) = parsed.get("Results").and_then(Value::as_array) {
            for entry in entries {
                let source_path = entry
                    .get("Source")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let execution_target = entry
                    .get("WrapperPath")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let label = entry
                    .get("Label")
                    .and_then(Value::as_str)
                    .map(|value| value.to_string())
                    .filter(|value| !value.trim().is_empty());
                let tooltip = entry
                    .get("Tooltip")
                    .and_then(Value::as_str)
                    .map(|value| value.to_string())
                    .filter(|value| !value.trim().is_empty());
                let installed = entry
                    .get("Installed")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let message = entry
                    .get("Message")
                    .and_then(Value::as_str)
                    .map(|value| value.to_string());
                results.push(ManagedScriptInstallResultItem {
                    label: label.or_else(|| {
                        (!source_path.is_empty())
                            .then(|| button_label_from_path(Path::new(&source_path)))
                    }),
                    tooltip,
                    source_path: source_path.clone(),
                    active_path: source_path,
                    execution_target,
                    installed,
                    message,
                });
            }
        }

        let installed_count = results.iter().filter(|item| item.installed).count();
        let failed_count = results.iter().filter(|item| !item.installed).count();
        return Ok(ManagedScriptInstallResult {
            installed_count,
            failed_count,
            status_message: parsed
                .get("StatusMessage")
                .and_then(Value::as_str)
                .unwrap_or("Blender install completed.")
                .to_string(),
            reload_required: parsed
                .get("ReloadRequired")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            reload_reason: parsed
                .get("ReloadReason")
                .and_then(Value::as_str)
                .map(|value| value.to_string())
                .filter(|value| !value.trim().is_empty()),
            results,
        });
    }

    if normalize_path_key(&folders.runtime_root) != normalize_path_key(&folders.active_root) {
        for staged_root in &staged_roots {
            let relative = staged_root
                .strip_prefix(&folders.active_root)
                .map_err(|error| error.to_string())?;
            let runtime_path = folders.runtime_root.join(relative);
            if staged_root.is_dir() {
                copy_directory_recursive(staged_root, &runtime_path)?;
            } else if staged_root.is_file() {
                copy_file_overwrite(staged_root, &runtime_path)?;
            }
        }
    }

    let mut results = failures;
    for active_path in eligible_files {
        let relative = active_path
            .strip_prefix(&folders.active_root)
            .map_err(|error| error.to_string())?;
        let execution_target = if normalize_path_key(&folders.runtime_root)
            == normalize_path_key(&folders.active_root)
        {
            active_path.clone()
        } else {
            folders.runtime_root.join(relative)
        };

        results.push(ManagedScriptInstallResultItem {
            label: Some(button_label_from_path(&active_path)),
            tooltip: None,
            source_path: active_path.display().to_string(),
            active_path: active_path.display().to_string(),
            execution_target: execution_target.display().to_string(),
            installed: true,
            message: None,
        });
    }

    let installed_count = results.iter().filter(|item| item.installed).count();
    let failed_count = results.iter().filter(|item| !item.installed).count();
    let status_message = if installed_count == 0 {
        format!("No {} scripts were installed.", program_key.trim())
    } else {
        format!(
            "Installed {} {} script(s) into Active Scripts and synced the runtime target.",
            installed_count,
            program_key.trim()
        )
    };

    Ok(ManagedScriptInstallResult {
        installed_count,
        failed_count,
        status_message,
        reload_required: false,
        reload_reason: None,
        results,
    })
}

#[tauri::command]
fn install_blender_buttons(
    state: State<'_, RuntimeState>,
    selected_paths: Vec<String>,
    panel_name: String,
) -> Result<Value, String> {
    let paths = with_paths(&state)?;
    let installer_path = paths
        .repo_root
        .join("Blender")
        .join("SupportScripts")
        .join("Install-BlenderFlowCellButtons.ps1");

    let selected_paths_json = serde_json::to_string(&selected_paths).map_err(|error| {
        format!(
            "Could not serialize selected Blender button paths: {}",
            error
        )
    })?;

    let mut command = Command::new(powershell_exe());
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            &installer_path.display().to_string(),
            "-PanelName",
            &panel_name,
            "-SelectedPathsJson",
            &selected_paths_json,
        ])
        .creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|error| error.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Blender Add Button installer failed.".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let sanitized_stdout = strip_utf8_bom(&stdout).trim();
    serde_json::from_str(sanitized_stdout).map_err(|error| {
        if sanitized_stdout.is_empty() {
            "Blender Add Button installer returned no JSON output.".to_string()
        } else {
            format!(
                "{}. Raw installer output: {}",
                error,
                sanitized_stdout.chars().take(240).collect::<String>()
            )
        }
    })
}

#[tauri::command]
fn delete_blender_button(
    state: State<'_, RuntimeState>,
    button_target: String,
) -> Result<Value, String> {
    let paths = with_paths(&state)?;
    let remover_path = paths
        .repo_root
        .join("Blender")
        .join("SupportScripts")
        .join("Remove-BlenderFlowCellButton.ps1");

    let mut command = Command::new(powershell_exe());
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            &remover_path.display().to_string(),
            "-ButtonTarget",
            &button_target,
        ])
        .creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|error| error.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Blender button delete cleanup failed.".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let sanitized_stdout = strip_utf8_bom(&stdout).trim();
    serde_json::from_str(sanitized_stdout).map_err(|error| {
        if sanitized_stdout.is_empty() {
            "Blender button delete cleanup returned no JSON output.".to_string()
        } else {
            format!(
                "{}. Raw delete output: {}",
                error,
                sanitized_stdout.chars().take(240).collect::<String>()
            )
        }
    })
}

#[tauri::command]
fn update_blender_button_description(
    state: State<'_, RuntimeState>,
    request: BlenderButtonDescriptionUpdateRequest,
) -> Result<Value, String> {
    let paths = with_paths(&state)?;
    let updater_path = paths
        .repo_root
        .join("Blender")
        .join("SupportScripts")
        .join("Update-BlenderFlowCellButtonDescription.ps1");

    let mut command = Command::new(powershell_exe());
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        &updater_path.display().to_string(),
        "-ButtonTarget",
        request.button_target.trim(),
        "-Description",
        request.description.trim(),
    ]);
    if let Some(execution_target) = request.execution_target.as_deref() {
        if !execution_target.trim().is_empty() {
            command.args(["-ExecutionTarget", execution_target.trim()]);
        }
    }
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|error| error.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Blender button description update failed.".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let sanitized_stdout = strip_utf8_bom(&stdout).trim();
    serde_json::from_str(sanitized_stdout).map_err(|error| {
        if sanitized_stdout.is_empty() {
            "Blender button description update returned no JSON output.".to_string()
        } else {
            format!(
                "{}. Raw update output: {}",
                error,
                sanitized_stdout.chars().take(240).collect::<String>()
            )
        }
    })
}

#[tauri::command]
fn sync_blender_button_source_mirrors(
    state: State<'_, RuntimeState>,
    refresh_descriptions: Option<bool>,
) -> Result<Value, String> {
    let paths = with_paths(&state)?;
    let sync_path = paths
        .repo_root
        .join("Blender")
        .join("SupportScripts")
        .join("Sync-BlenderButtonSourceMirrors.ps1");

    let mut command = Command::new(powershell_exe());
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        &sync_path.display().to_string(),
    ]);
    if refresh_descriptions.unwrap_or(false) {
        command.arg("-RefreshDescriptions");
    }
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|error| error.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Blender button source mirror sync failed.".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let sanitized_stdout = strip_utf8_bom(&stdout).trim();
    serde_json::from_str(sanitized_stdout).map_err(|error| {
        if sanitized_stdout.is_empty() {
            "Blender button source mirror sync returned no JSON output.".to_string()
        } else {
            format!(
                "{}. Raw sync output: {}",
                error,
                sanitized_stdout.chars().take(240).collect::<String>()
            )
        }
    })
}

#[tauri::command]
fn open_panel_popout(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    program_id: i64,
    panel_id: String,
    panel_name: String,
    bounds: Option<FlowCellBounds>,
) -> Result<(), String> {
    let label = format!("popout-panel-{}", sanitize_token(&panel_id));

    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    {
        let mut contexts = state
            .window_contexts
            .lock()
            .map_err(|_| "Window context lock failed.".to_string())?;
        contexts.insert(
            label.clone(),
            WindowContext {
                kind: "panel-popout".to_string(),
                program_id: Some(program_id),
                panel_id: Some(panel_id.clone()),
                panel_name: Some(panel_name.clone()),
                ..WindowContext::default()
            },
        );
    }

    let config = clone_popout_window_config(
        &app,
        label,
        format!("FlowCell - {}", panel_name),
        860.0,
        520.0,
        bounds,
    )?;

    WebviewWindowBuilder::from_config(&app, &config)
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn close_panel_popout(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    panel_id: String,
) -> Result<(), String> {
    let label = format!("popout-panel-{}", sanitize_token(&panel_id));
    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(|error| error.to_string())?;
    }
    let mut contexts = state
        .window_contexts
        .lock()
        .map_err(|_| "Window context lock failed.".to_string())?;
    contexts.remove(&label);
    Ok(())
}

#[tauri::command]
fn open_tool_popout(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    program_id: i64,
    panel_id: String,
    panel_name: String,
    owner_button_id: String,
    button_ids: Vec<String>,
    layout_mode: String,
    button_label: String,
    bounds: Option<FlowCellBounds>,
) -> Result<(), String> {
    let paths = with_paths(&state)?;
    let label = build_tool_popout_label(program_id, &panel_id, &owner_button_id);

    if let Some(window) = app.get_webview_window(&label) {
        let _ = write_frontend_log(
            &paths,
            &format!(
                "Closing existing tool popout before reopen. Label={}; Owner={}; Layout={}",
                label, owner_button_id, layout_mode
            ),
        );
        window.close().map_err(|error| error.to_string())?;
        let mut contexts = state
            .window_contexts
            .lock()
            .map_err(|_| "Window context lock failed.".to_string())?;
        contexts.remove(&label);
    }

    {
        let mut contexts = state
            .window_contexts
            .lock()
            .map_err(|_| "Window context lock failed.".to_string())?;
        contexts.insert(
            label.clone(),
            WindowContext {
                kind: "tool-popout".to_string(),
                program_id: Some(program_id),
                panel_id: Some(panel_id.clone()),
                panel_name: Some(panel_name),
                owner_button_id: Some(owner_button_id.clone()),
                button_ids: Some(button_ids.clone()),
                layout_mode: Some(layout_mode.clone()),
                button_label: Some(button_label.clone()),
            },
        );
    }

    let _ = write_frontend_log(
        &paths,
        &format!(
            "Creating tool popout window. Label={}; PanelId={}; Owner={}; Buttons={:?}; Layout={}",
            label, panel_id, owner_button_id, button_ids, layout_mode
        ),
    );

    let config = clone_popout_window_config(
        &app,
        label,
        format!("FlowCell - {}", button_label),
        520.0,
        360.0,
        bounds,
    )?;

    WebviewWindowBuilder::from_config(&app, &config)
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn emit_command(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    envelope: FlowCellCommandEnvelope,
) -> GatewayCommandResult {
    match with_paths(&state) {
        Ok(paths) => emit_command_impl(&paths, window.label(), envelope),
        Err(error) => failure_result(
            request_id_from_envelope(&envelope),
            error,
            json!({}),
            vec![],
            -1,
            0,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_root(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!("flowtest-managed-install-{}-{}", name, stamp))
    }

    fn write_text_file(path: &Path, value: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, value).expect("write file");
    }

    fn build_test_paths(root: &Path) -> AppPaths {
        let flowcell_root = root.join("FlowCell");
        let local_root = flowcell_root.join("local");
        let logs_root = local_root.join("logs");
        fs::create_dir_all(&logs_root).expect("create logs");
        AppPaths {
            repo_root: root.to_path_buf(),
            flowcell_root,
            local_root,
            logs_root: logs_root.clone(),
            frontend_log_path: logs_root.join("frontend-tauri.log"),
        }
    }

    fn copy_tree(source: &Path, destination: &Path) {
        if source.is_dir() {
            fs::create_dir_all(destination).expect("create destination dir");
            for entry in fs::read_dir(source).expect("read dir") {
                let entry = entry.expect("dir entry");
                copy_tree(&entry.path(), &destination.join(entry.file_name()));
            }
        } else {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).expect("create file parent");
            }
            fs::copy(source, destination).expect("copy file");
        }
    }

    fn run_adobe_install_test(program_key: &str, extension: &'static str) {
        let root = unique_temp_root(program_key);
        let source_root = root.join("picked");
        let active_root = root
            .join(program_key)
            .join(format!("{} Active Scripts", program_key));
        let runtime_root = root.join("runtime");
        let picked_file = source_root.join(format!("sample{}", extension));
        let nested_file = source_root
            .join("nested")
            .join(format!("nested{}", extension));
        write_text_file(&picked_file, "// source");
        write_text_file(&nested_file, "// nested");

        let paths = build_test_paths(&root);
        let folders = ManagedProgramFolders {
            active_root: active_root.clone(),
            runtime_root: runtime_root.clone(),
            source_root: None,
            allowed_extensions: vec![extension],
        };
        let selected = vec![source_root.display().to_string()];
        let result = install_managed_program_scripts_with_folders(
            &paths,
            program_key,
            &folders,
            &selected,
            Some("Utility"),
            &ManagedInstallOptions::default(),
        )
        .expect("install should succeed");

        assert_eq!(result.failed_count, 0);
        assert_eq!(result.installed_count, 2);
        assert!(active_root
            .join("picked")
            .join(format!("sample{}", extension))
            .exists());
        assert!(active_root
            .join("picked")
            .join("nested")
            .join(format!("nested{}", extension))
            .exists());
        assert!(runtime_root
            .join("picked")
            .join(format!("sample{}", extension))
            .exists());
        assert!(runtime_root
            .join("picked")
            .join("nested")
            .join(format!("nested{}", extension))
            .exists());
        assert!(result.results.iter().all(|entry| entry
            .source_path
            .starts_with(&active_root.display().to_string())));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn windows_install_copies_source_and_executes_from_active_scripts() {
        let root = unique_temp_root("windows");
        let source_root = root.join("picked");
        let active_root = root.join("Windows").join("Windows Active Scripts");
        let picked_file = source_root.join("sample.ps1");
        write_text_file(&picked_file, "Write-Output 'test'");

        let paths = build_test_paths(&root);
        let folders = ManagedProgramFolders {
            active_root: active_root.clone(),
            runtime_root: active_root.clone(),
            source_root: None,
            allowed_extensions: vec![".ps1"],
        };
        let selected = vec![picked_file.display().to_string()];
        let result = install_managed_program_scripts_with_folders(
            &paths,
            "windows",
            &folders,
            &selected,
            Some("Utility"),
            &ManagedInstallOptions::default(),
        )
        .expect("install should succeed");

        let installed = result
            .results
            .iter()
            .find(|entry| entry.installed)
            .expect("installed result");
        let expected_active = active_root.join("sample.ps1").display().to_string();
        assert_eq!(installed.source_path, expected_active);
        assert_eq!(installed.execution_target, expected_active);
        assert!(active_root.join("sample.ps1").exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn illustrator_install_copies_to_active_and_runtime_targets() {
        run_adobe_install_test("Illustrator", ".jsx");
    }

    #[test]
    fn photoshop_install_copies_to_active_and_runtime_targets() {
        run_adobe_install_test("Photoshop", ".js");
    }

    #[test]
    fn blender_install_copies_source_and_returns_wrapper_execution_target() {
        let root = unique_temp_root("blender");
        copy_tree(
            Path::new("..").join("..").join("Blender").as_path(),
            &root.join("Blender"),
        );
        fs::create_dir_all(root.join("FlowCell").join("local").join("private"))
            .expect("create blender local private");
        write_text_file(&root.join("PROGRAM_SUMMARY.txt"), "test");

        let picked_root = root.join("picked");
        let picked_file = picked_root.join("util_temp_button.py");
        write_text_file(
            &picked_file,
            "def run_flowcell_action(*args, **kwargs):\n    return {'ok': True}\n",
        );
        let bridge_root = root.join("addons").join("blender_bridge_flowtest");
        let addon_root = bridge_root.parent().expect("addon root").to_path_buf();
        write_text_file(
            &addon_root.join("flowcell_actions.py"),
            "from pathlib import Path\nimport runpy\n\ndef _call_custom_action_callable(callback, context, data):\n    return callback(context, data)\n",
        );
        write_text_file(&addon_root.join("flowcell_bridge.py"), "# test bridge\n");

        let paths = build_test_paths(&root);
        let folders = ManagedProgramFolders {
            active_root: root.join("Blender").join("Blender Active Scripts"),
            runtime_root: root.join("Blender").join("FlowCellButtons"),
            source_root: None,
            allowed_extensions: vec![".py", ".ps1"],
        };
        let selected = vec![picked_file.display().to_string()];
        let options = ManagedInstallOptions {
            blender_bridge_folder: Some(bridge_root),
            blender_skip_sync: true,
        };
        let result = install_managed_program_scripts_with_folders(
            &paths,
            "blender",
            &folders,
            &selected,
            Some("Utility"),
            &options,
        )
        .expect("blender install should succeed");

        let installed = result
            .results
            .iter()
            .find(|entry| entry.installed)
            .expect("installed blender result");
        assert!(installed
            .source_path
            .starts_with(&folders.active_root.display().to_string()));
        assert!(installed
            .execution_target
            .starts_with(&folders.runtime_root.display().to_string()));
        assert!(Path::new(&installed.source_path).exists());
        assert!(Path::new(&installed.execution_target).exists());

        let _ = fs::remove_dir_all(&root);
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(RuntimeState::default())
        .setup(|app| {
            let paths =
                build_paths().map_err(|error| -> Box<dyn std::error::Error> { error.into() })?;
            let state = app.state::<RuntimeState>();

            {
                let mut path_slot = state
                    .paths
                    .lock()
                    .map_err(|_| "Runtime path lock failed.")?;
                *path_slot = Some(paths);
            }

            {
                let mut contexts = state
                    .window_contexts
                    .lock()
                    .map_err(|_| "Window context lock failed.")?;
                contexts.insert(
                    "main".to_string(),
                    WindowContext {
                        kind: "main".to_string(),
                        ..WindowContext::default()
                    },
                );
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            save_button_binding,
            clear_button_binding,
            get_window_context,
            log_frontend_event,
            get_foreground_process_info,
            show_open_file_dialog,
            show_open_folder_dialog,
            show_save_file_dialog,
            sample_photo_theme_colors,
            save_blender_theme_file,
            load_blender_theme_file,
            list_layout_files,
            load_layout_snapshot,
            save_layout_snapshot,
            list_recorded_macros,
            create_recorded_macro_draft,
            load_recorded_macro,
            save_recorded_macro,
            delete_recorded_macro,
            record_macro,
            run_recorded_macro,
            install_managed_program_scripts,
            install_blender_buttons,
            delete_blender_button,
            update_blender_button_description,
            sync_blender_button_source_mirrors,
            open_panel_popout,
            close_panel_popout,
            open_tool_popout,
            emit_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
