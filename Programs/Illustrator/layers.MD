# Illustrator Layers Buttons

 The Adobe illustrator layers panel is not exposed to scripting. The work around is to select objects from a sub layer.

| Button | Description |
| --- | --- |
| `make layers` | Ensures `Live`, `Snapshots`, `3D`, `Trash`, and `Archive` layers exist. |
| `Sort` |  visible layers to `Live`, hidden copies with a Live family match to `Snapshots`, and everything else to `Trash`, while preserving locked folder states under `Live`. |
| `snapshot` | Copies the selected objects whole sublayer into `Snapshots > [target name] > sN`, hides the snapshot. |
| `restore` | Restores a selected objects whole sublayer from outside `Live` into `Live`, moving the current Live version into `Trash` first. |
| `back` | Replaces the selected objects whole sublayer with its newest snapshot, moves the current Live content into `Trash`, removes that snapshot entry so repeated runs step backward, and leaves the restored Live layer active with its artwork selected. |
| `3D` | Copies selected Live targets into `3D > [target name] > dN`, hides the matching Live target and older 3D versions, and shows the new 3D entry. |
| `trash` | Moves each selected object's immediate owning layer from any non-Trash root, or direct root-level selected objects, into numbered `Trash > [target name] > TN` entries; versioned roots such as `Snapshots > name > s3` use the version prefix plus owner name, like `s3name`, for the Trash family. |
| `archive` | Stores selected eligible targets in numbered `Archive > [target name] > AN` entries for longer-term storage. |
| `delete sublayer` | Deletes the selected object's immediate owning layer only; if the item is directly under protected roots like `Live` or `Snapshots`, deletes only the item instead. |
| `new sub` | Prompts for a name and creates a visible, unlocked child layer under the selected object's layer or the active layer. |
| `flatten top sub` | Moves selected resolved sublayer contents into the topmost selected real sublayer and removes emptied source layers. |
| `Add to Live` | Duplicates selected artwork from outside `Live` back into `Live`, deriving the target layer name from the source target and version. |
| `copy live` | Prompts for a new Live sublayer name, duplicates the selected artwork into it, preserves source sublayer paths where possible, and hides source layers. |
| `b lock` | Saves the current locked/unlocked state of every layer for the active document as the lock baseline and writes a temp debug log with the saved entry count. |
| `set vis` | Restores layer visibility from the saved visibility baseline for the active document. |
| `b vis` | Saves the current visible/hidden state of every layer for the active document as the visibility baseline. |
| `set lock` | Restores layer lock state from the saved lock baseline, briefly unlocking layers so states can be reapplied, verifies whether each lock write stuck, redraws Illustrator, and writes a temp debug log. |
| `empty sublayers` | Recursively removes empty child layers from the document and reports how many were deleted. |
| `empty trash` | Deletes everything inside the top-level `Trash` layer while leaving the `Trash` root layer in place. |

## Layers Builder panel (highlight-driven)

`Layers Builder` is a separate panel that mirrors every button above but routes each one through FlowCell's highlight bridge so it operates on the **FlowCell-highlighted** layers (which may be locked or hidden) instead of only `app.selection`. The original `Layers` panel is left untouched as a fallback.

- `Build Layers` opens the Layers Builder window: a live layer/sublayer tree where you highlight target rows (locked/hidden allowed), toggle lock/visibility, and create/rename/delete/duplicate layers. Highlight state is owned by FlowCell, not Illustrator's native panel, and is saved to `FlowCell/local/illustrator-layers-highlight.json`. The tree auto-refreshes after FlowCell operations; use Refresh for changes made directly in Illustrator.
- Every other button is a self-contained `.jsx` copy of the matching original `Layers` script, prefixed with a prelude that reads the highlight set, selects the highlighted layers' artwork (temporarily unlocking/unhiding as needed), runs the original script body, then restores lock/visibility in a `finally` block. (Illustrator panels only run `.jsx`/`.js`, so the buttons are JSX rather than wrappers.)

Regenerate the panel after changing the original `Layers` panel:

```powershell
Programs\Illustrator\SupportScripts\New-IllustratorLayersBuilderPanel.ps1
```
