Support FlowCell: [![Donate via Stripe](https://img.shields.io/badge/Donate-Stripe-635BFF?logo=stripe&logoColor=white)](https://buy.stripe.com/aFa3cw2rF5fR7xyauo8AE01)
# FlowCell

FlowCell uses a PowerShell WPF UI and an AutoHotkey v2 backend to manage program Scripts, hotkeys, and macros.

AutoHotkey v2 is required  https://www.autohotkey.com/

When a script is added through FlowCell's panel UI, the normal Add Script button opens in the current program folder, supports multi-select, adds one button per selected script, and writes those buttons only into the currently selected panel. 

On the Blender tab, Add Button installs or registers the Blender-side action, creates or updates the wrapper in Blender/FlowCellButtons/, adds the button to the selected panel, and reports whether Blender must reload or restart before first use.

Preferred script prefix:
- `org_` for organization actions such as Illustrator layer tools or Blender collection tools
- `file_` for file-oriented scripts
- `util_` for utility scripts

This repository is structured for public source control. Publishable source stays in the repo. User state, bindings, popout layouts, saved panels, logs, generated temp files, private local settings, build output, and EXE artifacts live under `FlowCell/local/`, which is ignored by Git.

## How Blender buttons work

When you click `Add Button` in the Blender tab, FlowCell asks for one Blender `.py` script.

Use the Ai prompt at the top of [docs/blender-buttons.md](docs/blender-buttons.md) when you want Ai to convert a Blender script for flowcell.
A valid Blender button script should:

- be normal Blender Python, usually using `bpy`
- expose `run_flowcell_action`, `main`, or `perform_*`
- preserve the real interaction model, including prompts like file pickers when the source tool needs them

Do not give FlowCell a full add-on package, installer, background listener, or Text Editor-only script.

If the file is valid, FlowCell installs the Blender-side action, creates the matching wrapper in `Blender/FlowCellButtons/`, adds the button to the selected panel, and tells you whether Blender needs a reload or restart.

## Repository Layout

- `FlowCell/`: main app code, launcher scripts, helpers, vendored dependencies, and ignored local runtime storage under `FlowCell/local/`.
- `Blender/`: Blender integration files, including `FlowCellButtons/`, `SupportScripts/`, `ManagedActions/`, and the tracked public `config.json`.
- `Illustrator/`: user-facing Illustrator scripts.
- `Illustrator/HelperScripts/`: internal Illustrator helper scripts that are not meant to become user-facing buttons.
- `Windows/`: user-facing Windows scripts.
- `Photoshop/`: public Photoshop script area for repo-safe defaults.
- `docs/`: repository and maintenance documentation.
- `examples/`: public example configs with safe placeholders.
- `tools/`: source-only tooling, including the optional C# launcher source.
- `releases/`: release process notes. Built EXEs are not committed here.

## Local State Model

FlowCell keeps mutable runtime data in `FlowCell/local/`:

- `bindings.ini`
- `flowcell_state.json`
- `scan_state.ini`
- `layouts/`
- `panel_saves/`
- `recorded_actions/`
- `logs/`
- `private/local.settings.json`
- `temp/`
- `bin/`

GitHub pulls should not overwrite panel configuration, hotkeys, bindings, popout layouts, saved panels, or other user changes because those files are local-only.

Blender can also use a local override config at `FlowCell/local/private/blender.config.local.json`. The tracked `Blender/config.json` is the sanitized public default.

Some Windows helper scripts also use local environment overrides for machine-specific tooling. See `examples/Windows/windows.env.example`.

## Running FlowCell

- `run.cmd` at the repo root delegates to `FlowCell/run.cmd`.
- `FlowCell/run.cmd` launches the PowerShell UI or the AutoHotkey backend.
- Launcher logs are written to `FlowCell/local/logs/`.
- AutoHotkey v2 is required for FlowCell's backend automation.
- If AutoHotkey v2 is missing, FlowCell shows the official AutoHotkey download link.

## Issues and Discussions

- Use [GitHub Issues](https://github.com/Keyslah/Flowcell/issues) for bugs, regressions, broken scripts, and concrete feature work.
- Use [GitHub Discussions](https://github.com/Keyslah/Flowcell/discussions) for questions, script ideas, workflow proposals, and early feedback before implementation.
- If you are proposing a new script, mention the target folder and preferred prefix so it can be reviewed in the right place.

## Support FlowCell

[Donate to support FlowCell](https://buy.stripe.com/aFa3cw2rF5fR7xyauo8AE01)

## Releases

This repository does not commit built EXEs. The optional launcher source is kept in `tools/launcher/FlowCellLauncher.cs`. Build outputs belong in ignored local storage during development and should be distributed later through GitHub Releases.

For normal user-facing releases, include a portable AutoHotkey v2 runtime in `FlowCell/runtime/AutoHotkey64.exe`. Source checkouts can also place that runtime in `FlowCell/local/bin/`, or use a normal system install at `C:/Program Files/AutoHotkey/v2/`.
