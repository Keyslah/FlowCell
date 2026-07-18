use crate::*;

const SCRIPT_BINDING_KIND: &str = "script";
pub(crate) const TOOL_SET_OWNER_BINDING_KIND: &str = "tool-set-owner";
pub(crate) const TOOL_SET_CHILD_BINDING_KIND: &str = "tool-set-child";

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FrontendScriptBindingRecord {
    pub(crate) id: Option<u64>,
    pub(crate) binding_id: Option<u64>,
    pub(crate) kind: Option<String>,
    pub(crate) label: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) program_tab_id: Option<i64>,
    pub(crate) shortcut: String,
    pub(crate) target: String,
    pub(crate) owner_button_id: Option<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FrontendBindingsState {
    pub(crate) next_id: Option<u64>,
    pub(crate) script_bindings: Vec<FrontendScriptBindingRecord>,
    pub(crate) action_hotkeys: HashMap<String, String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BindableButtonRecord {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) kind: String,
    pub(crate) target: String,
    pub(crate) execution_target: Option<String>,
    pub(crate) binding_id: Option<u64>,
    pub(crate) shortcut: Option<String>,
    pub(crate) owner_button_id: Option<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BindablePanelRecord {
    pub(crate) name: String,
    pub(crate) buttons: Vec<BindableButtonRecord>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BindableProgramRecord {
    pub(crate) name: String,
    pub(crate) program_tab_id: i64,
    pub(crate) shortcut_profile_id: String,
    pub(crate) panels: Vec<BindablePanelRecord>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShortcutProfileEntry {
    pub(crate) shortcut: String,
    #[serde(default)]
    pub(crate) display: String,
    #[serde(default)]
    pub(crate) reason: String,
    #[serde(default)]
    pub(crate) source: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShortcutProfileFile {
    #[serde(default)]
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) display_name: String,
    #[serde(default)]
    pub(crate) platform: String,
    #[serde(default)]
    pub(crate) process_names: Vec<String>,
    #[serde(default)]
    pub(crate) blocked: Vec<ShortcutProfileEntry>,
    #[serde(default)]
    pub(crate) reserved: Vec<ShortcutProfileEntry>,
    #[serde(default)]
    pub(crate) preferred: Vec<String>,
    #[serde(default)]
    pub(crate) notes: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShortcutProfileDocumentRecord {
    pub(crate) file_name: String,
    pub(crate) profile_id: String,
    pub(crate) is_local_override: bool,
    pub(crate) profile: ShortcutProfileFile,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BindsWorkspaceResponse {
    pub(crate) programs: Vec<BindableProgramRecord>,
    pub(crate) macros: Vec<FrontendMacroSummaryRecord>,
    pub(crate) bindings: FrontendBindingsState,
    pub(crate) shortcut_profiles: Vec<ShortcutProfileDocumentRecord>,
    pub(crate) warnings: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveBindShortcutRequest {
    pub(crate) program_name: String,
    pub(crate) program_tab_id: i64,
    pub(crate) target: String,
    #[serde(default)]
    pub(crate) target_kind: Option<String>,
    #[serde(default)]
    pub(crate) owner_button_id: Option<String>,
    pub(crate) binding_id: Option<u64>,
    pub(crate) shortcut: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BindableButtonStateSnapshot {
    #[serde(default)]
    buttons: HashMap<String, BindableCanonicalButton>,
    #[serde(default)]
    popout_units: HashMap<String, BindableCanonicalPopoutUnit>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BindableCanonicalButton {
    #[serde(default)]
    id: String,
    #[serde(default)]
    role: String,
    #[serde(default)]
    label: String,
    #[serde(default)]
    tool_set_parent_id: Option<String>,
    #[serde(default)]
    source_identity: Option<BindableCanonicalSourceIdentity>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BindableCanonicalSourceIdentity {
    #[serde(default)]
    display_program_name: String,
    #[serde(default)]
    display_panel_name: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BindableCanonicalPopoutUnit {
    #[serde(default)]
    kind: String,
    #[serde(default)]
    owner_button_id: String,
    #[serde(default)]
    child_button_ids: Vec<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveBindShortcutResponse {
    pub(crate) message: String,
    pub(crate) bindings: FrontendBindingsState,
}

fn resolve_shortcut_profiles_config_root() -> Result<PathBuf, String> {
    Ok(resolve_flowcell_config_root()?.join("shortcut_profiles"))
}

fn resolve_shortcut_profiles_local_root() -> Result<PathBuf, String> {
    Ok(resolve_flowcell_local_root()?.join("shortcut_profiles"))
}

fn canonical_program_tab_id(program_name: &str) -> i64 {
    match infer_program_template_key(program_name, None) {
        "illustrator" => 1,
        "windows" => 2,
        "blender" => 3,
        "photoshop" => 4,
        _ => 0,
    }
}

fn resolve_program_tab_id(program_name: &str) -> i64 {
    let registered_id = resolve_bindings_file_path()
        .ok()
        .filter(|path| path.is_file())
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|contents| parse_ini_document(&contents))
        .and_then(|document| {
            find_registered_program(&document, program_name).map(|program| program.id)
        });
    registered_id.unwrap_or_else(|| canonical_program_tab_id(program_name))
}

fn resolve_shortcut_profile_id_from_file_name(file_name: &str) -> Option<String> {
    let normalized = file_name.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "windows.json" | "windows.user.json" => Some(String::from("windows")),
        "flowcell.json" | "flowcell.user.json" => Some(String::from("flowcell")),
        "adobe.photoshop.windows.json" | "photoshop.user.json" => {
            Some(String::from("adobe.photoshop.windows"))
        }
        "adobe.illustrator.windows.json" | "illustrator.user.json" => {
            Some(String::from("adobe.illustrator.windows"))
        }
        "blender.windows.json" | "blender.user.json" => Some(String::from("blender.windows")),
        _ => None,
    }
}

fn normalize_flowcell_path(raw_path: &str) -> String {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    trimmed.replace('/', "\\")
}

fn normalize_binding_target_for_compare(raw_path: &str) -> String {
    let resolved = normalize_flowcell_path(raw_path);
    let candidate = PathBuf::from(&resolved);
    if candidate.exists() {
        return normalize_path_for_compare(&candidate);
    }

    resolved.to_ascii_lowercase()
}

fn binding_matches_save_target(
    binding: &FrontendScriptBindingRecord,
    target_kind: &str,
    target: &str,
    owner_button_id: Option<&str>,
    program_tab_id: i64,
) -> bool {
    if is_tool_set_binding_kind(target_kind) {
        return binding.kind.as_deref() == Some(target_kind)
            && binding.target == target
            && binding.owner_button_id.as_deref() == owner_button_id;
    }

    !is_tool_set_binding(binding)
        && binding.program_tab_id.unwrap_or(0) == program_tab_id
        && normalize_binding_target_for_compare(&binding.target)
            == normalize_binding_target_for_compare(target)
}

fn normalize_binding_kind(raw_kind: Option<&str>) -> Result<&'static str, String> {
    let normalized = raw_kind.unwrap_or_default().trim().to_ascii_lowercase();
    match normalized.as_str() {
        "" | SCRIPT_BINDING_KIND => Ok(SCRIPT_BINDING_KIND),
        TOOL_SET_OWNER_BINDING_KIND => Ok(TOOL_SET_OWNER_BINDING_KIND),
        TOOL_SET_CHILD_BINDING_KIND => Ok(TOOL_SET_CHILD_BINDING_KIND),
        _ => Err(format!(
            "Unknown binding TargetKind '{}'.",
            raw_kind.unwrap_or_default().trim()
        )),
    }
}

pub(crate) fn is_tool_set_binding_kind(kind: &str) -> bool {
    kind == TOOL_SET_OWNER_BINDING_KIND || kind == TOOL_SET_CHILD_BINDING_KIND
}

pub(crate) fn is_tool_set_binding(binding: &FrontendScriptBindingRecord) -> bool {
    binding
        .kind
        .as_deref()
        .map(is_tool_set_binding_kind)
        .unwrap_or(false)
}

pub(crate) fn is_tool_set_owner_binding(binding: &FrontendScriptBindingRecord) -> bool {
    binding.kind.as_deref() == Some(TOOL_SET_OWNER_BINDING_KIND)
}

pub(crate) fn is_tool_set_child_binding(binding: &FrontendScriptBindingRecord) -> bool {
    binding.kind.as_deref() == Some(TOOL_SET_CHILD_BINDING_KIND)
}

fn find_script_binding_for_target(
    bindings: &FrontendBindingsState,
    program_tab_id: i64,
    target: &str,
) -> Option<(u64, String)> {
    let normalized_target = normalize_binding_target_for_compare(target);
    if normalized_target.is_empty() {
        return None;
    }

    bindings.script_bindings.iter().find_map(|binding| {
        if is_tool_set_binding(binding) {
            return None;
        }
        let binding_id = binding.id.or(binding.binding_id).unwrap_or(0);
        let binding_program_tab_id = binding.program_tab_id.unwrap_or(0);
        let same_target =
            normalize_binding_target_for_compare(&binding.target) == normalized_target;
        if same_target && (binding_program_tab_id == program_tab_id || program_tab_id == 0) {
            return Some((binding_id, binding.shortcut.clone()));
        }
        None
    })
}

fn find_tool_set_button_binding(
    bindings: &FrontendBindingsState,
    target_kind: &str,
    button_id: &str,
) -> Option<(u64, String)> {
    bindings.script_bindings.iter().find_map(|binding| {
        if binding.kind.as_deref() != Some(target_kind) || binding.target != button_id {
            return None;
        }
        Some((
            binding.id.or(binding.binding_id).unwrap_or(0),
            binding.shortcut.clone(),
        ))
    })
}

fn parse_bindable_button_state(
    document: Option<&Value>,
) -> Result<Option<BindableButtonStateSnapshot>, String> {
    document
        .map(|value| {
            serde_json::from_value::<BindableButtonStateSnapshot>(value.clone())
                .map_err(|error| format!("Canonical Button state cannot populate Binds: {error}"))
        })
        .transpose()
}

fn canonical_tool_set_owner<'a>(
    state: &'a BindableButtonStateSnapshot,
    owner_button_id: &str,
    program_name: &str,
    panel_name: Option<&str>,
) -> Result<&'a BindableCanonicalButton, String> {
    let owner = state.buttons.get(owner_button_id).ok_or_else(|| {
        format!("Tool-set owner Button '{owner_button_id}' is missing from canonical state.")
    })?;
    if owner.id != owner_button_id || owner.role != "tool-set-owner" {
        return Err(format!(
            "Button '{owner_button_id}' is not the expected canonical tool-set owner."
        ));
    }
    let identity = owner.source_identity.as_ref().ok_or_else(|| {
        format!("Tool-set owner Button '{owner_button_id}' has no canonical source identity.")
    })?;
    let program_matches = identity
        .display_program_name
        .trim()
        .eq_ignore_ascii_case(program_name.trim());
    let panel_matches = panel_name
        .map(|panel| {
            identity
                .display_panel_name
                .trim()
                .eq_ignore_ascii_case(panel.trim())
        })
        .unwrap_or(true);
    if !program_matches || !panel_matches {
        return Err(format!(
            "Tool-set owner Button '{owner_button_id}' does not belong to {program_name}{}.",
            panel_name
                .map(|panel| format!(" / {panel}"))
                .unwrap_or_default()
        ));
    }
    Ok(owner)
}

fn canonical_tool_set_unit<'a>(
    state: &'a BindableButtonStateSnapshot,
    owner_button_id: &str,
) -> Result<&'a BindableCanonicalPopoutUnit, String> {
    let matches = state
        .popout_units
        .values()
        .filter(|unit| unit.kind == "tool-set" && unit.owner_button_id == owner_button_id)
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err(format!(
            "Tool-set owner Button '{owner_button_id}' must own exactly one canonical tool-set popout; found {}.",
            matches.len()
        ));
    }
    Ok(matches[0])
}

fn validate_canonical_tool_set_child(
    state: &BindableButtonStateSnapshot,
    program_name: &str,
    owner_button_id: &str,
    button_id: &str,
) -> Result<(), String> {
    canonical_tool_set_owner(state, owner_button_id, program_name, None)?;
    let unit = canonical_tool_set_unit(state, owner_button_id)?;
    if !unit.child_button_ids.iter().any(|id| id == button_id) {
        return Err(format!(
            "Button '{button_id}' is not an active child of tool-set owner '{owner_button_id}'."
        ));
    }
    let child = state.buttons.get(button_id).ok_or_else(|| {
        format!("Tool-set child Button '{button_id}' is missing from canonical state.")
    })?;
    if child.id != button_id
        || child.role != "tool-set-child"
        || child.tool_set_parent_id.as_deref() != Some(owner_button_id)
    {
        return Err(format!(
            "Button '{button_id}' is not a valid canonical child of '{owner_button_id}'."
        ));
    }
    Ok(())
}

fn validate_canonical_tool_set_owner(
    state: &BindableButtonStateSnapshot,
    program_name: &str,
    owner_button_id: &str,
) -> Result<(), String> {
    canonical_tool_set_owner(state, owner_button_id, program_name, None)?;
    canonical_tool_set_unit(state, owner_button_id)?;
    Ok(())
}

fn list_bindable_tool_set_children(
    state: &BindableButtonStateSnapshot,
    program_name: &str,
    panel_name: &str,
    owner_button_id: &str,
    bindings: &FrontendBindingsState,
) -> Result<Vec<BindableButtonRecord>, String> {
    let owner = canonical_tool_set_owner(state, owner_button_id, program_name, Some(panel_name))?;
    let unit = canonical_tool_set_unit(state, owner_button_id)?;
    let mut buttons = Vec::with_capacity(unit.child_button_ids.len());
    for button_id in &unit.child_button_ids {
        let child = state.buttons.get(button_id).ok_or_else(|| {
            format!("Tool-set child Button '{button_id}' is missing from canonical state.")
        })?;
        if child.id != *button_id
            || child.role != "tool-set-child"
            || child.tool_set_parent_id.as_deref() != Some(owner_button_id)
        {
            return Err(format!(
                "Button '{button_id}' is not a valid canonical child of '{owner_button_id}'."
            ));
        }
        let binding =
            find_tool_set_button_binding(bindings, TOOL_SET_CHILD_BINDING_KIND, button_id);
        buttons.push(BindableButtonRecord {
            id: button_id.clone(),
            label: format!("{} › {}", owner.label, child.label),
            kind: TOOL_SET_CHILD_BINDING_KIND.to_string(),
            target: button_id.clone(),
            execution_target: None,
            binding_id: binding.as_ref().map(|(binding_id, _)| *binding_id),
            shortcut: binding.map(|(_, shortcut)| shortcut),
            owner_button_id: Some(owner_button_id.to_string()),
        });
    }
    Ok(buttons)
}

fn list_bindable_buttons_for_panel(
    program_name: &str,
    panel_name: &str,
    bindings: &FrontendBindingsState,
    button_state: Option<&BindableButtonStateSnapshot>,
) -> Result<Vec<BindableButtonRecord>, String> {
    let program_tab_id = resolve_program_tab_id(program_name);
    let records = program_sources::execute::list_active_source_records(program_name, panel_name)?;
    let mut buttons = Vec::new();
    for resolution in records {
        let is_tool_set = resolution
            .record
            .kind
            .trim()
            .eq_ignore_ascii_case("tool-set");
        if is_tool_set {
            let state = button_state.ok_or_else(|| {
                format!(
                    "Tool-set owner Button '{}' has no canonical Button state.",
                    resolution.record.owner_button_id
                )
            })?;
            validate_canonical_tool_set_owner(
                state,
                program_name,
                &resolution.record.owner_button_id,
            )?;
            let owner_binding = find_tool_set_button_binding(
                bindings,
                TOOL_SET_OWNER_BINDING_KIND,
                &resolution.record.owner_button_id,
            );
            buttons.push(BindableButtonRecord {
                // Keep the presentation ID stable so existing Main-page Binds
                // prefill events still select this source record. The typed
                // binding target is the canonical owner Button ID below.
                id: format!("{program_name}::{panel_name}::{}", resolution.file_name),
                label: resolution.record.label.clone(),
                kind: TOOL_SET_OWNER_BINDING_KIND.to_string(),
                target: resolution.record.owner_button_id.clone(),
                execution_target: None,
                binding_id: owner_binding.as_ref().map(|(binding_id, _)| *binding_id),
                shortcut: owner_binding.map(|(_, shortcut)| shortcut),
                owner_button_id: Some(resolution.record.owner_button_id.clone()),
            });
            buttons.extend(list_bindable_tool_set_children(
                state,
                program_name,
                panel_name,
                &resolution.record.owner_button_id,
                bindings,
            )?);
        } else {
            let target = resolution.record.source_path.clone();
            let binding = find_script_binding_for_target(bindings, program_tab_id, &target);
            buttons.push(BindableButtonRecord {
                id: format!("{program_name}::{panel_name}::{}", resolution.file_name),
                label: resolution.record.label.clone(),
                kind: resolution.record.kind,
                target,
                execution_target: None,
                binding_id: binding.as_ref().map(|(binding_id, _)| *binding_id),
                shortcut: binding.map(|(_, shortcut)| shortcut),
                owner_button_id: None,
            });
        }
    }
    buttons.sort_by_cached_key(|button| button.label.to_ascii_lowercase());
    Ok(buttons)
}

fn read_shortcut_profile_documents(
) -> Result<(Vec<ShortcutProfileDocumentRecord>, Vec<String>), String> {
    let mut documents = Vec::new();
    let mut warnings = Vec::new();
    let roots = vec![
        (resolve_shortcut_profiles_config_root()?, false),
        (resolve_shortcut_profiles_local_root()?, true),
    ];

    for (root, is_local_override) in roots {
        if !root.is_dir() {
            continue;
        }

        let mut entries = fs::read_dir(&root)
            .map_err(|error| format!("Failed to read {}: {error}", root.display()))?
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_file())
            .collect::<Vec<_>>();
        entries
            .sort_by_cached_key(|entry| entry.file_name().to_string_lossy().to_ascii_lowercase());

        for entry in entries {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if !file_name.to_ascii_lowercase().ends_with(".json") {
                continue;
            }

            let path = entry.path();
            let raw_contents = match fs::read_to_string(&path) {
                Ok(contents) => contents,
                Err(error) => {
                    warnings.push(format!(
                        "Shortcut profile {} could not be read: {error}",
                        file_name
                    ));
                    continue;
                }
            };

            let mut profile = match serde_json::from_str::<ShortcutProfileFile>(&raw_contents) {
                Ok(profile) => profile,
                Err(error) => {
                    warnings.push(format!(
                        "Shortcut profile {} is malformed: {error}",
                        file_name
                    ));
                    continue;
                }
            };

            let inferred_profile_id =
                resolve_shortcut_profile_id_from_file_name(&file_name).unwrap_or_default();
            let profile_id = if profile.id.trim().is_empty() {
                inferred_profile_id
            } else {
                profile.id.trim().to_string()
            };
            if profile_id.trim().is_empty() {
                warnings.push(format!(
                    "Shortcut profile {} is missing a profile id and was ignored.",
                    file_name
                ));
                continue;
            }

            profile.id = profile_id.clone();
            documents.push(ShortcutProfileDocumentRecord {
                file_name,
                profile_id,
                is_local_override,
                profile,
            });
        }
    }

    Ok((documents, warnings))
}

pub(crate) type IniDocument = HashMap<String, HashMap<String, String>>;

static BINDINGS_STATE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub(crate) fn bindings_state_guard() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    BINDINGS_STATE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "FlowCell bindings lock is poisoned.".to_string())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RegisteredProgram {
    pub(crate) id: i64,
    pub(crate) label: String,
}

fn parse_program_tab_section_id(section_name: &str) -> Option<i64> {
    section_name
        .strip_prefix("ProgramTab_")?
        .parse::<i64>()
        .ok()
        .filter(|id| *id > 0)
}

fn registered_programs_from_document(document: &IniDocument) -> Vec<RegisteredProgram> {
    let mut programs = document
        .iter()
        .filter_map(|(section_name, section)| {
            let id = parse_program_tab_section_id(section_name)?;
            let label = section.get("Label")?.trim();
            if label.is_empty() {
                return None;
            }
            Some(RegisteredProgram {
                id,
                label: label.to_string(),
            })
        })
        .collect::<Vec<_>>();
    programs.sort_by_key(|program| program.id);
    programs
}

pub(crate) fn find_registered_program(
    document: &IniDocument,
    program_name: &str,
) -> Option<RegisteredProgram> {
    registered_programs_from_document(document)
        .into_iter()
        .find(|program| program.label.eq_ignore_ascii_case(program_name.trim()))
}

pub(crate) fn registered_program_folder_names(
    available_folder_names: &[String],
    document: &IniDocument,
) -> Vec<String> {
    registered_programs_from_document(document)
        .into_iter()
        .filter_map(|program| {
            available_folder_names
                .iter()
                .find(|folder_name| {
                    !folder_name.to_ascii_lowercase().starts_with("flowcell-")
                        && folder_name.eq_ignore_ascii_case(&program.label)
                })
                .cloned()
        })
        .collect()
}

pub(crate) fn sync_program_registration_meta(
    document: &mut IniDocument,
    selected_program_id: Option<i64>,
) {
    let program_ids = registered_programs_from_document(document)
        .into_iter()
        .map(|program| program.id)
        .collect::<Vec<_>>();
    let next_id = program_ids.iter().copied().max().unwrap_or(0) + 1;
    let meta = document.entry(String::from("Meta")).or_default();
    meta.insert(
        String::from("ProgramTabIds"),
        program_ids
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("|"),
    );
    meta.insert(String::from("ProgramTabNextId"), next_id.max(1).to_string());
    let existing_selected_id = meta
        .get("SelectedProgramTabId")
        .and_then(|value| value.parse::<i64>().ok());
    let effective_selected_id = selected_program_id
        .filter(|program_id| program_ids.contains(program_id))
        .or_else(|| existing_selected_id.filter(|program_id| program_ids.contains(program_id)))
        .or_else(|| program_ids.first().copied())
        .unwrap_or(0);
    meta.insert(
        String::from("SelectedProgramTabId"),
        effective_selected_id.to_string(),
    );
}

fn program_registration_id(document: &IniDocument, program_name: &str) -> i64 {
    if let Some(program) = find_registered_program(document, program_name) {
        return program.id;
    }

    let used_ids = registered_programs_from_document(document)
        .into_iter()
        .map(|program| program.id)
        .collect::<HashSet<_>>();
    let preferred_id = canonical_program_tab_id(program_name);
    if preferred_id > 0 && !used_ids.contains(&preferred_id) {
        return preferred_id;
    }

    document
        .get("Meta")
        .and_then(|section| section.get("ProgramTabNextId"))
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or_else(|| used_ids.iter().copied().max().unwrap_or(0) + 1)
        .max(used_ids.iter().copied().max().unwrap_or(0) + 1)
        .max(1)
}

pub(crate) fn write_program_registration_section(
    document: &mut IniDocument,
    program_id: i64,
    program_name: &str,
    program_path: &Path,
    exe_path: &str,
) {
    let template_key = infer_program_template_key(program_name, Some(exe_path));
    let process_name = Path::new(exe_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let git_scripts_path = program_path.join(format!("{program_name} Git Scripts"));
    let script_folder = match template_key {
        "illustrator" | "photoshop" | "blender" | "windows" => git_scripts_path,
        _ => Path::new(exe_path)
            .parent()
            .unwrap_or(program_path)
            .to_path_buf(),
    };
    let (program_type, run_method, extensions, default_panels, process_names) = match template_key {
        "illustrator" => (
            "adobe_direct_script_runner",
            "illustrator_direct",
            ".jsx|.js",
            "Layers|Files|Utility",
            if process_name.is_empty() {
                String::from("illustrator")
            } else {
                process_name.clone()
            },
        ),
        "photoshop" => (
            "adobe_direct_script_runner",
            "photoshop_direct",
            ".jsx|.js",
            "Layers|Files|Utility",
            if process_name.is_empty() {
                String::from("photoshop")
            } else {
                process_name.clone()
            },
        ),
        "blender" => (
            "bridge_runner",
            "blender_bridge",
            ".ps1|.py|.blend|.exe|.lnk",
            "Collections|Files|Utility",
            if process_name.is_empty() {
                String::from("blender")
            } else {
                process_name.clone()
            },
        ),
        "windows" => (
            "generic",
            "generic",
            "",
            "Files|Utility",
            String::from("explorer|dopus|dopusrt"),
        ),
        _ => (
            "generic",
            "generic",
            "",
            "Files|Utility",
            process_name.clone(),
        ),
    };

    let mut section = HashMap::new();
    section.insert(String::from("Label"), program_name.trim().to_string());
    section.insert(
        String::from("NormalizedName"),
        program_name.trim().to_ascii_lowercase(),
    );
    section.insert(
        String::from("ScriptFolder"),
        script_folder.to_string_lossy().to_string(),
    );
    section.insert(String::from("ProgramType"), program_type.to_string());
    section.insert(String::from("ExePath"), exe_path.trim().to_string());
    section.insert(String::from("RunMethod"), run_method.to_string());
    section.insert(
        String::from("AllowedScriptExtensions"),
        extensions.to_string(),
    );
    section.insert(String::from("BridgeFolder"), String::new());
    section.insert(String::from("RequiresRestart"), String::from("0"));
    section.insert(String::from("DefaultPanels"), default_panels.to_string());
    section.insert(String::from("ProcessNames"), process_names);
    document.insert(format!("ProgramTab_{program_id}"), section);
}

pub(crate) fn upsert_program_registration(
    document: &mut IniDocument,
    program_name: &str,
    program_path: &Path,
    exe_path: &str,
) -> i64 {
    let program_id = program_registration_id(document, program_name);
    write_program_registration_section(document, program_id, program_name, program_path, exe_path);
    sync_program_registration_meta(document, Some(program_id));
    program_id
}

pub(crate) fn remove_program_registration(document: &mut IniDocument, program_name: &str) {
    let Some(program) = find_registered_program(document, program_name) else {
        return;
    };
    document.remove(&format!("ProgramTab_{}", program.id));

    let binding_sections = document
        .iter()
        .filter_map(|(section_name, section)| {
            if !section_name.starts_with("Binding_") {
                return None;
            }
            let program_tab_id = section
                .get("ProgramTabId")
                .and_then(|value| value.parse::<i64>().ok())
                .unwrap_or(0);
            (program_tab_id == program.id).then(|| section_name.clone())
        })
        .collect::<Vec<_>>();
    for section_name in binding_sections {
        document.remove(&section_name);
    }

    let mut remaining_binding_ids = document
        .keys()
        .filter_map(|section_name| section_name.strip_prefix("Binding_"))
        .filter_map(|value| value.parse::<u64>().ok())
        .collect::<Vec<_>>();
    remaining_binding_ids.sort_unstable();
    let meta = document.entry(String::from("Meta")).or_default();
    meta.insert(
        String::from("Ids"),
        remaining_binding_ids
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("|"),
    );
    sync_program_registration_meta(document, None);
}

#[cfg(test)]
mod program_registration_tests {
    use super::*;

    #[test]
    fn manifest_process_names_are_normalized_without_program_aliases() {
        let process_names = vec![
            String::from(" Explorer.EXE "),
            String::from("DOPUS"),
            String::from(r#"C:\Program Files\Directory Opus\dopusrt.exe"#),
            String::from("explorer"),
        ];

        assert_eq!(
            normalize_configured_process_names(&process_names),
            vec![
                String::from("dopus"),
                String::from("dopusrt"),
                String::from("explorer")
            ]
        );
    }

    #[test]
    fn payload_folder_is_hidden_until_program_is_registered() {
        let available = vec![String::from("Illustrator")];
        let mut document = IniDocument::new();
        assert!(registered_program_folder_names(&available, &document).is_empty());

        upsert_program_registration(
            &mut document,
            "Illustrator",
            Path::new(r"D:\FlowCell\Programs\Illustrator"),
            r"C:\Program Files\Adobe\Adobe Illustrator 2026\Support Files\Contents\Windows\Illustrator.exe",
        );
        assert_eq!(
            registered_program_folder_names(&available, &document),
            vec![String::from("Illustrator")]
        );
    }

    #[test]
    fn illustrator_registration_persists_selected_executable() {
        let mut document = IniDocument::new();
        let exe_path = r"C:\Program Files\Adobe\Adobe Illustrator 2026\Support Files\Contents\Windows\Illustrator.exe";
        let program_id = upsert_program_registration(
            &mut document,
            "Illustrator",
            Path::new(r"D:\FlowCell\Programs\Illustrator"),
            exe_path,
        );

        assert_eq!(program_id, 1);
        assert_eq!(
            document
                .get("ProgramTab_1")
                .and_then(|section| section.get("ExePath"))
                .map(String::as_str),
            Some(exe_path)
        );
        assert_eq!(
            document
                .get("Meta")
                .and_then(|section| section.get("ProgramTabIds"))
                .map(String::as_str),
            Some("1")
        );
    }

    #[test]
    fn blender_folder_prefers_blender_exe_over_launcher() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be after Unix epoch")
            .as_nanos();
        let folder = std::env::temp_dir().join(format!(
            "flowcell-program-exe-test-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&folder).expect("test folder should be created");
        fs::write(folder.join("blender-launcher.exe"), []).expect("launcher fixture should exist");
        fs::write(folder.join("blender.exe"), []).expect("Blender fixture should exist");

        let resolved = resolve_program_executable("Blender", &folder.to_string_lossy())
            .expect("Blender folder should resolve");
        assert_eq!(
            resolved.file_name().and_then(|value| value.to_str()),
            Some("blender.exe")
        );

        fs::remove_dir_all(&folder).expect("temporary test folder should be removed");
    }

    #[test]
    fn bindings_write_recovers_backup_then_commits_after_a_cut_between_renames() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be after Unix epoch")
            .as_nanos();
        let folder = std::env::temp_dir().join(format!(
            "flowcell-bindings-cut-test-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&folder).expect("create bindings test folder");
        let path = folder.join("bindings.ini");
        fs::write(folder.join(".bindings.ini.1.backup"), b"old-bindings")
            .expect("write old backup");
        fs::write(folder.join(".bindings.ini.2.writing"), b"staged-bindings")
            .expect("write staged value");

        write_bindings_bytes_atomic_unchecked(&path, b"new-bindings")
            .expect("recover and commit bindings");

        assert_eq!(fs::read(&path).expect("read bindings"), b"new-bindings");
        fs::remove_dir_all(&folder).expect("remove bindings test folder");
    }

    #[test]
    fn mixed_script_owner_and_child_bindings_round_trip_without_changing_script_shape() {
        let mut document = parse_ini_document(
            r#"
[Meta]
Ids=1|2|3
NextId=4

[Binding_1]
Shortcut=^!1
ScriptPath=D:\FlowCell\Programs\Blender\run.py
ProgramTabId=4

[Binding_2]
Shortcut=^!2
TargetKind=tool-set-owner
ButtonId=owner-rotate
OwnerButtonId=owner-rotate
ProgramTabId=4

[Binding_3]
Shortcut=^!3
TargetKind=tool-set-child
ButtonId=child-negative
OwnerButtonId=owner-rotate
ProgramTabId=4
"#,
        );
        let bindings = parse_frontend_bindings_state(&document).expect("parse mixed bindings");
        assert_eq!(bindings.script_bindings.len(), 3);
        let script = &bindings.script_bindings[0];
        assert_eq!(script.kind.as_deref(), Some(SCRIPT_BINDING_KIND));
        assert_eq!(script.target, r"D:\FlowCell\Programs\Blender\run.py");
        assert_eq!(script.owner_button_id, None);
        let owner = &bindings.script_bindings[1];
        assert_eq!(owner.kind.as_deref(), Some(TOOL_SET_OWNER_BINDING_KIND));
        assert_eq!(owner.target, "owner-rotate");
        assert_eq!(owner.owner_button_id.as_deref(), Some("owner-rotate"));
        let child = &bindings.script_bindings[2];
        assert_eq!(child.kind.as_deref(), Some(TOOL_SET_CHILD_BINDING_KIND));
        assert_eq!(child.target, "child-negative");
        assert_eq!(child.owner_button_id.as_deref(), Some("owner-rotate"));

        rewrite_binding_sections(&mut document, &bindings.script_bindings)
            .expect("rewrite mixed bindings");
        let script_section = document.get("Binding_1").expect("script section");
        assert_eq!(
            script_section.get("ScriptPath").map(String::as_str),
            Some(r"D:\FlowCell\Programs\Blender\run.py")
        );
        assert!(!script_section.contains_key("TargetKind"));
        assert!(!script_section.contains_key("ButtonId"));
        let owner_section = document.get("Binding_2").expect("owner section");
        assert_eq!(
            owner_section.get("TargetKind").map(String::as_str),
            Some(TOOL_SET_OWNER_BINDING_KIND)
        );
        assert_eq!(
            owner_section.get("ButtonId").map(String::as_str),
            Some("owner-rotate")
        );
        assert_eq!(
            owner_section.get("OwnerButtonId").map(String::as_str),
            Some("owner-rotate")
        );
        assert!(!owner_section.contains_key("ScriptPath"));
        let child_section = document.get("Binding_3").expect("child section");
        assert_eq!(
            child_section.get("TargetKind").map(String::as_str),
            Some(TOOL_SET_CHILD_BINDING_KIND)
        );
        assert_eq!(
            child_section.get("ButtonId").map(String::as_str),
            Some("child-negative")
        );
        assert_eq!(
            child_section.get("OwnerButtonId").map(String::as_str),
            Some("owner-rotate")
        );
        assert!(!child_section.contains_key("ScriptPath"));
        assert_eq!(
            parse_frontend_bindings_state(&document)
                .expect("reparse mixed bindings")
                .script_bindings
                .len(),
            3
        );
    }

    #[test]
    fn typed_binding_parser_rejects_unknown_or_incomplete_target_kinds() {
        let unknown = parse_ini_document(
            r#"
[Meta]
Ids=1
[Binding_1]
Shortcut=^!1
TargetKind=other
ButtonId=child
OwnerButtonId=owner
ProgramTabId=1
"#,
        );
        assert!(parse_frontend_bindings_state(&unknown)
            .err()
            .expect("unknown kind must fail")
            .contains("Unknown binding TargetKind"));

        let incomplete = parse_ini_document(
            r#"
[Meta]
Ids=1
[Binding_1]
Shortcut=^!1
TargetKind=tool-set-child
ButtonId=child
ProgramTabId=1
"#,
        );
        assert!(parse_frontend_bindings_state(&incomplete)
            .err()
            .expect("missing owner must fail")
            .contains("OwnerButtonId"));

        let mismatched_owner = parse_ini_document(
            r#"
[Meta]
Ids=1
[Binding_1]
Shortcut=^!1
TargetKind=tool-set-owner
ButtonId=owner-one
OwnerButtonId=owner-two
ProgramTabId=1
"#,
        );
        assert!(parse_frontend_bindings_state(&mismatched_owner)
            .err()
            .expect("mismatched owner IDs must fail")
            .contains("same ButtonId and OwnerButtonId"));
    }

    #[test]
    fn canonical_tool_set_inventory_uses_child_ids_and_hierarchical_labels() {
        let value = serde_json::json!({
            "buttons": {
                "owner-rotate": {
                    "id": "owner-rotate",
                    "role": "tool-set-owner",
                    "label": "Rotate",
                    "sourceIdentity": {
                        "displayProgramName": "Blender",
                        "displayPanelName": "Toolset"
                    }
                },
                "child-negative": {
                    "id": "child-negative",
                    "role": "tool-set-child",
                    "label": "Negative",
                    "toolSetParentId": "owner-rotate"
                }
            },
            "popoutUnits": {
                "rotate": {
                    "kind": "tool-set",
                    "ownerButtonId": "owner-rotate",
                    "childButtonIds": ["child-negative"]
                }
            }
        });
        let state = parse_bindable_button_state(Some(&value))
            .expect("parse canonical state")
            .expect("canonical state exists");
        let bindings = FrontendBindingsState {
            next_id: Some(2),
            script_bindings: vec![FrontendScriptBindingRecord {
                id: Some(1),
                binding_id: Some(1),
                kind: Some(TOOL_SET_CHILD_BINDING_KIND.to_string()),
                label: None,
                status: None,
                program_tab_id: Some(4),
                shortcut: "^!2".to_string(),
                target: "child-negative".to_string(),
                owner_button_id: Some("owner-rotate".to_string()),
            }],
            action_hotkeys: HashMap::new(),
        };
        let children = list_bindable_tool_set_children(
            &state,
            "Blender",
            "Toolset",
            "owner-rotate",
            &bindings,
        )
        .expect("list canonical children");
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].id, "child-negative");
        assert_eq!(children[0].target, "child-negative");
        assert_eq!(children[0].label, "Rotate › Negative");
        assert_eq!(children[0].shortcut.as_deref(), Some("^!2"));
        assert_eq!(children[0].owner_button_id.as_deref(), Some("owner-rotate"));
        validate_canonical_tool_set_child(&state, "Blender", "owner-rotate", "child-negative")
            .expect("validate canonical child");
        validate_canonical_tool_set_owner(&state, "Blender", "owner-rotate")
            .expect("validate canonical owner");

        let owner_binding = FrontendScriptBindingRecord {
            id: Some(2),
            binding_id: Some(2),
            kind: Some(TOOL_SET_OWNER_BINDING_KIND.to_string()),
            label: None,
            status: None,
            program_tab_id: Some(4),
            shortcut: "^!1".to_string(),
            target: "owner-rotate".to_string(),
            owner_button_id: Some("owner-rotate".to_string()),
        };
        assert!(binding_matches_save_target(
            &owner_binding,
            TOOL_SET_OWNER_BINDING_KIND,
            "owner-rotate",
            Some("owner-rotate"),
            4,
        ));
        assert!(!binding_matches_save_target(
            &owner_binding,
            TOOL_SET_CHILD_BINDING_KIND,
            "owner-rotate",
            Some("owner-rotate"),
            4,
        ));

        let child_binding = &bindings.script_bindings[0];
        assert!(binding_matches_save_target(
            child_binding,
            TOOL_SET_CHILD_BINDING_KIND,
            "child-negative",
            Some("owner-rotate"),
            4,
        ));
        assert!(!binding_matches_save_target(
            child_binding,
            TOOL_SET_CHILD_BINDING_KIND,
            "child-negative",
            Some("different-owner"),
            4,
        ));
        assert!(!binding_matches_save_target(
            child_binding,
            SCRIPT_BINDING_KIND,
            "child-negative",
            None,
            4,
        ));
    }
}

pub(crate) fn parse_ini_document(contents: &str) -> IniDocument {
    let mut document = IniDocument::new();
    let mut current_section = String::new();
    let contents = contents.strip_prefix('\u{feff}').unwrap_or(contents);

    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('#') {
            continue;
        }

        if trimmed.starts_with('[') && trimmed.ends_with(']') && trimmed.len() >= 2 {
            current_section = trimmed[1..trimmed.len() - 1].trim().to_string();
            document.entry(current_section.clone()).or_default();
            continue;
        }

        let Some((key, value)) = trimmed.split_once('=') else {
            continue;
        };
        document
            .entry(current_section.clone())
            .or_default()
            .insert(key.trim().to_string(), value.trim().to_string());
    }

    document
}

fn section_sort_rank(section: &str) -> (u8, String) {
    if section.eq_ignore_ascii_case("Meta") {
        return (0, String::from("meta"));
    }
    if section.eq_ignore_ascii_case("ActionHotkeys") {
        return (1, String::from("actionhotkeys"));
    }
    if section.starts_with("ProgramTab_") {
        return (2, section.to_ascii_lowercase());
    }
    if section.starts_with("Binding_") {
        return (3, section.to_ascii_lowercase());
    }

    (4, section.to_ascii_lowercase())
}

pub(crate) fn serialize_ini_document(document: &IniDocument) -> String {
    let mut sections = document.keys().cloned().collect::<Vec<_>>();
    sections.sort_by(|left, right| {
        let left_key = section_sort_rank(left);
        let right_key = section_sort_rank(right);
        left_key.cmp(&right_key)
    });

    let mut blocks = Vec::new();
    for section in sections {
        let mut lines = Vec::new();
        if !section.is_empty() {
            lines.push(format!("[{section}]"));
        }

        let mut keys = document
            .get(&section)
            .map(|entries| entries.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        keys.sort_by(|left, right| left.to_ascii_lowercase().cmp(&right.to_ascii_lowercase()));
        for key in keys {
            if let Some(value) = document.get(&section).and_then(|entries| entries.get(&key)) {
                lines.push(format!("{key}={value}"));
            }
        }

        if !lines.is_empty() {
            blocks.push(lines.join("\r\n"));
        }
    }

    if blocks.is_empty() {
        String::new()
    } else {
        format!("{}\r\n", blocks.join("\r\n\r\n"))
    }
}

pub(crate) fn resolve_bindings_file_path() -> Result<PathBuf, String> {
    Ok(resolve_flowcell_local_root()?.join("bindings.ini"))
}

fn parse_frontend_bindings_state(document: &IniDocument) -> Result<FrontendBindingsState, String> {
    let mut next_id = document
        .get("Meta")
        .and_then(|section| section.get("NextId"))
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(1)
        .max(1);
    let id_tokens = document
        .get("Meta")
        .and_then(|section| section.get("Ids"))
        .cloned()
        .unwrap_or_default();
    let mut script_bindings = Vec::new();
    for token in id_tokens.split('|') {
        let trimmed = token.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(binding_id) = trimmed.parse::<u64>() else {
            continue;
        };
        let section_name = format!("Binding_{binding_id}");
        let Some(section) = document.get(&section_name) else {
            continue;
        };
        let kind = normalize_binding_kind(section.get("TargetKind").map(String::as_str))
            .map_err(|error| format!("{error} Section [{section_name}] is invalid."))?;
        let shortcut = section
            .get("Shortcut")
            .cloned()
            .unwrap_or_default()
            .trim()
            .to_string();
        let program_tab_id = section
            .get("ProgramTabId")
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0);
        let (target, owner_button_id) = if is_tool_set_binding_kind(kind) {
            if shortcut.is_empty() {
                return Err(format!(
                    "Typed Button binding [{section_name}] is missing Shortcut."
                ));
            }
            if section
                .get("ScriptPath")
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false)
            {
                return Err(format!(
                    "Typed Button binding [{section_name}] must not contain ScriptPath."
                ));
            }
            let button_id = section
                .get("ButtonId")
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    format!("Typed Button binding [{section_name}] is missing ButtonId.")
                })?;
            let owner_button_id = section
                .get("OwnerButtonId")
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    format!("Typed Button binding [{section_name}] is missing OwnerButtonId.")
                })?;
            if kind == TOOL_SET_OWNER_BINDING_KIND && button_id != owner_button_id {
                return Err(format!(
                    "Typed owner binding [{section_name}] must use the same ButtonId and OwnerButtonId."
                ));
            }
            if program_tab_id <= 0 {
                return Err(format!(
                    "Typed Button binding [{section_name}] is missing a valid ProgramTabId."
                ));
            }
            (button_id.to_string(), Some(owner_button_id.to_string()))
        } else {
            let target = normalize_flowcell_path(
                section
                    .get("ScriptPath")
                    .map(String::as_str)
                    .unwrap_or_default(),
            );
            if shortcut.is_empty() || target.is_empty() {
                continue;
            }
            (target, None)
        };
        next_id = next_id.max(binding_id + 1);
        script_bindings.push(FrontendScriptBindingRecord {
            id: Some(binding_id),
            binding_id: Some(binding_id),
            kind: Some(kind.to_string()),
            label: None,
            status: Some(String::from("Loaded")),
            program_tab_id: Some(program_tab_id),
            shortcut,
            target,
            owner_button_id,
        });
    }

    let mut action_hotkeys = HashMap::new();
    if let Some(section) = document.get("ActionHotkeys") {
        for (action_id, shortcut) in section {
            let trimmed_shortcut = shortcut.trim();
            if trimmed_shortcut.is_empty() {
                continue;
            }
            action_hotkeys.insert(action_id.clone(), trimmed_shortcut.to_string());
        }
    }

    Ok(FrontendBindingsState {
        next_id: Some(next_id),
        script_bindings,
        action_hotkeys,
    })
}

pub(crate) fn read_bindings_file_state(
) -> Result<(FrontendBindingsState, IniDocument, PathBuf), String> {
    let bindings_path = resolve_bindings_file_path()?;
    crate::program_sources::transaction::recover_json_file(&bindings_path, |candidate| {
        fs::read_to_string(candidate)
            .map(|_| ())
            .map_err(|error| format!("Failed to read {}: {error}", candidate.display()))
    })?;
    let raw_contents = if bindings_path.is_file() {
        fs::read_to_string(&bindings_path).map_err(|error| {
            format!(
                "Failed to read FlowCell bindings at {}: {error}",
                bindings_path.display()
            )
        })?
    } else {
        String::new()
    };
    let document = parse_ini_document(&raw_contents);

    let bindings = parse_frontend_bindings_state(&document)?;
    Ok((bindings, document, bindings_path))
}

pub(crate) fn serialize_bindings_file_state(document: &IniDocument) -> Vec<u8> {
    serialize_ini_document(document).into_bytes()
}

pub(crate) fn write_bindings_bytes_atomic_unchecked(
    path: &Path,
    contents: &[u8],
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create bindings folder at {}: {error}",
                parent.display()
            )
        })?;
    }

    crate::program_sources::transaction::write_file_atomically(
        path,
        contents,
        crate::program_sources::transaction::AtomicWriteMode::Replace,
        |candidate| {
            fs::read(candidate)
                .map(|_| ())
                .map_err(|error| format!("Failed to read {}: {error}", candidate.display()))
        },
    )
}

pub(crate) fn write_bindings_bytes_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    if super::program_rename::has_pending_program_rename_transaction()? {
        return Err(
            "FlowCell bindings are locked by a pending program rename transaction.".to_string(),
        );
    }
    write_bindings_bytes_atomic_unchecked(path, contents)
}

pub(crate) fn write_bindings_file_state(path: &Path, document: &IniDocument) -> Result<(), String> {
    write_bindings_bytes_atomic(path, &serialize_bindings_file_state(document))
}

fn rewrite_binding_sections(
    document: &mut IniDocument,
    bindings: &[FrontendScriptBindingRecord],
) -> Result<(), String> {
    let existing_binding_sections = document
        .keys()
        .filter(|section| section.starts_with("Binding_"))
        .cloned()
        .collect::<Vec<_>>();
    for section in existing_binding_sections {
        document.remove(&section);
    }

    for binding in bindings {
        let binding_id = binding.id.or(binding.binding_id).unwrap_or(0);
        if binding_id == 0 || binding.shortcut.trim().is_empty() || binding.target.trim().is_empty()
        {
            continue;
        }
        let kind = normalize_binding_kind(binding.kind.as_deref())?;
        let section_name = format!("Binding_{binding_id}");
        let section = document.entry(section_name.clone()).or_default();
        section.insert(
            String::from("Shortcut"),
            binding.shortcut.trim().to_string(),
        );
        if is_tool_set_binding_kind(kind) {
            let owner_button_id = binding
                .owner_button_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    format!("Typed Button binding [{section_name}] is missing OwnerButtonId.")
                })?;
            if kind == TOOL_SET_OWNER_BINDING_KIND && binding.target.trim() != owner_button_id {
                return Err(format!(
                    "Typed owner binding [{section_name}] must use the same ButtonId and OwnerButtonId."
                ));
            }
            if binding.program_tab_id.unwrap_or(0) <= 0 {
                return Err(format!(
                    "Typed Button binding [{section_name}] is missing a valid ProgramTabId."
                ));
            }
            section.insert(String::from("TargetKind"), kind.to_string());
            section.insert(String::from("ButtonId"), binding.target.trim().to_string());
            section.insert(String::from("OwnerButtonId"), owner_button_id.to_string());
        } else {
            section.insert(
                String::from("ScriptPath"),
                binding.target.trim().to_string(),
            );
        }
        if binding.program_tab_id.unwrap_or(0) > 0 {
            section.insert(
                String::from("ProgramTabId"),
                binding.program_tab_id.unwrap_or(0).to_string(),
            );
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn load_binds_workspace() -> Result<BindsWorkspaceResponse, String> {
    let (bindings, _document, _bindings_path) = read_bindings_file_state()?;
    let button_state_document = crate::button_state::load_button_state()?;
    let button_state = parse_bindable_button_state(button_state_document.as_ref())?;
    let (shortcut_profiles, warnings) = read_shortcut_profile_documents()?;
    let program_names = list_program_folders()?;
    let mut programs = Vec::new();

    for program_name in program_names {
        let manifest = program_sources::manifest::load_program_manifest(&program_name)?;
        let panel_names = list_panel_folders(program_name.clone())?;
        let mut panels = Vec::new();
        for panel_name in panel_names {
            panels.push(BindablePanelRecord {
                name: panel_name.clone(),
                buttons: list_bindable_buttons_for_panel(
                    &program_name,
                    &panel_name,
                    &bindings,
                    button_state.as_ref(),
                )?,
            });
        }
        programs.push(BindableProgramRecord {
            name: program_name.clone(),
            program_tab_id: resolve_program_tab_id(&program_name),
            shortcut_profile_id: manifest.shortcut_profile_id,
            panels,
        });
    }

    Ok(BindsWorkspaceResponse {
        programs,
        macros: list_frontend_macro_summaries(None, None)?,
        bindings,
        shortcut_profiles,
        warnings,
    })
}

#[tauri::command]
pub(crate) fn save_bind_shortcut(
    app: AppHandle,
    request: SaveBindShortcutRequest,
) -> Result<SaveBindShortcutResponse, String> {
    let program_name = request.program_name.trim();
    if program_name.is_empty() {
        return Err("Pick a program and panel.".to_string());
    }
    resolve_program_directory(program_name)?;

    let target_kind = normalize_binding_kind(request.target_kind.as_deref())?;
    let target = if is_tool_set_binding_kind(target_kind) {
        request.target.trim().to_string()
    } else {
        normalize_flowcell_path(&request.target)
    };
    if target.trim().is_empty() {
        return Err("No buttons in this panel.".to_string());
    }
    let owner_button_id = if is_tool_set_binding_kind(target_kind) {
        let owner_button_id = request
            .owner_button_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Tool-set Button binding is missing ownerButtonId.".to_string())?;
        let owner_button_id = program_sources::validate_owner_button_id(owner_button_id)?;
        let state_document = crate::button_state::load_button_state()?;
        let state = parse_bindable_button_state(state_document.as_ref())?
            .ok_or_else(|| "Canonical Button state is unavailable.".to_string())?;
        if target_kind == TOOL_SET_OWNER_BINDING_KIND {
            if target != owner_button_id {
                return Err(
                    "Tool-set owner binding must target its canonical owner Button ID.".to_string(),
                );
            }
            validate_canonical_tool_set_owner(&state, program_name, &owner_button_id)?;
        } else {
            validate_canonical_tool_set_child(&state, program_name, &owner_button_id, &target)?;
        }
        Some(owner_button_id)
    } else {
        let target_path = PathBuf::from(&target);
        if !target_path.is_file() {
            return Err(format!(
                "Binding target was not found at {}.",
                target_path.display()
            ));
        }
        None
    };
    if is_tool_set_binding_kind(target_kind) && !request.shortcut.trim().is_empty() {
        super::button_hotkeys::validate_tool_set_shortcut(request.shortcut.trim())
            .map_err(|error| format!("That Tool Set shortcut is not supported: {error}"))?;
    }

    let _bindings_guard = bindings_state_guard()?;
    let (bindings, mut document, bindings_path) = read_bindings_file_state()?;
    let previous_bindings_bytes = serialize_bindings_file_state(&document);
    let mut script_bindings = bindings.script_bindings.clone();
    let normalized_shortcut = request.shortcut.trim().to_ascii_lowercase();
    let keyboard_shortcut_conflict_key =
        super::button_hotkeys::keyboard_shortcut_conflict_key(request.shortcut.trim());
    let requested_binding_id = request.binding_id.unwrap_or(0);
    let effective_program_tab_id = if request.program_tab_id > 0 {
        request.program_tab_id
    } else {
        resolve_program_tab_id(program_name)
    };
    let binding_index = if requested_binding_id > 0 {
        let index = script_bindings
            .iter()
            .position(|binding| {
                binding.id.or(binding.binding_id).unwrap_or(0) == requested_binding_id
            })
            .ok_or_else(|| {
                "The selected binding changed; reload Binds before saving.".to_string()
            })?;
        if !binding_matches_save_target(
            &script_bindings[index],
            target_kind,
            &target,
            owner_button_id.as_deref(),
            effective_program_tab_id,
        ) {
            return Err(
                "The selected binding no longer matches this Button; reload Binds before saving."
                    .to_string(),
            );
        }
        Some(index)
    } else {
        script_bindings.iter().position(|binding| {
            binding_matches_save_target(
                binding,
                target_kind,
                &target,
                owner_button_id.as_deref(),
                effective_program_tab_id,
            )
        })
    };
    let affects_tool_set_hotkeys = is_tool_set_binding_kind(target_kind)
        || binding_index
            .and_then(|index| script_bindings.get(index))
            .map(is_tool_set_binding)
            .unwrap_or(false);

    if !normalized_shortcut.is_empty() {
        let conflicts_with_requested_shortcut = |shortcut: &str| {
            shortcut.trim().eq_ignore_ascii_case(&normalized_shortcut)
                || keyboard_shortcut_conflict_key
                    .zip(super::button_hotkeys::keyboard_shortcut_conflict_key(
                        shortcut,
                    ))
                    .map(|(requested, existing)| requested == existing)
                    .unwrap_or(false)
        };
        if script_bindings.iter().enumerate().any(|(index, binding)| {
            if Some(index) == binding_index {
                return false;
            }

            conflicts_with_requested_shortcut(&binding.shortcut)
        }) {
            return Err("That shortcut is already in use.".to_string());
        }
        if bindings
            .action_hotkeys
            .values()
            .any(|shortcut| conflicts_with_requested_shortcut(shortcut))
        {
            return Err("That shortcut is already in use.".to_string());
        }
    }

    if normalized_shortcut.is_empty() {
        if let Some(index) = binding_index {
            script_bindings.remove(index);
        }
    } else if let Some(index) = binding_index {
        let binding_id = script_bindings[index]
            .id
            .or(script_bindings[index].binding_id)
            .unwrap_or(0);
        script_bindings[index].shortcut = request.shortcut.trim().to_string();
        script_bindings[index].target = target.clone();
        script_bindings[index].kind = Some(target_kind.to_string());
        script_bindings[index].owner_button_id = owner_button_id.clone();
        script_bindings[index].program_tab_id = Some(effective_program_tab_id);
        script_bindings[index].id = Some(binding_id);
        script_bindings[index].binding_id = Some(binding_id);
    } else {
        let next_id = bindings.next_id.unwrap_or(1).max(1);
        script_bindings.push(FrontendScriptBindingRecord {
            id: Some(next_id),
            binding_id: Some(next_id),
            kind: Some(target_kind.to_string()),
            label: None,
            status: Some(String::from("Saved")),
            program_tab_id: Some(effective_program_tab_id),
            shortcut: request.shortcut.trim().to_string(),
            target: target.clone(),
            owner_button_id: owner_button_id.clone(),
        });
        document
            .entry(String::from("Meta"))
            .or_default()
            .insert(String::from("NextId"), (next_id + 1).to_string());
    }

    script_bindings.sort_by_key(|binding| binding.id.or(binding.binding_id).unwrap_or(0));
    let ids = script_bindings
        .iter()
        .filter_map(|binding| binding.id.or(binding.binding_id))
        .collect::<Vec<_>>();
    let meta_section = document.entry(String::from("Meta")).or_default();
    meta_section.insert(
        String::from("NextId"),
        (ids.iter().copied().max().unwrap_or(0) + 1)
            .max(1)
            .to_string(),
    );
    meta_section.insert(
        String::from("Ids"),
        ids.iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("|"),
    );

    rewrite_binding_sections(&mut document, &script_bindings)?;

    write_bindings_file_state(&bindings_path, &document)?;
    if affects_tool_set_hotkeys {
        if let Err(error) = super::button_hotkeys::synchronize_tool_set_hotkeys(&app) {
            let rollback_write =
                write_bindings_bytes_atomic_unchecked(&bindings_path, &previous_bindings_bytes);
            let rollback_sync = if rollback_write.is_ok() {
                super::button_hotkeys::synchronize_tool_set_hotkeys(&app).err()
            } else {
                None
            };
            let mut message = format!(
                "Bind was not saved because the Tool Set shortcut could not be registered: {error}"
            );
            if let Err(rollback_error) = rollback_write {
                message.push_str(&format!(" Binding rollback also failed: {rollback_error}"));
            }
            if let Some(rollback_error) = rollback_sync {
                message.push_str(&format!(
                    " Shortcut registry rollback also failed: {rollback_error}"
                ));
            }
            return Err(message);
        }
    }
    let (next_bindings, _, _) = read_bindings_file_state()?;
    let reload_result = restart_flowcell_headless_backend();
    let mut message = if normalized_shortcut.is_empty() {
        String::from("Bind cleared.")
    } else {
        String::from("Bind saved.")
    };
    if let Err(error) = reload_result {
        message.push_str(" Backend reload failed.");
        eprintln!("{error}");
    }

    Ok(SaveBindShortcutResponse {
        message,
        bindings: next_bindings,
    })
}
