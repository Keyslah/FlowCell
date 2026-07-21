# Illustrator Program Package

Illustrator uses the canonical FlowCell Button lifecycle.

- `Illustrator Git Scripts/` is a tracked catalog only.
- Add/import copies the selected script or complete tool-set package into
  `Illustrator Local Scripts/<ownerButtonId>/source/`.
- The Button-owned Local Scripts copy is the installed runtime source of truth.
- `Panels/<Panel>/<ownerButtonId>.flowcell-source.json` is the active record.
- Deleting the Button removes its canonical graph, active record, owned Local
  package, and bindings through the normal transactional delete path.

Tool sets are self-contained packages under `Illustrator Git Scripts/Toolsets/`
with `flowcell.toolset.json` plus their JSX source. There are no generated
button wrappers or program-level pre-baked Button entries.

## Illustrator bridge

The Illustrator bridge has no program-level action or Button registry. The
Layer Tree is the explicit catalog package at
`Illustrator Git Scripts/LayersBuilder/flowcell.script.json`. Importing that
page-enabled package creates the canonical Button and owned Local Scripts copy.
Its HTML, JavaScript, CSS, UI configuration, declared actions, and Illustrator
handler source all live inside the package. The generic installed-page host
resolves the exact active record, contains the package UI in its sandbox, and
runs only the installed `layers.jsx` through the declared
`illustrator-layer-tree` capability; it never executes the Git copy. Highlight
and expansion state is stored under that installed owner's `runtime/` folder.

The 19 actions in `Illustrator Git Scripts/Layers Builder/` are also ordinary
manifest packages. Eight are document-global and never require a Layer Tree
highlight: Make Layers, Sort, the four lock/visibility baseline actions, Empty
Sublayers, and Empty Trash. The other eleven resolve exact highlighted Layer
references from the unique active Layer Tree owner's validated
`runtime/installed-page-state.json`; they do not unlock or unhide artwork merely
to manufacture an Illustrator selection. Snapshot alone preserves a nonempty
native Illustrator selection when that owner state is valid but has no
highlighted rows. The other ten targeted actions, and every missing,
ambiguous, invalid, or stale owner state, fail closed without a TEMP-file mirror.

The bridge itself may be inspected directly when diagnosing connectivity:

```powershell
Programs\Illustrator\SupportScripts\Invoke-IllustratorFlowCellAction.ps1 -StartOnly
```
