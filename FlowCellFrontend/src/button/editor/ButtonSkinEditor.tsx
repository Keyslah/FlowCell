import { useEffect, useMemo, useState } from "react";
import {
  BUTTON_SKIN_COMPILER_VERSION,
  type ButtonActivationBehavior,
  type ButtonActivationMode,
  type ButtonAppearanceTrigger,
  type ButtonCoreMeasurement,
  type ButtonPlacement,
  type ButtonSkin,
  type ButtonSkinSectionName,
  type ButtonSkinVisualState,
  type ButtonTextAlignment,
  type ButtonTextFitMode,
  type ButtonVisualStateMap
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
  BUTTON_ACTIVATION_MODES,
  BUTTON_APPEARANCE_TRIGGERS,
  BUTTON_SKIN_VISUAL_STATES,
  buttonAppearanceTriggerToVisualState,
  createDefaultButtonActivationBehavior,
  getButtonActivationStateCount,
  resolveButtonAppearance
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
  activationBehavior: ButtonActivationBehavior | null;
  visualStateMap: ButtonVisualStateMap | null;
  onButtonLabelChange: (label: string) => void;
  onActivationBehaviorChange: (
    behavior: ButtonActivationBehavior,
    removedStateIds?: readonly string[]
  ) => void;
  onVisualStateMapChange: (visualStateMap: ButtonVisualStateMap) => void;
  onApplyButtonStateSetup: () => void;
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

const ACTIVATION_MODE_LABELS: Record<ButtonActivationMode, string> = {
  momentary: "Momentary",
  toggle: "Toggle",
  cycle: "Cycle"
};

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

const DISPLAY_ONLY_STATE_ID = "button-state-preview-default";

function displayActivationBehavior(
  behavior: ButtonActivationBehavior | null,
  buttonLabel: string
): ButtonActivationBehavior {
  return behavior ?? {
    mode: "momentary",
    states: [{ id: DISPLAY_ONLY_STATE_ID, label: buttonLabel, labelOverrides: {} }]
  };
}

function materializeActivationBehavior(
  behavior: ButtonActivationBehavior | null,
  buttonLabel: string
): ButtonActivationBehavior {
  return behavior
    ? cloneButtonDocument(behavior)
    : createDefaultButtonActivationBehavior(
        "momentary",
        buttonLabel,
        () => createStableButtonId("button-state")
      );
}

function appearanceForTrigger(trigger: ButtonAppearanceTrigger) {
  return {
    hovered: trigger === "hover",
    pressed: trigger === "pressed",
    held: trigger === "held",
    play: trigger === "play",
    release: trigger === "release",
    selected: trigger === "selected",
    disabled: trigger === "disabled",
    error: trigger === "error"
  };
}

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
  activationBehavior,
  visualStateMap,
  onButtonLabelChange,
  onActivationBehaviorChange,
  onVisualStateMapChange,
  onApplyButtonStateSetup,
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
  const [selectedAppearanceTrigger, setSelectedAppearanceTrigger] = useState<ButtonAppearanceTrigger>("rest");
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
  const shownBehavior = displayActivationBehavior(activationBehavior, buttonLabel);
  const activeStateCount = getButtonActivationStateCount(shownBehavior);
  const shownStates = shownBehavior.states.slice(0, activeStateCount);
  const selectedState = shownStates.find((state) => state.id === selectedActivationStateId) ?? shownStates[0];
  const selectedStateIndex = Math.max(0, shownStates.findIndex((state) => state.id === selectedState?.id));
  const selectedVisualState = selectedState
    ? visualStateMap?.[selectedState.id]?.[selectedAppearanceTrigger] ??
      buttonAppearanceTriggerToVisualState(selectedAppearanceTrigger)
    : "base";
  const availableVisualStates = BUTTON_SKIN_VISUAL_STATES;
  const previewAppearance = resolveButtonAppearance({
    buttonLabel,
    activationBehavior: shownBehavior,
    activeStateIndex: selectedStateIndex,
    visualStateMap,
    appearance: appearanceForTrigger(previewAppearanceTrigger)
  });
  const previewVisualFlags = previewVisualStateOverride
    ? visualFlagsForState(previewVisualStateOverride)
    : previewAppearance.flags;

  useEffect(() => {
    setWorkingSkin(skin ? cloneButtonDocument(skin) : null);
  }, [skinContextKey, skin?.id]);

  useEffect(() => {
    setPaste("");
    setPasteError(null);
    setUpdatedSections(new Set());
  }, [workingSkin?.id]);

  useEffect(() => {
    const behavior = displayActivationBehavior(activationBehavior, buttonLabel);
    const count = getButtonActivationStateCount(behavior);
    const visibleStates = behavior.states.slice(0, count);
    if (!visibleStates.some((state) => state.id === selectedActivationStateId)) {
      setSelectedActivationStateId(visibleStates[0]?.id ?? "");
    }
  }, [activationBehavior, buttonLabel, selectedActivationStateId]);

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

  const setActivationMode = (mode: ButtonActivationMode) => {
    setPreviewVisualStateOverride(null);
    const next = materializeActivationBehavior(activationBehavior, buttonLabel);
    next.mode = mode;
    const minimumStates = mode === "momentary" ? 1 : 2;
    while (next.states.length < minimumStates) {
      next.states.push({
        id: createStableButtonId("button-state"),
        label: buttonLabel,
        labelOverrides: {}
      });
    }
    onActivationBehaviorChange(next);
    setSelectedActivationStateId(next.states[Math.min(selectedStateIndex, minimumStates - 1)]?.id ?? "");
  };

  const updateSelectedStateLabel = (trigger: ButtonAppearanceTrigger, label: string) => {
    const next = materializeActivationBehavior(activationBehavior, buttonLabel);
    const state = next.states[selectedStateIndex] ?? next.states[0];
    if (!state) return;
    if (trigger === "rest") {
      state.label = label;
    } else if (label) {
      state.labelOverrides[trigger] = label;
    } else {
      delete state.labelOverrides[trigger];
    }
    onActivationBehaviorChange(next);
    setSelectedActivationStateId(state.id);
  };

  const addCycleState = () => {
    setPreviewVisualStateOverride(null);
    const next = materializeActivationBehavior(activationBehavior, buttonLabel);
    next.mode = "cycle";
    const state = {
      id: createStableButtonId("button-state"),
      label: buttonLabel,
      labelOverrides: {}
    };
    next.states.push(state);
    onActivationBehaviorChange(next);
    setSelectedActivationStateId(state.id);
  };

  const removeSelectedCycleState = () => {
    if (shownBehavior.mode !== "cycle" || shownBehavior.states.length <= 2 || !selectedState) return;
    setPreviewVisualStateOverride(null);
    const next = materializeActivationBehavior(activationBehavior, buttonLabel);
    const removalIndex = next.states.findIndex((state) => state.id === selectedState.id);
    if (removalIndex < 0) return;
    const [removed] = next.states.splice(removalIndex, 1);
    onActivationBehaviorChange(next, [removed.id]);
    setSelectedActivationStateId(next.states[Math.min(removalIndex, next.states.length - 1)]?.id ?? "");
  };

  const updateSelectedVisualState = (visualState: ButtonSkinVisualState) => {
    setPreviewVisualStateOverride(null);
    const nextBehavior = materializeActivationBehavior(activationBehavior, buttonLabel);
    const state = nextBehavior.states[selectedStateIndex] ?? nextBehavior.states[0];
    if (!state) return;
    if (!activationBehavior) onActivationBehaviorChange(nextBehavior);
    const nextMap = cloneButtonDocument(visualStateMap ?? {});
    nextMap[state.id] = {
      ...(nextMap[state.id] ?? {}),
      [selectedAppearanceTrigger]: visualState
    };
    onVisualStateMapChange(nextMap);
    setSelectedActivationStateId(state.id);
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
        <summary title="Choose how presses advance logical states and map each condition to a skin visual.">
          <span>Button Behavior</span>
          <small>{ACTIVATION_MODE_LABELS[shownBehavior.mode]}</small>
        </summary>
        <label title="Momentary returns after release, Toggle alternates states, and Cycle advances through every state.">
          <span>Activation behavior</span>
          <select
            value={shownBehavior.mode}
            disabled={busy}
            onChange={(event) => setActivationMode(event.currentTarget.value as ButtonActivationMode)}
          >
            {BUTTON_ACTIVATION_MODES.map((mode) => (
              <option key={mode} value={mode}>{ACTIVATION_MODE_LABELS[mode]}</option>
            ))}
          </select>
        </label>
        <label title="Choose the logical state whose behavior and visual mapping you want to edit.">
          <span>Button state</span>
          <select
            value={selectedState?.id ?? ""}
            disabled={busy || shownStates.length === 0}
            onChange={(event) => {
              setPreviewVisualStateOverride(null);
              setSelectedActivationStateId(event.currentTarget.value);
            }}
          >
            {shownStates.map((state, index) => (
              <option key={state.id} value={state.id}>
                {`State ${index + 1}: ${state.label || "(no label)"}`}
              </option>
            ))}
          </select>
        </label>
        <div className="button-state-list-actions">
          <button
            type="button"
            title="Add a logical state and switch this Button to Cycle behavior."
            disabled={busy}
            onClick={addCycleState}
          >
            Add state
          </button>
          <button
            type="button"
            title="Remove the selected Cycle state. A Cycle Button keeps at least two states."
            disabled={busy || shownBehavior.mode !== "cycle" || shownBehavior.states.length <= 2 || !selectedState}
            onClick={removeSelectedCycleState}
          >
            Remove state
          </button>
        </div>
        <div className="button-behavior-state-grid">
          <label title="Choose the interaction condition to configure for this logical state.">
            <span>When</span>
            <select
              value={selectedAppearanceTrigger}
              disabled={busy || !selectedState}
              onChange={(event) => {
                const trigger = event.currentTarget.value as ButtonAppearanceTrigger;
                setPreviewVisualStateOverride(null);
                setSelectedAppearanceTrigger(trigger);
                setPreviewAppearanceTrigger(trigger);
              }}
            >
              {BUTTON_APPEARANCE_TRIGGERS.map((trigger) => (
                <option key={trigger} value={trigger}>{APPEARANCE_TRIGGER_LABELS[trigger]}</option>
              ))}
            </select>
          </label>
          <label title="Choose which visual section from the working skin appears for this condition.">
            <span>Visual state</span>
            <select
              value={selectedVisualState}
              disabled={busy || !selectedState}
              onChange={(event) => updateSelectedVisualState(event.currentTarget.value as ButtonSkinVisualState)}
            >
              {availableVisualStates.map((visualState) => {
                const empty = visualState !== "base" && !workingSkin[visualState].trim();
                return (
                  <option key={visualState} value={visualState}>
                    {VISUAL_STATE_LABELS[visualState]}{empty ? " (empty in this skin)" : ""}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
        <button
          type="button"
          title="Apply only the Button behavior, logical states, and visual-state mapping."
          disabled={busy}
          onClick={onApplyButtonStateSetup}
        >
          Apply Button state setup
        </button>
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
          label={previewAppearance.label}
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
                title={`Show the ${sectionLabel(section)} visual in both previews.`}
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
        <summary title="Edit labels per state and condition, then position and fit the selected placement's text.">
          <span>Button Text</span>
        </summary>
        <label title="Set the Button's default label.">
          <span>Button label</span>
          <input value={buttonLabel} disabled={busy} onChange={(event) => onButtonLabelChange(event.currentTarget.value)} />
        </label>
        <div className="button-behavior-state-grid">
          <label title="Choose the logical state whose label you want to edit.">
            <span>Button state</span>
            <select
              value={selectedState?.id ?? ""}
              disabled={busy || shownStates.length === 0}
              onChange={(event) => {
                setPreviewVisualStateOverride(null);
                setSelectedActivationStateId(event.currentTarget.value);
              }}
            >
              {shownStates.map((state, index) => (
                <option key={state.id} value={state.id}>{`State ${index + 1}`}</option>
              ))}
            </select>
          </label>
          <label title="Choose when this state-specific label appears.">
            <span>Label condition</span>
            <select
              value={selectedAppearanceTrigger}
              disabled={busy || !selectedState}
              onChange={(event) => {
                const trigger = event.currentTarget.value as ButtonAppearanceTrigger;
                setPreviewVisualStateOverride(null);
                setSelectedAppearanceTrigger(trigger);
                setPreviewAppearanceTrigger(trigger);
              }}
            >
              {BUTTON_APPEARANCE_TRIGGERS.map((trigger) => (
                <option key={trigger} value={trigger}>{APPEARANCE_TRIGGER_LABELS[trigger]}</option>
              ))}
            </select>
          </label>
        </div>
        <label title={selectedAppearanceTrigger === "rest"
          ? "Set this logical state's normal label."
          : "Set an optional label for this condition. Leave it blank to use the state's normal label."}>
          <span>{selectedAppearanceTrigger === "rest" ? "State label" : "Condition label"}</span>
          <input
            value={selectedState
              ? selectedAppearanceTrigger === "rest"
                ? selectedState.label
                : selectedState.labelOverrides[selectedAppearanceTrigger] ?? ""
              : ""}
            placeholder={selectedAppearanceTrigger === "rest" ? buttonLabel : selectedState?.label || buttonLabel}
            disabled={busy || !selectedState}
            onChange={(event) => updateSelectedStateLabel(selectedAppearanceTrigger, event.currentTarget.value)}
          />
        </label>
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
          title="Live preview of every Button Text change, including the selected state and condition."
        >
          <ButtonSkinRenderer
            skin={workingSkin}
            label={previewAppearance.label}
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
          title="Apply only the labels and selected placement's text fit, alignment, size, and position."
          disabled={busy}
          onClick={onApplyAllButtonText}
        >
          Apply All
        </button>
      </details>
    </aside>
  );
}
