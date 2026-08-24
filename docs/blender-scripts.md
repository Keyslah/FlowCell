# Blender Script Packages

Blender Buttons use the same owned source lifecycle as every other program. The
Blender-specific part is the runner adapter that deploys the installed Local
Scripts copy into the FlowCell Blender bridge.

## Source of Truth

- `Programs/Blender/Blender Git Scripts/` is the tracked catalog.
- `Programs/Blender/Blender Local Scripts/<ownerButtonId>/` is the installed
  source of truth for that Button.
- `Programs/Blender/Panels/<Panel>/<ownerButtonId>.flowcell-source.json` is the
  active owner/runner record.
- `flowcellbackend/local/button-system/button-state.json` is canonical Button
  UI state.
- The Blender add-on's `ManagedActions/flowcell_button_<ownerButtonId>.py` and
  custom-action registry entry are generated runtime output.

Normal execution never runs a Git Scripts file, guesses an action from a file
name, or selects a pre-baked program action.

## Blender Setup

Install the contents of
`Programs/Blender/Blender Addons - Copy contents Into Blender/` in Blender's user
add-ons folder:

```text
%APPDATA%/Blender Foundation/Blender/<version>/scripts/addons/
```

Enable the FlowCell add-on. After an install, update, delete, registry change, or
bridge deployment change, reload the add-on or restart Blender before testing
the new runtime state.

## Python Action Contract

An installable `.py` source must expose this top-level entrypoint:

```python
def run_flowcell_action(context=None, data=None):
    data = data or {}
    return {"status": "ok", "message": "Completed."}
```

Requirements:

- `run_flowcell_action(context=None, data=None)` must be a top-level function.
- Do not execute the action on import.
- Keep persistent listeners, keymaps, panels, and unrelated add-on bootstrap
  code out of an action source.
- Use `context or bpy.context` when Blender context is optional.
- Treat `data` as the complete command payload. Tool sets normally route on
  `data.get("command") or data.get("action")`.
- Return a JSON-compatible dictionary with useful `status` and `message`
  fields. State-aware tools may return additional fields.
- Put `# Description: ...` near the top when a bare `.py` file should supply its
  tooltip. Package manifests provide the preferred label and tooltip contract.

## Single Script Package

A single script may be installed as a bare allowed `.py` file. For a durable
catalog package, place `flowcell.script.json` beside the source:

```text
Cycle Collection/
|-- flowcell.script.json
`-- cycle collection.py
```

```json
{
  "schemaVersion": 1,
  "id": "blender.cycle-collection",
  "label": "Cycle Collection",
  "tooltip": "Cycle direct objects in the selected object's collection.",
  "program": "Blender",
  "source": "cycle collection.py",
  "bridgeData": {
    "command": "cycle"
  },
  "events": {
    "hoverEnter": {
      "type": "blenderBridge",
      "data": { "command": "hover_enter" }
    },
    "hoverLeave": {
      "type": "blenderBridge",
      "data": { "command": "hover_leave" }
    }
  }
}
```

`schemaVersion`, `label`, and `source` are required. `source` must be a relative
path inside the package and must resolve to an allowed file. `id`, `tooltip`,
`program`, `bridgeData`, `events`, runner-specific `execution`, and a restricted
registered-core `executionTarget` are optional; when `program` is present it
must match `Blender`. Unknown fields are rejected. Ordinary Blender scripts
omit `executionTarget` and execute through their owner-generated bridge action.

`bridgeData` is the default payload for the Button's normal execution. An event
entry may specify `type: "blenderBridge"` and `data`; it runs through the same
owner-generated bridge action. A source manifest does not choose or own a bridge
action ID.

## Illustrator SVG import package

`Import Illustrator SVG` is the internal Blender half of Illustrator's
`Send SVG to Blender` workflow, not a visible Blender panel Button. It accepts
a batch of SVG paths and sublayer
names, imports each SVG through Blender's built-in SVG importer, consolidates
that file's imported curves, fits X and Y to the physical dimensions reported
by Illustrator using the current Blender scene unit scale, gives it the exact
requested full thickness without scaling Z, converts it to a mesh, places its
base at world Z=0, and restores the sublayer center's X/Y offset from the center
of the combined Illustrator selection. Finished meshes are linked exclusively
to the scene's top-level `Live` collection. Before conversion, the importer
raises Blender's SVG curve tessellation
resolution from its usual 12 steps to 16. This produces smoother printable
sidewalls without changing the artwork's physical dimensions. Temporary
collections created by Blender's SVG importer and its zero-user Curve data
blocks are removed after conversion.

The mesh conversion welds only coincident cap/side seam vertices using a
scale-aware tolerance. If Blender's single-precision tessellator collapses a
cap triangle, the importer dissolves only its provably roundoff-collinear middle
vertex; genuine positive-area skinny faces remain intact. It recalculates
normals and then requires a closed manifold result with no zero-length edges,
degenerate or duplicate faces, or disjoint self-intersections. Any unsafe item
rolls back the entire imported batch, including newly created Curve and Mesh
data blocks, so `Ill Orca` cannot export or launch a slicer with a broken
extrusion.

The self-intersection check excludes only Blender's exact outer-cap boundary
subdivision artifact: a standard extrusion wall in the same connected component
whose manifold cap-plane edge lies wholly on one manifold edge of an outer cap
triangle. Cross-component contacts, wall crossings through a cap interior, and
all other BVH overlaps remain unsafe.

The source filename remains authoritative for extrusion: only a positive number
in parentheses at the beginning, such as `(2.5) Name.svg`, means 2.5 mm. Every
other filename uses 1 mm. The Illustrator helper resolves the internal managed
bridge action at runtime and starts Blender only when no Blender process is
running.

The separate Illustrator Files `Ill Orca` Button runs the same import first,
then resolves the unique active `blender.orca` Files record and invokes its
Blender bridge action with the new meshes still selected. It deliberately does
not copy or hardcode Orca's STL/export/launcher implementation, so each FlowCell
installation uses its own installed Orca Button and normal first-run setup.

## Tool-Set Package

A tool set is a directory containing `flowcell.toolset.json` and its source:

```text
My Tool Set/
|-- flowcell.toolset.json
`-- my tool set.py
```

The manifest declares owner metadata, child slots, child payload defaults, and
optional popout layout/fields. Add Button detects the tool-set manifest and
copies the entire directory into the owner's Local Scripts package. See
`docs/flowcell-toolset-manifest.md` for the complete contract.

The Python source still has one entrypoint:

```python
def run_flowcell_action(context=None, data=None):
    data = data or {}
    command = str(data.get("command") or data.get("action") or "status")

    if command == "status":
        return {"status": "ok", "message": "Ready."}
    if command == "create":
        return create_result(context, data)
    raise ValueError(f"Unsupported command: {command}")
```

Child slots are data, not hardcoded FlowCell commands. The active record stores
the declared children, and the runtime validates the requested slot before it
calls Blender.

## Payload Contract

For a tool-set child, FlowCell merges payloads in this order:

1. manifest `bridgeData`;
2. that child's `payload`;
3. runtime payload produced by Button fields and child behavior.

Later values win. If the merged object does not already contain them, FlowCell
adds both `command` and `action` using the child slot. Payloads at all three
levels must be JSON objects.

This lets the manifest provide stable defaults while canonical Button state owns
editable field values, field patches, toggle behavior, and payload templates.

## Install and Update Lifecycle

1. Add Button accepts a bare source, package folder, or manifest file and
   detects whether it is a script, tool-set, or page package.
2. FlowCell validates `flowcell.program.json`, the package manifest, the source
   path, and `run_flowcell_action`.
3. It copies the selected package into
   `Blender Local Scripts/<ownerButtonId>/source/` and writes
   `flowcell.install.json`.
4. The Blender install adapter generates the owner-scoped runtime action
   `flowcell_button_<ownerButtonId>`, copies the installed source into the
   add-on's `ManagedActions`, and registers that owner/action pair.
5. FlowCell writes `<ownerButtonId>.flowcell-source.json` with the installed
   Local source path and generated `bridgeAction`.
6. The Buttons Editor adds the owner and any children/layout to canonical Button
   state.

Update keeps the owner Button ID and transactionally replaces its package,
runtime deployment, and active record. The old package is sent to the Recycle
Bin only after the replacement commits. Editing the catalog alone never updates
an installed Button.

## Runtime and Delete Lifecycle

At click time FlowCell resolves only the `.flowcell-source.json` record, verifies
that its `sourcePath` is inside the matching owner Local package's `source/`
root, and dispatches
the generated `bridgeAction`. Tool-set commands are checked against the active
record's child slots before payload merge and dispatch.

Deleting the owner Button is one transaction. It removes dependent Button
state, owned bindings, the active record, the Local package, the Blender config
and custom-action registry entries, generated owner runtime files, and matching
Blender bytecode-cache artifacts. Owned files are sent to the Recycle Bin. The Git Scripts catalog package is not
deleted.

If cleanup or state commit fails, FlowCell restores the quarantined package,
record, bindings, and Blender deployment instead of leaving half an uninstall.

## Migration Boundary

Old panel script/tool-set records and source comment directives are understood
only by `FlowCellFrontend/src-tauri/src/program_sources/migrate.rs` during
one-time bootstrap/recovery. Do not author them and do not add fallback parsing
to the normal Blender install or runtime paths.
