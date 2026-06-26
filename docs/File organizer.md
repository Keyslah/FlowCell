# Organization Profiles

Organization Profiles are the dynamic Windows Files organization path.

- `Setup Organization` saves the active project's profile to `<project root>/organize-folder.profile.json` (a single visible file alongside the organizer's other `organize-folder.*` sidecars — no hidden `.flowcell` folder) via **Save** / **Save and Rescan**. Older profiles in `.flowcell/organization-profile.json` are still read as a fallback and migrate to the new file on the next save.
- **Save Profile** splits the save into two locations:
  - `FlowCell/local/Folder Trees/<profile name>/` — a clean, empty mirror of the project's folder structure only (no `.flowcell`, no per-role folders), so it can be copied/pasted manually.
  - `FlowCell/local/Folder Tree Profiles/<profile name>.json` — the profile data (roles, file-type assignments, etc.), kept separate from the folder structure.
- The **Load profile** rail (top of the Project Tree panel) loads a saved profile's roles into the editor **without changing your project root** — it never overwrites the root you are working on.
- **Copy root to profile** (Load profile rail) mirrors the current project root's folder structure into the profile section as an unsaved scratch tree, so you can see and edit its depth structure before saving it as a named profile. No profile file is written until you **Save Profile**; deleting a folder from a scratch tree only drops it from the in-memory list (no disk change).
- Only **one folder is selected at a time** across the Project tree and the profile section — selecting a folder in one tree clears the other. Clicking a folder in **either** tree shows that folder's assigned roles/folders in the editor on the right (so you can view and edit a profile folder's assignments too).
- **Add Folder** targets the active folder in whichever tree it's in. For a **project** folder it creates the folder on disk under the project root; for a **loaded saved profile** folder it creates the folder in that profile's on-disk skeleton (`FlowCell/local/Folder Trees/<name>/`) so it persists; for an **unsaved scratch** profile folder (from Copy root to profile) it adds it to the in-memory tree, kept when you **Save Profile**. Because the profile section is the source of truth for a loaded/scratch profile's folders, **Save Profile** / **Apply to profile** re-save that tree rather than the project tree, so folders added there are never overwritten. **Delete folder** under the project tree and **Apply profile** remain project-scoped.
- The **Project root** rail (to the left of Load profile) chooses the target root. **Apply profile to root** builds the loaded profile's folder structure, writes `organize-folder.profile.json`, and applies its conditional program-folder rules. Existing files are never deleted or overwritten.
- **Make button** (under Save Profile) generates `Programs/Windows/Windows Git Scripts/Files/apply_profile_<slug>.ps1` and copies it into the Windows `Files` panel as `<ProfileName>.ps1`, creating a panel button named after the profile (reselect the Files panel to see it). That script reads a folder path from the clipboard and applies the saved profile to it (via `Programs/Windows/SupportScripts/Apply-OrganizationProfileCore.ps1`). The name `setup_organization` is reserved for the launcher button.
- Each profile stores one project root plus role rows.
- A role contains a stable role ID, allowed file types, and a destination folder relative to the project root.
- **Program Folders** is a separate working-file rule editor. A program rule owns file types such as `.blend`, creates `01 src/<number> <Program>/01 live`, `02 snapshots`, `03 archive`, and `04 trash` only when needed, and reuses an existing numbered folder with the same program name.
- Program-folder routing only considers working files inside `01 src` plus loose files dropped directly at the project root (which get filed into `01 src`). Every `01 src` sibling — `02 builds`, `03 releases`, the big top-level `04 archive`, etc. — is left untouched, and any program's own `02 snapshots`/`03 archive`/`04 trash` (numbered or not) is skipped, so already-filed, archived, or trashed files are never moved back into `01 live`/`02 snapshots`.
- Distinct working-file families all go to `01 live`. For a clear version family, the most recently modified file goes to `01 live` and older variants are renamed into `02 snapshots` as `(S01)`, `(S02)`, and so on.
- `New Organization` reads the active profile by default and moves files whose extension maps to exactly one role.
- If one extension is assigned to multiple roles, the organizer leaves that file in place and records it as ambiguous. Role-specific workflow buttons should pass a specific profile/role instead of guessing from extension alone.
- The legacy `Organize Folder` run no longer writes `organize-folder.log.txt`. Its full run record (file moves, renames, recycled dirs, duplicates, snapshots, conflicts, unresolved items, plus rollback data) goes into `organize-folder.undo.json`.

To make a profile-specific organization button, copy `Programs/Windows/Windows Git Scripts/Files/new_organization_profile_template.ps1`, rename it, and set:

```powershell
$ProfileId = 'your-profile-id'
```

Then add/copy that script into the desired Windows Files panel button location.
