import {
  BUTTON_SKIN_COMPILER_VERSION,
  BUTTON_STATE_SCHEMA_VERSION,
  type ButtonExecutionTarget,
  type ButtonPopoutUnit,
  type ButtonRect,
  type ButtonRecord,
  type ButtonSourceIdentity,
  type ButtonStateDocument,
  type ButtonToolField
} from "../types.js";
import { buttonRectsOverlap } from "../geometry/buttonGeometry.js";
import {
  createButtonSourceIdentity,
  deriveRegularPopoutSelectionKey
} from "./sourceIdentity.js";
import { BUTTON_SKIN_SECTION_ORDER } from "../skins/buttonSkinFormat.js";
import { validateButtonSkin } from "../skins/skinValidator.js";
import { isButtonActivationAnimationPresetId } from "../animations/buttonActivationAnimations.js";

export interface ButtonStateValidationIssue {
  path: string;
  message: string;
  severity: "fatal" | "error";
}

export interface ButtonStateValidationResult {
  valid: boolean;
  structurallyValid: boolean;
  document?: ButtonStateDocument;
  issues: ButtonStateValidationIssue[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasDuplicateStrings(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function haveSameStringMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

const BUTTON_TEXT_FIT_MODES = new Set(["shrink", "stack-whole-words", "shrink-and-stack"]);
const BUTTON_TEXT_ALIGNMENTS = new Set(["skin", "left", "center", "right"]);
const BUTTON_SURFACE_KINDS = new Set(["main", "panel", "regular-popout", "tool-set-popout", "fan"]);
const BUTTON_WINDOW_FIT_MODES = new Set(["surface", "hitbox", "visual"]);

function isUsableDesktopBounds(value: unknown): boolean {
  return isObject(value) &&
    isFiniteNumber(value.left) &&
    isFiniteNumber(value.top) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    value.width > 0 &&
    value.height > 0;
}

function isUsableButtonRect(value: unknown): value is ButtonRect {
  return isObject(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    value.width > 0 &&
    value.height > 0;
}

function addIssue(
  issues: ButtonStateValidationIssue[],
  path: string,
  message: string,
  severity: ButtonStateValidationIssue["severity"] = "error"
): void {
  issues.push({ path, message, severity });
}

function validateIdentity(
  value: unknown,
  path: string,
  issues: ButtonStateValidationIssue[]
): value is ButtonSourceIdentity {
  if (!isObject(value)) {
    addIssue(issues, path, "Source identity must be an object.");
    return false;
  }
  const fields = [
    "displayProgramName",
    "displayPanelName",
    "displayFileName",
    "normalizedProgramName",
    "normalizedPanelName",
    "normalizedFileName"
  ] as const;
  if (fields.some((field) => typeof value[field] !== "string")) {
    addIssue(issues, path, "Source identity fields must be strings.");
    return false;
  }
  const expected = createButtonSourceIdentity(
    value.displayProgramName as string,
    value.displayPanelName as string,
    value.displayFileName as string
  );
  if (
    value.normalizedProgramName !== expected.normalizedProgramName ||
    value.normalizedPanelName !== expected.normalizedPanelName ||
    value.normalizedFileName !== expected.normalizedFileName
  ) {
    addIssue(issues, path, "Stored normalized source identity does not match its display identity.");
  }
  return true;
}

function validateExecutionTarget(
  value: unknown,
  path: string,
  issues: ButtonStateValidationIssue[]
): value is ButtonExecutionTarget {
  if (!isObject(value) || typeof value.kind !== "string") {
    addIssue(issues, path, "Execution target must have a kind.");
    return false;
  }
  if (value.kind === "panel-script") {
    const valid = [value.programName, value.panelName, value.fileName].every(
      (part) => typeof part === "string" && part.trim().length > 0
    );
    if (!valid) addIssue(issues, path, "Panel-script targets require program, panel, and file names.");
    return valid;
  }
  if (value.kind === "tool-set-action") {
    const valid = [value.programName, value.panelName, value.ownerFileName, value.command].every(
      (part) => typeof part === "string" && part.trim().length > 0
    );
    if (!valid) addIssue(issues, path, "Tool-set targets require program, panel, owner file, and command.");
    return valid;
  }
  if (value.kind === "core-action") {
    const valid = typeof value.actionId === "string" && value.actionId.trim().length > 0;
    if (!valid) addIssue(issues, path, "Core-action targets require an explicit stored actionId.");
    return valid;
  }
  addIssue(issues, path, `Unknown execution target kind '${String(value.kind)}'.`);
  return false;
}

function validateButtonRecord(
  value: unknown,
  key: string,
  issues: ButtonStateValidationIssue[]
): value is ButtonRecord {
  const path = `buttons.${key}`;
  if (!isObject(value)) {
    addIssue(issues, path, "Button record must be an object.");
    return false;
  }
  const roles = ["single-script", "tool-set-owner", "tool-set-child", "panel-owner"];
  if (value.id !== key) addIssue(issues, `${path}.id`, "Button ID must match its map key.");
  if (!roles.includes(String(value.role))) addIssue(issues, `${path}.role`, "Button role is invalid.");
  if (typeof value.label !== "string" || typeof value.tooltip !== "string") {
    addIssue(issues, path, "Button label and tooltip must be strings.");
  }
  if (typeof value.defaultSkinId !== "string" || typeof value.disabled !== "boolean") {
    addIssue(issues, path, "Button skin and disabled state are invalid.");
  }
  if (!Object.hasOwn(value, "activationAnimation") || value.activationAnimation === undefined) {
    addIssue(issues, `${path}.activationAnimation`, "Button activation animation must be present and may be null.");
  } else if (value.activationAnimation !== null) {
    const animationPath = `${path}.activationAnimation`;
    if (!isObject(value.activationAnimation)) {
      addIssue(issues, animationPath, "Button activation animation must be an object or null.");
    } else {
      if (!isButtonActivationAnimationPresetId(value.activationAnimation.presetId)) {
        addIssue(issues, `${animationPath}.presetId`, "Button activation animation preset is invalid.");
      }
      if (!isUsableDesktopBounds(value.activationAnimation.desktopBounds)) {
        addIssue(
          issues,
          `${animationPath}.desktopBounds`,
          "Button activation animation requires finite positive physical desktop bounds."
        );
      }
    }
  }
  if (!BUTTON_TEXT_FIT_MODES.has(String(value.defaultTextFitMode))) {
    addIssue(issues, `${path}.defaultTextFitMode`, "Default text-fit mode is invalid.");
  }
  if (!isObject(value.metadata)) addIssue(issues, `${path}.metadata`, "Button metadata must be an object.");
  if (value.sourceIdentity !== null) validateIdentity(value.sourceIdentity, `${path}.sourceIdentity`, issues);
  if (value.executionTarget !== null) validateExecutionTarget(value.executionTarget, `${path}.executionTarget`, issues);
  if (value.role === "tool-set-child") {
    if (typeof value.toolSetParentId !== "string" || !value.toolSetParentId) {
      addIssue(issues, `${path}.toolSetParentId`, "Tool-set child Buttons require a parent ID.");
    }
    if (value.executionTarget === null) addIssue(issues, `${path}.executionTarget`, "Tool-set child Buttons require a target.");
  } else if (value.toolSetParentId !== null) {
    addIssue(issues, `${path}.toolSetParentId`, "Only tool-set child Buttons may have a parent ID.");
  }
  if ((value.role === "tool-set-owner" || value.role === "panel-owner") && value.executionTarget !== null) {
    addIssue(issues, `${path}.executionTarget`, "Owner Buttons must not execute directly.");
  }
  if (value.role !== "tool-set-child" && value.toolSetBehavior !== null) {
    addIssue(issues, `${path}.toolSetBehavior`, "Only tool-set child Buttons may have child behavior.");
  }
  return true;
}

function validateToolField(field: unknown, path: string, issues: ButtonStateValidationIssue[]): field is ButtonToolField {
  if (!isObject(field)) {
    addIssue(issues, path, "Tool field must be an object.");
    return false;
  }
  const kinds = ["text", "number", "select", "toggle", "path", "color", "display"];
  if (!kinds.includes(String(field.kind))) addIssue(issues, `${path}.kind`, "Tool field kind is invalid.");
  if (typeof field.id !== "string" || !field.id || typeof field.payloadKey !== "string") {
    addIssue(issues, path, "Tool fields require stable IDs and payload keys.");
  }
  if (![field.x, field.y, field.width, field.height].every(isFiniteNumber) || Number(field.width) <= 0 || Number(field.height) <= 0) {
    addIssue(issues, path, "Tool field geometry must be finite and positive.");
  }
  if (field.serviceTarget !== undefined) validateExecutionTarget(field.serviceTarget, `${path}.serviceTarget`, issues);
  if (field.hidden !== undefined && typeof field.hidden !== "boolean") addIssue(issues, `${path}.hidden`, "hidden must be boolean.");
  if (field.kind === "toggle" && typeof field.defaultValue !== "boolean") addIssue(issues, `${path}.defaultValue`, "Toggle defaults must be boolean.");
  if (field.kind === "number" && !isFiniteNumber(field.defaultValue)) addIssue(issues, `${path}.defaultValue`, "Number defaults must be finite.");
  if (["text", "path", "color"].includes(String(field.kind)) && typeof field.defaultValue !== "string") addIssue(issues, `${path}.defaultValue`, `${String(field.kind)} defaults must be strings.`);
  if (field.kind === "select") {
    if (!Array.isArray(field.options) || !field.options.some((option) => isObject(option) && Object.is(option.value, field.defaultValue))) {
      addIssue(issues, `${path}.defaultValue`, "Select defaults must match one stable option value.");
    }
  }
  return true;
}

function collectPayloadFieldReferences(value: unknown, references: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectPayloadFieldReferences(item, references));
    return;
  }
  if (!isObject(value)) return;
  if (Object.keys(value).length === 1 && typeof value.$field === "string") {
    references.add(value.$field);
    return;
  }
  Object.values(value).forEach((item) => collectPayloadFieldReferences(item, references));
}

function validateTopLevel(value: unknown, issues: ButtonStateValidationIssue[]): value is ButtonStateDocument {
  if (!isObject(value)) {
    addIssue(issues, "$", "Button state must be a JSON object.", "fatal");
    return false;
  }
  if (value.schemaVersion !== BUTTON_STATE_SCHEMA_VERSION) {
    addIssue(issues, "schemaVersion", `Unsupported Button schema version '${String(value.schemaVersion)}'.`, "fatal");
  }
  if (!Number.isInteger(value.revision) || Number(value.revision) < 0) {
    addIssue(issues, "revision", "Revision must be a nonnegative integer.", "fatal");
  }
  for (const key of ["buttons", "placements", "surfaces", "skins", "popoutUnits", "fanSetups", "settings"]) {
    if (!isObject(value[key])) addIssue(issues, key, `${key} must be an object.`, "fatal");
  }
  return !issues.some((issue) => issue.severity === "fatal");
}

/**
 * Backfills defaults introduced while schema version 1 documents were already
 * in use. Missing fields are normalized, while malformed explicit
 * values remain untouched so strict validation still reports them.
 */
export function normalizeLoadedButtonStateDocument(value: unknown): unknown {
  if (!isObject(value) || !isObject(value.placements)) return value;
  let changed = false;
  const buttons: Record<string, unknown> = isObject(value.buttons)
    ? { ...value.buttons }
    : {};
  for (const [id, candidate] of Object.entries(buttons)) {
    if (!isObject(candidate)) continue;
    const button: Record<string, unknown> = { ...candidate };
    if (!Object.hasOwn(button, "activationAnimation")) {
      button.activationAnimation = null;
      changed = true;
    }
    buttons[id] = button;
  }
  const placements: Record<string, unknown> = { ...value.placements };
  for (const [id, candidate] of Object.entries(placements)) {
    if (!isObject(candidate)) continue;
    const placement: Record<string, unknown> = { ...candidate };
    if (!Object.hasOwn(placement, "matchHitboxToSkin")) {
      placement.matchHitboxToSkin = true;
      changed = true;
    }
    if (!Object.hasOwn(placement, "allowStretching")) {
      placement.allowStretching = false;
      changed = true;
    }
    if (!Object.hasOwn(placement, "textSizeOverride")) {
      placement.textSizeOverride = null;
      changed = true;
    }
    if (!Object.hasOwn(placement, "textAlignment")) {
      placement.textAlignment = "skin";
      changed = true;
    }
    placements[id] = placement;
  }
  const surfaces: Record<string, unknown> = isObject(value.surfaces)
    ? { ...value.surfaces }
    : {};
  for (const [id, candidate] of Object.entries(surfaces)) {
    if (!isObject(candidate)) continue;
    const surface: Record<string, unknown> = { ...candidate };
    if (!Object.hasOwn(surface, "uniformButtonSize")) {
      surface.uniformButtonSize = null;
      changed = true;
    }
    surfaces[id] = surface;
  }
  const popoutUnits = isObject(value.popoutUnits) ? { ...value.popoutUnits } : value.popoutUnits;
  if (isObject(popoutUnits)) {
    for (const [id, candidate] of Object.entries(popoutUnits)) {
      if (!isObject(candidate)) continue;
      const unit = { ...candidate };
      if (!Object.hasOwn(unit, "windowFitMode")) {
        unit.windowFitMode = "surface";
        changed = true;
      }
      if (!Object.hasOwn(unit, "desktopBoundsFitMode")) {
        unit.desktopBoundsFitMode = "surface";
        changed = true;
      }
      if (!Object.hasOwn(unit, "desktopBoundsEnvelope") && isUsableButtonRect(unit.canonicalBounds)) {
        unit.desktopBoundsEnvelope = { ...unit.canonicalBounds };
        changed = true;
      }
      popoutUnits[id] = unit;
    }
  }
  const fanSetups = isObject(value.fanSetups) ? { ...value.fanSetups } : value.fanSetups;
  if (isObject(fanSetups)) {
    for (const [id, candidate] of Object.entries(fanSetups)) {
      if (!isObject(candidate)) continue;
      const setup = { ...candidate };
      if (!Object.hasOwn(setup, "windowFitMode")) {
        setup.windowFitMode = "surface";
        changed = true;
      }
      if (!Object.hasOwn(setup, "collapsedBoundsFitMode")) {
        setup.collapsedBoundsFitMode = "surface";
        changed = true;
      }
      fanSetups[id] = setup;
    }
  }
  return changed ? { ...value, buttons, placements, surfaces, popoutUnits, fanSetups } : value;
}

export function validateButtonStateDocument(value: unknown): ButtonStateValidationResult {
  const issues: ButtonStateValidationIssue[] = [];
  if (!validateTopLevel(value, issues)) {
    return { valid: false, structurallyValid: false, issues };
  }
  const document = value as unknown as ButtonStateDocument;

  const settings = document.settings;
  for (const [key, minimum] of [
    ["gridSize", 1],
    ["snapTolerance", 0],
    ["defaultGap", 0],
    ["defaultSurfacePadding", 0],
    ["defaultMinimumFontSize", 1]
  ] as const) {
    if (!isFiniteNumber(settings[key]) || settings[key] < minimum) {
      addIssue(issues, `settings.${key}`, `${key} is outside its valid range.`);
    }
  }
  if (typeof settings.defaultSkinId !== "string" || typeof settings.allowSurfaceAutoExpansion !== "boolean") {
    addIssue(issues, "settings", "Default skin and surface-expansion settings are invalid.");
  }

  for (const [key, button] of Object.entries(document.buttons)) validateButtonRecord(button, key, issues);
  for (const [key, skin] of Object.entries(document.skins)) {
    const path = `skins.${key}`;
    if (!isObject(skin) || skin.id !== key || typeof skin.name !== "string") {
      addIssue(issues, path, "Skin ID/name is invalid.");
      continue;
    }
    const sectionsAreStrings = BUTTON_SKIN_SECTION_ORDER.every((section) => typeof skin[section] === "string");
    if (!sectionsAreStrings) {
      addIssue(issues, path, "Every skin source section must be a string.");
    }
    if (!isObject(skin.metadata)) addIssue(issues, `${path}.metadata`, "Skin metadata must be an object.");
    if (skin.compileCache !== null) {
      if (
        !isObject(skin.compileCache) ||
        skin.compileCache.compilerVersion !== BUTTON_SKIN_COMPILER_VERSION ||
        typeof skin.compileCache.sourceFingerprint !== "string"
      ) {
        addIssue(issues, `${path}.compileCache`, "Skin compile cache is invalid.");
      }
    }
    if (!sectionsAreStrings) continue;
    const validation = validateButtonSkin(skin as unknown as Parameters<typeof validateButtonSkin>[0]);
    validation.diagnostics.forEach((diagnostic) => addIssue(issues, `${path}.${diagnostic.section}`, diagnostic.message));
  }
  if (!document.skins[settings.defaultSkinId]) addIssue(issues, "settings.defaultSkinId", "Default skin does not exist.");

  for (const [key, surface] of Object.entries(document.surfaces)) {
    const path = `surfaces.${key}`;
    if (!isObject(surface)) {
      addIssue(issues, path, "Surface must be an object.");
      continue;
    }
    if (surface.id !== key || !isFiniteNumber(surface.width) || !isFiniteNumber(surface.height) || surface.width <= 0 || surface.height <= 0) {
      addIssue(issues, path, "Surface ID and dimensions are invalid.");
    }
    if (typeof surface.name !== "string" || !surface.name.trim()) addIssue(issues, `${path}.name`, "Surface name must be a nonempty string.");
    if (!BUTTON_SURFACE_KINDS.has(String(surface.kind))) addIssue(issues, `${path}.kind`, "Surface kind is invalid.");
    if (!Array.isArray(surface.placementIds) || !surface.placementIds.every((id) => typeof id === "string")) {
      addIssue(issues, `${path}.placementIds`, "Surface placement IDs must be an array of strings.");
    }
    if (!isFiniteNumber(surface.visualOverflowAllowance) || surface.visualOverflowAllowance < 0) {
      addIssue(issues, `${path}.visualOverflowAllowance`, "Surface visual-overflow allowance must be finite and nonnegative.");
    }
    const uniformButtonSize = surface.uniformButtonSize;
    if (
      uniformButtonSize !== undefined &&
      uniformButtonSize !== null &&
      (
        !isObject(uniformButtonSize) ||
        !isFiniteNumber(uniformButtonSize.width) ||
        !isFiniteNumber(uniformButtonSize.height) ||
        uniformButtonSize.width <= 0 ||
        uniformButtonSize.height <= 0 ||
        uniformButtonSize.width > surface.width ||
        uniformButtonSize.height > surface.height
      )
    ) {
      addIssue(issues, `${path}.uniformButtonSize`, "Uniform Button size must be null or contain positive finite dimensions that fit the surface.");
    }
  }
  for (const [key, placement] of Object.entries(document.placements)) {
    const path = `placements.${key}`;
    if (!isObject(placement)) {
      addIssue(issues, path, "Placement must be an object.");
      continue;
    }
    if (placement.id !== key) addIssue(issues, `${path}.id`, "Placement ID must match its map key.");
    if (![placement.x, placement.y, placement.width, placement.height, placement.zIndex].every(isFiniteNumber) || placement.width <= 0 || placement.height <= 0) {
      addIssue(issues, path, "Placement geometry must be finite and positive.");
    }
    if (!document.buttons[placement.buttonId]) addIssue(issues, `${path}.buttonId`, "Placement references a missing Button.");
    const surface = document.surfaces[placement.surfaceId];
    if (!isObject(surface)) addIssue(issues, `${path}.surfaceId`, "Placement references a missing surface.");
    else if (Array.isArray(surface.placementIds) && !surface.placementIds.includes(key)) {
      addIssue(issues, path, "Placement is missing from its surface's placement list.");
    }
    const skinId = placement.skinOverrideId ?? document.buttons[placement.buttonId]?.defaultSkinId;
    if (skinId && !document.skins[skinId]) addIssue(issues, `${path}.skinOverrideId`, "Placement references a missing skin.");
    if (placement.skinOverrideId !== null && typeof placement.skinOverrideId !== "string") {
      addIssue(issues, `${path}.skinOverrideId`, "Skin override must be a skin ID or null.");
    }
    if (!BUTTON_TEXT_FIT_MODES.has(String(placement.textFitMode))) {
      addIssue(issues, `${path}.textFitMode`, "Placement text-fit mode is invalid.");
    }
    if (!BUTTON_TEXT_ALIGNMENTS.has(String(placement.textAlignment))) {
      addIssue(issues, `${path}.textAlignment`, "Placement text alignment is invalid.");
    }
    if (!isFiniteNumber(placement.minimumFontSize) || placement.minimumFontSize <= 0) {
      addIssue(issues, `${path}.minimumFontSize`, "Minimum font size must be finite and positive.");
    }
    if (
      placement.textSizeOverride !== null &&
      (!isFiniteNumber(placement.textSizeOverride) || placement.textSizeOverride <= 0)
    ) {
      addIssue(issues, `${path}.textSizeOverride`, "Font size override must be null or finite and positive.");
    }
    if (typeof placement.allowLabelResize !== "boolean") {
      addIssue(issues, `${path}.allowLabelResize`, "Label-resize permission must be boolean.");
    }
    if (typeof placement.matchHitboxToSkin !== "boolean") {
      addIssue(issues, `${path}.matchHitboxToSkin`, "Hitbox-to-skin matching must be boolean.");
    }
    if (typeof placement.allowStretching !== "boolean") {
      addIssue(issues, `${path}.allowStretching`, "Stretching permission must be boolean.");
    }
    if (placement.resizeAnchor !== "top-left") {
      addIssue(issues, `${path}.resizeAnchor`, "Placement resize anchor is invalid.");
    }
  }

  for (const [surfaceId, surface] of Object.entries(document.surfaces)) {
    if (!isObject(surface) || !Array.isArray(surface.placementIds)) continue;
    const placements = surface.placementIds
      .map((id) => typeof id === "string" ? document.placements[id] : undefined)
      .filter((placement): placement is NonNullable<typeof placement> => isObject(placement));
    const seen = new Set<string>();
    for (const placement of placements) {
      if (seen.has(placement.id)) addIssue(issues, `surfaces.${surfaceId}.placementIds`, `Duplicate placement '${placement.id}'.`);
      seen.add(placement.id);
      if (placement.surfaceId !== surfaceId) addIssue(issues, `placements.${placement.id}.surfaceId`, "Placement belongs to a different surface.");
      if (placement.x < 0 || placement.y < 0 || placement.x + placement.width > surface.width || placement.y + placement.height > surface.height) {
        addIssue(issues, `placements.${placement.id}`, "Placement is outside its exact surface bounds.");
      }
    }
    const uniformButtonSize = surface.uniformButtonSize;
    if (
      isObject(uniformButtonSize) &&
      isFiniteNumber(uniformButtonSize.width) &&
      isFiniteNumber(uniformButtonSize.height) &&
      placements.some((placement) =>
        Math.abs(placement.width - uniformButtonSize.width) > 0.05 ||
        Math.abs(placement.height - uniformButtonSize.height) > 0.05 ||
        placement.matchHitboxToSkin !== false ||
        placement.allowLabelResize !== false
      )
    ) {
      addIssue(
        issues,
        `surfaces.${surfaceId}.uniformButtonSize`,
        "Every placement on a uniformly sized surface must use its fixed dimensions."
      );
    }
    for (let left = 0; left < placements.length; left += 1) {
      for (let right = left + 1; right < placements.length; right += 1) {
        const leftPlacement = placements[left];
        const rightPlacement = placements[right];
        if (leftPlacement && rightPlacement && buttonRectsOverlap(leftPlacement, rightPlacement)) {
          addIssue(issues, `surfaces.${surfaceId}`, `Placements '${leftPlacement.id}' and '${rightPlacement.id}' overlap.`);
        }
      }
    }
  }

  for (const [key, rawUnit] of Object.entries(document.popoutUnits)) {
    const path = `popoutUnits.${key}`;
    if (!isObject(rawUnit)) {
      addIssue(issues, path, "Popout unit must be an object.");
      continue;
    }
    if (rawUnit.kind !== "regular" && rawUnit.kind !== "tool-set") {
      addIssue(issues, `${path}.kind`, "Popout kind is invalid.");
      continue;
    }
    const unit = rawUnit as unknown as ButtonPopoutUnit;
    const commonKeys = [
      "id", "name", "kind", "surfaceId", "canonicalBounds", "desktopBounds",
      "openRule", "closeRule", "transparency", "pinnedDefault", "windowFitMode",
      "desktopBoundsFitMode", "desktopBoundsEnvelope"
    ];
    const allowedKeys = new Set(unit.kind === "regular"
      ? [...commonKeys, "memberPlacementIds", "memberSourceIdentities", "selectionKey"]
      : [...commonKeys, "ownerButtonId", "childButtonIds", "childPlacementIds", "fields"]);
    Object.keys(rawUnit).forEach((property) => {
      if (!allowedKeys.has(property)) addIssue(issues, `${path}.${property}`, `Property '${property}' is not part of the ${unit.kind} popout contract.`);
    });
    if (unit.id !== key || !document.surfaces[unit.surfaceId]) addIssue(issues, path, "Popout ID or surface reference is invalid.");
    if (!BUTTON_WINDOW_FIT_MODES.has(unit.windowFitMode ?? "surface")) {
      addIssue(issues, `${path}.windowFitMode`, "Popout window-fit mode is invalid.");
    }
    if (!BUTTON_WINDOW_FIT_MODES.has(unit.desktopBoundsFitMode ?? "surface")) {
      addIssue(issues, `${path}.desktopBoundsFitMode`, "Popout desktop-bounds fit mode is invalid.");
    }
    if (unit.desktopBounds !== null && !isUsableDesktopBounds(unit.desktopBounds)) {
      addIssue(issues, `${path}.desktopBounds`, "Popout desktop bounds must be null or finite with positive dimensions.");
    }
    if (unit.desktopBoundsEnvelope && !isUsableButtonRect(unit.desktopBoundsEnvelope)) {
      addIssue(issues, `${path}.desktopBoundsEnvelope`, "Popout desktop-bounds envelope is invalid.");
    }
    if (unit.kind === "regular") {
      const placementIds = Array.isArray(unit.memberPlacementIds) ? unit.memberPlacementIds : [];
      const identities = Array.isArray(unit.memberSourceIdentities) ? unit.memberSourceIdentities : [];
      if (!Array.isArray(unit.memberPlacementIds)) addIssue(issues, `${path}.memberPlacementIds`, "Regular member placement IDs must be an array.");
      if (!Array.isArray(unit.memberSourceIdentities)) addIssue(issues, `${path}.memberSourceIdentities`, "Regular member source identities must be an array.");
      if (hasDuplicateStrings(placementIds)) addIssue(issues, `${path}.memberPlacementIds`, "Regular member placement IDs must be unique.");
      const surface = document.surfaces[unit.surfaceId];
      if (surface?.kind !== "regular-popout") addIssue(issues, `${path}.surfaceId`, "Regular popout must reference a regular-popout surface.");
      if (surface && !haveSameStringMembers(placementIds, surface.placementIds)) {
        addIssue(issues, `${path}.memberPlacementIds`, "Regular member placement IDs must exactly match the popout surface.");
      }
      const validIdentities = identities.filter((identity, index): identity is ButtonSourceIdentity =>
        validateIdentity(identity, `${path}.memberSourceIdentities.${index}`, issues)
      );
      const placedIdentities: ButtonSourceIdentity[] = [];
      placementIds.forEach((placementId) => {
        const placement = document.placements[placementId];
        const button = placement ? document.buttons[placement.buttonId] : undefined;
        if (!placement || placement.surfaceId !== unit.surfaceId || !button || button.role !== "single-script" || !button.sourceIdentity) {
          addIssue(issues, `${path}.memberPlacementIds`, `Invalid regular member placement '${placementId}'.`);
          return;
        }
        placedIdentities.push(button.sourceIdentity);
      });
      if (typeof unit.selectionKey !== "string" || !unit.selectionKey.trim()) {
        addIssue(issues, `${path}.selectionKey`, "Regular selection key must be nonempty.");
      } else {
        if (validIdentities.length === identities.length && unit.selectionKey !== deriveRegularPopoutSelectionKey(validIdentities)) {
          addIssue(issues, `${path}.selectionKey`, "Regular selection key does not match its member source identities.");
        }
        if (placedIdentities.length === placementIds.length && unit.selectionKey !== deriveRegularPopoutSelectionKey(placedIdentities)) {
          addIssue(issues, `${path}.memberSourceIdentities`, "Regular member source identities do not match its member placements.");
        }
      }
    } else {
      const fields = Array.isArray(unit.fields) ? unit.fields : [];
      if (!Array.isArray(unit.fields)) addIssue(issues, `${path}.fields`, "Tool-set fields must be an array.");
      const fieldIds = new Set<string>();
      fields.forEach((field, index) => {
        if (!validateToolField(field, `${path}.fields.${index}`, issues)) return;
        if (fieldIds.has(field.id)) addIssue(issues, `${path}.fields.${index}.id`, "Tool field IDs must be unique in a popout.");
        fieldIds.add(field.id);
      });
      const owner = typeof unit.ownerButtonId === "string" ? document.buttons[unit.ownerButtonId] : undefined;
      if (!owner || owner.role !== "tool-set-owner") addIssue(issues, `${path}.ownerButtonId`, "Tool-set popout requires a tool-set owner.");
      const childButtonIds = Array.isArray(unit.childButtonIds) ? unit.childButtonIds : [];
      const childPlacementIds = Array.isArray(unit.childPlacementIds) ? unit.childPlacementIds : [];
      if (!Array.isArray(unit.childButtonIds)) addIssue(issues, `${path}.childButtonIds`, "Tool-set child Button IDs must be an array.");
      if (!Array.isArray(unit.childPlacementIds)) addIssue(issues, `${path}.childPlacementIds`, "Tool-set child placement IDs must be an array.");
      if (hasDuplicateStrings(childButtonIds)) addIssue(issues, `${path}.childButtonIds`, "Tool-set child Button IDs must be unique.");
      if (hasDuplicateStrings(childPlacementIds)) addIssue(issues, `${path}.childPlacementIds`, "Tool-set child placement IDs must be unique.");
      const surface = document.surfaces[unit.surfaceId];
      if (surface?.kind !== "tool-set-popout") addIssue(issues, `${path}.surfaceId`, "Tool-set popout must reference a tool-set-popout surface.");
      if (surface && !haveSameStringMembers(childPlacementIds, surface.placementIds)) {
        addIssue(issues, `${path}.childPlacementIds`, "Tool-set child placement IDs must exactly match the popout surface.");
      }
      const placedChildButtonIds: string[] = [];
      childPlacementIds.forEach((placementId) => {
        const placement = document.placements[placementId];
        if (!placement || placement.surfaceId !== unit.surfaceId) {
          addIssue(issues, `${path}.childPlacementIds`, `Invalid tool-set child placement '${placementId}'.`);
          return;
        }
        placedChildButtonIds.push(placement.buttonId);
      });
      if (!haveSameStringMembers(childButtonIds, placedChildButtonIds)) {
        addIssue(issues, `${path}.childButtonIds`, "Tool-set child Button IDs must exactly match its child placements.");
      }
      for (const childId of childButtonIds) {
        const child = document.buttons[childId];
        if (!child || child.role !== "tool-set-child" || child.toolSetParentId !== owner?.id) {
          addIssue(issues, `${path}.childButtonIds`, `Invalid tool-set child '${childId}'.`);
        }
        const behavior = child?.toolSetBehavior;
        for (const fieldId of behavior?.toggleFields ?? []) {
          const field = fields.find((candidate) => candidate.id === fieldId);
          if (!field || field.kind !== "toggle") addIssue(issues, `buttons.${childId}.toolSetBehavior.toggleFields`, `Toggle field '${fieldId}' is missing or not boolean.`);
        }
        for (const fieldId of Object.keys(behavior?.fieldPatch ?? {})) {
          if (!fieldIds.has(fieldId)) addIssue(issues, `buttons.${childId}.toolSetBehavior.fieldPatch`, `Patched field '${fieldId}' does not exist.`);
        }
        for (const fieldId of Object.keys(behavior?.activationPatch ?? {})) {
          if (!fieldIds.has(fieldId)) addIssue(issues, `buttons.${childId}.toolSetBehavior.activationPatch`, `Activation-patched field '${fieldId}' does not exist.`);
        }
        if (behavior?.activateField) {
          const field = fields.find((candidate) => candidate.id === behavior.activateField);
          if (!field || field.kind !== "path") {
            addIssue(
              issues,
              `buttons.${childId}.toolSetBehavior.activateField`,
              `Activated field '${behavior.activateField}' is missing or is not a path field.`
            );
          }
        }
        if (behavior?.inlineEditField) {
          const field = fields.find((candidate) => candidate.id === behavior.inlineEditField);
          if (!field || (field.kind !== "number" && field.kind !== "text")) {
            addIssue(
              issues,
              `buttons.${childId}.toolSetBehavior.inlineEditField`,
              `Inline-edited field '${behavior.inlineEditField}' is missing or is not a number/text field.`
            );
          }
          if (field?.serviceTarget) {
            addIssue(
              issues,
              `buttons.${childId}.toolSetBehavior.inlineEditField`,
              "Inline-edited fields cannot dispatch a field service."
            );
          }
          if (behavior.execute !== false) {
            addIssue(
              issues,
              `buttons.${childId}.toolSetBehavior.execute`,
              "Inline-edit Buttons must be state-only controls."
            );
          }
        }
        const references = new Set<string>();
        collectPayloadFieldReferences(behavior?.payloadTemplate, references);
        for (const fieldId of references) {
          if (!fieldIds.has(fieldId)) addIssue(issues, `buttons.${childId}.toolSetBehavior.payloadTemplate`, `Payload field '${fieldId}' does not exist.`);
        }
      }
    }
  }

  const fanNames = new Map<string, string>();
  for (const [key, rawSetup] of Object.entries(document.fanSetups)) {
    const path = `fanSetups.${key}`;
    if (!isObject(rawSetup)) {
      addIssue(issues, path, "Fan setup must be an object.");
      continue;
    }
    const setup = rawSetup as unknown as ButtonStateDocument["fanSetups"][string];
    if (setup.id !== key || !document.surfaces[setup.fanSurfaceId]) addIssue(issues, path, "Fan setup ID or surface is invalid.");
    if (!BUTTON_WINDOW_FIT_MODES.has(setup.windowFitMode ?? "surface")) {
      addIssue(issues, `${path}.windowFitMode`, "Fan window-fit mode is invalid.");
    }
    if (!BUTTON_WINDOW_FIT_MODES.has(setup.collapsedBoundsFitMode ?? "surface")) {
      addIssue(issues, `${path}.collapsedBoundsFitMode`, "Fan collapsed-bounds fit mode is invalid.");
    }
    if (setup.collapsedBoundsEnvelope && !isUsableButtonRect(setup.collapsedBoundsEnvelope)) {
      addIssue(issues, `${path}.collapsedBoundsEnvelope`, "Fan collapsed-bounds envelope is invalid.");
    }
    const normalizedName = typeof setup.name === "string" ? setup.name.trim().toLocaleLowerCase("en") : "";
    const normalizedProgram = typeof setup.programName === "string" ? setup.programName.trim().toLocaleLowerCase("en") : "";
    const normalizedPanel = typeof setup.panelName === "string" ? setup.panelName.trim().toLocaleLowerCase("en") : "";
    if (!normalizedName || !normalizedProgram || !normalizedPanel) {
      addIssue(issues, path, "Fan name, program, and panel must be nonempty.");
    } else {
      const nameKey = `${normalizedProgram}\u0000${normalizedPanel}\u0000${normalizedName}`;
      const existing = fanNames.get(nameKey);
      if (existing) addIssue(issues, `${path}.name`, `Fan setup name duplicates '${existing}' for the same program and panel.`);
      else fanNames.set(nameKey, key);
    }
    const panelOwner = document.buttons[setup.panelOwnerButtonId];
    if (panelOwner?.role !== "panel-owner") {
      addIssue(issues, `${path}.panelOwnerButtonId`, "Fan setup requires a panel owner.");
    } else {
      const ownerProgram = typeof panelOwner.metadata.programName === "string"
        ? panelOwner.metadata.programName.trim().toLocaleLowerCase("en")
        : "";
      const ownerPanel = typeof panelOwner.metadata.panelName === "string"
        ? panelOwner.metadata.panelName.trim().toLocaleLowerCase("en")
        : "";
      if (ownerProgram !== normalizedProgram || ownerPanel !== normalizedPanel) {
        addIssue(
          issues,
          `${path}.panelOwnerButtonId`,
          "Fan setup program and panel must match its panel owner."
        );
      }
    }
    const memberButtonIds = Array.isArray(setup.fanMemberButtonIds) ? setup.fanMemberButtonIds : [];
    const selectedOwnerIds = Array.isArray(setup.selectedToolSetOwnerButtonIds) ? setup.selectedToolSetOwnerButtonIds : [];
    const memberPlacementIds = Array.isArray(setup.fanMemberPlacementIds) ? setup.fanMemberPlacementIds : [];
    if (!Array.isArray(setup.fanMemberButtonIds)) addIssue(issues, `${path}.fanMemberButtonIds`, "Fan member Button IDs must be an array.");
    if (!Array.isArray(setup.selectedToolSetOwnerButtonIds)) addIssue(issues, `${path}.selectedToolSetOwnerButtonIds`, "Selected tool-set owner IDs must be an array.");
    if (!Array.isArray(setup.fanMemberPlacementIds)) addIssue(issues, `${path}.fanMemberPlacementIds`, "Fan member placement IDs must be an array.");
    if (!isObject(setup.toolSetOwnerAnchors)) addIssue(issues, `${path}.toolSetOwnerAnchors`, "Tool-set owner anchors must be an object.");
    if (hasDuplicateStrings(memberButtonIds)) addIssue(issues, `${path}.fanMemberButtonIds`, "Fan member Button IDs must be unique.");
    if (hasDuplicateStrings(selectedOwnerIds)) addIssue(issues, `${path}.selectedToolSetOwnerButtonIds`, "Selected tool-set owner IDs must be unique.");
    if (hasDuplicateStrings(memberPlacementIds)) addIssue(issues, `${path}.fanMemberPlacementIds`, "Fan member placement IDs must be unique.");
    memberButtonIds.forEach((id) => {
      if (document.buttons[id]?.role !== "single-script") addIssue(issues, `${path}.fanMemberButtonIds`, `Fan member '${id}' is not a single-script Button.`);
    });
    const fanSurface = document.surfaces[setup.fanSurfaceId];
    if (fanSurface && fanSurface.kind !== "fan") {
      addIssue(issues, `${path}.fanSurfaceId`, "Fan setup surface must be a fan surface.");
    }
    const panelOwnerPlacementIds = (fanSurface?.placementIds ?? []).filter((placementId) => {
      const placement = document.placements[placementId];
      return placement?.surfaceId === setup.fanSurfaceId && placement.buttonId === setup.panelOwnerButtonId;
    });
    if (panelOwnerPlacementIds.length !== 1) {
      addIssue(
        issues,
        `${path}.panelOwnerButtonId`,
        "Fan surface must contain exactly one placement for its panel owner."
      );
    }
    const surfaceMemberPlacementIds = (fanSurface?.placementIds ?? []).filter((placementId) => {
      const placement = document.placements[placementId];
      return placement?.surfaceId === setup.fanSurfaceId && document.buttons[placement.buttonId]?.role === "single-script";
    });
    if (!haveSameStringMembers(memberPlacementIds, surfaceMemberPlacementIds)) {
      addIssue(issues, `${path}.fanMemberPlacementIds`, "Fan member placement IDs must exactly match single-script placements on the fan surface.");
    }
    const placedMemberButtonIds = memberPlacementIds
      .map((placementId) => document.placements[placementId])
      .filter((placement) => placement?.surfaceId === setup.fanSurfaceId)
      .map((placement) => placement.buttonId);
    if (!haveSameStringMembers(memberButtonIds, placedMemberButtonIds)) {
      addIssue(issues, `${path}.fanMemberButtonIds`, "Fan member Button IDs must exactly match its member placements.");
    }
    selectedOwnerIds.forEach((id) => {
      if (document.buttons[id]?.role !== "tool-set-owner") addIssue(issues, `${path}.selectedToolSetOwnerButtonIds`, `Selected owner '${id}' is not a tool-set owner.`);
      if (!isUsableDesktopBounds(setup.toolSetOwnerAnchors?.[id])) addIssue(issues, `${path}.toolSetOwnerAnchors.${id}`, "Selected tool-set owner requires finite saved bounds with positive dimensions.");
    });
    if (
      setup.collapsedPanelOwnerBounds !== undefined &&
      !isUsableDesktopBounds(setup.collapsedPanelOwnerBounds)
    ) {
      addIssue(issues, `${path}.collapsedPanelOwnerBounds`, "Collapsed panel-owner bounds must be finite with positive dimensions when present.");
    }
  }

  return {
    valid: issues.length === 0,
    structurallyValid: true,
    document,
    issues
  };
}

export function parseButtonStateDocumentJson(source: string): ButtonStateValidationResult {
  try {
    return validateButtonStateDocument(normalizeLoadedButtonStateDocument(JSON.parse(source)));
  } catch (error) {
    return {
      valid: false,
      structurallyValid: false,
      issues: [{
        path: "$",
        message: error instanceof Error ? error.message : String(error),
        severity: "fatal"
      }]
    };
  }
}
