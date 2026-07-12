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
package creates the canonical Button and owned Local Scripts copy. The core
window resolves the exact active record and runs only that installed source by
its `illustrator-layer-tree` capability; it never executes the Git copy.

The bridge itself may be inspected directly when diagnosing connectivity:

```powershell
Programs\Illustrator\SupportScripts\Invoke-IllustratorFlowCellAction.ps1 -StartOnly
```
