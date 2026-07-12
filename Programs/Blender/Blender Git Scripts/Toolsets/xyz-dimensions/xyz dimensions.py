# Description: Show live X, Y, and Z dimensions for the active selected object in inches.





import bpy


INCHES_PER_METER = 39.37007874015748
DIMENSION_COMMANDS = {
    "dimension_x": ("x", "X"),
    "dimension_y": ("y", "Y"),
    "dimension_z": ("z", "Z"),
}


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


def _requested_command(data=None):
    if not isinstance(data, dict):
        return ""
    value = data.get("command") or data.get("action") or ""
    return str(value).strip().lower()


def _unsupported_command_result(command):
    expected = ", ".join(DIMENSION_COMMANDS)
    if command:
        message = f"Unknown dimensions command '{command}'. Expected {expected}."
    else:
        message = f"Missing dimensions command. Expected {expected}."
    return _result(
        "error",
        message,
        command=command,
        supportedCommands=list(DIMENSION_COMMANDS),
    )


def _dimension_payload(context=None, data=None):
    command = _requested_command(data)
    axis_spec = DIMENSION_COMMANDS.get(command)
    if axis_spec is None:
        return _unsupported_command_result(command)

    axis_key, axis_label = axis_spec
    ctx = _ctx(context)
    try:
        ctx.view_layer.update()
    except Exception:
        pass

    obj = _selected_object(ctx)
    if obj is None:
        display = f"{axis_label} -- in"
        response_data = {
            "command": command,
            "axis": axis_label,
            "axisKey": axis_key,
            "label": axis_label,
            "dimensionInches": None,
            "display": display,
        }
        return _result(
            "ok",
            f"Select an object to read its {axis_label} dimension.",
            command=command,
            axis=axis_label,
            axisKey=axis_key,
            label=axis_label,
            selected=False,
            objectName="",
            dimensionInches=None,
            dimensionsInches={axis_key: None},
            display=display,
            displayDimensions={axis_key: "-- in"},
            data=response_data,
        )

    unit_scale = _scene_unit_scale(ctx)
    scale_to_inches = unit_scale * INCHES_PER_METER
    value = abs(float(getattr(obj.dimensions, axis_key))) * scale_to_inches
    value_display = f"{_format_inches(value)} in"
    display = f"{axis_label} {value_display}"
    response_data = {
        "command": command,
        "axis": axis_label,
        "axisKey": axis_key,
        "label": axis_label,
        "dimensionInches": value,
        "display": display,
    }

    return _result(
        "ok",
        f"{obj.name}: {display}",
        command=command,
        axis=axis_label,
        axisKey=axis_key,
        label=axis_label,
        selected=True,
        objectName=obj.name,
        dimensionInches=value,
        dimensionsInches={axis_key: value},
        display=display,
        displayDimensions={axis_key: value_display},
        unitScaleLength=unit_scale,
        data=response_data,
    )


def perform_dimensions_status(context=None, data=None):
    return _dimension_payload(context, data)


def run_flowcell_action(context=None, data=None):
    return perform_dimensions_status(context=context, data=data)
