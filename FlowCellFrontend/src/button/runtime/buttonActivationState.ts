import type {
  ButtonActivationBehavior,
  ButtonActivationMode,
  ButtonActivationState,
  ButtonAppearanceTrigger,
  ButtonSkinVisualState,
  ButtonVisualStateMap
} from "../types.js";

export const BUTTON_ACTIVATION_MODES = ["momentary", "toggle", "cycle"] as const;

export const BUTTON_APPEARANCE_TRIGGERS = [
  "rest",
  "hover",
  "play",
  "pressed",
  "held",
  "release",
  "selected",
  "disabled",
  "error"
] as const satisfies readonly ButtonAppearanceTrigger[];

export const BUTTON_APPEARANCE_TRIGGER_PRIORITY = [
  "error",
  "disabled",
  "held",
  "pressed",
  "selected",
  "release",
  "play",
  "hover",
  "rest"
] as const satisfies readonly ButtonAppearanceTrigger[];

export const BUTTON_SKIN_VISUAL_STATES = [
  "base",
  "hover",
  "play",
  "pressed",
  "held",
  "release",
  "disabled",
  "error"
] as const satisfies readonly ButtonSkinVisualState[];

export interface ButtonAppearanceInput {
  hovered: boolean;
  pressed: boolean;
  held: boolean;
  play: boolean;
  release: boolean;
  selected: boolean;
  disabled: boolean;
  error: boolean;
}

export interface ButtonResolvedVisualFlags {
  hovered: boolean;
  pressed: boolean;
  held: boolean;
  play: boolean;
  release: boolean;
  disabled: boolean;
  error: boolean;
}

export interface ResolveButtonAppearanceOptions {
  buttonLabel: string;
  activationBehavior: ButtonActivationBehavior | null;
  activeStateIndex: number;
  visualStateMap: ButtonVisualStateMap | null;
  appearance: ButtonAppearanceInput;
}

export interface ButtonResolvedAppearance {
  activationState: ButtonActivationState | null;
  activationStateIndex: number;
  activeTrigger: ButtonAppearanceTrigger;
  visualState: ButtonSkinVisualState;
  label: string;
  flags: ButtonResolvedVisualFlags;
}

const IDENTITY_VISUAL_STATE_BY_TRIGGER: Record<ButtonAppearanceTrigger, ButtonSkinVisualState> = {
  rest: "base",
  hover: "hover",
  play: "play",
  pressed: "pressed",
  held: "held",
  release: "release",
  selected: "pressed",
  disabled: "disabled",
  error: "error"
};

function defaultStateId(index: number): string {
  return `state-${index + 1}`;
}

export function createDefaultButtonActivationBehavior(
  mode: ButtonActivationMode,
  buttonLabel: string,
  createStateId: (index: number) => string = defaultStateId
): ButtonActivationBehavior {
  const stateCount = mode === "momentary" ? 1 : 2;
  return {
    mode,
    states: Array.from({ length: stateCount }, (_, index) => ({
      id: createStateId(index),
      label: buttonLabel,
      labelOverrides: {}
    }))
  };
}

export function getButtonActivationStateCount(
  behavior: ButtonActivationBehavior | null
): number {
  if (!behavior || behavior.states.length === 0 || behavior.mode === "momentary") return 1;
  if (behavior.mode === "toggle") return Math.min(2, behavior.states.length);
  return behavior.states.length;
}

export function clampButtonActivationStateIndex(
  behavior: ButtonActivationBehavior | null,
  index: number
): number {
  const stateCount = getButtonActivationStateCount(behavior);
  if (!Number.isFinite(index)) return 0;
  return Math.min(stateCount - 1, Math.max(0, Math.trunc(index)));
}

export function advanceButtonActivationStateIndex(
  behavior: ButtonActivationBehavior | null,
  index: number
): number {
  const stateCount = getButtonActivationStateCount(behavior);
  if (stateCount <= 1) return 0;
  return (clampButtonActivationStateIndex(behavior, index) + 1) % stateCount;
}

export function getActiveButtonActivationState(
  behavior: ButtonActivationBehavior | null,
  index: number
): ButtonActivationState | null {
  if (!behavior || behavior.states.length === 0) return null;
  return behavior.states[clampButtonActivationStateIndex(behavior, index)] ?? behavior.states[0] ?? null;
}

export function buttonAppearanceTriggerToVisualState(
  trigger: ButtonAppearanceTrigger
): ButtonSkinVisualState {
  return IDENTITY_VISUAL_STATE_BY_TRIGGER[trigger];
}

export function resolveButtonAppearanceTrigger(
  appearance: ButtonAppearanceInput
): ButtonAppearanceTrigger {
  if (appearance.error) return "error";
  if (appearance.disabled) return "disabled";
  if (appearance.held) return "held";
  if (appearance.pressed) return "pressed";
  if (appearance.selected) return "selected";
  if (appearance.release) return "release";
  if (appearance.play) return "play";
  if (appearance.hovered) return "hover";
  return "rest";
}

function flagsForSingleVisualState(visualState: ButtonSkinVisualState): ButtonResolvedVisualFlags {
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

function legacyComposedFlags(appearance: ButtonAppearanceInput): ButtonResolvedVisualFlags {
  return {
    hovered: appearance.hovered,
    pressed: appearance.pressed || appearance.selected,
    held: appearance.held,
    play: appearance.play,
    release: appearance.selected ? false : appearance.release,
    disabled: appearance.disabled,
    error: appearance.error
  };
}

export function resolveButtonAppearance(
  options: ResolveButtonAppearanceOptions
): ButtonResolvedAppearance {
  const activationStateIndex = clampButtonActivationStateIndex(
    options.activationBehavior,
    options.activeStateIndex
  );
  const activationState = getActiveButtonActivationState(
    options.activationBehavior,
    activationStateIndex
  );
  const activeTrigger = resolveButtonAppearanceTrigger(options.appearance);
  const identityVisualState = buttonAppearanceTriggerToVisualState(activeTrigger);
  const mappedVisualState = activationState
    ? options.visualStateMap?.[activationState.id]?.[activeTrigger]
    : undefined;
  const visualState = mappedVisualState ?? identityVisualState;
  const labelOverride = activeTrigger === "rest"
    ? undefined
    : activationState?.labelOverrides[activeTrigger];

  return {
    activationState,
    activationStateIndex,
    activeTrigger,
    visualState,
    label: labelOverride ?? activationState?.label ?? options.buttonLabel,
    flags: options.visualStateMap === null
      ? legacyComposedFlags(options.appearance)
      : flagsForSingleVisualState(visualState)
  };
}
