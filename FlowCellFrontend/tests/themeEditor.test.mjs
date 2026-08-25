import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
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

test("Theme Editor is opened from Main and discovers Blender only as a universal target", () => {
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
  assert.match(editor, /listProgramFolders\(\)/);
  assert.match(editor, /<option value=\{FLOWCELL_TARGET_VALUE\}>FlowCell<\/option>/);
  assert.match(editor, /<option value=\{ALL_PANELS_VALUE\}>All Panels<\/option>/);
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
  for (const blenderSource of [blenderScript, blenderPage, blenderManifest]) {
    assert.doesNotMatch(
      blenderSource,
      /theme-editor|theme\.buttons\.open|openThemeEditorWindow/i
    );
  }
});

test("Theme Editor reuses canonical Button geometry and persistence paths", () => {
  const editor = read("src", "pages", "theme", "ThemeEditorPage.tsx");
  const main = read("src", "pages", "main", "MainPage.tsx");
  const model = read("src", "theme", "themeModel.ts");
  const file = read("src", "theme", "themeFile.ts");
  const nativeLayouts = read("src-tauri", "src", "commands", "layouts.rs");
  assert.match(model, /resizeButtonPlacementSelection/);
  assert.match(model, /alignButtonPlacementSelectionToTopLeftButton/);
  assert.match(model, /buttonSpacingPixelsFromMillimeters/);
  assert.match(model, /function layoutMainGrid/);
  assert.match(model, /mainGridGaps/);
  assert.match(model, /templateEnvelope/);
  assert.match(model, /touchedGroups/);
  assert.match(model, /mainPageDefaultRect/);
  assert.match(model, /validateButtonStateDocument/);
  assert.doesNotMatch(
    main,
    /topLeftActionHeight|topLeftBaselineHeight|targetHeightOverride=/,
    "Main must render each top-left control at its independent canonical height"
  );
  for (const skinOwnedHelper of [
    "readButtonSkinHighlightOnHover",
    "setButtonSkinHighlightOnHover",
    "readButtonSkinHighlightOnActive",
    "setButtonSkinHighlightOnActive"
  ]) {
    assert.match(editor, new RegExp(`\\b${skinOwnedHelper}\\b`));
  }
  assert.match(editor, /gradientEnabled/);
  assert.match(editor, /scatterEnabled/);
  assert.match(editor, /buttonParticipation/);
  const gradientStart = editor.indexOf("const applyGradient =");
  const gradientEnd = editor.indexOf("const captureCurrentTheme", gradientStart);
  assert.notEqual(gradientStart, -1);
  assert.notEqual(gradientEnd, -1);
  const applyGradient = editor.slice(gradientStart, gradientEnd);
  const bakeIndex = applyGradient.indexOf("bakeThemeGradientForDeployedLayout(");
  const gradientDraftIndex = applyGradient.indexOf("updateDraft(", bakeIndex);
  const gradientColorIndex = applyGradient.indexOf("setSkinColorRoot(", gradientDraftIndex);
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
      authorizeIndex < saveIndex &&
      saveIndex < publishIndex &&
      publishIndex < pageIndex,
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
    /const committed = await commitTheme\(theme\);[\s\S]*acceptCommittedTheme\(committed\.saved, committed\.page\);/
  );
  assert.match(file, /isFlowCellThemeFile\(theme\)/);
  assert.match(nativeLayouts, /save_flowcell_theme_file/);
  assert.match(nativeLayouts, /load_flowcell_theme_file/);
  assert.match(nativeLayouts, /\.flowtheme\.json/);
  assert.doesNotMatch(nativeLayouts, /FlowCellTheme[\s\S]{0,120}LayoutSnapshotFile/);
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
