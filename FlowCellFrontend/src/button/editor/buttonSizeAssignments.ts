import type { ButtonPlacement } from "../types.js";

export type ButtonPlacementSizingMode = "responsive" | "proportional" | "stretch";

export interface ButtonSizeAssignment {
  width: number;
  height: number;
  sizingMode: ButtonPlacementSizingMode;
}

export interface ButtonSizingDimensions {
  width: number;
  height: number;
}

export function buttonPlacementSizingMode(
  placement: Pick<ButtonPlacement, "matchHitboxToSkin" | "allowStretching">
): ButtonPlacementSizingMode {
  if (!placement.matchHitboxToSkin) return "responsive";
  return placement.allowStretching ? "stretch" : "proportional";
}

export function buttonPlacementSizingPatch(
  assignment: ButtonSizeAssignment
): Pick<ButtonPlacement, "matchHitboxToSkin" | "allowStretching" | "allowLabelResize"> {
  return {
    matchHitboxToSkin: assignment.sizingMode !== "responsive",
    allowStretching: assignment.sizingMode === "stretch",
    // An explicitly assigned box must stay independent from later label edits.
    allowLabelResize: false
  };
}

export function resolveAssignedButtonDimensions(
  assignment: ButtonSizeAssignment,
  proportionalBasis?: ButtonSizingDimensions | null
): ButtonSizingDimensions {
  const target = {
    width: Math.max(1, assignment.width),
    height: Math.max(1, assignment.height)
  };
  if (
    assignment.sizingMode !== "proportional" ||
    !proportionalBasis ||
    !Number.isFinite(proportionalBasis.width) ||
    !Number.isFinite(proportionalBasis.height) ||
    proportionalBasis.width <= 0 ||
    proportionalBasis.height <= 0
  ) {
    return target;
  }

  const scale = Math.min(
    target.width / proportionalBasis.width,
    target.height / proportionalBasis.height
  );
  return {
    width: Math.max(1, proportionalBasis.width * scale),
    height: Math.max(1, proportionalBasis.height * scale)
  };
}
