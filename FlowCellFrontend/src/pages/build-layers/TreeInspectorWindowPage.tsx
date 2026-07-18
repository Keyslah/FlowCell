import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import type { ProgramDataInvalidationEvent } from "../../lib/programRails";
import type {
  BuildLayersWindowContext,
  ToolPageWindowContext
} from "../../lib/windowContext";
import {
  createProgramTreeItem,
  deleteProgramTreeItems,
  duplicateProgramTreeItems,
  renameProgramTreeItem,
  scanProgramTree,
  selectProgramTreeItemContents,
  setProgramTreeItemsLocked,
  setProgramTreeItemsVisible,
  writeProgramToolPageSelection,
  type ProgramTreeNode,
  type ProgramTreeSnapshot,
  type ProgramToolPageSource
} from "../../lib/programToolPages";
import "./buildLayersWindowPage.css";

// Canonical design width. The whole UI is laid out at this width and uniformly
// scaled to fill the window (resize scales everything), like the toolset surfaces.
const CANONICAL_WIDTH = 360;

type FlatRow = {
  node: ProgramTreeNode;
  hasChildren: boolean;
};

type SnapshotSelectionPolicy = "preserve" | "clear" | "clear-if-structure-changed";

function flattenTree(nodes: ProgramTreeNode[], collapsed: Set<string>, out: FlatRow[]): void {
  for (const node of nodes) {
    const hasChildren = node.children.length > 0;
    out.push({ node, hasChildren });
    if (hasChildren && !collapsed.has(node.key)) {
      flattenTree(node.children, collapsed, out);
    }
  }
}

function collectKeys(nodes: ProgramTreeNode[], out: Set<string>): void {
  for (const node of nodes) {
    out.add(node.key);
    collectKeys(node.children, out);
  }
}

function positionalTreeFingerprint(nodes: readonly ProgramTreeNode[]): string {
  return JSON.stringify(nodes.map((node) => [
    node.key,
    node.name,
    positionalTreeFingerprint(node.children)
  ]));
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && Array.from(left).every((key) => right.has(key));
}

export default function TreeInspectorWindowPage({
  context
}: {
  context: BuildLayersWindowContext | ToolPageWindowContext;
}) {
  const [tree, setTree] = useState<ProgramTreeNode[]>([]);
  const [activeKey, setActiveKey] = useState<string>("");
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>("");
  const [selectionError, setSelectionError] = useState<string>("");
  const [selectionSyncing, setSelectionSyncing] = useState(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  const [windowSize, setWindowSize] = useState(() => ({
    width: Math.max(window.innerWidth, 1),
    height: Math.max(window.innerHeight, 1)
  }));

  const surfaceScale = Math.max(0.4, windowSize.width / CANONICAL_WIDTH);
  const surfaceHeight = Math.max(1, windowSize.height / surfaceScale);
  const pageConfiguration = useMemo(() => context.kind === "tool-page"
    ? context
    : {
        ...context,
        kind: "tool-page" as const,
        contributionId: "illustrator.layer-tree",
        renderer: "tree-inspector" as const,
        capability: "illustrator-layer-tree",
        title: context.label?.trim() || "Layer Tree",
        resourceLabel: "Layer",
        emptyMessage: "No layers found. Open a document and Refresh."
      }, [context]);
  const resourceLabel = pageConfiguration.resourceLabel?.trim() || "Item";
  const treeSource = useMemo<ProgramToolPageSource>(
    () => ({
      programName: context.programName,
      panelName: context.panelName,
      fileName: context.fileName,
      capability: pageConfiguration.capability
    }),
    [context.fileName, context.panelName, context.programName, pageConfiguration.capability]
  );
  const treeRef = useRef<ProgramTreeNode[]>([]);
  const highlightedRef = useRef<Set<string>>(new Set());
  const persistedHighlightedRef = useRef<Set<string>>(new Set());
  const selectionWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const selectionWriteRequestRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  type ResizeDirection =
    | "East"
    | "North"
    | "NorthEast"
    | "NorthWest"
    | "South"
    | "SouthEast"
    | "SouthWest"
    | "West";

  const persistHighlightedSelection = useCallback((
    nextKeys: Iterable<string>,
    options: { revertOnFailure?: boolean } = {}
  ): Promise<void> => {
    const next = new Set(nextKeys);
    const requestId = selectionWriteRequestRef.current + 1;
    selectionWriteRequestRef.current = requestId;
    highlightedRef.current = next;
    setHighlighted(next);
    setSelectionSyncing(true);

    const write = selectionWriteQueueRef.current
      .catch(() => {})
      .then(() => writeProgramToolPageSelection(treeSource, Array.from(next)))
      .then(() => {
        persistedHighlightedRef.current = next;
        if (!mountedRef.current || requestId !== selectionWriteRequestRef.current) return;
        setSelectionError("");
        setSelectionSyncing(false);
      })
      .catch((caught) => {
        const detail = caught instanceof Error ? caught.message : String(caught);
        console.error("Failed to persist the program tool-page selection.", caught);
        if (mountedRef.current && requestId === selectionWriteRequestRef.current) {
          if (options.revertOnFailure !== false) {
            const persisted = new Set(persistedHighlightedRef.current);
            highlightedRef.current = persisted;
            setHighlighted(persisted);
          }
          setSelectionError(
            `${resourceLabel} selection could not be saved. Panel actions may still use the previous selection. ${detail}`
          );
          setSelectionSyncing(false);
        }
        throw caught;
      });
    selectionWriteQueueRef.current = write;
    return write;
  }, [resourceLabel, treeSource]);

  const applySnapshot = useCallback(async (
    snapshot: ProgramTreeSnapshot,
    selectionPolicy: SnapshotSelectionPolicy
  ) => {
    const structureChanged = positionalTreeFingerprint(treeRef.current) !==
      positionalTreeFingerprint(snapshot.tree);
    const invalidatePositionalState = selectionPolicy === "clear" ||
      (selectionPolicy === "clear-if-structure-changed" && structureChanged);
    treeRef.current = snapshot.tree;
    setTree(snapshot.tree);
    setActiveKey(snapshot.active);
    const existing = new Set<string>();
    collectKeys(snapshot.tree, existing);
    setCollapsed((current) => {
      if (invalidatePositionalState) return new Set();
      return new Set(Array.from(current).filter((key) => existing.has(key)));
    });
    if (invalidatePositionalState) {
      setAnchorKey(null);
      await persistHighlightedSelection([], { revertOnFailure: false });
      return;
    }

    setAnchorKey((current) => current && existing.has(current) ? current : null);
    const next = new Set(Array.from(highlightedRef.current).filter((key) => existing.has(key)));
    if (!setsEqual(next, highlightedRef.current)) {
      await persistHighlightedSelection(next);
    }
  }, [persistHighlightedSelection]);

  const run = useCallback(
    async (
      action: () => Promise<ProgramTreeSnapshot>,
      selectionPolicy: SnapshotSelectionPolicy = "preserve"
    ) => {
      setBusy(true);
      setError("");
      try {
        const snapshot = await action();
        await applySnapshot(snapshot, selectionPolicy);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusy(false);
      }
    },
    [applySnapshot]
  );

  useEffect(() => {
    void run(() => scanProgramTree(treeSource), "clear-if-structure-changed");
  }, [treeSource, run]);

  // A contribution may publish a refresh event after an out-of-process mutation.
  // Re-scan twice to catch both fast and slightly slower program operations.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const timers: number[] = [];
    void (async () => {
      try {
        if (!pageConfiguration.refreshEvent) return;
        unlisten = await listen<ProgramDataInvalidationEvent>(pageConfiguration.refreshEvent, (event) => {
          if (
            event.payload?.programName &&
            event.payload.programName.toLowerCase() !== context.programName.toLowerCase()
          ) {
            return;
          }
          setAnchorKey(null);
          void persistHighlightedSelection([], { revertOnFailure: false }).catch(() => {});
          timers.forEach((timer) => window.clearTimeout(timer));
          timers.length = 0;
          timers.push(window.setTimeout(() => {
            void run(() => scanProgramTree(treeSource), "clear-if-structure-changed");
          }, 350));
          timers.push(window.setTimeout(() => {
            void run(() => scanProgramTree(treeSource), "clear-if-structure-changed");
          }, 1100));
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
  }, [
    context.programName,
    pageConfiguration.refreshEvent,
    persistHighlightedSelection,
    run,
    treeSource
  ]);

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
        void persistHighlightedSelection(visibleKeys.slice(lo, hi + 1)).catch(() => {});
        return;
      }
      // Ctrl/Cmd-click toggles a single row in/out of the selection.
      if (event.ctrlKey || event.metaKey) {
        const next = new Set(highlightedRef.current);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        void persistHighlightedSelection(next).catch(() => {});
        setAnchorKey(key);
        return;
      }
      // Plain click selects just this row.
      void persistHighlightedSelection([key]).catch(() => {});
      setAnchorKey(key);
    },
    [rows, anchorKey, persistHighlightedSelection]
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

  const handleNewItem = () => {
    void run(() => createProgramTreeItem(treeSource, "", resourceLabel), "clear");
  };

  const handleNewChild = () => {
    if (!singleHighlight) {
      setError(`Highlight exactly one ${resourceLabel.toLowerCase()} to add a child under it.`);
      return;
    }
    void run(() => createProgramTreeItem(treeSource, singleHighlight, resourceLabel), "clear");
  };

  const handleRename = () => {
    if (!singleHighlight) {
      setError(`Highlight exactly one ${resourceLabel.toLowerCase()} to rename it.`);
      return;
    }
    const current = rows.find((row) => row.node.key === singleHighlight)?.node.name ?? "";
    const nextName = window.prompt(`New ${resourceLabel.toLowerCase()} name:`, current);
    if (nextName === null || nextName.trim() === "") {
      return;
    }
    void run(() => renameProgramTreeItem(treeSource, singleHighlight, nextName.trim()));
  };

  const handleDelete = (force: boolean) => {
    if (highlightedKeys.length === 0) {
      setError(`Highlight one or more ${resourceLabel.toLowerCase()} items to delete.`);
      return;
    }
    void run(() => deleteProgramTreeItems(treeSource, highlightedKeys, force), "clear");
  };

  const handleDuplicate = () => {
    if (highlightedKeys.length === 0) {
      setError(`Highlight one or more ${resourceLabel.toLowerCase()} items to duplicate.`);
      return;
    }
    void run(() => duplicateProgramTreeItems(treeSource, highlightedKeys), "clear");
  };

  const handleToggleLock = (node: ProgramTreeNode) => {
    void run(() => setProgramTreeItemsLocked(treeSource, [node.key], !node.locked));
  };

  const handleToggleVisible = (node: ProgramTreeNode) => {
    void run(() => setProgramTreeItemsVisible(treeSource, [node.key], node.hidden));
  };

  const handleSelectContents = (node: ProgramTreeNode) => {
    void run(() => selectProgramTreeItemContents(treeSource, node.key));
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
        <button type="button" onClick={handleNewItem} disabled={busy || selectionSyncing}>
          + {resourceLabel}
        </button>
        <button type="button" onClick={handleNewChild} disabled={busy || selectionSyncing}>
          + Child
        </button>
        <button type="button" onClick={handleRename} disabled={busy || selectionSyncing}>
          Rename
        </button>
        <button
          type="button"
          onClick={() => void run(() => scanProgramTree(treeSource), "clear-if-structure-changed")}
          disabled={busy || selectionSyncing}
        >
          Refresh
        </button>
        <button type="button" onClick={handleDuplicate} disabled={busy || selectionSyncing}>
          Duplicate
        </button>
        <button type="button" onClick={() => handleDelete(false)} disabled={busy || selectionSyncing}>
          Delete
        </button>
        <button
          type="button"
          className="build-layers__force"
          onClick={() => handleDelete(true)}
          disabled={busy || selectionSyncing}
          title={`Delete even locked or hidden ${resourceLabel.toLowerCase()} items`}
        >
          Force Delete
        </button>
      </div>

      <div className="build-layers__tree">
        {rows.length === 0 && busy ? (
          <div className="build-layers__empty">Scanning {pageConfiguration.title}{"\u2026"}</div>
        ) : rows.length === 0 ? (
          <div className="build-layers__empty">
            {pageConfiguration.emptyMessage || `No ${resourceLabel.toLowerCase()} items found.`}
          </div>
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
                  {hasChildren ? (collapsed.has(node.key) ? "\u25B8" : "\u25BE") : ""}
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
                  {node.hidden ? "\u{1F6AB}" : "\u{1F441}"}
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
                  {node.locked ? "\u{1F512}" : "\u{1F513}"}
                </button>
                <span className="build-layers__name">{node.name}</span>
                {node.itemCount > 0 ? (
                  <span className="build-layers__count">{node.itemCount}</span>
                ) : null}
                <button
                  type="button"
                  className="build-layers__target"
                  title={`Select the contents of this ${resourceLabel.toLowerCase()}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleSelectContents(node);
                  }}
                  tabIndex={-1}
                />
              </div>
            );
          })
        )}
      </div>

          {error || selectionError ? (
            <div className="build-layers__errorbar">{[error, selectionError].filter(Boolean).join(" ")}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
