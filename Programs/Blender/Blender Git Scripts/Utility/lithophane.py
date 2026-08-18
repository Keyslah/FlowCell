# Description: Pick one or more images in Blender, create DPI-sized planes, and turn them into lithophanes automatically.

import bmesh
import bpy
import math
import os
import re

from bpy.props import CollectionProperty, FloatProperty, StringProperty
from bpy.types import OperatorFileListElement
from bpy_extras.io_utils import ImportHelper

DEFAULT_DPI = 300.0
SOLIDIFY_THICKNESS_METERS = 0.016
TOP_FACE_SUBDIVISION_CUTS = 20
SUBSURF_LEVELS = 6
DISPLACE_MID_LEVEL = -0.01
TOP_FACE_GROUP_NAME = "TopFaceGroup"
OPERATOR_ID = "flowcell.create_lithophane_from_image"
OPERATOR_CLASS_NAME = "FLOWCELL_OT_create_lithophane_from_image"
FLOWCELL_LITHO_SIZE_SUFFIX_RE = re.compile(
    r"^(?P<base>.+?)__fcsize_(?P<width>\d+(?:\.\d+)?)x(?P<height>\d+(?:\.\d+)?)mm$",
    re.IGNORECASE,
)


def _ctx(context=None):
    return context or bpy.context


def _result(status="FINISHED", message="", changed=0, **extra):
    result = {"status": status, "message": message, "changed": changed}
    result.update(extra)
    return result


def _safe_mode_set(mode):
    if bpy.ops.object.mode_set.poll():
        bpy.ops.object.mode_set(mode=mode)


def _set_active_object(context, obj, select_only=False):
    if select_only:
        bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    context.view_layer.objects.active = obj


def _apply_object_scale(context, obj):
    _set_active_object(context, obj, select_only=True)
    _safe_mode_set("OBJECT")
    result = bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if result is None or "FINISHED" not in result:
        raise ValueError(f"Could not apply the scale on {obj.name}.")


def _apply_modifier(context, obj, modifier):
    _set_active_object(context, obj, select_only=True)
    _safe_mode_set("OBJECT")
    result = bpy.ops.object.modifier_apply(modifier=modifier.name)
    if result is None or "FINISHED" not in result:
        raise ValueError(f"Could not apply the {modifier.name} modifier on {obj.name}.")


def _set_material_transparency_compat(material):
    if hasattr(material, "blend_method"):
        material.blend_method = "BLEND"
    elif hasattr(material, "surface_render_method"):
        try:
            material.surface_render_method = "BLENDED"
        except Exception:
            pass

    if hasattr(material, "shadow_method"):
        material.shadow_method = "HASHED"
    elif hasattr(material, "shadow_mode"):
        try:
            material.shadow_mode = "HASHED"
        except Exception:
            pass


def _px_to_m(px, dpi):
    safe_dpi = dpi if dpi and dpi > 0.0 else DEFAULT_DPI
    return (float(px) / float(safe_dpi)) * 0.0254


def _update_view_layer(context):
    update = getattr(getattr(context, "view_layer", None), "update", None)
    if callable(update):
        update()


def _meters_to_blender_units(context, meters):
    value = float(meters)
    unit_settings = getattr(getattr(context, "scene", None), "unit_settings", None)
    scale_length = float(getattr(unit_settings, "scale_length", 1.0) or 1.0)
    if not math.isfinite(value) or value <= 0.0:
        raise ValueError("Lithophane dimensions must be positive and finite.")
    if not math.isfinite(scale_length) or scale_length <= 0.0:
        raise ValueError("Blender scene unit scale must be positive and finite.")
    return value / scale_length


def _validate_xy_dimensions(target_x, target_y):
    resolved_x = float(target_x)
    resolved_y = float(target_y)
    if not math.isfinite(resolved_x) or resolved_x <= 0.0:
        raise ValueError("Lithophane X dimension must be positive and finite.")
    if not math.isfinite(resolved_y) or resolved_y <= 0.0:
        raise ValueError("Lithophane Y dimension must be positive and finite.")
    return resolved_x, resolved_y


def _fit_xy_dimensions(context, obj, target_x, target_y):
    resolved_x, resolved_y = _validate_xy_dimensions(target_x, target_y)
    _update_view_layer(context)
    current_x = abs(float(obj.dimensions.x))
    current_y = abs(float(obj.dimensions.y))
    if not math.isfinite(current_x) or current_x <= 0.0:
        raise ValueError(f"{obj.name} has no measurable X dimension.")
    if not math.isfinite(current_y) or current_y <= 0.0:
        raise ValueError(f"{obj.name} has no measurable Y dimension.")

    obj.scale.x *= resolved_x / current_x
    obj.scale.y *= resolved_y / current_y
    _apply_object_scale(context, obj)
    _update_view_layer(context)

    final_x = abs(float(obj.dimensions.x))
    final_y = abs(float(obj.dimensions.y))
    tolerance_x = max(1e-9, resolved_x * 1e-5)
    tolerance_y = max(1e-9, resolved_y * 1e-5)
    if not math.isclose(final_x, resolved_x, rel_tol=1e-5, abs_tol=tolerance_x):
        raise ValueError(f"{obj.name} did not preserve its X dimension.")
    if not math.isclose(final_y, resolved_y, rel_tol=1e-5, abs_tol=tolerance_y):
        raise ValueError(f"{obj.name} did not preserve its Y dimension.")


def _resolve_image_plane_spec(context, image, dpi):
    source_name = os.path.splitext(os.path.basename(image.filepath or image.name))[0]
    size_match = FLOWCELL_LITHO_SIZE_SUFFIX_RE.match(source_name)
    if size_match:
        base_name = size_match.group("base")
        target_x = _meters_to_blender_units(context, float(size_match.group("width")) / 1000.0)
        target_y = _meters_to_blender_units(context, float(size_match.group("height")) / 1000.0)
        return base_name, target_x, target_y

    width_px = float(image.size[0])
    height_px = float(image.size[1])
    target_x = _meters_to_blender_units(context, _px_to_m(width_px, dpi))
    target_y = _meters_to_blender_units(context, _px_to_m(height_px, dpi))
    return source_name, target_x, target_y


def _ensure_plane_uvs(context, plane):
    if plane.data.uv_layers:
        return
    _set_active_object(context, plane, select_only=True)
    _safe_mode_set("EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project()
    _safe_mode_set("OBJECT")


def _create_image_material(base_name, image):
    material = bpy.data.materials.new(name=f"{base_name}_Mat")
    material.use_nodes = True
    node_tree = material.node_tree
    principled = node_tree.nodes.get("Principled BSDF")
    texture_node = node_tree.nodes.new("ShaderNodeTexImage")
    texture_node.image = image

    if principled is not None:
        node_tree.links.new(texture_node.outputs["Color"], principled.inputs["Base Color"])
        if "Alpha" in texture_node.outputs and "Alpha" in principled.inputs:
            node_tree.links.new(texture_node.outputs["Alpha"], principled.inputs["Alpha"])
            _set_material_transparency_compat(material)

    return material


def _load_image(path):
    if not os.path.isfile(path):
        raise ValueError(f"Image file was not found: {path}")
    try:
        return bpy.data.images.load(path, check_existing=True)
    except RuntimeError as exc:
        raise ValueError(f"Could not load image '{path}': {exc}") from exc


def _create_textured_plane_for_image(context, image, dpi):
    _safe_mode_set("OBJECT")
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    plane = context.view_layer.objects.active

    base_name, target_x, target_y = _resolve_image_plane_spec(context, image, dpi)
    plane.name = base_name
    _fit_xy_dimensions(context, plane, target_x, target_y)
    _ensure_plane_uvs(context, plane)

    material = _create_image_material(base_name, image)
    plane.data.materials.clear()
    plane.data.materials.append(material)
    return plane, (target_x, target_y)


def _collect_selected_vertex_indices(mesh):
    bm = bmesh.from_edit_mesh(mesh)
    return [vertex.index for vertex in bm.verts if vertex.select]


def _create_or_replace_vertex_group(obj, name, vertex_indices):
    existing = obj.vertex_groups.get(name)
    if existing is not None:
        obj.vertex_groups.remove(existing)
    group = obj.vertex_groups.new(name=name)
    if vertex_indices:
        group.add(vertex_indices, 1.0, "REPLACE")
    return group


def _select_top_face(mesh):
    bm = bmesh.from_edit_mesh(mesh)
    top_face = None
    top_z = float("-inf")

    for face in bm.faces:
        avg_z = sum(vertex.co.z for vertex in face.verts) / len(face.verts)
        if avg_z > top_z:
            top_z = avg_z
            top_face = face

    if top_face is None:
        raise ValueError("No face was found on the active mesh.")

    for face in bm.faces:
        face.select = False
    top_face.select = True
    bmesh.update_edit_mesh(mesh)


def _add_subsurf_modifier(obj):
    modifier = obj.modifiers.new(name="Subdivision", type="SUBSURF")
    modifier.subdivision_type = "SIMPLE"
    modifier.levels = SUBSURF_LEVELS
    modifier.render_levels = SUBSURF_LEVELS
    return modifier


def _add_displace_modifier(obj, image):
    modifier = obj.modifiers.new(name="Displace", type="DISPLACE")
    texture = bpy.data.textures.new(name=f"{obj.name}_DispTex", type="IMAGE")
    texture.image = image

    modifier.texture = texture
    modifier.texture_coords = "UV"
    modifier.uv_layer = "UVMap"
    modifier.direction = "Z"
    modifier.vertex_group = TOP_FACE_GROUP_NAME
    modifier.mid_level = DISPLACE_MID_LEVEL
    return modifier


def perform_make_lithophane(context=None, data=None, image=None, target_xy=None):
    del data
    ctx = _ctx(context)
    obj = getattr(ctx.view_layer.objects, "active", None)
    if obj is None or obj.type != "MESH":
        raise ValueError("Select one active mesh object before making a lithophane.")
    if image is None:
        raise ValueError("A loaded image is required to build the lithophane displacement.")

    if target_xy is None:
        _update_view_layer(ctx)
        target_x, target_y = _validate_xy_dimensions(
            abs(float(obj.dimensions.x)),
            abs(float(obj.dimensions.y)),
        )
    else:
        try:
            target_x, target_y = target_xy
        except (TypeError, ValueError) as exc:
            raise ValueError("Lithophane target_xy must contain X and Y dimensions.") from exc
        target_x, target_y = _validate_xy_dimensions(target_x, target_y)

    _apply_object_scale(ctx, obj)

    solidify_modifier = obj.modifiers.new(name="Solidify", type="SOLIDIFY")
    solidify_modifier.thickness = SOLIDIFY_THICKNESS_METERS
    _apply_modifier(ctx, obj, solidify_modifier)

    _set_active_object(ctx, obj, select_only=True)
    _safe_mode_set("EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.mesh.select_all(action="DESELECT")

    _select_top_face(obj.data)
    bpy.ops.mesh.subdivide(number_cuts=TOP_FACE_SUBDIVISION_CUTS)
    selected_vertex_indices = _collect_selected_vertex_indices(obj.data)

    _safe_mode_set("OBJECT")
    _create_or_replace_vertex_group(obj, TOP_FACE_GROUP_NAME, selected_vertex_indices)
    subsurf_modifier = _add_subsurf_modifier(obj)
    displace_modifier = _add_displace_modifier(obj, image)
    _apply_modifier(ctx, obj, subsurf_modifier)
    _apply_modifier(ctx, obj, displace_modifier)
    _fit_xy_dimensions(ctx, obj, target_x, target_y)

    return {
        "message": f"Lithophane setup complete for {obj.name} using {image.name}.",
        "display": "Lithophane setup complete",
        "object": obj.name,
        "image": image.name,
    }


def _create_lithophane_from_path(context, image_path, dpi):
    image = _load_image(image_path)
    plane, target_xy = _create_textured_plane_for_image(context, image, dpi)
    _set_active_object(context, plane, select_only=True)

    result = perform_make_lithophane(context=context, image=image, target_xy=target_xy)
    result["image_path"] = image_path
    result["object"] = result.get("object", plane.name)
    result["image"] = result.get("image", image.name)
    return result


def _normalize_paths(data):
    if not isinstance(data, dict):
        return []
    direct_paths = data.get("image_paths")
    if isinstance(direct_paths, (list, tuple)):
        return [str(path).strip() for path in direct_paths if str(path).strip()]
    direct_path = data.get("image_path")
    if isinstance(direct_path, str) and direct_path.strip():
        return [direct_path.strip()]
    return []


def perform_create_lithophane_from_images(context=None, data=None, image_paths=None, dpi=None):
    ctx = _ctx(context)
    resolved_paths = list(image_paths or _normalize_paths(data))
    if not resolved_paths:
        raise ValueError("No image paths were provided for lithophane creation.")

    resolved_dpi = float(dpi if dpi is not None else (data or {}).get("dpi", DEFAULT_DPI))
    results = []
    for image_path in resolved_paths:
        results.append(_create_lithophane_from_path(ctx, image_path, resolved_dpi))

    final_result = results[-1]
    return _result(
        "FINISHED",
        f"Created {len(results)} lithophane(s). Last result: {final_result['message']}",
        changed=len(results),
        created_objects=[item["object"] for item in results],
        image_paths=resolved_paths,
        display=f"Created {len(results)} lithophane(s)",
    )


class FLOWCELL_OT_create_lithophane_from_image(bpy.types.Operator, ImportHelper):
    bl_idname = OPERATOR_ID
    bl_label = "Create Lithophane From Image"
    bl_options = {"REGISTER", "UNDO"}

    files: CollectionProperty(type=OperatorFileListElement)
    directory: StringProperty(subtype="DIR_PATH")
    filter_image: StringProperty(default="", options={"HIDDEN"})
    filter_glob: StringProperty(
        default="*.png;*.jpg;*.jpeg;*.tif;*.tiff;*.bmp;*.exr;*.hdr",
        options={"HIDDEN"},
    )
    dpi: FloatProperty(
        name="DPI",
        description="Used to convert pixels to real-world size before creating the lithophane plane.",
        default=DEFAULT_DPI,
        min=1.0,
        soft_max=1200.0,
    )

    def execute(self, context):
        if self.files:
            image_paths = [os.path.join(self.directory, item.name) for item in self.files]
        elif self.filepath:
            image_paths = [self.filepath]
        else:
            self.report({"WARNING"}, "No image selected.")
            return {"CANCELLED"}

        try:
            result = perform_create_lithophane_from_images(
                context=context,
                image_paths=image_paths,
                dpi=self.dpi,
            )
        except Exception as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}

        self.report({"INFO"}, result["message"])
        return {"FINISHED"}


def ensure_picker_operator_registered():
    existing = getattr(bpy.types, OPERATOR_CLASS_NAME, None)
    if existing is FLOWCELL_OT_create_lithophane_from_image:
        return
    if existing is not None:
        bpy.utils.unregister_class(existing)
    bpy.utils.register_class(FLOWCELL_OT_create_lithophane_from_image)


def run_flowcell_action(context=None, data=None):
    if isinstance(data, dict) and (data.get("image_path") or data.get("image_paths")):
        return perform_create_lithophane_from_images(context=context, data=data)

    ensure_picker_operator_registered()
    bpy.ops.flowcell.create_lithophane_from_image("INVOKE_DEFAULT")
    return _result("FINISHED", "Lithophane image picker opened in Blender.")
