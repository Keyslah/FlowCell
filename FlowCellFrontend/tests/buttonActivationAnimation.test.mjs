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
  buildPlusRiseAnimationFrames,
  canButtonRunActivationAnimation,
  getButtonAnimationAspectRatio,
  normalizeButtonAnimationDesktopBounds,
  normalizeButtonAnimationEditorBounds,
  PLUS_RISE_FRAME_COUNT,
  resizeButtonAnimationEditorBounds,
  resolveButtonAnimationPlaybackBounds
} from "./.compiled-button-system/button/animations/buttonActivationAnimations.js";

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
