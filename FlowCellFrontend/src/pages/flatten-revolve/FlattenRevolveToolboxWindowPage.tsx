import { LogicalSize, getCurrentWindow } from "@tauri-apps/api/window";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";

import { ButtonHost } from "../../components/ButtonHost";
import {
  listPanelScriptFiles,
  runBlenderToolsetAction,
  type PanelScriptChildRecord,
  type PanelScriptFileRecord
} from "../../lib/programRails";
import { useNativeSpaceDragActive } from "../../lib/nativeKeyState";
import { TOOLSET_BLACK_TINT_IMPORTED_SKIN } from "../../lib/theme";
import type { FlattenRevolveToolboxWindowContext } from "../../lib/windowContext";
import type { ButtonRecord } from "../main/mainLayout";
import "./flattenRevolveToolboxWindowPage.css";

const BUTTON_WIDTH = 131.568346;
const BUTTON_HEIGHT = 37.294964;
const BUTTON_RADIUS = 18.647463;
const REQUIRED_SLOTS = ["flatten_profile", "generate_revolve"] as const;
const CENTER_MODE_OPTIONS = ["GEOMETRY", "ORIGIN", "WORLD", "CURSOR", "OBJECT"] as const;
const AXIS_OPTIONS = ["X", "Y", "Z"] as const;

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeNumericText(
  value: string,
  fallback: number,
  options?: { min?: number; integer?: boolean }
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const coerced = options?.integer ? Math.round(parsed) : parsed;
  if (typeof options?.min === "number") {
    return Math.max(options.min, coerced);
  }

  return coerced;
}

function hasFlattenRevolveChildren(children: readonly PanelScriptChildRecord[] | undefined): boolean {
  const normalizedSlots = new Set(
    (children ?? []).map((child) => child.slot.trim().toLowerCase())
  );
  return REQUIRED_SLOTS.every((slot) => normalizedSlots.has(slot));
}

function isFlattenRevolveToolboxRecord(
  record: PanelScriptFileRecord | null | undefined
): boolean {
  if (!record) {
    return false;
  }

  const normalizedBridgeAction = record.bridgeAction?.trim().toLowerCase() ?? "";
  return (
    normalizedBridgeAction === "flowcell_custom_flatten_revolve" ||
    hasFlattenRevolveChildren(record.children)
  );
}

function buildActionButton(
  context: FlattenRevolveToolboxWindowContext,
  child: PanelScriptChildRecord
): ButtonRecord {
  return {
    id: [
      "flatten-revolve-toolbox",
      context.programName.trim().toLowerCase(),
      context.panelName.trim().toLowerCase(),
      context.fileName.trim().toLowerCase(),
      child.slot.trim().toLowerCase()
    ].join("::"),
    x: 0,
    y: 0,
    width: BUTTON_WIDTH,
    height: BUTTON_HEIGHT,
    radius: BUTTON_RADIUS,
    shapeType: "roundedRect",
    strokeWidth: 1,
    label: child.label?.trim() || child.slot,
    actionId: child.slot,
    skinId: "glass",
    allowRename: false
  };
}

export default function FlattenRevolveToolboxWindowPage({
  context
}: {
  context: FlattenRevolveToolboxWindowContext;
}) {
  const initialWindowFitAppliedRef = useRef(false);
  const surfaceContentRef = useRef<HTMLDivElement | null>(null);
  const [record, setRecord] = useState<PanelScriptFileRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  const nativeSpaceDragActive = useNativeSpaceDragActive();
  const effectiveSpaceDragActive = spaceDragActive || nativeSpaceDragActive;
  const [surfaceMetrics, setSurfaceMetrics] = useState({
    width: 420,
    height: 220
  });
  const [windowSize, setWindowSize] = useState(() => ({
    width: Math.max(window.innerWidth, 1),
    height: Math.max(window.innerHeight, 1)
  }));
  const [centerMode, setCenterMode] = useState<(typeof CENTER_MODE_OPTIONS)[number]>("GEOMETRY");
  const [flattenAxis, setFlattenAxis] = useState<(typeof AXIS_OPTIONS)[number]>("Y");
  const [revolveAxis, setRevolveAxis] = useState<(typeof AXIS_OPTIONS)[number]>("Z");
  const [angleText, setAngleText] = useState("360");
  const [stepsText, setStepsText] = useState("128");
  const [mergeDistanceText, setMergeDistanceText] = useState("0.0001");
  const viewportPaddingX = 0;
  const viewportPaddingY = 0;
  const contentWidth = Math.max(surfaceMetrics.width, 1);
  const contentHeight = Math.max(surfaceMetrics.height, 1);
  const availableWidth = Math.max(1, windowSize.width - viewportPaddingX * 2);
  const availableHeight = Math.max(1, windowSize.height - viewportPaddingY * 2);
  const surfaceScale = Math.max(
    0.1,
    Math.min(availableWidth / contentWidth, availableHeight / contentHeight)
  );
  const frameWidth = contentWidth * surfaceScale;
  const frameHeight = contentHeight * surfaceScale;

  useEffect(() => {
    const contentReady = !loading && (Boolean(loadError) || record !== null);
    if (
      !contentReady ||
      initialWindowFitAppliedRef.current ||
      surfaceMetrics.width <= 0 ||
      surfaceMetrics.height <= 0
    ) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const content = surfaceContentRef.current;
      const measuredWidth = Math.max(1, Math.ceil(content?.scrollWidth ?? surfaceMetrics.width));
      const measuredHeight = Math.max(1, Math.ceil(content?.scrollHeight ?? surfaceMetrics.height));
      const nextWidth = Math.max(64, measuredWidth + viewportPaddingX * 2);
      const nextHeight = Math.max(64, measuredHeight + viewportPaddingY * 2);

      initialWindowFitAppliedRef.current = true;
      await getCurrentWindow()
        .setSize(new LogicalSize(nextWidth, nextHeight))
        .catch(() => {
          if (!cancelled) {
            initialWindowFitAppliedRef.current = false;
          }
        });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    loadError,
    loading,
    record,
    surfaceMetrics.height,
    surfaceMetrics.width,
    viewportPaddingX,
    viewportPaddingY
  ]);

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

  const actionButtons = useMemo(() => {
    if (!record) {
      return [];
    }

    return REQUIRED_SLOTS.map((slot) => {
      const child =
        record.children?.find((entry) => entry.slot.trim().toLowerCase() === slot) ??
        ({
          slot,
          label: slot === "flatten_profile" ? "Flatten" : "Revolve",
          tooltip: ""
        } satisfies PanelScriptChildRecord);
      return buildActionButton(context, child);
    });
  }, [context, record]);

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
            (entry) =>
              entry.fileName === context.fileName && isFlattenRevolveToolboxRecord(entry)
          ) ?? null;

        if (!nextRecord) {
          setRecord(null);
          setLoadError(
            `Flatten revolve tool "${context.label ?? context.fileName}" was not found in ${context.panelName}.`
          );
          return;
        }

        if (!hasFlattenRevolveChildren(nextRecord.children)) {
          setRecord(null);
          setLoadError("Flatten revolve is missing one or more required child actions.");
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
    if (!effectiveSpaceDragActive) {
      setSpaceDragging(false);
    }
  }, [effectiveSpaceDragActive]);

  useEffect(() => {
    const surfaceContent = surfaceContentRef.current;
    if (!surfaceContent) {
      return;
    }

    let frameId = 0;

    const measure = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        const nextSurfaceContent = surfaceContentRef.current;
        if (!nextSurfaceContent) {
          return;
        }

        const nextWidth = Math.max(1, Math.ceil(nextSurfaceContent.scrollWidth));
        const nextHeight = Math.max(1, Math.ceil(nextSurfaceContent.scrollHeight));
        setSurfaceMetrics((current) => {
          if (current.width === nextWidth && current.height === nextHeight) {
            return current;
          }

          return {
            width: nextWidth,
            height: nextHeight
          };
        });
      });
    };

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(surfaceContent);
    measure();

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [
    actionButtons.length,
    angleText,
    centerMode,
    flattenAxis,
    loadError,
    loading,
    mergeDistanceText,
    pendingCommand,
    revolveAxis,
    stepsText
  ]);

  const startResizeDrag =
    (direction:
      | "East"
      | "North"
      | "NorthEast"
      | "NorthWest"
      | "South"
      | "SouthEast"
      | "SouthWest"
      | "West") =>
    (event: ReactPointerEvent<HTMLDivElement>) => {
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
      target.closest(".flatten-revolve-toolbox-window-page__resize-handle")
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSpaceDragging(true);
    void getCurrentWindow().startDragging().catch((error) => {
      console.error("Failed to start flatten revolve toolbox drag.", error);
      setSpaceDragging(false);
    });
  };

  const handleButtonActivate = async (
    button: ButtonRecord,
    _event: ReactMouseEvent<HTMLElement>
  ) => {
    if (!record || pendingCommand) {
      return;
    }

    const normalizedCommand = button.actionId.trim().toLowerCase();
    setPendingCommand(normalizedCommand);
    try {
      await runBlenderToolsetAction({
        programName: context.programName,
        panelName: context.panelName,
        fileName: record.fileName,
        command: normalizedCommand,
        payload: {
          center_mode: centerMode,
          flatten_axis: flattenAxis,
          revolve_axis: revolveAxis,
          angle_deg: normalizeNumericText(angleText, 360),
          revolve_steps: normalizeNumericText(stepsText, 128, { min: 3, integer: true }),
          merge_distance: normalizeNumericText(mergeDistanceText, 0.0001, { min: 0 })
        }
      });
    } catch (error) {
      console.error("Failed to run flatten revolve tool action.", error);
    } finally {
      setPendingCommand(null);
    }
  };

  return (
    <main
      className={[
        "flatten-revolve-toolbox-window-page",
        effectiveSpaceDragActive ? "flatten-revolve-toolbox-window-page--space-drag" : "",
        spaceDragging ? "flatten-revolve-toolbox-window-page--dragging" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Flatten revolve toolbox window"
    >
      <div
        className="flatten-revolve-toolbox-window-page__shell"
        onPointerDownCapture={handleShellPointerDown}
        onPointerUp={() => {
          setSpaceDragging(false);
        }}
        onPointerCancel={() => {
          setSpaceDragging(false);
        }}
      >
        <div
          className="flatten-revolve-toolbox-window-page__resize-handle flatten-revolve-toolbox-window-page__resize-handle--north"
          onPointerDown={startResizeDrag("North")}
        />
        <div
          className="flatten-revolve-toolbox-window-page__resize-handle flatten-revolve-toolbox-window-page__resize-handle--south"
          onPointerDown={startResizeDrag("South")}
        />
        <div
          className="flatten-revolve-toolbox-window-page__resize-handle flatten-revolve-toolbox-window-page__resize-handle--east"
          onPointerDown={startResizeDrag("East")}
        />
        <div
          className="flatten-revolve-toolbox-window-page__resize-handle flatten-revolve-toolbox-window-page__resize-handle--west"
          onPointerDown={startResizeDrag("West")}
        />
        <div
          className="flatten-revolve-toolbox-window-page__resize-handle flatten-revolve-toolbox-window-page__resize-handle--north-east"
          onPointerDown={startResizeDrag("NorthEast")}
        />
        <div
          className="flatten-revolve-toolbox-window-page__resize-handle flatten-revolve-toolbox-window-page__resize-handle--north-west"
          onPointerDown={startResizeDrag("NorthWest")}
        />
        <div
          className="flatten-revolve-toolbox-window-page__resize-handle flatten-revolve-toolbox-window-page__resize-handle--south-east"
          onPointerDown={startResizeDrag("SouthEast")}
        />
        <div
          className="flatten-revolve-toolbox-window-page__resize-handle flatten-revolve-toolbox-window-page__resize-handle--south-west"
          onPointerDown={startResizeDrag("SouthWest")}
        />

        <div
          className="flatten-revolve-toolbox-window-page__viewport"
          style={{
            padding: `${viewportPaddingY}px ${viewportPaddingX}px`
          }}
        >
          <div
            className="flatten-revolve-toolbox-window-page__surface-frame"
            style={
              {
                width: `${frameWidth}px`,
                height: `${frameHeight}px`
              } as CSSProperties
            }
          >
            <div
              ref={surfaceContentRef}
              className="flatten-revolve-toolbox-window-page__surface-content"
              style={{
                transform: `scale(${surfaceScale})`,
                transformOrigin: "top left"
              }}
            >
              {loading ? (
                <p className="flatten-revolve-toolbox-window-page__status">Loading tool set...</p>
              ) : loadError ? (
                <p className="flatten-revolve-toolbox-window-page__status flatten-revolve-toolbox-window-page__status--error">
                  {loadError}
                </p>
              ) : (
                <>
                  <div className="flatten-revolve-toolbox-window-page__field-grid">
                    <label className="flatten-revolve-toolbox-window-page__field">
                      <span className="flatten-revolve-toolbox-window-page__field-label">Center</span>
                      <select
                        value={centerMode}
                        onChange={(event) =>
                          setCenterMode(event.target.value as (typeof CENTER_MODE_OPTIONS)[number])
                        }
                      >
                        {CENTER_MODE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flatten-revolve-toolbox-window-page__field">
                      <span className="flatten-revolve-toolbox-window-page__field-label">
                        Flatten Axis
                      </span>
                      <select
                        value={flattenAxis}
                        onChange={(event) =>
                          setFlattenAxis(event.target.value as (typeof AXIS_OPTIONS)[number])
                        }
                      >
                        {AXIS_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flatten-revolve-toolbox-window-page__field">
                      <span className="flatten-revolve-toolbox-window-page__field-label">
                        Revolve Axis
                      </span>
                      <select
                        value={revolveAxis}
                        onChange={(event) =>
                          setRevolveAxis(event.target.value as (typeof AXIS_OPTIONS)[number])
                        }
                      >
                        {AXIS_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flatten-revolve-toolbox-window-page__field">
                      <span className="flatten-revolve-toolbox-window-page__field-label">Angle</span>
                      <input
                        type="number"
                        step="1"
                        value={angleText}
                        onChange={(event) => setAngleText(event.target.value)}
                      />
                    </label>

                    <label className="flatten-revolve-toolbox-window-page__field">
                      <span className="flatten-revolve-toolbox-window-page__field-label">Steps</span>
                      <input
                        type="number"
                        min="3"
                        step="1"
                        value={stepsText}
                        onChange={(event) => setStepsText(event.target.value)}
                      />
                    </label>

                    <label className="flatten-revolve-toolbox-window-page__field">
                      <span className="flatten-revolve-toolbox-window-page__field-label">Merge</span>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={mergeDistanceText}
                        onChange={(event) => setMergeDistanceText(event.target.value)}
                      />
                    </label>
                  </div>

                  <p className="flatten-revolve-toolbox-window-page__note">
                    Flatten creates a profile from the active mesh. Revolve uses the current profile
                    and field values.
                  </p>

                  <div className="flatten-revolve-toolbox-window-page__actions">
                    {actionButtons.map((button) => (
                    <ButtonHost
                      key={button.id}
                      button={{
                        ...button,
                        disabled: Boolean(pendingCommand)
                      }}
                      absolute={false}
                      importedSkinOverride={TOOLSET_BLACK_TINT_IMPORTED_SKIN}
                      onActivate={handleButtonActivate}
                    />
                  ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
