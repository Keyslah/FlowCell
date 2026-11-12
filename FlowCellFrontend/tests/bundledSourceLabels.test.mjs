import test from "node:test";
import assert from "node:assert/strict";

import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { createButtonSourceIdentity } from "./.compiled-button-system/button/state/sourceIdentity.js";
import { reconcileBundledProgramSources } from "./.compiled-button-system/button/state/ButtonStateRepository.js";

function descriptor(previousDefaultLabel, label = "<") {
  return {
    ownerButtonId: "cycle-owner",
    previousDefaultLabel,
    sourceIdentity: {
      programName: "Blender", panelName: "Collections", fileName: "cycle.flowcell-source.json"
    },
    owner: {
      label, tooltip: "Cycle versions",
      executionTarget: {
        kind: "program-action", programName: "Blender", actionId: "run-installed-source",
        payload: {
          ownerButtonId: "cycle-owner",
          direction: previousDefaultLabel === "cycle versions back" ? "backward" : "forward"
        }
      }
    },
    children: []
  };
}

function documentWithOwner(label) {
  const document = createButtonStateDocument();
  document.buttons["cycle-owner"] = {
    id: "cycle-owner", role: "single-script",
    sourceIdentity: createButtonSourceIdentity("Blender", "Collections", "cycle.flowcell-source.json"),
    label, tooltip: "My tooltip", executionTarget: descriptor(label).owner.executionTarget,
    defaultSkinId: document.settings.defaultSkinId, defaultTextFitMode: "shrink",
    disabled: false, activationAnimation: null, activationBehavior: null,
    toolSetParentId: null, toolSetBehavior: null, metadata: { userNote: "keep" }
  };
  return document;
}

test("fresh bundled owners use the declared symbol and retain their action direction", () => {
  const installed = reconcileBundledProgramSources(createButtonStateDocument(), [descriptor()]);
  assert.equal(installed.buttons["cycle-owner"].label, "<");
  assert.equal(installed.buttons["cycle-owner"].executionTarget.payload.direction, "forward");
});

test("managed reconciliation repairs only an unchanged previous default label", () => {
  for (const [previous, next] of [["cycle versions forward", "<"], ["cycle versions back", ">"]]) {
    const before = documentWithOwner(previous);
    const updated = reconcileBundledProgramSources(before, [descriptor(previous, next)]);
    assert.equal(before.buttons["cycle-owner"].label, previous);
    assert.equal(updated.buttons["cycle-owner"].label, next);
    assert.equal(updated.buttons["cycle-owner"].tooltip, "My tooltip");
    assert.deepEqual(updated.buttons["cycle-owner"].metadata, { userNote: "keep" });
    assert.deepEqual(updated.buttons["cycle-owner"].executionTarget, before.buttons["cycle-owner"].executionTarget);
    assert.deepEqual(reconcileBundledProgramSources(updated, [descriptor(previous, next)]), updated);
  }
});

test("managed reconciliation preserves custom owner labels and occurrence overrides", () => {
  for (const label of ["cycle versions forward", "My version arrow"]) {
    const before = documentWithOwner(label);
    before.placements.custom = {
      id: "custom", buttonId: "cycle-owner", surfaceId: "custom-surface",
      x: 0, y: 0, width: 60, height: 40, zIndex: 0,
      presentationOverride: { label: "Custom popup arrow" }
    };
    const updated = reconcileBundledProgramSources(before, [descriptor("cycle versions forward")]);
    assert.equal(updated.buttons["cycle-owner"].label, label === "cycle versions forward" ? "<" : label);
    assert.deepEqual(updated.placements, before.placements);
  }
});

test("managed label repair matches the actual previous manifest label instead of guessing from its file", () => {
  const before = documentWithOwner("Stored Manifest Title");
  const updated = reconcileBundledProgramSources(before, [descriptor("Stored Manifest Title", "Declared Caption")]);
  assert.equal(updated.buttons["cycle-owner"].label, "Declared Caption");
});

test("ordinary source updates cannot rename a matching label without a managed repair baseline", () => {
  const before = documentWithOwner("cycle versions forward");
  const updated = reconcileBundledProgramSources(before, [descriptor()]);
  assert.equal(updated.buttons["cycle-owner"].label, "cycle versions forward");
});
