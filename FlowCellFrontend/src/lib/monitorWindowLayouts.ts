import { emitTo, listen } from "@tauri-apps/api/event";
import { availableMonitors, getCurrentWindow, type Monitor } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { FlowCellBounds } from "../types.js";
import type { ButtonDesktopBounds } from "../button/types.js";
import { isUsableButtonWindowBounds } from "../button/windows/buttonWindowGeometry.js";

const LIVE_PREFIX = "flowcell.monitor-button-geometry.v1:";
const ACK_PREFIX = "flowcell.monitor-button-ack.v1:";
const SAVED_KEY = "flowcell.monitor-button-layouts.v1";
const RESTORE_EVENT = "flowcell:monitor-button-layout";
const SAMPLE_MS = 300;
const SETTLE_MS = 900;

export interface MonitorButtonGeometry {
  kind: "button-popout" | "button-fan";
  // Pop uses its expanded resting frame; Fan uses its collapsed owner frame.
  // Neither the monitor-sized HWND nor a transient hover envelope belongs here.
  bounds: FlowCellBounds;
  collapsedOrigin?: { x: number; y: number };
}

type GeometryMap = Record<string, MonitorButtonGeometry>;
type SavedLayouts = Record<string, GeometryMap>;
interface RestoreRequest { requestId: string; topologyKey: string; geometry: MonitorButtonGeometry }
const receivedRestores = new Map<string, Promise<void>>();
let latestRestore: RestoreRequest | undefined;

export function monitorGeometryBounds(bounds: ButtonDesktopBounds): FlowCellBounds {
  return { Left: bounds.left, Top: bounds.top, Width: bounds.width, Height: bounds.height };
}

function validGeometry(value: unknown): value is MonitorButtonGeometry {
  if (!value || typeof value !== "object") return false;
  const geometry = value as MonitorButtonGeometry;
  return (geometry.kind === "button-popout" || geometry.kind === "button-fan") &&
    isUsableButtonWindowBounds(geometry.bounds) &&
    (!geometry.collapsedOrigin ||
      (Number.isFinite(geometry.collapsedOrigin.x) && Number.isFinite(geometry.collapsedOrigin.y)));
}

export function publishMonitorButtonGeometry(geometry: MonitorButtonGeometry): void {
  if (!validGeometry(geometry)) return;
  const key = LIVE_PREFIX + getCurrentWindow().label;
  const serialized = JSON.stringify(geometry);
  if (window.localStorage.getItem(key) !== serialized) window.localStorage.setItem(key, serialized);
}

export function listenForMonitorButtonGeometry(
  handler: (geometry: MonitorButtonGeometry, isCurrent: () => Promise<boolean>) => Promise<void>
): Promise<() => void> {
  return listen<RestoreRequest>(RESTORE_EVENT, ({ payload }) => {
    if (typeof payload?.requestId !== "string" || typeof payload.topologyKey !== "string" || !validGeometry(payload.geometry)) return;
    if (receivedRestores.has(payload.requestId)) return;
    const work = (async () => {
      if (monitorTopologyKey(await availableMonitors()) !== payload.topologyKey) {
        receivedRestores.delete(payload.requestId);
        return;
      }
      const order = (request: RestoreRequest) => request.requestId.split(":").map(Number);
      const [time, sequence] = order(payload);
      const [latestTime, latestSequence] = latestRestore ? order(latestRestore) : [-1, -1];
      if (time < latestTime || (time === latestTime && sequence < latestSequence)) return;
      latestRestore = payload;
      const isCurrent = async () => latestRestore?.requestId === payload.requestId &&
        monitorTopologyKey(await availableMonitors()) === payload.topologyKey;
      await handler(payload.geometry, isCurrent);
      if (!await isCurrent()) {
        receivedRestores.delete(payload.requestId);
        return;
      }
      window.localStorage.setItem(ACK_PREFIX + getCurrentWindow().label, payload.requestId);
    })().catch((error) => {
      receivedRestores.delete(payload.requestId);
      console.error("Could not restore Button monitor placement", error);
    });
    receivedRestores.set(payload.requestId, work);
    if (receivedRestores.size > 32) receivedRestores.delete(receivedRestores.keys().next().value!);
  });
}

export function monitorTopologyKey(monitors: readonly Monitor[]): string {
  return JSON.stringify(monitors.map((monitor) => [
    monitor.name, monitor.position.x, monitor.position.y, monitor.size.width, monitor.size.height,
    monitor.workArea.position.x, monitor.workArea.position.y,
    monitor.workArea.size.width, monitor.workArea.size.height, monitor.scaleFactor
  ]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
}

export function fitMonitorButtonGeometry(
  geometry: MonitorButtonGeometry,
  workAreas: readonly FlowCellBounds[]
): MonitorButtonGeometry {
  const areas = workAreas.filter(isUsableButtonWindowBounds);
  if (!areas.length) return geometry;
  const bounds = geometry.bounds;
  const centerX = bounds.Left + bounds.Width / 2;
  const centerY = bounds.Top + bounds.Height / 2;
  const distance = (area: FlowCellBounds) =>
    Math.max(area.Left - centerX, 0, centerX - area.Left - area.Width) ** 2 +
    Math.max(area.Top - centerY, 0, centerY - area.Top - area.Height) ** 2;
  const area = areas.reduce((nearest, candidate) => distance(candidate) < distance(nearest) ? candidate : nearest);
  // Moving to a smaller screen must not resize the user's Button/skin. An
  // oversized frame starts at the work-area origin so its controls are reachable.
  const width = bounds.Width;
  const height = bounds.Height;
  const left = Math.max(area.Left, Math.min(bounds.Left, area.Left + area.Width - width));
  const top = Math.max(area.Top, Math.min(bounds.Top, area.Top + area.Height - height));
  return {
    ...geometry,
    bounds: { Left: left, Top: top, Width: width, Height: height },
    ...(geometry.collapsedOrigin ? { collapsedOrigin: {
      x: left + geometry.collapsedOrigin.x - bounds.Left,
      y: top + geometry.collapsedOrigin.y - bounds.Top
    } } : {})
  };
}

// The observer keeps the last stable sample BEFORE Windows evacuates a display.
// A transient topology never replaces either group's remembered geometry.
export class MonitorButtonLayoutMemory {
  private activeKey: string | null = null;
  private pendingKey: string | null = null;
  private pendingSince = 0;
  private restoringUntil = 0;
  private pendingRestores = new Set<string>();

  constructor(readonly layouts: SavedLayouts = {}) {}

  acknowledge(label: string): void { this.pendingRestores.delete(label); }

  sample(key: string, current: GeometryMap, workAreas: readonly FlowCellBounds[], now: number): GeometryMap | null {
    if (!this.activeKey) {
      this.activeKey = key;
      this.layouts[key] = structuredClone(current);
      return null;
    }
    if (key === this.activeKey) {
      this.pendingKey = null;
      if (now >= this.restoringUntil) {
        const next = structuredClone(current);
        for (const label of this.pendingRestores) {
          if (this.layouts[key]?.[label]) next[label] = this.layouts[key][label];
        }
        this.layouts[key] = next;
      }
      return null;
    }
    if (key !== this.pendingKey) {
      this.pendingKey = key;
      this.pendingSince = now;
      return null;
    }
    if (now - this.pendingSince < SETTLE_MS) return null;
    const previous = this.layouts[this.activeKey] ?? {};
    const remembered = this.layouts[key] ?? {};
    const restored: GeometryMap = {};
    // Only live windows participate; closed windows must never be reopened.
    for (const [label, geometry] of Object.entries(current)) {
      const saved = remembered[label]?.kind === geometry.kind ? remembered[label] : undefined;
      restored[label] = saved ?? fitMonitorButtonGeometry(previous[label] ?? geometry, workAreas);
    }
    this.activeKey = key;
    this.pendingKey = null;
    this.layouts[key] = structuredClone(restored);
    this.pendingRestores = new Set(Object.keys(restored));
    this.restoringUntil = now + SETTLE_MS;
    return restored;
  }
}

function readSavedLayouts(): SavedLayouts {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(SAVED_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).slice(-16).map(([key, entries]) => [key,
      Object.fromEntries(Object.entries(entries && typeof entries === "object" ? entries : {})
        .filter((entry): entry is [string, MonitorButtonGeometry] => validGeometry(entry[1])))
    ]));
  } catch { return {}; }
}

export function startMonitorButtonLayoutObserver(): () => void {
  const memory = new MonitorButtonLayoutMemory(readSavedLayouts());
  let stopped = false;
  let timer: number | undefined;
  let sequence = 0;
  const pending = new Map<string, { request: RestoreRequest; attempts: number; sentAt: number }>();
  const sample = async () => {
    try {
      const monitors = await availableMonitors();
      if (stopped || !monitors.length) return;
      const windows = await WebviewWindow.getAll();
      if (stopped) return;
      const current: GeometryMap = {};
      for (const target of windows) {
        try {
          const geometry: unknown = JSON.parse(window.localStorage.getItem(LIVE_PREFIX + target.label) ?? "null");
          if (validGeometry(geometry)) current[target.label] = geometry;
        } catch { /* A newly created window has not published its frame yet. */ }
      }
      for (const [label, restore] of pending) {
        if (!windows.some((target) => target.label === label) ||
            window.localStorage.getItem(ACK_PREFIX + label) === restore.request.requestId) {
          memory.acknowledge(label);
          pending.delete(label);
        }
      }
      const now = Date.now();
      const topologyKey = monitorTopologyKey(monitors);
      const restored = memory.sample(topologyKey, current, monitors.map((monitor) => ({
        Left: monitor.workArea.position.x, Top: monitor.workArea.position.y,
        Width: monitor.workArea.size.width, Height: monitor.workArea.size.height
      })), now);
      if (stopped) return;
      if (restored) {
        pending.clear();
        for (const [label, geometry] of Object.entries(restored)) {
          pending.set(label, { request: { requestId: `${now}:${++sequence}`, topologyKey, geometry }, attempts: 0, sentAt: 0 });
        }
      }
      await Promise.all([...pending].map(async ([label, restore]) => {
        if (restore.attempts >= 3 || now - restore.sentAt < SETTLE_MS) return;
        restore.attempts += 1;
        restore.sentAt = now;
        await emitTo(label, RESTORE_EVENT, restore.request).catch((error) => {
          console.error(`Could not restore monitor placement for ${label}`, error);
        });
      }));
      const serialized = JSON.stringify(Object.fromEntries(Object.entries(memory.layouts).slice(-16)));
      if (window.localStorage.getItem(SAVED_KEY) !== serialized) window.localStorage.setItem(SAVED_KEY, serialized);
    } catch (error) {
      console.error("Could not remember Button monitor placements", error);
    } finally {
      if (!stopped) timer = window.setTimeout(() => void sample(), SAMPLE_MS);
    }
  };
  void sample();
  return () => { stopped = true; if (timer !== undefined) window.clearTimeout(timer); };
}
