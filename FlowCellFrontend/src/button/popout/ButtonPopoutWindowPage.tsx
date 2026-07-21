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
  isNativePrimaryMouseButtonDown
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
  ButtonRect,
  ButtonStateDocument,
  ButtonVisualMeasurement,
  ButtonVisualState
} from "../types";
import {
  applyCurrentButtonCanvasForContentBounds,
  closeButtonPopoutWindow,
  listenForButtonWindowContextUpdates,
  type AppliedButtonCanvas
} from "../windows/buttonWindows";
import {
  buttonDesktopBoundsInsideCanvas,
  buttonDesktopBoundsToCanvasRect,
  buttonDesktopBoundsFromFlowCellBounds,
  buttonVisualStateNeedsWindowExpansion,
  buttonWindowRectsEqual,
  resolveAspectLockedWindowBounds,
  resolveButtonFrameForScaleFactor,
  resolveButtonWebviewPixelRatio,
  resolveButtonWindowEnvelope,
  resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin,
  resolvePopoutBoundsAfterDrag,
  resolveUniformSurfaceScale,
  shouldBypassButtonWindowGeometryTransition,
  translateButtonDesktopBounds,
  type ButtonWindowResizeCorner
} from "../windows/buttonWindowGeometry";
import { useButtonWindowDocument } from "../windows/useButtonWindowDocument";
import { useFixedButtonCanvasMetrics } from "../windows/useFixedButtonCanvas";
import { useNativeButtonHitboxes } from "../windows/useNativeButtonHitboxes";
import {
  setButtonWindowGeometryTransitionActive,
  waitForAppliedButtonWindowRender,
  waitForButtonWindowHitTestTurn
} from "../windows/buttonWindowGeometryTransition";
import {
  activateToolSetChildHotkey,
  listenForToolSetChildHotkeys,
  type ToolSetChildHotkeyHostState
} from "../runtime/toolSetChildHotkeyBridge";
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
  const contentFrameRef = useRef<HTMLDivElement | null>(null);
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
  const expandedContentScaleRef = useRef(1);
  const surfaceOriginRef = useRef<{ x: number; y: number } | null>(null);
  const appliedEnvelopeRef = useRef<ButtonRect | null>(null);
  const appliedFrameBoundsRef = useRef<ButtonDesktopBounds | null>(null);
  const appliedCanvasRef = useRef<AppliedButtonCanvas | null>(null);
  const restingEnvelopeFrameRef = useRef<{
    envelope: ButtonRect;
    bounds: ButtonDesktopBounds;
  } | null>(null);
  const pendingEnvelopeRef = useRef<ButtonRect | null>(null);
  const envelopeFlushPromiseRef = useRef<Promise<void> | null>(null);
  const nativeGeometryTransitionRef = useRef<Promise<void>>(Promise.resolve());
  const nativeGeometryTransitionPendingRef = useRef(0);
  const toolSetChildHotkeyStateRef = useRef<ToolSetChildHotkeyHostState>({
    document: null,
    unit: null,
    renderedDisplayMode: "collapsed",
    root: null
  });
  const [activeContext, setActiveContext] = useState(context);
  const [displayMode, setDisplayMode] = useState(context.initialDisplayMode);
  const [renderedToolSetMode, setRenderedToolSetMode] = useState<"collapsed" | "expanded">("collapsed");
  const [pinned, setPinned] = useState(false);
  const [idleMeasurements, setIdleMeasurements] = useState<Record<string, ButtonCoreMeasurement>>({});
  const [currentMeasurements, setCurrentMeasurements] = useState<Record<string, ButtonCoreMeasurement>>({});
  const [visualStates, setVisualStates] = useState<Record<string, ButtonVisualState>>({});
  const [appliedEnvelope, setAppliedEnvelope] = useState<ButtonRect | null>(null);
  const [appliedFrameBounds, setAppliedFrameBounds] = useState<ButtonDesktopBounds | null>(null);
  const [geometryRefreshToken, setGeometryRefreshToken] = useState(0);
  const [geometryInitialized, setGeometryInitialized] = useState(false);
  const [spaceKeyActive, setSpaceKeyActive] = useState(false);
  const [nativeSpaceKeyActive, setNativeSpaceKeyActive] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const canvasMetrics = useFixedButtonCanvasMetrics();
  const spaceDragActive = spaceKeyActive || nativeSpaceKeyActive;
  const applyCanvasForFrame = useCallback(async (
    bounds: ButtonDesktopBounds,
    padding = 0
  ): Promise<AppliedButtonCanvas> => {
    const applied = await applyCurrentButtonCanvasForContentBounds({
      Left: bounds.left - padding,
      Top: bounds.top - padding,
      Width: bounds.width + padding * 2,
      Height: bounds.height + padding * 2
    });
    appliedCanvasRef.current = applied;
    return applied;
  }, []);
  const ensureCanvasContainsFrame = useCallback(async (
    bounds: ButtonDesktopBounds
  ): Promise<AppliedButtonCanvas> => {
    const current = appliedCanvasRef.current;
    if (current && buttonDesktopBoundsInsideCanvas(bounds, current.bounds)) {
      const synchronized = canvasMetrics.ready &&
        Math.abs(current.scaleFactor - canvasMetrics.scaleFactor) > 0.001
          ? { ...current, scaleFactor: canvasMetrics.scaleFactor }
          : current;
      appliedCanvasRef.current = synchronized;
      return synchronized;
    }
    return applyCanvasForFrame(bounds, 192);
  }, [applyCanvasForFrame, canvasMetrics.ready, canvasMetrics.scaleFactor]);
  useEffect(() => {
    const current = appliedCanvasRef.current;
    if (
      !current ||
      !canvasMetrics.ready ||
      Math.abs(current.scaleFactor - canvasMetrics.scaleFactor) <= 0.001
    ) return;
    appliedCanvasRef.current = {
      ...current,
      scaleFactor: canvasMetrics.scaleFactor
    };
  }, [canvasMetrics.ready, canvasMetrics.scaleFactor]);
  const { document, loading, error } = useButtonWindowDocument(
    activeContext.draftSessionId
  );
  const unit = document?.popoutUnits[activeContext.popoutUnitId] ?? null;
  const expandedSurface = unit && document ? document.surfaces[unit.surfaceId] : null;
  const renderedDisplayMode = unit?.kind === "regular" ? "expanded" : renderedToolSetMode;
  toolSetChildHotkeyStateRef.current = {
    document,
    unit,
    renderedDisplayMode,
    root: null
  };
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
  const surfaceScale = contentScaleRef.current ?? 1;
  const resizeHandlesVisible = Boolean(unit && renderedDisplayMode === "expanded");
  const commitAppliedEnvelope = useCallback(async (
    envelope: ButtonRect,
    contentScaleOverride?: number,
    reanchorSurface = false,
    onRenderCommit?: () => void
  ) => {
    const currentWindow = getCurrentWindow();
    const rawScaleFactor = appliedCanvasRef.current?.scaleFactor ??
      await currentWindow.scaleFactor().catch(() => 1);
    const scaleFactor = resolveButtonWebviewPixelRatio(
      rawScaleFactor,
      window.devicePixelRatio
    );
    const anchorBounds =
      expandedBoundsRef.current ??
      restingEnvelopeFrameRef.current?.bounds ??
      appliedFrameBoundsRef.current;
    const nextContentScale =
      typeof contentScaleOverride === "number" &&
      Number.isFinite(contentScaleOverride) &&
      contentScaleOverride > 0
        ? contentScaleOverride
        : anchorBounds
          ? resolveUniformSurfaceScale({
              viewportWidth: anchorBounds.width / scaleFactor,
              viewportHeight: anchorBounds.height / scaleFactor,
              surfaceWidth: envelope.width,
              surfaceHeight: envelope.height
            })
          : contentScaleRef.current ?? 1;
    contentScaleRef.current = nextContentScale;
    if (reanchorSurface || !surfaceOriginRef.current) {
      const physicalPerDesignPixel = nextContentScale * scaleFactor;
      const anchor = anchorBounds ?? {
        left: activeContext.initialBounds?.Left ?? 0,
        top: activeContext.initialBounds?.Top ?? 0,
        width: Math.max(1, envelope.width * physicalPerDesignPixel),
        height: Math.max(1, envelope.height * physicalPerDesignPixel)
      };
      surfaceOriginRef.current = {
        x: anchor.left - envelope.x * physicalPerDesignPixel,
        y: anchor.top - envelope.y * physicalPerDesignPixel
      };
    }
    let frameBounds = resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin({
      surfaceOrigin: surfaceOriginRef.current,
      envelope,
      contentScale: nextContentScale,
      scaleFactor
    });
    const appliedCanvas = await ensureCanvasContainsFrame(frameBounds);
    if (Math.abs(appliedCanvas.scaleFactor - scaleFactor) > 0.001) {
      frameBounds = resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin({
        surfaceOrigin: surfaceOriginRef.current,
        envelope,
        contentScale: nextContentScale,
        scaleFactor: appliedCanvas.scaleFactor
      });
      await ensureCanvasContainsFrame(frameBounds);
    }
    appliedEnvelopeRef.current = envelope;
    appliedFrameBoundsRef.current = frameBounds;
    onRenderCommit?.();
    setAppliedEnvelope(envelope);
    setAppliedFrameBounds(frameBounds);
  }, [activeContext.initialBounds, ensureCanvasContainsFrame]);

  const scheduleNativeGeometryTransition = useCallback((work: () => Promise<void>) => {
    nativeGeometryTransitionPendingRef.current += 1;
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
    const trackedTransition = transition.finally(() => {
      nativeGeometryTransitionPendingRef.current = Math.max(
        0,
        nativeGeometryTransitionPendingRef.current - 1
      );
    });
    nativeGeometryTransitionRef.current = trackedTransition;
    return trackedTransition;
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
    await commitAppliedEnvelope(nextEnvelope, contentScaleRef.current ?? 1);
  }, [commitAppliedEnvelope]);

  const applyEnvelope = useCallback((nextEnvelope: ButtonRect) => {
    if (shouldBypassButtonWindowGeometryTransition(
      appliedEnvelopeRef.current,
      nextEnvelope,
      nativeGeometryTransitionPendingRef.current
    )) {
      return applyEnvelopeNow(nextEnvelope);
    }
    return scheduleNativeGeometryTransition(() => applyEnvelopeNow(nextEnvelope));
  }, [
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
      await queueEnvelope(preparedEnvelope.resting);
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
          initializedUnitIdRef.current = null;
          setGeometryInitialized(false);
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
    activeContext.popoutUnitId
  ]);

  useEffect(() => {
    let disposed = false;
    const unlistenPromise = listenForToolSetChildHotkeys((payload) => {
      if (disposed) return;
      const result = activateToolSetChildHotkey(payload, {
        ...toolSetChildHotkeyStateRef.current,
        root: rootRef.current
      });
      setRuntimeError(result.accepted ? null : result.message);
    }).catch((listenError) => {
      if (!disposed) {
        setRuntimeError(
          `Could not listen for tool-set child hotkeys: ${
            listenError instanceof Error ? listenError.message : String(listenError)
          }`
        );
      }
      return null;
    });
    return () => {
      disposed = true;
      void unlistenPromise.then((unlisten) => unlisten?.()).catch(() => {});
    };
  }, []);

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
    if (!unit || !canvasMetrics.ready) {
      return;
    }
    const initializationKey = [
      unit.id,
      activeContext.initialDisplayMode,
      activeContext.restoreBounds?.Left,
      activeContext.restoreBounds?.Top,
      activeContext.restoreBounds?.Width,
      activeContext.restoreBounds?.Height,
      activeContext.initialBounds?.Left,
      activeContext.initialBounds?.Top
    ].join(":");
    if (initializedUnitIdRef.current === initializationKey) {
      return;
    }
    initializedUnitIdRef.current = initializationKey;
    setGeometryInitialized(false);
    collapsedOriginRef.current = null;
    const restoredBounds = buttonDesktopBoundsFromFlowCellBounds(
      activeContext.restoreBounds ?? activeContext.initialBounds
    );
    setRuntimeError(null);
    setIdleMeasurements({});
    setCurrentMeasurements({});
    setVisualStates({});
    surfaceOriginRef.current = null;
    appliedEnvelopeRef.current = null;
    appliedFrameBoundsRef.current = null;
    setAppliedEnvelope(null);
    setAppliedFrameBounds(null);
    setPinned(unit.pinnedDefault && activeContext.initialDisplayMode === "expanded");
    setDisplayMode(activeContext.initialDisplayMode);
    if (unit.kind === "tool-set") {
      setRenderedToolSetMode(activeContext.initialDisplayMode);
    }

    const initialization = scheduleNativeGeometryTransition(async () => {
      const currentWindow = getCurrentWindow();
      const canvasSeed = restoredBounds ?? {
        left: canvasMetrics.left,
        top: canvasMetrics.top,
        width: 1,
        height: 1
      };
      const initialCanvas = await applyCanvasForFrame(canvasSeed);
      const scaleFactor = initialCanvas.scaleFactor;
      const anchor = restoredBounds ?? {
        left: canvasMetrics.left,
        top: canvasMetrics.top,
        width: 1,
        height: 1
      };
      const expandedEnvelope = unit.desktopBoundsEnvelope ?? storedExpandedWindowEnvelope.resting;
      let visibleBounds: ButtonDesktopBounds;

      if (activeContext.initialDisplayMode === "expanded") {
        const authoritativeBounds =
          activeContext.restoreBounds && restoredBounds
            ? restoredBounds
            : isUsableDesktopBounds(unit.desktopBounds)
              ? unit.desktopBounds
              : null;
        const expandedScale = authoritativeBounds
          ? resolveUniformSurfaceScale({
              viewportWidth: authoritativeBounds.width / scaleFactor,
              viewportHeight: authoritativeBounds.height / scaleFactor,
              surfaceWidth: expandedEnvelope.width,
              surfaceHeight: expandedEnvelope.height
            })
          : 1;
        expandedContentScaleRef.current = expandedScale;
        contentScaleRef.current = expandedScale;
        visibleBounds = authoritativeBounds ?? {
          left: anchor.left,
          top: anchor.top,
          width: Math.max(1, Math.ceil(expandedEnvelope.width * scaleFactor)),
          height: Math.max(1, Math.ceil(expandedEnvelope.height * scaleFactor))
        };
        expandedBoundsRef.current = visibleBounds;
        restingEnvelopeFrameRef.current = {
          envelope: expandedEnvelope,
          bounds: visibleBounds
        };
        const physicalPerDesignPixel = expandedScale * scaleFactor;
        surfaceOriginRef.current = {
          x: visibleBounds.left - expandedEnvelope.x * physicalPerDesignPixel,
          y: visibleBounds.top - expandedEnvelope.y * physicalPerDesignPixel
        };
      } else {
        const collapsedEnvelope = collapsedWindowEnvelope.resting;
        visibleBounds = activeContext.restoreBounds && restoredBounds
          ? restoredBounds
          : {
              left: anchor.left,
              top: anchor.top,
              width: Math.max(1, Math.ceil(collapsedEnvelope.width * scaleFactor)),
              height: Math.max(1, Math.ceil(collapsedEnvelope.height * scaleFactor))
            };
        contentScaleRef.current = 1;
        surfaceOriginRef.current = {
          x: visibleBounds.left - collapsedEnvelope.x * scaleFactor,
          y: visibleBounds.top - collapsedEnvelope.y * scaleFactor
        };
        const savedExpandedBounds = isUsableDesktopBounds(unit.desktopBounds)
          ? unit.desktopBounds
          : null;
        expandedContentScaleRef.current = savedExpandedBounds
          ? resolveUniformSurfaceScale({
              viewportWidth: savedExpandedBounds.width / scaleFactor,
              viewportHeight: savedExpandedBounds.height / scaleFactor,
              surfaceWidth: expandedEnvelope.width,
              surfaceHeight: expandedEnvelope.height
            })
          : 1;
        expandedBoundsRef.current = resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin({
          surfaceOrigin: surfaceOriginRef.current,
          envelope: expandedEnvelope,
          contentScale: expandedContentScaleRef.current,
          scaleFactor
        });
        restingEnvelopeFrameRef.current = savedExpandedBounds
          ? { envelope: expandedEnvelope, bounds: expandedBoundsRef.current }
          : null;
      }

      collapsedOriginRef.current = { ...surfaceOriginRef.current };
      appliedEnvelopeRef.current = activeContext.initialDisplayMode === "expanded"
        ? expandedEnvelope
        : collapsedWindowEnvelope.resting;
      appliedFrameBoundsRef.current = visibleBounds;
      setAppliedEnvelope(appliedEnvelopeRef.current);
      setAppliedFrameBounds(visibleBounds);
      writeRegisteredLayoutWindowSnapshotBounds(currentWindow.label, {
        Left: visibleBounds.left,
        Top: visibleBounds.top,
        Width: visibleBounds.width,
        Height: visibleBounds.height
      });
      setGeometryInitialized(true);
      await ensureCanvasContainsFrame(visibleBounds);
    });
    void initialization.catch((initializationError) => {
      setRuntimeError(
        initializationError instanceof Error
          ? initializationError.message
          : String(initializationError)
      );
    });
  }, [
    activeContext.initialBounds,
    activeContext.initialDisplayMode,
    activeContext.restoreBounds,
    applyCanvasForFrame,
    canvasMetrics.left,
    canvasMetrics.ready,
    canvasMetrics.scaleFactor,
    canvasMetrics.top,
    collapsedWindowEnvelope.resting,
    ensureCanvasContainsFrame,
    scheduleNativeGeometryTransition,
    storedExpandedWindowEnvelope.resting,
    unit
  ]);

  const ensureCollapsedOrigin = useCallback(
    async (_currentMode: "collapsed" | "expanded") => {
      if (collapsedOriginRef.current) {
        return collapsedOriginRef.current;
      }
      if (surfaceOriginRef.current) {
        collapsedOriginRef.current = { ...surfaceOriginRef.current };
        return collapsedOriginRef.current;
      }
      const currentWindow = getCurrentWindow();
      const scaleFactor = resolveButtonWebviewPixelRatio(
        await currentWindow.scaleFactor().catch(() => 1),
        window.devicePixelRatio
      );
      const frame = appliedFrameBoundsRef.current ?? expandedBoundsRef.current;
      const envelope = appliedEnvelopeRef.current ?? windowEnvelope.resting;
      const physicalPerDesignPixel = (contentScaleRef.current ?? 1) * scaleFactor;
      const origin = frame
        ? {
            x: frame.left - envelope.x * physicalPerDesignPixel,
            y: frame.top - envelope.y * physicalPerDesignPixel
          }
        : {
            x: activeContext.initialBounds?.Left ?? canvasMetrics.left,
            y: activeContext.initialBounds?.Top ?? canvasMetrics.top
          };
      collapsedOriginRef.current = origin;
      surfaceOriginRef.current = origin;
      return origin;
    },
    [activeContext.initialBounds, canvasMetrics.left, canvasMetrics.top, windowEnvelope.resting]
  );

  const applyCollapsedGeometry = useCallback(async (
    collapsedEnvelope = collapsedWindowEnvelope.resting,
    onRenderCommit?: () => void
  ) => {
    const origin = await ensureCollapsedOrigin("collapsed");
    surfaceOriginRef.current = origin;
    await commitAppliedEnvelope(collapsedEnvelope, 1, false, onRenderCommit);
    const collapsedBounds = appliedFrameBoundsRef.current;
    if (collapsedBounds) {
      writeRegisteredLayoutWindowSnapshotBounds(getCurrentWindow().label, {
        Left: collapsedBounds.left,
        Top: collapsedBounds.top,
        Width: collapsedBounds.width,
        Height: collapsedBounds.height
      });
    }
  }, [collapsedWindowEnvelope.resting, commitAppliedEnvelope, ensureCollapsedOrigin]);

  const applyExpandedGeometry = useCallback(async (onRenderCommit?: () => void) => {
    if (!unit) {
      return;
    }
    const origin = await ensureCollapsedOrigin("expanded");
    const expandedEnvelope =
      restingEnvelopeFrameRef.current?.envelope ??
      unit.desktopBoundsEnvelope ??
      expandedWindowEnvelope.resting;
    surfaceOriginRef.current = origin;
    contentScaleRef.current = expandedContentScaleRef.current;
    await commitAppliedEnvelope(
      expandedEnvelope,
      expandedContentScaleRef.current,
      false,
      onRenderCommit
    );
    if (appliedFrameBoundsRef.current) {
      expandedBoundsRef.current = appliedFrameBoundsRef.current;
      restingEnvelopeFrameRef.current = {
        envelope: expandedEnvelope,
        bounds: appliedFrameBoundsRef.current
      };
    }
  }, [commitAppliedEnvelope, ensureCollapsedOrigin, expandedWindowEnvelope.resting, unit]);

  useEffect(() => {
    writeRegisteredLayoutWindowButtonDisplayMode(getCurrentWindow().label, displayMode);
    if (!geometryInitialized || !unit) {
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
    geometryInitialized,
    geometryRefreshToken,
    scheduleNativeGeometryTransition,
    unit?.id
  ]);

  useEffect(() => {
    if (
      !geometryInitialized ||
      !unit ||
      unit.kind !== "tool-set" ||
      displayMode !== "collapsed" ||
      renderedDisplayMode !== "collapsed" ||
      dragging ||
      resizing
    ) return;
    let cancelled = false;
    void queueEnvelope(collapsedWindowEnvelope.resting).catch((geometryError) => {
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
    geometryInitialized,
    queueEnvelope,
    renderedDisplayMode,
    resizing,
    unit?.id
  ]);

  useEffect(() => {
    if (
      !geometryInitialized ||
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
        expandedBoundsRef.current = savedRestingFrame.bounds;
        surfaceOriginRef.current = null;
        await commitAppliedEnvelope(
          windowEnvelope.resting,
          contentScaleRef.current ?? undefined,
          true
        );
        const restoredSurfaceOrigin = surfaceOriginRef.current as {
          x: number;
          y: number;
        } | null;
        if (unit.kind === "tool-set" && restoredSurfaceOrigin) {
          collapsedOriginRef.current = { ...restoredSurfaceOrigin };
        }
        });
      })()
      : queueEnvelope(windowEnvelope.resting);
    void applyTarget
      .then(async () => {
        if (
          cancelled ||
          windowEnvelope.transient ||
          !buttonWindowRectsEqual(appliedEnvelopeRef.current, windowEnvelope.resting)
        ) return;
        const currentWindow = getCurrentWindow();
        const restingBounds = appliedFrameBoundsRef.current;
        if (
          cancelled ||
          !restingBounds ||
          !buttonWindowRectsEqual(appliedEnvelopeRef.current, windowEnvelope.resting)
        ) return;
        expandedBoundsRef.current = restingBounds;
        expandedContentScaleRef.current = contentScaleRef.current ?? 1;
        restingEnvelopeFrameRef.current = {
          envelope: windowEnvelope.resting,
          bounds: restingBounds
        };
        writeRegisteredLayoutWindowSnapshotBounds(currentWindow.label, {
          Left: restingBounds.left,
          Top: restingBounds.top,
          Width: restingBounds.width,
          Height: restingBounds.height
        });
        if (activeContext.draftSessionId) {
          await publishButtonRestingWindowBounds(activeContext.draftSessionId, {
            kind: "popout",
            popoutUnitId: unit.id,
            fitMode: unit.windowFitMode ?? "surface",
            bounds: restingBounds,
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
    geometryInitialized,
    scheduleNativeGeometryTransition,
    unit,
    windowEnvelope.current,
    windowEnvelope.resting,
    windowEnvelope.transient,
    activeContext.draftSessionId,
    commitAppliedEnvelope
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
    broadPhaseRef: contentFrameRef,
    broadPhasePadding: 16,
    enabled: geometryInitialized && !dragging && !resizing,
    onHoverChange: handleNativeHoverChange,
    onNativeSpaceChange: setNativeSpaceKeyActive
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
    const rawScaleFactor = await currentWindow.scaleFactor().catch(() => 1);
    const scaleFactor = resolveButtonWebviewPixelRatio(
      rawScaleFactor,
      window.devicePixelRatio
    );
    const liveBounds = appliedFrameBoundsRef.current;
    if (!liveBounds) {
      return;
    }
    const toolSetCollapsed = unit.kind === "tool-set" && persistedMode === "collapsed";
    const appliedWindowEnvelope = appliedEnvelopeRef.current ?? windowEnvelope.resting;
    const physicalPerDesignPixel = (contentScaleRef.current ?? 1) * scaleFactor;
    const liveSurfaceOrigin = surfaceOriginRef.current ?? {
      x: liveBounds.left - appliedWindowEnvelope.x * physicalPerDesignPixel,
      y: liveBounds.top - appliedWindowEnvelope.y * physicalPerDesignPixel
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
      expandedContentScaleRef.current = contentScaleRef.current;
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
        const rawScaleFactor = await getCurrentWindow().scaleFactor().catch(() => 1);
        const scaleFactor = resolveButtonWebviewPixelRatio(
          rawScaleFactor,
          window.devicePixelRatio
        );
        const nextScale = resolveUniformSurfaceScale({
          viewportWidth: nextBounds.width / scaleFactor,
          viewportHeight: nextBounds.height / scaleFactor,
          surfaceWidth: windowEnvelope.resting.width,
          surfaceHeight: windowEnvelope.resting.height
        });
        contentScaleRef.current = nextScale;
        expandedContentScaleRef.current = nextScale;
        surfaceOriginRef.current = {
          x: nextBounds.left - windowEnvelope.resting.x * nextScale * scaleFactor,
          y: nextBounds.top - windowEnvelope.resting.y * nextScale * scaleFactor
        };
        collapsedOriginRef.current = { ...surfaceOriginRef.current };
        expandedBoundsRef.current = nextBounds;
        restingEnvelopeFrameRef.current = {
          envelope: windowEnvelope.resting,
          bounds: nextBounds
        };
        appliedEnvelopeRef.current = windowEnvelope.resting;
        appliedFrameBoundsRef.current = nextBounds;
        setAppliedEnvelope(windowEnvelope.resting);
        setAppliedFrameBounds(nextBounds);
        await ensureCanvasContainsFrame(nextBounds);
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
          !geometryInitialized ||
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
        const pointerId = event.pointerId;
        const fallbackScreenX = event.screenX;
        const fallbackScreenY = event.screenY;
        resizeApplyErrorRef.current = null;
        pendingResizeBoundsRef.current = null;
        setRuntimeError(null);
        setResizing(true);

        void (async () => {
          const currentWindow = getCurrentWindow();
          await currentWindow.setIgnoreCursorEvents(true);
          await queueEnvelope(windowEnvelope.resting);
          const [rawScaleFactor, initialPointer] = await Promise.all([
            currentWindow.scaleFactor().catch(() => 1),
            cursorPosition().catch(() => null)
          ]);
          const initialBounds = expandedBoundsRef.current ?? appliedFrameBoundsRef.current;
          if (!initialBounds) {
            throw new Error("Could not read the Button Pop window bounds for resizing.");
          }
          const scaleFactor = resolveButtonWebviewPixelRatio(
            rawScaleFactor,
            window.devicePixelRatio
          );
          resizeSessionRef.current = {
            corner,
            pointerId,
            fallbackPointerScale: scaleFactor,
            initialPointer: initialPointer ?? {
              x: fallbackScreenX * scaleFactor,
              y: fallbackScreenY * scaleFactor
            },
            initialBounds
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

          while (await isNativePrimaryMouseButtonDown()) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
          }
          const session = resizeSessionRef.current;
          if (session) {
            const finalPointer = await cursorPosition().catch(() => session.initialPointer);
            updateResizeBoundsForPointer(session, finalPointer);
          }
          if (resizePollTimerRef.current !== null) {
            window.clearInterval(resizePollTimerRef.current);
            resizePollTimerRef.current = null;
          }
          resizeSessionRef.current = null;
          await waitForQueuedResizeBounds();
          let finalBounds = expandedBoundsRef.current;
          if (finalBounds) {
            const appliedCanvas = await applyCanvasForFrame(finalBounds);
            const logicalScale = expandedContentScaleRef.current;
            if (
              session &&
              Math.abs(appliedCanvas.scaleFactor - session.fallbackPointerScale) > 0.001
            ) {
              finalBounds = resolveButtonFrameForScaleFactor({
                bounds: finalBounds,
                envelope: windowEnvelope.resting,
                contentScale: logicalScale,
                scaleFactor: appliedCanvas.scaleFactor,
                anchorCorner: corner
              });
              queueResizeBounds(finalBounds);
              await waitForQueuedResizeBounds();
              await applyCanvasForFrame(finalBounds);
            }
          }
          await persistPopoutBounds("expanded");
        })()
          .catch((resizeError) => {
            setRuntimeError(
              resizeError instanceof Error ? resizeError.message : String(resizeError)
            );
          })
          .finally(() => {
            if (resizePollTimerRef.current !== null) {
              window.clearInterval(resizePollTimerRef.current);
              resizePollTimerRef.current = null;
            }
            resizeSessionRef.current = null;
            resizeApplyErrorRef.current = null;
            setResizing(false);
          });
      };

  const handlePointerDownCapture = (event: ReactPointerEvent<HTMLElement>) => {
    if (
      !geometryInitialized ||
      !spaceDragActive ||
      dragging ||
      resizing ||
      event.button !== 0 ||
      !unit
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setDragging(true);
    void (async () => {
      try {
        await getCurrentWindow().setIgnoreCursorEvents(true);
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

        const initialPointer = await cursorPosition();
        const initialVisibleBounds = appliedFrameBoundsRef.current;
        const initialExpandedBounds = expandedBoundsRef.current;
        const initialSurfaceOrigin = surfaceOriginRef.current;
        if (!initialVisibleBounds || !initialExpandedBounds || !initialSurfaceOrigin) {
          throw new Error("Could not read the Button Pop content frame for dragging.");
        }

        let finalVisibleBounds = initialVisibleBounds;
        while (await isNativePrimaryMouseButtonDown()) {
          const pointer = await cursorPosition().catch(() => initialPointer);
          const delta = {
            x: pointer.x - initialPointer.x,
            y: pointer.y - initialPointer.y
          };
          finalVisibleBounds = translateButtonDesktopBounds(initialVisibleBounds, delta);
          const nextExpandedBounds = translateButtonDesktopBounds(initialExpandedBounds, delta);
          surfaceOriginRef.current = {
            x: initialSurfaceOrigin.x + delta.x,
            y: initialSurfaceOrigin.y + delta.y
          };
          collapsedOriginRef.current = { ...surfaceOriginRef.current };
          expandedBoundsRef.current = nextExpandedBounds;
          if (restingEnvelopeFrameRef.current) {
            restingEnvelopeFrameRef.current = {
              ...restingEnvelopeFrameRef.current,
              bounds: nextExpandedBounds
            };
          }
          appliedFrameBoundsRef.current = finalVisibleBounds;
          setAppliedFrameBounds(finalVisibleBounds);
          await ensureCanvasContainsFrame(finalVisibleBounds);
          await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
        }

        const appliedCanvas = await applyCanvasForFrame(finalVisibleBounds);
        const envelope = appliedEnvelopeRef.current ?? windowEnvelope.resting;
        const logicalScale = contentScaleRef.current ?? 1;
        surfaceOriginRef.current = {
          x: finalVisibleBounds.left - envelope.x * logicalScale * appliedCanvas.scaleFactor,
          y: finalVisibleBounds.top - envelope.y * logicalScale * appliedCanvas.scaleFactor
        };
        collapsedOriginRef.current = { ...surfaceOriginRef.current };
        finalVisibleBounds = resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin({
          surfaceOrigin: surfaceOriginRef.current,
          envelope,
          contentScale: logicalScale,
          scaleFactor: appliedCanvas.scaleFactor
        });
        appliedFrameBoundsRef.current = finalVisibleBounds;
        setAppliedFrameBounds(finalVisibleBounds);
        if (unit.kind === "regular") {
          expandedBoundsRef.current = finalVisibleBounds;
          expandedContentScaleRef.current = logicalScale;
        } else {
          expandedBoundsRef.current = resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin({
            surfaceOrigin: surfaceOriginRef.current,
            envelope: expandedWindowEnvelope.resting,
            contentScale: expandedContentScaleRef.current,
            scaleFactor: appliedCanvas.scaleFactor
          });
        }
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

  const contentFrameRect = canvasMetrics.ready
    ? buttonDesktopBoundsToCanvasRect(appliedFrameBounds, canvasMetrics)
    : null;

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
      {loading ? <div className="button-window-error">Loading Button popout...</div> : null}
      {error ? <div className="button-window-error">{error}</div> : null}
      {!loading && !error && !unit ? (
        <div className="button-window-error">Saved popout unit was not found.</div>
      ) : null}
      {runtimeError ? <div className="button-window-error">{runtimeError}</div> : null}
      {document && unit && contentFrameRect ? (
        <div
          ref={contentFrameRef}
          className="button-popout-window__content-frame"
          style={{
            left: contentFrameRect.left,
            top: contentFrameRect.top,
            width: contentFrameRect.width,
            height: contentFrameRect.height
          }}
        >
          {resizeHandlesVisible
            ? BUTTON_POPOUT_RESIZE_CORNERS.map(({ corner, modifier }) => (
                <div
                  key={corner}
                  className={`button-popout-window__resize-handle button-popout-window__resize-handle--${modifier}`}
                  data-button-window-resize-handle={corner}
                  aria-hidden="true"
                  onPointerDown={startResizeDrag(corner)}
                />
              ))
            : null}
          <ButtonPopoutRenderer
            document={document}
            unit={unit}
            displayMode={renderedDisplayMode}
            surfaceScale={surfaceScale}
            surfaceEnvelope={appliedEnvelope ?? windowEnvelope.resting}
            onOwnerActivate={handleOwnerActivate}
            onPlacementVisualMeasurement={handlePlacementVisualMeasurement}
            onPreparePlacementVisualStateChange={preparePlacementVisualStateChange}
            onPlacementVisualStateChange={handlePlacementVisualStateChange}
          />
        </div>
      ) : null}
    </main>
  );
}

export default ButtonPopoutWindowPage;
