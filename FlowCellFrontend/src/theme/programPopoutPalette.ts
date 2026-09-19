import { cloneButtonDocument } from "../button/state/buttonDefaults.js";
import {
  buttonSkinOpaqueColor,
  collectButtonSkinProfileColors,
  collectButtonSkinSurfaceThemeFallbackColors,
  buttonSkinSurfaceThemeVariable,
  normalizeButtonSkinColor
} from "../button/skins/buttonSkinColors.js";
import type {
  ButtonPlacement,
  ButtonRect,
  ButtonSkin,
  ButtonStateDocument
} from "../button/types.js";
import type { FlowCellBounds } from "../types.js";
import {
  buttonThemeOverrideIsEmpty,
  emptyButtonThemeOverride,
  gradientPositionForPlacement,
  interpolateThemeColor,
  placementMatchesThemeTarget,
  themePlacementDeployedCenterY,
  type ThemeTarget
} from "./themeModel.js";

export interface ProgramPopoutPaletteAssignment {
  placementId: string;
  color: string | null;
  materialColors?: string[];
}

export interface ProgramPopoutPaletteScan {
  placements: ProgramPopoutPaletteAssignment[];
  buttonCount: number;
  colorCount: number;
}

export interface ProgramPopoutPaletteApplyResult extends ProgramPopoutPaletteScan {
  document: ButtonStateDocument;
  changedCount: number;
}

export type ProgramPopoutTextColor = "#000000" | "#FFFFFF";

export interface ProgramPopoutPaletteGradient {
  colors: string[];
  spread: number;
  scatter: number;
  seed: number;
}

export interface ProgramPopoutPaletteTarget {
  paletteId: string;
  placementId: string;
}

export interface ProgramPopoutPaletteGradientItem {
  paletteId: string;
  y: number;
}

export interface ProgramPopoutPaletteGradientRange {
  minimumY: number;
  maximumY: number;
}

export interface ProgramPopoutPaletteScreenPositionArgs {
  items: readonly ProgramPopoutPaletteGradientItem[];
  visibleBounds: Pick<FlowCellBounds, "Top" | "Height">;
  envelope: Pick<ButtonRect, "y" | "height">;
  monitorWorkArea: Pick<FlowCellBounds, "Top" | "Height">;
}

function normalizedOpaqueColor(value: string | null | undefined): string | null {
  const normalized = normalizeButtonSkinColor(value ?? "");
  return normalized ? buttonSkinOpaqueColor(normalized)?.toUpperCase() ?? null : null;
}

function declaredCssVariableColor(skin: ButtonSkin, variable: string): string | null {
  const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[;{])\\s*${escaped}\\s*:\\s*([^;}]+)`, "i").exec(skin.base);
  return normalizedOpaqueColor(match?.[1]);
}

/**
 * Returns the color that the universal Theme Surface channel visibly drives.
 * Semantic and legacy roots stay exact. A tint-only skin has no honest single
 * current Surface color, so its complete render-only material palette is kept
 * separately until Refill supplies one explicit Surface target.
 */
export function readProgramPopoutSkinSurfaceColor(skin: ButtonSkin): {
  color: string | null;
  materialColors: string[];
} {
  const surfaceVariable = buttonSkinSurfaceThemeVariable(skin);
  const profiles = collectButtonSkinProfileColors(skin);
  const semantic = profiles.find(({ variable }) => variable === surfaceVariable);
  const semanticColor = normalizedOpaqueColor(semantic?.color);
  if (semanticColor) return { color: semanticColor, materialColors: [] };

  if (surfaceVariable) {
    const color = declaredCssVariableColor(skin, surfaceVariable);
    if (color) return { color, materialColors: [] };
  }

  return {
    color: null,
    materialColors: collectButtonSkinSurfaceThemeFallbackColors(skin)
      .map((color) => normalizeButtonSkinColor(color)?.toUpperCase() ?? null)
      .filter((color): color is string => Boolean(color))
  };
}

function popoutTarget(programName: string): ThemeTarget {
  return { kind: "program", programName, panelName: null };
}

const PROGRAM_POPPED_PALETTE_SURFACE_KINDS = new Set([
  "regular-popout",
  "tool-set-popout",
  "fan"
]);

interface ResolvedProgramPopoutPaletteTarget {
  paletteId: string;
  placement: ButtonPlacement;
}

function resolvedProgramPopoutPaletteTargets(
  document: ButtonStateDocument,
  programName: string,
  targets: readonly ProgramPopoutPaletteTarget[]
): ResolvedProgramPopoutPaletteTarget[] {
  const themeTarget = popoutTarget(programName);
  const paletteIds = new Set<string>();
  const placementIds = new Set<string>();
  return targets.map((target) => {
    const paletteId = target.paletteId.trim();
    const placementId = target.placementId.trim();
    const placement = document.placements[placementId];
    const surface = placement ? document.surfaces[placement.surfaceId] : null;
    if (
      !paletteId ||
      !placementId ||
      paletteIds.has(paletteId) ||
      placementIds.has(placementId) ||
      !placement ||
      !surface ||
      !PROGRAM_POPPED_PALETTE_SURFACE_KINDS.has(surface.kind) ||
      !placementMatchesThemeTarget(document, placement, themeTarget)
    ) {
      throw new Error("Popped Button colors are stale. Press Rescan and try again.");
    }
    paletteIds.add(paletteId);
    placementIds.add(placementId);
    return { paletteId, placement };
  });
}

function skinSurfaceColor(
  document: ButtonStateDocument,
  placement: ButtonPlacement
): { color: string | null; materialColors: string[] } {
  const button = document.buttons[placement.buttonId];
  const skin = button
    ? document.skins[placement.skinOverrideId ?? button.defaultSkinId]
    : null;
  return skin
    ? readProgramPopoutSkinSurfaceColor(skin)
    : { color: null, materialColors: [] };
}

function effectiveSurfaceColor(
  document: ButtonStateDocument,
  placement: ButtonPlacement
): { color: string | null; materialColors: string[] } {
  const override = normalizedOpaqueColor(document.themeOverrides?.[placement.id]?.colors.surface);
  return override ? { color: override, materialColors: [] } : skinSurfaceColor(document, placement);
}

export function scanProgramPopoutPaletteTargets(
  document: ButtonStateDocument,
  programName: string,
  targets: readonly ProgramPopoutPaletteTarget[]
): ProgramPopoutPaletteScan {
  const placements = resolvedProgramPopoutPaletteTargets(document, programName, targets).map(({
    paletteId,
    placement
  }) => ({
    placementId: paletteId,
    ...effectiveSurfaceColor(document, placement)
  }));
  const colors = new Set(placements.flatMap(({ color, materialColors = [] }) => (
    color ? [color] : materialColors
  )));
  return {
    placements,
    buttonCount: placements.length,
    colorCount: colors.size
  };
}

function assignmentMap(
  document: ButtonStateDocument,
  programName: string,
  targets: readonly ProgramPopoutPaletteTarget[],
  assignments: readonly ProgramPopoutPaletteAssignment[]
): Map<string, { placementId: string; color: string | null }> {
  const resolvedTargets = resolvedProgramPopoutPaletteTargets(document, programName, targets);
  const placementIdByPaletteId = new Map(
    resolvedTargets.map(({ paletteId, placement }) => [paletteId, placement.id])
  );
  const resolved = new Map<string, { placementId: string; color: string | null }>();
  for (const assignment of assignments) {
    const paletteId = assignment.placementId.trim();
    const color = assignment.color === null ? null : normalizedOpaqueColor(assignment.color);
    const placementId = placementIdByPaletteId.get(paletteId);
    if (!paletteId || !placementId) {
      throw new Error("Popped Button colors are stale. Press Rescan and try again.");
    }
    if (assignment.color !== null && !color) {
      throw new Error("A popped Button color is invalid.");
    }
    if (resolved.has(paletteId)) {
      throw new Error("A popped Button color was assigned more than once.");
    }
    resolved.set(paletteId, { placementId, color });
  }
  if (resolved.size !== placementIdByPaletteId.size) {
    throw new Error("Popped Button colors are stale. Press Rescan and try again.");
  }
  return resolved;
}

export function applyProgramPopoutPaletteTargets(
  document: ButtonStateDocument,
  programName: string,
  targets: readonly ProgramPopoutPaletteTarget[],
  assignments: readonly ProgramPopoutPaletteAssignment[]
): ProgramPopoutPaletteApplyResult {
  const resolved = assignmentMap(document, programName, targets, assignments);
  const next = cloneButtonDocument(document);
  let changedCount = 0;
  for (const { placementId, color } of resolved.values()) {
    const placement = next.placements[placementId];
    if (!placement || color === null) continue;
    const underlyingColor = skinSurfaceColor(next, placement).color;
    const current = next.themeOverrides?.[placementId];
    const before = JSON.stringify(current ?? null);
    const override = structuredClone(current ?? emptyButtonThemeOverride());
    if (color === underlyingColor) delete override.colors.surface;
    else override.colors.surface = color;
    if (buttonThemeOverrideIsEmpty(override)) {
      if (next.themeOverrides) delete next.themeOverrides[placementId];
    } else {
      next.themeOverrides ??= {};
      next.themeOverrides[placementId] = override;
    }
    if (JSON.stringify(next.themeOverrides?.[placementId] ?? null) !== before) changedCount += 1;
  }
  return {
    document: next,
    changedCount,
    ...scanProgramPopoutPaletteTargets(next, programName, targets)
  };
}

function validatedProgramPopoutTextColor(value: string): ProgramPopoutTextColor {
  const color = normalizedOpaqueColor(value);
  if (color !== "#000000" && color !== "#FFFFFF") {
    throw new Error("Popped Button text color must be black or white.");
  }
  return color;
}

export function programPopoutPaletteTargetsHaveTextColor(
  document: ButtonStateDocument,
  programName: string,
  targets: readonly ProgramPopoutPaletteTarget[],
  textColor: ProgramPopoutTextColor
): boolean {
  const color = validatedProgramPopoutTextColor(textColor);
  return resolvedProgramPopoutPaletteTargets(document, programName, targets).every(({ placement }) =>
    normalizedOpaqueColor(document.themeOverrides?.[placement.id]?.colors.text) === color
  );
}

export function applyProgramPopoutTextColorTargets(
  document: ButtonStateDocument,
  programName: string,
  targets: readonly ProgramPopoutPaletteTarget[],
  textColor: ProgramPopoutTextColor
): ProgramPopoutPaletteApplyResult {
  const color = validatedProgramPopoutTextColor(textColor);
  const resolved = resolvedProgramPopoutPaletteTargets(document, programName, targets);
  const next = cloneButtonDocument(document);
  let changedCount = 0;
  for (const { placement } of resolved) {
    const current = next.themeOverrides?.[placement.id];
    const before = JSON.stringify(current ?? null);
    const override = structuredClone(current ?? emptyButtonThemeOverride());
    override.colors.text = color;
    next.themeOverrides ??= {};
    next.themeOverrides[placement.id] = override;
    if (JSON.stringify(override) !== before) changedCount += 1;
  }
  return {
    document: next,
    changedCount,
    ...scanProgramPopoutPaletteTargets(next, programName, targets)
  };
}

function validatedGradient(value: ProgramPopoutPaletteGradient): ProgramPopoutPaletteGradient {
  const colors = Array.isArray(value.colors)
    ? value.colors.map((color) => normalizedOpaqueColor(color))
    : [];
  if (
    colors.length < 2 ||
    colors.length > 16 ||
    colors.some((color) => color === null)
  ) {
    throw new Error("Popped Button gradient requires 2 to 16 valid colors.");
  }
  if (!Number.isFinite(value.spread) || value.spread < 0 || value.spread > 100 ||
      !Number.isFinite(value.scatter) || value.scatter < 0 || value.scatter > 100 ||
      !Number.isSafeInteger(value.seed)) {
    throw new Error("Popped Button scatter settings are invalid.");
  }
  return {
    colors: colors as string[],
    spread: value.spread,
    scatter: value.scatter,
    seed: value.seed
  };
}

function multiStopGradientColor(colors: readonly string[], position: number): string {
  const scaled = Math.min(1, Math.max(0, position)) * (colors.length - 1);
  const startIndex = Math.min(Math.floor(scaled), colors.length - 2);
  return interpolateThemeColor(
    colors[startIndex],
    colors[startIndex + 1],
    scaled - startIndex
  );
}

export function gradientProgramPopoutPaletteAssignments(
  items: readonly ProgramPopoutPaletteGradientItem[],
  value: ProgramPopoutPaletteGradient,
  range?: Readonly<ProgramPopoutPaletteGradientRange>
): ProgramPopoutPaletteAssignment[] {
  const gradient = validatedGradient(value);
  if (items.length === 0) return [];
  const minimumY = range?.minimumY ?? Math.min(...items.map(({ y }) => y));
  const maximumY = range?.maximumY ?? Math.max(...items.map(({ y }) => y));
  if (
    !Number.isFinite(minimumY) ||
    !Number.isFinite(maximumY) ||
    items.some(({ y }) => !Number.isFinite(y)) ||
    (range !== undefined && maximumY <= minimumY)
  ) {
    throw new Error("Popped Button gradient range is invalid.");
  }
  return items.map(({ paletteId, y }) => ({
      placementId: paletteId,
      color: multiStopGradientColor(gradient.colors, gradientPositionForPlacement({
        placementId: paletteId,
        y,
        minimumY,
        maximumY,
        gradient
      }))
    }));
}

export function programPopoutPaletteScreenPositions({
  items,
  visibleBounds,
  envelope,
  monitorWorkArea
}: ProgramPopoutPaletteScreenPositionArgs): ProgramPopoutPaletteGradientItem[] {
  if (
    !Number.isFinite(visibleBounds.Top) ||
    !Number.isFinite(visibleBounds.Height) ||
    visibleBounds.Height <= 0 ||
    !Number.isFinite(envelope.y) ||
    !Number.isFinite(envelope.height) ||
    envelope.height <= 0 ||
    !Number.isFinite(monitorWorkArea.Top) ||
    !Number.isFinite(monitorWorkArea.Height) ||
    monitorWorkArea.Height <= 0 ||
    items.some(({ y }) => !Number.isFinite(y))
  ) {
    throw new Error("Popped Button screen gradient geometry is invalid.");
  }
  const physicalPerDesignPixel = visibleBounds.Height / envelope.height;
  return items.map(({ paletteId, y }) => {
    const desktopY = visibleBounds.Top + (y - envelope.y) * physicalPerDesignPixel;
    const normalizedY = (desktopY - monitorWorkArea.Top) / monitorWorkArea.Height;
    return {
      paletteId,
      y: Math.min(1, Math.max(0, normalizedY))
    };
  });
}

export function programPopoutPaletteTargetPositions(
  document: ButtonStateDocument,
  programName: string,
  targets: readonly ProgramPopoutPaletteTarget[]
): ProgramPopoutPaletteGradientItem[] {
  const target = popoutTarget(programName);
  return resolvedProgramPopoutPaletteTargets(document, programName, targets).map(({
    paletteId,
    placement
  }) => ({
    paletteId,
    y: themePlacementDeployedCenterY(document, placement, target)
  }));
}
