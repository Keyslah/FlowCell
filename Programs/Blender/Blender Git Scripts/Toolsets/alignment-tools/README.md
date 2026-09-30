# Align behavior contract

These are intentional user-requested behaviors. Preserve them when updating, importing, or deploying this package.

- Three axis rows: `X Min | Center | X Max | Surface | Origin`, then Y, then Z. Only Min and Max repeat the axis name.
- Bottom row: `All | X-Y | Group`, with equal widths and heights across the full toolset width.
- Min and Max are separate, fixed actions. Center aligns bounding-box centers on its axis. All centers XYZ; X-Y preserves Z.
- Hold Alt with Center, All, or X-Y to move whole objects by their origins to the active object's origin on the requested axes. Origins remain fixed relative to each object's geometry. With Group on, move the combined bounding-box center to the active object's origin instead, preserving relative positions and excluding the fixed active object from the group. Alt also combines with Shift/world and Control/cursor anchors; those anchors still move the entire selection.
- Surface is an immediate action. Each click moves the selected objects to the opposite outside Min/Max face of the anchor bounding box using their outer bounds. Repeated clicks alternate sides. It never latches or disables another button.
- Origin is an immediate action. Each click moves the selected objects' origins to the opposite Min/Max face of the anchor bounding box. Repeated clicks alternate sides. It ALWAYS uses object origins, never toggles to geometry bounds, and never acts as an on/off modifier.
- Surface and Origin differ only in the source point: outer bounds versus object origins. Their target is the same anchor Min/Max bounding box.
- Default anchor: active object, which stays fixed; move the other selected objects.
- Shift anchor: world origin. Control anchor: 3D cursor. Both move the ENTIRE selection, including the active object, and support a single selected object. Control takes precedence if both are held.
- Group alone is a persistent toggle. Move selected objects by one shared translation using combined bounds/center, preserving relative positions. With the active-object anchor, the anchor is excluded from the moving group.
- Keep existing imported skins and unrelated saved Button state during deployment. Update the taskbar-installed copy and the running Blender version's managed action, not only the catalog.

## Regression checks

With Smart Axis Live enabled and a stored baseline, Align stretches on armed axes about the fixed side instead of translating. The chosen center, side or origin reaches its usual target. Unarmed axes retain translation. Signed scaling contracts through exactly zero and extends the same object across the baseline; Min/Max retain their original material-side identity, and later Live scaling preserves that pinned side. Setting Base starts a new side reference.

Surface checks both opposing surface alignments. If the preferred one would move the locked side, it performs the reachable alignment using the free side instead. Its result explains which side is locked, its fixed coordinate, and the target it cannot reach. Repeated clicks continue to use a reachable surface; Live off and unarmed axes retain ordinary alternating Surface behavior.

A fixed source point cannot be aligned to a different position. Conflicting grouped baselines, missing grouped baselines, and transforms requiring shear or unsupported parenting/constraints produce a Smart Axis conflict message before any object changes. A group with one shared baseline stretches as one selection. Rotation, mesh data and modifiers are preserved; world-axis stretching that would require shear must first have its rotation applied or Live disabled.

`Programs/Blender/tests/blender_smart_axis_align_probe.py` covers compatible translation, pending scale/status/reselection, signed stretch and zero recovery, and Undo/Redo with Live ticks in a disposable Blender process. It accepts addon, Align and Smart Axis installed paths after `--`.

`Programs/Blender/tests/blender_alignment_probe.py` runs in an isolated factory-startup Blender process. Pass an installed managed action after `--` to test the deployed copy with the same suite. Tests include off-center geometry so origin-versus-bounds mistakes cannot pass unnoticed.

`FlowCellFrontend/tests/toolsetRuntimeState.test.mjs` checks the shipped manifest layout and verifies Surface and Origin execute on every click without becoming selected, changing field state, or disabling buttons. The Rust clean-import test verifies the package can be imported intact.
