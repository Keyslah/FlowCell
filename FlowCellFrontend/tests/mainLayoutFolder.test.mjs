import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import {
  buildButtonsSurfaceButtons,
  buildPanelRailButtons,
  buttonsSurfaceContentOrigin,
  PANEL_BUTTON_GAP,
  panelButtonViewport,
  rails
} from "./.compiled-button-system/pages/main/mainLayout.js";
import {
  buttonSpacingPixelsFromMillimeters,
  buttonRectsOverlap,
  createStarterButtonLayout,
  orderButtonRectsByVisualRows,
  orderRaisedKeyPaintSlots
} from "./.compiled-button-system/button/geometry/buttonGeometry.js";
import { cloneButtonDocument, createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { ensureDefaultPanelPopout, ensureRegularPopout } from "./.compiled-button-system/button/state/buttonDocumentOperations.js";
import { applyPanelPopoutPreset } from "./.compiled-button-system/button/state/buttonPanelPopoutPresets.js";
import { defaultPanelButtonSize } from "./.compiled-button-system/button/state/buttonPanelDefaults.js";
import { createButtonSourceIdentity } from "./.compiled-button-system/button/state/sourceIdentity.js";
import { validateButtonStateDocument } from "./.compiled-button-system/button/state/buttonStateValidation.js";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (...segments) =>
  readFileSync(path.join(frontendRoot, ...segments), "utf8");

function mainPopFixture() {
  const document = createButtonStateDocument();
  const ids = ["Project", ...Array.from({ length: 8 }, (_, index) => `Other ${index + 1}`)];
  const panel = {
    id: "files-panel", name: "Windows / Files", kind: "panel", width: 600, height: 300,
    placementIds: [], visualOverflowAllowance: 24, uniformButtonSize: null
  };
  document.surfaces[panel.id] = panel;
  for (const [index, id] of [...ids].reverse().entries()) {
    document.buttons[id] = {
      id, role: "single-script", sourceIdentity: createButtonSourceIdentity("Windows", "Files", `${id}.ps1`),
      label: id, tooltip: "", executionTarget: { kind: "panel-script", programName: "Windows", panelName: "Files", fileName: `${id}.ps1` },
      defaultSkinId: "skin-default-neutral", defaultTextFitMode: "shrink", disabled: false,
      activationAnimation: null, activationBehavior: null, toolSetParentId: null, toolSetBehavior: null, metadata: {}
    };
    const visualIndex = ids.indexOf(id);
    const placement = {
      id: `main-${id}`, buttonId: id, surfaceId: panel.id,
      x: (visualIndex % 4) * 128, y: Math.floor(visualIndex / 4) * 48,
      width: id === "Project" ? 104 : 120, height: id === "Project" ? 36 : 40,
      zIndex: index, skinOverrideId: "skin-default-neutral", textFitMode: "stack-whole-words", textAlignment: "center",
      textOffsetX: 3, textOffsetY: -2, minimumFontSize: 9, textSizeOverride: 15,
      allowLabelResize: false, matchHitboxToSkin: false, allowStretching: false,
      highlightOnHover: true, activationCycle: null, visualStateMap: null, resizeAnchor: "top-left"
    };
    document.placements[placement.id] = placement;
    panel.placementIds.push(placement.id);
  }
  return { document, ids, panel };
}

function mainPopHarness(fixture, selectedIds = []) {
  const source = readSource("src", "pages", "main", "MainPage.tsx");
  const identityStart = source.indexOf("function sourceIdentityMatchesFolderScope(");
  const identityEnd = source.indexOf("type CanonicalRenameScope", identityStart);
  const start = source.indexOf("const openPanelButtonsPop = async");
  const end = source.indexOf("const handleChoosePanelPop = async", start);
  assert.ok(identityStart >= 0 && identityEnd > identityStart && start >= 0 && end > start,
    "execute the actual Main selected-Button Pop handlers");
  const compiled = ts.transpileModule(
    source.slice(identityStart, identityEnd) + source.slice(start, end) +
    "\nglobalThis.openPanelPop = handleOpenPanelPop; globalThis.openButtonsPop = openPanelButtonsPop;",
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
  ).outputText;
  let current = fixture.document;
  const opened = [];
  const toolSets = [];
  const alerts = [];
  const sandbox = {
    selectedProgramName: "Windows", selectedPanelName: "Files",
    selectedPanelScriptRecords: selectedIds.map((id) => ({ canonicalButtonId: id, fileName: `${id}.ps1`, label: id })),
    buttonDocumentRef: { current },
    loadMainPageButtonBootstrap: async () => ({ document: current }),
    loadButtonStateDocument: async () => current,
    acceptButtonDocument: (document) => { current = document; sandbox.buttonDocumentRef.current = document; },
    commitButtonDocumentMutation: async (mutate) => {
      const draft = structuredClone(current);
      await mutate(draft);
      const validation = validateButtonStateDocument(draft);
      assert.equal(validation.valid, true, JSON.stringify(validation.issues));
      current = draft;
      sandbox.buttonDocumentRef.current = current;
      return current;
    },
    ensureDefaultPanelPopout, ensureRegularPopout, applyPanelPopoutPreset,
    cloneButtonDocument, createStarterButtonLayout, buttonSpacingPixelsFromMillimeters, orderButtonRectsByVisualRows,
    defaultPanelButtonSize, PANEL_BUTTON_GAP,
    areFolderNamesEqual: (left, right) => left?.trim().toLowerCase() === right?.trim().toLowerCase(),
    openButtonPopoutWindow: async (args) => opened.push(structuredClone(args)),
    activateToolSetOwner: async (id, document, behavior) => toolSets.push({ id, behavior, document }),
    readMainLastPopChoices: () => assert.fail("normal Pop must not use the previous Open Pop file"),
    openMainPopChoice: () => assert.fail("normal Pop must not open the remembered file"),
    formatErrorMessage: (error) => error.message,
    console: { error: () => {} }, window: { alert: (message) => alerts.push(message) }
  };
  vm.runInNewContext(compiled, sandbox);
  return {
    open: () => sandbox.openPanelPop(),
    openIds: (ids) => sandbox.openButtonsPop("Windows", "Files", ids),
    get document() { return current; }, opened, toolSets, alerts
  };
}

test("Main Pop opens only highlighted Project even when another multi-Button Pop already exists", async () => {
  const fixture = mainPopFixture();
  fixture.document.placements["main-Project"].skinOverrideId = "skin-chipped-concrete-family-default";
  const previous = ensureRegularPopout(fixture.document, fixture.ids.map((id) => fixture.document.buttons[id]));
  const original = structuredClone(fixture.document);
  const harness = mainPopHarness(fixture, ["Project"]);
  await harness.open();
  assert.deepEqual(harness.alerts, []);
  assert.equal(harness.opened.length, 1);
  const unit = harness.document.popoutUnits[harness.opened[0].popoutUnitId];
  assert.notEqual(unit.id, previous.id);
  assert.deepEqual(Array.from(unit.memberPlacementIds, (id) => harness.document.placements[id].buttonId), ["Project"]);
  const placement = harness.document.placements[unit.memberPlacementIds[0]];
  const source = original.placements["main-Project"];
  for (const [key, value] of Object.entries({
    width: 160, height: 44, skinOverrideId: "skin-default-neutral", textFitMode: "shrink",
    textAlignment: "skin", textOffsetX: 0, textOffsetY: 0, minimumFontSize: 8,
    textSizeOverride: null, matchHitboxToSkin: true, highlightOnHover: false
  })) {
    assert.deepEqual(placement[key], value, `new Pop uses its own neutral ${key}`);
  }
  assert.deepEqual(harness.document.popoutUnits[previous.id], original.popoutUnits[previous.id]);
  assert.deepEqual(harness.document.placements["main-Project"], source);
  Object.assign(placement, {
    x: 28, y: 20, width: 116, height: 40, textOffsetX: 9,
    skinOverrideId: "skin-chipped-concrete-family-default"
  });
  const popupBeforeReopen = structuredClone({
    placement, unit, surface: harness.document.surfaces[unit.surfaceId]
  });
  await harness.open();
  assert.equal(harness.opened[1].popoutUnitId, unit.id, "repeated Pop reuses the exact selected unit");
  assert.deepEqual({
    placement: harness.document.placements[placement.id],
    unit: harness.document.popoutUnits[unit.id],
    surface: harness.document.surfaces[unit.surfaceId]
  }, popupBeforeReopen, "reopening preserves the Pop's custom skin, size, position and text offset");
});

test("Main Pop preserves an authored Fan with the same selection and reuses a separate ownerless Pop", async () => {
  const fixture = mainPopFixture();
  const fan = ensureRegularPopout(fixture.document, [fixture.document.buttons.Project]);
  const surface = fixture.document.surfaces[fan.surfaceId];
  const owner = {
    ...structuredClone(fixture.document.placements[fan.memberPlacementIds[0]]),
    id: "authored-fan-owner", x: 200, y: 8
  };
  fixture.document.placements[owner.id] = owner;
  surface.placementIds.push(owner.id);
  surface.width = 376;
  Object.assign(fan, {
    interactionMode: "fan", ownerButtonId: "Project", ownerPlacementId: owner.id,
    openRule: "hover", closeRule: "hover-out", canonicalBounds: { x: 0, y: 0, width: 376, height: surface.height }
  });
  assert.equal(validateButtonStateDocument(fixture.document).valid, true);
  const original = structuredClone(fixture.document);
  const harness = mainPopHarness(fixture, ["Project"]);
  await harness.open();
  assert.deepEqual(harness.alerts, []);
  assert.equal(harness.opened.length, 1);
  const unit = harness.document.popoutUnits[harness.opened[0].popoutUnitId];
  assert.notEqual(unit.id, fan.id);
  assert.equal(unit.interactionMode, "pop");
  assert.equal(unit.ownerButtonId, null);
  assert.equal(unit.ownerPlacementId, null);
  assert.deepEqual(harness.document.popoutUnits[fan.id], original.popoutUnits[fan.id]);
  assert.deepEqual(harness.document.surfaces[fan.surfaceId], original.surfaces[fan.surfaceId]);
  for (const id of surface.placementIds) assert.deepEqual(harness.document.placements[id], original.placements[id]);
  await harness.open();
  assert.equal(harness.opened[1].popoutUnitId, unit.id);
  assert.equal(Object.keys(harness.document.popoutUnits).length, 2);
});

for (const count of [2, 8, 9]) {
  test(`Main Pop packs exactly ${count} highlighted Buttons into rows of at most 4`, async () => {
    const fixture = mainPopFixture();
    const selected = fixture.ids.slice(0, count);
    const harness = mainPopHarness(fixture, [...selected].reverse());
    await harness.open();
    assert.deepEqual(harness.alerts, []);
    assert.equal(harness.opened.length, 1);
    const unit = harness.document.popoutUnits[harness.opened[0].popoutUnitId];
    const placements = Array.from(unit.memberPlacementIds, (id) => harness.document.placements[id]);
    assert.deepEqual(new Set(placements.map((placement) => placement.buttonId)), new Set(selected), "Pop includes exactly the selected scripts");
    assert.deepEqual(placements.map((placement) => placement.y), selected.map((_, index) => 8 + Math.floor(index / 4) * 44));
    assert.equal(new Set(placements.map((placement) => placement.y)).size, Math.ceil(count / 4));
    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index];
      assert.deepEqual([placement.width, placement.height], [160, 44]);
      assert.equal(placement.skinOverrideId, "skin-default-neutral");
      const expectedX = index % 4 === 0 ? 8 : placements[index - 1].x + placements[index - 1].width;
      assert.equal(placement.x, expectedX, "fresh selected Pops use the document's 0 mm spacing");
    }
    const surface = harness.document.surfaces[unit.surfaceId];
    assert.equal(surface.width, count === 2 ? 336 : 656);
    assert.equal(surface.height, 16 + Math.ceil(count / 4) * 44);
    for (const id of selected) {
      assert.deepEqual(harness.document.placements[`main-${id}`], fixture.document.placements[`main-${id}`], "Pop creation preserves Main presentation");
    }
    assert.deepEqual(JSON.parse(JSON.stringify(unit.canonicalBounds)), { x: 0, y: 0, width: surface.width, height: surface.height });
  });
}

test("Main Pop with 0 highlighted Buttons opens the whole current panel", async () => {
  const fixture = mainPopFixture();
  const unrelated = structuredClone(fixture.document.buttons.Project);
  unrelated.id = "Unrelated";
  unrelated.sourceIdentity = createButtonSourceIdentity("Windows", "Utility", "Unrelated.ps1");
  fixture.document.buttons[unrelated.id] = unrelated;
  const harness = mainPopHarness(fixture);
  await harness.open();
  assert.deepEqual(harness.alerts, []);
  const unit = harness.document.popoutUnits[harness.opened[0].popoutUnitId];
  assert.deepEqual(Array.from(unit.memberPlacementIds, (id) => harness.document.placements[id].buttonId), fixture.ids);
});

test("Main Pop opens only a highlighted tool-set owner, and mixed selection keeps its exact scripts", async () => {
  for (const mixed of [false, true]) {
    const fixture = mainPopFixture();
    const owner = structuredClone(fixture.document.buttons.Project);
    owner.id = "Selected tool set";
    owner.role = "tool-set-owner";
    owner.executionTarget = null;
    owner.sourceIdentity = createButtonSourceIdentity("Windows", "Files", "tool.flowcell.toolset.json");
    fixture.document.buttons[owner.id] = owner;
    const harness = mainPopHarness(fixture, mixed ? ["Project", owner.id] : [owner.id]);
    await harness.open();
    assert.deepEqual(harness.alerts, []);
    assert.deepEqual(harness.toolSets.map(({ id, behavior }) => ({ id, behavior })), [{ id: owner.id, behavior: "open" }]);
    assert.equal(harness.opened.length, mixed ? 1 : 0);
    if (mixed) {
      const unit = harness.document.popoutUnits[harness.opened[0].popoutUnitId];
      assert.deepEqual(Array.from(unit.memberPlacementIds, (id) => harness.document.placements[id].buttonId), ["Project"]);
    }
  }
});

test("Main Pop refuses stale or unsupported highlighted IDs instead of opening the whole panel", async () => {
  for (const selectedId of ["Missing", "Other panel", "Tool child"]) {
    const fixture = mainPopFixture();
    const otherPanel = structuredClone(fixture.document.buttons.Project);
    otherPanel.id = "Other panel";
    otherPanel.sourceIdentity = createButtonSourceIdentity("Windows", "Utility", "Other.ps1");
    fixture.document.buttons[otherPanel.id] = otherPanel;
    const child = structuredClone(fixture.document.buttons.Project);
    child.id = "Tool child";
    child.role = "tool-set-child";
    fixture.document.buttons[child.id] = child;
    const harness = mainPopHarness(fixture);
    await assert.rejects(() => harness.openIds([selectedId]));
    assert.equal(harness.opened.length, 0);
    assert.equal(harness.toolSets.length, 0);
    assert.equal(Object.keys(harness.document.popoutUnits).length, 0);
  }
});

test("the Buttons rail follows saved visual rows and includes every panel Button", () => {
  const script = (id, x, y, width) => ({
    canonicalButtonId: id,
    fileName: `${id}.ps1`,
    label: id,
    canonicalPlacement: { x, y, width, height: 37.294964 }
  });
  const scripts = [
    script("shortcycle", 710, 11.352518, 100),
    script("Minimize", 38, 59.352518, 100),
    script("Odyssey", 36, 13.352518, 88),
    ...Array.from({ length: 35 }, (_, index) => script(`Extra ${index}`, 36, 110 + 50 * index, 88))
  ];
  const original = structuredClone(scripts);
  const buttons = buildButtonsSurfaceButtons(scripts).filter((button) => button.scriptFileName);

  assert.deepEqual(buttons.slice(0, 3).map((button) => button.id), ["Odyssey", "shortcycle", "Minimize"]);
  assert.equal(buttons.length, 38);
  assert.equal(buttons[0].width, 88);
  assert.equal(buttons[0].height, 37.294964);
  assert.deepEqual(scripts, original);
});

test("the panel Button viewport aligns with Add Button inside the Buttons rail", () => {
  const rail = rails.find((entry) => entry.id === "buttons-rail");
  const addButtonX = rail.x + 6;
  const viewport = panelButtonViewport(addButtonX);

  assert.equal(PANEL_BUTTON_GAP, 8);
  assert.equal(viewport.x + viewport.paddingLeft, addButtonX);
  assert.equal(viewport.y + PANEL_BUTTON_GAP, buttonsSurfaceContentOrigin.y);
  assert.equal(viewport.x + viewport.width, rail.x + rail.width);
  assert.equal(viewport.y + viewport.height, rail.y + rail.height);
  assert.equal(viewport.maxButtonWidth + viewport.paddingLeft + 2 * PANEL_BUTTON_GAP, viewport.width);
  assert.equal(viewport.maxButtonHeight + 2 * PANEL_BUTTON_GAP, viewport.height);
});

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

test("Panel rail paint order follows saved visual rows instead of folder names", () => {
  const savedPanels = [
    { panelName: "Utility", rect: { x: 210, y: 175.485611, width: 58, height: 37.294964 } },
    { panelName: "Files", rect: { x: 276, y: 174, width: 58, height: 37.294964 } },
    { panelName: "Test", rect: { x: 237.010806, y: 225.212229, width: 56, height: 37.294964 } }
  ];
  const buttons = orderButtonRectsByVisualRows(buildPanelRailButtons(["Files", "Test", "Utility"], "Test", savedPanels));

  assert.deepEqual(buttons.map((button) => button.label), ["Utility", "Files", "Test", "Add Panel"]);
  assert.equal(buttons[2].isSelected, true);
  for (const [index, { rect }] of savedPanels.entries()) {
    const { x, y, width, height } = buttons[index];
    assert.deepEqual({ x, y, width, height }, rect);
  }
});

test("raised key paint order reuses stack slots and leaves other placements in place", () => {
  const slot = (id, y, zIndex, raisedKey) => ({
    placement: { id, x: 0, y, width: 88, height: 37.294964, zIndex },
    raisedKey
  });
  const slots = [
    slot("Test", 225.212229, 1, true),
    slot("custom", 100, 2, false),
    slot("Utility", 175.485611, 3, true),
    slot("lifted", 125.758993, 19_999, false)
  ];
  const original = structuredClone(slots);
  assert.deepEqual(orderRaisedKeyPaintSlots(slots), [
    { id: "Utility", zIndex: 1 },
    { id: "custom", zIndex: 2 },
    { id: "Test", zIndex: 3 },
    { id: "lifted", zIndex: 19_999 }
  ]);
  assert.deepEqual(slots, original);
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
    /add_filter\("FlowCell Layout", &\["json"\]\)/
  );
  assert.doesNotMatch(nativeLayouts, /add_filter\([^\n]+"flowlayout\.json"/);
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
