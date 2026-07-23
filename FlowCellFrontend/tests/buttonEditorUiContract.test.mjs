import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const frontendRoot = join(import.meta.dirname, "..");
const editorRoot = join(frontendRoot, "src", "button", "editor");

function readEditorFile(fileName) {
  return readFileSync(join(editorRoot, fileName), "utf8");
}

function readEditorSources() {
  return readdirSync(editorRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:css|ts|tsx)$/.test(entry.name))
    .map((entry) => readEditorFile(entry.name))
    .join("\n");
}

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
  assert.match(skinEditor, /setWorkingSkin\(next\);\s*setPaste\(""\);\s*setUpdatedSections/);
});

test("Save placement opens a named arrangement-file dialog and uses scoped persistence", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  assert.match(editor, /showSaveFileDialog\(\{[\s\S]{0,260}Save Button Placement/);
  assert.match(editor, /defaultFileName:\s*defaultButtonPlacementFileName\(\)/);
  assert.match(editor, /const buttonEditorDirectory = await getButtonEditorDirectory\(\)/);
  assert.match(editor, /Save Button Placement[\s\S]{0,420}initialDirectory:\s*buttonEditorDirectory/);
  assert.match(editor, /const savePlacement = async \(\) => \{\s*if \(busyRef\.current\) return;\s*setBusy\(true\);/);
  assert.match(editor, /const placementDraft = cloneButtonDocument\(store\.current\(\)\)/);
  assert.match(editor, /const editorBaseline = cloneButtonDocument\(store\.committed\)/);
  assert.match(editor, /buildButtonPlacementFile\(placementDraft, selectedSurfaceId/);
  assert.match(editor, /buildButtonPlacementScopedDocument\(\s*committedDocument,\s*placementDraft,[\s\S]{0,120}editorBaseline/);
  assert.match(editor, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
  assert.match(editor, /committedDocument = await loadButtonStateDocument\(\)/);
  assert.match(editor, /saveButtonPlacementFile\(targetPath, placementFile\)/);
  assert.doesNotMatch(editor, /(?:read|write)LastLayoutDirectory/);
  assert.match(editor, /onClick=\{\(\) => void savePlacement\(\)\}[\s\S]{0,80}Save placement/);
});

test("Load placement sits below Save and stages a validated file from the Button editor folder", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  assert.match(
    editor,
    /const loadPlacement = async \(\) => \{\s*if \(busyRef\.current\) return;\s*setBusy\(true\);/
  );
  assert.match(editor, /showOpenFileDialog\(\{[\s\S]{0,180}title: "Load Button Placement"/);
  assert.match(editor, /Load Button Placement[\s\S]{0,420}initialDirectory:\s*buttonEditorDirectory/);
  assert.match(editor, /Load Button Placement[\s\S]{0,480}multiselect:\s*false/);
  assert.match(editor, /const placementFile = await loadButtonPlacementFile\(selectedPath\)/);
  assert.match(editor, /applyButtonPlacementFile\(\s*store\.current\(\),\s*selectedSurfaceId,\s*placementFile\s*\)/);
  assert.match(editor, /store\.transact\(\(\) => loadedDocument, \{ label: "Load Button placement" \}\)/);
  assert.doesNotMatch(editor, /getParentDirectory/);
  assert.match(editor, /Use Save placement to commit it\./);
  assert.match(
    editor,
    /onClick=\{\(\) => void savePlacement\(\)\}[\s\S]{0,180}Save placement[\s\S]{0,260}onClick=\{\(\) => void loadPlacement\(\)\}[\s\S]{0,80}Load placement/
  );
});

test("Skin assignment is explicit and selected-only unless Panel assignment is chosen", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  assert.match(editor, /onAssignSkin=\{\(skin\) => \{[\s\S]{0,260}\[selectedPlacement\.id\]/);
  assert.match(editor, /onAssignSkinToPanel=\{\(skin\) => \{[\s\S]{0,340}resolveButtonEditorPanelSkinTargetPlacementIds/);
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
  assert.match(skinEditor, /checked=\{placement\.highlightOnHover\}[\s\S]{0,180}onHighlightOnHoverChange\(event\.currentTarget\.checked\)[\s\S]{0,120}<span>Highlight on hover<\/span>/);
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
  assert.match(skinEditor, /Apply every pending Button Text change across the editor/);
  assert.match(editor, /activationCycle=\{selectedPlacement\?\.activationCycle \?\? null\}/);
  assert.match(editor, /onActivationCycleChange=\{\(activationCycle\) => \{[\s\S]{0,260}draft\.placements\[selectedPlacement\.id\]\.activationCycle/);
  assert.match(editor, /onHighlightOnHoverChange=\{\(highlightOnHover\) => \{[\s\S]{0,240}draft\.placements\[selectedPlacement\.id\]\.highlightOnHover = highlightOnHover/);
  assert.match(skinEditor, /className="button-behavior-preview"[\s\S]{0,300}onPointerEnter=\{\(\) => setBehaviorPreviewHovered\(true\)\}[\s\S]{0,1500}rawHovered=\{behaviorPreviewHovered\}/);
  assert.match(editor, /onApplyAllButtonText=\{\(\) => void applyAllButtonText\(\)\}/);
});

test("Button Text uses real cycle states and falls back to the base label when no cycle exists", () => {
  const skinEditor = readEditorFile("ButtonSkinEditor.tsx");
  const textSection = skinEditor.match(
    /<summary title="Edit and preview Button Text only[\s\S]*?<\/details>/
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

test("Button Text previews draft cycle labels but waits for Save placement before Apply All", () => {
  const skinEditor = readEditorFile("ButtonSkinEditor.tsx");
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const stateStructure = readEditorFile("buttonActivationStateStructure.ts");
  const textSection = skinEditor.match(
    /<summary title="Edit and preview Button Text only[\s\S]*?<\/details>/
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
  assert.match(textSection[0], /Save placement first because the cycle state structure changed/);
  assert.match(textSection[0], /value=\{selectedState\?\.label \?\? ""\}[\s\S]{0,180}disabled=\{busy \|\| !selectedState\}/);
  assert.match(
    textSection[0],
    /className="button-text-apply-all"[\s\S]{0,480}disabled=\{busy \|\| stateTextBlocked\}/
  );
  assert.match(textSection[0], /<span>Button label<\/span>\s*<input value=\{buttonLabel\} disabled=\{busy\}/);
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
  assert.match(skinEditor, /<summary title="Set the selected Button's preview size/);
  assert.match(skinEditor, /<summary title="Set how this placement advances through states/);
  assert.match(skinEditor, /<summary title="Edit and preview Button Text only/);
  assert.match(skinEditor, /title=\{`Raw \$\{sectionLabel\(section\)\} skin code\.`\}/);
});

test("Save as new skin opens a native file picker and writes canonical portable source", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  assert.match(editor, /const saveWorkingSkinAsNew = async/);
  assert.match(editor, /showSaveFileDialog\(\{[\s\S]{0,260}Save Button Skin As/);
  assert.match(editor, /defaultFileName:\s*defaultButtonSkinFileName\(workingSkin\.name\)/);
  assert.match(editor, /saveButtonSkinFile\([\s\S]{0,160}serializeButtonSkinSections\(workingSkin\)/);
  assert.match(editor, /name:\s*buttonSkinNameFromPath\(writtenPath\)/);
});

test("Size assignment is explicit, supports current Button or Panel scope, and stays separate from legacy uniform sizing", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  const skinEditor = readEditorFile("ButtonSkinEditor.tsx");
  const sizeAssignments = readEditorFile("buttonSizeAssignments.ts");
  assert.match(skinEditor, />\s*Assign Size\s*</);
  assert.match(skinEditor, />\s*Assign Size to Panel\s*</);
  assert.match(skinEditor, /onClick=\{\(\) => onAssignSize\(activeSize\)\}/);
  assert.match(skinEditor, /onClick=\{\(\) => onAssignSizeToPanel\(activeSize\)\}/);
  assert.match(editor, /onAssignSize=\{assignSizeToSelectedPlacement\}/);
  assert.match(editor, /onAssignSizeToPanel=\{assignSizeToPanel\}/);
  assert.match(sizeAssignments, /function buttonPlacementSizingPatch[\s\S]{0,420}matchHitboxToSkin: assignment\.sizingMode !== "responsive"[\s\S]{0,120}allowStretching: assignment\.sizingMode === "stretch"/);
  const panelHandler = editor.match(/const assignSizeToPanel = useCallback\([\s\S]*?\n  const snapSelectedSurfaceToTopLeft/);
  assert.ok(panelHandler, "Panel size assignment handler must exist");
  assert.doesNotMatch(panelHandler[0], /applyUniformSizeToSurface/);
  assert.doesNotMatch(panelHandler[0], /uniformButtonSize:\s*\{/);
  assert.match(panelHandler[0], /const surface = document\.surfaces\[placement\.surfaceId\]/);
  assert.doesNotMatch(panelHandler[0], /resolveButtonEditorPanelSurfaceId/);
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
