import test from "node:test";
import assert from "node:assert/strict";
import { deriveBindsPanelButtonScope } from "./.compiled-button-system/lib/bindsButtonScope.js";
import { deriveBindsPanelMacroScope } from "./.compiled-button-system/lib/bindsMacroScope.js";

const buttons = [
  {
    id: "Blender::Tools::single.flowcell-source.json",
    label: "Single",
    kind: "script",
    target: "single.py"
  },
  {
    id: "Blender::Tools::owner-a.flowcell-source.json",
    label: "Rotate",
    kind: "tool-set-owner",
    target: "owner-a",
    ownerButtonId: "owner-a"
  },
  {
    id: "a-child-1",
    label: "Rotate / Positive",
    kind: "tool-set-child",
    target: "a-child-1",
    ownerButtonId: "owner-a"
  },
  {
    id: "a-child-2",
    label: "Rotate / Negative",
    kind: "tool-set-child",
    target: "a-child-2",
    ownerButtonId: "owner-a"
  },
  {
    id: "Blender::Tools::owner-b.flowcell-source.json",
    label: "Align",
    kind: "tool-set-owner",
    target: "owner-b",
    ownerButtonId: "owner-b"
  },
  {
    id: "b-child-1",
    label: "Rotate / Negative",
    kind: "tool-set-child",
    target: "b-child-1",
    ownerButtonId: "owner-b"
  }
];

test("toolbar contains only top-level entries and ordinary selection hides every child", () => {
  const scope = deriveBindsPanelButtonScope(
    buttons,
    "Blender::Tools::single.flowcell-source.json"
  );

  assert.deepEqual(
    scope.toolbarButtons.map((button) => button.id),
    [
      "Blender::Tools::single.flowcell-source.json",
      "Blender::Tools::owner-a.flowcell-source.json",
      "Blender::Tools::owner-b.flowcell-source.json"
    ]
  );
  assert.deepEqual(
    scope.currentPanelButtons.map((button) => button.id),
    scope.toolbarButtons.map((button) => button.id)
  );
  assert.equal(scope.toolbarButtonId, "Blender::Tools::single.flowcell-source.json");
});

test("owner selection scopes Current Panel Binds to that owner and only its children", () => {
  const scope = deriveBindsPanelButtonScope(
    buttons,
    "Blender::Tools::owner-a.flowcell-source.json"
  );

  assert.deepEqual(
    scope.currentPanelButtons.map((button) => button.id),
    ["Blender::Tools::owner-a.flowcell-source.json", "a-child-1", "a-child-2"]
  );
  assert.deepEqual(
    scope.toolbarButtons.map((button) => button.id),
    [
      "Blender::Tools::single.flowcell-source.json",
      "Blender::Tools::owner-a.flowcell-source.json",
      "a-child-1",
      "a-child-2",
      "Blender::Tools::owner-b.flowcell-source.json"
    ]
  );
  assert.equal(scope.toolbarButtonId, "Blender::Tools::owner-a.flowcell-source.json");
});

test("child selection preserves its owner scope and names the exact child in the toolbar", () => {
  const scope = deriveBindsPanelButtonScope(buttons, "a-child-2");

  assert.deepEqual(
    scope.currentPanelButtons.map((button) => button.id),
    ["Blender::Tools::owner-a.flowcell-source.json", "a-child-1", "a-child-2"]
  );
  assert.equal(scope.toolbarButtonId, "a-child-2");
  assert.equal(scope.toolbarButtons.some((button) => button.id === "a-child-2"), true);
  assert.equal(scope.currentPanelButtons.some((button) => button.id === "b-child-1"), false);
});

test("selecting another owner replaces the entire visible tool-set group", () => {
  const scope = deriveBindsPanelButtonScope(
    buttons,
    "Blender::Tools::owner-b.flowcell-source.json"
  );

  assert.deepEqual(
    scope.currentPanelButtons.map((button) => button.id),
    ["Blender::Tools::owner-b.flowcell-source.json", "b-child-1"]
  );
  assert.equal(scope.toolbarButtonId, "Blender::Tools::owner-b.flowcell-source.json");
});

const macros = [
  {
    id: "macro_delete_layer",
    label: "Delete layer",
    programName: "Adobe Fresco",
    panelName: "Layers",
    fileName: "macro_delete_layer.ini",
    createdAt: "1",
    updatedAt: "2"
  },
  {
    id: "macro_duplicate_layer",
    label: "Duplicate layer",
    programName: "Adobe Fresco",
    panelName: "Layers",
    fileName: "macro_duplicate_layer.ini",
    createdAt: "1",
    updatedAt: "2"
  },
  {
    id: "macro_blender_collection",
    label: "New collection",
    programName: "Blender",
    panelName: "Collections",
    fileName: "macro_blender_collection.ini",
    createdAt: "1",
    updatedAt: "2"
  }
];

test("macro scope projects only the selected panel and exposes its saved shortcuts", () => {
  const scope = deriveBindsPanelMacroScope(
    macros,
    { macro_delete_layer: "^+2" },
    "adobe fresco",
    "layers",
    "macro_delete_layer"
  );

  assert.deepEqual(
    scope.macroButtons.map((macro) => macro.target),
    ["macro_delete_layer", "macro_duplicate_layer"]
  );
  assert.equal(scope.macroButtons[0].kind, "macro");
  assert.equal(scope.macroButtons[0].shortcut, "^+2");
  assert.equal(scope.selectedMacroId, "macro_delete_layer");
});

test("macro scope falls back inside the selected panel and clears for an empty panel", () => {
  const localScope = deriveBindsPanelMacroScope(
    macros,
    {},
    "Adobe Fresco",
    "Layers",
    "macro_blender_collection"
  );
  assert.equal(localScope.selectedMacroId, "macro_delete_layer");

  const emptyScope = deriveBindsPanelMacroScope(
    macros,
    {},
    "Adobe Fresco",
    "Missing",
    "macro_delete_layer"
  );
  assert.deepEqual(emptyScope.macroButtons, []);
  assert.equal(emptyScope.selectedMacroId, "");
});
