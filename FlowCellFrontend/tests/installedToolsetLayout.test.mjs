import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import { createButtonStateDocument, createStableButtonId } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { DEFAULT_BUTTON_SKIN_ID } from "./.compiled-button-system/button/skins/defaultButtonSkin.js";
import { createButtonSourceIdentity } from "./.compiled-button-system/button/state/sourceIdentity.js";
import { mergeLegacyInstallsIntoDocument } from "./.compiled-button-system/button/state/ButtonStateRepository.js";
import { applyInstalledSourceUpdate } from "./.compiled-button-system/button/state/sourceUpdateOperations.js";
import { validateInstalledButtonLayout } from "./.compiled-button-system/button/state/installedButtonLayoutValidation.js";
import { resolveInstalledToolFields } from "./.compiled-button-system/button/state/installedToolFields.js";
import { buttonSpacingPixelsFromMillimeters, createStarterButtonLayout, findFirstAvailableButtonPosition, validateExactButtonLayoutGeometry } from "./.compiled-button-system/button/geometry/buttonGeometry.js";

const editorPath = join(import.meta.dirname, "../src/button/editor/ButtonEditorPage.tsx");
const parsed = ts.createSourceFile(editorPath, readFileSync(editorPath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["createButtonRecord", "addPlacement", "createSurface", "addInstalledToolSet"];
const selected = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map((node) => node.getText(parsed)).join("\n");
const compiled = ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const dependencies = { DEFAULT_BUTTON_SKIN_ID, createStableButtonId, validateInstalledButtonLayout, resolveInstalledToolFields,
  buttonSpacingPixelsFromMillimeters, createStarterButtonLayout, findFirstAvailableButtonPosition, validateExactButtonLayoutGeometry };
const addInstalledToolSet = new Function(...Object.keys(dependencies), `${compiled}\nreturn addInstalledToolSet;`)(...Object.values(dependencies));

function fixture() {
  return { ownerButtonId: "owner", sourceIdentity: createButtonSourceIdentity("Example", "Tools", "owner.flowcell-source.json"),
    executionTarget: null, label: "Exact Tool Set", tooltip: "",
    children: ["first", "second", "third"].map((slot) => ({ slot, label: slot, executionTarget: {
      kind: "tool-set-action", programName: "Example", panelName: "Tools", ownerFileName: "owner.flowcell-source.json", command: slot
    } })),
    layout: { width: 160, height: 90, placements: {
      first: { x: 0, y: 0, width: 50, height: 30, zIndex: 8 },
      second: { x: 50, y: 0, width: 50, height: 30, zIndex: 0 },
      third: { x: 100, y: 50, width: 60, height: 40, zIndex: 0 }
    }, fields: [{ id: "group", kind: "toggle", label: "Group", payloadKey: "group", defaultValue: false,
      x: 2, y: 35, width: 80, height: 15, zIndex: 0 }] }
  };
}

function assertAuthoredLayout(document, install) {
  const unit = Object.values(document.popoutUnits).find((candidate) => candidate.ownerButtonId === install.ownerButtonId);
  const surface = document.surfaces[unit.surfaceId];
  assert.deepEqual([surface.width, surface.height], [install.layout.width, install.layout.height]);
  assert.deepEqual(unit.canonicalBounds, { x: 0, y: 0, width: install.layout.width, height: install.layout.height });
  assert.deepEqual(unit.desktopBoundsEnvelope, unit.canonicalBounds);
  assert.equal(unit.childPlacementIds.length, install.children.length);
  for (const id of unit.childPlacementIds) {
    const placement = document.placements[id];
    const slot = document.buttons[placement.buttonId].metadata.toolSetSlot;
    assert.deepEqual({ x: placement.x, y: placement.y, width: placement.width, height: placement.height, zIndex: placement.zIndex }, install.layout.placements[slot]);
  }
  assert.deepEqual(unit.fields, resolveInstalledToolFields(install.layout.fields, install.children));
  return unit;
}

test("manual import and fresh bootstrap preserve authored dimensions, child stacking and field geometry exactly", () => {
  const install = fixture();
  const base = createButtonStateDocument();
  base.settings.defaultSurfacePadding = 24;
  const manual = structuredClone(base);
  addInstalledToolSet(manual, install, Object.keys(manual.surfaces)[0]);
  assertAuthoredLayout(manual, install);
  assertAuthoredLayout(mergeLegacyInstallsIntoDocument(base, [install]), install);
});

test("manual import retains exact adjacent fractional coordinates while rejecting substantive overlap", () => {
  const install = fixture();
  install.children = install.children.slice(0, 2);
  install.layout.width = 506;
  install.layout.placements = {
    first: { x: 303.5161635724795, y: 0, width: 101.17205452415983, height: 30, zIndex: 0 },
    second: { x: 404.6882180966393, y: 0, width: 101.17205452415983, height: 30, zIndex: 1 }
  };
  const document = createButtonStateDocument();
  addInstalledToolSet(document, install, Object.keys(document.surfaces)[0]);
  assertAuthoredLayout(document, install);
  install.layout.placements.second.x -= 1;
  const invalid = createButtonStateDocument();
  assert.throws(() => addInstalledToolSet(invalid, install, Object.keys(invalid.surfaces)[0]), /overlap/);
});

test("source updates preserve existing placement and field geometry while updating definitions and adding new fields", () => {
  const install = fixture();
  const document = mergeLegacyInstallsIntoDocument(createButtonStateDocument(), [install]);
  const unit = Object.values(document.popoutUnits)[0];
  Object.assign(unit.fields[0], { x: 7, y: 41, width: 103, height: 19, zIndex: 23 });
  const oldPlacements = structuredClone(document.placements);
  const oldSurface = structuredClone(document.surfaces[unit.surfaceId]);
  const next = structuredClone(install);
  next.layout.width = 900;
  next.layout.fields[0] = { ...next.layout.fields[0], label: "Updated Group", defaultValue: true, x: 200, zIndex: 2 };
  next.layout.fields.push({ ...next.layout.fields[0], id: "new", payloadKey: "new", x: 20, y: 60 });
  applyInstalledSourceUpdate(document, next);
  assert.deepEqual(document.placements, oldPlacements);
  assert.deepEqual(document.surfaces[unit.surfaceId], oldSurface);
  assert.deepEqual(unit.fields[0], { ...next.layout.fields[0], x: 7, y: 41, width: 103, height: 19, zIndex: 23 });
  assert.deepEqual(unit.fields[1], next.layout.fields[1]);
});

test("optional child stacking keeps legacy fallback and rejects malformed or non-finite declarations", () => {
  const install = fixture();
  delete install.layout.placements.first.zIndex;
  assert.doesNotThrow(() => validateInstalledButtonLayout(install.layout));
  const document = mergeLegacyInstallsIntoDocument(createButtonStateDocument(), [install]);
  const unit = Object.values(document.popoutUnits)[0];
  assert.equal(document.placements[unit.childPlacementIds[0]].zIndex, 0);
  for (const zIndex of ["top", Infinity, NaN]) {
    install.layout.placements.first.zIndex = zIndex;
    assert.throws(() => validateInstalledButtonLayout(install.layout), /zIndex/);
  }
});

const shippedLayouts = [
  ["Blender", "alignment-tools"], ["Blender", "boolean"], ["Blender", "flatten-revolve"],
  ["Blender", "remesh"], ["Blender", "rotate"], ["Blender", "smart-axis"],
  ["Blender", "tri-poly"], ["Blender", "xyz-dimensions"],
  ["Illustrator", "ill-align"], ["Illustrator", "rotate"]
];

for (const [programName, folder] of shippedLayouts) {
  test(`${programName} ${folder} shipped layout imports exactly through manual and fresh bootstrap paths`, () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../../Programs", programName,
      `${programName} Git Scripts`, "Toolsets", folder, "flowcell.toolset.json"), "utf8"));
    const ownerFileName = `${manifest.id}.flowcell-source.json`;
    const install = { ownerButtonId: `test-${manifest.id}`,
      sourceIdentity: createButtonSourceIdentity(programName, "toolset", ownerFileName),
      executionTarget: null, label: manifest.label, tooltip: manifest.tooltip ?? "",
      children: manifest.children.map((child) => ({ slot: child.slot, label: child.label, tooltip: child.tooltip,
        executionTarget: { kind: "tool-set-action", programName, panelName: "toolset", ownerFileName,
          command: child.slot, ...(child.payload ? { payload: structuredClone(child.payload) } : {}) }
      })), layout: structuredClone(manifest.layout)
    };
    const base = createButtonStateDocument();
    base.settings.defaultSurfacePadding = 24;
    const manual = structuredClone(base);
    addInstalledToolSet(manual, install, Object.keys(manual.surfaces)[0]);
    assertAuthoredLayout(manual, install);
    assertAuthoredLayout(mergeLegacyInstallsIntoDocument(base, [install]), install);
  });
}
