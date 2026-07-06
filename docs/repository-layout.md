# Repository Layout

## Program Script Workflow

`Programs/` is the visible program rail source. Each program folder owns three script areas:

- `Programs/<Program>/Panels/<Panel>/`: local panel buttons and panel-local runnable script copies. This is ignored by Git.
- `Programs/<Program>/<Program> Local Scripts/`: flat private backup/core copies created by Add Script/Add Button. This is ignored by Git and is never automatically pruned.
- `Programs/<Program>/<Program> Git Scripts/`: tracked shared script sources. This is the only program script library intended to move through GitHub.

Add Script/Add Button copies selected scripts into both the selected panel folder and the flat Local Scripts folder. If Local Scripts already has a byte-identical file, it reuses that copy; if a same-named file differs, the new copy gets a suffix such as `script__2.py`.

Panel deletes and button deletes only remove the panel copy or panel record. They do not remove files from Local Scripts.

## Public Source

- `flowcellbackend/`: PowerShell UI, AutoHotkey backend, helpers, runtime config, local state, and vendored libraries.
- `FlowCellFrontend/`: React/Tauri desktop frontend and native command host.
- `Programs/<Program>/<Program> Git Scripts/`: shared Git-synced script libraries, organized by panel subfolder.
- `Programs/Blender/SupportScripts/`: Blender installer, dispatcher, cleanup, and sync plumbing.
- `Programs/Blender/Blender Addons - Copy contents Into Blender/`: paste-ready Blender add-on files for Blender's `scripts/addons` folder.
- `Programs/*/ScriptDump/`: ignored loose/testing/old scripts with placeholder folders tracked.
- `tools/launcher/`: optional launcher source.


## Ignored Local Data

`flowcellbackend/local/` stores runtime state such as bindings, layouts, saved panels, recorded macros, logs, private settings, temp files, and build/runtime artifacts.

Program-local ignored data includes panel button folders, flat Local Scripts folders, ScriptDump contents, generated Blender actions, and caches.

## Panel Script Import

The main FlowCell Add Script button opens in the selected program's Git Scripts folder, preferring the current panel's subfolder when present. The selected scripts can still come from anywhere.

For Windows, Illustrator, and Photoshop, the panel copy is the runnable script. For Blender, Add script creates/keeps the panel-local `.py` copy plus the `.flowcell-panel-item.json` button record, and the record points at the panel-local source.

Git Scripts are not modified by Add Script/Add Button after the initial migration; they change only through normal repo edits and Git pulls.
