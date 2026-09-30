# Description: Selected objects go to the active-object min, center, max, surface, and origin alignment.



from __future__ import annotations

import bpy
import sys
from mathutils import Quaternion, Vector


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


def _alignment_bounds(obj: bpy.types.Object, matrix=None) -> tuple[Vector, Vector]:
    world_matrix = obj.matrix_world if matrix is None else matrix
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


def _combined_bounds(objects, matrices=None):
    bounds = [_alignment_bounds(obj, matrices[obj] if matrices is not None else None) for obj in objects]
    return (Vector(tuple(min(lo[i] for lo, hi in bounds) for i in range(3))),
            Vector(tuple(max(hi[i] for lo, hi in bounds) for i in range(3))))


def _stretch_local_transform(obj, matrix, matrices):
    """Keep rotation intact at zero scale; reject transforms requiring shear."""
    if obj.parent is not None:
        if obj.parent_type != "OBJECT":
            raise ValueError(f"Smart Axis conflict: {obj.name} uses unsupported parenting.")
        parent_space = matrices.get(obj.parent, obj.parent.matrix_world) @ obj.matrix_parent_inverse
        if abs(parent_space.determinant()) < 1e-12:
            raise ValueError(f"Smart Axis conflict: {obj.name}'s parent has zero scale.")
        matrix = parent_space.inverted() @ matrix
    if all(abs(matrix[i][j] - obj.matrix_basis[i][j]) < 1e-6 for i in range(3) for j in range(3)):
        return matrix.translation - obj.delta_location, obj.scale.copy()
    if any(not c.mute and c.influence for c in obj.constraints):
        raise ValueError(f"Smart Axis conflict: {obj.name} has an active transform constraint.")
    if obj.rotation_mode == "QUATERNION":
        rotation = obj.rotation_quaternion.to_matrix()
        delta = obj.delta_rotation_quaternion.to_matrix()
    elif obj.rotation_mode == "AXIS_ANGLE":
        angle, x, y, z = obj.rotation_axis_angle
        rotation = Quaternion((x, y, z), angle).to_matrix()
        delta = obj.delta_rotation_euler.to_matrix()
    else:
        rotation = obj.rotation_euler.to_matrix()
        delta = obj.delta_rotation_euler.to_matrix()
    stretch = (delta @ rotation).transposed() @ matrix.to_3x3()
    tolerance = 2e-5 * max(1.0, max(abs(value) for row in stretch for value in row))
    if any(abs(stretch[i][j]) > tolerance for i in range(3) for j in range(3) if i != j):
        raise ValueError(f"Smart Axis conflict: stretching {obj.name} on this world axis would shear it. "
                         "Apply its rotation first or turn Live off.")
    scale = obj.scale.copy()
    for i in range(3):
        if abs(obj.delta_scale[i]) < 1e-12:
            if abs(stretch[i][i]) > tolerance:
                raise ValueError(f"Smart Axis conflict: {obj.name} has a zero delta scale.")
        else:
            scale[i] = stretch[i][i] / obj.delta_scale[i]
    return matrix.translation - obj.delta_location, scale


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
    bridge = sys.modules.get("flowcell_bridge")
    live = bridge is not None and bridge.is_live_tool_enabled("smart_axis_lock")
    modes = bridge._smart_axis_active_modes(context) if live else {}
    live = live and any(side != "NONE" for side in modes.values())
    active_matrix = active.matrix_world.copy() if anchor == "ACTIVE" else None
    if anchor == "ACTIVE":
        # A reference already tracked by Live may still be waiting for its scale
        # correction. Target where that tick will pin it, without moving it here.
        entry = bridge.LIVE_TOOL_REGISTRY.get("smart_axis_lock", {}) if live else {}
        if (live and active.name_full in entry.get("selection_token", ())
                and active.type in bridge.SMART_AXIS_SUPPORTED_TYPES and bridge._smart_axis_scale_changed(active)):
            for name, side in modes.items():
                ref = active.get(f"_{name}_{side.lower()}_ref") if side != "NONE" else None
                if ref is not None:
                    index = "XYZ".index(name)
                    lo, hi = _alignment_bounds(active, active_matrix)
                    pin = lo[index] if bridge._smart_axis_pin_uses_min(active, name, side) else hi[index]
                    active_matrix[index][3] += float(ref) - pin
        active_min, active_max = _alignment_bounds(active, active_matrix)
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
    origin_center = bool(modifiers.get("alt")) and not modifier and (centering or mode == "CENTER")
    target_center = active_matrix.translation if origin_center and anchor == "ACTIVE" else active_center
    axes = (0, 1, 2) if command == "center_all" else (0, 1) if command == "center_xy" else ("XYZ".index(axis),)
    grouped = bool(data.get("group", False))
    batches = [moved_objects] if grouped else [[obj] for obj in moved_objects]
    matrices = {obj: obj.matrix_world.copy() for obj in moved_objects}
    saved_states = {obj: {} for obj in moved_objects}
    collapsed_axes = set()
    restored_axes = set()
    surface_notes = set()
    collapsed_group = {i: all(sum(matrices[obj][i][j] ** 2 for j in range(3)) < 1e-20
                              for obj in moved_objects) for i in axes}
    stretched_axes = set()

    # Finish pending scale pinning in this same undo step. Plan everything first,
    # so a conflict cannot leave an earlier object or axis partially transformed.
    if live:
        for obj in moved_objects:
            if obj.type not in bridge.SMART_AXIS_SUPPORTED_TYPES:
                continue
            for name, side in modes.items():
                if side == "NONE":
                    continue
                index = "XYZ".index(name)
                ref = obj.get(f"_{name}_{side.lower()}_ref")
                if ref is None:
                    continue
                matrix = matrices[obj]
                lo, hi = _alignment_bounds(obj, matrix)
                pin = lo[index] if bridge._smart_axis_pin_uses_min(obj, name, side) else hi[index]
                matrix[index][3] += float(ref) - pin
                state = bridge._smart_axis_stretch_state(obj, name, side)
                if index in axes and sum(matrix[index][i] ** 2 for i in range(3)) < 1e-20:
                    collapsed_axes.add((obj, index))
                    if grouped and (not collapsed_group[index] or (state is not None and state.get("group_zero", False))):
                        continue
                    if state is None:
                        raise ValueError(f"Smart Axis conflict: {obj.name} has no nonzero {name} size to restore.")
                    matrix[index] = Vector(state["row"])
                    restored_axes.add((obj, index))

    for objects in batches:
        obj_min, obj_max = _combined_bounds(objects, matrices)
        obj_center = (obj_min + obj_max) / 2.0
        for index in axes:
            name = "XYZ"[index]
            side = modes.get(name, "NONE")
            locked = [(obj, obj.get(f"_{name}_{side.lower()}_ref")) for obj in objects
                      if side != "NONE" and obj.type in bridge.SMART_AXIS_SUPPORTED_TYPES] if live else []
            locked = [(obj, float(ref)) for obj, ref in locked if ref is not None]
            flipped = False
            if locked:
                ref = locked[0][1]
                if len(locked) != len(objects):
                    raise ValueError(f"Smart Axis conflict on {name}: set a baseline on every object in the selection first.")
                if any(abs(value - ref) > 1e-6 for obj, value in locked):
                    raise ValueError(f"Smart Axis conflict on {name}: the selection has different locked baselines.")
                # Min/Max keep their material-side identity after crossing the pin.
                direction_object = next((obj for obj, value in locked
                                         if sum(matrices[obj][index][i] ** 2 for i in range(3)) > 1e-20), locked[0][0])
                state = bridge._smart_axis_stretch_state(direction_object, name, side)
                if state is not None:
                    row = matrices[direction_object][index]
                    flipped = sum(row[i] * state["row"][i] for i in range(3)) < 0.0
            if modifier == "SURFACE":
                # Use the current side so repeated presses cross the anchor.
                above = obj_center[index] > active_center[index]
                target = active_min[index] if above else active_max[index]
                source = obj_max[index] if above else obj_min[index]
                if locked:
                    other_source = obj_min[index] if above else obj_max[index]
                    other_target = active_max[index] if above else active_min[index]
                    blocked = abs(source - ref) < 1e-7 and abs(target - ref) > 1e-6
                    other_blocked = abs(other_source - ref) < 1e-7 and abs(other_target - ref) > 1e-6
                    if blocked and not other_blocked:
                        blocked_target = target
                        source, target = other_source, other_target
                    elif other_blocked and not blocked:
                        blocked_target = other_target
                    else:
                        blocked_target = None
                    if blocked_target is not None:
                        surface_notes.add(f"Surface used the free side: {name} {side.title()} is locked at "
                                          f"{ref:g} and cannot reach {blocked_target:g}.")
            elif modifier in {"GEOCENTER", "ORIGIN"}:
                source = obj_center[index] if grouped else matrices[objects[0]].translation[index]
                target = active_min[index] if source > active_center[index] else active_max[index]
            elif centering or mode == "CENTER":
                target = target_center[index]
                source = matrices[objects[0]].translation[index] if origin_center and not grouped else obj_center[index]
            elif mode == "MIN":
                target = active_min[index]
                source = obj_max[index] if flipped else obj_min[index]
            else:
                target = active_max[index]
                source = obj_min[index] if flipped else obj_max[index]
            if locked:
                distance = source - ref
                if abs(distance) < 1e-7:
                    if abs(target - ref) > 1e-6:
                        raise ValueError(f"Smart Axis conflict on {name}: the chosen point is locked at "
                                         f"{ref:g} and cannot align to {target:g}.")
                    factor = 0.0 if all((obj, index) in collapsed_axes for obj in objects) else 1.0
                else:
                    factor = 0.0 if abs(target - ref) < 1e-6 else (target - ref) / distance
                for obj in objects:
                    matrix = matrices[obj]
                    if any(obj == locked_obj for locked_obj, value in locked):
                        state = bridge._smart_axis_stretch_state(obj, name, side)
                        saved_row = matrix[index].copy()
                        was_zero = (obj, index) in collapsed_axes and (obj, index) not in restored_axes
                        if was_zero and state is not None:
                            saved_row = Vector(state["row"])
                        if state is not None and sum(saved_row[i] * state["row"][i] for i in range(3)) < 0.0:
                            saved_row *= -1.0
                            saved_row[3] += 2.0 * ref
                        saved_states[obj][name] = {
                            "side": side, "ref": ref,
                            "row": list(saved_row),
                            "group_zero": bool(grouped and was_zero),
                        }
                    row = matrix[index].copy() * factor
                    row[3] = ref + (matrix[index][3] - ref) * factor
                    matrix[index] = row
                stretched_axes.add(name)
            else:
                for obj in objects:
                    matrices[obj][index][3] += target - source

    transforms = {obj: _stretch_local_transform(obj, matrices[obj], matrices) for obj in moved_objects} if live else {}

    # Snapshot all destinations before moving anything, then parents before children.
    def depth(obj):
        result = 0
        while obj.parent is not None:
            result += 1
            obj = obj.parent
        return result
    for obj in sorted(moved_objects, key=depth):
        if live:
            obj.location, obj.scale = transforms[obj]
            for name, state in saved_states[obj].items():
                obj[bridge._smart_axis_key(f"stretch_{name.lower()}")] = state
            if obj.type in bridge.SMART_AXIS_SUPPORTED_TYPES:
                bridge._smart_axis_set_last_scale(obj)
        else:
            obj.matrix_world = matrices[obj]
        context.view_layer.update()
    if centering:
        message = (f"Centered {len(moved_objects)} object(s) on X and Y." if command == "center_xy"
                   else f"Centered {len(moved_objects)} object(s).")
    else:
        message = f"Aligned {len(moved_objects)} object(s) on {axis}."
    if stretched_axes:
        message += " Stretched on " + ", ".join(sorted(stretched_axes)) + "; locked sides stayed fixed."
    if surface_notes:
        message += " " + " ".join(sorted(surface_notes))
    return _result("ok", message, changed=len(moved_objects), anchor=anchor, group=grouped, fieldPatch={})


def run_flowcell_action(context=None, data=None):
    ctx = _ctx(context)
    payload = _normalize_payload(data)
    return _run_alignment(ctx, payload)
