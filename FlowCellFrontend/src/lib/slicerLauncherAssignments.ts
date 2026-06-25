import { showOpenFileDialog, showTextInputDialog } from "./tauri";

type SlicerLauncherId = "orca" | "cura" | "slicer";

type RecentSlicerChoice =
  | { kind: "path"; path: string }
  | { kind: "browse" }
  | { kind: "cancel" };

export interface PanelSlicerScriptRecord {
  fileName: string;
  label: string;
  tooltip?: string;
}

interface PanelScriptRunResponse {
  requires_flowcell_slicer_launch?: boolean;
  requiresFlowCellSlicerLaunch?: boolean;
  requires_flowcell_orca_launch?: boolean;
  requiresFlowCellOrcaLaunch?: boolean;
  requires_flowcell_cura_launch?: boolean;
  requiresFlowCellCuraLaunch?: boolean;
  slicer_id?: string;
  slicerId?: string;
  slicer_display_name?: string;
  slicerDisplayName?: string;
  executable_label?: string;
  executableLabel?: string;
  detected_executable?: string;
  detectedExecutable?: string;
  exported_paths?: unknown;
  exportedPaths?: unknown;
}

interface SlicerLauncherSpec {
  id: SlicerLauncherId;
  displayName: string;
  executableLabel: string;
}

interface SlicerButtonAssignment {
  executablePath: string;
  displayName: string;
  updatedAt: string;
}

interface RecentSlicerExecutable {
  executablePath: string;
  displayName: string;
  updatedAt: string;
}

interface SlicerLaunchContext {
  programName: string;
  panelName: string;
  fileName: string;
}

const SLICER_BUTTON_ASSIGNMENTS_STORAGE_KEY = "flowcell.slicer.buttonAssignments.v1";
const SLICER_RECENTS_STORAGE_KEY = "flowcell.slicer.recentExecutables.v1";
const MAX_RECENT_SLICERS = 8;

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(readString).filter(Boolean) : [];
}

function initialDirectoryFromPath(path: string): string | undefined {
  const trimmed = path.trim();
  if (!trimmed) return undefined;
  const lastSlash = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return lastSlash > 0 ? trimmed.slice(0, lastSlash) : undefined;
}

function readRequestedSlicerId(response: PanelScriptRunResponse): string {
  if (response.requires_flowcell_orca_launch === true || response.requiresFlowCellOrcaLaunch === true) return "orca";
  if (response.requires_flowcell_cura_launch === true || response.requiresFlowCellCuraLaunch === true) return "cura";
  return readString(response.slicer_id ?? response.slicerId).toLowerCase();
}

function resolveSlicerLauncherSpec(response: PanelScriptRunResponse): SlicerLauncherSpec {
  const requestedId = readRequestedSlicerId(response);
  const id =
    requestedId === "orca" ||
    requestedId === "orcaslicer" ||
    requestedId === "orca_slicer" ||
    requestedId === "orca-slicer"
      ? "orca"
      : requestedId === "cura" ||
          requestedId === "ultimaker_cura" ||
          requestedId === "ultimaker-cura"
        ? "cura"
        : "slicer";
  const fallbackName =
    id === "cura" ? "UltiMaker Cura" : id === "orca" ? "OrcaSlicer" : "Slicer";
  return {
    id,
    displayName: readString(response.slicer_display_name ?? response.slicerDisplayName) || fallbackName,
    executableLabel: readString(response.executable_label ?? response.executableLabel) || "Slicer EXE"
  };
}

function readJsonStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined" || !window.localStorage) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key: string, value: unknown): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The slicer should still launch even if the convenience cache cannot be written.
  }
}

function slicerButtonAssignmentKey(programName: string, panelName: string, fileName: string): string {
  return [programName, panelName, fileName]
    .map((part) => part.trim().replace(/\\/g, "/").toLowerCase())
    .join("/");
}

function inferSlicerDisplayName(executablePath: string, fallback: string): string {
  const fileName = executablePath.trim().split(/[\\/]/).pop() || "";
  const stem = fileName.replace(/\.exe$/i, "").trim();
  const lower = stem.toLowerCase();
  if (lower.includes("orca")) return "Orca";
  if (lower.includes("cura")) return "Cura";
  if (lower.includes("prusa")) return "Prusa";
  if (lower.includes("bambu")) return "Bambu";
  if (lower.includes("anycubic")) return "Anycubic";
  return stem.replace(/[-_]+/g, " ").replace(/\bslicer\b/gi, "Slicer").trim() || fallback || "Slicer";
}

function readSlicerButtonAssignments(): Record<string, SlicerButtonAssignment> {
  const raw = readJsonStorage<Record<string, SlicerButtonAssignment>>(SLICER_BUTTON_ASSIGNMENTS_STORAGE_KEY, {});
  const cleaned: Record<string, SlicerButtonAssignment> = {};
  for (const [key, assignment] of Object.entries(raw)) {
    const executablePath = readString(assignment?.executablePath);
    if (!executablePath) continue;
    cleaned[key] = {
      executablePath,
      displayName: readString(assignment?.displayName) || inferSlicerDisplayName(executablePath, "Slicer"),
      updatedAt: readString(assignment?.updatedAt) || new Date(0).toISOString()
    };
  }
  return cleaned;
}

function writeSlicerButtonAssignments(assignments: Record<string, SlicerButtonAssignment>): void {
  writeJsonStorage(SLICER_BUTTON_ASSIGNMENTS_STORAGE_KEY, assignments);
}

function readRecentSlicerExecutables(): RecentSlicerExecutable[] {
  const raw = readJsonStorage<RecentSlicerExecutable[]>(SLICER_RECENTS_STORAGE_KEY, []);
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const cleaned: RecentSlicerExecutable[] = [];
  for (const item of raw) {
    const executablePath = readString(item?.executablePath);
    if (!executablePath) continue;
    const key = executablePath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({
      executablePath,
      displayName: readString(item?.displayName) || inferSlicerDisplayName(executablePath, "Slicer"),
      updatedAt: readString(item?.updatedAt) || new Date(0).toISOString()
    });
  }
  return cleaned.slice(0, MAX_RECENT_SLICERS);
}

function rememberRecentSlicerExecutable(executablePath: string, displayName: string): void {
  const trimmedPath = executablePath.trim();
  if (!trimmedPath) return;
  const next = [
    { executablePath: trimmedPath, displayName: displayName.trim() || inferSlicerDisplayName(trimmedPath, "Slicer"), updatedAt: new Date().toISOString() },
    ...readRecentSlicerExecutables().filter((item) => item.executablePath.toLowerCase() !== trimmedPath.toLowerCase())
  ];
  writeJsonStorage(SLICER_RECENTS_STORAGE_KEY, next.slice(0, MAX_RECENT_SLICERS));
}

function chooseRecentSlicerExecutable(): RecentSlicerChoice {
  const recents = readRecentSlicerExecutables();
  if (recents.length === 0 || typeof window === "undefined") return { kind: "browse" };
  const list = recents.map((item, index) => `${index + 1}. ${item.displayName}\n   ${item.executablePath}`).join("\n");
  const answer = window.prompt(`Use a recent slicer, or browse for a new one.\n\n${list}\n\nEnter a number, B to browse, or leave blank to cancel.`, "B");
  if (answer === null || !answer.trim()) return { kind: "cancel" };
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "b" || trimmed === "browse") return { kind: "browse" };
  const index = Number.parseInt(trimmed, 10) - 1;
  if (Number.isInteger(index) && index >= 0 && index < recents.length) return { kind: "path", path: recents[index].executablePath };
  return { kind: "browse" };
}

async function pickSlicerExecutable(initialPath: string, executableLabel: string): Promise<string> {
  const selectedPaths = await showOpenFileDialog({
    title: `Choose ${executableLabel || "Slicer EXE"}`,
    filter: "Executable (*.exe)|*.exe|All Files (*.*)|*.*",
    initialDirectory: initialDirectoryFromPath(initialPath)
  });
  return selectedPaths[0]?.trim() ?? "";
}

async function resolveExecutableForNewSlicerButton(spec: SlicerLauncherSpec, detectedExecutable: string): Promise<string> {
  if (detectedExecutable) {
    const useDetected = window.confirm(`FlowCell found ${spec.displayName} here:\n\n${detectedExecutable}\n\nUse this slicer for this button?\n\nChoose Cancel to pick a recent slicer or browse for a different ${spec.executableLabel}.`);
    if (useDetected) return detectedExecutable;
  }
  const recentChoice = chooseRecentSlicerExecutable();
  if (recentChoice.kind === "cancel") return "";
  if (recentChoice.kind === "path") return recentChoice.path;
  return pickSlicerExecutable(detectedExecutable, spec.executableLabel);
}

async function promptForSlicerButtonName(executablePath: string, fallback: string): Promise<string> {
  const suggestedName = inferSlicerDisplayName(executablePath, fallback);
  try {
    const chosenName = await showTextInputDialog({
      title: "Name Slicer Button",
      prompt: "Name this slicer button. This only renames this button instance.",
      defaultValue: suggestedName
    });
    return readString(chosenName) || suggestedName;
  } catch {
    return suggestedName;
  }
}

function saveSlicerButtonAssignment(context: SlicerLaunchContext, executablePath: string, displayName: string): void {
  const assignments = readSlicerButtonAssignments();
  assignments[slicerButtonAssignmentKey(context.programName, context.panelName, context.fileName)] = {
    executablePath: executablePath.trim(),
    displayName: displayName.trim() || inferSlicerDisplayName(executablePath, "Slicer"),
    updatedAt: new Date().toISOString()
  };
  writeSlicerButtonAssignments(assignments);
  rememberRecentSlicerExecutable(executablePath, displayName);
}

export function applySlicerButtonAssignmentLabels<T extends PanelSlicerScriptRecord>(programName: string, panelName: string, records: T[]): T[] {
  const assignments = readSlicerButtonAssignments();
  return records.map((record) => {
    const assignment = assignments[slicerButtonAssignmentKey(programName, panelName, record.fileName)];
    if (!assignment?.displayName) return record;
    return { ...record, label: assignment.displayName, tooltip: record.tooltip || `Launches ${assignment.executablePath}` };
  });
}

export function clearSlicerButtonAssignments(programName: string, panelName: string, fileNames: string[]): void {
  const assignments = readSlicerButtonAssignments();
  let changed = false;
  for (const fileName of fileNames) {
    const key = slicerButtonAssignmentKey(programName, panelName, fileName);
    if (key in assignments) {
      delete assignments[key];
      changed = true;
    }
  }
  if (changed) writeSlicerButtonAssignments(assignments);
}

export async function handleSlicerLaunchForPanelButton(
  response: PanelScriptRunResponse,
  context: SlicerLaunchContext,
  launchSlicer: (slicerId: SlicerLauncherId, executablePath: string, exportedPaths: string[]) => Promise<string>
): Promise<string> {
  const spec = resolveSlicerLauncherSpec(response);
  const exportedPaths = readStringList(response.exported_paths ?? response.exportedPaths);
  if (exportedPaths.length === 0) throw new Error(`Blender did not return any STL files for ${spec.displayName}.`);
  const assignment = readSlicerButtonAssignments()[slicerButtonAssignmentKey(context.programName, context.panelName, context.fileName)];
  if (assignment?.executablePath) {
    rememberRecentSlicerExecutable(assignment.executablePath, assignment.displayName);
    return launchSlicer(spec.id, assignment.executablePath, exportedPaths);
  }
  const detectedExecutable = readString(response.detected_executable ?? response.detectedExecutable);
  const executablePath = await resolveExecutableForNewSlicerButton(spec, detectedExecutable);
  if (!executablePath) return `${spec.displayName} launch cancelled.`;
  const displayName = await promptForSlicerButtonName(executablePath, spec.displayName);
  saveSlicerButtonAssignment(context, executablePath, displayName);
  return launchSlicer(spec.id, executablePath, exportedPaths);
}
