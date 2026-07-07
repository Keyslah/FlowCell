import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { buildWindowContextUrl } from "./windowContext";

export const FLOW_TOOLTIP_WINDOW_LABEL = "flowcell-tooltip";
export const FLOW_TOOLTIP_EVENT = "flowcell-tooltip:update";

const TOOLTIP_WIDTH = 420;
const TOOLTIP_HEIGHT = 96;
const TOOLTIP_GAP = 10;
const SCREEN_MARGIN = 8;
const TOOLTIP_SHOW_DELAY_MS = 2000;
const TOOLTIP_WINDOW_CREATE_TIMEOUT_MS = 800;
const TRANSPARENT_TOOLTIP_BACKGROUND: [number, number, number, number] = [0, 0, 0, 0];

export type FlowTooltipPayload = {
  text: string;
  visible: boolean;
};

let pendingTooltipWindow: Promise<WebviewWindow> | null = null;
let pendingShowTimer: number | undefined;
let activeTooltipRequestId = 0;

function clearPendingShowTimer(): void {
  if (pendingShowTimer === undefined) {
    return;
  }

  window.clearTimeout(pendingShowTimer);
  pendingShowTimer = undefined;
}

async function waitForTooltipWindowCreated(window: WebviewWindow): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeoutId = globalThis.window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error("FlowCell tooltip window timed out while opening."));
    }, TOOLTIP_WINDOW_CREATE_TIMEOUT_MS);

    void window.once("tauri://created", () => {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.window.clearTimeout(timeoutId);
      resolve();
    });

    void window.once("tauri://error", (event) => {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.window.clearTimeout(timeoutId);
      reject(event.payload);
    });
  });
}

async function applyTooltipWindowChrome(window: WebviewWindow): Promise<void> {
  await window.setDecorations(false).catch(() => {});
  await window.setShadow(false).catch(() => {});
  await window.setResizable(false).catch(() => {});
  await window.setAlwaysOnTop(true).catch(() => {});
  await window.setIgnoreCursorEvents(true).catch(() => {});

  const backgroundTarget = window as WebviewWindow & {
    setBackgroundColor?: (color: [number, number, number, number]) => Promise<void>;
  };
  if (typeof backgroundTarget.setBackgroundColor === "function") {
    await backgroundTarget.setBackgroundColor(TRANSPARENT_TOOLTIP_BACKGROUND).catch(() => {});
  }
}

async function getTooltipWindow(initialText: string): Promise<WebviewWindow> {
  const existing = await WebviewWindow.getByLabel(FLOW_TOOLTIP_WINDOW_LABEL);
  if (existing) {
    await applyTooltipWindowChrome(existing);
    return existing;
  }

  if (pendingTooltipWindow) {
    return pendingTooltipWindow;
  }

  pendingTooltipWindow = (async () => {
    const window = new WebviewWindow(FLOW_TOOLTIP_WINDOW_LABEL, {
      url: buildWindowContextUrl({
        kind: "tooltip",
        text: initialText
      }),
      title: "FlowCell Tooltip",
      width: TOOLTIP_WIDTH,
      height: TOOLTIP_HEIGHT,
      resizable: false,
      decorations: false,
      transparent: true,
      backgroundColor: TRANSPARENT_TOOLTIP_BACKGROUND,
      shadow: false,
      visible: false,
      focus: false,
      alwaysOnTop: true
    });

    await waitForTooltipWindowCreated(window);
    await applyTooltipWindowChrome(window);
    return window;
  })().finally(() => {
    pendingTooltipWindow = null;
  });

  return pendingTooltipWindow;
}

function clampScreenCoordinate(value: number): number {
  return Math.max(SCREEN_MARGIN, Math.round(value));
}

export async function showFlowTooltipForElement(
  text: string,
  element: HTMLElement
): Promise<void> {
  const trimmedText = text.trim();
  if (!trimmedText) {
    await hideFlowTooltip();
    return;
  }

  const requestId = activeTooltipRequestId + 1;
  activeTooltipRequestId = requestId;
  clearPendingShowTimer();
  void hideTooltipWindow();

  pendingShowTimer = window.setTimeout(() => {
    pendingShowTimer = undefined;
    void showFlowTooltipNow(trimmedText, element, requestId);
  }, TOOLTIP_SHOW_DELAY_MS);
}

async function showFlowTooltipNow(
  trimmedText: string,
  element: HTMLElement,
  requestId: number
): Promise<void> {
  if (requestId !== activeTooltipRequestId || !element.isConnected) {
    return;
  }

  let sourceWindow: ReturnType<typeof getCurrentWindow>;
  try {
    sourceWindow = getCurrentWindow();
  } catch {
    return;
  }

  const [position, scaleFactorRaw] = await Promise.all([
    sourceWindow.outerPosition().catch(() => null),
    sourceWindow.scaleFactor().catch(() => 1)
  ]);
  if (requestId !== activeTooltipRequestId || !element.isConnected) {
    return;
  }
  if (!position) {
    return;
  }

  const scaleFactor =
    Number.isFinite(scaleFactorRaw) && scaleFactorRaw > 0 ? scaleFactorRaw : 1;
  const rect = element.getBoundingClientRect();
  const windowLeft = position.x / scaleFactor;
  const windowTop = position.y / scaleFactor;
  const anchorX = windowLeft + rect.left + rect.width / 2;
  const topCandidate = windowTop + rect.top - TOOLTIP_HEIGHT - TOOLTIP_GAP;
  const belowCandidate = windowTop + rect.bottom + TOOLTIP_GAP;
  const nextX = clampScreenCoordinate(anchorX - TOOLTIP_WIDTH / 2);
  const nextY = clampScreenCoordinate(topCandidate > SCREEN_MARGIN ? topCandidate : belowCandidate);
  const tooltipWindow = await getTooltipWindow(trimmedText).catch(() => null);
  if (requestId !== activeTooltipRequestId || !element.isConnected) {
    return;
  }
  if (!tooltipWindow) {
    return;
  }

  await tooltipWindow
    .setPosition(new LogicalPosition(nextX, nextY))
    .catch(() => {});
  await tooltipWindow
    .setSize(new LogicalSize(TOOLTIP_WIDTH, TOOLTIP_HEIGHT))
    .catch(() => {});
  if (requestId !== activeTooltipRequestId || !element.isConnected) {
    await tooltipWindow.hide().catch(() => {});
    return;
  }
  await emitTo(FLOW_TOOLTIP_WINDOW_LABEL, FLOW_TOOLTIP_EVENT, {
    text: trimmedText,
    visible: true
  } satisfies FlowTooltipPayload).catch(() => {});
  await tooltipWindow.setAlwaysOnTop(true).catch(() => {});
  await tooltipWindow.show().catch(() => {});
}

async function hideTooltipWindow(): Promise<void> {
  const tooltipWindow = await WebviewWindow.getByLabel(FLOW_TOOLTIP_WINDOW_LABEL).catch(
    () => null
  );
  if (!tooltipWindow) {
    return;
  }

  await emitTo(FLOW_TOOLTIP_WINDOW_LABEL, FLOW_TOOLTIP_EVENT, {
    text: "",
    visible: false
  } satisfies FlowTooltipPayload).catch(() => {});
  await tooltipWindow.hide().catch(() => {});
}

export async function hideFlowTooltip(): Promise<void> {
  activeTooltipRequestId += 1;
  clearPendingShowTimer();
  await hideTooltipWindow();
}
