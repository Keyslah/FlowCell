import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

import {
  importProgramPackage,
  getWindowsSetupRequirement,
  listAvailableProgramPackages,
  listProgramSetupStatuses,
  recheckProgramSetup,
  type AddProgramPlanRequest,
  type AvailableProgramPackage,
  type AvailableProgramPackagesResponse,
  type ProgramSetupResult
} from "../../lib/programRails";
import { showOpenFileDialog } from "../../lib/tauri";
import { applyManagedProgramPlan } from "./applyManagedProgramPlan";
import { buildWindowsSetupPlan } from "./windowsSetupPlan";
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

interface AddProgramWindowPageProps {
  requiredWindowsProgram?: AvailableProgramPackage;
  onWindowsComplete?: () => void;
}

interface SetupProgress {
  operation: "import" | "install";
  programName: string;
  stage: string;
  completedSources?: number;
  totalSources?: number;
  elapsedMs: number;
}

export default function AddProgramWindowPage({ requiredWindowsProgram, onWindowsComplete }: AddProgramWindowPageProps = {}) {
  const [inventory, setInventory] = useState<AvailableProgramPackagesResponse>({ packages: [], rejectedPackages: [] });
  const [setupSource, setSetupSource] = useState<SetupSource>("package");
  const [windowsProgram, setWindowsProgram] = useState<AvailableProgramPackage | null>(requiredWindowsProgram ?? null);
  const [selectedWindowsPanels, setSelectedWindowsPanels] = useState<Set<string>>(
    () => new Set(requiredWindowsProgram?.panels.map((panel) => panel.label) ?? [])
  );
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
  const [installationComplete, setInstallationComplete] = useState(false);
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const packageActionPending = useRef(false);
  const inventoryRequestRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<SetupProgress>("flowcell:program-setup-progress", ({ payload }) => {
      if (disposed || !busyRef.current) return;
      setProgress(payload);
      setStatus(payload.stage);
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, []);

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
    const inventoryRequest = ++inventoryRequestRef.current;
    if (!requiredWindowsProgram) {
      void getWindowsSetupRequirement().then((program) => {
        if (cancelled || !program) return;
        setWindowsProgram(program);
        setSelectedWindowsPanels(new Set(program.panels.map((panel) => panel.label)));
      }).catch((error) => {
        if (!cancelled) setSetupStatusError(`Windows setup could not be checked: ${errorMessage(error)}`);
      });
    }
    void listProgramSetupStatuses().then((next) => {
      if (!cancelled) setSetupStatuses(next);
    }).catch((error) => {
      if (!cancelled) setSetupStatusError(`Saved setup status could not be read: ${errorMessage(error)}`);
    });
    void listAvailableProgramPackages()
      .then((next) => {
        if (cancelled || inventoryRequest !== inventoryRequestRef.current) return;
        setInventory(next);
        if (!busyRef.current) setStatus(requiredWindowsProgram
          ? "Choose your Windows panels. You can also import a program ZIP below."
          : "Import a program ZIP, or add an application without a ZIP.");
      })
      .catch((error) => {
        if (!cancelled && inventoryRequest === inventoryRequestRef.current) setStatus(`Program package inventory failed: ${errorMessage(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [requiredWindowsProgram]);

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
      inventoryRequestRef.current += 1;
      setProgress(null);
      setStatus("Checking and importing the program package…");
      const imported = await importProgramPackage(paths[0]);
      const program = imported.availablePackage;
      if (!program) {
        throw new Error(`The package was imported to ${imported.packagePath}, but its setup could not be loaded.${imported.inventoryWarning ? ` ${imported.inventoryWarning}` : ""}`);
      }
      setInventory((current) => ({
        packages: [...(current?.packages ?? []).filter((entry) => entry.programId !== program.programId), program],
        rejectedPackages: (current?.rejectedPackages ?? []).filter((entry) => entry.folderName !== program.programName)
      }));
      setSetupSource("package");
      setSelectedProgramName(program.programName);
      resetForProgram(program);
      setStatus(`${program.programName} was imported. Select its .exe path below, then choose what to install.${imported.cleanupWarning ? ` ${imported.cleanupWarning}` : ""}`);
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
    inventoryRequestRef.current += 1;
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
    setCompletedSetup(result);
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
      const result = await applyManagedProgramPlan(planRequest, undefined, setStatus);
      finalizedResult = result;
      await presentSetupResult(result);
      return result;
    } catch (error) {
      if (finalizedResult) {
        setCompletedSetup(finalizedResult);
        setStatus(`Program '${finalizedResult.programName}' was added. Updating this window did not finish: ${errorMessage(error)}`);
      } else {
        setStatus(`Program setup failed: ${errorMessage(error)}`);
      }
      throw error;
    }
  };

  const addPlainProgram = async () => {
    if (!request || setupSource !== "plain") return;
    return installValidatedPlan(request);
  };

  const installProgram = async () => {
    if (!request || setupSource !== "package") return;
    return installValidatedPlan(request);
  };

  const installWindows = async () => {
    if (!windowsProgram) return;
    const request = buildWindowsSetupPlan(windowsProgram, selectedWindowsPanels);
    await applyManagedProgramPlan(request, undefined, setStatus);
    setWindowsProgram(null);
  };

  const install = async () => {
    if (busyRef.current) return;
    setBusy(true);
    setProgress(null);
    setStatus("Checking your installation choices…");
    try {
      await installWindows();
      const result = setupSource === "plain" ? await addPlainProgram()
        : selectedProgram ? await installProgram() : undefined;
      setInstallationComplete(true);
      setStatus("Installation complete.");
      if (!result || (result.status === "ready" && !result.restartNotes.trim())) onWindowsComplete?.();
    } catch (error) {
      setStatus(`Program setup failed: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const hasProgramChoice = setupSource === "plain" || Boolean(selectedProgram);
  const programReady = setupSource === "plain"
    ? Boolean(plainProgramName.trim() && plainExecutablePath.trim())
    : Boolean(selectedProgram && executablePath.trim());
  const canInstall = !busy && (hasProgramChoice ? programReady : Boolean(windowsProgram));

  return (
    <main className="program-setup program-setup--install">
      <header className="program-setup__header">
        <div><h1 id="program-installation-title">Installation</h1><p>Add Windows tools or import a FlowCell program ZIP.</p></div>
        {!onWindowsComplete ? <button type="button" onClick={() => void getCurrentWindow().close()} disabled={busy}>Close</button> : null}
      </header>

      <div className="program-setup__content">
      {setupStatusError ? <p className="program-setup__status" role="alert">{setupStatusError}</p> : null}

      {completedSetup ? <section className="program-setup__card" aria-live="polite">
        <h2>{completedSetup.programName}: {completedSetup.status === "needsHostInitialization" ? "finish application setup" : "installed"}</h2>
        <p>{completedSetup.message}</p>
        {completedSetup.restartNotes ? <p>{completedSetup.restartNotes}</p> : null}
        {completedSetup.status === "needsHostInitialization" ? <button type="button" onClick={() => void recheckSetup(completedSetup.programName)} disabled={busy}>Recheck setup</button> : null}
      </section> : null}

      {!installationComplete && windowsProgram ? <section className="program-setup__card">
        <h2>Windows</h2>
        <p className="program-setup__hint">Included with FlowCell. Choose the panels you want to install.</p>
        <fieldset className="windows-setup__panels" disabled={busy}>
          <legend>Windows panels</legend>
          {windowsProgram.panels.map((panel) => {
            const tools = windowsProgram.sources.filter((source) => source.panelName === panel.label && (source.defaultSelected || source.required));
            return <label key={panel.id} className="program-setup__check windows-setup__panel">
              <input type="checkbox" checked={selectedWindowsPanels.has(panel.label)} onChange={(event) => {
                const checked = event.target.checked;
                setSelectedWindowsPanels((current) => {
                  const next = new Set(current);
                  if (checked) next.add(panel.label); else next.delete(panel.label);
                  return next;
                });
              }} />
              <span><strong>{panel.label}</strong><span className="windows-setup__description">
                {tools.length ? tools.map((tool) => tool.label).join(", ") : "A panel for your own Windows tools."}
              </span></span>
            </label>;
          })}
        </fieldset>
      </section> : null}

      {!installationComplete ? <>
      {setupStatuses.filter((entry) => entry.status === "needsHostInitialization").map((entry) => (
        <section className="program-setup__card" key={entry.programName}>
          <h2>{entry.programName}: setup incomplete</h2>
          <p>{entry.message}</p>
          {entry.restartNotes ? <p>{entry.restartNotes}</p> : null}
          <button type="button" onClick={() => void recheckSetup(entry.programName)} disabled={busy}>Recheck setup</button>
        </section>
      ))}

      <section className="program-setup__card program-setup__import">
        <div><strong>Import a program</strong><p>Choose its ZIP, then select the application's .exe below.</p></div>
        <button type="button" onClick={() => void importPackage()} disabled={busy}>Import program ZIP</button>
      </section>

      <div className="program-setup__switch">
        <button type="button" onClick={() => chooseSetupSource(setupSource === "plain" ? "package" : "plain")} disabled={busy}>
          {setupSource === "plain" ? "Use a program ZIP" : "Add an application without a ZIP"}
        </button>
        {inventory.packages.length ? <details>
          <summary>{selectedProgram ? "Choose another program" : "Available programs"}</summary>
          <div className="program-setup__modes">{inventory.packages.map((program) =>
            <button key={program.programId} type="button" disabled={busy} onClick={() => { setSetupSource("package"); chooseProgram(program.programName); }}>{program.programName}</button>
          )}</div>
        </details> : null}
      </div>

      {setupSource === "plain" ? (
        <>
          <section className="program-setup__card program-setup__stack">
            <label>Program name
              <input value={plainProgramName} onChange={(event) => { setPlainProgramName(event.target.value); setStatus("Choose the application executable, then add the Program."); }} disabled={busy} />
            </label>
            <label>Application .exe path <span className="program-setup__required">(required)</span>
              <div className="program-setup__inline">
                <input required placeholder="Choose the application's .exe file" value={plainExecutablePath} onChange={(event) => { setPlainExecutablePath(event.target.value); setStatus("Add the Program when the name and EXE path are ready."); }} disabled={busy} />
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
        </>
      ) : selectedProgram ? (
        <>
          <section className="program-setup__card program-setup__stack">
            <div className="program-setup__header"><h2 className="program-setup__program-heading">{selectedProgram.programName}</h2><button type="button" disabled={busy} onClick={() => { setSelectedProgramName(""); setStatus("Program removed from this installation."); }}>Remove from installation</button></div>
            <label>{selectedProgram.programName} .exe path <span className="program-setup__required">(required)</span>
              <div className="program-setup__inline">
                <input required list="program-executable-candidates" placeholder={`Choose ${selectedProgram.programName}'s .exe file`} value={executablePath} onChange={(event) => { setExecutablePath(event.target.value); markSelectionChanged(); }} disabled={busy} />
                <datalist id="program-executable-candidates">{selectedProgram.executableCandidates.map((candidate) => <option key={candidate.path} value={candidate.path} />)}</datalist>
                <button type="button" disabled={busy} onClick={() => void showOpenFileDialog({ title: `Choose ${selectedProgram.programName} host executable`, filter: "Applications (*.exe)|*.exe", multiselect: false }).then((paths) => {
                  if (!paths[0]) return;
                  setExecutablePath(paths[0]); markSelectionChanged();
                })}>Browse</button>
              </div>
            </label>
            <div className="program-setup__switch"><span className="program-setup__hint">Select the installed application you want FlowCell to use.</span><button type="button" disabled={busy} onClick={() => void refreshDetection()}>Find installed</button></div>
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

        </>
      ) : (
        <p className="program-setup__hint">Import a program ZIP above to choose its panels and buttons.</p>
      )}

      {inventory.rejectedPackages.length > 0 ? <details className="program-setup__rejected"><summary>Rejected packages ({inventory.rejectedPackages.length})</summary>{inventory.rejectedPackages.map((entry) => <p key={entry.folderName}><strong>{entry.folderName}:</strong> {entry.error}</p>)}</details> : null}
      </> : null}
      </div>
      <footer className="program-setup__footer">
        <div className="program-setup__progress">
          <p className="program-setup__status" role="status">{status}</p>
          {busy && progress?.totalSources ? <>
            <progress value={progress.completedSources ?? 0} max={progress.totalSources} />
            <small>{progress.completedSources ?? 0} / {progress.totalSources} buttons</small>
          </> : null}
        </div>
        {installationComplete
          ? <button type="button" disabled={busy} onClick={() => onWindowsComplete ? onWindowsComplete() : void getCurrentWindow().close()}>{onWindowsComplete ? "Continue to FlowCell" : "Close"}</button>
          : <button className="program-setup__primary" type="button" onClick={() => void install()} disabled={!canInstall}>{busy ? "Installing…" : "Install"}</button>}
        {onWindowsComplete && !windowsProgram && !installationComplete ? <button type="button" disabled={busy} onClick={onWindowsComplete}>Continue to FlowCell</button> : null}
      </footer>
    </main>
  );
}
