# Blender Buttons

Use this Ai prompt when you want one Blender script turned into a FlowCell ready script:


Convert the pasted Blender Python functionality into a FlowCell-ready Blender button/tool script. First inspect the source and briefly confirm what the script actually does, including any prompts or pickers the user expects. 

Preserve the original behavior, but remove Blender add-on packaging, panels, menus, registration UI, keymaps, modal listeners, startup handlers, and any automatic execution on import. Output one clean .py action script that exposes run_flowcell_action(context=None, data=None) as the main entrypoint. If the original script contains multiple useful actions, keep them together in one file and expose each as a top-level perform_<short_action_name>(context=None, data=None) function, with run_flowcell_action calling the most obvious default action. 

Put a one-line Description: comment at the top. Keep helper functions the actions need. Do not create a Blender UI panel. Do not execute anything at import time. Make the code safe to run from FlowCell's Blender bridge on the current Blender context. If the original tool depends on a prompt like an image picker or naming dialog, keep that interaction in the rewritten action unless the user explicitly asks to remove it.


## What To Hand FlowCell

- one normal Blender `.py` file
- top-level `run_flowcell_action`, `main`, or `perform_*`
- scene-driven logic that works from the current Blender context

Do not hand FlowCell:

- a full add-on package
- a background listener or bootstrap file
- a script that only works from Blender's Text Editor
- a file with only helpers like `handle`, `server`, `bootstrap`, or `register`



## What Add Button Does

1. asks for a Blender `.py` file
2. validates the entrypoint shape
3. installs or registers the action
4. copies the code into the configured live Blender runtime file, which is `...\scripts\addons\flowtest_actions.py` for this FlowTest sandbox
5. creates the matching wrapper in `Blender\FlowCellButtons`
6. adds the button to the current panel
7. tells you whether Blender needs a reload or restart

## Main Paths

- `Blender\FlowCellButtons` for generated wrappers
- `Blender\SupportScripts` for bridge helpers
- `Blender\ManagedActions` for managed custom action sources
- `Blender\config.json` and `FlowCell\local\private\blender.config.local.json` for config
- `Blender\ScriptDump` for rough or private test files, not normal button sources
