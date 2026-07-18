import type { ButtonStateDocument } from "../types";
import { loadButtonStateDocument } from "../state/ButtonStateRepository";
import { subscribeButtonCommits } from "../state/ButtonDraftBus";
import { createLatestDesiredRegistrationCoordinator } from "./latestDesiredRegistration";

const LEGACY_PROGRAM_ACTION_IDS = new Set([
  "open-illustrator-layer-tree",
  "open-window-grid",
  "sample-blender-theme-image",
  "save-blender-theme-fields",
  "load-blender-theme-fields"
]);

function needsLegacyProgramActions(document: ButtonStateDocument): boolean {
  return Object.values(document.buttons).some((button) =>
    button.executionTarget?.kind === "core-action" &&
    LEGACY_PROGRAM_ACTION_IDS.has(button.executionTarget.actionId)
  );
}

function reportCompatibilityActionError(message: string, error: unknown): void {
  console.error(message, error);
}

/** Loads the old program adapters only while an installed legacy Button still references them. */
export function registerInstalledCompatibilityActions(): () => void {
  let disposed = false;
  let observedCommit = false;
  let unlisten: (() => void) | null = null;
  const coordinator = createLatestDesiredRegistrationCoordinator(async () => {
    const contribution = await import("./registerLegacyProgramCoreActions");
    return contribution.registerLegacyProgramCoreActions;
  });

  const synchronizeFromCommit = (document: ButtonStateDocument) => {
    if (disposed) return;
    observedCommit = true;
    void coordinator.setDesired(needsLegacyProgramActions(document)).catch((error) => {
      reportCompatibilityActionError("Failed to synchronize installed compatibility actions.", error);
    });
  };

  void (async () => {
    const nextUnlisten = await subscribeButtonCommits(synchronizeFromCommit);
    if (disposed) {
      nextUnlisten();
      return;
    }
    unlisten = nextUnlisten;

    const document = await loadButtonStateDocument();
    if (!disposed && !observedCommit) {
      await coordinator.setDesired(needsLegacyProgramActions(document));
    }
  })().catch((error) => {
    reportCompatibilityActionError("Failed to load installed compatibility actions.", error);
  });

  return () => {
    if (disposed) return;
    disposed = true;
    unlisten?.();
    unlisten = null;
    void coordinator.dispose().catch((error) => {
      reportCompatibilityActionError("Failed to dispose installed compatibility actions.", error);
    });
  };
}
