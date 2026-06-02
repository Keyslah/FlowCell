import { invoke } from "@tauri-apps/api/core";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MAIN_PAGE_IMPORTED_STYLE_GROUP } from "../../components/ButtonHost";
import {
  FanOutButtonCluster,
  type FanClusterEntry,
  type FanClusterPanelMetrics
} from "../../components/FanOutButtonCluster";
import {
  applyButtonLabelOverridesToPanelScriptRecords,
  readButtonLabelOverrides
} from "../../lib/buttonLabelOverrides";
import {
  getPanelFanOptionsStorageKey,
  readPanelFanOptions
} from "../../lib/panelFanSettings";
import { writePanelFanDiagnostics } from "../../lib/panelFanDiagnostics";
import { writeRegisteredLayoutWindowSnapshotBounds } from "../../lib/layoutSnapshots";
import {
  listPanelScriptFiles,
  runPanelScript,
  type PanelScriptFileRecord
} from "../../lib/programRails";
import { DEFAULT_POPOUT_IMPORTED_SKIN } from "../../lib/theme";
import type { PanelFanWindowContext } from "../../lib/windowContext";
import type { FlowCellButton } from "../../types";
import "../main/mainPage.css";
import "./panelFanWindowPage.css";

const PANEL_FAN_OWNER_BUTTON_ID = "panel-fan-owner";
const PANEL_FAN_OWNER_TOOLTIP = "Hover to fan the selected panel buttons.";
const PANEL_FAN_ANIMATION_MS = 140;
const PANEL_FAN_BOUNDS_SETTLE_ATTEMPTS = 12;
const PANEL_FAN_BOUNDS_SETTLE_DELAY_MS = 16;
const PANEL_FAN_DRAG_SYNC_DELAY_MS = 48;
// Transparent undecorated Windows webviews can report a collapsed owner window a few logical
// pixels larger than the measured pill footprint. Treat close matches as collapsed so we do not
// misclassify a dropped owner window as an expanded fan and drift the anchor.
const PANEL_FAN_OWNER_BOUNDS_TOLERANCE = 8;

interface LogicalBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function areBoundsEqual(left: LogicalBounds | null, right: LogicalBounds): boolean {
  return Boolean(
    left &&
      Math.abs(left.x - right.x) < 0.5 &&
      Math.abs(left.y - right.y) < 0.5 &&
      Math.abs(left.width - right.width) < 0.5 &&
      Math.abs(left.height - right.height) < 0.5
  );
}

async function waitForWindowBoundsToMatch(
  currentWindow: ReturnType<typeof getCurrentWindow>,
  targetBounds: LogicalBounds,
  scaleFactor: number
): Promise<boolean> {
  for (let attempt = 0; attempt < PANEL_FAN_BOUNDS_SETTLE_ATTEMPTS; attempt += 1) {
    const [position, size] = await Promise.all([
      currentWindow.outerPosition().catch(() => null),
      currentWindow.outerSize().catch(() => null)
    ]);
    const currentBounds =
      position && size
        ? {
            x: position.x / scaleFactor,
            y: position.y / scaleFactor,
            width: size.width / scaleFactor,
            height: size.height / scaleFactor
          }
        : null;
    if (areBoundsEqual(currentBounds, targetBounds)) {
      return true;
    }
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, PANEL_FAN_BOUNDS_SETTLE_DELAY_MS);
    });
  }

  return false;
}

function screenRectContains(rect: ScreenRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function serializeDomRect(node: HTMLElement | null): Record<string, number> | null {
  if (!node) {
    return null;
  }

  const rect = node.getBoundingClientRect();
  return {
    left: Number(rect.left.toFixed(3)),
    top: Number(rect.top.toFixed(3)),
    width: Number(rect.width.toFixed(3)),
    height: Number(rect.height.toFixed(3)),
    right: Number(rect.right.toFixed(3)),
    bottom: Number(rect.bottom.toFixed(3))
  };
}

function serializeScreenRect(rect: ScreenRect): Record<string, number> {
  return {
    left: Number(rect.left.toFixed(3)),
    top: Number(rect.top.toFixed(3)),
    right: Number(rect.right.toFixed(3)),
    bottom: Number(rect.bottom.toFixed(3)),
    width: Number((rect.right - rect.left).toFixed(3)),
    height: Number((rect.bottom - rect.top).toFixed(3))
  };
}

function resolveInteractiveHitboxNode(root: HTMLElement): HTMLElement | null {
  if (root.matches("[data-flow-interactive='true']")) {
    return root;
  }
  const lightDomMatch = root.querySelector("[data-flow-interactive='true']") as HTMLElement | null;
  if (lightDomMatch) {
    return lightDomMatch;
  }

  const shadowHosts = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
  for (const host of shadowHosts) {
    const shadowMatch = host.shadowRoot?.querySelector(
      "[data-flow-interactive='true']"
    ) as HTMLElement | null;
    if (shadowMatch) {
      return shadowMatch;
    }
  }

  return null;
}

function buildLiveInteractiveRects(args: {
  windowPosition: { x: number; y: number };
  scaleFactor: number;
  open: boolean;
}): ScreenRect[] {
  const roots: HTMLElement[] = [];
  const ownerRoot = document.querySelector(".fan-cluster__owner");
  if (ownerRoot instanceof HTMLElement) {
    roots.push(ownerRoot);
  }
  if (args.open) {
    document.querySelectorAll(".fan-cluster__child").forEach((node) => {
      if (node instanceof HTMLElement) {
        roots.push(node);
      }
    });
  }

  return roots
    .map((root) => {
      const interactiveNode = resolveInteractiveHitboxNode(root) ?? root;
      const rect = interactiveNode.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        if (interactiveNode === root) {
          return null;
        }
        const fallbackRect = root.getBoundingClientRect();
        if (fallbackRect.width <= 0 || fallbackRect.height <= 0) {
          return null;
        }
        return {
          left: args.windowPosition.x + fallbackRect.left * args.scaleFactor,
          top: args.windowPosition.y + fallbackRect.top * args.scaleFactor,
          right: args.windowPosition.x + fallbackRect.right * args.scaleFactor,
          bottom: args.windowPosition.y + fallbackRect.bottom * args.scaleFactor
        } satisfies ScreenRect;
      }

      return {
        left: args.windowPosition.x + rect.left * args.scaleFactor,
        top: args.windowPosition.y + rect.top * args.scaleFactor,
        right: args.windowPosition.x + rect.right * args.scaleFactor,
        bottom: args.windowPosition.y + rect.bottom * args.scaleFactor
      } satisfies ScreenRect;
    })
    .filter((rect): rect is ScreenRect => Boolean(rect));
}

function buildOwnerButton(panelName: string): FlowCellButton {
  return {
    Id: PANEL_FAN_OWNER_BUTTON_ID,
    Kind: "panel_fan_owner",
    command_id: "flowcell.run_builtin",
    Label: panelName,
    Target: "panel_fan_owner",
    Tooltip: PANEL_FAN_OWNER_TOOLTIP
  };
}

function buildChildButton(record: PanelScriptFileRecord, label: string): FlowCellButton {
  return {
    Id: record.fileName,
    Kind: "panel_script",
    command_id: "flowcell.run_script",
    Label: label,
    Target: record.fileName,
    Tooltip: record.tooltip?.trim() || label
  };
}

function resolveLogicalBounds(args: {
  position: { x: number; y: number } | null;
  size: { width: number; height: number } | null;
  scaleFactor: number;
}): LogicalBounds | null {
  if (!args.position || !args.size) {
    return null;
  }

  return {
    x: args.position.x / args.scaleFactor,
    y: args.position.y / args.scaleFactor,
    width: args.size.width / args.scaleFactor,
    height: args.size.height / args.scaleFactor
  };
}

function matchesCollapsedOwnerBounds(args: {
  bounds: LogicalBounds | null;
  metrics: FanClusterPanelMetrics | null;
}): boolean {
  if (!args.bounds || !args.metrics) {
    return false;
  }

  return (
    Math.abs(args.bounds.width - args.metrics.ownerWidth) <= PANEL_FAN_OWNER_BOUNDS_TOLERANCE &&
    Math.abs(args.bounds.height - args.metrics.ownerHeight) <= PANEL_FAN_OWNER_BOUNDS_TOLERANCE
  );
}

function toFlowCellBounds(bounds: LogicalBounds): {
  Left: number;
  Top: number;
  Width: number;
  Height: number;
} {
  return {
    Left: Number(bounds.x.toFixed(3)),
    Top: Number(bounds.y.toFixed(3)),
    Width: Number(bounds.width.toFixed(3)),
    Height: Number(bounds.height.toFixed(3))
  };
}

function resolveCollapsedOriginFromWindowBounds(args: {
  position: { x: number; y: number } | null;
  size: { width: number; height: number } | null;
  scaleFactor: number;
  metrics: FanClusterPanelMetrics | null;
}): { x: number; y: number } | null {
  const logicalBounds = resolveLogicalBounds(args);
  if (!logicalBounds) {
    return null;
  }

  if (matchesCollapsedOwnerBounds({ bounds: logicalBounds, metrics: args.metrics })) {
    return {
      x: logicalBounds.x,
      y: logicalBounds.y
    };
  }

  return {
    x: logicalBounds.x + (args.metrics?.ownerLeft ?? 0),
    y: logicalBounds.y + (args.metrics?.ownerTop ?? 0)
  };
}

function resolveCollapsedOwnerBounds(args: {
  position: { x: number; y: number } | null;
  size: { width: number; height: number } | null;
  scaleFactor: number;
  metrics: FanClusterPanelMetrics | null;
}): LogicalBounds | null {
  const origin = resolveCollapsedOriginFromWindowBounds(args);
  if (!origin || !args.metrics) {
    return null;
  }

  return {
    x: origin.x,
    y: origin.y,
    width: args.metrics.ownerWidth,
    height: args.metrics.ownerHeight
  };
}

export default function PanelFanToolPopoutWindowPage({
  context
}: {
  context: PanelFanWindowContext;
}) {
  const collapseIntentTimerRef = useRef<number | undefined>(undefined);
  const collapseWindowTimerRef = useRef<number | undefined>(undefined);
  const collapsedOriginRef = useRef<{ x: number; y: number } | null>(null);
  const diagnosticsHistoryRef = useRef<Record<string, unknown>[]>([]);
  const expandedBoundsRef = useRef<LogicalBounds | null>(null);
  const ignoreCursorStateRef = useRef<boolean | null>(null);
  const spaceDragSyncTimerRef = useRef<number | undefined>(undefined);
  const wasSpaceDraggingRef = useRef(false);
  const [records, setRecords] = useState<PanelScriptFileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [labelOverrides, setLabelOverrides] = useState(() => readButtonLabelOverrides());
  const [layoutBoundsReady, setLayoutBoundsReady] = useState(false);
  const [restoreWindowStateReady, setRestoreWindowStateReady] = useState(false);
  const [windowExpanded, setWindowExpanded] = useState(false);
  const [childrenVisible, setChildrenVisible] = useState(false);
  const [ownerPinnedOpen, setOwnerPinnedOpen] = useState(false);
  const [hoverReady, setHoverReady] = useState(true);
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  const [metrics, setMetrics] = useState<FanClusterPanelMetrics | null>(null);
  const [fanOptions, setFanOptions] = useState(() =>
    readPanelFanOptions(context.programName, context.panelName)
  );
  const selectedFileNameSet = useMemo(
    () => new Set(context.selectedFileNames),
    [context.selectedFileNames]
  );

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoadError(null);

    void (async () => {
      try {
        const nextRecords = await listPanelScriptFiles(context.programName, context.panelName);
        if (cancelled) {
          return;
        }

        setRecords(nextRecords.filter((record) => selectedFileNameSet.has(record.fileName)));
      } catch (error) {
        if (cancelled) {
          return;
        }

        setLoadError(formatErrorMessage(error));
        setRecords([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [context.panelName, context.programName, selectedFileNameSet]);

  useEffect(() => {
    const storageKey = getPanelFanOptionsStorageKey(context.programName, context.panelName);
    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key === storageKey) {
        setFanOptions(readPanelFanOptions(context.programName, context.panelName));
      }
      setLabelOverrides(readButtonLabelOverrides());
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [context.panelName, context.programName]);

  const resolvedRecords = useMemo(
    () =>
      applyButtonLabelOverridesToPanelScriptRecords(
        records,
        labelOverrides,
        context.programName,
        context.panelName
      ),
    [context.panelName, context.programName, labelOverrides, records]
  );

  useEffect(() => {
    diagnosticsHistoryRef.current = [];
  }, [context.panelName, context.programName]);

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
    setOwnerPinnedOpen(false);
    setHoverReady(true);
  }, [context.panelName, context.programName, context.selectedFileNames]);

  useEffect(() => {
    setLayoutBoundsReady(false);
    setRestoreWindowStateReady(false);
    expandedBoundsRef.current = null;
  }, [context.panelName, context.programName, records.length]);

  useEffect(() => {
    void (async () => {
      const currentWindow = getCurrentWindow();
      const scaleFactor = await currentWindow.scaleFactor().catch(() => 1);
      const position = await currentWindow.outerPosition().catch(() => null);
      if (!position) {
        return;
      }

      collapsedOriginRef.current = {
        x: position.x / scaleFactor,
        y: position.y / scaleFactor
      };
    })();
  }, []);

  useEffect(() => {
    return () => {
      if (collapseIntentTimerRef.current) {
        window.clearTimeout(collapseIntentTimerRef.current);
      }
      if (collapseWindowTimerRef.current) {
        window.clearTimeout(collapseWindowTimerRef.current);
      }
      if (spaceDragSyncTimerRef.current) {
        window.clearTimeout(spaceDragSyncTimerRef.current);
      }
      void getCurrentWindow().setIgnoreCursorEvents(false).catch(() => {});
    };
  }, []);

  const childEntries = useMemo<FanClusterEntry[]>(() => {
    return resolvedRecords.map((record) => {
      return {
        programId: 0,
        panelId: context.panelName,
        panelName: context.panelName,
        button: buildChildButton(record, record.label),
        childSlotId: record.fileName
      };
    });
  }, [context.panelName, resolvedRecords]);

  const syncCollapsedAnchorFromCurrentWindow = async () => {
    if (!metrics) {
      return;
    }

    const currentWindow = getCurrentWindow();
    let scaleFactor = 1;
    let position: { x: number; y: number } | null = null;
    let size: { width: number; height: number } | null = null;
    let currentBounds: LogicalBounds | null = null;

    for (let attempt = 0; attempt < PANEL_FAN_BOUNDS_SETTLE_ATTEMPTS; attempt += 1) {
      const nextScaleFactor = await currentWindow.scaleFactor().catch(() => scaleFactor || 1);
      const [nextPosition, nextSize] = await Promise.all([
        currentWindow.outerPosition().catch(() => null),
        currentWindow.outerSize().catch(() => null)
      ]);
      const nextBounds = resolveLogicalBounds({
        position: nextPosition,
        size: nextSize,
        scaleFactor: nextScaleFactor
      });
      const boundsSettled =
        currentBounds !== null &&
        nextBounds !== null &&
        areBoundsEqual(currentBounds, nextBounds);

      scaleFactor = nextScaleFactor;
      position = nextPosition;
      size = nextSize;
      currentBounds = nextBounds;

      if (boundsSettled) {
        break;
      }

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, PANEL_FAN_BOUNDS_SETTLE_DELAY_MS);
      });
    }

    const collapsedBounds = resolveCollapsedOwnerBounds({
      position,
      size,
      scaleFactor,
      metrics
    });

    if (!collapsedBounds) {
      return;
    }

    collapsedOriginRef.current = {
      x: collapsedBounds.x,
      y: collapsedBounds.y
    };
    writeRegisteredLayoutWindowSnapshotBounds(
      currentWindow.label,
      toFlowCellBounds(collapsedBounds)
    );

    if (
      currentBounds &&
      !matchesCollapsedOwnerBounds({
        bounds: currentBounds,
        metrics
      })
    ) {
      expandedBoundsRef.current = currentBounds;
    }
  };

  const scheduleCollapseWindow = (force = false) => {
    if (collapseIntentTimerRef.current) {
      window.clearTimeout(collapseIntentTimerRef.current);
      collapseIntentTimerRef.current = undefined;
    }
    if (ownerPinnedOpen && !force) {
      return;
    }
    setChildrenVisible(false);
    if (collapseWindowTimerRef.current) {
      window.clearTimeout(collapseWindowTimerRef.current);
    }
    collapseWindowTimerRef.current = window.setTimeout(() => {
      collapseWindowTimerRef.current = undefined;
      setWindowExpanded(false);
    }, PANEL_FAN_ANIMATION_MS);
  };

  const queueGuardedCollapseWindow = (force = false) => {
    if (collapseIntentTimerRef.current) {
      window.clearTimeout(collapseIntentTimerRef.current);
    }

    if (force) {
      scheduleCollapseWindow(true);
      return;
    }

    collapseIntentTimerRef.current = window.setTimeout(() => {
      collapseIntentTimerRef.current = undefined;
      void (async () => {
        const currentWindow = getCurrentWindow();
        const [windowPosition, pointer, scaleFactor] = await Promise.all([
          currentWindow.outerPosition().catch(() => null),
          cursorPosition().catch(() => null),
          currentWindow.scaleFactor().catch(() => 1)
        ]);

        if (!windowPosition || !pointer) {
          scheduleCollapseWindow(false);
          return;
        }

        const interactiveRects = buildLiveInteractiveRects({
          windowPosition,
          scaleFactor,
          open: windowExpanded && childrenVisible
        });
        const pointerInsideInteractivePill = interactiveRects.some((rect) => {
          return screenRectContains(rect, pointer.x, pointer.y);
        });

        if (pointerInsideInteractivePill) {
          return;
        }

        scheduleCollapseWindow(false);
      })();
    }, 48);
  };

  const collapseToOwnerBeforeDrag = async () => {
    if (!metrics) {
      return;
    }

    const currentWindow = getCurrentWindow();
    const scaleFactor = await currentWindow.scaleFactor().catch(() => 1);
    const [position, size] = await Promise.all([
      currentWindow.outerPosition().catch(() => null),
      currentWindow.outerSize().catch(() => null)
    ]);
    const currentBounds = resolveLogicalBounds({
      position,
      size,
      scaleFactor
    });
    const collapsedBounds = resolveCollapsedOwnerBounds({
      position,
      size,
      scaleFactor,
      metrics
    });

    if (!collapsedBounds) {
      return;
    }

    if (
      currentBounds &&
      !matchesCollapsedOwnerBounds({
        bounds: currentBounds,
        metrics
      })
    ) {
      expandedBoundsRef.current = currentBounds;
    }

    if (collapseIntentTimerRef.current) {
      window.clearTimeout(collapseIntentTimerRef.current);
      collapseIntentTimerRef.current = undefined;
    }
    if (collapseWindowTimerRef.current) {
      window.clearTimeout(collapseWindowTimerRef.current);
      collapseWindowTimerRef.current = undefined;
    }

    collapsedOriginRef.current = {
      x: collapsedBounds.x,
      y: collapsedBounds.y
    };
    writeRegisteredLayoutWindowSnapshotBounds(
      currentWindow.label,
      toFlowCellBounds(collapsedBounds)
    );

    setOwnerPinnedOpen(false);
    setChildrenVisible(false);
    setWindowExpanded(false);
    setLayoutBoundsReady(false);

    if (!areBoundsEqual(currentBounds, collapsedBounds)) {
      await invoke("set_host_window_bounds", {
        label: currentWindow.label,
        bounds: collapsedBounds
      }).catch(() => {});
    }
  };

  useEffect(() => {
    if (spaceDragging) {
      wasSpaceDraggingRef.current = true;
      if (spaceDragSyncTimerRef.current) {
        window.clearTimeout(spaceDragSyncTimerRef.current);
        spaceDragSyncTimerRef.current = undefined;
      }
      return;
    }

    if (!wasSpaceDraggingRef.current) {
      return;
    }

    wasSpaceDraggingRef.current = false;
    spaceDragSyncTimerRef.current = window.setTimeout(() => {
      spaceDragSyncTimerRef.current = undefined;
      void (async () => {
        await syncCollapsedAnchorFromCurrentWindow();
        setOwnerPinnedOpen(false);
        setChildrenVisible(false);
        setWindowExpanded(false);
      })();
    }, PANEL_FAN_DRAG_SYNC_DELAY_MS);

    return () => {
      if (spaceDragSyncTimerRef.current) {
        window.clearTimeout(spaceDragSyncTimerRef.current);
        spaceDragSyncTimerRef.current = undefined;
      }
    };
  }, [metrics, spaceDragging]);

  useEffect(() => {
    if (!metrics || restoreWindowStateReady) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const currentWindow = getCurrentWindow();
      const scaleFactor = await currentWindow.scaleFactor().catch(() => 1);
      const [position, size] = await Promise.all([
        currentWindow.outerPosition().catch(() => null),
        currentWindow.outerSize().catch(() => null)
      ]);
      if (cancelled) {
        return;
      }

      const currentBounds = resolveLogicalBounds({
        position,
        size,
        scaleFactor
      });
      const collapsedBounds = resolveCollapsedOwnerBounds({
        position,
        size,
        scaleFactor,
        metrics
      });
      const origin =
        (collapsedBounds
          ? {
              x: collapsedBounds.x,
              y: collapsedBounds.y
            }
          : null) ?? collapsedOriginRef.current;

      if (origin) {
        collapsedOriginRef.current = origin;
      }
      if (collapsedBounds) {
        writeRegisteredLayoutWindowSnapshotBounds(
          currentWindow.label,
          toFlowCellBounds(collapsedBounds)
        );
      }

      const restoredExpandedBounds =
        currentBounds &&
        !matchesCollapsedOwnerBounds({
          bounds: currentBounds,
          metrics
        })
          ? currentBounds
          : null;
      if (restoredExpandedBounds) {
        expandedBoundsRef.current = restoredExpandedBounds;
      } else {
        expandedBoundsRef.current = null;
      }

      setOwnerPinnedOpen(false);
      setWindowExpanded(false);
      setChildrenVisible(false);
      setLayoutBoundsReady(false);
      setRestoreWindowStateReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [metrics, restoreWindowStateReady]);

  useEffect(() => {
    if (!metrics) {
      return;
    }
    if (!restoreWindowStateReady) {
      return;
    }

    let cancelled = false;

    const applyBounds = async () => {
      const currentWindow = getCurrentWindow();
      const scaleFactor = await currentWindow.scaleFactor().catch(() => 1);
      const [position, size] = await Promise.all([
        currentWindow.outerPosition().catch(() => null),
        currentWindow.outerSize().catch(() => null)
      ]);
      if (cancelled) {
        return;
      }
      const currentBounds = resolveLogicalBounds({
        position,
        size,
        scaleFactor
      });
      const currentWindowIsCollapsed = matchesCollapsedOwnerBounds({
        bounds: currentBounds,
        metrics
      });
      const collapsedBounds = resolveCollapsedOwnerBounds({
        position,
        size,
        scaleFactor,
        metrics
      });
      if (collapsedBounds && (currentWindowIsCollapsed || !collapsedOriginRef.current)) {
        collapsedOriginRef.current = {
          x: collapsedBounds.x,
          y: collapsedBounds.y
        };
      }
      if (collapsedBounds) {
        writeRegisteredLayoutWindowSnapshotBounds(
          currentWindow.label,
          toFlowCellBounds(collapsedBounds)
        );
      }
      const origin =
        collapsedOriginRef.current ??
        (collapsedBounds
          ? {
              x: collapsedBounds.x,
              y: collapsedBounds.y
            }
          : null);

      if (
        currentBounds &&
        !matchesCollapsedOwnerBounds({
          bounds: currentBounds,
          metrics
        })
      ) {
        expandedBoundsRef.current = currentBounds;
      }

      const targetBounds: LogicalBounds = windowExpanded
        ? {
            x: (origin?.x ?? 0) - metrics.ownerLeft,
            y: (origin?.y ?? 0) - metrics.ownerTop,
            width: expandedBoundsRef.current?.width ?? metrics.windowWidth,
            height: expandedBoundsRef.current?.height ?? metrics.windowHeight
          }
        : {
            x: origin?.x ?? 0,
            y: origin?.y ?? 0,
            width: metrics.ownerWidth,
            height: metrics.ownerHeight
          };
      if (areBoundsEqual(currentBounds, targetBounds)) {
        const matchedBounds = await waitForWindowBoundsToMatch(
          currentWindow,
          targetBounds,
          scaleFactor
        );
        if (!cancelled && matchedBounds) {
          setLayoutBoundsReady(true);
          if (windowExpanded) {
            setChildrenVisible(true);
          }
        }
        return;
      }

      if (!cancelled) {
        setLayoutBoundsReady(false);
      }

      await invoke("set_host_window_bounds", {
        label: currentWindow.label,
        bounds: targetBounds
      }).catch(() => {});

      if (cancelled) {
        return;
      }
      const matchedBounds = await waitForWindowBoundsToMatch(
        currentWindow,
        targetBounds,
        scaleFactor
      );
      if (!cancelled && matchedBounds) {
        setLayoutBoundsReady(true);
        if (windowExpanded) {
          setChildrenVisible(true);
        }
      }
    };

    void applyBounds();
    return () => {
      cancelled = true;
    };
  }, [metrics, restoreWindowStateReady, windowExpanded]);

  useEffect(() => {
    if (!windowExpanded) {
      setChildrenVisible(false);
      return;
    }

    if (!layoutBoundsReady) {
      setChildrenVisible(false);
      return;
    }

    setChildrenVisible(true);
  }, [layoutBoundsReady, windowExpanded]);

  useEffect(() => {
    if (!metrics) {
      ignoreCursorStateRef.current = null;
      void getCurrentWindow().setIgnoreCursorEvents(false).catch(() => {});
      return;
    }

    const currentWindow = getCurrentWindow();
    let cancelled = false;
    let timer: number | undefined;
    let ignoreCursorUnavailable = false;
    let scaleFactor = 1;
    const pollIntervalMs = childrenVisible || windowExpanded ? 48 : 96;

    const setIgnoreCursorEvents = async (ignore: boolean) => {
      if (ignoreCursorStateRef.current === ignore || ignoreCursorUnavailable) {
        return;
      }
      try {
        await currentWindow.setIgnoreCursorEvents(ignore);
        ignoreCursorStateRef.current = ignore;
      } catch {
        ignoreCursorUnavailable = true;
        ignoreCursorStateRef.current = null;
      }
    };

    const syncIgnoreCursorEvents = async () => {
      if (cancelled || ignoreCursorUnavailable) {
        return;
      }

      const windowPosition = await currentWindow.outerPosition().catch(() => null);
      if (!windowPosition || cancelled) {
        await setIgnoreCursorEvents(false);
        return;
      }
      const pointer = await cursorPosition().catch(() => null);
      if (!pointer || cancelled) {
        return;
      }

      const interactiveRects = buildLiveInteractiveRects({
        windowPosition,
        scaleFactor,
        open: windowExpanded && childrenVisible
      });
      if (interactiveRects.length === 0) {
        await setIgnoreCursorEvents(false);
        return;
      }
      const hitInteractivePill = interactiveRects.some((rect) => {
        return screenRectContains(rect, pointer.x, pointer.y);
      });

      await setIgnoreCursorEvents(!hitInteractivePill);
    };

    void currentWindow
      .scaleFactor()
      .then((nextScaleFactor) => {
        if (Number.isFinite(nextScaleFactor) && nextScaleFactor > 0) {
          scaleFactor = nextScaleFactor;
        }
      })
      .catch(() => {});
    void syncIgnoreCursorEvents();
    timer = window.setInterval(() => {
      void syncIgnoreCursorEvents();
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      if (timer) {
        window.clearInterval(timer);
      }
      ignoreCursorStateRef.current = null;
      void currentWindow.setIgnoreCursorEvents(false).catch(() => {});
    };
  }, [childrenVisible, metrics, windowExpanded]);

  useEffect(() => {
    let cancelled = false;

    const captureDiagnostics = async () => {
      const currentWindow = getCurrentWindow();
      const [outerPosition, outerSize, scaleFactor] = await Promise.all([
        currentWindow.outerPosition().catch(() => null),
        currentWindow.outerSize().catch(() => null),
        currentWindow.scaleFactor().catch(() => 1)
      ]);
      if (cancelled) {
        return;
      }

      const ownerRoot = document.querySelector(".fan-cluster__owner") as HTMLElement | null;
      const ownerInteractive = ownerRoot
        ? resolveInteractiveHitboxNode(ownerRoot) ?? ownerRoot
        : null;
      const childRoots = Array.from(
        document.querySelectorAll(".fan-cluster__child")
      ).filter((node): node is HTMLElement => node instanceof HTMLElement);
      const childInteractiveRects = childRoots
        .map((root) => {
          const interactiveNode = resolveInteractiveHitboxNode(root) ?? root;
          const viewportRect = serializeDomRect(interactiveNode);
          if (!viewportRect || !outerPosition) {
            return {
              viewportRect,
              screenRect: null
            };
          }

          const rawRect = interactiveNode.getBoundingClientRect();
          const screenRect = {
            left: outerPosition.x + rawRect.left * scaleFactor,
            top: outerPosition.y + rawRect.top * scaleFactor,
            right: outerPosition.x + rawRect.right * scaleFactor,
            bottom: outerPosition.y + rawRect.bottom * scaleFactor
          } satisfies ScreenRect;
          return {
            viewportRect,
            screenRect: serializeScreenRect(screenRect)
          };
        });

      const snapshot = {
        capturedAt: new Date().toISOString(),
        state:
          loading
            ? "loading"
            : loadError
              ? "error"
              : childrenVisible
                ? "open"
                : windowExpanded
                  ? "opening"
                  : "collapsed",
        ownerPinnedOpen,
        layoutBoundsReady,
        windowExpanded,
        childrenVisible,
        loading,
        loadError,
        context: {
          programName: context.programName,
          panelName: context.panelName,
          label: context.label ?? context.panelName,
          selectedFileNames: context.selectedFileNames
        },
        options: fanOptions,
        records: resolvedRecords.map((record) => ({
          fileName: record.fileName,
          label: record.label
        })),
        outerWindow: outerPosition && outerSize
          ? {
              x: outerPosition.x,
              y: outerPosition.y,
              width: outerSize.width,
              height: outerSize.height,
              scaleFactor
            }
          : null,
        collapsedOrigin: collapsedOriginRef.current,
        metrics,
        owner: {
          viewportRect: serializeDomRect(ownerInteractive),
          screenRect:
            ownerInteractive && outerPosition
              ? serializeScreenRect({
                  left: outerPosition.x + ownerInteractive.getBoundingClientRect().left * scaleFactor,
                  top: outerPosition.y + ownerInteractive.getBoundingClientRect().top * scaleFactor,
                  right: outerPosition.x + ownerInteractive.getBoundingClientRect().right * scaleFactor,
                  bottom: outerPosition.y + ownerInteractive.getBoundingClientRect().bottom * scaleFactor
                })
              : null
        },
        childInteractiveRects
      } satisfies Record<string, unknown>;

      diagnosticsHistoryRef.current = [...diagnosticsHistoryRef.current, snapshot].slice(-12);
      await writePanelFanDiagnostics("panel-fan-window-debug.json", {
        context: {
          programName: context.programName,
          panelName: context.panelName,
          label: context.label ?? context.panelName
        },
        history: diagnosticsHistoryRef.current
      });
    };

    void captureDiagnostics();
    return () => {
      cancelled = true;
    };
  }, [
    childEntries,
    childrenVisible,
    context.label,
    context.panelName,
    context.programName,
    context.selectedFileNames,
    fanOptions,
    layoutBoundsReady,
    loadError,
    loading,
    metrics,
    ownerPinnedOpen,
    resolvedRecords,
    windowExpanded
  ]);

  const requestExpand = () => {
    if (collapseIntentTimerRef.current) {
      window.clearTimeout(collapseIntentTimerRef.current);
      collapseIntentTimerRef.current = undefined;
    }
    if (collapseWindowTimerRef.current) {
      window.clearTimeout(collapseWindowTimerRef.current);
      collapseWindowTimerRef.current = undefined;
    }
    if (!windowExpanded) {
      setChildrenVisible(false);
      setLayoutBoundsReady(false);
    }
    if (
      spaceDragActive ||
      spaceDragging ||
      spaceDragSyncTimerRef.current ||
      wasSpaceDraggingRef.current
    ) {
      return;
    }
    setWindowExpanded(true);
  };

  const requestCollapse = ({ force = false }: { force?: boolean } = {}) => {
    if (
      spaceDragActive ||
      spaceDragging ||
      spaceDragSyncTimerRef.current ||
      wasSpaceDraggingRef.current
    ) {
      return;
    }
    queueGuardedCollapseWindow(force);
  };

  const handleOwnerClick = () => {
    if (collapseIntentTimerRef.current) {
      window.clearTimeout(collapseIntentTimerRef.current);
      collapseIntentTimerRef.current = undefined;
    }
    if (collapseWindowTimerRef.current) {
      window.clearTimeout(collapseWindowTimerRef.current);
      collapseWindowTimerRef.current = undefined;
    }

    if (ownerPinnedOpen) {
      setOwnerPinnedOpen(false);
      requestCollapse({ force: true });
      return;
    }

    if (
      spaceDragActive ||
      spaceDragging ||
      spaceDragSyncTimerRef.current ||
      wasSpaceDraggingRef.current
    ) {
      return;
    }

    if (!windowExpanded) {
      setChildrenVisible(false);
      setLayoutBoundsReady(false);
    }
    setOwnerPinnedOpen(true);
    setWindowExpanded(true);
  };

  const handleChildClick = async (entry: FanClusterEntry) => {
    if (!ownerPinnedOpen) {
      requestCollapse({ force: true });
    }

    try {
      await runPanelScript(context.programName, context.panelName, entry.childSlotId);
    } catch (error) {
      console.error(
        `Failed to run panel fan child ${entry.childSlotId} for ${context.programName}/${context.panelName}.`,
        error
      );
      window.alert(`Panel script could not be run.\n\n${formatErrorMessage(error)}`);
    }
  };

  const handleShellPointerDownCapture = (event: ReactPointerEvent<HTMLElement>) => {
    if (!spaceDragActive || spaceDragging || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSpaceDragging(true);
    void (async () => {
      try {
        await collapseToOwnerBeforeDrag();
        await getCurrentWindow().startDragging();
      } catch (error) {
        console.error("Failed to start panel fan drag.", error);
        setSpaceDragging(false);
      }
    })();
  };

  return (
    <main
      className={[
        "panel-fan-window-page",
        spaceDragActive ? "panel-fan-window-page--space-drag" : "",
        spaceDragging ? "panel-fan-window-page--dragging" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`Panel fan for ${context.panelName}`}
      onPointerDownCapture={handleShellPointerDownCapture}
      onPointerUp={() => {
        setSpaceDragging(false);
      }}
      onPointerCancel={() => {
        setSpaceDragging(false);
      }}
    >
      <div className="panel-fan-window-page__surface">
        {loading ? (
          <p className="panel-fan-window-page__status">Loading panel fan...</p>
        ) : loadError ? (
          <p className="panel-fan-window-page__status">{loadError}</p>
        ) : childEntries.length === 0 ? (
          <p className="panel-fan-window-page__status">No regular panel buttons were selected.</p>
        ) : (
          <FanOutButtonCluster
            ownerButton={buildOwnerButton(context.label ?? context.panelName)}
            layout={fanOptions.layout}
            placement={fanOptions.placement}
            variant="panel-fan"
            pinnedOpen={ownerPinnedOpen}
            geometryExpanded={windowExpanded}
            windowExpanded={windowExpanded}
            childrenVisible={childrenVisible}
            suspendInteraction={!hoverReady || spaceDragActive || spaceDragging}
            onExpandRequest={requestExpand}
            onCollapseRequest={requestCollapse}
            onPanelFanMetricsChange={setMetrics}
            childButtons={childEntries}
            ownerStyleGroupOverride={MAIN_PAGE_IMPORTED_STYLE_GROUP}
            ownerImportedSkinOverride={DEFAULT_POPOUT_IMPORTED_SKIN}
            styleGroupOverride={MAIN_PAGE_IMPORTED_STYLE_GROUP}
            importedSkinOverride={DEFAULT_POPOUT_IMPORTED_SKIN}
            onOwnerClick={handleOwnerClick}
            onChildClick={handleChildClick}
          />
        )}
      </div>
    </main>
  );
}
