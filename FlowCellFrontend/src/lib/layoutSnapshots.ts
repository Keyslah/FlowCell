import type { FlowCellBounds, LayoutSnapshotWindowKind } from "../types.js";
import { isUsableButtonWindowBounds } from "../button/windows/buttonWindowGeometry.js";

const MANAGED_LAYOUT_WINDOWS_STORAGE_KEY = "flowcell.button-layout-windows.v2";
const LAST_MAIN_PAGE_LAYOUT_DIRECTORY_STORAGE_KEY =
  "flowcell.main-page-layout-directory.v1";

export interface RegisteredLayoutWindow {
  windowLabel: string;
  kind: LayoutSnapshotWindowKind;
  programName?: string;
  panelName?: string;
  buttonPopoutUnitId?: string;
  buttonFanSetupId?: string;
  buttonOwnerId?: string;
  panelOwnerButtonId?: string;
  buttonDisplayMode?: "collapsed" | "expanded";
  buttonPopoutSettingsPath?: string;
  buttonPopoutChoiceId?: string;
  installedPageFileName?: string;
  installedPageId?: string;
  snapshotBounds?: FlowCellBounds;
}

function normalizeBounds(bounds: FlowCellBounds | null | undefined): FlowCellBounds | undefined {
  if (!isUsableButtonWindowBounds(bounds)) {
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

function readRegisteredLayoutWindowMap(): Record<string, RegisteredLayoutWindow> {
  if (!canUseStorage()) {
    return {};
  }

  const rawValue = window.localStorage.getItem(MANAGED_LAYOUT_WINDOWS_STORAGE_KEY);
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as Record<string, RegisteredLayoutWindow>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, entry]) =>
          entry?.kind === "button-editor" ||
          entry?.kind === "button-popout" ||
          entry?.kind === "button-fan" ||
          entry?.kind === "installed-page"
        )
        .map(([windowLabel, entry]) => [
          windowLabel,
          {
            ...entry,
            snapshotBounds: normalizeBounds(entry.snapshotBounds)
          }
        ])
    );
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
    buttonPopoutUnitId: entry.buttonPopoutUnitId?.trim() || undefined,
    buttonFanSetupId: entry.buttonFanSetupId?.trim() || undefined,
    buttonOwnerId: entry.buttonOwnerId?.trim() || undefined,
    panelOwnerButtonId: entry.panelOwnerButtonId?.trim() || undefined,
    buttonDisplayMode:
      entry.buttonDisplayMode === "collapsed" || entry.buttonDisplayMode === "expanded"
        ? entry.buttonDisplayMode
        : previousEntry?.buttonDisplayMode,
    buttonPopoutSettingsPath: entry.buttonPopoutSettingsPath?.trim() || undefined,
    buttonPopoutChoiceId: entry.buttonPopoutChoiceId?.trim() || undefined,
    installedPageFileName: entry.installedPageFileName?.trim() || undefined,
    installedPageId: entry.installedPageId?.trim() || undefined,
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
  buttonPopoutUnitId?: string;
  buttonFanSetupId?: string;
  buttonOwnerId?: string;
  panelOwnerButtonId?: string;
  buttonPopoutSettingsPath?: string;
  buttonPopoutChoiceId?: string;
  installedPageFileName?: string;
  installedPageId?: string;
}): RegisteredLayoutWindow | null {
  const entries = Object.values(readRegisteredLayoutWindowMap());
  return (
    entries.find((entry) => {
      return (
        entry.kind === args.kind &&
        (entry.programName ?? "") === (args.programName ?? "") &&
        (entry.panelName ?? "") === (args.panelName ?? "") &&
        (entry.buttonPopoutUnitId ?? "") === (args.buttonPopoutUnitId ?? "") &&
        (entry.buttonFanSetupId ?? "") === (args.buttonFanSetupId ?? "") &&
        (entry.buttonOwnerId ?? "") === (args.buttonOwnerId ?? "") &&
        (entry.panelOwnerButtonId ?? "") === (args.panelOwnerButtonId ?? "") &&
        (entry.buttonPopoutSettingsPath ?? "") === (args.buttonPopoutSettingsPath ?? "") &&
        (entry.buttonPopoutChoiceId ?? "") === (args.buttonPopoutChoiceId ?? "") &&
        (entry.installedPageFileName ?? "") === (args.installedPageFileName ?? "") &&
        (entry.installedPageId ?? "") === (args.installedPageId ?? "")
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

export function writeRegisteredLayoutWindowButtonDisplayMode(
  windowLabel: string,
  displayMode: "collapsed" | "expanded"
): void {
  if (!windowLabel.trim()) {
    return;
  }
  const nextValue = readRegisteredLayoutWindowMap();
  const existing = nextValue[windowLabel];
  if (!existing) {
    return;
  }
  nextValue[windowLabel] = {
    ...existing,
    buttonDisplayMode: displayMode
  };
  writeRegisteredLayoutWindowMap(nextValue);
}

export function readLastMainPageLayoutDirectory(): string | null {
  if (!canUseStorage()) {
    return null;
  }

  const rawValue = window.localStorage
    .getItem(LAST_MAIN_PAGE_LAYOUT_DIRECTORY_STORAGE_KEY)
    ?.trim();
  return rawValue ? rawValue : null;
}

export function writeLastMainPageLayoutDirectory(
  directory: string | null | undefined
): void {
  if (!canUseStorage()) {
    return;
  }

  const normalized = directory?.trim();
  if (!normalized) {
    window.localStorage.removeItem(LAST_MAIN_PAGE_LAYOUT_DIRECTORY_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(LAST_MAIN_PAGE_LAYOUT_DIRECTORY_STORAGE_KEY, normalized);
}
