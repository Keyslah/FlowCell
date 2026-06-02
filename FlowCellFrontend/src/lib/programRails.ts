import { invoke } from "@tauri-apps/api/core";
import type { LayoutSnapshot } from "../types";

export interface PanelScriptChildRecord {
  slot: string;
  label: string;
  tooltip: string;
}

export interface PanelScriptFileRecord {
  fileName: string;
  label: string;
  tooltip?: string;
  kind?: string;
  executionTarget?: string;
  bridgeAction?: string;
  bridgeData?: unknown;
  children?: PanelScriptChildRecord[];
  macroId?: string;
}

export interface CreateProgramFolderResult {
  programName: string;
  statusMessage?: string;
}

export interface SmartAxisToolStateResponse {
  message?: string;
  registered?: boolean;
  runner_active?: boolean;
  enabled_tool_count?: number;
  modes?: Partial<Record<"X" | "Y" | "Z", string>>;
  active_axes?: string[];
  selected?: number;
  selection?: string[];
  live_enabled?: boolean;
  axis?: string;
  mode?: string;
}

export interface ToolsetActionResponse {
  message?: string;
  display?: string;
  [key: string]: unknown;
}

function isTauriWindowHost(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function formatInvokeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function invokeProgramRailCommand<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(formatInvokeError(error));
  }
}

export async function listProgramFolders(): Promise<string[]> {
  if (!isTauriWindowHost()) {
    return [];
  }

  return invokeProgramRailCommand<string[]>("list_program_folders");
}

export async function listPanelFolders(programName: string): Promise<string[]> {
  if (!isTauriWindowHost()) {
    return [];
  }

  return invokeProgramRailCommand<string[]>("list_panel_folders", { programName });
}

export async function createProgramFolder(
  name: string,
  exePath?: string
): Promise<CreateProgramFolderResult> {
  if (!isTauriWindowHost()) {
    throw new Error("Program folders can only be created from the desktop host.");
  }

  return invokeProgramRailCommand<CreateProgramFolderResult>("create_program_folder", {
    name,
    exePath: exePath?.trim() ? exePath.trim() : null
  });
}

export async function renameProgramFolder(
  currentName: string,
  name: string
): Promise<string> {
  if (!isTauriWindowHost()) {
    throw new Error("Program folders can only be renamed from the desktop host.");
  }

  return invokeProgramRailCommand<string>("rename_program_folder", {
    currentName,
    name
  });
}

export async function deleteProgramFolder(name: string): Promise<void> {
  if (!isTauriWindowHost()) {
    throw new Error("Program folders can only be deleted from the desktop host.");
  }

  await invokeProgramRailCommand<void>("delete_program_folder", { name });
}

export async function createPanelFolder(programName: string, name: string): Promise<string> {
  if (!isTauriWindowHost()) {
    throw new Error("Panel folders can only be created from the desktop host.");
  }

  return invokeProgramRailCommand<string>("create_panel_folder", { programName, name });
}

export async function renamePanelFolder(
  programName: string,
  currentName: string,
  name: string
): Promise<string> {
  if (!isTauriWindowHost()) {
    throw new Error("Panel folders can only be renamed from the desktop host.");
  }

  return invokeProgramRailCommand<string>("rename_panel_folder", {
    programName,
    currentName,
    name
  });
}

export async function deletePanelFolder(
  programName: string,
  name: string
): Promise<void> {
  if (!isTauriWindowHost()) {
    throw new Error("Panel folders can only be deleted from the desktop host.");
  }

  await invokeProgramRailCommand<void>("delete_panel_folder", { programName, name });
}

export async function listPanelScriptFiles(
  programName: string,
  panelName: string
): Promise<PanelScriptFileRecord[]> {
  if (!isTauriWindowHost()) {
    return [];
  }

  return invokeProgramRailCommand<PanelScriptFileRecord[]>("list_panel_script_files", {
    programName,
    panelName
  });
}

export async function addPanelScripts(
  programName: string,
  panelName: string
): Promise<PanelScriptFileRecord[]> {
  if (!isTauriWindowHost()) {
    throw new Error("Panel scripts can only be added from the desktop host.");
  }

  return invokeProgramRailCommand<PanelScriptFileRecord[]>("add_panel_scripts", {
    programName,
    panelName
  });
}

export async function deletePanelScripts(
  programName: string,
  panelName: string,
  fileNames: string[]
): Promise<PanelScriptFileRecord[]> {
  if (!isTauriWindowHost()) {
    throw new Error("Panel scripts can only be deleted from the desktop host.");
  }

  return invokeProgramRailCommand<PanelScriptFileRecord[]>("delete_panel_scripts", {
    programName,
    panelName,
    fileNames
  });
}

export async function updatePanelScriptDescription(
  programName: string,
  panelName: string,
  fileName: string,
  description: string
): Promise<PanelScriptFileRecord[]> {
  if (!isTauriWindowHost()) {
    throw new Error("Panel script descriptions can only be updated from the desktop host.");
  }

  return invokeProgramRailCommand<PanelScriptFileRecord[]>("update_panel_script_description", {
    programName,
    panelName,
    fileName,
    description
  });
}

export async function runPanelScript(
  programName: string,
  panelName: string,
  fileName: string
): Promise<string> {
  if (!isTauriWindowHost()) {
    throw new Error("Panel scripts can only be run from the desktop host.");
  }

  return invokeProgramRailCommand<string>("run_panel_script", {
    programName,
    panelName,
    fileName
  });
}

export async function showSaveLayoutDialog(
  suggestedName: string,
  initialDirectory?: string
): Promise<string | null> {
  if (!isTauriWindowHost()) {
    throw new Error("Layout files can only be saved from the desktop host.");
  }

  return invokeProgramRailCommand<string | null>("show_save_layout_dialog", {
    suggestedName,
    initialDirectory
  });
}

export async function showOpenLayoutDialog(
  initialDirectory?: string
): Promise<string | null> {
  if (!isTauriWindowHost()) {
    throw new Error("Layout files can only be opened from the desktop host.");
  }

  return invokeProgramRailCommand<string | null>("show_open_layout_dialog", {
    initialDirectory
  });
}

export async function saveLayoutSnapshot(
  path: string,
  snapshot: LayoutSnapshot
): Promise<string> {
  if (!isTauriWindowHost()) {
    throw new Error("Layout files can only be saved from the desktop host.");
  }

  return invokeProgramRailCommand<string>("save_layout_snapshot", {
    path,
    snapshot
  });
}

export async function loadLayoutSnapshot(path: string): Promise<LayoutSnapshot> {
  if (!isTauriWindowHost()) {
    throw new Error("Layout files can only be loaded from the desktop host.");
  }

  return invokeProgramRailCommand<LayoutSnapshot>("load_layout_snapshot", { path });
}

export async function runBlenderRotateTool(args: {
  programName: string;
  panelName: string;
  fileName: string;
  axis: string;
  centerMode: string;
  operationMode: string;
  angleDeg: number;
  distributeCount: number;
}): Promise<string> {
  if (!isTauriWindowHost()) {
    throw new Error("Blender tool actions can only be run from the desktop host.");
  }

  return invokeProgramRailCommand<string>("run_blender_rotate_tool", args);
}

export async function runBlenderAlignmentTool(args: {
  programName: string;
  panelName: string;
  fileName: string;
  command: "align_axis" | "center_all";
  axis: string;
  mode: string;
  modifier: string;
}): Promise<string> {
  if (!isTauriWindowHost()) {
    throw new Error("Blender tool actions can only be run from the desktop host.");
  }

  return invokeProgramRailCommand<string>("run_blender_alignment_tool", args);
}

export async function runIllustratorAlignmentTool(args: {
  programName: string;
  panelName: string;
  fileName: string;
  command: "align_axis" | "center_all" | "center_artboard";
  axis: string;
  mode: string;
  modifier: string;
  groupMode: boolean;
}): Promise<string> {
  if (!isTauriWindowHost()) {
    throw new Error("Illustrator tool actions can only be run from the desktop host.");
  }

  return invokeProgramRailCommand<string>("run_illustrator_alignment_tool", args);
}

export async function runBlenderSmartAxisTool(args: {
  programName: string;
  panelName: string;
  fileName: string;
  command: "baseline" | "cycle_x" | "cycle_y" | "cycle_z" | "toggle_live" | "status";
}): Promise<SmartAxisToolStateResponse> {
  if (!isTauriWindowHost()) {
    throw new Error("Blender tool actions can only be run from the desktop host.");
  }

  return invokeProgramRailCommand<SmartAxisToolStateResponse>("run_blender_smart_axis_tool", args);
}

export async function runBlenderToolsetAction(args: {
  programName: string;
  panelName: string;
  fileName: string;
  command: string;
  payload?: Record<string, unknown>;
}): Promise<ToolsetActionResponse> {
  if (!isTauriWindowHost()) {
    throw new Error("Blender tool actions can only be run from the desktop host.");
  }

  return invokeProgramRailCommand<ToolsetActionResponse>("run_blender_toolset_action", args);
}

export async function runToolsetAction(args: {
  programName: string;
  panelName: string;
  fileName: string;
  command: string;
  payload?: Record<string, unknown>;
}): Promise<ToolsetActionResponse> {
  if (!isTauriWindowHost()) {
    throw new Error("Toolset actions can only be run from the desktop host.");
  }

  return invokeProgramRailCommand<ToolsetActionResponse>("run_toolset_action", args);
}
