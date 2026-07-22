import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { ButtonPlacement, ButtonRect, ButtonSurface } from "../types";
import {
  resolveAspectLockedButtonGeometryAlongPath,
  resolveButtonGeometryAlongPath
} from "../geometry/buttonGeometry";

export interface ButtonEditOverlayProps {
  placement: ButtonPlacement;
  surface: ButtonSurface;
  otherRects: readonly ButtonRect[];
  gridSize: number;
  snapTolerance: number;
  onPreview: (rect: ButtonRect) => void;
  onCommit: (rect: ButtonRect) => void;
}

interface Interaction {
  kind: "drag" | "resize";
  pointerId: number;
  clientX: number;
  clientY: number;
  start: ButtonRect;
  lastValid: ButtonRect;
}

export function ButtonEditOverlay({
  placement,
  surface,
  otherRects,
  gridSize,
  snapTolerance,
  onPreview,
  onCommit
}: ButtonEditOverlayProps) {
  const interactionRef = useRef<Interaction | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const begin = (kind: Interaction["kind"], event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    overlayRef.current?.setPointerCapture(event.pointerId);
    const start = {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height
    };
    interactionRef.current = {
      kind,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      start,
      lastValid: start
    };
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - interaction.clientX;
    const dy = event.clientY - interaction.clientY;
    const resized = {
      width: Math.max(gridSize, interaction.start.width + dx),
      height: Math.max(gridSize, interaction.start.height + dy)
    };
    const candidate = interaction.kind === "drag"
      ? { ...interaction.start, x: interaction.start.x + dx, y: interaction.start.y + dy }
      : { ...interaction.start, ...resized };
    const options = {
      surface,
      otherRects,
      tolerance: snapTolerance,
      gridSize,
      keepInsideSurface: true
    };
    const locksAspect = interaction.kind === "resize" &&
      ((placement.matchHitboxToSkin && !placement.allowStretching) || event.shiftKey);
    const resolution = locksAspect
      ? resolveAspectLockedButtonGeometryAlongPath(
          interaction.start,
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
    onPreview(resolution.rect);
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    event.preventDefault();
    interactionRef.current = null;
    if (overlayRef.current?.hasPointerCapture(event.pointerId)) {
      overlayRef.current.releasePointerCapture(event.pointerId);
    }
    onCommit(interaction.lastValid);
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
