use crate::*;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateProgramFolderResult {
    pub(crate) program_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) status_message: Option<String>,
}

pub(crate) fn resolve_programs_root() -> Result<PathBuf, String> {
    let repo_root = resolve_repo_root().ok_or_else(|| {
        "FlowCell repo root could not be resolved for program folders.".to_string()
    })?;
    let programs_root = repo_root.join("Programs");
    if programs_root.is_dir() {
        Ok(programs_root)
    } else {
        Err(format!(
            "Programs folder was not found at {}.",
            programs_root.display()
        ))
    }
}

pub(crate) fn validate_folder_name(raw_name: &str, kind: &str) -> Result<String, String> {
    let name = raw_name.trim();
    if name.is_empty() {
        return Err(format!("{kind} name cannot be empty."));
    }

    if matches!(name, "." | "..") {
        return Err(format!("{kind} name is not valid."));
    }

    if name.ends_with(' ') || name.ends_with('.') {
        return Err(format!("{kind} name cannot end with a space or period."));
    }

    if name.chars().any(|character| {
        character.is_control()
            || matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
    }) {
        return Err(format!("{kind} name contains invalid filename characters."));
    }

    Ok(name.to_string())
}

fn list_child_directory_names(parent: &Path) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    let entries = fs::read_dir(parent)
        .map_err(|error| format!("Failed to read {}: {error}", parent.display()))?;

    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Failed to read {}: {error}", parent.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;

        if !file_type.is_dir() {
            continue;
        }

        names.push(entry.file_name().to_string_lossy().to_string());
    }

    names.sort_by_cached_key(|name| name.to_ascii_lowercase());
    Ok(names)
}

fn find_named_child_directory(parent: &Path, name: &str) -> Result<Option<PathBuf>, String> {
    let entries = fs::read_dir(parent)
        .map_err(|error| format!("Failed to read {}: {error}", parent.display()))?;

    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Failed to read {}: {error}", parent.display()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;

        if !file_type.is_dir() {
            continue;
        }

        let candidate_name = entry.file_name().to_string_lossy().to_string();
        if candidate_name.eq_ignore_ascii_case(name) {
            return Ok(Some(entry.path()));
        }
    }

    Ok(None)
}

fn paths_refer_to_same_existing_entry(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }

    let Ok(left_canonical) = fs::canonicalize(left) else {
        return false;
    };
    let Ok(right_canonical) = fs::canonicalize(right) else {
        return false;
    };

    if left_canonical == right_canonical {
        return true;
    }

    left_canonical
        .to_string_lossy()
        .eq_ignore_ascii_case(right_canonical.to_string_lossy().as_ref())
}

fn unique_temporary_rename_path(parent: &Path, kind: &str) -> Result<PathBuf, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let normalized_kind = kind.trim().to_ascii_lowercase();

    for attempt in 0..100 {
        let candidate = parent.join(format!(
            ".flowcell-{}-rename-{}-{}",
            normalized_kind, stamp, attempt
        ));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "Could not find a temporary folder name in {}.",
        parent.display()
    ))
}

fn rename_directory_path(
    current_path: &Path,
    target_path: &Path,
    final_name: &str,
    kind: &str,
) -> Result<(), String> {
    let current_name = current_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();

    if current_name == final_name {
        return Ok(());
    }

    if current_name.eq_ignore_ascii_case(final_name) {
        let parent = current_path.parent().ok_or_else(|| {
            format!(
                "{} folder parent could not be resolved for {}.",
                kind,
                current_path.display()
            )
        })?;
        let temporary_path = unique_temporary_rename_path(parent, kind)?;
        fs::rename(current_path, &temporary_path).map_err(|error| {
            format!(
                "Failed to prepare {} for case-only rename at {}: {error}",
                kind.to_ascii_lowercase(),
                current_path.display()
            )
        })?;
        if let Err(error) = fs::rename(&temporary_path, target_path) {
            let _ = fs::rename(&temporary_path, current_path);
            return Err(format!(
                "Failed to rename {} folder to '{}': {error}",
                kind.to_ascii_lowercase(),
                final_name
            ));
        }
        return Ok(());
    }

    fs::rename(current_path, target_path).map_err(|error| {
        format!(
            "Failed to rename {} folder '{}' to '{}': {error}",
            kind.to_ascii_lowercase(),
            current_name,
            final_name
        )
    })
}

fn rename_child_directory(
    parent: &Path,
    current_name: &str,
    next_name: &str,
    kind: &str,
) -> Result<String, String> {
    let current_name = validate_folder_name(current_name, kind)?;
    let next_name = validate_folder_name(next_name, kind)?;
    let current_path = find_named_child_directory(parent, &current_name)?.ok_or_else(|| {
        format!(
            "{} folder '{}' was not found in {}.",
            kind,
            current_name,
            parent.display()
        )
    })?;

    if let Some(existing_target_path) = find_named_child_directory(parent, &next_name)? {
        if !paths_refer_to_same_existing_entry(&existing_target_path, &current_path) {
            return Err(format!("{} folder '{}' already exists.", kind, next_name));
        }
    }

    let target_path = parent.join(&next_name);
    rename_directory_path(&current_path, &target_path, &next_name, kind)?;
    Ok(next_name)
}

fn rebase_program_path_text(value: &str, previous_root: &Path, next_root: &Path) -> String {
    let previous = previous_root.to_string_lossy();
    let next = next_root.to_string_lossy();
    let lower_value = value.to_ascii_lowercase();
    let lower_previous = previous.to_ascii_lowercase();
    let Some(index) = lower_value.find(&lower_previous) else {
        return value.to_string();
    };
    let extended_prefix = value.starts_with(r"\\?\");
    if index != 0 && !(extended_prefix && index == 4) {
        return value.to_string();
    }
    let end = index + previous.len();
    if end < value.len() && !matches!(value.as_bytes()[end], b'\\' | b'/') {
        return value.to_string();
    }
    format!(
        "{}{}{}",
        &value[..index],
        next,
        &value[index + previous.len()..]
    )
}

fn prepare_program_rename_bindings(
    document: &mut IniDocument,
    current_name: &str,
    next_name: &str,
    previous_root: &Path,
    next_root: &Path,
    local_scripts_folder: &str,
) -> Result<bool, String> {
    let Some(program) = find_registered_program(document, current_name) else {
        return Ok(false);
    };
    let section_name = format!("ProgramTab_{}", program.id);
    let section = document.get_mut(&section_name).ok_or_else(|| {
        format!(
            "Registered program '{}' is missing bindings section '{}'.",
            current_name, section_name
        )
    })?;
    section.insert(String::from("Label"), next_name.to_string());
    section.insert(
        String::from("NormalizedName"),
        next_name.to_ascii_lowercase(),
    );
    section.insert(
        String::from("ScriptFolder"),
        next_root
            .join(local_scripts_folder)
            .to_string_lossy()
            .to_string(),
    );
    for key in ["BridgeFolder", "ExePath"] {
        if let Some(value) = section.get_mut(key) {
            *value = rebase_program_path_text(value, previous_root, next_root);
        }
    }

    let program_id = program.id.to_string();
    for binding in document.values_mut() {
        if binding.get("ProgramTabId").map(String::as_str) != Some(program_id.as_str()) {
            continue;
        }
        if let Some(script_path) = binding.get_mut("ScriptPath") {
            *script_path = rebase_program_path_text(script_path, previous_root, next_root);
        }
    }
    sync_program_registration_meta(document, Some(program.id));
    Ok(true)
}

fn restore_bindings_snapshot(path: &Path, snapshot: Option<&[u8]>) -> Result<(), String> {
    if let Some(contents) = snapshot {
        fs::write(path, contents)
            .map_err(|error| format!("Failed to restore {}: {error}", path.display()))
    } else if path.is_file() {
        recycle_file_path(path)
    } else {
        Ok(())
    }
}

fn rollback_program_folder_identity(
    programs_root: &Path,
    current_name: &str,
    renamed_name: &str,
) -> Result<(), String> {
    let rolled_back_name = rename_child_directory(
        programs_root,
        renamed_name,
        current_name,
        "Program rollback",
    )?;
    program_sources::rename::migrate_program_folder_identity(
        &programs_root.join(rolled_back_name),
        renamed_name,
        current_name,
    )
}

#[cfg(test)]
mod program_rename_tests {
    use super::prepare_program_rename_bindings;
    use crate::commands::bindings::parse_ini_document;
    use std::path::Path;

    #[test]
    fn rename_bindings_preserves_registration_and_rebases_owned_paths_only() {
        let mut document = parse_ini_document(
            r#"
[Meta]
ProgramTabIds=2|3
ProgramTabNextId=4
SelectedProgramTabId=2

[ProgramTab_2]
Label=Windows
NormalizedName=windows
ScriptFolder=D:\FlowCell\Programs\Windows\Windows Local Scripts
BridgeFolder=D:\FlowCell\Programs\Windows\Bridge
ExePath=C:\Windows\explorer.exe
CustomValue=keep-me

[ProgramTab_3]
Label=Blender
NormalizedName=blender
ScriptFolder=D:\FlowCell\Programs\Blender\Blender Local Scripts

[Binding_1]
ProgramTabId=2
ScriptPath=D:\FlowCell\Programs\Windows\Windows Local Scripts\owner\source\run.ps1

[Binding_2]
ProgramTabId=2
ScriptPath=D:\FlowCell\Programs\Windows2\outside.ps1

[Binding_3]
ProgramTabId=3
ScriptPath=D:\FlowCell\Programs\Windows\unrelated.ps1
"#,
        );

        assert!(prepare_program_rename_bindings(
            &mut document,
            "Windows",
            "Desktop",
            Path::new(r"D:\FlowCell\Programs\Windows"),
            Path::new(r"D:\FlowCell\Programs\Desktop"),
            "Windows Local Scripts",
        )
        .expect("prepare bindings"));

        let program = &document["ProgramTab_2"];
        assert_eq!(program["Label"], "Desktop");
        assert_eq!(program["NormalizedName"], "desktop");
        assert_eq!(
            program["ScriptFolder"],
            r"D:\FlowCell\Programs\Desktop\Windows Local Scripts"
        );
        assert_eq!(
            program["BridgeFolder"],
            r"D:\FlowCell\Programs\Desktop\Bridge"
        );
        assert_eq!(program["ExePath"], r"C:\Windows\explorer.exe");
        assert_eq!(program["CustomValue"], "keep-me");
        assert_eq!(
            document["Binding_1"]["ScriptPath"],
            r"D:\FlowCell\Programs\Desktop\Windows Local Scripts\owner\source\run.ps1"
        );
        assert_eq!(
            document["Binding_2"]["ScriptPath"],
            r"D:\FlowCell\Programs\Windows2\outside.ps1"
        );
        assert_eq!(
            document["Binding_3"]["ScriptPath"],
            r"D:\FlowCell\Programs\Windows\unrelated.ps1"
        );
    }
}

pub(crate) fn resolve_program_directory(program_name: &str) -> Result<PathBuf, String> {
    let normalized_name = validate_folder_name(program_name, "Program")?;
    let programs_root = resolve_programs_root()?;
    find_named_child_directory(&programs_root, &normalized_name)?.ok_or_else(|| {
        format!(
            "Program folder '{}' was not found in {}.",
            normalized_name,
            programs_root.display()
        )
    })
}

fn find_panels_root(program_directory: &Path) -> Result<Option<PathBuf>, String> {
    if let Some(panels_root) = find_named_child_directory(program_directory, "Panels")? {
        return Ok(Some(panels_root));
    }

    Ok(None)
}

fn resolve_panels_root(
    program_name: &str,
    create_if_missing: bool,
) -> Result<Option<PathBuf>, String> {
    let program_directory = resolve_program_directory(program_name)?;

    if let Some(panels_root) = find_panels_root(&program_directory)? {
        return Ok(Some(panels_root));
    }

    if !create_if_missing {
        return Ok(None);
    }

    let panels_root = program_directory.join("Panels");
    fs::create_dir_all(&panels_root)
        .map_err(|error| format!("Failed to create {}: {error}", panels_root.display()))?;
    Ok(Some(panels_root))
}

pub(crate) fn resolve_panel_directory(
    program_name: &str,
    panel_name: &str,
) -> Result<PathBuf, String> {
    let normalized_panel_name = validate_folder_name(panel_name, "Panel")?;
    let panels_root = resolve_panels_root(program_name, false)?.ok_or_else(|| {
        format!(
            "Panels folder for '{}' could not be resolved.",
            program_name
        )
    })?;

    find_named_child_directory(&panels_root, &normalized_panel_name)?.ok_or_else(|| {
        format!(
            "Panel folder '{}' was not found in {}.",
            normalized_panel_name,
            panels_root.display()
        )
    })
}

pub(crate) fn infer_program_template_key(
    program_name: &str,
    exe_path: Option<&str>,
) -> &'static str {
    let normalized_program_name = program_name.trim().to_ascii_lowercase();
    let exe_name = exe_path
        .and_then(|value| {
            Path::new(value.trim())
                .file_name()
                .and_then(|name| name.to_str())
        })
        .unwrap_or("")
        .to_ascii_lowercase();

    if normalized_program_name.contains("blender") || exe_name.contains("blender") {
        return "blender";
    }
    if normalized_program_name.contains("illustrator") || exe_name.contains("illustrator") {
        return "illustrator";
    }
    if normalized_program_name.contains("photoshop") || exe_name.contains("photoshop") {
        return "photoshop";
    }
    if normalized_program_name.contains("windows") || exe_name.contains("explorer") {
        return "windows";
    }

    "generic"
}

pub(crate) fn validate_panel_script_file_name(raw_name: &str) -> Result<String, String> {
    let trimmed_name = raw_name.trim();
    if trimmed_name.is_empty() {
        return Err("Script file name cannot be empty.".to_string());
    }

    let path = Path::new(trimmed_name);
    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return Err("Script file name is not valid.".to_string());
    };

    if file_name != trimmed_name {
        return Err("Script file name must not include folder separators.".to_string());
    }

    Ok(file_name.to_string())
}

pub(crate) fn format_panel_script_label(file_name: &str) -> String {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name)
        .trim();
    if stem.is_empty() {
        return file_name.to_string();
    }

    let mut label = stem.to_string();
    let lower_label = label.to_ascii_lowercase();
    for prefix in ["file_", "util_", "org_"] {
        if lower_label.starts_with(prefix) && label.len() > prefix.len() {
            label = label[prefix.len()..].to_string();
            break;
        }
    }

    let normalized = label.replace('_', " ").replace('-', " ").trim().to_string();
    if normalized.is_empty() {
        file_name.to_string()
    } else {
        normalized
    }
}

fn strip_case_insensitive_prefix<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    if value.len() < prefix.len() {
        return None;
    }

    let candidate = value.get(..prefix.len())?;
    if candidate.eq_ignore_ascii_case(prefix) {
        Some(&value[prefix.len()..])
    } else {
        None
    }
}

fn parse_description_comment(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    let rest = if let Some(rest) = trimmed.strip_prefix('#') {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("//") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix(';') {
        rest
    } else if let Some(rest) = trimmed.strip_prefix('\'') {
        rest
    } else if let Some(rest) = strip_case_insensitive_prefix(trimmed, "REM") {
        let Some(first_character) = rest.chars().next() else {
            return None;
        };
        if !first_character.is_whitespace() {
            return None;
        }
        rest
    } else {
        return None;
    };

    let rest = rest.trim_start();
    let rest = strip_case_insensitive_prefix(rest, "Description")?;
    let rest = rest.trim_start();
    let rest = rest.strip_prefix(':')?;
    Some(rest.trim().to_string())
}

fn is_supported_header_comment(line: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed.starts_with('#')
        || trimmed.starts_with("//")
        || trimmed.starts_with(';')
        || trimmed.starts_with('\'')
        || strip_case_insensitive_prefix(trimmed, "REM")
            .and_then(|rest| rest.chars().next())
            .map(|character| character.is_whitespace())
            .unwrap_or(false)
}

pub(crate) fn read_top_description(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;

    for (index, line) in content.lines().enumerate() {
        if index == 0 && line.starts_with("#!") {
            continue;
        }

        if let Some(description) = parse_description_comment(line) {
            return Some(description);
        }

        let trimmed = line.trim();
        if trimmed.is_empty() || is_supported_header_comment(line) {
            continue;
        }

        break;
    }

    None
}

fn program_scripts_folder_name(program_name: &str, bucket_name: &str) -> Result<String, String> {
    let normalized_program_name = validate_folder_name(program_name, "Program")?;
    Ok(format!("{normalized_program_name} {bucket_name} Scripts"))
}

pub(crate) fn resolve_program_git_scripts_directory(program_name: &str) -> Result<PathBuf, String> {
    let program_directory = resolve_program_directory(program_name)?;
    let folder_name = program_scripts_folder_name(program_name, "Git")?;
    Ok(program_directory.join(folder_name))
}

#[tauri::command]
pub(crate) fn list_program_folders() -> Result<Vec<String>, String> {
    let programs_root = resolve_programs_root()?;
    let available_folder_names = list_child_directory_names(&programs_root)?;
    let (_, document, _) = read_bindings_file_state()?;
    Ok(registered_program_folder_names(
        &available_folder_names,
        &document,
    ))
}

#[tauri::command]
pub(crate) fn list_panel_folders(program_name: String) -> Result<Vec<String>, String> {
    let Some(panels_root) = resolve_panels_root(&program_name, false)? else {
        return Ok(Vec::new());
    };

    list_child_directory_names(&panels_root)
}

pub(crate) fn resolve_program_executable(
    program_name: &str,
    selected_location: &str,
) -> Result<PathBuf, String> {
    let selected_location = selected_location.trim().trim_matches('"');
    let selected_path = PathBuf::from(selected_location);
    if selected_path.is_file() {
        let is_exe = selected_path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("exe"));
        return is_exe.then_some(selected_path).ok_or_else(|| {
            format!("The selected program file is not an EXE: {selected_location}")
        });
    }
    if !selected_path.is_dir() {
        return Err(format!(
            "Program executable or containing folder was not found: {selected_location}"
        ));
    }

    let mut candidates = fs::read_dir(&selected_path)
        .map_err(|error| format!("Unable to inspect {}: {error}", selected_path.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case("exe"))
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|path| {
        path.file_name()
            .map(|value| value.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default()
    });
    if candidates.is_empty() {
        return Err(format!(
            "No EXE was found directly inside {}.",
            selected_path.display()
        ));
    }

    let normalize = |value: &str| {
        value
            .chars()
            .filter(|character| character.is_ascii_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect::<String>()
    };
    let stem = |path: &Path| {
        path.file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
    };
    let template_key = infer_program_template_key(program_name, Some(selected_location));
    let preferred_stem = match template_key {
        "blender" => Some("blender"),
        "illustrator" => Some("illustrator"),
        "photoshop" => Some("photoshop"),
        "windows" => Some("explorer"),
        _ => None,
    };
    if let Some(preferred_stem) = preferred_stem {
        if let Some(candidate) = candidates
            .iter()
            .find(|candidate| stem(candidate).eq_ignore_ascii_case(preferred_stem))
        {
            return Ok(candidate.clone());
        }
    }

    let normalized_program_name = normalize(program_name);
    if let Some(candidate) = candidates
        .iter()
        .find(|candidate| normalize(&stem(candidate)) == normalized_program_name)
    {
        return Ok(candidate.clone());
    }

    let auxiliary_terms = [
        "crash",
        "helper",
        "launcher",
        "setup",
        "uninstall",
        "update",
        "report",
        "service",
    ];
    let primary_candidates = candidates
        .iter()
        .filter(|candidate| {
            let candidate_stem = stem(candidate);
            !auxiliary_terms
                .iter()
                .any(|term| candidate_stem.contains(term))
        })
        .cloned()
        .collect::<Vec<_>>();
    if primary_candidates.len() == 1 {
        return Ok(primary_candidates[0].clone());
    }
    if candidates.len() == 1 {
        return Ok(candidates.remove(0));
    }

    let candidate_names = candidates
        .iter()
        .filter_map(|path| path.file_name().and_then(|value| value.to_str()))
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "Multiple EXEs were found in {}: {}. Run Add Program again and paste the full path to the correct EXE.",
        selected_path.display(),
        candidate_names
    ))
}

#[tauri::command]
pub(crate) fn create_program_folder(
    name: String,
    exe_path: Option<String>,
) -> Result<CreateProgramFolderResult, String> {
    let requested_program_name = validate_folder_name(&name, "Program")?;
    let selected_location = exe_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Choose the program executable or its containing folder.".to_string())?;
    let exe_path = resolve_program_executable(&requested_program_name, selected_location)?;
    let exe_path = exe_path.to_string_lossy().into_owned();
    let programs_root = resolve_programs_root()?;
    let program_path = if let Some(existing_path) =
        find_named_child_directory(&programs_root, &requested_program_name)?
    {
        existing_path
    } else {
        let program_path = programs_root.join(&requested_program_name);
        fs::create_dir(&program_path)
            .map_err(|error| format!("Failed to create {}: {error}", program_path.display()))?;
        program_path
    };
    let program_name = program_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&requested_program_name)
        .to_string();

    let bootstrap_message =
        if infer_program_template_key(&program_name, Some(&exe_path)) == "blender" {
            Some(bootstrap_blender_program(&program_name, Some(&exe_path))?)
        } else {
            None
        };

    let (_, mut document, bindings_path) = read_bindings_file_state()?;
    upsert_program_registration(&mut document, &program_name, &program_path, &exe_path);
    write_bindings_file_state(&bindings_path, &document)?;
    let reload_error = restart_flowcell_headless_backend().err();
    let mut status_message = format!("{program_name} registered with {exe_path}.");
    if let Some(message) = bootstrap_message.filter(|message| !message.trim().is_empty()) {
        status_message.push_str("\n\n");
        status_message.push_str(&message);
    }
    if let Some(error) = reload_error {
        status_message.push_str("\n\nBackend reload failed: ");
        status_message.push_str(&error);
    }

    Ok(CreateProgramFolderResult {
        program_name,
        status_message: Some(status_message),
    })
}

#[tauri::command]
pub(crate) fn rename_program_folder(current_name: String, name: String) -> Result<String, String> {
    let programs_root = resolve_programs_root()?;
    program_sources::rename::validate_program_folder_rename(&current_name)?;
    let manifest = program_sources::manifest::load_program_manifest(&current_name)?;
    let current_program_path = resolve_program_directory(&current_name)?;
    let requested_final_name = validate_folder_name(&name, "Program")?;
    let requested_program_path = programs_root.join(&requested_final_name);
    let (_, current_bindings, bindings_path) = read_bindings_file_state()?;
    let mut renamed_bindings = current_bindings.clone();
    let bindings_changed = prepare_program_rename_bindings(
        &mut renamed_bindings,
        &current_name,
        &requested_final_name,
        &current_program_path,
        &requested_program_path,
        &manifest.local_scripts_folder,
    )?;
    let bindings_snapshot = if bindings_changed && bindings_path.is_file() {
        Some(fs::read(&bindings_path).map_err(|error| {
            format!(
                "Failed to back up bindings before program rename at {}: {error}",
                bindings_path.display()
            )
        })?)
    } else {
        None
    };

    let final_name = rename_child_directory(&programs_root, &current_name, &name, "Program")?;
    let renamed_program_path = programs_root.join(&final_name);
    if let Err(migration_error) = program_sources::rename::migrate_program_folder_identity(
        &renamed_program_path,
        &current_name,
        &final_name,
    ) {
        let rollback_error =
            rollback_program_folder_identity(&programs_root, &current_name, &final_name).err();
        return Err(match rollback_error {
            Some(error) => format!(
                "Program source identity migration failed: {migration_error} Rollback failed: {error}"
            ),
            None => format!(
                "Program source identity migration failed and the folder rename was rolled back: {migration_error}"
            ),
        });
    }

    if bindings_changed {
        if let Err(bindings_error) = write_bindings_file_state(&bindings_path, &renamed_bindings) {
            let rollback_error =
                rollback_program_folder_identity(&programs_root, &current_name, &final_name).err();
            let restore_error =
                restore_bindings_snapshot(&bindings_path, bindings_snapshot.as_deref()).err();
            let mut rollback_failures = Vec::new();
            if let Some(error) = rollback_error {
                rollback_failures.push(format!("folder/source rollback failed: {error}"));
            }
            if let Some(error) = restore_error {
                rollback_failures.push(format!("bindings restore failed: {error}"));
            }
            return Err(if rollback_failures.is_empty() {
                format!(
                    "Program bindings update failed and the program rename was rolled back: {bindings_error}"
                )
            } else {
                format!(
                    "Program bindings update failed: {bindings_error} Rollback failed: {}",
                    rollback_failures.join(" | ")
                )
            });
        }
        let _ = restart_flowcell_headless_backend();
    }
    Ok(final_name)
}

#[tauri::command]
pub(crate) fn delete_program_folder(name: String) -> Result<(), String> {
    let program_path = resolve_program_directory(&name)?;
    recycle_directory_path(&program_path)?;
    let (_, mut document, bindings_path) = read_bindings_file_state()?;
    remove_program_registration(&mut document, &name);
    write_bindings_file_state(&bindings_path, &document)?;
    let _ = restart_flowcell_headless_backend();
    Ok(())
}

#[tauri::command]
pub(crate) fn create_panel_folder(program_name: String, name: String) -> Result<String, String> {
    let panel_name = validate_folder_name(&name, "Panel")?;
    let panels_root = resolve_panels_root(&program_name, true)?.ok_or_else(|| {
        format!(
            "Panels folder for '{}' could not be resolved.",
            program_name
        )
    })?;
    let panel_path = panels_root.join(&panel_name);

    fs::create_dir(&panel_path).map_err(|error| match error.kind() {
        ErrorKind::AlreadyExists => format!("Panel folder '{}' already exists.", panel_name),
        _ => format!("Failed to create {}: {error}", panel_path.display()),
    })?;

    Ok(panel_name)
}

#[tauri::command]
pub(crate) fn rename_panel_folder(
    program_name: String,
    current_name: String,
    name: String,
) -> Result<String, String> {
    let panels_root = resolve_panels_root(&program_name, false)?.ok_or_else(|| {
        format!(
            "Panels folder for '{}' could not be resolved.",
            program_name
        )
    })?;
    program_sources::rename::validate_panel_folder_rename(&program_name, &current_name)?;
    let final_name = rename_child_directory(&panels_root, &current_name, &name, "Panel")?;
    if let Err(migration_error) = program_sources::rename::migrate_panel_folder_identity(
        &program_name,
        &current_name,
        &final_name,
    ) {
        let rollback =
            rename_child_directory(&panels_root, &final_name, &current_name, "Panel rollback");
        let rollback_error = match rollback {
            Ok(_) => program_sources::rename::migrate_panel_folder_identity(
                &program_name,
                &final_name,
                &current_name,
            )
            .err(),
            Err(error) => Some(error),
        };
        return Err(match rollback_error {
            Some(error) => format!(
                "Panel source identity migration failed: {migration_error} Rollback failed: {error}"
            ),
            None => format!(
                "Panel source identity migration failed and the folder rename was rolled back: {migration_error}"
            ),
        });
    }
    Ok(final_name)
}

#[tauri::command]
pub(crate) fn delete_panel_folder(program_name: String, name: String) -> Result<(), String> {
    let panel_path = resolve_panel_directory(&program_name, &name)?;
    recycle_directory_path(&panel_path)
}

#[tauri::command]
pub(crate) fn list_panel_script_files(
    program_name: String,
    panel_name: String,
) -> Result<Vec<PanelScriptFileRecord>, String> {
    let mut records =
        program_sources::execute::list_active_source_records(&program_name, &panel_name)?
            .into_iter()
            .map(|resolution| {
                let record = resolution.record;
                let execution_file_name = resolution.file_name.clone();
                let execution_events = record.events.clone();
                let events = record.events.and_then(|events| {
                    serde_json::to_value(events).ok().and_then(|value| {
                        serde_json::from_value::<PanelButtonEventsRecord>(value).ok()
                    })
                });
                PanelScriptFileRecord {
                    file_name: resolution.file_name,
                    label: record.label,
                    tooltip: (!record.tooltip.trim().is_empty()).then_some(record.tooltip),
                    kind: Some(record.kind),
                    execution_target: Some(json!({
                        "kind": "panel-script",
                        "programName": record.program_name,
                        "panelName": record.panel_name,
                        "fileName": execution_file_name,
                        "events": execution_events,
                    })),
                    bridge_action: (!record.bridge_action.trim().is_empty())
                        .then_some(record.bridge_action),
                    bridge_data: record.bridge_data,
                    events,
                    children: (!record.children.is_empty()).then_some(
                        record
                            .children
                            .into_iter()
                            .map(|child| PanelScriptChildRecord {
                                slot: child.slot,
                                label: child.label,
                                tooltip: child.tooltip,
                            })
                            .collect(),
                    ),
                }
            })
            .collect::<Vec<_>>();
    records.sort_by_cached_key(|record| record.label.to_ascii_lowercase());
    Ok(records)
}
