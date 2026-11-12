import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as motion from "./.compiled-button-system/button/fan/buttonFanMotion.js";

const source = readFileSync(new URL("../src/button/fan/useButtonFanMotion.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function createHarness({ reducedMotion = false } = {}) {
  const slots = [], effects = [];
  let cursor = 0;
  function effect(effect, dependencies) {
    const index = cursor++, previous = slots[index];
    if (previous && dependencies.every((value, key) => Object.is(value, previous.dependencies[key]))) return;
    previous?.cleanup?.();
    const slot = slots[index] = { dependencies };
    effects.push(() => { slot.cleanup = effect(); });
  }
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useLayoutEffect: effect, useEffect: effect
  };
  const exports = {};
  runInNewContext(javascript, {
    exports, queueMicrotask,
    require(name) {
      if (name === "react") return react;
      if (name === "./buttonFanMotion") return motion;
      throw new Error(`Unexpected import: ${name}`);
    },
    CSS: { supports: (_property, value) => value !== "invalid-easing" },
    window: {
      matchMedia: () => ({ matches: reducedMotion }),
      getComputedStyle: (wrapper) => wrapper.computed ?? {
        transform: wrapper.style.transform ?? "none", opacity: wrapper.style.opacity ?? "1"
      }
    }
  });
  const placements = [
    { id: "owner", x: 150, y: 90, width: 80, height: 40 },
    { id: "first", x: 0, y: 0, width: 80, height: 40 },
    { id: "second", x: 300, y: 180, width: 100, height: 50 }
  ];
  const wrappers = placements.map((placement) => ({
    dataset: { buttonPlacementId: placement.id }, attributes: new Map(), animations: [],
    style: { removeProperty(name) { delete this[name.replace(/-([a-z])/g, (_m, letter) => letter.toUpperCase())]; } },
    toggleAttribute(name, value) { if (value) this.attributes.set(name, ""); else this.attributes.delete(name); },
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
    animate(keyframes, options) {
      const { promise, resolve, reject } = Promise.withResolvers();
      const animation = {
        keyframes, options, finished: promise, cancelled: false, finish: resolve,
        cancel() { this.cancelled = true; reject(new Error("cancelled")); }
      };
      this.animations.push(animation);
      return animation;
    }
  }));
  const completed = [];
  const args = {
    surfaceRootRef: { current: { querySelectorAll: () => wrappers } },
    document: {
      surfaces: { pop: { placementIds: placements.map((placement) => placement.id) } },
      placements: Object.fromEntries(placements.map((placement) => [placement.id, placement]))
    },
    surfaceId: "pop", ownerPlacementId: "owner", expanded: true, enabled: true,
    animation: { durationMs: 180, staggerMs: 30, easing: "ease-out", spinEnabled: true },
    motionPhase: "opening", motionSequence: 1,
    onMotionComplete: (phase, sequence) => completed.push([phase, sequence])
  };
  return {
    args, wrappers, completed,
    render(patch = {}) {
      Object.assign(args, patch); cursor = 0; exports.useButtonFanMotion(args);
      effects.splice(0).forEach((run) => run());
    },
    unmount() { slots.forEach((slot) => slot.cleanup?.()); }
  };
}
const turn = () => new Promise((resolve) => setImmediate(resolve));
async function settle(harness) {
  harness.wrappers.slice(1).forEach((wrapper) => wrapper.animations.at(-1).finish());
  await turn();
}

test("Pop-out Fan keeps owner fixed, animates children and signals close only after all exit animations", async () => {
  const h = createHarness(); h.render();
  const [owner, first, second] = h.wrappers;
  assert.equal(owner.animations.length, 0);
  assert.equal(owner.attributes.has("inert"), false);
  assert.equal(first.attributes.has("inert"), true);
  assert.equal(second.attributes.has("aria-hidden"), true);
  assert.equal(first.animations[0].keyframes[0].transform, "translate(150px, 90px) rotate(-270deg) scale(0.78)");
  assert.equal(first.animations[0].options.duration, 180);
  assert.equal(second.animations[0].options.delay, 30);
  assert.deepEqual(h.completed, []);
  await settle(h);
  assert.deepEqual(h.completed, [["opening", 1]]);
  assert.equal(first.attributes.has("inert"), false);
  assert.equal(first.style.transform, undefined);
  h.render({ motionPhase: "closing", motionSequence: 2 });
  assert.equal(first.attributes.has("inert"), true);
  assert.equal(first.animations.at(-1).options.delay, 30);
  assert.equal(second.animations.at(-1).options.delay, 0);
  first.animations.at(-1).finish(); await turn();
  assert.equal(h.completed.length, 1);
  await settle(h);
  assert.deepEqual(h.completed.at(-1), ["closing", 2]);
  assert.equal(first.style.visibility, "hidden");
  assert.equal(first.attributes.has("inert"), true);
  h.render({ motionPhase: "resting" });
  assert.equal(first.style.visibility, undefined);
  assert.equal(first.attributes.has("inert"), false);
  h.unmount();
});

test("interrupted Fan reverses from live positions and ignores stale completions", async () => {
  const h = createHarness(); h.render();
  const child = h.wrappers[1];
  child.computed = { transform: "matrix(1, 0, 0, 1, 75, 45)", opacity: "0.5" };
  h.render({ motionPhase: "closing", motionSequence: 2 });
  assert.equal(child.animations[0].cancelled, true);
  assert.equal(child.animations[1].keyframes[0].transform, child.computed.transform);
  assert.equal(child.animations[1].keyframes[0].opacity, "0.5");
  assert.equal(child.animations[1].options.delay, 0);
  await turn(); assert.deepEqual(h.completed, []);
  await settle(h); assert.deepEqual(h.completed, [["closing", 2]]);
  h.unmount();
});

test("Fan reopening before host unmount reveals children during opening animation", async () => {
  const h = createHarness(); h.render(); await settle(h);
  h.render({ motionPhase: "closing", motionSequence: 2 }); await settle(h);
  const child = h.wrappers[1];
  assert.equal(child.style.visibility, "hidden");
  h.render({ motionPhase: "opening", motionSequence: 3 });
  assert.equal(child.style.visibility, undefined);
  assert.equal(child.attributes.has("inert"), true);
  await settle(h);
  assert.deepEqual(h.completed.at(-1), ["opening", 3]);
  assert.equal(child.attributes.has("inert"), false);
  h.unmount();
});

test("disabling Fan cancels outstanding motion and restores child input", async () => {
  const h = createHarness(); h.render();
  const child = h.wrappers[1]; h.render({ enabled: false, motionSequence: 2 }); await turn();
  assert.equal(child.animations[0].cancelled, true);
  assert.equal(child.attributes.has("inert"), false);
  assert.equal(child.style.transform, undefined);
  assert.deepEqual(h.completed, [["opening", 2]]);
  h.unmount();
});

test("Fan respects reduced motion and unsupported easing without mutating saved settings", async () => {
  const h = createHarness({ reducedMotion: true }); h.args.animation.easing = "invalid-easing"; h.render();
  const animation = h.wrappers[2].animations[0];
  assert.equal(animation.options.duration, 0);
  assert.equal(animation.options.delay, 0);
  assert.equal(animation.options.easing, "ease-out");
  assert.equal(h.args.animation.easing, "invalid-easing");
  await settle(h); assert.equal(h.wrappers[2].attributes.has("inert"), false); h.unmount();
});

test("native Pop-out Fan shares motion while preserving fields and waiting for exit before geometry collapse", () => {
  const renderer = readFileSync(new URL("../src/button/popout/ButtonPopoutRenderer.tsx", import.meta.url), "utf8");
  const host = readFileSync(new URL("../src/button/popout/ButtonPopoutWindowPage.tsx", import.meta.url), "utf8");
  assert.match(renderer, /useButtonFanMotion\(\{/);
  assert.match(renderer, /animation: unit\.fanAnimation/);
  assert.match(renderer, /fields=\{fields\}/);
  assert.match(renderer, /stateQueryResponse=\{stateQueryResponse\}/);
  const start = host.indexOf('beginFanMotion("closing")');
  const finish = host.indexOf("await motion.completion", start);
  const render = host.indexOf('setRenderedFanMode("collapsed")', finish);
  const geometry = host.indexOf("await applyCollapsedGeometry", render);
  assert.ok(start >= 0 && start < finish && finish < render && render < geometry);
  assert.match(host, /motionMeasurementsFrozenRef\.current && placementId !== savedOwnerPlacement\?\.id/);
  assert.match(host, /fanMotionEnabled && fanMotionPhaseRef\.current === "opening"/);
  assert.match(host, /await applyCollapsedGeometry\(collapsedWindowEnvelope\.resting\);\s*\}\);\s*if \(cancelled\) return;\s*motionMeasurementsFrozenRef\.current = false;/);
});
