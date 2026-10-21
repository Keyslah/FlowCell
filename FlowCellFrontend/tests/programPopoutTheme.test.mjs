import assert from "node:assert/strict";
import test from "node:test";
import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { createButtonSourceIdentity } from "./.compiled-button-system/button/state/sourceIdentity.js";
import { validateButtonStateDocument } from "./.compiled-button-system/button/state/buttonStateValidation.js";
import {
  captureProgramPopoutThemeSettings,
  clearProgramPopoutColorOverrides,
  normalizeProgramPopoutThemeLock,
  normalizeProgramPopoutThemeSettings,
  resolveProgramPopoutThemeOverride
} from "./.compiled-button-system/theme/programPopoutTheme.js";
import {
  programPopoutPaletteTargetsHaveTextColor,
  applyProgramPopoutColorEdits,
  applyProgramPopoutPaletteTargets,
  applyProgramPopoutTextColorTargets,
  applyProgramPopoutThemeLocks,
  gradientProgramPopoutPaletteAssignments,
  normalizedProgramPopoutScreenPositions,
  scanProgramPopoutPaletteTargets
} from "./.compiled-button-system/theme/programPopoutPalette.js";
import { removeOwnedButtonGraph } from "./.compiled-button-system/button/state/buttonDocumentOperations.js";
import {
  normalizeProgramPopoutGradientCurve,
  programPopoutGradientBoxPosition,
  programPopoutGradientCurveValue
} from "./.compiled-button-system/theme/programPopoutGradient.js";
import {
  aggregateProgramPopoutThemeScreenRange,
  programPopoutThemeWindowRange
} from "./.compiled-button-system/button/windows/programPopoutThemeScreenRange.js";

function settings(patch = {}) {
  return {
    version: 1, colors: ["#000000", "#FFFFFF"], spread: 100, scatter: 0, seed: 23,
    screenTopToBottom: false, textColor: "#FFFFFF", hoverEnabled: true, activeEnabled: true,
    hoverColor: "#123456", activeColor: "#FEDCBA", hoverHighlightAmount: 66,
    activeHighlightAmount: 151, hoverGlowAmount: 16, activeGlowAmount: 42, ...patch
  };
}

function addPlacement(document, id, surfaceId, kind, programName = "Blender", y = 0) {
  document.surfaces[surfaceId] ??= {
    id: surfaceId, name: surfaceId, kind, width: 200, height: 1000,
    placementIds: [], visualOverflowAllowance: 0, uniformButtonSize: null
  };
  document.buttons[id] = {
    id, role: "single-script", sourceIdentity: createButtonSourceIdentity(programName, "Tools", `${id}.ahk`),
    label: id, tooltip: "", executionTarget: { kind: "panel-script", programName, panelName: "Tools", fileName: `${id}.ahk` },
    defaultSkinId: document.settings.defaultSkinId, defaultTextFitMode: "shrink", disabled: false,
    activationAnimation: null, activationBehavior: null, toolSetParentId: null, toolSetBehavior: null, metadata: {}
  };
  document.placements[id] = {
    id, buttonId: id, surfaceId, x: 0, y, width: 20, height: 20, zIndex: 0, skinOverrideId: null,
    textFitMode: "shrink", textAlignment: "skin", textOffsetX: 0, textOffsetY: 0, minimumFontSize: 8,
    textSizeOverride: null, allowLabelResize: false, matchHitboxToSkin: true, allowStretching: false,
    highlightOnHover: false, resizeAnchor: "top-left", activationCycle: null, visualStateMap: null
  };
  document.surfaces[surfaceId].placementIds.push(id);
  document.themeOverrides[id] = {
    colors: { surface: "#AA0000", text: "#000000", accent: "#00AA00" }, hoverEnabled: false,
    activeEnabled: false, hoverColor: null, activeColor: null, hoverHighlightAmount: 108,
    activeHighlightAmount: 233, hoverGlowAmount: 16, activeGlowAmount: 72
  };
  return id;
}

test("individual popped fill and text edits override a shared profile for the exact selected subset", () => {
  const document = createButtonStateDocument();
  document.programPopoutThemes = { blender: settings({ colors: ["#113355"] }) };
  addPlacement(document, "first", "Blender Tools", "regular-popout");
  addPlacement(document, "second", "Blender Tools", "regular-popout", "Blender", 50);
  addPlacement(document, "krita", "Krita Tools", "regular-popout", "Krita");
  const targets = ["first", "second"].map((id) => ({ placementId: id, paletteId: `live:${id}` }));
  const before = structuredClone(document);
  const result = applyProgramPopoutColorEdits(document, "Blender", targets, [
    { placementId: "live:first", color: "#DD6622", textColor: "#102030" }
  ]);
  assert.equal(result.changedCount, 1);
  const first = resolveProgramPopoutThemeOverride(result.document, "first");
  assert.equal(first.colors.surface, "#DD6622");
  assert.equal(first.colors.text, "#102030");
  assert.equal(first.activeGlowAmount, 42);
  assert.equal(resolveProgramPopoutThemeOverride(result.document, "second").colors.surface, "#113355");
  assert.deepEqual(result.placements[0], {
    placementId: "live:first", label: "first", groupLabel: "Blender Tools", textColor: "#102030",
    color: "#DD6622", materialColors: [], enabled: true
  });
  assert.deepEqual(result.document.programPopoutColorOverrideRevisions.blender, { surface: 0, text: 0 });
  assert.deepEqual(result.document.skins, before.skins);
  assert.deepEqual(result.document.themeOverrides, before.themeOverrides);
  assert.deepEqual(document, before);
  assert.equal(validateButtonStateDocument(result.document).valid, true);
});

test("unchecked Buttons freeze every appearance channel through settings, bulk colors and package resets", () => {
  const document = createButtonStateDocument();
  document.programPopoutThemes = { blender: settings({ idleEnabled: true, idleColor: "#223344", idleHighlightAmount: 29, idleGlowAmount: 12 }) };
  addPlacement(document, "first", "tools", "regular-popout");
  addPlacement(document, "second", "tools", "regular-popout", "Blender", 50);
  const targets = ["first", "second"].map((id) => ({ placementId: id, paletteId: `live:${id}` }));
  const original = structuredClone(document);
  const expected = resolveProgramPopoutThemeOverride(document, "first");
  const frozen = applyProgramPopoutThemeLocks(document, "Blender", targets, [{ placementId: "live:first", enabled: false }]);
  assert.deepEqual(frozen.document.programPopoutThemeLocks.first, expected);
  assert.equal(frozen.placements[0].enabled, false);
  assert.equal(frozen.placements[1].enabled, true);
  assert.deepEqual(document, original);
  assert.deepEqual(frozen.document.skins, original.skins);
  assert.equal(validateButtonStateDocument(frozen.document).valid, true);
  let changed = structuredClone(frozen.document);
  changed = applyProgramPopoutPaletteTargets(changed, "Blender", targets, targets.map(({ paletteId }) => ({ placementId: paletteId, color: "#123456" }))).document;
  changed = applyProgramPopoutTextColorTargets(changed, "Blender", targets, "#000000").document;
  changed.programPopoutThemes.blender = settings({ colors: ["#AABBCC"], textColor: "#00FF00", hoverEnabled: false, activeGlowAmount: 0 });
  clearProgramPopoutColorOverrides(changed, "Blender", ["surface", "text"], true);
  assert.deepEqual(resolveProgramPopoutThemeOverride(changed, "first"), expected);
  assert.deepEqual(changed.themeOverrides.first, original.themeOverrides.first, "bulk writes cannot modify frozen placement overrides");
  const restored = JSON.parse(JSON.stringify(changed));
  assert.deepEqual(resolveProgramPopoutThemeOverride(restored, "first"), expected);
  const enabled = applyProgramPopoutThemeLocks(restored, "Blender", targets, [{ placementId: "live:first", enabled: true }]);
  assert.equal(enabled.placements[0].enabled, true);
  assert.equal(resolveProgramPopoutThemeOverride(enabled.document, "first").colors.surface, "#AABBCC");
  removeOwnedButtonGraph(changed, "first");
  assert.equal(changed.programPopoutThemeLocks.first, undefined);
});

test("explicit individual colors update unchecked Buttons while subsequent bulk updates preserve their edited frozen appearance", () => {
  const document = createButtonStateDocument();
  document.programPopoutThemes = { blender: settings({ colors: ["#224466"], idleEnabled: true, idleColor: "#123456", idleHighlightAmount: 17, idleGlowAmount: 12 }) };
  addPlacement(document, "first", "tools", "regular-popout");
  addPlacement(document, "second", "tools", "regular-popout", "Blender", 50);
  const targets = ["first", "second"].map((id) => ({ placementId: id, paletteId: `live:${id}` }));
  const frozen = applyProgramPopoutThemeLocks(document, "Blender", targets, [{ placementId: "live:first", enabled: false }]).document;
  const previous = structuredClone(frozen);
  const expected = { ...frozen.programPopoutThemeLocks.first, colors: { ...frozen.programPopoutThemeLocks.first.colors, surface: "#CC5522", text: "#113355" } };
  const fill = applyProgramPopoutColorEdits(frozen, "Blender", targets, [{ placementId: "live:first", color: "#CC5522" }]);
  assert.equal(fill.changedCount, 1);
  assert.equal(fill.placements[0].enabled, false);
  assert.equal(fill.placements[0].color, "#CC5522");
  assert.equal(fill.document.programPopoutThemeLocks.first.colors.text, previous.programPopoutThemeLocks.first.colors.text);
  const text = applyProgramPopoutColorEdits(fill.document, "Blender", targets, [{ placementId: "live:first", textColor: "#113355" }]);
  assert.equal(text.changedCount, 1);
  assert.deepEqual(text.document.programPopoutColorOverrides.first, { surface: "#CC5522", text: "#113355" });
  assert.deepEqual(resolveProgramPopoutThemeOverride(text.document, "first"), expected);
  assert.equal(resolveProgramPopoutThemeOverride(text.document, "second").colors.surface, "#224466", "same-color neighbors remain independently editable");
  assert.deepEqual(frozen, previous, "manual editing does not mutate the source snapshot");
  assert.deepEqual(text.document.skins, frozen.skins);
  assert.deepEqual(text.document.themeOverrides, frozen.themeOverrides);
  assert.equal(validateButtonStateDocument(text.document).valid, true);
  assert.equal(applyProgramPopoutColorEdits(text.document, "Blender", targets, [{ placementId: "live:first", color: "#CC5522", textColor: "#113355" }]).changedCount, 0);
  const reset = applyProgramPopoutColorEdits(text.document, "Blender", targets, [{ placementId: "live:first", reset: true }]);
  assert.equal(reset.changedCount, 0, "reset cannot silently unfreeze or replace excluded appearance");
  assert.deepEqual(reset.document.programPopoutThemeLocks.first, expected);

  const assignments = gradientProgramPopoutPaletteAssignments(targets.map(({ paletteId }, y) => ({ paletteId, y })), {
    colors: ["#000000", "#FFFFFF"], spread: 25, scatter: 100, seed: 97
  });
  let changed = applyProgramPopoutPaletteTargets(text.document, "Blender", targets, assignments).document;
  changed = applyProgramPopoutTextColorTargets(changed, "Blender", targets, "#000000").document;
  changed.programPopoutThemes.blender = settings({ colors: ["#ABCDEF"], textColor: "#FF00FF", hoverGlowAmount: 100, activeHighlightAmount: 800 });
  clearProgramPopoutColorOverrides(changed, "Blender", ["surface", "text"], true);
  assert.deepEqual(resolveProgramPopoutThemeOverride(changed, "first"), expected);
  assert.deepEqual(resolveProgramPopoutThemeOverride(JSON.parse(JSON.stringify(changed)), "first"), expected, "edited frozen colors persist with the package/state snapshot");
});

test("freezing Whole Layout captures independent live Fill, Text, Highlight and Glow angles exactly", () => {
  const document = createButtonStateDocument();
  const curve = [{ x: 0, y: 1, mode: "corner" }, { x: 1, y: 0, mode: "corner" }];
  document.programPopoutThemes = { blender: settings({
    screenTopToBottom: true, angle: 27, textColors: ["#123456", "#FFFFFF"], textAngle: -41, textScreenTopToBottom: true,
    highlightCurve: curve, highlightAngle: 90, highlightScreenTopToBottom: true,
    glowCurve: curve, glowAngle: -30, glowScreenTopToBottom: true,
    idleEnabled: true, idleHighlightAmount: 37, idleGlowAmount: 23
  }) };
  for (const [id, x, y] of [["first", 0, 0], ["middle", 100, 35], ["last", 30, 120]]) {
    addPlacement(document, id, "tools", "regular-popout", "Blender", y);
    document.placements[id].x = x;
  }
  const targets = ["first", "middle", "last"].map((id) => ({ placementId: id, paletteId: `live:${id}` }));
  const positions = targets.map(({ paletteId, placementId }) => {
    const placement = document.placements[placementId];
    return { paletteId, x: placement.x + 10, y: placement.y + 10, screenId: "screen" };
  });
  const geometry = {
    visibleBounds: { Left: 0, Top: 0, Width: 200, Height: 200 }, envelope: { x: 0, y: 0, width: 200, height: 200 },
    monitorWorkArea: { Left: 0, Top: 0, Width: 200, Height: 200 },
    screenRange: { minimumX: 10, maximumX: 110, minimumY: 10, maximumY: 130, centers: positions.map(({ x, y }) => ({ x, y })) }
  };
  const expected = resolveProgramPopoutThemeOverride(document, "middle", geometry);
  const frozen = applyProgramPopoutThemeLocks(document, "Blender", targets, [{ placementId: "live:middle", enabled: false }], positions);
  assert.deepEqual(frozen.document.programPopoutThemeLocks.middle, expected);
  assert.equal(validateButtonStateDocument(frozen.document).valid, true);
  const collapsed = structuredClone(frozen.document);
  addPlacement(collapsed, "collapsed", "collapsed", "tool-set-popout");
  collapsed.placements.collapsed.buttonId = "middle";
  assert.deepEqual(resolveProgramPopoutThemeOverride(collapsed, "collapsed", undefined, undefined, "middle"), expected);
  assert.throws(() => applyProgramPopoutThemeLocks(document, "Blender", targets, [{ placementId: "live:middle", enabled: false }]), /screen appearance is unavailable/);
});

test("frozen appearance accepts fractional resolved effects but rejects malformed and stale targets atomically", () => {
  const document = createButtonStateDocument();
  addPlacement(document, "first", "tools", "regular-popout");
  const targets = [{ placementId: "first", paletteId: "live:first" }];
  const appearance = { ...document.themeOverrides.first, hoverHighlightAmount: 83.5, activeGlowAmount: 2.125, idleGlowAmount: 0.25 };
  assert.deepEqual(normalizeProgramPopoutThemeLock(appearance), appearance);
  assert.equal(normalizeProgramPopoutThemeLock({ ...appearance, highlightAmount: 275.5 }).highlightAmount, 275.5);
  for (const patch of [{ colors: { surface: "var(--bad)" } }, { idleGlowAmount: NaN }, { activeGlowAmount: 100.1 }, { hoverEnabled: "true" }, { unknown: 1 }]) {
    assert.equal(normalizeProgramPopoutThemeLock({ ...appearance, ...patch }), null);
  }
  const before = structuredClone(document);
  for (const edits of [[], [{ placementId: "live:first", enabled: "false" }], [{ placementId: "stale", enabled: false }],
    [{ placementId: "live:first", enabled: false }, { placementId: "live:first", enabled: true }]]) {
    assert.throws(() => applyProgramPopoutThemeLocks(document, "Blender", targets, edits));
  }
  assert.deepEqual(document, before);
  delete document.themeOverrides.first;
  const frozen = applyProgramPopoutThemeLocks(document, "Blender", targets, [{ placementId: "live:first", enabled: false }]);
  assert.deepEqual(frozen.document.programPopoutThemeLocks.first.colors, {});
  assert.equal(frozen.document.programPopoutThemeLocks.first.hoverEnabled, null, "unthemed skins retain inherited behavior");
});

test("individual color edits reject duplicate, stale, malformed and other-program targets atomically", () => {
  const document = createButtonStateDocument();
  addPlacement(document, "first", "Blender Tools", "regular-popout");
  addPlacement(document, "krita", "Krita Tools", "regular-popout", "Krita");
  const targets = [{ placementId: "first", paletteId: "live:first" }];
  const before = structuredClone(document);
  for (const edits of [
    [], [{ placementId: "first", color: "red" }], [{ placementId: "live:first" }],
    [{ placementId: "live:first", color: "currentColor" }],
    [{ placementId: "live:first", reset: true, color: "red" }],
    [{ placementId: "live:first", color: "red" }, { placementId: "live:first", textColor: "blue" }],
    [{ placementId: "live:first", color: "red" }, { placementId: "stale", textColor: "blue" }]
  ]) assert.throws(() => applyProgramPopoutColorEdits(document, "Blender", targets, edits));
  assert.throws(() => applyProgramPopoutColorEdits(document, "Blender", [
    { placementId: "krita", paletteId: "live:krita" }
  ], [{ placementId: "live:krita", color: "red" }]));
  assert.deepEqual(document, before);
});

test("collapsed owners inherit source colors while Main and Panel placements remain outside manual popout styling", () => {
  const document = createButtonStateDocument();
  document.programPopoutThemes = { blender: settings() };
  addPlacement(document, "owner", "expanded", "tool-set-popout");
  addPlacement(document, "synthetic", "collapsed", "tool-set-popout");
  document.placements.synthetic.buttonId = "owner";
  addPlacement(document, "main", "main", "main");
  addPlacement(document, "panel", "panel", "panel");
  document.programPopoutColorOverrides = {
    owner: { surface: "#CC5522", text: "#2211EE" }, main: { surface: "#00FF00" }, panel: { surface: "#00FF00" }
  };
  const collapsed = resolveProgramPopoutThemeOverride(document, "synthetic", undefined, undefined, "owner");
  assert.equal(collapsed.colors.surface, "#CC5522");
  assert.equal(collapsed.colors.text, "#2211EE");
  assert.equal(resolveProgramPopoutThemeOverride(document, "main"), document.themeOverrides.main);
  assert.equal(resolveProgramPopoutThemeOverride(document, "panel"), document.themeOverrides.panel);
  assert.equal(validateButtonStateDocument(document).valid, false, "persisted exceptions cannot target non-popped placements");
});

test("reset restores package colors and global channel clears preserve other channels and programs", () => {
  const document = createButtonStateDocument();
  assert.equal(clearProgramPopoutColorOverrides(document, "Blender"), false);
  assert.equal(document.programPopoutColorOverrideRevisions, undefined, "never-used profiles need no reset writes");
  document.programPopoutThemes = { blender: settings({ colors: ["#113355"] }) };
  addPlacement(document, "first", "tools", "regular-popout");
  addPlacement(document, "krita", "krita", "regular-popout", "Krita");
  const targets = [{ placementId: "first", paletteId: "live:first" }];
  const edited = applyProgramPopoutColorEdits(document, "Blender", targets, [
    { placementId: "live:first", color: "red", textColor: "black" }
  ]).document;
  edited.programPopoutColorOverrides.krita = { surface: "#112233" };
  const reset = applyProgramPopoutColorEdits(edited, "Blender", targets, [{ placementId: "live:first", reset: true }]);
  assert.equal(resolveProgramPopoutThemeOverride(reset.document, "first").colors.surface, "#113355");
  assert.equal(resolveProgramPopoutThemeOverride(reset.document, "first").colors.text, "#FFFFFF");
  assert.equal(clearProgramPopoutColorOverrides(edited, "Blender", ["surface"]), true);
  assert.deepEqual(edited.programPopoutColorOverrides.first, { text: "#000000" });
  assert.deepEqual(edited.programPopoutColorOverrides.krita, { surface: "#112233" });
  assert.deepEqual(edited.programPopoutColorOverrideRevisions.blender, { surface: 1, text: 0 });
  clearProgramPopoutColorOverrides(edited, "Blender", ["text"]);
  assert.equal(edited.programPopoutColorOverrides.first, undefined);
  assert.deepEqual(edited.programPopoutColorOverrideRevisions.blender, { surface: 1, text: 1 });
  reset.document.programPopoutColorOverrides.first = { surface: "#CC5522" };
  removeOwnedButtonGraph(reset.document, "first");
  assert.equal(reset.document.programPopoutColorOverrides.first, undefined);
  assert.equal(reset.document.themeOverrides.first, undefined);
  assert.equal(validateButtonStateDocument(reset.document).valid, true);
});

test("program settings validate solid and gradient packages without accepting malformed values", () => {
  const document = createButtonStateDocument();
  document.programPopoutThemes = { blender: settings({ colors: ["red"] }) };
  assert.equal(validateButtonStateDocument(document).valid, true);
  assert.deepEqual(normalizeProgramPopoutThemeSettings(document.programPopoutThemes.blender).colors, ["#FF0000"]);
  for (const patch of [
    { version: 2 }, { colors: [] }, { colors: Array(17).fill("#FFFFFF") }, { textColor: "var(--color)" },
    { scatter: 101 }, { seed: 0.5 }, { hoverHighlightAmount: 1001 }, { activeGlowAmount: 101 },
    { activeEnabled: null }, { hoverGlowAmount: 3.5 }, { unexpected: true }
  ]) assert.equal(normalizeProgramPopoutThemeSettings(settings(patch)), null, JSON.stringify(patch));
  assert.equal(normalizeProgramPopoutThemeSettings(settings({ hoverHighlightAmount: 1000, activeGlowAmount: 0 })).hoverHighlightAmount, 1000);
  document.programPopoutThemes = { Blender: settings() };
  assert.equal(validateButtonStateDocument(document).valid, false);
  document.programPopoutThemes = [];
  assert.equal(validateButtonStateDocument(document).structurallyValid, false);
});

test("Blender colors and effects override every popped surface while Main, panels and other programs retain their appearance", () => {
  const document = createButtonStateDocument();
  document.programPopoutThemes = { blender: settings({ colors: ["#113355"] }) };
  for (const kind of ["regular-popout", "tool-set-popout", "fan", "main", "panel"]) {
    addPlacement(document, kind, kind, kind);
  }
  addPlacement(document, "krita", "krita", "tool-set-popout", "Krita");
  const before = structuredClone(document);
  for (const id of ["regular-popout", "tool-set-popout", "fan"]) {
    const resolved = resolveProgramPopoutThemeOverride(document, id);
    assert.deepEqual(resolved.colors, { surface: "#113355", text: "#FFFFFF", accent: "#00AA00" });
    assert.equal(resolved.activeGlowAmount, 42);
    assert.equal(resolved.activeHighlightAmount, 151);
    assert.equal(resolved.hoverHighlightAmount, 66);
    assert.equal(resolved.hoverEnabled, true);
  }
  for (const id of ["main", "panel", "krita"]) {
    assert.equal(resolveProgramPopoutThemeOverride(document, id), document.themeOverrides[id]);
  }
  assert.deepEqual(document, before, "rendering must preserve skin sources and the original overrides");
});

test("collapsed panel owners and children without source identity still resolve their program", () => {
  const document = createButtonStateDocument();
  document.programPopoutThemes = { blender: settings({ colors: ["#113355"] }) };
  addPlacement(document, "synthetic-owner", "synthetic-fan", "fan");
  document.buttons["synthetic-owner"] = {
    ...document.buttons["synthetic-owner"], role: "panel-owner", sourceIdentity: null, executionTarget: null,
    metadata: { programName: "Blender", panelName: "Utilities" }
  };
  addPlacement(document, "parent", "parent-pop", "tool-set-popout");
  addPlacement(document, "child", "child-pop", "tool-set-popout");
  document.buttons.child.sourceIdentity = null;
  document.buttons.child.executionTarget = null;
  document.buttons.child.toolSetParentId = "parent";
  for (const id of ["synthetic-owner", "child"]) {
    assert.equal(resolveProgramPopoutThemeOverride(document, id).colors.surface, "#113355");
  }
});

test("saved gradient adapts to new tools and their count without depending on closed popouts", () => {
  const document = createButtonStateDocument();
  document.programPopoutThemes = { blender: settings() };
  addPlacement(document, "top", "current", "regular-popout", "Blender", 0);
  addPlacement(document, "bottom", "current", "regular-popout", "Blender", 200);
  assert.equal(resolveProgramPopoutThemeOverride(document, "top").colors.surface, "#000000");
  assert.equal(resolveProgramPopoutThemeOverride(document, "bottom").colors.surface, "#FFFFFF");
  addPlacement(document, "new-tool", "current", "regular-popout", "Blender", 100);
  addPlacement(document, "closed", "closed", "regular-popout", "Blender", 800);
  assert.equal(resolveProgramPopoutThemeOverride(document, "new-tool").colors.surface, "#808080");
  assert.equal(resolveProgramPopoutThemeOverride(document, "bottom").colors.surface, "#FFFFFF");
  document.programPopoutThemes.blender.scatter = 100;
  const first = resolveProgramPopoutThemeOverride(document, "new-tool").colors.surface;
  assert.equal(resolveProgramPopoutThemeOverride(document, "new-tool").colors.surface, first);
  document.programPopoutThemes.blender.seed = 918;
  assert.notEqual(resolveProgramPopoutThemeOverride(document, "new-tool").colors.surface, first);
});

test("screen gradients use the occupied physical range and palette scans report the same current color", () => {
  const document = createButtonStateDocument();
  document.programPopoutThemes = { blender: settings({ screenTopToBottom: true }) };
  addPlacement(document, "popped", "screen", "regular-popout", "Blender", 40);
  const geometry = {
    visibleBounds: { Top: 100, Height: 200 }, envelope: { y: 0, height: 100 },
    monitorWorkArea: { Top: 0, Height: 800 }, screenRange: { minimumY: 150, maximumY: 350 }
  };
  const rendered = resolveProgramPopoutThemeOverride(document, "popped", geometry);
  assert.equal(rendered.colors.surface, "#404040");
  const targets = [{ paletteId: "live-window:popped", placementId: "popped" }];
  const scan = scanProgramPopoutPaletteTargets(document, "Blender", targets, [
    { paletteId: "another-window:top", y: 150 / 800 },
    { paletteId: "live-window:popped", y: 200 / 800 },
    { paletteId: "another-window:bottom", y: 350 / 800 }
  ]);
  assert.equal(scan.placements[0].color, rendered.colors.surface);
  assert.equal(programPopoutPaletteTargetsHaveTextColor(document, "Blender", targets, "#FFFFFF"), true);
  geometry.visibleBounds.Top = 250;
  assert.equal(resolveProgramPopoutThemeOverride(document, "popped", geometry).colors.surface, "#FFFFFF");
});

test("top, bottom and every added stop stay exact at all Spread and Scatter settings", () => {
  for (const colors of [["#F5E499", "#283836"], ["#FF0000", "#00FF00", "#0000FF"],
    ["#FF0000", "#00FF00", "#0000FF", "#FFFFFF"]]) {
    for (const spread of [0, 1, 50, 67, 100]) for (const scatter of [0, 4, 100]) {
      const document = createButtonStateDocument();
      document.programPopoutThemes = { blender: settings({ colors, spread, scatter }) };
      colors.forEach((_, index) => addPlacement(document, `stop-${index}`, "visible", "regular-popout", "Blender", index * 20));
      colors.forEach((color, index) => assert.equal(resolveProgramPopoutThemeOverride(document, `stop-${index}`).colors.surface, color));
      const assignments = gradientProgramPopoutPaletteAssignments(
        colors.map((_, index) => ({ paletteId: `stop-${index}`, y: 0.28 + index * 0.08 })),
        { colors, spread, scatter, seed: 33 }
      );
      assert.deepEqual(assignments.map(({ color }) => color.toUpperCase()), colors);
    }
  }
});

test("three-color gradients blend through both intervals and Spread controls transition width", () => {
  const gradient = { colors: ["#FF0000", "#00FF00", "#0000FF"], spread: 100, scatter: 0, seed: 33 };
  const items = [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1].map((y) => ({ paletteId: String(y), y }));
  assert.deepEqual(gradientProgramPopoutPaletteAssignments(items, gradient).map(({ color }) => color),
    ["#ff0000", "#bf4000", "#808000", "#00ff00", "#008080", "#0040bf", "#0000ff"]);
  assert.deepEqual(gradientProgramPopoutPaletteAssignments(items, { ...gradient, spread: 50 }).map(({ color }) => color),
    ["#ff0000", "#ff0000", "#808000", "#00ff00", "#008080", "#0000ff", "#0000ff"]);
});

test("occupied screen ranges exclude hidden members and keep monitors independent", () => {
  const positions = normalizedProgramPopoutScreenPositions([
    { paletteId: "a", y: 0.28, screenId: "primary" },
    { paletteId: "b", y: 0.48, screenId: "primary" },
    { paletteId: "c", y: 0.68, screenId: "primary" },
    { paletteId: "hidden", y: 0.98, screenId: "primary", rangeEligible: false },
    { paletteId: "d", y: 0.1, screenId: "secondary" },
    { paletteId: "e", y: 0.2, screenId: "secondary" }
  ]);
  assert.deepEqual(positions.map(({ y }) => Math.round(y * 100)), [0, 50, 100, 100, 0, 100]);
});

test("collapsed owners keep their source placement scatter color while separate occurrences stay distinct", () => {
  const document = createButtonStateDocument();
  document.programPopoutThemes = { blender: settings({ screenTopToBottom: true, scatter: 100 }) };
  addPlacement(document, "source-owner", "expanded", "tool-set-popout");
  addPlacement(document, "other-location:983z", "second-window", "tool-set-popout");
  document.placements["other-location:983z"].buttonId = "source-owner";
  for (const id of ["button-window-owner-placement:source-owner", "button-window-panel-owner-placement:source-owner"]) {
    addPlacement(document, id, id, "fan");
    document.placements[id].buttonId = "source-owner";
    const expanded = resolveProgramPopoutThemeOverride(document, "source-owner", undefined, 0.5);
    const collapsed = resolveProgramPopoutThemeOverride(document, id, undefined, 0.5, "source-owner");
    assert.equal(collapsed.colors.surface, expanded.colors.surface);
  }
  assert.notEqual(
    resolveProgramPopoutThemeOverride(document, "source-owner", undefined, 0.5).colors.surface,
    resolveProgramPopoutThemeOverride(document, "other-location:983z", undefined, 0.5).colors.surface
  );
});

test("first capture uses common current effects so stale Utility and Lithophane overrides do not dominate", () => {
  const document = createButtonStateDocument();
  for (const [id, y] of [["utility", 0], ["lithophane", 40], ["tool-a", 80], ["tool-b", 120], ["tool-c", 160]]) {
    addPlacement(document, id, "all", "tool-set-popout", "Blender", y);
  }
  for (const id of ["tool-a", "tool-b", "tool-c"]) {
    Object.assign(document.themeOverrides[id], { activeGlowAmount: 42, activeHighlightAmount: 151, hoverHighlightAmount: 66 });
  }
  const captured = captureProgramPopoutThemeSettings(document, "Blender");
  assert.equal(captured.activeGlowAmount, 42);
  assert.equal(captured.activeHighlightAmount, 151);
  assert.equal(captured.hoverHighlightAmount, 66);
  assert.equal(captured.textColor, "#000000");
  document.programPopoutThemes = { blender: settings({ activeGlowAmount: 5 }) };
  assert.equal(captureProgramPopoutThemeSettings(document, " Blender ").activeGlowAmount, 5);
});

const LINEAR_CURVE = [{ x: 0, y: 0, mode: "auto" }, { x: 1, y: 1, mode: "auto" }];

function addGridPlacement(document, id, x, y) {
  addPlacement(document, id, "grid", "regular-popout", "Blender", y);
  document.placements[id].x = x;
}

test("gradient curves map positions through auto, corner and Bezier points and fail closed when malformed", () => {
  for (const x of [0, 0.1, 0.25, 0.5, 0.9, 1]) {
    assert.ok(Math.abs(programPopoutGradientCurveValue(LINEAR_CURVE, x) - x) < 1e-12, `linear at ${x}`);
  }
  const peak = [{ x: 0, y: 0, mode: "auto" }, { x: 0.5, y: 1, mode: "auto" }, { x: 1, y: 0, mode: "auto" }];
  assert.equal(programPopoutGradientCurveValue(peak, 0.5), 1);
  assert.ok(Math.abs(programPopoutGradientCurveValue(peak, 0.25) - programPopoutGradientCurveValue(peak, 0.75)) < 1e-9);
  const steps = [
    { x: 0, y: 0, mode: "corner" }, { x: 0.499, y: 0, mode: "corner" },
    { x: 0.5, y: 1, mode: "corner" }, { x: 1, y: 1, mode: "corner" }
  ];
  assert.equal(programPopoutGradientCurveValue(steps, 0.3), 0);
  assert.equal(programPopoutGradientCurveValue(steps, 0.7), 1);
  const easeInOut = [
    { x: 0, y: 0, mode: "free", inX: 0, inY: 0, outX: 0.42, outY: 0 },
    { x: 1, y: 1, mode: "free", inX: -0.42, inY: 0, outX: 0, outY: 0 }
  ];
  assert.ok(programPopoutGradientCurveValue(easeInOut, 0.2) < 0.2);
  assert.ok(Math.abs(programPopoutGradientCurveValue(easeInOut, 0.5) - 0.5) < 1e-9);
  assert.ok(programPopoutGradientCurveValue(easeInOut, 0.8) > 0.8);
  const overshoot = [
    { x: 0, y: 0.5, mode: "free", inX: 0, inY: 0, outX: 0.9, outY: 1 },
    { x: 1, y: 0.5, mode: "free", inX: -0.9, inY: -1, outX: 0, outY: 0 }
  ];
  for (let x = 0; x <= 1; x += 0.05) {
    const value = programPopoutGradientCurveValue(overshoot, x);
    assert.ok(value >= 0 && value <= 1, `clamped at ${x}`);
  }
  assert.deepEqual(normalizeProgramPopoutGradientCurve(easeInOut), easeInOut);
  for (const curve of [
    [], [{ x: 0, y: 0, mode: "auto" }], [{ x: 0.1, y: 0, mode: "auto" }, { x: 1, y: 1, mode: "auto" }],
    [{ x: 0, y: 0, mode: "auto" }, { x: 0.9, y: 1, mode: "auto" }],
    [{ x: 0, y: 0, mode: "auto" }, { x: 0.5, y: 0, mode: "auto" }, { x: 0.5, y: 1, mode: "auto" }, { x: 1, y: 1, mode: "auto" }],
    [{ x: 0, y: 1.2, mode: "auto" }, { x: 1, y: 1, mode: "auto" }],
    [{ x: 0, y: 0, mode: "smooth" }, { x: 1, y: 1, mode: "auto" }],
    [{ x: 0, y: 0, mode: "auto", outX: 0.2, outY: 0 }, { x: 1, y: 1, mode: "auto" }],
    [{ x: 0, y: 0, mode: "free" }, { x: 1, y: 1, mode: "auto" }],
    [{ x: 0, y: 0, mode: "free", inX: 0.1, inY: 0, outX: 0.2, outY: 0 }, { x: 1, y: 1, mode: "auto" }],
    Array.from({ length: 33 }, (_, index) => ({ x: index / 32, y: 0, mode: "auto" }))
  ]) assert.equal(normalizeProgramPopoutGradientCurve(curve), null, JSON.stringify(curve).slice(0, 120));
});

test("gradient shape settings are optional, validated, and never added to older settings", () => {
  const legacy = normalizeProgramPopoutThemeSettings(settings());
  for (const key of ["angle", "curve", "textColors", "textAngle", "textCurve", "textScreenTopToBottom"]) {
    assert.equal(Object.hasOwn(legacy, key), false, key);
  }
  const shaped = normalizeProgramPopoutThemeSettings(settings({
    angle: 45, curve: LINEAR_CURVE, textColors: ["#fff", "#000"], textAngle: -90, textCurve: LINEAR_CURVE,
    textScreenTopToBottom: true
  }));
  assert.equal(shaped.angle, 45);
  assert.deepEqual(shaped.curve, LINEAR_CURVE);
  assert.deepEqual(shaped.textColors, ["#FFFFFF", "#000000"]);
  assert.equal(shaped.textAngle, -90);
  assert.equal(shaped.textScreenTopToBottom, true);
  const document = createButtonStateDocument();
  document.programPopoutThemes = { blender: shaped };
  assert.equal(validateButtonStateDocument(document).valid, true);
  for (const patch of [
    { angle: 400 }, { angle: "0" }, { curve: [] }, { textCurve: [{ x: 0, y: 0, mode: "auto" }] },
    { textColors: ["#FFFFFF"] }, { textColors: ["#FFFFFF", "nope"] }, { textScreenTopToBottom: "yes" }
  ]) assert.equal(normalizeProgramPopoutThemeSettings(settings(patch)), null, JSON.stringify(patch));
});

test("tilted fill gradients project each center along the angle while 0 degrees stays top-to-bottom", () => {
  const document = createButtonStateDocument();
  for (const [id, x, y] of [["tl", 0, 0], ["tr", 100, 0], ["bl", 0, 100], ["br", 100, 100]]) {
    addGridPlacement(document, id, x, y);
  }
  const surfaces = (angle) => {
    document.programPopoutThemes = { blender: settings(angle === undefined ? {} : { angle }) };
    return ["tl", "tr", "bl", "br"].map((id) => resolveProgramPopoutThemeOverride(document, id).colors.surface);
  };
  assert.deepEqual(surfaces(undefined), ["#000000", "#000000", "#FFFFFF", "#FFFFFF"]);
  assert.deepEqual(surfaces(0), ["#000000", "#000000", "#FFFFFF", "#FFFFFF"]);
  assert.deepEqual(surfaces(90), ["#000000", "#FFFFFF", "#000000", "#FFFFFF"]);
  assert.deepEqual(surfaces(-90), ["#FFFFFF", "#000000", "#FFFFFF", "#000000"]);
  assert.deepEqual(surfaces(180), ["#FFFFFF", "#FFFFFF", "#000000", "#000000"]);
  const diagonal = surfaces(45);
  assert.equal(diagonal[0], "#000000");
  assert.equal(diagonal[3], "#FFFFFF");
  assert.equal(diagonal[1], diagonal[2], "a 45 degree tilt is symmetric across the diagonal");
  assert.ok(["#7F7F7F", "#808080"].includes(diagonal[1]), diagonal[1]);
  document.programPopoutThemes = { blender: settings({ curve: [
    { x: 0, y: 1, mode: "auto" }, { x: 1, y: 0, mode: "auto" }
  ] }) };
  assert.equal(resolveProgramPopoutThemeOverride(document, "tl").colors.surface, "#FFFFFF", "curves can reverse the stops");
  const assignments = gradientProgramPopoutPaletteAssignments(
    [{ paletteId: "l", x: 0, y: 5 }, { paletteId: "r", x: 100, y: 5 }],
    { colors: ["#000000", "#FFFFFF"], spread: 100, scatter: 0, seed: 1, angle: 90 }
  );
  assert.deepEqual(assignments.map(({ color }) => color), ["#000000", "#ffffff"]);
});

test("spatial Highlight and Glow scale all states independently with legacy and scope compatibility", () => {
  const document = createButtonStateDocument();
  for (const [id, x, y] of [["tl", 0, 0], ["tr", 100, 0], ["bl", 0, 100], ["br", 100, 100]]) addGridPlacement(document, id, x, y);
  const effects = settings({ idleEnabled: true, idleHighlightAmount: 200, idleGlowAmount: 10,
    highlightCurve: LINEAR_CURVE, highlightAngle: 90,
    glowCurve: [{ x: 0, y: 1, mode: "auto" }, { x: 1, y: 0, mode: "auto" }] });
  document.programPopoutThemes = { blender: effects };
  assert.deepEqual(normalizeProgramPopoutThemeSettings(JSON.parse(JSON.stringify(effects))), effects);
  const resolved = ["tl", "tr", "bl", "br"].map((id) => resolveProgramPopoutThemeOverride(document, id));
  for (const prefix of ["idle", "hover", "active"]) {
    assert.deepEqual(resolved.map(r => r[prefix + "HighlightAmount"]), [0, effects[prefix + "HighlightAmount"], 0, effects[prefix + "HighlightAmount"]]);
    assert.deepEqual(resolved.map(r => r[prefix + "GlowAmount"]), [effects[prefix + "GlowAmount"], effects[prefix + "GlowAmount"], 0, 0]);
  }
  addPlacement(document, "other", "other", "regular-popout", "Krita");
  addPlacement(document, "main", "main", "panel");
  assert.equal(resolveProgramPopoutThemeOverride(document, "other").hoverHighlightAmount, 108);
  assert.equal(resolveProgramPopoutThemeOverride(document, "main").hoverHighlightAmount, 108);
  document.programPopoutThemes.blender = settings();
  assert.equal(resolveProgramPopoutThemeOverride(document, "tl").hoverHighlightAmount, 66);
  for (const patch of [{ highlightCurve: [] }, { glowCurve: null }, { glowAngle: 361 }, { highlightScreenTopToBottom: 1 }]) {
    assert.equal(normalizeProgramPopoutThemeSettings(settings(patch)), null);
  }
});

test("legacy Y-only Whole Layout geometry keeps vertical effects and single-position Start", () => {
  const document = createButtonStateDocument();
  const profile = settings({ colors: ["#123456"], highlightCurve: LINEAR_CURVE, glowCurve: LINEAR_CURVE,
    highlightAngle: 90, glowAngle: -90, highlightScreenTopToBottom: true, glowScreenTopToBottom: true });
  document.programPopoutThemes = { blender: profile };
  for (const [id, kind] of [["pop", "regular-popout"], ["fan", "fan"]]) {
    addPlacement(document, id, id, kind, "Blender", 40);
    const geometry = { visibleBounds: { Top: 100, Height: 200 }, envelope: { y: 0, height: 100 },
      monitorWorkArea: { Top: 0, Height: 800 }, screenRange: { minimumY: 150, maximumY: 350 } };
    const effect = resolveProgramPopoutThemeOverride(document, id, geometry);
    assert.ok(Math.abs(effect.hoverHighlightAmount - 66 * 0.25) < 1e-8);
    assert.ok(Math.abs(effect.activeGlowAmount - 42 * 0.25) < 1e-8);
    assert.equal(effect.colors.surface, "#123456");
    geometry.screenRange = { minimumY: 200, maximumY: 200 };
    assert.equal(resolveProgramPopoutThemeOverride(document, id, geometry).activeGlowAmount, 0, "single-position layouts sample Start");
  }
});

test("text gradients resolve per Button independently of the fill, and a solid text color stays solid", () => {
  const document = createButtonStateDocument();
  for (const [id, x, y] of [["tl", 0, 0], ["tr", 100, 0], ["bl", 0, 100]]) addGridPlacement(document, id, x, y);
  document.programPopoutThemes = { blender: settings({ textColors: ["#FF0000", "#0000FF"], textAngle: 90 }) };
  const resolved = (id) => resolveProgramPopoutThemeOverride(document, id).colors;
  assert.deepEqual([resolved("tl").text, resolved("tr").text, resolved("bl").text], ["#FF0000", "#0000FF", "#FF0000"]);
  assert.deepEqual([resolved("tl").surface, resolved("tr").surface, resolved("bl").surface], ["#000000", "#000000", "#FFFFFF"]);
  document.programPopoutThemes = { blender: settings({ textColor: "#123456" }) };
  assert.equal(resolved("tr").text, "#123456");
});

test("Whole Layout honors saved angles and scans match the occupied projected range", () => {
  const document = createButtonStateDocument();
  document.programPopoutThemes = { blender: settings({ screenTopToBottom: true, angle: 90 }) };
  addPlacement(document, "popped", "screen", "regular-popout", "Blender", 40);
  const geometry = {
    visibleBounds: { Left: 100, Top: 100, Width: 200, Height: 200 },
    envelope: { x: 0, y: 0, width: 100, height: 100 },
    monitorWorkArea: { Left: 0, Top: 0, Width: 1000, Height: 800 },
    screenRange: { minimumY: 150, maximumY: 350, minimumX: 100, maximumX: 300,
      centers: [{ x: 100, y: 150 }, { x: 120, y: 200 }, { x: 300, y: 350 }] }
  };
  const [expected] = gradientProgramPopoutPaletteAssignments(
    [{ paletteId: "a", y: 0.1 }], { colors: ["#000000", "#FFFFFF"], spread: 100, scatter: 0, seed: 23 },
    { minimumY: 0, maximumY: 1 }
  );
  const rendered = resolveProgramPopoutThemeOverride(document, "popped", geometry);
  assert.equal(rendered.colors.surface, expected.color.toUpperCase());
  const targets = [{ paletteId: "live-window:popped", placementId: "popped" }];
  const scan = scanProgramPopoutPaletteTargets(document, "Blender", targets, [
    { paletteId: "left", x: 100 / 800, y: 150 / 800 },
    { paletteId: "live-window:popped", x: 120 / 800, y: 200 / 800 },
    { paletteId: "right", x: 300 / 800, y: 350 / 800 }
  ]);
  assert.equal(scan.placements[0].color, rendered.colors.surface);
  assert.deepEqual(normalizedProgramPopoutScreenPositions([
    { paletteId: "a", x: 0, y: 0 }, { paletteId: "b", x: 1, y: 0 }, { paletteId: "c", x: 0, y: 1 }
  ], 90).map(({ y }) => y), [0, 1, 0]);
  assert.equal(programPopoutGradientBoxPosition({ x: 1, y: 1 }, { minimumX: 0, maximumX: 2, minimumY: 0, maximumY: 2 }, 45), 0.5);
});


test("idle effects round trip with old packages and remain scoped to Blender popout surfaces", () => {
  const legacy = settings();
  assert.deepEqual(normalizeProgramPopoutThemeSettings(legacy), legacy);
  const idle = settings({ idleEnabled: true, idleColor: "#AABBCC", idleHighlightAmount: 350, idleGlowAmount: 27 });
  assert.deepEqual(normalizeProgramPopoutThemeSettings(idle), idle);
  for (const patch of [{ idleEnabled: 1 }, { idleColor: "bad" }, { idleHighlightAmount: 1001 }, { idleGlowAmount: 101 }]) {
    assert.equal(normalizeProgramPopoutThemeSettings({ ...idle, ...patch }), null);
  }
  const document = createButtonStateDocument();
  document.programPopoutThemes = { blender: idle };
  addPlacement(document, "pop", "popout", "regular-popout");
  addPlacement(document, "main", "main", "panel");
  addPlacement(document, "krita", "krita", "regular-popout", "Krita");
  assert.equal(resolveProgramPopoutThemeOverride(document, "pop").idleGlowAmount, 27);
  assert.equal(resolveProgramPopoutThemeOverride(document, "main").idleEnabled, undefined);
  assert.equal(resolveProgramPopoutThemeOverride(document, "krita").idleEnabled, undefined);
});


test("Whole Layout anchors staggered Fill and Text to actual top/bottom Buttons at saved angles", () => {
  const document = createButtonStateDocument();
  document.programPopoutThemes = { blender: settings({
    colors: ["#4FB3C9", "#16404B"], spread: 67, scatter: 4, angle: 34, screenTopToBottom: true,
    textColors: ["#000000", "#FFFFFF"], textAngle: 37, textScreenTopToBottom: true
  }) };
  for (const [id, x, y] of [["top", 800, 100], ["middle", 450, 450], ["bottom", 100, 800]]) {
    addPlacement(document, id, "layout", "regular-popout", "Blender", y);
    document.placements[id].x = x;
  }
  const geometry = {
    visibleBounds: { Left: 0, Top: 0, Width: 1000, Height: 1000 },
    envelope: { x: 0, y: 0, width: 1000, height: 1000 },
    monitorWorkArea: { Left: 0, Top: -200, Width: 3000, Height: 2000 },
    screenRange: { minimumX: 110, maximumX: 810, minimumY: 110, maximumY: 810,
      centers: [{ x: 810, y: 110 }, { x: 460, y: 460 }, { x: 110, y: 810 }] }
  };
  assert.deepEqual(["top", "bottom"].map(id => resolveProgramPopoutThemeOverride(document, id, geometry).colors.surface),
    ["#4FB3C9", "#16404B"]);
  assert.deepEqual(["top", "bottom"].map(id => resolveProgramPopoutThemeOverride(document, id, geometry).colors.text),
    ["#000000", "#FFFFFF"]);
  const scan = scanProgramPopoutPaletteTargets(document, "Blender", ["top", "middle", "bottom"].map(id => ({ placementId: id, paletteId: id })),
    [{ paletteId: "top", x: 810, y: 110 }, { paletteId: "middle", x: 460, y: 460 }, { paletteId: "bottom", x: 110, y: 810 }]);
  assert.deepEqual(scan.placements.map(item => item.color), ["top", "middle", "bottom"].map(id => resolveProgramPopoutThemeOverride(document, id, geometry).colors.surface));
  assert.deepEqual(scan.placements.map(item => item.textColor), ["top", "middle", "bottom"].map(id => resolveProgramPopoutThemeOverride(document, id, geometry).colors.text));
});

test("Whole Layout rotates amount falloff with independent Highlight, Glow, Fill and Text angles", () => {
  const document = createButtonStateDocument();
  const ids = ["tl", "tr", "bl", "br"];
  const centers = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 100, y: 300 }, { x: 300, y: 300 }];
  ids.forEach((id, index) => {
    addPlacement(document, id, id, index % 2 ? "fan" : "regular-popout", "Blender", centers[index].y - 10);
    document.placements[id].x = centers[index].x - 10;
  });
  const geometry = { visibleBounds: { Left: 0, Top: 0, Width: 500, Height: 500 },
    envelope: { x: 0, y: 0, width: 500, height: 500 },
    screenRange: { minimumX: 100, maximumX: 300, minimumY: 100, maximumY: 300, centers } };
  const fade = [{ x: 0, y: 1, mode: "auto" }, { x: 1, y: 0, mode: "auto" }];
  const profile = settings({ idleEnabled: true, idleHighlightAmount: 100, idleGlowAmount: 40,
    highlightCurve: fade, glowCurve: fade, curve: fade, textCurve: fade,
    textColors: ["#000000", "#FFFFFF"], screenTopToBottom: true, textScreenTopToBottom: true,
    highlightScreenTopToBottom: true, glowScreenTopToBottom: true });
  for (const [angle, expected] of [[0, [1, 1, 0, 0]], [90, [1, 0, 1, 0]], [45, [1, 0.5, 0.5, 0]], [180, [0, 0, 1, 1]], [-90, [0, 1, 0, 1]]]) {
    document.programPopoutThemes = { blender: { ...profile, angle, textAngle: angle, highlightAngle: angle, glowAngle: angle } };
    ids.forEach((id, index) => {
      const result = resolveProgramPopoutThemeOverride(document, id, geometry);
      for (const state of ["idle", "hover", "active"]) {
        for (const effect of ["Highlight", "Glow"]) {
          const key = `${state}${effect}Amount`;
          assert.ok(Math.abs(result[key] - profile[key] * expected[index]) < 1e-8, `${id} ${key} at ${angle}`);
        }
      }
      const gray = Math.round(expected[index] * 255).toString(16).padStart(2, "0").repeat(3).toUpperCase();
      assert.equal(result.colors.surface, `#${gray}`);
      assert.equal(result.colors.text, `#${gray}`);
    });
  }
  document.programPopoutThemes.blender = { ...profile, angle: 45, textAngle: 180, highlightAngle: 90, glowAngle: 0 };
  const independent = ids.map((id) => resolveProgramPopoutThemeOverride(document, id, geometry));
  assert.deepEqual(independent.map((result) => result.idleHighlightAmount), [100, 0, 100, 0]);
  assert.deepEqual(independent.map((result) => result.idleGlowAmount), [40, 40, 0, 0]);
  assert.deepEqual(independent.map((result) => result.colors.text), ["#000000", "#000000", "#FFFFFF", "#FFFFFF"]);
  const scan = scanProgramPopoutPaletteTargets(document, "Blender", ids.map((id) => ({ placementId: id, paletteId: id })),
    centers.map((center, index) => ({ ...center, paletteId: ids[index] })));
  assert.deepEqual(scan.placements.map((item) => item.color), independent.map((result) => result.colors.surface));
  assert.deepEqual(scan.placements.map((item) => item.textColor), independent.map((result) => result.colors.text));
});

test("rotated Whole Layout anchors occupied centers, not empty diagonal box corners", () => {
  const centers = [{ x: 0, y: 100 }, { x: 100, y: 0 }, { x: 80, y: 80 }];
  const document = createButtonStateDocument();
  document.programPopoutThemes = { blender: settings({ highlightCurve: LINEAR_CURVE, highlightAngle: 45,
    highlightScreenTopToBottom: true, screenTopToBottom: true, angle: 45 }) };
  const geometry = { visibleBounds: { Left: 0, Top: 0, Width: 200, Height: 200 },
    envelope: { x: 0, y: 0, width: 200, height: 200 },
    screenRange: { minimumX: 0, maximumX: 100, minimumY: 0, maximumY: 100, centers } };
  const amounts = centers.map((center, index) => {
    const id = `triangle-${index}`;
    addPlacement(document, id, id, "regular-popout", "Blender", center.y - 10);
    document.placements[id].x = center.x - 10;
    return resolveProgramPopoutThemeOverride(document, id, geometry).hoverHighlightAmount;
  });
  assert.deepEqual(amounts, [0, 0, 66]);
  const items = centers.map((center, index) => ({ ...center, paletteId: `${index}`, screenId: "left" }));
  const normalized = normalizedProgramPopoutScreenPositions([
    ...items, { paletteId: "hidden", screenId: "left", x: 10000, y: 10000, rangeEligible: false },
    { paletteId: "other-start", screenId: "right", x: -500, y: -500 },
    { paletteId: "other-end", screenId: "right", x: -100, y: -100 }
  ], 45);
  assert.deepEqual(normalized.map((item) => item.y), [0, 0, 1, 1, 0, 1]);
  assert.deepEqual(normalizedProgramPopoutScreenPositions([
    { paletteId: "old-top", y: -100 }, { paletteId: "old-bottom", y: 100 }
  ], 90).map((item) => item.y), [0, 1], "old Y-only scans preserve vertical behavior");
  geometry.screenRange = { minimumX: 80, maximumX: 80, minimumY: 80, maximumY: 80, centers: [centers[2]] };
  assert.equal(resolveProgramPopoutThemeOverride(document, "triangle-2", geometry).hoverHighlightAmount, 0);
});

test("cross-window amounts use shared physical centers on negative-coordinate scaled monitors", () => {
  const document = createButtonStateDocument();
  document.programPopoutThemes = { blender: settings({ glowCurve: LINEAR_CURVE, glowAngle: 90, glowScreenTopToBottom: true }) };
  const monitorWorkArea = { Left: -1920, Top: -600, Width: 1920, Height: 1200 };
  const geometries = [
    { visibleBounds: { Left: -1800, Top: -500, Width: 300, Height: 300 }, envelope: { x: -40, y: -10, width: 200, height: 200 }, monitorWorkArea },
    { visibleBounds: { Left: -1700, Top: -300, Width: 400, Height: 400 }, envelope: { x: 0, y: 0, width: 200, height: 200 }, monitorWorkArea }
  ];
  addPlacement(document, "pop", "pop", "regular-popout", "Blender", 0);
  document.placements.pop.x = -30;
  addPlacement(document, "fan", "fan", "fan", "Blender", 40);
  document.placements.fan.x = 10;
  const ids = ["pop", "fan"];
  const ranges = ids.map((id, index) => programPopoutThemeWindowRange("Blender", [document.placements[id]], geometries[index]));
  const screenRange = aggregateProgramPopoutThemeScreenRange(ranges[0], [ranges[1],
    { ...ranges[1], programName: "krita" }, { ...ranges[1], monitorKey: "other-monitor" }]);
  assert.deepEqual(screenRange.centers, [{ x: -1770, y: -470 }, { x: -1660, y: -200 }]);
  assert.deepEqual(ids.map((id, index) => resolveProgramPopoutThemeOverride(document, id, { ...geometries[index], screenRange }).hoverGlowAmount), [0, 16]);
  document.programPopoutThemes.blender.glowAngle = -90;
  assert.deepEqual(ids.map((id, index) => resolveProgramPopoutThemeOverride(document, id, { ...geometries[index], screenRange }).hoverGlowAmount), [16, 0]);
});

test("missing shared layout range falls back to local Buttons instead of monitor edges", () => {
  const document = createButtonStateDocument();
  document.programPopoutThemes = { blender: settings({ screenTopToBottom: true }) };
  addPlacement(document, "top", "local", "regular-popout", "Blender", 100);
  addPlacement(document, "bottom", "local", "regular-popout", "Blender", 200);
  const geometry = { visibleBounds: { Top: 300, Height: 400 }, envelope: { y: 0, height: 400 }, monitorWorkArea: { Top: 0, Height: 2000 } };
  assert.deepEqual(["top", "bottom"].map(id => resolveProgramPopoutThemeOverride(document, id, geometry).colors.surface), ["#000000", "#FFFFFF"]);
});
