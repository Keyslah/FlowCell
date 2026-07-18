import test from "node:test";
import assert from "node:assert/strict";
import { deriveBindsPanelButtonScope } from "./.compiled-button-system/lib/bindsButtonScope.js";

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
  assert.equal(scope.toolbarButtonId, "Blender::Tools::owner-a.flowcell-source.json");
});

test("child selection preserves its owner scope and toolbar owner despite duplicate labels", () => {
  const scope = deriveBindsPanelButtonScope(buttons, "a-child-2");

  assert.deepEqual(
    scope.currentPanelButtons.map((button) => button.id),
    ["Blender::Tools::owner-a.flowcell-source.json", "a-child-1", "a-child-2"]
  );
  assert.equal(scope.toolbarButtonId, "Blender::Tools::owner-a.flowcell-source.json");
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
