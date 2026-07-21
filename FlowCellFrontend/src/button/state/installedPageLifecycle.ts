import type { ButtonStateDocument } from "../types.js";

interface InstalledPageWindowDescriptor {
  ownerButtonId: string;
  fingerprint: string;
  programName: string;
  panelName: string;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function installedPageWindowDescriptors(
  document: ButtonStateDocument
): InstalledPageWindowDescriptor[] {
  const descriptors = new Map<string, InstalledPageWindowDescriptor>();
  for (const button of Object.values(document.buttons)) {
    const target = button.executionTarget;
    if (target?.kind !== "core-action" || target.actionId !== "open-installed-page") continue;
    const ownerButtonId = readString(target.payload?.ownerButtonId) ?? button.id;
    const programName = button.sourceIdentity?.displayProgramName ??
      readString(target.payload?.programName) ?? "";
    const panelName = button.sourceIdentity?.displayPanelName ??
      readString(target.payload?.panelName) ?? "";
    const fingerprint = JSON.stringify({
      ownerButtonId,
      programName: programName.toLocaleLowerCase(),
      panelName: panelName.toLocaleLowerCase(),
      fileName: readString(target.payload?.fileName) ?? "",
      pageId: readString(target.payload?.pageId) ?? ""
    });
    descriptors.set(ownerButtonId, { ownerButtonId, fingerprint, programName, panelName });
  }
  return [...descriptors.values()];
}

export function removedInstalledPageOwnerIds(
  previous: ButtonStateDocument,
  next: ButtonStateDocument
): string[] {
  const retained = new Map(installedPageWindowDescriptors(next).map((descriptor) => [
    descriptor.ownerButtonId,
    descriptor.fingerprint
  ]));
  return installedPageWindowDescriptors(previous)
    .filter((descriptor) => retained.get(descriptor.ownerButtonId) !== descriptor.fingerprint)
    .map((descriptor) => descriptor.ownerButtonId);
}

export function scopedInstalledPageOwnerIds(
  document: ButtonStateDocument,
  programName: string,
  panelName?: string
): string[] {
  const normalizedProgram = programName.trim().toLocaleLowerCase();
  const normalizedPanel = panelName?.trim().toLocaleLowerCase();
  return installedPageWindowDescriptors(document)
    .filter((descriptor) =>
      descriptor.programName.trim().toLocaleLowerCase() === normalizedProgram &&
      (normalizedPanel === undefined ||
        descriptor.panelName.trim().toLocaleLowerCase() === normalizedPanel)
    )
    .map((descriptor) => descriptor.ownerButtonId);
}
