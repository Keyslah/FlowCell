import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const frontendRoot = join(import.meta.dirname, "..");
const editorRoot = join(frontendRoot, "src", "button", "editor");
const nativeRoot = join(frontendRoot, "src-tauri", "src");

function readEditorFile(fileName) {
  return readFileSync(join(editorRoot, fileName), "utf8");
}

function readEditorSources() {
  return readdirSync(editorRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:css|ts|tsx)$/.test(entry.name))
    .map((entry) => readEditorFile(entry.name))
    .join("\n");
}

test("Button Editor opens stay maximized on one monitor without drag-to-restore", () => {
  const windows = readFileSync(
    join(frontendRoot, "src", "button", "windows", "buttonWindows.ts"),
    "utf8"
  );
  const editor = readEditorFile("ButtonEditorPage.tsx");
  assert.match(windows, /const DEFAULT_EDITOR_WIDTH = 2093;/);
  assert.match(windows, /const DEFAULT_EDITOR_HEIGHT = 1322;/);
  assert.match(windows, /confineButtonWindowBoundsToWorkArea/);
  assert.match(
    windows,
    /resolvePlacement\(\s*DEFAULT_EDITOR_WIDTH,\s*DEFAULT_EDITOR_HEIGHT,\s*args\.bounds\s*\)/
  );
  assert.match(
    windows,
    /new WebviewWindow\(windowLabel, \{[\s\S]{0,180}width: DEFAULT_EDITOR_WIDTH,\s*height: DEFAULT_EDITOR_HEIGHT,/
  );
  assert.doesNotMatch(windows, /shouldMaximize/);
  assert.match(
    windows,
    /const maximized = await target\.isMaximized\(\)\.catch\(\(\) => false\);\s*if \(!maximized\) \{\s*await target\.maximize\(\);\s*\}[\s\S]{0,320}await showWindow\(target, true\);/
  );
  assert.match(editor, /event\.preventDefault\(\);\s*if \(maximized\) return;[\s\S]{0,500}currentWindow\.startDragging\(\)/);
});

test("FlowCell Main Page navigation never enters registered-program panel lookup or import", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  assert.match(
    editor,
    /void loadMainPageButtonBootstrap\(\)\s*\.then\(\(loaded\) => \{ if \(active\) setBootstrap\(loaded\); \}\)/
  );
  assert.doesNotMatch(editor, /\bensureFlowCellMainPageButtons\b/);
  const panelRefresh = editor.match(
    /useEffect\(\(\) => \{\s*if \(!programName\)[\s\S]*?\n  \}, \[programName\]\);/
  );
  assert.ok(panelRefresh, "program-scoped panel refresh effect must exist");
  const guardIndex = panelRefresh[0].indexOf("isFlowCellMainPageProgram(programName)");
  const lookupIndex = panelRefresh[0].indexOf("listPanelFolders(programName)");
  assert.ok(guardIndex >= 0, "synthetic Main Page program must be guarded");
  assert.ok(lookupIndex > guardIndex, "synthetic guard must run before registered-program lookup");
  assert.match(
    panelRefresh[0],
    /setPanels\(\[\.\.\.FLOWCELL_MAIN_PAGE_SECTIONS\]\);\s*return;/
  );
  assert.match(
    editor,
    /if \(isFlowCellMainPageProgram\(importProgramName\)\)[\s\S]{0,220}cannot receive deployable Button content/
  );
  assert.match(
    editor,
    /disabled=\{mainPageControlScope \|\| mode !== "edit" \|\| selectedSurfaceButtonCount < 2 \|\| busy\}/
  );
});

test("selected Main Page controls remain draggable in the edit workspace", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const workspace = readEditorFile("ButtonWorkspace.tsx");
  const overlay = readEditorFile("ButtonEditOverlay.tsx");
  const mainPage = readFileSync(join(frontendRoot, "src", "pages", "main", "MainPage.tsx"), "utf8");
  const mainButtonHost = readFileSync(
    join(frontendRoot, "src", "pages", "main", "MainButtonHost.tsx"),
    "utf8"
  );
  const mainPageCss = readFileSync(
    join(frontendRoot, "src", "pages", "main", "mainPage.css"),
    "utf8"
  );
  assert.doesNotMatch(editor, /lockPlacementPosition/);
  assert.doesNotMatch(workspace, /lockPlacementPosition|allowDrag/);
  assert.doesNotMatch(overlay, /allowDrag/);
  assert.match(overlay, /cursor: "move"/);
  assert.match(overlay, /onPointerDown=\{\(event\) => begin\("drag", event\)\}/);
  assert.match(
    mainPage,
    /\.map\(\(button\) => resolveFlowCellMainPageButtonLayout\(buttonDocument, button\)\)/
  );
  assert.doesNotMatch(mainPage, /absolute=\{false\}/);
  assert.match(mainPage, /main-page__button-group--placement-layer/g);
  assert.match(
    mainPageCss,
    /\.main-page__button-group--placement-layer\s*\{[\s\S]{0,120}pointer-events: none;/
  );
  assert.match(mainButtonHost, /left: absolute \? button\.x : undefined/);
  assert.match(mainButtonHost, /top: absolute \? button\.y : undefined/);
});

test("Main preserves the validated canonical Button document when source bootstrap fails", () => {
  const mainPage = readFileSync(
    join(frontendRoot, "src", "pages", "main", "MainPage.tsx"),
    "utf8"
  );
  const subscribeIndex = mainPage.indexOf("await subscribeButtonCommits(");
  const sequenceIndex = mainPage.indexOf(
    "await runButtonStateBootstrapSequence(",
    subscribeIndex
  );
  const acceptIndex = mainPage.indexOf(
    "acceptButtonDocument(initialDocument);",
    sequenceIndex
  );
  assert.ok(subscribeIndex >= 0, "Main must subscribe to canonical commits");
  assert.ok(
    sequenceIndex > subscribeIndex,
    "Main must subscribe before loading the canonical snapshot"
  );
  assert.ok(
    acceptIndex > sequenceIndex,
    "Main must pass snapshot acceptance through the fail-soft sequence"
  );

  const bootstrapEffectEnd = mainPage.indexOf("// Motion settings", sequenceIndex);
  const bootstrapEffect = mainPage.slice(subscribeIndex, bootstrapEffectEnd);
  assert.match(
    bootstrapEffect,
    /FlowCell kept the last valid canonical Button document and its skins\./
  );
  assert.match(bootstrapEffect, /setButtonBootstrapError\(/);
  assert.doesNotMatch(bootstrapEffect, /setButtonDocument\(null\)/);
  assert.match(
    mainPage,
    /buttonDocument && topLeftActionButtons\.length > 0/
  );
  assert.match(
    mainPage,
    /buttonDocument && topRightActionButtons\.length > 0/
  );
  assert.match(
    mainPage,
    /buttonDocument \? independentlyPositionedButtons\.map/
  );
  assert.match(mainPage, /className="main-page__bootstrap-error"/);
  assert.match(mainPage, /role="alert"/);
});

test("Button workspace supports marquee selection and one atomic rigid group move", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const workspace = readEditorFile("ButtonWorkspace.tsx");
  const css = readEditorFile("buttonEditor.css");

  assert.match(workspace, /export type ButtonWorkspaceSelectionMode = "replace" \| "add" \| "toggle"/);
  assert.match(workspace, /onPointerDownCapture=\{beginSelectedGroupDrag\}/);
  assert.match(workspace, /for \(const target of event\.composedPath\(\)\)/);
  assert.match(workspace, /pointerPlacementId\(event\.nativeEvent\)/);
  assert.match(workspace, /onSelectPlacements\(placementIds, marqueeInteraction\.selectionMode\)/);
  assert.match(workspace, /resolveButtonGroupTranslationAlongPath\(/);
  assert.match(workspace, /onPlacementRectsChange\(surfaceId, groupDrag\.lastPlacements\)/);
  assert.match(
    workspace,
    /selectedVisiblePlacementIds\.length === 1[\s\S]{0,180}<ButtonEditOverlay/
  );
  assert.match(css, /\.button-workspace-marquee\s*\{[\s\S]{0,220}pointer-events:\s*none/);
  assert.match(editor, /onSelectPlacements=\{selectWorkspacePlacements\}/);
  assert.match(editor, /onPlacementRectsChange=\{updatePlacementRects\}/);
  assert.match(editor, /store\.transact\([\s\S]{0,500}label: "Move selected Buttons"/);
});

test("Button workspace shows every selected Button and Shift toggles selection membership", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const workspace = readEditorFile("ButtonWorkspace.tsx");
  const overlay = readEditorFile("ButtonEditOverlay.tsx");
  const css = readEditorFile("buttonEditor.css");
  const clickSelection = editor.match(
    /const selectWorkspacePlacement = useCallback\([\s\S]*?\n  const selectWorkspacePlacements = useCallback/
  );

  assert.ok(clickSelection, "workspace click-selection handler must exist");
  assert.match(clickSelection[0], /event\.ctrlKey \|\| event\.metaKey \|\| event\.shiftKey/);
  assert.match(
    clickSelection[0],
    /if \(next\.has\(placementId\)\) next\.delete\(placementId\);\s*else next\.add\(placementId\);/
  );
  assert.match(
    workspace,
    /event\.ctrlKey \|\| event\.metaKey \|\| event\.shiftKey\s*\? "toggle"\s*:\s*"replace"/
  );
  assert.match(
    overlay,
    /kind === "drag"[\s\S]{0,160}event\.shiftKey \|\| event\.ctrlKey \|\| event\.metaKey[\s\S]{0,180}onSelect\(event\.nativeEvent\)/
  );
  assert.match(
    workspace,
    /selectedVisiblePlacementIds\.map\(\(placementId\) => \{[\s\S]{0,220}renderedDocument\.placements\[placementId\][\s\S]{0,420}data-button-selection-indicator=\{placementId\}[\s\S]{0,100}aria-hidden="true"/
  );
  assert.match(
    css,
    /\.button-workspace-selection-indicator\s*\{[\s\S]{0,360}pointer-events:\s*none/
  );
  assert.match(css, /\.button-workspace-selection-indicator\s*\{[\s\S]{0,300}box-shadow:\s*inset/);
  assert.doesNotMatch(css, /\.button-workspace-selection-indicator::after/);
  assert.match(
    editor,
    /className="button-editor-sidebar__selection"[\s\S]{0,700}selectedPlacementSummaries\.map[\s\S]{0,320}\{entry\.label\}/
  );
});

test("copied Button dimensions apply atomically to the selection with row-preserving fallback", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const handler = editor.match(
    /const addCopiedSizeToSelection = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[copiedButtonSizing, selectedPlacementIds, selectedSurfaceId, store\]\);/
  );

  assert.ok(handler, "selection-size handler must exist");
  assert.match(editor, /const \[copiedButtonSizing, setCopiedButtonSizing\] = useState<CopiedButtonSizing \| null>\(null\)/);
  assert.match(
    editor,
    /width: placement\.width,[\s\S]{0,100}height: placement\.height,[\s\S]{0,100}sizingMode: buttonPlacementSizingMode\(placement\)/
  );
  assert.doesNotMatch(handler[0], /if \(surface\.uniformButtonSize\)/);
  assert.match(handler[0], /selectedPlacementIds\.has\(placementId\)/);
  assert.match(handler[0], /resizeButtonPlacementSelection\(\{/);
  assert.match(handler[0], /targetSize: copiedButtonSizing/);
  assert.match(handler[0], /gap: buttonSpacingPixelsFromMillimeters\(document\.settings\.buttonSpacingMm\)/);
  assert.match(handler[0], /independentPlacementIds: ownerPlacementId/);
  assert.match(handler[0], /const sizingPatch = buttonPlacementSizingPatch\(copiedButtonSizing\)/);
  assert.match(
    handler[0],
    /store\.transact\([\s\S]{0,220}draft\.surfaces\[surface\.id\]\.uniformButtonSize = null;[\s\S]{0,220}sizeResolution\.placements\.forEach/
  );
  assert.doesNotMatch(handler[0], /compactButtonPlacements|applyPlacementOrder|translateButtonPlacementRects/);
  assert.ok(
    handler[0].indexOf("if (!sizeResolution.success)") < handler[0].indexOf("store.transact"),
    "the complete row-preserving resolution must succeed before the one selection transaction"
  );
  assert.match(editor, />\s*Copy dimensions\s*</);
  assert.match(editor, />\s*Add size to selection\s*</);
  const addSizeControl = editor.match(
    /<button[\s\S]{0,900}onClick=\{addCopiedSizeToSelection\}[\s\S]{0,120}>\s*Add size to selection/
  );
  assert.ok(addSizeControl, "Add size to selection control must exist");
  assert.doesNotMatch(addSizeControl[0], /allSurfaceButtonsSameSize/);
  assert.match(
    editor,
    /disabled=\{[\s\S]{0,180}!copiedButtonSizing[\s\S]{0,180}selectedSetForSurface\.size === 0/
  );
});

test("Pop hides its owner while Fan shows it without including the owner in row reorder", () => {
  const workspace = readEditorFile("ButtonWorkspace.tsx");

  assert.match(
    workspace,
    /unitOwnerPlacementId === placementId && unitInteractionMode !== "fan"/
  );
  assert.match(
    workspace,
    /visiblePlacementIds\.filter\(\(placementId\) => placementId !== ownerPlacementId\)/
  );
  assert.match(workspace, /placementIds: \[\.\.\.visiblePlacementIds\]/);
  assert.match(workspace, /unitOwnerPlacementId === overlayPlacement\.id/);
  assert.match(workspace, /unbounded=\{overlayIsFanOwner\}/);
});

test("Tool Set owners expose one Pop-out Placement and use its Fan checkbox", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const selection = readEditorFile("buttonEditorSelection.ts");

  assert.match(selection, /if \(button\.role === "tool-set-child"\) return false/);
  assert.match(selection, /label: "Pop-out"[\s\S]{0,420}view: "tool-set-popout"/);
  assert.doesNotMatch(selection, /tool-set-fan/);
  assert.match(editor, /buttonId=\{navigationButtonId\}/);
  assert.match(editor, /placementId=\{selectedPlacementOptionId\}/);
  assert.match(selection, /view: "placement" \| "tool-set-popout" \| "default-popout"/);
  assert.match(
    editor,
    /const selectDefaultPopoutPlacement = useCallback\([\s\S]{0,900}ensureRegularPopout\(next, \[button\]\)[\s\S]{0,900}store\.transact\(\(\) => next/
  );
  assert.match(
    editor,
    /option\?\.view === "default-popout"[\s\S]{0,120}selectDefaultPopoutPlacement\(navigationButtonId\)/
  );
  assert.match(editor, /if \(option\?\.placementId\) \{[\s\S]{0,100}focusPlacement\(option\.placementId\)/);
  assert.match(editor, /setButtonPopoutFanMode\(\{/);
  assert.match(editor, /mode === "fan"[\s\S]{0,260}result\.ownerPlacementId/);
  assert.match(
    editor,
    /settingsPlacementKind === "pop-out" && selectedSurfaceUnit[\s\S]{0,180}button-editor-sidebar__fan/
  );
  const contextHandler = editor.match(
    /const applyEditorContext = useCallback\([\s\S]*?\n  \}, \[focusPlacement, panelName, programName, store\]\);/
  );
  assert.ok(contextHandler, "existing Editor context handler must exist");
  assert.match(
    contextHandler[0],
    /if \(context\.programName\)[\s\S]{0,100}setProgramName\(context\.programName\)/
  );
  assert.match(
    contextHandler[0],
    /if \(context\.panelName\)[\s\S]{0,100}setPanelName\(context\.panelName\)/
  );
});

test("Same size Buttons changes only content dimensions and keeps the Fan owner independent", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const handler = editor.match(
    /const applyUniformSizeToSurface = useCallback\([\s\S]*?\n  \}, \[store\]\);/
  );

  assert.ok(handler, "uniform surface sizing handler must exist");
  assert.match(handler[0], /resolveIndependentOwnerPlacementId\(document, surfaceId\)/);
  assert.match(
    handler[0],
    /contentPlacementIds = surface\.placementIds\.filter\([\s\S]{0,160}placementId !== independentOwnerPlacementId/
  );
  assert.match(handler[0], /resizeUniformButtonPlacementsInPlace\(/);
  assert.doesNotMatch(
    handler[0],
    /compactUniformButtonPlacements|compactButtonPlacements|applyPlacementOrder|buttonSpacingPixelsFromMillimeters|placementIds:|zIndex/
  );
  assert.match(handler[0], /width: resizedPlacement\.rect\.width,\s*height: resizedPlacement\.rect\.height/);
  assert.doesNotMatch(handler[0], /x: resizedPlacement|y: resizedPlacement|\.rect,|\.rect\}/);
  assert.ok(
    handler[0].indexOf("if (!resized.success)") < handler[0].indexOf("store.transact"),
    "the complete fixed-coordinate resize must validate before its transaction"
  );
});

test("top-left corner alignment translates only selected content as one rigid group", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const handler = editor.match(
    /const snapSelectedSurfaceToTopLeft = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[selectedPlacementIds, selectedSurfaceId, store\]\);/
  );

  assert.ok(handler, "selection-scoped top-left handler must exist");
  assert.match(handler[0], /selectedPlacementIds\.has\(placementId\)/);
  assert.match(handler[0], /const ownerPlacementId = unitOwnerPlacementId \?\? legacyFanOwnerPlacementId/);
  assert.match(handler[0], /selectedPlacementIds\.has\(placementId\) && placementId !== ownerPlacementId/);
  assert.match(handler[0], /translateButtonPlacementRects\(items, \{/);
  assert.match(handler[0], /x: -anchor\.rect\.x/);
  assert.match(handler[0], /y: -anchor\.rect\.y/);
  assert.match(handler[0], /label: "Align top-left Button to corner"/);
  assert.match(handler[0], /rect: translatedById\.get\(placement\.id\) \?\? placement/);
  assert.doesNotMatch(handler[0], /compactButtonPlacementRows|inferButtonPlacementRows|applyPlacementOrder/);
});

test("Align to the Top Left button keeps the anchor and existing content rows", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const handler = editor.match(
    /const alignSelectionToTopLeftButton = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[selectedPlacementIds, selectedSurfaceId, store\]\);/
  );

  assert.ok(handler, "top-left Button row-alignment handler must exist");
  assert.match(handler[0], /selectedPlacementIds\.has\(placementId\)/);
  assert.match(handler[0], /alignButtonPlacementSelectionToTopLeftButton\(\{/);
  assert.match(handler[0], /gap: buttonSpacingPixelsFromMillimeters\(document\.settings\.buttonSpacingMm\)/);
  assert.match(handler[0], /independentPlacementIds: ownerPlacementId/);
  assert.match(handler[0], /if \(!alignment\.success\)[\s\S]{0,220}return;/);
  assert.match(handler[0], /label: "Align to the Top Left button"/);
  assert.match(
    editor,
    />\s*Align top-left Button to corner\s*<\/button>\s*<button[\s\S]{0,700}alignSelectionToTopLeftButton\(\);[\s\S]{0,160}>\s*Align to the Top Left button\s*<\/button>/
  );
});

test("removed editor action and Fan-construction surfaces stay absent", () => {
  for (const removedFile of ["Button" + "Library.tsx", "Fan" + "Builder.tsx"]) {
    assert.equal(
      existsSync(join(editorRoot, removedFile)),
      false,
      `${removedFile} must stay deleted`
    );
  }

  const editorSources = readEditorSources();
  assert.doesNotMatch(editorSources, /button-library|button-fan-builder/);
});

test("Skin Editor keeps automatic paste handling without removed or unrequested apply buttons", () => {
  const skinEditor = readEditorFile("ButtonSkinEditor.tsx");
  assert.doesNotMatch(skinEditor, /Apply Named Sections/);
  assert.doesNotMatch(skinEditor, /Replace Entire Skin/);
  assert.doesNotMatch(skinEditor, /Apply Button Text/);
  assert.match(skinEditor, /onPaste=\{\(event\)\s*=>\s*\{[\s\S]{0,320}applyPaste\(source\);/);
  assert.match(skinEditor, /onChange=\{\(event\) => \{[\s\S]{0,260}applyPaste\(source\);/);
  assert.match(skinEditor, /className="button-skin-working-preview"/);
  assert.match(
    skinEditor,
    /setWorkingSkin\(next\);[\s\S]{0,180}setWorkingPreviewUsesNaturalSize\(true\);[\s\S]{0,180}setPaste\(""\);\s*setUpdatedSections/
  );
});

test("Save Settings uses the selected placement type folder and complete scoped persistence", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const repository = readFileSync(
    join(frontendRoot, "src", "button", "state", "ButtonStateRepository.ts"),
    "utf8"
  );
  assert.match(editor, /showSaveFileDialog\(\{[\s\S]{0,260}Save \$\{placementLabel\} Settings/);
  assert.match(editor, /defaultFileName:\s*defaultButtonSettingsFileName\(placementKind\)/);
  assert.match(
    editor,
    /getButtonSettingsDirectory\(\s*placementKind,\s*programName,\s*panelName\s*\)/
  );
  assert.match(
    repository,
    /getButtonSettingsDirectory\(\s*placementKind: ButtonSettingsPlacementKind,\s*programName: string,\s*panelName: string\s*\)/
  );
  assert.match(
    repository,
    /invoke<string>\("get_button_settings_directory", \{\s*placementKind,\s*programName,\s*panelName\s*\}\)/
  );
  assert.match(
    repository,
    /legacyButtonSettingsFileName\([\s\S]{0,900}legacyMarker[\s\S]{0,900}\.flowcell-button-settings\.json/
  );
  assert.match(
    repository,
    /resolveButtonSettingsFilePath\([\s\S]{0,500}legacyButtonSettingsFileName\(path, placementKind\)[\s\S]{0,500}getButtonSettingsDirectory\(\s*placementKind,\s*programName,\s*panelName\s*\)[\s\S]{0,220}rebaseLegacyButtonSettingsFilePath/
  );
  assert.match(editor, /initialDirectory:\s*settingsDirectory/);
  assert.match(editor, /const saveSettings = async \(\) => \{\s*if \(busyRef\.current\) return;\s*setBusy\(true\);/);
  assert.match(editor, /const settingsDraft = cloneButtonDocument\(store\.current\(\)\)/);
  assert.match(editor, /const editorBaseline = cloneButtonDocument\(store\.committed\)/);
  assert.match(editor, /buildButtonSettingsScopedDocument\(\s*committedDocument,\s*settingsDraft,[\s\S]{0,180}editorBaseline/);
  assert.match(editor, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
  assert.match(editor, /committedDocument = await loadButtonStateDocument\(\)/);
  assert.match(editor, /const committedSettingsFile = buildButtonSettingsFile\(saved, selectedSurfaceId/);
  assert.match(editor, /saveButtonSettingsFile\(targetPath, committedSettingsFile\)/);
  assert.ok(
    editor.indexOf("saved = await saveButtonStateDocument") <
      editor.indexOf("const committedSettingsFile = buildButtonSettingsFile(saved")
  );
  assert.ok(
    editor.indexOf("const committedSettingsFile = buildButtonSettingsFile(saved") <
      editor.indexOf("saveButtonSettingsFile(targetPath, committedSettingsFile)")
  );
  assert.doesNotMatch(editor, /(?:read|write)LastLayoutDirectory/);
  assert.match(editor, /onClick=\{\(\) => void saveSettings\(\)\}[\s\S]{0,100}Save \{settingsPlacementLabel\} Settings/);
});

test("all scoped Editor commits and settings defaults rebase boundedly on revision conflicts", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const scopedCommit = editor.match(
    /const commitScopedDocument = async \([\s\S]*?\n  const saveSettings = async/
  );
  assert.ok(scopedCommit, "scoped commit helper must exist");
  assert.match(scopedCommit[0], /buildNext: \(committed: ButtonStateDocument\)/);
  assert.match(scopedCommit[0], /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
  assert.match(scopedCommit[0], /details\.includes\("Button state changed before Save\."\)/);
  assert.match(scopedCommit[0], /committed = await loadButtonStateDocument\(\)/);
  assert.match(editor, /\(committed\) => buildButtonSkinScopedDocument\(committed, frozenDraft, scope\)/);
  assert.match(editor, /\(latest\) => buildButtonTextScopedDocument\(latest, frozenDraft, scope\)/);
  assert.match(editor, /isButtonSettingsDefaultRevisionConflict/);
  assert.match(
    editor,
    /Button state changed before the settings default was saved\./
  );
  assert.match(editor, /const settingsDraft = cloneButtonDocument\(store\.current\(\)\);[\s\S]{0,160}const editorBaseline = cloneButtonDocument\(store\.committed\);/);
});

test("Load Settings and placement defaults use the selected type and required button order", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  assert.match(
    editor,
    /const loadSettings = async \(\) => \{\s*if \(busyRef\.current\) return;\s*setBusy\(true\);/
  );
  assert.match(editor, /showOpenFileDialog\(\{[\s\S]{0,180}title: `Load \$\{settingsPlacementLabel\} Settings`/);
  assert.match(
    editor,
    /getButtonSettingsDirectory\(\s*settingsPlacementKind,\s*programName,\s*panelName\s*\)/
  );
  assert.match(editor, /initialDirectory:\s*settingsDirectory/);
  assert.match(editor, /multiselect:\s*false/);
  assert.match(editor, /const settingsFile = await loadButtonSettingsFile\(selectedPath\)/);
  assert.match(editor, /applyButtonSettingsFile\(\s*store\.current\(\),\s*selectedSurfaceId/);
  assert.match(editor, /initializeButtonSettingsDefault\(/);
  assert.match(editor, /loadButtonSettingsDefault\(/);
  assert.match(editor, /updateButtonSettingsDefault\(/);
  assert.doesNotMatch(editor, /getParentDirectory/);
  const saveIndex = editor.indexOf("Save {settingsPlacementLabel} Settings");
  const loadIndex = editor.indexOf("Load {settingsPlacementLabel} Settings");
  const loadDefaultIndex = editor.indexOf("Load {settingsPlacementLabel} Default");
  const updateDefaultIndex = editor.indexOf("Update {settingsPlacementLabel} Default");
  assert.ok(saveIndex >= 0);
  assert.ok(saveIndex < loadIndex);
  assert.ok(loadIndex < loadDefaultIndex);
  assert.ok(loadDefaultIndex < updateDefaultIndex);
  assert.doesNotMatch(editor, />\s*Save placement\s*</);
  assert.doesNotMatch(editor, />\s*Load placement\s*</);
  assert.doesNotMatch(editor, /settingsPlacementLabel[\s\S]{0,100}:\s*"Placement"/);
  assert.match(editor, /settingsPlacementKind \?\? "main-page"/);
});

test("Open Pop stays transient while Main Pop falls back to a canonical default", () => {
  const main = readFileSync(
    join(frontendRoot, "src", "pages", "main", "MainPage.tsx"),
    "utf8"
  );
  const layout = readFileSync(
    join(frontendRoot, "src", "pages", "main", "mainLayout.ts"),
    "utf8"
  );
  const settings = readFileSync(
    join(frontendRoot, "src", "button", "state", "buttonSettingsFile.ts"),
    "utf8"
  );
  const windows = readFileSync(
    join(frontendRoot, "src", "button", "windows", "buttonWindows.ts"),
    "utf8"
  );
  const transientPopBlock = main.match(
    /const openMainPopChoice = async \([\s\S]*?\n  const openDefaultPanelPop = async/
  );
  assert.ok(transientPopBlock, "Main transient Pop file handler must exist");
  assert.match(transientPopBlock[0], /buildTransientButtonPopoutSettingsDocument/);
  assert.match(transientPopBlock[0], /registerButtonDraftResponder/);
  assert.match(transientPopBlock[0], /publishButtonDraftToWindow/);
  assert.match(
    transientPopBlock[0],
    /settingsBackedLayout:\s*\{[\s\S]{0,120}panelOwnerButtonId,[\s\S]{0,180}settingsPath:\s*choice\.path[\s\S]{0,120}choiceId:\s*choice\.choiceId/
  );
  assert.doesNotMatch(transientPopBlock[0], /registerInLayout:\s*false/);
  assert.match(transientPopBlock[0], /writeMainLastPopChoice/);
  assert.doesNotMatch(transientPopBlock[0], /ensureRegularPopout|commitButtonDocumentMutation/);

  const defaultPopBlock = main.match(
    /const openDefaultPanelPop = async \([\s\S]*?\n  const handleChoosePanelPop = async/
  );
  assert.ok(defaultPopBlock, "Main default Pop fallback must exist");
  assert.match(defaultPopBlock[0], /commitButtonDocumentMutation\(\(draft\) =>/);
  assert.match(defaultPopBlock[0], /candidate\.role === "single-script"/);
  assert.match(defaultPopBlock[0], /ensureRegularPopout\(draft, memberButtons\)/);
  assert.match(defaultPopBlock[0], /if \(!choice\) \{[\s\S]{0,120}openDefaultPanelPop/);
  assert.match(defaultPopBlock[0], /openButtonPopoutWindow\(\{/);
  assert.doesNotMatch(defaultPopBlock[0], /Use Open Pop first\./);
  assert.match(
    main,
    /getButtonSettingsDirectory\(\s*"pop-out",\s*selectedProgramName,\s*selectedPanelName\s*\)/
  );
  assert.match(
    main,
    /resolveButtonSettingsFilePath\(\s*windowEntry\.ButtonPopoutSettingsPath,\s*"pop-out",\s*windowEntry\.ProgramName,\s*windowEntry\.PanelName\s*\)/
  );
  assert.match(
    main,
    /choice = \{\s*\.\.\.choice,\s*path: await resolveButtonSettingsFilePath\(\s*choice\.path,\s*"pop-out",\s*programName,\s*panelName\s*\)/
  );
  assert.match(main, /showOpenFileDialog\(\{/);

  const transientBuilder = settings.slice(
    settings.indexOf("export function buildTransientButtonPopoutSettingsDocument")
  );
  assert.doesNotMatch(transientBuilder, /applyButtonSettingsFile\(/);
  assert.match(transientBuilder, /open-pop-surface-/);
  assert.match(transientBuilder, /open-pop-unit-/);

  assert.match(
    layout,
    /id:\s*"buttons-open-pop"[\s\S]{0,180}stepX \* 2[\s\S]{0,100}fanControlsY[\s\S]{0,260}label:\s*"Open Pop"[\s\S]{0,180}actionId:\s*"open-panel-pop-file"/
  );
  assert.match(
    layout,
    /id:\s*"buttons-pop-selection"[\s\S]{0,180}stepX \* 3[\s\S]{0,100}fanControlsY[\s\S]{0,260}label:\s*"Pop"[\s\S]{0,220}last-used Pop-out file, or its default Pop-out/
  );
  assert.ok(layout.indexOf('label: "Open Pop"') < layout.indexOf('label: "Pop"'));
  assert.match(windows, /registerInLayout\?: boolean/);
  assert.match(windows, /settingsBackedLayout\?: \{/);
  assert.match(windows, /panelOwnerButtonId:\s*settingsBackedLayout\?\.panelOwnerButtonId/);
  assert.match(windows, /buttonPopoutSettingsPath:\s*settingsBackedLayout\?\.settingsPath/);
  assert.match(
    windows,
    /if \(args\.registerInLayout !== false\) \{[\s\S]{0,160}registerLayoutWindow/
  );
});

test("Skin assignment is explicit and selected-only unless Panel assignment is chosen", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const skinEditor = readEditorFile("ButtonSkinEditor.tsx");
  assert.match(editor, /onAssignSkin=\{\(skin, sizingMode\) => \{[\s\S]{0,300}\[selectedPlacement\.id\]/);
  assert.match(
    editor,
    /onAssignSkinToSelection=\{\(skin, sizingMode\) => \{[\s\S]{0,300}surface\.placementIds\.filter[\s\S]{0,180}selectedSetForSurface\.has\(placementId\)[\s\S]{0,300}assignWorkingSkin/
  );
  assert.match(editor, /onAssignSkinToPanel=\{\(skin, sizingMode\) => \{[\s\S]{0,420}resolveButtonEditorSurfaceSkinTargetPlacementIds/);
  assert.match(skinEditor, />\s*Assign Skin to Selection\s*</);
  assert.match(
    skinEditor,
    /onAssignSkinToSelection\(workingSkinForPersistence\(\), sizingMode\)/
  );
  assert.doesNotMatch(editor, /onSkinChange=/);
  assert.doesNotMatch(editor, /onLoadSkin=/);
});

test("Button Text exposes selected-placement horizontal alignment", () => {
  const editor = readEditorFile("ButtonSkinEditor.tsx");
  assert.match(editor, /Text alignment/);
  assert.match(editor, /value=\{placement\.textAlignment\}/);
  assert.match(editor, /value:\s*"center",\s*label:\s*"Center"/);
  assert.match(editor, /onPlacementTextChange\(\s*\{ textAlignment:/);
  assert.match(editor, /textAlignment=\{placement\.textAlignment\}/);
  assert.match(editor, /Move text X[\s\S]{0,700}\{ textOffsetX: value \}/);
  assert.match(editor, /Move text Y[\s\S]{0,700}\{ textOffsetY: value \}/);
  assert.equal((editor.match(/textOffsetX=\{placement\.textOffsetX\}/g) ?? []).length, 3);
  assert.equal((editor.match(/textOffsetY=\{placement\.textOffsetY\}/g) ?? []).length, 3);
});

test("Button Text exposes the complete selectable Button Tooltip beside the active label", () => {
  const skinEditor = readEditorFile("ButtonSkinEditor.tsx");
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const css = readEditorFile("buttonEditor.css");
  const textSection = skinEditor.match(
    /<summary title="Edit Button labels and the shared Button Tooltip[\s\S]*?<\/details>/
  );
  assert.ok(textSection, "Button Text section must exist");

  assert.match(skinEditor, /buttonTooltip: string;/);
  assert.match(skinEditor, /onButtonTooltipChange: \(tooltip: string\) => void;/);
  assert.match(
    textSection[0],
    /className="button-text-label-grid"[\s\S]{0,1200}<span>Button Tooltip<\/span>[\s\S]{0,320}<textarea[\s\S]{0,360}value=\{buttonTooltip\}[\s\S]{0,320}onButtonTooltipChange\(event\.currentTarget\.value\)/
  );
  assert.doesNotMatch(textSection[0], /<span>Button Tooltip<\/span>\s*<input/);
  assert.match(textSection[0], /ref=\{buttonTooltipEditorRef\}/);
  assert.match(textSection[0], /className="button-tooltip-editor"/);
  assert.match(textSection[0], /rows=\{3\}/);
  assert.match(textSection[0], /wrap="soft"/);
  assert.match(textSection[0], /complete tooltip stays visible and selectable/);
  assert.match(skinEditor, /function resizeButtonTooltipEditor[\s\S]{0,320}editor\.scrollHeight/);
  assert.match(skinEditor, /useLayoutEffect\(\(\) => \{[\s\S]{0,180}buttonTooltipEditorRef\.current[\s\S]{0,140}\[buttonTooltip, skinContextKey, skin\?\.id\]/);
  assert.match(skinEditor, /new ResizeObserver\(resizeForWidth\)/);
  assert.match(skinEditor, /onToggle=\{\(event\) => \{[\s\S]{0,260}resizeButtonTooltipEditor/);
  assert.match(editor, /buttonTooltip=\{selectedButton\?\.tooltip \?\? ""\}/);
  assert.match(
    editor,
    /onButtonTooltipChange=\{\(tooltip\) => \{[\s\S]{0,260}target\.tooltip = tooltip;[\s\S]{0,180}coalesceKey: `tooltip:\$\{selectedButton\.id\}`/
  );
  assert.match(css, /\.button-text-label-grid[\s\S]{0,160}grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  const tooltipEditorCss = css.match(/\.button-tooltip-editor\s*\{[\s\S]*?\}/);
  assert.ok(tooltipEditorCss, "Button Tooltip editor styles must exist");
  assert.match(tooltipEditorCss[0], /field-sizing:\s*content/);
  assert.match(tooltipEditorCss[0], /max-height:\s*none/);
  assert.match(tooltipEditorCss[0], /overflow:\s*hidden/);
  assert.match(tooltipEditorCss[0], /overflow-wrap:\s*anywhere/);
  assert.match(tooltipEditorCss[0], /white-space:\s*pre-wrap/);
  assert.match(tooltipEditorCss[0], /user-select:\s*text/);
  assert.doesNotMatch(tooltipEditorCss[0], /text-overflow|nowrap/);
});

test("Button Color follows Button Text with semantic profile parts, visible Text, and eyedropper controls", () => {
  const editor = readEditorFile("ButtonSkinEditor.tsx");
  const css = readEditorFile("buttonEditor.css");
  const textIndex = editor.indexOf("<span>Button Text</span>");
  const colorIndex = editor.indexOf("<span>Button Color</span>");
  const highlightIndex = editor.indexOf("<span>Highlight on hover</span>");
  assert.ok(textIndex >= 0);
  assert.ok(colorIndex > textIndex);
  assert.ok(highlightIndex > colorIndex);
  assert.match(editor, /className="button-skin-section button-color-section" open/);
  assert.match(editor, /workingMaterialProfile\.length/);
  assert.match(editor, /workingMaterialProfile\.map\(\(profileColor\) =>/);
  assert.match(editor, /label=\{profileColor\.label\}/);
  assert.match(editor, /type="color"[\s\S]{0,500}type="text"/);
  assert.match(editor, /new EyeDropper\(\)\.open\(\)/);
  assert.match(editor, /buttonSkinColorWithPreservedAlpha/);
  assert.match(editor, /label="Text Color"/);
  assert.match(editor, /preserveAlpha=\{false\}/);
  assert.match(editor, /onUseSkinColor=\{!workingTextProfile && authoredTextColor/);
  assert.match(editor, /onLabelElementChange=\{captureWorkingTextColor\}/);
  assert.match(editor, /setButtonSkinProfileColor/);
  assert.match(editor, /checked=\{workingSkinHighlightOnHover\}[\s\S]{0,300}setButtonSkinHighlightOnHover\([\s\S]{0,180}event\.currentTarget\.checked/);
  assert.match(editor, /workingSkinHighlightOnHover = explicitWorkingSkinHighlightOnHover \?\? placement\.highlightOnHover/);
  assert.match(editor, /const workingSkinForPersistence = \(\): ButtonSkin => cloneButtonDocument\([\s\S]{0,420}setButtonSkinHighlightOnHover/);
  assert.match(editor, /Assign Skin to Panel carries this setting to the whole panel/);
  assert.doesNotMatch(editor, /onHighlightOnHoverChange/);
  assert.match(editor, /This skin has no authored color profile/);
  assert.doesNotMatch(editor, /workingColorBuckets|label=\{`Color \$\{index \+ 1\}`\}|replaceButtonSkinColor/);
  assert.match(css, /\.button-color-row\s*\{[\s\S]{0,180}grid-template-columns:\s*42px minmax\(72px, 1fr\) auto/);
  assert.match(css, /\.button-color-row input\[type="color"\]/);
  assert.match(css, /\.button-color-profile-empty/);
});

test("Skin Editor exposes one placement-owned cycle with triggers, visuals, and a live preview", () => {
  const skinEditor = readEditorFile("ButtonSkinEditor.tsx");
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const css = readEditorFile("buttonEditor.css");

  assert.match(skinEditor, /<span>Button States &amp; Behavior<\/span>/);
  assert.match(skinEditor, /className="button-section-chevron" aria-hidden="true"/);
  assert.match(css, /\.button-behavior-section\[open\] > summary \.button-section-chevron[\s\S]{0,100}rotate\(90deg\)/);
  assert.match(skinEditor, /<strong>Cycle<\/strong>[\s\S]{0,500}<span>Number of states<\/span>[\s\S]{0,250}min=\{2\}/);
  assert.match(skinEditor, /value=\{cycleStateCountInput\}[\s\S]{0,620}resizeActivationCycle\(parsed\)[\s\S]{0,220}commitCycleStateCount/);
  assert.match(skinEditor, /2 states = On \/ Off toggle/);
  assert.match(skinEditor, /configuredStates\.map\(\(state, index\) => \{[\s\S]{0,1200}<span>Advance on<\/span>[\s\S]{0,500}ADVANCE_TRIGGERS\.map/);
  assert.match(skinEditor, /className="button-cycle-state-sync"[\s\S]{0,180}Action: \{resultMatchSummary\.label\}/);
  assert.match(skinEditor, /press: "Press"[\s\S]{0,100}hover: "Hover"[\s\S]{0,100}release: "Release"/);
  assert.doesNotMatch(skinEditor, /Activation behavior|BUTTON_ACTIVATION_MODES|>\s*Add state\s*<|>\s*Remove state\s*<|<span>When<\/span>/);
  assert.match(skinEditor, /className="button-behavior-state-grid"[\s\S]{0,1400}<span>State<\/span>[\s\S]{0,1400}<span>Visual state<\/span>/);
  assert.match(skinEditor, /BUTTON_SKIN_VISUAL_STATES\.filter\([\s\S]{0,380}workingSkin\[visualState\]\.trim\(\)[\s\S]{0,600}\(unavailable in this skin\)/);
  assert.match(skinEditor, /className="button-behavior-preview"[\s\S]{0,900}<ButtonSkinRenderer[\s\S]{0,1200}hovered=\{selectedVisualFlags\.hovered\}/);
  assert.match(skinEditor, /activationCycle \? \([\s\S]{0,700}<span>State<\/span>[\s\S]{0,1000}<span>State label<\/span>/);
  assert.doesNotMatch(skinEditor, /Label condition|Condition label|labelOverrides/);
  assert.equal(skinEditor.match(/>\s*Apply All\s*</g)?.length, 1);
  assert.match(skinEditor, /className="button-text-apply-all"[\s\S]{0,560}onClick=\{onApplyAllButtonText\}[\s\S]{0,120}>\s*Apply All\s*</);
  assert.match(skinEditor, /Apply every pending Button Text change across the editor:[\s\S]{0,120}Button tooltips/);
  assert.match(editor, /activationCycle=\{selectedPlacement\?\.activationCycle \?\? null\}/);
  assert.match(editor, /onActivationCycleChange=\{\(activationCycle\) => \{[\s\S]{0,260}draft\.placements\[selectedPlacement\.id\]\.activationCycle/);
  assert.doesNotMatch(editor, /onHighlightOnHoverChange/);
  assert.match(skinEditor, /core\.addEventListener\("pointerenter", handlePointerEnter\)/);
  assert.match(skinEditor, /onCoreElementChange=\{setBehaviorPreviewCoreElement\}/);
  assert.match(skinEditor, /className="button-behavior-preview"[\s\S]{0,1500}rawHovered=\{behaviorPreviewHovered\}/);
  assert.match(editor, /onApplyAllButtonText=\{\(\) => void applyAllButtonText\(\)\}/);
});

test("Button Text uses real cycle states and falls back to the base label when no cycle exists", () => {
  const skinEditor = readEditorFile("ButtonSkinEditor.tsx");
  const textSection = skinEditor.match(
    /<summary title="Edit Button labels and the shared Button Tooltip[\s\S]*?<\/details>/
  );
  assert.ok(textSection, "Button Text section must exist");

  assert.match(skinEditor, /const configuredStates = activationCycle\?\.states \?\? \[\];/);
  assert.match(skinEditor, /const next = cloneButtonDocument\(activationCycle \?\? \{ states: \[\] \}\)/);
  assert.match(skinEditor, /onBlur=\{\(\) => commitCycleStateCount\(cycleStateCountInput\)\}/);
  assert.match(textSection[0], /activationCycle \? \(/);
  assert.match(textSection[0], /configuredStates\.map/);
  assert.match(textSection[0], /<span>State label<\/span>/);
  assert.match(textSection[0], /\) : \([\s\S]{0,240}<span>Button label<\/span>/);
  assert.doesNotMatch(textSection[0], /materializeActivationBehavior|preview-only|Label condition/);
});

test("Button Text previews draft cycle labels but waits for Save Settings before Apply All", () => {
  const skinEditor = readEditorFile("ButtonSkinEditor.tsx");
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const stateStructure = readEditorFile("buttonActivationStateStructure.ts");
  const textSection = skinEditor.match(
    /<summary title="Edit Button labels and the shared Button Tooltip[\s\S]*?<\/details>/
  );
  assert.ok(textSection, "Button Text section must exist");

  assert.match(
    stateStructure,
    /function buttonActivationCycleStructureMatches\([\s\S]{0,500}committed\.states\.length !== draft\.states\.length[\s\S]{0,260}state\.id === committed\.states\[index\]\?\.id/
  );
  assert.match(editor, /import \{ buttonActivationCycleStructureMatches \} from "\.\/buttonActivationStateStructure";/);
  assert.match(editor, /const selectedStateStructureApplied = buttonActivationCycleStructureMatches\(/);
  assert.match(editor, /stateStructureApplied=\{selectedStateStructureApplied\}/);
  assert.match(
    editor,
    /const applyAllButtonText = async \(\) => \{[\s\S]{0,1200}draftPlacements\.map\(\(placement\) => \(\{[\s\S]{0,180}buttonId: placement\.buttonId,[\s\S]{0,100}placementId: placement\.id/
  );

  assert.match(skinEditor, /stateStructureApplied: boolean;/);
  assert.match(skinEditor, /const stateTextBlocked = !stateStructureApplied;/);
  assert.match(textSection[0], /Save Settings first because the cycle state structure changed/);
  assert.match(textSection[0], /value=\{selectedState\?\.label \?\? ""\}[\s\S]{0,180}disabled=\{busy \|\| !selectedState\}/);
  assert.match(
    textSection[0],
    /className="button-text-apply-all"[\s\S]{0,480}disabled=\{busy \|\| stateTextBlocked\}/
  );
  assert.match(textSection[0], /<span>Button label<\/span>\s*<input value=\{buttonLabel\} disabled=\{busy\}/);
  assert.match(textSection[0], /<span>Button Tooltip<\/span>[\s\S]{0,320}<textarea[\s\S]{0,320}value=\{buttonTooltip\}/);
});

test("Skin Editor replaces explanatory section paragraphs with hover tooltips", () => {
  const skinEditor = readEditorFile("ButtonSkinEditor.tsx");
  for (const removedExplanation of [
    "Responsive forces an exact core box",
    "Behavior and labels belong to this Button",
    "Choose a visual state that this skin actually provides",
    "The base Button label updates every live placement",
    "Leave the condition label empty to fall back",
    "Proportional and Stretch transform the complete skin"
  ]) {
    assert.doesNotMatch(skinEditor, new RegExp(removedExplanation));
  }
  assert.match(skinEditor, /<summary title="Choose the policy for the next explicit size edit/);
  assert.match(skinEditor, /<summary title="Set how this placement advances through states/);
  assert.match(skinEditor, /<summary title="Edit Button labels and the shared Button Tooltip/);
  assert.match(skinEditor, /title=\{`Raw \$\{sectionLabel\(section\)\} skin code\.`\}/);
});

test("explicit skin saves always prompt for a filename and write only portable source", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const save = editor.match(
    /const saveWorkingSkin = async[\s\S]*?\r?\n  };\r?\n\r?\n  const saveWorkingSkinAsNew/
  );
  const saveAsNew = editor.match(
    /const saveWorkingSkinAsNew = async[\s\S]*?\r?\n  };\r?\n\r?\n  const updateWorkingSkinFile/
  );
  assert.ok(save, "Save skin handler must exist");
  assert.ok(saveAsNew, "Save as new skin handler must exist");
  assert.match(editor, /const saveWorkingSkinAsNew = async/);
  assert.match(editor, /showSaveFileDialog\(\{[\s\S]{0,260}title,/);
  assert.match(editor, /defaultFileName:\s*defaultButtonSkinFileName\(workingSkin\.name\)/);
  assert.match(editor, /initialDirectory:\s*skinDirectory/);
  assert.match(save[0], /chooseWorkingSkinSavePath\(workingSkin, "Name and Save Button Skin"\)/);
  assert.match(saveAsNew[0], /chooseWorkingSkinSavePath\(workingSkin, "Name and Save New Button Skin"\)/);
  for (const handler of [save[0], saveAsNew[0]]) {
    assert.match(handler, /saveButtonSkinFile\([\s\S]{0,160}serializeButtonSkinSections\(workingSkin\)/);
    assert.match(handler, /name:\s*buttonSkinNameFromPath\(writtenPath\)/);
    assert.doesNotMatch(handler, /nextDraft\.skins|commitScopedDocument|applyButtonSkinSavedScope/);
  }
});

test("Skin file loading uses only the native real-file picker and shares one reusable folder", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const skinEditor = readEditorFile("ButtonSkinEditor.tsx");
  const skinFiles = readEditorFile("buttonSkinFiles.ts");
  const repository = readFileSync(
    join(frontendRoot, "src", "button", "state", "ButtonStateRepository.ts"),
    "utf8"
  );
  const nativeState = readFileSync(join(nativeRoot, "button_state.rs"), "utf8");
  const nativeMain = readFileSync(join(nativeRoot, "main.rs"), "utf8");

  assert.match(skinEditor, />\s*Load skin\.\.\.\s*</);
  assert.match(skinEditor, /onLoadSkinFile\(null\)\.then\(applySkinFileResult\)/);
  assert.doesNotMatch(skinEditor, /Recent files|Saved skins|saved:|recent:/);
  assert.doesNotMatch(skinFiles, /localStorage|RecentFile|rememberButtonSkin/);

  assert.match(editor, /const skinDirectory = await getButtonSkinDirectory\(\)/);
  assert.match(editor, /title:\s*"Load Button Skin"[\s\S]{0,240}initialDirectory:\s*skinDirectory/);
  assert.match(editor, /filter:\s*"FlowCell Button Skin \(\*\.flowcell-button-skin\.txt\)\|\*\.flowcell-button-skin\.txt"/);
  assert.match(editor, /createButtonSkinFromFile\([\s\S]{0,160}createStableButtonId\("skin"\)/);
  assert.doesNotMatch(editor, /findButtonSkinRecentFile|recentSkinFiles|rememberSkinFile/);

  assert.match(repository, /invoke<string>\("get_button_skin_directory"\)/);
  assert.match(repository, /invoke<string>\("load_button_skin_file", \{ path \}\)/);
  assert.match(repository, /invoke<string>\("open_button_skin_directory"\)/);
  assert.match(nativeState, /\.join\("Button editor"\)[\s\S]{0,80}\.join\("Skins"\)/);
  assert.match(nativeState, /Command::new\("explorer\.exe"\)[\s\S]{0,100}\.arg\(&directory\)/);
  assert.match(nativeMain, /button_state::get_button_skin_directory/);
  assert.match(nativeMain, /button_state::load_button_skin_file/);
  assert.match(nativeMain, /button_state::open_button_skin_directory/);
});

test("Size assignment is explicit, supports current Button or Panel scope, and stays separate from legacy uniform sizing", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const skinEditor = readEditorFile("ButtonSkinEditor.tsx");
  const sizeAssignments = readEditorFile("buttonSizeAssignments.ts");
  assert.match(skinEditor, />\s*Assign Size\s*</);
  assert.match(skinEditor, />\s*Assign Size to Panel\s*</);
  assert.match(skinEditor, /onClick=\{\(\) => \{[\s\S]{0,180}onAssignSize\(sizeForAssignment\)/);
  assert.match(skinEditor, /onClick=\{\(\) => \{[\s\S]{0,180}onAssignSizeToPanel\(sizeForAssignment\)/);
  assert.match(editor, /onAssignSize=\{assignSizeToSelectedPlacement\}/);
  assert.match(editor, /onAssignSizeToPanel=\{assignSizeToPanel\}/);
  assert.match(sizeAssignments, /function buttonPlacementSizingPatch[\s\S]{0,420}matchHitboxToSkin: assignment\.sizingMode !== "responsive"[\s\S]{0,120}allowStretching: assignment\.sizingMode === "stretch"/);
  const panelHandler = editor.match(/const assignSizeToPanel = useCallback\([\s\S]*?\n  const snapSelectedSurfaceToTopLeft/);
  assert.ok(panelHandler, "Panel size assignment handler must exist");
  assert.doesNotMatch(panelHandler[0], /applyUniformSizeToSurface/);
  assert.doesNotMatch(panelHandler[0], /uniformButtonSize:\s*\{/);
  assert.match(panelHandler[0], /const surface = document\.surfaces\[placement\.surfaceId\]/);
  assert.doesNotMatch(panelHandler[0], /resolveButtonEditorPanelSurfaceId/);
  assert.doesNotMatch(editor, /shouldApplyMatchedButtonMeasurement|handlePlacementMeasurement|Match Button hitboxes to skins/);
  const naturalMeasurementHandler = editor.match(
    /const handleNaturalMeasurement = \(placementId: string, measurement: ButtonCoreMeasurement\) => \{[\s\S]*?\n  \};/
  );
  assert.ok(naturalMeasurementHandler, "natural measurement handler must exist");
  assert.match(naturalMeasurementHandler[0], /const isFresh = freshPlacementsRef\.current\.delete\(placementId\);\s*if \(!isFresh\) return;/);
  assert.doesNotMatch(naturalMeasurementHandler[0], /allowLabelResize|resolveDeterministicLabelGrowth|Grow Button label/);
});

test("Button Sizing remains below Same size Buttons without driving uniform resizing", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const workspace = readEditorFile("ButtonWorkspace.tsx");
  const defaults = readFileSync(
    join(frontendRoot, "src", "button", "state", "buttonDefaults.ts"),
    "utf8"
  );
  const sameSizeIndex = editor.indexOf("<span>Same size Buttons</span>");
  const sizingIndex = editor.indexOf("<legend>Button Sizing</legend>");
  assert.ok(sameSizeIndex >= 0);
  assert.ok(sizingIndex > sameSizeIndex);
  assert.match(
    editor,
    /id="button-spacing-mm"[\s\S]{0,180}type="number"[\s\S]{0,180}min="0"[\s\S]{0,180}step="any"/
  );
  assert.match(editor, /draft\.settings\.buttonSpacingMm = nextMillimeters/);
  assert.match(defaults, /buttonSpacingMm:\s*0/);
  assert.match(editor, /resizeUniformButtonPlacementsInPlace\(/);
  assert.doesNotMatch(editor, /compactUniformButtonPlacements/);
  assert.doesNotMatch(editor, /compactButtonPlacementRows|inferButtonPlacementRows/);
  assert.match(
    workspace,
    /buildButtonReorderRowCandidates\(\{[\s\S]{0,220}buttonSpacingPixelsFromMillimeters\(document\.settings\.buttonSpacingMm\)/
  );
});

test("blue-handle resize previews and commits the selected sizing behavior atomically", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const skinEditor = readEditorFile("ButtonSkinEditor.tsx");
  const workspace = readEditorFile("ButtonWorkspace.tsx");
  const overlay = readEditorFile("ButtonEditOverlay.tsx");
  const fanRenderer = readFileSync(
    join(frontendRoot, "src", "button", "fan", "ButtonFanRenderer.tsx"),
    "utf8"
  );

  assert.match(skinEditor, /onSizingModePreviewChange\(nextMode\)/);
  assert.match(editor, /selectedPlacementSizingMode=\{selectedWorkingSizingMode\}/);
  assert.match(
    editor,
    /onSizingModePreviewChange=\{\(sizingMode\) => \{[\s\S]{0,220}setWorkingSizingModeOverride/
  );
  assert.match(
    editor,
    /const selectedWorkingSizingMode = allSurfaceButtonsSameSize\s*\? "responsive"/
  );
  assert.match(
    editor,
    /workingSizingModeOverride\?\.placementId === selectedPlacement\?\.id[\s\S]{0,160}: "responsive"/
  );
  assert.match(
    editor,
    /const assignWorkingSkin = async \([\s\S]{0,240}sizingMode: ButtonPlacementSizingMode/
  );
  assert.match(
    editor,
    /const scope: ButtonSkinSaveScope = \{\s*skinIds: \[assignedSkin\.id\],\s*placementIds: targetPlacementIds,\s*sizingMode\s*\}/
  );
  assert.match(
    overlay,
    /const activeSizingMode = sizingMode \?\? buttonPlacementSizingMode\(placement\)/
  );
  assert.match(
    overlay,
    /buttonSizingModeLocksAspect\(activeSizingMode, event\.shiftKey\)/
  );
  assert.match(
    overlay,
    /resolveProportionalResizeBasis\(start, naturalAspectRatio\)/
  );
  assert.match(
    overlay,
    /resolveAspectLockedButtonGeometryAlongPath\(\s*interaction\.aspectStart/
  );
  assert.match(overlay, /const interactionGridSize = interaction\.kind === "resize" \? 1 : gridSize/);
  assert.match(overlay, /snapPosition: interaction\.kind === "resize" \? false : undefined/);
  assert.match(workspace, /const \[naturalMeasurements, setNaturalMeasurements\] = useState/);
  assert.match(workspace, /const overlayNaturalAspectRatio = \([\s\S]{0,260}overlayNaturalMeasurement\.width \/ overlayNaturalMeasurement\.height/);
  assert.match(workspace, /naturalAspectRatio=\{overlayNaturalAspectRatio\}/);
  assert.match(workspace, /onPlacementNaturalMeasurement=\{handlePlacementNaturalMeasurement\}/);
  assert.match(fanRenderer, /sourcePlacementId: sourcePlacement\.id/);
  assert.match(fanRenderer, /onPlacementNaturalMeasurement\?\.\(collapsedOwner\.sourcePlacementId, measurement\)/);
  assert.match(overlay, /onPreview\(resolution\.rect, interaction\.kind\)/);
  assert.match(overlay, /onCommit\(interaction\.lastValid, interaction\.kind\)/);
  assert.match(
    workspace,
    /kind === "resize" \? selectedPlacementSizingMode : undefined/
  );
  const rectHandler = editor.match(
    /const updatePlacementRect = useCallback\([\s\S]*?\n  \}, \[applyUniformSizeToSurface, store\]\);/
  );
  assert.ok(rectHandler, "placement rectangle handler must exist");
  assert.match(rectHandler[0], /sizingMode\?: ButtonPlacementSizingMode/);
  assert.match(rectHandler[0], /buttonPlacementSizingPatch\(\{[\s\S]{0,180}sizingMode/);
});

test("editor preview viewports contain authored visual overflow without changing runtime overflow", () => {
  const css = readEditorFile("buttonEditor.css");
  for (const className of [
    "button-behavior-preview",
    "button-text-bench-preview",
    "button-skin-working-preview"
  ]) {
    assert.match(
      css,
      new RegExp(`\\.${className} \\{[^}]*overflow:\\s*auto;[^}]*\\}`),
      `${className} must contain authored overflow`
    );
    assert.doesNotMatch(
      css,
      new RegExp(`\\.${className} \\{[^}]*overflow:\\s*visible;[^}]*\\}`)
    );
  }
});

test("Button Editor uses the dedicated animation page beside placement editing", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  assert.match(editor, /<aside className="button-editor-sidebar">/);
  assert.match(
    editor,
    /activePage\s*===\s*"animation"\s*\?[\s\S]{0,240}<ButtonAnimationPickerPage/
  );
  assert.match(editor, /<ButtonWorkspace/);
  assert.match(editor, /<ButtonSkinEditor/);
});

test("Animation page offers no animation, apply, and position setup controls", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const animationPage = readEditorFile("ButtonAnimationPickerPage.tsx");
  assert.match(animationPage, /aria-label="Close Animation"/);
  assert.match(animationPage, /onClick=\{onClose\}/);
  assert.match(editor, /onClose=\{\(\) => \{\s*void closeButtonAnimationEditor\(\);/);
  assert.match(animationPage, /<option value="">No animation<\/option>/);
  assert.match(animationPage, /BUTTON_ACTIVATION_ANIMATION_PRESETS\.map/);
  for (const label of [
    "Apply",
    "Position and size",
    "Save position and size",
    "Close setup"
  ]) {
    assert.match(
      animationPage,
      new RegExp(`>\\s*${label.replaceAll(" ", "\\s+")}\\s*<`),
      `Animation page must expose '${label}'`
    );
  }
});

test("Editor Run preview remains available for activation-animation playback", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  assert.match(editor, /const \[mode, setMode\] = useState<"run" \| "edit">\("edit"\)/);
  assert.match(editor, /className="button-editor-mode button-editor-sidebar__mode"/);
  assert.match(editor, /<span>Edit<\/span>/);
  assert.match(editor, /checked=\{mode === "run"\}/);
  assert.match(editor, /<span>Run<\/span>/);
  assert.match(editor, /<ButtonWorkspace[\s\S]{0,180}mode=\{mode\}/);
  assert.match(editor, /onOwnerActivate=\{activateOwnerButton\}/);
});
