import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { embedLocalButtonSkinFamilies } from "../FlowCellFrontend/tests/.compiled-button-system/button/editor/toolsetPackageExport.js";
import { listThemePlacements } from "../FlowCellFrontend/tests/.compiled-button-system/theme/themeModel.js";
import { capturePortableTheme } from "../FlowCellFrontend/tests/.compiled-button-system/theme/portableTheme.js";
import { encodeProgramDefaultTheme } from "../FlowCellFrontend/tests/.compiled-button-system/pages/program-setup/programDefaultTheme.js";

// Compile the existing test modules first: npx tsc -p tsconfig.button-tests.json.
// The owner map must be audited against each installed source and command payload;
// matching a visible label alone is insufficient (for example the five Snap commands).
const options = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const flag = process.argv[index];
  assert.ok(["--local-root", "--owner-map", "--write"].includes(flag), `Unknown option: ${flag}`);
  assert.ok(!options.has(flag), `Duplicate option: ${flag}`);
  options.set(flag, flag === "--write" ? true : process.argv[++index]);
}
assert.ok(options.get("--local-root") && options.get("--owner-map"),
  "Specify --local-root and --owner-map; the default action checks without writing.");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const programRoot = join(repoRoot, "Programs/Blender");
const localRoot = resolve(options.get("--local-root"));
const donorPath = join(localRoot, "button-system/button-state.json");
const donorBytes = await readFile(donorPath);
const donor = JSON.parse(donorBytes.toString("utf8").replace(/^\uFEFF/, ""));
const donorStat = await stat(donorPath);
const ownerMap = JSON.parse((await readFile(options.get("--owner-map"), "utf8")).replace(/^\uFEFF/, ""));
const program = JSON.parse(await readFile(join(programRoot, "flowcell.program.json"), "utf8"));
const target = { kind: "program", programName: "Blender", panelName: null };
const placements = listThemePlacements(donor, target);
const descriptors = Object.entries(ownerMap).map(([ownerButtonId, saved]) => {
  const source = program.bundledSources.find((entry) => entry.id === saved.sourceId);
  assert.ok(source, `Missing audited source '${saved.sourceId}'.`);
  const owner = donor.buttons[ownerButtonId];
  assert.ok(owner, `Missing donor owner '${ownerButtonId}'.`);
  assert.equal(owner.sourceIdentity.displayPanelName, source.panelName);
  const slots = Object.values(donor.buttons).filter((button) => button.toolSetParentId === ownerButtonId)
    .map((button) => button.metadata.toolSetSlot ?? button.executionTarget.command);
  return { ownerButtonId, programName: "Blender", programId: program.programId,
    panelName: source.panelName, sourceId: source.id, sourceVersion: source.version,
    sourceName: saved.label, importKind: source.importKind, slots };
});
const directory = join(localRoot, "Button editor/Skins");
const paths = [];
for (const entry of await readdir(directory, { withFileTypes: true })) {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) {
    for (const file of await readdir(path)) paths.push(join(path, file));
  } else paths.push(path);
}
const embedded = await embedLocalButtonSkinFamilies(donor, placements.map((placement) => placement.id),
  async () => ({ directory, paths, read: (path) => readFile(path, "utf8") }));
const theme = capturePortableTheme({ document: embedded, descriptors, target,
  id: "blender-packaged-default-appearance", name: "Blender — This Computer",
  savedAt: donorStat.mtime.toISOString() });
theme.theme.savedAt = theme.savedAt;
const packed = encodeProgramDefaultTheme(theme);
const output = join(programRoot, program.defaultTheme);
const sourceHash = createHash("sha256").update(donorBytes).digest("hex");
const report = { schemaVersion: 1, donorRevision: donor.revision, donorStateSha256: sourceHash,
  dependencies: theme.dependencies.length, placements: theme.theme.buttons.length,
  surfaces: theme.surfaces.length, skins: Object.keys(packed.skins).length,
  skinSources: Object.keys(packed.skinSources).length,
  activationCycles: Object.values(theme.presentation).filter((entry) => entry.placement.activationCycle).length,
  sourceVersions: Object.fromEntries(theme.dependencies.map((entry) => [entry.sourceId, entry.sourceVersion])) };
const reportPath = join(programRoot, "SupportScripts/default-appearance-provenance.json");
assert.equal(createHash("sha256").update(await readFile(donorPath)).digest("hex"), sourceHash,
  "The donor changed during capture; rerun against one consistent saved revision.");
const serialized = JSON.stringify(packed, null, 2) + "\n";
assert.ok(Buffer.byteLength(serialized) <= 16 * 1024 * 1024, "The packaged appearance exceeds 16 MiB.");
if (options.get("--write")) {
  await writeFile(output, serialized);
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
} else {
  assert.ok(isDeepStrictEqual(JSON.parse(await readFile(output, "utf8")), packed),
    "The packaged Blender appearance differs from the audited donor.");
  assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report,
    "The packaged Blender provenance differs from the audited donor.");
}
const { sourceVersions: _versions, ...summary } = report;
console.log(JSON.stringify({ action: options.get("--write") ? "captured" : "verified", ...summary,
  bytes: (await stat(output)).size }));
