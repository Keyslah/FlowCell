# FlowCell Tool-Set Manifest

`flowcell.toolset.json` describes one installable owner Button, its child
Buttons, and optional popout layout/fields. It is catalog/import metadata. Add
Tool Set copies the entire package into the owner's Local Scripts directory;
normal runtime then uses the owned copy and `.flowcell-source.json`.

## Package Shape

```text
My Tool Set/
|-- flowcell.toolset.json
|-- tool.py
`-- optional-package-assets/
```

`source` must point to a file inside this folder. The whole folder is copied so
relative package dependencies remain with the installed owner.

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
- `layout`: initial tool-set surface geometry, fields, and child behavior.

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
    "childBehaviors": {}
  }
}
```

- `width` and `height` provide minimum initial surface dimensions.
- `placements` maps child slots to exact `x`, `y`, `width`, and `height`.
- `fields` declares tool controls on the same surface.
- `childBehaviors` maps child slots to field mutations and payload templates.

Canonical Button state owns the imported geometry after installation. Editing
the catalog manifest does not move an installed tool set; use Update to import a
new package, then save the Button document.

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
- `execute: false` makes the child state-only. Execution is enabled by default
  when the child has an execution target.
- `payloadTemplate` overlays the ordinary field payload. A single-key
  `{ "$field": "fieldId" }` object inserts that field's current value and may
  be nested inside objects or arrays.

Validation requires every referenced field to exist, every `toggleFields` entry
to name a Boolean toggle, and every child behavior key to identify an installed
child slot.

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
- Update replaces the same owner's complete package and active record.
- Runtime validates the active record, owner package, and child slot.
- Delete removes the owner, children, tool-set popout, placements, bindings,
  program runtime output, active record, and Local package as one rollback-capable
  transaction.
- Owned files go to the Recycle Bin. The catalog package is not deleted.

Legacy comment directives are not a tool-set authoring format. Only
`FlowCellFrontend/src-tauri/src/program_sources/migrate.rs` may read them during
one-time migration.
