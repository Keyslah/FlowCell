import {
  runPanelButtonEvent,
  runPanelScript,
  runToolsetAction
} from "../../lib/programRails.js";
import type {
  ButtonExecutionTarget,
  ButtonPayloadTemplate,
  ButtonPayloadTemplateValue,
  ButtonRecord,
  ButtonToolField,
  CoreActionExecutionTarget,
  JsonObject,
  JsonValue
} from "../types.js";

export interface ButtonExecutionResult {
  executed: boolean;
  response?: unknown;
  message?: string;
  fieldValues: Readonly<Record<string, JsonValue>>;
  fieldPatch: Readonly<Record<string, JsonValue>>;
}

export interface ButtonExecutionContext {
  fields?: readonly ButtonToolField[];
  fieldValues?: Readonly<Record<string, JsonValue>>;
  onFieldActivate?: (
    field: ButtonToolField,
    currentValue: JsonValue
  ) => Promise<JsonValue | undefined>;
  onFieldPatch?: (
    patch: Readonly<Record<string, JsonValue>>,
    nextValues: Readonly<Record<string, JsonValue>>
  ) => void;
}

function responseFieldPatch(
  response: unknown,
  fields: readonly ButtonToolField[],
  fallbackFieldId?: string
): Record<string, JsonValue> {
  const responseRecord = response && typeof response === "object"
    ? response as Record<string, unknown>
    : null;
  const rawPatch = responseRecord?.fieldPatch && typeof responseRecord.fieldPatch === "object" && !Array.isArray(responseRecord.fieldPatch)
    ? responseRecord.fieldPatch as Record<string, JsonValue>
    : responseRecord && fallbackFieldId && "fieldValue" in responseRecord
      ? { [fallbackFieldId]: responseRecord.fieldValue as JsonValue }
      : {};
  const allowedFieldIds = new Set(fields.map((field) => field.id));
  return Object.fromEntries(
    Object.entries(rawPatch).filter(([fieldId]) => allowedFieldIds.has(fieldId))
  );
}

export interface ButtonCoreActionContext {
  eventName?: string;
  fieldValues: Readonly<Record<string, JsonValue>>;
}

export type ButtonCoreActionHandler = (
  target: CoreActionExecutionTarget,
  context: ButtonCoreActionContext
) => Promise<unknown>;

const coreActionRegistry = new Map<string, ButtonCoreActionHandler>();

export function registerButtonCoreAction(
  actionId: string,
  handler: ButtonCoreActionHandler
): () => void {
  const normalized = actionId.trim();
  if (!normalized) throw new Error("A core-action registry ID cannot be empty.");
  coreActionRegistry.set(normalized, handler);
  return () => {
    if (coreActionRegistry.get(normalized) === handler) coreActionRegistry.delete(normalized);
  };
}

function isFieldReference(value: ButtonPayloadTemplateValue): value is { $field: string } {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value as object).length === 1 && typeof (value as { $field?: unknown }).$field === "string";
}

function resolveTemplateValue(
  value: ButtonPayloadTemplateValue,
  fieldValues: Readonly<Record<string, JsonValue>>
): JsonValue {
  if (isFieldReference(value)) {
    if (!(value.$field in fieldValues)) {
      throw new Error(`Button payload references missing tool field '${value.$field}'.`);
    }
    return fieldValues[value.$field];
  }
  if (Array.isArray(value)) return value.map((item) => resolveTemplateValue(item, fieldValues));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveTemplateValue(item, fieldValues)])
    );
  }
  return value;
}

export function resolveButtonPayloadTemplate(
  template: ButtonPayloadTemplate,
  fieldValues: Readonly<Record<string, JsonValue>>
): JsonObject {
  return resolveTemplateValue(template, fieldValues) as JsonObject;
}

function setPayloadPath(target: JsonObject, path: string, value: JsonValue): void {
  const parts = path.split(".").map((part) => part.trim()).filter(Boolean);
  if (parts.some((part) => ["__proto__", "prototype", "constructor"].includes(part))) {
    throw new Error(`Unsafe tool-field payload path '${path}'.`);
  }
  if (parts.length === 0) return;
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const current = cursor[part];
    if (!current || typeof current !== "object" || Array.isArray(current)) cursor[part] = {};
    cursor = cursor[part] as JsonObject;
  }
  cursor[parts[parts.length - 1]] = value;
}

export function mapButtonFieldsToPayload(
  fields: readonly ButtonToolField[],
  fieldValues: Readonly<Record<string, JsonValue>>
): JsonObject {
  const payload: JsonObject = {};
  for (const field of fields) {
    if (!field.payloadKey.trim() || !(field.id in fieldValues)) continue;
    setPayloadPath(payload, field.payloadKey, fieldValues[field.id]);
  }
  return payload;
}

function mergePayload(base: JsonObject, overlay: JsonObject): JsonObject {
  const next: JsonObject = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (
      value && typeof value === "object" && !Array.isArray(value) &&
      next[key] && typeof next[key] === "object" && !Array.isArray(next[key])
    ) {
      next[key] = mergePayload(next[key] as JsonObject, value as JsonObject);
    } else {
      next[key] = value;
    }
  }
  return next;
}

async function dispatchTarget(
  target: ButtonExecutionTarget,
  eventName: string | undefined,
  fieldValues: Readonly<Record<string, JsonValue>>,
  payload: JsonObject
): Promise<unknown> {
  const hasNamedEvent = Boolean(eventName && eventName !== "click" && target.events?.[eventName]);
  if (hasNamedEvent && target.kind === "panel-script") {
    return runPanelButtonEvent(target.programName, target.panelName, target.fileName, eventName!);
  }
  if (hasNamedEvent && target.kind === "tool-set-action") {
    return runPanelButtonEvent(target.programName, target.panelName, target.ownerFileName, eventName!);
  }
  if (target.kind === "panel-script") {
    return runPanelScript(target.programName, target.panelName, target.fileName);
  }
  if (target.kind === "tool-set-action") {
    return runToolsetAction({
      programName: target.programName,
      panelName: target.panelName,
      fileName: target.ownerFileName,
      command: target.command,
      payload: mergePayload(target.payload ?? {}, payload)
    });
  }
  const handler = coreActionRegistry.get(target.actionId);
  if (!handler) throw new Error(`No FlowCell core action is registered for '${target.actionId}'.`);
  return handler(
    { ...target, payload: mergePayload(target.payload ?? {}, payload) },
    { eventName, fieldValues }
  );
}

export async function executeButtonTarget(
  target: ButtonExecutionTarget,
  eventName?: string,
  context: ButtonExecutionContext = {}
): Promise<ButtonExecutionResult> {
  const fieldValues = { ...(context.fieldValues ?? {}) };
  if (eventName && eventName !== "click" && !target.events?.[eventName]) {
    return { executed: false, fieldValues, fieldPatch: {} };
  }
  const payload = mapButtonFieldsToPayload(context.fields ?? [], fieldValues);
  const response = await dispatchTarget(target, eventName, fieldValues, payload);
  return { executed: true, response, fieldValues, fieldPatch: {} };
}

export async function executeButtonRecord(
  button: ButtonRecord,
  eventName?: string,
  context: ButtonExecutionContext = {}
): Promise<ButtonExecutionResult> {
  if (button.disabled) {
    return { executed: false, message: "Button is disabled.", fieldValues: context.fieldValues ?? {}, fieldPatch: {} };
  }
  if (eventName && eventName !== "click" && !button.executionTarget?.events?.[eventName]) {
    return { executed: false, fieldValues: context.fieldValues ?? {}, fieldPatch: {} };
  }
  const behavior = !eventName || eventName === "click" ? button.toolSetBehavior : null;
  const activatedPatch: Record<string, JsonValue> = {};
  if (behavior?.activateField) {
    const field = context.fields?.find((candidate) => candidate.id === behavior.activateField);
    if (!field) {
      throw new Error(`Button '${button.label}' references missing tool field '${behavior.activateField}'.`);
    }
    if (!context.onFieldActivate) {
      throw new Error(`Button '${button.label}' requires a functional host for tool field '${field.id}'.`);
    }
    const currentValue = (context.fieldValues ?? {})[field.id] ?? field.defaultValue;
    const activatedValue = await context.onFieldActivate(field, currentValue);
    if (activatedValue === undefined) {
      return {
        executed: false,
        fieldValues: context.fieldValues ?? {},
        fieldPatch: {}
      };
    }
    activatedPatch[field.id] = activatedValue;
  }
  const togglePatch: Record<string, JsonValue> = {};
  for (const fieldId of behavior?.toggleFields ?? []) {
    const field = context.fields?.find((candidate) => candidate.id === fieldId);
    if (!field || field.kind !== "toggle") {
      throw new Error(`Button '${button.label}' references missing boolean toggle field '${fieldId}'.`);
    }
    const currentValue = (context.fieldValues ?? {})[fieldId] ?? field.defaultValue;
    if (typeof currentValue !== "boolean") {
      throw new Error(`Tool field '${fieldId}' must contain a boolean value before it can be toggled.`);
    }
    togglePatch[fieldId] = !currentValue;
  }
  const fieldPatch = { ...togglePatch, ...(behavior?.fieldPatch ?? {}), ...activatedPatch };
  const nextFieldValues = { ...(context.fieldValues ?? {}), ...fieldPatch };
  if (Object.keys(fieldPatch).length > 0) context.onFieldPatch?.(fieldPatch, nextFieldValues);
  if (behavior?.execute === false || !button.executionTarget) {
    return { executed: false, fieldValues: nextFieldValues, fieldPatch };
  }
  const mappedPayload = mapButtonFieldsToPayload(context.fields ?? [], nextFieldValues);
  const templatePayload = behavior?.payloadTemplate
    ? resolveButtonPayloadTemplate(behavior.payloadTemplate, nextFieldValues)
    : {};
  const response = await dispatchTarget(
    button.executionTarget,
    eventName,
    nextFieldValues,
    mergePayload(mappedPayload, templatePayload)
  );
  const responsePatch = responseFieldPatch(response, context.fields ?? []);
  const finalValues = { ...nextFieldValues, ...responsePatch };
  if (Object.keys(responsePatch).length > 0) context.onFieldPatch?.(responsePatch, finalValues);
  return {
    executed: true,
    response,
    fieldValues: finalValues,
    fieldPatch: { ...fieldPatch, ...responsePatch }
  };
}

export async function executeButtonToolField(
  field: ButtonToolField,
  nextValue: JsonValue,
  context: ButtonExecutionContext,
  eventName: "change" | "activate" = "change"
): Promise<ButtonExecutionResult> {
  const fieldPatch = { [field.id]: nextValue };
  const fieldValues = { ...(context.fieldValues ?? {}), ...fieldPatch };
  context.onFieldPatch?.(fieldPatch, fieldValues);
  if (!field.serviceTarget) {
    return { executed: false, fieldValues, fieldPatch };
  }
  const payload = mapButtonFieldsToPayload(context.fields ?? [], fieldValues);
  const response = await dispatchTarget(field.serviceTarget, eventName, fieldValues, payload);
  const responsePatch = responseFieldPatch(response, context.fields ?? [], field.id);
  const finalValues = { ...fieldValues, ...responsePatch };
  if (Object.keys(responsePatch).length > 0) context.onFieldPatch?.(responsePatch, finalValues);
  return { executed: true, response, fieldValues: finalValues, fieldPatch: { ...fieldPatch, ...responsePatch } };
}
