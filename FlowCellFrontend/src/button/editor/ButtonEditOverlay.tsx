import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { ButtonPlacement, ButtonRect, ButtonSurface } from "../types";
import {
  resolveAspectLockedButtonGeometryAlongPath,
  resolveButtonGeometryAlongPath
} from "../geometry/buttonGeometry";
import {
  buttonPlacementSizingMode,
  buttonSizingModeLocksAspect,
  resolveProportionalResizeBasis,
  type ButtonPlacementSizingMode
} from "./buttonSizeAssignments";

export type ButtonEditInteractionKind = "drag" | "resize";

export interface ButtonEditOverlayProps {
  placement: ButtonPlacement;
  surface: ButtonSurface;
  otherRects: readonly ButtonRect[];
  gridSize: number;
  snapTolerance: number;
  sizingMode?: ButtonPlacementSizingMode;
  naturalAspectRatio?: number;
  /**
   * A Fan owner anchors its Fan instead of sitting inside it, so it moves to any
   * offset in any direction without being held inside the surface or pushed off
   * the Buttons it opens.
   */
  unbounded?: boolean;
  onSelect: (event: PointerEvent) => void;
  onPreview: (rect: ButtonRect, kind: ButtonEditInteractionKind) => void;
  onCommit: (rect: ButtonRect, kind: ButtonEditInteractionKind) => void;
}

interface Interaction {
  kind: ButtonEditInteractionKind;
  pointerId: number;
  clientX: number;
  clientY: number;
  start: ButtonRect;
  aspectStart: ButtonRect;
  lastValid: ButtonRect;
}

export function ButtonEditOverlay({
  placement,
  surface,
  otherRects,
  gridSize,
  snapTolerance,
  sizingMode,
  naturalAspectRatio,
  unbounded = false,
  onSelect,
  onPreview,
  onCommit
}: ButtonEditOverlayProps) {
  const interactionRef = useRef<Interaction | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const begin = (kind: Interaction["kind"], event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (
      kind === "drag" &&
      (event.shiftKey || event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault();
      event.stopPropagation();
      onSelect(event.nativeEvent);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    overlayRef.current?.setPointerCapture(event.pointerId);
    const start = {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height
    };
    const activeSizingMode = sizingMode ?? buttonPlacementSizingMode(placement);
    const proportionalBasis = kind === "resize" && activeSizingMode === "proportional"
      ? resolveProportionalResizeBasis(start, naturalAspectRatio)
      : start;
    interactionRef.current = {
      kind,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      start,
      aspectStart: { ...start, ...proportionalBasis },
      lastValid: start
    };
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - interaction.clientX;
    const dy = event.clientY - interaction.clientY;
    const interactionGridSize = interaction.kind === "resize" ? 1 : gridSize;
    const resized = {
      width: Math.max(1, interaction.start.width + dx),
      height: Math.max(1, interaction.start.height + dy)
    };
    const candidate = interaction.kind === "drag"
      ? { ...interaction.start, x: interaction.start.x + dx, y: interaction.start.y + dy }
      : { ...interaction.start, ...resized };
    const options = {
      surface,
      otherRects: unbounded ? [] : otherRects,
      tolerance: snapTolerance,
      gridSize: interactionGridSize,
      // A southeast resize handle owns width/height only. Its top-left anchor
      // must not jump to the movement grid while the user sizes continuously.
      snapPosition: interaction.kind === "resize" ? false : undefined,
      keepInsideSurface: !unbounded
    };
    const activeSizingMode = sizingMode ?? buttonPlacementSizingMode(placement);
    const locksAspect = interaction.kind === "resize" &&
      buttonSizingModeLocksAspect(activeSizingMode, event.shiftKey);
    const resolution = locksAspect
      ? resolveAspectLockedButtonGeometryAlongPath(
          interaction.aspectStart,
          interaction.lastValid,
          candidate,
          options
        )
      : resolveButtonGeometryAlongPath(interaction.lastValid, candidate, {
          ...options,
          // Moving a placement must never mutate its saved dimensions.
          snapSize: interaction.kind === "drag" ? false : undefined
        });
    if (
      resolution.rect.x === interaction.lastValid.x &&
      resolution.rect.y === interaction.lastValid.y &&
      resolution.rect.width === interaction.lastValid.width &&
      resolution.rect.height === interaction.lastValid.height
    ) return;
    interaction.lastValid = resolution.rect;
    onPreview(resolution.rect, interaction.kind);
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    interactionRef.current = null;
    if (overlayRef.current?.hasPointerCapture(event.pointerId)) {
      overlayRef.current.releasePointerCapture(event.pointerId);
    }
    onCommit(interaction.lastValid, interaction.kind);
  };

  return (
    <div
      ref={overlayRef}
      className="button-edit-overlay"
      data-button-edit-placement-id={placement.id}
      style={{
        position: "absolute",
        left: placement.x,
        top: placement.y,
        width: placement.width,
        height: placement.height,
        zIndex: Math.max(10_000, placement.zIndex + 1000),
        boxSizing: "border-box",
        border: "1px solid #8cc8ff",
        pointerEvents: "auto",
        touchAction: "none",
        cursor: "move"
      }}
      onPointerDown={(event) => begin("drag", event)}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    >
      <div
        className="button-edit-overlay__resize"
        aria-label="Resize Button"
        style={{
          position: "absolute",
          right: -5,
          bottom: -5,
          width: 10,
          height: 10,
          borderRadius: 2,
          background: "#8cc8ff",
          cursor: "nwse-resize"
        }}
        onPointerDown={(event) => begin("resize", event)}
      />
    </div>
  );
}
