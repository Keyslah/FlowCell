import type {
  ButtonPlacement,
  ButtonSkin,
  ButtonSourceIdentity,
  ButtonStateDocument,
  ButtonSurfaceKind,
  ButtonThemeOverride
} from "../button/types.js";
import { cloneButtonDocument } from "../button/state/buttonDefaults.js";
import { validateButtonStateDocument } from "../button/state/buttonStateValidation.js";
import { areButtonSourceIdentitiesEqual } from "../button/state/sourceIdentity.js";
import {
  alignButtonPlacementSelectionToTopLeftButton,
  buttonSpacingPixelsFromMillimeters,
  resizeButtonPlacementSelection,
  validateExactButtonLayoutGeometry
} from "../button/geometry/buttonGeometry.js";
import {
  BUTTON_SKIN_PROFILE_COLOR_PREFIX,
  collectButtonSkinProfileColors,
  normalizeButtonGlowAmount,
  normalizeButtonHighlightAmount,
  normalizeButtonSkinColor,
  readButtonSkinHighlightOnActive,
  readButtonSkinHighlightOnHover,
  readButtonSkinTextColor,
  setButtonSkinTextColor,
  setButtonSkinProfileColor
} from "../button/skins/buttonSkinColors.js";
import { BUTTON_SKIN_SECTION_ORDER } from "../button/skins/buttonSkinFormat.js";
import { validateButtonSkin } from "../button/skins/skinValidator.js";
import {
  buildPanelRailOwnerEntries,
  buttonsSurfaceContentOrigin,
  page,
  rails
} from "../pages/main/mainLayout.js";
import {
  defaultThemePageAppearance,
  isFlowCellThemePageId,
  isThemePageAppearance,
  themePageSupportsButtonSurface,
  type FlowCellThemePageId,
  type ThemePageAppearance
} from "./themePageRegistry.js";

export const FLOWCELL_THEME_KIND = "FlowCellTheme" as const;
export const FLOWCELL_THEME_VERSION = 2 as const;
const LEGACY_FLOWCELL_THEME_VERSION = 1 as const;

export type { FlowCellThemePageId, ThemePageAppearance } from "./themePageRegistry.js";

export type ThemeTarget =
  | { kind: "flowcell"; page: FlowCellThemePageId }
  | {
      kind: "program";
      programName: string;
      panelName: string | null;
      area?: "popouts";
    };

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
  gradientEnabled: boolean;
  scatterEnabled: boolean;
  themeOverride: ButtonThemeOverride;
  assignSkin: boolean;
  highlightColorReset?: ThemeHighlightColorResetIntent;
}

export interface ThemeHighlightColorResetIntent {
  hover: boolean;
  active: boolean;
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
  page: ThemePageAppearance | null;
  /** @deprecated Transitional type surface; version 1 files serialize `page`, never `main`. */
  readonly main?: MainThemeAppearance | null;
  buttons: ButtonThemeAppearance[];
  gradient: ThemeGradientDefinition | null;
}

export const THEME_HOVER_HIGHLIGHT_ROLE = "hover-highlight";
export const THEME_ACTIVE_HIGHLIGHT_ROLE = "active-highlight";
const LEGACY_THEME_SKIN_ID_PREFIX = "flowcell-theme-skin-";

export interface ThemeSkinAssignmentIdentity {
  key: string;
  label: string;
  skinId: string;
}

interface LegacyFlowCellThemeFile extends Omit<FlowCellThemeFile, "version" | "buttons"> {
  version: typeof LEGACY_FLOWCELL_THEME_VERSION;
  buttons: Array<Omit<
    ButtonThemeAppearance,
    "themeOverride" | "assignSkin" | "highlightColorReset"
  >>;
}

export interface ThemeApplyResult {
  document: ButtonStateDocument;
  appliedButtonCount: number;
  missingButtonCount: number;
  skippedButtonCount: number;
  matchedPlacementIds: Record<string, string>;
  issues: ThemeApplyIssue[];
}

export function resolveThemeHighlightColorResetPlacementIds(
  theme: Pick<FlowCellThemeFile, "buttons">,
  matchedPlacementIds: Readonly<Record<string, string>>
): { hover: Set<string>; active: Set<string> } {
  const resolved = { hover: new Set<string>(), active: new Set<string>() };
  theme.buttons.forEach((appearance) => {
    const placementId = matchedPlacementIds[appearance.placementId];
    if (!placementId) return;
    if (appearance.highlightColorReset?.hover) resolved.hover.add(placementId);
    if (appearance.highlightColorReset?.active) resolved.active.add(placementId);
  });
  return resolved;
}

export interface ThemeApplyIssue {
  surfaceId: string;
  surfaceName: string;
  savedButtonCount: number;
  message: string;
}

export interface SkinColorRoot {
  role: string;
  value: string;
}

export function emptyButtonThemeOverride(): ButtonThemeOverride {
  return {
    colors: {},
    hoverEnabled: null,
    activeEnabled: null,
    hoverColor: null,
    activeColor: null
  };
}

export function buttonThemeOverrideIsEmpty(override: ButtonThemeOverride): boolean {
  return Object.keys(override.colors).length === 0 &&
    override.hoverEnabled === null &&
    override.activeEnabled === null &&
    override.hoverColor === null &&
    override.activeColor === null &&
    override.highlightAmount == null &&
    override.hoverHighlightAmount == null &&
    override.activeHighlightAmount == null &&
    override.hoverGlowAmount == null &&
    override.activeGlowAmount == null;
}

export function clearButtonThemeOverrideColors(
  override: ButtonThemeOverride | undefined
): ButtonThemeOverride {
  const next = structuredClone(override ?? emptyButtonThemeOverride());
  next.colors = {};
  next.hoverColor = null;
  next.activeColor = null;
  return next;
}

const BUTTON_SURFACE_KINDS = new Set<ButtonSurfaceKind>([
  "main",
  "panel",
  "regular-popout",
  "tool-set-popout",
  "fan"
]);

const PROGRAM_POPOUT_SURFACE_KINDS = new Set<ButtonSurfaceKind>([
  "regular-popout",
  "tool-set-popout"
]);

const TEXT_FIT_MODES = new Set<ButtonPlacement["textFitMode"]>([
  "shrink",
  "stack-whole-words",
  "shrink-and-stack"
]);

const TEXT_ALIGNMENTS = new Set<ButtonPlacement["textAlignment"]>([
  "skin",
  "left",
  "center",
  "right"
]);

function normalizeName(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("en");
}

function namesMatch(left: string, right: string): boolean {
  return normalizeName(left) === normalizeName(right);
}

function legacyThemeSkinBaseName(name: string, buttonLabel: string): string {
  const suffixes = [` - ${buttonLabel}`, ` · Theme ${buttonLabel}`]
    .filter((suffix) => suffix.trim().length > 1);
  let result = name;
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of suffixes) {
      if (!result.endsWith(suffix)) continue;
      result = result.slice(0, -suffix.length);
      changed = true;
    }
  }
  return result.trim() || name;
}

function legacyThemeSkinLineageName(
  document: ButtonStateDocument,
  placement: ButtonPlacement
): string | null {
  const button = document.buttons[placement.buttonId];
  const skinId = button ? placement.skinOverrideId ?? button.defaultSkinId : null;
  const skin = skinId ? document.skins[skinId] : null;
  return button && skinId?.startsWith(LEGACY_THEME_SKIN_ID_PREFIX) && skin
    ? legacyThemeSkinBaseName(skin.name, button.label)
    : null;
}

function retainedSkinFamily(
  document: ButtonStateDocument,
  lineageName: string
): { key: string; label: string } | null {
  const candidates = Object.values(document.skins)
    .filter((skin) =>
      !skin.id.startsWith(LEGACY_THEME_SKIN_ID_PREFIX) && namesMatch(skin.name, lineageName)
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  if (candidates.length === 0) return null;
  if (!candidates.every((skin) => sameButtonSkinSource(skin, candidates[0]))) return null;
  return {
    key: candidates.length === 1
      ? `skin:${candidates[0].id}`
      : `skin-family:${candidates.map((skin) => skin.id).join("|")}`,
    label: candidates[0].name
  };
}

function hasLegacyThemeSkinLineage(
  document: ButtonStateDocument,
  lineageName: string
): boolean {
  return Object.values(document.placements).some((placement) => {
    const recovered = legacyThemeSkinLineageName(document, placement);
    return recovered ? namesMatch(recovered, lineageName) : false;
  });
}

/**
 * Theme v1 assigned a private clone ID to every placement. Those IDs discarded
 * the shared skin ID, but the clone name retained the source name and, in older
 * builds, appended the Button label. Recover that explicit lineage so the
 * Theme Editor can display the retained saved-skin family instead of a private
 * legacy clone name.
 */
export function themeSkinAssignmentIdentity(
  document: ButtonStateDocument,
  placement: ButtonPlacement
): ThemeSkinAssignmentIdentity | null {
  const button = document.buttons[placement.buttonId];
  const skinId = button ? placement.skinOverrideId ?? button.defaultSkinId : null;
  const skin = skinId ? document.skins[skinId] : null;
  if (!button || !skinId || !skin) return null;
  const legacyLineageName = legacyThemeSkinLineageName(document, placement);
  if (legacyLineageName) {
    const retained = retainedSkinFamily(document, legacyLineageName);
    return {
      key: retained?.key ?? `legacy-theme-skin:${normalizeName(legacyLineageName)}`,
      label: retained?.label ?? legacyLineageName,
      skinId
    };
  }
  if (hasLegacyThemeSkinLineage(document, skin.name)) {
    const retained = retainedSkinFamily(document, skin.name);
    if (retained) return { ...retained, skinId };
  }
  return { key: `skin:${skinId}`, label: skin.name, skinId };
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
  const executionTarget = button?.executionTarget;
  if (executionTarget?.kind === "panel-script" || executionTarget?.kind === "tool-set-action") {
    return {
      programName: executionTarget.programName,
      panelName: executionTarget.panelName
    };
  }
  const owner = panelOwnerIdentity(document, placement.buttonId);
  if (owner) return owner;
  const parent = button?.toolSetParentId ? document.buttons[button.toolSetParentId] : null;
  const parentIdentity = parent?.sourceIdentity;
  if (parentIdentity) {
    return {
      programName: parentIdentity.displayProgramName,
      panelName: parentIdentity.displayPanelName
    };
  }
  const parentTarget = parent?.executionTarget;
  return parentTarget?.kind === "panel-script" || parentTarget?.kind === "tool-set-action"
    ? { programName: parentTarget.programName, panelName: parentTarget.panelName }
    : null;
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
    return themePageSupportsButtonSurface(target.page, surface);
  }

  const identity = placementProgramPanel(document, placement);
  if (!identity || !namesMatch(identity.programName, target.programName)) return false;
  if (target.area === "popouts") return PROGRAM_POPOUT_SURFACE_KINDS.has(surface.kind);
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

export function resolveThemeSkinAssignmentPlacementIds(
  scopedPlacements: readonly ButtonPlacement[],
  selectedPlacementId: string,
  assignEveryButtonInScope: boolean
): string[] {
  if (!scopedPlacements.some((placement) => placement.id === selectedPlacementId)) return [];
  return assignEveryButtonInScope
    ? scopedPlacements.map((placement) => placement.id)
    : [selectedPlacementId];
}

export function extractSkinColorRoots(skin: ButtonSkin): SkinColorRoot[] {
  const profileColors = collectButtonSkinProfileColors(skin).map(({ role, color }) => ({
    role,
    value: color
  }));
  const textColor = readButtonSkinTextColor(skin);
  return textColor && !profileColors.some(({ role }) => role === "text")
    ? [...profileColors, { role: "text", value: textColor }]
    : profileColors;
}

export function themePlacementDeployedCenterY(
  document: ButtonStateDocument,
  placement: ButtonPlacement,
  target: ThemeTarget
): number {
  const surface = document.surfaces[placement.surfaceId];
  if (!surface || !placementMatchesThemeTarget(document, placement, target)) {
    throw new Error(`Button placement '${placement.id}' is outside the selected Theme target.`);
  }
  const surfaceOffsetY = surface.kind === "panel"
    ? buttonsSurfaceContentOrigin.y
    : 0;
  return surfaceOffsetY + placement.y + placement.height / 2;
}

export function setSkinColorRoot(
  skin: ButtonSkin,
  role: string,
  value: string
): ButtonSkin {
  const normalizedRole = role.trim().toLowerCase();
  const copy = structuredClone(skin);
  if (!/^[a-z][a-z0-9-]*$/.test(normalizedRole)) return copy;
  let updated = setButtonSkinProfileColor(
    copy,
    `${BUTTON_SKIN_PROFILE_COLOR_PREFIX}${normalizedRole}`,
    value
  );
  if (
    updated.base === copy.base &&
    normalizedRole === "text" &&
    readButtonSkinTextColor(copy) !== null
  ) {
    updated = setButtonSkinTextColor(copy, value);
  }
  if (updated.base === copy.base) return copy;
  return {
    ...copy,
    ...updated,
    compileCache: null
  };
}

export function mainThemeAppearanceToPageAppearance(
  appearance: MainThemeAppearance
): ThemePageAppearance {
  const pageAppearance = defaultThemePageAppearance("main");
  pageAppearance.tokens["background-color"] = appearance.backgroundColor;
  for (const rail of rails) {
    const railAppearance = appearance.rails[rail.id];
    if (!railAppearance) continue;
    pageAppearance.tokens[`rail-${rail.id}-background`] = railAppearance.background;
    pageAppearance.tokens[`rail-${rail.id}-border`] = railAppearance.border;
  }
  pageAppearance.assets["background-image"] = {
    mode: appearance.backgroundImageMode,
    path: appearance.backgroundImagePath
  };
  return pageAppearance;
}

export function pageAppearanceToMainThemeAppearance(
  appearance: ThemePageAppearance
): MainThemeAppearance {
  if (appearance.pageId !== "main") {
    throw new Error(`Theme page '${appearance.pageId}' is not the FlowCell Main page.`);
  }
  const backgroundImage = appearance.assets["background-image"];
  return {
    backgroundColor: appearance.tokens["background-color"],
    backgroundImageMode: backgroundImage.mode,
    backgroundImagePath: backgroundImage.path,
    rails: Object.fromEntries(rails.map((rail) => [
      rail.id,
      {
        background: appearance.tokens[`rail-${rail.id}-background`],
        border: appearance.tokens[`rail-${rail.id}-border`]
      }
    ]))
  };
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function skinIdIsPrivateToPlacement(
  document: ButtonStateDocument,
  skinId: string,
  placementId: string
): boolean {
  const placement = document.placements[placementId];
  return placement?.skinOverrideId === skinId &&
    !Object.values(document.placements).some(
      (candidate) => candidate.id !== placementId && candidate.skinOverrideId === skinId
    ) &&
    !Object.values(document.buttons).some((button) => button.defaultSkinId === skinId);
}

function themeSkinId(
  document: ButtonStateDocument,
  savedAt: string,
  placementId: string
): string {
  const base = `flowcell-theme-skin-${encodeURIComponent(savedAt)}-${encodeURIComponent(placementId)}`;
  let candidate = base;
  let suffix = 2;
  while (document.skins[candidate] && !skinIdIsPrivateToPlacement(document, candidate, placementId)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function captureThemeFile(args: {
  document: ButtonStateDocument;
  target: ThemeTarget;
  page?: ThemePageAppearance | null;
  /** @deprecated Pass the registry-backed `page` appearance. */
  main?: MainThemeAppearance | null;
  gradient?: ThemeGradientDefinition | null;
  buttonParticipation?: Readonly<Record<string, {
    gradientEnabled: boolean;
    scatterEnabled: boolean;
  }>>;
  skinAssignmentPlacementIds?: ReadonlySet<string>;
  highlightColorResetPlacementIds?: {
    hover: ReadonlySet<string>;
    active: ReadonlySet<string>;
  };
  savedAt?: string;
}): FlowCellThemeFile {
  const savedAt = args.savedAt ?? new Date().toISOString();
  const pageAppearance = args.target.kind === "flowcell"
    ? structuredClone(
        args.page ??
        (args.target.page === "main" && args.main
          ? mainThemeAppearanceToPageAppearance(args.main)
          : defaultThemePageAppearance(args.target.page))
      )
    : null;
  const buttons = listThemePlacements(args.document, args.target).flatMap((placement) => {
    const button = args.document.buttons[placement.buttonId];
    const surface = args.document.surfaces[placement.surfaceId];
    const sourceSkin = button
      ? args.document.skins[placement.skinOverrideId ?? button.defaultSkinId]
      : null;
    if (!button || !surface || !sourceSkin) return [];
    const skin = structuredClone(sourceSkin);
    skin.compileCache = null;
    const highlightColorReset = {
      hover: args.highlightColorResetPlacementIds?.hover.has(placement.id) ?? false,
      active: args.highlightColorResetPlacementIds?.active.has(placement.id) ?? false
    };
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
      highlightOnHover: placement.highlightOnHover,
      gradientEnabled: args.buttonParticipation?.[placement.id]?.gradientEnabled ?? true,
      scatterEnabled: args.buttonParticipation?.[placement.id]?.scatterEnabled ?? true,
      themeOverride: structuredClone(
        args.document.themeOverrides?.[placement.id] ?? emptyButtonThemeOverride()
      ),
      assignSkin: args.skinAssignmentPlacementIds?.has(placement.id) ?? false,
      ...(highlightColorReset.hover || highlightColorReset.active
        ? { highlightColorReset }
        : {})
    } satisfies ButtonThemeAppearance];
  });
  const theme: FlowCellThemeFile = {
    kind: FLOWCELL_THEME_KIND,
    version: FLOWCELL_THEME_VERSION,
    savedAt,
    target: structuredClone(args.target),
    page: pageAppearance,
    buttons,
    gradient: args.gradient ? structuredClone(args.gradient) : null
  };
  if (!isFlowCellThemeFile(theme)) {
    throw new Error("The selected scope cannot be represented as a valid version 1 FlowCell Theme.");
  }
  return theme;
}

function sameSourceIdentity(
  left: ButtonSourceIdentity | null,
  right: ButtonSourceIdentity | null
): boolean {
  return Boolean(left && right && areButtonSourceIdentitiesEqual(left, right));
}

function surfaceMatchesAppearance(
  document: ButtonStateDocument,
  placement: ButtonPlacement,
  appearance: ButtonThemeAppearance
): boolean {
  const surface = document.surfaces[placement.surfaceId];
  if (!surface || surface.kind !== appearance.surfaceKind) return false;
  return surface.id === appearance.surfaceId || namesMatch(surface.name, appearance.surfaceName);
}

function buttonMatchesAppearance(
  document: ButtonStateDocument,
  placement: ButtonPlacement,
  appearance: ButtonThemeAppearance
): boolean {
  const button = document.buttons[placement.buttonId];
  if (!button) return false;
  if (button.id === appearance.buttonId) return true;
  if (sameSourceIdentity(button.sourceIdentity, appearance.sourceIdentity)) return true;
  const owner = panelOwnerIdentity(document, button.id);
  return Boolean(
    owner && appearance.panelOwnerIdentity &&
    namesMatch(owner.programName, appearance.panelOwnerIdentity.programName) &&
    namesMatch(owner.panelName, appearance.panelOwnerIdentity.panelName)
  );
}

function findThemePlacement(
  document: ButtonStateDocument,
  appearance: ButtonThemeAppearance,
  target: ThemeTarget,
  claimedPlacementIds: ReadonlySet<string>
): ButtonPlacement | null {
  const exact = document.placements[appearance.placementId];
  if (
    exact &&
    !claimedPlacementIds.has(exact.id) &&
    placementMatchesThemeTarget(document, exact, target) &&
    surfaceMatchesAppearance(document, exact, appearance) &&
    buttonMatchesAppearance(document, exact, appearance)
  ) {
    return exact;
  }
  const candidates = Object.values(document.placements)
    .filter((placement) =>
      !claimedPlacementIds.has(placement.id) &&
      placementMatchesThemeTarget(document, placement, target) &&
      surfaceMatchesAppearance(document, placement, appearance) &&
      buttonMatchesAppearance(document, placement, appearance)
    )
    .sort((left, right) => {
      const leftButton = document.buttons[left.buttonId];
      const rightButton = document.buttons[right.buttonId];
      const leftScore = (left.buttonId === appearance.buttonId ? 4 : 0) +
        (left.surfaceId === appearance.surfaceId ? 2 : 0) +
        (sameSourceIdentity(leftButton?.sourceIdentity ?? null, appearance.sourceIdentity) ? 1 : 0);
      const rightScore = (right.buttonId === appearance.buttonId ? 4 : 0) +
        (right.surfaceId === appearance.surfaceId ? 2 : 0) +
        (sameSourceIdentity(rightButton?.sourceIdentity ?? null, appearance.sourceIdentity) ? 1 : 0);
      return rightScore - leftScore || left.id.localeCompare(right.id);
    });
  return candidates[0] ?? null;
}

function sameButtonSkinSource(left: ButtonSkin, right: ButtonSkin): boolean {
  return BUTTON_SKIN_SECTION_ORDER.every((section) => left[section] === right[section]);
}

function assignedThemeSkinId(
  document: ButtonStateDocument,
  appearance: ButtonThemeAppearance
): string {
  const exact = document.skins[appearance.skin.id];
  if (exact && sameButtonSkinSource(exact, appearance.skin)) return exact.id;
  const reusable = Object.values(document.skins).find((skin) =>
    sameButtonSkinSource(skin, appearance.skin)
  );
  if (reusable) return reusable.id;
  const fingerprint = BUTTON_SKIN_SECTION_ORDER.map((section) => appearance.skin[section]).join("\u0000");
  const base = `flowcell-theme-embedded-${stableHash(fingerprint).toString(16).padStart(8, "0")}`;
  let id = base;
  let suffix = 2;
  while (document.skins[id] && !sameButtonSkinSource(document.skins[id], appearance.skin)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  if (!document.skins[id]) {
    document.skins[id] = {
      ...structuredClone(appearance.skin),
      id,
      compileCache: null
    };
  }
  return id;
}

function mergeThemeOverride(
  current: ButtonThemeOverride | undefined,
  incoming: ButtonThemeOverride
): ButtonThemeOverride {
  const next = structuredClone(current ?? emptyButtonThemeOverride());
  for (const [role, color] of Object.entries(incoming.colors)) {
    const normalized = normalizeButtonSkinColor(color);
    if (normalized) next.colors[role] = normalized;
  }
  if (incoming.hoverEnabled !== null) next.hoverEnabled = incoming.hoverEnabled;
  if (incoming.activeEnabled !== null) next.activeEnabled = incoming.activeEnabled;
  if (incoming.hoverColor !== null) next.hoverColor = normalizeButtonSkinColor(incoming.hoverColor);
  if (incoming.activeColor !== null) next.activeColor = normalizeButtonSkinColor(incoming.activeColor);
  if (incoming.highlightAmount != null) {
    const highlightAmount = normalizeButtonGlowAmount(incoming.highlightAmount);
    if (highlightAmount !== null) next.highlightAmount = highlightAmount;
  }
  if (incoming.hoverHighlightAmount != null) {
    const amount = normalizeButtonHighlightAmount(incoming.hoverHighlightAmount);
    if (amount !== null) next.hoverHighlightAmount = amount;
  }
  if (incoming.activeHighlightAmount != null) {
    const amount = normalizeButtonHighlightAmount(incoming.activeHighlightAmount);
    if (amount !== null) next.activeHighlightAmount = amount;
  }
  if (incoming.hoverGlowAmount != null) {
    const amount = normalizeButtonGlowAmount(incoming.hoverGlowAmount);
    if (amount !== null) next.hoverGlowAmount = amount;
  }
  if (incoming.activeGlowAmount != null) {
    const amount = normalizeButtonGlowAmount(incoming.activeGlowAmount);
    if (amount !== null) next.activeGlowAmount = amount;
  }
  return next;
}

function applyAppearanceToPlacement(
  document: ButtonStateDocument,
  placement: ButtonPlacement,
  appearance: ButtonThemeAppearance
): void {
  if (appearance.assignSkin) {
    const skinId = assignedThemeSkinId(document, appearance);
    const button = document.buttons[placement.buttonId];
    placement.skinOverrideId = button?.defaultSkinId === skinId ? null : skinId;
  }
  if (
    appearance.assignSkin ||
    !buttonThemeOverrideIsEmpty(appearance.themeOverride) ||
    appearance.highlightColorReset
  ) {
    const currentOverride = appearance.assignSkin
      ? clearButtonThemeOverrideColors(document.themeOverrides?.[placement.id])
      : document.themeOverrides?.[placement.id];
    const next = mergeThemeOverride(
      currentOverride,
      appearance.themeOverride
    );
    if (appearance.highlightColorReset?.hover) next.hoverColor = null;
    if (appearance.highlightColorReset?.active) next.activeColor = null;
    if (buttonThemeOverrideIsEmpty(next)) {
      if (document.themeOverrides) delete document.themeOverrides[placement.id];
    } else {
      document.themeOverrides ??= {};
      document.themeOverrides[placement.id] = next;
    }
  }
}

interface MatchedThemeAppearance {
  appearance: ButtonThemeAppearance;
  placementId: string;
}

type ThemeLayoutRect = Pick<ButtonPlacement, "x" | "y" | "width" | "height">;

type MainLayoutGroupId =
  | "program-list"
  | "program-footer"
  | "panel-list"
  | "panel-footer"
  | "header-left"
  | "header-right"
  | "button-controls";

interface MainLayoutItem {
  placement: ButtonPlacement;
  slot: ThemeLayoutRect;
  groupId: MainLayoutGroupId;
  section: string;
}

function finiteRect(value: unknown): ThemeLayoutRect | null {
  if (!isRecord(value)) return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
    return null;
  }
  if ((width as number) <= 0 || (height as number) <= 0) return null;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

function rectFits(
  rect: ThemeLayoutRect,
  bounds: ThemeLayoutRect
): boolean {
  const epsilon = 0.0001;
  return rect.x >= bounds.x - epsilon &&
    rect.y >= bounds.y - epsilon &&
    rect.x + rect.width <= bounds.x + bounds.width + epsilon &&
    rect.y + rect.height <= bounds.y + bounds.height + epsilon;
}

function panelOwnerSlots(
  document: ButtonStateDocument,
  surfaceId: string
): Map<string, ThemeLayoutRect> {
  const surface = document.surfaces[surfaceId];
  const placements = surface?.placementIds
    .map((placementId) => document.placements[placementId])
    .filter((placement): placement is ButtonPlacement => Boolean(placement)) ?? [];
  const owners = placements.flatMap((placement) => {
    const identity = panelOwnerIdentity(document, placement.buttonId);
    return identity ? [{ placement, panelName: identity.panelName }] : [];
  });
  const defaults = buildPanelRailOwnerEntries(owners.map((entry) => entry.panelName));
  return new Map(owners.map((entry, index) => [entry.placement.id, defaults[index].rect]));
}

function mainLayoutItem(
  document: ButtonStateDocument,
  placement: ButtonPlacement,
  ownerSlots: ReadonlyMap<string, ThemeLayoutRect>
): MainLayoutItem | null {
  const button = document.buttons[placement.buttonId];
  if (!button) return null;
  if (button.role === "panel-owner") {
    const slot = ownerSlots.get(placement.id);
    return slot ? { placement, slot, groupId: "panel-list", section: "Panel Rail" } : null;
  }
  const section = typeof button.metadata.mainPageSection === "string"
    ? button.metadata.mainPageSection
    : "";
  const key = typeof button.metadata.mainPageControlKey === "string"
    ? button.metadata.mainPageControlKey
    : "";
  const slot = finiteRect(button.metadata.mainPageDefaultRect);
  if (!slot) return null;
  if (section === "Program Rail") {
    return {
      placement,
      slot,
      groupId: key === "program-add" ? "program-footer" : "program-list",
      section
    };
  }
  if (section === "Panel Rail" && (key === "panel-add" || !key)) {
    return { placement, slot, groupId: "panel-footer", section };
  }
  if (section === "Header Buttons" && key.startsWith("top-left-button-")) {
    return { placement, slot, groupId: "header-left", section };
  }
  if (section === "Header Buttons" && key.startsWith("top-right-button-")) {
    return { placement, slot, groupId: "header-right", section };
  }
  if (section === "Button Section Rail" && key) {
    return { placement, slot, groupId: "button-controls", section };
  }
  return null;
}

interface MainGridAxisSlot {
  position: number;
  templateSize: number;
  desiredSize: number;
}

const MAIN_LAYOUT_EPSILON = 0.0001;

function axisSlotIndex(slots: readonly MainGridAxisSlot[], position: number): number {
  return slots.findIndex((slot) => Math.abs(slot.position - position) <= MAIN_LAYOUT_EPSILON);
}

function buildMainGridAxis(
  items: readonly MainLayoutItem[],
  position: (item: MainLayoutItem) => number,
  templateSize: (item: MainLayoutItem) => number,
  desiredSize: (item: MainLayoutItem) => number
): MainGridAxisSlot[] {
  const slots: MainGridAxisSlot[] = [];
  for (const item of [...items].sort((left, right) => position(left) - position(right))) {
    const itemPosition = position(item);
    const existingIndex = axisSlotIndex(slots, itemPosition);
    if (existingIndex >= 0) {
      const existing = slots[existingIndex];
      existing.templateSize = Math.max(existing.templateSize, templateSize(item));
      existing.desiredSize = Math.max(existing.desiredSize, desiredSize(item));
    } else {
      slots.push({
        position: itemPosition,
        templateSize: templateSize(item),
        desiredSize: desiredSize(item)
      });
    }
  }
  return slots.sort((left, right) => left.position - right.position);
}

function mainGridGaps(slots: readonly MainGridAxisSlot[]): number[] | null {
  const gaps: number[] = [];
  for (let index = 0; index < slots.length - 1; index += 1) {
    const current = slots[index];
    const next = slots[index + 1];
    const gap = next.position - current.position - current.templateSize;
    if (gap < -MAIN_LAYOUT_EPSILON) return null;
    gaps.push(Math.max(0, gap));
  }
  return gaps;
}

function templateEnvelope(items: readonly MainLayoutItem[]): ThemeLayoutRect {
  const x = Math.min(...items.map((item) => item.slot.x));
  const y = Math.min(...items.map((item) => item.slot.y));
  const right = Math.max(...items.map((item) => item.slot.x + item.slot.width));
  const bottom = Math.max(...items.map((item) => item.slot.y + item.slot.height));
  return { x, y, width: right - x, height: bottom - y };
}

function layoutMainGrid(items: readonly MainLayoutItem[], bounds: ThemeLayoutRect): string | null {
  if (items.length === 0) return "The registered Main layout group is empty.";
  const columns = buildMainGridAxis(
    items,
    (item) => item.slot.x,
    (item) => item.slot.width,
    (item) => item.placement.width
  );
  const rows = buildMainGridAxis(
    items,
    (item) => item.slot.y,
    (item) => item.slot.height,
    (item) => item.placement.height
  );
  const columnGaps = mainGridGaps(columns);
  const rowGaps = mainGridGaps(rows);
  if (!columnGaps || !rowGaps) {
    return "The registered Main layout slots overlap.";
  }
  const packedWidth = columns.reduce((total, column) => total + column.desiredSize, 0) +
    columnGaps.reduce((total, gap) => total + gap, 0);
  const packedHeight = rows.reduce((total, row) => total + row.desiredSize, 0) +
    rowGaps.reduce((total, gap) => total + gap, 0);
  const template = templateEnvelope(items);
  const packed = {
    x: template.x + template.width / 2 - packedWidth / 2,
    y: template.y + template.height / 2 - packedHeight / 2,
    width: packedWidth,
    height: packedHeight
  };
  if (!rectFits(packed, bounds)) {
    return "The themed Main Button group does not fit inside its assigned area.";
  }
  const columnStarts: number[] = [];
  const rowStarts: number[] = [];
  let cursor = packed.x;
  columns.forEach((column, index) => {
    columnStarts.push(cursor);
    cursor += column.desiredSize + (columnGaps[index] ?? 0);
  });
  cursor = packed.y;
  rows.forEach((row, index) => {
    rowStarts.push(cursor);
    cursor += row.desiredSize + (rowGaps[index] ?? 0);
  });
  for (const item of items) {
    const columnIndex = axisSlotIndex(columns, item.slot.x);
    const rowIndex = axisSlotIndex(rows, item.slot.y);
    if (columnIndex < 0 || rowIndex < 0) return "A registered Main layout slot could not be resolved.";
    item.placement.x = columnStarts[columnIndex] +
      (columns[columnIndex].desiredSize - item.placement.width) / 2;
    item.placement.y = rowStarts[rowIndex] +
      (rows[rowIndex].desiredSize - item.placement.height) / 2;
  }
  return null;
}

function railBounds(railId: string): ThemeLayoutRect | null {
  return rails.find((rail) => rail.id === railId) ?? null;
}

function mainControlSlot(document: ButtonStateDocument, key: string): ThemeLayoutRect | null {
  const button = Object.values(document.buttons).find((candidate) =>
    candidate.metadata.mainPageControlKey === key
  );
  return button ? finiteRect(button.metadata.mainPageDefaultRect) : null;
}

function footerBandBounds(
  document: ButtonStateDocument,
  railId: string,
  footerKey: string
): { content: ThemeLayoutRect; footer: ThemeLayoutRect } | null {
  const rail = railBounds(railId);
  const slot = mainControlSlot(document, footerKey);
  if (!rail || !slot) return null;
  const railBottom = rail.y + rail.height;
  const footerCenterY = slot.y + slot.height / 2;
  const bandTop = 2 * footerCenterY - railBottom;
  if (bandTop <= rail.y || bandTop >= railBottom) return null;
  return {
    content: { x: rail.x, y: rail.y, width: rail.width, height: bandTop - rail.y },
    footer: { x: rail.x, y: bandTop, width: rail.width, height: railBottom - bandTop }
  };
}

function mainGroupBounds(
  document: ButtonStateDocument,
  groupId: MainLayoutGroupId,
  allItems: readonly MainLayoutItem[]
): ThemeLayoutRect | null {
  if (groupId === "program-list" || groupId === "program-footer") {
    const bands = footerBandBounds(document, "program-rail", "program-add");
    return bands ? (groupId === "program-list" ? bands.content : bands.footer) : null;
  }
  if (groupId === "panel-list" || groupId === "panel-footer") {
    const bands = footerBandBounds(document, "panel-rail", "panel-add");
    return bands ? (groupId === "panel-list" ? bands.content : bands.footer) : null;
  }
  if (groupId === "button-controls") {
    const rail = railBounds("buttons-rail");
    return rail
      ? { ...rail, height: buttonsSurfaceContentOrigin.y - rail.y }
      : null;
  }
  const headerBottom = Math.min(...rails.map((rail) => rail.y));
  const left = allItems.filter((item) => item.groupId === "header-left");
  const right = allItems.filter((item) => item.groupId === "header-right");
  const leftEnvelope = left.length > 0 ? templateEnvelope(left) : null;
  const rightEnvelope = right.length > 0 ? templateEnvelope(right) : null;
  const split = leftEnvelope && rightEnvelope
    ? (leftEnvelope.x + leftEnvelope.width + rightEnvelope.x) / 2
    : page.width / 2;
  return groupId === "header-left"
    ? { x: 0, y: 0, width: split, height: headerBottom }
    : { x: split, y: 0, width: page.width - split, height: headerBottom };
}

function layoutMainSurface(
  document: ButtonStateDocument,
  surfaceId: string,
  entries: readonly MatchedThemeAppearance[]
): string | null {
  const surface = document.surfaces[surfaceId];
  if (!surface || surface.kind !== "main") return "The saved Main area no longer exists.";
  const ownerSlots = panelOwnerSlots(document, surfaceId);
  const allItems = surface.placementIds.flatMap((placementId) => {
    const placement = document.placements[placementId];
    const item = placement ? mainLayoutItem(document, placement, ownerSlots) : null;
    return item ? [item] : [];
  });
  const itemsByPlacementId = new Map(allItems.map((item) => [item.placement.id, item]));
  const touchedGroups = new Set<MainLayoutGroupId>();
  for (const entry of entries) {
    const placement = document.placements[entry.placementId];
    const button = placement ? document.buttons[placement.buttonId] : null;
    if (!placement || !button) return "A saved Main Button no longer exists.";
    const item = itemsByPlacementId.get(placement.id);
    const sizeChanged =
      Math.abs(placement.width - entry.appearance.width) > MAIN_LAYOUT_EPSILON ||
      Math.abs(placement.height - entry.appearance.height) > MAIN_LAYOUT_EPSILON;
    if (!item && sizeChanged) {
      return `Button '${button.label}' has no registered Main layout slot for resizing.`;
    }
    if (item && sizeChanged) {
      touchedGroups.add(item.groupId);
    }
    placement.width = entry.appearance.width;
    placement.height = entry.appearance.height;
  }
  for (const groupId of touchedGroups) {
    const groupItems = allItems.filter((item) => item.groupId === groupId);
    const bounds = mainGroupBounds(document, groupId, allItems);
    if (!bounds) return `The ${groupItems[0]?.section ?? "Main"} layout bounds are unavailable.`;
    const problem = layoutMainGrid(groupItems, bounds);
    if (problem) return `${groupItems[0]?.section ?? "Main"}: ${problem}`;
  }
  const placements = surface.placementIds.flatMap((placementId) => {
    const placement = document.placements[placementId];
    return placement ? [{ id: placement.id, rect: placement }] : [];
  });
  if (placements.length !== surface.placementIds.length) {
    return "The Main area contains a missing Button placement.";
  }
  return validateExactButtonLayoutGeometry(placements, surface)[0]?.message ?? null;
}

function surfaceOwnerPlacementId(document: ButtonStateDocument, surfaceId: string): string | null {
  const unit = Object.values(document.popoutUnits).find((candidate) => candidate.surfaceId === surfaceId);
  const unitOwnerPlacementId = unit && "ownerPlacementId" in unit && typeof unit.ownerPlacementId === "string"
    ? unit.ownerPlacementId
    : null;
  const fanSetup = Object.values(document.fanSetups).find((candidate) => candidate.fanSurfaceId === surfaceId);
  return unitOwnerPlacementId ?? (fanSetup
    ? document.surfaces[surfaceId]?.placementIds.find((placementId) =>
        document.placements[placementId]?.buttonId === fanSetup.panelOwnerButtonId
      ) ?? null
    : null);
}

function layoutPanelSurface(
  document: ButtonStateDocument,
  surfaceId: string,
  entries: readonly MatchedThemeAppearance[]
): string | null {
  const surface = document.surfaces[surfaceId];
  if (!surface || surface.kind !== "panel") return "The saved Button Section no longer exists.";
  const placements = surface.placementIds.flatMap((placementId) => {
    const placement = document.placements[placementId];
    return placement ? [{
      id: placement.id,
      rect: {
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height
      }
    }] : [];
  });
  if (placements.length !== surface.placementIds.length) {
    return "The Button Section contains a missing Button placement.";
  }
  const selectedIds = entries.map((entry) => entry.placementId);
  const selectedIdSet = new Set(selectedIds);
  if (selectedIdSet.size !== selectedIds.length) return "The theme maps more than once to one Button placement.";
  const hasSizeChange = entries.some((entry) => {
    const placement = document.placements[entry.placementId];
    return !placement ||
      Math.abs(placement.width - entry.appearance.width) > MAIN_LAYOUT_EPSILON ||
      Math.abs(placement.height - entry.appearance.height) > MAIN_LAYOUT_EPSILON;
  });
  if (!hasSizeChange) return null;
  const independentPlacementId = surfaceOwnerPlacementId(document, surfaceId);
  const independentPlacementIds = independentPlacementId ? [independentPlacementId] : [];
  const contentSelectedIds = selectedIds.filter((placementId) => placementId !== independentPlacementId);
  const originalAnchor = placements
    .filter((placement) => contentSelectedIds.includes(placement.id))
    .sort((left, right) =>
      left.rect.y - right.rect.y || left.rect.x - right.rect.x || left.id.localeCompare(right.id)
    )[0] ?? null;
  let resolved = placements;
  const orderedEntries = [...entries].sort((left, right) => {
    const leftRect = document.placements[left.placementId];
    const rightRect = document.placements[right.placementId];
    return leftRect.y - rightRect.y || leftRect.x - rightRect.x || left.placementId.localeCompare(right.placementId);
  });
  for (const entry of orderedEntries) {
    const resized = resizeButtonPlacementSelection({
      placements: resolved,
      selectedPlacementIds: [entry.placementId],
      targetSize: { width: entry.appearance.width, height: entry.appearance.height },
      surface,
      gap: buttonSpacingPixelsFromMillimeters(document.settings.buttonSpacingMm),
      independentPlacementIds
    });
    if (!resized.success) return resized.reason ?? "The themed Button size does not fit this Button Section.";
    resolved = resized.placements;
  }
  if (contentSelectedIds.length > 0) {
    const aligned = alignButtonPlacementSelectionToTopLeftButton({
      placements: resolved,
      selectedPlacementIds: contentSelectedIds,
      surface,
      gap: buttonSpacingPixelsFromMillimeters(document.settings.buttonSpacingMm),
      independentPlacementIds
    });
    if (!aligned.success) return aligned.reason ?? "The themed Buttons cannot align to their top-left Button.";
    resolved = aligned.placements;
    const nextAnchor = originalAnchor
      ? resolved.find((placement) => placement.id === originalAnchor.id)
      : null;
    if (
      originalAnchor &&
      (!nextAnchor || nextAnchor.rect.x !== originalAnchor.rect.x || nextAnchor.rect.y !== originalAnchor.rect.y)
    ) {
      return "The themed Buttons cannot resize while keeping the current top-left Button fixed.";
    }
  }
  for (const result of resolved) {
    const placement = document.placements[result.id];
    if (placement) Object.assign(placement, result.rect);
  }
  surface.uniformButtonSize = null;
  return null;
}

export function applyThemeFile(
  current: ButtonStateDocument,
  theme: FlowCellThemeFile
): ThemeApplyResult {
  if (!isFlowCellThemeFile(theme)) {
    throw new Error(`The selected file is not a valid version ${FLOWCELL_THEME_VERSION} FlowCell Theme.`);
  }
  const document = cloneButtonDocument(current);
  let appliedButtonCount = 0;
  let missingButtonCount = 0;
  const skippedButtonCount = 0;
  const issues: ThemeApplyIssue[] = [];
  const claimedPlacementIds = new Set<string>();
  const matchedPlacementIds: Record<string, string> = {};

  for (const appearance of theme.buttons) {
    const placement = findThemePlacement(document, appearance, theme.target, claimedPlacementIds);
    if (!placement) {
      missingButtonCount += 1;
      continue;
    }
    claimedPlacementIds.add(placement.id);
    applyAppearanceToPlacement(document, placement, appearance);
    matchedPlacementIds[appearance.placementId] = placement.id;
    appliedButtonCount += 1;
  }

  document.revision = current.revision;
  const validation = validateButtonStateDocument(document);
  if (!validation.valid) {
    const first = validation.issues[0];
    throw new Error(
      `The themed Button document is invalid${first ? ` at ${first.path}: ${first.message}` : "."}`
    );
  }
  return {
    document,
    appliedButtonCount,
    missingButtonCount,
    skippedButtonCount,
    matchedPlacementIds,
    issues
  };
}

function parseThemeColor(value: string): { r: number; g: number; b: number; a: number } | null {
  const normalized = normalizeButtonSkinColor(value);
  if (!normalized || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(normalized)) return null;
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
    a: normalized.length === 9 ? Number.parseInt(normalized.slice(7, 9), 16) : 255
  };
}

function channelHex(value: number): string {
  return Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0");
}

export function interpolateThemeColor(top: string, bottom: string, t: number): string {
  const start = parseThemeColor(top);
  const end = parseThemeColor(bottom);
  if (!start || !end) return top;
  const amount = Math.min(1, Math.max(0, t));
  const alpha = channelHex(start.a + (end.a - start.a) * amount);
  return `#${channelHex(start.r + (end.r - start.r) * amount)}${channelHex(start.g + (end.g - start.g) * amount)}${channelHex(start.b + (end.b - start.b) * amount)}${start.a === 255 && end.a === 255 ? "" : alpha}`;
}

export function gradientPositionForPlacement(args: {
  placementId: string;
  y: number;
  minimumY: number;
  maximumY: number;
  gradient: Pick<ThemeGradientDefinition, "spread" | "scatter" | "seed">;
}): number {
  const range = Math.max(1, args.maximumY - args.minimumY);
  const normalized = Math.min(1, Math.max(0, (args.y - args.minimumY) / range));
  const spread = Math.min(1, Math.max(0, args.gradient.spread / 100));
  const scatter = Math.min(1, Math.max(0, args.gradient.scatter / 100));
  const baseT = 0.5 + (normalized - 0.5) * spread;
  const unit = stableHash(`${args.gradient.seed}\u0000${args.placementId}`) / 0xffffffff;
  const jitter = (unit - 0.5) * 0.5 * scatter;
  return Math.min(1, Math.max(0, baseT + jitter));
}

export function gradientColorForPlacement(args: {
  placementId: string;
  y: number;
  minimumY: number;
  maximumY: number;
  gradient: ThemeGradientDefinition;
}): string {
  return interpolateThemeColor(
    args.gradient.topColor,
    args.gradient.bottomColor,
    gradientPositionForPlacement(args)
  );
}

export interface ThemeGradientBakeResult {
  theme: FlowCellThemeFile;
  layout: ThemeApplyResult;
  colorsBySavedPlacementId: Record<string, string>;
}

export function bakeThemeGradientForDeployedLayout(
  current: ButtonStateDocument,
  theme: FlowCellThemeFile
): ThemeGradientBakeResult {
  const baked = structuredClone(theme);
  const layout = applyThemeFile(current, baked);
  const colorsBySavedPlacementId: Record<string, string> = {};
  if (!baked.gradient) return { theme: baked, layout, colorsBySavedPlacementId };

  const eligible = baked.buttons.flatMap((appearance) => {
    if (!appearance.gradientEnabled) return [];
    const matchedPlacementId = layout.matchedPlacementIds[appearance.placementId];
    const placement = matchedPlacementId
      ? layout.document.placements[matchedPlacementId]
      : null;
    if (!placement) return [];
    return [{
      appearance,
      y: themePlacementDeployedCenterY(layout.document, placement, baked.target)
    }];
  });
  if (eligible.length === 0) return { theme: baked, layout, colorsBySavedPlacementId };

  const minimumY = Math.min(...eligible.map((entry) => entry.y));
  const maximumY = Math.max(...eligible.map((entry) => entry.y));
  for (const entry of eligible) {
    const gradient = entry.appearance.scatterEnabled
      ? baked.gradient
      : { ...baked.gradient, scatter: 0 };
    const color = gradientColorForPlacement({
      placementId: entry.appearance.placementId,
      y: entry.y,
      minimumY,
      maximumY,
      gradient
    });
    if (baked.gradient.role === THEME_HOVER_HIGHLIGHT_ROLE) {
      entry.appearance.themeOverride.hoverColor = color;
    } else if (baked.gradient.role === THEME_ACTIVE_HIGHLIGHT_ROLE) {
      entry.appearance.themeOverride.activeColor = color;
    } else {
      entry.appearance.themeOverride.colors[baked.gradient.role] = color;
    }
    colorsBySavedPlacementId[entry.appearance.placementId] = color;
  }
  return { theme: baked, layout, colorsBySavedPlacementId };
}

export function isFlowCellThemeFile(value: unknown): value is FlowCellThemeFile {
  if (!isRecord(value)) return false;
  if (!hasOnlyKeys(value, ["kind", "version", "savedAt", "target", "page", "buttons", "gradient"])) {
    return false;
  }
  const target = value.target;
  const buttons = value.buttons;
  if (
    value.kind !== FLOWCELL_THEME_KIND ||
    value.version !== FLOWCELL_THEME_VERSION ||
    typeof value.savedAt !== "string" ||
    !value.savedAt.trim() ||
    !Number.isFinite(Date.parse(value.savedAt)) ||
    !isThemeTarget(target) ||
    !Array.isArray(buttons) ||
    !buttons.every(isButtonThemeAppearance) ||
    !isThemeGradientDefinition(value.gradient)
  ) {
    return false;
  }
  const placementIds = buttons.map((button) => button.placementId);
  if (new Set(placementIds).size !== placementIds.length) return false;
  if (target.kind === "flowcell") {
    if (!isThemePageAppearance(value.page) || value.page.pageId !== target.page) return false;
    if (buttons.some((button) => !themePageSupportsButtonSurface(
      target.page,
      { id: button.surfaceId, kind: button.surfaceKind }
    ))) return false;
  } else {
    if (
      value.page !== null ||
      (target.area === "popouts" && buttons.some((button) =>
        !PROGRAM_POPOUT_SURFACE_KINDS.has(button.surfaceKind)
      ))
    ) return false;
  }
  return true;
}

function isLegacyFlowCellThemeFile(value: unknown): value is LegacyFlowCellThemeFile {
  if (!isRecord(value) || !hasOnlyKeys(
    value,
    ["kind", "version", "savedAt", "target", "page", "buttons", "gradient"]
  )) return false;
  const target = value.target;
  const buttons = value.buttons;
  if (
    value.kind !== FLOWCELL_THEME_KIND ||
    value.version !== LEGACY_FLOWCELL_THEME_VERSION ||
    typeof value.savedAt !== "string" ||
    !value.savedAt.trim() ||
    !Number.isFinite(Date.parse(value.savedAt)) ||
    !isThemeTarget(target) ||
    !Array.isArray(buttons) ||
    !buttons.every(isLegacyButtonThemeAppearance) ||
    !isThemeGradientDefinition(value.gradient)
  ) return false;
  if (new Set(buttons.map((button) => button.placementId)).size !== buttons.length) return false;
  if (target.kind === "flowcell") {
    return isThemePageAppearance(value.page) && value.page.pageId === target.page;
  }
  return value.page === null && (
    target.area !== "popouts" ||
    buttons.every((button) => PROGRAM_POPOUT_SURFACE_KINDS.has(button.surfaceKind))
  );
}

export function normalizeFlowCellThemeFile(value: unknown): FlowCellThemeFile | null {
  if (isFlowCellThemeFile(value)) return structuredClone(value);
  if (!isLegacyFlowCellThemeFile(value)) return null;
  const migrated: FlowCellThemeFile = {
    ...structuredClone(value),
    version: FLOWCELL_THEME_VERSION,
    buttons: value.buttons.map((appearance) => ({
      ...structuredClone(appearance),
      themeOverride: {
        colors: Object.fromEntries(
          extractSkinColorRoots(appearance.skin).map((root) => [root.role, root.value])
        ),
        hoverEnabled: readButtonSkinHighlightOnHover(appearance.skin) ?? appearance.highlightOnHover,
        activeEnabled: readButtonSkinHighlightOnActive(appearance.skin),
        hoverColor: null,
        activeColor: null
      },
      assignSkin: true
    }))
  };
  return isFlowCellThemeFile(migrated) ? migrated : null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key)) && keys.every((key) => key in value);
}

function hasRequiredAndOptionalKeys(
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[]
): boolean {
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  return Object.keys(value).every((key) => allowed.has(key)) &&
    requiredKeys.every((key) => key in value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, ancestors))
    : Object.values(value).every((entry) => isJsonValue(entry, ancestors));
  ancestors.delete(value);
  return valid;
}

function isThemeTarget(value: unknown): value is ThemeTarget {
  if (!isRecord(value)) return false;
  if (value.kind === "flowcell") {
    return hasOnlyKeys(value, ["kind", "page"]) &&
      isFlowCellThemePageId(value.page);
  }
  return value.kind === "program" &&
    hasRequiredAndOptionalKeys(
      value,
      ["kind", "programName", "panelName"],
      ["area"]
    ) &&
    isNonemptyString(value.programName) &&
    (value.panelName === null || isNonemptyString(value.panelName)) &&
    (value.area === undefined || value.area === "popouts") &&
    (value.area !== "popouts" || value.panelName === null);
}

function isSourceIdentity(value: unknown): value is ButtonSourceIdentity {
  if (!isRecord(value)) return false;
  const keys = [
    "displayProgramName",
    "displayPanelName",
    "displayFileName",
    "normalizedProgramName",
    "normalizedPanelName",
    "normalizedFileName"
  ];
  return hasOnlyKeys(value, keys) && keys.every((key) => isNonemptyString(value[key]));
}

function isPanelOwnerIdentity(
  value: unknown
): value is { programName: string; panelName: string } {
  return isRecord(value) &&
    hasOnlyKeys(value, ["programName", "panelName"]) &&
    isNonemptyString(value.programName) &&
    isNonemptyString(value.panelName);
}

function isButtonSkin(value: unknown): value is ButtonSkin {
  if (!isRecord(value)) return false;
  const keys = [
    "id",
    "name",
    ...BUTTON_SKIN_SECTION_ORDER,
    "metadata",
    "compileCache"
  ];
  if (
    !hasOnlyKeys(value, keys) ||
    !isNonemptyString(value.id) ||
    !isNonemptyString(value.name) ||
    !BUTTON_SKIN_SECTION_ORDER.every((section) => typeof value[section] === "string") ||
    !isRecord(value.metadata) ||
    !isJsonValue(value.metadata)
  ) {
    return false;
  }
  if (value.compileCache !== null) return false;
  return validateButtonSkin(value as unknown as Parameters<typeof validateButtonSkin>[0]).valid;
}

function isButtonThemeAppearance(value: unknown): value is ButtonThemeAppearance {
  if (!isRecord(value)) return false;
  const requiredKeys = [
    "placementId",
    "buttonId",
    "surfaceId",
    "surfaceName",
    "surfaceKind",
    "sourceIdentity",
    "panelOwnerIdentity",
    "label",
    "skin",
    "width",
    "height",
    "textFitMode",
    "textAlignment",
    "textOffsetX",
    "textOffsetY",
    "minimumFontSize",
    "textSizeOverride",
    "allowLabelResize",
    "matchHitboxToSkin",
    "allowStretching",
    "highlightOnHover",
    "gradientEnabled",
    "scatterEnabled",
    "themeOverride",
    "assignSkin"
  ];
  if (!hasRequiredAndOptionalKeys(value, requiredKeys, ["highlightColorReset"])) {
    return false;
  }
  const valid = isNonemptyString(value.placementId) &&
    isNonemptyString(value.buttonId) &&
    isNonemptyString(value.surfaceId) &&
    isNonemptyString(value.surfaceName) &&
    typeof value.surfaceKind === "string" &&
    BUTTON_SURFACE_KINDS.has(value.surfaceKind as ButtonSurfaceKind) &&
    (value.sourceIdentity === null || isSourceIdentity(value.sourceIdentity)) &&
    (value.panelOwnerIdentity === null || isPanelOwnerIdentity(value.panelOwnerIdentity)) &&
    typeof value.label === "string" &&
    isButtonSkin(value.skin) &&
    isFiniteNumber(value.width) && value.width > 0 &&
    isFiniteNumber(value.height) && value.height > 0 &&
    typeof value.textFitMode === "string" &&
    TEXT_FIT_MODES.has(value.textFitMode as ButtonPlacement["textFitMode"]) &&
    typeof value.textAlignment === "string" &&
    TEXT_ALIGNMENTS.has(value.textAlignment as ButtonPlacement["textAlignment"]) &&
    isFiniteNumber(value.textOffsetX) &&
    isFiniteNumber(value.textOffsetY) &&
    isFiniteNumber(value.minimumFontSize) && value.minimumFontSize >= 1 &&
    (value.textSizeOverride === null || (isFiniteNumber(value.textSizeOverride) && value.textSizeOverride >= 1)) &&
    typeof value.allowLabelResize === "boolean" &&
    typeof value.matchHitboxToSkin === "boolean" &&
    typeof value.allowStretching === "boolean" &&
    typeof value.highlightOnHover === "boolean" &&
    typeof value.gradientEnabled === "boolean" &&
    typeof value.scatterEnabled === "boolean" &&
    isButtonThemeOverride(value.themeOverride) &&
    typeof value.assignSkin === "boolean" &&
    (value.highlightColorReset === undefined || isThemeHighlightColorResetIntent(
      value.highlightColorReset
    ));
  if (!valid) return false;
  const reset = value.highlightColorReset as ThemeHighlightColorResetIntent | undefined;
  const override = value.themeOverride as ButtonThemeOverride;
  return !reset || (
    (!reset.hover || override.hoverColor === null) &&
    (!reset.active || override.activeColor === null)
  );
}

function isThemeHighlightColorResetIntent(
  value: unknown
): value is ThemeHighlightColorResetIntent {
  return isRecord(value) &&
    hasOnlyKeys(value, ["hover", "active"]) &&
    typeof value.hover === "boolean" &&
    typeof value.active === "boolean" &&
    (value.hover || value.active);
}

function isLegacyButtonThemeAppearance(
  value: unknown
): value is Omit<
  ButtonThemeAppearance,
  "themeOverride" | "assignSkin" | "highlightColorReset"
> {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "placementId",
    "buttonId",
    "surfaceId",
    "surfaceName",
    "surfaceKind",
    "sourceIdentity",
    "panelOwnerIdentity",
    "label",
    "skin",
    "width",
    "height",
    "textFitMode",
    "textAlignment",
    "textOffsetX",
    "textOffsetY",
    "minimumFontSize",
    "textSizeOverride",
    "allowLabelResize",
    "matchHitboxToSkin",
    "allowStretching",
    "highlightOnHover",
    "gradientEnabled",
    "scatterEnabled"
  ])) return false;
  return isButtonThemeAppearance({
    ...value,
    themeOverride: emptyButtonThemeOverride(),
    assignSkin: false
  });
}

function isButtonThemeOverride(value: unknown): value is ButtonThemeOverride {
  if (!isRecord(value) || !hasRequiredAndOptionalKeys(
    value,
    ["colors", "hoverEnabled", "activeEnabled", "hoverColor", "activeColor"],
    [
      "highlightAmount",
      "hoverHighlightAmount",
      "activeHighlightAmount",
      "hoverGlowAmount",
      "activeGlowAmount"
    ]
  )) return false;
  if (!isRecord(value.colors)) return false;
  if (!Object.entries(value.colors).every(([role, color]) =>
    /^[a-z][a-z0-9-]*$/.test(role) &&
    typeof color === "string" &&
    normalizeButtonSkinColor(color) !== null
  )) return false;
  return (value.hoverEnabled === null || typeof value.hoverEnabled === "boolean") &&
    (value.activeEnabled === null || typeof value.activeEnabled === "boolean") &&
    (value.hoverColor === null || (
      typeof value.hoverColor === "string" && normalizeButtonSkinColor(value.hoverColor) !== null
    )) &&
    (value.activeColor === null || (
      typeof value.activeColor === "string" && normalizeButtonSkinColor(value.activeColor) !== null
    )) &&
    [value.hoverHighlightAmount, value.activeHighlightAmount].every(
      (amount) => amount === undefined || amount === null ||
        normalizeButtonHighlightAmount(amount) !== null
    ) &&
    [value.highlightAmount, value.hoverGlowAmount, value.activeGlowAmount].every(
      (amount) => amount === undefined || amount === null ||
        normalizeButtonGlowAmount(amount) !== null
    );
}

export function isThemeGradientDefinition(
  value: unknown
): value is ThemeGradientDefinition | null {
  if (value === null) return true;
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "role",
    "topColor",
    "bottomColor",
    "spread",
    "scatter",
    "seed"
  ])) {
    return false;
  }
  return isNonemptyString(value.role) &&
    /^[a-z][a-z0-9-]*$/.test(value.role) &&
    typeof value.topColor === "string" && normalizeButtonSkinColor(value.topColor) !== null &&
    typeof value.bottomColor === "string" && normalizeButtonSkinColor(value.bottomColor) !== null &&
    isFiniteNumber(value.spread) && value.spread >= 0 && value.spread <= 100 &&
    isFiniteNumber(value.scatter) && value.scatter >= 0 && value.scatter <= 100 &&
    Number.isSafeInteger(value.seed);
}
