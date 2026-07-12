import type { ButtonRect } from "../types.js";
import { buttonRectsOverlap, isButtonRectInsideSurface, snapToGrid } from "./buttonGeometry.js";

export interface LabelGrowthPlacement extends ButtonRect {
  id: string;
}

export interface LabelGrowthResult {
  success: boolean;
  placements: LabelGrowthPlacement[];
  surface: { width: number; height: number };
  movedPlacementIds: string[];
  warning?: string;
}

function overlapsAny(candidate: ButtonRect, resolved: readonly ButtonRect[]): boolean {
  return resolved.some((rect) => buttonRectsOverlap(candidate, rect));
}

function candidateOffsets(ring: number): Array<readonly [number, number]> {
  if (ring === 0) {
    return [[0, 0]];
  }
  const offsets: Array<readonly [number, number]> = [
    [ring, 0],
    [0, ring],
    [-ring, 0],
    [0, -ring]
  ];
  for (let x = 1; x < ring; x += 1) {
    const y = ring - x;
    offsets.push([x, y], [x, -y], [-x, y], [-x, -y]);
  }
  return offsets;
}

function findNearestAvailableRect(
  original: ButtonRect,
  resolved: readonly ButtonRect[],
  surface: { width: number; height: number },
  gridSize: number,
  allowSurfaceExpansion: boolean
): { rect: ButtonRect; width: number; height: number } | null {
  const step = Math.max(1, gridSize);
  const maximumRing = Math.max(64, Math.ceil((surface.width + surface.height) / step) + 8);
  for (let ring = 0; ring <= maximumRing; ring += 1) {
    for (const [offsetX, offsetY] of candidateOffsets(ring)) {
      const rect = {
        ...original,
        x: snapToGrid(original.x + offsetX * step, step),
        y: snapToGrid(original.y + offsetY * step, step)
      };
      if (rect.x < 0 || rect.y < 0 || overlapsAny(rect, resolved)) {
        continue;
      }
      if (!allowSurfaceExpansion && !isButtonRectInsideSurface(rect, surface)) {
        continue;
      }
      return {
        rect,
        width: Math.max(surface.width, rect.x + rect.width),
        height: Math.max(surface.height, rect.y + rect.height)
      };
    }
  }
  return null;
}

export function resolveDeterministicLabelGrowth(args: {
  placements: readonly LabelGrowthPlacement[];
  selectedPlacementId: string;
  grownWidth: number;
  grownHeight: number;
  surface: { width: number; height: number };
  gridSize: number;
  allowSurfaceExpansion: boolean;
}): LabelGrowthResult {
  const selected = args.placements.find((placement) => placement.id === args.selectedPlacementId);
  if (!selected) {
    return {
      success: false,
      placements: args.placements.map((placement) => ({ ...placement })),
      surface: { ...args.surface },
      movedPlacementIds: [],
      warning: "The selected Button placement no longer exists."
    };
  }

  const grownSelected: LabelGrowthPlacement = {
    ...selected,
    width: Math.max(selected.width, args.grownWidth),
    height: Math.max(selected.height, args.grownHeight)
  };
  let nextSurface = { ...args.surface };
  if (!args.allowSurfaceExpansion && !isButtonRectInsideSurface(grownSelected, nextSurface)) {
    return {
      success: false,
      placements: args.placements.map((placement) => ({ ...placement })),
      surface: nextSurface,
      movedPlacementIds: [],
      warning: "The label cannot grow inside the saved surface bounds."
    };
  }
  if (args.allowSurfaceExpansion) {
    nextSurface.width = Math.max(nextSurface.width, grownSelected.x + grownSelected.width);
    nextSurface.height = Math.max(nextSurface.height, grownSelected.y + grownSelected.height);
  }

  const stableOthers = args.placements.filter((placement) => placement.id !== selected.id);
  const resolved: LabelGrowthPlacement[] = [grownSelected];
  const movedPlacementIds: string[] = [];
  for (const placement of stableOthers) {
    const result = findNearestAvailableRect(
      placement,
      resolved,
      nextSurface,
      args.gridSize,
      args.allowSurfaceExpansion
    );
    if (!result) {
      return {
        success: false,
        placements: args.placements.map((item) => ({ ...item })),
        surface: { ...args.surface },
        movedPlacementIds: [],
        warning: "The label growth would create Button overlap that cannot be resolved."
      };
    }
    const next = { ...placement, ...result.rect };
    if (next.x !== placement.x || next.y !== placement.y) {
      movedPlacementIds.push(placement.id);
    }
    resolved.push(next);
    nextSurface = { width: result.width, height: result.height };
  }

  const byId = new Map(resolved.map((placement) => [placement.id, placement]));
  return {
    success: true,
    placements: args.placements.map((placement) => ({ ...(byId.get(placement.id) ?? placement) })),
    surface: nextSurface,
    movedPlacementIds
  };
}

export function applyLabelResizePolicy(args: {
  allowLabelResize: boolean;
  placements: readonly LabelGrowthPlacement[];
  selectedPlacementId: string;
  grownWidth: number;
  grownHeight: number;
  surface: { width: number; height: number };
  gridSize: number;
  allowSurfaceExpansion: boolean;
}): LabelGrowthResult {
  if (!args.allowLabelResize) {
    return {
      success: true,
      placements: args.placements.map((placement) => ({ ...placement })),
      surface: { ...args.surface },
      movedPlacementIds: []
    };
  }
  return resolveDeterministicLabelGrowth(args);
}
