import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { embedLocalButtonSkinFamilies } from "../FlowCellFrontend/tests/.compiled-button-system/button/editor/toolsetPackageExport.js";
import { listThemePlacements } from "../FlowCellFrontend/tests/.compiled-button-system/theme/themeModel.js";
import { capturePortableTheme } from "../FlowCellFrontend/tests/.compiled-button-system/theme/portableTheme.js";
import { encodeProgramDefaultTheme } from "../FlowCellFrontend/tests/.compiled-button-system/pages/program-setup/programDefaultTheme.js";
import { createProgramProfileRecipient, verifyProgramProfileRoundTrip, verifyProgramSelectedSourcesRoundTrip } from "./program-profile-roundtrip.mjs";
import { assertSelfContainedProgramAppearance } from "./program-profile-assets.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (actual, expected, message) => assert.ok(isDeepStrictEqual(actual, expected), message);
const key = (value) => String(value ?? "").toLowerCase();
const kind = (value) => value === "toolset" ? "tool-set" : value;
const empty = (value) => value == null || Object.keys(value).length === 0 ? null : value;
const knownKeys = (value, allowed, description) => {
  const unknown = Object.keys(value).filter((field) => !allowed.includes(field));
  assert.ok(unknown.length === 0, `${description}: unsupported fields require an updated package exporter: ${unknown.join(", ")}.`);
};
const buttonKeys = ["id", "role", "sourceIdentity", "label", "tooltip", "executionTarget", "defaultSkinId",
  "defaultTextFitMode", "disabled", "activationAnimation", "activationBehavior", "toolSetParentId", "toolSetBehavior", "metadata"];
const recordKeys = ["schemaVersion", "ownerButtonId", "installId", "programId", "programName", "panelName", "label", "tooltip", "kind",
  "localPackagePath", "sourcePath", "runner", "runnerData", "executionTarget", "bridgeAction", "bridgeData", "stateQuery", "events",
  "children", "layout", "page", "sourceDisplayPath", "bundledSourceId", "bundledSourceVersion"];

export function packagePath(root, value) {
  assert.ok(typeof value === "string" && value && !/^(?:[A-Za-z]:|[\\/])/.test(value), `Unsafe package path: ${value}`);
  const parts = value.split(/[\\/]/);
  assert.ok(parts.every((part) => part && part !== "." && part !== ".." && !part.includes(":")), `Unsafe package path: ${value}`);
  const filename = resolve(root, ...parts);
  let cursor = resolve(root);
  for (const part of ["", ...parts]) {
    if (part) cursor = join(cursor, part);
    if (existsSync(cursor)) assert.ok(!lstatSync(cursor).isSymbolicLink(), `Package path traverses a link: ${cursor}`);
  }
  return filename;
}

function filesUnder(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    assert.ok(!entry.isSymbolicLink(), `Source contains a link: ${join(root, entry.name)}`);
    if (entry.name === "__pycache__" || /\.pyc$/i.test(entry.name)) return [];
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

/** Fresh capture only. Never infers identity from a visible label or changes donor files. */
export async function prepareProgramProfile({ programRoot, localRoot, outputRoot, ownerMap = {} }) {
  programRoot = resolve(programRoot);
  localRoot = resolve(localRoot);
  if (outputRoot) {
    outputRoot = resolve(outputRoot);
    for (const protectedRoot of [programRoot, localRoot]) {
      const rel = relative(realpathSync(protectedRoot), realpathSync(outputRoot));
      assert.ok(rel && (isAbsolute(rel) || rel === ".." || rel.startsWith(`..\\`) || rel.startsWith("../")),
        "Profile output must be a separate staging directory, outside the catalog and saved local state.");
    }
  }
  const snapshots = new Map();
  const read = (path) => {
    const bytes = readFileSync(path);
    const digest = sha256(bytes);
    if (snapshots.has(path)) assert.equal(snapshots.get(path), digest, `Input changed during capture: ${path}`);
    snapshots.set(path, digest);
    return bytes;
  };
  const json = (path) => JSON.parse(read(path).toString("utf8").replace(/^\uFEFF/, ""));
  const program = json(join(programRoot, "flowcell.program.json"));
  assert.equal(program.schemaVersion, 1, "Unsupported Program manifest schema.");
  const catalogRoot = packagePath(programRoot, program.gitScriptsFolder);
  const catalogFiles = filesUnder(catalogRoot);
  // Includes untracked companions: they must not pass donor validation and then
  // disappear because the release copy selected only Git-tracked files.
  for (const path of catalogFiles) read(path);
  const statePath = join(localRoot, "button-system/button-state.json");
  const donor = json(statePath);
  const target = { kind: "program", programName: program.label, panelName: null };
  const placements = listThemePlacements(donor, target);
  assert.ok(placements.length, `${program.label}: no saved Program setup exists in the supplied local root; cannot certify a matching ZIP.`);
  const localProgram = packagePath(localRoot, `Programs/${programRoot.split(/[\\/]/).at(-1)}`);
  const recordsRoot = packagePath(localProgram, program.panelsFolder);
  const panelFolders = readdirSync(recordsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const recordFiles = filesUnder(recordsRoot).filter((path) => path.endsWith(".flowcell-source.json"));
  const records = new Map();
  for (const path of recordFiles) {
    const record = json(path);
    assert.ok(!records.has(record.ownerButtonId), `${program.label}: duplicate active owner ${record.ownerButtonId}.`);
    records.set(record.ownerButtonId, record);
  }
  const catalog = program.bundledSources.map((source) => {
    let selected = packagePath(programRoot, source.sourcePath);
    const folder = statSync(selected).isDirectory() ? selected : dirname(selected);
    const manifestName = kind(source.importKind) === "tool-set" ? "flowcell.toolset.json" : "flowcell.script.json";
    if (statSync(selected).isDirectory()) selected = join(selected, manifestName);
    else if (existsSync(join(folder, manifestName))) selected = join(folder, manifestName);
    const manifest = /[/\\]flowcell\.(?:script|toolset)\.json$/i.test(selected) ? json(selected) : null;
    const entry = manifest ? packagePath(folder, manifest.source) : selected;
    const bytes = read(entry);
    return { source, manifest, entry, folder, digest: sha256(bytes) };
  });
  const descriptors = [];
  const matched = new Map();
  const sourceChecks = [];
  const sourceIssues = [];
  const sourceOverrides = new Map();
  const generatedFiles = new Map();
  const sourceTrees = new Map();
  const staged = structuredClone(program);
  const owners = Object.values(donor.buttons).filter((button) =>
    !button.toolSetParentId && key(button.sourceIdentity?.displayProgramName) === key(program.label));
  assert.ok(owners.length, `${program.label}: no installed source owners were found.`);
  for (const owner of owners) {
    try {
    knownKeys(owner, buttonKeys, `${program.label}/${owner.id}`);
    for (const child of Object.values(donor.buttons).filter((button) => button.toolSetParentId === owner.id)) {
      knownKeys(child, buttonKeys, `${program.label}/${owner.id}/${child.id}`);
    }
    const record = records.get(owner.id);
    assert.ok(record, `${program.label}: ${owner.id} has no active source record; synchronize that source before packaging.`);
    knownKeys(record, recordKeys, `${program.label}/${owner.id} active source`);
    for (const child of record.children ?? []) knownKeys(child, ["slot", "label", "tooltip", "payload", "executionTarget"],
      `${program.label}/${owner.id}/${child.slot} active child`);
    assert.equal(record.schemaVersion, 1, `${owner.id}: unsupported active source record schema.`);
    assert.equal(key(record.programId), key(program.programId), `${owner.id}: active Program identity differs.`);
    const installedRoot = packagePath(localProgram, `${program.localScriptsFolder}/${record.installId}`);
    const install = json(join(installedRoot, "flowcell.install.json"));
    assert.equal(install.ownerButtonId, owner.id, `${owner.id}: installed owner differs.`);
    const installedEntry = packagePath(installedRoot, install.sourceRelativePath);
    const installedHash = sha256(read(installedEntry));
    const declared = record.bundledSourceId ?? install.bundledSourceId ?? ownerMap[owner.id]?.sourceId;
    const candidates = catalog.filter(({ source, manifest, digest }) =>
      (declared ? source.id === declared : digest === installedHash) &&
      kind(source.importKind) === kind(record.kind) && key(source.panelName) === key(record.panelName) &&
      (!manifest || isDeepStrictEqual(empty(manifest.bridgeData), empty(record.bridgeData))));
    assert.equal(candidates.length, 1,
      `${program.label}: ${owner.id} (${owner.label}) has ${candidates.length} matching catalog sources. Add/synchronize its source and command metadata; ambiguous legacy identities require an audited --owner-map.`);
    const candidate = candidates[0];
    const { source, entry, folder } = candidate;
    let { manifest } = candidate;
    assert.equal(candidate.digest, installedHash, `${program.label}: ${source.id} script bytes differ from the installed source. Synchronize the catalog before packaging.`);
    assert.ok(!matched.has(source.id), `${program.label}: ${source.id} has multiple installed owners; the catalog must declare each distinct installation.`);
    matched.set(source.id, owner.id);
    assert.equal(record.runner, program.runner.kind, `${source.id}: runner differs.`);
    if (!manifest) {
      assert.ok(!record.page && !record.stateQuery && !record.children.length,
        `${source.id}: a plain script cannot capture page or tool-set-only declarations.`);
      // A legacy plain script may have real bridge data that was never in the
      // catalog (for example distinct forward/back commands). Preserve it as a
      // standard package manifest without parsing or rewriting its script.
      const portableWindows = record.runnerData?.runner === "windows-script";
      assert.ok(!portableWindows || (!record.page && !empty(record.executionTarget) && !empty(record.bridgeData) && !empty(record.events)),
        `${source.id}: portable Windows scripts cannot combine page, core execution, bridge data, or events.`);
      manifest = { schemaVersion: 1, id: source.id, label: record.label || owner.label,
        tooltip: record.tooltip ?? "", program: portableWindows ? "*" : program.label, source: basename(entry),
        ...(empty(record.bridgeData) ? { bridgeData: record.bridgeData } : {}),
        ...(empty(record.runnerData) ? { execution: record.runnerData } : {}),
        ...(empty(record.events) ? { events: record.events } : {}),
        ...(empty(record.executionTarget) ? { executionTarget: record.executionTarget } : {}) };
      const relativeRoot = `${program.gitScriptsFolder}/.profile-sources/${sha256(source.id)}`;
      assert.ok(!existsSync(packagePath(programRoot, relativeRoot)), `${source.id}: generated profile source path already exists in the catalog.`);
      staged.bundledSources.find((entry) => entry.id === source.id).sourcePath = relativeRoot;
      generatedFiles.set(`${relativeRoot}/flowcell.script.json`, Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
      generatedFiles.set(`${relativeRoot}/${manifest.source}`, read(entry));
      sourceOverrides.set(source.id, { sourcePath: entry, manifestPath: join(folder, "flowcell.script.json"), manifest });
    }
    for (const [field, expected] of Object.entries({ runnerData: manifest?.execution, stateQuery: manifest?.stateQuery,
      events: manifest?.events, executionTarget: manifest?.page ? { kind: "core-action", actionId: "open-installed-page", payload: { pageId: manifest.page.id } } : manifest?.executionTarget })) {
      same(empty(record[field]), empty(expected), `${source.id}: installed ${field} differs from the catalog.`);
    }
    same(record.children.map((child) => ({ slot: child.slot, payload: empty(child.payload), executionTarget: empty(child.executionTarget) })),
      (manifest?.children ?? []).map((child) => ({ slot: child.slot, payload: empty(child.payload), executionTarget: empty(child.executionTarget) })),
      `${source.id}: child commands or payloads differ from the catalog.`);
    // Check every installed companion, including future helpers, not only the entry script.
    const installedSourceRoot = packagePath(installedRoot, "source");
    const installedManifest = ["flowcell.toolset.json", "flowcell.script.json"].map((name) => join(installedSourceRoot, name)).find(existsSync);
    const localManifest = installedManifest ? json(installedManifest) : null;
    same(empty(localManifest?.page), empty(manifest.page), `${source.id}: installed page declaration differs from the catalog.`);
    // Native InstalledPageWindow deserialization defaults this optional flag.
    const expectedPage = manifest.page ? { ...manifest.page, window: { ...manifest.page.window,
      alwaysOnTop: manifest.page.window?.alwaysOnTop ?? false } } : null;
    same(empty(record.page), expectedPage, `${source.id}: active page declaration differs from the catalog.`);
    const appearanceFiles = new Set(Object.values(localManifest?.appearance?.skins ?? {}).flatMap((skin) =>
      [skin.file, ...Object.values(skin.variants ?? {})]).map((path) => path.replaceAll("\\", "/")));
    const companionFiles = filesUnder(installedSourceRoot);
    sourceTrees.set(installedSourceRoot, companionFiles);
    const packageCompanions = [];
    for (const file of companionFiles) {
      const rel = relative(installedSourceRoot, file).replaceAll("\\", "/");
      if (file === installedManifest || appearanceFiles.has(rel)) { read(file); continue; }
      const counterpart = file === installedEntry ? entry : packagePath(folder, rel);
      assert.ok(existsSync(counterpart), `${source.id}: installed companion is missing from the catalog: ${rel}`);
      assert.equal(sha256(read(file)), sha256(read(counterpart)), `${source.id}: companion differs from the catalog: ${rel}`);
      packageCompanions.push(rel);
    }
    if (candidate.manifest) {
      const packagedAppearance = new Set(Object.values(manifest.appearance?.skins ?? {}).flatMap((skin) =>
        [skin.file, ...Object.values(skin.variants ?? {})]).map((path) => path.replaceAll("\\", "/")));
      const catalogFiles = filesUnder(folder);
      sourceTrees.set(folder, catalogFiles);
      const catalogCompanions = catalogFiles.map((file) => relative(folder, file).replaceAll("\\", "/")).filter((rel) =>
        !["flowcell.toolset.json", "flowcell.script.json"].includes(rel) && !packagedAppearance.has(rel));
      same(packageCompanions.sort(), catalogCompanions.sort(), `${source.id}: installed and catalog companion inventories differ. ` +
        `Only installed: ${packageCompanions.filter((path) => !catalogCompanions.includes(path)).join(", ") || "none"}; ` +
        `only catalog: ${catalogCompanions.filter((path) => !packageCompanions.includes(path)).join(", ") || "none"}.`);
    } else {
      assert.equal(packageCompanions.length, 1, `${source.id}: a plain source has companions requiring a declared catalog package.`);
    }
    sourceChecks.push({ sourceId: source.id, sha256: installedHash, companionFiles: companionFiles.length });
    descriptors.push({ ownerButtonId: owner.id, programName: program.label, programId: program.programId,
      panelName: source.panelName, sourceId: source.id, sourceVersion: source.version, sourceName: owner.label,
      importKind: kind(source.importKind), slots: record.children.map((child) => child.slot) });
    } catch (error) {
      sourceIssues.push(String(error.message).slice(0, 768));
    }
  }
  assert.equal(sourceIssues.length, 0, `${program.label}: source parity failed for ${sourceIssues.length} installed owner(s):\n${sourceIssues.join("\n")}`);
  const libraryRoot = join(localRoot, "Button editor/Skins");
  const paths = filesUnder(libraryRoot);
  const embedded = await embedLocalButtonSkinFamilies(donor, placements.map((placement) => placement.id),
    async () => ({ directory: libraryRoot, paths, read: async (path) => read(path).toString("utf8") }));
  for (const placement of placements) {
    const button = donor.buttons[placement.buttonId];
    const original = donor.skins[placement.skinOverrideId ?? button.defaultSkinId];
    if (typeof original?.metadata.buttonSkinFamily === "string") {
      const result = embedded.skins[embedded.placements[placement.id].skinOverrideId ?? embedded.buttons[button.id].defaultSkinId];
      assert.ok(Object.keys(result.metadata.buttonSkinEmbeddedVariants ?? {}).length,
        `${program.label}: skin family '${original.metadata.buttonSkinFamily}' is unavailable; cannot copy its future label variants.`);
    }
  }
  const savedAt = statSync(statePath).mtime.toISOString();
  const theme = capturePortableTheme({ document: embedded, descriptors, target,
    id: `${program.programId}-packaged-default-appearance`, name: `${program.label} — Packaged Setup`, savedAt });
  theme.theme.savedAt = savedAt;
  const recipient = createProgramProfileRecipient(programRoot, theme, staged, sourceOverrides);
  const portableExecution = (target, owner, description) => {
    if (!target) return target;
    const result = structuredClone(target);
    const identity = owner.sourceIdentity;
    const scope = result.kind === "core-action" ? result.payload : result;
    if (scope && ["tool-set-action", "panel-script", "core-action"].includes(result.kind)) {
      for (const [field, expected] of Object.entries({ programName: identity.displayProgramName,
        panelName: identity.displayPanelName, fileName: identity.displayFileName,
        ownerFileName: identity.displayFileName, ownerButtonId: owner.id })) {
        if (Object.hasOwn(scope, field)) {
          assert.equal(scope[field], expected, `${description}: ${field} routes to another source.`);
          delete scope[field];
        }
      }
    }
    if (result.kind === "tool-set-action" || result.kind === "core-action") result.payload = empty(result.payload);
    if (!empty(result.events)) delete result.events;
    return result;
  };
  for (const descriptor of descriptors.filter((entry) => theme.dependencies.some((dep) => dep.sourceId === entry.sourceId))) {
    const fresh = recipient.descriptors.find((entry) => entry.sourceId === descriptor.sourceId);
    assert.ok(fresh, `${descriptor.sourceId}: clean installation is missing.`);
    const owner = donor.buttons[descriptor.ownerButtonId];
    const freshOwner = recipient.document.buttons[fresh.ownerButtonId];
    assert.equal(owner.disabled, freshOwner.disabled, `${descriptor.sourceId}: disabled state is not represented in the package.`);
    same(portableExecution(owner.executionTarget, owner, descriptor.sourceId),
      portableExecution(freshOwner.executionTarget, freshOwner, descriptor.sourceId), `${descriptor.sourceId}: saved owner execution differs.`);
    const localChildren = Object.values(donor.buttons).filter((button) => button.toolSetParentId === owner.id);
    const freshChildren = Object.values(recipient.document.buttons).filter((button) => button.toolSetParentId === fresh.ownerButtonId);
    assert.equal(localChildren.length, freshChildren.length, `${descriptor.sourceId}: saved child count differs.`);
    for (const child of localChildren) {
      const slot = child.metadata.toolSetSlot ?? child.executionTarget?.command;
      const copy = freshChildren.find((button) => (button.metadata.toolSetSlot ?? button.executionTarget?.command) === slot);
      assert.ok(copy, `${descriptor.sourceId}: saved slot '${slot}' is missing.`);
      same(child.toolSetBehavior, copy.toolSetBehavior, `${descriptor.sourceId}/${slot}: saved field behavior differs from the catalog.`);
      same(portableExecution(child.executionTarget, owner, `${descriptor.sourceId}/${slot}`),
        portableExecution(copy.executionTarget, freshOwner, `${descriptor.sourceId}/${slot}`), `${descriptor.sourceId}/${slot}: saved execution differs.`);
      assert.equal(child.disabled, copy.disabled, `${descriptor.sourceId}/${slot}: disabled state differs.`);
    }
    const unit = Object.values(donor.popoutUnits).find((unit) => unit.kind === "tool-set" && unit.ownerButtonId === owner.id);
    if (unit) {
      const freshUnit = Object.values(recipient.document.popoutUnits).find((unit) => unit.kind === "tool-set" && unit.ownerButtonId === fresh.ownerButtonId);
      const fields = (unit, owner) => (unit?.fields ?? []).map(({ x, y, width, height, zIndex, ...field }) =>
        field.serviceTarget ? { ...field, serviceTarget: portableExecution(field.serviceTarget, owner, `${descriptor.sourceId}/${field.id}`) } : field);
      same(fields(unit, owner), fields(freshUnit, freshOwner), `${descriptor.sourceId}: saved field definitions/defaults differ from the catalog.`);
    }
  }
  const packed = encodeProgramDefaultTheme(theme);
  assertSelfContainedProgramAppearance(packed);
  const serialized = JSON.stringify(packed, null, 2) + "\n";
  assert.ok(Buffer.byteLength(serialized) <= 16 * 1024 * 1024, `${program.label}: packaged appearance exceeds 16 MiB.`);
  staged.defaultTheme = `${program.supportScriptsFolder}/default-appearance.flowcell-theme.json`;
  staged.bundledSources.forEach((source) => {
    assert.ok(!source.required || matched.has(source.id), `${source.id}: required source is absent from the saved setup.`);
    source.installOnAdd = matched.has(source.id);
  });
  const selectedPanels = new Set(descriptors.map((entry) => key(entry.panelName)));
  for (const name of panelFolders) {
    assert.ok(staged.panels.some((panel) => key(panel.label) === key(name)),
      `${program.label}: installed panel '${name}' is absent from the catalog; declare it before packaging.`);
    selectedPanels.add(key(name));
  }
  staged.panels.forEach((panel) => { panel.defaultSelected = selectedPanels.has(key(panel.label)); });
  staged.defaultPanels = staged.panels.filter((panel) => panel.defaultSelected).map((panel) => panel.label);
  // Verification accepts the would-be staged manifest, even in read-only mode.
  const roundtrip = verifyProgramProfileRoundTrip({ programRoot, appearance: packed, program: staged, sourceOverrides });
  await verifyProgramSelectedSourcesRoundTrip({ programRoot, appearance: packed, program: staged, sourceOverrides });
  same(filesUnder(recordsRoot).filter((path) => path.endsWith(".flowcell-source.json")), recordFiles,
    `${program.label}: source records changed during capture.`);
  same(filesUnder(libraryRoot), paths, `${program.label}: the skin library changed during capture.`);
  same(readdirSync(recordsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(),
    panelFolders, `${program.label}: panel folders changed during capture.`);
  same(filesUnder(catalogRoot), catalogFiles, `${program.label}: catalog files changed during capture.`);
  for (const [directory, files] of sourceTrees) same(filesUnder(directory), files, `Source files changed during capture: ${directory}`);
  for (const [path, digest] of snapshots) assert.equal(sha256(readFileSync(path)), digest, `Input changed during capture: ${path}`);
  if (outputRoot) {
    for (const path of [join(programRoot, "flowcell.program.json"), ...catalogFiles]) {
      const rel = relative(programRoot, path).replaceAll("\\", "/");
      const copied = packagePath(outputRoot, rel);
      assert.ok(existsSync(copied), `${program.label}: staged package omitted catalog file '${rel}'. Track it before release.`);
      assert.equal(sha256(readFileSync(copied)), snapshots.get(path), `${program.label}: staged file differs from verified source: ${rel}`);
    }
  }
  const report = { schemaVersion: 1, programId: program.programId, donorRevision: donor.revision,
    donorStateSha256: snapshots.get(statePath), appearanceSha256: sha256(serialized), ...roundtrip, sources: sourceChecks };
  if (outputRoot) {
    for (const [relativePath, bytes] of generatedFiles) {
      const output = packagePath(outputRoot, relativePath);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, bytes);
    }
    const output = packagePath(outputRoot, staged.defaultTheme);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, serialized);
    writeFileSync(packagePath(outputRoot, `${program.supportScriptsFolder}/default-appearance-provenance.json`), JSON.stringify(report, null, 2) + "\n");
    writeFileSync(join(outputRoot, "flowcell.program.json"), JSON.stringify(staged, null, 2) + "\n");
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = new Map();
  for (let i = 2; i < process.argv.length; i++) {
    const flag = process.argv[i];
    assert.ok(["--program-root", "--local-root", "--output-root", "--owner-map"].includes(flag) && !options.has(flag), `Unknown or duplicate option: ${flag}`);
    assert.ok(process.argv[i + 1] && !process.argv[i + 1].startsWith("--"), `Missing value for ${flag}.`);
    options.set(flag, process.argv[++i]);
  }
  assert.ok(options.get("--program-root") && options.get("--local-root"), "Specify --program-root and --local-root. Omit --output-root for a read-only verification.");
  try {
    const report = await prepareProgramProfile({ programRoot: options.get("--program-root"), localRoot: options.get("--local-root"),
      outputRoot: options.get("--output-root"), ownerMap: options.has("--owner-map") ? JSON.parse(readFileSync(options.get("--owner-map"), "utf8").replace(/^\uFEFF/, "")) : {} });
    console.log(JSON.stringify(report));
  } catch (error) {
    console.error(`[Program package parity] ${error.message}`);
    process.exitCode = 1;
  }
}
