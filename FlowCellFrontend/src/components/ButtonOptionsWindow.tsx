import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildAvailableCandidateShortcuts,
  buildUsedShortcutMap,
  formatShortcutForDisplay,
  normalizeShortcut,
  parseShortcutInput
} from "../lib/bindings";
import type { FlowCellBindingsState, FlowCellButton } from "../types";

interface ButtonDraft {
  label: string;
  tooltip: string;
  shortcutInput: string;
  savedLabel: string;
  savedTooltip: string;
  savedShortcut: string;
}

interface RowFeedback {
  kind: "success" | "error";
  message: string;
}

interface ButtonOptionsWindowProps {
  panelName: string;
  buttons: FlowCellButton[];
  bindingsState: FlowCellBindingsState | null;
  onSaveDetails: (buttonId: string, label: string, tooltip: string) => Promise<void>;
  onSaveShortcut: (buttonId: string, shortcut: string) => Promise<void>;
  onClearShortcut: (buttonId: string) => Promise<void>;
  onDeleteButtons: (buttonIds: string[]) => Promise<void>;
  onClose: () => void;
}

function createDraft(button: FlowCellButton): ButtonDraft {
  const savedTooltip = button.Tooltip ?? "";
  const savedShortcut = button.Shortcut?.trim() ?? "";
  return {
    label: button.Label,
    tooltip: savedTooltip,
    shortcutInput: formatShortcutForDisplay(savedShortcut),
    savedLabel: button.Label,
    savedTooltip,
    savedShortcut
  };
}

function syncDraft(
  current: ButtonDraft | undefined,
  button: FlowCellButton
): ButtonDraft {
  const nextSavedLabel = button.Label;
  const nextSavedTooltip = button.Tooltip ?? "";
  const nextSavedShortcut = button.Shortcut?.trim() ?? "";
  const nextShortcutDisplay = formatShortcutForDisplay(nextSavedShortcut);

  if (!current) {
    return createDraft(button);
  }

  return {
    label: current.label === current.savedLabel ? nextSavedLabel : current.label,
    tooltip:
      current.tooltip === current.savedTooltip ? nextSavedTooltip : current.tooltip,
    shortcutInput:
      current.shortcutInput === formatShortcutForDisplay(current.savedShortcut)
        ? nextShortcutDisplay
        : current.shortcutInput,
    savedLabel: nextSavedLabel,
    savedTooltip: nextSavedTooltip,
    savedShortcut: nextSavedShortcut
  };
}

export function ButtonOptionsWindow({
  panelName,
  buttons,
  bindingsState,
  onSaveDetails,
  onSaveShortcut,
  onClearShortcut,
  onDeleteButtons,
  onClose
}: ButtonOptionsWindowProps) {
  const [drafts, setDrafts] = useState<Record<string, ButtonDraft>>({});
  const [checkedButtonIds, setCheckedButtonIds] = useState<string[]>([]);
  const [rowFeedback, setRowFeedback] = useState<Record<string, RowFeedback | undefined>>({});
  const [deleteFeedback, setDeleteFeedback] = useState<RowFeedback | null>(null);
  const initializedCheckedIdsRef = useRef(false);

  useEffect(() => {
    setDrafts((current) => {
      const next: Record<string, ButtonDraft> = {};
      buttons.forEach((button) => {
        next[button.Id] = syncDraft(current[button.Id], button);
      });
      return next;
    });
  }, [buttons]);

  useEffect(() => {
    const validIds = new Set(buttons.map((button) => button.Id));
    setCheckedButtonIds((current) => {
      if (!initializedCheckedIdsRef.current) {
        initializedCheckedIdsRef.current = true;
        return buttons.map((button) => button.Id);
      }
      return current.filter((buttonId) => validIds.has(buttonId));
    });
  }, [buttons]);

  const buttonById = useMemo(
    () =>
      new Map(
        buttons.map((button) => [button.Id, button] as const)
      ),
    [buttons]
  );

  const allChecked =
    buttons.length > 0 && checkedButtonIds.length === buttons.length;

  const toggleCheckedButton = (buttonId: string) => {
    setDeleteFeedback(null);
    setCheckedButtonIds((current) =>
      current.includes(buttonId)
        ? current.filter((entry) => entry !== buttonId)
        : [...current, buttonId]
    );
  };

  const setAllChecked = (checked: boolean) => {
    setDeleteFeedback(null);
    setCheckedButtonIds(checked ? buttons.map((button) => button.Id) : []);
  };

  const updateDraft = (
    buttonId: string,
    field: keyof Pick<ButtonDraft, "label" | "tooltip" | "shortcutInput">,
    value: string
  ) => {
    setRowFeedback((current) => ({
      ...current,
      [buttonId]: undefined
    }));
    setDrafts((current) => {
      const existing = current[buttonId] ?? createDraft(buttonById.get(buttonId)!);
      return {
        ...current,
        [buttonId]: {
          ...existing,
          [field]: value
        }
      };
    });
  };

  const saveDetails = async (buttonId: string) => {
    const draft = drafts[buttonId];
    const button = buttonById.get(buttonId);
    if (!draft || !button) {
      return;
    }

    const nextLabel = draft.label.trim();
    const nextTooltip = draft.tooltip.trim();
    if (!nextLabel) {
      setRowFeedback((current) => ({
        ...current,
        [buttonId]: {
          kind: "error",
          message: "Button name cannot be empty."
        }
      }));
      return;
    }

    if (nextLabel === button.Label && nextTooltip === (button.Tooltip ?? "")) {
      setRowFeedback((current) => ({
        ...current,
        [buttonId]: {
          kind: "success",
          message: "No text changes to save."
        }
      }));
      return;
    }

    try {
      await onSaveDetails(buttonId, nextLabel, nextTooltip);
      setDrafts((current) => ({
        ...current,
        [buttonId]: {
          ...(current[buttonId] ?? draft),
          label: nextLabel,
          tooltip: nextTooltip,
          savedLabel: nextLabel,
          savedTooltip: nextTooltip
        }
      }));
      setRowFeedback((current) => ({
        ...current,
        [buttonId]: {
          kind: "success",
          message: "Saved name and description."
        }
      }));
    } catch (error) {
      setRowFeedback((current) => ({
        ...current,
        [buttonId]: {
          kind: "error",
          message: error instanceof Error ? error.message : String(error)
        }
      }));
    }
  };

  const saveShortcut = async (buttonId: string) => {
    const draft = drafts[buttonId];
    const button = buttonById.get(buttonId);
    if (!draft || !button) {
      return;
    }

    const parsedShortcut = parseShortcutInput(draft.shortcutInput);
    const normalizedShortcut = normalizeShortcut(parsedShortcut);
    if (!normalizedShortcut) {
      setRowFeedback((current) => ({
        ...current,
        [buttonId]: {
          kind: "error",
          message: "Enter a shortcut or use Clear Shortcut."
        }
      }));
      return;
    }

    const usedShortcuts = buildUsedShortcutMap(
      bindingsState,
      button.Shortcut?.trim() ?? ""
    );
    if (usedShortcuts.has(normalizedShortcut)) {
      setRowFeedback((current) => ({
        ...current,
        [buttonId]: {
          kind: "error",
          message: "That shortcut is already in use."
        }
      }));
      return;
    }

    try {
      await onSaveShortcut(buttonId, normalizedShortcut);
      const displayShortcut = formatShortcutForDisplay(normalizedShortcut);
      setDrafts((current) => ({
        ...current,
        [buttonId]: {
          ...(current[buttonId] ?? draft),
          shortcutInput: displayShortcut,
          savedShortcut: normalizedShortcut
        }
      }));
      setRowFeedback((current) => ({
        ...current,
        [buttonId]: {
          kind: "success",
          message: "Saved shortcut binding."
        }
      }));
    } catch (error) {
      setRowFeedback((current) => ({
        ...current,
        [buttonId]: {
          kind: "error",
          message: error instanceof Error ? error.message : String(error)
        }
      }));
    }
  };

  const clearShortcut = async (buttonId: string) => {
    const draft = drafts[buttonId];
    if (!draft) {
      return;
    }

    try {
      await onClearShortcut(buttonId);
      setDrafts((current) => ({
        ...current,
        [buttonId]: {
          ...(current[buttonId] ?? draft),
          shortcutInput: "",
          savedShortcut: ""
        }
      }));
      setRowFeedback((current) => ({
        ...current,
        [buttonId]: {
          kind: "success",
          message: "Cleared shortcut binding."
        }
      }));
    } catch (error) {
      setRowFeedback((current) => ({
        ...current,
        [buttonId]: {
          kind: "error",
          message: error instanceof Error ? error.message : String(error)
        }
      }));
    }
  };

  const deleteCheckedButtons = async () => {
    if (checkedButtonIds.length === 0) {
      setDeleteFeedback({
        kind: "error",
        message: "Check at least one button before deleting."
      });
      return;
    }

    const checkedLabels = checkedButtonIds.map(
      (buttonId) => buttonById.get(buttonId)?.Label ?? buttonId
    );
    const confirmed = window.confirm(
      `Delete ${checkedButtonIds.length} button(s) from ${panelName}?\n\n${checkedLabels.join("\n")}`
    );
    if (!confirmed) {
      return;
    }

    try {
      await onDeleteButtons(checkedButtonIds);
      setDeleteFeedback({
        kind: "success",
        message: `Deleted ${checkedButtonIds.length} button(s).`
      });
      setCheckedButtonIds([]);
    } catch (error) {
      setDeleteFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  };

  if (buttons.length === 0) {
    return (
      <div className="button-options-window">
        <section className="surface-card appearance-card">
          <div className="surface-header">
            <div>
              <span className="eyebrow">Button Options</span>
              <h2>{panelName}</h2>
            </div>
            <button type="button" className="surface-action" onClick={onClose}>
              Close
            </button>
          </div>
          <p className="caption">
            No checked buttons are available in this panel. Reopen this window from the main page
            after checking the buttons you want to edit.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="button-options-window">
      <section className="surface-card appearance-card">
        <div className="surface-header">
          <div>
            <span className="eyebrow">Button Options</span>
            <h2>{panelName}</h2>
          </div>
          <div className="surface-actions">
            <button
              type="button"
              className="surface-action"
              disabled={checkedButtonIds.length === 0}
              onClick={() => {
                void deleteCheckedButtons();
              }}
            >
              Delete Checked
            </button>
            <button type="button" className="surface-action" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <p className="caption">
          These rows come from the checked buttons on the main page. Rename buttons, update each
          description, save or clear shortcuts per row, and use the row checkboxes for delete
          operations.
        </p>
        <div className="button-options-window__toolbar">
          <label className="button-options-window__master-toggle">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={(event) => setAllChecked(event.target.checked)}
            />
            <span>Select all rows for delete</span>
          </label>
          <span className="caption">
            {checkedButtonIds.length} of {buttons.length} checked for delete
          </span>
        </div>
        {deleteFeedback ? (
          <p
            className={`caption ${deleteFeedback.kind === "error" ? "bind-editor-feedback is-error" : ""}`}
          >
            {deleteFeedback.message}
          </p>
        ) : null}
      </section>

      <section className="surface-card appearance-card button-options-window__workspace">
        <div className="button-options-window__list">
          {buttons.map((button) => {
            const draft = drafts[button.Id] ?? createDraft(button);
            const feedback = rowFeedback[button.Id];
            const detailsDirty =
              draft.label.trim() !== button.Label ||
              draft.tooltip.trim() !== (button.Tooltip ?? "");
            const normalizedShortcut = normalizeShortcut(parseShortcutInput(draft.shortcutInput));
            const usedShortcuts = buildUsedShortcutMap(
              bindingsState,
              button.Shortcut?.trim() ?? ""
            );
            const shortcutConflict =
              Boolean(normalizedShortcut) && usedShortcuts.has(normalizedShortcut);
            const shortcutSuggestions = buildAvailableCandidateShortcuts(
              bindingsState,
              draft.shortcutInput || button.Shortcut?.trim() || ""
            );
            const datalistId = `button-options-shortcuts-${button.Id}`;

            return (
              <article key={button.Id} className="button-options-window__row">
                <div className="button-options-window__row-header">
                  <label className="button-options-window__row-toggle">
                    <input
                      type="checkbox"
                      checked={checkedButtonIds.includes(button.Id)}
                      onChange={() => toggleCheckedButton(button.Id)}
                    />
                    <span>Delete</span>
                  </label>
                  <div className="button-options-window__row-meta">
                    <strong>{button.Label}</strong>
                    <span className="caption">
                      {button.Kind} {button.Target ? `- ${button.Target}` : ""}
                    </span>
                  </div>
                </div>

                <div className="button-options-window__fields">
                  <label className="compound-field">
                    <span>Name</span>
                    <input
                      type="text"
                      value={draft.label}
                      onChange={(event) => updateDraft(button.Id, "label", event.target.value)}
                    />
                  </label>
                  <label className="compound-field">
                    <span>Shortcut</span>
                    <input
                      list={datalistId}
                      type="text"
                      value={draft.shortcutInput}
                      placeholder="Control + Alt + 1"
                      onChange={(event) =>
                        updateDraft(button.Id, "shortcutInput", event.target.value)
                      }
                      onBlur={(event) => {
                        const parsedShortcut = parseShortcutInput(event.target.value);
                        if (parsedShortcut.trim()) {
                          updateDraft(
                            button.Id,
                            "shortcutInput",
                            formatShortcutForDisplay(parsedShortcut)
                          );
                        }
                      }}
                    />
                    <select
                      value=""
                      onChange={(event) => {
                        if (!event.target.value) {
                          return;
                        }
                        updateDraft(button.Id, "shortcutInput", event.target.value);
                        event.target.value = "";
                      }}
                    >
                      <option value="">Available shortcuts...</option>
                      {shortcutSuggestions.map((shortcut) => {
                        const displayShortcut = formatShortcutForDisplay(shortcut);
                        return (
                          <option key={shortcut} value={displayShortcut}>
                            {displayShortcut}
                          </option>
                        );
                      })}
                    </select>
                    <datalist id={datalistId}>
                      {shortcutSuggestions.map((shortcut) => (
                        <option key={shortcut} value={formatShortcutForDisplay(shortcut)} />
                      ))}
                    </datalist>
                  </label>
                  <label className="compound-field button-options-window__description">
                    <span>Description</span>
                    <textarea
                      rows={3}
                      value={draft.tooltip}
                      onChange={(event) => updateDraft(button.Id, "tooltip", event.target.value)}
                    />
                  </label>
                </div>

                <div className="button-options-window__row-actions">
                  <button
                    type="button"
                    className="surface-action"
                    disabled={!detailsDirty || !draft.label.trim()}
                    onClick={() => {
                      void saveDetails(button.Id);
                    }}
                  >
                    Save Text
                  </button>
                  <button
                    type="button"
                    className="surface-action"
                    disabled={!draft.shortcutInput.trim() || shortcutConflict}
                    onClick={() => {
                      void saveShortcut(button.Id);
                    }}
                  >
                    Save Shortcut
                  </button>
                  <button
                    type="button"
                    className="surface-action"
                    disabled={!button.Shortcut?.trim() && !draft.shortcutInput.trim()}
                    onClick={() => {
                      void clearShortcut(button.Id);
                    }}
                  >
                    Clear Shortcut
                  </button>
                </div>

                {shortcutConflict ? (
                  <p className="caption bind-editor-feedback is-error">
                    That shortcut is already in use.
                  </p>
                ) : null}
                {feedback ? (
                  <p
                    className={`caption ${feedback.kind === "error" ? "bind-editor-feedback is-error" : ""}`}
                  >
                    {feedback.message}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
