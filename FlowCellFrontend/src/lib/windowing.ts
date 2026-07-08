import { invoke } from "@tauri-apps/api/core";
import {
  availableMonitors,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
  PhysicalPosition,
  PhysicalSize
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { FlowCellBounds } from "../types";
import {
  ALIGNMENT_TOOLBOX_WINDOW_HEIGHT,
  ALIGNMENT_TOOLBOX_WINDOW_WIDTH,
  ILLUSTRATOR_ALIGNMENT_TOOLBOX_WINDOW_HEIGHT
} from "../pages/alignment/alignmentToolboxGeometry";
import {
  BOOLEAN_TOOLBOX_WINDOW_HEIGHT,
  BOOLEAN_TOOLBOX_WINDOW_WIDTH
} from "../pages/boolean/booleanToolboxGeometry";
import {
  BUILD_LAYERS_WINDOW_HEIGHT,
  BUILD_LAYERS_WINDOW_WIDTH
} from "../pages/build-layers/buildLayersGeometry";
import {
  CODEX_USAGE_POPOUT_WINDOW_HEIGHT,
  CODEX_USAGE_POPOUT_WINDOW_WIDTH
} from "../pages/codex-usage/codexUsagePopoutGeometry";
import {
  DIMENSIONS_TOOLBOX_WINDOW_HEIGHT,
  DIMENSIONS_TOOLBOX_WINDOW_WIDTH
} from "../pages/dimensions/dimensionsToolboxGeometry";
import {
  REMESH_TOOLBOX_WINDOW_HEIGHT,
  REMESH_TOOLBOX_WINDOW_WIDTH
} from "../pages/remesh/remeshToolboxGeometry";
import {
  TRI_POLY_TOOLBOX_WINDOW_HEIGHT,
  TRI_POLY_TOOLBOX_WINDOW_WIDTH
} from "../pages/tri-poly/triPolyToolboxGeometry";
import {
  ILLUSTRATOR_ROTATE_TOOLBOX_WINDOW_HEIGHT,
  ILLUSTRATOR_ROTATE_TOOLBOX_WINDOW_WIDTH,
  ROTATE_TOOLBOX_WINDOW_HEIGHT,
  ROTATE_TOOLBOX_WINDOW_WIDTH
} from "../pages/rotate/rotateToolboxGeometry";
import {
  SMART_AXIS_TOOLBOX_WINDOW_HEIGHT,
  SMART_AXIS_TOOLBOX_WINDOW_WIDTH
} from "../pages/smart-axis/smartAxisToolboxGeometry";
import { buildScriptGroupPopoutWindowSize } from "./scriptGroupPopoutTemplates";
import { registerLayoutWindow } from "./layoutSnapshots";
import {
  DEFAULT_SCRIPT_GROUP_POPOUT_TYPE,
  type ScriptGroupPopoutType
} from "./scriptGroupPopoutSettings";
import {
  registerScopedWindowTopmost,
  refreshScopedWindowTopmost,
  setHostWindowTopmost,
  unregisterScopedWindowTopmost
} from "./tauri";
import { emit } from "@tauri-apps/api/event";
import {
  buildWindowContextUrl,
  BINDS_PREFILL_EVENT,
  type BindsButtonPrefill,
  type ScriptGroupPopoutScript
} from "./windowContext";
import { getCodexUsageSnapshot } from "./codexUsage";

const PANEL_FAN_WINDOW_WIDTH = 132;
const PANEL_FAN_WINDOW_HEIGHT = 56;
const PANEL_FAN_OPTIONS_WINDOW_WIDTH = 560;
const PANEL_FAN_OPTIONS_WINDOW_HEIGHT = 680;
const BINDS_WINDOW_WIDTH = 1280;
const BINDS_WINDOW_HEIGHT = 860;
const MACRO_LAB_WINDOW_WIDTH = 1320;
const MACRO_LAB_WINDOW_HEIGHT = 900;
const ORGANIZATION_SETUP_WINDOW_WIDTH = 1240;
const ORGANIZATION_SETUP_WINDOW_HEIGHT = 880;
const BUTTON_REORDER_WINDOW_WIDTH = 720;
const BUTTON_REORDER_WINDOW_HEIGHT = 840;
const FLATTEN_REVOLVE_TOOLBOX_WINDOW_WIDTH = 640;
const FLATTEN_REVOLVE_TOOLBOX_WINDOW_HEIGHT = 456;
const GENERIC_TOOLBOX_WINDOW_WIDTH = 560;
const GENERIC_TOOLBOX_WINDOW_HEIGHT = 360;
const THEME_TOOLBOX_WINDOW_WIDTH = 920;
const THEME_TOOLBOX_WINDOW_HEIGHT = 500;
const APPEARANCE_WINDOW_WIDTH = 560;
const APPEARANCE_WINDOW_HEIGHT = 640;
const APPEARANCE_HUB_WINDOW_WIDTH = 1080;
const APPEARANCE_HUB_WINDOW_HEIGHT = 720;
const WINDOW_RELEASE_ATTEMPTS = 24;
const WINDOW_RELEASE_DELAY_MS = 16;
const TRANSPARENT_WINDOW_BACKGROUND: [number, number, number, number] = [0, 0, 0, 0];
const DUPLICATE_WINDOW_CASCADE_STEP = 28;
const DUPLICATE_WINDOW_CASCADE_SLOTS = 12;
type WindowPlacement = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  unit?: "logical" | "physical";
};

const pendingAlignmentToolboxOpens = new Map<string, Promise<void>>();
const pendingBooleanToolboxOpens = new Map<string, Promise<void>>();
const pendingDimensionsToolboxOpens = new Map<string, Promise<void>>();
const pendingRemeshToolboxOpens = new Map<string, Promise<void>>();
const pendingTriPolyToolboxOpens = new Map<string, Promise<void>>();
const pendingBindsOpens = new Map<string, Promise<void>>();
const pendingMacroLabOpens = new Map<string, Promise<void>>();
const pendingOrganizationSetupOpens = new Map<string, Promise<void>>();
const pendingBuildLayersOpens = new Map<string, Promise<void>>();
const pendingWindowGridOpens = new Map<string, Promise<void>>();
const pendingButtonReorderOpens = new Map<string, Promise<void>>();
const pendingFlattenRevolveToolboxOpens = new Map<string, Promise<void>>();
const pendingGenericToolboxOpens = new Map<string, Promise<void>>();
const pendingThemeToolboxOpens = new Map<string, Promise<void>>();
const pendingPanelFanOpens = new Map<string, Promise<void>>();
const pendingPanelFanOptionsOpens = new Map<string, Promise<void>>();
const pendingRotateToolboxOpens = new Map<string, Promise<void>>();
const pendingSmartAxisToolboxOpens = new Map<string, Promise<void>>();
const pendingScriptGroupPopoutOpens = new Map<string, Promise<void>>();
const pendingCodexUsagePopoutOpens = new Map<string, Promise<void>>();
const pendingAppearanceOpens = new Map<string, Promise<void>>();
const pendingAppearanceHubOpens = new Map<string, Promise<void>>();
let duplicateWindowInstanceCounter = 0;
const duplicateWindowCascadeIndexes = new Map<string, number>();

function buildDuplicateWindowLabel(baseWindowLabel: string): string {
  duplicateWindowInstanceCounter += 1;
  return [
    baseWindowLabel,
    "inst",
    Date.now().toString(36),
    duplicateWindowInstanceCounter.toString(36)
  ].join("-");
}

function applyDuplicateWindowCascade<T extends { x?: number; y?: number }>(
  baseWindowLabel: string,
  placement: T,
  bounds?: FlowCellBounds | null
): T {
  if (bounds || typeof placement.x !== "number" || typeof placement.y !== "number") {
    return placement;
  }

  const cascadeIndex = duplicateWindowCascadeIndexes.get(baseWindowLabel) ?? 0;
  duplicateWindowCascadeIndexes.set(baseWindowLabel, cascadeIndex + 1);
  const offset =
    (cascadeIndex % DUPLICATE_WINDOW_CASCADE_SLOTS) * DUPLICATE_WINDOW_CASCADE_STEP;

  return {
    ...placement,
    x: placement.x + offset,
    y: placement.y + offset
  };
}

function isUsableFlowCellBounds(bounds: FlowCellBounds | null | undefined): bounds is FlowCellBounds {
  return Boolean(
    bounds &&
      Number.isFinite(bounds.Left) &&
      Number.isFinite(bounds.Top) &&
      Number.isFinite(bounds.Width) &&
      Number.isFinite(bounds.Height) &&
      bounds.Width > 0 &&
      bounds.Height > 0
  );
}

function resolveSavedBoundsPlacement(
  defaults: WindowPlacement,
  bounds?: FlowCellBounds | null,
  options: { useDefaultSize?: boolean } = {}
): WindowPlacement {
  if (!isUsableFlowCellBounds(bounds)) {
    return defaults;
  }

  return {
    width: options.useDefaultSize ? defaults.width : bounds.Width,
    height: options.useDefaultSize ? defaults.height : bounds.Height,
    x: bounds.Left,
    y: bounds.Top,
    unit: "physical"
  };
}

function placementSize(placement: WindowPlacement): LogicalSize | PhysicalSize {
  return placement.unit === "physical"
    ? new PhysicalSize(placement.width, placement.height)
    : new LogicalSize(placement.width, placement.height);
}

function placementPosition(placement: WindowPlacement): LogicalPosition | PhysicalPosition {
  const x = placement.x ?? 0;
  const y = placement.y ?? 0;
  return placement.unit === "physical"
    ? new PhysicalPosition(x, y)
    : new LogicalPosition(x, y);
}

// Position must be applied before size. Moving a window between monitors with
// different scale factors makes Windows rescale it (WM_DPICHANGED), so a size
// applied before a cross-monitor move comes back multiplied by the DPI ratio
// (saved toolsets restored at 2/3 size after transiting the 150% monitor).
// Once the window sits on its final monitor, the size applies exactly.
async function applyWindowPlacement(
  target: WebviewWindow,
  placement: WindowPlacement
): Promise<void> {
  if (typeof placement.x === "number" && typeof placement.y === "number") {
    await target.setPosition(placementPosition(placement)).catch(() => {});
  }
  await target.setSize(placementSize(placement)).catch(() => {});
}

async function clampPhysicalPositionToWorkArea(args: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Promise<{ x: number; y: number }> {
  const monitors = await availableMonitors().catch(() => []);
  if (monitors.length === 0) {
    return {
      x: args.x,
      y: args.y
    };
  }

  const centerX = args.x + args.width / 2;
  const centerY = args.y + args.height / 2;
  const containingMonitor = monitors.find((monitor) => {
    const left = monitor.workArea.position.x;
    const top = monitor.workArea.position.y;
    const right = left + monitor.workArea.size.width;
    const bottom = top + monitor.workArea.size.height;
    return centerX >= left && centerX <= right && centerY >= top && centerY <= bottom;
  });
  const nearestMonitor =
    containingMonitor ??
    monitors
      .map((monitor) => {
        const left = monitor.workArea.position.x;
        const top = monitor.workArea.position.y;
        const right = left + monitor.workArea.size.width;
        const bottom = top + monitor.workArea.size.height;
        const nearestX = Math.min(Math.max(centerX, left), right);
        const nearestY = Math.min(Math.max(centerY, top), bottom);
        const dx = centerX - nearestX;
        const dy = centerY - nearestY;
        return {
          monitor,
          distanceSquared: dx * dx + dy * dy
        };
      })
      .sort((left, right) => left.distanceSquared - right.distanceSquared)[0]?.monitor;

  if (!nearestMonitor) {
    return {
      x: args.x,
      y: args.y
    };
  }

  const workLeft = nearestMonitor.workArea.position.x;
  const workTop = nearestMonitor.workArea.position.y;
  const workRight = workLeft + nearestMonitor.workArea.size.width;
  const workBottom = workTop + nearestMonitor.workArea.size.height;
  const maxX = Math.max(workLeft, workRight - args.width);
  const maxY = Math.max(workTop, workBottom - args.height);

  return {
    x: Math.min(Math.max(args.x, workLeft), maxX),
    y: Math.min(Math.max(args.y, workTop), maxY)
  };
}

function sanitizeWindowToken(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9\-/:_]/g, "_");
  return sanitized.length > 0 ? sanitized : "flowcell";
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

async function waitForWindowReleased(windowLabel: string): Promise<boolean> {
  for (let attempt = 0; attempt < WINDOW_RELEASE_ATTEMPTS; attempt += 1) {
    const existing = await WebviewWindow.getByLabel(windowLabel);
    if (!existing) {
      return true;
    }

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, WINDOW_RELEASE_DELAY_MS);
    });
  }

  return (await WebviewWindow.getByLabel(windowLabel)) === null;
}

async function closeWindowAndWaitForRelease(
  windowLabel: string,
  existing?: WebviewWindow | null
): Promise<boolean> {
  const target = existing ?? (await WebviewWindow.getByLabel(windowLabel));
  if (!target) {
    await unregisterScopedWindowTopmost(windowLabel).catch(() => {});
    return true;
  }

  await unregisterScopedWindowTopmost(windowLabel).catch(() => {});
  await setHostWindowTopmost(windowLabel, false).catch(() => {});
  await target.close().catch(() => {});
  return waitForWindowReleased(windowLabel);
}

async function applyProgramScopedTopmost(
  windowLabel: string,
  programName: string,
  bindOwner = true
): Promise<void> {
  await registerScopedWindowTopmost(windowLabel, programName, bindOwner).catch((error) => {
    console.error(`Failed to register scoped topmost for ${windowLabel}.`, error);
  });
  await refreshScopedWindowTopmost(windowLabel).catch(() => {
    void setHostWindowTopmost(windowLabel, false).catch(() => {});
  });
}

async function focusExistingWindow(window: WebviewWindow): Promise<void> {
  const isMinimized = await window.isMinimized().catch(() => false);
  if (isMinimized) {
    await window.unminimize().catch(() => {});
  }
  await window.show().catch(() => {});
  await window.setFocus().catch(() => {});
}

async function showWindowWithoutFocus(window: WebviewWindow): Promise<void> {
  const isMinimized = await window.isMinimized().catch(() => false);
  if (isMinimized) {
    await window.unminimize().catch(() => {});
  }
  await window.show().catch(() => {});
}

async function clearResizableWindowSizeLimits(window: WebviewWindow): Promise<void> {
  await window.setMinSize(null).catch(() => {});
  await window.setMaxSize(null).catch(() => {});
}

async function applyRotateToolboxWindowChrome(window: WebviewWindow): Promise<void> {
  await window.setDecorations(false).catch(() => {});
  await window.setShadow(false).catch(() => {});
  await window.setResizable(true).catch(() => {});
  await clearResizableWindowSizeLimits(window);
  await window.setAlwaysOnTop(false).catch(() => {});

  const backgroundTarget = window as WebviewWindow & {
    setBackgroundColor?: (color: [number, number, number, number]) => Promise<void>;
  };
  if (typeof backgroundTarget.setBackgroundColor === "function") {
    await backgroundTarget.setBackgroundColor(TRANSPARENT_WINDOW_BACKGROUND).catch(() => {});
  }
}

async function applyGenericToolboxWindowChrome(window: WebviewWindow): Promise<void> {
  await applyRotateToolboxWindowChrome(window);
}

async function applyPanelFanWindowChrome(window: WebviewWindow): Promise<void> {
  await window.setDecorations(false).catch(() => {});
  await window.setShadow(false).catch(() => {});
  await window.setResizable(true).catch(() => {});
  await clearResizableWindowSizeLimits(window);
  await window.setAlwaysOnTop(false).catch(() => {});

  const backgroundTarget = window as WebviewWindow & {
    setBackgroundColor?: (color: [number, number, number, number]) => Promise<void>;
  };
  if (typeof backgroundTarget.setBackgroundColor === "function") {
    await backgroundTarget.setBackgroundColor(TRANSPARENT_WINDOW_BACKGROUND).catch(() => {});
  }
}

async function resolveRotateToolboxWindowOptions(programName = ""): Promise<{
  width: number;
  height: number;
  x?: number;
  y?: number;
}> {
  const isIllustrator = programName.trim().toLowerCase().includes("illustrator");
  const defaults = {
    width: isIllustrator
      ? ILLUSTRATOR_ROTATE_TOOLBOX_WINDOW_WIDTH
      : ROTATE_TOOLBOX_WINDOW_WIDTH,
    height: isIllustrator
      ? ILLUSTRATOR_ROTATE_TOOLBOX_WINDOW_HEIGHT
      : ROTATE_TOOLBOX_WINDOW_HEIGHT
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
  const logicalHeight = size.height / scaleFactor;
  const centeredX = logicalLeft + Math.max((logicalWidth - defaults.width) / 2, 24);
  const centeredY = logicalTop + Math.max((logicalHeight - defaults.height) / 2, 24);
  const rightInsetX =
    logicalLeft + Math.max(logicalWidth - defaults.width - 24, 24);
  const stackedY =
    logicalTop +
    Math.max(
      Math.min(
        120 + ILLUSTRATOR_ALIGNMENT_TOOLBOX_WINDOW_HEIGHT + 16,
        logicalHeight - defaults.height - 24
      ),
      24
    );

  return {
    ...defaults,
    x: isIllustrator ? rightInsetX : centeredX,
    y: isIllustrator ? stackedY : centeredY
  };
}

async function resolveAlignmentToolboxWindowOptions(programName = ""): Promise<{
  width: number;
  height: number;
  x?: number;
  y?: number;
}> {
  const isIllustrator = programName.trim().toLowerCase().includes("illustrator");
  const defaults = {
    width: ALIGNMENT_TOOLBOX_WINDOW_WIDTH,
    height: isIllustrator
      ? ILLUSTRATOR_ALIGNMENT_TOOLBOX_WINDOW_HEIGHT
      : ALIGNMENT_TOOLBOX_WINDOW_HEIGHT
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
  const logicalHeight = size.height / scaleFactor;
  const centeredX = logicalLeft + Math.max((logicalWidth - defaults.width) / 2, 24);
  const centeredY = logicalTop + Math.max((logicalHeight - defaults.height) / 2, 24);
  const rightInsetX =
    logicalLeft + Math.max(logicalWidth - defaults.width - 24, 24);
  const stackedY =
    logicalTop +
    Math.max(
      Math.min(120, logicalHeight - defaults.height - 24),
      24
    );

  return {
    ...defaults,
    x: isIllustrator ? rightInsetX : centeredX,
    y: isIllustrator ? stackedY : centeredY
  };
}

async function resolveBooleanToolboxWindowOptions(): Promise<{
  width: number;
  height: number;
  x?: number;
  y?: number;
}> {
  const defaults = {
    width: BOOLEAN_TOOLBOX_WINDOW_WIDTH,
    height: BOOLEAN_TOOLBOX_WINDOW_HEIGHT
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
  const logicalHeight = size.height / scaleFactor;

  return {
    ...defaults,
    x: logicalLeft + Math.max((logicalWidth - defaults.width) / 2, 24),
    y: logicalTop + Math.max((logicalHeight - defaults.height) / 2, 24)
  };
}

async function resolveDimensionsToolboxWindowOptions(): Promise<{
  width: number;
  height: number;
  x?: number;
  y?: number;
}> {
  const defaults = {
    width: DIMENSIONS_TOOLBOX_WINDOW_WIDTH,
    height: DIMENSIONS_TOOLBOX_WINDOW_HEIGHT
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
  const logicalHeight = size.height / scaleFactor;

  return {
    ...defaults,
    x: logicalLeft + Math.max((logicalWidth - defaults.width) / 2, 24),
    y: logicalTop + Math.max((logicalHeight - defaults.height) / 2, 24)
  };
}

async function resolveRemeshToolboxWindowOptions(): Promise<{
  width: number;
  height: number;
  x?: number;
  y?: number;
}> {
  const defaults = {
    width: REMESH_TOOLBOX_WINDOW_WIDTH,
    height: REMESH_TOOLBOX_WINDOW_HEIGHT
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
  const logicalHeight = size.height / scaleFactor;

  return {
    ...defaults,
    x: logicalLeft + Math.max((logicalWidth - defaults.width) / 2, 24),
    y: logicalTop + Math.max((logicalHeight - defaults.height) / 2, 24)
  };
}

async function resolveTriPolyToolboxWindowOptions(): Promise<{
  width: number;
  height: number;
  x?: number;
  y?: number;
}> {
  const defaults = {
    width: TRI_POLY_TOOLBOX_WINDOW_WIDTH,
    height: TRI_POLY_TOOLBOX_WINDOW_HEIGHT
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
  const logicalHeight = size.height / scaleFactor;

  return {
    ...defaults,
    x: logicalLeft + Math.max((logicalWidth - defaults.width) / 2, 24),
    y: logicalTop + Math.max((logicalHeight - defaults.height) / 2, 24)
  };
}

async function resolveGenericToolboxWindowOptions(): Promise<{
  width: number;
  height: number;
  x?: number;
  y?: number;
}> {
  const defaults = {
    width: GENERIC_TOOLBOX_WINDOW_WIDTH,
    height: GENERIC_TOOLBOX_WINDOW_HEIGHT
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
  const logicalHeight = size.height / scaleFactor;

  return {
    ...defaults,
    x: logicalLeft + Math.max((logicalWidth - defaults.width) / 2, 24),
    y: logicalTop + Math.max((logicalHeight - defaults.height) / 2, 24)
  };
}

async function resolveThemeToolboxWindowOptions(): Promise<{
  width: number;
  height: number;
  x?: number;
  y?: number;
}> {
  const defaults = {
    width: THEME_TOOLBOX_WINDOW_WIDTH,
    height: THEME_TOOLBOX_WINDOW_HEIGHT
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
  const logicalHeight = size.height / scaleFactor;

  return {
    ...defaults,
    x: logicalLeft + Math.max((logicalWidth - defaults.width) / 2, 24),
    y: logicalTop + Math.max((logicalHeight - defaults.height) / 2, 24)
  };
}

async function resolveFlattenRevolveToolboxWindowOptions(): Promise<{
  width: number;
  height: number;
  x?: number;
  y?: number;
}> {
  const defaults = {
    width: FLATTEN_REVOLVE_TOOLBOX_WINDOW_WIDTH,
    height: FLATTEN_REVOLVE_TOOLBOX_WINDOW_HEIGHT
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
  const logicalHeight = size.height / scaleFactor;

  return {
    ...defaults,
    x: logicalLeft + Math.max((logicalWidth - defaults.width) / 2, 24),
    y: logicalTop + Math.max((logicalHeight - defaults.height) / 2, 24)
  };
}

async function resolveSmartAxisToolboxWindowOptions(): Promise<{
  width: number;
  height: number;
  x?: number;
  y?: number;
}> {
  const defaults = {
    width: SMART_AXIS_TOOLBOX_WINDOW_WIDTH,
    height: SMART_AXIS_TOOLBOX_WINDOW_HEIGHT
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
  const logicalHeight = size.height / scaleFactor;

  return {
    ...defaults,
    x: logicalLeft + Math.max((logicalWidth - defaults.width) / 2, 24),
    y: logicalTop + Math.max((logicalHeight - defaults.height) / 2, 24)
  };
}

async function resolvePanelFanWindowOptions(): Promise<{
  width: number;
  height: number;
  x?: number;
  y?: number;
}> {
  const defaults = {
    width: PANEL_FAN_WINDOW_WIDTH,
    height: PANEL_FAN_WINDOW_HEIGHT
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
  const logicalHeight = size.height / scaleFactor;

  return {
    ...defaults,
    x: logicalLeft + Math.max((logicalWidth - defaults.width) / 2, 24),
    y: logicalTop + Math.max((logicalHeight - defaults.height) / 2, 24)
  };
}

async function resolvePanelFanOptionsWindowOptions(): Promise<{
  width: number;
  height: number;
  x?: number;
  y?: number;
}> {
  const defaults = {
    width: PANEL_FAN_OPTIONS_WINDOW_WIDTH,
    height: PANEL_FAN_OPTIONS_WINDOW_HEIGHT
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
  const logicalHeight = size.height / scaleFactor;

  return {
    ...defaults,
    x: logicalLeft + Math.max((logicalWidth - defaults.width) / 2, 24),
    y: logicalTop + Math.max((logicalHeight - defaults.height) / 2, 24)
  };
}

async function resolveButtonReorderWindowOptions(): Promise<{
  width: number;
  height: number;
  x?: number;
  y?: number;
}> {
  const defaults = {
    width: BUTTON_REORDER_WINDOW_WIDTH,
    height: BUTTON_REORDER_WINDOW_HEIGHT
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
  const logicalHeight = size.height / scaleFactor;

  return {
    ...defaults,
    x: logicalLeft + Math.max((logicalWidth - defaults.width) / 2, 24),
    y: logicalTop + Math.max((logicalHeight - defaults.height) / 2, 24)
  };
}

async function resolveBindsWindowOptions(): Promise<{
  width: number;
  height: number;
  x?: number;
  y?: number;
}> {
  const defaults = {
    width: BINDS_WINDOW_WIDTH,
    height: BINDS_WINDOW_HEIGHT
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
  const logicalHeight = size.height / scaleFactor;

  return {
    ...defaults,
    x: logicalLeft + Math.max((logicalWidth - defaults.width) / 2, 24),
    y: logicalTop + Math.max((logicalHeight - defaults.height) / 2, 24)
  };
}

async function resolveMacroLabWindowOptions(): Promise<{
  width: number;
  height: number;
  x?: number;
  y?: number;
}> {
  const defaults = {
    width: MACRO_LAB_WINDOW_WIDTH,
    height: MACRO_LAB_WINDOW_HEIGHT
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
  const logicalHeight = size.height / scaleFactor;

  return {
    ...defaults,
    x: logicalLeft + Math.max((logicalWidth - defaults.width) / 2, 24),
    y: logicalTop + Math.max((logicalHeight - defaults.height) / 2, 24)
  };
}

async function resolveOrganizationSetupWindowOptions(): Promise<{
  width: number;
  height: number;
  x?: number;
  y?: number;
}> {
  const defaults = {
    width: ORGANIZATION_SETUP_WINDOW_WIDTH,
    height: ORGANIZATION_SETUP_WINDOW_HEIGHT
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
  const logicalHeight = size.height / scaleFactor;

  return {
    ...defaults,
    x: logicalLeft + Math.max((logicalWidth - defaults.width) / 2, 24),
    y: logicalTop + Math.max((logicalHeight - defaults.height) / 2, 24)
  };
}

async function resolveScriptGroupPopoutWindowOptions(
  scriptCount: number,
  popoutType: ScriptGroupPopoutType
): Promise<{
  width: number;
  height: number;
  x?: number;
  y?: number;
}> {
  const defaults = buildScriptGroupPopoutWindowSize(popoutType, scriptCount);
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
  const logicalHeight = size.height / scaleFactor;

  return {
    ...defaults,
    x: logicalLeft + Math.max((logicalWidth - defaults.width) / 2, 24),
    y: logicalTop + Math.max((logicalHeight - defaults.height) / 2, 24)
  };
}

async function resolveCodexUsagePopoutWindowOptions(): Promise<{
  width: number;
  height: number;
  x?: number;
  y?: number;
}> {
  const defaults = {
    width: CODEX_USAGE_POPOUT_WINDOW_WIDTH,
    height: CODEX_USAGE_POPOUT_WINDOW_HEIGHT
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
  const logicalHeight = size.height / scaleFactor;

  return {
    ...defaults,
    x: logicalLeft + Math.max((logicalWidth - defaults.width) / 2, 24),
    y: logicalTop + Math.max((logicalHeight - defaults.height) / 2, 24)
  };
}

export async function openPanelFanWindow(args: {
  programName: string;
  panelName: string;
  selectedFileNames: string[];
  label: string;
  bounds?: FlowCellBounds | null;
}): Promise<void> {
  const baseWindowLabel = [
    "panel-fan",
    sanitizeWindowToken(args.programName),
    sanitizeWindowToken(args.panelName)
  ].join("-");
  const windowLabel = buildDuplicateWindowLabel(baseWindowLabel);

  const pendingOpen = pendingPanelFanOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    const defaultPlacement = await resolvePanelFanWindowOptions();
    const savedBounds = isUsableFlowCellBounds(args.bounds) ? args.bounds : null;
    const cascadedDefaultPlacement = applyDuplicateWindowCascade(
      baseWindowLabel,
      defaultPlacement,
      args.bounds
    );
    const savedPhysicalPosition = savedBounds
      ? await clampPhysicalPositionToWorkArea({
          x: savedBounds.Left,
          y: savedBounds.Top,
          width: defaultPlacement.width,
          height: defaultPlacement.height
        })
      : null;
    const placement = savedPhysicalPosition
      ? {
          ...defaultPlacement,
          x: savedPhysicalPosition.x,
          y: savedPhysicalPosition.y,
          unit: "physical" as const
        }
      : cascadedDefaultPlacement;

    registerLayoutWindow({
      windowLabel,
      kind: "panel-fan",
      programName: args.programName,
      panelName: args.panelName,
      label: args.label,
      selectedFileNames: args.selectedFileNames,
      snapshotBounds: args.bounds ?? undefined
    });

    const window = new WebviewWindow(windowLabel, {
      url: buildWindowContextUrl({
        kind: "panel-fan",
        programName: args.programName,
        panelName: args.panelName,
        selectedFileNames: args.selectedFileNames,
        label: args.label
      }),
      title: `FlowCell - ${args.label}`,
      width: defaultPlacement.width,
      height: defaultPlacement.height,
      x: savedPhysicalPosition ? undefined : placement.x,
      y: savedPhysicalPosition ? undefined : placement.y,
      resizable: true,
      decorations: false,
      transparent: true,
      backgroundColor: TRANSPARENT_WINDOW_BACKGROUND,
      shadow: false,
      visible: false,
      focus: false,
      alwaysOnTop: false
    });

    await waitForWindowCreated(window);
    await applyPanelFanWindowChrome(window);
    await applyProgramScopedTopmost(windowLabel, args.programName);
    if (savedPhysicalPosition) {
      await window
        .setPosition(new PhysicalPosition(savedPhysicalPosition.x, savedPhysicalPosition.y))
        .catch(() => {});
    } else if (typeof placement.x === "number" && typeof placement.y === "number") {
      await window
        .setPosition(placementPosition(placement))
        .catch(() => {});
    }
    await window
      .setSize(savedPhysicalPosition ? new LogicalSize(defaultPlacement.width, defaultPlacement.height) : placementSize(placement))
      .catch(() => {});
    await window.show().catch(() => {});
  })().finally(() => {
    if (pendingPanelFanOpens.get(windowLabel) === openPromise) {
      pendingPanelFanOpens.delete(windowLabel);
    }
  });

  pendingPanelFanOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function closePanelFanWindow(args: {
  programName: string;
  panelName: string;
}): Promise<void> {
  const windowLabel = [
    "panel-fan",
    sanitizeWindowToken(args.programName),
    sanitizeWindowToken(args.panelName)
  ].join("-");
  const existing = await WebviewWindow.getByLabel(windowLabel);
  if (existing) {
    await closeWindowAndWaitForRelease(windowLabel, existing);
  }
}

export async function openPanelFanOptionsWindow(args: {
  programName: string;
  panelName: string;
  bounds?: FlowCellBounds | null;
}): Promise<void> {
  const windowLabel = [
    "panel-fan-options",
    sanitizeWindowToken(args.programName),
    sanitizeWindowToken(args.panelName)
  ].join("-");

  const pendingOpen = pendingPanelFanOptionsOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    const placement = await resolveSavedBoundsPlacement(
      await resolvePanelFanOptionsWindowOptions(),
      args.bounds
    );
    registerLayoutWindow({
      windowLabel,
      kind: "panel-fan-options",
      programName: args.programName,
      panelName: args.panelName
    });
    const existing = await WebviewWindow.getByLabel(windowLabel);
    if (existing) {
      await applyProgramScopedTopmost(windowLabel, args.programName);
      await applyWindowPlacement(existing, placement);
      await focusExistingWindow(existing);
      return;
    }

    const window = new WebviewWindow(windowLabel, {
      url: buildWindowContextUrl({
        kind: "panel-fan-options",
        programName: args.programName,
        panelName: args.panelName
      }),
      title: `FlowCell - Fan Options - ${args.panelName}`,
      width: placement.width,
      height: placement.height,
      x: placement.x,
      y: placement.y,
      resizable: true,
      decorations: true,
      transparent: false,
      shadow: true,
      visible: true,
      focus: true,
      alwaysOnTop: false
    });

    await waitForWindowCreated(window);
    await applyProgramScopedTopmost(windowLabel, args.programName);
    await applyWindowPlacement(window, placement);
    await focusExistingWindow(window);
  })().finally(() => {
    if (pendingPanelFanOptionsOpens.get(windowLabel) === openPromise) {
      pendingPanelFanOptionsOpens.delete(windowLabel);
    }
  });

  pendingPanelFanOptionsOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openButtonReorderWindow(args: {
  programName: string;
  panelName: string;
  bounds?: FlowCellBounds | null;
}): Promise<void> {
  const windowLabel = [
    "button-reorder",
    sanitizeWindowToken(args.programName),
    sanitizeWindowToken(args.panelName)
  ].join("-");

  const pendingOpen = pendingButtonReorderOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    const placement = await resolveSavedBoundsPlacement(
      await resolveButtonReorderWindowOptions(),
      args.bounds
    );
    const existing = await WebviewWindow.getByLabel(windowLabel);
    if (existing) {
      await applyProgramScopedTopmost(windowLabel, args.programName);
      await applyWindowPlacement(existing, placement);
      await focusExistingWindow(existing);
      return;
    }

    const window = new WebviewWindow(windowLabel, {
      url: buildWindowContextUrl({
        kind: "button-reorder",
        programName: args.programName,
        panelName: args.panelName
      }),
      title: `FlowCell - Button Order - ${args.panelName}`,
      width: placement.width,
      height: placement.height,
      x: placement.x,
      y: placement.y,
      resizable: true,
      decorations: true,
      transparent: false,
      shadow: true,
      visible: true,
      focus: true,
      alwaysOnTop: false
    });

    await waitForWindowCreated(window);
    await applyProgramScopedTopmost(windowLabel, args.programName);
    await applyWindowPlacement(window, placement);
    await focusExistingWindow(window);
  })().finally(() => {
    if (pendingButtonReorderOpens.get(windowLabel) === openPromise) {
      pendingButtonReorderOpens.delete(windowLabel);
    }
  });

  pendingButtonReorderOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openBindsWindow(prefill?: BindsButtonPrefill): Promise<void> {
  const windowLabel = "flowcell-binds";
  const pendingOpen = pendingBindsOpens.get(windowLabel);
  if (pendingOpen) {
    await pendingOpen;
    if (prefill) {
      await emit(BINDS_PREFILL_EVENT, prefill).catch(() => {});
    }
    return;
  }

  const openPromise = (async () => {
    const placement = await resolveBindsWindowOptions();
    const existing = await WebviewWindow.getByLabel(windowLabel);
    if (existing) {
      await applyWindowPlacement(existing, placement);
      await focusExistingWindow(existing);
      // The page is already mounted and listening, so push the prefill as an event.
      if (prefill) {
        await emit(BINDS_PREFILL_EVENT, prefill).catch(() => {});
      }
      return;
    }

    const window = new WebviewWindow(windowLabel, {
      // A fresh window reads the prefill from its context URL on mount.
      url: buildWindowContextUrl(
        prefill ? { kind: "binds", prefill } : { kind: "binds" }
      ),
      title: "FlowCell - Binds",
      width: placement.width,
      height: placement.height,
      x: placement.x,
      y: placement.y,
      resizable: true,
      decorations: true,
      transparent: false,
      shadow: true,
      visible: true,
      focus: true,
      alwaysOnTop: false
    });

    await waitForWindowCreated(window);
    await applyWindowPlacement(window, placement);
    await focusExistingWindow(window);
  })().finally(() => {
    if (pendingBindsOpens.get(windowLabel) === openPromise) {
      pendingBindsOpens.delete(windowLabel);
    }
  });

  pendingBindsOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openMacroLabWindow(args: {
  programName: string;
  panelName: string;
  macroId?: string | null;
  attachToPanel?: boolean;
}): Promise<void> {
  const windowLabel = "flowcell-macro-lab";
  const pendingOpen = pendingMacroLabOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    const placement = await resolveMacroLabWindowOptions();
    const existing = await WebviewWindow.getByLabel(windowLabel);
    if (existing) {
      await closeWindowAndWaitForRelease(windowLabel, existing);
    }

    const window = new WebviewWindow(windowLabel, {
      url: buildWindowContextUrl({
        kind: "macro-lab",
        programName: args.programName,
        panelName: args.panelName,
        macroId: args.macroId?.trim() || undefined,
        attachToPanel: args.attachToPanel === true
      }),
      title: "FlowCell - Macro Lab",
      width: placement.width,
      height: placement.height,
      x: placement.x,
      y: placement.y,
      resizable: true,
      decorations: true,
      transparent: false,
      shadow: true,
      visible: true,
      focus: true,
      alwaysOnTop: false
    });

    await waitForWindowCreated(window);
    await applyWindowPlacement(window, placement);
    await focusExistingWindow(window);
  })().finally(() => {
    if (pendingMacroLabOpens.get(windowLabel) === openPromise) {
      pendingMacroLabOpens.delete(windowLabel);
    }
  });

  pendingMacroLabOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openOrganizationSetupWindow(): Promise<void> {
  const windowLabel = "organization-setup";
  const pendingOpen = pendingOrganizationSetupOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    const placement = await resolveOrganizationSetupWindowOptions();
    const existing = await WebviewWindow.getByLabel(windowLabel);
    if (existing) {
      await applyWindowPlacement(existing, placement);
      await focusExistingWindow(existing);
      return;
    }

    const window = new WebviewWindow(windowLabel, {
      url: buildWindowContextUrl({
        kind: "organization-setup"
      }),
      title: "FlowCell - Setup Organization",
      width: placement.width,
      height: placement.height,
      x: placement.x,
      y: placement.y,
      minWidth: 820,
      minHeight: 640,
      resizable: true,
      decorations: false,
      transparent: false,
      shadow: true,
      visible: true,
      focus: true,
      alwaysOnTop: false
    });

    await waitForWindowCreated(window);
    await applyWindowPlacement(window, placement);
    await focusExistingWindow(window);
  })().finally(() => {
    if (pendingOrganizationSetupOpens.get(windowLabel) === openPromise) {
      pendingOrganizationSetupOpens.delete(windowLabel);
    }
  });

  pendingOrganizationSetupOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openBuildLayersWindow(args: {
  programName: string;
  panelName: string;
  label?: string;
}): Promise<void> {
  const windowLabel = "flowcell-build-layers";
  const pendingOpen = pendingBuildLayersOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    const currentWindow = getCurrentWindow();
    const scaleFactor = await currentWindow.scaleFactor().catch(() => 1);
    const [position, size] = await Promise.all([
      currentWindow.outerPosition().catch(() => null),
      currentWindow.innerSize().catch(() => null)
    ]);
    const placement = {
      width: BUILD_LAYERS_WINDOW_WIDTH,
      height: BUILD_LAYERS_WINDOW_HEIGHT,
      x: undefined as number | undefined,
      y: undefined as number | undefined
    };
    if (position && size) {
      const logicalLeft = position.x / scaleFactor;
      const logicalTop = position.y / scaleFactor;
      const logicalWidth = size.width / scaleFactor;
      placement.x = logicalLeft + Math.max(logicalWidth - placement.width - 24, 24);
      placement.y = logicalTop + 24;
    }

    const existing = await WebviewWindow.getByLabel(windowLabel);
    if (existing) {
      await existing.setDecorations(false).catch(() => {});
      await applyProgramScopedTopmost(windowLabel, args.programName);
      await focusExistingWindow(existing);
      return;
    }

    const window = new WebviewWindow(windowLabel, {
      url: buildWindowContextUrl({
        kind: "build-layers",
        programName: args.programName,
        panelName: args.panelName,
        label: args.label
      }),
      title: "FlowCell - Layers Builder",
      width: placement.width,
      height: placement.height,
      x: placement.x,
      y: placement.y,
      minWidth: 240,
      minHeight: 300,
      resizable: true,
      decorations: false,
      transparent: false,
      shadow: true,
      visible: true,
      focus: true,
      alwaysOnTop: false
    });

    await waitForWindowCreated(window);
    await window.setDecorations(false).catch(() => {});
    await applyProgramScopedTopmost(windowLabel, args.programName);
    if (typeof placement.x === "number" && typeof placement.y === "number") {
      await window.setPosition(placementPosition(placement)).catch(() => {});
    }
    await focusExistingWindow(window);
  })().finally(() => {
    if (pendingBuildLayersOpens.get(windowLabel) === openPromise) {
      pendingBuildLayersOpens.delete(windowLabel);
    }
  });

  pendingBuildLayersOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openWindowGridWindow(): Promise<void> {
  const windowLabel = "flowcell-window-grid";
  const pendingOpen = pendingWindowGridOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    const existing = await WebviewWindow.getByLabel(windowLabel);
    if (existing) {
      await existing.setDecorations(false).catch(() => {});
      await focusExistingWindow(existing);
      return;
    }

    const currentWindow = getCurrentWindow();
    const scaleFactor = await currentWindow.scaleFactor().catch(() => 1);
    const [position, size] = await Promise.all([
      currentWindow.outerPosition().catch(() => null),
      currentWindow.innerSize().catch(() => null)
    ]);
    const width = 760;
    const height = 540;
    let x: number | undefined;
    let y: number | undefined;
    if (position && size) {
      const logicalLeft = position.x / scaleFactor;
      const logicalTop = position.y / scaleFactor;
      const logicalWidth = size.width / scaleFactor;
      const logicalHeight = size.height / scaleFactor;
      x = logicalLeft + Math.max((logicalWidth - width) / 2, 24);
      y = logicalTop + Math.max((logicalHeight - height) / 2, 24);
    }

    const window = new WebviewWindow(windowLabel, {
      url: buildWindowContextUrl({ kind: "window-grid" }),
      title: "FlowCell - Windows",
      width,
      height,
      x,
      y,
      minWidth: 360,
      minHeight: 280,
      resizable: true,
      decorations: false,
      transparent: false,
      shadow: true,
      visible: true,
      focus: true,
      alwaysOnTop: false,
      skipTaskbar: true
    });

    await waitForWindowCreated(window);
    await window.setDecorations(false).catch(() => {});
    if (typeof x === "number" && typeof y === "number") {
      await window.setPosition(new LogicalPosition(x, y)).catch(() => {});
    }
    await focusExistingWindow(window);
  })().finally(() => {
    if (pendingWindowGridOpens.get(windowLabel) === openPromise) {
      pendingWindowGridOpens.delete(windowLabel);
    }
  });

  pendingWindowGridOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openAppearanceWindow(): Promise<void> {
  const windowLabel = "flowcell-appearance";
  const pendingOpen = pendingAppearanceOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    const existing = await WebviewWindow.getByLabel(windowLabel);
    if (existing) {
      await existing.setDecorations(false).catch(() => {});
      await focusExistingWindow(existing);
      return;
    }

    const currentWindow = getCurrentWindow();
    const scaleFactor = await currentWindow.scaleFactor().catch(() => 1);
    const [position, size] = await Promise.all([
      currentWindow.outerPosition().catch(() => null),
      currentWindow.innerSize().catch(() => null)
    ]);
    const width = APPEARANCE_WINDOW_WIDTH;
    const height = APPEARANCE_WINDOW_HEIGHT;
    let x: number | undefined;
    let y: number | undefined;
    if (position && size) {
      const logicalLeft = position.x / scaleFactor;
      const logicalTop = position.y / scaleFactor;
      const logicalWidth = size.width / scaleFactor;
      const logicalHeight = size.height / scaleFactor;
      x = logicalLeft + Math.max((logicalWidth - width) / 2, 24);
      y = logicalTop + Math.max((logicalHeight - height) / 2, 24);
    }

    const window = new WebviewWindow(windowLabel, {
      url: buildWindowContextUrl({ kind: "appearance" }),
      title: "FlowCell - Appearance",
      width,
      height,
      x,
      y,
      minWidth: 380,
      minHeight: 460,
      resizable: true,
      decorations: false,
      transparent: false,
      shadow: true,
      visible: true,
      focus: true,
      alwaysOnTop: false
    });

    await waitForWindowCreated(window);
    await window.setDecorations(false).catch(() => {});
    if (typeof x === "number" && typeof y === "number") {
      await window.setPosition(new LogicalPosition(x, y)).catch(() => {});
    }
    await focusExistingWindow(window);
  })().finally(() => {
    if (pendingAppearanceOpens.get(windowLabel) === openPromise) {
      pendingAppearanceOpens.delete(windowLabel);
    }
  });

  pendingAppearanceOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openAppearanceHubWindow(): Promise<void> {
  const windowLabel = "flowcell-appearance-hub";
  const pendingOpen = pendingAppearanceHubOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    const existing = await WebviewWindow.getByLabel(windowLabel);
    if (existing) {
      await existing.setDecorations(false).catch(() => {});
      await focusExistingWindow(existing);
      return;
    }

    const currentWindow = getCurrentWindow();
    const scaleFactor = await currentWindow.scaleFactor().catch(() => 1);
    const [position, size] = await Promise.all([
      currentWindow.outerPosition().catch(() => null),
      currentWindow.innerSize().catch(() => null)
    ]);
    const width = APPEARANCE_HUB_WINDOW_WIDTH;
    const height = APPEARANCE_HUB_WINDOW_HEIGHT;
    let x: number | undefined;
    let y: number | undefined;
    if (position && size) {
      const logicalLeft = position.x / scaleFactor;
      const logicalTop = position.y / scaleFactor;
      const logicalWidth = size.width / scaleFactor;
      const logicalHeight = size.height / scaleFactor;
      x = logicalLeft + Math.max((logicalWidth - width) / 2, 24);
      y = logicalTop + Math.max((logicalHeight - height) / 2, 24);
    }

    const window = new WebviewWindow(windowLabel, {
      url: buildWindowContextUrl({ kind: "appearance-hub" }),
      title: "FlowCell - Appearance Hub",
      width,
      height,
      x,
      y,
      minWidth: 720,
      minHeight: 480,
      resizable: true,
      decorations: false,
      transparent: false,
      shadow: true,
      visible: true,
      focus: true,
      alwaysOnTop: false,
      maximized: true
    });

    await waitForWindowCreated(window);
    await window.setDecorations(false).catch(() => {});
    await window.maximize().catch(() => {});
    await focusExistingWindow(window);
  })().finally(() => {
    if (pendingAppearanceHubOpens.get(windowLabel) === openPromise) {
      pendingAppearanceHubOpens.delete(windowLabel);
    }
  });

  pendingAppearanceHubOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openScriptGroupPopoutWindow(args: {
  programName: string;
  panelName: string;
  scripts: ScriptGroupPopoutScript[];
  popoutType: ScriptGroupPopoutType;
  label: string;
  bounds?: FlowCellBounds | null;
}): Promise<void> {
  const baseWindowLabel = [
    "script-group-popout",
    sanitizeWindowToken(args.programName),
    sanitizeWindowToken(args.panelName)
  ].join("-");
  const windowLabel = buildDuplicateWindowLabel(baseWindowLabel);

  const pendingOpen = pendingScriptGroupPopoutOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    const effectivePopoutType: ScriptGroupPopoutType =
      args.scripts.length === 1
        ? "single"
        : args.popoutType === "single"
          ? DEFAULT_SCRIPT_GROUP_POPOUT_TYPE
          : args.popoutType;
    const placement = applyDuplicateWindowCascade(
      baseWindowLabel,
      await resolveSavedBoundsPlacement(
        await resolveScriptGroupPopoutWindowOptions(args.scripts.length, effectivePopoutType),
        args.bounds,
        { useDefaultSize: effectivePopoutType === "single" }
      ),
      args.bounds
    );

    registerLayoutWindow({
      windowLabel,
      kind: "script-group-popout",
      programName: args.programName,
      panelName: args.panelName,
      label: args.label,
      selectedFileNames: args.scripts.map((script) => script.fileName)
    });

    const window = new WebviewWindow(windowLabel, {
      url: buildWindowContextUrl({
        kind: "script-group-popout",
        programName: args.programName,
        panelName: args.panelName,
        scripts: args.scripts,
        popoutType: effectivePopoutType,
        label: args.label
      }),
      title: `FlowCell - ${args.label}`,
      width: placement.width,
      height: placement.height,
      x: placement.x,
      y: placement.y,
      resizable: true,
      decorations: false,
      transparent: true,
      backgroundColor: TRANSPARENT_WINDOW_BACKGROUND,
      shadow: false,
      visible: false,
      focus: true,
      alwaysOnTop: false
    });

    await waitForWindowCreated(window);
    await applyRotateToolboxWindowChrome(window);
    await applyProgramScopedTopmost(windowLabel, args.programName);
    await applyWindowPlacement(window, placement);
    await focusExistingWindow(window);
  })().finally(() => {
    if (pendingScriptGroupPopoutOpens.get(windowLabel) === openPromise) {
      pendingScriptGroupPopoutOpens.delete(windowLabel);
    }
  });

  pendingScriptGroupPopoutOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openCodexUsagePopoutWindow(args: {
  programName: string;
  panelName: string;
  bounds?: FlowCellBounds | null;
}): Promise<void> {
  const baseWindowLabel = [
    "codex-usage-popout",
    sanitizeWindowToken(args.programName),
    sanitizeWindowToken(args.panelName)
  ].join("-");
  const windowLabel = buildDuplicateWindowLabel(baseWindowLabel);

  const pendingOpen = pendingCodexUsagePopoutOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    const initialSnapshot = await getCodexUsageSnapshot().catch(() => null);
    const placement = applyDuplicateWindowCascade(
      baseWindowLabel,
      await resolveSavedBoundsPlacement(
        await resolveCodexUsagePopoutWindowOptions(),
        args.bounds
      ),
      args.bounds
    );

    registerLayoutWindow({
      windowLabel,
      kind: "codex-usage-popout",
      programName: args.programName,
      panelName: args.panelName,
      label: "Codex Usage"
    });

    const window = new WebviewWindow(windowLabel, {
      url: buildWindowContextUrl({
        kind: "codex-usage-popout",
        programName: args.programName,
        panelName: args.panelName,
        label: "Codex Usage",
        initialSnapshot
      }),
      title: "FlowCell - Codex Usage",
      width: placement.width,
      height: placement.height,
      x: placement.x,
      y: placement.y,
      resizable: true,
      decorations: false,
      transparent: true,
      shadow: false,
      visible: true,
      focus: true,
      alwaysOnTop: false
    });

    await waitForWindowCreated(window);
    await applyRotateToolboxWindowChrome(window);
    await applyProgramScopedTopmost(windowLabel, args.programName);
    await applyWindowPlacement(window, placement);
    await focusExistingWindow(window);
  })().finally(() => {
    if (pendingCodexUsagePopoutOpens.get(windowLabel) === openPromise) {
      pendingCodexUsagePopoutOpens.delete(windowLabel);
    }
  });

  pendingCodexUsagePopoutOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openGenericToolboxWindow(args: {
  programName: string;
  panelName: string;
  fileName: string;
  label: string;
  bounds?: FlowCellBounds | null;
}): Promise<void> {
  const windowLabel = [
    "generic-toolbox",
    sanitizeWindowToken(args.programName),
    sanitizeWindowToken(args.panelName),
    sanitizeWindowToken(args.fileName)
  ].join("-");

  const pendingOpen = pendingGenericToolboxOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    try {
      const placement = await resolveSavedBoundsPlacement(
        await resolveGenericToolboxWindowOptions(),
        args.bounds
      );
      registerLayoutWindow({
        windowLabel,
        kind: "generic-toolbox",
        programName: args.programName,
        panelName: args.panelName,
        fileName: args.fileName,
        label: args.label
      });
      const existing = await WebviewWindow.getByLabel(windowLabel);
      if (existing) {
        await applyGenericToolboxWindowChrome(existing);
        await applyProgramScopedTopmost(windowLabel, args.programName);
        await applyWindowPlacement(existing, placement);
        await showWindowWithoutFocus(existing);
        return;
      }

      const window = new WebviewWindow(windowLabel, {
        url: buildWindowContextUrl({
          kind: "generic-toolbox",
          programName: args.programName,
          panelName: args.panelName,
          fileName: args.fileName,
          label: args.label
        }),
        title: `FlowCell - ${args.label}`,
        width: placement.width,
        height: placement.height,
        x: placement.x,
        y: placement.y,
        resizable: true,
        decorations: false,
        transparent: true,
        shadow: false,
        visible: true,
        focus: false,
        alwaysOnTop: false
      });

      await waitForWindowCreated(window);
      await applyGenericToolboxWindowChrome(window);
      await applyProgramScopedTopmost(windowLabel, args.programName);
      await applyWindowPlacement(window, placement);
      await showWindowWithoutFocus(window);
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("Failed to open generic toolbox window.", error);
      window.alert(`Toolbox failed to open.\n\n${detail}`);
    }
  })().finally(() => {
    if (pendingGenericToolboxOpens.get(windowLabel) === openPromise) {
      pendingGenericToolboxOpens.delete(windowLabel);
    }
  });

  pendingGenericToolboxOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openThemeToolboxWindow(args: {
  programName: string;
  panelName: string;
  fileName: string;
  label: string;
  bounds?: FlowCellBounds | null;
}): Promise<void> {
  const windowLabel = [
    "theme-toolbox",
    sanitizeWindowToken(args.programName),
    sanitizeWindowToken(args.panelName),
    sanitizeWindowToken(args.fileName)
  ].join("-");

  const pendingOpen = pendingThemeToolboxOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    try {
      const placement = await resolveSavedBoundsPlacement(
        await resolveThemeToolboxWindowOptions(),
        args.bounds
      );
      registerLayoutWindow({
        windowLabel,
        kind: "theme-toolbox",
        programName: args.programName,
        panelName: args.panelName,
        fileName: args.fileName,
        label: args.label
      });
      const existing = await WebviewWindow.getByLabel(windowLabel);
      if (existing) {
        await applyGenericToolboxWindowChrome(existing);
        await applyProgramScopedTopmost(windowLabel, args.programName);
        await applyWindowPlacement(existing, placement);
        await showWindowWithoutFocus(existing);
        return;
      }

      const window = new WebviewWindow(windowLabel, {
        url: buildWindowContextUrl({
          kind: "theme-toolbox",
          programName: args.programName,
          panelName: args.panelName,
          fileName: args.fileName,
          label: args.label
        }),
        title: `FlowCell - ${args.label}`,
        width: placement.width,
        height: placement.height,
        x: placement.x,
        y: placement.y,
        resizable: true,
        decorations: false,
        transparent: true,
        shadow: false,
        visible: true,
        focus: false,
        alwaysOnTop: false
      });

      await waitForWindowCreated(window);
      await applyGenericToolboxWindowChrome(window);
      await applyProgramScopedTopmost(windowLabel, args.programName);
      await applyWindowPlacement(window, placement);
      await showWindowWithoutFocus(window);
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("Failed to open theme toolbox window.", error);
      window.alert(`Theme toolbox failed to open.\n\n${detail}`);
    }
  })().finally(() => {
    if (pendingThemeToolboxOpens.get(windowLabel) === openPromise) {
      pendingThemeToolboxOpens.delete(windowLabel);
    }
  });

  pendingThemeToolboxOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openFlattenRevolveToolboxWindow(args: {
  programName: string;
  panelName: string;
  fileName: string;
  label: string;
  bounds?: FlowCellBounds | null;
}): Promise<void> {
  const windowLabel = [
    "flatten-revolve-toolbox",
    sanitizeWindowToken(args.programName),
    sanitizeWindowToken(args.panelName),
    sanitizeWindowToken(args.fileName)
  ].join("-");

  const pendingOpen = pendingFlattenRevolveToolboxOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    try {
      const placement = await resolveSavedBoundsPlacement(
        await resolveFlattenRevolveToolboxWindowOptions(),
        args.bounds
      );
      registerLayoutWindow({
        windowLabel,
        kind: "flatten-revolve-toolbox",
        programName: args.programName,
        panelName: args.panelName,
        fileName: args.fileName,
        label: args.label
      });
      const existing = await WebviewWindow.getByLabel(windowLabel);
      if (existing) {
        await applyGenericToolboxWindowChrome(existing);
        await applyProgramScopedTopmost(windowLabel, args.programName);
        await applyWindowPlacement(existing, placement);
        await showWindowWithoutFocus(existing);
        return;
      }

      const window = new WebviewWindow(windowLabel, {
        url: buildWindowContextUrl({
          kind: "flatten-revolve-toolbox",
          programName: args.programName,
          panelName: args.panelName,
          fileName: args.fileName,
          label: args.label
        }),
        title: `FlowCell - ${args.label}`,
        width: placement.width,
        height: placement.height,
        x: placement.x,
        y: placement.y,
        resizable: true,
        decorations: false,
        transparent: true,
        shadow: false,
        visible: true,
        focus: false,
        alwaysOnTop: false
      });

      await waitForWindowCreated(window);
      await applyGenericToolboxWindowChrome(window);
      await applyProgramScopedTopmost(windowLabel, args.programName);
      await applyWindowPlacement(window, placement);
      await showWindowWithoutFocus(window);
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("Failed to open flatten revolve toolbox window.", error);
      window.alert(`Flatten revolve toolbox failed to open.\n\n${detail}`);
    }
  })().finally(() => {
    if (pendingFlattenRevolveToolboxOpens.get(windowLabel) === openPromise) {
      pendingFlattenRevolveToolboxOpens.delete(windowLabel);
    }
  });

  pendingFlattenRevolveToolboxOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openRotateToolboxWindow(args: {
  programName: string;
  panelName: string;
  fileName: string;
  label: string;
  bounds?: FlowCellBounds | null;
}): Promise<void> {
  const windowLabel = [
    "rotate-toolbox",
    sanitizeWindowToken(args.programName),
    sanitizeWindowToken(args.panelName),
    sanitizeWindowToken(args.fileName)
  ].join("-");

  const pendingOpen = pendingRotateToolboxOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    try {
      const placement = await resolveSavedBoundsPlacement(
        await resolveRotateToolboxWindowOptions(args.programName),
        args.bounds
      );
      registerLayoutWindow({
        windowLabel,
        kind: "rotate-toolbox",
        programName: args.programName,
        panelName: args.panelName,
        fileName: args.fileName,
        label: args.label
      });
      const existing = await WebviewWindow.getByLabel(windowLabel);
      if (existing) {
        await applyGenericToolboxWindowChrome(existing);
        await applyProgramScopedTopmost(windowLabel, args.programName);
        await applyWindowPlacement(existing, placement);
        await showWindowWithoutFocus(existing);
        return;
      }

      const window = new WebviewWindow(windowLabel, {
        url: buildWindowContextUrl({
          kind: "rotate-toolbox",
          programName: args.programName,
          panelName: args.panelName,
          fileName: args.fileName,
          label: args.label
        }),
        title: `FlowCell - ${args.label}`,
        width: placement.width,
        height: placement.height,
        x: placement.x,
        y: placement.y,
        resizable: true,
        decorations: false,
        transparent: true,
        shadow: false,
        visible: true,
        focus: false,
        alwaysOnTop: false
      });

      await waitForWindowCreated(window);
      await applyGenericToolboxWindowChrome(window);
      await applyProgramScopedTopmost(windowLabel, args.programName);
      await applyWindowPlacement(window, placement);
      await showWindowWithoutFocus(window);
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("Failed to open rotate toolbox window.", error);
      window.alert(`Rotate toolbox failed to open.\n\n${detail}`);
    }
  })().finally(() => {
    if (pendingRotateToolboxOpens.get(windowLabel) === openPromise) {
      pendingRotateToolboxOpens.delete(windowLabel);
    }
  });

  pendingRotateToolboxOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openSmartAxisToolboxWindow(args: {
  programName: string;
  panelName: string;
  fileName: string;
  label: string;
  bounds?: FlowCellBounds | null;
  forceRecreate?: boolean;
}): Promise<void> {
  const windowLabel = [
    "smart-axis-toolbox",
    sanitizeWindowToken(args.programName),
    sanitizeWindowToken(args.panelName),
    sanitizeWindowToken(args.fileName)
  ].join("-");

  const pendingOpen = pendingSmartAxisToolboxOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    try {
      const windowContext = {
        kind: "smart-axis-toolbox" as const,
        programName: args.programName,
        panelName: args.panelName,
        fileName: args.fileName,
        label: args.label
      };
      const placement = await resolveSavedBoundsPlacement(
        await resolveSmartAxisToolboxWindowOptions(),
        args.bounds
      );
      registerLayoutWindow({
        windowLabel,
        kind: "smart-axis-toolbox",
        programName: args.programName,
        panelName: args.panelName,
        fileName: args.fileName,
        label: args.label
      });
      const existing = await WebviewWindow.getByLabel(windowLabel);
      if (existing) {
        if (args.forceRecreate) {
          await closeWindowAndWaitForRelease(windowLabel, existing);
        } else {
          await applyGenericToolboxWindowChrome(existing);
          await applyProgramScopedTopmost(windowLabel, args.programName);
          await applyWindowPlacement(existing, placement);
          await showWindowWithoutFocus(existing);
          return;
        }
      }

      const reopenedExisting = await WebviewWindow.getByLabel(windowLabel);
      if (reopenedExisting) {
        await applyGenericToolboxWindowChrome(reopenedExisting);
        await applyProgramScopedTopmost(windowLabel, args.programName);
        await applyWindowPlacement(reopenedExisting, placement);
        await showWindowWithoutFocus(reopenedExisting);
        return;
      }

      const window = new WebviewWindow(windowLabel, {
        url: buildWindowContextUrl(windowContext),
        title: `FlowCell - ${args.label}`,
        width: placement.width,
        height: placement.height,
        x: placement.x,
        y: placement.y,
        resizable: true,
        decorations: false,
        transparent: true,
        shadow: false,
        visible: true,
        focus: false,
        alwaysOnTop: false
      });

      await waitForWindowCreated(window);
      await applyGenericToolboxWindowChrome(window);
      await applyProgramScopedTopmost(windowLabel, args.programName);
      await applyWindowPlacement(window, placement);
      await showWindowWithoutFocus(window);
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("Failed to open Smart Axis toolbox window.", error);
      window.alert(`Smart Axis toolbox failed to open.\n\n${detail}`);
    }
  })().finally(() => {
    if (pendingSmartAxisToolboxOpens.get(windowLabel) === openPromise) {
      pendingSmartAxisToolboxOpens.delete(windowLabel);
    }
  });

  pendingSmartAxisToolboxOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openAlignmentToolboxWindow(args: {
  programName: string;
  panelName: string;
  fileName: string;
  label: string;
  bounds?: FlowCellBounds | null;
}): Promise<void> {
  const windowLabel = [
    "alignment-toolbox",
    sanitizeWindowToken(args.programName),
    sanitizeWindowToken(args.panelName),
    sanitizeWindowToken(args.fileName)
  ].join("-");

  const pendingOpen = pendingAlignmentToolboxOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    try {
      const placement = await resolveSavedBoundsPlacement(
        await resolveAlignmentToolboxWindowOptions(args.programName),
        args.bounds
      );
      registerLayoutWindow({
        windowLabel,
        kind: "alignment-toolbox",
        programName: args.programName,
        panelName: args.panelName,
        fileName: args.fileName,
        label: args.label
      });
      const existing = await WebviewWindow.getByLabel(windowLabel);
      if (existing) {
        await applyGenericToolboxWindowChrome(existing);
        await applyProgramScopedTopmost(windowLabel, args.programName);
        await applyWindowPlacement(existing, placement);
        await showWindowWithoutFocus(existing);
        return;
      }

      const window = new WebviewWindow(windowLabel, {
        url: buildWindowContextUrl({
          kind: "alignment-toolbox",
          programName: args.programName,
          panelName: args.panelName,
          fileName: args.fileName,
          label: args.label
        }),
        title: `FlowCell - ${args.label}`,
        width: placement.width,
        height: placement.height,
        x: placement.x,
        y: placement.y,
        resizable: true,
        decorations: false,
        transparent: true,
        shadow: false,
        visible: true,
        focus: false,
        alwaysOnTop: false
      });

      await waitForWindowCreated(window);
      await applyGenericToolboxWindowChrome(window);
      await applyProgramScopedTopmost(windowLabel, args.programName);
      await applyWindowPlacement(window, placement);
      await showWindowWithoutFocus(window);
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("Failed to open alignment toolbox window.", error);
      window.alert(`Alignment toolbox failed to open.\n\n${detail}`);
    }
  })().finally(() => {
    if (pendingAlignmentToolboxOpens.get(windowLabel) === openPromise) {
      pendingAlignmentToolboxOpens.delete(windowLabel);
    }
  });

  pendingAlignmentToolboxOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openBooleanToolboxWindow(args: {
  programName: string;
  panelName: string;
  fileName: string;
  label: string;
  bounds?: FlowCellBounds | null;
}): Promise<void> {
  const windowLabel = [
    "boolean-toolbox",
    sanitizeWindowToken(args.programName),
    sanitizeWindowToken(args.panelName),
    sanitizeWindowToken(args.fileName)
  ].join("-");

  const pendingOpen = pendingBooleanToolboxOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    try {
      const placement = await resolveSavedBoundsPlacement(
        await resolveBooleanToolboxWindowOptions(),
        args.bounds
      );
      registerLayoutWindow({
        windowLabel,
        kind: "boolean-toolbox",
        programName: args.programName,
        panelName: args.panelName,
        fileName: args.fileName,
        label: args.label
      });
      const existing = await WebviewWindow.getByLabel(windowLabel);
      if (existing) {
        await applyGenericToolboxWindowChrome(existing);
        await applyProgramScopedTopmost(windowLabel, args.programName);
        await applyWindowPlacement(existing, placement);
        await showWindowWithoutFocus(existing);
        return;
      }

      const window = new WebviewWindow(windowLabel, {
        url: buildWindowContextUrl({
          kind: "boolean-toolbox",
          programName: args.programName,
          panelName: args.panelName,
          fileName: args.fileName,
          label: args.label
        }),
        title: `FlowCell - ${args.label}`,
        width: placement.width,
        height: placement.height,
        x: placement.x,
        y: placement.y,
        resizable: true,
        decorations: false,
        transparent: true,
        shadow: false,
        visible: true,
        focus: false,
        alwaysOnTop: false
      });

      await waitForWindowCreated(window);
      await applyGenericToolboxWindowChrome(window);
      await applyProgramScopedTopmost(windowLabel, args.programName);
      await applyWindowPlacement(window, placement);
      await showWindowWithoutFocus(window);
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("Failed to open Boolean toolbox window.", error);
      window.alert(`Boolean toolbox failed to open.\n\n${detail}`);
    }
  })().finally(() => {
    if (pendingBooleanToolboxOpens.get(windowLabel) === openPromise) {
      pendingBooleanToolboxOpens.delete(windowLabel);
    }
  });

  pendingBooleanToolboxOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openDimensionsToolboxWindow(args: {
  programName: string;
  panelName: string;
  fileName: string;
  label: string;
  bounds?: FlowCellBounds | null;
}): Promise<void> {
  const windowLabel = [
    "dimensions-toolbox",
    sanitizeWindowToken(args.programName),
    sanitizeWindowToken(args.panelName),
    sanitizeWindowToken(args.fileName)
  ].join("-");

  const pendingOpen = pendingDimensionsToolboxOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    try {
      const placement = await resolveSavedBoundsPlacement(
        await resolveDimensionsToolboxWindowOptions(),
        args.bounds
      );
      registerLayoutWindow({
        windowLabel,
        kind: "dimensions-toolbox",
        programName: args.programName,
        panelName: args.panelName,
        fileName: args.fileName,
        label: args.label
      });
      const existing = await WebviewWindow.getByLabel(windowLabel);
      if (existing) {
        await applyGenericToolboxWindowChrome(existing);
        await applyProgramScopedTopmost(windowLabel, args.programName);
        await applyWindowPlacement(existing, placement);
        await showWindowWithoutFocus(existing);
        return;
      }

      const window = new WebviewWindow(windowLabel, {
        url: buildWindowContextUrl({
          kind: "dimensions-toolbox",
          programName: args.programName,
          panelName: args.panelName,
          fileName: args.fileName,
          label: args.label
        }),
        title: `FlowCell - ${args.label}`,
        width: placement.width,
        height: placement.height,
        x: placement.x,
        y: placement.y,
        resizable: true,
        decorations: false,
        transparent: true,
        shadow: false,
        visible: true,
        focus: false,
        alwaysOnTop: false
      });

      await waitForWindowCreated(window);
      await applyGenericToolboxWindowChrome(window);
      await applyProgramScopedTopmost(windowLabel, args.programName);
      await applyWindowPlacement(window, placement);
      await showWindowWithoutFocus(window);
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("Failed to open XYZ Dimensions toolbox window.", error);
      window.alert(`XYZ Dimensions toolbox failed to open.\n\n${detail}`);
    }
  })().finally(() => {
    if (pendingDimensionsToolboxOpens.get(windowLabel) === openPromise) {
      pendingDimensionsToolboxOpens.delete(windowLabel);
    }
  });

  pendingDimensionsToolboxOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openRemeshToolboxWindow(args: {
  programName: string;
  panelName: string;
  fileName: string;
  label: string;
  bounds?: FlowCellBounds | null;
}): Promise<void> {
  const windowLabel = [
    "remesh-toolbox",
    sanitizeWindowToken(args.programName),
    sanitizeWindowToken(args.panelName),
    sanitizeWindowToken(args.fileName)
  ].join("-");

  const pendingOpen = pendingRemeshToolboxOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    try {
      const placement = await resolveSavedBoundsPlacement(
        await resolveRemeshToolboxWindowOptions(),
        args.bounds
      );
      registerLayoutWindow({
        windowLabel,
        kind: "remesh-toolbox",
        programName: args.programName,
        panelName: args.panelName,
        fileName: args.fileName,
        label: args.label
      });
      const existing = await WebviewWindow.getByLabel(windowLabel);
      if (existing) {
        await applyGenericToolboxWindowChrome(existing);
        await applyProgramScopedTopmost(windowLabel, args.programName);
        await applyWindowPlacement(existing, placement);
        await showWindowWithoutFocus(existing);
        return;
      }

      const window = new WebviewWindow(windowLabel, {
        url: buildWindowContextUrl({
          kind: "remesh-toolbox",
          programName: args.programName,
          panelName: args.panelName,
          fileName: args.fileName,
          label: args.label
        }),
        title: `FlowCell - ${args.label}`,
        width: placement.width,
        height: placement.height,
        x: placement.x,
        y: placement.y,
        resizable: true,
        decorations: false,
        transparent: true,
        shadow: false,
        visible: true,
        focus: false,
        alwaysOnTop: false
      });

      await waitForWindowCreated(window);
      await applyGenericToolboxWindowChrome(window);
      await applyProgramScopedTopmost(windowLabel, args.programName);
      await applyWindowPlacement(window, placement);
      await showWindowWithoutFocus(window);
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("Failed to open Remesh toolbox window.", error);
      window.alert(`Remesh toolbox failed to open.\n\n${detail}`);
    }
  })().finally(() => {
    if (pendingRemeshToolboxOpens.get(windowLabel) === openPromise) {
      pendingRemeshToolboxOpens.delete(windowLabel);
    }
  });

  pendingRemeshToolboxOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openTriPolyToolboxWindow(args: {
  programName: string;
  panelName: string;
  fileName: string;
  label: string;
  bounds?: FlowCellBounds | null;
}): Promise<void> {
  const windowLabel = [
    "tri-poly-toolbox",
    sanitizeWindowToken(args.programName),
    sanitizeWindowToken(args.panelName),
    sanitizeWindowToken(args.fileName)
  ].join("-");

  const pendingOpen = pendingTriPolyToolboxOpens.get(windowLabel);
  if (pendingOpen) {
    return pendingOpen;
  }

  const openPromise = (async () => {
    try {
      const placement = await resolveSavedBoundsPlacement(
        await resolveTriPolyToolboxWindowOptions(),
        args.bounds
      );
      registerLayoutWindow({
        windowLabel,
        kind: "tri-poly-toolbox",
        programName: args.programName,
        panelName: args.panelName,
        fileName: args.fileName,
        label: args.label
      });
      const existing = await WebviewWindow.getByLabel(windowLabel);
      if (existing) {
        await applyGenericToolboxWindowChrome(existing);
        await applyProgramScopedTopmost(windowLabel, args.programName);
        await applyWindowPlacement(existing, placement);
        await showWindowWithoutFocus(existing);
        return;
      }

      const window = new WebviewWindow(windowLabel, {
        url: buildWindowContextUrl({
          kind: "tri-poly-toolbox",
          programName: args.programName,
          panelName: args.panelName,
          fileName: args.fileName,
          label: args.label
        }),
        title: `FlowCell - ${args.label}`,
        width: placement.width,
        height: placement.height,
        x: placement.x,
        y: placement.y,
        resizable: true,
        decorations: false,
        transparent: true,
        shadow: false,
        visible: true,
        focus: false,
        alwaysOnTop: false
      });

      await waitForWindowCreated(window);
      await applyGenericToolboxWindowChrome(window);
      await applyProgramScopedTopmost(windowLabel, args.programName);
      await applyWindowPlacement(window, placement);
      await showWindowWithoutFocus(window);
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("Failed to open Tri & Poly toolbox window.", error);
      window.alert(`Tri & Poly toolbox failed to open.\n\n${detail}`);
    }
  })().finally(() => {
    if (pendingTriPolyToolboxOpens.get(windowLabel) === openPromise) {
      pendingTriPolyToolboxOpens.delete(windowLabel);
    }
  });

  pendingTriPolyToolboxOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function closeCurrentHostWindow(): Promise<void> {
  try {
    const currentWindow = getCurrentWindow();
    const label = currentWindow.label;
    await unregisterScopedWindowTopmost(label).catch(() => {});
    await setHostWindowTopmost(label, false).catch(() => {});
    await currentWindow.close();
  } catch {
    window.close();
  }
}

export async function reloadCurrentHostWindow(): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  try {
    await invoke("refresh_frontend_host");
  } catch (error) {
    console.error("Failed to refresh the FlowCell frontend host.", error);
    window.location.reload();
  }
}
