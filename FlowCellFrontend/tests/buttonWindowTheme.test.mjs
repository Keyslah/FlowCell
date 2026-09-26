import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { withCanonicalProgramPopoutThemes } from "./.compiled-button-system/button/windows/buttonWindowThemeDocument.js";
import { clearProgramPopoutColorOverrides } from "./.compiled-button-system/theme/programPopoutTheme.js";

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
    assert.match(page, /visibleBounds: \{ Top: appliedFrameBounds\.top, Height: appliedFrameBounds\.height \}/);
    assert.match(page, /envelope: renderedEnvelope/);
    assert.match(page, /appliedCanvasRef\.current\?\.monitorWorkArea/);
    assert.equal((renderer.match(/programPopoutThemeScreenGeometry=\{programPopoutThemeScreenGeometry\}/g) ?? []).length, 2);
    assert.match(renderer, /document: \{\s*\.\.\.args\.document/);
  }
  const surface = readFileSync(join(frontend, "src", "button", "ButtonSurface.tsx"), "utf8");
  assert.match(surface, /<ButtonRenderer[\s\S]{0,180}programPopoutThemeScreenGeometry=\{programPopoutThemeScreenGeometry\}/);
  const hook = readFileSync(join(frontend, "src", "button", "windows", "useButtonWindowDocument.ts"), "utf8");
  assert.match(hook, /subscribeButtonDrafts\(draftSessionId, acceptDraft/);
  assert.match(hook, /withCanonicalProgramPopoutThemes\(current\.document, document\)/);
});
