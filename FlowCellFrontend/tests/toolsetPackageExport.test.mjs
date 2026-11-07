import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { captureToolsetPackage, embedLocalButtonSkinFamilies } from "./.compiled-button-system/button/editor/toolsetPackageExport.js";
import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { createButtonSourceIdentity } from "./.compiled-button-system/button/state/sourceIdentity.js";
import { mergeLegacyInstallsIntoDocument } from "./.compiled-button-system/button/state/ButtonStateRepository.js";
import { serializeButtonSkinSections } from "./.compiled-button-system/button/skins/buttonSkinFormat.js";
import { resolveEmbeddedButtonSkinFamilySource } from "./.compiled-button-system/button/skins/buttonSkinFamily.js";
import { capturePortableTheme, planPortableThemeImport, applyPortableTheme } from "./.compiled-button-system/theme/portableTheme.js";
import { listThemePlacements } from "./.compiled-button-system/theme/themeModel.js";

function install(document, layout = {}, ownerButtonId = "owner") {
  const surface = Object.values(document.surfaces)[0];
  surface.kind = "panel";
  surface.name = "Example / Tools";
  return mergeLegacyInstallsIntoDocument(document, [{
    ownerButtonId, sourceIdentity: createButtonSourceIdentity("Example", "Tools", `${ownerButtonId}.flowcell-source.json`),
    label: "Shared", tooltip: "", executionTarget: null,
    children: [{ slot: "run", label: "Run", executionTarget: {
      kind: "tool-set-action", programName: "Example", panelName: "Tools", ownerFileName: `${ownerButtonId}.flowcell-source.json`, command: "run"
    } }], layout
  }]);
}

test("Theme Save embeds the donor's disk family and restores future variants in a fresh recipient", async () => {
  const donor = install(createButtonStateDocument());
  const unit = Object.values(donor.popoutUnits)[0];
  const ownerPlacement = Object.values(donor.placements).find((entry) => entry.buttonId === "owner");
  const skin = donor.skins[donor.settings.defaultSkinId];
  skin.metadata = { buttonSkinFamily: "Keys", buttonSkinFamilyBaseline: { [ownerPlacement.id]: 6 }, donorOnly: true };
  const source = (marker) => serializeButtonSkinSections({ ...skin, base: `${skin.base}\n--disk-family:${marker};` });
  const sources = { "C:/Donor/Skins/Keys/keys3.flowcell-button-skin.txt": source("three"),
    "C:/Donor/Skins/Keys/keys8.flowcell-button-skin.txt": source("eight") };
  const reads = [];
  const target = { kind: "program", programName: "Example", panelName: null };
  const before = JSON.stringify(donor);
  const prepared = await embedLocalButtonSkinFamilies(donor, listThemePlacements(donor, target).map((entry) => entry.id), async () => ({
    directory: "C:/Donor/Skins", paths: Object.keys(sources), read: async (file) => { reads.push(file); return sources[file]; }
  }));
  assert.equal(JSON.stringify(donor), before);
  assert.deepEqual(reads.sort(), Object.keys(sources).sort());
  const descriptor = { ownerButtonId: "owner", programName: "Example", programId: "example", panelName: "Tools",
    sourceId: "example.tool", sourceVersion: "1.0.0", sourceName: "tool.py", importKind: "tool-set", slots: ["run"] };
  const archive = capturePortableTheme({ document: prepared, target, descriptors: [descriptor], name: "Disk family" });
  assert.equal(JSON.stringify(archive).includes("C:/Donor"), false);
  assert.equal(JSON.stringify(archive).includes("donorOnly"), false);
  const recipient = install(createButtonStateDocument(), {}, "recipient");
  const plan = planPortableThemeImport(recipient, archive, target, [{ ...descriptor, ownerButtonId: "recipient" }]);
  assert.deepEqual(plan.issues, []);
  const applied = applyPortableTheme(recipient, archive, plan);
  const child = Object.values(applied.buttons).find((entry) => entry.metadata.toolSetSlot === "run");
  const placement = Object.values(applied.placements).find((entry) => entry.buttonId === child.id);
  const imported = applied.skins[placement.skinOverrideId ?? child.defaultSkinId];
  assert.match(imported.base, /--disk-family:three/);
  assert.equal(resolveEmbeddedButtonSkinFamilySource(imported, placement.id, "Run"), null);
  assert.equal(resolveEmbeddedButtonSkinFamilySource(imported, placement.id, "LongLabel").source,
    sources["C:/Donor/Skins/Keys/keys8.flowcell-button-skin.txt"]);
  const restoredOwner = Object.values(applied.placements).find((entry) => entry.buttonId === "recipient");
  const ownerSkin = applied.skins[restoredOwner.skinOverrideId ?? applied.buttons.recipient.defaultSkinId];
  assert.equal(ownerSkin.structure, skin.structure);
  assert.equal(ownerSkin.base, skin.base);
  assert.equal(resolveEmbeddedButtonSkinFamilySource(ownerSkin, restoredOwner.id, "Shared"), null);
});

test("tool-set export captures scoped skins and geometry without local execution or desktop state", async () => {
  const document = install(createButtonStateDocument());
  const unit = Object.values(document.popoutUnits)[0];
  unit.desktopBounds = { x: 999, y: 888, width: 333, height: 222 };
  const before = JSON.stringify(document);
  const capture = await captureToolsetPackage(document, unit, async () => { throw Error("Unexpected library access"); });
  assert.equal(JSON.stringify(document), before);
  assert.equal(capture.ownerButtonId, "owner");
  assert.equal(Object.keys(capture.appearance.skins).length, 1);
  assert.equal(capture.appearance.owner, capture.appearance.children.run);
  assert.deepEqual(capture.presentation.children.run, { label: "Run", tooltip: "" });
  assert.equal(capture.appearance.skins[capture.appearance.owner].source,
    serializeButtonSkinSections(document.skins[document.settings.defaultSkinId]));
  assert.equal(capture.layout.placements.run.width, document.placements[unit.childPlacementIds[0]].width);
  assert.equal(JSON.stringify(capture).includes("999"), false);
  assert.equal("executionTarget" in capture, false);
});

test("tool-set export rejects invalid skin markup before native publication", async () => {
  const document = install(createButtonStateDocument());
  document.skins[document.settings.defaultSkinId].structure = '<script>alert(1)</script><span data-core>{{label}}</span>';
  await assert.rejects(captureToolsetPackage(document, Object.values(document.popoutUnits)[0], async () => {
    throw Error("Unexpected library access");
  }), /invalid structure/);
});

test("tool-set export carries embedded numbered variants without reading a donor library", async () => {
  const base = createButtonStateDocument();
  const source = serializeButtonSkinSections(base.skins[base.settings.defaultSkinId]);
  const document = install(base, { appearance: {
    skins: { basic: { source, variants: { 3: source, 8: source } } }, owner: "basic", children: { run: "basic" }
  } });
  const unit = Object.values(document.popoutUnits)[0];
  const capture = await captureToolsetPackage(document, unit, async () => { throw Error("Unexpected library access"); });
  assert.deepEqual(capture.appearance.skins[capture.appearance.owner].variants, { 3: source, 8: source });
});

test("all 8 Blender toolsets include validated assigned skins, family files and 80 child assignments", async () => {
  const root = path.resolve(import.meta.dirname, "../../Programs/Blender");
  const manifest = JSON.parse(await readFile(path.join(root, "flowcell.program.json"), "utf8"));
  const sources = manifest.bundledSources.filter((source) => source.importKind === "tool-set");
  assert.equal(sources.length, 8);
  let children = 0;
  for (const [index, source] of sources.entries()) {
    const file = path.resolve(root, source.sourcePath);
    const authored = JSON.parse(await readFile(file, "utf8"));
    assert.equal(authored.version, source.version);
    const skins = {};
    for (const [key, skin] of Object.entries(authored.appearance.skins)) {
      const read = async (relative) => {
        const full = path.resolve(path.dirname(file), relative);
        assert.ok(full.startsWith(`${path.dirname(file)}${path.sep}`));
        return readFile(full, "utf8");
      };
      skins[key] = { source: await read(skin.file), variants: Object.fromEntries(await Promise.all(
        Object.entries(skin.variants ?? {}).map(async ([count, relative]) => [count, await read(relative)])
      )) };
    }
    const document = createButtonStateDocument();
    const panel = Object.values(document.surfaces)[0]; panel.kind = "panel"; panel.name = `Blender / ${source.panelName}`;
    const installed = mergeLegacyInstallsIntoDocument(document, [{
      ownerButtonId: `owner-${index}`, sourceIdentity: createButtonSourceIdentity("Blender", source.panelName, `owner-${index}.flowcell-source.json`),
      label: authored.label, tooltip: "", executionTarget: null,
      children: authored.children.map((child) => ({ slot: child.slot, label: child.label, executionTarget: {
        kind: "tool-set-action", programName: "Blender", panelName: source.panelName,
        ownerFileName: `owner-${index}.flowcell-source.json`, command: child.slot
      } })), layout: { ...authored.layout, appearance: { ...authored.appearance, skins } }
    }]);
    const unit = Object.values(installed.popoutUnits)[0];
    for (const id of unit.childPlacementIds) assert.ok(installed.placements[id].skinOverrideId);
    children += unit.childPlacementIds.length;
    const captured = await captureToolsetPackage(installed, unit, async () => { throw Error("Unexpected donor-library access"); });
    assert.equal(Object.keys(captured.appearance.children).length, authored.children.length);
    assert.equal(captured.layout.width, authored.layout.width);
    assert.equal(captured.layout.height, authored.layout.height);
  }
  assert.equal(children, 80);
});
