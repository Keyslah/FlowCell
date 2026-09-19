# Fusion 360

FlowCell installs this managed program package through **Add Program**. Choose
the running Fusion executable, select the bundled sources, review the plan, and
install it. The program bootstrap copies `FlowCellFusionBridge` into Fusion's
user add-in directory; Fusion normally needs one restart after that add-in is
first installed or its core files change. Installed owner actions are reloaded
from their managed copies on each request.

## Align

Select one or more target native root-component bodies or component
occurrences, then select the reference last. Bounds alignment supports minimum,
center, maximum, nearest surface, component origin, XYZ center, and XY center
operations. Body changes are timeline Move features; occurrence changes use
Fusion assembly transforms.

## Rotate

Select native root-component bodies or component occurrences, choose a world X,
Y, or Z axis, choose Geometry, Origin, World, Pick, or Object pivot, then use a
preset or the editable angle with Positive or Negative. Object pivot treats the
last selection as the pivot and rotates the earlier selections. The Fusion
version intentionally offers Transform only; Blender-style distribute/copy
behavior is not exposed.

## Scale

Scale accepts native BRep bodies owned by the active design's root component.
Select the bodies and press **Refresh** to load their aggregate X, Y, and Z
dimensions in the document's current length units. Each dimension is editable.

- **Free Axis** selects the one free scale handle shown in Fusion.
- **Lock Aspect** makes that free axis drive all three dimensions proportionally.
- **X/Y/Z Center, Min, or Max** chooses the plane held fixed on each axis.
- **Scale / Drag** opens the native Fusion command after you edit exact
  dimensions in FlowCell. Drag the visible free-axis handle larger or smaller,
  then press **Enter** to commit or **Esc** to cancel.

Scale creates a native Scale feature and, when a fixed plane needs correction,
a native Move feature. Component-owned bodies and occurrence proxies fail
closed so non-uniform dimensions and pinned planes stay unambiguous. Align,
Rotate, and Scale require **Capture Design History** because they create native,
reversible timeline features.
