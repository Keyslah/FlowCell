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
const LOCAL_TOOLTIP_ID = "flowcell-local-tooltip";
const TOOLTIP_SHOW_DELAY_MS = 2000;
const TOOLTIP_WINDOW_CREATE_TIMEOUT_MS = 800;

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
    await backgroundTarget.setBackgroundColor([0, 0, 0, 0]).catch(() => {});
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

function clampLocalCoordinate(value: number, maxValue: number): number {
  return Math.max(SCREEN_MARGIN, Math.min(Math.round(value), Math.max(SCREEN_MARGIN, maxValue)));
}

function getLocalTooltipElement(): HTMLDivElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  const existing = document.getElementById(LOCAL_TOOLTIP_ID);
  if (existing instanceof HTMLDivElement) {
    return existing;
  }

  const element = document.createElement("div");
  element.id = LOCAL_TOOLTIP_ID;
  element.setAttribute("role", "tooltip");
  Object.assign(element.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: `${TOOLTIP_WIDTH}px`,
    minHeight: "32px",
    maxWidth: "calc(100vw - 16px)",
    padding: "8px 10px",
    border: "1px solid rgba(235, 244, 238, 0.42)",
    borderRadius: "8px",
    background: "rgba(6, 9, 10, 0.97)",
    boxShadow: "0 14px 30px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
    color: "rgba(248, 252, 249, 0.98)",
    font: '650 12px/1.25 "Segoe UI", sans-serif',
    letterSpacing: "0",
    textAlign: "center",
    overflowWrap: "anywhere",
    pointerEvents: "none",
    opacity: "0",
    transition: "opacity 60ms ease",
    zIndex: "2147483647"
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(element);
  return element;
}

function showLocalFlowTooltip(text: string, element: HTMLElement): void {
  const tooltip = getLocalTooltipElement();
  if (!tooltip) {
    return;
  }

  tooltip.textContent = text;
  tooltip.style.width = `${Math.min(TOOLTIP_WIDTH, Math.max(180, window.innerWidth - SCREEN_MARGIN * 2))}px`;
  tooltip.style.opacity = "0";
  tooltip.style.display = "block";

  const sourceRect = element.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const tooltipWidth = tooltipRect.width || TOOLTIP_WIDTH;
  const tooltipHeight = tooltipRect.height || 40;
  const anchorX = sourceRect.left + sourceRect.width / 2;
  const topCandidate = sourceRect.top - tooltipHeight - TOOLTIP_GAP;
  const belowCandidate = sourceRect.bottom + TOOLTIP_GAP;
  const nextX = clampLocalCoordinate(
    anchorX - tooltipWidth / 2,
    window.innerWidth - tooltipWidth - SCREEN_MARGIN
  );
  const nextY = clampLocalCoordinate(
    topCandidate > SCREEN_MARGIN ? topCandidate : belowCandidate,
    window.innerHeight - tooltipHeight - SCREEN_MARGIN
  );

  tooltip.style.left = `${nextX}px`;
  tooltip.style.top = `${nextY}px`;
  tooltip.style.opacity = "1";
}

function hideLocalFlowTooltip(): void {
  if (typeof document === "undefined") {
    return;
  }

  const tooltip = document.getElementById(LOCAL_TOOLTIP_ID);
  if (tooltip instanceof HTMLElement) {
    tooltip.style.opacity = "0";
    tooltip.style.display = "none";
  }
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
  hideLocalFlowTooltip();
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

  showLocalFlowTooltip(trimmedText, element);

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
  hideLocalFlowTooltip();
  await hideTooltipWindow();
}
