import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as defaults from "./.compiled-button-system/button/state/buttonDefaults.js";
import * as theme from "./.compiled-button-system/theme/programPopoutTheme.js";
import * as mapping from "./.compiled-button-system/button/runtime/toolPackageMapping.js";
import * as palette from "./.compiled-button-system/theme/programPopoutPalette.js";
import * as popoutOperations from "./.compiled-button-system/button/state/buttonPopoutInteractionOperations.js";
import * as panelOwners from "./.compiled-button-system/button/state/panelOwnerButtonOperations.js";
import * as windowThemes from "./.compiled-button-system/button/windows/buttonWindowThemeDocument.js";
import * as themeModel from "./.compiled-button-system/theme/themeModel.js";

const source = readFileSync(new URL("../src/pages/installed-page/installedPageCoreBroker.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const identity = { ownerButtonId: "theme-owner", programName: "Blender", panelName: "toolset", fileName: "theme.py", pageId: "blender.theme" };

function harness(hooks = {}) {
  let document = defaults.createButtonStateDocument();
  const initial = theme.captureProgramPopoutThemeSettings(document, "Blender");
  document.programPopoutThemes = { krita: structuredClone(initial) };
  let saves = 0;
  const commits = [];
  const windows = new Map();
  const drafts = new Map();
  const draftListeners = new Map();
  let storedPackage;
  const module = { exports: {} };
  const imports = {
    "../../button/state/buttonDefaults": defaults,
    "../../theme/programPopoutTheme.js": theme,
    "../../theme/programPopoutPalette.js": { ...palette, scanProgramPopoutPaletteTargets: (...args) => {
      hooks.onScan?.();
      return palette.scanProgramPopoutPaletteTargets(...args);
    } },
    "../../theme/themeModel.js": themeModel,
    "../../button/state/buttonPopoutInteractionOperations": popoutOperations,
    "../../button/state/panelOwnerButtonOperations": panelOwners,
    "../../button/windows/buttonWindowThemeDocument": windowThemes,
    "../../button/runtime/toolPackageMapping.js": mapping,
    "../../lib/layoutSnapshots.js": { readRegisteredLayoutWindow: (label) => windows.get(label) },
    "@tauri-apps/api/webviewWindow": {
      WebviewWindow: { getAll: async () => [...windows.keys()].map((label) => ({
        label, isVisible: async () => { await hooks.beforeVisibility?.(label); return true; }, isMinimized: async () => false
      })) }
    },
    "@tauri-apps/api/window": {
      getCurrentWindow: () => ({ label: "theme-page" }),
      monitorFromPoint: async (x, y) => { await hooks.beforeMonitor?.(x, y); return { workArea: { position: { x: 0, y: 0 }, size: { width: 1000, height: 800 } } }; }
    },
    "../../button/state/ButtonStateRepository": {
      loadButtonStateDocument: async () => structuredClone(document),
      saveButtonStateDocument: async (next, revision) => {
        assert.equal(revision, document.revision);
        document = structuredClone({ ...next, revision: revision + 1 });
        saves += 1;
        return structuredClone(document);
      }
    },
    "../../button/state/ButtonDraftBus": {
      publishButtonCommit: async (next) => commits.push(structuredClone(next)),
      publishButtonDraft: async (sessionId, next) => drafts.set(sessionId, structuredClone(next)),
      createButtonDraftRequestId: () => "test-request",
      subscribeButtonDrafts: async (sessionId, handler) => {
        draftListeners.set(sessionId, handler);
        return () => draftListeners.delete(sessionId);
      },
      requestButtonDraft: async (sessionId) => draftListeners.get(sessionId)?.(structuredClone(drafts.get(sessionId)))
    },
    "@tauri-apps/api/core": {
      invoke: async (command, args) => {
        if (command === "resolve_tool_package_root") return "C:/themes";
        if (command === "save_tool_package") {
          storedPackage = structuredClone({ format: "blender-theme", name: "Theme", manifestPath: args.manifestPath, assets: {}, values: args.values });
          return args.manifestPath;
        }
        if (command === "load_tool_package") return structuredClone(storedPackage);
        throw new Error(`Unexpected native call: ${command}`);
      }
    },
    "../../lib/tauri": {
      showSaveFileDialog: async () => "C:/themes/Theme.json",
      showOpenFileDialog: async () => ["C:/themes/Theme.json"]
    }
  };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, require: (name) => imports[name] ?? {}, console, structuredClone,
    window: { setTimeout, clearTimeout }
  });
  const run = (capability, options, payload = {}) => module.exports.runInstalledPageCoreAction(identity, "test", { kind: "core-action", capability, options, payload });
  return { run, initial, commits, windows, drafts, get document() { return document; }, get saves() { return saves; } };
}

function addLivePopout(h, { collapsed = false, draftSessionId } = {}) {
  const doc = h.document;
  doc.buttons.owner = {
    id: "owner", role: "panel-owner", metadata: { programName: "Blender", panelName: "Tools" },
    defaultSkinId: doc.settings.defaultSkinId, label: "Tools"
  };
  doc.placements.owner = {
    id: "owner", buttonId: "owner", surfaceId: "pop", x: 0, y: 40, width: 20, height: 20,
    zIndex: 0, skinOverrideId: null, highlightOnHover: false
  };
  doc.surfaces.pop = {
    id: "pop", name: "Tools", kind: "regular-popout", width: 100, height: 100,
    placementIds: ["owner"], visualOverflowAllowance: 0, uniformButtonSize: null
  };
  doc.popoutUnits.unit = {
    id: "unit", name: "Tools", kind: "regular", surfaceId: "pop", interactionMode: "fan",
    ownerPlacementId: "owner", ownerButtonId: "owner", memberPlacementIds: [],
    canonicalBounds: { x: 0, y: 0, width: 100, height: 100 },
    desktopBoundsEnvelope: { x: 0, y: 0, width: 100, height: 100 },
    desktopBounds: { left: 0, top: 100, width: 200, height: 200 }
  };
  h.windows.set("live", {
    kind: "button-popout", programName: "Blender", buttonPopoutUnitId: "unit",
    buttonDisplayMode: collapsed ? "collapsed" : "expanded",
    ...(draftSessionId ? { buttonDraftSessionId: draftSessionId, buttonPopoutSettingsPath: "C:/settings.json" } : {}),
    snapshotBounds: collapsed
      ? { Left: 0, Top: 300, Width: 40, Height: 40 }
      : { Left: 0, Top: 100, Width: 200, Height: 200 }
  });
  doc.programPopoutThemes.blender = {
    ...h.initial, colors: ["#000000", "#FFFFFF"], spread: 100, scatter: 0, screenTopToBottom: true
  };
  if (draftSessionId) {
    const draft = structuredClone(doc);
    delete draft.programPopoutThemes.blender;
    h.drafts.set(draftSessionId, draft);
  }
}

function addLiveMember(h, id, y) {
  const doc = h.document;
  doc.buttons[id] = { ...doc.buttons.owner, id, label: id };
  doc.placements[id] = { ...doc.placements.owner, id, buttonId: id, y };
  doc.surfaces.pop.placementIds.push(id);
  doc.popoutUnits.unit.memberPlacementIds.push(id);
}

test("individual fill and selected text edits override the shared gradient without changing other Buttons or the recipe", async () => {
  const h = harness();
  addLivePopout(h);
  addLiveMember(h, "middle", 60);
  addLiveMember(h, "bottom", 80);
  const recipe = structuredClone(h.document.programPopoutThemes.blender);
  const before = structuredClone(h.document);
  const scan = await h.run("button-theme.palette", { operation: "scan" });
  assert.equal(scan.placements[0].label, "Tools");
  assert.equal(scan.placements[0].groupLabel, "Tools");
  const fill = await h.run("button-theme.palette", { operation: "edit" }, {
    expectedRevision: scan.revision, edits: [{ placementId: scan.placements[0].placementId, color: "#12AB34" }]
  });
  assert.equal(fill.placements[0].color, "#12AB34");
  assert.equal(fill.placements[0].textColor, recipe.textColor);
  assert.deepEqual(fill.placements.slice(1), scan.placements.slice(1));
  const text = await h.run("button-theme.palette", { operation: "edit" }, {
    expectedRevision: fill.revision,
    edits: fill.placements.slice(0, 2).map(({ placementId }) => ({ placementId, textColor: "#DDEE11" }))
  });
  assert.deepEqual(Array.from(text.placements, ({ textColor }) => textColor), ["#DDEE11", "#DDEE11", recipe.textColor]);
  assert.deepEqual(text.placements.map(({ color }) => color), fill.placements.map(({ color }) => color));
  assert.deepEqual(h.document.programPopoutThemes.blender, recipe);
  for (const key of ["buttons", "skins", "placements", "popoutUnits", "themeOverrides"]) assert.deepEqual(h.document[key], before[key], key);
  assert.equal(h.saves, 2, "one save for the whole selected group");
});

test("stale scans, mixed valid/invalid edits and foreign targets reject atomically", async () => {
  const h = harness(); addLivePopout(h);
  const scan = await h.run("button-theme.palette", { operation: "scan" });
  const before = structuredClone(h.document);
  for (const edits of [
    [{ placementId: scan.placements[0].placementId, textColor: "#000000" }, { placementId: "foreign", color: "#FF0000" }],
    [{ placementId: scan.placements[0].placementId, color: "bad-color" }]
  ]) await assert.rejects(h.run("button-theme.palette", { operation: "edit" }, { expectedRevision: scan.revision, edits }));
  await assert.rejects(h.run("button-theme.palette", { operation: "edit" }, {
    expectedRevision: scan.revision - 1, edits: [{ placementId: scan.placements[0].placementId, color: "#FF0000" }]
  }));
  assert.deepEqual(h.document, before);
  assert.equal(h.saves, 0);
});

test("effects retain manual colors; global text replaces only text and package reset replaces both even for the same recipe", async () => {
  const h = harness(); addLivePopout(h);
  const scan = await h.run("button-theme.palette", { operation: "scan" });
  await h.run("button-theme.palette", { operation: "edit" }, {
    expectedRevision: scan.revision, edits: [{ placementId: scan.placements[0].placementId, color: "#112233", textColor: "#AABBCC" }]
  });
  const settings = { ...h.document.programPopoutThemes.blender, hoverGlowAmount: 12 };
  await h.run("button-theme.palette", { operation: "settings" }, { settings });
  assert.deepEqual(h.document.programPopoutColorOverrides.owner, { surface: "#112233", text: "#AABBCC" });
  await h.run("button-theme.palette", { operation: "settings" }, { settings: { ...settings, textColor: "#000000" } });
  assert.deepEqual(h.document.programPopoutColorOverrides.owner, { surface: "#112233" });
  await h.run("button-theme.palette", { operation: "settings" }, { settings: h.document.programPopoutThemes.blender, resetOverrides: true });
  assert.equal(h.document.programPopoutColorOverrides.owner, undefined);
});

test("curve-only Apply publishes state effects and package restore preserves fractional frozen amounts", async () => {
  const h = harness(); addLivePopout(h); addLiveMember(h, "bottom", 80);
  const flat = (y) => [{ x: 0, y, mode: "corner" }, { x: 1, y, mode: "corner" }];
  const settings = { ...h.document.programPopoutThemes.blender,
    idleEnabled: true, idleHighlightAmount: 275, idleGlowAmount: 10,
    hoverHighlightAmount: 625, activeHighlightAmount: 1000, hoverGlowAmount: 16, activeGlowAmount: 42,
    highlightCurve: flat(0.1), activeHighlightCurve: flat(0.2755), glowCurve: flat(0.54), hoverGlowCurve: flat(0.13), activeGlowCurve: flat(0.3) };
  await h.run("button-theme.palette", { operation: "settings" }, { settings });
  assert.deepEqual(h.document.programPopoutThemes.blender, settings);
  assert.equal(h.commits.length, 1);
  const expected = theme.resolveProgramPopoutThemeOverride(h.document, "owner");
  const expectedBottom = theme.resolveProgramPopoutThemeOverride(h.document, "bottom");
  assert.equal(expected.idleHighlightAmount, 27.5);
  assert.equal(expected.activeHighlightAmount, 275.5);
  assert.ok(Math.abs(expected.activeGlowAmount - 12.6) < 1e-9);
  let scan = await h.run("button-theme.palette", { operation: "scan" });
  await h.run("button-theme.palette", { operation: "participation" }, {
    expectedRevision: scan.revision, placementIds: [scan.placements[0].placementId], enabled: false
  });
  assert.deepEqual(h.document.programPopoutThemeLocks.owner, expected);
  const captured = await h.run("button-theme.palette", { operation: "settings" }, { captureAppearance: true });
  await h.run("button-theme.palette", { operation: "settings" }, {
    settings: { ...settings, activeGlowCurve: flat(1), activeHighlightCurve: flat(1) }
  });
  assert.deepEqual(theme.resolveProgramPopoutThemeOverride(h.document, "owner"), expected, "unchecked Button keeps fractional effects");
  assert.equal(theme.resolveProgramPopoutThemeOverride(h.document, "bottom").activeGlowAmount, 42);
  await h.run("button-theme.palette", { operation: "settings" }, {
    settings: JSON.parse(JSON.stringify(captured.settings)), buttonAppearance: JSON.parse(JSON.stringify(captured.buttonAppearance)), resetOverrides: true
  });
  assert.deepEqual(h.document.programPopoutThemeLocks.owner, expected);
  assert.deepEqual(h.document.programPopoutThemes.blender, settings);
  assert.deepEqual(theme.resolveProgramPopoutThemeOverride(h.document, "bottom"), expectedBottom, "restored state curves reach participating Buttons");
});

test("aggregate bucket editing changes exact assignments without replacing the shared gradient or freezing unchanged members", async () => {
  const h = harness(); addLivePopout(h); addLiveMember(h, "bottom", 80);
  const recipe = structuredClone(h.document.programPopoutThemes.blender);
  const scan = await h.run("button-theme.palette", { operation: "scan" });
  const result = await h.run("button-theme.palette", { operation: "apply" }, {
    expectedRevision: scan.revision,
    assignments: scan.placements.map(({ placementId, color }, index) => ({ placementId, color: index === 0 ? "#225588" : color }))
  });
  assert.equal(result.placements[0].color, "#225588");
  assert.equal(h.document.programPopoutColorOverrides.bottom, undefined);
  assert.deepEqual(h.document.programPopoutThemes.blender, recipe);
});

test("settings-backed edits with canonical IDs survive canonical appearance overlay", async () => {
  const h = harness(); addLivePopout(h, { draftSessionId: "draft" });
  const scan = await h.run("button-theme.palette", { operation: "scan" });
  await h.run("button-theme.palette", { operation: "edit" }, {
    expectedRevision: scan.revision, edits: [{ placementId: scan.placements[0].placementId, textColor: "#CC9900" }]
  });
  const nextScan = await h.run("button-theme.palette", { operation: "scan" });
  assert.equal(nextScan.placements[0].textColor, "#CC9900");
  assert.equal(h.document.programPopoutColorOverrides.owner.text, "#CC9900");
});

test("transient settings-backed edits survive refresh and reset immediately on package application", async () => {
  const h = harness(); addLivePopout(h, { draftSessionId: "draft" });
  const draft = h.drafts.get("draft");
  draft.placements.transient = { ...draft.placements.owner, id: "transient" };
  delete draft.placements.owner;
  draft.surfaces.pop.placementIds = ["transient"];
  draft.popoutUnits.unit.ownerPlacementId = "transient";
  const scan = await h.run("button-theme.palette", { operation: "scan" });
  await h.run("button-theme.palette", { operation: "edit" }, {
    expectedRevision: scan.revision, edits: [{ placementId: scan.placements[0].placementId, color: "#FFCC22", textColor: "#224466" }]
  });
  let nextScan = await h.run("button-theme.palette", { operation: "scan" });
  assert.equal(nextScan.placements[0].color, "#FFCC22");
  assert.equal(nextScan.placements[0].textColor, "#224466");
  const originalDraft = structuredClone(h.drafts.get("draft"));
  await h.run("button-theme.palette", { operation: "settings" }, { settings: h.document.programPopoutThemes.blender, resetOverrides: true });
  assert.deepEqual(h.drafts.get("draft"), originalDraft, "fast package application does not enumerate or rewrite drafts");
  nextScan = await h.run("button-theme.palette", { operation: "scan" });
  assert.equal(nextScan.placements[0].color, "#000000");
  assert.equal(nextScan.placements[0].textColor, h.document.programPopoutThemes.blender.textColor);
});

test("settings read is nonmutating; apply saves with no open windows and preserves other program state", async () => {
  const h = harness();
  const before = structuredClone(h.document);
  const read = await h.run("button-theme.palette", { operation: "settings" });
  assert.equal(read.configured, false);
  assert.equal(h.saves, 0);
  const settings = { ...h.initial, colors: ["#123456", "#FEDCBA"], hoverGlowAmount: 16, activeGlowAmount: 42 };
  const applied = await h.run("button-theme.palette", { operation: "settings" }, { settings });
  assert.equal(applied.configured, true);
  assert.deepEqual(h.document.programPopoutThemes.blender, settings);
  assert.deepEqual(h.document.programPopoutThemes.krita, before.programPopoutThemes.krita);
  for (const key of ["buttons", "placements", "skins", "surfaces", "themeOverrides", "popoutUnits", "fanSetups", "settings"]) {
    assert.deepEqual(h.document[key], before[key], key);
  }
  assert.equal(h.commits.length, 1);
  await h.run("button-theme.palette", { operation: "settings" }, { settings });
  assert.equal(h.saves, 1, "unchanged settings do not write another revision");
});

test("invalid package settings cannot modify canonical popout appearance", async () => {
  const h = harness();
  await assert.rejects(h.run("button-theme.palette", { operation: "settings" }, {
    settings: { ...h.initial, activeGlowAmount: 101 }
  }), /settings are invalid/);
  assert.equal(h.saves, 0);
});

for (const operation of ["settings", "apply"]) {
  test(`unchanged native-ordered settings do not save or broadcast through ${operation}`, async () => {
    const h = harness();
    const settings = { ...h.initial, colors: ["#123456", "#FEDCBA"] };
    // Rust's persisted JSON map orders keys alphabetically instead of retaining
    // the order returned by normalizeProgramPopoutThemeSettings.
    h.document.programPopoutThemes.blender = Object.fromEntries(
      Object.entries(settings).sort(([left], [right]) => left.localeCompare(right))
    );
    assert.notEqual(JSON.stringify(h.document.programPopoutThemes.blender), JSON.stringify(settings));
    const revision = h.document.revision;
    const scanned = operation === "apply"
      ? await h.run("button-theme.palette", { operation: "scan" })
      : null;
    await h.run("button-theme.palette", { operation }, {
      settings,
      ...(scanned ? { expectedRevision: scanned.revision, assignments: [] } : {})
    });
    assert.equal(h.document.revision, revision);
    assert.equal(h.saves, 0, "semantically unchanged settings never rewrite canonical state");
    assert.equal(h.commits.length, 0, "semantically unchanged settings never repaint every Button window");
  });
}

test("generic package save/open round-trips complete popout settings independently of Button identities", async () => {
  const h = harness();
  const flat = (y) => [{ x: 0, y, mode: "corner" }, { x: 1, y, mode: "corner" }];
  const settings = { ...h.initial, colors: ["#00FF00", "#002200"], activeHighlightAmount: 151, activeGlowAmount: 42,
    highlightCurve: flat(1), activeHighlightCurve: flat(0.37), glowCurve: flat(0.3), hoverGlowCurve: flat(0.13), activeGlowCurve: flat(0.54) };
  const options = { capability: "theme-package-library", storageFolder: "blender_themes", formatId: "blender-theme", valueFields: ["popped_button_settings"], assetFields: [] };
  await h.run("tool-package.save", options, { values: { popped_button_settings: settings } });
  const loaded = await h.run("tool-package.open", options);
  assert.deepEqual(loaded.fieldPatch.popped_button_settings, settings);
  assert.equal(h.saves, 0, "package IO alone never changes Button state");
});

test("package captures manual colors and restores exact colors without baking the gradient", async () => {
  const h = harness(); addLivePopout(h); addLiveMember(h, "bottom", 80);
  const scan = await h.run("button-theme.palette", { operation: "scan" });
  await h.run("button-theme.palette", { operation: "edit" }, {
    expectedRevision: scan.revision, edits: [{ placementId: scan.placements[0].placementId, color: "#123456", textColor: "#ABCDEF" }]
  });
  const captured = await h.run("button-theme.palette", { operation: "settings" }, { captureAppearance: true });
  assert.deepEqual(JSON.parse(JSON.stringify(captured.buttonAppearance)), {
    version: 1, placements: [{ placementId: "owner", buttonId: "owner", color: "#123456", textColor: "#ABCDEF" }]
  });
  assert.equal(captured.placementLinks[0].paletteId, scan.placements[0].placementId);
  const settings = { ...captured.settings, colors: ["#112233", "#334455"] };
  await h.run("button-theme.palette", { operation: "settings" }, { settings, resetOverrides: true });
  assert.equal(h.document.programPopoutColorOverrides.owner, undefined);
  await h.run("button-theme.palette", { operation: "settings" }, {
    settings: captured.settings, resetOverrides: true, buttonAppearance: captured.buttonAppearance
  });
  assert.deepEqual(h.document.programPopoutColorOverrides.owner, { surface: "#123456", text: "#ABCDEF" });
  assert.equal(h.document.programPopoutColorOverrides.bottom, undefined, "unchanged gradient Buttons stay dynamic");
  assert.deepEqual(h.document.programPopoutThemes.blender, JSON.parse(JSON.stringify(captured.settings)));
});

test("participation freezes exact appearance, saves locks, protects current locks and re-enables", async () => {
  const h = harness(); addLivePopout(h); addLiveMember(h, "bottom", 80);
  let scan = await h.run("button-theme.palette", { operation: "scan" });
  assert.equal(scan.placements[0].enabled, true);
  scan = await h.run("button-theme.palette", { operation: "participation" }, {
    expectedRevision: scan.revision, placementIds: [scan.placements[0].placementId], enabled: false
  });
  assert.equal(scan.placements[0].enabled, false);
  const frozen = structuredClone(h.document.programPopoutThemeLocks.owner);
  const captured = await h.run("button-theme.palette", { operation: "settings" }, { captureAppearance: true });
  assert.deepEqual(JSON.parse(JSON.stringify(captured.buttonAppearance.placements[0].lockedAppearance)), frozen);
  await h.run("button-theme.palette", { operation: "settings" }, {
    settings: { ...captured.settings, colors: ["#FF0000"] }, resetOverrides: true,
    buttonAppearance: { version: 1, placements: [{ placementId: "owner", buttonId: "owner", color: "#00FF00" }] }
  });
  assert.deepEqual(h.document.programPopoutThemeLocks.owner, frozen);
  scan = await h.run("button-theme.palette", { operation: "scan" });
  assert.equal(scan.placements[0].color, frozen.colors.surface);
  scan = await h.run("button-theme.palette", { operation: "participation" }, {
    expectedRevision: scan.revision, placementIds: [scan.placements[0].placementId], enabled: true
  });
  assert.equal(scan.placements[0].enabled, true);
  assert.equal(scan.placements[0].color, "#FF0000");
  await h.run("button-theme.palette", { operation: "settings" }, {
    settings: captured.settings, resetOverrides: true, buttonAppearance: captured.buttonAppearance
  });
  assert.deepEqual(h.document.programPopoutThemeLocks.owner, frozen, "saved unchecked participation is restored");
});

test("appearance restore rejects malformed records atomically and never hits a renamed identity", async () => {
  const h = harness(); addLivePopout(h);
  const before = structuredClone(h.document);
  const settings = h.document.programPopoutThemes.blender;
  await assert.rejects(h.run("button-theme.palette", { operation: "settings" }, { settings, resetOverrides: true,
    buttonAppearance: { version: 1, placements: [{ placementId: "owner", buttonId: "owner", color: "bad" }] }
  }));
  assert.deepEqual(h.document, before);
  await h.run("button-theme.palette", { operation: "settings" }, { settings, resetOverrides: true,
    buttonAppearance: { version: 1, placements: [{ placementId: "owner", buttonId: "different", color: "#AABBCC" }] }
  });
  assert.equal(h.document.programPopoutColorOverrides?.owner, undefined);
});

test("package capture and restore include closed canonical Buttons and live draft-only identities", async () => {
  const h = harness(); addLivePopout(h, { draftSessionId: "draft" });
  const draft = h.drafts.get("draft");
  draft.buttons.transient = { ...draft.buttons.owner, id: "transient", label: "Transient" };
  draft.placements.transient = { ...draft.placements.owner, id: "transient", buttonId: "transient", y: 80 };
  draft.surfaces.pop.placementIds.push("transient");
  draft.popoutUnits.unit.memberPlacementIds.push("transient");
  let scan = await h.run("button-theme.palette", { operation: "scan" });
  scan = await h.run("button-theme.palette", { operation: "edit" }, {
    expectedRevision: scan.revision, edits: scan.placements.map(({ placementId }, index) => ({ placementId, color: index ? "#334455" : "#112233" }))
  });
  scan = await h.run("button-theme.palette", { operation: "participation" }, {
    expectedRevision: scan.revision, placementIds: [scan.placements[1].placementId], enabled: false
  });
  assert.equal(h.document.programPopoutThemeLocks?.transient, undefined, "draft-only identity never invents canonical placements");
  const captured = await h.run("button-theme.palette", { operation: "settings" }, { captureAppearance: true });
  assert.equal(captured.buttonAppearance.placements.length, 2);
  assert.equal(captured.buttonAppearance.placements.find(({ placementId }) => placementId === "transient").lockedAppearance.colors.surface, "#334455");
  // Re-enable the draft Button, then restoring the package reinstates its saved unchecked state.
  await h.run("button-theme.palette", { operation: "participation" }, {
    expectedRevision: scan.revision, placementIds: [scan.placements[1].placementId], enabled: true
  });
  await h.run("button-theme.palette", { operation: "settings" }, { settings: captured.settings, resetOverrides: true, buttonAppearance: captured.buttonAppearance });
  assert.equal(h.drafts.get("draft").programPopoutThemeLocks.transient.colors.surface, "#334455");
  h.windows.clear();
  const closed = await h.run("button-theme.palette", { operation: "settings" }, { captureAppearance: true });
  assert.equal(closed.buttonAppearance.placements.find(({ placementId }) => placementId === "owner").color, "#112233");
  await h.run("button-theme.palette", { operation: "settings" }, { settings: captured.settings, resetOverrides: true });
  await h.run("button-theme.palette", { operation: "settings" }, { settings: captured.settings, resetOverrides: true, buttonAppearance: closed.buttonAppearance });
  assert.equal(h.document.programPopoutColorOverrides.owner.surface, "#112233");
});

test("checkbox scope probes native windows concurrently and reuses its rendered response for the revision guard", async () => {
  let hold = true;
  const visibility = [], monitors = [];
  let scans = 0;
  const h = harness({
    beforeVisibility: (label) => hold ? new Promise((resolve) => visibility.push({ label, resolve })) : undefined,
    beforeMonitor: (x, y) => hold ? new Promise((resolve) => monitors.push({ x, y, resolve })) : undefined,
    onScan: () => { scans += 1; }
  });
  addLivePopout(h);
  for (const suffix of ["-b", "-a"]) {
    const doc = h.document;
    const id = `owner${suffix}`, surfaceId = `pop${suffix}`, unitId = `unit${suffix}`;
    doc.buttons[id] = { ...doc.buttons.owner, id, label: id };
    doc.placements[id] = { ...doc.placements.owner, id, buttonId: id, surfaceId };
    doc.surfaces[surfaceId] = { ...doc.surfaces.pop, id: surfaceId, placementIds: [id] };
    doc.popoutUnits[unitId] = { ...doc.popoutUnits.unit, id: unitId, surfaceId, ownerPlacementId: id, ownerButtonId: id };
    h.windows.set(`live${suffix}`, { ...h.windows.get("live"), buttonPopoutUnitId: unitId });
  }
  const pending = h.run("button-theme.palette", { operation: "scan" });
  await new Promise(setImmediate);
  assert.equal(visibility.length, 3, "all visibility checks start before any resolves");
  for (const entry of [...visibility].reverse()) entry.resolve();
  await new Promise(setImmediate);
  assert.equal(monitors.length, 3, "all independent monitor queries start before any resolves");
  for (const entry of [...monitors].reverse()) entry.resolve();
  const scan = await pending;
  assert.deepEqual(JSON.parse(JSON.stringify(scan.placements.map(({ label }) => label))), ["Tools", "owner-a", "owner-b"]);
  assert.equal(scans, 1, "scan result and revision fingerprint share one rendered palette");
  hold = false;
  scans = 0;
  const checked = await h.run("button-theme.palette", { operation: "participation" }, {
    expectedRevision: scan.revision, placementIds: [scan.placements[0].placementId], enabled: false
  });
  assert.equal(checked.placements[0].enabled, false);
  assert.equal(scans, 2, "one fresh guard scan and one shared response/fingerprint scan (the core helper's internal scan is separate)");
  h.document.placements.owner.y += 2;
  await assert.rejects(h.run("button-theme.palette", { operation: "participation" }, {
    expectedRevision: checked.revision, placementIds: [checked.placements[0].placementId], enabled: true
  }), /changed after the last scan/);
  assert.ok(h.document.programPopoutThemeLocks.owner, "fresh stale protection is not bypassed for speed");
});

test("explicit manual edits to an unchecked Button save its updated frozen color", async () => {
  const h = harness(); addLivePopout(h);
  let scan = await h.run("button-theme.palette", { operation: "scan" });
  scan = await h.run("button-theme.palette", { operation: "participation" }, {
    expectedRevision: scan.revision, placementIds: [scan.placements[0].placementId], enabled: false
  });
  scan = await h.run("button-theme.palette", { operation: "edit" }, {
    expectedRevision: scan.revision, edits: [{ placementId: scan.placements[0].placementId, color: "#123456", textColor: "#ABCDEF" }]
  });
  assert.equal(scan.placements[0].enabled, false);
  assert.equal(scan.placements[0].color, "#123456");
  const captured = await h.run("button-theme.palette", { operation: "settings" }, { captureAppearance: true });
  const savedLock = captured.buttonAppearance.placements[0].lockedAppearance;
  assert.equal(savedLock.colors.surface, "#123456");
  assert.equal(savedLock.colors.text, "#ABCDEF");
  await h.run("button-theme.palette", { operation: "settings" }, {
    settings: { ...captured.settings, colors: ["#FF0000"] }, resetOverrides: true, buttonAppearance: captured.buttonAppearance
  });
  assert.deepEqual(h.document.programPopoutThemeLocks.owner, JSON.parse(JSON.stringify(savedLock)));
});

test("screen scans resolve canonical rules over stale settings-backed drafts", async () => {
  const h = harness();
  addLivePopout(h, { draftSessionId: "settings-draft" });
  const response = await h.run("button-theme.palette", { operation: "scan" });
  assert.equal(response.placements[0].color, "#000000", "a sole visible row uses the exact top color regardless of monitor offset");
  assert.equal(h.saves, 0);
  assert.equal(h.drafts.get("settings-draft").programPopoutThemes.blender, undefined, "scanning must preserve the editor's source draft");
});

test("collapsed Fan scans use the displayed owner center without requiring expansion", async () => {
  const h = harness();
  addLivePopout(h, { collapsed: true });
  const response = await h.run("button-theme.palette", { operation: "scan" });
  assert.equal(response.placements[0].color, "#000000", "the sole collapsed owner anchors the occupied range");
  const text = await h.run("button-theme.palette", { operation: "toggle-text" });
  assert.equal(text.placements[0].color, "#000000");
  const refill = await h.run("button-theme.palette", { operation: "refill" }, {
    colors: ["#000000", "#FFFFFF"], spread: 100, scatter: 0, seed: 0, screenTopToBottom: true
  });
  assert.equal(refill.placements[0].color, "#000000", "applying a gradient also works while collapsed");
});

test("applying a profile that enables screen gradients returns the new visible colors", async () => {
  const h = harness();
  addLivePopout(h);
  h.document.programPopoutThemes.blender.screenTopToBottom = false;
  const scanned = await h.run("button-theme.palette", { operation: "scan" });
  assert.equal(scanned.placements[0].color, "#000000");
  const settings = { ...h.document.programPopoutThemes.blender, screenTopToBottom: true };
  const response = await h.run("button-theme.palette", { operation: "apply" }, {
    expectedRevision: scanned.revision, settings, assignments: scanned.placements.map(({ placementId, color }) => ({ placementId, color }))
  });
  assert.equal(response.placements[0].color, "#000000");
  const nextScan = await h.run("button-theme.palette", { operation: "scan" });
  assert.equal(nextScan.placements[0].color, response.placements[0].color);
});
