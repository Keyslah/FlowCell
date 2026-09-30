import type { LayoutSnapshot } from "../../types.js";
import type { ButtonStateDocument } from "../types.js";
import { appendRegularPopoutButtons, panelKey, reconcileAddedPanelButtons } from "./panelPopoutReconciliation.js";
import { buildButtonSettingsFile, buildTransientButtonPopoutSettingsDocument, type ButtonSettingsFile } from "./buttonSettingsFile.js";
import { createButtonSourceIdentity } from "./sourceIdentity.js";

export interface LastLayoutPanelUpdateIO {
  loadLayout(path: string): Promise<LayoutSnapshot>;
  loadSettings(path: string): Promise<ButtonSettingsFile>;
  resolveSettingsPath(path: string, programName: string, panelName: string): Promise<string>;
  saveSettings(path: string, file: ButtonSettingsFile): Promise<unknown>;
}

/** Resolve the saved layout before choosing a group or making any placement. */
export async function prepareLastLayoutPanelUpdates(
  before: ButtonStateDocument, next: ButtonStateDocument, lastLayoutPath: string | null,
  io: LastLayoutPanelUpdateIO
): Promise<() => Promise<void>> {
  const additions = Object.values(next.buttons).filter((button) => !before.buttons[button.id] && panelKey(button));
  if (!lastLayoutPath || !additions.length) return async () => {};
  const layout = await io.loadLayout(lastLayoutPath);
  const writes = new Map<string, ButtonSettingsFile>();
  for (const window of layout.Windows) {
    if (window.Kind !== "button-popout" || !window.ButtonPopoutSettingsPath || !window.ButtonPopoutChoiceId ||
        !window.ProgramName || !window.PanelName) continue;
    const identity = createButtonSourceIdentity(window.ProgramName, window.PanelName, "");
    const key = JSON.stringify([identity.normalizedProgramName, identity.normalizedPanelName]);
    const added = additions.filter((button) => panelKey(button) === key);
    if (!added.length) continue;
    const path = await io.resolveSettingsPath(window.ButtonPopoutSettingsPath, window.ProgramName, window.PanelName);
    const file = await io.loadSettings(path);
    const context = { programName: window.ProgramName, panelName: window.PanelName };
    const transient = buildTransientButtonPopoutSettingsDocument(next, file, context, window.ButtonPopoutChoiceId);
    const unit = transient.document.popoutUnits[transient.popoutUnitId];
    if (unit.kind !== "regular") continue;
    appendRegularPopoutButtons(transient.document, unit, added);
    const updated = buildButtonSettingsFile(transient.document, unit.surfaceId, context);
    updated.sourceSurfaceId = file.sourceSurfaceId;
    writes.set(path, updated);
  }
  reconcileAddedPanelButtons(before, next, layout.Windows);
  // Save external Pop choices only after canonical state passes its revision check.
  return async () => {
    for (const [path, file] of writes) await io.saveSettings(path, file);
  };
}
