# Description: Split joined or physically separated parts into disconnected objects and set each new origin to geometry.

import bmesh
import bpy
from collections import deque

MERGE_DISTANCE = 0.00001


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


def build_submesh(bm_source, vert_ids):
    bm_source.verts.ensure_lookup_table()
    bm_source.faces.ensure_lookup_table()

    bm_new = bmesh.new()
    vert_map = {}

    for vert in bm_source.verts:
        if vert.index in vert_ids:
            vert_map[vert.index] = bm_new.verts.new(vert.co)

    bm_new.verts.ensure_lookup_table()

    for face in bm_source.faces:
        if not all(vert.index in vert_ids for vert in face.verts):
            continue
        new_face_verts = [vert_map[vert.index] for vert in face.verts]
        try:
            new_face = bm_new.faces.new(new_face_verts)
            new_face.material_index = face.material_index
            new_face.smooth = face.smooth
        except ValueError:
            # Skip duplicate faces if the source mesh happens to contain them.
            pass

    bm_new.normal_update()
    return bm_new


def perform_split_loose_parts(context=None, data=None):
    del data
    ctx = _ctx(context)
    obj = _active_mesh_object(ctx)
    source_name = obj.name
    split_base_name = _split_base_name(source_name)

    if ctx.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    mesh = obj.data
    bm = bmesh.new()

    try:
        bm.from_mesh(mesh)
        bm.verts.ensure_lookup_table()
        bm.edges.ensure_lookup_table()
        bm.faces.ensure_lookup_table()

        # Weld nearly coincident verts first so disconnected face islands do not explode into one object per face.
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=MERGE_DISTANCE)

        components = connected_components(bm)
        if len(components) <= 1:
            return _result("CANCELLED", "No disjoint loose parts were found on the active mesh.")

        part_names = [f"{split_base_name} {index}" for index in range(1, len(components) + 1)]
        collisions = [name for name in part_names if bpy.data.objects.get(name) is not None]
        if collisions:
            return _result(
                "CANCELLED",
                f"Cannot split because target object names already exist: {', '.join(collisions)}.",
            )

        collections = list(obj.users_collection) or [ctx.scene.collection]
        new_objects = []

        for component, part_name in zip(components, part_names):
            part_bmesh = build_submesh(bm, component)
            part_mesh = bpy.data.meshes.new(part_name)

            try:
                part_bmesh.to_mesh(part_mesh)
            finally:
                part_bmesh.free()

            for material in mesh.materials:
                part_mesh.materials.append(material)

            part_object = bpy.data.objects.new(part_name, part_mesh)
            part_object.matrix_world = obj.matrix_world.copy()

            for collection in collections:
                collection.objects.link(part_object)

            new_objects.append(part_object)
    finally:
        bm.free()

    bpy.ops.object.select_all(action="DESELECT")
    new_objects[0].select_set(True)
    ctx.view_layer.objects.active = new_objects[0]

    bpy.data.objects.remove(obj, do_unlink=True)

    for new_object in new_objects:
        bpy.ops.object.select_all(action="DESELECT")
        new_object.select_set(True)
        ctx.view_layer.objects.active = new_object
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="MEDIAN")

    bpy.ops.object.select_all(action="DESELECT")
    for new_object in new_objects:
        new_object.select_set(True)
    ctx.view_layer.objects.active = new_objects[0]

    return _result(
        "FINISHED",
        f"Split '{source_name}' into {len(new_objects)} loose parts and set origins to geometry.",
        changed=len(new_objects),
        created_objects=[new_object.name for new_object in new_objects],
    )


def run_flowcell_action(context=None, data=None):
    return perform_split_loose_parts(context=context, data=data)
