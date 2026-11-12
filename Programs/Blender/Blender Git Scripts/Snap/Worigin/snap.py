# Description: Snap selected Blender objects or the 3D cursor from FlowCell snap buttons.

import bpy
from mathutils import Vector


STATE_PREFIX = "flowcell_snap_next_mode_"
TOGGLE_COMMANDS = {"grid", "cursor", "active"}


def _ctx(context=None):
    return context or bpy.context


def _result(status="FINISHED", message="", changed=0, **extra):
    result = {
        "status": status,
        "message": message,
        "display": message,
        "changed": changed,
    }
    result.update(extra)
    return result


def _selected_objects(context):
    return list(getattr(context, "selected_objects", []) or [])


def _active_object(context):
    active = getattr(context, "active_object", None)
    if active is not None:
        return active
    view_layer = getattr(context, "view_layer", None)
    objects = getattr(view_layer, "objects", None)
    return getattr(objects, "active", None)


def _world_location(obj):
    return obj.matrix_world.translation.copy()


def _set_world_location(obj, location):
    matrix = obj.matrix_world.copy()
    matrix.translation = Vector(location)
    obj.matrix_world = matrix


def _selection_center(objects):
    if not objects:
        raise ValueError("Select at least one object before snapping.")
    total = Vector((0.0, 0.0, 0.0))
    for obj in objects:
        total += _world_location(obj)
    return total / len(objects)


def _round_to_grid(location):
    return Vector((round(location.x), round(location.y), round(location.z)))


def _require_object_mode(context, operator_error):
    if getattr(context, "mode", "OBJECT") != "OBJECT":
        raise ValueError(
            "Blender's VIEW_3D snap operator was unavailable, and the fallback only runs in Object Mode. "
            f"Operator error: {operator_error}"
        )


def _find_view3d_override(context):
    window_manager = getattr(context, "window_manager", None)
    for window in getattr(window_manager, "windows", []) or []:
        screen = getattr(window, "screen", None)
        for area in getattr(screen, "areas", []) or []:
            if getattr(area, "type", "") != "VIEW_3D":
                continue
            region = next(
                (candidate for candidate in getattr(area, "regions", []) if candidate.type == "WINDOW"),
                None,
            )
            space = next(
                (candidate for candidate in getattr(area, "spaces", []) if candidate.type == "VIEW_3D"),
                None,
            )
            if region is None or space is None:
                continue
            return {
                "window": window,
                "screen": screen,
                "area": area,
                "region": region,
                "space_data": space,
                "scene": context.scene,
                "view_layer": context.view_layer,
            }
    return None


def _try_view3d_operator(context, operator_name, **kwargs):
    try:
        operator = getattr(bpy.ops.view3d, operator_name)
    except AttributeError as exc:
        return False, str(exc)

    override = _find_view3d_override(context)
    try:
        if override and hasattr(bpy.context, "temp_override"):
            with bpy.context.temp_override(**override):
                result = operator(**kwargs)
        else:
            result = operator(**kwargs)
    except TypeError:
        if not kwargs:
            raise
        if any(bool(value) for value in kwargs.values()):
            return False, "operator rejected keyword arguments"
        try:
            if override and hasattr(bpy.context, "temp_override"):
                with bpy.context.temp_override(**override):
                    result = operator()
            else:
                result = operator()
        except Exception as exc:
            return False, str(exc)
    except Exception as exc:
        return False, str(exc)

    if isinstance(result, set) and "CANCELLED" in result:
        return False, "operator cancelled"
    return True, ""


def _move_selection_to_point(context, target, keep_offset):
    selected = _selected_objects(context)
    if not selected:
        raise ValueError("Select at least one object before snapping.")

    target = Vector(target)
    if keep_offset:
        delta = target - _selection_center(selected)
        for obj in selected:
            _set_world_location(obj, _world_location(obj) + delta)
    else:
        for obj in selected:
            _set_world_location(obj, target)
    return len(selected)


def _snap_selection_to_grid(context):
    ok, error = _try_view3d_operator(context, "snap_selected_to_grid")
    if ok:
        return "Moved selection to grid."
    _require_object_mode(context, error)
    selected = _selected_objects(context)
    if not selected:
        raise ValueError("Select at least one object before snapping to the grid.")
    for obj in selected:
        _set_world_location(obj, _round_to_grid(_world_location(obj)))
    return "Moved selection to grid."


def _snap_selection_to_cursor(context, keep_offset=False):
    ok, error = _try_view3d_operator(
        context,
        "snap_selected_to_cursor",
        use_offset=bool(keep_offset),
    )
    if ok:
        return "Moved selection to cursor with offset." if keep_offset else "Moved selection to cursor."
    _require_object_mode(context, error)
    changed = _move_selection_to_point(context, context.scene.cursor.location, keep_offset)
    suffix = " with offset" if keep_offset else ""
    return f"Moved {changed} selected object(s) to cursor{suffix}."


def _snap_selection_to_active(context):
    ok, error = _try_view3d_operator(context, "snap_selected_to_active")
    if ok:
        return "Moved selection to active."
    _require_object_mode(context, error)
    active = _active_object(context)
    if active is None:
        raise ValueError("Choose an active object before snapping selection to active.")
    changed = _move_selection_to_point(context, _world_location(active), keep_offset=False)
    return f"Moved {changed} selected object(s) to active."


def _snap_cursor_to_selected(context):
    ok, error = _try_view3d_operator(context, "snap_cursor_to_selected")
    if ok:
        return "Moved cursor to selected."
    _require_object_mode(context, error)
    context.scene.cursor.location = _selection_center(_selected_objects(context))
    return "Moved cursor to selected."


def _snap_cursor_to_world_origin(context):
    ok, _error = _try_view3d_operator(context, "snap_cursor_to_center")
    if not ok:
        context.scene.cursor.location = (0.0, 0.0, 0.0)
    return "Moved cursor to world origin."


def _snap_cursor_to_grid(context):
    ok, _error = _try_view3d_operator(context, "snap_cursor_to_grid")
    if not ok:
        context.scene.cursor.location = _round_to_grid(context.scene.cursor.location)
    return "Moved cursor to grid."


def _snap_cursor_to_active(context):
    ok, error = _try_view3d_operator(context, "snap_cursor_to_active")
    if ok:
        return "Moved cursor to active."
    active = _active_object(context)
    if active is None:
        raise ValueError(f"Choose an active object before snapping cursor to active. Operator error: {error}")
    context.scene.cursor.location = _world_location(active)
    return "Moved cursor to active."


def _state_key(command):
    return f"{STATE_PREFIX}{command}"


def _current_mode(context, command):
    stored = str(context.scene.get(_state_key(command), "selection")).strip().lower()
    return "cursor" if stored == "cursor" else "selection"


def _next_mode(mode):
    return "cursor" if mode == "selection" else "selection"


def _set_next_mode(context, command, mode):
    context.scene[_state_key(command)] = mode


def _run_toggle_command(context, command):
    mode = _current_mode(context, command)
    if command == "grid":
        message = _snap_selection_to_grid(context) if mode == "selection" else _snap_cursor_to_grid(context)
    elif command == "cursor":
        message = _snap_selection_to_cursor(context, keep_offset=False) if mode == "selection" else _snap_cursor_to_selected(context)
    elif command == "active":
        message = _snap_selection_to_active(context) if mode == "selection" else _snap_cursor_to_active(context)
    else:
        raise ValueError(f"Unsupported toggle snap command: {command}")

    next_mode = _next_mode(mode)
    _set_next_mode(context, command, next_mode)
    next_target = "cursor" if next_mode == "cursor" else "selection"
    return _result(
        message=f"{message} Next {command.title()} press moves the {next_target}.",
        changed=1,
        command=command,
        mode=mode,
        nextMode=next_mode,
    )


def perform_snap_action(context=None, data=None):
    ctx = _ctx(context)
    payload = data or {}
    command = str(payload.get("command") or payload.get("action") or "").strip().lower()

    if not command or command == "status":
        return _result(message="Snap action is ready.", command="status")

    if command in TOGGLE_COMMANDS:
        return _run_toggle_command(ctx, command)
    if command == "offset":
        return _result(message=_snap_selection_to_cursor(ctx, keep_offset=True), changed=1, command=command)
    if command in {"worigin", "world_origin", "world-origin"}:
        return _result(message=_snap_cursor_to_world_origin(ctx), changed=1, command="worigin")

    raise ValueError(f"Unsupported snap command: {command}")


def run_flowcell_action(context=None, data=None):
    return perform_snap_action(context=context, data=data)
