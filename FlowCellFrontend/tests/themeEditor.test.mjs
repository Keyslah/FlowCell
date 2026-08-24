import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");

test("Theme Editor stays separate from Layout and reuses canonical Button appearance paths", () => {
  const main = read("src", "pages", "main", "MainPage.tsx");
  const layout = read("src", "pages", "main", "mainLayout.ts");
  const model = read("src", "theme", "themeModel.ts");
  const nativeLayouts = read("src-tauri", "src", "commands", "layouts.rs");
  assert.match(layout, /label: "Theme"[\s\S]{0,180}actionId: "open-theme-editor"/);
  assert.match(main, /openThemeEditorWindow\(\{ target: "FlowCell", page: "main" \}\)/);
  assert.match(model, /alignButtonPlacementSelectionToTopLeftButton/);
  assert.match(model, /buttonSpacingPixelsFromMillimeters/);
  assert.match(model, /panelRail\.x \+ \(panelRail\.width - placement\.width\) \/ 2/);
  assert.match(model, /mainPageDefaultRect/);
  assert.match(nativeLayouts, /save_flowcell_theme_file/);
  assert.match(nativeLayouts, /load_flowcell_theme_file/);
  assert.doesNotMatch(nativeLayouts, /FlowCellTheme[\s\S]{0,120}LayoutSnapshotFile/);
});
