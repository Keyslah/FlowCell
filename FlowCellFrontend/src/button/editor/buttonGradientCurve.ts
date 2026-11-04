import type { ProgramPopoutGradientCurvePoint as CurvePoint } from "../types.js";
import {
  PROGRAM_POPOUT_GRADIENT_CURVE_MAX_POINTS,
  programPopoutGradientCurveHandle,
  programPopoutGradientCurveValue
} from "../../theme/programPopoutGradientCurve.js";

const CURVE_MIN_GAP = 0.002;

type CurveHandleSide = "in" | "out";

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function bounded(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function snapped(value: number, snap: boolean): number {
  return snap ? Math.round(value * 20) / 20 : value;
}

function hasOwnHandles(point: CurvePoint): boolean {
  return point.mode === "aligned" || point.mode === "free";
}

function handlePoint(
  x: number,
  y: number,
  inX: number,
  inY: number,
  outX: number,
  outY: number
): CurvePoint {
  return { x, y, mode: "free", inX, inY, outX, outY };
}

export function buttonCurveFade(): CurvePoint[] {
  return [{ x: 0, y: 1, mode: "auto" }, { x: 1, y: 0, mode: "auto" }];
}

function buttonCurveFull(): CurvePoint[] {
  return [{ x: 0, y: 1, mode: "auto" }, { x: 1, y: 1, mode: "auto" }];
}

export function buttonCurveFlipped(curve: readonly CurvePoint[]): CurvePoint[] {
  return curve.map((point) => hasOwnHandles(point)
    ? { ...point, y: round4(1 - point.y), inY: round4(-(point.inY ?? 0)), outY: round4(-(point.outY ?? 0)) }
    : { ...point, y: round4(1 - point.y) });
}

export function buttonCurveMirrored(curve: readonly CurvePoint[]): CurvePoint[] {
  return curve.slice().reverse().map((point) => hasOwnHandles(point)
    ? {
        x: round4(1 - point.x),
        y: point.y,
        mode: point.mode,
        inX: round4(-(point.outX ?? 0)),
        inY: point.outY ?? 0,
        outX: round4(-(point.inX ?? 0)),
        outY: point.inY ?? 0
      }
    : { x: round4(1 - point.x), y: point.y, mode: point.mode });
}

function buttonCurveSteps(bands: number): CurvePoint[] {
  const points: CurvePoint[] = [{ x: 0, y: 1, mode: "corner" }];
  for (let band = 1; band < bands; band += 1) {
    const edge = round4(band / bands);
    points.push(
      { x: round4(edge - 0.004), y: round4(1 - (band - 1) / (bands - 1)), mode: "corner" },
      { x: edge, y: round4(1 - band / (bands - 1)), mode: "corner" }
    );
  }
  points.push({ x: 1, y: 0, mode: "corner" });
  return points;
}

/** The Theme Editor's strength presets, turned to run from full at Start to nothing at End. */
export const BUTTON_CURVE_PRESETS: ReadonlyArray<{
  label: string;
  tooltip: string;
  build: () => CurvePoint[];
}> = [
  { label: "Fade", tooltip: "An even fade from full at Start to nothing at End.", build: buttonCurveFade },
  {
    label: "Ease In",
    tooltip: "Stay strong near Start, then drop quickly toward End.",
    build: () => [handlePoint(0, 1, 0, 0, 0.42, 0), handlePoint(1, 0, 0, 0, 0, 0)]
  },
  {
    label: "Ease Out",
    tooltip: "Drop quickly from Start, then settle slowly into End.",
    build: () => [handlePoint(0, 1, 0, 0, 0, 0), handlePoint(1, 0, -0.42, 0, 0, 0)]
  },
  {
    label: "Ease In-Out",
    tooltip: "Gentle at both ends, fastest through the middle.",
    build: () => [handlePoint(0, 1, 0, 0, 0.42, 0), handlePoint(1, 0, -0.42, 0, 0, 0)]
  },
  {
    label: "Hold Middle",
    tooltip: "Drop fast at both ends and linger on the middle strength.",
    build: () => [handlePoint(0, 1, 0, 0, 0, -0.6), handlePoint(1, 0, 0, 0.6, 0, 0)]
  },
  { label: "Full", tooltip: "Full strength along the whole trail.", build: buttonCurveFull },
  {
    label: "Peak",
    tooltip: "Nothing at both ends and full in the middle.",
    build: () => [{ x: 0, y: 0, mode: "auto" }, { x: 0.5, y: 1, mode: "auto" }, { x: 1, y: 0, mode: "auto" }]
  },
  {
    label: "Valley",
    tooltip: "Full at both ends and nothing in the middle.",
    build: () => [{ x: 0, y: 1, mode: "auto" }, { x: 0.5, y: 0, mode: "auto" }, { x: 1, y: 1, mode: "auto" }]
  },
  {
    label: "Wave",
    tooltip: "Pulse twice along the trail.",
    build: () => [
      { x: 0, y: 1, mode: "auto" }, { x: 0.25, y: 0, mode: "auto" }, { x: 0.5, y: 1, mode: "auto" },
      { x: 0.75, y: 0, mode: "auto" }, { x: 1, y: 1, mode: "auto" }
    ]
  },
  { label: "Steps", tooltip: "Solid bands with hard edges.", build: () => buttonCurveSteps(4) }
];

function materializedPoint(
  curve: readonly CurvePoint[],
  index: number,
  mode: "aligned" | "free"
): CurvePoint {
  const point = curve[index];
  if (hasOwnHandles(point)) return { ...point, mode };
  const [inX, inY] = programPopoutGradientCurveHandle(curve, index, "in");
  const [outX, outY] = programPopoutGradientCurveHandle(curve, index, "out");
  return {
    x: point.x,
    y: point.y,
    mode,
    inX: round4(bounded(inX, -1, 0)),
    inY: round4(bounded(inY, -1, 1)),
    outX: round4(bounded(outX, 0, 1)),
    outY: round4(bounded(outY, -1, 1))
  };
}

export function buttonCurveWithPointMode(
  curve: readonly CurvePoint[],
  index: number,
  mode: CurvePoint["mode"]
): CurvePoint[] {
  const point = curve[index];
  if (!point || point.mode === mode) return [...curve];
  const next = [...curve];
  next[index] = mode === "aligned" || mode === "free"
    ? materializedPoint(curve, index, mode)
    : { x: point.x, y: point.y, mode };
  return next;
}

/** Returns the new point's index, or -1 when the curve is full or the spot is too tight. */
export function buttonCurveInsertionIndex(
  curve: readonly CurvePoint[],
  position: { x: number; y: number }
): number {
  if (curve.length >= PROGRAM_POPOUT_GRADIENT_CURVE_MAX_POINTS) return -1;
  const x = round4(bounded(position.x));
  const index = curve.findIndex((point) => point.x >= x);
  if (index <= 0 || x - curve[index - 1].x < CURVE_MIN_GAP || curve[index].x - x < CURVE_MIN_GAP) return -1;
  return index;
}

export function buttonCurveWithInsertedPoint(
  curve: readonly CurvePoint[],
  index: number,
  position: { x: number; y: number }
): CurvePoint[] {
  const next = [...curve];
  next.splice(index, 0, { x: round4(bounded(position.x)), y: round4(bounded(position.y)), mode: "auto" });
  return next;
}

/** Start and End stay pinned to the ends of the X axis, as in the Theme Editor. */
export function buttonCurveWithMovedPoint(
  curve: readonly CurvePoint[],
  index: number,
  position: { x: number; y: number },
  snap = false
): CurvePoint[] {
  const point = curve[index];
  if (!point) return [...curve];
  const moved = { ...point };
  if (index > 0 && index < curve.length - 1 && Number.isFinite(position.x)) {
    const previous = curve[index - 1].x;
    const next = curve[index + 1].x;
    const x = round4(Math.min(next - CURVE_MIN_GAP, Math.max(previous + CURVE_MIN_GAP, snapped(position.x, snap))));
    if (x > previous && x < next) moved.x = x;
  }
  if (Number.isFinite(position.y)) moved.y = round4(bounded(snapped(position.y, snap)));
  const next = [...curve];
  next[index] = moved;
  return next;
}

export function buttonCurveWithMovedHandle(
  curve: readonly CurvePoint[],
  index: number,
  side: CurveHandleSide,
  position: { x: number; y: number },
  breakHandles = false,
  snap = false
): CurvePoint[] {
  const current = curve[index];
  if (!current) return [...curve];
  const point = !hasOwnHandles(current)
    ? materializedPoint(curve, index, current.mode === "auto" && !breakHandles ? "aligned" : "free")
    : breakHandles ? { ...current, mode: "free" as const } : { ...current };
  const dx = side === "out"
    ? bounded(snapped(position.x, snap) - point.x, 0, 1)
    : bounded(snapped(position.x, snap) - point.x, -1, 0);
  const dy = bounded(snapped(position.y, snap) - point.y, -1, 1);
  if (side === "out") {
    point.outX = round4(dx);
    point.outY = round4(dy);
  } else {
    point.inX = round4(dx);
    point.inY = round4(dy);
  }
  if (point.mode === "aligned") {
    const otherX = (side === "out" ? point.inX : point.outX) ?? 0;
    const otherY = (side === "out" ? point.inY : point.outY) ?? 0;
    const ownLength = Math.hypot(dx, dy);
    const otherLength = Math.hypot(otherX, otherY);
    if (ownLength >= 1e-6 && otherLength >= 1e-6) {
      const mirroredX = -dx * otherLength / ownLength;
      const mirroredY = round4(bounded(-dy * otherLength / ownLength, -1, 1));
      if (side === "out") {
        point.inX = round4(bounded(mirroredX, -1, 0));
        point.inY = mirroredY;
      } else {
        point.outX = round4(bounded(mirroredX, 0, 1));
        point.outY = mirroredY;
      }
    }
  }
  const next = [...curve];
  next[index] = point;
  return next;
}

export function buttonCurveWithoutPoint(curve: readonly CurvePoint[], index: number): CurvePoint[] {
  if (index <= 0 || index >= curve.length - 1) return [...curve];
  const next = [...curve];
  next.splice(index, 1);
  return next;
}

export function buttonCurvePathData(curve: readonly CurvePoint[], samples = 160): string {
  return Array.from({ length: samples + 1 }, (_, index) => {
    const x = index / samples;
    const y = programPopoutGradientCurveValue(curve, x);
    return `${index === 0 ? "M" : "L"}${round4(x * 100)} ${round4(100 - y * 100)}`;
  }).join("");
}
