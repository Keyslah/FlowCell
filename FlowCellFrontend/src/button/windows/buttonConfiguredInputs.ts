import type { ButtonStateDocument } from "../types.js";

/** Configured Button inputs remain shared even in a transient Pop/Fan draft. */
export function withCanonicalButtonInputs(
  draft: ButtonStateDocument,
  canonical: ButtonStateDocument | null
): ButtonStateDocument {
  if (!canonical) return draft;
  let buttons = draft.buttons;
  let placements = draft.placements;
  for (const [id, saved] of Object.entries(canonical.buttons)) {
    const current = draft.buttons[id];
    const inputs = saved.metadata.buttonInputs;
    const inputsRevision = saved.metadata.buttonInputsRevision;
    if (!current || !inputs || typeof inputs !== "object" || Array.isArray(inputs)) continue;
    // Ordinary canonical commits must not overwrite an editor's unsaved text.
    // Only a completed input dialog or legacy setup migration advances this marker.
    const currentInputsRevision = current.metadata.buttonInputsRevision;
    if (typeof inputsRevision !== "number" ||
      (typeof currentInputsRevision === "number" && inputsRevision <= currentInputsRevision)) continue;
    if (buttons === draft.buttons) buttons = { ...buttons };
    buttons[id] = { ...current, label: saved.label, tooltip: saved.tooltip,
      metadata: { ...current.metadata, buttonInputs: inputs, buttonInputsRevision: inputsRevision } };
    for (const [placementId, placement] of Object.entries(draft.placements)) {
      const override = placement.presentationOverride;
      if (placement.buttonId !== id || !override) continue;
      const label = override.label === current.label ? saved.label : override.label;
      const tooltip = override.tooltip === current.tooltip ? saved.tooltip : override.tooltip;
      if (label === override.label && tooltip === override.tooltip) continue;
      if (placements === draft.placements) placements = { ...placements };
      placements[placementId] = { ...placement, presentationOverride: { ...override,
        ...(label === undefined ? {} : { label }), ...(tooltip === undefined ? {} : { tooltip }) } };
    }
  }
  return buttons === draft.buttons ? draft : { ...draft, buttons, placements };
}
