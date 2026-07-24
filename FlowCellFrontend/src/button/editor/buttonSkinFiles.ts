import type { ButtonSkin } from "../types.js";
import {
  BUTTON_SKIN_SECTION_ORDER,
  buttonSkinNameFromPath,
  createEmptyButtonSkinSections
} from "../skins/buttonSkinFormat.js";
import {
  applyNamedButtonSkinSections,
  parseButtonSkinPaste
} from "../skins/skinPasteParser.js";

const BUTTON_SKIN_RECENT_FILES_STORAGE_KEY = "flowcell.button-skin-recent-files.v1";
export const BUTTON_SKIN_RECENT_FILE_LIMIT = 8;

export interface ButtonSkinRecentFile {
  path: string;
  skinId: string;
}

export interface ButtonSkinFileResult {
  skin: ButtonSkin;
  path: string;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function buttonSkinPathKey(path: string): string {
  return path.trim().replaceAll("/", "\\").toLowerCase();
}

export function buttonSkinFilePathsEqual(left: string, right: string): boolean {
  return buttonSkinPathKey(left) === buttonSkinPathKey(right);
}

export function normalizeButtonSkinRecentFiles(
  value: unknown,
  limit = BUTTON_SKIN_RECENT_FILE_LIMIT
): ButtonSkinRecentFile[] {
  if (!Array.isArray(value) || limit <= 0) return [];
  const paths = new Set<string>();
  const skinIds = new Set<string>();
  const result: ButtonSkinRecentFile[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const path = "path" in candidate && typeof candidate.path === "string"
      ? candidate.path.trim()
      : "";
    const skinId = "skinId" in candidate && typeof candidate.skinId === "string"
      ? candidate.skinId.trim()
      : "";
    const pathKey = buttonSkinPathKey(path);
    if (!path || !skinId || paths.has(pathKey) || skinIds.has(skinId)) continue;
    paths.add(pathKey);
    skinIds.add(skinId);
    result.push({ path, skinId });
    if (result.length >= limit) break;
  }
  return result;
}

export function rememberButtonSkinRecentFile(
  current: readonly ButtonSkinRecentFile[],
  path: string,
  skinId: string
): ButtonSkinRecentFile[] {
  const nextEntry = normalizeButtonSkinRecentFiles([{ path, skinId }], 1)[0];
  if (!nextEntry) return normalizeButtonSkinRecentFiles(current);
  const nextPathKey = buttonSkinPathKey(nextEntry.path);
  return normalizeButtonSkinRecentFiles([
    nextEntry,
    ...current.filter(
      (entry) => buttonSkinPathKey(entry.path) !== nextPathKey && entry.skinId !== nextEntry.skinId
    )
  ]);
}

export function findButtonSkinRecentFile(
  recentFiles: readonly ButtonSkinRecentFile[],
  skinId: string
): ButtonSkinRecentFile | null {
  return recentFiles.find((entry) => entry.skinId === skinId) ?? null;
}

export function findButtonSkinRecentFileByPath(
  recentFiles: readonly ButtonSkinRecentFile[],
  path: string
): ButtonSkinRecentFile | null {
  return recentFiles.find((entry) => buttonSkinFilePathsEqual(entry.path, path)) ?? null;
}

export function readButtonSkinRecentFiles(): ButtonSkinRecentFile[] {
  if (!canUseStorage()) return [];
  try {
    const rawValue = window.localStorage.getItem(BUTTON_SKIN_RECENT_FILES_STORAGE_KEY);
    return rawValue ? normalizeButtonSkinRecentFiles(JSON.parse(rawValue)) : [];
  } catch {
    return [];
  }
}

export function writeButtonSkinRecentFiles(
  recentFiles: readonly ButtonSkinRecentFile[]
): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(
      BUTTON_SKIN_RECENT_FILES_STORAGE_KEY,
      JSON.stringify(normalizeButtonSkinRecentFiles(recentFiles))
    );
  } catch {
    // File loading and saving must still work when WebView storage is unavailable.
  }
}

export function createButtonSkinFromFile(
  source: string,
  path: string,
  skinId: string,
  existingSkin?: ButtonSkin | null
): ButtonSkin {
  const parsed = parseButtonSkinPaste(source);
  if (!parsed.ok) {
    throw new Error(parsed.line ? `${parsed.message} (line ${parsed.line})` : parsed.message);
  }
  const missingSections = BUTTON_SKIN_SECTION_ORDER.filter(
    (section) => !parsed.presentSections.includes(section)
  );
  if (missingSections.length > 0) {
    throw new Error(
      `Button skin file is missing canonical section${missingSections.length === 1 ? "" : "s"}: ${missingSections.join(", ")}.`
    );
  }
  const sections = applyNamedButtonSkinSections(
    createEmptyButtonSkinSections(),
    parsed
  );
  return {
    id: skinId,
    name: buttonSkinNameFromPath(path) || existingSkin?.name || "Button Skin",
    ...sections,
    metadata: { ...(existingSkin?.metadata ?? {}) },
    compileCache: null
  };
}
