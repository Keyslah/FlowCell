import type {
  ButtonActivationBehavior,
  ButtonActivationAnimation,
  ButtonDesktopBounds,
  ButtonFanAnimationSettings,
  ButtonPlacement,
  ButtonPopoutUnit,
  ButtonPopoutCloseRule,
  ButtonPopoutOpenRule,
  ButtonRole,
  ButtonSkin,
  ButtonStateDocument,
  ButtonSurface,
  ButtonSurfaceKind,
  ToolSetButtonPopoutUnit,
  ButtonWindowFitMode
} from "../types.js";
import { cloneButtonDocument } from "./buttonDefaults.js";
import { validateButtonStateDocument } from "./buttonStateValidation.js";
import { deriveRegularPopoutSelectionKey } from "./sourceIdentity.js";

export const BUTTON_SETTINGS_FILE_FORMAT = "flowcell-button-settings/v1" as const;
export const BUTTON_SETTINGS_FILE_EXTENSION = ".flowcell-button-settings.json" as const;

export type ButtonSettingsPlacementKind = "main-page" | "fan" | "pop-out";

export interface ButtonSettingsFileSurface {
  name: string;
  kind: ButtonSurfaceKind;
  width: number;
  height: number;
  visualOverflowAllowance: number;
  uniformButtonSize: { width: number; height: number } | null;
}

export type ButtonSettingsFilePlacement = Omit<
  ButtonPlacement,
  "id" | "buttonId" | "surfaceId" | "skinOverrideId"
>;

export interface ButtonSettingsFileEntry {
  placementId: string;
  buttonId: string;
  buttonRole: ButtonRole;
  label: string;
  activationBehavior: ButtonActivationBehavior | null;
  activationAnimation: ButtonActivationAnimation | null;
  skin: ButtonSkin;
  placement: ButtonSettingsFilePlacement;
}

interface ButtonSettingsMainPageBehavior {
  kind: "main-page";
}

interface ButtonSettingsPopoutBehaviorBase {
  openRule: ButtonPopoutOpenRule;
  closeRule: ButtonPopoutCloseRule;
  transparency: number;
  pinnedDefault: boolean;
  windowFitMode: ButtonWindowFitMode;
}

interface ButtonSettingsRegularPopoutBehavior extends ButtonSettingsPopoutBehaviorBase {
  kind: "regular-popout";
}

interface ButtonSettingsToolSetPopoutBehavior extends ButtonSettingsPopoutBehaviorBase {
  kind: "tool-set-popout";
  ownerButtonId: string;
}

interface ButtonSettingsFanBehavior {
  kind: "fan";
  panelOwnerButtonId: string;
  selectedToolSetOwnerButtonIds: string[];
  toolSetOwnerAnchors: Record<string, ButtonDesktopBounds>;
  openRule: ButtonPopoutOpenRule;
  closeRule: ButtonPopoutCloseRule;
  pinnedDefault: boolean;
  animation: ButtonFanAnimationSettings;
  windowFitMode: ButtonWindowFitMode;
}

export type ButtonSettingsFileBehavior =
  | ButtonSettingsMainPageBehavior
  | ButtonSettingsRegularPopoutBehavior
  | ButtonSettingsToolSetPopoutBehavior
  | ButtonSettingsFanBehavior;

export interface ButtonSettingsFile {
  format: typeof BUTTON_SETTINGS_FILE_FORMAT;
  savedAt: string;
  placementKind: ButtonSettingsPlacementKind;
  programName: string;
  panelName: string;
  sourceSurfaceId: string;
  surface: ButtonSettingsFileSurface;
  behavior: ButtonSettingsFileBehavior;
  entries: ButtonSettingsFileEntry[];
}

export interface ButtonSettingsFileBuildContext {
  programName: string;
  panelName: string;
  savedAt?: string;
}

export interface ButtonSettingsFileApplyContext {
  programName: string;
  panelName: string;
}

export interface ButtonSettingsFileValidationResult {
  valid: boolean;
  issues: string[];
}

export interface TransientButtonPopoutSettingsDocument {
  document: ButtonStateDocument;
  popoutUnitId: string;
  ownerButtonId?: string;
}

const BUTTON_ROLES = new Set<ButtonRole>([
  "single-script",
  "tool-set-owner",
  "tool-set-child",
  "panel-owner"
]);
const BUTTON_SURFACE_KINDS = new Set<ButtonSurfaceKind>([
  "main",
  "panel",
  "regular-popout",
  "tool-set-popout",
  "fan"
]);
const BUTTON_TEXT_FIT_MODES = new Set(["shrink", "stack-whole-words", "shrink-and-stack"]);
const BUTTON_TEXT_ALIGNMENTS = new Set(["skin", "left", "center", "right"]);
const BUTTON_WINDOW_FIT_MODES = new Set<ButtonWindowFitMode>(["surface", "hitbox", "visual"]);
const BUTTON_OPEN_RULES = new Set<ButtonPopoutOpenRule>(["toggle", "click", "hover", "manual"]);
const BUTTON_CLOSE_RULES = new Set<ButtonPopoutCloseRule>(["toggle", "escape", "hover-out", "manual"]);
const BUTTON_SKIN_KEYS = [
  "id",
  "name",
  "structure",
  "keyframes",
  "base",
  "hover",
  "play",
  "pressed",
  "held",
  "release",
  "disabled",
  "error",
  "metadata",
  "compileCache"
] as const;
const BUTTON_SETTINGS_PLACEMENT_KEYS = [
  "x",
  "y",
  "width",
  "height",
  "zIndex",
  "textFitMode",
  "textAlignment",
  "textOffsetX",
  "textOffsetY",
  "minimumFontSize",
  "textSizeOverride",
  "allowLabelResize",
  "matchHitboxToSkin",
  "allowStretching",
  "highlightOnHover",
  "resizeAnchor",
  "activationCycle",
  "visualStateMap"
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function normalized(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("en");
}

function namesMatch(left: string, right: string): boolean {
  return normalized(left) === normalized(right);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  issues: string[]
): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) issues.push(`${path}.${key}: Unknown field.`);
  }
  for (const key of keys) {
    if (!(key in value)) issues.push(`${path}.${key}: Missing field.`);
  }
}

function isUtcIsoTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function validateBounds(
  value: unknown,
  path: string,
  issues: string[],
  coordinateKeys: readonly [string, string] = ["left", "top"]
): void {
  if (!isObject(value)) {
    issues.push(`${path}: Expected a bounds object.`);
    return;
  }
  hasExactKeys(value, [coordinateKeys[0], coordinateKeys[1], "width", "height"], path, issues);
  for (const key of coordinateKeys) {
    if (!isFiniteNumber(value[key])) issues.push(`${path}.${key}: Expected a finite number.`);
  }
  for (const key of ["width", "height"] as const) {
    if (!isFiniteNumber(value[key]) || value[key] <= 0) {
      issues.push(`${path}.${key}: Expected a positive finite number.`);
    }
  }
}

function validateAnimation(value: unknown, path: string, issues: string[]): void {
  if (value === null) return;
  if (!isObject(value)) {
    issues.push(`${path}: Expected null or an activation-animation object.`);
    return;
  }
  hasExactKeys(value, ["presetId", "desktopBounds"], path, issues);
  if (value.presetId !== "plus-rise") {
    issues.push(`${path}.presetId: Unsupported activation-animation preset.`);
  }
  validateBounds(value.desktopBounds, `${path}.desktopBounds`, issues);
}

function validateSkin(value: unknown, path: string, issues: string[]): void {
  if (!isObject(value)) {
    issues.push(`${path}: Expected a Button skin object.`);
    return;
  }
  hasExactKeys(value, BUTTON_SKIN_KEYS, path, issues);
  if (!nonemptyString(value.id)) issues.push(`${path}.id: Expected a nonempty skin ID.`);
  if (typeof value.name !== "string") issues.push(`${path}.name: Expected a string.`);
  for (const section of [
    "structure",
    "keyframes",
    "base",
    "hover",
    "play",
    "pressed",
    "held",
    "release",
    "disabled",
    "error"
  ]) {
    if (typeof value[section] !== "string") issues.push(`${path}.${section}: Expected a string.`);
  }
  if (!isObject(value.metadata)) issues.push(`${path}.metadata: Expected a JSON object.`);
  if (value.compileCache !== null) {
    if (!isObject(value.compileCache)) {
      issues.push(`${path}.compileCache: Expected null or a compile-cache object.`);
    } else {
      hasExactKeys(
        value.compileCache,
        ["compilerVersion", "sourceFingerprint"],
        `${path}.compileCache`,
        issues
      );
      if (value.compileCache.compilerVersion !== 1) {
        issues.push(`${path}.compileCache.compilerVersion: Unsupported compiler version.`);
      }
      if (typeof value.compileCache.sourceFingerprint !== "string") {
        issues.push(`${path}.compileCache.sourceFingerprint: Expected a string.`);
      }
    }
  }
}

function validatePlacement(
  value: unknown,
  index: number,
  surface: ButtonSettingsFileSurface | null,
  issues: string[]
): void {
  const path = `settings.entries.${index}.placement`;
  if (!isObject(value)) {
    issues.push(`${path}: Expected a placement settings object.`);
    return;
  }
  hasExactKeys(value, BUTTON_SETTINGS_PLACEMENT_KEYS, path, issues);
  for (const key of ["x", "y"] as const) {
    if (!isFiniteNumber(value[key]) || value[key] < 0) {
      issues.push(`${path}.${key}: Expected a nonnegative finite number.`);
    }
  }
  for (const key of ["width", "height"] as const) {
    if (!isFiniteNumber(value[key]) || value[key] <= 0) {
      issues.push(`${path}.${key}: Expected a positive finite number.`);
    }
  }
  if (!Number.isSafeInteger(value.zIndex) || value.zIndex !== index) {
    issues.push(`${path}.zIndex: Expected the ordered index ${index}.`);
  }
  if (!BUTTON_TEXT_FIT_MODES.has(String(value.textFitMode))) {
    issues.push(`${path}.textFitMode: Unsupported text-fit mode.`);
  }
  if (!BUTTON_TEXT_ALIGNMENTS.has(String(value.textAlignment))) {
    issues.push(`${path}.textAlignment: Unsupported text alignment.`);
  }
  for (const key of ["textOffsetX", "textOffsetY"] as const) {
    if (!isFiniteNumber(value[key])) issues.push(`${path}.${key}: Expected a finite number.`);
  }
  if (!isFiniteNumber(value.minimumFontSize) || value.minimumFontSize <= 0) {
    issues.push(`${path}.minimumFontSize: Expected a positive finite number.`);
  }
  if (
    value.textSizeOverride !== null &&
    (!isFiniteNumber(value.textSizeOverride) || value.textSizeOverride <= 0)
  ) {
    issues.push(`${path}.textSizeOverride: Expected null or a positive finite number.`);
  }
  for (const key of [
    "allowLabelResize",
    "matchHitboxToSkin",
    "allowStretching",
    "highlightOnHover"
  ] as const) {
    if (typeof value[key] !== "boolean") issues.push(`${path}.${key}: Expected a boolean.`);
  }
  if (value.resizeAnchor !== "top-left") {
    issues.push(`${path}.resizeAnchor: Expected 'top-left'.`);
  }
  if (value.activationCycle !== null && !isObject(value.activationCycle)) {
    issues.push(`${path}.activationCycle: Expected null or an activation-cycle object.`);
  }
  if (value.visualStateMap !== null && !isObject(value.visualStateMap)) {
    issues.push(`${path}.visualStateMap: Expected null or a visual-state map.`);
  }
  if (
    surface &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    (value.x + value.width > surface.width || value.y + value.height > surface.height)
  ) {
    issues.push(`${path}: Placement exceeds the saved surface bounds.`);
  }
}

function validateBehavior(
  value: unknown,
  placementKind: ButtonSettingsPlacementKind | null,
  issues: string[]
): void {
  const path = "settings.behavior";
  if (!isObject(value) || typeof value.kind !== "string") {
    issues.push(`${path}: Expected a placement behavior object.`);
    return;
  }
  if (value.kind === "main-page") {
    hasExactKeys(value, ["kind"], path, issues);
    if (placementKind !== "main-page") {
      issues.push(`${path}.kind: Main Page behavior requires Main Page settings.`);
    }
    return;
  }
  if (value.kind === "regular-popout" || value.kind === "tool-set-popout") {
    hasExactKeys(
      value,
      value.kind === "tool-set-popout"
        ? ["kind", "ownerButtonId", "openRule", "closeRule", "transparency", "pinnedDefault", "windowFitMode"]
        : ["kind", "openRule", "closeRule", "transparency", "pinnedDefault", "windowFitMode"],
      path,
      issues
    );
    if (placementKind !== "pop-out") {
      issues.push(`${path}.kind: Pop-out behavior requires Pop-out settings.`);
    }
    if (value.kind === "tool-set-popout" && !nonemptyString(value.ownerButtonId)) {
      issues.push(`${path}.ownerButtonId: Expected a nonempty owner Button ID.`);
    }
    if (!BUTTON_OPEN_RULES.has(value.openRule as ButtonPopoutOpenRule)) {
      issues.push(`${path}.openRule: Unsupported Pop-out open rule.`);
    }
    if (!BUTTON_CLOSE_RULES.has(value.closeRule as ButtonPopoutCloseRule)) {
      issues.push(`${path}.closeRule: Unsupported Pop-out close rule.`);
    }
    if (!isFiniteNumber(value.transparency) || value.transparency < 0 || value.transparency > 1) {
      issues.push(`${path}.transparency: Expected a finite value from 0 through 1.`);
    }
    if (typeof value.pinnedDefault !== "boolean") {
      issues.push(`${path}.pinnedDefault: Expected a boolean.`);
    }
    if (!BUTTON_WINDOW_FIT_MODES.has(value.windowFitMode as ButtonWindowFitMode)) {
      issues.push(`${path}.windowFitMode: Unsupported window-fit mode.`);
    }
    return;
  }
  if (value.kind === "fan") {
    hasExactKeys(
      value,
      [
        "kind",
        "panelOwnerButtonId",
        "selectedToolSetOwnerButtonIds",
        "toolSetOwnerAnchors",
        "openRule",
        "closeRule",
        "pinnedDefault",
        "animation",
        "windowFitMode"
      ],
      path,
      issues
    );
    if (placementKind !== "fan") issues.push(`${path}.kind: Fan behavior requires Fan settings.`);
    if (!nonemptyString(value.panelOwnerButtonId)) {
      issues.push(`${path}.panelOwnerButtonId: Expected a nonempty panel-owner Button ID.`);
    }
    if (
      !Array.isArray(value.selectedToolSetOwnerButtonIds) ||
      !value.selectedToolSetOwnerButtonIds.every(nonemptyString) ||
      new Set(value.selectedToolSetOwnerButtonIds).size !== value.selectedToolSetOwnerButtonIds.length
    ) {
      issues.push(`${path}.selectedToolSetOwnerButtonIds: Expected unique nonempty Button IDs.`);
    }
    if (!isObject(value.toolSetOwnerAnchors)) {
      issues.push(`${path}.toolSetOwnerAnchors: Expected an anchor map.`);
    } else {
      for (const [ownerId, bounds] of Object.entries(value.toolSetOwnerAnchors)) {
        validateBounds(bounds, `${path}.toolSetOwnerAnchors.${ownerId}`, issues);
      }
    }
    if (!BUTTON_OPEN_RULES.has(value.openRule as ButtonPopoutOpenRule)) {
      issues.push(`${path}.openRule: Unsupported Fan open rule.`);
    }
    if (!BUTTON_CLOSE_RULES.has(value.closeRule as ButtonPopoutCloseRule)) {
      issues.push(`${path}.closeRule: Unsupported Fan close rule.`);
    }
    if (typeof value.pinnedDefault !== "boolean") {
      issues.push(`${path}.pinnedDefault: Expected a boolean.`);
    }
    if (!isObject(value.animation)) {
      issues.push(`${path}.animation: Expected Fan animation settings.`);
    } else {
      hasExactKeys(value.animation, ["durationMs", "easing", "staggerMs"], `${path}.animation`, issues);
      if (!isFiniteNumber(value.animation.durationMs) || value.animation.durationMs < 0) {
        issues.push(`${path}.animation.durationMs: Expected a nonnegative finite number.`);
      }
      if (typeof value.animation.easing !== "string") {
        issues.push(`${path}.animation.easing: Expected a string.`);
      }
      if (!isFiniteNumber(value.animation.staggerMs) || value.animation.staggerMs < 0) {
        issues.push(`${path}.animation.staggerMs: Expected a nonnegative finite number.`);
      }
    }
    if (!BUTTON_WINDOW_FIT_MODES.has(value.windowFitMode as ButtonWindowFitMode)) {
      issues.push(`${path}.windowFitMode: Unsupported window-fit mode.`);
    }
    return;
  }
  issues.push(`${path}.kind: Unsupported placement behavior.`);
}

export function buttonSettingsPlacementKind(
  surface: Pick<ButtonSurface, "kind">
): ButtonSettingsPlacementKind {
  if (surface.kind === "main" || surface.kind === "panel") return "main-page";
  if (surface.kind === "fan") return "fan";
  return "pop-out";
}

export function buttonSettingsPlacementLabel(kind: ButtonSettingsPlacementKind): string {
  if (kind === "main-page") return "Main Page";
  if (kind === "fan") return "Fan";
  return "Pop-out";
}

export function validateButtonSettingsFile(value: unknown): ButtonSettingsFileValidationResult {
  const issues: string[] = [];
  if (!isObject(value)) {
    return { valid: false, issues: ["settings: Button settings file must be an object."] };
  }
  hasExactKeys(
    value,
    [
      "format",
      "savedAt",
      "placementKind",
      "programName",
      "panelName",
      "sourceSurfaceId",
      "surface",
      "behavior",
      "entries"
    ],
    "settings",
    issues
  );
  if (value.format !== BUTTON_SETTINGS_FILE_FORMAT) {
    issues.push(`settings.format: Expected '${BUTTON_SETTINGS_FILE_FORMAT}'.`);
  }
  if (!isUtcIsoTimestamp(value.savedAt)) {
    issues.push("settings.savedAt: Expected a UTC ISO timestamp.");
  }
  const placementKind = (
    value.placementKind === "main-page" ||
    value.placementKind === "fan" ||
    value.placementKind === "pop-out"
  ) ? value.placementKind : null;
  if (!placementKind) issues.push("settings.placementKind: Unsupported placement type.");
  if (!nonemptyString(value.programName)) {
    issues.push("settings.programName: Expected a nonempty program name.");
  }
  if (!nonemptyString(value.panelName)) {
    issues.push("settings.panelName: Expected a nonempty panel name.");
  }
  if (!nonemptyString(value.sourceSurfaceId)) {
    issues.push("settings.sourceSurfaceId: Expected a nonempty source surface ID.");
  }

  let surface: ButtonSettingsFileSurface | null = null;
  if (!isObject(value.surface)) {
    issues.push("settings.surface: Expected a surface settings object.");
  } else {
    hasExactKeys(
      value.surface,
      ["name", "kind", "width", "height", "visualOverflowAllowance", "uniformButtonSize"],
      "settings.surface",
      issues
    );
    if (!nonemptyString(value.surface.name)) {
      issues.push("settings.surface.name: Expected a nonempty surface name.");
    }
    if (!BUTTON_SURFACE_KINDS.has(value.surface.kind as ButtonSurfaceKind)) {
      issues.push("settings.surface.kind: Unsupported Button surface kind.");
    }
    if (!isFiniteNumber(value.surface.width) || value.surface.width <= 0) {
      issues.push("settings.surface.width: Expected a positive finite number.");
    }
    if (!isFiniteNumber(value.surface.height) || value.surface.height <= 0) {
      issues.push("settings.surface.height: Expected a positive finite number.");
    }
    if (
      !isFiniteNumber(value.surface.visualOverflowAllowance) ||
      value.surface.visualOverflowAllowance < 0
    ) {
      issues.push("settings.surface.visualOverflowAllowance: Expected a nonnegative finite number.");
    }
    if (value.surface.uniformButtonSize !== null) {
      validateBounds(
        isObject(value.surface.uniformButtonSize)
          ? { left: 0, top: 0, ...value.surface.uniformButtonSize }
          : value.surface.uniformButtonSize,
        "settings.surface.uniformButtonSize",
        issues
      );
    }
    if (
      placementKind &&
      BUTTON_SURFACE_KINDS.has(value.surface.kind as ButtonSurfaceKind) &&
      buttonSettingsPlacementKind({ kind: value.surface.kind as ButtonSurfaceKind }) !== placementKind
    ) {
      issues.push("settings.surface.kind: Surface kind does not match the placement type.");
    }
    surface = value.surface as unknown as ButtonSettingsFileSurface;
  }

  validateBehavior(value.behavior, placementKind, issues);
  if (!Array.isArray(value.entries)) {
    issues.push("settings.entries: Expected an ordered settings entry array.");
  } else {
    const placementIds = new Set<string>();
    const buttonIds = new Set<string>();
    value.entries.forEach((entry, index) => {
      const path = `settings.entries.${index}`;
      if (!isObject(entry)) {
        issues.push(`${path}: Expected a Button settings entry.`);
        return;
      }
      hasExactKeys(
        entry,
        [
          "placementId",
          "buttonId",
          "buttonRole",
          "label",
          "activationBehavior",
          "activationAnimation",
          "skin",
          "placement"
        ],
        path,
        issues
      );
      if (!nonemptyString(entry.placementId)) {
        issues.push(`${path}.placementId: Expected a nonempty placement ID.`);
      } else if (placementIds.has(entry.placementId)) {
        issues.push(`${path}.placementId: Duplicate placement ID '${entry.placementId}'.`);
      } else {
        placementIds.add(entry.placementId);
      }
      if (!nonemptyString(entry.buttonId)) {
        issues.push(`${path}.buttonId: Expected a nonempty Button ID.`);
      } else if (buttonIds.has(entry.buttonId)) {
        issues.push(`${path}.buttonId: Duplicate Button ID '${entry.buttonId}'.`);
      } else {
        buttonIds.add(entry.buttonId);
      }
      if (!BUTTON_ROLES.has(entry.buttonRole as ButtonRole)) {
        issues.push(`${path}.buttonRole: Unsupported Button role.`);
      }
      if (typeof entry.label !== "string") issues.push(`${path}.label: Expected a string.`);
      if (entry.activationBehavior !== null && !isObject(entry.activationBehavior)) {
        issues.push(`${path}.activationBehavior: Expected null or an activation-behavior object.`);
      }
      validateAnimation(entry.activationAnimation, `${path}.activationAnimation`, issues);
      validateSkin(entry.skin, `${path}.skin`, issues);
      validatePlacement(entry.placement, index, surface, issues);
    });
  }
  return { valid: issues.length === 0, issues };
}

function resolveBehavior(
  document: ButtonStateDocument,
  surface: ButtonSurface
): ButtonSettingsFileBehavior {
  if (surface.kind === "main" || surface.kind === "panel") return { kind: "main-page" };
  if (surface.kind === "fan") {
    const setup = Object.values(document.fanSetups).find(
      (candidate) => candidate.fanSurfaceId === surface.id
    );
    if (!setup) throw new Error(`Fan surface '${surface.id}' has no saved Fan setup.`);
    return {
      kind: "fan",
      panelOwnerButtonId: setup.panelOwnerButtonId,
      selectedToolSetOwnerButtonIds: [...setup.selectedToolSetOwnerButtonIds],
      toolSetOwnerAnchors: structuredClone(setup.toolSetOwnerAnchors),
      openRule: setup.openRule,
      closeRule: setup.closeRule,
      pinnedDefault: setup.pinnedDefault,
      animation: structuredClone(setup.animation),
      windowFitMode: setup.windowFitMode ?? "surface"
    };
  }
  const unit = Object.values(document.popoutUnits).find(
    (candidate) => candidate.surfaceId === surface.id
  );
  if (!unit) throw new Error(`Pop-out surface '${surface.id}' has no saved Pop-out unit.`);
  const common = {
    openRule: unit.openRule,
    closeRule: unit.closeRule,
    transparency: unit.transparency,
    pinnedDefault: unit.pinnedDefault,
    windowFitMode: unit.windowFitMode ?? "surface"
  };
  return unit.kind === "tool-set"
    ? { kind: "tool-set-popout", ownerButtonId: unit.ownerButtonId, ...common }
    : { kind: "regular-popout", ...common };
}

export function buildButtonSettingsFile(
  document: ButtonStateDocument,
  surfaceId: string,
  context: ButtonSettingsFileBuildContext
): ButtonSettingsFile {
  const surface = document.surfaces[surfaceId];
  if (!surface) throw new Error(`Button surface '${surfaceId}' does not exist.`);
  const entries = surface.placementIds.map((placementId, index): ButtonSettingsFileEntry => {
    const placement = document.placements[placementId];
    if (!placement || placement.surfaceId !== surface.id) {
      throw new Error(`Button surface '${surface.id}' has an invalid placement '${placementId}'.`);
    }
    const button = document.buttons[placement.buttonId];
    if (!button) throw new Error(`Button placement '${placementId}' has no Button.`);
    const skin = document.skins[placement.skinOverrideId ?? button.defaultSkinId];
    if (!skin) throw new Error(`Button '${button.id}' has no effective skin.`);
    const {
      id: _placementId,
      buttonId: _buttonId,
      surfaceId: _surfaceId,
      skinOverrideId: _skinOverrideId,
      ...placementSettings
    } = placement;
    return {
      placementId,
      buttonId: button.id,
      buttonRole: button.role,
      label: button.label,
      activationBehavior: structuredClone(button.activationBehavior),
      activationAnimation: structuredClone(button.activationAnimation),
      skin: structuredClone(skin),
      placement: {
        ...structuredClone(placementSettings),
        zIndex: index
      }
    };
  });
  const file: ButtonSettingsFile = {
    format: BUTTON_SETTINGS_FILE_FORMAT,
    savedAt: context.savedAt ?? new Date().toISOString(),
    placementKind: buttonSettingsPlacementKind(surface),
    programName: context.programName.trim(),
    panelName: context.panelName.trim(),
    sourceSurfaceId: surface.id,
    surface: {
      name: surface.name,
      kind: surface.kind,
      width: surface.width,
      height: surface.height,
      visualOverflowAllowance: surface.visualOverflowAllowance,
      uniformButtonSize: surface.uniformButtonSize
        ? { ...surface.uniformButtonSize }
        : null
    },
    behavior: resolveBehavior(document, surface),
    entries
  };
  const validation = validateButtonSettingsFile(file);
  if (!validation.valid) throw new Error(validation.issues.join("\n"));
  return file;
}

function skinsEqual(left: ButtonSkin, right: ButtonSkin): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function uniqueRecordId(records: Record<string, unknown>, preferredId: string, prefix: string): string {
  if (!records[preferredId]) return preferredId;
  const base = `${prefix}-${preferredId}`;
  if (!records[base]) return base;
  for (let suffix = 2; suffix < Number.MAX_SAFE_INTEGER; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!records[candidate]) return candidate;
  }
  throw new Error(`Could not create a unique ${prefix} ID.`);
}

function installSettingsSkin(
  document: ButtonStateDocument,
  skin: ButtonSkin
): string {
  const current = document.skins[skin.id];
  if (current && skinsEqual(current, skin)) return skin.id;
  const skinId = current
    ? uniqueRecordId(document.skins, skin.id, "settings-skin")
    : skin.id;
  document.skins[skinId] = {
    ...structuredClone(skin),
    id: skinId
  };
  return skinId;
}

function updateSurfaceOwnerRecords(
  document: ButtonStateDocument,
  surface: ButtonSurface,
  file: ButtonSettingsFile
): void {
  if (surface.kind === "main" || surface.kind === "panel") {
    if (file.behavior.kind !== "main-page") {
      throw new Error("Main Page settings do not match the selected surface.");
    }
    return;
  }
  if (surface.kind === "regular-popout" || surface.kind === "tool-set-popout") {
    const unit = Object.values(document.popoutUnits).find(
      (candidate) => candidate.surfaceId === surface.id
    );
    if (!unit) throw new Error("The selected Pop-out no longer has a canonical owner.");
    const expectedBehavior = unit.kind === "tool-set" ? "tool-set-popout" : "regular-popout";
    if (file.behavior.kind !== expectedBehavior) {
      throw new Error("Regular and Tool Set Pop-out settings cannot be interchanged.");
    }
    unit.openRule = file.behavior.openRule;
    unit.closeRule = file.behavior.closeRule;
    unit.transparency = file.behavior.transparency;
    unit.pinnedDefault = file.behavior.pinnedDefault;
    unit.windowFitMode = file.behavior.windowFitMode;
    unit.canonicalBounds = { x: 0, y: 0, width: surface.width, height: surface.height };
    if (unit.kind === "regular" && file.behavior.kind === "regular-popout") {
      unit.memberPlacementIds = [...surface.placementIds];
      unit.memberSourceIdentities = surface.placementIds.map((placementId) => {
        const placement = document.placements[placementId];
        const identity = placement ? document.buttons[placement.buttonId]?.sourceIdentity : null;
        if (!identity) {
          throw new Error(`Regular Pop-out placement '${placementId}' has no script identity.`);
        }
        return structuredClone(identity);
      });
      unit.selectionKey = deriveRegularPopoutSelectionKey(unit.memberSourceIdentities);
      return;
    }
    if (unit.kind === "tool-set" && file.behavior.kind === "tool-set-popout") {
      if (file.behavior.ownerButtonId !== unit.ownerButtonId) {
        throw new Error("Tool Set settings belong to a different owner Button.");
      }
      const childButtonIds = surface.placementIds.map(
        (placementId) => document.placements[placementId].buttonId
      );
      const savedChildIds = new Set(childButtonIds);
      if (
        savedChildIds.size !== unit.childButtonIds.length ||
        unit.childButtonIds.some((buttonId) => !savedChildIds.has(buttonId))
      ) {
        throw new Error(
          "Tool Set settings cannot add or remove package-owned child actions."
        );
      }
      for (const buttonId of childButtonIds) {
        const child = document.buttons[buttonId];
        if (child?.role !== "tool-set-child" || child.toolSetParentId !== unit.ownerButtonId) {
          throw new Error(`Button '${buttonId}' is not a child of this Tool Set.`);
        }
      }
      unit.childButtonIds = childButtonIds;
      unit.childPlacementIds = [...surface.placementIds];
      return;
    }
    throw new Error("The selected Pop-out settings are internally inconsistent.");
  }

  const setup = Object.values(document.fanSetups).find(
    (candidate) => candidate.fanSurfaceId === surface.id
  );
  if (!setup || file.behavior.kind !== "fan") {
    throw new Error("The selected Fan no longer has matching canonical settings.");
  }
  if (file.behavior.panelOwnerButtonId !== setup.panelOwnerButtonId) {
    throw new Error("Fan settings belong to a different panel owner.");
  }
  const panelOwnerPlacements = surface.placementIds.filter((placementId) =>
    document.placements[placementId]?.buttonId === setup.panelOwnerButtonId
  );
  if (panelOwnerPlacements.length !== 1) {
    throw new Error("Fan settings must contain exactly one placement for the selected panel owner.");
  }
  const memberPlacementIds = surface.placementIds.filter((placementId) => {
    const placement = document.placements[placementId];
    return placement && document.buttons[placement.buttonId]?.role === "single-script";
  });
  const selectedOwnerIds = [...file.behavior.selectedToolSetOwnerButtonIds];
  for (const ownerId of selectedOwnerIds) {
    if (document.buttons[ownerId]?.role !== "tool-set-owner") {
      throw new Error(`Fan Tool Set owner '${ownerId}' is no longer available.`);
    }
    if (!file.behavior.toolSetOwnerAnchors[ownerId]) {
      throw new Error(`Fan Tool Set owner '${ownerId}' has no saved anchor.`);
    }
  }
  setup.fanMemberPlacementIds = memberPlacementIds;
  setup.fanMemberButtonIds = memberPlacementIds.map(
    (placementId) => document.placements[placementId].buttonId
  );
  setup.selectedToolSetOwnerButtonIds = selectedOwnerIds;
  setup.toolSetOwnerAnchors = structuredClone(file.behavior.toolSetOwnerAnchors);
  setup.openRule = file.behavior.openRule;
  setup.closeRule = file.behavior.closeRule;
  setup.pinnedDefault = file.behavior.pinnedDefault;
  setup.animation = structuredClone(file.behavior.animation);
  setup.windowFitMode = file.behavior.windowFitMode;
}

export function applyButtonSettingsFile(
  document: ButtonStateDocument,
  selectedSurfaceId: string,
  value: unknown,
  context: ButtonSettingsFileApplyContext
): ButtonStateDocument {
  const fileValidation = validateButtonSettingsFile(value);
  if (!fileValidation.valid) throw new Error(fileValidation.issues.join("\n"));
  const file = value as ButtonSettingsFile;
  const selectedSurface = document.surfaces[selectedSurfaceId];
  if (!selectedSurface) throw new Error("Select an existing Button surface before loading settings.");
  if (file.placementKind !== buttonSettingsPlacementKind(selectedSurface)) {
    throw new Error(
      `${buttonSettingsPlacementLabel(file.placementKind)} settings cannot be loaded into ` +
      `${buttonSettingsPlacementLabel(buttonSettingsPlacementKind(selectedSurface))}.`
    );
  }
  if (file.surface.kind !== selectedSurface.kind) {
    throw new Error(
      `These ${buttonSettingsPlacementLabel(file.placementKind)} settings were saved from a ` +
      `different concrete surface type.`
    );
  }
  const sameConcreteSurface = file.sourceSurfaceId === selectedSurfaceId;
  if (
    !sameConcreteSurface &&
    (!namesMatch(file.programName, context.programName) ||
      !namesMatch(file.panelName, context.panelName))
  ) {
    throw new Error(
      `These settings belong to '${file.programName} / ${file.panelName}', not ` +
      `'${context.programName} / ${context.panelName}'.`
    );
  }

  const next = cloneButtonDocument(document);
  const nextSurface = next.surfaces[selectedSurfaceId];
  const previousPlacements = nextSurface.placementIds.flatMap((placementId) => {
    const placement = next.placements[placementId];
    return placement ? [placement] : [];
  });
  const previousPlacementByButtonId = new Map(
    previousPlacements.map((placement) => [placement.buttonId, placement])
  );
  for (const placement of previousPlacements) delete next.placements[placement.id];

  nextSurface.name = file.surface.name;
  nextSurface.width = file.surface.width;
  nextSurface.height = file.surface.height;
  nextSurface.visualOverflowAllowance = file.surface.visualOverflowAllowance;
  nextSurface.uniformButtonSize = file.surface.uniformButtonSize
    ? { ...file.surface.uniformButtonSize }
    : null;
  nextSurface.placementIds = [];

  for (const entry of file.entries) {
    const button = next.buttons[entry.buttonId];
    if (!button) {
      throw new Error(
        `Button '${entry.buttonId}' is not installed. Settings never recreate actions or source packages.`
      );
    }
    if (button.role !== entry.buttonRole) {
      throw new Error(`Button '${entry.buttonId}' no longer has the saved role '${entry.buttonRole}'.`);
    }
    const previousPlacement = previousPlacementByButtonId.get(entry.buttonId);
    const preferredPlacementId = previousPlacement?.id ?? entry.placementId;
    const placementId = uniqueRecordId(next.placements, preferredPlacementId, "settings-placement");
    const skinId = installSettingsSkin(next, entry.skin);
    button.label = entry.label;
    button.activationBehavior = structuredClone(entry.activationBehavior);
    button.activationAnimation = structuredClone(entry.activationAnimation);
    next.placements[placementId] = {
      id: placementId,
      buttonId: button.id,
      surfaceId: selectedSurfaceId,
      skinOverrideId: skinId,
      ...structuredClone(entry.placement),
      zIndex: nextSurface.placementIds.length
    };
    nextSurface.placementIds.push(placementId);
  }

  updateSurfaceOwnerRecords(next, nextSurface, file);
  const documentValidation = validateButtonStateDocument(next);
  if (!documentValidation.valid) {
    throw new Error(
      documentValidation.issues
        .slice(0, 12)
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("\n")
    );
  }
  return next;
}

function buttonBelongsToPanel(
  document: ButtonStateDocument,
  buttonId: string,
  context: ButtonSettingsFileApplyContext
): boolean {
  const identity = document.buttons[buttonId]?.sourceIdentity;
  return Boolean(
    identity &&
    namesMatch(identity.displayProgramName, context.programName) &&
    namesMatch(identity.displayPanelName, context.panelName)
  );
}

/**
 * Builds the document consumed by a Main-page Open Pop window. The returned
 * document is an isolated draft and must never be saved as canonical state.
 */
export function buildTransientButtonPopoutSettingsDocument(
  document: ButtonStateDocument,
  value: unknown,
  context: ButtonSettingsFileApplyContext,
  transientChoiceId: string
): TransientButtonPopoutSettingsDocument {
  const fileValidation = validateButtonSettingsFile(value);
  if (!fileValidation.valid) throw new Error(fileValidation.issues.join("\n"));
  const file = value as ButtonSettingsFile;
  if (file.placementKind !== "pop-out") {
    throw new Error("Open Pop accepts only Pop-out settings files.");
  }
  const choiceId = transientChoiceId.trim();
  if (!choiceId) throw new Error("Open Pop requires a stable transient choice ID.");

  const working = cloneButtonDocument(document);
  const transientSurfaceId = uniqueRecordId(
    working.surfaces,
    `open-pop-surface-${choiceId}`,
    "open-pop-surface"
  );
  const transientUnitId = uniqueRecordId(
    working.popoutUnits,
    `open-pop-unit-${choiceId}`,
    "open-pop-unit"
  );
  working.surfaces[transientSurfaceId] = {
    id: transientSurfaceId,
    name: file.surface.name,
    kind: file.surface.kind,
    width: file.surface.width,
    height: file.surface.height,
    placementIds: [],
    visualOverflowAllowance: file.surface.visualOverflowAllowance,
    uniformButtonSize: file.surface.uniformButtonSize
      ? { ...file.surface.uniformButtonSize }
      : null
  };

  let unit: ButtonPopoutUnit;
  if (file.behavior.kind === "regular-popout") {
    if (file.entries.length === 0) {
      throw new Error("A regular Pop-out settings file must contain at least one Button.");
    }
    const buttons = file.entries.map((entry) => {
      const button = working.buttons[entry.buttonId];
      if (!button) {
        throw new Error(
          `Button '${entry.buttonId}' is not installed. Open Pop never recreates actions or source packages.`
        );
      }
      if (
        entry.buttonRole !== "single-script" ||
        button.role !== "single-script" ||
        !buttonBelongsToPanel(working, button.id, context)
      ) {
        throw new Error(
          `Button '${entry.buttonId}' does not belong to '${context.programName} / ${context.panelName}'.`
        );
      }
      return button;
    });
    const memberSourceIdentities = buttons.map((button) =>
      structuredClone(button.sourceIdentity!)
    );
    unit = {
      id: transientUnitId,
      name: file.surface.name,
      kind: "regular",
      surfaceId: transientSurfaceId,
      canonicalBounds: {
        x: 0,
        y: 0,
        width: file.surface.width,
        height: file.surface.height
      },
      desktopBounds: null,
      desktopBoundsFitMode: file.behavior.windowFitMode,
      desktopBoundsEnvelope: {
        x: 0,
        y: 0,
        width: file.surface.width,
        height: file.surface.height
      },
      memberPlacementIds: [],
      openRule: file.behavior.openRule,
      closeRule: file.behavior.closeRule,
      transparency: file.behavior.transparency,
      pinnedDefault: file.behavior.pinnedDefault,
      windowFitMode: file.behavior.windowFitMode,
      memberSourceIdentities,
      selectionKey: deriveRegularPopoutSelectionKey(memberSourceIdentities)
    };
  } else if (file.behavior.kind === "tool-set-popout") {
    const owner = working.buttons[file.behavior.ownerButtonId];
    if (
      !owner ||
      owner.role !== "tool-set-owner" ||
      !buttonBelongsToPanel(working, owner.id, context)
    ) {
      throw new Error(
        `Tool Set owner '${file.behavior.ownerButtonId}' does not belong to ` +
        `'${context.programName} / ${context.panelName}'.`
      );
    }
    const sourceUnit = Object.values(working.popoutUnits).find(
      (candidate): candidate is ToolSetButtonPopoutUnit =>
        candidate.kind === "tool-set" &&
        candidate.ownerButtonId === owner.id
    );
    if (!sourceUnit) {
      throw new Error(`Tool Set owner '${owner.label}' no longer has an installed Pop-out.`);
    }
    for (const entry of file.entries) {
      const child = working.buttons[entry.buttonId];
      if (
        !child ||
        entry.buttonRole !== "tool-set-child" ||
        child.role !== "tool-set-child" ||
        child.toolSetParentId !== owner.id
      ) {
        throw new Error(`Button '${entry.buttonId}' is not an installed child of '${owner.label}'.`);
      }
    }
    const savedChildIds = new Set(file.entries.map((entry) => entry.buttonId));
    if (
      savedChildIds.size !== sourceUnit.childButtonIds.length ||
      sourceUnit.childButtonIds.some((buttonId) => !savedChildIds.has(buttonId))
    ) {
      throw new Error(
        `Tool Set '${owner.label}' no longer has the same installed child actions as this Pop-out file.`
      );
    }
    unit = {
      ...structuredClone(sourceUnit),
      id: transientUnitId,
      name: file.surface.name,
      surfaceId: transientSurfaceId,
      canonicalBounds: {
        x: 0,
        y: 0,
        width: file.surface.width,
        height: file.surface.height
      },
      desktopBounds: null,
      desktopBoundsFitMode: file.behavior.windowFitMode,
      desktopBoundsEnvelope: {
        x: 0,
        y: 0,
        width: file.surface.width,
        height: file.surface.height
      },
      childPlacementIds: [],
      openRule: file.behavior.openRule,
      closeRule: file.behavior.closeRule,
      transparency: file.behavior.transparency,
      pinnedDefault: file.behavior.pinnedDefault,
      windowFitMode: file.behavior.windowFitMode
    };
  } else {
    throw new Error("Open Pop accepts only regular or Tool Set Pop-out settings.");
  }

  const transientSurface = working.surfaces[transientSurfaceId];
  for (const entry of file.entries) {
    const button = working.buttons[entry.buttonId];
    if (!button) {
      throw new Error(
        `Button '${entry.buttonId}' is not installed. Open Pop never recreates actions or source packages.`
      );
    }
    const skinId = installSettingsSkin(working, entry.skin);
    const placementId = uniqueRecordId(
      working.placements,
      `open-pop-${choiceId}-${entry.placementId}`,
      "open-pop-placement"
    );
    button.label = entry.label;
    button.activationBehavior = structuredClone(entry.activationBehavior);
    button.activationAnimation = structuredClone(entry.activationAnimation);
    working.placements[placementId] = {
      id: placementId,
      buttonId: button.id,
      surfaceId: transientSurfaceId,
      skinOverrideId: skinId,
      ...structuredClone(entry.placement),
      zIndex: transientSurface.placementIds.length
    };
    transientSurface.placementIds.push(placementId);
  }
  if (unit.kind === "regular") {
    unit.memberPlacementIds = [...transientSurface.placementIds];
  } else {
    unit.childButtonIds = file.entries.map((entry) => entry.buttonId);
    unit.childPlacementIds = [...transientSurface.placementIds];
  }
  working.popoutUnits[unit.id] = unit;

  const documentValidation = validateButtonStateDocument(working);
  if (!documentValidation.valid) {
    throw new Error(
      documentValidation.issues
        .slice(0, 12)
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("\n")
    );
  }
  return {
    document: working,
    popoutUnitId: transientUnitId,
    ...(unit.kind === "tool-set" ? { ownerButtonId: unit.ownerButtonId } : {})
  };
}
