import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { mergeAddedButtonRecords, hydrateEditorPopout } from "./.compiled-button-system/button/editor/buttonEditorMembership.js";

const source = readFileSync(new URL("../src/button/editor/ButtonEditorPage.tsx", import.meta.url), "utf8");
const commit = source.slice(source.indexOf("const commitMembership ="), source.indexOf("const prepareMembershipSurface ="));
const start = source.indexOf("const importSource = useCallback");
const handler = source.slice(start, source.indexOf("\n  useEffect", start));

function harness(options = {}) {
  let saved = createButtonStateDocument();
  let draft = structuredClone(saved);
  let attempts = 0;
  const uninstalls = [], messages = [], events = [], pickerCalls = [], directoryRequests = [];
  const staged = new Map();
  const installed = { ownerButtonId: "new", sourceIdentity: {}, label: "Screenshots", children: [] };
  const sandbox = {
    structuredClone, Error, Map, Set, Promise, String,
    useCallback: callback => callback,
    lockedImportDestination: options.lockedImportDestination ?? null, programName: "Windows", panelName: "Utility", settingsFilePaths: {},
    busyRef: { current: false }, setBusy: value => { sandbox.busyRef.current = value; },
    setMessage: message => messages.push(message),
    isFlowCellMainPageProgram: () => false,
    invoke: async (command, args) => { directoryRequests.push({ command, ...args }); return `D:/Programs/${args.programName}/Declared Git Scripts`; },
    showOpenFileDialog: async args => { pickerCalls.push(args); return options.cancelPicker ? [] : ["D:/source/Screenshots.ps1"]; },
    createStableButtonId: () => "new",
    installButtonSource: async () => installed,
    uninstallButtonSource: async request => uninstalls.push(request.ownerButtonId),
    stagedInstallsRef: { current: staged }, freshPlacementsRef: { current: new Set() },
    cloneButtonDocument: structuredClone, mergeAddedButtonRecords, hydrateEditorPopout,
    loadButtonStateDocument: async () => structuredClone(saved),
    saveButtonStateDocument: async next => {
      attempts++;
      if (options.failSave) throw new Error("Disk write failed");
      if (options.conflict && attempts === 1) {
        saved.revision++;
        saved.settings.defaultMinimumFontSize = 13;
        throw new Error("Button state changed before Save.");
      }
      saved = structuredClone(next); saved.revision++;
      events.push("saved");
      return structuredClone(saved);
    },
    publishButtonCommit: async () => { events.push("published"); if (options.failPublish) throw new Error("Window gone"); },
    ensureProgramPanelSurface: doc => doc.surfaces.panel ??= { id: "panel", kind: "panel", placementIds: [] },
    addInstalledSingle: doc => {
      doc.buttons.new = { id: "new", label: "Screenshots" };
      const placement = { id: "new-placement", buttonId: "new", surfaceId: "panel" };
      doc.placements[placement.id] = placement;
      doc.surfaces.panel.placementIds.push(placement.id);
      return placement;
    },
    saveCustomMembershipFile: async () => {},
    setSelectedSurfaceId: () => events.push("selected"), setFocusedPlacementId: () => {}, setSelectedPlacementIds: () => {},
    store: {
      current: () => draft,
      acceptScopedSaved: (canonical, apply) => { apply(draft, canonical); draft.revision = canonical.revision; }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(ts.transpileModule(commit + handler + "\nglobalThis.run = importSource;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText, sandbox);
  return { run: sandbox.run, staged, uninstalls, messages, events, pickerCalls, directoryRequests, get saved() { return saved; }, get attempts() { return attempts; } };
}

test("Main Page Add opens the picker directly and uses the destination program catalog", async () => {
  assert.match(source, /settingsPlacementKind === "pop-out" \? openAddButtons\(\) : importSource\(\)/);
  const h = harness({ cancelPicker: true, lockedImportDestination: { programName: "Fusion 360", panelName: "Tools" } });
  await h.run();
  assert.equal(h.directoryRequests[0].command, "get_program_git_scripts_directory");
  assert.equal(h.directoryRequests[0].programName, "Fusion 360");
  assert.equal(h.pickerCalls[0].initialDirectory, "D:/Programs/Fusion 360/Declared Git Scripts");
});

test("import saves Main Page before returning and clears staged cleanup", async () => {
  const h = harness(); await h.run();
  assert.ok(h.saved.buttons.new);
  assert.deepEqual(h.saved.surfaces.panel.placementIds, ["new-placement"]);
  assert.equal(h.staged.size, 0);
  assert.deepEqual(h.uninstalls, []);
  assert.ok(h.events.indexOf("saved") < h.events.indexOf("selected"));
});
test("save failure rolls back only the uncommitted installed source", async () => {
  const h = harness({ failSave: true }); await h.run();
  assert.equal(h.saved.buttons.new, undefined);
  assert.deepEqual(h.uninstalls, ["new"]);
  assert.equal(h.staged.size, 0);
});
test("publish failure never uninstalls an already committed source", async () => {
  const h = harness({ failPublish: true }); await h.run();
  assert.ok(h.saved.buttons.new);
  assert.deepEqual(h.uninstalls, []);
  assert.equal(h.staged.size, 0);
});
test("revision conflict retries against fresh state and retains another window's changes", async () => {
  const h = harness({ conflict: true }); await h.run();
  assert.equal(h.attempts, 2);
  assert.equal(h.saved.settings.defaultMinimumFontSize, 13);
  assert.ok(h.saved.buttons.new);
  assert.deepEqual(h.uninstalls, []);
});
test("canceling script selection installs and saves nothing", async () => {
  const h = harness({ cancelPicker: true }); await h.run();
  assert.equal(h.attempts, 0);
  assert.equal(h.staged.size, 0);
  assert.deepEqual(h.uninstalls, []);
});
