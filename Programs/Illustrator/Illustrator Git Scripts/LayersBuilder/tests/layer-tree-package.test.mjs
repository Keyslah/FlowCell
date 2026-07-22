import assert from "node:assert/strict";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testsRoot = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testsRoot, "..");
const manifestPath = path.join(packageRoot, "flowcell.script.json");
const jsxPath = path.join(packageRoot, "layers.jsx");

async function readText(relativePath) {
  return readFile(path.join(packageRoot, relativePath), "utf8");
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertContainedResource(relativePath) {
  assert.equal(typeof relativePath, "string");
  assert.ok(relativePath.length > 0, "resource paths must be nonempty");
  assert.equal(path.isAbsolute(relativePath), false, `${relativePath} must be package-relative`);
  assert.equal(relativePath.includes("\\"), false, `${relativePath} must use manifest separators`);
  const resolved = path.resolve(packageRoot, relativePath);
  assert.ok(
    resolved.startsWith(packageRoot + path.sep),
    `${relativePath} must remain inside the installed owner package`
  );
}

function assertStrictObjectSchema(schema, subject) {
  assert.equal(schema?.type, "object", `${subject} must validate an object`);
  assert.equal(schema?.additionalProperties, false, `${subject} must reject unknown fields`);
  assert.equal(typeof schema.properties, "object", `${subject} must declare properties`);
}

test("Layer Tree is an ordinary self-contained page-enabled script package", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, "illustrator.layer-tree");
  assert.equal(manifest.program, "Illustrator");
  assert.equal(manifest.source, "layers.jsx");
  assert.equal("executionTarget" in manifest, false);
  assert.equal("execution" in manifest, false);
  assert.deepEqual(manifest.bridgeData?.capabilities, ["illustrator-layer-tree"]);

  const page = manifest.page;
  assert.equal(page.schemaVersion, 1);
  assert.equal(page.id, manifest.id);
  assert.equal(page.program, manifest.program);
  assert.equal(page.label, manifest.label);
  assert.equal(page.entry, "page/index.html");
  assert.deepEqual(page.scripts, ["page/page.js"]);
  assert.deepEqual(page.styles, ["page/page.css"]);
  assert.deepEqual(page.assets, []);
  assert.deepEqual(page.window, {
    title: "Layer Tree",
    width: 360,
    height: 640,
    minWidth: 300,
    minHeight: 420
  });
  assert.deepEqual(page.capabilities, ["illustrator-layer-tree"]);
  assert.equal(page.ownerStateFormat, "flowcell.illustrator.layer-tree-state.v1");
  assert.deepEqual(page.supportedDataFormats, [
    "illustrator.layer-tree.json"
  ]);
  assert.deepEqual(page.refreshEvents, ["flowcell://program-data-invalidated"]);
  assert.equal(page.config?.refreshEvent, page.refreshEvents[0]);
  assert.ok(page.config?.strings && typeof page.config.strings === "object");
});

test("every declared page resource exists, is contained, and is explicitly inventoried", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const page = manifest.page;
  const declared = [page.entry, ...page.scripts, ...page.styles, ...page.assets];
  for (const relativePath of declared) {
    assertContainedResource(relativePath);
    const metadata = await lstat(path.join(packageRoot, relativePath));
    assert.equal(metadata.isFile(), true, `${relativePath} must be a regular file`);
    assert.equal(metadata.isSymbolicLink(), false, `${relativePath} must not be a symbolic link`);
  }

  const pageFiles = (await readdir(path.join(packageRoot, "page"), { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => `page/${entry.name}`);
  assert.deepEqual(sorted(pageFiles), sorted(declared));

  const html = await readText(page.entry);
  const css = await readText(page.styles[0]);
  assert.doesNotMatch(html, /<link\b[^>]*href=|<script\b[^>]*src=/i);
  assert.doesNotMatch(html, /<a\b|\bdownload\b|<iframe\b|<form\b[^>]*\saction\s*=/i);
  assert.doesNotMatch(css, /url\s*\(/i);
});

test("program actions cover every layers.jsx operation with fixed capability payloads", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const jsx = await readFile(jsxPath, "utf8");
  const actions = manifest.page.actions;
  const actionIds = actions.map((action) => action.id);
  assert.equal(new Set(actionIds).size, actionIds.length, "page action IDs must be unique");

  const expectedProgramActions = new Map([
    ["scan", "scan"],
    ["create", "create"],
    ["rename", "rename"],
    ["delete", "delete"],
    ["duplicate", "duplicate"],
    ["set-lock", "setlock"],
    ["set-visible", "setvis"],
    ["move", "move"],
    ["select-contents", "select"]
  ]);
  const programActions = actions.filter((action) => action.handler?.kind === "program");
  assert.deepEqual(
    sorted(programActions.map((action) => action.id)),
    sorted(expectedProgramActions.keys())
  );

  for (const action of programActions) {
    assert.equal(action.handler.capability, "illustrator-layer-tree");
    assert.deepEqual(action.handler.payload, { op: expectedProgramActions.get(action.id) });
    assertStrictObjectSchema(action.requestSchema, `${action.id} requestSchema`);
    assertStrictObjectSchema(action.responseSchema, `${action.id} responseSchema`);
    assert.deepEqual(action.responseSchema.required, ["ok", "active", "tree"]);
    assert.equal(action.responseSchema.properties.tree?.type, "array");
    assert.equal(action.responseSchema.properties.tree?.items?.additionalProperties, false);
  }

  const jsxOperations = new Set(
    [...jsx.matchAll(/\bop\s*===\s*'([^']+)'/g)].map((match) => match[1])
  );
  assert.deepEqual(
    sorted(programActions.map((action) => action.handler.payload.op)),
    sorted(jsxOperations),
    "manifest fixed operations must exactly match layers.jsx dispatch"
  );
});

test("owner UI state uses only declared owner-runtime read and write actions", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const actions = new Map(manifest.page.actions.map((action) => [action.id, action]));
  assert.deepEqual(actions.get("read-owner-state")?.handler, {
    kind: "owner-state",
    operation: "read"
  });
  assert.deepEqual(actions.get("write-owner-state")?.handler, {
    kind: "owner-state",
    operation: "write"
  });
  assertStrictObjectSchema(actions.get("read-owner-state").requestSchema, "owner-state read request");
  assertStrictObjectSchema(actions.get("read-owner-state").responseSchema, "owner-state read response");
  assertStrictObjectSchema(actions.get("write-owner-state").requestSchema, "owner-state write request");
  assertStrictObjectSchema(actions.get("write-owner-state").responseSchema, "owner-state write response");

  const manifestText = await readFile(manifestPath, "utf8");
  assert.doesNotMatch(manifestText, /capabilityStateFile|mirrorCapabilityStateToTemp/i);
  assert.doesNotMatch(manifestText, /flowcellbackend|Folder\.temp|AppData|\\Temp\\/i);
});

test("sandbox page calls only declared FlowCell actions and contains no privileged APIs", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const pageScript = await readText("page/page.js");
  const declaredActionIds = new Set(manifest.page.actions.map((action) => action.id));
  const requestedActionIds = new Set(
    [...pageScript.matchAll(/\b(?:request|runAction)\(\s*"([^"]+)"/g)].map((match) => match[1])
  );
  for (const actionId of requestedActionIds) {
    assert.ok(declaredActionIds.has(actionId), `page.js requests undeclared action ${actionId}`);
  }
  for (const requiredActionId of [
    "scan",
    "create",
    "rename",
    "delete",
    "duplicate",
    "set-lock",
    "set-visible",
    "move",
    "select-contents",
    "read-owner-state",
    "write-owner-state"
  ]) {
    assert.ok(requestedActionIds.has(requiredActionId), `page.js must exercise ${requiredActionId}`);
  }

  assert.match(pageScript, /window\.flowcellPage/);
  assert.match(pageScript, /pageApi\.descriptor/);
  assert.match(pageScript, /addEventListener\("flowcell:page-refresh"/);
  assert.match(pageScript, /detail\.eventId !== refreshEvent/);
  for (const forbidden of [
    /@tauri-apps/i,
    /__TAURI__/,
    /\binvoke\s*\(/,
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /WebSocket/,
    /EventSource/,
    /sendBeacon/,
    /window\.open/,
    /\bpostMessage\s*\(/,
    /\b(?:localStorage|sessionStorage|indexedDB)\b/,
    /\b(?:FileReader|showOpenFilePicker|showSaveFilePicker)\b/,
    /\b(?:location\.href|location\.assign|location\.replace)\b/,
    /\bimport\s*\(/,
    /\brequire\s*\(/
  ]) {
    assert.doesNotMatch(pageScript, forbidden);
  }
});

test("child creation names first and rows move through drag and drop", async () => {
  const pageScript = await readText("page/page.js");
  const refreshHandler = pageScript.slice(
    pageScript.indexOf("function registerRefreshEvent"),
    pageScript.indexOf("function bindToolbar")
  );

  assert.match(pageScript, /openCreateChildDialog\(parentKey\)/);
  assert.match(pageScript, /nameDialogAction\s*=\s*"create-child"/);
  assert.match(
    pageScript,
    /runAction\("create",\s*\{\s*parentKey:\s*key,\s*name:\s*name\s*\}/
  );
  assert.match(pageScript, /row\.draggable\s*=\s*!state\.busy/);
  assert.match(pageScript, /addEventListener\("dragstart"/);
  assert.match(pageScript, /addEventListener\("dragover"/);
  assert.match(pageScript, /addEventListener\("drop"/);
  assert.match(
    pageScript,
    /runAction\("move",\s*\{\s*key:\s*sourceKey,\s*targetKey:\s*node\.key\s*\}/
  );
  assert.doesNotMatch(
    refreshHandler,
    /state\.highlightedKeys\s*=\s*new Set\(\)/,
    "program invalidation must not erase the target before async New Sub reads owner state"
  );
});

test("package HTML exposes the complete current Tree Inspector control surface", async () => {
  const html = await readText("page/index.html");
  const toolbarActions = new Set(
    [...html.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1])
  );
  assert.deepEqual(sorted(toolbarActions), sorted([
    "create-root",
    "create-child",
    "rename",
    "refresh",
    "duplicate",
    "delete",
    "force-delete"
  ]));
  assert.match(html, /role="tree"/);
  assert.match(html, /aria-multiselectable="true"/);
  assert.match(html, /id="rename-dialog"/);
  assert.match(html, /id="force-delete-dialog"/);
  assert.match(html, /role="status"/);
});
