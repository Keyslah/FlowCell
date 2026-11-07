import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { cloneButtonDocument, createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { mergeLegacyInstallsIntoDocument } from "./.compiled-button-system/button/state/ButtonStateRepository.js";
import { createButtonSourceIdentity } from "./.compiled-button-system/button/state/sourceIdentity.js";
import { ensureRegularPopout, ensureFanSetup, hideThemeContributionOwner } from "./.compiled-button-system/button/state/buttonDocumentOperations.js";
import { captureThemeFile, applyThemeFile, listThemePlacements } from "./.compiled-button-system/theme/themeModel.js";
import { capturePortableTheme, planPortableThemeImport, applyPortableTheme, isPortableTheme, portableThemeForScope } from "./.compiled-button-system/theme/portableTheme.js";
import { applyCommonProgramThemeEdit, applyLegacyProgramAppearance } from "./.compiled-button-system/theme/commonProgramTheme.js";
import { captureProgramPopoutThemeSettings, resolveProgramPopoutThemeOverride } from "./.compiled-button-system/theme/programPopoutTheme.js";
import { resolveButtonPlacementPresentation, editButtonPlacementPresentation } from "./.compiled-button-system/button/state/buttonPresentation.js";
import { buildButtonAnimationScopedDocument, buildButtonTextScopedDocument } from "./.compiled-button-system/button/editor/buttonEditorSaveScopes.js";
import { buildButtonSettingsFile } from "./.compiled-button-system/button/state/buttonSettingsFile.js";
import { getFlowCellThemePageDefinition } from "./.compiled-button-system/theme/themePageRegistry.js";
import { assignInstalledToolSetSkins } from "./.compiled-button-system/button/state/installedToolSetSkins.js";
import { serializeButtonSkinSections } from "./.compiled-button-system/button/skins/buttonSkinFormat.js";
import { getEmbeddedButtonSkinFamilySources, resolveEmbeddedButtonSkinFamilySource } from "./.compiled-button-system/button/skins/buttonSkinFamily.js";
import { reconcileProgramPanelOwners } from "./.compiled-button-system/button/state/panelOwnerButtonOperations.js";

const target = { kind: "program", programName: "Blender", panelName: null };
function fixture(owner = "donor", version = "1.0.0") {
  const sourceIdentity = createButtonSourceIdentity("Blender", "Tools", `${owner}.flowcell-source.json`);
  const install = { ownerButtonId: owner, sourceIdentity, label: "Tool", tooltip: "Tool", executionTarget: null,
    children: ["left", "right"].map((slot) => ({ slot, label: "Same label",
      executionTarget: { kind: "tool-set-action", programName: "Blender", panelName: "Tools", ownerFileName: sourceIdentity.displayFileName, command: slot } })) };
  const document = mergeLegacyInstallsIntoDocument(createButtonStateDocument(), [install]);
  const descriptor = { ownerButtonId: owner, programName: "Blender", programId: "blender", panelName: "Tools",
    sourceId: "blender.example", sourceVersion: version, sourceName: "example.py", importKind: "tool-set",
    slots: ["left", "right"], catalogPath: "C:\\Author\\catalog", sourcePath: "C:\\Author\\installed" };
  return { document, descriptor };
}

test("portable themes preserve validated package variants and remap label baselines without local metadata", () => {
  const donor = fixture();
  const placement = Object.values(donor.document.placements).find((entry) =>
    donor.document.buttons[entry.buttonId].metadata.toolSetSlot === "left");
  const base = donor.document.skins[donor.document.buttons[placement.buttonId].defaultSkinId];
  const source = (marker) => serializeButtonSkinSections({ ...base, base: `${base.base}\n--portable-family:${marker};` });
  const appearance = { skins: { family: { source: source("base"), variants: { 4: source("four"), 6: source("six") } } } };
  assignInstalledToolSetSkins(donor.document, appearance, [{ placement, skinKey: "family" }]);
  const assigned = donor.document.skins[placement.skinOverrideId];
  assigned.metadata.localSecret = "do not export";
  donor.document.buttons[placement.buttonId].label = "Four";
  const archive = capturePortableTheme({ document: donor.document, descriptors: [donor.descriptor], target, name: "Family" });
  assert.equal(isPortableTheme(archive), true);
  const saved = archive.theme.buttons.find((entry) => entry.label === "Four");
  assert.match(saved.skin.base, /--portable-family:four/);
  assert.deepEqual(saved.skin.metadata, { buttonSkinEmbeddedVariants: appearance.skins.family.variants });
  assert.equal(JSON.stringify(archive).includes("localSecret"), false);
  assert.equal(JSON.stringify(archive).includes("buttonSkinFamilyBaseline"), false);
  const recipient = fixture("recipient");
  const plan = planPortableThemeImport(recipient.document, archive, target, [recipient.descriptor]);
  assert.deepEqual(plan.issues, []);
  const applied = applyPortableTheme(recipient.document, archive, plan);
  const child = Object.values(applied.buttons).find((entry) => entry.metadata.toolSetSlot === "left");
  const restored = Object.values(applied.placements).find((entry) => entry.buttonId === child.id);
  const skin = applied.skins[restored.skinOverrideId ?? child.defaultSkinId];
  assert.deepEqual(getEmbeddedButtonSkinFamilySources(skin), appearance.skins.family.variants);
  assert.equal(resolveEmbeddedButtonSkinFamilySource(skin, restored.id, "Four"), null);
  assert.equal(resolveEmbeddedButtonSkinFamilySource(skin, restored.id, "Six!!!").count, 6);
  assert.match(skin.base, /--portable-family:four/);
  const invalid = structuredClone(archive);
  invalid.theme.buttons.find((entry) => entry.label === "Four").skin.metadata.buttonSkinEmbeddedVariants[4] =
    source("four").replace("<div", '<script>alert("x")</script><div');
  assert.equal(isPortableTheme(invalid), false);
});

test("portable capture and apply uses owner and child slots, preserving authored presentation and runtime", () => {
  const donor = fixture();
  const child = Object.values(donor.document.buttons).find((button) => button.metadata.toolSetSlot === "left");
  const placement = Object.values(donor.document.placements).find((entry) => entry.buttonId === child.id);
  placement.x = 17; placement.y = 29; placement.width = 111; placement.height = 47;
  placement.activationCycle = { states: [
    { id: "a", label: "Cycle A", advanceTrigger: "press", visualState: "base" },
    { id: "b", label: "Cycle B", advanceTrigger: "press", visualState: "held" }
  ] };
  placement.visualStateMap = { a: { pressed: "held" } };
  child.label = "Edited label";
  child.activationAnimation = { presetId: "plus-rise", desktopBounds: { left: 0, top: 0, width: 40, height: 40 } };
  const skin = donor.document.skins[child.defaultSkinId];
  const originalStructure = skin.structure;
  const theme = capturePortableTheme({ ...donor, descriptors: [donor.descriptor], target, name: "Example" });
  assert.equal(isPortableTheme(theme), true);
  const serialized = JSON.stringify(theme);
  assert.equal(serialized.includes("C:\\\\Author"), false);
  assert.equal(serialized.includes('"donor"'), false);
  assert.equal(serialized.includes("button-child-donor"), false);
  const recipient = fixture("recipient");
  const owner = recipient.document.buttons.recipient;
  owner.metadata.recipientLocal = "preserve";
  recipient.document.settings.gridSize = 23;
  const before = structuredClone(recipient.document);
  const plan = planPortableThemeImport(recipient.document, theme, target, [recipient.descriptor]);
  assert.deepEqual(plan.issues, []);
  assert.deepEqual(plan.missingDependencies, []);
  const after = applyPortableTheme(recipient.document, theme, plan);
  const resolved = Object.values(after.buttons).find((button) => button.metadata.toolSetSlot === "left");
  const moved = Object.values(after.placements).find((entry) => entry.buttonId === resolved.id);
  assert.deepEqual([moved.x, moved.y, moved.width, moved.height], [17, 29, 111, 47]);
  assert.equal(resolved.label, "Edited label");
  assert.equal(resolved.executionTarget.ownerFileName, "recipient.flowcell-source.json");
  assert.equal(after.buttons.recipient.metadata.recipientLocal, "preserve");
  assert.equal(after.settings.gridSize, 23);
  assert.equal(after.skins[moved.skinOverrideId ?? resolved.defaultSkinId].structure, originalStructure);
  assert.deepEqual(moved.activationCycle, placement.activationCycle);
  assert.deepEqual(recipient.document, before);
  const again = applyPortableTheme(after, theme, planPortableThemeImport(after, theme, target, [recipient.descriptor]));
  assert.deepEqual(again, after);
});

test("duplicate installed identities and incompatible versions fail closed without arbitrary selection", () => {
  const donor = fixture();
  const theme = capturePortableTheme({ document: donor.document, descriptors: [donor.descriptor], target, name: "Example" });
  const recipient = fixture("recipient", "2.0.0");
  const incompatible = planPortableThemeImport(recipient.document, theme, target, [recipient.descriptor]);
  assert.match(incompatible.issues.join(" "), /requires version 1.0.0/);
  assert.throws(() => applyPortableTheme(recipient.document, theme, incompatible), /requires version/);
  recipient.descriptor.sourceVersion = "1.0.0";
  const second = fixture("other");
  recipient.document.buttons.other = second.document.buttons.other;
  const ambiguous = planPortableThemeImport(recipient.document, theme, target, [recipient.descriptor, second.descriptor]);
  assert.match(ambiguous.issues.join(" "), /matches 2 installed owners/);
});

test("older portable themes ignore the embedded Theme owner's presentation and apply remaining Buttons", () => {
  const donor = fixture();
  const sourceIdentity = createButtonSourceIdentity("Blender", "Tools", "theme.flowcell-source.json");
  donor.document = mergeLegacyInstallsIntoDocument(donor.document, [{
    ownerButtonId: "theme", sourceIdentity, label: "Theme", tooltip: "Theme", children: [],
    executionTarget: { kind: "panel-script", programName: "Blender", panelName: "Tools", fileName: sourceIdentity.displayFileName }
  }]);
  const descriptors = [donor.descriptor, { ...donor.descriptor, ownerButtonId: "theme",
    sourceId: "blender.theme", sourceName: "theme", importKind: "script", slots: [] }];
  donor.document.buttons.donor.label = "Saved tool label";
  const archive = capturePortableTheme({ document: donor.document, descriptors, target, name: "Before contribution migration" });
  const recipient = structuredClone(donor.document);
  hideThemeContributionOwner(recipient, "theme");
  recipient.buttons.donor.label = "Changed local label";
  const preservedOwner = structuredClone(recipient.buttons.theme);
  const plan = planPortableThemeImport(recipient, archive, target, descriptors);
  assert.deepEqual(plan.issues, []);
  assert.deepEqual(plan.missingDependencies, []);
  const result = applyPortableTheme(recipient, archive, plan);
  assert.equal(result.buttons.donor.label, "Saved tool label");
  assert.deepEqual(result.buttons.theme, preservedOwner);
  assert.equal(Object.values(result.placements).some((placement) => placement.buttonId === "theme"), false);
});

test("target mismatch never switches the selected target or modifies another program", () => {
  const donor = fixture();
  const theme = capturePortableTheme({ document: donor.document, descriptors: [donor.descriptor], target, name: "Example" });
  const plan = planPortableThemeImport(donor.document, theme, { kind: "program", programName: "Krita", panelName: null }, [donor.descriptor]);
  assert.match(plan.issues[0], /different target/);
  assert.throws(() => applyPortableTheme(donor.document, theme, plan), /different target/);
});

test("Main excludes program-owned controls; Pop-outs scope includes fans", () => {
  const { document } = fixture();
  const programPlacement = Object.values(document.placements)[0];
  const main = document.surfaces[programPlacement.surfaceId];
  main.kind = "main";
  assert.equal(listThemePlacements(document, { kind: "flowcell", page: "main" }).some((entry) => entry.id === programPlacement.id), false);
  const fan = ensureFanSetup({ document, programName: "Blender", panelName: "Tools", buttons: [document.buttons.donor] });
  assert.equal(listThemePlacements(document, { ...target, area: "popouts" }).some((entry) => entry.surfaceId === fan.fanSurfaceId), true);
});

test("legacy appearance files preserve positions they do not contain", () => {
  const { document } = fixture();
  const theme = captureThemeFile({ document, target });
  const placement = Object.values(document.placements)[0];
  placement.x = 333;
  const before = structuredClone(document);
  const after = applyThemeFile(document, theme).document;
  assert.equal(after.placements[placement.id].x, 333);
  assert.deepEqual(after.buttons, before.buttons);
});

test("toolset children cannot map merely by label or child count", () => {
  const donor = fixture();
  const theme = capturePortableTheme({ document: donor.document, descriptors: [donor.descriptor], target, name: "Example" });
  const recipient = fixture("recipient");
  const children = Object.values(recipient.document.buttons).filter((button) => button.toolSetParentId);
  children[0].metadata.toolSetSlot = "unrelated";
  const plan = planPortableThemeImport(recipient.document, theme, target, [recipient.descriptor]);
  assert.match(plan.issues.join(" "), /0 compatible identities/);
  assert.throws(() => applyPortableTheme(recipient.document, theme, plan));
});

test("malformed portable presentation cannot smuggle execution or desktop layouts", () => {
  const donor = fixture();
  const theme = capturePortableTheme({ document: donor.document, descriptors: [donor.descriptor], target, name: "Example" });
  const injected = structuredClone(theme);
  Object.values(injected.presentation)[0].placement.executionTarget = { kind: "core-action", actionId: "run" };
  assert.equal(isPortableTheme(injected), false);
  const window = structuredClone(theme);
  window.surfaces.find((surface) => surface.popout).popout.desktopBounds = { left: 50, top: 50, width: 500, height: 500 };
  assert.equal(isPortableTheme(window), false);
  const invalidCycle = structuredClone(theme);
  Object.values(invalidCycle.presentation)[0].placement.activationCycle = { states: [] };
  assert.equal(isPortableTheme(invalidCycle), false);
});

test("common program edits and Blender contribution share canonical popped settings", () => {
  const { document } = fixture();
  const ids = Object.values(document.placements).filter((placement) => document.surfaces[placement.surfaceId].kind === "tool-set-popout").map((placement) => placement.id);
  document.programPopoutThemes = { blender: captureProgramPopoutThemeSettings(document, "Blender") };
  applyCommonProgramThemeEdit(document, target, ids, { kind: "colors", role: "surface", colors: Object.fromEntries(ids.map((id) => [id, "#123456"])) });
  assert.equal(resolveProgramPopoutThemeOverride(document, ids[0]).colors.surface, "#123456");
  assert.equal(document.programPopoutColorOverrides[ids[0]].surface, "#123456");
  applyCommonProgramThemeEdit(document, target, ids, { kind: "effect", field: "hoverGlowAmount", amount: 37 });
  assert.equal(document.programPopoutThemes.blender.hoverGlowAmount, 37);
  assert.equal(resolveProgramPopoutThemeOverride(document, ids[0]).hoverGlowAmount, 37);
  const global = structuredClone(document.programPopoutThemes);
  applyCommonProgramThemeEdit(document, { ...target, panelName: "Tools" }, [ids[0]], { kind: "effect", field: "hoverGlowAmount", amount: 61 });
  assert.equal(resolveProgramPopoutThemeOverride(document, ids[0]).hoverGlowAmount, 61);
  assert.equal(resolveProgramPopoutThemeOverride(document, ids[1]).hoverGlowAmount, 37);
  assert.deepEqual(document.programPopoutThemes, global);
});

test("selected-panel portable import preserves program-wide appearance settings", () => {
  const donor = fixture();
  const settings = captureProgramPopoutThemeSettings(donor.document, "Blender");
  settings.hoverGlowAmount = 81;
  donor.document.programPopoutThemes = { blender: settings };
  const theme = capturePortableTheme({ document: donor.document, descriptors: [donor.descriptor], target, name: "Example" });
  const recipient = fixture("recipient");
  const oldSettings = captureProgramPopoutThemeSettings(recipient.document, "Blender");
  oldSettings.hoverGlowAmount = 12;
  recipient.document.programPopoutThemes = { blender: oldSettings };
  const panel = { ...target, panelName: "Tools" };
  const plan = planPortableThemeImport(recipient.document, theme, panel, [recipient.descriptor]);
  const result = applyPortableTheme(recipient.document, theme, plan);
  assert.deepEqual(result.programPopoutThemes, recipient.document.programPopoutThemes);
  const child = Object.values(result.placements).find((placement) => result.surfaces[placement.surfaceId].kind === "tool-set-popout");
  assert.equal(resolveProgramPopoutThemeOverride(result, child.id).hoverGlowAmount, 81);
});

function singleFixture(owner) {
  const identity = createButtonSourceIdentity("Blender", "Tools", `${owner}.flowcell-source.json`);
  const document = mergeLegacyInstallsIntoDocument(createButtonStateDocument(), [{
    ownerButtonId: owner, sourceIdentity: identity, label: "Local label", tooltip: "Local tooltip", children: [],
    executionTarget: { kind: "panel-script", programName: "Blender", panelName: "Tools", fileName: identity.displayFileName }
  }]);
  const unit = ensureRegularPopout(document, [document.buttons[owner]]);
  const descriptor = { ...fixture().descriptor, ownerButtonId: owner, sourceId: "blender.single", importKind: "script", slots: [] };
  return { document, descriptor, unit };
}

test("portable dependency installation forwards exact catalog identity and leaves archived source identity local", async () => {
  const source = readFileSync(new URL("../src/theme/portableThemeService.ts", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("portableThemeService.ts", source, ts.ScriptTarget.Latest, true);
  const names = ["installationCandidates", "prepareThemeSurfaces", "preparePortableThemeImport"];
  const functions = parsed.statements.filter((statement) => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text))
    .map((statement) => statement.getText(parsed).replace(/^export /, "")).join("\n");
  const compiled = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const donor = singleFixture("donor");
  const theme = capturePortableTheme({ document: donor.document, target, name: "Shared", descriptors: [donor.descriptor] });
  for (const catalogPath of ["Blender Git Scripts/example.py", null]) {
    const original = createButtonStateDocument();
    const available = { ...donor.descriptor, ownerButtonId: "", catalogPath };
    const identity = createButtonSourceIdentity("Blender", "Tools", "recipient.flowcell-source.json");
    let request = null;
    const installed = { ownerButtonId: "recipient", sourceIdentity: identity, label: "Tool", tooltip: "", children: [],
      executionTarget: { kind: "panel-script", programName: "Blender", panelName: "Tools", fileName: identity.displayFileName } };
    const runtime = {
      cloneButtonDocument, mergeLegacyInstallsIntoDocument, planPortableThemeImport, portableThemeForScope, applyPortableTheme,
      ensureRegularPopout, ensureFanSetup, reconcileProgramPanelOwners,
      createStableButtonId: () => "recipient",
      getThemeToolDescriptors: async () => [available, ...(request ? [{ ...available, ownerButtonId: "recipient",
        sourceId: catalogPath ? request.bundledSourceId : available.sourceId,
        sourceVersion: catalogPath ? request.bundledSourceVersion : available.sourceVersion }] : [])],
      loadButtonStateDocument: async () => original,
      installButtonSource: async (value) => { request = value; return installed; },
      uninstallButtonSource: async () => { throw new Error("Successful preparation must retain its new owner."); }
    };
    const prepare = new Function("runtime", `const { ${Object.keys(runtime).join(", ")} } = runtime;\n${compiled}\nreturn preparePortableThemeImport;`)(runtime);
    const prepared = await prepare({ theme, target, document: original });
    assert.ok(prepared.document.buttons.recipient);
    assert.equal(request.bundledSourceId, catalogPath ? available.sourceId : undefined);
    assert.equal(request.bundledSourceVersion, catalogPath ? available.sourceVersion : undefined);
    assert.equal(request.panelName, "Tools");
  }
});

test("scoped labels and animations remain occurrence-owned and editable in the Button Editor", () => {
  const donor = singleFixture("donor");
  donor.document.buttons.donor.label = "Imported label";
  donor.document.buttons.donor.activationAnimation = { presetId: "plus-rise", desktopBounds: { left: 0, top: 0, width: 40, height: 40 } };
  const selectedTarget = { ...target, area: "popouts" };
  const theme = capturePortableTheme({ document: donor.document, descriptors: [donor.descriptor], target: selectedTarget, name: "Scoped" });
  const recipient = singleFixture("recipient");
  const plan = planPortableThemeImport(recipient.document, theme, selectedTarget, [recipient.descriptor]);
  const imported = applyPortableTheme(recipient.document, theme, plan);
  const placementId = recipient.unit.memberPlacementIds[0];
  const placement = imported.placements[placementId];
  assert.equal(imported.buttons.recipient.label, "Local label");
  assert.equal(imported.buttons.recipient.activationAnimation, null);
  assert.equal(resolveButtonPlacementPresentation(imported.buttons.recipient, placement).label, "Imported label");
  const draft = structuredClone(imported);
  editButtonPlacementPresentation(draft, placementId, { label: "Edited private label", activationAnimation: null });
  const text = buildButtonTextScopedDocument(imported, draft, { entries: [{ buttonId: "recipient", placementId }] });
  assert.equal(text.placements[placementId].presentationOverride.label, "Edited private label");
  assert.equal(text.buttons.recipient.label, "Local label");
  const animation = buildButtonAnimationScopedDocument(text, draft, "recipient", placementId);
  assert.equal(animation.placements[placementId].presentationOverride.activationAnimation, null);
  assert.equal(animation.buttons.recipient.activationAnimation, null);
  const settings = buildButtonSettingsFile(animation, recipient.unit.surfaceId, { programName: "Blender", panelName: "Tools" });
  assert.equal(settings.entries[0].placement.presentationOverride.label, "Edited private label");
  const savedAgain = capturePortableTheme({ document: animation, descriptors: [recipient.descriptor], target: selectedTarget, name: "Edited" });
  assert.equal(Object.values(savedAgain.presentation)[0].button.label, "Edited private label");
});

test("legacy popped appearances preserve missing fields and apply global settings when old placements are absent", () => {
  const { document, unit } = singleFixture("recipient");
  const id = unit.memberPlacementIds[0];
  document.programPopoutColorOverrides = { [id]: { text: "#AABBCC" } };
  const settings = { ...captureProgramPopoutThemeSettings(document, "Blender"), colors: ["#555555"] };
  const missing = { placementId: "donor-placement", buttonId: "donor", color: "#445566" };
  const result = applyLegacyProgramAppearance(document, target, settings, {
    version: 1, placements: [missing, { placementId: id, buttonId: "recipient", color: "#123456" }]
  });
  assert.equal(result.skippedMissingPlacementCount, 1);
  assert.deepEqual(result.document.programPopoutThemes.blender.colors, ["#555555"]);
  assert.deepEqual(result.document.programPopoutColorOverrides, { [id]: { surface: "#123456", text: "#AABBCC" } });
  assert.throws(() => applyLegacyProgramAppearance(document, target, undefined, {
    version: 1, placements: [{ ...missing, color: "malformed" }]
  }), /color is invalid/);
  assert.throws(() => applyLegacyProgramAppearance(document, target, undefined, {
    version: 1, placements: [{ ...missing, lockedAppearance: {} }]
  }), /lock is invalid/);
  assert.throws(() => applyLegacyProgramAppearance(document, target, undefined, {
    version: 1, placements: [missing, missing]
  }), /identity is invalid or duplicated/);
  assert.throws(() => applyLegacyProgramAppearance(document, target, undefined, {
    version: 1, placements: [{ placementId: id, buttonId: "different", color: "#123456" }]
  }), /cannot be resolved exactly/);
});

test("Main host-owned controls round-trip by registered control keys without a source package", () => {
  const donor = singleFixture("host");
  const button = donor.document.buttons.host;
  button.sourceIdentity = null;
  button.executionTarget = null;
  button.metadata = { mainPageControl: true, mainPageControlKey: "buttons-add-script" };
  const placement = Object.values(donor.document.placements).find((entry) => donor.document.surfaces[entry.surfaceId].kind === "panel");
  const oldSurface = donor.document.surfaces[placement.surfaceId];
  const id = getFlowCellThemePageDefinition("main").buttonSurfaceIds[0];
  donor.document.surfaces[id] = { ...oldSurface, id, kind: "main" };
  delete donor.document.surfaces[oldSurface.id];
  placement.surfaceId = id;
  // Remove the irrelevant single-script popout from this standalone Main fixture.
  delete donor.document.placements[donor.unit.memberPlacementIds[0]];
  delete donor.document.surfaces[donor.unit.surfaceId];
  delete donor.document.popoutUnits[donor.unit.id];
  const main = { kind: "flowcell", page: "main" };
  const theme = capturePortableTheme({ document: donor.document, target: main, name: "Main", descriptors: [] });
  assert.equal(theme.dependencies.length, 0);
  assert.deepEqual(theme.references["button-0"], { kind: "core", actionId: "flowcell.main-control", controlKey: "buttons-add-script" });
  const plan = planPortableThemeImport(donor.document, theme, main, []);
  assert.deepEqual(plan.issues, []);
  assert.equal(Object.keys(plan.placementIds).length, 1);
  assert.doesNotThrow(() => applyPortableTheme(donor.document, theme, plan));
});
