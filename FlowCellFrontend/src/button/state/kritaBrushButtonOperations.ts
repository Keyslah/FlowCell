import type { ButtonStateDocument } from "../types.js";

export interface SavedBrush {
  id: string;
  revision: string;
  label: string;
  sourcePath: string;
}

export function applySavedBrushLabels(document: ButtonStateDocument, brush: SavedBrush): void {
  for (const button of Object.values(document.buttons)) {
    if (button.metadata.kritaBrushId !== brush.id) continue;
    if (!button.metadata.kritaBrushLabel || button.label === button.metadata.kritaBrushLabel) {
      button.label = brush.label;
    }
    button.metadata.kritaBrushLabel = brush.label;
    button.metadata.kritaBrushRevision = brush.revision;
  }
}

