use crate::*;

pub(crate) const FRONTEND_MACRO_OWNER: &str = "flowcell_frontend";
pub(crate) const FRONTEND_MACRO_SCHEMA_VERSION: &str = "2";
pub(crate) const FRONTEND_MACRO_KIND: &str = "macro";
pub(crate) const FRONTEND_RECORDED_ACTIONS_FOLDER: &str = "recorded_actions";

#[derive(Deserialize, Default)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct FlowCellCommandBackendResult {
    pub(crate) succeeded: bool,
    pub(crate) message: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FrontendMacroStepRecord {
    pub(crate) id: String,
    #[serde(rename = "type")]
    pub(crate) step_type: String,
    pub(crate) delay_ms: i64,
    pub(crate) x: Option<i64>,
    pub(crate) y: Option<i64>,
    pub(crate) button: Option<String>,
    pub(crate) count: Option<i64>,
    pub(crate) direction: Option<String>,
    pub(crate) text: Option<String>,
    pub(crate) keys: Option<String>,
    pub(crate) target: Option<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FrontendMacroSummaryRecord {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) program_name: String,
    pub(crate) panel_name: String,
    pub(crate) file_name: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FrontendMacroDocumentRecord {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) program_name: String,
    pub(crate) panel_name: String,
    pub(crate) file_name: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) steps: Vec<FrontendMacroStepRecord>,
    pub(crate) shortcut: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveFrontendMacroRequest {
    pub(crate) current_id: Option<String>,
    pub(crate) program_name: String,
    pub(crate) panel_name: String,
    pub(crate) label: String,
    pub(crate) steps: Vec<FrontendMacroStepRecord>,
    pub(crate) force_new_id: Option<bool>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecordFrontendMacroRequest {
    pub(crate) current_id: Option<String>,
    pub(crate) program_name: String,
    pub(crate) panel_name: String,
    pub(crate) label: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadFrontendMacroFromPathRequest {
    pub(crate) path: String,
    pub(crate) fallback_program_name: String,
    pub(crate) fallback_panel_name: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveMacroShortcutRequest {
    pub(crate) action_id: String,
    pub(crate) shortcut: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveMacroShortcutResponse {
    pub(crate) message: String,
    pub(crate) bindings: FrontendBindingsState,
}

#[derive(Serialize, Clone, Copy, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CursorPositionRecord {
    pub(crate) x: i32,
    pub(crate) y: i32,
}

#[derive(Clone, Default)]
pub(crate) struct ParsedFrontendMacroDefinition {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) program_name: String,
    pub(crate) panel_name: String,
    pub(crate) file_name: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) steps: Vec<FrontendMacroStepRecord>,
}

fn format_macro_id_stem(label: &str) -> String {
    let mut stem = label
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    while stem.contains("__") {
        stem = stem.replace("__", "_");
    }
    stem = stem.trim_matches('_').to_string();
    if stem.is_empty() {
        "button".to_string()
    } else {
        stem
    }
}

fn resolve_frontend_recorded_actions_directory() -> Result<PathBuf, String> {
    let directory = resolve_flowcell_local_root()?.join(FRONTEND_RECORDED_ACTIONS_FOLDER);
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Failed to create frontend macro folder at {}: {error}",
            directory.display()
        )
    })?;
    Ok(directory)
}

pub(crate) fn current_timestamp_token() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

pub(crate) fn current_precise_timestamp_token() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .to_string()
}

pub(crate) fn current_command_timestamp() -> String {
    current_timestamp_token()
}

pub(crate) fn validate_frontend_macro_id(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Macro id is required.".to_string());
    }
    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
    {
        return Err(format!("Macro id '{}' is not valid.", trimmed));
    }
    Ok(trimmed.to_string())
}

fn build_frontend_macro_id(label: &str) -> String {
    let stem = format_macro_id_stem(label);
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("macro_{}_{}", stem, millis)
}

fn resolve_frontend_macro_file_path(action_id: &str) -> Result<PathBuf, String> {
    let validated_action_id = validate_frontend_macro_id(action_id)?;
    Ok(resolve_frontend_recorded_actions_directory()?.join(format!("{validated_action_id}.ini")))
}

fn parse_optional_i64(value: Option<&String>) -> Option<i64> {
    value
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse::<i64>().ok())
}

fn clean_ini_value(value: &str) -> String {
    value.replace('\r', " ").replace('\n', " ")
}

fn is_frontend_macro_document(document: &IniDocument) -> bool {
    let Some(action_section) = document.get("Action") else {
        return false;
    };
    action_section
        .get("Owner")
        .map(|value| value.trim().eq_ignore_ascii_case(FRONTEND_MACRO_OWNER))
        .unwrap_or(false)
        && action_section
            .get("SchemaVersion")
            .map(|value| value.trim() == FRONTEND_MACRO_SCHEMA_VERSION)
            .unwrap_or(false)
}

fn build_macro_definition_from_document(
    path: &Path,
    document: &IniDocument,
    id: String,
    label: String,
    program_name: String,
    panel_name: String,
    created_at: String,
    updated_at: String,
) -> ParsedFrontendMacroDefinition {
    let mut step_sections = document
        .keys()
        .filter(|section| section.starts_with("Step_"))
        .cloned()
        .collect::<Vec<_>>();
    step_sections.sort();

    let mut steps = Vec::new();
    for (index, section_name) in step_sections.iter().enumerate() {
        let Some(section) = document.get(section_name) else {
            continue;
        };
        let raw_type = section
            .get("Type")
            .map(String::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        let button = section
            .get("Button")
            .map(String::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        let macro_id = section
            .get("MacroId")
            .map(String::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        let macro_path = section
            .get("MacroPath")
            .map(String::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        let script_path = section
            .get("ScriptPath")
            .map(String::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();

        let step_type = if !macro_id.is_empty() || !macro_path.is_empty() {
            FRONTEND_MACRO_KIND.to_string()
        } else if !script_path.is_empty() {
            String::from("Script")
        } else if raw_type.eq_ignore_ascii_case("Click") && button.eq_ignore_ascii_case("Right") {
            String::from("RightClick")
        } else {
            raw_type
        };

        let target = if step_type.eq_ignore_ascii_case(FRONTEND_MACRO_KIND) {
            if !macro_id.is_empty() {
                Some(macro_id)
            } else if !macro_path.is_empty() {
                Some(macro_path)
            } else {
                None
            }
        } else if step_type.eq_ignore_ascii_case("Script") {
            if script_path.is_empty() {
                None
            } else {
                Some(script_path)
            }
        } else {
            None
        };

        steps.push(FrontendMacroStepRecord {
            id: format!("step_{:03}", index + 1),
            step_type,
            delay_ms: parse_optional_i64(section.get("DelayMs")).unwrap_or(0),
            x: parse_optional_i64(section.get("X")),
            y: parse_optional_i64(section.get("Y")),
            button: if button.is_empty() {
                None
            } else {
                Some(button)
            },
            count: parse_optional_i64(section.get("Count")),
            direction: section
                .get("Direction")
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
            text: section
                .get("Text")
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
            keys: section
                .get("Keys")
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string),
            target,
        });
    }

    ParsedFrontendMacroDefinition {
        id,
        label,
        program_name,
        panel_name,
        file_name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string(),
        created_at,
        updated_at,
        steps: steps
            .into_iter()
            .map(|mut step| {
                if step.id.trim().is_empty() {
                    step.id = format!("step_{}", current_timestamp_token());
                }
                step
            })
            .collect(),
    }
}

fn read_frontend_macro_definition_from_path(
    path: &Path,
    _bindings: Option<&FrontendBindingsState>,
) -> Result<Option<ParsedFrontendMacroDefinition>, String> {
    let raw_contents = fs::read_to_string(path).map_err(|error| {
        format!(
            "Failed to read frontend macro at {}: {error}",
            path.display()
        )
    })?;
    let document = parse_ini_document(&raw_contents);
    if !is_frontend_macro_document(&document) {
        return Ok(None);
    }

    let action_section = document.get("Action").ok_or_else(|| {
        format!(
            "Frontend macro {} is missing an Action section.",
            path.display()
        )
    })?;
    let id = validate_frontend_macro_id(
        action_section
            .get("Id")
            .map(String::as_str)
            .unwrap_or_default(),
    )?;
    let label = action_section
        .get("Label")
        .map(String::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let program_name = action_section
        .get("ProgramName")
        .map(String::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let panel_name = action_section
        .get("PanelName")
        .map(String::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if label.is_empty() || program_name.is_empty() || panel_name.is_empty() {
        return Err(format!(
            "Frontend macro {} is missing its label or ownership metadata.",
            path.display()
        ));
    }

    let created_at = action_section
        .get("CreatedAt")
        .cloned()
        .unwrap_or_else(current_timestamp_token);
    let updated_at = action_section
        .get("UpdatedAt")
        .cloned()
        .unwrap_or_else(|| created_at.clone());

    Ok(Some(build_macro_definition_from_document(
        path,
        &document,
        id,
        label,
        program_name,
        panel_name,
        created_at,
        updated_at,
    )))
}

fn parsed_frontend_macro_to_document(
    definition: ParsedFrontendMacroDefinition,
    bindings: Option<&FrontendBindingsState>,
) -> FrontendMacroDocumentRecord {
    let shortcut = bindings
        .and_then(|state| state.action_hotkeys.get(&definition.id))
        .cloned();
    FrontendMacroDocumentRecord {
        id: definition.id,
        label: definition.label,
        program_name: definition.program_name,
        panel_name: definition.panel_name,
        file_name: definition.file_name,
        created_at: definition.created_at,
        updated_at: definition.updated_at,
        steps: definition.steps,
        shortcut,
    }
}

pub(crate) fn list_frontend_macro_summaries(
    program_name_filter: Option<&str>,
    panel_name_filter: Option<&str>,
) -> Result<Vec<FrontendMacroSummaryRecord>, String> {
    let recorded_actions_directory = resolve_frontend_recorded_actions_directory()?;
    let entries = fs::read_dir(&recorded_actions_directory).map_err(|error| {
        format!(
            "Failed to read frontend macro folder at {}: {error}",
            recorded_actions_directory.display()
        )
    })?;

    let mut records = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "Failed to inspect frontend macro folder at {}: {error}",
                recorded_actions_directory.display()
            )
        })?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let is_ini = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("ini"))
            .unwrap_or(false);
        if !is_ini {
            continue;
        }
        let Some(definition) = read_frontend_macro_definition_from_path(&path, None)? else {
            continue;
        };
        if let Some(program_name) = program_name_filter {
            if !definition.program_name.eq_ignore_ascii_case(program_name) {
                continue;
            }
        }
        if let Some(panel_name) = panel_name_filter {
            if !definition.panel_name.eq_ignore_ascii_case(panel_name) {
                continue;
            }
        }
        records.push(FrontendMacroSummaryRecord {
            id: definition.id,
            label: definition.label,
            program_name: definition.program_name,
            panel_name: definition.panel_name,
            file_name: definition.file_name,
            created_at: definition.created_at,
            updated_at: definition.updated_at,
        });
    }

    records.sort_by_cached_key(|record| record.label.to_ascii_lowercase());
    Ok(records)
}

fn list_frontend_macros_for_panel(
    program_name: &str,
    panel_name: &str,
) -> Result<Vec<FrontendMacroSummaryRecord>, String> {
    list_frontend_macro_summaries(Some(program_name), Some(panel_name))
}

pub(crate) fn load_frontend_macro_definition(
    action_id: &str,
) -> Result<ParsedFrontendMacroDefinition, String> {
    let macro_path = resolve_frontend_macro_file_path(action_id)?;
    if !macro_path.is_file() {
        return Err(format!(
            "Macro '{}' was not found at {}.",
            action_id.trim(),
            macro_path.display()
        ));
    }
    read_frontend_macro_definition_from_path(&macro_path, None)?.ok_or_else(|| {
        format!(
            "Macro '{}' is not managed by the new frontend.",
            action_id.trim()
        )
    })
}

fn resolve_macro_step_storage(
    step: &FrontendMacroStepRecord,
    current_action_id: &str,
) -> Result<(String, String, String), String> {
    let step_type = step.step_type.trim();
    if step_type.eq_ignore_ascii_case(FRONTEND_MACRO_KIND) {
        let target_id = validate_frontend_macro_id(step.target.as_deref().unwrap_or_default())?;
        let target_path = resolve_frontend_macro_file_path(&target_id)?;
        if target_id != current_action_id && !target_path.is_file() {
            return Err(format!("Nested macro '{}' was not found.", target_id));
        }
        return Ok((
            target_id,
            target_path.to_string_lossy().to_string(),
            String::new(),
        ));
    }
    if step_type.eq_ignore_ascii_case("Script") {
        return Ok((
            String::new(),
            String::new(),
            step.target
                .as_deref()
                .unwrap_or_default()
                .trim()
                .to_string(),
        ));
    }
    Ok((String::new(), String::new(), String::new()))
}

fn write_frontend_macro_definition_file(
    path: &Path,
    action_id: &str,
    label: &str,
    program_name: &str,
    panel_name: &str,
    created_at: Option<&str>,
    steps: &[FrontendMacroStepRecord],
) -> Result<(), String> {
    let mut document = IniDocument::new();
    let mut action_section = HashMap::new();
    let created_at_value = created_at
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(current_timestamp_token);
    action_section.insert(String::from("Id"), action_id.trim().to_string());
    action_section.insert(String::from("Label"), clean_ini_value(label));
    action_section.insert(String::from("Owner"), FRONTEND_MACRO_OWNER.to_string());
    action_section.insert(
        String::from("SchemaVersion"),
        FRONTEND_MACRO_SCHEMA_VERSION.to_string(),
    );
    action_section.insert(String::from("ProgramName"), clean_ini_value(program_name));
    action_section.insert(String::from("PanelName"), clean_ini_value(panel_name));
    action_section.insert(String::from("CreatedAt"), created_at_value);
    action_section.insert(String::from("UpdatedAt"), current_timestamp_token());
    document.insert(String::from("Action"), action_section);

    for (index, step) in steps.iter().enumerate() {
        let section_name = format!("Step_{:03}", index + 1);
        let mut section = HashMap::new();
        let normalized_type = step.step_type.trim();
        let (macro_id, macro_path, script_path) = resolve_macro_step_storage(step, action_id)?;
        section.insert(String::from("Type"), normalized_type.to_string());
        section.insert(String::from("DelayMs"), step.delay_ms.max(0).to_string());

        if let Some(x) = step.x {
            section.insert(String::from("X"), x.to_string());
        }
        if let Some(y) = step.y {
            section.insert(String::from("Y"), y.to_string());
        }
        if let Some(text) = step
            .text
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            section.insert(String::from("Text"), clean_ini_value(text));
        }
        if let Some(keys) = step
            .keys
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            section.insert(String::from("Keys"), clean_ini_value(keys));
        }

        if normalized_type.eq_ignore_ascii_case("Click")
            || normalized_type.eq_ignore_ascii_case("RightClick")
        {
            let button = if normalized_type.eq_ignore_ascii_case("RightClick") {
                "Right".to_string()
            } else {
                step.button
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("Left")
                    .to_string()
            };
            section.insert(String::from("Button"), button);
            section.insert(
                String::from("Count"),
                step.count.unwrap_or(1).max(1).to_string(),
            );
        }

        if normalized_type.eq_ignore_ascii_case("Wheel") {
            section.insert(
                String::from("Direction"),
                step.direction
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("Down")
                    .to_string(),
            );
            section.insert(
                String::from("Count"),
                step.count.unwrap_or(1).max(1).to_string(),
            );
        }

        if !script_path.is_empty() {
            section.insert(String::from("ScriptPath"), script_path);
        }
        if !macro_path.is_empty() {
            section.insert(String::from("MacroPath"), macro_path);
        }
        if !macro_id.is_empty() {
            section.insert(String::from("MacroId"), macro_id);
        }

        document.insert(section_name, section);
    }

    let serialized = serialize_ini_document(&document);
    fs::write(path, serialized).map_err(|error| {
        format!(
            "Failed to write frontend macro at {}: {error}",
            path.display()
        )
    })
}

fn stamp_frontend_macro_metadata(
    path: &Path,
    action_id: &str,
    label: &str,
    program_name: &str,
    panel_name: &str,
    created_at_override: Option<&str>,
) -> Result<(), String> {
    let raw_contents = fs::read_to_string(path).map_err(|error| {
        format!(
            "Failed to read recorded macro at {}: {error}",
            path.display()
        )
    })?;
    let mut document = parse_ini_document(&raw_contents);
    let action_section = document.entry(String::from("Action")).or_default();
    let created_at = created_at_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            action_section
                .get("CreatedAt")
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
        })
        .unwrap_or_else(current_timestamp_token);

    action_section.insert(String::from("Id"), action_id.trim().to_string());
    action_section.insert(String::from("Label"), clean_ini_value(label));
    action_section.insert(String::from("Owner"), FRONTEND_MACRO_OWNER.to_string());
    action_section.insert(
        String::from("SchemaVersion"),
        FRONTEND_MACRO_SCHEMA_VERSION.to_string(),
    );
    action_section.insert(String::from("ProgramName"), clean_ini_value(program_name));
    action_section.insert(String::from("PanelName"), clean_ini_value(panel_name));
    action_section.insert(String::from("CreatedAt"), created_at);
    action_section.insert(String::from("UpdatedAt"), current_timestamp_token());

    let serialized = serialize_ini_document(&document);
    fs::write(path, serialized).map_err(|error| {
        format!(
            "Failed to stamp frontend macro at {}: {error}",
            path.display()
        )
    })
}

fn load_frontend_macro_document_with_bindings(
    action_id: &str,
) -> Result<FrontendMacroDocumentRecord, String> {
    let (bindings, _, _) = read_bindings_file_state()?;
    let definition = load_frontend_macro_definition(action_id)?;
    Ok(parsed_frontend_macro_to_document(
        definition,
        Some(&bindings),
    ))
}

fn resolve_macro_load_destination(
    action_section: &HashMap<String, String>,
    fallback_program_name: &str,
    fallback_panel_name: &str,
) -> Result<(String, String), String> {
    let metadata_program_name = action_section
        .get("ProgramName")
        .map(String::as_str)
        .unwrap_or_default()
        .trim();
    let metadata_panel_name = action_section
        .get("PanelName")
        .map(String::as_str)
        .unwrap_or_default()
        .trim();
    if !metadata_program_name.is_empty()
        && !metadata_panel_name.is_empty()
        && resolve_panel_directory(metadata_program_name, metadata_panel_name).is_ok()
    {
        return Ok((
            metadata_program_name.to_string(),
            metadata_panel_name.to_string(),
        ));
    }

    let fallback_program_name = fallback_program_name.trim();
    let fallback_panel_name = fallback_panel_name.trim();
    if !fallback_program_name.is_empty() && !fallback_panel_name.is_empty() {
        resolve_panel_directory(fallback_program_name, fallback_panel_name)?;
        return Ok((
            fallback_program_name.to_string(),
            fallback_panel_name.to_string(),
        ));
    }

    Err("The selected macro has no valid saved program/panel. Pick a program and panel before loading it.".to_string())
}

fn load_frontend_macro_document_from_path(
    request: LoadFrontendMacroFromPathRequest,
) -> Result<FrontendMacroDocumentRecord, String> {
    let raw_path = request.path.trim();
    if raw_path.is_empty() {
        return Err("Choose a macro file to load.".to_string());
    }

    let macro_path = PathBuf::from(raw_path);
    if !macro_path.is_file() {
        return Err(format!(
            "Macro file was not found at {}.",
            macro_path.display()
        ));
    }

    let is_ini = macro_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("ini"))
        .unwrap_or(false);
    if !is_ini {
        return Err("Macro files must be .ini files.".to_string());
    }

    let raw_contents = fs::read_to_string(&macro_path).map_err(|error| {
        format!(
            "Failed to read macro file at {}: {error}",
            macro_path.display()
        )
    })?;
    let document = parse_ini_document(&raw_contents);
    let action_section = document.get("Action").ok_or_else(|| {
        format!(
            "Macro file {} is missing an Action section.",
            macro_path.display()
        )
    })?;

    let (program_name, panel_name) = resolve_macro_load_destination(
        action_section,
        &request.fallback_program_name,
        &request.fallback_panel_name,
    )?;
    let fallback_label = macro_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Loaded Macro")
        .trim()
        .to_string();
    let label = action_section
        .get("Label")
        .map(String::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let label = if label.is_empty() {
        fallback_label
    } else {
        label
    };
    let created_at = action_section
        .get("CreatedAt")
        .cloned()
        .unwrap_or_else(current_timestamp_token);
    let updated_at = action_section
        .get("UpdatedAt")
        .cloned()
        .unwrap_or_else(|| created_at.clone());
    let saved_id = action_section
        .get("Id")
        .map(String::as_str)
        .unwrap_or_default()
        .trim();
    let managed_id = validate_frontend_macro_id(saved_id)
        .ok()
        .filter(|candidate_id| {
            if !is_frontend_macro_document(&document) {
                return false;
            }
            resolve_frontend_macro_file_path(candidate_id)
                .map(|managed_path| {
                    normalize_path_for_compare(&managed_path)
                        == normalize_path_for_compare(&macro_path)
                })
                .unwrap_or(false)
        })
        .unwrap_or_default();

    let definition = build_macro_definition_from_document(
        &macro_path,
        &document,
        managed_id,
        label,
        program_name,
        panel_name,
        created_at,
        updated_at,
    );
    let bindings = if definition.id.trim().is_empty() {
        None
    } else {
        Some(read_bindings_file_state()?.0)
    };

    Ok(parsed_frontend_macro_to_document(
        definition,
        bindings.as_ref(),
    ))
}

fn remove_frontend_macro_hotkeys(action_ids: &[String]) -> Result<(), String> {
    let mut normalized_ids = Vec::new();
    for action_id in action_ids {
        let normalized_id = validate_frontend_macro_id(action_id)?;
        if !normalized_ids
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(&normalized_id))
        {
            normalized_ids.push(normalized_id);
        }
    }
    if normalized_ids.is_empty() {
        return Ok(());
    }

    let _bindings_guard = super::bindings::bindings_state_guard()?;
    let (_bindings, mut document, bindings_path) = read_bindings_file_state()?;
    let mut changed = false;
    let mut remove_action_hotkeys_section = false;
    if let Some(section) = document.get_mut("ActionHotkeys") {
        for action_id in &normalized_ids {
            changed = section.remove(action_id).is_some() || changed;
        }
        remove_action_hotkeys_section = section.is_empty();
    }
    if remove_action_hotkeys_section {
        document.remove("ActionHotkeys");
    }

    if changed {
        write_bindings_file_state(&bindings_path, &document)?;
        let _ = restart_flowcell_headless_backend();
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn get_cursor_position() -> Result<CursorPositionRecord, String> {
    #[cfg(windows)]
    {
        let mut point = POINT { x: 0, y: 0 };
        let ok = unsafe { GetCursorPos(&mut point) };
        if ok == 0 {
            return Err("Current mouse position could not be read.".to_string());
        }
        return Ok(CursorPositionRecord {
            x: point.x,
            y: point.y,
        });
    }

    #[cfg(not(windows))]
    {
        Err("Current mouse position is only wired on Windows.".to_string())
    }
}

#[tauri::command]
pub(crate) fn list_frontend_macros() -> Result<Vec<FrontendMacroSummaryRecord>, String> {
    list_frontend_macro_summaries(None, None)
}

#[tauri::command]
pub(crate) fn list_frontend_panel_macros(
    program_name: String,
    panel_name: String,
) -> Result<Vec<FrontendMacroSummaryRecord>, String> {
    resolve_panel_directory(&program_name, &panel_name)?;
    list_frontend_macros_for_panel(program_name.trim(), panel_name.trim())
}

#[tauri::command]
pub(crate) fn load_frontend_macro(
    action_id: String,
) -> Result<FrontendMacroDocumentRecord, String> {
    let validated_action_id = validate_frontend_macro_id(&action_id)?;
    load_frontend_macro_document_with_bindings(&validated_action_id)
}

#[tauri::command]
pub(crate) fn load_frontend_macro_from_path(
    request: LoadFrontendMacroFromPathRequest,
) -> Result<FrontendMacroDocumentRecord, String> {
    load_frontend_macro_document_from_path(request)
}

#[tauri::command]
pub(crate) fn get_frontend_macro_directory() -> Result<String, String> {
    Ok(resolve_frontend_recorded_actions_directory()?
        .display()
        .to_string())
}

#[tauri::command]
pub(crate) fn save_frontend_macro(
    request: SaveFrontendMacroRequest,
) -> Result<FrontendMacroDocumentRecord, String> {
    let program_name = request.program_name.trim();
    let panel_name = request.panel_name.trim();
    let label = request.label.trim();
    if program_name.is_empty() || panel_name.is_empty() {
        return Err("Select a program and panel before saving a macro.".to_string());
    }
    if label.is_empty() {
        return Err("Macro name cannot be empty.".to_string());
    }
    if request.steps.is_empty() {
        return Err("Add at least one step before saving a macro.".to_string());
    }

    resolve_panel_directory(program_name, panel_name)?;

    let current_id = request.current_id.unwrap_or_default();
    let existing_definition = if current_id.trim().is_empty() {
        None
    } else {
        Some(load_frontend_macro_definition(&current_id)?)
    };
    let force_new_id = request.force_new_id.unwrap_or(false)
        || existing_definition.is_none() && current_id.trim().is_empty();
    let action_id = if force_new_id {
        build_frontend_macro_id(label)
    } else {
        validate_frontend_macro_id(if current_id.trim().is_empty() {
            existing_definition
                .as_ref()
                .map(|definition| definition.id.as_str())
                .unwrap_or_default()
        } else {
            current_id.trim()
        })?
    };
    let macro_path = resolve_frontend_macro_file_path(&action_id)?;

    write_frontend_macro_definition_file(
        &macro_path,
        &action_id,
        label,
        program_name,
        panel_name,
        if force_new_id {
            None
        } else {
            existing_definition
                .as_ref()
                .map(|definition| definition.created_at.as_str())
        },
        &request.steps,
    )?;
    load_frontend_macro_document_with_bindings(&action_id)
}

#[tauri::command]
pub(crate) fn delete_frontend_macro(
    action_id: String,
) -> Result<Vec<FrontendMacroSummaryRecord>, String> {
    let validated_action_id = validate_frontend_macro_id(&action_id)?;
    let definition = load_frontend_macro_definition(&validated_action_id)?;
    let macro_path = resolve_frontend_macro_file_path(&validated_action_id)?;
    if macro_path.is_file() {
        recycle_file_path(&macro_path)?;
    }
    remove_frontend_macro_hotkeys(&[validated_action_id])?;

    list_frontend_macros_for_panel(&definition.program_name, &definition.panel_name)
}

#[tauri::command]
pub(crate) fn run_frontend_macro(action_id: String) -> Result<String, String> {
    run_flowcell_macro_action(&action_id)
}

#[tauri::command]
pub(crate) fn record_frontend_macro(
    request: RecordFrontendMacroRequest,
) -> Result<FrontendMacroDocumentRecord, String> {
    let program_name = request.program_name.trim();
    let panel_name = request.panel_name.trim();
    let label = request.label.trim();
    if program_name.is_empty() || panel_name.is_empty() {
        return Err("Select a program and panel before recording a macro.".to_string());
    }
    if label.is_empty() {
        return Err("Macro name cannot be empty.".to_string());
    }

    resolve_panel_directory(program_name, panel_name)?;

    let existing_definition = if request
        .current_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        Some(load_frontend_macro_definition(
            request.current_id.as_deref().unwrap_or_default(),
        )?)
    } else {
        None
    };
    let action_id = existing_definition
        .as_ref()
        .map(|definition| definition.id.clone())
        .unwrap_or_else(|| build_frontend_macro_id(label));
    let macro_path = resolve_frontend_macro_file_path(&action_id)?;

    record_frontend_macro_to_path(&macro_path, &action_id, label)?;
    stamp_frontend_macro_metadata(
        &macro_path,
        &action_id,
        label,
        program_name,
        panel_name,
        existing_definition
            .as_ref()
            .map(|definition| definition.created_at.as_str()),
    )?;
    load_frontend_macro_document_with_bindings(&action_id)
}

#[tauri::command]
pub(crate) fn is_space_key_down() -> bool {
    #[cfg(windows)]
    {
        let state = unsafe { GetAsyncKeyState(VK_SPACE as i32) };
        return (state as u16 & 0x8000) != 0;
    }

    #[cfg(not(windows))]
    {
        false
    }
}

#[tauri::command]
pub(crate) fn is_primary_mouse_button_down() -> bool {
    #[cfg(windows)]
    {
        // GetAsyncKeyState reports physical buttons, so honor left/right swap.
        let swapped = unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0;
        let button = if swapped { VK_RBUTTON } else { VK_LBUTTON };
        let state = unsafe { GetAsyncKeyState(button as i32) };
        return (state as u16 & 0x8000) != 0;
    }

    #[cfg(not(windows))]
    {
        false
    }
}

#[tauri::command]
pub(crate) fn save_macro_shortcut(
    request: SaveMacroShortcutRequest,
) -> Result<SaveMacroShortcutResponse, String> {
    let action_id = validate_frontend_macro_id(&request.action_id)?;
    load_frontend_macro_definition(&action_id)?;

    let _bindings_guard = super::bindings::bindings_state_guard()?;
    let (bindings, mut document, bindings_path) = read_bindings_file_state()?;
    let normalized_shortcut = request.shortcut.trim().to_ascii_lowercase();
    if !normalized_shortcut.is_empty() {
        let keyboard_shortcut_conflict_key =
            super::button_hotkeys::keyboard_shortcut_conflict_key(request.shortcut.trim());
        let conflicts_with_requested_shortcut = |shortcut: &str| {
            shortcut.trim().eq_ignore_ascii_case(&normalized_shortcut)
                || keyboard_shortcut_conflict_key
                    .zip(super::button_hotkeys::keyboard_shortcut_conflict_key(
                        shortcut,
                    ))
                    .map(|(requested, existing)| requested == existing)
                    .unwrap_or(false)
        };
        if bindings
            .script_bindings
            .iter()
            .any(|binding| conflicts_with_requested_shortcut(&binding.shortcut))
        {
            return Err("That shortcut is already in use.".to_string());
        }
        if bindings
            .action_hotkeys
            .iter()
            .any(|(existing_action_id, shortcut)| {
                !existing_action_id.eq_ignore_ascii_case(&action_id)
                    && conflicts_with_requested_shortcut(shortcut)
            })
        {
            return Err("That shortcut is already in use.".to_string());
        }
    }

    if normalized_shortcut.is_empty() {
        let mut remove_action_hotkeys_section = false;
        if let Some(section) = document.get_mut("ActionHotkeys") {
            section.remove(&action_id);
            remove_action_hotkeys_section = section.is_empty();
        }
        if remove_action_hotkeys_section {
            document.remove("ActionHotkeys");
        }
    } else {
        document
            .entry(String::from("ActionHotkeys"))
            .or_default()
            .insert(action_id.clone(), request.shortcut.trim().to_string());
    }

    write_bindings_file_state(&bindings_path, &document)?;
    let (next_bindings, _, _) = read_bindings_file_state()?;
    let reload_result = restart_flowcell_headless_backend();
    let mut message = if normalized_shortcut.is_empty() {
        String::from("Macro shortcut cleared.")
    } else {
        String::from("Macro shortcut saved.")
    };
    if let Err(error) = reload_result {
        message.push_str(" Backend reload failed.");
        eprintln!("{error}");
    }

    Ok(SaveMacroShortcutResponse {
        message,
        bindings: next_bindings,
    })
}
