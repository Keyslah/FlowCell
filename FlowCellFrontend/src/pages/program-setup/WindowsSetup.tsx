import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getWindowsSetupRequirement,
  preflightAddProgramPlan,
  type AvailableProgramPackage
} from "../../lib/programRails";
import { applyManagedProgramPlan } from "./applyManagedProgramPlan";
import { buildWindowsSetupPlan } from "./windowsSetupPlan";
import "./programSetup.css";

export default function WindowsSetup({ onComplete }: { onComplete: () => void }) {
  const [program, setProgram] = useState<AvailableProgramPackage | null>(null);
  const [selectedPanels, setSelectedPanels] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const checkRequirement = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const required = await getWindowsSetupRequirement();
      if (!required) {
        onCompleteRef.current();
        return;
      }
      setProgram(required);
      setSelectedPanels(new Set(required.panels.map((panel) => panel.label)));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void checkRequirement(); }, [checkRequirement]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { dialog?.close(); };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested((event) => {
      if (!busyRef.current) return;
      event.preventDefault();
      setError("Windows tools are still being installed. Keep FlowCell open until setup finishes.");
    }).then((stop) => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, []);

  const install = async () => {
    if (!program || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const request = buildWindowsSetupPlan(program, selectedPanels);
      await preflightAddProgramPlan(request);
      await applyManagedProgramPlan(request);
      onCompleteRef.current();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return <dialog
    ref={dialogRef}
    className="program-setup windows-setup"
    aria-labelledby="windows-setup-title"
    onCancel={(event) => event.preventDefault()}
  >
    <header className="program-setup__header">
      <div>
        <h1 id="windows-setup-title">Set up FlowCell for Windows</h1>
        <p>Windows is included with FlowCell. Choose the panels you want to add.</p>
      </div>
    </header>
    {loading ? <p role="status">Checking Windows setup…</p> : null}
    {program ? <fieldset className="program-setup__card windows-setup__panels" disabled={busy}>
      <legend>Windows panels</legend>
      {program.panels.map((panel) => {
        const tools = program.sources.filter((source) =>
          source.panelName === panel.label && (source.defaultSelected || source.required)
        );
        return <label key={panel.id} className="program-setup__check windows-setup__panel">
          <input
            type="checkbox"
            checked={selectedPanels.has(panel.label)}
            onChange={(event) => {
              const checked = event.target.checked;
              setSelectedPanels((current) => {
                const next = new Set(current);
                if (checked) next.add(panel.label); else next.delete(panel.label);
                return next;
              });
            }}
          />
          <span><strong>{panel.label}</strong><span className="windows-setup__description">
            {tools.length ? tools.map((tool) => tool.label).join(", ") : "A panel for your own Windows tools."}
          </span></span>
        </label>;
      })}
    </fieldset> : null}
    {error ? <p className="windows-setup__error" role="alert">{error}</p> : null}
    <footer className="program-setup__footer">
      <p>{busy ? "Installing your selected Windows panels…" : "You can add or remove panels later."}</p>
      {program ? <button type="button" disabled={loading || busy} onClick={() => void install()}>
        {busy ? "Installing…" : selectedPanels.size ? "Install Windows tools" : "Continue with Windows"}
      </button> : <button type="button" disabled={loading} onClick={() => void checkRequirement()}>Retry</button>}
    </footer>
  </dialog>;
}
