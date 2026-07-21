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
- `SupportScripts/` contains general Windows runner/shared support. It is not an
  alternate Button inventory or runtime-state root; page-product UI/actions and
  generated-Button helpers belong inside their own Git Scripts package and
  installed owner.
- `ScriptDump/` is a non-runtime scratch/reference area.

Nothing is executed automatically from Git Scripts or ScriptDump. Add Button
starts from the selected Windows Panel, locks that destination, validates the
selected raw file or exact root package manifest, creates a fresh owner, copies
the source into its Local Scripts package, writes the active record, and adds the
Button to canonical Button state. Update replaces that same owner's installed package.
Editing the original source does not silently change an installed Button.
For a folder with `flowcell.script.json`, selecting its declared entry promotes
the complete package, while selecting a helper is rejected. Update preserves
the Button's presentation, popout/fan references, and `runtime/` settings; a
role or tool-set slot change requires delete/re-add.

Add Program reads the manifest-authoritative Windows Panel/contribution
inventory. `Register program only` creates no source Button, while the default
or custom plan may explicitly enable the Windows-owned Setup Organization page
contribution. The exact enabled set is stored under
`flowcellbackend/local/program-registration/windows.json`; startup synchronizes
only that set. Add Panel can create an empty managed Windows Panel or copy one
validated external folder without modifying the source.

Deleting a source-owning Button removes its complete canonical graph, owned
bindings, active record, and Local Scripts package through the Recycle Bin
lifecycle. The original catalog or external source is left alone. Do not create
or repair a Button by manually copying files into `Panels` or Local Scripts.

## Setup Organization

`Windows Git Scripts/Files/Setup Organization/flowcell.script.json` is an
ordinary page-enabled script package. Its sandboxed UI, styles, PowerShell
actions, schemas, generated-Button template, configuration, and tests all live
inside that Windows-owned source. Core contains no organizer page, profile
implementation, product route, or fallback action.

The installed page stores its owner preferences under that Button's `runtime/`
folder and stores reusable profiles only under
`flowcellbackend/local/program-data/windows/setup-organization/profiles/`.
Generated profile Buttons are authenticated short-lived script packages that
enter through the same generic Button install/canonical transaction. Deleting a
generated Button removes its complete owner lifecycle while leaving the shared
profile available. Deleting Setup Organization removes its page owner and all
Button-owned state while retaining the tracked catalog and explicitly shared
profiles. See [`../../docs/File organizer.md`](../../docs/File%20organizer.md).

## Utility Notes

The portable AutoHotkey on/off toggle lives in
[`tools/autohotkey v2 on off`](../../tools/autohotkey%20v2%20on%20off/). See
[Toggle AutoHotkey for anti-cheat games](../../docs/toggle-autohotkey-for-anticheat.md).
