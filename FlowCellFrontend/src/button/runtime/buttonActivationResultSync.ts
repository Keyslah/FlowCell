import type {
  ButtonPlacementActivationCycle,
  ButtonStateDocument
} from "../types.js";
import { resolveButtonPlacementActivationStateIndexFromResponse } from "./buttonActivationState.js";

export interface ButtonActivationResultAssignment {
  activationKey: string;
  stateCount: number;
  index: number;
}

export function buttonPlacementActivationCycleUsesResultMatches(
  cycle: ButtonPlacementActivationCycle | null | undefined
): boolean {
  return Boolean(cycle?.states.some((state) => (state.resultMatches?.length ?? 0) > 0));
}

export function resolveButtonActivationResultAssignments(
  document: ButtonStateDocument,
  placementIds: readonly string[],
  response: unknown
): ButtonActivationResultAssignment[] {
  const assignments: ButtonActivationResultAssignment[] = [];
  for (const placementId of placementIds) {
    const placement = document.placements[placementId];
    const cycle = placement?.activationCycle;
    if (!placement || !buttonPlacementActivationCycleUsesResultMatches(cycle)) continue;
    const index = resolveButtonPlacementActivationStateIndexFromResponse(cycle, response);
    if (index === null) continue;
    assignments.push({
      activationKey: placement.id,
      stateCount: cycle!.states.length,
      index
    });
  }
  return assignments;
}
