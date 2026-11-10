import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(testDirectory, "..");
const jsxPath = path.join(packageDirectory, "Lithophane.jsx");
const powershellPath = path.join(packageDirectory, "Send-Lithophane-To-Blender.ps1");
const vbsPath = path.join(packageDirectory, "Send-Lithophane-To-Blender.vbs");
const manifestPath = path.join(packageDirectory, "flowcell.script.json");
const jsxSource = fs.readFileSync(jsxPath, "utf8");
const powershellSource = fs.readFileSync(powershellPath, "utf8");
const vbsSource = fs.readFileSync(vbsPath, "utf8");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function loadApi(host = {}) {
  const context = {
    ...host,
    __FLOWCELL_ILLUSTRATOR_LITHOPHANE_TEST__: true,
  };
  context.$ = {
    global: context,
  };
  vm.createContext(context);
  const executable = jsxSource.replace(/^#target illustrator\s*/m, "");
  vm.runInContext(executable, context, { filename: jsxPath });
  return context.__FLOWCELL_ILLUSTRATOR_LITHOPHANE_TEST_API__;
}

function captureHarness({ extension = "raw", failCapture = false, failRename = false, userDataPath = "C:/Users/QA/AppData/Roaming" } = {}) {
  const files = new Set();
  const calls = { captured: [], closed: 0, activated: 0 };
  function File(filePath) {
    this.fsName = filePath;
    this.name = filePath.split("/").at(-1);
    Object.defineProperty(this, "exists", { get: () => files.has(this.fsName) });
    this.rename = (name) => {
      if (failRename) return false;
      files.delete(this.fsName);
      this.fsName = this.fsName.slice(0, this.fsName.lastIndexOf("/") + 1) + name;
      this.name = name;
      files.add(this.fsName);
      return true;
    };
  }
  function Folder(folderPath) { this.fsName = folderPath; this.exists = true; }
  Folder.userData = { fsName: userDataPath };
  const original = { documentColorSpace: "RGB", activate() { calls.activated += 1; } };
  const temporary = {
    layers: [{}],
    imageCapture(file) {
      calls.captured.push(file.fsName);
      // Matches Illustrator's observed silent MAX_PATH failure.
      if (!failCapture && file.fsName.length < 260) files.add(file.fsName + (extension === "png" ? ".png" : ""));
    },
    close() { calls.closed += 1; },
  };
  const selected = {
    source: { fileName: "a-very-long-original-white-image-file-name-for-a-physical-lithophane.png" },
    item: { duplicate() { return { geometricBounds: [0, 72, 144, 0] }; } },
    itemBounds: [0, 72, 144, 0], bounds: [0, 72, 144, 0],
  };
  const api = loadApi({ File, Folder, app: { documents: { add() { return temporary; } } },
    ImageCaptureOptions: function () {}, ElementPlacement: { PLACEATEND: 1 }, SaveOptions: { DONOTSAVECHANGES: 0 } });
  return { api, original, selected, calls, files };
}

test("native capture keeps a long owned runtime path usable despite the original PNG name", () => {
  for (const extension of ["raw", "png"]) {
    const h = captureHarness({ extension });
    const folder = { fsName: "C:/" + "a".repeat(222) };
    const first = h.api.exportSelectedPng(h.original, h.selected, folder, "illustrator-lithophane-1794284061153-123456");
    const second = h.api.exportSelectedPng(h.original, h.selected, folder, "illustrator-lithophane-1794284061153-123457");
    assert.notEqual(first, second);
    assert.ok(first.length < 260);
    assert.equal(h.files.has(first), true);
    assert.equal(h.files.has(second), true);
    assert.deepEqual([h.calls.closed, h.calls.activated], [2, 2]);
  }
});

test("a deeper owner path uses persistent application PNG cache without losing request uniqueness", () => {
  const h = captureHarness();
  const result = h.api.exportSelectedPng(h.original, h.selected, { fsName: "C:/" + "a".repeat(280) }, "illustrator-lithophane-1794284061153-123456");
  assert.equal(result, "C:/Users/QA/AppData/Roaming/FlowCell/lithophane-exports/1794284061153-123456.png");
  assert.equal(h.files.has(result), true);
  assert.deepEqual([h.calls.closed, h.calls.activated], [1, 1]);
});

test("an unusably deep fallback fails clearly before opening a temporary document", () => {
  const h = captureHarness({ userDataPath: "C:/" + "u".repeat(280) });
  assert.throws(() => h.api.exportSelectedPng(h.original, h.selected, { fsName: "C:/" + "a".repeat(280) }, "illustrator-lithophane-1794284061153-123456"), /PNG cache path is too long/);
  assert.equal(h.calls.captured.length, 0);
  assert.equal(h.calls.closed, 0);
});

test("capture collisions preserve prior PNG files without opening a temporary document", () => {
  const h = captureHarness();
  const folder = { fsName: "C:/runtime/png-exports" };
  const id = "illustrator-lithophane-1794284061153-123456";
  const existing = h.api.exportSelectedPng(h.original, h.selected, folder, id);
  assert.throws(() => h.api.exportSelectedPng(h.original, h.selected, folder, id), /already exists/);
  assert.equal(h.files.has(existing), true);
  assert.equal(h.calls.captured.length, 1);
});

test("capture and rename failures still close only the temporary document and reactivate the original", () => {
  for (const options of [{ failCapture: true }, { failRename: true }]) {
    const h = captureHarness(options);
    assert.throws(() => h.api.exportSelectedPng(h.original, h.selected, { fsName: "C:/runtime/png-exports" }, "illustrator-lithophane-1794284061153-123456"), /did not create|could not rename/);
    assert.deepEqual([h.calls.closed, h.calls.activated], [1, 1]);
  }
});

function layer(name = "Owning Sublayer") {
  return { typename: "Layer", name, parent: null };
}

function linkedFile(fileName = "height-map.png", filePath = `C:\\art\\${fileName}`) {
  return {
    exists: true,
    name: fileName,
    fsName: filePath,
  };
}

test("one linked PlacedItem uses its original PNG and exact Illustrator point dimensions", () => {
  const api = loadApi();
  const item = {
    typename: "PlacedItem",
    parent: layer(),
    geometricBounds: [10, 100, 82, 28],
    file: linkedFile("relief.PNG", "C:\\art\\relief.PNG"),
  };

  const result = api.resolveSelectedPng([item]);
  assert.equal(result.source.kind, "linked");
  assert.equal(result.source.imagePath, "C:\\art\\relief.PNG");
  assert.equal(result.objectName, "Owning Sublayer");
  assert.ok(Math.abs(result.widthMm - 25.4) < 1e-12);
  assert.ok(Math.abs(result.heightMm - 25.4) < 1e-12);
});

test("the nearest owning Illustrator sublayer supplies the exact Blender object name", () => {
  const api = loadApi();
  const topLayer = layer("Top Level");
  const owningSublayer = layer("  (9) Main Stencil  ");
  const group = { typename: "GroupItem", parent: owningSublayer, pageItems: [] };
  const item = {
    typename: "PlacedItem",
    parent: group,
    geometricBounds: [0, 72, 72, 0],
    file: linkedFile(),
  };
  owningSublayer.parent = topLayer;
  group.pageItems = [item];

  const result = api.resolveSelectedPng([item]);
  assert.equal(api.getNearestOwningLayer(item), owningSublayer);
  assert.equal(result.objectName, "  (9) Main Stencil  ");
});

test("a clipping path supplies the authoritative geometric width and height", () => {
  const api = loadApi();
  const parentLayer = layer();
  const clippingPath = {
    typename: "PathItem",
    clipping: true,
    geometricBounds: [36, 108, 108, 36],
  };
  const group = {
    typename: "GroupItem",
    clipped: true,
    parent: parentLayer,
    pageItems: [],
  };
  const item = {
    typename: "PlacedItem",
    parent: group,
    geometricBounds: [0, 144, 144, 0],
    file: linkedFile(),
  };
  group.pageItems = [clippingPath, item];

  const result = api.resolveSelectedPng([item]);
  assert.equal(result.clippingPath, clippingPath);
  assert.deepEqual(Array.from(result.bounds), [36, 108, 108, 36]);
  assert.ok(Math.abs(result.widthMm - 25.4) < 1e-12);
  assert.ok(Math.abs(result.heightMm - 25.4) < 1e-12);
});

test("an unrelated clipping path in a sibling branch cannot override the selected PNG bounds", () => {
  const api = loadApi();
  const parentLayer = layer();
  const unrelatedMask = {
    typename: "PathItem",
    clipping: true,
    geometricBounds: [18, 54, 54, 18],
  };
  const unrelatedGroup = {
    typename: "GroupItem",
    clipped: true,
    pageItems: [unrelatedMask],
  };
  const normalGroup = {
    typename: "GroupItem",
    clipped: false,
    parent: parentLayer,
    pageItems: [],
  };
  const item = {
    typename: "PlacedItem",
    parent: normalGroup,
    geometricBounds: [0, 72, 144, 0],
    file: linkedFile(),
  };
  unrelatedGroup.parent = normalGroup;
  normalGroup.pageItems = [item, unrelatedGroup];

  const result = api.resolveSelectedPng([item]);
  assert.equal(result.clippingPath, null);
  assert.deepEqual(Array.from(result.bounds), [0, 72, 144, 0]);
});

test("rotated, sheared, or mirrored linked PNGs require appearance capture", () => {
  const api = loadApi();

  assert.equal(api.requiresAppearanceCapture({
    matrix: { mValueA: 2, mValueB: 0, mValueC: 0, mValueD: 0.5 },
  }), false);
  assert.equal(api.requiresAppearanceCapture({
    matrix: { mValueA: 0.707, mValueB: 0.707, mValueC: -0.707, mValueD: 0.707 },
  }), true);
  assert.equal(api.requiresAppearanceCapture({
    matrix: { mValueA: 1, mValueB: 0, mValueC: 0.25, mValueD: 1 },
  }), true);
  assert.equal(api.requiresAppearanceCapture({
    matrix: { mValueA: -1, mValueB: 0, mValueC: 0, mValueD: 1 },
  }), true);
  assert.equal(api.requiresAppearanceCapture({}), true);
});

test("an embedded RasterItem is routed to the transparent temporary export path", () => {
  const api = loadApi();
  const item = {
    typename: "RasterItem",
    embedded: true,
    name: "embedded relief",
    parent: layer(),
    geometricBounds: [0, 72, 144, 0],
    get file() {
      throw new Error("embedded raster has no external file");
    },
  };

  const result = api.resolveSelectedPng([item]);
  assert.equal(result.source.kind, "export");
  assert.equal(result.source.fileName, "embedded relief");
  assert.ok(Math.abs(result.widthMm - 50.8) < 1e-12);
  assert.ok(Math.abs(result.heightMm - 25.4) < 1e-12);
});

test("an unavailable linked PNG is also routed to the temporary export path", () => {
  const api = loadApi();
  const item = {
    typename: "RasterItem",
    embedded: false,
    parent: layer(),
    geometricBounds: [0, 72, 72, 0],
    file: {
      exists: false,
      name: "missing.png",
      fsName: "C:\\missing\\missing.png",
    },
  };

  const result = api.resolveSelectedPng([item]);
  assert.equal(result.source.kind, "export");
  assert.equal(result.source.fileName, "missing.png");
});

test("an unavailable PlacedItem without a filename fails instead of guessing its format", () => {
  const api = loadApi();
  const item = {
    typename: "PlacedItem",
    parent: layer(),
    geometricBounds: [0, 72, 72, 0],
    get file() {
      throw new Error("no link metadata");
    },
  };

  assert.throws(() => api.resolveSelectedPng([item]), /cannot verify.*PNG/i);
});

test("a linked non-PNG image fails closed", () => {
  const api = loadApi();
  const item = {
    typename: "PlacedItem",
    parent: layer(),
    geometricBounds: [0, 72, 72, 0],
    file: linkedFile("photo.jpg", "C:\\art\\photo.jpg"),
  };

  assert.throws(() => api.resolveSelectedPng([item]), /must be a PNG/);
});

test("selection and type validation require exactly one PlacedItem or RasterItem", () => {
  const api = loadApi();
  assert.throws(() => api.resolveSelectedPng([]), /exactly one PNG/);
  assert.throws(
    () => api.resolveSelectedPng([
      { typename: "PlacedItem" },
      { typename: "RasterItem" },
    ]),
    /exactly one PNG/
  );
  assert.throws(
    () => api.resolveSelectedPng([{
      typename: "PathItem",
      parent: layer(),
      geometricBounds: [0, 72, 72, 0],
    }]),
    /PlacedItem or RasterItem/
  );
});

test("zero-size or non-finite Illustrator bounds fail closed", () => {
  const api = loadApi();
  assert.throws(
    () => api.validateGeometricBounds([0, 10, 0, 0], "Bounds"),
    /invalid or zero-size/
  );
  assert.throws(
    () => api.validateGeometricBounds([0, Number.NaN, 10, 0], "Bounds"),
    /invalid or zero-size/
  );
});

test("clipping bounds are mapped onto a duplicated raster without changing physical authority", () => {
  const api = loadApi();
  const selectedPng = {
    itemBounds: [0, 100, 200, 0],
    bounds: [50, 80, 150, 20],
  };
  const mapped = api.mapAuthorityBoundsToDuplicate(selectedPng, [10, 210, 410, 10]);
  assert.deepEqual(Array.from(mapped), [110, 170, 310, 50]);
});

test("request JSON carries the original or exported image path and exact millimeter values", () => {
  const api = loadApi();
  const request = JSON.parse(api.buildRequestJson("illustrator-lithophane-1", {
    imagePath: "C:\\art\\height-map.png",
    objectName: "(9) Main Stencil",
    widthMm: 50.8123456789,
    heightMm: 25.4067890123,
  }));

  assert.deepEqual(request, {
    schemaVersion: 1,
    requestId: "illustrator-lithophane-1",
    imagePath: "C:\\art\\height-map.png",
    objectName: "(9) Main Stencil",
    widthMm: 50.8123456789,
    heightMm: 25.4067890123,
  });
});

test("status parsing retains messages containing equals signs", () => {
  const api = loadApi();
  assert.deepEqual(
    { ...api.parseStatusText("\ufeffRequestId=req-1\r\nStatus=Ok\r\nMessage=x=10 y=20\r\nChangedCount=1\r\n") },
    {
      RequestId: "req-1",
      Status: "Ok",
      Message: "x=10 y=20",
      ChangedCount: "1",
    }
  );
});

test("Illustrator runtime preserves source state and alpha for embedded export", () => {
  assert.match(jsxSource, /selectedPng\.item\.duplicate\(temporaryLayer, ElementPlacement\.PLACEATEND\)/);
  assert.match(jsxSource, /temporaryDocument\.imageCapture\(outputStem, captureBounds, captureOptions\)/);
  assert.match(jsxSource, /captureOptions\.transparency = true/);
  assert.match(jsxSource, /captureOptions\.matte = false/);
  assert.match(jsxSource, /!selectedPng\.clippingPath && !selectedPng\.captureAppearance/);
  assert.match(jsxSource, /documentRef\.close\(SaveOptions\.DONOTSAVECHANGES\)/);
  assert.doesNotMatch(jsxSource, /app\.activeDocument\.selection\s*=/);
  assert.doesNotMatch(jsxSource, /originalDocument\.selection\s*=/);
});

test("PowerShell resolves exactly one active Blender Lithophane owner and sends explicit dimensions", () => {
  assert.match(powershellSource, /\$lithophaneBundledSourceId = 'blender\.lithophane'/);
  assert.match(powershellSource, /Programs\\Blender\\Panels\\Utility/);
  assert.match(powershellSource, /\$matches\.Count -ne 1/);
  assert.match(powershellSource, /\$expectedBridgeAction = 'flowcell_button_\{0\}'/);
  assert.match(powershellSource, /Get-ObjectPropertyValue -Source \$runtimeStatus -Name 'events'/);
  assert.match(powershellSource, /\$statusEvents = @\(\$lastEvent\) \+ @\(\$eventHistory\)/);
  assert.match(powershellSource, /\$runningProcessIds -contains \$runtimeProcessId/);
  assert.match(powershellSource, /image_path = \$imagePath/);
  assert.match(powershellSource, /object_name = \$objectName/);
  assert.match(powershellSource, /width_mm = \$widthMm/);
  assert.match(powershellSource, /height_mm = \$heightMm/);
  assert.match(powershellSource, /Invoke-BlenderFlowCellAction\.ps1/);
  assert.match(powershellSource, /PassThruResponse = \$true/);
  assert.match(powershellSource, /Start-Process -FilePath \$blenderExecutable -WindowStyle Normal -PassThru/);
});

test("same-package handoff and manifest expose one Lithophane script package", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, "illustrator.lithophane");
  assert.equal(manifest.label, "Lithophane");
  assert.equal(manifest.source, "Lithophane.jsx");
  assert.equal(manifest.execution.waitForCompletion, true);
  assert.match(vbsSource, /lithophane\.request\.json/i);
  assert.match(vbsSource, /Send-Lithophane-To-Blender\.ps1/i);
});
