import { useEffect, useMemo, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import {
  DEFAULT_IMPORTED_SKINS,
  buildBlackTintImportedSkin,
  getImportedSkinPreset,
  IMPORTED_SKIN_PRESETS
} from "../lib/theme";
import {
  ensureImportedSkinLabelPlaceholder,
  getImportedSkin,
  IMPORTED_SKIN_LABEL_PLACEHOLDER,
  normalizeImportedSkinHtmlMarkup,
  renderButtonSkin,
  resolveStyleGroup
} from "../lib/skins";
import type { FlowCellButton, ImportedSkin, StyleGroup } from "../types";

export const BUTTON_APPEARANCE_ALL_BUTTONS_ID = "__all_buttons__";
const DEFAULT_BUTTON_PREVIEW_LABEL = "Preview Button";
const DEFAULT_BUTTON_SKIN_NAME = "New Button Skin";

interface ButtonAppearanceWindowProps {
  panelName: string;
  buttons: FlowCellButton[];
  importedSkins: ImportedSkin[];
  styleGroups: StyleGroup[];
  blackTintOpacity: number;
  selectedButtonId: string;
  onSelectedButtonChange: (buttonId: string) => void;
  onSave: (buttonId: string, skin: ImportedSkin, transparentPopout: boolean) => void;
  onSaveImportedSkin: (skin: ImportedSkin) => void;
  onClose: () => void;
}

function buildPreviewStyleGroup(importedSkinId: string): StyleGroup {
  return {
    id: "button-appearance-preview",
    index: 0,
    name: "Button Preview",
    skinId: "imported-skin",
    importedSkinId,
    accent: "#ffb870"
  };
}

function buildFallbackDraft(buttonLabel: string): ImportedSkin {
  const baseSkin = DEFAULT_IMPORTED_SKINS[0];
  return {
    ...baseSkin,
    id: "",
    name: `${buttonLabel} Skin`
  };
}

function buildDraftFromButton(
  button: FlowCellButton | undefined,
  styleGroups: StyleGroup[],
  importedSkins: ImportedSkin[]
): ImportedSkin | null {
  if (!button) {
    return null;
  }

  const currentStyleGroup = resolveStyleGroup(styleGroups, button.style_group_id ?? "");
  const currentImportedSkin =
    currentStyleGroup?.skinId === "imported-skin"
      ? getImportedSkin(importedSkins, currentStyleGroup.importedSkinId)
      : undefined;

  if (currentImportedSkin) {
    return ensureImportedSkinLabelPlaceholder({
      ...currentImportedSkin,
      name: currentImportedSkin.name?.trim() || `${button.Label} Skin`
    });
  }

  return buildFallbackDraft(button.Label);
}

function buildDraftFromSelection(
  buttons: FlowCellButton[],
  selectedButtonId: string,
  styleGroups: StyleGroup[],
  importedSkins: ImportedSkin[]
): ImportedSkin | null {
  if (buttons.length === 0) {
    return null;
  }

  if (!selectedButtonId.trim()) {
    return buildFallbackDraft("New Button");
  }

  if (selectedButtonId === BUTTON_APPEARANCE_ALL_BUTTONS_ID) {
    const uniqueStyleGroupIds = Array.from(
      new Set(buttons.map((button) => button.style_group_id?.trim() ?? ""))
    );
    if (uniqueStyleGroupIds.length === 1) {
      const sharedStyleGroup = resolveStyleGroup(styleGroups, uniqueStyleGroupIds[0]);
      const sharedImportedSkin =
        sharedStyleGroup?.skinId === "imported-skin"
          ? getImportedSkin(importedSkins, sharedStyleGroup.importedSkinId)
          : undefined;
      if (sharedImportedSkin) {
        return ensureImportedSkinLabelPlaceholder({
          ...sharedImportedSkin,
          name: sharedImportedSkin.name?.trim() || "Panel Buttons Skin"
        });
      }
    }
    return buildFallbackDraft("Panel Buttons");
  }

  return buildDraftFromButton(
    buttons.find((button) => button.Id === selectedButtonId) ?? buttons[0],
    styleGroups,
    importedSkins
  );
}

function resolveStyleLabel(styleGroupId: string, styleGroups: StyleGroup[]): string {
  const trimmedId = styleGroupId.trim();
  if (!trimmedId) {
    return "Host Default";
  }
  return resolveStyleGroup(styleGroups, trimmedId)?.name ?? trimmedId;
}

function createDraftSkinId(): string {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  return `imported-skin-${randomPart}`;
}

function applyNormalizedHtmlPaste(args: {
  event: ReactClipboardEvent<HTMLTextAreaElement>;
  currentValue: string;
  onValue: (value: string) => void;
}): void {
  const pastedMarkup = args.event.clipboardData.getData("text");
  if (!pastedMarkup) {
    return;
  }

  const normalizedMarkup = normalizeImportedSkinHtmlMarkup(pastedMarkup);
  if (normalizedMarkup === pastedMarkup) {
    return;
  }

  args.event.preventDefault();
  const textarea = args.event.currentTarget;
  const selectionStart = textarea.selectionStart ?? args.currentValue.length;
  const selectionEnd = textarea.selectionEnd ?? selectionStart;
  args.onValue(
    `${args.currentValue.slice(0, selectionStart)}${normalizedMarkup}${args.currentValue.slice(selectionEnd)}`
  );
}

export function ButtonAppearanceWindow({
  panelName,
  buttons,
  importedSkins,
  styleGroups,
  blackTintOpacity,
  selectedButtonId,
  onSelectedButtonChange,
  onSave,
  onSaveImportedSkin,
  onClose
}: ButtonAppearanceWindowProps) {
  const isAllButtonsSelection = selectedButtonId === BUTTON_APPEARANCE_ALL_BUTTONS_ID;
  const selectedTargetButton =
    buttons.find((button) => button.Id === selectedButtonId) ?? null;
  const previewButton = selectedTargetButton ?? buttons[0] ?? null;
  const hasSelectedTarget = isAllButtonsSelection || selectedTargetButton !== null;
  const [draft, setDraft] = useState<ImportedSkin | null>(() =>
    buildDraftFromSelection(buttons, selectedButtonId, styleGroups, importedSkins)
  );
  const [transparentPopout, setTransparentPopout] = useState(false);

  useEffect(() => {
    if (!draft && buttons.length > 0) {
      setDraft(buildDraftFromSelection(buttons, selectedButtonId, styleGroups, importedSkins));
    }
  }, [buttons, draft, importedSkins, selectedButtonId, styleGroups]);

  useEffect(() => {
    if (buttons.length === 0) {
      setTransparentPopout(false);
      return;
    }
    if (selectedButtonId === BUTTON_APPEARANCE_ALL_BUTTONS_ID) {
      setTransparentPopout(buttons.every((button) => button.transparent_popout === true));
      return;
    }
    const selectedButton = buttons.find((button) => button.Id === selectedButtonId) ?? null;
    setTransparentPopout(selectedButton?.transparent_popout === true);
  }, [buttons, selectedButtonId]);

  const previewStyleGroup = useMemo(
    () => (draft ? buildPreviewStyleGroup(draft.id || "button-appearance-preview") : undefined),
    [draft]
  );

  if (!previewButton || !draft || buttons.length === 0) {
    return (
      <div className="button-appearance-window">
        <section className="surface-card appearance-card">
          <div className="surface-header">
            <div>
              <span className="eyebrow">Button Appearance</span>
              <h2>{panelName}</h2>
            </div>
            <button type="button" className="surface-action" onClick={onClose}>
              Close
            </button>
          </div>
          <p className="caption">This panel does not have any editable buttons yet.</p>
        </section>
      </div>
    );
  }

  const currentStyleLabel = isAllButtonsSelection
    ? (() => {
        const uniqueStyleGroupIds = Array.from(
          new Set(buttons.map((button) => button.style_group_id?.trim() ?? ""))
        );
        return uniqueStyleGroupIds.length === 1
          ? resolveStyleLabel(uniqueStyleGroupIds[0], styleGroups)
          : "Mixed button styles";
      })()
    : selectedTargetButton
      ? resolveStyleLabel(selectedTargetButton.style_group_id ?? "", styleGroups)
      : "No target selected";
  const previewLabel = isAllButtonsSelection
    ? "All Buttons"
    : selectedTargetButton?.Label ?? DEFAULT_BUTTON_PREVIEW_LABEL;
  const saveDraftToSkinLibrary = () => {
    const nextDraft = ensureImportedSkinLabelPlaceholder({
      ...draft,
      id: draft.id.trim() || createDraftSkinId(),
      name:
        draft.name.trim() || (hasSelectedTarget ? `${previewLabel} Skin` : DEFAULT_BUTTON_SKIN_NAME)
    });
    setDraft(nextDraft);
    onSaveImportedSkin(nextDraft);
  };
  const loadSavedSkin = (skinId: string) => {
    if (!skinId.trim()) {
      return;
    }
    const savedSkin = importedSkins.find((skin) => skin.id === skinId);
    if (!savedSkin) {
      return;
    }
    setDraft(ensureImportedSkinLabelPlaceholder({ ...savedSkin }));
  };

  return (
    <div className="button-appearance-window">
      <section className="surface-card appearance-card">
        <div className="surface-header">
          <div>
            <span className="eyebrow">Button Appearance</span>
            <h2>{panelName}</h2>
          </div>
          <div className="surface-actions">
            <button
              type="button"
              className="surface-action"
              disabled={!hasSelectedTarget}
              onClick={() =>
                onSave(
                  selectedButtonId || previewButton.Id,
                  ensureImportedSkinLabelPlaceholder(draft),
                  transparentPopout
                )
              }
            >
              {isAllButtonsSelection ? "Save To Panel Buttons" : "Save To Button"}
            </button>
            <button type="button" className="surface-action" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <p className="caption">
          {isAllButtonsSelection
            ? "This editor saves one dedicated imported skin onto every regular button in this panel, including pop-outs and fanouts."
            : hasSelectedTarget
              ? "This editor saves a dedicated imported skin onto one button at a time, including its pop-out and fanout renders."
              : "Build the skin first, then choose which button should receive it."}{" "}
          The current style source is <strong>{currentStyleLabel}</strong>.
        </p>
      </section>

      <section className="surface-card appearance-card button-appearance-window__workspace">
        <div className="button-appearance-window__editor">
          <div className="button-appearance-window__sidebar">
            <div className="button-appearance-window__controls">
              <label>
                Apply To
                <select
                  value={selectedButtonId}
                  onChange={(event) => onSelectedButtonChange(event.target.value)}
                >
                  <option value="">Choose button...</option>
                  <option value={BUTTON_APPEARANCE_ALL_BUTTONS_ID}>All Buttons In Panel</option>
                  {buttons.map((button) => (
                    <option key={button.Id} value={button.Id}>
                      {button.Label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={transparentPopout}
                  onChange={(event) => setTransparentPopout(event.target.checked)}
                />{" "}
                Transparent Single-Button Pop-out
              </label>
            </div>

            <div className="appearance-preview-stack">
              <div className="appearance-preview-panel">
                <span className="eyebrow">Live Preview</span>
                <div className="preview-card button-appearance-window__preview-card">
                  {previewStyleGroup
                    ? renderButtonSkin({
                        label: previewLabel,
                        styleGroup: previewStyleGroup,
                        importedSkin: draft,
                        selected: true
                      })
                    : null}
                </div>
              </div>
              <div className="appearance-preview-panel">
                <span className="eyebrow">Button Details</span>
                <div className="button-appearance-window__details">
                  {isAllButtonsSelection ? (
                    <>
                      <strong>All Buttons In Panel</strong>
                      <span className="caption">
                        Applies this button skin to all {buttons.length} regular buttons in{" "}
                        {panelName}.
                      </span>
                      <span className="caption">
                        Use this when the whole panel should share one button look.
                      </span>
                      <span className="caption">
                        Single-button pop-out windows will use the transparent button-only shell
                        when this is enabled.
                      </span>
                    </>
                  ) : (
                    <>
                      <strong>{selectedTargetButton?.Label ?? "No button selected yet"}</strong>
                      {selectedTargetButton ? (
                        <>
                          <span className="caption">
                            {selectedTargetButton.Tooltip || "No description set."}
                          </span>
                          <span className="caption">
                            {selectedTargetButton.Target || "No target."}
                          </span>
                          <span className="caption">
                            {transparentPopout
                              ? "Single-button pop-out window will be transparent."
                              : "Single-button pop-out window will use the regular framed shell."}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="caption">
                            The preview stays editable while no button is selected.
                          </span>
                          <span className="caption">
                            Pick a target here only when you are ready to apply the skin.
                          </span>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="button-appearance-window__code">
            <div className="surface-header">
              <div>
                <span className="eyebrow">Render Code</span>
                <h2>HTML + CSS + SVG</h2>
              </div>
              <div className="button-appearance-window__save-controls">
                <label>
                  Skin Name
                  <input
                    value={draft.name}
                    placeholder={DEFAULT_BUTTON_SKIN_NAME}
                    onChange={(event) =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              name: event.target.value
                            }
                          : current
                      )
                    }
                  />
                </label>
                <button type="button" className="surface-action" onClick={saveDraftToSkinLibrary}>
                  Save Code Preset
                </button>
              </div>
            </div>
            <p className="caption">
              Render-only code only. The label placeholder is{" "}
              <code>{IMPORTED_SKIN_LABEL_PLACEHOLDER}</code>. When pasted HTML includes a visible
              caption, the first visible text chunk is converted to that placeholder automatically.
              Saved Code loads your own stored skins. Built-in Preset loads FlowCell starter skins.
            </p>
            <div className="appearance-editor-controls">
              <label>
                Saved Code
                <select
                  value=""
                  onChange={(event) => {
                    loadSavedSkin(event.target.value);
                    event.target.value = "";
                  }}
                >
                  <option value="">Load saved skin...</option>
                  {importedSkins.map((skin) => (
                    <option key={skin.id} value={skin.id}>
                      {skin.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Built-in Preset
                <select
                  value=""
                  onChange={(event) => {
                    const presetId = event.target.value;
                    if (!presetId) {
                      return;
                    }
                    const presetSkin =
                      presetId === "black-tint"
                        ? buildBlackTintImportedSkin(blackTintOpacity)
                        : getImportedSkinPreset(presetId);
                    if (!presetSkin) {
                      return;
                    }
                    setDraft((current) => ({
                      ...(current ?? buildFallbackDraft(previewLabel)),
                      ...ensureImportedSkinLabelPlaceholder(presetSkin),
                      id: current?.id ?? "",
                      name: current?.name?.trim() || presetSkin.name
                    }));
                    event.target.value = "";
                  }}
                >
                  <option value="">Load built-in preset...</option>
                  {IMPORTED_SKIN_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <article className="imported-skin-editor">
              <label>
                HTML
                <textarea
                  rows={7}
                  value={draft.html}
                  onPaste={(event) =>
                    applyNormalizedHtmlPaste({
                      event,
                      currentValue: draft.html,
                      onValue: (value) =>
                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                html: value
                              }
                            : current
                        )
                    })
                  }
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            html: event.target.value
                          }
                        : current
                    )
                  }
                />
              </label>
              <label>
                CSS
                <textarea
                  rows={16}
                  value={draft.css}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            css: event.target.value
                          }
                        : current
                    )
                  }
                />
              </label>
              <label>
                SVG
                <textarea
                  rows={6}
                  value={draft.svg ?? ""}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            svg: event.target.value
                          }
                        : current
                    )
                  }
                />
              </label>
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}
