import type { ProgramPopoutGradientCurvePoint } from "../button/types.js";

export const PROGRAM_POPOUT_GRADIENT_CURVE_MAX_POINTS = 32;
const CURVE_MODES = new Set(["auto", "corner", "aligned", "free"]);
const CURVE_POINT_KEYS = new Set(["x", "y", "mode"]);
const CURVE_HANDLE_POINT_KEYS = new Set(["x", "y", "mode", "inX", "inY", "outX", "outY"]);

function inRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function unit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Rejects malformed curves; endpoints are pinned to x=0/x=1 and x strictly increases. */
export function normalizeProgramPopoutGradientCurve(value: unknown): ProgramPopoutGradientCurvePoint[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > PROGRAM_POPOUT_GRADIENT_CURVE_MAX_POINTS) return null;
  const points: ProgramPopoutGradientCurvePoint[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const candidate = entry as Record<string, unknown>;
    const mode = candidate.mode;
    if (typeof mode !== "string" || !CURVE_MODES.has(mode)) return null;
    const hasHandles = mode === "aligned" || mode === "free";
    const allowed = hasHandles ? CURVE_HANDLE_POINT_KEYS : CURVE_POINT_KEYS;
    if (Object.keys(candidate).some((key) => !allowed.has(key))) return null;
    if (!inRange(candidate.x, 0, 1) || !inRange(candidate.y, 0, 1)) return null;
    const point: ProgramPopoutGradientCurvePoint = {
      x: candidate.x,
      y: candidate.y,
      mode: mode as ProgramPopoutGradientCurvePoint["mode"]
    };
    if (hasHandles) {
      if (!inRange(candidate.inX, -1, 0) || !inRange(candidate.inY, -1, 1) ||
          !inRange(candidate.outX, 0, 1) || !inRange(candidate.outY, -1, 1)) return null;
      point.inX = candidate.inX;
      point.inY = candidate.inY;
      point.outX = candidate.outX;
      point.outY = candidate.outY;
    }
    points.push(point);
  }
  if (points[0].x !== 0 || points[points.length - 1].x !== 1) return null;
  if (points.some((point, index) => index > 0 && point.x <= points[index - 1].x)) return null;
  return points;
}

/** Auto handles are clamped at local peaks and valleys so they stay flat instead of overshooting. */
function autoSlope(points: readonly ProgramPopoutGradientCurvePoint[], index: number): number {
  const previous = points[index - 1];
  const current = points[index];
  const next = points[index + 1];
  if (!previous) return (next.y - current.y) / (next.x - current.x);
  if (!next) return (current.y - previous.y) / (current.x - previous.x);
  if ((current.y - previous.y) * (next.y - current.y) <= 0) return 0;
  return (next.y - previous.y) / (next.x - previous.x);
}

/** Handles are scaled, not cropped, to the segment width so x stays monotone and direction is kept. */
function fittedHandle(dx: number, dy: number, width: number): [number, number] {
  const extent = Math.abs(dx);
  return extent > width ? [dx * width / extent, dy * width / extent] : [dx, dy];
}

export function programPopoutGradientCurveHandle(
  points: readonly ProgramPopoutGradientCurvePoint[],
  index: number,
  side: "in" | "out"
): [number, number] {
  const point = points[index];
  const neighbor = points[side === "out" ? index + 1 : index - 1];
  if (!neighbor) return [0, 0];
  const width = Math.abs(neighbor.x - point.x);
  if (point.mode === "aligned" || point.mode === "free") {
    return side === "out"
      ? fittedHandle(point.outX ?? 0, point.outY ?? 0, width)
      : fittedHandle(point.inX ?? 0, point.inY ?? 0, width);
  }
  if (point.mode === "corner") return [(neighbor.x - point.x) / 3, (neighbor.y - point.y) / 3];
  const slope = autoSlope(points, index);
  return side === "out" ? [width / 3, slope * width / 3] : [-width / 3, -slope * width / 3];
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

/** De Casteljau keeps flat segments exact, unlike an expanded Bernstein sum. */
function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const a = lerp(p0, p1, t);
  const b = lerp(p1, p2, t);
  const c = lerp(p2, p3, t);
  return lerp(lerp(a, b, t), lerp(b, c, t), t);
}

/** Maps a unit position through the curve; output is clamped to the unit range. */
export function programPopoutGradientCurveValue(
  curve: readonly ProgramPopoutGradientCurvePoint[] | undefined,
  value: number
): number {
  const position = unit(value);
  if (!curve || curve.length < 2) return position;
  let index = 0;
  while (index < curve.length - 2 && position > curve[index + 1].x) index += 1;
  const start = curve[index];
  const end = curve[index + 1];
  if (position <= start.x) return unit(start.y);
  if (position >= end.x) return unit(end.y);
  const [outX, outY] = programPopoutGradientCurveHandle(curve, index, "out");
  const [inX, inY] = programPopoutGradientCurveHandle(curve, index + 1, "in");
  const x1 = start.x + outX;
  const x2 = end.x + inX;
  let low = 0;
  let high = 1;
  // Both handles stay inside the segment, so x(t) is monotone and bisection is exact enough.
  for (let step = 0; step < 48; step += 1) {
    const middle = (low + high) / 2;
    if (cubic(start.x, x1, x2, end.x, middle) < position) low = middle;
    else high = middle;
  }
  return unit(cubic(start.y, start.y + outY, end.y + inY, end.y, (low + high) / 2));
}
