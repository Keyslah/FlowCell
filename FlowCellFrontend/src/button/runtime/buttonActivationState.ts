import type {
  ButtonActivationBehavior,
  ButtonActivationMode,
  ButtonActivationState,
  ButtonAppearanceTrigger,
  ButtonCycleAdvanceTrigger,
  ButtonPlacementActivationCycle,
  ButtonPlacementCycleState,
  ButtonSkinVisualState,
  ButtonVisualStateMap,
  JsonValue
} from "../types.js";

export const BUTTON_ACTIVATION_MODES = ["momentary", "toggle", "cycle"] as const;

export const BUTTON_CYCLE_ADVANCE_TRIGGERS = [
  "press",
  "hover",
  "release"
] as const satisfies readonly ButtonCycleAdvanceTrigger[];

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
  activationCycle?: ButtonPlacementActivationCycle | null;
  activeStateIndex: number;
  visualStateMap: ButtonVisualStateMap | null;
  authoredVisualStates?: ReadonlySet<ButtonSkinVisualState>;
  appearance: ButtonAppearanceInput;
}

export interface ButtonResolvedAppearance {
  activationState: ButtonActivationState | ButtonPlacementCycleState | null;
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

export function getButtonPlacementActivationStateCount(
  cycle: ButtonPlacementActivationCycle | null | undefined
): number {
  return cycle && cycle.states.length >= 2 ? cycle.states.length : 1;
}

export function clampButtonPlacementActivationStateIndex(
  cycle: ButtonPlacementActivationCycle | null | undefined,
  index: number
): number {
  const stateCount = getButtonPlacementActivationStateCount(cycle);
  if (!Number.isFinite(index)) return 0;
  return Math.min(stateCount - 1, Math.max(0, Math.trunc(index)));
}

export function getActiveButtonPlacementActivationState(
  cycle: ButtonPlacementActivationCycle | null | undefined,
  index: number
): ButtonPlacementCycleState | null {
  if (!cycle || cycle.states.length < 2) return null;
  return cycle.states[clampButtonPlacementActivationStateIndex(cycle, index)] ?? cycle.states[0] ?? null;
}

export function buttonPlacementActivationCycleAdvancesOn(
  cycle: ButtonPlacementActivationCycle | null | undefined,
  index: number,
  trigger: ButtonCycleAdvanceTrigger
): boolean {
  return getActiveButtonPlacementActivationState(cycle, index)?.advanceTrigger === trigger;
}

function buttonActivationResultValueMatches(expected: JsonValue, actual: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((value, index) => buttonActivationResultValueMatches(value, actual[index]));
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    const actualRecord = actual as Record<string, unknown>;
    return Object.entries(expected).every(([key, value]) => (
      Object.hasOwn(actualRecord, key) && buttonActivationResultValueMatches(value, actualRecord[key])
    ));
  }
  return Object.is(expected, actual);
}

/**
 * Resolves an authoritative placement-cycle index from an action response.
 * Match objects are placement-owned partial JSON patterns; nested objects are
 * matched by declared keys while arrays remain ordered and exact.
 */
export function resolveButtonPlacementActivationStateIndexFromResponse(
  cycle: ButtonPlacementActivationCycle | null | undefined,
  response: unknown
): number | null {
  if (!cycle || cycle.states.length < 2) return null;
  let matchedIndex: number | null = null;
  for (const [index, state] of cycle.states.entries()) {
    const stateMatches = (state.resultMatches ?? []).some(
      (match) => buttonActivationResultValueMatches(match, response)
    );
    if (!stateMatches) continue;
    if (matchedIndex !== null) return null;
    matchedIndex = index;
  }
  return matchedIndex;
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

function resolvePlacementCycleAppearanceTrigger(
  appearance: ButtonAppearanceInput,
  visualStateMap?: Partial<Record<ButtonAppearanceTrigger, ButtonSkinVisualState>>,
  authoredVisualStates?: ReadonlySet<ButtonSkinVisualState>
): ButtonAppearanceTrigger {
  if (appearance.error) return "error";
  if (appearance.disabled) return "disabled";
  const resolvesToAuthoredVisual = (trigger: ButtonAppearanceTrigger) => (
    !authoredVisualStates || authoredVisualStates.has(
      visualStateMap?.[trigger] ?? buttonAppearanceTriggerToVisualState(trigger)
    )
  );
  if (appearance.held && resolvesToAuthoredVisual("held")) return "held";
  if (appearance.pressed && resolvesToAuthoredVisual("pressed")) return "pressed";
  if (appearance.release && resolvesToAuthoredVisual("release")) return "release";
  if (appearance.play && resolvesToAuthoredVisual("play")) return "play";
  if (appearance.hovered && resolvesToAuthoredVisual("hover")) return "hover";
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
  const placementCycleState = getActiveButtonPlacementActivationState(
    options.activationCycle,
    options.activeStateIndex
  );
  if (placementCycleState) {
    const activationStateIndex = clampButtonPlacementActivationStateIndex(
      options.activationCycle,
      options.activeStateIndex
    );
    const placementVisualStateMap = options.visualStateMap?.[placementCycleState.id];
    const activeTrigger = resolvePlacementCycleAppearanceTrigger(
      options.appearance,
      placementVisualStateMap,
      options.authoredVisualStates
    );
    const identityVisualState = activeTrigger === "rest"
      ? placementCycleState.visualState
      : buttonAppearanceTriggerToVisualState(activeTrigger);
    const visualState = activeTrigger === "rest"
      ? identityVisualState
      : placementVisualStateMap?.[activeTrigger] ?? identityVisualState;
    return {
      activationState: placementCycleState,
      activationStateIndex,
      activeTrigger,
      visualState,
      label: placementCycleState.label,
      flags: flagsForSingleVisualState(visualState)
    };
  }

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
