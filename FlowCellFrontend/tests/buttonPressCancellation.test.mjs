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
  const inputsOpened = [];
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
    showButtonInputsContextMenu: async (button) => { inputsOpened.push(button.id); },
    resolveButtonPressEventPlan,
    enqueueEvent: (event) => { events.push(event); return Promise.resolve(); }
  };
  const install = vm.runInNewContext(compiledEffect, context);
  const dispose = install();
  return {
    core, targetWindow, state, events, triggers, timers, pointerActive, dispose,
    inputsOpened, button: context.buttonRef, mode: context.modeRef,
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

test("run-mode Pop/Fan hosts offer source input actions, while editor mode does not", async () => {
  const h = pressHarness();
  h.button.current.sourceIdentity = { displayProgramName: "Windows" };
  h.core.dispatchEvent(new Event("contextmenu", { cancelable: true }));
  await Promise.resolve();
  assert.deepEqual(h.inputsOpened, ["probe"]);
  h.mode.current = "edit";
  h.core.dispatchEvent(new Event("contextmenu", { cancelable: true }));
  assert.deepEqual(h.inputsOpened, ["probe"]);
  assert.deepEqual(h.events, [], "opening inputs never runs the screenshot action");
  h.dispose();
});

function inputsHarness(document = { buttons: {}, popoutUnits: {} }) {
  const calls = [];
  const menus = [];
  const exports = {};
  const source = readFileSync(new URL("../src/button/runtime/buttonInputs.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  vm.runInNewContext(compiled, {
    exports, window: { alert: message => assert.fail(message) },
    require(name) {
      if (name === "@tauri-apps/api/core") return { invoke: async (command, args) => {
        calls.push({ command, args });
        return { hasEditableInputs: args.fileName !== "ordinary.flowcell-source.json" };
      } };
      if (name === "@tauri-apps/api/menu") return { Menu: { new: async options => {
        const menu = { options, popped: false, closed: false,
          async popup() { this.popped = true; }, async close() { this.closed = true; } };
        menus.push(menu);
        return menu;
      } } };
      if (name === "../state/ButtonStateRepository") return { loadButtonStateDocument: async () => document };
      throw new Error(`Unexpected inputs dependency ${name}`);
    }
  });
  return { calls, menus, ...exports };
}

const inputButton = fileName => ({ label: "Any custom label", sourceIdentity: {
  displayProgramName: "Windows", displayPanelName: "Utility", displayFileName: fileName
} });

test("input menus inspect source capabilities before setup and edit without executing", async () => {
  const h = inputsHarness();
  assert.equal(await h.hasEditableButtonInputs({ label: "Screenshot" }), false);
  assert.equal(h.calls.length, 0, "a label cannot grant input capability");
  await h.showButtonInputsContextMenu(inputButton("ordinary.flowcell-source.json"));
  assert.equal(h.menus.length, 0);
  await h.showButtonInputsContextMenu(inputButton("new-owner.flowcell-source.json"));
  assert.equal(h.menus[0].popped, true);
  assert.equal(h.menus[0].options.items[0].text, "Edit Inputs…");
  h.menus[0].options.items[0].action();
  await Promise.resolve();
  assert.equal(h.calls.at(-1).args.editInputs, true);
  assert.equal(h.calls.at(-1).args.fileName, "new-owner.flowcell-source.json");
  assert.ok(h.calls.every(({ args }) => args.inspectInputs === true || args.editInputs === true));
});

test("each native input menu retains the owner it was opened for", async () => {
  const h = inputsHarness();
  await h.showButtonInputsContextMenu(inputButton("first.flowcell-source.json"));
  const firstAction = h.menus[0].options.items[0].action;
  await h.showButtonInputsContextMenu(inputButton("second.flowcell-source.json"));
  assert.equal(h.menus[0].closed, true);
  firstAction();
  await Promise.resolve();
  assert.equal(h.calls.at(-1).args.fileName, "first.flowcell-source.json");
});

test("host-program fields alone do not expose Edit Inputs on tool-set owners or children", async () => {
  const owner = { ...inputButton("ordinary.flowcell-source.json"), id: "owner", role: "tool-set-owner" };
  const child = { id: "child", role: "tool-set-child", toolSetParentId: "owner", sourceIdentity: null,
    executionTarget: { kind: "tool-set-action", command: "run-dangerous-action" } };
  for (const kind of ["text", "number", "range", "select", "toggle", "path", "color"]) {
    const document = { buttons: { owner, child }, popoutUnits: {
      controls: { id: "controls", kind: "tool-set", ownerButtonId: "owner", fields: [{ id: "value", kind, hidden: true }] }
    } };
    const h = inputsHarness(document);
    for (const button of [owner, child]) {
      assert.equal(await h.hasEditableButtonInputs(button), false);
      await h.showButtonInputsContextMenu(button);
    }
    assert.equal(h.menus.length, 0);
    assert.ok(h.calls.every(({ args }) => args.inspectInputs === true));
  }
});

test("a page declaration alone does not expose Edit Inputs or open the page", async () => {
  const h = inputsHarness();
  const page = { ...inputButton("ordinary.flowcell-source.json"), executionTarget: {
    kind: "core-action", actionId: "open-installed-page", payload: {
      ownerButtonId: "owner", programName: "Windows", panelName: "Files",
      fileName: "page.flowcell-source.json", pageId: "setup-organization"
    }
  } };
  assert.equal(await h.hasEditableButtonInputs(page), false);
  await h.showButtonInputsContextMenu(page);
  assert.equal(h.menus.length, 0);
  assert.ok(h.calls.every(({ args }) => args.inspectInputs === true));
});

test("future tool-set Buttons can explicitly declare their own configuration handler", async () => {
  const owner = { ...inputButton("ordinary.flowcell-source.json"), id: "owner", role: "tool-set-owner" };
  const document = { buttons: { owner }, popoutUnits: {
    controls: { id: "controls", kind: "tool-set", ownerButtonId: "owner", fields: [{ kind: "display" }, { kind: "number", disabled: true }] }
  } };
  const h = inputsHarness(document);
  assert.equal(await h.hasEditableButtonInputs(owner), false);
  owner.sourceIdentity.displayFileName = "future-input-toolset.flowcell-source.json";
  const child = { role: "tool-set-child", toolSetParentId: "owner", sourceIdentity: null };
  assert.equal(await h.hasEditableButtonInputs(child), true);
  await h.editButtonInputs(child);
  assert.equal(h.calls.at(-1).args.fileName, "future-input-toolset.flowcell-source.json");
  assert.equal(h.calls.at(-1).args.editInputs, true);
});
