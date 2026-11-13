import {
  applyAddProgramPlan,
  emitProgramSetupCommitted,
  finalizeAddProgramPlan,
  listProgramSetupStatuses,
  preflightAddProgramPlan,
  prepareAddProgramCanonicalCommit,
  rollbackAddProgramPlan,
  type AddProgramPlanRequest,
  type ProgramSetupResult,
  type AppliedProgramSetup
} from "../../lib/programRails.js";
import {
  buttonStateDocumentsEqual,
  commitButtonStateDocument,
  loadButtonStateDocument
} from "../../button/state/ButtonStateRepository.js";
import { publishButtonCommit } from "../../button/state/ButtonDraftBus.js";
import { applyProgramDefaultTheme, buildProgramSetupDocument } from "./programDefaultTheme.js";

const defaultOperations = {
  preflight: preflightAddProgramPlan,
  apply: applyAddProgramPlan,
  load: loadButtonStateDocument,
  prepare: prepareAddProgramCanonicalCommit,
  commit: commitButtonStateDocument,
  finalize: finalizeAddProgramPlan,
  rollback: rollbackAddProgramPlan,
  statuses: listProgramSetupStatuses,
  publish: publishButtonCommit,
  notify: emitProgramSetupCommitted,
  theme: applyProgramDefaultTheme
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
  request = { ...request, clientStartedAtMs: Date.now() };
  let token = "";
  let result: ProgramSetupResult;
  try {
    let applied: AppliedProgramSetup | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      onProgress("Validating the selected buttons and layout before installation…");
      const [preview, base] = await Promise.all([operations.preflight(request), operations.load()]);
      if (request.applyDefaultTheme && !preview.defaultTheme) {
        throw new Error("The Program installer did not return its requested packaged appearance.");
      }
      await buildProgramSetupDocument(base, preview, operations.theme);
      if ((await operations.load()).revision !== base.revision) {
        if (attempt === 2) throw new Error("Button state changed before program installation. Retry setup.");
        continue;
      }
      try {
        applied = await operations.apply({ ...request,
          expectedPlanFingerprint: preview.planFingerprint, expectedButtonRevision: base.revision });
        break;
      } catch (error) {
        if (attempt === 2 || !message(error).includes("Button state changed before program installation.")) throw error;
      }
    }
    if (!applied) throw new Error("Program setup preview could not be confirmed. Retry setup.");
    token = applied.transactionToken;
    if (request.applyDefaultTheme && !applied.defaultTheme) {
      throw new Error("The Program installer did not return its requested packaged appearance.");
    }
    onProgress("Saving installed buttons and panel choices…");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const base = await operations.load();
      if (applied.defaultTheme) {
        onProgress("Applying the packaged appearance and layout…");
      }
      const { document: next, expectedButtonIds: expectedIds } = await buildProgramSetupDocument(base, applied, operations.theme);
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
      onProgress("Undoing the incomplete program setup…");
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
