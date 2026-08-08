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

## The page

Two panes, one job: build a folder tree and say what belongs in each folder.

**Folders** behaves like Explorer. `+ Folder` adds a child under the selection,
`Rename` renames in place (children move with the parent), `Delete` removes the
folder and its subtree from the profile. Nothing on disk is touched.

`Load tree from folder…` copies the directory structure of any chosen folder
into the editor. It reads only: nothing in the source is created, renamed,
moved, or deleted. It fills breadth-first, so the optional cap — a checkbox plus
a count, default 12 — keeps the useful shallow structure instead of one deep
spine, and reports `Loaded N of M folders` when it stops early.

Folders owns the full left column of the window, top to bottom; Files and
Installed Buttons stack in the right column.

**Files** owns the selected folder. File groups appear as checkboxes, each with
`edit` (change that group's file types, keeping its stable ID so every profile
referencing it follows the change) and a delete control, with `+ Create group`
at the bottom of the list. Below them a field takes extensions assigned directly
to this folder, then `Collect all other files here`, then `Ignore this folder`.
`Apply` commits the selection onto the folder, so leaving and returning shows
exactly the boxes that were applied. Unapplied edits are discarded on selection
change.

A folder row shows assigned groups **by name**, so a 39-extension group reads as
`3D` rather than its extension list; the full list is the row's tooltip.

Groups come in two kinds. A **file group** describes a kind of content and is
ticked onto a folder. A **program file group** describes one application own
project files and additionally gets its own section, where it can claim a
root-level folder named after the group. That folder is created only when at
least one matching file is actually present, and it claims the group file types
ahead of every ordinary folder route. A program folder may also name another
saved profile to organize its inside; if that profile assigns the same program
group to one of its own folders, that folder wins and overrides the program
folder root.

Ignored folders are still created. Ignoring always protects the folder and its
whole subtree from both routing and cleanup, so the shipped `Program Tree`
profile (`02 snapshots`, `03 archive`, `04 trash`, all ignored) exists purely to
build that structure inside a program folder. The optional stale cleanup instead
targets ignored paths recorded by the **previous** profile's project marker when
the current profile no longer owns them.

The shipped shared groups are `Images`, `3D` (neutral and interchange formats
only), `Blender`, `Illustrator`, and `Fusion 360`. No extension appears in two
groups, so assigning two of them to different folders never collides.

Folders whose effective extensions collide are flagged inline while editing, and
`save-profile` rejects the profile outright — the conflict is settled at design
time so nothing prompts at run time.

## Profile contract

Profiles use `flowcell.windows.setup-organization.profile.v3` and are stored at:

`flowcellbackend/local/program-data/windows/setup-organization/profiles/<profileId>.json`

`folders` is an ordered flat list of project-relative paths; **that order is the
routing order**. Each entry carries `groupIds` (references into the shared file
group namespace, resolved at run time so editing a group changes routing
everywhere), `fileTypes` (extensions assigned directly), `ignored`, and
`catchAll`.

Two optional booleans own post-route cleanup. `recycleOtherFolders` sends
unlisted folders to the Recycle Bin only after routing and only when they are
empty. `recyclePreviousIgnoredFolders` additionally reads the previous
`.flowcell-project.json` and recycles ignored paths from that marker that the
current profile no longer owns; those contents are not routed first. It is
invalid unless `recycleOtherFolders` is enabled. Current profile folders,
including ignored folders and configured program/nested-profile paths, are
protected under both settings. Both switches default to false for existing v3
profiles.

At most one folder may set `catchAll`, and an ignored folder may not; both rules
fail closed at save. The catch-all collects every file no folder claimed by
extension, including files with no extension at all.

The lowercase GUID `profileId` is stable across renames. Profile names must be
unique because the name becomes the installed Button's label.

There are no roles, program folders, live/snapshot versioning, root bindings,
resolution modes, or runtime ambiguity prompts. v1 and v2 profiles are not read.

Shared file groups live beside the profiles in `file-groups.json`, so they
survive a profile being deleted and a Button being updated or reinstalled.

## Generated profile Buttons

Installing requires a saved profile and a destination Panel. The Windows-owned
capability creates a short-lived stage at
`flowcellbackend/local/program-data/windows/setup-organization/staging/<token>/`
containing a closed `stage.json` plus `source/flowcell.script.json` and
`source/organize_folder.ps1`. Native authorization re-resolves the active owner
and action, requires the exact stage namespace, format, token, program, import
kind, and package identity, rejects links and reparse points throughout the
stage tree, and verifies SHA-256 digests for both manifest and script before the
trusted host installs it through the normal Add Button transaction.

The generated Button is labelled with the profile name and carries the profile
ID in its generated script, so it works on the first press with no prompt. A
press:

1. resolves the target from its argument, else the clipboard (a copied folder or
   a copied path), requiring an absolute existing directory that is not a
   reparse point;
2. validates an existing project marker before any mutation and safely resolves
   its previous ignored-folder paths;
3. builds the current profile's logical ownership, including configured program
   and nested-profile paths even when no matching program file activates them;
   unresolved configured group or nested-profile data aborts before mutation
   whenever either folder-cleanup option is enabled;
4. creates every missing current profile folder;
5. scans the target **recursively**, skipping current ignored subtrees and stale
   previous-profile ignored trees selected for cleanup;
6. moves each file to the first folder in profile order whose effective
   extensions contain its own, leaving files already in place;
7. sends anything still unclaimed to the catch-all folder when the profile
   declares one, and otherwise leaves it exactly where it is, at any depth;
   never overwrites — a name collision is skipped and reported;
8. recycles the retired `organize-folder.profile.json` and
   `organize-folder.undo.json` artifacts wherever they were found outside a
   protected ignored subtree;
9. when enabled, recycles stale ignored folders from the previous marker as
   untouched trees, then recycles empty folders not used by the current profile;
   reparse points, cleanup errors, and folders containing an unmoved file fail
   closed and remain on disk, and a failed stale-tree recycle keeps the previous
   marker so the next run can retry it;
10. writes an operation journal under the shared `undo/` namespace;
11. after cleanup succeeds, atomically rewrites the project marker with the
    current profile state.

Because the scan is recursive, `Ignore this folder` keeps the current profile's
subtree intact. The dependent cleanup switch applies only to ignored folders
left in the previous marker that the current profile no longer owns.

## Project marker

Every run reads and then writes `.flowcell-project.json` in the target folder,
defined by
`formats/project-marker.v1.schema.json`. It records the profile identity, the
run timestamp, a lowercase-extension-to-relative-folder destination map, the
catch-all folder (empty when the profile declares none), and the profile's
logical ignored folders. Invalid, unsafe, directory, or reparse-point markers
abort before mutation so stale ignored content is never guessed. Missing or
invalid current program/nested-profile definitions also abort before mutation
when folder cleanup needs them to prove current ownership. An existing previous
ignored path that is not a safely traversed ordinary directory also aborts and
keeps the previous marker instead of dropping that path from cleanup history.

The marker is what lets other program packages follow whichever profile
organized a project rather than assuming one fixed layout. The Blender bridge
resolves the open `.blend`'s project root by walking up for the marker, and
resolves its STL and PNG export folders from the map, falling back to the legacy
`01 src/00 assets` layout only when no marker is present.

The map is a denormalized snapshot: it describes where files actually are, not
what the profile currently says. Editing a profile without re-running the Button
leaves the marker accurate to disk, which is what a program package needs.

## Deletion contract

Deleting Setup Organization removes its canonical Button graph, binding, active
record, installed page state, page window, source-owned runtime registration,
and complete Local Scripts owner package through the standard rollback-capable
Button deletion transaction. It leaves the tracked catalog package and the
explicitly shared profile and file-group namespaces intact.

Deleting a generated profile Button independently removes that generated owner's
canonical graph, binding, active record, runtime files, and complete Local
Scripts package. The saved profile remains reusable. Deleting a profile that an
installed Button still references fails closed and names the Buttons.
