import assert from "node:assert/strict";
import test from "node:test";
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
