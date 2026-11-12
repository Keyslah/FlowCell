import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  listProgramSetupStatuses,
  PROGRAM_SETUP_COMMITTED_EVENT,
  type ProgramSetupCommittedEvent,
  type ProgramSetupResult
} from "../../lib/programRails";
import { makeSafeTauriUnlisten } from "../../lib/safeTauriUnlisten";
import "./programHostRestartNotice.css";

/** Keep the required host restart visible after a successful installation. */
export default function ProgramHostRestartNotice() {
  const [setup, setSetup] = useState<ProgramSetupResult | null>(null);
  const dismiss = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let disposed = false;
    let request = 0;
    let unlisten: (() => void) | undefined;
    void listen<ProgramSetupCommittedEvent>(PROGRAM_SETUP_COMMITTED_EVENT, (event) => {
      if (event.payload.kind !== "program") return;
      const generation = ++request;
      void listProgramSetupStatuses().then((results) => {
        if (disposed || generation !== request) return;
        const installed = results.find((entry) =>
          entry.programName.toLowerCase() === event.payload.programName.toLowerCase()
        );
        if (installed?.restartNotes.trim()) setSetup(installed);
      }).catch((error) => {
        console.warn("Could not read the program's restart instructions.", error);
      });
    }).then((dispose) => {
      const safeDispose = makeSafeTauriUnlisten(dispose);
      if (disposed) safeDispose(); else unlisten = safeDispose;
    }).catch((error) => {
      console.warn("Could not subscribe to program restart instructions.", error);
    });
    return () => { disposed = true; request += 1; unlisten?.(); };
  }, []);

  useEffect(() => { if (setup) dismiss.current?.focus(); }, [setup]);

  if (!setup) return null;
  return <div className="program-host-restart-backdrop">
    <section className="program-host-restart-notice" role="dialog" aria-modal="true"
      aria-labelledby="program-host-restart-title" aria-describedby="program-host-restart-description"
      onKeyDown={(event) => {
        if (event.key === "Escape") setSetup(null);
        if (event.key === "Tab") { event.preventDefault(); dismiss.current?.focus(); }
      }}>
      <h2 id="program-host-restart-title">Restart {setup.programName} to finish setup</h2>
      <div id="program-host-restart-description">
        <p>{setup.restartNotes}</p>
        <p>Save your work, then close and reopen {setup.programName} before using the installed FlowCell buttons and themes.</p>
      </div>
      <button ref={dismiss} type="button" onClick={() => setSetup(null)}>I’ll restart {setup.programName}</button>
    </section>
  </div>;
}
