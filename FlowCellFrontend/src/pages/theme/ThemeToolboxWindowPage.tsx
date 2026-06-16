import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";

import { HdriWorldToolSurface } from "../../components/ToolSurfaces";
import {
  listPanelScriptFiles,
  runBlenderToolsetAction,
  type PanelScriptFileRecord
} from "../../lib/programRails";
import {
  loadBlenderThemeDarknessProfiles,
  loadBlenderThemeFile,
  samplePhotoThemeColors,
  saveBlenderThemeDarknessProfiles,
  saveBlenderThemeFile,
  showOpenFileDialog,
  showSaveFileDialog,
  refreshScopedWindowTopmost,
  registerScopedWindowTopmost,
  setHostWindowTopmost,
  unregisterScopedWindowTopmost
} from "../../lib/tauri";
import type { ThemeToolboxWindowContext } from "../../lib/windowContext";
import type { StyleGroup } from "../../types";
import "./themeToolboxWindowPage.css";

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

type ThemeVisualMode = "dark" | "light";
type HdriWorldAction =
  | "apply_theme_from_photo_manual_colors"
  | "apply_theme_bucket"
  | "place_picture"
  | "set_place_picture_startup"
  | "clear_place_picture"
  | "set_hdri_path"
  | "clear_world"
  | "reset_world"
  | "set_rotation_x"
  | "set_rotation_y"
  | "set_rotation_z"
  | "set_world_strength";

interface HdriWorldToolValues {
  HdriPath: string;
  StaticBackgroundPath: string;
  ThemeImagePath: string;
  ThemePaletteHexes: string[];
  ThemeVisualMode: ThemeVisualMode;
  ThemeTabsHex: string;
  ThemeTabsTextHex: string;
  ThemeHeadersHex: string;
  ThemeHeaderTextHex: string;
  ThemeTextHex: string;
  ThemeControlTextHex: string;
  ThemeAccentTextHex: string;
  ThemeEditorBackgroundHex: string;
  ThemeSceneHex: string;
  ThemeControlsHex: string;
  ThemeMiscHex: string;
  ThemeDarksHex: string;
  ThemeHighlightsHex: string;
  ThemeViewportBackgroundHex: string;
  ThemeViewportGradientEnabled: boolean;
  ThemeViewportGradientHex: string;
  RotationXDeg: number;
  RotationYDeg: number;
  RotationZDeg: number;
  WorldStrength: number;
}

type ThemeToneRoleField = (typeof THEME_TONE_ROLE_FIELDS)[number];

interface DarknessProfile {
  id: string;
  name: string;
  targets: Partial<Record<ThemeToneRoleField, number>>;
  createdAt: number;
  updatedAt: number;
}

const LAST_BLENDER_THEME_DIRECTORY_KEY = "flowcell.lastBlenderThemeDirectory";
const DARKNESS_PROFILE_STORAGE_KEY = "flowcell.themeToolbox.darknessProfiles.v1";
const ACTIVE_DARKNESS_PROFILE_STORAGE_KEY = "flowcell.themeToolbox.activeDarknessProfile.v1";
const DEFAULT_THEME_PALETTE = ["#1E2728", "#F4F4EE", "#4D686B", "#7BA8B7", "#2D383A"];
const THEME_TOOLBOX_BASE_WIDTH = 904;
const THEME_TOOLBOX_MIN_SCALE = 0.5;
const THEME_TOOLBOX_MAX_SCALE = 6;
const THEME_TONE_ROLE_FIELDS = [
  "ThemeTabsHex",
  "ThemeHeadersHex",
  "ThemeEditorBackgroundHex",
  "ThemeSceneHex",
  "ThemeControlsHex",
  "ThemeHighlightsHex",
  "ThemeViewportBackgroundHex",
  "ThemeViewportGradientHex"
] as const;
const DEFAULT_DARK_TONE_TARGETS: Record<ThemeToneRoleField, number> = {
  ThemeTabsHex: 0.035,
  ThemeHeadersHex: 0.08,
  ThemeEditorBackgroundHex: 0.018,
  ThemeSceneHex: 0.04,
  ThemeControlsHex: 0.09,
  ThemeHighlightsHex: 0.35,
  ThemeViewportBackgroundHex: 0.018,
  ThemeViewportGradientHex: 0.04
};
const DEFAULT_LIGHT_TONE_TARGETS: Record<ThemeToneRoleField, number> = {
  ThemeTabsHex: 0.26,
  ThemeHeadersHex: 0.22,
  ThemeEditorBackgroundHex: 0.32,
  ThemeSceneHex: 0.24,
  ThemeControlsHex: 0.28,
  ThemeHighlightsHex: 0.44,
  ThemeViewportBackgroundHex: 0.24,
  ThemeViewportGradientHex: 0.34
};
const THEME_SIGNATURE_SLOTS = [
  "browse_theme",
  "absorb_theme",
  "apply_theme",
  "apply_hdri",
  "apply_world_strength"
];
const THEME_TOOLBOX_STYLE_GROUP: StyleGroup = {
  id: "theme-toolbox-native-buttons",
  index: 0,
  name: "Theme Toolbox Buttons",
  skinId: "glass-card",
  accent: "#86c7ac"
};

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(
  values: Record<string, unknown> | null | undefined,
  key: keyof HdriWorldToolValues | string,
  fallback: string
): string {
  const value = values?.[key];
  return typeof value === "string" ? value : fallback;
}

function readNumber(
  values: Record<string, unknown> | null | undefined,
  key: keyof HdriWorldToolValues | string,
  fallback: number
): number {
  const value = values?.[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(
  values: Record<string, unknown> | null | undefined,
  key: keyof HdriWorldToolValues | string,
  fallback: boolean
): boolean {
  const value = values?.[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return fallback;
}

function isValidThemeHex(value: string): boolean {
  return /^#[0-9A-F]{6}$/i.test(value.trim());
}

function hexChannelToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function hexLuminance(value: string): number {
  const normalized = value.trim().replace("#", "");
  if (normalized.length !== 6) {
    return 0;
  }
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return (
    0.2126 * hexChannelToLinear(red) +
    0.7152 * hexChannelToLinear(green) +
    0.0722 * hexChannelToLinear(blue)
  );
}

function parseThemeHexRgb(value: string): [number, number, number] | null {
  const normalized = value.trim().replace("#", "");
  if (normalized.length !== 6) {
    return null;
  }

  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  if (![red, green, blue].every(Number.isFinite)) {
    return null;
  }

  return [red, green, blue];
}

function hexHueDegrees(value: string): number | null {
  const rgb = parseThemeHexRgb(value);
  if (!rgb) {
    return null;
  }

  const red = rgb[0] / 255;
  const green = rgb[1] / 255;
  const blue = rgb[2] / 255;
  const maxValue = Math.max(red, green, blue);
  const minValue = Math.min(red, green, blue);
  const delta = maxValue - minValue;
  if (delta <= 0.0001 || maxValue <= 0) {
    return null;
  }

  let hue = 0;
  if (maxValue === red) {
    hue = 60 * (((green - blue) / delta) % 6);
  } else if (maxValue === green) {
    hue = 60 * ((blue - red) / delta + 2);
  } else {
    hue = 60 * ((red - green) / delta + 4);
  }
  return (hue + 360) % 360;
}

function hexSaturation(value: string): number {
  const rgb = parseThemeHexRgb(value);
  if (!rgb) {
    return 0;
  }

  const red = rgb[0] / 255;
  const green = rgb[1] / 255;
  const blue = rgb[2] / 255;
  const maxValue = Math.max(red, green, blue);
  const minValue = Math.min(red, green, blue);
  return maxValue <= 0 ? 0 : (maxValue - minValue) / maxValue;
}

function hueDistanceDegrees(left: number, right: number): number {
  const distance = Math.abs(left - right) % 360;
  return Math.min(distance, 360 - distance);
}

function rgbToThemeHex([red, green, blue]: [number, number, number]): string {
  return `#${[red, green, blue]
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")
    )
    .join("")
    .toUpperCase()}`;
}

function normalizePaletteHexes(paletteHexes: string[]): string[] {
  return Array.from(
    new Set(
      paletteHexes
        .map((value) => value.trim().toUpperCase())
        .filter((value) => isValidThemeHex(value))
    )
  ).sort((left, right) => hexLuminance(left) - hexLuminance(right));
}

function preferPaletteColors(palette: string[]): string[] {
  const colorPalette = palette.filter(
    (value) => value !== "#000000" && value !== "#FFFFFF"
  );
  return colorPalette.length >= 2 ? colorPalette : palette;
}

function pickPaletteTextHex(palette: string[], mode: ThemeVisualMode): string {
  const colorPalette = preferPaletteColors(palette);
  const fallback = mode === "light" ? "#000000" : "#FFFFFF";
  if (colorPalette.length === 0) {
    return fallback;
  }

  const sampledHex =
    mode === "light" ? colorPalette[0] : colorPalette[colorPalette.length - 1];
  return shiftHexTowardLuminance(sampledHex, mode === "light" ? 0.08 : 0.92);
}

function lightThemeTargetFromDarkTarget(darkTarget: number): number {
  const boundedDarkTarget = Math.max(0, Math.min(1, darkTarget));
  return Math.max(0.16, Math.min(0.46, 0.16 + (1 - boundedDarkTarget) * 0.26));
}

function mixRgb(
  source: [number, number, number],
  target: [number, number, number],
  amount: number
): [number, number, number] {
  return [
    source[0] + (target[0] - source[0]) * amount,
    source[1] + (target[1] - source[1]) * amount,
    source[2] + (target[2] - source[2]) * amount
  ];
}

function shiftHexTowardLuminance(hexValue: string, targetLuminance: number): string {
  const sourceRgb = parseThemeHexRgb(hexValue);
  if (!sourceRgb) {
    return hexValue;
  }

  const boundedTarget = Math.max(0, Math.min(1, targetLuminance));
  const sourceLuminance = hexLuminance(hexValue);
  if (Math.abs(sourceLuminance - boundedTarget) <= 0.006) {
    return hexValue;
  }

  const targetRgb: [number, number, number] =
    boundedTarget > sourceLuminance ? [255, 255, 255] : [0, 0, 0];
  let low = 0;
  let high = 1;
  let bestHex = hexValue;
  let bestDistance = Math.abs(sourceLuminance - boundedTarget);

  for (let index = 0; index < 18; index += 1) {
    const amount = (low + high) * 0.5;
    const candidateHex = rgbToThemeHex(mixRgb(sourceRgb, targetRgb, amount));
    const candidateLuminance = hexLuminance(candidateHex);
    const distance = Math.abs(candidateLuminance - boundedTarget);
    if (distance < bestDistance) {
      bestHex = candidateHex;
      bestDistance = distance;
    }

    if (boundedTarget > sourceLuminance) {
      if (candidateLuminance < boundedTarget) {
        low = amount;
      } else {
        high = amount;
      }
    } else if (candidateLuminance > boundedTarget) {
      low = amount;
    } else {
      high = amount;
    }
  }

  return bestHex;
}

function pickPaletteHexForTone(
  palette: string[],
  targetLuminance: number,
  usageCounts: Map<string, number>
): string {
  return palette.reduce((best, candidate) => {
    const candidateScore =
      Math.abs(hexLuminance(candidate) - targetLuminance) +
      (usageCounts.get(candidate) ?? 0) * 0.025;
    const bestScore =
      Math.abs(hexLuminance(best) - targetLuminance) +
      (usageCounts.get(best) ?? 0) * 0.025;
    return candidateScore < bestScore ? candidate : best;
  }, palette[0]);
}

function pickSpectrumPaletteHexForTone(
  palette: string[],
  targetLuminance: number,
  usageCounts: Map<string, number>,
  usedHues: number[]
): string {
  let bestHex = palette[0];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of palette) {
    const hue = hexHueDegrees(candidate);
    const minHueDistance =
      hue === null || usedHues.length === 0
        ? 180
        : usedHues.reduce(
            (minimum, existingHue) =>
              Math.min(minimum, hueDistanceDegrees(hue, existingHue)),
            180
          );
    const huePenalty = (1 - Math.min(1, minHueDistance / 135)) * 0.38;
    const score =
      Math.abs(hexLuminance(candidate) - targetLuminance) +
      huePenalty +
      (usageCounts.get(candidate) ?? 0) * 0.12 -
      hexSaturation(candidate) * 0.05 +
      Math.random() * 0.07;

    if (score < bestScore) {
      bestHex = candidate;
      bestScore = score;
    }
  }

  return bestHex;
}

function buildProfiledThemeRoleAssignment(
  palette: string[],
  mode: ThemeVisualMode,
  profile: DarknessProfile
): Partial<HdriWorldToolValues> {
  const rolePalette = preferPaletteColors(palette);
  const usageCounts = new Map<string, number>();
  const targetForField = (field: ThemeToneRoleField): number => {
    const savedTarget = profile.targets[field];
    const fallbackTarget = hexLuminance(DEFAULT_HDRI_WORLD_TOOL_VALUES[field]);
    const darkTarget =
      typeof savedTarget === "number" && Number.isFinite(savedTarget)
        ? savedTarget
        : fallbackTarget;
    return mode === "light" ? lightThemeTargetFromDarkTarget(darkTarget) : darkTarget;
  };
  const colorForField = (field: ThemeToneRoleField): string => {
    const target = targetForField(field);
    const sampledHex = pickPaletteHexForTone(rolePalette, target, usageCounts);
    usageCounts.set(sampledHex, (usageCounts.get(sampledHex) ?? 0) + 1);
    return shiftHexTowardLuminance(sampledHex, target);
  };
  const textHex = pickPaletteTextHex(rolePalette, mode);
  const editorBackgroundHex = colorForField("ThemeEditorBackgroundHex");

  return {
    ThemeVisualMode: mode,
    ThemeTabsHex: colorForField("ThemeTabsHex"),
    ThemeHeadersHex: colorForField("ThemeHeadersHex"),
    ThemeTextHex: textHex,
    ThemeControlTextHex: textHex,
    ThemeAccentTextHex: textHex,
    ThemeTabsTextHex: textHex,
    ThemeHeaderTextHex: textHex,
    ThemeEditorBackgroundHex: editorBackgroundHex,
    ThemeSceneHex: colorForField("ThemeSceneHex"),
    ThemeControlsHex: colorForField("ThemeControlsHex"),
    ThemeMiscHex: editorBackgroundHex,
    ThemeDarksHex: editorBackgroundHex,
    ThemeHighlightsHex: colorForField("ThemeHighlightsHex"),
    ThemeViewportBackgroundHex: colorForField("ThemeViewportBackgroundHex"),
    ThemeViewportGradientEnabled: true,
    ThemeViewportGradientHex: colorForField("ThemeViewportGradientHex")
  };
}

function buildThemeRoleAssignment(
  paletteHexes: string[],
  mode: ThemeVisualMode,
  options: {
    preferredHighlightsHex?: string;
    darknessProfile?: DarknessProfile | null;
  } = {}
): Partial<HdriWorldToolValues> {
  const palette = normalizePaletteHexes(paletteHexes);

  if (palette.length === 0) {
    return { ThemeVisualMode: mode };
  }

  if (options.darknessProfile) {
    return buildProfiledThemeRoleAssignment(palette, mode, options.darknessProfile);
  }

  const rolePalette = preferPaletteColors(palette);
  while (rolePalette.length < 5) {
    rolePalette.push(rolePalette[rolePalette.length - 1] ?? rolePalette[0]);
  }

  const darkest = rolePalette[0];
  const dark = rolePalette[1] ?? darkest;
  const middle = rolePalette[2] ?? dark;
  const light = rolePalette[3] ?? middle;
  const highlights =
    options.preferredHighlightsHex && isValidThemeHex(options.preferredHighlightsHex)
      ? options.preferredHighlightsHex.trim().toUpperCase()
      : mode === "light"
        ? middle
        : light;
  const darkText = pickPaletteTextHex(rolePalette, "light");
  const lightText = pickPaletteTextHex(rolePalette, "dark");

  if (mode === "light") {
    const usageCounts = new Map<string, number>();
    const colorForField = (field: ThemeToneRoleField): string => {
      const target = DEFAULT_LIGHT_TONE_TARGETS[field];
      const sampledHex = pickPaletteHexForTone(rolePalette, target, usageCounts);
      usageCounts.set(sampledHex, (usageCounts.get(sampledHex) ?? 0) + 1);
      return shiftHexTowardLuminance(sampledHex, target);
    };
    const editorBackgroundHex = colorForField("ThemeEditorBackgroundHex");

    return {
      ThemeVisualMode: "light",
      ThemeTabsHex: colorForField("ThemeTabsHex"),
      ThemeHeadersHex: colorForField("ThemeHeadersHex"),
      ThemeTextHex: darkText,
      ThemeControlTextHex: darkText,
      ThemeAccentTextHex: darkText,
      ThemeTabsTextHex: darkText,
      ThemeHeaderTextHex: darkText,
      ThemeEditorBackgroundHex: editorBackgroundHex,
      ThemeSceneHex: colorForField("ThemeSceneHex"),
      ThemeControlsHex: colorForField("ThemeControlsHex"),
      ThemeMiscHex: editorBackgroundHex,
      ThemeDarksHex: editorBackgroundHex,
      ThemeHighlightsHex: colorForField("ThemeHighlightsHex"),
      ThemeViewportBackgroundHex: colorForField("ThemeViewportBackgroundHex"),
      ThemeViewportGradientEnabled: true,
      ThemeViewportGradientHex: colorForField("ThemeViewportGradientHex")
    };
  }

  return {
    ThemeVisualMode: "dark",
    ThemeTabsHex: dark,
    ThemeHeadersHex: middle,
    ThemeMiscHex: dark,
    ThemeControlsHex: middle,
    ThemeTextHex: lightText,
    ThemeControlTextHex: lightText,
    ThemeAccentTextHex: lightText,
    ThemeTabsTextHex: lightText,
    ThemeHeaderTextHex: lightText,
    ThemeEditorBackgroundHex: darkest,
    ThemeSceneHex: dark,
    ThemeDarksHex: darkest,
    ThemeHighlightsHex: highlights,
    ThemeViewportBackgroundHex: darkest,
    ThemeViewportGradientEnabled: true,
    ThemeViewportGradientHex: dark
  };
}

function buildRefilledThemeRoleAssignment(
  values: HdriWorldToolValues
): Partial<HdriWorldToolValues> {
  const palette = normalizePaletteHexes([
    ...values.ThemePaletteHexes,
    values.ThemeTabsHex,
    values.ThemeHeadersHex,
    values.ThemeTextHex,
    values.ThemeControlTextHex,
    values.ThemeAccentTextHex,
    values.ThemeEditorBackgroundHex,
    values.ThemeSceneHex,
    values.ThemeControlsHex,
    values.ThemeHighlightsHex,
    values.ThemeViewportBackgroundHex,
    values.ThemeViewportGradientHex
  ]);
  const rolePalette = preferPaletteColors(palette.length > 0 ? palette : DEFAULT_THEME_PALETTE);
  while (rolePalette.length < 5) {
    rolePalette.push(rolePalette[rolePalette.length - 1] ?? rolePalette[0]);
  }

  const mode = values.ThemeVisualMode;
  const targets =
    mode === "light" ? DEFAULT_LIGHT_TONE_TARGETS : DEFAULT_DARK_TONE_TARGETS;
  const usageCounts = new Map<string, number>();
  const usedHues: number[] = [];
  const rememberHue = (hexValue: string) => {
    const hue = hexHueDegrees(hexValue);
    if (hue !== null) {
      usedHues.push(hue);
    }
  };
  const colorForField = (field: ThemeToneRoleField): string => {
    const baseTarget = targets[field];
    const jitter = (Math.random() - 0.5) * (mode === "light" ? 0.08 : 0.06);
    const target = Math.max(0.01, Math.min(0.58, baseTarget + jitter));
    const sampledHex = pickSpectrumPaletteHexForTone(
      rolePalette,
      target,
      usageCounts,
      usedHues
    );
    usageCounts.set(sampledHex, (usageCounts.get(sampledHex) ?? 0) + 1);
    rememberHue(sampledHex);
    return shiftHexTowardLuminance(sampledHex, target);
  };
  const textTarget =
    mode === "light" ? 0.07 + Math.random() * 0.08 : 0.82 + Math.random() * 0.12;
  const sampledTextHex = pickSpectrumPaletteHexForTone(
    rolePalette,
    textTarget,
    usageCounts,
    usedHues
  );
  usageCounts.set(sampledTextHex, (usageCounts.get(sampledTextHex) ?? 0) + 1);
  rememberHue(sampledTextHex);
  const textHex = shiftHexTowardLuminance(sampledTextHex, textTarget);
  const editorBackgroundHex = colorForField("ThemeEditorBackgroundHex");

  return {
    ThemePaletteHexes: palette.length > 0 ? palette : DEFAULT_THEME_PALETTE,
    ThemeVisualMode: mode,
    ThemeTabsHex: colorForField("ThemeTabsHex"),
    ThemeHeadersHex: colorForField("ThemeHeadersHex"),
    ThemeTextHex: textHex,
    ThemeControlTextHex: textHex,
    ThemeAccentTextHex: textHex,
    ThemeTabsTextHex: textHex,
    ThemeHeaderTextHex: textHex,
    ThemeEditorBackgroundHex: editorBackgroundHex,
    ThemeSceneHex: colorForField("ThemeSceneHex"),
    ThemeControlsHex: colorForField("ThemeControlsHex"),
    ThemeMiscHex: editorBackgroundHex,
    ThemeDarksHex: editorBackgroundHex,
    ThemeHighlightsHex: colorForField("ThemeHighlightsHex"),
    ThemeViewportBackgroundHex: colorForField("ThemeViewportBackgroundHex"),
    ThemeViewportGradientEnabled: values.ThemeViewportGradientEnabled,
    ThemeViewportGradientHex: colorForField("ThemeViewportGradientHex")
  };
}

const DEFAULT_HDRI_WORLD_TOOL_VALUES: HdriWorldToolValues = {
  HdriPath: "",
  StaticBackgroundPath: "",
  ThemeImagePath: "",
  ThemePaletteHexes: DEFAULT_THEME_PALETTE,
  ThemeVisualMode: "dark",
  ThemeTabsHex: "#2D383A",
  ThemeTabsTextHex: "#FFFFFF",
  ThemeHeadersHex: "#4D686B",
  ThemeHeaderTextHex: "#FFFFFF",
  ThemeTextHex: "#FFFFFF",
  ThemeControlTextHex: "#FFFFFF",
  ThemeAccentTextHex: "#FFFFFF",
  ThemeEditorBackgroundHex: "#1E2728",
  ThemeSceneHex: "#2D383A",
  ThemeControlsHex: "#4D686B",
  ThemeMiscHex: "#1E2728",
  ThemeDarksHex: "#1E2728",
  ThemeHighlightsHex: "#7BA8B7",
  ThemeViewportBackgroundHex: "#1E2728",
  ThemeViewportGradientEnabled: true,
  ThemeViewportGradientHex: "#2D383A",
  RotationXDeg: 90,
  RotationYDeg: 0,
  RotationZDeg: 30,
  WorldStrength: 0.25
};

function normalizeThemePalette(values: Record<string, unknown> | null | undefined): string[] {
  const paletteSource = values?.ThemePaletteHexes;
  if (Array.isArray(paletteSource)) {
    const normalized = paletteSource
      .map((value) => String(value ?? "").trim().toUpperCase())
      .filter(isValidThemeHex);
    return normalized.length > 0 ? normalized : DEFAULT_THEME_PALETTE;
  }
  if (typeof paletteSource === "string") {
    const normalized = paletteSource
      .split("|")
      .map((value) => value.trim().toUpperCase())
      .filter(isValidThemeHex);
    return normalized.length > 0 ? normalized : DEFAULT_THEME_PALETTE;
  }

  return DEFAULT_THEME_PALETTE;
}

function normalizeHdriWorldToolValues(
  values?: Record<string, unknown> | null
): HdriWorldToolValues {
  return {
    HdriPath: readString(values, "HdriPath", DEFAULT_HDRI_WORLD_TOOL_VALUES.HdriPath),
    StaticBackgroundPath: readString(
      values,
      "StaticBackgroundPath",
      DEFAULT_HDRI_WORLD_TOOL_VALUES.StaticBackgroundPath
    ),
    ThemeImagePath: readString(
      values,
      "ThemeImagePath",
      DEFAULT_HDRI_WORLD_TOOL_VALUES.ThemeImagePath
    ),
    ThemePaletteHexes: normalizeThemePalette(values),
    ThemeVisualMode:
      readString(values, "ThemeVisualMode", DEFAULT_HDRI_WORLD_TOOL_VALUES.ThemeVisualMode)
        .toLowerCase() === "light"
        ? "light"
        : "dark",
    ThemeTabsHex: readString(values, "ThemeTabsHex", DEFAULT_HDRI_WORLD_TOOL_VALUES.ThemeTabsHex)
      .trim()
      .toUpperCase(),
    ThemeTabsTextHex: readString(
      values,
      "ThemeTabsTextHex",
      DEFAULT_HDRI_WORLD_TOOL_VALUES.ThemeTabsTextHex
    )
      .trim()
      .toUpperCase(),
    ThemeHeadersHex: readString(
      values,
      "ThemeHeadersHex",
      DEFAULT_HDRI_WORLD_TOOL_VALUES.ThemeHeadersHex
    )
      .trim()
      .toUpperCase(),
    ThemeHeaderTextHex: readString(
      values,
      "ThemeHeaderTextHex",
      DEFAULT_HDRI_WORLD_TOOL_VALUES.ThemeHeaderTextHex
    )
      .trim()
      .toUpperCase(),
    ThemeTextHex: readString(values, "ThemeTextHex", DEFAULT_HDRI_WORLD_TOOL_VALUES.ThemeTextHex)
      .trim()
      .toUpperCase(),
    ThemeControlTextHex: readString(
      values,
      "ThemeControlTextHex",
      DEFAULT_HDRI_WORLD_TOOL_VALUES.ThemeControlTextHex
    )
      .trim()
      .toUpperCase(),
    ThemeAccentTextHex: readString(
      values,
      "ThemeAccentTextHex",
      DEFAULT_HDRI_WORLD_TOOL_VALUES.ThemeAccentTextHex
    )
      .trim()
      .toUpperCase(),
    ThemeEditorBackgroundHex: readString(
      values,
      "ThemeEditorBackgroundHex",
      DEFAULT_HDRI_WORLD_TOOL_VALUES.ThemeEditorBackgroundHex
    )
      .trim()
      .toUpperCase(),
    ThemeSceneHex: readString(values, "ThemeSceneHex", DEFAULT_HDRI_WORLD_TOOL_VALUES.ThemeSceneHex)
      .trim()
      .toUpperCase(),
    ThemeControlsHex: readString(
      values,
      "ThemeControlsHex",
      DEFAULT_HDRI_WORLD_TOOL_VALUES.ThemeControlsHex
    )
      .trim()
      .toUpperCase(),
    ThemeMiscHex: readString(values, "ThemeMiscHex", DEFAULT_HDRI_WORLD_TOOL_VALUES.ThemeMiscHex)
      .trim()
      .toUpperCase(),
    ThemeDarksHex: readString(values, "ThemeDarksHex", DEFAULT_HDRI_WORLD_TOOL_VALUES.ThemeDarksHex)
      .trim()
      .toUpperCase(),
    ThemeHighlightsHex: readString(
      values,
      "ThemeHighlightsHex",
      DEFAULT_HDRI_WORLD_TOOL_VALUES.ThemeHighlightsHex
    )
      .trim()
      .toUpperCase(),
    ThemeViewportBackgroundHex: readString(
      values,
      "ThemeViewportBackgroundHex",
      DEFAULT_HDRI_WORLD_TOOL_VALUES.ThemeViewportBackgroundHex
    )
      .trim()
      .toUpperCase(),
    ThemeViewportGradientEnabled: readBoolean(
      values,
      "ThemeViewportGradientEnabled",
      DEFAULT_HDRI_WORLD_TOOL_VALUES.ThemeViewportGradientEnabled
    ),
    ThemeViewportGradientHex: readString(
      values,
      "ThemeViewportGradientHex",
      DEFAULT_HDRI_WORLD_TOOL_VALUES.ThemeViewportGradientHex
    )
      .trim()
      .toUpperCase(),
    RotationXDeg: readNumber(values, "RotationXDeg", DEFAULT_HDRI_WORLD_TOOL_VALUES.RotationXDeg),
    RotationYDeg: readNumber(values, "RotationYDeg", DEFAULT_HDRI_WORLD_TOOL_VALUES.RotationYDeg),
    RotationZDeg: readNumber(values, "RotationZDeg", DEFAULT_HDRI_WORLD_TOOL_VALUES.RotationZDeg),
    WorldStrength: readNumber(values, "WorldStrength", DEFAULT_HDRI_WORLD_TOOL_VALUES.WorldStrength)
  };
}

function syncHdriWorldVisibleTextBuckets(
  values: HdriWorldToolValues,
  patch?: Partial<HdriWorldToolValues>
): HdriWorldToolValues {
  const nextValues = { ...values };
  nextValues.ThemeMiscHex = nextValues.ThemeEditorBackgroundHex;
  nextValues.ThemeDarksHex = nextValues.ThemeEditorBackgroundHex;

  if (!patch) {
    return nextValues;
  }

  const visibleTextTouched =
    "ThemeTextHex" in patch ||
    "ThemeControlTextHex" in patch ||
    "ThemeAccentTextHex" in patch ||
    "ThemeVisualMode" in patch;

  if (!visibleTextTouched) {
    return nextValues;
  }

  const darkTextHex = nextValues.ThemeControlTextHex || nextValues.ThemeTextHex;
  if (!("ThemeTabsTextHex" in patch)) {
    nextValues.ThemeTabsTextHex = darkTextHex;
  }
  if (!("ThemeHeaderTextHex" in patch)) {
    nextValues.ThemeHeaderTextHex = darkTextHex;
  }

  return nextValues;
}

function buildHdriWorldThemeSnapshot(values: HdriWorldToolValues): Record<string, unknown> {
  return {
    StaticBackgroundPath: values.StaticBackgroundPath,
    ThemeImagePath: values.ThemeImagePath,
    ThemePaletteHexes: [...values.ThemePaletteHexes],
    ThemeVisualMode: values.ThemeVisualMode,
    ThemeTabsHex: values.ThemeTabsHex,
    ThemeTabsTextHex: values.ThemeTabsTextHex,
    ThemeHeadersHex: values.ThemeHeadersHex,
    ThemeHeaderTextHex: values.ThemeHeaderTextHex,
    ThemeTextHex: values.ThemeTextHex,
    ThemeControlTextHex: values.ThemeControlTextHex,
    ThemeAccentTextHex: values.ThemeAccentTextHex,
    ThemeEditorBackgroundHex: values.ThemeEditorBackgroundHex,
    ThemeSceneHex: values.ThemeSceneHex,
    ThemeControlsHex: values.ThemeControlsHex,
    ThemeMiscHex: values.ThemeMiscHex,
    ThemeDarksHex: values.ThemeDarksHex,
    ThemeHighlightsHex: values.ThemeHighlightsHex,
    ThemeViewportBackgroundHex: values.ThemeViewportBackgroundHex,
    ThemeViewportGradientEnabled: values.ThemeViewportGradientEnabled,
    ThemeViewportGradientHex: values.ThemeViewportGradientHex
  };
}

function buildThemeToolboxStorageKey(context: ThemeToolboxWindowContext): string {
  return [
    "flowcell.themeToolbox",
    context.programName.trim().toLowerCase(),
    context.panelName.trim().toLowerCase(),
    context.fileName.trim().toLowerCase()
  ].join(".");
}

function readLocalStringPreference(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key);
    return value?.trim() ? value : null;
  } catch {
    return null;
  }
}

function writeLocalStringPreference(key: string, value: string | null | undefined): void {
  try {
    if (!value?.trim()) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(key, value);
  } catch {
  }
}

function normalizeDarknessProfileTarget(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeDarknessProfileList(value: unknown): DarknessProfile[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry): DarknessProfile | null => {
      const record = toObjectRecord(entry);
      if (!record) {
        return null;
      }

      const id = readString(record, "id", "").trim();
      const name = readString(record, "name", "").trim();
      const targetRecord = toObjectRecord(record.targets);
      if (!id || !name || !targetRecord) {
        return null;
      }

      const targets: Partial<Record<ThemeToneRoleField, number>> = {};
      for (const field of THEME_TONE_ROLE_FIELDS) {
        const target = normalizeDarknessProfileTarget(targetRecord[field]);
        if (target !== null) {
          targets[field] = target;
        }
      }

      return {
        id,
        name,
        targets,
        createdAt: readNumber(record, "createdAt", Date.now()),
        updatedAt: readNumber(record, "updatedAt", Date.now())
      };
    })
    .filter((entry): entry is DarknessProfile => Boolean(entry))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeDarknessProfileDocument(value: unknown): {
  profiles: DarknessProfile[];
  activeProfileId: string;
} {
  if (Array.isArray(value)) {
    return {
      profiles: normalizeDarknessProfileList(value),
      activeProfileId: ""
    };
  }

  const record = toObjectRecord(value);
  return {
    profiles: normalizeDarknessProfileList(record?.profiles),
    activeProfileId: readString(record, "activeProfileId", "").trim()
  };
}

function mergeDarknessProfileLists(
  primaryProfiles: DarknessProfile[],
  fallbackProfiles: DarknessProfile[]
): DarknessProfile[] {
  const profilesById = new Map<string, DarknessProfile>();
  for (const profile of fallbackProfiles) {
    profilesById.set(profile.id, profile);
  }
  for (const profile of primaryProfiles) {
    profilesById.set(profile.id, profile);
  }

  return Array.from(profilesById.values()).sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}

function readStoredDarknessProfiles(): DarknessProfile[] {
  try {
    const raw = window.localStorage.getItem(DARKNESS_PROFILE_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    return normalizeDarknessProfileList(JSON.parse(raw));
  } catch {
    return [];
  }
}

function writeStoredDarknessProfiles(profiles: DarknessProfile[]): void {
  try {
    window.localStorage.setItem(DARKNESS_PROFILE_STORAGE_KEY, JSON.stringify(profiles));
  } catch {
  }
}

function buildDarknessProfileId(name: string): string {
  const normalizedName = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const randomId =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `darkness-${normalizedName || "profile"}-${randomId}`;
}

function buildDarknessProfileTargets(
  values: HdriWorldToolValues
): Partial<Record<ThemeToneRoleField, number>> {
  const targets: Partial<Record<ThemeToneRoleField, number>> = {};
  for (const field of THEME_TONE_ROLE_FIELDS) {
    const hexValue = values[field];
    if (isValidThemeHex(hexValue)) {
      targets[field] = hexLuminance(hexValue);
    }
  }
  return targets;
}

function readStoredThemeToolValues(storageKey: string): HdriWorldToolValues {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return DEFAULT_HDRI_WORLD_TOOL_VALUES;
    }
    return syncHdriWorldVisibleTextBuckets(
      normalizeHdriWorldToolValues(toObjectRecord(JSON.parse(raw)))
    );
  } catch {
    return DEFAULT_HDRI_WORLD_TOOL_VALUES;
  }
}

function writeStoredThemeToolValues(storageKey: string, values: HdriWorldToolValues): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(values));
  } catch {
  }
}

function parentDirectoryFromPath(path: string | null | undefined): string | null {
  const normalized = path?.trim();
  if (!normalized) {
    return null;
  }

  const separatorIndex = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  if (separatorIndex <= 0) {
    return null;
  }

  return normalized.slice(0, separatorIndex);
}

function ensureJsonFileExtension(path: string): string {
  return path.toLowerCase().endsWith(".json") ? path : `${path}.json`;
}

function labelFromPath(path: string): string {
  const fileName = path.trim().split(/[\\/]/).pop() ?? "";
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

function isThemeToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  if (!record) {
    return false;
  }

  const normalizedBridgeAction = record.bridgeAction?.trim().toLowerCase() ?? "";
  if (normalizedBridgeAction === "flowcell_custom_theme") {
    return true;
  }

  const slots = new Set((record.children ?? []).map((child) => child.slot.trim().toLowerCase()));
  if (THEME_SIGNATURE_SLOTS.every((slot) => slots.has(slot))) {
    return true;
  }

  const normalizedLabel = record.label.trim().toLowerCase();
  const normalizedFileName = record.fileName.trim().toLowerCase();
  return (
    (record.children?.length ?? 0) > 0 &&
    (normalizedLabel === "theme" ||
      normalizedFileName === "theme.flowcell-panel-item.json" ||
      normalizedFileName.startsWith("theme."))
  );
}

function detailKeyToCamelCase(key: string): string {
  return key.replace(/_([a-z])/g, (_match, character: string) => character.toUpperCase());
}

function readDetailValue(details: Record<string, unknown>, key: string): unknown {
  if (key in details) {
    return details[key];
  }

  const camelKey = detailKeyToCamelCase(key);
  if (camelKey in details) {
    return details[camelKey];
  }

  const pascalKey = camelKey.charAt(0).toUpperCase() + camelKey.slice(1);
  return details[pascalKey];
}

function findThemeDetails(response: unknown): Record<string, unknown> {
  const root = toObjectRecord(response) ?? {};
  const detailRecord = toObjectRecord(root.details) ?? toObjectRecord(root.Details) ?? {};
  const resultRecord = toObjectRecord(root.result) ?? toObjectRecord(root.Result) ?? {};
  const legacyRecord = toObjectRecord(detailRecord.legacy_result);
  const candidates = [
    toObjectRecord(resultRecord.details),
    toObjectRecord(resultRecord.Details),
    resultRecord,
    toObjectRecord(detailRecord.details),
    toObjectRecord(detailRecord.Details),
    toObjectRecord(legacyRecord?.Details),
    toObjectRecord(legacyRecord?.details),
    detailRecord,
    root
  ].filter((entry): entry is Record<string, unknown> => Boolean(entry));

  return (
    candidates.find((candidate) =>
      ["tabs_hex", "headers_hex", "editor_background_hex", "viewport_background_hex"].some(
        (key) => readDetailValue(candidate, key) !== undefined
      )
    ) ?? root
  );
}

function normalizeThemeHexFromDetails(
  details: Record<string, unknown>,
  sourceKey: string,
  fallback: string
): string {
  const rawValue = readDetailValue(details, sourceKey);
  const normalized = typeof rawValue === "string" ? rawValue.trim().toUpperCase() : "";
  return isValidThemeHex(normalized) ? normalized : fallback;
}

function normalizeThemeBooleanFromDetails(
  details: Record<string, unknown>,
  sourceKey: string,
  fallback: boolean
): boolean {
  const rawValue = readDetailValue(details, sourceKey);
  if (typeof rawValue === "boolean") {
    return rawValue;
  }
  if (typeof rawValue === "string") {
    const normalized = rawValue.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return fallback;
}

const THEME_FIELD_BUCKET_KEYS: Partial<Record<keyof HdriWorldToolValues, string>> = {
  ThemeTabsHex: "tabs_hex",
  ThemeHeadersHex: "headers_hex",
  ThemeTextHex: "text_hex",
  ThemeControlTextHex: "control_text_hex",
  ThemeAccentTextHex: "accent_text_hex",
  ThemeEditorBackgroundHex: "editor_background_hex",
  ThemeSceneHex: "scene_hex",
  ThemeControlsHex: "controls_hex",
  ThemeHighlightsHex: "highlights_hex",
  ThemeViewportBackgroundHex: "viewport_background_hex",
  ThemeViewportGradientHex: "viewport_gradient_hex"
};

function buildThemeActionPayload(
  action: HdriWorldAction,
  values: HdriWorldToolValues
): Record<string, unknown> {
  if (
    action === "apply_theme_from_photo_manual_colors" ||
    action === "apply_theme_bucket"
  ) {
    return {
      command: action,
      visual_mode: values.ThemeVisualMode,
      tabs_hex: values.ThemeTabsHex,
      headers_hex: values.ThemeHeadersHex,
      text_hex: values.ThemeTextHex,
      control_text_hex: values.ThemeControlTextHex,
      accent_text_hex: values.ThemeAccentTextHex,
      tabs_text_hex: values.ThemeTabsTextHex,
      header_text_hex: values.ThemeHeaderTextHex,
      editor_background_hex: values.ThemeEditorBackgroundHex,
      scene_hex: values.ThemeSceneHex,
      controls_hex: values.ThemeControlsHex,
      borders_hex: values.ThemeEditorBackgroundHex,
      darks_hex: values.ThemeEditorBackgroundHex,
      highlights_hex: values.ThemeHighlightsHex,
      viewport_background_hex: values.ThemeViewportBackgroundHex,
      viewport_gradient_enabled: values.ThemeViewportGradientEnabled,
      viewport_gradient_hex: values.ThemeViewportGradientHex
    };
  }

  return {
    command: action,
    hdri_path: values.HdriPath,
    static_background_path: values.StaticBackgroundPath,
    rotation_x_deg: values.RotationXDeg,
    rotation_y_deg: values.RotationYDeg,
    rotation_z_deg: values.RotationZDeg,
    world_strength: values.WorldStrength
  };
}

function buildThemeBucketActionPayload(
  field: keyof HdriWorldToolValues,
  values: HdriWorldToolValues
): Record<string, unknown> {
  const bucket = THEME_FIELD_BUCKET_KEYS[field];
  if (!bucket) {
    throw new Error(`Theme bucket apply is not available for ${String(field)}.`);
  }

  return {
    ...buildThemeActionPayload("apply_theme_bucket", values),
    bucket,
    bucket_hex: values[field]
  };
}

export default function ThemeToolboxWindowPage({
  context
}: {
  context: ThemeToolboxWindowContext;
}) {
  const storageKey = useMemo(() => buildThemeToolboxStorageKey(context), [context]);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const surfaceContentRef = useRef<HTMLDivElement | null>(null);
  const [record, setRecord] = useState<PanelScriptFileRecord | null>(null);
  const [values, setValues] = useState<HdriWorldToolValues>(() =>
    readStoredThemeToolValues(storageKey)
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [darknessProfiles, setDarknessProfiles] = useState<DarknessProfile[]>(() =>
    readStoredDarknessProfiles()
  );
  const [activeDarknessProfileId, setActiveDarknessProfileId] = useState(
    () => readLocalStringPreference(ACTIVE_DARKNESS_PROFILE_STORAGE_KEY) ?? ""
  );
  const [darknessProfileDialogOpen, setDarknessProfileDialogOpen] = useState(false);
  const [darknessProfileName, setDarknessProfileName] = useState("");
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  const [viewportSize, setViewportSize] = useState({
    width: THEME_TOOLBOX_BASE_WIDTH,
    height: 640
  });
  const [surfaceContentSize, setSurfaceContentSize] = useState({
    width: THEME_TOOLBOX_BASE_WIDTH,
    height: 624
  });
  const latestValuesRef = useRef(values);
  const topmostResumeTimerRef = useRef<number | null>(null);
  const nativePickerOpenRef = useRef(false);
  const darknessProfileStoreLoadedRef = useRef(false);
  const darknessProfileStoreSaveTimerRef = useRef<number | null>(null);
  const surfaceScale = useMemo(() => {
    const availableWidth = Math.max(1, viewportSize.width - 16);
    const availableHeight = Math.max(1, viewportSize.height - 16);
    const baseWidth = Math.max(1, surfaceContentSize.width);
    const baseHeight = Math.max(1, surfaceContentSize.height);
    const nextScale = Math.min(availableWidth / baseWidth, availableHeight / baseHeight);
    if (!Number.isFinite(nextScale) || nextScale <= 0) {
      return 1;
    }

    return Math.min(THEME_TOOLBOX_MAX_SCALE, Math.max(THEME_TOOLBOX_MIN_SCALE, nextScale));
  }, [
    surfaceContentSize.height,
    surfaceContentSize.width,
    viewportSize.height,
    viewportSize.width
  ]);
  const activeDarknessProfile = useMemo(
    () =>
      darknessProfiles.find((profile) => profile.id === activeDarknessProfileId) ?? null,
    [activeDarknessProfileId, darknessProfiles]
  );

  useEffect(() => {
    const restoredValues = readStoredThemeToolValues(storageKey);
    latestValuesRef.current = restoredValues;
    setValues(restoredValues);
  }, [storageKey]);

  useEffect(() => {
    latestValuesRef.current = values;
    writeStoredThemeToolValues(storageKey, values);
  }, [storageKey, values]);

  useEffect(() => {
    let cancelled = false;

    void loadBlenderThemeDarknessProfiles()
      .then((document) => {
        if (cancelled) {
          return;
        }

        const loadedDocument = normalizeDarknessProfileDocument(document);
        const localProfiles = readStoredDarknessProfiles();
        const mergedProfiles = mergeDarknessProfileLists(
          loadedDocument.profiles,
          localProfiles
        );
        const activeProfileId =
          loadedDocument.activeProfileId ||
          readLocalStringPreference(ACTIVE_DARKNESS_PROFILE_STORAGE_KEY) ||
          "";

        darknessProfileStoreLoadedRef.current = true;
        setDarknessProfiles(mergedProfiles);
        setActiveDarknessProfileId(activeProfileId);
        writeStoredDarknessProfiles(mergedProfiles);
        writeLocalStringPreference(ACTIVE_DARKNESS_PROFILE_STORAGE_KEY, activeProfileId);
        void saveBlenderThemeDarknessProfiles({
          format: "flowcell-blender-darkness-profiles-v1",
          profiles: mergedProfiles,
          activeProfileId
        }).catch(() => {});
      })
      .catch(() => {
        darknessProfileStoreLoadedRef.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    writeLocalStringPreference(
      ACTIVE_DARKNESS_PROFILE_STORAGE_KEY,
      activeDarknessProfileId
    );
  }, [activeDarknessProfileId]);

  useEffect(() => {
    if (!darknessProfileStoreLoadedRef.current) {
      return;
    }

    writeStoredDarknessProfiles(darknessProfiles);
    if (darknessProfileStoreSaveTimerRef.current !== null) {
      window.clearTimeout(darknessProfileStoreSaveTimerRef.current);
    }
    darknessProfileStoreSaveTimerRef.current = window.setTimeout(() => {
      darknessProfileStoreSaveTimerRef.current = null;
      void saveBlenderThemeDarknessProfiles({
        format: "flowcell-blender-darkness-profiles-v1",
        profiles: darknessProfiles,
        activeProfileId: activeDarknessProfileId
      }).catch((error) => {
        setStatusMessage(`Could not save darkness profiles: ${formatErrorMessage(error)}`);
      });
    }, 120);
  }, [activeDarknessProfileId, darknessProfiles]);

  useEffect(() => {
    if (
      activeDarknessProfileId &&
      !darknessProfiles.some((profile) => profile.id === activeDarknessProfileId)
    ) {
      setActiveDarknessProfileId("");
    }
  }, [activeDarknessProfileId, darknessProfiles]);

  useEffect(() => {
    return () => {
      if (topmostResumeTimerRef.current !== null) {
        window.clearTimeout(topmostResumeTimerRef.current);
      }
      if (darknessProfileStoreSaveTimerRef.current !== null) {
        window.clearTimeout(darknessProfileStoreSaveTimerRef.current);
      }
    };
  }, []);

  const suspendScopedTopmost = async () => {
    if (topmostResumeTimerRef.current !== null) {
      window.clearTimeout(topmostResumeTimerRef.current);
      topmostResumeTimerRef.current = null;
    }

    const windowLabel = getCurrentWindow().label;
    await unregisterScopedWindowTopmost(windowLabel).catch(() => {});
    await setHostWindowTopmost(windowLabel, false).catch(() => {});
  };

  const refreshThemeScopedTopmost = async () => {
    const windowLabel = getCurrentWindow().label;
    await registerScopedWindowTopmost(windowLabel, context.programName, false);
    await refreshScopedWindowTopmost(windowLabel);
  };

  const resumeScopedTopmost = (delayMs = 200) => {
    if (topmostResumeTimerRef.current !== null) {
      window.clearTimeout(topmostResumeTimerRef.current);
    }

    topmostResumeTimerRef.current = window.setTimeout(() => {
      topmostResumeTimerRef.current = null;
      void refreshThemeScopedTopmost()
        .catch(() => {
          const windowLabel = getCurrentWindow().label;
          void setHostWindowTopmost(windowLabel, false).catch(() => {});
        });
    }, delayMs);
  };

  const runWithScopedTopmostSuspended = async <T,>(
    operation: () => Promise<T>
  ): Promise<T> => {
    await suspendScopedTopmost();
    try {
      return await operation();
    } finally {
      resumeScopedTopmost();
    }
  };

  const handleNativePickerOpen = () => {
    nativePickerOpenRef.current = true;
    void suspendScopedTopmost();
  };

  const handleNativePickerClose = (delayMs = 200) => {
    if (!nativePickerOpenRef.current) {
      return;
    }

    nativePickerOpenRef.current = false;
    resumeScopedTopmost(delayMs);
  };

  useEffect(() => {
    const handleWindowFocus = () => {
      handleNativePickerClose();
      void refreshThemeScopedTopmost().catch(() => {});
    };

    window.addEventListener("focus", handleWindowFocus);

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    void (async () => {
      try {
        const records = await listPanelScriptFiles(context.programName, context.panelName);
        if (cancelled) {
          return;
        }

        const nextRecord =
          records.find(
            (entry) => entry.fileName === context.fileName && isThemeToolboxRecord(entry)
          ) ?? null;

        if (!nextRecord) {
          setRecord(null);
          setLoadError(
            `Theme tool "${context.label ?? context.fileName}" was not found in ${context.panelName}.`
          );
          return;
        }

        setRecord(nextRecord);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setRecord(null);
        setLoadError(formatErrorMessage(error));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [context.fileName, context.label, context.panelName, context.programName]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }

      event.preventDefault();
      if (!event.repeat) {
        setSpaceDragActive(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }

      event.preventDefault();
      setSpaceDragActive(false);
      setSpaceDragging(false);
    };

    const handleWindowBlur = () => {
      setSpaceDragActive(false);
      setSpaceDragging(false);
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    if (!spaceDragActive) {
      setSpaceDragging(false);
    }
  }, [spaceDragActive]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") {
      return;
    }

    const updateViewportSize = () => {
      setViewportSize((current) => {
        const nextWidth = Math.max(1, Math.round(viewport.clientWidth));
        const nextHeight = Math.max(1, Math.round(viewport.clientHeight));
        return current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight };
      });
    };

    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(viewport);
    updateViewportSize();
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const surfaceContent = surfaceContentRef.current;
    if (!surfaceContent || typeof ResizeObserver === "undefined") {
      return;
    }

    const updateSurfaceContentSize = () => {
      setSurfaceContentSize((current) => {
        const nextWidth = Math.max(
          THEME_TOOLBOX_BASE_WIDTH,
          Math.ceil(surfaceContent.scrollWidth)
        );
        const nextHeight = Math.max(1, Math.ceil(surfaceContent.scrollHeight));
        return current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight };
      });
    };

    const observer = new ResizeObserver(updateSurfaceContentSize);
    observer.observe(surfaceContent);
    updateSurfaceContentSize();
    return () => {
      observer.disconnect();
    };
  }, [loading, loadError, record, statusMessage, values]);

  const updateValues = (patch: Partial<HdriWorldToolValues>) => {
    setValues((current) => {
      const nextValues = syncHdriWorldVisibleTextBuckets(
        normalizeHdriWorldToolValues({
          ...current,
          ...patch
        }),
        patch
      );
      latestValuesRef.current = nextValues;
      return nextValues;
    });
  };

  const startResizeDrag =
    (direction: ResizeDirection) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void getCurrentWindow().startResizeDragging(direction);
    };

  const handleShellPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    void getCurrentWindow().setFocus().catch(() => {});
    void refreshThemeScopedTopmost().catch(() => {});

    if (!spaceDragActive) {
      return;
    }

    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest(".theme-toolbox-window-page__resize-handle")
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSpaceDragging(true);
    void getCurrentWindow().startDragging().catch((error) => {
      console.error("Failed to start theme toolbox drag.", error);
      setSpaceDragging(false);
    });
  };

  const handleApply = async (
    action: HdriWorldAction,
    valuesOverride?: HdriWorldToolValues
  ) => {
    if (!record || pendingCommand) {
      return;
    }

    const currentValues = normalizeHdriWorldToolValues(
      valuesOverride ? { ...valuesOverride } : { ...latestValuesRef.current }
    );
    const commandKey = action;
    setPendingCommand(commandKey);
    setStatusMessage(null);

    try {
      await runBlenderToolsetAction({
        programName: context.programName,
        panelName: context.panelName,
        fileName: record.fileName,
        command: action,
        payload: buildThemeActionPayload(action, currentValues)
      });
    } catch (error) {
      setStatusMessage(formatErrorMessage(error));
    } finally {
      setPendingCommand(null);
    }
  };

  const handleAbsorbTheme = async () => {
    if (!record || pendingCommand) {
      return;
    }

    const currentValues = latestValuesRef.current;
    setPendingCommand("absorb_theme");
    setStatusMessage(null);

    try {
      const response = await runBlenderToolsetAction({
        programName: context.programName,
        panelName: context.panelName,
        fileName: record.fileName,
        command: "absorb_theme",
        payload: {
          command: "absorb_theme"
        }
      });
      const details = findThemeDetails(response);
      const collectionRowHex = normalizeThemeHexFromDetails(
        details,
        "scene_hex",
        currentValues.ThemeSceneHex
      );
      const controlsHex = normalizeThemeHexFromDetails(
        details,
        "controls_hex",
        currentValues.ThemeControlsHex
      );
      const highlightsHex = normalizeThemeHexFromDetails(
        details,
        "highlights_hex",
        currentValues.ThemeHighlightsHex
      );
      const patch: Partial<HdriWorldToolValues> = {
        ThemeTabsHex: normalizeThemeHexFromDetails(
          details,
          "tabs_hex",
          currentValues.ThemeTabsHex
        ),
        ThemeHeadersHex: normalizeThemeHexFromDetails(
          details,
          "headers_hex",
          currentValues.ThemeHeadersHex
        ),
        ThemeTextHex: normalizeThemeHexFromDetails(details, "text_hex", currentValues.ThemeTextHex),
        ThemeControlTextHex: normalizeThemeHexFromDetails(
          details,
          "control_text_hex",
          currentValues.ThemeControlTextHex
        ),
        ThemeAccentTextHex: normalizeThemeHexFromDetails(
          details,
          "accent_text_hex",
          currentValues.ThemeAccentTextHex
        ),
        ThemeTabsTextHex: normalizeThemeHexFromDetails(
          details,
          "tabs_text_hex",
          currentValues.ThemeTabsTextHex
        ),
        ThemeHeaderTextHex: normalizeThemeHexFromDetails(
          details,
          "header_text_hex",
          currentValues.ThemeHeaderTextHex
        ),
        ThemeEditorBackgroundHex: normalizeThemeHexFromDetails(
          details,
          "editor_background_hex",
          currentValues.ThemeEditorBackgroundHex
        ),
        ThemeSceneHex: collectionRowHex,
        ThemeControlsHex: controlsHex,
        ThemeMiscHex: normalizeThemeHexFromDetails(
          details,
          "misc_hex",
          currentValues.ThemeMiscHex
        ),
        ThemeDarksHex: normalizeThemeHexFromDetails(
          details,
          "darks_hex",
          currentValues.ThemeDarksHex
        ),
        ThemeHighlightsHex: highlightsHex,
        ThemeViewportBackgroundHex: normalizeThemeHexFromDetails(
          details,
          "viewport_background_hex",
          currentValues.ThemeViewportBackgroundHex
        ),
        ThemeViewportGradientEnabled: normalizeThemeBooleanFromDetails(
          details,
          "viewport_gradient_enabled",
          currentValues.ThemeViewportGradientEnabled
        ),
        ThemeViewportGradientHex: normalizeThemeHexFromDetails(
          details,
          "viewport_gradient_hex",
          currentValues.ThemeViewportGradientHex
        )
      };
      patch.ThemePaletteHexes = normalizePaletteHexes([
        patch.ThemeTabsHex,
        patch.ThemeHeadersHex,
        patch.ThemeTextHex,
        patch.ThemeControlTextHex,
        patch.ThemeAccentTextHex,
        patch.ThemeTabsTextHex,
        patch.ThemeHeaderTextHex,
        patch.ThemeEditorBackgroundHex,
        patch.ThemeSceneHex,
        patch.ThemeControlsHex,
        patch.ThemeMiscHex,
        patch.ThemeDarksHex,
        patch.ThemeHighlightsHex,
        patch.ThemeViewportBackgroundHex,
        patch.ThemeViewportGradientHex
      ].filter((value): value is string => typeof value === "string" && isValidThemeHex(value)));
      updateValues(patch);
    } catch (error) {
      setStatusMessage(formatErrorMessage(error));
    } finally {
      setPendingCommand(null);
    }
  };

  const handleRefillTheme = (valuesOverride: HdriWorldToolValues) => {
    const currentValues = normalizeHdriWorldToolValues({ ...valuesOverride });
    updateValues(buildRefilledThemeRoleAssignment(currentValues));
    setStatusMessage(null);
  };

  const handleFlipViewportGradient = (valuesOverride: HdriWorldToolValues) => {
    const currentValues = normalizeHdriWorldToolValues({ ...valuesOverride });
    updateValues({
      ThemeViewportBackgroundHex: currentValues.ThemeViewportGradientHex,
      ThemeViewportGradientHex: currentValues.ThemeViewportBackgroundHex
    });
    setStatusMessage(null);
  };

  const handleApplyThemeBucket = async (
    field: keyof HdriWorldToolValues,
    valuesOverride: HdriWorldToolValues
  ) => {
    if (!record || pendingCommand) {
      return;
    }

    const currentValues = normalizeHdriWorldToolValues({ ...valuesOverride });
    const commandKey = `apply_theme_bucket:${String(field)}`;
    setPendingCommand(commandKey);
    setStatusMessage(null);

    try {
      await runBlenderToolsetAction({
        programName: context.programName,
        panelName: context.panelName,
        fileName: record.fileName,
        command: "apply_theme_bucket",
        payload: buildThemeBucketActionPayload(field, currentValues)
      });
    } catch (error) {
      setStatusMessage(formatErrorMessage(error));
    } finally {
      setPendingCommand(null);
    }
  };

  const handleBrowsePath = async () => {
    setStatusMessage(null);
    try {
      const selectedPaths = await runWithScopedTopmostSuspended(() =>
        showOpenFileDialog({
          title: "Choose HDRI file",
          filter: "HDRI Files (*.exr;*.hdr)|*.exr;*.hdr|All Files (*.*)|*.*",
          initialDirectory: parentDirectoryFromPath(values.HdriPath) ?? undefined,
          multiselect: false
        })
      );
      if (selectedPaths.length > 0) {
        updateValues({ HdriPath: selectedPaths[0] });
      }
    } catch (error) {
      setStatusMessage(formatErrorMessage(error));
    }
  };

  const handleStaticBackgroundBrowse = async () => {
    setStatusMessage(null);
    try {
      const selectedPaths = await runWithScopedTopmostSuspended(() =>
        showOpenFileDialog({
          title: "Choose Place Picture image",
          filter:
            "Image Files (*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif;*.tif;*.tiff)|*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif;*.tif;*.tiff|All Files (*.*)|*.*",
          initialDirectory: parentDirectoryFromPath(values.StaticBackgroundPath) ?? undefined,
          multiselect: false
        })
      );
      if (selectedPaths.length > 0) {
        updateValues({ StaticBackgroundPath: selectedPaths[0] });
      }
    } catch (error) {
      setStatusMessage(formatErrorMessage(error));
    }
  };

  const handleThemeFromPhotoBrowse = async () => {
    setStatusMessage(null);
    try {
      const selectedPaths = await runWithScopedTopmostSuspended(() =>
        showOpenFileDialog({
          title: "Choose theme image",
          filter:
            "Image Files (*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif;*.tif;*.tiff)|*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif;*.tif;*.tiff|All Files (*.*)|*.*",
          initialDirectory: parentDirectoryFromPath(values.ThemeImagePath) ?? undefined,
          multiselect: false
        })
      );
      if (selectedPaths.length === 0) {
        return;
      }

      const sampled = await samplePhotoThemeColors(selectedPaths[0]);
      const namedPaletteHexes = [
        sampled.headersHex,
        sampled.textHex,
        sampled.sceneHex,
        sampled.controlsHex,
        sampled.miscHex,
        sampled.highlightsHex
      ].map((value) => value.toUpperCase());
      const sampledPaletteHexes = Array.isArray(sampled.paletteHexes)
        ? sampled.paletteHexes
            .map((value) => String(value ?? "").trim().toUpperCase())
            .filter(isValidThemeHex)
        : [];
      const paletteHexes = normalizePaletteHexes([
        ...sampledPaletteHexes,
        ...namedPaletteHexes
      ]);
      updateValues({
        ThemeImagePath: selectedPaths[0],
        ThemePaletteHexes: paletteHexes,
        ...buildThemeRoleAssignment(paletteHexes, "dark", {
          preferredHighlightsHex: sampled.highlightsHex.toUpperCase(),
          darknessProfile: activeDarknessProfile
        })
      });
    } catch (error) {
      setStatusMessage(formatErrorMessage(error));
    }
  };

  const handleThemeModeApply = (
    mode: ThemeVisualMode,
    valuesOverride: HdriWorldToolValues,
    profileId = activeDarknessProfileId
  ) => {
    const currentValues = normalizeHdriWorldToolValues({ ...valuesOverride });
    const darknessProfile =
      darknessProfiles.find((profile) => profile.id === profileId) ?? null;
    const paletteHexes =
      currentValues.ThemePaletteHexes.length > 0
        ? currentValues.ThemePaletteHexes
        : [
            currentValues.ThemeTabsHex,
            currentValues.ThemeHeadersHex,
            currentValues.ThemeTextHex,
            currentValues.ThemeSceneHex,
            currentValues.ThemeControlsHex
          ];
    updateValues({
      ...currentValues,
      ...buildThemeRoleAssignment(paletteHexes, mode, {
        preferredHighlightsHex: currentValues.ThemeHighlightsHex,
        darknessProfile
      })
    });
    setStatusMessage(null);
  };

  const handleDarknessProfileSelect = (
    profileId: string,
    valuesOverride: HdriWorldToolValues
  ) => {
    setActiveDarknessProfileId(profileId);
    handleThemeModeApply("dark", valuesOverride, profileId);
  };

  const handleOpenDarknessProfileDialog = () => {
    const defaultName = activeDarknessProfile
      ? `${activeDarknessProfile.name} Copy`
      : "Darkness Profile";
    setDarknessProfileName(defaultName);
    setDarknessProfileDialogOpen(true);
    setStatusMessage(null);
  };

  const handleSaveDarknessProfile = () => {
    const name = darknessProfileName.trim();
    if (!name) {
      setStatusMessage("Enter a darkness profile name.");
      return;
    }

    const now = Date.now();
    const profile: DarknessProfile = {
      id: buildDarknessProfileId(name),
      name,
      targets: buildDarknessProfileTargets(latestValuesRef.current),
      createdAt: now,
      updatedAt: now
    };
    const nextProfiles = [...darknessProfiles, profile].sort((left, right) =>
      left.name.localeCompare(right.name)
    );
    setDarknessProfiles(nextProfiles);
    writeStoredDarknessProfiles(nextProfiles);
    setActiveDarknessProfileId(profile.id);
    setDarknessProfileDialogOpen(false);
    setDarknessProfileName("");
    setStatusMessage(null);
  };

  const handleSaveTheme = async () => {
    const defaultThemeName = values.ThemeImagePath.trim()
      ? `${labelFromPath(values.ThemeImagePath)} Theme`
      : `${context.label ?? "Theme"} Theme`;
    const nextThemeName = window.prompt("Save Blender Theme As", defaultThemeName)?.trim();
    if (!nextThemeName) {
      return;
    }

    setStatusMessage(null);
    try {
      const selectedPath = await runWithScopedTopmostSuspended(() =>
        showSaveFileDialog({
          title: "Save Blender Theme",
          filter: "JSON Files (*.json)|*.json|All Files (*.*)|*.*",
          initialDirectory: readLocalStringPreference(LAST_BLENDER_THEME_DIRECTORY_KEY) ?? undefined
        })
      );
      if (!selectedPath) {
        return;
      }

      const resolvedPath = ensureJsonFileExtension(selectedPath);
      const savedPath = await saveBlenderThemeFile({
        suggestedName: nextThemeName,
        path: resolvedPath,
        values: buildHdriWorldThemeSnapshot(values)
      });
      writeLocalStringPreference(
        LAST_BLENDER_THEME_DIRECTORY_KEY,
        parentDirectoryFromPath(savedPath) ?? parentDirectoryFromPath(resolvedPath)
      );
    } catch (error) {
      setStatusMessage(formatErrorMessage(error));
    }
  };

  const handleLoadTheme = async () => {
    setStatusMessage(null);
    try {
      const selectedPaths = await runWithScopedTopmostSuspended(() =>
        showOpenFileDialog({
          title: "Load Blender Theme",
          filter: "JSON Files (*.json)|*.json|All Files (*.*)|*.*",
          initialDirectory: readLocalStringPreference(LAST_BLENDER_THEME_DIRECTORY_KEY) ?? undefined,
          multiselect: false
        })
      );
      if (selectedPaths.length === 0) {
        return;
      }

      writeLocalStringPreference(
        LAST_BLENDER_THEME_DIRECTORY_KEY,
        parentDirectoryFromPath(selectedPaths[0])
      );
      const loadedValues = await loadBlenderThemeFile(selectedPaths[0]);
      updateValues(normalizeHdriWorldToolValues({ ...values, ...loadedValues }));
    } catch (error) {
      setStatusMessage(formatErrorMessage(error));
    }
  };

  const shellClassName = [
    "theme-toolbox-window-page",
    spaceDragActive ? "theme-toolbox-window-page--space-drag" : "",
    spaceDragging ? "theme-toolbox-window-page--dragging" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={shellClassName} aria-label="Theme toolbox window">
      <div
        className="theme-toolbox-window-page__shell"
        onPointerDownCapture={handleShellPointerDown}
        onPointerUp={() => {
          setSpaceDragging(false);
        }}
        onPointerCancel={() => {
          setSpaceDragging(false);
        }}
      >
        <div
          className="theme-toolbox-window-page__resize-handle theme-toolbox-window-page__resize-handle--north"
          onPointerDown={startResizeDrag("North")}
        />
        <div
          className="theme-toolbox-window-page__resize-handle theme-toolbox-window-page__resize-handle--south"
          onPointerDown={startResizeDrag("South")}
        />
        <div
          className="theme-toolbox-window-page__resize-handle theme-toolbox-window-page__resize-handle--east"
          onPointerDown={startResizeDrag("East")}
        />
        <div
          className="theme-toolbox-window-page__resize-handle theme-toolbox-window-page__resize-handle--west"
          onPointerDown={startResizeDrag("West")}
        />
        <div
          className="theme-toolbox-window-page__resize-handle theme-toolbox-window-page__resize-handle--north-east"
          onPointerDown={startResizeDrag("NorthEast")}
        />
        <div
          className="theme-toolbox-window-page__resize-handle theme-toolbox-window-page__resize-handle--north-west"
          onPointerDown={startResizeDrag("NorthWest")}
        />
        <div
          className="theme-toolbox-window-page__resize-handle theme-toolbox-window-page__resize-handle--south-east"
          onPointerDown={startResizeDrag("SouthEast")}
        />
        <div
          className="theme-toolbox-window-page__resize-handle theme-toolbox-window-page__resize-handle--south-west"
          onPointerDown={startResizeDrag("SouthWest")}
        />

        <div ref={viewportRef} className="theme-toolbox-window-page__viewport">
          <div
            className="theme-toolbox-window-page__surface-stage"
            style={
              {
                width: `${surfaceContentSize.width * surfaceScale}px`,
                height: `${surfaceContentSize.height * surfaceScale}px`
              } as CSSProperties
            }
          >
            <div
              ref={surfaceContentRef}
              className="theme-toolbox-window-page__surface-content"
              style={
                {
                  transform: `scale(${surfaceScale})`
                } as CSSProperties
              }
            >
            {loading ? (
              <p className="theme-toolbox-window-page__status">Loading theme tool...</p>
            ) : loadError ? (
              <p className="theme-toolbox-window-page__status theme-toolbox-window-page__status--error">
                {loadError}
              </p>
            ) : (
              <HdriWorldToolSurface
                compact
                ownerLabel={record?.label ?? context.label ?? "Theme"}
                panelName={context.panelName}
                styleGroup={THEME_TOOLBOX_STYLE_GROUP}
                values={values}
                onValueChange={(field, value) => {
                  updateValues({ [field]: value } as Partial<HdriWorldToolValues>);
                }}
                onApply={(action, nextValues) => {
                  void handleApply(action, nextValues);
                }}
                onBrowsePath={() => {
                  void handleBrowsePath();
                }}
                onBrowseStaticBackgroundPath={() => {
                  void handleStaticBackgroundBrowse();
                }}
                onBrowseThemePath={() => {
                  void handleThemeFromPhotoBrowse();
                }}
                onNativePickerOpen={handleNativePickerOpen}
                onNativePickerClose={() => {
                  handleNativePickerClose(500);
                }}
                onAbsorbTheme={() => {
                  void handleAbsorbTheme();
                }}
                onRefillTheme={(nextValues) => {
                  handleRefillTheme(nextValues);
                }}
                onSaveTheme={() => {
                  void handleSaveTheme();
                }}
                onLoadTheme={() => {
                  void handleLoadTheme();
                }}
                onApplyThemeMode={(mode, nextValues) => {
                  handleThemeModeApply(mode, nextValues);
                }}
                onApplyThemeBucket={(field, nextValues) => {
                  void handleApplyThemeBucket(field, nextValues);
                }}
                onFlipViewportGradient={(nextValues) => {
                  handleFlipViewportGradient(nextValues);
                }}
                darknessProfiles={darknessProfiles.map((profile) => ({
                  id: profile.id,
                  name: profile.name
                }))}
                activeDarknessProfileId={activeDarknessProfileId}
                onSelectDarknessProfile={(profileId, nextValues) => {
                  handleDarknessProfileSelect(profileId, nextValues);
                }}
                onRequestSaveDarknessProfile={() => {
                  handleOpenDarknessProfileDialog();
                }}
              />
            )}
            </div>
            {statusMessage && (
              <p
                className={[
                  "theme-toolbox-window-page__status",
                  "theme-toolbox-window-page__status--overlay",
                  "theme-toolbox-window-page__status--settled"
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {statusMessage}
              </p>
            )}
            {darknessProfileDialogOpen && (
              <div className="theme-toolbox-window-page__dialog-backdrop">
                <form
                  className="theme-toolbox-window-page__dialog"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleSaveDarknessProfile();
                  }}
                >
                  <h2 className="theme-toolbox-window-page__dialog-title">
                    Save Darkness Profile
                  </h2>
                  <input
                    className="theme-toolbox-window-page__dialog-input"
                    type="text"
                    value={darknessProfileName}
                    onChange={(event) => setDarknessProfileName(event.target.value)}
                    placeholder="Profile name"
                  />
                  <div className="theme-toolbox-window-page__dialog-actions">
                    <button
                      className="theme-toolbox-window-page__dialog-button"
                      type="button"
                      onClick={() => {
                        setDarknessProfileDialogOpen(false);
                        setDarknessProfileName("");
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="theme-toolbox-window-page__dialog-button theme-toolbox-window-page__dialog-button--primary"
                      type="submit"
                    >
                      Save
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
