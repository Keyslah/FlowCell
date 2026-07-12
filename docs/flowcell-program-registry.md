# FlowCell Program Registry

`Programs/<Program>/flowcell.program.json` is the package contract for a
program. It declares program identity, folder roles, accepted source types, and
the runner adapter. It does not declare script Buttons.

## Registration Flow

1. Startup preflight scans direct children of `Programs/` for
   `flowcell.program.json`.
2. It validates the manifest identity against the containing folder.
3. It creates the declared Panels and Local Scripts roots when missing.
4. It synchronizes the program's rail registration into
   `flowcellbackend/local/bindings.ini`.
5. The frontend lists registered programs whose folders still exist.

This is program registration only. No catalog script becomes a Button until the
user installs it through Add Script or Add Tool Set.

## Manifest Example

```json
{
  "schemaVersion": 1,
  "programId": "example",
  "label": "Example",
  "programType": "direct-script",
  "defaultPanels": ["Files", "Utility"],
  "processNames": ["example"],
  "exePath": "",
  "gitScriptsFolder": "Example Git Scripts",
  "panelsFolder": "Panels",
  "localScriptsFolder": "Example Local Scripts",
  "supportScriptsFolder": "SupportScripts",
  "allowedScriptExtensions": ["js"],
  "allowedManifestFileNames": ["flowcell.script.json", "flowcell.toolset.json"],
  "supportsToolsetManifests": true,
  "runner": {
    "kind": "illustrator-direct",
    "programKey": "example_automation",
    "installScript": "",
    "deleteScript": ""
  },
  "addonReloadNotes": "",
  "appRestartNotes": "Restart FlowCell after changing this program manifest."
}
```

## Fields

| Field | Contract |
| --- | --- |
| `schemaVersion` | Required; currently `1`. |
| `programId` | Required stable machine identity. |
| `label` | Required display identity; must equal the program folder name, ignoring case. |
| `programType` | Required program classification used by registration. |
| `defaultPanels` | Panel names preflight registers; existing panel folders are the fallback when empty. |
| `processNames` | Executable/process aliases used by program activation and registration. |
| `exePath` | Optional configured executable path. |
| `gitScriptsFolder` | Required relative catalog folder. |
| `panelsFolder` | Required relative active-record root. |
| `localScriptsFolder` | Required relative owned-install root. |
| `supportScriptsFolder` | Required relative runner-adapter root. |
| `allowedScriptExtensions` | Required non-empty source extension list, without or with leading dots. |
| `allowedManifestFileNames` | Canonical package manifest names exposed for this program. |
| `supportsToolsetManifests` | Whether Add Tool Set is valid for this program. |
| `runner` | Required runtime adapter declaration. |
| `addonReloadNotes` | Optional post-deployment guidance. |
| `appRestartNotes` | Optional guidance after manifest changes. |

All four folder fields must be non-empty relative paths with no parent traversal.
They are resolved under the containing program folder.

## Runner Contract

Supported `runner.kind` values:

| Kind | Execution |
| --- | --- |
| `windows-script` | Starts the installed Local source through the Windows script runner. |
| `illustrator-direct` | Sends the installed Local source through the Illustrator backend using `runner.programKey`. |
| `photoshop-direct` | Sends the installed Local source through the controller using `runner.programKey`. |
| `blender-bridge` | Deploys and invokes an owner-generated Blender bridge action through `runner.installScript` and removes it through `runner.deleteScript`. |

`programKey`, `installScript`, and `deleteScript` are runner-specific. Empty
values are valid only when that runner does not use them.

Runner logic may know how to communicate with a program, but it must not contain
a list of program-specific script Buttons, filename classifiers, or fallback
action IDs. Every installed script comes from its Button-owned Local Scripts
package and active `.flowcell-source.json` record.

## Source Installation Rules

The manifest is loaded for every install, resolve, execute, update, and delete:

- selected source extensions must be allowed;
- a manifest package's optional `program` must match `label`;
- Local and panel paths come from this manifest;
- active records must agree with `programId` and `runner.kind`;
- installed sources must remain inside
  `<localScriptsFolder>/<ownerButtonId>/`;
- selecting the declared source beside `flowcell.script.json` promotes the
  complete package, while selecting one of its companion files is rejected;
- Update preserves only the owner package's `runtime/` subtree; immutable
  package source is replaced from the selected package;
- tool-set packages are rejected unless `supportsToolsetManifests` is true.

`flowcell.script.json` and `flowcell.toolset.json` describe catalog/import
packages. The installed active record is always `.flowcell-source.json`; the
package manifest is never used as live Button state.

A single-script package may declare an `executionTarget` only for a registered
`core-action`. This is for an explicit installed package whose owned source is
consumed by a FlowCell utility window; native install injects the owner active
identity into the target payload. It does not create a Button until the package
is added, and deletion still uninstalls the owned package. Unknown manifest
fields are rejected instead of being silently ignored.

## Adding a Program

To add a program package:

1. create `Programs/<Program>/flowcell.program.json`;
2. provide the declared Git Scripts, Panels, Local Scripts, and SupportScripts
   folders as appropriate;
3. choose an existing runner kind or implement a maintainable generic adapter;
4. add runner-specific support scripts only when the runner requires them;
5. run startup preflight and verify the generated registration;
6. install a real source through the Buttons Editor and test add, execute,
   update, and delete.

Do not add starter script Buttons to application code. A new program with an
empty catalog and no installed sources is valid.

## Current Program Packages

- `Programs/Blender/flowcell.program.json`
- `Programs/Illustrator/flowcell.program.json`
- `Programs/Windows/flowcell.program.json`

These manifests define program capabilities. Their Git Scripts contents remain
optional catalog entries, not core Button inventory.
