use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::program_sources::transaction::{self, AtomicWriteMode};

static BUTTON_STATE_COMMIT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
const SOURCE_TRANSACTION_JOURNAL_FILE_NAME: &str = "button-source-transaction.json";
const SOURCE_TRANSACTION_SCHEMA_VERSION: u32 = 1;
const BUTTON_PLACEMENT_FILE_FORMAT_V1: &str = "flowcell-button-placement/v1";
const BUTTON_PLACEMENT_FILE_FORMAT_V2: &str = "flowcell-button-placement/v2";
const BUTTON_PLACEMENT_FILE_EXTENSION: &str = ".flowcell-button-placement.json";
const BUTTON_SETTINGS_FILE_FORMAT: &str = "flowcell-button-settings/v1";
const BUTTON_SETTINGS_FILE_EXTENSION: &str = ".flowcell-button-settings.json";
const BUTTON_SETTINGS_DEFAULT_DIRECTORY_NAME: &str = "Defaults";
const BUTTON_SETTINGS_DEFAULT_FILE_EXTENSION: &str = ".flowcell-button-default.json";
const BUTTON_SETTINGS_FILE_MAX_BYTES: usize = 16 * 1024 * 1024;
const BUTTON_PLACEMENT_CYCLE_MAX_STATES: usize = 64;
const BUTTON_SKIN_FILE_EXTENSION: &str = ".flowcell-button-skin.txt";
const BUTTON_SKIN_FILE_MAX_BYTES: usize = 2 * 1024 * 1024;
const BUTTON_SKIN_HEADERS: [&str; 10] = [
    "=== structure ===",
    "=== keyframes ===",
    "=== base ===",
    "=== hover ===",
    "=== play ===",
    "=== pressed ===",
    "=== held ===",
    "=== release ===",
    "=== disabled ===",
    "=== error ===",
];

#[derive(Clone, Copy, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
enum ButtonPlacementSurfaceKind {
    Main,
    Panel,
    RegularPopout,
    ToolSetPopout,
    Fan,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ButtonSettingsPlacementKind {
    MainPage,
    Fan,
    PopOut,
}

impl ButtonSettingsPlacementKind {
    fn directory_name(self) -> &'static str {
        match self {
            Self::MainPage => "Main Page",
            Self::Fan => "Fan",
            Self::PopOut => "Pop-out",
        }
    }

    fn accepts_surface_kind(self, kind: ButtonPlacementSurfaceKind) -> bool {
        matches!(
            (self, kind),
            (Self::MainPage, ButtonPlacementSurfaceKind::Main)
                | (Self::MainPage, ButtonPlacementSurfaceKind::Panel)
                | (Self::Fan, ButtonPlacementSurfaceKind::Fan)
                | (Self::PopOut, ButtonPlacementSurfaceKind::RegularPopout)
                | (Self::PopOut, ButtonPlacementSurfaceKind::ToolSetPopout)
        )
    }
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ButtonPlacementFileSize {
    width: f64,
    height: f64,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ButtonPlacementFileSurface {
    id: String,
    name: String,
    kind: ButtonPlacementSurfaceKind,
    width: f64,
    height: f64,
    uniform_button_size: Option<ButtonPlacementFileSize>,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ButtonPlacementFileEntryV1 {
    id: String,
    button_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    z_index: u64,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ButtonPlacementFileEntryV2 {
    id: String,
    button_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    z_index: u64,
    activation_cycle: Value,
    highlight_on_hover: bool,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum ButtonCycleAdvanceTrigger {
    Press,
    Hover,
    Release,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum ButtonSkinVisualState {
    Base,
    Hover,
    Play,
    Pressed,
    Held,
    Release,
    Disabled,
    Error,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ButtonPlacementActivationCycleState {
    id: String,
    label: String,
    advance_trigger: ButtonCycleAdvanceTrigger,
    visual_state: ButtonSkinVisualState,
    #[serde(default)]
    result_matches: Vec<Value>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ButtonPlacementActivationCycle {
    states: Vec<ButtonPlacementActivationCycleState>,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ButtonPlacementFileV1 {
    format: String,
    saved_at: String,
    program_name: String,
    panel_name: String,
    surface: ButtonPlacementFileSurface,
    placements: Vec<ButtonPlacementFileEntryV1>,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ButtonPlacementFileV2 {
    format: String,
    saved_at: String,
    program_name: String,
    panel_name: String,
    surface: ButtonPlacementFileSurface,
    placements: Vec<ButtonPlacementFileEntryV2>,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ButtonSettingsFileV1 {
    format: String,
    saved_at: String,
    placement_kind: ButtonSettingsPlacementKind,
    program_name: String,
    panel_name: String,
    source_surface_id: String,
    surface: Value,
    behavior: Value,
    entries: Vec<Value>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(untagged)]
pub(crate) enum ButtonPlacementFile {
    V2(ButtonPlacementFileV2),
    V1(ButtonPlacementFileV1),
}

impl<'de> serde::Deserialize<'de> for ButtonPlacementFile {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = <Value as serde::Deserialize>::deserialize(deserializer)?;
        let format = value
            .get("format")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| serde::de::Error::custom("Button placement format must be a string."))?;
        match format.as_str() {
            BUTTON_PLACEMENT_FILE_FORMAT_V1 => serde_json::from_value(value)
                .map(Self::V1)
                .map_err(serde::de::Error::custom),
            BUTTON_PLACEMENT_FILE_FORMAT_V2 => serde_json::from_value(value)
                .map(Self::V2)
                .map_err(serde::de::Error::custom),
            _ => Err(serde::de::Error::custom(format!(
                "Unsupported Button placement format '{format}'."
            ))),
        }
    }
}

fn synchronize_tool_set_hotkeys_after_commit(app: &tauri::AppHandle) {
    if let Err(error) = crate::synchronize_tool_set_hotkeys(app) {
        let message = format!(
            "Tool Set hotkeys could not be synchronized after Button state commit: {error}"
        );
        eprintln!("{message}");
        crate::append_flowcell_local_log("child_hotkeys.log", &message);
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitButtonStateRequest {
    document: Value,
    expected_revision: u64,
    #[serde(default)]
    uninstall_owner_button_ids: Vec<String>,
    #[serde(default)]
    migration_token: Option<String>,
    #[serde(default)]
    program_rename_token: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
enum SourceTransactionPhase {
    Prepared,
    StateCommitted,
    RolledBack,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ButtonSourceTransactionJournal {
    schema_version: u32,
    phase: SourceTransactionPhase,
    previous_document: Option<Value>,
    next_document: Value,
    owner_button_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SourceTransactionRecovery {
    RollBack,
    Finalize,
}

fn button_state_path() -> Result<PathBuf, String> {
    Ok(crate::resolve_flowcell_local_root()?
        .join("button-system")
        .join("button-state.json"))
}

#[tauri::command]
pub(crate) fn get_button_editor_directory() -> Result<String, String> {
    let directory = crate::resolve_flowcell_local_root()?.join("Button editor");
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Failed to create Button editor folder at {}: {error}",
            directory.display()
        )
    })?;
    Ok(directory.display().to_string())
}

fn button_skin_directory() -> Result<PathBuf, String> {
    Ok(crate::resolve_flowcell_local_root()?
        .join("Button editor")
        .join("Skins"))
}

#[tauri::command]
pub(crate) fn get_button_skin_directory() -> Result<String, String> {
    let directory = button_skin_directory()?;
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Failed to create Button skin folder at {}: {error}",
            directory.display()
        )
    })?;
    Ok(directory.display().to_string())
}

#[tauri::command]
pub(crate) fn open_button_skin_directory() -> Result<String, String> {
    let directory = PathBuf::from(get_button_skin_directory()?);
    Command::new("explorer.exe")
        .arg(&directory)
        .spawn()
        .map_err(|error| {
            format!(
                "Failed to open Button skin folder at {}: {error}",
                directory.display()
            )
        })?;
    Ok(directory.display().to_string())
}

fn button_settings_directory(
    placement_kind: ButtonSettingsPlacementKind,
) -> Result<PathBuf, String> {
    Ok(crate::resolve_flowcell_local_root()?
        .join("Button editor")
        .join(placement_kind.directory_name()))
}

#[tauri::command]
pub(crate) fn get_button_settings_directory(
    placement_kind: ButtonSettingsPlacementKind,
) -> Result<String, String> {
    let directory = button_settings_directory(placement_kind)?;
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Failed to create {} Button settings folder at {}: {error}",
            placement_kind.directory_name(),
            directory.display()
        )
    })?;
    Ok(directory.display().to_string())
}

fn source_quarantine_root() -> Result<PathBuf, String> {
    Ok(crate::resolve_flowcell_local_root()?
        .join("button-system")
        .join("quarantine"))
}

fn source_transaction_journal_path(transaction_root: &Path) -> PathBuf {
    transaction_root.join(SOURCE_TRANSACTION_JOURNAL_FILE_NAME)
}

fn button_bootstrap_error_path() -> Result<PathBuf, String> {
    Ok(crate::resolve_flowcell_local_root()?
        .join("button-system")
        .join("last-bootstrap-error.log"))
}

#[tauri::command]
pub(crate) fn set_button_bootstrap_failure(message: Option<String>) -> Result<(), String> {
    let path = button_bootstrap_error_path()?;
    if let Some(message) = message
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        let parent = path
            .parent()
            .ok_or_else(|| "Button bootstrap error path has no parent.".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
        return fs::write(&path, message)
            .map_err(|error| format!("Failed to write {}: {error}", path.display()));
    }
    if path.is_file() {
        crate::recycle_file_path(&path)?;
    }
    Ok(())
}

fn normalize_button_placement_file_path(path: &Path) -> PathBuf {
    let path_text = path.to_string_lossy().to_string();
    let lower_path = path_text.to_ascii_lowercase();
    if lower_path.ends_with(BUTTON_PLACEMENT_FILE_EXTENSION) {
        return PathBuf::from(path_text);
    }
    let base_path = if lower_path.ends_with(".json") {
        &path_text[..path_text.len() - ".json".len()]
    } else {
        &path_text
    };
    PathBuf::from(format!("{base_path}{BUTTON_PLACEMENT_FILE_EXTENSION}"))
}

fn normalize_button_settings_file_path(path: &Path) -> PathBuf {
    let path_text = path.to_string_lossy().to_string();
    let lower_path = path_text.to_ascii_lowercase();
    if lower_path.ends_with(BUTTON_SETTINGS_FILE_EXTENSION) {
        return PathBuf::from(path_text);
    }
    let base_path = if lower_path.ends_with(".json") {
        &path_text[..path_text.len() - ".json".len()]
    } else {
        &path_text
    };
    PathBuf::from(format!("{base_path}{BUTTON_SETTINGS_FILE_EXTENSION}"))
}

fn normalize_button_skin_file_path(path: &Path) -> PathBuf {
    let path_text = path.to_string_lossy().to_string();
    let lower_path = path_text.to_ascii_lowercase();
    if lower_path.ends_with(BUTTON_SKIN_FILE_EXTENSION) {
        return PathBuf::from(path_text);
    }
    let base_path = if lower_path.ends_with(".txt") {
        &path_text[..path_text.len() - ".txt".len()]
    } else {
        &path_text
    };
    PathBuf::from(format!("{base_path}{BUTTON_SKIN_FILE_EXTENSION}"))
}

fn validate_button_skin_source(source: &str) -> Result<(), String> {
    if source.trim().is_empty() {
        return Err("Button skin source cannot be empty.".to_string());
    }
    if source.len() > BUTTON_SKIN_FILE_MAX_BYTES {
        return Err("Button skin source cannot exceed 2 MiB.".to_string());
    }

    let mut positions = Vec::with_capacity(BUTTON_SKIN_HEADERS.len());
    for header in BUTTON_SKIN_HEADERS {
        let matches = source.match_indices(header).collect::<Vec<_>>();
        if matches.len() != 1 {
            return Err(format!(
                "Button skin source must contain exactly one '{header}' header."
            ));
        }
        positions.push(matches[0].0);
    }
    if !positions.windows(2).all(|pair| pair[0] < pair[1]) {
        return Err("Button skin headers must use canonical order.".to_string());
    }
    if !source[..positions[0]].trim().is_empty() {
        return Err("Button skin source cannot contain content before Structure.".to_string());
    }
    let structure_start = positions[0] + BUTTON_SKIN_HEADERS[0].len();
    if source[structure_start..positions[1]].trim().is_empty() {
        return Err("Button skin Structure cannot be empty.".to_string());
    }
    Ok(())
}

fn is_utc_iso_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 24
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'.'
        || bytes[23] != b'Z'
    {
        return false;
    }
    let digit_positions = [
        0usize, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18, 20, 21, 22,
    ];
    if !digit_positions
        .iter()
        .all(|index| bytes[*index].is_ascii_digit())
    {
        return false;
    }
    let number =
        |start: usize, end: usize| -> u32 { value[start..end].parse::<u32>().unwrap_or(u32::MAX) };
    let year = number(0, 4);
    let month = number(5, 7);
    let day = number(8, 10);
    let leap_year =
        year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap_year => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days_in_month).contains(&day)
        && number(11, 13) <= 23
        && number(14, 16) <= 59
        && number(17, 19) <= 59
}

trait ButtonPlacementFileEntryLike {
    fn id(&self) -> &str;
    fn button_id(&self) -> &str;
    fn x(&self) -> f64;
    fn y(&self) -> f64;
    fn width(&self) -> f64;
    fn height(&self) -> f64;
    fn z_index(&self) -> u64;
    fn activation_cycle(&self) -> Option<&Value>;
}

impl ButtonPlacementFileEntryLike for ButtonPlacementFileEntryV1 {
    fn id(&self) -> &str {
        &self.id
    }
    fn button_id(&self) -> &str {
        &self.button_id
    }
    fn x(&self) -> f64 {
        self.x
    }
    fn y(&self) -> f64 {
        self.y
    }
    fn width(&self) -> f64 {
        self.width
    }
    fn height(&self) -> f64 {
        self.height
    }
    fn z_index(&self) -> u64 {
        self.z_index
    }
    fn activation_cycle(&self) -> Option<&Value> {
        None
    }
}

impl ButtonPlacementFileEntryLike for ButtonPlacementFileEntryV2 {
    fn id(&self) -> &str {
        &self.id
    }
    fn button_id(&self) -> &str {
        &self.button_id
    }
    fn x(&self) -> f64 {
        self.x
    }
    fn y(&self) -> f64 {
        self.y
    }
    fn width(&self) -> f64 {
        self.width
    }
    fn height(&self) -> f64 {
        self.height
    }
    fn z_index(&self) -> u64 {
        self.z_index
    }
    fn activation_cycle(&self) -> Option<&Value> {
        Some(&self.activation_cycle)
    }
}

fn validate_button_placement_activation_cycle(
    value: &Value,
    placement_index: usize,
) -> Result<(), String> {
    if value.is_null() {
        return Ok(());
    }
    let cycle: ButtonPlacementActivationCycle =
        serde_json::from_value(value.clone()).map_err(|error| {
            format!(
                "Button placement entry {placement_index} has an invalid activationCycle: {error}"
            )
        })?;
    if cycle.states.len() < 2 {
        return Err(format!(
            "Button placement entry {placement_index} activationCycle requires at least two states."
        ));
    }
    if cycle.states.len() > BUTTON_PLACEMENT_CYCLE_MAX_STATES {
        return Err(format!(
            "Button placement entry {placement_index} activationCycle cannot exceed {BUTTON_PLACEMENT_CYCLE_MAX_STATES} states."
        ));
    }
    let mut state_ids = HashSet::new();
    for (state_index, state) in cycle.states.iter().enumerate() {
        if state.id.trim().is_empty() {
            return Err(format!(
                "Button placement entry {placement_index} activationCycle state {state_index} has an empty ID."
            ));
        }
        if !state_ids.insert(state.id.as_str()) {
            return Err(format!(
                "Button placement entry {placement_index} activationCycle repeats state ID '{}'.",
                state.id
            ));
        }
        for (match_index, result_match) in state.result_matches.iter().enumerate() {
            if !result_match.is_object() {
                return Err(format!(
                    "Button placement entry {placement_index} activationCycle state {state_index} resultMatches entry {match_index} must be a JSON object."
                ));
            }
        }
        let _ = (&state.label, &state.advance_trigger, &state.visual_state);
    }
    Ok(())
}

fn validate_button_placement_contents<T: ButtonPlacementFileEntryLike>(
    expected_format: &str,
    format: &str,
    saved_at: &str,
    program_name: &str,
    panel_name: &str,
    surface: &ButtonPlacementFileSurface,
    placements: &[T],
) -> Result<(), String> {
    if format != expected_format {
        return Err(format!(
            "Unsupported Button placement format. Expected {expected_format}."
        ));
    }
    if !is_utc_iso_timestamp(saved_at.trim()) {
        return Err("Button placement savedAt must be a UTC ISO timestamp.".to_string());
    }
    if program_name.trim().is_empty() {
        return Err("Button placement programName cannot be empty.".to_string());
    }
    if panel_name.trim().is_empty() {
        return Err("Button placement panelName cannot be empty.".to_string());
    }
    if surface.id.trim().is_empty() {
        return Err("Button placement surface ID cannot be empty.".to_string());
    }
    if surface.name.trim().is_empty() {
        return Err("Button placement surface name cannot be empty.".to_string());
    }
    if !surface.width.is_finite() || surface.width <= 0.0 {
        return Err("Button placement surface width must be positive and finite.".to_string());
    }
    if !surface.height.is_finite() || surface.height <= 0.0 {
        return Err("Button placement surface height must be positive and finite.".to_string());
    }
    if let Some(size) = surface.uniform_button_size.as_ref() {
        if !size.width.is_finite()
            || !size.height.is_finite()
            || size.width <= 0.0
            || size.height <= 0.0
            || size.width > surface.width
            || size.height > surface.height
        {
            return Err(
                "Button placement uniformButtonSize must be positive, finite, and fit the surface."
                    .to_string(),
            );
        }
    }

    let mut placement_ids = HashSet::new();
    for (index, placement) in placements.iter().enumerate() {
        if placement.id().trim().is_empty() {
            return Err(format!(
                "Button placement entry {index} has an empty placement ID."
            ));
        }
        if !placement_ids.insert(placement.id()) {
            return Err(format!(
                "Button placement entry {index} repeats placement ID '{}'.",
                placement.id()
            ));
        }
        if placement.button_id().trim().is_empty() {
            return Err(format!(
                "Button placement entry {index} has an empty Button ID."
            ));
        }
        if placement.z_index() != index as u64 {
            return Err(format!(
                "Button placement entry {index} must use zIndex {index}."
            ));
        }
        if !placement.x().is_finite()
            || !placement.y().is_finite()
            || placement.x() < 0.0
            || placement.y() < 0.0
        {
            return Err(format!(
                "Button placement entry {index} coordinates must be nonnegative and finite."
            ));
        }
        if !placement.width().is_finite()
            || !placement.height().is_finite()
            || placement.width() <= 0.0
            || placement.height() <= 0.0
        {
            return Err(format!(
                "Button placement entry {index} size must be positive and finite."
            ));
        }
        if placement.x() + placement.width() > surface.width
            || placement.y() + placement.height() > surface.height
        {
            return Err(format!(
                "Button placement entry {index} must fit inside the selected surface."
            ));
        }
        if let Some(size) = surface.uniform_button_size.as_ref() {
            if (placement.width() - size.width).abs() > 0.05
                || (placement.height() - size.height).abs() > 0.05
            {
                return Err(format!(
                    "Button placement entry {index} does not match uniformButtonSize."
                ));
            }
        }
        if let Some(activation_cycle) = placement.activation_cycle() {
            validate_button_placement_activation_cycle(activation_cycle, index)?;
        }
    }
    Ok(())
}

fn validate_button_placement_file(file: &ButtonPlacementFile) -> Result<(), String> {
    match file {
        ButtonPlacementFile::V1(file) => validate_button_placement_contents(
            BUTTON_PLACEMENT_FILE_FORMAT_V1,
            &file.format,
            &file.saved_at,
            &file.program_name,
            &file.panel_name,
            &file.surface,
            &file.placements,
        ),
        ButtonPlacementFile::V2(file) => validate_button_placement_contents(
            BUTTON_PLACEMENT_FILE_FORMAT_V2,
            &file.format,
            &file.saved_at,
            &file.program_name,
            &file.panel_name,
            &file.surface,
            &file.placements,
        ),
    }
}

fn exact_object_keys(value: &Value, expected: &[&str], label: &str) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("{label} must be a JSON object."))?;
    let expected = expected.iter().copied().collect::<HashSet<_>>();
    for key in object.keys() {
        if !expected.contains(key.as_str()) {
            return Err(format!("{label} contains unknown field '{key}'."));
        }
    }
    for key in &expected {
        if !object.contains_key(*key) {
            return Err(format!("{label} is missing field '{key}'."));
        }
    }
    Ok(())
}

fn settings_surface_kind(
    file: &ButtonSettingsFileV1,
) -> Result<ButtonPlacementSurfaceKind, String> {
    let value = file
        .surface
        .get("kind")
        .cloned()
        .ok_or_else(|| "Button settings surface is missing kind.".to_string())?;
    serde_json::from_value(value)
        .map_err(|error| format!("Button settings surface kind is invalid: {error}"))
}

fn validate_button_settings_file(file: &ButtonSettingsFileV1) -> Result<(), String> {
    if file.format != BUTTON_SETTINGS_FILE_FORMAT {
        return Err(format!(
            "Unsupported Button settings format. Expected {BUTTON_SETTINGS_FILE_FORMAT}."
        ));
    }
    if !is_utc_iso_timestamp(file.saved_at.trim()) {
        return Err("Button settings savedAt must be a UTC ISO timestamp.".to_string());
    }
    if file.program_name.trim().is_empty() || file.panel_name.trim().is_empty() {
        return Err("Button settings programName and panelName cannot be empty.".to_string());
    }
    if file.source_surface_id.trim().is_empty() {
        return Err("Button settings sourceSurfaceId cannot be empty.".to_string());
    }
    exact_object_keys(
        &file.surface,
        &[
            "name",
            "kind",
            "width",
            "height",
            "visualOverflowAllowance",
            "uniformButtonSize",
        ],
        "Button settings surface",
    )?;
    let surface_kind = settings_surface_kind(file)?;
    if !file.placement_kind.accepts_surface_kind(surface_kind) {
        return Err(
            "Button settings placementKind does not match the saved surface kind.".to_string(),
        );
    }
    let surface = file
        .surface
        .as_object()
        .ok_or_else(|| "Button settings surface must be an object.".to_string())?;
    if surface
        .get("name")
        .and_then(Value::as_str)
        .is_none_or(|value| value.trim().is_empty())
    {
        return Err("Button settings surface name cannot be empty.".to_string());
    }
    for field in ["width", "height"] {
        let value = surface
            .get(field)
            .and_then(Value::as_f64)
            .ok_or_else(|| format!("Button settings surface {field} must be numeric."))?;
        if !value.is_finite() || value <= 0.0 {
            return Err(format!(
                "Button settings surface {field} must be positive and finite."
            ));
        }
    }
    let overflow = surface
        .get("visualOverflowAllowance")
        .and_then(Value::as_f64)
        .ok_or_else(|| {
            "Button settings surface visualOverflowAllowance must be numeric.".to_string()
        })?;
    if !overflow.is_finite() || overflow < 0.0 {
        return Err(
            "Button settings surface visualOverflowAllowance must be nonnegative and finite."
                .to_string(),
        );
    }

    let behavior_kind = file
        .behavior
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| "Button settings behavior kind is missing.".to_string())?;
    let behavior_matches = matches!(
        (surface_kind, behavior_kind),
        (
            ButtonPlacementSurfaceKind::Main | ButtonPlacementSurfaceKind::Panel,
            "main-page"
        ) | (ButtonPlacementSurfaceKind::Fan, "fan")
            | (ButtonPlacementSurfaceKind::RegularPopout, "regular-popout")
            | (ButtonPlacementSurfaceKind::ToolSetPopout, "tool-set-popout")
    );
    if !behavior_matches {
        return Err("Button settings behavior does not match the saved surface kind.".to_string());
    }

    let mut placement_ids = HashSet::new();
    let mut button_ids = HashSet::new();
    for (index, entry) in file.entries.iter().enumerate() {
        exact_object_keys(
            entry,
            &[
                "placementId",
                "buttonId",
                "buttonRole",
                "label",
                "activationBehavior",
                "activationAnimation",
                "skin",
                "placement",
            ],
            &format!("Button settings entry {index}"),
        )?;
        let placement_id = entry
            .get("placementId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| format!("Button settings entry {index} has no placementId."))?;
        if !placement_ids.insert(placement_id) {
            return Err(format!(
                "Button settings entry {index} repeats placementId '{placement_id}'."
            ));
        }
        let button_id = entry
            .get("buttonId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| format!("Button settings entry {index} has no buttonId."))?;
        if !button_ids.insert(button_id) {
            return Err(format!(
                "Button settings entry {index} repeats buttonId '{button_id}'."
            ));
        }
        let placement = entry
            .get("placement")
            .and_then(Value::as_object)
            .ok_or_else(|| format!("Button settings entry {index} placement must be an object."))?;
        if placement.get("zIndex").and_then(Value::as_u64) != Some(index as u64) {
            return Err(format!(
                "Button settings entry {index} must use placement zIndex {index}."
            ));
        }
        if !entry.get("skin").is_some_and(Value::is_object) {
            return Err(format!(
                "Button settings entry {index} skin must be an object."
            ));
        }
    }
    let serialized_size = serde_json::to_vec(file)
        .map_err(|error| format!("Failed to measure Button settings: {error}"))?
        .len();
    if serialized_size > BUTTON_SETTINGS_FILE_MAX_BYTES {
        return Err(format!(
            "Button settings cannot exceed {} MiB.",
            BUTTON_SETTINGS_FILE_MAX_BYTES / (1024 * 1024)
        ));
    }
    Ok(())
}

fn parse_button_settings_file(path: &Path) -> Result<ButtonSettingsFileV1, String> {
    let raw = fs::read_to_string(path).map_err(|error| {
        format!(
            "Failed to read Button settings at {}: {error}",
            path.display()
        )
    })?;
    let file = serde_json::from_str::<ButtonSettingsFileV1>(&raw)
        .map_err(|error| format!("Button settings at {} are invalid: {error}", path.display()))?;
    validate_button_settings_file(&file)?;
    Ok(file)
}

fn write_button_settings_file(
    path: &Path,
    file: &ButtonSettingsFileV1,
    mode: AtomicWriteMode,
) -> Result<String, String> {
    validate_button_settings_file(file)?;
    let serialized = serde_json::to_string_pretty(file)
        .map_err(|error| format!("Failed to serialize Button settings: {error}"))?;
    transaction::write_json_file(path, serialized.as_bytes(), mode)?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub(crate) fn load_button_settings_file(path: String) -> Result<ButtonSettingsFileV1, String> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("Button settings load path cannot be empty.".to_string());
    }
    parse_button_settings_file(Path::new(trimmed_path))
}

#[tauri::command]
pub(crate) fn save_button_settings_file(
    path: String,
    file: ButtonSettingsFileV1,
) -> Result<String, String> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("Button settings save path cannot be empty.".to_string());
    }
    let settings_path = normalize_button_settings_file_path(Path::new(trimmed_path));
    write_button_settings_file(&settings_path, &file, AtomicWriteMode::Replace)
}

fn validate_default_surface_id(surface_id: &str) -> Result<String, String> {
    let trimmed = surface_id.trim();
    if trimmed.is_empty()
        || trimmed.len() > 240
        || !trimmed
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_' | b'.'))
    {
        return Err("Button settings default surface ID is invalid.".to_string());
    }
    Ok(trimmed.to_string())
}

fn button_settings_default_path(
    placement_kind: ButtonSettingsPlacementKind,
    surface_id: &str,
) -> Result<PathBuf, String> {
    let surface_id = validate_default_surface_id(surface_id)?;
    Ok(button_settings_directory(placement_kind)?
        .join(BUTTON_SETTINGS_DEFAULT_DIRECTORY_NAME)
        .join(format!(
            "default-{surface_id}{BUTTON_SETTINGS_DEFAULT_FILE_EXTENSION}"
        )))
}

fn validate_default_settings_identity(
    placement_kind: ButtonSettingsPlacementKind,
    surface_id: &str,
    file: &ButtonSettingsFileV1,
) -> Result<(), String> {
    validate_button_settings_file(file)?;
    if file.placement_kind != placement_kind {
        return Err(
            "Button settings default is stored under the wrong placement folder.".to_string(),
        );
    }
    if file.source_surface_id != surface_id {
        return Err("Button settings default belongs to a different concrete surface.".to_string());
    }
    Ok(())
}

fn verify_button_settings_revision(expected_revision: u64) -> Result<(), String> {
    let path = button_state_path()?;
    recover_button_state(&path)?;
    let current_revision = if path.is_file() {
        document_revision(&read_button_state_document(&path)?)?
    } else {
        0
    };
    if current_revision != expected_revision {
        return Err(format!(
            "Button state changed before the settings default was saved. Expected revision {expected_revision}, found {current_revision}."
        ));
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn initialize_button_settings_default(
    placement_kind: ButtonSettingsPlacementKind,
    surface_id: String,
    file: ButtonSettingsFileV1,
    expected_revision: u64,
) -> Result<String, String> {
    let surface_id = validate_default_surface_id(&surface_id)?;
    validate_default_settings_identity(placement_kind, &surface_id, &file)?;
    let _guard = button_state_commit_guard()?;
    let path = button_settings_default_path(placement_kind, &surface_id)?;
    if path.is_file() {
        let existing = parse_button_settings_file(&path)?;
        validate_default_settings_identity(placement_kind, &surface_id, &existing)?;
        return Ok(path.display().to_string());
    }
    verify_button_settings_revision(expected_revision)?;
    match write_button_settings_file(&path, &file, AtomicWriteMode::Create) {
        Ok(saved) => Ok(saved),
        Err(_error) if path.is_file() => {
            let existing = parse_button_settings_file(&path)?;
            validate_default_settings_identity(placement_kind, &surface_id, &existing)?;
            Ok(path.display().to_string())
        }
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub(crate) fn load_button_settings_default(
    placement_kind: ButtonSettingsPlacementKind,
    surface_id: String,
) -> Result<Option<ButtonSettingsFileV1>, String> {
    let surface_id = validate_default_surface_id(&surface_id)?;
    let path = button_settings_default_path(placement_kind, &surface_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let file = parse_button_settings_file(&path)?;
    validate_default_settings_identity(placement_kind, &surface_id, &file)?;
    Ok(Some(file))
}

#[tauri::command]
pub(crate) fn update_button_settings_default(
    placement_kind: ButtonSettingsPlacementKind,
    surface_id: String,
    file: ButtonSettingsFileV1,
    expected_revision: u64,
) -> Result<String, String> {
    let surface_id = validate_default_surface_id(&surface_id)?;
    validate_default_settings_identity(placement_kind, &surface_id, &file)?;
    let _guard = button_state_commit_guard()?;
    verify_button_settings_revision(expected_revision)?;
    let path = button_settings_default_path(placement_kind, &surface_id)?;
    write_button_settings_file(&path, &file, AtomicWriteMode::Replace)
}

#[tauri::command]
pub(crate) fn load_button_placement_file(path: String) -> Result<ButtonPlacementFile, String> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("Button placement load path cannot be empty.".to_string());
    }
    let placement_path = PathBuf::from(trimmed_path);
    let raw = fs::read_to_string(&placement_path).map_err(|error| {
        format!(
            "Failed to read Button placement at {}: {error}",
            placement_path.display()
        )
    })?;
    let file = serde_json::from_str::<ButtonPlacementFile>(&raw).map_err(|error| {
        format!(
            "Button placement at {} is invalid: {error}",
            placement_path.display()
        )
    })?;
    validate_button_placement_file(&file)?;
    Ok(file)
}

#[tauri::command]
pub(crate) fn save_button_placement_file(
    path: String,
    file: ButtonPlacementFile,
) -> Result<String, String> {
    validate_button_placement_file(&file)?;
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("Button placement save path cannot be empty.".to_string());
    }
    let placement_path = normalize_button_placement_file_path(Path::new(trimmed_path));
    let serialized = serde_json::to_string_pretty(&file)
        .map_err(|error| format!("Failed to serialize Button placement: {error}"))?;
    transaction::write_json_file(
        &placement_path,
        serialized.as_bytes(),
        AtomicWriteMode::Replace,
    )?;
    Ok(placement_path.display().to_string())
}

#[tauri::command]
pub(crate) fn load_button_skin_file(path: String) -> Result<String, String> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("Button skin load path cannot be empty.".to_string());
    }
    let skin_path = Path::new(trimmed_path);
    let metadata = fs::metadata(skin_path).map_err(|error| {
        format!(
            "Failed to inspect Button skin at {}: {error}",
            skin_path.display()
        )
    })?;
    if metadata.len() > BUTTON_SKIN_FILE_MAX_BYTES as u64 {
        return Err("Button skin source cannot exceed 2 MiB.".to_string());
    }
    let source = fs::read_to_string(skin_path).map_err(|error| {
        format!(
            "Failed to read Button skin at {}: {error}",
            skin_path.display()
        )
    })?;
    validate_button_skin_source(&source)?;
    Ok(source)
}

#[tauri::command]
pub(crate) fn save_button_skin_file(path: String, source: String) -> Result<String, String> {
    validate_button_skin_source(&source)?;
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("Button skin save path cannot be empty.".to_string());
    }
    let skin_path = normalize_button_skin_file_path(Path::new(trimmed_path));
    transaction::write_file_atomically(
        &skin_path,
        source.as_bytes(),
        AtomicWriteMode::Replace,
        |candidate| {
            let persisted = fs::read_to_string(candidate)
                .map_err(|error| format!("Failed to read {}: {error}", candidate.display()))?;
            validate_button_skin_source(&persisted)
        },
    )?;
    Ok(skin_path.display().to_string())
}

fn validate_button_state(document: &Value) -> Result<(), String> {
    let object = document
        .as_object()
        .ok_or_else(|| "Button state must be a JSON object.".to_string())?;
    let schema_version = object
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| "Button state is missing a numeric schemaVersion.".to_string())?;
    if schema_version == 0 {
        return Err("Button state schemaVersion must be greater than zero.".to_string());
    }
    Ok(())
}

fn read_button_state_document(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let document = serde_json::from_str::<Value>(&raw).map_err(|error| {
        format!(
            "Button state at {} is invalid JSON: {error}",
            path.display()
        )
    })?;
    validate_button_state(&document)?;
    Ok(document)
}

pub(crate) fn button_state_commit_guard() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    BUTTON_STATE_COMMIT_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Button state commit lock is poisoned.".to_string())
}

pub(crate) fn read_button_state_for_program_rename_locked() -> Result<Option<Value>, String> {
    let path = button_state_path()?;
    recover_button_state(&path)?;
    if path.is_file() {
        read_button_state_document(&path).map(Some)
    } else {
        Ok(None)
    }
}

fn recover_button_state(path: &Path) -> Result<(), String> {
    transaction::recover_json_file(path, |candidate| {
        read_button_state_document(candidate).map(|_| ())
    })
}

fn atomic_write_json(path: &Path, document: &Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(document)
        .map_err(|error| format!("Failed to serialize Button state: {error}"))?;
    transaction::write_json_file(path, content.as_bytes(), AtomicWriteMode::Replace)
}

fn document_revision(document: &Value) -> Result<u64, String> {
    document
        .get("revision")
        .and_then(Value::as_u64)
        .ok_or_else(|| "Button state is missing a numeric revision.".to_string())
}

fn validate_source_transaction_journal(
    journal: &ButtonSourceTransactionJournal,
) -> Result<(), String> {
    if journal.schema_version != SOURCE_TRANSACTION_SCHEMA_VERSION {
        return Err(format!(
            "Button source transaction has unsupported schemaVersion {}.",
            journal.schema_version
        ));
    }
    validate_button_state(&journal.next_document)?;
    let next_revision = document_revision(&journal.next_document)?;
    let previous_revision = journal
        .previous_document
        .as_ref()
        .map(|document| {
            validate_button_state(document)?;
            document_revision(document)
        })
        .transpose()?
        .unwrap_or(0);
    let required_next_revision = previous_revision
        .checked_add(1)
        .ok_or_else(|| "Button source transaction revision cannot exceed u64::MAX.".to_string())?;
    if next_revision != required_next_revision {
        return Err(format!(
            "Button source transaction revision {} does not follow {}.",
            next_revision, previous_revision
        ));
    }
    if journal.owner_button_ids.is_empty() {
        return Err("Button source transaction has no source owners.".to_string());
    }
    let mut owners = Vec::<String>::new();
    for owner in &journal.owner_button_ids {
        let owner = crate::program_sources::validate_owner_button_id(owner)?;
        if owners
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&owner))
        {
            return Err(format!(
                "Button source transaction contains duplicate owner '{owner}'."
            ));
        }
        owners.push(owner);
    }
    Ok(())
}

fn parse_source_transaction_journal(path: &Path) -> Result<ButtonSourceTransactionJournal, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let journal =
        serde_json::from_str::<ButtonSourceTransactionJournal>(&raw).map_err(|error| {
            format!(
                "Button source transaction journal {} is invalid: {error}",
                path.display()
            )
        })?;
    validate_source_transaction_journal(&journal)?;
    Ok(journal)
}

fn write_source_transaction_journal(
    transaction_root: &Path,
    journal: &ButtonSourceTransactionJournal,
    mode: AtomicWriteMode,
) -> Result<(), String> {
    validate_source_transaction_journal(journal)?;
    let raw = serde_json::to_string_pretty(journal)
        .map_err(|error| format!("Failed to serialize Button source transaction: {error}"))?;
    transaction::write_json_file(
        &source_transaction_journal_path(transaction_root),
        raw.as_bytes(),
        mode,
    )
}

fn read_source_transaction_journal(
    transaction_root: &Path,
) -> Result<Option<ButtonSourceTransactionJournal>, String> {
    let path = source_transaction_journal_path(transaction_root);
    transaction::recover_json_file(&path, |candidate| {
        parse_source_transaction_journal(candidate).map(|_| ())
    })?;
    if path.is_file() {
        parse_source_transaction_journal(&path).map(Some)
    } else {
        Ok(None)
    }
}

fn classify_source_transaction(
    journal: &ButtonSourceTransactionJournal,
    current_document: Option<&Value>,
) -> Result<SourceTransactionRecovery, String> {
    let next_revision = document_revision(&journal.next_document)?;
    let previous_revision = journal
        .previous_document
        .as_ref()
        .map(document_revision)
        .transpose()?
        .unwrap_or(0);
    let (inferred, current_revision) = if let Some(current) = current_document {
        let current_revision = document_revision(current)?;
        let inferred = if current_revision > next_revision {
            SourceTransactionRecovery::Finalize
        } else if current_revision == next_revision {
            if current == &journal.next_document {
                SourceTransactionRecovery::Finalize
            } else {
                return Err(format!(
                    "Canonical Button state revision {current_revision} does not match the source transaction commit."
                ));
            }
        } else if current_revision == previous_revision {
            if journal.previous_document.as_ref() == Some(current) {
                SourceTransactionRecovery::RollBack
            } else {
                return Err(format!(
                    "Canonical Button state revision {current_revision} does not match the source transaction rollback boundary."
                ));
            }
        } else {
            return Err(format!(
                "Canonical Button state revision {current_revision} is outside source transaction revisions {previous_revision}..={next_revision}."
            ));
        };
        (inferred, Some(current_revision))
    } else if journal.previous_document.is_none() {
        (SourceTransactionRecovery::RollBack, None)
    } else {
        return Err("Canonical Button state disappeared during a source transaction.".to_string());
    };

    match journal.phase {
        SourceTransactionPhase::Prepared => Ok(inferred),
        SourceTransactionPhase::StateCommitted
            if inferred == SourceTransactionRecovery::Finalize =>
        {
            Ok(SourceTransactionRecovery::Finalize)
        }
        SourceTransactionPhase::RolledBack
            if inferred == SourceTransactionRecovery::RollBack
                || current_revision.is_some_and(|revision| revision > next_revision) =>
        {
            Ok(SourceTransactionRecovery::RollBack)
        }
        SourceTransactionPhase::StateCommitted => Err(
            "Button source transaction is marked committed, but canonical Button state is still at its rollback boundary."
                .to_string(),
        ),
        SourceTransactionPhase::RolledBack => Err(
            "Button source transaction is marked rolled back, but canonical Button state contains its commit."
                .to_string(),
        ),
    }
}

fn transaction_root_is_empty(path: &Path) -> Result<bool, String> {
    Ok(fs::read_dir(path)
        .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?
        .next()
        .transpose()
        .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?
        .is_none())
}

fn recover_source_transactions_locked(state_path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut finalize = crate::program_sources::recover_standalone_source_transactions_locked()?;
    recover_button_state(state_path)?;
    let current_document = if state_path.is_file() {
        Some(read_button_state_document(state_path)?)
    } else {
        None
    };
    let quarantine_root = source_quarantine_root()?;
    if !quarantine_root.is_dir() {
        return Ok(finalize);
    }

    let mut transaction_roots = Vec::new();
    for entry in fs::read_dir(&quarantine_root)
        .map_err(|error| format!("Failed to inspect {}: {error}", quarantine_root.display()))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to inspect {}: {error}", quarantine_root.display()))?;
        if entry.path().is_dir()
            && entry
                .file_name()
                .to_string_lossy()
                .to_ascii_lowercase()
                .starts_with("commit-")
        {
            transaction_roots.push(entry.path());
        }
    }
    transaction_roots.sort_by_key(|path| path.to_string_lossy().to_ascii_lowercase());

    for transaction_root in transaction_roots {
        let Some(mut journal) = read_source_transaction_journal(&transaction_root)? else {
            if transaction_root_is_empty(&transaction_root)? {
                finalize.push(transaction_root);
                continue;
            }
            return Err(format!(
                "Button source transaction {} has quarantined data but no recoverable journal.",
                transaction_root.display()
            ));
        };
        match classify_source_transaction(&journal, current_document.as_ref())? {
            SourceTransactionRecovery::Finalize => {
                if journal.phase == SourceTransactionPhase::Prepared {
                    journal.phase = SourceTransactionPhase::StateCommitted;
                    write_source_transaction_journal(
                        &transaction_root,
                        &journal,
                        AtomicWriteMode::Replace,
                    )?;
                }
                finalize.push(transaction_root);
            }
            SourceTransactionRecovery::RollBack => {
                if journal.phase == SourceTransactionPhase::Prepared {
                    crate::program_sources::rollback_quarantined_transaction(
                        &transaction_root,
                        &journal.owner_button_ids,
                    )?;
                    journal.phase = SourceTransactionPhase::RolledBack;
                    write_source_transaction_journal(
                        &transaction_root,
                        &journal,
                        AtomicWriteMode::Replace,
                    )?;
                }
                finalize.push(transaction_root);
            }
        }
    }
    Ok(finalize)
}

fn finalize_source_transaction_roots(paths: &[PathBuf]) {
    let existing = paths
        .iter()
        .filter(|path| path.is_dir())
        .cloned()
        .collect::<Vec<_>>();
    if !existing.is_empty() {
        let _ = crate::recycle_directory_paths(&existing);
    }
}

fn document_source_owners(document: &Value, verify_active: bool) -> Result<Vec<String>, String> {
    let buttons = document
        .get("buttons")
        .and_then(Value::as_object)
        .ok_or_else(|| "Button state is missing its buttons object.".to_string())?;
    let mut owners = Vec::new();
    for (button_id, button) in buttons {
        let is_frontend_macro = button
            .get("metadata")
            .and_then(Value::as_object)
            .and_then(|metadata| metadata.get("sourceKind"))
            .and_then(Value::as_str)
            .is_some_and(|kind| kind.eq_ignore_ascii_case("frontend-macro"));
        if is_frontend_macro {
            continue;
        }
        let source_identity = button
            .get("sourceIdentity")
            .filter(|value| !value.is_null());
        let Some(source_identity) = source_identity else {
            continue;
        };
        let owner = crate::program_sources::validate_owner_button_id(button_id)?;
        let identity = source_identity
            .as_object()
            .ok_or_else(|| format!("Button '{button_id}' has an invalid sourceIdentity."))?;
        let field = |name: &str| {
            identity
                .get(name)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| format!("Button '{button_id}' sourceIdentity is missing {name}."))
        };
        let program_name = field("displayProgramName")?;
        let panel_name = field("displayPanelName")?;
        let file_name = field("displayFileName")?;
        if verify_active {
            let resolution = crate::program_sources::execute::resolve_active_source_record(
                program_name,
                panel_name,
                file_name,
            )?
            .ok_or_else(|| {
                format!("Button '{button_id}' does not reference an active owned source record.")
            })?;
            if resolution.record.owner_button_id != owner {
                return Err(format!(
                    "Button '{button_id}' references source owned by '{}'.",
                    resolution.record.owner_button_id
                ));
            }
        }
        owners.push(owner);
    }
    owners.sort_by_key(|value| value.to_ascii_lowercase());
    owners.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
    Ok(owners)
}

fn restore_previous_state(path: &Path, previous: Option<&Value>) -> Result<(), String> {
    if let Some(previous) = previous {
        atomic_write_json(path, previous)
    } else if path.is_file() {
        crate::recycle_file_path(path)
    } else {
        Ok(())
    }
}

fn rollback_source_transaction(
    transaction_root: &Path,
    journal: &mut ButtonSourceTransactionJournal,
    state_path: &Path,
    restore_state: bool,
) -> (Vec<String>, bool) {
    let mut rollback_errors = Vec::new();
    if restore_state {
        if let Err(error) = restore_previous_state(state_path, journal.previous_document.as_ref()) {
            rollback_errors.push(format!("Button state restore failed: {error}"));
        }
    }
    if let Err(error) = crate::program_sources::rollback_quarantined_transaction(
        transaction_root,
        &journal.owner_button_ids,
    ) {
        rollback_errors.push(format!("owned source restore failed: {error}"));
    }
    if rollback_errors.is_empty() {
        journal.phase = SourceTransactionPhase::RolledBack;
        if let Err(error) =
            write_source_transaction_journal(transaction_root, journal, AtomicWriteMode::Replace)
        {
            rollback_errors.push(format!("rollback journal update failed: {error}"));
        }
    }
    let can_finalize = rollback_errors.is_empty();
    (rollback_errors, can_finalize)
}

fn compound_rollback_error(error: String, rollback_errors: Vec<String>) -> String {
    if rollback_errors.is_empty() {
        error
    } else {
        format!("{error} Rollback failed: {}", rollback_errors.join(" | "))
    }
}

fn resolve_program_rename_post_commit<F>(
    completion: Result<(), String>,
    recover: F,
) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    match completion {
        Ok(()) => Ok(()),
        Err(completion_error) => recover().map_err(|recovery_error| {
            format!(
                "Canonical Button state was saved, but program rename finalization failed: {completion_error} Recovery also failed: {recovery_error}"
            )
        }),
    }
}

#[tauri::command]
pub(crate) fn load_button_state() -> Result<Option<Value>, String> {
    let lock = BUTTON_STATE_COMMIT_LOCK.get_or_init(|| Mutex::new(()));
    let guard = lock
        .lock()
        .map_err(|_| "Button state commit lock is poisoned.".to_string())?;
    let source_guard = crate::program_sources::source_quarantine_guard()?;
    let bindings_guard = crate::commands::bindings::bindings_state_guard()?;
    let path = button_state_path()?;
    let cleanup = recover_source_transactions_locked(&path)?;
    let result = if path.is_file() {
        read_button_state_document(&path).map(Some)
    } else {
        Ok(None)
    };
    drop(bindings_guard);
    drop(source_guard);
    drop(guard);
    finalize_source_transaction_roots(&cleanup);
    result
}

pub(crate) fn recover_button_source_transactions_on_startup() -> Result<(), String> {
    let lock = BUTTON_STATE_COMMIT_LOCK.get_or_init(|| Mutex::new(()));
    let guard = lock
        .lock()
        .map_err(|_| "Button state commit lock is poisoned.".to_string())?;
    let source_guard = crate::program_sources::source_quarantine_guard()?;
    let bindings_guard = crate::commands::bindings::bindings_state_guard()?;
    let path = button_state_path()?;
    let cleanup = recover_source_transactions_locked(&path)?;
    drop(bindings_guard);
    drop(source_guard);
    drop(guard);
    finalize_source_transaction_roots(&cleanup);
    Ok(())
}

pub(crate) fn recover_program_rename_transactions_on_startup() -> Result<usize, String> {
    let guard = button_state_commit_guard()?;
    let source_guard = crate::program_sources::source_quarantine_guard()?;
    let current = read_button_state_for_program_rename_locked()?;
    let result = crate::commands::program_rename::recover_program_renames_locked(current.as_ref());
    drop(source_guard);
    drop(guard);
    result
}

// The caller must hold the Button source quarantine lock. Canonical commits
// acquire that lock before reading or writing source ownership, so this check
// cannot race a commit that is adding or removing the same installed source.
pub(crate) fn canonical_state_references_source_owner_while_source_locked(
    owner_button_id: &str,
) -> Result<bool, String> {
    let owner = crate::program_sources::validate_owner_button_id(owner_button_id)?;
    let path = button_state_path()?;
    recover_button_state(&path)?;
    if !path.is_file() {
        return Ok(false);
    }
    Ok(
        document_source_owners(&read_button_state_document(&path)?, false)?
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(&owner)),
    )
}

#[tauri::command]
pub(crate) fn commit_button_state(
    app: tauri::AppHandle,
    request: CommitButtonStateRequest,
) -> Result<(), String> {
    let lock = BUTTON_STATE_COMMIT_LOCK.get_or_init(|| Mutex::new(()));
    let guard = lock
        .lock()
        .map_err(|_| "Button state commit lock is poisoned.".to_string())?;
    let source_guard = crate::program_sources::source_quarantine_guard()?;
    // Source removal and rollback rewrite bindings.ini. Hold the same mutation
    // lane as Binds saves for the entire canonical-state transaction so neither
    // side can overwrite the other's document snapshot.
    let bindings_guard = crate::commands::bindings::bindings_state_guard()?;
    validate_button_state(&request.document)?;
    let next_revision = document_revision(&request.document)?;
    let required_revision = request
        .expected_revision
        .checked_add(1)
        .ok_or_else(|| "Button state revision cannot advance beyond u64::MAX.".to_string())?;
    if next_revision != required_revision {
        return Err(format!(
            "Button state revision {} must follow expected revision {}.",
            next_revision, request.expected_revision
        ));
    }

    let state_path = button_state_path()?;
    let mut cleanup = recover_source_transactions_locked(&state_path)?;
    let previous_document = if state_path.is_file() {
        Some(read_button_state_document(&state_path)?)
    } else {
        None
    };
    let current_revision = previous_document
        .as_ref()
        .map(document_revision)
        .transpose()?
        .unwrap_or(0);
    if current_revision != request.expected_revision {
        return Err(format!(
            "Button state changed before Save. Expected revision {}, found {}.",
            request.expected_revision, current_revision
        ));
    }

    let program_rename_token = request
        .program_rename_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if crate::commands::program_rename::has_pending_program_rename_transaction()?
        && program_rename_token.is_none()
    {
        return Err(
            "Canonical Button state is locked by a pending program rename transaction.".to_string(),
        );
    }
    let mut program_rename_post_commit_error = None;
    if let Some(token) = program_rename_token.as_deref() {
        crate::commands::program_rename::prepare_canonical_commit_locked(
            token,
            previous_document.as_ref(),
            &request.document,
        )?;
    }

    let previous_source_owners = previous_document
        .as_ref()
        .map(|document| document_source_owners(document, false))
        .transpose()?
        .unwrap_or_default();
    let next_source_owners = document_source_owners(&request.document, true)?;
    // Validate pending Add Button/generated installs while the canonical state
    // and source lanes are both locked. The short-lived intents are removed
    // only after this canonical document can no longer be rolled back.
    let pending_install_finalizations =
        crate::program_sources::pending_install::prepare_pending_canonical_finalizations(
            &request.document,
        )?;

    let mut owner_ids = Vec::new();
    for value in request.uninstall_owner_button_ids {
        let owner = crate::program_sources::validate_owner_button_id(&value)?;
        if !owner_ids
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(&owner))
        {
            owner_ids.push(owner);
        }
    }
    let mut required_uninstalls = previous_source_owners
        .into_iter()
        .filter(|owner| {
            !next_source_owners
                .iter()
                .any(|next| next.eq_ignore_ascii_case(owner))
        })
        .collect::<Vec<_>>();
    required_uninstalls.sort_by_key(|value| value.to_ascii_lowercase());
    let mut supplied_uninstalls = owner_ids.clone();
    supplied_uninstalls.sort_by_key(|value| value.to_ascii_lowercase());
    if required_uninstalls.len() != supplied_uninstalls.len()
        || required_uninstalls.iter().any(|required| {
            !supplied_uninstalls
                .iter()
                .any(|supplied| supplied.eq_ignore_ascii_case(required))
        })
    {
        return Err(format!(
            "Button source uninstall set does not match removed source owners. Required: [{}]. Supplied: [{}].",
            required_uninstalls.join(", "),
            supplied_uninstalls.join(", ")
        ));
    }

    let transaction = if owner_ids.is_empty() {
        None
    } else {
        let transaction_root = source_quarantine_root()?.join(format!(
            "commit-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let journal = ButtonSourceTransactionJournal {
            schema_version: SOURCE_TRANSACTION_SCHEMA_VERSION,
            phase: SourceTransactionPhase::Prepared,
            previous_document: previous_document.clone(),
            next_document: request.document.clone(),
            owner_button_ids: owner_ids.clone(),
        };
        write_source_transaction_journal(&transaction_root, &journal, AtomicWriteMode::Create)?;
        Some((transaction_root, journal))
    };

    if let Some((transaction_root, journal)) = transaction.as_ref() {
        for owner in &owner_ids {
            if let Err(error) =
                crate::program_sources::quarantine_owned_source(owner, transaction_root)
            {
                let mut journal = journal.clone();
                let (rollback_errors, can_finalize) =
                    rollback_source_transaction(transaction_root, &mut journal, &state_path, false);
                if can_finalize {
                    cleanup.push(transaction_root.clone());
                }
                let result = Err(compound_rollback_error(error, rollback_errors));
                drop(source_guard);
                drop(guard);
                finalize_source_transaction_roots(&cleanup);
                return result;
            }
        }
    }

    if let Err(error) = atomic_write_json(&state_path, &request.document) {
        if let Some((transaction_root, journal)) = transaction.as_ref() {
            let mut journal = journal.clone();
            let (rollback_errors, can_finalize) =
                rollback_source_transaction(transaction_root, &mut journal, &state_path, false);
            if can_finalize {
                cleanup.push(transaction_root.clone());
            }
            let result = Err(compound_rollback_error(error, rollback_errors));
            drop(source_guard);
            drop(guard);
            drop(bindings_guard);
            finalize_source_transaction_roots(&cleanup);
            return result;
        }
        drop(source_guard);
        drop(guard);
        finalize_source_transaction_roots(&cleanup);
        return Err(error);
    }

    if let Some(token) = request
        .migration_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if let Err(error) = crate::program_sources::finalize_migration_token_locked(token) {
            if let Some((transaction_root, journal)) = transaction.as_ref() {
                let mut journal = journal.clone();
                let (rollback_errors, can_finalize) =
                    rollback_source_transaction(transaction_root, &mut journal, &state_path, true);
                if can_finalize {
                    cleanup.push(transaction_root.clone());
                }
                let result = Err(compound_rollback_error(error, rollback_errors));
                drop(source_guard);
                drop(guard);
                finalize_source_transaction_roots(&cleanup);
                return result;
            }
            let rollback_errors = restore_previous_state(&state_path, previous_document.as_ref())
                .err()
                .map(|rollback_error| {
                    vec![format!("Button state restore failed: {rollback_error}")]
                })
                .unwrap_or_default();
            let result = Err(compound_rollback_error(error, rollback_errors));
            drop(source_guard);
            drop(guard);
            finalize_source_transaction_roots(&cleanup);
            return result;
        }
    }

    if let Some(token) = program_rename_token.as_deref() {
        // The canonical file is already committed. If the final journal update
        // is interrupted, startup compares the exact pre/post documents and
        // deterministically completes this same side of the transaction.
        let completion = crate::commands::program_rename::complete_canonical_commit_locked(
            token,
            &request.document,
        );
        if let Err(error) = resolve_program_rename_post_commit(completion, || {
            crate::commands::program_rename::resolve_program_rename_locked(
                token,
                Some(&request.document),
            )
            .map(|_| ())
        }) {
            program_rename_post_commit_error = Some(error);
        }
    }

    for error in
        crate::program_sources::pending_install::finalize_prepared_pending_canonical_installs(
            &pending_install_finalizations,
        )
    {
        // Canonical state is already committed. Keep the validated intent for
        // deterministic startup finalization instead of reporting this durable
        // commit as failed to the frontend.
        let message = format!(
            "Canonical Button state was saved, but pending-install cleanup was deferred: {error}"
        );
        eprintln!("{message}");
        crate::append_flowcell_local_log("button_state.log", &message);
    }

    if let Some((transaction_root, mut journal)) = transaction {
        journal.phase = SourceTransactionPhase::StateCommitted;
        if let Err(error) =
            write_source_transaction_journal(&transaction_root, &journal, AtomicWriteMode::Replace)
        {
            // Canonical state is already committed. Leave the prepared journal
            // in place so startup recovery can infer the same commit boundary.
            let _ = error;
            drop(source_guard);
            drop(guard);
            drop(bindings_guard);
            finalize_source_transaction_roots(&cleanup);
            synchronize_tool_set_hotkeys_after_commit(&app);
            return match program_rename_post_commit_error {
                Some(program_error) => Err(program_error),
                None => Ok(()),
            };
        }
        cleanup.push(transaction_root);
    }
    drop(source_guard);
    drop(guard);
    drop(bindings_guard);
    finalize_source_transaction_roots(&cleanup);
    synchronize_tool_set_hotkeys_after_commit(&app);
    match program_rename_post_commit_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        button_settings_default_path, classify_source_transaction, document_source_owners,
        load_button_placement_file, load_button_settings_file, load_button_skin_file,
        read_button_state_document, recover_button_state, resolve_program_rename_post_commit,
        save_button_placement_file, save_button_settings_file, save_button_skin_file,
        validate_button_placement_file, validate_button_settings_file, validate_button_skin_source,
        validate_button_state, validate_default_surface_id, ButtonPlacementFile,
        ButtonPlacementFileEntryV1, ButtonPlacementFileEntryV2, ButtonPlacementFileSize,
        ButtonPlacementFileSurface, ButtonPlacementFileV1, ButtonPlacementFileV2,
        ButtonPlacementSurfaceKind, ButtonSettingsFileV1, ButtonSettingsPlacementKind,
        ButtonSourceTransactionJournal, SourceTransactionPhase, SourceTransactionRecovery,
        BUTTON_PLACEMENT_CYCLE_MAX_STATES, BUTTON_PLACEMENT_FILE_EXTENSION,
        BUTTON_PLACEMENT_FILE_FORMAT_V1, BUTTON_PLACEMENT_FILE_FORMAT_V2,
        BUTTON_SETTINGS_DEFAULT_DIRECTORY_NAME, BUTTON_SETTINGS_DEFAULT_FILE_EXTENSION,
        BUTTON_SETTINGS_FILE_EXTENSION, BUTTON_SETTINGS_FILE_FORMAT, BUTTON_SKIN_FILE_EXTENSION,
        BUTTON_SKIN_FILE_MAX_BYTES, SOURCE_TRANSACTION_SCHEMA_VERSION,
    };
    use serde_json::{json, Value};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn button_placement_test_root(label: &str) -> PathBuf {
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "flowcell-button-placement-{label}-{}-{token}",
            std::process::id()
        ))
    }

    fn valid_button_placement_file() -> ButtonPlacementFile {
        ButtonPlacementFile::V2(ButtonPlacementFileV2 {
            format: BUTTON_PLACEMENT_FILE_FORMAT_V2.to_string(),
            saved_at: "2026-07-21T12:34:56.000Z".to_string(),
            program_name: "Blender".to_string(),
            panel_name: "Tools".to_string(),
            surface: ButtonPlacementFileSurface {
                id: "surface-tools".to_string(),
                name: "Tools".to_string(),
                kind: ButtonPlacementSurfaceKind::Panel,
                width: 400.0,
                height: 240.0,
                uniform_button_size: Some(ButtonPlacementFileSize {
                    width: 100.0,
                    height: 40.0,
                }),
            },
            placements: vec![
                ButtonPlacementFileEntryV2 {
                    id: "placement-one".to_string(),
                    button_id: "button-one".to_string(),
                    x: 0.0,
                    y: 0.0,
                    width: 100.0,
                    height: 40.0,
                    z_index: 0,
                    activation_cycle: json!({
                        "states": [
                            {
                                "id": "off",
                                "label": "Off",
                                "advanceTrigger": "release",
                                "visualState": "base",
                                "resultMatches": [
                                    { "enabled": false }
                                ]
                            },
                            {
                                "id": "on",
                                "label": "On",
                                "advanceTrigger": "press",
                                "visualState": "held",
                                "resultMatches": [
                                    { "enabled": true }
                                ]
                            }
                        ]
                    }),
                    highlight_on_hover: true,
                },
                ButtonPlacementFileEntryV2 {
                    id: "placement-two".to_string(),
                    button_id: "button-two".to_string(),
                    x: 0.0,
                    y: 60.0,
                    width: 100.0,
                    height: 40.0,
                    z_index: 1,
                    activation_cycle: Value::Null,
                    highlight_on_hover: false,
                },
            ],
        })
    }

    fn valid_button_placement_file_v1() -> ButtonPlacementFile {
        ButtonPlacementFile::V1(ButtonPlacementFileV1 {
            format: BUTTON_PLACEMENT_FILE_FORMAT_V1.to_string(),
            saved_at: "2026-07-21T12:34:56.000Z".to_string(),
            program_name: "Blender".to_string(),
            panel_name: "Tools".to_string(),
            surface: ButtonPlacementFileSurface {
                id: "surface-tools".to_string(),
                name: "Tools".to_string(),
                kind: ButtonPlacementSurfaceKind::Panel,
                width: 400.0,
                height: 240.0,
                uniform_button_size: None,
            },
            placements: vec![ButtonPlacementFileEntryV1 {
                id: "placement-one".to_string(),
                button_id: "button-one".to_string(),
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 40.0,
                z_index: 0,
            }],
        })
    }

    fn valid_button_settings_file() -> ButtonSettingsFileV1 {
        ButtonSettingsFileV1 {
            format: BUTTON_SETTINGS_FILE_FORMAT.to_string(),
            saved_at: "2026-07-21T12:34:56.000Z".to_string(),
            placement_kind: ButtonSettingsPlacementKind::MainPage,
            program_name: "Blender".to_string(),
            panel_name: "Tools".to_string(),
            source_surface_id: "surface-tools".to_string(),
            surface: json!({
                "name": "Blender / Tools",
                "kind": "panel",
                "width": 400.0,
                "height": 240.0,
                "visualOverflowAllowance": 24.0,
                "uniformButtonSize": null
            }),
            behavior: json!({ "kind": "main-page" }),
            entries: vec![json!({
                "placementId": "placement-one",
                "buttonId": "button-one",
                "buttonRole": "single-script",
                "label": "One",
                "activationBehavior": null,
                "activationAnimation": null,
                "skin": {},
                "placement": {
                    "x": 0.0,
                    "y": 0.0,
                    "width": 100.0,
                    "height": 40.0,
                    "zIndex": 0,
                    "textFitMode": "shrink",
                    "textAlignment": "skin",
                    "textOffsetX": 0.0,
                    "textOffsetY": 0.0,
                    "minimumFontSize": 8.0,
                    "textSizeOverride": null,
                    "allowLabelResize": false,
                    "matchHitboxToSkin": true,
                    "allowStretching": false,
                    "highlightOnHover": false,
                    "resizeAnchor": "top-left",
                    "activationCycle": null,
                    "visualStateMap": null
                }
            })],
        }
    }

    fn valid_button_skin_source() -> String {
        [
            "=== structure ===\n<div data-core>{{label}}</div>",
            "=== keyframes ===",
            "=== base ===\nfont-size: 13px;\nline-height: 17px;",
            "=== hover ===",
            "=== play ===",
            "=== pressed ===",
            "=== held ===",
            "=== release ===",
            "=== disabled ===",
            "=== error ===",
        ]
        .join("\n")
    }

    #[test]
    fn button_skin_writer_uses_native_save_path_and_canonical_text_extension() {
        let root = button_placement_test_root("skin-valid");
        fs::create_dir_all(&root).expect("create skin test root");
        let requested_path = root.join("neon.txt");
        let expected_path = root.join(format!("neon{BUTTON_SKIN_FILE_EXTENSION}"));

        let saved_path = save_button_skin_file(
            requested_path.display().to_string(),
            valid_button_skin_source(),
        )
        .expect("save valid Button skin");

        assert_eq!(PathBuf::from(saved_path), expected_path);
        assert!(!requested_path.exists());
        let written = fs::read_to_string(&expected_path).expect("read saved skin");
        assert!(validate_button_skin_source(&written).is_ok());
        assert_eq!(
            load_button_skin_file(expected_path.display().to_string())
                .expect("load saved Button skin"),
            written
        );
        fs::remove_dir_all(&root).expect("remove skin test root");
    }

    #[test]
    fn button_skin_writer_rejects_missing_canonical_sections_before_writing() {
        let root = button_placement_test_root("skin-invalid");
        fs::create_dir_all(&root).expect("create invalid skin test root");
        let target = root.join(format!("invalid{BUTTON_SKIN_FILE_EXTENSION}"));
        let error = save_button_skin_file(
            target.display().to_string(),
            "=== structure ===\n<div data-core></div>".to_string(),
        )
        .expect_err("incomplete skin source must fail");

        assert!(error.contains("keyframes"));
        assert!(!target.exists());
        fs::remove_dir_all(&root).expect("remove invalid skin test root");
    }

    #[test]
    fn button_skin_loader_rejects_invalid_and_oversized_files() {
        let root = button_placement_test_root("skin-load-invalid");
        fs::create_dir_all(&root).expect("create invalid skin load root");
        let invalid_path = root.join(format!("invalid{BUTTON_SKIN_FILE_EXTENSION}"));
        fs::write(&invalid_path, "=== structure ===\n<div data-core></div>")
            .expect("write invalid skin source");
        assert!(load_button_skin_file(invalid_path.display().to_string())
            .expect_err("invalid skin file must fail")
            .contains("keyframes"));

        let oversized_path = root.join(format!("oversized{BUTTON_SKIN_FILE_EXTENSION}"));
        fs::write(&oversized_path, vec![b'x'; BUTTON_SKIN_FILE_MAX_BYTES + 1])
            .expect("write oversized skin source");
        assert!(load_button_skin_file(oversized_path.display().to_string())
            .expect_err("oversized skin file must fail")
            .contains("2 MiB"));
        fs::remove_dir_all(&root).expect("remove invalid skin load root");
    }

    #[test]
    fn button_placement_writer_uses_exact_extension_and_validated_atomic_json() {
        let root = button_placement_test_root("valid");
        fs::create_dir_all(&root).expect("create placement test root");
        let requested_path = root.join("named-arrangement.json");
        let expected_path = root.join(format!(
            "named-arrangement{BUTTON_PLACEMENT_FILE_EXTENSION}"
        ));

        let saved_path = save_button_placement_file(
            requested_path.display().to_string(),
            valid_button_placement_file(),
        )
        .expect("save valid Button placement");

        assert_eq!(PathBuf::from(saved_path), expected_path);
        assert!(!requested_path.exists());
        let written = fs::read_to_string(&expected_path).expect("read saved placement");
        let parsed = load_button_placement_file(expected_path.display().to_string())
            .expect("load saved placement");
        assert_eq!(
            serde_json::to_value(&parsed).expect("serialize loaded placement"),
            serde_json::from_str::<Value>(&written).expect("parse written placement")
        );
        assert!(validate_button_placement_file(&parsed).is_ok());
        let ButtonPlacementFile::V2(parsed) = parsed else {
            panic!("writer should preserve the v2 placement format");
        };
        assert_eq!(parsed.placements[0].id, "placement-one");
        assert_eq!(parsed.placements[1].z_index, 1);
        assert!(parsed.placements[0].highlight_on_hover);
        assert!(!parsed.placements[1].highlight_on_hover);
        assert_eq!(
            parsed.placements[0].activation_cycle["states"][1]["visualState"],
            "held"
        );
        assert_eq!(
            parsed.placements[0].activation_cycle["states"][1]["resultMatches"][0]["enabled"],
            true
        );

        fs::remove_dir_all(&root).expect("remove placement test root");
    }

    #[test]
    fn button_settings_writer_uses_type_extension_and_round_trips() {
        let root = button_placement_test_root("settings-valid");
        fs::create_dir_all(&root).expect("create settings test root");
        let requested_path = root.join("named-settings.json");
        let expected_path = root.join(format!("named-settings{BUTTON_SETTINGS_FILE_EXTENSION}"));

        let saved_path = save_button_settings_file(
            requested_path.display().to_string(),
            valid_button_settings_file(),
        )
        .expect("save valid Button settings");

        assert_eq!(PathBuf::from(saved_path), expected_path);
        assert!(!requested_path.exists());
        let written = fs::read_to_string(&expected_path).expect("read saved settings");
        let parsed = load_button_settings_file(expected_path.display().to_string())
            .expect("load saved settings");
        assert_eq!(
            serde_json::to_value(&parsed).expect("serialize loaded settings"),
            serde_json::from_str::<Value>(&written).expect("parse written settings")
        );
        assert!(validate_button_settings_file(&parsed).is_ok());
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0]["buttonId"], "button-one");

        fs::remove_dir_all(&root).expect("remove settings test root");
    }

    #[test]
    fn button_settings_categories_and_default_surface_ids_are_strict() {
        assert_eq!(
            ButtonSettingsPlacementKind::MainPage.directory_name(),
            "Main Page"
        );
        assert_eq!(ButtonSettingsPlacementKind::Fan.directory_name(), "Fan");
        assert_eq!(
            ButtonSettingsPlacementKind::PopOut.directory_name(),
            "Pop-out"
        );
        assert!(ButtonSettingsPlacementKind::MainPage
            .accepts_surface_kind(ButtonPlacementSurfaceKind::Main));
        assert!(ButtonSettingsPlacementKind::MainPage
            .accepts_surface_kind(ButtonPlacementSurfaceKind::Panel));
        assert!(
            ButtonSettingsPlacementKind::Fan.accepts_surface_kind(ButtonPlacementSurfaceKind::Fan)
        );
        assert!(ButtonSettingsPlacementKind::PopOut
            .accepts_surface_kind(ButtonPlacementSurfaceKind::RegularPopout));
        assert!(ButtonSettingsPlacementKind::PopOut
            .accepts_surface_kind(ButtonPlacementSurfaceKind::ToolSetPopout));
        assert!(!ButtonSettingsPlacementKind::PopOut
            .accepts_surface_kind(ButtonPlacementSurfaceKind::Fan));

        assert_eq!(
            validate_default_surface_id("surface-safe_1.test")
                .expect("safe surface ID should pass"),
            "surface-safe_1.test"
        );
        let default_path =
            button_settings_default_path(ButtonSettingsPlacementKind::Fan, "surface-safe_1.test")
                .expect("build safe default path");
        let expected_default_file_name =
            format!("default-surface-safe_1.test{BUTTON_SETTINGS_DEFAULT_FILE_EXTENSION}");
        assert_eq!(
            default_path.file_name().and_then(|value| value.to_str()),
            Some(expected_default_file_name.as_str())
        );
        assert_eq!(
            default_path
                .parent()
                .and_then(|value| value.file_name())
                .and_then(|value| value.to_str()),
            Some(BUTTON_SETTINGS_DEFAULT_DIRECTORY_NAME)
        );
        assert!(!default_path
            .to_string_lossy()
            .ends_with(BUTTON_SETTINGS_FILE_EXTENSION));
        assert!(validate_default_surface_id("../escape").is_err());
        assert!(validate_default_surface_id("folder/surface").is_err());
        assert!(validate_default_surface_id(r"folder\surface").is_err());

        let mut wrong_category = valid_button_settings_file();
        wrong_category.placement_kind = ButtonSettingsPlacementKind::Fan;
        assert!(validate_button_settings_file(&wrong_category).is_err());

        let mut unknown_outer_field =
            serde_json::to_value(valid_button_settings_file()).expect("serialize settings fixture");
        unknown_outer_field
            .as_object_mut()
            .expect("settings fixture object")
            .insert("actions".to_string(), json!([]));
        assert!(
            serde_json::from_value::<ButtonSettingsFileV1>(unknown_outer_field).is_err(),
            "settings files must reject unknown outer fields"
        );
    }

    #[test]
    fn button_placement_loader_rejects_invalid_or_missing_files() {
        let root = button_placement_test_root("load-invalid");
        fs::create_dir_all(&root).expect("create invalid load test root");
        let invalid_json = root.join("invalid-json.flowcell-button-placement.json");
        fs::write(&invalid_json, b"{ not valid json").expect("write invalid placement");
        let error = load_button_placement_file(invalid_json.display().to_string())
            .expect_err("invalid JSON must fail");
        assert!(error.contains("is invalid"));

        let unknown_field = root.join("unknown-field.flowcell-button-placement.json");
        let mut value = serde_json::to_value(valid_button_placement_file())
            .expect("serialize placement fixture");
        value
            .as_object_mut()
            .expect("placement fixture object")
            .insert("skins".to_string(), json!({}));
        fs::write(
            &unknown_field,
            serde_json::to_vec_pretty(&value).expect("serialize invalid placement"),
        )
        .expect("write unknown-field placement");
        let error = load_button_placement_file(unknown_field.display().to_string())
            .expect_err("unknown fields must fail");
        assert!(error.contains("unknown field"));

        let missing = root.join("missing.flowcell-button-placement.json");
        let error = load_button_placement_file(missing.display().to_string())
            .expect_err("missing placement file must fail");
        assert!(error.contains("Failed to read Button placement"));
        fs::remove_dir_all(&root).expect("remove invalid load test root");
    }

    #[test]
    fn invalid_button_placement_does_not_touch_existing_destination() {
        let root = button_placement_test_root("invalid");
        fs::create_dir_all(&root).expect("create placement test root");
        let target = root.join(format!("preserve{BUTTON_PLACEMENT_FILE_EXTENSION}"));
        fs::write(&target, b"preserve this exact content").expect("write sentinel");
        let mut invalid = valid_button_placement_file();
        let ButtonPlacementFile::V2(invalid_file) = &mut invalid else {
            panic!("fixture should use v2");
        };
        invalid_file.placements[1].z_index = 9;

        let error = save_button_placement_file(target.display().to_string(), invalid)
            .expect_err("invalid placement must fail before writing");

        assert!(error.contains("must use zIndex 1"));
        assert_eq!(
            fs::read(&target).expect("read untouched sentinel"),
            b"preserve this exact content"
        );
        fs::remove_dir_all(&root).expect("remove placement test root");
    }

    #[test]
    fn button_placement_schema_rejects_unknown_fields() {
        let mut value = serde_json::to_value(valid_button_placement_file())
            .expect("serialize placement fixture");
        value
            .as_object_mut()
            .expect("placement fixture object")
            .insert("skins".to_string(), json!({}));
        assert!(serde_json::from_value::<ButtonPlacementFile>(value).is_err());
    }

    #[test]
    fn button_placement_schema_keeps_v1_compatible_and_validates_v2_activation_cycles() {
        let v1 = valid_button_placement_file_v1();
        assert!(validate_button_placement_file(&v1).is_ok());
        let serialized_v1 = serde_json::to_value(&v1).expect("serialize v1 placement");
        let parsed_v1: ButtonPlacementFile =
            serde_json::from_value(serialized_v1).expect("parse v1 placement");
        assert!(matches!(parsed_v1, ButtonPlacementFile::V1(_)));

        let mut empty_v1 = valid_button_placement_file_v1();
        let ButtonPlacementFile::V1(file) = &mut empty_v1 else {
            panic!("fixture should use v1");
        };
        file.placements.clear();
        let serialized_empty_v1 =
            serde_json::to_value(empty_v1).expect("serialize empty v1 placement");
        let parsed_empty_v1: ButtonPlacementFile = serde_json::from_value(serialized_empty_v1)
            .expect("format dispatch should preserve an empty v1 placement");
        assert!(matches!(parsed_empty_v1, ButtonPlacementFile::V1(_)));
        assert!(validate_button_placement_file(&parsed_empty_v1).is_ok());

        let mut malformed = valid_button_placement_file();
        let ButtonPlacementFile::V2(file) = &mut malformed else {
            panic!("fixture should use v2");
        };
        file.placements[0].activation_cycle = json!({
            "states": [
                {
                    "id": "duplicate",
                    "label": "One",
                    "advanceTrigger": "release",
                    "visualState": "base"
                },
                {
                    "id": "duplicate",
                    "label": "Two",
                    "advanceTrigger": "hover",
                    "visualState": "hover"
                }
            ]
        });
        let error = validate_button_placement_file(&malformed)
            .expect_err("duplicate activation-cycle state IDs must fail");
        assert!(error.contains("repeats state ID 'duplicate'"));

        let mut invalid_result_match = valid_button_placement_file();
        let ButtonPlacementFile::V2(file) = &mut invalid_result_match else {
            panic!("fixture should use v2");
        };
        file.placements[0].activation_cycle["states"][0]["resultMatches"] =
            json!(["not-an-object"]);
        let error = validate_button_placement_file(&invalid_result_match)
            .expect_err("activation-cycle result matches must be JSON objects");
        assert!(error.contains("resultMatches entry 0 must be a JSON object"));

        let mut too_many = valid_button_placement_file();
        let ButtonPlacementFile::V2(file) = &mut too_many else {
            panic!("fixture should use v2");
        };
        let states = (0..=BUTTON_PLACEMENT_CYCLE_MAX_STATES)
            .map(|index| {
                json!({
                    "id": format!("state-{index}"),
                    "label": format!("State {}", index + 1),
                    "advanceTrigger": "press",
                    "visualState": "base"
                })
            })
            .collect::<Vec<_>>();
        file.placements[0].activation_cycle = json!({ "states": states });
        let error = validate_button_placement_file(&too_many)
            .expect_err("oversized activation cycles must fail");
        assert!(error.contains("cannot exceed 64 states"));
    }

    #[test]
    fn button_state_requires_positive_schema_version() {
        assert!(validate_button_state(&json!({ "schemaVersion": 1 })).is_ok());
        assert!(validate_button_state(&json!({ "schemaVersion": 0 })).is_err());
        assert!(validate_button_state(&json!({})).is_err());
    }

    #[test]
    fn post_commit_program_rename_failure_is_hidden_only_when_recovery_succeeds() {
        assert!(
            resolve_program_rename_post_commit(Err("finalize failed".to_string()), || Ok(()))
                .is_ok()
        );
        let error = resolve_program_rename_post_commit(Err("finalize failed".to_string()), || {
            Err("recovery failed".to_string())
        })
        .expect_err("double failure must be returned after canonical commit");
        assert!(error.contains("Canonical Button state was saved"));
        assert!(error.contains("finalize failed"));
        assert!(error.contains("recovery failed"));
    }

    #[test]
    fn frontend_macro_identity_is_not_treated_as_an_installed_source_owner() {
        let document = json!({
            "buttons": {
                "macro-one": {
                    "sourceIdentity": {
                        "displayProgramName": "Windows",
                        "displayPanelName": "Files",
                        "displayFileName": "macro:one"
                    },
                    "metadata": {"sourceKind":"frontend-macro"}
                }
            }
        });
        assert!(document_source_owners(&document, false)
            .expect("collect source owners")
            .is_empty());
    }

    #[test]
    fn missing_button_state_is_recovered_from_a_valid_backup() {
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "flowcell-button-state-recovery-{}-{token}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create recovery test root");
        let state_path = root.join("button-state.json");
        let backup_path = root.join(".button-state.json.1.backup");
        fs::write(
            &backup_path,
            serde_json::to_string(&json!({"schemaVersion": 1, "revision": 7}))
                .expect("serialize backup"),
        )
        .expect("write backup");

        recover_button_state(&state_path).expect("recover Button state");

        assert!(state_path.is_file());
        assert!(!backup_path.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn source_transaction_recovery_uses_the_canonical_state_commit_boundary() {
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "flowcell-source-transaction-cut-{}-{token}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create transaction cut test root");
        let previous = json!({"schemaVersion": 1, "revision": 4});
        let next = json!({"schemaVersion": 1, "revision": 5});
        let journal = ButtonSourceTransactionJournal {
            schema_version: SOURCE_TRANSACTION_SCHEMA_VERSION,
            phase: SourceTransactionPhase::Prepared,
            previous_document: Some(previous.clone()),
            next_document: next.clone(),
            owner_button_ids: vec!["owner-one".to_string()],
        };

        // Cut before the staged next state is renamed into place: the atomic
        // state recovery selects the old backup, so owned resources roll back.
        let before_commit = root.join("before/button-state.json");
        fs::create_dir_all(before_commit.parent().expect("before parent"))
            .expect("create before directory");
        fs::write(
            before_commit.with_file_name(".button-state.json.1.backup"),
            serde_json::to_vec(&previous).expect("serialize previous"),
        )
        .expect("write previous backup");
        fs::write(
            before_commit.with_file_name(".button-state.json.2.writing"),
            serde_json::to_vec(&next).expect("serialize next"),
        )
        .expect("write staged next");
        recover_button_state(&before_commit).expect("recover pre-commit state");
        let recovered_previous =
            read_button_state_document(&before_commit).expect("read recovered previous state");
        assert_eq!(
            classify_source_transaction(&journal, Some(&recovered_previous))
                .expect("classify pre-commit cut"),
            SourceTransactionRecovery::RollBack
        );

        // Cut after the rename commit point but before source cleanup: the
        // canonical next state wins even while the old backup still exists.
        let after_commit = root.join("after/button-state.json");
        fs::create_dir_all(after_commit.parent().expect("after parent"))
            .expect("create after directory");
        fs::write(
            &after_commit,
            serde_json::to_vec(&next).expect("serialize canonical next"),
        )
        .expect("write canonical next");
        fs::write(
            after_commit.with_file_name(".button-state.json.3.backup"),
            serde_json::to_vec(&previous).expect("serialize previous backup"),
        )
        .expect("write stale previous backup");
        recover_button_state(&after_commit).expect("recover post-commit state");
        let recovered_next =
            read_button_state_document(&after_commit).expect("read recovered next state");
        assert_eq!(
            classify_source_transaction(&journal, Some(&recovered_next))
                .expect("classify post-commit cut"),
            SourceTransactionRecovery::Finalize
        );

        let divergent = json!({"schemaVersion": 1, "revision": 5, "different": true});
        assert!(classify_source_transaction(&journal, Some(&divergent)).is_err());
        let later = json!({"schemaVersion": 1, "revision": 6});
        assert_eq!(
            classify_source_transaction(&journal, Some(&later))
                .expect("classify later canonical state"),
            SourceTransactionRecovery::Finalize
        );

        let _ = fs::remove_dir_all(root);
    }
}
