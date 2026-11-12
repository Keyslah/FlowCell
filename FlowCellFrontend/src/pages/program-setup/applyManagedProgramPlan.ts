import {
  applyAddProgramPlan,
  emitProgramSetupCommitted,
  finalizeAddProgramPlan,
  listProgramSetupStatuses,
  prepareAddProgramCanonicalCommit,
  rollbackAddProgramPlan,
  type AddProgramPlanRequest,
  type ProgramSetupResult
} from "../../lib/programRails.js";
import {
  buttonStateDocumentsEqual,
  commitButtonStateDocument,
  loadButtonStateDocument,
  reconcileBundledProgramSources
} from "../../button/state/ButtonStateRepository.js";
import { publishButtonCommit } from "../../button/state/ButtonDraftBus.js";
import { reconcileProgramPanelOwners } from "../../button/state/panelOwnerButtonOperations.js";
import { buildPanelRailOwnerEntries, panelRailOwnerSurfaceBounds } from "../main/mainLayout.js";

const defaultOperations = {
  apply: applyAddProgramPlan,
  load: loadButtonStateDocument,
  prepare: prepareAddProgramCanonicalCommit,
  commit: commitButtonStateDocument,
  finalize: finalizeAddProgramPlan,
  rollback: rollbackAddProgramPlan,
  statuses: listProgramSetupStatuses,
  publish: publishButtonCommit,
  notify: emitProgramSetupCommitted
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The native install and canonical Buttons are one recoverable setup transaction. */
export async function applyManagedProgramPlan(
  request: AddProgramPlanRequest,
  operations: typeof defaultOperations = defaultOperations,
  onProgress: (stage: string) => void = () => {}
): Promise<ProgramSetupResult> {
  let token = "";
  let result: ProgramSetupResult;
  try {
    const applied = await operations.apply(request);
    token = applied.transactionToken;
    onProgress("Saving installed buttons and panel choices…");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const base = await operations.load();
      const next = reconcileBundledProgramSources(base, applied.descriptors);
      const panels = reconcileProgramPanelOwners(next, {
        programName: applied.programName,
        panels: buildPanelRailOwnerEntries(applied.panels),
        surfaceBounds: panelRailOwnerSurfaceBounds,
        removeStaleOwners: false
      });
      const expectedIds = [
        ...applied.descriptors.map((descriptor) => String(descriptor.ownerButtonId ?? "")),
        ...panels.owners.map((owner) => owner.buttonId)
      ].filter(Boolean);
      await operations.prepare(token, expectedIds);
      try {
        if (!buttonStateDocumentsEqual(next, base)) await operations.commit(next, base.revision);
        break;
      } catch (error) {
        // Main stays usable during setup. Merge a concurrent Button save into
        // the same native transaction instead of rolling that transaction back.
        if (attempt === 2 || !message(error).includes("Button state changed before Save.")) throw error;
      }
    }
    onProgress("Finishing application setup…");
    result = await operations.finalize(token);
  } catch (error) {
    if (!token) throw error;
    let outcome: "finalized" | "rolled-back";
    try {
      outcome = await operations.rollback(token);
    } catch (rollbackError) {
      throw new Error(`Program setup failed: ${message(error)} Rollback requires startup recovery: ${message(rollbackError)}`);
    }
    if (outcome !== "finalized") {
      throw new Error(`Program setup failed and was fully rolled back: ${message(error)}`);
    }
    const recovered = (await operations.statuses()).find(
      (entry) => entry.programName.toLowerCase() === request.programName.toLowerCase()
    );
    if (!recovered) throw new Error(`Program '${request.programName}' was added, but its saved setup status could not be read. Restart FlowCell to refresh it.`);
    result = recovered;
  }

  // Notification failures cannot undo a completed install or turn it into an install retry.
  try {
    await operations.notify({ kind: "program", programName: result.programName });
  } catch (error) {
    console.warn("Program was added, but its navigation could not be refreshed.", error);
  }
  try {
    onProgress("Refreshing FlowCell…");
    await operations.publish(await operations.load());
  } catch (error) {
    console.warn("Program was added, but its Button state could not be published.", error);
  }
  return result;
}
