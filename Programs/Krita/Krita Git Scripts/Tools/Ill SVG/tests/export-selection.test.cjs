/* Mocked-DOM export regressions; run with node --test. No applications, COM,
 * filesystem exports, source artwork or preferences are accessed or modified.
 * Loads the exact ES3 serializer used by run.ps1. Does not certify live Adobe DOM.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '..', 'export-selection.jsx'), 'utf8');
const context = { module: { exports: {} } };
vm.runInNewContext(code, context, { filename: 'export-selection.jsx' });
const exporter = context.module.exports;

function document(names = ['Top', 'Bottom']) {
    const doc = { typename: 'Document', name: 'Drawing.v2.ai', scaleFactor: 1, selection: [] };
    doc.layers = names.map(name => ({ typename: 'Layer', name, parent: doc, layers: [] }));
    doc.artboards = [{ artboardRect: [0, 1000, 1000, 0] }];
    doc.artboards.getActiveArtboardIndex = () => 0;
    return doc;
}
function shape(parent, anchors, fields = {}) {
    return { typename: 'PathItem', name: 'Path', parent, closed: true, evenodd: false,
        pathPoints: anchors.map(anchor => ({ anchor: [...anchor], leftDirection: [...anchor], rightDirection: [...anchor] })), ...fields };
}
function rect(parent, x, y, width, height, fields) {
    return shape(parent, [[x, y], [x + width, y], [x + width, y + height], [x, y + height]], fields);
}
function freezeTree(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    Object.values(value).forEach(child => freezeTree(child, seen));
    Object.freeze(value);
}
function result(doc) {
    return JSON.parse(exporter.stringify(exporter.buildBatch(doc)));
}
function pathData(svg) {
    return [...svg.matchAll(/<path[^>]* d="([^"]+)"/g)].map(match => match[1]);
}

test('top-to-bottom layer order and one physical-point viewport preserve cross-layer offsets', () => {
    const doc = document();
    const top = rect(doc.layers[0], 10, 0, 20, 20);
    const bottom = rect(doc.layers[1], 100, 40, 40, 10);
    doc.selection = [bottom, top]; // Selection order must not become stacking order.
    freezeTree(doc);
    const batch = result(doc);
    assert.deepEqual(batch.layers.map(layer => layer.name), ['Top', 'Bottom']);
    assert.deepEqual(batch.viewportPoints, [130, 50]);
    assert.equal(batch.name, 'Drawing.v2');
    assert.equal(batch.centerOnCanvas, true);
    for (const layer of batch.layers) assert.match(layer.svg, /width="130pt" height="50pt" viewBox="0 0 130 50"/);
    assert.match(batch.layers[0].svg, /d="M0 50 L20 50 L20 30 L0 30 L0 50 Z"/);
    assert.match(batch.layers[1].svg, /d="M90 10 L130 10 L130 0 L90 0 L90 10 Z"/);
    assert.deepEqual(top.pathPoints[0].anchor, [10, 0]);
    assert.equal(doc.selection[0], bottom);
});

test('Bezier directions and exact curve extrema are retained without fitting or flattening', () => {
    const doc = document(['Curve']);
    const curve = shape(doc.layers[0], [[0, 0], [100, 0]], { closed: false });
    curve.pathPoints[0].rightDirection = [0, 100];
    curve.pathPoints[1].leftDirection = [100, 100];
    doc.selection = [curve];
    freezeTree(doc);
    const batch = result(doc);
    assert.deepEqual(batch.viewportPoints, [100, 75]);
    assert.deepEqual(pathData(batch.layers[0].svg), ['M0 75 C0 -25 100 -25 100 75']);
    assert.equal(batch.layers[0].nativeElementUpperBound, 4);
});

test('compound nonzero holes retain opposite winding in one SVG path', () => {
    const doc = document(['Compound']);
    const compound = { typename: 'CompoundPathItem', name: 'Ring', parent: doc.layers[0], pathItems: [] };
    compound.pathItems = [rect(compound, 0, 0, 100, 100),
        shape(compound, [[25, 25], [25, 75], [75, 75], [75, 25]])];
    doc.selection = [compound];
    freezeTree(doc);
    const batch = result(doc);
    assert.equal(pathData(batch.layers[0].svg).length, 1);
    assert.match(batch.layers[0].svg, /fill-rule="nonzero"/);
    assert.match(batch.layers[0].svg, /M0 100 L100 100 L100 0 L0 0 L0 100 Z M25 75 L25 25 L75 25 L75 75 L25 75 Z/);
    assert.equal(batch.pathCount, 2);
});

test('evenodd compound holes and XML/JSON names survive serialization', () => {
    const doc = document(['A <& "quoted" 🎨']);
    doc.name = 'Lines\nand "quotes".ai';
    const compound = { typename: 'CompoundPathItem', name: 'Ring', parent: doc.layers[0], pathItems: [] };
    compound.pathItems = [rect(compound, 0, 0, 100, 100, { evenodd: true }), rect(compound, 25, 25, 50, 50, { evenodd: true })];
    doc.selection = [compound];
    const batch = result(doc);
    assert.equal(batch.name, 'Lines\nand "quotes"');
    assert.equal(batch.layers[0].name, doc.layers[0].name);
    assert.match(batch.layers[0].svg, /fill-rule="evenodd"/);
    assert.match(batch.layers[0].svg, /A &lt;&amp; &quot;quoted&quot; 🎨/);
});

test('nearest nested owning layer and selected groups are deduplicated without touching source DOM', () => {
    const doc = document(['Upper', 'Lower']);
    const nested = { typename: 'Layer', name: 'Upper child', parent: doc.layers[0], layers: [] };
    doc.layers[0].layers = [nested];
    const group = { typename: 'GroupItem', name: 'Selected group', parent: nested, clipped: false, pageItems: [] };
    const child = rect(group, 10, 10, 10, 10);
    const subgroup = { typename: 'GroupItem', parent: group, clipped: false, pageItems: [] };
    const grandchild = rect(subgroup, 30, 10, 10, 10);
    subgroup.pageItems = [grandchild];
    group.pageItems = [child, subgroup, grandchild]; // A descendant-spanning DOM collection.
    doc.selection = [rect(doc.layers[1], 50, 10, 10, 10), child, group, grandchild];
    freezeTree(doc);
    const batch = result(doc);
    assert.deepEqual(batch.layers.map(layer => layer.name), ['Upper child', 'Lower']);
    assert.equal(batch.pathCount, 3);
    assert.equal(pathData(batch.layers[0].svg).length, 2);
    assert.equal(group.pageItems[0], child);
    assert.equal(doc.selection.length, 4);
});

test('artboard-declared downward Y coordinates do not receive an extra reflection', () => {
    const doc = document(['Downward']);
    doc.artboards[0].artboardRect = [0, 0, 1000, 1000];
    doc.selection = [rect(doc.layers[0], 10, 20, 30, 40)];
    assert.deepEqual(pathData(result(doc).layers[0].svg), ['M0 0 L30 0 L30 40 L0 40 L0 0 Z']);
});

for (const typename of ['RasterItem', 'PlacedItem', 'TextFrame', 'SymbolItem', 'MeshItem']) {
    test('reject unsupported selected ' + typename + ' without mutation', () => {
        const doc = document();
        doc.selection = [{ typename, parent: doc.layers[0] }];
        freezeTree(doc);
        assert.throws(() => exporter.buildBatch(doc), /Unsupported selected item type/);
    });
}

test('reject clipped group and clipping ancestor even when only a child is selected', () => {
    for (const selectGroup of [true, false]) {
        const doc = document();
        const group = { typename: 'GroupItem', parent: doc.layers[0], clipped: true, pageItems: [] };
        const child = rect(group, 0, 0, 10, 10);
        group.pageItems = [child];
        doc.selection = [selectGroup ? group : child];
        freezeTree(doc);
        assert.throws(() => exporter.buildBatch(doc), /Clipped groups and clipping paths/);
    }
});

test('reject nonstandard scaleFactor, empty selection, malformed coordinates and inconsistent compound rules', () => {
    const doc = document();
    assert.throws(() => exporter.buildBatch(doc), /Select vector artwork/);
    doc.selection = [rect(doc.layers[0], 0, 0, 10, 10)];
    doc.scaleFactor = 10;
    assert.throws(() => exporter.buildBatch(doc), /scaleFactor 10/);
    doc.scaleFactor = 1;
    doc.selection[0].pathPoints[0].anchor[0] = Infinity;
    assert.throws(() => exporter.buildBatch(doc), /invalid or out-of-range/);
    const compound = { typename: 'CompoundPathItem', parent: doc.layers[0], pathItems: [] };
    compound.pathItems = [rect(compound, 0, 0, 20, 20), rect(compound, 5, 5, 10, 10, { evenodd: true })];
    doc.selection = [compound];
    assert.throws(() => exporter.buildBatch(doc), /inconsistent fill rules/);
});

test('Windows entry is preview-only, existing-COM only, and publishes the declared manifest contract', () => {
    const ps = fs.readFileSync(path.join(__dirname, '..', 'run.ps1'), 'utf8');
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'flowcell.script.json'), 'utf8'));
    assert.equal(manifest.id, 'plain-krita.tools.ill-svg');
    assert.equal(manifest.source, 'run.ps1');
    assert.match(ps, /GetActiveObject\('Illustrator\.Application'\)/);
    assert.doesNotMatch(ps, /New-Object\s+-ComObject|Start-Process|Stop-Process|Remove-Item/);
    assert.match(ps, /ProcessName -cne 'KritaStencilPreview'/);
    assert.match(ps, /nativeBatchImport -ne \$true/);
    assert.match(ps, /\[IO\.FileMode\]::CreateNew/);
    assert.match(ps, /type = 'krita-stencil-layers'/);
});

test('native batch layer cap permits 128 owning layers and rejects 129 before file export', () => {
    const doc = document(Array.from({ length: 128 }, (_, i) => 'Layer ' + i));
    doc.selection = doc.layers.map((layer, i) => rect(layer, i * 2, 0, 1, 1));
    assert.equal(result(doc).layers.length, 128);
    const extra = { typename: 'Layer', name: 'Extra', parent: doc, layers: [] };
    doc.layers.push(extra);
    doc.selection.push(rect(extra, 256, 0, 1, 1));
    freezeTree(doc);
    assert.throws(() => exporter.buildBatch(doc), /exceeds 128 owning layers/);
});
