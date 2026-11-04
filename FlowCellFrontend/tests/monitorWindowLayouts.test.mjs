import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (name) => readFileSync(path.join(root, "src", name), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const compile = (value) => ts.transpileModule(value, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const geometry = { exports: {} };
vm.runInNewContext(compile(source("button/windows/buttonWindowGeometry.ts")), geometry);
const monitor = (name, left = 0, scaleFactor = 1) => ({
  name, scaleFactor, position: { x: left, y: 0 }, size: { width: 1920, height: 1080 },
  workArea: { position: { x: left, y: 0 }, size: { width: 1920, height: 1040 } }
});
const area = { Left: 0, Top: 0, Width: 1920, Height: 1040 };
const pop = (Left, Top = 50, Width = 300, Height = 150) => ({
  kind: "button-popout", bounds: { Left, Top, Width, Height }, collapsedOrigin: { x: Left + 20, y: Top + 10 }
});

function loadMonitorModule(options = {}) {
  const storage = options.storage ?? new Map();
  const runtime = {
    monitors: [monitor("A")], listener: null, windows: [], timers: new Map(), emitted: [], error: null, errors: [], now: 0,
    status: { namespace: options.namespace ?? "installed:fixture", processId: options.processId ?? 101, busy: false, transition: null }
  };
  const sandbox = {
    exports: {}, structuredClone, console: { error: (...args) => runtime.errors.push(args) },
    Date: class extends Date { static now() { return runtime.now; } },
    window: {
      localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
      setTimeout: (callback) => { const id = runtime.timers.size + 1; runtime.timers.set(id, callback); return id; },
      clearTimeout: (id) => runtime.timers.delete(id)
    },
    require: (name) => {
      if (name.includes("buttonWindowGeometry")) return geometry.exports;
      if (name.endsWith("/core")) return { invoke: async () => {
        if (runtime.nextStatusWait) { const wait = runtime.nextStatusWait; runtime.nextStatusWait = null; await wait; }
        if (runtime.error) throw runtime.error;
        return runtime.status;
      } };
      if (name.endsWith("/event")) return { listen: async (_name, callback) => { runtime.listener = callback; return () => {}; }, emitTo: async (...args) => runtime.emitted.push(args) };
      if (name.endsWith("/webviewWindow")) return { WebviewWindow: { getAll: async () => runtime.windows } };
      if (name.endsWith("/window")) return { availableMonitors: async () => {
        if (runtime.nextMonitorWait) { const wait = runtime.nextMonitorWait; runtime.nextMonitorWait = null; await wait; }
        return runtime.monitors;
      }, getCurrentWindow: () => ({ label: "pop" }) };
      throw new Error(`Unexpected import: ${name}`);
    }
  };
  vm.runInNewContext(compile(source("lib/monitorWindowLayouts.ts")), sandbox);
  return { ...sandbox.exports, storage, runtime, tick: async (now) => {
    runtime.now = now;
    const timers = [...runtime.timers.values()];
    runtime.timers.clear();
    for (const callback of timers) callback();
    await new Promise(setImmediate);
  } };
}

const expectedDisplays = (monitors) => monitors.map(({ position, size }) => ({
  left: position.x, top: position.y, width: size.width, height: size.height
}));
const status = (id = null, phase = "complete", monitors = [], busy = false) => ({
  namespace: "installed:fixture", processId: 101, busy,
  transition: id ? { schemaVersion: 1, id, phase, updatedAtMs: 0, expectedDisplays: expectedDisplays(monitors) } : null
});

test("coordinated 0 -> 3 -> 4 monitor arrival never learns intermediate geometry", () => {
  for (const cachedTarget of [false, true]) {
    const { MonitorButtonLayoutMemory } = loadMonitorModule();
    const four = [0, 1920, 3840, 5760].map((x, index) => monitor(String(index), x));
    const three = four.slice(0, 3);
    const target = pop(cachedTarget ? 6200 : 6500);
    const memory = new MonitorButtonLayoutMemory(cachedTarget ? { final: { pop: target } } : {});
    const areas = four.map((item) => ({ Left: item.position.x, Top: 0, Width: 1920, Height: 1040 }));
    memory.sample("source", { pop: pop(6500) }, areas, 0, status(), four);
    const switching = status("switch", "switching", [], true);
    assert.equal(memory.sample("zero", { pop: pop(100) }, [], 300, switching, []), null);
    assert.equal(memory.sample("three", { pop: pop(100) }, areas.slice(0, 3), 1800, switching, three), null);
    const completed = status("switch", "complete", four);
    assert.equal(memory.sample("three", { pop: pop(100) }, areas.slice(0, 3), 3000, completed, three), null);
    assert.equal(memory.sample("final", { pop: pop(100) }, areas, 4200, completed, four), null);
    const restored = memory.sample("final", { pop: pop(100) }, areas, 5100, completed, four);
    assert.deepEqual(plain(restored.pop), target);
    assert.equal(memory.layouts.zero, undefined);
    assert.equal(memory.layouts.three, undefined);
    assert.equal(memory.layouts.source.pop.bounds.Left, 6500);
  }
});

test("successful rollback restores outgoing geometry even when the topology key never changed", () => {
  const { MonitorButtonLayoutMemory } = loadMonitorModule();
  const memory = new MonitorButtonLayoutMemory();
  const monitors = [monitor("A")];
  memory.sample("source", { pop: pop(500) }, [area], 0, status(), monitors);
  memory.sample("source", { pop: pop(100) }, [area], 300, status("rollback", "switching", [], true), monitors);
  memory.sample("source", { pop: pop(100) }, [area], 600, status("rollback", "complete", monitors), monitors);
  const restored = memory.sample("source", { pop: pop(100) }, [area], 1500, status("rollback", "complete", monitors), monitors);
  assert.equal(restored.pop.bounds.Left, 500);
  assert.equal(memory.layouts.source.pop.bounds.Left, 500);
});

test("a new completed marker gates the target even when its busy phase was missed", () => {
  const { MonitorButtonLayoutMemory } = loadMonitorModule();
  const memory = new MonitorButtonLayoutMemory({ final: { pop: pop(2300) } });
  const one = [monitor("A")];
  const two = [...one, monitor("B", 1920)];
  memory.sample("source", { pop: pop(500) }, [area], 0, status(), one);
  const completed = status("quick", "complete", two);
  assert.equal(memory.sample("intermediate", { pop: pop(100) }, [area], 300, completed, one), null);
  assert.equal(memory.sample("intermediate", { pop: pop(100) }, [area], 2400, completed, one), null);
  memory.sample("final", { pop: pop(100) }, [area], 2700, completed, two);
  assert.equal(memory.sample("final", { pop: pop(100) }, [area], 3600, completed, two).pop.bounds.Left, 2300);
  assert.equal(memory.layouts.intermediate, undefined);
});

test("startup during a switch preserves target cache; idle completed markers do not constrain later manual changes", () => {
  const { MonitorButtonLayoutMemory } = loadMonitorModule();
  const one = [monitor("A")];
  const two = [...one, monitor("B", 1920)];
  const memory = new MonitorButtonLayoutMemory({ final: { pop: pop(2300) } });
  memory.sample("intermediate", { pop: pop(100) }, [area], 0, status("start", "switching", [], true), one);
  memory.sample("final", { pop: pop(100) }, [area], 1200, status("start", "complete", two), two);
  assert.equal(memory.sample("final", { pop: pop(100) }, [area], 2100, status("start", "complete", two), two).pop.bounds.Left, 2300);
  assert.equal(memory.layouts.intermediate, undefined);
  const idle = new MonitorButtonLayoutMemory();
  const oldComplete = status("old", "complete", one);
  idle.sample("one", { pop: pop(500) }, [area], 0, oldComplete, one);
  idle.sample("manual", { pop: pop(100) }, [area], 300, oldComplete, two);
  assert.ok(idle.sample("manual", { pop: pop(100) }, [area], 1200, oldComplete, two));
  assert.equal(idle.restorationBlocked, false);
});

test("failed or abandoned switching markers cannot overwrite saved layouts, regardless of age", () => {
  const { MonitorButtonLayoutMemory } = loadMonitorModule();
  const monitors = [monitor("A")];
  for (const phase of ["failed", "switching"]) {
    const memory = new MonitorButtonLayoutMemory({ source: { pop: pop(500) } });
    const failed = status("failed", phase, [], false);
    assert.equal(memory.sample("source", { pop: pop(100) }, [area], 0, failed, monitors), null);
    assert.equal(memory.sample("source", { pop: pop(100) }, [area], 60000, failed, monitors), null);
    assert.equal(memory.restorationBlocked, true);
    assert.equal(memory.layouts.source.pop.bounds.Left, 500);
    memory.sample("source", { pop: pop(100) }, [area], 60300, status("recovered", "complete", monitors), monitors);
    assert.equal(memory.sample("source", { pop: pop(100) }, [area], 61200, status("recovered", "complete", monitors), monitors).pop.bounds.Left, 500);
  }
});

test("saved layouts isolate runtimes and live/ACK keys additionally isolate process generations", async () => {
  const storage = new Map();
  const installed = loadMonitorModule({ storage, namespace: "installed:owner", processId: 101 });
  const development = loadMonitorModule({ storage, namespace: "development:repo", processId: 202 });
  const restarted = loadMonitorModule({ storage, namespace: "installed:owner", processId: 303 });
  const installedKeys = installed.monitorLayoutStorageKeys(installed.runtime.status);
  const developmentKeys = development.monitorLayoutStorageKeys(development.runtime.status);
  const restartKeys = restarted.monitorLayoutStorageKeys(restarted.runtime.status);
  installed.publishMonitorButtonGeometry(pop(500));
  development.publishMonitorButtonGeometry(pop(900));
  await new Promise(setImmediate);
  assert.equal(JSON.parse(storage.get(installedKeys.live + "pop")).bounds.Left, 500);
  assert.equal(JSON.parse(storage.get(developmentKeys.live + "pop")).bounds.Left, 900);
  assert.notEqual(installedKeys.saved, developmentKeys.saved);
  assert.equal(installedKeys.saved, restartKeys.saved);
  assert.notEqual(installedKeys.ack, restartKeys.ack);
  restarted.runtime.windows = [{ label: "pop" }];
  const stop = restarted.startMonitorButtonLayoutObserver();
  await new Promise(setImmediate);
  const key = restarted.monitorTopologyKey(restarted.runtime.monitors);
  assert.deepEqual(JSON.parse(storage.get(restartKeys.saved))[key], {}, "stale prior-process publications must not seed the new session");
  stop();
});

test("legacy saved cache copies once into scoped storage without changing the legacy value", async () => {
  const legacyKey = "flowcell.monitor-button-layouts.v1";
  const legacy = JSON.stringify({ final: { pop: pop(2300) } });
  const api = loadMonitorModule({ storage: new Map([[legacyKey, legacy]]) });
  const keys = api.monitorLayoutStorageKeys(api.runtime.status);
  const stop = api.startMonitorButtonLayoutObserver();
  await new Promise(setImmediate);
  assert.equal(JSON.parse(api.storage.get(keys.saved)).final.pop.bounds.Left, 2300);
  assert.equal(api.storage.get(legacyKey), legacy);
  stop();
  api.storage.set(legacyKey, JSON.stringify({ final: { pop: pop(999) } }));
  assert.equal(api.readSavedLayouts(keys.saved).final.pop.bounds.Left, 2300);
});

test("busy transitions and native read errors freeze pending retries and cached geometry", async () => {
  const api = loadMonitorModule();
  const keys = api.monitorLayoutStorageKeys(api.runtime.status);
  api.runtime.windows = [{ label: "pop" }];
  api.storage.set(keys.live + "pop", JSON.stringify(pop(2300)));
  const stop = api.startMonitorButtonLayoutObserver();
  await new Promise(setImmediate);
  api.runtime.monitors = [monitor("B")];
  await api.tick(300);
  await api.tick(1200);
  assert.equal(api.runtime.emitted.length, 1);
  api.runtime.status = status("next", "switching", [], true);
  await api.tick(2100);
  assert.equal(api.runtime.emitted.length, 1);
  const protectedCache = api.storage.get(keys.saved);
  api.storage.set(keys.live + "pop", JSON.stringify(pop(100)));
  api.runtime.error = new Error("Malformed transition marker");
  await api.tick(3000);
  assert.equal(api.storage.get(keys.saved), protectedCache);
  assert.equal(api.runtime.emitted.length, 1);
  assert.equal(api.runtime.errors.length, 1);
  stop();
});

test("topology includes monitor name, physical work area and DPI, independent of enumeration order", () => {
  const { monitorTopologyKey } = loadMonitorModule();
  assert.equal(monitorTopologyKey([monitor("A"), monitor("B", -1920)]), monitorTopologyKey([monitor("B", -1920), monitor("A")]));
  assert.notEqual(monitorTopologyKey([monitor("A")]), monitorTopologyKey([monitor("B")]));
  assert.notEqual(monitorTopologyKey([monitor("A")]), monitorTopologyKey([monitor("A", 0, 1.25)]));
});

test("first visit relocates oversized semantic frames without resizing or losing the collapsed anchor", () => {
  const { fitMonitorButtonGeometry } = loadMonitorModule();
  const value = pop(-2500, -100, 2500, 1500);
  const fitted = plain(fitMonitorButtonGeometry(value, [area]));
  assert.deepEqual(fitted.bounds, { Left: 0, Top: 0, Width: 2500, Height: 1500 });
  assert.deepEqual(fitted.collapsedOrigin, { x: 20, y: 10 });
  assert.equal(value.bounds.Left, -2500);
});

test("stable A-B-A cycle preserves exact straddling geometry and separate user placements", () => {
  const { MonitorButtonLayoutMemory } = loadMonitorModule();
  const memory = new MonitorButtonLayoutMemory();
  const original = pop(-100, 30, 2200, 1100);
  const displaced = pop(700);
  memory.sample("A", { pop: original }, [area], 0);
  memory.sample("temporary", { pop: displaced }, [area], 100);
  memory.sample("B", { pop: displaced }, [area], 400);
  assert.equal(memory.sample("B", { pop: displaced }, [area], 1000), null);
  const firstVisit = plain(memory.sample("B", { pop: displaced }, [area], 1300));
  assert.equal(firstVisit.pop.bounds.Width, 2200);
  assert.equal(firstVisit.pop.bounds.Left, 0);
  assert.equal(memory.layouts.temporary, undefined);
  memory.acknowledge("pop");
  const placementB = pop(400, 200, 500, 250);
  memory.sample("B", { pop: placementB }, [area], 2300);
  memory.sample("A", { pop: displaced }, [area], 2500);
  const returned = memory.sample("A", { pop: displaced }, [area], 3400);
  assert.deepEqual(plain(returned.pop), original, "remembered positions and sizes must not be clamped");
  memory.acknowledge("pop");
  memory.sample("A", { pop: original }, [area], 4400);
  memory.sample("B", { pop: original }, [area], 4500);
  assert.deepEqual(plain(memory.sample("B", { pop: original }, [area], 5400).pop), placementB);
});

test("missing restore acknowledgement protects saved target geometry beyond the settle delay", () => {
  const { MonitorButtonLayoutMemory } = loadMonitorModule();
  const memory = new MonitorButtonLayoutMemory({ B: { pop: pop(300) } });
  memory.sample("A", { pop: pop(2300) }, [area], 0);
  memory.sample("B", { pop: pop(100) }, [area], 100);
  memory.sample("B", { pop: pop(100) }, [area], 1000);
  memory.sample("B", { pop: pop(100) }, [area], 5000);
  assert.equal(memory.layouts.B.pop.bounds.Left, 300);
  memory.acknowledge("pop");
  memory.sample("B", { pop: pop(600) }, [area], 5100);
  assert.equal(memory.layouts.B.pop.bounds.Left, 600);
});

test("restore only includes live canvases and saved samples do not alias mutable state", () => {
  const { MonitorButtonLayoutMemory } = loadMonitorModule();
  const memory = new MonitorButtonLayoutMemory();
  const original = pop(2300);
  memory.sample("A", { pop: original, closed: pop(2500) }, [area], 0);
  original.bounds.Left = 9999;
  memory.sample("B", { pop: pop(100) }, [area], 100);
  const restored = memory.sample("B", { pop: pop(100) }, [area], 1000);
  assert.deepEqual(Object.keys(restored), ["pop"]);
  assert.equal(memory.layouts.A.pop.bounds.Left, 2300);
});

test("restore events deduplicate retries, reject old topologies and guard delayed queued work", async () => {
  const api = loadMonitorModule();
  const key = api.monitorTopologyKey(api.runtime.monitors);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const completed = [];
  let calls = 0;
  await api.listenForMonitorButtonGeometry(async (value, isCurrent) => {
    calls++;
    await gate;
    completed.push([value.bounds.Left, await isCurrent()]);
  });
  const event = (requestId, Left, topologyKey = key) => ({ payload: { requestId, topologyKey, transitionId: null, geometry: pop(Left) } });
  api.runtime.listener(event("100:1", 100));
  api.runtime.listener(event("100:1", 100));
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  api.runtime.listener(event("200:2", 200));
  await new Promise(setImmediate);
  release();
  await new Promise(setImmediate);
  assert.deepEqual(completed, [[100, false], [200, true]]);
  assert.equal(api.storage.get(api.monitorLayoutStorageKeys(api.runtime.status).ack + "pop"), "200:2");
  api.runtime.listener(event("100:1", 100));
  api.runtime.listener(event("300:3", 300, "old-topology"));
  await new Promise(setImmediate);
  assert.equal(calls, 2);
});

test("a queued restore checks the native busy gate again before applying and acknowledging", async () => {
  const api = loadMonitorModule();
  const key = api.monitorTopologyKey(api.runtime.monitors);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let applied = 0;
  await api.listenForMonitorButtonGeometry(async (_value, isCurrent) => {
    await gate;
    if (await isCurrent()) applied++;
  });
  const payload = { requestId: "100:1", topologyKey: key, transitionId: null, geometry: pop(500) };
  api.runtime.listener({ payload });
  await new Promise(setImmediate);
  api.runtime.status = status("next", "switching", [], true);
  release();
  await new Promise(setImmediate);
  assert.equal(applied, 0);
  assert.equal(api.storage.has(api.monitorLayoutStorageKeys(api.runtime.status).ack + "pop"), false);
  api.runtime.listener({ payload });
  await new Promise(setImmediate);
  assert.equal(applied, 0);
});

test("a newer request invalidates an older guard while its native status read is pending", async () => {
  const api = loadMonitorModule();
  const key = api.monitorTopologyKey(api.runtime.monitors);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const guards = [];
  await api.listenForMonitorButtonGeometry(async (value, isCurrent) => {
    if (value.bounds.Left === 100) api.runtime.nextStatusWait = gate;
    guards.push([value.bounds.Left, await isCurrent()]);
  });
  const event = (requestId, left) => ({ payload: { requestId, topologyKey: key, transitionId: null, geometry: pop(left) } });
  api.runtime.listener(event("100:1", 100));
  await new Promise(setImmediate);
  api.runtime.listener(event("200:2", 200));
  await new Promise(setImmediate);
  release();
  await new Promise(setImmediate);
  assert.deepEqual(guards.sort((a, b) => a[0] - b[0]), [[100, false], [200, true]]);
  assert.equal(api.storage.get(api.monitorLayoutStorageKeys(api.runtime.status).ack + "pop"), "200:2");
});

test("listener reads native busy state after delayed monitor enumeration", async () => {
  const api = loadMonitorModule();
  const key = api.monitorTopologyKey(api.runtime.monitors);
  let release;
  api.runtime.nextMonitorWait = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  await api.listenForMonitorButtonGeometry(async () => { calls++; });
  api.runtime.listener({ payload: { requestId: "100:1", topologyKey: key, transitionId: null, geometry: pop(100) } });
  await new Promise(setImmediate);
  api.runtime.status = status("next", "switching", [], true);
  release();
  await new Promise(setImmediate);
  assert.equal(calls, 0);
});

function loadRestoreHandler(kind, { expanded = true, scaleFactor = 1.05 } = {}) {
  const file = kind === "button-popout" ? "button/popout/ButtonPopoutWindowPage.tsx" : "button/fan/ButtonFanWindowPage.tsx";
  const text = source(file);
  const start = text.indexOf("const unlisten = listenForMonitorButtonGeometry(");
  const end = text.indexOf("\n    return () =>", start);
  assert.ok(start >= 0 && end > start);
  const ref = (current = null) => ({ current });
  const savedExpandedEnvelope = { x: -10, y: -5, width: 200, height: 100 };
  const collapsedEnvelope = { resting: { x: -4, y: -6, width: 100, height: 50 } };
  const saved = [];
  const publications = [];
  const applied = [];
  const sandbox = {
    ...geometry.exports, console, savedExpandedEnvelope, collapsedEnvelope,
    collapsedWindowEnvelope: collapsedEnvelope,
    expandedBoundsRef: ref(), expandedContentScaleRef: ref(1), restingEnvelopeFrameRef: ref(),
    collapsedOriginRef: ref(), collapsedBoundsRef: ref(), surfaceOriginRef: ref(),
    appliedCanvasRef: ref(), appliedFrameBoundsRef: ref(),
    appliedEnvelopeRef: ref(expanded ? savedExpandedEnvelope : collapsedEnvelope.resting),
    renderedExpandedRef: ref(expanded), ownerPlacement: { x: 20, y: 10 },
    appliedFanModeRef: ref(expanded ? "expanded" : "collapsed"),
    authoredFan: true, savedOwnerPlacement: { x: 20, y: 10 }, collapsiblePopout: true,
    pinned: true, expanded,
    getCurrentWindow: () => ({ label: "pop" }),
    monitorGeometryBounds: (value) => ({ Left: value.left, Top: value.top, Width: value.width, Height: value.height }),
    listenForMonitorButtonGeometry: (handler) => { sandbox.restore = handler; return Promise.resolve(() => {}); },
    scheduleNativeGeometryTransition: (work) => work(),
    applyCanvasForFrame: async (bounds) => {
      applied.push(plain(bounds));
      const canvas = { scaleFactor, bounds: area };
      sandbox.appliedCanvasRef.current = canvas;
      return canvas;
    },
    commitAppliedEnvelope: async (envelope, contentScale = 1) => {
      sandbox.appliedFrameBoundsRef.current = geometry.exports.resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin({
        surfaceOrigin: sandbox.surfaceOriginRef.current, envelope, contentScale, scaleFactor
      });
    },
    writeRegisteredLayoutWindowSnapshotBounds: (_label, bounds) => saved.push(plain(bounds)),
    publishMonitorButtonGeometry: (value) => publications.push(plain(value)),
    setRuntimeError: (value) => { throw new Error(value); }
  };
  vm.runInNewContext(compile(text.slice(start, end)), sandbox);
  return { sandbox, saved, publications, applied };
}

test("real Pop restore preserves expanded physical size, collapsed owner anchor and pin state at text scaling", async () => {
  for (const expanded of [false, true]) {
    const { sandbox, saved, publications } = loadRestoreHandler("button-popout", { expanded });
    const target = pop(-1600, 100, 800, 400);
    target.collapsedOrigin = { x: -1500, y: 150 };
    await sandbox.restore(target, async () => true);
    assert.deepEqual(plain(sandbox.expandedBoundsRef.current), { left: -1600, top: 100, width: 800, height: 400 });
    assert.deepEqual(plain(sandbox.collapsedOriginRef.current), target.collapsedOrigin);
    assert.equal(sandbox.pinned, true);
    assert.equal(sandbox.expanded, expanded);
    if (expanded) assert.deepEqual(saved[0], target.bounds);
    else assert.deepEqual(saved[0], { Left: -1505, Top: 143, Width: 106, Height: 54 });
    assert.deepEqual(publications.at(-1), target);
  }
});

test("real Fan restore keeps collapsed physical bounds at matching DPI and preserves expanded/pinned state", async () => {
  const { sandbox, saved } = loadRestoreHandler("button-fan");
  const target = { kind: "button-fan", bounds: { Left: -1200, Top: 90, Width: 106, Height: 53 }, collapsedOrigin: { x: -1195.5, y: 96.5 } };
  await sandbox.restore(target, async () => true);
  assert.deepEqual(saved[0], target.bounds);
  assert.deepEqual(plain(sandbox.collapsedBoundsRef.current), { left: -1200, top: 90, width: 106, height: 53 });
  assert.deepEqual(plain(sandbox.surfaceOriginRef.current), { x: -1216.5, y: 86 });
  assert.equal(sandbox.pinned, true);
  assert.equal(sandbox.expanded, true);
});

test("actual queued restore handlers ignore obsolete topology work before moving a canvas", async () => {
  for (const kind of ["button-popout", "button-fan"]) {
    const { sandbox, saved, applied } = loadRestoreHandler(kind);
    await sandbox.restore({ ...pop(300), kind }, async () => false);
    assert.equal(applied.length, 0);
    assert.equal(saved.length, 0);
  }
});
