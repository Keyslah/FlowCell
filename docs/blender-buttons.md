# Blender Buttons

Use this Ai prompt when you want one Blender script turned into a FlowCell ready script:


Convert the pasted Blender Python functionality into a FlowCell-ready Blender button/tool script. First inspect the source and briefly confirm what the script actually does, including any prompts or pickers the user expects. 

Preserve the original behavior, but remove Blender add-on packaging, panels, menus, registration UI, keymaps, modal listeners, startup handlers, and any automatic execution on import. Output one clean .py action script that exposes run_flowcell_action(context=None, data=None) as the main entrypoint. If the original script contains multiple useful actions, keep them together in one file and expose each as a top-level perform_<short_action_name>(context=None, data=None) function, with run_flowcell_action calling the most obvious default action. 

Put a one-line Description: comment at the top. Keep helper functions the actions need. Do not create a Blender UI panel. Do not execute anything at import time. Make the code safe to run from FlowCell's Blender bridge on the current Blender context. If the original tool depends on a prompt like an image picker or naming dialog, keep that interaction in the rewritten action unless the user explicitly asks to remove it.


## What To Hand FlowCell

- one or more normal Blender `.py` files
- top-level `run_flowcell_action`, `main`, or `perform_*`
- scene-driven logic that works from the current Blender context

Do not hand FlowCell:

- a full add-on package
- a background listener or bootstrap file
- a script that only works from Blender's Text Editor
- a file with only helpers like `handle`, `server`, `bootstrap`, or `register`

## Public Sharing Flow

1. download one `.py` tool or a zip of `.py` tools
2. extract the zip if needed
3. open the Blender tab in FlowTest
4. click `Add Button`
5. select one or more `.py` files
6. let FlowTest install/register them and sync the panel buttons
7. reload the Blender FlowTest add-on or restart Blender if FlowTest says runtime reload is required
8. use the new button

## What Add Button Does

1. asks for one or more Blender `.py` files
2. validates the entrypoint shape and rejects obvious bootstrap/listener files
3. copies each valid tool into `Blender\ManagedActions`
4. registers each tool in the FlowTest Blender bridge custom-action registry
5. regenerates the live custom section in the installed `...\scripts\addons\flowtest_actions.py`
6. creates or updates the matching wrapper in `Blender\FlowCellButtons`
7. adds the button to the current FlowTest panel
8. syncs `flowcell_state.json` and the saved Blender layout files
9. tells you whether Blender must reload the FlowTest add-on or restart before runtime verification reflects the new code

## Folder Roles

- `Blender\ScriptBank` = public/shareable downloadable tools and examples
- `Blender\ManagedActions` = installed Python action source
- `Blender\FlowCellButtons` = user-facing clickable wrapper scripts only
- `Blender\SupportScripts` = dispatcher/sync plumbing only
- `Blender\AddonScripts` = Blender refresh/sidebar helper scripts only
- `Blender\ScriptDump` and nested ScriptDump folders = ignored loose/testing/old scripts

## Delete Behavior

Deleting a Blender button from FlowTest is host-owned cleanup, not just a state edit. FlowTest removes the matching button/config entry, prunes orphaned custom-action registry entries, moves orphaned managed-action files to the Recycle Bin when safe, regenerates the live custom `flowtest_actions.py` section, and re-syncs the Blender button panels/layouts so deleted buttons do not reappear.

## Runtime Reload Rule

After Blender bridge, add-on, registry, generated-action, or managed-action changes, Blender must reload the FlowTest add-on or restart before runtime verification reflects the new code. FlowTest reports this when it can detect that the action is not yet callable in the current Blender session.

## Main Paths

- `Blender\ScriptBank` for shareable source tools and example downloads
- `Blender\FlowCellButtons` for generated wrappers
- `Blender\SupportScripts` for bridge helpers
- `Blender\ManagedActions` for managed custom action sources
- `Blender\AddonScripts` for Blender-side helper/refresh scripts
- `Blender\config.json` and `FlowCell\local\private\blender.config.local.json` for config
- `Blender\ScriptDump` for rough or private test files, not normal button sources
