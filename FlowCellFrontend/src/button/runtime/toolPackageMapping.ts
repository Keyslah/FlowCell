import type { JsonValue } from "../types.js";

export interface LoadedToolPackageFields {
  format: string;
  values: Readonly<Record<string, JsonValue>>;
  assets: Readonly<Record<string, string>>;
}

export interface ToolPackageLegacyMapping {
  legacyFormats: readonly string[];
  fieldMap: Readonly<Record<string, string>>;
  assetMap: Readonly<Record<string, string>>;
  fieldTransforms: Readonly<Record<string, string>>;
}

function transformLegacyValue(
  storedFieldId: string,
  value: JsonValue,
  transform: string | undefined
): JsonValue {
  if (!transform) return value;
  if (transform !== "parse-number") {
    throw new Error(`Unsupported legacy tool-package transform '${transform}'.`);
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") {
    throw new Error(`Legacy tool-package field '${storedFieldId}' is not numeric.`);
  }
  const match = value.trim().match(/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)/);
  const parsed = match ? Number.parseFloat(match[0]) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error(`Legacy tool-package field '${storedFieldId}' is not numeric.`);
  }
  return parsed;
}

export function mappedToolPackageFields(
  loaded: LoadedToolPackageFields,
  legacy: ToolPackageLegacyMapping
): Record<string, JsonValue> {
  const isLegacy = legacy.legacyFormats.includes(loaded.format);
  const fieldPatch: Record<string, JsonValue> = {};
  for (const [storedFieldId, value] of Object.entries(loaded.values ?? {})) {
    const fieldId = isLegacy ? legacy.fieldMap[storedFieldId] : storedFieldId;
    if (!fieldId) continue;
    fieldPatch[fieldId] = isLegacy
      ? transformLegacyValue(storedFieldId, value, legacy.fieldTransforms[storedFieldId])
      : value;
  }
  for (const [storedAssetId, path] of Object.entries(loaded.assets ?? {})) {
    const fieldId = isLegacy ? legacy.assetMap[storedAssetId] : storedAssetId;
    if (fieldId) fieldPatch[fieldId] = path;
  }
  return fieldPatch;
}
