import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { withCanonicalPanelFanMotion, withCanonicalProgramPopoutThemes } from "./.compiled-button-system/button/windows/buttonWindowThemeDocument.js";
import { clearProgramPopoutColorOverrides } from "./.compiled-button-system/theme/programPopoutTheme.js";
import { createButtonSourceIdentity } from "./.compiled-button-system/button/state/sourceIdentity.js";
import { BUTTON_FAN_STYLE_CATALOG } from "./.compiled-button-system/button/fan/buttonFanMotion.js";

function panelFanFixture() {
  const canonical = createButtonStateDocument();
  canonical.buttons.panel = { id: "panel", role: "panel-owner", metadata: { programName: "Blender", panelName: "Files" } };
  canonical.buttons.tool = { id: "tool", role: "tool-set-owner", metadata: {},
    sourceIdentity: createButtonSourceIdentity("Blender", "Files", "tool.json") };
  const draft = structuredClone(canonical);
  const animation = { durationMs: 420, easing: "linear", staggerMs: 17, spinEnabled: true };
  draft.popoutUnits.transient = { id: "transient", kind: "regular", ownerButtonId: "panel", surfaceId: "saved-pop",
    memberSourceIdentities: [createButtonSourceIdentity("Blender", "Files", "save.py")],
    fanAnimation: { ...animation }, desktopBounds: { left: 83, top: 91, width: 250, height: 120 } };
  draft.popoutUnits.tool = { id: "tool", kind: "tool-set", ownerButtonId: "tool", fanAnimation: { ...animation } };
  draft.fanSetups.fan = { id: "fan", programName: "Blender", panelName: "Files", animation: { ...animation },
    collapsedPanelOwnerBounds: { left: 170, top: 230, width: 70, height: 44 } };
  draft.placements.saved = { id: "saved", x: 157, y: 23, width: 93, height: 44, skinOverrideId: "custom" };
  return { canonical, draft };
}

test("canonical Fan choices update existing transient and legacy windows without changing their saved layout", () => {
  const { canonical, draft } = panelFanFixture();
  const before = structuredClone(draft);
  canonical.buttons.panel.metadata.panelFanMotionStyle = "default";
  const current = withCanonicalPanelFanMotion(draft, canonical);
  assert.equal(current.popoutUnits.transient.fanAnimation.spinEnabled, false);
  assert.equal(current.popoutUnits.tool.fanAnimation.spinEnabled, false);
  assert.equal(current.fanSetups.fan.animation.spinEnabled, false);
  assert.deepEqual(current.popoutUnits.transient.fanAnimation,
    { durationMs: 420, easing: "linear", staggerMs: 17, spinEnabled: false });
  assert.equal(current.placements, draft.placements);
  assert.equal(current.popoutUnits.transient.desktopBounds, draft.popoutUnits.transient.desktopBounds);
  assert.equal(current.fanSetups.fan.collapsedPanelOwnerBounds, draft.fanSetups.fan.collapsedPanelOwnerBounds);
  assert.deepEqual(draft, before, "the settings-backed draft must not be mutated");
  assert.equal(withCanonicalPanelFanMotion(current, canonical), current, "identical choices are a no-op");
  canonical.buttons.panel.metadata.panelFanMotionStyle = "spin";
  const spinning = withCanonicalPanelFanMotion(current, canonical);
  assert.equal(spinning.popoutUnits.transient.fanAnimation.spinEnabled, true);
  assert.equal(spinning.fanSetups.fan.animation.spinEnabled, true);
});

test("an absent or unknown canonical Fan choice preserves saved animation and ignores stale draft preferences", () => {
  const { canonical, draft } = panelFanFixture();
  draft.buttons.panel.metadata.panelFanMotionStyle = "default";
  assert.equal(withCanonicalPanelFanMotion(draft, null), draft);
  assert.equal(withCanonicalPanelFanMotion(draft, canonical), draft);
  canonical.buttons.panel.metadata.panelFanMotionStyle = "future-style";
  assert.equal(withCanonicalPanelFanMotion(draft, canonical), draft);
});

test("catalog styles apply their complete animation patch while preserving unspecified saved timing", () => {
  const { canonical, draft } = panelFanFixture();
  const before = structuredClone(draft);
  const style = { id: "test-timed-style", name: "Timed style", animation: { spinEnabled: true, durationMs: 650, easing: "ease-in" } };
  BUTTON_FAN_STYLE_CATALOG.push(style);
  try {
    canonical.buttons.panel.metadata.panelFanMotionStyle = style.id;
    const current = withCanonicalPanelFanMotion(draft, canonical);
    const expected = { durationMs: 650, easing: "ease-in", staggerMs: 17, spinEnabled: true };
    assert.deepEqual(current.popoutUnits.transient.fanAnimation, expected);
    assert.deepEqual(current.popoutUnits.tool.fanAnimation, expected);
    assert.deepEqual(current.fanSetups.fan.animation, expected);
    assert.equal(withCanonicalPanelFanMotion(current, canonical), current);
    assert.equal(current.placements, draft.placements);
    assert.deepEqual(draft, before);
  } finally {
    BUTTON_FAN_STYLE_CATALOG.pop();
  }
});

test("future ownerless Pop-outs inherit only an exact panel choice and use default timing if none was saved", () => {
  const { canonical, draft } = panelFanFixture();
  canonical.buttons.panel.metadata.panelFanMotionStyle = "spin";
  delete draft.popoutUnits.transient.ownerButtonId;
  delete draft.popoutUnits.transient.fanAnimation;
  draft.popoutUnits.other = { ...draft.popoutUnits.transient, id: "other",
    memberSourceIdentities: [createButtonSourceIdentity("Krita", "Files", "save.py")] };
  draft.popoutUnits.mixed = { ...draft.popoutUnits.transient, id: "mixed", memberSourceIdentities: [
    createButtonSourceIdentity("Blender", "Files", "save.py"), createButtonSourceIdentity("Blender", "Tools", "tool.py")
  ] };
  const current = withCanonicalPanelFanMotion(draft, canonical);
  assert.deepEqual(current.popoutUnits.transient.fanAnimation,
    { durationMs: 180, easing: "ease-out", staggerMs: 30, spinEnabled: true });
  assert.equal(current.popoutUnits.other, draft.popoutUnits.other);
  assert.equal(current.popoutUnits.mixed, draft.popoutUnits.mixed);
  assert.equal(draft.popoutUnits.transient.fanAnimation, undefined);
});

test("canonical freeze and re-enable win over stale drafts while draft-only locks survive package changes", () => {
  const canonical = createButtonStateDocument();
  canonical.placements.saved = { id: "saved", buttonId: "button", surfaceId: "pop" };
  const appearance = { colors: { surface: "#112233" }, hoverEnabled: true, activeEnabled: false, hoverColor: null, activeColor: null };
  canonical.programPopoutThemeLocks = { saved: appearance };
  const draft = structuredClone(canonical);
  draft.placements.transient = { id: "transient", buttonId: "transient", surfaceId: "pop" };
  draft.programPopoutThemeLocks.transient = appearance;
  draft.programPopoutThemeLocks.saved.colors.surface = "#445566";
  assert.deepEqual(withCanonicalProgramPopoutThemes(draft, canonical).programPopoutThemeLocks.saved, appearance);
  delete canonical.programPopoutThemeLocks.saved;
  canonical.programPopoutThemes = { blender: { colors: ["#FFFFFF"] } };
  const current = withCanonicalProgramPopoutThemes(draft, canonical);
  assert.equal(current.programPopoutThemeLocks.saved, undefined);
  assert.deepEqual(current.programPopoutThemeLocks.transient, appearance);
});

test("canonical individual edits and resets survive stale same-placement editor drafts", () => {
  const canonical = createButtonStateDocument();
  canonical.placements.saved = { id: "saved", buttonId: "button", surfaceId: "pop" };
  canonical.programPopoutColorOverrides = { saved: { surface: "#112233" } };
  const draft = structuredClone(canonical);
  draft.programPopoutColorOverrides.saved = { surface: "#445566", text: "#FFFFFF" };
  assert.deepEqual(withCanonicalProgramPopoutThemes(draft, canonical).programPopoutColorOverrides.saved, { surface: "#112233" });
  delete canonical.programPopoutColorOverrides.saved;
  assert.equal(withCanonicalProgramPopoutThemes(draft, canonical).programPopoutColorOverrides.saved, undefined);
});

test("transient individual colors persist across drafts and per-channel global clears invalidate them without reopening the draft", () => {
  const canonical = createButtonStateDocument();
  canonical.programPopoutColorOverrideRevisions = { blender: { surface: 0, text: 0 } };
  const draft = structuredClone(canonical);
  draft.buttons.transient = { id: "transient", role: "panel-owner", metadata: { programName: "Blender", panelName: "Tools" } };
  draft.surfaces.pop = { id: "pop", kind: "fan" };
  draft.placements.transient = { id: "transient", buttonId: "transient", surfaceId: "pop" };
  draft.programPopoutColorOverrides = { transient: { surface: "#112233", text: "#334455" } };
  assert.deepEqual(withCanonicalProgramPopoutThemes(draft, canonical).programPopoutColorOverrides.transient,
    { surface: "#112233", text: "#334455" });
  clearProgramPopoutColorOverrides(canonical, "Blender", ["surface"]);
  assert.deepEqual(withCanonicalProgramPopoutThemes(draft, canonical).programPopoutColorOverrides.transient, { text: "#334455" });
  clearProgramPopoutColorOverrides(canonical, "Blender", ["text"]);
  assert.equal(withCanonicalProgramPopoutThemes(draft, canonical).programPopoutColorOverrides?.transient, undefined);
  assert.deepEqual(draft.programPopoutColorOverrides.transient, { surface: "#112233", text: "#334455" });
});

test("imported transient colors survive unrelated commits before their first canonical reset record", () => {
  const canonical = createButtonStateDocument();
  const draft = structuredClone(canonical);
  draft.buttons.imported = { id: "imported", role: "panel-owner", metadata: { programName: "Blender", panelName: "Tools" } };
  draft.surfaces.pop = { id: "pop", kind: "fan" };
  draft.placements.imported = { id: "imported", buttonId: "imported", surfaceId: "pop" };
  draft.programPopoutColorOverrides = { imported: { surface: "#112233", text: "#334455" } };
  draft.programPopoutColorOverrideRevisions = { blender: { surface: 0, text: 0 } };
  const firstCommit = withCanonicalProgramPopoutThemes(draft, canonical);
  const secondCommit = withCanonicalProgramPopoutThemes(firstCommit, canonical);
  assert.deepEqual(secondCommit.programPopoutColorOverrides.imported, { surface: "#112233", text: "#334455" });
  assert.deepEqual(secondCommit.programPopoutColorOverrideRevisions.blender, { surface: 0, text: 0 });
  assert.equal(clearProgramPopoutColorOverrides(canonical, "Blender", ["surface", "text"], true), true);
  assert.deepEqual(canonical.programPopoutColorOverrideRevisions.blender, { surface: 1, text: 1 });
  assert.equal(withCanonicalProgramPopoutThemes(secondCommit, canonical).programPopoutColorOverrides?.imported, undefined);
});

test("live editor drafts retain their layout and skins while canonical popout rules win", () => {
  const canonical = createButtonStateDocument();
  canonical.programPopoutThemes = { blender: { colors: ["#123456"], hoverGlowAmount: 16 } };
  const draft = structuredClone(canonical);
  draft.programPopoutThemes.blender.hoverGlowAmount = 90;
  draft.surfaces[Object.keys(draft.surfaces)[0]].width = 875;
  const originalDraft = structuredClone(draft);

  const rendered = withCanonicalProgramPopoutThemes(draft, canonical);

  assert.equal(rendered.programPopoutThemes, canonical.programPopoutThemes);
  assert.equal(rendered.surfaces, draft.surfaces);
  assert.equal(rendered.skins, draft.skins);
  assert.deepEqual(draft, originalDraft, "rendering must not modify the editor draft");
  assert.equal(rendered.programPopoutThemes.blender.hoverGlowAmount, 16);
});

test("canonical package switches and removal survive subsequent stale draft replies", () => {
  const draft = createButtonStateDocument();
  draft.programPopoutThemes = { blender: { colors: ["#111111"] } };
  const canonical = createButtonStateDocument();
  canonical.programPopoutThemes = { blender: { colors: ["#222222"] } };
  assert.deepEqual(withCanonicalProgramPopoutThemes(draft, canonical).programPopoutThemes, {
    blender: { colors: ["#222222"] }
  });
  delete canonical.programPopoutThemes;
  assert.equal(withCanonicalProgramPopoutThemes(draft, canonical).programPopoutThemes, undefined);
  assert.deepEqual(draft.programPopoutThemes.blender.colors, ["#111111"]);
});

test("a draft arriving before the saved baseline remains usable until canonical rules load", () => {
  const draft = createButtonStateDocument();
  assert.equal(withCanonicalProgramPopoutThemes(draft, null), draft);
  const canonical = createButtonStateDocument();
  canonical.programPopoutThemes = { blender: { colors: ["#ABCDEF"] } };
  assert.equal(withCanonicalProgramPopoutThemes(draft, canonical).programPopoutThemes, canonical.programPopoutThemes);
});

test("popout and Fan paths forward physical screen geometry to normal and collapsed owners", () => {
  const frontend = join(import.meta.dirname, "..");
  for (const [folder, name] of [["popout", "ButtonPopout"], ["fan", "ButtonFan"]]) {
    const page = readFileSync(join(frontend, "src", "button", folder, `${name}WindowPage.tsx`), "utf8");
    const renderer = readFileSync(join(frontend, "src", "button", folder, `${name}Renderer.tsx`), "utf8");
    assert.match(page, /visibleBounds: \{\s*Left: appliedFrameBounds\.left,\s*Top: appliedFrameBounds\.top,\s*Width: appliedFrameBounds\.width,\s*Height: appliedFrameBounds\.height\s*\}/);
    assert.match(page, /enabled: Boolean\(programPopoutThemeSettings\?\.screenTopToBottom \|\| programPopoutThemeSettings\?\.textScreenTopToBottom \|\|\s*programPopoutThemeSettings\?\.highlightScreenTopToBottom \|\| programPopoutThemeSettings\?\.glowScreenTopToBottom\)/);
    assert.match(page, /envelope: renderedEnvelope/);
    assert.match(page, /appliedCanvasRef\.current\?\.monitorWorkArea/);
    assert.equal((renderer.match(/programPopoutThemeScreenGeometry=\{programPopoutThemeScreenGeometry\}/g) ?? []).length, 2);
    assert.match(renderer, /document: \{\s*\.\.\.args\.document/);
  }
  const surface = readFileSync(join(frontend, "src", "button", "ButtonSurface.tsx"), "utf8");
  assert.match(surface, /<ButtonRenderer[\s\S]{0,180}programPopoutThemeScreenGeometry=\{programPopoutThemeScreenGeometry\}/);
  const hook = readFileSync(join(frontend, "src", "button", "windows", "useButtonWindowDocument.ts"), "utf8");
  assert.match(hook, /subscribeButtonDrafts\(draftSessionId, acceptDraft/);
  assert.match(hook, /renderDraft\(activeDraftDocument\)/);
});
