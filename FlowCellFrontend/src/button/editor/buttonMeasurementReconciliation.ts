import type {
  ButtonCoreMeasurement,
  ButtonPlacement,
  ButtonRecord
} from "../types.js";

export interface PendingMatchedMeasurement {
  measurement: ButtonCoreMeasurement;
  sourceWidth: number;
  sourceHeight: number;
  sourceAllowStretching: boolean;
  sourceTextFitMode: ButtonPlacement["textFitMode"];
  sourceTextAlignment: ButtonPlacement["textAlignment"];
  sourceMinimumFontSize: number;
  sourceTextSizeOverride: number | null;
  sourceSkinId: string;
  sourceLabel: string;
}

/**
 * Legacy stale-measurement predicate retained for schema-era regression
 * coverage. The Button Editor must not call this for existing placements:
 * rendered measurements are observational and only explicit size actions may
 * commit geometry.
 */
export function shouldApplyMatchedButtonMeasurement(
  placement: ButtonPlacement | undefined,
  button: ButtonRecord | undefined,
  source: PendingMatchedMeasurement
): boolean {
  return Boolean(
    placement?.matchHitboxToSkin &&
    button &&
    placement.width === source.sourceWidth &&
    placement.height === source.sourceHeight &&
    placement.allowStretching === source.sourceAllowStretching &&
    placement.textFitMode === source.sourceTextFitMode &&
    placement.textAlignment === source.sourceTextAlignment &&
    placement.minimumFontSize === source.sourceMinimumFontSize &&
    placement.textSizeOverride === source.sourceTextSizeOverride &&
    (placement.skinOverrideId ?? button.defaultSkinId) === source.sourceSkinId &&
    button.label === source.sourceLabel &&
    (
      Math.abs(placement.width - source.measurement.width) > 0.5 ||
      Math.abs(placement.height - source.measurement.height) > 0.5
    )
  );
}
