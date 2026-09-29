import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readRegisteredLayoutWindow, writeRegisteredLayoutWindowCloseOffset } from "../../lib/layoutSnapshots";
import {
  BUTTON_WINDOW_CLOSE_SIZE,
  buttonWindowClosePosition,
  closeControlOffsetFromPosition,
  closeControlPositionFromOffset,
  createButtonWindowCloseHover,
  isButtonWindowCloseOffset,
  type ButtonWindowCloseOffset
} from "./buttonWindowCloseControl";
import "./buttonWindowCloseControl.css";

export function useButtonWindowCloseControl(args: {
  enabled: boolean;
  spaceDown?: boolean;
  defaultOffset?: ButtonWindowCloseOffset;
  frame: { left: number; top: number; width: number; height: number } | null;
  onHoverChange: (hovered: boolean) => void;
  onError: (message: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState<ButtonWindowCloseOffset | undefined>(() => {
    const saved = readRegisteredLayoutWindow(getCurrentWindow().label)?.buttonCloseControlOffset;
    return isButtonWindowCloseOffset(saved) ? saved : args.defaultOffset;
  });
  const previousDefault = useRef(JSON.stringify(args.defaultOffset));
  const defaultsInitialized = useRef(false);
  const drag = useRef<{
    pointerId: number; x: number; y: number; left: number; top: number;
    original: ButtonWindowCloseOffset | undefined;
  } | null>(null);
  const suppressClick = useRef(false);
  const nativeHovered = useRef(false);
  const latest = useRef(args);
  latest.current = args;
  const [hover] = useState(() => createButtonWindowCloseHover({
    onVisible: setVisible,
    onHover: (hovered) => latest.current.onHoverChange(hovered)
  }));
  useEffect(() => {
    if (!args.enabled) hover.reset();
    return () => hover.reset();
  }, [args.enabled, hover]);
  useEffect(() => {
    if (!args.enabled) return;
    const next = JSON.stringify(args.defaultOffset);
    // The document arrives after mount. Seed its default only when no layout
    // position was restored; later editor changes are deliberate updates.
    if (!defaultsInitialized.current) {
      defaultsInitialized.current = true;
      previousDefault.current = next;
      if (offset === undefined) setOffset(args.defaultOffset);
      return;
    }
    if (previousDefault.current !== next) {
      previousDefault.current = next;
      setOffset(args.defaultOffset);
    }
  }, [args.enabled, args.defaultOffset]);
  useEffect(() => {
    writeRegisteredLayoutWindowCloseOffset(getCurrentWindow().label, offset);
  }, [offset]);

  const ratio = window.devicePixelRatio || 1;
  const preferred = args.frame
    ? offset ? closeControlPositionFromOffset(args.frame, offset, ratio)
      : buttonWindowClosePosition(args.frame, { width: window.innerWidth, height: window.innerHeight })
    : null;
  const clamp = (position: { left: number; top: number }) => ({
    left: Math.max(0, Math.min(position.left, window.innerWidth - BUTTON_WINDOW_CLOSE_SIZE)),
    top: Math.max(0, Math.min(position.top, window.innerHeight - BUTTON_WINDOW_CLOSE_SIZE))
  });
  const position = preferred ? clamp(preferred) : null;
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = drag.current;
    if (!session || session.pointerId !== event.pointerId || !args.frame) return;
    event.preventDefault();
    event.stopPropagation();
    const next = clamp({ left: session.left + event.clientX - session.x, top: session.top + event.clientY - session.y });
    setOffset(closeControlOffsetFromPosition(args.frame, next, ratio));
  };
  const finish = (event: ReactPointerEvent<HTMLButtonElement>, commit: boolean) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (commit) move(event);
    else setOffset(drag.current.original);
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const close = async () => {
    if (closing || dragging || args.spaceDown || suppressClick.current) return;
    setClosing(true);
    try {
      await getCurrentWindow().close();
    } catch (error) {
      setClosing(false);
      args.onError(`Could not close this window: ${String(error)}`);
    }
  };

  return {
    onHoverChange: (hovered: boolean) => {
      nativeHovered.current = hovered;
      hover.hover(hovered || drag.current !== null);
    },
    onButtonHoverChange: (target: HTMLElement | null) => {
      hover.buttonTarget(latest.current.enabled ? target : null);
    },
    control: (visible || args.spaceDown || dragging) && args.enabled && position ? (
      <button
        type="button"
        className="button-window-hover-close"
        data-button-window-close-control="true"
        data-close-control-dragging={dragging ? "true" : undefined}
        style={{ ...position, cursor: args.spaceDown || dragging ? "move" : "pointer" }}
        aria-label="Close this window"
        title="Close this window · Hold Space to move X"
        disabled={closing}
        onKeyDown={(event) => {
          if (event.code === "Space") event.preventDefault();
        }}
        onKeyUp={(event) => {
          if (event.code === "Space") event.preventDefault();
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          suppressClick.current = false;
          if (!args.spaceDown || event.button !== 0) return;
          event.preventDefault();
          suppressClick.current = true;
          drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ...position, original: offset };
          setDragging(true);
          hover.hover(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={move}
        onPointerUp={(event) => finish(event, true)}
        onPointerCancel={(event) => finish(event, false)}
        onLostPointerCapture={(event) => finish(event, false)}
        onClick={(event) => {
          event.stopPropagation();
          void close();
        }}
      >×</button>
    ) : null
  };
}
