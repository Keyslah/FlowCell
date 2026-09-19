import assert from "node:assert/strict";
import test from "node:test";
import {
  applyThemeFile,
  bakeThemeGradientForDeployedLayout,
  captureThemeFile,
  clearButtonThemeOverrideColors,
  extractSkinColorRoots,
  gradientColorForPlacement,
  isFlowCellThemeFile,
  listThemePlacements,
  resolveThemeHighlightColorResetPlacementIds,
  resolveThemeSkinAssignmentPlacementIds,
  setSkinColorRoot,
  themeSkinAssignmentIdentity,
  themePlacementDeployedCenterY
} from "./.compiled-button-system/theme/themeModel.js";
import {
  createButtonStateDocument,
  DEFAULT_BUTTON_SURFACE_ID
} from "./.compiled-button-system/button/state/buttonDefaults.js";
import { BUTTON_SKIN_SECTION_ORDER } from "./.compiled-button-system/button/skins/buttonSkinFormat.js";
import {
  readButtonSkinHighlightOnActive,
  readButtonSkinHighlightOnHover,
  setButtonSkinHighlightOnActive,
  setButtonSkinHighlightOnHover
} from "./.compiled-button-system/button/skins/buttonSkinColors.js";
import {
  FLOWCELL_THEME_PAGE_IDS,
  FLOWCELL_THEME_PAGE_REGISTRY,
  defaultThemePageAppearance,
  isThemePageAppearance,
  themePageSupportsButtonSurface,
  themePageTokenCssEntries
} from "./.compiled-button-system/theme/themePageRegistry.js";
import {
  applyProgramPopoutPaletteTargets,
  applyProgramPopoutTextColorTargets,
  gradientProgramPopoutPaletteAssignments,
  programPopoutPaletteTargetsHaveTextColor,
  programPopoutPaletteScreenPositions,
  programPopoutPaletteTargetPositions,
  readProgramPopoutSkinSurfaceColor,
  scanProgramPopoutPaletteTargets
} from "./.compiled-button-system/theme/programPopoutPalette.js";
import { buttonsSurfaceContentOrigin } from "./.compiled-button-system/pages/main/mainLayout.js";
import {
  THEME_EDITOR_SCOPE_STATE_STORAGE_KEY,
  isThemeEditorScopeState,
  readThemeEditorScopeState,
  themeEditorScopeKey,
  writeThemeEditorScopeState
} from "./.compiled-button-system/theme/themeEditorState.js";

const SAVED_AT = "2026-08-24T18:00:00.000Z";
const TARGET = { kind: "program", programName: "Blender", panelName: "Tools" };

function editorScopeState(seed, placementId = `placement-${seed}`) {
  return {
    gradient: {
      role: "surface",
      topColor: "#102030",
      bottomColor: "#A0B0C0",
      spread: 75,
      scatter: 25,
      seed
    },
    buttonParticipation: {
      [placementId]: {
        gradientEnabled: seed % 2 === 0,
        scatterEnabled: seed % 3 === 0
      }
    }
  };
}

function withEditorStorage(initialValue, callback, options = {}) {
  const previousWindow = globalThis.window;
  const values = new Map();
  if (initialValue !== null) {
    values.set(THEME_EDITOR_SCOPE_STATE_STORAGE_KEY, initialValue);
  }
  const storage = {
    getItem(key) {
      if (options.throwOnGet) throw new Error("storage read failed");
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (options.throwOnSet) throw new Error("storage write failed");
      values.set(key, String(value));
    }
  };
  globalThis.window = { localStorage: storage };
  try {
    return callback({
      raw: () => values.get(THEME_EDITOR_SCOPE_STATE_STORAGE_KEY) ?? null,
      replaceRaw: (value) => values.set(THEME_EDITOR_SCOPE_STATE_STORAGE_KEY, value)
    });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

function normalizedName(value) {
  return value.normalize("NFC").trim().toLocaleLowerCase("en");
}

function assertNear(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) <= 0.000001, `${message}: expected ${expected}, received ${actual}`);
}

function sourceIdentity(fileName) {
  return {
    displayProgramName: "Blender",
    displayPanelName: "Tools",
    displayFileName: fileName,
    normalizedProgramName: normalizedName("Blender"),
    normalizedPanelName: normalizedName("Tools"),
    normalizedFileName: normalizedName(fileName)
  };
}

function placement(id, buttonId, x, y, width = 20, height = 20) {
  return {
    id,
    buttonId,
    surfaceId: "panel-tools",
    x,
    y,
    width,
    height,
    zIndex: 0,
    skinOverrideId: null,
    textFitMode: "shrink",
    textAlignment: "skin",
    textOffsetX: 0,
    textOffsetY: 0,
    minimumFontSize: 8,
    textSizeOverride: null,
    allowLabelResize: false,
    matchHitboxToSkin: true,
    allowStretching: false,
    highlightOnHover: false,
    resizeAnchor: "top-left",
    activationCycle: null,
    visualStateMap: null
  };
}

function addButton(document, id, fileName, x, y, width = 20, height = 20) {
  const placementId = `placement-${id}`;
  document.buttons[id] = {
    id,
    role: "single-script",
    sourceIdentity: sourceIdentity(fileName),
    label: id,
    tooltip: "",
    executionTarget: {
      kind: "panel-script",
      programName: "Blender",
      panelName: "Tools",
      fileName
    },
    defaultSkinId: "skin-semantic",
    defaultTextFitMode: "shrink",
    disabled: false,
    activationAnimation: null,
    activationBehavior: null,
    toolSetParentId: null,
    toolSetBehavior: null,
    metadata: {}
  };
  document.placements[placementId] = placement(placementId, id, x, y, width, height);
  document.surfaces["panel-tools"].placementIds.push(placementId);
  return placementId;
}

function fixture() {
  const document = createButtonStateDocument();
  const bundled = document.skins[document.settings.defaultSkinId];
  document.skins["skin-semantic"] = {
    ...structuredClone(bundled),
    id: "skin-semantic",
    name: "Semantic Test Skin",
    base: [
      "--flowcell-button-color-surface:#102030",
      "--flowcell-button-color-accent:#405060",
      "--flowcell-button-color-ring:#708090",
      "--flowcell-button-color-text:#A0B0C0",
      "--flowcell-button-color-custom-role:#D0E0F0",
      "--effect-shadow:rgba(0,0,0,.5)"
    ].join(";"),
    compileCache: null
  };
  document.surfaces["panel-tools"] = {
    id: "panel-tools",
    name: "Blender / Tools",
    kind: "panel",
    width: 100,
    height: 80,
    placementIds: [],
    visualOverflowAllowance: 0,
    uniformButtonSize: null
  };
  addButton(document, "button-a", "a.flowcell-source.json", 10, 10);
  addButton(document, "button-b", "b.flowcell-source.json", 50, 10);
  return document;
}

function programPopoutPaletteFixture() {
  const document = fixture();
  const bundled = document.skins[document.settings.defaultSkinId];
  const sectionedSkin = (id, name, base) => {
    const skin = {
      ...structuredClone(bundled),
      id,
      name,
      base,
      compileCache: null
    };
    for (const sectionName of BUTTON_SKIN_SECTION_ORDER) {
      if (sectionName !== "base") skin[sectionName] = "";
    }
    return skin;
  };
  document.skins["skin-legacy-surface"] = sectionedSkin(
    "skin-legacy-surface",
    "Legacy Surface",
    ":root{--button-bg:#445566}.surface{background:var(--button-bg)}"
  );
  document.skins["skin-tint-material"] = sectionedSkin(
    "skin-tint-material",
    "Tint Material",
    ".surface{background:#369D8D;border-color:#3DCD9E}.label{color:#FFFFFF}"
  );

  document.buttons["button-b"].defaultSkinId = "skin-legacy-surface";
  document.buttons["button-c"] = {
    ...structuredClone(document.buttons["button-a"]),
    id: "button-c",
    label: "button-c",
    defaultSkinId: "skin-tint-material",
    sourceIdentity: sourceIdentity("c.flowcell-source.json"),
    executionTarget: {
      kind: "panel-script",
      programName: "Blender",
      panelName: "Tools",
      fileName: "c.flowcell-source.json"
    }
  };

  document.surfaces["pop-regular"] = {
    id: "pop-regular",
    name: "Blender / Tools Pop-out",
    kind: "regular-popout",
    width: 120,
    height: 100,
    placementIds: ["pop-a", "pop-b", "pop-hidden"],
    visualOverflowAllowance: 0,
    uniformButtonSize: null
  };
  document.surfaces["pop-toolset"] = {
    id: "pop-toolset",
    name: "Blender / Tools Tool Set",
    kind: "tool-set-popout",
    width: 120,
    height: 100,
    placementIds: ["pop-c"],
    visualOverflowAllowance: 0,
    uniformButtonSize: null
  };
  document.surfaces["pop-closed"] = {
    id: "pop-closed",
    name: "Blender / Tools Closed Pop-out",
    kind: "regular-popout",
    width: 120,
    height: 100,
    placementIds: ["pop-closed"],
    visualOverflowAllowance: 0,
    uniformButtonSize: null
  };
  document.placements["pop-a"] = {
    ...placement("pop-a", "button-a", 10, 5),
    surfaceId: "pop-regular"
  };
  document.placements["pop-b"] = {
    ...placement("pop-b", "button-b", 10, 40),
    surfaceId: "pop-regular"
  };
  document.placements["pop-hidden"] = {
    ...placement("pop-hidden", "button-a", 10, 70),
    surfaceId: "pop-regular"
  };
  document.placements["pop-c"] = {
    ...placement("pop-c", "button-c", 10, 75),
    surfaceId: "pop-toolset"
  };
  document.placements["pop-closed"] = {
    ...placement("pop-closed", "button-a", 10, 25),
    surfaceId: "pop-closed"
  };
  document.popoutUnits.regular = {
    id: "regular",
    name: "Regular",
    kind: "regular",
    surfaceId: "pop-regular",
    canonicalBounds: { x: 0, y: 0, width: 120, height: 100 },
    desktopBounds: null,
    memberPlacementIds: ["pop-a", "pop-b"],
    memberSourceIdentities: [
      document.buttons["button-a"].sourceIdentity,
      document.buttons["button-b"].sourceIdentity
    ],
    selectionKey: "regular",
    openRule: "toggle",
    closeRule: "escape",
    transparency: 1,
    pinnedDefault: false
  };
  document.popoutUnits.toolset = {
    id: "toolset",
    name: "Tool Set",
    kind: "tool-set",
    surfaceId: "pop-toolset",
    canonicalBounds: { x: 0, y: 0, width: 120, height: 100 },
    desktopBounds: null,
    ownerButtonId: "button-a",
    childButtonIds: ["button-c"],
    childPlacementIds: ["pop-c"],
    fields: [],
    openRule: "toggle",
    closeRule: "escape",
    interactionMode: "pop",
    ownerPlacementId: null,
    transparency: 1,
    pinnedDefault: false
  };
  document.popoutUnits.closed = {
    id: "closed",
    name: "Closed",
    kind: "regular",
    surfaceId: "pop-closed",
    canonicalBounds: { x: 0, y: 0, width: 120, height: 100 },
    desktopBounds: null,
    memberPlacementIds: ["pop-closed"],
    memberSourceIdentities: [document.buttons["button-a"].sourceIdentity],
    selectionKey: "closed",
    openRule: "toggle",
    closeRule: "escape",
    transparency: 1,
    pinnedDefault: false
  };
  document.themeOverrides["placement-button-a"] = {
    colors: { surface: "#ABCDEF" },
    hoverColor: null,
    activeColor: null,
    highlightColorReset: null
  };
  return document;
}

function liveProgramPopoutTargets() {
  return ["pop-a", "pop-b", "pop-c"].map((placementId) => ({
    paletteId: JSON.stringify([`window-${placementId}`, placementId]),
    placementId
  }));
}

function mainProgramRailGroupFixture({ withObstacle = false } = {}) {
  const document = createButtonStateDocument();
  const surface = {
    id: "surface-flowcell-main-page-program-rail",
    name: "FlowCell Main / Program Rail",
    kind: "main",
    width: 1225,
    height: 721,
    placementIds: [],
    visualOverflowAllowance: 0,
    uniformButtonSize: null
  };
  document.surfaces[surface.id] = surface;
  const slot = (index) => ({
    x: 21.039583,
    y: 125.758993 + 49.726618 * index,
    width: 131.568346,
    height: 37.294964
  });
  const slots = {
    first: slot(0),
    second: slot(1),
    third: slot(2),
    footer: {
      x: 21.039583,
      y: 646.022806,
      width: 131.568346,
      height: 37.294964
    }
  };
  const ids = {
    first: "placement-main-program-first",
    second: "placement-main-program-second",
    third: "placement-main-program-third",
    footer: "placement-main-program-footer",
    obstacle: "placement-main-program-obstacle"
  };
  const unmatchedSkin = structuredClone(document.skins[document.settings.defaultSkinId]);
  unmatchedSkin.id = "skin-main-unmatched";
  unmatchedSkin.name = "Unmatched Main Skin";
  unmatchedSkin.compileCache = null;
  document.skins[unmatchedSkin.id] = unmatchedSkin;

  const addMainButton = ({ placementId, key, label, rect, skinOverrideId = null, metadata = {} }) => {
    const buttonId = placementId.replace(/^placement-/, "button-");
    document.buttons[buttonId] = {
      id: buttonId,
      role: "single-script",
      sourceIdentity: null,
      label,
      tooltip: "",
      executionTarget: {
        kind: "core-action",
        actionId: key === "program-add" ? "add-program-folder" : "select-program-folder"
      },
      defaultSkinId: document.settings.defaultSkinId,
      defaultTextFitMode: "shrink",
      disabled: false,
      activationAnimation: null,
      activationBehavior: null,
      toolSetParentId: null,
      toolSetBehavior: null,
      metadata: {
        ...metadata,
        ...(key ? {
          mainPageSection: "Program Rail",
          mainPageControlKey: key,
          mainPageDefaultRect: structuredClone(rect)
        } : {})
      }
    };
    document.placements[placementId] = {
      ...placement(placementId, buttonId, rect.x, rect.y, rect.width, rect.height),
      surfaceId: surface.id,
      skinOverrideId
    };
    surface.placementIds.push(placementId);
  };
  addMainButton({ placementId: ids.first, key: "program-first", label: "First", rect: slots.first });
  addMainButton({ placementId: ids.second, key: "program-second", label: "Second", rect: slots.second });
  addMainButton({
    placementId: ids.third,
    key: "program-third",
    label: "Third",
    rect: slots.third,
    skinOverrideId: unmatchedSkin.id
  });
  addMainButton({ placementId: ids.footer, key: "program-add", label: "Add Program", rect: slots.footer });
  if (withObstacle) {
    addMainButton({
      placementId: ids.obstacle,
      key: "",
      label: "Independent Obstacle",
      rect: { x: 21.039583, y: 164, width: 131.568346, height: 10 }
    });
  }
  return { document, surfaceId: surface.id, ids, slots };
}

function capturedMainProgramGroup(document, placementIds) {
  const theme = captureThemeFile({
    document,
    target: { kind: "flowcell", page: "main" },
    page: defaultThemePageAppearance("main"),
    savedAt: SAVED_AT
  });
  theme.buttons = theme.buttons.filter((button) => placementIds.includes(button.placementId));
  return theme;
}

function captured(document = fixture()) {
  return captureThemeFile({ document, target: TARGET, savedAt: SAVED_AT });
}

test("Theme Editor scope state validates and persists a strict cloned value", () => {
  const state = editorScopeState(12, "placement-strict");
  assert.equal(isThemeEditorScopeState(state), true);
  assert.equal(isThemeEditorScopeState({ ...state, extra: true }), false);
  assert.equal(isThemeEditorScopeState({ ...state, gradient: null }), false);
  assert.equal(isThemeEditorScopeState({
    ...state,
    buttonParticipation: { " ": { gradientEnabled: true, scatterEnabled: false } }
  }), false);
  assert.equal(isThemeEditorScopeState({
    ...state,
    buttonParticipation: {
      "placement-strict": { gradientEnabled: true, scatterEnabled: false, extra: true }
    }
  }), false);

  withEditorStorage(null, ({ raw }) => {
    const target = { kind: "flowcell", page: "main" };
    const accepted = writeThemeEditorScopeState(target, state);
    const storedRaw = raw();
    assert.ok(storedRaw);
    state.gradient.seed = 999;
    accepted.gradient.seed = 888;
    assert.equal(readThemeEditorScopeState(target).gradient.seed, 12);

    const malformed = structuredClone(editorScopeState(13));
    malformed.gradient.seed = 1.5;
    assert.throws(
      () => writeThemeEditorScopeState(target, malformed),
      /gradient and participation state is invalid/
    );
    assert.equal(raw(), storedRaw);
  });
});

test("Theme Editor scope reads reject malformed storage without throwing", () => {
  const target = { kind: "flowcell", page: "main" };
  const malformedDocuments = [
    "{not-json",
    JSON.stringify({ version: 2, scopes: {} }),
    JSON.stringify({ version: 1, scopes: {}, extra: true }),
    JSON.stringify({
      version: 1,
      scopes: {
        [themeEditorScopeKey(target)]: {
          gradient: null,
          buttonParticipation: {}
        }
      }
    })
  ];
  withEditorStorage(malformedDocuments[0], ({ replaceRaw }) => {
    for (const malformed of malformedDocuments) {
      replaceRaw(malformed);
      assert.doesNotThrow(() => readThemeEditorScopeState(target));
      assert.equal(readThemeEditorScopeState(target), null);
    }
  });
  withEditorStorage(null, () => {
    assert.doesNotThrow(() => readThemeEditorScopeState(target));
    assert.equal(readThemeEditorScopeState(target), null);
  }, { throwOnGet: true });
  withEditorStorage(null, () => {
    const state = editorScopeState(14);
    assert.doesNotThrow(() => writeThemeEditorScopeState(target, state));
    assert.deepEqual(writeThemeEditorScopeState(target, state), state);
  }, { throwOnSet: true });
});

test("Theme Editor scope persistence isolates target, page, and panel selections", () => {
  withEditorStorage(null, ({ raw }) => {
    const entries = [
      [{ kind: "flowcell", page: "main" }, editorScopeState(21, "main")],
      [{ kind: "flowcell", page: "binds" }, editorScopeState(22, "binds")],
      [{ kind: "program", programName: "Blender", panelName: null }, editorScopeState(23, "all")],
      [{ kind: "program", programName: "Blender", panelName: null, area: "popouts" }, editorScopeState(24, "popouts")],
      [{ kind: "program", programName: "Blender", panelName: "Tools" }, editorScopeState(25, "tools")],
      [{ kind: "program", programName: "Blender", panelName: "Other" }, editorScopeState(26, "other")],
      [{ kind: "program", programName: "Illustrator", panelName: "Tools" }, editorScopeState(27, "illustrator")]
    ];
    for (const [target, state] of entries) {
      writeThemeEditorScopeState(target, state);
    }
    for (const [target, state] of entries) {
      assert.deepEqual(readThemeEditorScopeState(target), state);
    }
    assert.equal(readThemeEditorScopeState({ kind: "flowcell", page: "macro-lab" }), null);
    assert.equal(
      themeEditorScopeKey({ kind: "program", programName: " blender ", panelName: "TOOLS" }),
      themeEditorScopeKey({ kind: "program", programName: "Blender", panelName: "Tools" })
    );
    assert.notEqual(
      themeEditorScopeKey({ kind: "program", programName: "Blender", panelName: null }),
      themeEditorScopeKey({
        kind: "program",
        programName: "Blender",
        panelName: null,
        area: "popouts"
      })
    );
    assert.equal(
      themeEditorScopeKey({ kind: "program", programName: "Blender", panelName: null }),
      JSON.stringify(["program", "blender", "*"])
    );
    assert.equal(
      themeEditorScopeKey({
        kind: "program",
        programName: "Blender",
        panelName: "Tools"
      }),
      JSON.stringify(["program", "blender", "tools"])
    );
    assert.equal(
      themeEditorScopeKey({
        kind: "program",
        programName: "Blender",
        panelName: null,
        area: "popouts"
      }),
      JSON.stringify(["program", "blender", "*", "popouts"])
    );
    assert.equal(
      themeEditorScopeKey({
        kind: "program",
        programName: " blender ",
        panelName: null,
        area: "popouts"
      }),
      themeEditorScopeKey({
        kind: "program",
        programName: "Blender",
        panelName: null,
        area: "popouts"
      })
    );
    assert.deepEqual(
      readThemeEditorScopeState({ kind: "program", programName: " blender ", panelName: "TOOLS" }),
      entries[4][1]
    );
    const document = JSON.parse(raw());
    assert.equal(document.version, 1);
    assert.equal(Object.keys(document.scopes).length, entries.length);
  });
});

test("semantic color discovery supports arbitrary declared roots and excludes effects", () => {
  const document = fixture();
  const skin = document.skins["skin-semantic"];
  assert.deepEqual(
    extractSkinColorRoots(skin).map((entry) => entry.role),
    ["surface", "accent", "ring", "text", "custom-role"]
  );
  const changed = setSkinColorRoot(skin, "custom-role", "rgb(1, 2, 3)");
  assert.equal(extractSkinColorRoots(changed).find((entry) => entry.role === "custom-role")?.value, "#010203");
  assert.match(changed.base, /--effect-shadow:rgba\(0,0,0,\.5\)/);
  assert.equal(extractSkinColorRoots(changed).some((entry) => entry.role === "effect-shadow"), false);
  assert.equal(setSkinColorRoot(skin, "missing-role", "#FFFFFF").base, skin.base);
});

test("declared legacy text color remains editable without inventing a semantic root", () => {
  const source = fixture().skins["skin-semantic"];
  const skin = {
    ...source,
    base: `${source.base.replace(/--flowcell-button-color-text:[^;]+;?/i, "")};` +
      "--flowcell-button-text-color:#13579B"
  };
  assert.equal(
    extractSkinColorRoots(skin).find((entry) => entry.role === "text")?.value.toLowerCase(),
    "#13579b"
  );
  const changed = setSkinColorRoot(skin, "text", "#2468AC");
  assert.match(changed.base, /--flowcell-button-text-color:#2468ac/i);
  assert.doesNotMatch(changed.base, /--flowcell-button-color-text:/i);
});

test("version 2 schema round-trips strictly with host overrides and participation flags", () => {
  const document = fixture();
  const skin = document.skins["skin-semantic"];
  const theme = captureThemeFile({
    document,
    target: TARGET,
    savedAt: SAVED_AT,
    buttonParticipation: {
      "placement-button-a": { gradientEnabled: true, scatterEnabled: false },
      "placement-button-b": { gradientEnabled: false, scatterEnabled: false }
    }
  });
  const roundTripped = JSON.parse(JSON.stringify(theme));
  assert.equal(isFlowCellThemeFile(roundTripped), true);
  assert.equal(roundTripped.version, 2);
  assert.deepEqual(Object.keys(roundTripped).sort(), [
    "buttons",
    "gradient",
    "kind",
    "page",
    "savedAt",
    "target",
    "version"
  ]);
  for (const section of BUTTON_SKIN_SECTION_ORDER) {
    assert.equal(roundTripped.buttons[0].skin[section], skin[section]);
  }
  assert.equal(roundTripped.buttons[0].skin.id, "skin-semantic");
  assert.equal(roundTripped.buttons[0].scatterEnabled, false);
  assert.equal(roundTripped.buttons[1].gradientEnabled, false);
  assert.deepEqual(roundTripped.buttons[0].themeOverride, {
    colors: {},
    hoverEnabled: null,
    activeEnabled: null,
    hoverColor: null,
    activeColor: null
  });
  assert.equal(roundTripped.buttons[0].assignSkin, false);
  assert.equal("highlightColorReset" in roundTripped.buttons[0], false);
  assert.equal(roundTripped.page, null);

  const extraField = { ...roundTripped, runtime: {} };
  assert.equal(isFlowCellThemeFile(extraField), false);
  const behaviorLeak = structuredClone(roundTripped);
  behaviorLeak.buttons[0].executionTarget = { kind: "core-action", actionId: "must-not-save" };
  assert.equal(isFlowCellThemeFile(behaviorLeak), false);
});

test("highlight and glow amounts are backward-compatible, persist through themes, and survive skin assignment", () => {
  const document = fixture();
  const legacyShapeTheme = captured(document);
  assert.equal(
    legacyShapeTheme.buttons.every((appearance) => [
      "highlightAmount",
      "hoverHighlightAmount",
      "activeHighlightAmount",
      "hoverGlowAmount",
      "activeGlowAmount"
    ].every((field) => !(field in appearance.themeOverride))),
    true
  );
  assert.equal(isFlowCellThemeFile(legacyShapeTheme), true);

  const appearance = legacyShapeTheme.buttons.find(
    (button) => button.placementId === "placement-button-a"
  );
  appearance.themeOverride.hoverHighlightAmount = 42;
  appearance.themeOverride.activeHighlightAmount = 88;
  appearance.themeOverride.hoverGlowAmount = 35;
  appearance.themeOverride.activeGlowAmount = 73;
  const roundTripped = JSON.parse(JSON.stringify(legacyShapeTheme));
  assert.equal(isFlowCellThemeFile(roundTripped), true);
  const applied = applyThemeFile(document, roundTripped);
  assert.equal(applied.document.themeOverrides["placement-button-a"].hoverHighlightAmount, 42);
  assert.equal(applied.document.themeOverrides["placement-button-a"].activeHighlightAmount, 88);
  assert.equal(applied.document.themeOverrides["placement-button-a"].hoverGlowAmount, 35);
  assert.equal(applied.document.themeOverrides["placement-button-a"].activeGlowAmount, 73);

  for (const field of [
    "highlightAmount",
    "hoverHighlightAmount",
    "activeHighlightAmount",
    "hoverGlowAmount",
    "activeGlowAmount"
  ]) {
    const maximum = field === "hoverHighlightAmount" || field === "activeHighlightAmount"
      ? 1000
      : 100;
    for (const invalidAmount of [-1, maximum + 1, 20.5, "88"]) {
      const invalidTheme = structuredClone(roundTripped);
      invalidTheme.buttons[0].themeOverride[field] = invalidAmount;
      assert.equal(isFlowCellThemeFile(invalidTheme), false);
    }
  }

  const cleared = clearButtonThemeOverrideColors({
    colors: { surface: "#112233" },
    hoverEnabled: null,
    activeEnabled: null,
    hoverColor: "#445566",
    activeColor: "#778899",
    highlightAmount: 64,
    hoverHighlightAmount: 41,
    activeHighlightAmount: 82,
    hoverGlowAmount: 33,
    activeGlowAmount: 74
  });
  assert.deepEqual(cleared.colors, {});
  assert.equal(cleared.hoverColor, null);
  assert.equal(cleared.activeColor, null);
  assert.equal(cleared.highlightAmount, 64);
  assert.equal(cleared.hoverHighlightAmount, 41);
  assert.equal(cleared.activeHighlightAmount, 82);
  assert.equal(cleared.hoverGlowAmount, 33);
  assert.equal(cleared.activeGlowAmount, 74);
});

test("captured themes discard populated compiler caches without mutating canonical skins", () => {
  const document = fixture();
  const populatedCache = {
    compilerVersion: 1,
    sourceFingerprint: "canonical-cache-must-not-serialize"
  };
  document.skins["skin-semantic"].compileCache = structuredClone(populatedCache);

  const theme = captured(document);
  assert.equal(theme.buttons.length, 2);
  assert.equal(theme.buttons.every((button) => button.skin.compileCache === null), true);
  assert.deepEqual(document.skins["skin-semantic"].compileCache, populatedCache);
});

test("malformed theme rejection leaves the canonical document untouched", () => {
  const document = fixture();
  const malformed = structuredClone(captured(document));
  malformed.buttons[0].width = "wide";
  assert.equal(isFlowCellThemeFile(malformed), false);
  const before = JSON.stringify(document);
  assert.throws(() => applyThemeFile(document, malformed), /valid version 2/);
  assert.equal(JSON.stringify(document), before);
});

test("loading restores complete skin source without changing Button behavior", () => {
  const document = fixture();
  document.skins["skin-semantic"] = setButtonSkinHighlightOnActive(
    setButtonSkinHighlightOnHover(document.skins["skin-semantic"], true),
    false
  );
  const theme = captured(document);
  theme.buttons[0].assignSkin = true;
  theme.buttons[0].skin.base += ";--flowcell-button-color-theme-test:#224466";
  theme.buttons[0].skin.metadata = {
    ...theme.buttons[0].skin.metadata,
    themeTest: { nested: ["complete", 1, true] }
  };
  const executionBefore = structuredClone(document.buttons["button-a"].executionTarget);

  const result = applyThemeFile(document, theme);
  const placementAfter = result.document.placements["placement-button-a"];
  const appliedSkin = result.document.skins[
    placementAfter.skinOverrideId ?? result.document.buttons[placementAfter.buttonId].defaultSkinId
  ];
  for (const section of BUTTON_SKIN_SECTION_ORDER) {
    assert.equal(appliedSkin[section], theme.buttons[0].skin[section]);
  }
  assert.deepEqual(appliedSkin.metadata, theme.buttons[0].skin.metadata);
  assert.equal(appliedSkin.compileCache, null);
  assert.equal(readButtonSkinHighlightOnHover(appliedSkin), true);
  assert.equal(readButtonSkinHighlightOnActive(appliedSkin), false);
  assert.deepEqual(result.document.buttons["button-a"].executionTarget, executionBefore);
});

test("skin assignment keeps authored colors unless a later Theme color explicitly changes them", () => {
  const document = fixture();
  document.themeOverrides = {
    "placement-button-a": {
      colors: { surface: "#112233", text: "#445566", custom: "#667788" },
      hoverEnabled: true,
      activeEnabled: false,
      hoverColor: "#778899",
      activeColor: "#AABBCC"
    }
  };
  const before = structuredClone(document);
  const assignedTheme = captured(document);
  const appearance = assignedTheme.buttons.find(
    (button) => button.placementId === "placement-button-a"
  );
  appearance.assignSkin = true;
  appearance.skin = {
    ...structuredClone(appearance.skin),
    id: "skin-authored-color-test",
    name: "Authored Color Test",
    base: `${appearance.skin.base};--flowcell-button-color-surface:#237A42`,
    compileCache: null
  };
  appearance.themeOverride = clearButtonThemeOverrideColors(appearance.themeOverride);

  const assigned = applyThemeFile(document, assignedTheme);
  const assignedOverride = assigned.document.themeOverrides["placement-button-a"];
  const assignedPlacement = assigned.document.placements["placement-button-a"];
  const assignedButton = assigned.document.buttons[assignedPlacement.buttonId];
  const assignedSkin = assigned.document.skins[
    assignedPlacement.skinOverrideId ?? assignedButton.defaultSkinId
  ];
  assert.deepEqual(assignedOverride.colors, {});
  assert.equal(assignedOverride.hoverColor, null);
  assert.equal(assignedOverride.activeColor, null);
  assert.equal(assignedOverride.hoverEnabled, true);
  assert.equal(assignedOverride.activeEnabled, false);
  for (const section of BUTTON_SKIN_SECTION_ORDER) {
    assert.equal(assignedSkin[section], appearance.skin[section]);
  }
  assert.deepEqual(document, before);

  const recoloredTheme = structuredClone(assignedTheme);
  const recoloredAppearance = recoloredTheme.buttons.find(
    (button) => button.placementId === "placement-button-a"
  );
  recoloredAppearance.themeOverride.colors.surface = "#334455";
  const recolored = applyThemeFile(document, recoloredTheme);
  const recoloredOverride = recolored.document.themeOverrides["placement-button-a"];
  assert.deepEqual(recoloredOverride.colors, { surface: "#334455" });
  assert.equal(recoloredOverride.hoverColor, null);
  assert.equal(recoloredOverride.activeColor, null);
  assert.equal(recoloredOverride.hoverEnabled, true);
  assert.equal(recoloredOverride.activeEnabled, false);
  assert.deepEqual(document, before);
});

test("theme application preserves layout and writes only explicit host appearance overrides", () => {
  const source = fixture();
  Object.assign(source.placements["placement-button-a"], {
    width: 24,
    height: 22,
    textFitMode: "shrink-and-stack",
    textAlignment: "right",
    textOffsetX: 2,
    textOffsetY: -1,
    minimumFontSize: 9,
    textSizeOverride: 12,
    allowLabelResize: true,
    matchHitboxToSkin: false,
    allowStretching: true,
    highlightOnHover: true
  });
  const theme = captured(source);
  theme.buttons[0].themeOverride = {
    colors: { surface: "#334455" },
    hoverEnabled: true,
    activeEnabled: false,
    hoverColor: "#77889980",
    activeColor: null
  };
  const result = applyThemeFile(fixture(), theme);
  const placementAfter = result.document.placements["placement-button-a"];
  assert.deepEqual(
    {
      width: placementAfter.width,
      height: placementAfter.height,
      textFitMode: placementAfter.textFitMode,
      textAlignment: placementAfter.textAlignment,
      textOffsetX: placementAfter.textOffsetX,
      textOffsetY: placementAfter.textOffsetY,
      minimumFontSize: placementAfter.minimumFontSize,
      textSizeOverride: placementAfter.textSizeOverride,
      allowLabelResize: placementAfter.allowLabelResize,
      matchHitboxToSkin: placementAfter.matchHitboxToSkin,
      allowStretching: placementAfter.allowStretching,
      highlightOnHover: placementAfter.highlightOnHover
    },
    {
      width: 20,
      height: 20,
      textFitMode: "shrink",
      textAlignment: "skin",
      textOffsetX: 0,
      textOffsetY: 0,
      minimumFontSize: 8,
      textSizeOverride: null,
      allowLabelResize: false,
      matchHitboxToSkin: true,
      allowStretching: false,
      highlightOnHover: false
    }
  );
  assert.deepEqual(result.document.themeOverrides["placement-button-a"], theme.buttons[0].themeOverride);
});

test("explicit highlight color resets round-trip and clear only the requested canonical colors", () => {
  const canonical = fixture();
  canonical.themeOverrides = {
    "placement-button-a": {
      colors: { surface: "#123456", text: "#F0F0F0" },
      hoverEnabled: true,
      activeEnabled: false,
      hoverColor: "#112233",
      activeColor: "#445566"
    },
    "placement-button-b": {
      colors: { surface: "#654321" },
      hoverEnabled: false,
      activeEnabled: true,
      hoverColor: "#778899",
      activeColor: "#AABBCC"
    }
  };
  const draft = structuredClone(canonical);
  draft.themeOverrides["placement-button-a"].hoverColor = null;
  draft.themeOverrides["placement-button-b"].activeColor = null;
  const theme = captureThemeFile({
    document: draft,
    target: TARGET,
    savedAt: SAVED_AT,
    highlightColorResetPlacementIds: {
      hover: new Set(["placement-button-a"]),
      active: new Set(["placement-button-b"])
    }
  });
  const roundTripped = JSON.parse(JSON.stringify(theme));
  assert.equal(isFlowCellThemeFile(roundTripped), true);
  assert.deepEqual(roundTripped.buttons[0].highlightColorReset, {
    hover: true,
    active: false
  });
  assert.deepEqual(roundTripped.buttons[1].highlightColorReset, {
    hover: false,
    active: true
  });

  const conflicting = structuredClone(roundTripped);
  conflicting.buttons[0].themeOverride.hoverColor = "#ABCDEF";
  assert.equal(isFlowCellThemeFile(conflicting), false);

  const result = applyThemeFile(canonical, roundTripped);
  assert.deepEqual(result.document.themeOverrides["placement-button-a"], {
    colors: { surface: "#123456", text: "#F0F0F0" },
    hoverEnabled: true,
    activeEnabled: false,
    hoverColor: null,
    activeColor: "#445566"
  });
  assert.deepEqual(result.document.themeOverrides["placement-button-b"], {
    colors: { surface: "#654321" },
    hoverEnabled: false,
    activeEnabled: true,
    hoverColor: "#778899",
    activeColor: null
  });
  assert.equal(canonical.themeOverrides["placement-button-a"].hoverColor, "#112233");
  assert.equal(canonical.themeOverrides["placement-button-b"].activeColor, "#AABBCC");
});

test("adopting one applied scope drops stale highlight reset intents from other scopes", () => {
  const theme = captured();
  theme.buttons[0].highlightColorReset = { hover: true, active: false };
  const resolved = resolveThemeHighlightColorResetPlacementIds(theme, {
    [theme.buttons[0].placementId]: "canonical-main-a"
  });
  const current = {
    hover: new Set(["stale-pop-hover"]),
    active: new Set(["stale-pop-active"])
  };
  current.hover.clear();
  current.active.clear();
  resolved.hover.forEach((placementId) => current.hover.add(placementId));
  resolved.active.forEach((placementId) => current.active.add(placementId));
  assert.deepEqual([...current.hover], ["canonical-main-a"]);
  assert.deepEqual([...current.active], []);
});

test("applying per-placement colors does not clone or reassign shared skins", () => {
  const document = fixture();
  const theme = captured(document);
  theme.buttons[0].themeOverride.colors.surface = "#112233";
  theme.buttons[1].themeOverride.colors.surface = "#AABBCC";
  const beforeSkins = structuredClone(document.skins);

  const result = applyThemeFile(document, theme);
  const first = result.document.placements["placement-button-a"];
  const second = result.document.placements["placement-button-b"];
  assert.equal(result.appliedButtonCount, 2);
  assert.equal(first.skinOverrideId, null);
  assert.equal(second.skinOverrideId, null);
  assert.deepEqual(result.document.skins, beforeSkins);
  assert.equal(result.document.themeOverrides[first.id].colors.surface, "#112233");
  assert.equal(result.document.themeOverrides[second.id].colors.surface, "#AABBCC");
  assert.deepEqual(document.skins, beforeSkins);
});

test("stable identity fallback skips missing saved Buttons and leaves new Buttons intact", () => {
  const theme = captured();
  theme.buttons[0].themeOverride.colors.surface = "#123456";
  const current = fixture();
  const renamed = current.placements["placement-button-a"];
  delete current.placements[renamed.id];
  renamed.id = "placement-button-a-current";
  current.placements[renamed.id] = renamed;
  current.surfaces["panel-tools"].placementIds[0] = renamed.id;
  delete current.placements["placement-button-b"];
  delete current.buttons["button-b"];
  current.surfaces["panel-tools"].placementIds = current.surfaces["panel-tools"].placementIds.filter(
    (id) => id !== "placement-button-b"
  );
  const newPlacementId = addButton(current, "button-new", "new.flowcell-source.json", 50, 10);
  const newBefore = structuredClone(current.placements[newPlacementId]);
  const newButtonBefore = structuredClone(current.buttons["button-new"]);

  const result = applyThemeFile(current, theme);
  assert.equal(result.appliedButtonCount, 1);
  assert.equal(result.missingButtonCount, 1);
  assert.deepEqual(result.document.placements[newPlacementId], newBefore);
  assert.deepEqual(result.document.buttons["button-new"], newButtonBefore);
  assert.equal(result.document.placements[renamed.id].skinOverrideId, null);
  assert.equal(result.document.themeOverrides[renamed.id].colors.surface, "#123456");
});

test("theme application never escapes its saved target even when IDs collide", () => {
  const theme = captured();
  const current = fixture();
  for (const button of Object.values(current.buttons)) {
    if (!button.sourceIdentity) continue;
    button.sourceIdentity.displayProgramName = "Illustrator";
    button.sourceIdentity.normalizedProgramName = normalizedName("Illustrator");
    if (button.executionTarget?.kind === "panel-script") {
      button.executionTarget.programName = "Illustrator";
    }
  }
  const before = structuredClone(current);

  const result = applyThemeFile(current, theme);
  assert.equal(result.appliedButtonCount, 0);
  assert.equal(result.missingButtonCount, 2);
  assert.deepEqual(result.document, before);
});

test("program target discovery supports All, selected-panel, and Pop-outs Only scopes", () => {
  const document = fixture();
  document.surfaces["panel-other"] = {
    id: "panel-other",
    name: "Blender / Other",
    kind: "panel",
    width: 100,
    height: 80,
    placementIds: [],
    visualOverflowAllowance: 0,
    uniformButtonSize: null
  };
  const placementId = addButton(document, "button-other", "other.flowcell-source.json", 10, 40);
  document.surfaces["panel-tools"].placementIds = document.surfaces["panel-tools"].placementIds.filter(
    (id) => id !== placementId
  );
  document.placements[placementId].surfaceId = "panel-other";
  document.surfaces["panel-other"].placementIds.push(placementId);
  document.buttons["button-other"].sourceIdentity = {
    ...document.buttons["button-other"].sourceIdentity,
    displayPanelName: "Other",
    normalizedPanelName: normalizedName("Other")
  };
  document.buttons["button-other"].executionTarget.panelName = "Other";

  document.surfaces["pop-tools"] = {
    id: "pop-tools",
    name: "Blender / Tools Pop-out",
    kind: "regular-popout",
    width: 100,
    height: 80,
    placementIds: ["placement-button-a-pop"],
    visualOverflowAllowance: 0,
    uniformButtonSize: null
  };
  document.placements["placement-button-a-pop"] = {
    ...placement("placement-button-a-pop", "button-a", 10, 10),
    surfaceId: "pop-tools"
  };

  document.surfaces["tool-pop-other"] = {
    id: "tool-pop-other",
    name: "Blender / Other Tool Set Pop-out",
    kind: "tool-set-popout",
    width: 100,
    height: 80,
    placementIds: ["placement-button-other-tool-pop"],
    visualOverflowAllowance: 0,
    uniformButtonSize: null
  };
  document.placements["placement-button-other-tool-pop"] = {
    ...placement("placement-button-other-tool-pop", "button-other", 10, 10),
    surfaceId: "tool-pop-other"
  };

  document.surfaces["fan-tools"] = {
    id: "fan-tools",
    name: "Blender / Tools Legacy Fan",
    kind: "fan",
    width: 100,
    height: 80,
    placementIds: ["placement-button-b-fan"],
    visualOverflowAllowance: 0,
    uniformButtonSize: null
  };
  document.placements["placement-button-b-fan"] = {
    ...placement("placement-button-b-fan", "button-b", 10, 10),
    surfaceId: "fan-tools"
  };

  document.buttons["button-panel-owner"] = {
    ...structuredClone(document.buttons["button-a"]),
    id: "button-panel-owner",
    role: "panel-owner",
    sourceIdentity: null,
    executionTarget: { kind: "core-action", actionId: "select-panel-folder" },
    metadata: { programName: "Blender", panelName: "Tools" }
  };
  document.surfaces["main-panel-owner"] = {
    id: "main-panel-owner",
    name: "FlowCell Main / Blender Panel Owners",
    kind: "main",
    width: 100,
    height: 80,
    placementIds: ["placement-button-panel-owner"],
    visualOverflowAllowance: 0,
    uniformButtonSize: null
  };
  document.placements["placement-button-panel-owner"] = {
    ...placement("placement-button-panel-owner", "button-panel-owner", 10, 10),
    surfaceId: "main-panel-owner"
  };

  document.buttons["button-illustrator"] = {
    ...structuredClone(document.buttons["button-a"]),
    id: "button-illustrator",
    sourceIdentity: {
      ...sourceIdentity("illustrator.flowcell-source.json"),
      displayProgramName: "Illustrator",
      normalizedProgramName: normalizedName("Illustrator")
    },
    executionTarget: {
      kind: "panel-script",
      programName: "Illustrator",
      panelName: "Tools",
      fileName: "illustrator.flowcell-source.json"
    }
  };
  document.surfaces["pop-illustrator"] = {
    id: "pop-illustrator",
    name: "Illustrator / Tools Pop-out",
    kind: "regular-popout",
    width: 100,
    height: 80,
    placementIds: ["placement-button-illustrator-pop"],
    visualOverflowAllowance: 0,
    uniformButtonSize: null
  };
  document.placements["placement-button-illustrator-pop"] = {
    ...placement("placement-button-illustrator-pop", "button-illustrator", 10, 10),
    surfaceId: "pop-illustrator"
  };

  assert.equal(
    listThemePlacements(document, { kind: "program", programName: "Blender", panelName: null }).length,
    7
  );
  assert.equal(
    listThemePlacements(document, { kind: "program", programName: "Blender", panelName: "Tools" }).length,
    5
  );
  assert.equal(
    listThemePlacements(document, { kind: "program", programName: "Blender", panelName: "Other" }).length,
    2
  );
  const popoutsTarget = {
    kind: "program",
    programName: "Blender",
    panelName: null,
    area: "popouts"
  };
  assert.deepEqual(
    listThemePlacements(document, popoutsTarget).map((entry) => entry.id).sort(),
    ["placement-button-a-pop", "placement-button-other-tool-pop"]
  );

  const popoutsTheme = JSON.parse(JSON.stringify(captureThemeFile({
    document,
    target: popoutsTarget,
    savedAt: SAVED_AT
  })));
  assert.equal(isFlowCellThemeFile(popoutsTheme), true);
  assert.deepEqual(popoutsTheme.target, popoutsTarget);
  assert.deepEqual(
    popoutsTheme.buttons.map((entry) => entry.surfaceKind).sort(),
    ["regular-popout", "tool-set-popout"]
  );

  const unknownArea = structuredClone(popoutsTheme);
  unknownArea.target.area = "fans";
  assert.equal(isFlowCellThemeFile(unknownArea), false);
  const panelBoundPopouts = structuredClone(popoutsTheme);
  panelBoundPopouts.target.panelName = "Tools";
  assert.equal(isFlowCellThemeFile(panelBoundPopouts), false);
  const nonPopoutAppearance = structuredClone(popoutsTheme);
  nonPopoutAppearance.buttons[0].surfaceKind = "fan";
  assert.equal(isFlowCellThemeFile(nonPopoutAppearance), false);
});

test("popped Button palette scan groups only explicit live targets without guessing tint skins", () => {
  const document = programPopoutPaletteFixture();
  const before = structuredClone(document);
  const targets = liveProgramPopoutTargets();
  const scan = scanProgramPopoutPaletteTargets(document, "Blender", targets);
  assert.deepEqual(scan.placements.map(({ placementId }) => placementId), targets.map(({ paletteId }) => paletteId));
  const byPlacement = Object.fromEntries(scan.placements.map((entry, index) => [targets[index].placementId, entry]));
  assert.deepEqual(byPlacement["pop-a"], {
    placementId: targets[0].paletteId,
    color: "#102030",
    materialColors: []
  });
  assert.deepEqual(byPlacement["pop-b"], {
    placementId: targets[1].paletteId,
    color: "#445566",
    materialColors: []
  });
  assert.equal(byPlacement["pop-c"].color, null);
  assert.deepEqual(byPlacement["pop-c"].materialColors.sort(), ["#369D8D", "#3DCD9E"]);
  assert.equal(scan.buttonCount, 3);
  assert.equal(scan.colorCount, 4);
  assert.equal(scan.placements.some(({ placementId }) => placementId.includes("pop-closed")), false);
  assert.deepEqual(document, before, "Rescan must be read-only");
  assert.throws(
    () => scanProgramPopoutPaletteTargets(document, "Illustrator", targets),
    /stale.*Rescan/i
  );

  const unusedLegacy = structuredClone(document.skins["skin-tint-material"]);
  unusedLegacy.base = ":root{--button-bg:#010203}.surface{background:#040506}";
  const unresolved = readProgramPopoutSkinSurfaceColor(unusedLegacy);
  assert.equal(unresolved.color, null, "an unused legacy declaration is not an editable Surface root");
  assert.deepEqual(unresolved.materialColors.sort(), ["#010203", "#040506"]);
});

test("popped Button gradient targets the Fan-surface owner and members without recoloring its Main owner", () => {
  const document = programPopoutPaletteFixture();
  document.buttons["button-fan-owner"] = {
    ...structuredClone(document.buttons["button-a"]),
    id: "button-fan-owner",
    label: "Tools",
    role: "panel-owner",
    sourceIdentity: null,
    executionTarget: { kind: "core-action", actionId: "select-panel-folder" },
    metadata: { programName: "Blender", panelName: "Tools" }
  };
  document.surfaces["fan-live"] = {
    id: "fan-live",
    name: "Blender / Tools Fan",
    kind: "fan",
    width: 120,
    height: 100,
    placementIds: ["fan-owner", "fan-child"],
    visualOverflowAllowance: 0,
    uniformButtonSize: null
  };
  document.placements["fan-owner"] = {
    ...placement("fan-owner", "button-fan-owner", 10, 5),
    surfaceId: "fan-live"
  };
  document.placements["fan-child"] = {
    ...placement("fan-child", "button-a", 10, 65),
    surfaceId: "fan-live"
  };
  document.surfaces["main-fan-owner"] = {
    id: "main-fan-owner",
    name: "FlowCell Main / Blender Panel Owners",
    kind: "main",
    width: 120,
    height: 100,
    placementIds: ["main-fan-owner-placement"],
    visualOverflowAllowance: 0,
    uniformButtonSize: null
  };
  document.placements["main-fan-owner-placement"] = {
    ...placement("main-fan-owner-placement", "button-fan-owner", 10, 5),
    surfaceId: "main-fan-owner"
  };

  const targets = ["fan-owner", "fan-child"].map((placementId) => ({
    paletteId: JSON.stringify(["button-fan-tools", placementId]),
    placementId
  }));
  assert.equal(scanProgramPopoutPaletteTargets(document, "Blender", targets).buttonCount, 2);
  const assignments = gradientProgramPopoutPaletteAssignments(
    programPopoutPaletteTargetPositions(document, "Blender", targets),
    { colors: ["#000000", "#FFFFFF"], spread: 100, scatter: 0, seed: 11 }
  );
  assert.deepEqual(
    assignments.map(({ color }) => color?.toUpperCase()),
    ["#000000", "#FFFFFF"]
  );

  const applied = applyProgramPopoutPaletteTargets(document, "Blender", targets, assignments);
  assert.equal(applied.changedCount, 2);
  assert.equal(applied.document.themeOverrides["fan-owner"].colors.surface, "#000000");
  assert.equal(applied.document.themeOverrides["fan-child"].colors.surface, "#FFFFFF");
  assert.equal(
    applied.document.themeOverrides["main-fan-owner-placement"],
    undefined,
    "the same owner Button's Main placement must remain outside the exact Fan scope"
  );
  assert.throws(
    () => scanProgramPopoutPaletteTargets(document, "Blender", [
      ...targets,
      {
        paletteId: JSON.stringify(["flowcell-main", "main-fan-owner-placement"]),
        placementId: "main-fan-owner-placement"
      }
    ]),
    /stale.*Rescan/i,
    "a caller cannot smuggle the external Main owner into the Fan palette"
  );
});

test("popped Button text toggle is exact-scope and preserves surfaces, skins, highlights, and geometry", () => {
  const document = programPopoutPaletteFixture();
  const targets = liveProgramPopoutTargets();
  document.themeOverrides["pop-a"] = {
    colors: { surface: "#112233", accent: "#445566" },
    hoverEnabled: true,
    activeEnabled: false,
    hoverColor: "#778899",
    activeColor: "#AABBCC"
  };
  document.themeOverrides["pop-b"] = {
    colors: { surface: "#223344", ring: "#556677" },
    hoverEnabled: null,
    activeEnabled: true,
    hoverColor: null,
    activeColor: "#CCDDEE"
  };
  const sourceBefore = structuredClone(document);
  const surfaceScanBefore = scanProgramPopoutPaletteTargets(document, "Blender", targets);
  const structuralBefore = {
    buttons: structuredClone(document.buttons),
    placements: structuredClone(document.placements),
    surfaces: structuredClone(document.surfaces),
    popoutUnits: structuredClone(document.popoutUnits),
    skins: structuredClone(document.skins)
  };

  assert.equal(
    programPopoutPaletteTargetsHaveTextColor(document, "Blender", targets, "#000000"),
    false
  );
  const black = applyProgramPopoutTextColorTargets(document, "Blender", targets, "#000000");
  assert.equal(black.changedCount, 3);
  assert.equal(programPopoutPaletteTargetsHaveTextColor(
    black.document,
    "Blender",
    targets,
    "#000000"
  ), true);
  for (const { placementId } of targets) {
    assert.equal(black.document.themeOverrides[placementId].colors.text, "#000000");
  }
  assert.deepEqual(black.document.themeOverrides["pop-a"], {
    ...document.themeOverrides["pop-a"],
    colors: { ...document.themeOverrides["pop-a"].colors, text: "#000000" }
  });
  assert.deepEqual(black.document.themeOverrides["pop-b"], {
    ...document.themeOverrides["pop-b"],
    colors: { ...document.themeOverrides["pop-b"].colors, text: "#000000" }
  });
  assert.equal(black.document.themeOverrides["pop-closed"], undefined);
  assert.deepEqual(
    black.document.themeOverrides["placement-button-a"],
    document.themeOverrides["placement-button-a"]
  );
  assert.deepEqual(
    scanProgramPopoutPaletteTargets(black.document, "Blender", targets),
    surfaceScanBefore,
    "text toggling must not change the aggregate Surface palette"
  );
  for (const [key, value] of Object.entries(structuralBefore)) {
    assert.deepEqual(black.document[key], value, `${key} must not be changed by the text toggle`);
  }
  assert.deepEqual(document, sourceBefore, "text toggling must not mutate its source document");

  const alreadyBlack = applyProgramPopoutTextColorTargets(
    black.document,
    "Blender",
    targets,
    "#000000"
  );
  assert.equal(alreadyBlack.changedCount, 0);
  const mixed = structuredClone(black.document);
  mixed.themeOverrides["pop-c"].colors.text = "#FFFFFF";
  assert.equal(
    programPopoutPaletteTargetsHaveTextColor(mixed, "Blender", targets, "#000000"),
    false,
    "a mixed live scope must collapse to black on the next toggle"
  );
  const collapsed = applyProgramPopoutTextColorTargets(mixed, "Blender", targets, "#000000");
  assert.equal(collapsed.changedCount, 1);
  const white = applyProgramPopoutTextColorTargets(
    collapsed.document,
    "Blender",
    targets,
    "#FFFFFF"
  );
  assert.equal(white.changedCount, 3);
  assert.equal(programPopoutPaletteTargetsHaveTextColor(
    white.document,
    "Blender",
    targets,
    "#FFFFFF"
  ), true);
  assert.throws(
    () => applyProgramPopoutTextColorTargets(document, "Blender", targets, "#123456"),
    /black or white/i
  );
});

test("popped Button palette Apply is exact-scope and Refill keeps scatter placement-stable", () => {
  const document = programPopoutPaletteFixture();
  const targets = liveProgramPopoutTargets();
  const structuralBefore = {
    buttons: structuredClone(document.buttons),
    placements: structuredClone(document.placements),
    surfaces: structuredClone(document.surfaces),
    popoutUnits: structuredClone(document.popoutUnits),
    skins: structuredClone(document.skins)
  };
  const applied = applyProgramPopoutPaletteTargets(document, "Blender", targets, [
    { placementId: targets[0].paletteId, color: "#112233" },
    { placementId: targets[1].paletteId, color: "#778899" },
    { placementId: targets[2].paletteId, color: null }
  ]);
  assert.equal(applied.changedCount, 2);
  assert.equal(applied.document.themeOverrides["pop-a"].colors.surface, "#112233");
  assert.equal(applied.document.themeOverrides["pop-b"].colors.surface, "#778899");
  assert.equal(applied.document.themeOverrides["pop-c"], undefined);
  assert.equal(applied.document.themeOverrides["pop-closed"], undefined);
  assert.deepEqual(applied.document.themeOverrides["placement-button-a"], document.themeOverrides["placement-button-a"]);
  for (const [key, value] of Object.entries(structuralBefore)) {
    assert.deepEqual(applied.document[key], value, `${key} must not be changed by aggregate color Apply`);
  }
  assert.throws(
    () => applyProgramPopoutPaletteTargets(document, "Blender", targets, [
      { placementId: targets[0].paletteId, color: "#112233" },
      { placementId: targets[1].paletteId, color: "#778899" }
    ]),
    /stale.*Rescan/i
  );

  const gradient = {
    colors: ["#102030", "#708090", "#D0E0F0"],
    spread: 100,
    scatter: 80,
    seed: 17
  };
  const refill = (source, sourceTargets, value) => applyProgramPopoutPaletteTargets(
    source,
    "Blender",
    sourceTargets,
    gradientProgramPopoutPaletteAssignments(
      programPopoutPaletteTargetPositions(source, "Blender", sourceTargets),
      value
    )
  );
  const first = refill(document, targets, gradient);
  const reordered = structuredClone(document);
  reordered.surfaces["pop-regular"].placementIds.reverse();
  reordered.popoutUnits.regular.memberPlacementIds.reverse();
  const second = refill(reordered, [...targets].reverse(), gradient);
  const colorsByPlacement = (result) => Object.fromEntries(
    result.placements.map(({ placementId, color }) => [placementId, color])
  );
  assert.deepEqual(colorsByPlacement(second), colorsByPlacement(first));
  assert.equal(Object.values(colorsByPlacement(first)).every(Boolean), true);
  const reshuffled = refill(document, targets, { ...gradient, seed: 18 });
  assert.notDeepEqual(colorsByPlacement(reshuffled), colorsByPlacement(first));
  assert.deepEqual(document.buttons, structuralBefore.buttons);
  assert.deepEqual(document.placements, structuralBefore.placements);
  assert.deepEqual(document.skins, structuralBefore.skins);
});

test("popped Button gradients interpolate ordered image-color stops", () => {
  const items = [0, 25, 50, 75, 100].map((y) => ({ paletteId: `stop-${y}`, y }));
  const gradient = {
    colors: ["#000000", "#FF0000", "#FFFFFF"],
    spread: 100,
    scatter: 0,
    seed: 5
  };
  assert.deepEqual(
    gradientProgramPopoutPaletteAssignments(items, gradient, { minimumY: 0, maximumY: 100 }),
    [
      { placementId: "stop-0", color: "#000000" },
      { placementId: "stop-25", color: "#800000" },
      { placementId: "stop-50", color: "#ff0000" },
      { placementId: "stop-75", color: "#ff8080" },
      { placementId: "stop-100", color: "#ffffff" }
    ]
  );
  assert.deepEqual(
    gradientProgramPopoutPaletteAssignments(
      [{ paletteId: "centered", y: 0 }],
      { ...gradient, spread: 0 },
      { minimumY: 0, maximumY: 100 }
    ),
    [{ placementId: "centered", color: "#ff0000" }]
  );
  assert.deepEqual(
    gradientProgramPopoutPaletteAssignments(
      items,
      { ...gradient, colors: ["#2468AC", "#2468AC"] },
      { minimumY: 0, maximumY: 100 }
    ).map(({ color }) => color),
    Array(items.length).fill("#2468ac")
  );

  for (const colors of [
    ["#000000"],
    Array(17).fill("#000000"),
    ["#000000", "not-a-color"]
  ]) {
    assert.throws(
      () => gradientProgramPopoutPaletteAssignments(items, { ...gradient, colors }),
      /2 to 16 valid colors/i
    );
  }
  assert.throws(
    () => gradientProgramPopoutPaletteAssignments(
      [{ paletteId: "invalid", y: Number.NaN }],
      gradient,
      { minimumY: 0, maximumY: 100 }
    ),
    /gradient range is invalid/i
  );
  assert.throws(
    () => gradientProgramPopoutPaletteAssignments(items, { ...gradient, scatter: 101 }),
    /scatter settings are invalid/i
  );
});

test("popped Button screen gradient positions include window, envelope, monitor, and scale offsets", () => {
  const negativeMonitor = programPopoutPaletteScreenPositions({
    items: [
      { paletteId: "negative-a", y: 80 },
      { paletteId: "negative-b", y: 180 }
    ],
    visibleBounds: { Top: -900, Height: 400 },
    envelope: { y: 20, height: 200 },
    monitorWorkArea: { Top: -1080, Height: 1080 }
  });
  assert.equal(negativeMonitor[0].y, 300 / 1080);
  assert.equal(negativeMonitor[1].y, 500 / 1080);

  const scaledWindows = [
    programPopoutPaletteScreenPositions({
      items: [{ paletteId: "scaled-2x", y: 50 }],
      visibleBounds: { Top: 100, Height: 200 },
      envelope: { y: 0, height: 100 },
      monitorWorkArea: { Top: 0, Height: 1000 }
    })[0],
    programPopoutPaletteScreenPositions({
      items: [{ paletteId: "scaled-1x", y: 50 }],
      visibleBounds: { Top: 500, Height: 100 },
      envelope: { y: 0, height: 100 },
      monitorWorkArea: { Top: 0, Height: 1000 }
    })[0]
  ];
  assert.deepEqual(scaledWindows, [
    { paletteId: "scaled-2x", y: 0.2 },
    { paletteId: "scaled-1x", y: 0.55 }
  ]);
});

test("popped Button screen gradients use the explicit full-screen range", () => {
  const assignments = gradientProgramPopoutPaletteAssignments(
    [
      { paletteId: "quarter", y: 0.25 },
      { paletteId: "three-quarters", y: 0.75 }
    ],
    {
      colors: ["#000000", "#FFFFFF"],
      spread: 100,
      scatter: 0,
      seed: 1
    },
    { minimumY: 0, maximumY: 1 }
  );
  assert.deepEqual(assignments, [
    { placementId: "quarter", color: "#404040" },
    { placementId: "three-quarters", color: "#bfbfbf" }
  ]);
});

test("popped Button screen gradient positions reject invalid geometry", () => {
  const valid = {
    items: [{ paletteId: "target", y: 50 }],
    visibleBounds: { Top: 100, Height: 200 },
    envelope: { y: 0, height: 100 },
    monitorWorkArea: { Top: 0, Height: 1000 }
  };
  for (const invalid of [
    { ...valid, visibleBounds: { ...valid.visibleBounds, Height: 0 } },
    { ...valid, envelope: { ...valid.envelope, height: 0 } },
    { ...valid, monitorWorkArea: { ...valid.monitorWorkArea, Height: 0 } },
    { ...valid, visibleBounds: { ...valid.visibleBounds, Top: Number.NaN } },
    { ...valid, items: [{ paletteId: "target", y: Number.POSITIVE_INFINITY }] }
  ]) {
    assert.throws(
      () => programPopoutPaletteScreenPositions(invalid),
      /screen gradient geometry is invalid/i
    );
  }
});

test("FlowCell page registry round-trips Main background and individual rail tokens", () => {
  assert.deepEqual(FLOWCELL_THEME_PAGE_IDS, ["main", "macro-lab", "binds"]);
  assert.deepEqual(
    FLOWCELL_THEME_PAGE_REGISTRY.map((definition) => definition.id),
    FLOWCELL_THEME_PAGE_IDS
  );
  for (const definition of FLOWCELL_THEME_PAGE_REGISTRY) {
    assert.equal(new Set(definition.tokens.map((token) => token.id)).size, definition.tokens.length);
    assert.equal(
      new Set(definition.tokens.map((token) => token.cssProperty)).size,
      definition.tokens.length
    );
    assert.equal(isThemePageAppearance(defaultThemePageAppearance(definition.id)), true);
  }
  assert.equal(
    themePageSupportsButtonSurface("main", {
      id: "surface-panel-owner-main-blender-tools",
      kind: "main"
    }),
    true
  );
  assert.equal(
    themePageSupportsButtonSurface("main", {
      id: DEFAULT_BUTTON_SURFACE_ID,
      kind: "main"
    }),
    false
  );
  assert.equal(
    themePageSupportsButtonSurface("main", {
      id: "panel-tools",
      kind: "panel"
    }),
    true
  );
  const document = fixture();
  assert.equal(listThemePlacements(document, { kind: "flowcell", page: "main" }).length, 2);
  assert.equal(listThemePlacements(document, { kind: "flowcell", page: "macro-lab" }).length, 0);
  assert.equal(listThemePlacements(document, { kind: "flowcell", page: "binds" }).length, 0);
  const mainFixture = mainProgramRailGroupFixture();
  assert.equal(
    listThemePlacements(mainFixture.document, { kind: "flowcell", page: "main" }).length,
    4
  );

  const page = defaultThemePageAppearance("main");
  page.tokens["background-color"] = "#123456";
  page.tokens["rail-program-rail-background"] = "#234567";
  page.tokens["rail-panel-rail-border"] = "#345678";
  page.assets["background-image"] = { mode: "none", path: null };
  assert.equal(isThemePageAppearance(page), true);
  const cssEntries = new Map(themePageTokenCssEntries(page));
  assert.equal(cssEntries.get("--flowcell-main-background-color"), "#123456");
  assert.equal(cssEntries.get("--flowcell-main-rail-program-rail-background"), "#234567");
  assert.equal(cssEntries.get("--flowcell-main-rail-panel-rail-border"), "#345678");

  const theme = captureThemeFile({
    document,
    target: { kind: "flowcell", page: "main" },
    page,
    savedAt: SAVED_AT
  });
  assert.equal(isFlowCellThemeFile(theme), true);
  assert.deepEqual(theme.page, page);

  const missingRailToken = structuredClone(page);
  delete missingRailToken.tokens["rail-program-rail-background"];
  assert.equal(isThemePageAppearance(missingRailToken), false);
  const invalidColorToken = structuredClone(page);
  invalidColorToken.tokens["background-color"] = "not-a-color";
  assert.equal(isThemePageAppearance(invalidColorToken), false);
  const nonColorCssToken = structuredClone(page);
  nonColorCssToken.tokens["background-color"] = "12px";
  assert.equal(isThemePageAppearance(nonColorCssToken), false);
  const nonStringToken = structuredClone(page);
  nonStringToken.tokens["background-color"] = 42;
  assert.equal(isThemePageAppearance(nonStringToken), false);
  const invalidCustomAsset = structuredClone(page);
  invalidCustomAsset.assets["background-image"] = { mode: "custom", path: null };
  assert.equal(isThemePageAppearance(invalidCustomAsset), false);
  const wrongPage = structuredClone(theme);
  wrongPage.target.page = "binds";
  assert.equal(isFlowCellThemeFile(wrongPage), false);
});

test("Main Theme application never changes Button geometry or sibling layout", () => {
  const { document, ids } = mainProgramRailGroupFixture();
  const before = structuredClone(document);
  const theme = capturedMainProgramGroup(document, [ids.first, ids.second]);
  theme.buttons.find((button) => button.placementId === ids.first).height = 50;
  theme.buttons.find((button) => button.placementId === ids.second).height = 24;
  theme.buttons.find((button) => button.placementId === ids.first).themeOverride.colors.surface = "#123456";

  const result = applyThemeFile(document, theme);
  assert.equal(result.appliedButtonCount, 2);
  assert.equal(result.issues.length, 0);
  assert.deepEqual(result.document.placements, before.placements);
  assert.equal(result.document.themeOverrides[ids.first].colors.surface, "#123456");
  assert.deepEqual(document, before);
});

test("saved-skin assignment resolves one occurrence or the complete Main scope", () => {
  const { document, ids } = mainProgramRailGroupFixture();
  const target = { kind: "flowcell", page: "main" };
  const scopedPlacements = listThemePlacements(document, target);
  assert.equal(scopedPlacements.length, 4);
  assert.notEqual(
    document.placements[ids.first].skinOverrideId,
    document.placements[ids.third].skinOverrideId,
    "the scope fixture must contain Buttons with different current skin assignments"
  );
  assert.deepEqual(
    resolveThemeSkinAssignmentPlacementIds(scopedPlacements, ids.first, false),
    [ids.first]
  );
  assert.deepEqual(
    resolveThemeSkinAssignmentPlacementIds(scopedPlacements, ids.first, true),
    scopedPlacements.map((placement) => placement.id)
  );
  assert.deepEqual(
    resolveThemeSkinAssignmentPlacementIds(scopedPlacements, "placement-outside-scope", true),
    []
  );
});

test("legacy per-placement Theme clones retain one current-skin display identity", () => {
  const document = fixture();
  const source = document.skins["skin-semantic"];
  const first = document.placements["placement-button-a"];
  const second = document.placements["placement-button-b"];
  document.skins["flowcell-theme-skin-old-a"] = {
    ...structuredClone(source),
    id: "flowcell-theme-skin-old-a",
    name: "Semantic Test Skin - button-a - button-a"
  };
  document.skins["flowcell-theme-skin-old-b"] = {
    ...structuredClone(source),
    id: "flowcell-theme-skin-old-b",
    name: "Semantic Test Skin - button-b"
  };
  first.skinOverrideId = "flowcell-theme-skin-old-a";
  second.skinOverrideId = "flowcell-theme-skin-old-b";

  const firstIdentity = themeSkinAssignmentIdentity(document, first);
  const secondIdentity = themeSkinAssignmentIdentity(document, second);
  assert.equal(firstIdentity.label, "Semantic Test Skin");
  assert.equal(firstIdentity.key, secondIdentity.key);
  assert.equal(firstIdentity.key, "skin:skin-semantic");

  first.skinOverrideId = "skin-semantic";
  assert.equal(themeSkinAssignmentIdentity(document, first).key, "skin:skin-semantic");
  assert.equal(themeSkinAssignmentIdentity(document, first).key, secondIdentity.key);
});

test("obsolete Theme size values are ignored for Main Buttons with or without obstacles", () => {
  const oversizeFixture = mainProgramRailGroupFixture();
  const oversizeBefore = structuredClone(oversizeFixture.document);
  const oversizeTheme = capturedMainProgramGroup(
    oversizeFixture.document,
    [oversizeFixture.ids.first, oversizeFixture.ids.second]
  );
  oversizeTheme.buttons.forEach((button) => {
    button.width = 400;
  });
  const oversizeResult = applyThemeFile(oversizeFixture.document, oversizeTheme);
  assert.equal(oversizeResult.appliedButtonCount, 2);
  assert.equal(oversizeResult.skippedButtonCount, 0);
  assert.equal(oversizeResult.issues.length, 0);
  assert.deepEqual(oversizeResult.document.placements, oversizeBefore.placements);
  assert.deepEqual(oversizeResult.document, oversizeBefore);
  assert.deepEqual(oversizeFixture.document, oversizeBefore);

  const obstacleFixture = mainProgramRailGroupFixture({ withObstacle: true });
  const obstacleBefore = structuredClone(obstacleFixture.document);
  const obstacleTheme = capturedMainProgramGroup(
    obstacleFixture.document,
    [obstacleFixture.ids.first, obstacleFixture.ids.second]
  );
  obstacleTheme.buttons.find((button) => button.placementId === obstacleFixture.ids.first).height = 50;
  obstacleTheme.buttons.find((button) => button.placementId === obstacleFixture.ids.second).height = 24;
  const obstacleResult = applyThemeFile(obstacleFixture.document, obstacleTheme);
  assert.equal(obstacleResult.appliedButtonCount, 2);
  assert.equal(obstacleResult.skippedButtonCount, 0);
  assert.equal(obstacleResult.issues.length, 0);
  assert.deepEqual(obstacleResult.document.placements, obstacleBefore.placements);
  assert.deepEqual(obstacleResult.document, obstacleBefore);
  assert.deepEqual(obstacleFixture.document, obstacleBefore);
});

test("unregistered Main controls remain fixed and ignore Theme layout fields", () => {
  const appearanceFixture = mainProgramRailGroupFixture({ withObstacle: true });
  const appearanceBefore = structuredClone(appearanceFixture.document);
  const appearanceTheme = capturedMainProgramGroup(
    appearanceFixture.document,
    [appearanceFixture.ids.obstacle]
  );
  appearanceTheme.buttons[0].textAlignment = "right";
  const applied = applyThemeFile(appearanceFixture.document, appearanceTheme);
  assert.equal(applied.appliedButtonCount, 1);
  assert.equal(applied.skippedButtonCount, 0);
  assert.deepEqual(applied.matchedPlacementIds, {
    [appearanceFixture.ids.obstacle]: appearanceFixture.ids.obstacle
  });
  assert.deepEqual(
    {
      x: applied.document.placements[appearanceFixture.ids.obstacle].x,
      y: applied.document.placements[appearanceFixture.ids.obstacle].y,
      width: applied.document.placements[appearanceFixture.ids.obstacle].width,
      height: applied.document.placements[appearanceFixture.ids.obstacle].height
    },
    {
      x: appearanceBefore.placements[appearanceFixture.ids.obstacle].x,
      y: appearanceBefore.placements[appearanceFixture.ids.obstacle].y,
      width: appearanceBefore.placements[appearanceFixture.ids.obstacle].width,
      height: appearanceBefore.placements[appearanceFixture.ids.obstacle].height
    }
  );
  assert.equal(
    applied.document.placements[appearanceFixture.ids.obstacle].textAlignment,
    appearanceBefore.placements[appearanceFixture.ids.obstacle].textAlignment
  );
  assert.deepEqual(appearanceFixture.document, appearanceBefore);

  const resizeFixture = mainProgramRailGroupFixture({ withObstacle: true });
  const resizeBefore = structuredClone(resizeFixture.document);
  const resizeTheme = capturedMainProgramGroup(
    resizeFixture.document,
    [resizeFixture.ids.obstacle]
  );
  resizeTheme.buttons[0].width += 1;
  const rejected = applyThemeFile(resizeFixture.document, resizeTheme);
  assert.equal(rejected.appliedButtonCount, 1);
  assert.equal(rejected.skippedButtonCount, 0);
  assert.deepEqual(rejected.matchedPlacementIds, {
    [resizeFixture.ids.obstacle]: resizeFixture.ids.obstacle
  });
  assert.equal(rejected.issues.length, 0);
  assert.deepEqual(rejected.document.placements, resizeBefore.placements);
  assert.deepEqual(resizeFixture.document, resizeBefore);
});

test("deployed vertical centers include the Button Section origin only for panel surfaces", () => {
  const panelDocument = fixture();
  const panelPlacement = panelDocument.placements["placement-button-a"];
  assert.equal(
    themePlacementDeployedCenterY(panelDocument, panelPlacement, TARGET),
    buttonsSurfaceContentOrigin.y + panelPlacement.y + panelPlacement.height / 2
  );

  const { document: mainDocument, ids } = mainProgramRailGroupFixture();
  const mainPlacement = mainDocument.placements[ids.first];
  assert.equal(
    themePlacementDeployedCenterY(
      mainDocument,
      mainPlacement,
      { kind: "flowcell", page: "main" }
    ),
    mainPlacement.y + mainPlacement.height / 2
  );
});

test("gradient scatter is stable until Reshuffle changes the seed", () => {
  const gradient = {
    role: "surface",
    topColor: "#000000",
    bottomColor: "#FFFFFF",
    spread: 100,
    scatter: 80,
    seed: 41
  };
  const args = {
    placementId: "placement-button-a",
    y: 50,
    minimumY: 0,
    maximumY: 100,
    gradient
  };
  const first = gradientColorForPlacement(args);
  assert.equal(gradientColorForPlacement(args), first);
  assert.notEqual(
    gradientColorForPlacement({ ...args, gradient: { ...gradient, seed: 42 } }),
    first
  );
  assert.equal(
    gradientColorForPlacement({ ...args, y: 0, gradient: { ...gradient, scatter: 0 } }),
    "#000000"
  );
  assert.equal(
    gradientColorForPlacement({ ...args, y: 100, gradient: { ...gradient, scatter: 0 } }),
    "#ffffff"
  );
});

test("full-scope capture and gradient baking preserve the exact placement set", () => {
  const { document } = mainProgramRailGroupFixture();
  const target = { kind: "flowcell", page: "main" };
  const scopedIds = listThemePlacements(document, target)
    .map((placement) => placement.id)
    .sort();
  const theme = captureThemeFile({
    document,
    target,
    page: defaultThemePageAppearance("main"),
    gradient: {
      role: "surface",
      topColor: "#102030",
      bottomColor: "#A0B0C0",
      spread: 100,
      scatter: 0,
      seed: 17
    },
    savedAt: SAVED_AT
  });
  const capturedIds = theme.buttons.map((appearance) => appearance.placementId).sort();
  assert.deepEqual(capturedIds, scopedIds);

  const baked = bakeThemeGradientForDeployedLayout(document, theme);
  assert.equal(baked.layout.issues.length, 0);
  assert.equal(baked.layout.appliedButtonCount, scopedIds.length);
  assert.deepEqual(Object.keys(baked.colorsBySavedPlacementId).sort(), scopedIds);
  assert.deepEqual(
    baked.theme.buttons.map((appearance) => appearance.placementId).sort(),
    scopedIds
  );
});

test("gradient baking uses current deployed positions without changing Main layout", () => {
  const { document, ids } = mainProgramRailGroupFixture();
  const beforeSkins = structuredClone(document.skins);
  const theme = capturedMainProgramGroup(document, [ids.first, ids.second, ids.third]);
  const gradient = {
    role: "surface",
    topColor: "#000000",
    bottomColor: "#FFFFFF",
    spread: 100,
    scatter: 0,
    seed: 17
  };
  theme.gradient = gradient;
  theme.buttons.forEach((appearance) => {
    appearance.gradientEnabled = true;
    appearance.scatterEnabled = false;
  });
  theme.buttons.find((appearance) => appearance.placementId === ids.first).height = 50;
  theme.buttons.find((appearance) => appearance.placementId === ids.second).height = 24;

  const staleCenters = Object.fromEntries(theme.buttons.map((appearance) => {
    const current = document.placements[appearance.placementId];
    return [
      appearance.placementId,
      themePlacementDeployedCenterY(document, current, theme.target)
    ];
  }));
  const baked = bakeThemeGradientForDeployedLayout(document, theme);
  assert.equal(baked.layout.issues.length, 0);
  assert.equal(baked.layout.appliedButtonCount, 3);
  assert.deepEqual(Object.keys(baked.colorsBySavedPlacementId).sort(), [ids.first, ids.second, ids.third].sort());
  assert.deepEqual(document.skins, beforeSkins);
  assert.deepEqual(baked.layout.document.skins, beforeSkins);
  const deployedCenters = Object.fromEntries(theme.buttons.map((appearance) => {
    const matchedId = baked.layout.matchedPlacementIds[appearance.placementId];
    const deployed = baked.layout.document.placements[matchedId];
    return [
      appearance.placementId,
      themePlacementDeployedCenterY(baked.layout.document, deployed, theme.target)
    ];
  }));
  const deployedValues = Object.values(deployedCenters);
  const deployedMinimum = Math.min(...deployedValues);
  const deployedMaximum = Math.max(...deployedValues);
  const staleValues = Object.values(staleCenters);
  const staleMinimum = Math.min(...staleValues);
  const staleMaximum = Math.max(...staleValues);

  for (const appearance of theme.buttons) {
    const expected = gradientColorForPlacement({
      placementId: appearance.placementId,
      y: deployedCenters[appearance.placementId],
      minimumY: deployedMinimum,
      maximumY: deployedMaximum,
      gradient
    });
    assert.equal(baked.colorsBySavedPlacementId[appearance.placementId], expected);
    const bakedAppearance = baked.theme.buttons.find(
      (candidate) => candidate.placementId === appearance.placementId
    );
    assert.equal(bakedAppearance.themeOverride.colors[gradient.role].toLowerCase(), expected.toLowerCase());
  }
  const staleMiddle = gradientColorForPlacement({
    placementId: ids.second,
    y: staleCenters[ids.second],
    minimumY: staleMinimum,
    maximumY: staleMaximum,
    gradient
  });
  assert.equal(deployedCenters[ids.second], staleCenters[ids.second]);
  assert.equal(baked.colorsBySavedPlacementId[ids.second], staleMiddle);
});

test("unchanged Button Section themes preserve every placement geometry", () => {
  const document = fixture();
  Object.assign(document.placements["placement-button-b"], { x: 64, y: 47 });
  const beforeGeometry = Object.fromEntries(
    Object.entries(document.placements).map(([placementId, current]) => [
      placementId,
      { x: current.x, y: current.y, width: current.width, height: current.height }
    ])
  );
  const result = applyThemeFile(document, captured(document));
  assert.equal(result.appliedButtonCount, 2);
  assert.equal(result.issues.length, 0);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(result.document.placements).map(([placementId, current]) => [
        placementId,
        { x: current.x, y: current.y, width: current.width, height: current.height }
      ])
    ),
    beforeGeometry
  );
});

test("Button Section Theme values never resize or realign placements", () => {
  const document = fixture();
  const before = structuredClone(document);
  const theme = captured(document);
  theme.buttons.forEach((appearance) => {
    appearance.width = 30;
    appearance.height = 20;
  });
  const applied = applyThemeFile(document, theme);
  assert.equal(applied.issues.length, 0);
  assert.deepEqual(
    {
      x: applied.document.placements["placement-button-a"].x,
      y: applied.document.placements["placement-button-a"].y
    },
    { x: 10, y: 10 }
  );
  assert.equal(applied.document.placements["placement-button-b"].x, 50);
  assert.equal(applied.document.placements["placement-button-b"].y, 10);
  assert.deepEqual(applied.document.placements, before.placements);
  assert.deepEqual(document, before);
});

test("oversize Button Section values are ignored instead of touching layout", () => {
  const document = fixture();
  const oversize = captured(document);
  oversize.buttons.forEach((appearance) => {
    appearance.width = 90;
    appearance.height = 20;
  });
  const failed = applyThemeFile(document, oversize);
  assert.equal(failed.appliedButtonCount, 2);
  assert.equal(failed.skippedButtonCount, 0);
  assert.deepEqual(Object.keys(failed.matchedPlacementIds).sort(), [
    "placement-button-a",
    "placement-button-b"
  ]);
  assert.equal(failed.issues.length, 0);
  assert.deepEqual(failed.document, document);
});
