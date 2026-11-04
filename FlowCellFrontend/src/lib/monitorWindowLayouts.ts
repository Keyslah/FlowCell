import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
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
export interface MonitorLayoutTransition {
  schemaVersion: 1;
  id: string;
  phase: "switching" | "complete" | "failed";
  updatedAtMs: number;
  expectedDisplays: { left: number; top: number; width: number; height: number }[];
}
export interface MonitorLayoutStatus {
  namespace: string;
  processId: number;
  busy: boolean;
  transition: MonitorLayoutTransition | null;
}
interface RestoreRequest { requestId: string; topologyKey: string; transitionId: string | null; geometry: MonitorButtonGeometry }
const receivedRestores = new Map<string, Promise<void>>();
let latestRestore: RestoreRequest | undefined;
let identityPromise: Promise<Pick<MonitorLayoutStatus, "namespace" | "processId">> | undefined;

export function monitorLayoutStorageKeys(identity: Pick<MonitorLayoutStatus, "namespace" | "processId">) {
  return {
    saved: `${SAVED_KEY}:${identity.namespace}`,
    live: `${LIVE_PREFIX}${identity.namespace}:${identity.processId}:`,
    ack: `${ACK_PREFIX}${identity.namespace}:${identity.processId}:`
  };
}

async function readMonitorLayoutStatus(): Promise<MonitorLayoutStatus> {
  const status = await invoke<MonitorLayoutStatus>("get_monitor_layout_transition");
  if (!status || typeof status.namespace !== "string" || !status.namespace ||
      !Number.isSafeInteger(status.processId) || status.processId <= 0 || typeof status.busy !== "boolean") {
    throw new Error("Invalid monitor layout runtime identity.");
  }
  identityPromise ??= Promise.resolve({ namespace: status.namespace, processId: status.processId });
  return status;
}

function runtimeIdentity(): Promise<Pick<MonitorLayoutStatus, "namespace" | "processId">> {
  if (!identityPromise) {
    identityPromise = readMonitorLayoutStatus().catch((error) => { identityPromise = undefined; throw error; });
  }
  return identityPromise;
}

export function monitorDisplaysMatch(
  monitors: readonly Pick<Monitor, "position" | "size">[],
  expected: MonitorLayoutTransition["expectedDisplays"]
): boolean {
  const key = (rects: number[][]) => JSON.stringify([...new Set(rects.map((rect) => JSON.stringify(rect)))].sort());
  return expected.length > 0 && key(monitors.map((monitor) => [
    monitor.position.x, monitor.position.y, monitor.size.width, monitor.size.height
  ])) === key(expected.map((rect) => [rect.left, rect.top, rect.width, rect.height]));
}

function restoreStatusAllows(status: MonitorLayoutStatus, request: RestoreRequest, monitors: readonly Monitor[]): boolean {
  const transition = status.transition;
  return !status.busy && (!transition || transition.phase === "complete") &&
    (transition?.id ?? null) === request.transitionId &&
    monitorTopologyKey(monitors) === request.topologyKey;
}

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
  const label = getCurrentWindow().label;
  const serialized = JSON.stringify(geometry);
  void runtimeIdentity().then((identity) => {
    const key = monitorLayoutStorageKeys(identity).live + label;
    if (window.localStorage.getItem(key) !== serialized) window.localStorage.setItem(key, serialized);
  }).catch((error) => console.error("Could not publish Button monitor placement", error));
}

export function listenForMonitorButtonGeometry(
  handler: (geometry: MonitorButtonGeometry, isCurrent: () => Promise<boolean>) => Promise<void>
): Promise<() => void> {
  return listen<RestoreRequest>(RESTORE_EVENT, ({ payload }) => {
    if (typeof payload?.requestId !== "string" || typeof payload.topologyKey !== "string" ||
        !(payload.transitionId === null || typeof payload.transitionId === "string") || !validGeometry(payload.geometry)) return;
    if (receivedRestores.has(payload.requestId)) return;
    const work = (async () => {
      const monitors = await availableMonitors();
      const status = await readMonitorLayoutStatus();
      if (!restoreStatusAllows(status, payload, monitors)) {
        receivedRestores.delete(payload.requestId);
        return;
      }
      const order = (request: RestoreRequest) => request.requestId.split(":").map(Number);
      const [time, sequence] = order(payload);
      const [latestTime, latestSequence] = latestRestore ? order(latestRestore) : [-1, -1];
      if (time < latestTime || (time === latestTime && sequence < latestSequence)) return;
      latestRestore = payload;
      const isCurrent = async () => {
        if (latestRestore?.requestId !== payload.requestId) return false;
        const currentMonitors = await availableMonitors();
        const currentStatus = await readMonitorLayoutStatus();
        return latestRestore?.requestId === payload.requestId &&
          restoreStatusAllows(currentStatus, payload, currentMonitors);
      };
      await handler(payload.geometry, isCurrent);
      if (!await isCurrent()) {
        receivedRestores.delete(payload.requestId);
        return;
      }
      window.localStorage.setItem(monitorLayoutStorageKeys(status).ack + getCurrentWindow().label, payload.requestId);
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
  private statusInitialized = false;
  private handledTransitionId: string | null = null;
  private outgoing: GeometryMap | null = null;
  restorationBlocked = false;

  constructor(readonly layouts: SavedLayouts = {}) {}

  acknowledge(label: string): void { this.pendingRestores.delete(label); }

  private beginTransition(): void {
    this.outgoing ??= structuredClone(this.activeKey ? this.layouts[this.activeKey] ?? {} : {});
  }

  private stable(key: string, now: number): boolean {
    if (key !== this.pendingKey) {
      this.pendingKey = key;
      this.pendingSince = now;
      return false;
    }
    return now - this.pendingSince >= SETTLE_MS;
  }

  private restore(key: string, current: GeometryMap, workAreas: readonly FlowCellBounds[], now: number): GeometryMap {
    const previous = this.outgoing ?? (this.activeKey ? this.layouts[this.activeKey] ?? {} : {});
    const remembered = this.layouts[key] ?? {};
    const restored: GeometryMap = {};
    // Only live windows participate; closed windows must never be reopened.
    for (const [label, geometry] of Object.entries(current)) {
      const saved = remembered[label]?.kind === geometry.kind ? remembered[label] : undefined;
      restored[label] = saved ?? fitMonitorButtonGeometry(previous[label] ?? geometry, workAreas);
    }
    this.activeKey = key;
    this.pendingKey = null;
    this.layouts[key] = { ...remembered, ...structuredClone(restored) };
    this.pendingRestores = new Set(Object.keys(restored));
    this.restoringUntil = now + SETTLE_MS;
    this.outgoing = null;
    this.restorationBlocked = false;
    return restored;
  }

  sample(
    key: string, current: GeometryMap, workAreas: readonly FlowCellBounds[], now: number,
    status?: MonitorLayoutStatus,
    monitors: readonly Pick<Monitor, "position" | "size">[] = []
  ): GeometryMap | null {
    if (status) {
      const transition = status.transition;
      if (!this.statusInitialized) {
        this.statusInitialized = true;
        // An idle completed marker predates this observer. Later manual monitor
        // changes must not remain constrained to that old target indefinitely.
        if (!status.busy && transition?.phase === "complete") this.handledTransitionId = transition.id;
      }
      if (!monitors.length) {
        this.beginTransition();
        this.restorationBlocked = true;
        this.pendingKey = null;
        return null;
      }
      const unhandled = transition && transition.id !== this.handledTransitionId;
      if (status.busy || (unhandled && transition.phase !== "complete")) {
        this.beginTransition();
        this.restorationBlocked = true;
        this.pendingKey = null;
        return null;
      }
      if (unhandled) {
        this.beginTransition();
        this.restorationBlocked = true;
        if (!monitorDisplaysMatch(monitors, transition.expectedDisplays)) {
          this.pendingKey = null;
          return null;
        }
        if (!this.stable(key, now)) return null;
        this.handledTransitionId = transition.id;
        return this.restore(key, current, workAreas, now);
      }
      if (this.outgoing) {
        // A mutex-only operation may not publish a transition. Keep its original
        // source snapshot until its resulting topology is stable as well.
        this.restorationBlocked = true;
        if (!this.stable(key, now)) return null;
        return this.restore(key, current, workAreas, now);
      }
    }
    this.restorationBlocked = false;
    if (!this.activeKey) {
      this.activeKey = key;
      this.layouts[key] = { ...this.layouts[key], ...structuredClone(current) };
      return null;
    }
    if (key === this.activeKey) {
      this.pendingKey = null;
      if (now >= this.restoringUntil) {
        const next = { ...this.layouts[key], ...structuredClone(current) };
        for (const label of this.pendingRestores) {
          if (this.layouts[key]?.[label]) next[label] = this.layouts[key][label];
        }
        this.layouts[key] = next;
      }
      return null;
    }
    if (!this.stable(key, now)) return null;
    return this.restore(key, current, workAreas, now);
  }
}

export function readSavedLayouts(savedKey: string): SavedLayouts {
  try {
    // Copy the legacy cache on first use; never rewrite or remove its shared key.
    const value: unknown = JSON.parse(window.localStorage.getItem(savedKey) ?? window.localStorage.getItem(SAVED_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).slice(-16).map(([key, entries]) => [key,
      Object.fromEntries(Object.entries(entries && typeof entries === "object" ? entries : {})
        .filter((entry): entry is [string, MonitorButtonGeometry] => validGeometry(entry[1])))
    ]));
  } catch { return {}; }
}

export function startMonitorButtonLayoutObserver(): () => void {
  let memory: MonitorButtonLayoutMemory | undefined;
  let stopped = false;
  let timer: number | undefined;
  let sequence = 0;
  const pending = new Map<string, { request: RestoreRequest; attempts: number; sentAt: number }>();
  const sample = async () => {
    try {
      const [monitors, windows] = await Promise.all([availableMonitors(), WebviewWindow.getAll()]);
      if (stopped) return;
      // Read transition status after the asynchronous window/monitor enumeration
      // so a toggle starting during those queries freezes this sample as well.
      const status = await readMonitorLayoutStatus();
      if (stopped) return;
      const keys = monitorLayoutStorageKeys(status);
      memory ??= new MonitorButtonLayoutMemory(readSavedLayouts(keys.saved));
      const current: GeometryMap = {};
      for (const target of windows) {
        try {
          const geometry: unknown = JSON.parse(window.localStorage.getItem(keys.live + target.label) ?? "null");
          if (validGeometry(geometry)) current[target.label] = geometry;
        } catch { /* A newly created window has not published its frame yet. */ }
      }
      for (const [label, restore] of pending) {
        if (!windows.some((target) => target.label === label) ||
            window.localStorage.getItem(keys.ack + label) === restore.request.requestId) {
          memory.acknowledge(label);
          pending.delete(label);
        }
      }
      const now = Date.now();
      const topologyKey = monitorTopologyKey(monitors);
      const restored = memory.sample(topologyKey, current, monitors.map((monitor) => ({
        Left: monitor.workArea.position.x, Top: monitor.workArea.position.y,
        Width: monitor.workArea.size.width, Height: monitor.workArea.size.height
      })), now, status, monitors);
      if (stopped) return;
      if (restored) {
        pending.clear();
        for (const [label, geometry] of Object.entries(restored)) {
          pending.set(label, { request: { requestId: `${now}:${++sequence}`, topologyKey,
            transitionId: status.transition?.id ?? null, geometry }, attempts: 0, sentAt: 0 });
        }
      }
      if (!memory.restorationBlocked) await Promise.all([...pending].map(async ([label, restore]) => {
        if (restore.attempts >= 3 || now - restore.sentAt < SETTLE_MS) return;
        restore.attempts += 1;
        restore.sentAt = now;
        await emitTo(label, RESTORE_EVENT, restore.request).catch((error) => {
          console.error(`Could not restore monitor placement for ${label}`, error);
        });
      }));
      const serialized = JSON.stringify(Object.fromEntries(Object.entries(memory.layouts).slice(-16)));
      if (window.localStorage.getItem(keys.saved) !== serialized) window.localStorage.setItem(keys.saved, serialized);
    } catch (error) {
      console.error("Could not remember Button monitor placements", error);
    } finally {
      if (!stopped) timer = window.setTimeout(() => void sample(), SAMPLE_MS);
    }
  };
  void sample();
  return () => { stopped = true; if (timer !== undefined) window.clearTimeout(timer); };
}
