use crate::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OrganizationLooseFileInfo {
    path: String,
    file_name: String,
    extension: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OrganizationProjectScan {
    project_root: String,
    folders: Vec<String>,
    loose_files: Vec<OrganizationLooseFileInfo>,
}

fn resolve_organization_project_root(project_root: &str) -> Result<PathBuf, String> {
    let trimmed = project_root.trim().trim_matches('"');
    if trimmed.is_empty() {
        return Err("Choose a project root first.".to_string());
    }

    let root = PathBuf::from(trimmed);
    if !root.is_absolute() {
        return Err("Project root must be an absolute folder path.".to_string());
    }
    if !root.is_dir() {
        return Err(format!("Project folder does not exist: {}", root.display()));
    }

    Ok(root)
}

// The organization profile is a single visible file at the project root,
// alongside the organizer's other organize-folder.* sidecars. No hidden
// .flowcell folder is created.
fn organization_profile_path(project_root: &Path) -> PathBuf {
    project_root.join("organize-folder.profile.json")
}

// Older profiles lived in a .flowcell folder; read them as a fallback so
// existing setups keep working until the next save migrates them.
fn legacy_organization_profile_path(project_root: &Path) -> PathBuf {
    project_root
        .join(".flowcell")
        .join("organization-profile.json")
}

// Files the organizer manages itself — they must never be listed as loose
// files or organized into folders.
fn is_organization_sidecar_file(file_name: &str) -> bool {
    file_name.to_lowercase().starts_with("organize-folder.")
}

#[tauri::command]
pub(crate) fn scan_organization_project(
    project_root: String,
) -> Result<OrganizationProjectScan, String> {
    let root = resolve_organization_project_root(&project_root)?;
    let mut folders = vec![".".to_string()];
    let mut loose_files = Vec::new();
    let mut pending_directories = vec![root.clone()];

    while let Some(directory) = pending_directories.pop() {
        let mut entries = fs::read_dir(&directory)
            .map_err(|error| format!("Unable to scan {}: {error}", directory.display()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Unable to scan {}: {error}", directory.display()))?;
        entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());

        for entry in entries {
            let path = entry.path();
            let file_type = entry
                .file_type()
                .map_err(|error| format!("Unable to inspect {}: {error}", path.display()))?;

            if file_type.is_dir() && !file_type.is_symlink() {
                // Skip FlowCell's legacy metadata folder so it never shows in
                // the Project Tree.
                if directory == root && entry.file_name().to_string_lossy() == ".flowcell" {
                    continue;
                }
                let relative = path
                    .strip_prefix(&root)
                    .map_err(|error| {
                        format!("Unable to make {} relative: {error}", path.display())
                    })?
                    .to_string_lossy()
                    .replace('\\', "/");
                folders.push(relative);
                pending_directories.push(path);
                continue;
            }

            if directory == root && file_type.is_file() {
                let file_name = entry.file_name().to_string_lossy().to_string();
                if is_organization_sidecar_file(&file_name) {
                    continue;
                }
                let extension = path
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(|value| format!(".{}", value.to_lowercase()))
                    .unwrap_or_default();
                loose_files.push(OrganizationLooseFileInfo {
                    path: path.display().to_string(),
                    file_name,
                    extension,
                });
            }
        }
    }

    folders.sort_by_key(|folder| folder.to_lowercase());
    if let Some(root_index) = folders.iter().position(|folder| folder == ".") {
        folders.swap(0, root_index);
    }
    loose_files.sort_by_key(|file| file.file_name.to_lowercase());

    Ok(OrganizationProjectScan {
        project_root: root.display().to_string(),
        folders,
        loose_files,
    })
}

#[tauri::command]
pub(crate) fn read_organization_profile(project_root: String) -> Result<Option<Value>, String> {
    let root = resolve_organization_project_root(&project_root)?;
    let profile_path = if organization_profile_path(&root).is_file() {
        organization_profile_path(&root)
    } else if legacy_organization_profile_path(&root).is_file() {
        legacy_organization_profile_path(&root)
    } else {
        return Ok(None);
    };

    let contents = fs::read_to_string(&profile_path).map_err(|error| {
        format!(
            "Unable to read organization profile at {}: {error}",
            profile_path.display()
        )
    })?;
    // Strip a leading UTF-8 BOM — PowerShell's Set-Content -Encoding UTF8 writes
    // one, and serde_json otherwise fails with "expected value at line 1 column 1".
    let profile = serde_json::from_str::<Value>(contents.trim_start_matches('\u{feff}')).map_err(
        |error| {
            format!(
                "Organization profile at {} is not valid JSON: {error}",
                profile_path.display()
            )
        },
    )?;

    if !profile.is_object() {
        return Err(format!(
            "Organization profile at {} must contain a JSON object.",
            profile_path.display()
        ));
    }

    Ok(Some(profile))
}

#[tauri::command]
pub(crate) fn write_organization_profile(
    project_root: String,
    mut profile: Value,
) -> Result<String, String> {
    let root = resolve_organization_project_root(&project_root)?;
    let profile_object = profile
        .as_object_mut()
        .ok_or_else(|| "Organization profile must be a JSON object.".to_string())?;

    if profile_object.get("profileVersion").and_then(Value::as_u64) != Some(1) {
        return Err("Organization profileVersion must be 1.".to_string());
    }
    if !profile_object.get("roles").is_some_and(Value::is_array) {
        return Err("Organization profile roles must be an array.".to_string());
    }
    if !profile_object
        .get("programFolders")
        .is_some_and(Value::is_array)
    {
        return Err("Organization profile programFolders must be an array.".to_string());
    }

    profile_object.insert(
        "projectRoot".to_string(),
        Value::String(root.display().to_string()),
    );

    let profile_path = organization_profile_path(&root);
    let profile_folder = profile_path
        .parent()
        .ok_or_else(|| "Unable to resolve the organization profile folder.".to_string())?;
    fs::create_dir_all(profile_folder).map_err(|error| {
        format!(
            "Unable to create organization profile folder at {}: {error}",
            profile_folder.display()
        )
    })?;
    let serialized = format!(
        "{}\n",
        serde_json::to_string_pretty(&profile)
            .map_err(|error| format!("Unable to serialize organization profile: {error}"))?
    );
    fs::write(&profile_path, serialized).map_err(|error| {
        format!(
            "Unable to write organization profile at {}: {error}",
            profile_path.display()
        )
    })?;

    Ok(profile_path.display().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OrganizationProfileSummary {
    name: String,
    path: String,
}

// The empty folder skeletons (folder structure only) live here.
fn resolve_folder_trees_root() -> Result<PathBuf, String> {
    Ok(resolve_flowcell_local_root()?.join("Folder Trees"))
}

// The profile data (roles, file-type assignments, etc.) lives here, kept
// separate from the folder structure on purpose.
fn resolve_folder_tree_profiles_root() -> Result<PathBuf, String> {
    Ok(resolve_flowcell_local_root()?.join("Folder Tree Profiles"))
}

fn folder_tree_profile_path(name: &str) -> Result<PathBuf, String> {
    Ok(resolve_folder_tree_profiles_root()?.join(format!("{name}.json")))
}

// Create the empty folder skeleton from an explicit list of relative folder
// paths (the project's actual folder structure). Nothing else is created here —
// no .flowcell folder, no per-role folders.
fn materialize_folder_tree(target: &Path, folders: &[String]) -> Result<(), String> {
    for folder in folders {
        let normalized = folder.replace('\\', "/");
        let mut directory = target.to_path_buf();
        let mut has_component = false;
        let mut first = true;
        let mut skip = false;
        for component in normalized.split('/') {
            let part = component.trim();
            if part.is_empty() || part == "." {
                continue;
            }
            if part == ".." {
                return Err(format!("Folder path is not allowed: {folder}"));
            }
            // Never recreate FlowCell's own metadata folder in the skeleton.
            if first && part.eq_ignore_ascii_case(".flowcell") {
                skip = true;
                break;
            }
            first = false;
            directory.push(part);
            has_component = true;
        }
        if skip || !has_component {
            continue;
        }
        fs::create_dir_all(&directory).map_err(|error| {
            format!(
                "Unable to create folder at {}: {error}",
                directory.display()
            )
        })?;
    }
    Ok(())
}

// Every subdirectory under `base`, as relative forward-slash paths.
fn list_relative_subdirectories(base: &Path) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut pending = vec![base.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries {
            let entry =
                entry.map_err(|error| format!("Failed to read {}: {error}", dir.display()))?;
            let file_type = entry.file_type().map_err(|error| {
                format!("Failed to inspect {}: {error}", entry.path().display())
            })?;
            if file_type.is_dir() && !file_type.is_symlink() {
                let path = entry.path();
                if let Ok(relative) = path.strip_prefix(base) {
                    let relative = relative.to_string_lossy().replace('\\', "/");
                    if !relative.is_empty() {
                        out.push(relative);
                    }
                }
                pending.push(path);
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub(crate) fn list_organization_profiles() -> Result<Vec<OrganizationProfileSummary>, String> {
    let profiles_root = resolve_folder_tree_profiles_root()?;
    if !profiles_root.is_dir() {
        return Ok(Vec::new());
    }

    let trees_root = resolve_folder_trees_root()?;
    let mut summaries = Vec::new();
    let entries = fs::read_dir(&profiles_root)
        .map_err(|error| format!("Failed to read {}: {error}", profiles_root.display()))?;
    for entry in entries {
        let entry = entry
            .map_err(|error| format!("Failed to read {}: {error}", profiles_root.display()))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Some(name) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        summaries.push(OrganizationProfileSummary {
            name: name.to_string(),
            path: trees_root.join(name).display().to_string(),
        });
    }
    summaries.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(summaries)
}

#[tauri::command]
pub(crate) fn read_organization_profile_named(name: String) -> Result<Option<Value>, String> {
    let safe_name = validate_folder_name(&name, "Profile")?;
    let profile_path = folder_tree_profile_path(&safe_name)?;
    if !profile_path.is_file() {
        return Ok(None);
    }

    let contents = fs::read_to_string(&profile_path).map_err(|error| {
        format!(
            "Unable to read profile at {}: {error}",
            profile_path.display()
        )
    })?;
    // Strip a leading UTF-8 BOM — PowerShell's Set-Content -Encoding UTF8 writes
    // one, and serde_json otherwise fails with "expected value at line 1 column 1".
    let profile = serde_json::from_str::<Value>(contents.trim_start_matches('\u{feff}')).map_err(
        |error| {
            format!(
                "Profile at {} is not valid JSON: {error}",
                profile_path.display()
            )
        },
    )?;
    if !profile.is_object() {
        return Err(format!(
            "Profile at {} must contain a JSON object.",
            profile_path.display()
        ));
    }
    Ok(Some(profile))
}

#[tauri::command]
pub(crate) fn save_organization_profile_as(
    name: String,
    mut profile: Value,
    folders: Vec<String>,
) -> Result<String, String> {
    let safe_name = validate_folder_name(&name, "Profile")?;

    // 1. Build the clean, empty folder skeleton from the project's folders.
    let trees_root = resolve_folder_trees_root()?;
    fs::create_dir_all(&trees_root).map_err(|error| {
        format!(
            "Unable to create Folder Trees folder at {}: {error}",
            trees_root.display()
        )
    })?;
    let tree_dir = trees_root.join(&safe_name);
    // Reset the skeleton so re-saving never leaves stale folders. Per AGENTS.md
    // the old copy goes to the Recycle Bin (recoverable), never a permanent delete.
    if tree_dir.is_dir() {
        recycle_directory_path(&tree_dir)?;
    }
    fs::create_dir_all(&tree_dir).map_err(|error| {
        format!(
            "Unable to create folder tree at {}: {error}",
            tree_dir.display()
        )
    })?;
    materialize_folder_tree(&tree_dir, &folders)?;

    // 2. Save the profile data separately, pointing its project root at the
    //    skeleton so loading scans the empty tree.
    let profiles_root = resolve_folder_tree_profiles_root()?;
    fs::create_dir_all(&profiles_root).map_err(|error| {
        format!(
            "Unable to create Folder Tree Profiles folder at {}: {error}",
            profiles_root.display()
        )
    })?;

    let profile_object = profile
        .as_object_mut()
        .ok_or_else(|| "Organization profile must be a JSON object.".to_string())?;
    if profile_object.get("profileVersion").and_then(Value::as_u64) != Some(1) {
        return Err("Organization profileVersion must be 1.".to_string());
    }
    if !profile_object.get("roles").is_some_and(Value::is_array) {
        return Err("Organization profile roles must be an array.".to_string());
    }
    if !profile_object
        .get("programFolders")
        .is_some_and(Value::is_array)
    {
        return Err("Organization profile programFolders must be an array.".to_string());
    }
    profile_object.insert(
        "projectRoot".to_string(),
        Value::String(tree_dir.display().to_string()),
    );

    let profile_path = folder_tree_profile_path(&safe_name)?;
    let serialized = format!(
        "{}\n",
        serde_json::to_string_pretty(&profile)
            .map_err(|error| format!("Unable to serialize profile: {error}"))?
    );
    fs::write(&profile_path, serialized).map_err(|error| {
        format!(
            "Unable to write profile at {}: {error}",
            profile_path.display()
        )
    })?;

    Ok(tree_dir.display().to_string())
}

// Apply a saved profile to an arbitrary, existing project root: recreate its
// skeleton, write organize-folder.profile.json, then run the profile's
// conditional program-folder organization rules.
#[tauri::command]
pub(crate) fn apply_organization_profile_to_root(
    name: String,
    project_root: String,
) -> Result<String, String> {
    let safe_name = validate_folder_name(&name, "Profile")?;
    let root = resolve_organization_project_root(&project_root)?;

    if !folder_tree_profile_path(&safe_name)?.is_file() {
        return Err(format!("Profile \"{safe_name}\" was not found."));
    }

    let repo_root = resolve_repo_root()
        .ok_or_else(|| "FlowCell repo root could not be resolved.".to_string())?;
    let core_path = repo_root
        .join("Programs")
        .join("Windows")
        .join("SupportScripts")
        .join("Apply-OrganizationProfileCore.ps1");
    if !core_path.is_file() {
        return Err(format!(
            "Apply Organization Profile core was not found: {}",
            core_path.display()
        ));
    }

    let arguments = vec![
        "-File".to_string(),
        core_path.display().to_string(),
        "-ProfileName".to_string(),
        safe_name,
        "-ProjectPath".to_string(),
        root.display().to_string(),
        "-PassThruJson".to_string(),
    ];
    let output = spawn_powershell_output(&arguments)?;
    if !output.status.success() {
        return Err(format_process_failure(
            &output,
            "Failed to apply the organization profile.",
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let result = serde_json::from_str::<Value>(&stdout)
        .map_err(|error| format!("Apply Organization Profile returned invalid JSON: {error}"))?;
    result
        .get("profilePath")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Apply Organization Profile did not return profilePath.".to_string())
}

// Build a saved profile's folder structure inside any existing folder (no
// profile file is written). Used to apply a profile to a selected subfolder.
#[tauri::command]
pub(crate) fn apply_organization_profile_folders(
    name: String,
    target_path: String,
) -> Result<String, String> {
    let safe_name = validate_folder_name(&name, "Profile")?;
    let target = resolve_organization_project_root(&target_path)?;
    let skeleton = resolve_folder_trees_root()?.join(&safe_name);
    if skeleton.is_dir() {
        let folders = list_relative_subdirectories(&skeleton)?;
        materialize_folder_tree(&target, &folders)?;
    }
    Ok(target.display().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OrganizationProfileCatalogManifest {
    schema_version: u32,
    id: String,
    label: String,
    tooltip: String,
    program: String,
    source: String,
}

fn organization_profile_script_slug(profile_name: &str) -> String {
    let raw: String = profile_name
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = raw.trim_matches('_');
    if trimmed.is_empty() {
        "profile".to_string()
    } else {
        trimmed.to_string()
    }
}

fn render_organization_profile_script(profile_name: &str) -> String {
    let escaped_name = profile_name.replace('\'', "''");
    let template = r##"# Description: Apply "__DESC_NAME__" profile to the clipboard folder.
param([string]$ProjectPath = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProfileName = '__PROFILE_NAME_ESCAPED__'

function Find-FlowCellRoot([string]$StartPath) {
    $current = [System.IO.Path]::GetFullPath($StartPath)
    while (-not [string]::IsNullOrWhiteSpace($current) -and (Test-Path -LiteralPath $current -PathType Container)) {
        if ((Test-Path -LiteralPath (Join-Path $current 'PROGRAM_SUMMARY.txt') -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $current 'flowcellbackend') -PathType Container)) { return $current }
        $parent = Split-Path -Parent $current
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current) { break }
        $current = $parent
    }
    throw 'Could not locate the FlowCell repository root from this script location.'
}

function Get-ClipboardProjectPath {
    try { $text = Get-Clipboard -Raw -ErrorAction Stop } catch { return '' }
    $candidate = ([string]$text).Trim().Trim('"')
    if ([string]::IsNullOrWhiteSpace($candidate)) { return '' }
    if (Test-Path -LiteralPath $candidate -PathType Container) { return (Get-Item -LiteralPath $candidate).FullName }
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return (Split-Path -Parent (Get-Item -LiteralPath $candidate).FullName) }
    return ''
}

function Write-FlowCellStatus([string]$Message) {
    try {
        $repo = Find-FlowCellRoot -StartPath $PSScriptRoot
        $statusPath = Join-Path $repo 'flowcellbackend\local\logs\last_action_status.txt'
        New-Item -ItemType Directory -Path (Split-Path -Parent $statusPath) -Force | Out-Null
        Set-Content -LiteralPath $statusPath -Value $Message -Encoding UTF8
    } catch { }
}

try {
    $repo = Find-FlowCellRoot -StartPath $PSScriptRoot
    $core = Join-Path $PSScriptRoot 'Apply-OrganizationProfileCore.ps1'
    if (-not (Test-Path -LiteralPath $core -PathType Leaf)) { throw "Apply profile core not found: $core" }
    if ([string]::IsNullOrWhiteSpace($ProjectPath)) { $ProjectPath = Get-ClipboardProjectPath }
    if ([string]::IsNullOrWhiteSpace($ProjectPath)) { throw 'Copy a destination folder path to the clipboard first, then run this.' }

    $json = & $core -ProfileName $ProfileName -ProjectPath $ProjectPath -PassThruJson
    $result = $json | ConvertFrom-Json
    $message = @(
        "Applied profile: $ProfileName",
        "Target: $($result.projectRoot)",
        "Folders ensured: $($result.foldersCreated)",
        "Program folders created: $(@($result.programFoldersCreated).Count)",
        "Program folders reused: $(@($result.programFoldersUsed).Count)",
        "Files moved: $($result.filesMoved)",
        "Snapshots created: $($result.snapshotsCreated)",
        "Conflicts: $(@($result.conflicts).Count)"
    ) -join [Environment]::NewLine
    Write-FlowCellStatus $message
    $message
    exit 0
}
catch {
    Write-FlowCellStatus $_.Exception.Message
    Write-Error $_.Exception.Message
    exit 1
}
"##;

    template
        .replace("__DESC_NAME__", profile_name)
        .replace("__PROFILE_NAME_ESCAPED__", &escaped_name)
}

fn render_organization_profile_manifest(
    profile_name: &str,
    slug: &str,
    script_name: &str,
) -> Result<String, String> {
    let manifest = OrganizationProfileCatalogManifest {
        schema_version: 1,
        id: format!("windows.organization-profile.{}", slug.replace('_', "-")),
        label: profile_name.to_string(),
        tooltip: format!(
            "Apply the saved '{profile_name}' organization profile to the clipboard folder."
        ),
        program: "Windows".to_string(),
        source: script_name.to_string(),
    };
    Ok(format!(
        "{}\n",
        serde_json::to_string_pretty(&manifest)
            .map_err(|error| format!("Unable to serialize profile script manifest: {error}"))?
    ))
}

fn remove_temporary_catalog_package(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| {
            format!(
                "Unable to clean temporary catalog package {}: {error}",
                path.display()
            )
        })?;
    } else if path.exists() {
        fs::remove_file(path).map_err(|error| {
            format!(
                "Unable to clean temporary catalog file {}: {error}",
                path.display()
            )
        })?;
    }
    Ok(())
}

fn catalog_package_matches(
    package_path: &Path,
    script_name: &str,
    script: &[u8],
    core: &[u8],
    manifest: &[u8],
) -> bool {
    let Ok(entries) = fs::read_dir(package_path) else {
        return false;
    };
    let Ok(entries) = entries.collect::<Result<Vec<_>, _>>() else {
        return false;
    };
    if entries.len() != 3
        || entries.iter().any(|entry| {
            entry
                .file_type()
                .map(|file_type| !file_type.is_file() || file_type.is_symlink())
                .unwrap_or(true)
        })
    {
        return false;
    }

    let expected = [
        (script_name, script),
        ("Apply-OrganizationProfileCore.ps1", core),
        ("flowcell.script.json", manifest),
    ];
    expected.iter().all(|(name, contents)| {
        fs::read(package_path.join(name))
            .map(|actual| catalog_text_matches(&actual, contents))
            .unwrap_or(false)
    })
}

fn catalog_text_matches(actual: &[u8], expected: &[u8]) -> bool {
    if actual == expected {
        return true;
    }
    let (Ok(actual), Ok(expected)) = (std::str::from_utf8(actual), std::str::from_utf8(expected))
    else {
        return false;
    };
    actual.replace("\r\n", "\n") == expected.replace("\r\n", "\n")
}

fn write_organization_profile_catalog_package(
    scripts_dir: &Path,
    profile_name: &str,
    core_path: &Path,
) -> Result<PathBuf, String> {
    let slug = organization_profile_script_slug(profile_name);
    let script_name = format!("apply_profile_{slug}.ps1");
    let package_path = scripts_dir.join(format!("Apply Profile {profile_name}"));
    let legacy_script_path = scripts_dir.join(&script_name);
    let staging_path = scripts_dir.join(format!(".{slug}.flowcell-writing"));
    let previous_path = scripts_dir.join(format!(".{slug}.flowcell-previous"));

    remove_temporary_catalog_package(&staging_path)?;
    if previous_path.exists() {
        if package_path.exists() {
            recycle_directory_path(&previous_path)?;
        } else {
            fs::rename(&previous_path, &package_path).map_err(|error| {
                format!(
                    "Unable to restore the previous catalog package at {}: {error}",
                    package_path.display()
                )
            })?;
        }
    }
    if package_path.exists() && !package_path.is_dir() {
        return Err(format!(
            "Organization profile package path is not a folder: {}",
            package_path.display()
        ));
    }

    let script = render_organization_profile_script(profile_name);
    let core = fs::read(core_path).map_err(|error| {
        format!(
            "Unable to read Apply Organization Profile core at {}: {error}",
            core_path.display()
        )
    })?;
    let manifest = render_organization_profile_manifest(profile_name, &slug, &script_name)?;

    if catalog_package_matches(
        &package_path,
        &script_name,
        script.as_bytes(),
        &core,
        manifest.as_bytes(),
    ) {
        if legacy_script_path.is_file() {
            recycle_file_path(&legacy_script_path)?;
        }
        return Ok(package_path);
    }

    fs::create_dir_all(&staging_path).map_err(|error| {
        format!(
            "Unable to stage profile catalog package at {}: {error}",
            staging_path.display()
        )
    })?;
    let staged_script_path = staging_path.join(&script_name);
    if let Err(error) = fs::write(&staged_script_path, script.as_bytes()) {
        let _ = remove_temporary_catalog_package(&staging_path);
        return Err(format!(
            "Unable to stage profile script at {}: {error}",
            staged_script_path.display()
        ));
    }
    let staged_core_path = staging_path.join("Apply-OrganizationProfileCore.ps1");
    if let Err(error) = fs::write(&staged_core_path, &core) {
        let _ = remove_temporary_catalog_package(&staging_path);
        return Err(format!(
            "Unable to stage profile core at {}: {error}",
            staged_core_path.display()
        ));
    }
    let staged_manifest_path = staging_path.join("flowcell.script.json");
    if let Err(error) = fs::write(&staged_manifest_path, manifest.as_bytes()) {
        let _ = remove_temporary_catalog_package(&staging_path);
        return Err(format!(
            "Unable to stage profile manifest at {}: {error}",
            staged_manifest_path.display()
        ));
    }

    let had_existing = package_path.is_dir();
    if had_existing {
        fs::rename(&package_path, &previous_path).map_err(|error| {
            let _ = remove_temporary_catalog_package(&staging_path);
            format!(
                "Unable to prepare catalog package {} for replacement: {error}",
                package_path.display()
            )
        })?;
    }
    if let Err(error) = fs::rename(&staging_path, &package_path) {
        if had_existing {
            let _ = fs::rename(&previous_path, &package_path);
        }
        let _ = remove_temporary_catalog_package(&staging_path);
        return Err(format!(
            "Unable to commit profile catalog package at {}: {error}",
            package_path.display()
        ));
    }
    if had_existing {
        if let Err(recycle_error) = recycle_directory_path(&previous_path) {
            let rollback_path = staging_path;
            let moved_new_package = fs::rename(&package_path, &rollback_path).is_ok();
            let restored_previous = fs::rename(&previous_path, &package_path).is_ok();
            if moved_new_package && restored_previous {
                let _ = remove_temporary_catalog_package(&rollback_path);
            } else if moved_new_package && !restored_previous {
                let _ = fs::rename(&rollback_path, &package_path);
            }
            return Err(format!(
                "Could not recycle the previous profile catalog package: {recycle_error}"
            ));
        }
    }
    if legacy_script_path.is_file() {
        recycle_file_path(&legacy_script_path)?;
    }

    Ok(package_path)
}

// Generate a complete Windows Git Script package that applies a saved profile
// to the clipboard folder. Add/Update copies the whole package into the owner
// Button's Local Scripts source, including its immutable adjacent core helper.
#[tauri::command]
pub(crate) fn make_organization_profile_script(name: String) -> Result<String, String> {
    let safe_name = validate_folder_name(&name, "Profile")?;

    if !folder_tree_profile_path(&safe_name)?.is_file() {
        return Err(format!(
            "Save the profile \"{safe_name}\" first, then Make Script."
        ));
    }

    let scripts_dir = resolve_program_git_scripts_directory("Windows")?.join("Files");
    fs::create_dir_all(&scripts_dir).map_err(|error| {
        format!(
            "Unable to create scripts folder at {}: {error}",
            scripts_dir.display()
        )
    })?;
    let repo_root = resolve_repo_root()
        .ok_or_else(|| "FlowCell repo root could not be resolved.".to_string())?;
    let core_path = repo_root
        .join("Programs")
        .join("Windows")
        .join("SupportScripts")
        .join("Apply-OrganizationProfileCore.ps1");
    if !core_path.is_file() {
        return Err(format!(
            "Apply Organization Profile core was not found: {}",
            core_path.display()
        ));
    }

    write_organization_profile_catalog_package(&scripts_dir, &safe_name, &core_path)
        .map(|path| path.display().to_string())
}

// Resolve a relative folder path under a project root, rejecting traversal and
// the root itself.
fn resolve_organization_subfolder(project_root: &Path, relative: &str) -> Result<PathBuf, String> {
    let normalized = relative.replace('\\', "/");
    let mut directory = project_root.to_path_buf();
    let mut has_component = false;
    for component in normalized.split('/') {
        let part = component.trim();
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err(format!("Folder path is not allowed: {relative}"));
        }
        directory.push(part);
        has_component = true;
    }
    if !has_component {
        return Err("Choose a folder other than the project root.".to_string());
    }
    Ok(directory)
}

#[tauri::command]
pub(crate) fn create_organization_folder(
    project_root: String,
    relative_path: String,
) -> Result<String, String> {
    let root = resolve_organization_project_root(&project_root)?;
    let directory = resolve_organization_subfolder(&root, &relative_path)?;
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Unable to create folder at {}: {error}",
            directory.display()
        )
    })?;
    Ok(directory.display().to_string())
}

// Delete a folder under the project root by sending it to the Recycle Bin.
#[tauri::command]
pub(crate) fn recycle_organization_folder(
    project_root: String,
    relative_path: String,
) -> Result<(), String> {
    let root = resolve_organization_project_root(&project_root)?;
    let directory = resolve_organization_subfolder(&root, &relative_path)?;
    if directory.is_dir() {
        recycle_directory_path(&directory)?;
    }
    Ok(())
}

// Best-effort restore of a folder from the Recycle Bin back to its original
// location, by absolute path. Used to undo a delete.
#[tauri::command]
pub(crate) fn restore_recycled_folder(path: String) -> Result<(), String> {
    let full = PathBuf::from(path.trim());
    if full.is_dir() {
        return Ok(());
    }
    let parent = full
        .parent()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    let name = full
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    if parent.is_empty() || name.is_empty() {
        return Err("Invalid path to restore.".to_string());
    }

    let command = format!(
        concat!(
            "$ErrorActionPreference='Stop'; ",
            "$parent='{parent}'; $name='{name}'; $done=$false; ",
            "$shell=New-Object -ComObject Shell.Application; ",
            "$bin=$shell.Namespace(0xA); ",
            "foreach($item in @($bin.Items())){{ ",
            "if($item.Name -ne $name){{continue}}; ",
            "$orig=[string]$bin.GetDetailsOf($item,1); ",
            "if(-not ($orig -ieq $parent)){{continue}}; ",
            "foreach($verb in @($item.Verbs())){{ ",
            "if(($verb.Name -replace '&','') -match 'Restore'){{ $verb.DoIt(); $done=$true; break }} }}; ",
            "if($done){{break}} }}; ",
            "if(-not $done){{ throw 'The folder was not found in the Recycle Bin.' }}"
        ),
        parent = escape_powershell_single_quoted(&parent),
        name = escape_powershell_single_quoted(&name),
    );
    let output = spawn_powershell_output(&["-Command".to_string(), command])?;
    if !output.status.success() {
        return Err(format_process_failure(
            &output,
            "Could not restore the folder from the Recycle Bin.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod organization_profile_catalog_tests {
    use super::*;

    #[test]
    fn shipped_profile_packages_match_the_make_button_generator() {
        let repo_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .canonicalize()
            .expect("resolve repository root");
        let scripts_dir = repo_root
            .join("Programs")
            .join("Windows")
            .join("Windows Git Scripts")
            .join("Files");
        let core = fs::read(
            repo_root
                .join("Programs")
                .join("Windows")
                .join("SupportScripts")
                .join("Apply-OrganizationProfileCore.ps1"),
        )
        .expect("read shipped Apply Organization Profile core");

        for (profile_name, package_name) in [
            ("default", "Apply Profile Default"),
            ("project tree", "Apply Profile Project Tree"),
        ] {
            let slug = organization_profile_script_slug(profile_name);
            let script_name = format!("apply_profile_{slug}.ps1");
            let script = render_organization_profile_script(profile_name);
            let manifest = render_organization_profile_manifest(profile_name, &slug, &script_name)
                .expect("render manifest");
            let package_path = scripts_dir.join(package_name);
            assert!(
                catalog_text_matches(
                    &fs::read(package_path.join(&script_name)).expect("read shipped wrapper"),
                    script.as_bytes(),
                ),
                "shipped wrapper differs for {profile_name}"
            );
            assert!(
                catalog_text_matches(
                    &fs::read(package_path.join("Apply-OrganizationProfileCore.ps1"))
                        .expect("read shipped package core"),
                    &core,
                ),
                "shipped core differs for {profile_name}"
            );
            assert!(
                catalog_text_matches(
                    &fs::read(package_path.join("flowcell.script.json"))
                        .expect("read shipped package manifest"),
                    manifest.as_bytes(),
                ),
                "shipped manifest differs for {profile_name}"
            );
            assert!(catalog_package_matches(
                &package_path,
                &script_name,
                script.as_bytes(),
                &core,
                manifest.as_bytes(),
            ));
        }
    }

    #[test]
    fn generated_profile_catalog_package_is_complete_and_adjacent_only() {
        let token = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = env::temp_dir().join(format!("flowcell-profile-package-{token}"));
        let scripts_dir = root.join("Files");
        fs::create_dir_all(&scripts_dir).expect("create test scripts directory");
        let core_path = root.join("Apply-OrganizationProfileCore.ps1");
        fs::write(&core_path, "# owned test core\n").expect("write test core");

        let package =
            write_organization_profile_catalog_package(&scripts_dir, "Aaron's Profile", &core_path)
                .expect("create complete catalog package");
        let second =
            write_organization_profile_catalog_package(&scripts_dir, "Aaron's Profile", &core_path)
                .expect("reuse identical catalog package");
        assert_eq!(package, second);

        let mut names = fs::read_dir(&package)
            .expect("read package")
            .map(|entry| {
                entry
                    .expect("read package entry")
                    .file_name()
                    .to_string_lossy()
                    .to_string()
            })
            .collect::<Vec<_>>();
        names.sort();
        assert_eq!(
            names,
            vec![
                "Apply-OrganizationProfileCore.ps1",
                "apply_profile_aaron_s_profile.ps1",
                "flowcell.script.json",
            ]
        );

        let script = fs::read_to_string(package.join("apply_profile_aaron_s_profile.ps1"))
            .expect("read generated script");
        assert!(script.contains("$ProfileName = 'Aaron''s Profile'"));
        assert!(script.contains("Join-Path $PSScriptRoot 'Apply-OrganizationProfileCore.ps1'"));
        assert!(!script.contains("Programs\\Windows\\SupportScripts"));

        let manifest: Value = serde_json::from_str(
            &fs::read_to_string(package.join("flowcell.script.json"))
                .expect("read generated manifest"),
        )
        .expect("parse generated manifest");
        assert_eq!(
            manifest.get("source").and_then(Value::as_str),
            Some("apply_profile_aaron_s_profile.ps1")
        );
        assert_eq!(
            manifest.get("label").and_then(Value::as_str),
            Some("Aaron's Profile")
        );

        fs::remove_dir_all(root).expect("clean test package");
    }
}
