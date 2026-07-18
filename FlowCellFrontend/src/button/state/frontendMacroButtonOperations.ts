import type {
  ButtonPlacement,
  ButtonRecord,
  ButtonSourceIdentity,
  ButtonStateDocument,
  ButtonSurface
} from "../types.js";
import { findFirstAvailableButtonPosition } from "../geometry/buttonGeometry.js";
import { removeOwnedButtonGraph } from "./buttonDocumentOperations.js";
import { createButtonSourceIdentity } from "./sourceIdentity.js";

export const FRONTEND_MACRO_CORE_ACTION_ID = "run-frontend-macro";

export interface CanonicalFrontendMacroDescriptor {
  id: string;
  label: string;
  programName: string;
  panelName: string;
}

export interface AttachCanonicalFrontendMacroButtonResult {
  buttonId: string;
  placementId: string;
  surfaceId: string;
  changed: boolean;
}

export interface RemoveCanonicalFrontendMacroButtonsResult {
  removedButtonIds: string[];
  uninstallOwnerButtonIds: string[];
  changed: boolean;
}

function stableDocumentIdSegment(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  return Array.from(normalized)
    .map((character) => character.codePointAt(0)?.toString(16) ?? "0")
    .join("-") || "item";
}

function macroFileName(macroId: string): string {
  return `macro:${macroId}`;
}

function macroButtonId(macroId: string): string {
  return `button-macro-${stableDocumentIdSegment(macroId)}`;
}

function macroPlacementId(macroId: string): string {
  return `placement-macro-${stableDocumentIdSegment(macroId)}`;
}

function panelSurfaceId(identity: ButtonSourceIdentity): string {
  return `surface-panel-${stableDocumentIdSegment(identity.displayProgramName)}-${stableDocumentIdSegment(identity.displayPanelName)}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isMacroSourceIdentity(identity: ButtonSourceIdentity | null, macroId: string): boolean {
  if (!identity) return false;
  const expected = createButtonSourceIdentity(
    identity.displayProgramName,
    identity.displayPanelName,
    macroFileName(macroId)
  );
  return identity.normalizedFileName === expected.normalizedFileName;
}

export function isCanonicalFrontendMacroButton(
  button: ButtonRecord,
  macroId: string
): boolean {
  const target = button.executionTarget;
  const targetMacroId = target?.kind === "core-action" &&
    target.actionId === FRONTEND_MACRO_CORE_ACTION_ID &&
    typeof target.payload?.macroId === "string"
      ? target.payload.macroId
      : "";
  return button.role === "single-script" &&
    (isMacroSourceIdentity(button.sourceIdentity, macroId) || targetMacroId === macroId);
}

function ensurePanelSurface(
  document: ButtonStateDocument,
  identity: ButtonSourceIdentity
): { surface: ButtonSurface; changed: boolean } {
  const id = panelSurfaceId(identity);
  const existing = document.surfaces[id];
  if (existing) {
    if (existing.kind !== "panel") {
      throw new Error(`Canonical macro panel surface '${id}' is not a panel surface.`);
    }
    return { surface: existing, changed: false };
  }
  const surface: ButtonSurface = {
    id,
    name: `${identity.displayProgramName} / ${identity.displayPanelName}`,
    kind: "panel",
    width: 960,
    height: 640,
    placementIds: [],
    visualOverflowAllowance: 24
  };
  document.surfaces[id] = surface;
  return { surface, changed: true };
}

function nextMacroPlacementRect(
  document: ButtonStateDocument,
  surface: ButtonSurface
) {
  const width = 160;
  const height = 44;
  const padding = document.settings.defaultSurfacePadding;
  const gap = document.settings.defaultGap;
  surface.width = Math.max(surface.width, width + padding * 2);
  const otherRects = surface.placementIds
    .map((id) => document.placements[id])
    .filter((placement): placement is ButtonPlacement => Boolean(placement));
  let rect = findFirstAvailableButtonPosition({
    width,
    height,
    surface,
    otherRects,
    padding,
    gap,
    gridSize: document.settings.gridSize
  });
  if (!rect) {
    surface.height += height + gap;
    rect = findFirstAvailableButtonPosition({
      width,
      height,
      surface,
      otherRects,
      padding,
      gap,
      gridSize: document.settings.gridSize
    });
  }
  if (!rect) throw new Error("Canonical macro panel surface has no room for another Button.");
  return rect;
}

function ensurePrimaryPlacement(args: {
  document: ButtonStateDocument;
  button: ButtonRecord;
  surface: ButtonSurface;
  macroId: string;
}): { placement: ButtonPlacement; changed: boolean } {
  const existing = args.surface.placementIds
    .map((id) => args.document.placements[id])
    .find((placement) => placement?.buttonId === args.button.id);
  if (existing) return { placement: existing, changed: false };

  const id = macroPlacementId(args.macroId);
  const stablePlacement = args.document.placements[id];
  if (stablePlacement && stablePlacement.buttonId !== args.button.id) {
    throw new Error(`Canonical macro placement '${id}' belongs to another Button.`);
  }
  const movablePlacement = stablePlacement ?? Object.values(args.document.placements).find((placement) =>
    placement.buttonId === args.button.id &&
    ["main", "panel"].includes(args.document.surfaces[placement.surfaceId]?.kind ?? "")
  );
  const rect = nextMacroPlacementRect(args.document, args.surface);
  if (movablePlacement) {
    const oldSurface = args.document.surfaces[movablePlacement.surfaceId];
    if (oldSurface) oldSurface.placementIds = oldSurface.placementIds.filter((placementId) => placementId !== movablePlacement.id);
    Object.assign(movablePlacement, {
      surfaceId: args.surface.id,
      ...rect,
      zIndex: args.surface.placementIds.length
    });
    args.surface.placementIds.push(movablePlacement.id);
    return { placement: movablePlacement, changed: true };
  }
  const placement: ButtonPlacement = {
    id,
    buttonId: args.button.id,
    surfaceId: args.surface.id,
    ...rect,
    zIndex: args.surface.placementIds.length,
    skinOverrideId: null,
    textFitMode: args.button.defaultTextFitMode,
    minimumFontSize: args.document.settings.defaultMinimumFontSize,
    textSizeOverride: null,
    allowLabelResize: false,
    matchHitboxToSkin: true,
    allowStretching: false,
    resizeAnchor: "top-left"
  };
  args.document.placements[id] = placement;
  args.surface.placementIds.push(id);
  return { placement, changed: true };
}

export function attachCanonicalFrontendMacroButton(
  document: ButtonStateDocument,
  descriptor: CanonicalFrontendMacroDescriptor
): AttachCanonicalFrontendMacroButtonResult {
  const macroId = descriptor.id.trim();
  const programName = descriptor.programName.trim();
  const panelName = descriptor.panelName.trim();
  const label = descriptor.label.trim();
  if (!macroId) throw new Error("Canonical macro Button requires a macro ID.");
  if (!programName || !panelName) throw new Error("Canonical macro Button requires a program and panel.");
  if (!label) throw new Error("Canonical macro Button requires a label.");

  const identity = createButtonSourceIdentity(programName, panelName, macroFileName(macroId));
  const stableId = macroButtonId(macroId);
  const matches = Object.values(document.buttons).filter((button) =>
    isCanonicalFrontendMacroButton(button, macroId)
  );
  let button = document.buttons[stableId];
  if (button && !isCanonicalFrontendMacroButton(button, macroId)) {
    button = matches[0];
    if (!button) throw new Error(`Canonical macro Button ID '${stableId}' is already in use.`);
  } else if (!button) {
    button = matches[0];
  }

  let changed = false;
  if (!button) {
    button = {
      id: stableId,
      role: "single-script",
      sourceIdentity: identity,
      label,
      tooltip: `Run the saved '${label}' macro.`,
      executionTarget: {
        kind: "core-action",
        actionId: FRONTEND_MACRO_CORE_ACTION_ID,
        payload: { macroId }
      },
      defaultSkinId: document.settings.defaultSkinId,
      defaultTextFitMode: "shrink",
      disabled: false,
      activationAnimation: null,
      toolSetParentId: null,
      toolSetBehavior: null,
      metadata: { sourceKind: "frontend-macro", macroId }
    };
    document.buttons[button.id] = button;
    changed = true;
  } else {
    const next: ButtonRecord = {
      ...button,
      role: "single-script",
      sourceIdentity: identity,
      executionTarget: {
        kind: "core-action",
        actionId: FRONTEND_MACRO_CORE_ACTION_ID,
        payload: { macroId }
      },
      toolSetParentId: null,
      toolSetBehavior: null,
      metadata: { ...button.metadata, sourceKind: "frontend-macro", macroId }
    };
    if (!sameJson(button, next)) {
      document.buttons[button.id] = next;
      button = next;
      changed = true;
    }
  }

  const ensuredSurface = ensurePanelSurface(document, identity);
  const ensuredPlacement = ensurePrimaryPlacement({
    document,
    button,
    surface: ensuredSurface.surface,
    macroId
  });
  return {
    buttonId: button.id,
    placementId: ensuredPlacement.placement.id,
    surfaceId: ensuredSurface.surface.id,
    changed: changed || ensuredSurface.changed || ensuredPlacement.changed
  };
}

export function removeCanonicalFrontendMacroButtonGraphs(
  document: ButtonStateDocument,
  macroIdValue: string
): RemoveCanonicalFrontendMacroButtonsResult {
  const macroId = macroIdValue.trim();
  if (!macroId) throw new Error("Canonical macro Button removal requires a macro ID.");
  const roots = Object.values(document.buttons)
    .filter((button) => isCanonicalFrontendMacroButton(button, macroId))
    .map((button) => button.id);
  const removedButtonIds = new Set<string>();
  const uninstallOwnerButtonIds = new Set<string>();
  const affectedPanelSurfaceIds = new Set<string>();
  roots.forEach((buttonId) => {
    Object.values(document.placements).forEach((placement) => {
      if (placement.buttonId === buttonId && document.surfaces[placement.surfaceId]?.kind === "panel") {
        affectedPanelSurfaceIds.add(placement.surfaceId);
      }
    });
    const result = removeOwnedButtonGraph(document, buttonId);
    result.removedButtonIds.forEach((id) => removedButtonIds.add(id));
    result.uninstallOwnerButtonIds.forEach((id) => uninstallOwnerButtonIds.add(id));
  });
  affectedPanelSurfaceIds.forEach((surfaceId) => {
    const surface = document.surfaces[surfaceId];
    if (surface?.kind === "panel" && surface.placementIds.length === 0) delete document.surfaces[surfaceId];
  });
  return {
    removedButtonIds: [...removedButtonIds],
    uninstallOwnerButtonIds: [...uninstallOwnerButtonIds],
    changed: roots.length > 0
  };
}
