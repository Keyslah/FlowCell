import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ThemeEditorWindowContext } from "../../lib/windowContext.js";
import { listPanelFolders, listProgramFolders } from "../../lib/programRails.js";
import { showOpenFileDialog } from "../../lib/tauri.js";
import { openButtonEditorWindow } from "../../button/windows/buttonWindows.js";
import {
  loadButtonStateDocument,
  saveButtonStateDocument
} from "../../button/state/ButtonStateRepository.js";
import { publishButtonCommit } from "../../button/state/ButtonDraftBus.js";
import { cloneButtonDocument } from "../../button/state/buttonDefaults.js";
import type {
  ButtonPlacement,
  ButtonSkin,
  ButtonStateDocument
} from "../../button/types.js";
import {
  applyThemeFile,
  captureThemeFile,
  defaultMainThemeAppearance,
  extractSkinColorRoots,
  gradientColorForPlacement,
  listThemePlacements,
  setSkinColorRoot,
  type MainThemeAppearance,
  type ThemeGradientDefinition,
  type ThemeTarget
} from "../../theme/themeModel.js";
import {
  readActiveMainThemeAppearance,
  writeActiveMainThemeAppearance
} from "../../theme/themeRuntime.js";
import {
  loadFlowCellThemeFile,
  saveFlowCellThemeFile
} from "../../theme/themeFile.js";
import { rails } from "../main/mainLayout.js";
import "./themeEditorPage.css";

const FLOWCELL_TARGET_VALUE = "__flowcell__";
const ALL_PANELS_VALUE = "__all_panels__";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function draftSkinId(placementId: string): string {
  return `flowcell-theme-draft-skin-${placementId.replace(/[^a-z0-9_-]+/gi, "-")}`;
}

function activePlacementSkin(
  document: ButtonStateDocument,
  placement: ButtonPlacement
): ButtonSkin | null {
  const button = document.buttons[placement.buttonId];
  return button
    ? document.skins[placement.skinOverrideId ?? button.defaultSkinId] ?? null
    : null;
}

function ensurePlacementPrivateSkin(
  document: ButtonStateDocument,
  placementId: string
): ButtonSkin | null {
  const placement = document.placements[placementId];
  if (!placement) return null;
  const id = draftSkinId(placementId);
  if (placement.skinOverrideId === id && document.skins[id]) return document.skins[id];
  const source = activePlacementSkin(document, placement);
  if (!source) return null;
  const skin = structuredClone(source);
  skin.id = id;
  skin.name = `${source.name} · ${document.buttons[placement.buttonId]?.label ?? "Theme"}`;
  skin.compileCache = null;
  document.skins[id] = skin;
  placement.skinOverrideId = id;
  return skin;
}

function targetFromSelection(
  targetValue: string,
  panelValue: string
): ThemeTarget {
  if (targetValue === FLOWCELL_TARGET_VALUE) {
    return { kind: "flowcell", page: "main" };
  }
  return {
    kind: "program",
    programName: targetValue,
    panelName: panelValue === ALL_PANELS_VALUE ? null : panelValue
  };
}

function themeSuggestedName(target: ThemeTarget): string {
  if (target.kind === "flowcell") return "FlowCell Main Theme";
  return target.panelName
    ? `${target.programName} ${target.panelName} Theme`
    : `${target.programName} Theme`;
}

export default function ThemeEditorPage({
  context
}: {
  context: ThemeEditorWindowContext;
}) {
  const initialTarget = context.target?.trim() || FLOWCELL_TARGET_VALUE;
  const [programNames, setProgramNames] = useState<string[]>([]);
  const [panelNames, setPanelNames] = useState<string[]>([]);
  const [targetValue, setTargetValue] = useState(
    initialTarget.toLocaleLowerCase("en") === "flowcell"
      ? FLOWCELL_TARGET_VALUE
      : initialTarget
  );
  const [panelValue, setPanelValue] = useState(ALL_PANELS_VALUE);
  const [canonicalDocument, setCanonicalDocument] = useState<ButtonStateDocument | null>(null);
  const [draftDocument, setDraftDocument] = useState<ButtonStateDocument | null>(null);
  const [mainAppearance, setMainAppearance] = useState<MainThemeAppearance>(
    readActiveMainThemeAppearance()
  );
  const [gradient, setGradient] = useState<ThemeGradientDefinition>({
    role: "surface",
    topColor: "#8dcf9b",
    bottomColor: "#254936",
    spread: 100,
    scatter: 20,
    seed: 1
  });
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("Loading Theme Editor…");

  const target = useMemo(
    () => targetFromSelection(targetValue, panelValue),
    [panelValue, targetValue]
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listProgramFolders(), loadButtonStateDocument()])
      .then(([programs, document]) => {
        if (cancelled) return;
        setProgramNames(programs);
        const matchedTarget = targetValue === FLOWCELL_TARGET_VALUE
          ? FLOWCELL_TARGET_VALUE
          : programs.find((name) => name === targetValue) ?? programs[0] ?? FLOWCELL_TARGET_VALUE;
        setTargetValue(matchedTarget);
        setCanonicalDocument(document);
        setDraftDocument(cloneButtonDocument(document));
        setStatus("Ready.");
      })
      .catch((error) => {
        if (!cancelled) setStatus(`Theme Editor could not load: ${errorMessage(error)}`);
      });
    return () => {
      cancelled = true;
    };
    // The opening context is intentionally resolved once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (targetValue === FLOWCELL_TARGET_VALUE) {
      setPanelNames([]);
      setPanelValue(ALL_PANELS_VALUE);
      return;
    }
    let cancelled = false;
    void listPanelFolders(targetValue)
      .then((panels) => {
        if (cancelled) return;
        setPanelNames(panels);
        setPanelValue((current) =>
          current === ALL_PANELS_VALUE || panels.includes(current)
            ? current
            : ALL_PANELS_VALUE
        );
      })
      .catch((error) => {
        if (!cancelled) setStatus(`Panels could not load: ${errorMessage(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [targetValue]);

  const scopedPlacements = useMemo(
    () => draftDocument ? listThemePlacements(draftDocument, target) : [],
    [draftDocument, target]
  );

  const gradientRoles = useMemo(() => {
    if (!draftDocument) return [];
    const roles = new Set<string>();
    scopedPlacements.forEach((placement) => {
      const skin = activePlacementSkin(draftDocument, placement);
      extractSkinColorRoots(skin ?? ({ base: "" } as ButtonSkin)).forEach((root) => roles.add(root.role));
    });
    return [...roles].sort();
  }, [draftDocument, scopedPlacements]);

  useEffect(() => {
    if (gradientRoles.length > 0 && !gradientRoles.includes(gradient.role)) {
      setGradient((current) => ({ ...current, role: gradientRoles[0] }));
    }
  }, [gradient.role, gradientRoles]);

  const updateDraft = (mutate: (document: ButtonStateDocument) => void) => {
    setDraftDocument((current) => {
      if (!current) return current;
      const next = cloneButtonDocument(current);
      mutate(next);
      return next;
    });
  };

  const updatePlacementColor = (placementId: string, role: string, color: string) => {
    updateDraft((document) => {
      const skin = ensurePlacementPrivateSkin(document, placementId);
      if (!skin) return;
      document.skins[skin.id] = setSkinColorRoot(skin, role, color);
    });
  };

  const applyGradient = (nextGradient = gradient) => {
    if (!draftDocument || !nextGradient.role) return;
    const eligible = scopedPlacements.filter((placement) => {
      const skin = activePlacementSkin(draftDocument, placement);
      return Boolean(skin && extractSkinColorRoots(skin).some((root) => root.role === nextGradient.role));
    });
    if (eligible.length === 0) {
      setStatus(`No Buttons in this scope expose '${nextGradient.role}'.`);
      return;
    }
    const centers = eligible.map((placement) => placement.y + placement.height / 2);
    const minimumY = Math.min(...centers);
    const maximumY = Math.max(...centers);
    updateDraft((document) => {
      eligible.forEach((placement) => {
        const skin = ensurePlacementPrivateSkin(document, placement.id);
        if (!skin) return;
        const color = gradientColorForPlacement({
          placementId: placement.id,
          y: placement.y + placement.height / 2,
          minimumY,
          maximumY,
          gradient: nextGradient
        });
        document.skins[skin.id] = setSkinColorRoot(skin, nextGradient.role, color);
      });
    });
    setGradient(nextGradient);
    setStatus(`Applied ${nextGradient.role} gradient to ${eligible.length} Buttons.`);
  };

  const applyCurrentDraft = async (): Promise<ButtonStateDocument> => {
    if (!canonicalDocument || !draftDocument) {
      throw new Error("Canonical Button state is not loaded yet.");
    }
    const theme = captureThemeFile({
      document: draftDocument,
      target,
      main: target.kind === "flowcell" ? mainAppearance : null,
      gradient
    });
    const latest = await loadButtonStateDocument();
    const applied = applyThemeFile(latest, theme);
    const saved = await saveButtonStateDocument(applied.document, latest.revision);
    await publishButtonCommit(saved);
    if (theme.main) writeActiveMainThemeAppearance(theme.main);
    setCanonicalDocument(saved);
    setDraftDocument(cloneButtonDocument(saved));
    setStatus(
      `Applied theme to ${applied.appliedButtonCount} Buttons` +
      (applied.missingButtonCount ? `; ${applied.missingButtonCount} saved Buttons were not found.` : ".")
    );
    return saved;
  };

  const handleApply = async () => {
    if (pending) return;
    setPending(true);
    try {
      await applyCurrentDraft();
    } catch (error) {
      setStatus(`Theme could not be applied: ${errorMessage(error)}`);
    } finally {
      setPending(false);
    }
  };

  const handleSaveTheme = async () => {
    if (pending || !draftDocument) return;
    setPending(true);
    try {
      const theme = captureThemeFile({
        document: draftDocument,
        target,
        main: target.kind === "flowcell" ? mainAppearance : null,
        gradient
      });
      const path = await saveFlowCellThemeFile(theme, themeSuggestedName(target));
      if (path) setStatus(`Saved theme: ${path}`);
    } catch (error) {
      setStatus(`Theme could not be saved: ${errorMessage(error)}`);
    } finally {
      setPending(false);
    }
  };

  const handleLoadTheme = async () => {
    if (pending) return;
    setPending(true);
    try {
      const loaded = await loadFlowCellThemeFile();
      if (!loaded) return;
      const latest = await loadButtonStateDocument();
      const applied = applyThemeFile(latest, loaded.theme);
      const saved = await saveButtonStateDocument(applied.document, latest.revision);
      await publishButtonCommit(saved);
      if (loaded.theme.main) {
        setMainAppearance(loaded.theme.main);
        writeActiveMainThemeAppearance(loaded.theme.main);
      }
      if (loaded.theme.gradient) setGradient(loaded.theme.gradient);
      if (loaded.theme.target.kind === "flowcell") {
        setTargetValue(FLOWCELL_TARGET_VALUE);
        setPanelValue(ALL_PANELS_VALUE);
      } else {
        setTargetValue(loaded.theme.target.programName);
        setPanelValue(loaded.theme.target.panelName ?? ALL_PANELS_VALUE);
      }
      setCanonicalDocument(saved);
      setDraftDocument(cloneButtonDocument(saved));
      setStatus(
        `Loaded ${loaded.path}; applied ${applied.appliedButtonCount} Buttons` +
        (applied.missingButtonCount ? ` and skipped ${applied.missingButtonCount} missing Buttons.` : ".")
      );
    } catch (error) {
      setStatus(`Theme could not be loaded: ${errorMessage(error)}`);
    } finally {
      setPending(false);
    }
  };

  const handleBrowseMainBackground = async () => {
    const path = (await showOpenFileDialog({
      title: "Choose Main Theme Background",
      filter: "Images (*.png;*.jpg;*.jpeg;*.webp)|*.png;*.jpg;*.jpeg;*.webp",
      multiselect: false
    }))[0]?.trim();
    if (!path) return;
    setMainAppearance((current) => ({
      ...current,
      backgroundImageMode: "custom",
      backgroundImagePath: path
    }));
  };

  const resetDraftFromCanonical = () => {
    if (canonicalDocument) setDraftDocument(cloneButtonDocument(canonicalDocument));
    setMainAppearance(readActiveMainThemeAppearance());
    setStatus("Discarded unsaved Theme Editor changes.");
  };

  return (
    <main className="theme-editor">
      <header className="theme-editor__header">
        <div>
          <h1>Theme Editor</h1>
          <p>Appearance only. Button actions and scripts stay unchanged.</p>
        </div>
        <div className="theme-editor__header-actions">
          <button type="button" onClick={handleLoadTheme} disabled={pending}>Open Theme</button>
          <button type="button" onClick={handleSaveTheme} disabled={pending || !draftDocument}>Save Theme</button>
          <button type="button" onClick={handleApply} disabled={pending || !draftDocument}>Apply</button>
          <button type="button" onClick={resetDraftFromCanonical} disabled={pending || !draftDocument}>Discard</button>
          <button type="button" onClick={() => void getCurrentWindow().close()}>Close</button>
        </div>
      </header>

      <section className="theme-editor__scope theme-editor__card">
        <label>
          <span>Program</span>
          <select value={targetValue} onChange={(event) => setTargetValue(event.target.value)}>
            <option value={FLOWCELL_TARGET_VALUE}>FlowCell</option>
            {programNames.map((programName) => (
              <option key={programName} value={programName}>{programName}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{targetValue === FLOWCELL_TARGET_VALUE ? "Page" : "Area"}</span>
          {targetValue === FLOWCELL_TARGET_VALUE ? (
            <select value="main" disabled>
              <option value="main">Main</option>
            </select>
          ) : (
            <select value={panelValue} onChange={(event) => setPanelValue(event.target.value)}>
              <option value={ALL_PANELS_VALUE}>All Panels</option>
              {panelNames.map((panelName) => (
                <option key={panelName} value={panelName}>{panelName}</option>
              ))}
            </select>
          )}
        </label>
      </section>

      {target.kind === "flowcell" ? (
        <section className="theme-editor__card">
          <h2>Main Page</h2>
          <div className="theme-editor__grid">
            <label>
              <span>Background</span>
              <div className="theme-editor__color-control">
                <input
                  type="color"
                  value={mainAppearance.backgroundColor}
                  onChange={(event) => setMainAppearance((current) => ({ ...current, backgroundColor: event.target.value }))}
                />
                <input
                  value={mainAppearance.backgroundColor}
                  onChange={(event) => setMainAppearance((current) => ({ ...current, backgroundColor: event.target.value }))}
                />
              </div>
            </label>
            <label>
              <span>Background image</span>
              <select
                value={mainAppearance.backgroundImageMode}
                onChange={(event) => setMainAppearance((current) => ({
                  ...current,
                  backgroundImageMode: event.target.value as MainThemeAppearance["backgroundImageMode"]
                }))}
              >
                <option value="default">Default</option>
                <option value="none">None</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <button type="button" onClick={handleBrowseMainBackground}>Browse Background</button>
          </div>
          <div className="theme-editor__rails">
            {rails.map((rail) => {
              const appearance = mainAppearance.rails[rail.id] ?? { background: rail.background, border: rail.border };
              return (
                <div className="theme-editor__rail-row" key={rail.id}>
                  <strong>{rail.name} Rail</strong>
                  <label>
                    <span>Background</span>
                    <input
                      value={appearance.background}
                      onChange={(event) => setMainAppearance((current) => ({
                        ...current,
                        rails: {
                          ...current.rails,
                          [rail.id]: { ...appearance, background: event.target.value }
                        }
                      }))}
                    />
                  </label>
                  <label>
                    <span>Border</span>
                    <input
                      value={appearance.border}
                      onChange={(event) => setMainAppearance((current) => ({
                        ...current,
                        rails: {
                          ...current.rails,
                          [rail.id]: { ...appearance, border: event.target.value }
                        }
                      }))}
                    />
                  </label>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="theme-editor__card">
        <div className="theme-editor__section-heading">
          <div>
            <h2>Button Gradient</h2>
            <p>Position follows top-to-bottom placement. Scatter is stable until Reshuffle.</p>
          </div>
          <button
            type="button"
            disabled={!draftDocument || gradientRoles.length === 0}
            onClick={() => applyGradient()}
          >
            Apply Gradient
          </button>
        </div>
        <div className="theme-editor__gradient-grid">
          <label>
            <span>Color role</span>
            <select
              value={gradient.role}
              onChange={(event) => setGradient((current) => ({ ...current, role: event.target.value }))}
            >
              {gradientRoles.length === 0 ? <option value="">No editable roles</option> : null}
              {gradientRoles.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
          <label><span>Top</span><input type="color" value={gradient.topColor} onChange={(event) => setGradient((current) => ({ ...current, topColor: event.target.value }))} /></label>
          <label><span>Bottom</span><input type="color" value={gradient.bottomColor} onChange={(event) => setGradient((current) => ({ ...current, bottomColor: event.target.value }))} /></label>
          <label><span>Spread {gradient.spread}%</span><input type="range" min="0" max="100" value={gradient.spread} onChange={(event) => setGradient((current) => ({ ...current, spread: Number(event.target.value) }))} /></label>
          <label><span>Scatter {gradient.scatter}%</span><input type="range" min="0" max="100" value={gradient.scatter} onChange={(event) => setGradient((current) => ({ ...current, scatter: Number(event.target.value) }))} /></label>
          <button
            type="button"
            onClick={() => {
              const next = { ...gradient, seed: gradient.seed + 1 };
              applyGradient(next);
            }}
            disabled={!draftDocument || gradientRoles.length === 0}
          >
            Reshuffle
          </button>
        </div>
      </section>

      <section className="theme-editor__card theme-editor__buttons-card">
        <div className="theme-editor__section-heading">
          <div>
            <h2>Buttons</h2>
            <p>{scopedPlacements.length} placement{scopedPlacements.length === 1 ? "" : "s"} in this scope.</p>
          </div>
        </div>
        <div className="theme-editor__button-list">
          {draftDocument && scopedPlacements.map((placement) => {
            const button = draftDocument.buttons[placement.buttonId];
            const surface = draftDocument.surfaces[placement.surfaceId];
            const skin = activePlacementSkin(draftDocument, placement);
            const colorRoots = skin ? extractSkinColorRoots(skin) : [];
            const identity = button?.sourceIdentity;
            return (
              <article className="theme-editor__button-row" key={placement.id}>
                <div className="theme-editor__button-title">
                  <div>
                    <strong>{button?.label ?? placement.buttonId}</strong>
                    <small>{surface?.name ?? placement.surfaceId}{identity ? ` · ${identity.displayProgramName} / ${identity.displayPanelName}` : ""}</small>
                  </div>
                  <button
                    type="button"
                    onClick={() => void openButtonEditorWindow({
                      programName: identity?.displayProgramName,
                      panelName: identity?.displayPanelName,
                      buttonId: placement.buttonId,
                      surfaceId: placement.surfaceId
                    })}
                  >
                    Buttons Editor
                  </button>
                </div>
                <div className="theme-editor__button-controls">
                  <label>
                    <span>Skin</span>
                    <select
                      value={skin?.id ?? ""}
                      onChange={(event) => updateDraft((document) => {
                        const nextPlacement = document.placements[placement.id];
                        if (nextPlacement) nextPlacement.skinOverrideId = event.target.value || null;
                      })}
                    >
                      {Object.values(draftDocument.skins)
                        .sort((left, right) => left.name.localeCompare(right.name))
                        .map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Width</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={Number(placement.width.toFixed(2))}
                      onChange={(event) => updateDraft((document) => {
                        const next = document.placements[placement.id];
                        const value = Number(event.target.value);
                        if (next && Number.isFinite(value) && value > 0) next.width = value;
                      })}
                    />
                  </label>
                  <label>
                    <span>Height</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={Number(placement.height.toFixed(2))}
                      onChange={(event) => updateDraft((document) => {
                        const next = document.placements[placement.id];
                        const value = Number(event.target.value);
                        if (next && Number.isFinite(value) && value > 0) next.height = value;
                      })}
                    />
                  </label>
                  {colorRoots.map((root) => {
                    const colorInputValue = /^#[0-9a-f]{6}$/i.test(root.value) ? root.value : "#808080";
                    return (
                      <label key={root.role}>
                        <span>{root.role}</span>
                        <div className="theme-editor__color-control">
                          <input
                            type="color"
                            value={colorInputValue}
                            onChange={(event) => updatePlacementColor(placement.id, root.role, event.target.value)}
                          />
                          <input
                            value={root.value}
                            onChange={(event) => updatePlacementColor(placement.id, root.role, event.target.value)}
                          />
                        </div>
                      </label>
                    );
                  })}
                </div>
              </article>
            );
          })}
          {draftDocument && scopedPlacements.length === 0 ? (
            <p className="theme-editor__empty">No canonical Button placements are available for this scope.</p>
          ) : null}
        </div>
      </section>

      <footer className="theme-editor__status" role="status">{status}</footer>
    </main>
  );
}
