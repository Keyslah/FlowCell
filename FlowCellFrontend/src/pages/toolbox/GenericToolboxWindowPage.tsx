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
  runToolsetAction,
  type PanelScriptFileRecord
} from "../../lib/programRails";
import { TOOLSET_BLACK_TINT_IMPORTED_SKIN } from "../../lib/theme";
import type { GenericToolboxWindowContext } from "../../lib/windowContext";
import type { ButtonRecord } from "../main/mainLayout";
import "./genericToolboxWindowPage.css";

const BUTTON_WIDTH = 131.568346;
const BUTTON_HEIGHT = 37.294964;
const BUTTON_RADIUS = 18.647463;
const MAX_GRID_COLUMNS = 4;
const SPECIAL_TOOLBOX_KINDS = new Set([
  "alignment_toolset",
  "boolean_toolset",
  "flatten_revolve_toolset",
  "illustrator_alignment_toolset",
  "illustrator_rotate_toolset",
  "remesh_toolset",
  "rotate_toolset",
  "smart_axis_toolset",
  "theme_toolset",
  "tri_poly_toolset"
]);

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

function isGenericToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  if (!record || (record.children?.length ?? 0) === 0) {
    return false;
  }

  const normalizedKind = record.kind?.trim().toLowerCase() ?? "";
  return (
    normalizedKind === "" ||
    normalizedKind === "toolset" ||
    !SPECIAL_TOOLBOX_KINDS.has(normalizedKind)
  );
}

function buildChildButtons(
  context: GenericToolboxWindowContext,
  record: PanelScriptFileRecord
): ButtonRecord[] {
  return (record.children ?? []).map((child) => ({
    id: [
      "generic-toolbox",
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
  }));
}

export default function GenericToolboxWindowPage({
  context
}: {
  context: GenericToolboxWindowContext;
}) {
  const initialWindowFitAppliedRef = useRef(false);
  const surfaceContentRef = useRef<HTMLDivElement | null>(null);
  const [record, setRecord] = useState<PanelScriptFileRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingSlot, setPendingSlot] = useState<string | null>(null);
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  const [surfaceMetrics, setSurfaceMetrics] = useState({
    width: BUTTON_WIDTH,
    height: BUTTON_HEIGHT
  });
  const [windowSize, setWindowSize] = useState(() => ({
    width: Math.max(window.innerWidth, 1),
    height: Math.max(window.innerHeight, 1)
  }));
  const viewportPaddingX = 0;
  const viewportPaddingY = 0;

  const childButtons = useMemo(
    () => (record ? buildChildButtons(context, record) : []),
    [context, record]
  );
  const gridColumnCount = Math.max(1, Math.min(childButtons.length || 1, MAX_GRID_COLUMNS));
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
            (entry) => entry.fileName === context.fileName && isGenericToolboxRecord(entry)
          ) ?? null;

        if (!nextRecord) {
          setRecord(null);
          setLoadError(
            `Tool set "${context.label ?? context.fileName}" was not found in ${context.panelName}.`
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
  }, [childButtons.length, gridColumnCount, loadError, loading, pendingSlot]);

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
      target.closest(".generic-toolbox-window-page__resize-handle")
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSpaceDragging(true);
    void getCurrentWindow().startDragging().catch((error) => {
      console.error("Failed to start toolbox drag.", error);
      setSpaceDragging(false);
    });
  };

  const handleButtonActivate = async (
    button: ButtonRecord,
    _event: ReactMouseEvent<HTMLElement>
  ) => {
    if (!record || pendingSlot) {
      return;
    }

    const selectedChild =
      record.children?.find((child) => child.slot === button.actionId) ?? null;
    if (!selectedChild) {
      return;
    }

    setPendingSlot(selectedChild.slot);
    try {
      await runToolsetAction({
        programName: context.programName,
        panelName: context.panelName,
        fileName: record.fileName,
        command: selectedChild.slot
      });
    } catch (error) {
      console.error("Failed to run generic tool-set action.", error);
    } finally {
      setPendingSlot(null);
    }
  };

  return (
    <main
      className={[
        "generic-toolbox-window-page",
        spaceDragActive ? "generic-toolbox-window-page--space-drag" : "",
        spaceDragging ? "generic-toolbox-window-page--dragging" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Generic toolbox window"
    >
      <div
        className="generic-toolbox-window-page__shell"
        onPointerDownCapture={handleShellPointerDown}
        onPointerUp={() => {
          setSpaceDragging(false);
        }}
        onPointerCancel={() => {
          setSpaceDragging(false);
        }}
      >
        <div
          className="generic-toolbox-window-page__resize-handle generic-toolbox-window-page__resize-handle--north"
          onPointerDown={startResizeDrag("North")}
        />
        <div
          className="generic-toolbox-window-page__resize-handle generic-toolbox-window-page__resize-handle--south"
          onPointerDown={startResizeDrag("South")}
        />
        <div
          className="generic-toolbox-window-page__resize-handle generic-toolbox-window-page__resize-handle--east"
          onPointerDown={startResizeDrag("East")}
        />
        <div
          className="generic-toolbox-window-page__resize-handle generic-toolbox-window-page__resize-handle--west"
          onPointerDown={startResizeDrag("West")}
        />
        <div
          className="generic-toolbox-window-page__resize-handle generic-toolbox-window-page__resize-handle--north-east"
          onPointerDown={startResizeDrag("NorthEast")}
        />
        <div
          className="generic-toolbox-window-page__resize-handle generic-toolbox-window-page__resize-handle--north-west"
          onPointerDown={startResizeDrag("NorthWest")}
        />
        <div
          className="generic-toolbox-window-page__resize-handle generic-toolbox-window-page__resize-handle--south-east"
          onPointerDown={startResizeDrag("SouthEast")}
        />
        <div
          className="generic-toolbox-window-page__resize-handle generic-toolbox-window-page__resize-handle--south-west"
          onPointerDown={startResizeDrag("SouthWest")}
        />

        <div
          className="generic-toolbox-window-page__viewport"
          style={{
            padding: `${viewportPaddingY}px ${viewportPaddingX}px`
          }}
        >
          <div
            className="generic-toolbox-window-page__surface-frame"
            style={
              {
                width: `${frameWidth}px`,
                height: `${frameHeight}px`
              } as CSSProperties
            }
          >
            <div
              ref={surfaceContentRef}
              className="generic-toolbox-window-page__surface-content"
              style={{
                transform: `scale(${surfaceScale})`,
                transformOrigin: "top left"
              }}
            >
              {loading ? (
                <p className="generic-toolbox-window-page__status">Loading tool set...</p>
              ) : loadError ? (
                <p className="generic-toolbox-window-page__status generic-toolbox-window-page__status--error">
                  {loadError}
                </p>
              ) : childButtons.length === 0 ? (
                <p className="generic-toolbox-window-page__status generic-toolbox-window-page__status--error">
                  This tool set does not expose any `FLOWCELL_CHILD` controls.
                </p>
              ) : (
                <div
                  className="generic-toolbox-window-page__grid"
                  style={
                    {
                      ["--generic-toolbox-columns" as string]: String(gridColumnCount)
                    } as CSSProperties
                  }
                >
                  {childButtons.map((button) => (
                    <ButtonHost
                      key={button.id}
                      button={{
                        ...button,
                        disabled: Boolean(pendingSlot)
                      }}
                      absolute={false}
                      importedSkinOverride={TOOLSET_BLACK_TINT_IMPORTED_SKIN}
                      onActivate={handleButtonActivate}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}
