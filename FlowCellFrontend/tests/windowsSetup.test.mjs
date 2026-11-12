import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { buildWindowsSetupPlan } from "./.compiled-button-system/pages/program-setup/windowsSetupPlan.js";
import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { buttonStateDocumentsEqual, reconcileBundledProgramSources, runButtonStateBootstrapSequence } from "./.compiled-button-system/button/state/ButtonStateRepository.js";
import { reconcileMainPageButtonDiscovery } from "./.compiled-button-system/button/state/mainPageButtonDiscovery.js";
import { reconcileProgramPanelOwners } from "./.compiled-button-system/button/state/panelOwnerButtonOperations.js";
import { buildProgramRailButtons, buildPanelRailButtons, buildPanelRailOwnerEntries, panelRailOwnerSurfaceBounds } from "./.compiled-button-system/pages/main/mainLayout.js";

// Exercise today's transaction orchestration without rebuilding the application
// or relying on an older emitted copy of this changed module.
const transactionSource = componentSource("pages/program-setup/applyManagedProgramPlan.ts", "applyManagedProgramPlan");
const applyManagedProgramPlan = evaluate(transactionSource.component, transactionSource.parsed, {
  buttonStateDocumentsEqual, reconcileBundledProgramSources, reconcileProgramPanelOwners,
  buildPanelRailOwnerEntries, panelRailOwnerSurfaceBounds, console,
  message: evaluate(transactionSource.parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "message"), transactionSource.parsed, {})
});

const manifest = JSON.parse(readFileSync(new URL("../../Programs/Windows/flowcell.program.json", import.meta.url), "utf8"));
const program = {
  programId: manifest.programId,
  programName: manifest.label,
  suggestedExecutable: "C:\\Windows\\explorer.exe",
  panels: manifest.panels,
  sources: manifest.bundledSources.map(source => ({
    id: source.id, label: source.displayLabel, panelName: source.panelName,
    defaultSelected: source.installOnAdd, required: source.required
  }))
};

test("Windows selection installs default tools only in checked panels", () => {
  const plan = buildWindowsSetupPlan(program, new Set(["Files", "Startup"]));
  assert.deepEqual(plan.selectedPanels, ["Files", "Startup"]);
  assert.deepEqual(plan.selectedSources.map(source => source.sourceId), program.sources
    .filter(source => ["Files", "Startup"].includes(source.panelName) && (source.defaultSelected || source.required))
    .map(source => source.id));
  assert.ok(plan.selectedSources.every(source => ["Files", "Startup"].includes(source.destinationPanel)));
  assert.equal(plan.programName, "Windows");
  assert.equal(plan.createPlainProgram, false);
  assert.equal(plan.executablePath, "C:\\Windows\\explorer.exe");
});

test("all Windows panels include every default contribution and no panels still registers Windows", () => {
  const all = buildWindowsSetupPlan(program, new Set(program.panels.map(panel => panel.label)));
  assert.equal(all.selectedPanels.length, 3);
  assert.deepEqual(all.selectedSources.map(source => source.sourceId), program.sources.map(source => source.id));
  const none = buildWindowsSetupPlan(program, new Set());
  assert.equal(none.programName, "Windows");
  assert.deepEqual(none.selectedPanels, []);
  assert.deepEqual(none.selectedSources, []);
});

test("Windows selection cannot install another program or undeclared panel", () => {
  assert.throws(() => buildWindowsSetupPlan({ ...program, programId: "blender" }, new Set()), /different program/);
  const plan = buildWindowsSetupPlan(program, new Set(["Unknown"]));
  assert.deepEqual(plan.selectedPanels, []);
});

const request = buildWindowsSetupPlan(program, new Set(["Files"]));
const result = { programName: "Windows", status: "ready", message: "Windows was added.", restartNotes: "" };

function harness(overrides = {}) {
  let document = createButtonStateDocument();
  const events = [];
  const operations = {
    apply: async () => { events.push("apply"); return { transactionToken: "add-program-test", programName: "Windows", panels: ["Files"], descriptors: [] }; },
    load: async () => { events.push("load"); return document; },
    prepare: async (token, ids) => { events.push("prepare"); assert.equal(token, "add-program-test"); assert.equal(ids.length, 1); },
    commit: async (next, revision) => { events.push("commit"); assert.equal(document.revision, revision); document = { ...next, revision: revision + 1 }; return document; },
    finalize: async () => { events.push("finalize"); return result; },
    rollback: async () => { events.push("rollback"); return "rolled-back"; },
    statuses: async () => { events.push("statuses"); return [result]; },
    publish: async () => { events.push("publish"); },
    notify: async () => { events.push("notify"); },
    ...overrides
  };
  return { operations, events, document: () => document };
}

test("managed setup commits canonical panel owners before finalizing and notifies after commit", async () => {
  const h = harness();
  assert.deepEqual(await applyManagedProgramPlan(request, h.operations), result);
  assert.deepEqual(h.events, ["apply", "load", "prepare", "commit", "finalize", "notify", "load", "publish"]);
  assert.ok(Object.values(h.document().buttons).some(button => button.label === "Files"));
});

test("failed canonical write rolls native setup back without publishing success", async () => {
  const h = harness({ commit: async () => { throw new Error("write rejected"); } });
  await assert.rejects(applyManagedProgramPlan(request, h.operations), /fully rolled back: write rejected/);
  assert.equal(h.events.at(-1), "rollback");
  assert.equal(h.events.includes("finalize"), false);
  assert.equal(h.events.includes("notify"), false);
});

test("lost finalize response recovers committed setup instead of reinstalling", async () => {
  const h = harness({ finalize: async () => { throw new Error("response lost"); }, rollback: async () => "finalized" });
  assert.deepEqual(await applyManagedProgramPlan(request, h.operations), result);
  assert.equal(h.events.filter(event => event === "apply").length, 1);
  assert.ok(h.events.includes("statuses"));
  assert.equal(h.events.at(-1), "publish");
});

test("failed native apply does not try rolling back an unknown transaction", async () => {
  const h = harness({ apply: async () => { throw new Error("native preflight failed"); } });
  await assert.rejects(applyManagedProgramPlan(request, h.operations), /native preflight failed/);
  assert.deepEqual(h.events, []);
});

test("rollback failure retains the startup recovery instruction", async () => {
  const h = harness({ commit: async () => { throw new Error("disk full"); }, rollback: async () => { throw new Error("locked file"); } });
  await assert.rejects(applyManagedProgramPlan(request, h.operations), /disk full.*startup recovery: locked file/);
});

test("rerendering a previously installed panel preserves canonical owners and unrelated settings", async () => {
  const h = harness();
  await applyManagedProgramPlan(request, h.operations);
  const before = structuredClone(h.document());
  h.events.length = 0;
  await applyManagedProgramPlan(request, h.operations);
  assert.deepEqual(h.document(), before);
  assert.equal(h.events.includes("commit"), false);
});

test("a failed Button notification still refreshes navigation without rolling back the completed install", async () => {
  const h = harness({ publish: async () => { throw new Error("listener unavailable"); } });
  const oldWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await applyManagedProgramPlan(request, h.operations), result);
  } finally {
    console.warn = oldWarn;
  }
  assert.equal(h.events.filter(event => event === "notify").length, 1);
  assert.equal(h.events.includes("rollback"), false);
});

test("installed targets are announced before a delayed full Button-state refresh", async () => {
  let loads = 0;
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  const h = harness({ load: async () => {
    if (++loads === 2) await delayed;
    return h.document();
  } });
  const installing = applyManagedProgramPlan(request, h.operations);
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(loads, 2);
    assert.equal(h.events.includes("notify"), true, "Theme/navigation and the restart notice can refresh while Buttons are still loading");
    assert.equal(h.events.includes("publish"), false);
  } finally { release(); }
  assert.deepEqual(await installing, result);
});

function componentSource(relativePath, name) {
  const source = readFileSync(new URL(`../src/${relativePath}`, import.meta.url), "utf8");
  const parsed = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return { parsed, component: parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name) };
}

function initializerOf(component, parsed, name) {
  const declaration = component.body.statements.filter(ts.isVariableStatement)
    .flatMap(node => [...node.declarationList.declarations])
    .find(node => ts.isArrayBindingPattern(node.name)
      ? node.name.elements.some(element => element.name?.getText(parsed) === name)
      : node.name.getText(parsed) === name);
  assert.ok(declaration, `Missing ${name} in ${component.name.text}`);
  return declaration.initializer;
}

function effectContaining(component, parsed, fragment) {
  const statement = component.body.statements.find(node => ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) && node.expression.expression.getText(parsed) === "useEffect" &&
    node.expression.arguments[0].getText(parsed).includes(fragment));
  assert.ok(statement, `Missing effect containing ${fragment}`);
  return statement.expression.arguments[0];
}

function evaluate(node, parsed, context) {
  const compiled = ts.transpileModule(`return (${node.getText(parsed).replace(/^export\s+/, "")});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return new Function(...Object.keys(context), compiled)(...Object.values(context));
}

function installationHarness(overrides = {}) {
  const setup = componentSource("pages/program-setup/AddProgramWindowPage.tsx", "AddProgramWindowPage");
  const events = [];
  const statuses = [];
  const state = { complete: false };
  const busyRef = { current: false };
  const context = {
    busyRef, setBusy: value => { busyRef.current = value; events.push(`busy:${value}`); },
    setProgress() {}, setStatus: value => statuses.push(value),
    setInstallationComplete: value => { state.complete = value; },
    installWindows: async () => { events.push("Windows"); },
    setupSource: "package", selectedProgram: { programName: "Blender" },
    addPlainProgram: async () => { events.push("plain"); },
    installProgram: async () => { events.push("Blender"); return { status: "ready", restartNotes: "" }; },
    onWindowsComplete: () => events.push("complete"), errorMessage: error => error.message,
    ...overrides
  };
  return {
    events, statuses, busyRef, state,
    install: evaluate(initializerOf(setup.component, setup.parsed, "install"), setup.parsed, context)
  };
}

test("one installation action finishes Windows and the selected program before releasing first-run setup", async () => {
  const h = installationHarness();
  await h.install();
  assert.deepEqual(h.events, ["busy:true", "Windows", "Blender", "complete", "busy:false"]);
  assert.equal(h.statuses.at(-1), "Installation complete.");
  assert.equal(h.state.complete, true);
});

test("Windows installation failure keeps first-run setup open and does not install the optional program", async () => {
  const h = installationHarness({ installWindows: async () => { throw new Error("Windows write failed"); } });
  await h.install();
  assert.deepEqual(h.events, ["busy:true", "busy:false"]);
  assert.match(h.statuses.at(-1), /Windows write failed/);
  assert.equal(h.busyRef.current, false);
  assert.equal(h.state.complete, false);
});

test("optional program installation failure does not report first-run completion", async () => {
  const h = installationHarness({ installProgram: async () => { throw new Error("Blender setup failed"); } });
  await h.install();
  assert.deepEqual(h.events, ["busy:true", "Windows", "busy:false"]);
  assert.match(h.statuses.at(-1), /Blender setup failed/);
  assert.equal(h.state.complete, false);
});

test("application initialization and restart notes remain visible before first-run completion", async () => {
  for (const result of [
    { status: "needsHostInitialization", restartNotes: "Open Blender to finish setup." },
    { status: "ready", restartNotes: "Restart Blender to load the installed add-on." }
  ]) {
    const h = installationHarness({ installProgram: async () => result });
    await h.install();
    assert.deepEqual(h.events, ["busy:true", "Windows", "busy:false"]);
    assert.equal(h.state.complete, true, "the completed installation is retained while the user reads the application notes");
  }
});

test("a second Install click cannot start another transaction while setup is busy", async () => {
  const h = installationHarness({ busyRef: { current: true } });
  await h.install();
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.statuses, []);
});

test("ZIP import uses its returned package without rescanning other programs or overwriting their inventory", async () => {
  const setup = componentSource("pages/program-setup/AddProgramWindowPage.tsx", "AddProgramWindowPage");
  const importedProgram = { programId: "blender", programName: "Blender", suggestedExecutable: "" };
  const otherProgram = { programId: "illustrator", programName: "Illustrator" };
  let inventory = {
    packages: [otherProgram, { programId: "blender", programName: "Old Blender" }],
    rejectedPackages: [{ folderName: "Blender", error: "old package" }, { folderName: "Unrelated", error: "keep" }]
  };
  const busy = [];
  const statuses = [];
  const selected = [];
  const packageActionPending = { current: false };
  const inventoryRequestRef = { current: 3 };
  await evaluate(initializerOf(setup.component, setup.parsed, "importPackage"), setup.parsed, {
    busy: false, packageActionPending, inventoryRequestRef,
    setBusy: value => busy.push(value), setProgress() {},
    setStatus: value => statuses.push(value),
    showOpenFileDialog: async () => ["D:\\Downloads\\FlowCell-Blender.zip"],
    importProgramPackage: async path => {
      assert.equal(path, "D:\\Downloads\\FlowCell-Blender.zip");
      return { availablePackage: importedProgram, cleanupWarning: "The previous package backup was retained." };
    },
    listAvailableProgramPackages: async () => { assert.fail("import must not rescan every available package"); },
    setInventory: update => { assert.equal(typeof update, "function"); inventory = update(inventory); },
    setSetupSource: value => selected.push(value),
    setSelectedProgramName: value => selected.push(value),
    resetForProgram: value => selected.push(value), errorMessage: error => error.message
  })();
  assert.deepEqual(inventory.packages, [otherProgram, importedProgram]);
  assert.equal(inventory.packages[0], otherProgram);
  assert.deepEqual(inventory.rejectedPackages, [{ folderName: "Unrelated", error: "keep" }]);
  assert.deepEqual(selected, ["package", "Blender", importedProgram]);
  assert.match(statuses.at(-1), /Blender was imported\. Select its \.exe path below/);
  assert.match(statuses.at(-1), /previous package backup was retained/);
  assert.equal(inventoryRequestRef.current, 4, "an earlier all-package response must no longer replace this import");
  assert.equal(packageActionPending.current, false);
  assert.deepEqual(busy, [true, false]);
});

test("an imported package that cannot supply setup inventory reports its specific warning and releases the import guard", async () => {
  const setup = componentSource("pages/program-setup/AddProgramWindowPage.tsx", "AddProgramWindowPage");
  const statuses = [];
  const busy = [];
  const packageActionPending = { current: false };
  await evaluate(initializerOf(setup.component, setup.parsed, "importPackage"), setup.parsed, {
    busy: false, packageActionPending, inventoryRequestRef: { current: 0 },
    setBusy: value => busy.push(value), setProgress() {}, setStatus: value => statuses.push(value),
    showOpenFileDialog: async () => ["D:\\Downloads\\FlowCell-Blender.zip"],
    importProgramPackage: async () => ({ packagePath: "D:\\FlowCell\\Programs\\Blender", availablePackage: null, inventoryWarning: "The source catalog could not be validated." }),
    setInventory: () => assert.fail("unavailable inventory must not replace the current packages"),
    listAvailableProgramPackages: () => assert.fail("import must not fall back to an unrelated full scan"),
    errorMessage: error => error.message
  })();
  assert.match(statuses.at(-1), /Package import failed:.*D:\\FlowCell\\Programs\\Blender.*source catalog could not be validated/);
  assert.equal(packageActionPending.current, false);
  assert.deepEqual(busy, [true, false]);
});

for (const selectedPanelNames of [["Files", "Startup"], ["Files", "Utility", "Startup"], []]) {
  test(`fresh Windows setup exposes its program Button and exactly ${selectedPanelNames.length} selected panel Buttons`, async () => {
    const gate = componentSource("pages/program-setup/WindowsSetup.tsx", "WindowsSetup");
    const setup = componentSource("pages/program-setup/AddProgramWindowPage.tsx", "AddProgramWindowPage");
    const main = componentSource("pages/main/MainPage.tsx", "MainPage");
    const selection = main.parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "resolveFolderSelection");
    const resolveFolderSelection = evaluate(selection, main.parsed, {});
    const state = { program: null, panels: new Set(), complete: false, error: "", programs: [], panelNames: [] };
    let registeredPrograms = [];
    let installedPanels = [];
    let savedDocument = JSON.stringify(createButtonStateDocument());
    let setupCommitted;
    const disposeMain = evaluate(effectContaining(main.component, main.parsed, "PROGRAM_SETUP_COMMITTED_EVENT"), main.parsed, {
      getCurrentWindow: () => ({ label: "main" }),
      PROGRAM_SETUP_COMMITTED_EVENT: "setup-committed",
      listen: async (_name, handler) => { setupCommitted = handler; return () => {}; },
      listProgramFolders: async () => registeredPrograms,
      listPanelFolders: async () => installedPanels,
      resolveFolderSelection,
      selectedPanelNameRef: { current: null },
      preferredPanelSelectionRef: { current: null },
      selectedProgramNameRef: { current: null },
      setProgramNames: names => { state.programs = names; },
      setSelectedProgramName: name => { state.selectedProgram = name; },
      setPanelNames: names => { state.panelNames = names; },
      setSelectedPanelName: name => { state.selectedPanel = name; },
      console
    })();
    assert.equal(buildProgramRailButtons(state.programs, null).filter(button => button.folderName === "Windows").length, 0);
    const onCompleteRef = { current: () => { state.complete = true; } };
    const callback = initializerOf(gate.component, gate.parsed, "checkRequirement").arguments[0];
    await evaluate(callback, gate.parsed, {
      getWindowsSetupRequirement: async () => program,
      setLoading() {}, setError: error => { state.error = error; },
      setProgram: value => { state.program = value; },
      onCompleteRef
    })();
    assert.equal(state.complete, false, "fresh setup waits for the user's choices");
    state.panels = evaluate(initializerOf(setup.component, setup.parsed, "selectedWindowsPanels").arguments[0], setup.parsed, {
      requiredWindowsProgram: state.program
    })();
    assert.deepEqual([...state.panels], ["Files", "Utility", "Startup"]);
    state.panels = new Set(selectedPanelNames);
    const expectedPlan = buildWindowsSetupPlan(program, state.panels);
    const busyRef = { current: false };
    const operations = {
      apply: async request => {
        assert.deepEqual(request, expectedPlan);
        registeredPrograms = ["Windows"];
        installedPanels = [...request.selectedPanels];
        return {
          transactionToken: "add-program-fresh-windows", programName: "Windows", panels: installedPanels,
          descriptors: request.selectedSources.map(source => ({
            ownerButtonId: `owner-${source.sourceId}`,
            sourceIdentity: { programName: "Windows", panelName: source.destinationPanel, fileName: `${source.sourceId}.flowcell-source.json` },
            owner: {
              label: program.sources.find(entry => entry.id === source.sourceId).label,
              executionTarget: { kind: "program-action", programName: "Windows", actionId: "run-installed-source", payload: { ownerButtonId: `owner-${source.sourceId}` } }
            },
            children: []
          }))
        };
      },
      load: async () => JSON.parse(savedDocument),
      prepare: async (_token, ids) => assert.equal(ids.length, expectedPlan.selectedPanels.length + expectedPlan.selectedSources.length),
      commit: async (document, revision) => {
        assert.equal(JSON.parse(savedDocument).revision, revision);
        savedDocument = JSON.stringify({ ...document, revision: revision + 1 });
        return JSON.parse(savedDocument);
      },
      finalize: async () => result,
      rollback: async () => { assert.fail("fresh Windows setup must not roll back"); },
      statuses: async () => [result],
      publish: async () => {},
      notify: async payload => {
        setupCommitted({ payload });
        await new Promise(resolve => setImmediate(resolve));
      }
    };
    try {
      const installWindows = evaluate(initializerOf(setup.component, setup.parsed, "installWindows"), setup.parsed, {
        windowsProgram: state.program, selectedWindowsPanels: state.panels,
        buildWindowsSetupPlan,
        applyManagedProgramPlan: request => applyManagedProgramPlan(request, operations),
        setStatus() {},
        setWindowsProgram: value => { state.program = value; }
      });
      await evaluate(initializerOf(setup.component, setup.parsed, "install"), setup.parsed, {
        busyRef, setBusy: busy => { busyRef.current = busy; }, setProgress() {},
        setInstallationComplete() {},
        setStatus: status => { if (status.startsWith("Program setup failed:")) state.error = status; },
        installWindows, setupSource: "package", selectedProgram: null,
        onWindowsComplete: () => onCompleteRef.current(), errorMessage: error => error.message
      })();
      assert.equal(state.error, "");
      assert.equal(state.complete, true);
      assert.equal(busyRef.current, false);
      assert.deepEqual(state.programs, ["Windows"]);
      assert.deepEqual(state.panelNames, selectedPanelNames);
      assert.equal(state.selectedProgram, "Windows");
      const programButtons = buildProgramRailButtons(state.programs, state.selectedProgram).filter(button => button.folderName);
      const panelButtons = buildPanelRailButtons(state.panelNames, state.selectedPanel).filter(button => button.folderName);
      assert.deepEqual(programButtons.map(button => button.label), ["Windows"]);
      assert.deepEqual(panelButtons.map(button => button.label), selectedPanelNames);
      const reloaded = JSON.parse(savedDocument);
      assert.deepEqual(Object.values(reloaded.buttons).filter(button => button.role === "panel-owner").map(button => button.metadata.panelName).sort(), [...selectedPanelNames].sort());
      assert.equal(Object.values(reloaded.buttons).filter(button => button.sourceIdentity?.displayProgramName === "Windows").length, expectedPlan.selectedSources.length);
      reconcileMainPageButtonDiscovery(reloaded, [{ programName: "Windows", panelNames: installedPanels }]);
      assert.equal(Object.values(reloaded.buttons).filter(button => button.metadata.mainPageProgramName === "Windows").length, 1, "next startup creates exactly one canonical Windows presentation");
      const beforeRepeat = structuredClone(reloaded);
      reconcileMainPageButtonDiscovery(reloaded, [{ programName: "Windows", panelNames: installedPanels }]);
      assert.deepEqual(reloaded, beforeRepeat, "later startup preserves the chosen panels and owners");
    } finally {
      disposeMain();
    }
  });
}

async function startupAfterBootstrapFailure({ canonicalAvailable }) {
  const { parsed, component } = componentSource("pages/main/MainPage.tsx", "MainPage");
  const state = { ready: false, complete: false, error: "", programs: [], connections: [] };
  const canonical = createButtonStateDocument();
  const context = {
    runButtonStateBootstrapSequence,
    loadButtonStateDocument: async () => {
      if (!canonicalAvailable) throw new Error("canonical state unreadable");
      return canonical;
    },
    bootstrapButtonStateDocument: async () => { throw new Error("optional source missing"); },
    subscribeButtonCommits: async () => () => {},
    buttonDocumentRef: { current: null },
    selectedProgramNameRef: { current: null },
    selectedPanelNameRef: { current: null },
    panelScriptLoadRequestRef: { current: 0 },
    acceptButtonDocument: document => { context.buttonDocumentRef.current = document; return true; },
    setButtonBootstrapError: error => { state.error = error; },
    setButtonBootstrapReady: ready => { state.ready = ready; },
    formatErrorMessage: error => error.message,
    console: { error() {}, warn() {} }
  };
  const dispose = evaluate(effectContaining(component, parsed, "runButtonStateBootstrapSequence("), parsed, context)();
  await new Promise(resolve => setImmediate(resolve));
  if (state.ready) {
    // Run the actual setup requirement callback: existing Windows returns null
    // and completes the gate without installing or changing canonical state.
    const setup = componentSource("pages/program-setup/WindowsSetup.tsx", "WindowsSetup");
    const declaration = setup.component.body.statements.filter(ts.isVariableStatement)
      .flatMap(node => [...node.declarationList.declarations])
      .find(node => node.name.getText(setup.parsed) === "checkRequirement");
    await evaluate(declaration.initializer.arguments[0], setup.parsed, {
      getWindowsSetupRequirement: async () => null,
      setLoading() {}, setError() {},
      onCompleteRef: { current: () => { state.complete = true; } }
    })();
  }
  const startupContext = {
    windowsSetupComplete: state.complete,
    getCurrentWindow: () => ({ label: "main" }),
    readStartupSettings: () => ({ loadLastLayoutOnStartup: false, minimizeMainOnStartup: false }),
    listProgramFolders: async () => ["Blender", "Illustrator"],
    setProgramNames: programs => { state.programs = programs; },
    setSelectedProgramName() {},
    connectRunningLayoutPrograms: async programs => { state.connections = programs; },
    console: { error() {}, warn() {} }
  };
  const disposeStartup = evaluate(effectContaining(component, parsed, "let startupProgramsPrepared = false"), parsed, startupContext)();
  await new Promise(resolve => setImmediate(resolve));
  dispose();
  disposeStartup?.();
  return { state, canonical, retained: context.buttonDocumentRef.current };
}

test("retained canonical state survives sync failure and still resolves Windows setup and program navigation", async () => {
  const { state, canonical, retained } = await startupAfterBootstrapFailure({ canonicalAvailable: true });
  assert.equal(retained, canonical);
  assert.match(state.error, /kept the last valid canonical Button document.*synchronization failed/s);
  assert.equal(state.ready, true);
  assert.equal(state.complete, true);
  assert.deepEqual(state.programs, ["Blender", "Illustrator"]);
  assert.deepEqual(state.connections, state.programs);
});

test("failure to load any canonical document does not begin Windows setup or program startup", async () => {
  const { state, retained } = await startupAfterBootstrapFailure({ canonicalAvailable: false });
  assert.equal(retained, null);
  assert.match(state.error, /could not load the canonical Button document/);
  assert.equal(state.ready, false);
  assert.equal(state.complete, false);
  assert.deepEqual(state.programs, []);
});
