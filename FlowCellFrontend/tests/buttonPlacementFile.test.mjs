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
import {
  BUTTON_SETTINGS_FILE_EXTENSION,
  BUTTON_SETTINGS_FILE_FORMAT,
  applyButtonSettingsFile,
  buildTransientButtonPopoutSettingsDocument,
  buildButtonSettingsFile,
  buttonSettingsPlacementKind,
  normalizeButtonSettingsFile,
  validateButtonSettingsFile
} from "./.compiled-button-system/button/state/buttonSettingsFile.js";
import {
  createButtonSourceIdentity,
  deriveRegularPopoutSelectionKey
} from "./.compiled-button-system/button/state/sourceIdentity.js";
import { ensureFanSetup } from "./.compiled-button-system/button/state/buttonDocumentOperations.js";
import {
  reconcileProgramPanelOwners,
  resolvePanelOwnerFanPlacement
} from "./.compiled-button-system/button/state/panelOwnerButtonOperations.js";

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

function regularPopSettingsFixture() {
  const { document, surface: mainSurface } = validArrangementFixture();
  const surface = {
    ...structuredClone(mainSurface),
    id: "surface-saved-pop",
    name: "Saved Files Pop",
    kind: "regular-popout",
    placementIds: [...mainSurface.placementIds]
  };
  document.surfaces[surface.id] = surface;
  mainSurface.placementIds = [];
  const identities = [];
  surface.placementIds.forEach((placementId, index) => {
    const placement = document.placements[placementId];
    placement.surfaceId = surface.id;
    const button = document.buttons[placement.buttonId];
    const identity = createButtonSourceIdentity(
      "Windows",
      "Files",
      `${button.id}-${index}.flowcell-source.json`
    );
    button.sourceIdentity = identity;
    button.executionTarget = {
      kind: "core-action",
      actionId: `CURRENT_TARGET_${button.id}`
    };
    identities.push(identity);
  });
  document.popoutUnits["saved-pop"] = {
    id: "saved-pop",
    name: surface.name,
    kind: "regular",
    surfaceId: surface.id,
    canonicalBounds: { x: 0, y: 0, width: surface.width, height: surface.height },
    desktopBounds: null,
    desktopBoundsFitMode: "surface",
    desktopBoundsEnvelope: { x: 0, y: 0, width: surface.width, height: surface.height },
    memberPlacementIds: [...surface.placementIds],
    openRule: "toggle",
    closeRule: "escape",
    transparency: 1,
    pinnedDefault: false,
    windowFitMode: "surface",
    memberSourceIdentities: structuredClone(identities),
    selectionKey: deriveRegularPopoutSelectionKey(identities)
  };
  const settings = buildButtonSettingsFile(document, surface.id, {
    programName: "Windows",
    panelName: "Files",
    savedAt: "2026-07-23T12:34:56.000Z"
  });
  return { document, surface, settings };
}

function toolSetPopSettingsFixture() {
  const fixture = regularPopSettingsFixture();
  const document = fixture.document;
  const templateButton = document.buttons[fixture.settings.entries[0].buttonId];
  const templatePlacement = document.placements[fixture.surface.placementIds[0]];
  const ownerIdentity = createButtonSourceIdentity(
    "Windows",
    "Files",
    "tools.flowcell-source.json"
  );
  document.buttons["tool-owner"] = {
    ...structuredClone(templateButton),
    id: "tool-owner",
    role: "tool-set-owner",
    sourceIdentity: ownerIdentity,
    label: "Tools",
    executionTarget: null,
    toolSetParentId: null,
    toolSetBehavior: null
  };
  for (const childId of ["tool-child-a", "tool-child-b"]) {
    document.buttons[childId] = {
      ...structuredClone(templateButton),
      id: childId,
      role: "tool-set-child",
      sourceIdentity: ownerIdentity,
      label: childId,
      executionTarget: { kind: "core-action", actionId: `CURRENT_${childId}` },
      toolSetParentId: "tool-owner",
      toolSetBehavior: null
    };
  }
  const surface = {
    id: "surface-tool-pop",
    name: "Saved Tool Pop",
    kind: "tool-set-popout",
    width: 340,
    height: 90,
    placementIds: ["tool-placement-a", "tool-placement-b"],
    visualOverflowAllowance: 24,
    uniformButtonSize: null
  };
  document.surfaces[surface.id] = surface;
  ["tool-child-a", "tool-child-b"].forEach((buttonId, index) => {
    document.placements[`tool-placement-${index === 0 ? "a" : "b"}`] = {
      ...structuredClone(templatePlacement),
      id: `tool-placement-${index === 0 ? "a" : "b"}`,
      buttonId,
      surfaceId: surface.id,
      x: index * 150,
      y: 0,
      zIndex: index
    };
  });
  document.popoutUnits["tool-pop"] = {
    id: "tool-pop",
    name: surface.name,
    kind: "tool-set",
    surfaceId: surface.id,
    canonicalBounds: { x: 0, y: 0, width: surface.width, height: surface.height },
    desktopBounds: null,
    desktopBoundsFitMode: "surface",
    desktopBoundsEnvelope: { x: 0, y: 0, width: surface.width, height: surface.height },
    ownerButtonId: "tool-owner",
    childButtonIds: ["tool-child-a", "tool-child-b"],
    childPlacementIds: [...surface.placementIds],
    openRule: "toggle",
    closeRule: "escape",
    transparency: 1,
    pinnedDefault: false,
    windowFitMode: "surface",
    fields: []
  };
  const settings = buildButtonSettingsFile(document, surface.id, {
    programName: "Windows",
    panelName: "Files",
    savedAt: "2026-07-23T12:34:56.000Z"
  });
  return { document, settings };
}

function crossToolSetFanSettingsFixture() {
  const fixture = toolSetPopSettingsFixture();
  const document = fixture.document;
  const sourceSurface = document.surfaces["surface-tool-pop"];
  const sourceUnit = document.popoutUnits["tool-pop"];
  const templatePlacement = document.placements["tool-placement-a"];

  document.skins["source-layout-skin"] = {
    ...structuredClone(document.skins[document.settings.defaultSkinId]),
    id: "source-layout-skin",
    name: "Source Layout Skin",
    hover: "filter: brightness(1.75);"
  };
  Object.assign(document.buttons["tool-child-a"].metadata, { toolSetSlot: "left" });
  Object.assign(document.buttons["tool-child-b"].metadata, { toolSetSlot: "right" });
  Object.assign(document.placements["tool-placement-a"], {
    x: 30,
    y: 10,
    skinOverrideId: "source-layout-skin"
  });
  Object.assign(document.placements["tool-placement-b"], { x: 160, y: 10 });
  document.placements["tool-owner-fan-placement"] = {
    ...structuredClone(templatePlacement),
    id: "tool-owner-fan-placement",
    buttonId: "tool-owner",
    surfaceId: sourceSurface.id,
    x: 250,
    y: 40,
    zIndex: 2,
    skinOverrideId: null
  };
  sourceSurface.placementIds.push("tool-owner-fan-placement");
  Object.assign(sourceUnit, {
    interactionMode: "fan",
    ownerPlacementId: "tool-owner-fan-placement",
    windowFitMode: "hitbox"
  });

  const targetIdentity = createButtonSourceIdentity(
    "Blender",
    "Rotate",
    "target-tools.flowcell-source.json"
  );
  document.buttons["target-tool-owner"] = {
    ...structuredClone(document.buttons["tool-owner"]),
    id: "target-tool-owner",
    sourceIdentity: targetIdentity,
    label: "Target Tools",
    metadata: { toolSetPackageId: "target-tools" }
  };
  const targetBehavior = {
    mode: "momentary",
    states: [{ id: "target-ready", label: "Target Ready", labelOverrides: {} }]
  };
  for (const [buttonId, slot, label, actionId] of [
    ["target-tool-right", "right", "Target Right", "TARGET_RIGHT_ACTION"],
    ["target-tool-left", "left", "Target Left", "TARGET_LEFT_ACTION"]
  ]) {
    document.buttons[buttonId] = {
      ...structuredClone(document.buttons["tool-child-a"]),
      id: buttonId,
      sourceIdentity: targetIdentity,
      label,
      executionTarget: { kind: "core-action", actionId },
      activationBehavior: structuredClone(targetBehavior),
      toolSetParentId: "target-tool-owner",
      metadata: { toolSetPackageId: "target-tools", toolSetSlot: slot }
    };
  }
  document.surfaces["surface-target-tool-pop"] = {
    id: "surface-target-tool-pop",
    name: "Target Tool Pop",
    kind: "tool-set-popout",
    width: 600,
    height: 240,
    placementIds: ["target-placement-right", "target-placement-left"],
    visualOverflowAllowance: 12,
    uniformButtonSize: null
  };
  document.placements["target-placement-right"] = {
    ...structuredClone(templatePlacement),
    id: "target-placement-right",
    buttonId: "target-tool-right",
    surfaceId: "surface-target-tool-pop",
    x: 20,
    y: 130,
    zIndex: 0,
    skinOverrideId: null
  };
  document.placements["target-placement-left"] = {
    ...structuredClone(templatePlacement),
    id: "target-placement-left",
    buttonId: "target-tool-left",
    surfaceId: "surface-target-tool-pop",
    x: 180,
    y: 130,
    zIndex: 1,
    skinOverrideId: null
  };
  document.popoutUnits["target-tool-pop"] = {
    id: "target-tool-pop",
    name: "Target Tool Pop",
    kind: "tool-set",
    surfaceId: "surface-target-tool-pop",
    canonicalBounds: { x: 0, y: 0, width: 600, height: 240 },
    desktopBounds: { left: 100, top: 200, width: 600, height: 240 },
    desktopBoundsFitMode: "surface",
    desktopBoundsEnvelope: { x: 0, y: 0, width: 600, height: 240 },
    interactionMode: "pop",
    ownerButtonId: "target-tool-owner",
    ownerPlacementId: null,
    childButtonIds: ["target-tool-right", "target-tool-left"],
    childPlacementIds: ["target-placement-right", "target-placement-left"],
    openRule: "toggle",
    closeRule: "escape",
    transparency: 1,
    pinnedDefault: false,
    windowFitMode: "surface",
    fields: [{
      id: "target-field",
      kind: "text",
      label: "Target Field",
      payloadKey: "target_value",
      x: 5,
      y: 65,
      width: 80,
      height: 20,
      zIndex: 3,
      defaultValue: "keep"
    }]
  };

  const settings = buildButtonSettingsFile(document, sourceSurface.id, {
    programName: "Windows",
    panelName: "Files",
    savedAt: "2026-08-04T12:34:56.000Z"
  });
  return { document, settings };
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

test("Button settings save and restore exact membership, text, skin, size, highlights, behavior, and animation", () => {
  const { document, surface } = validArrangementFixture();
  surface.kind = "panel";
  surface.visualOverflowAllowance = 37;
  document.skins["settings-skin"] = {
    ...structuredClone(document.skins[document.settings.defaultSkinId]),
    id: "settings-skin",
    name: "Settings Skin",
    hover: "filter: brightness(1.4);"
  };
  const savedPlacement = document.placements["placement-b"];
  Object.assign(savedPlacement, {
    skinOverrideId: "settings-skin",
    textFitMode: "shrink-and-stack",
    textAlignment: "right",
    textOffsetX: 7,
    textOffsetY: -3,
    minimumFontSize: 9,
    textSizeOverride: 18,
    allowLabelResize: true,
    matchHitboxToSkin: false,
    allowStretching: true,
    highlightOnHover: true
  });
  document.buttons["button-b"].label = "Saved Button Text";
  document.buttons["button-b"].activationBehavior = {
    mode: "momentary",
    states: [{ id: "ready", label: "Ready", labelOverrides: { hover: "Hover Ready" } }]
  };
  document.buttons["button-b"].activationAnimation = {
    presetId: "plus-rise",
    desktopBounds: { left: 100, top: 120, width: 283, height: 295 }
  };
  const settings = buildButtonSettingsFile(document, surface.id, {
    programName: "Blender",
    panelName: "Files",
    savedAt: "2026-07-21T12:34:56.000Z"
  });

  assert.equal(BUTTON_SETTINGS_FILE_EXTENSION, ".flowcell-button-settings.json");
  assert.equal(settings.format, BUTTON_SETTINGS_FILE_FORMAT);
  assert.equal(settings.placementKind, "main-page");
  assert.deepEqual(settings.entries.map((entry) => entry.buttonId), [
    "button-b",
    "button-c",
    "button-a"
  ]);
  assert.equal(settings.entries[0].label, "Saved Button Text");
  assert.equal(settings.entries[0].skin.id, "settings-skin");
  assert.equal(settings.entries[0].placement.highlightOnHover, true);
  assert.equal(settings.entries[0].placement.textSizeOverride, 18);
  assert.deepEqual(settings.entries[0].activationAnimation, {
    presetId: "plus-rise",
    desktopBounds: { left: 100, top: 120, width: 283, height: 295 }
  });
  assert.equal(validateButtonSettingsFile(settings).valid, true);

  const serialized = JSON.stringify(settings);
  assert.equal(serialized.includes("executionTarget"), false);
  assert.equal(serialized.includes("sourceIdentity"), false);
  assert.equal(serialized.includes("current-action"), false);

  const current = structuredClone(document);
  current.buttons["button-b"].label = "Current Text";
  current.buttons["button-b"].activationBehavior = null;
  current.buttons["button-b"].activationAnimation = null;
  current.buttons["button-b"].executionTarget = {
    kind: "core-action",
    actionId: "current-action"
  };
  const removedPlacement = current.placements["placement-b"];
  delete current.placements[removedPlacement.id];
  current.surfaces[surface.id].placementIds =
    current.surfaces[surface.id].placementIds.filter((id) => id !== removedPlacement.id);
  current.buttons["button-d"] = {
    ...structuredClone(current.buttons["button-a"]),
    id: "button-d",
    label: "Extra Button"
  };
  current.placements["placement-d"] = {
    ...structuredClone(current.placements["placement-a"]),
    id: "placement-d",
    buttonId: "button-d",
    surfaceId: surface.id,
    x: 240,
    y: 120,
    zIndex: current.surfaces[surface.id].placementIds.length
  };
  current.surfaces[surface.id].placementIds.push("placement-d");

  const loaded = applyButtonSettingsFile(current, surface.id, settings, {
    programName: "Blender",
    panelName: "Files"
  });
  const loadedButtonIds = loaded.surfaces[surface.id].placementIds.map(
    (placementId) => loaded.placements[placementId].buttonId
  );
  assert.deepEqual(loadedButtonIds, ["button-b", "button-c", "button-a"]);
  assert.equal(loadedButtonIds.includes("button-d"), false);
  assert.equal(loaded.buttons["button-b"].label, "Saved Button Text");
  assert.deepEqual(
    loaded.buttons["button-b"].activationBehavior,
    settings.entries[0].activationBehavior
  );
  assert.deepEqual(
    loaded.buttons["button-b"].activationAnimation,
    settings.entries[0].activationAnimation
  );
  assert.deepEqual(loaded.buttons["button-b"].executionTarget, {
    kind: "core-action",
    actionId: "current-action"
  });
  const loadedPlacement = loaded.placements[loaded.surfaces[surface.id].placementIds[0]];
  assert.equal(loadedPlacement.textAlignment, "right");
  assert.equal(loadedPlacement.textOffsetX, 7);
  assert.equal(loadedPlacement.highlightOnHover, true);
  assert.equal(loaded.skins[loadedPlacement.skinOverrideId].hover, settings.entries[0].skin.hover);
  assert.equal(validateButtonStateDocument(loaded).valid, true);
});

test("Button settings fail atomically when a saved Button action is no longer installed", () => {
  const { document, surface } = validArrangementFixture();
  surface.kind = "panel";
  const settings = buildButtonSettingsFile(document, surface.id, {
    programName: "Blender",
    panelName: "Files",
    savedAt: "2026-07-21T12:34:56.000Z"
  });
  const current = structuredClone(document);
  delete current.buttons["button-b"];
  delete current.placements["placement-b"];
  current.surfaces[surface.id].placementIds =
    current.surfaces[surface.id].placementIds.filter((id) => id !== "placement-b");
  const before = structuredClone(current);

  assert.throws(
    () => applyButtonSettingsFile(current, surface.id, settings, {
      programName: "Blender",
      panelName: "Files"
    }),
    /is not installed/
  );
  assert.deepEqual(current, before);
});

test("Button settings keep concrete Main Page subtypes separate and survive same-surface renames", () => {
  const { document, surface } = validArrangementFixture();
  surface.kind = "panel";
  const settings = buildButtonSettingsFile(document, surface.id, {
    programName: "Old Program",
    panelName: "Old Panel",
    savedAt: "2026-07-21T12:34:56.000Z"
  });

  assert.doesNotThrow(() =>
    applyButtonSettingsFile(document, surface.id, settings, {
      programName: "Renamed Program",
      panelName: "Renamed Panel"
    })
  );

  const wrongSubtype = structuredClone(document);
  wrongSubtype.surfaces[surface.id].kind = "main";
  assert.throws(
    () =>
      applyButtonSettingsFile(wrongSubtype, surface.id, settings, {
        programName: "Old Program",
        panelName: "Old Panel"
      }),
    /different concrete surface type/
  );
});

test("Button settings preserve an exact zero-Button surface", () => {
  const { document, surface } = validArrangementFixture();
  surface.kind = "panel";
  const empty = structuredClone(document);
  for (const placementId of empty.surfaces[surface.id].placementIds) {
    delete empty.placements[placementId];
  }
  empty.surfaces[surface.id].placementIds = [];
  const settings = buildButtonSettingsFile(empty, surface.id, {
    programName: "Blender",
    panelName: "Empty",
    savedAt: "2026-07-21T12:34:56.000Z"
  });

  assert.equal(settings.entries.length, 0);
  const loaded = applyButtonSettingsFile(document, surface.id, settings, {
    programName: "Blender",
    panelName: "Empty"
  });
  assert.deepEqual(loaded.surfaces[surface.id].placementIds, []);
  assert.equal(validateButtonStateDocument(loaded).valid, true);
});

test("Open Pop materializes a regular settings file only in an isolated transient document", () => {
  const { document, settings } = regularPopSettingsFixture();
  settings.entries[0].label = "Transient Saved Label";
  settings.entries[0].placement.x = 321;
  const before = structuredClone(document);

  const opened = buildTransientButtonPopoutSettingsDocument(
    document,
    settings,
    { programName: "Windows", panelName: "Files" },
    "files-choice"
  );

  assert.deepEqual(document, before);
  assert.match(opened.popoutUnitId, /^open-pop-unit-files-choice/);
  const unit = opened.document.popoutUnits[opened.popoutUnitId];
  assert.equal(unit.kind, "regular");
  assert.notEqual(unit.surfaceId, settings.sourceSurfaceId);
  const transientSurface = opened.document.surfaces[unit.surfaceId];
  const transientButtonIds = transientSurface.placementIds.map(
    (placementId) => opened.document.placements[placementId].buttonId
  );
  assert.deepEqual(transientButtonIds, settings.entries.map((entry) => entry.buttonId));
  const firstPlacement = opened.document.placements[transientSurface.placementIds[0]];
  assert.equal(firstPlacement.x, 321);
  assert.equal(opened.document.buttons[firstPlacement.buttonId].label, "Transient Saved Label");
  assert.deepEqual(
    opened.document.buttons[firstPlacement.buttonId].executionTarget,
    document.buttons[firstPlacement.buttonId].executionTarget
  );
  assert.equal(validateButtonStateDocument(opened.document).valid, true);
});

test("Open Pop rejects non-Pop files, wrong panels, and missing installed Buttons atomically", () => {
  const { document, settings } = regularPopSettingsFixture();
  const before = structuredClone(document);

  assert.throws(
    () => buildTransientButtonPopoutSettingsDocument(
      document,
      settings,
      { programName: "Windows", panelName: "Utility" },
      "wrong-panel"
    ),
    /does not belong/
  );

  const missingButton = structuredClone(document);
  delete missingButton.buttons[settings.entries[0].buttonId];
  assert.throws(
    () => buildTransientButtonPopoutSettingsDocument(
      missingButton,
      settings,
      { programName: "Windows", panelName: "Files" },
      "missing-button"
    ),
    /is not installed/
  );

  const mainFile = buildButtonSettingsFile(
    document,
    Object.values(document.surfaces).find((surface) => surface.kind === "main").id,
    {
      programName: "Windows",
      panelName: "Files",
      savedAt: "2026-07-23T12:34:56.000Z"
    }
  );
  assert.throws(
    () => buildTransientButtonPopoutSettingsDocument(
      document,
      mainFile,
      { programName: "Windows", panelName: "Files" },
      "main-file"
    ),
    /only Pop-out settings/
  );
  assert.deepEqual(document, before);
});

test("Open Pop isolates Tool Set presentation while retaining installed fields and execution targets", () => {
  const { document, settings } = toolSetPopSettingsFixture();
  const before = structuredClone(document);
  settings.entries[0].label = "Saved Child";

  const opened = buildTransientButtonPopoutSettingsDocument(
    document,
    settings,
    { programName: "Windows", panelName: "Files" },
    "tool-choice"
  );

  assert.deepEqual(document, before);
  const unit = opened.document.popoutUnits[opened.popoutUnitId];
  assert.equal(unit.kind, "tool-set");
  assert.equal(unit.ownerButtonId, "tool-owner");
  assert.deepEqual(unit.fields, document.popoutUnits["tool-pop"].fields);
  assert.deepEqual(unit.childButtonIds, ["tool-child-a", "tool-child-b"]);
  assert.equal(opened.document.buttons["tool-child-a"].label, "Saved Child");
  assert.deepEqual(
    opened.document.buttons["tool-child-a"].executionTarget,
    document.buttons["tool-child-a"].executionTarget
  );

  const obsolete = structuredClone(settings);
  obsolete.entries.pop();
  assert.throws(
    () => buildTransientButtonPopoutSettingsDocument(
      document,
      obsolete,
      { programName: "Windows", panelName: "Files" },
      "obsolete-tool-choice"
    ),
    /same installed child actions/
  );
});

test("legacy Pop-out state and settings normalize to Pop mode without an owner placement", () => {
  const regular = regularPopSettingsFixture();
  const legacySettings = structuredClone(regular.settings);
  delete legacySettings.behavior.interactionMode;
  delete legacySettings.behavior.ownerButtonId;
  delete legacySettings.behavior.ownerPlacementId;

  const normalizedSettings = normalizeButtonSettingsFile(legacySettings);
  assert.equal(normalizedSettings.behavior.interactionMode, "pop");
  assert.equal(normalizedSettings.behavior.ownerButtonId, null);
  assert.equal(normalizedSettings.behavior.ownerPlacementId, null);
  assert.equal(validateButtonSettingsFile(legacySettings).valid, true);

  const normalizedState = normalizeLoadedButtonStateDocument(regular.document);
  assert.equal(normalizedState.popoutUnits["saved-pop"].interactionMode, "pop");
  assert.equal(normalizedState.popoutUnits["saved-pop"].ownerButtonId, null);
  assert.equal(normalizedState.popoutUnits["saved-pop"].ownerPlacementId, null);
  assert.equal(validateButtonStateDocument(normalizedState).valid, true);

  const toolSet = toolSetPopSettingsFixture();
  const normalizedToolSetState = normalizeLoadedButtonStateDocument(toolSet.document);
  assert.equal(normalizedToolSetState.popoutUnits["tool-pop"].interactionMode, "pop");
  assert.equal(normalizedToolSetState.popoutUnits["tool-pop"].ownerButtonId, "tool-owner");
  assert.equal(normalizedToolSetState.popoutUnits["tool-pop"].ownerPlacementId, null);
  assert.equal(validateButtonStateDocument(normalizedToolSetState).valid, true);
});

test("Tool Set Fan settings map by package slot while preserving target behavior and ownership", () => {
  const { document, settings } = crossToolSetFanSettingsFixture();
  const before = structuredClone(document);
  assert.equal(settings.behavior.interactionMode, "fan");
  assert.equal(settings.behavior.ownerButtonId, "tool-owner");
  assert.equal(settings.behavior.ownerPlacementId, "tool-owner-fan-placement");
  assert.equal(validateButtonSettingsFile(settings).valid, true);
  assert.equal(validateButtonStateDocument(document).valid, true);

  const loaded = applyButtonSettingsFile(
    document,
    "surface-target-tool-pop",
    settings,
    { programName: "Blender", panelName: "Rotate" }
  );
  assert.deepEqual(document, before);

  const unit = loaded.popoutUnits["target-tool-pop"];
  assert.equal(unit.interactionMode, "fan");
  assert.equal(unit.ownerButtonId, "target-tool-owner");
  assert.equal(loaded.placements[unit.ownerPlacementId].buttonId, "target-tool-owner");
  assert.deepEqual(unit.childButtonIds, ["target-tool-left", "target-tool-right"]);
  assert.deepEqual(unit.fields, before.popoutUnits["target-tool-pop"].fields);
  assert.deepEqual(
    loaded.buttons["target-tool-left"].executionTarget,
    { kind: "core-action", actionId: "TARGET_LEFT_ACTION" }
  );
  assert.equal(loaded.buttons["target-tool-left"].label, "Target Left");
  assert.deepEqual(
    loaded.buttons["target-tool-left"].activationBehavior,
    before.buttons["target-tool-left"].activationBehavior
  );
  assert.equal(loaded.buttons["target-tool-left"].toolSetParentId, "target-tool-owner");

  const leftPlacement = Object.values(loaded.placements).find(
    (placement) => placement.surfaceId === unit.surfaceId && placement.buttonId === "target-tool-left"
  );
  const rightPlacement = Object.values(loaded.placements).find(
    (placement) => placement.surfaceId === unit.surfaceId && placement.buttonId === "target-tool-right"
  );
  const ownerPlacement = loaded.placements[unit.ownerPlacementId];
  assert.equal(leftPlacement.x, 30);
  assert.equal(rightPlacement.x, 160);
  assert.equal(ownerPlacement.x, 250);
  assert.equal(loaded.skins[leftPlacement.skinOverrideId].name, "Source Layout Skin");
  assert.equal(unit.desktopBoundsFitMode, "hitbox");
  assert.deepEqual(unit.desktopBoundsEnvelope, { x: 5, y: 10, width: 335, height: 80 });
  assert.equal(validateButtonStateDocument(loaded).valid, true);

  const wrongCount = structuredClone(settings);
  wrongCount.entries = wrongCount.entries.filter((entry) => entry.buttonId !== "tool-child-b");
  wrongCount.entries.forEach((entry, index) => {
    entry.placement.zIndex = index;
  });
  assert.throws(
    () => applyButtonSettingsFile(
      document,
      "surface-target-tool-pop",
      wrongCount,
      { programName: "Blender", panelName: "Rotate" }
    ),
    /same number of package-owned child Buttons/
  );
  assert.deepEqual(document, before);
});

test("Button settings categories collapse physical surfaces to Main Page, Fan, and Pop-out", () => {
  assert.equal(buttonSettingsPlacementKind({ kind: "main" }), "main-page");
  assert.equal(buttonSettingsPlacementKind({ kind: "panel" }), "main-page");
  assert.equal(buttonSettingsPlacementKind({ kind: "fan" }), "fan");
  assert.equal(buttonSettingsPlacementKind({ kind: "regular-popout" }), "pop-out");
  assert.equal(buttonSettingsPlacementKind({ kind: "tool-set-popout" }), "pop-out");
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

test("a Fan owner anchors anywhere while its Buttons keep the bounds and overlap rules", () => {
  const document = createButtonStateDocument();
  reconcileProgramPanelOwners(document, {
    programName: "Windows",
    panels: [{ panelName: "Utility", rect: { x: 8, y: 8, width: 132, height: 37 } }],
    surfaceBounds: { width: 1225, height: 721 }
  });
  const scripts = ["alpha", "beta"].map((name) => {
    const script = {
      id: `fan-${name}`,
      role: "single-script",
      sourceIdentity: createButtonSourceIdentity("Windows", "Utility", `${name}.flowcell-source.json`),
      label: name,
      tooltip: name,
      executionTarget: {
        kind: "panel-script",
        programName: "Windows",
        panelName: "Utility",
        fileName: `${name}.flowcell-source.json`
      },
      defaultSkinId: document.settings.defaultSkinId,
      defaultTextFitMode: "shrink",
      disabled: false,
      activationAnimation: null,
      activationBehavior: null,
      toolSetParentId: null,
      toolSetBehavior: null,
      metadata: {}
    };
    document.buttons[script.id] = script;
    return script;
  });
  const setup = ensureFanSetup({
    document,
    programName: "Windows",
    panelName: "Utility",
    buttons: scripts
  });
  const context = { programName: "Windows", panelName: "Utility" };
  const ownerPlacement = resolvePanelOwnerFanPlacement(document, setup.id);
  const memberPlacementId = document.surfaces[setup.fanSurfaceId].placementIds.find(
    (placementId) => placementId !== ownerPlacement.id
  );

  // The owner is an anchor: negative, far outside, and overlapping all pass.
  for (const anchor of [{ x: -320, y: -240 }, { x: 4000, y: 3000 }, { x: 0, y: 0 }]) {
    ownerPlacement.x = anchor.x;
    ownerPlacement.y = anchor.y;
    const validation = validateButtonStateDocument(document);
    assert.equal(
      validation.valid,
      true,
      `owner at ${anchor.x},${anchor.y}: ${validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`
    );
    const file = buildButtonSettingsFile(document, setup.fanSurfaceId, context);
    const fileValidation = validateButtonSettingsFile(file);
    assert.equal(
      fileValidation.valid,
      true,
      `owner file at ${anchor.x},${anchor.y}: ${fileValidation.issues.join("\n")}`
    );
  }

  // Every other Button on the Fan keeps the exact bounds and overlap rules.
  ownerPlacement.x = 8;
  ownerPlacement.y = 8;
  const member = document.placements[memberPlacementId];
  const restore = { x: member.x, y: member.y };
  member.x = -40;
  assert.equal(validateButtonStateDocument(document).valid, false);
  member.x = restore.x;
  member.y = restore.y;

  const sibling = document.surfaces[setup.fanSurfaceId].placementIds
    .map((placementId) => document.placements[placementId])
    .find((placement) => placement.id !== ownerPlacement.id && placement.id !== memberPlacementId);
  if (sibling) {
    member.x = sibling.x;
    member.y = sibling.y;
    const overlapping = validateButtonStateDocument(document);
    assert.equal(overlapping.valid, false);
    assert.equal(overlapping.issues.some((issue) => issue.message.includes("overlap")), true);
  }
});
