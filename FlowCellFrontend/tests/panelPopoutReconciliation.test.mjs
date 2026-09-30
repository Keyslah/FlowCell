import test from "node:test";
import { prepareLastLayoutPanelUpdates } from "./.compiled-button-system/button/state/lastLayoutPanelUpdates.js";
import { mergeLegacyInstallsIntoDocument } from "./.compiled-button-system/button/state/ButtonStateRepository.js";
import assert from "node:assert/strict";
import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { createButtonSourceIdentity } from "./.compiled-button-system/button/state/sourceIdentity.js";
import { ensureFanSetup, ensureRegularPopout } from "./.compiled-button-system/button/state/buttonDocumentOperations.js";
import { reconcileAddedPanelButtons, withAddedCanonicalPanelButtons } from "./.compiled-button-system/button/state/panelPopoutReconciliation.js";
import { buildButtonSettingsFile, buildTransientButtonPopoutSettingsDocument } from "./.compiled-button-system/button/state/buttonSettingsFile.js";
import { validateButtonStateDocument } from "./.compiled-button-system/button/state/buttonStateValidation.js";

function button(id, panel = "Shapes") {
  return {
    id, role: "single-script", sourceIdentity: createButtonSourceIdentity("Blender", panel, id + ".py"),
    label: id, tooltip: "", executionTarget: { kind: "panel-script", programName: "Blender", panelName: panel, fileName: id + ".py" },
    defaultSkinId: "skin-default-neutral", defaultTextFitMode: "shrink", disabled: false,
    activationAnimation: null, activationBehavior: null, toolSetParentId: null, toolSetBehavior: null, metadata: {}
  };
}

test("installing a new button respects an existing panel's fixed dimensions", () => {
  const install = (id) => ({ ownerButtonId: id, sourceIdentity: button(id).sourceIdentity,
    executionTarget: button(id).executionTarget, label: id, tooltip: "", children: [] });
  const before = mergeLegacyInstallsIntoDocument(createButtonStateDocument(), [install("Triangle")]);
  const panel = Object.values(before.surfaces).find((surface) => surface.name === "Blender / Shapes");
  panel.uniformButtonSize = { width: 77, height: 44 };
  Object.assign(before.placements[panel.placementIds[0]], panel.uniformButtonSize);
  before.placements[panel.placementIds[0]].matchHitboxToSkin = false;
  const next = mergeLegacyInstallsIntoDocument(before, [install("Hex")]);
  const added = next.placements["placement-Hex"];
  assert.deepEqual([added.width, added.height], [77, 44]);
  assert.equal(added.matchHitboxToSkin, false);
  assert.deepEqual(next.placements[panel.placementIds[0]], before.placements[panel.placementIds[0]]);
  assert.equal(validateButtonStateDocument(next).valid, true);
});

function windowsFor(document) {
  const Bounds = { Left: 10, Top: 20, Width: 231, Height: 88 };
  return [
    ...Object.keys(document.fanSetups).map((id) => ({ Kind: "button-fan", ButtonFanSetupId: id, Bounds })),
    ...Object.keys(document.popoutUnits).map((id) => ({ Kind: "button-popout", ButtonPopoutUnitId: id, Bounds }))
  ];
}
function fixture() {
  const document = createButtonStateDocument();
  const buttons = ["Sphere", "Cone", "Cube", "Cylinder", "Triangle"].map((id) => button(id));
  for (const item of buttons) document.buttons[item.id] = item;
  const fan = ensureFanSetup({ document, programName: "Blender", panelName: "Shapes", buttons });
  const pop = ensureRegularPopout(document, buttons);
  for (const [surfaceId, memberIds] of [[fan.fanSurfaceId, fan.fanMemberPlacementIds], [pop.surfaceId, pop.memberPlacementIds]]) {
    const surface = document.surfaces[surfaceId];
    surface.width = 231;
    surface.height = surfaceId === fan.fanSurfaceId ? 130 : 88;
    memberIds.forEach((id, index) => Object.assign(document.placements[id], {
      x: (index % 3) * 77, y: Math.floor(index / 3) * 44, width: 77, height: 44
    }));
    const owner = surface.placementIds.find((id) => !memberIds.includes(id));
    if (owner) Object.assign(document.placements[owner], { x: 0, y: 88, width: 82, height: 42 });
  }
  fan.collapsedPanelOwnerBounds = { left: 1894, top: 1163, width: 87, height: 45 };
  pop.canonicalBounds = { x: 0, y: 0, width: 231, height: 88 };
  return { document, fan, pop, buttons };
}

test("new Shapes member fills the sixth slot without changing saved IDs, placement or anchors", () => {
  const { document: before, fan, pop } = fixture();
  const next = structuredClone(before);
  next.buttons.Hex = button("Hex");
  reconcileAddedPanelButtons(before, next, windowsFor(before));
  for (const [id, placement] of Object.entries(before.placements)) assert.deepEqual(next.placements[id], placement);
  assert.deepEqual(next.fanSetups[fan.id].collapsedPanelOwnerBounds, fan.collapsedPanelOwnerBounds);
  for (const surfaceId of [fan.fanSurfaceId, pop.surfaceId]) {
    const added = Object.values(next.placements).find((p) => p.surfaceId === surfaceId && p.buttonId === "Hex");
    assert.deepEqual([added.x, added.y, added.width, added.height], [154, 44, 77, 44]);
  }
  assert.equal(validateButtonStateDocument(next).valid, true);
  const saved = JSON.stringify(next);
  reconcileAddedPanelButtons(before, next, windowsFor(before));
  assert.equal(JSON.stringify(next), saved);
  const restored = JSON.parse(saved);
  assert.equal(restored.fanSetups[fan.id].fanMemberButtonIds.at(-1), "Hex");
});

test("unrelated panels and deliberately selected subsets keep their membership", () => {
  const { document: before, buttons } = fixture();
  const usedWindows = windowsFor(before);
  const subset = ensureRegularPopout(before, [buttons[0]]);
  const next = structuredClone(before);
  next.buttons.Hex = button("Hex");
  next.buttons.Other = button("Other", "Utility");
  reconcileAddedPanelButtons(before, next, usedWindows);
  assert.deepEqual(next.popoutUnits[subset.id], before.popoutUnits[subset.id]);
  assert.equal(Object.values(next.placements).some((p) => p.buttonId === "Other"), false);
});

test("the actual Shapes owner stays the anchor and Hex skips its occupied slot", () => {
  const { document: before, fan } = fixture();
  const ownerId = before.surfaces[fan.fanSurfaceId].placementIds.find((id) => !fan.fanMemberPlacementIds.includes(id));
  Object.assign(before.placements[ownerId], { x: 160, y: 48, width: 82, height: 42 });
  Object.assign(before.surfaces[fan.fanSurfaceId], { width: 656, height: 104 });
  const next = structuredClone(before);
  next.buttons.Hex = button("Hex");
  reconcileAddedPanelButtons(before, next, windowsFor(before));
  const hex = next.placements[next.fanSetups[fan.id].fanMemberPlacementIds.at(-1)];
  const owner = next.placements[ownerId];
  assert.deepEqual([hex.x, hex.y], [0, 88]);
  assert.deepEqual(owner, before.placements[ownerId]);
  assert.deepEqual(next.fanSetups[fan.id].collapsedPanelOwnerBounds, fan.collapsedPanelOwnerBounds);
  for (const id of fan.fanMemberPlacementIds) assert.deepEqual(next.placements[id], before.placements[id]);
  assert.equal(validateButtonStateDocument(next).valid, true);
});

test("further additions extend the group without overlapping its existing buttons", () => {
  const { document: before, pop } = fixture();
  const next = structuredClone(before);
  for (const id of ["Hex", "Star", "Octagon"]) next.buttons[id] = button(id);
  reconcileAddedPanelButtons(before, next, windowsFor(before));
  const members = next.popoutUnits[pop.id].memberPlacementIds.map((id) => next.placements[id]);
  assert.deepEqual(members.slice(-3).map((p) => [p.x, p.y]), [[154, 44], [0, 88], [77, 88]]);
  assert.equal(next.surfaces[pop.surfaceId].height, 132);
  assert.equal(validateButtonStateDocument(next).valid, true);
});

test("only the exact saved Pop file used by the last layout receives additions", async () => {
  const { document: before, pop, fan } = fixture();
  const file = buildButtonSettingsFile(before, pop.surfaceId, { programName: "Blender", panelName: "Shapes" });
  const next = structuredClone(before);
  next.buttons.Hex = button("Hex");
  const calls = [];
  let saved;
  const commit = await prepareLastLayoutPanelUpdates(before, next, "last.flowlayout.json", {
    loadLayout: async (path) => {
      calls.push(path);
      return { Windows: [{ Kind: "button-popout", ProgramName: "Blender", PanelName: "Shapes", ButtonPopoutSettingsPath: "shapes-pop.json", ButtonPopoutChoiceId: "chosen", Bounds: { Left: 10, Top: 20, Width: 231, Height: 88 } }] };
    },
    resolveSettingsPath: async (path) => path,
    loadSettings: async (path) => { calls.push(path); return file; },
    saveSettings: async (path, value) => { calls.push(path); saved = value; }
  });
  assert.deepEqual(calls, ["last.flowlayout.json", "shapes-pop.json"]);
  assert.deepEqual(next.fanSetups[fan.id], fan);
  assert.deepEqual(next.popoutUnits[pop.id], pop);
  assert.equal(saved, undefined);
  await commit();
  assert.equal(saved.sourceSurfaceId, file.sourceSurfaceId);
  const restored = buildTransientButtonPopoutSettingsDocument(next, saved, { programName: "Blender", panelName: "Shapes" }, "chosen");
  assert.equal(restored.document.popoutUnits[restored.popoutUnitId].memberPlacementIds.length, 6);
  assert.equal(validateButtonStateDocument(restored.document).valid, true);
});

test("the last layout selects its exact Fan, leaving an unused Pop and its anchor untouched", async () => {
  const { document: before, fan, pop } = fixture();
  const next = structuredClone(before);
  next.buttons.Hex = button("Hex");
  await prepareLastLayoutPanelUpdates(before, next, "last.json", {
    loadLayout: async () => ({ Windows: windowsFor(before).filter((w) => w.ButtonFanSetupId === fan.id) }),
    loadSettings: async () => assert.fail("must not load unrelated saved files"),
    saveSettings: async () => assert.fail("must not change unrelated saved files")
  });
  assert.equal(next.fanSetups[fan.id].fanMemberButtonIds.length, 6);
  assert.deepEqual(next.popoutUnits[pop.id], pop);
  const draft = withAddedCanonicalPanelButtons(before, next);
  assert.equal(draft.fanSetups[fan.id].fanMemberButtonIds.length, 6);
  assert.deepEqual(draft.popoutUnits[pop.id], pop);
});

test("missing last-layout pointer never guesses a Pop or Fan", async () => {
  const { document: before } = fixture();
  const next = structuredClone(before);
  next.buttons.Hex = button("Hex");
  const expected = structuredClone(next);
  await prepareLastLayoutPanelUpdates(before, next, null, { loadLayout: async () => assert.fail("no guessed path") });
  assert.deepEqual(next, expected);
});
