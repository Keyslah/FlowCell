# Blender Collections

| Button | Description |
| --- | --- |
| `New Collection` | Prompts for a collection name, creates a visible child collection near the first selected object, and falls back to `Collection` at the scene root when no name or selection is available. |
| `Empty Collections` | Removes empty non-system child collections while keeping the FlowCell roots: `Live`, `Snapshots`, `Trash`, and `Archive`. |
| `Cycle Collection` | Uses the selected object's deepest collection, shows one direct object in that collection at a time, and selects the object that is currently visible. |
| `Baseline Visibility` | Records every object currently visible in the active view layer as the scene's FlowCell visibility baseline. |
| `Restore Visibility` | Hides all objects in the active view layer, then reveals only the saved baseline objects that still exist. |
