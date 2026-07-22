import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceButtonActivationStateIndex,
  clampButtonActivationStateIndex,
  createDefaultButtonActivationBehavior,
  getButtonActivationStateCount,
  resolveButtonAppearance
} from "./.compiled-button-system/button/runtime/buttonActivationState.js";
import {
  createButtonStateDocument
} from "./.compiled-button-system/button/state/buttonDefaults.js";
import {
  normalizeLoadedButtonStateDocument,
  validateButtonStateDocument
} from "./.compiled-button-system/button/state/buttonStateValidation.js";

const RESTING_APPEARANCE = {
  hovered: false,
  pressed: false,
  held: false,
  play: false,
  release: false,
  selected: false,
  disabled: false,
  error: false
};

function makeCycleBehavior() {
  return {
    mode: "cycle",
    states: [
      {
        id: "off",
        label: "Off",
        labelOverrides: { hover: "Turn on", held: "Holding off" }
      },
      {
        id: "on",
        label: "On",
        labelOverrides: { hover: "Turn off", error: "On failed" }
      },
      {
        id: "auto",
        label: "Auto",
        labelOverrides: {}
      }
    ]
  };
}

function makeStateDocument() {
  const document = createButtonStateDocument();
  const surface = Object.values(document.surfaces)[0];
  document.buttons.button = {
    id: "button",
    role: "single-script",
    sourceIdentity: null,
    label: "Fallback",
    tooltip: "",
    executionTarget: null,
    defaultSkinId: document.settings.defaultSkinId,
    defaultTextFitMode: "shrink",
    disabled: false,
    activationAnimation: null,
    activationBehavior: makeCycleBehavior(),
    toolSetParentId: null,
    toolSetBehavior: null,
    metadata: {}
  };
  document.placements.placement = {
    id: "placement",
    buttonId: "button",
    surfaceId: surface.id,
    x: 8,
    y: 8,
    width: 160,
    height: 44,
    zIndex: 0,
    skinOverrideId: null,
    textFitMode: "shrink",
    textAlignment: "skin",
    minimumFontSize: 8,
    textSizeOverride: null,
    allowLabelResize: false,
    matchHitboxToSkin: true,
    allowStretching: false,
    resizeAnchor: "top-left",
    visualStateMap: {
      off: { hover: "held" },
      on: { error: "hover" }
    }
  };
  surface.placementIds.push("placement");
  return document;
}

test("activation helpers clamp and advance momentary, toggle, and cycle states", () => {
  const momentary = createDefaultButtonActivationBehavior("momentary", "Run");
  const toggle = createDefaultButtonActivationBehavior("toggle", "Run", (index) => `toggle-${index}`);
  const cycle = makeCycleBehavior();

  assert.equal(getButtonActivationStateCount(null), 1);
  assert.equal(getButtonActivationStateCount(momentary), 1);
  assert.equal(getButtonActivationStateCount(toggle), 2);
  assert.equal(getButtonActivationStateCount(cycle), 3);
  assert.deepEqual(toggle.states.map((state) => state.id), ["toggle-0", "toggle-1"]);
  assert.equal(clampButtonActivationStateIndex(cycle, -20), 0);
  assert.equal(clampButtonActivationStateIndex(cycle, 20), 2);
  assert.equal(advanceButtonActivationStateIndex(momentary, 0), 0);
  assert.equal(advanceButtonActivationStateIndex(toggle, 0), 1);
  assert.equal(advanceButtonActivationStateIndex(toggle, 1), 0);
  assert.equal(advanceButtonActivationStateIndex(cycle, 2), 0);
});

test("null visual mapping preserves legacy composed flags while labels follow trigger priority", () => {
  const resolved = resolveButtonAppearance({
    buttonLabel: "Fallback",
    activationBehavior: makeCycleBehavior(),
    activeStateIndex: 0,
    visualStateMap: null,
    appearance: {
      ...RESTING_APPEARANCE,
      hovered: true,
      pressed: true,
      held: true,
      play: true,
      release: true
    }
  });

  assert.equal(resolved.activeTrigger, "held");
  assert.equal(resolved.visualState, "held");
  assert.equal(resolved.label, "Holding off");
  assert.deepEqual(resolved.flags, {
    hovered: true,
    pressed: true,
    held: true,
    play: true,
    release: true,
    disabled: false,
    error: false
  });
});

test("non-null visual mapping resolves one priority target with identity fallback", () => {
  const behavior = makeCycleBehavior();
  const mapped = resolveButtonAppearance({
    buttonLabel: "Fallback",
    activationBehavior: behavior,
    activeStateIndex: 1,
    visualStateMap: { on: { error: "hover", pressed: "release" } },
    appearance: {
      ...RESTING_APPEARANCE,
      hovered: true,
      pressed: true,
      error: true
    }
  });
  assert.equal(mapped.activeTrigger, "error");
  assert.equal(mapped.visualState, "hover");
  assert.equal(mapped.label, "On failed");
  assert.deepEqual(mapped.flags, {
    hovered: true,
    pressed: false,
    held: false,
    play: false,
    release: false,
    disabled: false,
    error: false
  });

  const identityFallback = resolveButtonAppearance({
    buttonLabel: "Fallback",
    activationBehavior: behavior,
    activeStateIndex: 0,
    visualStateMap: {},
    appearance: { ...RESTING_APPEARANCE, hovered: true, pressed: true, held: true }
  });
  assert.equal(identityFallback.activeTrigger, "held");
  assert.equal(identityFallback.visualState, "held");
  assert.deepEqual(identityFallback.flags, {
    hovered: false,
    pressed: false,
    held: true,
    play: false,
    release: false,
    disabled: false,
    error: false
  });

  const suppressedHover = resolveButtonAppearance({
    buttonLabel: "Fallback",
    activationBehavior: behavior,
    activeStateIndex: 0,
    visualStateMap: { off: { hover: "base" } },
    appearance: { ...RESTING_APPEARANCE, hovered: true }
  });
  assert.equal(suppressedHover.activeTrigger, "hover");
  assert.equal(suppressedHover.visualState, "base");
  assert.equal(suppressedHover.label, "Turn on");
  assert.deepEqual(suppressedHover.flags, {
    hovered: false,
    pressed: false,
    held: false,
    play: false,
    release: false,
    disabled: false,
    error: false
  });
});

test("state index and appearance trigger independently choose the label", () => {
  const behavior = makeCycleBehavior();
  const hover = resolveButtonAppearance({
    buttonLabel: "Fallback",
    activationBehavior: behavior,
    activeStateIndex: 1,
    visualStateMap: {},
    appearance: { ...RESTING_APPEARANCE, hovered: true }
  });
  assert.equal(hover.activationState?.id, "on");
  assert.equal(hover.label, "Turn off");

  const rest = resolveButtonAppearance({
    buttonLabel: "Fallback",
    activationBehavior: behavior,
    activeStateIndex: 99,
    visualStateMap: {},
    appearance: RESTING_APPEARANCE
  });
  assert.equal(rest.activationStateIndex, 2);
  assert.equal(rest.label, "Auto");
});

test("schema-1 loading backfills legacy behavior and mapping fields to null", () => {
  const legacy = makeStateDocument();
  delete legacy.buttons.button.activationBehavior;
  delete legacy.placements.placement.visualStateMap;

  const normalized = normalizeLoadedButtonStateDocument(legacy);
  assert.equal(normalized.buttons.button.activationBehavior, null);
  assert.equal(normalized.placements.placement.visualStateMap, null);
  const validation = validateButtonStateDocument(normalized);
  assert.equal(
    validation.valid,
    true,
    validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")
  );
});

test("activation behavior and placement visual mapping validate strictly", () => {
  const validDocument = makeStateDocument();
  assert.equal(validateButtonStateDocument(validDocument).valid, true);

  const malformed = structuredClone(validDocument);
  malformed.buttons.button.activationBehavior = {
    mode: "cycle",
    states: [
      { id: "duplicate", label: "One", labelOverrides: { rest: "invalid" } },
      { id: "duplicate", label: "Two", labelOverrides: { hover: 42 } }
    ]
  };
  malformed.placements.placement.visualStateMap = {
    missing: { mystery: "base", hover: "unknown" }
  };

  const validation = validateButtonStateDocument(malformed);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.message.includes("IDs must be unique")));
  assert.ok(validation.issues.some((issue) => issue.message.includes("label trigger is invalid")));
  assert.ok(validation.issues.some((issue) => issue.message.includes("label override must be a string")));
  assert.ok(validation.issues.some((issue) => issue.message.includes("unknown Button activation state")));
  assert.ok(validation.issues.some((issue) => issue.message.includes("appearance trigger is invalid")));
  assert.ok(validation.issues.some((issue) => issue.message.includes("skin visual state is invalid")));
});
