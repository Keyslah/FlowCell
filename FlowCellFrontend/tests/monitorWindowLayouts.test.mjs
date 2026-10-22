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

function loadMonitorModule() {
  const storage = new Map();
  const runtime = { monitors: [monitor("A")], listener: null };
  const sandbox = {
    exports: {}, structuredClone, console,
    window: { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } },
    require: (name) => {
      if (name.includes("buttonWindowGeometry")) return geometry.exports;
      if (name.endsWith("/event")) return { listen: async (_name, callback) => { runtime.listener = callback; return () => {}; }, emitTo: async () => {} };
      if (name.endsWith("/webviewWindow")) return { WebviewWindow: { getAll: async () => [] } };
      if (name.endsWith("/window")) return { availableMonitors: async () => runtime.monitors, getCurrentWindow: () => ({ label: "pop" }) };
      throw new Error(`Unexpected import: ${name}`);
    }
  };
  vm.runInNewContext(compile(source("lib/monitorWindowLayouts.ts")), sandbox);
  return { ...sandbox.exports, storage, runtime };
}

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
  const event = (requestId, Left, topologyKey = key) => ({ payload: { requestId, topologyKey, geometry: pop(Left) } });
  api.runtime.listener(event("100:1", 100));
  api.runtime.listener(event("100:1", 100));
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  api.runtime.listener(event("200:2", 200));
  await new Promise(setImmediate);
  release();
  await new Promise(setImmediate);
  assert.deepEqual(completed, [[100, false], [200, true]]);
  assert.equal(api.storage.get("flowcell.monitor-button-ack.v1:pop"), "200:2");
  api.runtime.listener(event("100:1", 100));
  api.runtime.listener(event("300:3", 300, "old-topology"));
  await new Promise(setImmediate);
  assert.equal(calls, 2);
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
