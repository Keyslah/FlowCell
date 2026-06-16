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
import type { BooleanToolboxWindowContext } from "../../lib/windowContext";
import {
  BOOLEAN_TOOLBOX_CANONICAL_HEIGHT,
  BOOLEAN_TOOLBOX_CANONICAL_WIDTH
} from "./booleanToolboxGeometry";
import {
  BooleanToolboxSurface,
  type BooleanOperation,
  type BooleanSolver,
  type BooleanToolboxCommand,
  type BooleanToolboxState
} from "../main/BooleanToolboxSurface";
import "../main/mainPage.css";
import "./booleanToolboxWindowPage.css";

const DEFAULT_BOOLEAN_TOOLBOX_STATE: BooleanToolboxState = {
  operation: "DIFFERENCE",
  solver: "EXACT",
  selfIntersection: false,
  holeTolerant: false,
  hideCutter: true,
  backupActive: true
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

function isBooleanToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  if (!record) {
    return false;
  }

  if (record.kind === "boolean_toolset") {
    return true;
  }

  const normalizedBridgeAction = record.bridgeAction?.trim().toLowerCase() ?? "";
  if (normalizedBridgeAction === "flowcell_custom_boolean") {
    return true;
  }

  const slots = new Set((record.children ?? []).map((child) => child.slot.trim().toLowerCase()));
  return (
    slots.has("operation_intersect") &&
    slots.has("operation_union") &&
    slots.has("operation_difference") &&
    slots.has("toggle_self_intersection") &&
    slots.has("toggle_hole_tolerant") &&
    slots.has("toggle_hide_cutter") &&
    slots.has("toggle_backup_active") &&
    slots.has("run_boolean")
  );
}

function normalizeOperation(
  value: unknown,
  fallback: BooleanOperation
): BooleanOperation {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (
    normalized === "INTERSECT" ||
    normalized === "UNION" ||
    normalized === "DIFFERENCE"
  ) {
    return normalized;
  }
  return fallback;
}

function normalizeSolver(value: unknown, fallback: BooleanSolver): BooleanSolver {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (normalized === "FAST" || normalized === "EXACT" || normalized === "MANIFOLD") {
    return normalized;
  }
  return fallback;
}

function readBooleanResponseFlag(
  response: ToolsetActionResponse | null | undefined,
  camelKey: keyof BooleanToolboxState,
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

function normalizeBooleanState(
  response: ToolsetActionResponse | null | undefined,
  fallback: BooleanToolboxState
): BooleanToolboxState {
  return {
    operation: normalizeOperation(response?.operation, fallback.operation),
    solver: normalizeSolver(response?.solver, fallback.solver),
    selfIntersection: readBooleanResponseFlag(
      response,
      "selfIntersection",
      "self_intersection",
      fallback.selfIntersection
    ),
    holeTolerant: readBooleanResponseFlag(
      response,
      "holeTolerant",
      "hole_tolerant",
      fallback.holeTolerant
    ),
    hideCutter: readBooleanResponseFlag(
      response,
      "hideCutter",
      "hide_cutter",
      fallback.hideCutter
    ),
    backupActive: readBooleanResponseFlag(
      response,
      "backupActive",
      "backup_active",
      fallback.backupActive
    )
  };
}

function applyOptimisticBooleanAction(
  current: BooleanToolboxState,
  command: BooleanToolboxCommand,
  payload?: Record<string, unknown>
): BooleanToolboxState {
  switch (command) {
    case "operation_intersect":
      return { ...current, operation: "INTERSECT" };
    case "operation_union":
      return { ...current, operation: "UNION" };
    case "operation_difference":
      return { ...current, operation: "DIFFERENCE" };
    case "set_solver":
      return { ...current, solver: normalizeSolver(payload?.solver, current.solver) };
    case "toggle_self_intersection":
      return { ...current, selfIntersection: !current.selfIntersection };
    case "toggle_hole_tolerant":
      return { ...current, holeTolerant: !current.holeTolerant };
    case "toggle_hide_cutter":
      return { ...current, hideCutter: !current.hideCutter };
    case "toggle_backup_active":
      return { ...current, backupActive: !current.backupActive };
    default:
      return current;
  }
}

export default function BooleanToolboxWindowPage({
  context
}: {
  context: BooleanToolboxWindowContext;
}) {
  const booleanStateRef = useRef<BooleanToolboxState>(DEFAULT_BOOLEAN_TOOLBOX_STATE);
  const [record, setRecord] = useState<PanelScriptFileRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [booleanState, setBooleanState] = useState<BooleanToolboxState>(
    DEFAULT_BOOLEAN_TOOLBOX_STATE
  );
  const [pendingCommand, setPendingCommand] = useState<BooleanToolboxCommand | null>(null);
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  const [windowSize, setWindowSize] = useState(() => ({
    width: Math.max(window.innerWidth, 1),
    height: Math.max(window.innerHeight, 1)
  }));
  const viewportPaddingX = 0;
  const viewportPaddingY = 0;
  const contentWidth = Math.max(BOOLEAN_TOOLBOX_CANONICAL_WIDTH, 1);
  const contentHeight = Math.max(BOOLEAN_TOOLBOX_CANONICAL_HEIGHT, 1);
  const availableWidth = Math.max(1, windowSize.width - viewportPaddingX * 2);
  const availableHeight = Math.max(1, windowSize.height - viewportPaddingY * 2);
  const surfaceScale = Math.max(
    0.1,
    Math.min(availableWidth / contentWidth, availableHeight / contentHeight)
  );
  const frameWidth = contentWidth * surfaceScale;
  const frameHeight = contentHeight * surfaceScale;

  const commitBooleanState = (nextState: BooleanToolboxState) => {
    booleanStateRef.current = nextState;
    setBooleanState(nextState);
  };

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError(null);
    setRecord(null);
    setPendingCommand(null);
    commitBooleanState(DEFAULT_BOOLEAN_TOOLBOX_STATE);

    void (async () => {
      try {
        const records = await listPanelScriptFiles(context.programName, context.panelName);
        if (cancelled) {
          return;
        }

        const nextRecord =
          records.find(
            (entry) => entry.fileName === context.fileName && isBooleanToolboxRecord(entry)
          ) ?? null;

        if (!nextRecord) {
          setRecord(null);
          setLoadError(
            `Boolean tool "${context.label ?? context.fileName}" was not found in ${context.panelName}.`
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
          commitBooleanState(normalizeBooleanState(response, booleanStateRef.current));
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to read Boolean toolbox state.", error);
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
    command: BooleanToolboxCommand,
    payload?: Record<string, unknown>
  ) => {
    if (!record || pendingCommand) {
      return;
    }

    const previousState = booleanStateRef.current;
    const optimisticState = applyOptimisticBooleanAction(previousState, command, payload);
    commitBooleanState(optimisticState);
    setPendingCommand(command);

    try {
      const response = await runBlenderToolsetAction({
        programName: context.programName,
        panelName: context.panelName,
        fileName: record.fileName,
        command,
        payload
      });
      commitBooleanState(normalizeBooleanState(response, booleanStateRef.current));
    } catch (error) {
      commitBooleanState(previousState);
      console.error("Failed to run Boolean toolbox action.", error);
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
      target.closest(".boolean-toolbox-window-page__resize-handle")
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSpaceDragging(true);
    void getCurrentWindow()
      .startDragging()
      .catch((error) => {
        console.error("Failed to start Boolean toolbox drag.", error);
        setSpaceDragging(false);
      });
  };

  const pageClassName = [
    "boolean-toolbox-window-page",
    spaceDragActive ? "boolean-toolbox-window-page--space-drag" : "",
    spaceDragging ? "boolean-toolbox-window-page--dragging" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={pageClassName} aria-label="Boolean toolbox window">
      <div
        className="boolean-toolbox-window-page__shell"
        onPointerDownCapture={handleShellPointerDown}
        onPointerUp={() => {
          setSpaceDragging(false);
        }}
        onPointerCancel={() => {
          setSpaceDragging(false);
        }}
      >
        <div
          className="boolean-toolbox-window-page__resize-handle boolean-toolbox-window-page__resize-handle--north"
          onPointerDown={startResizeDrag("North")}
        />
        <div
          className="boolean-toolbox-window-page__resize-handle boolean-toolbox-window-page__resize-handle--south"
          onPointerDown={startResizeDrag("South")}
        />
        <div
          className="boolean-toolbox-window-page__resize-handle boolean-toolbox-window-page__resize-handle--east"
          onPointerDown={startResizeDrag("East")}
        />
        <div
          className="boolean-toolbox-window-page__resize-handle boolean-toolbox-window-page__resize-handle--west"
          onPointerDown={startResizeDrag("West")}
        />
        <div
          className="boolean-toolbox-window-page__resize-handle boolean-toolbox-window-page__resize-handle--north-east"
          onPointerDown={startResizeDrag("NorthEast")}
        />
        <div
          className="boolean-toolbox-window-page__resize-handle boolean-toolbox-window-page__resize-handle--north-west"
          onPointerDown={startResizeDrag("NorthWest")}
        />
        <div
          className="boolean-toolbox-window-page__resize-handle boolean-toolbox-window-page__resize-handle--south-east"
          onPointerDown={startResizeDrag("SouthEast")}
        />
        <div
          className="boolean-toolbox-window-page__resize-handle boolean-toolbox-window-page__resize-handle--south-west"
          onPointerDown={startResizeDrag("SouthWest")}
        />
        <div className="boolean-toolbox-window-page__viewport">
          <div
            className="boolean-toolbox-window-page__surface-frame"
            style={
              {
                width: `${frameWidth}px`,
                height: `${frameHeight}px`
              } as CSSProperties
            }
          >
            <div
              className="boolean-toolbox-window-page__surface-scale"
              style={{
                width: `${BOOLEAN_TOOLBOX_CANONICAL_WIDTH}px`,
                height: `${BOOLEAN_TOOLBOX_CANONICAL_HEIGHT}px`,
                transform: `scale(${surfaceScale})`
              }}
            >
              <div className="boolean-toolbox-window-page__surface-content">
                {loading ? (
                  <div className="boolean-toolbox-window-page__status-frame">
                    <p className="boolean-toolbox-window-page__status">
                      Loading Boolean tool...
                    </p>
                  </div>
                ) : loadError ? (
                  <div className="boolean-toolbox-window-page__status-frame">
                    <p className="boolean-toolbox-window-page__status">{loadError}</p>
                  </div>
                ) : record ? (
                  <BooleanToolboxSurface
                    record={record}
                    state={booleanState}
                    disabled={Boolean(pendingCommand)}
                    onAction={handleAction}
                  />
                ) : (
                  <div className="boolean-toolbox-window-page__status-frame">
                    <p className="boolean-toolbox-window-page__status">
                      Boolean tool could not be resolved.
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
