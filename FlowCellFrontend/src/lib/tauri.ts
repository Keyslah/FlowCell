import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  LogicalPosition,
  LogicalSize
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type {
  CommandEnvelope,
  CommandResult,
  FlowCellBounds,
  FlowCellState,
  LayoutSnapshot,
  LoadStateResponse,
  ManagedScriptInstallResult,
  SavedLayoutFile,
  ToolPopoutLayoutMode,
  WindowContext
} from "../types";

const FLOWCELL_STATE_SYNC_EVENT = "flowcell://state-saved";
const FLOWCELL_WINDOW_PLACEMENT_EVENT = "flowcell://window-placement";
const FLOWCELL_SESSION_POPOUT_BOUNDS_EVENT = "flowcell://session-popout-bounds";
const pendingToolPopoutOpens = new Map<string, Promise<void>>();

interface FlowCellWindowPlacementEventPayload {
  label?: string;
  suppressMs?: number;
}

export interface FlowCellSessionPopoutBoundsPayload {
  sourceWindowLabel?: string;
  kind: "panel-popout" | "tool-popout";
  programId: number;
  panelId: string;
  ownerButtonId?: string;
  bounds: FlowCellBounds;
}

interface SaveStateOptions {
  broadcast?: boolean;
}

export interface ForegroundProcessInfo {
  processName: string;
  processPath: string;
}

export interface SampledPhotoThemeColors {
  headersHex: string;
  textHex: string;
  sceneHex: string;
  controlsHex: string;
  miscHex: string;
  highlightsHex: string;
  paletteHexes?: string[];
}

function sanitizeWindowToken(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9\-/:_]/g, "_");
  return sanitized.length > 0 ? sanitized : "flowcell";
}

function buildWindowContextUrl(context: WindowContext): string {
  const encoded = encodeURIComponent(JSON.stringify(context));
  return `/?flowcellWindowContext=${encoded}`;
}

function buildPanelPopoutLabel(programId: number, panelId: string): string {
  return `popout-panel-${programId}-${sanitizeWindowToken(panelId)}`;
}

function buildPanelFanOptionsLabel(programId: number, panelId: string): string {
  return `panel-fan-options-${programId}-${sanitizeWindowToken(panelId)}`;
}

function buildButtonReorderLabel(programId: number, panelId: string): string {
  return `button-reorder-${programId}-${sanitizeWindowToken(panelId)}`;
}

function buildButtonOptionsLabel(programId: number, panelId: string): string {
  return `button-options-${programId}-${sanitizeWindowToken(panelId)}`;
}

function buildLayoutPickerLabel(): string {
  return "flowcell-layout-picker";
}

function isValidStoredBounds(
  bounds: FlowCellBounds | null | undefined,
  minWidth: number,
  minHeight: number
): bounds is FlowCellBounds {
  return Boolean(
    bounds &&
      Number.isFinite(bounds.Left) &&
      Number.isFinite(bounds.Top) &&
      Number.isFinite(bounds.Width) &&
      Number.isFinite(bounds.Height) &&
      bounds.Left > -20000 &&
      bounds.Top > -20000 &&
      bounds.Width >= minWidth &&
      bounds.Height >= minHeight
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeLogicalValue(value: number, scaleFactor: number): number {
  const safeScale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return Number((Math.round(value * safeScale) / safeScale).toFixed(3));
}

async function readLogicalWindowBounds(window: WebviewWindow): Promise<FlowCellBounds | null> {
  const scaleFactor = await window.scaleFactor().catch(() => 1);
  const [position, size] = await Promise.all([
    window.outerPosition().catch(() => null),
    window.innerSize().catch(() => null)
  ]);
  if (!position || !size) {
    return null;
  }

  return {
    Left: normalizeLogicalValue(position.x / scaleFactor, scaleFactor),
    Top: normalizeLogicalValue(position.y / scaleFactor, scaleFactor),
    Width: normalizeLogicalValue(size.width / scaleFactor, scaleFactor),
    Height: normalizeLogicalValue(size.height / scaleFactor, scaleFactor)
  };
}

function areWindowPlacementsClose(
  current: FlowCellBounds,
  target: { width: number; height: number; x?: number; y?: number },
  tolerance: number
): boolean {
  const sizeClose =
    Math.abs(current.Width - target.width) <= tolerance &&
    Math.abs(current.Height - target.height) <= tolerance;
  const positionClose =
    target.x === undefined ||
    target.y === undefined ||
    (Math.abs(current.Left - target.x) <= tolerance &&
      Math.abs(current.Top - target.y) <= tolerance);
  return sizeClose && positionClose;
}

function resolvePanelWindowOptions(buttonCount: number, bounds?: FlowCellBounds | null) {
  const normalizedCount = Math.max(buttonCount, 1);
  const columns = clamp(Math.ceil(Math.sqrt(normalizedCount)), 4, 6);
  const rows = Math.ceil(normalizedCount / columns);
  const defaults = {
    width: clamp(columns * 196 + 404, 980, 1620),
    height: clamp(rows * 134 + 260, 760, 1380),
    minWidth: 680,
    minHeight: 520
  };
  const storedMinWidth = 180;
  const storedMinHeight = 120;

  if (!isValidStoredBounds(bounds, storedMinWidth, storedMinHeight)) {
    return {
      width: defaults.width,
      height: defaults.height
    };
  }

  return {
    x: bounds.Left,
    y: bounds.Top,
    width: Math.max(bounds.Width, storedMinWidth),
    height: Math.max(bounds.Height, storedMinHeight)
  };
}

function resolvePanelFanOptionsWindowOptions() {
  return {
    width: 560,
    height: 680
  };
}

function resolveButtonReorderWindowOptions() {
  return {
    width: 680,
    height: 840
  };
}

function resolveButtonOptionsWindowOptions() {
  return {
    width: 1120,
    height: 900
  };
}

async function resolveLayoutPickerWindowOptions() {
  const defaults = {
    width: 520,
    height: 320
  };
  const currentWindow = getCurrentWindow();
  const scaleFactor = await currentWindow.scaleFactor().catch(() => 1);
  const [position, size] = await Promise.all([
    currentWindow.outerPosition().catch(() => null),
    currentWindow.innerSize().catch(() => null)
  ]);

  if (!position || !size) {
    return defaults;
  }

  const logicalLeft = position.x / scaleFactor;
  const logicalTop = position.y / scaleFactor;
  const logicalWidth = size.width / scaleFactor;

  return {
    ...defaults,
    x: logicalLeft + Math.max((logicalWidth - defaults.width) / 2, 24),
    y: logicalTop + 46
  };
}

function resolveToolWindowOptions(args: {
  ownerButtonId: string;
  buttonIds: string[];
  layoutMode: ToolPopoutLayoutMode;
  bounds?: FlowCellBounds | null;
}) {
  const ownerId = args.ownerButtonId.toLowerCase();
  const isPanelFan = args.layoutMode === "PanelFan";
  const isFloatingFanout = args.layoutMode === "Fanout";
  const isAlignment = ownerId.includes("alignment");
  const isFlattenRevolve = ownerId.includes("flatten") || ownerId.includes("revolve");
  const isHdriWorld =
    ownerId.includes("button_blender_flowcell_hdri") ||
    ownerId.includes("flowcell_hdri") ||
    ownerId.includes("hdri_world");
  const isSmartAxis =
    ownerId.includes("flowcell_base") ||
    args.buttonIds.some((buttonId) =>
      /button_blender_flowcell_(base|x|y|z|live)/.test(buttonId.toLowerCase())
    );
  const normalizedCount = Math.max(args.buttonIds.length, 1);
  const isDenseRegularGroup =
    !isPanelFan &&
    !isFloatingFanout &&
    !isAlignment &&
    !isFlattenRevolve &&
    !isSmartAxis &&
    args.layoutMode === "Group";
  const regularColumns = Math.min(Math.max(Math.ceil(Math.sqrt(normalizedCount)), 3), 6);
  const regularRows = Math.ceil(normalizedCount / regularColumns);
  const denseGroupColumns = Math.min(Math.max(Math.ceil(Math.sqrt(normalizedCount)), 3), 6);
  const denseGroupRows = Math.ceil(normalizedCount / denseGroupColumns);

  const defaults = isFloatingFanout
    ? {
        width: 124,
        height: 52,
        minWidth: 40,
        minHeight: 24,
        maxWidth: 640,
        maxHeight: 420
      }
    : isPanelFan
    ? {
        width: 72,
        height: 32,
        minWidth: 64,
        minHeight: 24,
        maxWidth: 760,
        maxHeight: 560
      }
    : isAlignment
    ? { width: 336, height: 166, minWidth: 320, minHeight: 150, maxWidth: 356, maxHeight: 196 }
      : isFlattenRevolve
      ? { width: 320, height: 220, minWidth: 270, minHeight: 180, maxWidth: 380, maxHeight: 280 }
      : isHdriWorld
        ? { width: 820, height: 620, minWidth: 700, minHeight: 620, maxWidth: 1080, maxHeight: 840 }
      : isSmartAxis
        ? { width: 292, height: 64, minWidth: 252, minHeight: 52, maxWidth: 340, maxHeight: 96 }
        : isDenseRegularGroup
          ? {
              width: clamp(80 + denseGroupColumns * 156, 620, 1380),
              height: clamp(120 + denseGroupRows * 116, 260, 1180),
              minWidth: 420,
              minHeight: 180,
              maxWidth: 2200,
              maxHeight: 1800
            }
        : args.layoutMode === "Individual"
          ? { width: 220, height: 108, minWidth: 160, minHeight: 72, maxWidth: 2200, maxHeight: 1800 }
          : {
              width: clamp(90 + regularColumns * 176, 620, 1420),
              height: clamp(120 + regularRows * 120, 260, 1180),
              minWidth: 320,
              minHeight: 160,
              maxWidth: 2200,
              maxHeight: 1800
            };
  const restoredBounds = isValidStoredBounds(args.bounds, 40, 24) ? args.bounds : null;

  if (isPanelFan) {
    if (restoredBounds) {
      return {
        x: restoredBounds.Left,
        y: restoredBounds.Top,
        width: clamp(restoredBounds.Width, 40, defaults.maxWidth),
        height: clamp(restoredBounds.Height, 24, defaults.maxHeight)
      };
    }
    return {
      width: defaults.width,
      height: defaults.height
    };
  }

  if (!restoredBounds) {
    return {
      width: defaults.width,
      height: defaults.height
    };
  }

  return {
    x: restoredBounds.Left,
    y: restoredBounds.Top,
    width: clamp(restoredBounds.Width, isHdriWorld ? defaults.minWidth : 40, defaults.maxWidth),
    height: clamp(
      restoredBounds.Height,
      isHdriWorld ? defaults.minHeight : 24,
      defaults.maxHeight
    )
  };
}

async function waitForWindowCreated(window: WebviewWindow): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;

    void window.once("tauri://created", () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    });

    void window.once("tauri://error", (event) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(event.payload);
    });
  });
}

async function applyWindowPlacement(
  window: WebviewWindow,
  placement: {
    width: number;
    height: number;
    x?: number;
    y?: number;
  },
  options?: {
    focus?: boolean;
    moveBeforeResize?: boolean;
  }
): Promise<void> {
  const isMinimized = await window.isMinimized().catch(() => false);
  if (isMinimized) {
    await window.unminimize().catch(() => {});
  }

  const scaleFactor = await window.scaleFactor().catch(() => 1);
  const normalizedPlacement = {
    width: normalizeLogicalValue(placement.width, scaleFactor),
    height: normalizeLogicalValue(placement.height, scaleFactor),
    x:
      Number.isFinite(placement.x) && placement.x !== undefined
        ? normalizeLogicalValue(placement.x, scaleFactor)
        : undefined,
    y:
      Number.isFinite(placement.y) && placement.y !== undefined
        ? normalizeLogicalValue(placement.y, scaleFactor)
        : undefined
  };

  const placementTolerance = Number((1 / Math.max(scaleFactor, 1) + 0.05).toFixed(3));
  const currentBounds = await readLogicalWindowBounds(window);
  if (
    currentBounds &&
    areWindowPlacementsClose(currentBounds, normalizedPlacement, placementTolerance)
  ) {
    await window.show().catch(() => {});
    if (options?.focus !== false) {
      await window.setFocus().catch(() => {});
    }
    return;
  }

  await emit(FLOWCELL_WINDOW_PLACEMENT_EVENT, {
    label: window.label,
    suppressMs: 900
  } satisfies FlowCellWindowPlacementEventPayload).catch(() => {});

  const hasTargetPosition =
    Number.isFinite(normalizedPlacement.x) && Number.isFinite(normalizedPlacement.y);
  if (options?.moveBeforeResize && hasTargetPosition) {
    await window.setPosition(new LogicalPosition(normalizedPlacement.x!, normalizedPlacement.y!));
  }

  await window.setSize(new LogicalSize(normalizedPlacement.width, normalizedPlacement.height));

  if (!options?.moveBeforeResize && hasTargetPosition) {
    await window.setPosition(new LogicalPosition(normalizedPlacement.x!, normalizedPlacement.y!));
  }

  await window.show().catch(() => {});
  if (options?.focus !== false) {
    await window.setFocus().catch(() => {});
  }
}

async function applyTransparentFanoutWindowChrome(window: WebviewWindow): Promise<void> {
  await window.setDecorations(false).catch(() => {});
  await window.setShadow(false).catch(() => {});
  await window.setIgnoreCursorEvents(false).catch(() => {});

  const backgroundTarget = window as WebviewWindow & {
    setBackgroundColor?: (color: [number, number, number, number]) => Promise<void>;
  };
  if (typeof backgroundTarget.setBackgroundColor === "function") {
    await backgroundTarget.setBackgroundColor([0, 0, 0, 0]).catch(() => {});
  }
}

export function loadState(): Promise<LoadStateResponse> {
  return invoke("load_state");
}

export function saveState(
  state: FlowCellState,
  options?: SaveStateOptions
): Promise<void> {
  return (async () => {
    await invoke("save_state", { nextState: state });
    if (options?.broadcast === false) {
      return;
    }
    await broadcastStateSync();
  })();
}

export function broadcastStateSync(sourceWindowLabel?: string): Promise<void> {
  return emit(FLOWCELL_STATE_SYNC_EVENT, {
    sourceWindowLabel: sourceWindowLabel ?? getCurrentWindow().label
  });
}

export function getWindowContext(): Promise<WindowContext> {
  return invoke("get_window_context");
}

export function getForegroundProcessInfo(): Promise<ForegroundProcessInfo> {
  return invoke("get_foreground_process_info");
}

export function setHostWindowTopmost(
  label: string,
  topmost: boolean,
  promote?: boolean
): Promise<void> {
  return invoke("set_host_window_topmost", { label, topmost, promote });
}

export function registerScopedWindowTopmost(
  label: string,
  programName: string,
  bindOwner?: boolean
): Promise<void> {
  return invoke("register_scoped_window_topmost", { label, programName, bindOwner });
}

export function refreshScopedWindowTopmost(label: string): Promise<void> {
  return invoke("refresh_scoped_window_topmost", { label });
}

export function unregisterScopedWindowTopmost(label: string): Promise<void> {
  return invoke("unregister_scoped_window_topmost", { label });
}

export function logFrontendEvent(
  surface: string,
  message: string
): Promise<void> {
  return invoke("log_frontend_event", { surface, message });
}

export function listenForStateSync(
  handler: (sourceWindowLabel?: string) => void | Promise<void>
) {
  return listen(FLOWCELL_STATE_SYNC_EVENT, (event) => {
    const payload =
      event.payload && typeof event.payload === "object"
        ? (event.payload as { sourceWindowLabel?: unknown })
        : undefined;
    return handler(
      typeof payload?.sourceWindowLabel === "string"
        ? payload.sourceWindowLabel
        : undefined
    );
  });
}

export function listenForProgrammaticWindowPlacement(
  handler: (payload: FlowCellWindowPlacementEventPayload) => void | Promise<void>
) {
  return listen(FLOWCELL_WINDOW_PLACEMENT_EVENT, (event) => {
    const payload =
      event.payload && typeof event.payload === "object"
        ? (event.payload as FlowCellWindowPlacementEventPayload)
        : {};
    return handler(payload);
  });
}

export function emitSessionPopoutBoundsUpdate(
  payload: Omit<FlowCellSessionPopoutBoundsPayload, "sourceWindowLabel"> & {
    sourceWindowLabel?: string;
  }
): Promise<void> {
  return emit(FLOWCELL_SESSION_POPOUT_BOUNDS_EVENT, {
    ...payload,
    sourceWindowLabel: payload.sourceWindowLabel ?? getCurrentWindow().label
  } satisfies FlowCellSessionPopoutBoundsPayload);
}

export function listenForSessionPopoutBoundsUpdate(
  handler: (payload: FlowCellSessionPopoutBoundsPayload) => void | Promise<void>
) {
  return listen(FLOWCELL_SESSION_POPOUT_BOUNDS_EVENT, (event) => {
    const payload =
      event.payload && typeof event.payload === "object"
        ? (event.payload as Partial<FlowCellSessionPopoutBoundsPayload>)
        : undefined;
    const bounds = payload?.bounds;
    if (
      (payload?.kind !== "panel-popout" && payload?.kind !== "tool-popout") ||
      typeof payload?.programId !== "number" ||
      typeof payload?.panelId !== "string" ||
      !bounds ||
      !Number.isFinite(bounds.Left) ||
      !Number.isFinite(bounds.Top) ||
      !Number.isFinite(bounds.Width) ||
      !Number.isFinite(bounds.Height)
    ) {
      return;
    }
    const normalizedPayload = payload as FlowCellSessionPopoutBoundsPayload;
    return handler({
      sourceWindowLabel:
        typeof normalizedPayload.sourceWindowLabel === "string"
          ? normalizedPayload.sourceWindowLabel
          : undefined,
      kind: normalizedPayload.kind,
      programId: normalizedPayload.programId,
      panelId: normalizedPayload.panelId,
      ownerButtonId:
        typeof normalizedPayload.ownerButtonId === "string"
          ? normalizedPayload.ownerButtonId
          : undefined,
      bounds
    });
  });
}

export function openPanelPopout(args: {
  programId: number;
  panelId: string;
  panelName: string;
  buttonCount: number;
  bounds?: FlowCellBounds | null;
}): Promise<void> {
  const label = buildPanelPopoutLabel(args.programId, args.panelId);
  return (async () => {
    const placement = resolvePanelWindowOptions(args.buttonCount, args.bounds);
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await applyWindowPlacement(existing, placement);
      return;
    }

    const window = new WebviewWindow(label, {
      url: buildWindowContextUrl({
        kind: "panel-popout",
        programId: args.programId,
        panelId: args.panelId,
        panelName: args.panelName
      }),
      title: `FlowCell - ${args.panelName}`,
      ...placement,
      resizable: true,
      decorations: false,
      transparent: false,
      visible: true,
      focus: true,
      alwaysOnTop: false,
      shadow: true
    });

    await waitForWindowCreated(window);
    await applyWindowPlacement(window, placement);
  })();
}

export function closePanelPopout(programId: number, panelId: string): Promise<void> {
  return (async () => {
    const label = buildPanelPopoutLabel(programId, panelId);
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.close();
    }
  })();
}

export function openPanelFanOptionsWindow(args: {
  programId: number;
  panelId: string;
  panelName: string;
}): Promise<void> {
  const label = buildPanelFanOptionsLabel(args.programId, args.panelId);
  return (async () => {
    const placement = resolvePanelFanOptionsWindowOptions();
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await applyWindowPlacement(existing, placement, { focus: true });
      await existing.show().catch(() => {});
      return;
    }

    const window = new WebviewWindow(label, {
      url: buildWindowContextUrl({
        kind: "panel-fan-options",
        programId: args.programId,
        panelId: args.panelId,
        panelName: args.panelName
      }),
      title: `FlowCell - Fan Options - ${args.panelName}`,
      ...placement,
      resizable: true,
      decorations: true,
      visible: true,
      focus: true,
      alwaysOnTop: false
    });

    await waitForWindowCreated(window);
    await applyWindowPlacement(window, placement);
  })();
}

export function openButtonReorderWindow(args: {
  programId: number;
  panelId: string;
  panelName: string;
}): Promise<void> {
  const label = buildButtonReorderLabel(args.programId, args.panelId);
  return (async () => {
    const placement = resolveButtonReorderWindowOptions();
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await applyWindowPlacement(existing, placement, { focus: true });
      await existing.show().catch(() => {});
      return;
    }

    const window = new WebviewWindow(label, {
      url: buildWindowContextUrl({
        kind: "button-reorder",
        programId: args.programId,
        panelId: args.panelId,
        panelName: args.panelName
      }),
      title: `FlowCell - Reorder Buttons - ${args.panelName}`,
      ...placement,
      resizable: true,
      decorations: false,
      visible: true,
      focus: true,
      alwaysOnTop: false
    });

    await waitForWindowCreated(window);
    await applyWindowPlacement(window, placement);
  })();
}

export function openButtonOptionsWindow(args: {
  programId: number;
  panelId: string;
  panelName: string;
  buttonIds: string[];
}): Promise<void> {
  const label = buildButtonOptionsLabel(args.programId, args.panelId);
  return (async () => {
    const placement = resolveButtonOptionsWindowOptions();
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.close().catch(() => {});
    }

    const window = new WebviewWindow(label, {
      url: buildWindowContextUrl({
        kind: "button-options",
        programId: args.programId,
        panelId: args.panelId,
        panelName: args.panelName,
        buttonIds: args.buttonIds
      }),
      title: `FlowCell - Button Options - ${args.panelName}`,
      ...placement,
      resizable: true,
      decorations: false,
      visible: true,
      focus: true,
      alwaysOnTop: false
    });

    await waitForWindowCreated(window);
    await applyWindowPlacement(window, placement);
  })();
}

export function openLayoutPickerWindow(): Promise<void> {
  const label = buildLayoutPickerLabel();
  return (async () => {
    const placement = await resolveLayoutPickerWindowOptions();
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await applyWindowPlacement(existing, placement, { focus: true });
      await existing.show().catch(() => {});
      return;
    }

    const window = new WebviewWindow(label, {
      url: buildWindowContextUrl({
        kind: "layout-picker"
      }),
      title: "FlowCell - Load Layout",
      ...placement,
      resizable: true,
      decorations: true,
      visible: true,
      focus: true,
      alwaysOnTop: false
    });

    await waitForWindowCreated(window);
    await applyWindowPlacement(window, placement);
  })();
}

export function closeToolPopout(
  programId: number,
  panelId: string,
  ownerButtonId: string
): Promise<void> {
  return (async () => {
    const label = `popout-tool-${programId}-${sanitizeWindowToken(panelId)}-${sanitizeWindowToken(ownerButtonId)}`;
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.close();
    }
  })();
}

export function openToolPopout(args: {
  programId: number;
  panelId: string;
  panelName: string;
  ownerButtonId: string;
  buttonIds: string[];
  layoutMode: ToolPopoutLayoutMode;
  buttonLabel: string;
  bounds?: FlowCellBounds | null;
}): Promise<void> {
  const label = `popout-tool-${args.programId}-${sanitizeWindowToken(args.panelId)}-${sanitizeWindowToken(args.ownerButtonId)}`;
  const pendingOpen = pendingToolPopoutOpens.get(label);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    const isPanelFan = args.layoutMode === "PanelFan";
    const isFloatingFanout = args.layoutMode === "Fanout";
    const isTransparentWindow = isPanelFan || isFloatingFanout;
    const placement = resolveToolWindowOptions(args);
    const placementOptions = {
      focus: !isTransparentWindow,
      moveBeforeResize: isTransparentWindow
    };
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      if (isTransparentWindow) {
        await applyTransparentFanoutWindowChrome(existing);
      }
      await applyWindowPlacement(existing, placement, placementOptions);
      return;
    }
    const window = new WebviewWindow(label, {
      url: buildWindowContextUrl({
        kind: "tool-popout",
        programId: args.programId,
        panelId: args.panelId,
        panelName: args.panelName,
        ownerButtonId: args.ownerButtonId,
        buttonIds: args.buttonIds,
        layoutMode: args.layoutMode,
        buttonLabel: args.buttonLabel
      }),
      title: `FlowCell - ${args.buttonLabel}`,
      ...placement,
      resizable: !isTransparentWindow,
      decorations: false,
      transparent: isTransparentWindow,
      shadow: !isTransparentWindow,
      visible: true,
      focus: !isTransparentWindow,
      alwaysOnTop: false
    });

    await waitForWindowCreated(window);
    if (isTransparentWindow) {
      await applyTransparentFanoutWindowChrome(window);
    }
    await applyWindowPlacement(window, placement, placementOptions);
  })().finally(() => {
    if (pendingToolPopoutOpens.get(label) === openPromise) {
      pendingToolPopoutOpens.delete(label);
    }
  });

  pendingToolPopoutOpens.set(label, openPromise);
  return openPromise;
}

export function emitBackendEnvelope(
  envelope: CommandEnvelope
): Promise<CommandResult> {
  return invoke("emit_command", { envelope });
}

export function showOpenFileDialog(args: {
  title: string;
  filter: string;
  initialDirectory?: string;
  multiselect?: boolean;
  parentLabel?: string;
}): Promise<string[]> {
  return invoke("show_open_file_dialog", {
    title: args.title,
    filter: args.filter,
    initialDirectory: args.initialDirectory,
    multiselect: args.multiselect ?? false,
    parentLabel: args.parentLabel ?? getCurrentWindow().label
  });
}

export function showOpenFolderDialog(args: {
  title: string;
  initialDirectory?: string;
  multiselect?: boolean;
  parentLabel?: string;
}): Promise<string[]> {
  return invoke("show_open_folder_dialog", {
    title: args.title,
    initialDirectory: args.initialDirectory,
    multiselect: args.multiselect ?? false,
    parentLabel: args.parentLabel ?? getCurrentWindow().label
  });
}

export function showSaveFileDialog(args: {
  title: string;
  filter: string;
  initialDirectory?: string;
  parentLabel?: string;
}): Promise<string | null> {
  return invoke("show_save_file_dialog", {
    title: args.title,
    filter: args.filter,
    initialDirectory: args.initialDirectory,
    parentLabel: args.parentLabel ?? getCurrentWindow().label
  });
}

export function showTextInputDialog(args: {
  title: string;
  prompt: string;
  defaultValue?: string;
}): Promise<string | null> {
  return invoke("show_text_input_dialog", {
    title: args.title,
    prompt: args.prompt,
    defaultValue: args.defaultValue ?? ""
  });
}

export function samplePhotoThemeColors(
  imagePath: string
): Promise<SampledPhotoThemeColors> {
  return invoke("sample_photo_theme_colors", { imagePath });
}

export function saveBlenderThemeFile(args: {
  suggestedName: string;
  path?: string;
  values: Record<string, unknown>;
}): Promise<string> {
  return invoke("save_blender_theme_file", {
    suggestedName: args.suggestedName,
    path: args.path,
    values: args.values
  });
}

export function loadBlenderThemeDarknessProfiles(): Promise<Record<string, unknown>> {
  return invoke("load_blender_theme_darkness_profiles");
}

export function saveBlenderThemeDarknessProfiles(
  document: Record<string, unknown>
): Promise<void> {
  return invoke("save_blender_theme_darkness_profiles", { document });
}

export function loadBlenderThemeFile(path: string): Promise<Record<string, unknown>> {
  return invoke("load_blender_theme_file", { path });
}

export async function showOpenExeDialog(initialDirectory?: string): Promise<string | null> {
  const paths = await showOpenFileDialog({
    title: "Choose Program EXE",
    filter: "Program EXE (*.exe)|*.exe|All Files (*.*)|*.*",
    initialDirectory,
    multiselect: false
  });
  return paths[0] ?? null;
}

export function listLayoutFiles(): Promise<SavedLayoutFile[]> {
  return invoke("list_layout_files");
}

export function loadLayoutSnapshot(path: string): Promise<LayoutSnapshot> {
  return invoke("load_layout_snapshot", { path });
}

export function saveLayoutSnapshot(
  suggestedName: string | null,
  snapshot: LayoutSnapshot
): Promise<string> {
  return invoke("save_layout_snapshot", { suggestedName, snapshot });
}

export function installBlenderButtons(args: {
  selectedPaths: string[];
  panelName: string;
}): Promise<Record<string, unknown>> {
  return invoke("install_blender_buttons", args);
}

export function installManagedProgramScripts(args: {
  programKey: string;
  selectedPaths: string[];
  panelName?: string;
}): Promise<ManagedScriptInstallResult> {
  return invoke("install_managed_program_scripts", args);
}

export function deleteBlenderButton(args: {
  buttonTarget: string;
}): Promise<Record<string, unknown>> {
  return invoke("delete_blender_button", args);
}

export function updateBlenderButtonDescription(args: {
  buttonTarget: string;
  executionTarget?: string;
  description: string;
}): Promise<Record<string, unknown>> {
  return invoke("update_blender_button_description", {
    request: {
      buttonTarget: args.buttonTarget,
      executionTarget: args.executionTarget,
      description: args.description
    }
  });
}

export function syncBlenderButtonSourceMirrors(args?: {
  refreshDescriptions?: boolean;
}): Promise<Record<string, unknown>> {
  return invoke("sync_blender_button_source_mirrors", {
    refreshDescriptions: args?.refreshDescriptions ?? false
  });
}
