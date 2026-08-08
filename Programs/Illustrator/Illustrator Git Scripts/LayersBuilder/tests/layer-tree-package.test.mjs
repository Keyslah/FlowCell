import assert from "node:assert/strict";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

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

const mockElementPlacement = {
  PLACEATBEGINNING: "PLACEATBEGINNING",
  PLACEBEFORE: "PLACEBEFORE",
  PLACEAFTER: "PLACEAFTER"
};

function removeMockEntry(entries, value) {
  const index = entries.indexOf(value);
  if (index >= 0) entries.splice(index, 1);
}

function insertMockLayer(parent, layer, stackIndex) {
  const layerIndex = parent._stack
    .slice(0, stackIndex)
    .filter((entry) => entry.typename === "Layer").length;
  parent.layers.splice(layerIndex, 0, layer);
  parent._stack.splice(stackIndex, 0, layer);
  layer.parent = parent;
  let document = parent;
  while (document && document.typename === "Layer") document = document.parent;
  if (document?.typename === "Document") document.activeLayer = layer;
}

function insertMockPageItem(parent, item, stackIndex) {
  const directItems = parent.pageItems.filter((entry) => entry.parent === parent);
  const nestedItems = parent.pageItems.filter((entry) => entry.parent !== parent);
  const itemIndex = parent._stack
    .slice(0, stackIndex)
    .filter((entry) => entry.typename !== "Layer").length;
  directItems.splice(itemIndex, 0, item);
  parent.pageItems.splice(0, parent.pageItems.length, ...directItems, ...nestedItems);
  parent._stack.splice(stackIndex, 0, item);
  item.parent = parent;
  item.layer = parent;
}

function attachMockLayerCollection(parent, layers) {
  Object.defineProperty(layers, "add", {
    configurable: true,
    enumerable: false,
    value() {
      const added = mockLayer("Layer");
      insertMockLayer(parent, added, 0);
      return added;
    }
  });
  for (const child of layers) {
    child.parent = parent;
    parent._stack.push(child);
  }
}

function mockLayer(
  name,
  {
    children = [],
    locked = false,
    visible = true,
    artworkKnockout = "DISABLED",
    blendingMode = "NORMAL",
    color = { red: 0, green: 0, blue: 0 },
    dimPlacedImages = false,
    opacity = 100,
    preview = true,
    printable = true,
    sliced = false,
    anchorMoveError = ""
  } = {}
) {
  const layer = {
    typename: "Layer",
    name,
    locked,
    visible,
    artworkKnockout,
    blendingMode,
    color,
    dimPlacedImages,
    opacity,
    preview,
    printable,
    sliced,
    layers: children,
    pageItems: [],
    _stack: [],
    parent: null,
    move(relativeEntry, placement) {
      assert.ok(
        placement === mockElementPlacement.PLACEBEFORE ||
          placement === mockElementPlacement.PLACEAFTER
      );
      const currentParent = layer.parent;
      removeMockEntry(currentParent.layers, layer);
      removeMockEntry(currentParent._stack, layer);
      const targetParent = relativeEntry.parent;
      let stackIndex = targetParent._stack.indexOf(relativeEntry);
      if (placement === mockElementPlacement.PLACEAFTER) stackIndex += 1;
      insertMockLayer(targetParent, layer, stackIndex);
    },
    remove() {
      removeMockEntry(layer.parent.layers, layer);
      removeMockEntry(layer.parent._stack, layer);
    }
  };
  attachMockLayerCollection(layer, children);
  layer.groupItems = {
    add() {
      return createMockPageItem(layer, "", {
        typename: "GroupItem",
        atBeginning: true,
        moveError: anchorMoveError
      });
    }
  };
  return layer;
}

function mockDocument(layers) {
  const document = {
    typename: "Document",
    layers,
    pageItems: [],
    _stack: [],
    selection: null,
    activeLayer: layers[0]
  };
  attachMockLayerCollection(document, layers);
  return document;
}

function createMockPageItem(
  layer,
  name,
  {
    hidden = false,
    locked = false,
    opacity = 100,
    note = "",
    typename = "PathItem",
    atBeginning = false,
    duplicateError = "",
    moveError = ""
  } = {}
) {
  const item = {
    typename,
    name,
    parent: layer,
    layer,
    hidden,
    locked,
    opacity,
    note,
    duplicate(destinationLayer, placement) {
      if (duplicateError) throw new Error(duplicateError);
      return createMockPageItem(destinationLayer, name, {
        hidden,
        locked,
        opacity,
        note,
        typename,
        atBeginning: placement === mockElementPlacement.PLACEATBEGINNING
      });
    },
    move(relativeEntry, placement) {
      if (moveError) throw new Error(moveError);
      if (placement === mockElementPlacement.PLACEATBEGINNING) {
        const currentParent = item.parent;
        removeMockEntry(currentParent.pageItems, item);
        removeMockEntry(currentParent._stack, item);
        insertMockPageItem(relativeEntry, item, 0);
        return;
      }
      assert.ok(
        placement === mockElementPlacement.PLACEBEFORE ||
          placement === mockElementPlacement.PLACEAFTER
      );
      const currentParent = item.parent;
      removeMockEntry(currentParent.pageItems, item);
      removeMockEntry(currentParent._stack, item);
      const targetParent = relativeEntry.parent;
      let stackIndex = targetParent._stack.indexOf(relativeEntry);
      if (placement === mockElementPlacement.PLACEAFTER) stackIndex += 1;
      insertMockPageItem(targetParent, item, stackIndex);
    },
    remove() {
      removeMockEntry(item.parent.pageItems, item);
      removeMockEntry(item.parent._stack, item);
    }
  };
  insertMockPageItem(layer, item, atBeginning ? 0 : layer._stack.length);
  return item;
}

function mockPageItem(layer, name, options = {}) {
  return createMockPageItem(layer, name, options);
}

function setMockStack(layer, entries) {
  const nestedItems = layer.pageItems.filter((entry) => entry.parent !== layer);
  layer._stack.splice(0, layer._stack.length, ...entries);
  layer.layers.splice(
    0,
    layer.layers.length,
    ...entries.filter((entry) => entry.typename === "Layer")
  );
  layer.pageItems.splice(
    0,
    layer.pageItems.length,
    ...entries.filter((entry) => entry.typename !== "Layer"),
    ...nestedItems
  );
  for (const entry of entries) {
    entry.parent = layer;
    if (entry.typename !== "Layer") entry.layer = layer;
  }
}

function mockSelectedObject(layer) {
  const group = { typename: "GroupItem", parent: layer };
  const item = { typename: "PathItem", parent: group, layer, selected: true };
  layer.pageItems.push(item);
  return item;
}

function runLayerTreeSource(source, document, args) {
  const executable = source.replace(/^#target[^\r\n]*\r?\n/m, "");
  const raw = vm.runInNewContext(executable, {
    app: {
      documents: [document],
      activeDocument: document,
      redraw() {}
    },
    ElementPlacement: mockElementPlacement,
    FLOWCELL_ARGS: args
  });
  return JSON.parse(raw);
}

function runDeleteSource(source, document, { keys = [], force = false } = {}) {
  return runLayerTreeSource(source, document, { op: "delete", keys, force });
}

function runDuplicateSource(source, document, { keys = [] } = {}) {
  return runLayerTreeSource(source, document, { op: "duplicate", keys });
}

function runPlaceArtworkSource(source, document, { targetKey, copy = false }) {
  return runLayerTreeSource(source, document, {
    op: "placeartwork",
    targetKey,
    copy
  });
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
  assert.deepEqual(page.config?.refreshPanelNames, ["Layers Builder"]);
  assert.ok(page.config?.strings && typeof page.config.strings === "object");
});

test("Layer Tree refresh invalidation accepts Layers Builder only", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const pageScript = await readText("page/page.js");
  const helperSource = pageScript.slice(
    pageScript.indexOf("function refreshSourceMatches"),
    pageScript.indexOf("function clearRefreshTimers")
  );
  const refreshSourceMatches = vm.runInNewContext(`(() => {
    const config = ${JSON.stringify(manifest.page.config)};
    ${helperSource}
    return refreshSourceMatches;
  })()`);
  const refreshHandler = pageScript.slice(
    pageScript.indexOf("function registerRefreshEvent"),
    pageScript.indexOf("function bindToolbar")
  );

  assert.equal(refreshSourceMatches({
    programName: "Illustrator",
    panelName: "Layers Builder",
    fileName: "new-sub.flowcell-source.json"
  }), true);
  assert.equal(refreshSourceMatches({
    programName: "illustrator",
    panelName: "layers builder"
  }), true);
  assert.equal(refreshSourceMatches({
    programName: "Illustrator",
    panelName: "Toolset",
    fileName: "illustrator-rotate.flowcell-source.json"
  }), false);
  assert.equal(refreshSourceMatches({
    programName: "Illustrator",
    panelName: "Toolset",
    fileName: "ill-align.flowcell-source.json"
  }), false);
  assert.equal(refreshSourceMatches({ programName: "Illustrator" }), false);
  assert.equal(refreshSourceMatches({
    programName: "Blender",
    panelName: "Layers Builder"
  }), false);
  assert.ok(
    refreshHandler.indexOf("if (!refreshSourceMatches(payload)) return;") <
      refreshHandler.indexOf("clearRefreshTimers();"),
    "unrelated invalidations must return before Layer Tree timers are cleared or scheduled"
  );
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
    ["place-selected-artwork", "placeartwork"],
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
    "place-selected-artwork",
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

test("root and child creation name first while rows reparent through pointer drag", async () => {
  const pageScript = await readText("page/page.js");
  const refreshHandler = pageScript.slice(
    pageScript.indexOf("function registerRefreshEvent"),
    pageScript.indexOf("function bindToolbar")
  );
  const toolbar = pageScript.slice(
    pageScript.indexOf("function bindToolbar"),
    pageScript.indexOf("function bindDialogs")
  );
  const rootCreateHandler = toolbar.slice(
    toolbar.indexOf('document.querySelector(\'[data-action="create-root"]\')'),
    toolbar.indexOf('document.querySelector(\'[data-action="create-child"]\')')
  );
  const childCreateHandler = toolbar.slice(
    toolbar.indexOf('document.querySelector(\'[data-action="create-child"]\')'),
    toolbar.indexOf('document.querySelector(\'[data-action="rename"]\')')
  );

  assert.match(rootCreateHandler, /openCreateRootDialog\(\)/);
  assert.doesNotMatch(rootCreateHandler, /runAction\("create"/);
  assert.match(pageScript, /nameDialogAction\s*=\s*"create-root"/);
  assert.match(
    pageScript,
    /action === "create-root"[\s\S]*?runAction\("create",\s*\{\s*name:\s*name\s*\}/
  );
  assert.match(childCreateHandler, /openCreateChildDialog\(parentKey\)/);
  assert.doesNotMatch(childCreateHandler, /runAction\("create"/);
  assert.match(pageScript, /nameDialogAction\s*=\s*"create-child"/);
  assert.match(
    pageScript,
    /runAction\("create",\s*\{\s*parentKey:\s*key,\s*name:\s*name\s*\}/
  );
  assert.match(pageScript, /Math\.hypot\([\s\S]*?distance\s*<\s*4/);
  assert.match(pageScript, /document\.elementFromPoint\(event\.clientX,\s*event\.clientY\)/);
  assert.match(pageScript, /setPointerCapture\(event\.pointerId\)/);
  assert.match(pageScript, /addEventListener\("pointerdown"/);
  assert.match(pageScript, /addEventListener\("pointermove"/);
  assert.match(pageScript, /addEventListener\("pointerup"/);
  assert.match(pageScript, /addEventListener\("pointercancel"/);
  assert.match(
    pageScript,
    /runAction\("move",\s*\{\s*key:\s*sourceKey,\s*targetKey:\s*targetKey\s*\}/
  );
  assert.doesNotMatch(
    refreshHandler,
    /state\.highlightedKeys\s*=\s*new Set\(\)/,
    "program invalidation must not erase the target before async New Sub reads owner state"
  );
});

test("pointer drag bypasses native file-drop interception and maps Alt to artwork copy", async () => {
  const pageScript = await readText("page/page.js");
  const finishHandler = pageScript.slice(
    pageScript.indexOf("function finishPointerDrag"),
    pageScript.indexOf("function beginPointerDrag")
  );

  assert.match(pageScript, /"layer-tree__target"[\s\S]*?"select-contents"/);
  assert.match(pageScript, /className\s*=\s*"layer-tree__row-button layer-tree__selection-proxy"/);
  assert.match(
    pageScript,
    /artworkDragHandle\.addEventListener\("click"[\s\S]*?runAction\(\s*"select-contents"/
  );
  assert.match(pageScript, /bindPointerDrag\(artworkDragHandle,\s*"artwork",\s*node,\s*row\)/);
  assert.match(pageScript, /beginPointerDrag\("layer",\s*node,\s*row,\s*row,\s*event\)/);
  assert.match(
    pageScript,
    /isCopyDrop\s*=\s*isArtworkDrag\s*&&\s*event\.altKey[\s\S]*?classList\.toggle\("is-copy-target",\s*isCopyDrop\)/
  );
  assert.match(
    pageScript,
    /copyArtwork\s*=\s*dragMode\s*===\s*"artwork"\s*&&\s*state\.dragCopy/
  );
  assert.match(
    pageScript,
    /runAction\(\s*"place-selected-artwork",\s*\{\s*targetKey:\s*targetKey,\s*copy:\s*copyArtwork\s*\}/
  );
  assert.match(pageScript, /releasePointerCapture\(pointerId\)/);
  assert.match(pageScript, /row\.addEventListener\("click"[\s\S]*?selectRow\(node\.key,\s*event\)/);
  assert.match(pageScript, /state\.suppressNextClick\s*=\s*true[\s\S]*?window\.setTimeout/);
  assert.ok(
    finishHandler.indexOf("armPointerClickSuppression();") <
      finishHandler.indexOf("if (cancelled || !wasDragging || !targetKey || !targetNode) return;"),
    "a real invalid drop must suppress its synthesized source click before returning"
  );
  assert.match(
    pageScript,
    /function setBusy\(next\)[\s\S]*?clearDragState\(\);[\s\S]*?if \(wasDragging\) armPointerClickSuppression\(\);/
  );
  assert.doesNotMatch(pageScript, /\bdataTransfer\b/);
  assert.doesNotMatch(pageScript, /\.draggable\s*=/);
  assert.doesNotMatch(pageScript, /addEventListener\("(?:dragstart|dragover|drop|dragleave|dragend)"/);
});

test("selected artwork drops move current Illustrator selection and restore item and layer state", async () => {
  const source = await readFile(jsxPath, "utf8");
  const sourceLayer = mockLayer("Source", { locked: true, visible: false });
  const first = mockPageItem(sourceLayer, "First", {
    hidden: true,
    locked: true,
    opacity: 42,
    note: "keep-first"
  });
  const second = mockPageItem(sourceLayer, "Second", {
    opacity: 73,
    note: "keep-second"
  });
  const target = mockLayer("Target", { locked: true, visible: false });
  const targetParent = mockLayer("Target Parent", {
    children: [target],
    locked: true,
    visible: false
  });
  const document = mockDocument([sourceLayer, targetParent]);
  document.selection = [
    first,
    { typename: "InsertionPoint" },
    second,
    { typename: "TextRange" }
  ];

  const result = runPlaceArtworkSource(source, document, {
    targetKey: "1.0",
    copy: false
  });

  assert.equal(result.ok, true);
  assert.deepEqual(sourceLayer._stack.map((item) => item.name), []);
  assert.deepEqual(target._stack.map((item) => item.name), ["First", "Second"]);
  assert.equal(first.parent, target);
  assert.equal(second.parent, target);
  assert.equal(first.hidden, true);
  assert.equal(first.locked, true);
  assert.equal(first.opacity, 42);
  assert.equal(first.note, "keep-first");
  assert.equal(second.opacity, 73);
  assert.equal(second.note, "keep-second");
  assert.equal(sourceLayer.visible, false);
  assert.equal(sourceLayer.locked, true);
  assert.equal(target.visible, false);
  assert.equal(target.locked, true);
  assert.equal(targetParent.visible, false);
  assert.equal(targetParent.locked, true);
  assert.equal(document.activeLayer, target);

  const sameLayer = mockLayer("Same layer");
  const sameLayerItem = mockPageItem(sameLayer, "Do not reorder", {
    moveError: "same-layer move must not run"
  });
  const sameLayerTail = mockPageItem(sameLayer, "Tail");
  const sameLayerDocument = mockDocument([sameLayer]);
  sameLayerDocument.selection = [sameLayerItem];
  const sameLayerResult = runPlaceArtworkSource(source, sameLayerDocument, {
    targetKey: "0",
    copy: false
  });
  assert.equal(sameLayerResult.ok, true);
  assert.deepEqual(sameLayer._stack, [sameLayerItem, sameLayerTail]);
  assert.equal(sameLayerDocument.activeLayer, sameLayer);
});

test("Alt artwork drops copy selected objects without copying or moving their source layers", async () => {
  const source = await readFile(jsxPath, "utf8");
  const sourceLayer = mockLayer("Source");
  const first = mockPageItem(sourceLayer, "First", {
    hidden: true,
    locked: true,
    opacity: 34,
    note: "first-copy"
  });
  const second = mockPageItem(sourceLayer, "Second", {
    opacity: 81,
    note: "second-copy"
  });
  const target = mockLayer("Target", { locked: true, visible: false });
  const document = mockDocument([sourceLayer, target]);
  document.selection = [first, second];

  const result = runPlaceArtworkSource(source, document, {
    targetKey: "1",
    copy: true
  });

  assert.equal(result.ok, true);
  assert.deepEqual(sourceLayer._stack.map((item) => item.name), ["First", "Second"]);
  assert.deepEqual(target._stack.map((item) => item.name), ["First", "Second"]);
  assert.notEqual(target._stack[0], first);
  assert.notEqual(target._stack[1], second);
  assert.equal(target._stack[0].hidden, true);
  assert.equal(target._stack[0].locked, true);
  assert.equal(target._stack[0].opacity, 34);
  assert.equal(target._stack[0].note, "first-copy");
  assert.equal(target._stack[1].opacity, 81);
  assert.equal(target._stack[1].note, "second-copy");
  assert.equal(target.visible, false);
  assert.equal(target.locked, true);
  assert.equal(document.layers.includes(sourceLayer), true);
  assert.equal(document.selection.length, 2);
  assert.equal(document.selection[0], target._stack[0]);
  assert.equal(document.selection[1], target._stack[1]);
  assert.equal(document.activeLayer, target);
});

test("selected artwork placement rolls back completed move and copy items after a later failure", async () => {
  const source = await readFile(jsxPath, "utf8");

  const moveSource = mockLayer("Move Source");
  const movedBeforeFailure = mockPageItem(moveSource, "Moved before failure", {
    hidden: true,
    locked: true
  });
  const moveFailure = mockPageItem(moveSource, "Move failure", {
    moveError: "move stopped"
  });
  const moveTail = mockPageItem(moveSource, "Move tail");
  const moveTarget = mockLayer("Move Target", { locked: true, visible: false });
  const moveDocument = mockDocument([moveSource, moveTarget]);
  moveDocument.selection = [moveFailure, movedBeforeFailure];

  const moveResult = runPlaceArtworkSource(source, moveDocument, {
    targetKey: "1",
    copy: false
  });
  assert.equal(moveResult.ok, false);
  assert.match(moveResult.error, /move stopped/);
  assert.deepEqual(
    moveSource._stack.map((item) => item.name),
    ["Moved before failure", "Move failure", "Move tail"]
  );
  assert.deepEqual(moveTarget._stack, []);
  assert.equal(movedBeforeFailure.hidden, true);
  assert.equal(movedBeforeFailure.locked, true);
  assert.equal(moveTarget.visible, false);
  assert.equal(moveTarget.locked, true);

  const copySource = mockLayer("Copy Source");
  const copyFailure = mockPageItem(copySource, "Copy failure", {
    duplicateError: "copy stopped"
  });
  const copiedBeforeFailure = mockPageItem(copySource, "Copied before failure");
  const copyTarget = mockLayer("Copy Target", { locked: true, visible: false });
  const copyDocument = mockDocument([copySource, copyTarget]);
  copyDocument.selection = [copyFailure, copiedBeforeFailure];

  const copyResult = runPlaceArtworkSource(source, copyDocument, {
    targetKey: "1",
    copy: true
  });
  assert.equal(copyResult.ok, false);
  assert.match(copyResult.error, /copy stopped/);
  assert.deepEqual(copyTarget._stack, []);
  assert.deepEqual(
    copySource._stack.map((item) => item.name),
    ["Copy failure", "Copied before failure"]
  );
  assert.equal(copyTarget.visible, false);
  assert.equal(copyTarget.locked, true);
});

test("text-edit selections are ignored by artwork placement", async () => {
  const source = await readFile(jsxPath, "utf8");
  const sourceLayer = mockLayer("Text");
  const target = mockLayer("Target");
  const document = mockDocument([sourceLayer, target]);
  document.selection = { typename: "TextRange", length: 80 };

  const result = runPlaceArtworkSource(source, document, {
    targetKey: "1",
    copy: true
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Select one or more Illustrator objects/i);
  assert.deepEqual(target._stack, []);
});

test("Duplicate, Delete, and Force Delete dispatch directly without requiring a tree highlight", async () => {
  const pageScript = await readText("page/page.js");
  const toolbar = pageScript.slice(
    pageScript.indexOf("function bindToolbar"),
    pageScript.indexOf("function bindDialogs")
  );
  const duplicateHandler = toolbar.slice(
    toolbar.indexOf('document.querySelector(\'[data-action="duplicate"]\')'),
    toolbar.indexOf('document.querySelector(\'[data-action="delete"]\')')
  );

  assert.match(duplicateHandler, /runAction\("duplicate",\s*\{\s*keys:\s*keys\s*\}/);
  assert.match(duplicateHandler, /var keys\s*=\s*highlightedKeys\(\)/);
  assert.doesNotMatch(duplicateHandler, /requireSelection/);
  assert.match(
    toolbar,
    /runAction\("delete",\s*\{\s*keys:\s*highlightedKeys\(\),\s*force:\s*force\s*\}/
  );
  assert.match(toolbar, /deleteSelectedLayers\(false\)/);
  assert.match(toolbar, /deleteSelectedLayers\(true\)/);
  assert.doesNotMatch(pageScript, /openForceDeleteDialog|forceDialog|forceConfirm/);
});

test("duplicate prefers selected artwork, copies the complete layer tree, and falls back to highlighted rows", async () => {
  const source = await readFile(jsxPath, "utf8");
  const nested = mockLayer("Nested", { locked: true, visible: false });
  mockPageItem(nested, "Nested artwork", { hidden: true, locked: true });
  const selectedLayer = mockLayer("Selected", {
    children: [nested],
    locked: true,
    visible: false,
    artworkKnockout: "ENABLED",
    blendingMode: "MULTIPLY",
    color: { red: 12, green: 34, blue: 56 },
    dimPlacedImages: true,
    opacity: 47,
    preview: false,
    printable: false,
    sliced: true
  });
  const rootTop = mockPageItem(selectedLayer, "Root top", {
    hidden: true,
    locked: true
  });
  const rootBottom = mockPageItem(selectedLayer, "Root bottom");
  setMockStack(selectedLayer, [rootTop, nested, rootBottom]);
  const highlightedFallback = mockLayer("Highlighted Fallback");
  const selectedDocument = mockDocument([
    selectedLayer,
    highlightedFallback,
    mockLayer("Spare")
  ]);
  selectedDocument.selection = [
    mockSelectedObject(selectedLayer),
    mockSelectedObject(nested)
  ];

  const selectedResult = runDuplicateSource(source, selectedDocument, { keys: ["1"] });
  assert.equal(selectedResult.ok, true);
  assert.equal(
    selectedDocument.layers.filter((layer) => layer.name === "Selected1").length,
    1,
    "a selected parent and descendant must produce one normalized subtree copy"
  );
  assert.equal(
    selectedDocument.layers.some((layer) => layer.name === "Highlighted Fallback1"),
    false,
    "native artwork selection must win over a conflicting highlighted row"
  );
  const selectedCopy = selectedDocument.layers.find((layer) => layer.name === "Selected1");
  assert.ok(selectedCopy);
  assert.equal(selectedDocument.activeLayer, selectedCopy);
  assert.equal(selectedCopy.layers.length, 1);
  assert.equal(selectedCopy.layers[0].name, "Nested");
  assert.deepEqual(
    selectedCopy._stack.map((entry) => entry.name),
    ["Root top", "Nested", "Root bottom"],
    "artwork and sublayers must retain their shared Illustrator stacking order"
  );
  assert.equal(
    selectedCopy.layers[0].pageItems.some((item) => item.name === "Nested artwork"),
    true
  );
  assert.equal(selectedLayer.visible, false);
  assert.equal(selectedLayer.locked, true);
  assert.equal(selectedCopy.visible, false);
  assert.equal(selectedCopy.locked, true);
  assert.equal(selectedCopy.layers[0].visible, false);
  assert.equal(selectedCopy.layers[0].locked, true);
  assert.equal(selectedCopy.pageItems.find((item) => item.name === "Root top").hidden, true);
  assert.equal(selectedCopy.pageItems.find((item) => item.name === "Root top").locked, true);
  assert.equal(selectedCopy.artworkKnockout, "ENABLED");
  assert.equal(selectedCopy.blendingMode, "MULTIPLY");
  assert.deepEqual(selectedCopy.color, { red: 12, green: 34, blue: 56 });
  assert.equal(selectedCopy.dimPlacedImages, true);
  assert.equal(selectedCopy.opacity, 47);
  assert.equal(selectedCopy.preview, false);
  assert.equal(selectedCopy.printable, false);
  assert.equal(selectedCopy.sliced, true);

  const highlightedChild = mockLayer("Highlighted Child");
  mockPageItem(highlightedChild, "Highlighted artwork");
  const highlightedRoot = mockLayer("Highlighted Root", { children: [highlightedChild] });
  const highlightedDocument = mockDocument([highlightedRoot, mockLayer("Spare")]);
  const highlightedResult = runDuplicateSource(source, highlightedDocument, { keys: ["0.0"] });
  assert.equal(highlightedResult.ok, true);
  assert.equal(
    highlightedRoot.layers.some((layer) => layer.name === "Highlighted Child1"),
    true
  );

  const emptyDocument = mockDocument([mockLayer("Only"), mockLayer("Spare")]);
  const emptyResult = runDuplicateSource(source, emptyDocument);
  assert.equal(emptyResult.ok, false);
  assert.match(emptyResult.error, /Select Illustrator objects or highlight/i);
  assert.doesNotMatch(source, /\.layer\.duplicate\s*\(/);
});

test("duplicate sublayer names advance one compact trailing number", async () => {
  const source = await readFile(jsxPath, "utf8");
  const original = mockLayer("name");
  mockPageItem(original, "Artwork");
  const root = mockLayer("Root", { children: [original] });
  const document = mockDocument([root, mockLayer("Spare")]);
  document.selection = [mockSelectedObject(original)];

  const firstResult = runDuplicateSource(source, document);
  assert.equal(firstResult.ok, true);
  assert.equal(root.layers.some((layer) => layer.name === "name1"), true);

  const secondResult = runDuplicateSource(source, document);
  assert.equal(secondResult.ok, true);
  assert.equal(root.layers.some((layer) => layer.name === "name2"), true);

  const firstCopy = root.layers.find((layer) => layer.name === "name1");
  document.selection = [mockSelectedObject(firstCopy)];
  const thirdResult = runDuplicateSource(source, document);
  assert.equal(thirdResult.ok, true);
  assert.equal(root.layers.some((layer) => layer.name === "name3"), true);
  assert.equal(root.layers.some((layer) => /\bcopy\b/i.test(layer.name)), false);
});

test("duplicate rolls back every completed root when a later selected layer cannot be copied", async () => {
  const source = await readFile(jsxPath, "utf8");
  const first = mockLayer("First");
  mockPageItem(first, "First artwork");
  const second = mockLayer("Second", { locked: true, visible: false });
  mockPageItem(second, "Unsupported artwork", {
    hidden: true,
    locked: true,
    duplicateError: "unsupported artwork"
  });
  const document = mockDocument([first, second, mockLayer("Spare")]);
  document.selection = [mockSelectedObject(first), mockSelectedObject(second)];

  const result = runDuplicateSource(source, document);
  assert.equal(result.ok, false);
  assert.match(result.error, /unsupported artwork/);
  assert.deepEqual(document.layers.map((layer) => layer.name), ["First", "Second", "Spare"]);
  assert.equal(first._stack.some((entry) => entry.typename === "GroupItem"), false);
  assert.equal(second._stack.some((entry) => entry.typename === "GroupItem"), false);
  assert.equal(second.visible, false);
  assert.equal(second.locked, true);
  assert.equal(second.pageItems.find((item) => item.name === "Unsupported artwork").hidden, true);
  assert.equal(second.pageItems.find((item) => item.name === "Unsupported artwork").locked, true);
  assert.equal(document.activeLayer, first);
});

test("duplicate removes a temporary source anchor when Illustrator rejects its placement", async () => {
  const source = await readFile(jsxPath, "utf8");
  const child = mockLayer("Child");
  const target = mockLayer("Target", {
    children: [child],
    anchorMoveError: "anchor placement failed"
  });
  const document = mockDocument([target, mockLayer("Spare")]);
  document.selection = [mockSelectedObject(target)];

  const result = runDuplicateSource(source, document);
  assert.equal(result.ok, false);
  assert.match(result.error, /anchor placement failed/);
  assert.deepEqual(document.layers.map((layer) => layer.name), ["Target", "Spare"]);
  assert.deepEqual(target._stack.map((entry) => entry.name), ["Child"]);
  assert.equal(target.pageItems.some((item) => item.typename === "GroupItem"), false);
  assert.equal(document.activeLayer, target);
});

test("delete prefers selected objects' complete containing layers and falls back to tree keys", async () => {
  const source = await readFile(jsxPath, "utf8");
  const nested = mockLayer("Nested");
  const selectedA = mockLayer("Selected A", { children: [nested] });
  const selectedB = mockLayer("Selected B");
  const selectedRoot = mockLayer("Selected Root", { children: [selectedA, selectedB] });
  const highlightedFallback = mockLayer("Highlighted Fallback");
  const spare = mockLayer("Spare");
  const selectedDocument = mockDocument([selectedRoot, highlightedFallback, spare]);
  selectedDocument.selection = [
    mockSelectedObject(selectedA),
    mockSelectedObject(selectedA),
    mockSelectedObject(nested),
    mockSelectedObject(selectedB)
  ];

  const selectedResult = runDeleteSource(source, selectedDocument, {
    keys: ["1"],
    force: false
  });
  assert.equal(selectedResult.ok, true);
  assert.deepEqual(selectedRoot.layers, []);
  assert.ok(selectedDocument.layers.includes(highlightedFallback));
  assert.ok(selectedA.layers.includes(nested), "removing a layer removes its complete subtree");

  const keyedTarget = mockLayer("Keyed Target");
  const keyedRoot = mockLayer("Keyed Root", { children: [keyedTarget] });
  const keyedDocument = mockDocument([keyedRoot, mockLayer("Spare")]);
  const keyedResult = runDeleteSource(source, keyedDocument, {
    keys: ["0.0"],
    force: false
  });
  assert.equal(keyedResult.ok, true);
  assert.deepEqual(keyedRoot.layers, []);
});

test("text insertion selections are not mistaken for selected artwork layers", async () => {
  const source = await readFile(jsxPath, "utf8");
  const textLayer = mockLayer("Text Layer");
  const keyedTarget = mockLayer("Keyed Target");
  const document = mockDocument([textLayer, keyedTarget, mockLayer("Spare")]);
  document.selection = {
    typename: "InsertionPoint",
    parent: { typename: "TextFrame", parent: textLayer }
  };

  const keyedResult = runDeleteSource(source, document, {
    keys: ["1"],
    force: false
  });
  assert.equal(keyedResult.ok, true);
  assert.ok(document.layers.includes(textLayer));
  assert.equal(document.layers.includes(keyedTarget), false);

  const noTargetDocument = mockDocument([mockLayer("Only"), mockLayer("Spare")]);
  noTargetDocument.selection = {
    typename: "TextRange",
    parent: { typename: "TextFrame", parent: noTargetDocument.layers[0] }
  };
  const noTargetResult = runDeleteSource(source, noTargetDocument);
  assert.equal(noTargetResult.ok, false);
  assert.match(noTargetResult.error, /Select Illustrator objects or highlight/i);
});

test("normal Delete refuses a closed selected layer while Force Delete removes it", async () => {
  const source = await readFile(jsxPath, "utf8");
  const lockedTarget = mockLayer("Locked Target", { locked: true });
  const root = mockLayer("Root", { children: [lockedTarget] });
  const document = mockDocument([root, mockLayer("Spare")]);
  document.selection = [mockSelectedObject(lockedTarget)];

  const normalResult = runDeleteSource(source, document, { force: false });
  assert.equal(normalResult.ok, false);
  assert.match(normalResult.error, /locked or hidden/i);
  assert.ok(root.layers.includes(lockedTarget));

  const forcedResult = runDeleteSource(source, document, { force: true });
  assert.equal(forcedResult.ok, true);
  assert.deepEqual(root.layers, []);
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
  assert.doesNotMatch(html, /force-delete-dialog|role="alertdialog"/);
  assert.match(html, /role="status"/);
});
