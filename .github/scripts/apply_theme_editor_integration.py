from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def patch(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one match in {path}, found {count}: {old[:100]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# Keep the Theme Editor stylesheet isolated from every other FlowCell window.
patch(
    "FlowCellFrontend/src/pages/theme/themeEditorPage.css",
    ''':root {\n  font-family: "Segoe UI", sans-serif;\n  color: #edf3ef;\n  background: #111715;\n}\n\n* {\n  box-sizing: border-box;\n}\n\nbody {\n  margin: 0;\n  min-width: 760px;\n  background:\n    radial-gradient(circle at 15% 0%, rgba(115, 167, 128, 0.14), transparent 34%),\n    #111715;\n}\n\nbutton,\ninput,\nselect {\n  font: inherit;\n}\n\nbutton,\nselect,\ninput[type="number"],\ninput:not([type]) {''',
    '''.theme-editor {\n  box-sizing: border-box;\n  min-width: 760px;\n  font-family: "Segoe UI", sans-serif;\n  color: #edf3ef;\n  background:\n    radial-gradient(circle at 15% 0%, rgba(115, 167, 128, 0.14), transparent 34%),\n    #111715;\n}\n\n.theme-editor *,\n.theme-editor *::before,\n.theme-editor *::after {\n  box-sizing: border-box;\n}\n\n.theme-editor button,\n.theme-editor input,\n.theme-editor select {\n  font: inherit;\n}\n\n.theme-editor button,\n.theme-editor select,\n.theme-editor input[type="number"],\n.theme-editor input:not([type]) {'''
)
patch("FlowCellFrontend/src/pages/theme/themeEditorPage.css", "\nbutton {\n", "\n.theme-editor button {\n")
patch("FlowCellFrontend/src/pages/theme/themeEditorPage.css", "\nbutton:hover:not(:disabled) {\n", "\n.theme-editor button:hover:not(:disabled) {\n")
patch("FlowCellFrontend/src/pages/theme/themeEditorPage.css", "\nbutton:disabled {\n", "\n.theme-editor button:disabled {\n")
patch("FlowCellFrontend/src/pages/theme/themeEditorPage.css", "\ninput,\nselect {\n", "\n.theme-editor input,\n.theme-editor select {\n")
patch("FlowCellFrontend/src/pages/theme/themeEditorPage.css", "\ninput[type=\"color\"] {\n", "\n.theme-editor input[type=\"color\"] {\n")
patch("FlowCellFrontend/src/pages/theme/themeEditorPage.css", "\ninput[type=\"range\"] {\n", "\n.theme-editor input[type=\"range\"] {\n")

# Main page Theme button, directly beside Buttons.
patch(
    "FlowCellFrontend/src/pages/main/mainLayout.ts",
    '''    actionId: "open-button-editor"\n  },\n  {\n    id: "top-right-button-1",''',
    '''    actionId: "open-button-editor"\n  },\n  {\n    id: "top-left-button-10",\n    groupId: "top-left-actions",\n    x: 637.814518,\n    y: 36.353741,\n    width: 92.446043,\n    height: 37.294964,\n    radius: 18.647463,\n    label: "Theme",\n    tooltip: "Open the FlowCell Theme Editor.",\n    actionId: "open-theme-editor"\n  },\n  {\n    id: "top-right-button-1",'''
)

# Main page launches the new Theme Editor and consumes live theme background variables.
patch(
    "FlowCellFrontend/src/pages/main/MainPage.tsx",
    '''  openMacroLabWindow,\n  resolveInstalledPageOpenDescriptor,''',
    '''  openMacroLabWindow,\n  openThemeEditorWindow,\n  resolveInstalledPageOpenDescriptor,'''
)
patch(
    "FlowCellFrontend/src/pages/main/MainPage.tsx",
    '''    if (button.actionId === "open-button-editor") {\n      try {\n        await openButtonEditorWindow();\n      } catch (error) {\n        console.error("Failed to open Buttons Editor.", error);\n        window.alert(`Buttons Editor could not be opened.\\n\\n${formatErrorMessage(error)}`);\n      }\n      return;\n    }\n\n    if (button.actionId === "top-right-button-1") {''',
    '''    if (button.actionId === "open-button-editor") {\n      try {\n        await openButtonEditorWindow();\n      } catch (error) {\n        console.error("Failed to open Buttons Editor.", error);\n        window.alert(`Buttons Editor could not be opened.\\n\\n${formatErrorMessage(error)}`);\n      }\n      return;\n    }\n\n    if (button.actionId === "open-theme-editor") {\n      try {\n        await openThemeEditorWindow({ target: "FlowCell", page: "main" });\n      } catch (error) {\n        console.error("Failed to open Theme Editor.", error);\n        window.alert(`Theme Editor could not be opened.\\n\\n${formatErrorMessage(error)}`);\n      }\n      return;\n    }\n\n    if (button.actionId === "top-right-button-1") {'''
)
patch(
    "FlowCellFrontend/src/pages/main/MainPage.tsx",
    '''style={{ backgroundImage: `url(${mainBackground})` }}''',
    '''style={{ backgroundImage: `var(--flowcell-main-background-image, url(${mainBackground}))` }}'''
)
patch(
    "FlowCellFrontend/src/pages/main/mainPage.css",
    '''  background-color: #9db678;''',
    '''  background-color: var(--flowcell-main-background-color, #9db678);'''
)

# Rail colors remain inline for existing blur behavior, but now resolve through theme variables.
patch(
    "FlowCellFrontend/src/components/RailSurface.tsx",
    '''  const style: CSSProperties = {\n    left: `${rail.x}px`,''',
    '''  const cssRailId = rail.id.replace(/[^a-z0-9-]/gi, "-").toLowerCase();\n  const style: CSSProperties = {\n    left: `${rail.x}px`,'''
)
patch(
    "FlowCellFrontend/src/components/RailSurface.tsx",
    '''    border: `${rail.strokeWidth}px solid ${rail.border}`,\n    background: rail.background,''',
    '''    border: `${rail.strokeWidth}px solid var(--flowcell-main-rail-${cssRailId}-border, ${rail.border})`,\n    background: `var(--flowcell-main-rail-${cssRailId}-background, ${rail.background})`,'''
)

# Theme window context is a normal FlowCell core window.
patch(
    "FlowCellFrontend/src/lib/windowContext.ts",
    '''export interface MotionSettingsWindowContext {\n  kind: "motion-settings";\n}\n\nexport interface MacroLabWindowContext {''',
    '''export interface MotionSettingsWindowContext {\n  kind: "motion-settings";\n}\n\nexport interface ThemeEditorWindowContext {\n  kind: "theme-editor";\n  target?: string;\n  page?: string;\n}\n\nexport interface MacroLabWindowContext {'''
)
patch(
    "FlowCellFrontend/src/lib/windowContext.ts",
    '''  | MotionSettingsWindowContext\n  | MacroLabWindowContext''',
    '''  | MotionSettingsWindowContext\n  | ThemeEditorWindowContext\n  | MacroLabWindowContext'''
)
patch(
    "FlowCellFrontend/src/lib/windowContext.ts",
    '''  if (parsed.kind === "motion-settings") return { kind: "motion-settings" };\n  if (\n    parsed.kind === "macro-lab"''',
    '''  if (parsed.kind === "motion-settings") return { kind: "motion-settings" };\n  if (parsed.kind === "theme-editor") {\n    return {\n      kind: "theme-editor",\n      target: optionalString(parsed.target),\n      page: optionalString(parsed.page)\n    };\n  }\n  if (\n    parsed.kind === "macro-lab"'''
)

# Open/focus one reusable Theme Editor window.
patch(
    "FlowCellFrontend/src/lib/coreWindows.ts",
    '''export async function openMacroLabWindow(args: {''',
    '''export async function openThemeEditorWindow(args: {\n  target?: string;\n  page?: string;\n} = {}): Promise<void> {\n  await openCoreWindow({\n    label: "flowcell-theme-editor",\n    context: {\n      kind: "theme-editor",\n      target: args.target?.trim() || undefined,\n      page: args.page?.trim() || undefined\n    },\n    title: "FlowCell - Theme Editor",\n    width: 1240,\n    height: 900,\n    minimumWidth: 820,\n    minimumHeight: 620,\n    decorations: true,\n    recreate: false\n  });\n}\n\nexport async function openMacroLabWindow(args: {'''
)

# App routing plus active Main theme runtime.
patch(
    "FlowCellFrontend/src/AppBase.tsx",
    '''import MacroLabWindowPage from "./pages/macro-lab/MacroLabWindowPage";\nimport MainPage from "./pages/main/MainPage";''',
    '''import MacroLabWindowPage from "./pages/macro-lab/MacroLabWindowPage";\nimport ThemeEditorPage from "./pages/theme/ThemeEditorPage";\nimport MainPage from "./pages/main/MainPage";'''
)
patch(
    "FlowCellFrontend/src/AppBase.tsx",
    '''import { runFrontendMacro } from "./lib/macros";''',
    '''import { runFrontendMacro } from "./lib/macros";\nimport { installThemeRuntime } from "./theme/themeRuntime";'''
)
patch(
    "FlowCellFrontend/src/AppBase.tsx",
    '''    windowContext.kind === "motion-settings"\n  ) {''',
    '''    windowContext.kind === "motion-settings" ||\n    windowContext.kind === "theme-editor"\n  ) {'''
)
patch(
    "FlowCellFrontend/src/AppBase.tsx",
    '''  const fixedAlwaysOnTop =\n    windowContext.kind === "installed-page" && windowContext.alwaysOnTop;\n\n  useEffect(() => registerButtonCoreAction(''',
    '''  const fixedAlwaysOnTop =\n    windowContext.kind === "installed-page" && windowContext.alwaysOnTop;\n\n  useEffect(() => installThemeRuntime(), []);\n\n  useEffect(() => registerButtonCoreAction('''
)
patch(
    "FlowCellFrontend/src/AppBase.tsx",
    '''  if (windowContext.kind === "macro-lab") {\n    return <MacroLabWindowPage context={windowContext} />;\n  }\n  if (windowContext.kind === "tooltip") {''',
    '''  if (windowContext.kind === "macro-lab") {\n    return <MacroLabWindowPage context={windowContext} />;\n  }\n  if (windowContext.kind === "theme-editor") {\n    return <ThemeEditorPage context={windowContext} />;\n  }\n  if (windowContext.kind === "tooltip") {'''
)

# Native theme-file serialization uses the existing generic JSON/file-dialog stack.
patch(
    "FlowCellFrontend/src-tauri/src/commands/layouts.rs",
    '''#[tauri::command]\npub(crate) fn save_layout_snapshot(''',
    '''fn normalize_theme_file_path(path: &Path) -> PathBuf {\n    let path_text = path.to_string_lossy().to_string();\n    let lower_path = path_text.to_ascii_lowercase();\n    if lower_path.ends_with(".flowtheme.json") {\n        return PathBuf::from(path_text);\n    }\n    if lower_path.ends_with(".json") {\n        return PathBuf::from(format!("{}{}", &path_text[..path_text.len() - 5], ".flowtheme.json"));\n    }\n    PathBuf::from(format!("{path_text}.flowtheme.json"))\n}\n\n#[tauri::command]\npub(crate) fn save_flowcell_theme_file(path: String, theme: Value) -> Result<String, String> {\n    let trimmed_path = path.trim();\n    if trimmed_path.is_empty() {\n        return Err("Theme save path cannot be empty.".to_string());\n    }\n    let theme_path = normalize_theme_file_path(Path::new(trimmed_path));\n    if let Some(parent) = theme_path.parent() {\n        fs::create_dir_all(parent).map_err(|error| {\n            format!("Failed to create Theme folder at {}: {error}", parent.display())\n        })?;\n    }\n    let contents = serde_json::to_string_pretty(&theme)\n        .map_err(|error| format!("Failed to serialize FlowCell Theme: {error}"))?;\n    fs::write(&theme_path, contents).map_err(|error| {\n        format!("Failed to write FlowCell Theme at {}: {error}", theme_path.display())\n    })?;\n    Ok(theme_path.display().to_string())\n}\n\n#[tauri::command]\npub(crate) fn load_flowcell_theme_file(path: String) -> Result<Value, String> {\n    let trimmed_path = path.trim();\n    if trimmed_path.is_empty() {\n        return Err("Theme load path cannot be empty.".to_string());\n    }\n    let theme_path = PathBuf::from(trimmed_path);\n    let contents = fs::read_to_string(&theme_path).map_err(|error| {\n        format!("Failed to read FlowCell Theme at {}: {error}", theme_path.display())\n    })?;\n    serde_json::from_str::<Value>(&contents).map_err(|error| {\n        format!("FlowCell Theme at {} is not valid JSON: {error}", theme_path.display())\n    })\n}\n\n#[tauri::command]\npub(crate) fn save_layout_snapshot('''
)
patch(
    "FlowCellFrontend/src-tauri/src/main.rs",
    '''            save_layout_snapshot,\n            load_layout_snapshot,''',
    '''            save_layout_snapshot,\n            load_layout_snapshot,\n            save_flowcell_theme_file,\n            load_flowcell_theme_file,'''
)

# Main rail/section resize behavior: rail slots center; Button Section uses the existing top-left alignment helper.
path = ROOT / "FlowCellFrontend/src/theme/themeModel.ts"
text = path.read_text(encoding="utf-8")
old = '''function recenterManagedMainPlacement(\n  document: ButtonStateDocument,\n  placement: ButtonPlacement\n): void {\n  const button = document.buttons[placement.buttonId];\n  const metadata = button?.metadata;\n  if (!button || !isRecord(metadata)) return;\n  const section = typeof metadata.mainPageSection === "string" ? metadata.mainPageSection : "";\n  const defaultRect = isRecord(metadata.mainPageDefaultRect) ? metadata.mainPageDefaultRect : null;\n  if (!defaultRect) return;\n  const x = typeof defaultRect.x === "number" ? defaultRect.x : null;\n  const y = typeof defaultRect.y === "number" ? defaultRect.y : null;\n  const width = typeof defaultRect.width === "number" ? defaultRect.width : null;\n  const height = typeof defaultRect.height === "number" ? defaultRect.height : null;\n  if ([x, y, width, height].some((value) => value === null || !Number.isFinite(value))) return;\n\n  const railId = section === "Program Rail"\n    ? "program-rail"\n    : section === "Panel Rail"\n      ? "panel-rail"\n      : section === "Button Section Rail"\n        ? "buttons-rail"\n        : null;\n  if (!railId) return;\n  const rail = rails.find((candidate) => candidate.id === railId);\n  if (!rail) return;\n  placement.x = rail.x + (rail.width - placement.width) / 2;\n  placement.y = (y as number) + (height as number) / 2 - placement.height / 2;\n}\n'''
new = '''function recenterManagedMainPlacement(\n  document: ButtonStateDocument,\n  placement: ButtonPlacement,\n  previousRect: Pick<ButtonPlacement, "x" | "y" | "width" | "height">\n): void {\n  const button = document.buttons[placement.buttonId];\n  if (!button) return;\n\n  if (button.role === "panel-owner") {\n    const panelRail = rails.find((candidate) => candidate.id === "panel-rail");\n    if (!panelRail) return;\n    placement.x = panelRail.x + (panelRail.width - placement.width) / 2;\n    placement.y = previousRect.y + previousRect.height / 2 - placement.height / 2;\n    return;\n  }\n\n  const metadata = button.metadata;\n  const section = typeof metadata.mainPageSection === "string" ? metadata.mainPageSection : "";\n  const defaultRect = isRecord(metadata.mainPageDefaultRect) ? metadata.mainPageDefaultRect : null;\n  if (!defaultRect) return;\n  const x = typeof defaultRect.x === "number" ? defaultRect.x : null;\n  const y = typeof defaultRect.y === "number" ? defaultRect.y : null;\n  const width = typeof defaultRect.width === "number" ? defaultRect.width : null;\n  const height = typeof defaultRect.height === "number" ? defaultRect.height : null;\n  if (x === null || y === null || width === null || height === null) return;\n  if (![x, y, width, height].every(Number.isFinite)) return;\n\n  if (section === "Program Rail" || section === "Panel Rail") {\n    const railId = section === "Program Rail" ? "program-rail" : "panel-rail";\n    const rail = rails.find((candidate) => candidate.id === railId);\n    if (!rail) return;\n    placement.x = rail.x + (rail.width - placement.width) / 2;\n  } else {\n    placement.x = x + width / 2 - placement.width / 2;\n  }\n  placement.y = y + height / 2 - placement.height / 2;\n}\n'''
if text.count(old) != 1:
    raise RuntimeError("Theme model recenter function did not match exactly once")
text = text.replace(old, new, 1)
old = '''    applyAppearanceToPlacement(document, placement, appearance);\n    appliedButtonCount += 1;\n    const surface = document.surfaces[placement.surfaceId];\n    if (surface?.kind === "panel") touchedPanelSurfaces.add(surface.id);\n    if (surface?.kind === "main") recenterManagedMainPlacement(document, placement);'''
new = '''    const previousRect = {\n      x: placement.x,\n      y: placement.y,\n      width: placement.width,\n      height: placement.height\n    };\n    applyAppearanceToPlacement(document, placement, appearance);\n    appliedButtonCount += 1;\n    const surface = document.surfaces[placement.surfaceId];\n    if (surface?.kind === "panel") touchedPanelSurfaces.add(surface.id);\n    if (surface?.kind === "main") recenterManagedMainPlacement(document, placement, previousRect);'''
if text.count(old) != 1:
    raise RuntimeError("Theme model apply block did not match exactly once")
path.write_text(text.replace(old, new, 1), encoding="utf-8")

# Contract test: Theme is separate from Layout, routed globally, and reuses top-left alignment.
test_path = ROOT / "FlowCellFrontend/tests/themeEditor.test.mjs"
test_path.write_text('''import assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\nimport path from "node:path";\nimport test from "node:test";\nimport { fileURLToPath } from "node:url";\n\nconst root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");\nconst read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");\n\ntest("Theme Editor stays separate from Layout and reuses canonical Button appearance paths", () => {\n  const main = read("src", "pages", "main", "MainPage.tsx");\n  const layout = read("src", "pages", "main", "mainLayout.ts");\n  const model = read("src", "theme", "themeModel.ts");\n  const nativeLayouts = read("src-tauri", "src", "commands", "layouts.rs");\n  assert.match(layout, /label: "Theme"[\\s\\S]{0,180}actionId: "open-theme-editor"/);\n  assert.match(main, /openThemeEditorWindow\\(\\{ target: "FlowCell", page: "main" \\}\\)/);\n  assert.match(model, /alignButtonPlacementSelectionToTopLeftButton/);\n  assert.match(model, /buttonSpacingPixelsFromMillimeters/);\n  assert.match(model, /panelRail\\.x \\+ \\(panelRail\\.width - placement\\.width\\) \\/ 2/);\n  assert.match(model, /mainPageDefaultRect/);\n  assert.match(nativeLayouts, /save_flowcell_theme_file/);\n  assert.match(nativeLayouts, /load_flowcell_theme_file/);\n  assert.doesNotMatch(nativeLayouts, /FlowCellTheme[\\s\\S]{0,120}LayoutSnapshotFile/);\n});\n''', encoding="utf-8")

# Include the focused regression in the existing button test command.
patch(
    "FlowCellFrontend/package.json",
    '''tests/frontendLauncherBootstrapHealth.test.mjs\",''',
    '''tests/frontendLauncherBootstrapHealth.test.mjs tests/themeEditor.test.mjs\",'''
)

print("Theme Editor integration patch applied.")
