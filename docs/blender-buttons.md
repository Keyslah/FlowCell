# Blender Buttons

Use this AI prompt when you want one Blender script turned into a FlowCell-ready script:

Convert the pasted Blender Python functionality into a FlowCell-ready Blender button/tool script. First inspect the source and briefly confirm what the script actually does, including any prompts or pickers the user expects.

Preserve the original behavior, but remove Blender add-on packaging, panels, menus, registration UI, keymaps, modal listeners, startup handlers, and any automatic execution on import. Output one clean `.py` action script that exposes `run_flowcell_action(context=None, data=None)` as the main entrypoint. If the original script contains multiple useful actions, keep them together in one file and expose each as a top-level `perform_<short_action_name>(context=None, data=None)` function, with `run_flowcell_action` calling the most obvious default action.

Put a one-line `Description:` comment at the top. Keep helper functions the actions need. Do not create a Blender UI panel. Do not execute anything at import time. Make the code safe to run from FlowCell's Blender bridge on the current Blender context. If the original tool depends on a prompt like an image picker or naming dialog, keep that interaction in the rewritten action unless the user explicitly asks to remove it.

## What To Hand FlowCell

- one or more normal Blender `.py` files
- top-level `run_flowcell_action`, `main`, or `perform_*`
- scene-driven logic that works from the current Blender context

Do not hand FlowCell a full add-on package, a background listener/bootstrap file, a Text Editor-only script, or a file with only helpers such as `handle`, `server`, `bootstrap`, or `register`.

## Public Sharing Flow

1. Put shareable scripts in `Programs\Blender\Blender Git Scripts`, usually under the matching panel subfolder.
2. Open the Blender tab in FlowCell.
3. Click `Add Button`.
4. Select one or more `.py` files.
5. FlowCell copies each file into flat `Blender Local Scripts` and into the selected panel folder, then installs/registers the panel copy.
6. Reload the Blender FlowCell add-on or restart Blender if FlowCell says runtime reload is required.
7. Use the new button.

## What Add Button Does

1. Opens in the current panel's `Blender Git Scripts` folder when available.
2. Validates the entrypoint shape and rejects obvious bootstrap/listener files.
3. Copies each selected source into `Blender Local Scripts`, reusing byte-identical copies and suffixing same-name conflicts.
4. Copies each selected source into the selected `Panels\<Panel>` folder as the runnable panel copy.
5. Registers each tool in the FlowCell Blender bridge custom-action registry and regenerates the live custom section.
6. Writes or updates the panel `.flowcell-panel-item.json` record so `sourcePath` points at the panel-local `.py` file.
7. Leaves `executionTarget` empty for Blender buttons so runtime clicks do not launch PowerShell wrappers.
8. Tells you whether Blender must reload the FlowCell add-on or restart before runtime verification reflects the new code.

## Folder Roles

- `Blender Git Scripts`: tracked shareable source tools, organized by panel subfolder.
- `Blender Local Scripts`: ignored flat private backup/core copies. FlowCell never auto-deletes these.
- `Panels\<Panel>`: ignored local button records and panel-local runnable `.py` copies.
- `ManagedActions`: ignored bridge-managed runtime action source.
- `FlowCellButtons`: deprecated per-button wrapper location, retained only as a purged compatibility folder.
- `SupportScripts`: dispatcher/sync plumbing only.
- `AddonScripts`: Blender refresh/sidebar helper scripts only.
- `ScriptDump`: ignored loose/testing/old scripts.

## Delete Behavior

Deleting a Blender button removes the panel record and panel-local copy through host-owned cleanup where safe. It may prune orphaned generated action files, but it never deletes from `Blender Local Scripts`.

## Runtime Reload Rule

After Blender bridge, add-on, registry, generated-action, or managed-action changes, Blender must reload the FlowCell add-on or restart before runtime verification reflects the new code. FlowCell reports this when it can detect that the action is not yet callable in the current Blender session.
