import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { LayoutSnapshot } from "../types.js";
import { showOpenFileDialog } from "./tauri.js";

export const PROGRAM_DATA_INVALIDATED_EVENT = "flowcell://program-data-invalidated";

export interface ProgramDataInvalidationEvent {
  programName: string;
  panelName: string;
  fileName: string;
}

async function emitProgramDataInvalidated(
  programName: string,
  panelName: string,
  fileName: string
): Promise<void> {
  await emit(PROGRAM_DATA_INVALIDATED_EVENT, { programName, panelName, fileName }).catch(() => {});
}

export interface PanelScriptChildRecord {
  slot: string;
  label: string;
  tooltip: string;
}

export interface PanelButtonEventActionRecord {
  type?: string;
  action?: string;
  data?: unknown;
}

export type PanelButtonEventsRecord = Record<string, PanelButtonEventActionRecord>;

export interface PanelScriptFileRecord {
  fileName: string;
  label: string;
  tooltip?: string;
  kind?: string;
  executionTarget?: string;
  bridgeAction?: string;
  bridgeData?: unknown;
  events?: PanelButtonEventsRecord;
  children?: PanelScriptChildRecord[];
  macroId?: string;
  canonicalPlacement?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface CreateProgramFolderResult {
  programName: string;
  statusMessage?: string;
}

export interface ToolsetActionResponse {
  message?: string;
  display?: string;
  [key: string]: unknown;
}

function isTauriWindowHost(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function getCurrentWindowLabel(): string | undefined {
  try {
    return getCurrentWindow().label;
  } catch {
    return undefined;
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function responseMessage(response: unknown): string {
  if (typeof response === "string" && response.trim()) {
    return response.trim();
  }

  if (!isRecord(response)) {
    return "Script completed.";
  }

  return (
    readString(response.display) ||
    readString(response.message) ||
    "Script completed."
  );
}

type SlicerLauncherId = "orca" | "cura" | "slicer";

function slicerLaunchRequest(response: unknown): {
  slicerId: SlicerLauncherId;
  exportedPaths: string[];
  detectedExecutable: string;
} | null {
  if (!isRecord(response)) return null;
  const requested =
    response.requires_flowcell_slicer_launch === true ||
    response.requiresFlowCellSlicerLaunch === true ||
    response.requires_flowcell_orca_launch === true ||
    response.requiresFlowCellOrcaLaunch === true ||
    response.requires_flowcell_cura_launch === true ||
    response.requiresFlowCellCuraLaunch === true;
  if (!requested) return null;

  const rawId = readString(response.slicer_id) || readString(response.slicerId);
  const slicerId: SlicerLauncherId =
    response.requires_flowcell_orca_launch === true ||
    response.requiresFlowCellOrcaLaunch === true ||
    rawId.toLowerCase().includes("orca")
      ? "orca"
      : response.requires_flowcell_cura_launch === true ||
          response.requiresFlowCellCuraLaunch === true ||
          rawId.toLowerCase().includes("cura")
        ? "cura"
        : "slicer";
  const rawPaths = Array.isArray(response.exported_paths)
    ? response.exported_paths
    : Array.isArray(response.exportedPaths)
      ? response.exportedPaths
      : [];
  const exportedPaths = rawPaths.map(readString).filter(Boolean);
  if (exportedPaths.length === 0) {
    throw new Error("The slicer script did not return any exported model paths.");
  }
  return {
    slicerId,
    exportedPaths,
    detectedExecutable:
      readString(response.detected_executable) || readString(response.detectedExecutable)
  };
}

async function handleSlicerLaunchRequest(request: {
  slicerId: SlicerLauncherId;
  exportedPaths: string[];
  detectedExecutable: string;
}): Promise<string> {
  let executablePath = await invokeProgramRailCommand<string | null>("load_slicer_executable", {
    slicerId: request.slicerId
  });
  executablePath ||= request.detectedExecutable || null;
  if (!executablePath) {
    const displayName = request.slicerId === "orca"
      ? "OrcaSlicer"
      : request.slicerId === "cura"
        ? "UltiMaker Cura"
        : "slicer";
    const selectedPaths = await showOpenFileDialog({
      title: `Choose ${displayName} executable`,
      filter: "Applications (*.exe)|*.exe|All Files (*.*)|*.*",
      multiselect: false
    });
    executablePath = selectedPaths[0]?.trim() || null;
  }
  if (!executablePath) return "Slicer launch cancelled.";
  return invokeProgramRailCommand<string>("launch_slicer", {
    slicerId: request.slicerId,
    executablePath,
    exportedPaths: request.exportedPaths
  });
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
): Promise<{ programName: string; renameToken: string }> {
  if (!isTauriWindowHost()) {
    throw new Error("Program folders can only be renamed from the desktop host.");
  }

  return invokeProgramRailCommand<{ programName: string; renameToken: string }>("rename_program_folder", {
    currentName,
    name
  });
}

export async function beginProgramUnregistration(name: string): Promise<string> {
  if (!isTauriWindowHost()) {
    throw new Error("Programs can only be removed from the desktop host.");
  }

  return invokeProgramRailCommand<string>("begin_program_unregistration", { name });
}

export async function rollbackProgramUnregistration(rollbackToken: string): Promise<void> {
  if (!isTauriWindowHost()) {
    throw new Error("Program removal can only be rolled back from the desktop host.");
  }

  await invokeProgramRailCommand<void>("rollback_program_unregistration", { rollbackToken });
}

export async function finalizeProgramUnregistration(rollbackToken: string): Promise<void> {
  if (!isTauriWindowHost()) {
    throw new Error("Program removal can only be finalized from the desktop host.");
  }

  await invokeProgramRailCommand<void>("finalize_program_unregistration", { rollbackToken });
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

  const records = await invokeProgramRailCommand<PanelScriptFileRecord[]>("list_panel_script_files", {
    programName,
    panelName
  });
  return records;
}

export async function runPanelScript(
  programName: string,
  panelName: string,
  fileName: string
): Promise<string> {
  if (!isTauriWindowHost()) {
    throw new Error("Panel scripts can only be run from the desktop host.");
  }

  const response = await invokeProgramRailCommand<unknown>("run_panel_script_response", {
    programName,
    panelName,
    fileName
  });
  await emitProgramDataInvalidated(programName, panelName, fileName);

  const slicerRequest = slicerLaunchRequest(response);
  if (slicerRequest) return handleSlicerLaunchRequest(slicerRequest);

  return responseMessage(response);
}

export async function runPanelButtonEvent(
  programName: string,
  panelName: string,
  fileName: string,
  eventName: string
): Promise<string> {
  if (!isTauriWindowHost()) {
    throw new Error("Panel button events can only be run from the desktop host.");
  }

  return invokeProgramRailCommand<string>("run_panel_button_event", {
    programName,
    panelName,
    fileName,
    eventName
  });
}

export async function rollbackProgramRename(renameToken: string): Promise<void> {
  if (!isTauriWindowHost()) {
    throw new Error("Program folders can only be renamed from the desktop host.");
  }
  await invokeProgramRailCommand<void>("rollback_program_rename", { renameToken });
}

export async function finalizeProgramRename(renameToken: string): Promise<void> {
  if (!isTauriWindowHost()) {
    throw new Error("Program folders can only be renamed from the desktop host.");
  }
  await invokeProgramRailCommand<void>("finalize_program_rename", { renameToken });
}

export async function recoverProgramRename(renameToken: string): Promise<void> {
  if (!isTauriWindowHost()) {
    throw new Error("Program folders can only be renamed from the desktop host.");
  }
  await invokeProgramRailCommand<void>("recover_program_rename", { renameToken });
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
    initialDirectory,
    parentLabel: getCurrentWindowLabel()
  });
}

export async function showOpenLayoutDialog(
  initialDirectory?: string
): Promise<string | null> {
  if (!isTauriWindowHost()) {
    throw new Error("Layout files can only be opened from the desktop host.");
  }

  return invokeProgramRailCommand<string | null>("show_open_layout_dialog", {
    initialDirectory,
    parentLabel: getCurrentWindowLabel()
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

  const response = await invokeProgramRailCommand<ToolsetActionResponse>("run_toolset_action", args);
  await emitProgramDataInvalidated(args.programName, args.panelName, args.fileName);
  return response;
}
