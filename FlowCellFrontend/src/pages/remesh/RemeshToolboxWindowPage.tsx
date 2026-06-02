import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  listPanelScriptFiles,
  runBlenderToolsetAction,
  type PanelScriptFileRecord,
  type ToolsetActionResponse
} from "../../lib/programRails";
import type { RemeshToolboxWindowContext } from "../../lib/windowContext";
import {
  RemeshToolboxSurface,
  resolveRemeshToolboxSurfaceHeight,
  type RemeshMode,
  type RemeshToolboxCommand,
  type RemeshToolboxState
} from "../main/RemeshToolboxSurface";
import { REMESH_TOOLBOX_CANONICAL_WIDTH } from "./remeshToolboxGeometry";
import "./remeshToolboxWindowPage.css";

const DEFAULT_REMESH_TOOLBOX_STATE: RemeshToolboxState = {
  mode: "VOXEL",
  voxelSizeMm: 0.1,
  adaptivity: 0,
  smoothShading: false,
  octreeDepth: 6,
  scale: 0.9,
  removeDisconnected: true,
  threshold: 0.1,
  sharpness: 1
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

function isRemeshToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  if (!record) {
    return false;
  }

  if (record.kind === "remesh_toolset") {
    return true;
  }

  const normalizedBridgeAction = record.bridgeAction?.trim().toLowerCase() ?? "";
  if (normalizedBridgeAction === "flowcell_custom_remesh") {
    return true;
  }

  const slots = new Set((record.children ?? []).map((child) => child.slot.trim().toLowerCase()));
  return (
    slots.has("mode_voxel") &&
    slots.has("mode_smooth") &&
    slots.has("mode_sharp") &&
    slots.has("mode_blocks") &&
    slots.has("create_update_remesh") &&
    slots.has("apply_remesh")
  );
}

function normalizeMode(value: unknown, fallback: RemeshMode): RemeshMode {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (
    normalized === "VOXEL" ||
    normalized === "SMOOTH" ||
    normalized === "SHARP" ||
    normalized === "BLOCKS"
  ) {
    return normalized;
  }
  return fallback;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function normalizeInt(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(normalizeNumber(value, fallback, min, max));
}

function readResponseNumber(
  response: ToolsetActionResponse | null | undefined,
  camelKey: string,
  snakeKey: string,
  fallback: number,
  min: number,
  max: number
): number {
  const camelValue = response?.[camelKey];
  const snakeValue = response?.[snakeKey];
  return normalizeNumber(camelValue ?? snakeValue, fallback, min, max);
}

function readResponseBoolean(
  response: ToolsetActionResponse | null | undefined,
  camelKey: string,
  snakeKey: string,
  fallback: boolean
): boolean {
  const camelValue = response?.[camelKey];
  if (typeof camelValue === "boolean") {
    return camelValue;
  }

  const snakeValue = response?.[snakeKey];
  return typeof snakeValue === "boolean" ? snakeValue : fallback;
}

function normalizeRemeshState(
  response: ToolsetActionResponse | null | undefined,
  fallback: RemeshToolboxState
): RemeshToolboxState {
  return {
    mode: normalizeMode(response?.mode, fallback.mode),
    voxelSizeMm: readResponseNumber(
      response,
      "voxelSizeMm",
      "voxel_size_mm",
      fallback.voxelSizeMm,
      0.001,
      1000
    ),
    adaptivity: readResponseNumber(
      response,
      "adaptivity",
      "adaptivity",
      fallback.adaptivity,
      0,
      1
    ),
    smoothShading: readResponseBoolean(
      response,
      "smoothShading",
      "smooth_shading",
      fallback.smoothShading
    ),
    octreeDepth: normalizeInt(
      response?.octreeDepth ?? response?.octree_depth,
      fallback.octreeDepth,
      1,
      12
    ),
    scale: readResponseNumber(response, "scale", "scale", fallback.scale, 0.1, 1),
    removeDisconnected: readResponseBoolean(
      response,
      "removeDisconnected",
      "remove_disconnected",
      fallback.removeDisconnected
    ),
    threshold: readResponseNumber(
      response,
      "threshold",
      "threshold",
      fallback.threshold,
      0,
      1
    ),
    sharpness: readResponseNumber(
      response,
      "sharpness",
      "sharpness",
      fallback.sharpness,
      0,
      10
    )
  };
}

function valueFromPayload(payload: Record<string, unknown> | undefined): unknown {
  return payload?.value;
}

function applyOptimisticRemeshAction(
  current: RemeshToolboxState,
  command: RemeshToolboxCommand,
  payload?: Record<string, unknown>
): RemeshToolboxState {
  switch (command) {
    case "mode_voxel":
      return { ...current, mode: "VOXEL" };
    case "mode_smooth":
      return { ...current, mode: "SMOOTH" };
    case "mode_sharp":
      return { ...current, mode: "SHARP" };
    case "mode_blocks":
      return { ...current, mode: "BLOCKS" };
    case "set_voxel_size_mm":
      return {
        ...current,
        voxelSizeMm: normalizeNumber(valueFromPayload(payload), current.voxelSizeMm, 0.001, 1000)
      };
    case "set_adaptivity":
      return {
        ...current,
        adaptivity: normalizeNumber(valueFromPayload(payload), current.adaptivity, 0, 1)
      };
    case "toggle_smooth_shading":
      return { ...current, smoothShading: !current.smoothShading };
    case "set_octree_depth":
      return {
        ...current,
        octreeDepth: normalizeInt(valueFromPayload(payload), current.octreeDepth, 1, 12)
      };
    case "set_scale":
      return {
        ...current,
        scale: normalizeNumber(valueFromPayload(payload), current.scale, 0.1, 1)
      };
    case "toggle_remove_disconnected":
      return { ...current, removeDisconnected: !current.removeDisconnected };
    case "set_threshold":
      return {
        ...current,
        threshold: normalizeNumber(valueFromPayload(payload), current.threshold, 0, 1)
      };
    case "set_sharpness":
      return {
        ...current,
        sharpness: normalizeNumber(valueFromPayload(payload), current.sharpness, 0, 10)
      };
    default:
      return current;
  }
}

export default function RemeshToolboxWindowPage({
  context
}: {
  context: RemeshToolboxWindowContext;
}) {
  const remeshStateRef = useRef<RemeshToolboxState>(DEFAULT_REMESH_TOOLBOX_STATE);
  const fittedContentHeightRef = useRef<number | null>(null);
  const [record, setRecord] = useState<PanelScriptFileRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [remeshState, setRemeshState] = useState<RemeshToolboxState>(
    DEFAULT_REMESH_TOOLBOX_STATE
  );
  const [pendingCommand, setPendingCommand] = useState<RemeshToolboxCommand | null>(null);
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  const [windowSize, setWindowSize] = useState(() => ({
    width: Math.max(window.innerWidth, 1),
    height: Math.max(window.innerHeight, 1)
  }));
  const viewportPaddingX = 0;
  const viewportPaddingY = 0;
  const contentWidth = Math.max(REMESH_TOOLBOX_CANONICAL_WIDTH, 1);
  const contentHeight = Math.max(resolveRemeshToolboxSurfaceHeight(remeshState), 1);
  const availableWidth = Math.max(1, windowSize.width - viewportPaddingX * 2);
  const availableHeight = Math.max(1, windowSize.height - viewportPaddingY * 2);
  const surfaceScale = Math.max(
    0.1,
    Math.min(availableWidth / contentWidth, availableHeight / contentHeight)
  );
  const frameWidth = contentWidth * surfaceScale;
  const frameHeight = contentHeight * surfaceScale;

  const commitRemeshState = (nextState: RemeshToolboxState) => {
    remeshStateRef.current = nextState;
    setRemeshState(nextState);
  };

  useEffect(() => {
    if (loading || loadError || !record) {
      return;
    }

    if (fittedContentHeightRef.current === contentHeight) {
      return;
    }

    const widthScale = Math.max(0.1, availableWidth / contentWidth);
    const nextHeight = Math.max(1, Math.ceil(contentHeight * widthScale + viewportPaddingY * 2));
    if (Math.abs(windowSize.height - nextHeight) < 1) {
      fittedContentHeightRef.current = contentHeight;
      return;
    }

    let cancelled = false;
    fittedContentHeightRef.current = contentHeight;

    void getCurrentWindow()
      .setSize(new LogicalSize(Math.max(1, Math.ceil(windowSize.width)), nextHeight))
      .catch(() => {
        if (!cancelled) {
          fittedContentHeightRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    availableWidth,
    contentHeight,
    contentWidth,
    loadError,
    loading,
    record,
    viewportPaddingY,
    windowSize.height,
    windowSize.width
  ]);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError(null);
    setRecord(null);
    setPendingCommand(null);
    commitRemeshState(DEFAULT_REMESH_TOOLBOX_STATE);

    void (async () => {
      try {
        const records = await listPanelScriptFiles(context.programName, context.panelName);
        if (cancelled) {
          return;
        }

        const nextRecord =
          records.find(
            (entry) => entry.fileName === context.fileName && isRemeshToolboxRecord(entry)
          ) ?? null;

        if (!nextRecord) {
          setRecord(null);
          setLoadError(
            `Remesh tool "${context.label ?? context.fileName}" was not found in ${context.panelName}.`
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
        const response = await runBlenderToolsetAction({
          programName: context.programName,
          panelName: context.panelName,
          fileName: record.fileName,
          command: "status"
        });
        if (!cancelled) {
          commitRemeshState(normalizeRemeshState(response, remeshStateRef.current));
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to read Remesh toolbox state.", error);
        }
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

  const handleAction = async (
    command: RemeshToolboxCommand,
    payload?: Record<string, unknown>
  ) => {
    if (!record || pendingCommand) {
      return;
    }

    const previousState = remeshStateRef.current;
    const optimisticState = applyOptimisticRemeshAction(previousState, command, payload);
    commitRemeshState(optimisticState);
    setPendingCommand(command);

    try {
      const response = await runBlenderToolsetAction({
        programName: context.programName,
        panelName: context.panelName,
        fileName: record.fileName,
        command,
        payload
      });
      commitRemeshState(normalizeRemeshState(response, remeshStateRef.current));
    } catch (error) {
      commitRemeshState(previousState);
      console.error("Failed to run Remesh toolbox action.", error);
    } finally {
      setPendingCommand(null);
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
      target.closest(".remesh-toolbox-window-page__resize-handle")
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSpaceDragging(true);
    void getCurrentWindow()
      .startDragging()
      .catch((error) => {
        console.error("Failed to start Remesh toolbox drag.", error);
        setSpaceDragging(false);
      });
  };

  const pageClassName = [
    "remesh-toolbox-window-page",
    spaceDragActive ? "remesh-toolbox-window-page--space-drag" : "",
    spaceDragging ? "remesh-toolbox-window-page--dragging" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={pageClassName} aria-label="Remesh toolbox window">
      <div
        className="remesh-toolbox-window-page__shell"
        onPointerDown={handleShellPointerDown}
        onPointerUp={() => {
          setSpaceDragging(false);
        }}
        onPointerCancel={() => {
          setSpaceDragging(false);
        }}
      >
        <div
          className="remesh-toolbox-window-page__resize-handle remesh-toolbox-window-page__resize-handle--north"
          onPointerDown={startResizeDrag("North")}
        />
        <div
          className="remesh-toolbox-window-page__resize-handle remesh-toolbox-window-page__resize-handle--south"
          onPointerDown={startResizeDrag("South")}
        />
        <div
          className="remesh-toolbox-window-page__resize-handle remesh-toolbox-window-page__resize-handle--east"
          onPointerDown={startResizeDrag("East")}
        />
        <div
          className="remesh-toolbox-window-page__resize-handle remesh-toolbox-window-page__resize-handle--west"
          onPointerDown={startResizeDrag("West")}
        />
        <div
          className="remesh-toolbox-window-page__resize-handle remesh-toolbox-window-page__resize-handle--north-east"
          onPointerDown={startResizeDrag("NorthEast")}
        />
        <div
          className="remesh-toolbox-window-page__resize-handle remesh-toolbox-window-page__resize-handle--north-west"
          onPointerDown={startResizeDrag("NorthWest")}
        />
        <div
          className="remesh-toolbox-window-page__resize-handle remesh-toolbox-window-page__resize-handle--south-east"
          onPointerDown={startResizeDrag("SouthEast")}
        />
        <div
          className="remesh-toolbox-window-page__resize-handle remesh-toolbox-window-page__resize-handle--south-west"
          onPointerDown={startResizeDrag("SouthWest")}
        />
        <div className="remesh-toolbox-window-page__viewport">
          <div
            className="remesh-toolbox-window-page__surface-frame"
            style={
              {
                width: `${frameWidth}px`,
                height: `${frameHeight}px`
              } as CSSProperties
            }
          >
            <div
              className="remesh-toolbox-window-page__surface-scale"
              style={{
                width: `${REMESH_TOOLBOX_CANONICAL_WIDTH}px`,
                height: `${contentHeight}px`,
                transform: `scale(${surfaceScale})`
              }}
            >
              <div className="remesh-toolbox-window-page__surface-content">
                {loading ? (
                  <div className="remesh-toolbox-window-page__status-frame">
                    <p className="remesh-toolbox-window-page__status">
                      Loading Remesh tool...
                    </p>
                  </div>
                ) : loadError ? (
                  <div className="remesh-toolbox-window-page__status-frame">
                    <p className="remesh-toolbox-window-page__status">{loadError}</p>
                  </div>
                ) : record ? (
                  <RemeshToolboxSurface
                    record={record}
                    state={remeshState}
                    surfaceHeight={contentHeight}
                    disabled={Boolean(pendingCommand)}
                    onAction={handleAction}
                  />
                ) : (
                  <div className="remesh-toolbox-window-page__status-frame">
                    <p className="remesh-toolbox-window-page__status">
                      Remesh tool could not be resolved.
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
