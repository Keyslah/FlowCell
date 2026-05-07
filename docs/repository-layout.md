# Repository Layout

## Public Source

- `FlowCell/`: PowerShell UI, AutoHotkey backend, helpers, and vendored libraries.
- `Blender/`: Blender bridge config and FlowCell button wrappers.
- `Illustrator/`: public Illustrator scripts.
- `Illustrator/HelperScripts/`: internal Illustrator helpers only.
- `Windows/`: public Windows scripts.
- `Photoshop/`: public Photoshop script area.
- `tools/launcher/`: optional launcher source.

## Ignored Local Data

`FlowCell/local/` is the local-only runtime area. It stores:

- bindings
- panel state
- popout layouts
- saved panels
- recorded macros
- logs
- private machine-specific settings
- temp files
- build artifacts

This split keeps GitHub updates from overwriting a user's local FlowCell setup.

Machine-specific Windows helper paths should be supplied through local environment overrides. The public example lives at `examples/Windows/windows.env.example`.

## Panel Script Import

The main FlowCell `Add Script` button now:

- opens in the current program folder
- allows selecting multiple scripts
- creates one button per selected script
- applies changes only to the currently selected panel
- strips `file_`, `util_`, and `org_` from the displayed button label only
