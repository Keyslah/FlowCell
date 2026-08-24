import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const illustratorRoot = path.resolve(packageRoot, "..", "..", "..");
const manifest = JSON.parse(readFileSync(path.join(packageRoot, "flowcell.script.json"), "utf8"));
const programManifest = JSON.parse(readFileSync(path.join(illustratorRoot, "flowcell.program.json"), "utf8"));
const source = readFileSync(path.join(packageRoot, manifest.source), "utf8");

function loadHelpers() {
  const hook = "// __VACUUM_TEST_HOOK__";
  const instrumented = source
    .replace(/^#target\s+illustrator\s*$/m, "")
    .replace(
      hook,
      "globalThis.__vacuumTest = { " +
        "thresholdPoints: VACUUM_THRESHOLD_POINTS, " +
        "normalizeSelectedPageItems: normalizeSelectedPageItems, " +
        "measureVisibleBounds: measureVisibleBounds, " +
        "isItemBelowVacuumThreshold: isItemBelowVacuumThreshold, " +
        "classifyVacuumItems: classifyVacuumItems, " +
        "runVacuum: runVacuum " +
      "}; return;"
    );
  const context = {
    ElementPlacement: { PLACEATEND: "PLACEATEND" }
  };
  vm.createContext(context);
  vm.runInContext(instrumented, context);
  return context.__vacuumTest;
}

function makeLayerCollection(parent) {
  const layers = [];
  layers.add = () => {
    const layer = makeLayer("", parent);
    layers.push(layer);
    return layer;
  };
  return layers;
}

function makeLayer(name, parent) {
  const layer = {
    typename: "Layer",
    name,
    parent,
    visible: true,
    locked: false
  };
  layer.layers = makeLayerCollection(layer);
  return layer;
}

function makeDocument() {
  const documentRef = { typename: "Document", activeLayer: null };
  documentRef.layers = makeLayerCollection(documentRef);
  const artworkLayer = documentRef.layers.add();
  artworkLayer.name = "Artwork";
  documentRef.activeLayer = artworkLayer;
  return { documentRef, artworkLayer };
}

function makeItem(parent, bounds, overrides = {}) {
  const item = {
    typename: "PathItem",
    parent,
    visibleBounds: bounds,
    editable: true,
    locked: false,
    hidden: false,
    move(target, placement) {
      this.parent = target;
      this.movePlacement = placement;
    }
  };
  return Object.assign(item, overrides);
}

test("vacuum package and bundled contribution keep the requested identity", () => {
  assert.equal(manifest.id, "illustrator.vacuum");
  assert.equal(manifest.label, "vacuum");
  assert.equal(manifest.program, "Illustrator");
  assert.equal(manifest.source, "vacuum.jsx");
  assert.equal(manifest.execution, undefined);

  const contribution = programManifest.bundledSources.find(({ id }) => id === manifest.id);
  assert.ok(contribution);
  assert.equal(contribution.version, "1.0.0");
  assert.equal(contribution.panelName, "Utility");
  assert.equal(contribution.sourcePath, "Illustrator Git Scripts/Utility/vacuum/vacuum.jsx");
  assert.equal(contribution.importKind, "script");
  assert.equal(contribution.sourceKind, "script");
  assert.equal(contribution.installIfMissing, true);
  assert.equal(contribution.installOnAdd, true);
});

test("vacuum uses one fixed 0.1 mm cutoff for both axes", () => {
  const helpers = loadHelpers();
  assert.ok(Math.abs(helpers.thresholdPoints - (0.1 * 72 / 25.4)) < 1e-12);
  assert.doesNotMatch(source, /new Window\s*\(|\bprompt\s*\(/);
});

test("an object must be strictly below both visible thresholds", () => {
  const helpers = loadHelpers();
  const layer = makeLayer("Artwork", { typename: "Document" });
  const threshold = helpers.thresholdPoints;
  assert.equal(
    helpers.isItemBelowVacuumThreshold(makeItem(layer, [0, threshold / 2, threshold / 2, 0])),
    true
  );
  assert.equal(
    helpers.isItemBelowVacuumThreshold(makeItem(layer, [0, threshold / 2, threshold, 0])),
    false
  );
  assert.equal(
    helpers.isItemBelowVacuumThreshold(makeItem(layer, [0, threshold, threshold / 2, 0])),
    false
  );
});

test("a thick stroke is not vacuumed when its visible bounds exceed the cutoff", () => {
  const helpers = loadHelpers();
  const layer = makeLayer("Artwork", { typename: "Document" });
  const threshold = helpers.thresholdPoints;
  const thickStroke = makeItem(layer, [0, threshold * 2, threshold * 2, 0], {
    geometricBounds: [0, threshold / 10, threshold / 10, 0],
    stroked: true,
    strokeWidth: threshold * 2
  });

  assert.equal(helpers.isItemBelowVacuumThreshold(thickStroke), false);
});

test("selection normalization rejects text and removes selected descendants", () => {
  const helpers = loadHelpers();
  const layer = makeLayer("Artwork", { typename: "Document" });
  const group = makeItem(layer, [0, 10, 10, 0], { typename: "GroupItem" });
  const child = makeItem(group, [0, 1, 1, 0]);
  const sibling = makeItem(layer, [0, 2, 2, 0]);
  const textRange = { typename: "TextRange", length: 4 };

  const normalized = helpers.normalizeSelectedPageItems([child, textRange, sibling, group]);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0], sibling);
  assert.equal(normalized[1], group);
});

test("direct selections cannot dismantle compound paths or clipping groups", () => {
  const helpers = loadHelpers();
  const layer = makeLayer("Artwork", { typename: "Document" });
  const compound = makeItem(layer, [0, 2, 2, 0], { typename: "CompoundPathItem" });
  const compoundChild = makeItem(compound, [0, 0.1, 0.1, 0]);
  const clippingGroup = makeItem(layer, [0, 3, 3, 0], {
    typename: "GroupItem",
    clipped: true
  });
  const clippedChild = makeItem(clippingGroup, [0, 0.1, 0.1, 0]);

  const normalized = helpers.normalizeSelectedPageItems([compoundChild, clippedChild]);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0], compound);
  assert.equal(normalized[1], clippingGroup);
});

test("a no-op does not create Trash or vacuum bin", () => {
  const helpers = loadHelpers();
  const { documentRef, artworkLayer } = makeDocument();
  const large = makeItem(artworkLayer, [0, 10, 10, 0]);
  const outcome = helpers.runVacuum(documentRef, [large]);

  assert.equal(outcome.moved, 0);
  assert.equal(outcome.tooLarge, 1);
  assert.equal(documentRef.layers.length, 1);
  assert.equal(large.parent, artworkLayer);
});

test("only qualifying selected objects move into a newly created vacuum bin", () => {
  const helpers = loadHelpers();
  const { documentRef, artworkLayer } = makeDocument();
  const originalActiveLayer = documentRef.activeLayer;
  const small = makeItem(artworkLayer, [0, 0.1, 0.1, 0]);
  const large = makeItem(artworkLayer, [0, 4, 3, 0]);
  const outcome = helpers.runVacuum(documentRef, [small, large]);
  const trash = documentRef.layers.find(({ name }) => name === "Trash");
  const vacuumBin = trash.layers.find(({ name }) => name === "vacuum bin");

  assert.equal(outcome.moved, 1);
  assert.equal(outcome.tooLarge, 1);
  assert.equal(small.parent, vacuumBin);
  assert.equal(small.movePlacement, "PLACEATEND");
  assert.equal(large.parent, artworkLayer);
  assert.equal(trash.visible, false);
  assert.equal(trash.locked, true);
  assert.equal(documentRef.activeLayer, originalActiveLayer);
});

test("an existing direct vacuum bin is reused and its state is restored", () => {
  const helpers = loadHelpers();
  const { documentRef, artworkLayer } = makeDocument();
  const trash = documentRef.layers.add();
  trash.name = "Trash";
  trash.visible = false;
  trash.locked = true;
  const vacuumBin = trash.layers.add();
  vacuumBin.name = "vacuum bin";
  vacuumBin.visible = false;
  vacuumBin.locked = true;
  const small = makeItem(artworkLayer, [0, 0.1, 0.1, 0]);

  const outcome = helpers.runVacuum(documentRef, [small]);

  assert.equal(outcome.moved, 1);
  assert.equal(trash.layers.length, 1);
  assert.equal(small.parent, vacuumBin);
  assert.equal(vacuumBin.visible, false);
  assert.equal(vacuumBin.locked, true);
  assert.equal(trash.visible, false);
  assert.equal(trash.locked, true);
});

test("Trash contents are skipped and no artwork deletion API is used", () => {
  const helpers = loadHelpers();
  const { documentRef } = makeDocument();
  const trash = documentRef.layers.add();
  trash.name = "Trash";
  const vacuumBin = trash.layers.add();
  vacuumBin.name = "vacuum bin";
  const existing = makeItem(vacuumBin, [0, 0.1, 0.1, 0]);

  const outcome = helpers.runVacuum(documentRef, [existing]);

  assert.equal(outcome.moved, 0);
  assert.equal(outcome.alreadyInTrash, 1);
  assert.doesNotMatch(source, /\.remove\s*\(/);
});
