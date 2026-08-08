import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(
  join(import.meta.dirname, "..", "src", "button", "editor", "ButtonSkinEditor.tsx"),
  "utf8"
);

test("Skin Editor keeps source edits in an isolated working skin", () => {
  assert.match(source, /const \[workingSkin, setWorkingSkin\] = useState<ButtonSkin \| null>/);
  assert.match(source, /const \[workingSkinFilePath, setWorkingSkinFilePath\] = useState<string \| null>/);
  assert.match(source, /setWorkingSkin\(next\)/);
  assert.doesNotMatch(source, /onSkinChange/);
  assert.match(source, /onLoadSkinFile/);
});

test("Skin Editor exposes only the requested skin actions in the requested order", () => {
  const labels = [
    "Assign Skin",
    "Assign Skin to Selection",
    "Assign Skin to Panel",
    "Load skin",
    "Save skin",
    "Save as new skin"
  ];
  let previousIndex = -1;
  for (const label of labels) {
    const index = source.indexOf(label);
    assert.ok(index > previousIndex, `'${label}' must follow the preceding toolbar action`);
    previousIndex = index;
  }
  assert.doesNotMatch(source, /Apply Named Sections/);
  assert.doesNotMatch(source, /Replace Entire Skin/);
});

test("Load stays local and invalid working skins cannot be saved or assigned", () => {
  assert.match(
    source,
    /value\.startsWith\("saved:"\)[\s\S]{0,260}setWorkingSkin\(cloneButtonDocument\(loaded\)\)/
  );
  assert.match(source, /value\.startsWith\("recent:"\)[\s\S]{0,300}onLoadSkinFile\(recentFile\.path, recentFile\.skinId\)/);
  assert.match(source, /value === "browse"[\s\S]{0,120}onLoadSkinFile\(null\)/);
  assert.match(source, /const skinActionsDisabled = busy \|\| !compileResult\?\.ok/);
  assert.equal((source.match(/disabled=\{skinActionsDisabled\}/g) ?? []).length, 4);
  for (const callback of [
    "onAssignSkin",
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
    /onSaveSkin\(\s*workingSkinForPersistence\(\),\s*workingSkinFilePath\s*\)/
  );
  assert.match(
    source,
    /onSaveAsNewSkin\(workingSkinForPersistence\(\)\)/
  );
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
    (source.match(/setWorkingPreviewUsesNaturalSize\(true\)/g) ?? []).length >= 4,
    "every working-source replacement path must restore natural preview geometry"
  );
  assert.ok(
    (source.match(/resetWorkingSizingMode\(\)/g) ?? []).length >= 4,
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
    6,
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
