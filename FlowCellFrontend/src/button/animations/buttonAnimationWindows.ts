import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  getAllWindows,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
  Window as TauriWindow
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  buildWindowContextUrl,
  BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION,
  type ButtonAnimationWindowContext
} from "../../lib/windowContext";
import type {
  ButtonActivationAnimationPresetId,
  ButtonDesktopBounds,
  ButtonRecord
} from "../types";
import {
  getButtonAnimationAspectRatio,
  normalizeButtonAnimationDesktopBounds,
  normalizeButtonAnimationEditorBounds,
  resolveButtonAnimationPlaybackBounds
} from "./buttonActivationAnimations";

export const BUTTON_ANIMATION_PLAY_WINDOW_LABEL = "flowcell-button-animation";
export const BUTTON_ANIMATION_EDITOR_WINDOW_LABEL = "flowcell-button-animation-editor";

const BUTTON_ANIMATION_CONTEXT_EVENT = "flowcell:button-animation-context";
const BUTTON_ANIMATION_READY_EVENT = "flowcell:button-animation-ready";
const BUTTON_ANIMATION_PLAY_REQUEST_EVENT = "flowcell:button-animation-play-request";
const DEFAULT_ANIMATION_WINDOW_SIZE = 260;
const WINDOW_READY_TIMEOUT_MS = 10_000;
const BUTTON_EDITOR_COORDINATOR_LABEL = "flowcell-button-editor";

interface ButtonAnimationContextUpdate {
  windowLabel: string;
  context: ButtonAnimationWindowContext;
}

interface ButtonAnimationReadyUpdate {
  windowLabel: string;
}

interface ButtonAnimationPlayRequest {
  button: ButtonRecord;
}

const pendingOpens = new Map<string, Promise<void>>();
let requestSequence = 0;
let activeEditorPresetId: ButtonActivationAnimationPresetId = "plus-rise";

function createAnimationRequestId(): string {
  requestSequence += 1;
  return `${Date.now().toString(36)}-${requestSequence.toString(36)}`;
}

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  );
}

function isUsableDesktopBounds(
  bounds: ButtonDesktopBounds | null | undefined
): bounds is ButtonDesktopBounds {
  return Boolean(
    bounds &&
      Number.isFinite(bounds.left) &&
      Number.isFinite(bounds.top) &&
      Number.isFinite(bounds.width) &&
      Number.isFinite(bounds.height) &&
      bounds.width > 0 &&
      bounds.height > 0
  );
}

async function resolveDefaultBounds(
  presetId: ButtonActivationAnimationPresetId
): Promise<ButtonDesktopBounds> {
  const currentWindow = getCurrentWindow();
  const [position, size, scaleFactor] = await Promise.all([
    currentWindow.outerPosition().catch(() => null),
    currentWindow.innerSize().catch(() => null),
    currentWindow.scaleFactor().catch(() => 1)
  ]);
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const width = Math.round(DEFAULT_ANIMATION_WINDOW_SIZE * scale);
  const height = Math.round(width / getButtonAnimationAspectRatio(presetId));
  if (!position || !size) {
    return { left: 48, top: 48, width, height };
  }
  return normalizeButtonAnimationEditorBounds(presetId, {
    left: position.x + Math.max((size.width - width) / 2, 24 * scale),
    top: position.y + Math.max((size.height - height) / 2, 24 * scale),
    width,
    height
  });
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

async function createAnimationWindow(
  windowLabel: string,
  context: ButtonAnimationWindowContext
): Promise<WebviewWindow> {
  let resolveReady: (() => void) | null = null;
  let rejectReady: ((error: Error) => void) | null = null;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const unlisten = await listen<ButtonAnimationReadyUpdate>(
    BUTTON_ANIMATION_READY_EVENT,
    (event) => {
      if (event.payload?.windowLabel === windowLabel) {
        resolveReady?.();
      }
    }
  );
  const timeoutId = window.setTimeout(() => {
    rejectReady?.(new Error(`Button animation window '${windowLabel}' did not become ready.`));
  }, WINDOW_READY_TIMEOUT_MS);
  const target = new WebviewWindow(windowLabel, {
    url: buildWindowContextUrl(context),
    title: context.mode === "edit"
      ? "FlowCell - Button Animation Setup"
      : "FlowCell - Button Animation",
    width: DEFAULT_ANIMATION_WINDOW_SIZE,
    height: Math.round(
      DEFAULT_ANIMATION_WINDOW_SIZE / getButtonAnimationAspectRatio(context.presetId)
    ),
    resizable: false,
    decorations: false,
    transparent: true,
    shadow: false,
    visible: false,
    focus: context.mode === "edit",
    alwaysOnTop: true,
    skipTaskbar: true
  });
  try {
    await waitForWindowCreated(target);
    await readyPromise;
    return target;
  } finally {
    window.clearTimeout(timeoutId);
    unlisten();
  }
}

async function applyPhysicalBounds(
  target: TauriWindow,
  bounds: ButtonDesktopBounds
): Promise<void> {
  const normalized = normalizeButtonAnimationDesktopBounds(bounds);
  await target.setPosition(new PhysicalPosition(normalized.left, normalized.top));
  await target.setSize(new PhysicalSize(normalized.width, normalized.height));
}

async function readPhysicalBounds(target: TauriWindow): Promise<ButtonDesktopBounds> {
  const [position, size] = await Promise.all([
    target.outerPosition(),
    target.innerSize()
  ]);
  return normalizeButtonAnimationDesktopBounds({
    left: position.x,
    top: position.y,
    width: size.width,
    height: size.height
  });
}

async function configureWindow(
  target: TauriWindow,
  mode: ButtonAnimationWindowContext["mode"]
): Promise<void> {
  const editing = mode === "edit";
  await target.setDecorations(false);
  await target.setShadow(false);
  await target.setResizable(false);
  await target.setMinSize(null);
  await target.setMaxSize(null);
  await target.setAlwaysOnTop(true);
  const backgroundTarget = target as TauriWindow & {
    setBackgroundColor?: (color: [number, number, number, number]) => Promise<void>;
  };
  await backgroundTarget.setBackgroundColor?.([0, 0, 0, 0]);
  await target.setIgnoreCursorEvents(!editing);
}

async function emitContextUpdate(
  windowLabel: string,
  context: ButtonAnimationWindowContext
): Promise<void> {
  await emit(BUTTON_ANIMATION_CONTEXT_EVENT, {
    windowLabel,
    context
  } satisfies ButtonAnimationContextUpdate);
}

async function openAnimationWindow(
  windowLabel: string,
  context: ButtonAnimationWindowContext,
  bounds: ButtonDesktopBounds
): Promise<void> {
  const pendingOpen = pendingOpens.get(windowLabel);
  if (pendingOpen) {
    await pendingOpen;
    return openAnimationWindow(windowLabel, context, bounds);
  }

  const openPromise = (async () => {
    let target = await WebviewWindow.getByLabel(windowLabel);
    if (!target) {
      target = await createAnimationWindow(windowLabel, context);
    }

    await configureWindow(target, context.mode);
    await applyPhysicalBounds(target, bounds);
    await emitContextUpdate(windowLabel, context);
    if (context.mode === "edit") {
      await target.show();
      await target.setFocus();
    }
  })().finally(() => {
    if (pendingOpens.get(windowLabel) === openPromise) {
      pendingOpens.delete(windowLabel);
    }
  });

  pendingOpens.set(windowLabel, openPromise);
  return openPromise;
}

export async function openButtonActivationAnimationEditor(args: {
  buttonId: string;
  presetId: ButtonActivationAnimationPresetId;
  bounds?: ButtonDesktopBounds | null;
}): Promise<ButtonDesktopBounds> {
  if (!hasTauriRuntime()) {
    throw new Error("Button animation positioning is available in the FlowCell desktop app.");
  }
  activeEditorPresetId = args.presetId;
  const bounds = isUsableDesktopBounds(args.bounds)
    ? normalizeButtonAnimationEditorBounds(args.presetId, args.bounds)
    : await resolveDefaultBounds(args.presetId);
  await openAnimationWindow(BUTTON_ANIMATION_EDITOR_WINDOW_LABEL, {
    kind: "button-animation",
    schemaVersion: BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION,
    mode: "edit",
    requestId: createAnimationRequestId(),
    buttonId: args.buttonId,
    presetId: args.presetId
  }, bounds);
  return bounds;
}

export async function playButtonActivationAnimation(
  button: ButtonRecord
): Promise<void> {
  const animation = button.activationAnimation;
  if (!animation || !hasTauriRuntime() || !isUsableDesktopBounds(animation.desktopBounds)) {
    return;
  }
  await openAnimationWindow(BUTTON_ANIMATION_PLAY_WINDOW_LABEL, {
    kind: "button-animation",
    schemaVersion: BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION,
    mode: "play",
    requestId: createAnimationRequestId(),
    buttonId: button.id,
    presetId: animation.presetId
  }, resolveButtonAnimationPlaybackBounds(
    animation.presetId,
    animation.desktopBounds
  ));
}

export async function coordinateButtonActivationAnimationRequest(
  button: ButtonRecord
): Promise<void> {
  if (!hasTauriRuntime()) return;
  const currentLabel = getCurrentWindow().label;
  const labels = (await getAllWindows()).map((candidate) => candidate.label);
  const eligibleLabels = labels
    .filter((label) => (
      label !== BUTTON_ANIMATION_PLAY_WINDOW_LABEL &&
      label !== BUTTON_ANIMATION_EDITOR_WINDOW_LABEL &&
      label !== "flowcell-tooltip"
    ))
    .sort((left, right) => left.localeCompare(right));
  const coordinatorLabel = labels.includes("main")
    ? "main"
    : labels.includes(BUTTON_EDITOR_COORDINATOR_LABEL)
      ? BUTTON_EDITOR_COORDINATOR_LABEL
      : eligibleLabels[0];
  if (!coordinatorLabel || currentLabel !== coordinatorLabel) return;
  await playButtonActivationAnimation(button);
}

async function hideAnimationWindow(target: TauriWindow): Promise<void> {
  await target.setIgnoreCursorEvents(true).catch(() => {});
  await target.setAlwaysOnTop(false).catch(() => {});
  await target.hide().catch(() => {});
}

async function awaitPendingOpen(windowLabel: string): Promise<void> {
  await pendingOpens.get(windowLabel)?.catch(() => {});
}

export async function hideButtonActivationAnimationEditorWindow(): Promise<void> {
  if (!hasTauriRuntime()) return;
  await awaitPendingOpen(BUTTON_ANIMATION_EDITOR_WINDOW_LABEL);
  const target = await WebviewWindow.getByLabel(BUTTON_ANIMATION_EDITOR_WINDOW_LABEL);
  if (target) await hideAnimationWindow(target);
}

export async function hideCurrentButtonActivationAnimationWindow(): Promise<void> {
  if (!hasTauriRuntime()) return;
  await hideAnimationWindow(getCurrentWindow());
}

export function listenForButtonAnimationWindowContextUpdates(
  handler: (context: ButtonAnimationWindowContext) => void | Promise<void>
): Promise<UnlistenFn> {
  const windowLabel = getCurrentWindow().label;
  return listen<ButtonAnimationContextUpdate>(BUTTON_ANIMATION_CONTEXT_EVENT, (event) => {
    if (
      event.payload?.windowLabel !== windowLabel ||
      event.payload.context?.kind !== "button-animation"
    ) {
      return;
    }
    return handler(event.payload.context);
  });
}

export async function publishButtonAnimationWindowReady(): Promise<void> {
  await emit(BUTTON_ANIMATION_READY_EVENT, {
    windowLabel: getCurrentWindow().label
  } satisfies ButtonAnimationReadyUpdate);
}

export async function requestButtonActivationAnimation(button: ButtonRecord): Promise<void> {
  if (!button.activationAnimation || !hasTauriRuntime()) return;
  await emit(BUTTON_ANIMATION_PLAY_REQUEST_EVENT, {
    button
  } satisfies ButtonAnimationPlayRequest);
}

export function listenForButtonActivationAnimationRequests(
  handler: (button: ButtonRecord) => void | Promise<void>
): Promise<UnlistenFn> {
  return listen<ButtonAnimationPlayRequest>(BUTTON_ANIMATION_PLAY_REQUEST_EVENT, (event) => {
    const button = event.payload?.button;
    if (
      !button ||
      typeof button.id !== "string" ||
      !button.activationAnimation
    ) {
      return;
    }
    return handler(button);
  });
}

export async function saveButtonActivationAnimationEditorBounds(): Promise<ButtonDesktopBounds> {
  if (!hasTauriRuntime()) {
    throw new Error("Button animation positioning is available in the FlowCell desktop app.");
  }
  await awaitPendingOpen(BUTTON_ANIMATION_EDITOR_WINDOW_LABEL);
  const target = await WebviewWindow.getByLabel(BUTTON_ANIMATION_EDITOR_WINDOW_LABEL);
  if (!target) {
    throw new Error("Open the Button animation positioning window before saving its bounds.");
  }
  const bounds = normalizeButtonAnimationEditorBounds(
    activeEditorPresetId,
    await readPhysicalBounds(target)
  );
  await hideAnimationWindow(target);
  return bounds;
}
