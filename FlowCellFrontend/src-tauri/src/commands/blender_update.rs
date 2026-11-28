use crate::program_sources::transaction::{write_json_file, AtomicWriteMode};
use super::programs::{program_setup_status_root, save_program_setup_result_at};
use crate::*;

const WORKER: &str = include_str!("blender_update.ps1");
const BOOTSTRAP: &str =
    include_str!("../../../../Programs/Blender/SupportScripts/flowcell_startup_bootstrap.py");
static UPDATE_LOCK: Mutex<()> = Mutex::new(());

fn run_worker(plan: Value, timeout: u64) -> Result<Value, String> {
    let work = env::temp_dir().join(format!(
        "flowcell-blender-update-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    ));
    fs::create_dir(&work).map_err(|e| e.to_string())?;
    let run = || -> Result<Value, String> {
        let plan_path = work.join("plan.json");
        let script = work.join("update.ps1");
        fs::write(
            &plan_path,
            serde_json::to_vec(&plan).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::write(&script, WORKER).map_err(|e| e.to_string())?;
        fs::write(work.join("flowcell_startup_bootstrap.py"), BOOTSTRAP)
            .map_err(|e| e.to_string())?;
        fs::write(
            work.join("prepare_update_profile.py"),
            include_str!("prepare_update_profile.py"),
        )
        .map_err(|e| e.to_string())?;
        let mut command = build_powershell_output_command(&[
            "-NonInteractive".into(),
            "-File".into(),
            script.to_string_lossy().into_owned(),
        ]);
        command
            .env("FLOWCELL_UPDATE_PLAN", &plan_path)
            .env("FLOWCELL_LOCAL_ROOT", resolve_flowcell_local_root()?);
        let output =
            super::execution::run_program_setup_process(command, timeout, "Blender update")?;
        if !output.status.success() {
            return Err(format_process_failure(&output, "Blender update failed."));
        }
        serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Blender update returned an invalid result: {e}"))
    };
    let result = run();
    let _ = fs::remove_dir_all(work); // This operation's own short-lived staging directory.
    result
}

fn registration(doc: &IniDocument) -> Result<(String, String), String> {
    let program = find_registered_program(doc, "Blender")
        .ok_or("Add the Blender program to FlowCell first.")?;
    let section = format!("ProgramTab_{}", program.id);
    let path = doc[&section].get("ExePath").cloned().unwrap_or_default();
    Ok((section, path))
}

#[tauri::command]
pub(crate) async fn detect_blender_installations() -> Result<Value, String> {
    program_sources::run_source_blocking("detect Blender", || {
        let (_, doc, _) = read_bindings_file_state()?;
        let registered = find_registered_program(&doc, "Blender")
            .and_then(|program| doc.get(&format!("ProgramTab_{}", program.id)))
            .and_then(|section| section.get("ExePath"))
            .cloned()
            .unwrap_or_default();
        let manifest = program_sources::manifest::load_program_manifest("Blender")?;
        let mut paths: Vec<_> = super::program_executables::discover_program_executables(&manifest)
            .candidates
            .into_iter()
            .map(|candidate| candidate.path)
            .collect();
        if !registered.is_empty() && !paths.iter().any(|p| p.eq_ignore_ascii_case(&registered)) {
            paths.push(registered.clone());
        }
        let candidates = run_worker(json!({"operation":"detect","paths":paths}), 30)?;
        Ok(json!({"registered":registered,"candidates":candidates}))
    })
    .await
}

#[tauri::command]
pub(crate) async fn install_latest_blender() -> Result<Value, String> {
    program_sources::run_source_blocking("install Blender", || {
        let _guard = UPDATE_LOCK
            .try_lock()
            .map_err(|_| "Another Blender update is in progress.")?;
        run_worker(json!({"operation":"install"}), 1800)
    })
    .await
}

#[tauri::command]
pub(crate) async fn sync_blender_installation(
    executable: String,
    expected_version: Option<String>,
    preference_choice: Option<String>,
) -> Result<Value, String> {
    program_sources::run_source_blocking("sync Blender", move || {
        let result = reconnect_blender(executable, expected_version, preference_choice)?;
        if result["needsPreferenceChoice"] == true {
            return Ok(result);
        }
        restart_flowcell_headless_backend().map_err(|error| {
            format!(
                "Blender was connected. Restart FlowCell to reload background shortcuts: {error}"
            )
        })?;
        Ok(result)
    })
    .await
}

fn reconnect_blender(
    executable: String,
    expected_version: Option<String>,
    preference_choice: Option<String>,
) -> Result<Value, String> {
    let _guard = UPDATE_LOCK
        .try_lock()
        .map_err(|_| "Another Blender update is in progress.")?;
    let _sources = program_sources::source_quarantine_guard()?;
    let executable =
        windows_child_process_path(&resolve_program_executable("Blender", &executable)?);
    let (_, doc, _) = read_bindings_file_state()?;
    let original = registration(&doc)?;
    let owners = installed_blender_actions()?;
    let config_path = resolve_blender_config_path()?;
    let mut config: Value =
        serde_json::from_slice(&fs::read(&config_path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Invalid Blender config: {e}"))?;
    if !config["automation"].is_object() {
        return Err("Blender automation configuration is missing.".into());
    }
    let result = run_worker(
        json!({"operation":"sync","executable":executable,"expectedVersion":expected_version,"preferenceChoice":preference_choice,"owners":owners,
            "config":windows_child_process_path(&config_path),"program":windows_child_process_path(&resolve_program_directory("Blender")?)}),
        600,
    )?;
    if result["needsPreferenceChoice"] == true {
        return Ok(result);
    }
    let bridge = result["bridge"]
        .as_str()
        .ok_or("Blender did not return its bridge path.")?;
    config["automation"]["bridgeFolder"] = json!(bridge);
    let config_bytes = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
    let target = resolve_flowcell_local_root()?
        .join("private")
        .join("blender.config.local.json");
    let _bindings = super::bindings::bindings_state_guard()?;
    let (_, mut doc, bindings_path) = read_bindings_file_state()?;
    if registration(&doc)? != original {
        return Err(
            "Blender registration changed during sync. Select the installation again.".into(),
        );
    }
    let before = doc.clone();
    doc.get_mut(&original.0)
        .ok_or("Blender registration is missing.")?
        .insert("ExePath".into(), executable.to_string_lossy().into_owned());
    write_bindings_file_state(&bindings_path, &doc)?;
    if let Err(error) = write_json_file(&target, &config_bytes, AtomicWriteMode::Replace) {
        write_bindings_file_state(&bindings_path, &before).map_err(|rollback| {
            format!("{error}; could not restore the Blender path: {rollback}")
        })?;
        return Err(error);
    }
    let status = ProgramSetupResult {
        program_name: "Blender".into(),
        status: ProgramSetupState::Ready,
        message: format!(
            "FlowCell actions are synchronized to {}.",
            executable.display()
        ),
        restart_notes: "Open or restart the selected Blender to load the bridge.".into(),
    };
    save_program_setup_result_at(&program_setup_status_root()?, &status).map_err(|e| {
        format!("Blender was connected, but its saved setup status could not be refreshed: {e}")
    })?;
    Ok(result)
}

fn installed_blender_actions() -> Result<Vec<Value>, String> {
    let mut owners = Vec::new();
    for panel in list_panel_folders("Blender".into())? {
        for resolution in program_sources::execute::list_active_source_records("Blender", &panel)? {
            let record = resolution.record;
            if record.runner != "blender-bridge" || record.bridge_action.is_empty() {
                continue;
            }
            if record.bridge_action
                != format!(
                    "flowcell_button_{}",
                    record.owner_button_id.to_ascii_lowercase()
                )
            {
                return Err(format!(
                    "Cannot reconnect the nonstandard action for '{}'.",
                    record.label
                ));
            }
            // list_active_source_records resolves each source inside its installed owner's package.
            owners.push(json!({
                "id": record.owner_button_id,
                "panel": panel,
                "source": windows_child_process_path(Path::new(&record.source_path)),
                "data": record.bridge_data.unwrap_or_else(|| json!({}))
            }));
        }
    }
    Ok(owners)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Run with an isolated copy of a registered Blender Program and a real host.
    #[test]
    #[ignore = "requires a disposable Windows FlowCell profile and a Blender executable"]
    fn reconnect_installed_actions_to_another_blender() {
        let local = resolve_flowcell_local_root().unwrap();
        let scripts = PathBuf::from(env::var_os("BLENDER_USER_SCRIPTS").unwrap());
        let programs = resolve_programs_root().unwrap();
        let fixture = PathBuf::from(env::var_os("FLOWCELL_BLENDER_UPDATE_TEST_ROOT").unwrap())
            .canonicalize()
            .unwrap();
        assert!(fixture.starts_with(env::temp_dir().canonicalize().unwrap()));
        for path in [&local, &scripts, &programs] {
            assert!(path.canonicalize().unwrap().starts_with(&fixture));
        }
        let executable = env::var("FLOWCELL_BLENDER_UPDATE_TEST_EXE").unwrap();
        let owners = installed_blender_actions().unwrap();
        assert!(!owners.is_empty());
        let before = read_bindings_file_state().unwrap().1;
        let mut expected = before.clone();
        let (section, _) = registration(&before).unwrap();
        expected
            .get_mut(&section)
            .unwrap()
            .insert("ExePath".into(), executable.clone());
        let selection = tauri::async_runtime::block_on(detect_blender_installations()).unwrap();
        assert!(selection["candidates"].is_array());
        assert!(reconnect_blender(executable.clone(), Some("0.0.0".into()), None).is_err());
        assert_eq!(read_bindings_file_state().unwrap().1, before);
        for _ in 0..2 {
            let result = reconnect_blender(executable.clone(), None, None).unwrap();
            let bridge = Path::new(result["bridge"].as_str().unwrap());
            assert!(bridge.starts_with(&scripts));
            assert_eq!(result["count"].as_u64(), Some(owners.len() as u64));
            assert_eq!(read_bindings_file_state().unwrap().1, expected);
            assert_eq!(
                read_blender_bridge_config().unwrap().bridge_folder,
                bridge.to_str().unwrap()
            );
            let registry: Value = serde_json::from_slice(
                &fs::read(bridge.join("flowcell_custom_actions.json")).unwrap(),
            )
            .unwrap();
            for owner in &owners {
                let matches: Vec<_> = registry["actions"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|entry| entry["ownerButtonId"] == owner["id"])
                    .collect();
                assert_eq!(matches.len(), 1);
                let deployed = Path::new(matches[0]["pythonPath"].as_str().unwrap());
                assert!(deployed.is_file() && deployed.starts_with(bridge));
            }
        }
    }
}
