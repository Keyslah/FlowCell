import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createButtonStateDocument
} from "./.compiled-button-system/button/state/buttonDefaults.js";
import {
  ensureFlowCellMainPageButtons,
  resolveFlowCellMainPagePresentation,
  setFlowCellMainPageProgramButtonLabel
} from "./.compiled-button-system/button/state/mainPageButtonOperations.js";
import { buildProgramRailButtons } from "./.compiled-button-system/pages/main/mainLayout.js";
import { buttonRectsOverlap } from "./.compiled-button-system/button/geometry/buttonGeometry.js";
import {
  validateButtonStateDocument
} from "./.compiled-button-system/button/state/buttonStateValidation.js";

const frontendRoot = join(import.meta.dirname, "..");

function programRailWithSavedPlacements(document, names, selectedName) {
  const discovered = buildProgramRailButtons(names, selectedName);
  const saved = discovered.flatMap((button) => {
    if (!button.folderName) return [];
    const presentation = resolveFlowCellMainPagePresentation(document, button);
    return presentation ? [{ programName: button.folderName, rect: presentation.placement }] : [];
  });
  const footer = discovered.find(button => button.actionId === "add-program-folder");
  const savedFooter = footer ? resolveFlowCellMainPagePresentation(document, footer)?.placement : undefined;
  return buildProgramRailButtons(names, selectedName, saved, savedFooter);
}

test("saved full placement objects change only program navigation geometry", () => {
  const [original] = buildProgramRailButtons(["Blender"], "Blender");
  const rect = {
    id: "placement-id", buttonId: "canonical-button-id", surfaceId: "canonical-surface",
    skinOverrideId: "custom-skin", actionId: "wrong-action", folderName: "wrong-folder",
    isSelected: false, x: 26, y: 200, width: 144, height: 45
  };
  const [rendered] = buildProgramRailButtons(["Blender"], "Blender", [{ programName: "Blender", rect }]);
  assert.deepEqual(rendered, { ...original, x: 26, y: 200, width: 144, height: 45 });
  assert.equal(rendered.id, "program-button-1");
  assert.equal(rendered.actionId, "select-program-folder");
  assert.equal(rendered.folderName, "Blender");
  assert.equal(rendered.isSelected, true);
  assert.equal(Object.hasOwn(rendered, "skinOverrideId"), false);
});

for (const customFooter of [undefined, { x: 21.039583, y: 630, width: 132, height: 54 }]) {
  test(`new Program fallback reserves the ${customFooter ? "custom" : "default"} Add Program footer`, () => {
    const saved = [{ programName: "Blender", rect: { x: 21.039583, y: 125.758993, width: 132, height: 500 } }];
    const buttons = buildProgramRailButtons(["Blender", "Windows"], "Windows", saved, customFooter);
    const windows = buttons.find(button => button.folderName === "Windows");
    const footer = customFooter ?? buttons.find(button => button.actionId === "add-program-folder");
    assert.equal(buttonRectsOverlap(windows, saved[0].rect), false);
    assert.equal(buttonRectsOverlap(windows, footer), false, "new Windows Button overlaps Add Program");
    assert.deepEqual(buttons.at(-1), buildProgramRailButtons(["Blender", "Windows"], "Windows").at(-1));
  });
}

test("new Windows fallback cannot overlap saved Blender when discovery order changes", () => {
  const document = createButtonStateDocument();
  ensureFlowCellMainPageButtons(document, ["Illustrator", "Blender"]);
  const before = structuredClone(document);
  const buttons = programRailWithSavedPlacements(document, ["Illustrator", "Windows", "Blender"], "Windows");
  const windows = buttons.find((button) => button.folderName === "Windows");
  assert.ok(windows);
  assert.equal(windows.isSelected, true);
  for (const name of ["Blender", "Illustrator"]) {
    const rendered = buttons.find((button) => button.folderName === name);
    const original = resolveFlowCellMainPagePresentation(document, rendered).placement;
    assert.equal(buttonRectsOverlap(windows, rendered), false, `Windows overlaps ${name}`);
    for (const field of ["x", "y", "width", "height"]) assert.equal(rendered[field], original[field]);
  }
  assert.deepEqual(document, before, "read-only navigation must preserve all installed state");
  assert.equal(Object.values(document.buttons).some(button => button.metadata.mainPageProgramName === "Windows"), false);
});

test("multiple new Program fallbacks avoid resized saved Buttons and each other", () => {
  const document = createButtonStateDocument();
  ensureFlowCellMainPageButtons(document, ["Illustrator", "Blender"]);
  const saved = Object.values(document.placements).filter(placement =>
    document.buttons[placement.buttonId]?.metadata.mainPageProgramName
  );
  Object.assign(saved[0], { x: 30, y: 115, width: 140, height: 80 });
  Object.assign(saved[1], { x: 28, y: 205, width: 140, height: 65 });
  const before = structuredClone(document);
  const names = ["Illustrator", "Windows", "Krita", "Blender"];
  const buttons = programRailWithSavedPlacements(document, names, "Windows");
  for (const button of buttons.filter(button => ["Windows", "Krita"].includes(button.folderName))) {
    for (const other of buttons.filter(other => other.folderName && other !== button)) {
      assert.equal(buttonRectsOverlap(button, other), false, `${button.folderName} overlaps ${other.folderName}`);
    }
  }
  assert.deepEqual(document, before);
  assert.deepEqual(programRailWithSavedPlacements(document, names, "Windows"), buttons, "repeat rendering stays stable");
  assert.deepEqual(buttons.at(-1), buildProgramRailButtons(names, "Windows").at(-1), "Add Program stays in place");
});

test("Program Button label editing preserves the real program identity and graph", () => {
  const document = createButtonStateDocument();
  assert.equal(ensureFlowCellMainPageButtons(document, ["Blender", "Illustrator"]), true);

  const programButton = Object.values(document.buttons).find(
    (button) => button.metadata.mainPageProgramName === "Blender"
  );
  assert.ok(programButton);
  const before = structuredClone(document);

  assert.equal(
    setFlowCellMainPageProgramButtonLabel(document, "Blender", "  Blender Tools  "),
    true
  );
  assert.equal(document.buttons[programButton.id].label, "Blender Tools");
  assert.equal(document.buttons[programButton.id].metadata.mainPageProgramName, "Blender");

  const comparison = structuredClone(document);
  comparison.buttons[programButton.id].label = before.buttons[programButton.id].label;
  assert.deepEqual(comparison, before);

  assert.equal(ensureFlowCellMainPageButtons(document, ["Blender", "Illustrator"]), false);
  assert.equal(document.buttons[programButton.id].label, "Blender Tools");
  assert.equal(
    setFlowCellMainPageProgramButtonLabel(document, "Blender", "Blender Tools"),
    false
  );

  const validation = validateButtonStateDocument(document);
  assert.equal(validation.valid, true, validation.issues.join("\n"));
});

test("Main Program rename action saves only the canonical Button label", () => {
  const mainPageSource = readFileSync(
    join(frontendRoot, "src", "pages", "main", "MainPage.tsx"),
    "utf8"
  );

  assert.doesNotMatch(mainPageSource, /\brenameProgramFolder\b/);
  assert.match(
    mainPageSource,
    /await commitButtonDocumentMutation\(\(document\) =>\s*setFlowCellMainPageProgramButtonLabel\(/s
  );
  assert.match(mainPageSource, /Enter the Program Button label\./);
  assert.match(mainPageSource, /label="Rename Program Button"/);
});
