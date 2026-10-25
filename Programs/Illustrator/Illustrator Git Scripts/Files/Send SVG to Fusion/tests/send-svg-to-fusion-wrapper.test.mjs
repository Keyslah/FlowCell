import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const testsRoot = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testsRoot, "..");
const sourcePath = path.join(packageRoot, "Send SVG to Fusion.jsx");
const manifestPath = path.join(packageRoot, "flowcell.script.json");
const illustratorRoot = path.resolve(packageRoot, "../../..");
const sendSvgRoot = path.resolve(packageRoot, "../Send SVG to Blender");
const programManifest = JSON.parse(
  readFileSync(path.join(illustratorRoot, "flowcell.program.json"), "utf8")
);
const source = readFileSync(sourcePath, "utf8");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function loadTestApi({ evaluate } = {}) {
  const globalObject = { __FLOWCELL_SEND_SVG_TO_FUSION_TEST__: true };
  const context = {
    $: {
      global: globalObject,
      evalFile: evaluate ?? (() => "delegated")
    }
  };
  const executable = source.replace(/^\s*#target\s+illustrator\s*/i, "");
  vm.createContext(context);
  vm.runInContext(executable, context, { filename: sourcePath });
  return { api: globalObject.__FLOWCELL_SEND_SVG_TO_FUSION_TEST_API__, globalObject };
}

test("Send SVG to Fusion is an ordinary completion-waiting Illustrator script package", () => {
  assert.deepEqual(manifest, {
    schemaVersion: 1,
    id: "illustrator.send-svg-to-fusion",
    label: "Send SVG to Fusion",
    tooltip: "Send selected Illustrator artwork through the installed SVG export workflow, then import and extrude it in Fusion 360.",
    program: "Illustrator",
    source: "Send SVG to Fusion.jsx",
    execution: { waitForCompletion: true }
  });
});

test("fresh installs expose Send SVG to Fusion in Illustrator Files with the SVG owner dependency", () => {
  const svgContribution = programManifest.bundledSources.find(({ id }) => id === "illustrator.send-svg-to-blender");
  const contribution = programManifest.bundledSources.find(({ id }) => id === "illustrator.send-svg-to-fusion");
  // 1.3.0 is the first Send SVG package that carries the Fusion handoff.
  assert.equal(svgContribution.version, "1.3.0");
  assert.deepEqual(contribution, {
    id: "illustrator.send-svg-to-fusion",
    version: "1.0.0",
    panelName: "Files",
    sourcePath: "Illustrator Git Scripts/Files/Send SVG to Fusion/Send SVG to Fusion.jsx",
    importKind: "script",
    displayLabel: "Send SVG to Fusion",
    sourceKind: "script",
    required: false,
    dependencies: ["illustrator.send-svg-to-blender"],
    installEffects: ["Installs the selected-artwork SVG, Fusion 360 import, and extrude handoff Button into Files."],
    installIfMissing: true,
    installOnAdd: true,
    legacyMatchLabel: "Send SVG to Fusion",
    legacyMatchKind: "script"
  });
  for (const name of ["Send-SVG-To-Fusion.vbs", "Send-SVG-To-Fusion.ps1"]) {
    assert.ok(existsSync(path.join(sendSvgRoot, name)), name);
  }
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

test("wrapper refuses an installed owner that predates the Fusion handoff", () => {
  assert.match(source, /FUSION_HANDOFF_NAME = "Send-SVG-To-Fusion\.vbs"/);
  assert.match(
    source,
    /new File\(sourceRoot\.fsName \+ "\/" \+ FUSION_HANDOFF_NAME\)\.exists[\s\S]*?predates Fusion support/
  );
  assert.ok(source.indexOf("FUSION_HANDOFF_NAME).exists") < source.indexOf("return sourceFile;"));
});

test("wrapper sets the installed path and Fusion target only for the delegated evaluation", () => {
  let observed;
  const { api, globalObject } = loadTestApi({
    evaluate(file) {
      observed = {
        file,
        scriptPath: globalObject.FLOWCELL_SCRIPT_PATH,
        target: globalObject.FLOWCELL_SEND_SVG_TARGET,
        postAction: globalObject.FLOWCELL_SEND_SVG_POST_ACTION
      };
      return "main-result";
    }
  });
  globalObject.FLOWCELL_SCRIPT_PATH = "C:\\owner\\source\\Send SVG to Fusion.jsx";
  globalObject.FLOWCELL_SEND_SVG_TARGET = "previous-target";
  const mainFile = { fsName: "C:\\main-owner\\source\\18_Prepare_Selected_OBJ_Export.jsx" };

  assert.equal(api.delegateToInstalledSendSvg(mainFile, globalObject), "main-result");
  assert.equal(observed.file, mainFile);
  assert.equal(observed.scriptPath, mainFile.fsName);
  assert.equal(observed.target, "fusion");
  assert.equal(observed.postAction, undefined);
  assert.equal(globalObject.FLOWCELL_SCRIPT_PATH, "C:\\owner\\source\\Send SVG to Fusion.jsx");
  assert.equal(globalObject.FLOWCELL_SEND_SVG_TARGET, "previous-target");
});

test("wrapper restores absent globals when delegated evaluation throws", () => {
  const { api, globalObject } = loadTestApi({
    evaluate() {
      throw new Error("main failed");
    }
  });
  delete globalObject.FLOWCELL_SCRIPT_PATH;
  delete globalObject.FLOWCELL_SEND_SVG_TARGET;

  assert.throws(
    () => api.delegateToInstalledSendSvg({ fsName: "C:\\main.jsx" }, globalObject),
    /main failed/
  );
  assert.equal(Object.hasOwn(globalObject, "FLOWCELL_SCRIPT_PATH"), false);
  assert.equal(Object.hasOwn(globalObject, "FLOWCELL_SEND_SVG_TARGET"), false);
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

test("Send SVG to Fusion contains no duplicate SVG export or Fusion handoff implementation", () => {
  assert.match(source, /return \$\.evalFile\(sourceFile\)/);
  assert.doesNotMatch(source, /ExportOptionsSVG|SVGDTDVersion|send-svg-to-fusion\.request|importSVG/);
  assert.doesNotMatch(source, /app\.documents\.add|exportFile\(/);
});
