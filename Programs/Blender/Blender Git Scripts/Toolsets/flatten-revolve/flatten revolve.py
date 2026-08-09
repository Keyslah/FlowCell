# Description: Flatten the active mesh into a centered profile, hide the source object, and revolve the profile in place.


from __future__ import annotations

import math

import bpy
from mathutils import Matrix, Vector


LEGACY_FLATTEN_REVOLVE_COLLECTION_NAMES = {"FR_Profiles", "FR_Extruded", "FR_Revolved"}


def _ctx(context=None):
    return context or bpy.context


def _result(status="ok", message="", **extra):
    return {"status": status, "message": message, **extra}


def get_flowcell_alignment_bounds(obj):
    world_matrix = obj.matrix_world
    corners = getattr(obj, "bound_box", None)
    if not corners:
        origin = world_matrix.translation.copy()
        return origin.copy(), origin.copy()

    points = [world_matrix @ Vector(corner) for corner in corners]
    mins = Vector((
        min(point.x for point in points),
        min(point.y for point in points),
        min(point.z for point in points),
    ))
    maxs = Vector((
        max(point.x for point in points),
        max(point.y for point in points),
        max(point.z for point in points),
    ))
    return mins, maxs


def convex_hull_2d(points):
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts

    def cross(origin, a, b):
        return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0])

    lower = []
    for point in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)

    upper = []
    for point in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)

    return lower[:-1] + upper[:-1]


def get_flowcell_combined_bounds(objects):
    if not objects:
        origin = Vector((0.0, 0.0, 0.0))
        return origin.copy(), origin.copy()

    min_vec = Vector((float("inf"), float("inf"), float("inf")))
    max_vec = Vector((-float("inf"), -float("inf"), -float("inf")))

    for obj in objects:
        obj_min, obj_max = get_flowcell_alignment_bounds(obj)
        min_vec.x = min(min_vec.x, obj_min.x)
        min_vec.y = min(min_vec.y, obj_min.y)
        min_vec.z = min(min_vec.z, obj_min.z)
        max_vec.x = max(max_vec.x, obj_max.x)
        max_vec.y = max(max_vec.y, obj_max.y)
        max_vec.z = max(max_vec.z, obj_max.z)

    return min_vec, max_vec


def get_flowcell_center_point(context, source_obj, center_mode):
    mode = str(center_mode or "WORLD").strip().upper()
    if mode == "WORLD":
        return Vector((0.0, 0.0, 0.0))
    if mode == "CURSOR":
        return context.scene.cursor.location.copy()
    if mode == "OBJECT":
        active = getattr(context.view_layer.objects, "active", None)
        if active is not None:
            return active.matrix_world.translation.copy()
        return source_obj.matrix_world.translation.copy()

    selected_meshes = [obj for obj in context.selected_objects if obj.type == "MESH"]
    if not selected_meshes:
        selected_meshes = [source_obj]

    if mode == "ORIGIN":
        point = Vector((0.0, 0.0, 0.0))
        for obj in selected_meshes:
            point += obj.matrix_world.translation
        return point / len(selected_meshes)

    bounds_min, bounds_max = get_flowcell_combined_bounds(selected_meshes)
    return (bounds_min + bounds_max) * 0.5


def get_flowcell_source_for_profile(context, profile_obj):
    del context
    source_name = str(profile_obj.get("flowcell_source_object", "") or "").strip()
    source_obj = bpy.data.objects.get(source_name) if source_name else None
    if source_obj is not None and source_obj.type == "MESH":
        return source_obj
    return profile_obj


def active_mesh_object(context):
    obj = getattr(context.view_layer.objects, "active", None)
    if obj is None or obj.type != "MESH":
        raise ValueError("Select one active mesh object.")
    return obj


def ensure_object_mode_for_mesh_action(context, active_obj=None):
    current_mode = str(getattr(context, "mode", "OBJECT") or "OBJECT").strip().upper()
    if current_mode == "OBJECT":
        return

    if active_obj is None:
        active_obj = getattr(context.view_layer.objects, "active", None)
    if active_obj is None:
        raise ValueError("Select an active mesh object before running this tool.")

    context.view_layer.objects.active = active_obj
    bpy.ops.object.mode_set(mode="OBJECT")


def project_object_vertices_to_profile(context, obj, axis):
    axis = str(axis or "Y").strip().upper()
    axis_lookup = {"X": 0, "Y": 1, "Z": 2}
    if axis not in axis_lookup:
        raise ValueError(f"Unsupported flatten axis: {axis}")

    depsgraph = context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        if not mesh.vertices:
            raise ValueError(f"'{obj.name}' has no vertices to flatten.")

        source_min, source_max = get_flowcell_combined_bounds([obj])
        source_center = (source_min + source_max) * 0.5
        fixed_value = source_center[axis_lookup[axis]]

        points_2d = []
        world_matrix = evaluated.matrix_world
        for vert in mesh.vertices:
            world_co = world_matrix @ vert.co
            if axis == "X":
                points_2d.append((float(world_co.y), float(world_co.z)))
            elif axis == "Y":
                points_2d.append((float(world_co.x), float(world_co.z)))
            else:
                points_2d.append((float(world_co.x), float(world_co.y)))

        hull = convex_hull_2d(points_2d)
        if len(hull) < 3:
            raise ValueError("Not enough unique projected points to create a profile.")

        profile_points = []
        for a, b in hull:
            if axis == "X":
                profile_points.append(Vector((fixed_value, a, b)))
            elif axis == "Y":
                profile_points.append(Vector((a, fixed_value, b)))
            else:
                profile_points.append(Vector((a, b, fixed_value)))
        return profile_points
    finally:
        evaluated.to_mesh_clear()


def make_unique_object_name(base_name):
    candidate = base_name
    index = 2
    while bpy.data.objects.get(candidate) is not None:
        candidate = f"{base_name}_{index}"
        index += 1
    return candidate


def get_flowcell_active_output_collection(context):
    target_collection = getattr(context, "collection", None)
    if target_collection is None or target_collection.name in LEGACY_FLATTEN_REVOLVE_COLLECTION_NAMES:
        return context.scene.collection
    return target_collection


def link_object_to_active_collection(context, obj):
    target_collection = get_flowcell_active_output_collection(context)

    if obj.name not in target_collection.objects:
        target_collection.objects.link(obj)

    for collection in list(obj.users_collection):
        if collection != target_collection:
            collection.objects.unlink(obj)


def cleanup_legacy_flatten_revolve_collections(context):
    target_collection = get_flowcell_active_output_collection(context)
    moved_count = 0
    for collection_name in sorted(LEGACY_FLATTEN_REVOLVE_COLLECTION_NAMES):
        collection = bpy.data.collections.get(collection_name)
        if collection is None:
            continue

        for obj in list(collection.objects):
            if obj.name not in target_collection.objects:
                target_collection.objects.link(obj)
            collection.objects.unlink(obj)
            moved_count += 1

        if not collection.objects and not collection.children:
            bpy.data.collections.remove(collection)

    return moved_count


def set_object_origin_preserve_world_geometry(obj, origin):
    mesh = obj.data
    world_points = [obj.matrix_world @ vert.co for vert in mesh.vertices]
    obj.matrix_world = Matrix.Translation(origin)
    inverse = obj.matrix_world.inverted()
    for vert, world_point in zip(mesh.vertices, world_points):
        vert.co = inverse @ world_point
    mesh.update()


def create_flowcell_flatten_profile(context, source_obj, flatten_axis, center_mode):
    axis = str(flatten_axis or "Y").strip().upper()
    profile_points = project_object_vertices_to_profile(context, source_obj, axis)
    origin = get_flowcell_center_point(context, source_obj, center_mode)
    local_points = [point - origin for point in profile_points]

    mesh_name = make_unique_object_name(f"{source_obj.name}_Profile_{axis}_Mesh")
    mesh = bpy.data.meshes.new(mesh_name)
    mesh.from_pydata([tuple(point) for point in local_points], [], [list(range(len(local_points)))])
    mesh.update()

    object_name = make_unique_object_name(f"{source_obj.name}_Profile_{axis}")
    profile_obj = bpy.data.objects.new(object_name, mesh)
    profile_obj.location = origin
    profile_obj["flowcell_is_flatten_profile"] = True
    profile_obj["flowcell_source_object"] = source_obj.name
    profile_obj["flowcell_flatten_axis"] = axis
    link_object_to_active_collection(context, profile_obj)

    source_obj.hide_set(True)
    source_obj.hide_render = True

    bpy.ops.object.select_all(action="DESELECT")
    profile_obj.select_set(True)
    context.view_layer.objects.active = profile_obj
    context.scene["flowcell_flatten_revolve_last_profile"] = profile_obj.name
    return profile_obj


def get_flowcell_revolve_target(context, center_mode):
    active = getattr(context.view_layer.objects, "active", None)
    selected_meshes = [obj for obj in context.selected_objects if obj.type == "MESH"]
    mode = str(center_mode or "WORLD").strip().upper()

    if mode == "OBJECT":
        if active is None:
            raise ValueError("Select an active pivot object and one mesh object to revolve.")
        revolve_targets = [obj for obj in selected_meshes if obj != active]
        if revolve_targets:
            return revolve_targets[0]
        if active.type == "MESH":
            raise ValueError("Object pivot mode uses the active object as the pivot. Select another mesh object to revolve.")
        raise ValueError("Select one mesh object to revolve besides the active pivot object.")

    if active is not None and active.type == "MESH":
        return active

    if selected_meshes:
        return selected_meshes[0]

    last_name = str(context.scene.get("flowcell_flatten_revolve_last_profile", "") or "").strip()
    target = bpy.data.objects.get(last_name) if last_name else None
    if target is not None and target.type == "MESH":
        return target

    raise ValueError("Select a mesh object to revolve.")


def apply_flowcell_revolve(context, obj, revolve_axis, center_mode, angle_deg, steps, merge_distance):
    axis = str(revolve_axis or "Z").strip().upper()
    if axis not in {"X", "Y", "Z"}:
        raise ValueError(f"Unsupported revolve axis: {axis}")

    source_obj = get_flowcell_source_for_profile(context, obj)
    origin = get_flowcell_center_point(context, source_obj, center_mode)
    set_object_origin_preserve_world_geometry(obj, origin)

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    context.view_layer.objects.active = obj

    modifier = obj.modifiers.new(name="FlowCell_Revolve", type="SCREW")
    modifier.axis = axis
    modifier.angle = math.radians(float(angle_deg))
    modifier.steps = int(max(3, steps))
    modifier.render_steps = int(max(3, steps))
    modifier.use_merge_vertices = True
    modifier.merge_threshold = float(max(0.0, merge_distance))
    modifier.use_smooth_shade = True

    result = bpy.ops.object.modifier_apply(modifier=modifier.name)
    if result is None or "FINISHED" not in result:
        raise ValueError("Revolve modifier did not finish.")


def perform_flowcell_flatten_revolve_tool(context=None, data=None):
    ctx = _ctx(context)
    payload = dict(data or {})
    command = str(payload.get("command", "flatten_profile") or "flatten_profile").strip().lower()
    if command in {"", "status", "state", "probe"}:
        return _result(message="Flatten revolve toolset is ready.")

    if command == "cleanup_legacy":
        moved_count = cleanup_legacy_flatten_revolve_collections(ctx)
        return _result(message=f"Removed legacy FR collections and moved {moved_count} object link(s) to the active collection.")

    cleanup_legacy_flatten_revolve_collections(ctx)

    center_mode = str(payload.get("center_mode", "WORLD") or "WORLD").strip().upper()
    if center_mode not in {"GEOMETRY", "ORIGIN", "WORLD", "CURSOR", "OBJECT"}:
        raise ValueError(f"Unsupported center mode: {center_mode}")

    if command == "flatten_profile":
        source_obj = active_mesh_object(ctx)
        ensure_object_mode_for_mesh_action(ctx, source_obj)
        flatten_axis = str(payload.get("flatten_axis", "Y") or "Y").strip().upper()
        profile_obj = create_flowcell_flatten_profile(ctx, source_obj, flatten_axis, center_mode)
        return _result(message=f"Created profile '{profile_obj.name}' and hid '{source_obj.name}'.")

    if command == "generate_revolve":
        target_obj = get_flowcell_revolve_target(ctx, center_mode)
        ensure_object_mode_for_mesh_action(ctx, target_obj)
        angle_deg = payload.get("angle_deg", 360.0)
        revolve_steps = payload.get("revolve_steps", 128)
        merge_distance = payload.get("merge_distance", 0.0001)
        apply_flowcell_revolve(
            ctx,
            target_obj,
            str(payload.get("revolve_axis", "Z") or "Z"),
            center_mode,
            float(360.0 if angle_deg in (None, "") else angle_deg),
            int(128 if revolve_steps in (None, "") else revolve_steps),
            float(0.0001 if merge_distance in (None, "") else merge_distance),
        )
        return _result(message=f"Revolved '{target_obj.name}' in place.")

    raise ValueError(f"Unsupported flatten revolve command: {command}")


def run_flowcell_action(context=None, data=None):
    return perform_flowcell_flatten_revolve_tool(context=context, data=data)
