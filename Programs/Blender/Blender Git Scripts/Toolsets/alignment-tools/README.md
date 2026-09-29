# Align behavior contract

These are intentional user-requested behaviors. Preserve them when updating, importing, or deploying this package.

- Three axis rows: `X Min | Center | X Max | Surface | Origin`, then Y, then Z. Only Min and Max repeat the axis name.
- Bottom row: `All | X-Y | Group`, with equal widths and heights across the full toolset width.
- Min and Max are separate, fixed actions. Center aligns bounding-box centers on its axis. All centers XYZ; X-Y preserves Z.
- Surface is an immediate action. Each click moves the selected objects to the opposite outside Min/Max face of the anchor bounding box using their outer bounds. Repeated clicks alternate sides. It never latches or disables another button.
- Origin is an immediate action. Each click moves the selected objects' origins to the opposite Min/Max face of the anchor bounding box. Repeated clicks alternate sides. It ALWAYS uses object origins, never toggles to geometry bounds, and never acts as an on/off modifier.
- Surface and Origin differ only in the source point: outer bounds versus object origins. Their target is the same anchor Min/Max bounding box.
- Default anchor: active object, which stays fixed; move the other selected objects.
- Shift anchor: world origin. Control anchor: 3D cursor. Both move the ENTIRE selection, including the active object, and support a single selected object. Control takes precedence if both are held.
- Group alone is a persistent toggle. Move selected objects by one shared translation using combined bounds/center, preserving relative positions. With the active-object anchor, the anchor is excluded from the moving group.
- Keep existing imported skins and unrelated saved Button state during deployment. Update the taskbar-installed copy and the running Blender version's managed action, not only the catalog.

## Regression checks

`Programs/Blender/tests/blender_alignment_probe.py` runs in an isolated factory-startup Blender process. Pass an installed managed action after `--` to test the deployed copy with the same suite. Tests include off-center geometry so origin-versus-bounds mistakes cannot pass unnoticed.

`FlowCellFrontend/tests/toolsetRuntimeState.test.mjs` checks the shipped manifest layout and verifies Surface and Origin execute on every click without becoming selected, changing field state, or disabling buttons. The Rust clean-import test verifies the package can be imported intact.
