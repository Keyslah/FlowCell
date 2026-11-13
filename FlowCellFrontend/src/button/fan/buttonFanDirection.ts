import type { ButtonPlacement, ButtonRect, ButtonStateDocument } from "../types.js";
import { buttonSpacingPixelsFromMillimeters } from "../geometry/buttonGeometry.js";

export type ButtonFanExpansionDirection = "left" | "right" | "top" | "bottom";
export const DEFAULT_BUTTON_FAN_DIRECTION: ButtonFanExpansionDirection = "right";

export function resolveButtonFanExpansionDirection(value: unknown): ButtonFanExpansionDirection {
  return value === "left" || value === "top" || value === "bottom" || value === "right"
    ? value : DEFAULT_BUTTON_FAN_DIRECTION;
}

export interface ButtonFanDirectionTarget {
  surfaceId: string;
  ownerPlacementId: string;
  memberPlacementIds: readonly string[];
  popoutUnitId?: string;
}

function usableRect(rect: ButtonRect): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}

function usablePlacement(placement: ButtonPlacement | undefined, surfaceId: string): placement is ButtonPlacement {
  return Boolean(placement && placement.surfaceId === surfaceId && usableRect(placement));
}

/** Translate the content as one group, retaining its authored sizes and grid. */
export function applyButtonFanDirection(
  document: ButtonStateDocument,
  target: ButtonFanDirectionTarget,
  direction: ButtonFanExpansionDirection
): ButtonStateDocument {
  const surface = document.surfaces[target.surfaceId];
  const owner = document.placements[target.ownerPlacementId];
  if (!surface || !usablePlacement(owner, surface.id) || !surface.placementIds.includes(owner.id)) return document;
  const unit = target.popoutUnitId ? document.popoutUnits[target.popoutUnitId] : undefined;
  if (target.popoutUnitId && (!unit || unit.surfaceId !== surface.id)) return document;
  const memberIds = [...new Set(target.memberPlacementIds)].filter((id) => id !== owner.id);
  const members: ButtonPlacement[] = [];
  for (const id of memberIds) {
    const placement = document.placements[id];
    if (!usablePlacement(placement, surface.id) || !surface.placementIds.includes(id)) return document;
    members.push(placement);
  }
  const padding = Number.isFinite(document.settings.defaultSurfacePadding)
    ? Math.max(0, document.settings.defaultSurfacePadding) : 0;
  const gap = buttonSpacingPixelsFromMillimeters(document.settings.buttonSpacingMm);
  const fields = unit?.kind === "tool-set" ? unit.fields : [];
  if (fields.some((field) => !Number.isFinite(field.x) || !Number.isFinite(field.y) || (!field.hidden && !usableRect(field)))) return document;
  const content = [...members, ...fields.filter((field) => !field.hidden)];
  const minX = content.length ? Math.min(...content.map((rect) => rect.x)) : 0;
  const minY = content.length ? Math.min(...content.map((rect) => rect.y)) : 0;
  const groupWidth = content.length ? Math.max(...content.map((rect) => rect.x + rect.width)) - minX : 0;
  const groupHeight = content.length ? Math.max(...content.map((rect) => rect.y + rect.height)) - minY : 0;
  let ownerX = padding;
  let ownerY = padding;
  let groupX = padding;
  let groupY = padding;
  if (content.length) {
    switch (resolveButtonFanExpansionDirection(direction)) {
      case "left": ownerX += groupWidth + gap; break;
      case "top": ownerY += groupHeight + gap; break;
      case "bottom": groupY += owner.height + gap; break;
      case "right": groupX += owner.width + gap; break;
    }
  }
  const width = Math.max(ownerX + owner.width, content.length ? groupX + groupWidth : 0) + padding;
  const height = Math.max(ownerY + owner.height, content.length ? groupY + groupHeight : 0) + padding;
  let placements = document.placements;
  const same = (left: number, right: number) => Math.abs(left - right) < 1e-9;
  const move = (placement: ButtonPlacement, x: number, y: number) => {
    if (same(placement.x, x) && same(placement.y, y)) return;
    if (placements === document.placements) placements = { ...placements };
    placements[placement.id] = { ...placement, x, y };
  };
  move(owner, ownerX, ownerY);
  for (const member of members) move(member, groupX + (member.x - minX), groupY + (member.y - minY));
  let popoutUnits = document.popoutUnits;
  if (unit) {
    const deltaX = content.length ? groupX - minX : 0;
    const deltaY = content.length ? groupY - minY : 0;
    const movedFields = unit.kind === "tool-set" && (!same(deltaX, 0) || !same(deltaY, 0))
      ? unit.fields.map((field) => ({ ...field, x: field.x + deltaX, y: field.y + deltaY })) : fields;
    const resizedUnit = !same(unit.canonicalBounds.width, width) || !same(unit.canonicalBounds.height, height);
    if (resizedUnit || (unit.kind === "tool-set" && movedFields !== unit.fields)) {
      popoutUnits = { ...popoutUnits, [unit.id]: {
        ...unit,
        canonicalBounds: resizedUnit ? { ...unit.canonicalBounds, width, height } : unit.canonicalBounds,
        ...(unit.kind === "tool-set" ? { fields: movedFields } : {})
      } };
    }
  }
  const resized = !same(surface.width, width) || !same(surface.height, height);
  if (placements === document.placements && popoutUnits === document.popoutUnits && !resized) return document;
  return {
    ...document,
    placements,
    popoutUnits,
    surfaces: resized ? { ...document.surfaces, [surface.id]: { ...surface, width, height } } : document.surfaces
  };
}
