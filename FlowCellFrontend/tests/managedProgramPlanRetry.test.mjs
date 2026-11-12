import assert from "node:assert/strict";
import test from "node:test";
import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { applyManagedProgramPlan } from "./.compiled-button-system/pages/program-setup/applyManagedProgramPlan.js";

const conflict = "Button state changed before Save.";
const request = { programName: "Windows", executablePath: "C:/Windows/explorer.exe", createPlainProgram: false,
  selectedPanels: ["Startup"], selectedSources: [] };
const result = { programName: "Windows", status: "ready", message: "Installed.", restartNotes: "" };

function harness(commitErrorCount, commitError = conflict) {
  let document = createButtonStateDocument();
  let commits = 0;
  let applies = 0;
  let finalizes = 0;
  let rollbacks = 0;
  const prepared = [];
  const operations = {
    apply: async () => { applies += 1; return { transactionToken: "setup", programName: "Windows", panels: ["Startup"], descriptors: [] }; },
    load: async () => structuredClone(document),
    prepare: async (token, ids) => { assert.equal(token, "setup"); prepared.push([...ids]); },
    commit: async (next, revision) => {
      commits += 1;
      assert.equal(revision, document.revision);
      if (commits <= commitErrorCount) {
        document.revision += 1;
        document.settings.gridSize = 24;
        throw new Error(commitError);
      }
      document = { ...next, revision: revision + 1 };
      return document;
    },
    finalize: async () => { finalizes += 1; return result; },
    rollback: async () => { rollbacks += 1; return "rolled-back"; },
    statuses: async () => [result],
    notify: async () => {},
    publish: async () => {}
  };
  return { operations, document: () => document,
    counts: () => ({ applies, commits, finalizes, rollbacks }), prepared };
}

test("automatic program setup merges concurrent Main saves into its existing transaction", async () => {
  const h = harness(2);
  assert.deepEqual(await applyManagedProgramPlan(request, h.operations), result);
  assert.deepEqual(h.counts(), { applies: 1, commits: 3, finalizes: 1, rollbacks: 0 });
  assert.equal(h.document().settings.gridSize, 24, "the concurrent saved preference must survive reconciliation");
  assert.ok(Object.values(h.document().buttons).some(button => button.role === "panel-owner" && button.label === "Startup"));
  assert.equal(h.prepared.length, 3);
  assert.deepEqual(h.prepared[0], h.prepared[1]);
  assert.deepEqual(h.prepared[1], h.prepared[2]);
});

test("automatic program setup stops after 3 revision conflicts and rolls back", async () => {
  const h = harness(3);
  await assert.rejects(applyManagedProgramPlan(request, h.operations), /fully rolled back: Button state changed before Save\./);
  assert.deepEqual(h.counts(), { applies: 1, commits: 3, finalizes: 0, rollbacks: 1 });
  assert.equal(h.prepared.length, 3);
});

test("automatic program setup rolls back nonrevision failures without retrying", async () => {
  const h = harness(3, "disk full");
  await assert.rejects(applyManagedProgramPlan(request, h.operations), /fully rolled back: disk full/);
  assert.deepEqual(h.counts(), { applies: 1, commits: 1, finalizes: 0, rollbacks: 1 });
  assert.equal(h.prepared.length, 1);
});
