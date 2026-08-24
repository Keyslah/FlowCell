import type {
  ButtonPlacement,
  ButtonSkin,
  ButtonSourceIdentity,
  ButtonStateDocument,
  ButtonSurfaceKind
} from "../button/types.js";
import { cloneButtonDocument } from "../button/state/buttonDefaults.js";
import {
  alignButtonPlacementSelectionToTopLeftButton,
  buttonSpacingPixelsFromMillimeters
} from "../button/geometry/buttonGeometry.js";
import { rails } from "../pages/main/mainLayout.js";

export const FLOWCELL_THEME_KIND = "FlowCellTheme" as const;
export const FLOWCELL_THEME_VERSION = 1 as const;

export type ThemeTarget =
  | { kind: "flowcell"; page: "main" }
  | { kind: "program"; programName: string; panelName: string | null };

export interface MainRailThemeAppearance {
  background: string;
  border: string;
}

export interface MainThemeAppearance {
  backgroundColor: string;
  backgroundImageMode: "default" | "none" | "custom";
  backgroundImagePath: string | null;
  rails: Record<string, MainRailThemeAppearance>;
}

export interface ButtonThemeAppearance {
  placementId: string;
  buttonId: string;
  surfaceId: string;
  surfaceName: string;
  surfaceKind: ButtonSurfaceKind;
  sourceIdentity: ButtonSourceIdentity | null;
  panelOwnerIdentity: { programName: string; panelName: string } | null;
  label: string;
  skin: ButtonSkin;
  width: number;
  height: number;
  textFitMode: ButtonPlacement["textFitMode"];
  textAlignment: ButtonPlacement["textAlignment"];
  textOffsetX: number;
  textOffsetY: number;
  minimumFontSize: number;
  textSizeOverride: number | null;
  allowLabelResize: boolean;
  matchHitboxToSkin: boolean;
  allowStretching: boolean;
  highlightOnHover: boolean;
}

export interface ThemeGradientDefinition {
  role: string;
  topColor: string;
  bottomColor: string;
  spread: number;
  scatter: number;
  seed: number;
}

export interface FlowCellThemeFile {
  kind: typeof FLOWCELL_THEME_KIND;
  version: typeof FLOWCELL_THEME_VERSION;
  savedAt: string;
  target: ThemeTarget;
  main: MainThemeAppearance | null;
  buttons: ButtonThemeAppearance[];
  gradient: ThemeGradientDefinition | null;
}

export interface ThemeApplyResult {
  document: ButtonStateDocument;
  appliedButtonCount: number;
  missingButtonCount: number;
}

export interface SkinColorRoot {
  role: string;
  value: string;
}

const COLOR_ROOT_PATTERN = /(--flowcell-button-color-([a-z0-9-]+)\s*:\s*)([^;]+)(;)/gi;

function normalizeName(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("en");
}

function namesMatch(left: string, right: string): boolean {
  return normalizeName(left) === normalizeName(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function panelOwnerIdentity(
  document: ButtonStateDocument,
  buttonId: string
): { programName: string; panelName: string } | null {
  const button = document.buttons[buttonId];
  if (!button || button.role !== "panel-owner") return null;
  const programName = typeof button.metadata.programName === "string"
    ? button.metadata.programName.trim()
    : "";
  const panelName = typeof button.metadata.panelName === "string"
    ? button.metadata.panelName.trim()
    : "";
  return programName && panelName ? { programName, panelName } : null;
}

function placementProgramPanel(
  document: ButtonStateDocument,
  placement: ButtonPlacement
): { programName: string; panelName: string } | null {
  const button = document.buttons[placement.buttonId];
  const identity = button?.sourceIdentity;
  if (identity) {
    return {
      programName: identity.displayProgramName,
      panelName: identity.displayPanelName
    };
  }
  return panelOwnerIdentity(document, placement.buttonId);
}

export function defaultMainThemeAppearance(): MainThemeAppearance {
  return {
    backgroundColor: "#9db678",
    backgroundImageMode: "default",
    backgroundImagePath: null,
    rails: Object.fromEntries(
      rails.map((rail) => [
        rail.id,
        {
          background: rail.background,
          border: rail.border
        }
      ])
    )
  };
}

export function placementMatchesThemeTarget(
  document: ButtonStateDocument,
  placement: ButtonPlacement,
  target: ThemeTarget
): boolean {
  const surface = document.surfaces[placement.surfaceId];
  if (!surface) return false;

  if (target.kind === "flowcell") {
    return target.page === "main" && (surface.kind === "main" || surface.kind === "panel");
  }

  const identity = placementProgramPanel(document, placement);
  if (!identity || !namesMatch(identity.programName, target.programName)) return false;
  return !target.panelName || namesMatch(identity.panelName, target.panelName);
}

export function listThemePlacements(
  document: ButtonStateDocument,
  target: ThemeTarget
): ButtonPlacement[] {
  return Object.values(document.placements)
    .filter((placement) => placementMatchesThemeTarget(document, placement, target))
    .sort((left, right) => {
      const leftSurface = document.surfaces[left.surfaceId];
      const rightSurface = document.surfaces[right.surfaceId];
      return (
        (leftSurface?.name ?? "").localeCompare(rightSurface?.name ?? "") ||
        left.y - right.y ||
        left.x - right.x ||
        left.id.localeCompare(right.id)
      );
    });
}

export function extractSkinColorRoots(skin: ButtonSkin): SkinColorRoot[] {
  const roots: SkinColorRoot[] = [];
  const seen = new Set<string>();
  for (const match of skin.base.matchAll(COLOR_ROOT_PATTERN)) {
    const role = match[2]?.trim().toLowerCase() ?? "";
    const value = match[3]?.trim() ?? "";
    if (!role || !value || seen.has(role)) continue;
    seen.add(role);
    roots.push({ role, value });
  }
  return roots;
}

export function setSkinColorRoot(
  skin: ButtonSkin,
  role: string,
  value: string
): ButtonSkin {
  const normalizedRole = role.trim().toLowerCase();
  if (!normalizedRole || !value.trim()) return structuredClone(skin);
  let changed = false;
  const base = skin.base.replace(COLOR_ROOT_PATTERN, (full, prefix: string, foundRole: string, _old: string, suffix: string) => {
    if (foundRole.toLowerCase() !== normalizedRole) return full;
    changed = true;
    return `${prefix}${value.trim()}${suffix}`;
  });
  return changed ? { ...structuredClone(skin), base, compileCache: null } : structuredClone(skin);
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function themeSkinId(savedAt: string, placementId: string): string {
  return `flowcell-theme-skin-${stableHash(`${savedAt}\u0000${placementId}`).toString(36)}`;
}

export function captureThemeFile(args: {
  document: ButtonStateDocument;
  target: ThemeTarget;
  main?: MainThemeAppearance | null;
  gradient?: ThemeGradientDefinition | null;
  savedAt?: string;
}): FlowCellThemeFile {
  const savedAt = args.savedAt ?? new Date().toISOString();
  const buttons = listThemePlacements(args.document, args.target).flatMap((placement) => {
    const button = args.document.buttons[placement.buttonId];
    const surface = args.document.surfaces[placement.surfaceId];
    const sourceSkin = button
      ? args.document.skins[placement.skinOverrideId ?? button.defaultSkinId]
      : null;
    if (!button || !surface || !sourceSkin) return [];
    const skin = structuredClone(sourceSkin);
    skin.id = themeSkinId(savedAt, placement.id);
    skin.name = `${sourceSkin.name} · Theme ${button.label}`;
    skin.compileCache = null;
    return [{
      placementId: placement.id,
      buttonId: button.id,
      surfaceId: placement.surfaceId,
      surfaceName: surface.name,
      surfaceKind: surface.kind,
      sourceIdentity: button.sourceIdentity ? structuredClone(button.sourceIdentity) : null,
      panelOwnerIdentity: panelOwnerIdentity(args.document, button.id),
      label: button.label,
      skin,
      width: placement.width,
      height: placement.height,
      textFitMode: placement.textFitMode,
      textAlignment: placement.textAlignment,
      textOffsetX: placement.textOffsetX,
      textOffsetY: placement.textOffsetY,
      minimumFontSize: placement.minimumFontSize,
      textSizeOverride: placement.textSizeOverride,
      allowLabelResize: placement.allowLabelResize,
      matchHitboxToSkin: placement.matchHitboxToSkin,
      allowStretching: placement.allowStretching,
      highlightOnHover: placement.highlightOnHover
    } satisfies ButtonThemeAppearance];
  });
  return {
    kind: FLOWCELL_THEME_KIND,
    version: FLOWCELL_THEME_VERSION,
    savedAt,
    target: structuredClone(args.target),
    main: args.target.kind === "flowcell" && args.target.page === "main"
      ? structuredClone(args.main ?? defaultMainThemeAppearance())
      : null,
    buttons,
    gradient: args.gradient ? structuredClone(args.gradient) : null
  };
}

function sameSourceIdentity(
  left: ButtonSourceIdentity | null,
  right: ButtonSourceIdentity | null
): boolean {
  return Boolean(
    left && right &&
    namesMatch(left.displayProgramName, right.displayProgramName) &&
    namesMatch(left.displayPanelName, right.displayPanelName) &&
    namesMatch(left.displayFileName, right.displayFileName)
  );
}

function findThemePlacement(
  document: ButtonStateDocument,
  appearance: ButtonThemeAppearance
): ButtonPlacement | null {
  const exact = document.placements[appearance.placementId];
  if (exact) return exact;
  return Object.values(document.placements).find((placement) => {
    const surface = document.surfaces[placement.surfaceId];
    const button = document.buttons[placement.buttonId];
    if (!surface || !button || surface.kind !== appearance.surfaceKind) return false;
    if (sameSourceIdentity(button.sourceIdentity, appearance.sourceIdentity)) return true;
    const owner = panelOwnerIdentity(document, button.id);
    return Boolean(
      owner && appearance.panelOwnerIdentity &&
      namesMatch(owner.programName, appearance.panelOwnerIdentity.programName) &&
      namesMatch(owner.panelName, appearance.panelOwnerIdentity.panelName)
    );
  }) ?? null;
}

function applyAppearanceToPlacement(
  document: ButtonStateDocument,
  placement: ButtonPlacement,
  appearance: ButtonThemeAppearance
): void {
  const skin = structuredClone(appearance.skin);
  skin.compileCache = null;
  document.skins[skin.id] = skin;
  placement.skinOverrideId = skin.id;
  placement.width = Math.max(1, appearance.width);
  placement.height = Math.max(1, appearance.height);
  placement.textFitMode = appearance.textFitMode;
  placement.textAlignment = appearance.textAlignment;
  placement.textOffsetX = appearance.textOffsetX;
  placement.textOffsetY = appearance.textOffsetY;
  placement.minimumFontSize = appearance.minimumFontSize;
  placement.textSizeOverride = appearance.textSizeOverride;
  placement.allowLabelResize = appearance.allowLabelResize;
  placement.matchHitboxToSkin = appearance.matchHitboxToSkin;
  placement.allowStretching = appearance.allowStretching;
  placement.highlightOnHover = appearance.highlightOnHover;
}

function recenterManagedMainPlacement(
  document: ButtonStateDocument,
  placement: ButtonPlacement
): void {
  const button = document.buttons[placement.buttonId];
  const metadata = button?.metadata;
  if (!button || !isRecord(metadata)) return;
  const section = typeof metadata.mainPageSection === "string" ? metadata.mainPageSection : "";
  const defaultRect = isRecord(metadata.mainPageDefaultRect) ? metadata.mainPageDefaultRect : null;
  if (!defaultRect) return;
  const x = typeof defaultRect.x === "number" ? defaultRect.x : null;
  const y = typeof defaultRect.y === "number" ? defaultRect.y : null;
  const width = typeof defaultRect.width === "number" ? defaultRect.width : null;
  const height = typeof defaultRect.height === "number" ? defaultRect.height : null;
  if ([x, y, width, height].some((value) => value === null || !Number.isFinite(value))) return;

  const railId = section === "Program Rail"
    ? "program-rail"
    : section === "Panel Rail"
      ? "panel-rail"
      : section === "Button Section Rail"
        ? "buttons-rail"
        : null;
  if (!railId) return;
  const rail = rails.find((candidate) => candidate.id === railId);
  if (!rail) return;
  placement.x = rail.x + (rail.width - placement.width) / 2;
  placement.y = (y as number) + (height as number) / 2 - placement.height / 2;
}

function alignPanelSurfaceAfterTheme(
  document: ButtonStateDocument,
  surfaceId: string
): void {
  const surface = document.surfaces[surfaceId];
  if (!surface || surface.kind !== "panel") return;
  const placements = surface.placementIds
    .map((placementId) => document.placements[placementId])
    .filter((placement): placement is ButtonPlacement => Boolean(placement));
  if (placements.length < 2) return;
  const gap = buttonSpacingPixelsFromMillimeters(document.settings.buttonSpacingMm);
  const result = alignButtonPlacementSelectionToTopLeftButton({
    placements: placements.map((placement) => ({ id: placement.id, rect: { ...placement } })),
    selectedPlacementIds: placements.map((placement) => placement.id),
    surface,
    gap
  });
  if (!result.success) return;
  const resolved = new Map(result.placements.map((entry) => [entry.id, entry.rect]));
  placements.forEach((placement) => {
    const rect = resolved.get(placement.id);
    if (!rect) return;
    placement.x = rect.x;
    placement.y = rect.y;
  });
}

export function applyThemeFile(
  current: ButtonStateDocument,
  theme: FlowCellThemeFile
): ThemeApplyResult {
  const document = cloneButtonDocument(current);
  let appliedButtonCount = 0;
  let missingButtonCount = 0;
  const touchedPanelSurfaces = new Set<string>();

  for (const appearance of theme.buttons) {
    const placement = findThemePlacement(document, appearance);
    if (!placement) {
      missingButtonCount += 1;
      continue;
    }
    applyAppearanceToPlacement(document, placement, appearance);
    appliedButtonCount += 1;
    const surface = document.surfaces[placement.surfaceId];
    if (surface?.kind === "panel") touchedPanelSurfaces.add(surface.id);
    if (surface?.kind === "main") recenterManagedMainPlacement(document, placement);
  }

  touchedPanelSurfaces.forEach((surfaceId) => alignPanelSurfaceAfterTheme(document, surfaceId));
  document.revision = current.revision;
  return { document, appliedButtonCount, missingButtonCount };
}

function parseHexColor(value: string): { r: number; g: number; b: number } | null {
  const raw = value.trim().replace(/^#/, "");
  const normalized = raw.length === 3
    ? raw.split("").map((character) => `${character}${character}`).join("")
    : raw.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function channelHex(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0");
}

export function interpolateThemeColor(top: string, bottom: string, t: number): string {
  const start = parseHexColor(top);
  const end = parseHexColor(bottom);
  if (!start || !end) return top;
  const amount = Math.min(1, Math.max(0, t));
  return `#${channelHex(start.r + (end.r - start.r) * amount)}${channelHex(start.g + (end.g - start.g) * amount)}${channelHex(start.b + (end.b - start.b) * amount)}`;
}

export function gradientColorForPlacement(args: {
  placementId: string;
  y: number;
  minimumY: number;
  maximumY: number;
  gradient: ThemeGradientDefinition;
}): string {
  const range = Math.max(1, args.maximumY - args.minimumY);
  const normalized = Math.min(1, Math.max(0, (args.y - args.minimumY) / range));
  const spread = Math.min(1, Math.max(0, args.gradient.spread / 100));
  const scatter = Math.min(1, Math.max(0, args.gradient.scatter / 100));
  const baseT = 0.5 + (normalized - 0.5) * spread;
  const unit = stableHash(`${args.gradient.seed}\u0000${args.placementId}`) / 0xffffffff;
  const jitter = (unit - 0.5) * 0.5 * scatter;
  return interpolateThemeColor(
    args.gradient.topColor,
    args.gradient.bottomColor,
    Math.min(1, Math.max(0, baseT + jitter))
  );
}

export function isFlowCellThemeFile(value: unknown): value is FlowCellThemeFile {
  if (!isRecord(value)) return false;
  return value.kind === FLOWCELL_THEME_KIND &&
    value.version === FLOWCELL_THEME_VERSION &&
    typeof value.savedAt === "string" &&
    isRecord(value.target) &&
    Array.isArray(value.buttons);
}
