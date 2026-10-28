import type {
  ButtonFanSetup, ButtonPlacement, ButtonPopoutUnit, ButtonRecord,
  ButtonStateDocument, ButtonSurface, JsonObject, ProgramPopoutThemeSettings,
  ProgramPopoutColorOverride, ButtonThemeOverride
} from "../button/types.js";
import { createButtonStateDocument } from "../button/state/buttonDefaults.js";
import { validateButtonStateDocument } from "../button/state/buttonStateValidation.js";
import { resolveButtonPlacementPresentation } from "../button/state/buttonPresentation.js";
import {
  applyThemeFile, captureThemeFile, isFlowCellThemeFile, listThemePlacements,
  placementMatchesThemeTarget, type FlowCellThemeFile, type ThemeTarget
} from "./themeModel.js";
import { normalizeProgramPopoutColorOverride, normalizeProgramPopoutThemeLock, normalizeProgramPopoutThemeSettings, resolveProgramPopoutThemeOverride } from "./programPopoutTheme.js";
import { getFlowCellThemePageDefinition } from "./themePageRegistry.js";

/** Recipient-local descriptors are never serialized into a theme. */
export interface ThemeToolDescriptor {
  ownerButtonId: string;
  programName: string;
  programId: string;
  panelName: string;
  sourceId: string;
  sourceVersion: string;
  sourceName: string;
  importKind: "script" | "tool-set";
  catalogPath?: string | null;
  sourcePath?: string | null;
  slots: string[];
}

export interface PortableThemeDependency extends Omit<ThemeToolDescriptor,
  "ownerButtonId" | "catalogPath" | "sourcePath"> {
  id: string;
}

export type PortableButtonReference =
  | { kind: "source"; dependencyId: string; slot: string | null }
  | { kind: "panel"; programName: string; panelName: string }
  | { kind: "core"; actionId: string; controlKey: string };

export interface PortableThemeContribution {
  version: 1;
  sourceId: string;
  sourceVersion?: string;
  state: JsonObject;
  assetFields: string[];
}

export type PortablePlacementPresentation = Omit<ButtonPlacement,
  "id" | "buttonId" | "surfaceId" | "skinOverrideId" | "presentationOverride">;
export type PortableButtonPresentation = Pick<ButtonRecord,
  "label" | "tooltip" | "defaultTextFitMode" | "activationAnimation" | "activationBehavior">;

export interface PortableThemeSurface {
  id: string;
  name: string;
  kind: ButtonSurface["kind"];
  width: number;
  height: number;
  visualOverflowAllowance: number;
  uniformButtonSize: ButtonSurface["uniformButtonSize"];
  placementIds: string[];
  /** Only whole-surface captures can replace dimensions/order, preserving other targets. */
  complete: boolean;
  ownerButtonId: string | null;
  popout?: {
    kind: ButtonPopoutUnit["kind"];
    canonicalBounds: ButtonPopoutUnit["canonicalBounds"];
    openRule: ButtonPopoutUnit["openRule"];
    closeRule: ButtonPopoutUnit["closeRule"];
    interactionMode?: ButtonPopoutUnit["interactionMode"];
    transparency: number;
    pinnedDefault: boolean;
    windowFitMode?: ButtonPopoutUnit["windowFitMode"];
    closeControlOffset?: { x: number; y: number };
    /** Field geometry only. Field values, execution, and behavior stay recipient-local. */
    fieldGeometry?: Record<string, Pick<ButtonPlacement, "x" | "y" | "width" | "height" | "zIndex">>;
  };
  fan?: Pick<ButtonFanSetup, "openRule" | "closeRule" | "pinnedDefault" | "animation" | "windowFitMode" | "closeControlOffset"> & {
    selectedToolSetOwnerButtonIds: string[];
  };
}

export interface PortableTheme {
  kind: "FlowCellPortableTheme";
  version: 1;
  id: string;
  name: string;
  savedAt: string;
  target: ThemeTarget;
  theme: FlowCellThemeFile;
  dependencies: PortableThemeDependency[];
  references: Record<string, PortableButtonReference>;
  presentation: Record<string, { button: PortableButtonPresentation; placement: PortablePlacementPresentation }>;
  surfaces: PortableThemeSurface[];
  contributions: Record<string, PortableThemeContribution>;
  programAppearance?: {
    settings: ProgramPopoutThemeSettings | null;
    overrides: Record<string, ProgramPopoutColorOverride>;
    locks: Record<string, ButtonThemeOverride>;
  };
}

export interface PortableThemeImportPlan {
  revision: number;
  selectedTarget: ThemeTarget;
  themeId: string;
  issues: string[];
  missingDependencies: PortableThemeDependency[];
  dependencyOwners: Record<string, string>;
  buttonIds: Record<string, string>;
  placementIds: Record<string, string>;
  surfaceIds: Record<string, string>;
}

function equalName(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

export function themeTargetsMatch(left: ThemeTarget, right: ThemeTarget): boolean {
  return left.kind === "flowcell"
    ? right.kind === "flowcell" && left.page === right.page
    : right.kind === "program" && equalName(left.programName, right.programName);
}

/** Restrict portable dependencies and arrangements before any installer can run. */
export function portableThemeForScope(theme: PortableTheme, target: ThemeTarget): PortableTheme {
  if (!themeTargetsMatch(theme.target, target)) return theme;
  if (target.kind !== "program") return theme;
  const dependencies = new Map(theme.dependencies.map((entry) => [entry.id, entry]));
  const buttons = theme.theme.buttons.filter((appearance) => {
    if (target.area === "popouts" && !["regular-popout", "tool-set-popout", "fan"].includes(appearance.surfaceKind)) return false;
    if (target.panelName === null) return true;
    const reference = theme.references[appearance.buttonId];
    const panel = reference.kind === "source" ? dependencies.get(reference.dependencyId)?.panelName :
      reference.kind === "panel" ? reference.panelName : null;
    return panel !== null && panel !== undefined && equalName(panel, target.panelName);
  });
  const placementIds = new Set(buttons.map((entry) => entry.placementId));
  const surfaceIds = new Set(buttons.map((entry) => entry.surfaceId));
  const surfaces = theme.surfaces.filter((surface) => surfaceIds.has(surface.id)).map((surface) => ({
    ...structuredClone(surface), placementIds: surface.placementIds.filter((id) => placementIds.has(id)),
    complete: surface.complete && surface.placementIds.every((id) => placementIds.has(id))
  }));
  const buttonIds = new Set(buttons.map((entry) => entry.buttonId));
  surfaces.forEach((surface) => {
    if (surface.ownerButtonId) buttonIds.add(surface.ownerButtonId);
    surface.fan?.selectedToolSetOwnerButtonIds.forEach((id) => buttonIds.add(id));
  });
  const references = Object.fromEntries(Object.entries(theme.references).filter(([id]) => buttonIds.has(id)));
  const required = new Set(Object.values(references).flatMap((reference) => reference.kind === "source" ? [reference.dependencyId] : []));
  return { ...structuredClone(theme), target: structuredClone(target),
    theme: { ...structuredClone(theme.theme), target: structuredClone(target), buttons: structuredClone(buttons) },
    dependencies: theme.dependencies.filter((dependency) => required.has(dependency.id)), references, surfaces,
    presentation: Object.fromEntries(Object.entries(theme.presentation).filter(([id]) => placementIds.has(id))),
    ...(theme.programAppearance ? { programAppearance: {
      settings: structuredClone(theme.programAppearance.settings),
      overrides: Object.fromEntries(Object.entries(theme.programAppearance.overrides).filter(([id]) => placementIds.has(id))),
      locks: Object.fromEntries(Object.entries(theme.programAppearance.locks).filter(([id]) => placementIds.has(id)))
    } } : {})
  };
}

function equalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function portableKey(value: string): string {
  // Stable non-machine identifier. Collisions are checked before use.
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function dependencyIdentity(value: Pick<PortableThemeDependency, "programId" | "sourceId" | "sourceVersion" | "panelName">): string {
  return JSON.stringify([value.programId.toLowerCase(), value.sourceId, value.sourceVersion, value.panelName.toLowerCase()]);
}

function childSlot(button: ButtonRecord): string | null {
  const slot = button.metadata.toolSetSlot;
  if (typeof slot === "string" && slot.trim()) return slot;
  return button.executionTarget?.kind === "tool-set-action" ? button.executionTarget.command : null;
}

function panelReference(button: ButtonRecord): PortableButtonReference | null {
  return button.role === "panel-owner" && typeof button.metadata.programName === "string" &&
    typeof button.metadata.panelName === "string"
    ? { kind: "panel", programName: button.metadata.programName, panelName: button.metadata.panelName }
    : null;
}

function buttonPresentation(button: ButtonRecord): PortableButtonPresentation {
  return structuredClone({ label: button.label, tooltip: button.tooltip,
    defaultTextFitMode: button.defaultTextFitMode, activationAnimation: button.activationAnimation,
    activationBehavior: button.activationBehavior });
}

function placementPresentation(placement: ButtonPlacement): PortablePlacementPresentation {
  const { id: _id, buttonId: _buttonId, surfaceId: _surfaceId, skinOverrideId: _skinId, presentationOverride: _override, ...presentation } = placement;
  return structuredClone(presentation);
}

/** Capture actual authored geometry and literal skins, never transient runtime state. */
export function capturePortableTheme(args: {
  document: ButtonStateDocument;
  target: ThemeTarget;
  name: string;
  descriptors: readonly ThemeToolDescriptor[];
  theme?: FlowCellThemeFile;
  contributions?: Record<string, PortableThemeContribution>;
  id?: string;
  savedAt?: string;
}): PortableTheme {
  const name = args.name.trim();
  if (!name) throw new Error("A theme name is required.");
  const document = args.document;
  const source = structuredClone(args.theme ?? captureThemeFile({ document, target: args.target }));
  if (!themeTargetsMatch(source.target, args.target)) throw new Error("Theme capture target does not match the selected target.");
  const placements = listThemePlacements(document, args.target);
  const selected = new Set(placements.map((placement) => placement.id));
  const buttonMap = new Map<string, string>();
  const placementMap = new Map(placements.map((placement, index) => [placement.id, `placement-${index}`]));
  const surfaceMap = new Map<string, string>();
  const references: PortableTheme["references"] = {};
  const dependencies = new Map<string, PortableThemeDependency>();
  const captureButton = (buttonId: string): string => {
    const found = buttonMap.get(buttonId);
    if (found) return found;
    const button = document.buttons[buttonId];
    if (!button) throw new Error(`Theme Button '${buttonId}' is missing.`);
    const id = `button-${buttonMap.size}`;
    buttonMap.set(buttonId, id);
    const panel = panelReference(button);
    if (panel) references[id] = panel;
    else if (button.metadata.mainPageControl === true && typeof button.metadata.mainPageControlKey === "string" && button.metadata.mainPageControlKey.trim()) {
      references[id] = { kind: "core", actionId: "flowcell.main-control", controlKey: button.metadata.mainPageControlKey };
    }
    else if (button.executionTarget?.kind === "core-action") {
      references[id] = { kind: "core", actionId: button.executionTarget.actionId,
        controlKey: typeof button.metadata.mainPageControlKey === "string" ? button.metadata.mainPageControlKey : "" };
    } else {
      const ownerId = button.toolSetParentId ?? button.id;
      const matches = args.descriptors.filter((entry) => entry.ownerButtonId === ownerId);
      if (matches.length !== 1) throw new Error(`'${button.label}' has ${matches.length} installed source identities; resolve its source before saving a portable theme.`);
      const descriptor = matches[0];
      if (!descriptor.sourceId || !descriptor.sourceVersion || !descriptor.programId) {
        throw new Error(`'${button.label}' has no versioned source identity.`);
      }
      const { ownerButtonId: _ownerId, catalogPath: _catalog, sourcePath: _source, ...stable } = descriptor;
      const key = dependencyIdentity(stable);
      const dependencyId = `source-${portableKey(key)}`;
      const previous = dependencies.get(dependencyId);
      if (previous && dependencyIdentity(previous) !== key) throw new Error("Theme dependency identity collision.");
      dependencies.set(dependencyId, { ...structuredClone(stable), id: dependencyId });
      const slot = button.toolSetParentId ? childSlot(button) : null;
      if (button.toolSetParentId && (!slot || !descriptor.slots.includes(slot))) {
        throw new Error(`'${button.label}' is missing its declared toolset command slot.`);
      }
      references[id] = { kind: "source", dependencyId, slot };
    }
    return id;
  };
  const presentation: PortableTheme["presentation"] = {};
  placements.forEach((placement) => {
    captureButton(placement.buttonId);
    if (!surfaceMap.has(placement.surfaceId)) surfaceMap.set(placement.surfaceId,
      args.target.kind === "flowcell" && getFlowCellThemePageDefinition(args.target.page).buttonSurfaceIds.includes(placement.surfaceId)
        ? placement.surfaceId : `surface-${surfaceMap.size}`);
    presentation[placementMap.get(placement.id)!] = {
      button: buttonPresentation(resolveButtonPlacementPresentation(document.buttons[placement.buttonId], placement)), placement: placementPresentation(placement)
    };
  });
  source.buttons = source.buttons.filter((appearance) => selected.has(appearance.placementId)).map((appearance) => ({
    ...appearance, label: presentation[placementMap.get(appearance.placementId)!].button.label,
    placementId: placementMap.get(appearance.placementId)!,
    buttonId: captureButton(appearance.buttonId), surfaceId: surfaceMap.get(appearance.surfaceId)!,
    sourceIdentity: null, panelOwnerIdentity: null,
    skin: { ...appearance.skin, id: `skin-${portableKey(JSON.stringify(appearance.skin))}`, metadata: {}, compileCache: null },
    assignSkin: true
  }));
  const surfaces: PortableThemeSurface[] = [...surfaceMap].map(([localId, id]) => {
    const surface = document.surfaces[localId];
    const units = Object.values(document.popoutUnits).filter((unit) => unit.surfaceId === localId);
    const fans = Object.values(document.fanSetups).filter((fan) => fan.fanSurfaceId === localId);
    if (units.length > 1 || fans.length > 1) throw new Error(`Surface '${surface.name}' has ambiguous ownership.`);
    const unit = units[0];
    const fan = fans[0];
    const owner = unit?.ownerButtonId ?? fan?.panelOwnerButtonId ?? null;
    const result: PortableThemeSurface = {
      id, name: surface.name, kind: surface.kind, width: surface.width, height: surface.height,
      visualOverflowAllowance: surface.visualOverflowAllowance, uniformButtonSize: structuredClone(surface.uniformButtonSize),
      placementIds: surface.placementIds.filter((key) => selected.has(key)).map((key) => placementMap.get(key)!),
      complete: surface.placementIds.every((key) => selected.has(key)), ownerButtonId: owner ? captureButton(owner) : null
    };
    if (unit) result.popout = {
      kind: unit.kind, canonicalBounds: structuredClone(unit.canonicalBounds), openRule: unit.openRule,
      closeRule: unit.closeRule, interactionMode: unit.interactionMode, transparency: unit.transparency,
      pinnedDefault: unit.pinnedDefault, windowFitMode: unit.windowFitMode,
      ...(unit.closeControlOffset ? { closeControlOffset: structuredClone(unit.closeControlOffset) } : {}),
      ...(unit.kind === "tool-set" ? { fieldGeometry: Object.fromEntries(unit.fields.map((field) =>
        [field.id, { x: field.x, y: field.y, width: field.width, height: field.height, zIndex: field.zIndex }])) } : {})
    };
    if (fan) result.fan = { openRule: fan.openRule, closeRule: fan.closeRule,
      pinnedDefault: fan.pinnedDefault, animation: structuredClone(fan.animation), windowFitMode: fan.windowFitMode,
      selectedToolSetOwnerButtonIds: fan.selectedToolSetOwnerButtonIds.map(captureButton),
      ...(fan.closeControlOffset ? { closeControlOffset: structuredClone(fan.closeControlOffset) } : {}) };
    return result;
  });
  const result: PortableTheme = {
    kind: "FlowCellPortableTheme", version: 1,
    id: args.id ?? `theme-${globalThis.crypto?.randomUUID?.() ?? portableKey(`${name}:${Date.now()}`)}`,
    name, savedAt: args.savedAt ?? new Date().toISOString(), target: structuredClone(args.target),
    theme: source, references, dependencies: [...dependencies.values()], presentation, surfaces,
    contributions: structuredClone(args.contributions ?? {})
  };
  if (args.target.kind === "program") {
    const programName = args.target.programName;
    const settingsKey = Object.keys(document.programPopoutThemes ?? {}).find((key) => equalName(key, programName));
    result.programAppearance = {
      settings: settingsKey ? structuredClone(document.programPopoutThemes![settingsKey]) : null,
      overrides: Object.fromEntries(placements.flatMap((placement) => document.programPopoutColorOverrides?.[placement.id]
        ? [[placementMap.get(placement.id)!, structuredClone(document.programPopoutColorOverrides[placement.id])]] : [])),
      locks: Object.fromEntries(placements.flatMap((placement) => document.programPopoutThemeLocks?.[placement.id]
        ? [[placementMap.get(placement.id)!, structuredClone(document.programPopoutThemeLocks[placement.id])]] : []))
    };
  }
  if (!isPortableTheme(result)) throw new Error("The selected settings cannot be represented as a portable theme.");
  return result;
}

function record(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }

function keysAllowed(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

const PLACEMENT_PRESENTATION_KEYS = ["x", "y", "width", "height", "zIndex", "textFitMode", "textAlignment",
  "textOffsetX", "textOffsetY", "minimumFontSize", "textSizeOverride", "allowLabelResize", "matchHitboxToSkin",
  "allowStretching", "highlightOnHover", "resizeAnchor", "activationCycle", "visualStateMap"];
const POPOUT_PRESENTATION_KEYS = ["kind", "canonicalBounds", "openRule", "closeRule", "interactionMode",
  "transparency", "pinnedDefault", "windowFitMode", "closeControlOffset", "fieldGeometry"];
const FAN_PRESENTATION_KEYS = ["openRule", "closeRule", "pinnedDefault", "animation", "windowFitMode", "closeControlOffset", "selectedToolSetOwnerButtonIds"];

function validOffset(value: unknown): boolean {
  return value === undefined || record(value) && keysAllowed(value, ["x", "y"]) && finite(value.x) && finite(value.y);
}

function validWindowBehavior(value: Record<string, any>): boolean {
  return ["toggle", "click", "hover", "manual"].includes(value.openRule) &&
    ["toggle", "escape", "hover-out", "manual"].includes(value.closeRule) &&
    typeof value.pinnedDefault === "boolean" && validOffset(value.closeControlOffset) &&
    (value.windowFitMode === undefined || ["surface", "hitbox", "visual"].includes(value.windowFitMode));
}

/** Reject incomplete references before any installation or canonical mutation. */
export function isPortableTheme(value: unknown): value is PortableTheme {
  if (!record(value) || value.kind !== "FlowCellPortableTheme" || value.version !== 1 ||
    !nonempty(value.id) || !nonempty(value.name) || !nonempty(value.savedAt) || !Number.isFinite(Date.parse(value.savedAt)) ||
    !isFlowCellThemeFile(value.theme) || !equalValue(value.target, value.theme.target) ||
    !Array.isArray(value.dependencies) || !record(value.references) || !record(value.presentation) ||
    !Array.isArray(value.surfaces) || !record(value.contributions)) return false;
  const dependencies = value.dependencies as unknown[];
  if (!dependencies.every((entry) => record(entry) &&
    [entry.id, entry.programName, entry.programId, entry.panelName, entry.sourceId, entry.sourceVersion, entry.sourceName].every(nonempty) &&
    (entry.importKind === "script" || entry.importKind === "tool-set") && Array.isArray(entry.slots) &&
    entry.slots.every(nonempty) && new Set(entry.slots).size === entry.slots.length &&
    keysAllowed(entry, ["id", "programName", "programId", "panelName", "sourceId", "sourceVersion", "sourceName", "importKind", "slots"]) &&
    (value.target.kind === "program" && equalName(value.target.programName, entry.programName)))) return false;
  const dependencyIds = new Set(value.dependencies.map((entry: PortableThemeDependency) => entry.id));
  if (dependencyIds.size !== value.dependencies.length) return false;
  for (const [referenceId, reference] of Object.entries(value.references)) {
    if (!/^button-\d+$/.test(referenceId)) return false;
    if (!record(reference)) return false;
    if (reference.kind === "source") {
      if (!keysAllowed(reference, ["kind", "dependencyId", "slot"])) return false;
      if (!dependencyIds.has(reference.dependencyId) || !(reference.slot === null || nonempty(reference.slot))) return false;
      const dependency = value.dependencies.find((entry: PortableThemeDependency) => entry.id === reference.dependencyId);
      if (reference.slot !== null && !dependency.slots.includes(reference.slot)) return false;
    } else if (reference.kind === "panel") {
      if (!keysAllowed(reference, ["kind", "programName", "panelName"]) || value.target.kind !== "program" || !equalName(value.target.programName, reference.programName ?? "")) return false;
      if (!nonempty(reference.programName) || !nonempty(reference.panelName)) return false;
    } else if (reference.kind === "core") {
      if (!keysAllowed(reference, ["kind", "actionId", "controlKey"])) return false;
      if (!nonempty(reference.actionId) || typeof reference.controlKey !== "string") return false;
    } else return false;
  }
  const ids = new Set(value.theme.buttons.map((button: FlowCellThemeFile["buttons"][number]) => button.placementId));
  if (Object.keys(value.presentation).length !== ids.size) return false;
  for (const appearance of value.theme.buttons) {
    const stableMainSurface = value.target.kind === "flowcell" && getFlowCellThemePageDefinition(value.target.page).buttonSurfaceIds.includes(appearance.surfaceId);
    if (!/^placement-\d+$/.test(appearance.placementId) || !(/^surface-\d+$/.test(appearance.surfaceId) || stableMainSurface)) return false;
    const presentation = value.presentation[appearance.placementId];
    if (!value.references[appearance.buttonId] || !record(presentation) || !record(presentation.button) || !record(presentation.placement)) return false;
    if (typeof presentation.button.label !== "string" || typeof presentation.button.tooltip !== "string") return false;
    const placement = presentation.placement;
    if (![placement.x, placement.y, placement.width, placement.height, placement.zIndex].every(finite) || placement.width <= 0 || placement.height <= 0) return false;
    if (!keysAllowed(placement, PLACEMENT_PRESENTATION_KEYS) || PLACEMENT_PRESENTATION_KEYS.some((key) => !Object.hasOwn(placement, key))) return false;
    if (Object.keys(presentation.button).some((key) => !["label", "tooltip", "defaultTextFitMode", "activationAnimation", "activationBehavior"].includes(key))) return false;
  }
  const seen = new Set<string>();
  for (const surface of value.surfaces) {
    if (!record(surface) || !nonempty(surface.id) || seen.has(surface.id) || !nonempty(surface.name) ||
      !["main", "panel", "regular-popout", "tool-set-popout", "fan"].includes(surface.kind) ||
      ![surface.width, surface.height, surface.visualOverflowAllowance].every(finite) || surface.width <= 0 || surface.height <= 0 ||
      typeof surface.complete !== "boolean" || !Array.isArray(surface.placementIds) ||
      surface.placementIds.some((id: unknown) => !ids.has(id as string)) ||
      new Set(surface.placementIds).size !== surface.placementIds.length ||
      !(surface.ownerButtonId === null || value.references[surface.ownerButtonId])) return false;
    if (!keysAllowed(surface, ["id", "name", "kind", "width", "height", "visualOverflowAllowance", "uniformButtonSize", "placementIds", "complete", "ownerButtonId", "popout", "fan"])) return false;
    if (surface.popout !== undefined) {
      const popout = surface.popout;
      if (!record(popout) || !keysAllowed(popout, POPOUT_PRESENTATION_KEYS) || !validWindowBehavior(popout) ||
        !["regular", "tool-set"].includes(popout.kind) || !finite(popout.transparency) || popout.transparency < 0 || popout.transparency > 1 ||
        !record(popout.canonicalBounds) || !keysAllowed(popout.canonicalBounds, ["x", "y", "width", "height"]) ||
        !Object.values(popout.canonicalBounds).every(finite) || popout.canonicalBounds.width <= 0 || popout.canonicalBounds.height <= 0 ||
        !(popout.interactionMode === undefined || ["pop", "fan"].includes(popout.interactionMode))) return false;
      if (popout.fieldGeometry !== undefined && (!record(popout.fieldGeometry) || !Object.values(popout.fieldGeometry).every((entry) =>
        record(entry) && keysAllowed(entry, ["x", "y", "width", "height", "zIndex"]) &&
        [entry.x, entry.y, entry.width, entry.height, entry.zIndex].every(finite) && entry.width > 0 && entry.height > 0))) return false;
    }
    if (surface.fan !== undefined && (!record(surface.fan) || !keysAllowed(surface.fan, FAN_PRESENTATION_KEYS) ||
      !Array.isArray(surface.fan.selectedToolSetOwnerButtonIds) || surface.fan.selectedToolSetOwnerButtonIds.some((id: string) => !value.references[id]) ||
      !validWindowBehavior(surface.fan) || !record(surface.fan.animation) ||
      !keysAllowed(surface.fan.animation, ["durationMs", "easing", "staggerMs", "spinEnabled"]) ||
      !finite(surface.fan.animation.durationMs) || surface.fan.animation.durationMs < 0 ||
      !finite(surface.fan.animation.staggerMs) || surface.fan.animation.staggerMs < 0 ||
      !nonempty(surface.fan.animation.easing) || typeof surface.fan.animation.spinEnabled !== "boolean")) return false;
    seen.add(surface.id);
  }
  if (value.theme.buttons.some((button: FlowCellThemeFile["buttons"][number]) => !seen.has(button.surfaceId))) return false;
  if (!Object.values(value.contributions).every((entry) => record(entry) && entry.version === 1 && nonempty(entry.sourceId) &&
    record(entry.state) && Array.isArray(entry.assetFields) && entry.assetFields.every(nonempty))) return false;
  if (value.programAppearance !== undefined) {
    const appearance = value.programAppearance;
    if (value.target.kind !== "program" || !record(appearance) || !keysAllowed(appearance, ["settings", "overrides", "locks"]) ||
      !(appearance.settings === null || normalizeProgramPopoutThemeSettings(appearance.settings)) ||
      !record(appearance.overrides) || !record(appearance.locks) ||
      Object.entries(appearance.overrides).some(([key, entry]) => !ids.has(key) || !normalizeProgramPopoutColorOverride(entry)) ||
      Object.entries(appearance.locks).some(([key, entry]) => !ids.has(key) || !normalizeProgramPopoutThemeLock(entry))) return false;
  }
  // Reuse the authoritative Button validator for state cycles, labels, animation,
  // text policy, and literal skins before an installer is allowed to run.
  const validationDocument = createButtonStateDocument();
  for (const surface of value.surfaces) validationDocument.surfaces[surface.id] = {
    id: surface.id, name: surface.name, kind: surface.kind, width: surface.width, height: surface.height,
    visualOverflowAllowance: surface.visualOverflowAllowance, uniformButtonSize: surface.uniformButtonSize,
    placementIds: []
  };
  for (const appearance of value.theme.buttons) {
    const presentation = value.presentation[appearance.placementId];
    validationDocument.skins[appearance.skin.id] = structuredClone(appearance.skin);
    validationDocument.buttons[appearance.buttonId] = {
      id: appearance.buttonId, role: "single-script", sourceIdentity: null,
      executionTarget: { kind: "core-action", actionId: "theme-validation" }, defaultSkinId: appearance.skin.id,
      disabled: false, toolSetParentId: null, toolSetBehavior: null, metadata: {}, ...structuredClone(presentation.button)
    };
    validationDocument.placements[appearance.placementId] = {
      ...structuredClone(presentation.placement), id: appearance.placementId,
      buttonId: appearance.buttonId, surfaceId: appearance.surfaceId, skinOverrideId: appearance.skin.id,
      presentationOverride: structuredClone(presentation.button)
    };
    validationDocument.surfaces[appearance.surfaceId].placementIds.push(appearance.placementId);
  }
  return validateButtonStateDocument(validationDocument).valid;
}

function referenceMatches(button: ButtonRecord, reference: Exclude<PortableButtonReference, { kind: "source" }>): boolean {
  if (reference.kind === "panel") {
    const panel = panelReference(button);
    return panel?.kind === "panel" && equalName(panel.programName, reference.programName) && equalName(panel.panelName, reference.panelName);
  }
  if (reference.actionId === "flowcell.main-control") {
    return button.metadata.mainPageControl === true && button.metadata.mainPageControlKey === reference.controlKey;
  }
  return button.executionTarget?.kind === "core-action" && button.executionTarget.actionId === reference.actionId &&
    (reference.controlKey ? button.metadata.mainPageControlKey === reference.controlKey : true);
}

export function planPortableThemeImport(
  document: ButtonStateDocument,
  theme: PortableTheme,
  selectedTarget: ThemeTarget,
  descriptors: readonly ThemeToolDescriptor[]
): PortableThemeImportPlan {
  if (!isPortableTheme(theme)) throw new Error("The selected archive is not a supported complete FlowCell theme.");
  const plan: PortableThemeImportPlan = { revision: document.revision, themeId: theme.id,
    selectedTarget: structuredClone(selectedTarget), issues: [], missingDependencies: [],
    dependencyOwners: {}, buttonIds: {}, placementIds: {}, surfaceIds: {} };
  if (!themeTargetsMatch(theme.target, selectedTarget)) {
    plan.issues.push("This theme belongs to a different target. Select its target before opening it.");
    return plan;
  }
  theme = portableThemeForScope(theme, selectedTarget);
  for (const dependency of theme.dependencies) {
    const candidates = descriptors.filter((entry) => document.buttons[entry.ownerButtonId] &&
      equalName(entry.programId, dependency.programId) && entry.sourceId === dependency.sourceId);
    const compatible = candidates.filter((entry) => entry.sourceVersion === dependency.sourceVersion &&
      entry.importKind === dependency.importKind && dependency.slots.every((slot) => entry.slots.includes(slot)));
    if (compatible.length === 1) plan.dependencyOwners[dependency.id] = compatible[0].ownerButtonId;
    else if (compatible.length > 1) plan.issues.push(`'${dependency.sourceName}' matches ${compatible.length} installed owners. Choose the intended owner before importing.`);
    else if (candidates.length > 0) plan.issues.push(`'${dependency.sourceName}' requires version ${dependency.sourceVersion}; installed versions: ${candidates.map((entry) => entry.sourceVersion).join(", ")}.`);
    else plan.missingDependencies.push(structuredClone(dependency));
  }
  for (const [id, reference] of Object.entries(theme.references)) {
    let matches: ButtonRecord[];
    if (reference.kind === "source") {
      const ownerId = plan.dependencyOwners[reference.dependencyId];
      if (!ownerId) continue;
      matches = reference.slot === null ? [document.buttons[ownerId]] : Object.values(document.buttons).filter((button) =>
        button.toolSetParentId === ownerId && childSlot(button) === reference.slot);
    } else matches = Object.values(document.buttons).filter((button) => referenceMatches(button, reference));
    if (matches.some((button) => button.metadata.themeContributionOnly === true)) {
      // Older themes include this page's former Button. Its installed owner remains
      // available to the embedded editor, but its old presentation is ignored.
      continue;
    }
    if (matches.length === 1) plan.buttonIds[id] = matches[0].id;
    else plan.issues.push(`Theme control '${id}' has ${matches.length} compatible identities.`);
  }
  for (const surface of theme.surfaces) {
    const appearances = theme.theme.buttons.filter((button) => button.surfaceId === surface.id);
    const ownerId = surface.ownerButtonId ? plan.buttonIds[surface.ownerButtonId] : null;
    const ownerSurfaces = surface.kind === "fan"
      ? Object.values(document.fanSetups).filter((fan) => ownerId && fan.panelOwnerButtonId === ownerId).map((fan) => fan.fanSurfaceId)
      : Object.values(document.popoutUnits).filter((unit) => ownerId && unit.ownerButtonId === ownerId).map((unit) => unit.surfaceId);
    let candidates = Object.values(document.surfaces).filter((candidate) => candidate.kind === surface.kind &&
      (!ownerId || ownerSurfaces.includes(candidate.id)) && appearances.every((appearance) => {
        const buttonId = plan.buttonIds[appearance.buttonId];
        return !buttonId || candidate.placementIds.some((key) => document.placements[key]?.buttonId === buttonId);
      }));
    if (surface.fan && candidates.length > 1) {
      const selectedOwners = surface.fan.selectedToolSetOwnerButtonIds.map((id) => plan.buttonIds[id]).filter(Boolean).sort();
      const exact = candidates.filter((candidate) => Object.values(document.fanSetups).some((fan) =>
        fan.fanSurfaceId === candidate.id && equalValue([...fan.selectedToolSetOwnerButtonIds].sort(), selectedOwners)));
      if (exact.length === 1) candidates = exact;
    }
    if (candidates.length > 1) {
      const named = candidates.filter((candidate) => equalName(candidate.name, surface.name));
      if (named.length === 1) candidates = named;
    }
    if (candidates.length !== 1) {
      if (appearances.every((appearance) => plan.buttonIds[appearance.buttonId])) {
        plan.issues.push(`Arrangement '${surface.name}' has ${candidates.length} compatible surfaces.`);
      }
      continue;
    }
    plan.surfaceIds[surface.id] = candidates[0].id;
    for (const appearance of appearances) {
      const buttonId = plan.buttonIds[appearance.buttonId];
      if (!buttonId) continue;
      const matches = candidates[0].placementIds.map((key) => document.placements[key]).filter((placement) =>
        placement?.buttonId === buttonId && placementMatchesThemeTarget(document, placement, selectedTarget));
      if (matches.length === 1) plan.placementIds[appearance.placementId] = matches[0].id;
      else if (matches.length > 1) plan.issues.push(`'${appearance.label}' has ${matches.length} occurrences in '${surface.name}'.`);
      // A narrower selected scope deliberately excludes out-of-scope occurrences.
    }
  }
  return plan;
}

/** Pure application: callers commit once after dependencies/assets/contributions pass preflight. */
export function applyPortableTheme(document: ButtonStateDocument, theme: PortableTheme, plan: PortableThemeImportPlan): ButtonStateDocument {
  if (!isPortableTheme(theme) || plan.themeId !== theme.id || plan.revision !== document.revision) {
    throw new Error("Theme preview is stale. Preview again before applying.");
  }
  if (plan.issues.length || plan.missingDependencies.length) {
    throw new Error([...plan.issues, ...plan.missingDependencies.map((dependency) => `Missing tool: ${dependency.sourceName} (${dependency.sourceVersion}).`)].join("\n"));
  }
  const remapped: FlowCellThemeFile = { ...structuredClone(theme.theme), target: structuredClone(plan.selectedTarget), buttons: [] };
  for (const appearance of theme.theme.buttons) {
    const placementId = plan.placementIds[appearance.placementId];
    if (!placementId) continue;
    const placement = document.placements[placementId];
    if (!placement || !placementMatchesThemeTarget(document, placement, plan.selectedTarget)) throw new Error("Theme mapping escaped the selected scope.");
    const button = document.buttons[placement.buttonId];
    const surface = document.surfaces[placement.surfaceId];
    remapped.buttons.push({ ...structuredClone(appearance), placementId, buttonId: button.id,
      surfaceId: surface.id, surfaceName: surface.name, sourceIdentity: button.sourceIdentity,
      panelOwnerIdentity: null, assignSkin: true,
      width: placement.width, height: placement.height,
      label: resolveButtonPlacementPresentation(button, placement).label });
  }
  const next = applyThemeFile(document, remapped).document;
  const mappedPlacements = new Set(Object.values(plan.placementIds));
  for (const [savedId, localId] of Object.entries(plan.placementIds)) {
    const appearance = theme.presentation[savedId];
    const placement = next.placements[localId];
    const button = next.buttons[placement.buttonId];
    const outside = Object.values(document.placements).some((candidate) => candidate.buttonId === button.id && !mappedPlacements.has(candidate.id));
    Object.assign(placement, structuredClone(appearance.placement));
    if (outside || placement.presentationOverride) placement.presentationOverride = structuredClone(appearance.button);
    else Object.assign(button, structuredClone(appearance.button));
  }
  for (const saved of theme.surfaces) {
    const localId = plan.surfaceIds[saved.id];
    const surface = next.surfaces[localId];
    if (!surface) continue;
    const ordered = saved.placementIds.flatMap((id) => plan.placementIds[id] ? [plan.placementIds[id]] : []);
    const allScoped = surface.placementIds.every((id) => mappedPlacements.has(id));
    if (saved.complete && allScoped) {
      surface.width = saved.width; surface.height = saved.height;
      surface.uniformButtonSize = structuredClone(saved.uniformButtonSize);
      surface.visualOverflowAllowance = saved.visualOverflowAllowance;
      surface.placementIds = ordered;
    } else {
      let index = 0;
      surface.placementIds = surface.placementIds.map((id) => ordered.includes(id) ? ordered[index++] : id);
    }
    const units = Object.values(next.popoutUnits).filter((unit) => unit.surfaceId === localId);
    if (saved.popout && units.length === 1 && allScoped) {
      const { fieldGeometry, ...appearance } = saved.popout;
      const unit = units[0];
      if (appearance.kind !== unit.kind) throw new Error(`Arrangement '${saved.name}' changed kind.`);
      Object.assign(unit, structuredClone(appearance));
      if (unit.kind === "tool-set" && fieldGeometry) unit.fields = unit.fields.map((field) =>
        fieldGeometry[field.id] ? { ...field, ...structuredClone(fieldGeometry[field.id]) } : field);
    }
    const fans = Object.values(next.fanSetups).filter((fan) => fan.fanSurfaceId === localId);
    if (saved.fan && fans.length === 1 && allScoped) Object.assign(fans[0], structuredClone(saved.fan), {
      selectedToolSetOwnerButtonIds: saved.fan.selectedToolSetOwnerButtonIds.map((id) => plan.buttonIds[id])
    });
  }
  if (theme.programAppearance && plan.selectedTarget.kind === "program") {
    const programName = plan.selectedTarget.programName;
    const key = Object.keys(next.programPopoutThemes ?? {}).find((entry) => equalName(entry, programName)) ?? programName.toLowerCase();
    const previousSettings = structuredClone(next.programPopoutThemes);
    next.programPopoutThemes ??= {};
    if (theme.programAppearance.settings) next.programPopoutThemes[key] = structuredClone(theme.programAppearance.settings);
    else delete next.programPopoutThemes[key];
    next.programPopoutColorOverrides ??= {};
    next.programPopoutThemeLocks ??= {};
    for (const [savedId, localId] of Object.entries(plan.placementIds)) {
      const override = theme.programAppearance.overrides[savedId];
      const lock = theme.programAppearance.locks[savedId];
      if (override) next.programPopoutColorOverrides[localId] = structuredClone(override);
      else delete next.programPopoutColorOverrides[localId];
      if (lock) next.programPopoutThemeLocks[localId] = structuredClone(lock);
      else delete next.programPopoutThemeLocks[localId];
    }
    if (plan.selectedTarget.panelName !== null) {
      // A selected panel receives the effective appearance without changing the
      // program-wide source used by other panels or their future pop-outs.
      for (const localId of Object.values(plan.placementIds)) {
        const placement = next.placements[localId];
        if (!["regular-popout", "tool-set-popout", "fan"].includes(next.surfaces[placement.surfaceId]?.kind)) continue;
        const resolved = resolveProgramPopoutThemeOverride(next, localId);
        if (resolved) next.programPopoutThemeLocks[localId] = structuredClone(resolved);
      }
      if (previousSettings) next.programPopoutThemes = previousSettings;
      else delete next.programPopoutThemes;
    }
  }
  next.revision = document.revision;
  const validation = validateButtonStateDocument(next);
  if (!validation.valid) throw new Error(`Theme presentation is invalid: ${validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  return next;
}
