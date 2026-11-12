import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { normalizeButtonSkinColor } from "./.compiled-button-system/button/skins/buttonSkinColors.js";
import { rails } from "./.compiled-button-system/pages/main/mainLayout.js";
import { FLOWCELL_THEME_PAGE_REGISTRY } from "./.compiled-button-system/theme/themePageRegistry.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(root, "..");
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");
const readRepository = (...parts) => readFileSync(path.join(repositoryRoot, ...parts), "utf8");

function parsedColorFallbacks(source) {
  const fallbacks = new Map();
  const pattern = /var\(\s*(--flowcell-[a-z0-9-]+)\s*,\s*(rgba?\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+)\s*\)/gi;
  for (const match of source.matchAll(pattern)) {
    const normalized = normalizeButtonSkinColor(match[2]);
    if (!normalized) continue;
    const values = fallbacks.get(match[1]) ?? new Set();
    values.add(normalized.toLowerCase());
    fallbacks.set(match[1], values);
  }
  return fallbacks;
}

function themeCallback(fileName, name, context) {
  const source = ts.createSourceFile(fileName, read("src", "pages", "theme", fileName), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) callback = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(callback, `${name} must exist`);
  const compiled = ts.transpileModule(`return (${callback.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  return new Function(...Object.keys(context), compiled)(...Object.values(context));
}

test("legacy theme apply keeps omitted host fields out and reuses its captured transaction snapshot", async () => {
  const previous = { version: 1, sourceId: "example.theme", sourceVersion: "1", assetFields: [],
    state: { fields: { tabs_hex: "#111111", hdri_path: "C:/current.hdr", static_background_path: "C:/current.png", world_strength: 2 },
      tone: { level: 0.5 } } };
  const legacy = { state: { fields: { tabs_hex: "#123456" } } };
  const latest = { revision: 7 };
  const saved = { revision: 8 };
  const descriptors = [{ sourceId: "example.theme" }];
  const counts = { capture: 0, document: 0, descriptors: 0 };
  let committedTheme;
  let selectedSnapshot;
  const apply = themeCallback("ThemeEditorPage.tsx", "applyLoadedTheme", {
    contribution: { current: { loadLegacy: async () => legacy, validate: async () => {}, capture: async () => { counts.capture++; return previous; } } },
    target: { kind: "program", programName: "Example" },
    loadButtonStateDocument: async () => { counts.document++; return latest; },
    getThemeToolDescriptors: async () => { counts.descriptors++; return descriptors; },
    applyLegacyProgramAppearance: (document, _target, _settings, _appearance, actualDescriptors) => {
      assert.equal(document, latest); assert.equal(actualDescriptors, descriptors);
      return { document, skippedMissingPlacementCount: 0 };
    },
    legacyThemeIdentity: async () => "legacy-id",
    capturePortableTheme: (options) => options,
    commitCompleteTheme: async (theme, snapshot) => {
      committedTheme = theme;
      assert.equal(snapshot.previousContribution, previous);
      assert.equal(snapshot.document, latest);
      assert.equal(snapshot.descriptors, descriptors);
      return { saved, warnings: [] };
    },
    updateContributionSelection: async (_theme, _path, snapshot) => { selectedSnapshot = snapshot; },
    rememberTheme: () => {}, setStatus: () => {}, warningSuffix: () => "", errorMessage: String
  });
  await apply({ path: "Green.json", legacy: {} }, false);
  assert.deepEqual(committedTheme.contributions[previous.sourceId].state, {
    fields: { tabs_hex: "#123456" }, tone: previous.state.tone
  });
  assert.equal(previous.state.fields.hdri_path, "C:/current.hdr", "rollback must retain the full captured baseline");
  assert.deepEqual(counts, { capture: 1, document: 1, descriptors: 1 });
  assert.equal(selectedSnapshot.document, saved);
  assert.equal(selectedSnapshot.descriptors, descriptors);
});

test("unknown and unsent host outcomes roll back local preparation without another host apply", async () => {
  const source = ts.createSourceFile("ThemeContribution.tsx", read("src", "pages", "theme", "ThemeContribution.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const helpers = source.statements.filter((node) => ts.isFunctionDeclaration(node) && ["isThemeHostOutcomeUnknown", "isThemeHostNotStarted"].includes(node.name?.text))
    .map((node) => node.getText(source).replace(/^export /, "")).join("\n");
  const compiled = ts.transpileModule(helpers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const classifiers = new Function(`${compiled}\nreturn { isThemeHostOutcomeUnknown, isThemeHostNotStarted };`)();
  assert.equal(classifiers.isThemeHostOutcomeUnknown(new Error("reported host rejection")), false);
  assert.equal(classifiers.isThemeHostOutcomeUnknown("FLOWCELL_THEME_OUTCOME_UNKNOWN: response timed out"), true);
  assert.equal(classifiers.isThemeHostNotStarted(new Error("FLOWCELL_THEME_NOT_STARTED: no request was sent")), true);
  for (const outcome of ["reported", "unknown", "unsent"]) {
    const previous = { sourceId: "example.theme", assetFields: [], state: { fields: { tabs_hex: "#111111" } } };
    let applyCount = 0;
    let rollbackCount = 0;
    const failure = new Error(outcome === "unknown" ? "FLOWCELL_THEME_OUTCOME_UNKNOWN: response timed out"
      : outcome === "unsent" ? "FLOWCELL_THEME_NOT_STARTED: no request was sent" : "reported host rejection");
    const commit = themeCallback("ThemeEditorPage.tsx", "commitCompleteTheme", {
      contribution: { current: { sourceId: previous.sourceId, capture: async () => previous, validate: async () => {},
        preservePoppedAppearance: async () => false, apply: async () => { if (++applyCount === 1) throw failure; } } },
      poppedColors: { current: null }, stableJson: JSON.stringify,
      target: { kind: "program", programName: "Example" },
      invoke: async () => ({ token: null, descriptors: [] }),
      preparePortableThemeImport: async () => ({ rollback: async () => { rollbackCount++; } }),
      errorMessage: (error) => error.message ?? String(error), ...classifiers
    });
    await assert.rejects(commit({ contributions: { theme: { ...previous, state: { fields: { tabs_hex: "#123456" } } } }, theme: {} }),
      outcome === "unknown" ? /may already have changed.*automatic host restore was skipped/
        : outcome === "unsent" ? /FLOWCELL_THEME_NOT_STARTED: no request was sent/ : /reported host rejection/);
    assert.equal(rollbackCount, 1);
    assert.equal(applyCount, outcome === "reported" ? 2 : 1);
  }
});

test("theme inspection ignores closed previews and uses a separate Applying status", async () => {
  const inspection = { current: 0 };
  const operations = [];
  let finishRead;
  let reviewCount = 0;
  let selected;
  const inspect = themeCallback("ThemeLibraryDialog.tsx", "inspect", {
    inspection, setOperation: (value) => operations.push(value), setError: () => {}, setSelected: (value) => { selected = value; },
    setIssues: () => {}, setRequirements: () => {}, onReview: async () => { reviewCount++; return []; }
  });
  const pending = inspect(() => new Promise((resolve) => { finishRead = resolve; }));
  assert.deepEqual(operations, ["inspecting"]);
  inspection.current++;
  finishRead({ path: "closed.json" });
  await pending;
  assert.equal(reviewCount, 0, "closing before file read completes must not start contribution review");
  assert.equal(selected, null);
  const dialog = read("src", "pages", "theme", "ThemeLibraryDialog.tsx");
  assert.match(dialog, /disabled=\{operation === "applying"\}>Close/);
  assert.match(dialog, /inspection\.current \+= 1;\s*onClose\(\)/);
  assert.match(dialog, /operation === "applying" \? "Applying…" : operation === "inspecting" \? "Checking…" : "Apply Theme"/);
  assert.match(dialog, /setOperation\("applying"\);[\s\S]{0,200}onApply\(selected\)/);
});

test("Main and installed program contributions use the unified Theme Editor", () => {
  const main = read("src", "pages", "main", "MainPage.tsx");
  const layout = read("src", "pages", "main", "mainLayout.ts");
  const editor = read("src", "pages", "theme", "ThemeEditorPage.tsx");
  const blenderScript = readRepository(
    "Programs",
    "Blender",
    "Blender Git Scripts",
    "Toolsets",
    "theme",
    "flowcell.script.json"
  );
  const blenderPage = readRepository(
    "Programs",
    "Blender",
    "Blender Git Scripts",
    "Toolsets",
    "theme",
    "page",
    "page.js"
  );
  const blenderManifest = readRepository("Programs", "Blender", "flowcell.program.json");

  assert.match(layout, /label: "Theme"[\s\S]{0,180}actionId: "open-theme-editor"/);
  assert.match(main, /openThemeEditorWindow\(\{ target: "FlowCell", page: "main" \}\)/);
  assert.match(editor, /const programs = await listProgramFolders\(\)/);
  assert.match(editor, /<option value=\{FLOWCELL_TARGET_VALUE\}>Main<\/option>/);
  assert.match(editor, /panelValue === POPOUTS_ONLY_VALUE/);
  assert.match(editor, /popoutsOnly \? \{ area: "popouts" as const \} : \{\}/);
  assert.match(editor, /current === POPOUTS_ONLY_VALUE/);
  assert.doesNotMatch(editor, /setTargetValue\(loadedTarget/);
  assert.match(editor, /target\.area === "popouts"[\s\S]{0,100}Pop-outs Theme/);
  assert.match(editor, /programNames\.map\(\(programName\)/);
  assert.match(editor, /FLOWCELL_THEME_PAGE_REGISTRY/);
  assert.equal(
    editor.match(/loadMainPageButtonBootstrap\(\{ removeStaleOwners: false \}\)/g)?.length,
    2,
    "initial and reused-window Theme Editor discovery must preserve stale owners"
  );
  assert.match(editor, /subscribeButtonCommits/);
  assert.match(editor, /THEME_EDITOR_CONTEXT_EVENT/);
  assert.doesNotMatch(editor, /["'`]Blender["'`]/);
  assert.ok(JSON.parse(blenderScript).page.themeContribution);
  assert.match(blenderPage, /descriptor\.themeContribution/);
  assert.equal(JSON.parse(blenderManifest).themeLibrary, "themes/Blender");
});

test("Theme targets refresh immediately after setup and ignore stale program reads without changing selection", async () => {
  const source = ts.createSourceFile("ThemeEditorPage.tsx", read("src", "pages", "theme", "ThemeEditorPage.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect" && node.arguments[0]?.getText(source).includes("const refreshPrograms = async")) effect = node.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(effect);
  const handlers = new Map();
  const reads = [];
  let names = [];
  let selected = "__flowcell__";
  const cleanup = new Function("context", "listProgramFolders", "listen", "makeSafeTauriUnlisten", "PROGRAM_SETUP_COMMITTED_EVENT", "THEME_EDITOR_CONTEXT_EVENT", "setProgramNames", "setTargetValue", "setPageValue", "setPanelValue", "setStatus", "resolvedEditorContext", "errorMessage", ts.transpileModule(`return (${effect})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText)(
    {}, () => new Promise((resolve) => reads.push(resolve)),
    async (name, handler) => { handlers.set(name, handler); return () => handlers.delete(name); }, (dispose) => dispose,
    "setup", "context", (value) => { names = value; }, (value) => { selected = value; }, () => {}, () => {}, () => {},
    (value) => ({ targetValue: value.target ?? "__flowcell__", pageValue: "main", panelValue: "__all_panels__" }), String
  );
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  await flush();
  assert.equal(handlers.has("setup"), true, "setup subscription must exist before the first program read");
  assert.equal(reads.length, 1);
  reads[0](["Windows"]);
  await flush();
  selected = "Windows";
  handlers.get("setup")({ payload: { programName: "Blender" } });
  handlers.get("setup")({ payload: { programName: "Krita" } });
  reads[2](["Windows", "Blender", "Krita"]);
  await flush();
  reads[1](["Windows"]);
  await flush();
  assert.deepEqual(names, ["Windows", "Blender", "Krita"]);
  assert.equal(selected, "Windows", "completed setup must preserve the current Target selection");
  handlers.get("context")({ payload: { target: "Blender" } });
  handlers.get("setup")({ payload: { programName: "Fusion" } });
  reads[4](["Windows", "Blender", "Krita", "Fusion"]);
  await flush();
  assert.equal(selected, "Blender");
  reads[3](["Windows"]);
  await flush();
  handlers.get("setup")({ payload: { programName: "Closed" } });
  cleanup();
  reads[5](["Closed"]);
  await flush();
  assert.deepEqual(names, ["Windows", "Blender", "Krita", "Fusion"]);
  assert.equal(handlers.size, 0);
});

test("Theme Target retains one shared header and fixed column geometry for Main and program targets", () => {
  const editor = read("src", "pages", "theme", "ThemeEditorPage.tsx");
  const css = read("src", "pages", "theme", "themeEditorPage.css");
  assert.doesNotMatch(editor, /!showingProgramPage && <header/);
  assert.doesNotMatch(css, /theme-editor--program-page[^}]*\b(?:padding|gap|grid-template-rows)\s*:/);
  assert.match(css, /\.theme-editor__scope \{ grid-template-columns: minmax\(160px, 1fr\) minmax\(160px, 1fr\); \}/);
});

test("Theme Editor is a bulk override and saved-skin assignment workflow", () => {
  const editor = read("src", "pages", "theme", "ThemeEditorPage.tsx");
  const css = read("src", "pages", "theme", "themeEditorPage.css");
  const main = read("src", "pages", "main", "MainPage.tsx");
  const model = read("src", "theme", "themeModel.ts");
  const renderer = read("src", "button", "skins", "ButtonSkinRenderer.tsx");
  const compiler = read("src", "button", "skins", "skinCompiler.ts");
  const file = read("src", "theme", "themeFile.ts");
  const nativeLayouts = read("src-tauri", "src", "commands", "layouts.rs");
  assert.match(model, /validateButtonStateDocument/);
  assert.doesNotMatch(
    main,
    /topLeftActionHeight|topLeftBaselineHeight|targetHeightOverride=/,
    "Main must render each top-left control at its independent canonical height"
  );
  assert.match(editor, /listButtonSkinFiles\(\)/);
  assert.match(editor, /loadButtonSkinFile\(path\)/);
  assert.match(editor, /createButtonSkinFromFile/);
  assert.match(
    editor,
    /resolveThemeSkinAssignmentPlacementIds\(\s*scopedPlacements,\s*selectedPlacement\.id,\s*assignEveryButtonInScope\s*\)/
  );
  assert.doesNotMatch(editor, /sourceIdentity\.key/);
  assert.match(model, /LEGACY_THEME_SKIN_ID_PREFIX/);
  assert.match(editor, /Apply this saved skin to all \{scopedPlacements\.length\} Buttons in the current scope/);
  assert.match(editor, /Checkbox off: only the selected Button occurrence uses the saved skin/);
  assert.match(editor, /Checkbox on: every Button in this scope uses it/);
  assert.match(
    editor,
    /clearButtonThemeOverrideColors\(\s*document\.themeOverrides\?\.\[placementId\]\s*\)/
  );
  assert.match(editor, /Assignment starts with the saved skin's authored colors/);
  assert.match(editor, /No saved skin file was edited/);
  assert.doesNotMatch(editor, /saveButtonSkinFile/);
  assert.doesNotMatch(editor, /Hover and Active|Preserve current values|Use Default Highlight/);
  assert.doesNotMatch(editor, /THEME_HOVER_HIGHLIGHT_ROLE|THEME_ACTIVE_HIGHLIGHT_ROLE/);
  assert.match(editor, /<h2>Highlight<\/h2>/);
  assert.match(editor, /<h2>Glow<\/h2>/);
  assert.match(editor, /ariaLabel: "Highlight on hover"/);
  assert.match(editor, /ariaLabel: "Highlight when active"/);
  assert.match(editor, /ariaLabel: "Glow on hover"/);
  assert.match(editor, /ariaLabel: "Glow when active"/);
  assert.match(editor, /max: BUTTON_HIGHLIGHT_AMOUNT_MAX/);
  assert.match(editor, /max: BUTTON_GLOW_AMOUNT_MAX/);
  assert.match(editor, /The range reaches \{BUTTON_HIGHLIGHT_AMOUNT_MAX\}%/);
  assert.match(editor, /Defaults are \{DEFAULT_BUTTON_HIGHLIGHT_AMOUNT\}%/);
  assert.match(editor, /applyCommonProgramThemeEdit\(document, target, placementIds, \{ kind: "effect", field, amount \}\)/);
  assert.match(editor, /Set \$\{label\.toLocaleLowerCase\("en"\)\} to \$\{amount\}% across all \$\{placementIds\.length\} in-scope Buttons/);
  assert.doesNotMatch(editor, /Highlight color|Enable hover|Enable active/);
  assert.match(
    editor,
    /const value = Number\(event\.currentTarget\.value\);\s*applyEffectAmount\(control\.field, control\.ariaLabel, value\);/
  );
  assert.match(editor, /buttonSkinColorOpacityPercent/);
  assert.match(editor, /const role = event\.currentTarget\.value;\s*updateGradient\(\(current\) => \(\{ \.\.\.current, role \}\)\);/);
  assert.match(editor, /const spread = Number\(event\.currentTarget\.value\);\s*updateGradient\(\(current\) => \(\{ \.\.\.current, spread \}\)\);/);
  assert.match(editor, /const scatter = Number\(event\.currentTarget\.value\);\s*updateGradient\(\(current\) => \(\{ \.\.\.current, scatter \}\)\);/);
  assert.doesNotMatch(
    editor,
    /updateGradient\(\(current\) => \(\{ \.\.\.current, (?:role|spread|scatter): [^}]*event\.currentTarget/
  );
  assert.doesNotMatch(editor, /setButtonSkinHighlightOnHover|setButtonSkinHighlightOnActive/);
  assert.doesNotMatch(editor, /ensurePlacementPrivateSkin|THEME_DRAFT_SKIN_PREFIX/);
  assert.doesNotMatch(editor, /compatible saved skin|do not expose the|extractSkinColorRoots/i);
  assert.match(editor, /THEME_EDITOR_GRADIENT_ROLES[\s\S]{0,180}"surface"[\s\S]{0,180}"text"/);
  assert.match(editor, /THEME_EDITOR_GRADIENT_ROLES\.map\(\(role\) =>/);
  assert.match(editor, /initialScopeGradient[\s\S]{0,180}role: "surface"/);
  assert.equal(
    (editor.match(/setGradient\(initialScopeGradient\(stored\?\.gradient\)\)/g) ?? []).length,
    2,
    "scope changes and Discard must both restore Surface as the visible channel"
  );
  assert.match(renderer, /buttonSkinSurfaceThemeMode\(skin\)/);
  assert.match(renderer, /applyButtonSkinSurfaceThemeFallback\(skin, themeSurfaceColor\)/);
  assert.match(renderer, /buttonSkinThemeColorVariables\(skin, themeOverride\?\.colors\)/);
  assert.doesNotMatch(renderer, /applyButtonThemeSurfaceTint|data-button-theme-surface-filter/);
  assert.match(renderer, /data-button-theme-surface-fallback/);
  assert.match(renderer, /data-button-theme-text/);
  assert.match(compiler, /:host\(\[data-button-theme-text=/);
  assert.match(css, /height: 100vh;[\s\S]*overflow-y: auto;/);
  assert.match(css, /select option \{[\s\S]*background: #1d2522;/);
  const gradientStart = editor.indexOf("const applyGradient =");
  const gradientEnd = editor.indexOf("const captureCurrentTheme", gradientStart);
  assert.notEqual(gradientStart, -1);
  assert.notEqual(gradientEnd, -1);
  const applyGradient = editor.slice(gradientStart, gradientEnd);
  assert.doesNotMatch(applyGradient, /extractSkinColorRoots|unsupported|compatible/i);
  assert.match(applyGradient, /resolvedPlacementIds/);
  assert.match(applyGradient, /did not resolve the exact/);
  const bakeIndex = applyGradient.indexOf("bakeThemeGradientForDeployedLayout(");
  const gradientDraftIndex = applyGradient.indexOf("updateDraft(", bakeIndex);
  const gradientColorIndex = applyGradient.indexOf("applyCommonProgramThemeEdit(", gradientDraftIndex);
  assert.equal(
    0 <= bakeIndex && bakeIndex < gradientDraftIndex && gradientDraftIndex < gradientColorIndex,
    true,
    "Theme Editor must bake final deployed positions before updating gradient colors"
  );
  const commitStart = editor.indexOf("const commitTheme = async");
  const commitEnd = editor.indexOf("const acceptCommittedTheme", commitStart);
  assert.notEqual(commitStart, -1);
  assert.notEqual(commitEnd, -1);
  const commitTheme = editor.slice(commitStart, commitEnd);
  const applyIndex = commitTheme.indexOf("applyThemeFile(");
  const authorizeIndex = commitTheme.indexOf("authorizeThemePageAssets(");
  const saveIndex = commitTheme.indexOf("saveButtonStateDocument(");
  const publishIndex = commitTheme.indexOf("publishButtonCommit(");
  const pageIndex = commitTheme.indexOf("writeAuthorizedThemePageAppearance(");
  assert.equal(
    0 <= applyIndex &&
      applyIndex < authorizeIndex &&
      authorizeIndex < pageIndex &&
      pageIndex < saveIndex &&
      saveIndex < publishIndex,
    true
  );
  assert.equal(commitTheme.match(/saveButtonStateDocument\(/g)?.length, 1);
  assert.equal(commitTheme.match(/publishButtonCommit\(/g)?.length, 1);
  const expectedSavedIndex = commitTheme.indexOf("const expectedSaved = cloneButtonDocument(");
  const expectedRevisionIndex = commitTheme.indexOf(
    "expectedSaved.revision = latest.revision + 1",
    expectedSavedIndex
  );
  const saveCatchIndex = commitTheme.indexOf("catch (saveError)", saveIndex);
  const recoveryIndex = commitTheme.indexOf("await loadButtonStateDocument().catch(() => null)", saveCatchIndex);
  const recoveryCompareIndex = commitTheme.indexOf(
    "stableJson(recovered) !== stableJson(expectedSaved)",
    recoveryIndex
  );
  const recoveredAcceptIndex = commitTheme.indexOf("saved = recovered", recoveryCompareIndex);
  assert.equal(
    0 <= expectedSavedIndex &&
      expectedSavedIndex < expectedRevisionIndex &&
      expectedRevisionIndex < saveIndex &&
      saveIndex < saveCatchIndex &&
      saveCatchIndex < recoveryIndex &&
      recoveryIndex < recoveryCompareIndex &&
      recoveryCompareIndex < recoveredAcceptIndex,
    true,
    "a post-persistence save error must accept only an exact fresh canonical recovery"
  );
  const publishCatchIndex = commitTheme.indexOf("catch (publishError)", publishIndex);
  const publishWarningIndex = commitTheme.indexOf(
    "live Button updates could not be published",
    publishCatchIndex
  );
  assert.equal(
    publishIndex < publishCatchIndex && publishCatchIndex < publishWarningIndex,
    true,
    "publish failure must be caught and returned as a warning after persistence"
  );
  const handleApplyStart = editor.indexOf("const handleApply = async");
  const handleApplyEnd = editor.indexOf("const handleSaveTheme", handleApplyStart);
  const handleApply = editor.slice(handleApplyStart, handleApplyEnd);
  assert.match(
    handleApply,
    /const committed = await commitCompleteTheme\(theme\)/
  );
  assert.match(file, /isFlowCellThemeFile\(theme\)/);
  assert.match(file, /initialDirectory: await flowCellThemeDirectory\(target\)/);
  assert.match(file, /initialDirectory: await flowCellThemeDirectory\(theme.target\)/);
  assert.match(nativeLayouts, /fn get_flowcell_theme_directory\(program_name: Option<String>\)[\s\S]{0,200}resolve_theme_directory/);
  assert.match(nativeLayouts, /save_flowcell_theme_file/);
  assert.match(nativeLayouts, /load_flowcell_theme_file/);
  assert.match(nativeLayouts, /\.flowtheme\.json/);
  assert.doesNotMatch(nativeLayouts, /FlowCellTheme[\s\S]{0,120}LayoutSnapshotFile/);
});

test("Theme Editor preserves loaded default-highlight resets without exposing legacy enablement or color controls", () => {
  const editor = read("src", "pages", "theme", "ThemeEditorPage.tsx");
  assert.match(editor, /const highlightColorResetPlacementIds = useRef/);
  assert.match(editor, /highlightColorResetPlacementIds: highlightColorResetPlacementIds\.current/);
  assert.match(editor, /const handleApply[\s\S]*?commitCompleteTheme\(theme\)/);
  assert.match(editor, /adoptHighlightColorResetIntents\(scoped, committed\.applied\)/);
  assert.doesNotMatch(editor, /applyHighlightChange|useDefaultHighlightColor|highlightSummary/);
});

test("Theme runtime publishes cross-window updates with a storage fallback", () => {
  const runtime = read("src", "theme", "themeRuntime.ts");
  const railSurface = read("src", "components", "RailSurface.tsx");
  const mainPage = read("src", "pages", "main", "MainPage.tsx");
  const macroLabCss = read("src", "pages", "macro-lab", "macroLabWindowPage.css");
  const bindsCss = read("src", "pages", "binds", "bindsWindowPage.css");
  const capability = JSON.parse(read("src-tauri", "capabilities", "default.json"));
  assert.match(runtime, /ACTIVE_PAGE_THEMES_STORAGE_KEY/);
  assert.match(runtime, /readActiveThemePageAppearance/);
  assert.match(runtime, /writeActiveThemePageAppearance/);
  assert.match(runtime, /listen[<(]/);
  assert.match(runtime, /emit\(/);
  assert.match(runtime, /addEventListener\(["']storage["']/);
  assert.match(runtime, /themePageTokenCssEntries/);
  assert.match(runtime, /style\.setProperty/);
  assert.match(runtime, /authorize_flowcell_theme_asset/);
  assert.match(runtime, /convertFileSrc/);
  assert.match(railSurface, /--flowcell-main-rail-\$\{cssRailId\}-background/);
  assert.match(railSurface, /--flowcell-main-rail-\$\{cssRailId\}-border/);
  assert.match(mainPage, /--flowcell-main-background-image/);
  assert.match(macroLabCss, /--flowcell-macro-lab-background/);
  assert.match(bindsCss, /--flowcell-binds-background/);
  assert.equal(capability.windows.includes("flowcell-theme-editor"), true);
});

test("every registered color variable has one fallback matching its registry default", () => {
  const staticFallbacks = parsedColorFallbacks([
    read("src", "pages", "main", "mainPage.css"),
    read("src", "pages", "macro-lab", "macroLabWindowPage.css"),
    read("src", "pages", "binds", "bindsWindowPage.css")
  ].join("\n"));
  const railSurface = read("src", "components", "RailSurface.tsx");
  assert.equal(
    railSurface.match(/var\(--flowcell-main-rail-\$\{cssRailId\}-background, \$\{rail\.background\}\)/g)?.length,
    1
  );
  assert.equal(
    railSurface.match(/var\(--flowcell-main-rail-\$\{cssRailId\}-border, \$\{rail\.border\}\)/g)?.length,
    1
  );

  for (const page of FLOWCELL_THEME_PAGE_REGISTRY) {
    for (const token of page.tokens) {
      const expected = normalizeButtonSkinColor(token.defaultValue)?.toLowerCase();
      assert.ok(expected, `${token.cssProperty} must declare a color default`);
      const railMatch = token.cssProperty.match(/^--flowcell-main-rail-(.+)-(background|border)$/);
      if (railMatch) {
        const rail = rails.find((candidate) => candidate.id === railMatch[1]);
        assert.ok(rail, `${token.cssProperty} must resolve to a registered Main rail`);
        const actual = normalizeButtonSkinColor(rail[railMatch[2]])?.toLowerCase();
        assert.equal(actual, expected, `${token.cssProperty} fallback must match its registry default`);
        continue;
      }
      const values = staticFallbacks.get(token.cssProperty);
      assert.ok(values, `${token.cssProperty} must have a CSS var fallback`);
      assert.equal(values.size, 1, `${token.cssProperty} must use one normalized fallback`);
      assert.equal([...values][0], expected, `${token.cssProperty} fallback must match its registry default`);
    }
  }
});

test("Theme and managed-window Layout schemas remain independent in both load orders", () => {
  const model = read("src", "theme", "themeModel.ts");
  const runtime = read("src", "theme", "themeRuntime.ts");
  const layoutRegistry = read("src", "lib", "layoutSnapshots.ts");
  const nativeLayouts = read("src-tauri", "src", "commands", "layouts.rs");
  const layoutStruct = nativeLayouts.match(/struct LayoutSnapshotFile\s*\{([\s\S]*?)\n\}/);
  assert.ok(layoutStruct, "strict native LayoutSnapshotFile schema must exist");
  assert.match(nativeLayouts, /struct LayoutSnapshotFile[\s\S]{0,160}deny_unknown_fields|deny_unknown_fields[\s\S]{0,160}struct LayoutSnapshotFile/);
  assert.doesNotMatch(layoutStruct[1], /theme/i);
  assert.doesNotMatch(
    `${model}\n${runtime}`,
    /layoutSnapshots|LayoutSnapshotFile|FlowCellWindowLayout|loadLayoutSnapshot|saveLayoutSnapshot/
  );
  assert.doesNotMatch(runtime, /WebviewWindow|getAll\(|setPosition\(|setSize\(|\.close\(/);
  assert.doesNotMatch(
    layoutRegistry,
    /FlowCellTheme|ThemePageAppearance|ACTIVE_PAGE_THEMES_STORAGE_KEY|\.flowtheme\.json/
  );
  assert.doesNotMatch(layoutRegistry, /document\.documentElement|style\.setProperty/);

  const packageJson = JSON.parse(read("package.json"));
  for (const existingTest of [
    "tests/buttonSystem.test.mjs",
    "tests/buttonEditorUiContract.test.mjs",
    "tests/mainLayoutFolder.test.mjs"
  ]) {
    assert.match(packageJson.scripts["test:button"], new RegExp(existingTest.replaceAll(".", "\\.")));
  }
  assert.match(packageJson.scripts["test:button"], /tests\/themeModelBehavior\.test\.mjs/);
});

test("Main page offers the Concrete theme and a bundled Concrete background", () => {
  const editor = read("src", "pages", "theme", "ThemeEditorPage.tsx");
  const runtime = read("src", "theme", "themeRuntime.ts");
  assert.match(editor, /<option value="concrete">Concrete<\/option>/);
  assert.match(editor, /pageValue === "main" \? \([\s\S]{0,400}MAIN_THEME_PRESETS\.map/);
  assert.match(editor, /mainThemePresetAppearance\(presetId\)/);
  assert.match(runtime, /import concreteBackground from "\.\.\/assets\/backgrounds\/concrete\.jpg";/);
  assert.match(runtime, /\bmode === "concrete"\s*\?\s*`url\("\$\{concreteBackground\}"\)`/);
  const concrete = readFileSync(path.join(root, "src", "assets", "backgrounds", "concrete.jpg"));
  assert.deepEqual([...concrete.subarray(0, 3)], [0xff, 0xd8, 0xff]);
});

test("Chipped Concrete stacks a page-sized base slab, rendered rail slabs and the Buttons", () => {
  const editor = read("src", "pages", "theme", "ThemeEditorPage.tsx");
  const runtime = read("src", "theme", "themeRuntime.ts");
  const railSurface = read("src", "components", "RailSurface.tsx");
  const css = read("src", "pages", "main", "mainPage.css");
  assert.match(editor, /<option value="chipped-concrete">Chipped Concrete<\/option>/);
  // The page itself is the base level: one page-sized slab picture, see-through past its edges.
  assert.match(runtime, /import chippedConcreteBase from "\.\.\/assets\/backgrounds\/chipped-concrete-base\.webp";/);
  assert.match(runtime, /\bmode === "chipped-concrete"\s*\?\s*`url\("\$\{chippedConcreteBase\}"\)`/);
  assert.match(runtime, /\["--flowcell-main-background-fill", "transparent"\]/);
  assert.match(runtime, /\["--flowcell-main-base-mask", `url\("\$\{chippedConcreteBase\}"\)`\]/);
  assert.match(css, /background-color: var\(--flowcell-main-background-fill, var\(--flowcell-main-background-color, #887F73\)\);/);
  // Chipped Concrete is the default Main look: "Default" resolves to it, and the Main page gets it with nothing saved.
  assert.match(runtime, /effectiveThemePageAssetMode\(background, appearance\.assets\["background-image"\]\) === "chipped-concrete"/);
  assert.match(runtime, /stored\.pages\[pageId\] \?\? \(pageId === "main" \? defaultThemePageAppearance\("main"\) : null\)/);
  assert.match(read("src", "pages", "main", "MainPage.tsx"), /import mainBackground from "\.\.\/\.\.\/assets\/backgrounds\/chipped-concrete-base\.webp";/);
  // Rail and header Button shadows stop at the base's edge, and the main window drops its frame shadow.
  assert.match(css, /\.main-page__button-group--placement-layer \{[^}]*mask-image: var\(--flowcell-main-base-mask, none\);/);
  assert.match(railSurface, /maskImage: "var\(--flowcell-main-base-mask, none\)"/);
  assert.match(railSurface, /maskSize: `\$\{pageFrame\.width\}px \$\{pageFrame\.height\}px`/);
  assert.match(railSurface, /maskPosition: `\$\{-\(MAIN_PAGE_BASE_OFFSET\.left \+ slabLeft\)\}px \$\{-\(MAIN_PAGE_BASE_OFFSET\.top \+ slabTop\)\}px`/);
  assert.match(runtime, /mainWindowShadow: appearance\.pageId === "main" \? !isChippedConcreteMain\(appearance\) : undefined/);
  assert.match(runtime, /if \(current\.label !== "main"\) return;/);
  const base = readFileSync(path.join(root, "src", "assets", "backgrounds", "chipped-concrete-base.webp"));
  assert.equal(base.subarray(0, 4).toString("latin1"), "RIFF");
  assert.equal(base.subarray(8, 12).toString("latin1"), "WEBP");
  assert.equal(existsSync(path.join(root, "src", "assets", "backgrounds", "chipped-concrete.jpg")), false);
  // The window's frame is the page plus a little room, so the base reaches just past the rails' shadows.
  // Rails and Buttons keep page coordinates: centered in the frame, or at the base offset under the slab.
  const layout = read("src", "pages", "main", "mainLayout.ts");
  const mainPage = read("src", "pages", "main", "MainPage.tsx");
  const config = JSON.parse(read("src-tauri", "tauri.conf.json"));
  const mainWindow = config.app.windows.find((window) => window.label === "main");
  const frame = layout.match(/export const pageFrame: PageRecord = \{\s*id: "main-page-frame",\s*width: (\d+),\s*height: (\d+),/);
  assert.ok(frame, "mainLayout.ts defines the main window frame");
  assert.deepEqual([mainWindow.width, mainWindow.height], [Number(frame[1]), Number(frame[2])]);
  assert.match(layout, /export const MAIN_PAGE_BASE_OFFSET = \{ left: 10, top: 0 \} as const;/);
  assert.match(runtime, /\["--flowcell-main-page-left", `\$\{MAIN_PAGE_BASE_OFFSET\.left\}px`\]/);
  assert.match(runtime, /\["--flowcell-main-page-top", `\$\{MAIN_PAGE_BASE_OFFSET\.top\}px`\]/);
  assert.match(mainPage, /<ExactPageFrame page=\{pageFrame\}>/);
  assert.match(mainPage, /<div className="main-page__content" style=\{MAIN_PAGE_CONTENT_STYLE\}>/);
  assert.match(mainPage, /left: `var\(--flowcell-main-page-left, \$\{\(pageFrame\.width - page\.width\) \/ 2\}px\)`/);
  assert.match(mainPage, /className="main-page__button-group main-page__button-group--placement-layer"\s*style=\{MAIN_PAGE_BASE_MASK_STYLE\}/);
  // The slab picture sits in its own layer: the rail itself clips, and the slab's chunks and shadow reach past it.
  assert.match(railSurface, /className="rail-surface__slab"/);
  assert.match(railSurface, /var\(--flowcell-main-rail-\$\{cssRailId\}-slab, none\)/);
  assert.match(railSurface, /var\(--flowcell-main-rail-backdrop-filter, blur\(/);
  assert.match(css, /\.rail-surface__slab \{[^}]*pointer-events: none;/);
  assert.match(runtime, /\["--flowcell-main-rail-backdrop-filter", "none"\]/);
  assert.match(runtime, /`--flowcell-main-rail-\$\{cssRailId\}-slab`/);
  for (const railId of ["program", "panel", "buttons", "info"]) {
    assert.match(runtime, new RegExp(`"${railId}-rail": \\{ url: chippedConcreteRail`));
    const slab = readFileSync(path.join(root, "src", "assets", "backgrounds", `chipped-concrete-rail-${railId}.webp`));
    assert.equal(slab.subarray(0, 4).toString("latin1"), "RIFF");
    assert.equal(slab.subarray(8, 12).toString("latin1"), "WEBP");
  }
});
