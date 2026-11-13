import assert from "node:assert/strict";
import test from "node:test";
import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { buildQuickDefaultFanDocument, ensureFanSetup, ensureRegularPopout } from "./.compiled-button-system/button/state/buttonDocumentOperations.js";
import { createButtonSourceIdentity } from "./.compiled-button-system/button/state/sourceIdentity.js";
import { withCanonicalPanelFanMotion } from "./.compiled-button-system/button/windows/buttonWindowThemeDocument.js";

function fixture() {
  const document = createButtonStateDocument();
  const buttons = ["Save Blender", "save png", "obj import", "slicer", "cura", "orca", "save stl"].map((label, i) => ({
    id: `script-${i}`, role: "single-script", sourceIdentity: createButtonSourceIdentity("Blender", "Files", `${i}.py`),
    label, tooltip: "", executionTarget: { kind: "panel-script", programName: "Blender", panelName: "Files", fileName: `${i}.py` },
    defaultSkinId: "skin-default-neutral", defaultTextFitMode: "shrink", disabled: false,
    activationAnimation: null, activationBehavior: null, toolSetParentId: null, toolSetBehavior: null, metadata: {}
  }));
  buttons.forEach(button => { document.buttons[button.id] = button; });
  const args = { document, programName: "Blender", panelName: "Files", buttons };
  const old = ensureFanSetup(args);
  document.surfaces[old.fanSurfaceId].uniformButtonSize = { width: 69, height: 41 };
  for (const id of document.surfaces[old.fanSurfaceId].placementIds) {
    Object.assign(document.placements[id], { width: 69, height: 41, skinOverrideId: "skin-chipped-concrete-family-default", matchHitboxToSkin: false });
  }
  old.animation = { durationMs: 9000, staggerMs: 700, easing: "linear", spinEnabled: true };
  old.collapsedPanelOwnerBounds = { left: 100, top: 100, width: 69, height: 41 };
  const pop = ensureRegularPopout(document, buttons);
  document.placements[pop.memberPlacementIds[0]].x = 987;
  return { args, old, pop };
}

test("quick default Fan ignores matching saved setups and leaves all saved state untouched", () => {
  const { args, old, pop } = fixture();
  const before = structuredClone(args.document);
  const { document, setup } = buildQuickDefaultFanDocument(args);
  assert.notEqual(setup.id, old.id);
  assert.notEqual(setup.fanSurfaceId, old.fanSurfaceId);
  assert.deepEqual(args.document, before);
  assert.deepEqual(document.fanSetups[old.id], old);
  assert.deepEqual(document.popoutUnits[pop.id], pop);
  assert.deepEqual(document.placements[pop.memberPlacementIds[0]], before.placements[pop.memberPlacementIds[0]]);
  assert.equal(document.revision, before.revision);
  assert.equal(document.surfaces[setup.fanSurfaceId].uniformButtonSize, null);
  assert.equal(setup.collapsedPanelOwnerBounds, undefined);
  assert.deepEqual(setup.animation, { durationMs: 180, easing: "ease-out", staggerMs: 30, spinEnabled: false });
  for (const id of document.surfaces[setup.fanSurfaceId].placementIds) {
    const placement = document.placements[id];
    assert.equal(placement.skinOverrideId, "skin-default-neutral");
    assert.equal(placement.matchHitboxToSkin, true);
    assert.notEqual(placement.width, 69);
  }
  const next = buildQuickDefaultFanDocument({ ...args, document });
  assert.notEqual(next.setup.id, setup.id, "quick Fan never resolves a saved or previous temporary setup");
});

test("quick default Fan respects selected buttons and current Fan Options only", () => {
  const { args, old } = fixture();
  args.document.buttons[old.panelOwnerButtonId].metadata.panelFanMotionStyle = "spin";
  const selected = [args.buttons[2], args.buttons[0], args.buttons[2]];
  const { setup } = buildQuickDefaultFanDocument({ ...args, buttons: selected });
  assert.deepEqual(setup.fanMemberButtonIds, [args.buttons[2].id, args.buttons[0].id]);
  assert.equal(setup.animation.spinEnabled, true);
  assert.equal(setup.animation.durationMs, 180);
  assert.equal(setup.animation.staggerMs, 30);
});

test("Fan Options direction reaches an open quick draft without changing canonical or saved arrangements", () => {
  const { args, old } = fixture();
  const fresh = buildQuickDefaultFanDocument(args);
  const before = structuredClone(fresh.document);
  args.document.buttons[old.panelOwnerButtonId].metadata.panelFanDirection = "left";
  const canonicalBefore = structuredClone(args.document);
  const directed = withCanonicalPanelFanMotion(fresh.document, args.document);
  const ownerId = directed.surfaces[fresh.setup.fanSurfaceId].placementIds.find(id =>
    directed.placements[id].buttonId === fresh.setup.panelOwnerButtonId);
  const owner = directed.placements[ownerId];
  const members = fresh.setup.fanMemberPlacementIds.map(id => directed.placements[id]);
  assert.ok(members.every(member => member.x + member.width <= owner.x));
  assert.deepEqual(fresh.document, before);
  assert.deepEqual(args.document, canonicalBefore);
  assert.equal(withCanonicalPanelFanMotion(directed, args.document), directed);
  assert.deepEqual(directed.popoutUnits, before.popoutUnits, "ordinary Pop geometry is not a Fan direction target");
});

test("explicit direction translates an authored Pop fan as one group without rewriting its source", () => {
  const { args, old, pop } = fixture();
  const document = args.document;
  const originalOwner = document.surfaces[old.fanSurfaceId].placementIds.map(id => document.placements[id])
    .find(placement => placement.buttonId === old.panelOwnerButtonId);
  const owner = { ...originalOwner, id: "saved-pop-owner", surfaceId: pop.surfaceId };
  document.placements[owner.id] = owner;
  document.surfaces[pop.surfaceId].placementIds.push(owner.id);
  Object.assign(pop, { ownerPlacementId: owner.id, ownerButtonId: old.panelOwnerButtonId, interactionMode: "fan" });
  const canonical = structuredClone(document);
  canonical.buttons[old.panelOwnerButtonId].metadata.panelFanDirection = "top";
  const before = structuredClone(document);
  const directed = withCanonicalPanelFanMotion(document, canonical);
  const moved = pop.memberPlacementIds.map(id => directed.placements[id]);
  assert.ok(moved.every(member => member.y + member.height <= directed.placements[owner.id].y));
  for (const id of pop.memberPlacementIds) {
    assert.equal(directed.placements[id].x - moved[0].x, document.placements[id].x - document.placements[pop.memberPlacementIds[0]].x);
    assert.equal(directed.placements[id].width, document.placements[id].width);
  }
  assert.deepEqual(document, before);
});
