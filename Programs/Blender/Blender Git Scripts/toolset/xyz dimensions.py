# Description: Show live X, Y, and Z dimensions for the active selected object in inches.




# FLOWCELL_KIND: dimensions_toolset
# FLOWCELL_CHILD: dimension_x | X | Display the active selected object's X dimension in inches.
# FLOWCELL_CHILD: dimension_y | Y | Display the active selected object's Y dimension in inches.
# FLOWCELL_CHILD: dimension_z | Z | Display the active selected object's Z dimension in inches.

import bpy


INCHES_PER_METER = 39.37007874015748


def _ctx(context=None):
    return context or bpy.context


def _result(status="ok", message="", changed=0, **extra):
    result = {"status": status, "message": message, "changed": changed}
    result.update(extra)
    return result


def _selected_object(context=None):
    ctx = _ctx(context)
    active = getattr(ctx, "active_object", None)
    selected = list(getattr(ctx, "selected_objects", []) or [])
    if active is not None and active in selected:
        return active
    return selected[0] if selected else None


def _scene_unit_scale(context=None):
    scene = getattr(_ctx(context), "scene", None)
    unit_settings = getattr(scene, "unit_settings", None)
    scale_length = getattr(unit_settings, "scale_length", 1.0)
    try:
        scale_length = float(scale_length)
    except (TypeError, ValueError):
        scale_length = 1.0
    return scale_length if scale_length > 0 else 1.0


def _format_inches(value):
    if abs(value) < 0.0005:
        value = 0.0
    text = f"{value:.3f}".rstrip("0").rstrip(".")
    return text or "0"


def _dimension_payload(context=None):
    ctx = _ctx(context)
    try:
        ctx.view_layer.update()
    except Exception:
        pass

    obj = _selected_object(ctx)
    empty_display = {"x": "-- in", "y": "-- in", "z": "-- in"}
    if obj is None:
        return _result(
            "ok",
            "Select an object.",
            selected=False,
            objectName="",
            dimensionsInches=None,
            displayDimensions=empty_display,
        )

    unit_scale = _scene_unit_scale(ctx)
    scale_to_inches = unit_scale * INCHES_PER_METER
    values = {
        "x": abs(float(obj.dimensions.x)) * scale_to_inches,
        "y": abs(float(obj.dimensions.y)) * scale_to_inches,
        "z": abs(float(obj.dimensions.z)) * scale_to_inches,
    }
    display = {axis: f"{_format_inches(value)} in" for axis, value in values.items()}
    message = f"{obj.name}: X {display['x']}, Y {display['y']}, Z {display['z']}"

    return _result(
        "ok",
        message,
        selected=True,
        objectName=obj.name,
        dimensionsInches=values,
        displayDimensions=display,
        unitScaleLength=unit_scale,
    )


def perform_dimensions_status(context=None, data=None):
    del data
    return _dimension_payload(context)


def run_flowcell_action(context=None, data=None):
    return perform_dimensions_status(context=context, data=data)
