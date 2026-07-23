import type { ButtonPlacementActivationCycle } from "../types.js";

export function buttonActivationCycleStructureMatches(
  committed: ButtonPlacementActivationCycle | null,
  draft: ButtonPlacementActivationCycle | null
): boolean {
  if (!committed || !draft) return committed === draft;
  if (committed.states.length !== draft.states.length) return false;
  return draft.states.every((state, index) => state.id === committed.states[index]?.id);
}
