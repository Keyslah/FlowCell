import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  afterPendingWindowOpens
} from "./.compiled-button-system/button/windows/pendingWindowOpen.js";

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

test("Main closes every removed managed Button window after an external canonical commit", () => {
  const frontendRoot = join(import.meta.dirname, "..");
  const main = readFileSync(join(frontendRoot, "src", "pages", "main", "MainPage.tsx"), "utf8");
  assert.match(
    main,
    /previousButtonDocumentRef\.current\s*=\s*buttonDocument;[\s\S]{0,180}closeRemovedButtonWindows\(previous, buttonDocument\)/
  );
});
