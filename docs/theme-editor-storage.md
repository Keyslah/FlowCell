# Theme storage and portable files

The Theme Editor resolves its data root through `resolve_flowcell_local_root`.
Main's shared interface pages (`main`, `macro-lab`, and `binds`) use
`themes/main/`. A registered program uses `themes/<Program>/`, where `<Program>`
is the registry's canonical folder name, including spaces and capitalization.
The desktop Layout system continues to use `layouts/`.

`get_flowcell_theme_directory` and `list_flowcell_themes` accept the selected
`programName`; omitting it selects Main. Save, open, archive import, and export
validate the theme's target. A different program target is an error. Nested
storage rejects traversal, absolute child paths, Windows device names, symbolic
links, and reparse points. Program package storage can use the same nested
paths; a program contribution cannot select another target's theme folder.

`save_flowcell_theme_file` writes inside the canonical target library. A file
with the same nonempty theme ID can be updated. Identical data can be reused.
A different theme at the same path requires `replaceExisting: true` after an
explicit replacement choice. Atomic replacement uses the existing transaction
writer and its recoverable backup handling. Shared-page image assets are copied
into the theme's adjacent `.assets` folder using SHA-256 filenames, while the
original image stays where it was.

## File formats

Existing `FlowCellTheme` version 1 and version 2 files remain supported.
`FlowCellPortableTheme` version 1 wraps the version 2 appearance document with
portable tool references, exact internal arrangements, program contribution
state, and dependency version information. Its `.flowcell-theme-pack.json`
archive can embed images as `{path, sha256, base64}` entries. Image references
use `theme-asset:assets/<hash>.<extension>` while packaged and resolve to the
canonical target library when materialized. Executable sources use the normal
program-source installer, not the theme directory as an execution root.

The Blender contribution also reads these existing formats through its
declared field and asset mappings:

- `flowcell-tool-package/blender-theme/v1`
- `flowcell-blender-theme-pack-v1`
- `flowcell-blender-theme-v1`

Legacy files apply the fields they contain. The contribution owns conversion
of legacy Blender field names and resolves its declared image assets.

## Startup migration

`themes/.migration-v1.json` journals recognized theme saves from
`layouts/Main Page/` and complete saved Blender folders from `blender_themes/`.
Actual layout JSON is left in place. A program theme whose program is not
registered stays in its original location and produces a migration warning.

Migration copies and verifies every pending destination before retiring any
original. Original files and complete folders are moved into
`themes/.migration-backups-v1/`; they are not permanently deleted. Conflicting
names receive a content-hash suffix, preserving their format extension. A
restart resumes the journal. Failed migration is logged to `themes.log` and
does not prevent the app from starting.

Only completed journal entries are exposed by `get_theme_migration_path_map`.
The frontend updates its known theme appearance/selection storage, and installed
contributions remap their owner state through the existing owner-state writer.
The old `blender_themes` storage request redirects to the registered Blender
target, so an older installed contribution cannot create a second writable
library. The release-library configuration is rewritten after successful
migration, with its original retained beside the migration backups.

## Supplied themes

Main presets are shipped from `FlowCellFrontend/public/themes/main/` and included
as installer resources at `themes/main/`. A program declares a safe relative
`themeLibrary` in `flowcell.program.json`. Blender declares `themes/Blender`,
which the Blender release ZIP places under `Programs/Blender/themes/Blender/`.
These files are discovered separately from personal themes and enter personal
storage through the same import operation.

Blender release packaging reads its configured current library, rejects missing
assets and invalid embedded checksums, and copies complete portable archives
without changing their bytes. Previous per-folder packages are still accepted.
It never substitutes a stale catalog snapshot for the configured library.
