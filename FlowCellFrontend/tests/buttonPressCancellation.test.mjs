import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { resolveButtonPressEventPlan } from "./.compiled-button-system/button/runtime/ButtonRuntimeAdapter.js";
import { shouldIgnoreButtonWindowCursor } from "./.compiled-button-system/button/windows/nativeCursorIgnoreController.js";

// Execute the component's actual event wiring without replacing its press handlers.
const source = readFileSync(new URL("../src/button/ButtonHost.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("ButtonHost.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let pressEffect;
function findPressEffect(node) {
  if (ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect" &&
      ts.isArrowFunction(node.arguments[0]) && node.arguments[0].getText(parsed).includes("const beginPress =")) {
    pressEffect = node.arguments[0].getText(parsed);
  }
  ts.forEachChild(node, findPressEffect);
}
findPressEffect(parsed);
assert.ok(pressEffect, "ButtonHost press effect must be available to the event regression");
const compiledEffect = ts.transpileModule(`(${pressEffect})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;

class PointerEvent extends Event {
  constructor(type, options = {}) {
    super(type, { cancelable: true });
    Object.assign(this, { button: 0, pointerId: 1, ...options });
  }
}

class KeyboardEvent extends Event {}

function pressHarness(pressDown = false) {
  const core = new EventTarget();
  core.setPointerCapture = () => {};
  const targetWindow = new EventTarget();
  const timers = new Map();
  let timerId = 0;
  targetWindow.setTimeout = (callback) => { timers.set(++timerId, callback); return timerId; };
  const ref = (current = null) => ({ current });
  const state = { pressed: false, held: false };
  const events = [];
  const triggers = [];
  const pointerActive = ref(false);
  const context = {
    coreElement: core, window: targetWindow, PointerEvent, KeyboardEvent,
    buttonRef: ref({ id: "probe", disabled: false, executionTarget: pressDown
      ? { events: { pressDown: {}, pressUp: {} } } : {} }),
    placementRef: ref({ id: "placement" }), modeRef: ref("run"), selectionOnlyRef: ref(false),
    selectFieldRef: ref(), inlineEditorElementRef: ref(), onRequestInlineEditorFocusRef: ref(),
    onSelectRef: ref(), onDoubleActivateRef: ref(), onRequestContextMenuRef: ref(),
    onHoverStartRef: ref(), onHoverEndRef: ref(), onHoverCancelRef: ref(),
    pointerActiveRef: pointerActive, hoverActiveRef: ref(false),
    pressEventPlanRef: ref(), pressActivationInteractionIdRef: ref(),
    syntheticHoverSessionRef: ref(false), pendingHoverLeaveRef: ref(false),
    holdTimerRef: ref(), releaseTimerRef: ref(),
    requestActivationTriggerRef: ref((event) => triggers.push(event)),
    nextButtonHostInteractionId: () => "interaction",
    setPressed: (value) => { state.pressed = value; },
    setHeld: (value) => { state.held = value; },
    setHovered: () => {}, setRelease: () => {}, startPlay: () => {},
    clearTimer: (timer) => { timers.delete(timer.current); timer.current = null; },
    HOLD_MS: 300, RELEASE_MS: 100,
    eventTargetsInlineEditor: () => false,
    commitActiveInlineEditorBeforeButtonPress: () => {},
    isButtonWindowGeometryTransitionActive: () => false,
    resolveButtonPressEventPlan,
    enqueueEvent: (event) => { events.push(event); return Promise.resolve(); }
  };
  const install = vm.runInNewContext(compiledEffect, context);
  const dispose = install();
  return {
    core, targetWindow, state, events, triggers, timers, pointerActive, dispose,
    pointer(type) {
      const event = new PointerEvent(type);
      core.dispatchEvent(event);
      return event;
    }
  };
}

for (const cause of ["window blur", "lost pointer capture"]) {
  for (const pressDown of [false, true]) {
    test(`${cause} clears a pressed ${pressDown ? "press-down" : "click"} Button without inventing a click`, () => {
      const h = pressHarness(pressDown);
      const down = h.pointer("pointerdown");
      assert.equal(down.defaultPrevented, true, "ordinary mouse press does not focus the core");
      assert.equal(h.state.pressed, true);
      assert.equal(shouldIgnoreButtonWindowCursor(true, false, h.state.pressed), false);
      if (cause === "window blur") h.targetWindow.dispatchEvent(new Event("blur"));
      else h.pointer("lostpointercapture");
      assert.equal(h.state.pressed, false);
      assert.equal(h.pointerActive.current, false);
      assert.equal(h.timers.size, 0, "a cancelled press cannot later become held");
      assert.equal(shouldIgnoreButtonWindowCursor(true, false, h.state.pressed), true,
        "a full-monitor Button host must return to click-through outside its controls");
      h.targetWindow.dispatchEvent(new Event("blur"));
      h.pointer("lostpointercapture");
      h.pointer("pointerup");
      assert.deepEqual(h.events, pressDown ? ["pressDown", "pressUp"] : []);
      h.dispose();
    });
  }
}

test("normal pointerup activates once and its later capture loss does not duplicate activation", () => {
  for (const pressDown of [false, true]) {
    const h = pressHarness(pressDown);
    h.pointer("pointerdown");
    h.pointer("pointerup");
    h.pointer("lostpointercapture");
    h.targetWindow.dispatchEvent(new Event("blur"));
    assert.equal(h.state.pressed, false);
    assert.deepEqual(h.events, pressDown ? ["pressDown", "pressUp"] : ["click"]);
    assert.deepEqual(h.triggers, ["press", "release"]);
    h.dispose();
  }
});

test("disposing ButtonHost removes window cancellation listeners", () => {
  const h = pressHarness(true);
  h.dispose();
  h.pointerActive.current = true;
  h.state.pressed = true;
  h.targetWindow.dispatchEvent(new Event("blur"));
  h.pointer("lostpointercapture");
  assert.equal(h.state.pressed, true, "disposed event wiring must not update component state");
  assert.deepEqual(h.events, []);
});
