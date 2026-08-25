import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
  type Window as TauriWindow
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  BINDS_PREFILL_EVENT,
  BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION,
  THEME_EDITOR_CONTEXT_EVENT,
  buildWindowContextUrl,
  type BindsButtonPrefill,
  type FlowCellWindowContext,
  type InstalledPageWindowContext
} from "./windowContext";
import type { FlowCellBounds } from "../types";
import {
  registerLayoutWindow,
  unregisterLayoutWindow,
  writeRegisteredLayoutWindowSnapshotBounds
} from "./layoutSnapshots";
import {
  registerScopedWindowTopmost,
  refreshScopedWindowTopmost,
  unregisterScopedWindowTopmost
} from "./tauri";

const pendingOpens = new Map<string, Promise<void>>();

interface CoreWindowOptions {
  label: string;
  context: FlowCellWindowContext;
  title: string;
  width: number;
  height: number;
  minimumWidth?: number;
  minimumHeight?: number;
  decorations?: boolean;
  skipTaskbar?: boolean;
  recreate?: boolean;
  programName?: string;
  alwaysOnTop?: boolean;
  savedBounds?: FlowCellBounds;
}

type CoreWindowPlacement = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  unit: "logical" | "physical";
};

async function waitForCreated(windowHandle: WebviewWindow): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    void windowHandle.once("tauri://created", () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    });
    void windowHandle.once("tauri://error", (event) => {
      if (!settled) {
        settled = true;
        reject(event.payload);
      }
    });
  });
}

async function centeredPlacement(width: number, height: number): Promise<CoreWindowPlacement> {
  const current = getCurrentWindow();
  const scale = await current.scaleFactor().catch(() => 1);
  const [position, size] = await Promise.all([
    current.outerPosition().catch(() => null),
    current.innerSize().catch(() => null)
  ]);
  if (!position || !size) return { width, height, unit: "logical" };
  const left = position.x / scale;
  const top = position.y / scale;
  return {
    width,
    height,
    unit: "logical",
    x: left + Math.max((size.width / scale - width) / 2, 24),
    y: top + Math.max((size.height / scale - height) / 2, 24)
  };
}

async function applyPlacement(
  target: TauriWindow,
  placement: CoreWindowPlacement
): Promise<void> {
  if (typeof placement.x === "number" && typeof placement.y === "number") {
    await target.setPosition(
      placement.unit === "physical"
        ? new PhysicalPosition(placement.x, placement.y)
        : new LogicalPosition(placement.x, placement.y)
    );
  }
  await target.setSize(
    placement.unit === "physical"
      ? new PhysicalSize(placement.width, placement.height)
      : new LogicalSize(placement.width, placement.height)
  );
}

async function showAndFocus(target: TauriWindow): Promise<void> {
  if (await target.isMinimized().catch(() => false)) await target.unminimize();
  await target.show();
  await target.setFocus();
}

async function readCoreWindowBounds(target: TauriWindow): Promise<FlowCellBounds | null> {
  if (await target.isMinimized().catch(() => false)) {
    return null;
  }
  const [position, size] = await Promise.all([
    target.outerPosition().catch(() => null),
    target.innerSize().catch(() => null)
  ]);
  if (!position || !size) {
    return null;
  }
  return {
    Left: position.x,
    Top: position.y,
    Width: size.width,
    Height: size.height
  };
}

async function openCoreWindow(options: CoreWindowOptions): Promise<void> {
  const previous = pendingOpens.get(options.label);
  const open = (async () => {
    if (previous) {
      await previous.catch(() => {});
    }
    const placement: CoreWindowPlacement = options.savedBounds
      ? {
          x: options.savedBounds.Left,
          y: options.savedBounds.Top,
          width: options.savedBounds.Width,
          height: options.savedBounds.Height,
          unit: "physical"
        }
      : await centeredPlacement(options.width, options.height);
    let existing = await WebviewWindow.getByLabel(options.label);
    if (existing && options.recreate) {
      await existing.close();
      existing = null;
    }
    if (existing) {
      if (options.alwaysOnTop) {
        await unregisterScopedWindowTopmost(options.label);
        await existing.setAlwaysOnTop(true);
      } else {
        await existing.setAlwaysOnTop(false).catch(() => {});
        if (options.programName) {
          await registerScopedWindowTopmost(options.label, options.programName).catch(() => {});
          await refreshScopedWindowTopmost(options.label).catch(() => {});
        }
      }
      await existing.setDecorations(options.decorations ?? false).catch(() => {});
      await applyPlacement(existing, placement);
      await showAndFocus(existing);
      return;
    }
    const target = new WebviewWindow(options.label, {
      url: buildWindowContextUrl(options.context),
      title: options.title,
      width: placement.unit === "logical" ? placement.width : options.width,
      height: placement.unit === "logical" ? placement.height : options.height,
      x: placement.unit === "logical" ? placement.x : undefined,
      y: placement.unit === "logical" ? placement.y : undefined,
      minWidth: options.minimumWidth,
      minHeight: options.minimumHeight,
      resizable: true,
      decorations: options.decorations ?? false,
      transparent: false,
      shadow: true,
      visible: false,
      focus: true,
      alwaysOnTop: options.alwaysOnTop ?? false,
      skipTaskbar: options.skipTaskbar ?? false
    });
    await waitForCreated(target);
    await applyPlacement(target, placement);
    if (options.programName && !options.alwaysOnTop) {
      await registerScopedWindowTopmost(options.label, options.programName).catch(() => {});
      await refreshScopedWindowTopmost(options.label).catch(() => {});
    }
    await showAndFocus(target);
  })().finally(() => {
    if (pendingOpens.get(options.label) === open) pendingOpens.delete(options.label);
  });
  pendingOpens.set(options.label, open);
  return open;
}

export async function openBindsWindow(prefill?: BindsButtonPrefill): Promise<void> {
  const label = "flowcell-binds";
  await openCoreWindow({
    label,
    context: prefill ? { kind: "binds", prefill } : { kind: "binds" },
    title: "FlowCell - Binds",
    width: 1280,
    height: 860,
    decorations: true
  });
  if (prefill) await emit(BINDS_PREFILL_EVENT, prefill).catch(() => {});
}

export async function openThemeEditorWindow(args: {
  target?: string;
  page?: string;
} = {}): Promise<void> {
  const context = {
    kind: "theme-editor" as const,
    target: args.target?.trim() || undefined,
    page: args.page?.trim() || undefined
  };
  await openCoreWindow({
    label: "flowcell-theme-editor",
    context,
    title: "FlowCell - Theme Editor",
    width: 1240,
    height: 900,
    minimumWidth: 820,
    minimumHeight: 620,
    decorations: true,
    recreate: false
  });
  await emit(THEME_EDITOR_CONTEXT_EVENT, context).catch(() => {});
}

export async function openMacroLabWindow(args: {
  programName: string;
  panelName: string;
  macroId?: string | null;
  attachToPanel?: boolean;
}): Promise<void> {
  await openCoreWindow({
    label: "flowcell-macro-lab",
    context: {
      kind: "macro-lab",
      programName: args.programName,
      panelName: args.panelName,
      macroId: args.macroId?.trim() || undefined,
      attachToPanel: args.attachToPanel === true
    },
    title: "FlowCell - Macro Lab",
    width: 1320,
    height: 900,
    decorations: true,
    recreate: true
  });
}

export const openAddProgramWindow = () => openCoreWindow({
  label: "flowcell-add-program",
  context: { kind: "add-program" },
  title: "FlowCell - Add Program",
  width: 1120,
  height: 820,
  minimumWidth: 820,
  minimumHeight: 620,
  decorations: true
});

export const openAddPanelWindow = (programName: string) => openCoreWindow({
  label: "flowcell-add-panel",
  context: { kind: "add-panel", programName },
  title: `FlowCell - Add Panel to ${programName}`,
  width: 760,
  height: 620,
  minimumWidth: 620,
  minimumHeight: 480,
  decorations: true,
  recreate: true
});

function hashInstalledPageOwnerId(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function installedPageWindowLabel(ownerButtonId: string): string {
  const normalizedOwner = ownerButtonId.trim();
  const safeOwner = normalizedOwner
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "page";
  return `flowcell-installed-page-${safeOwner}-${hashInstalledPageOwnerId(normalizedOwner)}`;
}

export async function openInstalledPageWindow(args: {
  ownerButtonId: string;
  programName: string;
  panelName: string;
  fileName: string;
  pageId: string;
  title: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  alwaysOnTop: boolean;
  bounds?: FlowCellBounds;
}): Promise<void> {
  const windowLabel = installedPageWindowLabel(args.ownerButtonId);
  const context: InstalledPageWindowContext = {
    kind: "installed-page",
    schemaVersion: BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION,
    ownerButtonId: args.ownerButtonId,
    programName: args.programName,
    panelName: args.panelName,
    fileName: args.fileName,
    pageId: args.pageId,
    alwaysOnTop: args.alwaysOnTop
  };
  registerLayoutWindow({
    windowLabel,
    kind: "installed-page",
    programName: args.programName,
    panelName: args.panelName,
    buttonOwnerId: args.ownerButtonId,
    installedPageFileName: args.fileName,
    installedPageId: args.pageId,
    snapshotBounds: args.bounds
  });
  try {
    await openCoreWindow({
      label: windowLabel,
      context,
      title: `FlowCell - ${args.title}`,
      width: args.width,
      height: args.height,
      minimumWidth: args.minWidth,
      minimumHeight: args.minHeight,
      decorations: true,
      programName: args.programName,
      alwaysOnTop: args.alwaysOnTop,
      savedBounds: args.bounds
    });
    const target = await WebviewWindow.getByLabel(windowLabel);
    if (target) {
      writeRegisteredLayoutWindowSnapshotBounds(
        windowLabel,
        await readCoreWindowBounds(target)
      );
      await target.once("tauri://destroyed", () => {
        unregisterLayoutWindow(windowLabel);
      });
    }
  } catch (error) {
    unregisterLayoutWindow(windowLabel);
    throw error;
  }
}

export interface InstalledPageOpenDescriptor {
  window: {
    title: string;
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
    alwaysOnTop: boolean;
  };
}

export async function resolveInstalledPageOpenDescriptor(args: {
  ownerButtonId: string;
  programName: string;
  panelName: string;
  fileName: string;
  pageId: string;
}): Promise<InstalledPageOpenDescriptor> {
  return invoke<InstalledPageOpenDescriptor>("resolve_installed_page", args);
}

export async function resolveAndOpenInstalledPageWindow(args: {
  ownerButtonId: string;
  programName: string;
  panelName: string;
  fileName: string;
  pageId: string;
  bounds?: FlowCellBounds;
}): Promise<void> {
  const descriptor = await resolveInstalledPageOpenDescriptor({
    ownerButtonId: args.ownerButtonId,
    programName: args.programName,
    panelName: args.panelName,
    fileName: args.fileName,
    pageId: args.pageId
  });
  await openInstalledPageWindow({
    ...args,
    title: descriptor.window.title,
    width: descriptor.window.width,
    height: descriptor.window.height,
    minWidth: descriptor.window.minWidth,
    minHeight: descriptor.window.minHeight,
    alwaysOnTop: descriptor.window.alwaysOnTop
  });
}

export async function closeInstalledPageWindow(ownerButtonId: string): Promise<void> {
  const label = installedPageWindowLabel(ownerButtonId);
  await pendingOpens.get(label)?.catch(() => {});
  const existing = await WebviewWindow.getByLabel(label);
  if (!existing) {
    unregisterLayoutWindow(label);
    return;
  }
  let acknowledgeDestroyed: (() => void) | null = null;
  const destroyed = new Promise<void>((resolve) => {
    acknowledgeDestroyed = resolve;
  });
  const unlistenDestroyed = await existing.once("tauri://destroyed", () => {
    acknowledgeDestroyed?.();
  });
  try {
    await existing.close();
    await destroyed;
  } finally {
    unlistenDestroyed();
    unregisterLayoutWindow(label);
  }
}

export const openWindowGridWindow = () => openCoreWindow({
  label: "flowcell-window-grid",
  context: { kind: "window-grid" },
  title: "FlowCell - Windows",
  width: 760,
  height: 540,
  minimumWidth: 360,
  minimumHeight: 280,
  skipTaskbar: true
});

export const openMotionSettingsWindow = () => openCoreWindow({
  label: "flowcell-motion-settings",
  context: { kind: "motion-settings" },
  title: "FlowCell - Motion Settings",
  width: 560,
  height: 640,
  minimumWidth: 420,
  minimumHeight: 420
});

export async function reloadCurrentHostWindow(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await invoke("refresh_frontend_host");
  } catch (error) {
    console.error("Failed to refresh the FlowCell frontend host.", error);
    window.location.reload();
  }
}
