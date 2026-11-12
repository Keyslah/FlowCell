import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getWindowsSetupRequirement } from "../../lib/programRails";
import { applyManagedProgramPlan } from "./applyManagedProgramPlan";
import { buildWindowsSetupPlan } from "./windowsSetupPlan";
import "./programSetup.css";

export default function WindowsSetup({ onComplete, onStartupReady }: { onComplete: () => void; onStartupReady: () => void }) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Preparing Windows tools…");
  const [error, setError] = useState("");
  const runningRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onStartupReadyRef = useRef(onStartupReady);
  onStartupReadyRef.current = onStartupReady;

  const checkRequirement = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setLoading(true);
    setStatus("Preparing Windows tools…");
    setError("");
    // Keep the same native request alive. Slow setup must not hold Main's
    // startup/layout restoration or let Retry start a second native operation.
    const waitingTimer = window.setTimeout(() => {
      setStatus("Windows tools are taking longer than expected. You can keep using FlowCell.");
      onStartupReadyRef.current();
    }, 10_000);
    try {
      const program = await getWindowsSetupRequirement();
      if (program) {
        const selectedPanels = new Set(program.panels.filter((panel) => panel.defaultSelected).map((panel) => panel.label));
        setStatus("Installing Windows tools selected in the installer…");
        await applyManagedProgramPlan(buildWindowsSetupPlan(program, selectedPanels), undefined, setStatus);
      }
      onCompleteRef.current();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      onStartupReadyRef.current();
    } finally {
      window.clearTimeout(waitingTimer);
      runningRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => { void checkRequirement(); }, [checkRequirement]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ programName: string; stage: string }>("flowcell:program-setup-progress", ({ payload }) => {
      if (!disposed && runningRef.current && payload.programName === "Windows") setStatus(payload.stage);
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; }).catch(() => {});
    return () => { disposed = true; unlisten?.(); };
  }, []);

  return <aside className="windows-setup-status" aria-label="Windows tools setup">
    <p role={error ? "alert" : "status"}>{error ? `Windows tools setup failed: ${error}` : status}</p>
    {error ? <button type="button" disabled={loading} onClick={() => void checkRequirement()}>Retry Windows setup</button> : null}
  </aside>;
}
