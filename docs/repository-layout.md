# Repository Layout

## Top-Level Owners

- `FlowCellFrontend/`: React/Tauri application, canonical Button UI, editor,
  window runtime, native persistence, and program-source transactions.
- `flowcellbackend/`: AutoHotkey/PowerShell runtime, helpers, and ignored local
  state under `flowcellbackend/local/`.
- `Programs/`: manifest-defined program packages, shareable source catalogs,
  installed Local Scripts packages, active panel source records, and
  program-specific runtime adapters.
- `docs/`: current architecture and authoring contracts.

## Program Package Shape

Each program is defined by `Programs/<Program>/flowcell.program.json`:

```text
Programs/<Program>/
|-- flowcell.program.json
|-- <Program> Git Scripts/
|   `-- <catalog package or source>
|-- <Program> Local Scripts/
|   `-- <ownerButtonId>/
|       |-- flowcell.install.json
|       `-- source/
|           `-- <installed package copy>
|-- Panels/
|   `-- <Panel>/
|       `-- <ownerButtonId>.flowcell-source.json
`-- SupportScripts/
    `-- <runner-specific install/delete support>
```

The folder names and runner are declared by the program manifest. Do not infer
them from the program name in new code.

## Canonical Script Chain

```text
Git Scripts or any selected source
        -> install-time input only
owned Local Scripts package
        -> installed executable source of truth
.flowcell-source.json
        -> active owner/runner/source identity
button-state.json
        -> canonical Button UI and interaction state
```

`<Program> Git Scripts` is the tracked, shareable catalog. Add Script and Add
Tool Set may select from that catalog or from any other user-chosen source. The
catalog is never the live installed source.

Installation copies the selected file or manifest package into
`<Program> Local Scripts/<ownerButtonId>/source/`. That owned copy is the only
source normal execution may run. A Git pull, catalog edit, rename, or deletion
does not silently change an installed Button. Use Update to replace the owned
package deliberately.

The panel folder contains active source records, not runnable duplicate scripts.
Each `<ownerButtonId>.flowcell-source.json` identifies the matching Local
package, installed source, runner, program/panel identity, and optional tool-set
or event metadata. Runtime rejects an active record whose package, owner, path,
or program manifest no longer agrees.

`flowcellbackend/local/button-system/button-state.json` is canonical for Button
records, geometry, skins, popouts, fans, and settings. It references active
sources by stable source identity; it does not duplicate source packages.

## Tracked and Local Data

Tracked:

- program manifests and runner adapters;
- Git Scripts catalog packages;
- frontend/native implementation;
- documentation.

Ignored local/install state:

- `flowcellbackend/local/`, including `button-system/button-state.json`;
- `Programs/*/* Local Scripts/**`;
- `Programs/*/Panels/**`;
- generated program runtime output and caches.

Ignored does not mean disposable. Local Scripts packages and active records are
owned installed state and are managed through Button install/update/delete
transactions.

## Add, Update, and Delete

Add creates a fresh owner Button ID, Local package, install record, active source
record, and Button graph. It refuses to overwrite an existing owner.

Update requires that owner's existing package and active record. It stages a
replacement package, deploys runner-specific output, atomically replaces the
active record, and sends the previous package to the Recycle Bin only after the
replacement succeeds.

Delete removes the full owned lifecycle:

- the owner Button and dependent placements, child Buttons, popouts, and fan
  memberships from canonical Button state;
- bindings whose script path or action belongs to the owner;
- runner-specific generated runtime artifacts and registrations;
- the active `.flowcell-source.json` record;
- the complete Local Scripts owner package.

Destructive steps are quarantined and rollback capable. Final owned files are
sent to the Recycle Bin. The selected/catalog source remains untouched.

## Program Registration

Startup preflight reads each `flowcell.program.json`, creates its declared Local
Scripts and Panels roots when needed, and synchronizes program registration into
`flowcellbackend/local/bindings.ini`. Program registration makes a program rail
available; it does not create program-specific script Buttons.

See `docs/flowcell-program-registry.md` for the manifest contract.

## Migration Boundary

Only `FlowCellFrontend/src-tauri/src/program_sources/migrate.rs` may read old
program-script records or source comment directives. It converts them into owned
Local packages and active records during one-time bootstrap/recovery. Normal
runtime modules consume only program manifests, owned Local Scripts packages,
`.flowcell-source.json`, and canonical Button state.
