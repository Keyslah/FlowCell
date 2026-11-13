import type { ButtonStateDocument } from "../types.js";
import { findPanelOwnerButton } from "./panelOwnerButtonOperations.js";

const DEFAULT_POPOUT_METADATA_KEY = "defaultPopoutSettings";
const SAVED_POPOUT_METADATA_KEY = "popoutSettingsFiles";

export interface ButtonDefaultPopoutChoice {
  path: string;
  choiceId: string;
  surfaceId: string;
}

export function createButtonDefaultPopoutChoice(
  ownerButtonId: string,
  surfaceId: string,
  path: string
): ButtonDefaultPopoutChoice {
  const normalizedPath = path.trim();
  if (!ownerButtonId.trim() || !surfaceId.trim() || !normalizedPath) {
    throw new Error("Choose an existing saved Pop-out file before making it the default.");
  }
  let hash = 0x811c9dc5;
  const identity = `${ownerButtonId}\u0000${normalizedPath.replaceAll("/", "\\").toLocaleLowerCase("en")}`;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return { path: normalizedPath, choiceId: (hash >>> 0).toString(36), surfaceId };
}

export function getButtonDefaultPopoutChoice(
  document: ButtonStateDocument,
  ownerButtonId: string
): ButtonDefaultPopoutChoice | null {
  const owner = document.buttons[ownerButtonId];
  if (!owner || !["panel-owner", "tool-set-owner"].includes(owner.role)) return null;
  return readPopoutChoice(owner.metadata[DEFAULT_POPOUT_METADATA_KEY]);
}

function readPopoutChoice(value: unknown): ButtonDefaultPopoutChoice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const choice = value as Record<string, unknown>;
  if (typeof choice.path !== "string" || !choice.path.trim() ||
      typeof choice.choiceId !== "string" || !choice.choiceId.trim() ||
      typeof choice.surfaceId !== "string" || !choice.surfaceId.trim()) return null;
  return { path: choice.path.trim(), choiceId: choice.choiceId.trim(), surfaceId: choice.surfaceId.trim() };
}

/** The file belongs to the complete setup surface, independently of focused members. */
export function getButtonSavedPopoutChoice(
  document: ButtonStateDocument,
  ownerButtonId: string,
  surfaceId: string
): ButtonDefaultPopoutChoice | null {
  const owner = document.buttons[ownerButtonId];
  if (!owner || !["panel-owner", "tool-set-owner"].includes(owner.role)) return null;
  const files = owner.metadata[SAVED_POPOUT_METADATA_KEY];
  if (!files || typeof files !== "object" || Array.isArray(files) || !Object.hasOwn(files, surfaceId)) return null;
  const choice = readPopoutChoice(files[surfaceId]);
  return choice?.surfaceId === surfaceId ? choice : null;
}

/** Record a successful Save without making it the default or touching other setup files. */
export function setButtonSavedPopoutChoice(
  document: ButtonStateDocument,
  ownerButtonId: string,
  choice: ButtonDefaultPopoutChoice
): boolean {
  const owner = document.buttons[ownerButtonId];
  if (!owner || !["panel-owner", "tool-set-owner"].includes(owner.role)) {
    throw new Error("The Pop-out's owner is no longer installed.");
  }
  const normalized = createButtonDefaultPopoutChoice(ownerButtonId, choice.surfaceId, choice.path);
  if (buttonDefaultPopoutChoicesEqual(getButtonSavedPopoutChoice(document, ownerButtonId, normalized.surfaceId), normalized)) return false;
  const files = owner.metadata[SAVED_POPOUT_METADATA_KEY];
  owner.metadata[SAVED_POPOUT_METADATA_KEY] = {
    ...(files && typeof files === "object" && !Array.isArray(files) ? files : {}),
    [normalized.surfaceId]: { ...normalized }
  };
  return true;
}

export function resolveButtonDefaultPopoutOwnerId(
  document: ButtonStateDocument,
  surfaceId: string,
  context: { programName: string; panelName: string }
): string | null {
  const unit = Object.values(document.popoutUnits).find((candidate) => candidate.surfaceId === surfaceId);
  if (!unit) return null;
  return unit.kind === "tool-set" ? unit.ownerButtonId
    : findPanelOwnerButton(document, context.programName, context.panelName)?.id ?? null;
}

export function buttonDefaultPopoutChoicesEqual(
  left: ButtonDefaultPopoutChoice | null | undefined,
  right: ButtonDefaultPopoutChoice | null | undefined
): boolean {
  if (!left || !right) return left == null && right == null;
  return left.path.trim().replaceAll("/", "\\").toLocaleLowerCase("en") ===
    right.path.trim().replaceAll("/", "\\").toLocaleLowerCase("en");
}

/** Select a saved file without rewriting its contents or any Button arrangement. */
export function setButtonDefaultPopoutChoice(
  document: ButtonStateDocument,
  ownerButtonId: string,
  choice: ButtonDefaultPopoutChoice | null
): boolean {
  const owner = document.buttons[ownerButtonId];
  if (!owner || !["panel-owner", "tool-set-owner"].includes(owner.role)) {
    throw new Error("The Pop-out's owner is no longer installed.");
  }
  if (buttonDefaultPopoutChoicesEqual(getButtonDefaultPopoutChoice(document, ownerButtonId), choice)) return false;
  if (choice) {
    owner.metadata[DEFAULT_POPOUT_METADATA_KEY] = { ...createButtonDefaultPopoutChoice(ownerButtonId, choice.surfaceId, choice.path) };
  } else {
    delete owner.metadata[DEFAULT_POPOUT_METADATA_KEY];
  }
  return true;
}
