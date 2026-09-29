# Blender Collections

| Button | Description |
| --- | --- |
| `Make Collections` | Creates the four system roots, moves other scene-root collections under `Live` with their hierarchy intact, and moves loose scene-root objects into `Live`. Includes hidden content; existing `Snapshots`, `Trash`, and `Archive` remain in place. The internal `make_layers` action stays compatible with installed Buttons. |
| `New Collection` | Prompts for a collection name, creates a visible child collection near the first selected object, and falls back to `Collection` at the scene root when no name or selection is available. |
| `Snapshot` | Copies selected objects from any collection into `Snapshots` as versioned `s#` duplicates, creating the FlowCell root collections and per-object snapshot bucket when needed while leaving originals in place. |
| `Restore` | Copies selected stored versions back to their recorded source collections and moves the current original, wherever it is in the scene, into `Trash`. Only selections entirely from `Snapshots`, `Trash`, or `Archive` are accepted. Legacy versions use the current original's collections, falling back to `Live` when no origin remains. |
| `Back` | Moves the current original to `Trash`, restores the newest snapshot to its recorded source collections, and consumes that snapshot. |
| `Cycle Versions` | Cycles the original anywhere in the scene and its snapshots, selecting and revealing one version at a time. Supports either direction, starting from the original or a snapshot. |
| `Empty Collections` | Removes empty non-system child collections while keeping the FlowCell roots: `Live`, `Snapshots`, `Trash`, and `Archive`. |
| `Cycle Collection` | Hovering captures a Cycle-only baseline without changing visibility or touching the manual baseline. Pressing shows and selects the next direct object in the selected object's deepest collection; releasing restores the captured object, collection, and view-layer visibility, and leaving clears the private hover snapshot. |
| `Baseline Visibility` | Records every object currently visible in the active view layer as the scene's FlowCell visibility baseline. |
| `Restore Visibility` | Hides all objects in the active view layer, then reveals only the saved baseline objects that still exist. |

Snapshots, Trash, and Archive retain collection references across collection renames and file saves, including multiple memberships and the scene root. Automatic empty-collection cleanup preserves referenced homes. Add to Live remains an explicit copy into Live and records Live as the new copy's home.
