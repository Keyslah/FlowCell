import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

export const MACRO_PANEL_CHANGED_EVENT = "flowcell://macro-panel-changed";

export interface MacroPanelChangedPayload {
  programName: string;
  panelName: string;
}

export type MacroStepType =
  | "ActivateIllustrator"
  | "ActivatePhotoshop"
  | "ActivateBlender"
  | "ActivateWindows"
  | "Click"
  | "RightClick"
  | "Wheel"
  | "Text"
  | "Key"
  | "Script"
  | "Macro";

export interface FrontendMacroStep {
  id: string;
  type: MacroStepType;
  delayMs: number;
  x?: number | null;
  y?: number | null;
  button?: string | null;
  count?: number | null;
  direction?: string | null;
  text?: string | null;
  keys?: string | null;
  target?: string | null;
}

export interface FrontendMacroSummary {
  id: string;
  label: string;
  programName: string;
  panelName: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
}

export interface FrontendMacroDocument extends FrontendMacroSummary {
  steps: FrontendMacroStep[];
  shortcut?: string | null;
}

export interface SaveMacroShortcutResponse {
  message: string;
  bindings?: unknown;
}

export interface CursorPosition {
  x: number;
  y: number;
}

function isTauriWindowHost(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function formatInvokeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function invokeMacroCommand<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(formatInvokeError(error));
  }
}

export async function listFrontendPanelMacros(
  programName: string,
  panelName: string
): Promise<FrontendMacroSummary[]> {
  if (!isTauriWindowHost()) {
    return [];
  }

  return invokeMacroCommand<FrontendMacroSummary[]>("list_frontend_panel_macros", {
    programName,
    panelName
  });
}

export async function listFrontendMacros(): Promise<FrontendMacroSummary[]> {
  if (!isTauriWindowHost()) {
    return [];
  }

  return invokeMacroCommand<FrontendMacroSummary[]>("list_frontend_macros");
}

export async function loadFrontendMacro(actionId: string): Promise<FrontendMacroDocument> {
  if (!isTauriWindowHost()) {
    throw new Error("Macros can only be loaded from the desktop host.");
  }

  return invokeMacroCommand<FrontendMacroDocument>("load_frontend_macro", { actionId });
}

export async function loadFrontendMacroFromPath(args: {
  path: string;
  fallbackProgramName: string;
  fallbackPanelName: string;
}): Promise<FrontendMacroDocument> {
  if (!isTauriWindowHost()) {
    throw new Error("Macros can only be loaded from the desktop host.");
  }

  return invokeMacroCommand<FrontendMacroDocument>("load_frontend_macro_from_path", {
    request: {
      path: args.path,
      fallbackProgramName: args.fallbackProgramName,
      fallbackPanelName: args.fallbackPanelName
    }
  });
}

export async function getFrontendMacroDirectory(): Promise<string> {
  if (!isTauriWindowHost()) {
    return "";
  }

  return invokeMacroCommand<string>("get_frontend_macro_directory");
}

export async function saveFrontendMacro(args: {
  currentId?: string | null;
  programName: string;
  panelName: string;
  label: string;
  steps: FrontendMacroStep[];
  forceNewId?: boolean;
}): Promise<FrontendMacroDocument> {
  if (!isTauriWindowHost()) {
    throw new Error("Macros can only be saved from the desktop host.");
  }

  return invokeMacroCommand<FrontendMacroDocument>("save_frontend_macro", {
    request: {
      currentId: args.currentId ?? null,
      programName: args.programName,
      panelName: args.panelName,
      label: args.label,
      steps: args.steps,
      forceNewId: args.forceNewId ?? false
    }
  });
}

export async function addFrontendMacroPanelButton(args: {
  programName: string;
  panelName: string;
  actionId: string;
}): Promise<FrontendMacroDocument> {
  if (!isTauriWindowHost()) {
    throw new Error("Macro panel buttons can only be added from the desktop host.");
  }

  return invokeMacroCommand<FrontendMacroDocument>("add_frontend_macro_panel_button", {
    programName: args.programName,
    panelName: args.panelName,
    actionId: args.actionId
  });
}

export async function deleteFrontendMacro(
  actionId: string
): Promise<FrontendMacroSummary[]> {
  if (!isTauriWindowHost()) {
    throw new Error("Macros can only be deleted from the desktop host.");
  }

  return invokeMacroCommand<FrontendMacroSummary[]>("delete_frontend_macro", { actionId });
}

export async function runFrontendMacro(actionId: string): Promise<string> {
  if (!isTauriWindowHost()) {
    throw new Error("Macros can only be run from the desktop host.");
  }

  return invokeMacroCommand<string>("run_frontend_macro", { actionId });
}

export async function recordFrontendMacro(args: {
  currentId?: string | null;
  programName: string;
  panelName: string;
  label: string;
}): Promise<FrontendMacroDocument> {
  if (!isTauriWindowHost()) {
    throw new Error("Macros can only be recorded from the desktop host.");
  }

  return invokeMacroCommand<FrontendMacroDocument>("record_frontend_macro", {
    request: {
      currentId: args.currentId ?? null,
      programName: args.programName,
      panelName: args.panelName,
      label: args.label
    }
  });
}

export async function saveMacroShortcut(args: {
  actionId: string;
  shortcut: string;
}): Promise<SaveMacroShortcutResponse> {
  if (!isTauriWindowHost()) {
    throw new Error("Macro shortcuts can only be changed from the desktop host.");
  }

  return invokeMacroCommand<SaveMacroShortcutResponse>("save_macro_shortcut", {
    request: {
      actionId: args.actionId,
      shortcut: args.shortcut
    }
  });
}

export async function getCurrentMousePosition(): Promise<CursorPosition> {
  if (!isTauriWindowHost()) {
    return { x: 0, y: 0 };
  }

  return invokeMacroCommand<CursorPosition>("get_cursor_position");
}

export async function emitMacroPanelChanged(args: MacroPanelChangedPayload): Promise<void> {
  if (!isTauriWindowHost()) {
    return;
  }

  try {
    await emit(MACRO_PANEL_CHANGED_EVENT, {
      programName: args.programName,
      panelName: args.panelName
    });
  } catch (error) {
    console.warn("Macro panel refresh event could not be emitted.", error);
  }
}
