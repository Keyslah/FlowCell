import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { readRegisteredLayoutWindow } from "../../lib/layoutSnapshots";
import "./windowGridWindowPage.css";

const SELF_LABEL = "flowcell-window-grid";

type KnownWindow = {
  program: string;
  panel: string;
  title: string;
  closeable?: boolean;
};

// Windows that aren't in the managed-layout registry get sensible grouping here.
const KNOWN_WINDOWS: Record<string, KnownWindow> = {
  main: { program: "FlowCell", panel: "", title: "Main", closeable: false },
  "flowcell-binds": { program: "FlowCell", panel: "", title: "Binds" },
  "flowcell-macro-lab": { program: "FlowCell", panel: "", title: "Macro Lab" }
};

type WindowEntry = {
  label: string;
  program: string;
  panel: string;
  title: string;
  closeable: boolean;
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

function programRank(program: string): number {
  const normalized = program.toLowerCase();
  if (normalized === "other") {
    return 3;
  }
  if (normalized === "flowcell") {
    return 2;
  }
  return 1;
}

export default function WindowGridWindowPage() {
  const [entries, setEntries] = useState<WindowEntry[]>([]);
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);

  const refresh = useCallback(async () => {
    const all = await WebviewWindow.getAll().catch(() => []);
    const next: WindowEntry[] = [];
    for (const handle of all) {
      const label = handle.label;
      if (label === SELF_LABEL) {
        continue;
      }
      const meta = readRegisteredLayoutWindow(label);
      const known = KNOWN_WINDOWS[label];
      const program = (meta?.programName || known?.program || "Other").trim() || "Other";
      const panel = (meta?.panelName || known?.panel || "").trim();
      const title = (
        known?.title ||
        meta?.buttonPopoutUnitId ||
        meta?.buttonFanSetupId ||
        (meta?.kind === "button-editor" ? "Buttons Editor" : label)
      ).trim() || label;
      const closeable = known?.closeable !== false && label !== "main";
      next.push({ label, program, panel, title, closeable });
    }
    next.sort(
      (a, b) =>
        programRank(a.program) - programRank(b.program) ||
        a.program.localeCompare(b.program) ||
        a.panel.localeCompare(b.panel) ||
        a.title.localeCompare(b.title)
    );
    setEntries(next);
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1200);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // Frameless window: hold Space then drag to move it.
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
    if (target instanceof HTMLElement && target.closest(".window-grid__resize-handle")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setSpaceDragging(true);
    void getCurrentWindow()
      .startDragging()
      .catch(() => setSpaceDragging(false));
  };

  const focusWindow = async (label: string) => {
    const handle = await WebviewWindow.getByLabel(label);
    if (!handle) {
      return;
    }
    if (await handle.isMinimized().catch(() => false)) {
      await handle.unminimize().catch(() => {});
    }
    await handle.show().catch(() => {});
    await handle.setFocus().catch(() => {});
  };

  const closeWindow = async (label: string) => {
    const handle = await WebviewWindow.getByLabel(label);
    if (handle) {
      await handle.close().catch(() => {});
    }
    await refresh();
  };

  const groups = useMemo(() => {
    const byProgram = new Map<string, Map<string, WindowEntry[]>>();
    for (const entry of entries) {
      let panels = byProgram.get(entry.program);
      if (!panels) {
        panels = new Map<string, WindowEntry[]>();
        byProgram.set(entry.program, panels);
      }
      const panelKey = entry.panel || "—";
      const list = panels.get(panelKey) ?? [];
      list.push(entry);
      panels.set(panelKey, list);
    }
    return byProgram;
  }, [entries]);

  return (
    <div
      className={[
        "window-grid",
        spaceDragActive ? "window-grid--space-drag" : "",
        spaceDragging ? "window-grid--dragging" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerDownCapture={handleShellPointerDown}
      onPointerUp={() => setSpaceDragging(false)}
      onPointerCancel={() => setSpaceDragging(false)}
    >
      <div
        className="window-grid__resize-handle window-grid__resize-handle--north"
        onPointerDown={startResizeDrag("North")}
      />
      <div
        className="window-grid__resize-handle window-grid__resize-handle--south"
        onPointerDown={startResizeDrag("South")}
      />
      <div
        className="window-grid__resize-handle window-grid__resize-handle--east"
        onPointerDown={startResizeDrag("East")}
      />
      <div
        className="window-grid__resize-handle window-grid__resize-handle--west"
        onPointerDown={startResizeDrag("West")}
      />
      <div
        className="window-grid__resize-handle window-grid__resize-handle--north-east"
        onPointerDown={startResizeDrag("NorthEast")}
      />
      <div
        className="window-grid__resize-handle window-grid__resize-handle--north-west"
        onPointerDown={startResizeDrag("NorthWest")}
      />
      <div
        className="window-grid__resize-handle window-grid__resize-handle--south-east"
        onPointerDown={startResizeDrag("SouthEast")}
      />
      <div
        className="window-grid__resize-handle window-grid__resize-handle--south-west"
        onPointerDown={startResizeDrag("SouthWest")}
      />

      <div className="window-grid__toolbar">
        <span className="window-grid__title">Windows</span>
        <div className="window-grid__toolbar-actions">
          <button type="button" onClick={() => void refresh()}>
            Refresh
          </button>
          <button
            type="button"
            className="window-grid__close"
            title="Close the Window Grid"
            onClick={() => void getCurrentWindow().close().catch(() => {})}
          >
            ×
          </button>
        </div>
      </div>

      <div className="window-grid__body">
        {entries.length === 0 ? (
          <div className="window-grid__empty">No open FlowCell windows.</div>
        ) : (
          Array.from(groups.entries()).map(([program, panels]) => (
            <section key={program} className="window-grid__program">
              <h2 className="window-grid__program-title">{program}</h2>
              {Array.from(panels.entries()).map(([panel, list]) => (
                <div key={panel} className="window-grid__panel">
                  <h3 className="window-grid__panel-title">{panel}</h3>
                  <div className="window-grid__cards">
                    {list.map((entry) => (
                      <div
                        key={entry.label}
                        className="window-grid__card"
                        title={entry.title}
                        onClick={() => void focusWindow(entry.label)}
                      >
                        <span className="window-grid__card-title">{entry.title}</span>
                        {entry.closeable ? (
                          <button
                            type="button"
                            className="window-grid__card-close"
                            title="Close this window"
                            onClick={(event) => {
                              event.stopPropagation();
                              void closeWindow(entry.label);
                            }}
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
