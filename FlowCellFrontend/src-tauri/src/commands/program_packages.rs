//! Import one published program ZIP as data; registration/setup remains in Add Program.
use crate::program_sources::manifest::{self, ProgramManifest};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

const EXTRACTOR: &str =
    include_str!("../../../../flowcellbackend/helpers/Expand-FlowCellProgramPackage.ps1");
static IMPORT_LOCK: Mutex<()> = Mutex::new(());
static IMPORT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportedProgramPackage {
    pub(crate) program_name: String,
    pub(crate) package_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) cleanup_warning: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExtractedPackage {
    program_name: String,
}

fn plain_path(path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) => {
                #[cfg(windows)]
                let reparse = {
                    use std::os::windows::fs::MetadataExt;
                    metadata.file_attributes() & 0x400 != 0
                };
                #[cfg(not(windows))]
                let reparse = false;
                if metadata.file_type().is_symlink() || reparse {
                    return Err(format!(
                        "Program package paths cannot use links or reparse points: {}",
                        ancestor.display()
                    ));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

fn unique_name(prefix: &str) -> String {
    format!(
        ".{prefix}-{}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        IMPORT_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

fn tree_paths(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut pending = vec![root.to_path_buf()];
    let mut paths = Vec::new();
    while let Some(directory) = pending.pop() {
        plain_path(&directory)?;
        for entry in fs::read_dir(&directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            plain_path(&path)?;
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_dir() {
                pending.push(path.clone());
            } else if !kind.is_file() {
                return Err("Program package contains a special file.".into());
            }
            paths.push(path);
        }
    }
    Ok(paths)
}

fn read_json(path: &Path) -> Result<Value, String> {
    let metadata = fs::metadata(path)
        .map_err(|e| format!("Missing package manifest {}: {e}", path.display()))?;
    if metadata.len() > 8 * 1024 * 1024 {
        return Err("Program package manifest exceeds 8 MiB.".into());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Invalid manifest {}: {e}", path.display()))
}

fn required_file(root: &Path, value: &str, field: &str) -> Result<(), String> {
    let path = manifest::resolve_relative_manifest_path(root, value, field, false)?
        .ok_or_else(|| format!("Missing {field}."))?;
    plain_path(&path)?;
    if !path.is_file() {
        return Err(format!(
            "Program ZIP is missing {field}: {}",
            path.display()
        ));
    }
    Ok(())
}

fn validate_source_files(
    manifest: &ProgramManifest,
    path: &Path,
    import_kind: &str,
) -> Result<(), String> {
    let descriptor = if path.is_dir() {
        let script = path.join("flowcell.script.json");
        let toolset = path.join("flowcell.toolset.json");
        if script.is_file() && toolset.is_file() {
            return Err("Bundled source has ambiguous package manifests.".into());
        }
        if script.is_file() {
            script
        } else if toolset.is_file() {
            toolset
        } else {
            return Err(format!(
                "Bundled package has no script or Tool Set manifest: {}",
                path.display()
            ));
        }
    } else if matches!(
        path.file_name().and_then(|v| v.to_str()),
        Some("flowcell.script.json" | "flowcell.toolset.json")
    ) {
        path.to_path_buf()
    } else if path.is_file() {
        return crate::program_sources::install::validate_source_in_program_package(
            manifest,
            path,
            import_kind,
        );
    } else {
        return Err(format!(
            "Program ZIP is missing bundled source: {}",
            path.display()
        ));
    };
    let root = descriptor
        .parent()
        .ok_or("Invalid bundled source location.")?;
    let value = read_json(&descriptor)?;
    crate::program_sources::install::validate_source_in_program_package(
        manifest,
        path,
        import_kind,
    )?;
    required_file(
        root,
        value["source"]
            .as_str()
            .ok_or("Bundled source manifest is missing source.")?,
        "source",
    )?;
    if let Some(aliases) = value.get("importAliases") {
        for alias in aliases
            .as_array()
            .ok_or("importAliases must be an array.")?
        {
            required_file(
                root,
                alias.as_str().ok_or("importAliases must contain paths.")?,
                "importAliases",
            )?;
        }
    }
    if let Some(page) = value.get("page") {
        required_file(
            root,
            page["entry"].as_str().ok_or("Page is missing entry.")?,
            "page.entry",
        )?;
        for key in ["scripts", "styles", "assets"] {
            if let Some(items) = page.get(key) {
                for item in items
                    .as_array()
                    .ok_or_else(|| format!("page.{key} must be an array."))?
                {
                    required_file(
                        root,
                        item.as_str().ok_or("Page resources must contain paths.")?,
                        &format!("page.{key}"),
                    )?;
                }
            }
        }
    }
    Ok(())
}

fn validate_staged_package(root: &Path, name: &str) -> Result<(), String> {
    if crate::validate_folder_name(name, "Program")? != name {
        return Err("Program folder must match its untrimmed name.".into());
    }
    let mut manifest: ProgramManifest =
        serde_json::from_value(read_json(&root.join("flowcell.program.json"))?)
            .map_err(|e| format!("Invalid program manifest: {e}"))?;
    manifest::validate_manifest(&mut manifest, name, root)?;
    let mutable = [&manifest.panels_folder, &manifest.local_scripts_folder];
    for relative in mutable {
        if manifest::resolve_manifest_folder(root, relative, "mutable folder")?.exists() {
            return Err(format!(
                "Program ZIP includes personal state folder '{relative}'."
            ));
        }
    }
    for path in tree_paths(root)? {
        if path
            .file_name()
            .and_then(|v| v.to_str())
            .is_some_and(|v| matches!(v, "flowcell.script.json" | "flowcell.toolset.json"))
        {
            validate_source_files(&manifest, &path, "auto")?;
        }
    }
    for (value, field) in [
        (&manifest.git_scripts_folder, "gitScriptsFolder"),
        (&manifest.support_scripts_folder, "supportScriptsFolder"),
    ] {
        if !manifest::resolve_manifest_folder(root, value, field)?.is_dir() {
            return Err(format!("Program ZIP is missing its {field} folder."));
        }
    }
    for (value, field) in [
        (&manifest.runner.install_script, "runner.installScript"),
        (&manifest.runner.delete_script, "runner.deleteScript"),
    ] {
        if let Some(path) = manifest::resolve_runner_script_path(root, &manifest, value, field)? {
            if !path.is_file() {
                return Err(format!("Program ZIP is missing {field}."));
            }
        }
    }
    if let Some(library) = &manifest.theme_library {
        if !manifest::resolve_manifest_folder(root, library, "themeLibrary")?.is_dir() {
            return Err("Program ZIP is missing its declared themeLibrary folder.".into());
        }
    }
    for source in &manifest.bundled_sources {
        let path = manifest::resolve_relative_manifest_path(
            root,
            &source.source_path,
            "bundledSources.sourcePath",
            false,
        )?
        .ok_or("Bundled source path is empty.")?;
        validate_source_files(&manifest, &path, &source.import_kind)?;
    }
    Ok(())
}

// A fresh install can contain an empty Panels/Startup tree. Files are never merged.
fn placeholder_directories(target: &Path) -> Result<Vec<PathBuf>, String> {
    plain_path(target)?;
    if !target.is_dir() {
        return Err("The program destination already exists and is not an empty folder.".into());
    }
    let paths = tree_paths(target)?;
    if paths.iter().any(|path| !path.is_dir()) {
        return Err("This program already has files. Its package and personal settings were preserved. Use the existing program in Add Program; ZIP import does not overwrite programs.".into());
    }
    paths
        .into_iter()
        .map(|path| {
            path.strip_prefix(target)
                .map(Path::to_path_buf)
                .map_err(|e| e.to_string())
        })
        .collect()
}

fn commit_package_with(
    staged: &Path,
    programs: &Path,
    name: &str,
    recycle: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<ImportedProgramPackage, String> {
    let _source_guard = crate::program_sources::source_quarantine_guard()?;
    plain_path(programs)?;
    let target = programs.join(name);
    plain_path(&target)?;
    let mut placeholder = None;
    if target.exists() {
        let original = placeholder_directories(&target)?;
        let backup = programs.join(unique_name("flowcell-package-placeholder"));
        fs::rename(&target, &backup)
            .map_err(|e| format!("Could not preserve the program placeholder: {e}"))?;
        let prepare = (|| {
            let after_move = placeholder_directories(&backup)?;
            let mut before = original;
            let mut after = after_move.clone();
            before.sort();
            after.sort();
            if before != after {
                return Err("Program placeholder changed during ZIP import; try again.".into());
            }
            for relative in after_move {
                let directory = staged.join(relative);
                plain_path(&directory)?;
                fs::create_dir_all(directory).map_err(|e| e.to_string())?;
            }
            Ok::<(), String>(())
        })();
        if let Err(error) = prepare {
            fs::rename(&backup, &target).map_err(|restore| format!("{error} Original placeholder remains at {} because restoration failed: {restore}", backup.display()))?;
            return Err(error);
        }
        placeholder = Some(backup);
    }
    let commit =
        plain_path(programs).and_then(|_| fs::rename(staged, &target).map_err(|e| e.to_string()));
    if let Err(error) = commit {
        if let Some(backup) = placeholder {
            fs::rename(&backup, &target).map_err(|restore| {
                format!(
                    "Package import failed: {error}. Original placeholder remains at {}: {restore}",
                    backup.display()
                )
            })?;
        }
        return Err(format!(
            "Program package could not be installed; existing files were preserved: {error}"
        ));
    }
    let cleanup_warning = placeholder.and_then(|backup| {
        recycle(&backup).err().map(|error| {
            format!(
                "Program imported. Its old empty placeholder remains at {}: {error}",
                backup.display()
            )
        })
    });
    Ok(ImportedProgramPackage {
        program_name: name.into(),
        package_path: target.to_string_lossy().into(),
        cleanup_warning,
    })
}

fn import_from_zip(zip_path: &Path, programs: &Path) -> Result<ImportedProgramPackage, String> {
    let _guard = IMPORT_LOCK
        .lock()
        .map_err(|_| "Program ZIP import lock is unavailable.")?;
    plain_path(zip_path)?;
    plain_path(programs)?;
    if !zip_path.is_file()
        || !zip_path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("zip"))
    {
        return Err("Choose a FlowCell program .zip file.".into());
    }
    let stage = programs.join(unique_name("flowcell-package-import"));
    fs::create_dir(&stage).map_err(|e| format!("Could not create program ZIP staging: {e}"))?;
    let result = (|| {
        let helper = stage.join("expand.ps1");
        fs::write(&helper, EXTRACTOR).map_err(|e| e.to_string())?;
        let payload = stage.join("payload");
        let mut command = Command::new(super::filesystem::resolve_powershell_path());
        command
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(&helper)
            .arg("-ArchivePath")
            .arg(zip_path)
            .arg("-Destination")
            .arg(&payload);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let output = command
            .output()
            .map_err(|e| format!("Could not read program ZIP: {e}"))?;
        if !output.status.success() {
            let message = String::from_utf8_lossy(&output.stderr)
                .chars()
                .take(4096)
                .collect::<String>();
            return Err(format!("Program ZIP was rejected. {}", message.trim()));
        }
        let extracted: ExtractedPackage = serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Invalid ZIP inspection response: {e}"))?;
        let staged = payload.join("Programs").join(&extracted.program_name);
        validate_staged_package(&staged, &extracted.program_name)?;
        commit_package_with(
            &staged,
            programs,
            &extracted.program_name,
            super::filesystem::recycle_directory_path,
        )
    })();
    // Only our newly created staging tree is eligible for permanent temp cleanup.
    let cleanup =
        tree_paths(&stage).and_then(|_| fs::remove_dir_all(&stage).map_err(|e| e.to_string()));
    match (result, cleanup) {
        (Ok(mut imported), Err(error)) => {
            imported.cleanup_warning = Some(format!(
                "Program imported. Temporary ZIP files remain at {}: {error}",
                stage.display()
            ));
            Ok(imported)
        }
        (Err(error), Err(cleanup)) => Err(format!(
            "{error} Temporary files remain at {}: {cleanup}",
            stage.display()
        )),
        (result, Ok(())) => result,
    }
}

#[tauri::command]
pub(crate) async fn import_program_package(
    zip_path: String,
) -> Result<ImportedProgramPackage, String> {
    let programs = super::programs::resolve_programs_root()?;
    tauri::async_runtime::spawn_blocking(move || import_from_zip(Path::new(&zip_path), &programs))
        .await
        .map_err(|e| format!("Program ZIP import did not finish: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temporary() -> PathBuf {
        let root = std::env::temp_dir().join(unique_name("flowcell-package-test"));
        fs::create_dir(&root).unwrap();
        root
    }
    #[test]
    fn existing_files_are_preserved_and_new_package_stays_staged() {
        let root = temporary();
        let programs = root.join("Programs");
        let staged = root.join("staged");
        fs::create_dir_all(programs.join("Sample/Panel")).unwrap();
        fs::create_dir(&staged).unwrap();
        fs::write(programs.join("Sample/Panel/personal.txt"), b"keep me").unwrap();
        fs::write(staged.join("flowcell.program.json"), b"new").unwrap();
        assert!(
            commit_package_with(&staged, &programs, "Sample", |_| panic!(
                "must not recycle user files"
            ))
            .is_err()
        );
        assert_eq!(
            fs::read(programs.join("Sample/Panel/personal.txt")).unwrap(),
            b"keep me"
        );
        assert!(staged.join("flowcell.program.json").exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn directory_only_placeholder_keeps_startup_tree_and_recycles_original() {
        let root = temporary();
        let programs = root.join("Programs");
        let staged = root.join("staged");
        fs::create_dir_all(programs.join("Sample/Panels/Startup")).unwrap();
        fs::create_dir(&staged).unwrap();
        fs::write(staged.join("flowcell.program.json"), b"new").unwrap();
        let installed = commit_package_with(&staged, &programs, "Sample", |backup| {
            assert!(backup.join("Panels/Startup").is_dir());
            fs::remove_dir_all(backup).map_err(|e| e.to_string())
        })
        .unwrap();
        assert!(installed.cleanup_warning.is_none());
        assert!(!staged.exists());
        assert!(programs.join("Sample/Panels/Startup").is_dir());
        assert_eq!(
            fs::read(programs.join("Sample/flowcell.program.json")).unwrap(),
            b"new"
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failed_commit_restores_original_placeholder() {
        let root = temporary();
        let programs = root.join("Programs");
        fs::create_dir_all(programs.join("Sample")).unwrap();
        assert!(
            commit_package_with(&root.join("missing"), &programs, "Sample", |_| panic!(
                "must not recycle after failure"
            ))
            .is_err()
        );
        assert!(programs.join("Sample").is_dir());
        assert_eq!(fs::read_dir(&programs).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn declared_mutable_state_and_missing_source_are_rejected() {
        let root = temporary();
        fs::create_dir(root.join("Catalog")).unwrap();
        fs::create_dir(root.join("Support")).unwrap();
        let manifest = serde_json::json!({"schemaVersion":1,"programId":"sample","label":"Sample","programType":"local-script",
            "processNames":["sample"],"gitScriptsFolder":"Catalog","panelsFolder":"Personal Panels","localScriptsFolder":"Owned Scripts",
            "supportScriptsFolder":"Support","allowedScriptExtensions":["ps1"],"runner":{"kind":"windows-script"}});
        fs::write(
            root.join("flowcell.program.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        validate_staged_package(&root, "Sample").unwrap();
        fs::create_dir(root.join("Owned Scripts")).unwrap();
        assert!(validate_staged_package(&root, "Sample")
            .unwrap_err()
            .contains("personal state"));
        fs::remove_dir(root.join("Owned Scripts")).unwrap();
        fs::write(
            root.join("Catalog/flowcell.script.json"),
            br#"{"schemaVersion":1,"label":"Sample","source":"missing.ps1"}"#,
        )
        .unwrap();
        assert!(validate_staged_package(&root, "Sample")
            .unwrap_err()
            .contains("missing or unsupported"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn invalid_source_schema_unknown_fields_and_page_capabilities_fail_before_commit() {
        let root = temporary();
        fs::create_dir(root.join("Catalog")).unwrap();
        fs::create_dir(root.join("Support")).unwrap();
        let manifest = serde_json::json!({"schemaVersion":1,"programId":"sample","label":"Sample","programType":"local-script",
            "processNames":["sample"],"gitScriptsFolder":"Catalog","panelsFolder":"Panels","localScriptsFolder":"Owned",
            "supportScriptsFolder":"Support","allowedScriptExtensions":["ps1"],"runner":{"kind":"windows-script"}});
        fs::write(
            root.join("flowcell.program.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        fs::write(
            root.join("Catalog/action.ps1"),
            b"throw 'must never execute'",
        )
        .unwrap();
        let path = root.join("Catalog/flowcell.script.json");
        let source = serde_json::json!({"schemaVersion":1,"label":"Sample","source":"action.ps1"});
        let mut invalid = source.clone();
        invalid["schemaVersion"] = 999.into();
        fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
        assert!(validate_staged_package(&root, "Sample")
            .unwrap_err()
            .contains("schemaVersion"));
        invalid = source.clone();
        invalid["unknownField"] = true.into();
        fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
        assert!(validate_staged_package(&root, "Sample")
            .unwrap_err()
            .contains("unknown field"));
        let page = serde_json::json!({"schemaVersion":1,"id":"sample.page","program":"Sample","label":"Page","tooltip":"",
            "entry":"index.html","scripts":[],"styles":[],"assets":[],"window":{"title":"Page","width":100,"height":100,"minWidth":10,"minHeight":10},
            "actions":[],"capabilities":[],"ownerStateFormat":"sample.state.v1","supportedDataFormats":[],"refreshEvents":[]});
        fs::write(root.join("Catalog/index.html"), b"<html></html>").unwrap();
        let mut page_source = source.clone();
        page_source["page"] = page;
        fs::write(&path, serde_json::to_vec(&page_source).unwrap()).unwrap();
        validate_staged_package(&root, "Sample").unwrap();
        invalid = page_source.clone();
        invalid["page"]["schemaVersion"] = 999.into();
        fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
        assert!(validate_staged_package(&root, "Sample")
            .unwrap_err()
            .contains("schemaVersion"));
        invalid = page_source;
        invalid["page"]["actions"] = serde_json::json!([{"id":"bad","handler":{"kind":"core","capability":"arbitrary.execute","options":{}},"requestSchema":{"type":"object"},"responseSchema":{"type":"object"}}]);
        fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
        assert!(validate_staged_package(&root, "Sample")
            .unwrap_err()
            .contains("capability"));
        assert!(!root.join("Panels").exists());
        assert!(!root.join("Owned").exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    #[ignore = "Set FLOWCELL_TEST_PROGRAM_ZIPS to an existing release ZIP directory; imports only into disposable test folders."]
    fn existing_release_program_zips_import_without_registration() {
        let directory = PathBuf::from(
            std::env::var_os("FLOWCELL_TEST_PROGRAM_ZIPS").expect("Set FLOWCELL_TEST_PROGRAM_ZIPS"),
        );
        let mut archives = fs::read_dir(directory)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.file_name()
                    .and_then(|v| v.to_str())
                    .is_some_and(|name| name.starts_with("FlowCell-") && name.ends_with(".zip"))
            })
            .collect::<Vec<_>>();
        archives.sort();
        assert!(!archives.is_empty(), "No existing program ZIPs found");
        let root = temporary();
        let result = (|| {
            for (index, archive) in archives.iter().enumerate() {
                let programs = root.join(index.to_string());
                fs::create_dir(&programs).unwrap();
                let imported = import_from_zip(archive, &programs)?;
                assert!(Path::new(&imported.package_path)
                    .join("flowcell.program.json")
                    .is_file());
                assert_eq!(fs::read_dir(&programs).unwrap().count(), 1);
                println!(
                    "Imported existing release ZIP as inert data: {}",
                    archive.file_name().unwrap().to_string_lossy()
                );
            }
            Ok::<(), String>(())
        })();
        fs::remove_dir_all(root).unwrap();
        result.unwrap();
    }
}
