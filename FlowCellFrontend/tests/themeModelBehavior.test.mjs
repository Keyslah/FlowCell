import assert from "node:assert/strict";
import test from "node:test";
import {
  applyThemeFile,
  bakeThemeGradientForDeployedLayout,
  captureThemeFile,
  extractSkinColorRoots,
  gradientColorForPlacement,
  isFlowCellThemeFile,
  listThemePlacements,
  setSkinColorRoot,
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
      bundled.base,
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
      [{ kind: "program", programName: "Blender", panelName: "Tools" }, editorScopeState(24, "tools")],
      [{ kind: "program", programName: "Blender", panelName: "Other" }, editorScopeState(25, "other")],
      [{ kind: "program", programName: "Illustrator", panelName: "Tools" }, editorScopeState(26, "illustrator")]
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
    assert.deepEqual(
      readThemeEditorScopeState({ kind: "program", programName: " blender ", panelName: "TOOLS" }),
      entries[3][1]
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

test("version 1 schema round-trips strictly with complete skins and participation flags", () => {
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
  assert.equal(roundTripped.page, null);

  const extraField = { ...roundTripped, runtime: {} };
  assert.equal(isFlowCellThemeFile(extraField), false);
  const behaviorLeak = structuredClone(roundTripped);
  behaviorLeak.buttons[0].executionTarget = { kind: "core-action", actionId: "must-not-save" };
  assert.equal(isFlowCellThemeFile(behaviorLeak), false);
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
  assert.throws(() => applyThemeFile(document, malformed), /valid version 1/);
  assert.equal(JSON.stringify(document), before);
});

test("loading restores complete skin source without changing Button behavior", () => {
  const document = fixture();
  document.skins["skin-semantic"] = setButtonSkinHighlightOnActive(
    setButtonSkinHighlightOnHover(document.skins["skin-semantic"], true),
    false
  );
  const theme = captured(document);
  theme.buttons[0].skin.metadata = {
    ...theme.buttons[0].skin.metadata,
    themeTest: { nested: ["complete", 1, true] }
  };
  const executionBefore = structuredClone(document.buttons["button-a"].executionTarget);

  const result = applyThemeFile(document, theme);
  const placementAfter = result.document.placements["placement-button-a"];
  const appliedSkin = result.document.skins[placementAfter.skinOverrideId];
  for (const section of BUTTON_SKIN_SECTION_ORDER) {
    assert.equal(appliedSkin[section], theme.buttons[0].skin[section]);
  }
  assert.deepEqual(appliedSkin.metadata, theme.buttons[0].skin.metadata);
  assert.equal(appliedSkin.compileCache, null);
  assert.equal(readButtonSkinHighlightOnHover(appliedSkin), true);
  assert.equal(readButtonSkinHighlightOnActive(appliedSkin), false);
  assert.deepEqual(result.document.buttons["button-a"].executionTarget, executionBefore);
});

test("button size and skin-owned placement visual settings round-trip", () => {
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
    }
  );
});

test("applying a shared saved skin creates independent per-placement appearances", () => {
  const document = fixture();
  const theme = captured(document);
  theme.buttons[0].skin = setSkinColorRoot(theme.buttons[0].skin, "surface", "#112233");
  theme.buttons[1].skin = setSkinColorRoot(theme.buttons[1].skin, "surface", "#AABBCC");

  const result = applyThemeFile(document, theme);
  const first = result.document.placements["placement-button-a"];
  const second = result.document.placements["placement-button-b"];
  assert.equal(result.appliedButtonCount, 2);
  assert.notEqual(first.skinOverrideId, second.skinOverrideId);
  assert.equal(
    extractSkinColorRoots(result.document.skins[first.skinOverrideId]).find((entry) => entry.role === "surface")?.value,
    "#112233"
  );
  assert.equal(
    extractSkinColorRoots(result.document.skins[second.skinOverrideId]).find((entry) => entry.role === "surface")?.value,
    "#AABBCC"
  );
  assert.equal(
    extractSkinColorRoots(document.skins["skin-semantic"]).find((entry) => entry.role === "surface")?.value,
    "#102030"
  );
});

test("stable identity fallback skips missing saved Buttons and leaves new Buttons intact", () => {
  const theme = captured();
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
  assert.match(result.document.placements[renamed.id].skinOverrideId, /^flowcell-theme-skin-/);
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

test("program target discovery supports All Panels and one selected panel", () => {
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

  assert.equal(
    listThemePlacements(document, { kind: "program", programName: "Blender", panelName: null }).length,
    3
  );
  assert.equal(
    listThemePlacements(document, { kind: "program", programName: "Blender", panelName: "Tools" }).length,
    2
  );
  assert.equal(
    listThemePlacements(document, { kind: "program", programName: "Blender", panelName: "Other" }).length,
    1
  );
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
  const document = fixture();
  assert.equal(listThemePlacements(document, { kind: "flowcell", page: "main" }).length, 2);
  assert.equal(listThemePlacements(document, { kind: "flowcell", page: "macro-lab" }).length, 0);
  assert.equal(listThemePlacements(document, { kind: "flowcell", page: "binds" }).length, 0);

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

test("Main Program Rail reflows themed siblings as one ordered centered group", () => {
  const { document, ids, slots } = mainProgramRailGroupFixture();
  const before = structuredClone(document);
  const theme = capturedMainProgramGroup(document, [ids.first, ids.second]);
  theme.buttons.find((button) => button.placementId === ids.first).height = 50;
  theme.buttons.find((button) => button.placementId === ids.second).height = 24;

  const result = applyThemeFile(document, theme);
  assert.equal(result.appliedButtonCount, 2);
  assert.equal(result.issues.length, 0);
  const first = result.document.placements[ids.first];
  const second = result.document.placements[ids.second];
  const third = result.document.placements[ids.third];
  const footer = result.document.placements[ids.footer];
  const templateGap = slots.second.y - slots.first.y - slots.first.height;
  assert.equal(first.y < second.y && second.y < third.y, true);
  assertNear(second.y - first.y - first.height, templateGap, "first-to-second template gap");
  assertNear(third.y - second.y - second.height, templateGap, "second-to-third template gap");
  const templateCenter = (
    slots.first.y + slots.third.y + slots.third.height
  ) / 2;
  const packedCenter = (first.y + third.y + third.height) / 2;
  assertNear(packedCenter, templateCenter, "Program list group center");
  for (const id of [ids.first, ids.second, ids.third]) {
    const oldPlacement = before.placements[id];
    const nextPlacement = result.document.placements[id];
    assert.notEqual(
      nextPlacement.y + nextPlacement.height / 2,
      oldPlacement.y + oldPlacement.height / 2
    );
  }
  assert.deepEqual(
    {
      width: third.width,
      height: third.height,
      skinOverrideId: third.skinOverrideId
    },
    {
      width: before.placements[ids.third].width,
      height: before.placements[ids.third].height,
      skinOverrideId: before.placements[ids.third].skinOverrideId
    }
  );
  assert.notEqual(third.y, before.placements[ids.third].y);
  assert.deepEqual(footer, before.placements[ids.footer]);
  assert.deepEqual(document, before);
});

test("Main Program Rail oversize and obstacle failures leave the whole surface unchanged", () => {
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
  assert.equal(oversizeResult.appliedButtonCount, 0);
  assert.equal(oversizeResult.skippedButtonCount, 2);
  assert.equal(oversizeResult.issues.length, 1);
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
  assert.equal(obstacleResult.appliedButtonCount, 0);
  assert.equal(obstacleResult.skippedButtonCount, 2);
  assert.equal(obstacleResult.issues.length, 1);
  assert.deepEqual(obstacleResult.document, obstacleBefore);
  assert.deepEqual(obstacleFixture.document, obstacleBefore);
});

test("unregistered Main controls remain fixed when themed and reject sizing atomically", () => {
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
    "right"
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
  assert.equal(rejected.appliedButtonCount, 0);
  assert.equal(rejected.skippedButtonCount, 1);
  assert.deepEqual(rejected.matchedPlacementIds, {});
  assert.equal(rejected.issues.length, 1);
  assert.deepEqual(rejected.document, resizeBefore);
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

test("gradient baking uses Main positions after size-driven group reflow", () => {
  const { document, ids } = mainProgramRailGroupFixture();
  Object.values(document.skins).forEach((skin) => {
    skin.base = `${skin.base};--flowcell-button-color-surface:#102030`;
    skin.compileCache = null;
  });
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
    assert.equal(
      extractSkinColorRoots(bakedAppearance.skin)
        .find((root) => root.role === gradient.role)?.value.toLowerCase(),
      expected.toLowerCase()
    );
  }
  const staleMiddle = gradientColorForPlacement({
    placementId: ids.second,
    y: staleCenters[ids.second],
    minimumY: staleMinimum,
    maximumY: staleMaximum,
    gradient
  });
  assert.notEqual(deployedCenters[ids.second], staleCenters[ids.second]);
  assert.notEqual(baked.colorsBySavedPlacementId[ids.second], staleMiddle);
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

test("Button Section sizing uses top-left alignment and keeps the visual anchor fixed", () => {
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
  assert.equal(applied.document.placements["placement-button-b"].x, 40);
  assert.equal(applied.document.placements["placement-button-b"].y, 10);
  assert.equal(
    applied.document.placements["placement-button-a"].x +
      applied.document.placements["placement-button-a"].width <=
      applied.document.placements["placement-button-b"].x,
    true
  );
  assert.deepEqual(document, before);
});

test("oversize Button Section application aborts the whole surface atomically", () => {
  const document = fixture();
  const oversize = captured(document);
  oversize.buttons.forEach((appearance) => {
    appearance.width = 90;
    appearance.height = 20;
  });
  const failed = applyThemeFile(document, oversize);
  assert.equal(failed.appliedButtonCount, 0);
  assert.equal(failed.skippedButtonCount, 2);
  assert.deepEqual(Object.keys(failed.matchedPlacementIds), []);
  assert.equal(failed.issues.length, 1);
  assert.deepEqual(failed.document, document);
});
