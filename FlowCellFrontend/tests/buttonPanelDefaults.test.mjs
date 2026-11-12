import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const output = process.env.FLOWCELL_BUTTON_TEST_OUTPUT ?? ".compiled-button-system";
const compiled = (path) => import(new URL(`./${output}/${path}.js`, import.meta.url));
const { createButtonStateDocument, ensureMainPageSkinDefaults } = await compiled("button/state/buttonDefaults");
const { ensureDefaultPanelPopout, ensureRegularPopout } = await compiled("button/state/buttonDocumentOperations");
const { applyPanelPopoutPreset, availablePanelPopoutPresets, availablePanelPopoutPresetsForPanel,
  panelPopoutPresetFromPath, panelPopoutPresetPath } = await compiled("button/state/buttonPanelPopoutPresets");
const { validateButtonStateDocument } = await compiled("button/state/buttonStateValidation");
const { buildButtonSettingsFile, buildTransientButtonPopoutSettingsDocument } = await compiled("button/state/buttonSettingsFile");

const gray = "skin-default-neutral";
const concrete = "skin-chipped-concrete-family-default";
function addPanel(document, records) {
  document.surfaces.panel = { id: "panel", name: "Blender / Collections", kind: "panel", width: Math.max(960, records.length * 160),
    height: 640, placementIds: [], visualOverflowAllowance: 24, uniformButtonSize: null };
  records.forEach((record, index) => {
    document.buttons[record.id] = record;
    const id = `panel-${record.id}`;
    document.placements[id] = { id, buttonId: record.id, surfaceId: "panel", x: index * 160, y: 0,
      width: 160, height: 44, zIndex: index, skinOverrideId: concrete, textFitMode: "shrink", textAlignment: "skin",
      textOffsetX: 0, textOffsetY: 0, minimumFontSize: 8, textSizeOverride: null, allowLabelResize: false,
      matchHitboxToSkin: true, allowStretching: false, highlightOnHover: false, resizeAnchor: "top-left",
      activationCycle: null, visualStateMap: null };
    document.surfaces.panel.placementIds.push(id);
  });
}
function record(id, fileName, label = id) {
  return { id, role: "single-script", label, tooltip: "", disabled: false, defaultSkinId: gray,
    defaultTextFitMode: "shrink", activationAnimation: null, activationBehavior: null, toolSetParentId: null,
    toolSetBehavior: null, metadata: {}, sourceIdentity: { normalizedProgramName: "blender", normalizedPanelName: "collections",
      normalizedFileName: fileName.toLowerCase(), displayProgramName: "Blender", displayPanelName: "Collections", displayFileName: fileName },
    executionTarget: { kind: "panel-script", programName: "Blender", panelName: "Collections", fileName } };
}
// Same public identity contract used by native bundled-source installation.
function managedFileName(sourceId) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(`blender\0${sourceId}`)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  const stem = `blender-${sourceId}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 80).replace(/-+$/, "");
  return `bundled-${stem}-${hash.toString(16).padStart(16, "0")}.flowcell-source.json`;
}
const expectedSourceOrder = ["snapshot", "back", "rename-selected", "restore", "cycle-collection", "cycle-versions-back",
  "cycle-versions-forward", "empty-trash", "baseline-visibility", "restore-visibility", "add-to-live", "trash", "archive",
  "make-collections", "empty-collections", "sort-live", "new-collection", "sort"];
function collectionsFixture() {
  const document = createButtonStateDocument();
  const manifest = JSON.parse(readFileSync(new URL("../../Programs/Blender/flowcell.program.json", import.meta.url), "utf8"));
  const records = expectedSourceOrder.map((key, index) => {
    const source = manifest.bundledSources.find((entry) => entry.id === `blender.${key}`);
    assert.ok(source, `The installed catalog must supply ${key}`);
    return record(`script-${index}`, managedFileName(source.id), source.displayLabel);
  });
  addPanel(document, records);
  return { document, records };
}

test("neutral shared defaults keep Concrete scoped to Main and preserve explicit assignments", () => {
  const document = createButtonStateDocument();
  assert.equal(document.settings.defaultSkinId, gray);
  const button = record("script", "custom.py");
  button.defaultSkinId = concrete;
  addPanel(document, [button]);
  document.placements["panel-script"].skinOverrideId = null;
  document.settings.defaultSkinId = concrete;
  const unit = ensureRegularPopout(document, [button]);
  const member = document.placements[unit.memberPlacementIds[0]];
  member.skinOverrideId = concrete; // Explicit occurrence assignment has no safe migration provenance.
  assert.equal(ensureMainPageSkinDefaults(document), true);
  assert.equal(document.settings.defaultSkinId, gray);
  assert.equal(button.defaultSkinId, gray);
  assert.equal(document.placements["panel-script"].skinOverrideId, concrete);
  assert.equal(member.skinOverrideId, concrete);
  assert.equal(ensureMainPageSkinDefaults(document), false);
});

test("new regular popups use gray even when their shared record still has Concrete", () => {
  const document = createButtonStateDocument();
  const button = record("custom", "custom.py");
  button.defaultSkinId = concrete;
  addPanel(document, [button]);
  document.placements["panel-custom"].width = 123;
  document.placements["panel-custom"].textOffsetX = 7;
  document.themeOverrides["panel-custom"] = { colors: { surface: "#123456" }, hoverEnabled: null,
    activeEnabled: null, hoverColor: null, activeColor: null };
  const unit = ensureDefaultPanelPopout(document, button.id);
  const member = document.placements[unit.memberPlacementIds[0]];
  assert.equal(member.skinOverrideId, gray);
  assert.equal(member.width, 160);
  assert.equal(member.textOffsetX, 0);
  assert.equal(document.themeOverrides[member.id], undefined);
  member.x = 222;
  member.skinOverrideId = concrete;
  assert.equal(ensureDefaultPanelPopout(document, button.id).id, unit.id);
  assert.equal(member.x, 222);
  assert.equal(member.skinOverrideId, concrete);
  ensureDefaultPanelPopout(document, button.id, { resetLayout: true });
  assert.equal(member.skinOverrideId, gray);
});

test("fresh managed Collections scripts receive the exact authored 18-control geometry and symbols", () => {
  const { document, records } = collectionsFixture();
  const mainBefore = structuredClone(document.surfaces.panel.placementIds.map((id) => document.placements[id]));
  assert.equal(availablePanelPopoutPresetsForPanel(document, "Blender", "Collections").length, 2);
  const unit = ensureDefaultPanelPopout(document, records[0].id);
  const members = unit.memberPlacementIds.map((id) => document.placements[id]);
  assert.equal(members.length, 18);
  assert.deepEqual(members.map((placement) => placement.buttonId), records.map((button) => button.id));
  assert.deepEqual(members.map(({ x, y, width, height }) => ({ x, y, width, height })),
    records.map((_, index) => ({ x: (index % 4) * 92.25982793135026, y: Math.floor(index / 4) * 44,
      width: 92.25982793135026, height: 44 })));
  assert.equal(members[5].presentationOverride.label, ">");
  assert.equal(members[6].presentationOverride.label, "<");
  assert.ok(members.every((placement) => placement.skinOverrideId === gray));
  assert.equal(document.surfaces[unit.surfaceId].width, 680);
  assert.equal(document.surfaces[unit.surfaceId].height, 268);
  assert.deepEqual(document.surfaces.panel.placementIds.map((id) => document.placements[id]), mainBefore);
  assert.deepEqual(validateButtonStateDocument(document).issues, []);
});

test("Collections Green Highlight remains an explicit alternative and Default restores gray", () => {
  const { document, records } = collectionsFixture();
  const unit = ensureDefaultPanelPopout(document, records[0].id);
  assert.equal(applyPanelPopoutPreset(document, unit, "green-highlight"), true);
  const placement = document.placements[unit.memberPlacementIds[0]];
  const skin = document.skins[placement.skinOverrideId];
  assert.match(skin.base, /--flowcell-button-color-surface:#8FDB0A/);
  assert.match(skin.base, /--flowcell-button-color-text:#050505/);
  assert.equal(document.placements[`panel-${records[0].id}`].skinOverrideId, concrete);
  assert.equal(applyPanelPopoutPreset(document, unit, "default-gray"), true);
  assert.equal(placement.skinOverrideId, gray);
  assert.deepEqual(validateButtonStateDocument(document).issues, []);
});

test("matching names cannot substitute for unknown source identities", () => {
  const { document, records } = collectionsFixture();
  records[0].sourceIdentity.normalizedFileName = "unrelated-script.flowcell-source.json";
  records[0].sourceIdentity.displayFileName = "unrelated-script.flowcell-source.json";
  const unit = ensureRegularPopout(document, records);
  assert.equal(availablePanelPopoutPresets(document, unit).length, 0);
  assert.equal(applyPanelPopoutPreset(document, unit), false);
  assert.equal(availablePanelPopoutPresetsForPanel(document, "Blender", "Collections").length, 0);
});

test("built-in choices retain stable paths for last-used selection and layout restoration", () => {
  for (const id of ["default-gray", "green-highlight"]) assert.equal(panelPopoutPresetFromPath(panelPopoutPresetPath(id)), id);
  assert.equal(panelPopoutPresetFromPath("C:/custom/settings.json"), null);
});

test("named Collections choices round-trip through the existing isolated settings window path", () => {
  const { document, records } = collectionsFixture();
  const unit = ensureDefaultPanelPopout(document, records[0].id);
  const canonicalBefore = structuredClone(document);
  const working = structuredClone(document);
  applyPanelPopoutPreset(working, working.popoutUnits[unit.id], "green-highlight");
  const settings = buildButtonSettingsFile(working, unit.surfaceId, { programName: "Blender", panelName: "Collections" });
  const transient = buildTransientButtonPopoutSettingsDocument(document, settings,
    { programName: "Blender", panelName: "Collections" }, "collections-green-highlight");
  const loadedUnit = transient.document.popoutUnits[transient.popoutUnitId];
  const loadedMembers = loadedUnit.memberPlacementIds.map((id) => transient.document.placements[id]);
  assert.equal(loadedMembers.length, 18);
  assert.equal(loadedMembers[5].presentationOverride.label, ">");
  assert.equal(loadedMembers[6].presentationOverride.label, "<");
  assert.ok(loadedMembers.every((placement) => transient.document.skins[placement.skinOverrideId].base.includes("#8FDB0A")));
  assert.deepEqual(document, canonicalBefore, "Opening a named design must not alter the saved popup");
  assert.deepEqual(validateButtonStateDocument(transient.document).issues, []);
});
