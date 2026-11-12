import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/pages/program-setup/ProgramHostRestartNotice.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX
} }).outputText;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const setup = (programName = "Blender", restartNotes = "Restart Blender once.") => ({
  programName, status: "ready", message: "Files installed.", restartNotes
});

function mount({ statuses = async () => [setup()], listenerReady } = {}) {
  const effects = [];
  const changes = [];
  let current = null;
  let onSetup;
  let disposed = 0;
  let requests = 0;
  const require = createRequire(import.meta.url);
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, console, require: (id) => {
    if (id === "react") return {
      useState: () => [current, (value) => { current = value; changes.push(value); }],
      useRef: () => ({ current: { focus() {} } }),
      useEffect: (effect) => effects.push(effect)
    };
    if (id === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (id === "@tauri-apps/api/event") return { listen: async (_name, callback) => {
      onSetup = callback;
      if (listenerReady) await listenerReady;
      return () => { disposed += 1; };
    } };
    if (id.endsWith("/programRails")) return {
      PROGRAM_SETUP_COMMITTED_EVENT: "setup-committed",
      listProgramSetupStatuses: () => { requests += 1; return statuses(); }
    };
    if (id.endsWith("/safeTauriUnlisten")) return { makeSafeTauriUnlisten: (dispose) => dispose };
    if (id.endsWith(".css")) return {};
    return require(id);
  } });
  module.exports.default();
  const cleanups = effects.splice(0).map((effect) => effect());
  return {
    changes,
    get requests() { return requests; },
    get disposed() { return disposed; },
    emit: (payload) => onSetup({ payload }),
    unmount: () => cleanups.forEach((cleanup) => cleanup?.()),
    render: () => module.exports.default()
  };
}

test("completed program setup presents its actual restart instructions", async () => {
  const view = mount();
  view.emit({ kind: "program", programName: "blender" });
  await flush();
  assert.equal(view.requests, 1);
  assert.equal(view.changes[0].restartNotes, "Restart Blender once.");
  const dialog = view.render();
  assert.equal(dialog.props.children.props.role, "dialog");
  const button = dialog.props.children.props.children.at(-1);
  button.props.onClick();
  assert.equal(view.changes.at(-1), null);
  assert.equal(view.requests, 1, "dismissing never restarts or invokes a host action");
  view.unmount();
});

test("panel setup and programs without restart instructions do not prompt", async () => {
  const view = mount({ statuses: async () => [setup("Blender", "")] });
  view.emit({ kind: "panel", programName: "Blender" });
  assert.equal(view.requests, 0);
  view.emit({ kind: "program", programName: "Blender" });
  await flush();
  assert.equal(view.changes.length, 0);
  view.unmount();
});

test("older setup responses cannot replace a later completed program notice", async () => {
  const pending = [];
  const view = mount({ statuses: () => new Promise((resolve) => pending.push(resolve)) });
  view.emit({ kind: "program", programName: "Blender" });
  view.emit({ kind: "program", programName: "Fusion 360" });
  pending[1]([setup("Fusion 360", "Restart Fusion 360 once.")]);
  await flush();
  pending[0]([setup()]);
  await flush();
  assert.equal(view.changes.length, 1);
  assert.equal(view.changes[0].programName, "Fusion 360");
  view.unmount();
});

test("closing setup suppresses pending notices and disposes a late listener", async () => {
  let releaseListener;
  let releaseStatus;
  const listenerReady = new Promise((resolve) => { releaseListener = resolve; });
  const view = mount({ listenerReady, statuses: () => new Promise((resolve) => { releaseStatus = resolve; }) });
  view.emit({ kind: "program", programName: "Blender" });
  view.unmount();
  releaseStatus([setup()]);
  releaseListener();
  await flush();
  assert.equal(view.changes.length, 0);
  assert.equal(view.disposed, 1);
});
