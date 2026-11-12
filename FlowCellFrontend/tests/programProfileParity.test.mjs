import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createProgramProfileRecipient, verifyProgramProfileRoundTrip } from "../../release-tools/program-profile-roundtrip.mjs";
import { capturePortableTheme } from "./.compiled-button-system/theme/portableTheme.js";
import { encodeProgramDefaultTheme } from "./.compiled-button-system/pages/program-setup/programDefaultTheme.js";
import { ensureRegularPopout } from "./.compiled-button-system/button/state/buttonDocumentOperations.js";

const programsRoot = resolve(import.meta.dirname, "../../Programs");
for (const entry of readdirSync(programsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(programsRoot, entry.name, "flowcell.program.json"), "utf8")); }
  catch (error) { if (error.code === "ENOENT") continue; throw error; }
  if (!manifest.defaultTheme) continue;
  test(`${entry.name}: every packaged default occurrence survives clean import through the shared validator`, () => {
    const result = verifyProgramProfileRoundTrip({ programRoot: join(programsRoot, entry.name) });
    assert.equal(result.programId, manifest.programId);
    assert.ok(result.placements > 0);
  });
}

function withProgram(action) {
  const directory = mkdtempSync(join(tmpdir(), "flowcell-profile-parity-test-"));
  const save = (relative, value) => writeFileSync(join(directory, relative), typeof value === "string" ? value : JSON.stringify(value));
  try {
    mkdirSync(join(directory, "Catalog"));
    mkdirSync(join(directory, "Catalog/Tool"));
    mkdirSync(join(directory, "Catalog/Page"));
    const program = { schemaVersion: 1, programId: "orbit-studio", label: "Orbit Studio",
      defaultTheme: "appearance.json", bundledSources: [
        { id: "orbit.adjust", version: "2.3.4", panelName: "Work", importKind: "tool-set", installOnAdd: true,
          sourcePath: "Catalog/Tool", displayLabel: "Adjustment" },
        { id: "orbit.page", version: "1.0.0", panelName: "Work", importKind: "script", installOnAdd: true,
          sourcePath: "Catalog/Page", displayLabel: "Page" },
        { id: "orbit.script", version: "1.0.0", panelName: "Work", importKind: "script", installOnAdd: true,
          sourcePath: "Catalog/plain.py", displayLabel: "Script" }
      ] };
    const toolset = { schemaVersion: 1, id: "orbit.adjust", version: "2.3.4", program: "Orbit Studio",
      label: "Adjustment", tooltip: "Original tool", source: "adjust.py", children: [
        { slot: "apply", label: "Apply", payload: { command: "apply", mode: "exact" } },
        { slot: "window", label: "Window", executionTarget: { kind: "core-action", actionId: "open-window-grid" } }
      ], layout: { width: 320, height: 180, placements: {
        apply: { x: 10, y: 50, width: 80, height: 35, zIndex: 0 },
        window: { x: 100, y: 50, width: 80, height: 35, zIndex: 1 }
      }, fields: [{ id: "amount", kind: "number", label: "Amount", payloadKey: "amount", defaultValue: 7,
        step: 2, x: 10, y: 5, width: 80, height: 35, zIndex: 0,
        serviceTarget: { kind: "tool-set-action", command: "apply" }, serviceTrigger: "change" }],
      childBehaviors: { apply: { execute: true, payloadTemplate: { amount: { $field: "amount" } } } } } };
    save("flowcell.program.json", program);
    save("Catalog/Tool/flowcell.toolset.json", toolset);
    save("Catalog/Tool/adjust.py", "# This fixture must never execute.\nraise RuntimeError('not a runtime test')\n");
    save("Catalog/Page/flowcell.script.json", { schemaVersion: 1, id: "orbit.page", label: "Page", source: "page.py",
      page: { id: "orbit.settings" } });
    save("Catalog/Page/page.py", "# Fixture page script\n");
    save("Catalog/plain.py", "# Fixture plain script\n");
    const dependencies = program.bundledSources.map((source) => ({ id: `dependency-${source.id}`,
      programName: program.label, programId: program.programId, panelName: source.panelName, sourceId: source.id,
      sourceVersion: source.version, sourceName: source.displayLabel, importKind: source.importKind,
      slots: source.importKind === "tool-set" ? ["apply", "window"] : [] }));
    const donor = createProgramProfileRecipient(directory, { dependencies });
    const child = Object.values(donor.document.buttons).find((button) => button.metadata.toolSetSlot === "apply");
    const placement = Object.values(donor.document.placements).find((candidate) => candidate.buttonId === child.id);
    placement.activationCycle = { states: [
      { id: "minus", label: "-", visualState: "base", advanceTrigger: "press" },
      { id: "plus", label: "+", visualState: "held", advanceTrigger: "press" }
    ] };
    child.tooltip = "Saved tooltip, including exact punctuation!";
    const unit = Object.values(donor.document.popoutUnits).find((entry) => entry.kind === "tool-set");
    unit.fields[0].x = 15;
    unit.fields[0].width = 88;
    ensureRegularPopout(donor.document, Object.values(donor.document.buttons).filter((button) => button.role === "single-script"), { ownerless: true });
    const archive = capturePortableTheme({ document: donor.document, descriptors: donor.descriptors,
      target: { kind: "program", programName: program.label, panelName: null }, name: "Orbit captured defaults" });
    save("appearance.json", encodeProgramDefaultTheme(archive));
    return action({ directory, save, program, toolset, archive, donor });
  } finally {
    // Only this invocation's uniquely created test fixture is removed.
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + "\\") || resolve(directory).startsWith(resolve(tmpdir()) + "/"));
    assert.ok(directory.includes("flowcell-profile-parity-test-"));
    rmSync(directory, { recursive: true, force: true });
  }
}

test("the generic validator preserves another Program's cycles, fields, page routing, core child override and Pop", () => {
  withProgram(({ directory, donor }) => {
    assert.deepEqual(verifyProgramProfileRoundTrip({ programRoot: directory }),
      { programId: "orbit-studio", dependencies: 3, placements: 7, surfaces: 3, fields: 1 });
    const page = donor.document.buttons["profile-recipient-orbit.page"];
    assert.deepEqual(page.executionTarget, { kind: "core-action", actionId: "open-installed-page", payload: {
      pageId: "orbit.settings", programName: "Orbit Studio", panelName: "Work",
      fileName: "profile-recipient-orbit.page.flowcell-source.json", ownerButtonId: "profile-recipient-orbit.page"
    } });
    const core = Object.values(donor.document.buttons).find((button) => button.metadata.toolSetSlot === "window");
    assert.deepEqual(core.executionTarget, { kind: "core-action", actionId: "open-window-grid", payload: {
      programName: "Orbit Studio", panelName: "Work", fileName: "profile-recipient-orbit.adjust.flowcell-source.json",
      ownerButtonId: "profile-recipient-orbit.adjust"
    } });
  });
});

test("new default controls cannot silently bypass the captured profile", () => {
  withProgram(({ directory, program, save }) => {
    program.bundledSources.push({ ...program.bundledSources[2], id: "orbit.new" });
    save("flowcell.program.json", program);
    assert.throws(() => verifyProgramProfileRoundTrip({ programRoot: directory }), /adds uncaptured controls/);
  });
});

test("changed package versions require refreshing the captured profile", () => {
  withProgram(({ directory, program, toolset, save }) => {
    program.bundledSources[0].version = "2.3.5";
    toolset.version = "2.3.5";
    save("flowcell.program.json", program);
    save("Catalog/Tool/flowcell.toolset.json", toolset);
    assert.throws(() => verifyProgramProfileRoundTrip({ programRoot: directory }), /package and profile versions differ/);
  });
});

test("removed child slots cannot be hidden by a valid old appearance", () => {
  withProgram(({ directory, toolset, save }) => {
    toolset.children.pop();
    save("Catalog/Tool/flowcell.toolset.json", toolset);
    assert.throws(() => verifyProgramProfileRoundTrip({ programRoot: directory }), /child slots differ/);
  });
});

test("field geometry cannot silently drop fields removed from the catalog", () => {
  withProgram(({ directory, toolset, save }) => {
    toolset.layout.fields = [];
    toolset.layout.childBehaviors = {};
    save("Catalog/Tool/flowcell.toolset.json", toolset);
    assert.throws(() => verifyProgramProfileRoundTrip({ programRoot: directory }), /field 'amount' is missing/);
  });
});

test("profile target must match its owning Program", () => {
  withProgram(({ directory, archive }) => {
    archive.target.programName = "A Different Program";
    archive.theme.target.programName = "A Different Program";
    assert.throws(() => verifyProgramProfileRoundTrip({ programRoot: directory, appearance: archive }));
  });
});

test("fresh capture can verify staged defaults without modifying the original Program manifest", () => {
  withProgram(({ directory, program, archive, save }) => {
    const staged = structuredClone(program);
    delete program.defaultTheme;
    program.bundledSources[0].installOnAdd = false;
    save("flowcell.program.json", program);
    assert.equal(verifyProgramProfileRoundTrip({ programRoot: directory, program: staged, appearance: archive }).dependencies, 3);
    assert.equal(JSON.parse(readFileSync(join(directory, "flowcell.program.json"), "utf8")).defaultTheme, undefined);
  });
});

test("declared entry-file selections retain package page and tool-set metadata", () => {
  withProgram(({ directory, program, save }) => {
    program.bundledSources[0].sourcePath = "Catalog/Tool/adjust.py";
    program.bundledSources[1].sourcePath = "Catalog/Page/page.py";
    save("flowcell.program.json", program);
    assert.equal(verifyProgramProfileRoundTrip({ programRoot: directory }).dependencies, 3);
  });
});

test("an undeclared companion is not accepted as a source package entry", () => {
  withProgram(({ directory, program, save }) => {
    save("Catalog/Page/companion.py", "# Not an import alias\n");
    program.bundledSources[1].sourcePath = "Catalog/Page/companion.py";
    save("flowcell.program.json", program);
    assert.throws(() => verifyProgramProfileRoundTrip({ programRoot: directory }), /not its declared entry or import alias/);
  });
});
