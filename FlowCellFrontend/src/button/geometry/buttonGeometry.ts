import type { ButtonCoreMeasurement, ButtonRect } from "../types.js";

export interface ButtonSnapOptions {
  surface: Pick<ButtonRect, "width" | "height">;
  otherRects: readonly ButtonRect[];
  tolerance: number;
  gridSize: number;
  keepInsideSurface?: boolean;
  snapSize?: boolean;
}

export interface ButtonGeometryResolution {
  rect: ButtonRect;
  valid: boolean;
  snappedX: boolean;
  snappedY: boolean;
  conflicts: number[];
}

export interface ButtonSkinScale {
  scaleX: number;
  scaleY: number;
}

export interface StarterLayoutItem {
  id: string;
  width: number;
  height: number;
}

export interface StarterLayoutResult {
  rects: Record<string, ButtonRect>;
  requiredWidth: number;
  requiredHeight: number;
}

export interface NamedButtonRect {
  id: string;
  rect: ButtonRect;
}

export type ButtonReorderPosition = "before" | "after";

export interface CompactButtonPlacement extends NamedButtonRect {
  zIndex: number;
}

export interface CompactButtonPlacementResult {
  success: boolean;
  placements: CompactButtonPlacement[];
  requiredWidth: number;
  requiredHeight: number;
  reason: string | null;
}

export interface ButtonPlacementRowProfile {
  wrapWidth: number;
  topOffsets: readonly number[];
}

export interface ButtonPlacementRow {
  placements: readonly NamedButtonRect[];
  topOffset: number | null;
}

export interface CompactButtonPlacementRowsOptions {
  anchorX?: number;
  anchorY?: number;
  gap?: number;
  preserveRowTopOffsets?: boolean;
}

export type ButtonReorderRowCandidateKind = "existing-row" | "new-row";

export interface ButtonReorderRowCandidate {
  key: string;
  kind: ButtonReorderRowCandidateKind;
  rowIndex: number;
  columnIndex: number;
  orderedPlacementIds: string[];
  placements: CompactButtonPlacement[];
  slot: ButtonRect;
  distance: number;
}

export interface ButtonReorderRowCandidateResult {
  candidates: ButtonReorderRowCandidate[];
  reason: string | null;
}

export interface CompactButtonPlacementOptions {
  anchorX?: number;
  anchorY?: number;
  gap?: number;
  rowProfile?: ButtonPlacementRowProfile;
}

export interface ButtonLayoutGeometryIssue {
  placementIds: string[];
  message: string;
}

const EPSILON = 0.0001;

export function normalizeButtonRect(rect: ButtonRect): ButtonRect {
  return {
    x: Number.isFinite(rect.x) ? rect.x : 0,
    y: Number.isFinite(rect.y) ? rect.y : 0,
    width: Number.isFinite(rect.width) ? Math.max(1, rect.width) : 1,
    height: Number.isFinite(rect.height) ? Math.max(1, rect.height) : 1
  };
}

export function buttonRectsOverlap(left: ButtonRect, right: ButtonRect): boolean {
  return (
    left.x < right.x + right.width - EPSILON &&
    left.x + left.width > right.x + EPSILON &&
    left.y < right.y + right.height - EPSILON &&
    left.y + left.height > right.y + EPSILON
  );
}

export function isButtonRectInsideSurface(
  rect: ButtonRect,
  surface: Pick<ButtonRect, "width" | "height">
): boolean {
  return (
    rect.x >= -EPSILON &&
    rect.y >= -EPSILON &&
    rect.x + rect.width <= surface.width + EPSILON &&
    rect.y + rect.height <= surface.height + EPSILON
  );
}

export function findButtonRectConflicts(
  rect: ButtonRect,
  others: readonly ButtonRect[]
): number[] {
  const conflicts: number[] = [];
  others.forEach((other, index) => {
    if (buttonRectsOverlap(rect, other)) {
      conflicts.push(index);
    }
  });
  return conflicts;
}

export function snapToGrid(value: number, gridSize: number): number {
  if (!Number.isFinite(gridSize) || gridSize <= 0) {
    return value;
  }
  return Math.round(value / gridSize) * gridSize;
}

export function reorderButtonPlacementIds(
  placementIds: readonly string[],
  movingPlacementId: string,
  targetPlacementId: string,
  position: ButtonReorderPosition
): string[] {
  const next = [...placementIds];
  const movingIndex = next.indexOf(movingPlacementId);
  const targetIndex = next.indexOf(targetPlacementId);
  if (
    movingIndex < 0 ||
    targetIndex < 0 ||
    movingPlacementId === targetPlacementId
  ) return next;

  next.splice(movingIndex, 1);
  const remainingTargetIndex = next.indexOf(targetPlacementId);
  next.splice(position === "after" ? remainingTargetIndex + 1 : remainingTargetIndex, 0, movingPlacementId);
  return next;
}

/**
 * Recovers the current visual row profile without relying on surface width.
 * Positive vertical overlap keeps unequal-height Buttons in the same row;
 * touching or separated rectangles start another row.
 */
export function inferButtonPlacementRows(
  placements: readonly NamedButtonRect[]
): ButtonPlacementRow[] {
  const ordered = [...placements].sort((left, right) =>
    left.rect.y - right.rect.y ||
    left.rect.x - right.rect.x ||
    left.id.localeCompare(right.id)
  );
  const rows: Array<{ top: number; bottom: number; placements: NamedButtonRect[] }> = [];

  for (const placement of ordered) {
    const top = placement.rect.y;
    const bottom = placement.rect.y + placement.rect.height;
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) {
      rows.push({ top, bottom, placements: [placement] });
      continue;
    }

    let bestRowIndex = -1;
    let bestOverlap = 0;
    rows.forEach((row, rowIndex) => {
      const overlap = Math.min(bottom, row.bottom) - Math.max(top, row.top);
      if (overlap > bestOverlap + EPSILON) {
        bestOverlap = overlap;
        bestRowIndex = rowIndex;
      }
    });

    if (bestRowIndex < 0) {
      rows.push({ top, bottom, placements: [placement] });
      continue;
    }
    const row = rows[bestRowIndex];
    row.top = Math.min(row.top, top);
    row.bottom = Math.max(row.bottom, bottom);
    row.placements.push(placement);
  }

  const orderedRows = rows
    .sort((left, right) => left.top - right.top || left.bottom - right.bottom);
  const originTop = orderedRows[0]?.top ?? 0;
  return orderedRows.map((row) => ({
    placements: [...row.placements].sort((left, right) =>
      left.rect.x - right.rect.x ||
      left.rect.y - right.rect.y ||
      left.id.localeCompare(right.id)
    ),
    topOffset: row.top - originTop
  }));
}

export function inferButtonPlacementRowProfile(
  placements: readonly NamedButtonRect[]
): ButtonPlacementRowProfile {
  const rows = inferButtonPlacementRows(placements);
  return {
    wrapWidth: Math.max(
      0,
      ...rows.map((row) => row.placements.reduce((width, placement) => width + placement.rect.width, 0))
    ),
    topOffsets: rows.map((row) => row.topOffset ?? 0)
  };
}

function chooseClosestDelta(candidates: readonly number[], tolerance: number): number {
  const eligible = candidates.filter((candidate) => Math.abs(candidate) <= tolerance + EPSILON);
  eligible.sort((left, right) => Math.abs(left) - Math.abs(right) || left - right);
  return eligible[0] ?? 0;
}

function xSnapDeltas(rect: ButtonRect, options: ButtonSnapOptions): number[] {
  const left = rect.x;
  const right = rect.x + rect.width;
  const deltas = [-left, options.surface.width - right];
  for (const other of options.otherRects) {
    const otherLeft = other.x;
    const otherRight = other.x + other.width;
    deltas.push(otherLeft - left, otherRight - left, otherLeft - right, otherRight - right);
  }
  return deltas;
}

function ySnapDeltas(rect: ButtonRect, options: ButtonSnapOptions): number[] {
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const deltas = [-top, options.surface.height - bottom];
  for (const other of options.otherRects) {
    const otherTop = other.y;
    const otherBottom = other.y + other.height;
    deltas.push(otherTop - top, otherBottom - top, otherTop - bottom, otherBottom - bottom);
  }
  return deltas;
}

function clampButtonRectToSurface(
  rect: ButtonRect,
  surface: Pick<ButtonRect, "width" | "height">
): ButtonRect {
  return {
    ...rect,
    x: Math.min(Math.max(0, rect.x), Math.max(0, surface.width - rect.width)),
    y: Math.min(Math.max(0, rect.y), Math.max(0, surface.height - rect.height))
  };
}

function candidateRect(base: ButtonRect, dx: number, dy: number): ButtonRect {
  return { ...base, x: base.x + dx, y: base.y + dy };
}

/**
 * Scales a resize candidate so it keeps the starting rect's aspect ratio.
 * The axis whose proportional change is larger drives the shared scale, and
 * the result never drops either dimension below minimumSize.
 */
export function lockButtonRectAspect(
  start: Pick<ButtonRect, "width" | "height">,
  candidateWidth: number,
  candidateHeight: number,
  minimumSize: number
): { width: number; height: number } {
  const startWidth = Math.max(1, start.width);
  const startHeight = Math.max(1, start.height);
  const widthScale = candidateWidth / startWidth;
  const heightScale = candidateHeight / startHeight;
  let scale = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1) ? widthScale : heightScale;
  scale = Math.max(scale, minimumSize / startWidth, minimumSize / startHeight);
  return { width: startWidth * scale, height: startHeight * scale };
}

/**
 * Snaps only the dominant resize axis, derives the other dimension from the
 * starting ratio, and then runs the normal surface/collision resolver without
 * independently re-snapping the derived dimension.
 */
export function resolveAspectLockedButtonGeometry(
  start: Pick<ButtonRect, "width" | "height">,
  candidate: ButtonRect,
  options: ButtonSnapOptions
): ButtonGeometryResolution {
  const startWidth = Math.max(1, start.width);
  const startHeight = Math.max(1, start.height);
  const candidateWidth = Number.isFinite(candidate.width) ? candidate.width : startWidth;
  const candidateHeight = Number.isFinite(candidate.height) ? candidate.height : startHeight;
  const widthScale = candidateWidth / startWidth;
  const heightScale = candidateHeight / startHeight;
  const drivingAxis = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
    ? "width"
    : "height";
  const locked = lockButtonRectAspect(
    { width: startWidth, height: startHeight },
    candidateWidth,
    candidateHeight,
    options.gridSize
  );
  const drivingStart = drivingAxis === "width" ? startWidth : startHeight;
  const drivingCandidate = drivingAxis === "width" ? locked.width : locked.height;
  const minimumScale = Math.max(options.gridSize / startWidth, options.gridSize / startHeight);
  const minimumDrivingSize = drivingStart * minimumScale;
  let snappedDrivingSize = Math.max(
    options.gridSize,
    snapToGrid(drivingCandidate, options.gridSize)
  );
  if (snappedDrivingSize < minimumDrivingSize) {
    snappedDrivingSize = Math.ceil(minimumDrivingSize / options.gridSize) * options.gridSize;
  }
  const lockedSize = drivingAxis === "width"
    ? {
        width: snappedDrivingSize,
        height: snappedDrivingSize * startHeight / startWidth
      }
    : {
        width: snappedDrivingSize * startWidth / startHeight,
        height: snappedDrivingSize
      };
  return resolveButtonGeometry(
    {
      ...candidate,
      ...lockedSize
    },
    { ...options, snapSize: false }
  );
}

function interpolateButtonRect(start: ButtonRect, end: ButtonRect, progress: number): ButtonRect {
  return {
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress,
    width: start.width + (end.width - start.width) * progress,
    height: start.height + (end.height - start.height) * progress
  };
}

interface ButtonPathInterval {
  lower: number;
  upper: number;
  possible: boolean;
}

function constrainPathLessThanZero(
  interval: ButtonPathInterval,
  start: number,
  delta: number
): void {
  if (!interval.possible) return;
  if (Math.abs(delta) <= EPSILON) {
    if (start >= 0) interval.possible = false;
    return;
  }
  const boundary = -start / delta;
  if (delta > 0) interval.upper = Math.min(interval.upper, boundary);
  else interval.lower = Math.max(interval.lower, boundary);
}

function constrainPathGreaterThanZero(
  interval: ButtonPathInterval,
  start: number,
  delta: number
): void {
  if (!interval.possible) return;
  if (Math.abs(delta) <= EPSILON) {
    if (start <= 0) interval.possible = false;
    return;
  }
  const boundary = -start / delta;
  if (delta > 0) interval.lower = Math.max(interval.lower, boundary);
  else interval.upper = Math.min(interval.upper, boundary);
}

function firstButtonPathConflictProgress(
  start: ButtonRect,
  candidate: ButtonRect,
  others: readonly ButtonRect[]
): number | null {
  const leftDelta = candidate.x - start.x;
  const topDelta = candidate.y - start.y;
  const rightStart = start.x + start.width;
  const bottomStart = start.y + start.height;
  const rightDelta = candidate.x + candidate.width - rightStart;
  const bottomDelta = candidate.y + candidate.height - bottomStart;
  let earliest: number | null = null;

  for (const other of others) {
    const interval: ButtonPathInterval = {
      lower: Number.NEGATIVE_INFINITY,
      upper: Number.POSITIVE_INFINITY,
      possible: true
    };
    constrainPathLessThanZero(interval, start.x - (other.x + other.width), leftDelta);
    constrainPathGreaterThanZero(interval, rightStart - other.x, rightDelta);
    constrainPathLessThanZero(interval, start.y - (other.y + other.height), topDelta);
    constrainPathGreaterThanZero(interval, bottomStart - other.y, bottomDelta);
    if (!interval.possible) continue;
    const lower = Math.max(0, interval.lower);
    const upper = Math.min(1, interval.upper);
    if (lower >= upper - EPSILON || lower >= 1 - EPSILON || upper <= EPSILON) continue;
    earliest = earliest === null ? lower : Math.min(earliest, lower);
  }
  return earliest;
}

function boundButtonPathCandidate(
  start: ButtonRect,
  candidate: ButtonRect,
  options: ButtonSnapOptions
): ButtonRect {
  const normalized = normalizeButtonRect(candidate);
  if (options.keepInsideSurface === false) return normalized;
  const width = Math.min(
    normalized.width,
    Math.max(1, options.surface.width - Math.max(0, start.x))
  );
  const height = Math.min(
    normalized.height,
    Math.max(1, options.surface.height - Math.max(0, start.y))
  );
  return {
    x: Math.min(Math.max(0, normalized.x), Math.max(0, options.surface.width - width)),
    y: Math.min(Math.max(0, normalized.y), Math.max(0, options.surface.height - height)),
    width,
    height
  };
}

function resolveButtonGeometryPath(
  start: ButtonRect,
  candidate: ButtonRect,
  otherRects: readonly ButtonRect[],
  resolver: (rect: ButtonRect) => ButtonGeometryResolution
): ButtonGeometryResolution {
  const conflictProgress = firstButtonPathConflictProgress(start, candidate, otherRects);
  const safeCandidate = conflictProgress === null
    ? candidate
    : interpolateButtonRect(start, candidate, conflictProgress);
  const direct = resolver(safeCandidate);
  if (
    direct.valid &&
    firstButtonPathConflictProgress(start, direct.rect, otherRects) === null
  ) return direct;

  let lower = 0;
  let upper = 1;
  let lastValid: ButtonGeometryResolution = {
    rect: start,
    valid: true,
    snappedX: false,
    snappedY: false,
    conflicts: []
  };

  for (let index = 0; index < 24; index += 1) {
    const middle = (lower + upper) / 2;
    const resolved = resolver(interpolateButtonRect(start, safeCandidate, middle));
    if (
      resolved.valid &&
      firstButtonPathConflictProgress(start, resolved.rect, otherRects) === null
    ) {
      lower = middle;
      lastValid = resolved;
    } else {
      upper = middle;
    }
  }
  return lastValid;
}

/**
 * Walks every pointer sample between the last valid rect and the new candidate.
 * This prevents a fast pointer from skipping the small edge-snap band or
 * tunnelling through another Button, and returns the furthest valid stop.
 */
export function resolveButtonGeometryAlongPath(
  start: ButtonRect,
  candidate: ButtonRect,
  options: ButtonSnapOptions
): ButtonGeometryResolution {
  const boundedCandidate = boundButtonPathCandidate(start, candidate, options);
  return resolveButtonGeometryPath(
    start,
    boundedCandidate,
    options.otherRects,
    (rect) => resolveButtonGeometry(rect, options)
  );
}

export function resolveAspectLockedButtonGeometryAlongPath(
  aspectStart: ButtonRect,
  pathStart: ButtonRect,
  candidate: ButtonRect,
  options: ButtonSnapOptions
): ButtonGeometryResolution {
  const boundedCandidate = boundButtonPathCandidate(pathStart, candidate, options);
  const locked = lockButtonRectAspect(
    aspectStart,
    boundedCandidate.width,
    boundedCandidate.height,
    options.gridSize
  );
  const projectedCandidate = { ...boundedCandidate, ...locked };
  return resolveButtonGeometryPath(
    pathStart,
    projectedCandidate,
    options.otherRects,
    (rect) => resolveAspectLockedButtonGeometry(aspectStart, rect, options)
  );
}

/**
 * Resolves the host-owned scale applied to the complete authored skin root.
 * Uniform sizing contains the natural core inside the requested footprint;
 * stretching permits each placement axis to scale independently.
 */
export function resolveButtonSkinScale(
  natural: Pick<ButtonRect, "width" | "height">,
  target: Pick<ButtonRect, "width" | "height">,
  allowStretching: boolean
): ButtonSkinScale {
  if (
    !Number.isFinite(natural.width) ||
    !Number.isFinite(natural.height) ||
    !Number.isFinite(target.width) ||
    !Number.isFinite(target.height) ||
    natural.width <= 0 ||
    natural.height <= 0 ||
    target.width <= 0 ||
    target.height <= 0
  ) {
    return { scaleX: 1, scaleY: 1 };
  }
  const scaleX = target.width / natural.width;
  const scaleY = target.height / natural.height;
  if (allowStretching) return { scaleX, scaleY };
  const uniformScale = Math.min(scaleX, scaleY);
  return { scaleX: uniformScale, scaleY: uniformScale };
}

export function resolveButtonRenderedCssScale(args: {
  renderedWidth: number;
  renderedHeight: number;
  layoutWidth: number;
  layoutHeight: number;
  fallback: ButtonSkinScale;
  conservativeUniform?: boolean;
  minimumUniformScale?: number;
}): ButtonSkinScale {
  const validFallbackX = Number.isFinite(args.fallback.scaleX) && args.fallback.scaleX > 0
    ? args.fallback.scaleX
    : 1;
  const validFallbackY = Number.isFinite(args.fallback.scaleY) && args.fallback.scaleY > 0
    ? args.fallback.scaleY
    : 1;
  const resolved = {
    scaleX:
      Number.isFinite(args.renderedWidth) &&
      Number.isFinite(args.layoutWidth) &&
      args.renderedWidth > 0 &&
      args.layoutWidth > 0
        ? args.renderedWidth / args.layoutWidth
        : validFallbackX,
    scaleY:
      Number.isFinite(args.renderedHeight) &&
      Number.isFinite(args.layoutHeight) &&
      args.renderedHeight > 0 &&
      args.layoutHeight > 0
        ? args.renderedHeight / args.layoutHeight
        : validFallbackY
  };
  if (!args.conservativeUniform) return resolved;
  const minimumUniformScale =
    Number.isFinite(args.minimumUniformScale) && (args.minimumUniformScale ?? 0) > 0
      ? args.minimumUniformScale!
      : 0;
  const commonScale = Math.max(
    resolved.scaleX,
    resolved.scaleY,
    minimumUniformScale
  );
  return { scaleX: commonScale, scaleY: commonScale };
}

export function resolveButtonShadowScreenOffsets(args: {
  offsetX: number;
  offsetY: number;
  blurExtent: number;
  spread: number;
  paintScale: ButtonSkinScale;
  conservativeDirections: boolean;
}): { left: number; top: number; right: number; bottom: number } {
  const scaleX = Number.isFinite(args.paintScale.scaleX) && args.paintScale.scaleX > 0
    ? args.paintScale.scaleX
    : 1;
  const scaleY = Number.isFinite(args.paintScale.scaleY) && args.paintScale.scaleY > 0
    ? args.paintScale.scaleY
    : 1;
  const effectExtent = Math.max(0, args.spread) + Math.max(0, args.blurExtent);
  if (args.conservativeDirections) {
    const commonScale = Math.max(scaleX, scaleY);
    const totalExtent = (
      Math.hypot(args.offsetX, args.offsetY) + effectExtent
    ) * commonScale;
    return {
      left: -totalExtent,
      top: -totalExtent,
      right: totalExtent,
      bottom: totalExtent
    };
  }
  return {
    left: (args.offsetX - effectExtent) * scaleX,
    top: (args.offsetY - effectExtent) * scaleY,
    right: (args.offsetX + effectExtent) * scaleX,
    bottom: (args.offsetY + effectExtent) * scaleY
  };
}

export function normalizeButtonScreenMeasurement(args: {
  coreRect: Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">;
  visualRect: Pick<DOMRect, "left" | "top" | "right" | "bottom">;
  hostScale: ButtonSkinScale;
}): ButtonCoreMeasurement {
  const scaleX = Number.isFinite(args.hostScale.scaleX) && args.hostScale.scaleX > 0
    ? args.hostScale.scaleX
    : 1;
  const scaleY = Number.isFinite(args.hostScale.scaleY) && args.hostScale.scaleY > 0
    ? args.hostScale.scaleY
    : 1;
  return {
    width: args.coreRect.width / scaleX,
    height: args.coreRect.height / scaleY,
    visualOverflow: {
      top: Math.max(0, args.coreRect.top - args.visualRect.top) / scaleY,
      right: Math.max(0, args.visualRect.right - args.coreRect.right) / scaleX,
      bottom: Math.max(0, args.visualRect.bottom - args.coreRect.bottom) / scaleY,
      left: Math.max(0, args.coreRect.left - args.visualRect.left) / scaleX
    }
  };
}

export function resolveButtonGeometry(
  candidate: ButtonRect,
  options: ButtonSnapOptions
): ButtonGeometryResolution {
  const normalized = normalizeButtonRect(candidate);
  const gridRect = {
    ...normalized,
    x: snapToGrid(normalized.x, options.gridSize),
    y: snapToGrid(normalized.y, options.gridSize),
    width: options.snapSize === false
      ? normalized.width
      : Math.max(1, snapToGrid(normalized.width, options.gridSize)),
    height: options.snapSize === false
      ? normalized.height
      : Math.max(1, snapToGrid(normalized.height, options.gridSize))
  };
  const dx = chooseClosestDelta(xSnapDeltas(gridRect, options), options.tolerance);
  const dy = chooseClosestDelta(ySnapDeltas(gridRect, options), options.tolerance);
  const rawCandidates = [
    { rect: candidateRect(gridRect, dx, dy), snappedX: dx !== 0, snappedY: dy !== 0 },
    { rect: candidateRect(gridRect, dx, 0), snappedX: dx !== 0, snappedY: false },
    { rect: candidateRect(gridRect, 0, dy), snappedX: false, snappedY: dy !== 0 },
    { rect: gridRect, snappedX: false, snappedY: false }
  ];

  for (const item of rawCandidates) {
    const rect = options.keepInsideSurface === false
      ? item.rect
      : clampButtonRectToSurface(item.rect, options.surface);
    const conflicts = findButtonRectConflicts(rect, options.otherRects);
    if (conflicts.length === 0 && (options.keepInsideSurface === false || isButtonRectInsideSurface(rect, options.surface))) {
      return { rect, valid: true, snappedX: item.snappedX, snappedY: item.snappedY, conflicts };
    }
  }

  const fallback = options.keepInsideSurface === false
    ? gridRect
    : clampButtonRectToSurface(gridRect, options.surface);
  return {
    rect: fallback,
    valid: false,
    snappedX: false,
    snappedY: false,
    conflicts: findButtonRectConflicts(fallback, options.otherRects)
  };
}

/**
 * Packs the supplied placement order into rows. Dimensions and input objects
 * remain untouched; z-index is normalized to the saved visual order. A supplied
 * row profile preserves the current visual wrap width and top offsets while
 * allowing variable-width Buttons to rebalance across rows; otherwise rows wrap
 * only at the surface width. Buttons close horizontal gaps inside each row. The
 * requested anchor is kept when the packed footprint fits there and is clamped
 * toward the surface origin when it does not.
 */
export function compactButtonPlacements(
  placements: readonly NamedButtonRect[],
  surface: Pick<ButtonRect, "width" | "height">,
  options: CompactButtonPlacementOptions = {}
): CompactButtonPlacementResult {
  const surfaceWidth = surface.width;
  const surfaceHeight = surface.height;
  if (
    !Number.isFinite(surfaceWidth) ||
    !Number.isFinite(surfaceHeight) ||
    surfaceWidth <= 0 ||
    surfaceHeight <= 0
  ) {
    return {
      success: false,
      placements: [],
      requiredWidth: 0,
      requiredHeight: 0,
      reason: "The Button surface must have positive finite dimensions."
    };
  }

  const gap = Number.isFinite(options.gap) ? Math.max(0, options.gap ?? 0) : 0;
  const rowTopOffsets = options.rowProfile
    ? [...options.rowProfile.topOffsets]
    : null;
  const profiledWrapWidth = options.rowProfile?.wrapWidth;
  if (
    options.rowProfile &&
    rowTopOffsets &&
    (
      !Number.isFinite(profiledWrapWidth) ||
      (placements.length > 0 && (profiledWrapWidth ?? 0) <= 0) ||
      (placements.length > 0 && rowTopOffsets.length === 0) ||
      rowTopOffsets.some((offset) => !Number.isFinite(offset) || offset < 0) ||
      rowTopOffsets.some((offset, index) => index > 0 && offset < rowTopOffsets[index - 1]) ||
      (rowTopOffsets.length > 0 && Math.abs(rowTopOffsets[0]) > EPSILON)
    )
  ) {
    return {
      success: false,
      placements: [],
      requiredWidth: 0,
      requiredHeight: 0,
      reason: "The Button row profile must contain a positive wrap width and ordered top offsets."
    };
  }
  const wrapWidth = options.rowProfile
    ? Math.min(surfaceWidth, Math.max(0, profiledWrapWidth ?? 0))
    : surfaceWidth;
  const packed: CompactButtonPlacement[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let rowIndex = 0;
  let requiredWidth = 0;
  let requiredHeight = 0;

  for (let index = 0; index < placements.length; index += 1) {
    const item = placements[index];
    const { width, height } = item.rect;
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return {
        success: false,
        placements: [],
        requiredWidth,
        requiredHeight,
        reason: `Button placement '${item.id}' must have positive finite dimensions.`
      };
    }
    if (width > surfaceWidth + EPSILON) {
      return {
        success: false,
        placements: [],
        requiredWidth: width,
        requiredHeight,
        reason: `Button placement '${item.id}' is wider than the selected surface.`
      };
    }
    const mustReserveRemainingRows = Boolean(
      rowTopOffsets &&
      x > EPSILON &&
      rowIndex < rowTopOffsets.length - 1 &&
      placements.length - index === rowTopOffsets.length - rowIndex - 1
    );
    if (
      x > EPSILON &&
      (x + width > wrapWidth + EPSILON || mustReserveRemainingRows)
    ) {
      const nextRowIndex = rowIndex + 1;
      x = 0;
      y = Math.max(
        y + rowHeight + gap,
        rowTopOffsets?.[nextRowIndex] ?? 0
      );
      rowHeight = 0;
      rowIndex = nextRowIndex;
    }
    if (y + height > surfaceHeight + EPSILON) {
      return {
        success: false,
        placements: [],
        requiredWidth,
        requiredHeight: y + height,
        reason: "The selected surface is not tall enough to compact every Button."
      };
    }

    packed.push({
      id: item.id,
      rect: { x, y, width, height },
      zIndex: index
    });
    x += width + gap;
    rowHeight = Math.max(rowHeight, height);
    requiredWidth = Math.max(requiredWidth, x - gap);
    requiredHeight = Math.max(requiredHeight, y + rowHeight);
  }

  const requestedAnchorX = Number.isFinite(options.anchorX)
    ? Math.max(0, options.anchorX ?? 0)
    : 0;
  const requestedAnchorY = Number.isFinite(options.anchorY)
    ? Math.max(0, options.anchorY ?? 0)
    : 0;
  const anchorX = Math.min(requestedAnchorX, Math.max(0, surfaceWidth - requiredWidth));
  const anchorY = Math.min(requestedAnchorY, Math.max(0, surfaceHeight - requiredHeight));

  return {
    success: true,
    placements: packed.map((item) => ({
      ...item,
      rect: {
        ...item.rect,
        x: item.rect.x + anchorX,
        y: item.rect.y + anchorY
      }
    })),
    requiredWidth,
    requiredHeight,
    reason: null
  };
}

/**
 * Packs an explicit row plan without ever moving a Button to another row.
 * This is the row-preserving contract used by Editor Snap and Re-order.
 */
export function compactButtonPlacementRows(
  rows: readonly ButtonPlacementRow[],
  surface: Pick<ButtonRect, "width" | "height">,
  options: CompactButtonPlacementRowsOptions = {}
): CompactButtonPlacementResult {
  if (
    !Number.isFinite(surface.width) ||
    !Number.isFinite(surface.height) ||
    surface.width <= 0 ||
    surface.height <= 0
  ) {
    return {
      success: false,
      placements: [],
      requiredWidth: 0,
      requiredHeight: 0,
      reason: "The Button surface must have positive finite dimensions."
    };
  }

  const gap = Number.isFinite(options.gap) ? Math.max(0, options.gap ?? 0) : 0;
  const preserveOffsets = options.preserveRowTopOffsets ?? true;
  const seen = new Set<string>();
  const packed: CompactButtonPlacement[] = [];
  let previousBottom = 0;
  let requiredWidth = 0;
  let requiredHeight = 0;
  let zIndex = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row.placements.length === 0) {
      return {
        success: false,
        placements: [],
        requiredWidth,
        requiredHeight,
        reason: "A Button row cannot be empty."
      };
    }
    if (
      row.topOffset !== null &&
      (!Number.isFinite(row.topOffset) || row.topOffset < 0)
    ) {
      return {
        success: false,
        placements: [],
        requiredWidth,
        requiredHeight,
        reason: "Button row offsets must be finite and non-negative."
      };
    }

    let rowWidth = 0;
    let rowHeight = 0;
    for (const placement of row.placements) {
      if (seen.has(placement.id)) {
        return {
          success: false,
          placements: [],
          requiredWidth,
          requiredHeight,
          reason: `Button placement '${placement.id}' appears in more than one row.`
        };
      }
      seen.add(placement.id);
      const { width, height } = placement.rect;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return {
          success: false,
          placements: [],
          requiredWidth,
          requiredHeight,
          reason: `Button placement '${placement.id}' must have positive finite dimensions.`
        };
      }
      rowWidth += (rowWidth > 0 ? gap : 0) + width;
      rowHeight = Math.max(rowHeight, height);
    }
    if (rowWidth > surface.width + EPSILON) {
      return {
        success: false,
        placements: [],
        requiredWidth: rowWidth,
        requiredHeight,
        reason: `Button row ${rowIndex + 1} is wider than the selected surface.`
      };
    }

    const minimumTop = rowIndex === 0 ? 0 : previousBottom + gap;
    const preferredTop = preserveOffsets && row.topOffset !== null
      ? row.topOffset
      : minimumTop;
    const y = Math.max(minimumTop, preferredTop);
    if (y + rowHeight > surface.height + EPSILON) {
      return {
        success: false,
        placements: [],
        requiredWidth: Math.max(requiredWidth, rowWidth),
        requiredHeight: y + rowHeight,
        reason: "The selected surface is not tall enough to preserve every Button row."
      };
    }

    let x = 0;
    for (const placement of row.placements) {
      packed.push({
        id: placement.id,
        rect: {
          x,
          y,
          width: placement.rect.width,
          height: placement.rect.height
        },
        zIndex
      });
      x += placement.rect.width + gap;
      zIndex += 1;
    }
    previousBottom = y + rowHeight;
    requiredWidth = Math.max(requiredWidth, rowWidth);
    requiredHeight = Math.max(requiredHeight, previousBottom);
  }

  const requestedAnchorX = Number.isFinite(options.anchorX)
    ? Math.max(0, options.anchorX ?? 0)
    : 0;
  const requestedAnchorY = Number.isFinite(options.anchorY)
    ? Math.max(0, options.anchorY ?? 0)
    : 0;
  const anchorX = Math.min(requestedAnchorX, Math.max(0, surface.width - requiredWidth));
  const anchorY = Math.min(requestedAnchorY, Math.max(0, surface.height - requiredHeight));

  return {
    success: true,
    placements: packed.map((placement) => ({
      ...placement,
      rect: {
        ...placement.rect,
        x: placement.rect.x + anchorX,
        y: placement.rect.y + anchorY
      }
    })),
    requiredWidth,
    requiredHeight,
    reason: null
  };
}

function rowHeight(row: ButtonPlacementRow): number {
  return Math.max(0, ...row.placements.map((placement) => placement.rect.height));
}

export function chooseButtonReorderRowCandidate(
  candidates: readonly ButtonReorderRowCandidate[],
  currentKey: string | null,
  hysteresisPx: number
): ButtonReorderRowCandidate | null {
  const best = [...candidates].sort((left, right) =>
    left.distance - right.distance ||
    (left.kind === "existing-row" ? 0 : 1) - (right.kind === "existing-row" ? 0 : 1) ||
    left.rowIndex - right.rowIndex ||
    left.columnIndex - right.columnIndex
  )[0] ?? null;
  if (!best || !currentKey || best.key === currentKey) return best;

  const sticky = candidates.find((candidate) => candidate.key === currentKey);
  if (!sticky || sticky.kind !== best.kind || sticky.rowIndex !== best.rowIndex) {
    return best;
  }

  const stickyCenterX = sticky.slot.x + sticky.slot.width / 2;
  const bestCenterX = best.slot.x + best.slot.width / 2;
  const targetSpacing = Math.abs(stickyCenterX - bestCenterX);
  const effectiveHysteresis = Math.min(
    Math.max(0, hysteresisPx),
    targetSpacing / 4
  );
  return sticky.distance <= best.distance + effectiveHysteresis ? sticky : best;
}

/**
 * Enumerates every insertion slot in every existing row plus an explicit
 * singleton row at each row boundary. Candidate identity stays row-aware so a
 * row end can never collapse into the next row's first slot.
 */
export function buildButtonReorderRowCandidates(args: {
  placements: readonly NamedButtonRect[];
  movingPlacementId: string;
  movingRect: ButtonRect;
  surface: Pick<ButtonRect, "width" | "height">;
  gap?: number;
}): ButtonReorderRowCandidateResult {
  const movingPlacement = args.placements.find((placement) => placement.id === args.movingPlacementId);
  if (!movingPlacement) {
    return { candidates: [], reason: "The dragged Button placement no longer exists." };
  }
  const inferredRows = inferButtonPlacementRows(args.placements);
  const remainingRows = inferredRows
    .map((row) => ({
      ...row,
      placements: row.placements.filter((placement) => placement.id !== args.movingPlacementId)
    }))
    .filter((row) => row.placements.length > 0);
  const firstOffset = remainingRows[0]?.topOffset ?? 0;
  const baseRows: ButtonPlacementRow[] = remainingRows.map((row) => ({
    placements: row.placements,
    topOffset: row.topOffset === null ? null : Math.max(0, row.topOffset - firstOffset)
  }));
  const anchorX = Math.min(...args.placements.map((placement) => placement.rect.x));
  const anchorY = Math.min(...args.placements.map((placement) => placement.rect.y));
  const movingCenterX = args.movingRect.x + args.movingRect.width / 2;
  const movingCenterY = args.movingRect.y + args.movingRect.height / 2;
  const gap = Number.isFinite(args.gap) ? Math.max(0, args.gap ?? 0) : 0;
  const candidates: ButtonReorderRowCandidate[] = [];
  let reason: string | null = null;

  const appendCandidate = (
    rows: ButtonPlacementRow[],
    kind: ButtonReorderRowCandidateKind,
    targetRowIndex: number,
    columnIndex: number,
    targetY: number
  ) => {
    const compacted = compactButtonPlacementRows(rows, args.surface, {
      anchorX,
      anchorY,
      gap,
      preserveRowTopOffsets: true
    });
    if (!compacted.success) {
      reason = compacted.reason;
      return;
    }
    const slot = compacted.placements.find((placement) => placement.id === args.movingPlacementId)?.rect;
    if (!slot) return;
    candidates.push({
      key: `${kind}:${targetRowIndex}:${columnIndex}`,
      kind,
      rowIndex: targetRowIndex,
      columnIndex,
      orderedPlacementIds: rows.flatMap((row) => row.placements.map((placement) => placement.id)),
      placements: compacted.placements,
      slot,
      distance: Math.hypot(
        movingCenterX - (slot.x + slot.width / 2),
        movingCenterY - targetY
      )
    });
  };

  for (let rowIndex = 0; rowIndex < baseRows.length; rowIndex += 1) {
    const row = baseRows[rowIndex];
    const targetY = anchorY + (row.topOffset ?? 0) + rowHeight(row) / 2;
    for (let columnIndex = 0; columnIndex <= row.placements.length; columnIndex += 1) {
      const rows = baseRows.map((candidate) => ({
        placements: [...candidate.placements],
        topOffset: candidate.topOffset
      }));
      rows[rowIndex].placements.splice(columnIndex, 0, movingPlacement);
      appendCandidate(rows, "existing-row", rowIndex, columnIndex, targetY);
    }
  }

  for (let boundaryIndex = 0; boundaryIndex <= baseRows.length; boundaryIndex += 1) {
    const previous = baseRows[boundaryIndex - 1];
    const next = baseRows[boundaryIndex];
    const previousBottom = previous
      ? (previous.topOffset ?? 0) + rowHeight(previous)
      : 0;
    const nextTop = next?.topOffset ?? previousBottom;
    const preferredTop = next ? nextTop : previousBottom + (previous ? gap : 0);
    const targetY = anchorY + (previous && next
      ? (previousBottom + nextTop) / 2
      : previous
        ? previousBottom + args.movingRect.height / 2
        : Math.max(0, nextTop - args.movingRect.height / 2));
    const rows = baseRows.map((row) => ({
      placements: [...row.placements],
      topOffset: row.topOffset
    }));
    rows.splice(boundaryIndex, 0, {
      placements: [movingPlacement],
      topOffset: preferredTop
    });
    appendCandidate(rows, "new-row", boundaryIndex, 0, targetY);
  }

  return {
    candidates,
    reason: candidates.length > 0 ? null : reason
  };
}

/**
 * Gives every placement the requested host-owned size, then packs the result
 * without moving any placement outside its current visual row or mutating the
 * input. The caller can apply the returned geometry in one transaction only
 * after every preserved row is known to fit.
 */
export function compactUniformButtonPlacements(
  placements: readonly NamedButtonRect[],
  targetSize: Pick<ButtonRect, "width" | "height">,
  surface: Pick<ButtonRect, "width" | "height">,
  options: CompactButtonPlacementOptions = {}
): CompactButtonPlacementResult {
  const resizedById = new Map(placements.map((placement) => [
    placement.id,
    {
      ...placement,
      rect: {
        ...placement.rect,
        width: targetSize.width,
        height: targetSize.height
      }
    }
  ]));
  const rows = inferButtonPlacementRows(placements).map((row) => ({
    ...row,
    placements: row.placements.map((placement) => resizedById.get(placement.id)!)
  }));
  return compactButtonPlacementRows(rows, surface, options);
}

export function createStarterButtonLayout(
  items: readonly StarterLayoutItem[],
  options: { padding: number; gap: number; maximumColumns?: number }
): StarterLayoutResult {
  const maximumColumns = Math.max(1, Math.floor(options.maximumColumns ?? 4));
  const padding = Math.max(0, options.padding);
  const gap = Math.max(0, options.gap);
  const rects: Record<string, ButtonRect> = {};
  let y = padding;
  let requiredWidth = padding * 2;

  for (let rowStart = 0; rowStart < items.length; rowStart += maximumColumns) {
    const row = items.slice(rowStart, rowStart + maximumColumns);
    const rowHeight = Math.max(0, ...row.map((item) => Math.max(1, item.height)));
    let x = padding;
    for (const item of row) {
      const width = Math.max(1, item.width);
      const height = Math.max(1, item.height);
      rects[item.id] = { x, y, width, height };
      x += width + gap;
    }
    requiredWidth = Math.max(requiredWidth, x - (row.length > 0 ? gap : 0) + padding);
    y += rowHeight + gap;
  }

  const requiredHeight = items.length === 0 ? padding * 2 : y - gap + padding;
  return { rects, requiredWidth, requiredHeight };
}

export function hasAnyButtonGeometryOverlap(rects: readonly ButtonRect[]): boolean {
  for (let left = 0; left < rects.length; left += 1) {
    for (let right = left + 1; right < rects.length; right += 1) {
      if (buttonRectsOverlap(rects[left], rects[right])) {
        return true;
      }
    }
  }
  return false;
}

export function validateExactButtonLayoutGeometry(
  placements: readonly NamedButtonRect[],
  surface: Pick<ButtonRect, "width" | "height">
): ButtonLayoutGeometryIssue[] {
  const issues: ButtonLayoutGeometryIssue[] = [];
  for (const placement of placements) {
    const rect = placement.rect;
    if (
      ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      issues.push({
        placementIds: [placement.id],
        message: `Placement '${placement.id}' must use finite geometry with positive dimensions.`
      });
      continue;
    }
    if (!isButtonRectInsideSurface(rect, surface)) {
      issues.push({
        placementIds: [placement.id],
        message: `Placement '${placement.id}' is outside the declared tool-set surface.`
      });
    }
  }
  for (let left = 0; left < placements.length; left += 1) {
    for (let right = left + 1; right < placements.length; right += 1) {
      if (buttonRectsOverlap(placements[left].rect, placements[right].rect)) {
        issues.push({
          placementIds: [placements[left].id, placements[right].id],
          message: `Placements '${placements[left].id}' and '${placements[right].id}' overlap.`
        });
      }
    }
  }
  return issues;
}

export function findFirstAvailableButtonPosition(args: {
  width: number;
  height: number;
  surface: Pick<ButtonRect, "width" | "height">;
  otherRects: readonly ButtonRect[];
  padding: number;
  gap: number;
  gridSize: number;
}): ButtonRect | null {
  const width = Math.max(1, snapToGrid(args.width, args.gridSize));
  const height = Math.max(1, snapToGrid(args.height, args.gridSize));
  const stepX = Math.max(args.gridSize, width + args.gap);
  const stepY = Math.max(args.gridSize, height + args.gap);
  for (let y = args.padding; y + height <= args.surface.height; y += stepY) {
    for (let x = args.padding; x + width <= args.surface.width; x += stepX) {
      const rect = {
        x: snapToGrid(x, args.gridSize),
        y: snapToGrid(y, args.gridSize),
        width,
        height
      };
      if (!args.otherRects.some((other) => buttonRectsOverlap(rect, other))) return rect;
    }
  }
  return null;
}
