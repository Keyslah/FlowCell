# Description: Split joined or physically separated parts into disconnected objects and set each new origin to geometry.

import bmesh
import bpy
from collections import deque

def _ctx(context=None):
    return context or bpy.context


def _result(status="FINISHED", message="", changed=0, **extra):
    result = {"status": status, "message": message, "changed": changed}
    result.update(extra)
    return result


def _active_mesh_object(context=None):
    obj = getattr(_ctx(context), "active_object", None)
    if obj is None or obj.type != "MESH":
        raise ValueError("Select one active mesh object before running Split Loose Parts.")
    return obj


def _split_base_name(object_name):
    stem, separator, suffix = object_name.rpartition(".")
    if separator and stem and len(suffix) == 3 and suffix.isdigit():
        return stem
    return object_name


def connected_components(bm):
    bm.verts.ensure_lookup_table()
    for vert in bm.verts:
        vert.tag = False

    components = []
    for start_vert in bm.verts:
        if start_vert.tag:
            continue

        component = set()
        queue = deque([start_vert])
        start_vert.tag = True

        while queue:
            vert = queue.popleft()
            component.add(vert.index)
            for edge in vert.link_edges:
                other = edge.other_vert(vert)
                if other.tag:
                    continue
                other.tag = True
                queue.append(other)

        components.append(component)

    return components


def perform_split_loose_parts(context=None, data=None):
    del data
    ctx = _ctx(context)
    obj = _active_mesh_object(ctx)
    source_name = obj.name
    split_base_name = _split_base_name(source_name)

    if ctx.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        # Connectivity must use the original topology: welding here can join
        # touching or overlapping parts that the user wants to separate.
        components = connected_components(bm)
    finally:
        bm.free()
    if len(components) <= 1:
        return _result("CANCELLED", "No disjoint loose parts were found on the active mesh.")

    # A linked duplicate must not modify the mesh of its siblings.
    if obj.data.users > 1:
        obj.data = obj.data.copy()

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    ctx.view_layer.objects.active = obj
    before = set(bpy.data.objects)
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        bpy.ops.mesh.select_all(action="SELECT")
        # Native separation preserves UVs, attributes, loose edges, vertex
        # groups and object settings instead of rebuilding only face geometry.
        bpy.ops.mesh.separate(type="LOOSE")
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")

    new_objects = [obj] + [part for part in bpy.data.objects if part not in before]
    # Keep the numbered naming convention, letting Blender allocate suffixes
    # when an earlier split or duplicate already owns a requested name.
    for index, part in enumerate(new_objects, 1):
        part.name = f"{split_base_name} {index}"

    bpy.ops.object.select_all(action="DESELECT")
    for part in new_objects:
        part.select_set(True)
    ctx.view_layer.objects.active = obj
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="MEDIAN")

    return _result(
        "FINISHED",
        f"Split '{source_name}' into {len(new_objects)} loose parts and set origins to geometry.",
        changed=len(new_objects),
        created_objects=[part.name for part in new_objects],
    )


def run_flowcell_action(context=None, data=None):
    return perform_split_loose_parts(context=context, data=data)
