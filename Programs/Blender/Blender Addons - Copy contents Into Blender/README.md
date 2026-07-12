# Blender Add-ons - Copy Contents Into Blender

This folder is the paste-ready FlowCell Blender bridge/add-on bundle for a fresh
setup or repair. It contains transport and runtime support, not a pre-baked
script or Button inventory.

If Blender already has the FlowCell add-on enabled and working, do not copy the
bundle again. When installation or repair is needed, copy this folder's contents
directly into Blender's user add-ons folder:

`%APPDATA%\Blender Foundation\Blender\<Blender version>\scripts\addons`

After copying, Blender's `scripts\addons` folder should contain:

- `flowcell_actions.py`
- `flowcell_bridge.py`
- `blender_bridge_flowcell\`

Reload the FlowCell add-on or restart Blender after copying the bundle or after
FlowCell deploys changed owner-scoped bridge actions.

Blender tool sources belong in the tracked `Blender Git Scripts` catalog. Add
Script or Add Tool Set copies the selected source into
`Blender Local Scripts/<ownerButtonId>/source/`; that owned copy is the runtime
source of truth. `Panels/<Panel>/<ownerButtonId>.flowcell-source.json` is the
active record, and canonical Button state owns presentation and deletion.
Never create a Button by copying a tool into this add-on bundle.
