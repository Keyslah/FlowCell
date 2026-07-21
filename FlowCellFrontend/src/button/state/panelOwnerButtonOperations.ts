import type {
  ButtonPlacement,
  ButtonRecord,
  ButtonRect,
  ButtonStateDocument,
  ButtonSurface
} from "../types.js";
import { buttonRectsOverlap } from "../geometry/buttonGeometry.js";
import { removeOwnedButtonGraph } from "./buttonDocumentOperations.js";

export interface PanelOwnerRailEntry {
  panelName: string;
  rect: ButtonRect;
}

export interface ReconcileProgramPanelOwnersResult {
  changed: boolean;
  surfaceId: string | null;
  removedOwnerButtonIds: string[];
  uninstallOwnerButtonIds: string[];
  owners: Array<{
    panelName: string;
    buttonId: string;
    placementId: string;
  }>;
}

export interface RenamePanelOwnerIdentityResult {
  changed: boolean;
  ownerButtonId: string | null;
  fanSetupIds: string[];
}

export interface RenameProgramPanelOwnerIdentitiesResult {
  changed: boolean;
  ownerButtonIds: string[];
  fanSetupIds: string[];
}

export interface RemovePanelOwnerGraphsResult {
  changed: boolean;
  removedOwnerButtonIds: string[];
  removedSurfaceIds: string[];
  uninstallOwnerButtonIds: string[];
}

function normalizeName(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("en");
}

function namesMatch(left: string, right: string): boolean {
  return normalizeName(left) === normalizeName(right);
}

function requireName(value: string, label: string): string {
  const trimmed = value.normalize("NFC").trim();
  if (!trimmed) throw new Error(`${label} must not be empty.`);
  return trimmed;
}

function stableIdSegment(value: string): string {
  return Array.from(normalizeName(value))
    .map((character) => character.codePointAt(0)?.toString(16) ?? "0")
    .join("-") || "item";
}

/** Stable only for first materialization. Explicit renames retain the existing ID. */
export function initialPanelOwnerButtonId(programName: string, panelName: string): string {
  return `button-panel-owner-${stableIdSegment(programName)}-${stableIdSegment(panelName)}`;
}

/** Stable only for first materialization. Explicit renames retain the existing ID. */
export function initialPanelOwnerMainPlacementId(programName: string, panelName: string): string {
  return `placement-panel-owner-main-${stableIdSegment(programName)}-${stableIdSegment(panelName)}`;
}

/** Stable only for first materialization. Explicit renames retain the existing ID. */
export function initialProgramPanelOwnerSurfaceId(programName: string): string {
  return `surface-panel-owner-main-${stableIdSegment(programName)}`;
}

function panelOwnerIdentity(button: ButtonRecord): { programName: string; panelName: string } | null {
  if (button.role !== "panel-owner") return null;
  const programName = typeof button.metadata.programName === "string"
    ? button.metadata.programName.trim()
    : "";
  const panelName = typeof button.metadata.panelName === "string"
    ? button.metadata.panelName.trim()
    : "";
  return programName && panelName ? { programName, panelName } : null;
}

function matchingPanelOwners(
  document: ButtonStateDocument,
  programName: string,
  panelName?: string
): ButtonRecord[] {
  return Object.values(document.buttons)
    .filter((button) => {
      const identity = panelOwnerIdentity(button);
      return Boolean(
        identity &&
        namesMatch(identity.programName, programName) &&
        (panelName === undefined || namesMatch(identity.panelName, panelName))
      );
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function findPanelOwnerButton(
  document: ButtonStateDocument,
  programName: string,
  panelName: string
): ButtonRecord | null {
  return matchingPanelOwners(document, programName, panelName)[0] ?? null;
}

function exactPlacement(
  document: ButtonStateDocument,
  buttonId: string,
  predicate: (surface: ButtonSurface) => boolean
): ButtonPlacement | null {
  const placements = Object.values(document.placements)
    .filter((placement) => {
      const surface = document.surfaces[placement.surfaceId];
      return placement.buttonId === buttonId && Boolean(surface && predicate(surface));
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  return placements.length === 1 ? placements[0] : null;
}

export function resolvePanelOwnerMainPlacement(
  document: ButtonStateDocument,
  programName: string,
  panelName: string
): ButtonPlacement | null {
  const owner = findPanelOwnerButton(document, programName, panelName);
  return owner ? exactPlacement(document, owner.id, (surface) => surface.kind === "main") : null;
}

export function resolvePanelOwnerFanPlacement(
  document: ButtonStateDocument,
  fanSetupId: string
): ButtonPlacement | null {
  const setup = document.fanSetups[fanSetupId];
  if (!setup) return null;
  const surface = document.surfaces[setup.fanSurfaceId];
  if (!surface || surface.kind !== "fan") return null;
  const placements = surface.placementIds
    .map((placementId) => document.placements[placementId])
    .filter((placement): placement is ButtonPlacement => Boolean(
      placement &&
      placement.surfaceId === setup.fanSurfaceId &&
      placement.buttonId === setup.panelOwnerButtonId
    ));
  return placements.length === 1 ? placements[0] : null;
}

function assertUsableRect(rect: ButtonRect, panelName: string): void {
  if (
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    throw new Error(`Panel owner '${panelName}' requires finite geometry with positive dimensions.`);
  }
}

function nextAvailableMapId<T>(collection: Record<string, T>, preferredId: string): string {
  if (!collection[preferredId]) return preferredId;
  for (let index = 2; ; index += 1) {
    const candidate = `${preferredId}-${index}`;
    if (!collection[candidate]) return candidate;
  }
}

function defaultSurfaceName(programName: string): string {
  return `${programName} / Main Panel Rail`;
}

function mainPlacementsForOwner(
  document: ButtonStateDocument,
  ownerButtonId: string
): ButtonPlacement[] {
  return Object.values(document.placements)
    .filter((placement) =>
      placement.buttonId === ownerButtonId &&
      document.surfaces[placement.surfaceId]?.kind === "main"
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

function resolveProgramRailSurface(
  document: ButtonStateDocument,
  programName: string,
  owners: readonly ButtonRecord[],
  minimumWidth: number,
  minimumHeight: number
): { surface: ButtonSurface; changed: boolean } {
  const initialId = initialProgramPanelOwnerSurfaceId(programName);
  const surfaceCounts = new Map<string, number>();
  for (const owner of owners) {
    for (const placement of mainPlacementsForOwner(document, owner.id)) {
      surfaceCounts.set(placement.surfaceId, (surfaceCounts.get(placement.surfaceId) ?? 0) + 1);
    }
  }
  const ownerSurface = [...surfaceCounts.entries()]
    .map(([id, count]) => ({ surface: document.surfaces[id], count }))
    .filter((entry): entry is { surface: ButtonSurface; count: number } => Boolean(entry.surface))
    .sort((left, right) => right.count - left.count || left.surface.id.localeCompare(right.surface.id))[0]?.surface;
  const initialSurface = document.surfaces[initialId];
  const initialSurfaceMatchesProgram = Boolean(
    initialSurface?.kind === "main" &&
    initialSurface.placementIds.every((placementId) => {
      const placement = document.placements[placementId];
      const identity = placement ? panelOwnerIdentity(document.buttons[placement.buttonId]) : null;
      return Boolean(identity && namesMatch(identity.programName, programName));
    })
  );
  const existingSurface = ownerSurface ?? (initialSurfaceMatchesProgram ? initialSurface : undefined);
  if (existingSurface) {
    if (existingSurface.kind !== "main") {
      throw new Error(`Panel-owner surface '${existingSurface.id}' is not a main surface.`);
    }
    let changed = false;
    const width = Math.max(existingSurface.width, minimumWidth);
    const height = Math.max(existingSurface.height, minimumHeight);
    if (width !== existingSurface.width) {
      existingSurface.width = width;
      changed = true;
    }
    if (height !== existingSurface.height) {
      existingSurface.height = height;
      changed = true;
    }
    return { surface: existingSurface, changed };
  }
  const surface: ButtonSurface = {
    id: nextAvailableMapId(document.surfaces, initialId),
    name: defaultSurfaceName(programName),
    kind: "main",
    width: minimumWidth,
    height: minimumHeight,
    placementIds: [],
    visualOverflowAllowance: 24,
    uniformButtonSize: null
  };
  document.surfaces[surface.id] = surface;
  return { surface, changed: true };
}

function ensurePanelOwnerButton(
  document: ButtonStateDocument,
  programName: string,
  panelName: string
): { button: ButtonRecord; changed: boolean } {
  const matches = matchingPanelOwners(document, programName, panelName);
  if (matches.length > 1) {
    throw new Error(`Program '${programName}' has multiple panel-owner Buttons for '${panelName}'.`);
  }
  if (matches[0]) return { button: matches[0], changed: false };
  const id = nextAvailableMapId(
    document.buttons,
    initialPanelOwnerButtonId(programName, panelName)
  );
  const button: ButtonRecord = {
    id,
    role: "panel-owner",
    sourceIdentity: null,
    label: panelName,
    tooltip: `${programName} ${panelName} panel`,
    executionTarget: null,
    defaultSkinId: document.settings.defaultSkinId,
    defaultTextFitMode: "shrink-and-stack",
    disabled: false,
    activationAnimation: null,
    toolSetParentId: null,
    toolSetBehavior: null,
    metadata: { programName, panelName }
  };
  document.buttons[id] = button;
  return { button, changed: true };
}

function removePlacementReference(surface: ButtonSurface, placementId: string): boolean {
  const next = surface.placementIds.filter((id) => id !== placementId);
  if (next.length === surface.placementIds.length) return false;
  surface.placementIds = next;
  return true;
}

function ensurePanelOwnerMainPlacement(
  document: ButtonStateDocument,
  owner: ButtonRecord,
  surface: ButtonSurface,
  programName: string,
  panelName: string,
  rect: ButtonRect
): { placement: ButtonPlacement; changed: boolean; emptiedSurfaceIds: string[] } {
  const existingPlacements = mainPlacementsForOwner(document, owner.id);
  if (existingPlacements.length > 1) {
    throw new Error(`Panel-owner Button '${owner.id}' has multiple Main page placements.`);
  }
  const existing = existingPlacements[0];
  if (existing) {
    if (existing.surfaceId === surface.id) {
      if (!surface.placementIds.includes(existing.id)) {
        surface.placementIds.push(existing.id);
        return { placement: existing, changed: true, emptiedSurfaceIds: [] };
      }
      return { placement: existing, changed: false, emptiedSurfaceIds: [] };
    }
    const previousSurface = document.surfaces[existing.surfaceId];
    if (previousSurface) removePlacementReference(previousSurface, existing.id);
    existing.surfaceId = surface.id;
    if (!surface.placementIds.includes(existing.id)) surface.placementIds.push(existing.id);
    return {
      placement: existing,
      changed: true,
      emptiedSurfaceIds: previousSurface?.placementIds.length === 0 ? [previousSurface.id] : []
    };
  }
  const id = nextAvailableMapId(
    document.placements,
    initialPanelOwnerMainPlacementId(programName, panelName)
  );
  const placement: ButtonPlacement = {
    id,
    buttonId: owner.id,
    surfaceId: surface.id,
    ...rect,
    zIndex: surface.placementIds.length,
    skinOverrideId: null,
    textFitMode: owner.defaultTextFitMode,
    minimumFontSize: document.settings.defaultMinimumFontSize,
    textSizeOverride: null,
    allowLabelResize: false,
    matchHitboxToSkin: true,
    allowStretching: false,
    resizeAnchor: "top-left"
  };
  document.placements[id] = placement;
  surface.placementIds.push(id);
  return { placement, changed: true, emptiedSurfaceIds: [] };
}

function removeEmptyMainSurfaces(document: ButtonStateDocument, candidateIds: readonly string[]): string[] {
  const removed: string[] = [];
  for (const id of [...new Set(candidateIds)].sort()) {
    const surface = document.surfaces[id];
    if (surface?.kind === "main" && surface.placementIds.length === 0) {
      delete document.surfaces[id];
      removed.push(id);
    }
  }
  return removed;
}

function resolveNewPanelOwnerRect(
  document: ButtonStateDocument,
  surface: ButtonSurface,
  preferred: ButtonRect,
  railCandidates: readonly ButtonRect[]
): ButtonRect {
  const occupied = surface.placementIds.flatMap((placementId) => {
    const placement = document.placements[placementId];
    return placement && placement.surfaceId === surface.id ? [placement] : [];
  });
  const candidates = [preferred, ...railCandidates];
  for (const candidate of candidates) {
    if (!occupied.some((placement) => buttonRectsOverlap(candidate, placement))) {
      return { ...candidate };
    }
  }

  const horizontallyRelevant = occupied.filter((placement) =>
    preferred.x < placement.x + placement.width &&
    preferred.x + preferred.width > placement.x
  );
  const y = Math.max(
    preferred.y,
    ...horizontallyRelevant.map((placement) =>
      placement.y + placement.height + document.settings.defaultGap
    )
  );
  const appended = { ...preferred, y };
  surface.width = Math.max(
    surface.width,
    appended.x + appended.width + document.settings.defaultSurfacePadding
  );
  surface.height = Math.max(
    surface.height,
    appended.y + appended.height + document.settings.defaultSurfacePadding
  );
  return appended;
}

export function reconcileProgramPanelOwners(
  document: ButtonStateDocument,
  args: {
    programName: string;
    panels: readonly PanelOwnerRailEntry[];
    surfaceBounds?: { width: number; height: number };
    removeStaleOwners?: boolean;
  }
): ReconcileProgramPanelOwnersResult {
  const programName = requireName(args.programName, "Program name");
  const panels = args.panels.map((entry) => ({
    panelName: requireName(entry.panelName, "Panel name"),
    rect: { ...entry.rect }
  }));
  const seenPanels = new Set<string>();
  for (const entry of panels) {
    assertUsableRect(entry.rect, entry.panelName);
    const key = normalizeName(entry.panelName);
    if (seenPanels.has(key)) throw new Error(`Panel '${entry.panelName}' is listed more than once.`);
    seenPanels.add(key);
  }
  const desiredPanelNames = new Set(panels.map((entry) => normalizeName(entry.panelName)));
  const staleOwners = args.removeStaleOwners === false
    ? []
    : matchingPanelOwners(document, programName).filter((owner) => {
        const identity = panelOwnerIdentity(owner);
        return Boolean(identity && !desiredPanelNames.has(normalizeName(identity.panelName)));
      });
  const staleRemoval = removeOwnerButtons(document, staleOwners);
  if (panels.length === 0) {
    return {
      changed: staleRemoval.changed,
      surfaceId: null,
      removedOwnerButtonIds: staleRemoval.removedOwnerButtonIds,
      uninstallOwnerButtonIds: staleRemoval.uninstallOwnerButtonIds,
      owners: []
    };
  }

  const preexistingOwners = matchingPanelOwners(document, programName);
  const maximumRight = Math.max(...panels.map((entry) => entry.rect.x + entry.rect.width));
  const maximumBottom = Math.max(...panels.map((entry) => entry.rect.y + entry.rect.height));
  const minimumWidth = Math.max(args.surfaceBounds?.width ?? 0, maximumRight + document.settings.defaultSurfacePadding);
  const minimumHeight = Math.max(args.surfaceBounds?.height ?? 0, maximumBottom + document.settings.defaultSurfacePadding);
  const surfaceResult = resolveProgramRailSurface(
    document,
    programName,
    preexistingOwners,
    minimumWidth,
    minimumHeight
  );
  let changed = surfaceResult.changed || staleRemoval.changed;
  const results: ReconcileProgramPanelOwnersResult["owners"] = [];
  const emptiedSurfaceIds: string[] = [];
  const railCandidates = panels.map((entry) => entry.rect);
  for (const entry of panels) {
    const ownerResult = ensurePanelOwnerButton(document, programName, entry.panelName);
    const hasMainPlacement = mainPlacementsForOwner(document, ownerResult.button.id).length > 0;
    const placementRect = hasMainPlacement
      ? entry.rect
      : resolveNewPanelOwnerRect(
          document,
          surfaceResult.surface,
          entry.rect,
          railCandidates
        );
    const placementResult = ensurePanelOwnerMainPlacement(
      document,
      ownerResult.button,
      surfaceResult.surface,
      programName,
      entry.panelName,
      placementRect
    );
    changed ||= ownerResult.changed || placementResult.changed;
    emptiedSurfaceIds.push(...placementResult.emptiedSurfaceIds);
    results.push({
      panelName: entry.panelName,
      buttonId: ownerResult.button.id,
      placementId: placementResult.placement.id
    });
  }
  if (removeEmptyMainSurfaces(document, emptiedSurfaceIds).length > 0) changed = true;
  return {
    changed,
    surfaceId: surfaceResult.surface.id,
    removedOwnerButtonIds: staleRemoval.removedOwnerButtonIds,
    uninstallOwnerButtonIds: staleRemoval.uninstallOwnerButtonIds,
    owners: results
  };
}

function updateDefaultPanelPresentationForRename(
  button: ButtonRecord,
  currentProgramName: string,
  currentPanelName: string,
  nextProgramName: string,
  nextPanelName: string
): boolean {
  let changed = false;
  if (namesMatch(button.label, currentPanelName) && button.label !== nextPanelName) {
    button.label = nextPanelName;
    changed = true;
  }
  const defaultTooltips = [
    `${currentProgramName} ${currentPanelName} panel`,
    `${currentProgramName} ${currentPanelName} fan`
  ];
  const nextTooltip = `${nextProgramName} ${nextPanelName} panel`;
  if (
    defaultTooltips.some((tooltip) => namesMatch(button.tooltip, tooltip)) &&
    button.tooltip !== nextTooltip
  ) {
    button.tooltip = nextTooltip;
    changed = true;
  }
  return changed;
}

export function renamePanelOwnerIdentity(
  document: ButtonStateDocument,
  args: {
    programName: string;
    currentPanelName: string;
    nextPanelName: string;
  }
): RenamePanelOwnerIdentityResult {
  const programName = requireName(args.programName, "Program name");
  const currentPanelName = requireName(args.currentPanelName, "Current panel name");
  const nextPanelName = requireName(args.nextPanelName, "New panel name");
  const owner = findPanelOwnerButton(document, programName, currentPanelName);
  if (!owner) return { changed: false, ownerButtonId: null, fanSetupIds: [] };
  const conflict = findPanelOwnerButton(document, programName, nextPanelName);
  if (conflict && conflict.id !== owner.id) {
    throw new Error(`Panel-owner Button '${nextPanelName}' already exists for '${programName}'.`);
  }
  let changed = updateDefaultPanelPresentationForRename(
    owner,
    programName,
    currentPanelName,
    programName,
    nextPanelName
  );
  if (owner.metadata.programName !== programName || owner.metadata.panelName !== nextPanelName) {
    owner.metadata = { ...owner.metadata, programName, panelName: nextPanelName };
    changed = true;
  }
  const fanSetupIds: string[] = [];
  for (const setup of Object.values(document.fanSetups)) {
    if (setup.panelOwnerButtonId !== owner.id) continue;
    fanSetupIds.push(setup.id);
    if (setup.programName !== programName || setup.panelName !== nextPanelName) {
      setup.programName = programName;
      setup.panelName = nextPanelName;
      changed = true;
    }
  }
  return { changed, ownerButtonId: owner.id, fanSetupIds: fanSetupIds.sort() };
}

export function renameProgramPanelOwnerIdentities(
  document: ButtonStateDocument,
  args: { currentProgramName: string; nextProgramName: string }
): RenameProgramPanelOwnerIdentitiesResult {
  const currentProgramName = requireName(args.currentProgramName, "Current program name");
  const nextProgramName = requireName(args.nextProgramName, "New program name");
  const owners = matchingPanelOwners(document, currentProgramName);
  for (const owner of owners) {
    const identity = panelOwnerIdentity(owner)!;
    const conflict = findPanelOwnerButton(document, nextProgramName, identity.panelName);
    if (conflict && conflict.id !== owner.id) {
      throw new Error(`Panel-owner Button '${identity.panelName}' already exists for '${nextProgramName}'.`);
    }
  }
  let changed = false;
  const fanSetupIds = new Set<string>();
  const mainSurfaceIds = new Set<string>();
  for (const owner of owners) {
    const identity = panelOwnerIdentity(owner)!;
    changed = updateDefaultPanelPresentationForRename(
      owner,
      currentProgramName,
      identity.panelName,
      nextProgramName,
      identity.panelName
    ) || changed;
    if (owner.metadata.programName !== nextProgramName) {
      owner.metadata = { ...owner.metadata, programName: nextProgramName };
      changed = true;
    }
    for (const placement of mainPlacementsForOwner(document, owner.id)) {
      mainSurfaceIds.add(placement.surfaceId);
    }
    for (const setup of Object.values(document.fanSetups)) {
      if (setup.panelOwnerButtonId !== owner.id) continue;
      fanSetupIds.add(setup.id);
      if (setup.programName !== nextProgramName) {
        setup.programName = nextProgramName;
        changed = true;
      }
    }
  }
  for (const surfaceId of mainSurfaceIds) {
    const surface = document.surfaces[surfaceId];
    const nextSurfaceName = defaultSurfaceName(nextProgramName);
    if (
      surface &&
      namesMatch(surface.name, defaultSurfaceName(currentProgramName)) &&
      surface.name !== nextSurfaceName
    ) {
      surface.name = nextSurfaceName;
      changed = true;
    }
  }
  return {
    changed,
    ownerButtonIds: owners.map((owner) => owner.id).sort(),
    fanSetupIds: [...fanSetupIds].sort()
  };
}

function removeOwnerButtons(
  document: ButtonStateDocument,
  owners: readonly ButtonRecord[]
): RemovePanelOwnerGraphsResult {
  const mainSurfaceIds = owners.flatMap((owner) =>
    mainPlacementsForOwner(document, owner.id).map((placement) => placement.surfaceId)
  );
  const removedOwnerButtonIds: string[] = [];
  const uninstallOwnerButtonIds: string[] = [];
  for (const owner of owners) {
    if (!document.buttons[owner.id]) continue;
    const result = removeOwnedButtonGraph(document, owner.id);
    if (result.removedButtonIds.includes(owner.id)) removedOwnerButtonIds.push(owner.id);
    uninstallOwnerButtonIds.push(...result.uninstallOwnerButtonIds);
  }
  const removedSurfaceIds = removeEmptyMainSurfaces(document, mainSurfaceIds);
  return {
    changed: removedOwnerButtonIds.length > 0 || removedSurfaceIds.length > 0,
    removedOwnerButtonIds: removedOwnerButtonIds.sort(),
    removedSurfaceIds,
    uninstallOwnerButtonIds: [...new Set(uninstallOwnerButtonIds)].sort()
  };
}

export function removePanelOwnerGraph(
  document: ButtonStateDocument,
  programName: string,
  panelName: string
): RemovePanelOwnerGraphsResult {
  const owner = findPanelOwnerButton(document, programName, panelName);
  return removeOwnerButtons(document, owner ? [owner] : []);
}

export function removeProgramPanelOwnerGraphs(
  document: ButtonStateDocument,
  programName: string
): RemovePanelOwnerGraphsResult {
  return removeOwnerButtons(document, matchingPanelOwners(document, programName));
}
