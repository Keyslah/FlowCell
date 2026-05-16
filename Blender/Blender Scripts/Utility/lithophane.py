# Description: Pick one or more images in Blender, create DPI-sized planes, and turn them into lithophanes automatically.

import bmesh
import bpy
import os

from bpy.props import CollectionProperty, FloatProperty, StringProperty
from bpy.types import OperatorFileListElement
from bpy_extras.io_utils import ImportHelper

DEFAULT_DPI = 300.0
SOLIDIFY_THICKNESS_METERS = 0.016
TOP_FACE_SUBDIVISION_CUTS = 20
SUBSURF_LEVELS = 6
DISPLACE_MID_LEVEL = -0.01
TOP_FACE_GROUP_NAME = "TopFaceGroup"
OPERATOR_ID = "flowtest.create_lithophane_from_image"
OPERATOR_CLASS_NAME = "FLOWTEST_OT_create_lithophane_from_image"


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
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


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

    base_name = os.path.splitext(os.path.basename(image.filepath or image.name))[0]
    plane.name = base_name

    width_px = float(image.size[0])
    height_px = float(image.size[1])
    plane.dimensions.x = _px_to_m(width_px, dpi)
    plane.dimensions.y = _px_to_m(height_px, dpi)
    plane.dimensions.z = 0.0

    _apply_object_scale(context, plane)
    _ensure_plane_uvs(context, plane)

    material = _create_image_material(base_name, image)
    plane.data.materials.clear()
    plane.data.materials.append(material)
    return plane


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


def perform_make_lithophane(context=None, data=None, image=None):
    del data
    ctx = _ctx(context)
    obj = getattr(ctx.view_layer.objects, "active", None)
    if obj is None or obj.type != "MESH":
        raise ValueError("Select one active mesh object before making a lithophane.")
    if image is None:
        raise ValueError("A loaded image is required to build the lithophane displacement.")

    _apply_object_scale(ctx, obj)

    solidify_modifier = obj.modifiers.new(name="Solidify", type="SOLIDIFY")
    solidify_modifier.thickness = SOLIDIFY_THICKNESS_METERS
    bpy.ops.object.modifier_apply(modifier=solidify_modifier.name)

    _set_active_object(ctx, obj, select_only=True)
    _safe_mode_set("EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.mesh.select_all(action="DESELECT")

    _select_top_face(obj.data)
    bpy.ops.mesh.subdivide(number_cuts=TOP_FACE_SUBDIVISION_CUTS)
    selected_vertex_indices = _collect_selected_vertex_indices(obj.data)

    _safe_mode_set("OBJECT")
    _create_or_replace_vertex_group(obj, TOP_FACE_GROUP_NAME, selected_vertex_indices)
    _add_subsurf_modifier(obj)
    _add_displace_modifier(obj, image)

    return {
        "message": f"Lithophane setup complete for {obj.name} using {image.name}.",
        "display": "Lithophane setup complete",
        "object": obj.name,
        "image": image.name,
    }


def _create_lithophane_from_path(context, image_path, dpi):
    image = _load_image(image_path)
    plane = _create_textured_plane_for_image(context, image, dpi)
    _set_active_object(context, plane, select_only=True)

    result = perform_make_lithophane(context=context, image=image)
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


class FLOWTEST_OT_create_lithophane_from_image(bpy.types.Operator, ImportHelper):
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
    if existing is FLOWTEST_OT_create_lithophane_from_image:
        return
    if existing is not None:
        bpy.utils.unregister_class(existing)
    bpy.utils.register_class(FLOWTEST_OT_create_lithophane_from_image)


def run_flowcell_action(context=None, data=None):
    if isinstance(data, dict) and (data.get("image_path") or data.get("image_paths")):
        return perform_create_lithophane_from_images(context=context, data=data)

    ensure_picker_operator_registered()
    bpy.ops.flowtest.create_lithophane_from_image("INVOKE_DEFAULT")
    return _result("FINISHED", "Lithophane image picker opened in Blender.")
