import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {
  aggregateProgramPopoutThemeScreenRange,
  isProgramPopoutThemeWindowRange,
  programPopoutThemeWindowRange,
  programPopoutThemeProgramKey
} from "./.compiled-button-system/button/windows/programPopoutThemeScreenRange.js";

const monitor = { Left: 1920, Top: -300, Width: 2560, Height: 1400 };
const geometry = {
  visibleBounds: { Top: 50, Height: 500 },
  envelope: { y: -20, height: 250 },
  monitorWorkArea: monitor
};
const placements = [{ y: 0, height: 40 }, { y: 150, height: 60 }];

test("live range uses rendered button centers in physical desktop pixels, including scaling and envelope offsets", () => {
  assert.deepEqual(programPopoutThemeWindowRange(" Blender ", placements, geometry), {
    programName: "blender", monitorKey: "1920,-300,2560,1400", minimumY: 130, maximumY: 450
  });
});

test("collapsed owner excludes hidden children and expands to include them when displayed", () => {
  const collapsed = programPopoutThemeWindowRange("Blender", [{ y: 0, height: 40 }], geometry);
  const expanded = programPopoutThemeWindowRange("Blender", placements, geometry);
  assert.deepEqual(aggregateProgramPopoutThemeScreenRange(collapsed, []), { minimumY: 130, maximumY: 130 });
  assert.deepEqual(aggregateProgramPopoutThemeScreenRange(expanded, []), { minimumY: 130, maximumY: 450 });
});

test("only the same program on the same monitor contributes to shared endpoints", () => {
  const own = programPopoutThemeWindowRange("Blender", placements, geometry);
  const same = { ...own, minimumY: -100, maximumY: 600 };
  const otherProgram = { ...same, programName: "krita", minimumY: -1000, maximumY: 1800 };
  const adjacentMonitor = { ...same, monitorKey: "-640,-300,2560,1400", minimumY: -900, maximumY: 1900 };
  assert.deepEqual(aggregateProgramPopoutThemeScreenRange(own, [same, otherProgram, adjacentMonitor]), {
    minimumY: -100, maximumY: 600
  });
});

test("movement, monitor changes, closure and hidden-window removal recalculate endpoints", () => {
  const own = programPopoutThemeWindowRange("Blender", placements, geometry);
  const peers = new Map([["other-pop", { ...own, minimumY: -50, maximumY: 800 }]]);
  assert.deepEqual(aggregateProgramPopoutThemeScreenRange(own, peers.values()), { minimumY: -50, maximumY: 800 });
  peers.set("other-pop", { ...own, minimumY: 200, maximumY: 600 });
  assert.deepEqual(aggregateProgramPopoutThemeScreenRange(own, peers.values()), { minimumY: 130, maximumY: 600 });
  peers.set("other-pop", { ...own, monitorKey: "0,0,1920,1080", minimumY: 200, maximumY: 900 });
  assert.deepEqual(aggregateProgramPopoutThemeScreenRange(own, peers.values()), { minimumY: 130, maximumY: 450 });
  peers.delete("other-pop");
  assert.deepEqual(aggregateProgramPopoutThemeScreenRange(own, peers.values()), { minimumY: 130, maximumY: 450 });
});

test("empty, malformed and not-yet-initialized geometry does not add range anchors", () => {
  assert.equal(programPopoutThemeWindowRange("Blender", [], geometry), undefined);
  assert.equal(programPopoutThemeWindowRange("Blender", placements, undefined), undefined);
  assert.equal(programPopoutThemeWindowRange("Blender", placements, { ...geometry, envelope: { y: 0, height: 0 } }), undefined);
  assert.equal(programPopoutThemeWindowRange("Blender", [{ y: NaN, height: 20 }], geometry), undefined);
  assert.equal(isProgramPopoutThemeWindowRange({ programName: "blender", monitorKey: "m", minimumY: 20, maximumY: 10 }), false);
  assert.equal(isProgramPopoutThemeWindowRange(null), false);
  assert.equal(aggregateProgramPopoutThemeScreenRange(undefined, []), undefined);
});

function liveWindows() {
  const listeners = new Map();
  const windows = new Map();
  const metrics = { scans: 0, visibilityQueries: 0, broadcasts: 0 };
  const emit = async (event, payload) => {
    metrics.broadcasts += 1;
    for (const listener of [...(listeners.get(event) ?? [])]) listener({ payload });
  };
  const source = ts.transpileModule(readFileSync(new URL("../src/button/windows/useProgramPopoutThemeScreenRange.ts", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  function mount(label, initialArgs) {
    const slots = [];
    const pendingEffects = [];
    const timers = new Map();
    const browserEvents = new Map();
    let cursor = 0;
    let dirty = false;
    let nextTimer = 0;
    const handle = {
      label, visible: true, minimized: false,
      isVisible: async () => { metrics.visibilityQueries += 1; return handle.visible; },
      isMinimized: async () => { metrics.visibilityQueries += 1; return handle.minimized; }
    };
    windows.set(label, handle);
    const react = {
      useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
      useState(value) {
        const index = cursor++;
        slots[index] ??= { value };
        return [slots[index].value, (next) => {
          const result = typeof next === "function" ? next(slots[index].value) : next;
          if (result !== slots[index].value) { slots[index].value = result; dirty = true; }
        }];
      },
      useEffect(callback, deps) {
        const index = cursor++;
        const previous = slots[index];
        if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
        slots[index] = { deps, cleanup: previous?.cleanup };
        pendingEffects.push(() => {
          slots[index].cleanup?.();
          slots[index].cleanup = callback();
        });
      }
    };
    const browser = {
      setInterval(callback) { const id = ++nextTimer; timers.set(id, { callback, repeat: true }); return id; },
      clearInterval(id) { timers.delete(id); },
      setTimeout(callback) { const id = ++nextTimer; timers.set(id, { callback, repeat: false }); return id; },
      clearTimeout(id) { timers.delete(id); },
      addEventListener(event, callback) { browserEvents.set(event, callback); },
      removeEventListener(event) { browserEvents.delete(event); }
    };
    browser.document = browser;
    const exports = {};
    vm.runInNewContext(source, {
      exports, window: browser,
      require(name) {
        if (name === "react") return react;
        if (name === "@tauri-apps/api/event") return {
          emit, emitTo: (_label, event, payload) => emit(event, payload),
          listen: async (event, callback) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(callback);
            return () => listeners.get(event).delete(callback);
          }
        };
        if (name === "@tauri-apps/api/window") return {
          getCurrentWindow: () => handle,
          getAllWindows: async () => { metrics.scans += 1; return [...windows.values()]; }
        };
        if (name.includes("safeTauriUnlisten")) return { makeSafeTauriUnlisten: (stop) => stop };
        if (name.includes("programPopoutThemeScreenRange")) return {
          aggregateProgramPopoutThemeScreenRange, isProgramPopoutThemeWindowRange,
          programPopoutThemeProgramKey, programPopoutThemeWindowRange
        };
        throw new Error(name);
      }
    });
    const instance = {
      handle, args: initialArgs, value: undefined,
      render(args = instance.args) {
        instance.args = args; cursor = 0; dirty = false;
        instance.value = exports.useProgramPopoutThemeScreenRange(args);
        pendingEffects.splice(0).forEach((effect) => effect());
        return instance.value;
      },
      async flush() {
        for (let turn = 0; turn < 12; turn += 1) {
          await Promise.resolve();
          if (dirty) instance.render();
        }
      },
      async tick(repeat = false) {
        for (const [id, timer] of [...timers]) {
          if (timer.repeat !== repeat) continue;
          if (!repeat) timers.delete(id);
          timer.callback();
        }
        await instance.flush();
      },
      close() {
        slots.forEach((slot) => slot?.cleanup?.());
        windows.delete(label);
      }
    };
    instance.render();
    return instance;
  }
  return { mount, emit, metrics, windows };
}

test("live windows join, move, hide and close without rescanning when only palette values change", async () => {
  const runtime = liveWindows();
  const args = { enabled: true, programName: "Blender", placements, geometry };
  const first = runtime.mount("button-popout-first", args);
  await first.flush();
  await first.tick();
  const second = runtime.mount("button-fan-second", {
    ...args, geometry: { ...geometry, visibleBounds: { Top: 600, Height: 500 } }
  });
  await second.flush();
  await first.flush();
  await second.tick();
  assert.deepEqual(first.render(), { minimumY: 130, maximumY: 1000 });
  assert.deepEqual(second.render(), { minimumY: 130, maximumY: 1000 });
  const beforePalette = { ...runtime.metrics };
  first.render({ ...args });
  await first.flush();
  assert.deepEqual(runtime.metrics, beforePalette, "same geometry and enabled mode require no native work or events");

  second.render({ ...second.args, geometry: { ...geometry, visibleBounds: { Top: 800, Height: 500 } } });
  await first.flush();
  assert.deepEqual(first.render(), { minimumY: 130, maximumY: 1200 });
  second.handle.visible = false;
  await second.tick(true);
  await first.flush();
  assert.deepEqual(first.render(), { minimumY: 130, maximumY: 450 });
  second.handle.visible = true;
  await second.tick(true);
  await first.flush();
  assert.deepEqual(first.render(), { minimumY: 130, maximumY: 1200 });

  // Simulate destruction without JavaScript teardown; the native event removes it.
  runtime.windows.delete(second.handle.label);
  await runtime.emit("tauri://destroyed", null);
  await first.tick();
  assert.deepEqual(first.render(), { minimumY: 130, maximumY: 450 });
  second.close();
  first.close();
});
