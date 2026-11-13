import { useEffect, useId, useRef, useState } from "react";
import type { ThemeTarget } from "../../theme/themeModel.js";
import { archiveSourceDescriptors, chooseThemeFile, listThemeLibrary, readTheme, type ReadThemeResult, type ThemeLibraryEntry } from "../../theme/themeFile.js";
import { previewPortableThemeImport } from "../../theme/portableThemeService.js";

type ThemeLibrarySource = "supplied" | "local";

/** Raster-only embedded previews cannot execute theme markup or fetch external resources. */
export function portableThemeThumbnail(theme: unknown): string | null {
  if (!theme || typeof theme !== "object") return null;
  const assets = (theme as { assets?: unknown }).assets;
  if (!Array.isArray(assets)) return null;
  for (const asset of assets) {
    if (!asset || typeof asset !== "object" || typeof asset.base64 !== "string" ||
      asset.base64.length > 12 * 1024 * 1024) continue;
    let header: string;
    try { header = atob(asset.base64.slice(0, 32)); } catch { continue; }
    const mime = header.startsWith("\x89PNG\r\n\x1a\n") ? "image/png"
      : header.startsWith("\xff\xd8\xff") ? "image/jpeg"
      : header.startsWith("GIF87a") || header.startsWith("GIF89a") ? "image/gif"
      : header.startsWith("RIFF") && header.slice(8, 12) === "WEBP" ? "image/webp"
      : header.startsWith("BM") ? "image/bmp" : null;
    if (mime) return `data:${mime};base64,${asset.base64}`;
  }
  return null;
}

export default function ThemeLibraryDialog({ target, mode, onClose, onApply, onReview }: {
  target: ThemeTarget;
  mode: "open" | "import";
  onClose(): void;
  onApply(theme: ReadThemeResult): Promise<void>;
  onReview?(theme: ReadThemeResult): Promise<string[]>;
}) {
  const libraryId = useId();
  const [library, setLibrary] = useState<ThemeLibrarySource>("supplied");
  const [entries, setEntries] = useState<ThemeLibraryEntry[]>([]);
  const [selected, setSelected] = useState<ReadThemeResult | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [requirements, setRequirements] = useState<string[]>([]);
  const [operation, setOperation] = useState<"inspecting" | "applying" | null>(null);
  const pending = operation !== null;
  const [error, setError] = useState("");
  const inspection = useRef(0);
  useEffect(() => {
    let disposed = false;
    inspection.current += 1;
    setLibrary("supplied"); setEntries([]);
    setSelected(null); setIssues([]); setRequirements([]); setError(""); setOperation(null);
    void listThemeLibrary(target).then((items) => { if (!disposed) setEntries(items); })
      .catch((reason) => { if (!disposed) setError(`Theme library could not be opened: ${String(reason)}`); });
    return () => { disposed = true; inspection.current += 1; };
  }, [target, mode]);
  const selectLibrary = (next: ThemeLibrarySource) => {
    if (operation === "applying" || next === library) return;
    inspection.current += 1;
    setLibrary(next);
    setSelected(null); setIssues([]); setRequirements([]); setError(""); setOperation(null);
  };
  const inspect = async (load: () => Promise<ReadThemeResult | null>) => {
    const generation = ++inspection.current;
    setOperation("inspecting"); setError(""); setSelected(null); setIssues([]); setRequirements([]);
    try {
      const value = await load();
      if (!value) return;
      if (generation !== inspection.current) return;
      const reviewIssues = await onReview?.(value) ?? [];
      if (generation !== inspection.current) return;
      let missing: string[] = [];
      if (value.portable) {
        const review = await previewPortableThemeImport(value.portable, target, archiveSourceDescriptors(value.portable));
        reviewIssues.push(...review.plan.issues);
        missing = review.plan.missingDependencies.map((dependency) => `${dependency.sourceName} ${dependency.sourceVersion}`);
      }
      if (generation !== inspection.current) return;
      setIssues([...new Set(reviewIssues)]);
      setRequirements(missing);
      setSelected(value);
    } catch (reason) { if (generation === inspection.current) setError(`Theme inspection failed: ${String(reason).replace(/FLOWCELL_THEME_(?:OUTCOME_UNKNOWN|NOT_STARTED):\s*/g, "")}`); }
    finally { if (generation === inspection.current) setOperation(null); }
  };
  const colors = selected ? [...new Set(JSON.stringify(selected.theme ?? selected.legacy).match(/#[0-9a-f]{6}(?:[0-9a-f]{2})?\b/gi) ?? [])].slice(0, 12) : [];
  const thumbnail = portableThemeThumbnail(selected?.portable);
  const visibleEntries = entries.filter((entry) => entry.supplied === (library === "supplied"));
  return <div className="theme-library-backdrop">
    <section className="theme-library-dialog" role="dialog" aria-modal="true" aria-label={mode === "import" ? "Import Theme" : "Open Theme"}>
      <header><h2>{mode === "import" ? "Import Theme" : "Open Theme"}</h2><button type="button" onClick={() => {
        inspection.current += 1;
        onClose();
      }} disabled={operation === "applying"}>Close</button></header>
      <p>{target.kind === "program" ? target.programName : "Main"} themes</p>
      <div className="theme-library-tabs" role="tablist" aria-label="Theme library">
        {(["supplied", "local"] as const).map((source) => <button key={source} type="button" role="tab"
          id={`${libraryId}-${source}`} aria-controls={`${libraryId}-panel`} aria-selected={library === source}
          tabIndex={library === source ? 0 : -1} disabled={operation === "applying"}
          onClick={() => selectLibrary(source)} onKeyDown={(event) => {
            const next = event.key === "Home" ? "supplied" : event.key === "End" ? "local"
              : event.key === "ArrowLeft" || event.key === "ArrowRight" ? (source === "supplied" ? "local" : "supplied") : null;
            if (!next) return;
            event.preventDefault();
            selectLibrary(next);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next === "supplied" ? 0 : 1]?.focus();
          }}>{source === "supplied" ? "Supplied" : "Local"}</button>)}
      </div>
      <div className="theme-library-columns" role="tabpanel" id={`${libraryId}-panel`} aria-labelledby={`${libraryId}-${library}`}>
        <div className="theme-library-list">
          {visibleEntries.map((entry) => <div key={entry.path}>
            <button type="button" disabled={pending} onClick={() => void inspect(() => readTheme(entry.path, target))}>{entry.name}</button>
          </div>)}
          {!visibleEntries.length && <p>No {library} themes in this library.</p>}
          {library === "local" && <button type="button" disabled={pending} onClick={() => void inspect(() => chooseThemeFile(target))}>Choose local theme file or archive…</button>}
        </div>
        <div className="theme-library-review">
          {selected ? <>
            <h3>{selected.portable?.name ?? entries.find((entry) => entry.path === selected.path)?.name ?? selected.path.split(/[\\/]/).pop()}</h3>
            {thumbnail && <img src={thumbnail} alt="Included theme image preview" decoding="async"
              style={{ maxWidth: "100%", maxHeight: 220, objectFit: "contain" }} />}
            <div className="theme-library-swatches" aria-label="Theme color preview">{colors.map((color) => <span key={color} style={{ backgroundColor: color }} title={color} />)}</div>
            <p>{selected.theme?.buttons.length ?? 0} Button appearances; {selected.portable?.surfaces.length ?? 0} exact arrangements; {Object.keys(selected.portable?.contributions ?? {}).length} program feature sets.</p>
            {selected.theme?.page && <p>Includes {selected.theme.page.pageId} interface colors and backgrounds.</p>}
            {selected.legacy != null && <p>Legacy theme: only its included settings will be applied.</p>}
            {selected.portable?.dependencies.length ? <ul>{selected.portable.dependencies.map((dependency) => <li key={dependency.id}>{dependency.sourceName} · {dependency.sourceVersion}</li>)}</ul> : null}
            {requirements.length > 0 && <><p>Tools to install when you apply:</p><ul>{requirements.map((item) => <li key={item}>{item}</li>)}</ul></>}
            {issues.length > 0 && <><p>Resolve these requirements before applying:</p><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></>}
          </> : <p>Select a theme to preview its colors, included settings, and required tools.</p>}
          {operation && <p role="status">{operation === "applying" ? "Applying theme and saving settings…" : "Checking theme settings and requirements…"}</p>}
          {error && <p role="alert">{error}</p>}
        </div>
      </div>
      <footer><button type="button" disabled={pending || !selected || issues.length > 0} onClick={() => {
        if (!selected) return;
        setOperation("applying"); setError("");
        void onApply(selected).then(onClose).catch((reason) => setError(`Theme apply failed: ${String(reason).replace(/FLOWCELL_THEME_(?:OUTCOME_UNKNOWN|NOT_STARTED):\s*/g, "")}`)).finally(() => setOperation(null));
      }}>{operation === "applying" ? "Applying…" : operation === "inspecting" ? "Checking…" : "Apply Theme"}</button></footer>
    </section>
  </div>;
}
