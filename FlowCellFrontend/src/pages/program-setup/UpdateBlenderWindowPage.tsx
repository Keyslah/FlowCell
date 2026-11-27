import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { showOpenFileDialog } from "../../lib/tauri";
import "./programSetup.css";

interface Installation { path: string; version: string }
interface Inventory { registered: string; candidates: Installation[] }
type SyncResult = { version: string; count: number } | { version: string; needsPreferenceChoice: true };

export default function UpdateBlenderWindowPage() {
  const [inventory, setInventory] = useState<Inventory>({ registered: "", candidates: [] });
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(true);
  const [confirmInstall, setConfirmInstall] = useState(false);
  const [firstRun, setFirstRun] = useState<{ executable: string; version: string } | null>(null);
  const [message, setMessage] = useState("Looking for Blender installations…");
  const [error, setError] = useState("");
  const working = useRef(false);

  function applyInventory(next: Inventory) {
    setInventory(next);
    setPath(next.candidates.length === 1 ? next.candidates[0].path : "");
    setMessage(next.candidates.length ? "Choose the installation you want FlowCell to use." : "Browse to blender.exe or install Blender below.");
  }

  useEffect(() => {
    let active = true;
    void invoke<Inventory>("detect_blender_installations").then(next => {
      if (active) applyInventory(next);
    }).catch(reason => { if (active) { setMessage(""); setError(String(reason)); } })
      .finally(() => { if (active) setBusy(false); });
    const stop = getCurrentWindow().onCloseRequested(event => {
      if (working.current) event.preventDefault();
    });
    return () => { active = false; void stop.then(unlisten => unlisten()); };
  }, []);

  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try { await action(); }
    catch (reason) { setMessage(""); setError(String(reason)); }
    finally { working.current = false; setBusy(false); }
  }

  async function sync(executable: string, expectedVersion: string | null = null, preferenceChoice: "import" | "defaults" | null = null) {
    setMessage("Connecting Blender and rebuilding your installed FlowCell actions…");
    const result = await invoke<SyncResult>("sync_blender_installation", { executable, expectedVersion, preferenceChoice });
    if ("needsPreferenceChoice" in result) {
      setFirstRun({ executable, version: result.version });
      setMessage("");
      return;
    }
    setFirstRun(null);
    setInventory(current => ({ ...current, registered: executable }));
    setMessage(`Synced ${result.count} FlowCell actions to Blender ${result.version}. Open or restart that Blender version to load the bridge.`);
  }

  async function install() {
    setConfirmInstall(false);
    setMessage("Windows Package Manager is checking for and installing Blender. Approve the Windows installer prompt if it appears.");
    const version = await invoke<string>("install_latest_blender");
    const next = await invoke<Inventory>("detect_blender_installations");
    applyInventory(next);
    const majorMinor = version.split(".").slice(0, 2).join(".");
    const matches = next.candidates.filter(candidate => candidate.version === majorMinor);
    if (version && matches.length === 1) {
      setPath(matches[0].path);
      await sync(matches[0].path, version);
    } else {
      setMessage("Blender installation finished. Select the installed executable and choose Sync FlowCell.");
    }
  }

  return <main className="program-setup" aria-busy={busy}>
    <h1>Update Blender</h1>
    <p>Connect your existing FlowCell buttons to a Blender installation.</p>
    {inventory.registered && <p className="blender-update__path">Current FlowCell path<br /><strong>{inventory.registered}</strong></p>}
    <label>Blender installation
      <select disabled={busy || !!firstRun} value={path} onChange={event => { setPath(event.target.value); setError(""); setMessage(""); }}>
        <option value="">Select an installation</option>
        {inventory.candidates.map(item => <option key={item.path} value={item.path}>Blender {item.version} · {item.path}</option>)}
        {path && !inventory.candidates.some(item => item.path === path) && <option value={path}>{path}</option>}
      </select>
    </label>
    <div className="blender-update__actions">
      <button disabled={busy || !!firstRun} onClick={() => void run(async () => {
        setMessage("Looking for Blender installations…");
        applyInventory(await invoke<Inventory>("detect_blender_installations"));
      })}>Detect again</button>
      <button disabled={busy || !!firstRun} onClick={() => void run(async () => {
        const [chosen] = await showOpenFileDialog({ title: "Choose blender.exe", filter: "Applications (*.exe)|*.exe", multiselect: false });
        if (chosen) { setPath(chosen); setMessage("Ready to sync the selected Blender installation."); }
      })}>Browse…</button>
      <button className="is-active" disabled={busy || !!firstRun || !path} onClick={() => void run(() => sync(path))}>Sync FlowCell</button>
    </div>
    <hr />
    {firstRun ? <>
      <p>Set up Blender {firstRun.version} before syncing your buttons. You can import your previous Blender settings, including add-ons, or start with Blender’s defaults.</p>
      <div className="blender-update__actions">
        <button disabled={busy} onClick={() => void run(() => sync(firstRun.executable, firstRun.version, "import"))}>Import settings and sync</button>
        <button disabled={busy} onClick={() => void run(() => sync(firstRun.executable, firstRun.version, "defaults"))}>Use defaults and sync</button>
        <button disabled={busy} onClick={() => { setFirstRun(null); setMessage("Sync cancelled."); setError(""); }}>Cancel</button>
      </div>
    </> : confirmInstall ? <>
      <p>Save your work and close Blender. Windows Package Manager will download its latest Blender release and may replace the installed version. Continuing accepts the package and source agreements. FlowCell will then sync your buttons.</p>
      <div className="blender-update__actions">
        <button onClick={() => void run(install)} disabled={busy}>Install and sync</button>
        <button onClick={() => setConfirmInstall(false)} disabled={busy}>Cancel</button>
      </div>
    </> : <button disabled={busy} onClick={() => setConfirmInstall(true)}>Install latest Blender…</button>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </main>;
}
