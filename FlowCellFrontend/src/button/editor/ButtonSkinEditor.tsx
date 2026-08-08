import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  buttonSkinNameFromPath,
  type ButtonSkinSectionSource
} from "../skins/buttonSkinFormat";
import {
  applyNamedButtonSkinSections,
  parseButtonSkinPaste
} from "../skins/skinPasteParser";
import { compileButtonSkin, diagnosticsBySkinSection } from "../skins/skinCompiler";
import { ButtonSkinRenderer } from "../skins/ButtonSkinRenderer";
import {
  buttonSkinColorWithPreservedAlpha,
  buttonSkinOpaqueColor,
  buttonSkinPickerColor,
  collectButtonSkinProfileColors,
  normalizeButtonSkinColor,
  readButtonSkinHighlightOnActive,
  readButtonSkinHighlightOnHover,
  readButtonSkinTextColor,
  setButtonSkinHighlightOnActive,
  setButtonSkinHighlightOnHover,
  setButtonSkinProfileColor,
  setButtonSkinTextColor
} from "../skins/buttonSkinColors";
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
import {
  buttonSkinFilePathsEqual,
  type ButtonSkinFileResult,
  type ButtonSkinRecentFile
} from "./buttonSkinFiles";

export interface ButtonSkinEditorProps {
  skin: ButtonSkin | null;
  skins: readonly ButtonSkin[];
  recentSkinFiles: readonly ButtonSkinRecentFile[];
  skinFilePath: string | null;
  skinContextKey: string;
  busy: boolean;
  placement: ButtonPlacement | null;
  surfaceButtonCount: number;
  selectionButtonCount: number;
  allSurfaceButtonsSameSize: boolean;
  buttonLabel: string;
  buttonTooltip: string;
  activationCycle: ButtonPlacementActivationCycle | null;
  stateStructureApplied: boolean;
  onButtonLabelChange: (label: string) => void;
  onButtonTooltipChange: (tooltip: string) => void;
  onActivationCycleChange: (cycle: ButtonPlacementActivationCycle) => void;
  onApplyAllButtonText: () => void;
  onSizingModePreviewChange: (sizingMode: ButtonPlacementSizingMode) => void;
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
  onAssignSkin: (skin: ButtonSkin, sizingMode: ButtonPlacementSizingMode) => void;
  onAssignSkinToSelection: (skin: ButtonSkin, sizingMode: ButtonPlacementSizingMode) => void;
  onAssignSkinToPanel: (skin: ButtonSkin, sizingMode: ButtonPlacementSizingMode) => void;
  onLoadSkinFile: (
    path: string | null,
    preferredSkinId?: string
  ) => Promise<ButtonSkinFileResult | null>;
  onSaveSkin: (
    skin: ButtonSkin,
    currentPath: string | null
  ) => Promise<ButtonSkinFileResult | null>;
  onSaveAsNewSkin: (skin: ButtonSkin) => Promise<ButtonSkinFileResult | null>;
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

function responsiveSizeAssignmentFromPlacement(
  placement: ButtonPlacement
): ReturnType<typeof sizeAssignmentFromPlacement> {
  return {
    ...sizeAssignmentFromPlacement(placement),
    sizingMode: "responsive"
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

function recentSkinFileLabel(path: string): string {
  const parts = path.split(/[\\/]/);
  const parent = parts.slice(0, -1).join("\\");
  const name = buttonSkinNameFromPath(path);
  return parent ? `${name} (${parent})` : name;
}

interface ButtonColorPickerRowProps {
  label: string;
  title: string;
  value: string;
  disabled?: boolean;
  preserveAlpha?: boolean;
  onColorChange: (value: string) => void;
  onUseSkinColor?: () => void;
}

type EyeDropperConstructor = new () => {
  open: () => Promise<{ sRGBHex: string }>;
};

function ButtonColorPickerRow({
  label,
  title,
  value,
  disabled = false,
  preserveAlpha = true,
  onColorChange,
  onUseSkinColor
}: ButtonColorPickerRowProps) {
  const colorInputRef = useRef<HTMLInputElement | null>(null);
  const commitTextColor = (input: HTMLInputElement) => {
    const normalized = normalizeButtonSkinColor(input.value);
    const next = preserveAlpha ? normalized : buttonSkinOpaqueColor(input.value);
    if (next) onColorChange(next);
    else input.value = value;
  };
  const colorFromOpaquePicker = (pickerColor: string) => (
    preserveAlpha
      ? buttonSkinColorWithPreservedAlpha(pickerColor, value)
      : buttonSkinOpaqueColor(pickerColor)
  );
  const pickScreenColor = async () => {
    const EyeDropper = typeof window === "undefined"
      ? undefined
      : (window as typeof window & { EyeDropper?: EyeDropperConstructor }).EyeDropper;
    if (!EyeDropper) {
      colorInputRef.current?.click();
      return;
    }
    try {
      const result = await new EyeDropper().open();
      const next = colorFromOpaquePicker(result.sRGBHex);
      if (next) onColorChange(next);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "AbortError") {
        console.warn("Button color eyedropper failed.", error);
      }
    }
  };

  return (
    <div className="button-color-row" title={title}>
      <span className="button-color-row__label">{label}</span>
      <input
        ref={colorInputRef}
        type="color"
        aria-label={`${label} color picker`}
        value={buttonSkinPickerColor(value)}
        disabled={disabled}
        onInput={(event) => {
          const next = colorFromOpaquePicker(event.currentTarget.value);
          if (next) onColorChange(next);
        }}
      />
      <input
        key={value}
        type="text"
        aria-label={`${label} color value`}
        defaultValue={value}
        disabled={disabled}
        spellCheck={false}
        onBlur={(event) => commitTextColor(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.currentTarget.value = value;
            event.currentTarget.blur();
          }
        }}
      />
      <button
        type="button"
        className="button-color-row__pick"
        title="Pick a color from the screen. Falls back to the native color picker when the direct eyedropper is unavailable."
        disabled={disabled}
        onClick={() => void pickScreenColor()}
      >
        Pick
      </button>
      {onUseSkinColor ? (
        <button
          type="button"
          className="button-color-row__reset"
          title="Remove the generated text-color override and use the skin's authored text color."
          disabled={disabled}
          onClick={onUseSkinColor}
        >
          Use skin
        </button>
      ) : null}
    </div>
  );
}

function resizeButtonTooltipEditor(editor: HTMLTextAreaElement | null): void {
  if (!editor || editor.clientWidth <= 0) return;
  editor.style.height = "auto";
  const borderHeight = editor.offsetHeight - editor.clientHeight;
  editor.style.height = `${Math.ceil(editor.scrollHeight + borderHeight)}px`;
}

export function ButtonSkinEditor({
  skin,
  skins,
  recentSkinFiles,
  skinFilePath,
  skinContextKey,
  busy,
  placement,
  surfaceButtonCount,
  selectionButtonCount,
  allSurfaceButtonsSameSize,
  buttonLabel,
  buttonTooltip,
  activationCycle,
  stateStructureApplied,
  onButtonLabelChange,
  onButtonTooltipChange,
  onActivationCycleChange,
  onApplyAllButtonText,
  onSizingModePreviewChange,
  onAssignSize,
  onAssignSizeToPanel,
  onPlacementTextChange,
  onAssignSkin,
  onAssignSkinToSelection,
  onAssignSkinToPanel,
  onLoadSkinFile,
  onSaveSkin,
  onSaveAsNewSkin
}: ButtonSkinEditorProps) {
  const [workingSkin, setWorkingSkin] = useState<ButtonSkin | null>(
    () => skin ? cloneButtonDocument(skin) : null
  );
  const [workingSkinFilePath, setWorkingSkinFilePath] = useState<string | null>(
    skinFilePath
  );
  const [paste, setPaste] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [updatedSections, setUpdatedSections] = useState<Set<ButtonSkinSectionName>>(new Set());
  const [benchMeasurement, setBenchMeasurement] = useState<ButtonCoreMeasurement | null>(null);
  const [benchNaturalMeasurement, setBenchNaturalMeasurement] = useState<ButtonCoreMeasurement | null>(null);
  const [benchTextOverflow, setBenchTextOverflow] = useState(false);
  const [detectedTextColor, setDetectedTextColor] = useState<string | null>(null);
  const [selectedActivationStateId, setSelectedActivationStateId] = useState("");
  const [cycleStateCountInput, setCycleStateCountInput] = useState(
    () => activationCycle ? String(activationCycle.states.length) : ""
  );
  const [behaviorPreviewHovered, setBehaviorPreviewHovered] = useState(false);
  const [behaviorPreviewCoreElement, setBehaviorPreviewCoreElement] = useState<HTMLElement | SVGElement | null>(null);
  const [previewAppearanceTrigger, setPreviewAppearanceTrigger] = useState<ButtonAppearanceTrigger>("rest");
  const [previewVisualStateOverride, setPreviewVisualStateOverride] = useState<ButtonSkinVisualState | null>(null);
  const [workingSize, setWorkingSize] = useState<ReturnType<typeof sizeAssignmentFromPlacement> | null>(
    () => placement ? responsiveSizeAssignmentFromPlacement(placement) : null
  );
  const [appliedPreviewSizingMode, setAppliedPreviewSizingMode] = useState<ButtonPlacementSizingMode>(
    "responsive"
  );
  const [workingPreviewUsesNaturalSize, setWorkingPreviewUsesNaturalSize] = useState(false);
  const buttonTooltipEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const compileResult = useMemo(
    () => workingSkin ? compileButtonSkin(workingSkin) : null,
    [workingSkin]
  );
  const diagnosticGroups = useMemo(
    () => compileResult && !compileResult.ok ? diagnosticsBySkinSection(compileResult.diagnostics) : {},
    [compileResult]
  );
  const workingProfileColors = useMemo(
    () => workingSkin ? collectButtonSkinProfileColors(skinSections(workingSkin)) : [],
    [workingSkin]
  );
  const authoredTextColor = useMemo(
    () => workingSkin ? readButtonSkinTextColor(skinSections(workingSkin)) : null,
    [workingSkin]
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

  useLayoutEffect(() => {
    resizeButtonTooltipEditor(buttonTooltipEditorRef.current);
  }, [buttonTooltip, skinContextKey, skin?.id]);

  useEffect(() => {
    const editor = buttonTooltipEditorRef.current;
    if (!editor || typeof ResizeObserver === "undefined") return;
    let observedWidth = -1;
    const resizeForWidth = () => {
      const width = editor.getBoundingClientRect().width;
      if (width <= 0 || Math.abs(width - observedWidth) < 0.5) return;
      observedWidth = width;
      resizeButtonTooltipEditor(editor);
    };
    const observer = new ResizeObserver(resizeForWidth);
    observer.observe(editor);
    resizeForWidth();
    return () => observer.disconnect();
  }, [skinContextKey, placement?.id, workingSkin?.id]);

  useEffect(() => {
    setWorkingSkin(skin ? cloneButtonDocument(skin) : null);
    setWorkingSkinFilePath(skinFilePath);
    setWorkingSize(placement ? responsiveSizeAssignmentFromPlacement(placement) : null);
    setAppliedPreviewSizingMode("responsive");
    onSizingModePreviewChange("responsive");
    setWorkingPreviewUsesNaturalSize(false);
    setBenchMeasurement(null);
    setBenchNaturalMeasurement(null);
    setDetectedTextColor(null);
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
    if (!placement || !allSurfaceButtonsSameSize) return;
    setWorkingSize(responsiveSizeAssignmentFromPlacement(placement));
    setAppliedPreviewSizingMode("responsive");
    onSizingModePreviewChange("responsive");
  }, [placement?.id, allSurfaceButtonsSameSize]);

  useEffect(() => {
    setWorkingSize((current) => {
      if (!placement) return null;
      if (!current || current.placementId !== placement.id) {
        return sizeAssignmentFromPlacement(placement);
      }
      return {
        ...current,
        width: placement.width,
        height: placement.height
      };
    });
  }, [placement?.id, placement?.width, placement?.height]);

  useEffect(() => {
    setBehaviorPreviewHovered(false);
    const core = behaviorPreviewCoreElement;
    if (!core) return;
    const handlePointerEnter = () => setBehaviorPreviewHovered(true);
    const handlePointerLeave = () => setBehaviorPreviewHovered(false);
    core.addEventListener("pointerenter", handlePointerEnter);
    core.addEventListener("pointerleave", handlePointerLeave);
    core.addEventListener("pointercancel", handlePointerLeave);
    return () => {
      core.removeEventListener("pointerenter", handlePointerEnter);
      core.removeEventListener("pointerleave", handlePointerLeave);
      core.removeEventListener("pointercancel", handlePointerLeave);
    };
  }, [behaviorPreviewCoreElement]);

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
  const sizeForAssignment = {
    ...activeSize,
    ...(workingPreviewUsesNaturalSize && benchNaturalMeasurement
      ? {
          width: benchNaturalMeasurement.width,
          height: benchNaturalMeasurement.height
        }
      : {}),
    ...(benchNaturalMeasurement
      ? {
          proportionalBasis: {
            width: benchNaturalMeasurement.width,
            height: benchNaturalMeasurement.height
          }
        }
      : {})
  };
  const sizingMode = activeSize.sizingMode;
  const previewSizingMode = appliedPreviewSizingMode;
  const sizeActionsDisabled = busy || allSurfaceButtonsSameSize;
  const previewWidth = workingPreviewUsesNaturalSize ? undefined : activeSize.width;
  const previewHeight = workingPreviewUsesNaturalSize ? undefined : activeSize.height;
  const previewConstrained = !workingPreviewUsesNaturalSize;
  const workingSkinHasText = Boolean(compileResult?.ok && compileResult.compiled.hasLabelToken);
  const workingTextProfile = workingProfileColors.find((color) => color.role === "text") ?? null;
  const workingMaterialProfile = workingProfileColors.filter((color) => color.role !== "text");
  const visibleTextColor = workingTextProfile?.color ?? authoredTextColor ?? detectedTextColor ?? "#FFFFFF";
  const explicitWorkingSkinHighlightOnHover = readButtonSkinHighlightOnHover(workingSkin);
  const workingSkinHighlightOnHover = explicitWorkingSkinHighlightOnHover ?? placement.highlightOnHover;
  const workingSkinHighlightOnActive = readButtonSkinHighlightOnActive(workingSkin) ?? false;

  const workingSkinForPersistence = (): ButtonSkin => cloneButtonDocument(
    explicitWorkingSkinHighlightOnHover === null
      ? withSections(
          workingSkin,
          setButtonSkinHighlightOnHover(skinSections(workingSkin), workingSkinHighlightOnHover)
        )
      : workingSkin
  );

  const applyWorkingColorSections = (sections: ButtonSkinSectionSource) => {
    const changedSections = BUTTON_SKIN_SECTION_ORDER.filter(
      (section) => sections[section] !== workingSkin[section]
    );
    if (changedSections.length === 0) return;
    setWorkingSkin(withSections(workingSkin, sections));
    setUpdatedSections((current) => new Set([...current, ...changedSections]));
  };

  const resetWorkingSizingMode = () => {
    setWorkingSize((current) => {
      const base = current?.placementId === placement.id
        ? current
        : sizeAssignmentFromPlacement(placement);
      return {
        ...base,
        sizingMode: "responsive"
      };
    });
    setAppliedPreviewSizingMode("responsive");
    onSizingModePreviewChange("responsive");
  };

  const captureWorkingTextColor = (element: HTMLElement | SVGElement | null) => {
    if (!element) return;
    const computed = getComputedStyle(element);
    const source = element.namespaceURI === "http://www.w3.org/2000/svg"
      ? computed.fill
      : computed.color;
    const normalized = normalizeButtonSkinColor(source);
    const opaque = normalized ? buttonSkinOpaqueColor(normalized) : null;
    if (opaque) setDetectedTextColor((current) => current === opaque ? current : opaque);
  };

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
    setWorkingPreviewUsesNaturalSize(false);
    setAppliedPreviewSizingMode(sizingMode);
    setWorkingSize((current) => {
      const assignedBase = current?.placementId === placement.id
        ? current
        : sizeAssignmentFromPlacement(placement);
      const base = workingPreviewUsesNaturalSize && benchNaturalMeasurement
        ? {
            ...assignedBase,
            width: benchNaturalMeasurement.width,
            height: benchNaturalMeasurement.height
          }
        : assignedBase;
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
      resetWorkingSizingMode();
      setWorkingPreviewUsesNaturalSize(true);
      setBenchMeasurement(null);
      setBenchNaturalMeasurement(null);
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
  const applySkinFileResult = (result: ButtonSkinFileResult | null) => {
    if (!result) return;
    setWorkingSkin(cloneButtonDocument(result.skin));
    setWorkingSkinFilePath(result.path);
    resetWorkingSizingMode();
    setWorkingPreviewUsesNaturalSize(true);
    setBenchMeasurement(null);
    setBenchNaturalMeasurement(null);
  };
  const workingRecentFileIndex = workingSkinFilePath
    ? recentSkinFiles.findIndex(
        (entry) => buttonSkinFilePathsEqual(entry.path, workingSkinFilePath)
      )
    : -1;
  const loadSkinValue = workingRecentFileIndex >= 0
    ? `recent:${workingRecentFileIndex}`
    : `saved:${workingSkin.id}`;

  return (
    <aside className="button-skin-editor">
      <h2>Skin Editor</h2>
      <div className="button-skin-editor__toolbar">
        <button
          type="button"
          title="Assign the working skin to only the selected Button placement."
          disabled={skinActionsDisabled}
          onClick={() => {
            setAppliedPreviewSizingMode(sizingMode);
            onAssignSkin(workingSkinForPersistence(), sizingMode);
          }}
        >
          Assign Skin
        </button>
        <button
          type="button"
          title="Assign the working skin to every Button currently selected in the workspace."
          disabled={skinActionsDisabled || selectionButtonCount === 0}
          onClick={() => {
            setAppliedPreviewSizingMode(sizingMode);
            onAssignSkinToSelection(workingSkinForPersistence(), sizingMode);
          }}
        >
          Assign Skin to Selection
        </button>
        <button
          type="button"
          title="Assign the working skin to every Button on the selected Placement's surface."
          disabled={skinActionsDisabled}
          onClick={() => {
            setAppliedPreviewSizingMode(sizingMode);
            onAssignSkinToPanel(workingSkinForPersistence(), sizingMode);
          }}
        >
          Assign Skin to Panel
        </button>
        <label title={workingSkinFilePath ?? "Choose a saved skin or recent skin file to edit in this working copy."}>
          <span>Load skin</span>
          <select
            value={loadSkinValue}
            disabled={busy}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value.startsWith("saved:")) {
                const loaded = skins.find((option) => option.id === value.slice("saved:".length));
                if (!loaded) return;
                setWorkingSkin(cloneButtonDocument(loaded));
                setWorkingSkinFilePath(
                  recentSkinFiles.find((entry) => entry.skinId === loaded.id)?.path ?? null
                );
                resetWorkingSizingMode();
                setWorkingPreviewUsesNaturalSize(true);
                setBenchMeasurement(null);
                setBenchNaturalMeasurement(null);
                return;
              }
              if (value.startsWith("recent:")) {
                const recentFile = recentSkinFiles[Number(value.slice("recent:".length))];
                if (!recentFile) return;
                void onLoadSkinFile(recentFile.path, recentFile.skinId).then(applySkinFileResult);
                return;
              }
              if (value === "browse") {
                void onLoadSkinFile(null).then(applySkinFileResult);
              }
            }}
          >
            {recentSkinFiles.length > 0 ? (
              <optgroup label="Recent files">
                {recentSkinFiles.map((entry, index) => (
                  <option key={entry.path} value={`recent:${index}`}>
                    {recentSkinFileLabel(entry.path)}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <optgroup label="Saved skins">
              {skins.map((option) => (
                <option key={option.id} value={`saved:${option.id}`}>{option.name}</option>
              ))}
            </optgroup>
            <option value="browse">Browse...</option>
          </select>
        </label>
        <button
          type="button"
          title="Save changes to this skin."
          disabled={skinActionsDisabled}
          onClick={() => {
            void onSaveSkin(
              workingSkinForPersistence(),
              workingSkinFilePath
            ).then(applySkinFileResult);
          }}
        >
          Save skin
        </button>
        <button
          type="button"
          title="Save this working skin under the name chosen in the file dialog."
          disabled={skinActionsDisabled}
          onClick={() => {
            void onSaveAsNewSkin(workingSkinForPersistence()).then(applySkinFileResult);
          }}
        >
          Save as new skin
        </button>
      </div>
      <details className="button-skin-section button-skin-size-section" open>
        <summary title="Choose the policy for the next explicit size edit. Selecting a policy does not change geometry.">
          <span>Button Size</span>
          <small>
            {allSurfaceButtonsSameSize
              ? "Legacy size link active"
              : workingPreviewUsesNaturalSize
                ? "Natural skin size"
                : "Working preview"}
          </small>
        </summary>
        <label title="Changing this policy does not resize anything. Responsive applies an explicitly requested box without root scaling; Proportional scales uniformly; Stretch scales each axis independently.">
          <span>Sizing behavior</span>
          <select
            value={sizingMode}
            disabled={sizeActionsDisabled}
            onChange={(event) => {
              const nextMode = event.currentTarget.value as ButtonPlacementSizingMode;
              onSizingModePreviewChange(nextMode);
              setWorkingSize((current) => {
                const base = current?.placementId === placement.id
                  ? current
                  : sizeAssignmentFromPlacement(placement);
                return {
                  ...base,
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
              value={sizeForAssignment.width}
              disabled={sizeActionsDisabled}
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
              value={sizeForAssignment.height}
              disabled={sizeActionsDisabled}
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
            onClick={() => {
              setWorkingSize(sizeForAssignment);
              setWorkingPreviewUsesNaturalSize(false);
              setAppliedPreviewSizingMode(sizingMode);
              onAssignSize(sizeForAssignment);
            }}
          >
            Assign Size
          </button>
          <button
            type="button"
            title={allSurfaceButtonsSameSize
              ? "Turn off Same size Buttons before assigning panel sizes."
              : "Apply this target box and sizing behavior to every Button on this panel surface."}
            disabled={sizeActionsDisabled || surfaceButtonCount === 0}
            onClick={() => {
              setWorkingSize(sizeForAssignment);
              setWorkingPreviewUsesNaturalSize(false);
              setAppliedPreviewSizingMode(sizingMode);
              onAssignSizeToPanel(sizeForAssignment);
            }}
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
          title="Live preview. Hover activates only over the authored interactive shape."
        >
          <ButtonSkinRenderer
            skin={workingSkin}
            label={previewLabel}
            width={previewWidth}
            height={previewHeight}
            constrained={previewConstrained}
            matchHitboxToSkin={previewSizingMode !== "responsive"}
            allowStretching={previewSizingMode === "stretch"}
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
            rawHovered={behaviorPreviewHovered}
            onCoreElementChange={setBehaviorPreviewCoreElement}
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
          width={previewWidth}
          height={previewHeight}
          constrained={previewConstrained}
          matchHitboxToSkin={previewSizingMode !== "responsive"}
          allowStretching={previewSizingMode === "stretch"}
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
          onLabelElementChange={captureWorkingTextColor}
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
                resetWorkingSizingMode();
                setWorkingPreviewUsesNaturalSize(true);
                setBenchMeasurement(null);
                setBenchNaturalMeasurement(null);
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
      <details
        className="button-skin-section"
        onToggle={(event) => {
          if (!event.currentTarget.open) return;
          requestAnimationFrame(() => resizeButtonTooltipEditor(buttonTooltipEditorRef.current));
        }}
      >
        <summary title="Edit Button labels and the shared Button Tooltip. Cycle states and visuals save with the placement.">
          <span>Button Text</span>
          <small>Text + tooltip</small>
        </summary>
        {activationCycle ? (
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
        ) : null}
        <div className="button-text-label-grid">
          {activationCycle ? (
            <label title="Set the label displayed while this cycle state is active.">
              <span>State label</span>
              <input
                value={selectedState?.label ?? ""}
                placeholder={buttonLabel}
                disabled={busy || !selectedState}
                onChange={(event) => updateSelectedStateLabel(event.currentTarget.value)}
              />
            </label>
          ) : (
            <label title="Set the Button's default label.">
              <span>Button label</span>
              <input value={buttonLabel} disabled={busy} onChange={(event) => onButtonLabelChange(event.currentTarget.value)} />
            </label>
          )}
          <label title="Set the shared tooltip shown when this Button is hovered on any placement. This editor expands so the complete tooltip stays visible and selectable.">
            <span>Button Tooltip</span>
            <textarea
              ref={buttonTooltipEditorRef}
              className="button-tooltip-editor"
              rows={3}
              wrap="soft"
              value={buttonTooltip}
              disabled={busy}
              onFocus={(event) => resizeButtonTooltipEditor(event.currentTarget)}
              onChange={(event) => {
                onButtonTooltipChange(event.currentTarget.value);
                resizeButtonTooltipEditor(event.currentTarget);
              }}
            />
          </label>
        </div>
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
            width={previewWidth}
            height={previewHeight}
            constrained={previewConstrained}
            matchHitboxToSkin={previewSizingMode !== "responsive"}
            allowStretching={previewSizingMode === "stretch"}
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
            ? "Save Settings first because the cycle state structure changed. Button Text stays in preview until then."
            : "Apply every pending Button Text change across the editor: base or cycle labels, Button tooltips, and each placement's fit, alignment, size, and X/Y position."}
          disabled={busy || stateTextBlocked}
          onClick={onApplyAllButtonText}
        >
          Apply All
        </button>
      </details>
      <details className="button-skin-section button-color-section" open>
        <summary title="Edit the active working skin's authored semantic color profile without changing shadows, effects, geometry, or assignment.">
          <span>Button Color</span>
          <small>{workingMaterialProfile.length > 0
            ? `${workingMaterialProfile.length} part${workingMaterialProfile.length === 1 ? "" : "s"}`
            : "No profile"}</small>
        </summary>
        <div className="button-color-grid">
          <ButtonColorPickerRow
            label="Text Color"
            title={workingSkinHasText
              ? "Edit the independent authored Text profile, or add an isolated label override when this skin has no Text profile."
              : "This skin has no editable Button label."}
            value={visibleTextColor}
            disabled={busy || !workingSkinHasText}
            preserveAlpha={false}
            onColorChange={(value) => {
              applyWorkingColorSections(workingTextProfile
                ? setButtonSkinProfileColor(skinSections(workingSkin), workingTextProfile.variable, value)
                : setButtonSkinTextColor(skinSections(workingSkin), value));
            }}
            onUseSkinColor={!workingTextProfile && authoredTextColor ? () => {
              applyWorkingColorSections(setButtonSkinTextColor(skinSections(workingSkin), null));
              setDetectedTextColor(null);
            } : undefined}
          />
          {workingMaterialProfile.map((profileColor) => (
            <ButtonColorPickerRow
              key={profileColor.variable}
              label={profileColor.label}
              title={`Edit ${profileColor.variable}. The skin's authored shade formulas update its related faces and states; unprofiled effects remain unchanged.`}
              value={profileColor.color}
              disabled={busy}
              onColorChange={(value) => {
                applyWorkingColorSections(setButtonSkinProfileColor(
                  skinSections(workingSkin),
                  profileColor.variable,
                  value
                ));
              }}
            />
          ))}
          {workingMaterialProfile.length === 0 ? (
            <p className="button-color-profile-empty">
              This skin has no authored color profile. Build or adapt it with Skin Author to expose its main parts without including shadows or effects.
            </p>
          ) : null}
        </div>
        <label
          className="button-hover-highlight-toggle"
          title="Brighten every Button using this skin by 15% while hovered. Assign Skin to Panel carries this setting to the whole panel."
        >
          <input
            type="checkbox"
            checked={workingSkinHighlightOnHover}
            disabled={busy}
            onChange={(event) => {
              applyWorkingColorSections(setButtonSkinHighlightOnHover(
                skinSections(workingSkin),
                event.currentTarget.checked
              ));
            }}
          />
          <span>Highlight on hover</span>
        </label>
        <label
          className="button-hover-highlight-toggle"
          title="Brighten every Button using this skin by 30% while it is the active choice, such as a selected Tool Set operation or a selected Main Page Button. Hover brightening still stacks on top."
        >
          <input
            type="checkbox"
            checked={workingSkinHighlightOnActive}
            disabled={busy}
            onChange={(event) => {
              applyWorkingColorSections(setButtonSkinHighlightOnActive(
                skinSections(workingSkin),
                event.currentTarget.checked
              ));
            }}
          />
          <span>Highlight when active</span>
        </label>
      </details>
    </aside>
  );
}
