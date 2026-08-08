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

The Illustrator bridge has no program-level Button inventory. Its one explicit
bind-only integration is `Actions / Set Anchor`: Binds exposes that Core action
when the shipped anchor helper exists, and the Illustrator-scoped shortcut runs
the helper without creating a panel Button or suppressing the shortcut's native
Illustrator command. Set Anchor waits for immediate foreground automation to
finish so it snapshots the selection belonging to that keypress. The Layer Tree is the explicit
catalog package at
`Illustrator Git Scripts/LayersBuilder/flowcell.script.json`. Importing that
page-enabled package creates the canonical Button and owned Local Scripts copy.
Its HTML, JavaScript, CSS, UI configuration, declared actions, and Illustrator
handler source all live inside the package. The generic installed-page host
resolves the exact active record, contains the package UI in its sandbox, and
runs only the installed `layers.jsx` through the declared
`illustrator-layer-tree` capability; it never executes the Git copy. Highlight
and expansion state is stored under that installed owner's `runtime/` folder.
Layer Tree Duplicate, Delete, and Force Delete use the complete containing
layers of Illustrator-selected objects before falling back to highlighted tree
rows. Duplicate recursively copies each resolved layer and its full subtree.
Each copied root uses the next compact trailing number (`name1`, `name2`) rather
than a `copy` suffix. The `+ Layer` action opens its name input before creation.
Force Delete dispatches immediately without a confirmation dialog. Row-body
pointer dragging still reparents layers. The separate square beside each target
ring selects that row's artwork when clicked and pointer-drags Illustrator's
current artwork selection: a normal drop moves it into the destination layer,
while an Alt-drop copies it.

The 19 actions in `Illustrator Git Scripts/Layers Builder/` are also ordinary
manifest packages. Eight are document-global and never require a Layer Tree
highlight: Make Layers, Sort, the four lock/visibility baseline actions, Empty
Sublayers, and Empty Trash. Nine targeted actions resolve exact highlighted
Layer references from the unique active Layer Tree owner's validated
`runtime/installed-page-state.json`; they do not unlock or unhide artwork merely
to manufacture an Illustrator selection. Snapshot may use a nonempty native
Illustrator selection when that owner state is valid but has no highlighted
rows. 3D instead prefers eligible selected Illustrator artwork and consults the
Layer Tree only as fallback. It hides only the top-level Live root, preserving
that root's lock and every descendant's visibility and lock state. Missing,
ambiguous, invalid, or stale required owner state fails closed without a
TEMP-file mirror.

FlowCell starts the package-owned named-pipe bridge without launching Illustrator.
A versioned `v2` pipe and response handshake prevent an older detached bridge from
being mistaken for the current protocol after an update. The PID file is diagnostic
only; pipe responses and the process mutex determine live ownership, so a stale but
still-valid PID cannot suppress bridge startup.
A background process watcher prewarms the bridge's cached COM proxy as soon as an
Illustrator window exists, and repeats that prewarm when either Illustrator or the
verified pipe-owning bridge receives a new process ID. Warm state follows that
verified process, so the watcher stops after one successful warmup. A named process
mutex and pipe-ownership check make duplicate
bridge launches exit without overwriting ownership state or retrying in a tight
loop. A Button that races the background prewarm waits for that one warmup instead
of failing busy; ordinary warm actions remain nonblocking.

The bridge itself may be inspected directly when diagnosing connectivity:

```powershell
Programs\Illustrator\SupportScripts\Invoke-IllustratorFlowCellAction.ps1 -StartOnly
```
