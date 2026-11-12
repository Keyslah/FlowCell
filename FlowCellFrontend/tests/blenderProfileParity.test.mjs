import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import ts from "typescript";
import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { mergeLegacyInstallsIntoDocument } from "./.compiled-button-system/button/state/ButtonStateRepository.js";
import { createButtonSourceIdentity } from "./.compiled-button-system/button/state/sourceIdentity.js";
import { ensureRegularPopout, ensureFanSetup } from "./.compiled-button-system/button/state/buttonDocumentOperations.js";
import { setButtonPopoutFanMode } from "./.compiled-button-system/button/state/buttonPopoutInteractionOperations.js";
import { reconcileProgramPanelOwners } from "./.compiled-button-system/button/state/panelOwnerButtonOperations.js";
import { resolveButtonPlacementPresentation } from "./.compiled-button-system/button/state/buttonPresentation.js";
import { BUTTON_SKIN_SECTION_ORDER } from "./.compiled-button-system/button/skins/buttonSkinFormat.js";
import { getEmbeddedButtonSkinFamilySources } from "./.compiled-button-system/button/skins/buttonSkinFamily.js";
import { emptyButtonThemeOverride } from "./.compiled-button-system/theme/themeModel.js";
import { isPortableTheme, portableThemeForScope, planPortableThemeImport, applyPortableTheme } from "./.compiled-button-system/theme/portableTheme.js";

const programRoot = join(import.meta.dirname, "../../Programs/Blender");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

test("Blender setup defaults contain exactly the captured visible sources", () => {
  const program = readJson(join(programRoot, "flowcell.program.json"));
  const file = readJson(join(programRoot, program.defaultTheme));
  const visibleDefaults = program.bundledSources.filter((source) => source.required || source.installOnAdd)
    .filter((source) => {
      const path = join(programRoot, source.sourcePath);
      return source.importKind !== "script" || !statSync(path).isDirectory() ||
        !readJson(join(path, "flowcell.script.json")).page?.themeContribution;
    });
  assert.deepEqual(visibleDefaults.map((source) => source.id).sort(),
    file.theme.dependencies.map((source) => source.sourceId).sort(),
    "default setup must neither add uncaptured controls nor omit original controls");
  const provenance = readJson(join(programRoot, "SupportScripts/default-appearance-provenance.json"));
  assert.equal(provenance.donorRevision, 1473);
  assert.equal(provenance.dependencies, 50);
  assert.equal(provenance.placements, 198);
  assert.equal(provenance.surfaces, 23);
  assert.equal(file.theme.theme.buttons.length, provenance.placements);
});

// Exercise the production preparation helper without starting Tauri or a host process.
const serviceSource = ts.createSourceFile("portableThemeService.ts",
  readFileSync(join(import.meta.dirname, "../src/theme/portableThemeService.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const prepareSource = serviceSource.statements.find((node) =>
  ts.isFunctionDeclaration(node) && node.name?.text === "prepareThemeSurfaces").getText(serviceSource).replace(/^export /, "");
const prepareCompiled = ts.transpileModule(prepareSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const prepareThemeSurfaces = new Function("portableThemeForScope", "ensureRegularPopout", "ensureFanSetup", "reconcileProgramPanelOwners", "setButtonPopoutFanMode",
  `${prepareCompiled}\nreturn prepareThemeSurfaces;`)(portableThemeForScope, ensureRegularPopout, ensureFanSetup, reconcileProgramPanelOwners, setButtonPopoutFanMode);
const appearanceSource = ts.createSourceFile("programDefaultTheme.ts",
  readFileSync(join(import.meta.dirname, "../src/pages/program-setup/programDefaultTheme.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const decodeSource = appearanceSource.statements.find((node) =>
  ts.isFunctionDeclaration(node) && node.name?.text === "decodeProgramAppearance").getText(appearanceSource).replace(/^export /, "");
const decodeCompiled = ts.transpileModule(decodeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const decodeProgramAppearance = new Function("isPortableTheme", "BUTTON_SKIN_SECTION_ORDER", "getEmbeddedButtonSkinFamilySources",
  `${decodeCompiled}\nreturn decodeProgramAppearance;`)(isPortableTheme, BUTTON_SKIN_SECTION_ORDER, getEmbeddedButtonSkinFamilySources);

function freshCatalogDependencies(archive) {
  const program = readJson(join(programRoot, "flowcell.program.json"));
  const installs = [];
  const descriptors = [];
  for (const dependency of archive.dependencies) {
    const source = program.bundledSources.find((entry) => entry.id === dependency.sourceId);
    assert.ok(source, `The Blender package must contain '${dependency.sourceId}'.`);
    assert.equal(source.version, dependency.sourceVersion, `${source.id} package and preset versions must agree.`);
    assert.equal(source.importKind, dependency.importKind);
    const sourcePath = join(programRoot, source.sourcePath);
    assert.ok(statSync(sourcePath), `${source.id} source must exist.`);
    const ownerButtonId = `fresh-${source.id}`;
    const sourceIdentity = createButtonSourceIdentity("Blender", dependency.panelName, `${ownerButtonId}.flowcell-source.json`);
    let manifest = null;
    let layout;
    if (source.importKind === "tool-set") {
      manifest = readJson(sourcePath);
      layout = structuredClone(manifest.layout);
      if (manifest.appearance) layout.appearance = {
        ...structuredClone(manifest.appearance),
        skins: Object.fromEntries(Object.entries(manifest.appearance.skins).map(([key, value]) => [key, {
          source: readFileSync(join(dirname(sourcePath), value.file), "utf8"),
          ...(value.variants ? { variants: Object.fromEntries(Object.entries(value.variants)
            .map(([count, file]) => [count, readFileSync(join(dirname(sourcePath), file), "utf8")])) } : {})
        }]))
      };
      assert.equal(manifest.id, source.id);
      assert.equal(manifest.version, source.version);
    }
    const children = (manifest?.children ?? []).map((child) => ({ slot: child.slot, label: child.label,
      tooltip: child.tooltip, executionTarget: { kind: "tool-set-action", programName: "Blender",
        panelName: dependency.panelName, ownerFileName: sourceIdentity.displayFileName,
        command: child.slot, payload: child.payload } }));
    installs.push({ ownerButtonId, sourceIdentity, label: manifest?.label ?? source.displayLabel,
      tooltip: manifest?.tooltip ?? "", layout,
      executionTarget: manifest ? null : { kind: "panel-script", programName: "Blender",
        panelName: dependency.panelName, fileName: sourceIdentity.displayFileName }, children });
    descriptors.push({ ownerButtonId, programName: "Blender", programId: program.programId,
      panelName: dependency.panelName, sourceId: source.id, sourceVersion: source.version,
      sourceName: basename(sourcePath), importKind: source.importKind, slots: children.map((child) => child.slot) });
  }
  return { document: mergeLegacyInstallsIntoDocument(createButtonStateDocument(), installs), descriptors };
}

test("the packaged Blender profile restores every saved appearance on a clean recipient with new identities", () => {
  const archive = decodeProgramAppearance(readJson(join(programRoot, "SupportScripts/default-appearance.flowcell-theme.json")));
  assert.equal(isPortableTheme(archive), true, "the shipped profile must be a valid complete portable theme");
  assert.ok(archive.dependencies.length > 0);
  assert.ok(archive.theme.buttons.length > archive.dependencies.length);
  const recipient = freshCatalogDependencies(archive);
  const original = structuredClone(recipient.document);
  let plan = planPortableThemeImport(recipient.document, archive, archive.target, recipient.descriptors);
  assert.deepEqual(plan.missingDependencies, []);
  prepareThemeSurfaces(recipient.document, archive, plan);
  plan = planPortableThemeImport(recipient.document, archive, archive.target, recipient.descriptors);
  assert.deepEqual(plan.issues, []);
  assert.deepEqual(plan.missingDependencies, []);
  assert.equal(Object.keys(plan.placementIds).length, archive.theme.buttons.length,
    "every captured Button occurrence must map onto the clean recipient");
  const beforeApply = structuredClone(recipient.document);
  const after = applyPortableTheme(recipient.document, archive, plan);
  assert.deepEqual(recipient.document, beforeApply, "preview application must not mutate its input");
  for (const appearance of archive.theme.buttons) {
    const localId = plan.placementIds[appearance.placementId];
    assert.notEqual(localId, appearance.placementId, "portable placement identities must be remapped");
    const placement = after.placements[localId];
    const button = after.buttons[placement.buttonId];
    const saved = archive.presentation[appearance.placementId];
    const presentation = resolveButtonPlacementPresentation(button, placement);
    assert.deepEqual(Object.fromEntries(Object.keys(saved.button).map((key) => [key, presentation[key]])), saved.button,
      `${appearance.label}: full Button presentation`);
    const { id, buttonId, surfaceId, skinOverrideId, presentationOverride, ...placementPresentation } = placement;
    for (const key of ["textGlow", "textGlowCurve"]) {
      if (!Object.hasOwn(saved.placement, key) && placementPresentation[key] === null) delete placementPresentation[key];
    }
    assert.deepEqual(placementPresentation, saved.placement, `${appearance.label}: full placement presentation`);
    const skin = after.skins[placement.skinOverrideId ?? button.defaultSkinId];
    for (const section of BUTTON_SKIN_SECTION_ORDER) {
      assert.equal(skin[section], appearance.skin[section], `${appearance.label}: literal ${section} skin section`);
    }
    assert.deepEqual(getEmbeddedButtonSkinFamilySources(skin), getEmbeddedButtonSkinFamilySources(appearance.skin),
      `${appearance.label}: all packaged skin-family variants`);
    assert.deepEqual(after.themeOverrides?.[localId] ?? emptyButtonThemeOverride(), appearance.themeOverride,
      `${appearance.label}: exact saved per-Button color/highlight override`);
    assert.deepEqual(after.programPopoutColorOverrides?.[localId], archive.programAppearance?.overrides[appearance.placementId]);
    assert.deepEqual(after.programPopoutThemeLocks?.[localId], archive.programAppearance?.locks[appearance.placementId]);
    assert.deepEqual(button.executionTarget, recipient.document.buttons[button.id].executionTarget,
      "importing appearance must preserve the recipient's installed execution target");
  }
  for (const saved of archive.surfaces) {
    const localId = plan.surfaceIds[saved.id];
    const surface = after.surfaces[localId];
    assert.ok(surface, `${saved.name} must have a recipient arrangement`);
    assert.deepEqual(surface.placementIds, saved.placementIds.map((id) => plan.placementIds[id]), `${saved.name}: occurrence order`);
    if (saved.complete) {
      for (const key of ["width", "height", "uniformButtonSize", "visualOverflowAllowance"]) {
        assert.deepEqual(surface[key], saved[key], `${saved.name}: ${key}`);
      }
    }
    if (saved.popout) {
      const unit = Object.values(after.popoutUnits).find((candidate) => candidate.surfaceId === localId);
      assert.ok(unit);
      for (const [key, value] of Object.entries(saved.popout)) {
        if (key === "fieldGeometry") {
          for (const [fieldId, geometry] of Object.entries(value)) {
            const field = unit.fields.find((entry) => entry.id === fieldId);
            assert.deepEqual(Object.fromEntries(Object.keys(geometry).map((name) => [name, field[name]])), geometry);
          }
        } else assert.deepEqual(unit[key], value, `${saved.name}: popout ${key}`);
      }
    }
    if (saved.fan) {
      const fan = Object.values(after.fanSetups).find((candidate) => candidate.fanSurfaceId === localId);
      assert.ok(fan);
      for (const [key, value] of Object.entries(saved.fan)) {
        assert.deepEqual(fan[key], key === "selectedToolSetOwnerButtonIds" ? value.map((id) => plan.buttonIds[id]) : value);
      }
    }
  }
  if (archive.programAppearance) {
    assert.deepEqual(after.programPopoutThemes?.blender ?? null, archive.programAppearance.settings);
  }
  const repeated = applyPortableTheme(after, archive,
    planPortableThemeImport(after, archive, archive.target, recipient.descriptors));
  assert.deepEqual(repeated, after, "reapplying the complete Blender profile must be idempotent");
  assert.ok(Object.keys(original.buttons).length > 0, "the recipient starts from clean actual catalog installations");
});
