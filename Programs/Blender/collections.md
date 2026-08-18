# Blender Collections

| Button | Description |
| --- | --- |
| `New Collection` | Prompts for a collection name, creates a visible child collection near the first selected object, and falls back to `Collection` at the scene root when no name or selection is available. |
| `Snapshot` | Copies selected objects from any collection into `Snapshots` as versioned `s#` duplicates, creating the FlowCell root collections and per-object snapshot bucket when needed while leaving originals in place. |
| `Restore` | Restores only selections that come entirely from `Snapshots`, `Trash`, or `Archive`; any Live or unrelated selection cancels without changing Blender data. The panel action runs inside one Blender undo step without reloading the live bridge. |
| `Empty Collections` | Removes empty non-system child collections while keeping the FlowCell roots: `Live`, `Snapshots`, `Trash`, and `Archive`. |
| `Cycle Collection` | Hovering captures a Cycle-only baseline without changing visibility or touching the manual baseline. Pressing shows and selects the next direct object in the selected object's deepest collection; releasing restores the captured object, collection, and view-layer visibility, and leaving clears the private hover snapshot. |
| `Baseline Visibility` | Records every object currently visible in the active view layer as the scene's FlowCell visibility baseline. |
| `Restore Visibility` | Hides all objects in the active view layer, then reveals only the saved baseline objects that still exist. |
