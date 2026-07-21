import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ButtonPopoutUnit, ButtonStateDocument } from "../types.js";

export const TOOL_SET_CHILD_HOTKEY_EVENT = "flowcell:tool-set-child-hotkey";

export interface ToolSetChildHotkeyPayload {
  bindingId: number;
  shortcut: string;
  buttonId: string;
  ownerButtonId: string;
}

export interface ToolSetChildHotkeyHostState {
  document: ButtonStateDocument | null;
  unit: ButtonPopoutUnit | null;
  renderedDisplayMode: "collapsed" | "expanded";
  root: ParentNode | null;
}

export type ToolSetChildHotkeyActivationResult =
  | { accepted: true; payload: ToolSetChildHotkeyPayload }
  | { accepted: false; message: string; payload?: ToolSetChildHotkeyPayload };

function normalizePayload(value: unknown): ToolSetChildHotkeyPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.bindingId !== "number" ||
    !Number.isFinite(payload.bindingId) ||
    typeof payload.shortcut !== "string" ||
    !payload.shortcut.trim() ||
    typeof payload.buttonId !== "string" ||
    !payload.buttonId.trim() ||
    typeof payload.ownerButtonId !== "string" ||
    !payload.ownerButtonId.trim()
  ) {
    return null;
  }
  return {
    bindingId: payload.bindingId,
    shortcut: payload.shortcut.trim(),
    buttonId: payload.buttonId.trim(),
    ownerButtonId: payload.ownerButtonId.trim()
  };
}

function reject(
  message: string,
  payload?: ToolSetChildHotkeyPayload
): ToolSetChildHotkeyActivationResult {
  return { accepted: false, message, payload };
}

function requestLabel(payload: ToolSetChildHotkeyPayload): string {
  return `Shortcut '${payload.shortcut}'`;
}

function findMountedButtonCore(root: ParentNode, buttonId: string): HTMLElement | SVGElement | null {
  const candidates = root.querySelectorAll<HTMLElement>("[data-button-host-id]");
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate.dataset.buttonHostId !== buttonId) continue;
    const interactionHost = candidate.querySelector<HTMLElement>("[data-button-skin-host]");
    const interactionCore = interactionHost?.shadowRoot?.querySelector<HTMLElement | SVGElement>(
      "[data-core]"
    );
    if (interactionCore) return interactionCore;
  }
  return null;
}

export function activateToolSetChildHotkey(
  value: unknown,
  state: ToolSetChildHotkeyHostState
): ToolSetChildHotkeyActivationResult {
  const payload = normalizePayload(value);
  if (!payload) {
    return reject("FlowCell received a malformed tool-set child hotkey request.");
  }
  const label = requestLabel(payload);
  if (!state.document) {
    return reject(`${label} could not run because Button state is not loaded.`, payload);
  }
  if (!state.unit || state.unit.kind !== "tool-set") {
    return reject(`${label} could not run because its owning tool set is not active.`, payload);
  }
  if (state.unit.ownerButtonId !== payload.ownerButtonId) {
    return reject(`${label} was sent to the wrong tool-set owner.`, payload);
  }
  if (state.renderedDisplayMode !== "expanded") {
    return reject(`${label} could not run because its owning tool set is not expanded.`, payload);
  }
  const button = state.document.buttons[payload.buttonId];
  if (!button) {
    return reject(`${label} references a child Button that no longer exists.`, payload);
  }
  if (button.role !== "tool-set-child") {
    return reject(`${label} does not reference a tool-set child Button.`, payload);
  }
  if (button.toolSetParentId !== payload.ownerButtonId) {
    return reject(`${label} references a child Button owned by another tool set.`, payload);
  }
  if (!state.unit.childButtonIds.includes(button.id)) {
    return reject(`${label} references a child Button outside the active tool set.`, payload);
  }
  if (button.disabled) {
    return reject(`${label} could not run because '${button.label}' is disabled.`, payload);
  }
  if (!state.root) {
    return reject(`${label} could not run because the active tool-set host is not mounted.`, payload);
  }
  const interactionCore = findMountedButtonCore(state.root, button.id);
  if (!interactionCore) {
    return reject(`${label} could not run because '${button.label}' is not mounted in the active tool set.`, payload);
  }

  try {
    const eventInit: KeyboardEventInit = {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
      repeat: false
    };
    interactionCore.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    interactionCore.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  } catch (error) {
    return reject(
      `${label} could not activate '${button.label}': ${
        error instanceof Error ? error.message : String(error)
      }`,
      payload
    );
  }
  return { accepted: true, payload };
}

export function listenForToolSetChildHotkeys(
  handler: (payload: unknown) => void
): Promise<UnlistenFn> {
  return listen<unknown>(TOOL_SET_CHILD_HOTKEY_EVENT, (event) => {
    handler(event.payload);
  });
}
