import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  listPanelScriptFiles,
  runBlenderRotateTool,
  runToolsetAction,
  type PanelScriptFileRecord
} from "../../lib/programRails";
import type { RotateToolboxWindowContext } from "../../lib/windowContext";
import { RotateToolboxSurface, type RotateToolboxState } from "../main/RotateToolboxSurface";
import {
  ILLUSTRATOR_ROTATE_TOOLBOX_CANONICAL_HEIGHT,
  ILLUSTRATOR_ROTATE_TOOLBOX_CANONICAL_WIDTH,
  ROTATE_TOOLBOX_CANONICAL_HEIGHT,
  ROTATE_TOOLBOX_CANONICAL_WIDTH
} from "./rotateToolboxGeometry";
import "../main/mainPage.css";
import "./rotateToolboxWindowPage.css";

const DEFAULT_ROTATE_TOOLBOX_STATE: RotateToolboxState = {
  axis: "Z",
  angleDeg: 30,
  centerMode: "WORLD",
  operationMode: "TRANSFORM",
  distributeCount: 5
};

const DEFAULT_ILLUSTRATOR_ROTATE_TOOLBOX_STATE: RotateToolboxState = {
  axis: "Z",
  angleDeg: 30,
  centerMode: "WORLD",
  operationMode: "TRANSFORM",
  distributeCount: 5
};

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRotateToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  return record?.kind === "rotate_toolset" || record?.kind === "illustrator_rotate_toolset";
}

function isIllustratorRotateToolboxRecord(
  record: PanelScriptFileRecord | null | undefined
): boolean {
  return record?.kind === "illustrator_rotate_toolset";
}

function isIllustratorProgramName(programName: string): boolean {
  return programName.trim().toLowerCase().includes("illustrator");
}

export default function RotateToolboxWindowPage({
  context
}: {
  context: RotateToolboxWindowContext;
}) {
  const toolStateRef = useRef<RotateToolboxState>(DEFAULT_ROTATE_TOOLBOX_STATE);
  const actionInFlightRef = useRef(false);
  const [record, setRecord] = useState<PanelScriptFileRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toolState, setToolState] = useState<RotateToolboxState>(DEFAULT_ROTATE_TOOLBOX_STATE);
  const [actionBusy, setActionBusy] = useState(false);
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  const [windowSize, setWindowSize] = useState(() => ({
    width: Math.max(window.innerWidth, 1),
    height: Math.max(window.innerHeight, 1)
  }));
  const isIllustratorToolbox =
    isIllustratorProgramName(context.programName) || isIllustratorRotateToolboxRecord(record);
  const contentWidth = Math.max(
    isIllustratorToolbox
      ? ILLUSTRATOR_ROTATE_TOOLBOX_CANONICAL_WIDTH
      : ROTATE_TOOLBOX_CANONICAL_WIDTH,
    1
  );
  const contentHeight = Math.max(
    isIllustratorToolbox
      ? ILLUSTRATOR_ROTATE_TOOLBOX_CANONICAL_HEIGHT
      : ROTATE_TOOLBOX_CANONICAL_HEIGHT,
    1
  );
  const surfaceScale = Math.max(
    0.1,
    Math.min(windowSize.width / contentWidth, windowSize.height / contentHeight)
  );
  const frameWidth = contentWidth * surfaceScale;
  const frameHeight = contentHeight * surfaceScale;

  const commitToolState = (nextState: RotateToolboxState) => {
    toolStateRef.current = nextState;
    setToolState(nextState);
  };

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError(null);

    void (async () => {
      try {
        const records = await listPanelScriptFiles(context.programName, context.panelName);
        if (cancelled) {
          return;
        }

        const nextRecord =
          records.find(
            (entry) => entry.fileName === context.fileName && isRotateToolboxRecord(entry)
          ) ?? null;

        if (!nextRecord) {
          setRecord(null);
          setLoadError(
            `Rotate tool "${context.label ?? context.fileName}" was not found in ${context.panelName}.`
          );
          return;
        }

        setRecord(nextRecord);
        commitToolState(
          isIllustratorRotateToolboxRecord(nextRecord) || isIllustratorProgramName(context.programName)
            ? DEFAULT_ILLUSTRATOR_ROTATE_TOOLBOX_STATE
            : DEFAULT_ROTATE_TOOLBOX_STATE
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        setRecord(null);
        setLoadError(formatErrorMessage(error));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [context.fileName, context.label, context.panelName, context.programName]);

  useEffect(() => {
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

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    window.addEventListener("blur", handleWindowBlur);

    return () => {
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
    const syncWindowSize = () => {
      setWindowSize({
        width: Math.max(window.innerWidth, 1),
        height: Math.max(window.innerHeight, 1)
      });
    };

    syncWindowSize();
    window.addEventListener("resize", syncWindowSize);
    return () => {
      window.removeEventListener("resize", syncWindowSize);
    };
  }, []);

  const handleApply = async (
    direction: "negative" | "positive",
    stateOverride?: RotateToolboxState
  ) => {
    if (!record || actionInFlightRef.current) {
      return;
    }

    actionInFlightRef.current = true;
    setActionBusy(true);
    const activeState = stateOverride ?? toolStateRef.current;
    const normalizedAngle = Math.abs(activeState.angleDeg) || 0;
    const normalizedDistributeCount = Math.max(
      0,
      Math.floor(activeState.distributeCount || 0)
    );

    try {
      if (isIllustratorRotateToolboxRecord(record)) {
        await runToolsetAction({
          programName: context.programName,
          panelName: context.panelName,
          fileName: record.fileName,
          command: direction === "negative" ? "apply_negative" : "apply_positive",
          payload: {
            axis: "Z",
            centerMode: activeState.centerMode,
            operationMode: activeState.operationMode,
            angleDeg: normalizedAngle,
            distributeCount: normalizedDistributeCount
          }
        });
        return;
      }

      await runBlenderRotateTool({
        programName: context.programName,
        panelName: context.panelName,
        fileName: record.fileName,
        axis: activeState.axis,
        centerMode: activeState.centerMode,
        operationMode: activeState.operationMode,
        angleDeg: direction === "negative" ? -normalizedAngle : normalizedAngle,
        distributeCount: activeState.distributeCount
      });
    } catch (error) {
      console.error("Failed to run rotate tool action.", error);
    } finally {
      actionInFlightRef.current = false;
      setActionBusy(false);
    }
  };

  const startResizeDrag =
    (direction: ResizeDirection) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void getCurrentWindow().startResizeDragging(direction);
    };

  const handleShellPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    void getCurrentWindow().setFocus().catch(() => {});

    if (!spaceDragActive) {
      return;
    }

    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest(".rotate-toolbox-window-page__resize-handle")
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSpaceDragging(true);
    void getCurrentWindow().startDragging().catch((error) => {
      console.error("Failed to start rotate toolbox drag.", error);
      setSpaceDragging(false);
    });
  };

  const pageClassName = [
    "rotate-toolbox-window-page",
    spaceDragActive ? "rotate-toolbox-window-page--space-drag" : "",
    spaceDragging ? "rotate-toolbox-window-page--dragging" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={pageClassName} aria-label="Rotate toolbox window">
      <div
        className="rotate-toolbox-window-page__shell"
        onPointerDownCapture={handleShellPointerDown}
        onPointerUp={() => {
          setSpaceDragging(false);
        }}
        onPointerCancel={() => {
          setSpaceDragging(false);
        }}
      >
        <div
          className="rotate-toolbox-window-page__resize-handle rotate-toolbox-window-page__resize-handle--north"
          onPointerDown={startResizeDrag("North")}
        />
        <div
          className="rotate-toolbox-window-page__resize-handle rotate-toolbox-window-page__resize-handle--south"
          onPointerDown={startResizeDrag("South")}
        />
        <div
          className="rotate-toolbox-window-page__resize-handle rotate-toolbox-window-page__resize-handle--east"
          onPointerDown={startResizeDrag("East")}
        />
        <div
          className="rotate-toolbox-window-page__resize-handle rotate-toolbox-window-page__resize-handle--west"
          onPointerDown={startResizeDrag("West")}
        />
        <div
          className="rotate-toolbox-window-page__resize-handle rotate-toolbox-window-page__resize-handle--north-east"
          onPointerDown={startResizeDrag("NorthEast")}
        />
        <div
          className="rotate-toolbox-window-page__resize-handle rotate-toolbox-window-page__resize-handle--north-west"
          onPointerDown={startResizeDrag("NorthWest")}
        />
        <div
          className="rotate-toolbox-window-page__resize-handle rotate-toolbox-window-page__resize-handle--south-east"
          onPointerDown={startResizeDrag("SouthEast")}
        />
        <div
          className="rotate-toolbox-window-page__resize-handle rotate-toolbox-window-page__resize-handle--south-west"
          onPointerDown={startResizeDrag("SouthWest")}
        />

        <div className="rotate-toolbox-window-page__viewport">
          <div
            className="rotate-toolbox-window-page__surface-frame"
            style={
              {
                width: `${frameWidth}px`,
                height: `${frameHeight}px`
              } as CSSProperties
            }
          >
            <div
              className="rotate-toolbox-window-page__surface-scale"
              style={{
                width: `${contentWidth}px`,
                height: `${contentHeight}px`,
                transform: `scale(${surfaceScale})`,
                transformOrigin: "top left"
              }}
            >
              {loading ? (
                <div className="rotate-toolbox-window-page__status-frame">
                  <p className="rotate-toolbox-window-page__status">Loading rotate tool...</p>
                </div>
              ) : loadError ? (
                <div className="rotate-toolbox-window-page__status-frame">
                  <p className="rotate-toolbox-window-page__status">{loadError}</p>
                </div>
              ) : record ? (
                <RotateToolboxSurface
                  record={record}
                  state={toolState}
                  onStateChange={commitToolState}
                  onApply={handleApply}
                  disabled={actionBusy}
                  variant={isIllustratorToolbox ? "illustrator" : "blender"}
                />
              ) : (
                <div className="rotate-toolbox-window-page__status-frame">
                  <p className="rotate-toolbox-window-page__status">
                    Rotate tool could not be resolved.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
