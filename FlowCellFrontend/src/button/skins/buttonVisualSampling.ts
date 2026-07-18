import type { ButtonVisualState } from "../types.js";

export const BUTTON_VISUAL_SETTLE_FRAMES = 2;

export interface ButtonVisualSamplingDecision {
  continueSampling: boolean;
  settleFramesRemaining: number;
}

export function buttonVisualStateNeedsActiveSampling(state: ButtonVisualState): boolean {
  return Boolean(state.hovered || state.pressed || state.held || state.play);
}

export function resolveButtonVisualSamplingDecision(args: {
  state: ButtonVisualState;
  animationInspectionAvailable: boolean;
  hasRunningAnimations: boolean;
  settleFramesRemaining: number;
}): ButtonVisualSamplingDecision {
  if (!buttonVisualStateNeedsActiveSampling(args.state)) {
    return { continueSampling: false, settleFramesRemaining: 0 };
  }
  if (!args.animationInspectionAvailable) {
    return {
      continueSampling: true,
      settleFramesRemaining: BUTTON_VISUAL_SETTLE_FRAMES
    };
  }
  if (args.hasRunningAnimations) {
    return {
      continueSampling: true,
      settleFramesRemaining: BUTTON_VISUAL_SETTLE_FRAMES
    };
  }
  if (args.settleFramesRemaining > 0) {
    return {
      continueSampling: true,
      settleFramesRemaining: args.settleFramesRemaining - 1
    };
  }
  return { continueSampling: false, settleFramesRemaining: 0 };
}
