import { listPanelFolders, listProgramFolders } from "../../lib/programRails.js";
import { closeButtonFanWindow } from "../windows/buttonWindows.js";
import type { ButtonStateDocument } from "../types.js";
import { cloneButtonDocument } from "./buttonDefaults.js";
import { publishButtonCommit } from "./ButtonDraftBus.js";
import {
  loadButtonStateDocument,
  saveButtonStateDocument
} from "./ButtonStateRepository.js";
import {
  reconcileMainPageButtonDiscovery,
  type MainPageButtonDiscoveryOptions,
  type RegisteredProgramPanels
} from "./mainPageButtonDiscovery.js";

export {
  reconcileMainPageButtonDiscovery,
  type MainPageButtonDiscoveryOptions,
  type RegisteredProgramPanels
} from "./mainPageButtonDiscovery.js";

export interface MainPageButtonBootstrap {
  document: ButtonStateDocument;
  registeredPanels: RegisteredProgramPanels[];
}

export async function loadMainPageButtonBootstrap(
  options: MainPageButtonDiscoveryOptions = {}
): Promise<MainPageButtonBootstrap> {
  const programNames = await listProgramFolders();
  const registeredPanels = await Promise.all(programNames.map(async (programName) => ({
    programName,
    panelNames: await listPanelFolders(programName)
  })));

  let current = await loadButtonStateDocument();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = cloneButtonDocument(current);
    const reconciliation = reconcileMainPageButtonDiscovery(next, registeredPanels, options);
    if (!reconciliation.changed) return { document: current, registeredPanels };

    try {
      const saved = await saveButtonStateDocument(next, current.revision);
      await publishButtonCommit(saved);
      await Promise.all(
        reconciliation.removedOwnerButtonIds.map((buttonId) => closeButtonFanWindow(buttonId))
      );
      return { document: saved, registeredPanels };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 2 || !message.includes("Button state changed before Save.")) throw error;
      current = await loadButtonStateDocument();
    }
  }
  throw new Error("Panel Buttons could not be reconciled into Button state.");
}
