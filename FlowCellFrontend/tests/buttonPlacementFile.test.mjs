import assert from "node:assert/strict";
import test from "node:test";

import { BUTTON_PLACEMENT_CYCLE_MAX_STATES } from "./.compiled-button-system/button/types.js";
import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import {
  normalizeLoadedButtonStateDocument,
  validateButtonStateDocument
} from "./.compiled-button-system/button/state/buttonStateValidation.js";
import {
  BUTTON_PLACEMENT_FILE_EXTENSION,
  BUTTON_PLACEMENT_FILE_FORMAT,
  BUTTON_PLACEMENT_FILE_FORMAT_V1,
  BUTTON_PLACEMENT_FILE_FORMAT_V2,
  applyButtonPlacementFile,
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
    activationCycle: null,
    highlightOnHover: false,
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

function validArrangementFixture() {
  const fixture = arrangementFixture();
  for (const button of Object.values(fixture.document.buttons)) {
    Object.assign(button, {
      role: "single-script",
      sourceIdentity: null,
      activationAnimation: null,
      activationBehavior: null,
      defaultTextFitMode: "shrink",
      disabled: false,
      toolSetParentId: null,
      toolSetBehavior: null,
      metadata: {}
    });
  }
  for (const placement of Object.values(fixture.document.placements)) {
    Object.assign(placement, {
      skinOverrideId: null,
      textFitMode: "shrink",
      textAlignment: "skin",
      textOffsetX: 0,
      textOffsetY: 0,
      minimumFontSize: fixture.document.settings.defaultMinimumFontSize,
      textSizeOverride: null,
      allowLabelResize: false,
      matchHitboxToSkin: true,
      allowStretching: false,
      resizeAnchor: "top-left",
      visualStateMap: null
    });
  }
  const document = normalizeLoadedButtonStateDocument(fixture.document);
  return {
    document,
    surface: document.surfaces[fixture.surface.id]
  };
}

test("Button placement file contains only the selected surface arrangement in saved order", () => {
  const { document, surface } = arrangementFixture();
  document.placements["placement-b"].textAlignment = "center";
  document.placements["placement-b"].highlightOnHover = true;
  document.placements["placement-b"].activationCycle = {
    states: [
      {
        id: "state-off", label: "Off", advanceTrigger: "release", visualState: "base",
        resultMatches: [{ enabled: false }]
      },
      {
        id: "state-on", label: "On", advanceTrigger: "press", visualState: "held",
        resultMatches: [{ enabled: true, status: { ready: true } }]
      }
    ]
  };
  const file = buildButtonPlacementFile(document, surface.id, {
    programName: " Blender ",
    panelName: " Files ",
    savedAt: "2026-07-21T12:34:56.000Z"
  });

  assert.equal(BUTTON_PLACEMENT_FILE_EXTENSION, ".flowcell-button-placement.json");
  assert.equal(file.format, BUTTON_PLACEMENT_FILE_FORMAT);
  assert.equal(file.format, BUTTON_PLACEMENT_FILE_FORMAT_V2);
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
    zIndex: 0,
    highlightOnHover: true,
    activationCycle: {
      states: [
        {
          id: "state-off", label: "Off", advanceTrigger: "release", visualState: "base",
          resultMatches: [{ enabled: false }]
        },
        {
          id: "state-on", label: "On", advanceTrigger: "press", visualState: "held",
          resultMatches: [{ enabled: true, status: { ready: true } }]
        }
      ]
    }
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
  malformed.placements[0].activationCycle = {
    states: [
      { id: "state-off", label: "Off", advanceTrigger: "release", visualState: "base" },
      { id: "state-on", label: "On", advanceTrigger: "press", visualState: "held" }
    ]
  };
  malformed.placements[0].activationCycle.states[1].id = "state-off";
  malformed.placements[0].activationCycle.states[1].advanceTrigger = "mystery";
  malformed.placements[0].activationCycle.states[0].resultMatches = ["not-an-object"];
  delete malformed.placements[1].activationCycle;
  malformed.placements[2].highlightOnHover = "yes";

  const validation = validateButtonPlacementFile(malformed);
  assert.equal(validation.valid, false);
  assert.equal(validation.issues.some((issue) => issue.includes("Unknown field")), true);
  assert.equal(validation.issues.some((issue) => issue.includes("Duplicate placement ID")), true);
  assert.equal(validation.issues.some((issue) => issue.includes("ordered index 1")), true);
  assert.equal(validation.issues.some((issue) => issue.includes("exceeds the surface width")), true);
  assert.equal(validation.issues.some((issue) => issue.includes("Duplicate activation-cycle state ID")), true);
  assert.equal(validation.issues.some((issue) => issue.includes("Expected press, hover, or release")), true);
  assert.equal(validation.issues.some((issue) => issue.includes("resultMatches.0: Expected a JSON object")), true);
  assert.equal(validation.issues.some((issue) => issue.includes("activationCycle: Missing field")), true);
  assert.equal(validation.issues.some((issue) => issue.includes("highlightOnHover: Expected a boolean")), true);
});

test("Button placement validation retains strict geometry-only v1 compatibility", () => {
  const { document, surface } = arrangementFixture();
  const v2 = buildButtonPlacementFile(document, surface.id, {
    programName: "Blender",
    panelName: "Files",
    savedAt: "2026-07-21T12:34:56.000Z"
  });
  const v1 = structuredClone(v2);
  v1.format = BUTTON_PLACEMENT_FILE_FORMAT_V1;
  v1.placements.forEach((placement) => {
    delete placement.activationCycle;
    delete placement.highlightOnHover;
  });

  assert.equal(validateButtonPlacementFile(v1).valid, true);
  v1.placements[0].activationCycle = null;
  const invalid = validateButtonPlacementFile(v1);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.issues.some((issue) => issue.includes("activationCycle: Unknown field")), true);
});

test("Button placement validation caps activation cycles at the shared maximum", () => {
  const { document, surface } = arrangementFixture();
  const file = buildButtonPlacementFile(document, surface.id, {
    programName: "Blender",
    panelName: "Files",
    savedAt: "2026-07-21T12:34:56.000Z"
  });
  file.placements[0].activationCycle = {
    states: Array.from({ length: BUTTON_PLACEMENT_CYCLE_MAX_STATES + 1 }, (_, index) => ({
      id: `state-${index}`,
      label: `State ${index + 1}`,
      advanceTrigger: "press",
      visualState: "base"
    }))
  };

  const validation = validateButtonPlacementFile(file);
  assert.equal(validation.valid, false);
  assert.equal(
    validation.issues.some((issue) => issue.includes(`no more than ${BUTTON_PLACEMENT_CYCLE_MAX_STATES} states`)),
    true
  );
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

test("Button placement loading restores only the selected surface scope", () => {
  const { document, surface } = validArrangementFixture();
  surface.width = 420;
  surface.height = 180;
  surface.uniformButtonSize = { width: 100, height: 40 };
  surface.placementIds = ["placement-c", "placement-a", "placement-b"];
  Object.assign(document.placements["placement-c"], {
    x: 0, y: 0, width: 100, height: 40, zIndex: 0
  });
  Object.assign(document.placements["placement-a"], {
    x: 110, y: 0, width: 100, height: 40, zIndex: 1
  });
  Object.assign(document.placements["placement-b"], {
    x: 220, y: 0, width: 100, height: 40, zIndex: 2,
    highlightOnHover: true,
    activationCycle: {
      states: [
        { id: "off", label: "Off", advanceTrigger: "release", visualState: "base" },
        { id: "on", label: "On", advanceTrigger: "press", visualState: "held" }
      ]
    }
  });
  const file = buildButtonPlacementFile(document, surface.id, {
    programName: "Blender",
    panelName: "Files",
    savedAt: "2026-07-21T12:34:56.000Z"
  });

  const current = structuredClone(document);
  current.surfaces[surface.id].width = 600;
  current.surfaces[surface.id].height = 400;
  current.surfaces[surface.id].uniformButtonSize = null;
  current.surfaces[surface.id].placementIds.reverse();
  current.placements["placement-b"].x = 340;
  current.placements["placement-b"].y = 240;
  current.placements["placement-b"].width = 120;
  current.placements["placement-b"].height = 60;
  current.placements["placement-b"].highlightOnHover = false;
  current.placements["placement-b"].activationCycle = null;
  current.placements["placement-b"].textAlignment = "right";
  current.placements["placement-b"].textOffsetX = 17;
  current.buttons["button-b"].label = "Current Button Label";
  current.buttons["button-b"].executionTarget = {
    kind: "core-action",
    actionId: "current-action"
  };
  const before = structuredClone(current);

  const loaded = applyButtonPlacementFile(current, surface.id, file);

  assert.deepEqual(current, before, "loading must not mutate the current draft");
  assert.equal(loaded.surfaces[surface.id].width, 420);
  assert.equal(loaded.surfaces[surface.id].height, 180);
  assert.deepEqual(loaded.surfaces[surface.id].uniformButtonSize, {
    width: 100,
    height: 40
  });
  assert.deepEqual(loaded.surfaces[surface.id].placementIds, [
    "placement-c",
    "placement-a",
    "placement-b"
  ]);
  assert.deepEqual(
    loaded.surfaces[surface.id].placementIds.map((id) => ({
      id,
      x: loaded.placements[id].x,
      y: loaded.placements[id].y,
      width: loaded.placements[id].width,
      height: loaded.placements[id].height,
      zIndex: loaded.placements[id].zIndex
    })),
    file.placements.map(({ id, x, y, width, height, zIndex }) => ({
      id, x, y, width, height, zIndex
    }))
  );
  assert.equal(loaded.placements["placement-b"].highlightOnHover, true);
  assert.deepEqual(
    loaded.placements["placement-b"].activationCycle,
    file.placements[2].activationCycle
  );
  assert.equal(loaded.placements["placement-b"].textAlignment, "right");
  assert.equal(loaded.placements["placement-b"].textOffsetX, 17);
  assert.equal(loaded.buttons["button-b"].label, "Current Button Label");
  assert.deepEqual(loaded.buttons["button-b"].executionTarget, {
    kind: "core-action",
    actionId: "current-action"
  });
  assert.equal(validateButtonStateDocument(loaded).valid, true);
});

test("geometry-only v1 loading preserves placement behavior absent from the file", () => {
  const { document, surface } = validArrangementFixture();
  const v2 = buildButtonPlacementFile(document, surface.id, {
    programName: "Blender",
    panelName: "Files",
    savedAt: "2026-07-21T12:34:56.000Z"
  });
  const v1 = structuredClone(v2);
  v1.format = BUTTON_PLACEMENT_FILE_FORMAT_V1;
  v1.placements.forEach((placement) => {
    delete placement.activationCycle;
    delete placement.highlightOnHover;
  });

  document.placements["placement-b"].x = 300;
  document.placements["placement-b"].highlightOnHover = true;
  document.placements["placement-b"].activationCycle = {
    states: [
      { id: "off", label: "Off", advanceTrigger: "release", visualState: "base" },
      { id: "on", label: "On", advanceTrigger: "press", visualState: "held" }
    ]
  };
  const loaded = applyButtonPlacementFile(document, surface.id, v1);

  assert.equal(loaded.placements["placement-b"].x, v1.placements[0].x);
  assert.equal(loaded.placements["placement-b"].highlightOnHover, true);
  assert.deepEqual(
    loaded.placements["placement-b"].activationCycle,
    document.placements["placement-b"].activationCycle
  );
});

test("Button placement loading rejects identity drift without mutating the draft", () => {
  const { document, surface } = validArrangementFixture();
  const file = buildButtonPlacementFile(document, surface.id, {
    programName: "Blender",
    panelName: "Files",
    savedAt: "2026-07-21T12:34:56.000Z"
  });
  const before = structuredClone(document);

  const wrongSurface = structuredClone(file);
  wrongSurface.surface.id = "different-surface";
  assert.throws(
    () => applyButtonPlacementFile(document, surface.id, wrongSurface),
    /not the selected surface/
  );

  const missingPlacement = structuredClone(file);
  missingPlacement.placements.pop();
  assert.throws(
    () => applyButtonPlacementFile(document, surface.id, missingPlacement),
    /same Button placements/
  );

  const wrongButton = structuredClone(file);
  wrongButton.placements[0].buttonId = "button-a";
  assert.throws(
    () => applyButtonPlacementFile(document, surface.id, wrongButton),
    /different Button/
  );
  assert.deepEqual(document, before);
});

test("canonical placement loading backfills and strictly validates activation cycles", () => {
  const document = createButtonStateDocument();
  const surface = Object.values(document.surfaces)[0];
  document.buttons.button = {
    id: "button",
    role: "single-script",
    sourceIdentity: null,
    label: "Button",
    tooltip: "",
    executionTarget: null,
    defaultSkinId: document.settings.defaultSkinId,
    defaultTextFitMode: "shrink",
    disabled: false,
    activationAnimation: null,
    activationBehavior: null,
    toolSetParentId: null,
    toolSetBehavior: null,
    metadata: {}
  };
  document.placements.placement = {
    id: "placement",
    buttonId: "button",
    surfaceId: surface.id,
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    zIndex: 0,
    skinOverrideId: null,
    textFitMode: "shrink",
    textAlignment: "skin",
    textOffsetX: 0,
    textOffsetY: 0,
    minimumFontSize: 8,
    textSizeOverride: null,
    allowLabelResize: false,
    matchHitboxToSkin: true,
    allowStretching: false,
    resizeAnchor: "top-left",
    visualStateMap: null
  };
  surface.placementIds = ["placement"];

  const missing = validateButtonStateDocument(document);
  assert.equal(missing.valid, false);
  assert.equal(missing.issues.some((issue) => issue.path.endsWith(".activationCycle")), true);
  assert.equal(missing.issues.some((issue) => issue.path.endsWith(".highlightOnHover")), true);

  const normalized = normalizeLoadedButtonStateDocument(document);
  assert.equal(normalized.placements.placement.activationCycle, null);
  assert.equal(normalized.placements.placement.highlightOnHover, false);
  assert.equal(validateButtonStateDocument(normalized).valid, true);

  normalized.placements.placement.activationCycle = {
    states: [
      {
        id: "one", label: "One", advanceTrigger: "press", visualState: "base",
        resultMatches: [{ axis: "X", mode: "NONE" }]
      },
      { id: "two", label: "Two", advanceTrigger: "hover", visualState: "hover" },
      { id: "three", label: "Three", advanceTrigger: "release", visualState: "held" }
    ]
  };
  assert.equal(validateButtonStateDocument(normalized).valid, true);

  normalized.placements.placement.activationCycle = {
    states: [
      {
        id: "duplicate", label: 42, advanceTrigger: "mystery", visualState: "unknown",
        resultMatches: "invalid"
      },
      {
        id: "duplicate", label: "Two", advanceTrigger: "release", visualState: "base",
        resultMatches: [false]
      }
    ]
  };
  const malformed = validateButtonStateDocument(normalized);
  assert.equal(malformed.valid, false);
  assert.equal(malformed.issues.some((issue) => issue.message.includes("IDs must be unique")), true);
  assert.equal(malformed.issues.some((issue) => issue.message.includes("label must be a string")), true);
  assert.equal(malformed.issues.some((issue) => issue.message.includes("press, hover, or release")), true);
  assert.equal(malformed.issues.some((issue) => issue.message.includes("visual state is invalid")), true);
  assert.equal(
    malformed.issues.some((issue) => issue.message.includes("result matches must be an array")),
    true
  );
  assert.equal(
    malformed.issues.some((issue) => issue.message.includes("result match must be a JSON object")),
    true
  );

  normalized.placements.placement.activationCycle = {
    states: [
      { id: "one", label: "One", advanceTrigger: ["press"], visualState: "base" },
      { id: "two", label: "Two", advanceTrigger: "release", visualState: ["held"] }
    ]
  };
  const nonStringEnums = validateButtonStateDocument(normalized);
  assert.equal(nonStringEnums.valid, false);
  assert.equal(
    nonStringEnums.issues.some((issue) => issue.path.endsWith(".advanceTrigger")),
    true
  );
  assert.equal(
    nonStringEnums.issues.some((issue) => issue.path.endsWith(".visualState")),
    true
  );

  normalized.placements.placement.activationCycle.states = [
    { id: "only", label: "Only", advanceTrigger: "press", visualState: "base" }
  ];
  const tooShort = validateButtonStateDocument(normalized);
  assert.equal(tooShort.valid, false);
  assert.equal(tooShort.issues.some((issue) => issue.message.includes("at least two states")), true);

  normalized.placements.placement.activationCycle.states = Array.from(
    { length: BUTTON_PLACEMENT_CYCLE_MAX_STATES + 1 },
    (_, index) => ({
      id: `state-${index}`,
      label: `State ${index + 1}`,
      advanceTrigger: "press",
      visualState: "base"
    })
  );
  const tooLong = validateButtonStateDocument(normalized);
  assert.equal(tooLong.valid, false);
  assert.equal(
    tooLong.issues.some((issue) => issue.message.includes(`cannot exceed ${BUTTON_PLACEMENT_CYCLE_MAX_STATES} states`)),
    true
  );
});
