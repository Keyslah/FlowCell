import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const actionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const illustratorRoot = path.resolve(actionRoot, "..", "..");
const programManifest = JSON.parse(
  readFileSync(path.join(illustratorRoot, "flowcell.program.json"), "utf8")
);
const contributions = programManifest.bundledSources.filter(({ id }) =>
  id.startsWith("illustrator.layers-builder.")
);
const layerTreeContribution = programManifest.bundledSources.find(({ id }) =>
  id === "illustrator.layer-tree"
);
const layersBuilderIdPrefix = "illustrator.layers-builder.";
const globalActions = new Set([
  "make-layers",
  "sort",
  "b-lock",
  "b-vis",
  "set-lock",
  "set-vis",
  "empty-sublayers",
  "empty-trash"
]);
const directOpenTreeActions = new Set(["new-sub", "delete-sublayer"]);
const nonmutatingTreeActions = new Set([
  "3d",
  "add-to-live",
  "archive",
  "back",
  "copy-live",
  "flatten-top-sub",
  "restore",
  "trash"
]);
const hybridAction = "snapshot";

function read(pathname) {
  return readFileSync(pathname, "utf8");
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readActionSource(packageName) {
  const packageRoot = path.join(actionRoot, packageName);
  const manifest = JSON.parse(read(path.join(packageRoot, "flowcell.script.json")));
  return read(path.join(packageRoot, manifest.source));
}

function resolverFixture(helper) {
  const normalize = (value) => String(value).replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  const parentOf = (value) => {
    const normalized = normalize(value);
    const index = normalized.lastIndexOf("\\");
    return index > 2 ? normalized.slice(0, index) : normalized;
  };
  const files = new Map();
  const folders = new Set();
  const ensureFolder = (value) => {
    let current = normalize(value);
    while (current && !folders.has(current)) {
      folders.add(current);
      const parent = parentOf(current);
      if (parent === current) break;
      current = parent;
    }
  };
  const addFile = (value, contents = "") => {
    const normalized = normalize(value);
    ensureFolder(parentOf(normalized));
    files.set(normalized, contents);
  };

  function VirtualFile(value) {
    if (!(this instanceof VirtualFile)) return new VirtualFile(value);
    this.fsName = normalize(value?.fsName ?? value);
    this.encoding = "UTF-8";
  }
  Object.defineProperties(VirtualFile.prototype, {
    exists: { get() { return files.has(normalize(this.fsName)); } },
    name: { get() { return normalize(this.fsName).split("\\").at(-1); } },
    parent: { get() { return new VirtualFolder(parentOf(this.fsName)); } }
  });
  VirtualFile.prototype.open = function () { return this.exists; };
  VirtualFile.prototype.read = function () { return files.get(normalize(this.fsName)); };
  VirtualFile.prototype.close = function () {};

  function VirtualFolder(value) {
    if (!(this instanceof VirtualFolder)) return new VirtualFolder(value);
    this.fsName = normalize(value?.fsName ?? value);
  }
  Object.defineProperties(VirtualFolder.prototype, {
    exists: { get() { return folders.has(normalize(this.fsName)); } },
    name: { get() { return normalize(this.fsName).split("\\").at(-1); } },
    parent: { get() { return new VirtualFolder(parentOf(this.fsName)); } }
  });
  VirtualFolder.prototype.getFiles = function () {
    const root = normalize(this.fsName);
    const entries = [];
    for (const folder of folders) {
      if (folder !== root && parentOf(folder) === root) entries.push(new VirtualFolder(folder));
    }
    for (const file of files.keys()) {
      if (parentOf(file) === root) entries.push(new VirtualFile(file));
    }
    return entries;
  };

  const programRoot = "C:\\flowcell\\Programs\\Illustrator";
  const actionSource = `${programRoot}\\Illustrator Local Scripts\\action_owner\\source\\action.jsx`;
  const treePackage = `${programRoot}\\Illustrator Local Scripts\\tree_owner`;
  const treeSource = `${treePackage}\\source\\layers.jsx`;
  const recordPath = `${programRoot}\\Panels\\Layers Builder\\tree_owner.flowcell-source.json`;
  const programManifest = {
    schemaVersion: 1,
    programId: "illustrator",
    label: "Illustrator",
    panelsFolder: "Panels",
    localScriptsFolder: "Illustrator Local Scripts"
  };
  const page = {
    schemaVersion: 1,
    id: "illustrator.layer-tree",
    program: "Illustrator",
    ownerStateFormat: "flowcell.illustrator.layer-tree-state.v1"
  };
  const sourceManifest = {
    schemaVersion: 1,
    id: "illustrator.layer-tree",
    program: "Illustrator",
    source: "layers.jsx",
    page
  };
  const activeRecord = {
    schemaVersion: 1,
    ownerButtonId: "tree_owner",
    installId: "tree_owner",
    programId: "illustrator",
    programName: "Illustrator",
    kind: "script",
    localPackagePath: "Illustrator Local Scripts\\tree_owner",
    sourcePath: "Illustrator Local Scripts\\tree_owner\\source\\layers.jsx",
    page,
    executionTarget: {
      kind: "core-action",
      actionId: "open-installed-page",
      payload: { pageId: "illustrator.layer-tree" }
    }
  };
  const statePath = `${treePackage}\\runtime\\installed-page-state.json`;
  const setState = (highlightedKeys) => addFile(statePath, JSON.stringify({
    schemaVersion: 1,
    pageId: "illustrator.layer-tree",
    format: "flowcell.illustrator.layer-tree-state.v1",
    value: { highlightedKeys, expandedKeys: [] }
  }));

  addFile(`${programRoot}\\flowcell.program.json`, JSON.stringify(programManifest));
  addFile(actionSource, "");
  addFile(recordPath, JSON.stringify(activeRecord));
  addFile(`${treePackage}\\source\\flowcell.script.json`, JSON.stringify(sourceManifest));
  addFile(treeSource, "");
  setState(["0"]);

  const selectedLayer = { locked: true, visible: false, pageItems: [], layers: [] };
  const document = { layers: [selectedLayer], selection: ["native"] };
  const context = {
    File: VirtualFile,
    Folder: VirtualFolder,
    JSON: undefined,
    $: { fileName: actionSource },
    app: { documents: [document], activeDocument: document, redraw() {} }
  };
  vm.createContext(context);
  vm.runInContext(helper, context);
  return {
    api: context.FlowCellLayersBuilderSelection,
    selectedLayer,
    setState,
    addDuplicate() {
      addFile(
        `${programRoot}\\Panels\\Layers Builder\\duplicate.flowcell-source.json`,
        JSON.stringify({ page })
      );
    }
  };
}

test("all 19 Layers Builder actions are ordinary manifest packages", () => {
  assert.equal(contributions.length, 19);
  assert.equal(globalActions.size, 8);
  assert.equal(directOpenTreeActions.size, 2);
  assert.equal(nonmutatingTreeActions.size, 8);
  assert.equal(
    globalActions.size + directOpenTreeActions.size + nonmutatingTreeActions.size + 1,
    contributions.length
  );
  assert.equal(
    readdirSync(actionRoot).filter((name) => name.toLowerCase().endsWith(".jsx")).length,
    0,
    "raw catalog scripts must be promoted into package folders"
  );
  const catalogPackageNames = readdirSync(actionRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "tests")
    .map((entry) => entry.name)
    .sort();
  const contributionPackageNames = contributions
    .map(({ sourcePath }) => path.basename(sourcePath))
    .sort();
  assert.deepEqual(
    catalogPackageNames,
    contributionPackageNames,
    "every Layers Builder package directory must be declared exactly once"
  );

  const helpers = [];
  const classifiedActions = new Set();
  for (const contribution of contributions) {
    const actionName = contribution.id.slice(layersBuilderIdPrefix.length);
    const isGlobal = globalActions.has(actionName);
    const isDirectOpen = directOpenTreeActions.has(actionName);
    const isNonmutating = nonmutatingTreeActions.has(actionName);
    const isSnapshot = actionName === hybridAction;
    assert.equal(
      Number(isGlobal) + Number(isDirectOpen) + Number(isNonmutating) + Number(isSnapshot),
      1,
      `${contribution.id} must have exactly one Layers Builder action contract`
    );
    classifiedActions.add(actionName);

    assert.equal(contribution.version, actionName === "new-sub" ? "3.1.2" : "3.1.1");
    assert.equal(contribution.importKind, "script");
    assert.equal(contribution.installOnAdd, true);
    assert.equal("installIfMissing" in contribution, false);
    assert.doesNotMatch(contribution.sourcePath, /\.jsx$/i);

    const packageRoot = path.resolve(illustratorRoot, contribution.sourcePath);
    assert.ok(
      packageRoot.startsWith(`${actionRoot}${path.sep}`),
      `${contribution.id} must stay under the Illustrator-owned Layers Builder catalog`
    );
    assert.equal(statSync(packageRoot).isDirectory(), true);

    const manifest = JSON.parse(read(path.join(packageRoot, "flowcell.script.json")));
    const expectedManifestKeys = [
      "schemaVersion",
      "id",
      "label",
      "tooltip",
      "program",
      "source"
    ];
    if (actionName === "new-sub") expectedManifestKeys.push("execution");
    assert.deepEqual(Object.keys(manifest), expectedManifestKeys);
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.id, contribution.id);
    assert.equal(manifest.program, "Illustrator");
    assert.equal(path.isAbsolute(manifest.source), false);
    assert.equal(manifest.source.split(/[\\/]/).includes(".."), false);

    const sourcePath = path.resolve(packageRoot, manifest.source);
    assert.ok(sourcePath.startsWith(`${packageRoot}${path.sep}`));
    assert.equal(statSync(sourcePath).isFile(), true);
    const source = read(sourcePath);
    assert.doesNotMatch(source, /flowcell-illustrator-layers-highlight\.json/i);
    assert.doesNotMatch(source, /mirrorCapabilityStateToTemp|capabilityStateFile/i);
    assert.doesNotMatch(
      source,
      /FlowCellLayersBuilderSelection\.prepare\s*\(/,
      `${contribution.id} must never proxy targets through document.selection`
    );

    if (isGlobal) {
      assert.doesNotMatch(source, /flowcell-layer-tree-selection/i);
      assert.doesNotMatch(source, /FlowCellLayersBuilderSelection/);
    } else if (isDirectOpen) {
      assert.match(source, /^#include "flowcell-layer-tree-selection\.jsxinc"$/m);
      assert.match(source, /FlowCellLayersBuilderSelection\.resolveTargets\(\)/);
      assert.doesNotMatch(source, /FlowCellLayersBuilderSelection\.resolveTargets\(false\)/);
    } else if (isNonmutating) {
      assert.match(source, /^#include "flowcell-layer-tree-selection\.jsxinc"$/m);
      assert.match(source, /FlowCellLayersBuilderSelection\.resolveTargets\(false\)/);
    } else if (isSnapshot) {
      assert.match(source, /^#include "flowcell-layer-tree-selection\.jsxinc"$/m);
      assert.match(source, /FlowCellLayersBuilderSelection\.resolveTargets\(false\)/);
      assert.match(source, /function FlowCellSnapshotHasNativeSelection\(\)/);
      assert.match(source, /String\(selectionError\)\.indexOf\(emptyHighlightMessage\) < 0/);
      assert.match(source, /select artwork in Illustrator or highlight at least one layer in Layer Tree/);
      assert.match(source, /selection = app\.activeDocument\.selection/);
      assert.match(source, /selection = normalizeSelection\(documentRef\.selection\)/);
      assert.match(source, /layers:\s*\[\],\s*restore:\s*\[\]/s);
    }

    if (!isGlobal) {
      assert.match(
        source,
        /FlowCellLayersBuilderSelection\.restore\(FLOWCELL_LB_TARGETS\.restore\)/
      );
      const helper = read(path.join(packageRoot, "flowcell-layer-tree-selection.jsxinc"));
      helpers.push(helper);
    }
  }

  assert.equal(classifiedActions.size, 19);
  assert.equal(helpers.length, 11, "only tree-driven and hybrid actions include the resolver");
  assert.equal(new Set(helpers.map(digest)).size, 1, "every included resolver must be identical");
});

test("the package-owned resolver reads only a unique generic Layer Tree owner", () => {
  const helper = read(path.join(actionRoot, "3d", "flowcell-layer-tree-selection.jsxinc"));
  for (const required of [
    'var PAGE_ID = "illustrator.layer-tree"',
    'var PAGE_STATE_FORMAT = "flowcell.illustrator.layer-tree-state.v1"',
    'var ACTIVE_RECORD_SUFFIX = ".flowcell-source.json"',
    'var OWNER_STATE_NAME = "installed-page-state.json"',
    'trim(record.executionTarget.actionId) !== "open-installed-page"',
    'matches.length !== 1',
    'select at least one layer in the installed Layer Tree page first',
    'isInsidePath(sourceFile, sourceRoot)',
    'samePath(packageFolder.parent, localRoot)',
    'function resolveTargets(openLayers)',
    'if (openLayers !== false)'
  ]) {
    assert.ok(helper.includes(required), `resolver must contain ${required}`);
  }

  assert.doesNotMatch(helper, /Folder\.temp|flowcell-illustrator-layers-highlight/i);
  assert.doesNotMatch(helper, /\beval\s*\(/);
  assert.doesNotMatch(helper, /[A-Za-z]:[\\/]/);
  assert.match(helper, /JSON\.parse/);
  assert.match(helper, /throw new Error\("FlowCell Layers Builder: "/);
});

test("the resolver consumes owner runtime state and fails closed", () => {
  const helper = read(path.join(actionRoot, "3d", "flowcell-layer-tree-selection.jsxinc"));
  const fixture = resolverFixture(helper);
  const nonmutatingTargets = fixture.api.resolveTargets(false);
  assert.equal(nonmutatingTargets.layers.length, 1);
  assert.equal(nonmutatingTargets.layers[0], fixture.selectedLayer);
  assert.equal(nonmutatingTargets.restore.length, 0);
  assert.equal(fixture.selectedLayer.locked, true);
  assert.equal(fixture.selectedLayer.visible, false);

  const openedTargets = fixture.api.resolveTargets();
  assert.equal(openedTargets.layers.length, 1);
  assert.equal(openedTargets.layers[0], fixture.selectedLayer);
  assert.equal(openedTargets.restore.length, 1);
  assert.equal(fixture.selectedLayer.locked, false);
  assert.equal(fixture.selectedLayer.visible, true);
  fixture.api.restore(openedTargets.restore);
  assert.equal(fixture.selectedLayer.locked, true);
  assert.equal(fixture.selectedLayer.visible, false);

  fixture.setState([]);
  assert.throws(
    () => fixture.api.resolveTargets(),
    /select at least one layer in the installed Layer Tree page first/
  );
  fixture.setState(["0"]);
  fixture.addDuplicate();
  assert.throws(
    () => fixture.api.resolveTargets(),
    /expected exactly one active installed Layer Tree owner, but found 2/
  );
});

test("Sort protects and orders the complete five-root system", () => {
  const source = readActionSource("sort");
  assert.match(source, /var ROOT_3D = "3D"/);
  assert.match(source, /threeD:\s*ensureRootLayer\(documentRef, ROOT_3D\)/);
  assert.match(
    source,
    /orderRootLayers\(\[\s*roots\.live,\s*roots\.snapshots,\s*roots\.threeD,\s*roots\.trash,\s*roots\.archive\s*\]\)/s
  );
  assert.match(
    source,
    /function isSystemRoot\(layer\)[\s\S]*?layer\.name === ROOT_3D[\s\S]*?layer\.name === ROOT_ARCHIVE/
  );
});

test("Empty Trash confirms before deleting the Trash contents", () => {
  const source = readActionSource("empty-trash");
  const confirmationIndex = source.indexOf(
    'confirm("Permanently delete everything inside the Trash layer?", true, "Empty Trash")'
  );
  const deletionIndex = source.indexOf("clearLayerContents(roots.trash)");
  assert.ok(confirmationIndex >= 0, "Empty Trash must ask for destructive confirmation");
  assert.ok(deletionIndex > confirmationIndex, "confirmation must happen before Trash is cleared");
  assert.match(source, /if \(!confirm\([\s\S]*?\)\) \{\s*return;\s*\}/);
});

test("Delete Sublayer protects system roots and anything under Trash or Archive", () => {
  const source = readActionSource("delete-sublayer");
  for (const rootName of ["ROOT_LIVE", "ROOT_SNAPSHOTS", "ROOT_3D", "ROOT_TRASH", "ROOT_ARCHIVE"]) {
    assert.match(source, new RegExp(`layer\\.name === ${rootName}`));
  }
  assert.match(source, /if \(!top \|\| isSystemRoot\(layer\)\) \{\s*return false;/);
  assert.match(source, /return top\.name !== ROOT_TRASH && top\.name !== ROOT_ARCHIVE;/);
  assert.match(source, /if \(!isDeletableLayer\(doomed\[d\]\)\) \{\s*continue;/);
});

test("New Sub requires exactly one target and creates a direct child", () => {
  const source = readActionSource("new-sub");
  const manifest = JSON.parse(read(path.join(actionRoot, "new-sub", "flowcell.script.json")));
  assert.match(source, /FlowCellLayersBuilderSelection\.resolveTargets\(\)/);
  assert.match(source, /FLOWCELL_LB_TARGETS\.layers\.length !== 1/);
  assert.match(source, /parentLayer = FLOWCELL_LB_TARGETS\.layers\[0\]/);
  assert.match(source, /prompt\("Name for the new sublayer:"/);
  assert.match(source, /if \(requestedName === null\) \{\s*return;/);
  assert.match(source, /newLayer = parentLayer\.layers\.add\(\)/);
  assert.doesNotMatch(source, /documentRef\.selection|doc\.selection/);
  assert.deepEqual(manifest.execution, { waitForCompletion: true });
  const contribution = contributions.find((candidate) =>
    candidate.id === "illustrator.layers-builder.new-sub"
  );
  assert.equal(contribution?.version, "3.1.2");
});

test("Layer Tree is default-selected but never resurrected after deletion", () => {
  assert.ok(layerTreeContribution);
  assert.equal(layerTreeContribution.version, "3.0.1");
  assert.equal(layerTreeContribution.sourcePath, "Illustrator Git Scripts/LayersBuilder");
  assert.equal(layerTreeContribution.importKind, "script");
  assert.equal(layerTreeContribution.installOnAdd, true);
  assert.equal("installIfMissing" in layerTreeContribution, false);
});
