import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildRefilledThemeRolePatch,
  buildThemeToneProfile,
  buildThemeTonePatch,
  normalizeLegacyThemeToneState,
  normalizeThemeToneProfiles,
  normalizeThemePalette,
  shiftThemeHexToLuminance,
  themeHexLuminance
} from "./.compiled-button-system/button/toolPages/themeTone.js";
import {
  isThemeWorkbenchPresentationConfig,
  normalizeLegacyThemeWorkbenchStoredFields,
  resolveThemeWorkbenchLegacyStorageKey,
  normalizeThemeWorkbenchStoredFields
} from
  "./.compiled-button-system/button/toolPages/themeWorkbenchTypes.js";

function validThemeWorkbenchPresentation() {
  return {
    kind: "theme-workbench",
    title: "Theme",
    theme: {
      imagePathFieldId: "theme_image",
      visualModeFieldId: "mode",
      roles: [
        { id: "surface", label: "Surface", fieldId: "surface", tone: { dark: 0.04, light: 0.3 } }
      ]
    },
    picture: {
      pathFieldId: "picture_path",
      gridFields: [{ fieldId: "grid_x", label: "Grid X", step: 1 }]
    },
    environment: {
      pathFieldId: "environment_path",
      valueFields: [{ fieldId: "strength", label: "Strength", minimum: 0 }]
    },
    actions: {
      theme: {
        browseImage: "browse-image",
        absorb: "absorb",
        saveFields: "save-fields",
        loadFields: "load-fields",
        darkMode: "dark",
        lightMode: "light",
        apply: "apply-theme"
      },
      picture: {
        apply: "apply-picture",
        browse: "browse-picture",
        clear: "clear-picture"
      },
      environment: {
        apply: "apply-environment",
        browse: "browse-environment",
        clear: "clear-environment",
        reset: "reset-environment"
      }
    },
    tone: { defaultLevel: 0.3, showSlider: true }
  };
}

test("theme tone shifting preserves valid color output near the requested luminance", () => {
  const shifted = shiftThemeHexToLuminance("#7BA8B7", 0.08);
  assert.match(shifted, /^#[0-9A-F]{6}$/);
  assert.ok(Math.abs(themeHexLuminance(shifted) - 0.08) < 0.015);
});

test("theme palette normalization is stable, unique, and luminance ordered", () => {
  assert.deepEqual(
    normalizeThemePalette("#FFFFFF, #2d383a; #FFFFFF #000000"),
    ["#000000", "#2D383A", "#FFFFFF"]
  );
});

test("manifest tone roles stage dark and light patches without program knowledge", () => {
  const roles = [
    { id: "surface", label: "Surface", fieldId: "surface", tone: { dark: 0.04, light: 0.3 } },
    { id: "text", label: "Text", fieldId: "text", mirrorFieldIds: ["caption"], tone: "text" }
  ];
  const dark = buildThemeTonePatch({
    palette: ["#223344", "#99AABB"],
    roles,
    visualModeFieldId: "mode",
    mode: "dark"
  });
  const light = buildThemeTonePatch({
    palette: ["#223344", "#99AABB"],
    roles,
    visualModeFieldId: "mode",
    mode: "light"
  });

  assert.equal(dark.mode, "dark");
  assert.equal(light.mode, "light");
  assert.equal(dark.caption, dark.text);
  assert.equal(light.caption, "#000000");
  assert.ok(themeHexLuminance(String(dark.surface)) < themeHexLuminance(String(light.surface)));
});

test("refill variants reassign package roles deterministically without using staged colors", () => {
  const roles = [
    { id: "surface", label: "Surface", fieldId: "surface", tone: { dark: 0.04, light: 0.3 } },
    { id: "panel", label: "Panel", fieldId: "panel", tone: { dark: 0.1, light: 0.4 } },
    { id: "accent", label: "Accent", fieldId: "accent", tone: { dark: 0.3, light: 0.5 } }
  ];
  const args = {
    palette: ["#143D52", "#7A3B68", "#C8A35F", "#D8E6E9"],
    roles,
    visualModeFieldId: "mode",
    mode: "dark",
    level: 0.2
  };
  const first = buildRefilledThemeRolePatch({ ...args, variant: 1 });
  const repeated = buildRefilledThemeRolePatch({ ...args, variant: 1 });
  const second = buildRefilledThemeRolePatch({ ...args, variant: 2 });

  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first, second);
  assert.equal(first.mode, "dark");
  assert.match(String(first.surface), /^#[0-9A-F]{6}$/);
});

test("darkness profiles capture and normalize only configured non-text role targets", () => {
  const roles = [
    { id: "surface", label: "Surface", fieldId: "surface", tone: { dark: 0.04, light: 0.3 } },
    { id: "text", label: "Text", fieldId: "text", tone: "text" }
  ];
  const profile = buildThemeToneProfile({
    name: "Dim Studio",
    level: 0.22,
    mode: "dark",
    roles,
    fieldValues: { surface: "#203040", text: "#FFFFFF" }
  });
  assert.ok(profile);
  assert.equal(profile.name, "Dim Studio");
  assert.deepEqual(Object.keys(profile.targetLuminanceByRoleId), ["surface"]);

  const normalized = normalizeThemeToneProfiles([
    profile,
    {
      ...profile,
      id: "clamped",
      level: 4,
      targetLuminanceByRoleId: { surface: -2, stale: 0.5 }
    },
    { id: "broken" }
  ], roles);
  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized[0], profile);
  assert.deepEqual(normalized[1], {
    ...profile,
    id: "clamped",
    level: 1,
    targetLuminanceByRoleId: { surface: 0 }
  });
});

test("theme workbench presentation validation rejects malformed nested package data", () => {
  const valid = validThemeWorkbenchPresentation();
  assert.equal(isThemeWorkbenchPresentationConfig(valid), true);
  assert.equal(isThemeWorkbenchPresentationConfig({
    ...valid,
    theme: {
      ...valid.theme,
      browseCompletion: { toneMode: "dark", postActionSlot: "apply-picture" },
      refill: { label: "Refill", applyActionSlot: "apply-theme" }
    },
    tone: {
      ...valid.tone,
      storageKey: "tone-v1",
      profiles: { enabled: true, saveLabel: "Save" }
    }
  }), true);

  assert.equal(isThemeWorkbenchPresentationConfig({
    ...valid,
    theme: { ...valid.theme, roles: [null] }
  }), false);
  assert.equal(isThemeWorkbenchPresentationConfig({
    ...valid,
    actions: { ...valid.actions, theme: {} }
  }), false);
  assert.equal(isThemeWorkbenchPresentationConfig({
    ...valid,
    picture: { ...valid.picture, gridFields: [] }
  }), false);
  assert.equal(isThemeWorkbenchPresentationConfig({
    ...valid,
    environment: {
      ...valid.environment,
      valueFields: [{ fieldId: "strength", label: "Strength", minimum: 2, maximum: 1 }]
    }
  }), false);
  assert.equal(isThemeWorkbenchPresentationConfig({
    ...valid,
    theme: { ...valid.theme, refill: { label: "No action" } }
  }), false);
  assert.equal(isThemeWorkbenchPresentationConfig({
    ...valid,
    theme: { ...valid.theme, browseCompletion: {} }
  }), false);
  assert.equal(isThemeWorkbenchPresentationConfig({
    ...valid,
    fieldPersistence: { storageKey: "" }
  }), false);
});

test("stored workbench fields restore only declared IDs and valid JSON values", () => {
  assert.deepEqual(normalizeThemeWorkbenchStoredFields({
    schemaVersion: 1,
    values: {
      color: "#123456",
      strength: 0.25,
      options: { enabled: true },
      stale: "discard me",
      invalid: Number.NaN
    }
  }, ["color", "strength", "options", "invalid"]), {
    color: "#123456",
    strength: 0.25,
    options: { enabled: true }
  });
  assert.deepEqual(normalizeThemeWorkbenchStoredFields({
    schemaVersion: 2,
    values: { color: "#FFFFFF" }
  }, ["color"]), {});
});

test("legacy workbench fields map declaratively without restoring undeclared values", () => {
  assert.deepEqual(normalizeLegacyThemeWorkbenchStoredFields({
    ThemeTabsHex: "#123456",
    GridSpacing: "1 m",
    HdriPath: "C:/environment.hdr"
  }, ["tabs_hex", "grid_spacing_m"], {
    ThemeTabsHex: "tabs_hex",
    GridSpacing: "grid_spacing_m",
    HdriPath: "hdri_path"
  }, {
    GridSpacing: "parse-number"
  }), {
    tabs_hex: "#123456",
    grid_spacing_m: 1
  });
});

test("legacy workbench storage accepts the exact pre-refactor Theme key", () => {
  const exact = "flowcell.themeToolbox.blender.toolset.theme.flowcell-panel-item.json";
  assert.equal(resolveThemeWorkbenchLegacyStorageKey(exact, null), exact);
  assert.equal(resolveThemeWorkbenchLegacyStorageKey(
    "flowcell.themeToolbox.{program}.{panel}.{file}",
    { programName: "Blender", panelName: "toolset", fileName: "theme.flowcell-source.json" }
  ), "flowcell.themeToolbox.blender.toolset.theme.flowcell-source.json");
});

test("legacy darkness profiles map old role fields into current package role IDs", () => {
  const roles = [
    { id: "tabs", label: "Tabs", fieldId: "tabs_hex", tone: { dark: 0.04, light: 0.3 } },
    { id: "controls", label: "Controls", fieldId: "controls_hex", tone: { dark: 0.08, light: 0.3 } },
    { id: "text", label: "Text", fieldId: "text_hex", tone: "text" }
  ];
  const imported = normalizeLegacyThemeToneState({
    value: {
      format: "legacy-profiles-v1",
      activeProfileId: "old-one",
      profiles: [{
        id: "old-one",
        name: "Old One",
        targets: {
          ThemeTabsHex: 0.02,
          ThemeControlsHex: 0.08,
          ThemeTextHex: 0.9,
          UnknownHex: 0.5
        }
      }]
    },
    format: "legacy-profiles-v1",
    roleMap: {
      ThemeTabsHex: "tabs",
      ThemeControlsHex: "controls",
      ThemeTextHex: "text"
    },
    roles,
    mode: "dark",
    level: 0.3
  });
  assert.equal(imported.activeProfileId, "old-one");
  assert.deepEqual(imported.profiles, [{
    id: "old-one",
    name: "Old One",
    level: 0.3,
    mode: "dark",
    targetLuminanceByRoleId: { tabs: 0.02, controls: 0.08 }
  }]);
});

test("shipped theme workbench declares valid generic browse, package, role, and profile behavior", () => {
  const manifest = JSON.parse(readFileSync(new URL(
    "../../Programs/Blender/Blender Git Scripts/Toolsets/theme/flowcell.toolset.json",
    import.meta.url
  ), "utf8"));
  const config = manifest.layout.presentation.config;
  assert.equal(isThemeWorkbenchPresentationConfig(config), true);
  assert.deepEqual(config.theme.browseCompletion, {
    toneMode: "dark",
    postActionSlot: "apply_background_pic"
  });
  assert.equal(config.theme.refill.applyActionSlot, "apply_theme");
  assert.deepEqual(config.theme.packageCompletion.postActions, [
    { actionSlot: "apply_theme" },
    { actionSlot: "apply_background_pic", whenFieldNonEmpty: "static_background_path" }
  ]);
  assert.equal(config.theme.roles.every((role) =>
    role.apply?.actionSlot === "apply_theme_bucket" &&
    role.apply?.valuePayloadKey === "bucket_hex"), true);
  assert.deepEqual({
    save: config.actions.theme.savePackage,
    open: config.actions.theme.openPackage,
    previous: config.actions.theme.previousPackage,
    next: config.actions.theme.nextPackage
  }, {
    save: "save_theme_package",
    open: "open_theme_package",
    previous: "previous_theme_package",
    next: "next_theme_package"
  });
  const childrenBySlot = new Map(manifest.children.map((child) => [child.slot, child]));
  const savePackage = childrenBySlot.get("save_theme_package").executionTarget;
  assert.equal(savePackage.actionId, "save-tool-package");
  assert.equal(savePackage.payload.valueFields.includes("static_background_path"), true);
  assert.equal(savePackage.payload.valueFields.includes("hdri_path"), false);
  assert.equal(childrenBySlot.get("open_theme_package").executionTarget.actionId, "open-tool-package");
  assert.equal(childrenBySlot.get("previous_theme_package").executionTarget.actionId, "cycle-tool-package");
  assert.equal(childrenBySlot.get("next_theme_package").executionTarget.actionId, "cycle-tool-package");
  assert.equal(childrenBySlot.get("load_legacy_tone_profiles").executionTarget.actionId,
    "load-legacy-tool-state");
  assert.equal(manifest.layout.updatePolicy.appendMissingChildSlots, true);
  assert.equal(config.tone.profiles.enabled, true);
  assert.equal(config.tone.legacyProfiles.roleMap.ThemeTabsHex, "tabs");
  assert.equal(config.fieldPersistence.storageKey, "tool-fields-v1");
  assert.equal(config.fieldPersistence.legacy[0].storageKeys[0],
    "flowcell.themeToolbox.blender.toolset.theme.flowcell-panel-item.json");
  assert.equal(config.fieldPersistence.legacy[0].fieldMap.ThemeTabsHex, "tabs_hex");
});
