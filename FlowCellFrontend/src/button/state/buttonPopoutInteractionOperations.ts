import type {
  ButtonPlacement,
  ButtonPopoutUnit,
  ButtonRect,
  ButtonStateDocument
} from "../types.js";
import { cloneButtonDocument, createStableButtonId } from "./buttonDefaults.js";
import {
  findPanelOwnerButton,
  resolvePanelOwnerMainPlacement
} from "./panelOwnerButtonOperations.js";

export interface SetButtonPopoutFanModeArgs {
  document: ButtonStateDocument;
  surfaceId: string;
  enabled: boolean;
  programName: string;
  panelName: string;
}

export interface SetButtonPopoutFanModeResult {
  unitId: string;
  ownerPlacementId: string | null;
  createdOwnerPlacement: boolean;
}

const MINIMUM_FAN_EDITOR_WIDTH = 960;
const MINIMUM_FAN_EDITOR_HEIGHT = 640;

function popoutUnitForSurface(
  document: ButtonStateDocument,
  surfaceId: string
): ButtonPopoutUnit {
  const units = Object.values(document.popoutUnits).filter(
    (candidate) => candidate.surfaceId === surfaceId
  );
  if (units.length !== 1) {
    throw new Error(
      units.length === 0
        ? "The selected surface is not owned by a Pop-out."
        : "The selected Pop-out surface has more than one owner."
    );
  }
  return units[0];
}

function popoutContentPlacementIds(unit: ButtonPopoutUnit): string[] {
  return unit.kind === "tool-set"
    ? [...unit.childPlacementIds]
    : [...unit.memberPlacementIds];
}

function placementRect(placement: ButtonPlacement): ButtonRect {
  return {
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height
  };
}

function unionRects(rects: readonly ButtonRect[]): ButtonRect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function contentRects(
  document: ButtonStateDocument,
  unit: ButtonPopoutUnit
): ButtonRect[] {
  const placements = popoutContentPlacementIds(unit).flatMap((placementId) => {
    const placement = document.placements[placementId];
    return placement ? [placementRect(placement)] : [];
  });
  if (unit.kind !== "tool-set") return placements;
  return [
    ...placements,
    ...unit.fields.map((field) => ({
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height
    }))
  ];
}

function sourceOwnerPlacement(
  document: ButtonStateDocument,
  unit: ButtonPopoutUnit,
  programName: string,
  panelName: string
): { buttonId: string; placement: ButtonPlacement } {
  if (unit.kind === "regular") {
    const owner = findPanelOwnerButton(document, programName, panelName);
    if (!owner) {
      throw new Error(
        `The '${programName} / ${panelName}' panel owner Button is missing. Reopen the Button Editor so FlowCell can reconcile it.`
      );
    }
    const placement = resolvePanelOwnerMainPlacement(document, programName, panelName) ??
      Object.values(document.placements).find((candidate) =>
        candidate.buttonId === owner.id &&
        candidate.surfaceId !== unit.surfaceId &&
        ["main", "panel"].includes(document.surfaces[candidate.surfaceId]?.kind ?? "")
      );
    if (!placement) {
      throw new Error(`Panel owner '${owner.label}' has no editable Main placement to copy.`);
    }
    return { buttonId: owner.id, placement };
  }

  const candidates = Object.values(document.placements)
    .filter((candidate) =>
      candidate.buttonId === unit.ownerButtonId &&
      candidate.surfaceId !== unit.surfaceId &&
      ["main", "panel"].includes(document.surfaces[candidate.surfaceId]?.kind ?? "")
    )
    .sort((left, right) => {
      const leftSurface = document.surfaces[left.surfaceId];
      const rightSurface = document.surfaces[right.surfaceId];
      return (leftSurface?.kind === "panel" ? 0 : 1) -
        (rightSurface?.kind === "panel" ? 0 : 1) ||
        left.zIndex - right.zIndex ||
        left.id.localeCompare(right.id);
    });
  const placement = candidates[0];
  if (!placement) {
    throw new Error(`Tool Set owner '${document.buttons[unit.ownerButtonId]?.label ?? unit.ownerButtonId}' has no Main placement to copy.`);
  }
  return { buttonId: unit.ownerButtonId, placement };
}

function resolveSavedOwnerPlacement(
  document: ButtonStateDocument,
  unit: ButtonPopoutUnit
): ButtonPlacement | null {
  const ownerPlacementId = unit.ownerPlacementId?.trim();
  if (!ownerPlacementId) return null;
  const placement = document.placements[ownerPlacementId];
  const ownerButtonId = unit.kind === "tool-set"
    ? unit.ownerButtonId
    : unit.ownerButtonId?.trim();
  return placement && ownerButtonId &&
    placement.surfaceId === unit.surfaceId &&
    placement.buttonId === ownerButtonId
    ? placement
    : null;
}

function updatePopoutEnvelope(
  document: ButtonStateDocument,
  unit: ButtonPopoutUnit,
  ownerPlacement: ButtonPlacement | null,
  includeOwner: boolean
): void {
  const surface = document.surfaces[unit.surfaceId];
  if (!surface) throw new Error("The selected Pop-out surface no longer exists.");
  const envelope = unionRects([
    ...contentRects(document, unit),
    ...(includeOwner && ownerPlacement ? [placementRect(ownerPlacement)] : [])
  ]) ?? { x: 0, y: 0, width: surface.width, height: surface.height };
  unit.canonicalBounds = { x: 0, y: 0, width: surface.width, height: surface.height };
  unit.windowFitMode = "hitbox";
  unit.desktopBoundsFitMode = "hitbox";
  unit.desktopBoundsEnvelope = envelope;
}

export function setButtonPopoutFanMode(
  args: SetButtonPopoutFanModeArgs
): SetButtonPopoutFanModeResult {
  const { document, enabled, programName, panelName } = args;
  const unit = popoutUnitForSurface(document, args.surfaceId);
  const surface = document.surfaces[unit.surfaceId];
  if (!surface) throw new Error("The selected Pop-out surface no longer exists.");

  let ownerPlacement = resolveSavedOwnerPlacement(document, unit);
  let createdOwnerPlacement = false;
  if (enabled && !ownerPlacement) {
    const source = sourceOwnerPlacement(document, unit, programName, panelName);
    const padding = Math.max(16, document.settings.defaultSurfacePadding);
    const contentBounds = unionRects(contentRects(document, unit)) ?? {
      x: padding,
      y: padding,
      width: 0,
      height: 0
    };
    const desiredX = contentBounds.x + contentBounds.width + padding;
    const desiredY = Math.max(0, contentBounds.y);
    surface.width = Math.max(
      surface.width,
      MINIMUM_FAN_EDITOR_WIDTH,
      contentBounds.width * 3 + padding * 2,
      desiredX + source.placement.width + padding
    );
    surface.height = Math.max(
      surface.height,
      MINIMUM_FAN_EDITOR_HEIGHT,
      contentBounds.height * 3 + padding * 2,
      desiredY + source.placement.height + padding
    );
    const ownerPlacementId = createStableButtonId("placement-popout-owner");
    ownerPlacement = {
      ...cloneButtonDocument(source.placement),
      id: ownerPlacementId,
      buttonId: source.buttonId,
      surfaceId: surface.id,
      x: desiredX,
      y: desiredY,
      zIndex: Math.max(
        -1,
        ...surface.placementIds.map((placementId) => document.placements[placementId]?.zIndex ?? -1)
      ) + 1
    };
    document.placements[ownerPlacementId] = ownerPlacement;
    surface.placementIds.push(ownerPlacementId);
    unit.ownerPlacementId = ownerPlacementId;
    if (unit.kind === "regular") unit.ownerButtonId = source.buttonId;
    createdOwnerPlacement = true;
  }

  if (enabled && ownerPlacement) {
    const padding = Math.max(16, document.settings.defaultSurfacePadding);
    const contentBounds = unionRects(contentRects(document, unit));
    surface.width = Math.max(
      surface.width,
      MINIMUM_FAN_EDITOR_WIDTH,
      (contentBounds?.width ?? 0) * 3 + padding * 2,
      ownerPlacement.x + ownerPlacement.width + padding
    );
    surface.height = Math.max(
      surface.height,
      MINIMUM_FAN_EDITOR_HEIGHT,
      (contentBounds?.height ?? 0) * 3 + padding * 2,
      ownerPlacement.y + ownerPlacement.height + padding
    );
  }

  unit.interactionMode = enabled ? "fan" : "pop";
  unit.openRule = enabled ? "hover" : "toggle";
  unit.closeRule = enabled
    ? "hover-out"
    : unit.kind === "tool-set"
      ? "toggle"
      : "escape";
  unit.pinnedDefault = false;
  updatePopoutEnvelope(document, unit, ownerPlacement, enabled);
  return {
    unitId: unit.id,
    ownerPlacementId: ownerPlacement?.id ?? null,
    createdOwnerPlacement
  };
}
