import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import type { ButtonFanWindowContext } from "../../lib/windowContext";
import { writeRegisteredLayoutWindowSnapshotBounds } from "../../lib/layoutSnapshots";
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
  ButtonFanSetup,
  ButtonPlacement,
  ButtonRect,
  ButtonStateDocument,
  ButtonVisualMeasurement,
  ButtonVisualState
} from "../types";
import {
  applyCurrentButtonCanvasForContentBounds,
  listenForButtonWindowContextUpdates,
  type AppliedButtonCanvas
} from "../windows/buttonWindows";
import {
  buttonDesktopBoundsInsideCanvas,
  buttonDesktopBoundsToCanvasRect,
  buttonDesktopBoundsFromFlowCellBounds,
  buttonVisualStateNeedsWindowExpansion,
  buttonWindowRectsEqual,
  resolveButtonWebviewPixelRatio,
  resolveButtonWindowEnvelope,
  resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin,
  shouldBypassButtonWindowGeometryTransition,
  translateButtonDesktopBounds
} from "../windows/buttonWindowGeometry";
import { useButtonWindowDocument } from "../windows/useButtonWindowDocument";
import { useFixedButtonCanvasMetrics } from "../windows/useFixedButtonCanvas";
import { useNativeButtonHitboxes } from "../windows/useNativeButtonHitboxes";
import {
  setButtonWindowGeometryTransitionActive,
  waitForAppliedButtonWindowRender,
  waitForButtonWindowHitTestTurn
} from "../windows/buttonWindowGeometryTransition";
import ButtonFanRenderer from "./ButtonFanRenderer";

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

function ownerPlacementForSetup(
  document: ButtonStateDocument,
  setup: ButtonFanSetup
) {
  const surface = document.surfaces[setup.fanSurfaceId];
  return surface?.placementIds
    .map((placementId) => document.placements[placementId])
    .find((placement) => placement?.buttonId === setup.panelOwnerButtonId);
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

export interface ButtonFanWindowPageProps {
  context: ButtonFanWindowContext;
}

export function ButtonFanWindowPage({ context }: ButtonFanWindowPageProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const contentFrameRef = useRef<HTMLDivElement | null>(null);
  const initializedSetupKeyRef = useRef<string | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const collapsedBoundsRef = useRef<ButtonDesktopBounds | null>(null);
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
  const appliedExpandedRef = useRef<boolean | null>(null);
  const [activeContext, setActiveContext] = useState(context);
  const [expanded, setExpanded] = useState(false);
  const [renderedExpanded, setRenderedExpanded] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [ownerMeasurement, setOwnerMeasurement] = useState<ButtonCoreMeasurement | null>(null);
  const [idleMeasurements, setIdleMeasurements] = useState<Record<string, ButtonCoreMeasurement>>({});
  const [currentMeasurements, setCurrentMeasurements] = useState<Record<string, ButtonCoreMeasurement>>({});
  const [visualStates, setVisualStates] = useState<Record<string, ButtonVisualState>>({});
  const [appliedEnvelope, setAppliedEnvelope] = useState<ButtonRect | null>(null);
  const [appliedFrameBounds, setAppliedFrameBounds] = useState<ButtonDesktopBounds | null>(null);
  const [geometryInitialized, setGeometryInitialized] = useState(false);
  const [geometryRefreshToken, setGeometryRefreshToken] = useState(0);
  const [spaceKeyActive, setSpaceKeyActive] = useState(false);
  const [nativeSpaceKeyActive, setNativeSpaceKeyActive] = useState(false);
  const [dragging, setDragging] = useState(false);
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
  const setup = document?.fanSetups[activeContext.fanSetupId] ?? null;
  const surface = setup && document ? document.surfaces[setup.fanSurfaceId] : null;
  const ownerPlacement = useMemo(
    () => (document && setup ? ownerPlacementForSetup(document, setup) : undefined),
    [document, setup]
  );
  const collapsedPlacement = useMemo<ButtonPlacement | null>(() => {
    if (!ownerPlacement || !setup) return null;
    return {
      ...ownerPlacement,
      id: `button-window-panel-owner-placement:${setup.panelOwnerButtonId}`,
      surfaceId: `button-window-panel-owner-surface:${setup.panelOwnerButtonId}`,
      x: 0,
      y: 0,
      zIndex: 0
    };
  }, [ownerPlacement, setup]);
  const expandedPlacements = useMemo<ButtonPlacement[]>(() => {
    if (!surface || !document) return [];
    return surface.placementIds
      .map((placementId) => document.placements[placementId])
      .filter((placement): placement is ButtonPlacement => Boolean(placement));
  }, [document, surface]);
  const collapsedEnvelope = useMemo(() => resolveButtonWindowEnvelope({
    mode: setup?.windowFitMode ?? "surface",
    surfaceBounds: {
      x: 0,
      y: 0,
      width: collapsedPlacement?.width ?? 1,
      height: collapsedPlacement?.height ?? 1
    },
    placements: collapsedPlacement ? [collapsedPlacement] : [],
    idleMeasurements,
    currentMeasurements,
    visualStates,
    visualOverflowAllowance: surface?.visualOverflowAllowance ?? 0
  }), [
    collapsedPlacement,
    currentMeasurements,
    idleMeasurements,
    setup?.windowFitMode,
    surface?.visualOverflowAllowance,
    visualStates
  ]);
  const storedCollapsedEnvelope = useMemo(() => resolveButtonWindowEnvelope({
    mode: setup?.collapsedBoundsFitMode ?? "surface",
    surfaceBounds: {
      x: 0,
      y: 0,
      width: collapsedPlacement?.width ?? 1,
      height: collapsedPlacement?.height ?? 1
    },
    placements: collapsedPlacement ? [collapsedPlacement] : [],
    idleMeasurements,
    visualOverflowAllowance: 0
  }), [collapsedPlacement, idleMeasurements, setup?.collapsedBoundsFitMode]);
  // The owner may be anchored outside the saved surface, so the expanded frame
  // is the surface box unioned with every placement rather than the box alone.
  const expandedSurfaceBounds = useMemo(() => {
    const base = { x: 0, y: 0, width: surface?.width ?? 1, height: surface?.height ?? 1 };
    if (expandedPlacements.length === 0) return base;
    const left = Math.min(base.x, ...expandedPlacements.map((placement) => placement.x));
    const top = Math.min(base.y, ...expandedPlacements.map((placement) => placement.y));
    const right = Math.max(
      base.x + base.width,
      ...expandedPlacements.map((placement) => placement.x + placement.width)
    );
    const bottom = Math.max(
      base.y + base.height,
      ...expandedPlacements.map((placement) => placement.y + placement.height)
    );
    return { x: left, y: top, width: right - left, height: bottom - top };
  }, [expandedPlacements, surface?.height, surface?.width]);
  const expandedEnvelope = useMemo(() => resolveButtonWindowEnvelope({
    mode: setup?.windowFitMode ?? "surface",
    surfaceBounds: expandedSurfaceBounds,
    placements: expandedPlacements,
    idleMeasurements,
    currentMeasurements,
    visualStates,
    visualOverflowAllowance: surface?.visualOverflowAllowance ?? 0
  }), [
    currentMeasurements,
    expandedPlacements,
    expandedSurfaceBounds,
    idleMeasurements,
    setup?.windowFitMode,
    surface,
    visualStates
  ]);
  const windowEnvelope = renderedExpanded ? expandedEnvelope : collapsedEnvelope;

  const commitAppliedEnvelope = useCallback(async (
    envelope: ButtonRect,
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
    if (reanchorSurface || !surfaceOriginRef.current) {
      const anchor = collapsedBoundsRef.current ?? appliedFrameBoundsRef.current ?? {
        left: activeContext.initialBounds?.Left ?? canvasMetrics.left,
        top: activeContext.initialBounds?.Top ?? canvasMetrics.top,
        width: 1,
        height: 1
      };
      surfaceOriginRef.current = {
        x: anchor.left - envelope.x * scaleFactor,
        y: anchor.top - envelope.y * scaleFactor
      };
    }
    let frameBounds = resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin({
      surfaceOrigin: surfaceOriginRef.current,
      envelope,
      contentScale: 1,
      scaleFactor
    });
    const appliedCanvas = await ensureCanvasContainsFrame(frameBounds);
    if (Math.abs(appliedCanvas.scaleFactor - scaleFactor) > 0.001) {
      frameBounds = resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin({
        surfaceOrigin: surfaceOriginRef.current,
        envelope,
        contentScale: 1,
        scaleFactor: appliedCanvas.scaleFactor
      });
      await ensureCanvasContainsFrame(frameBounds);
    }
    appliedEnvelopeRef.current = envelope;
    appliedFrameBoundsRef.current = frameBounds;
    onRenderCommit?.();
    setAppliedEnvelope(envelope);
    setAppliedFrameBounds(frameBounds);
  }, [
    activeContext.initialBounds,
    canvasMetrics.left,
    canvasMetrics.top,
    ensureCanvasContainsFrame
  ]);

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
    await commitAppliedEnvelope(nextEnvelope);
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
    if (!setup || dragging) return;
    const placements = renderedExpanded
      ? expandedPlacements
      : collapsedPlacement
        ? [collapsedPlacement]
        : [];
    const preparedEnvelope = resolveButtonWindowEnvelope({
      mode: setup.windowFitMode ?? "surface",
      surfaceBounds: renderedExpanded
        ? { x: 0, y: 0, width: surface?.width ?? 1, height: surface?.height ?? 1 }
        : {
            x: 0,
            y: 0,
            width: collapsedPlacement?.width ?? 1,
            height: collapsedPlacement?.height ?? 1
          },
      placements,
      idleMeasurements,
      currentMeasurements,
      visualStates: { ...visualStates, [placementId]: state },
      visualOverflowAllowance: surface?.visualOverflowAllowance ?? 0
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
    collapsedPlacement,
    currentMeasurements,
    dragging,
    expandedPlacements,
    idleMeasurements,
    queueEnvelope,
    renderedExpanded,
    setup,
    surface,
    visualStates
  ]);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    const unlistenPromise = listenForButtonWindowContextUpdates(
      currentWindow.label,
      (nextContext) => {
        if (
          nextContext.kind === "button-fan" &&
          nextContext.panelOwnerButtonId === activeContext.panelOwnerButtonId
        ) {
          initializedSetupKeyRef.current = null;
          setGeometryInitialized(false);
          const restoredBounds = buttonDesktopBoundsFromFlowCellBounds(
            nextContext.restoreBounds ?? nextContext.initialBounds
          );
          if (restoredBounds) {
            collapsedBoundsRef.current = restoredBounds;
            setGeometryRefreshToken((current) => current + 1);
            writeRegisteredLayoutWindowSnapshotBounds(currentWindow.label, {
              Left: restoredBounds.left,
              Top: restoredBounds.top,
              Width: restoredBounds.width,
              Height: restoredBounds.height
            });
          }
          setPinned(false);
          setExpanded(false);
          setActiveContext(nextContext);
        }
      }
    );
    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [activeContext.panelOwnerButtonId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setSpaceKeyActive(true);
      }
      if (event.key === "Escape") {
        setPinned(false);
        setExpanded(false);
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
  }, []);

  useEffect(() => {
    if (!setup || !canvasMetrics.ready) {
      return;
    }
    const initializationKey = [
      setup.id,
      activeContext.restoreBounds?.Left,
      activeContext.restoreBounds?.Top,
      activeContext.restoreBounds?.Width,
      activeContext.restoreBounds?.Height,
      activeContext.initialBounds?.Left,
      activeContext.initialBounds?.Top
    ].join(":");
    if (initializedSetupKeyRef.current === initializationKey) {
      return;
    }
    initializedSetupKeyRef.current = initializationKey;
    setGeometryInitialized(false);
    setRuntimeError(null);
    setOwnerMeasurement(null);
    setIdleMeasurements({});
    setCurrentMeasurements({});
    setVisualStates({});
    surfaceOriginRef.current = null;
    collapsedBoundsRef.current = null;
    appliedEnvelopeRef.current = null;
    appliedFrameBoundsRef.current = null;
    restingEnvelopeFrameRef.current = null;
    appliedExpandedRef.current = false;
    setAppliedEnvelope(null);
    setAppliedFrameBounds(null);
    setPinned(setup.pinnedDefault);
    setExpanded(setup.pinnedDefault);
    setRenderedExpanded(false);
    void (async () => {
      const contextBounds = buttonDesktopBoundsFromFlowCellBounds(
        activeContext.restoreBounds ?? activeContext.initialBounds
      );
      const savedBounds = isUsableDesktopBounds(setup.collapsedPanelOwnerBounds)
        ? setup.collapsedPanelOwnerBounds
        : null;
      const exactBounds = activeContext.restoreBounds ? contextBounds : savedBounds;
      const canvasSeed = exactBounds ?? contextBounds ?? {
        left: canvasMetrics.left,
        top: canvasMetrics.top,
        width: 1,
        height: 1
      };
      const initialCanvas = await applyCanvasForFrame(canvasSeed);
      if (initializedSetupKeyRef.current !== initializationKey) return;
      const scaleFactor = initialCanvas.scaleFactor;
      const collapsedBounds = exactBounds ?? {
        left: contextBounds?.left ?? canvasMetrics.left,
        top: contextBounds?.top ?? canvasMetrics.top,
        width: Math.max(1, Math.ceil(storedCollapsedEnvelope.resting.width * scaleFactor)),
        height: Math.max(1, Math.ceil(storedCollapsedEnvelope.resting.height * scaleFactor))
      };
      collapsedBoundsRef.current = collapsedBounds;
      restingEnvelopeFrameRef.current = {
        envelope: setup.collapsedBoundsEnvelope ?? storedCollapsedEnvelope.resting,
        bounds: collapsedBounds
      };
      writeRegisteredLayoutWindowSnapshotBounds(getCurrentWindow().label, {
        Left: collapsedBounds.left,
        Top: collapsedBounds.top,
        Width: collapsedBounds.width,
        Height: collapsedBounds.height
      });
      const collapsedEnvelope = setup.collapsedBoundsEnvelope ?? storedCollapsedEnvelope.resting;
      surfaceOriginRef.current = {
        x: collapsedBounds.left - collapsedEnvelope.x * scaleFactor,
        y: collapsedBounds.top - collapsedEnvelope.y * scaleFactor
      };
      appliedEnvelopeRef.current = collapsedEnvelope;
      appliedFrameBoundsRef.current = collapsedBounds;
      setAppliedEnvelope(collapsedEnvelope);
      setAppliedFrameBounds(collapsedBounds);
      await ensureCanvasContainsFrame(collapsedBounds);
      setGeometryInitialized(true);
    })().catch((geometryError) => {
      if (initializedSetupKeyRef.current === initializationKey) {
        setRuntimeError(
          geometryError instanceof Error ? geometryError.message : String(geometryError)
        );
      }
    });
  }, [
    activeContext.initialBounds,
    activeContext.restoreBounds,
    applyCanvasForFrame,
    canvasMetrics.left,
    canvasMetrics.ready,
    canvasMetrics.scaleFactor,
    canvasMetrics.top,
    ensureCanvasContainsFrame,
    setup?.id,
    storedCollapsedEnvelope.resting
  ]);

  const applyCollapsedGeometry = useCallback(async (onRenderCommit?: () => void) => {
    const currentWindow = getCurrentWindow();
    const bounds = collapsedBoundsRef.current;
    if (isUsableDesktopBounds(bounds)) {
      const target = setup?.collapsedBoundsEnvelope ?? storedCollapsedEnvelope.resting;
      const scaleFactor = resolveButtonWebviewPixelRatio(
        await currentWindow.scaleFactor().catch(() => 1),
        window.devicePixelRatio
      );
      surfaceOriginRef.current = {
        x: bounds.left - target.x * scaleFactor,
        y: bounds.top - target.y * scaleFactor
      };
      await commitAppliedEnvelope(target, false, onRenderCommit);
      return;
    }
    const rawScaleFactor = await currentWindow.scaleFactor().catch(() => 1);
    const scaleFactor = resolveButtonWebviewPixelRatio(
      rawScaleFactor,
      window.devicePixelRatio
    );
    const target = collapsedEnvelope.resting;
    const anchor = buttonDesktopBoundsFromFlowCellBounds(activeContext.initialBounds) ?? {
      left: canvasMetrics.left,
      top: canvasMetrics.top,
      width: 1,
      height: 1
    };
    const collapsedBounds = resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin({
      surfaceOrigin: { x: anchor.left, y: anchor.top },
      envelope: target,
      contentScale: 1,
      scaleFactor
    });
    surfaceOriginRef.current = { x: anchor.left, y: anchor.top };
    collapsedBoundsRef.current = collapsedBounds;
    await commitAppliedEnvelope(target, false, onRenderCommit);
  }, [
    activeContext.initialBounds,
    canvasMetrics.left,
    canvasMetrics.top,
    collapsedEnvelope.resting,
    commitAppliedEnvelope,
    setup?.collapsedBoundsEnvelope,
    storedCollapsedEnvelope.resting
  ]);

  const applyExpandedGeometry = useCallback(async (onRenderCommit?: () => void) => {
    if (!surface) {
      return;
    }
    const currentWindow = getCurrentWindow();
    const initialScaleFactor = resolveButtonWebviewPixelRatio(
      await currentWindow.scaleFactor().catch(() => 1),
      window.devicePixelRatio
    );
    if (!collapsedBoundsRef.current) {
      const initialAnchor = buttonDesktopBoundsFromFlowCellBounds(activeContext.initialBounds);
      collapsedBoundsRef.current = {
        left: initialAnchor?.left ?? canvasMetrics.left,
        top: initialAnchor?.top ?? canvasMetrics.top,
        width: Math.max(
          1,
          Math.round((ownerMeasurement?.width ?? 1) * initialScaleFactor)
        ),
        height: Math.max(
          1,
          Math.round((ownerMeasurement?.height ?? 1) * initialScaleFactor)
        )
      };
    }
    const origin = collapsedBoundsRef.current;
    const collapsedRestingEnvelope =
      setup?.collapsedBoundsEnvelope ??
      storedCollapsedEnvelope.resting;
    const expandedTargetEnvelope = expandedEnvelope.current;
    const collapsedOwnerOrigin = {
      x: origin.left - collapsedRestingEnvelope.x * initialScaleFactor,
      y: origin.top - collapsedRestingEnvelope.y * initialScaleFactor
    };
    const resolveExpandedFrame = (scaleFactor: number) => {
      const expandedSurfaceOrigin = {
        x: collapsedOwnerOrigin.x - (ownerPlacement?.x ?? 0) * scaleFactor,
        y: collapsedOwnerOrigin.y - (ownerPlacement?.y ?? 0) * scaleFactor
      };
      return {
        surfaceOrigin: expandedSurfaceOrigin,
        bounds: resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin({
          surfaceOrigin: expandedSurfaceOrigin,
          envelope: expandedTargetEnvelope,
          contentScale: 1,
          scaleFactor
        })
      };
    };
    let expandedFrame = resolveExpandedFrame(initialScaleFactor);
    surfaceOriginRef.current = expandedFrame.surfaceOrigin;
    await commitAppliedEnvelope(expandedTargetEnvelope, false, onRenderCommit);
  }, [
    activeContext.initialBounds,
    canvasMetrics.left,
    canvasMetrics.top,
    commitAppliedEnvelope,
    expandedEnvelope.current,
    ownerMeasurement,
    ownerPlacement?.x,
    ownerPlacement?.y,
    setup?.collapsedBoundsEnvelope,
    storedCollapsedEnvelope.resting,
    surface
  ]);

  useEffect(() => {
    if (!geometryInitialized || dragging) return;
    let cancelled = false;
    pendingEnvelopeRef.current = null;
    void (async () => {
      await scheduleNativeGeometryTransition(async () => {
        if (expanded) {
          await applyExpandedGeometry(() => {
            appliedExpandedRef.current = true;
            if (!cancelled) setRenderedExpanded(true);
          });
          return;
        }
        setRenderedExpanded(false);
        await waitForAppliedButtonWindowRender();
        if (cancelled) return;
        await applyCollapsedGeometry(() => {
          appliedExpandedRef.current = false;
        });
      });
    })().catch((geometryError) => {
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
    expanded,
    geometryInitialized,
    geometryRefreshToken,
    scheduleNativeGeometryTransition,
    setup?.id
  ]);

  useEffect(() => {
    if (
      !geometryInitialized ||
      dragging ||
      appliedExpandedRef.current !== expanded ||
      renderedExpanded !== expanded
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
          collapsedBoundsRef.current = savedRestingFrame.bounds;
          surfaceOriginRef.current = null;
          await commitAppliedEnvelope(windowEnvelope.resting, true);
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
        const bounds = appliedFrameBoundsRef.current;
        if (
          cancelled ||
          !bounds ||
          !buttonWindowRectsEqual(appliedEnvelopeRef.current, windowEnvelope.resting)
        ) return;
        restingEnvelopeFrameRef.current = {
          envelope: windowEnvelope.resting,
          bounds
        };
        if (expanded) return;
        collapsedBoundsRef.current = bounds;
        writeRegisteredLayoutWindowSnapshotBounds(currentWindow.label, {
          Left: bounds.left,
          Top: bounds.top,
          Width: bounds.width,
          Height: bounds.height
        });
        if (activeContext.draftSessionId && setup) {
          await publishButtonRestingWindowBounds(activeContext.draftSessionId, {
            kind: "fan",
            fanSetupId: setup.id,
            fitMode: setup.windowFitMode ?? "surface",
            bounds,
            envelope: collapsedEnvelope.resting
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
    activeContext.draftSessionId,
    dragging,
    expanded,
    geometryInitialized,
    renderedExpanded,
    queueEnvelope,
    setup,
    collapsedEnvelope.resting,
    commitAppliedEnvelope,
    windowEnvelope.current,
    windowEnvelope.resting,
    windowEnvelope.transient,
    scheduleNativeGeometryTransition
  ]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const handleNativeHoverChange = useCallback(
    (hovered: boolean) => {
      if (!setup || dragging || spaceDragActive) {
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
      if (hovered && setup.openRule === "hover" && !expanded) {
        setExpanded(true);
        return;
      }
      if (!hovered && expanded && !pinned && setup.closeRule === "hover-out") {
        closeTimerRef.current = window.setTimeout(() => {
          closeTimerRef.current = null;
          setExpanded(false);
        }, 140);
      }
    },
    [dragging, expanded, pinned, setup, spaceDragActive]
  );

  useNativeButtonHitboxes({
    rootRef,
    broadPhaseRef: contentFrameRef,
    broadPhasePadding: 16,
    enabled: geometryInitialized && !dragging,
    onHoverChange: handleNativeHoverChange,
    onNativeSpaceChange: setNativeSpaceKeyActive
  });

  const handleOwnerActivate = useCallback(() => {
    if (expanded) {
      if (pinned) {
        setPinned(false);
        setExpanded(false);
      } else {
        setPinned(true);
      }
      return;
    }
    setPinned(true);
    setExpanded(true);
  }, [expanded, pinned]);

  const persistCollapsedAnchor = useCallback(async () => {
    if (!document || !setup) {
      return;
    }
    const currentWindow = getCurrentWindow();
    const nextBounds = collapsedBoundsRef.current ?? appliedFrameBoundsRef.current;
    if (!nextBounds) {
      return;
    }
    collapsedBoundsRef.current = nextBounds;
    restingEnvelopeFrameRef.current = {
      envelope: collapsedEnvelope.resting,
      bounds: nextBounds
    };
    const nextDocument: ButtonStateDocument = {
      ...document,
      fanSetups: {
        ...document.fanSetups,
        [setup.id]: {
          ...setup,
          collapsedPanelOwnerBounds: nextBounds,
          collapsedBoundsFitMode: setup.windowFitMode ?? "surface",
          collapsedBoundsEnvelope: collapsedEnvelope.resting
        }
      }
    };

    writeRegisteredLayoutWindowSnapshotBounds(currentWindow.label, {
      Left: nextBounds.left,
      Top: nextBounds.top,
      Width: nextBounds.width,
      Height: nextBounds.height
    });
    if (activeContext.draftSessionId) {
      await publishButtonRestingWindowBounds(activeContext.draftSessionId, {
        kind: "fan",
        fanSetupId: setup.id,
        fitMode: setup.windowFitMode ?? "surface",
        bounds: nextBounds,
        envelope: collapsedEnvelope.resting
      });
      await publishButtonDraft(activeContext.draftSessionId, nextDocument);
      return;
    }
    const saved = await saveButtonStateDocument(nextDocument, document.revision);
    await publishButtonCommit(saved);
  }, [activeContext.draftSessionId, collapsedEnvelope.resting, document, setup]);

  const handlePointerDownCapture = (event: ReactPointerEvent<HTMLElement>) => {
    if (!geometryInitialized || !spaceDragActive || dragging || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setDragging(true);
    setPinned(false);
    setExpanded(false);
    void (async () => {
      try {
        await getCurrentWindow().setIgnoreCursorEvents(true);
        pendingEnvelopeRef.current = null;
        await scheduleNativeGeometryTransition(async () => {
          setRenderedExpanded(false);
          await waitForAppliedButtonWindowRender();
          await applyCollapsedGeometry(() => {
            appliedExpandedRef.current = false;
          });
        });
        await queueEnvelope(collapsedEnvelope.resting);

        const initialPointer = await cursorPosition();
        const initialBounds = collapsedBoundsRef.current ?? appliedFrameBoundsRef.current;
        const initialSurfaceOrigin = surfaceOriginRef.current;
        if (!initialBounds || !initialSurfaceOrigin) {
          throw new Error("Could not read the Button Fan content frame for dragging.");
        }
        let nextBounds = initialBounds;
        while (await isNativePrimaryMouseButtonDown()) {
          const pointer = await cursorPosition().catch(() => initialPointer);
          const delta = {
            x: pointer.x - initialPointer.x,
            y: pointer.y - initialPointer.y
          };
          nextBounds = translateButtonDesktopBounds(initialBounds, delta);
          surfaceOriginRef.current = {
            x: initialSurfaceOrigin.x + delta.x,
            y: initialSurfaceOrigin.y + delta.y
          };
          collapsedBoundsRef.current = nextBounds;
          appliedFrameBoundsRef.current = nextBounds;
          restingEnvelopeFrameRef.current = {
            envelope: collapsedEnvelope.resting,
            bounds: nextBounds
          };
          setAppliedFrameBounds(nextBounds);
          await ensureCanvasContainsFrame(nextBounds);
          await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
        }

        const appliedCanvas = await applyCanvasForFrame(nextBounds);
        surfaceOriginRef.current = {
          x: nextBounds.left - collapsedEnvelope.resting.x * appliedCanvas.scaleFactor,
          y: nextBounds.top - collapsedEnvelope.resting.y * appliedCanvas.scaleFactor
        };
        nextBounds = resolvePhysicalButtonWindowEnvelopeAtSurfaceOrigin({
          surfaceOrigin: surfaceOriginRef.current,
          envelope: collapsedEnvelope.resting,
          contentScale: 1,
          scaleFactor: appliedCanvas.scaleFactor
        });
        collapsedBoundsRef.current = nextBounds;
        appliedFrameBoundsRef.current = nextBounds;
        restingEnvelopeFrameRef.current = {
          envelope: collapsedEnvelope.resting,
          bounds: nextBounds
        };
        setAppliedFrameBounds(nextBounds);
        await persistCollapsedAnchor();
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

  const renderedEnvelope = !renderedExpanded && appliedExpandedRef.current === true && appliedEnvelope
    ? {
        ...appliedEnvelope,
        x: appliedEnvelope.x - (ownerPlacement?.x ?? 0),
        y: appliedEnvelope.y - (ownerPlacement?.y ?? 0)
      }
    : appliedEnvelope ?? windowEnvelope.current;
  const contentFrameRect = canvasMetrics.ready
    ? buttonDesktopBoundsToCanvasRect(appliedFrameBounds, canvasMetrics)
    : null;

  return (
    <main
      ref={rootRef}
      className={[
        "button-fan-window",
        spaceDragActive ? "button-fan-window--space-drag" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerDownCapture={handlePointerDownCapture}
      aria-label={`Button fan for ${activeContext.panelName} — ${setup?.windowFitMode ?? "surface"} fit — ${activeContext.draftSessionId ? "live draft" : "saved state"}`}
    >
      {loading ? <div className="button-window-error">Loading Button fan...</div> : null}
      {error ? <div className="button-window-error">{error}</div> : null}
      {!loading && !error && !setup ? (
        <div className="button-window-error">Saved fan setup was not found.</div>
      ) : null}
      {runtimeError ? <div className="button-window-error">{runtimeError}</div> : null}
      {document && setup && contentFrameRect ? (
        <div
          ref={contentFrameRef}
          className="button-fan-window__content-frame"
          style={{
            left: contentFrameRect.left,
            top: contentFrameRect.top,
            width: contentFrameRect.width,
            height: contentFrameRect.height
          }}
        >
          <ButtonFanRenderer
            document={document}
            setup={setup}
            expanded={renderedExpanded}
            surfaceEnvelope={renderedEnvelope}
            onOwnerActivate={handleOwnerActivate}
            onPlacementMeasurement={(placementId, measurement) => {
              if (!renderedExpanded && placementId.includes(setup.panelOwnerButtonId)) {
                setOwnerMeasurement(measurement);
              }
            }}
            onPlacementVisualMeasurement={handlePlacementVisualMeasurement}
            onPreparePlacementVisualStateChange={preparePlacementVisualStateChange}
            onPlacementVisualStateChange={handlePlacementVisualStateChange}
          />
        </div>
      ) : null}
    </main>
  );
}

export default ButtonFanWindowPage;
