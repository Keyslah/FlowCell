# Windows Git Scripts

This folder is the tracked Windows script catalog. Its subfolders organize
shareable sources for discovery; they are not active panels or runtime routes.

Add Button or Update copies the selected source into
`../Windows Local Scripts/<ownerButtonId>/source/`. Runtime execution resolves
the owner's `.flowcell-source.json` record under `../Panels/<Panel>/` and runs
only that installed copy. Later edits here do not alter an installed Button.

Multi-file entries are closed folders with `flowcell.script.json`. Selecting
the manifest or its declared entry installs the whole folder; selecting a
helper file is rejected. Mutable per-Button settings belong in the installed
owner package's `runtime/` folder, which Update preserves.

Deleting a Button removes its canonical state graph, active record, owned Local
Scripts package, bindings, and owned runtime artifacts. It never deletes the
catalog source in this folder.
