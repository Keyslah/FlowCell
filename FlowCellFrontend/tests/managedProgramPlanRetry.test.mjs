import assert from "node:assert/strict";
import test from "node:test";
import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { applyManagedProgramPlan } from "./.compiled-button-system/pages/program-setup/applyManagedProgramPlan.js";
import { decodeProgramAppearance, encodeProgramDefaultTheme, requireNewProgramAppearance } from "./.compiled-button-system/pages/program-setup/programDefaultTheme.js";
import { mergeLegacyInstallsIntoDocument } from "./.compiled-button-system/button/state/ButtonStateRepository.js";
import { createButtonSourceIdentity } from "./.compiled-button-system/button/state/sourceIdentity.js";
import { serializeButtonSkinSections } from "./.compiled-button-system/button/skins/buttonSkinFormat.js";
import { capturePortableTheme } from "./.compiled-button-system/theme/portableTheme.js";
import { preparePortableThemeImport } from "./.compiled-button-system/theme/portableThemeService.js";

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

function appearanceFixture(owner = "donor") {
  const installed = mergeLegacyInstallsIntoDocument(createButtonStateDocument(), [{
    ownerButtonId: owner, sourceIdentity: createButtonSourceIdentity("Example", "Tools", `${owner}.flowcell-source.json`),
    label: "Tools", tooltip: "", executionTarget: null,
    children: [{ slot: "run", label: "Run", executionTarget: {
      kind: "tool-set-action", programName: "Example", panelName: "Tools", ownerFileName: `${owner}.flowcell-source.json`, command: "run"
    } }], layout: {}
  }]);
  const descriptor = { ownerButtonId: owner, programName: "Example", programId: "example", panelName: "Tools",
    sourceId: "example.tool", sourceVersion: "1.0.0", sourceName: "tool.py", importKind: "tool-set", slots: ["run"] };
  return { installed, descriptor };
}

test("packaged Program appearance losslessly interns skins and numbered variant sources", () => {
  const { installed, descriptor } = appearanceFixture();
  const skin = installed.skins[installed.settings.defaultSkinId];
  skin.metadata.buttonSkinEmbeddedVariants = { 3: serializeButtonSkinSections(skin), 8: serializeButtonSkinSections(skin) };
  for (const placement of Object.values(installed.placements)) placement.skinOverrideId = skin.id;
  const theme = capturePortableTheme({ document: installed, target: { kind: "program", programName: "Example", panelName: null },
    descriptors: [descriptor], name: "Exact donor", id: "preset", savedAt: "2026-11-12T00:00:00.000Z" });
  const packed = encodeProgramDefaultTheme(theme);
  assert.equal(packed.kind, "FlowCellProgramAppearance");
  assert.deepEqual(decodeProgramAppearance(JSON.parse(JSON.stringify(packed))), theme);
  const values = Object.values(packed.skinSources);
  assert.equal(values.length, new Set(values).size, "every literal section/family source is stored once");
  assert.ok(theme.theme.buttons.length > Object.keys(packed.skins).length, "identical assigned skins are shared");
  const corrupt = structuredClone(packed);
  corrupt.theme.theme.buttons[0].skin = "missing";
  assert.throws(() => decodeProgramAppearance(corrupt), /missing skin/);
  const missingSource = structuredClone(packed);
  delete missingSource.skinSources[Object.values(missingSource.skins)[0].structure];
  assert.throws(() => decodeProgramAppearance(missingSource), /missing skin source/);
});

test("setup prepares complete packaged presentation without a second commit or installing sources", async () => {
  const { installed: donor, descriptor } = appearanceFixture();
  const unit = Object.values(donor.popoutUnits)[0];
  donor.placements[unit.childPlacementIds[0]].textOffsetX = 19;
  const target = { kind: "program", programName: "Example", panelName: null };
  const theme = capturePortableTheme({ document: donor, target, descriptors: [descriptor], name: "Exact donor" });
  const { installed: recipient, descriptor: recipientDescriptor } = appearanceFixture("recipient");
  const before = JSON.stringify(recipient);
  const prepared = await preparePortableThemeImport({ document: recipient, theme, target,
    descriptors: [recipientDescriptor], allowSourceInstallation: false });
  assert.equal(JSON.stringify(recipient), before);
  const importedUnit = Object.values(prepared.document.popoutUnits)[0];
  assert.equal(prepared.document.placements[importedUnit.childPlacementIds[0]].textOffsetX, 19);
  assert.equal(prepared.document.revision, recipient.revision);
  await assert.rejects(preparePortableThemeImport({ document: createButtonStateDocument(), theme, target,
    descriptors: [], allowSourceInstallation: false }), /requires installed Buttons/);
});

test("packaged appearance cannot overwrite existing target Program settings", () => {
  const { installed } = appearanceFixture();
  assert.throws(() => requireNewProgramAppearance(installed, "Example"), /already has saved Button settings/);
  assert.doesNotThrow(() => requireNewProgramAppearance(installed, "Blender"));
});

test("setup retries packaged appearance on the latest document and commits it exactly once", async () => {
  const h = harness(2);
  const originalApply = h.operations.apply;
  const receipt = "a".repeat(64);
  h.operations.apply = async (...args) => ({ ...await originalApply(...args), defaultTheme: { donor: true }, defaultThemeReceipt: receipt });
  const seen = [];
  h.operations.theme = async (next) => { seen.push(next.revision); next.settings.defaultMinimumFontSize = 13; return next; };
  await applyManagedProgramPlan({ ...request, applyDefaultTheme: true }, h.operations);
  assert.deepEqual(seen, [0, 1, 2]);
  assert.equal(h.document().settings.defaultMinimumFontSize, 13);
  for (const owner of h.prepared.at(-1)) assert.equal(h.document().buttons[owner].metadata.programDefaultAppearanceReceipt, receipt);
  assert.deepEqual(h.counts(), { applies: 1, commits: 3, finalizes: 1, rollbacks: 0 });
});

test("setup fails before canonical Save when its requested packaged appearance is missing", async () => {
  const h = harness(0);
  await assert.rejects(applyManagedProgramPlan({ ...request, applyDefaultTheme: true }, h.operations), /did not return its requested packaged appearance/);
  assert.deepEqual(h.counts(), { applies: 1, commits: 0, finalizes: 0, rollbacks: 1 });
});

test("a failed packaged appearance never writes its atomic recovery receipt", async () => {
  const h = harness(0);
  const originalApply = h.operations.apply;
  h.operations.apply = async (...args) => ({ ...await originalApply(...args), defaultTheme: { donor: true }, defaultThemeReceipt: "a".repeat(64) });
  h.operations.theme = async () => { throw Error("Missing preset dependency"); };
  await assert.rejects(applyManagedProgramPlan({ ...request, applyDefaultTheme: true }, h.operations), /Missing preset dependency/);
  assert.deepEqual(h.counts(), { applies: 1, commits: 0, finalizes: 0, rollbacks: 1 });
  assert.ok(Object.values(h.document().buttons).every((button) => !button.metadata.programDefaultAppearanceReceipt));
});

test("setup refuses to save packaged appearance without its native recovery receipt", async () => {
  const h = harness(0);
  const originalApply = h.operations.apply;
  h.operations.apply = async (...args) => ({ ...await originalApply(...args), defaultTheme: { donor: true } });
  h.operations.theme = async (next) => next;
  await assert.rejects(applyManagedProgramPlan({ ...request, applyDefaultTheme: true }, h.operations), /invalid packaged appearance receipt/);
  assert.deepEqual(h.counts(), { applies: 1, commits: 0, finalizes: 0, rollbacks: 1 });
});
