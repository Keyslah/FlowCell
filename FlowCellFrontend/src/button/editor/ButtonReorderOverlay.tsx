import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { ButtonPlacement, ButtonRect } from "../types";

export interface ButtonReorderOverlayProps {
  placement: ButtonPlacement;
  label: string;
  selected: boolean;
  onSelect: (event: PointerEvent) => void;
  onDrag: (rect: ButtonRect) => void;
  onCommit: () => void;
  onCancel: () => void;
}

interface ReorderInteraction {
  pointerId: number;
  canvasLeft: number;
  canvasTop: number;
  startClientX: number;
  startClientY: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
  startRect: ButtonRect;
  dragging: boolean;
  pendingRect: ButtonRect | null;
  frameId: number | null;
  cleanup: () => void;
}

export function ButtonReorderOverlay({
  placement,
  label,
  selected,
  onSelect,
  onDrag,
  onCommit,
  onCancel
}: ButtonReorderOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<ReorderInteraction | null>(null);

  const move = (pointerId: number, clientX: number, clientY: number) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== pointerId) return;
    if (!interaction.dragging) {
      const distance = Math.hypot(
        clientX - interaction.startClientX,
        clientY - interaction.startClientY
      );
      if (distance < 4) return;
      interaction.dragging = true;
      overlayRef.current?.classList.add("is-dragging");
    }
    interaction.pendingRect = {
      ...interaction.startRect,
      x: clientX - interaction.canvasLeft - interaction.pointerOffsetX,
      y: clientY - interaction.canvasTop - interaction.pointerOffsetY
    };
    if (interaction.frameId !== null) return;
    interaction.frameId = window.requestAnimationFrame(() => {
      const current = interactionRef.current;
      if (!current || current !== interaction) return;
      current.frameId = null;
      const pendingRect = current.pendingRect;
      current.pendingRect = null;
      if (pendingRect) onDrag(pendingRect);
    });
  };

  const finish = (pointerId: number, commit: boolean) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== pointerId) return;
    interaction.cleanup();
    if (interaction.frameId !== null) {
      window.cancelAnimationFrame(interaction.frameId);
      interaction.frameId = null;
    }
    const pendingRect = interaction.pendingRect;
    interaction.pendingRect = null;
    if (commit && interaction.dragging && pendingRect) onDrag(pendingRect);
    interactionRef.current = null;
    overlayRef.current?.classList.remove("is-dragging");
    if (commit && interaction.dragging) onCommit();
    else onCancel();
  };

  const begin = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const canvasRect = overlayRef.current?.parentElement?.getBoundingClientRect();
    if (!canvasRect) return;
    if (event.pointerType !== "mouse") event.preventDefault();
    event.stopPropagation();
    onSelect(event.nativeEvent);
    const handlePointerMove = (pointerEvent: PointerEvent) => move(
      pointerEvent.pointerId,
      pointerEvent.clientX,
      pointerEvent.clientY
    );
    const handlePointerUp = (pointerEvent: PointerEvent) => finish(pointerEvent.pointerId, true);
    const handleMouseMove = (mouseEvent: MouseEvent) => move(
      event.pointerId,
      mouseEvent.clientX,
      mouseEvent.clientY
    );
    const handleMouseUp = () => finish(event.pointerId, true);
    const cleanup = event.pointerType === "mouse"
      ? () => {
          window.removeEventListener("mousemove", handleMouseMove, true);
          window.removeEventListener("mouseup", handleMouseUp, true);
        }
      : () => {
          window.removeEventListener("pointermove", handlePointerMove, true);
          window.removeEventListener("pointerup", handlePointerUp, true);
        };
    interactionRef.current = {
      pointerId: event.pointerId,
      canvasLeft: canvasRect.left,
      canvasTop: canvasRect.top,
      startClientX: event.clientX,
      startClientY: event.clientY,
      pointerOffsetX: event.clientX - canvasRect.left - placement.x,
      pointerOffsetY: event.clientY - canvasRect.top - placement.y,
      startRect: {
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height
      },
      dragging: false,
      pendingRect: null,
      frameId: null,
      cleanup
    };
    if (event.pointerType === "mouse") {
      window.addEventListener("mousemove", handleMouseMove, true);
      window.addEventListener("mouseup", handleMouseUp, true);
    } else {
      window.addEventListener("pointermove", handlePointerMove, true);
      window.addEventListener("pointerup", handlePointerUp, true);
    }
  };

  useEffect(() => () => {
    const interaction = interactionRef.current;
    if (interaction) {
      interaction.cleanup();
      if (interaction.frameId !== null) {
        window.cancelAnimationFrame(interaction.frameId);
      }
    }
  }, []);

  return (
    <div
      ref={overlayRef}
      className="button-reorder-overlay"
      data-selected={selected ? "true" : "false"}
      data-button-reorder-placement-id={placement.id}
      title={`Drag to reorder ${label}`}
      style={{
        left: placement.x,
        top: placement.y,
        width: placement.width,
        height: placement.height,
        zIndex: Math.max(20_000, placement.zIndex + 20_000)
      }}
      onPointerDown={begin}
    />
  );
}
