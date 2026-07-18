import type { FlowCellBounds } from "../../types.js";
import type {
  ButtonCoreMeasurement,
  ButtonDesktopBounds,
  ButtonPlacement,
  ButtonRect,
  ButtonVisualState,
  ButtonWindowFitMode
} from "../types.js";

export type ButtonWindowResizeCorner =
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

export interface ButtonWindowPoint {
  x: number;
  y: number;
}

const WINDOWS_MINIMIZED_SENTINEL_COORDINATE = -30_000;

export function isUsableButtonWindowBounds(
  bounds: FlowCellBounds | null | undefined
): bounds is FlowCellBounds {
  return Boolean(
    bounds &&
      Number.isFinite(bounds.Left) &&
      Number.isFinite(bounds.Top) &&
      Number.isFinite(bounds.Width) &&
      Number.isFinite(bounds.Height) &&
      bounds.Width > 0 &&
      bounds.Height > 0 &&
      !(
        bounds.Left <= WINDOWS_MINIMIZED_SENTINEL_COORDINATE &&
        bounds.Top <= WINDOWS_MINIMIZED_SENTINEL_COORDINATE
      )
  );
}

export interface ButtonCanvasMetrics {
  left: number;
  top: number;
  scaleFactor: number;
}

const EMPTY_RECT: ButtonRect = { x: 0, y: 0, width: 1, height: 1 };

export function resolveButtonWebviewPixelRatio(
  nativeScaleFactor: number | undefined,
  devicePixelRatio: number | null | undefined
): number {
  const nativeScale = positiveOr(nativeScaleFactor, 1);
  return typeof devicePixelRatio === "number"
    ? positiveOr(devicePixelRatio, nativeScale)
    : nativeScale;
}

export function resolveTargetButtonWebviewPixelRatio(
  currentNativeScaleFactor: number | undefined,
  currentDevicePixelRatio: number | null | undefined,
  targetNativeScaleFactor: number | undefined
): number {
  const currentNativeScale = positiveOr(currentNativeScaleFactor, 1);
  const currentWebviewRatio = resolveButtonWebviewPixelRatio(
    currentNativeScale,
    currentDevicePixelRatio
  );
  const webviewScaleMultiplier = currentWebviewRatio / currentNativeScale;
  return positiveOr(targetNativeScaleFactor, currentNativeScale) * webviewScaleMultiplier;
}

export function resolveButtonWindowClientPoint(
  pointer: ButtonWindowPoint,
  windowPosition: ButtonWindowPoint,
  nativeScaleFactor: number | undefined,
  devicePixelRatio: number | null | undefined
): ButtonWindowPoint {
  const pixelRatio = resolveButtonWebviewPixelRatio(nativeScaleFactor, devicePixelRatio);
  return {
    x: (pointer.x - windowPosition.x) / pixelRatio,
    y: (pointer.y - windowPosition.y) / pixelRatio
  };
}

export function buttonDesktopBoundsToCanvasRect(
  bounds: ButtonDesktopBounds | null | undefined,
  canvas: ButtonCanvasMetrics
): { left: number; top: number; width: number; height: number } | null {
  if (!bounds) return null;
  const scaleFactor = positiveOr(canvas.scaleFactor, 1);
  return {
    left: (bounds.left - canvas.left) / scaleFactor,
    top: (bounds.top - canvas.top) / scaleFactor,
    width: bounds.width / scaleFactor,
    height: bounds.height / scaleFactor
  };
}

export function translateButtonDesktopBounds(
  bounds: ButtonDesktopBounds,
  delta: ButtonWindowPoint
): ButtonDesktopBounds {
  return {
    ...bounds,
    left: bounds.left + delta.x,
    top: bounds.top + delta.y
  };
}

export function resolveFixedButtonCanvasBounds(
  contentBounds: FlowCellBounds,
  workArea: FlowCellBounds | null | undefined
): FlowCellBounds {
  if (!workArea) return { ...contentBounds };
  const left = Math.min(workArea.Left, contentBounds.Left);
  const top = Math.min(workArea.Top, contentBounds.Top);
  const right = Math.max(
    workArea.Left + workArea.Width,
    contentBounds.Left + contentBounds.Width
  );
  const bottom = Math.max(
    workArea.Top + workArea.Height,
    contentBounds.Top + contentBounds.Height
  );
  return {
    Left: left,
    Top: top,
    Width: right - left,
    Height: bottom - top
  };
}

export function buttonDesktopBoundsInsideCanvas(
  bounds: ButtonDesktopBounds,
  canvas: FlowCellBounds,
  tolerance = 0.5
): boolean {
  return (
    bounds.left >= canvas.Left - tolerance &&
    bounds.top >= canvas.Top - tolerance &&
    bounds.left + bounds.width <= canvas.Left + canvas.Width + tolerance &&
    bounds.top + bounds.height <= canvas.Top + canvas.Height + tolerance
  );
}

function isUsableRect(rect: ButtonRect | null | undefined): rect is ButtonRect {
  return Boolean(
    rect &&
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      rect.width > 0 &&
      rect.height > 0
  );
}

export function unionButtonWindowRects(
  rects: readonly (ButtonRect | null | undefined)[],
  fallback: ButtonRect = EMPTY_RECT
): ButtonRect {
  const usable = rects.filter(isUsableRect);
  if (usable.length === 0) return { ...fallback };
  const left = Math.min(...usable.map((rect) => rect.x));
  const top = Math.min(...usable.map((rect) => rect.y));
  const right = Math.max(...usable.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...usable.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function buttonWindowRectsEqual(
  left: ButtonRect | null | undefined,
  right: ButtonRect | null | undefined,
  tolerance = 0.05
): boolean {
  return Boolean(
    left &&
      right &&
      Math.abs(left.x - right.x) <= tolerance &&
      Math.abs(left.y - right.y) <= tolerance &&
      Math.abs(left.width - right.width) <= tolerance &&
      Math.abs(left.height - right.height) <= tolerance
  );
}

export function buttonWindowRectContainsPoint(
  rect: ButtonRect | null | undefined,
  point: ButtonWindowPoint,
  padding = 0
): boolean {
  if (!isUsableRect(rect)) return false;
  const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  return (
    point.x >= rect.x - safePadding &&
    point.x <= rect.x + rect.width + safePadding &&
    point.y >= rect.y - safePadding &&
    point.y <= rect.y + rect.height + safePadding
  );
}

export function shouldBypassButtonWindowGeometryTransition(
  currentEnvelope: ButtonRect | null | undefined,
  nextEnvelope: ButtonRect,
  pendingTransitionCount: number
): boolean {
  return pendingTransitionCount === 0 && buttonWindowRectsEqual(currentEnvelope, nextEnvelope);
}

export function measuredButtonVisualRect(
  placement: ButtonPlacement,
  measurement: ButtonCoreMeasurement | null | undefined
): ButtonRect {
  if (!measurement || measurement.width <= 0 || measurement.height <= 0) {
    return { x: placement.x, y: placement.y, width: placement.width, height: placement.height };
  }
  const scaleX = placement.width / measurement.width;
  const scaleY = placement.height / measurement.height;
  const left = Math.max(0, measurement.visualOverflow.left) * scaleX;
  const right = Math.max(0, measurement.visualOverflow.right) * scaleX;
  const top = Math.max(0, measurement.visualOverflow.top) * scaleY;
  const bottom = Math.max(0, measurement.visualOverflow.bottom) * scaleY;
  return {
    x: placement.x - left,
    y: placement.y - top,
    width: placement.width + left + right,
    height: placement.height + top + bottom
  };
}

function expandedRect(rect: ButtonRect, allowance: number): ButtonRect {
  const amount = Number.isFinite(allowance) ? Math.max(0, allowance) : 0;
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2
  };
}

export function buttonVisualStateNeedsWindowExpansion(
  state: ButtonVisualState | null | undefined
): boolean {
  return Boolean(state && (state.hovered || state.pressed || state.held || state.play));
}

export function resolveButtonWindowEnvelope(args: {
  mode: ButtonWindowFitMode;
  surfaceBounds: ButtonRect;
  placements: readonly ButtonPlacement[];
  idleMeasurements?: Readonly<Record<string, ButtonCoreMeasurement>>;
  currentMeasurements?: Readonly<Record<string, ButtonCoreMeasurement>>;
  visualStates?: Readonly<Record<string, ButtonVisualState>>;
  visualOverflowAllowance?: number;
  fixedRects?: readonly ButtonRect[];
}): { resting: ButtonRect; current: ButtonRect; transient: boolean } {
  const hitboxRects = [
    ...args.placements.map((placement) => ({
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height
    })),
    ...(args.fixedRects ?? [])
  ];
  const hitboxEnvelope = unionButtonWindowRects(hitboxRects, args.surfaceBounds);
  const visualEnvelope = unionButtonWindowRects([
    ...args.placements.map((placement) => measuredButtonVisualRect(
      placement,
      args.idleMeasurements?.[placement.id]
    )),
    ...(args.fixedRects ?? [])
  ], hitboxEnvelope);
  const resting = args.mode === "surface"
    ? { ...args.surfaceBounds }
    : args.mode === "hitbox"
      ? hitboxEnvelope
      : visualEnvelope;
  const activeRects = args.placements.flatMap((placement) => {
    if (!buttonVisualStateNeedsWindowExpansion(args.visualStates?.[placement.id])) {
      return [];
    }
    const coreRect = {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height
    };
    return [
      measuredButtonVisualRect(placement, args.currentMeasurements?.[placement.id]),
      expandedRect(coreRect, args.visualOverflowAllowance ?? 0)
    ];
  });
  if (activeRects.length === 0) {
    return { resting, current: resting, transient: false };
  }
  return {
    resting,
    current: unionButtonWindowRects([resting, ...activeRects], resting),
    transient: true
  };
}

export function resolvePhysicalButtonWindowEnvelopeBounds(args: {
  currentBounds: ButtonDesktopBounds;
  currentEnvelope: ButtonRect;
  nextEnvelope: ButtonRect;
  contentScale: number;
  scaleFactor: number;
}): ButtonDesktopBounds {
  const contentScale = positiveOr(args.contentScale, 1);
  const scaleFactor = positiveOr(args.scaleFactor, 1);
  const physicalPerDesignPixel = contentScale * scaleFactor;
  const surfaceLeft = args.currentBounds.left - args.currentEnvelope.x * physicalPerDesignPixel;
  const surfaceTop = args.currentBounds.top - args.currentEnvelope.y * physicalPerDesignPixel;
  const exactLeft = surfaceLeft + args.nextEnvelope.x * physicalPerDesignPixel;
  const exactTop = surfaceTop + args.nextEnvelope.y * physicalPerDesignPixel;
  const left = Math.floor(exactLeft);
  const top = Math.floor(exactTop);
  const right = Math.ceil(
    surfaceLeft + (args.nextEnvelope.x + args.nextEnvelope.width) * physicalPerDesignPixel
  );
  const bottom = Math.ceil(
    surfaceTop + (args.nextEnvelope.y + args.nextEnvelope.height) * physicalPerDesignPixel
  );
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

export function resolveInitialPhysicalButtonWindowEnvelopeBounds(args: {
  currentPosition: ButtonWindowPoint;
  nextEnvelope: ButtonRect;
  scaleFactor: number;
}): ButtonDesktopBounds {
  const scaleFactor = positiveOr(args.scaleFactor, 1);
  return {
    left: args.currentPosition.x,
    top: args.currentPosition.y,
    width: Math.max(1, Math.ceil(args.nextEnvelope.width * scaleFactor)),
    height: Math.max(1, Math.ceil(args.nextEnvelope.height * scaleFactor))
  };
}

export function resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin(args: {
  surfaceOrigin: ButtonWindowPoint;
  envelope: ButtonRect;
  contentScale: number;
  scaleFactor: number;
}): ButtonDesktopBounds {
  const physicalPerDesignPixel =
    positiveOr(args.contentScale, 1) * positiveOr(args.scaleFactor, 1);
  const exactLeft = args.surfaceOrigin.x + args.envelope.x * physicalPerDesignPixel;
  const exactTop = args.surfaceOrigin.y + args.envelope.y * physicalPerDesignPixel;
  const left = Math.floor(exactLeft);
  const top = Math.floor(exactTop);
  const right = Math.ceil(
    args.surfaceOrigin.x +
    (args.envelope.x + args.envelope.width) * physicalPerDesignPixel
  );
  const bottom = Math.ceil(
    args.surfaceOrigin.y +
    (args.envelope.y + args.envelope.height) * physicalPerDesignPixel
  );
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function positiveOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value! : fallback;
}

export function resolveUniformSurfaceScale(args: {
  viewportWidth: number;
  viewportHeight: number;
  surfaceWidth: number;
  surfaceHeight: number;
}): number {
  const viewportWidth = positiveOr(args.viewportWidth, 1);
  const viewportHeight = positiveOr(args.viewportHeight, 1);
  const surfaceWidth = positiveOr(args.surfaceWidth, 1);
  const surfaceHeight = positiveOr(args.surfaceHeight, 1);
  return Math.min(viewportWidth / surfaceWidth, viewportHeight / surfaceHeight);
}

export function resolveAspectLockedWindowBounds(args: {
  initialBounds: ButtonDesktopBounds;
  initialPointer: ButtonWindowPoint;
  pointer: ButtonWindowPoint;
  corner: ButtonWindowResizeCorner;
  minimumWidth?: number;
  minimumHeight?: number;
  minimumScale?: number;
}): ButtonDesktopBounds {
  const initialWidth = positiveOr(args.initialBounds.width, 1);
  const initialHeight = positiveOr(args.initialBounds.height, 1);
  const minimumWidth = positiveOr(args.minimumWidth, 120);
  const minimumHeight = positiveOr(args.minimumHeight, 50);
  const minimumScale = positiveOr(args.minimumScale, 0.35);
  const horizontalSign = args.corner.includes("East") ? 1 : -1;
  const verticalSign = args.corner.includes("South") ? 1 : -1;
  const proposedWidth = Math.max(
    minimumWidth,
    initialWidth + (args.pointer.x - args.initialPointer.x) * horizontalSign
  );
  const proposedHeight = Math.max(
    minimumHeight,
    initialHeight + (args.pointer.y - args.initialPointer.y) * verticalSign
  );
  const scale = Math.max(
    proposedWidth / initialWidth,
    proposedHeight / initialHeight,
    minimumScale
  );
  // Tauri applies these as physical desktop pixels. Round once here so every
  // queued resize uses stable bounds while the anchored corner stays exact.
  const width = Math.max(1, Math.round(initialWidth * scale));
  const height = Math.max(1, Math.round(initialHeight * scale));

  return {
    left: args.corner.includes("West")
      ? args.initialBounds.left + initialWidth - width
      : args.initialBounds.left,
    top: args.corner.includes("North")
      ? args.initialBounds.top + initialHeight - height
      : args.initialBounds.top,
    width,
    height
  };
}

export function resolveButtonFrameForScaleFactor(args: {
  bounds: ButtonDesktopBounds;
  envelope: ButtonRect;
  contentScale: number;
  scaleFactor: number;
  anchorCorner?: ButtonWindowResizeCorner;
}): ButtonDesktopBounds {
  const contentScale = positiveOr(args.contentScale, 1);
  const scaleFactor = positiveOr(args.scaleFactor, 1);
  const width = Math.max(1, Math.ceil(args.envelope.width * contentScale * scaleFactor));
  const height = Math.max(1, Math.ceil(args.envelope.height * contentScale * scaleFactor));
  const right = args.bounds.left + args.bounds.width;
  const bottom = args.bounds.top + args.bounds.height;

  switch (args.anchorCorner) {
    case "NorthEast":
      return { left: args.bounds.left, top: bottom - height, width, height };
    case "NorthWest":
      return { left: right - width, top: bottom - height, width, height };
    case "SouthWest":
      return { left: right - width, top: args.bounds.top, width, height };
    case "SouthEast":
    default:
      return { left: args.bounds.left, top: args.bounds.top, width, height };
  }
}

export function buttonDesktopBoundsFromFlowCellBounds(
  bounds: FlowCellBounds | null | undefined
): ButtonDesktopBounds | null {
  if (
    !bounds ||
    !Number.isFinite(bounds.Left) ||
    !Number.isFinite(bounds.Top) ||
    !Number.isFinite(bounds.Width) ||
    !Number.isFinite(bounds.Height) ||
    bounds.Width <= 0 ||
    bounds.Height <= 0
  ) {
    return null;
  }

  return {
    left: bounds.Left,
    top: bounds.Top,
    width: bounds.Width,
    height: bounds.Height
  };
}

export function resolveExpandedPopoutBounds(args: {
  collapsedOrigin: { x: number; y: number };
  canonicalBounds: ButtonRect;
  scaleFactor: number;
  authoritativeExpandedBounds?: ButtonDesktopBounds | null;
}): ButtonDesktopBounds {
  const scaleFactor = Number.isFinite(args.scaleFactor) && args.scaleFactor > 0
    ? args.scaleFactor
    : 1;
  const authoritative = args.authoritativeExpandedBounds;

  return {
    left: args.collapsedOrigin.x + args.canonicalBounds.x * scaleFactor,
    top: args.collapsedOrigin.y + args.canonicalBounds.y * scaleFactor,
    width: authoritative?.width ?? Math.max(
      1,
      Math.round(args.canonicalBounds.width * scaleFactor)
    ),
    height: authoritative?.height ?? Math.max(
      1,
      Math.round(args.canonicalBounds.height * scaleFactor)
    )
  };
}

export function physicalSurfaceSize(
  width: number,
  height: number,
  scaleFactor: number
): { width: number; height: number } {
  const normalizedScale = Number.isFinite(scaleFactor) && scaleFactor > 0
    ? scaleFactor
    : 1;
  return {
    width: Math.max(1, Math.round(width * normalizedScale)),
    height: Math.max(1, Math.round(height * normalizedScale))
  };
}

export function resolveMeasuredCollapsedButtonBounds(args: {
  anchor: ButtonDesktopBounds;
  measuredWidth: number;
  measuredHeight: number;
  scaleFactor: number;
}): ButtonDesktopBounds {
  const hasMeasuredWidth = Number.isFinite(args.measuredWidth) && args.measuredWidth > 0;
  const hasMeasuredHeight = Number.isFinite(args.measuredHeight) && args.measuredHeight > 0;
  const size = physicalSurfaceSize(
    hasMeasuredWidth ? args.measuredWidth : 1,
    hasMeasuredHeight ? args.measuredHeight : 1,
    args.scaleFactor
  );
  return {
    left: args.anchor.left,
    top: args.anchor.top,
    width: hasMeasuredWidth ? size.width : positiveOr(args.anchor.width, 1),
    height: hasMeasuredHeight ? size.height : positiveOr(args.anchor.height, 1)
  };
}

export function resolvePopoutBoundsAfterDrag(args: {
  liveWindowBounds: ButtonDesktopBounds;
  toolSetCollapsed: boolean;
  canonicalBounds: ButtonRect;
  scaleFactor: number;
  authoritativeExpandedBounds?: ButtonDesktopBounds | null;
  collapsedOrigin?: ButtonWindowPoint | null;
}): {
  desktopBounds: ButtonDesktopBounds;
  layoutSnapshotBounds: ButtonDesktopBounds;
} {
  if (!args.toolSetCollapsed) {
    return {
      desktopBounds: args.liveWindowBounds,
      layoutSnapshotBounds: args.liveWindowBounds
    };
  }

  return {
    desktopBounds: resolveExpandedPopoutBounds({
      collapsedOrigin: args.collapsedOrigin ?? {
        x: args.liveWindowBounds.left,
        y: args.liveWindowBounds.top
      },
      canonicalBounds: args.canonicalBounds,
      scaleFactor: args.scaleFactor,
      authoritativeExpandedBounds: args.authoritativeExpandedBounds
    }),
    layoutSnapshotBounds: args.liveWindowBounds
  };
}
