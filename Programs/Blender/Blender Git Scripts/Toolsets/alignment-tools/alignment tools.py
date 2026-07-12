# Description: Selected objects go to the active-object min, center, max, surface, and origin alignment.



from __future__ import annotations

import bpy
from mathutils import Vector


SLOT_PAYLOADS = {
    "x_min": {"command": "align_axis", "axis": "X", "mode": "MIN", "modifier": ""},
    "x_center": {"command": "align_axis", "axis": "X", "mode": "CENTER", "modifier": ""},
    "x_max": {"command": "align_axis", "axis": "X", "mode": "MAX", "modifier": ""},
    "x_surface": {"command": "align_axis", "axis": "X", "mode": "CENTER", "modifier": "SURFACE"},
    "x_geo": {"command": "align_axis", "axis": "X", "mode": "CENTER", "modifier": "GEOCENTER"},
    "y_min": {"command": "align_axis", "axis": "Y", "mode": "MIN", "modifier": ""},
    "y_center": {"command": "align_axis", "axis": "Y", "mode": "CENTER", "modifier": ""},
    "y_max": {"command": "align_axis", "axis": "Y", "mode": "MAX", "modifier": ""},
    "y_surface": {"command": "align_axis", "axis": "Y", "mode": "CENTER", "modifier": "SURFACE"},
    "y_geo": {"command": "align_axis", "axis": "Y", "mode": "CENTER", "modifier": "GEOCENTER"},
    "z_min": {"command": "align_axis", "axis": "Z", "mode": "MIN", "modifier": ""},
    "z_center": {"command": "align_axis", "axis": "Z", "mode": "CENTER", "modifier": ""},
    "z_max": {"command": "align_axis", "axis": "Z", "mode": "MAX", "modifier": ""},
    "z_surface": {"command": "align_axis", "axis": "Z", "mode": "CENTER", "modifier": "SURFACE"},
    "z_geo": {"command": "align_axis", "axis": "Z", "mode": "CENTER", "modifier": "GEOCENTER"},
    "center_everything": {"command": "center_all"},
}


def _ctx(context=None):
    return context or bpy.context


def _result(status="ok", message="", **extra):
    return {"status": status, "message": message, "display": message, **extra}


def _alignment_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    world_matrix = obj.matrix_world
    corners = getattr(obj, "bound_box", None)
    if not corners:
        origin = world_matrix.translation.copy()
        return origin.copy(), origin.copy()

    points = [world_matrix @ Vector(corner) for corner in corners]
    mins = Vector(
        (
            min(point.x for point in points),
            min(point.y for point in points),
            min(point.z for point in points),
        )
    )
    maxs = Vector(
        (
            max(point.x for point in points),
            max(point.y for point in points),
            max(point.z for point in points),
        )
    )
    return mins, maxs


def _alignment_origin(obj: bpy.types.Object) -> Vector:
    return obj.matrix_world.translation.copy()


def _offset_object_world_axis(obj: bpy.types.Object, axis_index: int, offset: float) -> None:
    matrix = obj.matrix_world.copy()
    translation = matrix.translation.copy()
    translation[axis_index] += offset
    matrix.translation = translation
    obj.matrix_world = matrix


def _restore_selection(context, selected_objects, active) -> None:
    selected_set = set(selected_objects)
    for obj in list(context.scene.objects):
        obj.select_set(obj in selected_set)
    if active is not None:
        context.view_layer.objects.active = active


def _normalize_payload(data):
    payload = dict(data or {})
    command = str(payload.get("command") or payload.get("action") or "status").strip().lower()
    if command in SLOT_PAYLOADS:
        slot_payload = dict(SLOT_PAYLOADS[command])
        slot_payload.update({key: value for key, value in payload.items() if key not in slot_payload})
        return slot_payload
    payload["command"] = command
    return payload


def _run_alignment(context, data):
    command = str(data.get("command", "align_axis") or "align_axis").strip().lower()
    if command in {"", "status", "state", "probe"}:
        return _result("ok", "Alignment tools ready.")

    selected_objects = list(getattr(context, "selected_objects", []) or [])
    active = getattr(context.view_layer.objects, "active", None)
    if active is None or active not in selected_objects:
        raise ValueError("Select an active reference object and one object to move.")

    moved_objects = [obj for obj in selected_objects if obj != active]
    if not moved_objects:
        raise ValueError("Select at least one object besides the active reference object.")

    active_min, active_max = _alignment_bounds(active)
    active_center = (active_min + active_max) / 2.0

    if command == "center_all":
        for obj in moved_objects:
            obj_min, obj_max = _alignment_bounds(obj)
            obj_center = (obj_min + obj_max) / 2.0
            matrix = obj.matrix_world.copy()
            matrix.translation = matrix.translation + (active_center - obj_center)
            obj.matrix_world = matrix
        _restore_selection(context, selected_objects, active)
        return _result("ok", f"Centered {len(moved_objects)} object(s).", changed=len(moved_objects))

    if command != "align_axis":
        raise ValueError(f"Unsupported alignment command: {command}")

    axis_lookup = {"X": 0, "Y": 1, "Z": 2}
    axis = str(data.get("axis", "X") or "X").strip().upper()
    if axis not in axis_lookup:
        raise ValueError(f"Unsupported alignment axis: {axis}")

    mode = str(data.get("mode", "CENTER") or "CENTER").strip().upper()
    if mode not in {"MIN", "CENTER", "MAX"}:
        raise ValueError(f"Unsupported alignment mode: {mode}")

    modifier = str(data.get("modifier", "") or "").strip().upper()
    if modifier not in {"", "SURFACE", "GEOCENTER", "ORIGIN"}:
        raise ValueError(f"Unsupported alignment modifier: {modifier}")

    axis_index = axis_lookup[axis]
    moved_count = 0
    for obj in moved_objects:
        obj_min, obj_max = _alignment_bounds(obj)
        obj_center = (obj_min + obj_max) / 2.0
        obj_origin = _alignment_origin(obj)

        if modifier == "SURFACE":
            target = active_min[axis_index] if obj_center[axis_index] > active_center[axis_index] else active_max[axis_index]
            source = obj_min if obj_center[axis_index] <= active_center[axis_index] else obj_max
        else:
            if mode == "MIN":
                target = active_min[axis_index]
                source = obj_min
            elif mode == "MAX":
                target = active_max[axis_index]
                source = obj_max
            else:
                target = active_center[axis_index]
                source = obj_center

            if modifier in {"GEOCENTER", "ORIGIN"}:
                source = obj_origin

        _offset_object_world_axis(obj, axis_index, target - source[axis_index])
        moved_count += 1

    _restore_selection(context, selected_objects, active)
    return _result("ok", f"Aligned {moved_count} object(s) on {axis}.", changed=moved_count)


def run_flowcell_action(context=None, data=None):
    ctx = _ctx(context)
    payload = _normalize_payload(data)
    return _run_alignment(ctx, payload)
