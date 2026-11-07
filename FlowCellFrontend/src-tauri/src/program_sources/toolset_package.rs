use super::{
    active_record_file_name, copy_package_source_entries, load_program_manifest, prepare_source,
    reject_selected_source_reparse_point, validate_owner_button_id, ActiveSourceChild,
    ToolsetLayoutRectManifest, TOOLSET_MANIFEST_FILE_NAME,
};
use crate::button_state::{
    validate_button_skin_source, BUTTON_SKIN_FILE_EXTENSION, BUTTON_SKIN_FILE_MAX_BYTES,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_APPEARANCE_FILES: usize = 4096;
const MAX_APPEARANCE_BYTES: usize = 64 * 1024 * 1024;
static EXPORT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ToolsetAppearance<T> {
    skins: BTreeMap<String, T>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    owner: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    children: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ToolsetSkinFiles {
    file: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    variants: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ToolsetSkinSource {
    source: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    variants: BTreeMap<String, String>,
}

fn validate_assignments<T>(
    appearance: &ToolsetAppearance<T>,
    children: &[ActiveSourceChild],
) -> Result<(), String> {
    for key in appearance.skins.keys() {
        if key.is_empty()
            || key.len() > 128
            || !key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        {
            return Err(format!("Invalid tool-set skin key '{key}'."));
        }
    }
    for key in appearance.owner.iter().chain(appearance.children.values()) {
        if !appearance.skins.contains_key(key) {
            return Err(format!(
                "Tool-set appearance references unknown skin '{key}'."
            ));
        }
    }
    for slot in appearance.children.keys() {
        if !children.iter().any(|child| child.slot == *slot) {
            return Err(format!(
                "Tool-set appearance references unknown child slot '{slot}'."
            ));
        }
    }
    Ok(())
}

fn validate_variant_count(count: &str) -> Result<(), String> {
    if count
        .parse::<u64>()
        .is_ok_and(|value| value <= 9_007_199_254_740_991 && value.to_string() == count)
    {
        Ok(())
    } else {
        Err(format!("Invalid tool-set skin character count '{count}'."))
    }
}

#[derive(Default)]
struct AppearanceBudget {
    files: usize,
    bytes: usize,
}

impl AppearanceBudget {
    fn add(&mut self, source: &str) -> Result<(), String> {
        self.files += 1;
        self.bytes += source.len();
        if self.files > MAX_APPEARANCE_FILES || self.bytes > MAX_APPEARANCE_BYTES {
            return Err("Tool-set appearance exceeds 4096 skin files or 64 MiB.".into());
        }
        validate_button_skin_source(source)
    }
}

fn read_skin(
    package_root: &Path,
    relative: &str,
    budget: &mut AppearanceBudget,
) -> Result<String, String> {
    if !relative
        .to_ascii_lowercase()
        .ends_with(BUTTON_SKIN_FILE_EXTENSION)
        || relative.split(['/', '\\']).any(|part| {
            crate::validate_folder_name(part, "Tool-set skin path component")
                .ok()
                .as_deref()
                != Some(part)
        })
    {
        return Err(format!(
            "Tool-set skin requires a relative {BUTTON_SKIN_FILE_EXTENSION} path: '{relative}'."
        ));
    }
    let relative = relative.replace('\\', "/");
    let path = super::super::manifest::resolve_relative_manifest_path(
        package_root,
        &relative,
        "appearance skin",
        false,
    )?
    .ok_or("Tool-set skin path is empty.")?;
    reject_selected_source_reparse_point(&path)?;
    if !path.is_file() {
        return Err(format!(
            "Tool-set skin file is missing: {}.",
            path.display()
        ));
    }
    let mut source = String::new();
    fs::File::open(&path)
        .and_then(|file| {
            file.take((BUTTON_SKIN_FILE_MAX_BYTES + 1) as u64)
                .read_to_string(&mut source)
        })
        .map_err(|error| format!("Could not read tool-set skin {}: {error}", path.display()))?;
    budget
        .add(&source)
        .map_err(|error| format!("Tool-set skin {}: {error}", path.display()))?;
    Ok(source)
}

pub(super) fn resolve_appearance(
    appearance: ToolsetAppearance<ToolsetSkinFiles>,
    package_root: &Path,
    children: &[ActiveSourceChild],
) -> Result<ToolsetAppearance<ToolsetSkinSource>, String> {
    validate_assignments(&appearance, children)?;
    let mut budget = AppearanceBudget::default();
    let mut skins = BTreeMap::new();
    for (key, skin) in appearance.skins {
        let source = read_skin(package_root, &skin.file, &mut budget)?;
        let mut variants = BTreeMap::new();
        for (count, file) in skin.variants {
            validate_variant_count(&count)?;
            variants.insert(count, read_skin(package_root, &file, &mut budget)?);
        }
        skins.insert(key, ToolsetSkinSource { source, variants });
    }
    Ok(ToolsetAppearance {
        skins,
        owner: appearance.owner,
        children: appearance.children,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExportInstalledToolsetRequest {
    program_name: String,
    panel_name: String,
    owner_button_id: String,
    destination: String,
    appearance: Option<ToolsetAppearance<ToolsetSkinSource>>,
    layout: Option<ExportLayout>,
    presentation: Option<ExportPresentation>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExportPresentation {
    owner: Option<ExportButtonPresentation>,
    #[serde(default)]
    children: BTreeMap<String, ExportButtonPresentation>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExportButtonPresentation {
    label: String,
    tooltip: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExportLayout {
    width: Option<f64>,
    height: Option<f64>,
    placements: Option<BTreeMap<String, ToolsetLayoutRectManifest>>,
    #[serde(default)]
    fields: BTreeMap<String, ToolsetLayoutRectManifest>,
}

fn apply_export_layout(toolset: &mut Value, snapshot: ExportLayout) -> Result<(), String> {
    if toolset.get("layout").is_none_or(Value::is_null) {
        toolset["layout"] = json!({});
    }
    let layout = toolset["layout"]
        .as_object_mut()
        .ok_or("Tool-set layout must be an object.")?;
    if let Some(width) = snapshot.width {
        layout.insert("width".into(), json!(width));
    }
    if let Some(height) = snapshot.height {
        layout.insert("height".into(), json!(height));
    }
    if let Some(placements) = snapshot.placements {
        layout.remove("mode");
        layout.insert(
            "placements".into(),
            serde_json::to_value(placements).map_err(|error| error.to_string())?,
        );
    }
    for (id, rect) in snapshot.fields {
        let field = layout
            .get_mut("fields")
            .and_then(Value::as_array_mut)
            .and_then(|fields| fields.iter_mut().find(|field| field["id"] == id))
            .ok_or_else(|| format!("Tool-set layout snapshot references unknown field '{id}'."))?;
        field["x"] = json!(rect.x);
        field["y"] = json!(rect.y);
        field["width"] = json!(rect.width);
        field["height"] = json!(rect.height);
        if let Some(z_index) = rect.z_index {
            if z_index.fract() != 0.0 || z_index.abs() > 9_007_199_254_740_991.0 {
                return Err(format!(
                    "Tool-set field '{id}' stacking index must be a safe integer."
                ));
            }
            field["zIndex"] = json!(z_index as i64);
        }
    }
    Ok(())
}

fn apply_export_presentation(
    toolset: &mut Value,
    presentation: ExportPresentation,
) -> Result<(), String> {
    let patch = |button: &mut Value, saved: ExportButtonPresentation| -> Result<(), String> {
        if saved.label.trim().is_empty() {
            return Err("Exported tool-set Buttons require a nonempty label.".into());
        }
        button["label"] = json!(saved.label);
        button["tooltip"] = json!(saved.tooltip);
        Ok(())
    };
    if let Some(owner) = presentation.owner {
        patch(toolset, owner)?;
    }
    for (slot, saved) in presentation.children {
        let child = toolset["children"]
            .as_array_mut()
            .and_then(|children| children.iter_mut().find(|child| child["slot"] == slot))
            .ok_or_else(|| {
                format!("Exported presentation references unknown child slot '{slot}'.")
            })?;
        patch(child, saved)?;
    }
    Ok(())
}

fn write_export_appearance(
    appearance: ToolsetAppearance<ToolsetSkinSource>,
    root: &Path,
    children: &[ActiveSourceChild],
) -> Result<ToolsetAppearance<ToolsetSkinFiles>, String> {
    validate_assignments(&appearance, children)?;
    let mut budget = AppearanceBudget::default();
    for skin in appearance.skins.values() {
        budget.add(&skin.source)?;
        for (count, source) in &skin.variants {
            validate_variant_count(count)?;
            budget.add(source)?;
        }
    }
    let mut folder = "FlowCell Button Skins".to_string();
    let mut suffix = 1;
    while root.join(&folder).exists() {
        suffix += 1;
        folder = format!("FlowCell Button Skins {suffix}");
    }
    let directory = root.join(&folder);
    if !appearance.skins.is_empty() {
        fs::create_dir(&directory)
            .map_err(|error| format!("Could not create {}: {error}", directory.display()))?;
    }
    let write = |name: String, source: String| -> Result<String, String> {
        let file = format!("{folder}/{name}{BUTTON_SKIN_FILE_EXTENSION}");
        fs::write(root.join(&file), source)
            .map_err(|error| format!("Could not write '{file}': {error}"))?;
        Ok(file)
    };
    let mut skins = BTreeMap::new();
    for (index, (key, skin)) in appearance.skins.into_iter().enumerate() {
        let file = write(format!("skin-{index}"), skin.source)?;
        let mut variants = BTreeMap::new();
        for (count, source) in skin.variants {
            variants.insert(
                count.clone(),
                write(format!("skin-{index}-{count}"), source)?,
            );
        }
        skins.insert(key, ToolsetSkinFiles { file, variants });
    }
    Ok(ToolsetAppearance {
        skins,
        owner: appearance.owner,
        children: appearance.children,
    })
}

fn require_new_export_path(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Ok(_) => Err(format!(
            "Choose a new export folder. {} already exists.",
            path.display()
        )),
        Err(error) => Err(format!(
            "Could not inspect export path {}: {error}",
            path.display()
        )),
    }
}

#[tauri::command]
pub(crate) fn export_installed_toolset(
    request: ExportInstalledToolsetRequest,
) -> Result<String, String> {
    let program = crate::require_registered_program_name(&request.program_name)?;
    let panel = crate::validate_folder_name(&request.panel_name, "Panel")?;
    let owner = validate_owner_button_id(&request.owner_button_id)?;
    let destination = PathBuf::from(&request.destination);
    if !destination.is_absolute() {
        return Err("Tool-set export requires an absolute destination folder path.".into());
    }
    let name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Export folder name is missing.")?;
    if crate::validate_folder_name(name, "Export folder")? != name {
        return Err("Export folder name cannot have leading or trailing spaces.".into());
    }
    let parent = destination.parent().ok_or("Export folder has no parent.")?;
    reject_selected_source_reparse_point(parent)?;
    let parent = parent
        .canonicalize()
        .map_err(|error| format!("Could not resolve export folder parent: {error}"))?;
    if !parent.is_dir() {
        return Err("Export folder parent must already exist.".into());
    }
    let destination = parent.join(name);
    require_new_export_path(&destination)?;

    let _source_guard = super::super::source_quarantine_guard()?;
    let manifest = load_program_manifest(&program)?;
    let active = super::super::execute::resolve_active_source_record(
        &program,
        &panel,
        &active_record_file_name(&owner),
    )?
    .ok_or("The selected installed tool-set was not found.")?;
    if active.record.owner_button_id != owner
        || !matches!(active.record.kind.as_str(), "tool-set" | "toolset")
    {
        return Err("The selected Button does not own an installed tool-set.".into());
    }
    let paths = super::super::execute::resolve_owned_source_paths(&manifest, &active.record)?;
    let program_root = crate::resolve_program_directory(&program)?;
    let owned = super::super::manifest::resolve_manifest_folder(
        &program_root,
        &manifest.local_scripts_folder,
        "localScriptsFolder",
    )?
    .join(&owner);
    let source = owned.join("source");
    reject_selected_source_reparse_point(&source)?;
    let source = source
        .canonicalize()
        .map_err(|error| format!("Could not resolve owned tool-set source: {error}"))?;
    if source != paths.package_path.join("source") || parent.starts_with(&paths.package_path) {
        return Err("Choose an export destination outside the owned tool-set package.".into());
    }
    let prepared = prepare_source(&manifest, &source, "tool-set")?;
    let declared_source = source
        .join(&prepared.source_relative_to_package)
        .canonicalize()
        .map_err(|error| format!("Could not resolve declared tool-set entry: {error}"))?;
    if !declared_source.starts_with(&source) || declared_source != paths.source_path {
        return Err("The tool-set manifest entry does not match the installed owner.".into());
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let sequence = EXPORT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let staging = parent.join(format!(
        ".flowcell-toolset-export-{}-{stamp}-{sequence}",
        std::process::id()
    ));
    fs::create_dir(&staging)
        .map_err(|error| format!("Could not stage tool-set export: {error}"))?;
    let result = (|| {
        copy_package_source_entries(&source, &staging, true)?;
        let staged_manifest = staging.join(TOOLSET_MANIFEST_FILE_NAME);
        let mut toolset: Value = serde_json::from_slice(
            &fs::read(&staged_manifest)
                .map_err(|error| format!("Could not read staged tool-set manifest: {error}"))?,
        )
        .map_err(|error| format!("Could not parse staged tool-set manifest: {error}"))?;
        if let Some(layout) = request.layout {
            apply_export_layout(&mut toolset, layout)?;
        }
        if let Some(appearance) = request.appearance {
            toolset["appearance"] = serde_json::to_value(write_export_appearance(
                appearance,
                &staging,
                &prepared.children,
            )?)
            .map_err(|error| error.to_string())?;
        }
        if let Some(presentation) = request.presentation {
            apply_export_presentation(&mut toolset, presentation)?;
        }
        let bytes = serde_json::to_vec_pretty(&toolset).map_err(|error| error.to_string())?;
        fs::write(&staged_manifest, bytes)
            .map_err(|error| format!("Could not write exported tool-set manifest: {error}"))?;
        prepare_source(&manifest, &staging, "tool-set")?;
        require_new_export_path(&destination)?;
        fs::rename(&staging, &destination)
            .map_err(|error| format!("Could not publish tool-set export: {error}"))?;
        Ok(destination
            .join(TOOLSET_MANIFEST_FILE_NAME)
            .to_string_lossy()
            .into_owned())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SKIN_SOURCE: &str = "=== structure ===\n<span data-core>{{label}}</span>\n=== keyframes ===\n=== base ===\n=== hover ===\n=== play ===\n=== pressed ===\n=== held ===\n=== release ===\n=== disabled ===\n=== error ===\n";

    struct FixtureEnvironment {
        previous: Vec<(&'static str, Option<std::ffi::OsString>)>,
        root: PathBuf,
    }

    impl Drop for FixtureEnvironment {
        fn drop(&mut self) {
            for (name, previous) in &self.previous {
                match previous {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    #[ignore = "Uses disposable environment roots. Run with --ignored --test-threads=1."]
    fn installed_toolset_exports_and_reinstalls_without_mutating_owned_source() {
        let root = std::env::temp_dir().join(format!(
            "flowcell-toolset-export-roundtrip-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let local = root.join("local");
        let programs = root.join("Programs");
        let program = programs.join("Blender");
        let catalog = program.join("Catalog");
        fs::create_dir_all(&catalog).unwrap();
        fs::create_dir_all(&local).unwrap();
        fs::create_dir(program.join("SupportScripts")).unwrap();
        fs::write(
            local.join("bindings.ini"),
            "[ProgramTab_1]\nLabel=Blender\n",
        )
        .unwrap();
        // A fixture runner avoids deploying to Blender while exercising the normal
        // Python tool-set source promotion, owned copy, and active-record lifecycle.
        fs::write(program.join("flowcell.program.json"), serde_json::to_vec(&json!({
            "schemaVersion":1,"programId":"blender","label":"Blender","programType":"local-script",
            "processNames":["blender"],"defaultPanels":["Tools"],"gitScriptsFolder":"Catalog",
            "panelsFolder":"Panels","localScriptsFolder":"Local Scripts","supportScriptsFolder":"SupportScripts",
            "allowedScriptExtensions":["py"],"allowedManifestFileNames":["flowcell.toolset.json"],
            "supportsToolsetManifests":true,"runner":{"kind":"windows-script","programKey":"test"}
        })).unwrap()).unwrap();
        let original = json!({"schemaVersion":1,"id":"blender.roundtrip","version":"1.0.0",
            "label":"Owner ","source":"tool.py","program":"Blender","execution":{"runner":"windows-script"},
            "children":[{"slot":"run","label":"Run ","payload":{"command":"run"}}],
            "layout":{"width":100,"height":80,"fields":[{"id":"size","kind":"number","label":"Size",
                "payloadKey":"size","defaultValue":2,"x":1,"y":2,"width":30,"height":15,"zIndex":0}]}});
        let original_bytes = serde_json::to_vec(&original).unwrap();
        fs::write(catalog.join(TOOLSET_MANIFEST_FILE_NAME), &original_bytes).unwrap();
        let python = b"def run_flowcell_action(payload=None):\n    return {'ok': True}\n";
        fs::write(catalog.join("tool.py"), python).unwrap();
        let previous = ["FLOWCELL_PROGRAMS_ROOT", "FLOWCELL_LOCAL_ROOT"]
            .into_iter()
            .map(|name| (name, std::env::var_os(name)))
            .collect();
        let _environment = FixtureEnvironment {
            previous,
            root: root.clone(),
        };
        std::env::set_var("FLOWCELL_PROGRAMS_ROOT", &programs);
        std::env::set_var("FLOWCELL_LOCAL_ROOT", &local);

        let install = |owner: &str, path: &Path| {
            super::super::install_button_source(super::super::InstallButtonSourceRequest {
                owner_button_id: owner.into(),
                program_name: "Blender".into(),
                panel_name: "Tools".into(),
                source_path: path.to_string_lossy().into_owned(),
                import_kind: "auto".into(),
                bundled_source_id: None,
                bundled_source_version: None,
            })
            .unwrap()
        };
        let installed = install("button_roundtrip_original", &catalog.join("tool.py"));
        assert_eq!(installed.owner.role, "tool-set-owner");
        assert_eq!(installed.owner.label, "Owner ");
        assert_eq!(installed.children[0].label, "Run ");
        let owned = program.join("Local Scripts/button_roundtrip_original/source");
        assert_eq!(
            fs::read(owned.join(TOOLSET_MANIFEST_FILE_NAME)).unwrap(),
            original_bytes
        );
        let runtime = program.join("Local Scripts/button_roundtrip_original/runtime");
        fs::create_dir(&runtime).unwrap();
        fs::write(runtime.join("private-state.json"), "private").unwrap();
        fs::create_dir(owned.join("__pycache__")).unwrap();
        fs::write(owned.join("__pycache__/tool.pyc"), "cache").unwrap();
        let destination = root.join("Exported toolset");
        let request = |destination: &Path| {
            serde_json::from_value(json!({
            "programName":"Blender","panelName":"Tools","ownerButtonId":"button_roundtrip_original",
            "destination":destination.to_string_lossy(),
            "appearance":{"skins":{"face":{"source":SKIN_SOURCE,"variants":{"0":SKIN_SOURCE,"4":SKIN_SOURCE}}},
                "owner":"face","children":{"run":"face"}},
            "layout":{"width":150,"height":90,"placements":{"run":{"x":3,"y":4,"width":40,"height":20}},
                "fields":{"size":{"x":6,"y":7,"width":35,"height":16,"zIndex":2}}},
            "presentation":{"owner":{"label":"Owner exported ","tooltip":"Owner tip "},
                "children":{"run":{"label":"Run exported ","tooltip":"Child tip "}}}
        })).unwrap()
        };
        let exported_path = export_installed_toolset(request(&destination)).unwrap();
        let exported: Value = serde_json::from_slice(&fs::read(&exported_path).unwrap()).unwrap();
        let mut expected = original.clone();
        expected["label"] = json!("Owner exported ");
        expected["tooltip"] = json!("Owner tip ");
        expected["children"][0]["label"] = json!("Run exported ");
        expected["children"][0]["tooltip"] = json!("Child tip ");
        expected["layout"]["width"] = json!(150.0);
        expected["layout"]["height"] = json!(90.0);
        expected["layout"]["placements"] =
            json!({"run":{"x":3.0,"y":4.0,"width":40.0,"height":20.0}});
        for (key, value) in [("x", 6), ("y", 7), ("width", 35), ("height", 16)] {
            expected["layout"]["fields"][0][key] = json!(value as f64);
        }
        expected["layout"]["fields"][0]["zIndex"] = json!(2);
        expected["appearance"] = json!({"skins":{"face":{"file":"FlowCell Button Skins/skin-0.flowcell-button-skin.txt",
            "variants":{"0":"FlowCell Button Skins/skin-0-0.flowcell-button-skin.txt","4":"FlowCell Button Skins/skin-0-4.flowcell-button-skin.txt"}}},
            "owner":"face","children":{"run":"face"}});
        assert_eq!(
            exported, expected,
            "Only explicit export patches change authored JSON."
        );
        assert_eq!(fs::read(destination.join("tool.py")).unwrap(), python);
        assert!(!destination.join("runtime").exists());
        assert!(!destination.join("__pycache__").exists());
        for file in ["skin-0", "skin-0-0", "skin-0-4"] {
            assert_eq!(
                fs::read_to_string(destination.join(format!(
                    "FlowCell Button Skins/{file}.flowcell-button-skin.txt"
                )))
                .unwrap(),
                SKIN_SOURCE
            );
        }
        assert!(export_installed_toolset(request(&destination))
            .unwrap_err()
            .contains("already exists"));
        let inside_owned = owned.join("Nested export");
        assert!(export_installed_toolset(request(&inside_owned))
            .unwrap_err()
            .contains("outside"));
        assert!(!inside_owned.exists());
        let sibling = root.join("Sibling export");
        let sibling_path = export_installed_toolset(serde_json::from_value(json!({
            "programName":"Blender","panelName":"Tools","ownerButtonId":"button_roundtrip_original",
            "destination":sibling.to_string_lossy()
        })).unwrap()).unwrap();
        assert!(Path::new(&sibling_path).is_file());
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(&sibling_path).unwrap()).unwrap(),
            original,
            "Export without patches preserves every original authored field and omission."
        );
        let empty = root.join("Existing empty folder");
        fs::create_dir(&empty).unwrap();
        assert!(export_installed_toolset(request(&empty))
            .unwrap_err()
            .contains("already exists"));
        assert_eq!(fs::read_dir(&empty).unwrap().count(), 0);
        let reinstalled = install("button_roundtrip_imported", &destination);
        assert_eq!(reinstalled.owner.role, "tool-set-owner");
        assert_eq!(reinstalled.owner.label, "Owner exported ");
        assert_eq!(reinstalled.owner.tooltip, "Owner tip ");
        assert_eq!(reinstalled.children[0].label, "Run exported ");
        assert_eq!(reinstalled.children[0].tooltip, "Child tip ");
        assert_eq!(
            reinstalled.layout.as_ref().unwrap()["fields"][0]["defaultValue"],
            json!(2)
        );
        let appearance = &reinstalled.layout.as_ref().unwrap()["appearance"];
        assert_eq!(appearance["owner"], json!("face"));
        assert_eq!(appearance["children"]["run"], json!("face"));
        assert_eq!(appearance["skins"]["face"]["source"], json!(SKIN_SOURCE));
        assert_eq!(
            appearance["skins"]["face"]["variants"]["4"],
            json!(SKIN_SOURCE)
        );
        assert_eq!(
            fs::read(owned.join(TOOLSET_MANIFEST_FILE_NAME)).unwrap(),
            original_bytes
        );
        assert_eq!(fs::read(owned.join("tool.py")).unwrap(), python);
        assert_eq!(
            fs::read(runtime.join("private-state.json")).unwrap(),
            b"private"
        );
    }

    #[test]
    fn portable_appearance_round_trips_literal_skins_and_stable_slots() {
        let root = std::env::temp_dir().join(format!(
            "flowcell-toolset-appearance-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let children = [ActiveSourceChild {
            slot: "run".into(),
            label: "Run".into(),
            tooltip: String::new(),
            payload: None,
            execution_target: None,
        }];
        let expected = json!({"skins":{"primary":{"source":SKIN_SOURCE,"variants":{"0":SKIN_SOURCE,"3":SKIN_SOURCE}}},
            "owner":"primary","children":{"run":"primary"}});
        let appearance = serde_json::from_value(expected.clone()).unwrap();
        let files = write_export_appearance(appearance, &root, &children).unwrap();
        let resolved = resolve_appearance(files.clone(), &root, &children).unwrap();
        assert_eq!(serde_json::to_value(resolved).unwrap(), expected);
        assert!(resolve_appearance(files.clone(), &root, &[]).is_err());

        let mut broken = files;
        let skin = broken.skins.get_mut("primary").unwrap();
        skin.variants.insert("01".into(), skin.file.clone());
        assert!(resolve_appearance(broken.clone(), &root, &children).is_err());
        broken.skins.get_mut("primary").unwrap().file =
            "../outside.flowcell-button-skin.txt".into();
        assert!(resolve_appearance(broken, &root, &children).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
