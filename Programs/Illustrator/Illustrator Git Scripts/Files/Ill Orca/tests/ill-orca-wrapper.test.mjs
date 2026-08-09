import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const testsRoot = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testsRoot, "..");
const sourcePath = path.join(packageRoot, "Ill Orca.jsx");
const manifestPath = path.join(packageRoot, "flowcell.script.json");
const illustratorRoot = path.resolve(packageRoot, "../../..");
const programManifest = JSON.parse(
  readFileSync(path.join(illustratorRoot, "flowcell.program.json"), "utf8")
);
const localRegistration = JSON.parse(
  readFileSync(
    path.resolve(illustratorRoot, "../../flowcellbackend/local/program-registration/illustrator.json"),
    "utf8"
  )
);
const source = readFileSync(sourcePath, "utf8");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function loadTestApi({ evaluate } = {}) {
  const globalObject = { __FLOWCELL_ILL_ORCA_TEST__: true };
  const context = {
    $: {
      global: globalObject,
      evalFile: evaluate ?? (() => "delegated")
    }
  };
  const executable = source.replace(/^\s*#target\s+illustrator\s*/i, "");
  vm.createContext(context);
  vm.runInContext(executable, context, { filename: sourcePath });
  return { api: globalObject.__FLOWCELL_ILL_ORCA_TEST_API__, globalObject };
}

test("Ill Orca is an ordinary completion-waiting Illustrator script package", () => {
  assert.deepEqual(manifest, {
    schemaVersion: 1,
    id: "illustrator.ill-orca",
    label: "Ill Orca",
    tooltip: "Send selected Illustrator artwork through the installed SVG-to-Blender workflow, then continue to OrcaSlicer.",
    program: "Illustrator",
    source: "Ill Orca.jsx",
    execution: { waitForCompletion: true }
  });
});

test("fresh installs expose Ill Orca in Illustrator Files with the SVG owner dependency", () => {
  const contribution = programManifest.bundledSources.find(({ id }) => id === "illustrator.ill-orca");
  assert.deepEqual(contribution, {
    id: "illustrator.ill-orca",
    version: "1.0.0",
    panelName: "Files",
    sourcePath: "Illustrator Git Scripts/Files/Ill Orca/Ill Orca.jsx",
    importKind: "script",
    displayLabel: "Ill Orca",
    sourceKind: "script",
    required: false,
    dependencies: ["illustrator.send-svg-to-blender"],
    installEffects: ["Installs the selected-artwork SVG, Blender, and Orca handoff Button into Files."],
    installIfMissing: true,
    installOnAdd: true,
    legacyMatchLabel: "Ill Orca",
    legacyMatchKind: "script"
  });
  assert.deepEqual(
    localRegistration.enabledSources.find(({ sourceId }) => sourceId === "illustrator.ill-orca"),
    { sourceId: "illustrator.ill-orca", panelName: "Files", version: "1.0.0" }
  );
});

test("wrapper discovers the installed owner through generic program and active-record contracts", () => {
  assert.match(source, /TARGET_BUNDLED_SOURCE_ID = "illustrator\.send-svg-to-blender"/);
  assert.match(source, /PROGRAM_MANIFEST_NAME = "flowcell\.program\.json"/);
  assert.match(source, /ACTIVE_RECORD_SUFFIX = "\.flowcell-source\.json"/);
  assert.match(source, /programManifest\.panelsFolder/);
  assert.match(source, /programManifest\.localScriptsFolder/);
  assert.match(source, /record\.bundledSourceId/);
  assert.match(source, /candidates\.length === 0/);
  assert.match(source, /candidates\.length > 1/);
  assert.match(source, /sourceManifest\.id/);
  assert.match(source, /isInsidePath\(sourceFile, sourceRoot\)/);
  assert.doesNotMatch(source, /button-migrated-fae9a3bcb6cfb288/);
});

test("wrapper sets the installed path and Orca action only for the delegated evaluation", () => {
  let observed;
  const { api, globalObject } = loadTestApi({
    evaluate(file) {
      observed = {
        file,
        scriptPath: globalObject.FLOWCELL_SCRIPT_PATH,
        postAction: globalObject.FLOWCELL_SEND_SVG_POST_ACTION
      };
      return "main-result";
    }
  });
  globalObject.FLOWCELL_SCRIPT_PATH = "C:\\owner\\source\\Ill Orca.jsx";
  globalObject.FLOWCELL_SEND_SVG_POST_ACTION = "previous-action";
  const mainFile = { fsName: "C:\\main-owner\\source\\18_Prepare_Selected_OBJ_Export.jsx" };

  assert.equal(api.delegateToInstalledSendSvg(mainFile, globalObject), "main-result");
  assert.equal(observed.file, mainFile);
  assert.equal(observed.scriptPath, mainFile.fsName);
  assert.equal(observed.postAction, "orca");
  assert.equal(globalObject.FLOWCELL_SCRIPT_PATH, "C:\\owner\\source\\Ill Orca.jsx");
  assert.equal(globalObject.FLOWCELL_SEND_SVG_POST_ACTION, "previous-action");
});

test("wrapper restores absent globals when delegated evaluation throws", () => {
  const { api, globalObject } = loadTestApi({
    evaluate() {
      throw new Error("main failed");
    }
  });
  delete globalObject.FLOWCELL_SCRIPT_PATH;
  delete globalObject.FLOWCELL_SEND_SVG_POST_ACTION;

  assert.throws(
    () => api.delegateToInstalledSendSvg({ fsName: "C:\\main.jsx" }, globalObject),
    /main failed/
  );
  assert.equal(Object.hasOwn(globalObject, "FLOWCELL_SCRIPT_PATH"), false);
  assert.equal(Object.hasOwn(globalObject, "FLOWCELL_SEND_SVG_POST_ACTION"), false);
});

test("fallback JSON parser is data-only and rejects reserved object keys", () => {
  const { api } = loadTestApi();
  const parsed = api.parseJsonFallback(
    '{"schemaVersion":1,"sourcePath":"Illustrator Local Scripts\\\\owner\\\\source\\\\main.jsx"}',
    "fixture"
  );
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.sourcePath, "Illustrator Local Scripts\\owner\\source\\main.jsx");
  assert.throws(
    () => api.parseJsonFallback('{"__proto__":{}}', "fixture"),
    /reserved object key/
  );
});

test("Ill Orca contains no duplicate SVG export or Blender handoff implementation", () => {
  assert.match(source, /return \$\.evalFile\(sourceFile\)/);
  assert.doesNotMatch(source, /ExportOptionsSVG|SVGDTDVersion|send-svg-to-blender\.request|Send-SVG-To-Blender\.vbs/);
  assert.doesNotMatch(source, /app\.documents\.add|exportFile\(/);
});
