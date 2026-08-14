import type { ButtonToolField, JsonValue } from "../types.js";

export interface ToolFieldRuntimeState {
  unitId: string;
  schemaFingerprint: string;
  values: Record<string, JsonValue>;
}

function stableSchemaValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(stableSchemaValue).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSchemaValue(record[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "number:NaN";
    if (value === Number.POSITIVE_INFINITY) return "number:Infinity";
    if (value === Number.NEGATIVE_INFINITY) return "number:-Infinity";
    if (Object.is(value, -0)) return "number:-0";
  }
  return `${typeof value}:${JSON.stringify(value)}`;
}

export function toolFieldSchemaFingerprint(fields: readonly ButtonToolField[]): string {
  return stableSchemaValue(fields);
}

export function createToolFieldRuntimeState(
  unitId: string,
  fields: readonly ButtonToolField[]
): ToolFieldRuntimeState {
  return {
    unitId,
    schemaFingerprint: toolFieldSchemaFingerprint(fields),
    values: Object.fromEntries(fields.map((field) => [field.id, field.defaultValue]))
  };
}

export function reconcileToolFieldRuntimeState(
  current: ToolFieldRuntimeState,
  incoming: ToolFieldRuntimeState
): ToolFieldRuntimeState {
  return current.unitId === incoming.unitId &&
    current.schemaFingerprint === incoming.schemaFingerprint
    ? current
    : incoming;
}
