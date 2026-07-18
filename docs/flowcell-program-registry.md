# FlowCell Program Registry

`Programs/<Program>/flowcell.program.json` is the package contract for a
program. It declares program identity, folder roles, accepted source types, and
the runner adapter. Optional `bundledSources` are program-owned starter or
required Button contributions; they are not compiled into FlowCell core.

## Registration Flow

1. Extracting a program payload creates an available package under `Programs/`;
   it does not register runtime behavior.
2. `Add Program` selects the package's host executable and writes the explicit
   rail registration to `flowcellbackend/local/bindings.ini`.
3. Add validates the complete manifest and creates its declared Panels and
   Local Scripts roots.
4. Registered programs synchronize their versioned `bundledSources`.
   `installOnAdd` installs a starter during Add Program; `installIfMissing`
   marks a required contribution that normal synchronization repairs.
5. Startup preflight fully validates and refreshes only packages that already
   have a rail registration. An available but unregistered or malformed package
   has no runtime presence and cannot block core startup.
6. The frontend lists registered programs whose package folders still exist.

Registered-package preflight requires the declared Git Scripts and support
directories to exist and every nonempty runner install, delete, or capability
adapter to resolve to an existing file before bindings are refreshed.

Catalog sources become Buttons only through Add Script/Add Tool Set or an
explicit bundled-source policy. Package extraction alone never installs one.

## Manifest Example

```json
{
  "schemaVersion": 1,
  "programId": "example",
  "label": "Example",
  "programType": "local-script",
  "defaultPanels": ["Files", "Utility"],
  "processNames": ["example"],
  "bindScopedNativeOwner": false,
  "shortcutProfileId": "example.windows",
  "exePath": "",
  "gitScriptsFolder": "Example Git Scripts",
  "panelsFolder": "Panels",
  "localScriptsFolder": "Example Local Scripts",
  "supportScriptsFolder": "SupportScripts",
  "allowedScriptExtensions": ["js"],
  "allowedManifestFileNames": ["flowcell.script.json", "flowcell.toolset.json"],
  "supportsToolsetManifests": true,
  "bundledSources": [
    {
      "id": "example.quick-action",
      "version": "1.0.0",
      "panelName": "Utility",
      "sourcePath": "Example Git Scripts/Quick Action.js",
      "importKind": "script",
      "installOnAdd": true
    }
  ],
  "runner": {
    "kind": "windows-script",
    "programKey": "example_generic",
    "installScript": "",
    "deleteScript": "",
    "capabilityScript": ""
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
| `bindScopedNativeOwner` | Whether program-owned Pop/Fan windows may bind to the foreground host HWND. |
| `shortcutProfileId` | Optional registered shortcut-profile identity; core does not infer it from the program label. |
| `exePath` | Optional configured executable path. |
| `gitScriptsFolder` | Required relative catalog folder. |
| `panelsFolder` | Required relative active-record root. |
| `localScriptsFolder` | Required relative owned-install root. |
| `supportScriptsFolder` | Required relative runner-adapter root. |
| `allowedScriptExtensions` | Required non-empty source extension list, without or with leading dots. |
| `allowedManifestFileNames` | Canonical package manifest names exposed for this program. |
| `supportsToolsetManifests` | Whether Add Tool Set is valid for this program. |
| `bundledSources` | Optional versioned starter or required source contributions owned by this program package. |
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

`programKey`, `installScript`, `deleteScript`, and `capabilityScript` are
runner-specific. `capabilityScript` is a request/response adapter for installed
capability-backed tool pages. Empty values are valid only when that runner does
not use them.

Removing a program is compensating rather than one-way: native unregister keeps
an opaque in-process bindings snapshot while canonical Buttons and their owned
source packages are removed. Canonical failure restores that snapshot only if
the post-unregister bindings have not drifted, so unrelated binding edits are
never overwritten. Successful removal finalizes the token and keeps the
available `Programs/<Program>` package for a later Add Program.

Program rename is a durable cross-file transaction. Before the first directory
move, native code writes `flowcellbackend/local/program-rename-transactions/<token>/journal.json`
with the exact previous and intended bindings plus the exact pre-rename
canonical Button document. The canonical save carries that token and records
its exact post-rename document before committing `button-state.json`. Startup
then compares canonical state to those two journal values and can only roll the
folder, manifests, records, and bindings back or finalize them forward; a third
state is rejected for manual inspection. This also covers the temporary folder
used by Windows case-only renames. Bindings use synced staged replacement, and
startup preflight never reads or rewrites them while one of these journals is
pending.

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
- tool-set packages are rejected unless `supportsToolsetManifests` is true;
- bundled-source updates use the same owned install/update transaction and
  preserve the existing owner ID and canonical presentation;
- `installIfMissing` and `installOnAdd` are mutually exclusive. Required
  contributions intentionally self-repair after deletion; starters do not.

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

To author and verify a program package:

1. create `Programs/<Program>/flowcell.program.json`;
2. provide the declared Git Scripts, Panels, Local Scripts, and SupportScripts
   folders as appropriate;
3. choose an existing runner kind or implement a maintainable generic adapter;
4. add runner-specific support scripts only when the runner requires them;
5. extract or place the package under `Programs/`, then use `Add Program` with
   its real executable and verify the explicit registration;
6. verify startup preflight ignores the package before registration and repairs
   only its registered mutable roots afterward;
7. install a real source through the Buttons Editor and test add, execute,
   update, and delete;
8. if `bundledSources` are declared, test starter/required policy, versioned
   update, interrupted canonical reconciliation, and owner-ID preservation.

Do not add starter script Buttons to application code. Put them in
`bundledSources` only when the program package owns that policy. A new program
with an empty catalog and no installed sources is valid.

## Current Program Packages

- `Programs/Blender/flowcell.program.json`
- `Programs/Illustrator/flowcell.program.json`
- `Programs/Windows/flowcell.program.json`

These manifests define program capabilities. Ordinary Git Scripts remain
optional catalog entries; declared bundled sources remain package-owned and are
synchronized only after that program is registered.
