# FlowCell Program Registry

`Programs/<Program>/flowcell.program.json` is the package contract for a
program. It declares program identity, folder roles, accepted source types, and
the runner adapter. Optional `bundledSources` are program-owned managed-setup
Button contributions; they are not compiled into FlowCell Core.

## Registration Flow

1. Extracting a program payload creates an available package under `Programs/`;
   it does not register runtime behavior.
2. `Add Program` always offers `Any program`, which accepts an editable Program
   name and an exact host EXE. One `Add program` action silently preflights the
   path and applies a minimal registration-only package with no Panels or bundled
   Button contributions; the application does not need to be running.
3. `Managed package` inventories only unregistered packages whose complete
   manifest, declared Panels, contribution packages, support content, and
   runner contract validate. Invalid packages are listed with their rejection
   reason. The user confirms the package's host executable and chooses a reviewed
   `Register program only`, `Add everything`, or `Custom` plan. Panels,
   contribution versions/types/defaults/dependencies, destination Panels,
   support content, reload/restart notes, and install effects all come from the
   manifest; labels and catalog paths never invent setup behavior.
4. For `Any program`, Apply generates `Programs/<Program>/flowcell.program.json`
   plus its required empty package folders only after the prepared durable
   journal exists. Its sole process match is the selected EXE's normalized
   filename stem, not its full path. Preflight rejects a process name already
   claimed by another valid Program package. The generated package never
   overwrites an existing package or shared program ID. A valid same-name package
   may be selected through `Managed package`; a malformed blocking folder must be
   repaired, removed, or avoided with a distinct Program name.
5. The durable Add Program transaction writes the explicit rail registration to
   `flowcellbackend/local/bindings.ini`, persists the exact enabled contribution
   set at `flowcellbackend/local/program-registration/<programId>.json`, creates
   selected Panels and their canonical owners, installs selected packages
   through the ordinary source lifecycle, and coordinates their canonical
   Button commit.
6. Startup preflight fully validates and refreshes only packages that already
   have a rail registration. Synchronization considers only contributions in
   that package's enabled set. An available but unregistered or malformed
   package has no runtime presence and cannot block Core startup.
7. `installOnAdd` is a default selection for Add Program and never resurrects a
   deleted Button. An enabled `installIfMissing` contribution is the only
   missing contribution startup repairs. Version changes update an existing
   exact managed owner through the normal source transaction.
8. The frontend lists registered programs whose package folders still exist.

Registered-package preflight requires the declared Git Scripts and support
directories to exist and every nonempty runner install or delete script to
resolve to an existing file before bindings are refreshed.

Catalog sources become Buttons only through Add Button or an explicitly selected
program contribution. Package extraction and register-only setup never install
one.

### Registration-Only Program Contexts

The `Any program` path is for applications without a richer FlowCell package.
Its generated manifest uses a `plain-` program ID, the generic Windows script
runner, empty `panels` and `bundledSources`, and `bindScopedNativeOwner: false`.
It creates no Panel owner or source Button during registration. Add Panel and Add
Button can extend the Program afterward through their normal lifecycles.

Program-scoped Pop, Fan, and related windows compare the foreground process to
the normalized EXE stem exactly; paths and the `.exe` suffix are removed. Thus
`krita.exe` matches `krita`, but `krita-helper.exe` does not. Applications that
render their main window from a separate child process require a future explicit
process alias rather than a loose substring match. Although preflight rejects a
process name claimed by another valid Program package, an unknown unregistered
executable elsewhere with the same filename remains a residual match risk.

The generated package carries a transaction marker until commit. Before commit
FlowCell re-proves the exact marker, manifest, complete generated tree, native
rail registration, and enabled-contribution state. Before rollback, every
generated artifact still present must match the journal, no unexpected content
may exist, and native state must be at a proved journal boundary. Rollback sends
the generated package to the Recycle Bin only while that proof still matches;
drift or reparse points fail closed and preserve existing content. The silent
preflight never creates the package. Successful Program removal keeps the
generated package available for later re-registration just like a managed
package.

## Manifest Example

```json
{
  "schemaVersion": 1,
  "programId": "example",
  "label": "Example",
  "programType": "local-script",
  "defaultPanels": ["Files", "Utility"],
  "panels": [
    { "id": "files", "label": "Files", "defaultSelected": true },
    { "id": "utility", "label": "Utility", "defaultSelected": true }
  ],
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
      "sourcePath": "Example Git Scripts/Quick Action",
      "importKind": "script",
      "displayLabel": "Quick Action",
      "sourceKind": "page",
      "required": false,
      "dependencies": [],
      "installEffects": ["Installs Quick Action into the selected Panel."],
      "installOnAdd": true
    }
  ],
  "runner": {
    "kind": "windows-script",
    "programKey": "example_generic",
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
| `defaultPanels` | Fallback Panel names for packages without an explicit managed-setup inventory. Current packages should declare `panels`. |
| `panels` | Manifest-authoritative Add Program inventory. Each entry declares stable `id`, display `label`, and `defaultSelected`. |
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
| `supportsToolsetManifests` | Whether Add Button accepts `flowcell.toolset.json` packages for this program. |
| `bundledSources` | Optional versioned Button contributions owned by this program package. Each declares source identity/path/import kind, default destination, display/source kind, setup policy, dependencies, and visible install effects. |
| `runner` | Required runtime adapter declaration. |
| `addonReloadNotes` | Optional post-deployment guidance. |
| `appRestartNotes` | Optional guidance after manifest changes. |

All four folder fields must be non-empty relative paths with no parent traversal.
They are resolved under the containing program folder.

### Managed Setup Inventory

`Add Program` reads `panels` and `bundledSources` as closed manifest data. It
preflights every contribution package before showing the plan and verifies that
declared `sourceKind` (`script`, `tool-set`, or `page`) matches the actual
package. `displayLabel`, `version`, `installEffects`, support files, and
reload/restart notes are informational only; none may bypass package validation.

Contribution policy fields have separate meanings:

- `installOnAdd`: selected in the default Custom plan; deletion remains final.
- `installIfMissing`: when that contribution is explicitly enabled, startup
  installs it again if its exact owner is missing.
- `required`: locked on in Add Program's selection UI.
- `dependencies`: selected transitively and locked while a dependent source is
  enabled.
- `panelName`: default destination; Custom may choose another selected manifest
  Panel, and the enabled-state record persists that choice.

`installOnAdd` and `installIfMissing` are mutually exclusive. Register-only
writes a valid enabled-state document with no sources, so registration by itself
creates no Button and normal startup has nothing to synchronize.

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

Removing a program is compensating rather than one-way: native unregister keeps
an opaque in-process bindings snapshot while canonical Buttons and their owned
source packages are removed. Canonical failure restores that snapshot only if
the post-unregister bindings have not drifted, so unrelated binding edits are
never overwritten. Successful removal finalizes the token and keeps the
available `Programs/<Program>` package for a later Add Program.

Main's Program context-menu rename is not a registry rename: it changes only the
visible canonical Program Button label and leaves this complete contract
untouched. The retained native program-package rename operation is a durable
cross-file transaction. Before the first directory
move, native code writes `flowcellbackend/local/program-rename-transactions/<token>/journal.json`
with the exact previous and intended bindings plus the exact pre-rename
canonical Button document, the exact previous and intended enabled-contribution
registration bytes or absence, and exact previous and intended bytes for each
frontend-owned recorded macro whose Program name matches the rename source.
Unrelated macros are not journaled or rewritten. The canonical save carries the
same token and records its exact post-rename document before committing
`button-state.json`. Startup then compares canonical state and every owned file
to the two journaled sides and can only roll the folder, manifests, records,
registration, matching macros, and bindings back or finalize them forward; a
third state or unrelated edit is rejected for manual inspection before folder
identity is changed. This also covers the temporary folder used by Windows
case-only renames. Owned files and bindings use synced staged replacement, and
startup preflight never reads or rewrites bindings while one of these journals
is pending.

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
- selected program contributions use the same owned install/update transaction
  and preserve an existing exact managed owner ID and canonical presentation;
- only IDs present in the registered program's enabled-state document are
  synchronized; `installIfMissing` and `installOnAdd` are mutually exclusive;
- `installOnAdd` never triggers startup repair, while an enabled
  `installIfMissing` contribution does.

`flowcell.script.json` and `flowcell.toolset.json` describe catalog/import
packages. The installed active record is always `.flowcell-source.json`; the
package manifest is never used as live Button state.

A single-script package may declare a strict `page` object. Native install
assigns the reserved generic `open-installed-page` target only after the page
resources, actions, capabilities, schemas, state format, and active package
identity validate. Page packages remain ordinary single-script Buttons; their
UI and program behavior are not registered in Core. Unknown manifest fields are
rejected instead of being silently ignored.

## Adding a Program

To author and verify a program package:

1. create `Programs/<Program>/flowcell.program.json`;
2. declare the complete current `panels` inventory and every optional Button
   contribution in `bundledSources` with explicit type, destination, policy,
   dependencies, and effects;
3. provide the declared Git Scripts, Panels, Local Scripts, and SupportScripts
   folders as appropriate;
4. choose an existing runner kind or implement a maintainable generic adapter;
5. add runner-specific support scripts only when the runner requires them;
6. extract or place the package under `Programs/`, then use Add Program with its
   real executable; review register-only, all, and custom plans before applying
   the intended one;
7. verify the exact enabled-state document, rail registration, selected Panel
   owners, installed sources, and canonical Buttons;
8. verify startup ignores the package before registration and synchronizes only
   its explicitly enabled contributions afterward;
9. install another real source through Add Button and test add, execute, update,
   and complete delete;
10. test selected contribution policy, dependency closure, destination changes,
    versioned update, interrupted canonical reconciliation, and owner-ID
    preservation.

Do not add starter script Buttons or page products to application code. Put
optional contributions in `bundledSources` only when the program package owns
that policy. A new program with an empty catalog and no installed sources is
valid.

## Adding a Panel

Add Panel operates only inside a registered program's declared Panels root. It
accepts a Panel name and either no source folder (empty managed Panel) or one
external source folder (managed copy). Preflight validates the exact destination
and reports the copy file/byte count. The external folder is never modified.

The copy rejects symbolic links/reparse points, traversal or containment escape,
`.flowcell-source.json`, install records, and FlowCell transaction artifacts.
For a new Panel, native code stages the complete copy on the destination volume,
publishes it as one immediate managed child, and coordinates creation of its
canonical source-free `panel-owner`. Rollback sends only that transaction-created
destination to the Recycle Bin. An existing case-insensitive Panel match is an
idempotent canonical-owner reconcile rather than a duplicate folder.

## Current Program Packages

- `Programs/Blender/flowcell.program.json`
- `Programs/Illustrator/flowcell.program.json`
- `Programs/Windows/flowcell.program.json`

These manifests define program capabilities. Ordinary Git Scripts remain
optional catalog entries; declared bundled sources remain package-owned and are
synchronized only after that program is registered.

The current package inventories include three ordinary page contributions:

- Blender owns `blender.theme` in
  `Blender Git Scripts/Toolsets/theme/flowcell.script.json`.
- Illustrator owns `illustrator.layer-tree` in
  `Illustrator Git Scripts/LayersBuilder/flowcell.script.json`.
- Windows owns `windows.setup-organization` in
  `Windows Git Scripts/Files/Setup Organization/flowcell.script.json`.

Each is `sourceKind: "page"`, selected by `installOnAdd`, and installed as a
normal single-script owner. Their product UI/actions/assets/configuration live in
the catalog package and installed Local Scripts copy; the FlowCell application
contains only the generic page host and broker.
