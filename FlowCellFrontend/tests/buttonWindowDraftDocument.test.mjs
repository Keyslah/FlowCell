import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import {
  withCanonicalPanelFanMotion,
  withCanonicalProgramPopoutThemes
} from "./.compiled-button-system/button/windows/buttonWindowThemeDocument.js";
import { withAddedCanonicalPanelButtons } from "./.compiled-button-system/button/state/panelPopoutReconciliation.js";

const source = readFileSync(join(import.meta.dirname, "../src/button/windows/useButtonWindowDocument.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

async function flush() {
  for (let count = 0; count < 12; count += 1) await Promise.resolve();
}

async function createHarness(...sessions) {
  const sessionId = sessions.length ? sessions[0] : "quick-fan-session";
  let state;
  let effect;
  const history = [];
  const handlers = {};
  const loads = [];
  const requests = [];
  const bus = {
    createButtonDraftRequestId: () => "window-request",
    requestButtonDraft: async (...args) => { requests.push(args); },
    subscribeButtonCommits: async (handler) => {
      handlers.commit = handler;
      return () => { delete handlers.commit; };
    },
    subscribeButtonDrafts: async (_session, handler) => {
      handlers.draft = handler;
      return () => { delete handlers.draft; };
    },
    subscribeButtonDraftCancel: async (_session, handler) => {
      handlers.cancel = handler;
      return () => { delete handlers.cancel; };
    }
  };
  const modules = {
    react: {
      useState: (initial) => {
        state = initial;
        return [state, (update) => {
          state = typeof update === "function" ? update(state) : update;
          history.push(state);
        }];
      },
      useEffect: (callback) => { effect = callback; }
    },
    "@tauri-apps/api/window": { getCurrentWindow: () => ({ label: "button-fan-panel" }) },
    "../state/ButtonDraftBus": bus,
    "../state/ButtonStateRepository": {
      loadButtonStateDocument: () => {
        const pending = Promise.withResolvers();
        loads.push(pending);
        return pending.promise;
      }
    },
    "./buttonWindowThemeDocument": { withCanonicalPanelFanMotion, withCanonicalProgramPopoutThemes },
    "../state/panelPopoutReconciliation": { withAddedCanonicalPanelButtons }
  };
  const exports = {};
  new Function("require", "exports", compiled)((name) => {
    assert.ok(modules[name], `unexpected hook dependency ${name}`);
    return modules[name];
  }, exports);
  exports.useButtonWindowDocument(sessionId);
  const dispose = effect();
  await flush();
  return { get state() { return state; }, history, handlers, loads, requests, dispose };
}

function fixture() {
  const canonical = createButtonStateDocument();
  canonical.revision = 4;
  canonical.buttons.panel = {
    id: "panel", role: "panel-owner", metadata: {
      programName: "Blender", panelName: "Files", panelFanMotionStyle: "default"
    }
  };
  canonical.programPopoutThemes = { blender: { colors: ["#123456"] } };
  const draft = structuredClone(canonical);
  draft.fanSetups.transient = {
    id: "transient", programName: "Blender", panelName: "Files", panelOwnerButtonId: "panel",
    fanSurfaceId: "fresh-surface", fanMemberButtonIds: [], fanMemberPlacementIds: [],
    selectedToolSetOwnerButtonIds: [], animation: { durationMs: 420, easing: "linear", staggerMs: 17, spinEnabled: true },
    collapsedPanelOwnerBounds: { left: 321, top: 123, width: 70, height: 44 }
  };
  draft.surfaces["fresh-surface"] = {
    id: "fresh-surface", kind: "fan", width: 360, height: 104, placementIds: ["fresh-owner"]
  };
  draft.placements["fresh-owner"] = {
    id: "fresh-owner", surfaceId: "fresh-surface", buttonId: "panel", x: 8, y: 8, width: 70, height: 44
  };
  draft.programPopoutThemes = { blender: { colors: ["#ABCDEF"] } };
  return { canonical, draft };
}

test("a transient window waits for its draft when canonical state loads first", async (t) => {
  const harness = await createHarness();
  t.after(harness.dispose);
  const { canonical, draft } = fixture();
  harness.loads[0].resolve(canonical);
  await flush();
  assert.equal(harness.state.loading, true);
  assert.equal(harness.state.document, null, "canonical state cannot render a missing transient setup");
  assert.equal(harness.requests.length, 1);
  harness.handlers.draft(draft);
  assert.equal(harness.state.loading, false);
  assert.equal(harness.state.document.fanSetups.transient.animation.spinEnabled, false);
  assert.equal(harness.state.document.programPopoutThemes, canonical.programPopoutThemes);
  assert.equal(harness.state.document.placements, draft.placements);
  assert.ok(harness.history.every((state) => state.loading || state.document?.fanSetups.transient));
});

test("a draft arriving before canonical load keeps its setup and gains canonical rules", async (t) => {
  const harness = await createHarness();
  t.after(harness.dispose);
  const { canonical, draft } = fixture();
  const original = structuredClone(draft);
  harness.handlers.draft(draft);
  assert.equal(harness.state.document, draft);
  harness.loads[0].resolve(canonical);
  await flush();
  assert.equal(harness.state.document.surfaces, draft.surfaces);
  assert.equal(harness.state.document.fanSetups.transient.animation.spinEnabled, false);
  assert.equal(harness.state.document.programPopoutThemes, canonical.programPopoutThemes);
  assert.deepEqual(draft, original, "shared rules must not overwrite the original draft");
});

test("canonical commits retain a transient draft while requesting an updated copy", async (t) => {
  const harness = await createHarness();
  t.after(harness.dispose);
  const { canonical, draft } = fixture();
  harness.loads[0].resolve(canonical);
  await flush();
  harness.handlers.draft(draft);
  const next = structuredClone(canonical);
  next.revision += 1;
  next.buttons.panel.metadata.panelFanMotionStyle = "spin";
  next.programPopoutThemes.blender.colors = ["#556677"];
  const historyStart = harness.history.length;
  await harness.handlers.commit(next);
  assert.equal(harness.requests.length, 2);
  assert.equal(harness.state.document.fanSetups.transient.animation.spinEnabled, true);
  assert.equal(harness.state.document.programPopoutThemes, next.programPopoutThemes);
  assert.equal(harness.state.document.placements, draft.placements);
  assert.deepEqual(harness.state.document.fanSetups.transient.collapsedPanelOwnerBounds,
    draft.fanSetups.transient.collapsedPanelOwnerBounds);
  assert.ok(harness.history.slice(historyStart).every((state) => state.document?.fanSetups.transient),
    "an unrelated commit must never replace the transient window with missing canonical content");
  harness.handlers.draft(draft);
  assert.equal(harness.state.document.programPopoutThemes, next.programPopoutThemes,
    "a stale draft response cannot undo newer canonical rules");
});

test("a canonical commit before the first draft preserves loading and wins a late disk race", async (t) => {
  const harness = await createHarness();
  t.after(harness.dispose);
  const { canonical, draft } = fixture();
  const next = structuredClone(canonical);
  next.revision += 1;
  next.programPopoutThemes.blender.colors = ["#778899"];
  await harness.handlers.commit(next);
  assert.equal(harness.state.loading, true);
  harness.loads[0].resolve(canonical);
  await flush();
  harness.handlers.draft(draft);
  assert.equal(harness.state.document.programPopoutThemes, next.programPopoutThemes);
});

test("explicit draft cancellation reloads canonical state and does not retain transient geometry", async (t) => {
  const harness = await createHarness();
  t.after(harness.dispose);
  const { canonical, draft } = fixture();
  harness.loads[0].resolve(canonical);
  await flush();
  harness.handlers.draft(draft);
  const cancellation = harness.handlers.cancel();
  assert.equal(harness.loads.length, 2);
  const saved = structuredClone(canonical);
  saved.revision += 1;
  harness.loads[1].resolve(saved);
  await cancellation;
  assert.equal(harness.state.document, saved);
  assert.equal(harness.state.document.fanSetups.transient, undefined);
  assert.equal(harness.state.loading, false);
  assert.equal(harness.requests.length, 1, "cancellation must not request the discarded draft");
});

test("windows without a draft render canonical loads and commits directly", async (t) => {
  const harness = await createHarness(undefined);
  t.after(harness.dispose);
  const { canonical } = fixture();
  harness.loads[0].resolve(canonical);
  await flush();
  assert.equal(harness.state.document, canonical);
  const next = structuredClone(canonical);
  next.revision += 1;
  await harness.handlers.commit(next);
  assert.equal(harness.state.document, next);
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.handlers.draft, undefined);
});
