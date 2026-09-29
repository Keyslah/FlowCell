import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ButtonWindowCloseOffset } from "../windows/buttonWindowCloseControl";
import "../windows/buttonWindowCloseControl.css";

export function ButtonCloseControlFields({ offset, disabled, onChange }: {
  offset?: ButtonWindowCloseOffset;
  disabled: boolean;
  onChange: (offset: ButtonWindowCloseOffset | undefined) => void;
}) {
  return <fieldset disabled={disabled}>
    <legend>Close X position</legend>
    <span>Drag the red X in Edit mode. In an open window, hold Space and drag X. Save Layout keeps that window's position.</span>
    {(["x", "y"] as const).map((axis) => <label key={axis}>
      <span>{axis === "x" ? "Horizontal" : "Vertical"} offset (screen px)</span>
      <input key={`${axis}:${offset?.[axis]}`} aria-label={`Close X ${axis} offset`} type="number" step="1"
        defaultValue={offset?.[axis] ?? ""} placeholder="Automatic"
        onBlur={(event) => {
          if (!event.currentTarget.value.trim()) return;
          const value = Number(event.currentTarget.value);
          if (Number.isFinite(value)) onChange({ x: offset?.x ?? 0, y: offset?.y ?? 0, [axis]: value });
        }} />
    </label>)}
    <button type="button" onClick={() => onChange(undefined)}>Reset X position</button>
  </fieldset>;
}

export function ButtonCloseControlPreview({ offset, frame, onChange }: {
  offset?: ButtonWindowCloseOffset;
  frame: { x: number; y: number; width: number; height: number };
  onChange: (offset: ButtonWindowCloseOffset) => void;
}) {
  const ratio = window.devicePixelRatio || 1;
  const base = offset ?? { x: (frame.width + 10) * ratio, y: 0 };
  const [preview, setPreview] = useState<ButtonWindowCloseOffset | null>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; start: ButtonWindowCloseOffset } | null>(null);
  const shown = preview ?? base;
  const nextPosition = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = drag.current;
    return session ? { x: session.start.x + (event.clientX - session.x) * ratio, y: session.start.y + (event.clientY - session.y) * ratio } : null;
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
