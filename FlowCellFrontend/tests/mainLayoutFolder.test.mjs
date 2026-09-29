import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (...segments) =>
  readFileSync(path.join(frontendRoot, ...segments), "utf8");

test("layout capture omits live Fan display mode but keeps Pop-out mode and semantic bounds", async () => {
  const source = readSource("src", "pages", "main", "MainPage.tsx");
  const start = source.indexOf("const captureLayoutSnapshotState =");
  const end = source.indexOf("const restoreLayoutSnapshotState =", start);
  assert.ok(start >= 0 && end > start);
  const compiled = ts.transpileModule(source.slice(start, end) + "\nglobalThis.capture = captureLayoutSnapshotState;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const bounds = { Left: 123, Top: 456, Width: 160, Height: 90 };
  const registry = {
    fan: { kind: "button-fan", programName: "Blender", panelName: "Tools", buttonFanSetupId: "fan-1",
      buttonOwnerId: "owner-1", buttonDisplayMode: "expanded", snapshotBounds: bounds },
    pop: { kind: "button-popout", programName: "Blender", buttonPopoutUnitId: "pop-1",
      buttonDisplayMode: "collapsed", snapshotBounds: bounds }
  };
  const sandbox = {
    getCurrentWindow: () => ({ label: "main" }),
    WebviewWindow: { getAll: async () => ["main", "fan", "pop"].map(label => ({ label })) },
    readRegisteredLayoutWindow: label => registry[label],
    captureWindowBounds: () => { throw new Error("Do not save monitor-sized Fan/Pop canvases"); },
    isValidFlowCellBounds: value => Boolean(value?.Width > 0 && value?.Height > 0),
    LAYOUT_SNAPSHOT_VERSION: 10
  };
  vm.runInNewContext(compiled, sandbox);
  for (const mode of ["expanded", "collapsed"]) {
    registry.fan.buttonDisplayMode = mode;
    const snapshot = JSON.parse(JSON.stringify(await sandbox.capture()));
    const fan = snapshot.Windows.find(entry => entry.Kind === "button-fan");
    assert.equal(Object.hasOwn(fan, "ButtonDisplayMode"), false);
    assert.equal(fan.ButtonFanSetupId, "fan-1");
    assert.equal(fan.ButtonOwnerId, "owner-1");
    assert.deepEqual(fan.Bounds, bounds);
    assert.equal(snapshot.Windows.find(entry => entry.Kind === "button-popout").ButtonDisplayMode, "collapsed");
    assert.equal(registry.fan.buttonDisplayMode, mode, "live palette state must remain available");
  }
});

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
  assert.match(mainPage, /ButtonPopoutSettingsPath:\s*registeredWindow\.buttonPopoutSettingsPath/);
  assert.match(mainPage, /PanelOwnerButtonId:\s*registeredWindow\.panelOwnerButtonId/);
  assert.match(mainPage, /resolvedSettingsBackedPopouts/);
  assert.match(mainPage, /settingsBackedLayout:\s*\{/);
  assert.match(
    mainPage,
    /case "button-popout":[\s\S]{0,900}settingsBackedDescriptor[\s\S]{0,900}openMainPopChoice\(/
  );
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
  assert.ok(
    mainPage.indexOf("resolvedSettingsBackedPopouts.set(") <
      mainPage.indexOf("await closeManagedLayoutWindows();"),
    "settings-backed Pop-outs must resolve before the current managed layout is closed"
  );
  assert.match(
    mainPage,
    /isValidFlowCellBounds\(liveNativeBounds\)[\s\S]{0,180}registeredWindow\.snapshotBounds/
  );
  assert.match(snapshots, /entry\?\.kind === "installed-page"/);
  assert.match(snapshots, /buttonPopoutSettingsPath/);
  assert.match(snapshots, /panelOwnerButtonId/);
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
  assert.doesNotMatch(types, /main-panel-popout/);
  assert.match(nativeLayouts, /LAYOUT_SNAPSHOT_VERSION:\s*u64\s*=\s*10/);
  assert.match(nativeLayouts, /LEGACY_LAYOUT_SNAPSHOT_VERSION:\s*u64\s*=\s*9/);
  assert.match(nativeLayouts, /button_popout_settings_path/);
  assert.match(nativeLayouts, /panel_owner_button_id/);
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
  assert.match(
    nativeLayouts,
    /add_filter\("FlowCell Layout", &\["flowlayout\.json"\]\)/
  );
  assert.match(
    nativeLayouts,
    /add_filter\("Legacy FlowCell Layout", &\["json"\]\)/
  );
  const openLayoutDialogStart = nativeLayouts.indexOf(
    "pub(crate) fn show_open_layout_dialog"
  );
  const openLayoutDialogEnd = nativeLayouts.indexOf(
    ".pick_file();",
    openLayoutDialogStart
  );
  const openLayoutDialog = nativeLayouts.slice(
    openLayoutDialogStart,
    openLayoutDialogEnd
  );
  assert.notEqual(openLayoutDialogStart, -1);
  assert.notEqual(openLayoutDialogEnd, -1);
  assert.doesNotMatch(openLayoutDialog, /\.add_filter\(/);
  assert.match(nativeLayouts, /validate_layout_file_path\(&layout_path\)\?/);
  assert.match(nativeLayouts, /FlowCell Theme, not a FlowCell Layout/);
});

test("Main native close retires every secondary FlowCell window before destroying Main", () => {
  const mainPage = readSource("src", "pages", "main", "MainPage.tsx");
  const closeCoordinatorStart = mainPage.indexOf("const closeManagedLayoutWindows");
  const closeCoordinatorEnd = mainPage.indexOf(
    "const captureLayoutSnapshotState",
    closeCoordinatorStart
  );
  const closeCoordinator = mainPage.slice(closeCoordinatorStart, closeCoordinatorEnd);
  const closeHookStart = mainPage.indexOf("mainWindow.onCloseRequested");
  const closeHookEnd = mainPage.indexOf("const captureLayoutSnapshotState", closeHookStart);
  const closeHook = mainPage.slice(closeHookStart, closeHookEnd);

  assert.notEqual(closeCoordinatorStart, -1);
  assert.match(closeCoordinator, /closeUnregisteredWindows\s*=\s*false/);
  assert.match(
    closeCoordinator,
    /if \(closeUnregisteredWindows\)[\s\S]{0,160}await windowHandle\.close\(\)/
  );
  assert.notEqual(closeHookStart, -1);
  assert.match(closeHook, /event\.preventDefault\(\)/);
  assert.ok(
    closeHook.indexOf("await closeManagedLayoutWindows(true)") <
      closeHook.indexOf("await mainWindow.destroy()"),
    "Main must finish the secondary-window close pass before it destroys itself"
  );
});
