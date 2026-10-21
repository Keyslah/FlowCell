# Fusion 360

FlowCell installs this managed program package through **Add Program**. Choose
the running Fusion executable, select the bundled sources, review the plan, and
install it. The program bootstrap copies `FlowCellFusionBridge` into Fusion's
user add-in directory; Fusion normally needs one restart after that add-in is
first installed or its core files change. Installed owner actions are reloaded
from their managed copies on each request.

All three tools work on root-component bodies, bodies inside components, and
(Align/Rotate) whole components, and they require **Capture Design History** so
every change is a reversible timeline feature. Moving or rotating a component
releases it from **Ground to Parent** and captures its position, because Fusion
otherwise snaps uncaptured component moves back on the next recompute.

## Align

Works like the Blender Align tool set. Select the bodies/components to move,
then the reference last. Clicking faces works too: a selected face, edge, or
vertex stands for its whole body, so click a face on each object to move and
a face on the reference last. The selection stays as clicked, so you can press
several buttons in a row.

- Rows `X Min | Center | X Max | Surface | Origin`, then Y, then Z.
- **Surface** moves the selection flush against the opposite outside face of
  the reference; every click alternates Min/Max.
- **Origin** moves each component origin (a body's center, since bodies have no
  origin) to the opposite Min/Max reference face; every click alternates.
- **All** centers X, Y, and Z; **X-Y** leaves Z alone.
- **Group** (toggle) moves the selection together using its combined bounds.
- **Shift** aligns to the world origin and moves the whole selection.
- **Alt** with Center, All, or X-Y aligns component origins instead of bounds.

## Rotate

Choose a world X, Y, or Z axis and a pivot: Geometry, Origin, World, Pick (the
point where you clicked the last selection), or Object (the last selection's
origin; the earlier selections rotate).

- **Transform** rotates the selection by the presets or the typed angle with
  Positive or Negative.
- **Distribute** keeps the selection and adds evenly spaced copies around the
  pivot; the value is the total count. Bodies are copied with Copy/Paste Body;
  components get new instances of the same component.

## Scale

Select bodies, then:

- Drag the **X**, **Y**, or **Z** slider to scale live. Each drag is one scale
  step (one Scale feature plus one Move feature that keeps the pinned side
  still); the slider returns to 100% when you let go.
- **Link** moves all three sliders together for uniform scaling.
- Type an exact **Size** (document units) and press Enter to resize. With Link
  on, editing one size keeps the proportions.
- **X/Y/Z Center, Min, Max** choose which side stays fixed on each axis.
- **Refresh** reads the selection's sizes.

Scale works along world axes, so it skips bodies in rotated components.
