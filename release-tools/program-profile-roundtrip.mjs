import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createButtonStateDocument } from "../FlowCellFrontend/tests/.compiled-button-system/button/state/buttonDefaults.js";
import { mergeLegacyInstallsIntoDocument, normalizeLegacyInstallResult } from "../FlowCellFrontend/tests/.compiled-button-system/button/state/ButtonStateRepository.js";
import { createButtonSourceIdentity } from "../FlowCellFrontend/tests/.compiled-button-system/button/state/sourceIdentity.js";
import { resolveButtonPlacementPresentation } from "../FlowCellFrontend/tests/.compiled-button-system/button/state/buttonPresentation.js";
import { BUTTON_SKIN_SECTION_ORDER } from "../FlowCellFrontend/tests/.compiled-button-system/button/skins/buttonSkinFormat.js";
import { getEmbeddedButtonSkinFamilySources } from "../FlowCellFrontend/tests/.compiled-button-system/button/skins/buttonSkinFamily.js";
import { emptyButtonThemeOverride } from "../FlowCellFrontend/tests/.compiled-button-system/theme/themeModel.js";
import { isPortableTheme, planPortableThemeImport, applyPortableTheme } from "../FlowCellFrontend/tests/.compiled-button-system/theme/portableTheme.js";
import { prepareThemeSurfaces } from "../FlowCellFrontend/tests/.compiled-button-system/theme/portableThemeService.js";
import { buildProgramSetupDocument, decodeProgramAppearance } from "../FlowCellFrontend/tests/.compiled-button-system/pages/program-setup/programDefaultTheme.js";
import { assertSelfContainedProgramAppearance } from "./program-profile-assets.mjs";

// Uses the same compiled production model as test:button. No host process,
// canonical saved state, app installation, archive, or source script is executed.
const readJson = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const equal = (actual, expected, message) => assert.ok(isDeepStrictEqual(actual, expected), message);
const normalizedName = (value) => value.normalize("NFC").trim().toLocaleLowerCase("en");
const sourceKind = (value) => value === "toolset" ? "tool-set" : value;

function packagePath(root, value) {
  assert.ok(typeof value === "string" && value.length > 0 && !isAbsolute(value), "Package reference must be relative.");
  const candidate = resolve(root, value);
  const inside = (base, path) => {
    const part = relative(base, path);
    return !isAbsolute(part) && part !== ".." && !part.startsWith("../") && !part.startsWith("..\\");
  };
  assert.ok(inside(resolve(root), candidate) && inside(realpathSync(root), realpathSync(candidate)),
    `Package reference escapes its source: ${value}`);
  return candidate;
}

function sourcePackage(programRoot, source, sourceOverrides = new Map()) {
  // Capture can verify a generated, staging-only script manifest in memory.
  // The original entry bytes still come from the catalog's actual file.
  if (sourceOverrides.has(source.id)) return sourceOverrides.get(source.id);
  const sourcePath = packagePath(programRoot, source.sourcePath);
  const expected = sourceKind(source.importKind) === "tool-set" ? "flowcell.toolset.json" : "flowcell.script.json";
  const sibling = join(dirname(sourcePath), expected);
  const manifestPath = statSync(sourcePath).isDirectory() ? join(sourcePath, expected) :
    basename(sourcePath).toLowerCase() === expected ? sourcePath : existsSync(sibling) ? sibling : null;
  const manifest = manifestPath ? readJson(manifestPath) : null;
  if (sourceKind(source.importKind) === "tool-set") assert.ok(manifest, `${source.id}: a tool-set requires its package manifest.`);
  if (manifest) {
    if (manifest.id || sourceKind(source.importKind) === "tool-set") assert.equal(manifest.id, source.id,
      `${source.id}: package identity differs from the Program manifest.`);
    if (manifest.version !== undefined) assert.equal(manifest.version, source.version,
      `${source.id}: package version differs from the Program manifest.`);
    const entry = packagePath(dirname(manifestPath), manifest.source);
    if (statSync(sourcePath).isFile() && sourcePath !== manifestPath) {
      const aliases = (manifest.importAliases ?? []).map((alias) => packagePath(dirname(manifestPath), alias));
      assert.ok([entry, ...aliases].map((path) => realpathSync(path)).includes(realpathSync(sourcePath)),
        `${source.id}: selected package companion is not its declared entry or import alias.`);
    }
  }
  return { sourcePath, manifestPath, manifest };
}

/** Build fresh install DTOs from actual package files, then use the production reconciler. */
export function createProgramProfileRecipient(programRoot, archive, stagedProgram, sourceOverrides = new Map(), { includeAllSources = false } = {}) {
  const program = stagedProgram ?? readJson(join(programRoot, "flowcell.program.json"));
  const installs = [];
  const installDescriptors = [];
  const descriptors = [];
  const seen = new Set();
  const dependencies = includeAllSources ? program.bundledSources.map((source) => {
    const captured = archive.dependencies.find((dependency) => dependency.sourceId === source.id);
    if (captured) return captured;
    const { manifest } = sourcePackage(programRoot, source, sourceOverrides);
    return { programName: program.label, programId: program.programId, panelName: source.panelName,
      sourceId: source.id, sourceVersion: source.version, sourceName: source.displayLabel ?? source.id,
      importKind: sourceKind(source.importKind), slots: (manifest?.children ?? []).map((child) => child.slot) };
  }) : archive.dependencies;
  for (const dependency of dependencies) {
    assert.ok(!seen.has(dependency.sourceId), `${dependency.sourceId}: duplicate source dependency.`);
    seen.add(dependency.sourceId);
    const sources = program.bundledSources.filter((entry) => entry.id === dependency.sourceId);
    assert.equal(sources.length, 1, `${program.label}: source '${dependency.sourceId}' must occur exactly once in the catalog.`);
    const source = sources[0];
    assert.equal(source.version, dependency.sourceVersion, `${source.id}: package and profile versions differ.`);
    assert.equal(sourceKind(source.importKind), dependency.importKind, `${source.id}: import kind differs.`);
    assert.equal(normalizedName(source.panelName), normalizedName(dependency.panelName), `${source.id}: panel differs.`);
    assert.equal(normalizedName(program.label), normalizedName(dependency.programName), `${source.id}: Program name differs.`);
    assert.equal(program.programId, dependency.programId, `${source.id}: Program identity differs.`);
    const { sourcePath, manifestPath, manifest } = sourcePackage(programRoot, source, sourceOverrides);
    const ownerButtonId = `profile-recipient-${source.id}`;
    const sourceIdentity = createButtonSourceIdentity(program.label, dependency.panelName, `${ownerButtonId}.flowcell-source.json`);
    // Native install::execution_target_with_source_identity binds a core service
    // to its recipient owner before the frontend's real result normalizer runs.
    const bindSourceTarget = (target) => target?.kind === "core-action" ? { ...target, payload: {
      ...target.payload, programName: program.label, panelName: dependency.panelName,
      fileName: sourceIdentity.displayFileName, ownerButtonId
    } } : target;
    let layout;
    const toolset = sourceKind(source.importKind) === "tool-set";
    if (toolset) {
      layout = structuredClone(manifest.layout ?? {});
      if (manifest.appearance) layout.appearance = {
        ...structuredClone(manifest.appearance),
        skins: Object.fromEntries(Object.entries(manifest.appearance.skins).map(([key, skin]) => [key, {
          source: readFileSync(packagePath(dirname(manifestPath), skin.file), "utf8"),
          ...(skin.variants ? { variants: Object.fromEntries(Object.entries(skin.variants).map(([count, file]) =>
            [count, readFileSync(packagePath(dirname(manifestPath), file), "utf8")])) } : {})
        }]))
      };
    }
    const children = (toolset ? manifest.children : []).map((child) => ({ slot: child.slot, label: child.label,
      tooltip: child.tooltip, executionTarget: bindSourceTarget(child.executionTarget) ?? { kind: "tool-set-action", programName: program.label,
        panelName: dependency.panelName, ownerFileName: sourceIdentity.displayFileName,
        command: child.slot, payload: child.payload ?? null } }));
    equal(children.map((child) => child.slot).sort(), [...dependency.slots].sort(), `${source.id}: profile and catalog child slots differ.`);
    const executionTarget = toolset ? null : bindSourceTarget(manifest?.page ? { kind: "core-action", actionId: "open-installed-page",
      payload: { pageId: manifest.page.id } } : manifest?.executionTarget) ?? { kind: "panel-script", programName: program.label,
      panelName: dependency.panelName, fileName: sourceIdentity.displayFileName, events: manifest?.events ?? null };
    const installDescriptor = { ownerButtonId, sourceIdentity, owner: {
      label: manifest?.label ?? source.displayLabel ?? basename(sourcePath), tooltip: manifest?.tooltip ?? "", executionTarget },
      layout, events: manifest?.events, children, ...(manifest?.page?.themeContribution ? { themeContributionOnly: true } : {}) };
    installDescriptors.push(installDescriptor);
    installs.push(normalizeLegacyInstallResult(installDescriptor));
    descriptors.push({ ownerButtonId, programName: program.label, programId: program.programId,
      panelName: dependency.panelName, sourceId: source.id, sourceVersion: source.version,
      sourceName: basename(sourcePath), importKind: sourceKind(source.importKind), slots: children.map((child) => child.slot) });
  }
  return { document: mergeLegacyInstallsIntoDocument(createButtonStateDocument(), installs), descriptors, installDescriptors, program };
}

/** Exercise the same setup planner for every selectable source, including uncaptured scripts. */
export async function verifyProgramSelectedSourcesRoundTrip({ programRoot, appearance, program: stagedProgram, sourceOverrides = new Map() }) {
  const program = stagedProgram ?? readJson(join(programRoot, "flowcell.program.json"));
  const file = appearance ?? readJson(packagePath(programRoot, program.defaultTheme));
  const archive = decodeProgramAppearance(file);
  const captured = createProgramProfileRecipient(programRoot, archive, program, sourceOverrides);
  const selected = createProgramProfileRecipient(programRoot, archive, program, sourceOverrides, { includeAllSources: true });
  const panels = [...new Set([
    ...(program.panels ?? []).map((panel) => panel.label),
    ...program.bundledSources.map((source) => source.panelName)
  ])];
  const build = (recipient) => buildProgramSetupDocument(createButtonStateDocument(), {
    programName: program.label, panels, descriptors: recipient.installDescriptors,
    themeDescriptors: recipient.descriptors, defaultTheme: file, defaultThemeReceipt: "0".repeat(64)
  });
  const baseline = await build(captured);
  const all = await build(selected);
  for (const descriptor of selected.installDescriptors) {
    assert.ok(all.document.buttons[descriptor.ownerButtonId], `${descriptor.ownerButtonId}: selected source has no Button.`);
  }
  const baselinePlan = planPortableThemeImport(baseline.document, archive, archive.target, captured.descriptors);
  const allPlan = planPortableThemeImport(all.document, archive, archive.target, selected.descriptors);
  equal(baselinePlan.issues, [], `${program.label}: captured setup cannot be mapped back to its theme.`);
  equal(allPlan.issues, [], `${program.label}: all-source setup cannot be mapped back to its theme.`);
  // Adding another catalog script must not move or restyle an authored occurrence.
  // Pop/Fan placements and skins receive new UUIDs on each build: compare each
  // portable occurrence through its source/surface mapping, never by those IDs.
  for (const appearance of archive.theme.buttons) {
    const placement = baseline.document.placements[baselinePlan.placementIds[appearance.placementId]];
    const actual = all.document.placements[allPlan.placementIds[appearance.placementId]];
    assert.ok(placement && actual, `${program.label}: selecting all scripts omitted '${appearance.placementId}'.`);
    const button = baseline.document.buttons[placement.buttonId];
    const { id: _expectedId, buttonId: _expectedButtonId, surfaceId: _expectedSurfaceId,
      skinOverrideId: expectedSkinId, ...expectedPlacement } = placement;
    const { id: _actualId, buttonId: _actualButtonId, surfaceId: _actualSurfaceId,
      skinOverrideId: actualSkinId, ...actualPlacement } = actual;
    equal(actualPlacement, expectedPlacement, `${program.label}: selecting all scripts moved or restyled '${placement.id}'.`);
    const actualButton = all.document.buttons[actual.buttonId];
    equal(resolveButtonPlacementPresentation(actualButton, actual), resolveButtonPlacementPresentation(button, placement),
      `${program.label}: selecting all scripts changed '${placement.id}' presentation.`);
    const expectedSkin = baseline.document.skins[expectedSkinId ?? button.defaultSkinId];
    const actualSkin = all.document.skins[actualSkinId ?? actualButton.defaultSkinId];
    for (const section of BUTTON_SKIN_SECTION_ORDER) equal(actualSkin[section], expectedSkin[section],
      `${program.label}: selecting all scripts changed '${placement.id}' skin ${section}.`);
    equal(getEmbeddedButtonSkinFamilySources(actualSkin), getEmbeddedButtonSkinFamilySources(expectedSkin),
      `${program.label}: selecting all scripts changed '${placement.id}' skin variants.`);
  }
  for (const surface of archive.surfaces) {
    const expected = baseline.document.surfaces[baselinePlan.surfaceIds[surface.id]];
    const actual = all.document.surfaces[allPlan.surfaceIds[surface.id]];
    assert.ok(expected && actual, `${program.label}: selecting all scripts omitted surface '${surface.id}'.`);
    for (const key of ["kind", "visualOverflowAllowance", "uniformButtonSize"]) {
      equal(actual[key], expected[key], `${program.label}: selecting all scripts changed surface '${surface.id}' ${key}.`);
    }
    for (const key of ["width", "height"]) {
      if (actual.placementIds.length > expected.placementIds.length) {
        assert.ok(actual[key] >= expected[key], `${program.label}: adding scripts shrank surface '${surface.id}' ${key}.`);
      } else {
        equal(actual[key], expected[key], `${program.label}: selecting all scripts changed surface '${surface.id}' ${key}.`);
      }
    }
  }
  return { programId: program.programId, selectedSources: selected.installDescriptors.length,
    document: all.document, descriptors: selected.descriptors };
}

/** Fail before packaging if a fresh recipient cannot reproduce every captured occurrence. */
export function verifyProgramProfileRoundTrip({ programRoot, appearance, program: stagedProgram, sourceOverrides = new Map() }) {
  const program = stagedProgram ?? readJson(join(programRoot, "flowcell.program.json"));
  assert.ok(program.defaultTheme, `${program.label}: no captured default appearance is declared.`);
  const file = appearance ?? readJson(packagePath(programRoot, program.defaultTheme));
  assertSelfContainedProgramAppearance(file);
  const archive = decodeProgramAppearance(file);
  assert.ok(isPortableTheme(archive), `${program.label}: invalid portable appearance.`);
  assert.equal(archive.target.kind, "program");
  assert.equal(normalizedName(archive.target.programName), normalizedName(program.label));
  assert.equal(archive.target.panelName, null);
  assert.equal(archive.target.area, undefined);
  const visibleDefaults = program.bundledSources.filter((source) => source.required || source.installOnAdd)
    .filter((source) => !sourcePackage(programRoot, source, sourceOverrides).manifest?.page?.themeContribution);
  equal(visibleDefaults.map((source) => source.id).sort(), archive.dependencies.map((source) => source.sourceId).sort(),
    `${program.label}: default setup adds uncaptured controls or omits captured controls.`);
  const recipient = createProgramProfileRecipient(programRoot, archive, program, sourceOverrides);
  let plan = planPortableThemeImport(recipient.document, archive, archive.target, recipient.descriptors);
  equal(plan.missingDependencies, [], `${program.label}: missing profile dependencies.`);
  prepareThemeSurfaces(recipient.document, archive, plan);
  plan = planPortableThemeImport(recipient.document, archive, archive.target, recipient.descriptors);
  assert.equal(plan.issues.length, 0, `${program.label}: ${plan.issues.join("; ")}`);
  equal(plan.missingDependencies, [], `${program.label}: missing profile dependencies after preparing surfaces.`);
  assert.equal(Object.keys(plan.placementIds).length, archive.theme.buttons.length,
    `${program.label}: some captured Button occurrences have no recipient placement.`);
  const beforeApply = structuredClone(recipient.document);
  const after = applyPortableTheme(recipient.document, archive, plan);
  equal(recipient.document, beforeApply, `${program.label}: preview application mutated its input.`);
  for (const appearance of archive.theme.buttons) {
    const localId = plan.placementIds[appearance.placementId];
    assert.notEqual(localId, appearance.placementId, "Portable placement identities must be remapped.");
    const placement = after.placements[localId];
    const button = after.buttons[placement.buttonId];
    const saved = archive.presentation[appearance.placementId];
    const presentation = resolveButtonPlacementPresentation(button, placement);
    equal(Object.fromEntries(Object.keys(saved.button).map((key) => [key, presentation[key]])), saved.button,
      `${appearance.label}: full Button presentation differs.`);
    const { id, buttonId, surfaceId, skinOverrideId, presentationOverride, ...placementPresentation } = placement;
    for (const key of ["textGlow", "textGlowCurve"]) {
      if (!Object.hasOwn(saved.placement, key) && placementPresentation[key] === null) delete placementPresentation[key];
    }
    equal(placementPresentation, saved.placement, `${appearance.label}: full placement presentation differs.`);
    const skin = after.skins[placement.skinOverrideId ?? button.defaultSkinId];
    for (const section of BUTTON_SKIN_SECTION_ORDER) equal(skin[section], appearance.skin[section],
      `${appearance.label}: literal ${section} skin section differs.`);
    equal(getEmbeddedButtonSkinFamilySources(skin), getEmbeddedButtonSkinFamilySources(appearance.skin),
      `${appearance.label}: skin-family variants differ.`);
    equal(after.themeOverrides?.[localId] ?? emptyButtonThemeOverride(), appearance.themeOverride,
      `${appearance.label}: per-Button color/highlight override differs.`);
    equal(after.programPopoutColorOverrides?.[localId], archive.programAppearance?.overrides[appearance.placementId],
      `${appearance.label}: Program color override differs.`);
    equal(after.programPopoutThemeLocks?.[localId], archive.programAppearance?.locks[appearance.placementId],
      `${appearance.label}: Program theme lock differs.`);
  }
  // Appearance must never rewrite executable routing or the catalog's field behavior.
  for (const button of Object.values(beforeApply.buttons)) {
    equal(after.buttons[button.id].executionTarget, button.executionTarget, `${button.label}: execution target changed.`);
    equal(after.buttons[button.id].toolSetBehavior, button.toolSetBehavior, `${button.label}: tool-set behavior changed.`);
  }
  let fields = 0;
  for (const saved of archive.surfaces) {
    const localId = plan.surfaceIds[saved.id];
    const surface = after.surfaces[localId];
    assert.ok(surface, `${saved.name}: missing recipient arrangement.`);
    equal(surface.placementIds, saved.placementIds.map((id) => plan.placementIds[id]), `${saved.name}: occurrence order differs.`);
    if (saved.complete) for (const key of ["width", "height", "uniformButtonSize", "visualOverflowAllowance"]) {
      equal(surface[key], saved[key], `${saved.name}: ${key} differs.`);
    }
    if (saved.popout) {
      const unit = Object.values(after.popoutUnits).find((candidate) => candidate.surfaceId === localId);
      const originalUnit = Object.values(beforeApply.popoutUnits).find((candidate) => candidate.surfaceId === localId);
      assert.ok(unit && originalUnit, `${saved.name}: missing recipient popout.`);
      for (const [key, value] of Object.entries(saved.popout)) {
        if (key === "fieldGeometry") {
          for (const [fieldId, geometry] of Object.entries(value)) {
            const field = unit.fields.find((entry) => entry.id === fieldId);
            assert.ok(field, `${saved.name}: field '${fieldId}' is missing from the catalog.`);
            equal(Object.fromEntries(Object.keys(geometry).map((name) => [name, field[name]])), geometry,
              `${saved.name}: field '${fieldId}' geometry differs.`);
          }
        } else equal(unit[key], value, `${saved.name}: popout ${key} differs.`);
      }
      if (unit.kind === "tool-set") {
        fields += unit.fields.length;
        equal(unit.fields.map((field) => field.id), originalUnit.fields.map((field) => field.id), `${saved.name}: field identities changed.`);
        for (const original of originalUnit.fields) {
          const expected = { ...original, ...saved.popout.fieldGeometry?.[original.id] };
          equal(unit.fields.find((field) => field.id === original.id), expected, `${saved.name}: field '${original.id}' behavior changed.`);
        }
      }
    }
    if (saved.fan) {
      const fan = Object.values(after.fanSetups).find((candidate) => candidate.fanSurfaceId === localId);
      assert.ok(fan, `${saved.name}: missing recipient Fan.`);
      for (const [key, value] of Object.entries(saved.fan)) equal(fan[key], key === "selectedToolSetOwnerButtonIds"
        ? value.map((id) => plan.buttonIds[id]) : value, `${saved.name}: Fan ${key} differs.`);
    }
  }
  if (archive.programAppearance) equal(after.programPopoutThemes?.[normalizedName(program.label)] ?? null,
    archive.programAppearance.settings, `${program.label}: Program appearance settings differ.`);
  const repeated = applyPortableTheme(after, archive,
    planPortableThemeImport(after, archive, archive.target, recipient.descriptors));
  equal(repeated, after, `${program.label}: applying the profile again changes its contents.`);
  return { programId: program.programId, dependencies: archive.dependencies.length,
    placements: archive.theme.buttons.length, surfaces: archive.surfaces.length, fields };
}
