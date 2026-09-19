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
  assert.match(editor, /<option value=\{ALL_PANELS_VALUE\}>All Panels and Pop-outs<\/option>/);
  assert.match(editor, /<option value=\{POPOUTS_ONLY_VALUE\}>Pop-outs Only<\/option>/);
  assert.match(editor, /panelValue === POPOUTS_ONLY_VALUE/);
  assert.match(editor, /popoutsOnly \? \{ area: "popouts" as const \} : \{\}/);
  assert.match(editor, /current === POPOUTS_ONLY_VALUE/);
  assert.match(editor, /loadedTarget\.area === "popouts"[\s\S]{0,120}POPOUTS_ONLY_VALUE/);
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
  for (const blenderSource of [blenderScript, blenderPage, blenderManifest]) {
    assert.doesNotMatch(
      blenderSource,
      /theme-editor|theme\.buttons\.open|openThemeEditorWindow/i
    );
  }
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
  assert.match(editor, /ensureThemeOverride\(document, placementId\)\[field\] = amount/);
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
  const gradientColorIndex = applyGradient.indexOf("ensureThemeOverride(", gradientDraftIndex);
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

test("Theme Editor preserves loaded default-highlight resets without exposing legacy enablement or color controls", () => {
  const editor = read("src", "pages", "theme", "ThemeEditorPage.tsx");
  assert.match(editor, /const highlightColorResetPlacementIds = useRef/);
  assert.match(editor, /highlightColorResetPlacementIds: highlightColorResetPlacementIds\.current/);
  assert.match(editor, /const handleApply[\s\S]*?adoptHighlightColorResetIntents\(theme, committed\.applied\)/);
  assert.match(editor, /adoptHighlightColorResetIntents\(loaded\.theme, committed\.applied\)/);
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
