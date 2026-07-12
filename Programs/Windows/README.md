# Windows Program Workflow

Windows is registered by `flowcell.program.json` and uses the shared canonical
Button source lifecycle. The Windows runner accepts the script types declared
by that manifest; it does not contain a pre-baked script or Button inventory.

## Source And Install Locations

- `Windows Git Scripts/` is the tracked source catalog. Catalog files are not
  runtime files.
- `Windows Local Scripts/<ownerButtonId>/` is the ignored, Button-owned install
  package. Its `source/` directory is the installed runtime source of truth;
  mutable per-Button settings belong under `runtime/`.
- `Panels/<Panel>/<ownerButtonId>.flowcell-source.json` is the active routing
  record. `Panels` does not contain runnable script copies.
- `SupportScripts/` contains core-service implementations and source material
  used while generating closed packages. Installed Buttons never execute it.
- `ScriptDump/` is a non-runtime scratch/reference area.

Nothing is executed automatically from Git Scripts or ScriptDump. Add Script
validates the selected source, creates a fresh owner, copies the source into its
Local Scripts package, writes the active record, and adds the Button to
canonical Button state. Update replaces that same owner's installed package.
Editing the original source does not silently change an installed Button.
For a folder with `flowcell.script.json`, selecting its declared entry promotes
the complete package, while selecting a helper is rejected. Update preserves
the Button's presentation, popout/fan references, and `runtime/` settings; a
role or tool-set slot change requires delete/re-add.

Deleting a source-owning Button removes its complete canonical graph, owned
bindings, active record, and Local Scripts package through the Recycle Bin
lifecycle. The original catalog or external source is left alone. Do not create
or repair a Button by manually copying files into `Panels` or Local Scripts.

## Utility Notes

The portable AutoHotkey on/off toggle lives in
[`tools/autohotkey v2 on off`](../../tools/autohotkey%20v2%20on%20off/). See
[Toggle AutoHotkey for anti-cheat games](../../docs/toggle-autohotkey-for-anticheat.md).
