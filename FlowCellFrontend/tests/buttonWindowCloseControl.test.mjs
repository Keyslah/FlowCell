import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as closeControlHelpers from "./.compiled-button-system/button/windows/buttonWindowCloseControl.js";
import {
  buttonWindowClosePosition,
  closeControlPositionFromOffset,
  closeControlOffsetFromPosition,
  isButtonWindowCloseOffset,
  createButtonWindowCloseHover
} from "./.compiled-button-system/button/windows/buttonWindowCloseControl.js";

function fixture(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const visibility = [];
  const hoverEvents = [];
  const control = createButtonWindowCloseHover({
    onVisible: (value) => visibility.push(value),
    onHover: (value) => hoverEvents.push(value)
  });
  return { control, visibility, hoverEvents, tick: (ms) => t.mock.timers.tick(ms) };
}

test("X needs three seconds on the same button; leaving or changing buttons resets the delay", (t) => {
  const { control, visibility, tick } = fixture(t);
  const a = {}, b = {};
  control.buttonTarget(a);
  tick(2999);
  assert.deepEqual(visibility, []);
  control.buttonTarget(b);
  tick(2999);
  assert.deepEqual(visibility, []);
  control.buttonTarget(null);
  tick(4000);
  assert.deepEqual(visibility, []);
  control.buttonTarget(a);
  tick(2999);
  control.buttonTarget(a); // Native snapshots must not restart the dwell.
  tick(1);
  assert.deepEqual(visibility, [true]);
});

test("X stays reachable across the gap and keeps hover-open groups alive", (t) => {
  const { control, visibility, hoverEvents, tick } = fixture(t);
  control.hover(true);
  control.buttonTarget({});
  tick(3000);
  control.buttonTarget(null);
  control.hover(false);
  tick(750);
  assert.deepEqual(hoverEvents, [true]);
  control.hover(true); // Pointer reached the X.
  tick(1500);
  assert.deepEqual(visibility, [true]);
  control.hover(false);
  tick(1000);
  assert.deepEqual(visibility, [true, false]);
  assert.deepEqual(hoverEvents, [true, true, false]);
});

test("ordinary hover-out is immediate before X appears; reset cancels pending timers", (t) => {
  const { control, visibility, hoverEvents, tick } = fixture(t);
  control.buttonTarget({});
  control.hover(false);
  tick(3000);
  assert.deepEqual(visibility, []);
  assert.deepEqual(hoverEvents, [false]);
  control.buttonTarget({});
  tick(1000);
  control.reset();
  tick(3000);
  assert.deepEqual(visibility, [false]);
  control.buttonTarget({});
  tick(3000);
  control.hover(false);
  control.reset();
  tick(3000);
  assert.deepEqual(hoverEvents, [false]);
});

test("X is beside the group and remains within the viewport at its edges", () => {
  const viewport = { width: 1000, height: 700 };
  assert.deepEqual(buttonWindowClosePosition({ left: 100, top: 100, width: 200, height: 100 }, viewport), { left: 310, top: 100 });
  assert.deepEqual(buttonWindowClosePosition({ left: 800, top: 100, width: 200, height: 100 }, viewport), { left: 734, top: 100 });
  for (const ratio of [1, 1.05, 1.575]) {
    const cssViewport = { width: 1000 / ratio, height: 700 / ratio };
    const result = buttonWindowClosePosition({ left: 0, top: 650 / ratio, width: 1000 / ratio, height: 50 / ratio }, cssViewport);
    assert.ok(result.left >= 10 && result.left + 56 <= cssViewport.width - 10);
    assert.ok(result.top >= 10 && result.top + 56 <= cssViewport.height - 10);
  }
});


test("Close X physical offsets round-trip across WebView scales and follow group movement", () => {
  const offset = { x: -39.375, y: 141.75 };
  for (const ratio of [1, 1.05, 1.575]) {
    const frame = { left: 100, top: 200 };
    const position = closeControlPositionFromOffset(frame, offset, ratio);
    const restored = closeControlOffsetFromPosition(frame, position, ratio);
    assert.ok(Math.abs(restored.x - offset.x) < 1e-9);
    assert.ok(Math.abs(restored.y - offset.y) < 1e-9);
    const moved = closeControlPositionFromOffset({ left: 150, top: 180 }, offset, ratio);
    assert.equal(moved.left - position.left, 50);
    assert.equal(moved.top - position.top, -20);
  }
  assert.equal(isButtonWindowCloseOffset(offset), true);
  for (const invalid of [null, { x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: 0 }, { x: 0, y: 0, extra: 1 }]) assert.equal(isButtonWindowCloseOffset(invalid), false);
});

// Run the real hook and event handlers with only React/native boundaries mocked.
const hookSource = readFileSync(new URL("../src/button/windows/useButtonWindowCloseControl.tsx", import.meta.url), "utf8");
const compiledHook = ts.transpileModule(hookSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
}).outputText;

function closeControlHarness(t, savedOffset) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const slots = [], effects = [], captures = new Set(), offsets = [], errors = [];
  let index = 0, dirty = false, result, closes = 0;
  const react = {
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial;
      return [slots[slot], (value) => {
        const next = typeof value === "function" ? value(slots[slot]) : value;
        if (!Object.is(next, slots[slot])) { slots[slot] = next; dirty = true; }
      }];
    },
    useRef(initial) {
      const slot = index++;
      return slots[slot] ??= { current: initial };
    },
    useEffect(callback, deps) {
      const slot = index++;
      if (!slots[slot] || deps.some((value, i) => !Object.is(value, slots[slot][i]))) {
        slots[slot] = deps;
        effects.push(callback);
      }
    }
  };
  const target = {
    setPointerCapture: (id) => captures.add(id),
    hasPointerCapture: (id) => captures.has(id),
    releasePointerCapture: (id) => captures.delete(id)
  };
  const nativeWindow = { label: "close-regression", close: async () => { closes++; } };
  const exports = {};
  vm.runInNewContext(compiledHook, {
    exports, window: { devicePixelRatio: 1.5, innerWidth: 1000, innerHeight: 700 },
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }) };
      if (name === "@tauri-apps/api/window") return { getCurrentWindow: () => nativeWindow };
      if (name === "../../lib/layoutSnapshots") return {
        readRegisteredLayoutWindow: () => ({ buttonCloseControlOffset: savedOffset }),
        writeRegisteredLayoutWindowCloseOffset: (_label, value) => offsets.push(value && { x: value.x, y: value.y })
      };
      if (name === "./buttonWindowCloseControl") return closeControlHelpers;
      if (name.endsWith(".css")) return {};
      throw new Error(`Unexpected hook dependency: ${name}`);
    }
  });
  const args = {
    enabled: true, spaceDown: true, frame: { left: 100, top: 100, width: 200, height: 100 },
    onHoverChange() {}, onError: (message) => errors.push(message)
  };
  const render = () => {
    do {
      dirty = false;
      index = 0;
      result = exports.useButtonWindowCloseControl(args);
      while (effects.length) effects.shift()();
    } while (dirty);
  };
  render();
  return {
    offsets, errors, captures,
    get closes() { return closes; },
    get position() { return { left: result.control.props.style.left, top: result.control.props.style.top }; },
    event(handler, options = {}) {
      const event = {
        button: 0, pointerId: 1, clientX: 330, clientY: 120, currentTarget: target,
        defaultPrevented: false, propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        ...options
      };
      assert.ok(result.control, "X must be visible for the interaction");
      result.control.props[handler](event);
      render();
      return event;
    },
    releaseSpace() {
      result.onButtonHoverChange({});
      t.mock.timers.tick(3000);
      args.spaceDown = false;
      render();
    }
  };
}

for (const jitter of [0, 2]) {
  test(`Space + click closes X with ${jitter}px pointer jitter and preserves its placement`, (t) => {
    const h = closeControlHarness(t);
    const position = h.position;
    const down = h.event("onPointerDown");
    h.event("onPointerMove", { clientX: 330 + jitter });
    h.event("onPointerUp", { clientX: 330 + jitter });
    h.event("onLostPointerCapture", { clientX: 330 + jitter });
    assert.deepEqual(h.position, position);
    assert.deepEqual(h.offsets, [undefined], "a click must not replace automatic placement with a saved offset");
    assert.equal(down.propagationStopped, true, "X press cannot start dragging its containing window");
    h.event("onClick");
    assert.equal(h.closes, 1);
    assert.equal(h.captures.size, 0);
    assert.deepEqual(h.errors, []);
  });
}

test("Space drag moves only X, suppresses close after returning to its start, and permits a fresh click", (t) => {
  const h = closeControlHarness(t, { x: 315, y: 0 });
  const position = h.position;
  h.event("onPointerDown");
  h.event("onPointerMove", { clientX: 334 });
  assert.equal(h.position.left, position.left + 4);
  assert.deepEqual(h.offsets.at(-1), { x: 321, y: 0 }, "drag offsets retain physical-pixel scaling");
  h.event("onPointerMove");
  h.event("onPointerUp");
  h.event("onLostPointerCapture");
  h.event("onClick");
  assert.equal(h.closes, 0, "a drag remains a drag even when ending at its starting position");
  h.event("onPointerDown");
  h.event("onPointerUp");
  h.event("onClick");
  assert.equal(h.closes, 1);
});

for (const cancellation of ["onPointerCancel", "onLostPointerCapture"]) {
  test(`${cancellation} restores X placement and cannot close the window`, (t) => {
    const saved = { x: 315, y: 30 };
    const h = closeControlHarness(t, saved);
    const position = h.position;
    h.event("onPointerDown");
    h.event("onPointerMove", { clientX: 350, clientY: 140 });
    h.event(cancellation, { clientX: 350, clientY: 140 });
    h.event("onClick");
    assert.deepEqual(h.position, position);
    assert.deepEqual(h.offsets.at(-1), saved);
    assert.equal(h.closes, 0);
  });
}

test("a normal click still closes X after Space is released", (t) => {
  const h = closeControlHarness(t);
  h.releaseSpace();
  h.event("onPointerDown");
  h.event("onPointerUp");
  h.event("onClick");
  assert.equal(h.closes, 1);
  assert.deepEqual(h.offsets, [undefined]);
});

test("focused X prevents Space keyboard activation without closing", (t) => {
  const h = closeControlHarness(t);
  assert.equal(h.event("onKeyDown", { code: "Space" }).defaultPrevented, true);
  assert.equal(h.event("onKeyUp", { code: "Space" }).defaultPrevented, true);
  assert.equal(h.closes, 0);
});
