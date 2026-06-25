import {
  listDetectedSlicerExecutables,
  showOpenFileDialog,
  showSlicerChoiceDialog,
  showTextInputDialog,
  type SlicerExecutableChoice
} from "./tauri";

type SlicerLauncherId = "orca" | "cura" | "slicer";

type RecentSlicerChoice =
  | { kind: "path"; path: string }
  | { kind: "browse" }
  | { kind: "cancel" };

type SlicerExecutableChooserChoice = SlicerExecutableChoice;

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

const SLICER_BUTTON_ASSIGNMENTS_STORAGE_KEY = "flowcell.slicer.buttonAssignments.v2";
const SLICER_RECENTS_STORAGE_KEY = "flowcell.slicer.recentExecutables.v1";
const MAX_RECENT_SLICERS = 8;
const SLICER_FAMILY_TOKENS = [
  "anycubic",
  "bambu",
  "chitubox",
  "creality",
  "cura",
  "elegoo",
  "flashprint",
  "ideamaker",
  "lychee",
  "mattercontrol",
  "orca",
  "prusa",
  "superslicer",
  "ultimaker"
];
const SLICER_HELPER_EXECUTABLE_TOKENS = [
  "arduino",
  "crash",
  "crashpad",
  "dpinst",
  "driver",
  "engine",
  "helper",
  "maintenancetool",
  "plugin",
  "repair",
  "setup",
  "unins",
  "uninstall",
  "update",
  "updater",
  "vc_redist"
];

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readExecutablePath(value: unknown): string {
  const executablePath = readString(value);
  if (!executablePath || !/\.exe$/i.test(executablePath)) return "";
  const executableMatches = executablePath.match(/\.exe\b/gi)?.length ?? 0;
  return executableMatches === 1 ? executablePath : "";
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

function pathLeaf(path: string): string {
  return path.trim().split(/[\\/]/).pop()?.toLowerCase() ?? "";
}

function parentLeaf(path: string): string {
  const trimmed = path.trim();
  const lastSlash = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (lastSlash <= 0) return "";
  return trimmed.slice(0, lastSlash).split(/[\\/]/).pop()?.toLowerCase() ?? "";
}

function isLikelyHelperSlicerExecutable(path: string): boolean {
  const fileName = pathLeaf(path);
  return SLICER_HELPER_EXECUTABLE_TOKENS.some((token) => fileName.includes(token));
}

function slicerFamilyKey(choice: SlicerExecutableChooserChoice): string {
  const haystack = `${pathLeaf(choice.executablePath)} ${parentLeaf(choice.executablePath)} ${choice.displayName}`.toLowerCase();
  return SLICER_FAMILY_TOKENS.find((token) => haystack.includes(token)) ?? "";
}

function versionVectorFromText(text: string): number[] {
  let best: number[] = [];
  for (const token of text.split(/[^0-9.]+/)) {
    if (!token.includes(".")) continue;
    const parts = token.split(".").map((part) => Number.parseInt(part, 10)).filter(Number.isFinite);
    if (compareVersionVectors(parts, best) > 0) best = parts;
  }
  return best;
}

function compareVersionVectors(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function shouldReplaceSlicerChoice(candidate: SlicerExecutableChooserChoice, existing: SlicerExecutableChooserChoice): boolean {
  const candidateVersion = versionVectorFromText(candidate.executablePath);
  const existingVersion = versionVectorFromText(existing.executablePath);
  const versionDifference = compareVersionVectors(candidateVersion, existingVersion);
  if (versionDifference !== 0) return versionDifference > 0;
  if (candidate.source === "Found" && existing.source !== "Found") return true;
  return false;
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
    const executablePath = readExecutablePath(assignment?.executablePath);
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
    const executablePath = readExecutablePath(item?.executablePath);
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
  const trimmedPath = readExecutablePath(executablePath);
  if (!trimmedPath) return;
  const next = [
    { executablePath: trimmedPath, displayName: displayName.trim() || inferSlicerDisplayName(trimmedPath, "Slicer"), updatedAt: new Date().toISOString() },
    ...readRecentSlicerExecutables().filter((item) => item.executablePath.toLowerCase() !== trimmedPath.toLowerCase())
  ];
  writeJsonStorage(SLICER_RECENTS_STORAGE_KEY, next.slice(0, MAX_RECENT_SLICERS));
}

function pushUniqueSlicerChoice(
  choices: SlicerExecutableChooserChoice[],
  seen: Set<string>,
  choice: SlicerExecutableChooserChoice
): void {
  const executablePath = readExecutablePath(choice.executablePath);
  if (!executablePath || isLikelyHelperSlicerExecutable(executablePath)) return;
  const key = executablePath.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  choices.push({
    displayName: readString(choice.displayName) || inferSlicerDisplayName(executablePath, "Slicer"),
    executablePath,
    source: readString(choice.source)
  });
}

function latestSlicerChoices(choices: SlicerExecutableChooserChoice[]): SlicerExecutableChooserChoice[] {
  const passthroughChoices: Array<{ index: number; choice: SlicerExecutableChooserChoice }> = [];
  const familyChoices = new Map<string, { index: number; choice: SlicerExecutableChooserChoice }>();

  choices.forEach((choice, index) => {
    const familyKey = slicerFamilyKey(choice);
    if (!familyKey) {
      passthroughChoices.push({ index, choice });
      return;
    }
    const existing = familyChoices.get(familyKey);
    if (!existing) {
      familyChoices.set(familyKey, { index, choice });
      return;
    }
    if (shouldReplaceSlicerChoice(choice, existing.choice)) {
      familyChoices.set(familyKey, { index: existing.index, choice });
    }
  });

  return [...passthroughChoices, ...familyChoices.values()]
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.choice);
}

async function readAvailableSlicerExecutableChoices(
  suggestedChoice?: SlicerExecutableChooserChoice
): Promise<SlicerExecutableChooserChoice[]> {
  const choices: SlicerExecutableChooserChoice[] = [];
  const seen = new Set<string>();

  if (suggestedChoice) pushUniqueSlicerChoice(choices, seen, suggestedChoice);

  for (const recent of readRecentSlicerExecutables()) {
    pushUniqueSlicerChoice(choices, seen, {
      displayName: recent.displayName,
      executablePath: recent.executablePath,
      source: "Recent"
    });
  }

  const detected = await listDetectedSlicerExecutables().catch(() => []);
  for (const item of detected) {
    pushUniqueSlicerChoice(choices, seen, {
      displayName: item.displayName,
      executablePath: item.executablePath,
      source: readString(item.source) || "Detected"
    });
  }

  return latestSlicerChoices(choices);
}

async function chooseSlicerExecutable(suggestedChoice?: SlicerExecutableChooserChoice): Promise<RecentSlicerChoice> {
  const choices = await readAvailableSlicerExecutableChoices(suggestedChoice);
  if (choices.length === 0 || typeof window === "undefined") return { kind: "browse" };

  try {
    const result = await showSlicerChoiceDialog({
      title: "Choose Slicer",
      choices
    });
    if (!result) return { kind: "cancel" };
    if (result.kind === "browse") return { kind: "browse" };
    const executablePath = readExecutablePath(result.executablePath);
    return executablePath ? { kind: "path", path: executablePath } : { kind: "cancel" };
  } catch {
    return { kind: "browse" };
  }
}

async function pickSlicerExecutable(initialPath: string, executableLabel: string): Promise<string> {
  const selectedPaths = await showOpenFileDialog({
    title: `Choose ${executableLabel || "Slicer EXE"}`,
    filter: "Executable (*.exe)|*.exe|All Files (*.*)|*.*",
    initialDirectory: initialDirectoryFromPath(initialPath)
  });
  return readExecutablePath(selectedPaths[0]);
}

async function resolveExecutableForNewSlicerButton(spec: SlicerLauncherSpec, detectedExecutable: string): Promise<string> {
  const detectedPath = readExecutablePath(detectedExecutable);
  const recentChoice = await chooseSlicerExecutable(
    detectedPath
      ? {
          displayName: spec.displayName,
          executablePath: detectedPath,
          source: "Found"
        }
      : undefined
  );
  if (recentChoice.kind === "cancel") return "";
  if (recentChoice.kind === "path") return recentChoice.path;
  return pickSlicerExecutable(detectedPath, spec.executableLabel);
}

async function promptForSlicerButtonName(executablePath: string, fallback: string): Promise<string> {
  const suggestedName = inferSlicerDisplayName(executablePath, fallback);
  if (typeof window === "undefined") return suggestedName;
  let chosenName: string | null = null;
  try {
    chosenName = await showTextInputDialog({
      title: "Name Slicer Button",
      prompt: "Name this slicer button. This only renames this button instance.",
      defaultValue: suggestedName
    });
  } catch {
    chosenName = window.prompt(
      "Name this slicer button. This only renames this button instance.",
      suggestedName
    );
  }
  return readString(chosenName) || suggestedName;
}

function saveSlicerButtonAssignment(context: SlicerLaunchContext, executablePath: string, displayName: string): void {
  const normalizedExecutablePath = readExecutablePath(executablePath);
  if (!normalizedExecutablePath) return;
  const assignments = readSlicerButtonAssignments();
  assignments[slicerButtonAssignmentKey(context.programName, context.panelName, context.fileName)] = {
    executablePath: normalizedExecutablePath,
    displayName: displayName.trim() || inferSlicerDisplayName(normalizedExecutablePath, "Slicer"),
    updatedAt: new Date().toISOString()
  };
  writeSlicerButtonAssignments(assignments);
  rememberRecentSlicerExecutable(normalizedExecutablePath, displayName);
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
    try {
      const message = await launchSlicer(spec.id, assignment.executablePath, exportedPaths);
      rememberRecentSlicerExecutable(assignment.executablePath, assignment.displayName);
      return message;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/slicer exe was not found/i.test(message)) throw error;
      clearSlicerButtonAssignments(context.programName, context.panelName, [context.fileName]);
    }
  }
  const detectedExecutable = readString(response.detected_executable ?? response.detectedExecutable);
  const executablePath = await resolveExecutableForNewSlicerButton(spec, detectedExecutable);
  if (!executablePath) return `${spec.displayName} launch cancelled.`;
  const displayName = await promptForSlicerButtonName(executablePath, spec.displayName);
  saveSlicerButtonAssignment(context, executablePath, displayName);
  return launchSlicer(spec.id, executablePath, exportedPaths);
}
