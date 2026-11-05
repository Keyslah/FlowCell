import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { makeSafeTauriUnlisten } from "../lib/safeTauriUnlisten.js";
import concreteBackground from "../assets/backgrounds/concrete.jpg";
import chippedConcreteBase from "../assets/backgrounds/chipped-concrete-base.webp";
import chippedConcreteRailButtons from "../assets/backgrounds/chipped-concrete-rail-buttons.webp";
import chippedConcreteRailInfo from "../assets/backgrounds/chipped-concrete-rail-info.webp";
import chippedConcreteRailPanel from "../assets/backgrounds/chipped-concrete-rail-panel.webp";
import chippedConcreteRailProgram from "../assets/backgrounds/chipped-concrete-rail-program.webp";
import { MAIN_PAGE_BASE_OFFSET, RAIL_SLAB_BLEED_PX, rails } from "../pages/main/mainLayout.js";
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
const SELECTED_THEME_STORAGE_KEY = "flowcell.selected-themes.v1";
let themePathMigration: Promise<void> | null = null;

export function migrateStoredThemePaths(): Promise<void> {
  if (themePathMigration) return themePathMigration;
  themePathMigration = (async () => {
    if (!canUseStorage()) return;
    const mappings = await invoke<{ from: string; to: string }[]>("get_theme_migration_path_map");
    const normalized = (value: string) => value.replaceAll("\\", "/").toLowerCase();
    const remap = (value: unknown): unknown => {
      if (typeof value === "string") {
        const path = normalized(value);
        const match = mappings.filter((entry) => path === normalized(entry.from) || path.startsWith(`${normalized(entry.from)}/`))
          .sort((a, b) => b.from.length - a.from.length)[0];
        return match ? match.to + value.slice(match.from.length) : value;
      }
      if (Array.isArray(value)) return value.map(remap);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)]));
      return value;
    };
    for (const key of [ACTIVE_PAGE_THEMES_STORAGE_KEY, ACTIVE_MAIN_THEME_STORAGE_KEY, SELECTED_THEME_STORAGE_KEY]) {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const updated = JSON.stringify(remap(JSON.parse(raw)));
        if (updated !== raw) window.localStorage.setItem(key, updated);
      } catch { /* Preserve unreadable previous state for recovery. */ }
    }
  })().catch((error) => { themePathMigration = null; throw error; });
  return themePathMigration;
}

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
  /** Main page updates only: whether the main window keeps its system frame shadow. */
  mainWindowShadow?: boolean;
}

// Chipped Concrete is three stacked levels of the same rendered concrete. The window's frame is the
// base: one frame-sized slab picture (10 px tall, long worn stretches along its edges, a broken
// corner and a worn round one, its own shadow), transparent past its edges so the window takes the
// slab's shape. The page sits at MAIN_PAGE_BASE_OFFSET on it, so the base reaches just past the
// rails' shadows. Its fill turns clear, and the base picture also masks the rail slabs and header
// Buttons so their shadows stop at the slab's edge instead of darkening what is behind the window.
//
// The rails are raised slabs rendered in Blender (Key Studio's Chipped Concrete, 20 px
// tall, sharp corners, broken chunks, lit like the keys), one unique picture per rail. Each record
// keeps the picture's size and where the slab's top face landed in it (left, top, right, bottom in
// picture px); that face is laid exactly over the rail, so the front edge, chunks and shadow reach
// out into the rail's slab layer. The rails' own blur is turned off so it cannot smear the slabs.
const CHIPPED_CONCRETE_RAIL_SLABS: Readonly<Record<string, {
  url: string;
  size: readonly [number, number];
  face: readonly [number, number, number, number];
}>> = {
  "program-rail": { url: chippedConcreteRailProgram, size: [445, 1316], face: [31.095, 32.002, 357.935, 1209.251] },
  "panel-rail": { url: chippedConcreteRailPanel, size: [445, 1316], face: [31.095, 32.002, 357.935, 1209.251] },
  "buttons-rail": { url: chippedConcreteRailButtons, size: [1382, 1316], face: [30.994, 32.013, 1294.733, 1205.483] },
  "info-rail": { url: chippedConcreteRailInfo, size: [517, 1316], face: [31.074, 32.001, 429.647, 1208.476] }
};

function chippedConcreteRailSlabEntries(): Array<readonly [string, string]> {
  const entries: Array<readonly [string, string]> = [
    ["--flowcell-main-rail-backdrop-filter", "none"],
    ["--flowcell-main-background-fill", "transparent"],
    ["--flowcell-main-base-mask", `url("${chippedConcreteBase}")`],
    ["--flowcell-main-page-left", `${MAIN_PAGE_BASE_OFFSET.left}px`],
    ["--flowcell-main-page-top", `${MAIN_PAGE_BASE_OFFSET.top}px`]
  ];
  for (const rail of rails) {
    const slab = CHIPPED_CONCRETE_RAIL_SLABS[rail.id];
    if (!slab) continue;
    const [left, top, right, bottom] = slab.face;
    const scaleX = rail.width / (right - left);
    const scaleY = rail.height / (bottom - top);
    const px = (value: number) => `${Math.round(value * 1000) / 1000}px`;
    const cssRailId = rail.id.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    entries.push([
      `--flowcell-main-rail-${cssRailId}-slab`,
      `url("${slab.url}") ${px(RAIL_SLAB_BLEED_PX - left * scaleX)} ${px(RAIL_SLAB_BLEED_PX - top * scaleY)} / ` +
        `${px(slab.size[0] * scaleX)} ${px(slab.size[1] * scaleY)} no-repeat`
    ]);
  }
  return entries;
}

const CHIPPED_CONCRETE_RAIL_SLAB = chippedConcreteRailSlabEntries();

function isChippedConcreteMain(appearance: ThemePageAppearance): boolean {
  return appearance.pageId === "main" && appearance.assets["background-image"]?.mode === "chipped-concrete";
}

function mainRailSlabCssEntries(
  appearance: ThemePageAppearance
): ReadonlyArray<readonly [string, string | null]> {
  if (appearance.pageId !== "main") return [];
  const slab = isChippedConcreteMain(appearance);
  return CHIPPED_CONCRETE_RAIL_SLAB.map(([property, value]) => [property, slab ? value : null] as const);
}

function buildThemePageCssUpdate(appearance: ThemePageAppearance): ThemePageCssUpdate {
  const definition = getFlowCellThemePageDefinition(appearance.pageId);
  return {
    tokens: themePageTokenCssEntries(appearance),
    assets: [
      ...definition.assets.map((assetDefinition) => {
        const asset = appearance.assets[assetDefinition.id];
        const cssValue = asset.mode === "none"
          ? "none"
          : asset.mode === "concrete"
            ? `url("${concreteBackground}")`
            : asset.mode === "chipped-concrete"
              ? `url("${chippedConcreteBase}")`
              : asset.mode === "custom" && asset.path
                ? cssUrl(asset.path)
                : null;
        return [assetDefinition.cssProperty, cssValue] as const;
      }),
      ...mainRailSlabCssEntries(appearance)
    ],
    mainWindowShadow: appearance.pageId === "main" ? !isChippedConcreteMain(appearance) : undefined
  };
}

// The main window starts with its system frame shadow (tauri.conf.json leaves it on). Around a
// see-through window that shadow and its 1 px frame would outline the whole rectangle, so it is
// off while the Chipped Concrete base gives the window its own outline, and back on otherwise.
let mainWindowShadow = true;

function syncMainWindowShadow(shadow: boolean | undefined): void {
  if (shadow === undefined || shadow === mainWindowShadow) return;
  let current: ReturnType<typeof getCurrentWindow>;
  try {
    current = getCurrentWindow();
  } catch {
    return;
  }
  if (current.label !== "main") return;
  mainWindowShadow = shadow;
  void current.setShadow(shadow).catch(() => {});
}

function applyThemePageCssUpdate(update: ThemePageCssUpdate, root: HTMLElement): void {
  for (const [property, value] of update.tokens) {
    root.style.setProperty(property, value);
  }
  for (const [property, value] of update.assets) {
    if (value === null) root.style.removeProperty(property);
    else root.style.setProperty(property, value);
  }
  syncMainWindowShadow(update.mainWindowShadow);
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
  void migrateStoredThemePaths().then(() => { if (!disposed) applyStored(); }).catch(() => { if (!disposed) applyStored(); });

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
