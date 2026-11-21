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

function actionableSetupInstructions(notes: string): string {
  // Package manifests include future editing advice even when setup did not
  // change the manifest. It is not an action required for this installation.
  return notes.split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^restart\s+flowcell\s+after\s+changing\s+this\s+program\s+manifest\.$/i.test(line))
    .join("\n");
}

/** Keep the program's actual setup instructions visible after installation. */
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
        if (installed) {
          const instructions = actionableSetupInstructions(installed.restartNotes);
          if (instructions) setSetup({ ...installed, restartNotes: instructions });
        }
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
      <h2 id="program-host-restart-title">{setup.programName} setup instructions</h2>
      <div id="program-host-restart-description">
        <p>{setup.restartNotes}</p>
      </div>
      <button ref={dismiss} type="button" onClick={() => setSetup(null)}>Got it</button>
    </section>
  </div>;
}
