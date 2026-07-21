# Setup Organization Page Package

Setup Organization is an ordinary page-enabled Windows Button package at:

`Programs/Windows/Windows Git Scripts/Files/Setup Organization/`

Its `flowcell.script.json` owns the page HTML/CSS/JavaScript, strict action and
data schemas, PowerShell capability adapter, generated-Button template, and
window/config metadata. Add Button or the Windows Add Program contribution plan
copies that complete package into
`Programs/Windows/Windows Local Scripts/<ownerButtonId>/source/`; the installed
copy is the runtime source of truth. FlowCell Core supplies only the generic
installed-page sandbox, broker, source installer, and deletion transaction.

## Page Workflow

The page can:

- choose and scan any explicit existing Windows folder root;
- show its immediate folders and loose files;
- create a contained descendant folder;
- send one confirmed contained descendant folder and its contents to the
  Windows Recycle Bin;
- create, edit, order, save, load, and apply routing profiles;
- choose any current Windows Panel and install a generated profile Button there.

The selected root must be an absolute real directory. Root and descendant path
resolution rejects traversal, containment escapes, symbolic links, and reparse
points. Folder deletion is exact, root-contained, confirmed in the page, and
recoverable through the Recycle Bin.

## Profile Contract

Profiles use the closed format
`flowcell.windows.setup-organization.profile.v1` and are stored only at:

`flowcellbackend/local/program-data/windows/setup-organization/profiles/<profileId>.json`

The lowercase GUID `profileId` is stable across renames. Each ordered rule has a
stable ID, display name, contained target folder, enabled state, optional file
extensions, optional case-insensitive filename fragment, and `matchAll` switch.
The first enabled matching rule wins.

Applying a profile creates every enabled target folder that is missing, then
examines only loose files immediately inside the chosen root. A file is moved to
the first matching target. Existing destination files are never overwritten;
collisions and reparse-point files are skipped, and unmatched files stay where
they are. The result reports ensured folders plus moved, skipped, and unmatched
counts.

Per-page preferences such as the last root, selected profile, generated-Button
Panel, and draft name live in that installed owner's strict
`runtime/installed-page-state.json`. Shared profiles are program data rather
than Button-owned runtime state, so they remain available when the Setup
Organization Button is updated, reinstalled, or deleted.

## Generated Profile Buttons

Installing a profile Button requires a saved profile and an explicit destination
Panel. The Windows-owned capability creates one short-lived stage at:

`flowcellbackend/local/program-data/windows/setup-organization/staging/<token>/`

The stage contains a closed `stage.json` plus
`source/flowcell.script.json` and `source/apply_profile.ps1`. Native authorization
re-resolves the active Setup Organization owner/action, requires the exact stage
namespace, format, token, program, import kind, package/profile identity, and
source path, rejects links/reparse points throughout the bounded stage tree, and
verifies SHA-256 digests for both manifest and script. Only then does the trusted
host install the package through the normal Add Button transaction. The stage is
discarded after success/failure, and a durable cleanup journal removes an
authorized stage after an interrupted process without broad directory cleanup.

The generated Button reads an existing destination folder from its argument or
the clipboard, loads its exact saved profile ID from the shared clean namespace,
and applies the same first-match routing contract. It does not call a Core
organizer, depend on the Setup page window, or execute a catalog/support copy.

## Deletion Contract

Deleting Setup Organization removes its canonical Button graph, binding, active
record, installed page state, page window, source-owned runtime registration,
and complete Local Scripts owner package through the standard rollback-capable
Button deletion transaction. It leaves the tracked catalog package and the
explicitly shared profile namespace intact.

Deleting a generated profile Button independently removes that generated
owner's canonical graph, binding, active record, runtime files, and complete
Local Scripts package. The saved shared profile remains reusable by the Setup
page and any other generated Button that references it. No generated catalog
file or alternate Core execution path is created.
