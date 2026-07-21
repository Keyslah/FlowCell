import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
  monitorFromPoint,
  PhysicalPosition,
  PhysicalSize,
  Window as TauriWindow
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { FlowCellBounds } from "../../types";
import {
  registerLayoutWindow,
  unregisterLayoutWindow
} from "../../lib/layoutSnapshots";
import {
  registerScopedWindowTopmost,
  refreshScopedWindowTopmost,
  setHostWindowTopmost,
  unregisterScopedWindowTopmost
} from "../../lib/tauri";
import {
  buildWindowContextUrl,
  BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION,
  type ButtonEditorWindowContext,
  type ButtonFanWindowContext,
  type ButtonPopoutWindowContext
} from "../../lib/windowContext";
import {
  isUsableButtonWindowBounds,
  resolveButtonWebviewPixelRatio,
  resolveFixedButtonCanvasBounds,
  resolveTargetButtonWebviewPixelRatio
} from "./buttonWindowGeometry";
import { afterPendingWindowOpens } from "./pendingWindowOpen";

export const BUTTON_EDITOR_WINDOW_LABEL = "flowcell-button-editor";
export const BUTTON_WINDOW_CONTEXT_UPDATE_EVENT = "flowcell:button-window-context";

const DEFAULT_EDITOR_WIDTH = 1240;
const DEFAULT_EDITOR_HEIGHT = 860;
const DEFAULT_POPOUT_WIDTH = 560;
const DEFAULT_POPOUT_HEIGHT = 360;
const DEFAULT_FAN_WIDTH = 132;
const DEFAULT_FAN_HEIGHT = 56;

export type ManagedButtonWindowContext =
  | ButtonEditorWindowContext
  | ButtonPopoutWindowContext
  | ButtonFanWindowContext;

type ButtonWindowContextUpdate = {
  windowLabel: string;
  context: ManagedButtonWindowContext;
};

type WindowPlacement = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  unit: "logical" | "physical";
};

export interface AppliedButtonCanvas {
  bounds: FlowCellBounds;
  scaleFactor: number;
}

const pendingButtonWindowOpens = new Map<string, Promise<void>>();
const pendingButtonWindowToggles = new Map<string, Promise<void>>();

function isUsableBounds(bounds: FlowCellBounds | null | undefined): bounds is FlowCellBounds {
  return isUsableButtonWindowBounds(bounds);
}

async function readWindowBounds(target: TauriWindow): Promise<FlowCellBounds | null> {
  const [position, size] = await Promise.all([
    target.outerPosition().catch(() => null),
    target.innerSize().catch(() => null)
  ]);
  if (!position || !size) return null;
  return {
    Left: position.x,
    Top: position.y,
    Width: size.width,
    Height: size.height
  };
}

function hashStableId(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function stableWindowToken(stableId: string): string {
  const normalized = stableId.trim();
  if (!normalized) {
    throw new Error("A stable Button ID is required to own a managed window.");
  }

  const readable = normalized
    .replace(/[^a-zA-Z0-9\-/:_]/g, "_")
    .slice(0, 72) || "button";
  return `${readable}-${hashStableId(normalized)}`;
}

export function buildButtonPopoutWindowLabel(args: {
  popoutUnitId: string;
  ownerButtonId?: string;
}): string {
  return `button-popout-${stableWindowToken(args.ownerButtonId ?? args.popoutUnitId)}`;
}

export function buildButtonFanWindowLabel(panelOwnerButtonId: string): string {
  return `button-fan-${stableWindowToken(panelOwnerButtonId)}`;
}

function placementPosition(
  placement: WindowPlacement
): LogicalPosition | PhysicalPosition {
  const x = placement.x ?? 0;
  const y = placement.y ?? 0;
  return placement.unit === "physical"
    ? new PhysicalPosition(x, y)
    : new LogicalPosition(x, y);
}

function placementSize(placement: WindowPlacement): LogicalSize | PhysicalSize {
  return placement.unit === "physical"
    ? new PhysicalSize(placement.width, placement.height)
    : new LogicalSize(placement.width, placement.height);
}

// Windows may rescale a window while it crosses to a monitor with another DPI.
// Put it on its final monitor first, then apply the authoritative size.
async function applyWindowPlacement(
  target: TauriWindow,
  placement: WindowPlacement
): Promise<void> {
  if (typeof placement.x === "number" && typeof placement.y === "number") {
    await target.setPosition(placementPosition(placement));
  }
  await target.setSize(placementSize(placement));
}

async function resolveDefaultPlacement(
  width: number,
  height: number
): Promise<WindowPlacement> {
  const currentWindow = getCurrentWindow();
  const scaleFactor = await currentWindow.scaleFactor().catch(() => 1);
  const [position, size] = await Promise.all([
    currentWindow.outerPosition().catch(() => null),
    currentWindow.innerSize().catch(() => null)
  ]);

  if (!position || !size) {
    return { width, height, unit: "logical" };
  }

  const left = position.x / scaleFactor;
  const top = position.y / scaleFactor;
  const hostWidth = size.width / scaleFactor;
  const hostHeight = size.height / scaleFactor;
  return {
    width,
    height,
    x: left + Math.max((hostWidth - width) / 2, 24),
    y: top + Math.max((hostHeight - height) / 2, 24),
    unit: "logical"
  };
}

async function resolveDefaultContentBounds(
  width: number,
  height: number
): Promise<FlowCellBounds> {
  const currentWindow = getCurrentWindow();
  const scaleFactor = await currentWindow.scaleFactor().catch(() => 1);
  const [position, size] = await Promise.all([
    currentWindow.outerPosition().catch(() => null),
    currentWindow.innerSize().catch(() => null)
  ]);
  const normalizedScale = Number.isFinite(scaleFactor) && scaleFactor > 0
    ? scaleFactor
    : 1;
  const physicalWidth = Math.max(1, Math.round(width * normalizedScale));
  const physicalHeight = Math.max(1, Math.round(height * normalizedScale));

  if (!position || !size) {
    return {
      Left: 0,
      Top: 0,
      Width: physicalWidth,
      Height: physicalHeight
    };
  }

  return {
    Left: position.x + Math.max((size.width - physicalWidth) / 2, 24 * normalizedScale),
    Top: position.y + Math.max((size.height - physicalHeight) / 2, 24 * normalizedScale),
    Width: physicalWidth,
    Height: physicalHeight
  };
}

async function resolveButtonContentBounds(
  width: number,
  height: number,
  bounds?: FlowCellBounds | null
): Promise<FlowCellBounds> {
  if (isUsableBounds(bounds)) {
    return { ...bounds };
  }
  return resolveDefaultContentBounds(width, height);
}

async function resolveButtonCanvasPlacement(
  contentBounds: FlowCellBounds
): Promise<{ placement: WindowPlacement; scaleFactor: number }> {
  const centerX = contentBounds.Left + contentBounds.Width / 2;
  const centerY = contentBounds.Top + contentBounds.Height / 2;
  const [monitor, currentNativeScaleFactor] = await Promise.all([
    monitorFromPoint(centerX, centerY)
      .catch(() => null)
      .then((resolved) => resolved ?? currentMonitor().catch(() => null)),
    getCurrentWindow().scaleFactor().catch(() => 1)
  ]);

  if (!monitor) {
    return {
      placement: {
        width: contentBounds.Width,
        height: contentBounds.Height,
        x: contentBounds.Left,
        y: contentBounds.Top,
        unit: "physical"
      },
      scaleFactor: resolveButtonWebviewPixelRatio(
        currentNativeScaleFactor,
        window.devicePixelRatio
      )
    };
  }

  const canvasBounds = resolveFixedButtonCanvasBounds(contentBounds, {
    Left: monitor.workArea.position.x,
    Top: monitor.workArea.position.y,
    Width: monitor.workArea.size.width,
    Height: monitor.workArea.size.height
  });
  return {
    placement: {
      width: canvasBounds.Width,
      height: canvasBounds.Height,
      x: canvasBounds.Left,
      y: canvasBounds.Top,
      unit: "physical"
    },
    scaleFactor: resolveTargetButtonWebviewPixelRatio(
      currentNativeScaleFactor,
      window.devicePixelRatio,
      monitor.scaleFactor
    )
  };
}

async function resolvePlacement(
  width: number,
  height: number,
  bounds?: FlowCellBounds | null
): Promise<WindowPlacement> {
  if (isUsableBounds(bounds)) {
    return {
      width: bounds.Width,
      height: bounds.Height,
      x: bounds.Left,
      y: bounds.Top,
      unit: "physical"
    };
  }
  return resolveDefaultPlacement(width, height);
}

async function waitForWindowCreated(target: WebviewWindow): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    void target.once("tauri://created", () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    });
    void target.once("tauri://error", (event) => {
      if (!settled) {
        settled = true;
        reject(event.payload);
      }
    });
  });
}

async function applyButtonWindowChrome(
  target: TauriWindow,
  transparent: boolean
): Promise<void> {
  await target.setDecorations(false);
  await target.setShadow(false);
  await target.setResizable(!transparent);
  await target.setMinSize(null);
  await target.setMaxSize(null);
  await target.setAlwaysOnTop(false);

  if (transparent) {
    const backgroundTarget = target as TauriWindow & {
      setBackgroundColor?: (color: [number, number, number, number]) => Promise<void>;
    };
    await backgroundTarget.setBackgroundColor?.([0, 0, 0, 0]);
    await target.setIgnoreCursorEvents(true);
  }
}

async function showWindow(target: TauriWindow, focus: boolean): Promise<void> {
  if (await target.isMinimized().catch(() => false)) {
    await target.unminimize();
  }
  await target.show();
  if (focus) {
    await target.setFocus();
  }
}

async function applyProgramScopedTopmost(
  windowLabel: string,
  programName: string
): Promise<void> {
  await registerScopedWindowTopmost(
    windowLabel,
    programName,
    true
  );
  await refreshScopedWindowTopmost(windowLabel).catch(async () => {
    await setHostWindowTopmost(windowLabel, false).catch(() => {});
  });
}

async function emitContextUpdate(
  windowLabel: string,
  context: ManagedButtonWindowContext
): Promise<void> {
  await emit(BUTTON_WINDOW_CONTEXT_UPDATE_EVENT, {
    windowLabel,
    context
  } satisfies ButtonWindowContextUpdate);
}

async function bindDestroyedCleanup(
  target: WebviewWindow,
  windowLabel: string
): Promise<void> {
  await target.once("tauri://destroyed", () => {
    unregisterLayoutWindow(windowLabel);
    void unregisterScopedWindowTopmost(windowLabel).catch(() => {});
    void setHostWindowTopmost(windowLabel, false).catch(() => {});
  });
}

async function closeManagedButtonWindow(windowLabel: string): Promise<void> {
  const target = await afterPendingWindowOpens(
    pendingButtonWindowOpens,
    windowLabel,
    () => WebviewWindow.getByLabel(windowLabel)
  );
  unregisterLayoutWindow(windowLabel);
  await unregisterScopedWindowTopmost(windowLabel).catch(() => {});
  await setHostWindowTopmost(windowLabel, false).catch(() => {});
  if (!target) return;
  const destroyed = new Promise<void>((resolve) => {
    void target.once("tauri://destroyed", () => resolve()).catch(() => resolve());
  });
  await target.close().catch((error) => {
    if (!String(error).toLocaleLowerCase("en").includes("window not found")) throw error;
  });
  await Promise.race([
    destroyed,
    new Promise<void>((resolve) => window.setTimeout(resolve, 750))
  ]);
}

async function cleanupFailedNewButtonWindow(
  target: WebviewWindow,
  windowLabel: string
): Promise<void> {
  unregisterLayoutWindow(windowLabel);
  await unregisterScopedWindowTopmost(windowLabel).catch(() => {});
  await setHostWindowTopmost(windowLabel, false).catch(() => {});
  await target.close().catch(() => {});
}

export function listenForButtonWindowContextUpdates(
  windowLabel: string,
  handler: (context: ManagedButtonWindowContext) => void | Promise<void>
): Promise<UnlistenFn> {
  return listen<ButtonWindowContextUpdate>(
    BUTTON_WINDOW_CONTEXT_UPDATE_EVENT,
    (event) => {
      if (event.payload?.windowLabel !== windowLabel) {
        return;
      }
      const context = event.payload.context;
      if (
        context?.kind !== "button-editor" &&
        context?.kind !== "button-popout" &&
        context?.kind !== "button-fan"
      ) {
        return;
      }
      return handler(context);
    }
  );
}

export async function applyCurrentButtonWindowPhysicalBounds(
  bounds: FlowCellBounds
): Promise<void> {
  if (!isUsableBounds(bounds)) {
    throw new Error("Button window bounds must be finite positive physical pixels.");
  }
  await applyWindowPlacement(getCurrentWindow(), {
    width: bounds.Width,
    height: bounds.Height,
    x: bounds.Left,
    y: bounds.Top,
    unit: "physical"
  });
}

export async function applyCurrentButtonCanvasForContentBounds(
  bounds: FlowCellBounds
): Promise<AppliedButtonCanvas> {
  if (!isUsableBounds(bounds)) {
    throw new Error("Button content bounds must be finite positive physical pixels.");
  }
  const resolved = await resolveButtonCanvasPlacement(bounds);
  const placement = resolved.placement;
  await applyWindowPlacement(getCurrentWindow(), placement);
  return {
    bounds: {
      Left: placement.x ?? 0,
      Top: placement.y ?? 0,
      Width: placement.width,
      Height: placement.height
    },
    scaleFactor: resolved.scaleFactor
  };
}

export async function setCurrentButtonWindowLogicalSize(
  width: number,
  height: number
): Promise<void> {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Button window size must be finite and positive.");
  }
  await getCurrentWindow().setSize(new LogicalSize(width, height));
}

export async function openButtonEditorWindow(args: {
  programName?: string;
  panelName?: string;
  lockImportDestination?: boolean;
  buttonId?: string;
  surfaceId?: string;
  draftSessionId?: string;
  bounds?: FlowCellBounds | null;
} = {}): Promise<void> {
  const windowLabel = BUTTON_EDITOR_WINDOW_LABEL;
  const pendingOpen = pendingButtonWindowOpens.get(windowLabel);
  if (pendingOpen) {
    await pendingOpen;
    return openButtonEditorWindow(args);
  }

  const openPromise = (async () => {
    const context: ButtonEditorWindowContext = {
      kind: "button-editor",
      schemaVersion: BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION,
      programName: args.programName,
      panelName: args.panelName,
      lockImportDestination: args.lockImportDestination,
      buttonId: args.buttonId,
      surfaceId: args.surfaceId,
      draftSessionId: args.draftSessionId
    };
    const placement = await resolvePlacement(
      DEFAULT_EDITOR_WIDTH,
      DEFAULT_EDITOR_HEIGHT,
      args.bounds
    );
    let target = await WebviewWindow.getByLabel(windowLabel);
    const existed = Boolean(target);
    if (!target) {
      target = new WebviewWindow(windowLabel, {
        url: buildWindowContextUrl(context),
        title: "FlowCell - Buttons Editor",
        width: DEFAULT_EDITOR_WIDTH,
        height: DEFAULT_EDITOR_HEIGHT,
        resizable: true,
        decorations: false,
        transparent: false,
        shadow: false,
        visible: false,
        focus: true,
        alwaysOnTop: false
      });
      await waitForWindowCreated(target);
      await bindDestroyedCleanup(target, windowLabel);
    }

    await applyButtonWindowChrome(target, false);
    const [visible, currentBounds] = await Promise.all([
      target.isVisible().catch(() => false),
      existed ? readWindowBounds(target) : Promise.resolve(null)
    ]);
    if (args.bounds || !visible || (existed && !isUsableBounds(currentBounds))) {
      await applyWindowPlacement(target, placement);
    }
    registerLayoutWindow({
      windowLabel,
      kind: "button-editor",
      programName: args.programName,
      panelName: args.panelName,
      snapshotBounds: args.bounds ?? undefined
    });
    await showWindow(target, true);
    if (existed) {
      await emitContextUpdate(windowLabel, context);
    }
  })().finally(() => {
    if (pendingButtonWindowOpens.get(windowLabel) === openPromise) {
      pendingButtonWindowOpens.delete(windowLabel);
    }
  });

  pendingButtonWindowOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function closeButtonEditorWindow(): Promise<void> {
  await closeManagedButtonWindow(BUTTON_EDITOR_WINDOW_LABEL);
}

export async function openButtonPopoutWindow(args: {
  programName: string;
  panelName?: string;
  popoutUnitId: string;
  ownerButtonId?: string;
  displayMode?: "collapsed" | "expanded";
  draftSessionId?: string;
  bounds?: FlowCellBounds | null;
}): Promise<void> {
  const windowLabel = buildButtonPopoutWindowLabel(args);
  const pendingOpen = pendingButtonWindowOpens.get(windowLabel);
  if (pendingOpen) {
    await pendingOpen;
    return openButtonPopoutWindow(args);
  }

  const openPromise = (async () => {
    const contentBounds = await resolveButtonContentBounds(
      DEFAULT_POPOUT_WIDTH,
      DEFAULT_POPOUT_HEIGHT,
      args.bounds
    );
    const context: ButtonPopoutWindowContext = {
      kind: "button-popout",
      schemaVersion: BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION,
      programName: args.programName,
      panelName: args.panelName,
      popoutUnitId: args.popoutUnitId,
      ownerButtonId: args.ownerButtonId,
      initialDisplayMode: args.displayMode ?? "expanded",
      draftSessionId: args.draftSessionId,
      initialBounds: contentBounds,
      restoreBounds: args.bounds ?? undefined
    };
    const placement = (await resolveButtonCanvasPlacement(contentBounds)).placement;
    registerLayoutWindow({
      windowLabel,
      kind: "button-popout",
      programName: args.programName,
      panelName: args.panelName,
      buttonPopoutUnitId: args.popoutUnitId,
      buttonOwnerId: args.ownerButtonId,
      buttonDisplayMode: context.initialDisplayMode,
      snapshotBounds: contentBounds
    });
    let target = await WebviewWindow.getByLabel(windowLabel);
    const existed = Boolean(target);
    let shown = false;
    try {
      if (!target) {
        target = new WebviewWindow(windowLabel, {
          url: buildWindowContextUrl(context),
          title: "FlowCell - Button Popout",
          width: DEFAULT_POPOUT_WIDTH,
          height: DEFAULT_POPOUT_HEIGHT,
          resizable: true,
          decorations: false,
          transparent: true,
          shadow: false,
          visible: false,
          focus: false,
          alwaysOnTop: false
        });
        await waitForWindowCreated(target);
        await bindDestroyedCleanup(target, windowLabel);
      }

      await applyButtonWindowChrome(target, true);
      await applyProgramScopedTopmost(windowLabel, args.programName);
      await applyWindowPlacement(target, placement);
      await showWindow(target, false);
      shown = true;
      if (existed) {
        await emitContextUpdate(windowLabel, context);
      }
    } catch (error) {
      if (!existed && !shown && target) {
        await cleanupFailedNewButtonWindow(target, windowLabel);
      }
      throw error;
    }
  })().finally(() => {
    if (pendingButtonWindowOpens.get(windowLabel) === openPromise) {
      pendingButtonWindowOpens.delete(windowLabel);
    }
  });

  pendingButtonWindowOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function closeButtonPopoutWindow(args: {
  popoutUnitId: string;
  ownerButtonId?: string;
}): Promise<void> {
  await closeManagedButtonWindow(buildButtonPopoutWindowLabel(args));
}

export async function toggleButtonPopoutWindow(args: {
  programName: string;
  panelName?: string;
  popoutUnitId: string;
  ownerButtonId?: string;
  displayMode?: "collapsed" | "expanded";
  draftSessionId?: string;
  bounds?: FlowCellBounds | null;
}): Promise<void> {
  const windowLabel = buildButtonPopoutWindowLabel(args);
  const pendingToggle = pendingButtonWindowToggles.get(windowLabel);
  if (pendingToggle) {
    await pendingToggle;
    return toggleButtonPopoutWindow(args);
  }

  const togglePromise = (async () => {
    const pendingOpen = pendingButtonWindowOpens.get(windowLabel);
    if (pendingOpen) {
      await pendingOpen;
    }
    const target = await WebviewWindow.getByLabel(windowLabel);
    if (target && (await target.isVisible().catch(() => false))) {
      await closeManagedButtonWindow(windowLabel);
      return;
    }
    await openButtonPopoutWindow(args);
  })().finally(() => {
    if (pendingButtonWindowToggles.get(windowLabel) === togglePromise) {
      pendingButtonWindowToggles.delete(windowLabel);
    }
  });

  pendingButtonWindowToggles.set(windowLabel, togglePromise);
  return togglePromise;
}

export async function openButtonFanWindow(args: {
  programName: string;
  panelName: string;
  fanSetupId: string;
  panelOwnerButtonId: string;
  draftSessionId?: string;
  collapsedBounds?: FlowCellBounds | null;
}): Promise<void> {
  const windowLabel = buildButtonFanWindowLabel(args.panelOwnerButtonId);
  const pendingOpen = pendingButtonWindowOpens.get(windowLabel);
  if (pendingOpen) {
    await pendingOpen;
    return openButtonFanWindow(args);
  }

  const openPromise = (async () => {
    const contentBounds = await resolveButtonContentBounds(
      DEFAULT_FAN_WIDTH,
      DEFAULT_FAN_HEIGHT,
      args.collapsedBounds
    );
    const context: ButtonFanWindowContext = {
      kind: "button-fan",
      schemaVersion: BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION,
      programName: args.programName,
      panelName: args.panelName,
      fanSetupId: args.fanSetupId,
      panelOwnerButtonId: args.panelOwnerButtonId,
      draftSessionId: args.draftSessionId,
      initialBounds: contentBounds,
      restoreBounds: args.collapsedBounds ?? undefined
    };
    const placement = (await resolveButtonCanvasPlacement(contentBounds)).placement;
    registerLayoutWindow({
      windowLabel,
      kind: "button-fan",
      programName: args.programName,
      panelName: args.panelName,
      buttonFanSetupId: args.fanSetupId,
      buttonOwnerId: args.panelOwnerButtonId,
      snapshotBounds: contentBounds
    });
    let target = await WebviewWindow.getByLabel(windowLabel);
    const existed = Boolean(target);
    let shown = false;
    try {
      if (!target) {
        target = new WebviewWindow(windowLabel, {
          url: buildWindowContextUrl(context),
          title: "FlowCell - Button Fan",
          width: DEFAULT_FAN_WIDTH,
          height: DEFAULT_FAN_HEIGHT,
          resizable: true,
          decorations: false,
          transparent: true,
          shadow: false,
          visible: false,
          focus: false,
          alwaysOnTop: false
        });
        await waitForWindowCreated(target);
        await bindDestroyedCleanup(target, windowLabel);
      }

      await applyButtonWindowChrome(target, true);
      await applyProgramScopedTopmost(windowLabel, args.programName);
      await applyWindowPlacement(target, placement);
      await showWindow(target, false);
      shown = true;
      if (existed) {
        await emitContextUpdate(windowLabel, context);
      }
    } catch (error) {
      if (!existed && !shown && target) {
        await cleanupFailedNewButtonWindow(target, windowLabel);
      }
      throw error;
    }
  })().finally(() => {
    if (pendingButtonWindowOpens.get(windowLabel) === openPromise) {
      pendingButtonWindowOpens.delete(windowLabel);
    }
  });

  pendingButtonWindowOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function closeButtonFanWindow(panelOwnerButtonId: string): Promise<void> {
  await closeManagedButtonWindow(buildButtonFanWindowLabel(panelOwnerButtonId));
}
