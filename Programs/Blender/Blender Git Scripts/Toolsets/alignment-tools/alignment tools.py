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
    "center_xy": {"command": "center_xy"},
}


def _ctx(context=None):
    return context or bpy.context


def _result(status="ok", message="", **extra):
    return {"status": status, "message": message, "display": message, **extra}


def _bound_corners(obj: bpy.types.Object):
    """Local-space bound corners for the geometry Blender actually displays.

    ``obj.bound_box`` on the original object ignores modifiers, and for curves
    and text it is built from control points, so it can sit well outside the
    visible surface and leave a gap when aligning. The evaluated object carries
    the displayed extents.
    """
    corners = getattr(obj, "bound_box", None)
    try:
        evaluated = obj.evaluated_get(_ctx().evaluated_depsgraph_get())
    except (AttributeError, RuntimeError, TypeError):
        return corners

    evaluated_corners = getattr(evaluated, "bound_box", None)
    if not evaluated_corners:
        return corners

    points = [Vector(corner) for corner in evaluated_corners]
    if max((point - points[0]).length for point in points) <= 0.0:
        # Evaluated geometry collapsed to a point (hidden, or consumed by a
        # modifier); keep the original bounds instead of snapping to nothing.
        return corners
    return evaluated_corners


def _alignment_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    world_matrix = obj.matrix_world
    corners = _bound_corners(obj)
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


def _combined_bounds(objects):
    bounds = [_alignment_bounds(obj) for obj in objects]
    return (Vector(tuple(min(lo[i] for lo, hi in bounds) for i in range(3))),
            Vector(tuple(max(hi[i] for lo, hi in bounds) for i in range(3))))


def _run_alignment(context, data):
    command = str(data.get("command", "align_axis") or "align_axis").strip().lower()
    if command in {"", "status", "state", "probe"}:
        return _result("ok", "Alignment tools ready.")
    if getattr(context, "mode", "OBJECT") != "OBJECT":
        raise ValueError("Switch to Object Mode to align objects.")

    modifiers = data.get("modifiers") or {}
    anchor = "CURSOR" if modifiers.get("ctrl") else "WORLD" if modifiers.get("shift") else "ACTIVE"
    selected_objects = list(getattr(context, "selected_objects", []) or [])
    active = getattr(context.view_layer.objects, "active", None)
    if not selected_objects:
        raise ValueError("Select at least one object to align.")
    if anchor == "ACTIVE":
        if active is None or active not in selected_objects:
            raise ValueError("Select an active reference object and one object to move.")
        moved_objects = [obj for obj in selected_objects if obj != active]
        if not moved_objects:
            raise ValueError("Select an object besides the active reference, or hold Shift/Control for world/cursor.")
    else:
        moved_objects = selected_objects

    # A moving parent would also move the active anchor. Reject before any edits.
    parent = active.parent if anchor == "ACTIVE" else None
    while parent is not None:
        if parent in moved_objects:
            raise ValueError("The active anchor is a child of a moving object. Choose an independent anchor.")
        parent = parent.parent
    context.view_layer.update()
    if anchor == "ACTIVE":
        active_min, active_max = _alignment_bounds(active)
    else:
        point = context.scene.cursor.location.copy() if anchor == "CURSOR" else Vector((0, 0, 0))
        active_min, active_max = point.copy(), point.copy()
    active_center = (active_min + active_max) / 2.0
    axis = str(data.get("axis", "X") or "X").upper()
    if axis not in {"X", "Y", "Z"}:
        raise ValueError(f"Unsupported alignment axis: {axis}")
    mode = str(data.get("mode", "CENTER")).upper()
    if mode not in {"MIN", "CENTER", "MAX"}:
        raise ValueError(f"Unsupported alignment mode: {mode}")
    modifier = str(data.get("modifier", "") or "").upper()
    if modifier not in {"", "SURFACE", "GEOCENTER", "ORIGIN"}:
        raise ValueError(f"Unsupported alignment modifier: {modifier}")
    if command not in {"align_axis", "center_all", "center_xy"}:
        raise ValueError(f"Unsupported alignment command: {command}")
    centering = command in {"center_all", "center_xy"}
    axes = (0, 1, 2) if command == "center_all" else (0, 1) if command == "center_xy" else ("XYZ".index(axis),)
    grouped = bool(data.get("group", False))
    batches = [moved_objects] if grouped else [[obj] for obj in moved_objects]
    matrices = {}
    for objects in batches:
        obj_min, obj_max = _combined_bounds(objects)
        obj_center = (obj_min + obj_max) / 2.0
        offset = Vector((0, 0, 0))
        for index in axes:
            if modifier == "SURFACE":
                # Use the current side so repeated presses cross the anchor.
                target = active_min[index] if obj_center[index] > active_center[index] else active_max[index]
                source = obj_max[index] if obj_center[index] > active_center[index] else obj_min[index]
            elif modifier in {"GEOCENTER", "ORIGIN"}:
                source = obj_center[index] if grouped else _alignment_origin(objects[0])[index]
                target = active_min[index] if source > active_center[index] else active_max[index]
            elif centering or mode == "CENTER":
                target, source = active_center[index], obj_center[index]
            elif mode == "MIN":
                target = active_min[index]
                source = obj_min[index]
            else:
                target = active_max[index]
                source = obj_max[index]
            offset[index] = target - source
        for obj in objects:
            matrix = obj.matrix_world.copy()
            matrix.translation += offset
            matrices[obj] = matrix

    # Snapshot all destinations before moving anything, then parents before children.
    def depth(obj):
        result = 0
        while obj.parent is not None:
            result += 1
            obj = obj.parent
        return result
    for obj in sorted(moved_objects, key=depth):
        obj.matrix_world = matrices[obj]
        context.view_layer.update()
    if centering:
        message = (f"Centered {len(moved_objects)} object(s) on X and Y." if command == "center_xy"
                   else f"Centered {len(moved_objects)} object(s).")
    else:
        message = f"Aligned {len(moved_objects)} object(s) on {axis}."
    return _result("ok", message, changed=len(moved_objects), anchor=anchor, group=grouped, fieldPatch={})


def run_flowcell_action(context=None, data=None):
    ctx = _ctx(context)
    payload = _normalize_payload(data)
    return _run_alignment(ctx, payload)
