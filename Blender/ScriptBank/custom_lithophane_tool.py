# Description: Prompt for an image, build a DPI-sized plane, and turn it into a lithophane in one FlowCell action.

import os
import subprocess

import bmesh
import bpy


DEFAULT_DPI = 300.0
DEFAULT_IMAGE_PATHS = ()
DEFAULT_DIALOG_TITLE = "Choose a lithophane image"
DEFAULT_DIALOG_FILTER = "Image Files|*.png;*.jpg;*.jpeg;*.tif;*.tiff;*.bmp;*.exr;*.hdr|All Files|*.*"
SOLIDIFY_THICKNESS_METERS = 0.016
TOP_FACE_SUBDIVISION_CUTS = 20
SUBSURF_LEVELS = 6
DISPLACE_MID_LEVEL = -0.01
TOP_FACE_GROUP_NAME = "TopFaceGroup"


def _resolve_context(context=None):
    return context if context is not None else bpy.context


def _get_data_value(data, key, default=None):
    if isinstance(data, dict):
        return data.get(key, default)
    return default


def _normalize_image_paths(value):
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, (list, tuple, set)):
        result = []
        for item in value:
            if item is None:
                continue
            text = str(item).strip()
            if text:
                result.append(text)
        return result
    text = str(value).strip()
    return [text] if text else []


def _resolve_image_paths(data=None):
    image_paths = _normalize_image_paths(_get_data_value(data, "image_paths"))
    if image_paths:
        return image_paths
    image_path = _get_data_value(data, "image_path")
    if image_path:
        return _normalize_image_paths(image_path)
    return _normalize_image_paths(DEFAULT_IMAGE_PATHS)


def _resolve_single_image_path(data=None):
    image_paths = _resolve_image_paths(data)
    return image_paths[0] if image_paths else None


def _prompt_for_image_path():
    powershell_script = r"""
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '%s'
$dialog.Filter = '%s'
$dialog.Multiselect = $false
$dialog.CheckFileExists = $true
$dialog.CheckPathExists = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $dialog.FileName
}
""" % (
        DEFAULT_DIALOG_TITLE.replace("'", "''"),
        DEFAULT_DIALOG_FILTER.replace("'", "''"),
    )

    try:
        completed = subprocess.run(
            ["powershell.exe", "-NoProfile", "-STA", "-Command", powershell_script],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError as exc:
        raise ValueError(
            "Could not open the Windows file picker. Provide image_path in FlowCell data or set DEFAULT_IMAGE_PATHS."
        ) from exc

    if completed.returncode != 0:
        error_text = (completed.stderr or completed.stdout or "").strip()
        raise ValueError(
            "The image picker failed to open."
            if not error_text
            else f"The image picker failed to open: {error_text}"
        )

    selected_path = (completed.stdout or "").strip()
    return selected_path or None


def _set_active_object(context, obj, select_only=False):
    view_layer = context.view_layer
    if select_only:
        for candidate in view_layer.objects:
            if candidate.select_get():
                candidate.select_set(False)
    obj.select_set(True)
    view_layer.objects.active = obj


def _safe_mode_set(mode):
    if bpy.ops.object.mode_set.poll():
        bpy.ops.object.mode_set(mode=mode)


def _apply_object_scale(context, obj):
    _set_active_object(context, obj, select_only=True)
    _safe_mode_set("OBJECT")
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def _get_active_mesh(context):
    obj = context.view_layer.objects.active
    if obj is None:
        raise ValueError("Select one active mesh object first.")
    if obj.type != "MESH":
        raise ValueError("Active object must be a mesh.")
    return obj


def _find_displacement_image(obj):
    preferred_names = (
        f"{obj.name}.png",
        f"{obj.name}.jpg",
    )
    for image_name in preferred_names:
        image = bpy.data.images.get(image_name)
        if image is not None:
            return image

    object_name = obj.name.lower()
    for image in bpy.data.images:
        image_name = getattr(image, "name", "")
        image_base, _image_ext = os.path.splitext(image_name)
        if image_base.lower() == object_name:
            return image

    return None


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


def _create_image_material(name, image):
    material = bpy.data.materials.new(name=f"{name}_Mat")
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


def _create_plane_from_image_path(context, image_path, dpi):
    image = _load_image(image_path)
    plane = _create_textured_plane_for_image(context, image, dpi)
    _set_active_object(context, plane, select_only=True)
    return plane, image


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


def _add_displace_modifier(obj):
    modifier = obj.modifiers.new(name="Displace", type="DISPLACE")
    texture = bpy.data.textures.new(name=f"{obj.name}_DispTex", type="IMAGE")

    image = _find_displacement_image(obj)
    if image is not None:
        texture.image = image

    modifier.texture = texture
    modifier.texture_coords = "UV"
    modifier.uv_layer = "UVMap"
    modifier.direction = "Z"
    modifier.vertex_group = TOP_FACE_GROUP_NAME
    modifier.mid_level = DISPLACE_MID_LEVEL
    return modifier, image


def _create_lithophane_from_image_path(context, image_path, dpi):
    plane, image = _create_plane_from_image_path(context, image_path, dpi)
    lithophane_result = perform_make_lithophane(context, {"image_path": image_path})
    message = lithophane_result.get("message", f"Lithophane setup complete for {plane.name}.")
    return {
        "message": message,
        "display": "Lithophane created",
        "object": lithophane_result.get("object", plane.name),
        "image": lithophane_result.get("image", image.name),
        "image_path": image_path,
    }


def perform_add_mesh_planes(context=None, data=None):
    context = _resolve_context(context)
    image_paths = _resolve_image_paths(data)
    if not image_paths:
        raise ValueError(
            "Provide image_paths in FlowCell data or set DEFAULT_IMAGE_PATHS near the top of the script."
        )

    dpi = float(_get_data_value(data, "dpi", DEFAULT_DPI))
    created_planes = []
    for image_path in image_paths:
        image = _load_image(image_path)
        plane = _create_textured_plane_for_image(context, image, dpi)
        created_planes.append(plane)

    if not created_planes:
        raise ValueError("No image planes were created.")

    _set_active_object(context, created_planes[-1], select_only=True)
    labels = [
        f"{plane.name} ({plane.dimensions.x * 1000.0:.1f}mm x {plane.dimensions.y * 1000.0:.1f}mm @ {dpi:.0f}dpi)"
        for plane in created_planes
    ]
    return {
        "message": "Created image plane(s): " + " | ".join(labels),
        "display": f"Imported {len(created_planes)} litho plane(s)",
        "created_objects": [plane.name for plane in created_planes],
    }


def perform_create_lithophane_from_image(context=None, data=None):
    context = _resolve_context(context)
    dpi = float(_get_data_value(data, "dpi", DEFAULT_DPI))
    image_path = _resolve_single_image_path(data)
    if not image_path:
        image_path = _prompt_for_image_path()
    if not image_path:
        return {
            "message": "Cancelled lithophane creation because no image was selected.",
            "display": "No image selected",
        }
    return _create_lithophane_from_image_path(context, image_path, dpi)


def perform_make_lithophane(context=None, data=None):
    context = _resolve_context(context)
    obj = _get_active_mesh(context)

    _apply_object_scale(context, obj)

    solidify_modifier = obj.modifiers.new(name="Solidify", type="SOLIDIFY")
    solidify_modifier.thickness = SOLIDIFY_THICKNESS_METERS
    bpy.ops.object.modifier_apply(modifier=solidify_modifier.name)

    _set_active_object(context, obj, select_only=True)
    _safe_mode_set("EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.mesh.select_all(action="DESELECT")

    _select_top_face(obj.data)
    bpy.ops.mesh.subdivide(number_cuts=TOP_FACE_SUBDIVISION_CUTS)
    selected_vertex_indices = _collect_selected_vertex_indices(obj.data)

    _safe_mode_set("OBJECT")
    _create_or_replace_vertex_group(obj, TOP_FACE_GROUP_NAME, selected_vertex_indices)

    _add_subsurf_modifier(obj)
    _displace_modifier, image = _add_displace_modifier(obj)

    if image is None:
        message = (
            f"Lithophane setup complete for {obj.name}, but no matching image named "
            f"{obj.name}.png or {obj.name}.jpg was found in bpy.data.images."
        )
        display = "Lithophane setup complete; image missing"
    else:
        message = f"Lithophane setup complete for {obj.name} using {image.name}."
        display = "Lithophane setup complete"

    return {
        "message": message,
        "display": display,
        "object": obj.name,
        "image": image.name if image is not None else None,
    }


def run_flowcell_action(context=None, data=None):
    return perform_create_lithophane_from_image(context, data)
