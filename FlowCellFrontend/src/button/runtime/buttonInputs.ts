import { invoke } from "@tauri-apps/api/core";
import { Menu } from "@tauri-apps/api/menu";
import { loadButtonStateDocument } from "../state/ButtonStateRepository";
import type { ButtonRecord, ButtonStateDocument } from "../types.js";

function sourceArguments(button: ButtonRecord | undefined) {
  const source = button?.sourceIdentity;
  return source ? {
    programName: source.displayProgramName,
    panelName: source.displayPanelName,
    fileName: source.displayFileName
  } : null;
}

async function inputSource(button: ButtonRecord | undefined, document?: ButtonStateDocument) {
  const source = sourceArguments(button);
  if (source) return source;
  if (button?.toolSetParentId) {
    const current = document ?? await loadButtonStateDocument();
    return sourceArguments(current.buttons[button.toolSetParentId]);
  }
  return null;
}

/** Only explicit Button-configuration capabilities qualify, not host-program fields or pages. */
export async function hasEditableButtonInputs(button: ButtonRecord | undefined, document?: ButtonStateDocument): Promise<boolean> {
  const source = await inputSource(button, document);
  if (!source) return false;
  const response = await invoke<{ hasEditableInputs?: boolean }>("run_panel_script_response", {
    ...source, inspectInputs: true
  });
  return response.hasEditableInputs === true;
}

export async function editButtonInputs(button: ButtonRecord): Promise<void> {
  const source = await inputSource(button);
  if (!source) throw new Error("This Button has no declared editable inputs.");
  await invoke("run_panel_script_response", { ...source, editInputs: true });
}

let contextRequest = 0;
let inputsMenu: Menu | null = null;

/** Native menus stay usable outside the small transparent Pop/Fan button bounds. */
export async function showButtonInputsContextMenu(button: ButtonRecord): Promise<void> {
  const request = ++contextRequest;
  if (!await hasEditableButtonInputs(button) || request !== contextRequest) return;
  const menu = await Menu.new({ items: [{
    id: "flowcell-edit-button-inputs", text: "Edit Inputs…",
    action: () => {
      void editButtonInputs(button).catch((error) => window.alert(String(error)));
    }
  }] });
  if (request !== contextRequest) { await menu.close(); return; }
  const previous = inputsMenu;
  inputsMenu = menu;
  await previous?.close();
  await menu.popup();
}
