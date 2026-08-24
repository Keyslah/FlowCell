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

## Send SVG to Blender

The Illustrator Files panel exposes `Send SVG to Blender` and `Ill Orca`.
Both start from the current Illustrator selection and export one clean SVG 1.0
file per owning sublayer. In a temporary document, every visible filled contour
is closed, supported appearances and strokes are expanded, and Pathfinder Unite
is required and baked before export. The original Illustrator artwork is never
changed. If Illustrator cannot reduce the temporary copy to closed, filled,
unstroked native paths, the handoff stops instead of creating an unsafe Blender
mesh. Each file keeps that sublayer's full name, replaces an existing same-named
SVG, and is handed to the active Blender instance; if Blender is not running,
the package resolves and starts the newest installed copy. The post-export
cleanup supplies the SVG 1.0 doctype and removes Illustrator's unresolved Adobe
namespace entities before Blender reads the file.

Illustrator converts the cleaned artwork bounds and every sublayer center's
offset from the combined selection center from points to millimeters. The
internal Blender bridge action fits X and Y through the current scene unit
scale, restores those relative X/Y positions, keeps Z at the exact
filename-driven millimeter thickness, and links the finished meshes only to the
scene's top-level `Live` collection. Blender raises curve tessellation from its
usual 12 steps to 16 before mesh conversion for smoother printable sidewalls
without changing physical dimensions. It welds only coincident conversion
seams, recalculates normals, and rejects open, non-manifold, degenerate,
duplicate, or self-intersecting results before the batch can be reported as
successful. It does not install a visible Blender import Button. `Ill Orca`
then invokes that FlowCell installation's active
Blender Files `Orca` Button with the imported meshes still selected, so the
existing Orca package owns STL output, executable discovery, first-run setup,
and launch behavior. No generated owner ID, user directory, Blender version,
unit scale, or Orca executable path is embedded in either Illustrator package.

On another supported Windows computer, the user still needs Illustrator,
Blender, and (for `Ill Orca`) OrcaSlicer installed, the FlowCell Blender bridge
add-on enabled, and a saved `.blend` file so the Orca package can choose its STL
destination. The existing Orca package discovers or prompts for that computer's
executable and performs its normal first-run single-instance setup. Text and
live vector appearances are processed automatically; raster artwork must be
manually Image Traced/expanded with the user's intended tracing settings rather
than being converted with an arbitrary preset. Clipping groups also fail closed;
convert a mask into explicit closed filled paths when its clipped appearance is
intended to become printable geometry.

A positive number at the absolute beginning of the sublayer name sets the
finished Blender thickness in millimeters, with parentheses optional:
`14Main stencil` produces 14 mm, `2connect` produces 2 mm, and `(9) Name`
produces 9 mm. Names such as `V9 Name` or `Name (9)` use the 1 mm default.

## Illustrator bridge

The persistent bridge injects the resolved Button-owned source path as
`FLOWCELL_SCRIPT_PATH` before execution, so a directory-backed package can find
its own companions and owner-local `runtime/` folder even when Illustrator's
`$.fileName` reports the host application's folder.

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
Force Delete dispatches immediately without a confirmation dialog. Clicking a
row makes that layer native-active in Illustrator while preserving the current
artwork selection; no temporary artwork is created. Row-body pointer dragging
still reparents layers. The separate square beside each target ring selects
that row's artwork when clicked and, without requiring a prior Illustrator
selection, pointer-drags that row's artwork: a normal drop moves it into the
destination layer, while an Alt-drop copies it. Artwork is flattened
in its existing mixed layer/sublayer visual order. After a drop, only results
whose restored item and layer state remains visible and unlocked are selected.

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
