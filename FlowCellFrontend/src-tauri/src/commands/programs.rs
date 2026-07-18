use crate::*;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateProgramFolderResult {
    pub(crate) program_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) status_message: Option<String>,
}

#[derive(Debug)]
struct PendingProgramUnregistration {
    program_name: String,
    bindings_path: PathBuf,
    bindings_snapshot: Option<Vec<u8>>,
    post_unregister_document: IniDocument,
}

static PENDING_PROGRAM_UNREGISTRATIONS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, PendingProgramUnregistration>>,
> = std::sync::OnceLock::new();
static PROGRAM_UNREGISTRATION_SEQUENCE: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(1);

fn pending_program_unregistrations(
) -> &'static std::sync::Mutex<std::collections::HashMap<String, PendingProgramUnregistration>> {
    PENDING_PROGRAM_UNREGISTRATIONS
        .get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

fn next_program_unregistration_token() -> String {
    let sequence =
        PROGRAM_UNREGISTRATION_SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!(
        "program-unregister-{:x}-{stamp:x}-{sequence:x}",
        std::process::id()
    )
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

fn read_bindings_document_at(path: &Path) -> Result<IniDocument, String> {
    let raw = if path.is_file() {
        fs::read_to_string(path)
            .map_err(|error| format!("Failed to read {}: {error}", path.display()))?
    } else {
        String::new()
    };
    Ok(parse_ini_document(&raw))
}

fn begin_program_unregistration_with_state(
    program_name: String,
    mut document: IniDocument,
    bindings_path: PathBuf,
) -> Result<String, String> {
    if find_registered_program(&document, &program_name).is_none() {
        return Err(format!(
            "Program '{}' is not registered in FlowCell.",
            program_name
        ));
    }

    let mut pending = pending_program_unregistrations()
        .lock()
        .map_err(|_| "Program unregistration transaction lock was poisoned.".to_string())?;
    if !pending.is_empty() {
        return Err(
            "Another program removal is awaiting finalization or rollback. Finish it before removing another program."
                .to_string(),
        );
    }

    let bindings_snapshot = if bindings_path.is_file() {
        Some(fs::read(&bindings_path).map_err(|error| {
            format!(
                "Failed to snapshot FlowCell bindings at {}: {error}",
                bindings_path.display()
            )
        })?)
    } else {
        None
    };
    remove_program_registration(&mut document, &program_name);
    write_bindings_file_state(&bindings_path, &document)?;

    let rollback_token = next_program_unregistration_token();
    pending.insert(
        rollback_token.clone(),
        PendingProgramUnregistration {
            program_name,
            bindings_path,
            bindings_snapshot,
            post_unregister_document: document,
        },
    );
    Ok(rollback_token)
}

fn rollback_program_unregistration_snapshot(rollback_token: &str) -> Result<(), String> {
    let rollback_token = rollback_token.trim();
    if rollback_token.is_empty() {
        return Err("Program unregistration rollback token cannot be empty.".to_string());
    }
    let mut pending = pending_program_unregistrations()
        .lock()
        .map_err(|_| "Program unregistration transaction lock was poisoned.".to_string())?;
    let snapshot = pending.get(rollback_token).ok_or_else(|| {
        "Program unregistration rollback token is unknown or already finalized.".to_string()
    })?;
    let current_document = read_bindings_document_at(&snapshot.bindings_path)?;
    if current_document != snapshot.post_unregister_document {
        return Err(format!(
            "FlowCell bindings changed after '{}' was unregistered. Refusing to overwrite unrelated changes; the rollback token remains available.",
            snapshot.program_name
        ));
    }
    restore_bindings_snapshot(
        &snapshot.bindings_path,
        snapshot.bindings_snapshot.as_deref(),
    )?;
    pending.remove(rollback_token);
    Ok(())
}

fn finalize_program_unregistration_snapshot(rollback_token: &str) -> Result<(), String> {
    let rollback_token = rollback_token.trim();
    if rollback_token.is_empty() {
        return Err("Program unregistration rollback token cannot be empty.".to_string());
    }
    let mut pending = pending_program_unregistrations()
        .lock()
        .map_err(|_| "Program unregistration transaction lock was poisoned.".to_string())?;
    let snapshot = pending.get(rollback_token).ok_or_else(|| {
        "Program unregistration rollback token is unknown or already finalized.".to_string()
    })?;
    let current_document = read_bindings_document_at(&snapshot.bindings_path)?;
    if find_registered_program(&current_document, &snapshot.program_name).is_some() {
        return Err(format!(
            "Program '{}' was registered again before removal finalized. Refusing to discard its rollback snapshot.",
            snapshot.program_name
        ));
    }
    pending.remove(rollback_token);
    Ok(())
}

fn compensate_failed_program_rename_reload<R, L>(
    reload_error: String,
    rollback: R,
    reload_rollback: L,
) -> String
where
    R: FnOnce() -> Result<(), String>,
    L: FnOnce() -> Result<(), String>,
{
    let rollback = rollback();
    let rollback_reload = reload_rollback();
    match (rollback, rollback_reload) {
        (Ok(()), Ok(())) => format!(
            "Program rename backend reload failed and the rename was rolled back: {reload_error}"
        ),
        (Ok(()), Err(rollback_reload_error)) => format!(
            "Program rename backend reload failed and the rename was rolled back: {reload_error} Reloading the restored bindings also failed: {rollback_reload_error}"
        ),
        (Err(rollback_error), Ok(())) => format!(
            "Program rename reached the new native side, but the backend reload failed: {reload_error} Rollback also failed: {rollback_error}. The recovery journal was retained for startup recovery."
        ),
        (Err(rollback_error), Err(rollback_reload_error)) => format!(
            "Program rename reached the new native side, but the backend reload failed: {reload_error} Rollback also failed: {rollback_error}. Reloading the current bindings also failed: {rollback_reload_error}. The recovery journal was retained for startup recovery."
        ),
    }
}

#[cfg(test)]
mod program_rename_tests {
    use super::{compensate_failed_program_rename_reload, prepare_program_rename_bindings};
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

    #[test]
    fn failed_rename_reload_rolls_native_state_back_and_reports_restore_reload_failure() {
        let mut rollback_called = false;
        let mut restored_reload_called = false;
        let error = compensate_failed_program_rename_reload(
            "new-side reload".to_string(),
            || {
                rollback_called = true;
                Ok(())
            },
            || {
                restored_reload_called = true;
                Err("old-side reload".to_string())
            },
        );
        assert!(rollback_called);
        assert!(restored_reload_called);
        assert!(error.contains("new-side reload"));
        assert!(error.contains("old-side reload"));
        assert!(error.contains("rolled back"));

        let mut reload_after_failed_rollback = false;
        let error = compensate_failed_program_rename_reload(
            "new-side reload".to_string(),
            || Err("rollback cleanup".to_string()),
            || {
                reload_after_failed_rollback = true;
                Ok(())
            },
        );
        assert!(reload_after_failed_rollback);
        assert!(error.contains("rollback cleanup"));
        assert!(error.contains("retained"));
    }
}

#[cfg(test)]
mod program_unregistration_tests {
    use super::{
        begin_program_unregistration_with_state, finalize_program_unregistration_snapshot,
        pending_program_unregistrations, read_bindings_document_at,
        rollback_program_unregistration_snapshot,
    };
    use crate::commands::bindings::{
        find_registered_program, parse_ini_document, write_bindings_file_state,
    };
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn unregistration_rollback_refuses_drift_and_keeps_retryable_snapshot() {
        pending_program_unregistrations()
            .lock()
            .expect("pending unregistrations")
            .clear();
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "flowcell-program-unregistration-{}-{token}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create temporary root");
        let bindings_path = root.join("bindings.ini");
        let initial = parse_ini_document(
            r#"
[Meta]
ProgramTabIds=1|2
ProgramTabNextId=3
SelectedProgramTabId=1
Ids=9

[ProgramTab_1]
Label=Illustrator
NormalizedName=illustrator

[ProgramTab_2]
Label=Windows
NormalizedName=windows

[Binding_9]
ProgramTabId=1
Shortcut=Ctrl+9
ScriptPath=C:\FlowCell\Illustrator.jsx
"#,
        );
        write_bindings_file_state(&bindings_path, &initial).expect("write initial bindings");
        let initial_bytes = fs::read(&bindings_path).expect("snapshot initial bindings");

        let rollback_token = begin_program_unregistration_with_state(
            "Illustrator".to_string(),
            initial,
            bindings_path.clone(),
        )
        .expect("begin unregistration");
        let post_unregister = read_bindings_document_at(&bindings_path).expect("read unregister");
        assert!(find_registered_program(&post_unregister, "Illustrator").is_none());
        assert!(find_registered_program(&post_unregister, "Windows").is_some());
        assert!(!post_unregister.contains_key("Binding_9"));

        let mut drifted = post_unregister.clone();
        drifted
            .entry("ActionHotkeys".to_string())
            .or_default()
            .insert("OpenSettings".to_string(), "Ctrl+Shift+9".to_string());
        write_bindings_file_state(&bindings_path, &drifted).expect("write unrelated drift");
        let error = rollback_program_unregistration_snapshot(&rollback_token)
            .expect_err("rollback must refuse unrelated drift");
        assert!(error.contains("Refusing to overwrite unrelated changes"));
        assert!(pending_program_unregistrations()
            .lock()
            .expect("pending unregistrations")
            .contains_key(&rollback_token));

        write_bindings_file_state(&bindings_path, &post_unregister)
            .expect("restore post-unregister state for retry");
        let mut read_only_permissions = fs::metadata(&bindings_path)
            .expect("read bindings metadata")
            .permissions();
        read_only_permissions.set_readonly(true);
        fs::set_permissions(&bindings_path, read_only_permissions)
            .expect("make bindings read only");
        let error = rollback_program_unregistration_snapshot(&rollback_token)
            .expect_err("rollback write failure must be reported");
        assert!(error.contains("Failed to restore"));
        assert!(pending_program_unregistrations()
            .lock()
            .expect("pending unregistrations")
            .contains_key(&rollback_token));
        let mut writable_permissions = fs::metadata(&bindings_path)
            .expect("read read-only bindings metadata")
            .permissions();
        writable_permissions.set_readonly(false);
        fs::set_permissions(&bindings_path, writable_permissions).expect("make bindings writable");
        rollback_program_unregistration_snapshot(&rollback_token).expect("retry rollback");
        assert_eq!(
            fs::read(&bindings_path).expect("read restored bindings"),
            initial_bytes
        );
        let restored = read_bindings_document_at(&bindings_path).expect("parse restored bindings");
        assert!(find_registered_program(&restored, "Illustrator").is_some());

        let finalize_token = begin_program_unregistration_with_state(
            "Illustrator".to_string(),
            restored,
            bindings_path.clone(),
        )
        .expect("begin finalized unregistration");
        let finalized_post =
            read_bindings_document_at(&bindings_path).expect("read pending finalized bindings");
        fs::write(&bindings_path, &initial_bytes).expect("simulate concurrent re-registration");
        let error = finalize_program_unregistration_snapshot(&finalize_token)
            .expect_err("finalize must reject concurrent re-registration");
        assert!(error.contains("registered again"));
        assert!(pending_program_unregistrations()
            .lock()
            .expect("pending unregistrations")
            .contains_key(&finalize_token));
        write_bindings_file_state(&bindings_path, &finalized_post)
            .expect("restore pending finalized bindings");
        finalize_program_unregistration_snapshot(&finalize_token).expect("finalize unregistration");
        assert!(find_registered_program(
            &read_bindings_document_at(&bindings_path).expect("read finalized bindings"),
            "Illustrator"
        )
        .is_none());
        assert!(pending_program_unregistrations()
            .lock()
            .expect("pending unregistrations")
            .is_empty());

        fs::remove_dir_all(root).expect("remove temporary root");
    }
}

#[cfg(test)]
mod generated_program_manifest_tests {
    use super::{generated_program_manifest, stable_program_id};

    #[test]
    fn generic_add_program_manifest_can_install_local_scripts() {
        let manifest = generated_program_manifest("Affinity Designer", r"C:\Apps\Affinity.exe");
        assert_eq!(manifest["schemaVersion"], 1);
        assert_eq!(manifest["programId"], "affinity-designer");
        assert_eq!(manifest["runner"]["kind"], "windows-script");
        assert_eq!(manifest["panelsFolder"], "Panels");
        assert_eq!(
            manifest["localScriptsFolder"],
            "Affinity Designer Local Scripts"
        );
        assert!(manifest["allowedScriptExtensions"]
            .as_array()
            .is_some_and(|extensions| !extensions.is_empty()));
        let parsed =
            serde_json::from_value::<crate::program_sources::manifest::ProgramManifest>(manifest)
                .expect("generated manifest matches ProgramManifest");
        assert_eq!(parsed.label, "Affinity Designer");
    }

    #[test]
    fn generated_known_program_manifest_declares_stable_owner_and_profile_metadata() {
        let manifest = generated_program_manifest("Illustrator", r"C:\Adobe\Illustrator.exe");
        assert_eq!(manifest["runner"]["kind"], "illustrator-direct");
        assert_eq!(manifest["bindScopedNativeOwner"], true);
        assert_eq!(manifest["shortcutProfileId"], "adobe.illustrator.windows");
        assert_eq!(stable_program_id("  My  Program!  "), "my-program");
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

fn manifest_folder_path(
    program_directory: &Path,
    value: &str,
    field: &str,
) -> Result<PathBuf, String> {
    program_sources::manifest::resolve_manifest_folder(program_directory, value, field)
}

fn resolve_panels_root(
    program_name: &str,
    create_if_missing: bool,
) -> Result<Option<PathBuf>, String> {
    let program_directory = resolve_program_directory(program_name)?;
    let manifest = program_sources::manifest::load_program_manifest(program_name)?;
    let panels_root =
        manifest_folder_path(&program_directory, &manifest.panels_folder, "panelsFolder")?;

    if panels_root.is_dir() {
        return Ok(Some(panels_root));
    }

    if !create_if_missing {
        return Ok(None);
    }

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

pub(crate) fn resolve_program_git_scripts_directory(program_name: &str) -> Result<PathBuf, String> {
    let program_directory = resolve_program_directory(program_name)?;
    let manifest = program_sources::manifest::load_program_manifest(program_name)?;
    manifest_folder_path(
        &program_directory,
        &manifest.git_scripts_folder,
        "gitScriptsFolder",
    )
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

pub(crate) fn require_registered_program_name(program_name: &str) -> Result<String, String> {
    let requested = validate_folder_name(program_name, "Program")?;
    list_program_folders()?
        .into_iter()
        .find(|candidate| candidate.eq_ignore_ascii_case(&requested))
        .ok_or_else(|| format!("Program '{requested}' is not registered in FlowCell."))
}

#[tauri::command]
pub(crate) fn list_panel_folders(program_name: String) -> Result<Vec<String>, String> {
    let program_name = require_registered_program_name(&program_name)?;
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

fn stable_program_id(program_name: &str) -> String {
    let mut id = String::new();
    let mut pending_separator = false;
    for character in program_name.trim().chars() {
        if character.is_alphanumeric() {
            if pending_separator && !id.is_empty() {
                id.push('-');
            }
            id.extend(character.to_lowercase());
            pending_separator = false;
        } else {
            pending_separator = true;
        }
    }
    if id.is_empty() {
        "program".to_string()
    } else {
        id
    }
}

fn generated_program_manifest(program_name: &str, exe_path: &str) -> serde_json::Value {
    let template = infer_program_template_key(program_name, Some(exe_path));
    let process_name = Path::new(exe_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(program_name)
        .to_ascii_lowercase();
    let (
        program_type,
        default_panels,
        allowed_extensions,
        allowed_manifests,
        supports_toolsets,
        runner_kind,
        program_key,
        install_script,
        delete_script,
    ) = match template {
        "illustrator" => (
            "direct-script",
            vec!["Layers", "Files", "Utility"],
            vec!["jsx", "js"],
            vec!["flowcell.script.json", "flowcell.toolset.json"],
            true,
            "illustrator-direct",
            "illustrator_automation",
            "",
            "",
        ),
        "photoshop" => (
            "direct-script",
            vec!["Layers", "Files", "Utility"],
            vec!["jsx", "js"],
            vec!["flowcell.script.json", "flowcell.toolset.json"],
            true,
            "photoshop-direct",
            "photoshop_automation",
            "",
            "",
        ),
        "blender" => (
            "bridge",
            vec!["Collections", "Files", "Utility"],
            vec!["py"],
            vec!["flowcell.script.json", "flowcell.toolset.json"],
            true,
            "blender-bridge",
            "blender_bridge",
            "Install-BlenderFlowCellButtons.ps1",
            "Remove-BlenderFlowCellButton.ps1",
        ),
        _ => (
            "local-script",
            vec!["Files", "Utility"],
            vec!["ps1", "cmd", "bat", "exe", "lnk", "vbs", "ahk"],
            vec!["flowcell.script.json"],
            false,
            "windows-script",
            "windows_generic",
            "",
            "",
        ),
    };
    let bind_scoped_native_owner = template == "illustrator";
    let shortcut_profile_id = match template {
        "illustrator" => "adobe.illustrator.windows",
        "photoshop" => "adobe.photoshop.windows",
        "blender" => "blender.windows",
        "windows" => "windows",
        _ => "",
    };
    json!({
        "schemaVersion": 1,
        "programId": stable_program_id(program_name),
        "label": program_name,
        "programType": program_type,
        "defaultPanels": default_panels,
        "processNames": [process_name],
        "exePath": exe_path,
        "bindScopedNativeOwner": bind_scoped_native_owner,
        "shortcutProfileId": shortcut_profile_id,
        "gitScriptsFolder": format!("{program_name} Git Scripts"),
        "panelsFolder": "Panels",
        "localScriptsFolder": format!("{program_name} Local Scripts"),
        "supportScriptsFolder": "SupportScripts",
        "allowedScriptExtensions": allowed_extensions,
        "allowedManifestFileNames": allowed_manifests,
        "supportsToolsetManifests": supports_toolsets,
        "runner": {
            "kind": runner_kind,
            "programKey": program_key,
            "installScript": install_script,
            "deleteScript": delete_script,
            "capabilityScript": ""
        },
        "addonReloadNotes": if template == "blender" {
            "Reload the FlowCell Blender add-on or restart Blender after bridge deployment changes."
        } else {
            ""
        },
        "appRestartNotes": "Restart FlowCell after changing this program manifest."
    })
}

fn ensure_program_manifest_and_structure(
    program_name: &str,
    program_path: &Path,
    exe_path: &str,
) -> Result<program_sources::manifest::ProgramManifest, String> {
    let manifest_path = program_path.join("flowcell.program.json");
    if !manifest_path.is_file() {
        let manifest = generated_program_manifest(program_name, exe_path);
        program_sources::records::atomic_write_json(&manifest_path, &manifest)?;
    }
    let manifest = program_sources::manifest::load_program_manifest(program_name)?;
    for (path, field) in [
        (&manifest.git_scripts_folder, "gitScriptsFolder"),
        (&manifest.panels_folder, "panelsFolder"),
        (&manifest.local_scripts_folder, "localScriptsFolder"),
        (&manifest.support_scripts_folder, "supportScriptsFolder"),
    ] {
        let path = manifest_folder_path(program_path, path, field)?;
        fs::create_dir_all(&path)
            .map_err(|error| format!("Failed to create {}: {error}", path.display()))?;
    }
    let panels_root = manifest_folder_path(program_path, &manifest.panels_folder, "panelsFolder")?;
    for panel in &manifest.default_panels {
        let panel = validate_folder_name(panel, "Default panel")?;
        fs::create_dir_all(panels_root.join(panel)).map_err(|error| {
            format!(
                "Failed to create default panel under {}: {error}",
                panels_root.display()
            )
        })?;
    }
    Ok(manifest)
}

fn apply_manifest_registration(
    document: &mut IniDocument,
    program_id: i64,
    program_path: &Path,
    manifest: &program_sources::manifest::ProgramManifest,
    exe_path: &str,
) -> Result<(), String> {
    let section = document
        .get_mut(&format!("ProgramTab_{program_id}"))
        .ok_or_else(|| "Program registration was not created.".to_string())?;
    let local_scripts = manifest_folder_path(
        program_path,
        &manifest.local_scripts_folder,
        "localScriptsFolder",
    )?;
    let run_method = match manifest.runner.kind.as_str() {
        "windows-script" => "windows_generic",
        "illustrator-direct" => "illustrator_direct",
        "photoshop-direct" => "photoshop_direct",
        "blender-bridge" => "blender_bridge",
        value => return Err(format!("Unsupported program runner kind '{value}'.")),
    };
    section.insert("Label".to_string(), manifest.label.clone());
    section.insert(
        "NormalizedName".to_string(),
        manifest.label.to_ascii_lowercase(),
    );
    section.insert(
        "ScriptFolder".to_string(),
        local_scripts.to_string_lossy().to_string(),
    );
    section.insert("ProgramType".to_string(), manifest.program_type.clone());
    section.insert("ExePath".to_string(), exe_path.to_string());
    section.insert("RunMethod".to_string(), run_method.to_string());
    section.insert(
        "AllowedScriptExtensions".to_string(),
        manifest
            .allowed_script_extensions
            .iter()
            .map(|value| format!(".{}", value.trim().trim_start_matches('.')))
            .collect::<Vec<_>>()
            .join("|"),
    );
    section.insert(
        "DefaultPanels".to_string(),
        manifest.default_panels.join("|"),
    );
    section.insert("ProcessNames".to_string(), manifest.process_names.join("|"));
    section.insert(
        "BridgeFolder".to_string(),
        if manifest.runner.kind == "blender-bridge" {
            program_path.to_string_lossy().to_string()
        } else {
            String::new()
        },
    );
    Ok(())
}

#[tauri::command]
pub(crate) fn create_program_folder(
    name: String,
    exe_path: Option<String>,
) -> Result<CreateProgramFolderResult, String> {
    let _bindings_guard = super::bindings::bindings_state_guard()?;
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
    let manifest = ensure_program_manifest_and_structure(&program_name, &program_path, &exe_path)?;

    let bootstrap_message =
        if infer_program_template_key(&program_name, Some(&exe_path)) == "blender" {
            Some(bootstrap_blender_program(&program_name, Some(&exe_path))?)
        } else {
            None
        };

    let (_, mut document, bindings_path) = read_bindings_file_state()?;
    let program_id =
        upsert_program_registration(&mut document, &program_name, &program_path, &exe_path);
    apply_manifest_registration(
        &mut document,
        program_id,
        &program_path,
        &manifest,
        &exe_path,
    )?;
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
pub(crate) fn rename_program_folder(
    current_name: String,
    name: String,
) -> Result<super::program_rename::BeginProgramRenameResult, String> {
    let _button_guard = crate::button_state::button_state_commit_guard()?;
    let _source_guard = program_sources::source_quarantine_guard()?;
    let _bindings_guard = super::bindings::bindings_state_guard()?;
    let current_name = require_registered_program_name(&current_name)?;
    let programs_root = resolve_programs_root()?;
    program_sources::rename::validate_program_folder_rename(&current_name)?;
    let manifest = program_sources::manifest::load_program_manifest(&current_name)?;
    let current_program_path = resolve_program_directory(&current_name)?;
    let requested_final_name = validate_folder_name(&name, "Program")?;
    let requested_program_path = programs_root.join(&requested_final_name);
    if let Some(existing_target_path) =
        find_named_child_directory(&programs_root, &requested_final_name)?
    {
        if !paths_refer_to_same_existing_entry(&existing_target_path, &current_program_path) {
            return Err(format!(
                "Program folder '{}' already exists.",
                requested_final_name
            ));
        }
    }
    let (_, current_bindings, bindings_path) = read_bindings_file_state()?;
    let mut renamed_bindings = current_bindings.clone();
    prepare_program_rename_bindings(
        &mut renamed_bindings,
        &current_name,
        &requested_final_name,
        &current_program_path,
        &requested_program_path,
        &manifest.local_scripts_folder,
    )?;
    let bindings_snapshot = if bindings_path.is_file() {
        Some(fs::read(&bindings_path).map_err(|error| {
            format!(
                "Failed to back up bindings before program rename at {}: {error}",
                bindings_path.display()
            )
        })?)
    } else {
        None
    };
    let previous_button_document =
        crate::button_state::read_button_state_for_program_rename_locked()?;
    let result = super::program_rename::begin_program_rename_locked(
        current_name,
        requested_final_name,
        bindings_snapshot,
        super::bindings::serialize_bindings_file_state(&renamed_bindings),
        previous_button_document.clone(),
    )?;
    if let Err(reload_error) = restart_flowcell_headless_backend() {
        let error = compensate_failed_program_rename_reload(
            reload_error,
            || {
                super::program_rename::rollback_program_rename_locked(
                    &result.rename_token,
                    previous_button_document.as_ref(),
                )
            },
            restart_flowcell_headless_backend,
        );
        return Err(error);
    }
    Ok(result)
}

#[tauri::command]
pub(crate) fn rollback_program_rename(rename_token: String) -> Result<(), String> {
    {
        let _button_guard = crate::button_state::button_state_commit_guard()?;
        let _source_guard = program_sources::source_quarantine_guard()?;
        let _bindings_guard = super::bindings::bindings_state_guard()?;
        let current = crate::button_state::read_button_state_for_program_rename_locked()?;
        super::program_rename::rollback_program_rename_locked(&rename_token, current.as_ref())?;
    }
    restart_flowcell_headless_backend()
}

#[tauri::command]
pub(crate) fn finalize_program_rename(rename_token: String) -> Result<(), String> {
    let _button_guard = crate::button_state::button_state_commit_guard()?;
    let _source_guard = program_sources::source_quarantine_guard()?;
    let _bindings_guard = super::bindings::bindings_state_guard()?;
    let current = crate::button_state::read_button_state_for_program_rename_locked()?;
    super::program_rename::finalize_without_canonical_change_locked(&rename_token, current.as_ref())
}

#[tauri::command]
pub(crate) fn recover_program_rename(rename_token: String) -> Result<(), String> {
    {
        let _button_guard = crate::button_state::button_state_commit_guard()?;
        let _source_guard = program_sources::source_quarantine_guard()?;
        let _bindings_guard = super::bindings::bindings_state_guard()?;
        let current = crate::button_state::read_button_state_for_program_rename_locked()?;
        super::program_rename::resolve_program_rename_locked(&rename_token, current.as_ref())?;
    }
    // A lost response may mean the transaction has already been finalized,
    // so retry the reload even when the token itself is now gone.
    restart_flowcell_headless_backend()
}

#[tauri::command]
pub(crate) fn begin_program_unregistration(name: String) -> Result<String, String> {
    // Program packages are available payloads. Removing a program from FlowCell
    // unregisters it; it must not destroy the package that makes a later Add
    // Program possible.
    let _source_guard = program_sources::source_quarantine_guard()?;
    let _bindings_guard = super::bindings::bindings_state_guard()?;
    let name = require_registered_program_name(&name)?;
    let (_, document, bindings_path) = read_bindings_file_state()?;
    begin_program_unregistration_with_state(name, document, bindings_path)
}

#[tauri::command]
pub(crate) fn rollback_program_unregistration(rollback_token: String) -> Result<(), String> {
    let _bindings_guard = super::bindings::bindings_state_guard()?;
    rollback_program_unregistration_snapshot(&rollback_token)?;
    let _ = restart_flowcell_headless_backend();
    Ok(())
}

#[tauri::command]
pub(crate) fn finalize_program_unregistration(rollback_token: String) -> Result<(), String> {
    let _bindings_guard = super::bindings::bindings_state_guard()?;
    finalize_program_unregistration_snapshot(&rollback_token)?;
    let _ = restart_flowcell_headless_backend();
    Ok(())
}

#[tauri::command]
pub(crate) fn create_panel_folder(program_name: String, name: String) -> Result<String, String> {
    let program_name = require_registered_program_name(&program_name)?;
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
    let _source_guard = program_sources::source_quarantine_guard()?;
    let program_name = require_registered_program_name(&program_name)?;
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
    let _source_guard = program_sources::source_quarantine_guard()?;
    let program_name = require_registered_program_name(&program_name)?;
    let panel_path = resolve_panel_directory(&program_name, &name)?;
    program_sources::records::recover_active_records_in_directory(&panel_path)?;
    for entry in fs::read_dir(&panel_path)
        .map_err(|error| format!("Failed to inspect {}: {error}", panel_path.display()))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to inspect {}: {error}", panel_path.display()))?;
        if entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?
            .is_file()
            && entry
                .file_name()
                .to_string_lossy()
                .to_ascii_lowercase()
                .ends_with(program_sources::records::ACTIVE_SOURCE_RECORD_SUFFIX)
        {
            return Err(format!(
                "Panel '{}/{}' gained an installed Button while deletion was in progress. Its folder was preserved; remove the remaining Button and retry.",
                program_name,
                name.trim()
            ));
        }
    }
    recycle_directory_path(&panel_path)
}

#[tauri::command]
pub(crate) fn list_panel_script_files(
    program_name: String,
    panel_name: String,
) -> Result<Vec<PanelScriptFileRecord>, String> {
    let program_name = require_registered_program_name(&program_name)?;
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
