import { cloneButtonDocument } from "../button/state/buttonDefaults.js";
import {
  buttonSkinOpaqueColor,
  collectButtonSkinProfileColors,
  collectButtonSkinSurfaceThemeFallbackColors,
  buttonSkinSurfaceThemeVariable,
  normalizeButtonSkinColor,
  readButtonSkinTextColor
} from "../button/skins/buttonSkinColors.js";
import type {
  ButtonPlacement,
  ButtonRect,
  ButtonSkin,
  ButtonStateDocument
} from "../button/types.js";
import type { FlowCellBounds } from "../types.js";
import { normalizeProgramPopoutColorOverride, resolveProgramPopoutThemeOverride } from "./programPopoutTheme.js";
import { programPopoutGradientColor } from "./programPopoutGradient.js";
import {
  buttonThemeOverrideIsEmpty,
  emptyButtonThemeOverride,
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
  placements: ProgramPopoutPaletteScannedPlacement[];
  buttonCount: number;
  colorCount: number;
}

export interface ProgramPopoutPaletteScannedPlacement extends ProgramPopoutPaletteAssignment {
  label: string;
  textColor: string;
  groupLabel: string;
}

export interface ProgramPopoutColorEdit {
  placementId: string;
  color?: string;
  textColor?: string;
  reset?: boolean;
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
  screenId?: string;
  rangeEligible?: boolean;
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
  screenId?: string;
}

/** Normalize only occupied rows, independently per screen; hidden members do not anchor the range. */
export function normalizedProgramPopoutScreenPositions(
  items: readonly ProgramPopoutPaletteGradientItem[]
): ProgramPopoutPaletteGradientItem[] {
  const ranges = new Map<string, ProgramPopoutPaletteGradientRange>();
  for (const item of items) {
    if (item.rangeEligible === false) continue;
    const key = item.screenId ?? "";
    const range = ranges.get(key);
    ranges.set(key, {
      minimumY: Math.min(range?.minimumY ?? item.y, item.y),
      maximumY: Math.max(range?.maximumY ?? item.y, item.y)
    });
  }
  return items.map((item) => {
    const range = ranges.get(item.screenId ?? "");
    return { ...item, y: range && range.maximumY > range.minimumY
      ? Math.min(1, Math.max(0, (item.y - range.minimumY) / (range.maximumY - range.minimumY)))
      : 0 };
  });
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
  placement: ButtonPlacement,
  normalizedScreenY?: number
): { color: string | null; materialColors: string[] } {
  const override = normalizedOpaqueColor(
    resolveProgramPopoutThemeOverride(document, placement.id, undefined, normalizedScreenY)?.colors.surface
  );
  return override ? { color: override, materialColors: [] } : skinSurfaceColor(document, placement);
}

export function scanProgramPopoutPaletteTargets(
  document: ButtonStateDocument,
  programName: string,
  targets: readonly ProgramPopoutPaletteTarget[],
  screenPositions?: readonly ProgramPopoutPaletteGradientItem[]
): ProgramPopoutPaletteScan {
  const screenPositionByPaletteId = new Map(screenPositions && normalizedProgramPopoutScreenPositions(screenPositions)
    .map(({ paletteId, y }) => [paletteId, y]));
  const placements = resolvedProgramPopoutPaletteTargets(document, programName, targets).map(({
    paletteId,
    placement
  }) => {
    const button = document.buttons[placement.buttonId];
    const skin = button && document.skins[placement.skinOverrideId ?? button.defaultSkinId];
    const profileText = skin && collectButtonSkinProfileColors(skin).find(({ role }) => role === "text")?.color;
    const override = resolveProgramPopoutThemeOverride(document, placement.id);
    return {
      placementId: paletteId,
      label: button?.label ?? placement.buttonId,
      groupLabel: document.surfaces[placement.surfaceId].name,
      textColor: normalizedOpaqueColor(override?.colors.text ?? profileText ?? (skin && readButtonSkinTextColor(skin))) ?? "#FFFFFF",
      ...effectiveSurfaceColor(document, placement, screenPositionByPaletteId.get(paletteId))
    };
  });
  const colors = new Set(placements.flatMap(({ color, materialColors = [] }) => (
    color ? [color] : materialColors
  )));
  return {
    placements,
    buttonCount: placements.length,
    colorCount: colors.size
  };
}

/** Edits an exact nonempty subset; every edit is checked before the source is cloned or changed. */
export function applyProgramPopoutColorEdits(
  document: ButtonStateDocument,
  programName: string,
  targets: readonly ProgramPopoutPaletteTarget[],
  edits: readonly ProgramPopoutColorEdit[]
): ProgramPopoutPaletteApplyResult {
  const targetById = new Map(resolvedProgramPopoutPaletteTargets(document, programName, targets)
    .map(({ paletteId, placement }) => [paletteId, placement.id]));
  if (!Array.isArray(edits) || edits.length === 0) throw new Error("Choose at least one popped Button to edit.");
  const seen = new Set<string>();
  const resolved = edits.map((edit) => {
    if (!edit || typeof edit !== "object" || Array.isArray(edit) || typeof edit.placementId !== "string" ||
      Object.keys(edit).some((key) => !["placementId", "color", "textColor", "reset"].includes(key)) ||
      (edit.reset !== undefined && typeof edit.reset !== "boolean")) {
      throw new Error("An individual popped Button color edit is invalid.");
    }
    const placementId = targetById.get(edit.placementId);
    if (!placementId || seen.has(edit.placementId)) throw new Error("Popped Button colors are stale or duplicated. Press Rescan and try again.");
    seen.add(edit.placementId);
    const colors = normalizeProgramPopoutColorOverride({
      ...(edit.color !== undefined ? { surface: edit.color } : {}),
      ...(edit.textColor !== undefined ? { text: edit.textColor } : {})
    });
    if (edit.reset === true ? edit.color !== undefined || edit.textColor !== undefined : !colors) {
      throw new Error("An individual popped Button color edit must set colors or reset them.");
    }
    return { placementId, colors, reset: edit.reset === true };
  });
  const next = cloneButtonDocument(document);
  const key = programName.normalize("NFC").trim().toLocaleLowerCase("en");
  next.programPopoutColorOverrideRevisions ??= {};
  next.programPopoutColorOverrideRevisions[key] ??= { surface: 0, text: 0 };
  next.programPopoutColorOverrides ??= {};
  let changedCount = 0;
  for (const { placementId, colors, reset } of resolved) {
    const before = JSON.stringify(next.programPopoutColorOverrides[placementId] ?? null);
    if (reset) delete next.programPopoutColorOverrides[placementId];
    else next.programPopoutColorOverrides[placementId] = { ...next.programPopoutColorOverrides[placementId], ...colors };
    if (JSON.stringify(next.programPopoutColorOverrides[placementId] ?? null) !== before) changedCount += 1;
  }
  return { document: next, changedCount, ...scanProgramPopoutPaletteTargets(next, programName, targets) };
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
    normalizedOpaqueColor(resolveProgramPopoutThemeOverride(document, placement.id)?.colors.text) === color
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
      color: programPopoutGradientColor({
        ...gradient,
        placementId: paletteId,
        y,
        minimumY,
        maximumY
      }).toLowerCase()
    }));
}

export function programPopoutPaletteScreenPositions({
  items,
  visibleBounds,
  envelope,
  monitorWorkArea,
  screenId
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
      y: normalizedY,
      ...(screenId ? { screenId } : {})
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
