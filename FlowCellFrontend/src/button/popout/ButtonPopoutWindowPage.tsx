import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  cursorPosition,
  getCurrentWindow
} from "@tauri-apps/api/window";
import type { ButtonPopoutWindowContext } from "../../lib/windowContext";
import {
  writeRegisteredLayoutWindowButtonDisplayMode,
  writeRegisteredLayoutWindowSnapshotBounds
} from "../../lib/layoutSnapshots";
import {
  useNativeSpaceDragActive,
  waitForNativeWindowDragEnd
} from "../../lib/nativeKeyState";
import {
  publishButtonCommit,
  publishButtonDraft,
  publishButtonRestingWindowBounds
} from "../state/ButtonDraftBus";
import { saveButtonStateDocument } from "../state/ButtonStateRepository";
import type {
  ButtonCoreMeasurement,
  ButtonDesktopBounds,
  ButtonPlacement,
  ButtonPopoutUnit,
  ButtonRect,
  ButtonStateDocument,
  ButtonVisualMeasurement,
  ButtonVisualState
} from "../types";
import {
  applyCurrentButtonWindowPhysicalBounds,
  closeButtonPopoutWindow,
  listenForButtonWindowContextUpdates
} from "../windows/buttonWindows";
import {
  buttonDesktopBoundsFromFlowCellBounds,
  buttonVisualStateNeedsWindowExpansion,
  buttonWindowRectsEqual,
  resolveAspectLockedWindowBounds,
  resolveButtonWindowEnvelope,
  resolveExpandedPopoutBounds,
  resolveInitialPhysicalButtonWindowEnvelopeBounds,
  resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin,
  resolvePopoutBoundsAfterDrag,
  resolveUniformSurfaceScale,
  type ButtonWindowResizeCorner
} from "../windows/buttonWindowGeometry";
import { useButtonWindowDocument } from "../windows/useButtonWindowDocument";
import { useNativeButtonHitboxes } from "../windows/useNativeButtonHitboxes";
import {
  setButtonWindowGeometryTransitionActive,
  waitForAppliedButtonWindowRender,
  waitForButtonWindowHitTestTurn
} from "../windows/buttonWindowGeometryTransition";
import ButtonPopoutRenderer from "./ButtonPopoutRenderer";

function isUsableDesktopBounds(bounds: ButtonDesktopBounds | null | undefined): bounds is ButtonDesktopBounds {
  return Boolean(
    bounds &&
      Number.isFinite(bounds.left) &&
      Number.isFinite(bounds.top) &&
      Number.isFinite(bounds.width) &&
      Number.isFinite(bounds.height) &&
      bounds.width > 0 &&
      bounds.height > 0
  );
}

function measurementsEqual(
  left: ButtonCoreMeasurement | undefined,
  right: ButtonCoreMeasurement,
  tolerance = 0.05
): boolean {
  return Boolean(
    left &&
      Math.abs(left.width - right.width) <= tolerance &&
      Math.abs(left.height - right.height) <= tolerance &&
      Math.abs(left.visualOverflow.top - right.visualOverflow.top) <= tolerance &&
      Math.abs(left.visualOverflow.right - right.visualOverflow.right) <= tolerance &&
      Math.abs(left.visualOverflow.bottom - right.visualOverflow.bottom) <= tolerance &&
      Math.abs(left.visualOverflow.left - right.visualOverflow.left) <= tolerance
  );
}

function visualStatesEqual(left: ButtonVisualState | undefined, right: ButtonVisualState): boolean {
  return Boolean(left && Object.keys(right).every(
    (key) => left[key as keyof ButtonVisualState] === right[key as keyof ButtonVisualState]
  ));
}

type ButtonPopoutResizeSession = {
  corner: ButtonWindowResizeCorner;
  pointerId: number;
  fallbackPointerScale: number;
  initialPointer: { x: number; y: number };
  initialBounds: ButtonDesktopBounds;
};

const BUTTON_POPOUT_RESIZE_CORNERS: ReadonlyArray<{
  corner: ButtonWindowResizeCorner;
  modifier: string;
}> = [
  { corner: "NorthEast", modifier: "north-east" },
  { corner: "NorthWest", modifier: "north-west" },
  { corner: "SouthEast", modifier: "south-east" },
  { corner: "SouthWest", modifier: "south-west" }
];

export interface ButtonPopoutWindowPageProps {
  context: ButtonPopoutWindowContext;
}

export function ButtonPopoutWindowPage({ context }: ButtonPopoutWindowPageProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const collapsedOriginRef = useRef<{ x: number; y: number } | null>(null);
  const expandedBoundsRef = useRef<ButtonDesktopBounds | null>(null);
  const initializedUnitIdRef = useRef<string | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const resizeSessionRef = useRef<ButtonPopoutResizeSession | null>(null);
  const resizePollTimerRef = useRef<number | null>(null);
  const pendingResizeBoundsRef = useRef<ButtonDesktopBounds | null>(null);
  const resizeFlushPromiseRef = useRef<Promise<void> | null>(null);
  const resizeApplyErrorRef = useRef<unknown>(null);
  const contentScaleRef = useRef<number | null>(null);
  const surfaceOriginRef = useRef<{ x: number; y: number } | null>(null);
  const appliedEnvelopeRef = useRef<ButtonRect | null>(null);
  const restingEnvelopeFrameRef = useRef<{
    envelope: ButtonRect;
    bounds: ButtonDesktopBounds;
  } | null>(null);
  const pendingEnvelopeRef = useRef<ButtonRect | null>(null);
  const envelopeFlushPromiseRef = useRef<Promise<void> | null>(null);
  const nativeGeometryTransitionRef = useRef<Promise<void>>(Promise.resolve());
  const [activeContext, setActiveContext] = useState(context);
  const [displayMode, setDisplayMode] = useState(context.initialDisplayMode);
  const [renderedToolSetMode, setRenderedToolSetMode] = useState<"collapsed" | "expanded">("collapsed");
  const [pinned, setPinned] = useState(false);
  const [idleMeasurements, setIdleMeasurements] = useState<Record<string, ButtonCoreMeasurement>>({});
  const [currentMeasurements, setCurrentMeasurements] = useState<Record<string, ButtonCoreMeasurement>>({});
  const [visualStates, setVisualStates] = useState<Record<string, ButtonVisualState>>({});
  const [appliedEnvelope, setAppliedEnvelope] = useState<ButtonRect | null>(null);
  const [geometryRefreshToken, setGeometryRefreshToken] = useState(0);
  const [spaceKeyActive, setSpaceKeyActive] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight)
  }));
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const nativeSpaceKeyActive = useNativeSpaceDragActive();
  const spaceDragActive = spaceKeyActive || nativeSpaceKeyActive;
  const { document, loading, error } = useButtonWindowDocument(
    activeContext.draftSessionId
  );
  const unit = document?.popoutUnits[activeContext.popoutUnitId] ?? null;
  const expandedSurface = unit && document ? document.surfaces[unit.surfaceId] : null;
  const renderedDisplayMode = unit?.kind === "regular" ? "expanded" : renderedToolSetMode;
  const expandedGeometryPlacements = useMemo<ButtonPlacement[]>(() => {
    if (!unit || !document) return [];
    return (expandedSurface?.placementIds ?? [])
      .map((placementId) => document.placements[placementId])
      .filter((placement): placement is ButtonPlacement => Boolean(placement));
  }, [document, expandedSurface?.placementIds, unit]);
  const collapsedGeometryPlacements = useMemo<ButtonPlacement[]>(() => {
    if (!unit || !document || unit.kind !== "tool-set") return [];
    const source = Object.values(document.placements).find(
      (placement) => placement.buttonId === unit.ownerButtonId
    );
    if (!source) return [];
    return [{
      ...source,
      id: `button-window-owner-placement:${unit.ownerButtonId}`,
      surfaceId: `button-window-owner-surface:${unit.ownerButtonId}`,
      x: 0,
      y: 0,
      zIndex: 0
    }];
  }, [document, unit]);
  const geometryPlacements = renderedDisplayMode === "expanded"
    ? expandedGeometryPlacements
    : collapsedGeometryPlacements;
  const expandedGeometrySurfaceBounds = useMemo<ButtonRect>(() => ({
    x: 0,
    y: 0,
    width: expandedSurface?.width ?? 1,
    height: expandedSurface?.height ?? 1
  }), [expandedSurface]);
  const collapsedGeometrySurfaceBounds = useMemo<ButtonRect>(() => {
    const owner = collapsedGeometryPlacements[0];
    return { x: 0, y: 0, width: owner?.width ?? 1, height: owner?.height ?? 1 };
  }, [collapsedGeometryPlacements]);
  const geometrySurfaceBounds = renderedDisplayMode === "expanded"
    ? expandedGeometrySurfaceBounds
    : collapsedGeometrySurfaceBounds;
  const expandedWindowEnvelope = useMemo(() => resolveButtonWindowEnvelope({
    mode: unit?.windowFitMode ?? "surface",
    surfaceBounds: expandedGeometrySurfaceBounds,
    placements: expandedGeometryPlacements,
    idleMeasurements,
    currentMeasurements,
    visualStates,
    visualOverflowAllowance: expandedSurface?.visualOverflowAllowance ?? 0,
    fixedRects: unit?.kind === "tool-set" ? unit.fields : []
  }), [
    currentMeasurements,
    expandedSurface?.visualOverflowAllowance,
    expandedGeometryPlacements,
    expandedGeometrySurfaceBounds,
    idleMeasurements,
    unit,
    visualStates
  ]);
  const collapsedWindowEnvelope = useMemo(() => resolveButtonWindowEnvelope({
    mode: unit?.windowFitMode ?? "surface",
    surfaceBounds: collapsedGeometrySurfaceBounds,
    placements: collapsedGeometryPlacements,
    idleMeasurements,
    currentMeasurements,
    visualStates,
    visualOverflowAllowance: expandedSurface?.visualOverflowAllowance ?? 0
  }), [
    collapsedGeometryPlacements,
    collapsedGeometrySurfaceBounds,
    currentMeasurements,
    expandedSurface?.visualOverflowAllowance,
    idleMeasurements,
    unit?.windowFitMode,
    visualStates
  ]);
  const windowEnvelope = renderedDisplayMode === "expanded"
    ? expandedWindowEnvelope
    : collapsedWindowEnvelope;
  const storedExpandedWindowEnvelope = useMemo(() => resolveButtonWindowEnvelope({
    mode: unit?.desktopBoundsFitMode ?? "surface",
    surfaceBounds: expandedGeometrySurfaceBounds,
    placements: expandedGeometryPlacements,
    idleMeasurements,
    visualOverflowAllowance: 0,
    fixedRects: unit?.kind === "tool-set" ? unit.fields : []
  }), [
    expandedGeometryPlacements,
    expandedGeometrySurfaceBounds,
    idleMeasurements,
    unit
  ]);
  const storedCollapsedWindowEnvelope = useMemo(() => resolveButtonWindowEnvelope({
    mode: unit?.desktopBoundsFitMode ?? "surface",
    surfaceBounds: collapsedGeometrySurfaceBounds,
    placements: collapsedGeometryPlacements,
    idleMeasurements,
    visualOverflowAllowance: 0
  }), [
    collapsedGeometryPlacements,
    collapsedGeometrySurfaceBounds,
    idleMeasurements,
    unit?.desktopBoundsFitMode
  ]);
  const storedWindowEnvelope = renderedDisplayMode === "expanded"
    ? storedExpandedWindowEnvelope
    : storedCollapsedWindowEnvelope;
  const storedWindowEnvelopeRef = useRef(storedWindowEnvelope);
  storedWindowEnvelopeRef.current = storedWindowEnvelope;
  const viewportSurfaceScale = appliedEnvelope && (expandedSurface || geometryPlacements.length > 0)
    ? resolveUniformSurfaceScale({
        viewportWidth: viewportSize.width,
        viewportHeight: viewportSize.height,
        surfaceWidth: appliedEnvelope.width,
        surfaceHeight: appliedEnvelope.height
      })
    : 1;
  const surfaceScale = resizing
    ? viewportSurfaceScale
    : contentScaleRef.current ?? viewportSurfaceScale;
  const resizeHandlesVisible = Boolean(unit && renderedDisplayMode === "expanded");
  const unitRef = useRef<ButtonPopoutUnit | null>(unit);
  unitRef.current = unit;

  const syncViewportSize = useCallback(() => {
    const nextWidth = Math.max(1, window.innerWidth);
    const nextHeight = Math.max(1, window.innerHeight);
    setViewportSize((current) =>
      current.width === nextWidth && current.height === nextHeight
        ? current
        : { width: nextWidth, height: nextHeight }
    );
  }, []);

  const commitAppliedEnvelope = useCallback(async (
    envelope: ButtonRect,
    contentScaleOverride?: number,
    reanchorSurface = false,
    onRenderCommit?: () => void
  ) => {
    const currentWindow = getCurrentWindow();
    const [position, size, rawScaleFactor] = await Promise.all([
      currentWindow.outerPosition(),
      currentWindow.innerSize(),
      currentWindow.scaleFactor().catch(() => 1)
    ]);
    const scaleFactor = Number.isFinite(rawScaleFactor) && rawScaleFactor > 0
      ? rawScaleFactor
      : 1;
    const logicalWidth = size.width / scaleFactor;
    const logicalHeight = size.height / scaleFactor;
    const nextContentScale =
      typeof contentScaleOverride === "number" &&
      Number.isFinite(contentScaleOverride) &&
      contentScaleOverride > 0
        ? contentScaleOverride
        : resolveUniformSurfaceScale({
            viewportWidth: logicalWidth,
            viewportHeight: logicalHeight,
            surfaceWidth: envelope.width,
            surfaceHeight: envelope.height
          });
    contentScaleRef.current = nextContentScale;
    if (reanchorSurface || !surfaceOriginRef.current) {
      const physicalPerDesignPixel = nextContentScale * scaleFactor;
      surfaceOriginRef.current = {
        x: position.x - envelope.x * physicalPerDesignPixel,
        y: position.y - envelope.y * physicalPerDesignPixel
      };
    }
    appliedEnvelopeRef.current = envelope;
    setViewportSize({
      width: Math.max(1, logicalWidth),
      height: Math.max(1, logicalHeight)
    });
    onRenderCommit?.();
    setAppliedEnvelope(envelope);
  }, []);

  const scheduleNativeGeometryTransition = useCallback((work: () => Promise<void>) => {
    const transition = nativeGeometryTransitionRef.current
      .catch(() => {})
      .then(async () => {
        setButtonWindowGeometryTransitionActive(true);
        try {
          await work();
        } finally {
          await waitForAppliedButtonWindowRender();
          setButtonWindowGeometryTransitionActive(false);
          await waitForButtonWindowHitTestTurn();
        }
      });
    nativeGeometryTransitionRef.current = transition;
    return transition;
  }, []);

  const applyEnvelopeNow = useCallback(async (nextEnvelope: ButtonRect) => {
    const currentEnvelope = appliedEnvelopeRef.current;
    if (currentEnvelope && buttonWindowRectsEqual(currentEnvelope, nextEnvelope)) {
      appliedEnvelopeRef.current = nextEnvelope;
      setAppliedEnvelope((current) =>
        buttonWindowRectsEqual(current, nextEnvelope) ? current : nextEnvelope
      );
      return;
    }
    const currentWindow = getCurrentWindow();
    const [position, size, rawScaleFactor] = await Promise.all([
      currentWindow.outerPosition(),
      currentWindow.innerSize(),
      currentWindow.scaleFactor().catch(() => 1)
    ]);
    const scaleFactor = Number.isFinite(rawScaleFactor) && rawScaleFactor > 0
      ? rawScaleFactor
      : 1;
    if (!currentEnvelope) {
      const initialBounds = resolveInitialPhysicalButtonWindowEnvelopeBounds({
        currentPosition: position,
        nextEnvelope,
        scaleFactor
      });
      await applyCurrentButtonWindowPhysicalBounds({
        Left: initialBounds.left,
        Top: initialBounds.top,
        Width: initialBounds.width,
        Height: initialBounds.height
      });
      surfaceOriginRef.current = null;
      await commitAppliedEnvelope(nextEnvelope, 1, true);
      return;
    }
    const logicalWidth = size.width / scaleFactor;
    const logicalHeight = size.height / scaleFactor;
    const contentScale = contentScaleRef.current ?? resolveUniformSurfaceScale({
      viewportWidth: logicalWidth,
      viewportHeight: logicalHeight,
      surfaceWidth: currentEnvelope.width,
      surfaceHeight: currentEnvelope.height
    });
    contentScaleRef.current = contentScale;
    const physicalPerDesignPixel = contentScale * scaleFactor;
    const surfaceOrigin = surfaceOriginRef.current ?? {
      x: position.x - currentEnvelope.x * physicalPerDesignPixel,
      y: position.y - currentEnvelope.y * physicalPerDesignPixel
    };
    surfaceOriginRef.current = surfaceOrigin;
    const bounds = resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin({
      surfaceOrigin,
      envelope: nextEnvelope,
      contentScale,
      scaleFactor
    });
    await applyCurrentButtonWindowPhysicalBounds({
      Left: bounds.left,
      Top: bounds.top,
      Width: bounds.width,
      Height: bounds.height
    });
    await commitAppliedEnvelope(nextEnvelope, contentScale);
  }, [commitAppliedEnvelope]);

  const applyEnvelope = useCallback((nextEnvelope: ButtonRect) =>
    scheduleNativeGeometryTransition(() => applyEnvelopeNow(nextEnvelope)), [
    applyEnvelopeNow,
    scheduleNativeGeometryTransition
  ]);

  const flushEnvelope = useCallback((): Promise<void> => {
    if (envelopeFlushPromiseRef.current) return envelopeFlushPromiseRef.current;
    let flush: Promise<void>;
    flush = (async () => {
      while (pendingEnvelopeRef.current) {
        const next = pendingEnvelopeRef.current;
        pendingEnvelopeRef.current = null;
        await applyEnvelope(next);
      }
    })().finally(() => {
      if (envelopeFlushPromiseRef.current === flush) envelopeFlushPromiseRef.current = null;
    });
    envelopeFlushPromiseRef.current = flush;
    return flush;
  }, [applyEnvelope]);

  const queueEnvelope = useCallback((envelope: ButtonRect): Promise<void> => {
    pendingEnvelopeRef.current = envelope;
    return flushEnvelope();
  }, [flushEnvelope]);

  const preparePlacementVisualStateChange = useCallback(async (
    placementId: string,
    state: ButtonVisualState
  ) => {
    if (!unit || dragging || resizing) return;
    const preparedEnvelope = resolveButtonWindowEnvelope({
      mode: unit.windowFitMode ?? "surface",
      surfaceBounds: geometrySurfaceBounds,
      placements: geometryPlacements,
      idleMeasurements,
      currentMeasurements,
      visualStates: { ...visualStates, [placementId]: state },
      visualOverflowAllowance: expandedSurface?.visualOverflowAllowance ?? 0,
      fixedRects: renderedDisplayMode === "expanded" && unit.kind === "tool-set"
        ? unit.fields
        : []
    });
    try {
      await queueEnvelope(preparedEnvelope.current);
    } catch (geometryError) {
      setRuntimeError(
        geometryError instanceof Error ? geometryError.message : String(geometryError)
      );
      throw geometryError;
    }
  }, [
    currentMeasurements,
    dragging,
    expandedSurface?.visualOverflowAllowance,
    geometryPlacements,
    geometrySurfaceBounds,
    idleMeasurements,
    queueEnvelope,
    renderedDisplayMode,
    resizing,
    unit,
    visualStates
  ]);

  useEffect(() => {
    syncViewportSize();
    window.addEventListener("resize", syncViewportSize);
    return () => window.removeEventListener("resize", syncViewportSize);
  }, [syncViewportSize]);

  useEffect(() => {
    if (!unit) {
      return;
    }
    void getCurrentWindow().setResizable(false).catch((resizeModeError) => {
      setRuntimeError(
        resizeModeError instanceof Error ? resizeModeError.message : String(resizeModeError)
      );
    });
  }, [activeContext, unit?.id]);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    const unlistenPromise = listenForButtonWindowContextUpdates(
      currentWindow.label,
      async (nextContext) => {
        if (nextContext.kind !== "button-popout") {
          return;
        }
        const currentOwner = activeContext.ownerButtonId ?? activeContext.popoutUnitId;
        const nextOwner = nextContext.ownerButtonId ?? nextContext.popoutUnitId;
        if (currentOwner === nextOwner) {
          const currentUnit = unitRef.current;
          const restoredBounds = buttonDesktopBoundsFromFlowCellBounds(
            nextContext.restoreBounds ?? nextContext.initialBounds
          );
          if (currentUnit?.kind === "tool-set") {
            const currentWindow = getCurrentWindow();
            const [position, scaleFactor] = await Promise.all([
              currentWindow.outerPosition(),
              currentWindow.scaleFactor().catch(() => 1)
            ]);
            const physicalPosition = restoredBounds
              ? { x: restoredBounds.left, y: restoredBounds.top }
              : position;
            collapsedOriginRef.current =
              nextContext.initialDisplayMode === "expanded"
                ? {
                    x: physicalPosition.x - currentUnit.canonicalBounds.x * scaleFactor,
                    y: physicalPosition.y - currentUnit.canonicalBounds.y * scaleFactor
                  }
                : { x: physicalPosition.x, y: physicalPosition.y };
            expandedBoundsRef.current =
              nextContext.initialDisplayMode === "expanded" && restoredBounds
                ? restoredBounds
                : isUsableDesktopBounds(currentUnit.desktopBounds)
                  ? currentUnit.desktopBounds
                  : expandedBoundsRef.current;
            if (nextContext.initialDisplayMode === "collapsed") {
              expandedBoundsRef.current = resolveExpandedPopoutBounds({
                collapsedOrigin: collapsedOriginRef.current,
                canonicalBounds: currentUnit.canonicalBounds,
                scaleFactor,
                authoritativeExpandedBounds: expandedBoundsRef.current
              });
            }
            setGeometryRefreshToken((current) => current + 1);
          } else if (restoredBounds) {
            expandedBoundsRef.current = restoredBounds;
            const restoredEnvelope =
              currentUnit?.desktopBoundsEnvelope ?? storedWindowEnvelopeRef.current.resting;
            restingEnvelopeFrameRef.current = {
              envelope: restoredEnvelope,
              bounds: restoredBounds
            };
            await scheduleNativeGeometryTransition(async () => {
              await applyCurrentButtonWindowPhysicalBounds({
                Left: restoredBounds.left,
                Top: restoredBounds.top,
                Width: restoredBounds.width,
                Height: restoredBounds.height
              });
              surfaceOriginRef.current = null;
              await commitAppliedEnvelope(restoredEnvelope, undefined, true);
            });
          }
          setActiveContext(nextContext);
          setDisplayMode(nextContext.initialDisplayMode);
        }
      }
    );
    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [
    activeContext.ownerButtonId,
    activeContext.popoutUnitId,
    commitAppliedEnvelope,
    scheduleNativeGeometryTransition
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setSpaceKeyActive(true);
      }
      if (event.key === "Escape" && unit && !resizing) {
        if (unit.kind === "tool-set" && displayMode === "expanded") {
          setPinned(false);
          setDisplayMode("collapsed");
        } else if (unit.closeRule === "escape") {
          void closeButtonPopoutWindow({
            popoutUnitId: activeContext.popoutUnitId,
            ownerButtonId: activeContext.ownerButtonId
          });
        }
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setSpaceKeyActive(false);
      }
    };
    const handleBlur = () => setSpaceKeyActive(false);
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      window.removeEventListener("blur", handleBlur);
    };
  }, [activeContext.ownerButtonId, activeContext.popoutUnitId, displayMode, resizing, unit]);

  useEffect(() => {
    if (!unit || initializedUnitIdRef.current === unit.id) {
      return;
    }
    initializedUnitIdRef.current = unit.id;
    collapsedOriginRef.current = null;
    if (unit.kind === "tool-set") setRenderedToolSetMode("collapsed");
    const restoredBounds = buttonDesktopBoundsFromFlowCellBounds(
      activeContext.restoreBounds ?? activeContext.initialBounds
    );
    const initialExpandedBounds =
      activeContext.initialDisplayMode === "expanded" && restoredBounds
        ? restoredBounds
        : isUsableDesktopBounds(unit.desktopBounds)
          ? unit.desktopBounds
          : null;
    expandedBoundsRef.current = initialExpandedBounds;
    restingEnvelopeFrameRef.current = initialExpandedBounds
      ? {
          envelope: unit.desktopBoundsEnvelope ?? storedExpandedWindowEnvelope.resting,
          bounds: initialExpandedBounds
        }
      : null;
    setRuntimeError(null);
    setIdleMeasurements({});
    setCurrentMeasurements({});
    setVisualStates({});
    const initialAppliedEnvelope =
      activeContext.initialDisplayMode === "expanded" && initialExpandedBounds
      ? unit.desktopBoundsEnvelope ?? storedExpandedWindowEnvelope.resting
      : null;
    contentScaleRef.current = initialAppliedEnvelope ? null : 1;
    surfaceOriginRef.current = null;
    appliedEnvelopeRef.current = null;
    setAppliedEnvelope(null);
    setPinned(unit.pinnedDefault && activeContext.initialDisplayMode === "expanded");
    setDisplayMode(activeContext.initialDisplayMode);

    const initialization = scheduleNativeGeometryTransition(async () => {
      const currentWindow = getCurrentWindow();
      const initialWindowBounds =
        activeContext.initialDisplayMode === "expanded"
          ? initialExpandedBounds
          : restoredBounds;
      if (initialWindowBounds) {
        writeRegisteredLayoutWindowSnapshotBounds(currentWindow.label, {
          Left: initialWindowBounds.left,
          Top: initialWindowBounds.top,
          Width: initialWindowBounds.width,
          Height: initialWindowBounds.height
        });
        await applyCurrentButtonWindowPhysicalBounds({
          Left: initialWindowBounds.left,
          Top: initialWindowBounds.top,
          Width: initialWindowBounds.width,
          Height: initialWindowBounds.height
        });
        if (initialAppliedEnvelope) {
          surfaceOriginRef.current = null;
          await commitAppliedEnvelope(initialAppliedEnvelope, undefined, true);
          const synchronizedSurfaceOrigin = surfaceOriginRef.current as {
            x: number;
            y: number;
          } | null;
          if (unit.kind === "tool-set" && synchronizedSurfaceOrigin) {
            collapsedOriginRef.current = { ...synchronizedSurfaceOrigin };
          }
        } else {
          syncViewportSize();
        }
      }
      const [position, scaleFactor] = await Promise.all([
        currentWindow.outerPosition(),
        currentWindow.scaleFactor().catch(() => 1)
      ]);
      const physicalPosition = initialWindowBounds
        ? { x: initialWindowBounds.left, y: initialWindowBounds.top }
        : position;
      collapsedOriginRef.current =
        activeContext.initialDisplayMode === "expanded"
          ? {
              x: physicalPosition.x - unit.canonicalBounds.x * scaleFactor,
              y: physicalPosition.y - unit.canonicalBounds.y * scaleFactor
            }
          : { x: physicalPosition.x, y: physicalPosition.y };
      if (activeContext.initialDisplayMode === "collapsed") {
        expandedBoundsRef.current = resolveExpandedPopoutBounds({
          collapsedOrigin: collapsedOriginRef.current,
          canonicalBounds: unit.canonicalBounds,
          scaleFactor,
          authoritativeExpandedBounds: expandedBoundsRef.current
        });
      } else if (!expandedBoundsRef.current) {
        expandedBoundsRef.current = resolveExpandedPopoutBounds({
          collapsedOrigin: collapsedOriginRef.current,
          canonicalBounds: unit.canonicalBounds,
          scaleFactor
        });
      }
    });
    void initialization.catch((initializationError) => {
      setRuntimeError(
        initializationError instanceof Error
          ? initializationError.message
          : String(initializationError)
      );
    });
  }, [
    activeContext.initialDisplayMode,
    commitAppliedEnvelope,
    scheduleNativeGeometryTransition,
    storedExpandedWindowEnvelope.resting,
    syncViewportSize,
    unit
  ]);

  const ensureCollapsedOrigin = useCallback(
    async (currentMode: "collapsed" | "expanded") => {
      if (collapsedOriginRef.current) {
        return collapsedOriginRef.current;
      }
      if (currentMode === "expanded" && surfaceOriginRef.current) {
        collapsedOriginRef.current = { ...surfaceOriginRef.current };
        return collapsedOriginRef.current;
      }
      const currentWindow = getCurrentWindow();
      const [position, scaleFactor] = await Promise.all([
        currentWindow.outerPosition(),
        currentWindow.scaleFactor().catch(() => 1)
      ]);
      const origin =
        currentMode === "expanded" && unit
          ? {
              x: position.x - unit.canonicalBounds.x * scaleFactor,
              y: position.y - unit.canonicalBounds.y * scaleFactor
            }
          : {
              x: position.x -
                (appliedEnvelopeRef.current?.x ?? 0) *
                (contentScaleRef.current ?? 1) *
                scaleFactor,
              y: position.y -
                (appliedEnvelopeRef.current?.y ?? 0) *
                (contentScaleRef.current ?? 1) *
                scaleFactor
            };
      collapsedOriginRef.current = origin;
      return origin;
    },
    [unit]
  );

  const applyCollapsedGeometry = useCallback(async (
    collapsedEnvelope = collapsedWindowEnvelope.resting,
    onRenderCommit?: () => void
  ) => {
    const currentWindow = getCurrentWindow();
    const origin = await ensureCollapsedOrigin("collapsed");
    const rawScaleFactor = await currentWindow.scaleFactor().catch(() => 1);
    const scaleFactor = Number.isFinite(rawScaleFactor) && rawScaleFactor > 0
      ? rawScaleFactor
      : 1;
    const collapsedBounds = resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin({
      surfaceOrigin: origin,
      envelope: collapsedEnvelope,
      contentScale: 1,
      scaleFactor
    });
    surfaceOriginRef.current = origin;
    await applyCurrentButtonWindowPhysicalBounds({
      Left: collapsedBounds.left,
      Top: collapsedBounds.top,
      Width: collapsedBounds.width,
      Height: collapsedBounds.height
    });
    await commitAppliedEnvelope(collapsedEnvelope, 1, false, onRenderCommit);
  }, [collapsedWindowEnvelope.resting, commitAppliedEnvelope, ensureCollapsedOrigin]);

  const applyExpandedGeometry = useCallback(async (onRenderCommit?: () => void) => {
    if (!unit) {
      return;
    }
    const currentWindow = getCurrentWindow();
    const origin = await ensureCollapsedOrigin("expanded");
    const scaleFactor = await currentWindow.scaleFactor().catch(() => 1);
    const authoritativeExpandedBounds =
      expandedBoundsRef.current ??
      (isUsableDesktopBounds(unit.desktopBounds) ? unit.desktopBounds : null);
    const expandedBounds = authoritativeExpandedBounds ?? resolveExpandedPopoutBounds({
      collapsedOrigin: origin,
      canonicalBounds: unit.canonicalBounds,
      scaleFactor
    });
    expandedBoundsRef.current = expandedBounds;
    const expandedEnvelope =
      restingEnvelopeFrameRef.current?.envelope ??
      unit.desktopBoundsEnvelope ??
      expandedWindowEnvelope.resting;
    await applyCurrentButtonWindowPhysicalBounds({
      Left: expandedBounds.left,
      Top: expandedBounds.top,
      Width: expandedBounds.width,
      Height: expandedBounds.height
    });
    surfaceOriginRef.current = null;
    await commitAppliedEnvelope(expandedEnvelope, undefined, true, onRenderCommit);
    const synchronizedSurfaceOrigin = surfaceOriginRef.current as {
      x: number;
      y: number;
    } | null;
    if (synchronizedSurfaceOrigin) {
      collapsedOriginRef.current = { ...synchronizedSurfaceOrigin };
    }
  }, [commitAppliedEnvelope, ensureCollapsedOrigin, expandedWindowEnvelope.resting, unit]);

  useEffect(() => {
    writeRegisteredLayoutWindowButtonDisplayMode(getCurrentWindow().label, displayMode);
    if (!unit) {
      return;
    }
    // Regular Pops are already placed by the window opener; their envelope
    // effect is the sole geometry writer so an older full-surface placement
    // cannot race and overwrite a tighter fit. Tool Sets still need explicit
    // collapsed/expanded placement around their owner.
    if (unit.kind === "regular" || dragging) {
      return;
    }
    let cancelled = false;
    pendingEnvelopeRef.current = null;
    const transition = scheduleNativeGeometryTransition(async () => {
      if (displayMode === "expanded") {
        await applyExpandedGeometry(() => {
          if (!cancelled) setRenderedToolSetMode("expanded");
        });
      } else {
        setRenderedToolSetMode("collapsed");
        await waitForAppliedButtonWindowRender();
        if (cancelled) return;
        await applyCollapsedGeometry(collapsedWindowEnvelope.resting);
      }
    });
    void transition.catch((geometryError) => {
      setRuntimeError(
        geometryError instanceof Error ? geometryError.message : String(geometryError)
      );
    });
    return () => {
      cancelled = true;
    };
  }, [
    displayMode,
    dragging,
    geometryRefreshToken,
    scheduleNativeGeometryTransition,
    unit?.id
  ]);

  useEffect(() => {
    if (
      !unit ||
      unit.kind !== "tool-set" ||
      displayMode !== "collapsed" ||
      renderedDisplayMode !== "collapsed" ||
      dragging ||
      resizing
    ) return;
    let cancelled = false;
    void queueEnvelope(collapsedWindowEnvelope.current).catch((geometryError) => {
      if (cancelled) return;
      setRuntimeError(
        geometryError instanceof Error ? geometryError.message : String(geometryError)
      );
    });
    return () => {
      cancelled = true;
    };
  }, [
    collapsedWindowEnvelope.current,
    displayMode,
    dragging,
    queueEnvelope,
    renderedDisplayMode,
    resizing,
    unit?.id
  ]);

  useEffect(() => {
    if (
      !unit ||
      renderedDisplayMode !== "expanded" ||
      (unit.kind === "tool-set" && displayMode !== renderedDisplayMode) ||
      dragging ||
      resizing
    ) return;
    let cancelled = false;
    const savedRestingFrame = restingEnvelopeFrameRef.current;
    const restoreSavedRestingFrame =
      !windowEnvelope.transient &&
      savedRestingFrame &&
      buttonWindowRectsEqual(savedRestingFrame.envelope, windowEnvelope.resting);
    const applyTarget = restoreSavedRestingFrame && savedRestingFrame
      ? (() => {
        pendingEnvelopeRef.current = null;
        return scheduleNativeGeometryTransition(async () => {
        if (cancelled) return;
        await applyCurrentButtonWindowPhysicalBounds({
          Left: savedRestingFrame.bounds.left,
          Top: savedRestingFrame.bounds.top,
          Width: savedRestingFrame.bounds.width,
          Height: savedRestingFrame.bounds.height
        });
        await commitAppliedEnvelope(
          windowEnvelope.resting,
          contentScaleRef.current ?? undefined,
          true
        );
        if (unit.kind === "tool-set" && surfaceOriginRef.current) {
          collapsedOriginRef.current = { ...surfaceOriginRef.current };
        }
        });
      })()
      : queueEnvelope(windowEnvelope.current);
    void applyTarget
      .then(async () => {
        if (
          cancelled ||
          windowEnvelope.transient ||
          !buttonWindowRectsEqual(appliedEnvelopeRef.current, windowEnvelope.resting)
        ) return;
        const currentWindow = getCurrentWindow();
        const [position, size] = await Promise.all([
          currentWindow.outerPosition(),
          currentWindow.innerSize()
        ]);
        if (
          cancelled ||
          !buttonWindowRectsEqual(appliedEnvelopeRef.current, windowEnvelope.resting)
        ) return;
        const restingBounds = {
          left: position.x,
          top: position.y,
          width: size.width,
          height: size.height
        };
        expandedBoundsRef.current = restingBounds;
        restingEnvelopeFrameRef.current = {
          envelope: windowEnvelope.resting,
          bounds: restingBounds
        };
        writeRegisteredLayoutWindowSnapshotBounds(currentWindow.label, {
          Left: position.x,
          Top: position.y,
          Width: size.width,
          Height: size.height
        });
        if (activeContext.draftSessionId) {
          await publishButtonRestingWindowBounds(activeContext.draftSessionId, {
            kind: "popout",
            popoutUnitId: unit.id,
            fitMode: unit.windowFitMode ?? "surface",
            bounds: {
              left: position.x,
              top: position.y,
              width: size.width,
              height: size.height
            },
            envelope: windowEnvelope.resting
          });
        }
      })
      .catch((geometryError) => {
        if (cancelled) return;
        setRuntimeError(
          geometryError instanceof Error ? geometryError.message : String(geometryError)
        );
      });
    return () => {
      cancelled = true;
    };
  }, [
    dragging,
    displayMode,
    queueEnvelope,
    renderedDisplayMode,
    resizing,
    scheduleNativeGeometryTransition,
    unit,
    windowEnvelope.current,
    windowEnvelope.resting,
    windowEnvelope.transient,
    activeContext.draftSessionId,
    commitAppliedEnvelope,
    syncViewportSize
  ]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
      if (resizePollTimerRef.current !== null) {
        window.clearInterval(resizePollTimerRef.current);
      }
      resizeSessionRef.current = null;
      pendingResizeBoundsRef.current = null;
    };
  }, []);

  const handleNativeHoverChange = useCallback(
    (hovered: boolean) => {
      if (!unit || dragging || resizing || spaceDragActive) {
        return;
      }
      if (!hovered) {
        setVisualStates((current) => Object.fromEntries(
          Object.entries(current).map(([placementId, state]) => [placementId, {
            ...state,
            hovered: false,
            pressed: false,
            held: false,
            play: false
          }])
        ));
      }
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      if (
        unit.kind === "tool-set" &&
        hovered &&
        unit.openRule === "hover" &&
        displayMode === "collapsed"
      ) {
        setDisplayMode("expanded");
        return;
      }
      if (
        unit.kind === "regular" &&
        !hovered &&
        !pinned &&
        unit.closeRule === "hover-out"
      ) {
        closeTimerRef.current = window.setTimeout(() => {
          closeTimerRef.current = null;
          void closeButtonPopoutWindow({
            popoutUnitId: activeContext.popoutUnitId,
            ownerButtonId: activeContext.ownerButtonId
          });
        }, 140);
        return;
      }
      if (
        !hovered &&
        displayMode === "expanded" &&
        !pinned &&
        unit.closeRule === "hover-out"
      ) {
        closeTimerRef.current = window.setTimeout(() => {
          closeTimerRef.current = null;
          setDisplayMode("collapsed");
        }, 140);
      }
    },
    [
      activeContext.ownerButtonId,
      activeContext.popoutUnitId,
      displayMode,
      dragging,
      pinned,
      resizing,
      spaceDragActive,
      unit
    ]
  );

  useNativeButtonHitboxes({
    rootRef,
    enabled: !dragging && !resizing,
    geometryKey: `${activeContext.popoutUnitId}:${renderedDisplayMode}:${unit?.windowFitMode ?? "surface"}:${appliedEnvelope?.x ?? "pending"}:${appliedEnvelope?.y ?? "pending"}:${appliedEnvelope?.width ?? "pending"}:${appliedEnvelope?.height ?? "pending"}`,
    onHoverChange: handleNativeHoverChange
  });

  const handleOwnerActivate = useCallback(() => {
    if (!unit || unit.kind !== "tool-set") {
      return;
    }
    if (displayMode === "expanded") {
      if (pinned) {
        setPinned(false);
        setDisplayMode("collapsed");
      } else {
        setPinned(true);
      }
      return;
    }
    setPinned(true);
    setDisplayMode("expanded");
  }, [displayMode, pinned, unit]);

  const persistPopoutBounds = useCallback(async (
    persistedMode: "collapsed" | "expanded" = displayMode
  ) => {
    if (!document || !unit) {
      return;
    }
    const currentWindow = getCurrentWindow();
    const [position, size, rawScaleFactor] = await Promise.all([
      currentWindow.outerPosition(),
      currentWindow.innerSize(),
      currentWindow.scaleFactor().catch(() => 1)
    ]);
    const scaleFactor = Number.isFinite(rawScaleFactor) && rawScaleFactor > 0
      ? rawScaleFactor
      : 1;
    const liveBounds: ButtonDesktopBounds = {
      left: position.x,
      top: position.y,
      width: size.width,
      height: size.height
    };
    const toolSetCollapsed = unit.kind === "tool-set" && persistedMode === "collapsed";
    const appliedWindowEnvelope = appliedEnvelopeRef.current ?? windowEnvelope.resting;
    const physicalPerDesignPixel = (contentScaleRef.current ?? 1) * scaleFactor;
    const liveSurfaceOrigin = {
      x: position.x - appliedWindowEnvelope.x * physicalPerDesignPixel,
      y: position.y - appliedWindowEnvelope.y * physicalPerDesignPixel
    };
    surfaceOriginRef.current = liveSurfaceOrigin;
    const collapsedOrigin = toolSetCollapsed ? liveSurfaceOrigin : null;
    const resolvedBounds = resolvePopoutBoundsAfterDrag({
      liveWindowBounds: liveBounds,
      toolSetCollapsed,
      canonicalBounds: unit.canonicalBounds,
      scaleFactor,
      authoritativeExpandedBounds:
        expandedBoundsRef.current ??
        (isUsableDesktopBounds(unit.desktopBounds) ? unit.desktopBounds : null),
      collapsedOrigin
    });
    const nextBounds = resolvedBounds.desktopBounds;
    const snapshotBounds = resolvedBounds.layoutSnapshotBounds;
    const persistedEnvelope = toolSetCollapsed
      ? restingEnvelopeFrameRef.current?.envelope ??
        unit.desktopBoundsEnvelope ??
        {
          x: 0,
          y: 0,
          width: expandedSurface?.width ?? unit.canonicalBounds.width,
          height: expandedSurface?.height ?? unit.canonicalBounds.height
        }
      : windowEnvelope.resting;
    if (unit.kind === "tool-set") {
      collapsedOriginRef.current = toolSetCollapsed
        ? collapsedOrigin
        : liveSurfaceOrigin;
    }
    if (!toolSetCollapsed) {
      contentScaleRef.current = resolveUniformSurfaceScale({
        viewportWidth: liveBounds.width / scaleFactor,
        viewportHeight: liveBounds.height / scaleFactor,
        surfaceWidth: windowEnvelope.resting.width,
        surfaceHeight: windowEnvelope.resting.height
      });
    }
    expandedBoundsRef.current = nextBounds;
    restingEnvelopeFrameRef.current = {
      envelope: persistedEnvelope,
      bounds: nextBounds
    };

    const nextDocument: ButtonStateDocument = {
      ...document,
      popoutUnits: {
        ...document.popoutUnits,
        [unit.id]: {
          ...unit,
          desktopBounds: nextBounds,
          desktopBoundsFitMode: unit.windowFitMode ?? "surface",
          desktopBoundsEnvelope: persistedEnvelope
        }
      }
    };
    writeRegisteredLayoutWindowSnapshotBounds(currentWindow.label, {
      Left: snapshotBounds.left,
      Top: snapshotBounds.top,
      Width: snapshotBounds.width,
      Height: snapshotBounds.height
    });
    if (activeContext.draftSessionId) {
      await publishButtonRestingWindowBounds(activeContext.draftSessionId, {
        kind: "popout",
        popoutUnitId: unit.id,
        fitMode: unit.windowFitMode ?? "surface",
        bounds: nextBounds,
        envelope: persistedEnvelope
      });
      await publishButtonDraft(activeContext.draftSessionId, nextDocument);
      return;
    }
    const saved = await saveButtonStateDocument(nextDocument, document.revision);
    await publishButtonCommit(saved);
  }, [
    activeContext.draftSessionId,
    displayMode,
    document,
    expandedSurface,
    unit,
    windowEnvelope.resting
  ]);

  function flushQueuedResizeBounds(): Promise<void> {
    const currentFlush = resizeFlushPromiseRef.current;
    if (currentFlush) {
      return currentFlush;
    }

    let flushPromise: Promise<void>;
    flushPromise = (async () => {
      while (pendingResizeBoundsRef.current) {
        const nextBounds = pendingResizeBoundsRef.current;
        pendingResizeBoundsRef.current = null;
        await applyCurrentButtonWindowPhysicalBounds({
          Left: nextBounds.left,
          Top: nextBounds.top,
          Width: nextBounds.width,
          Height: nextBounds.height
        });
      }
    })()
      .catch((resizeError) => {
        pendingResizeBoundsRef.current = null;
        resizeApplyErrorRef.current = resizeError;
        setRuntimeError(
          resizeError instanceof Error ? resizeError.message : String(resizeError)
        );
      })
      .finally(() => {
        if (resizeFlushPromiseRef.current === flushPromise) {
          resizeFlushPromiseRef.current = null;
        }
        if (pendingResizeBoundsRef.current && !resizeApplyErrorRef.current) {
          void flushQueuedResizeBounds();
        }
      });
    resizeFlushPromiseRef.current = flushPromise;
    return flushPromise;
  }

  const queueResizeBounds = (bounds: ButtonDesktopBounds) => {
    if (resizeApplyErrorRef.current) {
      return;
    }
    pendingResizeBoundsRef.current = bounds;
    void flushQueuedResizeBounds();
  };

  const waitForQueuedResizeBounds = async () => {
    while (pendingResizeBoundsRef.current || resizeFlushPromiseRef.current) {
      await (resizeFlushPromiseRef.current ?? flushQueuedResizeBounds());
    }
    if (resizeApplyErrorRef.current) {
      throw resizeApplyErrorRef.current;
    }
  };

  const updateResizeBoundsForPointer = (
    session: ButtonPopoutResizeSession,
    pointer: { x: number; y: number }
  ) => {
    if (resizeSessionRef.current !== session) {
      return;
    }
    queueResizeBounds(resolveAspectLockedWindowBounds({
      initialBounds: session.initialBounds,
      initialPointer: session.initialPointer,
      pointer,
      corner: session.corner
    }));
  };

  const startResizeDrag =
    (corner: ButtonWindowResizeCorner) =>
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (
          event.button !== 0 ||
          dragging ||
          resizing ||
          spaceDragActive ||
          !unit ||
          renderedDisplayMode !== "expanded"
        ) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        const resizeHandle = event.currentTarget;
        const pointerId = event.pointerId;
        const fallbackScreenX = event.screenX;
        const fallbackScreenY = event.screenY;
        resizeHandle.setPointerCapture(pointerId);
        resizeApplyErrorRef.current = null;
        pendingResizeBoundsRef.current = null;
        setRuntimeError(null);
        setResizing(true);

        void (async () => {
          const currentWindow = getCurrentWindow();
          await currentWindow.setIgnoreCursorEvents(false);
          await queueEnvelope(windowEnvelope.resting);
          const [position, size, rawScaleFactor, initialPointer] = await Promise.all([
            currentWindow.outerPosition().catch(() => null),
            currentWindow.innerSize().catch(() => null),
            currentWindow.scaleFactor().catch(() => 1),
            cursorPosition().catch(() => null)
          ]);
          if (!position || !size) {
            throw new Error("Could not read the Button Pop window bounds for resizing.");
          }
          const scaleFactor = Number.isFinite(rawScaleFactor) && rawScaleFactor > 0
            ? rawScaleFactor
            : 1;
          resizeSessionRef.current = {
            corner,
            pointerId,
            fallbackPointerScale: scaleFactor,
            initialPointer: initialPointer ?? {
              x: fallbackScreenX * scaleFactor,
              y: fallbackScreenY * scaleFactor
            },
            initialBounds: {
              left: position.x,
              top: position.y,
              width: size.width,
              height: size.height
            }
          };

          if (resizePollTimerRef.current !== null) {
            window.clearInterval(resizePollTimerRef.current);
          }
          resizePollTimerRef.current = window.setInterval(() => {
            const session = resizeSessionRef.current;
            if (!session) {
              return;
            }
            void cursorPosition()
              .then((pointer) => updateResizeBoundsForPointer(session, pointer))
              .catch(() => {});
          }, 16);
        })().catch((resizeError) => {
          if (resizeHandle.hasPointerCapture(pointerId)) {
            resizeHandle.releasePointerCapture(pointerId);
          }
          resizeSessionRef.current = null;
          setResizing(false);
          setRuntimeError(
            resizeError instanceof Error ? resizeError.message : String(resizeError)
          );
        });
      };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = resizeSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void cursorPosition()
      .then((pointer) => updateResizeBoundsForPointer(session, pointer))
      .catch(() => updateResizeBoundsForPointer(session, {
        x: event.screenX * session.fallbackPointerScale,
        y: event.screenY * session.fallbackPointerScale
      }));
  };

  const endResizeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = resizeSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (resizePollTimerRef.current !== null) {
      window.clearInterval(resizePollTimerRef.current);
      resizePollTimerRef.current = null;
    }
    resizeSessionRef.current = null;
    const fallbackPointer = {
      x: event.screenX * session.fallbackPointerScale,
      y: event.screenY * session.fallbackPointerScale
    };

    void (async () => {
      const finalPointer = await cursorPosition().catch(() => fallbackPointer);
      queueResizeBounds(resolveAspectLockedWindowBounds({
        initialBounds: session.initialBounds,
        initialPointer: session.initialPointer,
        pointer: finalPointer,
        corner: session.corner
      }));
      await waitForQueuedResizeBounds();
      surfaceOriginRef.current = null;
      await commitAppliedEnvelope(windowEnvelope.resting, undefined, true);
      const synchronizedSurfaceOrigin = surfaceOriginRef.current as {
        x: number;
        y: number;
      } | null;
      if (unit?.kind === "tool-set" && synchronizedSurfaceOrigin) {
        collapsedOriginRef.current = { ...synchronizedSurfaceOrigin };
      }
      await persistPopoutBounds("expanded");
    })()
      .catch((resizeError) => {
        setRuntimeError(
          resizeError instanceof Error ? resizeError.message : String(resizeError)
        );
      })
      .finally(() => {
        resizeApplyErrorRef.current = null;
        setResizing(false);
      });
  };

  const handlePointerDownCapture = (event: ReactPointerEvent<HTMLElement>) => {
    if (!spaceDragActive || dragging || resizing || event.button !== 0 || !unit) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setDragging(true);
    void (async () => {
      try {
        await getCurrentWindow().setIgnoreCursorEvents(false);
        if (unit.kind === "regular" || displayMode === "collapsed") {
          await queueEnvelope(windowEnvelope.resting);
        }
        if (unit.kind === "tool-set" && displayMode === "expanded") {
          setPinned(false);
          setDisplayMode("collapsed");
          const ownerPlacement = document
            ? Object.values(document.placements).find(
                (placement) => placement.buttonId === unit.ownerButtonId
              )
            : null;
          const immediateCollapsedEnvelope: ButtonRect = {
            x: 0,
            y: 0,
            width: ownerPlacement?.width ?? 1,
            height: ownerPlacement?.height ?? 1
          };
          pendingEnvelopeRef.current = null;
          await scheduleNativeGeometryTransition(async () => {
            setRenderedToolSetMode("collapsed");
            await waitForAppliedButtonWindowRender();
            await applyCollapsedGeometry(immediateCollapsedEnvelope);
          });
        }
        await getCurrentWindow().startDragging();
        await waitForNativeWindowDragEnd();
        await persistPopoutBounds(
          unit.kind === "tool-set" ? "collapsed" : displayMode
        );
      } catch (dragError) {
        setRuntimeError(dragError instanceof Error ? dragError.message : String(dragError));
      } finally {
        setDragging(false);
      }
    })();
  };

  const handlePlacementVisualMeasurement = useCallback((
    placementId: string,
    measurement: ButtonVisualMeasurement
  ) => {
    const { state, ...geometry } = measurement;
    setCurrentMeasurements((current) => measurementsEqual(current[placementId], geometry)
      ? current
      : { ...current, [placementId]: geometry });
    if (!buttonVisualStateNeedsWindowExpansion(state)) {
      setIdleMeasurements((current) => {
        const previous = current[placementId];
        if (previous && measurementsEqual(previous, geometry)) return current;
        if (
          previous &&
          Math.abs(previous.width - geometry.width) <= 0.05 &&
          Math.abs(previous.height - geometry.height) <= 0.05
        ) {
          return current;
        }
        return { ...current, [placementId]: geometry };
      });
    }
  }, []);

  const handlePlacementVisualStateChange = useCallback((
    placementId: string,
    state: ButtonVisualState
  ) => {
    setVisualStates((current) => visualStatesEqual(current[placementId], state)
      ? current
      : { ...current, [placementId]: state });
  }, []);

  return (
    <main
      ref={rootRef}
      className={[
        "button-popout-window",
        spaceDragActive ? "button-popout-window--space-drag" : "",
        resizing ? "button-popout-window--resizing" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerDownCapture={handlePointerDownCapture}
      aria-label={`${unit?.name ?? "Button popout"} — ${unit?.windowFitMode ?? "surface"} fit — ${activeContext.draftSessionId ? "live draft" : "saved state"}`}
    >
      {resizeHandlesVisible
        ? BUTTON_POPOUT_RESIZE_CORNERS.map(({ corner, modifier }) => (
            <div
              key={corner}
              className={`button-popout-window__resize-handle button-popout-window__resize-handle--${modifier}`}
              data-button-window-resize-handle={corner}
              aria-hidden="true"
              onPointerDown={startResizeDrag(corner)}
              onPointerMove={handleResizePointerMove}
              onPointerUp={endResizeDrag}
              onPointerCancel={endResizeDrag}
            />
          ))
        : null}
      {loading ? <div className="button-window-error">Loading Button popout...</div> : null}
      {error ? <div className="button-window-error">{error}</div> : null}
      {!loading && !error && !unit ? (
        <div className="button-window-error">Saved popout unit was not found.</div>
      ) : null}
      {runtimeError ? <div className="button-window-error">{runtimeError}</div> : null}
      {document && unit ? (
        <ButtonPopoutRenderer
          document={document}
          unit={unit}
          displayMode={renderedDisplayMode}
          surfaceScale={surfaceScale}
          surfaceEnvelope={appliedEnvelope ?? windowEnvelope.current}
          onOwnerActivate={handleOwnerActivate}
          onPlacementVisualMeasurement={handlePlacementVisualMeasurement}
          onPreparePlacementVisualStateChange={preparePlacementVisualStateChange}
          onPlacementVisualStateChange={handlePlacementVisualStateChange}
        />
      ) : null}
    </main>
  );
}

export default ButtonPopoutWindowPage;
