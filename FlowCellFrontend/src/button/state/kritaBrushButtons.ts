import { invoke } from "@tauri-apps/api/core";
import { listPanelFolders } from "../../lib/programRails.js";
import { publishButtonCommit } from "./ButtonDraftBus.js";
import { cloneButtonDocument, createStableButtonId } from "./buttonDefaults.js";
import {
  installButtonSource, loadButtonStateDocument, mergeLegacyInstallsIntoDocument,
  saveButtonStateDocument, type InstallButtonSourceResult
} from "./ButtonStateRepository.js";
import type { ButtonRecord } from "../types.js";

import { applySavedBrushLabels, type SavedBrush } from "./kritaBrushButtonOperations.js";

async function commitBrush(brush: SavedBrush, installed?: InstallButtonSourceResult): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await loadButtonStateDocument();
    const next = installed ? mergeLegacyInstallsIntoDocument(current, [installed]) : cloneButtonDocument(current);
    if (installed) next.buttons[installed.ownerButtonId].metadata.kritaBrushId = brush.id;
    const recovered = next.buttons[`krita-brush-${brush.id}`];
    if (recovered) recovered.metadata.kritaBrushId = brush.id;
    applySavedBrushLabels(next, brush);
    try {
      const saved = await saveButtonStateDocument(next, current.revision);
      await publishButtonCommit(saved);
      return;
    } catch (error) {
      if (attempt === 2 || !String(error).includes("Button state changed before Save.")) throw error;
    }
  }
}

async function importBrush(brush: SavedBrush, panelName: string, ownerButtonId: string): Promise<void> {
  const installed = await installButtonSource({
    ownerButtonId, programName: "Krita", panelName, sourcePath: brush.sourcePath, importKind: "script"
  });
  await commitBrush(brush, installed);
}

export async function addKritaBrushToPanel(button: ButtonRecord, panelName: string): Promise<void> {
  const id = button.metadata.kritaBrushId;
  if (typeof id !== "string") throw new Error("This Button has no saved Krita brush.");
  const panels = await listPanelFolders("Krita");
  const target = panels.find(p => p.toLocaleLowerCase() === panelName.trim().toLocaleLowerCase());
  if (!target) throw new Error("Create that Krita panel with Add Panel first.");
  const brush = await invoke<SavedBrush>("prepare_krita_brush_button", { id });
  const current = await loadButtonStateDocument();
  // Adding the same brush to the same panel is idempotent.
  const existing = Object.values(current.buttons).find(b => b.metadata.kritaBrushId === id &&
    b.sourceIdentity?.normalizedPanelName === target.toLocaleLowerCase());
  if (existing) return;
  await importBrush(brush, target, createStableButtonId("krita-brush"));
}

export function startKritaBrushButtonSync(onError: (error: unknown) => void): () => void {
  let stopped = false;
  let busy = false;
  let lastError = "";
  const poll = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const ids = await invoke<string[]>("pending_krita_brush_buttons");
      for (const id of ids) {
        if (stopped) break;
        const brush = await invoke<SavedBrush>("prepare_krita_brush_button", { id });
        const current = await loadButtonStateDocument();
        const existing = Object.values(current.buttons).filter(b => b.metadata.kritaBrushId === id || b.id === `krita-brush-${id}`);
        if (!existing.length) {
          await importBrush(brush, "Brushes", `krita-brush-${id}`);
        } else if (existing.some(b => b.metadata.kritaBrushRevision !== brush.revision)) {
          await commitBrush(brush);
        }
        await invoke("acknowledge_krita_brush_button", { id, revision: brush.revision });
      }
      lastError = "";
    } catch (error) {
      if (String(error) !== lastError) { lastError = String(error); onError(error); }
    } finally { busy = false; }
  };
  const timer = window.setInterval(() => { void poll(); }, 1500);
  void poll();
  return () => { stopped = true; window.clearInterval(timer); };
}
