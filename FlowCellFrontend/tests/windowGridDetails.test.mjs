import assert from "node:assert/strict";
import test from "node:test";
import { resolveWindowGridDetails } from "./.compiled-button-system/pages/window-grid/windowGridDetails.js";

const document = {
  buttons: {
    utility: { label: "Utility", metadata: { programName: "Blender", panelName: "Utility" } },
    align: { label: "Align", metadata: {}, sourceIdentity: { displayProgramName: "Blender", displayPanelName: "Toolset" } },
    split: { label: "Split" }
  },
  placements: { split: { buttonId: "split" } },
  surfaces: { utility: { placementIds: ["split"] }, align: { placementIds: [] } },
  popoutUnits: {
    "popout-button-migrated-123": { name: "Align", kind: "tool-set", ownerButtonId: "align", surfaceId: "align" },
    "open-pop-unit-xyz": { name: "5 Buttons", kind: "regular", ownerButtonId: "utility", surfaceId: "utility" }
  },
  fanSetups: { "fan-uuid": { name: "Utility Fan", programName: "Blender", panelName: "Utility", panelOwnerButtonId: "utility", fanMemberPlacementIds: ["split"] } }
};

test("Window Grid resolves toolset names instead of migrated internal IDs", () => {
  const result = resolveWindowGridDetails({ kind: "button-popout", buttonPopoutUnitId: "popout-button-migrated-123" }, document, "FlowCell - Button Popout");
  assert.deepEqual(result, { program: "Blender", panel: "Toolset", title: "Align", kind: "Toolset", members: "" });
});

test("Utility uses its owner name instead of a generic Button count and retains its program", () => {
  const result = resolveWindowGridDetails({ kind: "button-popout", buttonPopoutUnitId: "open-pop-unit-xyz" }, document, "FlowCell - Button Popout");
  assert.equal(result.title, "Utility");
  assert.equal(result.program, "Blender");
  assert.equal(result.panel, "Utility");
  assert.equal(result.members, "Split");
});

test("fan names and ownership remain readable without optional registry fields", () => {
  const result = resolveWindowGridDetails({ kind: "button-fan", buttonFanSetupId: "fan-uuid" }, document, "FlowCell - Button Fan");
  assert.equal(result.title, "Utility Fan");
  assert.equal(result.program, "Blender");
  assert.equal(result.panel, "Utility");
  assert.equal(result.kind, "Fan");
});

test("installed Pages use their real native title, and missing documents still have readable fallbacks", () => {
  assert.equal(resolveWindowGridDetails({ kind: "installed-page", buttonOwnerId: "align" }, document, "FlowCell - Popped Button Colors").title, "Popped Button Colors");
  assert.equal(resolveWindowGridDetails({ kind: "button-editor" }, null, "").title, "Buttons Editor");
  assert.equal(resolveWindowGridDetails(undefined, null, "FlowCell - Motion Settings").title, "Motion Settings");
});

test("custom saved names remain authoritative over owner labels", () => {
  const custom = structuredClone(document);
  custom.popoutUnits["open-pop-unit-xyz"].name = "My modeling controls";
  assert.equal(resolveWindowGridDetails({ kind: "button-popout", buttonPopoutUnitId: "open-pop-unit-xyz" }, custom, "FlowCell - Button Popout").title, "My modeling controls");
});
