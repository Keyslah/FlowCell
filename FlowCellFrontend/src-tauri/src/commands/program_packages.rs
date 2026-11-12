//! Import one published program ZIP as data; registration/setup remains in Add Program.
use crate::program_sources::manifest::{self, ProgramManifest};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Read,
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
const PACKAGE_INVENTORY_FILE: &str = "flowcell.package.json";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProgramPackageInventory {
    schema_version: u32,
    program_id: String,
    files: BTreeMap<String, ProgramPackageFile>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProgramPackageFile {
    sha256: String,
    bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportedProgramPackage {
    pub(crate) program_name: String,
    pub(crate) package_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) cleanup_warning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) available_package: Option<super::programs::AvailableProgramPackage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) inventory_warning: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExtractedPackage {
    program_name: String,
}

#[cfg(any(windows, test))]
fn is_cloud_directory_tag(attributes: u32, tag: u32) -> bool {
    attributes & 0x410 == 0x410 && tag & 0xffff0fff == 0x9000001a
}

#[cfg(windows)]
fn cloud_directory(path: &Path) -> Result<bool, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{
        Foundation::INVALID_HANDLE_VALUE,
        Storage::FileSystem::{FindClose, FindFirstFileW, WIN32_FIND_DATAW},
    };
    let absolute = std::path::absolute(path).map_err(|e| e.to_string())?;
    let wide = absolute.as_os_str().encode_wide().collect::<Vec<_>>();
    let extended = "\\\\?\\".encode_utf16().collect::<Vec<_>>();
    let mut name = if wide.starts_with(&extended) {
        wide
    } else if wide.starts_with(&[92, 92]) {
        "\\\\?\\UNC\\"
            .encode_utf16()
            .chain(wide.into_iter().skip(2))
            .collect()
    } else {
        extended.into_iter().chain(wide).collect()
    };
    name.push(0);
    let mut data = std::mem::MaybeUninit::<WIN32_FIND_DATAW>::zeroed();
    let handle = unsafe { FindFirstFileW(name.as_ptr(), data.as_mut_ptr()) };
    if handle == INVALID_HANDLE_VALUE {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let data = unsafe {
        let result = data.assume_init();
        FindClose(handle);
        result
    };
    Ok(is_cloud_directory_tag(
        data.dwFileAttributes,
        data.dwReserved0,
    ))
}

pub(super) fn plain_path(path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) => {
                #[cfg(windows)]
                let reparse = {
                    use std::os::windows::fs::MetadataExt;
                    metadata.file_attributes() & 0x400 != 0 && !cloud_directory(ancestor)?
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
    validate_package_inventory(root, &manifest)?;
    // An invalid or unsupported default must fail while this is still a disposable
    // staging folder. Committing first would strand a package that Add Program
    // cannot use and that subsequent imports correctly refuse to overwrite.
    super::theme_archive::read_program_default_theme(root, &manifest)?;
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

fn validate_package_inventory(root: &Path, manifest: &ProgramManifest) -> Result<(), String> {
    let path = root.join(PACKAGE_INVENTORY_FILE);
    if !path.exists() {
        return Ok(()); // Legacy releases predate the integrity inventory.
    }
    plain_path(&path)?;
    if fs::metadata(&path).map_err(|error| error.to_string())?.len() > 16 * 1024 * 1024 {
        return Err("Program package inventory exceeds 16 MiB.".into());
    }
    let inventory: ProgramPackageInventory = serde_json::from_slice(&fs::read(&path).map_err(|error| error.to_string())?)
        .map_err(|error| format!("Invalid Program package inventory: {error}"))?;
    if inventory.schema_version != 1 {
        return Err(format!("Unsupported Program package inventory schemaVersion {}.", inventory.schema_version));
    }
    if inventory.program_id != manifest.program_id {
        return Err("Program package inventory belongs to a different Program.".into());
    }
    if inventory.files.is_empty() || inventory.files.len() > 25000
        || !inventory.files.contains_key("flowcell.program.json") {
        return Err("Program package inventory must list 1 to 25000 files including flowcell.program.json.".into());
    }
    let mut folded = BTreeSet::new();
    let mut expected_bytes = 0u64;
    for (relative, file) in &inventory.files {
        let normalized = manifest::normalize_relative_manifest_path(relative, "package inventory path", false)?;
        if normalized.replace('\\', "/") != *relative || relative == PACKAGE_INVENTORY_FILE
            || relative.encode_utf16().count() > 4096 || relative.contains('\\') || relative.split('/').any(|part| {
                let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
                let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
                    || stem.strip_prefix("COM").or_else(|| stem.strip_prefix("LPT"))
                        .is_some_and(|suffix| matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"));
                part.is_empty() || part == "." || part == ".." || part.encode_utf16().count() > 255
                    || part.ends_with('.') || part.ends_with(' ') || reserved
                    || part.chars().any(|character| character.is_control() || matches!(character, ':' | '<' | '>' | '"' | '|' | '?' | '*'))
            }) || !folded.insert(relative.to_ascii_lowercase()) {
            return Err(format!("Program package inventory has an unsafe or duplicate path: {relative}"));
        }
        if file.sha256.len() != 64 || !file.sha256.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()) {
            return Err(format!("Program package inventory has an invalid SHA-256 for '{relative}'."));
        }
        if file.bytes > 128 * 1024 * 1024 {
            return Err(format!("Program package inventory file '{relative}' exceeds 128 MiB."));
        }
        expected_bytes = expected_bytes.checked_add(file.bytes).ok_or("Program package inventory size overflow.")?;
        if expected_bytes > 1024 * 1024 * 1024 {
            return Err("Program package inventory exceeds 1024 MiB.".into());
        }
    }
    let mut seen = BTreeSet::new();
    let mut buffer = [0u8; 65536];
    for path in tree_paths(root)? {
        if path.is_dir() { continue; }
        let relative = path.strip_prefix(root).map_err(|error| error.to_string())?.to_string_lossy().replace('\\', "/");
        if relative == PACKAGE_INVENTORY_FILE { continue; }
        let expected = inventory.files.get(&relative)
            .ok_or_else(|| format!("Program package contains an unlisted file: {relative}"))?;
        if fs::metadata(&path).map_err(|error| error.to_string())?.len() != expected.bytes {
            return Err(format!("Program package file '{relative}' failed size validation."));
        }
        let mut input = fs::File::open(&path).map_err(|error| error.to_string())?;
        let mut digest = Sha256::new();
        let mut bytes = 0u64;
        loop {
            let read = input.read(&mut buffer).map_err(|error| error.to_string())?;
            if read == 0 { break; }
            bytes += read as u64;
            if bytes > expected.bytes {
                return Err(format!("Program package file '{relative}' changed during validation."));
            }
            digest.update(&buffer[..read]);
        }
        if bytes != expected.bytes || format!("{:x}", digest.finalize()) != expected.sha256 {
            return Err(format!("Program package file '{relative}' failed SHA-256 validation."));
        }
        seen.insert(relative);
    }
    if let Some(missing) = inventory.files.keys().find(|relative| !seen.contains(*relative)) {
        return Err(format!("Program package is missing an inventoried file: {missing}"));
    }
    Ok(())
}

// A fresh install can contain an empty Panels/Startup tree. Files are never merged.
pub(super) fn placeholder_directories(target: &Path) -> Result<Vec<PathBuf>, String> {
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
    commit_package_with_options(staged, programs, name, true, recycle)
}

fn commit_package_with_options(
    staged: &Path,
    programs: &Path,
    name: &str,
    preserve_placeholder: bool,
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
            for relative in after_move.into_iter().filter(|_| preserve_placeholder) {
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
        available_package: None,
        inventory_warning: None,
    })
}

/// Copy the immutable installer catalog through the same validated commit used by
/// ZIP imports. This installs catalog data only; the selected panels and Buttons
/// are created by the normal Add Program transaction after the user chooses them.
pub(super) fn seed_installed_windows_catalog(
    resource: &Path,
    programs: &Path,
) -> Result<(), String> {
    let _guard = IMPORT_LOCK.lock().map_err(|_| "Program import lock is unavailable.")?;
    let target = programs.join("Windows");
    plain_path(&target)?;
    if target.join("flowcell.program.json").is_file() {
        return Ok(()); // Never overwrite an existing catalog or user changes.
    }
    let preserve_placeholder = if target.exists() {
        let directories = placeholder_directories(&target)?;
        // Older Core installers created this exact empty tree for the background
        // service. It must not force Startup into an unchecked installation plan.
        !directories.iter().all(|path| path == Path::new("Panels")
            || path == Path::new("Panels").join("Startup").as_path())
    } else { false };
    let bundled = resource.join("bundled-programs").join("Windows");
    validate_staged_package(&bundled, "Windows")
        .map_err(|error| format!("The installed Windows tools package is incomplete: {error}"))?;
    plain_path(programs)?;
    fs::create_dir_all(programs).map_err(|e| e.to_string())?;
    let stage = programs.join(unique_name("flowcell-windows-default"));
    fs::create_dir(&stage).map_err(|e| e.to_string())?;
    let result = (|| {
        for source in tree_paths(&bundled)? {
            let relative = source.strip_prefix(&bundled).map_err(|e| e.to_string())?;
            let destination = stage.join(relative);
            if source.is_dir() {
                fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
            } else {
                if let Some(parent) = destination.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                fs::copy(&source, &destination).map_err(|e| e.to_string())?;
            }
        }
        validate_staged_package(&stage, "Windows")?;
        let imported = commit_package_with_options(&stage, programs, "Windows",
            preserve_placeholder, super::filesystem::recycle_directory_path)?;
        if let Some(warning) = imported.cleanup_warning {
            crate::append_flowcell_local_log("windows-setup.log", &warning);
        }
        Ok(())
    })();
    if stage.exists() {
        // This is only the uncommitted temporary copy created above.
        let cleanup = tree_paths(&stage).and_then(|_| fs::remove_dir_all(&stage).map_err(|e| e.to_string()));
        if let Err(error) = cleanup {
            return Err(format!("Windows catalog setup: {result:?}. Temporary cleanup failed: {error}"));
        }
    }
    result
}

fn import_from_zip(zip_path: &Path, programs: &Path, window: Option<&tauri::WebviewWindow>) -> Result<ImportedProgramPackage, String> {
    let mut progress = super::programs::ProgramSetupProgress::new(window, "import", "");
    progress.stage("Waiting to import the program ZIP…", None);
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
        progress.stage("Extracting and checking the program ZIP…", None);
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
        let output = super::execution::run_program_setup_process(command, 60, "Program ZIP extraction")?;
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
        progress.set_program_name(&extracted.program_name);
        progress.stage("Validating the imported program…", None);
        validate_staged_package(&staged, &extracted.program_name)?;
        let mut imported = commit_package_with(
            &staged,
            programs,
            &extracted.program_name,
            super::filesystem::recycle_directory_path,
        )?;
        progress.stage("Reading the imported program’s panels and buttons…", None);
        // Inspect only this package. Refreshing all packages repeats unrelated
        // source validation and executable discovery after every ZIP import.
        let inventory = (|| {
            let root = Path::new(&imported.package_path);
            let mut manifest: ProgramManifest = serde_json::from_value(read_json(&root.join("flowcell.program.json"))?)
                .map_err(|error| format!("Invalid imported program manifest: {error}"))?;
            manifest::validate_manifest(&mut manifest, &imported.program_name, root)?;
            super::programs::validate_available_program_package_at(root, &manifest)
        })();
        match inventory {
            Ok(package) => imported.available_package = Some(package),
            Err(error) => imported.inventory_warning = Some(format!("The program ZIP was imported, but its setup options could not be read: {error}")),
        }
        progress.stage("Program ZIP imported.", None);
        Ok(imported)
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
    window: tauri::WebviewWindow,
    zip_path: String,
) -> Result<ImportedProgramPackage, String> {
    let programs = super::programs::resolve_programs_root()?;
    tauri::async_runtime::spawn_blocking(move || import_from_zip(Path::new(&zip_path), &programs, Some(&window)))
        .await
        .map_err(|e| format!("Program ZIP import did not finish: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn windows_bundle(resource: &Path) -> PathBuf {
        let bundle = resource.join("bundled-programs/Windows");
        fs::create_dir_all(bundle.join("Catalog")).unwrap();
        fs::create_dir_all(bundle.join("Support")).unwrap();
        let manifest = serde_json::json!({"schemaVersion":1,"programId":"windows","label":"Windows","programType":"local-script",
            "processNames":["explorer"],"gitScriptsFolder":"Catalog","panelsFolder":"Panels","localScriptsFolder":"Owned",
            "supportScriptsFolder":"Support","allowedScriptExtensions":["ps1"],"runner":{"kind":"windows-script"}});
        fs::write(bundle.join("flowcell.program.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
        fs::write(bundle.join("Catalog/action.ps1"), "throw 'catalog scripts must not execute at startup'").unwrap();
        bundle
    }

    fn write_inventory(root: &Path, program_id: &str) -> Value {
        let mut files = serde_json::Map::new();
        for path in tree_paths(root).unwrap().into_iter().filter(|path| path.is_file()) {
            let relative = path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
            if relative == PACKAGE_INVENTORY_FILE { continue; }
            let bytes = fs::read(path).unwrap();
            files.insert(relative, serde_json::json!({"bytes":bytes.len(),"sha256":format!("{:x}",Sha256::digest(&bytes))}));
        }
        let inventory = serde_json::json!({"schemaVersion":1,"programId":program_id,"files":files});
        fs::write(root.join(PACKAGE_INVENTORY_FILE), serde_json::to_vec(&inventory).unwrap()).unwrap();
        inventory
    }

    #[test]
    fn package_inventory_detects_changed_missing_and_unlisted_files_before_commit() {
        let root = temporary();
        let bundle = windows_bundle(&root);
        validate_staged_package(&bundle, "Windows").expect("legacy catalogs remain supported");
        let source = bundle.join("Catalog/action.ps1");
        fs::write(&source, b"original").unwrap();
        write_inventory(&bundle, "windows");
        validate_staged_package(&bundle, "Windows").unwrap();

        fs::write(&source, b"modified").unwrap();
        assert!(validate_staged_package(&bundle, "Windows").unwrap_err().contains("SHA-256"));
        fs::write(&source, b"size changed").unwrap();
        assert!(validate_staged_package(&bundle, "Windows").unwrap_err().contains("size validation"));
        fs::write(&source, b"original").unwrap();
        fs::write(bundle.join("Support/unlisted.txt"), b"untracked addition").unwrap();
        assert!(validate_staged_package(&bundle, "Windows").unwrap_err().contains("unlisted file"));
        fs::remove_file(bundle.join("Support/unlisted.txt")).unwrap();
        fs::remove_file(source).unwrap();
        assert!(validate_staged_package(&bundle, "Windows").unwrap_err().contains("missing an inventoried file"));
        assert!(!root.join("Programs").exists());
        fs::remove_dir_all(root).expect("remove only this task-created test fixture");
    }

    #[test]
    fn package_inventory_rejects_future_schemas_wrong_programs_and_ambiguous_paths() {
        let root = temporary();
        let bundle = windows_bundle(&root);
        let original = write_inventory(&bundle, "windows");
        let write = |value: &Value| fs::write(bundle.join(PACKAGE_INVENTORY_FILE), serde_json::to_vec(value).unwrap()).unwrap();
        let mut invalid = original.clone(); invalid["schemaVersion"] = 2.into(); write(&invalid);
        assert!(validate_staged_package(&bundle, "Windows").unwrap_err().contains("schemaVersion 2"));
        let mut invalid = original.clone(); invalid["programId"] = "different".into(); write(&invalid);
        assert!(validate_staged_package(&bundle, "Windows").unwrap_err().contains("different Program"));
        let mut invalid = original.clone(); invalid["newRequiredCapability"] = true.into(); write(&invalid);
        assert!(validate_staged_package(&bundle, "Windows").unwrap_err().contains("unknown field"));
        let mut invalid = original.clone(); invalid["files"]["Catalog/action.ps1"]["bytes"] = (-1).into(); write(&invalid);
        assert!(validate_staged_package(&bundle, "Windows").unwrap_err().contains("Invalid Program package inventory"));
        for path in ["../escape", "C:/escape", "Catalog\\action.ps1", "Catalog//action.ps1", "Catalog/./action.ps1",
            "Catalog/NUL.txt", "Catalog/a:stream", "Catalog/CONIN$", "Catalog/COM¹.txt", "Catalog/trailing.", "Catalog/trailing ",
            "catalog/action.ps1", "flowcell.package.json"] {
            let mut invalid = original.clone();
            invalid["files"][path] = original["files"]["Catalog/action.ps1"].clone(); write(&invalid);
            assert!(validate_staged_package(&bundle, "Windows").is_err(), "accepted {path}");
        }
        let mut invalid = original; invalid["files"]["Catalog/action.ps1"]["sha256"] = "A".repeat(64).into(); write(&invalid);
        assert!(validate_staged_package(&bundle, "Windows").unwrap_err().contains("invalid SHA-256"));
        assert!(!root.join("Programs").exists());
        fs::remove_dir_all(root).expect("remove only this task-created test fixture");
    }

    #[test]
    fn packaged_appearance_versions_and_dependencies_are_checked_before_commit() {
        let root = temporary();
        let bundle = windows_bundle(&root);
        let manifest_path = bundle.join("flowcell.program.json");
        let mut manifest = read_json(&manifest_path).unwrap();
        manifest["defaultTheme"] = "Support/appearance.json".into();
        manifest["bundledSources"] = serde_json::json!([{"id":"windows.action","version":"1.0.0","panelName":"Tools", "sourcePath":"Catalog/action.ps1","importKind":"script"}]);
        fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        let appearance_path = bundle.join("Support/appearance.json");
        let valid = serde_json::json!({"kind":"FlowCellPortableTheme","version":1,
            "target":{"kind":"program","programName":"Windows","panelName":null},"contributions":{},
            "dependencies":[{"id":"source-0","programId":"windows","programName":"Windows","panelName":"Tools",
                "sourceId":"windows.action","sourceVersion":"1.0.0","importKind":"script"}]});
        fs::write(&appearance_path, serde_json::to_vec(&valid).unwrap()).unwrap();
        validate_staged_package(&bundle, "Windows").unwrap();
        let mut invalid = valid.clone(); invalid["version"] = 2.into();
        fs::write(&appearance_path, serde_json::to_vec(&invalid).unwrap()).unwrap();
        assert!(validate_staged_package(&bundle, "Windows").unwrap_err().contains("Unsupported portable theme"));
        let mut invalid = valid; invalid["dependencies"][0]["sourceVersion"] = "2.0.0".into();
        fs::write(&appearance_path, serde_json::to_vec(&invalid).unwrap()).unwrap();
        assert!(validate_staged_package(&bundle, "Windows").unwrap_err().contains("matching packaged source"));
        fs::write(&appearance_path, br#"{"kind":"FlowCellProgramAppearance","version":2}"#).unwrap();
        assert!(validate_staged_package(&bundle, "Windows").unwrap_err().contains("Unsupported packaged Program appearance"));
        fs::write(&appearance_path, b"not json").unwrap();
        assert!(validate_staged_package(&bundle, "Windows").is_err());
        assert!(!root.join("Programs").exists());
        fs::remove_dir_all(root).expect("remove only this task-created test fixture");
    }

    #[test]
    fn bundled_windows_catalog_is_seeded_as_inert_data_and_existing_edits_survive() {
        let root = temporary();
        let bundle = windows_bundle(&root);
        let programs = root.join("user/Programs");
        seed_installed_windows_catalog(&root, &programs).unwrap();
        let target = programs.join("Windows");
        assert_eq!(fs::read(bundle.join("flowcell.program.json")).unwrap(), fs::read(target.join("flowcell.program.json")).unwrap());
        assert!(!target.join("Panels").exists());
        assert!(!target.join("Owned").exists());
        fs::write(target.join("Catalog/action.ps1"), "user change").unwrap();
        seed_installed_windows_catalog(&root, &programs).unwrap();
        assert_eq!(fs::read_to_string(target.join("Catalog/action.ps1")).unwrap(), "user change");
        assert!(fs::read_to_string(bundle.join("Catalog/action.ps1")).unwrap().starts_with("throw"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bundled_windows_rejects_incomplete_payload_and_preserves_unrecognized_user_files() {
        let root = temporary();
        let programs = root.join("user/Programs");
        assert!(seed_installed_windows_catalog(&root, &programs).is_err());
        assert!(!programs.exists());
        windows_bundle(&root);
        fs::create_dir_all(programs.join("Windows/Panels/Startup")).unwrap();
        fs::write(programs.join("Windows/Panels/Startup/personal.txt"), "keep").unwrap();
        assert!(seed_installed_windows_catalog(&root, &programs).is_err());
        assert_eq!(fs::read_to_string(programs.join("Windows/Panels/Startup/personal.txt")).unwrap(), "keep");
        assert!(!programs.join("Windows/flowcell.program.json").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn windows_default_commit_does_not_install_an_unselected_legacy_startup_panel() {
        let root = temporary();
        let programs = root.join("Programs");
        fs::create_dir_all(programs.join("Windows/Panels/Startup")).unwrap();
        let staged = windows_bundle(&root);
        let mut recycled_placeholder = false;
        commit_package_with_options(&staged, &programs, "Windows", false, |backup| {
            assert!(backup.join("Panels/Startup").is_dir());
            recycled_placeholder = true;
            fs::remove_dir_all(backup).map_err(|e| e.to_string())
        }).unwrap();
        assert!(recycled_placeholder);
        assert!(!programs.join("Windows/Panels").exists());
        assert!(programs.join("Windows/flowcell.program.json").is_file());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn cloud_directory_tags_allow_placeholders_but_not_links_or_files() {
        for variant in 0..16 {
            let tag = 0x9000001a | (variant << 12);
            assert!(is_cloud_directory_tag(0x410, tag));
            assert!(
                !is_cloud_directory_tag(0x400, tag),
                "cloud files remain rejected"
            );
            assert!(!is_cloud_directory_tag(0x10, tag));
        }
        for tag in [0xa0000003, 0xa000000c, 0x8000001b, 0, 0x9001001a] {
            assert!(!is_cloud_directory_tag(0x410, tag));
        }
    }

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
                let imported = import_from_zip(archive, &programs, None)?;
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
