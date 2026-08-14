# FlowCell Tool-Set Manifest

`flowcell.toolset.json` describes one installable owner Button, its child
Buttons, optional popout layout/fields, and an optional read-only state query. It
is catalog/import metadata. Add Button accepts the package folder, the root
manifest, or the exact root-level file declared by `source`, copies the entire
package into the owner's Local Scripts directory, and normal runtime then uses
the owned copy and `.flowcell-source.json`.

Page-enabled Buttons do not use this format. A Button with a package-owned page
is an ordinary single-script package whose `flowcell.script.json` declares
`page`; it opens through the generic installed-page host and has no Tool Set
renderer or presentation fallback.

## Package Shape

```text
My Tool Set/
|-- flowcell.toolset.json
|-- tool.py
`-- optional-package-assets/
```

`source` must point to a file inside this folder. The whole folder is copied so
relative package dependencies remain with the installed owner.

### Import Selection

When a selected file sits beside `flowcell.toolset.json` and is the manifest's
exact declared `source`, automatic import promotes that file to the complete Tool
Set package. Selecting any other sibling companion is rejected instead of
installing an incomplete standalone script. If the same package root contains
both `flowcell.script.json` and `flowcell.toolset.json`, automatic detection fails
closed as ambiguous.

The catalog package must be sufficient on a clean FlowCell installation: keep
the declared source and all package-owned dependencies within the copied package.
Do not depend on an older Local Scripts copy, a pre-generated owner action, or an
undeclared pre-baked tool. If `source` is nested rather than beside the manifest,
select the package folder or the manifest itself.

## Minimal Manifest

```json
{
  "schemaVersion": 1,
  "id": "blender.example-tool-set",
  "version": "1.0.0",
  "label": "Example Tool Set",
  "tooltip": "Run the example child commands.",
  "kind": "toolset",
  "program": "Blender",
  "source": "tool.py",
  "children": [
    {
      "slot": "first",
      "label": "First",
      "tooltip": "Run the first command.",
      "payload": { "mode": "FIRST" }
    },
    {
      "slot": "second",
      "label": "Second",
      "tooltip": "Run the second command.",
      "payload": { "mode": "SECOND" }
    }
  ]
}
```

Required fields:

- `schemaVersion`: `1`;
- `id`: non-empty stable catalog identity;
- `label`: owner Button label;
- `source`: relative source path inside the package;
- `children`: at least one child.

Optional fields:

- `version`: catalog/package version;
- `tooltip`: owner tooltip;
- `kind`: defaults to `toolset`;
- `program`: when present, must match the selected program;
- `bridgeData`: base JSON-object payload for every child;
- `events`: owner event metadata;
- `execution`: runner-specific settings, such as an Illustrator command file;
- `stateQuery`: one package-owned read-only status request through a declared
  child slot;
- `layout`: initial tool-set surface geometry, fields, child behavior, and
  append-only child update policy.

The manifest does not choose a Blender bridge action. Program deployment creates
an owner-scoped runtime action and writes it into the active source record.

## Child Contract

Every child requires a unique, non-empty `slot` and `label`. `tooltip` is
optional. `payload`, when present, must be a JSON object.

The slot is the stable command identity. Installation creates a
`tool-set-action` execution target that refers to the owner active record and
the slot; it does not create a program-specific command route in FlowCell core.

At native dispatch, payloads merge in this order:

1. top-level `bridgeData`;
2. selected child `payload`;
3. runtime payload from fields and child behavior.

Later values win. Missing `command` and `action` keys are filled with the child
slot.

Tool Set hotkeys are runtime binding state, not manifest data. Binds stores
canonical owner IDs for owner toggles and installed child/owner IDs for child
activation. Owner binds use the same managed-popout toggle as the Main Button;
the active expanded tool-set host supplies current fields and runs a bound child
through the same ButtonHost path as an onscreen activation. A package must not
declare or serialize user shortcuts, live field values, or prebuilt hotkey
payloads.

## State Query Contract

A Tool Set whose external program keeps authoritative state may declare one
read-only query:

```json
{
  "stateQuery": {
    "slot": "cycle_x",
    "payload": {
      "action": "status",
      "command": "status"
    }
  }
}
```

`slot` must name one declared child. The payload must contain exactly `action`
and `command`, and both values must be `status`; arbitrary query payloads are
rejected during install and revalidated before every dispatch. The query uses
the installed owner's normal runner, bridge lock, child validation, and payload
merge path. An undeclared query is a no-op.

Opening or expanding a Button surface does not invoke this query. Placement
cycles with placement-owned `resultMatches` start at State 1 for each newly
opened expanded surface, and successful child responses map those
non-executable partial-JSON objects to exact cycle states. The package-owned
query never lives in a Button settings file; result matches remain
placement-owned settings, and neither belongs to skin source.

## Layout Contract

Omit `layout` to let FlowCell create a starter grid. The consumed layout fields
are:

```json
{
  "layout": {
    "width": 520,
    "height": 220,
    "placements": {
      "first": { "x": 8, "y": 8, "width": 144, "height": 42 },
      "second": { "x": 160, "y": 8, "width": 144, "height": 42 }
    },
    "fields": [],
    "childBehaviors": {},
    "updatePolicy": { "appendMissingChildSlots": true }
  }
}
```

- `width` and `height` provide minimum initial surface dimensions.
- `placements` maps child slots to exact `x`, `y`, `width`, and `height`.
- `fields` declares tool controls on the same surface.
- `childBehaviors` maps child slots to field mutations and payload templates.
- `updatePolicy.appendMissingChildSlots` is an explicit release migration. It
  permits only new child slots; existing slots cannot be removed or renamed.
  Existing Button IDs, placements, labels, skins, and dependent references stay
  unchanged while deterministic records are appended for the new slots.

Canonical Button state owns the imported geometry after installation. Editing
the catalog manifest does not move an installed tool set; use Update to import a
new package, then save the Button document.

## Page Boundary

`flowcell.toolset.json` has no page presentation contract. Tool Set layout is
rendered by the shared Button/field surface and every interactive control maps to
an installed child slot. A package that needs a custom page must instead use
`flowcell.script.json` with a strict `page` declaration and the generic
installed-page broker described in `docs/buttons.md`. There is no renderer ID,
product-specific fallback, or alternate Tool Set execution route. Layout uses a
closed schema: unknown root or nested keys, malformed geometry/fields, and
`layout.presentation` fail before the package is installed.

## Tool Fields

Every field has these common properties:

```json
{
  "id": "amount",
  "kind": "number",
  "label": "Amount",
  "payloadKey": "settings.amount",
  "defaultValue": 1,
  "x": 8,
  "y": 72,
  "width": 144,
  "height": 36,
  "zIndex": 2
}
```

`id`, `kind`, `label`, `payloadKey`, exact geometry, `zIndex`, and a
kind-compatible `defaultValue` are required. `payloadKey` may be a dotted JSON
path. Prototype-related path components are rejected.

Supported kinds:

| Kind | Additional contract |
| --- | --- |
| `text` | String default; optional `placeholder`. |
| `number` | Number default; optional `minimum`, `maximum`, and `step`. |
| `select` | JSON-primitive default and `options` with unique `id`, `label`, and `value`. |
| `toggle` | Boolean default. |
| `path` | String default and `pathKind` of `file` or `folder`; optional `filter`. |
| `color` | String default. |
| `display` | String, number, boolean, or null default; optional `format`. |

`hidden` and `disabled` are optional for every field. Field values are runtime
Button state; they are mapped into a nested payload through `payloadKey`.

## Child Behavior

```json
{
  "layout": {
    "fields": [
      {
        "id": "live",
        "kind": "toggle",
        "label": "Live",
        "payloadKey": "live",
        "defaultValue": false,
        "x": 8,
        "y": 72,
        "width": 120,
        "height": 36,
        "zIndex": 2
      },
      {
        "id": "amount",
        "kind": "number",
        "label": "Amount",
        "payloadKey": "amount",
        "defaultValue": 1,
        "x": 136,
        "y": 72,
        "width": 120,
        "height": 36,
        "zIndex": 2
      }
    ],
    "childBehaviors": {
      "toggle_live": {
        "toggleFields": ["live"],
        "execute": false
      },
      "apply": {
        "execute": true,
        "payloadTemplate": {
          "command": "apply",
          "amount": { "$field": "amount" },
          "live": { "$field": "live" }
        }
      }
    }
  }
}
```

- `toggleFields` flips named Boolean toggle fields before execution.
- `fieldPatch` assigns literal values to named fields.
- `activationPatch` assigns literal values when the child is activated without
  making those values part of that child's latched selected-state test. This
  lets a mode Button select itself through `fieldPatch` while also resetting a
  shared value to that mode's default.
- `selectField` turns one child into the skinned selector owner for one hidden
  `select` field. The current option label replaces the skin's existing HTML
  `{{label}}` node; option IDs, labels, values, defaults, and placement remain
  package data. The child must declare `execute: false`, the field cannot have a
  `serviceTarget`, and the behavior cannot also declare `inlineEditField`.
  Selector IDs and option IDs/labels must be nonempty, option IDs and primitive
  values must each be unique, and the default must match exactly one option.
  Hover opens the transient option fanout, owner click pins/toggles it, Enter or
  Space opens/selects, Arrow keys and Home/End move the active option, and Escape
  closes it. Options reuse the owner's skin and geometry and are not canonical
  child records, editor entries, bindings, or separately skinnable Buttons.
- `inlineEditField` turns the child itself into the editor for one hidden
  `number` or `text` field. The value replaces the skin's existing HTML
  `{{label}}` node in Run mode; the child remains a normal movable/resizable
  Button placement with its authored skin, `[data-core]` hitbox, and visual
  states. Pointer-down anywhere on that core explicitly focuses the native
  popout and then focuses/selects the editor, so its usable input target is the
  whole Button rather than only the rendered glyphs.
  Inline-edit children must declare `execute: false`, cannot use a field
  `serviceTarget`, and do not render separate field chrome.
- Dynamic selector and inline-edit values require a label-bearing skin. A skin
  that deliberately omits its HTML `{{label}}` node remains textless.
- Combining a choice's own Boolean `toggleFields` entry with `fieldPatch` values
  that clear its peer toggles creates an exclusive group that may also have no
  active choice: clicking the active choice toggles it off.
- `execute: false` makes the child state-only. Execution is enabled by default
  when the child has an execution target.
- `payloadTemplate` overlays the ordinary field payload. A single-key
  `{ "$field": "fieldId" }` object inserts that field's current value and may
  be nested inside objects or arrays.

This layout fragment is paste-ready after declaring the matching child slots and
placements. It demonstrates package-owned defaults of World, Y, and Z and the
same canonical-Button pattern for a numeric value:

```json
{
  "layout": {
    "fields": [
      {
        "id": "pivot",
        "kind": "select",
        "label": "Pivot",
        "payloadKey": "pivot",
        "defaultValue": "WORLD",
        "options": [
          { "id": "world", "label": "World", "value": "WORLD" },
          { "id": "origin", "label": "Origin", "value": "ORIGIN" }
        ],
        "x": 8,
        "y": 8,
        "width": 144,
        "height": 42,
        "zIndex": 1,
        "hidden": true
      },
      {
        "id": "flatten_axis",
        "kind": "select",
        "label": "Flatten Axis",
        "payloadKey": "flatten_axis",
        "defaultValue": "Y",
        "options": [
          { "id": "x", "label": "X", "value": "X" },
          { "id": "y", "label": "Y", "value": "Y" },
          { "id": "z", "label": "Z", "value": "Z" }
        ],
        "x": 160,
        "y": 8,
        "width": 72,
        "height": 42,
        "zIndex": 1,
        "hidden": true
      },
      {
        "id": "revolve_axis",
        "kind": "select",
        "label": "Revolve Axis",
        "payloadKey": "revolve_axis",
        "defaultValue": "Z",
        "options": [
          { "id": "x", "label": "X", "value": "X" },
          { "id": "y", "label": "Y", "value": "Y" },
          { "id": "z", "label": "Z", "value": "Z" }
        ],
        "x": 240,
        "y": 8,
        "width": 72,
        "height": 42,
        "zIndex": 1,
        "hidden": true
      },
      {
        "id": "angle",
        "kind": "number",
        "label": "Angle",
        "payloadKey": "angle",
        "defaultValue": 360,
        "step": 1,
        "x": 320,
        "y": 8,
        "width": 104,
        "height": 42,
        "zIndex": 1,
        "hidden": true
      }
    ],
    "childBehaviors": {
      "pivot_select": { "selectField": "pivot", "execute": false },
      "flatten_axis_select": { "selectField": "flatten_axis", "execute": false },
      "revolve_axis_select": { "selectField": "revolve_axis", "execute": false },
      "angle_input": { "inlineEditField": "angle", "execute": false }
    }
  }
}
```

Validation requires every referenced field to exist, every `toggleFields` entry
to name a Boolean toggle, every selected or inline-edited field to satisfy its
state-only contract above, every selected option set to have stable unique
identity/value data, and every child behavior key to identify an installed slot.

## Runner-Specific Execution

Blender tool sets call the owner-generated bridge action with the merged
payload.

Illustrator tool sets may declare:

```json
{
  "execution": {
    "programKey": "illustrator_automation",
    "commandFile": "illustrator_tool_command.json"
  }
}
```

`commandFile` must be one `.json` file name, not a path. FlowCell writes an
envelope under `flowcellbackend/local/` containing program, panel, active source
file, slot, timestamp, and merged payload, then starts the installed Local
source through the declared program runner.

## Lifecycle Rules

- Add copies the package into a new owner Button's Local Scripts directory.
- Update replaces the same owner's complete package and active record. An
  append-only child-slot migration must be explicitly opted into as described
  above; removal and rename remain invalid.
- Runtime validates the active record, owner package, and child slot.
- Delete removes the owner, children, tool-set popout, placements, bindings,
  program runtime output, active record, and Local package as one rollback-capable
  transaction.
- Owned files go to the Recycle Bin. The catalog package is not deleted.

Legacy comment directives are not a tool-set authoring format. Only
`FlowCellFrontend/src-tauri/src/program_sources/migrate.rs` may read them during
one-time migration.
