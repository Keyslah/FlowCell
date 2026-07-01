import { invoke } from "@tauri-apps/api/core";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  buildPanelScriptButtonId,
  readButtonLabelOverrides,
  resolveButtonLabelOverride
} from "../../lib/buttonLabelOverrides";
import { runPanelScript } from "../../lib/programRails";
import { getScriptGroupPopoutTemplate } from "../../lib/scriptGroupPopoutTemplates";
import { isNativeSpaceKeyDown } from "../../lib/nativeKeyState";
import type { ScriptGroupPopoutWindowContext } from "../../lib/windowContext";
import "./scriptGroupPopoutWindowPage.css";

type ScriptGroupPopoutWindowPageProps = {
  context: ScriptGroupPopoutWindowContext;
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

type PositionedScriptButton = {
  id: string;
  fileName: string;
  label: string;
  tooltip?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
};

type ScriptRunErrorState = {
  title: string;
  detail: string;
};

const SINGLE_BUTTON_LABEL_HORIZONTAL_PADDING = 28;
const SINGLE_BUTTON_LABEL_MIN_FONT_SIZE = 10;

let textMeasureContext: CanvasRenderingContext2D | null = null;

function getTextMeasureContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") {
    return null;
  }

  if (!textMeasureContext) {
    textMeasureContext = document.createElement("canvas").getContext("2d");
  }

  return textMeasureContext;
}

function measureLabelWidth(label: string, fontSize: number): number {
  const context = getTextMeasureContext();
  if (!context) {
    return label.trim().length * fontSize * 0.56;
  }

  context.font = `700 ${fontSize}px "Segoe UI", sans-serif`;
  return context.measureText(label).width;
}

function resolveSingleButtonFontSize(label: string, buttonWidth: number, baseFontSize: number): number {
  const availableWidth = Math.max(1, buttonWidth - SINGLE_BUTTON_LABEL_HORIZONTAL_PADDING);
  const measuredWidth = Math.max(1, measureLabelWidth(label, baseFontSize));

  if (measuredWidth <= availableWidth) {
    return baseFontSize;
  }

  return Math.max(
    SINGLE_BUTTON_LABEL_MIN_FONT_SIZE,
    Math.floor((baseFontSize * availableWidth * 100) / measuredWidth) / 100
  );
}

function splitTwoWordButtonLabel(label: string): [string, string] | null {
  const words = label
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0);

  if (words.length !== 2) {
    return null;
  }

  return [words[0], words[1]];
}

function buildScriptButtons(context: ScriptGroupPopoutWindowContext): PositionedScriptButton[] {
  const template = getScriptGroupPopoutTemplate(context.popoutType);

  return context.scripts.map((script, index) => {
    const columnIndex = index % template.buttonsPerRow;
    const rowIndex = Math.floor(index / template.buttonsPerRow);
    const rect = template.rowRects[columnIndex];

    return {
      id: [
        "script-group-popout",
        context.programName.trim().toLowerCase(),
        context.panelName.trim().toLowerCase(),
        script.fileName.trim().toLowerCase()
      ].join("::"),
      fileName: script.fileName,
      label: script.label,
      tooltip: script.tooltip,
      x: rect.x,
      y: rect.y + template.rowHeight * rowIndex,
      width: rect.width,
      height: rect.height,
      rx: rect.rx,
      ry: rect.ry
    };
  });
}

export default function ScriptGroupPopoutWindowPage({
  context
}: ScriptGroupPopoutWindowPageProps) {
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  const resizeUpdateInFlightRef = useRef(false);
  const resizePollTimerRef = useRef<number | null>(null);
  const pendingResizeBoundsRef = useRef<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [labelOverrides, setLabelOverrides] = useState(() => readButtonLabelOverrides());
  const [windowSize, setWindowSize] = useState(() => ({
    width: Math.max(window.innerWidth, 1),
    height: Math.max(window.innerHeight, 1)
  }));
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  const [scriptRunError, setScriptRunError] = useState<ScriptRunErrorState | null>(null);
  const template = useMemo(
    () => getScriptGroupPopoutTemplate(context.popoutType),
    [context.popoutType]
  );

  useEffect(() => {
    const handleStorage = () => {
      setLabelOverrides(readButtonLabelOverrides());
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

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

  const resolvedContext = useMemo<ScriptGroupPopoutWindowContext>(
    () => ({
      ...context,
      scripts: context.scripts.map((script) => ({
        ...script,
        label: resolveButtonLabelOverride(
          buildPanelScriptButtonId(context.programName, context.panelName, script.fileName),
          script.label,
          labelOverrides
        ),
        tooltip: script.tooltip?.trim() || undefined
      }))
    }),
    [context, labelOverrides]
  );
  const buttons = useMemo(() => buildScriptButtons(resolvedContext), [resolvedContext]);
  const rowCount = Math.max(
    1,
    Math.ceil(Math.max(resolvedContext.scripts.length, 1) / template.buttonsPerRow)
  );
  const canonicalWidth = template.rowWidth;
  const canonicalHeight = template.rowHeight * rowCount;
  const uniformScale = Math.max(
    0.1,
    Math.min(windowSize.width / canonicalWidth, windowSize.height / canonicalHeight)
  );
  const scaledWidth = canonicalWidth * uniformScale;
  const scaledHeight = canonicalHeight * uniformScale;

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

  const handleButtonActivate = async (fileName: string) => {
    try {
      setScriptRunError(null);
      // Success needs no popup — only surface failures.
      await runPanelScript(context.programName, context.panelName, fileName);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setScriptRunError({
        title: "Script could not be run.",
        detail
      });
    }
  };

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
        console.error("Failed to resize script group popout.", error);
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
    const proposedWidth = Math.max(120, session.initialWidth + deltaX * horizontalSign);
    const proposedHeight = Math.max(50, session.initialHeight + deltaY * verticalSign);
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
              updateResizeBoundsForPointer(
                activeSession,
                pointer.x,
                pointer.y
              );
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
    if (event.button !== 0) {
      return;
    }

    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest(".script-group-popout__resize-handle")
    ) {
      return;
    }

    const scriptButton =
      target instanceof HTMLElement
        ? target.closest<HTMLButtonElement>(".script-group-popout__button")
        : null;
    const scriptFileName = scriptButton?.dataset.scriptFileName;

    event.preventDefault();
    event.stopPropagation();

    const startSpaceDrag = () => {
      setSpaceDragActive(true);
      setSpaceDragging(true);
      void getCurrentWindow().startDragging().catch((error) => {
        console.error("Failed to start script group popout drag.", error);
        setSpaceDragging(false);
      });
    };

    if (spaceDragActive) {
      startSpaceDrag();
      return;
    }

    void (async () => {
      if (await isNativeSpaceKeyDown()) {
        startSpaceDrag();
        return;
      }

      if (scriptFileName) {
        await handleButtonActivate(scriptFileName);
      }
    })();
  };

  const pageClassName = [
    "script-group-popout",
    spaceDragActive ? "script-group-popout--space-drag" : "",
    spaceDragging ? "script-group-popout--dragging" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={pageClassName} aria-label={`${resolvedContext.label ?? resolvedContext.panelName} popout`}>
      <div
        className="script-group-popout__shell"
        onPointerDownCapture={handleShellPointerDown}
        onPointerUp={() => {
          setSpaceDragging(false);
        }}
        onPointerCancel={() => {
          setSpaceDragging(false);
        }}
      >
        <div
          className="script-group-popout__resize-handle script-group-popout__resize-handle--north-east"
          onPointerDown={startResizeDrag("NorthEast")}
          onPointerMove={handleResizePointerMove}
          onPointerUp={endResizeDrag}
          onPointerCancel={endResizeDrag}
        />
        <div
          className="script-group-popout__resize-handle script-group-popout__resize-handle--north-west"
          onPointerDown={startResizeDrag("NorthWest")}
          onPointerMove={handleResizePointerMove}
          onPointerUp={endResizeDrag}
          onPointerCancel={endResizeDrag}
        />
        <div
          className="script-group-popout__resize-handle script-group-popout__resize-handle--south-east"
          onPointerDown={startResizeDrag("SouthEast")}
          onPointerMove={handleResizePointerMove}
          onPointerUp={endResizeDrag}
          onPointerCancel={endResizeDrag}
        />
        <div
          className="script-group-popout__resize-handle script-group-popout__resize-handle--south-west"
          onPointerDown={startResizeDrag("SouthWest")}
          onPointerMove={handleResizePointerMove}
          onPointerUp={endResizeDrag}
          onPointerCancel={endResizeDrag}
        />

        <div className="script-group-popout__viewport">
          <div
            className="script-group-popout__surface-frame"
            style={{
              width: `${scaledWidth}px`,
              height: `${scaledHeight}px`
            }}
          >
            <section
              className="script-group-popout__surface"
              style={{
                width: `${canonicalWidth}px`,
                height: `${canonicalHeight}px`,
                transform: `scale(${uniformScale})`,
                transformOrigin: "top left"
              }}
            >
              <svg
                className="script-group-popout__svg"
                xmlns="http://www.w3.org/2000/svg"
                viewBox={`0 0 ${canonicalWidth} ${canonicalHeight}`}
                aria-hidden="true"
              >
                {Array.from({ length: rowCount }, (_, rowIndex) => (
                  <g
                    key={`script-group-popout-row-${rowIndex}`}
                    transform={`translate(0 ${template.rowHeight * rowIndex})`}
                  >
                    {template.rowRects.map((rect, rectIndex) => (
                      <rect
                        key={`script-group-popout-row-${rowIndex}-rect-${rectIndex}`}
                        x={rect.x}
                        y={rect.y}
                        width={rect.width}
                        height={rect.height}
                        rx={rect.rx}
                        ry={rect.ry}
                        fill="none"
                        stroke="#fff"
                        strokeMiterlimit="10"
                      />
                    ))}
                  </g>
                ))}
              </svg>

              {buttons.map((button) => {
                const isSingleButtonTemplate = template.type === "single";
                const stackedLabelWords = isSingleButtonTemplate
                  ? null
                  : splitTwoWordButtonLabel(button.label);
                const isStackedLabel = stackedLabelWords !== null;
                const buttonFontSize = isSingleButtonTemplate
                  ? resolveSingleButtonFontSize(
                      button.label,
                      button.width,
                      template.buttonTextSize
                    )
                  : template.buttonTextSize * (isStackedLabel ? 0.82 : 1);

                return (
                  <button
                    key={button.id}
                    type="button"
                    className={`script-group-popout__button${
                      isSingleButtonTemplate ? " script-group-popout__button--single" : ""
                    }`}
                    aria-label={button.label}
                    data-flow-tooltip={button.tooltip?.trim() || button.label}
                    data-script-file-name={button.fileName}
                    style={{
                      left: `${button.x}px`,
                      top: `${button.y}px`,
                      width: `${button.width}px`,
                      height: `${button.height}px`,
                      borderRadius: `${Math.min(button.rx, button.ry)}px`,
                      fontSize: `${buttonFontSize}px`
                    }}
                    onPointerDown={(event) => {
                      if (event.button !== 0) {
                        return;
                      }

                      event.preventDefault();
                      event.stopPropagation();
                      void handleButtonActivate(button.fileName);
                    }}
                    onClick={(event) => {
                      if (event.detail === 0) {
                        void handleButtonActivate(button.fileName);
                        return;
                      }

                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    <span
                      className={`script-group-popout__button-label${
                        isStackedLabel ? " script-group-popout__button-label--stacked" : ""
                      }${
                        isSingleButtonTemplate ? " script-group-popout__button-label--single" : ""
                      }`}
                    >
                      {isStackedLabel ? (
                        <>
                          <span>{stackedLabelWords[0]}</span>
                          <span>{stackedLabelWords[1]}</span>
                        </>
                      ) : (
                        button.label
                      )}
                    </span>
                  </button>
                );
              })}
            </section>
          </div>
        </div>
        {scriptRunError ? (
          <section className="script-group-popout__script-error" role="alert">
            <button
              type="button"
              className="script-group-popout__script-error-close"
              aria-label="Dismiss script error"
              onClick={() => setScriptRunError(null)}
            >
              X
            </button>
            <strong>{scriptRunError.title}</strong>
            <p>{scriptRunError.detail}</p>
          </section>
        ) : null}
      </div>
    </main>
  );
}
