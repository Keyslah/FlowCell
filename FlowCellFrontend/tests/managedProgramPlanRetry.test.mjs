import assert from "node:assert/strict";
import test from "node:test";
import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { applyManagedProgramPlan } from "./.compiled-button-system/pages/program-setup/applyManagedProgramPlan.js";
import { buildProgramSetupDocument, decodeProgramAppearance, encodeProgramDefaultTheme, requireNewProgramAppearance } from "./.compiled-button-system/pages/program-setup/programDefaultTheme.js";
import { mergeLegacyInstallsIntoDocument, normalizeLegacyInstallResult } from "./.compiled-button-system/button/state/ButtonStateRepository.js";
import { createButtonSourceIdentity } from "./.compiled-button-system/button/state/sourceIdentity.js";
import { serializeButtonSkinSections } from "./.compiled-button-system/button/skins/buttonSkinFormat.js";
import { capturePortableTheme } from "./.compiled-button-system/theme/portableTheme.js";
import { preparePortableThemeImport } from "./.compiled-button-system/theme/portableThemeService.js";
import { reconcileProgramPanelOwners } from "./.compiled-button-system/button/state/panelOwnerButtonOperations.js";
import { validateButtonStateDocument } from "./.compiled-button-system/button/state/buttonStateValidation.js";
import { buildPanelRailOwnerEntries, panelRailOwnerSurfaceBounds } from "./.compiled-button-system/pages/main/mainLayout.js";

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
  const presentation = { programName: "Windows", panels: ["Startup"], descriptors: [], themeDescriptors: [] };
  const operations = {
    preflight: async () => ({ ...presentation, planFingerprint: "f".repeat(64) }),
    apply: async () => { applies += 1; return { transactionToken: "setup", ...presentation }; },
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
  return { operations, presentation, document: () => document,
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

function setupAppearance(h) {
  const donor = createButtonStateDocument();
  reconcileProgramPanelOwners(donor, { programName: "Windows", panels: [{ panelName: "Startup", rect: { x: 8, y: 8, width: 96, height: 44 } }] });
  h.presentation.defaultTheme = capturePortableTheme({ document: donor, descriptors: [],
    target: { kind: "program", programName: "Windows", panelName: null }, name: "Windows setup" });
  h.presentation.defaultThemeReceipt = "a".repeat(64);
}

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

function discoveredPanelScaffold() {
  const document = createButtonStateDocument();
  reconcileProgramPanelOwners(document, { programName: "Blender",
    panels: buildPanelRailOwnerEntries(["Collections", "Files", "Shapes", "Snap", "tools", "toolset", "Utility"]),
    surfaceBounds: panelRailOwnerSurfaceBounds, removeStaleOwners: false });
  return document;
}

test("packaged appearance accepts untouched panel scaffolding from discovery without mutating it", () => {
  const document = discoveredPanelScaffold();
  const before = JSON.stringify(document);
  assert.doesNotThrow(() => requireNewProgramAppearance(document, "Blender"));
  assert.equal(JSON.stringify(document), before);
});

test("panel scaffolding exemption rejects every authored presentation or ownership change", () => {
  const changes = {
    label: (document, owner) => { owner.label = "My Collections"; },
    geometry: (document, owner, placement) => { placement.x += 1; },
    order: (document, owner, placement) => { document.surfaces[placement.surfaceId].placementIds.reverse(); },
    skin: (document, owner, placement) => { document.skins[placement.skinOverrideId].metadata.custom = true; },
    override: (document, owner, placement) => { document.themeOverrides[placement.id] = { custom: true }; },
    receipt: (document, owner) => { owner.metadata.programDefaultAppearanceReceipt = "a".repeat(64); },
    metadata: (document, owner) => { owner.metadata.userPreference = true; },
    disabled: (document, owner) => { owner.disabled = true; },
    fan: (document, owner) => { document.fanSetups.custom = { programName: "Blender", panelOwnerButtonId: owner.id }; },
    surface: (document, owner, placement) => { document.surfaces[placement.surfaceId].height += 1; }
  };
  for (const [name, change] of Object.entries(changes)) {
    const document = discoveredPanelScaffold();
    const owner = Object.values(document.buttons)[0];
    const placement = Object.values(document.placements).find((entry) => entry.buttonId === owner.id);
    change(document, owner, placement);
    assert.throws(() => requireNewProgramAppearance(document, "Blender"), /already has saved Button settings/, name);
  }
});

test("setup retries packaged appearance on the latest document and commits it exactly once", async () => {
  const h = harness(2);
  setupAppearance(h);
  const receipt = "a".repeat(64);
  const seen = [];
  h.operations.theme = async (next) => { seen.push(next.revision); next.settings.defaultMinimumFontSize = 13; return next; };
  await applyManagedProgramPlan({ ...request, applyDefaultTheme: true }, h.operations);
  assert.deepEqual(seen, [0, 0, 1, 2], "the same theme operation validates preview before the three commit attempts");
  assert.equal(h.document().settings.defaultMinimumFontSize, 13);
  for (const owner of h.prepared.at(-1)) assert.equal(h.document().buttons[owner].metadata.programDefaultAppearanceReceipt, receipt);
  assert.deepEqual(h.counts(), { applies: 1, commits: 3, finalizes: 1, rollbacks: 0 });
});

test("setup fails before installation when its requested packaged appearance is missing", async () => {
  const h = harness(0);
  await assert.rejects(applyManagedProgramPlan({ ...request, applyDefaultTheme: true }, h.operations), /did not return its requested packaged appearance/);
  assert.deepEqual(h.counts(), { applies: 0, commits: 0, finalizes: 0, rollbacks: 0 });
});

test("a failed packaged appearance never writes its atomic recovery receipt", async () => {
  const h = harness(0);
  setupAppearance(h);
  h.operations.theme = async () => { throw Error("Missing preset dependency"); };
  await assert.rejects(applyManagedProgramPlan({ ...request, applyDefaultTheme: true }, h.operations), /Missing preset dependency/);
  assert.deepEqual(h.counts(), { applies: 0, commits: 0, finalizes: 0, rollbacks: 0 });
  assert.ok(Object.values(h.document().buttons).every((button) => !button.metadata.programDefaultAppearanceReceipt));
});

test("setup refuses to save packaged appearance without its native recovery receipt", async () => {
  const h = harness(0);
  setupAppearance(h);
  delete h.presentation.defaultThemeReceipt;
  h.operations.theme = async (next) => next;
  await assert.rejects(applyManagedProgramPlan({ ...request, applyDefaultTheme: true }, h.operations), /invalid packaged appearance receipt/);
  assert.deepEqual(h.counts(), { applies: 0, commits: 0, finalizes: 0, rollbacks: 0 });
});

test("invalid complete preview invokes no native installation or rollback", async () => {
  const h = harness(0);
  setupAppearance(h);
  h.operations.theme = async (document) => {
    const placement = Object.values(document.placements)[0];
    placement.x = Number.NaN;
    return document;
  };
  await assert.rejects(applyManagedProgramPlan({ ...request, applyDefaultTheme: true }, h.operations), /Program setup layout is invalid/);
  assert.deepEqual(h.counts(), { applies: 0, commits: 0, finalizes: 0, rollbacks: 0 });
});

test("stale preview is rebuilt and its revision and package fingerprint reach native apply", async () => {
  const h = harness(0);
  let loads = 0;
  let previews = 0;
  const preflight = h.operations.preflight;
  h.operations.preflight = async (...args) => { previews += 1; return preflight(...args); };
  h.operations.load = async () => {
    if (++loads === 2) h.document().revision += 1;
    return structuredClone(h.document());
  };
  const apply = h.operations.apply;
  h.operations.apply = async (plan) => {
    assert.equal(plan.expectedButtonRevision, 1);
    assert.equal(plan.expectedPlanFingerprint, "f".repeat(64));
    return apply(plan);
  };
  await applyManagedProgramPlan(request, h.operations);
  assert.equal(previews, 2);
  assert.equal(h.counts().applies, 1);
});

test("native revision race revalidates before a single successful installation", async () => {
  const h = harness(0);
  let tries = 0;
  const apply = h.operations.apply;
  h.operations.apply = async (plan) => {
    if (++tries === 1) { h.document().revision += 1; throw Error("Button state changed before program installation. Retry setup."); }
    return apply(plan);
  };
  await applyManagedProgramPlan(request, h.operations);
  assert.equal(tries, 2);
  assert.equal(h.counts().applies, 1);
});

test("changed package fails before any transaction rather than bypassing preview", async () => {
  const h = harness(0);
  h.operations.apply = async () => { throw Error("Program setup package changed since preview. Preview again."); };
  await assert.rejects(applyManagedProgramPlan(request, h.operations), /package changed since preview/);
  assert.deepEqual(h.counts(), { applies: 0, commits: 0, finalizes: 0, rollbacks: 0 });
});

function scriptSetupFixture({ cramped = false } = {}) {
  const descriptor = (id, label = id) => ({ ownerButtonId: id,
    sourceIdentity: { programName: "Example", panelName: "Files", fileName: `${id}.flowcell-source.json` },
    owner: { label, tooltip: "", executionTarget: { kind: "panel-script", programName: "Example", panelName: "Files", fileName: `${id}.flowcell-source.json` } }, children: [] });
  const descriptors = [descriptor("slicer"), ...(!cramped ? [descriptor("save", "Save Blender")] : []), descriptor("updater", "Update Git Scripts")];
  const themeDescriptors = descriptors.map((entry) => ({ ownerButtonId: entry.ownerButtonId, programName: "Example", programId: "example", panelName: "Files",
    sourceId: entry.ownerButtonId, sourceVersion: "1.0.0", sourceName: entry.owner.label, importKind: "script", slots: [] }));
  const donor = mergeLegacyInstallsIntoDocument(createButtonStateDocument(), descriptors.slice(0, -1).map(normalizeLegacyInstallResult));
  const surface = Object.values(donor.surfaces).find((entry) => entry.kind === "panel");
  surface.uniformButtonSize = { width: 96, height: 44 };
  if (cramped) { surface.width = 96; surface.height = 44; surface.visualOverflowAllowance = 0; }
  surface.placementIds.forEach((id, index) => Object.assign(donor.placements[id], {
    x: index * 100, y: cramped ? 0 : 58, width: 96, height: 44, skinOverrideId: null, matchHitboxToSkin: false, allowLabelResize: false
  }));
  assert.deepEqual(validateButtonStateDocument(donor).issues, []);
  const theme = capturePortableTheme({ document: donor, descriptors: themeDescriptors.slice(0, -1),
    target: { kind: "program", programName: "Example", panelName: null }, name: "Saved files" });
  return { donor, theme, setup: { programName: "Example", panels: ["Files"], descriptors, themeDescriptors,
    defaultTheme: theme, defaultThemeReceipt: "b".repeat(64) } };
}

test("new setup preserves themed geometry and allocates additional selected controls afterward", async () => {
  const { donor, setup } = scriptSetupFixture();
  const before = JSON.stringify(donor);
  const { document, expectedButtonIds } = await buildProgramSetupDocument(createButtonStateDocument(), setup);
  assert.equal(JSON.stringify(donor), before);
  for (const placement of Object.values(donor.placements)) {
    assert.deepEqual([document.placements[placement.id].x, document.placements[placement.id].y, document.placements[placement.id].width, document.placements[placement.id].height],
      [placement.x, placement.y, placement.width, placement.height]);
  }
  const updater = document.placements["placement-updater"];
  assert.equal(updater.width, 96, "additional controls use the restored surface size");
  assert.equal(updater.height, 44);
  assert.ok(expectedButtonIds.includes("updater"));
  assert.equal(validateButtonStateDocument(document).valid, true);
});

test("additional selected scripts grow a full panel and keep every authored control in place", async () => {
  const { setup } = scriptSetupFixture({ cramped: true });
  const saved = JSON.stringify(setup.defaultTheme);
  const { document } = await buildProgramSetupDocument(createButtonStateDocument(), setup);
  const surface = Object.values(document.surfaces).find((entry) => entry.kind === "panel");
  const original = document.placements["placement-slicer"];
  assert.deepEqual([original.x, original.y, original.width, original.height], [0, 0, 96, 44]);
  assert.ok(document.placements["placement-updater"]);
  assert.ok(surface.width > 96 || surface.height > 44);
  assert.equal(validateButtonStateDocument(document).valid, true);
  assert.equal(JSON.stringify(setup.defaultTheme), saved);
});
