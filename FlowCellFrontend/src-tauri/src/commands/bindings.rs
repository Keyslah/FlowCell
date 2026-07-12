use crate::*;

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
    pub(crate) binding_id: Option<u64>,
    pub(crate) shortcut: String,
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

fn find_binding_for_target(
    bindings: &FrontendBindingsState,
    program_tab_id: i64,
    target: &str,
) -> Option<(u64, String)> {
    let normalized_target = normalize_binding_target_for_compare(target);
    if normalized_target.is_empty() {
        return None;
    }

    bindings.script_bindings.iter().find_map(|binding| {
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

fn list_bindable_buttons_for_panel(
    program_name: &str,
    panel_name: &str,
    bindings: &FrontendBindingsState,
) -> Result<Vec<BindableButtonRecord>, String> {
    let program_tab_id = resolve_program_tab_id(program_name);
    let mut buttons =
        program_sources::execute::list_active_source_records(program_name, panel_name)?
            .into_iter()
            .map(|resolution| {
                let target = resolution.record.source_path.clone();
                let binding = find_binding_for_target(bindings, program_tab_id, &target);
                BindableButtonRecord {
                    id: format!("{program_name}::{panel_name}::{}", resolution.file_name),
                    label: resolution.record.label,
                    kind: resolution.record.kind,
                    target,
                    execution_target: None,
                    binding_id: binding.as_ref().map(|(binding_id, _)| *binding_id),
                    shortcut: binding.map(|(_, shortcut)| shortcut),
                }
            })
            .collect::<Vec<_>>();
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

pub(crate) fn read_bindings_file_state(
) -> Result<(FrontendBindingsState, IniDocument, PathBuf), String> {
    let bindings_path = resolve_bindings_file_path()?;
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
        let shortcut = section
            .get("Shortcut")
            .cloned()
            .unwrap_or_default()
            .trim()
            .to_string();
        let target = normalize_flowcell_path(
            section
                .get("ScriptPath")
                .map(String::as_str)
                .unwrap_or_default(),
        );
        let program_tab_id = section
            .get("ProgramTabId")
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(0);
        if shortcut.is_empty() || target.is_empty() {
            continue;
        }
        next_id = next_id.max(binding_id + 1);
        script_bindings.push(FrontendScriptBindingRecord {
            id: Some(binding_id),
            binding_id: Some(binding_id),
            kind: Some(String::from("script")),
            label: None,
            status: Some(String::from("Loaded")),
            program_tab_id: Some(program_tab_id),
            shortcut,
            target,
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

    let bindings = FrontendBindingsState {
        next_id: Some(next_id),
        script_bindings,
        action_hotkeys,
    };
    Ok((bindings, document, bindings_path))
}

pub(crate) fn write_bindings_file_state(path: &Path, document: &IniDocument) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create bindings folder at {}: {error}",
                parent.display()
            )
        })?;
    }

    let serialized = serialize_ini_document(document);
    fs::write(path, serialized).map_err(|error| {
        format!(
            "Failed to write FlowCell bindings at {}: {error}",
            path.display()
        )
    })
}

#[tauri::command]
pub(crate) fn load_binds_workspace() -> Result<BindsWorkspaceResponse, String> {
    let (bindings, _document, _bindings_path) = read_bindings_file_state()?;
    let (shortcut_profiles, warnings) = read_shortcut_profile_documents()?;
    let program_names = list_program_folders()?;
    let mut programs = Vec::new();

    for program_name in program_names {
        let panel_names = list_panel_folders(program_name.clone())?;
        let mut panels = Vec::new();
        for panel_name in panel_names {
            panels.push(BindablePanelRecord {
                name: panel_name.clone(),
                buttons: list_bindable_buttons_for_panel(&program_name, &panel_name, &bindings)?,
            });
        }
        programs.push(BindableProgramRecord {
            name: program_name.clone(),
            program_tab_id: resolve_program_tab_id(&program_name),
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
    request: SaveBindShortcutRequest,
) -> Result<SaveBindShortcutResponse, String> {
    let program_name = request.program_name.trim();
    if program_name.is_empty() {
        return Err("Pick a program and panel.".to_string());
    }
    resolve_program_directory(program_name)?;

    let target = normalize_flowcell_path(&request.target);
    if target.trim().is_empty() {
        return Err("No buttons in this panel.".to_string());
    }
    let target_path = PathBuf::from(&target);
    if !target_path.is_file() {
        return Err(format!(
            "Binding target was not found at {}.",
            target_path.display()
        ));
    }

    let (bindings, mut document, bindings_path) = read_bindings_file_state()?;
    let mut script_bindings = bindings.script_bindings.clone();
    let normalized_target = normalize_binding_target_for_compare(&target);
    let normalized_shortcut = request.shortcut.trim().to_ascii_lowercase();
    let requested_binding_id = request.binding_id.unwrap_or(0);
    let effective_program_tab_id = if request.program_tab_id > 0 {
        request.program_tab_id
    } else {
        resolve_program_tab_id(program_name)
    };
    let binding_index = script_bindings.iter().position(|binding| {
        let binding_id = binding.id.or(binding.binding_id).unwrap_or(0);
        if requested_binding_id > 0 && binding_id == requested_binding_id {
            return true;
        }

        binding.program_tab_id.unwrap_or(0) == effective_program_tab_id
            && normalize_binding_target_for_compare(&binding.target) == normalized_target
    });

    if !normalized_shortcut.is_empty() {
        if script_bindings.iter().enumerate().any(|(index, binding)| {
            if Some(index) == binding_index {
                return false;
            }

            binding
                .shortcut
                .trim()
                .eq_ignore_ascii_case(&normalized_shortcut)
        }) {
            return Err("That shortcut is already in use.".to_string());
        }
        if bindings
            .action_hotkeys
            .values()
            .any(|shortcut| shortcut.trim().eq_ignore_ascii_case(&normalized_shortcut))
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
        script_bindings[index].program_tab_id = Some(effective_program_tab_id);
        script_bindings[index].id = Some(binding_id);
        script_bindings[index].binding_id = Some(binding_id);
    } else {
        let next_id = bindings.next_id.unwrap_or(1).max(1);
        script_bindings.push(FrontendScriptBindingRecord {
            id: Some(next_id),
            binding_id: Some(next_id),
            kind: Some(String::from("script")),
            label: None,
            status: Some(String::from("Saved")),
            program_tab_id: Some(effective_program_tab_id),
            shortcut: request.shortcut.trim().to_string(),
            target: target.clone(),
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

    let existing_binding_sections = document
        .keys()
        .filter(|section| section.starts_with("Binding_"))
        .cloned()
        .collect::<Vec<_>>();
    for section in existing_binding_sections {
        document.remove(&section);
    }

    for binding in &script_bindings {
        let binding_id = binding.id.or(binding.binding_id).unwrap_or(0);
        if binding_id == 0 || binding.shortcut.trim().is_empty() || binding.target.trim().is_empty()
        {
            continue;
        }

        let section_name = format!("Binding_{binding_id}");
        let section = document.entry(section_name).or_default();
        section.insert(
            String::from("Shortcut"),
            binding.shortcut.trim().to_string(),
        );
        section.insert(
            String::from("ScriptPath"),
            binding.target.trim().to_string(),
        );
        if binding.program_tab_id.unwrap_or(0) > 0 {
            section.insert(
                String::from("ProgramTabId"),
                binding.program_tab_id.unwrap_or(0).to_string(),
            );
        }
    }

    write_bindings_file_state(&bindings_path, &document)?;
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
