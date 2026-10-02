import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(
  join(import.meta.dirname, "..", "src", "button", "editor", "ButtonSkinEditor.tsx"),
  "utf8"
);

function sourceCallbacks(fileName, componentSource, names, context) {
  const parsed = ts.createSourceFile(fileName, componentSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(parsed))) {
      declarations.set(node.name.getText(parsed), `const ${node.getText(parsed)};`);
    } else if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
      declarations.set(node.name.text, node.getText(parsed));
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  for (const name of names) assert.ok(declarations.has(name), `${fileName} must expose ${name}`);
  const compiled = ts.transpileModule(
    `${names.map((name) => declarations.get(name)).join("\n")}\n({ ${names.join(", ")} });`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  return vm.runInNewContext(compiled, context);
}

function loadSkinHarness(result, compiles = true) {
  const state = {
    workingSkin: { id: "previous" },
    path: "previous.skin",
    naturalPreview: false,
    measurement: { width: 80, height: 30 },
    naturalMeasurement: { width: 80, height: 30 },
    sizingResets: 0
  };
  const assignments = [];
  const requests = [];
  const loadedSkinAssignmentRef = { current: null };
  const callbacks = sourceCallbacks("ButtonSkinEditor.tsx", source, ["applySkinFileResult", "loadSkin"], {
    cloneButtonDocument: structuredClone,
    onLoadSkinFile: async (path) => {
      requests.push(path);
      if (result instanceof Error) throw result;
      return result;
    },
    compileButtonSkin: () => ({ ok: compiles }),
    onAssignSkinToSelection: (skin, sizingMode) => assignments.push({ skin, sizingMode }),
    setWorkingSkin: (skin) => { state.workingSkin = skin; },
    setWorkingSkinFilePath: (path) => { state.path = path; },
    resetWorkingSizingMode: () => { state.sizingResets++; },
    setWorkingPreviewUsesNaturalSize: (natural) => { state.naturalPreview = natural; },
    setBenchMeasurement: (measurement) => { state.measurement = measurement; },
    setBenchNaturalMeasurement: (measurement) => { state.naturalMeasurement = measurement; },
    loadedSkinAssignmentRef,
    skinContextKey: "selected-placement"
  });
  return { ...callbacks, state, assignments, requests, loadedSkinAssignmentRef };
}

test("Load skin assigns the loaded skin to the selection with a natural Responsive preview", async () => {
  const result = { path: "loaded.skin", skin: { id: "loaded", name: "Loaded", css: "button {}" } };
  const h = loadSkinHarness(result);
  await h.loadSkin();
  assert.deepEqual(h.requests, [null]);
  assert.deepEqual(h.assignments, [{ skin: result.skin, sizingMode: "responsive" }]);
  assert.deepEqual(h.state.workingSkin, result.skin);
  assert.notEqual(h.state.workingSkin, result.skin, "the working copy must remain isolated from the loaded skin");
  assert.equal(h.state.path, result.path);
  assert.equal(h.state.naturalPreview, true);
  assert.equal(h.state.measurement, null);
  assert.equal(h.state.naturalMeasurement, null);
  assert.equal(h.state.sizingResets, 1);
  assert.deepEqual(structuredClone(h.loadedSkinAssignmentRef.current), {
    skinContextKey: "selected-placement", skinId: result.skin.id
  });
  assert.match(source, /void loadSkin\(\)/);
});

test("canceling or failing Load skin preserves the working copy and Button assignments", async () => {
  for (const result of [null, new Error("File could not be loaded")]) {
    const h = loadSkinHarness(result);
    const before = structuredClone(h.state);
    if (result instanceof Error) await assert.rejects(h.loadSkin(), result);
    else await h.loadSkin();
    assert.deepEqual(h.state, before);
    assert.deepEqual(h.assignments, []);
    assert.equal(h.loadedSkinAssignmentRef.current, null);
  }
});

test("a loaded skin that does not compile stays in preview without replacing selected skins", async () => {
  const result = { path: "invalid.skin", skin: { id: "invalid", css: "invalid" } };
  const h = loadSkinHarness(result, false);
  await h.loadSkin();
  assert.deepEqual(h.state.workingSkin, result.skin);
  assert.equal(h.state.path, result.path);
  assert.deepEqual(h.assignments, []);
  assert.equal(h.loadedSkinAssignmentRef.current, null);
});

function sourceModule(relativePath) {
  const moduleSource = readFileSync(join(import.meta.dirname, "..", "src", relativePath), "utf8");
  const compiled = ts.transpileModule(moduleSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports });
  return module.exports;
}

const geometry = sourceModule("button/geometry/buttonGeometry.ts");
const sizeAssignments = sourceModule("button/editor/buttonSizeAssignments.ts");
const pageSource = readFileSync(join(import.meta.dirname, "..", "src", "button", "editor", "ButtonEditorPage.tsx"), "utf8");

function legacySizeHarness() {
  const document = {
    settings: { buttonSpacingMm: 0 },
    popoutUnits: {},
    fanSetups: {},
    buttons: {},
    surfaces: {
      panel: {
        id: "panel", name: "Panel", width: 400, height: 200,
        placementIds: ["first", "second"], uniformButtonSize: { width: 80, height: 30 }
      }
    },
    placements: {}
  };
  for (const [index, id] of ["first", "second"].entries()) {
    document.buttons[id] = { id, label: id, defaultSkinId: "skin" };
    document.placements[id] = {
      id, surfaceId: "panel", buttonId: id,
      x: index * 100, y: 0, width: 80, height: 30, zIndex: index,
      skinOverrideId: null, textSizeOverride: null,
      matchHitboxToSkin: false, allowStretching: false, allowLabelResize: false
    };
  }
  const messages = [];
  let transactions = 0;
  const store = {
    current: () => document,
    transact: (change) => { change(document); transactions++; }
  };
  const callbacks = sourceCallbacks("ButtonEditorPage.tsx", pageSource, [
    "resolveIndependentOwnerPlacementId", "currentNaturalCoreMeasurement",
    "applyPlacementOrder", "assignSizeToSelectedPlacement", "assignSizeToPanel"
  ], {
    ...geometry,
    ...sizeAssignments,
    useCallback: (callback) => callback,
    store,
    focusedPlacementId: "first",
    naturalCoreMeasurementsRef: { current: new Map() },
    setMessage: (message) => messages.push(message)
  });
  return { ...callbacks, document, messages, get transactions() { return transactions; } };
}

for (const scope of ["selected Button", "Panel"]) {
  test(`explicit size assignment to ${scope} releases a legacy size link only after validation succeeds`, () => {
    const h = legacySizeHarness();
    const secondBefore = structuredClone(h.document.placements.second);
    const assign = scope === "Panel" ? h.assignSizeToPanel : h.assignSizeToSelectedPlacement;
    assign({ width: 90, height: 40, sizingMode: "stretch" });
    assert.equal(h.transactions, 1);
    assert.equal(h.document.surfaces.panel.uniformButtonSize, null);
    const targets = scope === "Panel" ? ["first", "second"] : ["first"];
    for (const id of targets) {
      const placement = h.document.placements[id];
      assert.equal(placement.width, 90);
      assert.equal(placement.height, 40);
      assert.equal(placement.matchHitboxToSkin, true);
      assert.equal(placement.allowStretching, true);
      assert.equal(placement.allowLabelResize, false);
    }
    if (scope === "selected Button") assert.deepEqual(h.document.placements.second, secondBefore);
  });

  test(`rejected size assignment to ${scope} preserves its legacy link and placement geometry`, () => {
    const h = legacySizeHarness();
    const before = structuredClone(h.document);
    const assign = scope === "Panel" ? h.assignSizeToPanel : h.assignSizeToSelectedPlacement;
    assign({ width: scope === "Panel" ? 450 : 120, height: 40, sizingMode: "stretch" });
    assert.equal(h.transactions, 0);
    assert.deepEqual(h.document, before);
    assert.ok(h.messages.some((message) => typeof message === "string" && message.length > 0));
  });
}

test("Skin Editor keeps source edits in an isolated working skin", () => {
  assert.match(source, /const \[workingSkin, setWorkingSkin\] = useState<ButtonSkin \| null>/);
  assert.match(source, /const \[workingSkinFilePath, setWorkingSkinFilePath\] = useState<string \| null>/);
  assert.match(source, /setWorkingSkin\(next\)/);
  assert.doesNotMatch(source, /onSkinChange/);
  assert.match(source, /onLoadSkinFile/);
});

test("Skin Editor exposes only the requested skin actions in the requested order", () => {
  const labels = [
    "Assign Skin to Selection",
    "Assign Skin to Panel",
    "Load skin",
    "Save skin",
    "Save as new skin",
    "Update skin file",
    "Open skins folder"
  ];
  let previousIndex = -1;
  for (const label of labels) {
    const index = source.search(new RegExp(`>\\s*${label}(?:\\.\\.\\.)?\\s*<`));
    assert.ok(index > previousIndex, `'${label}' must follow the preceding toolbar action`);
    previousIndex = index;
  }
  assert.doesNotMatch(source, />\s*Assign Skin\s*</);
  assert.doesNotMatch(source, /Apply Named Sections/);
  assert.doesNotMatch(source, /Replace Entire Skin/);
});

test("invalid working skins cannot be saved or explicitly assigned", () => {
  assert.match(source, /setWorkingSkin\(cloneButtonDocument\(result\.skin\)\)/);
  assert.match(source, /setWorkingSkinFilePath\(result\.path\)/);
  assert.match(source, /setWorkingSkinFilePath\(null\)/);
  assert.doesNotMatch(source, /Recent files|Saved skins|saved:|recent:/);
  assert.match(source, /const skinActionsDisabled = busy \|\| !compileResult\?\.ok/);
  assert.equal((source.match(/disabled=\{skinActionsDisabled\}/g) ?? []).length, 3);
  for (const callback of [
    "onAssignSkinToSelection",
    "onAssignSkinToPanel"
  ]) {
    assert.match(
      source,
      new RegExp(`${callback}\\(workingSkinForPersistence\\(\\), sizingMode\\)`),
      `${callback} must receive the isolated working skin and pending sizing policy`
    );
  }
  assert.match(
    source,
    /disabled=\{skinActionsDisabled \|\| selectionButtonCount === 0\}[\s\S]{0,220}onAssignSkinToSelection/
  );
  assert.match(
    source,
    /onSaveSkin\(workingSkinForPersistence\(\)\)/
  );
  assert.match(
    source,
    /onSaveAsNewSkin\(workingSkinForPersistence\(\)\)/
  );
  assert.match(
    source,
    /disabled=\{skinActionsDisabled \|\| !workingSkinFilePath\}[\s\S]{0,420}onUpdateSkinFile\([\s\S]{0,100}workingSkinFilePath/
  );
  assert.match(source, /onOpenSkinDirectory\(\)/);
});

test("normal WebView paste fallback applies recognized source and exposes a visible working preview", () => {
  assert.match(
    source,
    /onChange=\{\(event\) => \{[\s\S]{0,260}applyPaste\(source\);/
  );
  assert.match(source, /className="button-skin-working-preview"/);
  assert.match(
    source,
    /className="button-skin-working-preview"[\s\S]{0,500}skin=\{workingSkin\}/
  );
  assert.match(
    source,
    /setWorkingSkin\(next\);[\s\S]{0,180}setWorkingPreviewUsesNaturalSize\(true\);[\s\S]{0,180}setPaste\(""\);\s*setUpdatedSections/
  );
});

test("Button Color and hover highlight edit only the isolated working skin", () => {
  const textIndex = source.indexOf("<span>Button Text</span>");
  const colorIndex = source.indexOf("<span>Button Color</span>");
  assert.ok(textIndex >= 0);
  assert.ok(colorIndex > textIndex, "Button Color must follow Button Text");
  const toolbarIndex = source.indexOf('className="button-skin-editor__toolbar"');
  const sizeIndex = source.indexOf("<span>Button Size</span>");
  assert.ok(toolbarIndex > colorIndex, "Button Text and Button Color must precede the skin toolbar");
  assert.ok(sizeIndex > colorIndex, "Button Text and Button Color must precede Button Size");
  assert.match(source, /collectButtonSkinProfileColors\(skinSections\(workingSkin\)\)/);
  assert.match(source, /workingMaterialProfile\.map\(\(profileColor\) =>/);
  assert.match(source, /type="color"/);
  assert.match(source, /type="text"/);
  assert.match(source, /EyeDropper/);
  assert.match(source, /label="Text Color"/);
  assert.match(source, /preserveAlpha=\{false\}/);
  assert.match(source, /setButtonSkinProfileColor\(/);
  assert.match(source, /setButtonSkinTextColor\(/);
  assert.match(source, /readButtonSkinHighlightOnHover\(workingSkin\)/);
  assert.match(source, /setButtonSkinHighlightOnHover\([\s\S]{0,160}event\.currentTarget\.checked/);
  assert.match(source, /workingSkinHighlightOnHover = explicitWorkingSkinHighlightOnHover \?\? placement\.highlightOnHover/);
  assert.match(source, /workingSkinForPersistence[\s\S]{0,420}setButtonSkinHighlightOnHover/);
  assert.match(source, /This skin has no authored color profile/);
  assert.doesNotMatch(source, /workingColorBuckets|label=\{`Color \$\{index \+ 1\}`\}/);

  const colorUpdate = source.match(
    /const applyWorkingColorSections = \(sections: ButtonSkinSectionSource\) => \{[\s\S]*?\n  \};/
  );
  assert.ok(colorUpdate, "isolated color update helper must exist");
  assert.match(colorUpdate[0], /setWorkingSkin\(withSections\(workingSkin, sections\)\)/);
  assert.doesNotMatch(colorUpdate[0], /setWorkingPreviewUsesNaturalSize|setWorkingSize/);
  assert.doesNotMatch(colorUpdate[0], /onAssignSkin|onSaveSkin/);
});

test("Button size uses an isolated preview until an explicit assignment action", () => {
  assert.match(source, /const \[workingSize, setWorkingSize\] = useState/);
  assert.match(
    source,
    /const \[appliedPreviewSizingMode, setAppliedPreviewSizingMode\] = useState<ButtonPlacementSizingMode>/
  );
  assert.match(source, /const \[workingPreviewUsesNaturalSize, setWorkingPreviewUsesNaturalSize\] = useState\(false\)/);
  assert.match(source, /const activeSize = workingSize\?\.placementId === placement\.id/);
  assert.match(source, /const previewSizingMode = appliedPreviewSizingMode/);
  assert.match(source, /const previewWidth = workingPreviewUsesNaturalSize \? undefined : activeSize\.width/);
  assert.match(source, /const previewHeight = workingPreviewUsesNaturalSize \? undefined : activeSize\.height/);
  assert.equal((source.match(/width=\{previewWidth\}/g) ?? []).length, 3);
  assert.equal((source.match(/height=\{previewHeight\}/g) ?? []).length, 3);
  assert.match(source, /value=\{sizingMode\}\s*disabled=\{sizeActionsDisabled\}/);
  assert.equal((source.match(/disabled=\{sizeActionsDisabled\}/g) ?? []).length, 4);
  assert.equal(
    (source.match(/matchHitboxToSkin=\{previewSizingMode !== "responsive"\}/g) ?? []).length,
    3
  );
  assert.equal(
    (source.match(/allowStretching=\{previewSizingMode === "stretch"\}/g) ?? []).length,
    3
  );
  assert.match(source, /onSizingModePreviewChange\(nextMode\)/);
  assert.match(source, /onAssignSize\(sizeForAssignment\)/);
  assert.match(source, /onAssignSizeToPanel\(sizeForAssignment\)/);
  assert.doesNotMatch(source, /onPlacementSizeChange/);
  assert.doesNotMatch(source, /onPlacementSizingModeChange/);
});

test("paste, load, and source editing return the preview to natural geometry and Responsive policy", () => {
  assert.match(
    source,
    /const sizeForAssignment = \{[\s\S]{0,220}workingPreviewUsesNaturalSize && benchNaturalMeasurement/
  );
  assert.ok(
    (source.match(/setWorkingPreviewUsesNaturalSize\(true\)/g) ?? []).length >= 3,
    "every working-source replacement path must restore natural preview geometry"
  );
  assert.ok(
    (source.match(/resetWorkingSizingMode\(\)/g) ?? []).length >= 3,
    "every working-source replacement path must restore Responsive as the pending policy"
  );
  assert.match(
    source,
    /const updateWorkingDimension[\s\S]{0,260}setWorkingPreviewUsesNaturalSize\(false\);[\s\S]{0,260}setWorkingSize/
  );
  assert.doesNotMatch(source, /setWorkingPreviewUsesNaturalSize\(true\)[\s\S]{0,180}onAssignSize/);
});

test("choosing a sizing behavior changes policy without rewriting width or height", () => {
  const modeHandler = source.match(
    /onChange=\{\(event\) => \{\s*const nextMode = event\.currentTarget\.value as ButtonPlacementSizingMode;[\s\S]*?\n            \}\}/
  );
  assert.ok(modeHandler, "sizing behavior handler must exist");
  assert.match(modeHandler[0], /sizingMode: nextMode/);
  assert.doesNotMatch(modeHandler[0], /width:|height:|naturalRatio/);
  assert.doesNotMatch(modeHandler[0], /setAppliedPreviewSizingMode/);
  assert.match(
    source,
    /const updateWorkingDimension[\s\S]{0,220}setAppliedPreviewSizingMode\(sizingMode\)/
  );
  assert.equal(
    (source.match(/setAppliedPreviewSizingMode\(sizingMode\)/g) ?? []).length,
    5,
    "dimension editing plus explicit size and skin assignments must promote the pending policy"
  );
});

test("each selected or replaced working skin starts Responsive without changing geometry", () => {
  assert.match(
    source,
    /function responsiveSizeAssignmentFromPlacement[\s\S]{0,320}sizingMode: "responsive"/
  );
  assert.match(
    source,
    /setWorkingSkin\(skin \? cloneButtonDocument\(skin\) : null\);[\s\S]{0,260}responsiveSizeAssignmentFromPlacement\(placement\)[\s\S]{0,160}onSizingModePreviewChange\("responsive"\)/
  );

  const geometrySync = source.match(
    /useEffect\(\(\) => \{\s*setWorkingSize\(\(current\) => \{[\s\S]*?\n  \}, \[placement\?\.id, placement\?\.width, placement\?\.height\]\);/
  );
  assert.ok(geometrySync, "geometry-only working-size synchronization effect must exist");
  assert.match(geometrySync[0], /\.\.\.current,\s*width: placement\.width,\s*height: placement\.height/);
  assert.doesNotMatch(geometrySync[0], /sizingMode:/);
});

test("Button text fitting remains placement-owned and independent from the working size", () => {
  assert.match(source, /value=\{placement\.textFitMode\}/);
  assert.match(source, /value=\{placement\.textAlignment\}/);
  assert.match(source, /Text alignment/);
  assert.match(source, /Center/);
  assert.match(source, /value=\{placement\.textSizeOverride \?\? ""\}/);
  assert.match(source, /value=\{placement\.minimumFontSize\}/);
  assert.match(source, /value=\{placement\.textOffsetX\}/);
  assert.match(source, /value=\{placement\.textOffsetY\}/);
  assert.match(source, /\{ textOffsetX: value \}/);
  assert.match(source, /\{ textOffsetY: value \}/);
  assert.match(source, /textOffsetX=\{placement\.textOffsetX\}/);
  assert.match(source, /textOffsetY=\{placement\.textOffsetY\}/);
  assert.match(source, /onPlacementTextChange/);
});

test("Button Text preview stays live and ends with its own scoped Apply All", () => {
  const textSection = source.match(
    /<summary title="Edit Button labels and the shared Button Tooltip[\s\S]*?<\/details>/
  );
  assert.ok(textSection, "Button Text section must exist");
  assert.match(textSection[0], /label=\{previewLabel\}/);
  assert.match(textSection[0], /hovered=\{selectedVisualFlags\.hovered\}/);
  assert.match(textSection[0], /textOffsetX=\{placement\.textOffsetX\}/);
  assert.match(textSection[0], /textOffsetY=\{placement\.textOffsetY\}/);
  assert.match(textSection[0], /<span>Button Tooltip<\/span>[\s\S]{0,320}<textarea[\s\S]{0,320}value=\{buttonTooltip\}/);
  assert.match(textSection[0], /onClick=\{onApplyAllButtonText\}[\s\S]{0,120}>\s*Apply All\s*</);
  assert.match(textSection[0], /disabled=\{busy \|\| stateTextBlocked\}/);
  assert.ok(
    textSection[0].lastIndexOf("Apply All") > textSection[0].lastIndexOf("button-text-bench-preview"),
    "Apply All must remain below the live Button Text preview"
  );
  assert.doesNotMatch(textSection[0], /onApplyButtonStateSetup/);
});
