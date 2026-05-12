import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  LogicalPosition,
  LogicalSize
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type {
  BindingMutationResult,
  CommandEnvelope,
  CommandResult,
  FlowCellButton,
  FlowCellBounds,
  FlowCellState,
  LayoutSnapshot,
  LoadStateResponse,
  RecordedMacroChoice,
  RecordedMacroDefinition,
  SavedLayoutFile,
  ToolPopoutLayoutMode,
  WindowContext
} from "../types";

const FLOWCELL_STATE_SYNC_EVENT = "flowcell://state-saved";
const FLOWCELL_WINDOW_PLACEMENT_EVENT = "flowcell://window-placement";

interface FlowCellWindowPlacementEventPayload {
  label?: string;
  suppressMs?: number;
}

interface SaveStateOptions {
  broadcast?: boolean;
}

export interface ForegroundProcessInfo {
  processName: string;
  processPath: string;
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
  const storedMinWidth = isPanelFan || isFloatingFanout ? defaults.minWidth : 120;
  const storedMinHeight = isPanelFan || isFloatingFanout ? defaults.minHeight : 72;

  if (isPanelFan) {
    if (isValidStoredBounds(args.bounds, storedMinWidth, storedMinHeight)) {
      return {
        x: args.bounds.Left,
        y: args.bounds.Top,
        width: clamp(args.bounds.Width, storedMinWidth, defaults.maxWidth),
        height: clamp(args.bounds.Height, storedMinHeight, defaults.maxHeight)
      };
    }
    return {
      width: defaults.width,
      height: defaults.height
    };
  }

  if (!isValidStoredBounds(args.bounds, storedMinWidth, storedMinHeight)) {
    return {
      width: defaults.width,
      height: defaults.height
    };
  }

  return {
    x: args.bounds.Left,
    y: args.bounds.Top,
    width: clamp(args.bounds.Width, storedMinWidth, defaults.maxWidth),
    height: clamp(args.bounds.Height, storedMinHeight, defaults.maxHeight)
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

async function applyTransparentFanoutWindowAppearance(window: WebviewWindow): Promise<void> {
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
      skipTaskbar: false,
      alwaysOnTop: true
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
      alwaysOnTop: true
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
  return (async () => {
    const isPanelFan = args.layoutMode === "PanelFan";
    const isFloatingFanout = args.layoutMode === "Fanout";
    const placement = resolveToolWindowOptions(args);
    const placementOptions = {
      focus: !(isPanelFan || isFloatingFanout),
      moveBeforeResize: isPanelFan || isFloatingFanout
    };
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      if (isPanelFan || isFloatingFanout) {
        await applyTransparentFanoutWindowAppearance(existing);
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
      resizable: !(isPanelFan || isFloatingFanout),
      decorations: false,
      transparent: isPanelFan || isFloatingFanout,
      shadow: !(isPanelFan || isFloatingFanout),
      visible: true,
      focus: !(isPanelFan || isFloatingFanout),
      skipTaskbar: isFloatingFanout,
      alwaysOnTop: true
    });

    await waitForWindowCreated(window);
    if (isPanelFan || isFloatingFanout) {
      await applyTransparentFanoutWindowAppearance(window);
    }
    await applyWindowPlacement(window, placement, placementOptions);
  })();
}

export function emitBackendEnvelope(
  envelope: CommandEnvelope
): Promise<CommandResult> {
  return invoke("emit_command", { envelope });
}

export function saveButtonBinding(args: {
  button: FlowCellButton;
  programId: number;
  shortcut: string;
}): Promise<BindingMutationResult> {
  return invoke("save_button_binding", {
    request: {
      kind: args.button.Kind,
      programTabId: args.programId,
      target: args.button.Target,
      shortcut: args.shortcut,
      bindingId: args.button.BindingId ?? 0,
      label: args.button.Label
    }
  });
}

export function clearButtonBinding(args: {
  button: FlowCellButton;
  programId: number;
}): Promise<BindingMutationResult> {
  return invoke("clear_button_binding", {
    request: {
      kind: args.button.Kind,
      programTabId: args.programId,
      target: args.button.Target,
      bindingId: args.button.BindingId ?? 0,
      label: args.button.Label
    }
  });
}

export function showOpenFileDialog(args: {
  title: string;
  filter: string;
  initialDirectory?: string;
  multiselect?: boolean;
}): Promise<string[]> {
  return invoke("show_open_file_dialog", {
    title: args.title,
    filter: args.filter,
    initialDirectory: args.initialDirectory,
    multiselect: args.multiselect ?? false
  });
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

export function listRecordedMacros(): Promise<RecordedMacroChoice[]> {
  return invoke("list_recorded_macros");
}

export function createRecordedMacroDraft(label?: string): Promise<RecordedMacroDefinition> {
  return invoke("create_recorded_macro_draft", { label });
}

export function loadRecordedMacro(id: string): Promise<RecordedMacroDefinition> {
  return invoke("load_recorded_macro", { actionId: id });
}

export function saveRecordedMacro(
  definition: RecordedMacroDefinition
): Promise<RecordedMacroDefinition> {
  return invoke("save_recorded_macro", { definition });
}

export function deleteRecordedMacro(id: string): Promise<string> {
  return invoke("delete_recorded_macro", { actionId: id });
}

export function recordMacro(label: string): Promise<RecordedMacroDefinition> {
  return invoke("record_macro", { label });
}

export function runRecordedMacro(id: string): Promise<string> {
  return invoke("run_recorded_macro", { actionId: id });
}

export function installBlenderButtons(args: {
  selectedPaths: string[];
  panelName: string;
}): Promise<Record<string, unknown>> {
  return invoke("install_blender_buttons", args);
}

export function deleteBlenderButton(args: {
  buttonTarget: string;
}): Promise<Record<string, unknown>> {
  return invoke("delete_blender_button", args);
}
