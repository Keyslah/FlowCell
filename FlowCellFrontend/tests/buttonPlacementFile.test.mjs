import assert from "node:assert/strict";
import test from "node:test";

import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import {
  BUTTON_PLACEMENT_FILE_EXTENSION,
  BUTTON_PLACEMENT_FILE_FORMAT,
  buildButtonPlacementFile,
  validateButtonPlacementFile
} from "./.compiled-button-system/button/state/buttonPlacementFile.js";

function addButton(document, id, marker) {
  document.buttons[id] = {
    id,
    label: marker,
    tooltip: marker,
    executionTarget: { kind: "core-action", actionId: marker },
    activationAnimation: { presetId: marker, desktopBounds: null },
    defaultSkinId: Object.keys(document.skins)[0]
  };
}

function addPlacement(document, surfaceId, id, buttonId, rect, zIndex) {
  document.placements[id] = {
    id,
    buttonId,
    surfaceId,
    zIndex,
    ...rect
  };
}

function arrangementFixture() {
  const document = createButtonStateDocument();
  const surface = document.surfaces[Object.keys(document.surfaces)[0]];
  surface.name = "Files";
  surface.width = 500;
  surface.height = 300;
  surface.uniformButtonSize = null;
  addButton(document, "button-a", "SECRET_ACTION_A");
  addButton(document, "button-b", "SECRET_ANIMATION_B");
  addButton(document, "button-c", "SECRET_SKIN_C");
  addPlacement(document, surface.id, "placement-a", "button-a", {
    x: 120, y: 0, width: 100, height: 40
  }, 17);
  addPlacement(document, surface.id, "placement-b", "button-b", {
    x: 0, y: 60, width: 90, height: 50
  }, 2);
  addPlacement(document, surface.id, "placement-c", "button-c", {
    x: 110, y: 60, width: 110, height: 50
  }, 99);
  surface.placementIds = ["placement-b", "placement-c", "placement-a"];
  return { document, surface };
}

test("Button placement file contains only the selected surface arrangement in saved order", () => {
  const { document, surface } = arrangementFixture();
  document.placements["placement-b"].textAlignment = "center";
  const file = buildButtonPlacementFile(document, surface.id, {
    programName: " Blender ",
    panelName: " Files ",
    savedAt: "2026-07-21T12:34:56.000Z"
  });

  assert.equal(BUTTON_PLACEMENT_FILE_EXTENSION, ".flowcell-button-placement.json");
  assert.equal(file.format, BUTTON_PLACEMENT_FILE_FORMAT);
  assert.equal(file.programName, "Blender");
  assert.equal(file.panelName, "Files");
  assert.deepEqual(file.placements.map((placement) => placement.id), surface.placementIds);
  assert.deepEqual(file.placements.map((placement) => placement.zIndex), [0, 1, 2]);
  assert.deepEqual(file.placements[0], {
    id: "placement-b",
    buttonId: "button-b",
    x: 0,
    y: 60,
    width: 90,
    height: 50,
    zIndex: 0
  });
  assert.deepEqual(Object.keys(file).sort(), [
    "format", "panelName", "placements", "programName", "savedAt", "surface"
  ]);
  assert.deepEqual(Object.keys(file.surface).sort(), [
    "height", "id", "kind", "name", "uniformButtonSize", "width"
  ]);

  const serialized = JSON.stringify(file);
  for (const excluded of [
    "buttons",
    "skins",
    "popoutUnits",
    "fanSetups",
    "settings",
    "textAlignment",
    "SECRET_ACTION_A",
    "SECRET_ANIMATION_B",
    "SECRET_SKIN_C"
  ]) {
    assert.equal(serialized.includes(excluded), false, `${excluded} must not enter the arrangement file`);
  }
  assert.equal(validateButtonPlacementFile(file).valid, true);
});

test("Button placement validation is strict about fields, order, identity, and surface bounds", () => {
  const { document, surface } = arrangementFixture();
  const valid = buildButtonPlacementFile(document, surface.id, {
    programName: "Blender",
    panelName: "Files",
    savedAt: "2026-07-21T12:34:56.000Z"
  });
  const malformed = structuredClone(valid);
  malformed.unexpected = true;
  malformed.placements[1].id = malformed.placements[0].id;
  malformed.placements[1].zIndex = 8;
  malformed.placements[2].x = malformed.surface.width;

  const validation = validateButtonPlacementFile(malformed);
  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.includes("Unknown field")), true);
  assert.equal(validation.issues.some((issue) => issue.includes("Duplicate placement ID")), true);
  assert.equal(validation.issues.some((issue) => issue.includes("ordered index 1")), true);
  assert.equal(validation.issues.some((issue) => issue.includes("exceeds the surface width")), true);
});

test("Button placement builder refuses missing and cross-surface placement records", () => {
  const { document, surface } = arrangementFixture();
  delete document.placements["placement-c"];
  assert.throws(
    () => buildButtonPlacementFile(document, surface.id, {
      programName: "Blender", panelName: "Files"
    }),
    /missing placement 'placement-c'/
  );

  const fixture = arrangementFixture();
  fixture.document.placements["placement-c"].surfaceId = "some-other-surface";
  assert.throws(
    () => buildButtonPlacementFile(fixture.document, fixture.surface.id, {
      programName: "Blender", panelName: "Files"
    }),
    /belongs to a different surface/
  );
});
