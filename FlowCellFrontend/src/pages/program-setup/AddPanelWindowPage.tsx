import { useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { AddPanelWindowContext } from "../../lib/windowContext";
import {
  applyAddPanelPlan,
  emitProgramSetupCommitted,
  finalizeAddPanelPlan,
  listPanelFolders,
  preflightAddPanelPlan,
  prepareAddPanelCanonicalCommit,
  rollbackAddPanelPlan,
  type AddPanelPreflight,
  type AddPanelPlanRequest
} from "../../lib/programRails";
import { showOpenFolderDialog } from "../../lib/tauri";
import {
  buttonStateDocumentsEqual,
  commitButtonStateDocument,
  loadButtonStateDocument
} from "../../button/state/ButtonStateRepository";
import { publishButtonCommit } from "../../button/state/ButtonDraftBus";
import { reconcileProgramPanelOwners } from "../../button/state/panelOwnerButtonOperations";
import {
  buildPanelRailOwnerEntries,
  panelRailOwnerSurfaceBounds
} from "../main/mainLayout";
import "./programSetup.css";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AddPanelWindowPage({ context }: { context: AddPanelWindowContext }) {
  const [panelName, setPanelName] = useState("");
  const [sourceFolder, setSourceFolder] = useState("");
  const [reviewed, setReviewed] = useState<AddPanelPreflight | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    "Create an empty managed panel or copy a safe external folder into it."
  );

  const request = useMemo<AddPanelPlanRequest>(() => ({
    programName: context.programName,
    panelName,
    sourceFolder: sourceFolder.trim() || null
  }), [context.programName, panelName, sourceFolder]);

  const invalidateReview = () => {
    setReviewed(null);
    setStatus("Plan changed. Review it again before creation.");
  };

  const reviewPlan = async () => {
    setBusy(true);
    setStatus("Validating the panel destination and external source without changing either…");
    try {
      const result = await preflightAddPanelPlan(request);
      setReviewed(result);
      setPanelName(result.panelName);
      setSourceFolder(result.sourceFolder || "");
      setStatus(result.existing
        ? "A healthy case-insensitive panel match already exists. FlowCell will only reconcile its canonical owner."
        : "Preflight passed. The source will be copied through private staging; the original will not change.");
    } catch (error) {
      setReviewed(null);
      setStatus(`Preflight failed: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const finishSuccess = async (programName: string, finalPanelName: string) => {
    const latest = await loadButtonStateDocument();
    await publishButtonCommit(latest).catch(() => {});
    await emitProgramSetupCommitted({ kind: "panel", programName, panelName: finalPanelName });
    setStatus(`Panel '${finalPanelName}' is managed by ${programName}.`);
    await getCurrentWindow().close();
  };

  const applyReviewedPlan = async () => {
    if (!reviewed) return;
    setBusy(true);
    setStatus("Publishing the managed panel and canonical owner transaction…");
    let transactionToken = "";
    try {
      const applied = await applyAddPanelPlan(request);
      transactionToken = applied.transactionToken;
      const panels = await listPanelFolders(applied.programName);
      const base = await loadButtonStateDocument();
      const next = structuredClone(base);
      const result = reconcileProgramPanelOwners(next, {
        programName: applied.programName,
        panels: buildPanelRailOwnerEntries(panels),
        surfaceBounds: panelRailOwnerSurfaceBounds,
        removeStaleOwners: false
      });
      const owner = result.owners.find((candidate) =>
        candidate.panelName.localeCompare(applied.panelName, undefined, { sensitivity: "accent" }) === 0
      );
      if (!owner) throw new Error("Canonical reconciliation did not return the new panel owner.");
      await prepareAddPanelCanonicalCommit(transactionToken, owner.buttonId);
      let saved = base;
      if (!buttonStateDocumentsEqual(next, base)) {
        saved = await commitButtonStateDocument(next, base.revision);
      }
      await finalizeAddPanelPlan(transactionToken);
      await publishButtonCommit(saved).catch(() => {});
      await emitProgramSetupCommitted({
        kind: "panel",
        programName: applied.programName,
        panelName: applied.panelName
      });
      setStatus(`Panel '${applied.panelName}' is managed by ${applied.programName}.`);
      await getCurrentWindow().close();
    } catch (error) {
      if (!transactionToken) {
        setStatus(`Panel setup failed: ${errorMessage(error)}`);
      } else {
        try {
          const outcome = await rollbackAddPanelPlan(transactionToken);
          if (outcome === "finalized") {
            await finishSuccess(reviewed.programName, reviewed.panelName);
            return;
          }
          setStatus(`Panel setup failed and its destination was recycled: ${errorMessage(error)}`);
        } catch (rollbackError) {
          setStatus(
            `Panel setup failed: ${errorMessage(error)} Rollback requires startup recovery: ${errorMessage(rollbackError)}`
          );
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="program-setup program-setup--panel">
      <header className="program-setup__header">
        <div><p className="program-setup__eyebrow">Managed lifecycle</p><h1>Add Panel</h1><p>{context.programName}</p></div>
        <button type="button" onClick={() => void getCurrentWindow().close()} disabled={busy}>Close</button>
      </header>
      <section className="program-setup__card program-setup__stack">
        <label>Panel name<input autoFocus value={panelName} onChange={(event) => { setPanelName(event.target.value); invalidateReview(); }} disabled={busy} placeholder="Panel name" /></label>
        <label>Optional external source folder
          <div className="program-setup__inline"><input value={sourceFolder} onChange={(event) => { setSourceFolder(event.target.value); invalidateReview(); }} disabled={busy} placeholder="Leave blank for an empty panel" /><button type="button" disabled={busy} onClick={() => void showOpenFolderDialog({ title: "Choose a safe panel source folder" }).then((paths) => { if (!paths[0]) return; setSourceFolder(paths[0]); invalidateReview(); })}>Browse</button></div>
        </label>
        <p className="program-setup__hint">The source remains read-only. Links, reparse points, traversal, active source records, install records, and FlowCell transaction artifacts are rejected.</p>
      </section>
      {reviewed ? <section className="program-setup__card program-setup__review"><h2>Validated plan</h2><p><strong>Destination:</strong> {reviewed.programName} / {reviewed.panelName}</p><p><strong>Mode:</strong> {reviewed.existing ? "Idempotent existing-panel reconcile" : reviewed.sourceFolder ? "Safe staged copy" : "Empty panel"}</p>{reviewed.sourceFolder ? <p><strong>Copy:</strong> {reviewed.copyFileCount} files, {formatBytes(reviewed.copyByteCount)}</p> : null}</section> : null}
      <footer className="program-setup__footer"><p className="program-setup__status">{status}</p><div>{reviewed ? <button className="program-setup__primary" type="button" onClick={() => void applyReviewedPlan()} disabled={busy}>Add validated panel</button> : <button className="program-setup__primary" type="button" onClick={() => void reviewPlan()} disabled={busy || !panelName.trim()}>Review panel</button>}</div></footer>
    </main>
  );
}
