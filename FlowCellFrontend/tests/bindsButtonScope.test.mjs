import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { deriveBindsPanelButtonScope } from "./.compiled-button-system/lib/bindsButtonScope.js";
import { deriveBindsPanelMacroScope } from "./.compiled-button-system/lib/bindsMacroScope.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const flushBinds = () => new Promise(resolve => setImmediate(resolve));

function bindsRefreshHarness({ lateRegistration = false, prefill = null } = {}) {
  const source = readFileSync(new URL("../src/pages/binds/BindsWindowPage.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("BindsWindowPage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "BindsWindowPage");
  const declarations = component.body.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]);
  const reload = declarations.find(node => node.name.getText(parsed) === "reloadWorkspace").initializer;
  const effect = component.body.statements.find(node => ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) && node.expression.expression.getText(parsed) === "useEffect" &&
    node.expression.arguments[0].getText(parsed).includes("PROGRAM_SETUP_COMMITTED_EVENT"));
  assert.ok(effect, "Binds must listen for completed program setup");
  const helpers = parsed.statements.filter(node => ts.isFunctionDeclaration(node) &&
    ["formatErrorMessage", "findProgram", "findPanel", "findButton", "reconcileSelection"].includes(node.name?.text))
    .map(node => node.getText(parsed)).join("\n");
  const requests = [], registrations = [], listeners = new Map(), events = [];
  let workspace = null, loadError = "", selection = null, macroId = "", unlistened = 0;
  const env = {
    context: { prefill }, workspaceMountedRef: { current: false }, workspaceLoadSequenceRef: { current: 0 },
    workspaceRef: { current: null }, selectionRef: { current: { programName: "", panelName: "", buttonId: "" } },
    shortcutInputRef: { current: { focus() {} } }, window: { setTimeout: fn => fn() },
    setWorkspace: value => { workspace = value; }, setSelection: value => { selection = value; },
    setSelectedMacroId: value => { macroId = typeof value === "function" ? value(macroId) : value; },
    setLoadError: value => { loadError = value; }, setTargetMode: () => {}, deriveBindsPanelMacroScope,
    MACRO_PANEL_CHANGED_EVENT: "macro", PROGRAM_SETUP_COMMITTED_EVENT: "setup",
    loadBindsWorkspace() { events.push("read"); const request = deferred(); requests.push(request); return request.promise; },
    listen(name, callback) {
      events.push(`subscribe:${name}`); listeners.set(name, callback);
      const remove = () => { listeners.delete(name); unlistened += 1; };
      if (!lateRegistration) return Promise.resolve(remove);
      const registration = deferred(); registrations.push(() => registration.resolve(remove)); return registration.promise;
    }
  };
  const evaluate = node => {
    const compiled = ts.transpileModule(`${helpers}\nreturn (${node.getText(parsed)});`,
      { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function(...Object.keys(env), compiled)(...Object.values(env));
  };
  env.reloadWorkspace = evaluate(reload);
  const dispose = evaluate(effect.expression.arguments[0])();
  return { requests, registrations, events, dispose, env, emit: name => listeners.get(name)?.({ payload: {} }),
    get workspace() { return workspace; }, get loadError() { return loadError; }, get selection() { return selection; },
    get unlistened() { return unlistened; } };
}

function refreshWorkspace(tag = "fresh") {
  return { tag, macros: [], bindings: { actionHotkeys: {} }, programs: [{ name: "Illustrator", panels: [{ name: "Tools",
    buttons: [{ id: "first" }, { id: "ill-align" }] }] }] };
}

test("Binds recovers an initial installation-gap error after setup commit without losing prefill", async () => {
  const h = bindsRefreshHarness({ prefill: { programName: "Illustrator", panelName: "Tools", buttonId: "ill-align" } });
  await flushBinds();
  assert.deepEqual(h.events, ["subscribe:macro", "subscribe:setup", "read"], "both listeners precede the initial read");
  h.requests[0].reject(new Error("missing canonical owner ill-align"));
  await flushBinds();
  assert.match(h.loadError, /missing canonical owner/);
  h.emit("setup"); h.requests[1].resolve(refreshWorkspace());
  await flushBinds();
  assert.equal(h.loadError, ""); assert.equal(h.workspace.tag, "fresh"); assert.equal(h.selection.buttonId, "ill-align");
  h.dispose(); assert.equal(h.unlistened, 2);
});

test("Binds ignores stale in-flight errors and results after the committed reload succeeds", async () => {
  for (const staleOutcome of ["error", "success"]) {
    const h = bindsRefreshHarness(); await flushBinds();
    h.emit("setup"); h.requests[1].resolve(refreshWorkspace("committed")); await flushBinds();
    if (staleOutcome === "error") h.requests[0].reject(new Error("old installation gap"));
    else h.requests[0].resolve(refreshWorkspace("obsolete"));
    await flushBinds();
    assert.equal(h.workspace.tag, "committed"); assert.equal(h.loadError, "");
    h.dispose();
  }
});

test("Binds preserves the current selection on refresh and retains a genuine latest error", async () => {
  const h = bindsRefreshHarness(); await flushBinds(); h.requests[0].resolve(refreshWorkspace()); await flushBinds();
  h.env.selectionRef.current = { programName: "Illustrator", panelName: "Tools", buttonId: "ill-align" };
  h.emit("macro"); h.requests[1].resolve(refreshWorkspace("macro refresh")); await flushBinds();
  assert.equal(h.selection.buttonId, "ill-align");
  h.emit("setup"); h.requests[2].reject(new Error("actual persistent read error")); await flushBinds();
  assert.equal(h.loadError, "actual persistent read error"); assert.equal(h.workspace.tag, "macro refresh"); h.dispose();
});

test("Binds cleans up late listener registration and ignores completion after unmount", async () => {
  const late = bindsRefreshHarness({ lateRegistration: true });
  late.dispose(); late.emit("macro"); late.registrations[0](); await flushBinds();
  assert.equal(late.unlistened, 1); assert.equal(late.requests.length, 0);
  const h = bindsRefreshHarness(); await flushBinds(); h.dispose();
  h.requests[0].resolve(refreshWorkspace()); await flushBinds();
  assert.equal(h.workspace, null); assert.equal(h.loadError, ""); assert.equal(h.unlistened, 2);
});

const buttons = [
  {
    id: "Blender::Tools::single.flowcell-source.json",
    label: "Single",
    kind: "script",
    target: "single.py"
  },
  {
    id: "Blender::Tools::owner-a.flowcell-source.json",
    label: "Rotate",
    kind: "tool-set-owner",
    target: "owner-a",
    ownerButtonId: "owner-a"
  },
  {
    id: "a-child-1",
    label: "Rotate / Positive",
    kind: "tool-set-child",
    target: "a-child-1",
    ownerButtonId: "owner-a"
  },
  {
    id: "a-child-2",
    label: "Rotate / Negative",
    kind: "tool-set-child",
    target: "a-child-2",
    ownerButtonId: "owner-a"
  },
  {
    id: "Blender::Tools::owner-b.flowcell-source.json",
    label: "Align",
    kind: "tool-set-owner",
    target: "owner-b",
    ownerButtonId: "owner-b"
  },
  {
    id: "b-child-1",
    label: "Rotate / Negative",
    kind: "tool-set-child",
    target: "b-child-1",
    ownerButtonId: "owner-b"
  }
];

test("toolbar contains only top-level entries and ordinary selection hides every child", () => {
  const scope = deriveBindsPanelButtonScope(
    buttons,
    "Blender::Tools::single.flowcell-source.json"
  );

  assert.deepEqual(
    scope.toolbarButtons.map((button) => button.id),
    [
      "Blender::Tools::single.flowcell-source.json",
      "Blender::Tools::owner-a.flowcell-source.json",
      "Blender::Tools::owner-b.flowcell-source.json"
    ]
  );
  assert.deepEqual(
    scope.currentPanelButtons.map((button) => button.id),
    scope.toolbarButtons.map((button) => button.id)
  );
  assert.equal(scope.toolbarButtonId, "Blender::Tools::single.flowcell-source.json");
});

test("owner selection scopes Current Panel Binds to that owner and only its children", () => {
  const scope = deriveBindsPanelButtonScope(
    buttons,
    "Blender::Tools::owner-a.flowcell-source.json"
  );

  assert.deepEqual(
    scope.currentPanelButtons.map((button) => button.id),
    ["Blender::Tools::owner-a.flowcell-source.json", "a-child-1", "a-child-2"]
  );
  assert.deepEqual(
    scope.toolbarButtons.map((button) => button.id),
    [
      "Blender::Tools::single.flowcell-source.json",
      "Blender::Tools::owner-a.flowcell-source.json",
      "a-child-1",
      "a-child-2",
      "Blender::Tools::owner-b.flowcell-source.json"
    ]
  );
  assert.equal(scope.toolbarButtonId, "Blender::Tools::owner-a.flowcell-source.json");
});

test("child selection preserves its owner scope and names the exact child in the toolbar", () => {
  const scope = deriveBindsPanelButtonScope(buttons, "a-child-2");

  assert.deepEqual(
    scope.currentPanelButtons.map((button) => button.id),
    ["Blender::Tools::owner-a.flowcell-source.json", "a-child-1", "a-child-2"]
  );
  assert.equal(scope.toolbarButtonId, "a-child-2");
  assert.equal(scope.toolbarButtons.some((button) => button.id === "a-child-2"), true);
  assert.equal(scope.currentPanelButtons.some((button) => button.id === "b-child-1"), false);
});

test("selecting another owner replaces the entire visible tool-set group", () => {
  const scope = deriveBindsPanelButtonScope(
    buttons,
    "Blender::Tools::owner-b.flowcell-source.json"
  );

  assert.deepEqual(
    scope.currentPanelButtons.map((button) => button.id),
    ["Blender::Tools::owner-b.flowcell-source.json", "b-child-1"]
  );
  assert.equal(scope.toolbarButtonId, "Blender::Tools::owner-b.flowcell-source.json");
});

const macros = [
  {
    id: "macro_delete_layer",
    label: "Delete layer",
    programName: "Adobe Fresco",
    panelName: "Layers",
    fileName: "macro_delete_layer.ini",
    createdAt: "1",
    updatedAt: "2"
  },
  {
    id: "macro_duplicate_layer",
    label: "Duplicate layer",
    programName: "Adobe Fresco",
    panelName: "Layers",
    fileName: "macro_duplicate_layer.ini",
    createdAt: "1",
    updatedAt: "2"
  },
  {
    id: "macro_blender_collection",
    label: "New collection",
    programName: "Blender",
    panelName: "Collections",
    fileName: "macro_blender_collection.ini",
    createdAt: "1",
    updatedAt: "2"
  }
];

test("macro scope projects only the selected panel and exposes its saved shortcuts", () => {
  const scope = deriveBindsPanelMacroScope(
    macros,
    { macro_delete_layer: "^+2" },
    "adobe fresco",
    "layers",
    "macro_delete_layer"
  );

  assert.deepEqual(
    scope.macroButtons.map((macro) => macro.target),
    ["macro_delete_layer", "macro_duplicate_layer"]
  );
  assert.equal(scope.macroButtons[0].kind, "macro");
  assert.equal(scope.macroButtons[0].shortcut, "^+2");
  assert.equal(scope.selectedMacroId, "macro_delete_layer");
});

test("macro scope falls back inside the selected panel and clears for an empty panel", () => {
  const localScope = deriveBindsPanelMacroScope(
    macros,
    {},
    "Adobe Fresco",
    "Layers",
    "macro_blender_collection"
  );
  assert.equal(localScope.selectedMacroId, "macro_delete_layer");

  const emptyScope = deriveBindsPanelMacroScope(
    macros,
    {},
    "Adobe Fresco",
    "Missing",
    "macro_delete_layer"
  );
  assert.deepEqual(emptyScope.macroButtons, []);
  assert.equal(emptyScope.selectedMacroId, "");
});
