import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const packageRoot = path.resolve(import.meta.dirname, "..");
const installedSource = "C:\\FlowCell\\Programs\\Illustrator\\Illustrator Local Scripts\\owner-one\\source\\Illustrator Symmetry.jsx";
const catalogCommand = "C:\\FlowCell\\flowcellbackend\\local\\illustrator_symmetry_command.json";

function normalizePath(value) {
  return String(value)
    .replaceAll("/", "\\")
    .replace(/\\+$/, "")
    .toLowerCase();
}

function parentPath(value) {
  const normalized = String(value).replaceAll("/", "\\").replace(/\\+$/, "");
  return normalized.slice(0, normalized.lastIndexOf("\\"));
}

function createHarness() {
  const files = new Map();
  const folders = new Set();
  const sourceFolder = parentPath(installedSource);
  const ownerFolder = parentPath(sourceFolder);
  const runtimeFolder = `${ownerFolder}\\runtime`;
  const document = {
    name: "Symmetry Test",
    saved: false,
    pathItems: [],
    selection: [],
    artboards: {
      getActiveArtboardIndex: () => 0,
      0: { artboardRect: [0, 100, 100, 0] }
    }
  };
  let copySequence = 0;
  let watcherLaunches = 0;

  const addFolder = (value) => folders.add(normalizePath(value));
  const addFile = (value, contents = "") => {
    addFolder(parentPath(value));
    files.set(normalizePath(value), contents);
  };
  addFolder(ownerFolder);
  addFolder(sourceFolder);
  addFile(installedSource, "// installed source");
  addFile(`${sourceFolder}\\Start Illustrator Symmetry Watcher.vbs`, "launcher");

  class Folder {
    constructor(value) {
      this.fsName = String(value).replaceAll("/", "\\");
    }

    get exists() {
      return folders.has(normalizePath(this.fsName));
    }

    create() {
      addFolder(this.fsName);
      return true;
    }

    get parent() {
      return new Folder(parentPath(this.fsName));
    }

    get name() {
      const normalized = this.fsName.replace(/\\+$/, "");
      return normalized.slice(normalized.lastIndexOf("\\") + 1);
    }
  }

  class File {
    constructor(value) {
      this.fsName = String(value).replaceAll("/", "\\");
      this.encoding = "UTF-8";
      this.mode = "";
      this.buffer = "";
    }

    get exists() {
      return files.has(normalizePath(this.fsName));
    }

    get parent() {
      return new Folder(parentPath(this.fsName));
    }

    open(mode) {
      this.mode = mode;
      if (mode === "r" && !this.exists) return false;
      this.buffer = mode === "a" ? files.get(normalizePath(this.fsName)) ?? "" : "";
      return true;
    }

    read() {
      return files.get(normalizePath(this.fsName)) ?? "";
    }

    write(value) {
      this.buffer += String(value);
    }

    writeln(value) {
      this.buffer += `${String(value)}\n`;
    }

    close() {
      if (this.mode === "w" || this.mode === "a") addFile(this.fsName, this.buffer);
      return true;
    }

    remove() {
      return files.delete(normalizePath(this.fsName));
    }

    execute() {
      watcherLaunches += 1;
      return true;
    }
  }

  function makePath(uuid, options = {}) {
    const tags = [];
    tags.add = () => {
      const tag = { name: "", value: "" };
      tags.push(tag);
      return tag;
    };
    if (options.copyTag) tags.push({ name: "FlowCellSymmetryCopy", value: options.copyTag });
    const item = {
      typename: "PathItem",
      uuid,
      pathPoints: [
        {
          anchor: [10, 10],
          leftDirection: [10, 10],
          rightDirection: [10, 10],
          pointType: "CORNER"
        },
        {
          anchor: [30, 20],
          leftDirection: [30, 20],
          rightDirection: [30, 20],
          pointType: "CORNER"
        }
      ],
      closed: false,
      stroked: true,
      strokeWidth: 1,
      filled: false,
      clipping: false,
      guides: false,
      hidden: false,
      locked: false,
      editable: true,
      layer: { locked: false, visible: true },
      visibleBounds: [10, 20, 30, 10],
      tags,
      transforms: [],
      duplicate() {
        const copy = makePath(`generated-${++copySequence}`);
        document.pathItems.push(copy);
        return copy;
      },
      transform(matrix) {
        this.transforms.push({ ...matrix });
      },
      remove() {
        const index = document.pathItems.indexOf(this);
        if (index >= 0) document.pathItems.splice(index, 1);
      }
    };
    return item;
  }

  const context = vm.createContext({
    File,
    Folder,
    Transformation: { DOCUMENTORIGIN: "DOCUMENTORIGIN" },
    app: {
      documents: [document],
      activeDocument: document,
      getRotationMatrix: (angle) => ({ mValueA: 1, mValueB: 0, mValueC: 0, mValueD: 1, angle }),
      getScaleMatrix: (x, y) => ({ mValueA: x / 100, mValueB: 0, mValueC: 0, mValueD: y / 100 }),
      redraw() {}
    },
    $: { fileName: installedSource, global: { __FLOWCELL_ILLUSTRATOR_SYMMETRY_TEST__: true }, writeln() {} },
    FLOWCELL_SCRIPT_PATH: installedSource,
    console
  });

  return {
    addFile,
    document,
    files,
    makePath,
    runtimeFolder,
    sourceFolder,
    watcherLaunches: () => watcherLaunches,
    context
  };
}

async function loadApi(harness) {
  const cores = await Promise.all(
    [1, 2, 3, 4].map((index) =>
      readFile(path.join(packageRoot, `Illustrator Symmetry Core ${index}.jsxinc`), "utf8")
    )
  );
  new vm.Script(cores.join("\n"), { filename: "Illustrator Symmetry combined core.jsx" })
    .runInContext(harness.context);
  return harness.context.$.global.__FLOWCELL_ILLUSTRATOR_SYMMETRY_TEST_API__;
}

async function runCount(mode, count) {
  const harness = createHarness();
  const api = await loadApi(harness);
  api.configure({ enabled: true, mode, count });
  const source = harness.makePath(`${mode}-${count}`);
  harness.document.pathItems.push(source);
  harness.document.selection = [source];
  const result = api.processRelease();
  const generated = harness.document.pathItems.filter((item) =>
    item.tags.some((tag) => tag.name === "FlowCellSymmetryCopy")
  );
  return { api, generated, harness, result };
}

test("Radial 2 and 8 create the requested total positions", async () => {
  for (const [count, copies] of [[2, 1], [8, 7]]) {
    const result = await runCount("RADIAL", count);
    assert.equal(result.generated.length, copies);
    assert.match(result.result, new RegExp(`\\|${copies}$`));
  }
});

test("Mirror 2, 6, and 12 create the requested total positions", async () => {
  for (const [count, copies] of [[2, 1], [6, 5], [12, 11]]) {
    const result = await runCount("MIRROR", count);
    assert.equal(result.generated.length, copies);
    assert.match(result.result, new RegExp(`\\|${copies}$`));
  }
});

test("generated copies are tagged, ignored, and never reprocessed", async () => {
  const result = await runCount("RADIAL", 8);
  const before = result.harness.document.pathItems.length;
  assert.equal(result.api.processRelease(), "no-change");
  assert.equal(result.harness.document.pathItems.length, before);
  assert.ok(result.generated.every((item) =>
    item.tags.some((tag) => tag.name === "FlowCellSymmetryCopy")
  ));
});

test("enabling establishes a baseline and disabling prevents processing", async () => {
  const harness = createHarness();
  const api = await loadApi(harness);
  const existing = harness.makePath("existing");
  harness.document.pathItems.push(existing);
  api.configure({ enabled: true, mode: "RADIAL", count: 8 });
  assert.equal(api.processRelease(), "no-change");

  api.configure({ enabled: false });
  const later = harness.makePath("later");
  harness.document.pathItems.push(later);
  harness.document.selection = [later];
  assert.equal(api.processRelease(), "disabled");
  assert.equal(
    harness.document.pathItems.filter((item) =>
      item.tags.some((tag) => tag.name === "FlowCellSymmetryCopy")
    ).length,
    0
  );
});

test("switching between same-named unsaved documents establishes a new baseline", async () => {
  const harness = createHarness();
  const api = await loadApi(harness);
  api.configure({ enabled: true, mode: "RADIAL", count: 8 });

  const second = {
    name: harness.document.name,
    saved: false,
    pathItems: [],
    selection: [],
    artboards: {
      getActiveArtboardIndex: () => 0,
      0: { artboardRect: [0, 100, 100, 0] }
    }
  };
  const existing = harness.makePath("second-unsaved-existing");
  second.pathItems.push(existing);
  harness.context.app.documents.push(second);
  harness.context.app.activeDocument = second;

  assert.notEqual(api.getDocumentKey(harness.document), api.getDocumentKey(second));
  assert.equal(api.processRelease(), "document-baseline");
});

test("unsupported mode and count values are rejected instead of normalized silently", async () => {
  const harness = createHarness();
  const api = await loadApi(harness);
  assert.equal(api.normalizeMode("spiral"), null);
  assert.equal(api.normalizeCount(10), null);
  assert.equal(api.normalizeCount("8"), 8);
  assert.throws(() => api.configure({ mode: "spiral" }), /Unsupported Symmetry mode/);
  assert.throws(() => api.configure({ count: 10 }), /Unsupported Symmetry count/);
});

test("commands are read from the installed owner runtime, not the catalog global folder", async () => {
  const harness = createHarness();
  const api = await loadApi(harness);
  harness.addFile(catalogCommand, "{ not the installed command }");
  const commandPath = `${harness.runtimeFolder}\\illustrator_symmetry_command.json`;
  harness.addFile(commandPath, JSON.stringify({
    ownerButtonId: "OWNER-ONE",
    sourcePath: installedSource,
    command: "configure",
    createdAtMs: Date.now(),
    payload: { mode: "MIRROR", count: 6 }
  }));
  const command = api.readCommand();
  assert.equal(command.command, "configure");
  assert.equal(JSON.stringify(command.payload), JSON.stringify({ mode: "MIRROR", count: 6 }));
  assert.equal(harness.files.has(normalizePath(commandPath)), false);
  assert.equal(harness.files.has(normalizePath(catalogCommand)), true);

  harness.addFile(commandPath, JSON.stringify({
    ownerButtonId: "other-owner",
    sourcePath: installedSource,
    command: "configure",
    createdAtMs: Date.now(),
    payload: {}
  }));
  assert.throws(() => api.readCommand(), /does not belong/);
});

test("the package gates duplicate owner watchers with a per-source mutex", async () => {
  const [wrapper, watcher, launcher, stopper] = await Promise.all([
    readFile(path.join(packageRoot, "Illustrator Symmetry.jsx"), "utf8"),
    readFile(path.join(packageRoot, "IllustratorSymmetryWatcher.ps1"), "utf8"),
    readFile(path.join(packageRoot, "Start Illustrator Symmetry Watcher.vbs"), "utf8"),
    readFile(path.join(packageRoot, "Stop Illustrator Symmetry Watcher.ps1"), "utf8")
  ]);
  assert.doesNotThrow(() => new vm.Script(wrapper, { filename: "Illustrator Symmetry.jsx" }));
  assert.match(watcher, /Get-OwnerMutexName/);
  assert.match(watcher, /WaitOne\(0\)/);
  assert.match(launcher, /-OwnerToken/);
  assert.match(stopper, /Wait-ForOwnerMutexRelease/);
});
