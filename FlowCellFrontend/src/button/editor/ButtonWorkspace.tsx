import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import type {
  ButtonCoreMeasurement,
  ButtonEditorMode,
  ButtonPlacement,
  ButtonRecord,
  ButtonRect,
  ButtonStateDocument,
  ButtonToolField,
  ButtonVisualMeasurement,
  ButtonVisualState,
  ButtonWindowFitMode
} from "../types";
import { ButtonSurface } from "../ButtonSurface";
import { ButtonFanRenderer } from "../fan/ButtonFanRenderer";
import {
  buttonVisualStateNeedsWindowExpansion,
  resolveButtonWindowEnvelope
} from "../windows/buttonWindowGeometry";
import { ButtonEditOverlay } from "./ButtonEditOverlay";
import {
  buttonSpacingPixelsFromMillimeters,
  buttonRectsOverlap,
  buildButtonReorderRowCandidates,
  chooseButtonReorderRowCandidate,
  resolveButtonGroupTranslationAlongPath,
  type ButtonGroupTranslationDelta,
  type ButtonGroupTranslationOptions,
  type NamedButtonRect,
  type CompactButtonPlacement
} from "../geometry/buttonGeometry";
import { ButtonReorderOverlay } from "./ButtonReorderOverlay";
import {
  BUTTON_FAN_EDITOR_HOVER_CLOSE_DELAY_MS,
  createInitialButtonFanDisclosureState,
  reduceButtonFanDisclosure
} from "./buttonFanDisclosure";
import {
  buttonPlacementSizingPatch,
  type ButtonPlacementSizingMode
} from "./buttonSizeAssignments";

const EMPTY_TOOL_FIELDS: ButtonToolField[] = [];
const REORDER_SLOT_HYSTERESIS_PX = 12;
const WINDOW_FIT_PREVIEW_LABELS: Record<ButtonWindowFitMode, string> = {
  surface: "Window frame: Saved Surface",
  hitbox: "Window frame: All Button Hitboxes",
  visual: "Window frame: Current Button Visuals"
};

interface ButtonReorderPreview {
  movingPlacementId: string;
  candidateKey: string;
  orderedPlacementIds: string[];
  placements: CompactButtonPlacement[];
  movingRect: ButtonRect;
}

export type ButtonWorkspaceSelectionMode = "replace" | "add" | "toggle";

interface ButtonMarqueeInteraction {
  pointerId: number;
  start: { x: number; y: number };
  current: { x: number; y: number };
  selectionMode: ButtonWorkspaceSelectionMode;
}

interface ButtonGroupDragInteraction {
  pointerId: number;
  clientX: number;
  clientY: number;
  grabbedPlacementId: string;
  placements: NamedButtonRect[];
  lastPlacements: NamedButtonRect[];
  lastValidDelta: ButtonGroupTranslationDelta;
  options: ButtonGroupTranslationOptions;
  moved: boolean;
}

function measurementsEqual(
  left: ButtonCoreMeasurement | undefined,
  right: ButtonCoreMeasurement
): boolean {
  return Boolean(
    left &&
      Math.abs(left.width - right.width) <= 0.05 &&
      Math.abs(left.height - right.height) <= 0.05 &&
      Math.abs(left.visualOverflow.top - right.visualOverflow.top) <= 0.05 &&
      Math.abs(left.visualOverflow.right - right.visualOverflow.right) <= 0.05 &&
      Math.abs(left.visualOverflow.bottom - right.visualOverflow.bottom) <= 0.05 &&
      Math.abs(left.visualOverflow.left - right.visualOverflow.left) <= 0.05
  );
}

function visualStatesEqual(
  left: ButtonVisualState | undefined,
  right: ButtonVisualState
): boolean {
  return Boolean(
    left &&
      left.hovered === right.hovered &&
      left.pressed === right.pressed &&
      left.held === right.held &&
      left.play === right.play &&
      left.release === right.release &&
      left.error === right.error
  );
}

function marqueeRect(
  start: { x: number; y: number },
  current: { x: number; y: number }
): ButtonRect {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y)
  };
}

function pointerPlacementId(event: PointerEvent): string | null {
  for (const target of event.composedPath()) {
    if (!(target instanceof Element)) continue;
    const placementId = target.getAttribute("data-button-placement-id");
    if (placementId) return placementId;
  }
  return null;
}

export interface ButtonWorkspaceProps {
  document: ButtonStateDocument;
  surfaceId: string;
  mode: ButtonEditorMode;
  selectedPlacementIds: ReadonlySet<string>;
  focusedPlacementId?: string | null;
  onSelectPlacement: (placementId: string, event: PointerEvent | KeyboardEvent) => void;
  onSelectPlacements: (
    placementIds: readonly string[],
    selectionMode: ButtonWorkspaceSelectionMode
  ) => void;
  onPlacementRectChange: (
    placementId: string,
    rect: ButtonRect,
    sizingMode?: ButtonPlacementSizingMode
  ) => void;
  onPlacementRectsChange: (
    surfaceId: string,
    placements: readonly NamedButtonRect[]
  ) => void;
  onPlacementMeasurement?: (placementId: string, measurement: ButtonCoreMeasurement) => void;
  onPlacementNaturalMeasurement?: (placementId: string, measurement: ButtonCoreMeasurement) => void;
  onActivate?: (placementId: string, button: ButtonRecord, event: PointerEvent | KeyboardEvent) => void | Promise<void>;
  onOwnerActivate?: (placementId: string, button: ButtonRecord, event: PointerEvent | KeyboardEvent) => void | Promise<void>;
  selectedPlacementSizingMode?: ButtonPlacementSizingMode;
  reorderMode?: boolean;
  onPlacementOrderChange?: (
    surfaceId: string,
    orderedPlacementIds: readonly string[],
    placements: readonly CompactButtonPlacement[]
  ) => void;
}

export function ButtonWorkspace({
  document,
  surfaceId,
  mode,
  selectedPlacementIds,
  focusedPlacementId,
  onSelectPlacement,
  onSelectPlacements,
  onPlacementRectChange,
  onPlacementRectsChange,
  onPlacementMeasurement,
  onPlacementNaturalMeasurement,
  onActivate,
  onOwnerActivate,
  selectedPlacementSizingMode,
  reorderMode = false,
  onPlacementOrderChange
}: ButtonWorkspaceProps) {
  const [preview, setPreview] = useState<{
    placementId: string;
    rect: ButtonRect;
    sizingMode?: ButtonPlacementSizingMode;
  } | null>(null);
  const [groupPreview, setGroupPreview] = useState<NamedButtonRect[] | null>(null);
  const [marquee, setMarquee] = useState<ButtonMarqueeInteraction | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const marqueeRef = useRef<ButtonMarqueeInteraction | null>(null);
  marqueeRef.current = marquee;
  const groupDragRef = useRef<ButtonGroupDragInteraction | null>(null);
  const [reorderPreview, setReorderPreview] = useState<ButtonReorderPreview | null>(null);
  const reorderPreviewRef = useRef<ButtonReorderPreview | null>(null);
  reorderPreviewRef.current = reorderPreview;
  const [reorderBlockedReason, setReorderBlockedReason] = useState<string | null>(null);
  const [idleMeasurements, setIdleMeasurements] = useState<Record<string, ButtonCoreMeasurement>>({});
  const [currentMeasurements, setCurrentMeasurements] = useState<Record<string, ButtonCoreMeasurement>>({});
  const [naturalMeasurements, setNaturalMeasurements] = useState<Record<string, ButtonCoreMeasurement>>({});
  const [visualStates, setVisualStates] = useState<Record<string, ButtonVisualState>>({});
  const surface = document.surfaces[surfaceId];
  const unit = Object.values(document.popoutUnits).find((candidate) => candidate.surfaceId === surfaceId);
  const fanSetup = Object.values(document.fanSetups).find(
    (candidate) => candidate.fanSurfaceId === surfaceId
  );
  const unitOwnerPlacementId = unit && "ownerPlacementId" in unit && typeof unit.ownerPlacementId === "string"
    ? unit.ownerPlacementId
    : null;
  const unitInteractionMode = unit && "interactionMode" in unit && unit.interactionMode === "fan"
    ? "fan"
    : "pop";
  const fanOwnerPlacementId = fanSetup && surface
    ? surface.placementIds.find((placementId) =>
        document.placements[placementId]?.buttonId === fanSetup.panelOwnerButtonId
      ) ?? null
    : null;
  const ownerPlacementId = unitOwnerPlacementId ?? fanOwnerPlacementId;
  const orderedPlacementIds = useMemo(() => {
    if (!surface) return [];
    return surface.placementIds
      .filter((placementId) => Boolean(document.placements[placementId]))
      .sort((left, right) => {
        const leftPlacement = document.placements[left];
        const rightPlacement = document.placements[right];
        return leftPlacement.zIndex - rightPlacement.zIndex || left.localeCompare(right);
      });
  }, [document.placements, surface]);
  const visiblePlacementIds = useMemo(
    () => orderedPlacementIds.filter((placementId) =>
      !(unitOwnerPlacementId === placementId && unitInteractionMode !== "fan")
    ),
    [orderedPlacementIds, unitInteractionMode, unitOwnerPlacementId]
  );
  const visiblePlacementIdSet = useMemo(() => new Set(visiblePlacementIds), [visiblePlacementIds]);
  const reorderablePlacementIds = useMemo(
    () => visiblePlacementIds.filter((placementId) => placementId !== ownerPlacementId),
    [ownerPlacementId, visiblePlacementIds]
  );
  const selectedVisiblePlacementIds = useMemo(
    () => visiblePlacementIds.filter((placementId) => selectedPlacementIds.has(placementId)),
    [selectedPlacementIds, visiblePlacementIds]
  );
  const selectedPlacementId = focusedPlacementId &&
    selectedPlacementIds.has(focusedPlacementId) &&
    visiblePlacementIdSet.has(focusedPlacementId)
      ? focusedPlacementId
      : selectedVisiblePlacementIds[0];
  const selectedPlacement = selectedPlacementId ? document.placements[selectedPlacementId] : undefined;
  const renderedDocument = useMemo(() => {
    let overrides: Record<string, Partial<ButtonPlacement>> | null = null;
    if (reorderPreview) {
      overrides = Object.fromEntries(reorderPreview.placements.map((item) => [
        item.id,
        { ...item.rect, zIndex: item.zIndex }
      ]));
      overrides[reorderPreview.movingPlacementId] = {
        ...reorderPreview.movingRect,
        zIndex: 19_999
      };
    } else if (groupPreview) {
      overrides = Object.fromEntries(groupPreview.map((placement) => [
        placement.id,
        placement.rect
      ]));
    } else if (preview) {
      overrides = {
        [preview.placementId]: {
          ...preview.rect,
          ...(preview.sizingMode
            ? buttonPlacementSizingPatch({
                width: preview.rect.width,
                height: preview.rect.height,
                sizingMode: preview.sizingMode
              })
            : {})
        }
      };
    }
    const hidesPopOwner = Boolean(
      surface &&
      unitOwnerPlacementId &&
      unitInteractionMode !== "fan"
    );
    const baseDocument = hidesPopOwner && surface
      ? {
          ...document,
          surfaces: {
            ...document.surfaces,
            [surface.id]: {
              ...surface,
              placementIds: [...visiblePlacementIds]
            }
          }
        }
      : document;
    if (!overrides) return baseDocument;
    // Shallow override only previewed placements: a deep clone would give every
    // skin/button a new identity on each pointer move and remount every skin.
    const placements = { ...baseDocument.placements };
    Object.entries(overrides).forEach(([placementId, patch]) => {
      const placement = baseDocument.placements[placementId];
      if (placement) placements[placementId] = { ...placement, ...patch };
    });
    return {
      ...baseDocument,
      placements
    };
  }, [
    document,
    groupPreview,
    preview,
    reorderPreview,
    surface,
    unitInteractionMode,
    unitOwnerPlacementId,
    visiblePlacementIds
  ]);
  const windowFitPreviewMode = unit
    ? unit.windowFitMode ?? "surface"
    : fanSetup
      ? fanSetup.windowFitMode ?? "surface"
      : undefined;
  const [fanDisclosure, setFanDisclosure] = useState(() =>
    createInitialButtonFanDisclosureState(fanSetup)
  );
  const fanCloseTimerRef = useRef<number | null>(null);
  const fanOwnerPlacement = fanSetup
    ? surface?.placementIds
        .map((placementId) => document.placements[placementId])
        .find((placement) => placement?.buttonId === fanSetup.panelOwnerButtonId)
    : undefined;

  const clearFanCloseTimer = useCallback(() => {
    if (fanCloseTimerRef.current !== null) {
      window.clearTimeout(fanCloseTimerRef.current);
      fanCloseTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearFanCloseTimer();
    setFanDisclosure((current) =>
      reduceButtonFanDisclosure(current, { type: "reset" }, fanSetup)
    );
  }, [
    clearFanCloseTimer,
    fanSetup?.closeRule,
    fanSetup?.id,
    fanSetup?.openRule,
    fanSetup?.pinnedDefault,
    mode
  ]);

  useEffect(() => clearFanCloseTimer, [clearFanCloseTimer]);

  const handleFanHoverStart = useCallback(() => {
    clearFanCloseTimer();
    setFanDisclosure((current) =>
      reduceButtonFanDisclosure(current, { type: "hover-enter" }, fanSetup)
    );
  }, [clearFanCloseTimer, fanSetup]);

  const handleFanHoverEnd = useCallback(() => {
    clearFanCloseTimer();
    if (fanSetup?.closeRule !== "hover-out") {
      setFanDisclosure((current) =>
        reduceButtonFanDisclosure(current, { type: "hover-leave" }, fanSetup)
      );
      return;
    }
    fanCloseTimerRef.current = window.setTimeout(() => {
      fanCloseTimerRef.current = null;
      setFanDisclosure((current) =>
        reduceButtonFanDisclosure(current, { type: "hover-leave" }, fanSetup)
      );
    }, BUTTON_FAN_EDITOR_HOVER_CLOSE_DELAY_MS);
  }, [clearFanCloseTimer, fanSetup]);

  const handleFanOwnerActivate = useCallback(() => {
    clearFanCloseTimer();
    setFanDisclosure((current) =>
      reduceButtonFanDisclosure(current, { type: "owner-activate" }, fanSetup)
    );
  }, [clearFanCloseTimer, fanSetup]);

  const buildReorderCandidates = useCallback((
    movingPlacementId: string,
    movingRect: ButtonRect
  ) => {
    if (!surface) return { candidates: [], reason: "Select a Button surface first." };
    const movingPlacement = document.placements[movingPlacementId];
    if (!movingPlacement || !reorderablePlacementIds.includes(movingPlacementId)) {
      return { candidates: [], reason: "The dragged Button placement no longer exists." };
    }
    const sourceItems = reorderablePlacementIds.flatMap((placementId) => {
      const placement = document.placements[placementId];
      return placement ? [{ id: placement.id, rect: placement }] : [];
    });
    if (sourceItems.length !== reorderablePlacementIds.length) {
      return { candidates: [], reason: "A Button placement disappeared while reordering." };
    }
    return buildButtonReorderRowCandidates({
      placements: sourceItems,
      movingPlacementId,
      movingRect,
      surface,
      gap: buttonSpacingPixelsFromMillimeters(document.settings.buttonSpacingMm)
    });
  }, [
    document.placements,
    document.settings.buttonSpacingMm,
    reorderablePlacementIds,
    surface
  ]);

  const previewPlacementOrder = useCallback((
    movingPlacementId: string,
    pointerRect: ButtonRect
  ) => {
    if (!surface) return;
    const placement = document.placements[movingPlacementId];
    if (!placement) return;
    const pointerMovingRect = {
      x: pointerRect.x,
      y: pointerRect.y,
      width: placement.width,
      height: placement.height
    };
    const movingRect = {
      x: Math.min(
        Math.max(0, pointerRect.x),
        Math.max(0, surface.width - placement.width)
      ),
      y: Math.min(
        Math.max(0, pointerRect.y),
        Math.max(0, surface.height - placement.height)
      ),
      width: placement.width,
      height: placement.height
    };
    const result = buildReorderCandidates(movingPlacementId, pointerMovingRect);
    if (result.candidates.length === 0) {
      setReorderBlockedReason(result.reason ?? "The Buttons do not fit inside the selected surface.");
      return;
    }
    const current = reorderPreviewRef.current;
    const chosen = chooseButtonReorderRowCandidate(
      result.candidates,
      current?.movingPlacementId === movingPlacementId ? current.candidateKey : null,
      REORDER_SLOT_HYSTERESIS_PX
    );
    if (!chosen) return;
    const nextPreview: ButtonReorderPreview = {
      movingPlacementId,
      candidateKey: chosen.key,
      orderedPlacementIds: chosen.orderedPlacementIds,
      placements: chosen.placements,
      movingRect
    };
    reorderPreviewRef.current = nextPreview;
    setReorderPreview(nextPreview);
    setReorderBlockedReason(null);
  }, [buildReorderCandidates, document.placements, surface]);

  const clearReorderPreview = useCallback(() => {
    reorderPreviewRef.current = null;
    setReorderPreview(null);
    setReorderBlockedReason(null);
  }, []);

  const commitPlacementOrder = useCallback(() => {
    const result = reorderPreviewRef.current;
    if (!result) return;
    let reorderedIndex = 0;
    const reorderableSet = new Set(reorderablePlacementIds);
    const mergedOrder = orderedPlacementIds.map((placementId) =>
      reorderableSet.has(placementId)
        ? result.orderedPlacementIds[reorderedIndex++] ?? placementId
        : placementId
    );
    const reorderedById = new Map(result.placements.map((placement) => [placement.id, placement]));
    const mergedPlacements = mergedOrder.flatMap((placementId, index) => {
      const reordered = reorderedById.get(placementId);
      if (reordered) return [{ ...reordered, zIndex: index }];
      const placement = document.placements[placementId];
      return placement
        ? [{ id: placement.id, rect: placement, zIndex: index }]
        : [];
    });
    onPlacementOrderChange?.(
      surfaceId,
      mergedOrder,
      mergedPlacements
    );
    clearReorderPreview();
  }, [
    clearReorderPreview,
    document.placements,
    onPlacementOrderChange,
    orderedPlacementIds,
    reorderablePlacementIds,
    surfaceId
  ]);

  useEffect(() => {
    setPreview(null);
    setGroupPreview(null);
    setMarquee(null);
    marqueeRef.current = null;
    groupDragRef.current = null;
    reorderPreviewRef.current = null;
    setReorderPreview(null);
    setReorderBlockedReason(null);
  }, [mode, reorderMode, surfaceId]);

  const clientPointToSurface = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !surface) return null;
    const surfaceElement = canvas.querySelector<HTMLElement>("[data-button-surface-id]");
    const bounds = (surfaceElement ?? canvas).getBoundingClientRect();
    const scaleX = bounds.width > 0 ? surface.width / bounds.width : 1;
    const scaleY = bounds.height > 0 ? surface.height / bounds.height : 1;
    return {
      x: Math.min(surface.width, Math.max(0, (clientX - bounds.left) * scaleX)),
      y: Math.min(surface.height, Math.max(0, (clientY - bounds.top) * scaleY))
    };
  }, [surface]);

  const beginSelectedGroupDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      mode !== "edit" ||
      reorderMode ||
      event.button !== 0 ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      selectedVisiblePlacementIds.length <= 1 ||
      !surface
    ) return;
    const grabbedPlacementId = pointerPlacementId(event.nativeEvent);
    if (!grabbedPlacementId || !selectedPlacementIds.has(grabbedPlacementId)) return;
    const placements = selectedVisiblePlacementIds.flatMap((placementId) => {
      const placement = document.placements[placementId];
      return placement ? [{ id: placement.id, rect: placement }] : [];
    });
    if (placements.length !== selectedVisiblePlacementIds.length) return;
    const selectedSet = new Set(selectedVisiblePlacementIds);
    const otherRects = visiblePlacementIds.flatMap((placementId) => {
      if (selectedSet.has(placementId)) return [];
      const placement = document.placements[placementId];
      return placement ? [placement] : [];
    });
    const options: ButtonGroupTranslationOptions = {
      surface,
      otherRects,
      tolerance: document.settings.snapTolerance,
      gridSize: document.settings.gridSize,
      anchorPlacementId: grabbedPlacementId
    };
    groupDragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      grabbedPlacementId,
      placements,
      lastPlacements: placements,
      lastValidDelta: { x: 0, y: 0 },
      options,
      moved: false
    };
    onSelectPlacement(grabbedPlacementId, event.nativeEvent);
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [
    document.placements,
    document.settings.gridSize,
    document.settings.snapTolerance,
    mode,
    onSelectPlacement,
    reorderMode,
    selectedPlacementIds,
    selectedVisiblePlacementIds,
    surface,
    visiblePlacementIds
  ]);

  const beginMarquee = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      mode !== "edit" ||
      reorderMode ||
      event.button !== 0 ||
      event.target !== event.currentTarget
    ) return;
    const point = clientPointToSurface(event.clientX, event.clientY);
    if (!point) return;
    const selectionMode: ButtonWorkspaceSelectionMode = event.ctrlKey || event.metaKey || event.shiftKey
      ? "toggle"
      : "replace";
    const interaction: ButtonMarqueeInteraction = {
      pointerId: event.pointerId,
      start: point,
      current: point,
      selectionMode
    };
    marqueeRef.current = interaction;
    setMarquee(interaction);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [clientPointToSurface, mode, reorderMode]);

  const moveCanvasPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const groupDrag = groupDragRef.current;
    if (groupDrag?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      const resolution = resolveButtonGroupTranslationAlongPath(
        groupDrag.placements,
        groupDrag.lastValidDelta,
        {
          x: event.clientX - groupDrag.clientX,
          y: event.clientY - groupDrag.clientY
        },
        groupDrag.options
      );
      if (
        Math.abs(resolution.delta.x - groupDrag.lastValidDelta.x) <= 0.001 &&
        Math.abs(resolution.delta.y - groupDrag.lastValidDelta.y) <= 0.001
      ) return;
      groupDrag.lastValidDelta = resolution.delta;
      groupDrag.lastPlacements = resolution.placements;
      groupDrag.moved = groupDrag.moved ||
        Math.abs(resolution.delta.x) > 0.001 ||
        Math.abs(resolution.delta.y) > 0.001;
      setGroupPreview(resolution.placements);
      return;
    }

    const marqueeInteraction = marqueeRef.current;
    if (marqueeInteraction?.pointerId !== event.pointerId) return;
    const point = clientPointToSurface(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    const next = { ...marqueeInteraction, current: point };
    marqueeRef.current = next;
    setMarquee(next);
  }, [clientPointToSurface]);

  const finishCanvasPointer = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
    commit: boolean
  ) => {
    const groupDrag = groupDragRef.current;
    if (groupDrag?.pointerId === event.pointerId) {
      groupDragRef.current = null;
      event.preventDefault();
      event.stopPropagation();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setGroupPreview(null);
      if (commit && groupDrag.moved) {
        onPlacementRectsChange(surfaceId, groupDrag.lastPlacements);
      }
      return;
    }

    const marqueeInteraction = marqueeRef.current;
    if (marqueeInteraction?.pointerId !== event.pointerId) return;
    marqueeRef.current = null;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setMarquee(null);
    if (!commit) return;
    const selectionRect = marqueeRect(
      marqueeInteraction.start,
      marqueeInteraction.current
    );
    const placementIds = visiblePlacementIds.filter((placementId) => {
      const placement = document.placements[placementId];
      return Boolean(placement && buttonRectsOverlap(selectionRect, placement));
    });
    onSelectPlacements(placementIds, marqueeInteraction.selectionMode);
  }, [document.placements, onPlacementRectsChange, onSelectPlacements, surfaceId, visiblePlacementIds]);

  const handlePlacementMeasurement = useCallback((
    placementId: string,
    measurement: ButtonCoreMeasurement
  ) => {
    if (
      preview?.placementId === placementId ||
      groupPreview?.some((item) => item.id === placementId) ||
      reorderPreview?.placements.some((item) => item.id === placementId)
    ) return;
    onPlacementMeasurement?.(placementId, measurement);
  }, [groupPreview, onPlacementMeasurement, preview?.placementId, reorderPreview?.placements]);

  const handlePlacementNaturalMeasurement = useCallback((
    placementId: string,
    measurement: ButtonCoreMeasurement
  ) => {
    setNaturalMeasurements((current) => measurementsEqual(current[placementId], measurement)
      ? current
      : { ...current, [placementId]: measurement });
    onPlacementNaturalMeasurement?.(placementId, measurement);
  }, [onPlacementNaturalMeasurement]);

  const handlePlacementVisualStateChange = useCallback((
    placementId: string,
    state: ButtonVisualState
  ) => {
    setVisualStates((current) => visualStatesEqual(current[placementId], state)
      ? current
      : { ...current, [placementId]: state });
  }, []);

  const handlePlacementVisualMeasurement = useCallback((
    placementId: string,
    measurement: ButtonVisualMeasurement
  ) => {
    const coreMeasurement: ButtonCoreMeasurement = {
      width: measurement.width,
      height: measurement.height,
      visualOverflow: measurement.visualOverflow
    };
    setCurrentMeasurements((current) => measurementsEqual(current[placementId], coreMeasurement)
      ? current
      : { ...current, [placementId]: coreMeasurement });
    if (!buttonVisualStateNeedsWindowExpansion(measurement.state)) {
      setIdleMeasurements((current) => measurementsEqual(current[placementId], coreMeasurement)
        ? current
        : { ...current, [placementId]: coreMeasurement });
    }
  }, []);

  useEffect(() => {
    setIdleMeasurements({});
    setCurrentMeasurements({});
    setNaturalMeasurements({});
    setVisualStates({});
  }, [surfaceId]);

  const windowFrame = useMemo(() => {
    if (!surface || !windowFitPreviewMode) return null;
    const placements = visiblePlacementIds
      .map((placementId) => renderedDocument.placements[placementId])
      .filter(Boolean);
    return resolveButtonWindowEnvelope({
      mode: windowFitPreviewMode,
      surfaceBounds: { x: 0, y: 0, width: surface.width, height: surface.height },
      placements,
      idleMeasurements,
      currentMeasurements,
      visualStates,
      visualOverflowAllowance: surface.visualOverflowAllowance,
      fixedRects: unit?.kind === "tool-set" ? unit.fields : []
    });
  }, [
    currentMeasurements,
    idleMeasurements,
    renderedDocument.placements,
    surface,
    unit,
    visiblePlacementIds,
    visualStates,
    windowFitPreviewMode
  ]);

  if (!surface) return <div className="button-editor-empty">Select a Button surface.</div>;
  const overlayPlacement = selectedPlacement && renderedDocument.placements[selectedPlacement.id];
  const overlayNaturalMeasurement = overlayPlacement
    ? naturalMeasurements[overlayPlacement.id]
    : undefined;
  const overlayNaturalAspectRatio = (
    overlayNaturalMeasurement &&
    overlayNaturalMeasurement.width > 0 &&
    overlayNaturalMeasurement.height > 0
  )
    ? overlayNaturalMeasurement.width / overlayNaturalMeasurement.height
    : undefined;
  const otherRects = visiblePlacementIds
    .filter((id) => id !== selectedPlacementId)
    .map((id) => document.placements[id])
    .filter(Boolean);
  const overlayIsFanOwner = Boolean(
    overlayPlacement &&
    surface.kind === "fan" &&
    Object.values(document.fanSetups).some((setup) => (
      setup.fanSurfaceId === surface.id &&
      setup.panelOwnerButtonId === overlayPlacement.buttonId
    ))
  );
  const reorderDropSlot = reorderPreview?.placements.find(
    (placement) => placement.id === reorderPreview.movingPlacementId
  )?.rect ?? null;
  // A Fan owner may sit outside its surface in any direction. Pad the working
  // area by however far the content escapes so it stays visible and reachable.
  const outsideOverflow = visiblePlacementIds.reduce((widest, placementId) => {
    const placement = renderedDocument.placements[placementId];
    if (!placement) return widest;
    return Math.max(
      widest,
      -placement.x,
      -placement.y,
      placement.x + placement.width - surface.width,
      placement.y + placement.height - surface.height
    );
  }, 0);
  const workspacePadding = Math.max(
    16,
    windowFitPreviewMode ? Math.max(40, surface.visualOverflowAllowance + 16) : 0,
    Math.ceil(outsideOverflow) + 16
  );

  return (
    <div className="button-workspace-shell">
      <div
        className="button-workspace-scroll"
        style={{ padding: workspacePadding }}
        >
          <div
          ref={canvasRef}
          className={`button-workspace-canvas${mode === "edit" && reorderMode ? " is-reorder-mode" : ""}`}
          style={{ width: surface.width, height: surface.height }}
          onPointerDownCapture={beginSelectedGroupDrag}
          onPointerDown={beginMarquee}
          onPointerMove={moveCanvasPointer}
          onPointerUp={(event) => finishCanvasPointer(event, true)}
          onPointerCancel={(event) => finishCanvasPointer(event, false)}
          onLostPointerCapture={(event) => finishCanvasPointer(event, false)}
        >
          {mode === "run" && fanSetup ? (
            <div
              style={{
                position: "absolute",
                left: fanDisclosure.expanded ? 0 : fanOwnerPlacement?.x ?? 0,
                top: fanDisclosure.expanded ? 0 : fanOwnerPlacement?.y ?? 0
              }}
            >
              <ButtonFanRenderer
                document={renderedDocument}
                setup={fanSetup}
                expanded={fanDisclosure.expanded}
                onOwnerActivate={handleFanOwnerActivate}
                onHoverStart={handleFanHoverStart}
                onHoverEnd={handleFanHoverEnd}
                onHoverCancel={handleFanHoverEnd}
                onPlacementNaturalMeasurement={handlePlacementNaturalMeasurement}
                onPlacementVisualMeasurement={handlePlacementVisualMeasurement}
                onPlacementVisualStateChange={handlePlacementVisualStateChange}
              />
            </div>
          ) : (
            <ButtonSurface
              document={renderedDocument}
              surfaceId={surfaceId}
              mode={mode}
              selectedPlacementIds={selectedPlacementIds}
              fields={unit?.kind === "tool-set" ? unit.fields : EMPTY_TOOL_FIELDS}
              onSelectPlacement={onSelectPlacement}
              onActivate={onActivate}
              onOwnerActivate={onOwnerActivate}
              onPlacementMeasurement={handlePlacementMeasurement}
              onPlacementVisualMeasurement={handlePlacementVisualMeasurement}
              onPlacementVisualStateChange={handlePlacementVisualStateChange}
              onPlacementNaturalMeasurement={handlePlacementNaturalMeasurement}
            />
          )}
          {mode === "edit" ? selectedVisiblePlacementIds.map((placementId) => {
            const placement = renderedDocument.placements[placementId];
            if (!placement) return null;
            return (
              <div
                key={`selection-${placementId}`}
                className={`button-workspace-selection-indicator${focusedPlacementId === placementId ? " is-focused" : ""}`}
                data-button-selection-indicator={placementId}
                aria-hidden="true"
                style={{
                  left: placement.x,
                  top: placement.y,
                  width: placement.width,
                  height: placement.height
                }}
              />
            );
          }) : null}
          {windowFrame && windowFitPreviewMode ? (
            <div
              className={`button-workspace-envelope button-workspace-envelope--${windowFitPreviewMode}${windowFrame.transient ? " is-transient" : ""}`}
              style={{
                left: windowFrame.current.x,
                top: windowFrame.current.y,
                width: windowFrame.current.width,
                height: windowFrame.current.height
              }}
            >
              <span>
                {WINDOW_FIT_PREVIEW_LABELS[windowFitPreviewMode]}
                {windowFrame.transient ? " - active expansion" : ""}
              </span>
            </div>
          ) : null}
          {mode === "edit" && reorderMode && reorderBlockedReason ? (
            <div className="button-reorder-mode-hint is-blocked">
              {reorderBlockedReason}
            </div>
          ) : null}
          {reorderDropSlot ? (
            <div
              className="button-reorder-drop-slot"
              style={{
                left: reorderDropSlot.x,
                top: reorderDropSlot.y,
                width: reorderDropSlot.width,
                height: reorderDropSlot.height
              }}
            />
          ) : null}
          {mode === "edit" && marquee ? (() => {
            const rect = marqueeRect(marquee.start, marquee.current);
            return (
              <div
                className="button-workspace-marquee"
                style={{
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height
                }}
              />
            );
          })() : null}
          {mode === "edit" && reorderMode ? reorderablePlacementIds.map((placementId) => {
            const placement = renderedDocument.placements[placementId];
            const button = placement && document.buttons[placement.buttonId];
            if (!placement || !button) return null;
            return (
              <ButtonReorderOverlay
                key={placementId}
                placement={placement}
                label={button.label}
                selected={selectedPlacementIds.has(placementId)}
                onSelect={(event) => onSelectPlacement(placementId, event)}
                onDrag={(rect) => previewPlacementOrder(placementId, rect)}
                onCommit={commitPlacementOrder}
                onCancel={clearReorderPreview}
              />
            );
          }) : null}
          {mode === "edit" && !reorderMode && selectedVisiblePlacementIds.length === 1 && overlayPlacement && (
            <ButtonEditOverlay
              placement={overlayPlacement}
              surface={surface}
              otherRects={otherRects}
              gridSize={document.settings.gridSize}
              snapTolerance={document.settings.snapTolerance}
              sizingMode={selectedPlacementSizingMode}
              naturalAspectRatio={overlayNaturalAspectRatio}
              unbounded={overlayIsFanOwner}
              onSelect={(event) => onSelectPlacement(overlayPlacement.id, event)}
              onPreview={(rect, kind) => setPreview({
                placementId: overlayPlacement.id,
                rect,
                sizingMode: kind === "resize" ? selectedPlacementSizingMode : undefined
              })}
              onCommit={(rect, kind) => {
                setPreview(null);
                onPlacementRectChange(
                  overlayPlacement.id,
                  rect,
                  kind === "resize" ? selectedPlacementSizingMode : undefined
                );
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
