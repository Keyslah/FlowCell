import type {
  ButtonPlacement,
  ButtonRect,
  ButtonStateDocument,
  ButtonThemeOverride,
  ProgramPopoutColorOverride,
  ProgramPopoutThemeSettings
} from "../button/types.js";
import {
  BUTTON_GLOW_AMOUNT_MAX,
  BUTTON_HIGHLIGHT_AMOUNT_MAX,
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
import {
  normalizeProgramPopoutGradientCurve,
  programPopoutGradientColor,
  programPopoutGradientCurveValue,
  programPopoutGradientProjection
} from "./programPopoutGradient.js";
import { readProgramPopoutSkinSurfaceColor } from "./programPopoutPalette.js";

export type { ProgramPopoutThemeSettings } from "../button/types.js";

/** Live physical geometry belongs to the window, never to a saved theme package. */
export interface ProgramPopoutThemeScreenGeometry {
  visibleBounds: Pick<FlowCellBounds, "Top" | "Height"> & Partial<Pick<FlowCellBounds, "Left" | "Width">>;
  envelope: Pick<ButtonRect, "y" | "height"> & Partial<Pick<ButtonRect, "x" | "width">>;
  monitorWorkArea: Pick<FlowCellBounds, "Top" | "Height"> & Partial<Pick<FlowCellBounds, "Left" | "Width">>;
  screenRange?: {
    minimumY: number; maximumY: number; minimumX?: number; maximumX?: number;
    centers?: readonly { x: number; y: number }[];
  };
}

const SETTING_KEYS = new Set([
  "version", "colors", "spread", "scatter", "seed", "screenTopToBottom", "angle", "curve", "textColor",
  "textColors", "textAngle", "textCurve", "textScreenTopToBottom",
  "highlightCurve", "activeHighlightCurve", "highlightAngle", "highlightScreenTopToBottom",
  "glowCurve", "hoverGlowCurve", "activeGlowCurve", "glowAngle", "glowScreenTopToBottom",
  "hoverEnabled", "activeEnabled", "hoverColor", "activeColor", "hoverHighlightAmount",
  "activeHighlightAmount", "hoverGlowAmount", "activeGlowAmount",
  "idleEnabled", "idleColor", "idleHighlightAmount", "idleGlowAmount"
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

/** Frozen host appearance, including all interaction-state effects; no skin source is changed. */
export function normalizeProgramPopoutThemeLock(value: unknown): ButtonThemeOverride | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const required = ["colors", "hoverEnabled", "activeEnabled", "hoverColor", "activeColor"];
  const amounts = ["highlightAmount", "hoverHighlightAmount", "activeHighlightAmount", "hoverGlowAmount", "activeGlowAmount"];
  const allowed = new Set([...required, ...amounts, "idleEnabled", "idleColor", "idleHighlightAmount", "idleGlowAmount"]);
  if (Object.keys(candidate).some((key) => !allowed.has(key)) || !required.every((key) => Object.hasOwn(candidate, key))) return null;
  if (!candidate.colors || typeof candidate.colors !== "object" || Array.isArray(candidate.colors) ||
      Object.entries(candidate.colors).some(([role, color]) => !/^[a-z][a-z0-9-]*$/.test(role) || !normalizedColor(color))) return null;
  for (const key of ["hoverEnabled", "activeEnabled"]) {
    if (candidate[key] !== null && typeof candidate[key] !== "boolean") return null;
  }
  for (const key of ["hoverColor", "activeColor"]) {
    if (candidate[key] !== null && !normalizedColor(candidate[key])) return null;
  }
  for (const key of [...amounts, "idleHighlightAmount", "idleGlowAmount"]) {
    const amount = candidate[key];
    if (amount === undefined || (amount === null && !key.startsWith("idle"))) continue;
    // Spatial curves produce fractional resolved amounts; snapshot those without rounding.
    const maximum = key === "highlightAmount" || key.endsWith("HighlightAmount") ? BUTTON_HIGHLIGHT_AMOUNT_MAX : BUTTON_GLOW_AMOUNT_MAX;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > maximum) return null;
  }
  if (candidate.idleEnabled !== undefined && typeof candidate.idleEnabled !== "boolean") return null;
  if (candidate.idleColor !== undefined && !normalizedColor(candidate.idleColor)) return null;
  return structuredClone(candidate) as unknown as ButtonThemeOverride;
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

function opaqueColors(value: unknown): (string | null)[] {
  return Array.isArray(value)
    ? value.map((color) => {
      const normalized = normalizedColor(color);
      return normalized ? buttonSkinOpaqueColor(normalized)?.toUpperCase() ?? null : null;
    })
    : [];
}

function validAngle(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -360 && value <= 360;
}

/** Reject malformed explicit settings rather than silently replacing package values. */
export function normalizeProgramPopoutThemeSettings(value: unknown): ProgramPopoutThemeSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !SETTING_KEYS.has(key)) || candidate.version !== 1) return null;
  const colors = opaqueColors(candidate.colors);
  if (colors.length < 1 || colors.length > 16 || colors.some((color) => !color)) return null;
  // Gradient shape keys are optional so packages saved before they existed stay valid.
  const shape: Partial<ProgramPopoutThemeSettings> = {};
  for (const key of ["angle", "textAngle", "highlightAngle", "glowAngle"] as const) {
    if (candidate[key] === undefined) continue;
    if (!validAngle(candidate[key])) return null;
    shape[key] = candidate[key] as number;
  }
  for (const key of ["curve", "textCurve", "highlightCurve", "activeHighlightCurve", "glowCurve", "hoverGlowCurve", "activeGlowCurve"] as const) {
    if (candidate[key] === undefined) continue;
    const curve = normalizeProgramPopoutGradientCurve(candidate[key]);
    if (!curve) return null;
    shape[key] = curve;
  }
  if (candidate.textColors !== undefined) {
    const textColors = opaqueColors(candidate.textColors);
    if (textColors.length < 2 || textColors.length > 16 || textColors.some((color) => !color)) return null;
    shape.textColors = textColors as string[];
  }
  for (const key of ["textScreenTopToBottom", "highlightScreenTopToBottom", "glowScreenTopToBottom"] as const) {
    if (candidate[key] === undefined) continue;
    if (typeof candidate[key] !== "boolean") return null;
    shape[key] = candidate[key];
  }
  if (candidate.idleEnabled !== undefined) {
    if (typeof candidate.idleEnabled !== "boolean") return null;
    shape.idleEnabled = candidate.idleEnabled;
  }
  if (candidate.idleColor !== undefined) {
    const color = normalizedColor(candidate.idleColor);
    if (!color) return null;
    shape.idleColor = color;
  }
  for (const key of ["idleHighlightAmount", "idleGlowAmount"] as const) {
    if (candidate[key] === undefined) continue;
    const amount = key === "idleGlowAmount"
      ? normalizeButtonGlowAmount(candidate[key]) : normalizeButtonHighlightAmount(candidate[key]);
    if (amount === null) return null;
    shape[key] = amount;
  }
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
    ...(shape.idleEnabled !== undefined ? { idleEnabled: shape.idleEnabled } : {}),
    ...(shape.idleColor !== undefined ? { idleColor: shape.idleColor } : {}),
    ...(shape.idleHighlightAmount !== undefined ? { idleHighlightAmount: shape.idleHighlightAmount } : {}),
    ...(shape.idleGlowAmount !== undefined ? { idleGlowAmount: shape.idleGlowAmount } : {}),
    ...(shape.angle !== undefined ? { angle: shape.angle } : {}),
    ...(shape.curve ? { curve: shape.curve } : {}),
    textColor,
    ...(shape.textColors ? { textColors: shape.textColors } : {}),
    ...(shape.textAngle !== undefined ? { textAngle: shape.textAngle } : {}),
    ...(shape.textCurve ? { textCurve: shape.textCurve } : {}),
    ...(shape.textScreenTopToBottom !== undefined ? { textScreenTopToBottom: shape.textScreenTopToBottom } : {}),
    ...(shape.highlightCurve ? { highlightCurve: shape.highlightCurve } : {}),
    ...(shape.activeHighlightCurve ? { activeHighlightCurve: shape.activeHighlightCurve } : {}),
    ...(shape.highlightAngle !== undefined ? { highlightAngle: shape.highlightAngle } : {}),
    ...(shape.highlightScreenTopToBottom !== undefined ? { highlightScreenTopToBottom: shape.highlightScreenTopToBottom } : {}),
    ...(shape.glowCurve ? { glowCurve: shape.glowCurve } : {}),
    ...(shape.hoverGlowCurve ? { hoverGlowCurve: shape.hoverGlowCurve } : {}),
    ...(shape.activeGlowCurve ? { activeGlowCurve: shape.activeGlowCurve } : {}),
    ...(shape.glowAngle !== undefined ? { glowAngle: shape.glowAngle } : {}),
    ...(shape.glowScreenTopToBottom !== undefined ? { glowScreenTopToBottom: shape.glowScreenTopToBottom } : {}),
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

interface ProgramPopoutGradientChannel {
  colors: readonly string[];
  spread: number;
  scatter: number;
  seed: number;
  screen: boolean;
  angle?: number;
  curve?: ProgramPopoutThemeSettings["curve"];
}

function screenPosition(
  center: { x: number; y: number },
  geometry: ProgramPopoutThemeScreenGeometry,
  angle = 0
): number | null {
  const { visibleBounds, envelope, screenRange } = geometry;
  // Whole Layout changes scope, not direction. Project actual visible centers,
  // never monitor edges or the empty corners of their bounding box.
  if (!screenRange || ![visibleBounds.Top, envelope.y, screenRange.minimumY, screenRange.maximumY].every(Number.isFinite) ||
    ![visibleBounds.Height, envelope.height].every((height) => Number.isFinite(height) && height > 0)) return null;
  const desktopY = visibleBounds.Top + (center.y - envelope.y) * visibleBounds.Height / envelope.height;
  if (screenRange.centers?.length &&
      screenRange.centers.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) &&
      [visibleBounds.Left, envelope.x].every(Number.isFinite) &&
      [visibleBounds.Width, envelope.width].every((width) => typeof width === "number" && Number.isFinite(width) && width > 0)) {
    const desktopX = visibleBounds.Left! + (center.x - envelope.x!) * visibleBounds.Width! / envelope.width!;
    const projected = programPopoutGradientProjection({ x: desktopX, y: desktopY }, angle);
    const projections = screenRange.centers.map((point) => programPopoutGradientProjection(point, angle));
    const minimum = Math.min(...projections);
    const range = Math.max(...projections) - minimum;
    return range > 0 ? Math.min(1, Math.max(0, (projected - minimum) / range)) : 0;
  }
  // Old peers and Y-only geometry retain their established vertical behavior.
  const range = screenRange.maximumY - screenRange.minimumY;
  return range > 0 ? Math.min(1, Math.max(0, (desktopY - screenRange.minimumY) / range)) : 0;
}

function placementCenter(placement: ButtonPlacement): { x: number; y: number } {
  return { x: placement.x + placement.width / 2, y: placement.y + placement.height / 2 };
}

function gradientChannelPosition(
  document: ButtonStateDocument,
  placement: ButtonPlacement,
  programName: string,
  channel: Pick<ProgramPopoutGradientChannel, "angle" | "screen">,
  geometry?: ProgramPopoutThemeScreenGeometry,
  normalizedScreenPosition?: number,
): { y: number; minimumY: number; maximumY: number } {
  const center = placementCenter(placement);
  const screenY = channel.screen
    ? typeof normalizedScreenPosition === "number" && Number.isFinite(normalizedScreenPosition)
      ? Math.min(1, Math.max(0, normalizedScreenPosition))
      : geometry ? screenPosition(center, geometry, channel.angle) : null
    : null;
  const projected = programPopoutGradientProjection(center, channel.angle);
  // Local gradients use only the rendered surface: closed windows cannot alter
  // the colors of a currently visible set of Buttons.
  const projections = screenY !== null ? [] : document.surfaces[placement.surfaceId].placementIds
    .map((id) => document.placements[id])
    .filter((entry) => entry && placementMatchesThemeTarget(document, entry, {
      kind: "program", programName, panelName: null
    }))
    .map((entry) => programPopoutGradientProjection(placementCenter(entry), channel.angle));
  return {
    y: screenY ?? projected,
    minimumY: screenY !== null ? 0 : Math.min(projected, ...projections),
    maximumY: screenY !== null ? 1 : Math.max(projected, ...projections)
  };
}

function gradientChannelColor(
  document: ButtonStateDocument,
  placement: ButtonPlacement,
  programName: string,
  channel: ProgramPopoutGradientChannel,
  geometry?: ProgramPopoutThemeScreenGeometry,
  normalizedScreenPosition?: number,
  sourcePlacementId?: string
): string {
  if (channel.colors.length === 1) return channel.colors[0];
  return programPopoutGradientColor({
    ...channel,
    ...gradientChannelPosition(document, placement, programName, channel, geometry, normalizedScreenPosition),
    placementId: sourcePlacementId && document.placements[sourcePlacementId]?.buttonId === placement.buttonId
      ? sourcePlacementId : placement.id
  }).toUpperCase();
}

function effectStrength(
  document: ButtonStateDocument,
  placement: ButtonPlacement,
  programName: string,
  settings: ProgramPopoutThemeSettings,
  effect: "highlight" | "glow",
  geometry?: ProgramPopoutThemeScreenGeometry,
  normalizedScreenPosition?: number
): { regular: number; hover: number; active: number } {
  const regularCurve = settings[`${effect}Curve`];
  const hoverCurve = effect === "glow" ? settings.hoverGlowCurve ?? regularCurve : regularCurve;
  const activeCurve = effect === "glow" ? settings.activeGlowCurve ?? regularCurve : settings.activeHighlightCurve ?? regularCurve;
  if (!regularCurve && !hoverCurve && !activeCurve) return { regular: 1, hover: 1, active: 1 };
  const { y, minimumY, maximumY } = gradientChannelPosition(document, placement, programName, {
    angle: settings[`${effect}Angle`], screen: settings[`${effect}ScreenTopToBottom`] === true
  }, geometry, normalizedScreenPosition);
  const position = maximumY > minimumY ? (y - minimumY) / (maximumY - minimumY) : 0;
  const strength = (curve: ProgramPopoutThemeSettings["curve"]) => curve ? programPopoutGradientCurveValue(curve, position) : 1;
  return { regular: strength(regularCurve), hover: strength(hoverCurve), active: strength(activeCurve) };
}

/** A scan passes a position already projected along the fill angle across occupied centers. */
function surfaceColor(
  document: ButtonStateDocument,
  placement: ButtonPlacement,
  programName: string,
  settings: ProgramPopoutThemeSettings,
  geometry?: ProgramPopoutThemeScreenGeometry,
  normalizedScreenY?: number,
  sourcePlacementId?: string
): string {
  return gradientChannelColor(document, placement, programName, {
    colors: settings.colors,
    spread: settings.spread,
    scatter: settings.scatter,
    seed: settings.seed,
    screen: settings.screenTopToBottom,
    angle: settings.angle,
    curve: settings.curve
  }, geometry, normalizedScreenY, sourcePlacementId);
}

/** Text gradients blend smoothly without Scatter; without stops the solid text color applies. */
function textColor(
  document: ButtonStateDocument,
  placement: ButtonPlacement,
  programName: string,
  settings: ProgramPopoutThemeSettings,
  geometry?: ProgramPopoutThemeScreenGeometry,
  sourcePlacementId?: string,
  normalizedScreenPosition?: number
): string {
  if (!settings.textColors) return settings.textColor;
  return gradientChannelColor(document, placement, programName, {
    colors: settings.textColors,
    spread: 100,
    scatter: 0,
    seed: 0,
    screen: settings.textScreenTopToBottom === true,
    angle: settings.textAngle,
    curve: settings.textCurve
  }, geometry, normalizedScreenPosition, sourcePlacementId);
}

/** The program theme wins on popped instances while every other surface inherits as before. */
export function resolveProgramPopoutThemeOverride(
  document: ButtonStateDocument,
  placementId: string,
  geometry?: ProgramPopoutThemeScreenGeometry,
  normalizedScreenY?: number,
  sourcePlacementId?: string,
  normalizedTextScreenPosition?: number,
  normalizedEffectScreenPositions?: { highlight?: number; glow?: number }
): ButtonThemeOverride | undefined {
  const original = document.themeOverrides?.[placementId];
  const placement = document.placements[placementId];
  const surface = placement && document.surfaces[placement.surfaceId];
  if (!placement || !surface || !POPOUT_SURFACE_KINDS.has(surface.kind)) return original;
  const colorPlacementId = sourcePlacementId && document.placements[sourcePlacementId]?.buttonId === placement.buttonId
    ? sourcePlacementId
    : placementId;
  const locked = normalizeProgramPopoutThemeLock(document.programPopoutThemeLocks?.[colorPlacementId]);
  if (locked) return locked;
  const colorOverride = normalizeProgramPopoutColorOverride(document.programPopoutColorOverrides?.[colorPlacementId]);
  for (const [programName, rawSettings] of Object.entries(document.programPopoutThemes ?? {})) {
    if (!placementMatchesThemeTarget(document, placement, { kind: "program", programName, panelName: null })) continue;
    const settings = normalizeProgramPopoutThemeSettings(rawSettings);
    if (!settings) continue;
    const highlight = effectStrength(document, placement, programName, settings, "highlight", geometry, normalizedEffectScreenPositions?.highlight);
    const glow = effectStrength(document, placement, programName, settings, "glow", geometry, normalizedEffectScreenPositions?.glow);
    return {
      ...original,
      colors: {
        ...original?.colors,
        surface: surfaceColor(document, placement, programName, settings, geometry, normalizedScreenY, sourcePlacementId),
        text: textColor(document, placement, programName, settings, geometry, sourcePlacementId, normalizedTextScreenPosition),
        ...colorOverride
      },
      idleEnabled: settings.idleEnabled ?? false,
      idleColor: settings.idleColor ?? "#FFFFFFCC",
      idleHighlightAmount: (settings.idleHighlightAmount ?? 0) * highlight.regular,
      idleGlowAmount: (settings.idleGlowAmount ?? 0) * glow.regular,
      hoverEnabled: settings.hoverEnabled,
      activeEnabled: settings.activeEnabled,
      hoverColor: settings.hoverColor,
      activeColor: settings.activeColor,
      hoverHighlightAmount: settings.hoverHighlightAmount * highlight.hover,
      activeHighlightAmount: settings.activeHighlightAmount * highlight.active,
      hoverGlowAmount: settings.hoverGlowAmount * glow.hover,
      activeGlowAmount: settings.activeGlowAmount * glow.active
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
