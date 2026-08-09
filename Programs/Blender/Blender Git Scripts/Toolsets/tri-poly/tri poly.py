# Description: Create triangle and regular polygon prism shapes from a compact Tri & Poly tool set.


from __future__ import annotations

import math

import bmesh
import bpy


DEFAULT_DEPTH_MM = 4.0
DEFAULT_SIDE_MM = 20.0
DEFAULT_POLYGON_SIDES = 15
MIN_POLYGON_SIDES = 3
MAX_POLYGON_SIDES = 96
DEFAULT_ANGLE_DEG = 50.0
MIN_ANGLE_DEG = 1.0
MAX_ANGLE_DEG = 178.0
MERGE_EPS_M = 1e-6


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


def _scene_sides(context=None):
    ctx = _ctx(context)
    _ensure_scene_props()
    return int(getattr(ctx.scene, "flowcell_tri_poly_sides", DEFAULT_POLYGON_SIDES))


def _scene_angle_deg(context=None):
    ctx = _ctx(context)
    _ensure_scene_props()
    return float(getattr(ctx.scene, "flowcell_tri_poly_angle_deg", DEFAULT_ANGLE_DEG))


def _set_scene_sides(context=None, sides=DEFAULT_POLYGON_SIDES):
    ctx = _ctx(context)
    _ensure_scene_props()
    normalized = _clamp_sides(sides)
    setattr(ctx.scene, "flowcell_tri_poly_sides", normalized)
    return normalized


def _set_scene_angle_deg(context=None, angle_deg=DEFAULT_ANGLE_DEG):
    ctx = _ctx(context)
    _ensure_scene_props()
    normalized = _clamp_angle_deg(angle_deg)
    setattr(ctx.scene, "flowcell_tri_poly_angle_deg", normalized)
    return normalized


def _clamp_sides(value):
    try:
        sides = int(round(float(value)))
    except Exception:
        sides = DEFAULT_POLYGON_SIDES
    return max(MIN_POLYGON_SIDES, min(MAX_POLYGON_SIDES, sides))


def _clamp_angle_deg(value):
    try:
        angle_deg = float(value)
    except Exception:
        angle_deg = DEFAULT_ANGLE_DEG
    return max(MIN_ANGLE_DEG, min(MAX_ANGLE_DEG, angle_deg))


def scene_unit_scale(context=None):
    return _ctx(context).scene.unit_settings.scale_length or 1.0


def mm_to_bu(mm, context=None):
    return (float(mm) / 1000.0) / scene_unit_scale(context)


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


def _center_points(points):
    if not points:
        return []
    cx = sum(point[0] for point in points) / len(points)
    cy = sum(point[1] for point in points) / len(points)
    return [(point[0] - cx, point[1] - cy) for point in points]


def _cleanup_mesh(obj, context=None):
    mesh = obj.data
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        loose_verts = [vert for vert in bm.verts if len(vert.link_edges) == 0]
        if loose_verts:
            bmesh.ops.delete(bm, geom=loose_verts, context="VERTS")

        merge_dist_bu = MERGE_EPS_M / scene_unit_scale(context)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge_dist_bu)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.normal_update()
        bm.to_mesh(mesh)
    finally:
        bm.free()

    mesh.update()


def _create_prism(name, points_mm, depth_mm=DEFAULT_DEPTH_MM, context=None):
    ctx = _ctx(context)
    ensure_object_mode(ctx)

    points = _center_points(points_mm)
    count = len(points)
    if count < 3:
        raise ValueError("A prism needs at least three points.")

    half_depth = mm_to_bu(depth_mm, ctx) / 2.0
    bottom = [(mm_to_bu(x, ctx), mm_to_bu(y, ctx), -half_depth) for x, y in points]
    top = [(mm_to_bu(x, ctx), mm_to_bu(y, ctx), half_depth) for x, y in points]
    vertices = bottom + top

    faces = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
    for index in range(count):
        next_index = (index + 1) % count
        faces.append((index, next_index, next_index + count, index + count))

    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    ctx.collection.objects.link(obj)
    make_active(obj, ctx)
    _cleanup_mesh(obj, ctx)

    try:
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    except Exception:
        pass

    return obj


def _equilateral_points(side_mm):
    height = side_mm * math.sqrt(3.0) / 2.0
    return [
        (-side_mm / 2.0, -height / 3.0),
        (side_mm / 2.0, -height / 3.0),
        (0.0, 2.0 * height / 3.0),
    ]


def _isosceles_points(side_mm):
    height = side_mm * 1.15
    return [
        (-side_mm / 2.0, -height / 3.0),
        (side_mm / 2.0, -height / 3.0),
        (0.0, 2.0 * height / 3.0),
    ]


def _apex_angle_points(side_mm, angle_deg=DEFAULT_ANGLE_DEG):
    half_angle = math.radians(_clamp_angle_deg(angle_deg) / 2.0)
    base = 2.0 * side_mm * math.sin(half_angle)
    height = side_mm * math.cos(half_angle)
    return [
        (-base / 2.0, -height / 3.0),
        (base / 2.0, -height / 3.0),
        (0.0, 2.0 * height / 3.0),
    ]


def _right_points(side_mm):
    points = [(0.0, 0.0), (side_mm, 0.0), (0.0, side_mm)]
    return _center_points(points)


def _scalene_points(side_mm):
    return [
        (-0.55 * side_mm, -0.35 * side_mm),
        (0.62 * side_mm, -0.25 * side_mm),
        (-0.10 * side_mm, 0.70 * side_mm),
    ]


def _polygon_points(sides, side_mm):
    sides = _clamp_sides(sides)
    radius = side_mm / (2.0 * math.sin(math.pi / float(sides)))
    offset = math.pi / 2.0
    return [
        (
            math.cos(offset + (2.0 * math.pi * index / sides)) * radius,
            math.sin(offset + (2.0 * math.pi * index / sides)) * radius,
        )
        for index in range(sides)
    ]


TRIANGLE_FACTORIES = {
    "triangle_equilateral": ("Equilateral Triangle", _equilateral_points),
    "triangle_isosceles": ("Isosceles Triangle", _isosceles_points),
    "triangle_50": ("Angle Triangle", _apex_angle_points),
    "triangle_right": ("Right Triangle", _right_points),
    "triangle_scalene": ("Scalene Triangle", _scalene_points),
}


def create_triangle(command, context=None, data=None):
    if command not in TRIANGLE_FACTORIES:
        raise ValueError(f"Unsupported triangle command: {command}")

    label, factory = TRIANGLE_FACTORIES[command]
    side_mm = float(_data_value(data, "side_mm", DEFAULT_SIDE_MM))
    depth_mm = float(_data_value(data, "depth_mm", DEFAULT_DEPTH_MM))
    if side_mm <= 0.0 or depth_mm <= 0.0:
        raise ValueError("side_mm and depth_mm must be greater than zero.")

    angle_deg = _scene_angle_deg(context)
    if command == "triangle_50":
        angle_deg = _set_scene_angle_deg(
            context,
            _data_value(data, "angle_deg", _data_value(data, "angle", angle_deg)),
        )
        label = f"{angle_deg:g} Degree Triangle"
        points = factory(side_mm, angle_deg)
    else:
        points = factory(side_mm)

    obj = _create_prism(label, points, depth_mm, context)
    return _result(
        "FINISHED",
        f"Added {label} '{obj.name}'.",
        changed=1,
        object_name=obj.name,
        mode=command,
        side_mm=side_mm,
        depth_mm=depth_mm,
        sides=_scene_sides(context),
        angle_deg=angle_deg,
    )


def create_polygon(context=None, data=None):
    sides = _clamp_sides(_data_value(data, "sides", _scene_sides(context)))
    side_mm = float(_data_value(data, "side_mm", DEFAULT_SIDE_MM))
    depth_mm = float(_data_value(data, "depth_mm", DEFAULT_DEPTH_MM))
    if side_mm <= 0.0 or depth_mm <= 0.0:
        raise ValueError("side_mm and depth_mm must be greater than zero.")

    _set_scene_sides(context, sides)
    obj = _create_prism(f"{sides}-Sided Polygon", _polygon_points(sides, side_mm), depth_mm, context)
    return _result(
        "FINISHED",
        f"Added {sides}-sided polygon prism '{obj.name}'.",
        changed=1,
        object_name=obj.name,
        sides=sides,
        angle_deg=_scene_angle_deg(context),
        side_mm=side_mm,
        depth_mm=depth_mm,
    )


def _status(context=None):
    return _result(
        "OK",
        "Tri & Poly tool set ready.",
        changed=0,
        sides=_scene_sides(context),
        angle_deg=_scene_angle_deg(context),
    )


def _ensure_scene_props():
    if not hasattr(bpy.types.Scene, "flowcell_tri_poly_sides"):
        bpy.types.Scene.flowcell_tri_poly_sides = bpy.props.IntProperty(
            name="Sides",
            default=DEFAULT_POLYGON_SIDES,
            min=MIN_POLYGON_SIDES,
            max=MAX_POLYGON_SIDES,
        )
    if not hasattr(bpy.types.Scene, "flowcell_tri_poly_angle_deg"):
        bpy.types.Scene.flowcell_tri_poly_angle_deg = bpy.props.FloatProperty(
            name="Angle °",
            default=DEFAULT_ANGLE_DEG,
            min=MIN_ANGLE_DEG,
            max=MAX_ANGLE_DEG,
        )


class FLOWCELL_OT_tri_poly_action(bpy.types.Operator):
    bl_idname = "flowcell.tri_poly_action"
    bl_label = "Tri & Poly Action"
    bl_options = {"REGISTER", "UNDO"}

    command: bpy.props.StringProperty(default="")

    def execute(self, context):
        try:
            result = run_flowcell_action(context=context, data={"command": self.command})
        except Exception as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}

        message = str(result.get("message", "Tri & Poly action complete."))
        self.report({"INFO"}, message)
        return {"FINISHED"}


class FLOWCELL_PT_tri_poly_panel(bpy.types.Panel):
    bl_label = "Tri & Poly"
    bl_idname = "FLOWCELL_PT_tri_poly_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Tool"

    def draw(self, context):
        _ensure_scene_props()
        layout = self.layout

        row = layout.row(align=True)
        row.label(text="Triangl...")
        for command, label in (
            ("triangle_equilateral", "Equila..."),
            ("triangle_isosceles", "Isosc..."),
        ):
            op = row.operator(FLOWCELL_OT_tri_poly_action.bl_idname, text=label)
            op.command = command
        row.prop(context.scene, "flowcell_tri_poly_angle_deg", text="")
        op = row.operator(FLOWCELL_OT_tri_poly_action.bl_idname, text="°")
        op.command = "triangle_50"
        for command, label in (
            ("triangle_right", "Right"),
            ("triangle_scalene", "Scalene"),
        ):
            op = row.operator(FLOWCELL_OT_tri_poly_action.bl_idname, text=label)
            op.command = command

        row = layout.row(align=True)
        row.label(text="Polygon")
        row.prop(context.scene, "flowcell_tri_poly_sides", text="Sides")
        op = row.operator(FLOWCELL_OT_tri_poly_action.bl_idname, text="Create")
        op.command = "polygon_create"


CLASSES = (
    FLOWCELL_OT_tri_poly_action,
    FLOWCELL_PT_tri_poly_panel,
)


def register():
    _ensure_scene_props()
    for cls in CLASSES:
        try:
            bpy.utils.register_class(cls)
        except ValueError:
            pass


def unregister():
    for cls in reversed(CLASSES):
        try:
            bpy.utils.unregister_class(cls)
        except RuntimeError:
            pass


def run_flowcell_action(context=None, data=None):
    command = str(_data_value(data, "command", _data_value(data, "action", "status"))).strip().lower()
    if command in {"", "status", "state"}:
        return _status(context)
    if command in TRIANGLE_FACTORIES:
        return create_triangle(command, context=context, data=data)
    if command == "polygon_create":
        return create_polygon(context=context, data=data)
    if command == "set_sides":
        sides = _set_scene_sides(context, _data_value(data, "sides", DEFAULT_POLYGON_SIDES))
        return _result(
            "OK",
            f"Polygon sides set to {sides}.",
            changed=0,
            sides=sides,
            angle_deg=_scene_angle_deg(context),
        )
    if command in {"set_angle", "set_angle_deg"}:
        angle_deg = _set_scene_angle_deg(context, _data_value(data, "angle_deg", DEFAULT_ANGLE_DEG))
        return _result(
            "OK",
            f"Triangle angle set to {angle_deg:g}°.",
            changed=0,
            sides=_scene_sides(context),
            angle_deg=angle_deg,
        )
    raise ValueError(f"Unsupported Tri & Poly command: {command}")


if __name__ == "__main__":
    register()
