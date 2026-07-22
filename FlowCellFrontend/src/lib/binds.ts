import { invoke } from "@tauri-apps/api/core";
import type { BindsWorkspaceData, FlowCellBindingsState } from "../types";

export async function loadBindsWorkspace(): Promise<BindsWorkspaceData> {
  return invoke("load_binds_workspace");
}

export async function saveBindShortcut(args: {
  programName: string;
  programTabId: number;
  target: string;
  targetKind: "script" | "tool-set-owner" | "tool-set-child";
  ownerButtonId?: string;
  bindingId: number;
  shortcut: string;
}): Promise<{
  message: string;
  bindings: FlowCellBindingsState;
}> {
  return invoke("save_bind_shortcut", {
    request: {
      programName: args.programName,
      programTabId: args.programTabId,
      target: args.target,
      targetKind: args.targetKind,
      ownerButtonId: args.ownerButtonId,
      bindingId: args.bindingId,
      shortcut: args.shortcut
    }
  });
}

export async function saveCoreActionShortcut(args: {
  actionId: string;
  shortcut: string;
}): Promise<{
  message: string;
  bindings: FlowCellBindingsState;
}> {
  return invoke("save_core_action_shortcut", {
    request: {
      actionId: args.actionId,
      shortcut: args.shortcut
    }
  });
}

