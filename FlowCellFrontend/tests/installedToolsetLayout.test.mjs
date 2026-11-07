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
import { assignInstalledToolSetSkins, parseInstalledToolSetSkin } from "./.compiled-button-system/button/state/installedToolSetSkins.js";
import { BUTTON_SKIN_SECTION_ORDER, serializeButtonSkinSections } from "./.compiled-button-system/button/skins/buttonSkinFormat.js";
import { getEmbeddedButtonSkinFamilySources, resolveEmbeddedButtonSkinFamilySource } from "./.compiled-button-system/button/skins/buttonSkinFamily.js";
import { buttonSpacingPixelsFromMillimeters, createStarterButtonLayout, findFirstAvailableButtonPosition, validateExactButtonLayoutGeometry } from "./.compiled-button-system/button/geometry/buttonGeometry.js";

const editorPath = join(import.meta.dirname, "../src/button/editor/ButtonEditorPage.tsx");
const parsed = ts.createSourceFile(editorPath, readFileSync(editorPath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["createButtonRecord", "addPlacement", "createSurface", "addInstalledToolSet"];
const selected = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map((node) => node.getText(parsed)).join("\n");
const compiled = ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const dependencies = { DEFAULT_BUTTON_SKIN_ID, createStableButtonId, validateInstalledButtonLayout, resolveInstalledToolFields, assignInstalledToolSetSkins,
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

function appearanceFixture() {
  const install = fixture();
  const skin = createButtonStateDocument().skins[DEFAULT_BUTTON_SKIN_ID];
  const source = (marker) => serializeButtonSkinSections({ ...skin, base: `${skin.base}\n--package-marker:${marker};` });
  install.layout.appearance = {
    skins: {
      shared: { source: source("base"), variants: { 4: source("four"), 6: source("six") } },
      plain: { source: source("plain") }
    },
    owner: "shared",
    children: { first: "shared", second: "plain" }
  };
  return install;
}

test("package appearance assigns native skins in manual and fresh Program paths without changing geometry", () => {
  const install = appearanceFixture();
  for (const manual of [false, true]) {
    const document = manual ? createButtonStateDocument() :
      mergeLegacyInstallsIntoDocument(createButtonStateDocument(), [install]);
    if (manual) addInstalledToolSet(document, install, Object.keys(document.surfaces)[0]);
    const unit = assertAuthoredLayout(document, install);
    const owner = Object.values(document.placements).find((placement) => placement.buttonId === install.ownerButtonId);
    const first = document.placements[unit.childPlacementIds[0]];
    const second = document.placements[unit.childPlacementIds[1]];
    const third = document.placements[unit.childPlacementIds[2]];
    assert.equal(owner.skinOverrideId, first.skinOverrideId);
    assert.notEqual(first.skinOverrideId, second.skinOverrideId);
    assert.equal(third.skinOverrideId, null);
    assert.equal(document.settings.defaultSkinId, DEFAULT_BUTTON_SKIN_ID);
    const skin = document.skins[first.skinOverrideId];
    assert.deepEqual(getEmbeddedButtonSkinFamilySources(skin), install.layout.appearance.skins.shared.variants);
    assert.equal(resolveEmbeddedButtonSkinFamilySource(skin, first.id, "first"), null);
    assert.equal(resolveEmbeddedButtonSkinFamilySource(skin, first.id, "four").count, 4);
    assert.equal(resolveEmbeddedButtonSkinFamilySource(skin, first.id, "seven!!").count, 6);
    assert.equal(resolveEmbeddedButtonSkinFamilySource(skin, "new-placement", "five!").count, 6);
  }
});

test("identical base and embedded family share canonical skins across package installs", () => {
  const first = appearanceFixture();
  const second = { ...structuredClone(first), ownerButtonId: "other",
    sourceIdentity: createButtonSourceIdentity("Example", "Tools", "other.flowcell-source.json") };
  const document = mergeLegacyInstallsIntoDocument(createButtonStateDocument(), [first, second]);
  const packageSkins = Object.values(document.skins).filter((skin) => skin.id.startsWith("skin-toolset-package-"));
  assert.equal(packageSkins.length, 2);
  const family = packageSkins.find((skin) => getEmbeddedButtonSkinFamilySources(skin));
  assert.equal(Object.keys(family.metadata.buttonSkinFamilyBaseline).length, 4);
  const changed = appearanceFixture();
  changed.ownerButtonId = "different";
  changed.sourceIdentity = createButtonSourceIdentity("Example", "Tools", "different.flowcell-source.json");
  changed.layout.appearance.skins.shared.variants[4] = changed.layout.appearance.skins.plain.source;
  const next = mergeLegacyInstallsIntoDocument(document, [changed]);
  assert.equal(Object.values(next.skins).filter((skin) => skin.id.startsWith("skin-toolset-package-")).length, 3);
});

test("source updates retain assigned skins and apply package appearance only to added children", () => {
  const install = appearanceFixture();
  const document = mergeLegacyInstallsIntoDocument(createButtonStateDocument(), [install]);
  const unit = Object.values(document.popoutUnits)[0];
  const preserved = structuredClone(document.placements);
  const next = structuredClone(install);
  next.layout.updatePolicy = { appendMissingChildSlots: true };
  next.layout.appearance.skins.shared.source = next.layout.appearance.skins.plain.source;
  next.children.push({ ...next.children[0], slot: "fourth", label: "added" });
  next.layout.placements.fourth = { x: 0, y: 90, width: 50, height: 30 };
  next.layout.appearance.children.fourth = "shared";
  applyInstalledSourceUpdate(document, next);
  for (const [id, placement] of Object.entries(preserved)) assert.deepEqual(document.placements[id], placement);
  const added = document.placements[unit.childPlacementIds.at(-1)];
  assert.match(document.skins[added.skinOverrideId].base, /--package-marker:plain/);
  assert.equal(resolveEmbeddedButtonSkinFamilySource(document.skins[added.skinOverrideId], added.id, "added"), null);
});

test("appearance rejects unknown assignments, malformed family counts and executable skin source", () => {
  for (const change of [
    (appearance) => { appearance.owner = "missing"; },
    (appearance) => { appearance.skins.shared.variants["04"] = appearance.skins.shared.source; },
    (appearance) => { appearance.skins.shared.unexpected = true; }
  ]) {
    const install = appearanceFixture();
    change(install.layout.appearance);
    assert.throws(() => validateInstalledButtonLayout(install.layout), /appearance/);
  }
  const invalid = appearanceFixture();
  invalid.layout.appearance.skins.shared.variants[4] = invalid.layout.appearance.skins.shared.source.replace("<div", '<script>alert("x")</script><div');
  const base = createButtonStateDocument();
  const before = structuredClone(base);
  assert.throws(() => mergeLegacyInstallsIntoDocument(base, [invalid]), /invalid structure/);
  assert.deepEqual(base, before);
  const unknown = appearanceFixture();
  unknown.layout.appearance.children.missing = "shared";
  assert.throws(() => mergeLegacyInstallsIntoDocument(base, [unknown]), /declared child slot/);
});

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

test("all 8 Blender starters install 88 exact assigned skins and preserve them on source updates", () => {
  const installs = shippedLayouts.filter(([program]) => program === "Blender").map(([programName, folder]) => {
    const root = join(import.meta.dirname, "../../Programs", programName, `${programName} Git Scripts`, "Toolsets", folder);
    const manifest = JSON.parse(readFileSync(join(root, "flowcell.toolset.json"), "utf8"));
    assert.ok(manifest.appearance, `${manifest.id} must ship its current appearance`);
    const appearance = {
      ...manifest.appearance,
      skins: Object.fromEntries(Object.entries(manifest.appearance.skins).map(([key, entry]) => [key, {
        source: readFileSync(join(root, entry.file), "utf8"),
        ...(entry.variants ? { variants: Object.fromEntries(Object.entries(entry.variants).map(([count, file]) =>
          [count, readFileSync(join(root, file), "utf8")])) } : {})
      }]))
    };
    const ownerButtonId = `fresh-${manifest.id}`;
    const ownerFileName = `${ownerButtonId}.flowcell-source.json`;
    return { ownerButtonId, sourceIdentity: createButtonSourceIdentity(programName, "toolset", ownerFileName),
      executionTarget: null, label: manifest.label, tooltip: manifest.tooltip ?? "",
      children: manifest.children.map((child) => ({ slot: child.slot, label: child.label, tooltip: child.tooltip,
        executionTarget: { kind: "tool-set-action", programName, panelName: "toolset", ownerFileName, command: child.slot } })),
      layout: { ...structuredClone(manifest.layout), appearance }
    };
  });
  const document = mergeLegacyInstallsIntoDocument(createButtonStateDocument(), installs);
  let assignments = 0;
  for (const install of installs) {
    const unit = assertAuthoredLayout(document, install);
    const ownerPlacement = Object.values(document.placements).find((entry) => entry.buttonId === install.ownerButtonId);
    const targets = [{ placement: ownerPlacement, key: install.layout.appearance.owner },
      ...unit.childPlacementIds.map((id) => {
        const placement = document.placements[id];
        return { placement, key: install.layout.appearance.children[document.buttons[placement.buttonId].metadata.toolSetSlot] };
      })];
    for (const { placement, key } of targets) {
      assert.ok(key, `missing package skin for ${placement.buttonId}`);
      const source = install.layout.appearance.skins[key];
      const skin = document.skins[placement.skinOverrideId];
      const expected = parseInstalledToolSetSkin(source.source, key);
      for (const section of BUTTON_SKIN_SECTION_ORDER) assert.equal(skin[section], expected[section]);
      assert.deepEqual(getEmbeddedButtonSkinFamilySources(skin), source.variants);
      assert.equal(resolveEmbeddedButtonSkinFamilySource(skin, placement.id, document.buttons[placement.buttonId].label), null);
      assignments += 1;
    }
  }
  assert.equal(assignments, 88);
  const placements = structuredClone(document.placements);
  const skins = structuredClone(document.skins);
  for (const install of installs) {
    const update = structuredClone(install);
    update.layout.appearance = { skins: {} };
    applyInstalledSourceUpdate(document, update);
  }
  assert.deepEqual(document.placements, placements);
  assert.deepEqual(document.skins, skins);
});

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
