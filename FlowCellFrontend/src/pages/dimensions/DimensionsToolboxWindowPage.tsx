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
  runBlenderToolsetAction,
  type PanelScriptFileRecord,
  type ToolsetActionResponse
} from "../../lib/programRails";
import { useNativeSpaceDragActive } from "../../lib/nativeKeyState";
import type { DimensionsToolboxWindowContext } from "../../lib/windowContext";
import {
  DIMENSIONS_TOOLBOX_CANONICAL_HEIGHT,
  DIMENSIONS_TOOLBOX_CANONICAL_WIDTH
} from "./dimensionsToolboxGeometry";
import {
  DimensionsToolboxSurface,
  type DimensionsAxis,
  type DimensionsToolboxState
} from "../main/DimensionsToolboxSurface";
import "./dimensionsToolboxWindowPage.css";

const DEFAULT_DIMENSIONS_TOOLBOX_STATE: DimensionsToolboxState = {
  selected: false,
  objectName: "",
  displayDimensions: {
    x: "-- in",
    y: "-- in",
    z: "-- in"
  },
  lastMessage: "Select an object"
};

const AXES: readonly DimensionsAxis[] = ["x", "y", "z"] as const;
const POLL_INTERVAL_MS = 500;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDimensionsToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  if (!record) {
    return false;
  }

  if (record.kind === "dimensions_toolset") {
    return true;
  }

  const normalizedBridgeAction = record.bridgeAction?.trim().toLowerCase() ?? "";
  if (normalizedBridgeAction === "flowcell_custom_xyz_dimensions") {
    return true;
  }

  const slots = new Set((record.children ?? []).map((child) => child.slot.trim().toLowerCase()));
  return slots.has("dimension_x") && slots.has("dimension_y") && slots.has("dimension_z");
}

function formatInches(value: unknown): string | null {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const normalized = Math.abs(numeric) < 0.0005 ? 0 : numeric;
  const text = normalized.toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
  return `${text || "0"} in`;
}

function readDisplayDimensions(
  response: ToolsetActionResponse | null | undefined,
  fallback: Record<DimensionsAxis, string>
): Record<DimensionsAxis, string> {
  const displayDimensions = isRecord(response?.displayDimensions)
    ? response?.displayDimensions
    : null;
  const numericDimensions = isRecord(response?.dimensionsInches)
    ? response?.dimensionsInches
    : null;

  return AXES.reduce<Record<DimensionsAxis, string>>(
    (display, axis) => {
      const displayValue = displayDimensions?.[axis];
      if (typeof displayValue === "string" && displayValue.trim()) {
        display[axis] = displayValue.trim();
        return display;
      }

      const numericValue = formatInches(numericDimensions?.[axis]);
      if (numericValue) {
        display[axis] = numericValue;
        return display;
      }

      display[axis] = fallback[axis] || "-- in";
      return display;
    },
    {
      x: fallback.x || "-- in",
      y: fallback.y || "-- in",
      z: fallback.z || "-- in"
    }
  );
}

function normalizeDimensionsState(
  response: ToolsetActionResponse | null | undefined,
  fallback: DimensionsToolboxState
): DimensionsToolboxState {
  const selected = response?.selected === true;
  const objectName = typeof response?.objectName === "string" ? response.objectName.trim() : "";
  const message = typeof response?.message === "string" ? response.message.trim() : "";
  const displayDimensions = readDisplayDimensions(
    response,
    selected ? fallback.displayDimensions : DEFAULT_DIMENSIONS_TOOLBOX_STATE.displayDimensions
  );

  return {
    selected,
    objectName,
    displayDimensions,
    lastMessage: message || (selected ? objectName : "Select an object")
  };
}

export default function DimensionsToolboxWindowPage({
  context
}: {
  context: DimensionsToolboxWindowContext;
}) {
  const dimensionsStateRef = useRef<DimensionsToolboxState>(DEFAULT_DIMENSIONS_TOOLBOX_STATE);
  const [record, setRecord] = useState<PanelScriptFileRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dimensionsState, setDimensionsState] = useState<DimensionsToolboxState>(
    DEFAULT_DIMENSIONS_TOOLBOX_STATE
  );
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  const nativeSpaceDragActive = useNativeSpaceDragActive();
  const effectiveSpaceDragActive = spaceDragActive || nativeSpaceDragActive;
  const [windowSize, setWindowSize] = useState(() => ({
    width: Math.max(window.innerWidth, 1),
    height: Math.max(window.innerHeight, 1)
  }));
  const contentWidth = Math.max(DIMENSIONS_TOOLBOX_CANONICAL_WIDTH, 1);
  const contentHeight = Math.max(DIMENSIONS_TOOLBOX_CANONICAL_HEIGHT, 1);
  const surfaceScale = Math.max(
    0.1,
    Math.min(windowSize.width / contentWidth, windowSize.height / contentHeight)
  );
  const frameWidth = contentWidth * surfaceScale;
  const frameHeight = contentHeight * surfaceScale;

  const commitDimensionsState = (nextState: DimensionsToolboxState) => {
    dimensionsStateRef.current = nextState;
    setDimensionsState(nextState);
  };

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError(null);
    setRecord(null);
    commitDimensionsState(DEFAULT_DIMENSIONS_TOOLBOX_STATE);

    void (async () => {
      try {
        const records = await listPanelScriptFiles(context.programName, context.panelName);
        if (cancelled) {
          return;
        }

        const nextRecord =
          records.find(
            (entry) => entry.fileName === context.fileName && isDimensionsToolboxRecord(entry)
          ) ?? null;

        if (!nextRecord) {
          setRecord(null);
          setLoadError(
            `XYZ Dimensions tool "${context.label ?? context.fileName}" was not found in ${context.panelName}.`
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
    let inFlight = false;

    const queryStatus = async () => {
      if (inFlight) {
        return;
      }

      inFlight = true;
      try {
        const response = await runBlenderToolsetAction({
          programName: context.programName,
          panelName: context.panelName,
          fileName: record.fileName,
          command: "status"
        });

        if (!cancelled) {
          commitDimensionsState(normalizeDimensionsState(response, dimensionsStateRef.current));
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to read XYZ Dimensions toolbox state.", error);
          commitDimensionsState({
            ...DEFAULT_DIMENSIONS_TOOLBOX_STATE,
            lastMessage: "Unable to read Blender."
          });
        }
      } finally {
        inFlight = false;
      }
    };

    void queryStatus();
    const intervalId = window.setInterval(() => {
      void queryStatus();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
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
    if (!effectiveSpaceDragActive) {
      setSpaceDragging(false);
    }
  }, [effectiveSpaceDragActive]);

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

    if (!effectiveSpaceDragActive) {
      return;
    }

    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest(".dimensions-toolbox-window-page__resize-handle")
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSpaceDragging(true);
    void getCurrentWindow()
      .startDragging()
      .catch((error) => {
        console.error("Failed to start XYZ Dimensions toolbox drag.", error);
        setSpaceDragging(false);
      });
  };

  const pageClassName = [
    "dimensions-toolbox-window-page",
    effectiveSpaceDragActive ? "dimensions-toolbox-window-page--space-drag" : "",
    spaceDragging ? "dimensions-toolbox-window-page--dragging" : ""
  ]
    .filter(Boolean)
    .join(" ");

  if (loading) {
    return (
      <main className="dimensions-toolbox-window-page">
        <p className="dimensions-toolbox-window-page__status">Loading XYZ Dimensions tool...</p>
      </main>
    );
  }

  if (!record || loadError) {
    return (
      <main className="dimensions-toolbox-window-page">
        <p className="dimensions-toolbox-window-page__status">
          {loadError ?? "XYZ Dimensions tool could not be loaded."}
        </p>
      </main>
    );
  }

  return (
    <main className={pageClassName} aria-label="XYZ Dimensions toolbox window">
      <div
        className="dimensions-toolbox-window-page__shell"
        onPointerDownCapture={handleShellPointerDown}
        onPointerUp={() => {
          setSpaceDragging(false);
        }}
        onPointerCancel={() => {
          setSpaceDragging(false);
        }}
      >
        <div
          className="dimensions-toolbox-window-page__resize-handle dimensions-toolbox-window-page__resize-handle--north"
          onPointerDown={startResizeDrag("North")}
        />
        <div
          className="dimensions-toolbox-window-page__resize-handle dimensions-toolbox-window-page__resize-handle--south"
          onPointerDown={startResizeDrag("South")}
        />
        <div
          className="dimensions-toolbox-window-page__resize-handle dimensions-toolbox-window-page__resize-handle--east"
          onPointerDown={startResizeDrag("East")}
        />
        <div
          className="dimensions-toolbox-window-page__resize-handle dimensions-toolbox-window-page__resize-handle--west"
          onPointerDown={startResizeDrag("West")}
        />
        <div
          className="dimensions-toolbox-window-page__resize-handle dimensions-toolbox-window-page__resize-handle--north-east"
          onPointerDown={startResizeDrag("NorthEast")}
        />
        <div
          className="dimensions-toolbox-window-page__resize-handle dimensions-toolbox-window-page__resize-handle--north-west"
          onPointerDown={startResizeDrag("NorthWest")}
        />
        <div
          className="dimensions-toolbox-window-page__resize-handle dimensions-toolbox-window-page__resize-handle--south-east"
          onPointerDown={startResizeDrag("SouthEast")}
        />
        <div
          className="dimensions-toolbox-window-page__resize-handle dimensions-toolbox-window-page__resize-handle--south-west"
          onPointerDown={startResizeDrag("SouthWest")}
        />

        <div className="dimensions-toolbox-window-page__viewport">
          <div
            className="dimensions-toolbox-window-page__surface-frame"
            style={
              {
                width: `${frameWidth}px`,
                height: `${frameHeight}px`
              } as CSSProperties
            }
          >
            <div
              className="dimensions-toolbox-window-page__surface-scale"
              style={{
                width: `${DIMENSIONS_TOOLBOX_CANONICAL_WIDTH}px`,
                height: `${DIMENSIONS_TOOLBOX_CANONICAL_HEIGHT}px`,
                transform: `scale(${surfaceScale})`,
                transformOrigin: "top left"
              }}
            >
              <DimensionsToolboxSurface record={record} state={dimensionsState} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
