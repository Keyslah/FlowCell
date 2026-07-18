import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  cursorPosition,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize
} from "@tauri-apps/api/window";
import type { ButtonAnimationWindowContext } from "../../lib/windowContext";
import type { ButtonDesktopBounds } from "../types";
import plusRiseSpriteUrl from "../../assets/button-animations/plus-rise.png";
import {
  buildPlusRiseAnimationFrames,
  BUTTON_ANIMATION_MINIMUM_EDITOR_WIDTH,
  getButtonActivationAnimationPreset,
  resizeButtonAnimationEditorBounds,
  type ButtonAnimationResizeDirection
} from "./buttonActivationAnimations";
import {
  hideCurrentButtonActivationAnimationWindow,
  listenForButtonAnimationWindowContextUpdates,
  publishButtonAnimationWindowReady
} from "./buttonAnimationWindows";
import "./buttonAnimationWindow.css";

const RESIZE_HANDLES: ReadonlyArray<{
  direction: ButtonAnimationResizeDirection;
  modifier: string;
}> = [
  { direction: "North", modifier: "north" },
  { direction: "NorthEast", modifier: "north-east" },
  { direction: "East", modifier: "east" },
  { direction: "SouthEast", modifier: "south-east" },
  { direction: "South", modifier: "south" },
  { direction: "SouthWest", modifier: "south-west" },
  { direction: "West", modifier: "west" },
  { direction: "NorthWest", modifier: "north-west" }
];

interface ActiveResize {
  sessionId: number;
  pointerId: number;
  direction: ButtonAnimationResizeDirection;
  initialBounds: ButtonDesktopBounds;
  minimumWidth: number;
}

export interface ButtonAnimationWindowPageProps {
  context: ButtonAnimationWindowContext;
}

export default function ButtonAnimationWindowPage({
  context: initialContext
}: ButtonAnimationWindowPageProps) {
  const [context, setContext] = useState(initialContext);
  const [contextArmed, setContextArmed] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const playbackAnimationRef = useRef<Animation | null>(null);
  const activeResizeRef = useRef<ActiveResize | null>(null);
  const resizeSessionRef = useRef(0);
  const resizePendingRef = useRef(false);
  const resizeRunningRef = useRef(false);
  const preset = getButtonActivationAnimationPreset(context.presetId);
  const editing = context.mode === "edit";
  const stageStyle = {
    "--button-animation-sprite-top": `${(
      preset.playbackCanvas.topMarginSpriteHeights /
      preset.playbackCanvas.heightSpriteHeights
    ) * 100}%`,
    "--button-animation-sprite-height": `${(
      1 / preset.playbackCanvas.heightSpriteHeights
    ) * 100}%`
  } as CSSProperties;

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const hideWindow = useCallback(async (requestId: string) => {
    if (activeRequestIdRef.current !== requestId) return;
    clearHideTimer();
    await hideCurrentButtonActivationAnimationWindow();
  }, [clearHideTimer]);

  const startPlayback = useCallback(async (
    requestId: string,
    durationMs: number
  ) => {
    clearHideTimer();
    playbackAnimationRef.current?.cancel();
    playbackAnimationRef.current = null;
    await imageRef.current?.decode().catch(() => {});
    if (activeRequestIdRef.current !== requestId) return;
    const currentWindow = getCurrentWindow();
    await currentWindow.setIgnoreCursorEvents(true).catch(() => {});
    await currentWindow.setAlwaysOnTop(true).catch(() => {});
    await currentWindow.show().catch(() => {});
    if (activeRequestIdRef.current !== requestId || !imageRef.current) return;
    const animation = imageRef.current.animate(
      buildPlusRiseAnimationFrames().map((frame) => ({
        offset: frame.offset,
        opacity: frame.opacity,
        transform: `translate3d(0, ${frame.translateYPercent}%, 0) scale(${frame.scale})`
      })),
      {
        duration: durationMs,
        easing: "linear",
        fill: "both"
      }
    );
    playbackAnimationRef.current = animation;
    void animation.finished.then(() => {
      void hideWindow(requestId);
    }).catch(() => {});
    hideTimerRef.current = window.setTimeout(() => {
      void hideWindow(requestId);
    }, durationMs + 180);
  }, [clearHideTimer, hideWindow]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenForButtonAnimationWindowContextUpdates((nextContext) => {
      if (!disposed) {
        setContext(nextContext);
        setContextArmed(true);
      }
    }).then((next) => {
      if (disposed) {
        next();
      } else {
        unlisten = next;
        void publishButtonAnimationWindowReady();
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!contextArmed) return;
    activeRequestIdRef.current = context.requestId;
    if (context.mode === "play") {
      void startPlayback(context.requestId, preset.durationMs);
      return;
    }
    playbackAnimationRef.current?.cancel();
    playbackAnimationRef.current = null;
    clearHideTimer();
  }, [clearHideTimer, context, contextArmed, preset.durationMs, startPlayback]);

  useEffect(() => () => {
    activeRequestIdRef.current = null;
    playbackAnimationRef.current?.cancel();
    playbackAnimationRef.current = null;
    clearHideTimer();
  }, [clearHideTimer]);

  const processResize = useCallback(async () => {
    if (resizeRunningRef.current) {
      resizePendingRef.current = true;
      return;
    }
    resizeRunningRef.current = true;
    try {
      do {
        resizePendingRef.current = false;
        const activeResize = activeResizeRef.current;
        if (!activeResize) break;
        const cursor = await cursorPosition();
        if (activeResizeRef.current?.sessionId !== activeResize.sessionId) continue;
        const bounds = resizeButtonAnimationEditorBounds({
          presetId: context.presetId,
          bounds: activeResize.initialBounds,
          direction: activeResize.direction,
          cursor,
          minimumWidth: activeResize.minimumWidth
        });
        const currentWindow = getCurrentWindow();
        await currentWindow.setPosition(new PhysicalPosition(bounds.left, bounds.top));
        await currentWindow.setSize(new PhysicalSize(bounds.width, bounds.height));
      } while (resizePendingRef.current);
    } finally {
      resizeRunningRef.current = false;
    }
  }, [context.presetId]);

  const handleDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("button, .button-animation-window__resize-handle")
    ) {
      return;
    }
    event.preventDefault();
    void getCurrentWindow().startDragging().catch(() => {});
  };

  const startResizeDrag =
    (direction: ButtonAnimationResizeDirection) => (
      event: ReactPointerEvent<HTMLDivElement>
    ) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const handle = event.currentTarget;
      const pointerId = event.pointerId;
      const sessionId = ++resizeSessionRef.current;
      handle.setPointerCapture(pointerId);
      void (async () => {
        const currentWindow = getCurrentWindow();
        const [position, size, scaleFactor] = await Promise.all([
          currentWindow.outerPosition(),
          currentWindow.innerSize(),
          currentWindow.scaleFactor().catch(() => 1)
        ]);
        if (
          resizeSessionRef.current !== sessionId ||
          !handle.hasPointerCapture(pointerId)
        ) {
          return;
        }
        const scale = Number.isFinite(scaleFactor) && scaleFactor > 0
          ? scaleFactor
          : 1;
        activeResizeRef.current = {
          sessionId,
          pointerId,
          direction,
          initialBounds: {
            left: position.x,
            top: position.y,
            width: size.width,
            height: size.height
          },
          minimumWidth: BUTTON_ANIMATION_MINIMUM_EDITOR_WIDTH * scale
        };
      })().catch(() => {});
    };

  const continueResizeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activeResizeRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    resizePendingRef.current = true;
    void processResize();
  };

  const endResizeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      activeResizeRef.current?.pointerId !== event.pointerId &&
      !event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      return;
    }
    resizeSessionRef.current += 1;
    activeResizeRef.current = null;
    resizePendingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className={`button-animation-window button-animation-window--${context.mode}`}
      onPointerDown={editing ? handleDragStart : undefined}
    >
      <div className="button-animation-window__stage" style={stageStyle}>
        <img
          key={`${context.mode}-${context.requestId}`}
          ref={imageRef}
          className="button-animation-window__sprite"
          src={plusRiseSpriteUrl}
          alt=""
          draggable={false}
        />
      </div>
      {editing && RESIZE_HANDLES.map(({ direction, modifier }) => (
        <div
          key={direction}
          className={`button-animation-window__resize-handle button-animation-window__resize-handle--${modifier}`}
          onPointerDown={startResizeDrag(direction)}
          onPointerMove={continueResizeDrag}
          onPointerUp={endResizeDrag}
          onPointerCancel={endResizeDrag}
        />
      ))}
    </div>
  );
}
