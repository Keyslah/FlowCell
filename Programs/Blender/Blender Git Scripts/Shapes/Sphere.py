# Description: Low poly sphere.

import math

import bmesh
import bpy

AUTO_SMOOTH_ANGLE_DEG = 30.0
DEFAULT_DIAMETER_MM = 38.1
DEFAULT_RINGS = 32
DEFAULT_SEGMENTS = 64
EDGE_TYPES = {"EDGE_SPLIT"}
MERGE_EPS_M = 1e-6
SUBD_TYPES = {"SUBSURF", "SUBDIV"}


def _ctx(context=None):
    return context or bpy.context


def _result(status="FINISHED", message="", changed=0, **extra):
    result = {"status": status, "message": message, "changed": changed}
    result.update(extra)
    return result


def _data_value(data, key, default):
    if not isinstance(data, dict):
        return default
    return data.get(key, default)


def scene_unit_scale(context=None):
    return _ctx(context).scene.unit_settings.scale_length or 1.0


def mm_to_bu(mm, context=None):
    return (mm / 1000.0) / scene_unit_scale(context)


def ensure_object_mode(context=None):
    ctx = _ctx(context)
    active = getattr(ctx, "active_object", None)
    if active and active.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def make_active(obj, context=None):
    ctx = _ctx(context)
    for other in ctx.view_layer.objects:
        other.select_set(False)
    obj.select_set(True)
    ctx.view_layer.objects.active = obj


def remove_ghost_mods(obj):
    for modifier in list(obj.modifiers):
        if modifier.type in SUBD_TYPES or modifier.type in EDGE_TYPES:
            try:
                obj.modifiers.remove(modifier)
            except Exception:
                pass


def boolean_cleanup_ops_bmesh(obj, context=None, merge_dist_m=MERGE_EPS_M):
    ensure_object_mode(context)
    make_active(obj, context)
    try:
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    except Exception:
        pass

    mesh = obj.data
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        loose_verts = [vert for vert in bm.verts if len(vert.link_edges) == 0]
        if loose_verts:
            bmesh.ops.delete(bm, geom=loose_verts, context="VERTS")

        loose_edges = [edge for edge in bm.edges if len(edge.link_faces) == 0]
        if loose_edges:
            bmesh.ops.delete(bm, geom=loose_edges, context="EDGES")

        merge_dist_bu = merge_dist_m / scene_unit_scale(context)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge_dist_bu)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.normal_update()
        bm.to_mesh(mesh)
    finally:
        bm.free()

    mesh.update()

    try:
        mesh.use_auto_smooth = True
        if hasattr(mesh, "auto_smooth_angle"):
            mesh.auto_smooth_angle = math.radians(AUTO_SMOOTH_ANGLE_DEG)
    except Exception:
        pass


def perform_boolsafe_sphere(context=None, data=None):
    ctx = _ctx(context)
    diameter_mm = float(_data_value(data, "diameter_mm", DEFAULT_DIAMETER_MM))
    segments = int(_data_value(data, "segments", DEFAULT_SEGMENTS))
    rings = int(_data_value(data, "rings", DEFAULT_RINGS))

    if diameter_mm <= 0.0:
        raise ValueError("Sphere diameter_mm must be greater than zero.")
    if segments < 3:
        raise ValueError("Sphere segments must be at least 3.")
    if rings < 2:
        raise ValueError("Sphere rings must be at least 2.")

    ensure_object_mode(ctx)
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=mm_to_bu(diameter_mm * 0.5, ctx),
        segments=segments,
        ring_count=rings,
        enter_editmode=False,
        align="WORLD",
        location=(0.0, 0.0, 0.0),
    )
    obj = ctx.active_object
    if obj is None:
        return _result("CANCELLED", "Blender did not create a sphere object.")

    make_active(obj, ctx)
    remove_ghost_mods(obj)
    boolean_cleanup_ops_bmesh(obj, ctx)
    try:
        bpy.ops.object.shade_smooth()
    except Exception:
        pass

    return _result(
        "FINISHED",
        f"Added Boolean-safe sphere '{obj.name}'.",
        changed=1,
        object_name=obj.name,
        diameter_mm=diameter_mm,
        segments=segments,
        rings=rings,
    )


def run_flowcell_action(context=None, data=None):
    return perform_boolsafe_sphere(context=context, data=data)
