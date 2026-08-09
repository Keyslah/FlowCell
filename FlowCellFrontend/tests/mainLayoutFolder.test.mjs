import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (...segments) =>
  readFileSync(path.join(frontendRoot, ...segments), "utf8");

test("Main Save and Load Layout use the existing strict secondary-window pipeline", () => {
  const snapshots = readSource("src", "lib", "layoutSnapshots.ts");
  const mainPage = readSource("src", "pages", "main", "MainPage.tsx");
  const types = readSource("src", "types.ts");
  const coreWindows = readSource("src", "lib", "coreWindows.ts");
  const buttonWindows = readSource("src", "button", "windows", "buttonWindows.ts");
  const nativeLayouts = readSource("src-tauri", "src", "commands", "layouts.rs");

  assert.match(snapshots, /flowcell\.main-page-layout-directory\.v1/);
  assert.doesNotMatch(snapshots, /flowcell\.last-layout-directory\.v1/);
  assert.match(mainPage, /readLastMainPageLayoutDirectory\(\)/);
  assert.match(mainPage, /writeLastMainPageLayoutDirectory\(getParentDirectory\(/);
  assert.match(mainPage, /Windows: managedWindows/);
  assert.match(mainPage, /readRegisteredLayoutWindow\(windowHandle\.label\)/);
  assert.match(mainPage, /for \(const windowEntry of snapshot\.Windows\)/);
  assert.match(mainPage, /case "button-editor":/);
  assert.match(mainPage, /case "button-popout":/);
  assert.match(mainPage, /case "button-fan":/);
  assert.match(mainPage, /case "installed-page":/);
  assert.match(mainPage, /resolveInstalledPageOpenDescriptor\(/);
  assert.match(mainPage, /openInstalledPageWindow\(/);
  assert.match(
    mainPage,
    /case "installed-page":[\s\S]{0,1200}alwaysOnTop:\s*descriptor\.window\.alwaysOnTop/
  );
  assert.match(mainPage, /await closeManagedButtonWindow\(windowHandle\.label\)/);
  assert.doesNotMatch(mainPage, /await windowHandle\.close\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(
    buttonWindows,
    /await target\.close\(\)[\s\S]{0,420}await waitForManagedWindowToDisappear\(/
  );
  assert.match(mainPage, /Installed Page window[\s\S]{0,120}is missing its owner identity/);
  assert.ok(
    mainPage.indexOf("resolveInstalledPageOpenDescriptor({") <
      mainPage.indexOf("await closeManagedLayoutWindows();"),
    "installed Pages must resolve before the current managed layout is closed"
  );
  assert.match(
    mainPage,
    /isValidFlowCellBounds\(liveNativeBounds\)[\s\S]{0,180}registeredWindow\.snapshotBounds/
  );
  assert.match(snapshots, /entry\?\.kind === "installed-page"/);
  assert.match(coreWindows, /kind:\s*"installed-page"/);
  assert.match(coreWindows, /hashInstalledPageOwnerId\(normalizedOwner\)/);
  assert.match(coreWindows, /savedBounds:\s*args\.bounds/);
  assert.match(coreWindows, /new PhysicalPosition\(placement\.x, placement\.y\)/);
  assert.match(coreWindows, /new PhysicalSize\(placement\.width, placement\.height\)/);
  for (const forbidden of [
    "SelectedProgramName",
    "SelectedPanelName",
    "SelectedFileNames",
    "MainWindowBounds",
    "MainPagePlacements"
  ]) {
    assert.doesNotMatch(types, new RegExp(forbidden));
  }
  for (const forbidden of [
    "selected_program_name",
    "selected_panel_name",
    "selected_file_names",
    "main_window_bounds",
    "main_page_placements"
  ]) {
    assert.doesNotMatch(nativeLayouts, new RegExp(forbidden));
  }
  assert.match(types, /Version:\s*number/);
  assert.match(nativeLayouts, /LAYOUT_SNAPSHOT_VERSION:\s*u64\s*=\s*9/);
  assert.match(nativeLayouts, /button_display_mode\.is_none\(\)/);
  assert.match(nativeLayouts, /bounds\.left <= -30_000\.0/);
  assert.match(
    nativeLayouts,
    /resolve_flowcell_local_root\(\)\?[\s\S]{0,100}\.join\("layouts"\)[\s\S]{0,60}\.join\("Main Page"\)/
  );
  assert.match(
    nativeLayouts,
    /fn resolve_layout_dialog_directory[\s\S]{0,500}resolve_main_page_layouts_root\(\)/
  );
});
