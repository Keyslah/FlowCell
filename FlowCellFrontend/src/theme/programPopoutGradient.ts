import type { ProgramPopoutGradientCurvePoint } from "../button/types.js";
import { gradientPositionForPlacement, interpolateThemeColor } from "./themeModel.js";
import { programPopoutGradientCurveValue } from "./programPopoutGradientCurve.js";

export {
  PROGRAM_POPOUT_GRADIENT_CURVE_MAX_POINTS,
  normalizeProgramPopoutGradientCurve,
  programPopoutGradientCurveHandle,
  programPopoutGradientCurveValue
} from "./programPopoutGradientCurve.js";

function unit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** 0 degrees runs top-to-bottom and 90 degrees left-to-right, in y-down screen space. */
export function programPopoutGradientDirection(angle = 0): { x: number; y: number } {
  const radians = angle * Math.PI / 180;
  // Rounding keeps symmetric angles symmetric (sin 45 and cos 45 differ in the last bit).
  const snap = (value: number) => Math.round(value * 1e12) / 1e12 || 0;
  return { x: snap(Math.sin(radians)), y: snap(Math.cos(radians)) };
}

export function programPopoutGradientProjection(point: { x: number; y: number }, angle = 0): number {
  const direction = programPopoutGradientDirection(angle);
  return point.x * direction.x + point.y * direction.y;
}

/** Like a CSS angle gradient, the box corners anchor the first and last stops. */
export function programPopoutGradientBoxPosition(
  point: { x: number; y: number },
  box: { minimumX: number; maximumX: number; minimumY: number; maximumY: number },
  angle = 0
): number {
  const direction = programPopoutGradientDirection(angle);
  const xs = [box.minimumX * direction.x, box.maximumX * direction.x];
  const ys = [box.minimumY * direction.y, box.maximumY * direction.y];
  const minimum = Math.min(...xs) + Math.min(...ys);
  const maximum = Math.max(...xs) + Math.max(...ys);
  return maximum > minimum
    ? unit((programPopoutGradientProjection(point, angle) - minimum) / (maximum - minimum))
    : 0;
}

/** Popout palettes retain every selected stop, including under Spread and Scatter. */
export function programPopoutGradientColor(args: {
  colors: readonly string[];
  spread: number;
  scatter: number;
  seed: number;
  placementId: string;
  y: number;
  minimumY: number;
  maximumY: number;
  curve?: readonly ProgramPopoutGradientCurvePoint[];
}): string {
  if (args.colors.length === 1) return args.colors[0];
  const range = args.maximumY - args.minimumY;
  const linear = range > 0 ? unit((args.y - args.minimumY) / range) : 0;
  const position = programPopoutGradientCurveValue(args.curve, linear);
  const scaled = position * (args.colors.length - 1);
  const anchor = Math.round(scaled);
  if (Math.abs(scaled - anchor) < 1e-10) return args.colors[anchor];
  const index = Math.floor(scaled);
  const fraction = scaled - index;
  const spread = Math.min(1, Math.max(0, args.spread / 100));
  // Spread controls the transition width inside each interval, rather than
  // cropping the selected palette to its middle and losing its endpoints.
  const blend = spread > 0 ? 0.5 + (fraction - 0.5) / spread : fraction < 0.5 ? 0 : 1;
  const noise = gradientPositionForPlacement({
    placementId: args.placementId, y: 0.5, minimumY: 0, maximumY: 1,
    gradient: { spread: 100, scatter: args.scatter, seed: args.seed }
  }) - 0.5;
  const jitter = noise * 4 * fraction * (1 - fraction);
  return interpolateThemeColor(args.colors[index], args.colors[index + 1], blend + jitter);
}
