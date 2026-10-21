import type { ButtonRangeToolField, ButtonToolField, JsonValue } from "../types.js";

function rangeValue(field: ButtonRangeToolField, value: JsonValue | undefined): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : field.defaultValue;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function tidy(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

function isRangeField(field: ButtonToolField): field is ButtonRangeToolField {
  return field.kind === "range";
}

/**
 * Range fields that move together with `fieldId`: while its link toggle is on,
 * every range field whose own link toggle is on (shared or per-field) follows.
 */
export function linkedRangeFields(
  fields: readonly ButtonToolField[],
  values: Readonly<Record<string, JsonValue>>,
  fieldId: string
): ButtonRangeToolField[] {
  const field = fields.find((candidate) => candidate.id === fieldId);
  if (!field || !isRangeField(field)) return [];
  const link = field.linkToggleField;
  if (!link || values[link] !== true) return [field];
  return fields.filter(
    (candidate): candidate is ButtonRangeToolField =>
      isRangeField(candidate) &&
      Boolean(candidate.linkToggleField) &&
      values[candidate.linkToggleField!] === true
  );
}

/**
 * Field patch for dragging `fieldId` to `requested`. Linked fields move by the
 * same amount, clamped so every member stays inside its own range.
 */
export function linkedRangePatch(
  fields: readonly ButtonToolField[],
  values: Readonly<Record<string, JsonValue>>,
  fieldId: string,
  requested: number
): Record<string, number> {
  const group = linkedRangeFields(fields, values, fieldId);
  const field = group.find((candidate) => candidate.id === fieldId);
  if (!field || !Number.isFinite(requested)) return {};
  const current = rangeValue(field, values[field.id]);
  let low = -Infinity;
  let high = Infinity;
  for (const member of group) {
    const value = rangeValue(member, values[member.id]);
    low = Math.max(low, member.minimum - value);
    high = Math.min(high, member.maximum - value);
  }
  const delta = clamp(requested - current, Math.min(low, 0), Math.max(high, 0));
  return Object.fromEntries(
    group.map((member) => [
      member.id,
      tidy(clamp(rangeValue(member, values[member.id]) + delta, member.minimum, member.maximum))
    ])
  );
}

export function formatRangeValue(field: ButtonRangeToolField, value: JsonValue | undefined): string {
  const numeric = rangeValue(field, value);
  const decimals = field.step !== undefined && field.step < 1
    ? Math.min(6, Math.max(0, Math.ceil(-Math.log10(field.step))))
    : 0;
  const text = numeric.toFixed(decimals);
  return field.format ? field.format.split("{value}").join(text) : text;
}
