import { useCallback, useEffect, useRef, useState } from "react";
import {
  getWindowsSetupRequirement,
  type AvailableProgramPackage
} from "../../lib/programRails";
import AddProgramWindowPage from "./AddProgramWindowPage";
import "./programSetup.css";

export default function WindowsSetup({ onComplete }: { onComplete: () => void }) {
  const [program, setProgram] = useState<AvailableProgramPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
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

  return <dialog
    ref={dialogRef}
    className="program-setup--dialog windows-setup"
    aria-labelledby="program-installation-title"
    onCancel={(event) => event.preventDefault()}
  >
    {program ? <AddProgramWindowPage requiredWindowsProgram={program} onWindowsComplete={() => onCompleteRef.current()} />
      : <main className="program-setup program-setup--install">
        <header className="program-setup__header"><h1 id="program-installation-title">Installation</h1></header>
        <div className="program-setup__content">
          {loading ? <p role="status">Checking Windows setup…</p> : null}
          {error ? <p className="windows-setup__error" role="alert">{error}</p> : null}
        </div>
        <footer className="program-setup__footer"><button type="button" disabled={loading} onClick={() => void checkRequirement()}>Retry</button></footer>
      </main>}
  </dialog>;
}
