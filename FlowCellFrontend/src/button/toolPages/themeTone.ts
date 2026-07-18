import type { JsonValue } from "../types.js";
import type {
  ThemeWorkbenchColorRoleConfig,
  ThemeWorkbenchToneMode
} from "./themeWorkbenchTypes.js";

export const DEFAULT_THEME_WORKBENCH_PALETTE = [
  "#1E2728",
  "#F4F4EE",
  "#4D686B",
  "#7BA8B7",
  "#2D383A"
] as const;

const HEX_COLOR = /^#[0-9A-F]{6}$/i;

export function normalizeThemeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return HEX_COLOR.test(normalized) ? normalized : null;
}

function hexChannelToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function themeHexLuminance(value: string): number {
  const normalized = normalizeThemeHex(value);
  if (!normalized) return 0;
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  return (
    0.2126 * hexChannelToLinear(red) +
    0.7152 * hexChannelToLinear(green) +
    0.0722 * hexChannelToLinear(blue)
  );
}

function parseThemeHex(value: string): [number, number, number] | null {
  const normalized = normalizeThemeHex(value);
  if (!normalized) return null;
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16)
  ];
}

function rgbToThemeHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

/** Preserve the source hue while moving it toward a requested luminance. */
export function shiftThemeHexToLuminance(value: string, target: number): string {
  const source = parseThemeHex(value);
  if (!source) return value;
  const boundedTarget = Math.max(0, Math.min(1, target));
  const sourceLuminance = themeHexLuminance(value);
  if (Math.abs(sourceLuminance - boundedTarget) <= 0.006) {
    return normalizeThemeHex(value) ?? value;
  }

  const destination = boundedTarget > sourceLuminance ? 255 : 0;
  let low = 0;
  let high = 1;
  let best = normalizeThemeHex(value) ?? value;
  let bestDistance = Math.abs(sourceLuminance - boundedTarget);

  for (let index = 0; index < 18; index += 1) {
    const amount = (low + high) / 2;
    const candidate = rgbToThemeHex(
      source[0] + (destination - source[0]) * amount,
      source[1] + (destination - source[1]) * amount,
      source[2] + (destination - source[2]) * amount
    );
    const luminance = themeHexLuminance(candidate);
    const distance = Math.abs(luminance - boundedTarget);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
    if (boundedTarget > sourceLuminance) {
      if (luminance < boundedTarget) low = amount;
      else high = amount;
    } else if (luminance > boundedTarget) {
      low = amount;
    } else {
      high = amount;
    }
  }
  return best;
}

export function normalizeThemePalette(value: JsonValue | undefined): string[] {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[;,\s]+/)
      : [];
  return Array.from(new Set(candidates.map(normalizeThemeHex).filter((hex): hex is string => Boolean(hex))))
    .sort((left, right) => themeHexLuminance(left) - themeHexLuminance(right));
}

function usablePalette(palette: readonly string[]): string[] {
  const normalized = Array.from(new Set(palette.map(normalizeThemeHex).filter((hex): hex is string => Boolean(hex))))
    .sort((left, right) => themeHexLuminance(left) - themeHexLuminance(right));
  const chromatic = normalized.filter((hex) => hex !== "#000000" && hex !== "#FFFFFF");
  return chromatic.length >= 2 ? chromatic : normalized;
}

function nearestPaletteColor(
  palette: readonly string[],
  target: number,
  offset: number
): string {
  const ranked = [...palette].sort((left, right) => {
    const leftDistance = Math.abs(themeHexLuminance(left) - target);
    const rightDistance = Math.abs(themeHexLuminance(right) - target);
    return leftDistance - rightDistance || left.localeCompare(right);
  });
  return ranked[offset % ranked.length] ?? "#808080";
}

export interface BuildThemeTonePatchArgs {
  palette: readonly string[];
  roles: readonly ThemeWorkbenchColorRoleConfig[];
  visualModeFieldId: string;
  mode?: ThemeWorkbenchToneMode;
  level?: number;
  targetLuminanceByRoleId?: Readonly<Record<string, number>>;
}

/**
 * Deterministically stages role colors. `level` interpolates each role between
 * its dark and light targets while preserving the relative hierarchy supplied
 * by the manifest. Text roles switch to high-contrast dark/light values.
 */
export function buildThemeTonePatch({
  palette,
  roles,
  visualModeFieldId,
  mode,
  level,
  targetLuminanceByRoleId
}: BuildThemeTonePatchArgs): Record<string, JsonValue> {
  const normalizedPalette = usablePalette(
    palette.length > 0 ? palette : DEFAULT_THEME_WORKBENCH_PALETTE
  );
  const boundedLevel = typeof level === "number"
    ? Math.max(0, Math.min(1, level))
    : mode === "light"
      ? 1
      : 0;
  const resolvedMode: ThemeWorkbenchToneMode = mode ?? (boundedLevel >= 0.5 ? "light" : "dark");
  const patch: Record<string, JsonValue> = { [visualModeFieldId]: resolvedMode };
  const textHex = resolvedMode === "light"
    ? "#000000"
    : shiftThemeHexToLuminance(normalizedPalette.at(-1) ?? "#FFFFFF", 0.92);

  roles.forEach((role, index) => {
    let value: string;
    if (role.tone === "text") {
      value = textHex;
    } else {
      const darkTarget = role.tone?.dark ?? 0.04 + (index % 4) * 0.025;
      const lightTarget = role.tone?.light ?? 0.22 + (index % 4) * 0.04;
      const configuredTarget = darkTarget + boundedLevel * (lightTarget - darkTarget);
      const profileTarget = targetLuminanceByRoleId?.[role.id];
      const target = typeof profileTarget === "number" && Number.isFinite(profileTarget)
        ? Math.max(0, Math.min(1, profileTarget))
        : configuredTarget;
      const source = nearestPaletteColor(normalizedPalette, target, index);
      value = shiftThemeHexToLuminance(source, target);
    }
    patch[role.fieldId] = value;
    for (const mirrorFieldId of role.mirrorFieldIds ?? []) {
      patch[mirrorFieldId] = value;
    }
  });

  return patch;
}

function stableNoise(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

export interface BuildRefilledThemeRolePatchArgs extends BuildThemeTonePatchArgs {
  variant: number;
}

/**
 * Reassign sampled palette hues without feeding staged colors back into the
 * source palette. A variant number makes each refill different while keeping
 * the operation reproducible for tests and saved state.
 */
export function buildRefilledThemeRolePatch({
  palette,
  roles,
  visualModeFieldId,
  mode,
  level,
  variant
}: BuildRefilledThemeRolePatchArgs): Record<string, JsonValue> {
  const normalizedPalette = usablePalette(
    palette.length > 0 ? palette : DEFAULT_THEME_WORKBENCH_PALETTE
  );
  const boundedLevel = typeof level === "number"
    ? Math.max(0, Math.min(1, level))
    : mode === "light"
      ? 1
      : 0;
  const resolvedMode: ThemeWorkbenchToneMode = mode ?? (boundedLevel >= 0.5 ? "light" : "dark");
  const patch: Record<string, JsonValue> = { [visualModeFieldId]: resolvedMode };

  roles.forEach((role, index) => {
    const darkTarget = role.tone === "text"
      ? 0.86
      : role.tone?.dark ?? 0.04 + (index % 4) * 0.025;
    const lightTarget = role.tone === "text"
      ? 0.04
      : role.tone?.light ?? 0.22 + (index % 4) * 0.04;
    const baseTarget = darkTarget + boundedLevel * (lightTarget - darkTarget);
    const jitterScale = role.tone === "text" ? 0.035 : resolvedMode === "light" ? 0.08 : 0.06;
    const jitter = (stableNoise(`${role.id}:${Math.trunc(variant)}`) - 0.5) * jitterScale;
    const target = Math.max(0.01, Math.min(0.96, baseTarget + jitter));
    const source = nearestPaletteColor(
      normalizedPalette,
      target,
      Math.abs(Math.trunc(variant)) + index
    );
    const value = resolvedMode === "light" && role.tone === "text"
      ? "#000000"
      : shiftThemeHexToLuminance(source, target);
    patch[role.fieldId] = value;
    for (const mirrorFieldId of role.mirrorFieldIds ?? []) {
      patch[mirrorFieldId] = value;
    }
  });

  return patch;
}

export interface ThemeToneProfile {
  id: string;
  name: string;
  level: number;
  mode: ThemeWorkbenchToneMode;
  targetLuminanceByRoleId: Record<string, number>;
}

function profileIdForName(name: string): string {
  const normalized = name.trim().toLowerCase();
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "profile";
  const suffix = Math.floor(stableNoise(normalized) * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
  return `tone-${slug}-${suffix}`;
}

export function buildThemeToneProfile(args: {
  name: string;
  level: number;
  mode: ThemeWorkbenchToneMode;
  roles: readonly ThemeWorkbenchColorRoleConfig[];
  fieldValues: Readonly<Record<string, JsonValue>>;
}): ThemeToneProfile | null {
  const name = args.name.trim();
  if (!name) return null;
  const targetLuminanceByRoleId: Record<string, number> = {};
  for (const role of args.roles) {
    if (role.tone === "text") continue;
    const value = normalizeThemeHex(args.fieldValues[role.fieldId]);
    if (value) targetLuminanceByRoleId[role.id] = themeHexLuminance(value);
  }
  return {
    id: profileIdForName(name),
    name,
    level: Math.max(0, Math.min(1, args.level)),
    mode: args.mode,
    targetLuminanceByRoleId
  };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Normalize persisted profile data and discard role targets unknown to this package. */
export function normalizeThemeToneProfiles(
  value: unknown,
  roles: readonly ThemeWorkbenchColorRoleConfig[]
): ThemeToneProfile[] {
  if (!Array.isArray(value)) return [];
  const roleIds = new Set(roles.filter((role) => role.tone !== "text").map((role) => role.id));
  const profiles = value.flatMap((entry): ThemeToneProfile[] => {
    const record = objectRecord(entry);
    const id = typeof record?.id === "string" ? record.id.trim() : "";
    const name = typeof record?.name === "string" ? record.name.trim() : "";
    const level = record?.level;
    const mode = record?.mode;
    const rawTargets = objectRecord(record?.targetLuminanceByRoleId);
    if (!id || !name || typeof level !== "number" || !Number.isFinite(level) ||
      (mode !== "dark" && mode !== "light") || !rawTargets) {
      return [];
    }
    const targets: Record<string, number> = {};
    for (const [roleId, target] of Object.entries(rawTargets)) {
      if (roleIds.has(roleId) && typeof target === "number" && Number.isFinite(target)) {
        targets[roleId] = Math.max(0, Math.min(1, target));
      }
    }
    return [{
      id,
      name,
      level: Math.max(0, Math.min(1, level)),
      mode,
      targetLuminanceByRoleId: targets
    }];
  });
  return Array.from(new Map(profiles.map((profile) => [profile.id, profile])).values())
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function normalizeLegacyThemeToneState(args: {
  value: unknown;
  format: string;
  roleMap: Readonly<Record<string, string>>;
  roles: readonly ThemeWorkbenchColorRoleConfig[];
  mode?: ThemeWorkbenchToneMode;
  level?: number;
}): { activeProfileId: string; profiles: ThemeToneProfile[] } {
  const document = objectRecord(args.value);
  if (document?.format !== args.format || !Array.isArray(document.profiles)) {
    return { activeProfileId: "", profiles: [] };
  }
  const allowedRoleIds = new Set(
    args.roles.filter((role) => role.tone !== "text").map((role) => role.id)
  );
  const mode = args.mode === "light" ? "light" : "dark";
  const level = typeof args.level === "number" && Number.isFinite(args.level)
    ? Math.max(0, Math.min(1, args.level))
    : 0.3;
  const profiles = document.profiles.flatMap((entry): ThemeToneProfile[] => {
    const profile = objectRecord(entry);
    const id = typeof profile?.id === "string" ? profile.id.trim() : "";
    const name = typeof profile?.name === "string" ? profile.name.trim() : "";
    const rawTargets = objectRecord(profile?.targets);
    if (!id || !name || !rawTargets) return [];
    const targetLuminanceByRoleId: Record<string, number> = {};
    for (const [legacyRoleId, rawTarget] of Object.entries(rawTargets)) {
      const roleId = args.roleMap[legacyRoleId];
      if (roleId && allowedRoleIds.has(roleId) &&
        typeof rawTarget === "number" && Number.isFinite(rawTarget)) {
        targetLuminanceByRoleId[roleId] = Math.max(0, Math.min(1, rawTarget));
      }
    }
    if (Object.keys(targetLuminanceByRoleId).length === 0) return [];
    return [{ id, name, level, mode, targetLuminanceByRoleId }];
  });
  const normalized = Array.from(
    new Map(profiles.map((profile) => [profile.id, profile])).values()
  ).sort((left, right) => left.name.localeCompare(right.name));
  const requestedActiveProfileId = typeof document.activeProfileId === "string"
    ? document.activeProfileId.trim()
    : "";
  return {
    activeProfileId: normalized.some((profile) => profile.id === requestedActiveProfileId)
      ? requestedActiveProfileId
      : "",
    profiles: normalized
  };
}
