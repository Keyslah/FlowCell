import type {
  ButtonPlacement,
  ButtonRect,
  ButtonStateDocument,
  ButtonThemeOverride,
  ProgramPopoutColorOverride,
  ProgramPopoutThemeSettings
} from "../button/types.js";
import {
  buttonSkinOpaqueColor,
  collectButtonSkinProfileColors,
  normalizeButtonGlowAmount,
  normalizeButtonHighlightAmount,
  normalizeButtonSkinColor,
  readButtonSkinHighlightOnActive,
  readButtonSkinHighlightOnHover,
  readButtonSkinTextColor,
  resolveButtonGlowAmount,
  resolveButtonHighlightAmount
} from "../button/skins/buttonSkinColors.js";
import type { FlowCellBounds } from "../types.js";
import { placementMatchesThemeTarget } from "./themeModel.js";
import { programPopoutGradientColor } from "./programPopoutGradient.js";
import { readProgramPopoutSkinSurfaceColor } from "./programPopoutPalette.js";

export type { ProgramPopoutThemeSettings } from "../button/types.js";

/** Live physical geometry belongs to the window, never to a saved theme package. */
export interface ProgramPopoutThemeScreenGeometry {
  visibleBounds: Pick<FlowCellBounds, "Top" | "Height">;
  envelope: Pick<ButtonRect, "y" | "height">;
  monitorWorkArea: Pick<FlowCellBounds, "Top" | "Height">;
  screenRange?: { minimumY: number; maximumY: number };
}

const SETTING_KEYS = new Set([
  "version", "colors", "spread", "scatter", "seed", "screenTopToBottom", "textColor",
  "hoverEnabled", "activeEnabled", "hoverColor", "activeColor", "hoverHighlightAmount",
  "activeHighlightAmount", "hoverGlowAmount", "activeGlowAmount"
]);
const POPOUT_SURFACE_KINDS = new Set(["regular-popout", "tool-set-popout", "fan"]);

function normalizedColor(value: unknown): string | null {
  return typeof value === "string" ? normalizeButtonSkinColor(value)?.toUpperCase() ?? null : null;
}

export function normalizeProgramPopoutColorOverride(value: unknown): ProgramPopoutColorOverride | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (keys.length === 0 || keys.some((key) => key !== "surface" && key !== "text")) return null;
  const result: ProgramPopoutColorOverride = {};
  for (const key of keys as (keyof ProgramPopoutColorOverride)[]) {
    const color = normalizedColor(candidate[key]);
    if (!color) return null;
    result[key] = key === "surface" ? buttonSkinOpaqueColor(color)!.toUpperCase() : color;
  }
  return result;
}

/** Mutates a caller-owned document and invalidates matching transient draft channels. */
export function clearProgramPopoutColorOverrides(
  document: ButtonStateDocument,
  programName: string,
  channels: readonly (keyof ProgramPopoutColorOverride)[] = ["surface", "text"],
  force = false
): boolean {
  const selectedChannels = [...new Set(channels)];
  if (selectedChannels.length === 0) return false;
  if (selectedChannels.some((channel) => channel !== "surface" && channel !== "text")) {
    throw new Error("Unknown popped Button color channel.");
  }
  const key = programName.normalize("NFC").trim().toLocaleLowerCase("en");
  const placementIds = Object.keys(document.programPopoutColorOverrides ?? {}).filter((id) => {
    const placement = document.placements[id];
    return placement && placementMatchesThemeTarget(document, placement, { kind: "program", programName, panelName: null });
  });
  const revision = document.programPopoutColorOverrideRevisions?.[key];
  if (!force && !revision && placementIds.length === 0) return false;
  for (const id of placementIds) {
    const override = document.programPopoutColorOverrides![id];
    for (const channel of selectedChannels) delete override[channel];
    if (Object.keys(override).length === 0) delete document.programPopoutColorOverrides![id];
  }
  const nextRevision = { surface: revision?.surface ?? 0, text: revision?.text ?? 0 };
  for (const channel of selectedChannels) nextRevision[channel] += 1;
  document.programPopoutColorOverrideRevisions ??= {};
  document.programPopoutColorOverrideRevisions[key] = nextRevision;
  return true;
}

/** Reject malformed explicit settings rather than silently replacing package values. */
export function normalizeProgramPopoutThemeSettings(value: unknown): ProgramPopoutThemeSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !SETTING_KEYS.has(key)) || candidate.version !== 1) return null;
  const colors = Array.isArray(candidate.colors)
    ? candidate.colors.map((color) => {
      const normalized = normalizedColor(color);
      return normalized ? buttonSkinOpaqueColor(normalized)?.toUpperCase() ?? null : null;
    })
    : [];
  if (colors.length < 1 || colors.length > 16 || colors.some((color) => !color)) return null;
  if (![candidate.spread, candidate.scatter].every((amount) => (
    typeof amount === "number" && Number.isFinite(amount) && amount >= 0 && amount <= 100
  )) || !Number.isSafeInteger(candidate.seed)) return null;
  if (![candidate.screenTopToBottom, candidate.hoverEnabled, candidate.activeEnabled]
    .every((enabled) => typeof enabled === "boolean")) return null;
  const textColor = normalizedColor(candidate.textColor);
  const hoverColor = normalizedColor(candidate.hoverColor);
  const activeColor = normalizedColor(candidate.activeColor);
  const hoverHighlightAmount = normalizeButtonHighlightAmount(candidate.hoverHighlightAmount);
  const activeHighlightAmount = normalizeButtonHighlightAmount(candidate.activeHighlightAmount);
  const hoverGlowAmount = normalizeButtonGlowAmount(candidate.hoverGlowAmount);
  const activeGlowAmount = normalizeButtonGlowAmount(candidate.activeGlowAmount);
  if (!textColor || !hoverColor || !activeColor || hoverHighlightAmount === null ||
    activeHighlightAmount === null || hoverGlowAmount === null || activeGlowAmount === null) return null;
  return {
    version: 1,
    colors: colors as string[],
    spread: candidate.spread as number,
    scatter: candidate.scatter as number,
    seed: candidate.seed as number,
    screenTopToBottom: candidate.screenTopToBottom as boolean,
    textColor,
    hoverEnabled: candidate.hoverEnabled as boolean,
    activeEnabled: candidate.activeEnabled as boolean,
    hoverColor,
    activeColor,
    hoverHighlightAmount,
    activeHighlightAmount,
    hoverGlowAmount,
    activeGlowAmount
  };
}

function mostCommon<T extends string | number | boolean>(values: readonly T[], fallback: T): T {
  const counts = new Map<T, number>();
  let result = fallback;
  let maximum = 0;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > maximum) {
      maximum = count;
      result = value;
    }
  }
  return result;
}

/** Preserve legacy appearance on first use; isolated stale overrides cannot win over the common setting. */
export function captureProgramPopoutThemeSettings(
  document: ButtonStateDocument,
  programName: string
): ProgramPopoutThemeSettings {
  const key = programName.normalize("NFC").trim().toLocaleLowerCase("en");
  const stored = normalizeProgramPopoutThemeSettings(document.programPopoutThemes?.[key]);
  if (stored) return stored;
  const placements = Object.values(document.placements)
    .filter((placement) => POPOUT_SURFACE_KINDS.has(document.surfaces[placement.surfaceId]?.kind) &&
      placementMatchesThemeTarget(document, placement, { kind: "program", programName, panelName: null }))
    .sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id));
  const samples = placements.flatMap((placement) => {
    const button = document.buttons[placement.buttonId];
    const skin = button && document.skins[placement.skinOverrideId ?? button.defaultSkinId];
    if (!skin) return [];
    const override = document.themeOverrides?.[placement.id];
    const skinSurface = readProgramPopoutSkinSurfaceColor(skin);
    const surfaceColor = normalizedColor(override?.colors.surface);
    const profileText = collectButtonSkinProfileColors(skin).find(({ role }) => role === "text")?.color;
    return [{
      colors: surfaceColor ? [surfaceColor] : skinSurface.color ? [skinSurface.color] : skinSurface.materialColors,
      textColor: normalizedColor(override?.colors.text ?? profileText ?? readButtonSkinTextColor(skin)) ?? "#FFFFFF",
      hoverEnabled: override?.hoverEnabled ?? readButtonSkinHighlightOnHover(skin) ?? placement.highlightOnHover,
      activeEnabled: override?.activeEnabled ?? readButtonSkinHighlightOnActive(skin) ?? false,
      hoverColor: normalizedColor(override?.hoverColor) ?? "#FFFFFFCC",
      activeColor: normalizedColor(override?.activeColor) ?? "#FFFFFFCC",
      hoverHighlightAmount: resolveButtonHighlightAmount(override?.hoverHighlightAmount ?? override?.highlightAmount),
      activeHighlightAmount: resolveButtonHighlightAmount(override?.activeHighlightAmount ?? override?.highlightAmount),
      hoverGlowAmount: resolveButtonGlowAmount(override?.hoverGlowAmount ?? override?.highlightAmount),
      activeGlowAmount: resolveButtonGlowAmount(override?.activeGlowAmount ?? override?.highlightAmount)
    }];
  });
  const fallbackSkin = document.skins[document.settings.defaultSkinId];
  const defaultColors = fallbackSkin ? readProgramPopoutSkinSurfaceColor(fallbackSkin) : null;
  const colors = [...new Set(samples.flatMap((sample) => sample.colors))].slice(0, 16);
  return {
    version: 1,
    colors: colors.length > 0 ? colors : [defaultColors?.color ?? "#E6E6E6"],
    spread: 100,
    scatter: 0,
    seed: 0,
    screenTopToBottom: false,
    textColor: mostCommon(samples.map((sample) => sample.textColor), "#FFFFFF"),
    hoverEnabled: mostCommon(samples.map((sample) => sample.hoverEnabled), false),
    activeEnabled: mostCommon(samples.map((sample) => sample.activeEnabled), false),
    hoverColor: mostCommon(samples.map((sample) => sample.hoverColor), "#FFFFFFCC"),
    activeColor: mostCommon(samples.map((sample) => sample.activeColor), "#FFFFFFCC"),
    hoverHighlightAmount: mostCommon(samples.map((sample) => sample.hoverHighlightAmount), resolveButtonHighlightAmount(null)),
    activeHighlightAmount: mostCommon(samples.map((sample) => sample.activeHighlightAmount), resolveButtonHighlightAmount(null)),
    hoverGlowAmount: mostCommon(samples.map((sample) => sample.hoverGlowAmount), resolveButtonGlowAmount(null)),
    activeGlowAmount: mostCommon(samples.map((sample) => sample.activeGlowAmount), resolveButtonGlowAmount(null))
  };
}

function screenPosition(y: number, geometry: ProgramPopoutThemeScreenGeometry): number | null {
  const { visibleBounds, envelope, monitorWorkArea } = geometry;
  if (![visibleBounds.Top, envelope.y, monitorWorkArea.Top].every(Number.isFinite) ||
    ![visibleBounds.Height, envelope.height, monitorWorkArea.Height]
      .every((height) => Number.isFinite(height) && height > 0)) return null;
  const desktopY = visibleBounds.Top + (y - envelope.y) * visibleBounds.Height / envelope.height;
  const minimumY = geometry.screenRange?.minimumY ?? monitorWorkArea.Top;
  const maximumY = geometry.screenRange?.maximumY ?? monitorWorkArea.Top + monitorWorkArea.Height;
  return maximumY > minimumY
    ? Math.min(1, Math.max(0, (desktopY - minimumY) / (maximumY - minimumY)))
    : 0;
}

function surfaceColor(
  document: ButtonStateDocument,
  placement: ButtonPlacement,
  programName: string,
  settings: ProgramPopoutThemeSettings,
  geometry?: ProgramPopoutThemeScreenGeometry,
  normalizedScreenY?: number,
  sourcePlacementId?: string
): string {
  if (settings.colors.length === 1) return settings.colors[0];
  const centerY = placement.y + placement.height / 2;
  const screenY = settings.screenTopToBottom
    ? typeof normalizedScreenY === "number" && Number.isFinite(normalizedScreenY)
      ? Math.min(1, Math.max(0, normalizedScreenY))
      : geometry ? screenPosition(centerY, geometry) : null
    : null;
  // Local gradients use only the rendered surface: closed windows cannot alter
  // the colors of a currently visible set of Buttons.
  const centers = screenY !== null ? [] : document.surfaces[placement.surfaceId].placementIds
    .map((id) => document.placements[id])
    .filter((entry) => entry && placementMatchesThemeTarget(document, entry, {
      kind: "program", programName, panelName: null
    }))
    .map((entry) => entry.y + entry.height / 2);
  return programPopoutGradientColor({
    ...settings,
    placementId: sourcePlacementId && document.placements[sourcePlacementId]?.buttonId === placement.buttonId
      ? sourcePlacementId
      : placement.id,
    y: screenY ?? centerY,
    minimumY: screenY !== null ? 0 : Math.min(centerY, ...centers),
    maximumY: screenY !== null ? 1 : Math.max(centerY, ...centers)
  }).toUpperCase();
}

/** The program theme wins on popped instances while every other surface inherits as before. */
export function resolveProgramPopoutThemeOverride(
  document: ButtonStateDocument,
  placementId: string,
  geometry?: ProgramPopoutThemeScreenGeometry,
  normalizedScreenY?: number,
  sourcePlacementId?: string
): ButtonThemeOverride | undefined {
  const original = document.themeOverrides?.[placementId];
  const placement = document.placements[placementId];
  const surface = placement && document.surfaces[placement.surfaceId];
  if (!placement || !surface || !POPOUT_SURFACE_KINDS.has(surface.kind)) return original;
  const colorPlacementId = sourcePlacementId && document.placements[sourcePlacementId]?.buttonId === placement.buttonId
    ? sourcePlacementId
    : placementId;
  const colorOverride = normalizeProgramPopoutColorOverride(document.programPopoutColorOverrides?.[colorPlacementId]);
  for (const [programName, rawSettings] of Object.entries(document.programPopoutThemes ?? {})) {
    if (!placementMatchesThemeTarget(document, placement, { kind: "program", programName, panelName: null })) continue;
    const settings = normalizeProgramPopoutThemeSettings(rawSettings);
    if (!settings) continue;
    return {
      ...original,
      colors: {
        ...original?.colors,
        surface: surfaceColor(document, placement, programName, settings, geometry, normalizedScreenY, sourcePlacementId),
        text: settings.textColor,
        ...colorOverride
      },
      hoverEnabled: settings.hoverEnabled,
      activeEnabled: settings.activeEnabled,
      hoverColor: settings.hoverColor,
      activeColor: settings.activeColor,
      hoverHighlightAmount: settings.hoverHighlightAmount,
      activeHighlightAmount: settings.activeHighlightAmount,
      hoverGlowAmount: settings.hoverGlowAmount,
      activeGlowAmount: settings.activeGlowAmount
    };
  }
  return colorOverride ? {
    hoverEnabled: null,
    activeEnabled: null,
    hoverColor: null,
    activeColor: null,
    ...original,
    colors: { ...original?.colors, ...colorOverride }
  } : original;
}
