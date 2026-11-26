import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scripts = [
  ["Layers", path.join(root, "Layers/restore.jsx")],
  ["Layers Builder", path.join(root, "Layers Builder/restore/restore.jsx")]
];

function fixture({ failDuplicate = false, failTrashMoveAfter = null } = {}) {
  const faults = { failDuplicate, failTrashMoveAfter, trashMoves: 0 };
  function maybeFailTrashMove(target) {
    let current = target;
    while (current && current.name !== "Trash") current = current.parent;
    if (!current || faults.failTrashMoveAfter === null) return;
    if (faults.trashMoves++ === faults.failTrashMoveAfter) {
      faults.failTrashMoveAfter = null;
      faults.trashFailureTriggered = true;
      throw new Error("injected trash move failure");
    }
  }
  function detach(node) {
    const collection = node.typename === "Layer" ? node.parent.layers : node.parent.directItems;
    const index = collection.indexOf(node);
    if (index >= 0) collection.splice(index, 1);
  }
  function layers(parent) {
    const result = [];
    result.add = () => {
      const layer = makeLayer("", parent);
      result.unshift(layer);
      return layer;
    };
    return result;
  }
  function makeLayer(name, parent) {
    const layer = {
      typename: "Layer", name, parent, visible: true, locked: false, directItems: [],
      remove() { detach(this); this.parent = null; },
      move(target, placement) {
        maybeFailTrashMove(target);
        detach(this);
        if (placement === "before") {
          this.parent = target.parent;
          this.parent.layers.splice(this.parent.layers.indexOf(target), 0, this);
        } else {
          this.parent = target;
          target.layers.push(this);
        }
      }
    };
    layer.layers = layers(layer);
    Object.defineProperty(layer, "pageItems", { get() {
      return [...layer.directItems, ...layer.layers.flatMap((child) => child.pageItems)];
    } });
    return layer;
  }
  function addLayer(parent, name) {
    const layer = parent.layers.add();
    layer.name = name;
    return layer;
  }
  function addItem(parent, name, state = {}) {
    const item = {
      typename: "PathItem", name, parent, hidden: !!state.hidden, locked: !!state.locked,
      duplicate(target) {
        if (faults.failDuplicate) {
          faults.duplicateFailureTriggered = true;
          throw new Error("injected copy failure");
        }
        return addItem(target, this.name, this);
      },
      move(target) {
        maybeFailTrashMove(target);
        detach(this);
        this.parent = target;
        target.directItems.push(this);
      }
    };
    parent.directItems.push(item);
    return item;
  }
  const doc = { typename: "Document", name: "Disposable test", selection: [] };
  doc.layers = layers(doc);
  const live = addLayer(doc, "Live");
  const snapshots = addLayer(doc, "Snapshots");
  const trash = addLayer(doc, "Trash");
  addLayer(doc, "Archive");
  const current = addLayer(live, "Widget");
  addItem(current, "current artwork");
  const container = addLayer(snapshots, "Widget");
  const version = addLayer(container, "S1 saved");
  doc.activeLayer = current;
  function run(scriptPath) {
    const source = readFileSync(scriptPath, "utf8").replace(/^#(?:target|include)[^\r\n]*\r?\n/gm, "");
    doc.selection = [version];
    const File = function () {};
    File.prototype.open = () => true;
    File.prototype.writeln = File.prototype.close = File.prototype.remove = () => {};
    const context = {
      app: { documents: [doc], activeDocument: doc, redraw() {} },
      FlowCellLayersBuilderSelection: { resolveTargets: () => ({ layers: [version], restore: [] }), restore() {} },
      Folder: { temp: { fsName: "temp" } }, File,
      ElementPlacement: { PLACEBEFORE: "before", PLACEATEND: "end", PLACEATBEGINNING: "beginning" },
      $: { writeln() {} }
    };
    vm.runInNewContext(source, context, { timeout: 2000 });
  }
  return { live, snapshots, trash, current, version, addLayer, addItem, run, faults };
}

for (const [label, script] of scripts) {
  test(`${label}: restores all children and direct artwork from an unwrapped saved version`, () => {
    const f = fixture();
    // Collection insertion is at the beginning, as in Illustrator.
    const second = f.addLayer(f.version, "Artwork B");
    f.addItem(second, "B", { hidden: true, locked: true });
    second.visible = false;
    second.locked = true;
    const first = f.addLayer(f.version, "Artwork A");
    const nested = f.addLayer(first, "Nested");
    f.addItem(nested, "A");
    f.addLayer(f.version, "Empty first");
    f.addItem(f.version, "Direct");
    f.run(script);
    const restored = f.live.layers.find((layer) => layer.name === "Widget (saved)");
    assert.ok(restored, "expected restored Live layer");
    assert.deepEqual(restored.layers.map((layer) => layer.name), ["Empty first", "Artwork A", "Artwork B"]);
    assert.deepEqual(restored.pageItems.map((item) => item.name).sort(), ["A", "B", "Direct"]);
    const restoredB = restored.layers.find((layer) => layer.name === "Artwork B");
    assert.equal(restoredB.visible, false);
    assert.equal(restoredB.locked, true);
    assert.equal(restoredB.directItems[0].hidden, true);
    assert.equal(restoredB.directItems[0].locked, true);
    assert.equal(f.current.parent.parent, f.trash);
    assert.ok(f.trash.pageItems.some((item) => item.name === "current artwork"));
    assert.deepEqual(f.version.layers.map((layer) => layer.name), ["Empty first", "Artwork A", "Artwork B"]);
    assert.deepEqual(f.version.pageItems.map((item) => item.name).sort(), ["A", "B", "Direct"]);
  });

  test(`${label}: a matching child is not unwrapped when the version also has other content`, () => {
    const f = fixture();
    const sibling = f.addLayer(f.version, "Other");
    f.addItem(sibling, "other artwork");
    const matching = f.addLayer(f.version, "Widget");
    f.addItem(matching, "matching artwork");
    f.addItem(f.version, "direct artwork");
    f.run(script);
    const restored = f.live.layers.find((layer) => layer.name === "Widget (saved)");
    assert.ok(restored);
    assert.deepEqual(restored.layers.map((layer) => layer.name), ["Widget", "Other"]);
    assert.deepEqual(restored.pageItems.map((item) => item.name).sort(), ["direct artwork", "matching artwork", "other artwork"]);
  });

  test(`${label}: keeps a single differently named child as a sublayer`, () => {
    const f = fixture();
    const child = f.addLayer(f.version, "Artwork");
    f.addItem(child, "nested artwork");
    f.run(script);
    const restored = f.live.layers.find((layer) => layer.name === "Widget (saved)");
    assert.ok(restored);
    assert.deepEqual(restored.layers.map((layer) => layer.name), ["Artwork"]);
    assert.deepEqual(restored.pageItems.map((item) => item.name), ["nested artwork"]);
  });

  test(`${label}: preserves a sole same-name child and its complete contents`, () => {
    const f = fixture();
    const wrapper = f.addLayer(f.version, "Widget");
    f.addItem(wrapper, "wrapped direct");
    const child = f.addLayer(wrapper, "Nested artwork");
    f.addItem(child, "wrapped nested");
    f.run(script);
    const restored = f.live.layers.find((layer) => layer.name === "Widget (saved)");
    assert.ok(restored);
    assert.deepEqual(restored.layers.map((layer) => layer.name), ["Widget"]);
    assert.deepEqual(restored.layers[0].layers.map((layer) => layer.name), ["Nested artwork"]);
    assert.deepEqual(restored.layers[0].directItems.map((item) => item.name), ["wrapped direct"]);
    assert.deepEqual(restored.pageItems.map((item) => item.name).sort(), ["wrapped direct", "wrapped nested"]);
  });

  test(`${label}: adds the whole snapshot when there is no matching Live layer`, () => {
    const f = fixture();
    f.current.name = "Other";
    const unrelatedDirect = f.addItem(f.live, "unrelated direct artwork");
    const savedChild = f.addLayer(f.version, "Child");
    f.addItem(savedChild, "nested artwork");
    f.addItem(f.version, "direct artwork");
    f.run(script);
    const restored = f.live.layers.find((layer) => layer.name === "Widget (saved)");
    assert.ok(restored);
    assert.deepEqual(restored.layers.map((layer) => layer.name), ["Child"]);
    assert.deepEqual(restored.pageItems.map((item) => item.name).sort(), ["direct artwork", "nested artwork"]);
    assert.equal(f.current.parent, f.live);
    assert.equal(f.current.name, "Other");
    assert.deepEqual(f.current.pageItems.map((item) => item.name), ["current artwork"]);
    assert.equal(unrelatedDirect.parent, f.live);
    assert.equal(unrelatedDirect.name, "unrelated direct artwork");
    assert.equal(f.trash.layers.length, 0);
    assert.deepEqual(f.version.pageItems.map((item) => item.name).sort(), ["direct artwork", "nested artwork"]);
  });

  test(`${label}: restores an empty snapshot by replacing the matching Live layer`, () => {
    const f = fixture();
    f.run(script);
    const restored = f.live.layers.find((layer) => layer.name === "Widget (saved)");
    assert.ok(restored);
    assert.equal(restored.layers.length, 0);
    assert.equal(restored.pageItems.length, 0);
    assert.equal(f.current.parent.parent, f.trash);
    assert.deepEqual(f.current.pageItems.map((item) => item.name), ["current artwork"]);
    assert.equal(f.version.parent.name, "Widget");
    assert.equal(f.version.layers.length, 0);
    assert.equal(f.version.pageItems.length, 0);
  });

  test(`${label}: repeated restores preserve saved sublayer visibility and locks`, () => {
    const f = fixture();
    const child = f.addLayer(f.version, "Visible locked child");
    child.visible = true;
    child.locked = true;
    f.addItem(child, "visible artwork");
    const nested = f.addLayer(child, "Hidden locked nested child");
    nested.visible = false;
    nested.locked = true;
    f.addItem(nested, "hidden artwork");

    for (let attempt = 0; attempt < 2; attempt += 1) {
      f.run(script);
      const restored = f.live.layers.find((layer) => layer.name === "Widget (saved)");
      assert.ok(restored);
      assert.equal(restored.layers[0].visible, true);
      assert.equal(restored.layers[0].locked, true);
      assert.equal(restored.layers[0].layers[0].visible, false);
      assert.equal(restored.layers[0].layers[0].locked, true);
      assert.equal(child.visible, true);
      assert.equal(child.locked, true);
      assert.equal(nested.visible, false);
      assert.equal(nested.locked, true);
    }
  });

  test(`${label}: a copy failure leaves Live and the saved artwork intact`, () => {
    const f = fixture({ failDuplicate: true });
    const child = f.addLayer(f.version, "Artwork");
    f.addItem(child, "saved artwork", { hidden: true, locked: true });
    child.visible = false;
    child.locked = true;
    f.run(script);
    assert.equal(f.faults.duplicateFailureTriggered, true, "the copy fault must be reached");
    assert.equal(f.current.parent, f.live);
    assert.ok(f.current.pageItems.some((item) => item.name === "current artwork"));
    assert.ok(f.version.pageItems.some((item) => item.name === "saved artwork"));
    assert.equal(child.visible, false);
    assert.equal(child.locked, true);
    assert.equal(child.directItems[0].hidden, true);
    assert.equal(child.directItems[0].locked, true);
    assert.equal(f.live.layers.some((layer) => /__incoming$/.test(layer.name)), false);
  });

  test(`${label}: a trash move failure leaves current artwork in Live`, () => {
    const f = fixture({ failTrashMoveAfter: 0 });
    f.addItem(f.current, "second current artwork");
    f.addItem(f.version, "saved artwork");
    f.run(script);
    assert.equal(f.faults.trashFailureTriggered, true, "the trash move fault must be reached");
    assert.equal(f.current.parent, f.live);
    assert.deepEqual(f.current.pageItems.map((item) => item.name).sort(), ["current artwork", "second current artwork"]);
    assert.ok(f.version.pageItems.some((item) => item.name === "saved artwork"));
    assert.equal(f.live.layers.some((layer) => /__incoming$/.test(layer.name)), false);
  });
}

for (const [label, script] of scripts) {
  test(`${label}: a partial trash failure rolls back the original layer and direct Live artwork`, () => {
    const f = fixture({ failTrashMoveAfter: 2 });
    const direct = f.addItem(f.live, "Widget");
    const secondDirect = f.addItem(f.live, "Widget");
    direct.hidden = true;
    direct.locked = true;
    f.addItem(f.version, "saved artwork");
    f.run(script);
    assert.equal(f.faults.trashFailureTriggered, true, "the partial trash move fault must be reached");
    assert.equal(f.current.parent, f.live);
    assert.ok(f.current.pageItems.some((item) => item.name === "current artwork"));
    assert.equal(direct.parent, f.live);
    assert.equal(secondDirect.parent, f.live);
    assert.equal(f.current.name, "Widget");
    assert.equal(direct.hidden, true);
    assert.equal(direct.locked, true);
    assert.ok(f.version.pageItems.some((item) => item.name === "saved artwork"));
    assert.equal(f.live.layers.some((layer) => /__incoming$/.test(layer.name)), false);
  });
}
