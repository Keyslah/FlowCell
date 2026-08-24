import type {
  ButtonPlacement,
  ButtonStateDocument,
  ButtonSurface
} from "../types.js";
import { resolvePanelOwnerMainPlacement } from "../state/panelOwnerButtonOperations.js";
import {
  buttonSettingsPlacementKind,
  buttonSettingsPlacementLabel
} from "../state/buttonSettingsFile.js";
import {
  FLOWCELL_MAIN_PAGE_PROGRAM,
  FLOWCELL_MAIN_PAGE_SECTIONS,
  flowCellMainPageSurfaceId,
  isFlowCellMainPageProgram
} from "../state/mainPageButtonOperations.js";

export interface ButtonEditorIdentity {
  programName: string;
  panelName: string;
}

export interface ButtonEditorButtonOption {
  id: string;
  label: string;
  group: string;
}

export interface ButtonEditorPlacementOption {
  id: string;
  label: string;
  surfaceId: string;
  placementId: string | null;
  view: "placement" | "tool-set-popout" | "default-popout";
}

function normalized(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("en");
}

function namesMatch(left: string, right: string): boolean {
  return normalized(left) === normalized(right);
}

function nonemptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function shortId(value: string): string {
  const compact = value.replace(/[^a-zA-Z0-9]/g, "");
  return compact.slice(-8) || value.slice(-8);
}

function uniqueStableIdSuffixes(ids: readonly string[]): Map<string, string> {
  const uniqueIds = [...new Set(ids)].sort((left, right) => left.localeCompare(right));
  const maximumLength = Math.max(1, ...uniqueIds.map((id) => id.length));
  for (let length = Math.min(8, maximumLength); length <= maximumLength; length += 1) {
    const suffixes = uniqueIds.map((id) => id.slice(-length) || id);
    if (new Set(suffixes).size === uniqueIds.length) {
      return new Map(uniqueIds.map((id, index) => [id, suffixes[index]]));
    }
  }
  return new Map(uniqueIds.map((id) => [id, id]));
}

function disambiguateFinalOptionLabels<T extends { id: string; label: string }>(
  options: readonly T[]
): T[] {
  const labelGroups = new Map<string, T[]>();
  for (const option of options) {
    const key = normalized(option.label);
    const group = labelGroups.get(key) ?? [];
    group.push(option);
    labelGroups.set(key, group);
  }
  const suffixes = new Map<string, string>();
  for (const group of labelGroups.values()) {
    if (group.length < 2) continue;
    for (const [id, suffix] of uniqueStableIdSuffixes(group.map((option) => option.id))) {
      suffixes.set(id, suffix);
    }
  }
  return options.map((option) => {
    const suffix = suffixes.get(option.id);
    return suffix ? { ...option, label: `${option.label} — ${suffix}` } : option;
  });
}

export function resolveButtonEditorIdentity(
  document: ButtonStateDocument,
  buttonId: string,
  visited: ReadonlySet<string> = new Set()
): ButtonEditorIdentity | null {
  if (visited.has(buttonId)) return null;
  const button = document.buttons[buttonId];
  if (!button) return null;

  const mainPageProgram = button.metadata.mainPageControl === true
    ? nonemptyString(button.metadata.mainPageProgram)
    : null;
  const mainPageSection = button.metadata.mainPageControl === true
    ? nonemptyString(button.metadata.mainPageSection)
    : null;
  if (mainPageProgram && mainPageSection) {
    return { programName: mainPageProgram, panelName: mainPageSection };
  }

  if (button.sourceIdentity) {
    return {
      programName: button.sourceIdentity.displayProgramName,
      panelName: button.sourceIdentity.displayPanelName
    };
  }

  if (button.role === "tool-set-child" && button.toolSetParentId) {
    return resolveButtonEditorIdentity(
      document,
      button.toolSetParentId,
      new Set([...visited, buttonId])
    );
  }

  const metadataProgram = nonemptyString(button.metadata.programName);
  const metadataPanel = nonemptyString(button.metadata.panelName);
  if (metadataProgram && metadataPanel) {
    return { programName: metadataProgram, panelName: metadataPanel };
  }

  const setup = Object.values(document.fanSetups).find(
    (candidate) => candidate.panelOwnerButtonId === buttonId
  );
  if (setup) {
    return { programName: setup.programName, panelName: setup.panelName };
  }

  const target = button.executionTarget;
  if (target?.kind === "panel-script" || target?.kind === "tool-set-action") {
    return { programName: target.programName, panelName: target.panelName };
  }

  return null;
}

export function resolveButtonEditorSurfaceIdentity(
  document: ButtonStateDocument,
  surfaceId: string
): ButtonEditorIdentity | null {
  const setup = Object.values(document.fanSetups).find(
    (candidate) => candidate.fanSurfaceId === surfaceId
  );
  if (setup) return { programName: setup.programName, panelName: setup.panelName };

  const surface = document.surfaces[surfaceId];
  if (!surface) return null;
  const placementIds = [...surface.placementIds].sort((left, right) => left.localeCompare(right));
  for (const placementId of placementIds) {
    const placement = document.placements[placementId];
    if (!placement) continue;
    const identity = resolveButtonEditorIdentity(document, placement.buttonId);
    if (identity) return identity;
  }
  return null;
}

function uniqueSortedNames(values: readonly string[]): string[] {
  const names = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalized(trimmed);
    if (!names.has(key)) names.set(key, trimmed);
  }
  return [...names.values()].sort((left, right) =>
    left.localeCompare(right, "en", { sensitivity: "base" })
  );
}

export function buildButtonEditorProgramOptions(
  document: ButtonStateDocument,
  registeredPrograms: readonly string[]
): string[] {
  const documentPrograms = Object.values(document.buttons)
    .map((button) => resolveButtonEditorIdentity(document, button.id)?.programName ?? "");
  const fanPrograms = Object.values(document.fanSetups).map((setup) => setup.programName);
  const programs = uniqueSortedNames([...registeredPrograms, ...documentPrograms, ...fanPrograms]);
  return [
    FLOWCELL_MAIN_PAGE_PROGRAM,
    ...programs.filter((program) => !namesMatch(program, FLOWCELL_MAIN_PAGE_PROGRAM))
  ];
}

export function buildButtonEditorPanelOptions(
  document: ButtonStateDocument,
  programName: string,
  registeredPanels: readonly string[]
): string[] {
  if (!programName.trim()) return [];
  if (isFlowCellMainPageProgram(programName)) {
    return [...FLOWCELL_MAIN_PAGE_SECTIONS];
  }
  const documentPanels = Object.values(document.buttons).flatMap((button) => {
    const identity = resolveButtonEditorIdentity(document, button.id);
    return identity && namesMatch(identity.programName, programName) ? [identity.panelName] : [];
  });
  const fanPanels = Object.values(document.fanSetups).flatMap((setup) =>
    namesMatch(setup.programName, programName) ? [setup.panelName] : []
  );
  return uniqueSortedNames([...registeredPanels, ...documentPanels, ...fanPanels]);
}

function buttonOptionBaseLabel(
  document: ButtonStateDocument,
  buttonId: string
): { label: string; group: string } {
  const button = document.buttons[buttonId];
  const label = button?.label.trim() || buttonId;
  if (
    button?.metadata.mainPageControl === true &&
    nonemptyString(button.metadata.mainPageControlKey)
  ) {
    return { label, group: "Main Page Buttons" };
  }
  if (button?.role === "panel-owner") {
    return { label: `${label} — Panel Button`, group: "Panel rail" };
  }
  return { label, group: "Panel Buttons" };
}

export function buildButtonEditorButtonOptions(
  document: ButtonStateDocument,
  programName: string,
  panelName: string
): ButtonEditorButtonOption[] {
  if (!programName.trim() || !panelName.trim()) return [];
  const placedButtonIds = new Set(Object.values(document.placements).map((placement) => placement.buttonId));
  const mainPagePanelRail = isFlowCellMainPageProgram(programName) &&
    namesMatch(panelName, "Panel Rail");
  const candidates = Object.values(document.buttons).filter((button) => {
    if (!placedButtonIds.has(button.id)) return false;
    if (button.role === "tool-set-child") return false;
    if (mainPagePanelRail) {
      const isActualPanelButton = button.role === "panel-owner" &&
        nonemptyString(button.metadata.programName) &&
        nonemptyString(button.metadata.panelName) &&
        !nonemptyString(button.metadata.mainPageProgram);
      const isAddPanelButton =
        button.metadata.mainPageControl === true &&
        namesMatch(String(button.metadata.mainPageProgram ?? ""), FLOWCELL_MAIN_PAGE_PROGRAM) &&
        namesMatch(String(button.metadata.mainPageControlKey ?? ""), "panel-add");
      return Boolean(isActualPanelButton || isAddPanelButton);
    }
    const identity = resolveButtonEditorIdentity(document, button.id);
    return Boolean(
      identity &&
      namesMatch(identity.programName, programName) &&
      namesMatch(identity.panelName, panelName)
    );
  });
  const bases = new Map(candidates.map((button) => [button.id, buttonOptionBaseLabel(document, button.id)]));
  if (mainPagePanelRail) {
    for (const button of candidates) {
      const ownerProgram = nonemptyString(button.metadata.programName);
      const ownerPanel = nonemptyString(button.metadata.panelName);
      if (ownerProgram && ownerPanel) {
        bases.set(button.id, { label: button.label.trim() || ownerPanel, group: ownerProgram });
      } else {
        bases.set(button.id, { label: button.label.trim() || "Add Panel", group: "Panel Rail Controls" });
      }
    }
  }
  const labelCounts = new Map<string, number>();
  for (const base of bases.values()) {
    const key = normalized(base.label);
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  }

  const options = candidates
    .map((button) => {
      const base = bases.get(button.id)!;
      const duplicate = (labelCounts.get(normalized(base.label)) ?? 0) > 1;
      const detail = button.sourceIdentity?.displayFileName || shortId(button.id);
      return {
        id: button.id,
        label: duplicate ? `${base.label} — ${detail}` : base.label,
        group: base.group
      };
    })
    .sort((left, right) =>
      left.group.localeCompare(right.group, "en", { sensitivity: "base" }) ||
      left.label.localeCompare(right.label, "en", { sensitivity: "base" }) ||
      left.id.localeCompare(right.id)
    );
  return disambiguateFinalOptionLabels(options);
}

function surfacePlacementRank(surface: ButtonSurface): number {
  if (surface.kind === "panel" || surface.kind === "main") return 0;
  if (surface.kind === "fan") return 1;
  return 2;
}

function comparePlacements(
  document: ButtonStateDocument,
  left: ButtonPlacement,
  right: ButtonPlacement
): number {
  const leftSurface = document.surfaces[left.surfaceId];
  const rightSurface = document.surfaces[right.surfaceId];
  return (leftSurface ? surfacePlacementRank(leftSurface) : Number.MAX_SAFE_INTEGER) -
      (rightSurface ? surfacePlacementRank(rightSurface) : Number.MAX_SAFE_INTEGER) ||
    left.zIndex - right.zIndex ||
    left.y - right.y ||
    left.x - right.x ||
    left.id.localeCompare(right.id);
}

function placementBaseLabel(document: ButtonStateDocument, placement: ButtonPlacement): string {
  const surface = document.surfaces[placement.surfaceId];
  if (!surface) return "Missing placement surface";
  return buttonSettingsPlacementLabel(buttonSettingsPlacementKind(surface));
}

export function buildButtonEditorPlacementOptions(
  document: ButtonStateDocument,
  buttonId: string,
  preferredSurfaceId?: string | null
): ButtonEditorPlacementOption[] {
  if (!buttonId) return [];
  const button = document.buttons[buttonId];
  const matchingToolSetUnit = button?.role === "tool-set-owner"
    ? Object.values(document.popoutUnits).find(
        (candidate) => candidate.kind === "tool-set" && candidate.ownerButtonId === buttonId
      )
    : undefined;
  const toolSetUnit = matchingToolSetUnit?.kind === "tool-set"
    ? matchingToolSetUnit
    : undefined;
  const placements = Object.values(document.placements)
    .filter((placement) =>
      placement.buttonId === buttonId &&
      document.surfaces[placement.surfaceId] &&
      document.surfaces[placement.surfaceId].kind !== "fan" &&
      placement.surfaceId !== toolSetUnit?.surfaceId
    )
    .sort((left, right) => comparePlacements(document, left, right));
  const baseLabels = new Map(placements.map((placement) => [placement.id, placementBaseLabel(document, placement)]));
  const options: ButtonEditorPlacementOption[] = placements.map((placement) => {
    const base = baseLabels.get(placement.id)!;
    return {
      id: placement.id,
      label: base,
      surfaceId: placement.surfaceId,
      placementId: placement.id,
      view: "placement" as const
    };
  });
  options.sort((left, right) => {
    const leftRank = surfacePlacementRank(document.surfaces[left.surfaceId]);
    const rightRank = surfacePlacementRank(document.surfaces[right.surfaceId]);
    return leftRank - rightRank;
  });
  const toolSetSurface = toolSetUnit
    ? document.surfaces[toolSetUnit.surfaceId]
    : undefined;
  if (toolSetUnit && toolSetSurface) {
    const firstChildPlacementId = toolSetUnit.childPlacementIds.find((placementId) =>
      document.placements[placementId]?.surfaceId === toolSetSurface.id
    ) ?? null;
    const ownerPlacementId = toolSetUnit.ownerPlacementId &&
      document.placements[toolSetUnit.ownerPlacementId]?.surfaceId === toolSetSurface.id
        ? toolSetUnit.ownerPlacementId
        : null;
    options.push({
      id: `button-editor-tool-set-popout:${toolSetUnit.id}`,
      label: "Pop-out",
      surfaceId: toolSetSurface.id,
      placementId: toolSetUnit.interactionMode === "fan" && ownerPlacementId
        ? ownerPlacementId
        : firstChildPlacementId,
      view: "tool-set-popout"
    });
  }

  const popoutOptions = options.filter((option) =>
    buttonSettingsPlacementKind(document.surfaces[option.surfaceId]) === "pop-out"
  );
  const preferredPopoutOption = preferredSurfaceId
    ? popoutOptions.find((option) => option.surfaceId === preferredSurfaceId)
    : undefined;
  const canonicalPopoutOption = preferredPopoutOption ??
    popoutOptions.find((option) => option.view === "tool-set-popout") ??
    popoutOptions[0];
  const collapsedOptions = options.filter((option) =>
    buttonSettingsPlacementKind(document.surfaces[option.surfaceId]) !== "pop-out" ||
    option.id === canonicalPopoutOption?.id
  );
  const sourceSurfaceId = placements[0]?.surfaceId;
  if (
    !canonicalPopoutOption &&
    sourceSurfaceId &&
    button?.role === "single-script" &&
    button.sourceIdentity
  ) {
    collapsedOptions.push({
      id: `button-editor-default-popout:${button.id}`,
      label: "Pop-out",
      surfaceId: sourceSurfaceId,
      placementId: null,
      view: "default-popout"
    });
  }
  return collapsedOptions;
}

export function resolveButtonEditorNavigationButtonId(
  document: ButtonStateDocument,
  buttonId: string
): string {
  const button = document.buttons[buttonId];
  if (
    button?.role === "tool-set-child" &&
    button.toolSetParentId &&
    document.buttons[button.toolSetParentId]?.role === "tool-set-owner"
  ) {
    return button.toolSetParentId;
  }
  return buttonId;
}

export function resolvePreferredButtonPlacementId(
  document: ButtonStateDocument,
  buttonId: string,
  preferredSurfaceId?: string | null
): string | null {
  const placements = Object.values(document.placements)
    .filter((placement) => placement.buttonId === buttonId && document.surfaces[placement.surfaceId])
    .sort((left, right) => comparePlacements(document, left, right));
  if (preferredSurfaceId) {
    const preferred = placements.find((placement) => placement.surfaceId === preferredSurfaceId);
    if (preferred) return preferred.id;
  }
  return placements[0]?.id ?? null;
}

export function resolveButtonEditorContextPlacementId(
  document: ButtonStateDocument,
  context: { buttonId?: string; surfaceId?: string }
): string | null {
  const fanSetup = context.surfaceId
    ? Object.values(document.fanSetups).find(
        (candidate) => candidate.fanSurfaceId === context.surfaceId
      )
    : undefined;
  const matchingSurfaceToolSetUnit = context.surfaceId
    ? Object.values(document.popoutUnits).find(
        (candidate) => candidate.kind === "tool-set" && candidate.surfaceId === context.surfaceId
      )
    : undefined;
  const surfaceToolSetUnit = matchingSurfaceToolSetUnit?.kind === "tool-set"
    ? matchingSurfaceToolSetUnit
    : undefined;
  const buttonId = context.buttonId || fanSetup?.panelOwnerButtonId || surfaceToolSetUnit?.ownerButtonId;
  const button = buttonId ? document.buttons[buttonId] : undefined;
  const matchingToolSetUnit = button?.role === "tool-set-owner" &&
    surfaceToolSetUnit?.ownerButtonId === button.id
      ? surfaceToolSetUnit
      : undefined;
  const toolSetUnit = matchingToolSetUnit?.kind === "tool-set"
    ? matchingToolSetUnit
    : undefined;
  if (toolSetUnit) {
    const ownerPlacementId = toolSetUnit.ownerPlacementId?.trim();
    if (
      toolSetUnit.interactionMode === "fan" &&
      ownerPlacementId &&
      document.placements[ownerPlacementId]?.surfaceId === toolSetUnit.surfaceId
    ) {
      return ownerPlacementId;
    }
    return toolSetUnit.childPlacementIds.find((placementId) =>
      document.placements[placementId]?.surfaceId === toolSetUnit.surfaceId
    ) ?? null;
  }
  return buttonId
    ? resolvePreferredButtonPlacementId(document, buttonId, context.surfaceId)
    : null;
}

export function resolveButtonEditorPanelSurfaceId(
  document: ButtonStateDocument,
  programName: string,
  panelName: string
): string | null {
  if (!programName.trim() || !panelName.trim()) return null;
  if (isFlowCellMainPageProgram(programName)) {
    return flowCellMainPageSurfaceId(panelName);
  }
  const expectedName = `${programName} / ${panelName}`;
  const candidates = Object.values(document.surfaces).flatMap((surface) => {
    if (surface.kind !== "panel") return [];
    const identities = surface.placementIds.flatMap((placementId) => {
      const placement = document.placements[placementId];
      const identity = placement
        ? resolveButtonEditorIdentity(document, placement.buttonId)
        : null;
      return identity ? [identity] : [];
    });
    const matchingCount = identities.filter((identity) =>
      namesMatch(identity.programName, programName) && namesMatch(identity.panelName, panelName)
    ).length;
    const allMatching = matchingCount > 0 && matchingCount === identities.length;
    const exactName = namesMatch(surface.name, expectedName);
    if (!matchingCount && !exactName) return [];
    return [{
      id: surface.id,
      rank: allMatching ? 0 : exactName ? 1 : 2
    }];
  });
  const panelSurfaceId = candidates
    .sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id))[0]?.id;
  if (panelSurfaceId) return panelSurfaceId;
  return resolvePanelOwnerMainPlacement(document, programName, panelName)?.surfaceId ?? null;
}

export function resolveButtonEditorSurfaceSkinTargetPlacementIds(
  document: ButtonStateDocument,
  focusedPlacementId: string
): string[] {
  const focusedPlacement = document.placements[focusedPlacementId];
  const surface = focusedPlacement
    ? document.surfaces[focusedPlacement.surfaceId]
    : null;
  if (!focusedPlacement || !surface) return [];
  return surface.placementIds.filter(
    (placementId) => document.placements[placementId]?.surfaceId === surface.id
  );
}
