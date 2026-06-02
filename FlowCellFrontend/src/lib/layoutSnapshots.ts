import type { FlowCellBounds, LayoutSnapshotWindowKind } from "../types";

const MANAGED_LAYOUT_WINDOWS_STORAGE_KEY = "flowcell.layout-windows.v1";
const LAST_LAYOUT_DIRECTORY_STORAGE_KEY = "flowcell.last-layout-directory.v1";
const LEGACY_STORAGE_PREFIX = ["flow", "test", "-bare", "clone"].join("");
const LEGACY_MANAGED_LAYOUT_WINDOWS_STORAGE_KEY =
  `${LEGACY_STORAGE_PREFIX}.layout-windows.v1`;
const LEGACY_LAST_LAYOUT_DIRECTORY_STORAGE_KEY =
  `${LEGACY_STORAGE_PREFIX}.last-layout-directory.v1`;

export interface RegisteredLayoutWindow {
  windowLabel: string;
  kind: LayoutSnapshotWindowKind;
  programName?: string;
  panelName?: string;
  fileName?: string;
  label?: string;
  selectedFileNames?: string[];
  snapshotBounds?: FlowCellBounds;
}

function normalizeBounds(bounds: FlowCellBounds | null | undefined): FlowCellBounds | undefined {
  if (
    !bounds ||
    !Number.isFinite(bounds.Left) ||
    !Number.isFinite(bounds.Top) ||
    !Number.isFinite(bounds.Width) ||
    !Number.isFinite(bounds.Height) ||
    bounds.Width <= 0 ||
    bounds.Height <= 0
  ) {
    return undefined;
  }

  return {
    Left: Number(bounds.Left.toFixed(3)),
    Top: Number(bounds.Top.toFixed(3)),
    Width: Number(bounds.Width.toFixed(3)),
    Height: Number(bounds.Height.toFixed(3))
  };
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readMigratedStorageValue(storageKey: string, legacyStorageKey: string): string | null {
  const currentValue = window.localStorage.getItem(storageKey);
  if (currentValue) {
    return currentValue;
  }

  const legacyValue = window.localStorage.getItem(legacyStorageKey);
  if (legacyValue) {
    window.localStorage.setItem(storageKey, legacyValue);
    window.localStorage.removeItem(legacyStorageKey);
  }
  return legacyValue;
}

function readRegisteredLayoutWindowMap(): Record<string, RegisteredLayoutWindow> {
  if (!canUseStorage()) {
    return {};
  }

  const rawValue = readMigratedStorageValue(
    MANAGED_LAYOUT_WINDOWS_STORAGE_KEY,
    LEGACY_MANAGED_LAYOUT_WINDOWS_STORAGE_KEY
  );
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as Record<string, RegisteredLayoutWindow>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function writeRegisteredLayoutWindowMap(
  nextValue: Record<string, RegisteredLayoutWindow>
): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(
    MANAGED_LAYOUT_WINDOWS_STORAGE_KEY,
    JSON.stringify(nextValue)
  );
  window.localStorage.removeItem(LEGACY_MANAGED_LAYOUT_WINDOWS_STORAGE_KEY);
}

export function registerLayoutWindow(entry: RegisteredLayoutWindow): void {
  if (!entry.windowLabel.trim()) {
    return;
  }

  const nextValue = readRegisteredLayoutWindowMap();
  const previousEntry = nextValue[entry.windowLabel];
  nextValue[entry.windowLabel] = {
    windowLabel: entry.windowLabel,
    kind: entry.kind,
    programName: entry.programName?.trim() || undefined,
    panelName: entry.panelName?.trim() || undefined,
    fileName: entry.fileName?.trim() || undefined,
    label: entry.label?.trim() || undefined,
    selectedFileNames:
      entry.selectedFileNames
        ?.map((value) => value.trim())
        .filter((value) => value.length > 0) ?? undefined,
    snapshotBounds:
      normalizeBounds(entry.snapshotBounds) ?? normalizeBounds(previousEntry?.snapshotBounds)
  };
  writeRegisteredLayoutWindowMap(nextValue);
}

export function unregisterLayoutWindow(windowLabel: string): void {
  if (!windowLabel.trim()) {
    return;
  }

  const nextValue = readRegisteredLayoutWindowMap();
  if (!(windowLabel in nextValue)) {
    return;
  }

  delete nextValue[windowLabel];
  writeRegisteredLayoutWindowMap(nextValue);
}

export function readRegisteredLayoutWindow(
  windowLabel: string
): RegisteredLayoutWindow | null {
  if (!windowLabel.trim()) {
    return null;
  }

  return readRegisteredLayoutWindowMap()[windowLabel] ?? null;
}

export function findRegisteredLayoutWindow(args: {
  kind: LayoutSnapshotWindowKind;
  programName?: string;
  panelName?: string;
  fileName?: string;
}): RegisteredLayoutWindow | null {
  const entries = Object.values(readRegisteredLayoutWindowMap());
  return (
    entries.find((entry) => {
      return (
        entry.kind === args.kind &&
        (entry.programName ?? "") === (args.programName ?? "") &&
        (entry.panelName ?? "") === (args.panelName ?? "") &&
        (entry.fileName ?? "") === (args.fileName ?? "")
      );
    }) ?? null
  );
}

export function writeRegisteredLayoutWindowSnapshotBounds(
  windowLabel: string,
  bounds: FlowCellBounds | null | undefined
): void {
  if (!windowLabel.trim()) {
    return;
  }

  const nextValue = readRegisteredLayoutWindowMap();
  const existing = nextValue[windowLabel];
  if (!existing) {
    return;
  }

  const normalizedBounds = normalizeBounds(bounds);
  if (!normalizedBounds) {
    return;
  }

  nextValue[windowLabel] = {
    ...existing,
    snapshotBounds: normalizedBounds
  };
  writeRegisteredLayoutWindowMap(nextValue);
}

export function readLastLayoutDirectory(): string | null {
  if (!canUseStorage()) {
    return null;
  }

  const rawValue = readMigratedStorageValue(
    LAST_LAYOUT_DIRECTORY_STORAGE_KEY,
    LEGACY_LAST_LAYOUT_DIRECTORY_STORAGE_KEY
  )?.trim();
  return rawValue ? rawValue : null;
}

export function writeLastLayoutDirectory(directory: string | null | undefined): void {
  if (!canUseStorage()) {
    return;
  }

  const normalized = directory?.trim();
  if (!normalized) {
    window.localStorage.removeItem(LAST_LAYOUT_DIRECTORY_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_LAST_LAYOUT_DIRECTORY_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(LAST_LAYOUT_DIRECTORY_STORAGE_KEY, normalized);
  window.localStorage.removeItem(LEGACY_LAST_LAYOUT_DIRECTORY_STORAGE_KEY);
}
