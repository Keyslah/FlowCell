import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { makeSafeTauriUnlisten } from "../lib/safeTauriUnlisten.js";
import {
  defaultMainThemeAppearance,
  mainThemeAppearanceToPageAppearance,
  pageAppearanceToMainThemeAppearance,
  type MainThemeAppearance
} from "./themeModel.js";
import {
  FLOWCELL_THEME_PAGE_IDS,
  cloneThemePageAppearance,
  defaultThemePageAppearance,
  getFlowCellThemePageDefinition,
  isThemePageAppearance,
  themePageTokenCssEntries,
  type FlowCellThemePageId,
  type ThemePageAppearance
} from "./themePageRegistry.js";

export const ACTIVE_PAGE_THEMES_STORAGE_KEY = "flowcell.active-page-themes.v1";
export const PAGE_THEME_CHANGED_EVENT = "flowcell:page-theme-changed";

/** @deprecated Kept only while callers migrate to the page-theme API. */
export const ACTIVE_MAIN_THEME_STORAGE_KEY = "flowcell.active-main-theme.v1";
/** @deprecated Use PAGE_THEME_CHANGED_EVENT. */
export const MAIN_THEME_CHANGED_EVENT = "flowcell:main-theme-changed";

export interface ActivePageThemesDocument {
  version: 1;
  pages: Partial<Record<FlowCellThemePageId, ThemePageAppearance>>;
}

export interface ThemePageChangedPayload {
  version: 1;
  appearance: ThemePageAppearance;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function defaultActivePageThemesDocument(): ActivePageThemesDocument {
  return {
    version: 1,
    pages: {}
  };
}

export function isActivePageThemesDocument(
  value: unknown
): value is ActivePageThemesDocument {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "pages"])) return false;
  if (value.version !== 1 || !isRecord(value.pages)) return false;
  const pages = value.pages;
  const pageIds = Object.keys(pages);
  if (pageIds.some((pageId) => !FLOWCELL_THEME_PAGE_IDS.includes(pageId as FlowCellThemePageId))) {
    return false;
  }
  return pageIds.every((pageId) => {
    const appearance = pages[pageId];
    return isThemePageAppearance(appearance) && appearance.pageId === pageId;
  });
}

function isThemePageChangedPayload(value: unknown): value is ThemePageChangedPayload {
  return isRecord(value) &&
    hasExactKeys(value, ["version", "appearance"]) &&
    value.version === 1 &&
    isThemePageAppearance(value.appearance);
}

function parseLegacyMainThemeAppearance(raw: string): ThemePageAppearance | null {
  try {
    const fallback = defaultMainThemeAppearance();
    const parsed = JSON.parse(raw) as Partial<MainThemeAppearance>;
    const appearance: MainThemeAppearance = {
      backgroundColor: typeof parsed.backgroundColor === "string" && parsed.backgroundColor.trim()
        ? parsed.backgroundColor
        : fallback.backgroundColor,
      backgroundImageMode:
        parsed.backgroundImageMode === "none" ||
        parsed.backgroundImageMode === "custom" ||
        parsed.backgroundImageMode === "default"
          ? parsed.backgroundImageMode
          : fallback.backgroundImageMode,
      backgroundImagePath: typeof parsed.backgroundImagePath === "string"
        ? parsed.backgroundImagePath
        : null,
      rails: {
        ...fallback.rails,
        ...(isRecord(parsed.rails) ? parsed.rails : {})
      }
    };
    const pageAppearance = mainThemeAppearanceToPageAppearance(appearance);
    return isThemePageAppearance(pageAppearance) ? pageAppearance : null;
  } catch {
    return null;
  }
}

function readStoredDocument(): ActivePageThemesDocument {
  const fallback = defaultActivePageThemesDocument();
  if (!canUseStorage()) return fallback;

  const raw = window.localStorage.getItem(ACTIVE_PAGE_THEMES_STORAGE_KEY);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isActivePageThemesDocument(parsed) ? structuredClone(parsed) : fallback;
    } catch {
      return fallback;
    }
  }

  const legacyMainRaw = window.localStorage.getItem(ACTIVE_MAIN_THEME_STORAGE_KEY);
  const legacyMain = legacyMainRaw ? parseLegacyMainThemeAppearance(legacyMainRaw) : null;
  if (legacyMain) fallback.pages.main = legacyMain;
  return fallback;
}

function writeStoredDocument(document: ActivePageThemesDocument): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(ACTIVE_PAGE_THEMES_STORAGE_KEY, JSON.stringify(document));
}

function updateStoredAppearance(appearance: ThemePageAppearance): ActivePageThemesDocument {
  const document = readStoredDocument();
  document.pages[appearance.pageId] = cloneThemePageAppearance(appearance);
  writeStoredDocument(document);
  return document;
}

export function readActiveThemePageAppearances(): ActivePageThemesDocument {
  return readStoredDocument();
}

export function readActiveThemePageAppearance(
  pageId: FlowCellThemePageId
): ThemePageAppearance {
  const appearance = readStoredDocument().pages[pageId];
  return appearance
    ? cloneThemePageAppearance(appearance)
    : defaultThemePageAppearance(pageId);
}

export async function authorizeThemePageAssets(
  appearance: ThemePageAppearance
): Promise<ThemePageAppearance> {
  if (!isThemePageAppearance(appearance)) {
    throw new Error("The page appearance is not valid for the FlowCell Theme registry.");
  }

  const authorized = cloneThemePageAppearance(appearance);
  const definition = getFlowCellThemePageDefinition(authorized.pageId);
  for (const assetDefinition of definition.assets) {
    const asset = authorized.assets[assetDefinition.id];
    if (asset.mode !== "custom") continue;
    const path = asset.path?.trim();
    if (!path) {
      throw new Error(`${assetDefinition.label} requires a file path.`);
    }
    const canonicalPath = await invoke<string>("authorize_flowcell_theme_asset", { path });
    if (!canonicalPath.trim()) {
      throw new Error(`${assetDefinition.label} could not be authorized.`);
    }
    asset.path = canonicalPath.trim();
  }
  return authorized;
}

function cssUrl(path: string): string {
  return `url("${convertFileSrc(path).replaceAll('"', "%22")}")`;
}

interface ThemePageCssUpdate {
  tokens: ReadonlyArray<readonly [string, string]>;
  assets: ReadonlyArray<readonly [string, string | null]>;
}

function buildThemePageCssUpdate(appearance: ThemePageAppearance): ThemePageCssUpdate {
  const definition = getFlowCellThemePageDefinition(appearance.pageId);
  return {
    tokens: themePageTokenCssEntries(appearance),
    assets: definition.assets.map((assetDefinition) => {
      const asset = appearance.assets[assetDefinition.id];
      const cssValue = asset.mode === "none"
        ? "none"
        : asset.mode === "custom" && asset.path
          ? cssUrl(asset.path)
          : null;
      return [assetDefinition.cssProperty, cssValue] as const;
    })
  };
}

function applyThemePageCssUpdate(update: ThemePageCssUpdate, root: HTMLElement): void {
  for (const [property, value] of update.tokens) {
    root.style.setProperty(property, value);
  }
  for (const [property, value] of update.assets) {
    if (value === null) root.style.removeProperty(property);
    else root.style.setProperty(property, value);
  }
}

export async function applyThemePageAppearance(
  appearance: ThemePageAppearance,
  root: HTMLElement = document.documentElement
): Promise<ThemePageAppearance> {
  const authorized = await authorizeThemePageAssets(appearance);
  applyThemePageCssUpdate(buildThemePageCssUpdate(authorized), root);
  return authorized;
}

export async function writeActiveThemePageAppearance(
  appearance: ThemePageAppearance
): Promise<ThemePageAppearance> {
  const authorized = await authorizeThemePageAssets(appearance);
  return writeAuthorizedThemePageAppearance(authorized);
}

export async function writeAuthorizedThemePageAppearance(
  authorized: ThemePageAppearance
): Promise<ThemePageAppearance> {
  if (!isThemePageAppearance(authorized)) {
    throw new Error("The authorized page appearance is not valid for the FlowCell Theme registry.");
  }
  const accepted = cloneThemePageAppearance(authorized);
  const cssUpdate = buildThemePageCssUpdate(accepted);
  updateStoredAppearance(accepted);
  if (typeof document !== "undefined") {
    applyThemePageCssUpdate(cssUpdate, document.documentElement);
  }
  const payload: ThemePageChangedPayload = {
    version: 1,
    appearance: cloneThemePageAppearance(accepted)
  };
  await emit(PAGE_THEME_CHANGED_EVENT, payload).catch(() => {});
  return cloneThemePageAppearance(accepted);
}

async function acceptIncomingAppearance(appearance: ThemePageAppearance): Promise<void> {
  const authorized = await authorizeThemePageAssets(appearance);
  const cssUpdate = buildThemePageCssUpdate(authorized);
  updateStoredAppearance(authorized);
  if (typeof document !== "undefined") {
    applyThemePageCssUpdate(cssUpdate, document.documentElement);
  }
}

export function installThemeRuntime(): () => void {
  let disposed = false;
  let unlisten: UnlistenFn | null = null;

  const applyStored = () => {
    const stored = readStoredDocument();
    for (const pageId of FLOWCELL_THEME_PAGE_IDS) {
      const appearance = stored.pages[pageId];
      if (appearance) void applyThemePageAppearance(appearance).catch(() => {});
    }
  };
  applyStored();

  const handleStorage = (event: StorageEvent) => {
    if (event.key === ACTIVE_PAGE_THEMES_STORAGE_KEY ||
        event.key === ACTIVE_MAIN_THEME_STORAGE_KEY ||
        event.key === null) {
      applyStored();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }

  void listen<unknown>(PAGE_THEME_CHANGED_EVENT, (event) => {
    if (!isThemePageChangedPayload(event.payload)) return;
    void acceptIncomingAppearance(event.payload.appearance).catch(() => {});
  })
    .then((dispose) => {
      const safeDispose = makeSafeTauriUnlisten(dispose);
      if (disposed) {
        safeDispose();
        return;
      }
      unlisten = safeDispose;
    })
    .catch(() => {});

  return () => {
    disposed = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
    if (unlisten) unlisten();
  };
}

/** @deprecated Use readActiveThemePageAppearance("main"). */
export function readActiveMainThemeAppearance(): MainThemeAppearance {
  return pageAppearanceToMainThemeAppearance(readActiveThemePageAppearance("main"));
}

/** @deprecated Use applyThemePageAppearance(). */
export async function applyMainThemeAppearance(
  appearance: MainThemeAppearance,
  root: HTMLElement = document.documentElement
): Promise<void> {
  await applyThemePageAppearance(mainThemeAppearanceToPageAppearance(appearance), root);
}

/** @deprecated Use writeActiveThemePageAppearance(). */
export async function writeActiveMainThemeAppearance(
  appearance: MainThemeAppearance
): Promise<void> {
  await writeActiveThemePageAppearance(mainThemeAppearanceToPageAppearance(appearance));
}
