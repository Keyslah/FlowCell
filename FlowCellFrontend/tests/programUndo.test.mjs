import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as programUndo from "./.compiled-button-system/lib/programUndo.js";

const { installProgramUndoKeys, trackProgramAction, waitForPendingProgramActions } = programUndo;

class Element {
  nodeType = 1;
  shadowRoot = null;

  constructor(tagName = "div", parentElement = null, attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.parentElement = parentElement;
    this.attributes = attributes;
  }

  get isContentEditable() {
    if (Object.hasOwn(this.attributes, "contenteditable")) {
      return this.attributes.contenteditable !== "false";
    }
    return Boolean(this.parentElement?.isContentEditable);
  }

  closest(selector) {
    assert.equal(selector, "input, textarea, select, [data-button-inline-editor]");
    for (let element = this; element; element = element.parentElement) {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) ||
          Object.hasOwn(element.attributes, "data-button-inline-editor")) return element;
    }
    return null;
  }
}

class KeyboardEvent extends Event {
  stopped = false;

  constructor(options = {}) {
    super("keydown", { cancelable: true });
    Object.assign(this, {
      key: "z", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false,
      repeat: false, isComposing: false, keyCode: 0, path: [], ...options
    });
    if (options.prevented) this.preventDefault();
  }

  composedPath() { return this.path; }

  stopImmediatePropagation() {
    this.stopped = true;
    super.stopImmediatePropagation();
  }
}

function harness(installer = installProgramUndoKeys, forwardOverride) {
  const targetWindow = new EventTarget();
  const body = new Element("body");
  targetWindow.document = { activeElement: body, body };
  const forwarded = [];
  const errors = [];
  const dispose = installer(targetWindow, (shortcut) => {
    forwarded.push(shortcut);
    return forwardOverride ? forwardOverride(shortcut) : Promise.resolve();
  }, (error) => errors.push(error));
  return {
    targetWindow, body, forwarded, errors, dispose,
    key(options = {}) {
      const event = new KeyboardEvent(options);
      targetWindow.dispatchEvent(event);
      return event;
    }
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function loadFrontendModule(fileName, invoke) {
  const source = readFileSync(new URL(`../src/lib/${fileName}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, window: { __TAURI_INTERNALS__: {} },
    require: (name) => {
      if (name === "@tauri-apps/api/core") return { invoke };
      if (name === "@tauri-apps/api/event") return { emit: async () => {} };
      if (name === "./programUndo" || name === "./programUndo.js") return programUndo;
      return {};
    }
  });
  return module.exports;
}

test("forwards Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y once and consumes their events", async () => {
  const h = harness();
  let laterHandlers = 0;
  h.targetWindow.addEventListener("keydown", () => laterHandlers++);
  for (const options of [{}, { key: "Z", shiftKey: true }, { key: "y" }]) {
    const event = h.key(options);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.stopped, true);
    await settle();
  }
  assert.deepEqual(h.forwarded, ["undo", "redo-shift-z", "redo-y"]);
  assert.equal(laterHandlers, 0);
  h.dispose();
});

test("ignores other modifiers, shortcuts, repeats, composition and already-handled events", () => {
  const h = harness();
  for (const options of [
    { ctrlKey: false }, { altKey: true }, { metaKey: true },
    { key: "y", shiftKey: true }, { key: "x" }, { key: "Escape" },
    { repeat: true }, { isComposing: true }, { keyCode: 229 }, { prevented: true }
  ]) {
    const event = h.key(options);
    assert.equal(event.defaultPrevented, Boolean(options.prevented), JSON.stringify(options));
    assert.equal(event.stopped, false, JSON.stringify(options));
  }
  assert.deepEqual(h.forwarded, []);
  h.dispose();
});

test("preserves local input, textarea and select undo from focus or composed event path", () => {
  const h = harness();
  for (const tag of ["input", "textarea", "select"]) {
    const editor = new Element(tag, h.body);
    for (const throughFocus of [true, false]) {
      h.targetWindow.document.activeElement = throughFocus ? editor : h.body;
      const event = h.key({ key: "y", path: throughFocus ? [] : [editor, h.body] });
      assert.equal(event.defaultPrevented, false, `${tag} focus=${throughFocus}`);
      assert.equal(event.stopped, false);
    }
  }
  assert.deepEqual(h.forwarded, []);
  h.dispose();
});

test("preserves contenteditable and Button inline editors including descendants", () => {
  const h = harness();
  for (const attributes of [
    { contenteditable: "true" }, { contenteditable: "" }, { contenteditable: "plaintext-only" },
    { "data-button-inline-editor": "true" }
  ]) {
    const editor = new Element("div", h.body, attributes);
    const child = new Element("span", editor);
    h.targetWindow.document.activeElement = child;
    assert.equal(h.key().defaultPrevented, false);
    h.targetWindow.document.activeElement = h.body;
    assert.equal(h.key({ path: [child, editor, h.body] }).defaultPrevented, false);
  }
  assert.deepEqual(h.forwarded, []);
  h.dispose();
});

test("protects shadow editors through composedPath and nested deep active elements", () => {
  const h = harness();
  const outerHost = new Element("button-host", h.body);
  const innerHost = new Element("field-host");
  const input = new Element("input");
  outerHost.shadowRoot = { activeElement: innerHost };
  innerHost.shadowRoot = { activeElement: input };
  h.targetWindow.document.activeElement = outerHost;
  assert.equal(h.key({ path: [outerHost, h.body] }).defaultPrevented, false);
  h.targetWindow.document.activeElement = h.body;
  assert.equal(h.key({ path: [input, innerHost, outerHost, h.body] }).defaultPrevented, false);
  assert.deepEqual(h.forwarded, []);
  h.dispose();
});

test("does not enqueue duplicate shortcuts while forwarding is still pending", async () => {
  let finish;
  const h = harness(installProgramUndoKeys, () => new Promise((resolve) => { finish = resolve; }));
  h.key();
  const duplicate = h.key({ key: "y" });
  assert.deepEqual(h.forwarded, ["undo"]);
  assert.equal(duplicate.defaultPrevented, true);
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0].message, /waiting for the current request/);
  finish();
  await settle();
  h.key({ key: "y" });
  assert.deepEqual(h.forwarded, ["undo", "redo-y"]);
  finish();
  await settle();
  h.dispose();
});

test("reports failures and permits the next shortcut after rejection or synchronous throw", async () => {
  const failure = new Error("The target program is not running.");
  let calls = 0;
  const h = harness(installProgramUndoKeys, () => {
    calls++;
    if (calls === 1) return Promise.reject(failure);
    if (calls === 2) throw failure;
    return Promise.resolve();
  });
  for (let index = 0; index < 3; index++) {
    h.key();
    await settle();
  }
  assert.equal(h.forwarded.length, 3);
  assert.deepEqual(h.errors, [failure, failure]);
  h.dispose();
});

test("cleanup stops handling keys and suppresses late error notifications", async () => {
  let fail;
  const h = harness(installProgramUndoKeys, () => new Promise((resolve, reject) => { fail = reject; }));
  h.key();
  h.dispose();
  const later = h.key({ key: "y" });
  assert.equal(later.defaultPrevented, false);
  assert.deepEqual(h.forwarded, ["undo"]);
  fail(new Error("late failure"));
  await settle();
  assert.deepEqual(h.errors, []);
});

test("the exact installer source works in an isolated realm without imports or outer helpers", async () => {
  const injected = vm.runInNewContext(`(${installProgramUndoKeys.toString()})`);
  const h = harness(injected);
  const input = new Element("input");
  assert.equal(h.key({ path: [input] }).defaultPrevented, false);
  assert.equal(h.key({ key: "Z", shiftKey: true }).defaultPrevented, true);
  await settle();
  assert.deepEqual(h.forwarded, ["redo-shift-z"]);
  h.dispose();
});

test("native forwarding sends the verified program and exact shortcut variant", async () => {
  const calls = [];
  const { forwardProgramUndo } = loadFrontendModule("tauri.ts", async (command, payload) => {
    calls.push({ command, ...payload });
  });
  await forwardProgramUndo("undo", "Blender");
  await forwardProgramUndo("redo-shift-z");
  await forwardProgramUndo("redo-y", "Illustrator");
  assert.deepEqual(calls, [
    { command: "forward_program_undo", programName: "Blender", shortcut: "undo" },
    { command: "forward_program_undo", programName: undefined, shortcut: "redo-shift-z" },
    { command: "forward_program_undo", programName: "Illustrator", shortcut: "redo-y" }
  ]);
});

test("immediate Undo waits for each existing button and toolset dispatch to complete", async () => {
  for (const actionKind of ["script", "event", "toolset"]) {
    const action = deferred();
    const calls = [];
    const invoke = (command) => {
      calls.push(command);
      return command === "forward_program_undo" ? Promise.resolve() : action.promise;
    };
    const rails = loadFrontendModule("programRails.ts", invoke);
    const { forwardProgramUndo } = loadFrontendModule("tauri.ts", invoke);
    const operation = actionKind === "script"
      ? rails.runPanelScript("Blender", "Tools", "align.py")
      : actionKind === "event"
        ? rails.runPanelButtonEvent("Blender", "Tools", "align.py", "click")
        : rails.runToolsetAction({ programName: "Blender", panelName: "Tools", fileName: "align.py", command: "x_center" });
    const undo = forwardProgramUndo("undo", " blender ");
    await settle();
    assert.equal(calls.length, 1, `${actionKind}: Undo must wait while action is pending`);
    assert.notEqual(calls[0], "forward_program_undo");
    action.resolve({ message: "Complete" });
    await Promise.all([operation, undo]);
    assert.equal(calls.at(-1), "forward_program_undo", actionKind);
  }
});

test("failed actions remain visible to their callers and release waiting Undo", async () => {
  const action = deferred();
  const calls = [];
  const invoke = (command) => {
    calls.push(command);
    return command === "forward_program_undo" ? Promise.resolve() : action.promise;
  };
  const rails = loadFrontendModule("programRails.ts", invoke);
  const { forwardProgramUndo } = loadFrontendModule("tauri.ts", invoke);
  const operation = rails.runToolsetAction({ programName: "Blender", panelName: "Tools", fileName: "align.py", command: "x_center" });
  const visibleFailure = assert.rejects(operation, { message: "Align could not run" });
  const undo = forwardProgramUndo("undo", "Blender");
  await settle();
  assert.deepEqual(calls, ["run_toolset_action"]);
  action.reject("Align could not run");
  await Promise.all([visibleFailure, undo]);
  assert.deepEqual(calls, ["run_toolset_action", "forward_program_undo"]);
});

test("program-scoped Undo waits for all earlier actions only in that program", async () => {
  const first = deferred();
  const second = deferred();
  const unrelated = deferred();
  const operations = [
    trackProgramAction("Blender", () => first.promise),
    trackProgramAction("BLENDER", () => second.promise),
    trackProgramAction("Illustrator", () => unrelated.promise)
  ];
  let ready = false;
  const wait = waitForPendingProgramActions("blender").then(() => { ready = true; });
  first.resolve();
  await settle();
  assert.equal(ready, false, "the second earlier Blender action is still pending");
  second.resolve();
  await wait;
  assert.equal(ready, true, "another program's pending action must not delay scoped Undo");
  unrelated.resolve();
  await Promise.all(operations);
});

test("unscoped main-window Undo snapshots earlier actions without blocking future work", async () => {
  const earlier = deferred();
  const future = deferred();
  const operations = [trackProgramAction("Blender", () => earlier.promise)];
  const calls = [];
  const { forwardProgramUndo } = loadFrontendModule("tauri.ts", async (command) => { calls.push(command); });
  const undo = forwardProgramUndo("undo");
  let futureStarted = false;
  operations.push(trackProgramAction("Blender", () => { futureStarted = true; return future.promise; }));
  await settle();
  assert.deepEqual(calls, []);
  assert.equal(futureStarted, true, "waiting Undo must not prevent later actions from starting");
  earlier.resolve();
  await undo;
  assert.deepEqual(calls, ["forward_program_undo"], "future work is outside Undo's captured action set");
  future.resolve();
  await Promise.all(operations);
});
