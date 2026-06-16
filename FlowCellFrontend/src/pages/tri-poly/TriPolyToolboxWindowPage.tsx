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
import type { TriPolyToolboxWindowContext } from "../../lib/windowContext";
import {
  TriPolyToolboxSurface,
  type TriPolyToolboxState
} from "../main/TriPolyToolboxSurface";
import {
  TRI_POLY_TOOLBOX_CANONICAL_HEIGHT,
  TRI_POLY_TOOLBOX_CANONICAL_WIDTH
} from "./triPolyToolboxGeometry";
import "./triPolyToolboxWindowPage.css";

const DEFAULT_TRI_POLY_ANGLE_DEG = 50;
const DEFAULT_TRI_POLY_SIDES = 15;

const DEFAULT_TRI_POLY_TOOLBOX_STATE: TriPolyToolboxState = {
  mode: "",
  sides: DEFAULT_TRI_POLY_SIDES,
  sidesDraft: String(DEFAULT_TRI_POLY_SIDES),
  angleDeg: DEFAULT_TRI_POLY_ANGLE_DEG,
  angleDraft: String(DEFAULT_TRI_POLY_ANGLE_DEG)
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

function isTriPolyToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  if (!record) {
    return false;
  }

  if (record.kind === "tri_poly_toolset") {
    return true;
  }

  const normalizedBridgeAction = record.bridgeAction?.trim().toLowerCase() ?? "";
  if (normalizedBridgeAction === "flowcell_custom_tri_poly") {
    return true;
  }

  const slots = new Set((record.children ?? []).map((child) => child.slot.trim().toLowerCase()));
  return (
    slots.has("triangle_equilateral") &&
    slots.has("triangle_isosceles") &&
    slots.has("triangle_50") &&
    slots.has("triangle_right") &&
    slots.has("triangle_scalene") &&
    slots.has("polygon_create")
  );
}

function clampSides(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(3, Math.min(96, Math.round(parsed)));
}

function clampAngle(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(178, parsed));
}

function formatNumericDraft(value: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }

  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function normalizeTriPolyState(
  response: ToolsetActionResponse | null | undefined,
  fallback: TriPolyToolboxState
): TriPolyToolboxState {
  const mode = typeof response?.mode === "string" ? response.mode : fallback.mode;
  const sides = clampSides(response?.sides, fallback.sides);
  const angleDeg = clampAngle(response?.angle_deg ?? response?.angleDeg, fallback.angleDeg);
  return {
    mode,
    sides,
    sidesDraft: formatNumericDraft(sides),
    angleDeg,
    angleDraft: formatNumericDraft(angleDeg)
  };
}

export default function TriPolyToolboxWindowPage({
  context
}: {
  context: TriPolyToolboxWindowContext;
}) {
  const triPolyStateRef = useRef<TriPolyToolboxState>(DEFAULT_TRI_POLY_TOOLBOX_STATE);
  const [record, setRecord] = useState<PanelScriptFileRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [triPolyState, setTriPolyState] = useState<TriPolyToolboxState>(
    DEFAULT_TRI_POLY_TOOLBOX_STATE
  );
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  const [windowSize, setWindowSize] = useState(() => ({
    width: Math.max(window.innerWidth, 1),
    height: Math.max(window.innerHeight, 1)
  }));
  const viewportPaddingX = 0;
  const viewportPaddingY = 0;
  const contentWidth = Math.max(TRI_POLY_TOOLBOX_CANONICAL_WIDTH, 1);
  const contentHeight = Math.max(TRI_POLY_TOOLBOX_CANONICAL_HEIGHT, 1);
  const availableWidth = Math.max(1, windowSize.width - viewportPaddingX * 2);
  const availableHeight = Math.max(1, windowSize.height - viewportPaddingY * 2);
  const surfaceScale = Math.max(
    0.1,
    Math.min(availableWidth / contentWidth, availableHeight / contentHeight)
  );
  const frameWidth = contentWidth * surfaceScale;
  const frameHeight = contentHeight * surfaceScale;

  const commitTriPolyState = (nextState: TriPolyToolboxState) => {
    triPolyStateRef.current = nextState;
    setTriPolyState(nextState);
  };

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError(null);
    setRecord(null);
    setPendingCommand(null);
    commitTriPolyState(DEFAULT_TRI_POLY_TOOLBOX_STATE);

    void (async () => {
      try {
        const records = await listPanelScriptFiles(context.programName, context.panelName);
        if (cancelled) {
          return;
        }

        const nextRecord =
          records.find(
            (entry) => entry.fileName === context.fileName && isTriPolyToolboxRecord(entry)
          ) ?? null;

        if (!nextRecord) {
          setRecord(null);
          setLoadError(
            `Tri & Poly tool "${context.label ?? context.fileName}" was not found in ${context.panelName}.`
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
          commitTriPolyState(normalizeTriPolyState(response, triPolyStateRef.current));
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to read Tri & Poly toolbox state.", error);
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

  const handleSidesChange = (sidesDraft: string) => {
    const previousState = triPolyStateRef.current;
    commitTriPolyState({
      ...previousState,
      sides: sidesDraft.trim() ? clampSides(sidesDraft, previousState.sides) : previousState.sides,
      sidesDraft
    });
  };

  const handleAngleChange = (angleDraft: string) => {
    const previousState = triPolyStateRef.current;
    commitTriPolyState({
      ...previousState,
      angleDeg: angleDraft.trim()
        ? clampAngle(angleDraft, previousState.angleDeg)
        : previousState.angleDeg,
      angleDraft
    });
  };

  const handleAction = async (command: string, payload?: Record<string, unknown>) => {
    if (!record || pendingCommand) {
      return;
    }

    const previousState = triPolyStateRef.current;
    const actionPayload = { ...(payload ?? {}) };
    const nextSides =
      command === "polygon_create"
        ? clampSides(actionPayload.sides ?? previousState.sidesDraft, previousState.sides)
        : previousState.sides;
    const nextAngleDeg =
      command === "triangle_50"
        ? clampAngle(actionPayload.angle_deg ?? previousState.angleDraft, previousState.angleDeg)
        : previousState.angleDeg;

    if (command === "polygon_create") {
      actionPayload.sides = nextSides;
    }

    if (command === "triangle_50") {
      actionPayload.angle_deg = nextAngleDeg;
    }

    const optimisticState = {
      ...previousState,
      mode: command.startsWith("triangle_") ? command : previousState.mode,
      sides: nextSides,
      sidesDraft:
        command === "polygon_create" ? formatNumericDraft(nextSides) : previousState.sidesDraft,
      angleDeg: nextAngleDeg,
      angleDraft:
        command === "triangle_50" ? formatNumericDraft(nextAngleDeg) : previousState.angleDraft
    };
    commitTriPolyState(optimisticState);
    setPendingCommand(command);

    try {
      const response = await runBlenderToolsetAction({
        programName: context.programName,
        panelName: context.panelName,
        fileName: record.fileName,
        command,
        payload: Object.keys(actionPayload).length > 0 ? actionPayload : payload
      });
      commitTriPolyState(normalizeTriPolyState(response, triPolyStateRef.current));
    } catch (error) {
      commitTriPolyState(previousState);
      console.error("Failed to run Tri & Poly toolbox action.", error);
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
      target.closest(".tri-poly-toolbox-window-page__resize-handle")
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSpaceDragging(true);
    void getCurrentWindow()
      .startDragging()
      .catch((error) => {
        console.error("Failed to start Tri & Poly toolbox drag.", error);
        setSpaceDragging(false);
      });
  };

  const pageClassName = [
    "tri-poly-toolbox-window-page",
    spaceDragActive ? "tri-poly-toolbox-window-page--space-drag" : "",
    spaceDragging ? "tri-poly-toolbox-window-page--dragging" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={pageClassName} aria-label="Tri & Poly toolbox window">
      <div
        className="tri-poly-toolbox-window-page__shell"
        onPointerDownCapture={handleShellPointerDown}
        onPointerUp={() => {
          setSpaceDragging(false);
        }}
        onPointerCancel={() => {
          setSpaceDragging(false);
        }}
      >
        <div
          className="tri-poly-toolbox-window-page__resize-handle tri-poly-toolbox-window-page__resize-handle--north"
          onPointerDown={startResizeDrag("North")}
        />
        <div
          className="tri-poly-toolbox-window-page__resize-handle tri-poly-toolbox-window-page__resize-handle--south"
          onPointerDown={startResizeDrag("South")}
        />
        <div
          className="tri-poly-toolbox-window-page__resize-handle tri-poly-toolbox-window-page__resize-handle--east"
          onPointerDown={startResizeDrag("East")}
        />
        <div
          className="tri-poly-toolbox-window-page__resize-handle tri-poly-toolbox-window-page__resize-handle--west"
          onPointerDown={startResizeDrag("West")}
        />
        <div
          className="tri-poly-toolbox-window-page__resize-handle tri-poly-toolbox-window-page__resize-handle--north-east"
          onPointerDown={startResizeDrag("NorthEast")}
        />
        <div
          className="tri-poly-toolbox-window-page__resize-handle tri-poly-toolbox-window-page__resize-handle--north-west"
          onPointerDown={startResizeDrag("NorthWest")}
        />
        <div
          className="tri-poly-toolbox-window-page__resize-handle tri-poly-toolbox-window-page__resize-handle--south-east"
          onPointerDown={startResizeDrag("SouthEast")}
        />
        <div
          className="tri-poly-toolbox-window-page__resize-handle tri-poly-toolbox-window-page__resize-handle--south-west"
          onPointerDown={startResizeDrag("SouthWest")}
        />
        <div className="tri-poly-toolbox-window-page__viewport">
          <div
            className="tri-poly-toolbox-window-page__surface-frame"
            style={
              {
                width: `${frameWidth}px`,
                height: `${frameHeight}px`
              } as CSSProperties
            }
          >
            <div
              className="tri-poly-toolbox-window-page__surface-scale"
              style={{
                width: `${TRI_POLY_TOOLBOX_CANONICAL_WIDTH}px`,
                height: `${TRI_POLY_TOOLBOX_CANONICAL_HEIGHT}px`,
                transform: `scale(${surfaceScale})`
              }}
            >
              <div className="tri-poly-toolbox-window-page__surface-content">
                {loading ? (
                  <div className="tri-poly-toolbox-window-page__status-frame">
                    <p className="tri-poly-toolbox-window-page__status">
                      Loading Tri &amp; Poly tool...
                    </p>
                  </div>
                ) : loadError ? (
                  <div className="tri-poly-toolbox-window-page__status-frame">
                    <p className="tri-poly-toolbox-window-page__status">{loadError}</p>
                  </div>
                ) : record ? (
                  <TriPolyToolboxSurface
                    record={record}
                    state={triPolyState}
                    disabled={Boolean(pendingCommand)}
                    onSidesChange={handleSidesChange}
                    onAngleChange={handleAngleChange}
                    onAction={handleAction}
                  />
                ) : (
                  <div className="tri-poly-toolbox-window-page__status-frame">
                    <p className="tri-poly-toolbox-window-page__status">
                      Tri &amp; Poly tool could not be resolved.
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
