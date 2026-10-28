//! Portable theme archives contain presentation and assets, never an alternate tool runtime.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, path::{Path, PathBuf}};
use crate::program_sources::{execute, manifest};

const MAX_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_ASSET_BYTES: u64 = 64 * 1024 * 1024;

fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

fn encode(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let a = chunk[0] as usize;
        let b = chunk.get(1).copied().unwrap_or(0) as usize;
        let c = chunk.get(2).copied().unwrap_or(0) as usize;
        out.push(TABLE[a >> 2] as char);
        out.push(TABLE[((a & 3) << 4) | (b >> 4)] as char);
        out.push(if chunk.len() > 1 { TABLE[((b & 15) << 2) | (c >> 6)] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[c & 63] as char } else { '=' });
    }
    out
}

fn decode(text: &str) -> Result<Vec<u8>, String> {
    if text.len() % 4 != 0 || text.len() as u64 > MAX_ASSET_BYTES * 4 / 3 + 4 {
        return Err("Theme asset has invalid base64 length or exceeds 64 MiB.".into());
    }
    let value = |c: u8| -> Result<u32, String> {
        match c { b'A'..=b'Z' => Ok((c-b'A') as u32), b'a'..=b'z' => Ok((c-b'a'+26) as u32),
            b'0'..=b'9' => Ok((c-b'0'+52) as u32), b'+' => Ok(62), b'/' => Ok(63),
            _ => Err("Theme asset has invalid base64 data.".into()) }
    };
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    for (index, c) in text.as_bytes().chunks(4).enumerate() {
        let last = (index+1)*4 == text.len();
        if c[2] == b'=' && (c[3] != b'=' || !last) || c[3] == b'=' && !last {
            return Err("Theme asset has invalid base64 padding.".into());
        }
        let n = (value(c[0])? << 18) | (value(c[1])? << 12)
            | (if c[2] == b'=' {0} else {value(c[2])?} << 6)
            | if c[3] == b'=' {0} else {value(c[3])?};
        out.push((n >> 16) as u8);
        if c[2] != b'=' { out.push((n >> 8) as u8); }
        if c[3] != b'=' { out.push(n as u8); }
    }
    if out.len() as u64 > MAX_ASSET_BYTES { return Err("Theme asset exceeds 64 MiB.".into()); }
    if encode(&out) != text { return Err("Theme asset uses noncanonical base64.".into()); }
    Ok(out)
}

fn read_json(path: &Path) -> Result<Value, String> {
    let length = fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?.len();
    if length > MAX_ARCHIVE_BYTES { return Err("Theme archive exceeds 256 MiB.".into()); }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn safe_source_relative(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 4096 || value.contains('\\') || value.starts_with('/') || value.split('/').any(|part| {
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") ||
            (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && matches!(stem.as_bytes()[3], b'1'..=b'9'));
        part.is_empty() || part == "." || part == ".." || part.ends_with('.') || part.ends_with(' ') || reserved ||
            part.chars().any(|c| c.is_control() || matches!(c, ':' | '<' | '>' | '"' | '|' | '?' | '*'))
    }) {
        return Err("Theme source entries must use safe relative paths.".into());
    }
    Ok(())
}

fn recipient_local_source_path(path: &str) -> bool {
    path.split('/').any(|part| part.eq_ignore_ascii_case("runtime") || part.eq_ignore_ascii_case("flowcell.install.json") || part.eq_ignore_ascii_case("__pycache__") || part.starts_with('.'))
}

/// Verify the portable identity against the actual bytes before any staging or install.
fn validate_source_identity(dependency: &Value, files: &BTreeMap<String, Vec<u8>>) -> Result<(), String> {
    let script = files.get("flowcell.script.json");
    let toolset = files.get("flowcell.toolset.json");
    if script.is_some() && toolset.is_some() { return Err("Bundled tool has ambiguous script and Tool Set manifests.".into()); }
    let source_id = dependency["sourceId"].as_str().ok_or("Tool source identity is missing.")?;
    let version = dependency["sourceVersion"].as_str().ok_or("Tool source version is missing.")?;
    let declared_slots = dependency["slots"].as_array().ok_or("Tool command slots are missing.")?;
    let expected_slots = declared_slots.iter().map(|v| v.as_str().ok_or("Tool command slot must be a string.")).collect::<Result<std::collections::BTreeSet<_>, _>>()?;
    let expected_kind = dependency["importKind"].as_str().ok_or("Tool import kind is missing.")?;
    let (entry, identity, manifest_version, actual_slots) = if let Some(bytes) = script.or(toolset) {
        let manifest: Value = serde_json::from_slice(bytes).map_err(|e| format!("Bundled tool manifest is invalid: {e}"))?;
        let kind = if toolset.is_some() { "tool-set" } else { "script" };
        if kind != expected_kind { return Err("Bundled tool kind does not match its declared dependency.".into()); }
        let program = manifest["program"].as_str().unwrap_or("");
        if !program.is_empty() && !program.eq_ignore_ascii_case(dependency["programName"].as_str().unwrap_or("")) {
            return Err("Bundled tool belongs to a different program.".into());
        }
        if let Some(page) = manifest.get("page") {
            let mut resources = vec![page["entry"].as_str().ok_or("Bundled page entry is missing.")?];
            for key in ["scripts", "styles", "assets"] {
                for resource in page[key].as_array().ok_or("Bundled page resource declaration is invalid.")? {
                    resources.push(resource.as_str().ok_or("Bundled page resource must be a path.")?);
                }
            }
            for resource in resources {
                safe_source_relative(resource)?;
                if !files.contains_key(&resource.to_ascii_lowercase()) { return Err(format!("Bundled page requires missing resource '{resource}'.")); }
            }
        }
        let source = manifest["source"].as_str().ok_or("Bundled tool entry is missing.")?.to_string();
        safe_source_relative(&source)?;
        let slots = if toolset.is_some() {
            let children = manifest["children"].as_array().ok_or("Bundled Tool Set children are missing.")?;
            let mut slots = std::collections::BTreeSet::new();
            for child in children { let slot = child["slot"].as_str().ok_or("Bundled Tool Set child slot is missing.")?;
                if slot.is_empty() || !slots.insert(slot.to_string()) { return Err("Bundled Tool Set command slots are ambiguous.".into()); }
            }
            slots
        } else { std::collections::BTreeSet::new() };
        (source, manifest["id"].as_str().unwrap_or("").to_string(), manifest["version"].as_str().unwrap_or("").to_string(), slots)
    } else {
        if expected_kind != "script" { return Err("Bundled Tool Set requires its manifest.".into()); }
        let source = dependency["sourceName"].as_str().ok_or("Plain tool entry is missing.")?.to_string();
        safe_source_relative(&source)?;
        (source, String::new(), String::new(), std::collections::BTreeSet::new())
    };
    let bytes = files.get(&entry.to_ascii_lowercase()).ok_or("Bundled tool's declared entry is missing.")?;
    let source_hash = digest(bytes);
    let actual_id = if identity.is_empty() { format!("sha256:{source_hash}") } else { identity };
    let actual_version = if manifest_version.is_empty() { source_hash } else { manifest_version };
    if source_id != actual_id || version != actual_version { return Err("Bundled tool identity or version does not match its source bytes.".into()); }
    if actual_slots.iter().map(String::as_str).collect::<std::collections::BTreeSet<_>>() != expected_slots {
        return Err("Bundled Tool Set command slots do not match its dependency.".into());
    }
    Ok(())
}

fn package_source_files(root: &Path) -> Result<Vec<Value>, String> {
    let mut pending = vec![root.to_path_buf()];
    let mut result = Vec::new();
    let mut total = 0u64;
    while let Some(folder) = pending.pop() {
        crate::program_sources::installed_page::reject_package_source_reparse_point(&folder)?;
        for entry in fs::read_dir(&folder).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            let name = path.file_name().and_then(|v| v.to_str()).unwrap_or("");
            // These files belong to the recipient's installation and mutable owner state.
            if recipient_local_source_path(name) { continue; }
            crate::program_sources::installed_page::reject_package_source_reparse_point(&path)?;
            if path.is_dir() { pending.push(path); continue; }
            let relative = path.strip_prefix(root).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
            safe_source_relative(&relative)?;
            let length = fs::metadata(&path).map_err(|e| e.to_string())?.len();
            total += length;
            if length > MAX_ASSET_BYTES || total > MAX_ARCHIVE_BYTES { return Err("Bundled theme tool exceeds archive limits.".into()); }
            let bytes = fs::read(&path).map_err(|e| e.to_string())?;
            result.push(json!({"path":relative,"sha256":digest(&bytes),"base64":encode(&bytes)}));
        }
    }
    result.sort_by_key(|v| v["path"].as_str().unwrap_or("").to_string());
    Ok(result)
}

fn validate_sources(theme: &Value) -> Result<Vec<Value>, String> {
    let sources = match theme.get("sources") { Some(value) => value.as_array().ok_or("Theme sources must be an array.")?.clone(), None => Vec::new() };
    let dependencies = theme.get("dependencies").and_then(Value::as_array).ok_or("Portable theme requires dependencies.")?;
    let mut dependency_ids = std::collections::BTreeSet::new();
    for dependency in dependencies {
        let id = dependency["id"].as_str().filter(|id| !id.is_empty()).ok_or("Tool dependency identity is missing.")?;
        if !dependency_ids.insert(id) { return Err("Tool dependency identities are ambiguous.".into()); }
        if theme["target"]["kind"] != "program" || !dependency["programName"].as_str().unwrap_or("").eq_ignore_ascii_case(theme["target"]["programName"].as_str().unwrap_or("")) {
            return Err("Tool dependency is outside the selected program theme.".into());
        }
    }
    let mut seen = std::collections::BTreeSet::new();
    let mut total = 0u64;
    for source in &sources {
        let id = source["dependencyId"].as_str().ok_or("Bundled source requires dependency identity.")?;
        if !seen.insert(id) || !dependencies.iter().any(|d| d["id"].as_str() == Some(id)) { return Err("Bundled source has duplicate or unknown dependency identity.".into()); }
        let mut paths = std::collections::BTreeSet::new();
        let mut decoded = BTreeMap::new();
        for file in source["files"].as_array().ok_or("Bundled source requires files.")? {
            let path = file["path"].as_str().ok_or("Bundled source requires a relative file path.")?;
            safe_source_relative(path)?;
            if recipient_local_source_path(path) || !paths.insert(path.to_ascii_lowercase()) {
                return Err("Bundled source contains recipient-local state or conflicting files.".into());
            }
            let bytes = decode(file["base64"].as_str().ok_or("Bundled source requires base64 content.")?)?;
            total += bytes.len() as u64;
            if total > MAX_ARCHIVE_BYTES || Some(digest(&bytes).as_str()) != file["sha256"].as_str() { return Err(format!("Bundled source '{path}' failed integrity validation.")); }
            decoded.insert(path.to_ascii_lowercase(), bytes);
        }
        if paths.is_empty() || paths.len() > 4096 { return Err("Bundled source must contain 1 to 4096 files.".into()); }
        for path in &paths {
            let mut prefix = String::new();
            let components = path.split('/').collect::<Vec<_>>();
            for component in components.iter().take(components.len().saturating_sub(1)) {
                if !prefix.is_empty() { prefix.push('/'); } prefix.push_str(component);
                if paths.contains(&prefix) { return Err("Bundled source file conflicts with a parent directory.".into()); }
            }
        }
        let dependency = dependencies.iter().find(|d| d["id"].as_str() == Some(id)).unwrap();
        validate_source_identity(dependency, &decoded)?;
    }
    Ok(sources)
}

fn local_asset_path(value: &str) -> Option<PathBuf> {
    if value.starts_with("file:") {
        return tauri::Url::parse(value).ok()?.to_file_path().ok();
    }
    let path = PathBuf::from(value);
    path.is_absolute().then_some(path)
}

#[tauri::command]
pub(crate) fn validate_flowcell_theme_assets(paths: Vec<String>) -> Result<(), String> {
    if paths.len() > 4096 { return Err("Theme requires more than 4096 assets.".into()); }
    for value in paths {
        let path = local_asset_path(value.trim()).ok_or_else(|| format!("Theme asset requires an absolute local path: {value}"))?;
        if asset_extension(&path).is_none() { return Err(format!("Unsupported theme asset type: {}", path.display())); }
        let metadata = fs::metadata(&path).map_err(|error| format!("Required theme asset '{}': {error}", path.display()))?;
        if !metadata.is_file() { return Err(format!("Theme asset is not a file: {}", path.display())); }
        if metadata.len() > MAX_ASSET_BYTES { return Err(format!("Theme asset '{}' exceeds 64 MiB.", path.display())); }
        fs::File::open(&path).map_err(|error| format!("Required theme asset '{}' cannot be read: {error}", path.display()))?;
    }
    Ok(())
}

fn asset_extension(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    matches!(ext.as_str(), "png"|"jpg"|"jpeg"|"gif"|"webp"|"bmp"|"tif"|"tiff"|"svg"|"hdr"|"exr"|"woff"|"woff2"|"ttf"|"otf").then_some(ext)
}

fn map_strings(value: &mut Value, map: &mut impl FnMut(&str) -> Result<String, String>) -> Result<(), String> {
    match value {
        Value::String(text) => *text = map(text)?,
        Value::Array(items) => for item in items { map_strings(item, map)?; },
        Value::Object(items) => for item in items.values_mut() { map_strings(item, map)?; },
        _ => ()
    }
    Ok(())
}

fn declared_asset_value_mut<'a>(root: &'a mut Value, path: &str) -> Result<Option<&'a mut Value>, String> {
    let mut current = root;
    for part in path.split('.') {
        if part.is_empty() || matches!(part, "__proto__" | "constructor" | "prototype") {
            return Err("Contribution asset fields must use declared property paths.".into());
        }
        let Some(next) = current.as_object_mut().and_then(|object| object.get_mut(part)) else { return Ok(None); };
        current = next;
    }
    Ok(Some(current))
}

/// Only presentation asset locations are rewritten. Tool identities, labels and sources remain literal.
fn map_declared_asset_strings(theme: &mut Value, map: &mut impl FnMut(&str) -> Result<String, String>) -> Result<(), String> {
    if let Some(assets) = theme.pointer_mut("/theme/page/assets").and_then(Value::as_object_mut) {
        for asset in assets.values_mut() { if let Some(path) = asset.get_mut("path") { map_strings(path, map)?; } }
    }
    if let Some(buttons) = theme.pointer_mut("/theme/buttons").and_then(Value::as_array_mut) {
        for button in buttons { if let Some(skin) = button.get_mut("skin") {
            for key in ["structure", "keyframes", "base", "hover", "play", "pressed", "held", "release", "disabled", "error", "metadata"] {
                if let Some(value) = skin.get_mut(key) { map_strings(value, map)?; }
            }
        } }
    }
    if let Some(contributions) = theme.get_mut("contributions").and_then(Value::as_object_mut) {
        for contribution in contributions.values_mut() {
            let paths = contribution["assetFields"].as_array().ok_or("Theme contribution must declare its asset fields.")?.clone();
            for path in paths {
                let path = path.as_str().ok_or("Theme contribution asset field must be a property path.")?;
                if let Some(value) = declared_asset_value_mut(&mut contribution["state"], path)? {
                    if !value.is_null() && !value.is_string() { return Err("Theme contribution asset field must contain a path string.".into()); }
                    map_strings(value, map)?;
                }
            }
        }
    }
    Ok(())
}

fn validate_archive(theme: &Value, program_name: Option<&str>) -> Result<Vec<(String, Vec<u8>)>, String> {
    super::themes::validate_theme_target(theme, program_name)?;
    if theme.get("kind").and_then(Value::as_str) != Some("FlowCellPortableTheme") || theme.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("Unsupported portable theme archive format.".into());
    }
    validate_sources(theme)?;
    if serde_json::to_vec(theme).map_err(|e| e.to_string())?.len() as u64 > MAX_ARCHIVE_BYTES {
        return Err("Theme archive exceeds 256 MiB.".into());
    }
    let entries = match theme.get("assets") { Some(value) => value.as_array().ok_or("Theme assets must be an array.")?.clone(), None => Vec::new() };
    if entries.len() > 4096 { return Err("Theme archive exceeds 4096 assets.".into()); }
    let mut assets = BTreeMap::new();
    let mut total = 0u64;
    for entry in entries {
        let path = entry.get("path").and_then(Value::as_str).ok_or("Theme asset requires a path.")?;
        let hash = entry.get("sha256").and_then(Value::as_str).ok_or("Theme asset requires SHA-256.")?;
        let ext = asset_extension(Path::new(path)).ok_or("Unsupported theme asset type.")?;
        if hash.len()!=64 || !hash.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) || path != format!("assets/{hash}.{ext}") {
            return Err("Theme asset path does not match its content identity.".into());
        }
        let bytes = decode(entry.get("base64").and_then(Value::as_str).ok_or("Theme asset requires base64 data.")?)?;
        total += bytes.len() as u64;
        if total > MAX_ARCHIVE_BYTES || digest(&bytes) != hash { return Err(format!("Theme asset '{path}' failed SHA-256 or size validation.")); }
        if assets.insert(path.to_string(), bytes).is_some() { return Err(format!("Duplicate theme asset '{path}'.")); }
    }
    let mut inspect = theme.clone();
    inspect.as_object_mut().ok_or("Theme must be an object.")?.remove("assets");
    map_declared_asset_strings(&mut inspect, &mut |text| {
        for suffix in text.split("theme-asset:").skip(1) {
            let candidate = suffix.split(['\"','\'',')',' ','\n','\r','\t','<','>']).next().unwrap_or("");
            if !assets.contains_key(candidate) { return Err(format!("Theme requires missing asset '{candidate}'.")); }
        }
        Ok(text.to_string())
    })?;
    Ok(assets.into_iter().collect())
}

#[tauri::command]
pub(crate) fn get_theme_tool_descriptors(program_name: Option<String>) -> Result<Vec<Value>, String> {
    let programs = match program_name { Some(name) => vec![crate::require_registered_program_name(&name)?], None => return Ok(Vec::new()) };
    let mut result = Vec::new();
    for program in programs {
        let manifest = manifest::load_program_manifest(&program)?;
        let program_root = crate::resolve_program_directory(&program)?;
        for panel in crate::list_panel_folders(program.clone())? {
            for resolution in execute::list_active_source_records(&program, &panel)? {
                let record = resolution.record;
                let paths = execute::resolve_owned_source_paths(&manifest, &record)?;
                let source_root = paths.package_path.join("source");
                let script_manifest = source_root.join("flowcell.script.json");
                let toolset_manifest = source_root.join("flowcell.toolset.json");
                let package = if script_manifest.is_file() { read_json(&script_manifest)? } else if toolset_manifest.is_file() { read_json(&toolset_manifest)? } else { Value::Null };
                let source_hash = digest(&fs::read(&paths.source_path).map_err(|e| e.to_string())?);
                let source_id = record.bundled_source_id.clone().or_else(|| package.get("id").and_then(Value::as_str).filter(|id| !id.is_empty()).map(str::to_string)).unwrap_or_else(|| format!("sha256:{source_hash}"));
                let source_version = record.bundled_source_version.clone().or_else(|| package.get("version").and_then(Value::as_str).filter(|id| !id.is_empty()).map(str::to_string)).unwrap_or_else(|| source_hash.clone());
                let catalog = manifest.bundled_sources.iter().find(|s| s.id == source_id).map(|s| s.source_path.clone());
                result.push(json!({"ownerButtonId":record.owner_button_id,"programName":program,"programId":manifest.program_id,"panelName":panel,
                    "sourceId":source_id,"sourceVersion":source_version,"sourceName":paths.source_path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or(resolution.file_name),
                    "importKind":if !record.children.is_empty() || record.kind=="toolset" || record.kind=="tool-set" {"tool-set"} else {"script"},"catalogPath":catalog,
                    "sourcePath":source_root.to_string_lossy(),"slots":record.children.iter().map(|c| c.slot.clone()).collect::<Vec<_>>() }));
            }
        }
        for source in &manifest.bundled_sources {
            let path = manifest::resolve_relative_manifest_path(&program_root, &source.source_path, "bundledSources.sourcePath", false)?.ok_or("Bundled source path is missing.")?;
            let toolset = path.join("flowcell.toolset.json");
            let slots = if toolset.is_file() { read_json(&toolset)?.get("children").and_then(Value::as_array).map(|items| items.iter().filter_map(|c| c.get("slot").and_then(Value::as_str).map(str::to_string)).collect::<Vec<_>>()).unwrap_or_default() } else { vec![] };
            result.push(json!({"ownerButtonId":"","programName":program,"programId":manifest.program_id,"panelName":source.panel_name,
                "sourceId":source.id,"sourceVersion":source.version,"sourceName":source.source_path,"importKind":source.import_kind,
                "catalogPath":source.source_path,"sourcePath":path.to_string_lossy(),"slots":slots }));
        }
    }
    Ok(result)
}

#[tauri::command]
pub(crate) fn package_flowcell_theme_archive(mut theme: Value, program_name: Option<String>) -> Result<Value, String> {
    super::themes::validate_theme_target(&theme, program_name.as_deref())?;
    let previous_assets = theme.as_object_mut().ok_or("Theme must be an object.")?.remove("assets").unwrap_or(json!([]));
    let mut sources = validate_sources(&theme)?;
    let descriptors = get_theme_tool_descriptors(program_name.clone())?;
    for dependency in theme["dependencies"].as_array().ok_or("Theme dependencies are missing.")? {
        if sources.iter().any(|s| s["dependencyId"] == dependency["id"]) { continue; }
        let matches: Vec<_> = descriptors.iter().filter(|d| d["programId"] == dependency["programId"] && d["sourceId"] == dependency["sourceId"] && d["sourceVersion"] == dependency["sourceVersion"]).collect();
        if matches.iter().any(|d| d["ownerButtonId"] == "") { continue; } // Stable program catalog reference.
        let installed: Vec<_> = matches.into_iter().filter(|d| d["ownerButtonId"].as_str().is_some_and(|id| !id.is_empty())).collect();
        if installed.len() != 1 { return Err(format!("Tool '{}' has {} compatible installed sources for export.", dependency["sourceName"], installed.len())); }
        let root = Path::new(installed[0]["sourcePath"].as_str().ok_or("Installed tool source is unavailable.")?);
        sources.push(json!({"dependencyId":dependency["id"],"files":package_source_files(root)?}));
    }
    // Source bytes are opaque and never searched/replaced as presentation assets.
    theme.as_object_mut().unwrap().remove("sources");
    let mut assets: BTreeMap<String, Value> = BTreeMap::new();
    for entry in previous_assets.as_array().ok_or("Theme assets must be an array.")? { assets.insert(entry.get("path").and_then(Value::as_str).ok_or("Invalid asset path.")?.to_string(), entry.clone()); }
    map_declared_asset_strings(&mut theme, &mut |text| {
        let mut candidates = vec![text.to_string()];
        // Literal markup remains intact; only its explicit asset URLs become portable references.
        for fragment in text.split(['\"','\'','(',')','\n','\r']) { if Path::new(fragment).is_absolute() { candidates.push(fragment.to_string()); } }
        let mut next = text.to_string();
        for candidate in candidates {
            let Some(source) = local_asset_path(&candidate) else { continue; };
            let Some(ext) = asset_extension(&source) else { continue; };
            let length = fs::metadata(&source).map_err(|e| format!("Required theme asset '{}': {e}", source.display()))?.len();
            if length > MAX_ASSET_BYTES { return Err(format!("Theme asset '{}' exceeds 64 MiB.", source.display())); }
            let bytes = fs::read(&source).map_err(|e| e.to_string())?;
            let hash = digest(&bytes);
            let relative = format!("assets/{hash}.{ext}");
            assets.entry(relative.clone()).or_insert_with(|| json!({"path":relative,"sha256":hash,"base64":encode(&bytes)}));
            next = next.replace(&candidate, &format!("theme-asset:{relative}"));
        }
        Ok(next)
    })?;
    theme["assets"] = Value::Array(assets.into_values().collect());
    theme["sources"] = Value::Array(sources);
    validate_archive(&theme, program_name.as_deref())?;
    Ok(theme)
}

#[tauri::command]
pub(crate) fn export_flowcell_theme_archive(path: String, theme: Value, program_name: Option<String>) -> Result<String, String> {
    let theme = package_flowcell_theme_archive(theme, program_name)?;
    let bytes = serde_json::to_vec_pretty(&theme).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_ARCHIVE_BYTES { return Err("Theme archive exceeds 256 MiB.".into()); }
    let target = PathBuf::from(path);
    if target.exists() {
        if fs::read(&target).map_err(|e| e.to_string())? == bytes { return Ok(target.to_string_lossy().into_owned()); }
        return Err("A different file already exists at the export path. Choose a different name.".into());
    }
    crate::program_sources::transaction::write_json_file(&target, &bytes, crate::program_sources::transaction::AtomicWriteMode::Create)?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub(crate) fn read_flowcell_theme_archive(path: String, program_name: Option<String>) -> Result<Value, String> {
    let mut resolved_path = Value::String(path);
    super::themes::remap_migrated_theme_paths(&mut resolved_path)?;
    let mut theme = read_json(Path::new(resolved_path.as_str().ok_or("Theme path is invalid.")?))?;
    super::themes::remap_migrated_theme_paths(&mut theme)?;
    super::themes::validate_theme_target(&theme, program_name.as_deref())?;
    if theme.get("kind").and_then(Value::as_str)==Some("FlowCellPortableTheme") { validate_archive(&theme, program_name.as_deref())?; }
    Ok(theme)
}

#[tauri::command]
pub(crate) fn materialize_flowcell_theme_archive(mut theme: Value, program_name: Option<String>) -> Result<Value, String> {
    let assets = validate_archive(&theme, program_name.as_deref())?;
    let root = super::themes::resolve_theme_directory(program_name.as_deref())?;
    let mut mappings = Vec::new();
    // Preflight every collision before creating any asset.
    for (relative, bytes) in &assets {
        let target = super::themes::safe_theme_path(&root, relative, false)?;
        if target.exists() && fs::read(&target).map_err(|e| e.to_string())? != *bytes { return Err(format!("Conflicting theme asset '{}'.", target.display())); }
        mappings.push((relative.clone(), target));
    }
    for ((relative, bytes), (_, target)) in assets.iter().zip(&mappings) {
        if !target.exists() {
            let target = super::themes::safe_theme_path(&root, relative, true)?;
            crate::program_sources::transaction::write_file_atomically(&target, bytes,
                crate::program_sources::transaction::AtomicWriteMode::Create,
                |candidate| if fs::read(candidate).map_err(|e| e.to_string())? == *bytes { Ok(()) } else { Err("Theme asset verification failed.".into()) })?;
        }
    }
    theme.as_object_mut().unwrap().remove("assets");
    map_declared_asset_strings(&mut theme, &mut |text| {
        let mut next = text.to_string();
        for (relative, path) in &mappings { next = next.replace(&format!("theme-asset:{relative}"), &path.to_string_lossy().replace('\\',"/")); }
        Ok(next)
    })?;
    Ok(theme)
}

#[tauri::command]
pub(crate) fn prepare_theme_archive_sources(theme: Value, program_name: Option<String>) -> Result<Value, String> {
    validate_archive(&theme, program_name.as_deref())?;
    let sources = validate_sources(&theme)?;
    if sources.is_empty() { return Ok(json!({"token":null,"descriptors":[]})); }
    let token = format!("theme-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos());
    let stage_root = crate::resolve_flowcell_local_root()?.join("theme-import-staging");
    fs::create_dir_all(&stage_root).map_err(|e| e.to_string())?;
    let root = super::themes::safe_theme_path(&stage_root, &token, false)?;
    fs::create_dir(&root).map_err(|e| e.to_string())?;
    let result = (|| {
        let mut descriptors = Vec::new();
        for (index, source) in sources.iter().enumerate() {
            let dependency = theme["dependencies"].as_array().unwrap().iter().find(|d| d["id"] == source["dependencyId"]).unwrap();
            let folder = root.join(index.to_string()); fs::create_dir(&folder).map_err(|e| e.to_string())?;
            for file in source["files"].as_array().unwrap() {
                let path = super::themes::safe_theme_path(&folder, file["path"].as_str().unwrap(), true)?;
                fs::write(&path, decode(file["base64"].as_str().unwrap())?).map_err(|e| e.to_string())?;
            }
            let source_path = if folder.join("flowcell.script.json").is_file() || folder.join("flowcell.toolset.json").is_file() { folder.clone() }
                else { super::themes::safe_theme_path(&folder, dependency["sourceName"].as_str().ok_or("Plain tool entry is missing.")?, false)? };
            if !source_path.exists() { return Err("Bundled tool entry is missing.".to_string()); }
            let preflight = crate::program_sources::install::preflight_button_source(
                dependency["programName"].as_str().ok_or("Tool program is missing.")?, &source_path,
                dependency["importKind"].as_str().ok_or("Tool import kind is missing.")?)?;
            let expected_slots = dependency["slots"].as_array().ok_or("Tool command slots are missing.")?.iter()
                .filter_map(Value::as_str).collect::<std::collections::BTreeSet<_>>();
            if preflight.child_slots.iter().map(String::as_str).collect::<std::collections::BTreeSet<_>>() != expected_slots {
                return Err("Installed tool preflight returned incompatible command slots.".into());
            }
            let mut descriptor = dependency.clone();
            descriptor.as_object_mut().unwrap().remove("id");
            descriptor["ownerButtonId"] = json!(""); descriptor["sourcePath"] = json!(source_path.to_string_lossy());
            descriptor["catalogPath"] = Value::Null;
            descriptors.push(descriptor);
        }
        Ok(json!({"token":token,"descriptors":descriptors}))
    })();
    if result.is_err() { let _ = crate::recycle_directory_path(&root); }
    result
}

#[tauri::command]
pub(crate) fn finish_theme_archive_sources(token: String) -> Result<(), String> {
    if !token.starts_with("theme-") || !token.bytes().all(|b| b.is_ascii_alphanumeric() || b==b'-') { return Err("Invalid theme staging token.".into()); }
    let root = crate::resolve_flowcell_local_root()?.join("theme-import-staging");
    let path = super::themes::safe_theme_path(&root, &token, false)?;
    if path.exists() { crate::recycle_directory_path(&path)?; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source_file(path: &str, bytes: &[u8]) -> Value {
        json!({"path":path, "sha256":digest(bytes), "base64":encode(bytes)})
    }
    fn toolset_archive() -> Value {
        let manifest = serde_json::to_vec(&json!({"schemaVersion":1,"id":"example.tool", "version":"1.0.0",
            "program":"Example", "source":"tool.py", "children":[{"slot":"run"}]})).unwrap();
        json!({"target":{"kind":"program","programName":"Example"},
            "dependencies":[{"id":"dep-1","programName":"Example","sourceId":"example.tool","sourceVersion":"1.0.0","sourceName":"tool.py","importKind":"tool-set","slots":["run"]}],
            "sources":[{"dependencyId":"dep-1","files":[source_file("flowcell.toolset.json",&manifest),source_file("tool.py",b"pass")]}]})
    }
    #[test] fn archive_rejects_windows_paths_recipient_state_and_file_parent_conflicts() {
        for path in ["../x", "C:/x", "x\\y", "/x", "NUL.txt", "a/COM1.json", "x:stream", "a./b", "a /b", "a//b", "a/?"] {
            assert!(safe_source_relative(path).is_err(), "{path}");
        }
        assert!(safe_source_relative("page/theme.css").is_ok());
        for path in ["RUNTIME/state.json", "FLOWCELL.INSTALL.JSON", "a/.secret", "a/__PYCACHE__/test.pyc"] {
            assert!(recipient_local_source_path(path), "{path}");
        }
        let mut theme = toolset_archive();
        theme["sources"][0]["files"].as_array_mut().unwrap().extend([source_file("page",b"file"),source_file("page/index.html",b"html")]);
        assert!(validate_sources(&theme).unwrap_err().contains("parent directory"));
    }
    #[test] fn archive_verifies_bundled_identity_kind_version_and_command_slots_before_staging() {
        let theme = toolset_archive();
        assert_eq!(validate_sources(&theme).unwrap().len(), 1);
        for (key, value) in [("sourceId",json!("different")),("sourceVersion",json!("2.0.0")),("importKind",json!("script")),("slots",json!(["other"]))] {
            let mut invalid = theme.clone(); invalid["dependencies"][0][key] = value;
            assert!(validate_sources(&invalid).is_err(), "{key}");
        }
        let mut corrupt = theme.clone(); corrupt["sources"][0]["files"][1]["sha256"] = json!("0".repeat(64));
        assert!(validate_sources(&corrupt).unwrap_err().contains("integrity"));
        let mut wrong_target = theme; wrong_target["dependencies"][0]["programName"] = json!("Other");
        assert!(validate_sources(&wrong_target).unwrap_err().contains("selected program"));
    }
    #[test] fn archive_maps_only_declared_assets_and_literal_skin_fields() {
        let mut theme = json!({"name":"C:/private/label.png", "dependencies":[{"sourceName":"C:/tool.py"}],
            "theme":{"page":{"assets":{"background":{"path":"C:/picture.png"}}},
                "buttons":[{"skin":{"name":"C:/private/skin.png","structure":"<img src='C:/skin.png'>","base":"[data-core]{shape:unchanged}"}}]},
            "contributions":{"example":{"assetFields":["fields.picture"],"state":{"fields":{"picture":"C:/declared.png","label":"C:/keep.png"}}}}});
        map_declared_asset_strings(&mut theme, &mut |value| Ok(value.replace("C:/", "mapped:/"))).unwrap();
        assert_eq!(theme["name"], "C:/private/label.png");
        assert_eq!(theme["theme"]["buttons"][0]["skin"]["name"], "C:/private/skin.png");
        assert_eq!(theme["theme"]["buttons"][0]["skin"]["structure"], "<img src='mapped:/skin.png'>");
        assert_eq!(theme["contributions"]["example"]["state"]["fields"]["picture"], "mapped:/declared.png");
        assert_eq!(theme["contributions"]["example"]["state"]["fields"]["label"], "C:/keep.png");
        assert_eq!(theme["theme"]["page"]["assets"]["background"]["path"], "mapped:/picture.png");
    }
    #[test] fn legacy_theme_asset_preflight_checks_local_files_without_importing() {
        let root = std::env::temp_dir().join(format!("flowcell-asset-review-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir(&root).unwrap();
        let image = root.join("environment.hdr");
        fs::write(&image, b"fixture").unwrap();
        assert!(validate_flowcell_theme_assets(vec![image.display().to_string()]).is_ok());
        assert!(validate_flowcell_theme_assets(vec![root.join("missing.hdr").display().to_string()]).is_err());
        assert!(validate_flowcell_theme_assets(vec!["https://example.invalid/a.png".into()]).is_err());
        let executable = root.join("tool.py"); fs::write(&executable, b"pass").unwrap();
        assert!(validate_flowcell_theme_assets(vec![executable.display().to_string()]).is_err());
        fs::remove_dir_all(root).unwrap(); // Only this test's short-lived fixtures.
    }
    #[test] fn archive_encoding_round_trips_and_rejects_bad_padding() {
        for bytes in [vec![], vec![0], vec![0,255], (0..=255).collect()] { assert_eq!(decode(&encode(&bytes)).unwrap(), bytes); }
        for text in ["Zg=A","Zg==AAAA","Zm9=","!==="] { assert!(decode(text).is_err()); }
    }
}
