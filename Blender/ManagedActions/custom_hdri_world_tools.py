# Description: Set the Blender world HDRI image plus X/Y/Z rotation, world strength,
# and an optional screen-pinned viewport background image.

import math
from pathlib import Path

import bpy
import gpu
from bpy.app.handlers import persistent
from bpy_extras import view3d_utils
from gpu_extras.batch import batch_for_shader


DEFAULT_HDRI_PATH = str(
    (Path(__file__).resolve().parent.parent / "appearance" / "mossy_forest_4k.exr")
)
DEFAULT_ROTATION_X_DEGREES = 90.0
DEFAULT_ROTATION_Y_DEGREES = 0.0
DEFAULT_ROTATION_Z_DEGREES = 30.0
DEFAULT_WORLD_STRENGTH = 0.25
DEFAULT_STATIC_BACKGROUND_PATH = ""
VIEWPORT_OVERLAY_NAMESPACE_KEY = "flowtest_hdri_world_viewport_overlay"
VIEWPORT_OVERLAY_LOAD_HANDLER_KEY = "flowtest_hdri_world_viewport_overlay_load_post"
VIEWPORT_OVERLAY_PATH_KEY = "flowtest_hdri_world_static_background_path"

ROTATION_INDEX_BY_COMMAND = {
    "set_rotation_x": 0,
    "set_rotation_y": 1,
    "set_rotation_z": 2,
}
ROTATION_LABEL_BY_INDEX = {
    0: "X",
    1: "Y",
    2: "Z",
}


def _ctx(context=None):
    return context or bpy.context


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _result(message: str, **payload):
    return {
        "message": message,
        **payload,
    }


def _ensure_node(nodes, bl_idname: str, type_name: str, location):
    for node in nodes:
        if node.bl_idname == bl_idname:
            return node
    node = nodes.new(type=type_name)
    node.location = location
    return node


def _ensure_world_state(context=None):
    scene = _ctx(context).scene
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True

    node_tree = world.node_tree
    nodes = node_tree.nodes
    links = node_tree.links

    background = _ensure_node(
        nodes, "ShaderNodeBackground", "ShaderNodeBackground", (400, 0)
    )
    world_output = _ensure_node(
        nodes, "ShaderNodeOutputWorld", "ShaderNodeOutputWorld", (650, 0)
    )
    env = _ensure_node(
        nodes, "ShaderNodeTexEnvironment", "ShaderNodeTexEnvironment", (-150, 0)
    )
    mapping = _ensure_node(nodes, "ShaderNodeMapping", "ShaderNodeMapping", (-400, 0))
    texcoord = _ensure_node(nodes, "ShaderNodeTexCoord", "ShaderNodeTexCoord", (-650, 0))

    for link in list(links):
        if link.to_node == env and link.to_socket == env.inputs["Vector"]:
            links.remove(link)
        elif link.to_node == mapping and link.to_socket == mapping.inputs["Vector"]:
            links.remove(link)
        elif link.to_node == background and link.to_socket == background.inputs["Color"]:
            links.remove(link)
        elif (
            link.to_node == world_output
            and link.to_socket == world_output.inputs["Surface"]
        ):
            links.remove(link)

    links.new(texcoord.outputs["Generated"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], env.inputs["Vector"])
    links.new(env.outputs["Color"], background.inputs["Color"])
    links.new(background.outputs["Background"], world_output.inputs["Surface"])

    return {
        "world": world,
        "background": background,
        "env": env,
        "mapping": mapping,
    }


def _clear_world_state(context=None):
    scene = _ctx(context).scene
    new_world = bpy.data.worlds.new("FlowTest Clean World")
    scene.world = new_world
    new_world.use_nodes = True
    nodes = new_world.node_tree.nodes
    links = new_world.node_tree.links
    nodes.clear()
    background = nodes.new(type="ShaderNodeBackground")
    background.location = (220, 0)
    background.inputs["Color"].default_value = (0.05, 0.05, 0.05, 1.0)
    background.inputs["Strength"].default_value = 1.0
    world_output = nodes.new(type="ShaderNodeOutputWorld")
    world_output.location = (470, 0)
    links.new(background.outputs["Background"], world_output.inputs["Surface"])
    _remove_viewport_overlay_handler()
    _disable_camera_background_images()
    _set_saved_overlay_path("")
    _tag_redraw_view3d()


def _reset_world_state(context=None, payload=None):
    scene = _ctx(context).scene
    new_world = bpy.data.worlds.new("FlowTest HDRI World")
    scene.world = new_world
    new_world.use_nodes = True
    _remove_viewport_overlay_handler()
    _disable_camera_background_images()
    _set_saved_overlay_path("")
    state = _ensure_world_state(context)
    env = state["env"]
    mapping = state["mapping"]
    background = state["background"]
    resolved_path = _apply_hdri_image(env, payload or {})
    _set_rotation(
        mapping,
        0,
        _read_float(payload or {}, "rotation_x_deg", DEFAULT_ROTATION_X_DEGREES),
    )
    _set_rotation(
        mapping,
        1,
        _read_float(payload or {}, "rotation_y_deg", DEFAULT_ROTATION_Y_DEGREES),
    )
    _set_rotation(
        mapping,
        2,
        _read_float(payload or {}, "rotation_z_deg", DEFAULT_ROTATION_Z_DEGREES),
    )
    _set_world_strength(
        background,
        _read_float(payload or {}, "world_strength", DEFAULT_WORLD_STRENGTH),
    )
    _tag_redraw_view3d()
    return resolved_path


def _read_string(payload, key: str, default: str = "") -> str:
    value = payload.get(key, default)
    return str(value or default).strip()


def _read_float(payload, key: str, default: float) -> float:
    value = payload.get(key, default)
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _resolve_hdri_path(raw_path: str) -> str:
    candidate = str(raw_path or "").strip()
    if not candidate:
        candidate = DEFAULT_HDRI_PATH

    path = Path(candidate)
    if not path.is_absolute():
        path = _repo_root() / candidate

    path = path.expanduser().resolve()
    if not path.is_file():
        raise ValueError(f"HDRI file was not found: {path}")
    return str(path)


def _resolve_optional_image_path(raw_path: str) -> str:
    candidate = str(raw_path or "").strip()
    if not candidate:
        return ""

    path = Path(candidate)
    if not path.is_absolute():
        path = _repo_root() / candidate

    path = path.expanduser().resolve()
    if not path.is_file():
        raise ValueError(f"Background image file was not found: {path}")
    return str(path)


def _apply_hdri_image(env, payload) -> str:
    resolved_path = _resolve_hdri_path(_read_string(payload, "hdri_path", DEFAULT_HDRI_PATH))
    env.image = bpy.data.images.load(resolved_path, check_existing=True)
    return resolved_path


def _ensure_hdri_image_if_missing(env, payload):
    if getattr(env, "image", None) is None:
        return _apply_hdri_image(env, payload)
    return str(getattr(env.image, "filepath", "") or "")


def _set_rotation(mapping, axis_index: int, degrees: float):
    mapping.inputs["Rotation"].default_value[axis_index] = math.radians(float(degrees))


def _set_world_strength(background, strength: float):
    background.inputs["Strength"].default_value = float(strength)


def _overlay_state():
    namespace = bpy.app.driver_namespace
    state = namespace.get(VIEWPORT_OVERLAY_NAMESPACE_KEY)
    if not isinstance(state, dict):
        state = {}
        namespace[VIEWPORT_OVERLAY_NAMESPACE_KEY] = state
    return state


def _tag_redraw_view3d():
    window_manager = getattr(bpy.context, "window_manager", None)
    if window_manager is None:
        return
    for window in window_manager.windows:
        screen = getattr(window, "screen", None)
        if screen is None:
            continue
        for area in screen.areas:
            if area.type == "VIEW_3D":
                area.tag_redraw()


def _disable_camera_background_images():
    for camera in bpy.data.cameras:
        if not hasattr(camera, "show_background_images"):
            continue
        camera.show_background_images = False
        for background in getattr(camera, "background_images", []):
            background.image = None


def _get_saved_overlay_path() -> str:
    window_manager = getattr(bpy.context, "window_manager", None)
    if window_manager is None or VIEWPORT_OVERLAY_PATH_KEY not in window_manager:
        return ""
    return str(window_manager[VIEWPORT_OVERLAY_PATH_KEY] or "").strip()


def _set_saved_overlay_path(path: str):
    window_manager = getattr(bpy.context, "window_manager", None)
    if window_manager is None:
        return
    normalized = str(path or "").strip()
    if normalized:
        window_manager[VIEWPORT_OVERLAY_PATH_KEY] = normalized
    elif VIEWPORT_OVERLAY_PATH_KEY in window_manager:
        del window_manager[VIEWPORT_OVERLAY_PATH_KEY]


def _iter_view3d_spaces():
    window_manager = getattr(bpy.context, "window_manager", None)
    if window_manager is None:
        return
    for window in window_manager.windows:
        screen = getattr(window, "screen", None)
        if screen is None:
            continue
        for area in screen.areas:
            if area.type != "VIEW_3D":
                continue
            for space in area.spaces:
                if getattr(space, "type", "") == "VIEW_3D":
                    yield space


def _remove_viewport_overlay_handler():
    state = _overlay_state()
    handler = state.get("handler")
    if handler is not None:
        bpy.types.SpaceView3D.draw_handler_remove(handler, "WINDOW")
    entries = state.get("space_background_entries", [])
    for entry in entries:
        space = entry.get("space")
        background = entry.get("background")
        if space is None or background is None:
            continue
        background_images = getattr(space, "background_images", None)
        if background_images is None:
            continue
        try:
            background_images.remove(background)
        except Exception:
            pass
    state.clear()


def _ensure_overlay_texture(state, image):
    texture = state.get("texture")
    texture_path = str(state.get("texture_path", "") or "")
    image_path = str(getattr(image, "filepath", "") or "")
    if texture is not None and texture_path == image_path:
        return texture
    texture = gpu.texture.from_image(image)
    state["texture"] = texture
    state["texture_path"] = image_path
    return texture


def _apply_native_space_background_images(image):
    state = _overlay_state()
    entries = []
    applied = False
    for space in _iter_view3d_spaces() or []:
        background_images = getattr(space, "background_images", None)
        if background_images is None or not hasattr(background_images, "new"):
            continue
        background = background_images.new()
        background.image = image
        if hasattr(background, "view_axis"):
            background.view_axis = "ALL"
        if hasattr(background, "draw_depth"):
            background.draw_depth = "BACK"
        if hasattr(background, "opacity"):
            background.opacity = 1.0
        if hasattr(background, "frame_method"):
            background.frame_method = "FIT"
        if hasattr(background, "offset_x"):
            background.offset_x = 0.0
        if hasattr(background, "offset_y"):
            background.offset_y = 0.0
        if hasattr(background, "rotation"):
            background.rotation = 0.0
        if hasattr(background, "size"):
            background.size = 1.0
        if hasattr(space, "show_background_images"):
            space.show_background_images = True
        entries.append({"space": space, "background": background})
        applied = True

    if applied:
        state["image"] = image
        state["path"] = getattr(image, "filepath", "")
        state["space_background_entries"] = entries
    return applied


@persistent
def _clear_viewport_overlay_on_blend_load(_dummy=None):
    _remove_viewport_overlay_handler()
    _disable_camera_background_images()
    _tag_redraw_view3d()
    if _get_saved_overlay_path():
        bpy.app.timers.register(_restore_viewport_overlay_after_load, first_interval=0.25)


def _ensure_overlay_load_handler_registered():
    namespace = bpy.app.driver_namespace
    existing = namespace.get(VIEWPORT_OVERLAY_LOAD_HANDLER_KEY)
    if existing in bpy.app.handlers.load_post:
        bpy.app.handlers.load_post.remove(existing)
    if _clear_viewport_overlay_on_blend_load in bpy.app.handlers.load_post:
        bpy.app.handlers.load_post.remove(_clear_viewport_overlay_on_blend_load)
    bpy.app.handlers.load_post.append(_clear_viewport_overlay_on_blend_load)
    namespace[VIEWPORT_OVERLAY_LOAD_HANDLER_KEY] = _clear_viewport_overlay_on_blend_load


def _build_viewport_overlay_draw_callback():
    shader = gpu.shader.from_builtin("IMAGE")

    def draw():
        state = _overlay_state()
        image = state.get("image")
        if image is None:
            return

        region = getattr(bpy.context, "region", None)
        region_data = getattr(bpy.context, "region_data", None)
        space_data = getattr(bpy.context, "space_data", None)
        if region is None or region_data is None or space_data is None:
            return

        image_size = getattr(image, "size", None)
        if not image_size or image_size[0] <= 0 or image_size[1] <= 0:
            return

        region_width = max(float(region.width), 1.0)
        region_height = max(float(region.height), 1.0)
        image_width = float(image_size[0])
        image_height = float(image_size[1])
        clip_distance = max(float(getattr(space_data, "clip_end", 1000.0)) * 0.95, 1.0)

        center_coord = (region_width * 0.5, region_height * 0.5)
        plane_normal = view3d_utils.region_2d_to_vector_3d(region, region_data, center_coord)
        plane_point = (
            view3d_utils.region_2d_to_origin_3d(
                region, region_data, center_coord, clamp=clip_distance
            )
            + plane_normal * clip_distance
        )

        def intersect_view_ray(coord):
            origin = view3d_utils.region_2d_to_origin_3d(
                region, region_data, coord, clamp=clip_distance
            )
            direction = view3d_utils.region_2d_to_vector_3d(region, region_data, coord)
            denominator = direction.dot(plane_normal)
            if abs(denominator) < 1.0e-6:
                return None
            distance = (plane_point - origin).dot(plane_normal) / denominator
            return origin + direction * distance

        corners = [
            intersect_view_ray((0.0, 0.0)),
            intersect_view_ray((region_width, 0.0)),
            intersect_view_ray((region_width, region_height)),
            intersect_view_ray((0.0, region_height)),
        ]
        if any(corner is None for corner in corners):
            return

        bottom_left = corners[0]
        bottom_right = corners[1]
        top_right = corners[2]
        top_left = corners[3]

        plane_width = (bottom_right - bottom_left).length
        plane_height = (top_left - bottom_left).length
        if plane_width <= 0.0 or plane_height <= 0.0:
            return

        viewport_aspect = plane_width / plane_height
        image_aspect = image_width / image_height
        if image_aspect > viewport_aspect:
            visible_u = viewport_aspect / image_aspect
            u_margin = (1.0 - visible_u) * 0.5
            tex_coords = (
                (u_margin, 0.0),
                (1.0 - u_margin, 0.0),
                (1.0 - u_margin, 1.0),
                (u_margin, 1.0),
            )
        else:
            visible_v = image_aspect / viewport_aspect
            v_margin = (1.0 - visible_v) * 0.5
            tex_coords = (
                (0.0, v_margin),
                (1.0, v_margin),
                (1.0, 1.0 - v_margin),
                (0.0, 1.0 - v_margin),
            )

        try:
            texture = _ensure_overlay_texture(state, image)
        except Exception:
            return
        batch = batch_for_shader(
            shader,
            "TRI_FAN",
            {
                "pos": (bottom_left, bottom_right, top_right, top_left),
                "texCoord": tex_coords,
            },
        )

        if hasattr(gpu.state, "depth_test_set"):
            gpu.state.depth_test_set("LESS_EQUAL")
        if hasattr(gpu.state, "depth_mask_set"):
            gpu.state.depth_mask_set(False)
        gpu.state.blend_set("ALPHA")
        shader.bind()
        shader.uniform_sampler("image", texture)
        batch.draw(shader)
        gpu.state.blend_set("NONE")
        if hasattr(gpu.state, "depth_mask_set"):
            gpu.state.depth_mask_set(True)
        if hasattr(gpu.state, "depth_test_set"):
            gpu.state.depth_test_set("NONE")

    return draw


def _register_viewport_overlay_from_resolved_path(resolved_path: str) -> str:
    _remove_viewport_overlay_handler()
    _disable_camera_background_images()

    if not resolved_path:
        _tag_redraw_view3d()
        return ""

    image = bpy.data.images.load(resolved_path, check_existing=True)
    if _apply_native_space_background_images(image):
        _tag_redraw_view3d()
        return resolved_path

    state = _overlay_state()
    state["image"] = image
    state["path"] = resolved_path
    state["texture"] = None
    state["texture_path"] = ""
    state["handler"] = bpy.types.SpaceView3D.draw_handler_add(
        _build_viewport_overlay_draw_callback(),
        (),
        "WINDOW",
        "POST_VIEW",
    )
    _tag_redraw_view3d()
    return resolved_path


def _restore_viewport_overlay_after_load():
    saved_path = _get_saved_overlay_path()
    if not saved_path:
        return None
    if not any(True for _ in (_iter_view3d_spaces() or [])):
        return 0.25
    try:
        resolved_path = _resolve_optional_image_path(saved_path)
    except Exception:
        _set_saved_overlay_path("")
        return None
    _register_viewport_overlay_from_resolved_path(resolved_path)
    return None


def _set_static_background_image(context, payload):
    resolved_path = _resolve_optional_image_path(
        _read_string(payload, "static_background_path", DEFAULT_STATIC_BACKGROUND_PATH)
    )
    _ensure_overlay_load_handler_registered()
    _set_saved_overlay_path(resolved_path)
    return _register_viewport_overlay_from_resolved_path(resolved_path)


def _normalize_hex_color(payload, key: str) -> str:
    raw_value = _read_string(payload, key, "")
    normalized = raw_value.strip().lstrip("#").upper()
    if len(normalized) == 3:
        normalized = "".join(character * 2 for character in normalized)
    if len(normalized) != 6 or any(
        character not in "0123456789ABCDEF" for character in normalized
    ):
        raise ValueError(f"Invalid hex color for {key}: {raw_value!r}")
    return f"#{normalized}"


def _hex_to_rgb_floats(value: str):
    normalized = value.strip().lstrip("#")
    return tuple(int(normalized[index : index + 2], 16) / 255.0 for index in (0, 2, 4))


def _hex_to_rgba_floats(value: str, alpha: float = 1.0):
    red, green, blue = _hex_to_rgb_floats(value)
    return (red, green, blue, alpha)


def _srgb_channel_to_linear(value: float) -> float:
    if value <= 0.04045:
        return value / 12.92
    return ((value + 0.055) / 1.055) ** 2.4


def _relative_luminance(hex_value: str) -> float:
    red, green, blue = _hex_to_rgb_floats(hex_value)
    return (
        0.2126 * _srgb_channel_to_linear(red)
        + 0.7152 * _srgb_channel_to_linear(green)
        + 0.0722 * _srgb_channel_to_linear(blue)
    )


def _contrast_ratio(first_hex: str, second_hex: str) -> float:
    first_luma = _relative_luminance(first_hex)
    second_luma = _relative_luminance(second_hex)
    lighter = max(first_luma, second_luma)
    darker = min(first_luma, second_luma)
    return (lighter + 0.05) / (darker + 0.05)


def _contrast_safe_text_hex(text_hex: str, section_fill_hex: str):
    if _contrast_ratio(text_hex, section_fill_hex) >= 4.5:
        return text_hex, False
    black = "#0C0C0C"
    white = "#F4F4F4"
    if _contrast_ratio(black, section_fill_hex) >= _contrast_ratio(
        white, section_fill_hex
    ):
        return black, True
    return white, True


def _set_theme_color_property(target, attribute: str, rgb_value, rgba_value=None) -> bool:
    if target is None or not hasattr(target, attribute):
        return False
    try:
        current_value = getattr(target, attribute)
        value_length = len(current_value)
    except Exception:
        current_value = None
        value_length = None
    try:
        if value_length == 4:
            setattr(target, attribute, rgba_value or (*rgb_value, 1.0))
        elif value_length == 3:
            setattr(target, attribute, rgb_value)
        elif rgba_value is not None:
            setattr(target, attribute, rgba_value)
        else:
            setattr(target, attribute, rgb_value)
        return True
    except Exception:
        return False


def _set_theme_widget_colors(widget, fill_hex: str, text_hex: str, misc_hex: str):
    fill_rgba = _hex_to_rgba_floats(fill_hex)
    fill_rgb = _hex_to_rgb_floats(fill_hex)
    text_rgb = _hex_to_rgb_floats(text_hex)
    misc_rgb = _hex_to_rgb_floats(misc_hex)
    misc_rgba = _hex_to_rgba_floats(misc_hex)
    _set_theme_color_property(widget, "inner", fill_rgb, fill_rgba)
    _set_theme_color_property(widget, "inner_sel", fill_rgb, fill_rgba)
    _set_theme_color_property(widget, "item", misc_rgb, misc_rgba)
    _set_theme_color_property(widget, "outline", misc_rgb, misc_rgba)
    _set_theme_color_property(widget, "text", text_rgb, (*text_rgb, 1.0))
    _set_theme_color_property(widget, "text_sel", text_rgb, (*text_rgb, 1.0))
    if hasattr(widget, "show_shaded"):
        try:
            widget.show_shaded = True
        except Exception:
            pass


def _apply_theme_editor_colors(theme_section, role_hexes):
    if theme_section is None:
        return
    headers_hex = role_hexes["headers_hex"]
    text_hex = role_hexes["text_hex"]
    section_fill_hex = role_hexes["section_fill_hex"]
    controls_hex = role_hexes["controls_hex"]
    misc_hex = role_hexes["misc_hex"]
    darks_hex = role_hexes["darks_hex"]
    highlights_hex = role_hexes["highlights_hex"]

    headers_rgb = _hex_to_rgb_floats(headers_hex)
    headers_rgba = _hex_to_rgba_floats(headers_hex)
    text_rgb = _hex_to_rgb_floats(text_hex)
    text_rgba = (*text_rgb, 1.0)
    section_fill_rgb = _hex_to_rgb_floats(section_fill_hex)
    section_fill_rgba = _hex_to_rgba_floats(section_fill_hex)
    controls_rgb = _hex_to_rgb_floats(controls_hex)
    controls_rgba = _hex_to_rgba_floats(controls_hex)
    misc_rgb = _hex_to_rgb_floats(misc_hex)
    misc_rgba = _hex_to_rgba_floats(misc_hex)
    darks_rgb = _hex_to_rgb_floats(darks_hex)
    darks_rgba = _hex_to_rgba_floats(darks_hex)
    highlights_rgb = _hex_to_rgb_floats(highlights_hex)
    highlights_rgba = _hex_to_rgba_floats(highlights_hex)

    for attribute in ("back", "sub_back", "list", "row_alternate"):
        _set_theme_color_property(theme_section, attribute, darks_rgb, darks_rgba)

    for attribute in ("list_text",):
        _set_theme_color_property(
            theme_section, attribute, section_fill_rgb, section_fill_rgba
        )

    for attribute in (
        "header",
        "title",
        "tab_back",
        "button",
        "button_title",
    ):
        _set_theme_color_property(theme_section, attribute, headers_rgb, headers_rgba)

    for attribute in ("tab_active",):
        _set_theme_color_property(theme_section, attribute, highlights_rgb, highlights_rgba)

    for attribute in (
        "header_text",
        "header_text_hi",
        "text",
        "text_hi",
        "button_text",
        "button_text_hi",
    ):
        _set_theme_color_property(theme_section, attribute, text_rgb, text_rgba)

    for attribute in (
        "tab_inactive",
        "tab_outline",
        "menu_back",
        "menu_item",
        "separator",
        "outline",
    ):
        _set_theme_color_property(theme_section, attribute, darks_rgb, darks_rgba)

    for attribute in ("edge_select", "face_select", "vertex_select", "active", "grid"):
        _set_theme_color_property(theme_section, attribute, misc_rgb, misc_rgba)

    for attribute in ("button_animated", "button_key"):
        _set_theme_color_property(theme_section, attribute, controls_rgb, controls_rgba)
    for attribute in ("button_key_sel",):
        _set_theme_color_property(theme_section, attribute, highlights_rgb, highlights_rgba)

    panel = getattr(theme_section, "panelcolors", None)
    if panel is not None:
        _set_theme_color_property(panel, "header", headers_rgb, headers_rgba)


def _apply_theme_user_interface(theme_ui, role_hexes):
    if theme_ui is None:
        return
    headers_hex = role_hexes["headers_hex"]
    text_hex = role_hexes["text_hex"]
    section_fill_hex = role_hexes["section_fill_hex"]
    controls_hex = role_hexes["controls_hex"]
    misc_hex = role_hexes["misc_hex"]
    darks_hex = role_hexes["darks_hex"]
    highlights_hex = role_hexes["highlights_hex"]

    widget_names = (
        "wcol_box",
        "wcol_list_item",
        "wcol_menu",
        "wcol_menu_back",
        "wcol_menu_item",
        "wcol_num",
        "wcol_numslider",
        "wcol_option",
        "wcol_progress",
        "wcol_pulldown",
        "wcol_radio",
        "wcol_regular",
        "wcol_scroll",
        "wcol_tab",
        "wcol_text",
        "wcol_toggle",
        "wcol_tool",
        "wcol_toolbar_item",
        "wcol_tooltip",
    )
    for widget_name in widget_names:
        widget = getattr(theme_ui, widget_name, None)
        if widget is None:
            continue
        fill_hex = controls_hex if widget_name not in ("wcol_box", "wcol_menu_back") else section_fill_hex
        if widget_name in ("wcol_tab", "wcol_toolbar_item"):
            fill_hex = headers_hex
        if widget_name in ("wcol_box", "wcol_menu_back"):
            fill_hex = darks_hex
        if widget_name in ("wcol_option", "wcol_radio", "wcol_toggle", "wcol_progress"):
            fill_hex = highlights_hex
        _set_theme_widget_colors(widget, fill_hex, text_hex, misc_hex)
        if widget_name in ("wcol_option", "wcol_radio", "wcol_toggle", "wcol_progress"):
            _set_theme_color_property(
                widget, "inner_sel", _hex_to_rgb_floats(highlights_hex), _hex_to_rgba_floats(highlights_hex)
            )
        _set_theme_color_property(
            widget, "outline", _hex_to_rgb_floats(darks_hex), _hex_to_rgba_floats(darks_hex)
        )

    panel = getattr(theme_ui, "panel", None)
    if panel is not None:
        _set_theme_color_property(
            panel, "header", _hex_to_rgb_floats(headers_hex), _hex_to_rgba_floats(headers_hex)
        )
        if hasattr(panel, "show_header"):
            try:
                panel.show_header = True
            except Exception:
                pass


def _apply_theme_from_photo_manual_colors(context, payload):
    role_hexes = {
        "headers_hex": _normalize_hex_color(payload, "headers_hex"),
        "text_hex": _normalize_hex_color(payload, "text_hex"),
        "section_fill_hex": _normalize_hex_color(payload, "section_fill_hex"),
        "controls_hex": _normalize_hex_color(payload, "controls_hex"),
        "misc_hex": _normalize_hex_color(payload, "misc_hex"),
        "darks_hex": _normalize_hex_color(payload, "darks_hex"),
        "highlights_hex": _normalize_hex_color(payload, "highlights_hex"),
        "viewport_background_hex": _normalize_hex_color(
            payload, "viewport_background_hex"
        ),
        "viewport_gradient_hex": _normalize_hex_color(payload, "viewport_gradient_hex"),
    }
    role_hexes["text_hex"], text_corrected = _contrast_safe_text_hex(
        role_hexes["text_hex"], role_hexes["section_fill_hex"]
    )
    viewport_gradient_enabled = bool(payload.get("viewport_gradient_enabled", False))

    theme = _ctx(context).preferences.themes[0]
    _apply_theme_user_interface(getattr(theme, "user_interface", None), role_hexes)

    theme_section_names = (
        "view_3d",
        "graph_editor",
        "node_editor",
        "sequence_editor",
        "image_editor",
        "text_editor",
        "clip_editor",
        "console",
        "dopesheet_editor",
        "file_browser",
        "info",
        "nla_editor",
        "outliner",
        "preferences",
        "properties",
        "spreadsheet",
        "statusbar",
        "topbar",
    )
    for section_name in theme_section_names:
        _apply_theme_editor_colors(getattr(theme, section_name, None), role_hexes)

    view3d_space = getattr(getattr(theme, "view_3d", None), "space", None)
    gradients = getattr(view3d_space, "gradients", None) if view3d_space else None
    if gradients is not None:
        _set_theme_color_property(
            gradients,
            "gradient",
            _hex_to_rgb_floats(role_hexes["viewport_background_hex"]),
            _hex_to_rgba_floats(role_hexes["viewport_background_hex"]),
        )
        _set_theme_color_property(
            gradients,
            "high_gradient",
            _hex_to_rgb_floats(role_hexes["viewport_gradient_hex"]),
            _hex_to_rgba_floats(role_hexes["viewport_gradient_hex"]),
        )
        if hasattr(gradients, "show_grad"):
            try:
                gradients.show_grad = viewport_gradient_enabled
            except Exception:
                pass

    _tag_redraw_view3d()
    return _result(
        "Blender UI theme updated from sampled photo colors."
        if not text_corrected
        else "Blender UI theme updated from sampled photo colors. Text color was adjusted for contrast.",
        headers_hex=role_hexes["headers_hex"],
        text_hex=role_hexes["text_hex"],
        section_fill_hex=role_hexes["section_fill_hex"],
        controls_hex=role_hexes["controls_hex"],
        misc_hex=role_hexes["misc_hex"],
        darks_hex=role_hexes["darks_hex"],
        highlights_hex=role_hexes["highlights_hex"],
        viewport_background_hex=role_hexes["viewport_background_hex"],
        viewport_gradient_enabled=viewport_gradient_enabled,
        viewport_gradient_hex=role_hexes["viewport_gradient_hex"],
        text_corrected=text_corrected,
    )


def run_flowcell_action(context=None, data=None):
    payload = data or {}
    command = _read_string(payload, "command", "apply_all").lower()
    if command == "apply_theme_from_photo_manual_colors":
        return _apply_theme_from_photo_manual_colors(context, payload)

    state = _ensure_world_state(context)
    mapping = state["mapping"]
    env = state["env"]
    background = state["background"]

    if command == "set_hdri_path":
        resolved_path = _apply_hdri_image(env, payload)
        return _result(f"HDRI set to {resolved_path}.", hdri_path=resolved_path)

    if command == "clear_world":
        _clear_world_state(context)
        return _result("HDRI world cleared.")

    if command == "reset_world":
        resolved_path = _reset_world_state(context, payload)
        return _result(
            f"HDRI world reset and reapplied from {resolved_path}.",
            hdri_path=resolved_path,
        )

    if command == "set_static_background_image":
        resolved_path = _set_static_background_image(context, payload)
        if resolved_path:
            return _result(
                f"Viewport background image set to {resolved_path}.",
                static_background_path=resolved_path,
            )
        return _result("Static background image cleared.", static_background_path="")

    if command in ROTATION_INDEX_BY_COMMAND:
        _ensure_hdri_image_if_missing(env, payload)
        axis_index = ROTATION_INDEX_BY_COMMAND[command]
        degrees_key = f"rotation_{ROTATION_LABEL_BY_INDEX[axis_index].lower()}_deg"
        degrees = _read_float(
            payload,
            degrees_key,
            (
                DEFAULT_ROTATION_X_DEGREES
                if axis_index == 0
                else DEFAULT_ROTATION_Y_DEGREES
                if axis_index == 1
                else DEFAULT_ROTATION_Z_DEGREES
            ),
        )
        _set_rotation(mapping, axis_index, degrees)
        axis_label = ROTATION_LABEL_BY_INDEX[axis_index]
        return _result(f"HDRI {axis_label} rotation set to {degrees:.2f}°.")

    if command == "set_world_strength":
        _ensure_hdri_image_if_missing(env, payload)
        strength = _read_float(payload, "world_strength", DEFAULT_WORLD_STRENGTH)
        _set_world_strength(background, strength)
        return _result(f"HDRI world strength set to {strength:.3f}.")

    if command == "apply_all":
        resolved_path = _apply_hdri_image(env, payload)
        static_background_path = _set_static_background_image(context, payload)
        _set_rotation(
            mapping,
            0,
            _read_float(payload, "rotation_x_deg", DEFAULT_ROTATION_X_DEGREES),
        )
        _set_rotation(
            mapping,
            1,
            _read_float(payload, "rotation_y_deg", DEFAULT_ROTATION_Y_DEGREES),
        )
        _set_rotation(
            mapping,
            2,
            _read_float(payload, "rotation_z_deg", DEFAULT_ROTATION_Z_DEGREES),
        )
        _set_world_strength(
            background,
            _read_float(payload, "world_strength", DEFAULT_WORLD_STRENGTH),
        )
        return _result(
            "HDRI world settings applied.",
            hdri_path=resolved_path,
            static_background_path=static_background_path,
        )

    raise ValueError(f"Unsupported HDRI world command: {command}")
