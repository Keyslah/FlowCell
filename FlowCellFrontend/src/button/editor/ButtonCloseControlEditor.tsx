import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  BUTTON_WINDOW_CLOSE_GAP,
  closeControlOffsetFromPosition,
  closeControlPositionFromOffset,
  constrainButtonWindowClosePosition,
  type ButtonWindowCloseOffset
} from "../windows/buttonWindowCloseControl";
import "../windows/buttonWindowCloseControl.css";

export function ButtonCloseControlPreview({ offset, frame, onChange }: {
  offset?: ButtonWindowCloseOffset;
  frame: { x: number; y: number; width: number; height: number };
  onChange: (offset: ButtonWindowCloseOffset) => void;
}) {
  const ratio = window.devicePixelRatio || 1;
  const base = offset ?? { x: (frame.width + BUTTON_WINDOW_CLOSE_GAP) * ratio, y: 0 };
  const [preview, setPreview] = useState<ButtonWindowCloseOffset | null>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; start: ButtonWindowCloseOffset } | null>(null);
  const frameRect = { left: frame.x, top: frame.y, width: frame.width, height: frame.height };
  const constrain = (value: ButtonWindowCloseOffset) => closeControlOffsetFromPosition(
    frameRect,
    constrainButtonWindowClosePosition(frameRect, closeControlPositionFromOffset(frameRect, value, ratio)),
    ratio
  );
  const shown = constrain(preview ?? base);
  const nextPosition = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = drag.current;
    return session ? constrain({ x: session.start.x + (event.clientX - session.x) * ratio, y: session.start.y + (event.clientY - session.y) * ratio }) : null;
  };
  const finish = (event: ReactPointerEvent<HTMLButtonElement>, commit: boolean) => {
    if (!drag.current || drag.current.pointer !== event.pointerId) return;
    event.stopPropagation();
    const next = nextPosition(event);
    drag.current = null;
    setPreview(null);
    if (commit && next) onChange(next);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <button type="button" className="button-window-hover-close" data-close-control-editor="true"
    style={{ left: frame.x + shown.x / ratio, top: frame.y + shown.y / ratio, cursor: "move" }}
    aria-label="Move close X" title="Drag to position the window's close X"
    onPointerDown={(event) => {
      event.preventDefault(); event.stopPropagation();
      if (event.button !== 0) return;
      drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, start: shown };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => { if (drag.current) { event.stopPropagation(); setPreview(nextPosition(event)); } }}
    onPointerUp={(event) => finish(event, true)} onPointerCancel={(event) => finish(event, false)}
    onLostPointerCapture={(event) => finish(event, false)} onClick={(event) => event.stopPropagation()}
  >×</button>;
}
