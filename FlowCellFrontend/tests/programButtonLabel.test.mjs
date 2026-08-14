import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createButtonStateDocument
} from "./.compiled-button-system/button/state/buttonDefaults.js";
import {
  ensureFlowCellMainPageButtons,
  setFlowCellMainPageProgramButtonLabel
} from "./.compiled-button-system/button/state/mainPageButtonOperations.js";
import {
  validateButtonStateDocument
} from "./.compiled-button-system/button/state/buttonStateValidation.js";

const frontendRoot = join(import.meta.dirname, "..");

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
