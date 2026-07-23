export type ButtonVisualMotionKind = "none" | "finite" | "infinite";

export interface ButtonVisualIntent<T> {
  key: string;
  value: T;
  commitBeforeSupersede?: boolean;
}

export interface ButtonVisualPresentation<T> {
  id: number;
  intent: ButtonVisualIntent<T>;
}

export interface ButtonVisualLatchState<T> {
  presentation: ButtonVisualPresentation<T>;
  desired: ButtonVisualIntent<T>;
  motion: null | {
    presentationId: number;
    phase: "preparing" | "probing" | "finite";
  };
  nextPresentationId: number;
}

function presentButtonVisualIntent<T>(
  state: ButtonVisualLatchState<T>,
  intent: ButtonVisualIntent<T>
): ButtonVisualLatchState<T> {
  const presentation = { id: state.nextPresentationId, intent };
  return {
    ...state,
    presentation,
    motion: { presentationId: presentation.id, phase: "preparing" },
    nextPresentationId: state.nextPresentationId + 1
  };
}

function presentLatestDesiredButtonVisual<T>(
  state: ButtonVisualLatchState<T>
): ButtonVisualLatchState<T> {
  const idle = { ...state, motion: null };
  return idle.desired.key === idle.presentation.intent.key
    ? idle
    : presentButtonVisualIntent(idle, idle.desired);
}

export function createButtonVisualLatch<T>(
  initial: ButtonVisualIntent<T>
): ButtonVisualLatchState<T> {
  const presentation = { id: 1, intent: initial };
  return {
    presentation,
    desired: initial,
    motion: { presentationId: presentation.id, phase: "probing" },
    nextPresentationId: 2
  };
}

export function resetButtonVisualLatch<T>(
  state: ButtonVisualLatchState<T>,
  desired: ButtonVisualIntent<T>
): ButtonVisualLatchState<T> {
  return presentButtonVisualIntent({ ...state, desired, motion: null }, desired);
}

export function requestButtonVisual<T>(
  state: ButtonVisualLatchState<T>,
  desired: ButtonVisualIntent<T>
): ButtonVisualLatchState<T> {
  const next = { ...state, desired };
  if (next.motion?.phase === "preparing") {
    return (
      next.presentation.intent.key === desired.key ||
      next.presentation.intent.commitBeforeSupersede
    )
      ? next
      : presentButtonVisualIntent(next, desired);
  }
  if (next.motion || next.presentation.intent.key === desired.key) return next;
  return presentButtonVisualIntent(next, desired);
}

export function commitPreparedButtonVisual<T>(
  state: ButtonVisualLatchState<T>,
  presentationId: number
): ButtonVisualLatchState<T> {
  if (
    state.presentation.id !== presentationId ||
    state.motion?.presentationId !== presentationId ||
    state.motion.phase !== "preparing"
  ) return state;
  return {
    ...state,
    motion: { presentationId, phase: "probing" }
  };
}

export function settleButtonVisualMotionProbe<T>(
  state: ButtonVisualLatchState<T>,
  presentationId: number,
  kind: ButtonVisualMotionKind
): ButtonVisualLatchState<T> {
  if (
    state.presentation.id !== presentationId ||
    state.motion?.presentationId !== presentationId ||
    state.motion.phase !== "probing"
  ) return state;
  if (kind === "finite") {
    return {
      ...state,
      motion: { presentationId, phase: "finite" }
    };
  }
  return presentLatestDesiredButtonVisual(state);
}

export function finishButtonVisualMotion<T>(
  state: ButtonVisualLatchState<T>,
  presentationId: number
): ButtonVisualLatchState<T> {
  if (
    state.presentation.id !== presentationId ||
    state.motion?.presentationId !== presentationId ||
    state.motion.phase !== "finite"
  ) return state;
  return presentLatestDesiredButtonVisual(state);
}

export function buttonVisualMotionBlocksStateChange(args: {
  pending: boolean;
  playState: string;
  endTime: unknown;
}): boolean {
  if (!args.pending && args.playState !== "running") return false;
  return !(typeof args.endTime === "number" && !Number.isFinite(args.endTime));
}
