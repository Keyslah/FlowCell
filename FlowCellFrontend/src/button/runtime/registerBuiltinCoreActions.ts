import {
  openWindowGridWindow,
  resolveAndOpenInstalledPageWindow
} from "../../lib/coreWindows";
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
  await resolveAndOpenInstalledPageWindow(identity);
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
