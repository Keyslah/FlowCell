import type { ButtonPlacement, ButtonRecord, ButtonStateDocument, RegularButtonPopoutUnit } from "../types.js";
import { buttonRectsOverlap, buttonSpacingPixelsFromMillimeters } from "../geometry/buttonGeometry.js";
import { cloneButtonDocument, createStableButtonId } from "./buttonDefaults.js";
import { deriveRegularPopoutSelectionKey } from "./sourceIdentity.js";
import type { LayoutSnapshotWindow } from "../../types.js";

export function panelKey(button: ButtonRecord): string | null {
  const identity = button?.sourceIdentity;
  return button?.role === "single-script" && identity
    ? JSON.stringify([identity.normalizedProgramName, identity.normalizedPanelName])
    : null;
}

/** Fill an available row slot, then extend downward; never rearrange authored placements. */
function appendPlacement(document: ButtonStateDocument, surfaceId: string, memberIds: string[], button: ButtonRecord): ButtonPlacement {
  const surface = document.surfaces[surfaceId];
  const members = memberIds.map((id) => document.placements[id]).filter(Boolean);
  const template = members[members.length - 1];
  if (!surface || !template) throw new Error("A panel group needs an existing placement.");
  const occupied = surface.placementIds.map((id) => document.placements[id]).filter(Boolean);
  const obstacles = occupied;
  const width = surface.uniformButtonSize?.width ?? template.width;
  const height = surface.uniformButtonSize?.height ?? template.height;
  const gaps = members.flatMap((left) => members.flatMap((right) =>
    Math.abs(left.y - right.y) < 0.01 && right.x >= left.x + left.width
      ? [right.x - left.x - left.width] : []));
  const gap = gaps.length ? Math.min(...gaps) : buttonSpacingPixelsFromMillimeters(document.settings.buttonSpacingMm);
  const xs = [...new Set(members.flatMap((item) => [item.x, item.x + item.width + gap]))].sort((a, b) => a - b);
  const ys = [...new Set(members.flatMap((item) => [item.y, item.y + item.height + gap]))].sort((a, b) => a - b);
  const rowRight = Math.max(...members.map((item) => item.x + item.width));
  let rect: { x: number; y: number; width: number; height: number } | undefined;
  for (const y of ys) {
    for (const x of xs) {
      const candidate = { x, y, width, height };
      if (x + width <= Math.max(rowRight, xs[0] + width) + 0.01 &&
          !obstacles.some((item) => buttonRectsOverlap(candidate, item))) {
        rect = candidate;
        break;
      }
    }
    if (rect) break;
  }
  rect ??= { x: Math.min(...members.map((item) => item.x)), y: Math.max(...occupied.map((item) => item.y + item.height)) + gap, width, height };
  const id = createStableButtonId("placement");
  const placement: ButtonPlacement = {
    ...cloneButtonDocument(template), ...rect, id, buttonId: button.id, surfaceId,
    zIndex: Math.max(...occupied.map((item) => item.zIndex), 0) + 1,
    activationCycle: null
  };
  document.placements[id] = placement;
  surface.placementIds.push(id);
  surface.width = Math.max(surface.width, rect.x + width);
  surface.height = Math.max(surface.height, rect.y + height);
  for (const field of ["themeOverrides", "programPopoutColorOverrides"] as const) {
    const value = document[field]?.[template.id];
    if (value) {
      document[field] ??= {};
      Object.assign(document[field]!, { [id]: cloneButtonDocument(value) });
    }
  }
  return placement;
}

export function appendRegularPopoutButtons(
  document: ButtonStateDocument, unit: RegularButtonPopoutUnit, buttons: readonly ButtonRecord[]
): void {
  const surface = document.surfaces[unit.surfaceId];
  const oldWidth = surface.width;
  const oldHeight = surface.height;
  for (const button of buttons) {
    if (unit.memberPlacementIds.some((id) => document.placements[id]?.buttonId === button.id)) continue;
    unit.memberPlacementIds.push(appendPlacement(document, unit.surfaceId, unit.memberPlacementIds, button).id);
    unit.memberSourceIdentities.push(cloneButtonDocument(button.sourceIdentity!));
  }
  unit.selectionKey = deriveRegularPopoutSelectionKey(unit.memberSourceIdentities);
  unit.canonicalBounds = { ...unit.canonicalBounds, width: surface.width, height: surface.height };
  if (unit.desktopBounds && unit.desktopBoundsFitMode === "surface") {
    unit.desktopBounds.width *= surface.width / oldWidth;
    unit.desktopBounds.height *= surface.height / oldHeight;
    unit.desktopBoundsEnvelope = { x: 0, y: 0, width: surface.width, height: surface.height };
  }
}

/** Only the exact Pop/Fan referenced by the last-used layout follows additions. */
export function reconcileAddedPanelButtons(before: ButtonStateDocument, next: ButtonStateDocument, windows: readonly LayoutSnapshotWindow[]): void {
  const additions = Object.values(next.buttons).filter((button) => !before.buttons[button.id] && panelKey(button));
  const panels = new Map<string, ButtonRecord[]>();
  for (const button of additions) {
    const key = panelKey(button)!;
    panels.set(key, [...(panels.get(key) ?? []), button]);
  }
  for (const [key, added] of panels) {
    const isPanelGroup = (ids: readonly string[]) =>
      ids.length > 0 &&
      ids.every((id) => panelKey(next.buttons[id]) === key);
    for (const setup of Object.values(next.fanSetups)) {
      if (!windows.some((window) => window.Kind === "button-fan" && window.ButtonFanSetupId === setup.id)) continue;
      if (!isPanelGroup(setup.fanMemberButtonIds)) continue;
      for (const button of added) {
        if (setup.fanMemberButtonIds.includes(button.id)) continue;
        setup.fanMemberPlacementIds.push(appendPlacement(next, setup.fanSurfaceId, setup.fanMemberPlacementIds, button).id);
        setup.fanMemberButtonIds.push(button.id);
      }
    }
    for (const unit of Object.values(next.popoutUnits)) {
      if (unit.kind !== "regular") continue;
      if (!windows.some((window) => window.Kind === "button-popout" && !window.ButtonPopoutSettingsPath && window.ButtonPopoutUnitId === unit.id)) continue;
      const ids = unit.memberPlacementIds.map((id) => next.placements[id]?.buttonId);
      if (isPanelGroup(ids)) appendRegularPopoutButtons(next, unit, added);
    }
  }
}

export function withAddedCanonicalPanelButtons(draft: ButtonStateDocument, canonical: ButtonStateDocument | null): ButtonStateDocument {
  if (!canonical) return draft;
  const added = Object.values(canonical.buttons).filter((button) => !draft.buttons[button.id] && panelKey(button));
  if (!added.length) return draft;
  const next = cloneButtonDocument(draft);
  for (const button of added) next.buttons[button.id] = cloneButtonDocument(button);
  // New records may reference a new default skin.
  for (const button of added) {
    if (!next.skins[button.defaultSkinId] && canonical.skins[button.defaultSkinId]) {
      next.skins[button.defaultSkinId] = cloneButtonDocument(canonical.skins[button.defaultSkinId]);
    }
  }
  const windows: LayoutSnapshotWindow[] = [];
  const bounds = { Left: 0, Top: 0, Width: 1, Height: 1 };
  for (const setup of Object.values(canonical.fanSetups)) {
    if (added.some((button) => setup.fanMemberButtonIds.includes(button.id))) {
      windows.push({ Kind: "button-fan", ButtonFanSetupId: setup.id, Bounds: bounds });
    }
  }
  for (const unit of Object.values(canonical.popoutUnits)) {
    if (unit.kind === "regular" && added.some((button) => unit.memberPlacementIds.some((id) => canonical.placements[id]?.buttonId === button.id))) {
      windows.push({ Kind: "button-popout", ButtonPopoutUnitId: unit.id, Bounds: bounds });
    }
  }
  reconcileAddedPanelButtons(draft, next, windows);
  return next;
}
