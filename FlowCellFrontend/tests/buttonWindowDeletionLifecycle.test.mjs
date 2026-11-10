import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

import {
  afterPendingWindowOpens
} from "./.compiled-button-system/button/windows/pendingWindowOpen.js";
import {
  ManagedWindowGenerationRegistry,
  waitForManagedWindowToDisappear
} from "./.compiled-button-system/button/windows/managedWindowLifecycle.js";

test("managed window cleanup waits for the exact pending open before lookup", async () => {
  let releaseOpen;
  const pendingOpen = new Promise((resolve) => {
    releaseOpen = resolve;
  });
  const pendingOpens = new Map([["flowcell-test", pendingOpen]]);
  const operations = [];

  const lookup = afterPendingWindowOpens(
    pendingOpens,
    "flowcell-test",
    async () => {
      operations.push("lookup");
      return null;
    }
  );
  await Promise.resolve();
  assert.deepEqual(operations, []);

  pendingOpens.delete("flowcell-test");
  releaseOpen();
  assert.equal(await lookup, null);
  assert.deepEqual(operations, ["lookup"]);
});

test("managed window cleanup ignores a failed open and remains idempotent when no window exists", async () => {
  const pendingOpens = new Map([
    ["flowcell-test", Promise.reject(new Error("open failed"))]
  ]);
  let lookups = 0;
  const result = await afterPendingWindowOpens(
    pendingOpens,
    "flowcell-test",
    async () => {
      lookups += 1;
      return null;
    }
  );
  assert.equal(result, null);
  assert.equal(lookups, 1);
});

test("managed window close waits beyond the former 750ms race window for actual absence", async () => {
  let elapsed = 0;
  let lookups = 0;
  await waitForManagedWindowToDisappear({
    windowLabel: "flowcell-test",
    lookup: async () => {
      lookups += 1;
      return elapsed <= 1_000 ? {} : null;
    },
    timeoutMs: 5_000,
    pollMs: 25,
    now: () => elapsed,
    delay: async (milliseconds) => {
      elapsed += milliseconds;
    }
  });

  assert.ok(elapsed > 750);
  assert.ok(lookups > 1);
});

test("managed window close fails closed when the label never disappears", async () => {
  let elapsed = 0;
  await assert.rejects(
    waitForManagedWindowToDisappear({
      windowLabel: "flowcell-test",
      lookup: async () => ({}),
      timeoutMs: 100,
      pollMs: 25,
      now: () => elapsed,
      delay: async (milliseconds) => {
        elapsed += milliseconds;
      }
    }),
    /Timed out waiting for FlowCell window "flowcell-test" to close/
  );
  assert.equal(elapsed, 100);
});

test("an old destroyed generation cannot clear a replacement with the same label", () => {
  const generations = new ManagedWindowGenerationRegistry();
  const oldGeneration = generations.begin("flowcell-test");
  const replacementGeneration = generations.begin("flowcell-test");

  assert.equal(generations.clearIfCurrent("flowcell-test", oldGeneration), false);
  assert.equal(generations.current("flowcell-test"), replacementGeneration);
  assert.equal(generations.clearIfCurrent("flowcell-test", replacementGeneration), true);
  assert.equal(generations.current("flowcell-test"), undefined);
});

test("managed Button opens serialize behind close and cleanup follows confirmed absence", () => {
  const frontendRoot = join(import.meta.dirname, "..");
  const windows = readFileSync(
    join(frontendRoot, "src", "button", "windows", "buttonWindows.ts"),
    "utf8"
  );
  assert.match(windows, /const pendingButtonWindowCloses = new Map/);
  assert.match(windows, /const pendingButtonWindowCleanups = new Map/);
  for (const opener of [
    "openButtonEditorWindow",
    "openButtonPopoutWindow",
    "toggleButtonPopoutWindow",
    "openButtonFanWindow"
  ]) {
    const start = windows.indexOf(`export async function ${opener}`);
    const nextExport = windows.indexOf("export async function ", start + 1);
    const source = windows.slice(start, nextExport < 0 ? undefined : nextExport);
    assert.match(
      source,
      /pendingButtonWindowCloses\.get\(windowLabel\) \?\? pendingButtonWindowCleanups\.get\(windowLabel\)/,
      opener
    );
  }
  const closeStart = windows.indexOf("export async function closeManagedButtonWindow");
  const closeEnd = windows.indexOf("async function cleanupFailedNewButtonWindow", closeStart);
  const closeSource = windows.slice(closeStart, closeEnd);
  assert.ok(closeSource.indexOf("await target.close()") < closeSource.indexOf("await waitForManagedWindowToDisappear"));
  assert.ok(
    closeSource.indexOf("await waitForManagedWindowToDisappear") <
      closeSource.indexOf("await cleanupManagedButtonWindowState")
  );
});

test("Main closes every removed managed Button window after an external canonical commit", () => {
  const frontendRoot = join(import.meta.dirname, "..");
  const main = readFileSync(join(frontendRoot, "src", "pages", "main", "MainPage.tsx"), "utf8");
  assert.match(
    main,
    /previousButtonDocumentRef\.current\s*=\s*buttonDocument;[\s\S]{0,180}closeRemovedButtonWindows\(previous, buttonDocument\)/
  );
});

function panelDeletionHarness({ failAt, finalizeGate, confirmed = true, notifyFailure = false } = {}) {
  const source = readFileSync(new URL("../src/pages/main/MainPage.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("MainPage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "MainPage");
  const declarations = component.body.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]);
  const handler = declarations.find(node => node.name.getText(parsed) === "handleDeletePanelContextMenuButton").initializer;
  const events = [], notifications = [], alerts = [], errors = [];
  let panels = ["Files", "FlowCell QA Refresh", "Utility"], selectedPanel = "Files";
  const step = name => { events.push(name); if (failAt === name) throw new Error(`${name} failure`); };
  const env = {
    contextMenuButton: { actionId: "select-panel-folder", folderName: "FlowCell QA Refresh" },
    selectedProgramName: "Blender", selectedPanelName: "Files", closeContextMenu() {},
    window: { confirm: () => confirmed, alert: message => alerts.push(message) },
    console: { error: (...args) => errors.push(args) }, formatErrorMessage: error => error.message,
    loadButtonStateDocument: async () => ({ revision: 1 }),
    collectCanonicalRenameButtonIds: () => ["qa-panel-owner"],
    preparePanelDeletion: async () => { step("prepare"); return "qa-deletion-token"; },
    commitButtonDocumentMutation: async mutate => { step("canonical"); mutate({}); return { revision: 2 }; },
    removePanelButtonDocumentScope: () => ({ changed: true }),
    rollbackPanelDeletion: async () => step("rollback"),
    finalizePanelDeletion: async token => {
      assert.equal(token, "qa-deletion-token"); step("finalize-start");
      if (finalizeGate) await finalizeGate;
      step("finalize-complete");
    },
    emitProgramSetupCommitted: async payload => {
      events.push("notify"); notifications.push(payload);
      if (notifyFailure) throw new Error("event delivery failure");
    },
    closeRemovedButtonWindows: async () => step("close-removed"),
    listPanelFolders: async () => ["Files", "Utility"],
    areFolderNamesEqual: (left, right) => left.toLowerCase() === right.toLowerCase(),
    resolveFolderSelection: (names, preferred) => names.includes(preferred) ? preferred : names[0] ?? "",
    setPanelNames: names => { panels = names; }, setSelectedPanelName: name => { selectedPanel = name; },
    preferredSelectedPanelScriptFileNamesRef: { current: null },
    setSelectedPanelScriptFileNames() {}, setPanelScripts() {}
  };
  const compiled = ts.transpileModule(`return (${handler.getText(parsed)});`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = new Function(...Object.keys(env), compiled)(...Object.values(env));
  return { run, events, notifications, alerts, errors, get panels() { return panels; },
    get selectedPanel() { return selectedPanel; } };
}

test("panel deletion notifies open workspaces only after native finalization completes", async () => {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const h = panelDeletionHarness({ finalizeGate: gate });
  const pending = h.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.events, ["prepare", "canonical", "finalize-start"]);
  assert.deepEqual(h.notifications, [], "canonical commit must not publish deletion success early");
  finish(); await pending;
  assert.deepEqual(h.notifications, [{ kind: "panel", programName: "Blender" }],
    "omit the deleted navigation target so Main retains its valid current panel");
  assert.ok(h.events.indexOf("notify") > h.events.indexOf("finalize-complete"));
  assert.deepEqual(h.panels, ["Files", "Utility"]);
  assert.equal(h.selectedPanel, "Files");
  assert.deepEqual(h.alerts, []);
});

test("panel deletion failures preserve rollback/error behavior and never notify success", async () => {
  for (const failAt of ["prepare", "canonical", "finalize-complete"]) {
    const h = panelDeletionHarness({ failAt }); await h.run();
    assert.deepEqual(h.notifications, [], failAt);
    assert.equal(h.events.includes("rollback"), failAt === "canonical", failAt);
    assert.equal(h.alerts.length, 1, failAt);
    assert.match(h.alerts[0], new RegExp(`${failAt} failure`));
    assert.ok(h.panels.includes("FlowCell QA Refresh"));
  }
});

test("cancelled panel deletion performs no transaction or lifecycle notification", async () => {
  const h = panelDeletionHarness({ confirmed: false }); await h.run();
  assert.deepEqual(h.events, []); assert.deepEqual(h.notifications, []); assert.deepEqual(h.alerts, []);
});

test("panel deletion notification failure does not misreport or undo a completed deletion", async () => {
  const h = panelDeletionHarness({ notifyFailure: true }); await h.run();
  assert.equal(h.notifications.length, 1);
  assert.deepEqual(h.alerts, []);
  assert.equal(h.events.includes("rollback"), false);
  assert.deepEqual(h.panels, ["Files", "Utility"]);
  assert.ok(h.errors.some(args => args.some(value => value?.message === "event delivery failure")));
});
