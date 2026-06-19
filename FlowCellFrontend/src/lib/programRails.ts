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

const AUTO_CREATED_PANEL_NAMES = ["Collections", "Files", "Utility", "Layers"];

function isTauriWindowHost(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function formatInvokeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPackageWrapperProgramName(programName: string): boolean {
  return /^FlowCell-[A-Za-z0-9._ -]+$/.test(programName.trim());
}

async function removeAutoCreatedPanelFolders(programName: string): Promise<void> {
  await Promise.all(
    AUTO_CREATED_PANEL_NAMES.map((panelName) =>
      deletePanelFolder(programName, panelName).catch(() => undefined)
    )
  );
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

  const programNames = await invokeProgramRailCommand<string[]>("list_program_folders");
  return programNames.filter((programName) => !isPackageWrapperProgramName(programName));
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

  const result = await invokeProgramRailCommand<CreateProgramFolderResult>("create_program_folder", {
    name,
    exePath: exePath?.trim() ? exePath.trim() : null
  });
  await removeAutoCreatedPanelFolders(result.programName);
  return result;
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
    throw new Error("Layout snapshots can only be saved from the desktop host.");
  }

  return invokeProgramRailCommand<string>("save_layout_snapshot", { path, snapshot });
}

export async function loadLayoutSnapshot(path: string): Promise<LayoutSnapshot> {
  if (!isTauriWindowHost()) {
    throw new Error("Layout snapshots can only be loaded from the desktop host.");
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
    throw new Error("Blender tools can only be run from the desktop host.");
  }

  return invokeProgramRailCommand<string>("run_blender_rotate_tool", args);
}

export async function runBlenderAlignmentTool(args: {
  programName: string;
  panelName: string;
  fileName: string;
  command: string;
  axis: string;
  mode: string;
  modifier: string;
}): Promise<string> {
  if (!isTauriWindowHost()) {
    throw new Error("Blender tools can only be run from the desktop host.");
  }

  return invokeProgramRailCommand<string>("run_blender_alignment_tool", args);
}

export async function runIllustratorAlignmentTool(args: {
  programName: string;
  panelName: string;
  fileName: string;
  command: string;
  axis: string;
  mode: string;
  modifier: string;
  groupMode: boolean;
}): Promise<string> {
  if (!isTauriWindowHost()) {
    throw new Error("Illustrator tools can only be run from the desktop host.");
  }

  return invokeProgramRailCommand<string>("run_illustrator_alignment_tool", args);
}

export async function runBlenderSmartAxisTool(args: {
  programName: string;
  panelName: string;
  fileName: string;
  command: string;
}): Promise<SmartAxisToolStateResponse> {
  if (!isTauriWindowHost()) {
    throw new Error("Blender tools can only be run from the desktop host.");
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
    throw new Error("Blender tools can only be run from the desktop host.");
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
