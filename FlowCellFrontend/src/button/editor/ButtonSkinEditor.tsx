import { useEffect, useMemo, useState } from "react";
import {
  BUTTON_SKIN_COMPILER_VERSION,
  type ButtonCoreMeasurement,
  type ButtonPlacement,
  type ButtonSkin,
  type ButtonSkinSectionName,
  type ButtonTextAlignment,
  type ButtonTextFitMode
} from "../types";
import {
  BUTTON_SKIN_SECTION_ORDER,
  type ButtonSkinSectionSource
} from "../skins/buttonSkinFormat";
import {
  applyNamedButtonSkinSections,
  parseButtonSkinPaste
} from "../skins/skinPasteParser";
import { compileButtonSkin, diagnosticsBySkinSection } from "../skins/skinCompiler";
import { ButtonSkinRenderer } from "../skins/ButtonSkinRenderer";
import { cloneButtonDocument } from "../state/buttonDefaults";
import {
  buttonPlacementSizingMode,
  type ButtonPlacementSizingMode,
  type ButtonSizeAssignment
} from "./buttonSizeAssignments";

export interface ButtonSkinEditorProps {
  skin: ButtonSkin | null;
  skins: readonly ButtonSkin[];
  skinContextKey: string;
  busy: boolean;
  placement: ButtonPlacement | null;
  surfaceButtonCount: number;
  allSurfaceButtonsSameSize: boolean;
  buttonLabel: string;
  onButtonLabelChange: (label: string) => void;
  onAssignSize: (assignment: ButtonSizeAssignment) => void;
  onAssignSizeToPanel: (assignment: ButtonSizeAssignment) => void;
  onPlacementTextChange: (
    patch: Partial<Pick<ButtonPlacement, "textFitMode" | "textAlignment" | "minimumFontSize" | "textSizeOverride">>,
    coalesceKey?: string
  ) => void;
  onAssignSkin: (skin: ButtonSkin) => void;
  onAssignSkinToPanel: (skin: ButtonSkin) => void;
  onSaveSkin: (skin: ButtonSkin) => void;
  onSaveAsNewSkin: (skin: ButtonSkin) => void;
}

const TEXT_FIT_OPTIONS: Array<{ value: ButtonTextFitMode; label: string }> = [
  { value: "shrink", label: "Shrink" },
  { value: "stack-whole-words", label: "Stack Whole Words" },
  { value: "shrink-and-stack", label: "Shrink and Stack" }
];

const TEXT_ALIGNMENT_OPTIONS: Array<{ value: ButtonTextAlignment; label: string }> = [
  { value: "skin", label: "Use skin" },
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" }
];

function sizeAssignmentFromPlacement(placement: ButtonPlacement): ButtonSizeAssignment & {
  placementId: string;
} {
  return {
    placementId: placement.id,
    width: placement.width,
    height: placement.height,
    sizingMode: buttonPlacementSizingMode(placement)
  };
}

function skinSections(skin: ButtonSkin): ButtonSkinSectionSource {
  return Object.fromEntries(
    BUTTON_SKIN_SECTION_ORDER.map((section) => [section, skin[section]])
  ) as unknown as ButtonSkinSectionSource;
}

function withSections(skin: ButtonSkin, sections: ButtonSkinSectionSource): ButtonSkin {
  const next = { ...skin, ...sections };
  const compiled = compileButtonSkin(next);
  next.compileCache = compiled.ok
    ? {
        compilerVersion: BUTTON_SKIN_COMPILER_VERSION,
        sourceFingerprint: compiled.compiled.sourceFingerprint
      }
    : skin.compileCache;
  return next;
}

function sectionLabel(section: ButtonSkinSectionName): string {
  return section.replace(/(^|-)([a-z])/g, (_, separator: string, letter: string) => `${separator ? " " : ""}${letter.toUpperCase()}`);
}

export function ButtonSkinEditor({
  skin,
  skins,
  skinContextKey,
  busy,
  placement,
  surfaceButtonCount,
  allSurfaceButtonsSameSize,
  buttonLabel,
  onButtonLabelChange,
  onAssignSize,
  onAssignSizeToPanel,
  onPlacementTextChange,
  onAssignSkin,
  onAssignSkinToPanel,
  onSaveSkin,
  onSaveAsNewSkin
}: ButtonSkinEditorProps) {
  const [workingSkin, setWorkingSkin] = useState<ButtonSkin | null>(
    () => skin ? cloneButtonDocument(skin) : null
  );
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [updatedSections, setUpdatedSections] = useState<Set<ButtonSkinSectionName>>(new Set());
  const [benchMeasurement, setBenchMeasurement] = useState<ButtonCoreMeasurement | null>(null);
  const [benchNaturalMeasurement, setBenchNaturalMeasurement] = useState<ButtonCoreMeasurement | null>(null);
  const [benchTextOverflow, setBenchTextOverflow] = useState(false);
  const [workingSize, setWorkingSize] = useState<ReturnType<typeof sizeAssignmentFromPlacement> | null>(
    () => placement ? sizeAssignmentFromPlacement(placement) : null
  );
  const compileResult = useMemo(
    () => workingSkin ? compileButtonSkin(workingSkin) : null,
    [workingSkin]
  );
  const diagnosticGroups = useMemo(
    () => compileResult && !compileResult.ok ? diagnosticsBySkinSection(compileResult.diagnostics) : {},
    [compileResult]
  );
  const skinActionsDisabled = busy || !compileResult?.ok;

  useEffect(() => {
    setWorkingSkin(skin ? cloneButtonDocument(skin) : null);
  }, [skinContextKey, skin?.id]);

  useEffect(() => {
    setPaste("");
    setPasteError(null);
    setUpdatedSections(new Set());
  }, [workingSkin?.id]);

  useEffect(() => {
    setWorkingSize(placement ? sizeAssignmentFromPlacement(placement) : null);
  }, [
    placement?.id,
    placement?.width,
    placement?.height,
    placement?.matchHitboxToSkin,
    placement?.allowStretching
  ]);

  if (!skin || !workingSkin || !placement) {
    return (
      <aside className="button-skin-editor">
        <h2>Skin Editor</h2>
        <p>Select a Button placement.</p>
      </aside>
    );
  }

  const activeSize = workingSize?.placementId === placement.id
    ? workingSize
    : sizeAssignmentFromPlacement(placement);
  const sizingMode = activeSize.sizingMode;
  const sizeActionsDisabled = busy || allSurfaceButtonsSameSize;

  const updateWorkingDimension = (axis: "width" | "height", requestedValue: number) => {
    if (!Number.isFinite(requestedValue) || requestedValue <= 0) return;
    setWorkingSize((current) => {
      const base = current?.placementId === placement.id
        ? current
        : sizeAssignmentFromPlacement(placement);
      const value = Math.max(1, requestedValue);
      const ratio = Math.max(
        0.0001,
        benchNaturalMeasurement
          ? benchNaturalMeasurement.width / benchNaturalMeasurement.height
          : base.width / base.height
      );
      if (axis === "width") {
        return {
          ...base,
          width: value,
          height: base.sizingMode === "proportional" ? Math.max(1, value / ratio) : base.height
        };
      }
      return {
        ...base,
        width: base.sizingMode === "proportional" ? Math.max(1, value * ratio) : base.width,
        height: value
      };
    });
  };

  const applyPaste = (source = paste) => {
    const parsed = parseButtonSkinPaste(source);
    if (!parsed.ok) {
      setPasteError(parsed.message);
      return;
    }
    try {
      const sections = applyNamedButtonSkinSections(skinSections(workingSkin), parsed);
      const next = withSections(workingSkin, sections);
      setWorkingSkin(next);
      setPaste("");
      setUpdatedSections(new Set(parsed.presentSections));
      const compiled = compileButtonSkin(next);
      setPasteError(compiled.ok
        ? null
        : `Sections applied, but the skin does not compile yet:\n${compiled.diagnostics
            .slice(0, 3)
            .map((diagnostic) => `${diagnostic.section}: ${diagnostic.message}`)
            .join("\n")}`);
    } catch (error) {
      setPasteError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <aside className="button-skin-editor">
      <h2>Skin Editor</h2>
      <div className="button-skin-editor__toolbar">
        <button
          type="button"
          disabled={skinActionsDisabled}
          onClick={() => onAssignSkin(cloneButtonDocument(workingSkin))}
        >
          Assign Skin
        </button>
        <button
          type="button"
          disabled={skinActionsDisabled}
          onClick={() => onAssignSkinToPanel(cloneButtonDocument(workingSkin))}
        >
          Assign Skin to Panel
        </button>
        <label>
          <span>Load skin</span>
          <select
            value={workingSkin.id}
            onChange={(event) => {
              const loaded = skins.find((option) => option.id === event.currentTarget.value);
              if (loaded) setWorkingSkin(cloneButtonDocument(loaded));
            }}
          >
            {skins.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
        <button
          type="button"
          disabled={skinActionsDisabled}
          onClick={() => onSaveSkin(cloneButtonDocument(workingSkin))}
        >
          Save skin
        </button>
        <button
          type="button"
          disabled={skinActionsDisabled}
          onClick={() => onSaveAsNewSkin(cloneButtonDocument(workingSkin))}
        >
          Save as new skin
        </button>
      </div>
      <details className="button-skin-section button-skin-size-section" open>
        <summary>
          <span>Button Size</span>
          <small>
            {allSurfaceButtonsSameSize ? "Legacy size link active" : "Working preview"}
          </small>
        </summary>
        <p>
          Responsive forces an exact core box without stretching the visual; how well
          the inner artwork reflows depends on the skin. Proportional scales the whole
          skin uniformly. Stretch scales each axis separately and can distort text,
          corners, and effects.
        </p>
        <label>
          <span>Sizing behavior</span>
          <select
            value={sizingMode}
            disabled={busy}
            onChange={(event) => {
              const nextMode = event.currentTarget.value as ButtonPlacementSizingMode;
              setWorkingSize((current) => {
                const base = current?.placementId === placement.id
                  ? current
                  : sizeAssignmentFromPlacement(placement);
                const naturalRatio = benchNaturalMeasurement && benchNaturalMeasurement.height > 0
                  ? benchNaturalMeasurement.width / benchNaturalMeasurement.height
                  : null;
                return {
                  ...base,
                  height: nextMode === "proportional" && naturalRatio
                    ? Math.max(1, base.width / naturalRatio)
                    : base.height,
                  sizingMode: nextMode
                };
              });
            }}
          >
            <option value="responsive">Responsive - independent box</option>
            <option value="proportional">Proportional scale</option>
            <option value="stretch">Stretch entire skin</option>
          </select>
        </label>
        <div className="button-skin-size-grid">
          <label>
            <span>Width</span>
            <input
              type="number"
              min={1}
              step={1}
              value={activeSize.width}
              disabled={busy}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isFinite(value) && value > 0) updateWorkingDimension("width", value);
              }}
            />
          </label>
          <label>
            <span>Height</span>
            <input
              type="number"
              min={1}
              step={1}
              value={activeSize.height}
              disabled={busy}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isFinite(value) && value > 0) updateWorkingDimension("height", value);
              }}
            />
          </label>
        </div>
        <div className="button-skin-size-actions">
          <button
            type="button"
            disabled={sizeActionsDisabled}
            onClick={() => onAssignSize(activeSize)}
          >
            Assign Size
          </button>
          <button
            type="button"
            disabled={sizeActionsDisabled || surfaceButtonCount === 0}
            onClick={() => onAssignSizeToPanel(activeSize)}
          >
            Assign Size to Panel
          </button>
        </div>
        <p>
          {allSurfaceButtonsSameSize
            ? "The separate Same size Buttons format is active. Turn it off before using either Assign Size action."
            : "Assign Size changes only this Button. Assign Size to Panel applies the target box and sizing behavior once to every Button next to it on the current placement surface, whether that is Main, Pop, Fan, or another Button surface. Proportional preserves each Button's own aspect inside that box. Assigned sizes turn off automatic label-driven resizing. Neither action enables Same size Buttons or changes the shared skin source."}
        </p>
        <p>
          This preview uses the current working skin. If that skin has unsaved or
          unassigned edits, assign the skin separately before judging the live Button.
        </p>
      </details>
      <label className="button-skin-paste">
        <span>Paste Skin</span>
        <textarea
          value={paste}
          rows={9}
          onChange={(event) => {
            const source = event.currentTarget.value;
            setPaste(source);
            if (/^\s*===\s*[a-z-]+\s*===/i.test(source)) applyPaste(source);
          }}
          onPaste={(event) => {
            const source = event.clipboardData.getData("text");
            if (!source) return;
            event.preventDefault();
            setPaste(source);
            applyPaste(source);
          }}
          onKeyDown={(event) => {
            if (event.ctrlKey && event.key === "Enter") {
              event.preventDefault();
              applyPaste();
            }
          }}
        />
      </label>
      {pasteError && <p className="button-editor-error">{pasteError}</p>}
      <div className="button-skin-working-preview" aria-label="Working skin preview">
        <ButtonSkinRenderer
          skin={workingSkin}
          label={buttonLabel}
          width={activeSize.width}
          height={activeSize.height}
          constrained
          matchHitboxToSkin={sizingMode !== "responsive"}
          allowStretching={sizingMode === "stretch"}
          textFitMode={placement.textFitMode}
          textAlignment={placement.textAlignment}
          minimumFontSize={placement.minimumFontSize}
          textSizeOverride={placement.textSizeOverride ?? undefined}
        />
      </div>
      {BUTTON_SKIN_SECTION_ORDER.map((section) => {
        const diagnostics = diagnosticGroups[section] ?? [];
        const status = diagnostics.length > 0
          ? "Invalid"
          : updatedSections.has(section)
            ? "Updated"
            : workingSkin[section].length === 0
              ? "Empty"
              : "";
        return (
          <details key={section} className="button-skin-section">
            <summary><span>{sectionLabel(section)}</span><small className={status.toLowerCase()}>{status}</small></summary>
            <textarea
              value={workingSkin[section]}
              rows={section === "structure" || section === "keyframes" ? 10 : 5}
              onChange={(event) => {
                const next = withSections(workingSkin, {
                  ...skinSections(workingSkin),
                  [section]: event.currentTarget.value
                });
                setWorkingSkin(next);
              }}
            />
            {section === "base" ? (
              <p>
                Ordinary declarations style the core. To style a nested face, icon, or frame,
                set the custom properties that its Structure markup consumes.
              </p>
            ) : null}
            {diagnostics.map((diagnostic, index) => <p key={index} className="button-editor-error">{diagnostic.message}</p>)}
          </details>
        );
      })}
      <details className="button-skin-section">
        <summary><span>Button Text</span></summary>
        <p>
          The Button label updates every live placement. Text size and fitting apply
          only to this placement and are independent from the working Button size and
          skin source.
        </p>
        <label><span>Button label</span><input value={buttonLabel} disabled={busy} onChange={(event) => onButtonLabelChange(event.currentTarget.value)} /></label>
        <label>
          <span>Fit mode</span>
          <select
            value={placement.textFitMode}
            disabled={busy}
            onChange={(event) => onPlacementTextChange(
              { textFitMode: event.currentTarget.value as ButtonTextFitMode },
              `text-fit:${placement.id}`
            )}
          >
            {TEXT_FIT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Text alignment</span>
          <select
            value={placement.textAlignment}
            disabled={busy}
            onChange={(event) => onPlacementTextChange(
              { textAlignment: event.currentTarget.value as ButtonTextAlignment },
              `text-alignment:${placement.id}`
            )}
          >
            {TEXT_ALIGNMENT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Starting text size</span>
          <input
            type="number"
            min={1}
            value={placement.textSizeOverride ?? ""}
            placeholder="Skin default"
            disabled={busy}
            onChange={(event) => {
              const value = event.currentTarget.value;
              const parsed = Number(value);
              if (value !== "" && (!Number.isFinite(parsed) || parsed <= 0)) return;
              onPlacementTextChange(
                { textSizeOverride: value === "" ? null : Math.max(1, parsed) },
                `font-size:${placement.id}`
              );
            }}
          />
        </label>
        <label>
          <span>Minimum size when shrinking</span>
          <input
            type="number"
            min={1}
            value={placement.minimumFontSize}
            disabled={busy}
            onChange={(event) => {
              const value = event.currentTarget.valueAsNumber;
              if (!Number.isFinite(value) || value <= 0) return;
              onPlacementTextChange(
                { minimumFontSize: Math.max(1, value) },
                `minimum-font-size:${placement.id}`
              );
            }}
          />
        </label>
        {sizingMode !== "responsive" ? (
          <p>
            Proportional and Stretch transform the complete skin, including its text.
            Choose Responsive when the final text size must stay independent.
          </p>
        ) : null}
        <div className="button-text-bench-preview">
          <ButtonSkinRenderer
            skin={workingSkin}
            label={buttonLabel}
            width={activeSize.width}
            height={activeSize.height}
            constrained
            matchHitboxToSkin={sizingMode !== "responsive"}
            allowStretching={sizingMode === "stretch"}
            textFitMode={placement.textFitMode}
            textAlignment={placement.textAlignment}
            minimumFontSize={placement.minimumFontSize}
            textSizeOverride={placement.textSizeOverride ?? undefined}
            onMeasurement={setBenchMeasurement}
            onNaturalMeasurement={setBenchNaturalMeasurement}
            onTextOverflowChange={setBenchTextOverflow}
          />
        </div>
        <p>Core: {benchMeasurement ? `${benchMeasurement.width.toFixed(1)} x ${benchMeasurement.height.toFixed(1)}` : "measuring"}</p>
        {benchTextOverflow ? <p className="button-editor-error">The current text does not fit inside this Button size.</p> : null}
        {benchMeasurement && <p>Overflow: T {benchMeasurement.visualOverflow.top.toFixed(1)}, R {benchMeasurement.visualOverflow.right.toFixed(1)}, B {benchMeasurement.visualOverflow.bottom.toFixed(1)}, L {benchMeasurement.visualOverflow.left.toFixed(1)}</p>}
      </details>
    </aside>
  );
}
