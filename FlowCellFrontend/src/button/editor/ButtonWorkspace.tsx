import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
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
  compactButtonPlacements,
  inferButtonPlacementRowProfile,
  type CompactButtonPlacement
} from "../geometry/buttonGeometry";
import { ButtonReorderOverlay } from "./ButtonReorderOverlay";
import {
  BUTTON_FAN_EDITOR_HOVER_CLOSE_DELAY_MS,
  createInitialButtonFanDisclosureState,
  reduceButtonFanDisclosure
} from "./buttonFanDisclosure";

const EMPTY_TOOL_FIELDS: ButtonToolField[] = [];
const REORDER_SLOT_HYSTERESIS_PX = 12;
const WINDOW_FIT_PREVIEW_LABELS: Record<ButtonWindowFitMode, string> = {
  surface: "Window frame: Saved Surface",
  hitbox: "Window frame: All Button Hitboxes",
  visual: "Window frame: Current Button Visuals"
};

interface ButtonReorderPreview {
  movingPlacementId: string;
  insertionIndex: number;
  orderedPlacementIds: string[];
  placements: CompactButtonPlacement[];
  movingRect: ButtonRect;
}

interface ButtonReorderCandidate {
  insertionIndex: number;
  orderedPlacementIds: string[];
  placements: CompactButtonPlacement[];
  slot: ButtonRect;
  distance: number;
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

export interface ButtonWorkspaceProps {
  document: ButtonStateDocument;
  surfaceId: string;
  mode: ButtonEditorMode;
  selectedPlacementIds: ReadonlySet<string>;
  onSelectPlacement: (placementId: string, event: PointerEvent | KeyboardEvent) => void;
  onPlacementRectChange: (placementId: string, rect: ButtonRect) => void;
  onPlacementMeasurement?: (placementId: string, measurement: ButtonCoreMeasurement) => void;
  onPlacementNaturalMeasurement?: (placementId: string, measurement: ButtonCoreMeasurement) => void;
  onActivate?: (placementId: string, button: ButtonRecord, event: PointerEvent | KeyboardEvent) => void | Promise<void>;
  onOwnerActivate?: (placementId: string, button: ButtonRecord, event: PointerEvent | KeyboardEvent) => void | Promise<void>;
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
  onSelectPlacement,
  onPlacementRectChange,
  onPlacementMeasurement,
  onPlacementNaturalMeasurement,
  onActivate,
  onOwnerActivate,
  reorderMode = false,
  onPlacementOrderChange
}: ButtonWorkspaceProps) {
  const [preview, setPreview] = useState<{ placementId: string; rect: ButtonRect } | null>(null);
  const [reorderPreview, setReorderPreview] = useState<ButtonReorderPreview | null>(null);
  const reorderPreviewRef = useRef<ButtonReorderPreview | null>(null);
  reorderPreviewRef.current = reorderPreview;
  const [reorderBlockedReason, setReorderBlockedReason] = useState<string | null>(null);
  const [idleMeasurements, setIdleMeasurements] = useState<Record<string, ButtonCoreMeasurement>>({});
  const [currentMeasurements, setCurrentMeasurements] = useState<Record<string, ButtonCoreMeasurement>>({});
  const [visualStates, setVisualStates] = useState<Record<string, ButtonVisualState>>({});
  const surface = document.surfaces[surfaceId];
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
  const selectedPlacementId = [...selectedPlacementIds][0];
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
    } else if (preview) {
      overrides = { [preview.placementId]: preview.rect };
    }
    if (!overrides) return document;
    // Shallow override only previewed placements: a deep clone would give every
    // skin/button a new identity on each pointer move and remount every skin.
    const placements = { ...document.placements };
    Object.entries(overrides).forEach(([placementId, patch]) => {
      const placement = document.placements[placementId];
      if (placement) placements[placementId] = { ...placement, ...patch };
    });
    return {
      ...document,
      placements
    };
  }, [document, preview, reorderPreview]);
  const unit = Object.values(document.popoutUnits).find((candidate) => candidate.surfaceId === surfaceId);
  const fanSetup = Object.values(document.fanSetups).find(
    (candidate) => candidate.fanSurfaceId === surfaceId
  );
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
  ): { candidates: ButtonReorderCandidate[]; reason: string | null } => {
    if (!surface) return { candidates: [], reason: "Select a Button surface first." };
    const movingPlacement = document.placements[movingPlacementId];
    if (!movingPlacement || !orderedPlacementIds.includes(movingPlacementId)) {
      return { candidates: [], reason: "The dragged Button placement no longer exists." };
    }
    const sourceItems = orderedPlacementIds.flatMap((placementId) => {
      const placement = document.placements[placementId];
      return placement ? [{ id: placement.id, rect: placement }] : [];
    });
    if (sourceItems.length !== orderedPlacementIds.length) {
      return { candidates: [], reason: "A Button placement disappeared while reordering." };
    }
    const anchorX = sourceItems.length > 0
      ? Math.min(...sourceItems.map((item) => item.rect.x))
      : 0;
    const anchorY = sourceItems.length > 0
      ? Math.min(...sourceItems.map((item) => item.rect.y))
      : 0;
    const remainingPlacementIds = orderedPlacementIds.filter(
      (placementId) => placementId !== movingPlacementId
    );
    const rowProfile = inferButtonPlacementRowProfile(sourceItems);
    const movingCenterX = movingRect.x + movingRect.width / 2;
    const movingCenterY = movingRect.y + movingRect.height / 2;
    const candidates: ButtonReorderCandidate[] = [];
    let reason: string | null = null;

    for (let insertionIndex = 0; insertionIndex <= remainingPlacementIds.length; insertionIndex += 1) {
      const nextOrder = [...remainingPlacementIds];
      nextOrder.splice(insertionIndex, 0, movingPlacementId);
      const compacted = compactButtonPlacements(
        nextOrder.map((placementId) => ({
          id: placementId,
          rect: document.placements[placementId]
        })),
        surface,
        { anchorX, anchorY, gap: 0, rowProfile }
      );
      if (!compacted.success) {
        reason = compacted.reason;
        continue;
      }
      const slot = compacted.placements.find((placement) => placement.id === movingPlacementId)?.rect;
      if (!slot) continue;
      candidates.push({
        insertionIndex,
        orderedPlacementIds: nextOrder,
        placements: compacted.placements,
        slot,
        distance: Math.hypot(
          movingCenterX - (slot.x + slot.width / 2),
          movingCenterY - (slot.y + slot.height / 2)
        )
      });
    }
    return { candidates, reason: candidates.length > 0 ? null : reason };
  }, [document.placements, orderedPlacementIds, surface]);

  const previewPlacementOrder = useCallback((
    movingPlacementId: string,
    pointerRect: ButtonRect
  ) => {
    if (!surface) return;
    const placement = document.placements[movingPlacementId];
    if (!placement) return;
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
    const result = buildReorderCandidates(movingPlacementId, movingRect);
    if (result.candidates.length === 0) {
      setReorderBlockedReason(result.reason ?? "The Buttons do not fit inside the selected surface.");
      return;
    }
    const best = [...result.candidates].sort((left, right) =>
      left.distance - right.distance || left.insertionIndex - right.insertionIndex
    )[0];
    const current = reorderPreviewRef.current;
    const sticky = current?.movingPlacementId === movingPlacementId
      ? result.candidates.find((candidate) => candidate.insertionIndex === current.insertionIndex)
      : null;
    const chosen = sticky && sticky.distance <= best.distance + REORDER_SLOT_HYSTERESIS_PX
      ? sticky
      : best;
    const nextPreview: ButtonReorderPreview = {
      movingPlacementId,
      insertionIndex: chosen.insertionIndex,
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
    onPlacementOrderChange?.(
      surfaceId,
      result.orderedPlacementIds,
      result.placements
    );
    clearReorderPreview();
  }, [clearReorderPreview, onPlacementOrderChange, surfaceId]);

  useEffect(() => {
    setPreview(null);
    reorderPreviewRef.current = null;
    setReorderPreview(null);
    setReorderBlockedReason(null);
  }, [mode, reorderMode, surfaceId]);

  const handlePlacementMeasurement = useCallback((
    placementId: string,
    measurement: ButtonCoreMeasurement
  ) => {
    if (
      preview?.placementId === placementId ||
      reorderPreview?.placements.some((item) => item.id === placementId)
    ) return;
    onPlacementMeasurement?.(placementId, measurement);
  }, [onPlacementMeasurement, preview?.placementId, reorderPreview?.placements]);

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
    setVisualStates({});
  }, [surfaceId]);

  const windowFrame = useMemo(() => {
    if (!surface || !windowFitPreviewMode) return null;
    const placements = surface.placementIds
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
    visualStates,
    windowFitPreviewMode
  ]);

  if (!surface) return <div className="button-editor-empty">Select a Button surface.</div>;
  const overlayPlacement = selectedPlacement && renderedDocument.placements[selectedPlacement.id];
  const otherRects = surface.placementIds
    .filter((id) => id !== selectedPlacementId)
    .map((id) => document.placements[id])
    .filter(Boolean);
  const reorderDropSlot = reorderPreview?.placements.find(
    (placement) => placement.id === reorderPreview.movingPlacementId
  )?.rect ?? null;

  return (
    <div className="button-workspace-shell">
      <div
        className="button-workspace-scroll"
        style={windowFitPreviewMode
          ? { padding: Math.max(40, surface.visualOverflowAllowance + 16) }
          : undefined}
      >
        <div
          className={`button-workspace-canvas${mode === "edit" && reorderMode ? " is-reorder-mode" : ""}`}
          style={{ width: surface.width, height: surface.height }}
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
              onPlacementNaturalMeasurement={onPlacementNaturalMeasurement}
            />
          )}
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
          {mode === "edit" && reorderMode ? (
            <div
              className={`button-reorder-mode-hint${reorderBlockedReason ? " is-blocked" : ""}`}
            >
              {reorderBlockedReason ?? "Reorder: drag a Button and the others will move out of the way"}
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
          {mode === "edit" && reorderMode ? orderedPlacementIds.map((placementId) => {
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
          {mode === "edit" && !reorderMode && overlayPlacement && (
            <ButtonEditOverlay
              placement={overlayPlacement}
              surface={surface}
              otherRects={otherRects}
              gridSize={document.settings.gridSize}
              snapTolerance={document.settings.snapTolerance}
              onPreview={(rect) => setPreview({ placementId: overlayPlacement.id, rect })}
              onCommit={(rect) => {
                setPreview(null);
                onPlacementRectChange(overlayPlacement.id, rect);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
