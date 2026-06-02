

# Blender Scripts

## Blender Setup

Blender needs FlowCell bridge files installed into Blender's user add-ons folder.

Use `Programs\Blender\Blender Addons - Copy contents Into Blender`.

`%APPDATA%\Blender Foundation\Blender\<Blender version>\scripts\addons`

make sure that add-ons folder contains:

- `flowcell_actions.py`
- `flowcell_bridge.py`
- `blender_bridge_flowcell\`

After fresh install or added script:
1. uncheck and recheck Blender add-on or restart Blender after FlowCell registers new generated actions
2. Enable the `FlowCell` add-on in Blender if it is not already enabled.
3. Start FlowCell and select the Blender program tab.
4. Refresh the Blender add-on or restart Blender after FlowCell registers new generated actions.

## Add Script Prompt

Use this prompt when you want Codex to turn pasted Blender Python into a FlowCell-ready Add Script file. Single script buttons and child-bearing toolsets use the same prompt, but toolsets must include the FlowCell metadata comments and command routing shown below.

Before generating the script, tell Codex: `Use the FlowCell AI skills in docs/ai-skills.md. For Blender Add Script/toolset work, use flow-test and toolsets; add svgtools for exact SVG layouts, blender-theme for theme/HDRI work, and react-tauri-button-skin-contract when button skins, hitboxes, or imported visual code are involved.`

Convert the pasted Blender Python functionality into one clean FlowCell-ready Blender `.py` action file. First inspect the source and briefly confirm what the tool actually does, including prompts, file pickers, modal behavior, scene properties, selected-object requirements, and UI controls the user expects.

Preserve the useful behavior, but remove full add-on packaging, panels, menus, keymaps, startup handlers, modal listeners that run forever, and automatic execution on import. Do not create a Blender UI panel for FlowCell. `register()` may register only scene properties/classes required by the action logic. All actual work must run through `run_flowcell_action(context=None, data=None)`.

Output a normal Python file with:

- `# Description: ...` as the first meaningful comment.
- `run_flowcell_action(context=None, data=None)` as the main entrypoint.
- Optional `perform_<short_action_name>(context=None, data=None)` helper entrypoints for child actions.
- No import-time execution except constant definitions and function/class definitions.
- A dictionary return value with at least `status` and `message`.
- For toolboxes, a `status` or `state` command that returns current UI state fields.
- Child command routing through `data.get("command") or data.get("action")`.
- Short child labels and tooltips that fit FlowCell capsules.

If the tool has more than one button/control, make it a FlowCell toolset. Add `FLOWCELL_KIND` when it matches a dedicated FlowCell layout, and add one `FLOWCELL_CHILD` line for every child button/control.

## FlowCell Metadata Contract

FlowCell reads these source comments when `Add Script` creates the panel record:

```python
# Description: Short tooltip for the owner button.
# FLOWCELL_KIND: remesh_toolset
# FLOWCELL_CHILD: mode_voxel | Voxel | Use Voxel remesh mode.
# FLOWCELL_CHILD: create_update_remesh | Create | Create or update the active object's Remesh modifier.
```

The parser uses:

- `FLOWCELL_KIND` -> `PanelScriptFileRecord.kind`
- `FLOWCELL_CHILD` -> `PanelScriptFileRecord.children`
- child fields -> `PanelScriptChildRecord { slot, label, tooltip }`
- `slot` -> the `command`/`action` value sent to `run_flowcell_action`

Known dedicated Blender toolset kinds and required slots:

| Kind | Required slots |
| --- | --- |
| `rotate_toolset` | `axis_z`, `axis_y`, `axis_x`, `preset_30`, `preset_45`, `preset_90`, `preset_180`, `preset_270`, `center_geometry`, `center_origin`, `center_world`, `center_cursor`, `center_object`, `mode_transform`, `mode_distribute`, `apply_negative`, `apply_positive` |
| `alignment_toolset` | `z_min`, `z_center`, `z_max`, `z_surface`, `z_geo`, `y_min`, `y_center`, `y_max`, `y_surface`, `y_geo`, `x_min`, `x_center`, `x_max`, `x_surface`, `x_geo`, `center_everything` |
| `boolean_toolset` | `operation_intersect`, `operation_union`, `operation_difference`, `toggle_self_intersection`, `toggle_hole_tolerant`, `toggle_hide_cutter`, `toggle_backup_active`, `run_boolean` |
| `remesh_toolset` | `mode_voxel`, `mode_smooth`, `mode_sharp`, `mode_blocks`, `create_update_remesh`, `apply_remesh` |
| `tri_poly_toolset` | `triangle_equilateral`, `triangle_isosceles`, `triangle_50`, `triangle_right`, `triangle_scalene`, `polygon_create` |
| `dimensions_toolset` | `dimension_x`, `dimension_y`, `dimension_z` |
| `smart_axis_toolset` | `baseline`, `cycle_x`, `cycle_y`, `cycle_z`, `toggle_live` |
| `toolset` | Any child-bearing script that should open in the generic FlowCell toolbox. |

Special signatures:

- Flatten/Revolve opens its dedicated toolbox when children include `flatten_profile` and `generate_revolve`.
- Theme opens its dedicated toolbox when children include `browse_theme`, `absorb_theme`, `apply_theme`, `apply_hdri`, and `apply_world_strength`.

## Single Button Example

Use this shape for one normal button:

```python
# Description: Move the selected objects to the world origin.

from __future__ import annotations

import bpy


def _ctx(context=None):
    return context or bpy.context


def run_flowcell_action(context=None, data=None):
    ctx = _ctx(context)
    selected = list(getattr(ctx, "selected_objects", []) or [])
    if not selected:
        return {"status": "error", "message": "Select at least one object."}

    for obj in selected:
        obj.location = (0.0, 0.0, 0.0)

    return {
        "status": "ok",
        "message": f"Moved {len(selected)} object(s) to world origin.",
        "changed": len(selected),
    }
```

## Generic Toolset Example

Use this shape when the tool has multiple child buttons but does not need a dedicated FlowCell layout:

```python
# Description: Simple transform nudge toolset.
# FLOWCELL_KIND: toolset
# FLOWCELL_CHILD: nudge_x_plus | X+ | Move selection one unit on X.
# FLOWCELL_CHILD: nudge_x_minus | X- | Move selection negative one unit on X.
# FLOWCELL_CHILD: status | Status | Report selected-object count.

from __future__ import annotations

import bpy


def _ctx(context=None):
    return context or bpy.context


def _result(status="ok", message="", **extra):
    return {"status": status, "message": message, **extra}


def _selected(context=None):
    return list(getattr(_ctx(context), "selected_objects", []) or [])


def _nudge(context=None, amount=1.0):
    objects = _selected(context)
    if not objects:
        return _result("error", "Select at least one object.", selected=0)
    for obj in objects:
        obj.location.x += amount
    return _result("ok", f"Nudged {len(objects)} object(s).", selected=len(objects), amount=amount)


def run_flowcell_action(context=None, data=None):
    data = data or {}
    command = str(data.get("command") or data.get("action") or "status").strip().lower()

    if command in {"", "status", "state"}:
        return _result("ok", "Nudge toolset ready.", selected=len(_selected(context)))
    if command == "nudge_x_plus":
        return _nudge(context, 1.0)
    if command == "nudge_x_minus":
        return _nudge(context, -1.0)

    raise ValueError(f"Unsupported nudge command: {command}")
```

## Stateful Toolset Example

Use this shape for a dedicated layout or any toolbox with toggles, values, and a live state display:

```python
# Description: Example Remesh-style toolset with mode, value, toggle, create, and apply commands.
# FLOWCELL_KIND: remesh_toolset
# FLOWCELL_CHILD: mode_voxel | Voxel | Use Voxel remesh mode.
# FLOWCELL_CHILD: mode_smooth | Smooth | Use Smooth remesh mode.
# FLOWCELL_CHILD: mode_sharp | Sharp | Use Sharp remesh mode.
# FLOWCELL_CHILD: mode_blocks | Blocks | Use Blocks remesh mode.
# FLOWCELL_CHILD: set_voxel_size_mm | 0.10 | Set Voxel Size in millimeters.
# FLOWCELL_CHILD: toggle_smooth_shading | SS | Toggle Smooth Shading.
# FLOWCELL_CHILD: create_update_remesh | Create | Create or update the active object's Remesh modifier.
# FLOWCELL_CHILD: apply_remesh | Apply | Apply the active object's Remesh modifier.

from __future__ import annotations

import bpy


DEFAULT_MODE = "VOXEL"
DEFAULT_VOXEL_SIZE_MM = 0.10
MODIFIER_NAME = "FlowCell_Remesh"


def _ctx(context=None):
    return context or bpy.context


def _ensure_scene_props():
    if not hasattr(bpy.types.Scene, "flowcell_example_remesh_mode"):
        bpy.types.Scene.flowcell_example_remesh_mode = bpy.props.EnumProperty(
            name="Mode",
            items=[("VOXEL", "Voxel", ""), ("SMOOTH", "Smooth", ""), ("SHARP", "Sharp", ""), ("BLOCKS", "Blocks", "")],
            default=DEFAULT_MODE,
        )
    if not hasattr(bpy.types.Scene, "flowcell_example_voxel_size_mm"):
        bpy.types.Scene.flowcell_example_voxel_size_mm = bpy.props.FloatProperty(
            name="Voxel Size (mm)",
            default=DEFAULT_VOXEL_SIZE_MM,
            min=0.001,
        )
    if not hasattr(bpy.types.Scene, "flowcell_example_smooth"):
        bpy.types.Scene.flowcell_example_smooth = bpy.props.BoolProperty(name="Smooth Shading", default=False)


def _state(context=None, message="Remesh example ready."):
    scene = _ctx(context).scene
    _ensure_scene_props()
    return {
        "status": "ok",
        "message": message,
        "mode": scene.flowcell_example_remesh_mode,
        "voxelSizeMm": float(scene.flowcell_example_voxel_size_mm),
        "smoothShading": bool(scene.flowcell_example_smooth),
    }


def _active_mesh(context=None):
    obj = getattr(_ctx(context), "active_object", None)
    if not obj or getattr(obj, "type", None) != "MESH":
        raise ValueError("Select an active mesh object.")
    return obj


def _get_or_create_modifier(obj):
    modifier = obj.modifiers.get(MODIFIER_NAME)
    if modifier is None:
        modifier = obj.modifiers.new(MODIFIER_NAME, "REMESH")
    return modifier


def _apply_settings(modifier, context=None):
    scene = _ctx(context).scene
    modifier.mode = scene.flowcell_example_remesh_mode
    if hasattr(modifier, "voxel_size"):
        modifier.voxel_size = float(scene.flowcell_example_voxel_size_mm) / 1000.0
    if hasattr(modifier, "use_smooth_shade"):
        modifier.use_smooth_shade = bool(scene.flowcell_example_smooth)


def run_flowcell_action(context=None, data=None):
    ctx = _ctx(context)
    data = data or {}
    _ensure_scene_props()
    scene = ctx.scene
    command = str(data.get("command") or data.get("action") or "status").strip().lower()

    if command in {"", "status", "state"}:
        return _state(ctx)
    if command in {"mode_voxel", "mode_smooth", "mode_sharp", "mode_blocks"}:
        scene.flowcell_example_remesh_mode = command.replace("mode_", "").upper()
        return _state(ctx, f"Mode set to {scene.flowcell_example_remesh_mode}.")
    if command == "set_voxel_size_mm":
        scene.flowcell_example_voxel_size_mm = max(0.001, float(data.get("value", scene.flowcell_example_voxel_size_mm)))
        return _state(ctx, f"Voxel size set to {scene.flowcell_example_voxel_size_mm:.3f} mm.")
    if command == "toggle_smooth_shading":
        scene.flowcell_example_smooth = not bool(scene.flowcell_example_smooth)
        return _state(ctx, "Smooth Shading toggled.")
    if command in {"create_update_remesh", "create", "update"}:
        obj = _active_mesh(ctx)
        modifier = _get_or_create_modifier(obj)
        _apply_settings(modifier, ctx)
        return _state(ctx, f"Updated {modifier.name} on {obj.name}.")
    if command in {"apply_remesh", "apply"}:
        obj = _active_mesh(ctx)
        modifier = _get_or_create_modifier(obj)
        _apply_settings(modifier, ctx)
        ctx.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        return _state(ctx, f"Applied {MODIFIER_NAME} on {obj.name}.")

    raise ValueError(f"Unsupported remesh command: {command}")


def register():
    _ensure_scene_props()
```

## Live Tool Note

Only use `import flowcell_bridge as live_bridge` when a tool truly needs a live timer, like Smart Axis. In that case, register a stable tool id with `live_bridge.register_live_tool(...)`, return live status fields from `status`, and still route button clicks through `run_flowcell_action`.

## Public Sharing Flow

1. Put shareable scripts in `Programs\Blender\Blender Git Scripts`, usually under the matching panel subfolder.
2. Open the Blender tab in FlowCell.
3. Click `Add Script`.
4. Select one or more `.py` files.
5. FlowCell copies each file into flat `Blender Local Scripts` and into the selected panel folder, then installs/registers the panel copy.
6. Reload the Blender FlowCell add-on or restart Blender if FlowCell says runtime reload is required.
7. Use the new script button.

## What Add Script Does

1. Opens in the current panel's `Blender Git Scripts` folder when available.
2. Validates the entrypoint shape and rejects obvious bootstrap/listener files.
3. Copies each selected source into `Blender Local Scripts`, reusing byte-identical copies and suffixing same-name conflicts.
4. Copies each selected source into the selected `Panels\<Panel>` folder as the runnable panel copy.
5. Registers each tool in the FlowCell Blender bridge custom-action registry and regenerates the live custom section.
6. Writes or updates the panel `.flowcell-panel-item.json` record so `sourcePath` points at the panel-local `.py` file.
7. Leaves `executionTarget` empty for Blender script buttons so runtime clicks do not launch PowerShell wrappers.
8. Tells you whether Blender must reload the FlowCell add-on or restart before runtime verification reflects the new code.

## Folder Roles

- `Blender Git Scripts`: tracked shareable source tools, organized by panel subfolder.
- `Blender Local Scripts`: ignored flat private backup/core copies. FlowCell never auto-deletes these.
- `Panels\<Panel>`: ignored local button records and panel-local runnable `.py` copies.
- `ManagedActions`: ignored bridge-managed runtime action source.
- `FlowCellButtons`: deprecated per-button wrapper location, retained only as a purged compatibility folder.
- `SupportScripts`: dispatcher/sync plumbing only.
- `Blender Addons - Copy contents Into Blender`: paste-ready Blender add-on files for Blender's `scripts\addons` folder.
- `ScriptDump`: ignored loose/testing/old scripts.

## Delete Behavior

Deleting a Blender script button removes the panel record and panel-local copy through host-owned cleanup where safe. It may prune orphaned generated action files, but it never deletes from `Blender Local Scripts`.

## Runtime Reload Rule

After Blender bridge, add-on, registry, generated-action, or managed-action changes, Blender must reload the FlowCell add-on or restart before runtime verification reflects the new code. FlowCell reports this when it can detect that the action is not yet callable in the current Blender session.

FlowCell resolves the bridge folder itself. If `automation.bridgeFolder` is already set, FlowCell uses that first; otherwise it scans Blender's user add-ons folders for `blender_bridge_flowcell`. You should only edit `automation.bridgeFolder` for a nonstandard Blender setup that auto-detection cannot see.
