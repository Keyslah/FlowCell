import assert from "node:assert/strict";
import test from "node:test";

import {
  createButtonStateDocument,
  DEFAULT_BUTTON_SURFACE_ID
} from "./.compiled-button-system/button/state/buttonDefaults.js";
import {
  applyButtonAnimationSavedScope,
  applyButtonBehaviorSavedScope,
  applyButtonPlacementSavedScope,
  applyButtonSettingsSavedScope,
  applyButtonSkinSavedScope,
  applyButtonTextSavedScope,
  buildButtonAnimationScopedDocument,
  buildButtonBehaviorScopedDocument,
  buildButtonPlacementScopedDocument,
  buildButtonSettingsScopedDocument,
  buildButtonSkinScopedDocument,
  buildButtonTextScopedDocument,
  skinHasReferencesOutsidePlacements
} from "./.compiled-button-system/button/editor/buttonEditorSaveScopes.js";

function documentWithButton() {
  const document = createButtonStateDocument();
  const defaultSkinId = document.settings.defaultSkinId;
  document.buttons.one = {
    id: "one",
    role: "single-script",
    sourceIdentity: null,
    label: "One",
    tooltip: "",
    executionTarget: null,
    defaultSkinId,
    defaultTextFitMode: "shrink",
    disabled: false,
    activationAnimation: null,
    activationBehavior: null,
    toolSetParentId: null,
    toolSetBehavior: null,
    metadata: {}
  };
  document.placements["placement-one"] = {
    id: "placement-one",
    buttonId: "one",
    surfaceId: DEFAULT_BUTTON_SURFACE_ID,
    x: 10,
    y: 20,
    width: 80,
    height: 32,
    zIndex: 0,
    skinOverrideId: null,
    textFitMode: "shrink",
    textAlignment: "skin",
    minimumFontSize: 8,
    textSizeOverride: null,
    textOffsetX: 0,
    textOffsetY: 0,
    allowLabelResize: true,
    matchHitboxToSkin: true,
    allowStretching: false,
    highlightOnHover: false,
    resizeAnchor: "top-left",
    activationCycle: null,
    visualStateMap: null
  };
  document.surfaces[DEFAULT_BUTTON_SURFACE_ID].placementIds = ["placement-one"];
  return document;
}

test("placement save commits arrangement without consuming pending skin or animation edits", () => {
  const committed = documentWithButton();
  const draft = structuredClone(committed);
  const activationCycle = {
    states: [
      {
        id: "state-resting", label: "Resting", advanceTrigger: "press", visualState: "base",
        resultMatches: [{ mode: "NONE" }]
      },
      {
        id: "state-armed", label: "Armed", advanceTrigger: "release", visualState: "held",
        resultMatches: [{ mode: "MIN" }]
      }
    ]
  };
  const draftSkin = {
    ...structuredClone(draft.skins[draft.settings.defaultSkinId]),
    id: "skin-pending",
    name: "Pending skin"
  };
  draft.skins[draftSkin.id] = draftSkin;
  Object.assign(draft.placements["placement-one"], {
    x: 120,
    y: 84,
    width: 96,
    height: 40,
    textFitMode: "shrink-and-stack",
    textAlignment: "center",
    minimumFontSize: 11,
    textSizeOverride: 18,
    textOffsetX: -4,
    textOffsetY: 7,
    allowLabelResize: false,
    matchHitboxToSkin: false,
    allowStretching: false,
    highlightOnHover: true,
    skinOverrideId: draftSkin.id,
    activationCycle
  });
  draft.buttons.one.activationAnimation = {
    presetId: "flowcell-plus",
    desktopBounds: null
  };

  const saved = buildButtonPlacementScopedDocument(
    committed,
    draft,
    DEFAULT_BUTTON_SURFACE_ID
  );
  assert.deepEqual(
    {
      x: saved.placements["placement-one"].x,
      y: saved.placements["placement-one"].y,
      width: saved.placements["placement-one"].width,
      height: saved.placements["placement-one"].height,
      textFitMode: saved.placements["placement-one"].textFitMode,
      textAlignment: saved.placements["placement-one"].textAlignment,
      minimumFontSize: saved.placements["placement-one"].minimumFontSize,
      textSizeOverride: saved.placements["placement-one"].textSizeOverride,
      textOffsetX: saved.placements["placement-one"].textOffsetX,
      textOffsetY: saved.placements["placement-one"].textOffsetY,
      allowLabelResize: saved.placements["placement-one"].allowLabelResize,
      matchHitboxToSkin: saved.placements["placement-one"].matchHitboxToSkin,
      allowStretching: saved.placements["placement-one"].allowStretching,
      highlightOnHover: saved.placements["placement-one"].highlightOnHover
    },
    {
      x: 120,
      y: 84,
      width: 96,
      height: 40,
      textFitMode: "shrink-and-stack",
      textAlignment: "center",
      minimumFontSize: 11,
      textSizeOverride: 18,
      textOffsetX: -4,
      textOffsetY: 7,
      allowLabelResize: false,
      matchHitboxToSkin: false,
      allowStretching: false,
      highlightOnHover: true
    }
  );
  assert.equal(saved.placements["placement-one"].skinOverrideId, null);
  assert.deepEqual(saved.placements["placement-one"].activationCycle, activationCycle);
  assert.equal(saved.buttons.one.activationAnimation, null);
  assert.equal(saved.skins[draftSkin.id], undefined);

  Object.assign(draft.placements["placement-one"], {
    textFitMode: "shrink",
    textAlignment: "skin",
    minimumFontSize: 7,
    textSizeOverride: null,
    textOffsetX: 0,
    textOffsetY: 0,
    allowLabelResize: true,
    matchHitboxToSkin: true,
    allowStretching: true,
    highlightOnHover: false,
    activationCycle: {
      states: [
        { id: "pending-one", label: "Pending one", advanceTrigger: "hover", visualState: "error" },
        { id: "pending-two", label: "Pending two", advanceTrigger: "press", visualState: "disabled" }
      ]
    }
  });
  applyButtonPlacementSavedScope(draft, saved, DEFAULT_BUTTON_SURFACE_ID);
  assert.equal(draft.placements["placement-one"].skinOverrideId, draftSkin.id);
  assert.equal(draft.buttons.one.activationAnimation.presetId, "flowcell-plus");
  assert.equal(draft.placements["placement-one"].textFitMode, "shrink-and-stack");
  assert.equal(draft.placements["placement-one"].textAlignment, "center");
  assert.equal(draft.placements["placement-one"].minimumFontSize, 11);
  assert.equal(draft.placements["placement-one"].textSizeOverride, 18);
  assert.equal(draft.placements["placement-one"].textOffsetX, -4);
  assert.equal(draft.placements["placement-one"].textOffsetY, 7);
  assert.equal(draft.placements["placement-one"].allowLabelResize, false);
  assert.equal(draft.placements["placement-one"].matchHitboxToSkin, false);
  assert.equal(draft.placements["placement-one"].allowStretching, false);
  assert.equal(draft.placements["placement-one"].highlightOnHover, true);
  assert.deepEqual(draft.placements["placement-one"].activationCycle, activationCycle);
});

test("Settings save commits complete presentation and exact surface membership without actions", () => {
  const committed = documentWithButton();
  const draft = structuredClone(committed);
  const pendingSkin = {
    ...structuredClone(draft.skins[draft.settings.defaultSkinId]),
    id: "settings-skin",
    name: "Settings skin",
    hover: "filter: brightness(1.25);"
  };
  draft.skins[pendingSkin.id] = pendingSkin;
  draft.buttons.one.label = "Saved text";
  draft.buttons.one.activationBehavior = {
    mode: "momentary",
    states: [{ id: "ready", label: "Ready", labelOverrides: {} }]
  };
  draft.buttons.one.activationAnimation = {
    presetId: "plus-rise",
    desktopBounds: { left: 10, top: 20, width: 283, height: 295 }
  };
  Object.assign(draft.placements["placement-one"], {
    skinOverrideId: pendingSkin.id,
    textAlignment: "right",
    textOffsetX: 5,
    highlightOnHover: true
  });

  const saved = buildButtonSettingsScopedDocument(
    committed,
    draft,
    DEFAULT_BUTTON_SURFACE_ID,
    { programName: "Blender", panelName: "Files" }
  );
  assert.equal(saved.buttons.one.label, "Saved text");
  assert.deepEqual(saved.buttons.one.activationBehavior, draft.buttons.one.activationBehavior);
  assert.deepEqual(saved.buttons.one.activationAnimation, draft.buttons.one.activationAnimation);
  assert.equal(saved.placements["placement-one"].textAlignment, "right");
  assert.equal(saved.placements["placement-one"].textOffsetX, 5);
  assert.equal(saved.placements["placement-one"].highlightOnHover, true);
  assert.equal(saved.placements["placement-one"].skinOverrideId, pendingSkin.id);
  assert.deepEqual(saved.skins[pendingSkin.id], pendingSkin);
  assert.deepEqual(saved.buttons.one.executionTarget, committed.buttons.one.executionTarget);

  const pending = structuredClone(draft);
  pending.buttons.one.label = "Later unsaved text";
  applyButtonSettingsSavedScope(
    pending,
    saved,
    DEFAULT_BUTTON_SURFACE_ID,
    { programName: "Blender", panelName: "Files" }
  );
  assert.equal(pending.buttons.one.label, "Saved text");
  assert.equal(pending.placements["placement-one"].skinOverrideId, pendingSkin.id);
});

test("Settings conflict rebase preserves a concurrent deletion while adding an editor-new Button", () => {
  const baseline = documentWithButton();
  const draft = structuredClone(baseline);
  const latest = structuredClone(baseline);
  delete latest.buttons.one;
  delete latest.placements["placement-one"];
  latest.surfaces[DEFAULT_BUTTON_SURFACE_ID].placementIds = [];
  latest.revision = 4;

  draft.buttons.two = { ...structuredClone(draft.buttons.one), id: "two", label: "Two" };
  draft.placements["placement-two"] = {
    ...structuredClone(draft.placements["placement-one"]),
    id: "placement-two",
    buttonId: "two",
    x: 120
  };
  draft.surfaces[DEFAULT_BUTTON_SURFACE_ID].placementIds.push("placement-two");

  const rebased = buildButtonSettingsScopedDocument(
    latest,
    draft,
    DEFAULT_BUTTON_SURFACE_ID,
    { programName: "Blender", panelName: "Files" },
    baseline
  );
  assert.equal(rebased.buttons.one, undefined);
  assert.equal(rebased.placements["placement-one"], undefined);
  assert.ok(rebased.buttons.two);
  assert.ok(rebased.placements["placement-two"]);
  assert.deepEqual(rebased.surfaces[DEFAULT_BUTTON_SURFACE_ID].placementIds, [
    "placement-two"
  ]);
});

test("placement conflict rebase preserves concurrent deletions and adds only editor-new Buttons", () => {
  const baseline = documentWithButton();
  const draft = structuredClone(baseline);
  const latest = structuredClone(baseline);
  delete latest.buttons.one;
  delete latest.placements["placement-one"];
  latest.surfaces[DEFAULT_BUTTON_SURFACE_ID].placementIds = [];
  latest.revision = 4;

  draft.buttons.two = { ...structuredClone(draft.buttons.one), id: "two", label: "Two" };
  draft.placements["placement-two"] = {
    ...structuredClone(draft.placements["placement-one"]),
    id: "placement-two",
    buttonId: "two",
    x: 120
  };
  draft.surfaces[DEFAULT_BUTTON_SURFACE_ID].placementIds.push("placement-two");

  const rebased = buildButtonPlacementScopedDocument(
    latest,
    draft,
    DEFAULT_BUTTON_SURFACE_ID,
    baseline
  );
  assert.equal(rebased.buttons.one, undefined);
  assert.equal(rebased.placements["placement-one"], undefined);
  assert.ok(rebased.buttons.two);
  assert.ok(rebased.placements["placement-two"]);
  assert.deepEqual(
    rebased.surfaces[DEFAULT_BUTTON_SURFACE_ID].placementIds,
    ["placement-two"]
  );
  assert.equal(rebased.revision, 4);
});

test("skin save commits only the skin and explicit assignment", () => {
  const committed = documentWithButton();
  committed.skins["skin-custom"] = {
    ...structuredClone(committed.skins[committed.settings.defaultSkinId]),
    id: "skin-custom",
    name: "Custom"
  };
  const draft = structuredClone(committed);
  draft.skins["skin-custom"].base = "color: hotpink;";
  draft.placements["placement-one"].skinOverrideId = "skin-custom";
  draft.placements["placement-one"].x = 333;
  draft.placements["placement-one"].width = 145;
  draft.placements["placement-one"].textFitMode = "stack-whole-words";
  draft.placements["placement-one"].textAlignment = "right";
  draft.placements["placement-one"].textSizeOverride = 21;
  draft.placements["placement-one"].matchHitboxToSkin = false;
  draft.buttons.one.label = "Renamed";
  const scope = {
    skinIds: ["skin-custom"],
    placementIds: ["placement-one"]
  };

  const saved = buildButtonSkinScopedDocument(committed, draft, scope);
  assert.equal(saved.skins["skin-custom"].base, "color: hotpink;");
  assert.equal(saved.placements["placement-one"].skinOverrideId, "skin-custom");
  assert.equal(saved.placements["placement-one"].x, 10);
  assert.equal(saved.placements["placement-one"].width, 80);
  assert.equal(saved.placements["placement-one"].textFitMode, "shrink");
  assert.equal(saved.placements["placement-one"].textAlignment, "skin");
  assert.equal(saved.placements["placement-one"].textSizeOverride, null);
  assert.equal(saved.placements["placement-one"].matchHitboxToSkin, true);
  assert.equal(saved.buttons.one.label, "One");

  applyButtonSkinSavedScope(draft, saved, scope);
  assert.equal(draft.placements["placement-one"].x, 333);
  assert.equal(draft.placements["placement-one"].width, 145);
  assert.equal(draft.placements["placement-one"].textFitMode, "stack-whole-words");
  assert.equal(draft.placements["placement-one"].textAlignment, "right");
  assert.equal(draft.placements["placement-one"].textSizeOverride, 21);
  assert.equal(draft.placements["placement-one"].matchHitboxToSkin, false);
  assert.equal(draft.buttons.one.label, "Renamed");
});

test("Button behavior save commits state structure and visual mapping without pending Button Text", () => {
  const committed = documentWithButton();
  const draft = structuredClone(committed);
  draft.buttons.one.label = "Off";
  draft.buttons.one.activationBehavior = {
    mode: "toggle",
    states: [
      { id: "off", label: "Off", labelOverrides: { hover: "Turn on" } },
      { id: "on", label: "On", labelOverrides: { hover: "Turn off" } }
    ]
  };
  draft.placements["placement-one"].visualStateMap = {
    off: { hover: "held" },
    on: { rest: "pressed" }
  };
  draft.placements["placement-one"].x = 333;
  draft.placements["placement-one"].textFitMode = "stack-whole-words";
  draft.placements["placement-one"].textAlignment = "right";
  draft.placements["placement-one"].minimumFontSize = 11;
  draft.placements["placement-one"].textSizeOverride = 18;
  draft.placements["placement-one"].textOffsetX = -6;
  draft.placements["placement-one"].textOffsetY = 9;
  draft.placements["placement-one"].allowLabelResize = false;

  const scope = { buttonId: "one", placementIds: ["placement-one"] };
  const saved = buildButtonBehaviorScopedDocument(committed, draft, scope);
  assert.equal(saved.buttons.one.label, "One");
  assert.equal(saved.buttons.one.activationBehavior.mode, "toggle");
  assert.deepEqual(saved.buttons.one.activationBehavior.states, [
    { id: "off", label: "One", labelOverrides: {} },
    { id: "on", label: "One", labelOverrides: {} }
  ]);
  assert.deepEqual(
    saved.placements["placement-one"].visualStateMap,
    draft.placements["placement-one"].visualStateMap
  );
  assert.equal(saved.placements["placement-one"].x, 10);
  assert.equal(saved.placements["placement-one"].textFitMode, "shrink");
  assert.equal(saved.placements["placement-one"].textAlignment, "skin");
  assert.equal(saved.placements["placement-one"].textOffsetX, 0);
  assert.equal(saved.placements["placement-one"].textOffsetY, 0);

  draft.buttons.one.label = "Pending label";
  draft.buttons.one.activationBehavior.mode = "cycle";
  draft.buttons.one.activationBehavior.states[0].label = "Pending off";
  draft.buttons.one.activationBehavior.states[0].labelOverrides = { hover: "Pending hover" };
  draft.placements["placement-one"].visualStateMap = null;
  applyButtonBehaviorSavedScope(draft, saved, scope);
  assert.equal(draft.buttons.one.label, "Pending label");
  assert.equal(draft.buttons.one.activationBehavior.mode, "toggle");
  assert.equal(draft.buttons.one.activationBehavior.states[0].label, "Pending off");
  assert.deepEqual(
    draft.buttons.one.activationBehavior.states[0].labelOverrides,
    { hover: "Pending hover" }
  );
  assert.deepEqual(
    draft.placements["placement-one"].visualStateMap,
    saved.placements["placement-one"].visualStateMap
  );
  assert.equal(draft.placements["placement-one"].x, 333);
  assert.equal(draft.placements["placement-one"].textFitMode, "stack-whole-words");
  assert.equal(draft.placements["placement-one"].textOffsetX, -6);
  assert.equal(draft.placements["placement-one"].textOffsetY, 9);
});

test("Button Text Apply All saves placement-cycle labels without changing the shared Button label", () => {
  const committed = documentWithButton();
  committed.placements["placement-one"].activationCycle = {
    states: [
      {
        id: "state-1",
        label: "Resting",
        advanceTrigger: "press",
        visualState: "base",
        resultMatches: [{ axis: "X", mode: "NONE" }]
      },
      {
        id: "state-2",
        label: "Armed",
        advanceTrigger: "release",
        visualState: "pressed",
        resultMatches: [{ axis: "X", mode: "MIN" }]
      }
    ]
  };
  const draft = structuredClone(committed);
  draft.buttons.one.label = "Ready";
  draft.placements["placement-one"].activationCycle.states = [
    {
      id: "state-2",
      label: "Engaged",
      advanceTrigger: "hover",
      visualState: "held",
      resultMatches: [{ axis: "X", mode: "MAX" }]
    },
    {
      id: "state-1",
      label: "Ready",
      advanceTrigger: "release",
      visualState: "hover",
      resultMatches: [{ axis: "X", mode: "MIN" }]
    },
    {
      id: "pending-new-state",
      label: "New state",
      advanceTrigger: "press",
      visualState: "play",
      resultMatches: [{ axis: "X", mode: "PENDING" }]
    }
  ];
  Object.assign(draft.placements["placement-one"], {
    x: 333,
    textFitMode: "shrink-and-stack",
    textAlignment: "right",
    minimumFontSize: 11,
    textSizeOverride: 18,
    textOffsetX: -6,
    textOffsetY: 9,
    allowLabelResize: false,
    visualStateMap: { off: { hover: "held" } }
  });
  const scope = { entries: [{ buttonId: "one", placementId: "placement-one" }] };

  const saved = buildButtonTextScopedDocument(committed, draft, scope);
  assert.equal(saved.buttons.one.label, "One");
  assert.deepEqual(saved.placements["placement-one"].activationCycle, {
    states: [
      {
        id: "state-1",
        label: "Ready",
        advanceTrigger: "press",
        visualState: "base",
        resultMatches: [{ axis: "X", mode: "NONE" }]
      },
      {
        id: "state-2",
        label: "Engaged",
        advanceTrigger: "release",
        visualState: "pressed",
        resultMatches: [{ axis: "X", mode: "MIN" }]
      }
    ]
  });
  assert.equal(saved.placements["placement-one"].x, 10);
  assert.equal(saved.placements["placement-one"].textFitMode, "shrink-and-stack");
  assert.equal(saved.placements["placement-one"].textAlignment, "right");
  assert.equal(saved.placements["placement-one"].minimumFontSize, 11);
  assert.equal(saved.placements["placement-one"].textSizeOverride, 18);
  assert.equal(saved.placements["placement-one"].textOffsetX, -6);
  assert.equal(saved.placements["placement-one"].textOffsetY, 9);
  assert.equal(saved.placements["placement-one"].allowLabelResize, true);
  assert.equal(saved.placements["placement-one"].visualStateMap, null);

  draft.buttons.one.label = "Pending";
  draft.placements["placement-one"].activationCycle.states[0].label = "Pending armed";
  draft.placements["placement-one"].activationCycle.states[0].advanceTrigger = "press";
  draft.placements["placement-one"].activationCycle.states[0].visualState = "disabled";
  draft.placements["placement-one"].activationCycle.states[0].resultMatches = [{ mode: "PENDING-2" }];
  draft.placements["placement-one"].activationCycle.states[1].label = "Pending resting";
  draft.placements["placement-one"].activationCycle.states[1].advanceTrigger = "hover";
  draft.placements["placement-one"].activationCycle.states[1].visualState = "error";
  draft.placements["placement-one"].activationCycle.states[1].resultMatches = [{ mode: "PENDING-1" }];
  draft.placements["placement-one"].textOffsetX = 25;
  const pendingCycleStructure = draft.placements["placement-one"].activationCycle.states.map(
    ({ id, advanceTrigger, visualState, resultMatches }) => ({
      id,
      advanceTrigger,
      visualState,
      resultMatches
    })
  );
  applyButtonTextSavedScope(draft, saved, scope);
  assert.equal(draft.buttons.one.label, "Pending");
  assert.deepEqual(
    draft.placements["placement-one"].activationCycle.states.map(
      ({ id, advanceTrigger, visualState, resultMatches }) => ({
        id,
        advanceTrigger,
        visualState,
        resultMatches
      })
    ),
    pendingCycleStructure
  );
  assert.deepEqual(
    draft.placements["placement-one"].activationCycle.states.map(({ id, label }) => ({ id, label })),
    [
      { id: "state-2", label: "Engaged" },
      { id: "state-1", label: "Ready" },
      { id: "pending-new-state", label: "New state" }
    ]
  );
  assert.equal(draft.placements["placement-one"].x, 333);
  assert.equal(draft.placements["placement-one"].textOffsetX, -6);
  assert.equal(draft.placements["placement-one"].allowLabelResize, false);
  assert.deepEqual(draft.placements["placement-one"].visualStateMap, { off: { hover: "held" } });
});

test("Button Text Apply All commits text drafts across multiple Buttons and placements", () => {
  const committed = documentWithButton();
  committed.buttons.two = {
    ...structuredClone(committed.buttons.one),
    id: "two",
    label: "Two"
  };
  committed.placements["placement-two"] = {
    ...structuredClone(committed.placements["placement-one"]),
    id: "placement-two",
    buttonId: "two",
    x: 80
  };
  const draft = structuredClone(committed);
  draft.buttons.one.label = "First";
  draft.buttons.two.label = "Second";
  draft.placements["placement-one"].textSizeOverride = 18;
  draft.placements["placement-two"].textSizeOverride = 24;
  draft.placements["placement-two"].textAlignment = "right";
  draft.placements["placement-two"].x = 999;
  const scope = {
    entries: [
      { buttonId: "one", placementId: "placement-one" },
      { buttonId: "two", placementId: "placement-two" }
    ]
  };

  const saved = buildButtonTextScopedDocument(committed, draft, scope);
  assert.equal(saved.buttons.one.label, "First");
  assert.equal(saved.buttons.two.label, "Second");
  assert.equal(saved.placements["placement-one"].textSizeOverride, 18);
  assert.equal(saved.placements["placement-two"].textSizeOverride, 24);
  assert.equal(saved.placements["placement-two"].textAlignment, "right");
  assert.equal(saved.placements["placement-two"].x, 80);

  applyButtonTextSavedScope(draft, saved, scope);
  assert.equal(draft.buttons.one.label, "First");
  assert.equal(draft.buttons.two.label, "Second");
  assert.equal(draft.placements["placement-one"].textSizeOverride, 18);
  assert.equal(draft.placements["placement-two"].textSizeOverride, 24);
  assert.equal(draft.placements["placement-two"].x, 999);
});

test("Button Text Apply All keeps legacy runtime labels aligned without consuming pending behavior structure", () => {
  const committed = documentWithButton();
  committed.buttons.one.activationBehavior = {
    mode: "toggle",
    states: [
      { id: "off", label: "Off", labelOverrides: { hover: "Off hover" } },
      { id: "on", label: "On", labelOverrides: { held: "On held" } }
    ]
  };
  committed.placements["placement-one"].visualStateMap = {
    off: { rest: "base", hover: "hover" },
    on: { rest: "held", release: "release" }
  };
  const draft = structuredClone(committed);
  draft.buttons.one.label = "Live";
  draft.buttons.one.activationBehavior = {
    mode: "cycle",
    states: [
      { id: "on", label: "Pending on", labelOverrides: { error: "Pending error" } },
      { id: "off", label: "Pending off", labelOverrides: { disabled: "Pending disabled" } },
      { id: "pending", label: "Pending new", labelOverrides: { hover: "Pending hover" } }
    ]
  };
  draft.placements["placement-one"].visualStateMap = {
    pending: { rest: "error" }
  };
  draft.placements["placement-one"].textOffsetX = 14;
  const scope = { entries: [{ buttonId: "one", placementId: "placement-one" }] };

  const saved = buildButtonTextScopedDocument(committed, draft, scope);
  assert.equal(saved.buttons.one.label, "Live");
  assert.equal(saved.buttons.one.activationBehavior.mode, "toggle");
  assert.deepEqual(
    saved.buttons.one.activationBehavior.states,
    [
      { id: "off", label: "Live", labelOverrides: { hover: "Off hover" } },
      { id: "on", label: "Live", labelOverrides: { held: "On held" } }
    ]
  );
  assert.deepEqual(
    saved.placements["placement-one"].visualStateMap,
    committed.placements["placement-one"].visualStateMap
  );

  applyButtonTextSavedScope(draft, saved, scope);
  assert.equal(draft.buttons.one.label, "Live");
  assert.equal(draft.buttons.one.activationBehavior.mode, "cycle");
  assert.deepEqual(
    draft.buttons.one.activationBehavior.states.map(({ id, label, labelOverrides }) => ({
      id,
      label,
      labelOverrides
    })),
    [
      { id: "on", label: "Live", labelOverrides: { error: "Pending error" } },
      { id: "off", label: "Live", labelOverrides: { disabled: "Pending disabled" } },
      { id: "pending", label: "Live", labelOverrides: { hover: "Pending hover" } }
    ]
  );
  assert.deepEqual(draft.placements["placement-one"].visualStateMap, {
    pending: { rest: "error" }
  });
  assert.equal(draft.placements["placement-one"].textOffsetX, 14);
});

test("animation save retains unrelated draft placement geometry", () => {
  const committed = documentWithButton();
  const draft = structuredClone(committed);
  draft.placements["placement-one"].y = 222;
  draft.buttons.one.activationAnimation = {
    presetId: "flowcell-plus",
    desktopBounds: { left: 1, top: 2, width: 283, height: 295 }
  };

  const saved = buildButtonAnimationScopedDocument(committed, draft, "one");
  assert.equal(saved.placements["placement-one"].y, 20);
  assert.equal(saved.buttons.one.activationAnimation.presetId, "flowcell-plus");
  applyButtonAnimationSavedScope(draft, saved, "one");
  assert.equal(draft.placements["placement-one"].y, 222);
});

test("the document default skin is always treated as shared during assignment", () => {
  const document = documentWithButton();
  const defaultSkinId = document.settings.defaultSkinId;
  document.buttons.one.defaultSkinId = "skin-unrelated";
  document.skins["skin-unrelated"] = {
    ...structuredClone(document.skins[defaultSkinId]),
    id: "skin-unrelated",
    name: "Unrelated"
  };
  document.placements["placement-one"].skinOverrideId = defaultSkinId;

  assert.equal(
    skinHasReferencesOutsidePlacements(
      document,
      defaultSkinId,
      new Set(["placement-one"])
    ),
    true
  );
});
