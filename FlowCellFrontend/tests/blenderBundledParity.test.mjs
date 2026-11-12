import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";

const root = resolve(import.meta.dirname, "../../Programs/Blender");
const manifest = JSON.parse(readFileSync(join(root, "flowcell.program.json"), "utf8"));

// These controls are present in the original saved Blender panels. Shipping the
// Python files alone did not make them available through a fresh Add Program.
const originalControls = [
  ["blender.save-png", "Files", "save png"],
  ["blender.obj-import", "Files", "obj import"],
  ["blender.save-stl", "Files", "save stl"],
  ["blender.transform", "Utility", "Transform"],
  ["blender.origin-geo", "Utility", "origin geo"],
  ["blender.split", "Utility", "split"],
  ["blender.cursor-center-hole", "Utility", "Center Hole"],
  ["blender.snap-active", "Snap", "Active"],
  ["blender.snap-cursor", "Snap", "Cursor"],
  ["blender.snap-grid", "Snap", "Grid"],
  ["blender.snap-offset", "Snap", "Offset"],
  ["blender.snap-worigin", "Snap", "Worigin"]
];

test("fresh Blender setup declares every previously omitted original control", () => {
  for (const [id, panelName, label] of originalControls) {
    const matches = manifest.bundledSources.filter(source => source.id === id);
    assert.equal(matches.length, 1, `${id} must be installable exactly once`);
    const source = matches[0];
    assert.equal(source.panelName, panelName);
    assert.equal(source.displayLabel, label);
    assert.equal(source.importKind, "script");
    assert.equal(source.installOnAdd, true);
    const path = resolve(root, source.sourcePath);
    const fromRoot = relative(root, path);
    assert.ok(!fromRoot.startsWith("..") && !isAbsolute(fromRoot), id);
    assert.doesNotThrow(() => readFileSync(path.endsWith(".py") ? path : join(path, "flowcell.script.json")));
  }
});

test("each standalone Snap control carries its original command and exact execution source", () => {
  const originalSource = readFileSync(join(root, "Blender Git Scripts/Snap/snap.py"));
  for (const command of ["active", "cursor", "grid", "offset", "worigin"]) {
    const source = manifest.bundledSources.find(source => source.id === `blender.snap-${command}`);
    const packageRoot = join(root, source.sourcePath);
    const script = JSON.parse(readFileSync(join(packageRoot, "flowcell.script.json"), "utf8"));
    assert.equal(script.id, source.id);
    assert.equal(script.program, "Blender");
    assert.equal(script.label, source.displayLabel);
    assert.deepEqual(script.bridgeData, { command });
    assert.equal(script.source, "snap.py");
    assert.deepEqual(readFileSync(join(packageRoot, script.source)), originalSource);
  }
});

test("all six original Blender panels are selected by default", () => {
  const panels = ["Collections", "Files", "Shapes", "Snap", "toolset", "Utility"];
  assert.deepEqual([...manifest.defaultPanels].sort(), [...panels].sort());
  for (const label of panels) {
    const panel = manifest.panels.find(panel => panel.label === label);
    assert.ok(panel, `${label} must appear in Add Program`);
    assert.equal(panel.defaultSelected, true, `${label} must retain the original panel contents`);
  }
});
