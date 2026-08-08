import type { ButtonPlacement } from "../types.js";

export type ButtonPlacementSizingMode = "responsive" | "proportional" | "stretch";

export interface ButtonSizeAssignment {
  width: number;
  height: number;
  sizingMode: ButtonPlacementSizingMode;
  /** Natural core basis for the selected working skin; panel assignment uses each member's own basis. */
  proportionalBasis?: ButtonSizingDimensions;
}

export interface ButtonSizingDimensions {
  width: number;
  height: number;
}

/**
 * Projects an existing placement box onto a skin's natural ratio without
 * privileging its already-wrong width or height. Preserving area makes the
 * first explicit proportional handle resize start from the authored ratio
 * while avoiding any implicit geometry change when the mode is merely chosen.
 */
export function resolveProportionalResizeBasis(
  current: ButtonSizingDimensions,
  naturalAspectRatio?: number | null
): ButtonSizingDimensions {
  if (
    !Number.isFinite(current.width) ||
    !Number.isFinite(current.height) ||
    current.width <= 0 ||
    current.height <= 0 ||
    !Number.isFinite(naturalAspectRatio) ||
    (naturalAspectRatio ?? 0) <= 0
  ) {
    return current;
  }
  const area = current.width * current.height;
  const height = Math.sqrt(area / naturalAspectRatio!);
  return {
    width: height * naturalAspectRatio!,
    height
  };
}

export function buttonPlacementSizingMode(
  placement: Pick<ButtonPlacement, "matchHitboxToSkin" | "allowStretching">
): ButtonPlacementSizingMode {
  if (!placement.matchHitboxToSkin) return "responsive";
  return placement.allowStretching ? "stretch" : "proportional";
}

export function buttonSizingModeLocksAspect(
  sizingMode: ButtonPlacementSizingMode,
  forceAspectLock = false
): boolean {
  return sizingMode === "proportional" || forceAspectLock;
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
