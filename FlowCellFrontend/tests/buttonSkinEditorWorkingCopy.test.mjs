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
  assert.match(source, /setWorkingSkin\(next\)/);
  assert.doesNotMatch(source, /onSkinChange/);
  assert.doesNotMatch(source, /onLoadSkin/);
});

test("Skin Editor exposes only the requested skin actions in the requested order", () => {
  const labels = [
    "Assign Skin",
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
    /const loaded = skins\.find\([\s\S]{0,180}setWorkingSkin\(cloneButtonDocument\(loaded\)\)/
  );
  assert.match(source, /const skinActionsDisabled = busy \|\| !compileResult\?\.ok/);
  assert.equal((source.match(/disabled=\{skinActionsDisabled\}/g) ?? []).length, 4);
  for (const callback of [
    "onAssignSkin",
    "onAssignSkinToPanel",
    "onSaveSkin",
    "onSaveAsNewSkin"
  ]) {
    assert.match(
      source,
      new RegExp(`${callback}\\(cloneButtonDocument\\(workingSkin\\)\\)`),
      `${callback} must receive the isolated working skin`
    );
  }
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
    /setWorkingSkin\(next\);\s*setPaste\(""\);\s*setUpdatedSections/
  );
});

test("Button size uses an isolated preview until an explicit assignment action", () => {
  assert.match(source, /const \[workingSize, setWorkingSize\] = useState/);
  assert.match(source, /const activeSize = workingSize\?\.placementId === placement\.id/);
  assert.match(source, /width=\{activeSize\.width\}/);
  assert.match(source, /height=\{activeSize\.height\}/);
  assert.match(source, /matchHitboxToSkin=\{sizingMode !== "responsive"\}/);
  assert.match(source, /allowStretching=\{sizingMode === "stretch"\}/);
  assert.match(source, /onAssignSize\(activeSize\)/);
  assert.match(source, /onAssignSizeToPanel\(activeSize\)/);
  assert.doesNotMatch(source, /onPlacementSizeChange/);
  assert.doesNotMatch(source, /onPlacementSizingModeChange/);
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
    /<summary title="Edit and preview Button Text only[\s\S]*?<\/details>/
  );
  assert.ok(textSection, "Button Text section must exist");
  assert.match(textSection[0], /label=\{previewLabel\}/);
  assert.match(textSection[0], /hovered=\{selectedVisualFlags\.hovered\}/);
  assert.match(textSection[0], /textOffsetX=\{placement\.textOffsetX\}/);
  assert.match(textSection[0], /textOffsetY=\{placement\.textOffsetY\}/);
  assert.match(textSection[0], /onClick=\{onApplyAllButtonText\}[\s\S]{0,120}>\s*Apply All\s*</);
  assert.match(textSection[0], /disabled=\{busy \|\| stateTextBlocked\}/);
  assert.ok(
    textSection[0].lastIndexOf("Apply All") > textSection[0].lastIndexOf("button-text-bench-preview"),
    "Apply All must remain below the live Button Text preview"
  );
  assert.doesNotMatch(textSection[0], /onApplyButtonStateSetup/);
});
