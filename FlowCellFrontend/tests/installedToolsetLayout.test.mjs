import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import { cloneButtonDocument, createButtonStateDocument, createStableButtonId } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { DEFAULT_BUTTON_SKIN, DEFAULT_BUTTON_SKIN_ID, getDefaultButtonSize } from "./.compiled-button-system/button/skins/defaultButtonSkin.js";
import { withNeutralSkinMeasurements } from "./neutralSkinDomFixture.mjs";
import { validateButtonStateDocument } from "./.compiled-button-system/button/state/buttonStateValidation.js";
import { buildButtonSettingsFile, buildTransientButtonPopoutSettingsDocument } from "./.compiled-button-system/button/state/buttonSettingsFile.js";
import { createButtonSourceIdentity } from "./.compiled-button-system/button/state/sourceIdentity.js";
import { mergeLegacyInstallsIntoDocument } from "./.compiled-button-system/button/state/ButtonStateRepository.js";
import { applyInstalledSourceUpdate } from "./.compiled-button-system/button/state/sourceUpdateOperations.js";
import { validateInstalledButtonLayout } from "./.compiled-button-system/button/state/installedButtonLayoutValidation.js";
import { resolveInstalledToolFields } from "./.compiled-button-system/button/state/installedToolFields.js";
import { assignInstalledToolSetSkins, parseInstalledToolSetSkin } from "./.compiled-button-system/button/state/installedToolSetSkins.js";
import { resolveButtonActivationResultAssignments } from "./.compiled-button-system/button/runtime/buttonActivationResultSync.js";
import { resolveButtonAppearance } from "./.compiled-button-system/button/runtime/buttonActivationState.js";
import { BUTTON_SKIN_SECTION_ORDER, serializeButtonSkinSections } from "./.compiled-button-system/button/skins/buttonSkinFormat.js";
import { getEmbeddedButtonSkinFamilySources, resolveEmbeddedButtonSkinFamilySource } from "./.compiled-button-system/button/skins/buttonSkinFamily.js";
import { defaultPanelButtonSize, arrangeDefaultPanelButtons } from "./.compiled-button-system/button/state/buttonPanelDefaults.js";
import { CHIPPED_CONCRETE_BUTTON_SKIN_ID, getChippedConcreteButtonSize } from "./.compiled-button-system/button/skins/chippedConcreteButtonSkin.js";
import { panelButtonViewport } from "./.compiled-button-system/pages/main/mainLayout.js";
import { buttonSpacingPixelsFromMillimeters, createStarterButtonLayout, findFirstAvailableButtonPosition, validateExactButtonLayoutGeometry } from "./.compiled-button-system/button/geometry/buttonGeometry.js";

const editorPath = join(import.meta.dirname, "../src/button/editor/ButtonEditorPage.tsx");
const parsed = ts.createSourceFile(editorPath, readFileSync(editorPath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["createButtonRecord", "addPlacement", "createSurface", "addInstalledToolSet"];
const selected = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map((node) => node.getText(parsed)).join("\n");
const compiled = ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const dependencies = { DEFAULT_BUTTON_SKIN, DEFAULT_BUTTON_SKIN_ID, getDefaultButtonSize, CHIPPED_CONCRETE_BUTTON_SKIN_ID, cloneButtonDocument, createStableButtonId, validateInstalledButtonLayout, resolveInstalledToolFields, assignInstalledToolSetSkins,
  buttonSpacingPixelsFromMillimeters, createStarterButtonLayout, findFirstAvailableButtonPosition, validateExactButtonLayoutGeometry, defaultPanelButtonSize };
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

function regularInstall(id, label) {
  return {
    ownerButtonId: id,
    sourceIdentity: createButtonSourceIdentity("Example", "Files", `${id}.js`),
    executionTarget: { kind: "panel-script", programName: "Example", panelName: "Files", fileName: `${id}.js` },
    label, tooltip: "", children: []
  };
}

test("tool sets without authored geometry retain natural skin sizing when starting and growing", () => {
  for (const manual of [false, true]) {
    const install = fixture();
    delete install.layout;
    const document = manual ? createButtonStateDocument()
      : mergeLegacyInstallsIntoDocument(createButtonStateDocument(), [install]);
    if (manual) addInstalledToolSet(document, install, Object.keys(document.surfaces)[0]);
    const unit = Object.values(document.popoutUnits)[0];
    const surface = document.surfaces[unit.surfaceId];
    assert.equal(surface.uniformButtonSize, null, "default grids remain customizable");
    install.children.push({ ...install.children[0], slot: "fourth", label: "Fourth action with a long label" });
    install.layout = { updatePolicy: { appendMissingChildSlots: true } };
    applyInstalledSourceUpdate(document, install);
    assert.deepEqual(unit.childPlacementIds.map((id) => {
      const { x, y, width, height, matchHitboxToSkin } = document.placements[id];
      return { x, y, width, height, matchHitboxToSkin };
    }), install.children.map((_, index) => ({ x: 8 + index * 144, y: 8, width: 144, height: 42, matchHitboxToSkin: true })));
  }
});

test("fallback toolset contents pack unequal measured label widths without changing authored geometry", () => {
  withNeutralSkinMeasurements({ first: 52, second: 104, third: 156 }, () => {
    const document = createButtonStateDocument();
    const install = fixture();
    delete install.layout;
    addInstalledToolSet(document, install, Object.keys(document.surfaces)[0]);
    const unit = Object.values(document.popoutUnits)[0];
    assert.deepEqual(unit.childPlacementIds.map((id) => {
      const { x, y, width, height, matchHitboxToSkin } = document.placements[id];
      return { x, y, width, height, matchHitboxToSkin };
    }), [42, 84, 126].map((width, index) => ({ x: [8, 50, 134][index], y: 8,
      width, height: 42, matchHitboxToSkin: true })));
    const custom = createButtonStateDocument();
    custom.skins[custom.settings.defaultSkinId].structure = '<div data-core>Custom geometry</div>';
    addInstalledToolSet(custom, install, Object.keys(custom.surfaces)[0]);
    const customUnit = Object.values(custom.popoutUnits)[0];
    assert.ok(customUnit.childPlacementIds.every((id) => custom.placements[id].width === 144),
      "neutral measurements must not be applied to custom skins");
  });
});

test("measured toolset additions preserve old default and authored children without overlaps", () => {
  for (const moved of [false, true]) {
    const install = fixture();
    delete install.layout;
    const document = mergeLegacyInstallsIntoDocument(createButtonStateDocument(), [install]);
    const unit = Object.values(document.popoutUnits)[0];
    if (moved) {
      document.placements[unit.childPlacementIds[0]].x = 440;
      document.surfaces[unit.surfaceId].width = 592;
    }
    const existing = unit.childPlacementIds.map((id) => structuredClone(document.placements[id]));
    install.children.push({ ...install.children[0], slot: "fourth", label: "fourth" });
    install.layout = { updatePolicy: { appendMissingChildSlots: true } };
    withNeutralSkinMeasurements({ first: 52, second: 52, third: 52, fourth: 52 }, () => {
      applyInstalledSourceUpdate(document, install);
    });
    assert.deepEqual(unit.childPlacementIds.slice(0, 3).map((id) => document.placements[id]), existing);
    const added = document.placements[unit.childPlacementIds[3]];
    assert.deepEqual([added.x, added.y, added.width, added.height], moved ? [8, 50, 42, 42] : [440, 8, 42, 42]);
    assert.deepEqual(validateButtonStateDocument(document).issues, []);
  }
});

test("the latest rearrangement remains authoritative after adding, updating, saving and reopening", () => {
  const install = fixture();
  delete install.layout;
  const document = mergeLegacyInstallsIntoDocument(createButtonStateDocument(), [install]);
  const unit = Object.values(document.popoutUnits)[0];
  Object.assign(document.placements[unit.childPlacementIds[0]], { x: 24, y: 64 });
  install.children.push({ ...install.children[0], slot: "fourth", label: "fourth" });
  install.layout = { updatePolicy: { appendMissingChildSlots: true } };
  withNeutralSkinMeasurements({ fourth: 52 }, () => applyInstalledSourceUpdate(document, install));
  Object.assign(document.placements[unit.childPlacementIds[3]], { x: 210, y: 70 });
  const layout = (state, targetUnit) => targetUnit.childPlacementIds.map((id) => {
    const placement = state.placements[id];
    return { slot: state.buttons[placement.buttonId].metadata.toolSetSlot,
      x: placement.x, y: placement.y, width: placement.width, height: placement.height };
  });
  const latest = layout(document, unit);
  install.layout = { width: 500, height: 120, placements: Object.fromEntries(install.children.map((child, index) =>
    [child.slot, { x: 8 + index * 144, y: 8, width: index === 3 ? 42 : 144, height: 42 }])) };
  applyInstalledSourceUpdate(document, install);
  assert.deepEqual(layout(document, unit), latest, "source refresh must not restore its original starter positions");
  const context = { programName: "Example", panelName: "Tools" };
  const saved = JSON.parse(JSON.stringify(buildButtonSettingsFile(document, unit.surfaceId, context)));
  const restoredState = JSON.parse(JSON.stringify(document));
  const reopened = buildTransientButtonPopoutSettingsDocument(restoredState, saved, context, "latest-arrangement");
  assert.deepEqual(layout(reopened.document, reopened.document.popoutUnits[reopened.popoutUnitId]), latest);
  assert.deepEqual(validateButtonStateDocument(reopened.document).issues, []);
});

test("Smart Axis packages the exact working Final Skull Live skin release", () => {
  const root = join(import.meta.dirname, "../../Programs/Blender");
  const toolsetRoot = join(root, "Blender Git Scripts/Toolsets/smart-axis");
  const manifest = JSON.parse(readFileSync(join(toolsetRoot, "flowcell.toolset.json"), "utf8"));
  const program = JSON.parse(readFileSync(join(root, "flowcell.program.json"), "utf8"));
  const liveSkinKey = manifest.appearance.children.toggle_live;
  assert.equal(liveSkinKey, "skin-6-Final-Skull");
  const source = readFileSync(join(toolsetRoot, manifest.appearance.skins[liveSkinKey].file), "utf8");
  assert.equal(createHash("sha256").update(source).digest("hex"),
    "e41d5b7375fadccd97b12b0d9575c0f827422911dd34a96b059620f7e0072554",
    "all ten authored sections match the working installed Live skin");
  const skin = parseInstalledToolSetSkin(source, "Live");
  assert.match(skin.release, /--neon-horizontal-width:15px;/);
  assert.match(skin.release, /--neon-vertical-height:15px;/);
  assert.doesNotMatch(skin.release, /--anim-line-arm:|infinite/);
  const livePresentation = manifest.layout.placementPresentation.toggle_live;
  assert.deepEqual(livePresentation.activationCycle.states, [
    { advanceTrigger: "press", id: "button-state-d24db60c-51ad-42a5-a5e4-e0b2e94dcc79", label: "Live",
      resultMatches: [{ live_enabled: false }], visualState: "base" },
    { advanceTrigger: "press", id: "button-state-57110439-70fd-4abd-9dab-58d8e274df28", label: "Live",
      resultMatches: [{ live_enabled: true }], visualState: "held" }
  ]);
  assert.deepEqual(livePresentation.visualStateMap, {
    "button-state-57110439-70fd-4abd-9dab-58d8e274df28": {
      held: "release", hover: "held", pressed: "release", release: "release"
    },
    "button-state-d24db60c-51ad-42a5-a5e4-e0b2e94dcc79": {
      held: "pressed", pressed: "pressed", release: "pressed"
    }
  });
  assert.equal(manifest.version, "1.1.5");
  assert.equal(program.bundledSources.find((entry) => entry.id === manifest.id).version, manifest.version);
});

test("fresh Blender imports preserve the real package's result-mapped display states", () => {
  const cases = [
    ...["X", "Y", "Z"].map((axis) => ({ toolset: "smart-axis", slot: `cycle_${axis.toLowerCase()}`,
      labels: [axis, `${axis}-`, `${axis}+`],
      responses: ["NONE", "MIN", "MAX"].map((mode) => [{ axis, mode }, { modes: { [axis]: mode } }]) })),
    { toolset: "smart-axis", slot: "toggle_live", labels: ["Live", "Live"],
      responses: [[{ live_enabled: false }], [{ live_enabled: true }]] },
    { toolset: "boolean", slot: "solver_cycle", labels: ["Exact", "Float", "Manifold"],
      responses: ["EXACT", "FAST", "MANIFOLD"].map((solver) => [{ solver }]) },
    { toolset: "remesh", slot: "mode_cycle", labels: ["Voxel", "Smooth", "Sharp", "Blocks"],
      responses: ["VOXEL", "SMOOTH", "SHARP", "BLOCKS"].map((mode) => [{ mode }]) }
  ];
  for (const { toolset, slot, labels, responses } of cases) {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname,
      `../../Programs/Blender/Blender Git Scripts/Toolsets/${toolset}/flowcell.toolset.json`), "utf8"));
    const install = { ownerButtonId: `owner-${toolset}`,
      sourceIdentity: createButtonSourceIdentity("Blender", "toolset", `${toolset}.flowcell-source.json`),
      executionTarget: null, label: manifest.label, tooltip: manifest.tooltip, layout: structuredClone(manifest.layout),
      children: manifest.children.map((child) => ({ slot: child.slot, label: child.label, tooltip: child.tooltip,
        executionTarget: { kind: "tool-set-action", programName: "Blender", panelName: "toolset",
          ownerFileName: `${toolset}.flowcell-source.json`, command: child.slot, payload: child.payload } })) };
    for (const manual of [false, true]) {
      const document = manual ? createButtonStateDocument()
        : mergeLegacyInstallsIntoDocument(createButtonStateDocument(), [install]);
      if (manual) addInstalledToolSet(document, install, Object.keys(document.surfaces)[0]);
      const unit = Object.values(document.popoutUnits).find((candidate) => candidate.ownerButtonId === install.ownerButtonId);
      const placement = unit.childPlacementIds.map((id) => document.placements[id])
        .find((candidate) => document.buttons[candidate.buttonId].metadata.toolSetSlot === slot);
      assert.deepEqual(placement.activationCycle?.states.map((state) => state.label), labels,
        `${toolset}/${slot} must ship the complete cycle for a fresh ${manual ? "manual" : "Program"} import`);
      for (const [index, alternatives] of responses.entries()) {
        for (const response of alternatives) {
          assert.deepEqual(resolveButtonActivationResultAssignments(document, unit.childPlacementIds, response),
            [{ activationKey: placement.id, stateCount: labels.length, index }]);
          const appearance = resolveButtonAppearance({ activationBehavior: null,
            buttonLabel: document.buttons[placement.buttonId].label, activeStateIndex: index,
            activationCycle: placement.activationCycle, visualStateMap: placement.visualStateMap,
            appearance: { hovered: false, pressed: false, held: false, play: false, release: false,
              selected: false, disabled: false, error: false } });
          assert.equal(appearance.label, labels[index]);
        }
      }
    }
  }
});

test("fresh panel grids use visible family widths and the same 8 CSS px Main gap", () => {
  const installs = ["cura", "orca", "Save Blender", "slicer", "Update Git Script", "Files", "Project", "Save As", "Open"]
    .map((label, index) => regularInstall(`file-${index}`, label));
  const document = mergeLegacyInstallsIntoDocument(createButtonStateDocument(), installs);
  const surface = Object.values(document.surfaces).find((candidate) => candidate.kind === "panel");
  const placements = surface.placementIds.map((id) => document.placements[id]);
  const maximumWidth = panelButtonViewport().maxButtonWidth;
  let previous = null;
  for (const placement of placements) {
    const button = document.buttons[placement.buttonId];
    const natural = getChippedConcreteButtonSize(button.label);
    assert.equal(placement.width, natural.width * 44 / natural.height);
    assert.equal(placement.height, 44);
    assert.ok(placement.x + placement.width <= 8 + maximumWidth);
    if (previous) {
      if (placement.y === previous.y) assert.equal(placement.x, previous.x + previous.width + 8);
      else {
        assert.equal(placement.x, 8);
        assert.equal(placement.y, previous.y + 44 + 8);
      }
    }
    previous = placement;
  }
  assert.equal(placements[0].x, 8);
  assert.equal(placements[0].y, 8);
  assert.ok(placements.at(-1).y > 8, "the test exercises wrapping");
});

test("explicit grid defaults retain neutral and custom placement sizes, height and presentation", () => {
  const document = mergeLegacyInstallsIntoDocument(createButtonStateDocument(), [
    regularInstall("cura", "cura"), regularInstall("custom", "Custom")
  ]);
  const surface = Object.values(document.surfaces).find((candidate) => candidate.kind === "panel");
  const [neutral, custom] = surface.placementIds.map((id) => document.placements[id]);
  neutral.skinOverrideId = null; // An existing occurrence can still explicitly inherit its neutral record.
  assert.equal(document.buttons[neutral.buttonId].defaultSkinId, DEFAULT_BUTTON_SKIN_ID);
  Object.assign(neutral, { x: 700, y: 320, width: 96, height: 37.294964,
    presentationOverride: { label: "orca" } });
  Object.assign(custom, { x: 320, y: 250, width: 123, height: 51, skinOverrideId: DEFAULT_BUTTON_SKIN_ID });
  const skins = structuredClone(document.skins);
  arrangeDefaultPanelButtons(document, surface.id);
  assert.equal(neutral.width, 96, "neutral occurrences retain their saved width instead of receiving a Concrete family width");
  assert.equal(neutral.height, 37.294964);
  assert.deepEqual(neutral.presentationOverride, { label: "orca" });
  assert.equal(custom.width, 123);
  assert.equal(custom.height, 51);
  assert.equal(custom.x, neutral.x + neutral.width + 8);
  assert.deepEqual(document.skins, skins, "grid defaults never rewrite the authored skin");
  assert.deepEqual(defaultPanelButtonSize(document, document.buttons.custom, custom), { width: 123, height: 51 });
});

test("fresh imports leave an existing panel's custom arrangement unchanged", () => {
  const first = regularInstall("existing", "Existing");
  const document = mergeLegacyInstallsIntoDocument(createButtonStateDocument(), [first]);
  const surface = Object.values(document.surfaces).find((candidate) => candidate.kind === "panel");
  const placement = document.placements[surface.placementIds[0]];
  Object.assign(placement, { x: 300, y: 250, width: 170, height: 60 });
  const before = structuredClone(placement);
  const next = mergeLegacyInstallsIntoDocument(document, [regularInstall("new", "New")]);
  assert.deepEqual(next.placements[placement.id], before);
});

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
    assert.equal(owner.width, 160, "assigned package artwork retains the owner placement dimensions");
    assert.equal(owner.height, manual ? 48 : 44);
    assert.equal(owner.skinOverrideId, first.skinOverrideId);
    assert.notEqual(first.skinOverrideId, second.skinOverrideId);
    assert.equal(third.skinOverrideId, null);
    assert.equal(document.settings.defaultSkinId, createButtonStateDocument().settings.defaultSkinId);
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
