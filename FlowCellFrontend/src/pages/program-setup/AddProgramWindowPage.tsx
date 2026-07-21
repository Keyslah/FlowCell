import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  applyAddProgramPlan,
  emitProgramSetupCommitted,
  finalizeAddProgramPlan,
  listAvailableProgramPackages,
  preflightAddProgramPlan,
  prepareAddProgramCanonicalCommit,
  rollbackAddProgramPlan,
  type AddProgramPlanRequest,
  type AddProgramPreflight,
  type AvailableProgramPackage,
  type AvailableProgramPackagesResponse
} from "../../lib/programRails";
import { showOpenFileDialog } from "../../lib/tauri";
import {
  buttonStateDocumentsEqual,
  commitButtonStateDocument,
  loadButtonStateDocument,
  reconcileBundledProgramSources
} from "../../button/state/ButtonStateRepository";
import { publishButtonCommit } from "../../button/state/ButtonDraftBus";
import { reconcileProgramPanelOwners } from "../../button/state/panelOwnerButtonOperations";
import {
  buildPanelRailOwnerEntries,
  panelRailOwnerSurfaceBounds
} from "../main/mainLayout";
import "./programSetup.css";

type SetupMode = "register" | "everything" | "custom";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sourceClosure(program: AvailableProgramPackage, seed: Iterable<string>): Set<string> {
  const selected = new Set(seed);
  let changed = true;
  while (changed) {
    changed = false;
    for (const source of program.sources) {
      if (!selected.has(source.id)) continue;
      for (const dependency of source.dependencies) {
        if (selected.has(dependency)) continue;
        selected.add(dependency);
        changed = true;
      }
    }
  }
  return selected;
}

function defaultSetup(program: AvailableProgramPackage): {
  panels: Set<string>;
  sources: Set<string>;
  destinations: Record<string, string>;
} {
  const sources = sourceClosure(
    program,
    program.sources.filter((source) => source.required || source.defaultSelected).map((source) => source.id)
  );
  const panels = new Set(
    program.panels.filter((panel) => panel.defaultSelected).map((panel) => panel.label)
  );
  const destinations: Record<string, string> = {};
  for (const source of program.sources) {
    destinations[source.id] = source.panelName;
    if (sources.has(source.id)) panels.add(source.panelName);
  }
  return { panels, sources, destinations };
}

export default function AddProgramWindowPage() {
  const [inventory, setInventory] = useState<AvailableProgramPackagesResponse | null>(null);
  const [selectedProgramName, setSelectedProgramName] = useState("");
  const [executablePath, setExecutablePath] = useState("");
  const [hostConfirmed, setHostConfirmed] = useState(false);
  const [mode, setMode] = useState<SetupMode>("custom");
  const [selectedPanels, setSelectedPanels] = useState<Set<string>>(new Set());
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [destinations, setDestinations] = useState<Record<string, string>>({});
  const [reviewed, setReviewed] = useState<AddProgramPreflight | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Loading Program packages…");

  const selectedProgram = useMemo(
    () => inventory?.packages.find((program) => program.programName === selectedProgramName) ?? null,
    [inventory, selectedProgramName]
  );

  const resetForProgram = (program: AvailableProgramPackage) => {
    const setup = defaultSetup(program);
    setExecutablePath(program.suggestedExecutable);
    setHostConfirmed(false);
    setMode("custom");
    setSelectedPanels(setup.panels);
    setSelectedSources(setup.sources);
    setDestinations(setup.destinations);
    setReviewed(null);
    setStatus("Choose the exact Program contributions FlowCell should enable.");
  };

  useEffect(() => {
    let cancelled = false;
    void listAvailableProgramPackages()
      .then((next) => {
        if (cancelled) return;
        setInventory(next);
        const first = next.packages[0];
        if (!first) {
          setStatus("No validated, unregistered Program packages are available.");
          return;
        }
        setSelectedProgramName(first.programName);
        resetForProgram(first);
      })
      .catch((error) => {
        if (!cancelled) setStatus(`Program package inventory failed: ${errorMessage(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const invalidateReview = () => {
    setReviewed(null);
    setStatus("Plan changed. Review it again before installation.");
  };

  const chooseProgram = (programName: string) => {
    const program = inventory?.packages.find((candidate) => candidate.programName === programName);
    if (!program) return;
    setSelectedProgramName(program.programName);
    resetForProgram(program);
  };

  const applyMode = (nextMode: SetupMode) => {
    if (!selectedProgram) return;
    setMode(nextMode);
    if (nextMode === "register") {
      setSelectedPanels(new Set());
      setSelectedSources(new Set());
    } else if (nextMode === "everything") {
      setSelectedPanels(new Set(selectedProgram.panels.map((panel) => panel.label)));
      setSelectedSources(new Set(selectedProgram.sources.map((source) => source.id)));
      setDestinations(Object.fromEntries(
        selectedProgram.sources.map((source) => [source.id, source.panelName])
      ));
    } else {
      const setup = defaultSetup(selectedProgram);
      setSelectedPanels(setup.panels);
      setSelectedSources(setup.sources);
      setDestinations(setup.destinations);
    }
    invalidateReview();
  };

  const dependencyLocks = useMemo(() => {
    const locks = new Set<string>();
    if (!selectedProgram || mode === "register") return locks;
    for (const source of selectedProgram.sources) {
      if (!selectedSources.has(source.id)) continue;
      source.dependencies.forEach((dependency) => locks.add(dependency));
    }
    return locks;
  }, [mode, selectedProgram, selectedSources]);

  const toggleSource = (sourceId: string, checked: boolean) => {
    if (!selectedProgram || mode === "register") return;
    const source = selectedProgram.sources.find((candidate) => candidate.id === sourceId);
    if (!source) return;
    if (!checked && (source.required || dependencyLocks.has(source.id))) return;
    const next = new Set(selectedSources);
    if (checked) {
      sourceClosure(selectedProgram, [source.id]).forEach((id) => next.add(id));
    } else {
      next.delete(source.id);
    }
    const nextPanels = new Set(selectedPanels);
    for (const candidate of selectedProgram.sources) {
      if (next.has(candidate.id)) nextPanels.add(destinations[candidate.id] || candidate.panelName);
    }
    setMode("custom");
    setSelectedSources(next);
    setSelectedPanels(nextPanels);
    invalidateReview();
  };

  const togglePanel = (panelName: string, checked: boolean) => {
    if (mode === "register") return;
    const inUse = Array.from(selectedSources).some((sourceId) =>
      (destinations[sourceId] || selectedProgram?.sources.find((source) => source.id === sourceId)?.panelName) === panelName
    );
    if (!checked && inUse) return;
    const next = new Set(selectedPanels);
    if (checked) next.add(panelName); else next.delete(panelName);
    setMode("custom");
    setSelectedPanels(next);
    invalidateReview();
  };

  const request = useMemo<AddProgramPlanRequest | null>(() => {
    if (!selectedProgram) return null;
    return {
      programName: selectedProgram.programName,
      executablePath,
      selectedPanels: selectedProgram.panels
        .filter((panel) => selectedPanels.has(panel.label))
        .map((panel) => panel.label),
      selectedSources: selectedProgram.sources
        .filter((source) => selectedSources.has(source.id))
        .map((source) => ({
          sourceId: source.id,
          destinationPanel: destinations[source.id] || source.panelName
        }))
    };
  }, [destinations, executablePath, selectedPanels, selectedProgram, selectedSources]);

  const reviewPlan = async () => {
    if (!request || !hostConfirmed) return;
    setBusy(true);
    setStatus("Running read-only Program and Button-package preflight…");
    try {
      const result = await preflightAddProgramPlan(request);
      setReviewed(result);
      setExecutablePath(result.executablePath);
      setStatus("Preflight passed. Review the exact effects below, then install.");
    } catch (error) {
      setReviewed(null);
      setStatus(`Preflight failed: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const finishSuccess = async (programName: string) => {
    const latest = await loadButtonStateDocument();
    await publishButtonCommit(latest).catch(() => {});
    await emitProgramSetupCommitted({ kind: "program", programName });
    setStatus(`Program '${programName}' is installed through the managed lifecycle.`);
    await getCurrentWindow().close();
  };

  const installReviewedPlan = async () => {
    if (!request || !reviewed) return;
    setBusy(true);
    setStatus("Applying the durable Program setup transaction…");
    let transactionToken = "";
    try {
      const applied = await applyAddProgramPlan(request);
      transactionToken = applied.transactionToken;
      const base = await loadButtonStateDocument();
      const next = reconcileBundledProgramSources(base, applied.descriptors);
      const panelOwners = reconcileProgramPanelOwners(next, {
        programName: applied.programName,
        panels: buildPanelRailOwnerEntries(applied.panels),
        surfaceBounds: panelRailOwnerSurfaceBounds,
        removeStaleOwners: false
      });
      const sourceOwnerIds = applied.descriptors.map((descriptor) => String(descriptor.ownerButtonId ?? ""));
      const expectedButtonIds = [
        ...sourceOwnerIds,
        ...panelOwners.owners.map((owner) => owner.buttonId)
      ].filter(Boolean);
      await prepareAddProgramCanonicalCommit(transactionToken, expectedButtonIds);
      let saved = base;
      if (!buttonStateDocumentsEqual(next, base)) {
        saved = await commitButtonStateDocument(next, base.revision);
      }
      await finalizeAddProgramPlan(transactionToken);
      await publishButtonCommit(saved).catch(() => {});
      await emitProgramSetupCommitted({ kind: "program", programName: applied.programName });
      setStatus(`Program '${applied.programName}' is installed through the managed lifecycle.`);
      await getCurrentWindow().close();
    } catch (error) {
      if (!transactionToken) {
        setStatus(`Program setup failed: ${errorMessage(error)}`);
      } else {
        try {
          const outcome = await rollbackAddProgramPlan(transactionToken);
          if (outcome === "finalized") {
            await finishSuccess(reviewed.programName);
            return;
          }
          setStatus(`Program setup failed and was fully rolled back: ${errorMessage(error)}`);
        } catch (rollbackError) {
          setStatus(
            `Program setup failed: ${errorMessage(error)} Rollback requires startup recovery: ${errorMessage(rollbackError)}`
          );
        }
      }
    } finally {
      setBusy(false);
    }
  };

  if (!inventory) {
    return <main className="program-setup"><p className="program-setup__status">{status}</p></main>;
  }

  return (
    <main className="program-setup">
      <header className="program-setup__header">
        <div><p className="program-setup__eyebrow">Managed lifecycle</p><h1>Add Program</h1></div>
        <button type="button" onClick={() => void getCurrentWindow().close()} disabled={busy}>Close</button>
      </header>

      {inventory.packages.length === 0 ? (
        <section className="program-setup__card"><p>{status}</p></section>
      ) : selectedProgram ? (
        <>
          <section className="program-setup__card program-setup__grid">
            <label>Program package
              <select value={selectedProgram.programName} onChange={(event) => chooseProgram(event.target.value)} disabled={busy}>
                {inventory.packages.map((program) => <option key={program.programId}>{program.programName}</option>)}
              </select>
            </label>
            <label>Host executable
              <div className="program-setup__inline">
                <input value={executablePath} onChange={(event) => { setExecutablePath(event.target.value); setHostConfirmed(false); invalidateReview(); }} disabled={busy} />
                <button type="button" disabled={busy} onClick={() => void showOpenFileDialog({ title: `Choose ${selectedProgram.programName} host executable`, filter: "Applications (*.exe)|*.exe", multiselect: false }).then((paths) => {
                  if (!paths[0]) return;
                  setExecutablePath(paths[0]); setHostConfirmed(false); invalidateReview();
                })}>Browse</button>
              </div>
            </label>
            <label className="program-setup__confirm"><input type="checkbox" checked={hostConfirmed} onChange={(event) => { setHostConfirmed(event.target.checked); invalidateReview(); }} disabled={busy} /> I confirm this EXE is the host application for this Program package.</label>
          </section>

          <section className="program-setup__modes" aria-label="Setup mode">
            <button className={mode === "register" ? "is-active" : ""} type="button" onClick={() => applyMode("register")} disabled={busy}>Register program only</button>
            <button className={mode === "everything" ? "is-active" : ""} type="button" onClick={() => applyMode("everything")} disabled={busy}>Add everything</button>
            <button className={mode === "custom" ? "is-active" : ""} type="button" onClick={() => applyMode("custom")} disabled={busy}>Custom</button>
          </section>

          <section className="program-setup__columns">
            <article className="program-setup__card"><h2>Panels</h2>
              {selectedProgram.panels.map((panel) => {
                const inUse = Array.from(selectedSources).some((sourceId) => (destinations[sourceId] || selectedProgram.sources.find((source) => source.id === sourceId)?.panelName) === panel.label);
                return <label className="program-setup__check" key={panel.id}><input type="checkbox" checked={selectedPanels.has(panel.label)} disabled={busy || mode === "register" || inUse} onChange={(event) => togglePanel(panel.label, event.target.checked)} /><span><strong>{panel.label}</strong>{inUse ? <small>Required by a selected contribution</small> : null}</span></label>;
              })}
            </article>
            <article className="program-setup__card"><h2>Button contributions</h2>
              {selectedProgram.panels.map((panel) => {
                const sources = selectedProgram.sources.filter((source) => source.panelName === panel.label);
                if (sources.length === 0) return null;
                return <details className="program-setup__source-group" key={panel.id} open>
                  <summary>{panel.label} <small>{sources.length} contribution{sources.length === 1 ? "" : "s"}</small></summary>
                  {sources.map((source) => {
                    const locked = mode !== "register" && (source.required || dependencyLocks.has(source.id));
                    return <div className="program-setup__source" key={source.id}>
                      <label className="program-setup__check"><input type="checkbox" checked={selectedSources.has(source.id)} disabled={busy || mode === "register" || locked} onChange={(event) => toggleSource(source.id, event.target.checked)} /><span><strong>{source.label}</strong><small>{source.sourceKind} - version {source.version}{locked ? " - required" : ""}</small></span></label>
                      <p>{source.tooltip}</p>
                      {selectedSources.has(source.id) ? <label>Destination
                        <select value={destinations[source.id] || source.panelName} disabled={busy} onChange={(event) => { setMode("custom"); setDestinations((current) => ({ ...current, [source.id]: event.target.value })); setSelectedPanels((current) => new Set(current).add(event.target.value)); invalidateReview(); }}>
                          {selectedProgram.panels.filter((candidate) => selectedPanels.has(candidate.label)).map((candidate) => <option key={candidate.id}>{candidate.label}</option>)}
                        </select>
                      </label> : null}
                    </div>;
                  })}
                </details>;
              })}
            </article>
          </section>

          <section className="program-setup__card program-setup__details"><h2>Package contract</h2>
            <p><strong>Type:</strong> {selectedProgram.programType}</p>
            <p><strong>Support content:</strong> {selectedProgram.supportContent.join(", ") || "None"}</p>
            <p><strong>Required versions:</strong> {selectedProgram.requiredVersions.join(", ")}</p>
            {selectedProgram.addonReloadNotes ? <p><strong>Reload:</strong> {selectedProgram.addonReloadNotes}</p> : null}
            {selectedProgram.appRestartNotes ? <p><strong>Restart:</strong> {selectedProgram.appRestartNotes}</p> : null}
          </section>

          {reviewed ? <section className="program-setup__card program-setup__review"><h2>Validated effects</h2><ul>{reviewed.installEffects.map((effect) => <li key={effect}>{effect}</li>)}</ul></section> : null}
          <footer className="program-setup__footer"><p className="program-setup__status">{status}</p><div>{reviewed ? <button className="program-setup__primary" type="button" onClick={() => void installReviewedPlan()} disabled={busy}>Install validated plan</button> : <button className="program-setup__primary" type="button" onClick={() => void reviewPlan()} disabled={busy || !hostConfirmed || !executablePath.trim()}>Review plan</button>}</div></footer>
        </>
      ) : null}

      {inventory.rejectedPackages.length > 0 ? <details className="program-setup__rejected"><summary>Rejected packages ({inventory.rejectedPackages.length})</summary>{inventory.rejectedPackages.map((entry) => <p key={entry.folderName}><strong>{entry.folderName}:</strong> {entry.error}</p>)}</details> : null}
    </main>
  );
}
