import { useEffect, useRef, useState } from "react";
import { emit, emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";
import { makeSafeTauriUnlisten } from "../../lib/safeTauriUnlisten";
import type { ButtonPlacement } from "../types";
import type { FlowCellBounds } from "../../types";
import type { ProgramPopoutThemeScreenGeometry } from "../../theme/programPopoutTheme";
import {
  aggregateProgramPopoutThemeScreenRange,
  isProgramPopoutThemeWindowRange,
  programPopoutThemeProgramKey,
  programPopoutThemeWindowRange,
  type ProgramPopoutThemeWindowRange
} from "./programPopoutThemeScreenRange";

const RANGE_EVENT = "flowcell:program-popout-screen-range";
const REQUEST_EVENT = "flowcell:program-popout-screen-range-request";
interface RangeUpdate { label: string; range: ProgramPopoutThemeWindowRange | null }

/** Live window bounds are shared separately from saved Button documents and packages. */
export function useProgramPopoutThemeScreenRange(args: {
  enabled: boolean;
  programName: string;
  placements: readonly ButtonPlacement[];
  geometry: (ProgramPopoutThemeScreenGeometry & { monitorWorkArea: FlowCellBounds }) | undefined;
}): { minimumY: number; maximumY: number } | undefined {
  const programKey = programPopoutThemeProgramKey(args.programName);
  const own = args.enabled ? programPopoutThemeWindowRange(programKey, args.placements, args.geometry) : undefined;
  const ownSignature = JSON.stringify(own ?? null);
  const ownRef = useRef(own);
  ownRef.current = own;
  const publishRef = useRef<() => void>(() => {});
  const [peers, setPeers] = useState<Record<string, ProgramPopoutThemeWindowRange>>({});

  useEffect(() => {
    setPeers({});
    if (!args.enabled) return;
    const currentWindow = getCurrentWindow();
    let disposed = false;
    let ready = false;
    let visible = false;
    let checkingVisibility = false;
    let lastPublished = "";
    let pruneTimer: number | null = null;
    const stops: UnlistenFn[] = [];
    const publish = (requesterLabel?: string) => {
      if (disposed || !ready) return;
      const range = visible ? ownRef.current ?? null : null;
      const signature = JSON.stringify(range);
      if (!requesterLabel && signature === lastPublished) return;
      const update = { label: currentWindow.label, range } satisfies RangeUpdate;
      if (requesterLabel) void emitTo(requesterLabel, RANGE_EVENT, update).catch(() => {});
      else {
        lastPublished = signature;
        void emit(RANGE_EVENT, update).catch(() => {});
      }
    };
    publishRef.current = publish;
    const checkVisibility = async () => {
      if (disposed || checkingVisibility) return;
      checkingVisibility = true;
      const [shown, minimized] = await Promise.all([
        currentWindow.isVisible().catch(() => false),
        currentWindow.isMinimized().catch(() => true)
      ]);
      checkingVisibility = false;
      if (disposed) return;
      visible = shown && !minimized;
      publish();
    };
    const removePeer = (label: string) => setPeers((current) => {
      if (!current[label]) return current;
      const next = { ...current };
      delete next[label];
      return next;
    });
    // A destroyed WebView cannot reliably run pagehide. Prune only after native
    // destruction (or initial join), never on a theme/package update.
    const pruneClosedWindows = () => {
      if (disposed || pruneTimer !== null) return;
      pruneTimer = window.setTimeout(() => {
        pruneTimer = null;
        void getAllWindows().then((windows) => {
          if (disposed) return;
          const labels = new Set(windows.map((entry) => entry.label));
          setPeers((current) => {
            const remaining = Object.entries(current).filter(([label]) => labels.has(label));
            return remaining.length === Object.keys(current).length ? current : Object.fromEntries(remaining);
          });
        }).catch(() => {});
      }, 50);
    };
    const withdraw = () => {
      visible = false;
      publish();
    };
    void Promise.all([
      listen<RangeUpdate>(RANGE_EVENT, ({ payload }) => {
        if (disposed || !payload || typeof payload.label !== "string" || payload.label === currentWindow.label) return;
        if (!isProgramPopoutThemeWindowRange(payload.range) || payload.range.programName !== programKey) {
          removePeer(payload.label);
          return;
        }
        const range = payload.range;
        setPeers((current) => JSON.stringify(current[payload.label]) === JSON.stringify(range)
          ? current : { ...current, [payload.label]: range });
      }),
      listen<{ programName: string; requesterLabel: string }>(REQUEST_EVENT, ({ payload }) => {
        if (payload?.programName === programKey && typeof payload.requesterLabel === "string" &&
            payload.requesterLabel !== currentWindow.label) publish(payload.requesterLabel);
      }),
      listen("tauri://destroyed", pruneClosedWindows)
    ].map(async (subscription) => {
      const stop = makeSafeTauriUnlisten(await subscription);
      if (disposed) stop();
      else stops.push(stop);
    })).then(async () => {
      if (disposed) return;
      ready = true;
      await checkVisibility();
      if (disposed) return;
      await emit(REQUEST_EVENT, { programName: programKey, requesterLabel: currentWindow.label });
      pruneClosedWindows();
    }).catch(() => {});
    // Windows does not send a Tauri shown/hidden event. These two small queries
    // back up browser visibility events; unchanged visibility emits no messages.
    const timer = window.setInterval(() => { void checkVisibility(); }, 2000);
    const refreshVisibility = () => { void checkVisibility(); };
    window.document.addEventListener("visibilitychange", refreshVisibility);
    window.addEventListener("focus", refreshVisibility);
    window.addEventListener("pagehide", withdraw);
    return () => {
      withdraw();
      disposed = true;
      publishRef.current = () => {};
      stops.forEach((stop) => stop());
      window.clearInterval(timer);
      if (pruneTimer !== null) window.clearTimeout(pruneTimer);
      window.document.removeEventListener("visibilitychange", refreshVisibility);
      window.removeEventListener("focus", refreshVisibility);
      window.removeEventListener("pagehide", withdraw);
    };
  }, [args.enabled, programKey]);

  useEffect(() => { publishRef.current(); }, [ownSignature]);
  return aggregateProgramPopoutThemeScreenRange(own, Object.values(peers));
}
