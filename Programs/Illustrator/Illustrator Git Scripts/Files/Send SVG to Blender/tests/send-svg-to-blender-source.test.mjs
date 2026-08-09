import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const testsRoot = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testsRoot, "..");
const jsxPath = path.join(packageRoot, "18_Prepare_Selected_OBJ_Export.jsx");
const source = readFileSync(jsxPath, "utf8");
const bridgePath = path.resolve(
  packageRoot,
  "../../../SupportScripts/Start-IllustratorFlowCellBridge.ps1"
);
const bridgeSource = readFileSync(bridgePath, "utf8");
const handoffPath = path.join(packageRoot, "Send-SVG-To-Blender.ps1");
const handoffSource = readFileSync(handoffPath, "utf8");
const blenderRegistryInstallerPath = path.resolve(
  packageRoot,
  "../../../../Blender/SupportScripts/Install-BlenderFlowCellButtons.ps1"
);
const blenderRegistryInstallerSource = readFileSync(blenderRegistryInstallerPath, "utf8");

function loadTestApi(postAction, appOverride) {
  const globalObject = { __FLOWCELL_SEND_SVG_TO_BLENDER_TEST__: true };
  const context = { $: { global: globalObject } };
  if (postAction !== undefined) {
    context.FLOWCELL_SEND_SVG_POST_ACTION = postAction;
  }
  if (appOverride !== undefined) {
    context.app = appOverride;
  }
  const executable = source.replace(/^\s*#target\s+illustrator\s*/i, "");
  vm.createContext(context);
  vm.runInContext(executable, context, { filename: jsxPath });
  return globalObject.__FLOWCELL_SEND_SVG_TO_BLENDER_TEST_API__;
}

function mockLayer(name, parent = { typename: "Document" }) {
  return { typename: "Layer", name, parent };
}

function mockItem(parent, typename = "PathItem") {
  return {
    typename,
    parent,
    duplicate() {},
    visibleBounds: [0, 10, 10, 0]
  };
}

test("extrusion comes only from a positive decimal parenthesized at the absolute beginning", () => {
  const { parseExtrudeMillimeters } = loadTestApi();

  assert.equal(parseExtrudeMillimeters("(9) Name"), 9);
  assert.equal(parseExtrudeMillimeters("(2.5) Name"), 2.5);

  for (const invalid of [
    " (9) Name",
    "   (3.25) Name",
    "V9 Name",
    "9 Name",
    "Name (9)",
    "(0) Name",
    "(0.0) Name",
    "(-2) Name",
    "(+2) Name",
    "(.5) Name",
    "(2.) Name",
    "( 2) Name",
    ""
  ]) {
    assert.equal(parseExtrudeMillimeters(invalid), 1, invalid);
  }
});

test("Illustrator point dimensions convert to physical millimeters", () => {
  const { pointsToMillimeters } = loadTestApi();

  assert.equal(pointsToMillimeters(72), 25.4);
  assert.equal(pointsToMillimeters(36), 12.7);
});

test("the optional Ill Orca marker is normalized without changing the normal button", () => {
  assert.equal(loadTestApi().requestedPostAction(), "none");
  assert.equal(loadTestApi("orca").requestedPostAction(), "orca");
  assert.equal(loadTestApi(" ORCA ").requestedPostAction(), "orca");
  assert.equal(loadTestApi("unsupported").requestedPostAction(), "none");
});

test("selection is grouped by nearest layer identity and ignores text cursors and ranges", () => {
  const { resolveExportGroups } = loadTestApi();
  const document = { typename: "Document" };
  const outerLayer = mockLayer("Outer", document);
  const firstLayer = mockLayer("(2.5) First:Part", outerLayer);
  const secondLayer = mockLayer("Second", outerLayer);
  const nestedGroup = { typename: "GroupItem", parent: firstLayer, clipped: false };
  const first = mockItem(nestedGroup);
  const second = mockItem(firstLayer);
  const third = mockItem(secondLayer);

  const groups = resolveExportGroups([
    first,
    { typename: "InsertionPoint", parent: firstLayer, duplicate() {} },
    second,
    { typename: "TextRange", parent: firstLayer, duplicate() {} },
    third
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].layer, firstLayer);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].layerName, "(2.5) First:Part");
  assert.equal(groups[0].fileName, "(2.5) First_Part");
  assert.equal(groups[0].extrudeMm, 2.5);
  assert.equal(groups[1].layer, secondLayer);
  assert.equal(groups[1].extrudeMm, 1);
});

test("multiple owner layers retain their centers relative to the combined Illustrator selection", () => {
  const { resolveExportGroups, pointsToMillimeters } = loadTestApi();
  const firstLayer = mockLayer("First");
  const secondLayer = mockLayer("Second");
  const first = mockItem(firstLayer);
  const second = mockItem(secondLayer);
  first.visibleBounds = [0, 10, 10, 0];
  second.visibleBounds = [20, 30, 30, 20];

  const groups = resolveExportGroups([first, second]);
  assert.equal(groups.length, 2);
  assert.ok(Math.abs(groups[0].offsetXmm - pointsToMillimeters(-10)) < 1e-12);
  assert.ok(Math.abs(groups[0].offsetYmm - pointsToMillimeters(-10)) < 1e-12);
  assert.ok(Math.abs(groups[1].offsetXmm - pointsToMillimeters(10)) < 1e-12);
  assert.ok(Math.abs(groups[1].offsetYmm - pointsToMillimeters(10)) < 1e-12);
  assert.ok(
    Math.abs((groups[1].offsetXmm - groups[0].offsetXmm) - pointsToMillimeters(20)) < 1e-12
  );
  assert.ok(
    Math.abs((groups[1].offsetYmm - groups[0].offsetYmm) - pointsToMillimeters(20)) < 1e-12
  );
});

test("selected compound paths and clipping groups remain the exact selected export objects", () => {
  const { normalizeSelectedPageItems } = loadTestApi();
  const layer = mockLayer("Cutout");
  const clippingGroup = mockItem(layer, "GroupItem");
  clippingGroup.clipped = true;
  const compound = mockItem(layer, "CompoundPathItem");

  const normalized = normalizeSelectedPageItems([clippingGroup, compound]);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0], clippingGroup);
  assert.equal(normalized[1], compound);
});

test("pre-Unite validation rejects visible clipping groups, including nested masks", () => {
  const { validateVectorArtwork } = loadTestApi();
  const layer = mockLayer("Stencil");
  const outerGroup = {
    typename: "GroupItem",
    parent: layer,
    hidden: false,
    clipped: false,
    pageItems: []
  };
  const clippingGroup = {
    typename: "GroupItem",
    parent: outerGroup,
    hidden: false,
    clipped: true,
    pageItems: []
  };
  const validPath = normalizedPath(outerGroup);
  outerGroup.pageItems.push(validPath, clippingGroup);

  assert.throws(
    () => validateVectorArtwork(
      { pageItems: [outerGroup], pathItems: [validPath] },
      "Stencil"
    ),
    /contains a visible clipping group/
  );
});

test("distinct owner layers may not collide after Windows filename sanitation", () => {
  const { resolveExportGroups, sanitizeFileName } = loadTestApi();
  const firstLayer = mockLayer("Part:One");
  const secondLayer = mockLayer("part?one");

  assert.equal(sanitizeFileName(" (9) Name"), "_ (9) Name");
  assert.equal(sanitizeFileName("  (9) A:Part?.  "), "_  (9) A_Part_");
  assert.equal(sanitizeFileName("CON"), "_CON");
  assert.throws(
    () => resolveExportGroups([mockItem(firstLayer), mockItem(secondLayer)]),
    /same SVG filename \(case-insensitive\)/
  );
});

test("request JSON carries physical dimensions, relative placement, and the requested post action", () => {
  const { buildRequestJson } = loadTestApi();
  const request = JSON.parse(buildRequestJson("request-1", [
    {
      filepath: "C:\\FlowCell\\runtime\\svg-exports\\(2.5) A.svg",
      layerName: "(2.5) A \"quoted\"",
      extrudeMm: 2.5,
      widthMm: 25.4,
      heightMm: 12.7,
      offsetXmm: -3.5,
      offsetYmm: 7.25
    }
  ], "orca"));

  assert.deepEqual(request, {
    schemaVersion: 1,
    requestId: "request-1",
    postAction: "orca",
    items: [{
      filepath: "C:\\FlowCell\\runtime\\svg-exports\\(2.5) A.svg",
      layerName: "(2.5) A \"quoted\"",
      extrudeMm: 2.5,
      widthMm: 25.4,
      heightMm: 12.7,
      offsetXmm: -3.5,
      offsetYmm: 7.25
    }]
  });
  assert.doesNotMatch(source, /\bJSON\s*\./);
});

test("line status parsing preserves equals signs and strips a UTF-8 BOM", () => {
  const { parseStatusText } = loadTestApi();
  assert.deepEqual(
    { ...parseStatusText("\ufeffRequestId=req=7\r\nStatus=Ok\r\nMessage=A=B\r\nImportedCount=2\r\n") },
    { RequestId: "req=7", Status: "Ok", Message: "A=B", ImportedCount: "2" }
  );
});

test("SVG 1.0 cleanup removes unresolved Adobe entities and supplies the SVG 1.0 doctype", () => {
  const { cleanSvg10Markup } = loadTestApi();
  const dirty = `<?xml version="1.0"?>
<svg version="1.0" xmlns="http://www.w3.org/2000/svg" xmlns:x="&ns_extend;" xmlns:i="&ns_ai;" xmlns:graph="&ns_graphs;">
  <path d="M0,0L1,1Z"/><g>\n</g>
</svg>`;
  const cleaned = cleanSvg10Markup(dirty);

  assert.match(cleaned, /<!DOCTYPE svg PUBLIC "-\/\/W3C\/\/DTD SVG 1\.0\/\/EN"/);
  assert.doesNotMatch(cleaned, /&ns_(?:extend|ai|graphs);/);
  assert.doesNotMatch(cleaned, /<g>\s*<\/g>/);
  assert.match(cleaned, /<path d="M0,0L1,1Z"\/>/);
});

function normalizedPath(parent, overrides = {}) {
  return {
    typename: "PathItem",
    parent,
    hidden: false,
    guides: false,
    closed: true,
    filled: true,
    stroked: false,
    clipping: false,
    ...overrides
  };
}

test("normalized vector validation preserves compound holes and disconnected islands", () => {
  const { validateNormalizedVectorArtwork } = loadTestApi();
  const layer = mockLayer("Stencil");
  const group = {
    typename: "GroupItem",
    parent: layer,
    hidden: false,
    clipped: false,
    pageItems: []
  };
  const island = normalizedPath(group);
  const compound = {
    typename: "CompoundPathItem",
    parent: group,
    hidden: false,
    pathItems: []
  };
  const outer = normalizedPath(compound);
  const hole = normalizedPath(compound);
  compound.pathItems.push(outer, hole);
  group.pageItems.push(island, compound);

  const result = validateNormalizedVectorArtwork({ pageItems: [group] }, "Stencil");
  assert.equal(result.pathCount, 3);
  assert.equal(result.compoundPathCount, 1);
});

test("open filled paths are explicitly closed before Pathfinder without releasing compound holes", () => {
  const { closeOpenFilledPathsForUnite } = loadTestApi();
  const layer = mockLayer("Stencil");
  const compound = {
    typename: "CompoundPathItem",
    parent: layer,
    hidden: false,
    pathItems: []
  };
  const openFilledPath = normalizedPath(compound, { closed: false });
  const existingHole = normalizedPath(compound);
  compound.pathItems.push(openFilledPath, existingHole);

  const result = closeOpenFilledPathsForUnite({ pageItems: [compound] }, "Stencil");
  assert.equal(result.closedPathCount, 1);
  assert.equal(openFilledPath.closed, true);
  assert.equal(compound.pathItems.length, 2);
  assert.equal(existingHole.closed, true);
});

test("normalized vector validation fails closed on open, unfilled, stroked, or clipped geometry", () => {
  const { validateNormalizedVectorArtwork } = loadTestApi();
  const layer = mockLayer("Bad stencil");

  for (const [overrides, message] of [
    [{ closed: false }, /left an open path/],
    [{ filled: false }, /left an unfilled path/],
    [{ stroked: true }, /left a stroked path/],
    [{ clipping: true }, /left a clipping path/]
  ]) {
    assert.throws(
      () => validateNormalizedVectorArtwork(
        { pageItems: [normalizedPath(layer, overrides)] },
        "Bad stencil"
      ),
      message
    );
  }
});

test("normalized vector validation rejects clipping groups and unresolved live artwork", () => {
  const { validateNormalizedVectorArtwork } = loadTestApi();
  const layer = mockLayer("Bad stencil");
  const clippedGroup = {
    typename: "GroupItem",
    parent: layer,
    hidden: false,
    clipped: true,
    pageItems: []
  };
  const plugin = {
    typename: "PluginItem",
    parent: layer,
    hidden: false
  };

  assert.throws(
    () => validateNormalizedVectorArtwork({ pageItems: [clippedGroup] }, "Bad stencil"),
    /left a clipping group/
  );
  assert.throws(
    () => validateNormalizedVectorArtwork({ pageItems: [plugin] }, "Bad stencil"),
    /unsupported live artwork: PluginItem/
  );
});

test("Pathfinder Unite and expansion are mandatory and command errors fail closed", () => {
  const layer = mockLayer("Stencil");
  const pathItem = normalizedPath(layer);
  const calls = [];
  const document = {
    pageItems: [pathItem],
    layers: [],
    selection: null,
    activate() {
      appMock.activeDocument = document;
    }
  };
  const appMock = {
    activeDocument: null,
    executeMenuCommand(command) {
      calls.push(command);
    }
  };
  const { uniteAndBakeVectorArtwork } = loadTestApi(undefined, appMock);

  uniteAndBakeVectorArtwork(document, "Stencil");
  assert.deepEqual(calls, ["Live Pathfinder Add", "expandStyle"]);

  appMock.executeMenuCommand = (command) => {
    throw new Error(`disabled: ${command}`);
  };
  assert.throws(
    () => uniteAndBakeVectorArtwork(document, "Stencil"),
    /could not complete Pathfinder Unite: disabled: Live Pathfinder Add/
  );
});

test("source enforces temporary vector cleanup, SVG 1.0 export, overwrite, and fixed handoff", () => {
  assert.match(source, /app\.documents\.add\(originalDocument\.documentColorSpace\)/);
  assert.match(source, /\.duplicate\(temporaryLayer, ElementPlacement\.PLACEATEND\)/);
  assert.match(source, /\.createOutline\(\)/);
  assert.match(source, /executeVectorCleanup\(temporaryDocument, "expandStyle"\)/);
  assert.match(source, /executeVectorCleanup\(temporaryDocument, "Live Outline Stroke"\)/);
  assert.match(source, /executeRequiredVectorCleanup\(documentRef, "Live Pathfinder Add", "Pathfinder Unite", layerName\)/);
  assert.match(source, /executeRequiredVectorCleanup\(documentRef, "expandStyle", "Pathfinder result expansion", layerName\)/);
  assert.match(source, /closeOpenFilledPathsForUnite\(temporaryDocument, group\.layerName\)/);
  assert.match(source, /validateNormalizedVectorArtwork\(documentRef, layerName\)/);
  assert.ok(source.indexOf('"Live Outline Stroke"') < source.indexOf("uniteAndBakeVectorArtwork(temporaryDocument"));
  assert.ok(source.indexOf("closeOpenFilledPathsForUnite(temporaryDocument") < source.indexOf("uniteAndBakeVectorArtwork(temporaryDocument"));
  assert.ok(source.indexOf("uniteAndBakeVectorArtwork(temporaryDocument") < source.indexOf("temporaryDocument.exportFile"));
  assert.match(source, /PathItem.*CompoundPathItem/s);
  assert.match(source, /PlacedItem, RasterItem, PluginItem/);
  assert.match(source, /paths\[i\]\.stroked === true/);
  assert.doesNotMatch(source, /releaseCompound|releaseMask|noCompoundPath/i);

  assert.match(source, /options\.DTD = SVGDTDVersion\.SVG1_0/);
  assert.match(source, /options\.cssProperties = SVGCSSPropertyLocation\.PRESENTATIONATTRIBUTES/);
  assert.match(source, /options\.fontType = SVGFontType\.OUTLINEFONT/);
  assert.match(source, /options\.embedRasterImages = false/);
  assert.match(source, /options\.preserveEditability = false/);
  assert.match(source, /options\.coordinatePrecision = SVG_COORDINATE_PRECISION/);
  assert.match(source, /exportBounds = getVisibleBounds/);
  assert.match(source, /\.artboardRect = exportBounds/);
  assert.match(source, /widthMm = pointsToMillimeters/);
  assert.match(source, /heightMm = pointsToMillimeters/);
  assert.match(source, /offsetXmm: group\.offsetXmm/);
  assert.match(source, /offsetYmm: group\.offsetYmm/);
  assert.match(source, /var postAction = requestedPostAction\(\)/);
  assert.match(source, /targetFile\.exists && !targetFile\.remove\(\)/);
  assert.ok(source.indexOf("targetFile.remove()") < source.indexOf("temporaryDocument.exportFile"));
  assert.match(source, /cleanExportedSvg\(targetFile\)/);

  assert.match(source, /runtimeFolder\.fsName \+ "\/svg-exports"/);
  assert.match(source, /send-svg-to-blender\.request\.json/);
  assert.match(source, /send-svg-to-blender\.status\.txt/);
  assert.match(source, /Send-SVG-To-Blender\.vbs/);
  assert.match(source, /RequestId=/);
  assert.match(source, /Status=Pending/);
  assert.match(source, /status\.RequestId !== requestId/);
  assert.match(source, /ownerPaths\.handoffFile\.execute\(\)/);
  assert.match(source, /\$\.sleep\(STATUS_POLL_MS\)/);
  assert.match(source, /typeof FLOWCELL_SCRIPT_PATH !== "undefined"/);
  assert.match(bridgeSource, /var FLOWCELL_SCRIPT_PATH =/);
});

test("Illustrator bridge does not replay DoJavaScriptFile runtime failures through script text", () => {
  assert.match(
    bridgeSource,
    /function Test-IsUnavailableDoJavaScriptFileMember[\s\S]*?FullyQualifiedErrorId[\s\S]*?MethodNotFound[\s\S]*?DoJavaScriptFile/
  );
  assert.match(
    bridgeSource,
    /catch \{\s*if \(Test-IsStaleIllustratorComError[^}]+\}\s*if \(-not \(Test-IsUnavailableDoJavaScriptFileMember -ErrorRecord \$_\)\) \{ throw \}/
  );
  assert.doesNotMatch(bridgeSource, /DoJavaScriptFile failed[^\r\n]*retrying from script text/);
});

test("all temporary documents close unsaved and original document state is restored in finally", () => {
  assert.match(source, /documentRef\.close\(SaveOptions\.DONOTSAVECHANGES\)/);
  assert.match(source, /finally \{\s*closeAllTemporaryDocuments\(temporaryDocuments\);\s*restoreOriginalState/s);
  assert.match(source, /documentRef\.activate\(\)/);
  assert.match(source, /documentRef\.selection = selectionSnapshot/);
});

test("handoff registers the SVG importer as a fixed internal Blender action without a panel record", () => {
  assert.match(blenderRegistryInstallerSource, /\[switch\]\$RegistryOnly/);
  assert.match(
    blenderRegistryInstallerSource,
    /\$RegistryOnly\s+-and\s+\$OwnerButtonId\s+-cnotmatch\s+'\^internal-/
  );
  assert.match(
    blenderRegistryInstallerSource,
    /without creating a panel record/
  );

  assert.match(handoffSource, /\$internalOwnerButtonId\s*=\s*'internal-illustrator-svg-import'/);
  assert.match(
    handoffSource,
    /\$internalBridgeAction\s*=\s*'flowcell_button_\{0\}'\s*-f\s*\$internalOwnerButtonId/
  );
  assert.match(handoffSource, /function Register-InternalBlenderAction/);
  assert.match(handoffSource, /Install-BlenderFlowCellButtons\.ps1/);
  assert.match(handoffSource, /-RegistryOnly/);
  assert.match(handoffSource, /-SkipSync/);
  assert.doesNotMatch(
    handoffSource,
    /\$installOutput\s*=\s*@\([\s\S]*?\$LASTEXITCODE[\s\S]*?\$installText\s*=/
  );
  assert.match(handoffSource, /installedCount'\)\s*-ne\s*1/);
  assert.match(handoffSource, /\$registeredAction\.Trim\(\)\s*-cne\s*\$internalBridgeAction/);
  assert.match(handoffSource, /\$bridgeAction\s*=\s*Register-InternalBlenderAction/);
  assert.match(handoffSource, /\$bridgeAction\s*=\s*Register-InternalBlenderAction[\s\S]*?-Action \$bridgeAction/);

  assert.match(
    blenderRegistryInstallerSource,
    /\$actionName\s*=\s*\('flowcell_button_\{0\}'\s*-f\s*\$OwnerButtonId\.ToLowerInvariant\(\)\)/
  );
  assert.match(blenderRegistryInstallerSource, /duplicate registry entries and cannot be safely updated/);
  assert.match(blenderRegistryInstallerSource, /is not owned by Button/);
  assert.doesNotMatch(
    blenderRegistryInstallerSource,
    /flowcell-source\.json|Programs\\Blender\\Panels/i
  );
});

test("Ill Orca resolves and invokes exactly the user's active Blender Orca Button after import", () => {
  assert.match(handoffSource, /\$orcaBundledSourceId\s*=\s*'blender\.orca'/);
  assert.match(handoffSource, /function Resolve-ActiveBlenderBundledAction/);
  assert.match(handoffSource, /Programs\\Blender\\Panels\\Files/);
  assert.match(handoffSource, /\*\.flowcell-source\.json/);
  assert.match(handoffSource, /Get-ObjectPropertyValue -Source \$record -Name 'bundledSourceId'/);
  assert.match(handoffSource, /if \(\$matches\.Count -ne 1\)/);
  assert.match(handoffSource, /\$programId\.Trim\(\) -ine 'blender'/);
  assert.match(handoffSource, /\$panelName\.Trim\(\) -ine 'Files'/);
  assert.match(handoffSource, /\$runner\.Trim\(\) -ine 'blender-bridge'/);
  assert.match(handoffSource, /-Name 'ownerButtonId'/);
  assert.match(handoffSource, /\$ownerButtonId\.Trim\(\) -cnotmatch '\^\[A-Za-z0-9_-\]\+\$'/);
  assert.match(handoffSource, /\[string\]::IsNullOrWhiteSpace\(\$bridgeAction\)/);
  assert.match(handoffSource, /\$bridgeAction\.Trim\(\) -cne \$expectedBridgeAction/);

  assert.match(handoffSource, /function Invoke-BlenderBridgeAction/);
  assert.match(handoffSource, /PassThruResponse = \$true/);
  assert.match(handoffSource, /\$bridgeResponseTimeoutSeconds\s*=\s*110/);
  assert.match(handoffSource, /ResponseTimeoutSeconds = \$bridgeResponseTimeoutSeconds/);
  assert.match(handoffSource, /send-svg-to-blender\.orca\.\{0\}\.tmp/);
  assert.match(
    handoffSource,
    /-Action \$orcaBridgeAction\s*`[\s\S]*?-Label 'Orca'\s*`[\s\S]*?-DataJson '\{\}'/
  );
  assert.ok(
    handoffSource.indexOf("$response = Invoke-BlenderBridgeAction") <
      handoffSource.indexOf("$orcaResponse = Invoke-BlenderBridgeAction")
  );
  assert.ok(
    handoffSource.indexOf("$orcaResponse = Invoke-BlenderBridgeAction") <
      handoffSource.indexOf("Write-HandoffStatus -Path $statusPath")
  );
  assert.match(
    handoffSource,
    /FailureMessage 'Blender imported the Illustrator SVG batch, but the Orca action did not complete\.'/
  );
});

test("handoff resolves each user's installation instead of embedding this computer's paths or owner ids", () => {
  const portableSources = source + "\n" + handoffSource;
  assert.doesNotMatch(portableSources, /C:\\Users\\|D:\\Dev\\workspace\\/i);
  assert.doesNotMatch(handoffSource, /button-migrated-|flowcell_button_button-/i);
  assert.match(handoffSource, /function Resolve-FlowCellRepoRoot/);
  assert.match(handoffSource, /function Resolve-NewestBlenderExecutable/);
  assert.match(handoffSource, /CurrentVersion\\App Paths\\blender\.exe/);
  assert.match(handoffSource, /\$env:LOCALAPPDATA/);
  assert.match(handoffSource, /\$env:ProgramFiles/);
});
