import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainSource = readFileSync(path.join(frontend, "src/pages/main/MainPage.tsx"), "utf8");
const storageSource = readFileSync(path.join(frontend, "src/lib/layoutSnapshots.ts"), "utf8");

function sourceFunction(source, file, name) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = parsed.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `missing ${name}`);
  return node.getText(parsed).replace(/^export /, "");
}

function storageConstant(name) {
  const parsed = ts.createSourceFile("layoutSnapshots.ts", storageSource, ts.ScriptTarget.Latest, true);
  const node = parsed.statements.find(item => ts.isVariableStatement(item) &&
    item.declarationList.declarations.some(declaration => declaration.name.getText(parsed) === name));
  assert.ok(node, `missing ${name}`);
  return node.getText(parsed);
}

function setup(initialEntries = []) {
  const data = new Map(initialEntries);
  const trace = [];
  const state = { saveChoice: null, savedPath: null, openChoice: null, saveFails: false, loadFails: false };
  const start = mainSource.indexOf("  const handleSaveLayout = async () => {");
  const end = mainSource.indexOf("  const handleStartupSettingChange =", start);
  assert.ok(start >= 0 && end > start);
  const code = [
    storageConstant("LAST_MAIN_PAGE_LAYOUT_DIRECTORY_STORAGE_KEY"),
    storageConstant("LAST_SAVED_MAIN_PAGE_LAYOUT_DIRECTORY_STORAGE_KEY"),
    ...["canUseStorage", "readLastMainPageLayoutDirectory", "writeLastMainPageLayoutDirectory",
      "writeLastSavedMainPageLayoutDirectory"].map(name => sourceFunction(storageSource, "layoutSnapshots.ts", name)),
    sourceFunction(mainSource, "MainPage.tsx", "getParentDirectory"),
    mainSource.slice(start, end),
    "globalThis.subject = { handleSaveLayout, handleLoadLayout, getParentDirectory, readLastMainPageLayoutDirectory, writeLastMainPageLayoutDirectory };"
  ].join("\n");
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = {
    window: { localStorage: {
      getItem: key => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
      removeItem: key => data.delete(key)
    } },
    layoutActionPendingRef: { current: false },
    captureLayoutSnapshotState: async () => ({}),
    buildSuggestedLayoutName: () => "layout.flowlayout.json",
    showSaveLayoutDialog: async (_name, directory) => { trace.push(["save-dialog", directory]); return state.saveChoice; },
    saveLayoutSnapshot: async () => { if (state.saveFails) throw new Error("save failed"); return state.savedPath; },
    showOpenLayoutDialog: async directory => { trace.push(["load-dialog", directory]); return state.openChoice; },
    loadLayoutSnapshot: async () => { if (state.loadFails) throw new Error("load failed"); return {}; },
    restoreLayoutSnapshotState: async () => {},
    writeLastLayoutPath: () => {}
  };
  vm.runInNewContext(compiled, context);
  return { ...context.subject, data, trace, state };
}

test("layout dialogs prefer the last successful save after loading from another folder and restarting", async () => {
  const app = setup();
  app.writeLastMainPageLayoutDirectory("C:\\Legacy");
  app.state.openChoice = "C:\\Loaded\\older.json";
  await app.handleLoadLayout();
  assert.deepEqual(app.trace.at(-1), ["load-dialog", "C:\\Legacy"]);
  assert.equal(app.readLastMainPageLayoutDirectory(), "C:\\Loaded", "before a first save, retain the most recently used folder");

  app.state.saveChoice = "D:\\Saved\\test.flowlayout";
  app.state.savedPath = "D:\\Saved\\test.flowlayout.json";
  await app.handleSaveLayout();
  app.state.openChoice = "E:\\Elsewhere\\other.flowlayout.json";
  await app.handleLoadLayout();
  assert.deepEqual(app.trace.at(-1), ["load-dialog", "D:\\Saved"]);
  await app.handleLoadLayout();
  assert.deepEqual(app.trace.at(-1), ["load-dialog", "D:\\Saved"]);
  assert.equal(setup(app.data).readLastMainPageLayoutDirectory(), "D:\\Saved");
});

test("cancelled and failed saves or loads do not replace the saved directory", async () => {
  const app = setup();
  app.state.saveChoice = "C:\\Good\\layout.json";
  app.state.savedPath = app.state.saveChoice;
  await app.handleSaveLayout();
  app.state.saveChoice = null;
  await app.handleSaveLayout();
  app.state.saveChoice = "C:\\Bad\\layout.json";
  app.state.saveFails = true;
  await assert.rejects(app.handleSaveLayout(), /save failed/);
  app.state.openChoice = "C:\\Bad\\layout.json";
  app.state.loadFails = true;
  await assert.rejects(app.handleLoadLayout(), /load failed/);
  app.state.openChoice = null;
  await app.handleLoadLayout();
  assert.deepEqual(app.trace.at(-1), ["load-dialog", "C:\\Good"]);
});

test("layout parent paths preserve drive and filesystem roots", () => {
  const app = setup();
  assert.equal(app.getParentDirectory("C:\\layout.flowlayout.json"), "C:\\");
  assert.equal(app.getParentDirectory("D:/layout.flowlayout.json"), "D:/");
  assert.equal(app.getParentDirectory("/layout.flowlayout.json"), "/");
  assert.equal(app.getParentDirectory("\\\\server\\share\\layout.json"), "\\\\server\\share");
});
