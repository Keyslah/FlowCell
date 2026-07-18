import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const SCOPED_WINDOW_INPUT_STATE_EVENT = "flowcell-scoped-window-input-state";

export interface ForegroundProcessInfo {
  processName: string;
  processPath: string;
}

export function getForegroundProcessInfo(): Promise<ForegroundProcessInfo> {
  return invoke("get_foreground_process_info");
}

export function setHostWindowTopmost(
  label: string,
  topmost: boolean,
  promote?: boolean
): Promise<void> {
  return invoke("set_host_window_topmost", { label, topmost, promote });
}

export function registerScopedWindowTopmost(
  label: string,
  programName: string,
  selectiveInput = false
): Promise<string[]> {
  return invoke("register_scoped_window_topmost", {
    label,
    programName,
    selectiveInput
  });
}

export function refreshScopedWindowTopmost(label: string): Promise<void> {
  return invoke("refresh_scoped_window_topmost", { label });
}

export function unregisterScopedWindowTopmost(label: string): Promise<void> {
  return invoke("unregister_scoped_window_topmost", { label });
}

export function getScopedWindowInputState(label: string): Promise<boolean> {
  return invoke("get_scoped_window_input_state", { label });
}

export function listenScopedWindowInputState(
  label: string,
  onActiveChange: (active: boolean) => void
): Promise<UnlistenFn> {
  return listen<{ label: string; active: boolean }>(
    SCOPED_WINDOW_INPUT_STATE_EVENT,
    ({ payload }) => {
      if (payload?.label === label && typeof payload.active === "boolean") {
        onActiveChange(payload.active);
      }
    }
  );
}

export function showOpenFileDialog(args: {
  title: string;
  filter: string;
  initialDirectory?: string;
  multiselect?: boolean;
  parentLabel?: string;
}): Promise<string[]> {
  return invoke("show_open_file_dialog", {
    title: args.title,
    filter: args.filter,
    initialDirectory: args.initialDirectory,
    multiselect: args.multiselect ?? false,
    parentLabel: args.parentLabel ?? getCurrentWindow().label
  });
}

export function showOpenFolderDialog(args: {
  title: string;
  initialDirectory?: string;
  multiselect?: boolean;
  parentLabel?: string;
}): Promise<string[]> {
  return invoke("show_open_folder_dialog", {
    title: args.title,
    initialDirectory: args.initialDirectory,
    multiselect: args.multiselect ?? false,
    parentLabel: args.parentLabel ?? getCurrentWindow().label
  });
}

export function showSaveFileDialog(args: {
  title: string;
  filter: string;
  defaultFileName?: string;
  initialDirectory?: string;
  parentLabel?: string;
}): Promise<string | null> {
  return invoke("show_save_file_dialog", {
    title: args.title,
    filter: args.filter,
    defaultFileName: args.defaultFileName,
    initialDirectory: args.initialDirectory,
    parentLabel: args.parentLabel ?? getCurrentWindow().label
  });
}
