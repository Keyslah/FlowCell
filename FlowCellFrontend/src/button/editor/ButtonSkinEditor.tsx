import { useEffect, useMemo, useState } from "react";
import {
  BUTTON_SKIN_COMPILER_VERSION,
  type ButtonCycleAdvanceTrigger,
  type ButtonAppearanceTrigger,
  type ButtonCoreMeasurement,
  type ButtonPlacement,
  type ButtonPlacementActivationCycle,
  BUTTON_PLACEMENT_CYCLE_MAX_STATES,
  type ButtonSkin,
  type ButtonSkinSectionName,
  type ButtonSkinVisualState,
  type ButtonTextAlignment,
  type ButtonTextFitMode
} from "../types";
import {
  BUTTON_SKIN_SECTION_ORDER,
  BUTTON_SKIN_STATE_SECTIONS,
  type ButtonSkinSectionSource
} from "../skins/buttonSkinFormat";
import {
  applyNamedButtonSkinSections,
  parseButtonSkinPaste
} from "../skins/skinPasteParser";
import { compileButtonSkin, diagnosticsBySkinSection } from "../skins/skinCompiler";
import { ButtonSkinRenderer } from "../skins/ButtonSkinRenderer";
import { cloneButtonDocument, createStableButtonId } from "../state/buttonDefaults";
import {
  BUTTON_APPEARANCE_TRIGGERS,
  BUTTON_SKIN_VISUAL_STATES,
  buttonAppearanceTriggerToVisualState
} from "../runtime/buttonActivationState";
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
  activationCycle: ButtonPlacementActivationCycle | null;
  stateStructureApplied: boolean;
  onButtonLabelChange: (label: string) => void;
  onActivationCycleChange: (cycle: ButtonPlacementActivationCycle) => void;
  onHighlightOnHoverChange: (enabled: boolean) => void;
  onApplyAllButtonText: () => void;
  onAssignSize: (assignment: ButtonSizeAssignment) => void;
  onAssignSizeToPanel: (assignment: ButtonSizeAssignment) => void;
  onPlacementTextChange: (
    patch: Partial<Pick<
      ButtonPlacement,
      | "textFitMode"
      | "textAlignment"
      | "minimumFontSize"
      | "textSizeOverride"
      | "textOffsetX"
      | "textOffsetY"
    >>,
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

const ADVANCE_TRIGGER_LABELS: Record<ButtonCycleAdvanceTrigger, string> = {
  press: "Press",
  hover: "Hover",
  release: "Release"
};

const ADVANCE_TRIGGERS = Object.keys(ADVANCE_TRIGGER_LABELS) as ButtonCycleAdvanceTrigger[];

const APPEARANCE_TRIGGER_LABELS: Record<ButtonAppearanceTrigger, string> = {
  rest: "Resting",
  hover: "Hovered",
  play: "Playing",
  pressed: "Pressed",
  held: "Held",
  release: "Released",
  selected: "Selected",
  disabled: "Disabled",
  error: "Error"
};

const VISUAL_STATE_LABELS: Record<ButtonSkinVisualState, string> = {
  base: "Base",
  hover: "Hover",
  play: "Play",
  pressed: "Pressed",
  held: "Held",
  release: "Release",
  disabled: "Disabled",
  error: "Error"
};

function visualFlagsForState(visualState: ButtonSkinVisualState) {
  return {
    hovered: visualState === "hover",
    pressed: visualState === "pressed",
    held: visualState === "held",
    play: visualState === "play",
    release: visualState === "release",
    disabled: visualState === "disabled",
    error: visualState === "error"
  };
}

function collectResultMatchLeaves(value: unknown): string[] {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) return value.flatMap(collectResultMatchLeaves);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(collectResultMatchLeaves);
  }
  return [];
}

function summarizeResultMatches(
  state: ButtonPlacementActivationCycle["states"][number]
): { label: string; title: string } | null {
  const matches = state.resultMatches ?? [];
  if (matches.length === 0) return null;
  const leafSets = matches.map((match) => new Set(collectResultMatchLeaves(match)));
  const sharedLeaves = [...leafSets[0]].filter((leaf) => (
    leafSets.every((candidate) => candidate.has(leaf))
  ));
  return {
    label: sharedLeaves.length > 0 ? sharedLeaves.join(" / ") : `${matches.length} matches`,
    title: `Action response mappings: ${matches.map((match) => JSON.stringify(match)).join(" or ")}`
  };
}

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
  activationCycle,
  stateStructureApplied,
  onButtonLabelChange,
  onActivationCycleChange,
  onHighlightOnHoverChange,
  onApplyAllButtonText,
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
  const [selectedActivationStateId, setSelectedActivationStateId] = useState("");
  const [cycleStateCountInput, setCycleStateCountInput] = useState(
    () => activationCycle ? String(activationCycle.states.length) : ""
  );
  const [behaviorPreviewHovered, setBehaviorPreviewHovered] = useState(false);
  const [previewAppearanceTrigger, setPreviewAppearanceTrigger] = useState<ButtonAppearanceTrigger>("rest");
  const [previewVisualStateOverride, setPreviewVisualStateOverride] = useState<ButtonSkinVisualState | null>(null);
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
  const configuredStates = activationCycle?.states ?? [];
  const stateTextBlocked = !stateStructureApplied;
  const selectedState = configuredStates.find((state) => state.id === selectedActivationStateId) ?? configuredStates[0];
  const stateDisplayName = (state: ButtonPlacementActivationCycle["states"][number], index: number) =>
    `State ${index + 1}: ${state.label}`;
  const selectedConfiguredStateIndex = Math.max(
    0,
    configuredStates.findIndex((state) => state.id === selectedState?.id)
  );
  const selectedVisualState = selectedState?.visualState ?? "base";
  const selectedVisualFlags = visualFlagsForState(selectedVisualState);
  const previewLabel = selectedState?.label ?? buttonLabel;
  const previewVisualState = previewVisualStateOverride ?? (
    previewAppearanceTrigger === "rest"
      ? selectedVisualState
      : buttonAppearanceTriggerToVisualState(previewAppearanceTrigger)
  );
  const previewVisualFlags = previewVisualStateOverride
    ? visualFlagsForState(previewVisualStateOverride)
    : visualFlagsForState(previewVisualState);

  useEffect(() => {
    setWorkingSkin(skin ? cloneButtonDocument(skin) : null);
  }, [skinContextKey, skin?.id]);

  useEffect(() => {
    setPaste("");
    setPasteError(null);
    setUpdatedSections(new Set());
  }, [workingSkin?.id]);

  useEffect(() => {
    if (!configuredStates.some((state) => state.id === selectedActivationStateId)) {
      setSelectedActivationStateId(configuredStates[0]?.id ?? "");
    }
  }, [configuredStates, selectedActivationStateId]);

  useEffect(() => {
    setCycleStateCountInput(activationCycle ? String(activationCycle.states.length) : "");
  }, [activationCycle?.states.length, placement?.id]);

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

  const resizeActivationCycle = (requestedCount: number) => {
    const count = Math.min(
      BUTTON_PLACEMENT_CYCLE_MAX_STATES,
      Math.max(2, Math.floor(requestedCount))
    );
    const next = cloneButtonDocument(activationCycle ?? { states: [] });
    while (next.states.length < count) {
      next.states.push({
        id: createStableButtonId("button-state"),
        label: buttonLabel,
        advanceTrigger: "press",
        visualState: "base"
      });
    }
    if (next.states.length > count) next.states.splice(count);
    onActivationCycleChange(next);
    setPreviewAppearanceTrigger("rest");
    setPreviewVisualStateOverride(null);
    setSelectedActivationStateId((current) => (
      next.states.some((state) => state.id === current)
        ? current
        : next.states[next.states.length - 1]?.id ?? ""
    ));
  };

  const commitCycleStateCount = (rawValue: string) => {
    if (!rawValue.trim()) {
      setCycleStateCountInput(activationCycle ? String(activationCycle.states.length) : "");
      return;
    }
    const parsed = Number(rawValue);
    const count = Number.isFinite(parsed)
      ? Math.min(BUTTON_PLACEMENT_CYCLE_MAX_STATES, Math.max(2, Math.floor(parsed)))
      : 2;
    setCycleStateCountInput(String(count));
    resizeActivationCycle(count);
  };

  const updateCycleState = (
    stateId: string,
    patch: Partial<Pick<
      ButtonPlacementActivationCycle["states"][number],
      "label" | "advanceTrigger" | "visualState"
    >>
  ) => {
    if (!activationCycle) return;
    const next = cloneButtonDocument(activationCycle);
    const state = next.states.find((candidate) => candidate.id === stateId);
    if (!state) return;
    Object.assign(state, patch);
    onActivationCycleChange(next);
    setSelectedActivationStateId(state.id);
  };

  const updateSelectedStateLabel = (label: string) => {
    if (!selectedState) return;
    updateCycleState(selectedState.id, { label });
  };

  const updateSelectedVisualState = (visualState: ButtonSkinVisualState) => {
    if (!selectedState) return;
    setPreviewAppearanceTrigger("rest");
    setPreviewVisualStateOverride(null);
    updateCycleState(selectedState.id, { visualState });
  };

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
          title="Assign the working skin to only the selected Button placement."
          disabled={skinActionsDisabled}
          onClick={() => onAssignSkin(cloneButtonDocument(workingSkin))}
        >
          Assign Skin
        </button>
        <button
          type="button"
          title="Assign the working skin to every Button on this panel surface."
          disabled={skinActionsDisabled}
          onClick={() => onAssignSkinToPanel(cloneButtonDocument(workingSkin))}
        >
          Assign Skin to Panel
        </button>
        <label title="Choose a saved skin to edit in this working copy.">
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
          title="Save changes to this skin."
          disabled={skinActionsDisabled}
          onClick={() => onSaveSkin(cloneButtonDocument(workingSkin))}
        >
          Save skin
        </button>
        <button
          type="button"
          title="Save this working skin under the name chosen in the file dialog."
          disabled={skinActionsDisabled}
          onClick={() => onSaveAsNewSkin(cloneButtonDocument(workingSkin))}
        >
          Save as new skin
        </button>
      </div>
      <details className="button-skin-section button-skin-size-section" open>
        <summary title="Set the selected Button's preview size and choose how its skin fits that box.">
          <span>Button Size</span>
          <small>
            {allSurfaceButtonsSameSize ? "Legacy size link active" : "Working preview"}
          </small>
        </summary>
        <label title="Responsive uses an exact box, Proportional scales uniformly, and Stretch scales each axis separately.">
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
          <label title="Set the working preview width in pixels.">
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
          <label title="Set the working preview height in pixels.">
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
            title={allSurfaceButtonsSameSize
              ? "Turn off Same size Buttons before assigning an individual size."
              : "Apply this size and sizing behavior to only the selected Button."}
            disabled={sizeActionsDisabled}
            onClick={() => onAssignSize(activeSize)}
          >
            Assign Size
          </button>
          <button
            type="button"
            title={allSurfaceButtonsSameSize
              ? "Turn off Same size Buttons before assigning panel sizes."
              : "Apply this target box and sizing behavior to every Button on this panel surface."}
            disabled={sizeActionsDisabled || surfaceButtonCount === 0}
            onClick={() => onAssignSizeToPanel(activeSize)}
          >
            Assign Size to Panel
          </button>
        </div>
      </details>
      <details className="button-skin-section button-behavior-section">
        <summary title="Set how this placement advances through states and which authored skin visual each state uses.">
          <span className="button-section-chevron" aria-hidden="true">&#9656;</span>
          <span>Button States &amp; Behavior</span>
          <small>
            {activationCycle
              ? activationCycle.states.length === 2
                ? "On / Off"
                : `${activationCycle.states.length} states`
              : "Not set up"}
          </small>
        </summary>
        <div className="button-cycle-count-row">
          <strong>Cycle</strong>
          <label title="Enter how many logical states this placement cycles through. Two states behave as On and Off.">
            <span>Number of states</span>
            <input
              data-button-cycle-state-count
              type="number"
              min={2}
              max={BUTTON_PLACEMENT_CYCLE_MAX_STATES}
              step={1}
              inputMode="numeric"
              value={cycleStateCountInput}
              placeholder="2"
              disabled={busy}
              onChange={(event) => {
                const rawValue = event.currentTarget.value;
                setCycleStateCountInput(rawValue);
                const parsed = Number(rawValue);
                if (
                  Number.isInteger(parsed) &&
                  parsed >= 2 &&
                  parsed <= BUTTON_PLACEMENT_CYCLE_MAX_STATES
                ) {
                  resizeActivationCycle(parsed);
                }
              }}
              onBlur={() => commitCycleStateCount(cycleStateCountInput)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
        </div>
        <label
          className="button-hover-highlight-toggle"
          title="Brighten only this placement by 15% while the pointer is actually over it. This does not change skin code."
        >
          <input
            type="checkbox"
            checked={placement.highlightOnHover}
            disabled={busy}
            onChange={(event) => onHighlightOnHoverChange(event.currentTarget.checked)}
          />
          <span>Highlight on hover</span>
        </label>
        {activationCycle?.states.length === 2 ? (
          <output className="button-cycle-toggle-note">2 states = On / Off toggle</output>
        ) : null}
        <div className="button-cycle-state-list">
          {configuredStates.map((state, index) => {
            const resultMatchSummary = summarizeResultMatches(state);
            return (
              <div key={state.id} className="button-cycle-state-row">
                <span className="button-cycle-state-name">
                  <strong>{stateDisplayName(state, index)}</strong>
                  <small>
                    {index === 0
                      ? `Initial - ${VISUAL_STATE_LABELS[state.visualState]}`
                      : VISUAL_STATE_LABELS[state.visualState]}
                  </small>
                  {resultMatchSummary ? (
                    <small className="button-cycle-state-sync" title={resultMatchSummary.title}>
                      Action: {resultMatchSummary.label}
                    </small>
                  ) : null}
                </span>
                <label title={`Choose what advances State ${index + 1} to the next state.`}>
                  <span>Advance on</span>
                  <select
                    value={state.advanceTrigger}
                    disabled={busy}
                    onChange={(event) => updateCycleState(state.id, {
                      advanceTrigger: event.currentTarget.value as ButtonCycleAdvanceTrigger
                    })}
                  >
                    {ADVANCE_TRIGGERS.map((trigger) => (
                      <option key={trigger} value={trigger}>{ADVANCE_TRIGGER_LABELS[trigger]}</option>
                    ))}
                  </select>
                </label>
              </div>
            );
          })}
        </div>
        <div className="button-behavior-state-grid">
          <label title="Choose which logical state to configure and preview.">
            <span>State</span>
            <select
              value={selectedState?.id ?? ""}
              disabled={busy || configuredStates.length === 0}
              onChange={(event) => {
                setPreviewAppearanceTrigger("rest");
                setPreviewVisualStateOverride(null);
                setSelectedActivationStateId(event.currentTarget.value);
              }}
            >
              {!activationCycle ? <option value="">Not set up</option> : null}
              {configuredStates.map((state, index) => (
                <option key={state.id} value={state.id}>{stateDisplayName(state, index)}</option>
              ))}
            </select>
          </label>
          <label title="Choose one visual state actually authored by the current working skin.">
            <span>Visual state</span>
            <select
              value={selectedVisualState}
              disabled={busy || !selectedState}
              onChange={(event) => updateSelectedVisualState(event.currentTarget.value as ButtonSkinVisualState)}
            >
              {BUTTON_SKIN_VISUAL_STATES.filter((visualState) => (
                visualState === "base" ||
                Boolean(workingSkin[visualState].trim()) ||
                visualState === selectedVisualState
              )).map((visualState) => {
                const unavailable = visualState !== "base" && !workingSkin[visualState].trim();
                return (
                  <option key={visualState} value={visualState} disabled={unavailable}>
                    {VISUAL_STATE_LABELS[visualState]}{unavailable ? " (unavailable in this skin)" : ""}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
        <output className="button-behavior-preview-caption" aria-live="polite">
          {selectedState
            ? `Previewing ${stateDisplayName(selectedState, selectedConfiguredStateIndex)} - ${VISUAL_STATE_LABELS[selectedVisualState]}`
            : "Choose a number of states to begin."}
        </output>
        <div
          className="button-behavior-preview"
          aria-label="Button state visual preview"
          title="Live preview of the selected logical state and authored skin visual."
          onPointerEnter={() => setBehaviorPreviewHovered(true)}
          onPointerLeave={() => setBehaviorPreviewHovered(false)}
          onPointerCancel={() => setBehaviorPreviewHovered(false)}
        >
          <ButtonSkinRenderer
            skin={workingSkin}
            label={previewLabel}
            width={activeSize.width}
            height={activeSize.height}
            constrained
            matchHitboxToSkin={sizingMode !== "responsive"}
            allowStretching={sizingMode === "stretch"}
            textFitMode={placement.textFitMode}
            textAlignment={placement.textAlignment}
            minimumFontSize={placement.minimumFontSize}
            textSizeOverride={placement.textSizeOverride ?? undefined}
            textOffsetX={placement.textOffsetX}
            textOffsetY={placement.textOffsetY}
            hovered={selectedVisualFlags.hovered}
            pressed={selectedVisualFlags.pressed}
            held={selectedVisualFlags.held}
            play={selectedVisualFlags.play}
            release={selectedVisualFlags.release}
            disabled={selectedVisualFlags.disabled}
            error={selectedVisualFlags.error}
            highlightOnHover={placement.highlightOnHover}
            rawHovered={behaviorPreviewHovered}
          />
        </div>
      </details>
      <label className="button-skin-paste" title="Paste named skin sections here. Recognized sections apply automatically.">
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
      <label className="button-skin-preview-state" title="Preview a Button interaction condition without changing its saved state.">
        <span>Preview condition</span>
        <select
          value={previewAppearanceTrigger}
          onChange={(event) => {
            setPreviewVisualStateOverride(null);
            setPreviewAppearanceTrigger(event.currentTarget.value as ButtonAppearanceTrigger);
          }}
        >
          {BUTTON_APPEARANCE_TRIGGERS.map((trigger) => (
            <option key={trigger} value={trigger}>{APPEARANCE_TRIGGER_LABELS[trigger]}</option>
          ))}
        </select>
      </label>
      <div
        className="button-skin-working-preview"
        aria-label="Working skin preview"
        title="Live preview of the current working skin, state, label, size, and text controls."
      >
        <ButtonSkinRenderer
          skin={workingSkin}
          label={previewLabel}
          width={activeSize.width}
          height={activeSize.height}
          constrained
          matchHitboxToSkin={sizingMode !== "responsive"}
          allowStretching={sizingMode === "stretch"}
          textFitMode={placement.textFitMode}
          textAlignment={placement.textAlignment}
          minimumFontSize={placement.minimumFontSize}
          textSizeOverride={placement.textSizeOverride ?? undefined}
          textOffsetX={placement.textOffsetX}
          textOffsetY={placement.textOffsetY}
          hovered={previewVisualFlags.hovered}
          pressed={previewVisualFlags.pressed}
          held={previewVisualFlags.held}
          play={previewVisualFlags.play}
          release={previewVisualFlags.release}
          disabled={previewVisualFlags.disabled}
          error={previewVisualFlags.error}
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
            <summary title={`Edit the ${sectionLabel(section)} skin section.`}>
              <span>{sectionLabel(section)}</span>
              <small className={status.toLowerCase()}>{status}</small>
            </summary>
            <textarea
              title={`Raw ${sectionLabel(section)} skin code.`}
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
            {BUTTON_SKIN_STATE_SECTIONS.includes(section as typeof BUTTON_SKIN_STATE_SECTIONS[number]) ? (
              <button
                type="button"
                className="button-skin-preview-section"
                title={`Show the ${sectionLabel(section)} visual in the working skin preview.`}
                onClick={() => {
                  const visualState = section as ButtonSkinVisualState;
                  setPreviewVisualStateOverride(visualState);
                  setPreviewAppearanceTrigger(
                    section === "base" ? "rest" : section as ButtonAppearanceTrigger
                  );
                }}
              >
                Preview this visual state
              </button>
            ) : null}
            {diagnostics.map((diagnostic, index) => <p key={index} className="button-editor-error">{diagnostic.message}</p>)}
          </details>
        );
      })}
      <details className="button-skin-section">
        <summary title="Edit and preview Button Text only. Cycle states and visuals save with the placement.">
          <span>Button Text</span>
          <small>Text only</small>
        </summary>
        {activationCycle ? (
          <div className="button-behavior-state-grid">
            <label title="Choose which cycle state's label to edit and preview.">
              <span>State</span>
              <select
                value={selectedState?.id ?? ""}
                disabled={busy || configuredStates.length === 0}
                onChange={(event) => {
                  setPreviewAppearanceTrigger("rest");
                  setPreviewVisualStateOverride(null);
                  setSelectedActivationStateId(event.currentTarget.value);
                }}
              >
                {configuredStates.map((state, index) => (
                  <option key={state.id} value={state.id}>{stateDisplayName(state, index)}</option>
                ))}
              </select>
            </label>
            <label title="Set the label displayed while this cycle state is active.">
              <span>State label</span>
              <input
                value={selectedState?.label ?? ""}
                placeholder={buttonLabel}
                disabled={busy || !selectedState}
                onChange={(event) => updateSelectedStateLabel(event.currentTarget.value)}
              />
            </label>
          </div>
        ) : (
          <label title="Set the Button's default label.">
            <span>Button label</span>
            <input value={buttonLabel} disabled={busy} onChange={(event) => onButtonLabelChange(event.currentTarget.value)} />
          </label>
        )}
        <label title="Choose how the label is reduced or wrapped when it exceeds the Button box.">
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
        <label title="Choose horizontal label alignment inside the skin's label area.">
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
        <label title="Override the skin's starting label size for this placement, or leave it empty to use the skin default.">
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
        <label title="Set the smallest font size the fitting logic may use.">
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
        <div className="button-text-offset-grid">
          <label title="Move the rendered label left or right in pixels without changing the skin source.">
            <span>Move text X</span>
            <input
              type="number"
              step={1}
              value={placement.textOffsetX}
              disabled={busy}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (!Number.isFinite(value)) return;
                onPlacementTextChange(
                  { textOffsetX: value },
                  `text-offset-x:${placement.id}`
                );
              }}
            />
          </label>
          <label title="Move the rendered label up or down in pixels without changing the skin source.">
            <span>Move text Y</span>
            <input
              type="number"
              step={1}
              value={placement.textOffsetY}
              disabled={busy}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (!Number.isFinite(value)) return;
                onPlacementTextChange(
                  { textOffsetY: value },
                  `text-offset-y:${placement.id}`
                );
              }}
            />
          </label>
        </div>
        <div
          className="button-text-bench-preview"
          title="Live preview of every Button Text change, including the selected cycle state when configured."
        >
          <ButtonSkinRenderer
            skin={workingSkin}
            label={previewLabel}
            width={activeSize.width}
            height={activeSize.height}
            constrained
            matchHitboxToSkin={sizingMode !== "responsive"}
            allowStretching={sizingMode === "stretch"}
            textFitMode={placement.textFitMode}
            textAlignment={placement.textAlignment}
            minimumFontSize={placement.minimumFontSize}
            textSizeOverride={placement.textSizeOverride ?? undefined}
            textOffsetX={placement.textOffsetX}
            textOffsetY={placement.textOffsetY}
            hovered={selectedVisualFlags.hovered}
            pressed={selectedVisualFlags.pressed}
            held={selectedVisualFlags.held}
            play={selectedVisualFlags.play}
            release={selectedVisualFlags.release}
            disabled={selectedVisualFlags.disabled}
            error={selectedVisualFlags.error}
            onMeasurement={setBenchMeasurement}
            onNaturalMeasurement={setBenchNaturalMeasurement}
            onTextOverflowChange={setBenchTextOverflow}
          />
        </div>
        <div className="button-text-bench-stats" aria-live="polite">
          <output title="Measured skin core size.">
            Core: {benchMeasurement ? `${benchMeasurement.width.toFixed(1)} x ${benchMeasurement.height.toFixed(1)}` : "measuring"}
          </output>
          {benchMeasurement ? (
            <output title="Visual overflow beyond the core box: top, right, bottom, and left.">
              Overflow: T {benchMeasurement.visualOverflow.top.toFixed(1)}, R {benchMeasurement.visualOverflow.right.toFixed(1)}, B {benchMeasurement.visualOverflow.bottom.toFixed(1)}, L {benchMeasurement.visualOverflow.left.toFixed(1)}
            </output>
          ) : null}
        </div>
        {benchTextOverflow ? <p className="button-editor-error">The current text does not fit inside this Button size.</p> : null}
        <button
          type="button"
          className="button-text-apply-all"
          title={stateTextBlocked
            ? "Save placement first because the cycle state structure changed. Button Text stays in preview until then."
            : "Apply every pending Button Text change across the editor: base or cycle labels plus each placement's fit, alignment, size, and X/Y position."}
          disabled={busy || stateTextBlocked}
          onClick={onApplyAllButtonText}
        >
          Apply All
        </button>
      </details>
    </aside>
  );
}
