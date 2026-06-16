import { invoke } from "@tauri-apps/api/core";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { getCodexUsageSnapshot, type CodexUsageSnapshot } from "../../lib/codexUsage";
import type { CodexUsagePopoutWindowContext } from "../../lib/windowContext";
import {
  CODEX_USAGE_POPOUT_TEXT_SIZE,
  CODEX_USAGE_POPOUT_WINDOW_HEIGHT,
  CODEX_USAGE_POPOUT_WINDOW_WIDTH
} from "./codexUsagePopoutGeometry";
import "./codexUsagePopoutWindowPage.css";

type CodexUsagePopoutWindowPageProps = {
  context: CodexUsagePopoutWindowContext;
};

type ResizeDirection = "NorthEast" | "NorthWest" | "SouthEast" | "SouthWest";

type ResizeSession = {
  direction: ResizeDirection;
  pointerId: number;
  initialPointerX: number;
  initialPointerY: number;
  pointerCoordinateScale: number;
  initialLeft: number;
  initialTop: number;
  initialWidth: number;
  initialHeight: number;
};

const CODEX_USAGE_REFRESH_MS = 1_000;
const MIN_WINDOW_WIDTH = 120;
const MIN_WINDOW_HEIGHT = 32;

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

function formatUsagePercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "??%";
  }

  return `${Math.round(clampPercent(value))}%`;
}

function formatUsageText(snapshot: CodexUsageSnapshot | null): string {
  return [
    formatUsagePercent(snapshot?.fiveHourRemainingPercent),
    formatUsagePercent(snapshot?.weeklyRemainingPercent)
  ].join(" ");
}

export default function CodexUsagePopoutWindowPage({
  context
}: CodexUsagePopoutWindowPageProps) {
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  const resizeUpdateInFlightRef = useRef(false);
  const resizePollTimerRef = useRef<number | null>(null);
  const pendingResizeBoundsRef = useRef<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [snapshot, setSnapshot] = useState<CodexUsageSnapshot | null>(
    () => context.initialSnapshot ?? null
  );
  const [windowSize, setWindowSize] = useState(() => ({
    width: Math.max(window.innerWidth, 1),
    height: Math.max(window.innerHeight, 1)
  }));
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);

  const refreshUsage = useCallback(async () => {
    try {
      setSnapshot(await getCodexUsageSnapshot());
    } catch {
      setSnapshot(null);
    }
  }, []);

  useEffect(() => {
    void refreshUsage();
    const refreshIfVisible = () => {
      if (document.visibilityState !== "hidden") {
        void refreshUsage();
      }
    };
    const refreshTimerId = window.setInterval(() => {
      void refreshUsage();
    }, CODEX_USAGE_REFRESH_MS);

    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.clearInterval(refreshTimerId);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [refreshUsage]);

  useEffect(() => {
    const syncWindowSize = () => {
      setWindowSize({
        width: Math.max(window.innerWidth, 1),
        height: Math.max(window.innerHeight, 1)
      });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }

      event.preventDefault();
      if (!event.repeat) {
        setSpaceDragActive(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }

      event.preventDefault();
      setSpaceDragActive(false);
      setSpaceDragging(false);
    };

    const handleWindowBlur = () => {
      setSpaceDragActive(false);
      setSpaceDragging(false);
    };

    window.addEventListener("resize", syncWindowSize);
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("resize", syncWindowSize);
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    if (!spaceDragActive) {
      setSpaceDragging(false);
    }
  }, [spaceDragActive]);

  useEffect(() => {
    return () => {
      if (resizePollTimerRef.current !== null) {
        window.clearInterval(resizePollTimerRef.current);
        resizePollTimerRef.current = null;
      }
      resizeSessionRef.current = null;
      pendingResizeBoundsRef.current = null;
    };
  }, []);

  const flushPendingResizeBounds = () => {
    if (resizeUpdateInFlightRef.current || !pendingResizeBoundsRef.current) {
      return;
    }

    resizeUpdateInFlightRef.current = true;
    const nextBounds = pendingResizeBoundsRef.current;
    pendingResizeBoundsRef.current = null;

    void (async () => {
      const currentWindow = getCurrentWindow();
      await invoke("set_host_window_bounds", {
        label: currentWindow.label,
        bounds: {
          x: nextBounds.left,
          y: nextBounds.top,
          width: nextBounds.width,
          height: nextBounds.height
        }
      }).catch((error) => {
        console.error("Failed to resize Codex usage popout.", error);
      });
    })().finally(() => {
      resizeUpdateInFlightRef.current = false;
      if (pendingResizeBoundsRef.current) {
        flushPendingResizeBounds();
      }
    });
  };

  const queueResizeBounds = (bounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  }) => {
    pendingResizeBoundsRef.current = bounds;
    flushPendingResizeBounds();
  };

  const updateResizeBoundsForPointer = (
    session: ResizeSession,
    pointerX: number,
    pointerY: number
  ) => {
    const pointerCoordinateScale =
      Number.isFinite(session.pointerCoordinateScale) && session.pointerCoordinateScale > 0
        ? session.pointerCoordinateScale
        : 1;
    const deltaX = (pointerX - session.initialPointerX) / pointerCoordinateScale;
    const deltaY = (pointerY - session.initialPointerY) / pointerCoordinateScale;
    const horizontalSign = session.direction.includes("East") ? 1 : -1;
    const verticalSign = session.direction.includes("South") ? 1 : -1;
    const proposedWidth = Math.max(MIN_WINDOW_WIDTH, session.initialWidth + deltaX * horizontalSign);
    const proposedHeight = Math.max(
      MIN_WINDOW_HEIGHT,
      session.initialHeight + deltaY * verticalSign
    );
    const nextScale = Math.max(
      proposedWidth / session.initialWidth,
      proposedHeight / session.initialHeight,
      0.35
    );
    const nextWidth = session.initialWidth * nextScale;
    const nextHeight = session.initialHeight * nextScale;
    const nextLeft = session.direction.includes("West")
      ? session.initialLeft + (session.initialWidth - nextWidth)
      : session.initialLeft;
    const nextTop = session.direction.includes("North")
      ? session.initialTop + (session.initialHeight - nextHeight)
      : session.initialTop;

    queueResizeBounds({
      left: nextLeft,
      top: nextTop,
      width: nextWidth,
      height: nextHeight
    });
  };

  const startResizeDrag =
    (direction: ResizeDirection) => (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setSpaceDragging(false);

      event.currentTarget.setPointerCapture(event.pointerId);
      const pointerId = event.pointerId;
      const fallbackPointerX = event.screenX;
      const fallbackPointerY = event.screenY;

      void (async () => {
        const currentWindow = getCurrentWindow();
        const rawScaleFactor = await currentWindow.scaleFactor().catch(() => 1);
        const scaleFactor =
          Number.isFinite(rawScaleFactor) && rawScaleFactor > 0 ? rawScaleFactor : 1;
        const [position, size, initialPointer] = await Promise.all([
          currentWindow.outerPosition().catch(() => null),
          currentWindow.innerSize().catch(() => null),
          cursorPosition().catch(() => null)
        ]);

        if (!position || !size) {
          return;
        }

        resizeSessionRef.current = {
          direction,
          pointerId,
          initialPointerX: initialPointer?.x ?? fallbackPointerX,
          initialPointerY: initialPointer?.y ?? fallbackPointerY,
          pointerCoordinateScale: initialPointer ? scaleFactor : 1,
          initialLeft: position.x / scaleFactor,
          initialTop: position.y / scaleFactor,
          initialWidth: size.width / scaleFactor,
          initialHeight: size.height / scaleFactor
        };

        if (resizePollTimerRef.current !== null) {
          window.clearInterval(resizePollTimerRef.current);
        }
        resizePollTimerRef.current = window.setInterval(() => {
          const activeSession = resizeSessionRef.current;
          if (!activeSession) {
            if (resizePollTimerRef.current !== null) {
              window.clearInterval(resizePollTimerRef.current);
              resizePollTimerRef.current = null;
            }
            return;
          }

          void cursorPosition()
            .then((pointer) => {
              if (!pointer) {
                return;
              }
              updateResizeBoundsForPointer(activeSession, pointer.x, pointer.y);
            })
            .catch(() => {});
        }, 16);
      })();
    };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = resizeSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void cursorPosition()
      .then((pointer) => {
        if (!pointer) {
          return;
        }
        updateResizeBoundsForPointer(session, pointer.x, pointer.y);
      })
      .catch(() => {
        updateResizeBoundsForPointer(session, event.screenX, event.screenY);
      });
  };

  const endResizeDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = resizeSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (resizePollTimerRef.current !== null) {
      window.clearInterval(resizePollTimerRef.current);
      resizePollTimerRef.current = null;
    }
    resizeSessionRef.current = null;
  };

  const handleShellPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!spaceDragActive || event.button !== 0) {
      return;
    }

    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest(".codex-usage-popout__resize-handle")
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSpaceDragging(true);
    void getCurrentWindow().startDragging().catch((error) => {
      console.error("Failed to start Codex usage popout drag.", error);
      setSpaceDragging(false);
    });
  };

  const canonicalWidth = CODEX_USAGE_POPOUT_WINDOW_WIDTH;
  const canonicalHeight = CODEX_USAGE_POPOUT_WINDOW_HEIGHT;
  const uniformScale = Math.max(
    0.1,
    Math.min(windowSize.width / canonicalWidth, windowSize.height / canonicalHeight)
  );
  const scaledWidth = canonicalWidth * uniformScale;
  const scaledHeight = canonicalHeight * uniformScale;
  const pageClassName = [
    "codex-usage-popout",
    spaceDragActive ? "codex-usage-popout--space-drag" : "",
    spaceDragging ? "codex-usage-popout--dragging" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={pageClassName} aria-label={context.label ?? "Codex usage"}>
      <div
        className="codex-usage-popout__shell"
        onPointerDownCapture={handleShellPointerDown}
        onPointerUp={() => {
          setSpaceDragging(false);
        }}
        onPointerCancel={() => {
          setSpaceDragging(false);
        }}
      >
        <div
          className="codex-usage-popout__resize-handle codex-usage-popout__resize-handle--north-east"
          onPointerDown={startResizeDrag("NorthEast")}
          onPointerMove={handleResizePointerMove}
          onPointerUp={endResizeDrag}
          onPointerCancel={endResizeDrag}
        />
        <div
          className="codex-usage-popout__resize-handle codex-usage-popout__resize-handle--north-west"
          onPointerDown={startResizeDrag("NorthWest")}
          onPointerMove={handleResizePointerMove}
          onPointerUp={endResizeDrag}
          onPointerCancel={endResizeDrag}
        />
        <div
          className="codex-usage-popout__resize-handle codex-usage-popout__resize-handle--south-east"
          onPointerDown={startResizeDrag("SouthEast")}
          onPointerMove={handleResizePointerMove}
          onPointerUp={endResizeDrag}
          onPointerCancel={endResizeDrag}
        />
        <div
          className="codex-usage-popout__resize-handle codex-usage-popout__resize-handle--south-west"
          onPointerDown={startResizeDrag("SouthWest")}
          onPointerMove={handleResizePointerMove}
          onPointerUp={endResizeDrag}
          onPointerCancel={endResizeDrag}
        />

        <div className="codex-usage-popout__viewport">
          <div
            className="codex-usage-popout__surface-frame"
            style={{
              width: `${scaledWidth}px`,
              height: `${scaledHeight}px`
            }}
          >
            <section
              className="codex-usage-popout__surface"
              style={{
                width: `${canonicalWidth}px`,
                height: `${canonicalHeight}px`,
                transform: `scale(${uniformScale})`,
                transformOrigin: "top left"
              }}
            >
              <div
                className="codex-usage-popout__button"
                role="status"
                aria-live="polite"
                style={{
                  borderRadius: `${canonicalHeight / 2}px`,
                  fontSize: `${CODEX_USAGE_POPOUT_TEXT_SIZE}px`
                }}
              >
                <span className="codex-usage-popout__button-label">
                  {formatUsageText(snapshot)}
                </span>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
