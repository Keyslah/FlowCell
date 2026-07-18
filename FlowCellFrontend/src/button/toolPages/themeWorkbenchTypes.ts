import type {
  ButtonRecord,
  ButtonCoreMeasurement,
  ButtonStateDocument,
  ButtonToolField,
  ButtonVisualMeasurement,
  ButtonVisualState,
  JsonObject,
  JsonValue,
  ToolSetButtonPopoutUnit
} from "../types.js";
import type { ButtonExecutionResult } from "../runtime/ButtonRuntimeAdapter.js";

export type ThemeWorkbenchToneMode = "dark" | "light";

export interface ThemeWorkbenchToneTarget {
  dark: number;
  light: number;
}

export interface ThemeWorkbenchColorRoleConfig {
  id: string;
  label: string;
  fieldId: string;
  group?: string;
  placeholder?: string;
  mirrorFieldIds?: string[];
  tone?: ThemeWorkbenchToneTarget | "text";
  apply?: {
    actionSlot: string;
    label?: string;
    payload?: JsonObject;
    valuePayloadKey?: string;
  };
}

export interface ThemeWorkbenchGradientConfig {
  label?: string;
  enabledFieldId: string;
  backgroundFieldId: string;
  gradientFieldId: string;
}

export interface ThemeWorkbenchBrowseCompletionConfig {
  toneMode?: ThemeWorkbenchToneMode;
  postActionSlot?: string;
}

export interface ThemeWorkbenchRefillConfig {
  label?: string;
  applyActionSlot: string;
}

export interface ThemeWorkbenchThemeConfig {
  title?: string;
  imagePathFieldId: string;
  imagePathLabel?: string;
  imagePathPlaceholder?: string;
  paletteFieldId?: string;
  visualModeFieldId: string;
  roles: ThemeWorkbenchColorRoleConfig[];
  roleGroupLabels?: Record<string, string>;
  gradient?: ThemeWorkbenchGradientConfig;
  browseCompletion?: ThemeWorkbenchBrowseCompletionConfig;
  refill?: ThemeWorkbenchRefillConfig;
  packageCompletion?: {
    postActions: Array<{
      actionSlot: string;
      whenFieldNonEmpty?: string;
    }>;
  };
}

export interface ThemeWorkbenchNumberFieldConfig {
  fieldId: string;
  label: string;
  step?: number;
  minimum?: number;
  maximum?: number;
  actionSlot?: string;
}

export interface ThemeWorkbenchPictureConfig {
  title?: string;
  pathFieldId: string;
  pathLabel?: string;
  pathPlaceholder?: string;
  gridFields: ThemeWorkbenchNumberFieldConfig[];
}

export interface ThemeWorkbenchEnvironmentConfig {
  title?: string;
  pathFieldId: string;
  pathLabel?: string;
  pathPlaceholder?: string;
  valueFields: ThemeWorkbenchNumberFieldConfig[];
}

export interface ThemeWorkbenchThemeActionSlots {
  browseImage: string;
  absorb: string;
  refill?: string;
  saveFields: string;
  loadFields: string;
  savePackage?: string;
  openPackage?: string;
  previousPackage?: string;
  nextPackage?: string;
  darkMode: string;
  lightMode: string;
  apply: string;
}

export interface ThemeWorkbenchPictureActionSlots {
  apply: string;
  browse: string;
  startup?: string;
  clear: string;
  applyGrid?: string;
}

export interface ThemeWorkbenchEnvironmentActionSlots {
  apply: string;
  browse: string;
  clear: string;
  reset: string;
}

export interface ThemeWorkbenchToneConfig {
  defaultLevel?: number;
  showSlider?: boolean;
  sliderLabel?: string;
  storageKey?: string;
  profiles?: {
    enabled: boolean;
    selectLabel?: string;
    namePlaceholder?: string;
    saveLabel?: string;
  };
  legacyProfiles?: {
    migrationId: string;
    actionSlot: string;
    format: string;
    roleMap: Record<string, string>;
    mode?: ThemeWorkbenchToneMode;
    level?: number;
    localStorage?: {
      profilesKey?: string;
      activeProfileIdKey?: string;
      levelKey?: string;
    };
  };
}

export interface ThemeWorkbenchFieldPersistenceConfig {
  storageKey: string;
  legacy?: Array<{
    migrationId: string;
    storageKeys: string[];
    fieldMap: Record<string, string>;
    fieldTransforms?: Record<string, "parse-number">;
  }>;
}

/**
 * Presentation data supplied by a toolset manifest. All IDs are package data:
 * the renderer does not infer a program, command, field, or child slot name.
 */
export interface ThemeWorkbenchPresentationConfig {
  kind: "theme-workbench";
  title: string;
  subtitle?: string;
  theme: ThemeWorkbenchThemeConfig;
  picture: ThemeWorkbenchPictureConfig;
  environment: ThemeWorkbenchEnvironmentConfig;
  actions: {
    theme: ThemeWorkbenchThemeActionSlots;
    picture: ThemeWorkbenchPictureActionSlots;
    environment: ThemeWorkbenchEnvironmentActionSlots;
  };
  tone?: ThemeWorkbenchToneConfig;
  fieldPersistence?: ThemeWorkbenchFieldPersistenceConfig;
}

export interface ThemeWorkbenchProps {
  document: ButtonStateDocument;
  unit: ToolSetButtonPopoutUnit;
  presentation: ThemeWorkbenchPresentationConfig;
  fieldValues: Readonly<Record<string, JsonValue>>;
  onFieldPatch: (
    patch: Readonly<Record<string, JsonValue>>,
    nextValues: Readonly<Record<string, JsonValue>>
  ) => void;
  onFieldActivate?: (
    field: ButtonToolField,
    currentValue: JsonValue
  ) => Promise<JsonValue | undefined>;
  onExecutionResult?: (
    slot: string,
    button: ButtonRecord,
    result: ButtonExecutionResult
  ) => void;
  onPlacementMeasurement?: (placementId: string, measurement: ButtonCoreMeasurement) => void;
  onPlacementVisualMeasurement?: (placementId: string, measurement: ButtonVisualMeasurement) => void;
  onPreparePlacementVisualStateChange?: (
    placementId: string,
    state: ButtonVisualState
  ) => void | Promise<void>;
  onPlacementVisualStateChange?: (placementId: string, state: ButtonVisualState) => void;
  resolveImageSource?: (path: string) => string | null | undefined;
  className?: string;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalNonEmptyString(value: unknown): boolean {
  return value === undefined || nonEmptyString(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalFiniteNumber(value: unknown): boolean {
  return value === undefined || finiteNumber(value);
}

function isToneTarget(value: unknown): boolean {
  if (value === undefined || value === "text") return true;
  const target = objectValue(value);
  return Boolean(
    target &&
    finiteNumber(target.dark) && target.dark >= 0 && target.dark <= 1 &&
    finiteNumber(target.light) && target.light >= 0 && target.light <= 1
  );
}

function isColorRole(value: unknown): value is ThemeWorkbenchColorRoleConfig {
  const role = objectValue(value);
  if (!role || !nonEmptyString(role.id) || !nonEmptyString(role.label) ||
    !nonEmptyString(role.fieldId)) {
    return false;
  }
  if (!optionalString(role.group) || !optionalString(role.placeholder) || !isToneTarget(role.tone)) {
    return false;
  }
  if (role.apply !== undefined) {
    const apply = objectValue(role.apply);
    if (!apply || !nonEmptyString(apply.actionSlot) || !optionalString(apply.label) ||
      !optionalNonEmptyString(apply.valuePayloadKey) ||
      (apply.payload !== undefined && !isJsonValue(apply.payload))) {
      return false;
    }
  }
  return role.mirrorFieldIds === undefined || (
    Array.isArray(role.mirrorFieldIds) && role.mirrorFieldIds.every(nonEmptyString)
  );
}

function isNumberField(value: unknown): value is ThemeWorkbenchNumberFieldConfig {
  const field = objectValue(value);
  if (!field || !nonEmptyString(field.fieldId) || !nonEmptyString(field.label) ||
    !optionalFiniteNumber(field.step) || !optionalFiniteNumber(field.minimum) ||
    !optionalFiniteNumber(field.maximum) || !optionalNonEmptyString(field.actionSlot)) {
    return false;
  }
  if (finiteNumber(field.step) && field.step <= 0) return false;
  return !(finiteNumber(field.minimum) && finiteNumber(field.maximum) && field.minimum > field.maximum);
}

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function hasRequiredActionSlots(
  value: unknown,
  required: readonly string[],
  optional: readonly string[]
): boolean {
  const actions = objectValue(value);
  return Boolean(
    actions &&
    required.every((key) => nonEmptyString(actions[key])) &&
    optional.every((key) => optionalNonEmptyString(actions[key]))
  );
}

function isOptionalStringRecord(value: unknown): boolean {
  if (value === undefined) return true;
  const record = objectValue(value);
  return Boolean(record && Object.entries(record).every(([key, label]) =>
    nonEmptyString(key) && typeof label === "string"));
}

function isNonEmptyStringRecord(value: unknown): boolean {
  const record = objectValue(value);
  return Boolean(record && Object.entries(record).length > 0 &&
    Object.entries(record).every(([key, mapped]) => nonEmptyString(key) && nonEmptyString(mapped)));
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  const record = objectValue(value);
  return Boolean(record && Object.values(record).every(isJsonValue));
}

/** Restore only fields declared by the current toolset and only valid JSON data. */
export function normalizeThemeWorkbenchStoredFields(
  value: unknown,
  allowedFieldIds: readonly string[]
): Record<string, JsonValue> {
  const document = objectValue(value);
  const storedValues = document?.schemaVersion === 1
    ? objectValue(document.values)
    : null;
  if (!storedValues) return {};
  const allowed = new Set(allowedFieldIds);
  const result: Record<string, JsonValue> = {};
  for (const [fieldId, fieldValue] of Object.entries(storedValues)) {
    if (allowed.has(fieldId) && isJsonValue(fieldValue)) result[fieldId] = fieldValue;
  }
  return result;
}

export function normalizeThemeWorkbenchStoredFieldMigrations(value: unknown): string[] {
  const document = objectValue(value);
  return document?.schemaVersion === 1 && Array.isArray(document.completedMigrationIds)
    ? Array.from(new Set(document.completedMigrationIds.filter(nonEmptyString)))
    : [];
}

export function normalizeLegacyThemeWorkbenchStoredFields(
  value: unknown,
  allowedFieldIds: readonly string[],
  fieldMap: Readonly<Record<string, string>>,
  fieldTransforms: Readonly<Record<string, "parse-number">> = {}
): Record<string, JsonValue> {
  const document = objectValue(value);
  if (!document) return {};
  const allowed = new Set(allowedFieldIds);
  const result: Record<string, JsonValue> = {};
  for (const [storedFieldId, storedValue] of Object.entries(document)) {
    const fieldId = fieldMap[storedFieldId];
    if (!fieldId || !allowed.has(fieldId) || !isJsonValue(storedValue)) continue;
    if (fieldTransforms[storedFieldId] === "parse-number") {
      const parsed = typeof storedValue === "number"
        ? storedValue
        : typeof storedValue === "string"
          ? Number.parseFloat(storedValue.trim())
          : Number.NaN;
      if (Number.isFinite(parsed)) result[fieldId] = parsed;
      continue;
    }
    result[fieldId] = storedValue;
  }
  return result;
}

export function resolveThemeWorkbenchLegacyStorageKey(
  template: string,
  identity: { programName: string; panelName: string; fileName: string } | null
): string | null {
  if (!identity && /\{(?:program|panel|file)\}/.test(template)) return null;
  const values: Record<string, string> = {
    program: identity?.programName.trim().toLowerCase() ?? "",
    panel: identity?.panelName.trim().toLowerCase() ?? "",
    file: identity?.fileName.trim().toLowerCase() ?? ""
  };
  const resolved = template.replace(/\{(program|panel|file)\}/g, (_match, token: string) =>
    values[token] ?? "");
  return resolved.includes("{") || !resolved.trim() ? null : resolved;
}

/** Reject malformed package data before the renderer dereferences its mapping. */
export function isThemeWorkbenchPresentationConfig(
  value: unknown
): value is ThemeWorkbenchPresentationConfig {
  const config = objectValue(value);
  if (config?.kind !== "theme-workbench" || typeof config.title !== "string") return false;
  const theme = objectValue(config.theme);
  const picture = objectValue(config.picture);
  const environment = objectValue(config.environment);
  const actions = objectValue(config.actions);
  const themeActions = objectValue(actions?.theme);
  const pictureActions = objectValue(actions?.picture);
  const environmentActions = objectValue(actions?.environment);
  if (!theme || !picture || !environment || !actions ||
    !themeActions || !pictureActions || !environmentActions) {
    return false;
  }

  if (!optionalString(config.subtitle) ||
    !nonEmptyString(theme.imagePathFieldId) || !nonEmptyString(theme.visualModeFieldId) ||
    !optionalString(theme.title) || !optionalString(theme.imagePathLabel) ||
    !optionalString(theme.imagePathPlaceholder) || !optionalNonEmptyString(theme.paletteFieldId) ||
    !isOptionalStringRecord(theme.roleGroupLabels) ||
    !Array.isArray(theme.roles) || theme.roles.length === 0 || !theme.roles.every(isColorRole) ||
    !hasUniqueValues(theme.roles.map((role) => role.id))) {
    return false;
  }

  if (theme.gradient !== undefined) {
    const gradient = objectValue(theme.gradient);
    if (!gradient || !optionalString(gradient.label) ||
      !nonEmptyString(gradient.enabledFieldId) || !nonEmptyString(gradient.backgroundFieldId) ||
      !nonEmptyString(gradient.gradientFieldId)) {
      return false;
    }
  }

  if (theme.browseCompletion !== undefined) {
    const completion = objectValue(theme.browseCompletion);
    if (!completion ||
      (completion.toneMode !== undefined && completion.toneMode !== "dark" &&
        completion.toneMode !== "light") ||
      !optionalNonEmptyString(completion.postActionSlot) ||
      (completion.toneMode === undefined && completion.postActionSlot === undefined)) {
      return false;
    }
  }

  if (theme.refill !== undefined) {
    const refill = objectValue(theme.refill);
    if (!refill || !optionalString(refill.label) || !nonEmptyString(refill.applyActionSlot)) {
      return false;
    }
  }

  if (theme.packageCompletion !== undefined) {
    const completion = objectValue(theme.packageCompletion);
    if (!completion || !Array.isArray(completion.postActions) ||
      completion.postActions.length === 0 || !completion.postActions.every((value) => {
        const action = objectValue(value);
        return Boolean(action && nonEmptyString(action.actionSlot) &&
          optionalNonEmptyString(action.whenFieldNonEmpty));
      })) {
      return false;
    }
  }

  if (!nonEmptyString(picture.pathFieldId) || !optionalString(picture.title) ||
    !optionalString(picture.pathLabel) || !optionalString(picture.pathPlaceholder) ||
    !Array.isArray(picture.gridFields) || picture.gridFields.length === 0 ||
    !picture.gridFields.every(isNumberField) ||
    !hasUniqueValues(picture.gridFields.map((field) => field.fieldId))) {
    return false;
  }

  if (!nonEmptyString(environment.pathFieldId) || !optionalString(environment.title) ||
    !optionalString(environment.pathLabel) || !optionalString(environment.pathPlaceholder) ||
    !Array.isArray(environment.valueFields) || environment.valueFields.length === 0 ||
    !environment.valueFields.every(isNumberField) ||
    !hasUniqueValues(environment.valueFields.map((field) => field.fieldId))) {
    return false;
  }

  if (!hasRequiredActionSlots(themeActions,
    ["browseImage", "absorb", "saveFields", "loadFields", "darkMode", "lightMode", "apply"],
    ["refill", "savePackage", "openPackage", "previousPackage", "nextPackage"]) ||
    !hasRequiredActionSlots(pictureActions, ["apply", "browse", "clear"], ["startup", "applyGrid"]) ||
    !hasRequiredActionSlots(environmentActions, ["apply", "browse", "clear", "reset"], [])) {
    return false;
  }

  if (config.tone !== undefined) {
    const tone = objectValue(config.tone);
    if (!tone || !optionalFiniteNumber(tone.defaultLevel) ||
      (finiteNumber(tone.defaultLevel) && (tone.defaultLevel < 0 || tone.defaultLevel > 1)) ||
      (tone.showSlider !== undefined && typeof tone.showSlider !== "boolean") ||
      !optionalString(tone.sliderLabel) || !optionalNonEmptyString(tone.storageKey)) {
      return false;
    }
    if (tone.profiles !== undefined) {
      const profiles = objectValue(tone.profiles);
      if (!profiles || typeof profiles.enabled !== "boolean" ||
        !optionalString(profiles.selectLabel) || !optionalString(profiles.namePlaceholder) ||
        !optionalString(profiles.saveLabel)) {
        return false;
      }
    }
    if (tone.legacyProfiles !== undefined) {
      const legacy = objectValue(tone.legacyProfiles);
      const localStorage = objectValue(legacy?.localStorage);
      if (!legacy || !nonEmptyString(legacy.migrationId) ||
        !nonEmptyString(legacy.actionSlot) || !nonEmptyString(legacy.format) ||
        !isNonEmptyStringRecord(legacy.roleMap) ||
        (legacy.mode !== undefined && legacy.mode !== "dark" && legacy.mode !== "light") ||
        !optionalFiniteNumber(legacy.level) ||
        (finiteNumber(legacy.level) && (legacy.level < 0 || legacy.level > 1)) ||
        (legacy.localStorage !== undefined && (!localStorage ||
          !optionalNonEmptyString(localStorage.profilesKey) ||
          !optionalNonEmptyString(localStorage.activeProfileIdKey) ||
          !optionalNonEmptyString(localStorage.levelKey)))) {
        return false;
      }
    }
  }

  if (config.fieldPersistence !== undefined) {
    const persistence = objectValue(config.fieldPersistence);
    if (!persistence || !nonEmptyString(persistence.storageKey)) return false;
    if (persistence.legacy !== undefined && (!Array.isArray(persistence.legacy) ||
      !persistence.legacy.every((entry) => {
        const legacy = objectValue(entry);
        const transforms = objectValue(legacy?.fieldTransforms);
        return Boolean(legacy && nonEmptyString(legacy.migrationId) &&
          Array.isArray(legacy.storageKeys) && legacy.storageKeys.length > 0 &&
          legacy.storageKeys.every(nonEmptyString) &&
          isNonEmptyStringRecord(legacy.fieldMap) &&
          (legacy.fieldTransforms === undefined || (transforms &&
            Object.entries(transforms).every(([key, transform]) =>
              nonEmptyString(key) && transform === "parse-number"))));
      }))) return false;
  }

  return true;
}
