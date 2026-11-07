import type { ButtonSkin } from "../types.js";
import { BUTTON_SKIN_FILE_EXTENSION, buttonSkinNameFromPath } from "./buttonSkinFormat.js";

const labelCharacters = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function buttonSkinLabelCharacterCount(label: string): number {
  return Array.from(labelCharacters.segment(label)).length;
}

export function isButtonSkinVariantCount(value: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value));
}

export function getEmbeddedButtonSkinFamilySources(skin: ButtonSkin): Record<string, string> | undefined {
  const sources = skin.metadata.buttonSkinEmbeddedVariants;
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) return;
  const entries = Object.entries(sources);
  if (entries.length && entries.every(([count, source]) => isButtonSkinVariantCount(count) && typeof source === "string")) {
    return sources as Record<string, string>;
  }
}

export function sameEmbeddedButtonSkinFamily(left: ButtonSkin, right: ButtonSkin): boolean {
  const leftSources = getEmbeddedButtonSkinFamilySources(left);
  const rightSources = getEmbeddedButtonSkinFamilySources(right);
  if (!leftSources || !rightSources) return leftSources === rightSources;
  const keys = Object.keys(leftSources);
  return keys.length === Object.keys(rightSources).length && keys.every((count) => leftSources[count] === rightSources[count]);
}

function matchesFamilyBaseline(skin: ButtonSkin, placementId: string, count: number): boolean {
  const baseline = skin.metadata.buttonSkinFamilyBaseline;
  return Boolean(baseline && typeof baseline === "object" && !Array.isArray(baseline) && baseline[placementId] === count);
}

export function rememberButtonSkinFamilyBaseline(skin: ButtonSkin, placementId: string, label: string): void {
  const baseline = skin.metadata.buttonSkinFamilyBaseline;
  skin.metadata.buttonSkinFamilyBaseline = {
    ...(baseline && typeof baseline === "object" && !Array.isArray(baseline) ? baseline : {}),
    [placementId]: buttonSkinLabelCharacterCount(label)
  };
}

export function resolveEmbeddedButtonSkinFamilySource(
  skin: ButtonSkin,
  placementId: string,
  label: string
): { count: number; source: string } | null {
  const sources = getEmbeddedButtonSkinFamilySources(skin);
  if (!sources) return null;
  const count = buttonSkinLabelCharacterCount(label);
  if (matchesFamilyBaseline(skin, placementId, count)) return null;
  const counts = Object.keys(sources).map(Number).sort((left, right) =>
    Math.abs(left - count) - Math.abs(right - count) || right - left
  );
  return { count: counts[0], source: sources[counts[0]] };
}

function isButtonSkinFamilyName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim() &&
    !/[<>:"/\\|?*\x00-\x1f]/.test(value) && !value.endsWith(".");
}

export function buttonSkinFamilyFromPath(path: string, skinDirectory: string): { name: string; count: number } | null {
  const root = skinDirectory.replaceAll("\\", "/").replace(/\/+$/, "");
  const normalizedPath = path.replaceAll("\\", "/");
  if (!normalizedPath.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return null;
  const [folder, file, extra] = normalizedPath.slice(root.length + 1).split("/");
  if (extra !== undefined || !isButtonSkinFamilyName(folder) || !file ||
      !file.toLowerCase().endsWith(BUTTON_SKIN_FILE_EXTENSION)) return null;
  const stem = buttonSkinNameFromPath(file).toLowerCase();
  const prefix = folder.toLowerCase();
  if (!stem.startsWith(prefix)) return null;
  const suffix = stem.slice(prefix.length);
  const count = Number(suffix);
  return isButtonSkinVariantCount(suffix) ? { name: folder, count } : null;
}

export function nearestButtonSkinFamilyPath(paths: string[], requestedPath: string, directory: string): string | null {
  const requested = buttonSkinFamilyFromPath(requestedPath, directory);
  if (!requested) return null;
  const candidates = paths.flatMap((path) => {
    const variant = buttonSkinFamilyFromPath(path, directory);
    return variant && variant.count !== requested.count && variant.name.toLowerCase() === requested.name.toLowerCase()
      ? [{ path, count: variant.count }]
      : [];
  });
  candidates.sort((left, right) =>
    Math.abs(left.count - requested.count) - Math.abs(right.count - requested.count) || right.count - left.count
  );
  return candidates[0]?.path ?? null;
}

export function withButtonSkinFamily(skin: ButtonSkin, family: string | null): ButtonSkin {
  const metadata = { ...skin.metadata };
  delete metadata.buttonSkinFamily;
  delete metadata.buttonSkinFamilyBaseline;
  delete metadata.buttonSkinEmbeddedVariants;
  if (family) metadata.buttonSkinFamily = family;
  return { ...skin, metadata };
}

export function buttonSkinFamilyVariantPath(skin: ButtonSkin, placementId: string, label: string): string | null {
  const family = skin.metadata.buttonSkinFamily;
  if (!isButtonSkinFamilyName(family)) return null;

  const count = buttonSkinLabelCharacterCount(label);
  // Existing assignments can keep their exact artwork at the original length.
  if (matchesFamilyBaseline(skin, placementId, count)) return null;
  return `${family}/${family}${count}${BUTTON_SKIN_FILE_EXTENSION}`;
}
