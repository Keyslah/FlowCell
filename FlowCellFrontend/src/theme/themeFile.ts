import { invoke } from "@tauri-apps/api/core";
import { showOpenFileDialog, showSaveFileDialog } from "../lib/tauri.js";
import {
  isFlowCellThemeFile,
  normalizeFlowCellThemeFile,
  type FlowCellThemeFile,
  type ThemeTarget
} from "./themeModel.js";
import { isPortableTheme, themeTargetsMatch, type PortableTheme, type ThemeToolDescriptor } from "./portableTheme.js";

const THEME_FILE_FILTER =
  "FlowCell Themes (*.flowtheme.json;*.flowcell-theme-pack.json)|*.flowtheme.json;*.flowcell-theme-pack.json|JSON Files (*.json)|*.json";

export function themeProgramName(target: ThemeTarget): string | null {
  return target.kind === "program" ? target.programName : null;
}

export function flowCellThemeDirectory(target: ThemeTarget): Promise<string> {
  return invoke<string>("get_flowcell_theme_directory", { programName: themeProgramName(target) });
}

function suggestedThemeName(name: string): string {
  const stem = name.trim().replace(/[<>:\"/\\|?*]+/g, "-").replace(/\s+/g, " ") || "FlowCell Theme";
  return stem.toLowerCase().endsWith(".flowtheme.json")
    ? stem
    : `${stem}.flowtheme.json`;
}

export async function saveFlowCellThemeFile(
  theme: FlowCellThemeFile,
  suggestedName: string
): Promise<string | null> {
  if (!isFlowCellThemeFile(theme)) {
    throw new Error("The Theme Editor produced an invalid FlowCell Theme file.");
  }
  const path = await showSaveFileDialog({
    title: "Save FlowCell Theme",
    filter: THEME_FILE_FILTER,
    defaultFileName: suggestedThemeName(suggestedName),
    initialDirectory: await flowCellThemeDirectory(theme.target)
  });
  if (!path) return null;
  return invoke<string>("save_flowcell_theme_file", { path, theme, programName: themeProgramName(theme.target) });
}

export async function loadFlowCellThemeFile(target: ThemeTarget): Promise<{
  path: string;
  theme: FlowCellThemeFile;
} | null> {
  const path = (await showOpenFileDialog({
    title: "Open FlowCell Theme",
    filter: THEME_FILE_FILTER,
    initialDirectory: await flowCellThemeDirectory(target),
    multiselect: false
  }))[0]?.trim();
  if (!path) return null;
  const loaded = await invoke<unknown>("load_flowcell_theme_file", { path, programName: themeProgramName(target) });
  const theme = normalizeFlowCellThemeFile(loaded);
  if (!theme) {
    throw new Error("The selected file is not a supported FlowCell Theme file.");
  }
  if (!themeTargetsMatch(theme.target, target)) throw new Error("This theme belongs to a different target. Select that target before opening it.");
  return { path, theme };
}

export interface ThemeLibraryEntry {
  name: string;
  path: string;
  supplied: boolean;
  format?: string;
  preview?: string | null;
}

export interface ReadThemeResult {
  path: string;
  portable: PortableTheme | null;
  theme: FlowCellThemeFile | null;
  legacy: unknown;
}

export function listThemeLibrary(target: ThemeTarget): Promise<ThemeLibraryEntry[]> {
  return invoke("list_flowcell_themes", { programName: themeProgramName(target) });
}

export async function readTheme(path: string, target: ThemeTarget): Promise<ReadThemeResult> {
  const value = await invoke<unknown>("read_flowcell_theme_archive", { path, programName: themeProgramName(target) });
  if (isPortableTheme(value)) {
    if (!themeTargetsMatch(value.target, target)) throw new Error("This theme belongs to a different target.");
    return { path, portable: value, theme: value.theme, legacy: null };
  }
  const theme = normalizeFlowCellThemeFile(value);
  if (theme && !themeTargetsMatch(theme.target, target)) throw new Error("This theme belongs to a different target.");
  return { path, portable: null, theme, legacy: theme ? null : value };
}

export async function chooseThemeFile(target: ThemeTarget): Promise<ReadThemeResult | null> {
  const path = (await showOpenFileDialog({ title: "Open Theme", filter: THEME_FILE_FILTER,
    initialDirectory: await flowCellThemeDirectory(target), multiselect: false }))[0]?.trim();
  return path ? readTheme(path, target) : null;
}

export async function packageTheme(theme: PortableTheme): Promise<PortableTheme> {
  return invoke("package_flowcell_theme_archive", { theme, programName: themeProgramName(theme.target) });
}

export async function materializeTheme(theme: PortableTheme): Promise<PortableTheme> {
  return invoke("materialize_flowcell_theme_archive", { theme, programName: themeProgramName(theme.target) });
}

/** Read-only descriptors for verified embedded sources; extraction waits for Apply Theme. */
export function archiveSourceDescriptors(theme: PortableTheme): ThemeToolDescriptor[] {
  const sources = (theme as PortableTheme & { sources?: { dependencyId: string }[] }).sources ?? [];
  return sources.flatMap((source) => {
    const dependency = theme.dependencies.find((entry) => entry.id === source.dependencyId);
    if (!dependency) return [];
    const { id, ...identity } = dependency;
    return [{ ...identity, ownerButtonId: "", sourcePath: `theme-source:${id}`, catalogPath: null }];
  });
}

export async function legacyThemeIdentity(value: unknown): Promise<string> {
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable)
    : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : item;
  const bytes = new TextEncoder().encode(JSON.stringify(stable(value)));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `legacy-${[...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function importedThemeFileName(theme: Pick<PortableTheme, "name" | "id">): string {
  const name = theme.name.replace(/[<>:"/\\|?*]+/g, "-");
  const identity = theme.id.replace(/[^a-z0-9]/gi, "").slice(-16);
  return `${name}--${identity}.flowcell-theme-pack.json`;
}

export async function savePortableTheme(theme: PortableTheme, existingPath?: string): Promise<string | null> {
  const archive = await packageTheme(theme);
  const root = await flowCellThemeDirectory(theme.target);
  const canonical = (value: string) => value.replaceAll("\\", "/").toLowerCase();
  const remembered = existingPath && canonical(existingPath).startsWith(`${canonical(root)}/`) ? existingPath : null;
  const path = remembered || await showSaveFileDialog({ title: "Save Theme", filter: THEME_FILE_FILTER,
    defaultFileName: `${theme.name.replace(/[<>:"/\\|?*]+/g, "-")}.flowcell-theme-pack.json`, initialDirectory: root });
  if (!path) return null;
  return invoke("save_flowcell_theme_file", { path, theme: archive, programName: themeProgramName(theme.target) });
}

export async function exportPortableTheme(theme: PortableTheme): Promise<string | null> {
  const path = await showSaveFileDialog({ title: "Export Theme", filter: THEME_FILE_FILTER,
    defaultFileName: `${theme.name.replace(/[<>:"/\\|?*]+/g, "-")}.flowcell-theme-pack.json`,
    initialDirectory: await flowCellThemeDirectory(theme.target) });
  if (!path) return null;
  return invoke("export_flowcell_theme_archive", { path, theme, programName: themeProgramName(theme.target) });
}
