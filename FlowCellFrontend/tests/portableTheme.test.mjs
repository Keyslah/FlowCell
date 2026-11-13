import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { cloneButtonDocument, createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { mergeLegacyInstallsIntoDocument } from "./.compiled-button-system/button/state/ButtonStateRepository.js";
import { createButtonSourceIdentity } from "./.compiled-button-system/button/state/sourceIdentity.js";
import { ensureRegularPopout, ensureFanSetup, hideThemeContributionOwner } from "./.compiled-button-system/button/state/buttonDocumentOperations.js";
import { setButtonPopoutFanMode } from "./.compiled-button-system/button/state/buttonPopoutInteractionOperations.js";
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
import { validateButtonStateDocument } from "./.compiled-button-system/button/state/buttonStateValidation.js";

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

test("portable themes preserve Pop-out Fan styles and accept earlier archives without a style", () => {
  const donor = fixture();
  const donorUnit = Object.values(donor.document.popoutUnits)[0];
  const animation = { durationMs: 180, easing: "ease-out", staggerMs: 30, spinEnabled: true };
  donorUnit.fanAnimation = structuredClone(animation);
  const archive = JSON.parse(JSON.stringify(capturePortableTheme({ document: donor.document,
    descriptors: [donor.descriptor], target, name: "Spinning Fan" })));
  assert.equal(isPortableTheme(archive), true);
  assert.deepEqual(archive.surfaces.find((surface) => surface.popout).popout.fanAnimation, animation);
  const recipient = fixture("recipient");
  const plan = planPortableThemeImport(recipient.document, archive, target, [recipient.descriptor]);
  assert.deepEqual(plan.issues, []);
  const restored = applyPortableTheme(recipient.document, archive, plan);
  assert.deepEqual(Object.values(restored.popoutUnits)[0].fanAnimation, animation);
  const legacy = structuredClone(archive);
  delete legacy.surfaces.find((surface) => surface.popout).popout.fanAnimation;
  assert.equal(isPortableTheme(legacy), true);
  const oldRestored = applyPortableTheme(restored, legacy,
    planPortableThemeImport(restored, legacy, target, [recipient.descriptor]));
  assert.equal(Object.values(oldRestored.popoutUnits)[0].fanAnimation, undefined);
  archive.surfaces.find((surface) => surface.popout).popout.fanAnimation.spinEnabled = "yes";
  assert.equal(isPortableTheme(archive), false);
});

test("portable themes retain exact black locked appearance and every saved interaction state across owner IDs", () => {
  const donor = fixture();
  const child = Object.values(donor.document.buttons).find((button) => button.metadata.toolSetSlot === "left");
  const placement = Object.values(donor.document.placements).find((entry) => entry.buttonId === child.id);
  const skin = donor.document.skins[child.defaultSkinId];
  for (const state of ["base", "hover", "play", "pressed", "held", "release", "disabled", "error"]) skin[state] += `\n--saved-${state}-color:#000000;`;
  const lock = { colors: { surface: "#000000", text: "#000000" }, hoverEnabled: true, activeEnabled: true,
    hoverColor: "#12345680", activeColor: "#65432180", hoverHighlightAmount: 161, activeHighlightAmount: 252,
    hoverGlowAmount: 56.71285044680543, activeGlowAmount: 41.589423660990654,
    idleEnabled: true, idleColor: "#000000", idleHighlightAmount: 38, idleGlowAmount: 31.19206774574299 };
  donor.document.programPopoutThemeLocks = { [placement.id]: lock };
  const archive = JSON.parse(JSON.stringify(capturePortableTheme({ document: donor.document, descriptors: [donor.descriptor], target, name: "Black Live" })));
  const recipient = fixture("recipient");
  const plan = planPortableThemeImport(recipient.document, archive, target, [recipient.descriptor]);
  assert.deepEqual(plan.issues, []);
  const after = applyPortableTheme(recipient.document, archive, plan);
  const restoredId = plan.placementIds[archive.theme.buttons.find((entry) => archive.references[entry.buttonId].slot === "left").placementId];
  assert.deepEqual(after.programPopoutThemeLocks[restoredId], lock);
  const restored = after.placements[restoredId];
  const restoredSkin = after.skins[restored.skinOverrideId ?? after.buttons[restored.buttonId].defaultSkinId];
  for (const state of ["base", "hover", "play", "pressed", "held", "release", "disabled", "error"]) assert.equal(restoredSkin[state], skin[state]);
});

test("saved idle-only Button overrides survive theme capture and apply including explicit false and zero values", () => {
  const donor = fixture();
  const placement = Object.values(donor.document.placements)[0];
  const override = { colors: {}, hoverEnabled: null, activeEnabled: null, hoverColor: null, activeColor: null,
    idleEnabled: false, idleColor: "#000000", idleHighlightAmount: 0, idleGlowAmount: 0 };
  donor.document.themeOverrides = { [placement.id]: override };
  const archive = captureThemeFile({ document: donor.document, target });
  const recipient = cloneButtonDocument(donor.document);
  delete recipient.themeOverrides;
  const restored = applyThemeFile(recipient, JSON.parse(JSON.stringify(archive))).document;
  assert.deepEqual(restored.themeOverrides[placement.id], override);
});

test("packaged legacy black appearance resolves by exact source and child slot on a fresh import", () => {
  const recipient = fixture("fresh-owner");
  const child = Object.values(recipient.document.buttons).find((button) => button.metadata.toolSetSlot === "left");
  const placement = Object.values(recipient.document.placements).find((entry) => entry.buttonId === child.id);
  const lockedAppearance = { colors: { surface: "#000000", text: "#000000" }, hoverEnabled: true, activeEnabled: true,
    hoverColor: "#FFFFFFCC", activeColor: "#FFFFFFCC", idleEnabled: true, idleColor: "#000000", idleHighlightAmount: 38, idleGlowAmount: 31.19206774574299 };
  const appearance = { version: 1, placements: [{ placementId: "old-local-placement", buttonId: "old-local-button", lockedAppearance,
    sourceReference: { programId: "blender", sourceId: recipient.descriptor.sourceId, slot: "left", surfaceKind: recipient.document.surfaces[placement.surfaceId].kind } }] };
  const restored = applyLegacyProgramAppearance(recipient.document, target, undefined, appearance, [recipient.descriptor]);
  assert.equal(restored.skippedMissingPlacementCount, 0);
  assert.deepEqual(restored.document.programPopoutThemeLocks[placement.id], lockedAppearance);
  assert.equal(recipient.document.programPopoutThemeLocks, undefined);
  assert.throws(() => applyLegacyProgramAppearance(recipient.document, target, undefined, appearance,
    [recipient.descriptor, { ...recipient.descriptor, ownerButtonId: "ambiguous-owner" }]), /2 installed owners/);
  const unknown = structuredClone(appearance);
  unknown.placements[0].sourceReference.sourceId = "another-source";
  const missing = applyLegacyProgramAppearance(recipient.document, target, undefined, unknown, [recipient.descriptor]);
  assert.equal(missing.skippedMissingPlacementCount, 1);
  assert.equal(missing.document.programPopoutThemeLocks, undefined);
  const duplicate = structuredClone(appearance);
  duplicate.placements.push({ ...structuredClone(duplicate.placements[0]), placementId: "another-old-placement" });
  assert.throws(() => applyLegacyProgramAppearance(recipient.document, target, undefined, duplicate, [recipient.descriptor]), /duplicated placement/);
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

function additionalPanelFixture(savedRect, initialRect, extraRects, bounds) {
  const donor = singleFixture("saved-owner");
  const donorPlacement = Object.values(donor.document.placements).find((placement) =>
    donor.document.surfaces[placement.surfaceId].kind === "panel");
  Object.assign(donorPlacement, savedRect);
  Object.assign(donor.document.surfaces[donorPlacement.surfaceId], {
    width: savedRect.x + savedRect.width, height: savedRect.y + savedRect.height
  });
  const archive = capturePortableTheme({ document: donor.document, descriptors: [donor.descriptor], target, name: "Saved panel" });
  const recipient = singleFixture("new-owner");
  const extras = extraRects.map((rect, index) => {
    const ownerButtonId = `extra-${index}`;
    const sourceIdentity = createButtonSourceIdentity("Blender", "Tools", `${ownerButtonId}.flowcell-source.json`);
    return { ownerButtonId, sourceIdentity, label: ownerButtonId, tooltip: "Keep this control", children: [],
      executionTarget: { kind: "panel-script", programName: "Blender", panelName: "Tools", fileName: sourceIdentity.displayFileName } };
  });
  recipient.document = mergeLegacyInstallsIntoDocument(recipient.document, extras);
  recipient.document.settings.defaultSurfacePadding = 0;
  recipient.document.settings.buttonSpacingMm = 0;
  const panel = Object.values(recipient.document.surfaces).find((surface) => surface.kind === "panel");
  const mapped = panel.placementIds.map((id) => recipient.document.placements[id]).find((placement) => placement.buttonId === "new-owner");
  Object.assign(mapped, initialRect);
  Object.assign(panel, bounds);
  const extraPlacements = extras.map((extra, index) => {
    const placement = panel.placementIds.map((id) => recipient.document.placements[id]).find((entry) => entry.buttonId === extra.ownerButtonId);
    Object.assign(placement, extraRects[index]);
    return placement;
  });
  assert.deepEqual(validateButtonStateDocument(recipient.document).issues, [], "the initial selection must be valid before applying the saved layout");
  const before = structuredClone(recipient.document);
  const plan = planPortableThemeImport(recipient.document, archive, target, [recipient.descriptor]);
  assert.deepEqual(plan.issues, []);
  const after = applyPortableTheme(recipient.document, archive, plan, { reconcileAdditionalPanelPlacements: true });
  assert.deepEqual(recipient.document, before, "setup preparation must not mutate its input");
  assert.deepEqual(validateButtonStateDocument(after).issues, [], "all selected controls must fit without overlap");
  assert.deepEqual(Object.fromEntries(Object.keys(savedRect).map((key) => [key, after.placements[mapped.id][key]])), savedRect);
  for (const placement of extraPlacements) {
    const restored = after.placements[placement.id];
    assert.deepEqual({ ...restored, x: placement.x, y: placement.y }, placement, "only an extra control's position may change");
    assert.deepEqual(after.buttons[placement.buttonId], before.buttons[placement.buttonId]);
  }
  return { after, before, panel, extraPlacements };
}

test("new Program appearance keeps clear extra controls fixed while relocating multiple collisions", () => {
  const { after, before, extraPlacements } = additionalPanelFixture(
    { x: 0, y: 0, width: 100, height: 40 }, { x: 0, y: 60, width: 100, height: 40 },
    [{ x: 0, y: 0, width: 40, height: 20 }, { x: 45, y: 0, width: 40, height: 20 },
      { x: 0, y: 40, width: 40, height: 20 }], { width: 100, height: 100 }
  );
  for (const placement of extraPlacements.slice(0, 2)) {
    assert.notDeepEqual(after.placements[placement.id], before.placements[placement.id], "each colliding extra must move");
  }
  const clear = extraPlacements[2];
  assert.deepEqual(after.placements[clear.id], before.placements[clear.id], "an already clear extra is a fixed obstacle");
});

test("new Program appearance grows a tight panel to retain every additional control", () => {
  const { after, panel, extraPlacements } = additionalPanelFixture(
    { x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 40, width: 100, height: 40 },
    [{ x: 0, y: 0, width: 100, height: 20 }, { x: 0, y: 20, width: 100, height: 20 }],
    { width: 100, height: 80 }
  );
  assert.equal(after.surfaces[panel.id].width, 100);
  assert.equal(after.surfaces[panel.id].height, 140);
  assert.deepEqual(extraPlacements.map((placement) => after.placements[placement.id].y), [100, 120]);
});

test("portable themes retain installed page source identity when its execution uses a core action", () => {
  const donor = singleFixture("installed-page");
  donor.document.buttons["installed-page"].executionTarget = { kind: "core-action", actionId: "open-installed-page" };
  const archive = capturePortableTheme({ document: donor.document, descriptors: [donor.descriptor], target, name: "Installed page" });
  const reference = archive.references[archive.theme.buttons.find((entry) => entry.surfaceKind === "panel").buttonId];
  assert.deepEqual(reference, { kind: "source", dependencyId: archive.dependencies[0].id, slot: null });
  assert.equal(archive.dependencies[0].sourceId, donor.descriptor.sourceId);
  assert.equal(isPortableTheme(archive), true);
});

test("popouts-only portable Tool Sets validate owner references without exporting the panel appearance", () => {
  const donor = fixture();
  const scope = { ...target, area: "popouts" };
  const archive = capturePortableTheme({ document: donor.document, descriptors: [donor.descriptor], target: scope, name: "Tool popouts" });
  assert.equal(isPortableTheme(archive), true);
  assert.equal(archive.theme.buttons.every((appearance) => appearance.surfaceKind === "tool-set-popout"), true);
  const ownerReference = Object.entries(archive.references).find(([, reference]) => reference.kind === "source" && reference.slot === null);
  assert.ok(ownerReference);
  assert.equal(archive.theme.buttons.some((appearance) => appearance.buttonId === ownerReference[0]), false);
  const recipient = fixture("recipient");
  const plan = planPortableThemeImport(recipient.document, archive, scope, [recipient.descriptor]);
  assert.deepEqual(plan.issues, []);
  const result = applyPortableTheme(recipient.document, archive, plan);
  assert.equal(result.buttons.recipient.label, recipient.document.buttons.recipient.label);
});

test("portable validation preserves exact Pop and Fan owner anchors while rejecting invalid content geometry", () => {
  const donor = singleFixture("donor");
  const secondIdentity = createButtonSourceIdentity("Blender", "Tools", "second.flowcell-source.json");
  donor.document = mergeLegacyInstallsIntoDocument(donor.document, [{ ownerButtonId: "second", sourceIdentity: secondIdentity,
    label: "Second", tooltip: "", children: [], executionTarget: { kind: "panel-script", programName: "Blender",
      panelName: "Tools", fileName: secondIdentity.displayFileName } }]);
  const descriptors = [donor.descriptor, { ...donor.descriptor, ownerButtonId: "second", sourceId: "blender.second" }];
  const buttons = [donor.document.buttons.donor, donor.document.buttons.second];
  const fan = ensureFanSetup({ document: donor.document, programName: "Blender", panelName: "Tools", buttons });
  const regular = ensureRegularPopout(donor.document, buttons);
  const fanSurface = donor.document.surfaces[fan.fanSurfaceId];
  const fanOwner = fanSurface.placementIds.map((id) => donor.document.placements[id])
    .find((placement) => placement.buttonId === fan.panelOwnerButtonId);
  const fanMember = donor.document.placements[fan.fanMemberPlacementIds[0]];
  fanSurface.uniformButtonSize = { width: fanMember.width, height: fanMember.height };
  for (const id of fan.fanMemberPlacementIds) Object.assign(donor.document.placements[id],
    { width: fanMember.width, height: fanMember.height, matchHitboxToSkin: false, allowLabelResize: false });
  Object.assign(fanOwner, { x: -1, y: fanMember.y, width: fanMember.width / 2, height: fanMember.height / 2 });
  const regularSurface = donor.document.surfaces[regular.surfaceId];
  const regularMember = donor.document.placements[regular.memberPlacementIds[0]];
  const regularOwner = { ...structuredClone(fanOwner), id: "regular-owner-anchor", surfaceId: regular.surfaceId,
    y: regularMember.y, width: regularMember.width / 2, height: regularMember.height / 2 };
  donor.document.placements[regularOwner.id] = regularOwner;
  regularSurface.placementIds.push(regularOwner.id);
  regularSurface.uniformButtonSize = { width: regularMember.width, height: regularMember.height };
  for (const id of regular.memberPlacementIds) Object.assign(donor.document.placements[id],
    { width: regularMember.width, height: regularMember.height, matchHitboxToSkin: false, allowLabelResize: false });
  regular.ownerButtonId = fan.panelOwnerButtonId;
  regular.ownerPlacementId = regularOwner.id;
  assert.deepEqual(validateButtonStateDocument(donor.document).issues, []);
  const archive = capturePortableTheme({ document: donor.document, descriptors, target, name: "Exact anchors" });
  assert.equal(isPortableTheme(archive), true);
  assert.deepEqual(planPortableThemeImport(donor.document, archive, target, descriptors).issues, [],
    "a complete single-Button Pop must resolve to itself rather than its larger overlapping member group");
  const savedSurface = archive.surfaces.find((surface) => surface.kind === "fan");
  const savedOwner = archive.theme.buttons.find((appearance) => appearance.surfaceId === savedSurface.id &&
    appearance.buttonId === savedSurface.ownerButtonId);
  assert.equal(archive.presentation[savedOwner.placementId].placement.x, -1);
  const contents = archive.theme.buttons.filter((appearance) => appearance.surfaceId === savedSurface.id &&
    appearance.buttonId !== savedSurface.ownerButtonId);
  const overlapping = structuredClone(archive);
  Object.assign(overlapping.presentation[contents[1].placementId].placement, {
    x: archive.presentation[contents[0].placementId].placement.x,
    y: archive.presentation[contents[0].placementId].placement.y
  });
  assert.equal(isPortableTheme(overlapping), false, "the owner exemption must not permit overlapping content Buttons");
  const outside = structuredClone(archive);
  outside.presentation[contents[0].placementId].placement.x = -1;
  assert.equal(isPortableTheme(outside), false, "content still has to fit its exact surface bounds");
});

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
      ensureRegularPopout, ensureFanSetup, reconcileProgramPanelOwners, setButtonPopoutFanMode,
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

test("Main portable themes leave out panel Buttons that have no source, action or control, and keep them unchanged", () => {
  const donor = singleFixture("host");
  const host = donor.document.buttons.host;
  host.sourceIdentity = null;
  host.executionTarget = null;
  host.metadata = { mainPageControl: true, mainPageControlKey: "buttons-add-script" };
  const hostPlacement = Object.values(donor.document.placements).find((entry) => donor.document.surfaces[entry.surfaceId].kind === "panel");
  const panelSurface = donor.document.surfaces[hostPlacement.surfaceId];
  const mainId = getFlowCellThemePageDefinition("main").buttonSurfaceIds[0];
  donor.document.surfaces[mainId] = { ...panelSurface, id: mainId, kind: "main", placementIds: [hostPlacement.id] };
  hostPlacement.surfaceId = mainId;
  delete donor.document.placements[donor.unit.memberPlacementIds[0]];
  delete donor.document.surfaces[donor.unit.surfaceId];
  delete donor.document.popoutUnits[donor.unit.id];
  // A script-made sample on a program panel: no source, no action, no metadata.
  donor.document.buttons.sample = { ...structuredClone(host), id: "sample", label: "Concrete Moss", metadata: {} };
  donor.document.placements["placement-sample"] = { ...structuredClone(hostPlacement), id: "placement-sample", buttonId: "sample", surfaceId: panelSurface.id, x: 0, y: 0 };
  panelSurface.placementIds = ["placement-sample"];
  const main = { kind: "flowcell", page: "main" };
  assert.equal(listThemePlacements(donor.document, main).some((entry) => entry.id === "placement-sample"), true);
  const before = cloneButtonDocument(donor.document);
  const theme = capturePortableTheme({ document: donor.document, target: main, name: "Main", descriptors: [] });
  assert.equal(theme.theme.buttons.some((appearance) => appearance.label === "Concrete Moss"), false);
  assert.equal(theme.theme.buttons.length, 1);
  assert.equal(Object.keys(theme.references).length, 1);
  const plan = planPortableThemeImport(donor.document, theme, main, []);
  assert.deepEqual(plan.issues, []);
  const applied = applyPortableTheme(donor.document, theme, plan);
  assert.deepEqual(applied.placements["placement-sample"], before.placements["placement-sample"]);
  assert.deepEqual(applied.buttons.sample, before.buttons.sample);
});

test("applying in place keeps local skin family links and reuses existing skins instead of copying them", () => {
  const donor = singleFixture("host");
  const host = donor.document.buttons.host;
  host.sourceIdentity = null;
  host.executionTarget = null;
  host.metadata = { mainPageControl: true, mainPageControlKey: "buttons-add-script" };
  const placement = Object.values(donor.document.placements).find((entry) => donor.document.surfaces[entry.surfaceId].kind === "panel");
  const oldSurface = donor.document.surfaces[placement.surfaceId];
  const mainId = getFlowCellThemePageDefinition("main").buttonSurfaceIds[0];
  donor.document.surfaces[mainId] = { ...oldSurface, id: mainId, kind: "main" };
  delete donor.document.surfaces[oldSurface.id];
  placement.surfaceId = mainId;
  delete donor.document.placements[donor.unit.memberPlacementIds[0]];
  delete donor.document.surfaces[donor.unit.surfaceId];
  delete donor.document.popoutUnits[donor.unit.id];
  const base = donor.document.skins[placement.skinOverrideId ?? host.defaultSkinId];
  const familyMetadata = { buttonSkinFamily: "Chipped Concrete", buttonSkinFamilyBaseline: { [placement.id]: 10 } };
  donor.document.skins["skin-key"] = { ...structuredClone(base), id: "skin-key", name: "Chipped Concrete Key 104", metadata: structuredClone(familyMetadata) };
  placement.skinOverrideId = "skin-key";
  const main = { kind: "flowcell", page: "main" };
  const shared = capturePortableTheme({ document: donor.document, target: main, name: "Main", descriptors: [] });
  assert.deepEqual(shared.theme.buttons[0].skin.metadata, {});
  const local = capturePortableTheme({ document: donor.document, target: main, name: "Main", descriptors: [], keepLocalSkinMetadata: true });
  assert.deepEqual(local.theme.buttons[0].skin.metadata, familyMetadata);
  const plan = planPortableThemeImport(donor.document, local, main, []);
  assert.deepEqual(plan.issues, []);
  const applied = applyPortableTheme(donor.document, local, plan);
  assert.deepEqual(Object.keys(applied.skins).sort(), Object.keys(donor.document.skins).sort());
  assert.equal(applied.placements[placement.id].skinOverrideId, "skin-key");
  assert.deepEqual(applied.skins["skin-key"], donor.document.skins["skin-key"]);
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
