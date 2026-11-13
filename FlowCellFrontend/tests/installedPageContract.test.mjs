import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const frontendRoot = join(import.meta.dirname, "..");
const repoRoot = join(frontendRoot, "..");

test("folder.select forwards the remembered directory and tolerates older empty requests", async () => {
  const source = read(frontendRoot, "src", "pages", "installed-page", "installedPageCoreBroker.ts");
  const parsed = ts.createSourceFile("broker.ts", source, ts.ScriptTarget.Latest, true);
  const functions = parsed.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement) && ["stringValue", "runFolderSelect"].includes(statement.name?.text)
  ).map((statement) => statement.getText(parsed)).join("\n");
  const compiled = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = [];
  const run = new Function("showOpenFolderDialog", `${compiled}\nreturn runFolderSelect;`)(async (args) => {
    calls.push(args);
    return calls.length === 1 ? ["D:\\Art\\Last used"] : [];
  });
  assert.deepEqual(await run({ dialogTitle: "Browse" }, { initialDirectory: " D:\\Art\\Last used " }),
    { selected: true, path: "D:\\Art\\Last used" });
  assert.deepEqual(calls[0], { title: "Browse", initialDirectory: "D:\\Art\\Last used", multiselect: false });
  assert.deepEqual(await run({}, {}), { selected: false, path: "" });
  assert.equal(calls[1].initialDirectory, undefined);
  assert.match(source, /case "folder.select": return runFolderSelect\(options, payload\)/);
});

function read(...parts) {
  return readFileSync(join(...parts), "utf8");
}

test("screen-color capability returns selection and cancellation through the native picker", async () => {
  const source = read(frontendRoot, "src", "pages", "installed-page", "installedPageCoreBroker.ts");
  const parsed = ts.createSourceFile("broker.ts", source, ts.ScriptTarget.Latest, true);
  const fn = parsed.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "runScreenColorPick");
  const compiled = ts.transpileModule(fn.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = [];
  let color = "#123456";
  const run = new Function("invoke", `${compiled}\nreturn runScreenColorPick;`)(async name => {
    calls.push(name);
    return { color };
  });
  assert.deepEqual(await run(), { selected: true, color: "#123456" });
  color = null;
  assert.deepEqual(await run(), { selected: false, color: "" });
  assert.deepEqual(calls, ["pick_screen_color", "pick_screen_color"]);
  assert.match(source, /case "color.pick-screen": return runScreenColorPick\(\)/);
});

test("isolated-page Undo accepts only its nonce and the three Undo/Redo chords", () => {
  const source = read(frontendRoot, "src", "pages", "installed-page", "InstalledPageWindowPage.tsx");
  const parsed = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const guards = parsed.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement) && ["isRecord", "isPageUndoMessage"].includes(statement.name?.text)
  ).map((statement) => statement.getText(parsed)).join("\n");
  const compiled = ts.transpileModule(guards, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const accepts = new Function(`${compiled}\nreturn isPageUndoMessage;`)();
  const message = { channel: "flowcell-installed-page", type: "undo", nonce: "page-session", requestId: "undo-1", shortcut: "undo" };
  for (const shortcut of ["undo", "redo-shift-z", "redo-y"]) {
    assert.equal(accepts({ ...message, shortcut }, "page-session"), true);
  }
  for (const invalid of [null, [], {}, { ...message, nonce: "other-page" },
    { ...message, requestId: "" }, { ...message, requestId: "a".repeat(161) },
    { ...message, shortcut: "delete" }, { ...message, channel: "other" }, { ...message, type: "request" }]) {
    assert.equal(accepts(invalid, "page-session"), false);
  }
  assert.match(source, /installProgramUndoKeys\.toString\(\)/);
  assert.match(source, /forwardProgramUndo\(request\.shortcut, context\.programName\)/);
});

test("Main exposes one Add Button action and keeps the serialized action ID", () => {
  const layout = read(frontendRoot, "src", "pages", "main", "mainLayout.ts");
  assert.match(layout, /label:\s*"Add Button"/);
  assert.match(layout, /actionId:\s*"add-panel-script"/);
  for (const forbidden of ["Add Script", "Add Package", "Add Tool Set", "Add Page"]) {
    assert.doesNotMatch(layout, new RegExp(`label:\\s*"${forbidden}"`));
  }
});

test("managed Add Program and Add Panel windows receive the default Tauri capability", () => {
  const capability = JSON.parse(
    read(frontendRoot, "src-tauri", "capabilities", "default.json")
  );
  assert.ok(capability.windows.includes("flowcell-add-program"));
  assert.ok(capability.windows.includes("flowcell-add-panel"));
});

test("Installation offers registration-only executable setup without importing a program ZIP", async () => {
  const addProgram = read(
    frontendRoot,
    "src",
    "pages",
    "program-setup",
    "AddProgramWindowPage.tsx"
  );
  assert.match(addProgram, /Add an application without a ZIP/);
  assert.match(addProgram, /<label>Program name/);
  assert.match(addProgram, /<label\b[^>]*>Application \.exe path/);
  const parsed = ts.createSourceFile("AddProgramWindowPage.tsx", addProgram, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "AddProgramWindowPage");
  const declarations = component.body.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]);
  const initializer = name => declarations.find(node => node.name.getText(parsed) === name).initializer;
  const evaluate = (node, context) => new Function(...Object.keys(context), ts.transpileModule(`return (${node.getText(parsed)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText)(...Object.values(context));
  const request = evaluate(initializer("request").arguments[0], {
    setupSource: "plain", plainProgramName: " Fixture ", plainExecutablePath: "C:\\Apps\\Fixture.exe"
  })();
  assert.deepEqual(request, {
    programName: "Fixture", executablePath: "C:\\Apps\\Fixture.exe", createPlainProgram: true,
    selectedPanels: [], selectedSources: []
  });
  const installed = [];
  await evaluate(initializer("addPlainProgram"), {
    request, setupSource: "plain", installValidatedPlan: async plan => installed.push(plan)
  })();
  assert.deepEqual(installed, [request]);
  assert.doesNotMatch(addProgram, /I confirm this EXE filename identifies/);
  assert.doesNotMatch(addProgram, />Review program<\/button>/);
  assert.equal((addProgram.match(/<footer className="program-setup__footer"/g) ?? []).length, 1);
});

function installationRenderHarness(overrides = {}) {
  const source = read(frontendRoot, "src", "pages", "program-setup", "AddProgramWindowPage.tsx");
  const parsed = ts.createSourceFile("AddProgramWindowPage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "AddProgramWindowPage");
  const returned = component.body.statements.find(ts.isReturnStatement).expression;
  const compiled = ts.transpileModule(`return (${returned.getText(parsed)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
  }).outputText;
  const state = {
    busy: false, setupStatusError: "", completedSetup: null, installationComplete: false,
    setupStatuses: [], inventory: { packages: [], rejectedPackages: [] }, setupSource: "package",
    selectedProgram: { programName: "Blender", executableCandidates: [], panels: [], sources: [] },
    executablePath: "", plainExecutablePath: "", plainProgramName: "Fixture", mode: "custom",
    selectedPanels: new Set(), selectedSources: new Set(), dependencyLocks: new Set(),
    status: "", progress: null, canInstall: false, selectionChanges: 0, ...overrides
  };
  return {
    state,
    render() {
      const context = { ...state, React,
        setExecutablePath: path => { state.executablePath = path; },
        setPlainExecutablePath: path => { state.plainExecutablePath = path; },
        setStatus() {}, markSelectionChanged: () => { state.selectionChanges += 1; }
      };
      return new Function(...Object.keys(context), compiled)(...Object.values(context));
    }
  };
}

function installationElements(node) {
  if (Array.isArray(node)) return node.flatMap(installationElements);
  return React.isValidElement(node) ? [node, ...installationElements(node.props.children)] : [];
}

test("Installation renders full executable choices and selecting another version updates its path", () => {
  const paths = ["C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe", "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe"];
  const h = installationRenderHarness({
    executablePath: paths[0],
    selectedProgram: { programName: "Blender", executableCandidates: paths.map(path => ({ path })), panels: [], sources: [] }
  });
  const choices = tree => installationElements(tree).filter(node => node.type === "button" && paths.includes(node.props.children));
  let tree = h.render();
  assert.deepEqual(choices(tree).map(node => node.props.children), paths);
  assert.deepEqual(choices(tree).map(node => node.props["aria-pressed"]), [true, false]);
  assert.ok(paths.every(path => renderToStaticMarkup(tree).includes(path)));
  choices(tree)[1].props.onClick();
  tree = h.render();
  assert.equal(installationElements(tree).find(node => node.props.id === "program-executable").props.value, paths[1]);
  assert.equal(installationElements(tree).find(node => node.props["aria-label"] === "Selected executable path").props.children, paths[1]);
  assert.deepEqual(choices(tree).map(node => node.props["aria-pressed"]), [false, true]);
  assert.equal(h.state.selectionChanges, 1);
  h.state.busy = true;
  assert.ok(choices(h.render()).every(node => node.props.disabled));
});

test("Installation displays the complete manually entered path in both application setup modes", () => {
  const path = `D:\\${"Long application folder\\".repeat(12)}fixture.exe`;
  for (const setupSource of ["plain", "package"]) {
    const h = installationRenderHarness({ setupSource });
    const inputId = setupSource === "plain" ? "plain-program-executable" : "program-executable";
    const input = installationElements(h.render()).find(node => node.props.id === inputId);
    input.props.onChange({ target: { value: path } });
    const tree = h.render();
    assert.equal(installationElements(tree).find(node => node.props["aria-label"] === "Selected executable path").props.children, path);
    assert.ok(renderToStaticMarkup(tree).includes(path));
  }
});

test("Installation renders all 6 catalog Shapes with their individual checkboxes", () => {
  const manifest = JSON.parse(read(repoRoot, "Programs", "Blender", "flowcell.program.json"));
  const sources = manifest.bundledSources.filter(source => source.panelName === "Shapes").map(source => ({
    ...source, label: source.displayLabel
  }));
  const h = installationRenderHarness({ selectedProgram: {
    programName: "Blender", executableCandidates: [], panels: manifest.panels.filter(panel => panel.label === "Shapes"), sources
  } });
  const tree = h.render();
  const labels = installationElements(tree).filter(node => node.props.className === "program-setup__source");
  assert.equal(labels.length, 6);
  assert.deepEqual(labels.flatMap(label => installationElements(label).filter(node => node.type === "span").map(node => node.props.children)).sort(),
    ["Cone", "Cube", "Cylinder", "Hex", "Sphere", "Triangle"]);
  assert.equal(labels.flatMap(installationElements).filter(node => node.type === "input" && node.props.type === "checkbox").length, 6);
  assert.match(renderToStaticMarkup(tree), /6 buttons/);
});

function addProgramCloseHarness(componentName = "AddProgramWindowPage") {
  const source = read(frontendRoot, "src", "pages", "program-setup", `${componentName}.tsx`);
  const parsed = ts.createSourceFile(`${componentName}.tsx`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === componentName);
  const declarations = component.body.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]);
  const initializer = name => declarations.find(node => node.name.getText(parsed) === name).initializer;
  const effect = component.body.statements.find(node => ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) && node.expression.expression.getText(parsed) === "useEffect" &&
    node.expression.arguments[0].getText(parsed).includes(".onCloseRequested("));
  assert.ok(effect, `${componentName} must protect native close requests during setup`);
  let listener;
  let completeRegistration;
  let unlistenCount = 0;
  let closed = false;
  const statuses = [];
  const stateUpdates = [];
  const busyRef = { current: false };
  const requestClose = () => {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    listener(event);
    return event;
  };
  const context = {
    busyRef,
    setBusyState: next => stateUpdates.push(next),
    setStatus: next => statuses.push(next),
    setProgress() {},
    setInstallationComplete() {},
    setReviewed: () => {},
    setCompletedSetup: () => {},
    setSetupStatuses: () => {},
    loadButtonStateDocument: async () => ({}),
    publishButtonCommit: async () => {},
    emitProgramSetupCommitted: async () => {},
    errorMessage: error => String(error),
    installWindows: async () => {},
    setupSource: "package", selectedProgram: { programName: "Fixture" },
    installProgram: async () => context.present({ programName: "Fixture", status: "ready", message: "Added", restartNotes: "" }),
    onWindowsComplete: undefined,
    getCurrentWindow: () => ({
      onCloseRequested(callback) {
        listener = callback;
        return new Promise(resolve => { completeRegistration = () => resolve(() => { unlistenCount += 1; }); });
      },
      async close() { closed = !requestClose().defaultPrevented; }
    })
  };
  const evaluate = node => {
    const compiled = ts.transpileModule(`return (${node.getText(parsed)});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 }
    }).outputText;
    return new Function(...Object.keys(context), compiled)(...Object.values(context));
  };
  context.setBusy = evaluate(initializer("setBusy").arguments[0]);
  if (componentName === "AddProgramWindowPage") context.present = evaluate(initializer("presentSetupResult"));
  const dispose = evaluate(effect.expression.arguments[0])();
  return {
    setBusy: context.setBusy, requestClose, dispose, statuses, stateUpdates,
    present: context.present ?? null,
    install: componentName === "AddProgramWindowPage" ? evaluate(initializer("install")) : null,
    finish: componentName === "AddPanelWindowPage" ? evaluate(initializer("finishSuccess")) : null,
    async registered() { completeRegistration(); await Promise.resolve(); },
    get unlistenCount() { return unlistenCount; },
    get closed() { return closed; }
  };
}

test("Add Program native close follows busy state immediately and releases after setup", async () => {
  const h = addProgramCloseHarness();
  await h.registered();
  assert.equal(h.requestClose().defaultPrevented, false);
  h.setBusy(true);
  assert.equal(h.requestClose().defaultPrevented, true, "X/Alt-F4 must not abandon the pending transaction");
  assert.match(h.statuses.at(-1), /before closing/);
  h.setBusy(false);
  assert.equal(h.requestClose().defaultPrevented, false);
  assert.deepEqual(h.stateUpdates, [true, false]);
  h.dispose();
  assert.equal(h.unlistenCount, 1);
});

test("Add Program removes a close listener that registers after disposal", async () => {
  const h = addProgramCloseHarness();
  h.setBusy(true);
  h.dispose();
  assert.equal(h.unlistenCount, 0);
  await h.registered();
  assert.equal(h.unlistenCount, 1);
  assert.equal(h.requestClose().defaultPrevented, false);
  assert.deepEqual(h.statuses, [], "a disposed listener must not update the old window");
});

test("Add Program retains its completion screen and releases native close after installation", async () => {
  const h = addProgramCloseHarness();
  await h.registered();
  await h.install();
  assert.equal(h.closed, false, "the completion screen remains visible for setup notes and explicit Close");
  assert.equal(h.requestClose().defaultPrevented, false, "the completed transaction must release its close guard");
  assert.deepEqual(h.stateUpdates, [true, false]);
  h.dispose();
});

test("Add Panel blocks native close during setup and releases after completion", async () => {
  const h = addProgramCloseHarness("AddPanelWindowPage");
  await h.registered();
  assert.equal(h.requestClose().defaultPrevented, false);
  h.setBusy(true);
  assert.equal(h.requestClose().defaultPrevented, true);
  assert.match(h.statuses.at(-1), /before closing/);
  await h.finish("Fixture", "Tools");
  assert.equal(h.closed, true);
  assert.deepEqual(h.stateUpdates, [true, false]);
  h.dispose();
  assert.equal(h.unlistenCount, 1);
});

test("Add Panel removes a close listener that arrives after disposal", async () => {
  const h = addProgramCloseHarness("AddPanelWindowPage");
  h.setBusy(true);
  h.dispose();
  await h.registered();
  assert.equal(h.unlistenCount, 1);
  assert.equal(h.requestClose().defaultPrevented, false);
  assert.deepEqual(h.statuses, []);
});

test("Add Button fixes its destination and delegates exact content detection to native auto import", () => {
  const main = read(frontendRoot, "src", "pages", "main", "MainPage.tsx");
  const editor = read(frontendRoot, "src", "button", "editor", "ButtonEditorPage.tsx");
  assert.match(main, /lockImportDestination:\s*true/);
  assert.match(editor, /importKind:\s*"auto"/);
  assert.match(editor, /lockedImportDestination\?\.programName\s*\?\?\s*programName/);
  assert.match(editor, /installed!\.children\.length\s*===\s*0/);
  assert.match(
    editor,
    /initialContext\?\.lockImportDestination[\s\S]{0,180}\?\s*1\s*:\s*0/
  );
  assert.match(editor, /setAutoImportRequest\(\(current\)\s*=>\s*current\s*\+\s*1\)/);
  assert.match(
    editor,
    /handledAutoImportRequestRef\.current\s*=\s*autoImportRequest;\s*void importSource\(\);/
  );
});

test("installed pages use a raw WRY boundary without Tauri initialization scripts", () => {
  const host = read(
    frontendRoot,
    "src",
    "pages",
    "installed-page",
    "InstalledPageWindowPage.tsx"
  );
  const nativeWebview = read(
    frontendRoot,
    "src-tauri",
    "src",
    "program_sources",
    "installed_page_webview.rs"
  );
  const coreWindows = read(frontendRoot, "src", "lib", "coreWindows.ts");
  assert.doesNotMatch(host, /<iframe|srcDoc=|sandbox="allow-scripts"/);
  assert.match(host, /mount_installed_page_webview/);
  assert.match(host, /flowcell-installed-page-native-message/);
  assert.match(host, /hasTauriInternals/);
  assert.match(host, /hasTauriInvoke/);
  assert.match(host, /href:\s*window\.location\.href/);
  assert.match(host, /hasFlowcellPage/);
  assert.match(host, /hasRawWryIpc/);
  assert.match(host, /default-world proof was not received/);
  assert.doesNotMatch(host, /probe_installed_page_webview_security/);
  assert.match(nativeWebview, /parent_webview\.environment\(\)/);
  const rawChildBuilder = nativeWebview.match(
    /WebViewBuilder::new\(\)[\s\S]*?\.build_as_child\(&parent\)/
  )?.[0] ?? "";
  assert.match(
    rawChildBuilder,
    /\.with_environment\(parent_environment\)/,
    "the raw installed-page child must reuse its parent WebView2 environment"
  );
  assert.match(nativeWebview, /security_probe_passed/);
  assert.match(nativeWebview, /compare_exchange\([\s\S]*ISOLATION_PENDING/);
  assert.doesNotMatch(nativeWebview, /evaluate_script_with_callback|recv_timeout/);
  assert.match(nativeWebview, /with_navigation_handler/);
  assert.match(nativeWebview, /with_download_started_handler\(\|_, _\| false\)/);
  assert.match(nativeWebview, /with_new_window_req_handler\(\|_, _\| NewWindowResponse::Deny\)/);
  assert.doesNotMatch(nativeWebview, /WindowEvent::Destroyed/);
  assert.doesNotMatch(nativeWebview, /initialization_script/);
  assert.match(
    host,
    /onCloseRequested[\s\S]*preventDefault\(\)[\s\S]*unmount_installed_page_webview[\s\S]*currentWindow\.destroy\(\)/
  );
  const fatalErrorLifecycleStart = host.indexOf("async function revealInstalledPageError(");
  const fatalErrorLifecycleEnd = host.indexOf("export default", fatalErrorLifecycleStart);
  assert.ok(fatalErrorLifecycleStart >= 0 && fatalErrorLifecycleEnd > fatalErrorLifecycleStart);
  const fatalErrorLifecycle = host.slice(fatalErrorLifecycleStart, fatalErrorLifecycleEnd);
  assert.ok(
    fatalErrorLifecycle.indexOf('await invoke<void>("unmount_installed_page_webview")') <
      fatalErrorLifecycle.indexOf("reveal(message)"),
    "the raw child must unmount before the React error surface is revealed"
  );
  assert.match(
    fatalErrorLifecycle,
    /catch\s*\{[\s\S]*getCurrentWindow\(\)\.destroy\(\)/,
    "a failed fatal-error unmount must close the parent instead of leaving the raw child over React"
  );
  const closeLifecycleStart = host.indexOf("const disposeClose = await currentWindow.onCloseRequested");
  const closeLifecycleEnd = host.indexOf("\n      if (disposed)", closeLifecycleStart);
  assert.ok(closeLifecycleStart >= 0 && closeLifecycleEnd > closeLifecycleStart);
  const closeLifecycle = host.slice(closeLifecycleStart, closeLifecycleEnd);
  assert.ok(
    closeLifecycle.indexOf('await invoke<void>("unmount_installed_page_webview")') <
      closeLifecycle.indexOf("await currentWindow.destroy()"),
    "close must attempt child unmount before destroying the parent"
  );
  assert.match(
    closeLifecycle,
    /try\s*\{[\s\S]*unmount_installed_page_webview[\s\S]*\}\s*catch\s*\{[\s\S]*\}\s*try\s*\{[\s\S]*currentWindow\.destroy\(\)/,
    "close must still destroy the parent when child unmount fails"
  );
  assert.match(host, /resize_installed_page_webview[\s\S]*catch\(\(reason\) => \{[\s\S]*failPage\(reason\)/);
  assert.match(host, /default-world proof was not received\."\)/);
  assert.match(
    host,
    /await currentWindow\.onCloseRequested[\s\S]*await invoke\("mount_installed_page_webview"/
  );
  assert.match(
    coreWindows,
    /existing\.close\(\)\.catch\([\s\S]*waitForManagedWindowToDisappear\(\{[\s\S]*lookup:\s*\(\) => WebviewWindow\.getByLabel\(label\)/
  );
  assert.match(coreWindows, /registerLayoutWindow\(\{[\s\S]*kind:\s*"installed-page"/);
  assert.match(coreWindows, /installedPageFileName:\s*args\.fileName/);
  assert.match(coreWindows, /installedPageId:\s*args\.pageId/);
  assert.match(coreWindows, /resolveInstalledPageOpenDescriptor[\s\S]*resolve_installed_page/);
  assert.match(coreWindows, /resolveAndOpenInstalledPageWindow[\s\S]*resolveInstalledPageOpenDescriptor/);
  assert.match(coreWindows, /savedBounds:\s*args\.bounds/);
  assert.match(coreWindows, /placement\.unit === "physical"[\s\S]*new PhysicalPosition/);
  assert.match(coreWindows, /placement\.unit === "physical"[\s\S]*new PhysicalSize/);
  assert.match(
    coreWindows,
    /timeoutMs:\s*INSTALLED_PAGE_WINDOW_CLOSE_TIMEOUT_MS[\s\S]*pollMs:\s*INSTALLED_PAGE_WINDOW_CLOSE_POLL_MS[\s\S]*throw closeError \?\? error[\s\S]*unregisterLayoutWindow\(label\)/
  );
  assert.match(
    coreWindows,
    /openInstalledPageWindow[\s\S]*decorations:\s*true,[\s\S]*programName:\s*args\.programName/,
    "every installed page must use standard draggable window chrome"
  );
  for (const directive of [
    "default-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "worker-src 'none'"
  ]) {
    assert.ok(host.includes(directive), `host is missing CSP directive ${directive}`);
    assert.ok(nativeWebview.includes(directive), `native webview is missing CSP directive ${directive}`);
  }
  assert.match(host, /run_installed_page_action/);
  assert.match(host, /complete_installed_page_core_action/);
  assert.match(host, /sanitizeEntryHtml/);
});

test("installed-page styles stay scoped away from transparent Pop and Fan roots", () => {
  const styles = read(
    frontendRoot,
    "src",
    "pages",
    "installed-page",
    "installedPageWindowPage.css"
  );
  assert.match(styles, /\.installed-page-host\s*\{/);
  assert.doesNotMatch(styles, /(^|,)\s*(?::root|html|body|#root)\s*(?:,|\{)/m);
});

test("generated page Buttons update by authenticated package identity instead of duplicating", () => {
  const broker = read(
    frontendRoot,
    "src",
    "pages",
    "installed-page",
    "installedPageCoreBroker.ts"
  );
  const nativePage = read(
    frontendRoot,
    "src-tauri",
    "src",
    "program_sources",
    "installed_page.rs"
  );
  assert.match(nativePage, /AuthorizedGeneratedStage[\s\S]*package_id:\s*String/);
  assert.match(nativePage, /package_id:\s*stage\.paths\.package_id/);
  assert.match(broker, /authorizedStage\.packageId/);
  assert.match(broker, /subtle\.digest\("SHA-256"/);
  assert.match(broker, /existingOwner\s*\?\s*updateButtonSource\s*:\s*installButtonSource/);
  assert.match(broker, /applyInstalledSourceUpdate\(next, installed\)/);
  assert.match(broker, /finalizeButtonSourceUpdate\(/);
  assert.match(broker, /rollbackButtonSourceUpdate\(/);
  assert.match(broker, /outcome\s*===\s*"finalized"/);
  assert.match(broker, /existingOwner\?\.sourceIdentity\?\.displayPanelName\s*\|\|\s*panelName/);
  assert.doesNotMatch(broker, /createStableButtonId\("button-generated"\)/);
  assert.match(
    read(frontendRoot, "src", "button", "state", "ButtonStateRepository.ts"),
    /invoke<Record<string, unknown>>\("update_button_source"/
  );
  const sourceUpdates = read(
    frontendRoot,
    "src",
    "button",
    "state",
    "sourceUpdateOperations.ts"
  );
  assert.match(sourceUpdates, /flowcellSourceRevision:\s*installed\.updateTransactionToken/);
  assert.match(
    read(frontendRoot, "src-tauri", "src", "main.rs"),
    /program_sources::install::update_button_source/
  );
});

test("installed-page Button-theme palette is live Pop-out/Fan scoped, stale-scan guarded, and read-only on scan", () => {
  const broker = read(
    frontendRoot,
    "src",
    "pages",
    "installed-page",
    "installedPageCoreBroker.ts"
  );
  const nativePage = read(
    frontendRoot,
    "src-tauri",
    "src",
    "program_sources",
    "installed_page.rs"
  );
  const helper = read(frontendRoot, "src", "theme", "programPopoutPalette.ts");
  const popoutOperations = read(
    frontendRoot,
    "src",
    "button",
    "state",
    "buttonPopoutInteractionOperations.ts"
  );
  const popoutRenderer = read(
    frontendRoot,
    "src",
    "button",
    "popout",
    "ButtonPopoutRenderer.tsx"
  );
  const fanRenderer = read(
    frontendRoot,
    "src",
    "button",
    "fan",
    "ButtonFanRenderer.tsx"
  );
  const buttonWindows = read(
    frontendRoot,
    "src",
    "button",
    "windows",
    "buttonWindows.ts"
  );
  assert.match(nativePage, /CORE_PAGE_CAPABILITIES[\s\S]*"button-theme\.palette"/);
  assert.match(broker, /case "button-theme\.palette": return runButtonThemePalette\(identity, options, payload\)/);
  assert.match(broker, /WebviewWindow\.getAll\(\)/);
  assert.match(broker, /readRegisteredLayoutWindow\(handle\.label\)/);
  assert.match(broker, /snapshotBounds:\s*registered\.snapshotBounds/);
  assert.match(broker, /monitorFromPoint\(/);
  assert.match(broker, /programPopoutPaletteScreenPositions\(/);
  assert.match(broker, /registered\.kind !== "button-popout" && registered\.kind !== "button-fan"/);
  assert.match(broker, /registered\.kind === "button-popout"/);
  assert.match(broker, /candidate\.windowKind === "button-popout"[\s\S]{0,100}if \(!popoutUnit\)/);
  assert.match(broker, /candidate\.displayMode === "collapsed" && popoutUnit\.interactionMode !== "fan"/);
  assert.match(broker, /handle\.isVisible\(\)/);
  assert.match(broker, /expandedButtonPopoutPlacementIds\(document, unit\)/);
  assert.match(broker, /expandedFanPlacementIds\(document, candidate\.fanSetupId, programName\)/);
  assert.match(broker, /resolvePanelOwnerFanPlacement\(document, setup\.id\)/);
  assert.match(popoutRenderer, /expandedButtonPopoutPlacementIds\(document, unit\)/);
  assert.match(popoutOperations, /unit\.interactionMode === "fan"[\s\S]{0,160}surface\.placementIds/);
  assert.match(broker, /if \(registered\.buttonDraftSessionId\?\.trim\(\)\) \{\s*return;/);
  assert.match(broker, /Promise\.all\(handles\.map\(async \(handle\)/);
  assert.match(buttonWindows, /kind: "button-fan"[\s\S]{0,240}buttonDraftSessionId: args\.draftSessionId/);
  assert.match(fanRenderer, /const sourceThemeOverride = .*themeOverrides\?\.\[sourcePlacement\.id\]/);
  assert.match(popoutRenderer, /savedOwnerPlacement\s*\? \{ placement: savedOwnerPlacement, themeOverride: document\.themeOverrides\?\.\[savedOwnerPlacement\.id\] \}/);
  assert.match(popoutRenderer, /: unit\.kind === "tool-set"\s*\? createButtonPopoutOwnerPlacement\(/);
  assert.match(popoutOperations, /const appearanceTheme = appearanceSource && document\.themeOverrides\?\.\[appearanceSource\.id\]/);
  assert.match(popoutOperations, /themeOverride: cloneButtonDocument\(appearanceTheme\)/);
  assert.match(popoutRenderer, /sourceThemeOverride: collapsedOwnerSource\.themeOverride/);
  assert.match(popoutRenderer, /const sourceThemeOverride = args\.sourceThemeOverride/);
  for (const renderer of [fanRenderer, popoutRenderer]) {
    assert.match(renderer, /themeOverrides: sourceThemeOverride[\s\S]{0,180}\[placementId\]: sourceThemeOverride/);
  }
  assert.match(broker, /buttonPopoutSettingsPath/);
  assert.match(broker, /requestLiveButtonDraft\(sessionId, requesterLabel\)/);
  assert.match(broker, /assertRememberedPopoutPaletteScan/);
  assert.match(broker, /remembered\.fingerprint !== fingerprint/);
  assert.match(broker, /saveButtonStateDocument\(canonicalGroup\.document, current\.revision\)/);
  assert.match(broker, /publishButtonCommit\(savedCanonical\)/);
  assert.match(broker, /publishButtonDraft\(group\.draftSessionId!, group\.document\)/);
  assert.match(
    broker,
    /const allBlack = hasTargets && scope\.groups\.every\([\s\S]*programPopoutPaletteTargetsHaveTextColor/
  );
  assert.match(
    broker,
    /operation === "toggle-text"[\s\S]*nextLiveProgramPopoutTextColor\(live,[\s\S]*applyLiveProgramPopoutTextColor\(live,[\s\S]*commitLiveProgramPopoutPalette\(current, result\)/
  );
  const runStart = broker.indexOf("async function runButtonThemePalette(");
  const nextStart = broker.indexOf("async function runSaveFields(", runStart);
  const runSource = broker.slice(runStart, nextStart);
  const scanStart = runSource.indexOf('operation === "scan"');
  const applyStart = runSource.indexOf('operation === "apply"');
  assert.ok(runStart >= 0 && nextStart > runStart && scanStart >= 0 && applyStart > scanStart);
  assert.doesNotMatch(runSource.slice(scanStart, applyStart), /saveButtonStateDocument|publishButtonCommit/);
  assert.doesNotMatch(runSource, /payload[^\n]*programName|programName[^\n]*payload/);
  assert.doesNotMatch(helper, /Object\.values\(document\.popoutUnits\)/);
  assert.match(helper, /scanProgramPopoutPaletteTargets/);
  assert.match(helper, /placementMatchesThemeTarget/);
  assert.match(helper, /PROGRAM_POPPED_PALETTE_SURFACE_KINDS[\s\S]*"fan"/);
  assert.match(helper, /applyProgramPopoutTextColorTargets[\s\S]*override\.colors\.text = color/);
  assert.doesNotMatch(helper, /setButtonSkinTextColor/);
  assert.match(
    helper,
    /programPopoutGradientColor\(\{[\s\S]*placementId:\s*paletteId/
  );
  assert.match(broker, /colors:\s*Array\.isArray\(payload\.colors\)/);
  assert.match(helper, /visibleBounds\.Top[\s\S]*envelope\.y[\s\S]*monitorWorkArea\.Top/);
  assert.match(
    broker,
    /screenTopToBottom\s*\?\s*\{\s*minimumY:\s*0,\s*maximumY:\s*1\s*\}\s*:\s*undefined/
  );
  assert.doesNotMatch(runSource, /outerPosition\(/);
});

test("installed pages can opt into fixed always-on-top window behavior", () => {
  const appBase = read(frontendRoot, "src", "AppBase.tsx");
  const coreWindows = read(frontendRoot, "src", "lib", "coreWindows.ts");
  const windowContext = read(frontendRoot, "src", "lib", "windowContext.ts");
  const mainPage = read(frontendRoot, "src", "pages", "main", "MainPage.tsx");

  assert.match(coreWindows, /alwaysOnTop:\s*options\.alwaysOnTop\s*\?\?\s*false/);
  assert.match(coreWindows, /programName\s*&&\s*!options\.alwaysOnTop/);
  assert.match(
    coreWindows,
    /if \(options\.alwaysOnTop\)[\s\S]*await unregisterScopedWindowTopmost\(options\.label\);/
  );
  assert.match(
    coreWindows,
    /if \(options\.alwaysOnTop\)[\s\S]*else \{[\s\S]*setAlwaysOnTop\(false\)[\s\S]*registerScopedWindowTopmost[\s\S]*refreshScopedWindowTopmost/
  );
  assert.match(coreWindows, /alwaysOnTop:\s*descriptor\.window\.alwaysOnTop/);
  assert.match(windowContext, /alwaysOnTop:\s*parsed\.alwaysOnTop\s*===\s*true/);
  assert.match(appBase, /if \(fixedAlwaysOnTop\)[\s\S]*applyTopmost\(true\)/);
  assert.match(mainPage, /alwaysOnTop:\s*descriptor\.window\.alwaysOnTop/);
});

test("Illustrator page bridge reacquires stale COM once without replaying script errors", () => {
  const bridge = read(
    repoRoot,
    "Programs",
    "Illustrator",
    "SupportScripts",
    "Start-IllustratorFlowCellBridge.ps1"
  );
  assert.match(bridge, /Test-IsStaleIllustratorComError/);
  assert.match(bridge, /0x800706BA\|RPC server is unavailable/);
  assert.match(bridge, /for \(\$attempt = 0; \$attempt -lt 2; \$attempt \+= 1\)/);
  assert.match(bridge, /\$script:IllustratorApp = \$null/);
  assert.match(bridge, /-not \(Test-IsStaleIllustratorComError -Exception \$_\.Exception\)/);
});

test("all Tauri-owned Illustrator actions share the native persistent bridge", () => {
  const execution = read(
    frontendRoot,
    "src-tauri",
    "src",
    "commands",
    "execution.rs"
  );
  const bridge = read(
    repoRoot,
    "Programs",
    "Illustrator",
    "SupportScripts",
    "Start-IllustratorFlowCellBridge.ps1"
  );
  const programExecution = read(
    frontendRoot,
    "src-tauri",
    "src",
    "program_sources",
    "execute.rs"
  );
  assert.ok(execution.includes(String.raw`\\.\pipe\FlowCell.Illustrator.Bridge.v2`));
  assert.match(execution, /ILLUSTRATOR_BRIDGE_PROTOCOL_VERSION: u64 = 2/);
  assert.match(execution, /Illustrator bridge protocol mismatch/);
  assert.match(execution, /run_illustrator_bridge_action_direct/);
  assert.match(execution, /"-NoPrewarm"/);
  assert.match(execution, /async fn connect_running_layout_programs/);
  assert.doesNotMatch(execution, /start_illustrator_bridge_prewarm_worker|ILLUSTRATOR_PROCESS_POLL_MS/);
  assert.match(execution, /find_running_process_executable\(&manifest\.process_names\)/);
  assert.doesNotMatch(execution, /find_running_illustrator_process_id/);
  assert.match(execution, /connect_layout_programs_once\(&program_names, prepare_running_program_connection\)/);
  assert.match(execution, /ILLUSTRATOR_BRIDGE_PREWARM_IN_PROGRESS/);
  assert.match(execution, /IllustratorBridgeSendFailure::Busy/);
  assert.doesNotMatch(execution, /illustrator_bridge_pid_is_alive/);
  assert.match(execution, /"command": "prewarm"/);
  assert.match(bridge, /FlowCell\.Illustrator\.Bridge\.v2/);
  assert.match(bridge, /BridgeProtocolVersion = 2/);
  assert.match(bridge, /protocolVersion/);
  assert.match(bridge, /GetActiveObject\('Illustrator.Application'\)/);
  assert.doesNotMatch(bridge, /New-Object -ComObject Illustrator.Application/);
  assert.match(bridge, /Another Illustrator bridge process already owns pipe/);
  assert.match(bridge, /Global\\FlowCell\.Illustrator\.Bridge\.Process/);
  assert.doesNotMatch(execution, /run_illustrator_backend_script_direct|FLOWCELL_DIRECT_SCRIPT/);
  assert.match(execution, /pub\(crate\) async fn run_panel_script_response\(/);
  assert.match(execution, /Panel script task failed/);
  assert.match(programExecution, /execution\.get\("waitForCompletion"\)/);
  assert.equal(
    programExecution.match(/run_illustrator_bridge_action_direct/g)?.length,
    3,
    "single scripts, tool sets, and page capabilities must use the same bridge"
  );
});

test("scoped-window IPC cannot block the main thread during installed-page WebView focus", () => {
  const windows = read(
    frontendRoot,
    "src-tauri",
    "src",
    "commands",
    "windows.rs"
  );
  for (const command of [
    "register_scoped_window_topmost",
    "unregister_scoped_window_topmost",
    "get_scoped_window_input_state",
    "refresh_scoped_window_topmost"
  ]) {
    assert.match(
      windows,
      new RegExp(`pub\\(crate\\) async fn ${command}\\(`),
      `${command} must execute off the main thread while sharing the worker apply lock`
    );
  }
  assert.match(
    windows,
    /let valid_scoped_continuation\s*=\s*foreground_is_scoped_window\s*&&\s*last_external_matches_target;/,
    "full installed pages and transparent hosts must only bind to their matching program"
  );
  assert.match(
    windows,
    /if\s+!entry\.selective_input\s*\{\s*window\.set_ignore_cursor_events\(false\)/,
    "full installed pages must never inherit transparent-host click-through"
  );
});

test("scoped native placement does not enqueue an intermediate Tauri Z-order change", () => {
  const windows = read(frontendRoot, "src-tauri", "src", "commands", "windows.rs");
  const placement = windows.slice(
    windows.indexOf("fn set_scoped_native_window_placement"),
    windows.indexOf("fn set_native_window_topmost")
  );
  assert.ok(placement.length > 0);
  assert.doesNotMatch(placement, /set_always_on_top/);
  assert.match(placement, /SetWindowPos\(/);
  assert.match(placement, /SWP_NOACTIVATE/);
});

test("Blender Theme and Illustrator Layer Tree are ordinary program-owned page sources", () => {
  const cases = [
    ["Blender", "Blender Git Scripts", "Toolsets", "theme", "flowcell.script.json"],
    ["Illustrator", "Illustrator Git Scripts", "LayersBuilder", "flowcell.script.json"]
  ];
  for (const parts of cases) {
    const manifest = JSON.parse(read(repoRoot, "Programs", ...parts));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.program, parts[0]);
    assert.ok(manifest.page);
    assert.equal(manifest.page.program, parts[0]);
    assert.equal(manifest.page.schemaVersion, 1);
    assert.ok(manifest.page.entry.startsWith("page/"));
    assert.ok(Array.isArray(manifest.page.actions) && manifest.page.actions.length > 0);
    const serialized = JSON.stringify(manifest);
    assert.doesNotMatch(serialized, /theme-workbench|tree-inspector|open-tool-page/);
  }
});

test("Core contains no retired product page routes, actions, modules, or fallbacks", () => {
  const retiredPaths = [
    ["src", "button", "toolPages"],
    ["src", "pages", "build-layers"],
    ["src", "pages", "organization-setup"],
    ["src", "features", "organization"],
    ["src", "button", "runtime", "registerInstalledCompatibilityActions.ts"],
    ["src", "button", "runtime", "registerLegacyProgramCoreActions.ts"],
    ["src", "button", "state", "organizationProfileButtonOperations.ts"],
    ["src", "button", "state", "toolPageLifecycle.ts"],
    ["src", "lib", "illustratorLayers.ts"],
    ["src-tauri", "src", "commands", "illustrator.rs"],
    ["src-tauri", "src", "commands", "organization.rs"],
    ["src-tauri", "src", "commands", "tool_state.rs"]
  ];
  for (const parts of retiredPaths) {
    assert.equal(existsSync(join(frontendRoot, ...parts)), false, parts.join("/"));
  }

  const themeStorage = read(frontendRoot, "src-tauri", "src", "commands", "themes.rs");
  assert.match(themeStorage, /resolve_theme_directory/);
  assert.match(themeStorage, /require_registered_program_name/);
  assert.doesNotMatch(themeStorage, /fn (?:sample_blender_theme|save_blender_theme|load_blender_theme)/);

  const runtimeFiles = [
    ["src", "AppBase.tsx"],
    ["src", "lib", "coreWindows.ts"],
    ["src", "lib", "windowContext.ts"],
    ["src", "pages", "main", "MainPage.tsx"],
    ["src", "button", "popout", "ButtonPopoutRenderer.tsx"],
    ["src", "pages", "window-grid", "WindowGridWindowPage.tsx"],
    ["src", "button", "runtime", "registerBuiltinCoreActions.ts"],
    ["src-tauri", "capabilities", "default.json"],
    ["src-tauri", "src", "main.rs"],
    ["src-tauri", "src", "commands", "mod.rs"],
    ["src-tauri", "src", "program_sources", "install.rs"],
    ["src-tauri", "src", "program_sources", "installed_page.rs"]
  ];
  const forbidden = /organization-setup|build-layers|flowcell-tool-page|open-tool-page|open-illustrator-layer-tree|illustrator-layer-tree|theme-workbench|sample-blender-theme|save-blender-theme|load-blender-theme|legacy-state\.read/i;
  for (const parts of runtimeFiles) {
    const raw = read(frontendRoot, ...parts);
    const runtimeOnly = parts.at(-1)?.endsWith(".rs")
      ? raw.split("#[cfg(test)]", 1)[0]
      : raw;
    assert.doesNotMatch(runtimeOnly, forbidden, parts.join("/"));
  }
});

test("generated Button staging is token-bound, hash-verified, and product-neutral in Core", () => {
  const broker = read(
    frontendRoot,
    "src",
    "pages",
    "installed-page",
    "installedPageCoreBroker.ts"
  );
  const native = read(
    frontendRoot,
    "src-tauri",
    "src",
    "program_sources",
    "installed_page.rs"
  );
  const nativeRuntime = native.split("#[cfg(test)]", 1)[0];
  assert.match(broker, /const stageToken = stringValue\(payload, "stageToken"\)/);
  assert.match(broker, /invoke<AuthorizedGeneratedStage>[\s\S]*stageToken,[\s\S]*stagedSourcePath/);
  assert.match(broker, /sourcePath:\s*authorizedStage\.manifestPath/);
  assert.match(
    broker,
    /discard_installed_page_generated_stage[\s\S]*stageToken,[\s\S]*authorizedStage\.manifestPath/
  );
  assert.match(native, /struct GeneratedStageManifest/);
  assert.match(native, /deny_unknown_fields/);
  assert.match(native, /source\/flowcell\.script\.json/);
  assert.match(native, /source manifest SHA-256 does not match stage\.json/);
  assert.match(native, /script SHA-256 does not match stage\.json/);
  assert.doesNotMatch(
    nativeRuntime,
    /windows\.setup-organization|flowcell\.windows\.setup-organization/
  );
});


test("theme library preflight reports contribution versions and legacy assets without applying or staging", async () => {
  const source = read(frontendRoot, "src", "pages", "theme", "ThemeContribution.tsx");
  const parsed = ts.createSourceFile("ThemeContribution.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ["record", "declaredAssetPaths", "reviewThemeContribution"];
  const functions = parsed.statements.filter((statement) => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text))
    .map((statement) => statement.getText(parsed).replace(/^export /, "")).join("\n");
  const compiled = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = [];
  const review = new Function("invoke", `${compiled}\nreturn reviewThemeContribution;`)(async (command, payload) => {
    calls.push({ command, payload });
    throw new Error("Required theme asset 'C:/missing.hdr' was not found.");
  });
  const controller = {
    sourceId: "example.theme",
    capture: async () => ({ sourceId: "example.theme", sourceVersion: "2.0.0", state: { fields: {} }, assetFields: ["fields.picture"] }),
    validate: async () => {},
    loadLegacy: async () => ({ state: { fields: { picture: "C:/missing.hdr" } } }),
    stage: () => { throw new Error("Preview must not stage"); },
    apply: () => { throw new Error("Preview must not apply"); }
  };
  const contribution = { sourceId: "example.theme", sourceVersion: "1.0.0", state: { fields: {} }, assetFields: ["fields.other"] };
  let issues = await review(controller, { portable: { contributions: { example: contribution } }, legacy: null });
  assert.equal(issues.length, 2);
  assert.match(issues[0], /1\.0\.0.*2\.0\.0/);
  assert.match(issues[1], /asset declarations/);
  assert.deepEqual(calls, []);
  issues = await review(null, { portable: { contributions: { example: contribution } }, legacy: null });
  assert.match(issues[0], /installed theme features/);
  issues = await review(controller, { path: "legacy.json", portable: null, legacy: {} });
  assert.match(issues[0], /missing\.hdr/);
  assert.deepEqual(calls, [{ command: "validate_flowcell_theme_assets", payload: { paths: ["C:/missing.hdr"] } }]);
});

test("theme preview accepts embedded raster signatures and never renders SVG or external markup", () => {
  const source = read(frontendRoot, "src", "pages", "theme", "ThemeLibraryDialog.tsx");
  const parsed = ts.createSourceFile("ThemeLibraryDialog.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = parsed.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "portableThemeThumbnail");
  const compiled = ts.transpileModule(fn.getText(parsed).replace(/^export /, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const thumbnail = new Function(`${compiled}\nreturn portableThemeThumbnail;`)();
  const svg = Buffer.from('<svg onload="alert(1)"></svg>').toString("base64");
  assert.equal(thumbnail({ assets: [{ path: "pretend.png", base64: svg }] }), null);
  assert.equal(thumbnail({ assets: [{ url: "https://example.invalid/image.png" }] }), null);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString("base64");
  assert.equal(thumbnail({ assets: [{ base64: svg }, { base64: png }] }), `data:image/png;base64,${png}`);
});
