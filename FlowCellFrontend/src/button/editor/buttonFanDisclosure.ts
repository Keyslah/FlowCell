import type {
  ButtonPopoutCloseRule,
  ButtonPopoutOpenRule
} from "../types.js";

export const BUTTON_FAN_EDITOR_HOVER_CLOSE_DELAY_MS = 140;

export interface ButtonFanDisclosureRules {
  openRule: ButtonPopoutOpenRule;
  closeRule: ButtonPopoutCloseRule;
  pinnedDefault: boolean;
}

const DEFAULT_BUTTON_FAN_DISCLOSURE_RULES: ButtonFanDisclosureRules = {
  openRule: "hover",
  closeRule: "hover-out",
  pinnedDefault: false
};

export interface ButtonFanDisclosureState {
  expanded: boolean;
  pinned: boolean;
  suppressHoverUntilLeave: boolean;
}

export type ButtonFanDisclosureAction =
  | { type: "hover-enter" }
  | { type: "hover-leave" }
  | { type: "owner-activate" }
  | { type: "reset" };

export function createInitialButtonFanDisclosureState(
  rules: ButtonFanDisclosureRules = DEFAULT_BUTTON_FAN_DISCLOSURE_RULES
): ButtonFanDisclosureState {
  return {
    expanded: rules.pinnedDefault,
    pinned: rules.pinnedDefault,
    suppressHoverUntilLeave: false
  };
}

export function reduceButtonFanDisclosure(
  state: ButtonFanDisclosureState,
  action: ButtonFanDisclosureAction,
  rules: ButtonFanDisclosureRules = DEFAULT_BUTTON_FAN_DISCLOSURE_RULES
): ButtonFanDisclosureState {
  if (action.type === "reset") {
    return createInitialButtonFanDisclosureState(rules);
  }
  if (action.type === "hover-enter") {
    return rules.openRule !== "hover" || state.suppressHoverUntilLeave || state.expanded
      ? state
      : { ...state, expanded: true };
  }
  if (action.type === "hover-leave") {
    const next = state.suppressHoverUntilLeave
      ? { ...state, suppressHoverUntilLeave: false }
      : state;
    if (next.pinned || rules.closeRule !== "hover-out" || !next.expanded) {
      return next;
    }
    return {
      expanded: false,
      pinned: false,
      suppressHoverUntilLeave: false
    };
  }
  if (state.expanded && state.pinned) {
    return {
      expanded: false,
      pinned: false,
      suppressHoverUntilLeave: true
    };
  }
  return {
    expanded: true,
    pinned: true,
    suppressHoverUntilLeave: false
  };
}
