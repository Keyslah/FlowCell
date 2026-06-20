import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadBindsWorkspace,
  saveBindShortcut,
  saveCoreActionShortcut
} from "../../lib/binds";
import { formatShortcutForDisplay, parseShortcutInput } from "../../lib/bindings";
import {
  MACRO_PANEL_CHANGED_EVENT,
  saveMacroShortcut,
  type MacroPanelChangedPayload
} from "../../lib/macros";
import {
  buildShortcutPickerOptions,
  computeAvailableShortcutChoices,
  formatBoundShortcut,
  UNBOUND_SHORTCUT_LABEL,
  validateShortcutInput
} from "../../lib/shortcutProfiles";
import { openMacroLabWindow } from "../../lib/windowing";
import type { BindsWindowContext } from "../../lib/windowContext";
import type {
  BindableButtonRecord,
  BindablePanelRecord,
  BindableProgramRecord,
  BindsWorkspaceData,
  FrontendMacroSummaryRecord
} from "../../types";
import "./bindsWindowPage.css";

type BindsSelection = {
  programName: string;
  panelName: string;
  buttonId: string;
};

type BindTargetMode = "button" | "macro";

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function findProgram(
  workspace: BindsWorkspaceData | null,
  programName: string
): BindableProgramRecord | null {
  if (!workspace) {
    return null;
  }

  return (
    workspace.programs.find(
      (program) =>
        program.name.localeCompare(programName, undefined, { sensitivity: "accent" }) === 0
    ) ?? null
  );
}

function findPanel(program: BindableProgramRecord | null, panelName: string): BindablePanelRecord | null {
  if (!program) {
    return null;
  }

  return (
    program.panels.find(
      (panel) => panel.name.localeCompare(panelName, undefined, { sensitivity: "accent" }) === 0
    ) ?? null
  );
}

function findButton(panel: BindablePanelRecord | null, buttonId: string): BindableButtonRecord | null {
  if (!panel) {
    return null;
  }

  return panel.buttons.find((button) => button.id === buttonId) ?? null;
}

function findMacro(
  workspace: BindsWorkspaceData | null,
  macroId: string
): FrontendMacroSummaryRecord | null {
  if (!workspace) {
    return null;
  }

  return workspace.macros.find((macro) => macro.id === macroId) ?? null;
}

function resolveMacroId(workspace: BindsWorkspaceData | null, macroId: string): string {
  return findMacro(workspace, macroId)?.id ?? workspace?.macros[0]?.id ?? "";
}

function reconcileSelection(
  workspace: BindsWorkspaceData | null,
  current: BindsSelection
): BindsSelection {
  const firstProgram = workspace?.programs[0] ?? null;
  const selectedProgram = findProgram(workspace, current.programName) ?? firstProgram;
  const firstPanel = selectedProgram?.panels[0] ?? null;
  const selectedPanel = findPanel(selectedProgram, current.panelName) ?? firstPanel;
  const firstButton = selectedPanel?.buttons[0] ?? null;
  const selectedButton = findButton(selectedPanel, current.buttonId) ?? firstButton;

  return {
    programName: selectedProgram?.name ?? "",
    panelName: selectedPanel?.name ?? "",
    buttonId: selectedButton?.id ?? ""
  };
}

export default function BindsWindowPage({
  context: _context
}: {
  context: BindsWindowContext;
}) {
  const [workspace, setWorkspace] = useState<BindsWorkspaceData | null>(null);
  const [selection, setSelection] = useState<BindsSelection>({
    programName: "",
    panelName: "",
    buttonId: ""
  });
  const [targetMode, setTargetMode] = useState<BindTargetMode>("button");
  const [selectedMacroId, setSelectedMacroId] = useState("");
  const [shortcutInput, setShortcutInput] = useState("");
  const [loadError, setLoadError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isShortcutMenuOpen, setIsShortcutMenuOpen] = useState(false);
  const shortcutMenuRef = useRef<HTMLDivElement | null>(null);

  const reloadWorkspace = async (nextSelection?: BindsSelection) => {
    const nextWorkspace = await loadBindsWorkspace();
    const resolvedSelection = reconcileSelection(nextWorkspace, nextSelection ?? selection);
    setWorkspace(nextWorkspace);
    setSelection(resolvedSelection);
    setSelectedMacroId((current) => resolveMacroId(nextWorkspace, current));
    setLoadError("");
    return {
      workspace: nextWorkspace,
      selection: resolvedSelection
    };
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const nextWorkspace = await loadBindsWorkspace();
        if (cancelled) {
          return;
        }

        const nextSelection = reconcileSelection(nextWorkspace, {
          programName: "",
          panelName: "",
          buttonId: ""
        });
        setWorkspace(nextWorkspace);
        setSelection(nextSelection);
        setSelectedMacroId(resolveMacroId(nextWorkspace, ""));
        setLoadError("");
      } catch (error) {
        if (cancelled) {
          return;
        }

        setLoadError(formatErrorMessage(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unlistenPromise = listen<MacroPanelChangedPayload>(
      MACRO_PANEL_CHANGED_EVENT,
      () => {
        void reloadWorkspace();
      }
    );

    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const nextSelection = reconcileSelection(workspace, selection);
    if (
      nextSelection.programName !== selection.programName ||
      nextSelection.panelName !== selection.panelName ||
      nextSelection.buttonId !== selection.buttonId
    ) {
      setSelection(nextSelection);
    }
  }, [selection, workspace]);

  useEffect(() => {
    const nextMacroId = resolveMacroId(workspace, selectedMacroId);
    if (nextMacroId !== selectedMacroId) {
      setSelectedMacroId(nextMacroId);
    }
  }, [selectedMacroId, workspace]);

  const selectedProgram = useMemo(
    () => findProgram(workspace, selection.programName),
    [selection.programName, workspace]
  );
  const selectedPanel = useMemo(
    () => findPanel(selectedProgram, selection.panelName),
    [selectedProgram, selection.panelName]
  );
  const selectedButton = useMemo(
    () => findButton(selectedPanel, selection.buttonId),
    [selectedPanel, selection.buttonId]
  );
  const selectedMacro = useMemo(
    () => findMacro(workspace, selectedMacroId),
    [selectedMacroId, workspace]
  );
  const selectedMacroProgram = useMemo(
    () => findProgram(workspace, selectedMacro?.programName ?? ""),
    [selectedMacro?.programName, workspace]
  );
  const selectedMacroButton = useMemo<BindableButtonRecord | null>(() => {
    if (!selectedMacro) {
      return null;
    }

    return {
      id: `macro::${selectedMacro.id}`,
      label: selectedMacro.label,
      kind: "macro",
      target: selectedMacro.id,
      shortcut: workspace?.bindings.actionHotkeys[selectedMacro.id] ?? ""
    };
  }, [selectedMacro, workspace]);
  const activeButton = targetMode === "macro" ? selectedMacroButton : selectedButton;
  const activeProgram = targetMode === "macro" ? selectedMacroProgram : selectedProgram;

  useEffect(() => {
    setShortcutInput(
      activeButton?.shortcut?.trim() ? formatShortcutForDisplay(activeButton.shortcut) : ""
    );
    setIsShortcutMenuOpen(false);
  }, [activeButton?.id, activeButton?.shortcut]);

  useEffect(() => {
    if (!isShortcutMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!shortcutMenuRef.current?.contains(target)) {
        setIsShortcutMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsShortcutMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isShortcutMenuOpen]);

  const availableShortcutChoices = useMemo(
    () =>
      activeProgram
        ? computeAvailableShortcutChoices({
            workspace: workspace ?? {
              programs: [],
              macros: [],
              bindings: {
                scriptBindings: [],
                actionHotkeys: {}
              },
              shortcutProfiles: [],
              warnings: []
            },
            programName: activeProgram.name,
            programTabId: activeProgram.programTabId,
            selectedButton: activeButton
          })
        : [],
    [activeButton, activeProgram, workspace]
  );

  const closeWindow = async () => {
    await getCurrentWindow().close().catch(() => {
      window.close();
    });
  };

  const handleProgramChange = (programName: string) => {
    setTargetMode("button");
    const nextSelection = reconcileSelection(workspace, {
      programName,
      panelName: "",
      buttonId: ""
    });
    setSelection(nextSelection);
    setStatusMessage("");
  };

  const handlePanelChange = (panelName: string) => {
    setTargetMode("button");
    const nextSelection = reconcileSelection(workspace, {
      programName: selection.programName,
      panelName,
      buttonId: ""
    });
    setSelection(nextSelection);
    setStatusMessage("");
  };

  const handleButtonChange = (buttonId: string) => {
    setTargetMode("button");
    const nextSelection = reconcileSelection(workspace, {
      programName: selection.programName,
      panelName: selection.panelName,
      buttonId
    });
    setSelection(nextSelection);
    setStatusMessage("");
  };

  const applyShortcutChoice = (displayShortcut: string) => {
    setShortcutInput(displayShortcut === UNBOUND_SHORTCUT_LABEL ? "" : displayShortcut);
    setStatusMessage("");
    setIsShortcutMenuOpen(false);
  };

  const handleGlobalButtonPick = (
    programName: string,
    panelName: string,
    buttonId: string
  ) => {
    setTargetMode("button");
    setSelection({
      programName,
      panelName,
      buttonId
    });
    setStatusMessage("");
    setIsShortcutMenuOpen(false);
  };

  const handleMacroPick = (macroId: string) => {
    setTargetMode("macro");
    setSelectedMacroId(macroId);
    setStatusMessage("");
    setIsShortcutMenuOpen(false);
  };

  const handleAddMacro = async () => {
    const programName =
      selectedMacro?.programName || selectedProgram?.name || workspace?.programs[0]?.name || "";
    const panelName =
      selectedMacro?.panelName ||
      selectedPanel?.name ||
      findProgram(workspace, programName)?.panels[0]?.name ||
      "";
    if (!programName || !panelName) {
      setStatusMessage("Pick a program and panel before creating a macro.");
      return;
    }

    await openMacroLabWindow({
      programName,
      panelName
    });
  };

  const handleSaveBinding = async () => {
    if (!activeProgram) {
      setStatusMessage(targetMode === "macro" ? "Pick a macro." : "Pick a program and panel.");
      return;
    }

    if (!activeButton) {
      setStatusMessage(targetMode === "macro" ? "No macros available." : "No buttons in this panel.");
      return;
    }

    const validation = validateShortcutInput({
      rawValue: shortcutInput,
      workspace:
        workspace ?? {
          programs: [],
          macros: [],
          bindings: {
            scriptBindings: [],
            actionHotkeys: {}
          },
          shortcutProfiles: [],
          warnings: []
        },
      programName: activeProgram.name,
      programTabId: activeProgram.programTabId,
      selectedButton: activeButton
    });
    if (!validation.ok) {
      setStatusMessage(validation.message);
      return;
    }

    setIsSaving(true);
    try {
      if (activeButton.kind.trim().toLowerCase() === "macro") {
        const result = await saveMacroShortcut({
          actionId: activeButton.target,
          shortcut: validation.shortcut
        });
        await reloadWorkspace(selection);
        setStatusMessage(result.message);
        return;
      }

      if (activeButton.kind.trim().toLowerCase() === "core_action") {
        const result = await saveCoreActionShortcut({
          actionId: activeButton.target,
          shortcut: validation.shortcut
        });
        await reloadWorkspace(selection);
        setStatusMessage(result.message);
        return;
      }

      if (!selectedProgram || !selectedPanel || !selectedButton) {
        setStatusMessage("Pick a program, panel, and button.");
        return;
      }

      const target = selectedButton.executionTarget?.trim() || selectedButton.target;
      const result = await saveBindShortcut({
        programName: selectedProgram.name,
        programTabId: selectedProgram.programTabId,
        target,
        bindingId: selectedButton.bindingId ?? 0,
        shortcut: validation.shortcut
      });
      const nextSelection = {
        programName: selectedProgram.name,
        panelName: selectedPanel.name,
        buttonId: selectedButton.id
      };
      await reloadWorkspace(nextSelection);
      setStatusMessage(result.message);
    } catch (error) {
      setStatusMessage(formatErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const hasSafeSuggestions =
    availableShortcutChoices.length > 0 || Boolean(activeButton?.shortcut?.trim());
  const shortcutPickerOptions = useMemo(
    () => buildShortcutPickerOptions(availableShortcutChoices),
    [availableShortcutChoices]
  );
  const statusTone =
    statusMessage.includes("saved") || statusMessage.includes("cleared") ? "is-success" : "is-error";
  const currentPanelPath = selectedProgram && selectedPanel
    ? `${selectedProgram.name} / ${selectedPanel.name}`
    : "Pick a program and panel";
  const globalButtonGroups =
    workspace?.programs.flatMap((program) =>
      program.panels
        .filter((panel) => panel.buttons.length > 0)
        .map((panel) => ({
          programName: program.name,
          panelName: panel.name,
          buttons: panel.buttons
        }))
    ) ?? [];

  return (
    <main className="binds-window-page">
      <section className="binds-window">
        <header className="binds-window__header">
          <div className="binds-window__title-block">
            <span className="binds-window__eyebrow">Binds</span>
            <h1>Binds</h1>
          </div>
          <button
            type="button"
            className="binds-window__chrome-button"
            onClick={() => void closeWindow()}
          >
            Close
          </button>
        </header>

        <section className="binds-window__station">
          <div className="binds-window__toolbar">
            <label className="binds-window__field">
              <span className="binds-window__field-label">Target</span>
              <select
                className="binds-window__select"
                value={targetMode}
                onChange={(event) => {
                  const nextMode = event.target.value as BindTargetMode;
                  setTargetMode(nextMode);
                  if (nextMode === "macro") {
                    setSelectedMacroId((current) => resolveMacroId(workspace, current));
                  }
                  setStatusMessage("");
                  setIsShortcutMenuOpen(false);
                }}
              >
                <option value="button">Button</option>
                <option value="macro">Macro</option>
              </select>
            </label>

            {targetMode === "button" ? (
              <>
                <label className="binds-window__field">
                  <span className="binds-window__field-label">Program</span>
            <select
              className="binds-window__select"
              value={selection.programName}
              onChange={(event) => handleProgramChange(event.target.value)}
            >
              <option value="">Pick a program</option>
              {workspace?.programs.map((program) => (
                <option key={program.name} value={program.name}>
                  {program.name}
                </option>
              ))}
            </select>
                </label>

                <label className="binds-window__field">
                  <span className="binds-window__field-label">Panel</span>
            <select
              className="binds-window__select"
              value={selection.panelName}
              onChange={(event) => handlePanelChange(event.target.value)}
              disabled={!selectedProgram}
            >
              <option value="">Pick a panel</option>
              {selectedProgram?.panels.map((panel) => (
                <option key={panel.name} value={panel.name}>
                  {panel.name}
                </option>
              ))}
            </select>
                </label>

                <label className="binds-window__field">
                  <span className="binds-window__field-label">Button</span>
            <select
              className="binds-window__select"
              value={selection.buttonId}
              onChange={(event) => handleButtonChange(event.target.value)}
              disabled={!selectedPanel || selectedPanel.buttons.length === 0}
            >
              <option value="">{selectedPanel ? "Pick a button" : "Pick a panel first"}</option>
              {selectedPanel?.buttons.map((button) => (
                <option key={button.id} value={button.id}>
                  {button.label}
                </option>
              ))}
            </select>
                </label>
              </>
            ) : (
              <>
                <label className="binds-window__field binds-window__field--wide">
                  <span className="binds-window__field-label">Macro</span>
                  <select
                    className="binds-window__select"
                    value={selectedMacroId}
                    onChange={(event) => handleMacroPick(event.target.value)}
                    disabled={!workspace || workspace.macros.length === 0}
                  >
                    <option value="">Pick a macro</option>
                    {workspace?.macros.map((macro) => (
                      <option key={macro.id} value={macro.id}>
                        {macro.label} ({macro.programName} / {macro.panelName})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="binds-window__bind-button"
                  onClick={() => void handleAddMacro()}
                >
                  Add Macro
                </button>
              </>
            )}

            <label className="binds-window__field">
              <span className="binds-window__field-label">Shortcut</span>
              <div className="binds-window__shortcut-combo" ref={shortcutMenuRef}>
              <input
                className="binds-window__input"
                type="text"
                value={shortcutInput}
                placeholder={UNBOUND_SHORTCUT_LABEL}
                disabled={!activeButton}
                onChange={(event) => {
                  setShortcutInput(event.target.value);
                  setStatusMessage("");
                }}
                onFocus={() => {
                  if (activeButton) {
                    setIsShortcutMenuOpen(false);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" && activeButton) {
                    event.preventDefault();
                    setIsShortcutMenuOpen(true);
                  }
                }}
                onBlur={(event) => {
                  const trimmed = event.target.value.trim();
                  if (
                    !trimmed ||
                    trimmed.localeCompare(UNBOUND_SHORTCUT_LABEL, undefined, {
                      sensitivity: "accent"
                    }) === 0
                  ) {
                    setShortcutInput("");
                    return;
                  }

                  const parsedShortcut = parseShortcutInput(trimmed);
                  if (parsedShortcut.trim()) {
                    setShortcutInput(formatShortcutForDisplay(parsedShortcut));
                  }
                }}
              />
                <button
                  type="button"
                  className="binds-window__shortcut-toggle"
                  aria-label="Show safe shortcuts"
                  aria-expanded={isShortcutMenuOpen}
                  disabled={!activeButton}
                  onClick={() => {
                    if (!activeButton) {
                      return;
                    }
                    setIsShortcutMenuOpen((current) => !current);
                  }}
                >
                  ▼
                </button>
                {isShortcutMenuOpen && activeButton ? (
                  <div className="binds-window__shortcut-menu" role="listbox">
                    {shortcutPickerOptions.map((displayShortcut) => (
                      <button
                        key={displayShortcut}
                        type="button"
                        className={`binds-window__shortcut-option ${
                          (displayShortcut === UNBOUND_SHORTCUT_LABEL ? "" : displayShortcut) ===
                          shortcutInput
                            ? "is-selected"
                            : ""
                        }`}
                        onClick={() => applyShortcutChoice(displayShortcut)}
                      >
                        {displayShortcut}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </label>

            <button
              type="button"
              className="binds-window__bind-button"
              disabled={isSaving || !activeProgram || !activeButton}
              onClick={() => void handleSaveBinding()}
            >
              {isSaving ? "Binding..." : "Bind"}
            </button>
          </div>

          <p className="binds-window__toolbar-note">
            Pick one button and one shortcut. Type a custom shortcut if needed, or open the safe
            suggestions menu.
          </p>

          {statusMessage ? (
            <p className={`binds-window__status ${statusTone}`}>{statusMessage}</p>
          ) : null}
          {!hasSafeSuggestions && activeButton ? (
            <p className="binds-window__status is-error">No safe shortcuts available for this program.</p>
          ) : null}
          {workspace?.warnings[0] ? (
            <p className="binds-window__warning">{workspace.warnings[0]}</p>
          ) : null}
          {loadError ? (
            <p className="binds-window__status is-error">Failed to load Binds. {loadError}</p>
          ) : null}

          <section className="binds-window__grid">
            <article className="binds-window__card">
              <header className="binds-window__section-header">
                <div>
                  <h2>Current Panel Binds</h2>
                  <p>{currentPanelPath}</p>
                </div>
              </header>

              {selectedPanel && selectedPanel.buttons.length > 0 ? (
                <div className="binds-window__table" role="table" aria-label="Current panel binds">
                  <div className="binds-window__table-header" role="row">
                    <span role="columnheader">Button</span>
                    <span role="columnheader">Shortcut</span>
                  </div>
                  <div className="binds-window__table-body">
                    {selectedPanel.buttons.map((button) => (
                      <button
                        key={button.id}
                        type="button"
                        className={`binds-window__table-row ${
                          button.id === selection.buttonId ? "is-selected" : ""
                        }`}
                        role="row"
                        onClick={() => handleButtonChange(button.id)}
                      >
                        <span>{button.label}</span>
                        <span>{formatBoundShortcut(button.shortcut)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="binds-window__empty">No buttons in this panel.</p>
              )}
            </article>

            <article className="binds-window__card">
              <header className="binds-window__section-header">
                <div>
                  <h2>Global Buttons</h2>
                  <p>All programs / panels</p>
                </div>
              </header>

              <div className="binds-window__global-list">
                {globalButtonGroups.map((group) => (
                  <section
                    key={`${group.programName}:${group.panelName}`}
                    className="binds-window__global-group"
                  >
                    <h3>
                      {group.programName} / {group.panelName}
                    </h3>
                    <div className="binds-window__global-buttons">
                      {group.buttons.map((button) => (
                        <button
                          key={button.id}
                          type="button"
                          className={`binds-window__global-button ${
                            group.programName === selection.programName &&
                            group.panelName === selection.panelName &&
                            button.id === selection.buttonId
                              ? "is-selected"
                              : ""
                          }`}
                          onClick={() =>
                            handleGlobalButtonPick(group.programName, group.panelName, button.id)
                          }
                        >
                          <span>{button.label}</span>
                          <small>{formatBoundShortcut(button.shortcut)}</small>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </article>
          </section>
        </section>
      </section>
    </main>
  );
}
