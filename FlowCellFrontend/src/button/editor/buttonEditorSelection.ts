import type {
  ButtonPlacement,
  ButtonStateDocument,
  ButtonSurface
} from "../types.js";
import { resolvePanelOwnerMainPlacement } from "../state/panelOwnerButtonOperations.js";

export interface ButtonEditorIdentity {
  programName: string;
  panelName: string;
}

export interface ButtonEditorButtonOption {
  id: string;
  label: string;
  group: string;
}

export interface ButtonEditorFanCandidate {
  id: string;
  label: string;
  role: "single-script" | "tool-set-owner";
}

export interface ButtonEditorPlacementOption {
  id: string;
  label: string;
  surfaceId: string;
  action?: "create-default-fan" | "show-tool-set-popout";
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
  return uniqueSortedNames([...registeredPrograms, ...documentPrograms, ...fanPrograms]);
}

export function buildButtonEditorPanelOptions(
  document: ButtonStateDocument,
  programName: string,
  registeredPanels: readonly string[]
): string[] {
  if (!programName.trim()) return [];
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
  if (button?.role === "tool-set-child") {
    const owner = button.toolSetParentId ? document.buttons[button.toolSetParentId] : null;
    const ownerLabel = owner?.label.trim() || "Tool Set";
    return { label: `${label} — ${ownerLabel}`, group: `Tool Set — ${ownerLabel}` };
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
  const candidates = Object.values(document.buttons).filter((button) => {
    if (!placedButtonIds.has(button.id)) return false;
    const identity = resolveButtonEditorIdentity(document, button.id);
    return Boolean(
      identity &&
      namesMatch(identity.programName, programName) &&
      namesMatch(identity.panelName, panelName)
    );
  });
  const bases = new Map(candidates.map((button) => [button.id, buttonOptionBaseLabel(document, button.id)]));
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

export function buildButtonEditorFanCandidates(
  document: ButtonStateDocument,
  programName: string,
  panelName: string
): ButtonEditorFanCandidate[] {
  return buildButtonEditorButtonOptions(document, programName, panelName)
    .flatMap((option) => {
      const role = document.buttons[option.id]?.role;
      return role === "single-script" || role === "tool-set-owner"
        ? [{ id: option.id, label: option.label, role }]
        : [];
    })
    .sort((left, right) =>
      (left.role === "single-script" ? 0 : 1) - (right.role === "single-script" ? 0 : 1) ||
      left.label.localeCompare(right.label, "en", { sensitivity: "base" }) ||
      left.id.localeCompare(right.id)
    );
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
  if (surface.kind === "main" || surface.kind === "panel") return "Main page";
  if (surface.kind === "fan") {
    const setup = Object.values(document.fanSetups).find(
      (candidate) => candidate.fanSurfaceId === surface.id
    );
    return `Fan — ${setup?.name || surface.name}`;
  }
  const unit = Object.values(document.popoutUnits).find(
    (candidate) => candidate.surfaceId === surface.id
  );
  return `Pop — ${unit?.name || surface.name}`;
}

export function buildButtonEditorPlacementOptions(
  document: ButtonStateDocument,
  buttonId: string
): ButtonEditorPlacementOption[] {
  if (!buttonId) return [];
  const placements = Object.values(document.placements)
    .filter((placement) =>
      placement.buttonId === buttonId &&
      document.surfaces[placement.surfaceId]
    )
    .sort((left, right) => comparePlacements(document, left, right));
  const baseLabels = new Map(placements.map((placement) => [placement.id, placementBaseLabel(document, placement)]));
  const labelCounts = new Map<string, number>();
  for (const label of baseLabels.values()) {
    const key = normalized(label);
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  }

  const options: ButtonEditorPlacementOption[] = placements.map((placement) => {
    const base = baseLabels.get(placement.id)!;
    const duplicate = (labelCounts.get(normalized(base)) ?? 0) > 1;
    const surface = document.surfaces[placement.surfaceId];
    const surfaceDetail = surface?.name && !namesMatch(surface.name, base)
      ? surface.name
      : shortId(placement.id);
    return {
      id: placement.id,
      label: duplicate ? `${base} — ${surfaceDetail}` : base,
      surfaceId: placement.surfaceId
    };
  });
  const button = document.buttons[buttonId];
  const hasFanPlacement = placements.some(
    (placement) => document.surfaces[placement.surfaceId]?.kind === "fan"
  );
  if (button?.role === "panel-owner" && !hasFanPlacement) {
    options.push({
      id: `button-editor-action:create-default-fan:${button.id}`,
      label: "Fan — Default grid",
      surfaceId: "",
      action: "create-default-fan"
    });
  }
  if (button?.role === "tool-set-owner") {
    const toolSetUnit = Object.values(document.popoutUnits).find(
      (candidate) => candidate.kind === "tool-set" && candidate.ownerButtonId === button.id
    );
    const toolSetSurface = toolSetUnit ? document.surfaces[toolSetUnit.surfaceId] : undefined;
    if (toolSetUnit && toolSetSurface) {
      options.push({
        id: `button-editor-action:show-tool-set-popout:${button.id}`,
        label: `Pop — ${toolSetUnit.name || toolSetSurface.name}`,
        surfaceId: toolSetSurface.id,
        action: "show-tool-set-popout"
      });
    }
  }
  options.sort((left, right) => {
    const leftRank = left.action === "create-default-fan"
      ? 1
      : surfacePlacementRank(document.surfaces[left.surfaceId]);
    const rightRank = right.action === "create-default-fan"
      ? 1
      : surfacePlacementRank(document.surfaces[right.surfaceId]);
    return leftRank - rightRank;
  });
  return disambiguateFinalOptionLabels(options);
}

export function resolveButtonEditorDefaultFanMembers(
  document: ButtonStateDocument,
  programName: string,
  panelName: string
) {
  return Object.values(document.buttons).filter((button) => {
    if (button.role !== "single-script") return false;
    const identity = resolveButtonEditorIdentity(document, button.id);
    return Boolean(
      identity &&
      namesMatch(identity.programName, programName) &&
      namesMatch(identity.panelName, panelName)
    );
  });
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
  const buttonId = context.buttonId || fanSetup?.panelOwnerButtonId;
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
