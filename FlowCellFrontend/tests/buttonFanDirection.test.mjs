import assert from "node:assert/strict";
import test from "node:test";
import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { buttonSpacingPixelsFromMillimeters } from "./.compiled-button-system/button/geometry/buttonGeometry.js";
import {
  applyButtonFanDirection, DEFAULT_BUTTON_FAN_DIRECTION, resolveButtonFanExpansionDirection
} from "./.compiled-button-system/button/fan/buttonFanDirection.js";

function fixture() {
  const document = createButtonStateDocument();
  document.settings.buttonSpacingMm = 1.5;
  document.settings.defaultSurfacePadding = 8;
  document.buttons.owner = { id: "owner", label: "Files" };
  document.surfaces.fan = { id: "fan", kind: "fan", width: 900, height: 600,
    placementIds: ["owner", "a", "b", "c"], uniformButtonSize: null, visualOverflowAllowance: 24 };
  document.placements.owner = { id: "owner", buttonId: "owner", surfaceId: "fan", x: 235, y: -40,
    width: 66, height: 44, skinOverrideId: "custom-owner" };
  document.placements.a = { id: "a", buttonId: "a", surfaceId: "fan", x: 100, y: 35,
    width: 64.25, height: 44, skinOverrideId: "skin-a", textOffsetX: 3 };
  document.placements.b = { id: "b", buttonId: "b", surfaceId: "fan", x: 164.25, y: 35,
    width: 138.3, height: 44, skinOverrideId: "skin-b" };
  document.placements.c = { id: "c", buttonId: "c", surfaceId: "fan", x: 100, y: 79,
    width: 92, height: 44, skinOverrideId: "skin-c" };
  document.placements.unrelated = { id: "unrelated", surfaceId: "elsewhere", x: 9, y: 11, width: 200, height: 50 };
  document.fanSetups.setup = { id: "setup", fanSurfaceId: "fan", fanMemberPlacementIds: ["a", "b", "c"],
    collapsedPanelOwnerBounds: { left: 700, top: 250, width: 66, height: 44 },
    collapsedBoundsEnvelope: { x: -4, y: -3, width: 74, height: 50 } };
  document.themeOverrides = { a: { colors: { surface: "#ABCDEF" } } };
  return { document, target: { surfaceId: "fan", ownerPlacementId: "owner", memberPlacementIds: ["a", "b", "c"] } };
}

function bounds(document, ids) {
  const placements = ids.map((id) => document.placements[id]);
  const left = Math.min(...placements.map((placement) => placement.x));
  const top = Math.min(...placements.map((placement) => placement.y));
  const right = Math.max(...placements.map((placement) => placement.x + placement.width));
  const bottom = Math.max(...placements.map((placement) => placement.y + placement.height));
  return { left, top, right, bottom };
}

const near = (left, right) => assert.ok(Math.abs(left - right) < 1e-8, `${left} differs from ${right}`);

test("Fan directions validate to a rightward default", () => {
  assert.equal(DEFAULT_BUTTON_FAN_DIRECTION, "right");
  for (const direction of ["left", "right", "top", "bottom"]) assert.equal(resolveButtonFanExpansionDirection(direction), direction);
  for (const invalid of [undefined, null, "Left", "diagonal", 0, {}]) assert.equal(resolveButtonFanExpansionDirection(invalid), "right");
});

for (const direction of ["left", "right", "top", "bottom"]) {
  test(`${direction} places the member group beside its anchored owner without changing the grid or skins`, () => {
    const { document, target } = fixture();
    const original = structuredClone(document);
    const next = applyButtonFanDirection(document, target, direction);
    const owner = next.placements.owner;
    const group = bounds(next, target.memberPlacementIds);
    const gap = buttonSpacingPixelsFromMillimeters(document.settings.buttonSpacingMm);
    if (direction === "right") near(group.left - (owner.x + owner.width), gap);
    if (direction === "left") near(owner.x - group.right, gap);
    if (direction === "top") near(owner.y - group.bottom, gap);
    if (direction === "bottom") near(group.top - (owner.y + owner.height), gap);
    for (const id of target.memberPlacementIds) {
      const before = document.placements[id];
      const after = next.placements[id];
      near(after.x - next.placements.a.x, before.x - document.placements.a.x);
      near(after.y - next.placements.a.y, before.y - document.placements.a.y);
      assert.deepEqual({ ...after, x: before.x, y: before.y }, before);
      assert.ok(after.x >= 8 && after.y >= 8);
    }
    assert.ok(owner.x >= 8 && owner.y >= 8);
    const all = bounds(next, ["owner", ...target.memberPlacementIds]);
    near(next.surfaces.fan.width, all.right + 8);
    near(next.surfaces.fan.height, all.bottom + 8);
    assert.equal(next.surfaces.fan.placementIds, document.surfaces.fan.placementIds);
    assert.equal(next.fanSetups, document.fanSetups, "desktop anchors, envelopes and member references are untouched");
    assert.equal(next.buttons, document.buttons);
    assert.equal(next.skins, document.skins);
    assert.equal(next.themeOverrides, document.themeOverrides);
    assert.equal(next.placements.unrelated, document.placements.unrelated);
    assert.deepEqual(document, original);
    assert.equal(applyButtonFanDirection(next, target, direction), next, "same direction must not trigger render loops");
  });
}

test("direction changes translate rather than rotate or repack saved Pop members", () => {
  const { document, target } = fixture();
  document.surfaces.fan.kind = "regular-popout";
  const right = applyButtonFanDirection(document, target, "right");
  const top = applyButtonFanDirection(right, target, "top");
  const back = applyButtonFanDirection(top, target, "right");
  for (const id of ["owner", ...target.memberPlacementIds]) {
    near(back.placements[id].x, right.placements[id].x);
    near(back.placements[id].y, right.placements[id].y);
    assert.deepEqual({ ...back.placements[id], x: right.placements[id].x, y: right.placements[id].y }, right.placements[id]);
  }
  near(back.surfaces.fan.width, right.surfaces.fan.width);
  near(back.surfaces.fan.height, right.surfaces.fan.height);
  assert.equal(applyButtonFanDirection(back, target, "right"), back);
  assert.equal(back.surfaces.fan.kind, "regular-popout");
});

test("an owner-only Fan has padding without an empty content gap", () => {
  const { document, target } = fixture();
  target.memberPlacementIds = [];
  document.surfaces.fan.placementIds = ["owner"];
  const next = applyButtonFanDirection(document, target, "left");
  assert.equal(next.placements.owner.x, 8);
  assert.equal(next.placements.owner.y, 8);
  assert.equal(next.surfaces.fan.width, 82);
  assert.equal(next.surfaces.fan.height, 60);
  assert.equal(applyButtonFanDirection(next, target, "bottom"), next);
});

test("invalid owner or member references leave the document unchanged", () => {
  const { document, target } = fixture();
  assert.equal(applyButtonFanDirection(document, { ...target, surfaceId: "missing" }, "top"), document);
  assert.equal(applyButtonFanDirection(document, { ...target, ownerPlacementId: "missing" }, "top"), document);
  assert.equal(applyButtonFanDirection(document, { ...target, memberPlacementIds: ["unrelated"] }, "top"), document);
  assert.equal(applyButtonFanDirection(document, { ...target, memberPlacementIds: ["missing"] }, "top"), document);
});

test("tool-set fields move with the complete content group while hidden fields keep their relative positions", () => {
  const { document, target } = fixture();
  target.popoutUnitId = "tool";
  document.surfaces.fan.kind = "tool-set-popout";
  document.popoutUnits.tool = {
    id: "tool", kind: "tool-set", surfaceId: "fan", ownerButtonId: "owner",
    canonicalBounds: { x: 0, y: 0, width: 900, height: 600 },
    desktopBounds: { left: 400, top: 300, width: 900, height: 600 },
    desktopBoundsEnvelope: { x: -8, y: -4, width: 916, height: 608 },
    fields: [
      { id: "visible", kind: "number", x: 78, y: 140, width: 250, height: 30, defaultValue: 42 },
      { id: "hidden", kind: "toggle", x: 90, y: 20, width: 120, height: 24, hidden: true, defaultValue: false }
    ]
  };
  const original = structuredClone(document);
  const next = applyButtonFanDirection(document, target, "left");
  const fields = next.popoutUnits.tool.fields;
  const dx = next.placements.a.x - document.placements.a.x;
  const dy = next.placements.a.y - document.placements.a.y;
  for (let index = 0; index < fields.length; index += 1) {
    near(fields[index].x - document.popoutUnits.tool.fields[index].x, dx);
    near(fields[index].y - document.popoutUnits.tool.fields[index].y, dy);
    assert.deepEqual({ ...fields[index], x: original.popoutUnits.tool.fields[index].x,
      y: original.popoutUnits.tool.fields[index].y }, original.popoutUnits.tool.fields[index]);
  }
  near(next.placements.owner.x - (fields[0].x + fields[0].width),
    buttonSpacingPixelsFromMillimeters(document.settings.buttonSpacingMm));
  near(fields[0].x, 8, "the visible field participates in the group bounds");
  near(next.popoutUnits.tool.canonicalBounds.width, next.surfaces.fan.width);
  near(next.popoutUnits.tool.canonicalBounds.height, next.surfaces.fan.height);
  assert.equal(next.popoutUnits.tool.desktopBounds, document.popoutUnits.tool.desktopBounds);
  assert.equal(next.popoutUnits.tool.desktopBoundsEnvelope, document.popoutUnits.tool.desktopBoundsEnvelope);
  assert.equal(next.fanSetups, document.fanSetups);
  assert.deepEqual(document, original);
  assert.equal(applyButtonFanDirection(next, target, "left"), next);
  const above = applyButtonFanDirection(next, target, "top");
  const restored = applyButtonFanDirection(above, target, "left");
  for (const id of ["owner", "a", "b", "c"]) {
    near(restored.placements[id].x, next.placements[id].x);
    near(restored.placements[id].y, next.placements[id].y);
  }
});

test("field-only content is directional and an all-hidden toolset remains idempotent", () => {
  const { document, target } = fixture();
  target.memberPlacementIds = [];
  target.popoutUnitId = "tool";
  document.surfaces.fan.placementIds = ["owner"];
  document.popoutUnits.tool = { id: "tool", kind: "tool-set", surfaceId: "fan",
    canonicalBounds: { x: 0, y: 0, width: 500, height: 300 },
    fields: [{ id: "field", kind: "text", x: 70, y: 50, width: 150, height: 28 }] };
  const next = applyButtonFanDirection(document, target, "bottom");
  near(next.popoutUnits.tool.fields[0].y - (next.placements.owner.y + next.placements.owner.height),
    buttonSpacingPixelsFromMillimeters(document.settings.buttonSpacingMm));
  assert.equal(applyButtonFanDirection(next, target, "bottom"), next);
  const hidden = structuredClone(document);
  hidden.popoutUnits.tool.fields[0].hidden = true;
  const hiddenNext = applyButtonFanDirection(hidden, target, "top");
  assert.equal(hiddenNext.popoutUnits.tool.fields, hidden.popoutUnits.tool.fields);
  assert.equal(applyButtonFanDirection(hiddenNext, target, "top"), hiddenNext);
});

test("regular Pop canonical bounds follow its surface while unrelated units remain untouched", () => {
  const { document, target } = fixture();
  target.popoutUnitId = "regular";
  document.popoutUnits.regular = { id: "regular", kind: "regular", surfaceId: "fan",
    canonicalBounds: { x: 0, y: 0, width: 900, height: 600 },
    desktopBounds: { left: 700, top: 200, width: 900, height: 600 } };
  document.popoutUnits.other = { id: "other", kind: "regular", surfaceId: "other" };
  const next = applyButtonFanDirection(document, target, "top");
  near(next.popoutUnits.regular.canonicalBounds.width, next.surfaces.fan.width);
  near(next.popoutUnits.regular.canonicalBounds.height, next.surfaces.fan.height);
  assert.equal(next.popoutUnits.regular.desktopBounds, document.popoutUnits.regular.desktopBounds);
  assert.equal(next.popoutUnits.other, document.popoutUnits.other);
  assert.equal(applyButtonFanDirection(document, { ...target, popoutUnitId: "other" }, "top"), document);
});
