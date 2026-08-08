import type {
  ButtonExecutionTarget,
  ButtonRecord,
  ButtonSourceIdentity,
  ButtonStateDocument
} from "../types.js";
import { removeOwnedButtonGraph } from "./buttonDocumentOperations.js";
import {
  removePanelOwnerGraph,
  removeProgramPanelOwnerGraphs,
  renamePanelOwnerIdentity,
  renameProgramPanelOwnerIdentities
} from "./panelOwnerButtonOperations.js";
import {
  removeFlowCellMainPageProgramButton,
  renameFlowCellMainPageProgramButton
} from "./mainPageButtonOperations.js";
import {
  createButtonSourceIdentity,
  deriveRegularPopoutSelectionKey
} from "./sourceIdentity.js";

export interface RenameButtonDocumentScopeResult {
  changed: boolean;
  sourceOwnerButtonIds: string[];
}

export interface RemoveButtonDocumentScopeResult {
  changed: boolean;
  removedButtonIds: string[];
  removedSurfaceIds: string[];
  uninstallOwnerButtonIds: string[];
}

interface ButtonDocumentScope {
  programName: string;
  panelName?: string;
}

interface RenamedScope {
  currentProgramName: string;
  currentPanelName?: string;
  nextProgramName: string;
  nextPanelName?: string;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\{2,}/g, "\\")
    .toLocaleLowerCase("en");
}

function requireName(value: string, label: string): string {
  const trimmed = value.normalize("NFC").trim();
  if (!trimmed) throw new Error(`${label} must not be empty.`);
  return trimmed;
}

function namesMatch(left: string, right: string): boolean {
  return normalizeName(left) === normalizeName(right);
}

function identityMatchesScope(
  identity: ButtonSourceIdentity,
  scope: ButtonDocumentScope
): boolean {
  return namesMatch(identity.displayProgramName, scope.programName) &&
    (scope.panelName === undefined || namesMatch(identity.displayPanelName, scope.panelName));
}

function sourceOwnersInScope(
  document: ButtonStateDocument,
  scope: ButtonDocumentScope
): ButtonRecord[] {
  return Object.values(document.buttons)
    .filter((button) =>
      button.role !== "tool-set-child" &&
      Boolean(button.sourceIdentity && identityMatchesScope(button.sourceIdentity, scope))
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buttonGraphIds(
  document: ButtonStateDocument,
  sourceOwners: readonly ButtonRecord[]
): Set<string> {
  const ids = new Set(sourceOwners.map((button) => button.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const button of Object.values(document.buttons)) {
      if (button.toolSetParentId && ids.has(button.toolSetParentId) && !ids.has(button.id)) {
        ids.add(button.id);
        changed = true;
      }
    }
  }
  return ids;
}

function renamedIdentity(
  identity: ButtonSourceIdentity,
  rename: RenamedScope
): ButtonSourceIdentity {
  return createButtonSourceIdentity(
    rename.nextProgramName,
    rename.nextPanelName ?? identity.displayPanelName,
    identity.displayFileName
  );
}

function identitiesMatchExactly(
  left: ButtonSourceIdentity,
  right: ButtonSourceIdentity
): boolean {
  return left.displayProgramName === right.displayProgramName &&
    left.displayPanelName === right.displayPanelName &&
    left.displayFileName === right.displayFileName &&
    left.normalizedProgramName === right.normalizedProgramName &&
    left.normalizedPanelName === right.normalizedPanelName &&
    left.normalizedFileName === right.normalizedFileName;
}

function updateExecutionTarget(
  target: ButtonExecutionTarget | null | undefined,
  rename: RenamedScope
): boolean {
  if (!target) return false;
  const currentPanelName = rename.currentPanelName;
  const nextPanelName = rename.nextPanelName;
  if (target.kind === "panel-script" || target.kind === "tool-set-action") {
    if (
      !namesMatch(target.programName, rename.currentProgramName) ||
      (currentPanelName !== undefined && !namesMatch(target.panelName, currentPanelName))
    ) {
      return false;
    }
    const changed = target.programName !== rename.nextProgramName || (
      nextPanelName !== undefined && target.panelName !== nextPanelName
    );
    if (!changed) return false;
    target.programName = rename.nextProgramName;
    if (nextPanelName !== undefined) target.panelName = nextPanelName;
    return true;
  }
  if (target.kind !== "core-action" || !target.payload) return false;
  const payloadProgramName = target.payload.programName;
  const payloadPanelName = target.payload.panelName;
  if (
    typeof payloadProgramName !== "string" ||
    !namesMatch(payloadProgramName, rename.currentProgramName) ||
    (currentPanelName !== undefined && (
      typeof payloadPanelName !== "string" ||
      !namesMatch(payloadPanelName, currentPanelName)
    ))
  ) {
    return false;
  }
  const changed = payloadProgramName !== rename.nextProgramName || (
    nextPanelName !== undefined && payloadPanelName !== nextPanelName
  );
  if (!changed) return false;
  target.payload = {
    ...target.payload,
    programName: rename.nextProgramName,
    ...(nextPanelName !== undefined ? { panelName: nextPanelName } : {})
  };
  return true;
}

function updateToolFieldServiceTargets(
  document: ButtonStateDocument,
  graphIds: ReadonlySet<string>,
  rename: RenamedScope
): boolean {
  let changed = false;
  for (const unit of Object.values(document.popoutUnits)) {
    if (unit.kind !== "tool-set" || !graphIds.has(unit.ownerButtonId)) continue;
    for (const field of unit.fields) {
      changed = updateExecutionTarget(field.serviceTarget, rename) || changed;
    }
  }
  return changed;
}

function updateKnownIdentityMetadata(
  button: ButtonRecord,
  rename: RenamedScope
): boolean {
  let changed = false;
  if (
    typeof button.metadata.programName === "string" &&
    namesMatch(button.metadata.programName, rename.currentProgramName) &&
    button.metadata.programName !== rename.nextProgramName
  ) {
    button.metadata = { ...button.metadata, programName: rename.nextProgramName };
    changed = true;
  }
  if (
    rename.currentPanelName !== undefined &&
    rename.nextPanelName !== undefined &&
    typeof button.metadata.panelName === "string" &&
    namesMatch(button.metadata.panelName, rename.currentPanelName) &&
    button.metadata.panelName !== rename.nextPanelName
  ) {
    button.metadata = { ...button.metadata, panelName: rename.nextPanelName };
    changed = true;
  }
  return changed;
}

function refreshRegularPopoutIdentities(document: ButtonStateDocument): boolean {
  let changed = false;
  for (const unit of Object.values(document.popoutUnits)) {
    if (unit.kind !== "regular") continue;
    const identities = unit.memberPlacementIds.flatMap((placementId) => {
      const placement = document.placements[placementId];
      const identity = placement ? document.buttons[placement.buttonId]?.sourceIdentity : null;
      return identity ? [{ ...identity }] : [];
    });
    if (identities.length !== unit.memberPlacementIds.length) continue;
    const selectionKey = deriveRegularPopoutSelectionKey(identities);
    if (
      JSON.stringify(unit.memberSourceIdentities) !== JSON.stringify(identities) ||
      unit.selectionKey !== selectionKey
    ) {
      unit.memberSourceIdentities = identities;
      unit.selectionKey = selectionKey;
      changed = true;
    }
  }
  return changed;
}

function updateDefaultSurfaceNames(
  document: ButtonStateDocument,
  renamedPanels: readonly RenamedScope[]
): boolean {
  let changed = false;
  for (const surface of Object.values(document.surfaces)) {
    for (const rename of renamedPanels) {
      const currentPanelName = rename.currentPanelName;
      const nextPanelName = rename.nextPanelName;
      if (!currentPanelName || !nextPanelName) continue;
      if (
        surface.kind === "panel" &&
        namesMatch(
          surface.name,
          `${rename.currentProgramName} / ${currentPanelName}`
        ) &&
        surface.name !== `${rename.nextProgramName} / ${nextPanelName}`
      ) {
        surface.name = `${rename.nextProgramName} / ${nextPanelName}`;
        changed = true;
      } else if (
        surface.kind === "fan" &&
        namesMatch(surface.name, `${currentPanelName} Fan`) &&
        surface.name !== `${nextPanelName} Fan`
      ) {
        surface.name = `${nextPanelName} Fan`;
        changed = true;
      }
    }
  }
  return changed;
}

function updateFanSetupScope(
  document: ButtonStateDocument,
  rename: RenamedScope
): boolean {
  let changed = false;
  for (const setup of Object.values(document.fanSetups)) {
    if (
      !namesMatch(setup.programName, rename.currentProgramName) ||
      (rename.currentPanelName !== undefined &&
        !namesMatch(setup.panelName, rename.currentPanelName))
    ) {
      continue;
    }
    const setupChanged = setup.programName !== rename.nextProgramName || (
      rename.nextPanelName !== undefined && setup.panelName !== rename.nextPanelName
    );
    if (setupChanged) {
      setup.programName = rename.nextProgramName;
      if (rename.nextPanelName !== undefined) setup.panelName = rename.nextPanelName;
      changed = true;
    }
  }
  return changed;
}

function renameSourceScope(
  document: ButtonStateDocument,
  rename: RenamedScope
): RenameButtonDocumentScopeResult {
  const scope = {
    programName: rename.currentProgramName,
    ...(rename.currentPanelName !== undefined ? { panelName: rename.currentPanelName } : {})
  };
  const sourceOwners = sourceOwnersInScope(document, scope);
  const graphIds = buttonGraphIds(document, sourceOwners);
  const renamedPanels = new Map<string, RenamedScope>();
  if (rename.currentPanelName !== undefined && rename.nextPanelName !== undefined) {
    renamedPanels.set(normalizeName(rename.currentPanelName), rename);
  }
  let changed = false;
  for (const owner of sourceOwners) {
    const identity = owner.sourceIdentity!;
    const nextPanelName = rename.nextPanelName ?? identity.displayPanelName;
    const pair: RenamedScope = {
      ...rename,
      currentPanelName: identity.displayPanelName,
      nextPanelName
    };
    renamedPanels.set(normalizeName(identity.displayPanelName), pair);
    const nextIdentity = renamedIdentity(identity, pair);
    if (!identitiesMatchExactly(identity, nextIdentity)) {
      owner.sourceIdentity = nextIdentity;
      changed = true;
    }
  }
  for (const buttonId of graphIds) {
    const button = document.buttons[buttonId];
    if (!button) continue;
    changed = updateExecutionTarget(button.executionTarget, rename) || changed;
    changed = updateKnownIdentityMetadata(button, rename) || changed;
  }
  changed = updateToolFieldServiceTargets(document, graphIds, rename) || changed;
  changed = updateFanSetupScope(document, rename) || changed;
  changed = updateDefaultSurfaceNames(document, [...renamedPanels.values()]) || changed;
  changed = refreshRegularPopoutIdentities(document) || changed;
  return {
    changed,
    sourceOwnerButtonIds: sourceOwners.map((button) => button.id)
  };
}

export function renamePanelButtonDocumentScope(
  document: ButtonStateDocument,
  args: {
    programName: string;
    currentPanelName: string;
    nextPanelName: string;
  }
): RenameButtonDocumentScopeResult {
  const rename: RenamedScope = {
    currentProgramName: requireName(args.programName, "Program name"),
    currentPanelName: requireName(args.currentPanelName, "Current panel name"),
    nextProgramName: requireName(args.programName, "Program name"),
    nextPanelName: requireName(args.nextPanelName, "New panel name")
  };
  const sourceResult = renameSourceScope(document, rename);
  const ownerResult = renamePanelOwnerIdentity(document, {
    programName: rename.currentProgramName,
    currentPanelName: rename.currentPanelName!,
    nextPanelName: rename.nextPanelName!
  });
  return {
    changed: sourceResult.changed || ownerResult.changed,
    sourceOwnerButtonIds: sourceResult.sourceOwnerButtonIds
  };
}

export function renameProgramButtonDocumentScope(
  document: ButtonStateDocument,
  args: { currentProgramName: string; nextProgramName: string }
): RenameButtonDocumentScopeResult {
  const rename: RenamedScope = {
    currentProgramName: requireName(args.currentProgramName, "Current program name"),
    nextProgramName: requireName(args.nextProgramName, "New program name")
  };
  const registeredPanelRenames = Object.values(document.buttons)
    .filter((button) =>
      button.role === "panel-owner" &&
      typeof button.metadata.programName === "string" &&
      namesMatch(button.metadata.programName, rename.currentProgramName) &&
      typeof button.metadata.panelName === "string"
    )
    .map((button): RenamedScope => ({
      ...rename,
      currentPanelName: button.metadata.panelName as string,
      nextPanelName: button.metadata.panelName as string
    }));
  const sourceResult = renameSourceScope(document, rename);
  const ownerResult = renameProgramPanelOwnerIdentities(document, {
    currentProgramName: rename.currentProgramName,
    nextProgramName: rename.nextProgramName
  });
  const mainPageProgramButtonChanged = renameFlowCellMainPageProgramButton(
    document,
    rename.currentProgramName,
    rename.nextProgramName
  );
  const surfaceNamesChanged = updateDefaultSurfaceNames(document, registeredPanelRenames);
  return {
    changed:
      sourceResult.changed ||
      ownerResult.changed ||
      mainPageProgramButtonChanged ||
      surfaceNamesChanged,
    sourceOwnerButtonIds: sourceResult.sourceOwnerButtonIds
  };
}

function defaultPanelSurfaceName(programName: string, panelName: string): string {
  return `${programName} / ${panelName}`;
}

function removeSourceScope(
  document: ButtonStateDocument,
  scope: ButtonDocumentScope
): RemoveButtonDocumentScopeResult {
  const sourceOwners = sourceOwnersInScope(document, scope);
  const graphIds = buttonGraphIds(document, sourceOwners);
  const surfaceIdsBefore = new Set(Object.keys(document.surfaces));
  const affectedPanelSurfaceIds = new Set<string>();
  for (const placement of Object.values(document.placements)) {
    if (
      graphIds.has(placement.buttonId) &&
      document.surfaces[placement.surfaceId]?.kind === "panel"
    ) {
      affectedPanelSurfaceIds.add(placement.surfaceId);
    }
  }
  for (const surface of Object.values(document.surfaces)) {
    if (surface.kind !== "panel" || surface.placementIds.length > 0) continue;
    if (
      scope.panelName !== undefined
        ? namesMatch(surface.name, defaultPanelSurfaceName(scope.programName, scope.panelName))
        : normalizeName(surface.name).startsWith(`${normalizeName(scope.programName)} \\ `)
    ) {
      affectedPanelSurfaceIds.add(surface.id);
    }
  }

  const removedButtonIds = new Set<string>();
  const uninstallOwnerButtonIds = new Set<string>();
  for (const owner of sourceOwners) {
    if (!document.buttons[owner.id]) continue;
    const result = removeOwnedButtonGraph(document, owner.id);
    result.removedButtonIds.forEach((id) => removedButtonIds.add(id));
    result.uninstallOwnerButtonIds.forEach((id) => uninstallOwnerButtonIds.add(id));
  }

  const panelOwnerResult = scope.panelName !== undefined
    ? removePanelOwnerGraph(document, scope.programName, scope.panelName)
    : removeProgramPanelOwnerGraphs(document, scope.programName);
  panelOwnerResult.removedOwnerButtonIds.forEach((id) => removedButtonIds.add(id));
  panelOwnerResult.uninstallOwnerButtonIds.forEach((id) => uninstallOwnerButtonIds.add(id));
  if (scope.panelName === undefined) {
    const mainPageProgramButtonId = removeFlowCellMainPageProgramButton(
      document,
      scope.programName
    );
    if (mainPageProgramButtonId) removedButtonIds.add(mainPageProgramButtonId);
  }

  for (const surfaceId of affectedPanelSurfaceIds) {
    const surface = document.surfaces[surfaceId];
    if (surface?.kind === "panel" && surface.placementIds.length === 0) {
      delete document.surfaces[surfaceId];
    }
  }
  const removedSurfaceIds = [...surfaceIdsBefore]
    .filter((surfaceId) => !document.surfaces[surfaceId])
    .sort();
  return {
    changed: removedButtonIds.size > 0 || removedSurfaceIds.length > 0,
    removedButtonIds: [...removedButtonIds].sort(),
    removedSurfaceIds,
    uninstallOwnerButtonIds: [...uninstallOwnerButtonIds].sort()
  };
}

export function removePanelButtonDocumentScope(
  document: ButtonStateDocument,
  args: { programName: string; panelName: string }
): RemoveButtonDocumentScopeResult {
  return removeSourceScope(document, {
    programName: requireName(args.programName, "Program name"),
    panelName: requireName(args.panelName, "Panel name")
  });
}

export function removeProgramButtonDocumentScope(
  document: ButtonStateDocument,
  args: { programName: string }
): RemoveButtonDocumentScopeResult {
  return removeSourceScope(document, {
    programName: requireName(args.programName, "Program name")
  });
}
