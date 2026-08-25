import { invoke } from "@tauri-apps/api/core";
import { showOpenFileDialog, showSaveFileDialog } from "../lib/tauri.js";
import {
  isFlowCellThemeFile,
  type FlowCellThemeFile
} from "./themeModel.js";

const THEME_FILE_FILTER =
  "FlowCell Theme (*.flowtheme.json)|*.flowtheme.json|JSON Files (*.json)|*.json";

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
    defaultFileName: suggestedThemeName(suggestedName)
  });
  if (!path) return null;
  return invoke<string>("save_flowcell_theme_file", { path, theme });
}

export async function loadFlowCellThemeFile(): Promise<{
  path: string;
  theme: FlowCellThemeFile;
} | null> {
  const path = (await showOpenFileDialog({
    title: "Open FlowCell Theme",
    filter: THEME_FILE_FILTER,
    multiselect: false
  }))[0]?.trim();
  if (!path) return null;
  const theme = await invoke<unknown>("load_flowcell_theme_file", { path });
  if (!isFlowCellThemeFile(theme)) {
    throw new Error("The selected file is not a supported FlowCell Theme file.");
  }
  return { path, theme };
}
