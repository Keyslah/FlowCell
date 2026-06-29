import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { ILLUSTRATOR_LAYERS_CHANGED_EVENT } from "../../lib/programRails";
import type { BuildLayersWindowContext } from "../../lib/windowContext";
import {
  createLayer,
  deleteLayers,
  duplicateLayers,
  renameLayer,
  scanLayers,
  selectLayerObjects,
  setLayersLocked,
  setLayersVisible,
  writeHighlightedLayerKeys,
  type LayerNode,
  type LayerTreeSnapshot
} from "../../lib/illustratorLayers";
import "./buildLayersWindowPage.css";

// Canonical design width. The whole UI is laid out at this width and uniformly
// scaled to fill the window (resize scales everything), like the toolset surfaces.
const CANONICAL_WIDTH = 360;

type FlatRow = {
  node: LayerNode;
  hasChildren: boolean;
};

function flattenTree(nodes: LayerNode[], collapsed: Set<string>, out: FlatRow[]): void {
  for (const node of nodes) {
    const hasChildren = node.children.length > 0;
    out.push({ node, hasChildren });
    if (hasChildren && !collapsed.has(node.key)) {
      flattenTree(node.children, collapsed, out);
    }
  }
}

function collectKeys(nodes: LayerNode[], out: Set<string>): void {
  for (const node of nodes) {
    out.add(node.key);
    collectKeys(node.children, out);
  }
}

export default function BuildLayersWindowPage({
  context
}: {
  context: BuildLayersWindowContext;
}) {
  const [tree, setTree] = useState<LayerNode[]>([]);
  const [activeKey, setActiveKey] = useState<string>("");
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  const [windowSize, setWindowSize] = useState(() => ({
    width: Math.max(window.innerWidth, 1),
    height: Math.max(window.innerHeight, 1)
  }));

  const surfaceScale = Math.max(0.4, windowSize.width / CANONICAL_WIDTH);
  const surfaceHeight = Math.max(1, windowSize.height / surfaceScale);

  type ResizeDirection =
    | "East"
    | "North"
    | "NorthEast"
    | "NorthWest"
    | "South"
    | "SouthEast"
    | "SouthWest"
    | "West";

  const applySnapshot = useCallback((snapshot: LayerTreeSnapshot) => {
    setTree(snapshot.tree);
    setActiveKey(snapshot.active);
    const existing = new Set<string>();
    collectKeys(snapshot.tree, existing);
    setHighlighted((current) => {
      const next = new Set<string>();
      for (const key of current) {
        if (existing.has(key)) {
          next.add(key);
        }
      }
      return next;
    });
  }, []);

  const run = useCallback(
    async (action: () => Promise<LayerTreeSnapshot>) => {
      setBusy(true);
      setError("");
      try {
        const snapshot = await action();
        applySnapshot(snapshot);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusy(false);
      }
    },
    [applySnapshot]
  );

  useEffect(() => {
    void run(scanLayers);
  }, [run]);

  // Keep the persisted highlight set (read by the panel buttons) in sync.
  useEffect(() => {
    void writeHighlightedLayerKeys(Array.from(highlighted)).catch(() => {});
  }, [highlighted]);

  // Re-scan when a Layers / Layers Builder panel button runs (it mutates layers
  // out-of-process inside Illustrator, e.g. "delete sublayer"). The JSX runs
  // asynchronously after the click is accepted, so re-scan twice to catch fast
  // and slightly slower operations.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const timers: number[] = [];
    void (async () => {
      try {
        unlisten = await listen(ILLUSTRATOR_LAYERS_CHANGED_EVENT, () => {
          timers.forEach((timer) => window.clearTimeout(timer));
          timers.length = 0;
          timers.push(window.setTimeout(() => void run(scanLayers), 350));
          timers.push(window.setTimeout(() => void run(scanLayers), 1100));
        });
      } catch {
        // Event listener unavailable; manual Refresh still works.
      }
    })();
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      if (unlisten) {
        unlisten();
      }
    };
  }, [run]);

  const rows = useMemo(() => {
    const out: FlatRow[] = [];
    flattenTree(tree, collapsed, out);
    return out;
  }, [tree, collapsed]);

  const highlightedKeys = useMemo(() => Array.from(highlighted), [highlighted]);
  const singleHighlight = highlightedKeys.length === 1 ? highlightedKeys[0] : null;

  const handleRowClick = useCallback(
    (key: string, event: ReactMouseEvent) => {
      const visibleKeys = rows.map((row) => row.node.key);
      // Shift-click selects the contiguous range from the anchor row to this one.
      if (event.shiftKey && anchorKey && visibleKeys.includes(anchorKey)) {
        const a = visibleKeys.indexOf(anchorKey);
        const b = visibleKeys.indexOf(key);
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        setHighlighted(new Set(visibleKeys.slice(lo, hi + 1)));
        return;
      }
      // Ctrl/Cmd-click toggles a single row in/out of the selection.
      if (event.ctrlKey || event.metaKey) {
        setHighlighted((current) => {
          const next = new Set(current);
          if (next.has(key)) {
            next.delete(key);
          } else {
            next.add(key);
          }
          return next;
        });
        setAnchorKey(key);
        return;
      }
      // Plain click selects just this row.
      setHighlighted(new Set([key]));
      setAnchorKey(key);
    },
    [rows, anchorKey]
  );

  const toggleCollapse = useCallback((key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // Frameless window: hold Space then drag anywhere to move it, like other
  // FlowCell windows.
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
    const handleBlur = () => {
      setSpaceDragActive(false);
      setSpaceDragging(false);
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  // Track the window size so the surface scales with it.
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
    if (!spaceDragActive) {
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement && target.closest(".build-layers__resize-handle")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setSpaceDragging(true);
    void getCurrentWindow()
      .startDragging()
      .catch(() => {
        setSpaceDragging(false);
      });
  };

  const handleNewLayer = () => {
    void run(() => createLayer("", "Layer"));
  };

  const handleNewSublayer = () => {
    if (!singleHighlight) {
      setError("Highlight exactly one layer to add a sublayer under it.");
      return;
    }
    void run(() => createLayer(singleHighlight, "Sublayer"));
  };

  const handleRename = () => {
    if (!singleHighlight) {
      setError("Highlight exactly one layer to rename it.");
      return;
    }
    const current = rows.find((row) => row.node.key === singleHighlight)?.node.name ?? "";
    const nextName = window.prompt("New layer name:", current);
    if (nextName === null || nextName.trim() === "") {
      return;
    }
    void run(() => renameLayer(singleHighlight, nextName.trim()));
  };

  const handleDelete = (force: boolean) => {
    if (highlightedKeys.length === 0) {
      setError("Highlight one or more layers to delete.");
      return;
    }
    void run(() => deleteLayers(highlightedKeys, force));
  };

  const handleDuplicate = () => {
    if (highlightedKeys.length === 0) {
      setError("Highlight one or more layers to duplicate.");
      return;
    }
    void run(() => duplicateLayers(highlightedKeys));
  };

  const handleToggleLock = (node: LayerNode) => {
    void run(() => setLayersLocked([node.key], !node.locked));
  };

  const handleToggleVisible = (node: LayerNode) => {
    void run(() => setLayersVisible([node.key], node.hidden));
  };

  const handleSelectObjects = (node: LayerNode) => {
    void run(() => selectLayerObjects(node.key));
  };

  return (
    <div
      className={[
        "build-layers-window",
        spaceDragActive ? "build-layers-window--space-drag" : "",
        spaceDragging ? "build-layers-window--dragging" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      data-program={context.programName}
      onPointerDownCapture={handleShellPointerDown}
      onPointerUp={() => setSpaceDragging(false)}
      onPointerCancel={() => setSpaceDragging(false)}
    >
      <div
        className="build-layers__resize-handle build-layers__resize-handle--north"
        onPointerDown={startResizeDrag("North")}
      />
      <div
        className="build-layers__resize-handle build-layers__resize-handle--south"
        onPointerDown={startResizeDrag("South")}
      />
      <div
        className="build-layers__resize-handle build-layers__resize-handle--east"
        onPointerDown={startResizeDrag("East")}
      />
      <div
        className="build-layers__resize-handle build-layers__resize-handle--west"
        onPointerDown={startResizeDrag("West")}
      />
      <div
        className="build-layers__resize-handle build-layers__resize-handle--north-east"
        onPointerDown={startResizeDrag("NorthEast")}
      />
      <div
        className="build-layers__resize-handle build-layers__resize-handle--north-west"
        onPointerDown={startResizeDrag("NorthWest")}
      />
      <div
        className="build-layers__resize-handle build-layers__resize-handle--south-east"
        onPointerDown={startResizeDrag("SouthEast")}
      />
      <div
        className="build-layers__resize-handle build-layers__resize-handle--south-west"
        onPointerDown={startResizeDrag("SouthWest")}
      />

      <div
        className="build-layers__scale"
        style={{
          width: `${CANONICAL_WIDTH}px`,
          height: `${surfaceHeight}px`,
          transform: `scale(${surfaceScale})`,
          transformOrigin: "top left"
        }}
      >
        <div className="build-layers">
      <div className="build-layers__toolbar">
        <button type="button" onClick={handleNewLayer} disabled={busy}>
          + Layer
        </button>
        <button type="button" onClick={handleNewSublayer} disabled={busy}>
          + Sublayer
        </button>
        <button type="button" onClick={handleRename} disabled={busy}>
          Rename
        </button>
        <button type="button" onClick={() => void run(scanLayers)} disabled={busy}>
          Refresh
        </button>
        <button type="button" onClick={handleDuplicate} disabled={busy}>
          Duplicate
        </button>
        <button type="button" onClick={() => handleDelete(false)} disabled={busy}>
          Delete
        </button>
        <button
          type="button"
          className="build-layers__force"
          onClick={() => handleDelete(true)}
          disabled={busy}
          title="Delete even locked/hidden layers"
        >
          Force Delete
        </button>
      </div>

      <div className="build-layers__tree">
        {rows.length === 0 && busy ? (
          <div className="build-layers__empty">Scanning Illustrator…</div>
        ) : rows.length === 0 ? (
          <div className="build-layers__empty">No layers found. Open a document and Refresh.</div>
        ) : (
          rows.map((row) => {
            const { node, hasChildren } = row;
            const isHighlighted = highlighted.has(node.key);
            const isActive = node.key === activeKey;
            return (
              <div
                key={node.key}
                className={[
                  "build-layers__row",
                  isHighlighted ? "is-highlighted" : "",
                  isActive ? "is-active" : "",
                  node.locked ? "is-locked" : "",
                  node.hidden ? "is-hidden" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ paddingLeft: `${8 + node.depth * 16}px` }}
                onClick={(event) => handleRowClick(node.key, event)}
              >
                <button
                  type="button"
                  className="build-layers__twisty"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (hasChildren) {
                      toggleCollapse(node.key);
                    }
                  }}
                  tabIndex={-1}
                >
                  {hasChildren ? (collapsed.has(node.key) ? "▸" : "▾") : ""}
                </button>
                <button
                  type="button"
                  className="build-layers__icon"
                  title={node.hidden ? "Show" : "Hide"}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleToggleVisible(node);
                  }}
                >
                  {node.hidden ? "🚫" : "👁"}
                </button>
                <button
                  type="button"
                  className="build-layers__icon"
                  title={node.locked ? "Unlock" : "Lock"}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleToggleLock(node);
                  }}
                >
                  {node.locked ? "🔒" : "🔓"}
                </button>
                <span className="build-layers__name">{node.name}</span>
                {node.itemCount > 0 ? (
                  <span className="build-layers__count">{node.itemCount}</span>
                ) : null}
                <button
                  type="button"
                  className="build-layers__target"
                  title="Select all objects on this layer"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleSelectObjects(node);
                  }}
                  tabIndex={-1}
                />
              </div>
            );
          })
        )}
      </div>

          {error ? <div className="build-layers__errorbar">{error}</div> : null}
        </div>
      </div>
    </div>
  );
}
