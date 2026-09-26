# Ill SVG

Select vector artwork in the already-open Illustrator document, open a document
in the separate Krita Stencil Assistants preview, then click **Ill SVG** in
FlowCell's Krita Tools panel. This package does not start either application.

Selected paths, compound paths and unclipped groups are grouped by their nearest
owning Illustrator layer, in document layer order from top to bottom. All SVGs
share one selection-bounds viewport in physical points. Bézier handles and
compound-path fill rules are retained. The import requests centering of the
whole batch by translation, with no automatic resizing. Native Krita creates one
group and Assistant owner per exported layer; its Assistant constrains paint
below that row inside its own group.

The exporter only reads Illustrator's DOM. It does not change selection,
coordinates, layers, artwork, document files or application preferences. It
retains generated batches beneath the preview's `flowcell-bridge/batches`
directory and submits only the fixed `status` and `import_layers` actions.
The script requires Windows PowerShell 5.1 and a live `KritaStencilPreview`
process with the correct ready session and native batch-import capability.

Raster/placed artwork, text, symbols, meshes, clipped groups and clipping paths
are rejected explicitly. Paint appearance is not stencil geometry. A reported
Illustrator `scaleFactor` other than 1 is rejected because its exact physical
conversion has not been verified. A batch supports at most 128 owning layers.
Native SVG size/complexity limits still apply;
errors name the affected layer. A timed-out request is never retried automatically.

Run mocked-DOM regressions with `node --test tests/export-selection.test.cjs`.
These tests exercise the actual serializer with read-only fixture objects; they
do not certify the live Illustrator COM connection or Krita runtime import.
