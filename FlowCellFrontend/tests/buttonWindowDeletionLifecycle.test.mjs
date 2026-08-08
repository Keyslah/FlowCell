import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

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
