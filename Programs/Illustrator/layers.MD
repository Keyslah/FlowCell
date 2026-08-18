# Illustrator Layers Buttons

 The Adobe illustrator layers panel is not exposed to scripting. The work around is to select objects from a sub layer.

| Button | Description |
| --- | --- |
| `make layers` | Ensures `Live`, `Snapshots`, `3D`, `Trash`, and `Archive` layers exist. |
| `Sort` | Moves invisible direct sublayers of `Live` to `Trash`, then routes visible non-system top-level layers to `Live`, hidden family copies to `Snapshots`, and other hidden layers to `Trash`, while preserving and ordering the five system roots. |
| `snapshot` | Copies each Layer Tree-highlighted target, or the currently selected Illustrator artwork when no tree row is highlighted, into `Snapshots > [target name] > sN` and hides the snapshot. |
| `restore` | Restores each highlighted saved version from outside `Live`, moving the current Live version into `Trash` first. |
| `back` | Replaces each highlighted Live target with its newest snapshot, moves the current Live content into `Trash`, and consumes that snapshot so repeated runs step backward. |
| `3D` | Copies the Live sublayer represented by selected Illustrator artwork into `3D > [target name] > dN` (falling back to highlighted Layer Tree targets when there is no eligible artwork selection), hides older 3D versions, and makes only the top-level `Live` root invisible. Every Live descendant visibility and lock state remains intact. |
| `trash` | Moves highlighted eligible layers into numbered `Trash > [target name] > TN` entries while preserving version-family naming. |
| `archive` | Moves highlighted eligible layers into numbered `Archive > [target name] > AN` entries for longer-term storage. |
| `delete sublayer` | Deletes highlighted real sublayers, including empty/locked/hidden layers, while protecting the five system roots and everything under `Trash` or `Archive`. |
| `new sub` | Prompts for a name and creates a visible, unlocked direct child under exactly one highlighted Layer Tree layer. |
| `flatten top sub` | Moves artwork from highlighted layers into the topmost highlighted real sublayer and removes emptied source layers. |
| `Add to Live` | Duplicates artwork from highlighted non-Live layers back into `Live`, deriving names from the source target and version. |
| `copy live` | Prompts for a new Live sublayer name, duplicates artwork from highlighted layers into it, preserves source sublayer paths where possible, and hides source layers. |
| `b lock` | Saves the current locked/unlocked state of every layer for the active document as the lock baseline and writes a temp debug log with the saved entry count. |
| `set vis` | Restores layer visibility from the saved visibility baseline for the active document. |
| `b vis` | Saves the current visible/hidden state of every layer for the active document as the visibility baseline. |
| `set lock` | Restores layer lock state from the saved lock baseline, briefly unlocking layers so states can be reapplied, verifies whether each lock write stuck, redraws Illustrator, and writes a temp debug log. |
| `empty sublayers` | Recursively removes empty child layers from the document and reports how many were deleted. |
| `empty trash` | After confirmation, deletes everything inside the top-level `Trash` layer while leaving the `Trash` root layer in place. |

## Layers Builder panel

`Layer Tree` row clicks make the matching layer native-active in Illustrator through `doc.activeLayer`, preserving the existing artwork selection and creating no temporary document object. The separate target controls remain the explicit artwork-selection path.

`Layers Builder` is a separate 19-Button panel. Eight actions are document-global: `make layers`, `Sort`, `b lock`, `b vis`, `set lock`, `set vis`, `empty sublayers`, and `empty trash`. They never require a Layer Tree highlight. Nine targeted actions resolve exact **FlowCell-highlighted** layers directly instead of manufacturing an Illustrator artwork selection. `snapshot` may use Illustrator's current artwork selection when its validated Layer Tree owner has no highlighted row. `3D` instead prefers eligible selected Illustrator artwork, even when a row is highlighted, and consults the Layer Tree only as a fallback. The original `Layers` panel is left untouched.

- Import `Illustrator Git Scripts/LayersBuilder/flowcell.script.json` to create the `Layer Tree` Button. That ordinary page-enabled package owns the sandboxed tree UI, styles, configuration, action declarations, and `layers.jsx` handler. The page highlights target rows (locked/hidden allowed), toggles lock/visibility, prompts for a name before creating either a root or child layer, and creates, renames, deletes, duplicates, or pointer-drag-moves layers into another row through its installed Local Scripts copy and declared `illustrator-layer-tree` capability. Row-body pointer dragging remains layer reparenting. A separate square beside each row's target ring selects that row's artwork when clicked and, without requiring a prior Illustrator selection, pointer-drags that row's artwork: a normal drop moves it into the destination layer, while holding Alt at drop time copies it. The flattened result preserves the source's mixed artwork/sublayer visual order; after a drop, only results whose restored item and layer state remains visible and unlocked are selected. These in-page pointer gestures preserve the installed-page native/file drag-drop barrier. Duplicate, Delete, and Force Delete prefer the distinct layers or sublayers containing Illustrator's currently selected objects, even when no tree row is highlighted, and fall back to highlighted rows only when Illustrator has no object selection. Duplicate recursively copies each resolved layer's complete subtree while preserving its visibility and lock state; each copied root takes the next compact trailing-number name (`name1`, `name2`) instead of a `copy` suffix. Delete and Force Delete remove each complete resolved subtree. Force Delete runs immediately without confirmation and can open locked or hidden ancestors, while ordinary Delete refuses them. Highlight and expansion state is stored in the installed Button owner's `runtime/` folder and is removed with that Button. Program invalidation preserves that highlight until the queued Illustrator action has resolved it, then the tree refreshes, but only sources from the Illustrator `Layers Builder` panel are eligible; Toolset actions such as Rotate and Ill Align are ignored. Use Refresh for changes made directly in Illustrator.
- The 19 Buttons remain independent ordinary script packages under `Illustrator Git Scripts/Layers Builder/`. Each package carries its own `flowcell.script.json` and JSX source. The eleven targeted packages use the resolver to find exactly one generic `illustrator.layer-tree` installed-page owner, verify its Button-owned Local Scripts boundary and package manifest, then read `runtime/installed-page-state.json` using `flowcell.illustrator.layer-tree-state.v1`.
- Nine targeted actions fail closed when the Layer Tree owner is missing, duplicated, invalid, contains stale keys, or has no highlighted row. `snapshot` may use a nonempty native Illustrator selection only when its validated owner has no highlighted row. `3D` uses eligible native artwork first without depending on Layer Tree state, then applies the ordinary owner/highlight validation only for fallback. The eight global actions remain usable without a Layer Tree owner or highlighted row. None of these actions reads or mirrors selection through a global temporary file.

The tracked `Layers Builder` packages are catalog sources. Importing one copies
the complete package into an independent Button-owned Local Scripts owner; no
support script writes a pre-baked panel or regenerates active Buttons.
