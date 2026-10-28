use crate::*;
use sha2::{Digest, Sha256};
use std::path::Component;
use crate::program_sources::transaction::{write_json_file, AtomicWriteMode};

const MIGRATION_FILE: &str = ".migration-v1.json";
static MIGRATION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct ThemePathMapping {
    pub from: String,
    pub to: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct MigrationEntry {
    source: String,
    destination: String,
    backup: String,
    digest: String,
    #[serde(default)]
    asset_mappings: Vec<ThemePathMapping>,
    #[serde(default)]
    complete: bool,
}

#[derive(Default, Serialize, Deserialize)]
struct ThemeMigration {
    version: u32,
    entries: Vec<MigrationEntry>,
    mappings: Vec<ThemePathMapping>,
    #[serde(default)]
    warnings: Vec<String>,
}

fn io_error(subject: &str, path: &Path, error: impl std::fmt::Display) -> String {
    format!("{subject} {}: {error}", path.display())
}

fn reject_link(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| io_error("Cannot inspect", path, error))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("Theme storage does not follow symbolic links: {}", path.display()));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(format!("Theme storage does not follow reparse points: {}", path.display()));
        }
    }
    Ok(())
}

fn reserved_windows_component(component: &str) -> bool {
    let stem = component.split('.').next().unwrap_or_default().to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") ||
        (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) &&
            matches!(stem.as_bytes()[3], b'1'..=b'9'))
}

pub(crate) fn safe_theme_path(root: &Path, relative: &str, create_parent: bool) -> Result<PathBuf, String> {
    let normalized = relative.replace('\\', "/");
    let relative = Path::new(&normalized);
    if normalized.is_empty() || relative.is_absolute() || normalized.split('/').any(|part| {
        part.is_empty() || validate_folder_name(part, "Theme path").is_err()
            || part == "." || part == ".." || part.ends_with('.') || part.ends_with(' ')
            || reserved_windows_component(part)
    }) || relative.components().any(|part| !matches!(part, Component::Normal(_))) {
        return Err("Theme path must be a safe relative path inside its target library.".into());
    }
    reject_link(root)?;
    let canonical_root = root.canonicalize().map_err(|error| io_error("Cannot resolve", root, error))?;
    let mut candidate = root.to_path_buf();
    let parts: Vec<_> = relative.components().collect();
    for (index, part) in parts.iter().enumerate() {
        candidate.push(part.as_os_str());
        if candidate.exists() {
            reject_link(&candidate)?;
            let canonical = candidate.canonicalize().map_err(|error| io_error("Cannot resolve", &candidate, error))?;
            if !canonical.starts_with(&canonical_root) {
                return Err("Theme path escapes its target library.".into());
            }
        } else if create_parent && index + 1 < parts.len() {
            fs::create_dir(&candidate).map_err(|error| io_error("Cannot create", &candidate, error))?;
        }
    }
    Ok(candidate)
}

pub(crate) fn resolve_theme_directory(program_name: Option<&str>) -> Result<PathBuf, String> {
    let local = resolve_flowcell_local_root()?;
    fs::create_dir_all(&local).map_err(|error| io_error("Cannot create local data root", &local, error))?;
    let themes = safe_theme_path(&local, "themes", false)?;
    fs::create_dir_all(&themes).map_err(|error| io_error("Cannot create theme library", &themes, error))?;
    let target = match program_name.filter(|name| !name.trim().is_empty()) {
        Some(name) => require_registered_program_name(name)?,
        None => "main".to_string(),
    };
    let root = safe_theme_path(&themes, &target, false)?;
    fs::create_dir_all(&root).map_err(|error| io_error("Cannot create target theme library", &root, error))?;
    Ok(root)
}

fn saved_target(theme: &Value) -> Result<Option<String>, String> {
    match theme.get("kind").and_then(Value::as_str) {
        Some("FlowCellTheme") | Some("FlowCellPortableTheme") => {
            let supported = if theme.get("kind").and_then(Value::as_str) == Some("FlowCellTheme") {
                matches!(theme.get("version").and_then(Value::as_u64), Some(1 | 2))
            } else { theme.get("version").and_then(Value::as_u64) == Some(1) };
            if !supported { return Err("The selected theme has an unsupported format version.".into()); }
            let target = theme.get("target").ok_or("Theme is missing its target.")?;
            match target.get("kind").and_then(Value::as_str) {
                Some("flowcell") if matches!(target.get("page").and_then(Value::as_str), Some("main" | "macro-lab" | "binds")) => Ok(None),
                Some("program") => target.get("programName").and_then(Value::as_str)
                    .filter(|name| !name.trim().is_empty()).map(|name| Some(name.to_string()))
                    .ok_or_else(|| "Theme is missing its program target.".into()),
                _ => Err("Theme target is unsupported; select a Main or registered program theme.".into()),
            }
        }
        _ => match theme.get("format").and_then(Value::as_str) {
            Some("flowcell-tool-package/blender-theme/v1") | Some("flowcell-blender-theme-pack-v1")
            | Some("flowcell-blender-theme-v1") => Ok(Some("Blender".into())),
            _ => Err("The selected file is not a supported theme.".into()),
        },
    }
}

pub(crate) fn validate_theme_target(theme: &Value, selected: Option<&str>) -> Result<(), String> {
    let target = saved_target(theme)?;
    let selected = selected.filter(|value| !value.trim().is_empty());
    if match (&target, selected) {
        (None, None) => true,
        (Some(saved), Some(selected)) => saved.eq_ignore_ascii_case(selected),
        _ => false,
    } { Ok(()) } else {
        Err(format!("This theme targets {}; the selected target is {}. Select the matching target before opening or importing it.",
            target.as_deref().unwrap_or("Main"), selected.unwrap_or("Main")))
    }
}

fn read_json(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path).map_err(|error| io_error("Cannot read theme", path, error))?;
    serde_json::from_str(raw.trim_start_matches('\u{feff}')).map_err(|error| io_error("Invalid theme JSON", path, error))
}

fn normalized_path(value: &str) -> String {
    value.strip_prefix("\\\\?\\").unwrap_or(value).replace('\\', "/").trim_end_matches('/').to_string()
}

fn remap_value(value: &mut Value, mappings: &[ThemePathMapping]) -> bool {
    match value {
        Value::String(text) => {
            let normalized = normalized_path(text);
            let lower = normalized.to_ascii_lowercase();
            let best = mappings.iter().filter_map(|mapping| {
                let from = normalized_path(&mapping.from);
                let lower_from = from.to_ascii_lowercase();
                if lower == lower_from || lower.strip_prefix(&lower_from).is_some_and(|suffix| suffix.starts_with('/')) {
                    Some((from.len(), &mapping.to))
                } else { None }
            }).max_by_key(|(length, _)| *length);
            if let Some((length, destination)) = best {
                *text = format!("{}{}", normalized_path(destination), &normalized[length..]);
                true
            } else { false }
        }
        Value::Array(items) => items.iter_mut().fold(false, |changed, item| remap_value(item, mappings) || changed),
        Value::Object(items) => items.values_mut().fold(false, |changed, item| remap_value(item, mappings) || changed),
        _ => false,
    }
}

fn journal_path(local: &Path) -> PathBuf { local.join("themes").join(MIGRATION_FILE) }

fn read_journal(local: &Path) -> Result<ThemeMigration, String> {
    let path = journal_path(local);
    if !path.exists() { return Ok(ThemeMigration { version: 1, ..Default::default() }); }
    let journal: ThemeMigration = serde_json::from_value(read_json(&path)?).map_err(|error| error.to_string())?;
    if journal.version != 1 { return Err("Unsupported theme migration journal version.".into()); }
    Ok(journal)
}

fn write_journal(local: &Path, journal: &ThemeMigration) -> Result<(), String> {
    let path = journal_path(local);
    fs::create_dir_all(path.parent().unwrap()).map_err(|error| error.to_string())?;
    write_json_file(&path, &serde_json::to_vec_pretty(journal).map_err(|error| error.to_string())?,
        if path.exists() { AtomicWriteMode::Replace } else { AtomicWriteMode::Create })
}

#[tauri::command]
pub(crate) fn get_theme_migration_path_map() -> Result<Vec<ThemePathMapping>, String> {
    let journal = read_journal(&resolve_flowcell_local_root()?)?;
    // An interrupted copy must not redirect a live owner to an unpublished path.
    let mut mappings: Vec<_> = journal.mappings.into_iter().filter(|mapping|
        journal.entries.iter().any(|entry| entry.complete && entry.source == mapping.from)).collect();
    mappings.extend(journal.entries.into_iter().filter(|entry| entry.complete).flat_map(|entry| entry.asset_mappings));
    Ok(mappings)
}

pub(crate) fn remap_migrated_theme_paths(value: &mut Value) -> Result<bool, String> {
    Ok(remap_value(value, &get_theme_migration_path_map()?))
}

fn walk_files(root: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    reject_link(root)?;
    if root.is_file() { files.push(root.to_path_buf()); return Ok(()); }
    for entry in fs::read_dir(root).map_err(|error| io_error("Cannot read", root, error))? {
        let path = entry.map_err(|error| error.to_string())?.path();
        reject_link(&path)?;
        if path.is_dir() { walk_files(&path, files)?; } else { files.push(path); }
    }
    Ok(())
}

fn content_digest(root: &Path) -> Result<String, String> {
    let mut files = Vec::new();
    walk_files(root, &mut files)?;
    files.sort();
    let mut digest = Sha256::new();
    for path in files {
        let relative = if root.is_file() { "".to_string() } else { path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/") };
        digest.update(relative.as_bytes()); digest.update([0]);
        digest.update(fs::read(&path).map_err(|error| io_error("Cannot hash", &path, error))?); digest.update([0]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    reject_link(source)?;
    if source.is_dir() {
        fs::create_dir_all(destination).map_err(|error| io_error("Cannot stage", destination, error))?;
        for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            copy_tree(&entry.path(), &destination.join(entry.file_name()))?;
        }
    } else {
        if let Some(parent) = destination.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
        fs::copy(source, destination).map_err(|error| io_error("Cannot copy", source, error))?;
    }
    Ok(())
}

fn page_asset_mappings(theme: &Value, theme_path: &Path) -> Result<Vec<ThemePathMapping>, String> {
    let appearance = theme.get("theme").unwrap_or(theme);
    let paths = appearance.get("page").and_then(|page| page.get("assets")).and_then(Value::as_object)
        .into_iter().flat_map(|assets| assets.values())
        .filter(|asset| asset.get("mode").and_then(Value::as_str) == Some("custom"))
        .filter_map(|asset| asset.get("path").and_then(Value::as_str));
    let parent = theme_path.parent().ok_or("Saved theme has no parent folder.")?;
    let stem = theme_path.file_stem().and_then(|name| name.to_str()).ok_or("Saved theme has no filename.")?;
    let mut mappings = Vec::new();
    for path in paths {
        let source = Path::new(path);
        if !source.is_absolute() { continue; } // Portable references are resolved by the archive importer.
        reject_link(source)?;
        if !source.is_file() { return Err(format!("Required theme image is missing: {path}")); }
        let extension = source.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase();
        if !["png", "jpg", "jpeg", "webp"].contains(&extension.as_str()) {
            return Err(format!("Unsupported theme image format: {path}"));
        }
        let digest = format!("{:x}", Sha256::digest(fs::read(source).map_err(|error| error.to_string())?));
        let destination = safe_theme_path(parent, &format!("{stem}.assets/{digest}.{extension}"), true)?;
        mappings.push(ThemePathMapping { from: path.into(), to: destination.display().to_string() });
    }
    Ok(mappings)
}

fn copy_theme_assets(mappings: &[ThemePathMapping]) -> Result<(), String> {
    for mapping in mappings {
        let source = Path::new(&mapping.from); let destination = Path::new(&mapping.to);
        if destination.exists() {
            reject_link(destination)?;
            if fs::read(source).map_err(|error| error.to_string())? != fs::read(destination).map_err(|error| error.to_string())? {
                return Err(format!("Theme asset conflicts with {}", destination.display()));
            }
        } else {
            fs::create_dir_all(destination.parent().unwrap()).map_err(|error| error.to_string())?;
            copy_tree(source, destination)?;
        }
    }
    Ok(())
}

pub(crate) fn store_page_theme_assets(theme: &mut Value, theme_path: &Path) -> Result<(), String> {
    let mappings = page_asset_mappings(theme, theme_path)?;
    copy_theme_assets(&mappings)?;
    remap_value(theme, &mappings);
    Ok(())
}

fn verify_copy(source: &Path, destination: &Path, mappings: &[ThemePathMapping]) -> Result<(), String> {
    let mut originals = Vec::new(); let mut copies = Vec::new();
    walk_files(source, &mut originals)?; walk_files(destination, &mut copies)?;
    if originals.len() != copies.len() { return Err("Migrated theme has a conflicting file inventory; original retained.".into()); }
    for original in originals {
        let copy = if source.is_file() { destination.to_path_buf() }
            else { destination.join(original.strip_prefix(source).map_err(|error| error.to_string())?) };
        let before = fs::read(&original).map_err(|error| error.to_string())?;
        let after = fs::read(&copy).map_err(|error| error.to_string())?;
        if before == after { continue; }
        let mut value = read_json(&original)?;
        remap_value(&mut value, mappings);
        if value != read_json(&copy)? { return Err(format!("Migrated theme conflicts with {}. Original retained.", copy.display())); }
    }
    Ok(())
}

fn add_migration(local: &Path, source: &Path, target: &Path, journal: &mut ThemeMigration) -> Result<(), String> {
    let source_text = source.display().to_string();
    if journal.entries.iter().any(|entry| entry.source == source_text) { return Ok(()); }
    let digest = content_digest(source)?;
    let file_name = source.file_name().ok_or("Theme has no filename.")?.to_string_lossy();
    let mut destination = target.join(file_name.as_ref());
    if destination.exists() && content_digest(&destination)? != digest {
        let stem = source.file_stem().unwrap_or_default().to_string_lossy();
        let suffix = source.extension().map(|value| format!(".{}", value.to_string_lossy())).unwrap_or_default();
        destination = target.join(if source.is_dir() { format!("{file_name}-{}", &digest[..12]) }
            else if let Some(base) = file_name.strip_suffix(".flowtheme.json") { format!("{base}-{}.flowtheme.json", &digest[..12]) }
            else if let Some(base) = file_name.strip_suffix(".flowcell-theme-pack.json") { format!("{base}-{}.flowcell-theme-pack.json", &digest[..12]) }
            else { format!("{stem}-{}{suffix}", &digest[..12]) });
        if destination.exists() && content_digest(&destination)? != digest {
            return Err(format!("Theme migration destination conflicts: {}", destination.display()));
        }
    }
    let backup = local.join("themes").join(".migration-backups-v1").join(format!("{}-{}", &digest[..12], journal.entries.len())).join(file_name.as_ref());
    journal.mappings.push(ThemePathMapping { from: source_text.clone(), to: destination.display().to_string() });
    let asset_mappings = if source.is_file() { page_asset_mappings(&read_json(source)?, &destination)? } else { Vec::new() };
    journal.entries.push(MigrationEntry { source: source_text, destination: destination.display().to_string(), backup: backup.display().to_string(), digest, asset_mappings, complete: false });
    write_journal(local, journal)
}

fn finish_migrations(local: &Path, journal: &mut ThemeMigration) -> Result<(), String> {
    // Publish and verify every destination before changing any references or retiring
    // original files. A failed asset/copy operation leaves the old live paths usable.
    for index in 0..journal.entries.len() {
        if journal.entries[index].complete { continue; }
        let entry = journal.entries[index].clone();
        let source = Path::new(&entry.source);
        let backup = Path::new(&entry.backup);
        let destination = Path::new(&entry.destination);
        if !source.exists() && !backup.exists() {
            return Err(format!("Theme migration source and recovery copy are missing: {}", source.display()));
        }
        let original = if source.exists() { source } else { backup };
        if content_digest(original)? != entry.digest { return Err(format!("Theme changed during migration: {}", original.display())); }
        if !destination.exists() {
            let stage = local.join("themes").join(format!(".migration-stage-{index}"));
            // A prior partial staging tree is recoverable; retain it rather than overwrite it.
            if stage.exists() {
                let retained = local.join("themes").join(".migration-backups-v1").join(format!("staging-{index}-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()));
                fs::create_dir_all(retained.parent().unwrap()).map_err(|error| error.to_string())?;
                fs::rename(&stage, retained).map_err(|error| error.to_string())?;
            }
            copy_tree(original, &stage)?;
            if content_digest(&stage)? != entry.digest { return Err("Staged theme verification failed; original retained.".into()); }
            fs::create_dir_all(destination.parent().unwrap()).map_err(|error| error.to_string())?;
            fs::rename(&stage, destination).map_err(|error| io_error("Cannot publish migrated theme", destination, error))?;
        }
        copy_theme_assets(&entry.asset_mappings)?;
        let mut mappings: Vec<_> = journal.mappings.iter().filter(|mapping|
            journal.entries.iter().any(|entry| entry.source == mapping.from)).cloned().collect();
        mappings.extend(entry.asset_mappings.clone());
        verify_copy(original, destination, &mappings)?;
    }
    for index in 0..journal.entries.len() {
        if journal.entries[index].complete { continue; }
        let entry = journal.entries[index].clone();
        let source = Path::new(&entry.source);
        let backup = Path::new(&entry.backup);
        let destination = Path::new(&entry.destination);
        let original = if source.exists() { source } else { backup };
        let mut mappings: Vec<_> = journal.mappings.iter().filter(|mapping|
            journal.entries.iter().any(|entry| entry.source == mapping.from)).cloned().collect();
        mappings.extend(entry.asset_mappings.clone());
        verify_copy(original, destination, &mappings)?;
        let mut files = Vec::new(); walk_files(destination, &mut files)?;
        for file in files.into_iter().filter(|path| path.extension().is_some_and(|value| value.eq_ignore_ascii_case("json"))) {
            if let Ok(mut value) = read_json(&file) {
                if remap_value(&mut value, &mappings) {
                    write_json_file(&file, &serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?, AtomicWriteMode::Replace)?;
                }
            }
        }
        if source.exists() {
            fs::create_dir_all(backup.parent().unwrap()).map_err(|error| error.to_string())?;
            if backup.exists() { return Err(format!("Theme migration recovery copy already exists: {}", backup.display())); }
            fs::rename(source, backup).map_err(|error| io_error("Cannot retain original theme", source, error))?;
        }
        journal.entries[index].complete = true;
        write_journal(local, journal)?;
    }
    Ok(())
}

fn migrate_at(local: &Path, registered: &[String]) -> Result<ThemeMigration, String> {
    let mut journal = read_journal(local)?;
    let themes = local.join("themes");
    fs::create_dir_all(&themes).map_err(|error| error.to_string())?;
    reject_link(&themes)?;
    finish_migrations(local, &mut journal)?;
    let layouts = local.join("layouts").join("Main Page");
    if layouts.is_dir() {
        let mut files = Vec::new(); walk_files(&layouts, &mut files)?;
        for file in files.into_iter().filter(|path| path.extension().is_some_and(|value| value.eq_ignore_ascii_case("json"))) {
            let Ok(value) = read_json(&file) else { continue; };
            let Ok(target) = saved_target(&value) else { continue; };
            let folder = match target {
                None => "main".to_string(),
                Some(name) => match registered.iter().find(|item| item.eq_ignore_ascii_case(&name)) {
                    Some(canonical) => canonical.clone(),
                    None => { let warning = format!("Theme {} remains in place because program {name} is not registered.", file.display());
                        if !journal.warnings.contains(&warning) { journal.warnings.push(warning); } continue; }
                },
            };
            let target = safe_theme_path(&themes, &folder, false)?;
            fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            add_migration(local, &file, &target, &mut journal)?;
        }
    }
    let legacy = local.join("blender_themes");
    if legacy.is_dir() {
        reject_link(&legacy)?;
        if let Some(blender) = registered.iter().find(|name| name.eq_ignore_ascii_case("Blender")) {
            let target = safe_theme_path(&themes, blender, false)?;
            fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            for entry in fs::read_dir(&legacy).map_err(|error| error.to_string())? {
                let entry = entry.map_err(|error| error.to_string())?;
                let path = entry.path();
                if entry.file_name().to_string_lossy().starts_with('.') { continue; }
                reject_link(&path)?;
                let mut files = Vec::new(); walk_files(&path, &mut files)?;
                if files.iter().any(|file| read_json(file).ok().and_then(|value| saved_target(&value).ok()).flatten().is_some_and(|name| name.eq_ignore_ascii_case(blender))) {
                    add_migration(local, &path, &target, &mut journal)?;
                }
            }
            // The root alias also repairs release-library configuration and older owner paths.
            if !journal.mappings.iter().any(|mapping| mapping.from == legacy.display().to_string()) {
                journal.mappings.push(ThemePathMapping { from: legacy.display().to_string(), to: target.display().to_string() });
            }
        }
    }
    write_journal(local, &journal)?;
    finish_migrations(local, &mut journal)?;
    let release_config = local.join("program-package-sources.json");
    if release_config.is_file() {
        let mut value = read_json(&release_config)?;
        if let Some(library) = value.get_mut("blenderThemeLibrary") {
            if remap_value(library, &journal.mappings) {
                let backup = themes.join(".migration-backups-v1").join("program-package-sources.json");
                if !backup.exists() { copy_tree(&release_config, &backup)?; }
                write_json_file(&release_config, &serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?, AtomicWriteMode::Replace)?;
            }
        }
    }
    Ok(journal)
}

pub(crate) fn migrate_theme_libraries_on_startup() -> Result<(), String> {
    let _guard = MIGRATION_LOCK.get_or_init(|| Mutex::new(())).lock().map_err(|_| "Theme migration lock is poisoned.")?;
    let journal = migrate_at(&resolve_flowcell_local_root()?, &list_program_folders()?)?;
    for warning in &journal.warnings { append_flowcell_local_log("themes.log", warning); }
    Ok(())
}

#[tauri::command]
pub(crate) fn list_flowcell_themes(program_name: Option<String>) -> Result<Vec<Value>, String> {
    let selected = program_name.as_deref().filter(|name| !name.trim().is_empty());
    let mut roots = vec![(resolve_theme_directory(selected)?, false)];
    if let Some(program) = selected {
        let program = require_registered_program_name(program)?;
        let root = resolve_program_directory(&program)?;
        let manifest = read_json(&root.join("flowcell.program.json"))?;
        if let Some(library) = manifest.get("themeLibrary").and_then(Value::as_str) {
            let supplied = safe_theme_path(&root, library, false)?;
            if supplied.is_dir() { roots.push((supplied, true)); }
        }
    } else if let Some(resource) = installed_resource_root() {
        let supplied = resource.join("themes").join("main");
        if supplied.is_dir() { roots.push((supplied, true)); }
    } else if let Some(repo) = resolve_repo_root() {
        let supplied = repo.join("FlowCellFrontend").join("public").join("themes").join("main");
        if supplied.is_dir() { roots.push((supplied, true)); }
    }
    let mut result = Vec::new();
    for (root, supplied) in roots {
        let mut pending = vec![root];
        while let Some(folder) = pending.pop() {
            reject_link(&folder)?;
            for entry in fs::read_dir(&folder).map_err(|error| error.to_string())? {
                let entry = entry.map_err(|error| error.to_string())?;
                if entry.file_name().to_string_lossy().starts_with('.') { continue; }
                let path = entry.path(); reject_link(&path)?;
                if path.is_dir() { pending.push(path); continue; }
                let Ok(theme) = read_json(&path) else { continue; };
                if validate_theme_target(&theme, selected).is_err() { continue; }
                let name = theme.get("name").and_then(Value::as_str).unwrap_or_else(|| path.file_stem().and_then(|value| value.to_str()).unwrap_or("Theme"));
                result.push(json!({ "name": name, "path": path.display().to_string(), "supplied": supplied,
                    "format": theme.get("kind").or_else(|| theme.get("format")), "target": theme.get("target"),
                    "preview": theme.get("preview"), "dependencies": theme.get("dependencies") }));
            }
        }
    }
    result.sort_by_key(|entry| entry.get("name").and_then(Value::as_str).unwrap_or_default().to_ascii_lowercase());
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("flowcell-theme-{name}-{}-{}", std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&root).unwrap(); root
    }

    fn put(path: &Path, value: &Value) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, serde_json::to_vec_pretty(value).unwrap()).unwrap();
    }

    #[test]
    fn nested_theme_paths_reject_traversal_and_keep_unicode_program_folders() {
        let root = fixture("paths");
        let path = safe_theme_path(&root, "themes/Fusion 360/光/theme.json", true).unwrap();
        assert!(path.parent().unwrap().is_dir());
        for unsafe_path in ["../escape", "themes/../escape", "C:/escape", "/escape", "themes//escape", "themes/./escape", "themes/folder./escape", "themes/CON.txt", "themes/nul", "themes/LPT1.png"] {
            assert!(safe_theme_path(&root, unsafe_path, true).is_err(), "{unsafe_path}");
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn target_validation_rejects_cross_target_and_preserves_legacy_readability() {
        assert!(validate_theme_target(&json!({"kind":"FlowCellTheme","version":2,"target":{"kind":"flowcell","page":"main"}}), None).is_ok());
        assert!(validate_theme_target(&json!({"kind":"FlowCellPortableTheme","version":1,"target":{"kind":"program","programName":"Blender"}}), Some("blender")).is_ok());
        assert!(validate_theme_target(&json!({"kind":"FlowCellTheme","version":2,"target":{"kind":"program","programName":"Blender"}}), None).is_err());
        for format in ["flowcell-tool-package/blender-theme/v1", "flowcell-blender-theme-pack-v1", "flowcell-blender-theme-v1"] {
            assert!(validate_theme_target(&json!({"format":format}), Some("Blender")).is_ok());
            assert!(validate_theme_target(&json!({"format":format}), Some("Krita")).is_err());
        }
    }

    #[test]
    fn migration_routes_themes_preserves_layouts_and_same_name_conflicts() {
        let root = fixture("migration");
        let layouts = root.join("layouts/Main Page");
        let image = root.join("background.png"); fs::write(&image, b"main image").unwrap();
        let main = json!({"kind":"FlowCellTheme","version":2,"target":{"kind":"flowcell","page":"main"},"buttons":[],"page":{"assets":{"background-image":{"mode":"custom","path":image.display().to_string()}}}});
        put(&layouts.join("Main.flowtheme.json"), &main);
        put(&layouts.join("Desktop.json"), &json!({"Kind":"FlowCellWindowLayout","Version":10}));
        put(&layouts.join("Blender.flowtheme.json"), &json!({"kind":"FlowCellTheme","version":2,"target":{"kind":"program","programName":"blender"}}));
        put(&root.join("themes/main/Main.flowtheme.json"), &json!({"personal":"untouched"}));
        let legacy = root.join("blender_themes/Named");
        put(&legacy.join("Named.flowcell-theme-pack.json"), &json!({"format":"flowcell-tool-package/blender-theme/v1","assets":{"picture":"image.png"},"values":{"theme_image_path":legacy.join("image.png").display().to_string()}}));
        fs::write(legacy.join("image.png"), b"image bytes").unwrap();
        let journal = migrate_at(&root, &["Blender".into()]).unwrap();
        assert_eq!(journal.entries.len(), 3);
        assert!(journal.entries.iter().all(|entry| entry.complete && Path::new(&entry.backup).exists() && !Path::new(&entry.source).exists()));
        assert!(layouts.join("Desktop.json").exists());
        assert_eq!(read_json(&root.join("themes/main/Main.flowtheme.json")).unwrap(), json!({"personal":"untouched"}));
        let main_entry = journal.entries.iter().find(|entry| entry.source.ends_with("Main.flowtheme.json")).unwrap();
        assert_eq!(main_entry.asset_mappings.len(), 1);
        assert!(image.exists());
        assert_eq!(fs::read(&main_entry.asset_mappings[0].to).unwrap(), b"main image");
        assert_eq!(read_json(Path::new(&main_entry.destination)).unwrap()["page"]["assets"]["background-image"]["path"], normalized_path(&main_entry.asset_mappings[0].to));
        assert!(root.join("themes/Blender/Blender.flowtheme.json").exists());
        assert_eq!(fs::read(root.join("themes/Blender/Named/image.png")).unwrap(), b"image bytes");
        let migrated = read_json(&root.join("themes/Blender/Named/Named.flowcell-theme-pack.json")).unwrap();
        assert_eq!(migrated["values"]["theme_image_path"], normalized_path(&root.join("themes/Blender/Named/image.png").display().to_string()));
        let resumed = migrate_at(&root, &["Blender".into()]).unwrap();
        assert_eq!(resumed.entries.len(), 3);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn migration_resumes_published_copy_and_refuses_conflicting_destination() {
        let root = fixture("resume");
        let source = root.join("layouts/Main Page/Theme.flowtheme.json");
        put(&source, &json!({"kind":"FlowCellTheme","version":2,"target":{"kind":"flowcell","page":"main"}}));
        let target = root.join("themes/main"); fs::create_dir_all(&target).unwrap();
        let mut journal = read_journal(&root).unwrap();
        add_migration(&root, &source, &target, &mut journal).unwrap();
        let destination = PathBuf::from(&journal.entries[0].destination);
        copy_tree(&source, &destination).unwrap();
        put(&destination, &json!({"conflict":true}));
        assert!(finish_migrations(&root, &mut journal).is_err());
        assert!(source.exists());
        fs::copy(&source, &destination).unwrap();
        finish_migrations(&root, &mut journal).unwrap();
        assert!(journal.entries[0].complete);
        assert!(Path::new(&journal.entries[0].backup).exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_migration_retains_every_original_until_all_copies_are_verified() {
        let root = fixture("batch-failure");
        let target = root.join("themes/main"); fs::create_dir_all(&target).unwrap();
        let mut journal = read_journal(&root).unwrap();
        for name in ["first", "second"] {
            let source = root.join("layouts/Main Page").join(format!("{name}.flowtheme.json"));
            put(&source, &json!({"kind":"FlowCellTheme","version":2,"target":{"kind":"flowcell","page":"main"}}));
            add_migration(&root, &source, &target, &mut journal).unwrap();
        }
        put(Path::new(&journal.entries[1].destination), &json!({"conflicting":true}));
        assert!(finish_migrations(&root, &mut journal).is_err());
        assert!(journal.entries.iter().all(|entry| !entry.complete && Path::new(&entry.source).exists()));
        fs::remove_dir_all(root).unwrap();
    }
}
