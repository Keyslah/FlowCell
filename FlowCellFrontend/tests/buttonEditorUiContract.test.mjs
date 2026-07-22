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
  assert.match(editor, /const savePlacement = async \(\) => \{\s*if \(busyRef\.current\) return;\s*setBusy\(true\);/);
  assert.match(editor, /const placementDraft = cloneButtonDocument\(store\.current\(\)\)/);
  assert.match(editor, /const editorBaseline = cloneButtonDocument\(store\.committed\)/);
  assert.match(editor, /buildButtonPlacementFile\(placementDraft, selectedSurfaceId/);
  assert.match(editor, /buildButtonPlacementScopedDocument\(\s*committedDocument,\s*placementDraft,[\s\S]{0,120}editorBaseline/);
  assert.match(editor, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
  assert.match(editor, /committedDocument = await loadButtonStateDocument\(\)/);
  assert.match(editor, /saveButtonPlacementFile\(targetPath, placementFile\)/);
  assert.match(editor, /onClick=\{\(\) => void savePlacement\(\)\}[\s\S]{0,80}Save placement/);
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
});

test("Skin Editor exposes nested behavior, per-state labels, and skin-aware visual mapping", () => {
  const skinEditor = readEditorFile("ButtonSkinEditor.tsx");
  const editor = readEditorFile("ButtonEditorPage.tsx");

  assert.match(skinEditor, /<span>Button Behavior<\/span>/);
  assert.match(skinEditor, /<span>Activation behavior<\/span>[\s\S]{0,220}BUTTON_ACTIVATION_MODES\.map/);
  assert.match(skinEditor, /<span>Button state<\/span>/);
  assert.match(skinEditor, /className="button-behavior-state-grid"[\s\S]{0,760}<span>When<\/span>[\s\S]{0,760}<span>Visual state<\/span>/);
  assert.match(skinEditor, /const availableVisualStates = BUTTON_SKIN_VISUAL_STATES;/);
  assert.match(skinEditor, /!workingSkin\[visualState\]\.trim\(\)[\s\S]{0,300}\(empty in this skin\)/);
  assert.match(skinEditor, /<span>Label condition<\/span>[\s\S]{0,1300}selectedState\.labelOverrides\[selectedAppearanceTrigger\]/);
  assert.match(skinEditor, />Add state<\/[a-z]+>[\s\S]{0,240}>\s*Remove state\s*</);
  assert.match(skinEditor, /setPreviewVisualStateOverride\(visualState\)/);
  assert.equal(skinEditor.match(/>\s*Apply Button state setup\s*</g)?.length, 2);
  assert.match(editor, /for \(const placement of Object\.values\(draft\.placements\)\)[\s\S]{0,220}delete placement\.visualStateMap\[stateId\]/);
  assert.match(editor, /onApplyButtonStateSetup=\{\(\) => void applyButtonStateSetup\(\)\}/);
});

test("Save as new skin opens a native file picker and writes canonical portable source", () => {
  const editor = readEditorFile("ButtonEditorPage.tsx");
  assert.match(editor, /const saveWorkingSkinAsNew = async/);
  assert.match(editor, /showSaveFileDialog\(\{[\s\S]{0,260}Save Button Skin As/);
  assert.match(editor, /defaultFileName:\s*defaultButtonSkinFileName\(duplicate\.name\)/);
  assert.match(editor, /saveButtonSkinFile\([\s\S]{0,160}serializeButtonSkinSections\(duplicate\)/);
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
