import type { ButtonPlacement, ButtonRecord, ButtonStateDocument } from "../types.js";

export const BUTTON_PRESENTATION_OVERRIDE_KEYS = [
  "label", "tooltip", "defaultTextFitMode", "activationAnimation", "activationBehavior"
] as const;

export function resolveButtonPlacementPresentation(button: ButtonRecord, placement?: ButtonPlacement | null): ButtonRecord {
  return placement?.presentationOverride ? { ...button, ...placement.presentationOverride } : button;
}

/** Existing unscoped Buttons retain their usual shared editor behavior. */
export function editButtonPlacementPresentation(
  document: ButtonStateDocument, placementId: string,
  patch: NonNullable<ButtonPlacement["presentationOverride"]>
): void {
  const placement = document.placements[placementId];
  if (!placement || !document.buttons[placement.buttonId]) throw new Error("The selected Button occurrence no longer exists.");
  if (placement.presentationOverride) Object.assign(placement.presentationOverride, structuredClone(patch));
  else Object.assign(document.buttons[placement.buttonId], structuredClone(patch));
}
