import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_IMPORTED_SKINS,
  getImportedSkinPreset,
  IMPORTED_SKIN_PRESETS
} from "../lib/theme";
import { getImportedSkin, renderButtonSkin, resolveStyleGroup } from "../lib/skins";
import type { FlowCellButton, ImportedSkin, StyleGroup } from "../types";

export const BUTTON_APPEARANCE_ALL_BUTTONS_ID = "__all_buttons__";

interface ButtonAppearanceWindowProps {
  panelName: string;
  buttons: FlowCellButton[];
  importedSkins: ImportedSkin[];
  styleGroups: StyleGroup[];
  selectedButtonId: string;
  onSelectedButtonChange: (buttonId: string) => void;
  onSave: (buttonId: string, skin: ImportedSkin) => void;
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
    id: baseSkin.id,
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
    return {
      ...currentImportedSkin,
      name: currentImportedSkin.name?.trim() || `${button.Label} Skin`
    };
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
        return {
          ...sharedImportedSkin,
          name: sharedImportedSkin.name?.trim() || "Panel Buttons Skin"
        };
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

export function ButtonAppearanceWindow({
  panelName,
  buttons,
  importedSkins,
  styleGroups,
  selectedButtonId,
  onSelectedButtonChange,
  onSave,
  onClose
}: ButtonAppearanceWindowProps) {
  const isAllButtonsSelection = selectedButtonId === BUTTON_APPEARANCE_ALL_BUTTONS_ID;
  const previewButton =
    buttons.find((button) => button.Id === selectedButtonId) ?? buttons[0] ?? null;
  const [draft, setDraft] = useState<ImportedSkin | null>(() =>
    buildDraftFromSelection(buttons, selectedButtonId, styleGroups, importedSkins)
  );

  useEffect(() => {
    setDraft(buildDraftFromSelection(buttons, selectedButtonId, styleGroups, importedSkins));
  }, [buttons, importedSkins, selectedButtonId, styleGroups]);

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
    : resolveStyleLabel(previewButton.style_group_id ?? "", styleGroups);
  const previewLabel = isAllButtonsSelection ? "All Buttons" : previewButton.Label;

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
              onClick={() => onSave(selectedButtonId || previewButton.Id, draft)}
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
            ? "This editor saves one dedicated imported skin onto every regular button in this panel."
            : "This editor saves a dedicated imported skin onto one button at a time."}{" "}
          The current style source is <strong>{currentStyleLabel}</strong>.
        </p>
      </section>

      <section className="surface-card appearance-card button-appearance-window__workspace">
        <div className="button-appearance-window__editor">
          <div className="button-appearance-window__sidebar">
            <div className="button-appearance-window__controls">
              <label>
                Button
                <select
                  value={selectedButtonId || previewButton.Id}
                  onChange={(event) => onSelectedButtonChange(event.target.value)}
                >
                  <option value={BUTTON_APPEARANCE_ALL_BUTTONS_ID}>All Buttons In Panel</option>
                  {buttons.map((button) => (
                    <option key={button.Id} value={button.Id}>
                      {button.Label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Preset
                <select
                  defaultValue=""
                  onChange={(event) => {
                    const presetId = event.target.value;
                    if (!presetId) {
                      return;
                    }
                    const presetSkin = getImportedSkinPreset(presetId);
                    if (!presetSkin) {
                      return;
                    }
                    setDraft((current) => ({
                      ...(current ?? buildFallbackDraft(previewLabel)),
                      ...presetSkin,
                      id: current?.id ?? presetSkin.id,
                      name: presetSkin.name
                    }));
                    event.target.value = "";
                  }}
                >
                  <option value="">Load preset...</option>
                  {IMPORTED_SKIN_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Skin Name
                <input
                  value={draft.name}
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
                    </>
                  ) : (
                    <>
                      <strong>{previewButton.Label}</strong>
                      <span className="caption">
                        {previewButton.Tooltip || "No description set."}
                      </span>
                      <span className="caption">{previewButton.Target || "No target."}</span>
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
            </div>
            <p className="caption">
              Render-only code only. The label placeholder is <code>{"{{label}}"}</code>.
            </p>
            <article className="imported-skin-editor">
              <label>
                HTML
                <textarea
                  rows={7}
                  value={draft.html}
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
