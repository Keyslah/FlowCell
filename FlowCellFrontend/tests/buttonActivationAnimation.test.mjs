import test from "node:test";
import assert from "node:assert/strict";
import {
  createButtonStateDocument
} from "./.compiled-button-system/button/state/buttonDefaults.js";
import {
  normalizeLoadedButtonStateDocument,
  validateButtonStateDocument
} from "./.compiled-button-system/button/state/buttonStateValidation.js";
import {
  executeButtonRecord,
  registerButtonCoreAction
} from "./.compiled-button-system/button/runtime/ButtonRuntimeAdapter.js";
import {
  registerButtonActivationEffectHandler
} from "./.compiled-button-system/button/runtime/buttonActivationEffects.js";
import {
  createLatestDesiredRegistrationCoordinator
} from "./.compiled-button-system/button/runtime/latestDesiredRegistration.js";
import {
  buildButtonAnimationFadeFrames,
  buildPlusRiseAnimationFrames,
  BUTTON_ACTIVATION_ANIMATION_PRESETS,
  canButtonRunActivationAnimation,
  consumeButtonAnimationPress,
  getButtonActivationAnimationPreset,
  getButtonAnimationFadeCurve,
  getButtonAnimationFrequency,
  getButtonAnimationAspectRatio,
  normalizeButtonAnimationDesktopBounds,
  normalizeButtonAnimationEditorBounds,
  PLUS_RISE_FRAME_COUNT,
  resizeButtonAnimationEditorBounds,
  resolveButtonAnimationPlaybackBounds,
  sampleButtonAnimationFadeCurve
} from "./.compiled-button-system/button/animations/buttonActivationAnimations.js";
import {
  buildWindowContextUrl,
  getWindowContextFromLocation
} from "./.compiled-button-system/lib/windowContext.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function makeExecutableButton(animation = null) {
  return {
    id: "animated-button",
    role: "single-script",
    sourceIdentity: null,
    label: "Animated Button",
    tooltip: "",
    executionTarget: {
      kind: "core-action",
      actionId: "test-animated-button"
    },
    defaultSkinId: "skin-default",
    defaultTextFitMode: "shrink",
    disabled: false,
    activationAnimation: animation,
    activationBehavior: null,
    toolSetParentId: null,
    toolSetBehavior: null,
    metadata: {}
  };
}

test("schema-1 loading backfills missing Button activation animations", () => {
  const document = createButtonStateDocument();
  document.buttons["legacy-button"] = {
    ...makeExecutableButton(),
    id: "legacy-button"
  };
  delete document.buttons["legacy-button"].activationAnimation;

  const normalized = normalizeLoadedButtonStateDocument(document);

  assert.equal(normalized.buttons["legacy-button"].activationAnimation, null);
  const validation = validateButtonStateDocument(normalized);
  assert.equal(
    validation.valid,
    true,
    validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")
  );
});

test("Button activation animation validation accepts Plus Rise bounds and rejects malformed assignments", () => {
  const document = createButtonStateDocument();
  document.buttons["animated-button"] = makeExecutableButton({
    presetId: "plus-rise",
    desktopBounds: { left: 120, top: 80, width: 260, height: 260 }
  });
  assert.equal(validateButtonStateDocument(document).valid, true);

  document.buttons["animated-button"].activationAnimation = {
    presetId: "unknown-preset",
    desktopBounds: { left: 120, top: 80, width: 0, height: 260 }
  };
  const invalid = validateButtonStateDocument(document);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.some((issue) => issue.path.endsWith("presetId")));
  assert.ok(invalid.issues.some((issue) => issue.path.endsWith("desktopBounds")));
});

test("activation animations are available to executable and structural owner Buttons", () => {
  assert.equal(canButtonRunActivationAnimation(makeExecutableButton()), true);
  assert.equal(canButtonRunActivationAnimation({
    ...makeExecutableButton(),
    role: "panel-owner",
    executionTarget: null
  }), true);
  assert.equal(canButtonRunActivationAnimation({
    ...makeExecutableButton(),
    role: "tool-set-owner",
    executionTarget: null
  }), true);
  assert.equal(canButtonRunActivationAnimation({
    ...makeExecutableButton(),
    executionTarget: null
  }), false);
});

test("Star Wars GIF survives canonical validation and animation window routing", () => {
  const document = createButtonStateDocument();
  document.buttons["animated-button"] = makeExecutableButton({
    presetId: "star-wars-lightsaber",
    opacity: 0.45,
    desktopBounds: { left: 120, top: 80, width: 480, height: 268 }
  });
  assert.equal(validateButtonStateDocument(document).valid, true);
  assert.ok(BUTTON_ACTIVATION_ANIMATION_PRESETS.some((preset) =>
    preset.id === "star-wars-lightsaber" && preset.label === "Star Wars Lightsaber"
  ));
  const context = {
    kind: "button-animation",
    schemaVersion: 1,
    mode: "play",
    requestId: "gif-repeat",
    buttonId: "animated-button",
    presetId: "star-wars-lightsaber",
    opacity: 0.45
  };
  const previousWindow = globalThis.window;
  try {
    globalThis.window = { location: new URL(buildWindowContextUrl(context), "http://localhost") };
    assert.deepEqual(getWindowContextFromLocation(), context);
    for (const opacity of [-0.1, 1.1, null, "0.5"]) {
      document.buttons["animated-button"].activationAnimation.opacity = opacity;
      assert.equal(validateButtonStateDocument(document).valid, false);
      globalThis.window.location = new URL(buildWindowContextUrl({ ...context, opacity }), "http://localhost");
      assert.deepEqual(getWindowContextFromLocation(), { kind: "main" });
    }
    for (const opacity of [0, 1, undefined]) {
      document.buttons["animated-button"].activationAnimation.opacity = opacity;
      assert.equal(validateButtonStateDocument(document).valid, true);
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("Star Wars GIF uses one source cycle and its original aspect ratio without travel padding", () => {
  assert.equal(getButtonActivationAnimationPreset("star-wars-lightsaber").durationMs, 3010);
  const bounds = normalizeButtonAnimationEditorBounds("star-wars-lightsaber", {
    left: 100, top: 200, width: 480, height: 900
  });
  assert.deepEqual(bounds, { left: 100, top: 200, width: 480, height: 268 });
  assert.deepEqual(resolveButtonAnimationPlaybackBounds("star-wars-lightsaber", bounds), bounds);
  const resized = resizeButtonAnimationEditorBounds({
    presetId: "star-wars-lightsaber",
    bounds,
    direction: "East",
    cursor: { x: 1060, y: 334 },
    minimumWidth: 140
  });
  assert.deepEqual(resized, { left: 100, top: 66, width: 960, height: 536 });
});

test("default animation fades smoothly in and out, scaled by overall transparency", () => {
  const curve = getButtonAnimationFadeCurve({});
  assert.deepEqual(curve, [
    { time: 0, opacity: 0 }, { time: 0.2, opacity: 1 },
    { time: 0.8, opacity: 1 }, { time: 1, opacity: 0 }
  ]);
  for (const [time, expected] of [[0, 0], [0.1, 0.5], [0.2, 1], [0.5, 1], [0.8, 1], [0.9, 0.5], [1, 0]]) {
    assert.ok(Math.abs(sampleButtonAnimationFadeCurve(curve, time) - expected) < 1e-10);
  }
  const frames = buildButtonAnimationFadeFrames({ opacity: 0.35 });
  assert.deepEqual(frames[0], { offset: 0, opacity: 0 });
  assert.deepEqual(frames.at(-1), { offset: 1, opacity: 0 });
  assert.equal(Math.max(...frames.map((frame) => frame.opacity)), 0.35);
  assert.ok(frames.every((frame, index) => frame.opacity >= 0 && frame.opacity <= 0.35 &&
    (index === 0 || frame.offset > frames[index - 1].offset)));
  assert.ok(buildButtonAnimationFadeFrames({ opacity: 0 }).every((frame) => frame.opacity === 0));
  assert.ok(sampleButtonAnimationFadeCurve(curve, 0.001) < 0.00001, "fade eases away from zero");
  assert.equal(sampleButtonAnimationFadeCurve(curve, -1), 0);
  assert.equal(sampleButtonAnimationFadeCurve(curve, 2), 0);
});

test("custom fade curves preserve control points, narrow fades, and explicit no-fade", () => {
  const fadeCurve = [
    { time: 0, opacity: 0.3 }, { time: 0.001, opacity: 0.7 },
    { time: 0.9, opacity: 0.7 }, { time: 1, opacity: 0.1 }
  ];
  const frames = buildButtonAnimationFadeFrames({ fadeCurve });
  assert.deepEqual(getButtonAnimationFadeCurve({ fadeCurve }), fadeCurve);
  for (const point of fadeCurve) {
    assert.equal(sampleButtonAnimationFadeCurve(fadeCurve, point.time), point.opacity);
    assert.ok(frames.some((frame) => frame.offset === point.time && frame.opacity === point.opacity));
  }
  const noFade = [{ time: 0, opacity: 1 }, { time: 1, opacity: 1 }];
  assert.ok(buildButtonAnimationFadeFrames({ fadeCurve: noFade, opacity: 0.6 })
    .every((frame) => frame.opacity === 0.6));
});

test("fade curves round-trip in window contexts and reject malformed saved data", () => {
  const document = createButtonStateDocument();
  const animation = {
    presetId: "star-wars-lightsaber", desktopBounds: { left: 0, top: 0, width: 480, height: 268 },
    fadeCurve: getButtonAnimationFadeCurve({})
  };
  document.buttons["animated-button"] = makeExecutableButton(animation);
  const context = { kind: "button-animation", schemaVersion: 1, mode: "play", requestId: "fade-test",
    buttonId: "animated-button", presetId: animation.presetId, fadeCurve: animation.fadeCurve };
  const previousWindow = globalThis.window;
  try {
    globalThis.window = { location: new URL(buildWindowContextUrl(context), "http://localhost") };
    assert.deepEqual(getWindowContextFromLocation(), context);
    assert.equal(validateButtonStateDocument(document).valid, true);
    for (const invalid of [
      null, [], [{ time: 0, opacity: 0 }],
      [{ time: 0.1, opacity: 0 }, { time: 1, opacity: 1 }],
      [{ time: 0, opacity: 0 }, { time: 0.9, opacity: 1 }],
      [{ time: 0, opacity: 0 }, { time: 0, opacity: 1 }, { time: 1, opacity: 0 }],
      [{ time: 0, opacity: 0 }, { time: 0.8, opacity: 1 }, { time: 0.7, opacity: 1 }, { time: 1, opacity: 0 }],
      [{ time: 0, opacity: -0.1 }, { time: 1, opacity: 1 }],
      [{ time: 0, opacity: 0 }, { time: 1, opacity: 1.1 }],
      [{ time: 0, opacity: 0, extra: 1 }, { time: 1, opacity: 1 }],
      [{ time: 0, opacity: 0 }, { time: 1, opacity: NaN }],
      Array.from({ length: 17 }, (_, index) => ({ time: index / 16, opacity: 1 }))
    ]) {
      animation.fadeCurve = invalid;
      assert.equal(validateButtonStateDocument(document).valid, false, JSON.stringify(invalid));
      globalThis.window.location = new URL(buildWindowContextUrl({ ...context, fadeCurve: invalid }), "http://localhost");
      assert.deepEqual(getWindowContextFromLocation(), { kind: "main" });
    }
    delete animation.fadeCurve;
    assert.equal(validateButtonStateDocument(document).valid, true, "legacy assignments use the default fade");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("random GIF cadence persists the pending interval and count across sessions", () => {
  const data = new Map();
  const session = () => ({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value)
  });
  const button = makeExecutableButton({
    presetId: "star-wars-lightsaber",
    desktopBounds: { left: 0, top: 0, width: 480, height: 268 }
  });
  const randomValues = [0, 0.999999, 0.34];
  let rolls = 0;
  const random = () => randomValues[rolls++];
  const firstSession = session();
  for (let press = 1; press <= 3; press += 1) {
    assert.equal(consumeButtonAnimationPress(button, firstSession, random), false);
  }
  assert.deepEqual(JSON.parse([...data.values()][0]), { frequencyKey: "random-presses:5:50", interval: 5, presses: 3 });
  const reopenedSession = session();
  assert.equal(consumeButtonAnimationPress(button, reopenedSession, random), false);
  assert.equal(rolls, 1, "reopening must not reroll the pending interval");
  assert.equal(consumeButtonAnimationPress(button, reopenedSession, random), true);
  assert.deepEqual(JSON.parse([...data.values()][0]), { frequencyKey: "random-presses:5:50", interval: 50, presses: 0 });
  for (let press = 1; press < 50; press += 1) {
    assert.equal(consumeButtonAnimationPress(button, reopenedSession, random), false);
  }
  assert.equal(consumeButtonAnimationPress(button, reopenedSession, random), true);
  assert.deepEqual(JSON.parse([...data.values()][0]), { frequencyKey: "random-presses:5:50", interval: 20, presses: 0 });
  const otherButton = { ...button, id: "another-button" };
  assert.equal(consumeButtonAnimationPress(otherButton, session(), () => 0), false);
  assert.equal(data.size, 2, "different Buttons keep separate counters");
});

test("Plus Rise remains every-press and invalid GIF counters restart safely", () => {
  const button = makeExecutableButton({
    presetId: "plus-rise",
    desktopBounds: { left: 0, top: 0, width: 283, height: 295 }
  });
  const storage = {
    getItem: () => null,
    setItem: () => {}
  };
  assert.equal(consumeButtonAnimationPress(button, storage), true);
  button.activationAnimation.presetId = "star-wars-lightsaber";
  for (const corrupt of ["broken", "null", "{}", '{"interval":999,"presses":1}', '{"interval":5,"presses":5}']) {
    let written;
    assert.equal(consumeButtonAnimationPress(button, {
      getItem: () => corrupt,
      setItem: (_key, value) => { written = value; }
    }, () => 0), false);
    assert.deepEqual(JSON.parse(written), { frequencyKey: "random-presses:5:50", interval: 5, presses: 1 });
  }
});

test("editable frequency validates saved assignments and preserves legacy defaults", () => {
  assert.deepEqual(getButtonAnimationFrequency({ presetId: "plus-rise" }), { mode: "every-press" });
  assert.deepEqual(getButtonAnimationFrequency({ presetId: "star-wars-lightsaber" }), {
    mode: "random-presses", minimum: 5, maximum: 50
  });
  const document = createButtonStateDocument();
  const animation = { presetId: "star-wars-lightsaber", desktopBounds: { left: 0, top: 0, width: 480, height: 268 } };
  document.buttons["animated-button"] = makeExecutableButton(animation);
  for (const frequency of [
    { mode: "every-press" }, { mode: "every-n-presses", presses: 5 },
    { mode: "every-n-presses", presses: 10000 },
    { mode: "random-presses", minimum: 1, maximum: 1 },
    { mode: "random-presses", minimum: 20, maximum: 50 }, undefined
  ]) {
    animation.frequency = frequency;
    assert.equal(validateButtonStateDocument(document).valid, true, JSON.stringify(frequency));
  }
  for (const frequency of [
    null, {}, { mode: "unknown" }, { mode: "every-press", presses: 5 },
    ...[0, -1, 1.5, 10001, "5", NaN].map((presses) => ({ mode: "every-n-presses", presses })),
    { mode: "random-presses", minimum: 6, maximum: 5 },
    { mode: "random-presses", minimum: 5 },
    { mode: "random-presses", minimum: 1, maximum: 10001 }
  ]) {
    animation.frequency = frequency;
    assert.equal(validateButtonStateDocument(document).valid, false, JSON.stringify(frequency));
  }
});

test("fixed five-press cadence survives reopening and resets when frequency changes", () => {
  let saved = JSON.stringify({ interval: 5, presses: 4 });
  const session = () => ({ getItem: () => saved, setItem: (_key, value) => { saved = value; } });
  const button = makeExecutableButton({
    presetId: "star-wars-lightsaber",
    desktopBounds: { left: 0, top: 0, width: 480, height: 268 },
    frequency: { mode: "every-n-presses", presses: 5 }
  });
  const noRandom = () => { throw new Error("Fixed cadence must not roll"); };
  for (let press = 1; press <= 10; press += 1) {
    assert.equal(consumeButtonAnimationPress(button, session(), noRandom), press % 5 === 0);
  }
  button.activationAnimation.opacity = 0.35;
  button.activationAnimation.fadeCurve = getButtonAnimationFadeCurve({});
  assert.equal(consumeButtonAnimationPress(button, session(), noRandom), false);
  assert.equal(JSON.parse(saved).presses, 1);
  button.activationAnimation.frequency = { mode: "every-press" };
  assert.equal(consumeButtonAnimationPress(button, session(), noRandom), true);
  button.activationAnimation.frequency = { mode: "every-n-presses", presses: 5 };
  assert.equal(consumeButtonAnimationPress(button, session(), noRandom), false);
  assert.equal(JSON.parse(saved).presses, 1, "new frequency starts from its first press");
});

test("custom random ranges include both endpoints and migrate compatible legacy counters", () => {
  let saved = JSON.stringify({ interval: 20, presses: 19 });
  const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
  const button = makeExecutableButton({
    presetId: "star-wars-lightsaber", desktopBounds: { left: 0, top: 0, width: 480, height: 268 }
  });
  assert.equal(consumeButtonAnimationPress(button, storage, () => 0), true);
  button.activationAnimation.frequency = { mode: "random-presses", minimum: 2, maximum: 3 };
  assert.equal(consumeButtonAnimationPress(button, storage, () => 0), false);
  assert.equal(consumeButtonAnimationPress(button, storage, () => 0.999999), true);
  assert.equal(JSON.parse(saved).interval, 3);
  assert.equal(consumeButtonAnimationPress(button, storage, () => 0), false);
  assert.equal(consumeButtonAnimationPress(button, storage, () => 0), false);
  assert.equal(consumeButtonAnimationPress(button, storage, () => 0), true);
  assert.equal(JSON.parse(saved).interval, 2);
});

test("activation animation bounds use whole physical pixels for native Tauri placement", () => {
  assert.deepEqual(
    normalizeButtonAnimationDesktopBounds({
      left: 1023.5,
      top: -41.5,
      width: 259.6,
      height: 260.4
    }),
    { left: 1024, top: -41, width: 260, height: 260 }
  );
});

test("Plus Rise setup bounds are the ratio-locked maximum-size sprite rectangle", () => {
  const bounds = normalizeButtonAnimationEditorBounds("plus-rise", {
    left: 100.4,
    top: 200.4,
    width: 283,
    height: 900
  });

  assert.deepEqual(bounds, { left: 100, top: 200, width: 283, height: 295 });
  assert.equal(getButtonAnimationAspectRatio("plus-rise"), 283 / 295);
  assert.deepEqual(
    resolveButtonAnimationPlaybackBounds("plus-rise", bounds),
    { left: 100, top: 38, width: 283, height: 590 }
  );
});

test("Plus Rise setup resizing keeps its ratio and anchors the opposing edge", () => {
  const initialBounds = { left: 100, top: 200, width: 283, height: 295 };
  const resized = resizeButtonAnimationEditorBounds({
    presetId: "plus-rise",
    bounds: initialBounds,
    direction: "East",
    cursor: { x: 666, y: 348 },
    minimumWidth: 140
  });

  assert.deepEqual(resized, { left: 100, top: 53, width: 566, height: 590 });
  assert.ok(Math.abs((resized.width / resized.height) - (283 / 295)) < 0.001);
  assert.ok(Math.abs(
    (resized.top + resized.height / 2) -
    (initialBounds.top + initialBounds.height / 2)
  ) <= 0.5);
});

test("Plus Rise uses 61 smooth samples while moving strictly upward", () => {
  const frames = buildPlusRiseAnimationFrames();
  assert.equal(frames.length, PLUS_RISE_FRAME_COUNT);
  assert.deepEqual(frames[0], {
    offset: 0,
    opacity: 0,
    scale: 0.46,
    translateYPercent: 67.5
  });
  assert.deepEqual(frames[27], {
    offset: 0.45,
    opacity: 1,
    scale: 1,
    translateYPercent: 0
  });
  assert.deepEqual(frames.at(-1), {
    offset: 1,
    opacity: 0,
    scale: 0.36,
    translateYPercent: -82.5
  });

  for (let index = 1; index < frames.length; index += 1) {
    assert.ok(
      frames[index].translateYPercent < frames[index - 1].translateYPercent,
      `frame ${index} must remain above frame ${index - 1}`
    );
  }
  for (const frame of frames) {
    const center = 0.55 + frame.translateYPercent / 100 + 0.5;
    const top = center - frame.scale / 2;
    const bottom = center + frame.scale / 2;
    assert.ok(top >= -0.000001, `frame ${frame.offset} clipped above the canvas`);
    assert.ok(bottom <= 2.000001, `frame ${frame.offset} clipped below the canvas`);
  }
});

test("actual Button execution notifies the activation effect exactly once", async () => {
  let effectCalls = 0;
  let actionCalls = 0;
  const unregisterEffect = registerButtonActivationEffectHandler(() => {
    effectCalls += 1;
  });
  const unregisterAction = registerButtonCoreAction("test-animated-button", async () => {
    actionCalls += 1;
  });

  try {
    const button = makeExecutableButton({
      presetId: "plus-rise",
      desktopBounds: { left: 120, top: 80, width: 260, height: 260 }
    });
    const hoverResult = await executeButtonRecord(button, "hoverEnter");
    assert.equal(hoverResult.executed, false);
    assert.equal(effectCalls, 0);

    const clickResult = await executeButtonRecord(button, "click");
    assert.equal(clickResult.executed, true);
    assert.equal(actionCalls, 1);
    assert.equal(effectCalls, 1);
  } finally {
    unregisterAction();
    unregisterEffect();
  }
});

test("the animation starts without waiting for a slow Button action to finish", async () => {
  const actionStarted = deferred();
  const finishAction = deferred();
  let effectCalls = 0;
  const unregisterEffect = registerButtonActivationEffectHandler(() => {
    effectCalls += 1;
  });
  const unregisterAction = registerButtonCoreAction("test-animated-button", async () => {
    actionStarted.resolve();
    await finishAction.promise;
  });
  try {
    const pending = executeButtonRecord(makeExecutableButton({
      presetId: "star-wars-lightsaber",
      opacity: 0.45,
      desktopBounds: { left: 100, top: 120, width: 480, height: 268 }
    }), "click");
    await actionStarted.promise;
    assert.equal(effectCalls, 1);
    finishAction.resolve();
    assert.equal((await pending).executed, true);
  } finally {
    finishAction.resolve();
    unregisterAction();
    unregisterEffect();
  }
});

test("paired press and hover events replay the activation effect only on pressDown", async () => {
  let effectCalls = 0;
  let actionCalls = 0;
  const unregisterEffect = registerButtonActivationEffectHandler(() => {
    effectCalls += 1;
  });
  const unregisterAction = registerButtonCoreAction("test-animated-button", async () => {
    actionCalls += 1;
  });

  try {
    const button = makeExecutableButton({
      presetId: "plus-rise",
      desktopBounds: { left: 120, top: 80, width: 260, height: 260 }
    });
    button.executionTarget.events = {
      hoverEnter: {},
      pressDown: {},
      pressUp: {},
      hoverLeave: {}
    };

    await executeButtonRecord(button, "hoverEnter");
    await executeButtonRecord(button, "pressDown");
    await executeButtonRecord(button, "pressUp");
    await executeButtonRecord(button, "hoverLeave");

    assert.equal(actionCalls, 4);
    assert.equal(effectCalls, 1);
  } finally {
    unregisterAction();
    unregisterEffect();
  }
});

test("latest desired registration skips activation when removal arrives during import", async () => {
  const loaded = deferred();
  const started = deferred();
  let registrations = 0;
  let unregistrations = 0;
  const coordinator = createLatestDesiredRegistrationCoordinator(async () => {
    started.resolve();
    return loaded.promise;
  });

  const adding = coordinator.setDesired(true);
  await started.promise;
  const removing = coordinator.setDesired(false);
  loaded.resolve(() => {
    registrations += 1;
    return () => {
      unregistrations += 1;
    };
  });

  await Promise.all([adding, removing]);
  assert.equal(registrations, 0);
  assert.equal(unregistrations, 0);
  await coordinator.dispose();
});

test("latest desired registration serializes overlapping adds and reuses one loaded factory", async () => {
  const loaded = deferred();
  const started = deferred();
  let loads = 0;
  let registrations = 0;
  let unregistrations = 0;
  const coordinator = createLatestDesiredRegistrationCoordinator(async () => {
    loads += 1;
    started.resolve();
    return loaded.promise;
  });

  const firstAdd = coordinator.setDesired(true);
  await started.promise;
  const secondAdd = coordinator.setDesired(true);
  loaded.resolve(() => {
    registrations += 1;
    return () => {
      unregistrations += 1;
    };
  });

  await Promise.all([firstAdd, secondAdd]);
  assert.equal(loads, 1);
  assert.equal(registrations, 1);
  assert.equal(unregistrations, 0);

  await coordinator.setDesired(false);
  await coordinator.setDesired(true);
  assert.equal(loads, 1);
  assert.equal(registrations, 2);
  assert.equal(unregistrations, 1);
  await coordinator.dispose();
  assert.equal(unregistrations, 2);
});

test("latest desired registration cannot activate after disposal during import", async () => {
  const loaded = deferred();
  const started = deferred();
  let registrations = 0;
  const coordinator = createLatestDesiredRegistrationCoordinator(async () => {
    started.resolve();
    return loaded.promise;
  });

  const adding = coordinator.setDesired(true);
  await started.promise;
  const disposing = coordinator.dispose();
  loaded.resolve(() => {
    registrations += 1;
    return () => {};
  });

  await Promise.all([adding, disposing]);
  assert.equal(registrations, 0);
});
