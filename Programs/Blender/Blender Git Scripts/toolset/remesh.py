# Description: Create, update, and apply Blender Remesh modifiers from a compact FlowCell tool set.



# FLOWCELL_KIND: remesh_toolset
# FLOWCELL_CHILD: mode_voxel | Voxel | Use Voxel remesh mode.
# FLOWCELL_CHILD: mode_smooth | Smooth | Use Smooth remesh mode.
# FLOWCELL_CHILD: mode_sharp | Sharp | Use Sharp remesh mode.
# FLOWCELL_CHILD: mode_blocks | Blocks | Use Blocks remesh mode.
# FLOWCELL_CHILD: set_voxel_size_mm | 0.10 | Set Voxel Size in millimeters.
# FLOWCELL_CHILD: set_adaptivity | 0.00 | Set Voxel Adaptivity.
# FLOWCELL_CHILD: toggle_smooth_shading | SS | Toggle Smooth Shading.
# FLOWCELL_CHILD: set_octree_depth | 6 | Set Octree Depth.
# FLOWCELL_CHILD: set_scale | 0.90 | Set Remesh Scale.
# FLOWCELL_CHILD: toggle_remove_disconnected | RD | Toggle Remove Disconnected.
# FLOWCELL_CHILD: set_threshold | 0.10 | Set Remove Disconnected Threshold.
# FLOWCELL_CHILD: set_sharpness | 1.00 | Set Sharp remesh Sharpness.
# FLOWCELL_CHILD: create_update_remesh | Create | Create or update the active object's Remesh modifier.
# FLOWCELL_CHILD: apply_remesh | Apply | Apply the active object's Remesh modifier.

from __future__ import annotations

import bpy


REMESH_MODIFIER_NAME = "FlowCell_Remesh"
DEFAULT_MODE = "VOXEL"
DEFAULT_VOXEL_SIZE_MM = 0.1
DEFAULT_ADAPTIVITY = 0.0
DEFAULT_SMOOTH_SHADING = False
DEFAULT_OCTREE_DEPTH = 6
DEFAULT_SCALE = 0.9
DEFAULT_REMOVE_DISCONNECTED = True
DEFAULT_THRESHOLD = 0.1
DEFAULT_SHARPNESS = 1.0


bl_info = {
    "name": "FlowCell Remesh Toolset",
    "author": "Aaron & GPT-5",
    "version": (1, 0),
    "blender": (3, 0, 0),
    "location": "FlowCell",
    "description": "Create, update, and apply Remesh modifiers from a FlowCell tool set.",
    "category": "Object",
}


def _ctx(context=None):
    return context or bpy.context


def _data_value(data, *keys, default=None):
    if not isinstance(data, dict):
        return default
    for key in keys:
        if key in data:
            return data.get(key)
    return default


def _clamp_float(value, fallback, minimum, maximum):
    try:
        parsed = float(value)
    except Exception:
        parsed = fallback
    return max(minimum, min(maximum, parsed))


def _clamp_int(value, fallback, minimum, maximum):
    try:
        parsed = int(round(float(value)))
    except Exception:
        parsed = fallback
    return max(minimum, min(maximum, parsed))


def _normalize_mode(value, fallback=DEFAULT_MODE):
    mode = str(value or "").strip().upper()
    if mode in {"VOXEL", "SMOOTH", "SHARP", "BLOCKS"}:
        return mode
    return fallback


def _scene_unit_scale(context=None):
    scale = getattr(_ctx(context).scene.unit_settings, "scale_length", 1.0) or 1.0
    try:
        return float(scale) or 1.0
    except Exception:
        return 1.0


def _mm_to_blender_units(value_mm, context=None):
    return (float(value_mm) / 1000.0) / _scene_unit_scale(context)


def _ensure_scene_props():
    if not hasattr(bpy.types.Scene, "flowcell_remesh_mode"):
        bpy.types.Scene.flowcell_remesh_mode = bpy.props.EnumProperty(
            name="Remesh Mode",
            items=[
                ("VOXEL", "Voxel", ""),
                ("SMOOTH", "Smooth", ""),
                ("SHARP", "Sharp", ""),
                ("BLOCKS", "Blocks", ""),
            ],
            default=DEFAULT_MODE,
        )
    if not hasattr(bpy.types.Scene, "flowcell_remesh_voxel_size_mm"):
        bpy.types.Scene.flowcell_remesh_voxel_size_mm = bpy.props.FloatProperty(
            name="Voxel Size (mm)",
            default=DEFAULT_VOXEL_SIZE_MM,
            min=0.001,
            soft_min=0.001,
            soft_max=100.0,
            precision=4,
        )
    if not hasattr(bpy.types.Scene, "flowcell_remesh_adaptivity"):
        bpy.types.Scene.flowcell_remesh_adaptivity = bpy.props.FloatProperty(
            name="Adaptivity",
            default=DEFAULT_ADAPTIVITY,
            min=0.0,
            max=1.0,
        )
    if not hasattr(bpy.types.Scene, "flowcell_remesh_smooth_shading"):
        bpy.types.Scene.flowcell_remesh_smooth_shading = bpy.props.BoolProperty(
            name="Smooth Shading",
            default=DEFAULT_SMOOTH_SHADING,
        )
    if not hasattr(bpy.types.Scene, "flowcell_remesh_octree_depth"):
        bpy.types.Scene.flowcell_remesh_octree_depth = bpy.props.IntProperty(
            name="Octree Depth",
            default=DEFAULT_OCTREE_DEPTH,
            min=1,
            max=12,
        )
    if not hasattr(bpy.types.Scene, "flowcell_remesh_scale"):
        bpy.types.Scene.flowcell_remesh_scale = bpy.props.FloatProperty(
            name="Scale",
            default=DEFAULT_SCALE,
            min=0.1,
            max=1.0,
        )
    if not hasattr(bpy.types.Scene, "flowcell_remesh_remove_disconnected"):
        bpy.types.Scene.flowcell_remesh_remove_disconnected = bpy.props.BoolProperty(
            name="Remove Disconnected",
            default=DEFAULT_REMOVE_DISCONNECTED,
        )
    if not hasattr(bpy.types.Scene, "flowcell_remesh_threshold"):
        bpy.types.Scene.flowcell_remesh_threshold = bpy.props.FloatProperty(
            name="Threshold",
            default=DEFAULT_THRESHOLD,
            min=0.0,
            max=1.0,
        )
    if not hasattr(bpy.types.Scene, "flowcell_remesh_sharpness"):
        bpy.types.Scene.flowcell_remesh_sharpness = bpy.props.FloatProperty(
            name="Sharpness",
            default=DEFAULT_SHARPNESS,
            min=0.0,
            max=10.0,
        )


def _active_mesh(context=None):
    ctx = _ctx(context)
    obj = getattr(ctx, "active_object", None)
    if not obj or getattr(obj, "type", None) != "MESH":
        raise ValueError("Select an active mesh object before using Remesh.")
    return obj


def _ensure_object_mode(context=None):
    ctx = _ctx(context)
    obj = getattr(ctx, "active_object", None)
    if obj and getattr(obj, "mode", "OBJECT") != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def _get_or_create_modifier(obj):
    modifier = obj.modifiers.get(REMESH_MODIFIER_NAME)
    if modifier is None:
        modifier = obj.modifiers.new(name=REMESH_MODIFIER_NAME, type="REMESH")
    if modifier.type != "REMESH":
        raise ValueError(f"Modifier '{REMESH_MODIFIER_NAME}' exists but is not a Remesh modifier.")
    return modifier


def _apply_settings(modifier, context=None):
    scene = _ctx(context).scene
    mode = _normalize_mode(getattr(scene, "flowcell_remesh_mode", DEFAULT_MODE))
    modifier.mode = mode

    if hasattr(modifier, "use_smooth_shade"):
        modifier.use_smooth_shade = bool(getattr(scene, "flowcell_remesh_smooth_shading", False))

    if mode == "VOXEL":
        modifier.voxel_size = _mm_to_blender_units(
            getattr(scene, "flowcell_remesh_voxel_size_mm", DEFAULT_VOXEL_SIZE_MM),
            context,
        )
        modifier.adaptivity = _clamp_float(
            getattr(scene, "flowcell_remesh_adaptivity", DEFAULT_ADAPTIVITY),
            DEFAULT_ADAPTIVITY,
            0.0,
            1.0,
        )
        return

    modifier.octree_depth = _clamp_int(
        getattr(scene, "flowcell_remesh_octree_depth", DEFAULT_OCTREE_DEPTH),
        DEFAULT_OCTREE_DEPTH,
        1,
        12,
    )
    modifier.scale = _clamp_float(
        getattr(scene, "flowcell_remesh_scale", DEFAULT_SCALE),
        DEFAULT_SCALE,
        0.1,
        1.0,
    )
    if hasattr(modifier, "use_remove_disconnected"):
        modifier.use_remove_disconnected = bool(
            getattr(scene, "flowcell_remesh_remove_disconnected", DEFAULT_REMOVE_DISCONNECTED)
        )
    if hasattr(modifier, "threshold"):
        modifier.threshold = _clamp_float(
            getattr(scene, "flowcell_remesh_threshold", DEFAULT_THRESHOLD),
            DEFAULT_THRESHOLD,
            0.0,
            1.0,
        )
    if mode == "SHARP" and hasattr(modifier, "sharpness"):
        modifier.sharpness = _clamp_float(
            getattr(scene, "flowcell_remesh_sharpness", DEFAULT_SHARPNESS),
            DEFAULT_SHARPNESS,
            0.0,
            10.0,
        )


def _remesh_state(scene):
    return {
        "mode": _normalize_mode(getattr(scene, "flowcell_remesh_mode", DEFAULT_MODE)),
        "voxelSizeMm": _clamp_float(
            getattr(scene, "flowcell_remesh_voxel_size_mm", DEFAULT_VOXEL_SIZE_MM),
            DEFAULT_VOXEL_SIZE_MM,
            0.001,
            1000.0,
        ),
        "adaptivity": _clamp_float(
            getattr(scene, "flowcell_remesh_adaptivity", DEFAULT_ADAPTIVITY),
            DEFAULT_ADAPTIVITY,
            0.0,
            1.0,
        ),
        "smoothShading": bool(getattr(scene, "flowcell_remesh_smooth_shading", DEFAULT_SMOOTH_SHADING)),
        "octreeDepth": _clamp_int(
            getattr(scene, "flowcell_remesh_octree_depth", DEFAULT_OCTREE_DEPTH),
            DEFAULT_OCTREE_DEPTH,
            1,
            12,
        ),
        "scale": _clamp_float(
            getattr(scene, "flowcell_remesh_scale", DEFAULT_SCALE),
            DEFAULT_SCALE,
            0.1,
            1.0,
        ),
        "removeDisconnected": bool(
            getattr(scene, "flowcell_remesh_remove_disconnected", DEFAULT_REMOVE_DISCONNECTED)
        ),
        "threshold": _clamp_float(
            getattr(scene, "flowcell_remesh_threshold", DEFAULT_THRESHOLD),
            DEFAULT_THRESHOLD,
            0.0,
            1.0,
        ),
        "sharpness": _clamp_float(
            getattr(scene, "flowcell_remesh_sharpness", DEFAULT_SHARPNESS),
            DEFAULT_SHARPNESS,
            0.0,
            10.0,
        ),
    }


def _status(context=None, message="Remesh tool set ready.", status="ok", **extra):
    ctx = _ctx(context)
    _ensure_scene_props()
    result = {"status": status, "message": message, **_remesh_state(ctx.scene)}
    result.update(extra)
    return result


def _set_value(context, prop_name, raw_value, fallback, minimum, maximum, integer=False):
    scene = _ctx(context).scene
    value = (
        _clamp_int(raw_value, fallback, minimum, maximum)
        if integer
        else _clamp_float(raw_value, fallback, minimum, maximum)
    )
    setattr(scene, prop_name, value)
    return value


def create_update_remesh(context=None):
    ctx = _ctx(context)
    _ensure_scene_props()
    _ensure_object_mode(ctx)
    obj = _active_mesh(ctx)
    modifier = _get_or_create_modifier(obj)
    _apply_settings(modifier, ctx)
    return _status(
        ctx,
        message=f"Updated Remesh modifier on '{obj.name}'.",
        objectName=obj.name,
        modifierName=modifier.name,
    )


def apply_remesh(context=None):
    ctx = _ctx(context)
    _ensure_scene_props()
    _ensure_object_mode(ctx)
    obj = _active_mesh(ctx)
    modifier = _get_or_create_modifier(obj)
    _apply_settings(modifier, ctx)
    ctx.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    return _status(ctx, message=f"Applied Remesh modifier on '{obj.name}'.", objectName=obj.name)


def run_flowcell_action(context=None, data=None):
    ctx = _ctx(context)
    data = data or {}
    _ensure_scene_props()
    scene = ctx.scene
    command = str(_data_value(data, "command", "action", default="status")).strip().lower()

    if command in {"", "status", "state"}:
        return _status(ctx)

    mode_map = {
        "mode_voxel": "VOXEL",
        "voxel": "VOXEL",
        "mode_smooth": "SMOOTH",
        "smooth": "SMOOTH",
        "mode_sharp": "SHARP",
        "sharp": "SHARP",
        "mode_blocks": "BLOCKS",
        "blocks": "BLOCKS",
    }
    if command in mode_map:
        scene.flowcell_remesh_mode = mode_map[command]
        return _status(ctx, message=f"Remesh mode set to {scene.flowcell_remesh_mode}.")

    if command == "set_mode":
        requested_mode = _normalize_mode(
            _data_value(data, "mode", "value", default=scene.flowcell_remesh_mode),
            scene.flowcell_remesh_mode,
        )
        scene.flowcell_remesh_mode = requested_mode
        return _status(ctx, message=f"Remesh mode set to {scene.flowcell_remesh_mode}.")

    raw_value = _data_value(data, "value", default=None)
    if command == "set_voxel_size_mm":
        value = _set_value(ctx, "flowcell_remesh_voxel_size_mm", raw_value, DEFAULT_VOXEL_SIZE_MM, 0.001, 1000.0)
        return _status(ctx, message=f"Voxel size set to {value:.4f} mm.")
    if command == "set_adaptivity":
        value = _set_value(ctx, "flowcell_remesh_adaptivity", raw_value, DEFAULT_ADAPTIVITY, 0.0, 1.0)
        return _status(ctx, message=f"Adaptivity set to {value:.2f}.")
    if command == "toggle_smooth_shading":
        scene.flowcell_remesh_smooth_shading = not bool(scene.flowcell_remesh_smooth_shading)
        return _status(ctx, message="Smooth Shading toggled.")
    if command == "set_octree_depth":
        value = _set_value(ctx, "flowcell_remesh_octree_depth", raw_value, DEFAULT_OCTREE_DEPTH, 1, 12, integer=True)
        return _status(ctx, message=f"Octree Depth set to {value}.")
    if command == "set_scale":
        value = _set_value(ctx, "flowcell_remesh_scale", raw_value, DEFAULT_SCALE, 0.1, 1.0)
        return _status(ctx, message=f"Scale set to {value:.2f}.")
    if command == "toggle_remove_disconnected":
        scene.flowcell_remesh_remove_disconnected = not bool(scene.flowcell_remesh_remove_disconnected)
        return _status(ctx, message="Remove Disconnected toggled.")
    if command == "set_threshold":
        value = _set_value(ctx, "flowcell_remesh_threshold", raw_value, DEFAULT_THRESHOLD, 0.0, 1.0)
        return _status(ctx, message=f"Threshold set to {value:.2f}.")
    if command == "set_sharpness":
        value = _set_value(ctx, "flowcell_remesh_sharpness", raw_value, DEFAULT_SHARPNESS, 0.0, 10.0)
        return _status(ctx, message=f"Sharpness set to {value:.2f}.")
    if command in {"create_update_remesh", "create", "update"}:
        return create_update_remesh(ctx)
    if command in {"apply_remesh", "apply"}:
        return apply_remesh(ctx)

    raise ValueError(f"Unsupported Remesh command: {command}")


def register():
    _ensure_scene_props()


def unregister():
    for prop_name in (
        "flowcell_remesh_mode",
        "flowcell_remesh_voxel_size_mm",
        "flowcell_remesh_adaptivity",
        "flowcell_remesh_smooth_shading",
        "flowcell_remesh_octree_depth",
        "flowcell_remesh_scale",
        "flowcell_remesh_remove_disconnected",
        "flowcell_remesh_threshold",
        "flowcell_remesh_sharpness",
    ):
        if hasattr(bpy.types.Scene, prop_name):
            delattr(bpy.types.Scene, prop_name)


if __name__ == "__main__":
    register()
