import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { buildPanelRailButtons } from "./.compiled-button-system/pages/main/mainLayout.js";
import { buttonRectsOverlap } from "./.compiled-button-system/button/geometry/buttonGeometry.js";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (...segments) =>
  readFileSync(path.join(frontendRoot, ...segments), "utf8");

for (const unavailable of [false, true]) {
  test(`layout connects its programs once before restoring panels, unavailable=${unavailable}`, async () => {
    const source = readSource("src", "pages", "main", "MainPage.tsx");
    const start = source.indexOf("const restoreLayoutSnapshotState =");
    const end = source.indexOf("const handleSaveLayout =", start);
    const compiled = ts.transpileModule(source.slice(start, end) + "\nglobalThis.restore = restoreLayoutSnapshotState;", {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    const events = [];
    const sandbox = {
      isValidFlowCellBounds: () => true,
      resolveInstalledPageOpenDescriptor: async () => ({ window: { title: "Layer Tree", width: 360, height: 640 } }),
      closeManagedLayoutWindows: async () => events.push("close"),
      connectRunningLayoutPrograms: async (names) => {
        events.push(["connect", ...names]);
        if (unavailable) throw new Error("Illustrator closed during connection");
      },
      openButtonEditorWindow: async (args) => events.push(["editor", args.programName]),
      openInstalledPageWindow: async () => events.push("layer-tree"),
      console: { warn: () => events.push("unavailable") }
    };
    vm.runInNewContext(compiled, sandbox);
    const bounds = { Left: 10, Top: 20, Width: 360, Height: 640 };
    const snapshot = { Windows: [
      { Kind: "button-editor", ProgramName: "Illustrator", Bounds: bounds },
      { Kind: "button-editor", ProgramName: "Blender", Bounds: bounds },
      { Kind: "installed-page", ProgramName: "Illustrator", PanelName: "Layers", ButtonOwnerId: "tree",
        InstalledPageFileName: "layers.jsx", InstalledPageId: "illustrator.layer-tree", Bounds: bounds }
    ] };
    const original = structuredClone(snapshot);
    await sandbox.restore(snapshot);
    assert.deepEqual(events, [
      "close", ["connect", "Illustrator", "Blender"],
      ...(unavailable ? ["unavailable"] : []),
      ["editor", "Illustrator"], ["editor", "Blender"], "layer-tree"
    ]);
    assert.deepEqual(snapshot, original, "connection must not change the saved layout");
  });
}

async function runStartupScenario({ savedLayout = false, connectionFails = false,
  programListFails = false, layoutLoadFails = false } = {}) {
  const source = readSource("src", "pages", "main", "MainPage.tsx");
  const settingsHandler = source.indexOf("const handleStartupSettingChange =");
  const start = source.indexOf("void (async () => {", settingsHandler);
  const end = source.indexOf("})();", start);
  assert.ok(settingsHandler >= 0 && start > settingsHandler && end > start,
    "execute the actual Main startup IIFE");
  const startup = source.slice(start, end + "})();".length)
    .replace(/^void /, "globalThis.startup = ");
  const compiled = ts.transpileModule(startup, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const names = ["Illustrator", "Blender", "Fusion 360", "Krita", "Fresco", "Photoshop", "Windows",
    ...Array.from({ length: 12 }, (_, index) => `Custom Host ${index}`)];
  const snapshot = { Windows: [{ Kind: "button-editor", ProgramName: "Illustrator" }] };
  const events = [];
  const timers = [];
  const rejectTimer = () => {
    timers.push("timer");
    throw new Error("Startup program connection must not schedule a timer");
  };
  const sandbox = {
    cancelled: false,
    currentWindow: { minimize: async () => events.push(["minimize"]) },
    readStartupSettings: () => ({ loadLastLayoutOnStartup: savedLayout, minimizeMainOnStartup: false }),
    listProgramFolders: async () => {
      events.push(["list-programs"]);
      if (programListFails) throw new Error("program listing failed");
      return names;
    },
    setProgramNames: value => events.push(["programs", ...value]),
    setSelectedProgramName: update => events.push(["selection", update(null)]),
    resolveFolderSelection: (values, current) => current ?? values[0],
    connectRunningLayoutPrograms: async value => {
      events.push(["connect", ...value]);
      if (connectionFails) throw new Error("host connection unavailable");
    },
    readLastLayoutPath: () => "saved.flowlayout.json",
    loadLayoutSnapshot: async layoutPath => {
      events.push(["load-layout", layoutPath]);
      if (layoutLoadFails) throw new Error("saved layout invalid");
      return snapshot;
    },
    restoreLayoutSnapshotState: async (value, connectPrograms) => {
      assert.equal(value, snapshot);
      events.push(["restore", connectPrograms]);
    },
    writeLastLayoutPath: value => events.push(["last-layout", value]),
    formatErrorMessage: error => error.message,
    console: {
      warn: () => events.push(["connection-warning"]),
      error: message => events.push(["error", message])
    },
    window: { alert: () => events.push(["alert"]), setTimeout: rejectTimer, setInterval: rejectTimer },
    setTimeout: rejectTimer,
    setInterval: rejectTimer
  };
  vm.runInNewContext(compiled, sandbox);
  await sandbox.startup;
  assert.deepEqual(timers, [], "startup checks must not become background polling");
  return { events, names };
}

test("startup without a saved window layout prepares every Main program once", async () => {
  const { events, names } = await runStartupScenario();
  assert.deepEqual(events, [
    ["list-programs"], ["programs", ...names], ["selection", names[0]], ["connect", ...names]
  ]);
});

for (const connectionFails of [false, true]) {
  test(`startup restores saved panels without a second connection pass, unavailable=${connectionFails}`, async () => {
    const { events, names } = await runStartupScenario({ savedLayout: true, connectionFails });
    assert.deepEqual(events, [
      ["list-programs"], ["programs", ...names], ["selection", names[0]], ["connect", ...names],
      ...(connectionFails ? [["connection-warning"]] : []),
      ["load-layout", "saved.flowlayout.json"], ["restore", false], ["last-layout", "saved.flowlayout.json"]
    ]);
  });
}

test("startup program-list failure still lets the saved layout prepare its programs", async () => {
  const { events } = await runStartupScenario({ savedLayout: true, programListFails: true });
  assert.deepEqual(events, [
    ["list-programs"], ["error", "Failed to load program folders."], ["alert"],
    ["load-layout", "saved.flowlayout.json"], ["restore", true], ["last-layout", "saved.flowlayout.json"]
  ]);
});

test("a broken saved layout does not undo or repeat Main's startup connection pass", async () => {
  const { events, names } = await runStartupScenario({ savedLayout: true, layoutLoadFails: true });
  assert.deepEqual(events, [
    ["list-programs"], ["programs", ...names], ["selection", names[0]], ["connect", ...names],
    ["load-layout", "saved.flowlayout.json"], ["last-layout", null],
    ["error", "Failed to load last layout on startup."]
  ]);
});

test("layout restore skips connection when startup has already checked the programs", async () => {
  const source = readSource("src", "pages", "main", "MainPage.tsx");
  const start = source.indexOf("const restoreLayoutSnapshotState =");
  const end = source.indexOf("const handleSaveLayout =", start);
  const compiled = ts.transpileModule(source.slice(start, end) + "\nglobalThis.restore = restoreLayoutSnapshotState;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const events = [];
  const sandbox = {
    isValidFlowCellBounds: () => true,
    closeManagedLayoutWindows: async () => events.push("close"),
    connectRunningLayoutPrograms: async () => { events.push("unexpected-connect"); },
    openButtonEditorWindow: async args => events.push(["editor", args.programName])
  };
  vm.runInNewContext(compiled, sandbox);
  await sandbox.restore({ Windows: [{ Kind: "button-editor", ProgramName: "Illustrator",
    Bounds: { Left: 10, Top: 20, Width: 360, Height: 640 } }] }, false);
  assert.deepEqual(events, ["close", ["editor", "Illustrator"]]);
});

test("new Startup fallback avoids custom saved panels without moving or changing them", () => {
  const savedPanels = [
    { panelName: "Files", rect: { x: 216, y: 112, width: 72, height: 48.156 } },
    { panelName: "Utility", rect: { x: 216, y: 179.264, width: 72, height: 45.948 } },
    { panelName: "Test", rect: { x: 216, y: 240, width: 72, height: 50.515 } }
  ];
  const original = structuredClone(savedPanels);
  const buttons = buildPanelRailButtons(["Files", "Startup", "Test", "Utility"], "Startup", savedPanels);
  const startup = buttons.find((button) => button.folderName === "Startup");
  assert.ok(startup);
  assert.equal(startup.isSelected, true);
  for (const saved of savedPanels) {
    assert.equal(buttonRectsOverlap(startup, saved.rect), false, `Startup overlaps ${saved.panelName}`);
    const rendered = buttons.find((button) => button.folderName === saved.panelName);
    assert.deepEqual(
      { x: rendered.x, y: rendered.y, width: rendered.width, height: rendered.height },
      saved.rect,
      `${saved.panelName} was moved`
    );
  }
  assert.deepEqual(savedPanels, original, "navigation must not mutate saved placements");
  const withoutSaved = buildPanelRailButtons(["Files", "Startup", "Test", "Utility"], "Startup");
  assert.deepEqual(buttons.at(-1), withoutSaved.at(-1), "Add Panel control must stay unchanged");
});

test("multiple newly discovered panel fallbacks reserve each other's free slots", () => {
  const savedPanels = [{ panelName: "Utility", rect: { x: 199, y: 125, width: 132, height: 90 } }];
  const buttons = buildPanelRailButtons(["Alpha", "Startup", "Utility"], null, savedPanels)
    .filter((button) => button.folderName);
  for (let index = 0; index < buttons.length; index += 1) {
    for (let other = index + 1; other < buttons.length; other += 1) {
      assert.equal(buttonRectsOverlap(buttons[index], buttons[other]), false);
    }
  }
  assert.deepEqual(savedPanels[0].rect, { x: 199, y: 125, width: 132, height: 90 });
});

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
