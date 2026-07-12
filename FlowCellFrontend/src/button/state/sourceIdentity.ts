import type {
  ButtonRecord,
  ButtonSourceIdentity,
  ButtonStateDocument
} from "../types.js";

function normalizeIdentityPart(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\{2,}/g, "\\")
    .toLowerCase();
}

export function createButtonSourceIdentity(
  programName: string,
  panelName: string,
  fileName: string
): ButtonSourceIdentity {
  return {
    displayProgramName: programName,
    displayPanelName: panelName,
    displayFileName: fileName,
    normalizedProgramName: normalizeIdentityPart(programName),
    normalizedPanelName: normalizeIdentityPart(panelName),
    normalizedFileName: normalizeIdentityPart(fileName)
  };
}

export function canonicalSourceIdentity(identity: ButtonSourceIdentity): readonly [string, string, string] {
  return [
    normalizeIdentityPart(identity.normalizedProgramName),
    normalizeIdentityPart(identity.normalizedPanelName),
    normalizeIdentityPart(identity.normalizedFileName)
  ];
}

export function compareButtonSourceIdentities(
  left: ButtonSourceIdentity,
  right: ButtonSourceIdentity
): number {
  const leftKey = JSON.stringify(canonicalSourceIdentity(left));
  const rightKey = JSON.stringify(canonicalSourceIdentity(right));
  return leftKey.localeCompare(rightKey, "en", { sensitivity: "variant" });
}

export function areButtonSourceIdentitiesEqual(
  left: ButtonSourceIdentity,
  right: ButtonSourceIdentity
): boolean {
  return compareButtonSourceIdentities(left, right) === 0;
}

export function deriveRegularPopoutSelectionKey(
  identities: readonly ButtonSourceIdentity[]
): string {
  const members = identities
    .map((identity) => canonicalSourceIdentity(identity))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
  return JSON.stringify({ version: 1, members });
}

export function splitMixedButtonPopSelection(
  document: ButtonStateDocument,
  buttonIds: readonly string[]
): { singleScriptButtons: ButtonRecord[]; toolSetOwners: ButtonRecord[] } {
  const buttons = buttonIds.map((id) => document.buttons[id]).filter(Boolean);
  return {
    singleScriptButtons: buttons.filter((button) => button.role === "single-script"),
    toolSetOwners: buttons.filter((button) => button.role === "tool-set-owner")
  };
}

export function resolveRegularButtonPopout(
  document: ButtonStateDocument,
  identities: readonly ButtonSourceIdentity[]
) {
  const selectionKey = deriveRegularPopoutSelectionKey(identities);
  return Object.values(document.popoutUnits).find(
    (unit) => unit.kind === "regular" && unit.selectionKey === selectionKey
  ) ?? null;
}

export function resolveButtonFanSetups(
  document: ButtonStateDocument,
  programName: string,
  panelName: string
) {
  const normalizedProgram = programName.normalize("NFC").trim().toLowerCase();
  const normalizedPanel = panelName.normalize("NFC").trim().toLowerCase();
  return Object.values(document.fanSetups).filter(
    (setup) => setup.programName.normalize("NFC").trim().toLowerCase() === normalizedProgram &&
      setup.panelName.normalize("NFC").trim().toLowerCase() === normalizedPanel
  );
}

export function resolvePanelOwnerButton(
  document: ButtonStateDocument,
  programName: string,
  panelName: string
) {
  return Object.values(document.buttons).find(
    (button) => button.role === "panel-owner" &&
      String(button.metadata.programName ?? "").localeCompare(programName, undefined, { sensitivity: "accent" }) === 0 &&
      String(button.metadata.panelName ?? "").localeCompare(panelName, undefined, { sensitivity: "accent" }) === 0
  ) ?? null;
}

export function resolveToolSetOwnerPopout(document: ButtonStateDocument, ownerButtonId: string) {
  return Object.values(document.popoutUnits).find(
    (unit) => unit.kind === "tool-set" && unit.ownerButtonId === ownerButtonId
  ) ?? null;
}
