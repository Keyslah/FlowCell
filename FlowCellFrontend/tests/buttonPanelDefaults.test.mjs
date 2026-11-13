import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withNeutralSkinMeasurements } from "./neutralSkinDomFixture.mjs";

const output = process.env.FLOWCELL_BUTTON_TEST_OUTPUT ?? ".compiled-button-system";
const compiled = (path) => import(new URL(`./${output}/${path}.js`, import.meta.url));
const { createButtonStateDocument, ensureMainPageSkinDefaults } = await compiled("button/state/buttonDefaults");
const { mergeLegacyInstallsIntoDocument, reconcileBundledProgramSources } = await compiled("button/state/ButtonStateRepository");
const { ensureDefaultPanelPopout, ensureRegularPopout, ensureFanSetup } = await compiled("button/state/buttonDocumentOperations");
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

test("first-run source migration assigns Main Concrete before layout and keeps Pop-out defaults gray", () => {
  const button = record("windows-backup", "backup.ps1", "FlowCell Back Up");
  const document = mergeLegacyInstallsIntoDocument(createButtonStateDocument(), [{
    ownerButtonId: button.id,
    sourceIdentity: button.sourceIdentity,
    executionTarget: button.executionTarget,
    label: button.label,
    tooltip: "",
    children: []
  }]);
  const main = document.placements[`placement-${button.id}`];
  assert.equal(main.skinOverrideId, concrete);
  assert.equal(document.buttons[button.id].defaultSkinId, gray);
  assert.notEqual(main.width, 160, "the new panel layout must use the Concrete key's natural proportions");
  const unit = ensureRegularPopout(document, [document.buttons[button.id]]);
  assert.equal(document.placements[unit.memberPlacementIds[0]].skinOverrideId, gray);
});

test("startup source reconciliation repairs unassigned Main skins without requiring Editor or Pop discovery", () => {
  const document = createButtonStateDocument();
  const plain = record("plain", "plain.py");
  const explicit = record("explicit", "explicit.py");
  addPanel(document, [plain, explicit]);
  document.placements["panel-plain"].skinOverrideId = null;
  document.placements["panel-explicit"].skinOverrideId = gray;
  const unit = ensureRegularPopout(document, [plain]);
  const beforeMain = structuredClone(document.placements["panel-plain"]);
  const beforePopout = structuredClone(document.placements[unit.memberPlacementIds[0]]);
  const next = reconcileBundledProgramSources(document, []);
  assert.equal(document.placements["panel-plain"].skinOverrideId, null, "reconciliation must not mutate its input");
  assert.deepEqual(next.placements["panel-plain"], { ...beforeMain, skinOverrideId: concrete });
  assert.equal(next.placements["panel-explicit"].skinOverrideId, gray, "saved explicit assignments are preserved");
  assert.deepEqual(next.placements[unit.memberPlacementIds[0]], beforePopout);
  assert.deepEqual(reconcileBundledProgramSources(next, []), next);
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

test("new Pop-outs and Fans pack text-dependent widths into tight rows without equalizing sizes", () => {
  withNeutralSkinMeasurements({ iiii: 52, WWWW: 104 }, () => {
  for (const kind of ["pop", "panel-pop", "fan"]) {
    const document = createButtonStateDocument();
    const records = Array.from({ length: 9 }, (_, index) => record(`grid-${index}`, `grid-${index}.py`,
      index % 2 === 0 ? "iiii" : "WWWW"));
    addPanel(document, records);
    const unit = kind === "fan" ? ensureFanSetup({ document, programName: "Blender", panelName: "Collections", buttons: records })
      : kind === "panel-pop" ? ensureDefaultPanelPopout(document, records[0].id) : ensureRegularPopout(document, records);
    const surface = document.surfaces[unit.fanSurfaceId ?? unit.surfaceId];
    const ids = unit.fanMemberPlacementIds ?? unit.memberPlacementIds;
    const members = ids.map((id) => document.placements[id]);
    assert.equal(surface.uniformButtonSize, null, "a packed default must not lock individual dimensions");
    const originX = kind === "fan" ? 96 : 8;
    assert.deepEqual(members.map(({ x, y, width, height }) => ({ x, y, width, height })),
      records.map((_, index) => ({ x: originX + [0, 44, 132, 176][index % 4], y: 8 + Math.floor(index / 4) * 44,
        width: index % 2 === 0 ? 44 : 88, height: 44 })));
    assert.ok(members.every((placement) => placement.matchHitboxToSkin && !placement.allowStretching),
      "each skin keeps its natural proportions");
    if (kind === "fan") {
      const owner = surface.placementIds.map((id) => document.placements[id])
        .find((placement) => placement.buttonId === unit.panelOwnerButtonId);
      assert.equal(owner.x + owner.width, originX, "the independent owner must not consume a member grid cell");
    }
    assert.deepEqual(validateButtonStateDocument(document).issues, []);
  }
  });
});

test("Load Default preserves unequal sizes and respects chosen spacing", () => {
  const document = createButtonStateDocument();
  const records = Array.from({ length: 5 }, (_, index) => record(`reset-${index}`, `reset-${index}.py`));
  addPanel(document, records);
  const unit = ensureRegularPopout(document, records);
  const surface = document.surfaces[unit.surfaceId];
  surface.uniformButtonSize = null;
  const heights = [40, 44, 48, 42, 38];
  unit.memberPlacementIds.forEach((id, index) => Object.assign(document.placements[id], {
    width: 70 + index * 5, height: heights[index], x: index * 100, y: 110, matchHitboxToSkin: true
  }));
  const authored = structuredClone(unit.memberPlacementIds.map((id) => document.placements[id]));
  ensureDefaultPanelPopout(document, records[0].id);
  assert.deepEqual(unit.memberPlacementIds.map((id) => document.placements[id]), authored,
    "opening an existing popup must preserve its authored layout");
  document.settings.buttonSpacingMm = 25.4 / 96 * 3;
  ensureDefaultPanelPopout(document, records[0].id, { unitId: unit.id, resetLayout: true });
  assert.equal(surface.uniformButtonSize, null);
  assert.deepEqual(unit.memberPlacementIds.map((id) => {
    const { x, y, width, height, matchHitboxToSkin } = document.placements[id];
    return { x, y, width, height, matchHitboxToSkin };
  }), records.map((_, index) => ({ x: 8 + [0, 73, 151, 234, 0][index], y: index < 4 ? 8 : 59,
    width: 70 + index * 5, height: heights[index], matchHitboxToSkin: true })));
  assert.deepEqual(validateButtonStateDocument(document).issues, []);
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
