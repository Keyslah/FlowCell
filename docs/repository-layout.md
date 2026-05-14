# Repository Layout

## Public Source

- `FlowCell/`: PowerShell UI, AutoHotkey backend, helpers, and vendored libraries.
- `Blender/`: Blender bridge config plus `Blender Scripts/` public library sources, `Blender Active Scripts/` managed source installs, `ManagedActions/` bridge-managed runtime sources, `FlowCellButtons/` user-facing wrappers, `SupportScripts/` install/sync plumbing, `AddonScripts/` Blender helpers, and `ScriptDump/` ignored loose/test files.
- `Illustrator/`: Illustrator library, managed active copies, runtime sync metadata, and helpers.
- `Illustrator/HelperScripts/`: internal Illustrator helpers only.
- `Windows/`: Windows library scripts plus managed active copies.
- `Photoshop/`: Photoshop library scripts plus managed active copies.
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

- opens in the current program's public `Scripts` library folder by default
- allows selecting multiple files and optional source folders from anywhere
- copies selected sources into that program's managed `Active Scripts` folder
- creates one button per installed managed script source
- applies changes only to the currently selected panel
- strips `file_`, `util_`, and `org_` from the displayed button label only
- stores the managed source path in FlowCell state and keeps the runtime execution target alongside it when the app needs a separate runnable location

On the Blender tab, the same control presents as `Add Button`. It stages selected sources into `Blender\Blender Active Scripts`, then reuses the existing Blender bridge pipeline to refresh `ManagedActions`, regenerate `FlowCellButtons`, and sync the live panel state without pointing buttons at random original pick locations.
