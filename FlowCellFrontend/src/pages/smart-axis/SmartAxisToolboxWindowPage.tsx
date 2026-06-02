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
  runBlenderSmartAxisTool,
  type PanelScriptFileRecord,
  type SmartAxisToolStateResponse
} from "../../lib/programRails";
import type { SmartAxisToolboxWindowContext } from "../../lib/windowContext";
import {
  SMART_AXIS_TOOLBOX_CANONICAL_HEIGHT,
  SMART_AXIS_TOOLBOX_CANONICAL_WIDTH
} from "./smartAxisToolboxGeometry";
import {
  SmartAxisToolboxSurface,
  type SmartAxisToolboxState
} from "../main/SmartAxisToolboxSurface";
import "../main/mainPage.css";
import "./smartAxisToolboxWindowPage.css";

const DEFAULT_SMART_AXIS_TOOLBOX_STATE: SmartAxisToolboxState = {
  modes: {
    X: "NONE",
    Y: "NONE",
    Z: "NONE"
  },
  liveEnabled: false,
  runnerActive: false,
  registered: false,
  lastMessage: ""
};

type SmartAxisCommand = "baseline" | "cycle_x" | "cycle_y" | "cycle_z" | "toggle_live" | "status";

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

function nextSmartAxisMode(mode: string | undefined): string {
  const normalized = (mode || "").trim().toUpperCase();
  if (normalized === "MIN") {
    return "MAX";
  }
  if (normalized === "MAX") {
    return "NONE";
  }
  return "MIN";
}

function applyOptimisticSmartAxisAction(
  current: SmartAxisToolboxState,
  command: Exclude<SmartAxisCommand, "status">
): SmartAxisToolboxState {
  switch (command) {
    case "cycle_x":
      return {
        ...current,
        modes: {
          ...current.modes,
          X: nextSmartAxisMode(current.modes.X)
        }
      };
    case "cycle_y":
      return {
        ...current,
        modes: {
          ...current.modes,
          Y: nextSmartAxisMode(current.modes.Y)
        }
      };
    case "cycle_z":
      return {
        ...current,
        modes: {
          ...current.modes,
          Z: nextSmartAxisMode(current.modes.Z)
        }
      };
    case "toggle_live":
      return {
        ...current,
        liveEnabled: !current.liveEnabled
      };
    default:
      return current;
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSmartAxisToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  return record?.kind === "smart_axis_toolset";
}

function normalizeSmartAxisState(
  response: SmartAxisToolStateResponse | null | undefined,
  fallback: SmartAxisToolboxState = DEFAULT_SMART_AXIS_TOOLBOX_STATE
): SmartAxisToolboxState {
  const modes = response?.modes ?? {};
  const fallbackModes = fallback.modes;
  const resolvedMessage = response?.message?.trim() || "";

  return {
    modes: {
      X: (modes.X ?? fallbackModes.X ?? "NONE").trim().toUpperCase(),
      Y: (modes.Y ?? fallbackModes.Y ?? "NONE").trim().toUpperCase(),
      Z: (modes.Z ?? fallbackModes.Z ?? "NONE").trim().toUpperCase()
    },
    liveEnabled: Boolean(response?.live_enabled ?? fallback.liveEnabled),
    runnerActive: Boolean(response?.runner_active ?? fallback.runnerActive),
    registered: Boolean(response?.registered ?? fallback.registered),
    lastMessage: resolvedMessage
  };
}

function isIgnorableSmartAxisActionError(
  command: Exclude<SmartAxisCommand, "status">,
  error: unknown
): boolean {
  if (command !== "baseline") {
    return false;
  }

  return formatErrorMessage(error).toLowerCase().includes("select at least one supported object");
}

export default function SmartAxisToolboxWindowPage({
  context
}: {
  context: SmartAxisToolboxWindowContext;
}) {
  const toolStateRef = useRef<SmartAxisToolboxState>(DEFAULT_SMART_AXIS_TOOLBOX_STATE);
  const [record, setRecord] = useState<PanelScriptFileRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toolState, setToolState] = useState<SmartAxisToolboxState>(
    DEFAULT_SMART_AXIS_TOOLBOX_STATE
  );
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  const [windowSize, setWindowSize] = useState(() => ({
    width: Math.max(window.innerWidth, 1),
    height: Math.max(window.innerHeight, 1)
  }));
  const contentWidth = Math.max(SMART_AXIS_TOOLBOX_CANONICAL_WIDTH, 1);
  const contentHeight = Math.max(SMART_AXIS_TOOLBOX_CANONICAL_HEIGHT, 1);
  const surfaceScale = Math.max(
    0.1,
    Math.min(windowSize.width / contentWidth, windowSize.height / contentHeight)
  );
  const frameWidth = contentWidth * surfaceScale;
  const frameHeight = contentHeight * surfaceScale;

  const commitToolState = (nextState: SmartAxisToolboxState) => {
    toolStateRef.current = nextState;
    setToolState(nextState);
  };

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError(null);
    commitToolState(DEFAULT_SMART_AXIS_TOOLBOX_STATE);

    void (async () => {
      try {
        const records = await listPanelScriptFiles(context.programName, context.panelName);
        if (cancelled) {
          return;
        }

        const nextRecord =
          records.find(
            (entry) => entry.fileName === context.fileName && isSmartAxisToolboxRecord(entry)
          ) ?? null;

        if (!nextRecord) {
          setRecord(null);
          setLoadError(
            `Smart Axis tool "${context.label ?? context.fileName}" was not found in ${context.panelName}.`
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
    if (!record) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await runBlenderSmartAxisTool({
          programName: context.programName,
          panelName: context.panelName,
          fileName: record.fileName,
          command: "status"
        });
        if (cancelled) {
          return;
        }
        commitToolState(normalizeSmartAxisState(response, toolStateRef.current));
      } catch (error) {
        if (cancelled) {
          return;
        }
        commitToolState(normalizeSmartAxisState(null));
        console.error("Failed to query Smart Axis tool state.", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [context.panelName, context.programName, record]);

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

  const handleAction = async (command: Exclude<SmartAxisCommand, "status">) => {
    if (!record) {
      return;
    }

    const previousState = toolStateRef.current;
    const optimisticState = applyOptimisticSmartAxisAction(previousState, command);
    commitToolState(optimisticState);

    try {
      const response = await runBlenderSmartAxisTool({
        programName: context.programName,
        panelName: context.panelName,
        fileName: record.fileName,
        command
      });
      commitToolState(normalizeSmartAxisState(response, optimisticState));
    } catch (error) {
      if (!isIgnorableSmartAxisActionError(command, error)) {
        console.error("Failed to run Smart Axis tool action.", error);
      }
      commitToolState({
        ...previousState,
        lastMessage: ""
      });
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
      target.closest(".smart-axis-toolbox-window-page__resize-handle")
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSpaceDragging(true);
    void getCurrentWindow().startDragging().catch((error) => {
      console.error("Failed to start Smart Axis toolbox drag.", error);
      setSpaceDragging(false);
    });
  };
  const pageClassName = [
    "smart-axis-toolbox-window-page",
    spaceDragActive ? "smart-axis-toolbox-window-page--space-drag" : "",
    spaceDragging ? "smart-axis-toolbox-window-page--dragging" : ""
  ]
    .filter(Boolean)
    .join(" ");

  if (loading) {
    return (
      <main className="smart-axis-toolbox-window-page">
        <p className="smart-axis-toolbox-window-page__status">Loading Smart Axis tool…</p>
      </main>
    );
  }

  if (!record || loadError) {
    return (
      <main className="smart-axis-toolbox-window-page">
        <p className="smart-axis-toolbox-window-page__status">
          {loadError ?? "Smart Axis tool could not be loaded."}
        </p>
      </main>
    );
  }

  return (
    <main className={pageClassName}>
      <div
        className="smart-axis-toolbox-window-page__shell"
        onPointerDown={handleShellPointerDown}
        onPointerUp={() => {
          setSpaceDragging(false);
        }}
        onPointerCancel={() => {
          setSpaceDragging(false);
        }}
      >
        <div
          className="smart-axis-toolbox-window-page__resize-handle smart-axis-toolbox-window-page__resize-handle--north"
          onPointerDown={startResizeDrag("North")}
        />
        <div
          className="smart-axis-toolbox-window-page__resize-handle smart-axis-toolbox-window-page__resize-handle--south"
          onPointerDown={startResizeDrag("South")}
        />
        <div
          className="smart-axis-toolbox-window-page__resize-handle smart-axis-toolbox-window-page__resize-handle--east"
          onPointerDown={startResizeDrag("East")}
        />
        <div
          className="smart-axis-toolbox-window-page__resize-handle smart-axis-toolbox-window-page__resize-handle--west"
          onPointerDown={startResizeDrag("West")}
        />
        <div
          className="smart-axis-toolbox-window-page__resize-handle smart-axis-toolbox-window-page__resize-handle--north-east"
          onPointerDown={startResizeDrag("NorthEast")}
        />
        <div
          className="smart-axis-toolbox-window-page__resize-handle smart-axis-toolbox-window-page__resize-handle--north-west"
          onPointerDown={startResizeDrag("NorthWest")}
        />
        <div
          className="smart-axis-toolbox-window-page__resize-handle smart-axis-toolbox-window-page__resize-handle--south-east"
          onPointerDown={startResizeDrag("SouthEast")}
        />
        <div
          className="smart-axis-toolbox-window-page__resize-handle smart-axis-toolbox-window-page__resize-handle--south-west"
          onPointerDown={startResizeDrag("SouthWest")}
        />

        <div className="smart-axis-toolbox-window-page__viewport">
          <div
            className="smart-axis-toolbox-window-page__surface-frame"
            style={
              {
                width: `${frameWidth}px`,
                height: `${frameHeight}px`
              } as CSSProperties
            }
          >
            <div
              className="smart-axis-toolbox-window-page__surface-scale"
              style={{
                width: `${SMART_AXIS_TOOLBOX_CANONICAL_WIDTH}px`,
                height: `${SMART_AXIS_TOOLBOX_CANONICAL_HEIGHT}px`,
                transform: `scale(${surfaceScale})`,
                transformOrigin: "top left"
              }}
            >
              <SmartAxisToolboxSurface
                record={record}
                state={toolState}
                onAction={handleAction}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
