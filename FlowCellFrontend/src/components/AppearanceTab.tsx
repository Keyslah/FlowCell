import { useEffect, useMemo, useState } from "react";
import type {
  AppTheme,
  FlowCellProgram,
  FlowCellState,
  ImportedSkin,
  StyleGroup,
  SurfaceStyleSectionId
} from "../types";
import {
  buildAppThemeCssVars,
  getImportedSkinPreset,
  IMPORTED_SKIN_PRESETS
} from "../lib/theme";
import {
  getImportedSkin,
  renderButtonSkin,
  renderSurfaceSkin,
  resolveStyleGroup
} from "../lib/skins";

interface AppearanceTabProps {
  state: FlowCellState;
  appTheme: AppTheme;
  selectedProgram: FlowCellProgram;
  selectedPanelName: string;
  onClose: () => void;
  onSaveTheme: () => void;
  onApplyDarkTheme: () => void;
  onApplyBlackTintCards: () => void;
  onApplyNatureTheme: () => void;
  onApplyEggshellTheme: () => void;
  onUpdateAppTheme: (appTheme: AppTheme) => void;
  onApplyProgramStyleGroup: (styleGroupId: string) => void;
  onUpdateSurfaceStyleAssignment: (
    surfaceId: SurfaceStyleSectionId,
    styleGroupId: string
  ) => void;
  onSaveImportedSkin: (skin: ImportedSkin) => void;
}

interface SectionCardConfig {
  id: SurfaceStyleSectionId | "programs";
  title: string;
  description: string;
  applyLabel: string;
  previewKind: "button" | "card";
  previewLabel: string;
}

const MAIN_PAGE_SECTIONS: SectionCardConfig[] = [
  {
    id: "programs",
    title: "Programs",
    description: "Program rail buttons on the main page.",
    applyLabel: "Apply to All Programs",
    previewKind: "button",
    previewLabel: "Program"
  },
  {
    id: "main-panels",
    title: "Panels",
    description: "Panel rail buttons and the Appearance rail entry.",
    applyLabel: "Apply to Panel Rail",
    previewKind: "button",
    previewLabel: "Panel"
  },
  {
    id: "main-panel-surface",
    title: "Panel Surface",
    description: "The large main working surface behind the current panel. Uses saved card code.",
    applyLabel: "Apply to Panel Surface",
    previewKind: "card",
    previewLabel: "Panel Surface"
  },
  {
    id: "main-cards",
    title: "Cards",
    description: "Bind area, status cards, and card-like main page blocks. Uses saved card code.",
    applyLabel: "Apply to Cards",
    previewKind: "card",
    previewLabel: "Card"
  },
  {
    id: "main-misc",
    title: "Misc",
    description: "Min / Max / Close and other host-owned action buttons.",
    applyLabel: "Apply to Main Buttons",
    previewKind: "button",
    previewLabel: "Close"
  }
];

const POPOUT_SECTIONS: SectionCardConfig[] = [
  {
    id: "popout-regular-buttons",
    title: "Regular Buttons",
    description: "Regular FlowCell button surfaces shown in panel/tool pop-outs.",
    applyLabel: "Apply to Pop-out Buttons",
    previewKind: "button",
    previewLabel: "Button"
  },
  {
    id: "popout-tools",
    title: "Tool Section",
    description: "Tool-chip buttons and compact tool surfaces inside pop-outs. Tool surfaces use card code.",
    applyLabel: "Apply to Pop-out Tools",
    previewKind: "card",
    previewLabel: "Tool Surface"
  }
];

function buildPreviewStyleGroup(importedSkinId: string): StyleGroup {
  return {
    id: "preview-style-group",
    index: 0,
    name: "Preview",
    skinId: "imported-skin",
    importedSkinId,
    accent: "#d2b28a"
  };
}

function buildSurfaceSkinStyle(styleGroup?: StyleGroup) {
  return styleGroup
    ? ({
        ["--surface-style-accent" as string]: styleGroup.accent
      } as const)
    : undefined;
}

function readAssignment(
  state: FlowCellState,
  surfaceId: SurfaceStyleSectionId
): string {
  return (
    state.SurfaceStyleAssignments?.find((assignment) => assignment.surface_id === surfaceId)
      ?.style_group_id ?? ""
  );
}

export function AppearanceTab({
  state,
  appTheme,
  selectedProgram,
  selectedPanelName,
  onClose,
  onSaveTheme,
  onApplyDarkTheme,
  onApplyBlackTintCards,
  onApplyNatureTheme,
  onApplyEggshellTheme,
  onUpdateAppTheme,
  onApplyProgramStyleGroup,
  onUpdateSurfaceStyleAssignment,
  onSaveImportedSkin
}: AppearanceTabProps) {
  const styleGroups = state.StyleGroups ?? [];
  const importedSkins = state.ImportedSkins ?? [];
  const loadEditorSkinDraft = (skinId: string) => {
    const sourceSkin = importedSkins.find((skin) => skin.id === skinId) ?? importedSkins[0];
    if (!sourceSkin) {
      setEditorSkinId("");
      setEditorDraft(null);
      return;
    }
    setEditorSkinId(sourceSkin.id);
    setEditorDraft({ ...sourceSkin });
  };

  const [sectionDrafts, setSectionDrafts] = useState<Record<string, string>>({
    programs: selectedProgram.style_group_id ?? "",
    "main-panels": readAssignment(state, "main-panels"),
    "main-panel-surface": readAssignment(state, "main-panel-surface"),
    "main-cards": readAssignment(state, "main-cards"),
    "main-misc": readAssignment(state, "main-misc"),
    "popout-regular-buttons": readAssignment(state, "popout-regular-buttons"),
    "popout-tools": readAssignment(state, "popout-tools")
  });
  const [editorSkinId, setEditorSkinId] = useState<string>(importedSkins[0]?.id ?? "");
  const [editorDraft, setEditorDraft] = useState<ImportedSkin | null>(
    importedSkins[0] ? { ...importedSkins[0] } : null
  );
  const [themeDraft, setThemeDraft] = useState<AppTheme>({ ...appTheme });

  useEffect(() => {
    setSectionDrafts({
      programs: selectedProgram.style_group_id ?? "",
      "main-panels": readAssignment(state, "main-panels"),
      "main-panel-surface": readAssignment(state, "main-panel-surface"),
      "main-cards": readAssignment(state, "main-cards"),
      "main-misc": readAssignment(state, "main-misc"),
      "popout-regular-buttons": readAssignment(state, "popout-regular-buttons"),
      "popout-tools": readAssignment(state, "popout-tools")
    });
  }, [
    selectedProgram.style_group_id,
    state.SurfaceStyleAssignments
  ]);

  useEffect(() => {
    setThemeDraft({ ...appTheme });
  }, [appTheme]);

  useEffect(() => {
    if (importedSkins.length === 0) {
      setEditorSkinId("");
      setEditorDraft(null);
      return;
    }
    if (!editorDraft) {
      loadEditorSkinDraft(editorSkinId || importedSkins[0].id);
      return;
    }
    if (!importedSkins.some((skin) => skin.id === editorSkinId)) {
      loadEditorSkinDraft(importedSkins[0].id);
    }
  }, [editorDraft, editorSkinId, importedSkins]);

  const previewDraftStyleGroup = useMemo(
    () => (editorDraft ? buildPreviewStyleGroup(editorDraft.id) : undefined),
    [editorDraft]
  );
  const draftCardPreview =
    editorDraft && previewDraftStyleGroup
      ? renderSurfaceSkin({
          label: "Card Preview",
          styleGroup: previewDraftStyleGroup,
          importedSkin: editorDraft
        })
      : null;
  const textPreviewStyle = useMemo(() => buildAppThemeCssVars(themeDraft), [themeDraft]);

  const setSectionDraft = (id: string, styleGroupId: string) => {
    setSectionDrafts((current) => ({
      ...current,
      [id]: styleGroupId
    }));
  };

  const updateThemeDraft = (
    field: "pageForeground" | "mutedForeground",
    value: string
  ) => {
    setThemeDraft((current) => ({
      ...current,
      [field]: value
    }));
  };

  const renderSectionPreview = (config: SectionCardConfig) => {
    const styleGroupId =
      config.id === "programs" ? sectionDrafts.programs : sectionDrafts[config.id];
    const styleGroup = resolveStyleGroup(styleGroups, styleGroupId);
    const importedSkin = getImportedSkin(importedSkins, styleGroup?.importedSkinId);
    const previewLabel = config.previewLabel;
    const surfaceSkin = styleGroup
      ? renderSurfaceSkin({
          label: previewLabel,
          styleGroup,
          importedSkin
        })
      : null;

    if (config.previewKind === "button") {
      return (
        <div className="program-style-preview">
          {styleGroup ? (
            renderButtonSkin({
              label: previewLabel,
              styleGroup,
              importedSkin,
              selected: true
            })
          ) : (
            <div className="appearance-default-preview">
              <span>{previewLabel}</span>
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        className={styleGroup ? "appearance-surface-preview has-surface-skin" : "appearance-surface-preview"}
        style={buildSurfaceSkinStyle(styleGroup)}
        data-surface-skin={styleGroup?.skinId ?? ""}
      >
        {surfaceSkin ? <div className="surface-skin-visual" aria-hidden="true">{surfaceSkin}</div> : null}
        <div className="appearance-surface-preview__content">
          <span className="eyebrow">{previewLabel}</span>
          <strong>{config.title}</strong>
          <span className="caption">{config.description}</span>
        </div>
      </div>
    );
  };

  const renderSectionCard = (config: SectionCardConfig) => {
    const draftValue =
      config.id === "programs" ? sectionDrafts.programs : sectionDrafts[config.id];

    return (
      <article className="appearance-section-card" key={config.id}>
        <div className="appearance-section-card__header">
          <div>
            <span className="eyebrow">{config.title}</span>
            <strong>{config.title}</strong>
          </div>
          <button
            type="button"
            className="surface-action"
            onClick={() => {
              if (config.id === "programs") {
                onApplyProgramStyleGroup(draftValue);
                return;
              }
              onUpdateSurfaceStyleAssignment(config.id, draftValue);
            }}
          >
            {config.applyLabel}
          </button>
        </div>
        <span className="caption">{config.description}</span>
        <label>
          Style Group
          <select
            value={draftValue}
            onChange={(event) => setSectionDraft(config.id, event.target.value)}
          >
            <option value="">Host Default</option>
            {styleGroups.map((styleGroup) => (
              <option key={styleGroup.id} value={styleGroup.id}>
                {styleGroup.name}
              </option>
            ))}
          </select>
        </label>
      </article>
    );
  };

  return (
    <div className="appearance-tab">
      <section className="surface-card appearance-card">
        <div className="surface-header">
          <div>
            <span className="eyebrow">Appearance</span>
            <h2>Theme Studio</h2>
          </div>
          <div className="surface-actions">
            <button type="button" className="surface-action" onClick={onSaveTheme}>
              Save Theme
            </button>
            <button type="button" className="surface-action" onClick={onClose}>
              Back to {selectedPanelName}
            </button>
          </div>
        </div>
        <p className="caption">
          The shell theme is currently <strong>{appTheme.name}</strong>. Theme preset actions only
          update the shell page, cards, and host chrome. Button sections use saved button
          HTML/CSS/SVG. Card and panel-surface sections use the saved card HTML/CSS/SVG.
        </p>
      </section>

      <section className="surface-card appearance-card">
        <div className="surface-header">
          <div>
            <span className="eyebrow">Main Page</span>
            <h2>Main Page Sections</h2>
          </div>
          <div className="surface-actions">
            <button type="button" className="surface-action" onClick={onApplyDarkTheme}>
              Use Dark Theme
            </button>
            <button type="button" className="surface-action" onClick={onApplyBlackTintCards}>
              Use Black Tint Cards
            </button>
            <button type="button" className="surface-action" onClick={onApplyNatureTheme}>
              Use Nature Theme
            </button>
            <button type="button" className="surface-action" onClick={onApplyEggshellTheme}>
              Use Eggshell Theme
            </button>
          </div>
        </div>
        <div className="appearance-section-grid">
          {MAIN_PAGE_SECTIONS.map((config) => renderSectionCard(config))}
        </div>
      </section>

      <section className="surface-card appearance-card">
        <div className="surface-header">
          <div>
            <span className="eyebrow">Theme Tweaks</span>
            <h2>Shell Text + Blur</h2>
          </div>
          <button
            type="button"
            className="surface-action"
            onClick={() => onUpdateAppTheme(themeDraft)}
          >
            Apply Theme Tweaks
          </button>
        </div>
        <p className="caption">
          Change the host-owned shell text only. This updates page copy, captions, and other
          themed chrome text without changing button skins. Main card blur changes the large
          host-owned shells without editing button HTML/CSS/SVG.
        </p>
        <div className="appearance-theme-grid">
          <label className="appearance-color-field">
            Primary Text
            <div className="appearance-color-field__controls">
              <span
                className="appearance-color-swatch"
                style={{ backgroundColor: themeDraft.pageForeground }}
                aria-hidden="true"
              />
              <input
                value={themeDraft.pageForeground}
                onChange={(event) => updateThemeDraft("pageForeground", event.target.value)}
              />
            </div>
          </label>
          <label className="appearance-color-field">
            Secondary Text
            <div className="appearance-color-field__controls">
              <span
                className="appearance-color-swatch"
                style={{ backgroundColor: themeDraft.mutedForeground }}
                aria-hidden="true"
              />
              <input
                value={themeDraft.mutedForeground}
                onChange={(event) => updateThemeDraft("mutedForeground", event.target.value)}
              />
            </div>
          </label>
          <label className="appearance-color-field">
            Main Card Blur
            <div className="appearance-slider-field">
              <input
                type="range"
                min="0"
                max="40"
                step="1"
                value={themeDraft.mainCardBlurPx}
                onChange={(event) =>
                  setThemeDraft((current) => ({
                    ...current,
                    mainCardBlurPx: Number(event.target.value)
                  }))
                }
              />
              <span>{themeDraft.mainCardBlurPx}px</span>
            </div>
          </label>
        </div>
        <div className="appearance-text-preview" style={textPreviewStyle}>
          <span className="eyebrow">Preview</span>
          <strong>Primary text uses the main shell text color.</strong>
          <span className="caption">
            Secondary text uses the muted shell text color. Current host-card blur is{" "}
            {themeDraft.mainCardBlurPx}px.
          </span>
        </div>
      </section>

      <section className="surface-card appearance-card">
        <div className="surface-header">
          <div>
            <span className="eyebrow">Pop-out</span>
            <h2>Pop-out Sections</h2>
          </div>
        </div>
        <div className="appearance-section-grid">
          {POPOUT_SECTIONS.map((config) => renderSectionCard(config))}
        </div>
      </section>

      <section className="surface-card appearance-card">
        <div className="surface-header">
          <div>
            <span className="eyebrow">Imported Skin Editor</span>
            <h2>Code + Live Preview</h2>
          </div>
          {editorDraft ? (
            <button
              type="button"
              className="surface-action"
              onClick={() => onSaveImportedSkin(editorDraft)}
            >
              Save Skin
            </button>
          ) : null}
        </div>
        <p className="caption">
          Edit render-only code only. Button sections read the button HTML/CSS/SVG fields below.
          Card, panel-surface, and pop-out surface sections read the Card HTML/CSS/SVG fields.
          Previews update live as you type.
        </p>
        <div className="style-group-list">
          <article className="style-group-card">
            <div className="appearance-editor-controls">
              <label>
                Saved Skin
                <select
                  value={editorSkinId}
                  onChange={(event) => loadEditorSkinDraft(event.target.value)}
                >
                  {importedSkins.map((skin) => (
                    <option key={skin.id} value={skin.id}>
                      {skin.name}
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
                    const targetSkinId = importedSkins.some((skin) => skin.id === presetSkin.id)
                      ? presetSkin.id
                      : editorDraft?.id || importedSkins[0]?.id || presetSkin.id;
                    setEditorSkinId(targetSkinId);
                    setEditorDraft({
                      ...presetSkin,
                      id: targetSkinId
                    });
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
            </div>
            {editorDraft && previewDraftStyleGroup ? (
              <div className="appearance-preview-stack">
                <div className="appearance-preview-panel">
                  <span className="eyebrow">Button Preview</span>
                  <div className="preview-card">
                    {renderButtonSkin({
                      label: "Button Preview",
                      styleGroup: previewDraftStyleGroup,
                      importedSkin: editorDraft,
                      selected: true
                    })}
                  </div>
                </div>
                <div className="appearance-preview-panel">
                  <span className="eyebrow">Card Preview</span>
                  <div
                    className="appearance-surface-preview has-surface-skin"
                    style={buildSurfaceSkinStyle(previewDraftStyleGroup)}
                    data-surface-skin={previewDraftStyleGroup.skinId}
                  >
                    {draftCardPreview ? (
                      <div className="surface-skin-visual" aria-hidden="true">
                        {draftCardPreview}
                      </div>
                    ) : null}
                    <div className="appearance-surface-preview__content">
                      <strong>Imported Card Surface</strong>
                      <span className="caption">
                        {draftCardPreview
                          ? "Live card preview."
                          : "Add Card HTML/CSS/SVG to preview larger surfaces."}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </article>

          {editorDraft ? (
            <article className="imported-skin-editor">
              <label>
                Name
                <input
                  value={editorDraft.name}
                  onChange={(event) =>
                    setEditorDraft({
                      ...editorDraft,
                      name: event.target.value
                    })
                  }
                />
              </label>
              <label>
                HTML
                <textarea
                  rows={7}
                  value={editorDraft.html}
                  onChange={(event) =>
                    setEditorDraft({
                      ...editorDraft,
                      html: event.target.value
                    })
                  }
                />
              </label>
              <label>
                CSS
                <textarea
                  rows={16}
                  value={editorDraft.css}
                  onChange={(event) =>
                    setEditorDraft({
                      ...editorDraft,
                      css: event.target.value
                    })
                  }
                />
              </label>
              <label>
                SVG
                <textarea
                  rows={6}
                  value={editorDraft.svg ?? ""}
                  onChange={(event) =>
                    setEditorDraft({
                      ...editorDraft,
                      svg: event.target.value
                    })
                  }
                />
              </label>
              <label>
                Card HTML
                <textarea
                  rows={7}
                  value={editorDraft.cardHtml ?? ""}
                  onChange={(event) =>
                    setEditorDraft({
                      ...editorDraft,
                      cardHtml: event.target.value
                    })
                  }
                />
              </label>
              <label>
                Card CSS
                <textarea
                  rows={16}
                  value={editorDraft.cardCss ?? ""}
                  onChange={(event) =>
                    setEditorDraft({
                      ...editorDraft,
                      cardCss: event.target.value
                    })
                  }
                />
              </label>
              <label>
                Card SVG
                <textarea
                  rows={6}
                  value={editorDraft.cardSvg ?? ""}
                  onChange={(event) =>
                    setEditorDraft({
                      ...editorDraft,
                      cardSvg: event.target.value
                    })
                  }
                />
              </label>
            </article>
          ) : null}
        </div>
      </section>
    </div>
  );
}
