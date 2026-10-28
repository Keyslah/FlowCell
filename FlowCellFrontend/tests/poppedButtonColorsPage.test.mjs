import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(join(import.meta.dirname, "../src/pages/theme/PoppedButtonColorsPage.tsx"), "utf8");
const parsed = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const selected = parsed.statements.filter((node) =>
  ts.isFunctionDeclaration(node) && ["poppedButtonCoreIdentity", "poppedButtonCorePlan"].includes(node.name?.text) ||
  ts.isVariableStatement(node) && node.declarationList.declarations.some(({ name }) => name.getText(parsed) === "paletteOperations")
).map((node) => node.getText(parsed)).join("\n");
const compiled = ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exported = {};
new Function("exports", compiled)(exported);

test("the Core Popped Button host isolates scan identity per selected program without an installed owner", () => {
  const blender = exported.poppedButtonCoreIdentity("Blender");
  const krita = exported.poppedButtonCoreIdentity("Krita");
  assert.notEqual(JSON.stringify([blender.ownerButtonId, blender.pageId]), JSON.stringify([krita.ownerButtonId, krita.pageId]));
  assert.equal(krita.programName, "Krita");
  assert.equal(krita.ownerButtonId, exported.poppedButtonCoreIdentity(" KRITA ").ownerButtonId);
  assert.equal(krita.fileName, "");
  assert.throws(() => exported.poppedButtonCoreIdentity("  "), /Select a program/);
});

test("the Core Popped Button host accepts exactly its fixed palette, image chooser and sampler plans", () => {
  for (const operation of ["scan", "apply", "refill", "toggle-text", "settings", "edit", "participation"]) {
    const plan = exported.poppedButtonCorePlan(`button-theme.${operation}`, { capability: "host.execute", options: { operation: "escape" } });
    assert.equal(plan.capability, "button-theme.palette");
    assert.deepEqual(plan.options, { operation });
  }
  assert.equal(exported.poppedButtonCorePlan("theme.image.select", {}).capability, "file.select");
  assert.equal(exported.poppedButtonCorePlan("theme.image.sample", { imagePath: "C:\\image.png" }).capability, "image.sample-palette");
  for (const action of ["theme.apply", "picture.apply", "environment.apply", "theme.package.save", "__proto__", "constructor"]) {
    assert.throws(() => exported.poppedButtonCorePlan(action, {}), /does not allow/);
  }
  for (const payload of [null, [], "bad"]) assert.throws(() => exported.poppedButtonCorePlan("button-theme.settings", payload), /must be an object/);
});
