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
  runBlenderAlignmentTool,
  runIllustratorAlignmentTool,
  type PanelScriptFileRecord
} from "../../lib/programRails";
import type { AlignmentToolboxWindowContext } from "../../lib/windowContext";
import {
  AlignmentToolboxSurface,
  type AlignmentToolboxState
} from "../main/AlignmentToolboxSurface";
import {
  ALIGNMENT_TOOLBOX_CANONICAL_HEIGHT,
  ALIGNMENT_TOOLBOX_CANONICAL_WIDTH,
  ILLUSTRATOR_ALIGNMENT_TOOLBOX_CANONICAL_HEIGHT
} from "./alignmentToolboxGeometry";
import "../main/mainPage.css";
import "./alignmentToolboxWindowPage.css";

type AlignmentModifier = AlignmentToolboxState[keyof AlignmentToolboxState];

const DEFAULT_ALIGNMENT_MODIFIERS: AlignmentToolboxState = {
  X: "",
  Y: "",
  Z: ""
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

function isAlignmentToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  return (
    record?.kind === "alignment_toolset" ||
    record?.kind === "illustrator_alignment_toolset"
  );
}

function isIllustratorAlignmentToolboxRecord(
  record: PanelScriptFileRecord | null | undefined
): boolean {
  return record?.kind === "illustrator_alignment_toolset";
}

function toggleModifier(
  current: AlignmentModifier,
  next: Exclude<AlignmentModifier, "">
): AlignmentModifier {
  return current === next ? "" : next;
}

export default function AlignmentToolboxWindowPage({
  context
}: {
  context: AlignmentToolboxWindowContext;
}) {
  const modifiersRef = useRef<AlignmentToolboxState>(DEFAULT_ALIGNMENT_MODIFIERS);
  const groupModeRef = useRef(false);
  const [record, setRecord] = useState<PanelScriptFileRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modifiers, setModifiers] = useState<AlignmentToolboxState>(
    DEFAULT_ALIGNMENT_MODIFIERS
  );
  const [groupMode, setGroupMode] = useState(false);
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  const [windowSize, setWindowSize] = useState(() => ({
    width: Math.max(window.innerWidth, 1),
    height: Math.max(window.innerHeight, 1)
  }));
  const isIllustratorToolbox =
    context.programName.trim().toLowerCase().includes("illustrator") ||
    isIllustratorAlignmentToolboxRecord(record);
  const contentWidth = Math.max(ALIGNMENT_TOOLBOX_CANONICAL_WIDTH, 1);
  const contentHeight = Math.max(
    isIllustratorToolbox
      ? ILLUSTRATOR_ALIGNMENT_TOOLBOX_CANONICAL_HEIGHT
      : ALIGNMENT_TOOLBOX_CANONICAL_HEIGHT,
    1
  );
  const surfaceScale = Math.max(
    0.1,
    Math.min(windowSize.width / contentWidth, windowSize.height / contentHeight)
  );
  const frameWidth = contentWidth * surfaceScale;
  const frameHeight = contentHeight * surfaceScale;

  const commitModifiers = (nextState: AlignmentToolboxState) => {
    modifiersRef.current = nextState;
    setModifiers(nextState);
  };

  const commitGroupMode = (nextValue: boolean) => {
    groupModeRef.current = nextValue;
    setGroupMode(nextValue);
  };

  const dispatchIllustratorAlignmentTool = (
    args: Parameters<typeof runIllustratorAlignmentTool>[0]
  ) => {
    void runIllustratorAlignmentTool(args).catch((error) => {
      console.error("Failed to run Illustrator alignment tool action.", error);
    });
  };

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError(null);
    commitModifiers(DEFAULT_ALIGNMENT_MODIFIERS);
    commitGroupMode(false);

    void (async () => {
      try {
        const records = await listPanelScriptFiles(context.programName, context.panelName);
        if (cancelled) {
          return;
        }

        const nextRecord =
          records.find(
            (entry) =>
              entry.fileName === context.fileName && isAlignmentToolboxRecord(entry)
          ) ?? null;

        if (!nextRecord) {
          setRecord(null);
          setLoadError(
            `Alignment tool "${context.label ?? context.fileName}" was not found in ${context.panelName}.`
          );
          return;
        }

        setRecord(nextRecord);
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

  const handleAction = async (
    axis: "X" | "Y" | "Z" | "ALL" | "XY",
    action:
      | "min"
      | "center"
      | "max"
      | "surface"
      | "geo"
      | "center_artboard"
      | "center_everything"
      | "center_xy"
      | "toggle_group"
  ) => {
    if (!record) {
      return;
    }

    if (action === "toggle_group") {
      if (isIllustratorAlignmentToolboxRecord(record)) {
        commitGroupMode(!groupModeRef.current);
      }
      return;
    }

    if (action === "surface" || action === "geo") {
      if (axis === "ALL" || axis === "XY") {
        return;
      }

      const nextModifier = action === "surface" ? "SURFACE" : "GEOCENTER";
      commitModifiers({
        ...modifiersRef.current,
        [axis]: toggleModifier(modifiersRef.current[axis], nextModifier)
      });
      return;
    }

    try {
      if (isIllustratorAlignmentToolboxRecord(record)) {
        if (action === "center_artboard") {
          commitModifiers(DEFAULT_ALIGNMENT_MODIFIERS);
          dispatchIllustratorAlignmentTool({
            programName: context.programName,
            panelName: context.panelName,
            fileName: record.fileName,
            command: "center_artboard",
            axis: "",
            mode: "",
            modifier: "",
            groupMode: groupModeRef.current
          });
          return;
        }

        if (axis === "ALL" || action === "center_everything") {
          commitModifiers(DEFAULT_ALIGNMENT_MODIFIERS);
          dispatchIllustratorAlignmentTool({
            programName: context.programName,
            panelName: context.panelName,
            fileName: record.fileName,
            command: "center_all",
            axis: "",
            mode: "",
            modifier: "",
            groupMode: groupModeRef.current
          });
          return;
        }

        if (axis === "XY" || action === "center_xy") {
          commitModifiers(DEFAULT_ALIGNMENT_MODIFIERS);
          dispatchIllustratorAlignmentTool({
            programName: context.programName,
            panelName: context.panelName,
            fileName: record.fileName,
            command: "center_all",
            axis: "",
            mode: "",
            modifier: "",
            groupMode: groupModeRef.current
          });
          return;
        }

        dispatchIllustratorAlignmentTool({
          programName: context.programName,
          panelName: context.panelName,
          fileName: record.fileName,
          command: "align_axis",
          axis,
          mode: action.toUpperCase(),
          modifier: modifiersRef.current[axis],
          groupMode: groupModeRef.current
        });
        return;
      }

      if (axis === "ALL" || action === "center_everything") {
        await runBlenderAlignmentTool({
          programName: context.programName,
          panelName: context.panelName,
          fileName: record.fileName,
          command: "center_all",
          axis: "",
          mode: "",
          modifier: ""
        });
        return;
      }

      if (axis === "XY" || action === "center_xy") {
        await runBlenderAlignmentTool({
          programName: context.programName,
          panelName: context.panelName,
          fileName: record.fileName,
          command: "align_axis",
          axis: "X",
          mode: "CENTER",
          modifier: modifiersRef.current.X
        });
        await runBlenderAlignmentTool({
          programName: context.programName,
          panelName: context.panelName,
          fileName: record.fileName,
          command: "align_axis",
          axis: "Y",
          mode: "CENTER",
          modifier: modifiersRef.current.Y
        });
        return;
      }

      await runBlenderAlignmentTool({
        programName: context.programName,
        panelName: context.panelName,
        fileName: record.fileName,
        command: "align_axis",
        axis,
        mode: action.toUpperCase(),
        modifier: modifiersRef.current[axis]
      });
    } catch (error) {
      console.error("Failed to run alignment tool action.", error);
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
      target.closest(".alignment-toolbox-window-page__resize-handle")
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSpaceDragging(true);
    void getCurrentWindow()
      .startDragging()
      .catch((error) => {
        console.error("Failed to start alignment toolbox drag.", error);
        setSpaceDragging(false);
      });
  };

  const pageClassName = [
    "alignment-toolbox-window-page",
    spaceDragActive ? "alignment-toolbox-window-page--space-drag" : "",
    spaceDragging ? "alignment-toolbox-window-page--dragging" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={pageClassName} aria-label="Alignment toolbox window">
      <div
        className="alignment-toolbox-window-page__shell"
        onPointerDown={handleShellPointerDown}
        onPointerUp={() => {
          setSpaceDragging(false);
        }}
        onPointerCancel={() => {
          setSpaceDragging(false);
        }}
      >
        <div
          className="alignment-toolbox-window-page__resize-handle alignment-toolbox-window-page__resize-handle--north"
          onPointerDown={startResizeDrag("North")}
        />
        <div
          className="alignment-toolbox-window-page__resize-handle alignment-toolbox-window-page__resize-handle--south"
          onPointerDown={startResizeDrag("South")}
        />
        <div
          className="alignment-toolbox-window-page__resize-handle alignment-toolbox-window-page__resize-handle--east"
          onPointerDown={startResizeDrag("East")}
        />
        <div
          className="alignment-toolbox-window-page__resize-handle alignment-toolbox-window-page__resize-handle--west"
          onPointerDown={startResizeDrag("West")}
        />
        <div
          className="alignment-toolbox-window-page__resize-handle alignment-toolbox-window-page__resize-handle--north-east"
          onPointerDown={startResizeDrag("NorthEast")}
        />
        <div
          className="alignment-toolbox-window-page__resize-handle alignment-toolbox-window-page__resize-handle--north-west"
          onPointerDown={startResizeDrag("NorthWest")}
        />
        <div
          className="alignment-toolbox-window-page__resize-handle alignment-toolbox-window-page__resize-handle--south-east"
          onPointerDown={startResizeDrag("SouthEast")}
        />
        <div
          className="alignment-toolbox-window-page__resize-handle alignment-toolbox-window-page__resize-handle--south-west"
          onPointerDown={startResizeDrag("SouthWest")}
        />

        <div className="alignment-toolbox-window-page__viewport">
          <div
            className="alignment-toolbox-window-page__surface-frame"
            style={
              {
                width: `${frameWidth}px`,
                height: `${frameHeight}px`
              } as CSSProperties
            }
          >
            <div
              className="alignment-toolbox-window-page__surface-scale"
              style={{
                width: `${ALIGNMENT_TOOLBOX_CANONICAL_WIDTH}px`,
                height: `${ALIGNMENT_TOOLBOX_CANONICAL_HEIGHT}px`,
                transform: `scale(${surfaceScale})`
              }}
            >
              <div className="alignment-toolbox-window-page__surface-content">
                {loading ? (
                  <div className="alignment-toolbox-window-page__status-frame">
                    <p className="alignment-toolbox-window-page__status">
                      Loading alignment tool...
                    </p>
                  </div>
                ) : loadError ? (
                  <div className="alignment-toolbox-window-page__status-frame">
                    <p className="alignment-toolbox-window-page__status">{loadError}</p>
                  </div>
                ) : record ? (
                  <AlignmentToolboxSurface
                    record={record}
                    state={modifiers}
                    groupMode={isIllustratorAlignmentToolboxRecord(record) ? groupMode : false}
                    onAction={handleAction}
                    variant={isIllustratorAlignmentToolboxRecord(record) ? "illustrator" : "blender"}
                  />
                ) : (
                  <div className="alignment-toolbox-window-page__status-frame">
                    <p className="alignment-toolbox-window-page__status">
                      Alignment tool could not be resolved.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
