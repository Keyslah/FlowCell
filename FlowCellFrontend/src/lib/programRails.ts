import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { LayoutSnapshot } from "../types.js";

export const PROGRAM_DATA_INVALIDATED_EVENT = "flowcell://program-data-invalidated";
export const PROGRAM_SETUP_COMMITTED_EVENT = "flowcell://program-setup-committed";

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

export interface ProgramSetupPanel {
  id: string;
  label: string;
  defaultSelected: boolean;
}

export interface ProgramSetupSource {
  id: string;
  label: string;
  tooltip: string;
  version: string;
  panelName: string;
  sourceKind: string;
  required: boolean;
  defaultSelected: boolean;
  dependencies: string[];
  installEffects: string[];
}

export interface AvailableProgramPackage {
  programId: string;
  programName: string;
  programType: string;
  suggestedExecutable: string;
  panels: ProgramSetupPanel[];
  sources: ProgramSetupSource[];
  supportContent: string[];
  requiredVersions: string[];
  installEffects: string[];
  addonReloadNotes: string;
  appRestartNotes: string;
}

export interface AvailableProgramPackagesResponse {
  packages: AvailableProgramPackage[];
  rejectedPackages: Array<{ folderName: string; error: string }>;
}

export interface AddProgramPlanRequest {
  programName: string;
  executablePath: string;
  selectedPanels: string[];
  selectedSources: Array<{ sourceId: string; destinationPanel: string }>;
}

export interface AddProgramPreflight {
  programId: string;
  programName: string;
  executablePath: string;
  panels: string[];
  sources: ProgramSetupSource[];
  installEffects: string[];
}

export interface AppliedProgramSetup {
  transactionToken: string;
  programName: string;
  panels: string[];
  descriptors: Record<string, unknown>[];
  installEffects: string[];
}

export interface AddPanelPlanRequest {
  programName: string;
  panelName: string;
  sourceFolder?: string | null;
}

export interface AddPanelPreflight {
  programName: string;
  panelName: string;
  sourceFolder?: string | null;
  existing: boolean;
  copyFileCount: number;
  copyByteCount: number;
}

export interface AppliedPanelSetup {
  transactionToken: string;
  programName: string;
  panelName: string;
  created: boolean;
}

export interface ProgramSetupCommittedEvent {
  kind: "program" | "panel";
  programName: string;
  panelName?: string;
}

export async function emitProgramSetupCommitted(
  payload: ProgramSetupCommittedEvent
): Promise<void> {
  await emit(PROGRAM_SETUP_COMMITTED_EVENT, payload);
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

export async function beginProgramUnregistration(
  name: string,
  expectedOwnerButtonIds: string[]
): Promise<string> {
  if (!isTauriWindowHost()) {
    throw new Error("Programs can only be removed from the desktop host.");
  }

  return invokeProgramRailCommand<string>("begin_program_unregistration", {
    name,
    expectedOwnerButtonIds
  });
}

export async function listAvailableProgramPackages(): Promise<AvailableProgramPackagesResponse> {
  if (!isTauriWindowHost()) return { packages: [], rejectedPackages: [] };
  return invokeProgramRailCommand<AvailableProgramPackagesResponse>(
    "list_available_program_packages"
  );
}

export async function preflightAddProgramPlan(
  request: AddProgramPlanRequest
): Promise<AddProgramPreflight> {
  return invokeProgramRailCommand<AddProgramPreflight>("preflight_add_program_plan", { request });
}

export async function applyAddProgramPlan(
  request: AddProgramPlanRequest
): Promise<AppliedProgramSetup> {
  return invokeProgramRailCommand<AppliedProgramSetup>("apply_add_program_plan", { request });
}

export async function prepareAddProgramCanonicalCommit(
  transactionToken: string,
  expectedButtonIds: string[]
): Promise<void> {
  await invokeProgramRailCommand<void>("prepare_add_program_canonical_commit", {
    transactionToken,
    expectedButtonIds
  });
}

export async function finalizeAddProgramPlan(transactionToken: string): Promise<void> {
  await invokeProgramRailCommand<void>("finalize_add_program_plan", { transactionToken });
}

export async function rollbackAddProgramPlan(
  transactionToken: string
): Promise<"finalized" | "rolled-back"> {
  return invokeProgramRailCommand<"finalized" | "rolled-back">("rollback_add_program_plan", {
    transactionToken
  });
}

export async function preflightAddPanelPlan(
  request: AddPanelPlanRequest
): Promise<AddPanelPreflight> {
  return invokeProgramRailCommand<AddPanelPreflight>("preflight_add_panel_plan", { request });
}

export async function applyAddPanelPlan(
  request: AddPanelPlanRequest
): Promise<AppliedPanelSetup> {
  return invokeProgramRailCommand<AppliedPanelSetup>("apply_add_panel_plan", { request });
}

export async function prepareAddPanelCanonicalCommit(
  transactionToken: string,
  expectedButtonId: string
): Promise<void> {
  await invokeProgramRailCommand<void>("prepare_add_panel_canonical_commit", {
    transactionToken,
    expectedButtonId
  });
}

export async function finalizeAddPanelPlan(transactionToken: string): Promise<void> {
  await invokeProgramRailCommand<void>("finalize_add_panel_plan", { transactionToken });
}

export async function rollbackAddPanelPlan(
  transactionToken: string
): Promise<"finalized" | "rolled-back"> {
  return invokeProgramRailCommand<"finalized" | "rolled-back">("rollback_add_panel_plan", {
    transactionToken
  });
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

export async function preparePanelDeletion(
  programName: string,
  panelName: string,
  expectedOwnerButtonIds: string[]
): Promise<string> {
  if (!isTauriWindowHost()) {
    throw new Error("Panel folders can only be deleted from the desktop host.");
  }

  return invokeProgramRailCommand<string>("prepare_panel_deletion", {
    programName,
    panelName,
    expectedOwnerButtonIds
  });
}

export async function rollbackPanelDeletion(transactionToken: string): Promise<void> {
  if (!isTauriWindowHost()) {
    throw new Error("Panel folder deletion can only be rolled back from the desktop host.");
  }

  await invokeProgramRailCommand<void>("rollback_panel_deletion", { transactionToken });
}

export async function finalizePanelDeletion(transactionToken: string): Promise<void> {
  if (!isTauriWindowHost()) {
    throw new Error("Panel folder deletion can only be finalized from the desktop host.");
  }

  await invokeProgramRailCommand<void>("finalize_panel_deletion", { transactionToken });
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

export async function queryToolsetState(args: {
  programName: string;
  panelName: string;
  fileName: string;
}): Promise<ToolsetActionResponse | null> {
  if (!isTauriWindowHost()) {
    throw new Error("Toolset state can only be queried from the desktop host.");
  }

  return invokeProgramRailCommand<ToolsetActionResponse | null>("query_toolset_state", args);
}
