import { invoke } from "@tauri-apps/api/core";

import { openInstalledPageWindow, openWindowGridWindow } from "../../lib/coreWindows";
import type { CoreActionExecutionTarget, JsonValue } from "../types";
import type { ButtonCoreActionContext } from "./ButtonRuntimeAdapter";
import { registerButtonCoreAction } from "./ButtonRuntimeAdapter";

type CoreActionHandler = (
  target: CoreActionExecutionTarget,
  context: ButtonCoreActionContext
) => Promise<unknown>;

function payloadString(payload: Readonly<Record<string, JsonValue>> | undefined, key: string): string {
  const value = payload?.[key];
  return typeof value === "string" ? value.trim() : "";
}

interface InstalledPageOpenDescriptor {
  ownerButtonId: string;
  programName: string;
  panelName: string;
  fileName: string;
  pageId: string;
  window: {
    title: string;
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
  };
}

const openInstalledPage: CoreActionHandler = async (target) => {
  const identity = {
    ownerButtonId: payloadString(target.payload, "ownerButtonId"),
    programName: payloadString(target.payload, "programName"),
    panelName: payloadString(target.payload, "panelName"),
    fileName: payloadString(target.payload, "fileName"),
    pageId: payloadString(target.payload, "pageId")
  };
  if (Object.values(identity).some((value) => !value)) {
    throw new Error("The installed page Button is missing its active owner identity.");
  }
  const descriptor = await invoke<InstalledPageOpenDescriptor>("resolve_installed_page", identity);
  await openInstalledPageWindow({
    ...identity,
    title: descriptor.window.title,
    width: descriptor.window.width,
    height: descriptor.window.height,
    minWidth: descriptor.window.minWidth,
    minHeight: descriptor.window.minHeight
  });
  return { opened: true };
};

export function registerBuiltinButtonCoreActions(): () => void {
  const unregister = [
    registerButtonCoreAction("open-installed-page", openInstalledPage),
    registerButtonCoreAction("open-window-grid", async () => {
      await openWindowGridWindow();
      return { opened: true };
    })
  ];
  return () => unregister.reverse().forEach((dispose) => dispose());
}
