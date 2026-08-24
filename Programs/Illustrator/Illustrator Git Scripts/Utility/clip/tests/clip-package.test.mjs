import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(packageRoot, "flowcell.script.json"), "utf8"));
const source = readFileSync(path.join(packageRoot, manifest.source), "utf8");

function loadHelpers() {
  const marker = "(function () {";
  const instrumented = source
    .replace(/^#target\s+illustrator\s*$/m, "")
    .replace(
      marker,
      `${marker}\n` +
        "globalThis.__clipTest = { " +
        "topSelectedCutter: topSelectedCutter, " +
        "isClosedCutter: isClosedCutter, " +
        "beginTemporaryCutterFill: beginTemporaryCutterFill, " +
        "restoreTemporaryCutterFill: restoreTemporaryCutterFill, " +
        "createPathFromCubics: createPathFromCubics " +
        "}; return;"
    );
  const context = {
    ElementPlacement: { PLACEBEFORE: "PLACEBEFORE" },
    GrayColor: function GrayColor() {
      this.typename = "GrayColor";
      this.gray = null;
    },
    PointType: { SMOOTH: "SMOOTH" }
  };
  vm.createContext(context);
  vm.runInContext(instrumented, context);
  return context.__clipTest;
}

test("clip package keeps its requested identity and concise cutter instructions", () => {
  assert.equal(manifest.id, "illustrator.clip");
  assert.equal(manifest.label, "clip");
  assert.equal(manifest.program, "Illustrator");
  assert.equal(manifest.source, "clip.jsx");
  assert.doesNotMatch(source, /does not have to be a circle/i);
  assert.doesNotMatch(source, /cutter must have a fill/i);
  assert.match(source, /finally\s*\{\s*cutterFillRestored\s*=\s*restoreTemporaryCutterFill/s);
});

test("an unfilled closed path receives a temporary default fill and restores NoColor", () => {
  const helpers = loadHelpers();
  const defaultFill = { typename: "RGBColor", red: 12, green: 34, blue: 56 };
  const originalFill = { typename: "NoColor" };
  const cutter = {
    typename: "PathItem",
    closed: true,
    clipping: false,
    filled: false,
    fillColor: originalFill
  };

  assert.equal(helpers.isClosedCutter(cutter), true);
  const state = helpers.beginTemporaryCutterFill(cutter, { defaultFillColor: defaultFill });
  assert.equal(state.success, true);
  assert.equal(cutter.filled, true);
  assert.equal(cutter.fillColor, defaultFill);
  assert.equal(helpers.restoreTemporaryCutterFill(state), true);
  assert.equal(cutter.filled, false);
  assert.equal(cutter.fillColor, originalFill);
});

test("the top selected object is the cutter even when target strokes are also closed", () => {
  const helpers = loadHelpers();
  const cutter = {
    typename: "PathItem",
    closed: true,
    clipping: false
  };
  const closedTargetStroke = {
    typename: "PathItem",
    closed: true,
    clipping: false,
    stroked: true
  };

  assert.equal(helpers.topSelectedCutter([cutter, closedTargetStroke]), cutter);
  assert.equal(helpers.topSelectedCutter([closedTargetStroke, cutter]), closedTargetStroke);
});

test("a cutter that already has a fill is left completely unchanged", () => {
  const helpers = loadHelpers();
  const originalFill = { typename: "RGBColor", red: 90, green: 80, blue: 70 };
  const cutter = {
    typename: "PathItem",
    closed: true,
    clipping: false,
    filled: true,
    fillColor: originalFill
  };

  const state = helpers.beginTemporaryCutterFill(cutter, {});
  assert.equal(state.success, true);
  assert.equal(state.changes.length, 0);
  assert.equal(helpers.restoreTemporaryCutterFill(state), true);
  assert.equal(cutter.filled, true);
  assert.equal(cutter.fillColor, originalFill);
});

test("automatic fill falls back to black when the document default has no color", () => {
  const helpers = loadHelpers();
  const cutter = {
    typename: "PathItem",
    closed: true,
    clipping: false,
    filled: false,
    fillColor: { typename: "NoColor" }
  };

  const state = helpers.beginTemporaryCutterFill(
    cutter,
    { defaultFillColor: { typename: "NoColor" } }
  );
  assert.equal(state.success, true);
  assert.equal(cutter.fillColor.typename, "GrayColor");
  assert.equal(cutter.fillColor.gray, 0);
  assert.equal(helpers.restoreTemporaryCutterFill(state), true);
  assert.equal(cutter.filled, false);
});

test("an unfilled compound cutter fills each closed subpath", () => {
  const helpers = loadHelpers();
  const defaultFill = { typename: "CMYKColor", cyan: 0, magenta: 0, yellow: 0, black: 25 };
  const pathItems = [0, 1].map(() => ({
    closed: true,
    clipping: false,
    filled: false,
    fillColor: { typename: "NoColor" }
  }));
  const cutter = { typename: "CompoundPathItem", pathItems };

  assert.equal(helpers.isClosedCutter(cutter), true);
  const state = helpers.beginTemporaryCutterFill(cutter, { defaultFillColor: defaultFill });
  assert.equal(state.success, true);
  for (const pathItem of pathItems) {
    assert.equal(pathItem.filled, true);
    assert.equal(pathItem.fillColor, defaultFill);
  }
  assert.equal(helpers.restoreTemporaryCutterFill(state), true);
  for (const pathItem of pathItems) {
    assert.equal(pathItem.filled, false);
    assert.equal(pathItem.fillColor.typename, "NoColor");
  }
});

test("each rebuilt stroke starts in its own source parent and is placed beside that source", () => {
  const helpers = loadHelpers();
  const cubic = [{ p0: [0, 0], p1: [1, 0], p2: [2, 0], p3: [3, 0] }];

  for (const parentName of ["sublayer-a", "sublayer-b"]) {
    const created = [];
    const sourceParent = {
      name: parentName,
      pathItems: {
        add() {
          const points = [];
          const item = {
            createdIn: parentName,
            pathPoints: {
              add() {
                const point = {};
                points.push(point);
                return point;
              }
            },
            move(relativeObject, placement) {
              this.moveTarget = relativeObject;
              this.movePlacement = placement;
            }
          };
          created.push(item);
          return item;
        }
      }
    };
    const source = {
      parent: sourceParent,
      layer: {
        pathItems: {
          add() {
            throw new Error("source-parent creation unexpectedly fell back to the layer");
          }
        }
      }
    };

    const rebuilt = helpers.createPathFromCubics(source, cubic);
    assert.equal(created.length, 1);
    assert.equal(rebuilt.createdIn, parentName);
    assert.equal(rebuilt.moveTarget, source);
    assert.equal(rebuilt.movePlacement, "PLACEBEFORE");
  }
});
