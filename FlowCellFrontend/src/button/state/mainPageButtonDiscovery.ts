import {
  buildPanelRailOwnerEntries,
  panelRailOwnerSurfaceBounds
} from "../../pages/main/mainLayout.js";
import type { ButtonStateDocument } from "../types.js";
import { ensureFlowCellMainPageButtons } from "./mainPageButtonOperations.js";
import { reconcileProgramPanelOwners } from "./panelOwnerButtonOperations.js";

export interface RegisteredProgramPanels {
  programName: string;
  panelNames: string[];
}

export interface MainPageButtonDiscoveryOptions {
  removeStaleOwners?: boolean;
}

export interface MainPageButtonDiscoveryResult {
  changed: boolean;
  removedOwnerButtonIds: string[];
}

export function reconcileMainPageButtonDiscovery(
  document: ButtonStateDocument,
  registeredPanels: readonly RegisteredProgramPanels[],
  options: MainPageButtonDiscoveryOptions = {}
): MainPageButtonDiscoveryResult {
  let changed = false;
  const removedOwnerButtonIds = new Set<string>();
  for (const entry of registeredPanels) {
    const result = reconcileProgramPanelOwners(document, {
      programName: entry.programName,
      panels: buildPanelRailOwnerEntries(entry.panelNames),
      surfaceBounds: panelRailOwnerSurfaceBounds,
      removeStaleOwners: options.removeStaleOwners
    });
    changed ||= result.changed;
    result.removedOwnerButtonIds.forEach((buttonId) => removedOwnerButtonIds.add(buttonId));
  }
  const mainPageButtonsChanged = ensureFlowCellMainPageButtons(
    document,
    registeredPanels.map((entry) => entry.programName),
    { removeLegacyTemplates: options.removeStaleOwners !== false }
  );
  changed ||= mainPageButtonsChanged;
  return { changed, removedOwnerButtonIds: [...removedOwnerButtonIds] };
}
