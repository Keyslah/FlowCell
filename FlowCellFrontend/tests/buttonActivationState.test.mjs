import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceButtonActivationStateIndex,
  buttonPlacementActivationCycleAdvancesOn,
  clampButtonActivationStateIndex,
    clampButtonPlacementActivationStateIndex,
    createDefaultButtonActivationBehavior,
    getButtonActivationStateCount,
    getButtonPlacementActivationStateCount,
    resolveButtonPlacementActivationStateIndexFromResponse,
    resolveButtonAppearance
} from "./.compiled-button-system/button/runtime/buttonActivationState.js";
import {
  createButtonStateDocument
} from "./.compiled-button-system/button/state/buttonDefaults.js";
import {
    resolveTriggeredIndex,
    setButtonActivationState,
    startButtonActivationStateCoordinator,
    subscribeButtonActivationState
} from "./.compiled-button-system/button/runtime/ButtonActivationStateBus.js";
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

function makePlacementCycle() {
  return {
    states: [
      { id: "resting", label: "Off", advanceTrigger: "release", visualState: "base" },
      { id: "armed", label: "Armed", advanceTrigger: "press", visualState: "held" },
      { id: "ready", label: "Ready", advanceTrigger: "hover", visualState: "release" }
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
    textOffsetX: 0,
    textOffsetY: 0,
    minimumFontSize: 8,
    textSizeOverride: null,
    allowLabelResize: false,
    matchHitboxToSkin: true,
    allowStretching: false,
    highlightOnHover: false,
    resizeAnchor: "top-left",
    activationCycle: null,
    visualStateMap: {
      off: { hover: "held" },
      on: { error: "hover" }
    }
  };
  surface.placementIds.push("placement");
  return document;
}

function applyActivationTrigger(indexes, consumedInteractionIds, request) {
  const next = resolveTriggeredIndex(request, indexes, consumedInteractionIds);
  if (next !== null) indexes.set(request.activationKey, next);
  return next;
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

test("placement cycle helpers use state count, stable order, and each state's trigger", () => {
  const cycle = makePlacementCycle();

  assert.equal(getButtonPlacementActivationStateCount(null), 1);
  assert.equal(getButtonPlacementActivationStateCount({ states: [cycle.states[0]] }), 1);
  assert.equal(getButtonPlacementActivationStateCount(cycle), 3);
  assert.equal(clampButtonPlacementActivationStateIndex(cycle, -2), 0);
  assert.equal(clampButtonPlacementActivationStateIndex(cycle, 99), 2);
  assert.equal(buttonPlacementActivationCycleAdvancesOn(cycle, 0, "release"), true);
  assert.equal(buttonPlacementActivationCycleAdvancesOn(cycle, 0, "press"), false);
  assert.equal(buttonPlacementActivationCycleAdvancesOn(cycle, 1, "press"), true);
  assert.equal(buttonPlacementActivationCycleAdvancesOn(cycle, 2, "hover"), true);
});

test("placement cycle result matches resolve authoritative nested action responses", () => {
  const cycle = makePlacementCycle();
  cycle.states[0].resultMatches = [
    { axis: "X", mode: "NONE" },
    { modes: { X: "NONE" } }
  ];
  cycle.states[1].resultMatches = [
    { axis: "X", mode: "MIN" },
    { modes: { X: "MIN" } }
  ];
  cycle.states[2].resultMatches = [
    { axis: "X", mode: "MAX", flags: ["locked", { side: "maximum" }] }
  ];

  assert.equal(
    resolveButtonPlacementActivationStateIndexFromResponse(
      cycle,
      { status: "ok", axis: "X", mode: "MIN", selected: 3 }
    ),
    1
  );
  assert.equal(
    resolveButtonPlacementActivationStateIndexFromResponse(
      cycle,
      { status: "ok", modes: { X: "NONE", Y: "MAX", Z: "MIN" } }
    ),
    0
  );
  assert.equal(
    resolveButtonPlacementActivationStateIndexFromResponse(
      cycle,
      { axis: "X", mode: "MAX", flags: ["locked", { side: "maximum", extra: true }] }
    ),
    2
  );
  assert.equal(
    resolveButtonPlacementActivationStateIndexFromResponse(cycle, { axis: "Y", mode: "MIN" }),
    null
  );
  const ambiguous = structuredClone(cycle);
  ambiguous.states[0].resultMatches.push({ status: "ok" });
  assert.equal(
    resolveButtonPlacementActivationStateIndexFromResponse(
      ambiguous,
      { status: "ok", axis: "X", mode: "MIN" }
    ),
    null
  );
  assert.equal(resolveButtonPlacementActivationStateIndexFromResponse(null, {}), null);
});

test("absolute activation-state setter publishes a clamped placement index in local hosts", async () => {
  const activationKey = `placement-set-test-${Date.now()}`;
  const observed = [];
  const unsubscribe = await subscribeButtonActivationState(
    activationKey,
    3,
    (index) => observed.push(index)
  );
  try {
    await setButtonActivationState(activationKey, 3, 2);
    assert.equal(observed.at(-1), 2);
    await setButtonActivationState(activationKey, 3, 99);
    assert.equal(observed.at(-1), 2);
    await setButtonActivationState(activationKey, 3, -4);
    assert.equal(observed.at(-1), 0);
  } finally {
    unsubscribe();
  }
});

test("absolute activation-state setter updates its host when Tauri accepts an event without a coordinator", async () => {
  const activationKey = `placement-set-transport-test-${Date.now()}`;
  const observed = [];
  const unsubscribe = await subscribeButtonActivationState(
    activationKey,
    3,
    (index) => observed.push(index)
  );
  const previousInternals = globalThis.__TAURI_INTERNALS__;
  globalThis.__TAURI_INTERNALS__ = {
    invoke: async () => null
  };
  try {
    await setButtonActivationState(activationKey, 3, 1);
    assert.equal(observed.at(-1), 1);
  } finally {
    if (previousInternals === undefined) delete globalThis.__TAURI_INTERNALS__;
    else globalThis.__TAURI_INTERNALS__ = previousInternals;
    unsubscribe();
  }
});

test("activation-state teardown contains Tauri's async missing-listener rejection", async () => {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const previousWindow = globalThis.window;
  const hadTauriInternals = Object.prototype.hasOwnProperty.call(globalThis, "__TAURI_INTERNALS__");
  const previousTauriInternals = globalThis.__TAURI_INTERNALS__;
  const hadEventInternals = Object.prototype.hasOwnProperty.call(
    globalThis,
    "__TAURI_EVENT_PLUGIN_INTERNALS__"
  );
  const previousEventInternals = globalThis.__TAURI_EVENT_PLUGIN_INTERNALS__;
  const unregisterAttempts = new Map();
  const backendUnlistens = [];
  let callbackId = 900;
  let listenCount = 0;
  let resolveFirstListen = null;

  globalThis.window = globalThis;
  globalThis.__TAURI_INTERNALS__ = {
    transformCallback: () => callbackId++,
    invoke: async (command, args) => {
      if (command === "plugin:event|listen") {
        const eventId = 700 + listenCount++;
        if (listenCount === 1) {
          return new Promise((resolve) => {
            resolveFirstListen = () => resolve(eventId);
          });
        }
        return eventId;
      }
      if (command === "plugin:event|unlisten") {
        backendUnlistens.push(args.eventId);
      }
      return null;
    }
  };
  globalThis.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (_event, eventId) => {
      const attempts = (unregisterAttempts.get(eventId) ?? 0) + 1;
      unregisterAttempts.set(eventId, attempts);
      if (attempts === 1) {
        throw new TypeError("Cannot read properties of undefined (reading 'handlerId')");
      }
    }
  };

  const activationKey = `placement-unlisten-test-${Date.now()}`;
  const observed = [];
  let returnedCleanup = null;
  try {
    const pendingSubscription = subscribeButtonActivationState(
      activationKey,
      3,
      (index) => observed.push(index)
    ).then((cleanup) => {
      returnedCleanup = cleanup;
      cleanup();
    });
    await Promise.resolve();
    assert.equal(typeof resolveFirstListen, "function");
    resolveFirstListen();
    await pendingSubscription;
    returnedCleanup();

    const stopCoordinator = await startButtonActivationStateCoordinator();
    stopCoordinator();
    stopCoordinator();

    await new Promise((resolve) => setTimeout(resolve, 20));
    await setButtonActivationState(activationKey, 3, 2);

    assert.deepEqual(observed, [0]);
    assert.deepEqual(
      [...unregisterAttempts.entries()].sort(([left], [right]) => left - right),
      [700, 701, 702, 703, 704].map((eventId) => [eventId, 2])
    );
    assert.deepEqual([...backendUnlistens].sort((left, right) => left - right), [700, 701, 702, 703, 704]);
  } finally {
    if (hadWindow) globalThis.window = previousWindow;
    else delete globalThis.window;
    if (hadTauriInternals) globalThis.__TAURI_INTERNALS__ = previousTauriInternals;
    else delete globalThis.__TAURI_INTERNALS__;
    if (hadEventInternals) globalThis.__TAURI_EVENT_PLUGIN_INTERNALS__ = previousEventInternals;
    else delete globalThis.__TAURI_EVENT_PLUGIN_INTERNALS__;
  }
});

test("one press/release gesture stays consumed when another interaction advances in between", () => {
  const indexes = new Map();
  const consumedInteractionIds = new Map();
  const advanceTriggers = ["press", "press", "release"];
  const request = (trigger, interactionId) => ({
    activationKey: "placement-a",
    stateCount: advanceTriggers.length,
    advanceTriggers,
    trigger,
    interactionId
  });

  assert.equal(applyActivationTrigger(indexes, consumedInteractionIds, request("press", "gesture-a")), 1);
  assert.equal(applyActivationTrigger(indexes, consumedInteractionIds, request("press", "gesture-b")), 2);
  assert.equal(applyActivationTrigger(indexes, consumedInteractionIds, request("release", "gesture-a")), null);
  assert.equal(indexes.get("placement-a"), 2);
});

test("release-only cycles ignore press and then consume the matching release once", () => {
  const indexes = new Map();
  const consumedInteractionIds = new Map();
  const advanceTriggers = ["release", "press"];
  const request = (trigger) => ({
    activationKey: "placement-a",
    stateCount: advanceTriggers.length,
    advanceTriggers,
    trigger,
    interactionId: "gesture-a"
  });

  assert.equal(applyActivationTrigger(indexes, consumedInteractionIds, request("press")), null);
  assert.equal(applyActivationTrigger(indexes, consumedInteractionIds, request("release")), 1);
  assert.equal(applyActivationTrigger(indexes, consumedInteractionIds, request("release")), null);
});

test("consumed interaction histories are bounded and scoped by activation key", () => {
  const indexes = new Map();
  const consumedInteractionIds = new Map();
  const advanceTriggers = ["press", "press"];
  for (const activationKey of ["placement-a", "placement-b"]) {
    assert.notEqual(applyActivationTrigger(indexes, consumedInteractionIds, {
      activationKey,
      stateCount: advanceTriggers.length,
      advanceTriggers,
      trigger: "press",
      interactionId: "shared-gesture-id"
    }), null);
  }
  for (let index = 0; index < 300; index += 1) {
    const next = applyActivationTrigger(indexes, consumedInteractionIds, {
      activationKey: "placement-a",
      stateCount: advanceTriggers.length,
      advanceTriggers,
      trigger: "press",
      interactionId: `gesture-${index}`
    });
    assert.notEqual(next, null);
  }

  assert.equal(consumedInteractionIds.get("placement-b").ids.has("shared-gesture-id"), true);
  assert.ok(consumedInteractionIds.get("placement-a").ids.size <= 256);
  assert.ok(consumedInteractionIds.get("placement-a").order.length <= 256);
});

test("configured placement cycle uses hover as a transient over a base-latched visual", () => {
  const cycle = makePlacementCycle();
  const resolve = (patch) => resolveButtonAppearance({
    buttonLabel: "Fallback",
    activationBehavior: null,
    activationCycle: cycle,
    activeStateIndex: 0,
    visualStateMap: null,
    appearance: { ...RESTING_APPEARANCE, ...patch }
  });

  const resting = resolve({});
  assert.equal(resting.visualState, "base");
  const hovered = resolve({ hovered: true });
  assert.equal(hovered.activeTrigger, "hover");
  assert.equal(hovered.visualState, "hover");
  assert.deepEqual(hovered.flags, {
    hovered: true,
    pressed: false,
    held: false,
    play: false,
    release: false,
    disabled: false,
    error: false
  });
  assert.equal(resolve({}).visualState, "base");
});

test("configured placement cycle settles transient input back to a hover-latched visual", () => {
  const cycle = makePlacementCycle();
  cycle.states[0] = { ...cycle.states[0], visualState: "hover" };
  const resolve = (patch) => resolveButtonAppearance({
    buttonLabel: "Fallback",
    activationBehavior: null,
    activationCycle: cycle,
    activeStateIndex: 0,
    visualStateMap: null,
    appearance: { ...RESTING_APPEARANCE, ...patch }
  });

  assert.equal(resolve({}).visualState, "hover");
  assert.equal(resolve({ pressed: true }).visualState, "pressed");
  const settled = resolve({});
  assert.equal(settled.activeTrigger, "rest");
  assert.equal(settled.visualState, "hover");
  assert.deepEqual(settled.flags, {
    hovered: true,
    pressed: false,
    held: false,
    play: false,
    release: false,
    disabled: false,
    error: false
  });
});

test("configured placement cycle gives pressed and release precedence over hover", () => {
  const cycle = makePlacementCycle();
  const resolve = (patch) => resolveButtonAppearance({
    buttonLabel: "Fallback",
    activationBehavior: null,
    activationCycle: cycle,
    activeStateIndex: 0,
    visualStateMap: null,
    appearance: { ...RESTING_APPEARANCE, ...patch }
  });

  const pressed = resolve({ hovered: true, pressed: true, release: true });
  assert.equal(pressed.activeTrigger, "pressed");
  assert.equal(pressed.visualState, "pressed");
  assert.deepEqual(pressed.flags, {
    hovered: false,
    pressed: true,
    held: false,
    play: false,
    release: false,
    disabled: false,
    error: false
  });
  const released = resolve({ hovered: true, release: true });
  assert.equal(released.activeTrigger, "release");
  assert.equal(released.visualState, "release");
});

test("configured placement cycle skips empty transient sections and keeps the authored hover target static", () => {
  const cycle = {
    states: [
      { id: "off", label: "Live", advanceTrigger: "press", visualState: "base" },
      { id: "on", label: "Live", advanceTrigger: "press", visualState: "hover" }
    ]
  };
  const authoredVisualStates = new Set(["base", "hover"]);
  const resolve = (activeStateIndex, patch) => resolveButtonAppearance({
    buttonLabel: "Live",
    activationBehavior: null,
    activationCycle: cycle,
    activeStateIndex,
    visualStateMap: null,
    authoredVisualStates,
    appearance: { ...RESTING_APPEARANCE, ...patch }
  });

  const settledHoverSequence = [
    resolve(0, { hovered: true }),
    resolve(0, { hovered: true, pressed: true }),
    resolve(1, { hovered: true, pressed: true, held: true }),
    resolve(1, { hovered: true, play: true, release: true }),
    resolve(1, { hovered: true, play: true }),
    resolve(1, { hovered: true })
  ];
  for (const appearance of settledHoverSequence) {
    assert.equal(appearance.visualState, "hover");
    assert.deepEqual(appearance.flags, {
      hovered: true,
      pressed: false,
      held: false,
      play: false,
      release: false,
      disabled: false,
      error: false
    });
  }
  assert.deepEqual(
    settledHoverSequence.map(({ activeTrigger }) => activeTrigger),
    ["hover", "hover", "hover", "hover", "hover", "hover"]
  );

  const keyboardPressOnLatchedHover = resolve(1, { pressed: true });
  assert.equal(keyboardPressOnLatchedHover.activeTrigger, "rest");
  assert.equal(keyboardPressOnLatchedHover.visualState, "hover");

  const authoredPressed = resolveButtonAppearance({
    buttonLabel: "Live",
    activationBehavior: null,
    activationCycle: cycle,
    activeStateIndex: 1,
    visualStateMap: null,
    authoredVisualStates: new Set(["base", "hover", "pressed"]),
    appearance: { ...RESTING_APPEARANCE, hovered: true, pressed: true }
  });
  assert.equal(authoredPressed.activeTrigger, "pressed");
  assert.equal(authoredPressed.visualState, "pressed");
  assert.deepEqual(authoredPressed.flags, {
    hovered: false,
    pressed: true,
    held: false,
    play: false,
    release: false,
    disabled: false,
    error: false
  });
});

test("configured placement cycle ignores editor selection without hiding real hover", () => {
  const cycle = makePlacementCycle();
  const appearanceFor = (patch) => resolveButtonAppearance({
    buttonLabel: "Fallback",
    activationBehavior: null,
    activationCycle: cycle,
    activeStateIndex: 1,
    visualStateMap: null,
    appearance: { ...RESTING_APPEARANCE, ...patch }
  });

  const selected = appearanceFor({ selected: true });
  assert.equal(selected.activeTrigger, "rest");
  assert.equal(selected.visualState, "held");
  const selectedHover = appearanceFor({ selected: true, hovered: true });
  assert.equal(selectedHover.activeTrigger, "hover");
  assert.equal(selectedHover.visualState, "hover");
});

test("configured placement cycle keeps error and disabled above transient visuals", () => {
  const cycle = makePlacementCycle();
  const appearanceFor = (patch) => resolveButtonAppearance({
    buttonLabel: "Fallback",
    activationBehavior: null,
    activationCycle: cycle,
    activeStateIndex: 2,
    visualStateMap: null,
    appearance: { ...RESTING_APPEARANCE, ...patch }
  });

  assert.equal(appearanceFor({ disabled: true, pressed: true }).visualState, "disabled");
  assert.equal(appearanceFor({ error: true, disabled: true, held: true }).visualState, "error");
  assert.equal(appearanceFor({ error: true }).label, "Ready");
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
