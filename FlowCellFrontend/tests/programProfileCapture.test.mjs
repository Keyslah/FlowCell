import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareProgramProfile } from "../../release-tools/prepare-program-profile.mjs";
import { createProgramProfileRecipient } from "../../release-tools/program-profile-roundtrip.mjs";
import { decodeProgramAppearance } from "./.compiled-button-system/pages/program-setup/programDefaultTheme.js";
import { assertSelfContainedProgramAppearance } from "../../release-tools/program-profile-assets.mjs";

async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "flowcell-current-profile-test-"));
  const programRoot = join(root, "Programs/Aster");
  const localRoot = join(root, "local");
  const write = (path, data) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data)); };
  const program = { schemaVersion: 1, programId: "aster", label: "Aster", runner: { kind: "aster-bridge" },
    panelsFolder: "Panels", localScriptsFolder: "Local Scripts", gitScriptsFolder: "Catalog", supportScriptsFolder: "Support",
    defaultPanels: ["Work"], panels: [{ id: "work", label: "Work", defaultSelected: true }],
    bundledSources: [
      { id: "aster.axis", version: "1.0.0", importKind: "tool-set", panelName: "Work", sourcePath: "Catalog/Axis", installOnAdd: true },
      { id: "aster.save", version: "1.0.0", importKind: "script", panelName: "Work", sourcePath: "Catalog/save.py", installOnAdd: true }
    ] };
  const manifest = { schemaVersion: 1, id: "aster.axis", version: "1.0.0", kind: "toolset", program: "Aster",
    label: "Axis", source: "axis.py", children: [{ slot: "x", label: "X", payload: { command: "x", mode: "exact" } }],
    layout: { width: 180, height: 100, placements: { x: { x: 5, y: 5, width: 80, height: 35, zIndex: 0 } },
      fields: [{ id: "amount", label: "Amount", kind: "number", payloadKey: "amount", defaultValue: 3,
        x: 5, y: 50, width: 80, height: 35, zIndex: 0, step: 1 }],
      childBehaviors: { x: { execute: true, payloadTemplate: { amount: { $field: "amount" } } } } } };
  write(join(programRoot, "flowcell.program.json"), program);
  write(join(programRoot, "Catalog/Axis/flowcell.toolset.json"), manifest);
  write(join(programRoot, "Catalog/Axis/axis.py"), "# fixture: original axis; never execute\n");
  write(join(programRoot, "Catalog/save.py"), "# fixture: original save; never execute\n");
  const dependencies = program.bundledSources.map((source) => ({ id: `dep-${source.id}`, programName: "Aster", programId: "aster",
    panelName: "Work", sourceId: source.id, sourceVersion: source.version, sourceName: source.id,
    importKind: source.importKind, slots: source.importKind === "tool-set" ? ["x"] : [] }));
  const { document, descriptors } = createProgramProfileRecipient(programRoot, { dependencies });
  const localProgram = join(localRoot, "Programs/Aster");
  const recordPaths = {};
  const sourcePaths = {};
  for (const descriptor of descriptors) {
    const toolset = descriptor.importKind === "tool-set";
    const name = toolset ? "axis.py" : "save.py";
    const packageRoot = join(localProgram, "Local Scripts", descriptor.ownerButtonId);
    mkdirSync(join(packageRoot, "source"), { recursive: true });
    if (toolset) cpSync(join(programRoot, "Catalog/Axis"), join(packageRoot, "source"), { recursive: true });
    else cpSync(join(programRoot, "Catalog/save.py"), join(packageRoot, "source/save.py"));
    write(join(packageRoot, "flowcell.install.json"), { schemaVersion: 1, ownerButtonId: descriptor.ownerButtonId,
      sourceRelativePath: `source/${name}`, bundledSourceId: descriptor.sourceId });
    const record = { schemaVersion: 1, ownerButtonId: descriptor.ownerButtonId, installId: descriptor.ownerButtonId,
      programId: "aster", programName: "Aster", panelName: "Work", label: toolset ? "Axis" : "Save",
      kind: toolset ? "toolset" : "script", runner: "aster-bridge", children: toolset ? manifest.children : [],
      bundledSourceId: descriptor.sourceId, sourcePath: join(packageRoot, "source", name), localPackagePath: packageRoot };
    recordPaths[descriptor.sourceId] = join(localProgram, "Panels/Work", `${descriptor.ownerButtonId}.flowcell-source.json`);
    sourcePaths[descriptor.sourceId] = join(packageRoot, "source", name);
    write(recordPaths[descriptor.sourceId], record);
  }
  const statePath = join(localRoot, "button-system/button-state.json");
  write(statePath, document);
  const capture = (extra = {}) => prepareProgramProfile({ programRoot, localRoot, ...extra });
  const edit = (path, update) => { const data = JSON.parse(readFileSync(path, "utf8")); update(data); write(path, data); };
  try { await run({ root, programRoot, localRoot, statePath, document, manifest, program, recordPaths, sourcePaths, write, edit, capture }); }
  finally { rmSync(root, { recursive: true, force: true }); } // This task-created fixture only.
}

test("generic capture derives current identities without a manual map or a frozen profile", () => fixture(async (f) => {
  const before = readFileSync(f.statePath);
  const report = await f.capture();
  assert.equal(report.programId, "aster");
  assert.equal(report.dependencies, 2);
  assert.equal(report.fields, 1);
  assert.deepEqual(readFileSync(f.statePath), before);
  assert.equal(existsSync(join(f.programRoot, "Support/default-appearance.flowcell-theme.json")), false);
}));

test("fresh capture includes a later label and +/- cycle instead of recycling the previous preset", () => fixture(async (f) => {
  const first = await f.capture();
  f.edit(f.statePath, (state) => {
    const child = Object.values(state.buttons).find((button) => button.metadata.toolSetSlot === "x");
    child.label = "New X";
    const placement = Object.values(state.placements).find((placement) => placement.buttonId === child.id);
    placement.activationCycle = { states: [
      { id: "minus", label: "-", visualState: "base", advanceTrigger: "press" },
      { id: "plus", label: "+", visualState: "held", advanceTrigger: "press" }
    ] };
    state.revision += 1;
  });
  const outputRoot = join(f.root, "staging/Aster");
  cpSync(f.programRoot, outputRoot, { recursive: true });
  const second = await f.capture({ outputRoot });
  assert.notEqual(second.donorStateSha256, first.donorStateSha256);
  const archive = decodeProgramAppearance(JSON.parse(readFileSync(join(outputRoot, "Support/default-appearance.flowcell-theme.json"), "utf8")));
  const appearance = Object.values(archive.presentation).find((entry) => entry.button.label === "New X");
  assert.deepEqual(appearance.placement.activationCycle.states.map((entry) => entry.label), ["-", "+"]);
}));

test("source byte edits under an unchanged version stop packaging", () => fixture(async (f) => {
  f.write(f.sourcePaths["aster.axis"], "# fixture: MODIFIED axis; never execute\n");
  await assert.rejects(f.capture(), /script bytes differ/);
}));

test("new installed sources absent from the catalog stop packaging", () => fixture(async (f) => {
  f.edit(f.recordPaths["aster.axis"], (record) => { record.bundledSourceId = "aster.new-axis"; });
  await assert.rejects(f.capture(), /0 matching catalog sources/);
}));

test("changed command payloads stop packaging even when script bytes match", () => fixture(async (f) => {
  f.edit(f.recordPaths["aster.axis"], (record) => { record.children[0].payload.mode = "different"; });
  await assert.rejects(f.capture(), /child commands or payloads differ/);
}));

test("changed field defaults cannot be hidden by a matching appearance", () => fixture(async (f) => {
  f.edit(f.statePath, (state) => { Object.values(state.popoutUnits).find((unit) => unit.kind === "tool-set").fields[0].defaultValue = 99; });
  await assert.rejects(f.capture(), /saved field definitions\/defaults differ/);
}));

test("future helper files absent from the catalog stop packaging", () => fixture(async (f) => {
  f.write(join(f.sourcePaths["aster.axis"], "../new-helper.py"), "# new required helper\n");
  await assert.rejects(f.capture(), /companion is missing/);
}));

test("missing skin families stop packaging instead of falling back to a static skin", () => fixture(async (f) => {
  f.edit(f.statePath, (state) => {
    const owner = Object.values(state.buttons).find((button) => button.sourceIdentity && !button.toolSetParentId);
    state.skins[owner.defaultSkinId].metadata.buttonSkinFamily = "Missing family";
  });
  await assert.rejects(f.capture(), /skin family.*unavailable/);
}));

test("duplicate legacy execution matches require explicit identity instead of matching labels", () => fixture(async (f) => {
  f.edit(f.recordPaths["aster.axis"], (record) => { delete record.bundledSourceId; });
  const installPath = join(f.sourcePaths["aster.axis"], "../../flowcell.install.json");
  f.edit(installPath, (record) => { delete record.bundledSourceId; });
  f.edit(join(f.programRoot, "flowcell.program.json"), (program) => {
    program.bundledSources.push({ ...program.bundledSources[0], id: "aster.ambiguous" });
  });
  await assert.rejects(f.capture(), /2 matching catalog sources/);
}));

test("capture refuses to overwrite the donor or catalog", () => fixture(async (f) => {
  await assert.rejects(f.capture({ outputRoot: f.programRoot }), /separate staging directory/);
  await assert.rejects(f.capture({ outputRoot: f.localRoot }), /separate staging directory/);
}));

test("an untracked helper present in donor and checkout cannot disappear from staged bytes", () => fixture(async (f) => {
  const outputRoot = join(f.root, "staging/Aster");
  cpSync(f.programRoot, outputRoot, { recursive: true });
  f.write(join(f.programRoot, "Catalog/Axis/new-helper.py"), "# exact future helper\n");
  f.write(join(f.sourcePaths["aster.axis"], "../new-helper.py"), "# exact future helper\n");
  await assert.rejects(f.capture({ outputRoot }), /staged package omitted catalog file/);
}));

test("future saved execution fields require exporter support instead of being dropped", () => fixture(async (f) => {
  f.edit(f.statePath, (state) => { Object.values(state.buttons).find((button) => button.sourceIdentity).futureExecutionPolicy = "different"; });
  await assert.rejects(f.capture(), /unsupported.*futureExecutionPolicy/i);
}));

test("a command pointed at another owner cannot be normalized into an apparent match", () => fixture(async (f) => {
  f.edit(f.statePath, (state) => {
    Object.values(state.buttons).find((button) => button.metadata.toolSetSlot === "x").executionTarget.ownerFileName = "another.flowcell-source.json";
  });
  await assert.rejects(f.capture(), /routes to another source/);
}));

test("empty installed panels stay selected even without any source owners", () => fixture(async (f) => {
  f.edit(join(f.programRoot, "flowcell.program.json"), (program) => {
    program.panels.push({ id: "empty", label: "Empty", defaultSelected: false });
  });
  mkdirSync(join(f.localRoot, "Programs/Aster/Panels/Empty"));
  const outputRoot = join(f.root, "staging/Aster");
  cpSync(f.programRoot, outputRoot, { recursive: true });
  await f.capture({ outputRoot });
  const program = JSON.parse(readFileSync(join(outputRoot, "flowcell.program.json"), "utf8"));
  assert.deepEqual(program.defaultPanels, ["Work", "Empty"]);
}));

test("undeclared installed panels stop release instead of being omitted", () => fixture(async (f) => {
  mkdirSync(join(f.localRoot, "Programs/Aster/Panels/Future"));
  await assert.rejects(f.capture(), /installed panel 'Future' is absent/);
}));

test("skin assets must travel inside the skin, including references nested in an embedded SVG", () => {
  const check = (source) => assertSelfContainedProgramAppearance({ skinSources: { sample: source } });
  check('filter: url("#local-filter"); background: url("data:image/png;base64,AAAA");');
  check('<svg><use href="#shape"/></svg>');
  for (const source of [
    'background: url("C:/Users/owner/picture.png")', '<img src="../picture.png">',
    '<image href="https://example.invalid/picture.svg"/>', '@import "fonts.css";',
    'background: url("theme-asset:picture.png")',
    `background: url("data:image/svg+xml,${encodeURIComponent('<svg><image href="file:///C:/private.png"/></svg>')}")`
  ]) assert.throws(() => check(source), /assets? .*embedded|must be embedded/);
});
