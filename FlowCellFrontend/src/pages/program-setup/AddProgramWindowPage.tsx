import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  importProgramPackage,
  listAvailableProgramPackages,
  listProgramSetupStatuses,
  preflightAddProgramPlan,
  recheckProgramSetup,
  type AddProgramPlanRequest,
  type AvailableProgramPackage,
  type AvailableProgramPackagesResponse,
  type ProgramSetupResult
} from "../../lib/programRails";
import { showOpenFileDialog } from "../../lib/tauri";
import { applyManagedProgramPlan } from "./applyManagedProgramPlan";
import "./programSetup.css";

type SetupMode = "register" | "everything" | "custom";
type SetupSource = "plain" | "package";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function inferProgramNameFromExecutable(path: string): string {
  const fileName = path.trim().replace(/^"+|"+$/g, "").split(/[\\/]/).pop() ?? "";
  return fileName.replace(/\.exe$/i, "").trim();
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
} {
  const sources = sourceClosure(
    program,
    program.sources.filter((source) => source.required || source.defaultSelected).map((source) => source.id)
  );
  const panels = new Set(
    program.panels.filter((panel) => panel.defaultSelected).map((panel) => panel.label)
  );
  for (const source of program.sources) {
    if (sources.has(source.id)) panels.add(source.panelName);
  }
  return { panels, sources };
}

export default function AddProgramWindowPage() {
  const [inventory, setInventory] = useState<AvailableProgramPackagesResponse | null>(null);
  const [setupSource, setSetupSource] = useState<SetupSource>("plain");
  const [selectedProgramName, setSelectedProgramName] = useState("");
  const [executablePath, setExecutablePath] = useState("");
  const [plainProgramName, setPlainProgramName] = useState("");
  const [plainExecutablePath, setPlainExecutablePath] = useState("");
  const [mode, setMode] = useState<SetupMode>("custom");
  const [selectedPanels, setSelectedPanels] = useState<Set<string>>(new Set());
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [busy, setBusyState] = useState(false);
  const busyRef = useRef(false);
  const setBusy = useCallback((next: boolean) => {
    busyRef.current = next;
    setBusyState(next);
  }, []);
  const [status, setStatus] = useState("Loading Program packages…");
  const [setupStatuses, setSetupStatuses] = useState<ProgramSetupResult[]>([]);
  const [setupStatusError, setSetupStatusError] = useState("");
  const [completedSetup, setCompletedSetup] = useState<ProgramSetupResult | null>(null);
  const packageActionPending = useRef(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested((event) => {
      if (disposed || !busyRef.current) return;
      event.preventDefault();
      setStatus("Finish the current Program setup operation before closing this window.");
    }).then((next) => {
      if (disposed) next(); else unlisten = next;
    }).catch((error) => {
      if (!disposed) setStatus(`Window close protection failed: ${errorMessage(error)}`);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const selectedProgram = useMemo(
    () => inventory?.packages.find((program) => program.programName === selectedProgramName) ?? null,
    [inventory, selectedProgramName]
  );

  const resetForProgram = (program: AvailableProgramPackage) => {
    const setup = defaultSetup(program);
    setExecutablePath(program.suggestedExecutable);
    setMode("custom");
    setSelectedPanels(setup.panels);
    setSelectedSources(setup.sources);
    setStatus("Choose the panels and buttons you want to add.");
  };

  useEffect(() => {
    let cancelled = false;
    void listProgramSetupStatuses().then((next) => {
      if (!cancelled) setSetupStatuses(next);
    }).catch((error) => {
      if (!cancelled) setSetupStatusError(`Saved setup status could not be read: ${errorMessage(error)}`);
    });
    void listAvailableProgramPackages()
      .then((next) => {
        if (cancelled) return;
        setInventory(next);
        const first = next.packages[0];
        if (!first) {
          setSetupSource("plain");
          setStatus("Import a program ZIP, or choose an application executable to add your own Program.");
          return;
        }
        setSetupSource("package");
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

  const importPackage = async () => {
    if (busy || packageActionPending.current) return;
    packageActionPending.current = true;
    setBusy(true);
    try {
      const paths = await showOpenFileDialog({
        title: "Import a FlowCell program package",
        filter: "FlowCell program packages (*.zip)|*.zip",
        multiselect: false
      });
      if (!paths[0]) return;
      setStatus("Checking and importing the program package…");
      const imported = await importProgramPackage(paths[0]);
      const next = await listAvailableProgramPackages();
      setInventory(next);
      const program = next.packages.find((entry) => entry.programName === imported.programName);
      if (!program) {
        const rejected = next.rejectedPackages.find((entry) => entry.folderName === imported.programName);
        throw new Error(`The package was imported to ${imported.packagePath}, but is not available for registration.${rejected ? ` ${rejected.error}` : ""}`);
      }
      setSetupSource("package");
      setSelectedProgramName(program.programName);
      resetForProgram(program);
      setStatus(`${program.programName} was imported. Choose its application, panels and buttons, then select Install.${imported.cleanupWarning ? ` ${imported.cleanupWarning}` : ""}`);
    } catch (error) {
      setStatus(`Package import failed: ${errorMessage(error)}`);
    } finally {
      packageActionPending.current = false;
      setBusy(false);
    }
  };

  const refreshDetection = async () => {
    if (busy || packageActionPending.current) return;
    packageActionPending.current = true;
    setBusy(true);
    setStatus("Looking for installed applications…");
    try {
      const next = await listAvailableProgramPackages();
      setInventory(next);
      const program = next.packages.find((entry) => entry.programName === selectedProgramName);
      if (program && !executablePath.trim()) setExecutablePath(program.suggestedExecutable);
      setStatus("Detection refreshed. Choose the application you want to use, or Browse for it.");
    } catch (error) {
      setStatus(`Application detection failed: ${errorMessage(error)}`);
    } finally {
      packageActionPending.current = false;
      setBusy(false);
    }
  };

  const presentSetupResult = async (result: ProgramSetupResult) => {
    setSetupStatuses((current) => [...current.filter((entry) => entry.programName !== result.programName), result]);
    setStatus(result.message);
    if (result.status === "needsHostInitialization" || result.restartNotes.trim()) {
      setCompletedSetup(result);
    } else {
      setBusy(false);
      await getCurrentWindow().close();
    }
  };

  const recheckSetup = async (programName: string) => {
    if (busy || packageActionPending.current) return;
    packageActionPending.current = true;
    setBusy(true);
    setStatus(`Rechecking ${programName} setup…`);
    try {
      await presentSetupResult(await recheckProgramSetup(programName));
    } catch (error) {
      setStatus(`Setup recheck failed: ${errorMessage(error)}`);
    } finally {
      packageActionPending.current = false;
      setBusy(false);
    }
  };

  const markSelectionChanged = () => {
    setStatus("Choose what to add, then select Install.");
  };

  const chooseProgram = (programName: string) => {
    const program = inventory?.packages.find((candidate) => candidate.programName === programName);
    if (!program) return;
    setSelectedProgramName(program.programName);
    resetForProgram(program);
  };

  const chooseSetupSource = (nextSource: SetupSource) => {
    setSetupSource(nextSource);
    if (nextSource === "plain") {
      setStatus("Choose any application executable to add a Program context.");
      return;
    }
    if (selectedProgram) {
      resetForProgram(selectedProgram);
    } else {
      setStatus("No validated, unregistered managed Program packages are available.");
    }
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
    } else {
      const setup = defaultSetup(selectedProgram);
      setSelectedPanels(setup.panels);
      setSelectedSources(setup.sources);
    }
    markSelectionChanged();
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
      if (next.has(candidate.id)) nextPanels.add(candidate.panelName);
    }
    setMode("custom");
    setSelectedSources(next);
    setSelectedPanels(nextPanels);
    markSelectionChanged();
  };

  const togglePanel = (panelName: string, checked: boolean) => {
    if (!selectedProgram || mode === "register") return;
    const belongsToPanel = (source: AvailableProgramPackage["sources"][number]) =>
      source.panelName === panelName;
    const nextSources = new Set(selectedSources);
    if (checked) {
      for (const source of selectedProgram.sources) {
        if (belongsToPanel(source) && (source.defaultSelected || source.required)) {
          sourceClosure(selectedProgram, [source.id]).forEach((id) => nextSources.add(id));
        }
      }
    } else {
      for (const source of selectedProgram.sources) {
        if (belongsToPanel(source)) nextSources.delete(source.id);
      }
      const remaining = sourceClosure(selectedProgram, nextSources);
      if (selectedProgram.sources.some((source) => belongsToPanel(source) &&
        ((source.required && selectedSources.has(source.id)) || remaining.has(source.id)))) return;
    }
    const next = new Set(selectedPanels);
    if (checked) next.add(panelName); else next.delete(panelName);
    for (const source of selectedProgram.sources) {
      if (nextSources.has(source.id)) next.add(source.panelName);
    }
    setMode("custom");
    setSelectedSources(nextSources);
    setSelectedPanels(next);
    markSelectionChanged();
  };

  const request = useMemo<AddProgramPlanRequest | null>(() => {
    if (setupSource === "plain") {
      return {
        programName: plainProgramName.trim(),
        executablePath: plainExecutablePath,
        createPlainProgram: true,
        selectedPanels: [],
        selectedSources: []
      };
    }
    if (!selectedProgram) return null;
    return {
      programName: selectedProgram.programName,
      executablePath,
      createPlainProgram: false,
      selectedPanels: selectedProgram.panels
        .filter((panel) => selectedPanels.has(panel.label))
        .map((panel) => panel.label),
      selectedSources: selectedProgram.sources
        .filter((source) => selectedSources.has(source.id))
        .map((source) => ({
          sourceId: source.id,
          destinationPanel: source.panelName
        }))
    };
  }, [
    executablePath,
    plainExecutablePath,
    plainProgramName,
    selectedPanels,
    selectedProgram,
    selectedSources,
    setupSource
  ]);

  const installValidatedPlan = async (planRequest: AddProgramPlanRequest) => {
    setStatus("Installing the selected panels and buttons…");
    let finalizedResult: ProgramSetupResult | null = null;
    try {
      const result = await applyManagedProgramPlan(planRequest);
      finalizedResult = result;
      await presentSetupResult(result);
    } catch (error) {
      if (finalizedResult) {
        setCompletedSetup(finalizedResult);
        setStatus(`Program '${finalizedResult.programName}' was added. Updating this window did not finish: ${errorMessage(error)}`);
      } else {
        setStatus(`Program setup failed: ${errorMessage(error)}`);
      }
    }
  };

  const addPlainProgram = async () => {
    if (!request || setupSource !== "plain" || busyRef.current) return;
    setBusy(true);
    setStatus("Adding the Program…");
    try {
      const validated = await preflightAddProgramPlan(request);
      const validatedRequest: AddProgramPlanRequest = {
        ...request,
        programName: validated.programName,
        executablePath: validated.executablePath
      };
      setPlainExecutablePath(validated.executablePath);
      await installValidatedPlan(validatedRequest);
    } catch (error) {
      setStatus(`Program setup failed: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const installProgram = async () => {
    if (!request || setupSource !== "package" || busyRef.current) return;
    setBusy(true);
    setStatus("Installing the selected panels and buttons…");
    try {
      const validated = await preflightAddProgramPlan(request);
      setExecutablePath(validated.executablePath);
      await installValidatedPlan({
        ...request,
        programName: validated.programName,
        executablePath: validated.executablePath
      });
    } catch (error) {
      setStatus(`Program setup failed: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  if (completedSetup) {
    return <main className="program-setup">
      <header className="program-setup__header"><h1>{completedSetup.programName} setup</h1><button type="button" onClick={() => void getCurrentWindow().close()} disabled={busy}>Close</button></header>
      <section className="program-setup__card" aria-live="polite">
        <h2>{completedSetup.status === "needsHostInitialization" ? "Finish application setup" : "Setup ready"}</h2>
        <p>{completedSetup.message}</p>
        {completedSetup.restartNotes ? <p>{completedSetup.restartNotes}</p> : null}
        {completedSetup.status === "needsHostInitialization" ? <button type="button" onClick={() => void recheckSetup(completedSetup.programName)} disabled={busy}>Recheck setup</button> : null}
        <p className="program-setup__status">{status}</p>
      </section>
    </main>;
  }

  if (!inventory) {
    return <main className="program-setup"><p className="program-setup__status">{status}</p></main>;
  }

  return (
    <main className="program-setup">
      <header className="program-setup__header">
        <div><h1>Add Program</h1></div>
        <button type="button" onClick={() => void getCurrentWindow().close()} disabled={busy}>Close</button>
      </header>

      {setupStatusError ? <p className="program-setup__status" role="alert">{setupStatusError}</p> : null}

      {setupStatuses.filter((entry) => entry.status === "needsHostInitialization").map((entry) => (
        <section className="program-setup__card" key={entry.programName}>
          <h2>{entry.programName}: setup incomplete</h2>
          <p>{entry.message}</p>
          {entry.restartNotes ? <p>{entry.restartNotes}</p> : null}
          <button type="button" onClick={() => void recheckSetup(entry.programName)} disabled={busy}>Recheck setup</button>
        </section>
      ))}

      <section className="program-setup__card program-setup__import">
        <div><strong>Have a FlowCell program ZIP?</strong><p>Import it here, then choose what to add.</p></div>
        <button type="button" onClick={() => void importPackage()} disabled={busy}>Import program ZIP</button>
      </section>

      <section className="program-setup__modes" aria-label="Program source">
        <button className={setupSource === "plain" ? "is-active" : ""} type="button" onClick={() => chooseSetupSource("plain")} disabled={busy}>Any program</button>
        <button className={setupSource === "package" ? "is-active" : ""} type="button" onClick={() => chooseSetupSource("package")} disabled={busy || inventory.packages.length === 0}>Managed package</button>
      </section>

      {setupSource === "plain" ? (
        <>
          <section className="program-setup__card program-setup__grid">
            <label>Program name
              <input value={plainProgramName} onChange={(event) => { setPlainProgramName(event.target.value); setStatus("Choose the application executable, then add the Program."); }} disabled={busy} />
            </label>
            <label>Application executable
              <div className="program-setup__inline">
                <input value={plainExecutablePath} onChange={(event) => { setPlainExecutablePath(event.target.value); setStatus("Add the Program when the name and EXE path are ready."); }} disabled={busy} />
                <button type="button" disabled={busy} onClick={() => void showOpenFileDialog({ title: "Choose the application executable", filter: "Applications (*.exe)|*.exe", multiselect: false }).then((paths) => {
                  const selectedPath = paths[0];
                  if (!selectedPath) return;
                  setPlainExecutablePath(selectedPath);
                  setPlainProgramName((current) => current.trim() || inferProgramNameFromExecutable(selectedPath));
                  setStatus("Add the Program when the name and EXE path are ready.");
                })}>Browse</button>
              </div>
            </label>
          </section>
          <footer className="program-setup__footer"><p className="program-setup__status">{status}</p><div><button className="program-setup__primary" type="button" onClick={() => void addPlainProgram()} disabled={busy || !plainProgramName.trim() || !plainExecutablePath.trim()}>{busy ? "Installing…" : "Install"}</button></div></footer>
        </>
      ) : selectedProgram ? (
        <>
          <section className="program-setup__card program-setup__grid">
            <label>Program package
              <select value={selectedProgram.programName} onChange={(event) => chooseProgram(event.target.value)} disabled={busy}>
                {inventory.packages.map((program) => <option key={program.programId}>{program.programName}</option>)}
              </select>
            </label>
            <label>Host executable
              {selectedProgram.executableCandidates.length > 0 ? <select aria-label="Detected applications" value={selectedProgram.executableCandidates.some((candidate) => candidate.path === executablePath) ? executablePath : ""} onChange={(event) => { setExecutablePath(event.target.value); markSelectionChanged(); }} disabled={busy}>
                <option value="">Choose an installed application</option>
                {selectedProgram.executableCandidates.map((candidate) => <option key={candidate.path} value={candidate.path}>{candidate.path}</option>)}
              </select> : null}
              <div className="program-setup__inline">
                <input value={executablePath} onChange={(event) => { setExecutablePath(event.target.value); markSelectionChanged(); }} disabled={busy} />
                <button type="button" disabled={busy} onClick={() => void showOpenFileDialog({ title: `Choose ${selectedProgram.programName} host executable`, filter: "Applications (*.exe)|*.exe", multiselect: false }).then((paths) => {
                  if (!paths[0]) return;
                  setExecutablePath(paths[0]); markSelectionChanged();
                })}>Browse</button>
                <button type="button" disabled={busy} onClick={() => void refreshDetection()}>Find installed</button>
              </div>
            </label>
          </section>

          <section className="program-setup__modes" aria-label="Setup mode">
            <button className={mode === "register" ? "is-active" : ""} type="button" onClick={() => applyMode("register")} disabled={busy}>Register program only</button>
            <button className={mode === "everything" ? "is-active" : ""} type="button" onClick={() => applyMode("everything")} disabled={busy}>Add everything</button>
            <button className={mode === "custom" ? "is-active" : ""} type="button" onClick={() => applyMode("custom")} disabled={busy}>Custom</button>
          </section>

          <section className="program-setup__card program-setup__panels" aria-label="Panels and their contents">
            <h2>Panels</h2>
            {selectedProgram.panels.map((panel) => {
              const sources = selectedProgram.sources.filter((source) => source.panelName === panel.label);
              const panelLocked = selectedProgram.sources.some((source) => {
                if (!selectedSources.has(source.id)) return false;
                const sourcePanel = source.panelName;
                if (sourcePanel === panel.label) return source.required;
                return Array.from(sourceClosure(selectedProgram, [source.id])).some((id) =>
                  id !== source.id && selectedProgram.sources.find((candidate) => candidate.id === id)?.panelName === panel.label
                );
              });
              return <details className="program-setup__panel" key={panel.id} open>
                <summary>
                  <label className="program-setup__panel-choice" title={panelLocked ? "Required by a selected button." : `Select the ${panel.label} panel and its default buttons.`}>
                    <input type="checkbox" checked={selectedPanels.has(panel.label)} disabled={busy || mode === "register" || panelLocked} onClick={(event) => event.stopPropagation()} onChange={(event) => togglePanel(panel.label, event.target.checked)} />
                    <strong>{panel.label}</strong>
                  </label>
                  <small>{sources.length} button{sources.length === 1 ? "" : "s"}</small>
                </summary>
                <div className="program-setup__panel-contents">
                  {sources.length ? sources.map((source) => {
                    const locked = mode !== "register" && (source.required || dependencyLocks.has(source.id));
                    return <label className="program-setup__source" key={source.id}>
                      <input type="checkbox" checked={selectedSources.has(source.id)} disabled={busy || mode === "register" || locked} onChange={(event) => toggleSource(source.id, event.target.checked)} />
                      <span title={source.tooltip || source.label}>{source.label}</span>
                    </label>;
                  }) : <p className="program-setup__hint">This panel has no bundled buttons.</p>}
                </div>
              </details>;
            })}
          </section>

          <footer className="program-setup__footer"><p className="program-setup__status" role="status">{status}</p><div><button className="program-setup__primary" type="button" onClick={() => void installProgram()} disabled={busy || !executablePath.trim()}>{busy ? "Installing…" : "Install"}</button></div></footer>
        </>
      ) : (
        <section className="program-setup__card"><p>No validated, unregistered managed Program packages are available. Import a FlowCell program ZIP above. Choose Any program to add an executable directly.</p></section>
      )}

      {inventory.rejectedPackages.length > 0 ? <details className="program-setup__rejected"><summary>Rejected packages ({inventory.rejectedPackages.length})</summary>{inventory.rejectedPackages.map((entry) => <p key={entry.folderName}><strong>{entry.folderName}:</strong> {entry.error}</p>)}</details> : null}
    </main>
  );
}
