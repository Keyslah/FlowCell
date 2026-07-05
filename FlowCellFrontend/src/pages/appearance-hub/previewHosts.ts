// Preview context descriptors for the Appearance Hub. Toolsets are
// intentionally absent: exact-SVG toolsets forbid imported-skin sizing, so
// they live under a different geometry contract than this bench.

import type { HubPreviewContext } from "./hubStore";

export type PreviewContextDescriptor = {
  id: HubPreviewContext;
  label: string;
  description: string;
};

export const PREVIEW_CONTEXTS: readonly PreviewContextDescriptor[] = [
  {
    id: "popout",
    label: "Popout",
    description: "Script-group popout row — shared height, label-driven widths."
  },
  {
    id: "fan",
    label: "Fan",
    description: "Panel fan — owner pill plus child pills in the same skin."
  }
];

export const FAN_CHILD_LABELS: readonly string[] = ["Snap", "Orbit", "Weld", "Purge"];
