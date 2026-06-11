# Illustrator Layers Buttons

Order follows the current local Illustrator Layers panel.

| Button | Description |
| --- | --- |
| `snapshot` | Copies the selected Live target into `Snapshots > [target name] > sN`, hides the saved snapshot entry, keeps Snapshots ordered against Live, and writes its debug log once at the end with step timings. |
| `restore` | Restores a selected source from outside `Live` into `Live`, moving the current Live version into `Trash` first. |
| `back` | Replaces the selected Live target with its newest saved snapshot, moves the current Live content into `Trash`, and removes that snapshot entry so repeated runs step backward. |
| `3D test` | Requires exactly three selected Live layer targets in one branch, saves them into `3D > [branch name] > dN`, runs the 3D test macros, hides the matching Live branch, and leaves the new 3D entry visible. |
| `3D` | Copies selected Live targets into `3D > [target name] > dN`, hides the matching Live target and older 3D versions, and shows the new 3D entry. |
| `trash` | Moves selected eligible Live sublayers or direct Live objects into numbered `Trash > [target name] > TN` entries. |
| `archive` | Stores selected eligible targets in numbered `Archive > [target name] > AN` entries for longer-term storage. |
| `delete sublayer` | Deletes the deepest eligible selected sublayer; if a selected item is directly under `Live`, deletes that item instead, then removes emptied ancestors. |
| `new sub` | Prompts for a name and creates a visible, unlocked child layer under the selected object's layer or the active layer. |
| `flatten top sub` | Moves selected resolved sublayer contents into the topmost selected real sublayer and removes emptied source layers. |
| `Add to Live` | Duplicates selected artwork from outside `Live` back into `Live`, deriving the target layer name from the source target and version. |
| `copy live` | Prompts for a new Live sublayer name, duplicates the selected artwork into it, preserves source sublayer paths where possible, and hides source layers. |
| `b lock` | Saves the current locked/unlocked state of every layer for the active document as the lock baseline. |
| `set vis` | Restores layer visibility from the saved visibility baseline for the active document. |
| `b vis` | Saves the current visible/hidden state of every layer for the active document as the visibility baseline. |
| `set lock` | Restores layer lock state from the saved lock baseline, briefly unlocking layers so states can be reapplied. |
| `make layers` | Ensures top-level `Live`, `Snapshots`, `3D`, `Trash`, and `Archive` layers exist and are ordered `Live`, `Snapshots`, `3D`, `Trash`, `Archive`; hides and locks `Trash` and `Archive`. |
| `Sort` | Builds the standard root structure and routes top-level source layers: visible layers to `Live`, hidden copies with a Live family match to `Snapshots`, and everything else to `Trash`. |
| `empty sublayers` | Recursively removes empty child layers from the document and reports how many were deleted. |
| `empty trash` | Deletes everything inside the top-level `Trash` layer while leaving the `Trash` root layer in place. |
