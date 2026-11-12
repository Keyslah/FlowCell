import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { ensureFlowCellMainPageButtons } from "./.compiled-button-system/button/state/mainPageButtonOperations.js";
import {
  buildButtonsSurfaceButtons,
  buildProgramRailButtons,
  rails,
  staticButtons
} from "./.compiled-button-system/pages/main/mainLayout.js";

test("fresh Main controls use single-line text policy and retain their authored rectangles", () => {
  const document = createButtonStateDocument();
  assert.equal(ensureFlowCellMainPageButtons(document, ["Windows", "Blender"]), true);
  const managed = Object.values(document.buttons).filter(button => button.metadata.mainPageControl === true);
  assert.ok(managed.length > 0);
  for (const button of managed) {
    const placement = Object.values(document.placements).find(entry => entry.buttonId === button.id);
    assert.ok(placement, button.label);
    assert.equal(button.defaultTextFitMode, "shrink", button.label);
    assert.equal(placement.textFitMode, "shrink", button.label);
    const rect = button.metadata.mainPageDefaultRect;
    for (const field of ["x", "y", "width", "height"]) {
      assert.equal(placement[field], rect[field], `${button.label}: ${field}`);
    }
    assert.equal(placement.matchHitboxToSkin, button.metadata.mainPageSection !== "Header Buttons", button.label);
  }
  assert.equal(ensureFlowCellMainPageButtons(document, ["Windows", "Blender"]), false);
});

test("Main discovery preserves saved custom sizing, skins, labels and stacking settings", () => {
  const document = createButtonStateDocument();
  ensureFlowCellMainPageButtons(document, ["Windows", "Blender"]);
  const button = Object.values(document.buttons).find(entry => entry.metadata.mainPageControlKey === "program-add");
  const placement = Object.values(document.placements).find(entry => entry.buttonId === button.id);
  const originalSkin = document.skins[placement.skinOverrideId];
  document.skins["custom-main-skin"] = { ...structuredClone(originalSkin), id: "custom-main-skin", name: "Custom Main" };
  button.label = "Custom stacked label";
  button.defaultTextFitMode = "stack-whole-words";
  Object.assign(placement, {
    width: 144, height: 54, y: 630,
    skinOverrideId: "custom-main-skin", textFitMode: "stack-whole-words",
    textAlignment: "center", textSizeOverride: 18, textOffsetX: 4, textOffsetY: -2
  });
  const before = structuredClone(document);
  assert.equal(ensureFlowCellMainPageButtons(document, ["Windows", "Blender"]), false);
  assert.deepEqual(document, before);
});

test("Main discovery does not infer that saved stacking settings are factory defaults", () => {
  const document = createButtonStateDocument();
  ensureFlowCellMainPageButtons(document, ["Windows"]);
  for (const button of Object.values(document.buttons)) button.defaultTextFitMode = "shrink-and-stack";
  for (const placement of Object.values(document.placements)) placement.textFitMode = "shrink-and-stack";
  const before = structuredClone(document);
  assert.equal(ensureFlowCellMainPageButtons(document, ["Windows"]), false);
  assert.deepEqual(document, before, "existing saved text policy has no provenance that permits overwriting it");
});

function fallbackHostHarness() {
  const source = readFileSync(new URL("../src/pages/main/MainButtonHost.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === "react") return { useState: initial => [initial, () => {}], useCallback: callback => callback };
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }) };
      if (name === "../../button/ButtonHost") return { ButtonHost: "ButtonHost" };
      if (name === "../../button/skins/chippedConcreteButtonSkin") {
        return { getChippedConcreteButtonSkin: (label, preferredWidth) => ({ id: `bundled:${label}`, preferredWidth }) };
      }
      if (name === "./mainLayout") return { rails };
      throw new Error(`Unexpected dependency ${name}`);
    }
  });
  return control => exports.MainControlHost({ control }).props.children.props;
}

test("fallback Main controls use the same single-line and header sizing policies as saved defaults", () => {
  const render = fallbackHostHarness();
  const controls = [...staticButtons, ...buildButtonsSurfaceButtons([]), ...buildProgramRailButtons(["Windows"], "Windows")];
  for (const control of controls) {
    const before = structuredClone(control);
    const props = render(control);
    const header = control.groupId === "top-left-actions" || control.groupId === "top-right-actions";
    assert.equal(props.button.defaultTextFitMode, "shrink", control.label);
    assert.equal(props.placement.textFitMode, "shrink", control.label);
    assert.equal(props.placement.matchHitboxToSkin, !header, control.label);
    assert.equal(props.button.metadata.mainPageControl, true, control.label);
    assert.equal(props.button.metadata.mainPageSection, header ? "Header Buttons" : undefined, control.label);
    assert.equal(props.skin.preferredWidth, header ? control.width : undefined, control.label);
    assert.equal(props.placement.width, control.width, control.label);
    assert.equal(props.placement.height, control.height, control.label);
    assert.deepEqual(control, before);
  }
});
