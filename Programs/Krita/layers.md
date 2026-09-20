# Krita Layers

The Layers panel contains ordinary, independently installed FlowCell script Buttons.
It requires the FlowCell Layers Krita Python plugin in `SupportScripts/flowcell_layers`.
Install it with `SupportScripts/Install-KritaLayers.ps1` while Krita is closed, then
open Krita. The installer backs up existing plugin/configuration files and verifies
the deployed files. It does not replace brush resources or reset Krita settings.

## Organization

Top to bottom: **Live**, **Snapshots**, **Trash**, **Archive**. Live is a pass-through
organizational group. The storage roots are hidden. Existing object groups retain
their internal structure, masks, blending, opacity and child visibility.

**Make Layers** is the only organizer. Every press creates/reuses and orders the
four roots, then routes unorganized top-level layers and direct Live children:
visible items stay/go in Live; hidden copy-family versions go to Snapshots when
exactly one visible working family matches; other hidden items go to Trash. The
existing contents of Snapshots, Trash and Archive remain stored. Hidden children
inside an object group stay inside that group. Matching recognizes `Rose copy`,
`Rose copy 2`, trailing parenthetical notes and Blender `.001` duplicate suffixes;
it does not merge merely similar names or guess between multiple visible families.

Krita's internal processing nodes (including `decorations-wrapper-layer`) and
document reference images stay at the document root and are excluded from artwork
actions and visibility/lock baselines. Helpers misplaced into the organizational
groups by an older plugin version are returned to the root without deleting them.

## Named creation and selection

**Make Group** and **Make Layer** always prompt for a name before creation.
Highlight one group to create inside it, or one paint layer to use its containing
group. Make Group creates a nested group; Make Layer creates a paint layer.
Groups may nest arbitrarily. No paint-layer wrapping occurs. Cancel does nothing;
blank names are rejected; collisions get an available numeric suffix.

Targeted commands read Krita's actual highlighted layer rows, not selected pixels.
Selecting a parent plus its descendant processes the parent only once. Masks
travel with their owning layer/group; standalone mask selection is rejected.
The four top-level organizational roots cannot be deleted or stored as artwork.

## Buttons

| Button | Behavior |
| --- | --- |
| `make layers` | Create/reuse roots and organize again using the rules above. |
| `make group` / `make layer` | Prompt for a name, create in the selected containing group, select the result. |
| `rename` | Prompt for each highlighted layer; cancelling leaves every name unchanged. |
| `duplicate` | Duplicate complete highlighted subtrees beside their originals. |
| `delete` | Delete the highlighted layers/groups, including hidden/locked targets and descendants; protect roots and Archive/Trash contents. |
| `snapshot` | Save an editable numbered `sN` copy for every highlighted Live item. |
| `<` / `>` | Cycle one selected family's original Live and `sN` versions, wrapping in either direction. |
| `restore` | Copy the chosen stored version back into its recorded Live position; move the displaced working item into Trash; retain the source. |
| `back` | Consume the newest snapshot into Live; move the displaced working item into Trash. |
| `add to live` | Copy stored versions into Live as additional, independent working items. |
| `copy live` | Prompt for a new Live group, duplicate selected working layers into it, hide the originals. |
| `trash` | Move working items to numbered `TN` entries. |
| `archive` / `copy archive` | Move/copy working items to numbered `AN` entries. |
| `empty trash` | Confirm, then remove contents while retaining the root. |
| `empty groups` | Remove empty working groups; preserve storage and system roots. |
| `b vis` / `set vis` | Save/restore per-document visibility states. |
| `b lock` / `set lock` | Save/restore per-document lock states. |
| `cycle group` | Show/select the next working sibling; leave that sibling showing. |
| `expand` / `collapse` | Expand/collapse highlighted group subtrees. |
| `flatten` | Invoke Krita's native merge for multiple highlighted layers, or flatten for a single target. |

There are no Sort, Sort Live, End Preview, or 3D buttons.

## Version cycling and persistence

Cycling exchanges the editable version in the original Live stacking position
with a saved version in the hidden Snapshots folder. It never flattens or consumes
a version. The original working version appears as `Live` in storage while another
version is active. The chosen version stays showing and is editable; cycling again
retains those edits in that version. Other artwork and the storage root visibility
remain unchanged. The result notification identifies the active version.

Version families, original nesting/stack positions and baselines are document
annotations and persist when the `.kra` document is saved. They are not external
file backups. Structural changes made through Krita's Python API are not guaranteed
to be undoable. Save the document before reorganizing important artwork; snapshots
and Trash provide explicit recovery for the commands that use them.

## Bridge and validation

The local bridge accepts a fixed allowlist of actions, never Python source or
arbitrary file paths. Transient requests use the current process/session token
and expire. Modal naming and confirmation run on Krita's main thread. The
PowerShell caller propagates failures through FlowCell's existing script runner.

`Build-LayersPackages.py` regenerates self-contained catalog packages and manifest
entries. Only explicitly enabled contributions install through FlowCell's normal
startup source lifecycle. The 26 Buttons share one installed Krita extension;
removing a Button does not remove that extension.

`selftest.py` runs only when Krita was started with `FLOWCELL_KRITA_TEST=1` and the
fixed `self_test` bridge command is requested. It creates and closes disposable
documents and never runs operations against pre-existing documents.
