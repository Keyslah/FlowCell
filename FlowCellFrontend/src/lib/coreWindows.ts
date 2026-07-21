import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
  type Window as TauriWindow
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  BINDS_PREFILL_EVENT,
  BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION,
  buildWindowContextUrl,
  type BindsButtonPrefill,
  type FlowCellWindowContext,
  type InstalledPageWindowContext
} from "./windowContext";
import {
  registerScopedWindowTopmost,
  refreshScopedWindowTopmost
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
}

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

async function centeredPlacement(width: number, height: number): Promise<{
  x?: number;
  y?: number;
  width: number;
  height: number;
}> {
  const current = getCurrentWindow();
  const scale = await current.scaleFactor().catch(() => 1);
  const [position, size] = await Promise.all([
    current.outerPosition().catch(() => null),
    current.innerSize().catch(() => null)
  ]);
  if (!position || !size) return { width, height };
  const left = position.x / scale;
  const top = position.y / scale;
  return {
    width,
    height,
    x: left + Math.max((size.width / scale - width) / 2, 24),
    y: top + Math.max((size.height / scale - height) / 2, 24)
  };
}

async function applyPlacement(
  target: TauriWindow,
  placement: { x?: number; y?: number; width: number; height: number }
): Promise<void> {
  if (typeof placement.x === "number" && typeof placement.y === "number") {
    await target.setPosition(new LogicalPosition(placement.x, placement.y));
  }
  await target.setSize(new LogicalSize(placement.width, placement.height));
}

async function showAndFocus(target: TauriWindow): Promise<void> {
  if (await target.isMinimized().catch(() => false)) await target.unminimize();
  await target.show();
  await target.setFocus();
}

async function openCoreWindow(options: CoreWindowOptions): Promise<void> {
  const previous = pendingOpens.get(options.label);
  const open = (async () => {
    if (previous) {
      await previous.catch(() => {});
    }
    const placement = await centeredPlacement(options.width, options.height);
    let existing = await WebviewWindow.getByLabel(options.label);
    if (existing && options.recreate) {
      await existing.close();
      existing = null;
    }
    if (existing) {
      await existing.setDecorations(options.decorations ?? false).catch(() => {});
      await applyPlacement(existing, placement);
      await showAndFocus(existing);
      return;
    }
    const target = new WebviewWindow(options.label, {
      url: buildWindowContextUrl(options.context),
      title: options.title,
      width: options.width,
      height: options.height,
      x: placement.x,
      y: placement.y,
      minWidth: options.minimumWidth,
      minHeight: options.minimumHeight,
      resizable: true,
      decorations: options.decorations ?? false,
      transparent: false,
      shadow: true,
      visible: false,
      focus: true,
      alwaysOnTop: false,
      skipTaskbar: options.skipTaskbar ?? false
    });
    await waitForCreated(target);
    await applyPlacement(target, placement);
    if (options.programName) {
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

function installedPageWindowLabel(ownerButtonId: string): string {
  const safeOwner = ownerButtonId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "page";
  return `flowcell-installed-page-${safeOwner}`;
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
}): Promise<void> {
  const context: InstalledPageWindowContext = {
    kind: "installed-page",
    schemaVersion: BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION,
    ownerButtonId: args.ownerButtonId,
    programName: args.programName,
    panelName: args.panelName,
    fileName: args.fileName,
    pageId: args.pageId
  };
  await openCoreWindow({
    label: installedPageWindowLabel(args.ownerButtonId),
    context,
    title: `FlowCell - ${args.title}`,
    width: args.width,
    height: args.height,
    minimumWidth: args.minWidth,
    minimumHeight: args.minHeight,
    decorations: true,
    programName: args.programName
  });
}

export async function closeInstalledPageWindow(ownerButtonId: string): Promise<void> {
  const label = installedPageWindowLabel(ownerButtonId);
  await pendingOpens.get(label)?.catch(() => {});
  const existing = await WebviewWindow.getByLabel(label);
  if (!existing) return;
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
