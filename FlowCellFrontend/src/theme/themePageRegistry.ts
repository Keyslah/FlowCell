import type { ButtonSurfaceKind } from "../button/types.js";
import { normalizeButtonSkinColor } from "../button/skins/buttonSkinColors.js";
import { rails } from "../pages/main/mainLayout.js";

export const FLOWCELL_THEME_PAGE_IDS = ["main", "macro-lab", "binds"] as const;
export type FlowCellThemePageId = typeof FLOWCELL_THEME_PAGE_IDS[number];

export interface ThemePageTokenDefinition {
  id: string;
  label: string;
  group: string;
  cssProperty: `--flowcell-${string}`;
  defaultValue: string;
}

export interface ThemePageAssetDefinition {
  id: string;
  label: string;
  group: string;
  cssProperty: `--flowcell-${string}`;
  kind: "image";
}

export interface ThemePageAssetValue {
  mode: "default" | "none" | "custom";
  path: string | null;
}

export interface ThemePageAppearance {
  pageId: FlowCellThemePageId;
  tokens: Record<string, string>;
  assets: Record<string, ThemePageAssetValue>;
}

export interface ThemePageDefinition {
  id: FlowCellThemePageId;
  label: string;
  tokens: readonly ThemePageTokenDefinition[];
  assets: readonly ThemePageAssetDefinition[];
  buttonSurfaceKinds: readonly ButtonSurfaceKind[];
  buttonSurfaceIds: readonly string[];
  buttonSurfaceIdPrefixes: readonly string[];
}

const MAIN_PAGE_BUTTON_SURFACE_IDS = [
  "surface-flowcell-main-page-program-rail",
  "surface-flowcell-main-page-panel-rail",
  "surface-flowcell-main-page-button-section-rail",
  "surface-flowcell-main-page-header-buttons"
] as const;

function mainRailTokenDefinitions(): ThemePageTokenDefinition[] {
  return rails.flatMap((rail) => {
    const cssRailId = rail.id.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    return [
      {
        id: `rail-${rail.id}-background`,
        label: "Background",
        group: `${rail.name} Rail`,
        cssProperty: `--flowcell-main-rail-${cssRailId}-background` as const,
        defaultValue: rail.background
      },
      {
        id: `rail-${rail.id}-border`,
        label: "Border",
        group: `${rail.name} Rail`,
        cssProperty: `--flowcell-main-rail-${cssRailId}-border` as const,
        defaultValue: rail.border
      }
    ];
  });
}

const MAIN_TOKENS: readonly ThemePageTokenDefinition[] = [
  {
    id: "background-color",
    label: "Background",
    group: "Workspace",
    cssProperty: "--flowcell-main-background-color",
    defaultValue: "#9db678"
  },
  {
    id: "chrome-background",
    label: "Surface",
    group: "Main Chrome",
    cssProperty: "--flowcell-main-chrome-background",
    defaultValue: "rgba(12, 16, 18, 0.96)"
  },
  {
    id: "context-menu-background",
    label: "Context Menu Surface",
    group: "Main Chrome",
    cssProperty: "--flowcell-main-context-menu-background",
    defaultValue: "rgba(12, 16, 18, 0.94)"
  },
  {
    id: "poptype-background",
    label: "Panel Type Surface",
    group: "Main Chrome",
    cssProperty: "--flowcell-main-poptype-background",
    defaultValue: "rgba(16, 23, 28, 0.84)"
  },
  {
    id: "chrome-border",
    label: "Border",
    group: "Main Chrome",
    cssProperty: "--flowcell-main-chrome-border",
    defaultValue: "rgba(255, 255, 255, 0.12)"
  },
  {
    id: "poptype-border",
    label: "Panel Type Border",
    group: "Main Chrome",
    cssProperty: "--flowcell-main-poptype-border",
    defaultValue: "rgba(226, 234, 236, 0.36)"
  },
  {
    id: "chrome-text",
    label: "Text",
    group: "Main Chrome",
    cssProperty: "--flowcell-main-chrome-text",
    defaultValue: "rgba(241, 246, 248, 0.96)"
  },
  {
    id: "poptype-text",
    label: "Panel Type Text",
    group: "Main Chrome",
    cssProperty: "--flowcell-main-poptype-text",
    defaultValue: "rgba(241, 246, 248, 0.94)"
  },
  {
    id: "fan-menu-text",
    label: "Fan Menu Text",
    group: "Main Chrome",
    cssProperty: "--flowcell-main-fan-menu-text",
    defaultValue: "rgba(244, 247, 241, 0.96)"
  },
  {
    id: "chrome-muted-text",
    label: "Muted Text",
    group: "Main Chrome",
    cssProperty: "--flowcell-main-chrome-muted-text",
    defaultValue: "rgba(224, 231, 232, 0.76)"
  },
  {
    id: "chrome-control-background",
    label: "Control Background",
    group: "Main Chrome",
    cssProperty: "--flowcell-main-chrome-control-background",
    defaultValue: "rgba(255, 255, 255, 0.08)"
  },
  {
    id: "chrome-control-hover-background",
    label: "Control Hover Background",
    group: "Main Chrome",
    cssProperty: "--flowcell-main-chrome-control-hover-background",
    defaultValue: "rgba(255, 255, 255, 0.16)"
  },
  {
    id: "chrome-gradient-top",
    label: "Elevated Gradient Top",
    group: "Main Chrome",
    cssProperty: "--flowcell-main-chrome-gradient-top",
    defaultValue: "rgba(255, 255, 255, 0.14)"
  },
  {
    id: "chrome-gradient-bottom",
    label: "Elevated Gradient Bottom",
    group: "Main Chrome",
    cssProperty: "--flowcell-main-chrome-gradient-bottom",
    defaultValue: "rgba(255, 255, 255, 0.05)"
  },
  {
    id: "chrome-shadow",
    label: "Elevated Shadow",
    group: "Main Chrome",
    cssProperty: "--flowcell-main-chrome-shadow",
    defaultValue: "rgba(0, 0, 0, 0.34)"
  },
  {
    id: "chrome-inset-highlight",
    label: "Inset Highlight",
    group: "Main Chrome",
    cssProperty: "--flowcell-main-chrome-inset-highlight",
    defaultValue: "rgba(255, 255, 255, 0.08)"
  },
  {
    id: "settings-gradient-top",
    label: "Settings Gradient Top",
    group: "Main Chrome",
    cssProperty: "--flowcell-main-settings-gradient-top",
    defaultValue: "rgba(255, 255, 255, 0.12)"
  },
  {
    id: "settings-gradient-bottom",
    label: "Settings Gradient Bottom",
    group: "Main Chrome",
    cssProperty: "--flowcell-main-settings-gradient-bottom",
    defaultValue: "rgba(255, 255, 255, 0.04)"
  },
  {
    id: "settings-shadow",
    label: "Settings Shadow",
    group: "Main Chrome",
    cssProperty: "--flowcell-main-settings-shadow",
    defaultValue: "rgba(0, 0, 0, 0.42)"
  },
  {
    id: "overlay-background",
    label: "Backdrop",
    group: "Main Chrome",
    cssProperty: "--flowcell-main-overlay-background",
    defaultValue: "rgba(0, 0, 0, 0.42)"
  },
  {
    id: "error-background",
    label: "Background",
    group: "Errors",
    cssProperty: "--flowcell-main-error-background",
    defaultValue: "rgba(24, 25, 26, 0.96)"
  },
  {
    id: "error-border",
    label: "Border",
    group: "Errors",
    cssProperty: "--flowcell-main-error-border",
    defaultValue: "rgba(255, 134, 120, 0.44)"
  },
  {
    id: "error-text",
    label: "Text",
    group: "Errors",
    cssProperty: "--flowcell-main-error-text",
    defaultValue: "rgba(255, 247, 244, 0.96)"
  },
  {
    id: "error-detail-text",
    label: "Detail Text",
    group: "Errors",
    cssProperty: "--flowcell-main-error-detail-text",
    defaultValue: "rgba(255, 232, 227, 0.9)"
  },
  {
    id: "error-control-background",
    label: "Control Background",
    group: "Errors",
    cssProperty: "--flowcell-main-error-control-background",
    defaultValue: "rgba(255, 255, 255, 0.08)"
  },
  {
    id: "error-control-hover-background",
    label: "Control Hover Background",
    group: "Errors",
    cssProperty: "--flowcell-main-error-control-hover-background",
    defaultValue: "rgba(255, 255, 255, 0.16)"
  },
  {
    id: "error-shadow",
    label: "Shadow",
    group: "Errors",
    cssProperty: "--flowcell-main-error-shadow",
    defaultValue: "rgba(0, 0, 0, 0.32)"
  },
  ...mainRailTokenDefinitions()
];

const MACRO_LAB_TOKENS: readonly ThemePageTokenDefinition[] = [
  { id: "background", label: "Background", group: "Page", cssProperty: "--flowcell-macro-lab-background", defaultValue: "#101316" },
  { id: "surface", label: "Surface", group: "Page", cssProperty: "--flowcell-macro-lab-surface", defaultValue: "#171c21" },
  { id: "input", label: "Input", group: "Controls", cssProperty: "--flowcell-macro-lab-input", defaultValue: "#0e1317" },
  { id: "button", label: "Button", group: "Controls", cssProperty: "--flowcell-macro-lab-button", defaultValue: "#1a2127" },
  { id: "button-hover", label: "Button Hover", group: "Controls", cssProperty: "--flowcell-macro-lab-button-hover", defaultValue: "#202a32" },
  { id: "border", label: "Border", group: "Controls", cssProperty: "--flowcell-macro-lab-border", defaultValue: "#2e3942" },
  { id: "control-border", label: "Control Border", group: "Controls", cssProperty: "--flowcell-macro-lab-control-border", defaultValue: "#43505b" },
  { id: "text", label: "Text", group: "Text", cssProperty: "--flowcell-macro-lab-text", defaultValue: "#eef3f8" },
  { id: "heading-text", label: "Heading Text", group: "Text", cssProperty: "--flowcell-macro-lab-heading-text", defaultValue: "#f7fbff" },
  { id: "muted-text", label: "Muted Text", group: "Text", cssProperty: "--flowcell-macro-lab-muted-text", defaultValue: "#aeb9c2" },
  { id: "readout-text", label: "Readout Text", group: "Text", cssProperty: "--flowcell-macro-lab-readout-text", defaultValue: "#d9f8cf" },
  { id: "accent", label: "Accent", group: "Controls", cssProperty: "--flowcell-macro-lab-accent", defaultValue: "#73c0ff" },
  { id: "selection", label: "Selection", group: "Controls", cssProperty: "--flowcell-macro-lab-selection", defaultValue: "#18314a" },
  { id: "table-heading", label: "Table Heading", group: "Workspace", cssProperty: "--flowcell-macro-lab-table-heading", defaultValue: "#1d252c" },
  { id: "row-border", label: "Row Border", group: "Workspace", cssProperty: "--flowcell-macro-lab-row-border", defaultValue: "#202932" },
  { id: "row-hover", label: "Row Hover", group: "Workspace", cssProperty: "--flowcell-macro-lab-row-hover", defaultValue: "#1c252d" },
  { id: "status-border", label: "Status Border", group: "Status", cssProperty: "--flowcell-macro-lab-status-border", defaultValue: "#3c4650" },
  { id: "status-text", label: "Status Text", group: "Status", cssProperty: "--flowcell-macro-lab-status-text", defaultValue: "#c7d0d8" },
  { id: "success-background", label: "Success Background", group: "Status", cssProperty: "--flowcell-macro-lab-success-background", defaultValue: "#132017" },
  { id: "success-border", label: "Success Border", group: "Status", cssProperty: "--flowcell-macro-lab-success-border", defaultValue: "#326640" },
  { id: "success-text", label: "Success Text", group: "Status", cssProperty: "--flowcell-macro-lab-success-text", defaultValue: "#bef2c1" },
  { id: "error-background", label: "Error Background", group: "Status", cssProperty: "--flowcell-macro-lab-error-background", defaultValue: "#221416" },
  { id: "error-border", label: "Error Border", group: "Status", cssProperty: "--flowcell-macro-lab-error-border", defaultValue: "#744149" },
  { id: "error-text", label: "Error Text", group: "Status", cssProperty: "--flowcell-macro-lab-error-text", defaultValue: "#ffd1d1" }
];

const BINDS_TOKENS: readonly ThemePageTokenDefinition[] = [
  { id: "background", label: "Background", group: "Page", cssProperty: "--flowcell-binds-background", defaultValue: "#12161a" },
  { id: "surface", label: "Surface", group: "Page", cssProperty: "--flowcell-binds-surface", defaultValue: "#171c21" },
  { id: "input", label: "Input", group: "Controls", cssProperty: "--flowcell-binds-input", defaultValue: "#0f1418" },
  { id: "button", label: "Button", group: "Controls", cssProperty: "--flowcell-binds-button", defaultValue: "#1a2128" },
  { id: "border", label: "Border", group: "Controls", cssProperty: "--flowcell-binds-border", defaultValue: "#2d363f" },
  { id: "control-border", label: "Control Border", group: "Controls", cssProperty: "--flowcell-binds-control-border", defaultValue: "#44515d" },
  { id: "text", label: "Text", group: "Text", cssProperty: "--flowcell-binds-text", defaultValue: "#eef3f8" },
  { id: "heading-text", label: "Heading Text", group: "Text", cssProperty: "--flowcell-binds-heading-text", defaultValue: "#f7fbff" },
  { id: "muted-text", label: "Muted Text", group: "Text", cssProperty: "--flowcell-binds-muted-text", defaultValue: "#9fb0bf" },
  { id: "secondary-text", label: "Secondary Text", group: "Text", cssProperty: "--flowcell-binds-secondary-text", defaultValue: "#b4c0cb" },
  { id: "placeholder-text", label: "Placeholder Text", group: "Text", cssProperty: "--flowcell-binds-placeholder-text", defaultValue: "#7f8c98" },
  { id: "accent", label: "Accent", group: "Controls", cssProperty: "--flowcell-binds-accent", defaultValue: "#62b7ff" },
  { id: "selection", label: "Selection", group: "Controls", cssProperty: "--flowcell-binds-selection", defaultValue: "#1b2530" },
  { id: "status-background", label: "Status Background", group: "Status", cssProperty: "--flowcell-binds-status-background", defaultValue: "#12171c" },
  { id: "status-border", label: "Status Border", group: "Status", cssProperty: "--flowcell-binds-status-border", defaultValue: "#3c4650" },
  { id: "success-background", label: "Success Background", group: "Status", cssProperty: "--flowcell-binds-success-background", defaultValue: "#152118" },
  { id: "success-border", label: "Success Border", group: "Status", cssProperty: "--flowcell-binds-success-border", defaultValue: "#2f6741" },
  { id: "success-text", label: "Success Text", group: "Status", cssProperty: "--flowcell-binds-success-text", defaultValue: "#b7f3bc" },
  { id: "warning-background", label: "Warning Background", group: "Status", cssProperty: "--flowcell-binds-warning-background", defaultValue: "#271f10" },
  { id: "warning-border", label: "Warning Border", group: "Status", cssProperty: "--flowcell-binds-warning-border", defaultValue: "#80642e" },
  { id: "warning-text", label: "Warning Text", group: "Status", cssProperty: "--flowcell-binds-warning-text", defaultValue: "#ffe3a3" },
  { id: "error-background", label: "Error Background", group: "Status", cssProperty: "--flowcell-binds-error-background", defaultValue: "#221516" },
  { id: "error-border", label: "Error Border", group: "Status", cssProperty: "--flowcell-binds-error-border", defaultValue: "#704545" },
  { id: "error-text", label: "Error Text", group: "Status", cssProperty: "--flowcell-binds-error-text", defaultValue: "#ffd1d1" },
  { id: "item-background", label: "Item Background", group: "Lists", cssProperty: "--flowcell-binds-item-background", defaultValue: "#11161a" },
  { id: "item-border", label: "Item Border", group: "Lists", cssProperty: "--flowcell-binds-item-border", defaultValue: "#303944" },
  { id: "item-value-text", label: "Item Value Text", group: "Lists", cssProperty: "--flowcell-binds-item-value-text", defaultValue: "#d4e0ec" },
  { id: "item-detail-text", label: "Item Detail Text", group: "Lists", cssProperty: "--flowcell-binds-item-detail-text", defaultValue: "#c1d0dc" }
];

export const FLOWCELL_THEME_PAGE_REGISTRY: readonly ThemePageDefinition[] = [
  {
    id: "main",
    label: "Main",
    tokens: MAIN_TOKENS,
    assets: [{
      id: "background-image",
      label: "Background Image",
      group: "Workspace",
      cssProperty: "--flowcell-main-background-image",
      kind: "image"
    }],
    buttonSurfaceKinds: ["panel"],
    buttonSurfaceIds: MAIN_PAGE_BUTTON_SURFACE_IDS,
    buttonSurfaceIdPrefixes: ["surface-panel-owner-main-"]
  },
  {
    id: "macro-lab",
    label: "MacroLab",
    tokens: MACRO_LAB_TOKENS,
    assets: [],
    buttonSurfaceKinds: [],
    buttonSurfaceIds: [],
    buttonSurfaceIdPrefixes: []
  },
  {
    id: "binds",
    label: "Binds",
    tokens: BINDS_TOKENS,
    assets: [],
    buttonSurfaceKinds: [],
    buttonSurfaceIds: [],
    buttonSurfaceIdPrefixes: []
  }
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function isFlowCellThemePageId(value: unknown): value is FlowCellThemePageId {
  return typeof value === "string" && FLOWCELL_THEME_PAGE_IDS.includes(value as FlowCellThemePageId);
}

export function getFlowCellThemePageDefinition(
  pageId: FlowCellThemePageId
): ThemePageDefinition {
  const definition = FLOWCELL_THEME_PAGE_REGISTRY.find((entry) => entry.id === pageId);
  if (!definition) throw new Error(`FlowCell Theme page '${pageId}' is not registered.`);
  return definition;
}

export function themePageSupportsButtonSurface(
  pageId: FlowCellThemePageId,
  surface: { id: string; kind: ButtonSurfaceKind }
): boolean {
  const definition = getFlowCellThemePageDefinition(pageId);
  return definition.buttonSurfaceIds.includes(surface.id) ||
    definition.buttonSurfaceIdPrefixes.some((prefix) => surface.id.startsWith(prefix)) ||
    definition.buttonSurfaceKinds.includes(surface.kind);
}

export function defaultThemePageAppearance(pageId: FlowCellThemePageId): ThemePageAppearance {
  const definition = getFlowCellThemePageDefinition(pageId);
  return {
    pageId,
    tokens: Object.fromEntries(definition.tokens.map((token) => [token.id, token.defaultValue])),
    assets: Object.fromEntries(definition.assets.map((asset) => [
      asset.id,
      { mode: "default", path: null } satisfies ThemePageAssetValue
    ]))
  };
}

export function isThemePageAppearance(value: unknown): value is ThemePageAppearance {
  if (!isRecord(value) || !hasExactKeys(value, ["pageId", "tokens", "assets"])) return false;
  if (!isFlowCellThemePageId(value.pageId) || !isRecord(value.tokens) || !isRecord(value.assets)) {
    return false;
  }
  const definition = getFlowCellThemePageDefinition(value.pageId);
  const tokenIds = definition.tokens.map((token) => token.id);
  if (!hasExactKeys(value.tokens, tokenIds)) return false;
  if (Object.values(value.tokens).some(
    (token) => typeof token !== "string" || normalizeButtonSkinColor(token) === null
  )) {
    return false;
  }
  const assetIds = definition.assets.map((asset) => asset.id);
  if (!hasExactKeys(value.assets, assetIds)) return false;
  return Object.values(value.assets).every((asset) => {
    if (!isRecord(asset) || !hasExactKeys(asset, ["mode", "path"])) return false;
    if (asset.mode !== "default" && asset.mode !== "none" && asset.mode !== "custom") return false;
    if (asset.mode === "custom") return typeof asset.path === "string" && Boolean(asset.path.trim());
    return asset.path === null;
  });
}

export function cloneThemePageAppearance(appearance: ThemePageAppearance): ThemePageAppearance {
  return structuredClone(appearance);
}

export function themePageTokenCssEntries(
  appearance: ThemePageAppearance
): ReadonlyArray<readonly [string, string]> {
  const definition = getFlowCellThemePageDefinition(appearance.pageId);
  return definition.tokens.map((token) => [token.cssProperty, appearance.tokens[token.id]] as const);
}
