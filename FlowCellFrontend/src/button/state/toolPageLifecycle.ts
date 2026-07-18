import type { ButtonStateDocument, JsonObject } from "../types.js";

export interface ToolPageWindowIdentity {
  contributionId: string;
  ownerButtonId?: string;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function identityKey(identity: ToolPageWindowIdentity): string {
  return identity.ownerButtonId || identity.contributionId;
}

interface ToolPageWindowDescriptor {
  identity: ToolPageWindowIdentity;
  fingerprint: string;
}

function descriptorFromPayload(payload: JsonObject | undefined): ToolPageWindowDescriptor | null {
  const identity = identityFromPayload(payload);
  if (!identity) return null;
  const fingerprintFields = [
    "contributionId",
    "ownerButtonId",
    "renderer",
    "capability",
    "programName",
    "panelName",
    "fileName",
    "title",
    "resourceLabel",
    "emptyMessage",
    "refreshEvent"
  ];
  return {
    identity,
    fingerprint: JSON.stringify(Object.fromEntries(
      fingerprintFields.map((field) => [field, readString(payload?.[field]) ?? ""])
    ))
  };
}

function identityFromPayload(payload: JsonObject | undefined): ToolPageWindowIdentity | null {
  const contributionId = readString(payload?.contributionId);
  if (!contributionId) return null;
  const ownerButtonId = readString(payload?.ownerButtonId);
  return ownerButtonId ? { contributionId, ownerButtonId } : { contributionId };
}

export function toolPageWindowIdentities(document: ButtonStateDocument): ToolPageWindowIdentity[] {
  return toolPageWindowDescriptors(document).map((descriptor) => descriptor.identity);
}

function toolPageWindowDescriptors(document: ButtonStateDocument): ToolPageWindowDescriptor[] {
  const descriptors = new Map<string, ToolPageWindowDescriptor>();
  for (const button of Object.values(document.buttons)) {
    const target = button.executionTarget;
    if (target?.kind !== "core-action" || target.actionId !== "open-tool-page") continue;
    const descriptor = descriptorFromPayload(target.payload);
    if (descriptor) descriptors.set(identityKey(descriptor.identity), descriptor);
  }
  return [...descriptors.values()];
}

export function removedToolPageWindowIdentities(
  previous: ButtonStateDocument,
  next: ButtonStateDocument
): ToolPageWindowIdentity[] {
  const retained = new Map(toolPageWindowDescriptors(next).map((descriptor) => [
    identityKey(descriptor.identity),
    descriptor.fingerprint
  ]));
  return toolPageWindowDescriptors(previous)
    .filter((descriptor) => retained.get(identityKey(descriptor.identity)) !== descriptor.fingerprint)
    .map((descriptor) => descriptor.identity);
}

export function scopedToolPageWindowIdentities(
  document: ButtonStateDocument,
  programName: string,
  panelName?: string
): ToolPageWindowIdentity[] {
  const normalizedProgram = programName.trim().toLocaleLowerCase();
  const normalizedPanel = panelName?.trim().toLocaleLowerCase();
  const matches = new Map<string, ToolPageWindowIdentity>();
  for (const button of Object.values(document.buttons)) {
    const target = button.executionTarget;
    if (target?.kind !== "core-action" || target.actionId !== "open-tool-page") continue;
    const identity = identityFromPayload(target.payload);
    if (!identity) continue;
    const source = button.sourceIdentity;
    const payload = target.payload;
    const sourceProgram = source?.normalizedProgramName || readString(payload?.programName)?.toLocaleLowerCase();
    const sourcePanel = source?.normalizedPanelName || readString(payload?.panelName)?.toLocaleLowerCase();
    if (sourceProgram === normalizedProgram &&
      (normalizedPanel === undefined || sourcePanel === normalizedPanel)) {
      matches.set(identityKey(identity), identity);
    }
  }
  return [...matches.values()];
}
