# Description: rotate objects with, transform, and distribute(evenly spaced copies around pivot)








# FLOWCELL_CHILD: axis_z | Z | Set the quick-rotate axis to Z.
# FLOWCELL_CHILD: axis_y | Y | Set the quick-rotate axis to Y.
# FLOWCELL_CHILD: axis_x | X | Set the quick-rotate axis to X.
# FLOWCELL_CHILD: preset_30 | 30 deg | Apply a 30 degree positive quick-rotate immediately and stage the angle.
# FLOWCELL_CHILD: preset_45 | 45 deg | Apply a 45 degree positive quick-rotate immediately and stage the angle.
# FLOWCELL_CHILD: preset_90 | 90 deg | Apply a 90 degree positive quick-rotate immediately and stage the angle.
# FLOWCELL_CHILD: preset_180 | 180 deg | Apply a 180 degree positive quick-rotate immediately and stage the angle.
# FLOWCELL_CHILD: preset_270 | 270 deg | Apply a 270 degree positive quick-rotate immediately and stage the angle.
# FLOWCELL_CHILD: center_geometry | Geometry | Use geometry center as the quick-rotate pivot.
# FLOWCELL_CHILD: center_origin | Origin | Use object origin as the quick-rotate pivot.
# FLOWCELL_CHILD: center_world | World | Use world origin as the quick-rotate pivot.
# FLOWCELL_CHILD: center_cursor | Cursor | Use 3D cursor as the quick-rotate pivot.
# FLOWCELL_CHILD: center_object | Object | Use the active object as the quick-rotate pivot.
# FLOWCELL_CHILD: mode_transform | Transform | Use quick rotate in transform mode.
# FLOWCELL_CHILD: mode_distribute | Distribute | Use quick rotate in distribute mode.
# FLOWCELL_CHILD: apply_negative | Negative | Apply the staged quick-rotate values in the negative direction.
# FLOWCELL_CHILD: apply_positive | Positive | Apply the staged quick-rotate values in the positive direction.

"""Quick Rotate Group custom FlowCell action."""

import math

import bpy
import mathutils


SUPPORTED_AXES = {"X", "Y", "Z"}
SUPPORTED_CENTER_MODES = {"GEOMETRY", "ORIGIN", "WORLD", "CURSOR", "OBJECT"}
SUPPORTED_OPERATION_MODES = {"TRANSFORM", "DISTRIBUTE"}
EPSILON = 1e-6


def _ctx(context=None):
    return context or bpy.context


def _selected_objects(context=None):
    return [obj for obj in getattr(_ctx(context), "selected_objects", []) if obj is not None]


def _active_object(context=None):
    return getattr(_ctx(context).view_layer.objects, "active", None)


def _world_points_for_object(obj):
    if hasattr(obj, "bound_box") and obj.bound_box:
        try:
            return [obj.matrix_world @ mathutils.Vector(corner) for corner in obj.bound_box]
        except Exception:
            pass
    return [obj.matrix_world.translation.copy()]


def _average_point(points):
    if not points:
        return mathutils.Vector((0.0, 0.0, 0.0))
    total = mathutils.Vector((0.0, 0.0, 0.0))
    for point in points:
        total += point
    return total / float(len(points))


def _geometry_center(objects):
    points = []
    for obj in objects:
        points.extend(_world_points_for_object(obj))
    return _average_point(points)


def _origin_center(objects):
    return _average_point([obj.matrix_world.translation.copy() for obj in objects])


def _pivot_point(context, objects, center_mode):
    mode = str(center_mode or "WORLD").strip().upper()
    if mode not in SUPPORTED_CENTER_MODES:
        raise ValueError(f"Unsupported center mode: {center_mode}")

    if mode == "GEOMETRY":
        return _geometry_center(objects)
    if mode == "ORIGIN":
        return _origin_center(objects)
    if mode == "WORLD":
        return mathutils.Vector((0.0, 0.0, 0.0))
    if mode == "CURSOR":
        return _ctx(context).scene.cursor.location.copy()

    active = _active_object(context)
    if active is None:
        raise ValueError("Object center mode needs an active object.")
    return active.matrix_world.translation.copy()


def _axis_vector(axis):
    normalized = str(axis or "Z").strip().upper()
    if normalized not in SUPPORTED_AXES:
        raise ValueError(f"Unsupported axis: {axis}")
    if normalized == "X":
        return mathutils.Vector((1.0, 0.0, 0.0))
    if normalized == "Y":
        return mathutils.Vector((0.0, 1.0, 0.0))
    return mathutils.Vector((0.0, 0.0, 1.0))


def _rotation_quaternion(axis, angle_deg):
    return mathutils.Quaternion(_axis_vector(axis), math.radians(float(angle_deg)))


def _apply_world_rotation(obj, pivot, rotation_quaternion):
    if rotation_quaternion.angle < EPSILON:
        return
    transform = (
        mathutils.Matrix.Translation(pivot)
        @ rotation_quaternion.to_matrix().to_4x4()
        @ mathutils.Matrix.Translation(-pivot)
    )
    obj.matrix_world = transform @ obj.matrix_world


def _ordered_selection(context=None):
    context = _ctx(context)
    selected = _selected_objects(context)
    active = _active_object(context)
    if active is None or active not in selected:
        return selected
    return [active] + [obj for obj in selected if obj != active]


def _perform_transform(context, objects, pivot, axis, angle_deg):
    rotation = _rotation_quaternion(axis, angle_deg)
    for obj in objects:
        _apply_world_rotation(obj, pivot, rotation)
    return {
        "message": f"Rotated {len(objects)} object(s) {angle_deg:.2f} degrees around {axis}.",
        "changed": len(objects),
    }


def _duplicate_object_set(context, source_objects):
    duplicates = []
    scene_collection = _ctx(context).scene.collection
    for obj in source_objects:
        duplicate = obj.copy()
        if getattr(obj, "data", None) is not None:
            duplicate.data = obj.data.copy()
        collections = list(getattr(obj, "users_collection", []) or [])
        if not collections:
            collections = [scene_collection]
        for collection in collections:
            collection.objects.link(duplicate)
        duplicates.append(duplicate)
    return duplicates


def _set_selection(context, objects, active=None):
    view_layer = _ctx(context).view_layer
    for obj in getattr(view_layer, "objects", []):
        try:
            obj.select_set(False)
        except Exception:
            pass
    for obj in objects:
        try:
            obj.select_set(True)
        except Exception:
            pass
    if active is not None:
        try:
            view_layer.objects.active = active
        except Exception:
            pass


def _perform_distribute(context, objects, pivot, axis, angle_deg, distribute_count):
    source_objects = _ordered_selection(context)
    selected_count = len(source_objects)
    total_sets = max(1, int(round(float(distribute_count or 1))))
    full_turn = 360.0 if float(angle_deg) >= 0 else -360.0
    step_angle = 0.0 if total_sets <= 0 else full_turn / float(total_sets)
    distributed_objects = list(source_objects)
    for set_index in range(1, total_sets):
        duplicated_set = _duplicate_object_set(context, source_objects)
        rotation = _rotation_quaternion(axis, step_angle * set_index)
        for obj in duplicated_set:
            _apply_world_rotation(obj, pivot, rotation)
        distributed_objects.extend(duplicated_set)
    _set_selection(context, distributed_objects, active=source_objects[0] if source_objects else None)
    if total_sets == 1:
        return {
            "message": (
                f"Distribute count 1 kept {selected_count} selected object(s) unchanged around {axis}."
            ),
            "changed": len(distributed_objects),
        }
    spacing = abs(step_angle)
    copy_sets = max(total_sets - 1, 0)
    return {
        "message": (
            f"Distributed {selected_count} selected object(s) into {total_sets} total positions "
            f"by creating {copy_sets} duplicate set(s) at {spacing:.2f} degree spacing around {axis}."
        ),
        "changed": len(distributed_objects),
    }


def run_flowcell_action(context=None, data=None):
    context = _ctx(context)
    payload = data or {}
    command = str(payload.get("command", "apply") or "apply").strip().lower()
    if command != "apply":
        raise ValueError(f"Unsupported quick rotate command: {command}")

    objects = _selected_objects(context)
    if not objects:
        raise ValueError("Select at least one object.")

    axis = str(payload.get("axis", "Z") or "Z").strip().upper()
    center_mode = str(payload.get("center_mode", "WORLD") or "WORLD").strip().upper()
    operation_mode = (
        str(payload.get("operation_mode", "TRANSFORM") or "TRANSFORM").strip().upper()
    )
    angle_deg = float(payload.get("angle_deg", 15.0) or 15.0)
    distribute_count = max(1, int(round(float(payload.get("distribute_count", 3) or 3))))

    if operation_mode not in SUPPORTED_OPERATION_MODES:
        raise ValueError(f"Unsupported operation mode: {operation_mode}")

    pivot = _pivot_point(context, objects, center_mode)
    if operation_mode == "DISTRIBUTE":
        angle_deg = 360.0 if angle_deg >= 0 else -360.0
        return _perform_distribute(context, objects, pivot, axis, angle_deg, distribute_count)
    return _perform_transform(context, objects, pivot, axis, angle_deg)
