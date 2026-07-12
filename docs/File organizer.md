# Organization Profiles

Organization Profiles define the dynamic Windows Files organization workflow.

## Profile Storage

- Setup Organization saves the active project's profile to
  `<project root>/organize-folder.profile.json`, alongside the other visible
  `organize-folder.*` sidecars. Older
  `.flowcell/organization-profile.json` files remain a read fallback and migrate
  to the visible file on the next save.
- Save Profile stores the empty folder skeleton at
  `flowcellbackend/local/Folder Trees/<profile name>/` and stores roles,
  file-type assignments, and other profile data separately at
  `flowcellbackend/local/Folder Tree Profiles/<profile name>.json`.
- Each profile stores one project root plus role rows. A role has a stable role
  ID, allowed file types, and a destination folder relative to the project root.

## Editing A Profile

- The Load profile rail loads a saved profile's roles without changing the
  current project root.
- Copy root to profile mirrors the current root's folder structure into an
  unsaved scratch profile tree. It writes nothing until Save Profile.
- Only one folder is selected across the Project tree and profile tree.
  Selecting a folder in either tree shows that folder's assignments in the
  editor.
- Add Folder targets the active tree. In the Project tree it creates the folder
  under the project root. In a loaded profile it creates the folder in that
  profile's saved skeleton. In an unsaved scratch profile it changes only the
  in-memory tree until Save Profile.
- Save Profile and Apply to profile re-save the profile tree when one is loaded
  or staged, so folders added there are not overwritten by the Project tree.
  Delete folder under the Project tree and Apply profile remain project-scoped.

## Applying And Organizing

- The Project root rail chooses the target root. Apply profile to root creates
  the loaded folder structure, writes `organize-folder.profile.json`, and runs
  conditional program-folder rules. Existing files are never deleted or
  overwritten.
- Program Folders is a separate working-file rule editor. A program rule owns
  file types such as `.blend` and creates
  `01 src/<number> <Program>/01 live`, `02 snapshots`, `03 archive`, and
  `04 trash` only when needed. It reuses an existing numbered folder with the
  same program name.
- Program-folder routing considers working files inside `01 src` and loose files
  dropped directly at the project root. Other `01 src` siblings and every
  program's snapshots, archive, and trash folders are skipped.
- Distinct working-file families go to `01 live`. For a clear version family,
  the most recently modified file stays in `01 live`; older variants are renamed
  into `02 snapshots` as `(S01)`, `(S02)`, and so on.
- The catalog script `new_organization.ps1` reads the active profile by default
  and moves a file only when its extension maps to exactly one role.
- If an extension maps to multiple roles, the organizer leaves the file in place
  and records it as ambiguous. A role-specific installed script should pass an
  explicit profile and role instead of guessing from the extension.
- The legacy Organize Folder run no longer writes
  `organize-folder.log.txt`. Its full run record and rollback data are written to
  `organize-folder.undo.json`.

## Make Button

Make Button requires a saved or loaded profile. It performs the complete
canonical Button lifecycle:

1. It creates or refreshes the tracked catalog source at
   `Programs/Windows/Windows Git Scripts/Files/apply_profile_<slug>.ps1`.
2. It installs a private copy under
   `Programs/Windows/Windows Local Scripts/<ownerButtonId>/source/`.
3. It writes the active record at
   `Programs/Windows/Panels/Files/<ownerButtonId>.flowcell-source.json`.
4. It creates or updates that profile's deterministic canonical Button in
   Windows / Files.

The installed script reads a destination folder path from the clipboard and
applies the saved profile through
`Programs/Windows/SupportScripts/Apply-OrganizationProfileCore.ps1`. Running
Make Button again for the same profile updates the same owner instead of
creating a parallel Button.

The Git Scripts file is catalog source only. Runtime execution resolves the
active record and runs the owned Local Scripts copy. Deleting the Button removes
its canonical state graph, active record, owned package, bindings, and owned
runtime artifacts; it leaves the catalog source intact. Do not manually copy an
organization script into `Panels` or Local Scripts.
