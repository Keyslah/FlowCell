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


def _perform_distribute(context, objects, pivot, axis, angle_deg):
    ordered = _ordered_selection(context)
    if len(ordered) < 2:
        result = _perform_transform(context, objects, pivot, axis, angle_deg)
        result["message"] = (
            f"{result['message']} Distribute used normal rotate because fewer than two objects were selected."
        )
        return result
    for index, obj in enumerate(ordered):
        rotation = _rotation_quaternion(axis, angle_deg * index)
        _apply_world_rotation(obj, pivot, rotation)
    return {
        "message": (
            f"Distributed {len(ordered)} object(s) around {axis} in {angle_deg:.2f} degree steps."
        ),
        "changed": len(ordered),
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

    if operation_mode not in SUPPORTED_OPERATION_MODES:
        raise ValueError(f"Unsupported operation mode: {operation_mode}")

    pivot = _pivot_point(context, objects, center_mode)
    if operation_mode == "DISTRIBUTE":
        return _perform_distribute(context, objects, pivot, axis, angle_deg)
    return _perform_transform(context, objects, pivot, axis, angle_deg)
