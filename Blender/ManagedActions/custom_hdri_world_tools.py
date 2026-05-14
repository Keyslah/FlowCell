# Description: Set the Blender world HDRI image plus X/Y/Z rotation, world strength,
# and an optional screen-pinned viewport background image.

import colorsys
import math
from pathlib import Path

import bpy
import gpu
from bpy.app.handlers import persistent
from gpu_extras.batch import batch_for_shader
from mathutils import Matrix


DEFAULT_HDRI_PATH = str(
    (Path(__file__).resolve().parent.parent / "appearance" / "mossy_forest_4k.exr")
)
DEFAULT_ROTATION_X_DEGREES = 90.0
DEFAULT_ROTATION_Y_DEGREES = 0.0
DEFAULT_ROTATION_Z_DEGREES = 30.0
DEFAULT_WORLD_STRENGTH = 0.25
DEFAULT_STATIC_BACKGROUND_PATH = ""
STATIC_BACKGROUND_FIT_MODE = "COVER"
STATIC_BACKGROUND_USE_ALPHA = False
STATIC_BACKGROUND_FLIP_Y = False
VIEWPORT_OVERLAY_NAMESPACE_KEY = "flowtest_hdri_world_viewport_overlay"
VIEWPORT_OVERLAY_LOAD_HANDLER_KEY = "flowtest_hdri_world_viewport_overlay_load_post"
VIEWPORT_OVERLAY_PATH_KEY = "flowtest_hdri_world_static_background_path"

ROTATION_INDEX_BY_COMMAND = {
    "set_rotation_x": 0,
    "set_rotation_y": 1,
    "set_rotation_z": 2,
}
THEME_EDITOR_SECTION_NAMES = (
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
ROTATION_LABEL_BY_INDEX = {
    0: "X",
    1: "Y",
    2: "Z",
}

PREFERRED_UI_WIDGET_ORDER = (
    "wcol_box",
    "wcol_curve",
    "wcol_list_item",
    "wcol_menu",
    "wcol_menu_back",
    "wcol_menu_item",
    "wcol_num",
    "wcol_numslider",
    "wcol_option",
    "wcol_pie_menu",
    "wcol_progress",
    "wcol_pulldown",
    "wcol_radio",
    "wcol_regular",
    "wcol_scroll",
    "wcol_state",
    "wcol_tab",
    "wcol_text",
    "wcol_toggle",
    "wcol_tool",
    "wcol_toolbar_item",
    "wcol_tooltip",
)

UI_WIDGET_TEXT_ROLE_OVERRIDES = {
    "wcol_box": {"text": "control_text_hex", "text_sel": "control_text_hex"},
    "wcol_curve": {"text": "control_text_hex", "text_sel": "control_text_hex"},
    "wcol_list_item": {"text": "control_text_hex", "text_sel": "control_text_hex"},
    "wcol_menu": {"text": "control_text_hex", "text_sel": "control_text_hex"},
    "wcol_menu_back": {"text": "control_text_hex", "text_sel": "control_text_hex"},
    "wcol_menu_item": {"text": "control_text_hex", "text_sel": "control_text_hex"},
    "wcol_num": {"text": "control_text_hex", "text_sel": "control_text_hex"},
    "wcol_numslider": {"text": "control_text_hex", "text_sel": "control_text_hex"},
    "wcol_option": {"text": "control_text_hex", "text_sel": "control_text_hex"},
    "wcol_pie_menu": {"text": "accent_text_hex", "text_sel": "accent_text_hex"},
    "wcol_progress": {"text": "control_text_hex", "text_sel": "control_text_hex"},
    "wcol_pulldown": {"text": "control_text_hex", "text_sel": "control_text_hex"},
    "wcol_radio": {"text": "control_text_hex", "text_sel": "control_text_hex"},
    "wcol_regular": {"text": "control_text_hex", "text_sel": "control_text_hex"},
    "wcol_scroll": {"text": "control_text_hex", "text_sel": "control_text_hex"},
    "wcol_tab": {"text": "tabs_text_hex", "text_sel": "tabs_text_hex"},
    "wcol_text": {"text": "control_text_hex", "text_sel": "control_text_hex"},
    "wcol_toggle": {"text": "control_text_hex", "text_sel": "control_text_hex"},
    "wcol_tool": {"text": "control_text_hex", "text_sel": "control_text_hex"},
    "wcol_toolbar_item": {"text": "tabs_text_hex", "text_sel": "tabs_text_hex"},
    "wcol_tooltip": {"text": "text_hex", "text_sel": "text_hex"},
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


def _safe_theme_path_value(root, path: str):
    target = root
    for part in path.split("."):
        if target is None:
            return None
        target = getattr(target, part, None)
    return target


def _sample_theme_hex_from_paths(theme, candidate_paths):
    for section_path, attribute in candidate_paths:
        target = _safe_theme_path_value(theme, section_path)
        sampled = _current_theme_rgb(target, attribute)
        if sampled is not None:
            return _rgb_to_hex(sampled)
    return None

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
        try:
            bpy.types.SpaceView3D.draw_handler_remove(handler, "WINDOW")
        except Exception:
            pass
    state.clear()
    _tag_redraw_view3d()


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


def _pixel_projection(width: float, height: float):
    return Matrix(
        (
            (2.0 / width, 0.0, 0.0, -1.0),
            (0.0, 2.0 / height, 0.0, -1.0),
            (0.0, 0.0, 1.0, 0.0),
            (0.0, 0.0, 0.0, 1.0),
        )
    )


def _fitted_rect(region_width: float, region_height: float, image_width: float, image_height: float):
    if image_width <= 0 or image_height <= 0:
        return 0.0, 0.0, region_width, region_height

    fit_mode = STATIC_BACKGROUND_FIT_MODE.upper()
    if fit_mode == "STRETCH":
        return 0.0, 0.0, region_width, region_height

    if fit_mode == "CONTAIN":
        scale = min(region_width / image_width, region_height / image_height)
    else:
        scale = max(region_width / image_width, region_height / image_height)

    draw_width = image_width * scale
    draw_height = image_height * scale
    x = (region_width - draw_width) * 0.5
    y = (region_height - draw_height) * 0.5
    return x, y, draw_width, draw_height


def _build_viewport_overlay_draw_callback():
    shader = gpu.shader.from_builtin("IMAGE")

    def draw():
        state = _overlay_state()
        image = state.get("image")
        if image is None:
            return

        region = getattr(bpy.context, "region", None)
        if region is None or getattr(region, "type", "") != "WINDOW":
            return

        image_size = getattr(image, "size", None)
        if not image_size or image_size[0] <= 0 or image_size[1] <= 0:
            return

        region_width = max(float(region.width), 1.0)
        region_height = max(float(region.height), 1.0)
        image_width = float(image_size[0])
        image_height = float(image_size[1])
        x, y, draw_width, draw_height = _fitted_rect(
            region_width, region_height, image_width, image_height
        )
        z = 0.99999976

        vertices = (
            (x, y, z),
            (x + draw_width, y, z),
            (x + draw_width, y + draw_height, z),
            (x, y + draw_height, z),
        )

        if STATIC_BACKGROUND_FLIP_Y:
            tex_coords = (
                (0.0, 1.0),
                (1.0, 1.0),
                (1.0, 0.0),
                (0.0, 0.0),
            )
        else:
            tex_coords = (
                (0.0, 0.0),
                (1.0, 0.0),
                (1.0, 1.0),
                (0.0, 1.0),
            )

        try:
            texture = _ensure_overlay_texture(state, image)
        except Exception:
            return
        batch = batch_for_shader(
            shader,
            "TRIS",
            {
                "pos": vertices,
                "texCoord": tex_coords,
            },
            indices=((0, 1, 2), (0, 2, 3)),
        )

        old_blend = gpu.state.blend_get() if hasattr(gpu.state, "blend_get") else None
        old_depth_test = (
            gpu.state.depth_test_get() if hasattr(gpu.state, "depth_test_get") else None
        )
        old_depth_mask = (
            gpu.state.depth_mask_get() if hasattr(gpu.state, "depth_mask_get") else None
        )

        try:
            if hasattr(gpu.state, "depth_test_set"):
                gpu.state.depth_test_set("LESS_EQUAL")
            if hasattr(gpu.state, "depth_mask_set"):
                gpu.state.depth_mask_set(False)
            gpu.state.blend_set("ALPHA" if STATIC_BACKGROUND_USE_ALPHA else "NONE")

            with gpu.matrix.push_pop():
                gpu.matrix.load_matrix(Matrix.Identity(4))
                gpu.matrix.load_projection_matrix(_pixel_projection(region_width, region_height))
                shader.bind()
                shader.uniform_sampler("image", texture)
                batch.draw(shader)
        finally:
            if old_blend is not None:
                gpu.state.blend_set(old_blend)
            if old_depth_test is not None and hasattr(gpu.state, "depth_test_set"):
                gpu.state.depth_test_set(old_depth_test)
            elif hasattr(gpu.state, "depth_test_set"):
                gpu.state.depth_test_set("NONE")
            if old_depth_mask is not None and hasattr(gpu.state, "depth_mask_set"):
                gpu.state.depth_mask_set(old_depth_mask)
            elif hasattr(gpu.state, "depth_mask_set"):
                gpu.state.depth_mask_set(True)

    return draw


def _register_viewport_overlay_from_resolved_path(resolved_path: str) -> str:
    _remove_viewport_overlay_handler()
    _disable_camera_background_images()

    if not resolved_path:
        _tag_redraw_view3d()
        return ""

    image = bpy.data.images.load(resolved_path, check_existing=True)
    image.use_fake_user = True
    try:
        _ = image.size[:]
        _ = image.pixels[0]
    except Exception:
        pass

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


def _rgb_to_hex(rgb) -> str:
    red, green, blue = rgb[:3]
    return "#{:02X}{:02X}{:02X}".format(
        max(0, min(255, round(red * 255))),
        max(0, min(255, round(green * 255))),
        max(0, min(255, round(blue * 255))),
    )


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


def _current_theme_rgb(target, attribute: str):
    if target is None or not hasattr(target, attribute):
        return None
    try:
        current_value = getattr(target, attribute)
    except Exception:
        return None
    if callable(current_value):
        return None
    try:
        channels = tuple(float(channel) for channel in current_value[:3])
    except Exception:
        return None
    if len(channels) < 3:
        return None
    return channels[:3]


def _rgb_relative_luminance(rgb) -> float:
    red, green, blue = rgb
    return (
        0.2126 * _srgb_channel_to_linear(red)
        + 0.7152 * _srgb_channel_to_linear(green)
        + 0.0722 * _srgb_channel_to_linear(blue)
    )


def _pick_best_contrast_hex(background_hex: str, candidate_hexes):
    valid_candidates = [
        str(candidate).strip().upper()
        for candidate in candidate_hexes
        if isinstance(candidate, str) and str(candidate).strip()
    ]
    if not valid_candidates:
        return "#FFFFFF"
    return max(valid_candidates, key=lambda candidate: _contrast_ratio(candidate, background_hex))


def _prefer_contrasting_text_hex(
    preferred_hex: str, background_hex: str, fallback_hexes
) -> str:
    if _contrast_ratio(preferred_hex, background_hex) >= 4.5:
        return preferred_hex
    return _pick_best_contrast_hex(background_hex, [preferred_hex, *fallback_hexes])


def _resolve_theme_text_background_hex(
    target, attribute: str, role_hexes, context_name: str = ""
):
    lowered = attribute.lower()
    preferred_attributes = []
    role_fallback_keys = ["editor_background_hex", "controls_hex", "section_fill_hex"]

    if (
        lowered.endswith("_hi")
        or "_hi" in lowered
        or lowered.endswith("_sel")
        or "_sel" in lowered
        or "selected" in lowered
        or "match" in lowered
    ):
        preferred_attributes = [
            "inner_sel",
            "active",
            "selected_highlight",
            "header",
            "button_title",
            "button",
            "item",
            "back",
        ]
        role_fallback_keys = ["highlights_hex", "controls_hex", "editor_background_hex"]
    elif "header" in lowered:
        preferred_attributes = ["header", "navigation_bar", "title", "button_title", "back"]
        role_fallback_keys = ["headers_hex", "editor_background_hex", "controls_hex"]
    elif "tab" in lowered:
        preferred_attributes = ["tab_active", "tab_back", "tab_inactive", "back"]
        role_fallback_keys = ["tabs_hex", "editor_background_hex", "section_fill_hex"]
    elif context_name.startswith("wcol_"):
        preferred_attributes = ["inner", "item", "back", "outline"]
        role_fallback_keys = ["controls_hex", "editor_background_hex", "section_fill_hex"]
    else:
        preferred_attributes = [
            "inner",
            "back",
            "button",
            "list",
            "menu_back",
            "header",
            "navigation_bar",
            "item",
        ]

    for candidate_attribute in preferred_attributes:
        current_rgb = _current_theme_rgb(target, candidate_attribute)
        if current_rgb is not None:
            return _rgb_to_hex(current_rgb)

    for role_key in role_fallback_keys:
        if role_key in role_hexes:
            return role_hexes[role_key]

    return role_hexes["editor_background_hex"]


def _select_contrasting_fill_hex(text_hex: str, role_hexes) -> str:
    preferred_fill = role_hexes["highlights_hex"]
    fallback_fill = role_hexes["editor_background_hex"]
    if _contrast_ratio(text_hex, preferred_fill) >= 4.5:
        return preferred_fill
    if _contrast_ratio(text_hex, fallback_fill) >= 4.5:
        return fallback_fill
    return "#0C0C0C" if _relative_luminance(text_hex) >= 0.5 else "#F4F4F4"


def _resolve_theme_text_role_key(
    target, attribute: str, mode: str = "general", context_name: str = ""
) -> str:
    lowered = attribute.lower()
    if context_name.startswith("wcol_"):
        widget_role_map = UI_WIDGET_TEXT_ROLE_OVERRIDES.get(context_name, {})
        if lowered in widget_role_map:
            return widget_role_map[lowered]
    if (
        lowered.endswith("_hi")
        or "_hi" in lowered
        or lowered.endswith("_sel")
        or "_sel" in lowered
        or "selected" in lowered
        or "match" in lowered
    ):
        return "accent_text_hex"
    if "tab" in lowered:
        return "tabs_text_hex"
    if "header" in lowered:
        return "header_text_hex"
    if mode == "outliner" and attribute == "text":
        return "accent_text_hex"

    current_rgb = _current_theme_rgb(target, attribute)
    if current_rgb is None:
        return "text_hex"

    _, saturation, value = colorsys.rgb_to_hsv(*current_rgb)
    if saturation >= 0.2 and value >= 0.3:
        return "accent_text_hex"
    if _rgb_relative_luminance(current_rgb) <= 0.18:
        return "control_text_hex"
    return "text_hex"


def _set_theme_text_property(
    target,
    attribute: str,
    role_hexes,
    mode: str = "general",
    context_name: str = "",
):
    role_key = _resolve_theme_text_role_key(target, attribute, mode, context_name)
    preferred_hex = role_hexes[role_key]
    background_hex = _resolve_theme_text_background_hex(
        target, attribute, role_hexes, context_name
    )
    lowered = attribute.lower()
    is_selected_like = (
        lowered.endswith("_hi")
        or "_hi" in lowered
        or lowered.endswith("_sel")
        or "_sel" in lowered
        or "selected" in lowered
        or "match" in lowered
    )

    if is_selected_like:
        hex_value, _ = _contrast_safe_text_hex(preferred_hex, background_hex)
    else:
        hex_value = _prefer_contrasting_text_hex(
            preferred_hex,
            background_hex,
            (
                role_hexes["text_hex"],
                role_hexes["control_text_hex"],
                role_hexes["accent_text_hex"],
                role_hexes["header_text_hex"],
                role_hexes["tabs_text_hex"],
            ),
        )
    return _set_theme_color_property(
        target,
        attribute,
        _hex_to_rgb_floats(hex_value),
        _hex_to_rgba_floats(hex_value),
    )


def _is_theme_subtarget(value) -> bool:
    if value is None or callable(value):
        return False
    if isinstance(value, (str, bytes, bool, int, float, tuple, list, dict, set)):
        return False
    return hasattr(value, "rna_type") or hasattr(value, "bl_rna")


def _iter_theme_ui_widget_names(theme_ui):
    discovered = []
    for widget_name in PREFERRED_UI_WIDGET_ORDER:
        if hasattr(theme_ui, widget_name):
            discovered.append(widget_name)
    for attribute in dir(theme_ui):
        if not attribute.startswith("wcol_") or attribute in discovered:
            continue
        discovered.append(attribute)
    return tuple(discovered)


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
        try:
            mutable_value = getattr(target, attribute)
        except Exception:
            return False
        try:
            replacement = None
            if value_length == 4:
                replacement = tuple(rgba_value or (*rgb_value, 1.0))
            elif value_length == 3:
                replacement = tuple(rgb_value)
            elif rgba_value is not None:
                replacement = tuple(rgba_value)
            else:
                replacement = tuple(rgb_value)

            if replacement is None:
                return False

            for index, channel in enumerate(replacement):
                mutable_value[index] = channel
            return True
        except Exception:
            return False


def _normalize_hex_color_with_fallback(payload, primary_key: str, fallback_key: str):
    primary_value = payload.get(primary_key)
    if primary_value is not None and str(primary_value).strip():
        return _normalize_hex_color(payload, primary_key)
    return _normalize_hex_color(payload, fallback_key)


def _set_theme_widget_colors(
    widget_name: str, widget, fill_hex: str, borders_hex: str, role_hexes
):
    fill_rgba = _hex_to_rgba_floats(fill_hex)
    fill_rgb = _hex_to_rgb_floats(fill_hex)
    borders_rgb = _hex_to_rgb_floats(borders_hex)
    borders_rgba = _hex_to_rgba_floats(borders_hex)
    selected_fill_hex = _select_contrasting_fill_hex(role_hexes["accent_text_hex"], role_hexes)
    if widget_name == "wcol_box":
        # Blender's collapsible preference/theme section headers render through the
        # box widget's selected fill path rather than the explicit panelcolors
        # header swatch, so keep that active strip on the Headers bucket too.
        selected_fill_hex = role_hexes["headers_hex"]
    _set_theme_color_property(widget, "inner", fill_rgb, fill_rgba)
    _set_theme_color_property(
        widget,
        "inner_sel",
        _hex_to_rgb_floats(selected_fill_hex),
        _hex_to_rgba_floats(selected_fill_hex),
    )
    _set_theme_color_property(widget, "item", borders_rgb, borders_rgba)
    _set_theme_color_property(widget, "outline", borders_rgb, borders_rgba)
    _set_theme_color_property(
        widget,
        "outline_sel",
        _hex_to_rgb_floats(selected_fill_hex),
        _hex_to_rgba_floats(selected_fill_hex),
    )
    _set_theme_text_property(widget, "text", role_hexes, "widget", widget_name)
    _set_theme_text_property(widget, "text_sel", role_hexes, "widget", widget_name)
    if hasattr(widget, "show_shaded"):
        try:
            widget.show_shaded = True
        except Exception:
            pass


def _apply_theme_space_colors(theme_space, role_hexes):
    if theme_space is None:
        return
    _set_theme_color_property(
        theme_space,
        "back",
        _hex_to_rgb_floats(role_hexes["editor_background_hex"]),
        _hex_to_rgba_floats(role_hexes["editor_background_hex"]),
    )
    _set_theme_color_property(
        theme_space,
        "title",
        _hex_to_rgb_floats(role_hexes["headers_hex"]),
        _hex_to_rgba_floats(role_hexes["headers_hex"]),
    )
    for attribute in ("header", "navigation_bar"):
        _set_theme_color_property(
            theme_space,
            attribute,
            _hex_to_rgb_floats(role_hexes["headers_hex"]),
            _hex_to_rgba_floats(role_hexes["headers_hex"]),
        )
    for attribute in ("text", "text_hi"):
        _set_theme_text_property(theme_space, attribute, role_hexes, "general")
    for attribute in ("button",):
        _set_theme_color_property(
            theme_space,
            attribute,
            _hex_to_rgb_floats(role_hexes["controls_hex"]),
            _hex_to_rgba_floats(role_hexes["controls_hex"]),
        )
    _set_theme_color_property(
        theme_space,
        "button_title",
        _hex_to_rgb_floats(role_hexes["accent_text_hex"]),
        _hex_to_rgba_floats(role_hexes["accent_text_hex"]),
    )
    _set_theme_color_property(
        theme_space,
        "execution_buts",
        _hex_to_rgb_floats(role_hexes["controls_hex"]),
        _hex_to_rgba_floats(role_hexes["controls_hex"]),
    )
    for attribute in ("button_text", "button_text_hi"):
        _set_theme_text_property(theme_space, attribute, role_hexes, "general")
    for attribute in ("outline", "grid"):
        _set_theme_color_property(
            theme_space,
            attribute,
            _hex_to_rgb_floats(role_hexes["borders_hex"]),
            _hex_to_rgba_floats(role_hexes["borders_hex"]),
        )
    _apply_theme_panel_colors(getattr(theme_space, "panelcolors", None), role_hexes)


def _apply_theme_text_sweep(
    target,
    role_hexes,
    mode: str = "general",
    visited=None,
    depth: int = 0,
    context_name: str = "",
):
    if target is None:
        return
    if visited is None:
        visited = set()
    target_id = id(target)
    if target_id in visited or depth > 3:
        return
    visited.add(target_id)
    for attribute in dir(target):
        if attribute.startswith("_"):
            continue
        lowered = attribute.lower()
        try:
            value = getattr(target, attribute)
        except Exception:
            continue
        if callable(value):
            continue
        if "text" in lowered:
            _set_theme_text_property(target, attribute, role_hexes, mode, context_name)
            continue
        if _is_theme_subtarget(value):
            _apply_theme_text_sweep(
                value, role_hexes, mode, visited, depth + 1, context_name
            )


def _apply_theme_widget_state_colors(theme_state, role_hexes):
    if theme_state is None:
        return
    base_map = {
        "error": role_hexes["highlights_hex"],
        "info": role_hexes["headers_hex"],
        "inner_anim": role_hexes["controls_hex"],
        "inner_anim_sel": role_hexes["highlights_hex"],
        "inner_changed": role_hexes["controls_hex"],
        "inner_changed_sel": role_hexes["highlights_hex"],
        "inner_driven": role_hexes["headers_hex"],
        "inner_driven_sel": role_hexes["highlights_hex"],
        "inner_key": role_hexes["headers_hex"],
        "inner_key_sel": role_hexes["highlights_hex"],
        "inner_overridden": role_hexes["darks_hex"],
        "inner_overridden_sel": role_hexes["highlights_hex"],
        "inner_red_alert": role_hexes["highlights_hex"],
        "inner_red_alert_sel": role_hexes["highlights_hex"],
    }
    for attribute, hex_value in base_map.items():
        _set_theme_color_property(
            theme_state,
            attribute,
            _hex_to_rgb_floats(hex_value),
            _hex_to_rgba_floats(hex_value),
        )


def _apply_theme_panel_colors(panel, role_hexes):
    if panel is None:
        return
    headers_rgb = _hex_to_rgb_floats(role_hexes["headers_hex"])
    headers_rgba = _hex_to_rgba_floats(role_hexes["headers_hex"])
    panel_text_hex = _pick_best_contrast_hex(
        role_hexes["editor_background_hex"],
        [role_hexes["text_hex"], role_hexes["control_text_hex"]],
    )
    panel_title_hex = _prefer_contrasting_text_hex(
        role_hexes["accent_text_hex"],
        role_hexes["editor_background_hex"],
        [role_hexes["text_hex"], role_hexes["control_text_hex"]],
    )
    _set_theme_color_property(
        panel,
        "header",
        headers_rgb,
        headers_rgba,
    )
    _set_theme_color_property(
        panel,
        "back",
        _hex_to_rgb_floats(role_hexes["editor_background_hex"]),
        _hex_to_rgba_floats(role_hexes["editor_background_hex"]),
    )
    _set_theme_color_property(
        panel,
        "sub_back",
        _hex_to_rgb_floats(role_hexes["editor_background_hex"]),
        _hex_to_rgba_floats(role_hexes["editor_background_hex"]),
    )
    _set_theme_color_property(
        panel,
        "active",
        headers_rgb,
        headers_rgba,
    )
    _set_theme_color_property(
        panel,
        "title",
        _hex_to_rgb_floats(panel_title_hex),
        _hex_to_rgba_floats(panel_title_hex),
    )
    _set_theme_color_property(
        panel,
        "text",
        _hex_to_rgb_floats(panel_text_hex),
        _hex_to_rgba_floats(panel_text_hex),
    )
    _set_theme_color_property(
        panel,
        "outline",
        _hex_to_rgb_floats(role_hexes["editor_background_hex"]),
        _hex_to_rgba_floats(role_hexes["editor_background_hex"]),
    )
    if hasattr(panel, "show_header"):
        try:
            panel.show_header = True
        except Exception:
            pass
    if hasattr(panel, "show_back"):
        try:
            panel.show_back = True
        except Exception:
            pass
    _apply_theme_text_sweep(panel, role_hexes, "general")


def _apply_exact_user_interface_panel_paths(theme, role_hexes):
    headers_rgb = _hex_to_rgb_floats(role_hexes["headers_hex"])
    headers_rgba = _hex_to_rgba_floats(role_hexes["headers_hex"])
    background_rgb = _hex_to_rgb_floats(role_hexes["editor_background_hex"])
    background_rgba = _hex_to_rgba_floats(role_hexes["editor_background_hex"])
    theme_ui = getattr(theme, "user_interface", None)
    if theme_ui is None:
        return

    panel_text_hex = _pick_best_contrast_hex(
        role_hexes["editor_background_hex"],
        [role_hexes["text_hex"], role_hexes["control_text_hex"]],
    )
    panel_title_hex = _prefer_contrasting_text_hex(
        role_hexes["accent_text_hex"],
        role_hexes["editor_background_hex"],
        [role_hexes["text_hex"], role_hexes["control_text_hex"]],
    )

    # Blender 5.x stores the User Interface > Panel swatches directly on
    # ThemeUserInterface as panel_* fields instead of a nested panelcolors
    # struct, so write those exact RNA paths first.
    _set_theme_color_property(theme_ui, "panel_header", headers_rgb, headers_rgba)
    _set_theme_color_property(theme_ui, "panel_back", background_rgb, background_rgba)
    _set_theme_color_property(theme_ui, "panel_sub_back", background_rgb, background_rgba)
    _set_theme_color_property(theme_ui, "panel_active", headers_rgb, headers_rgba)
    _set_theme_color_property(
        theme_ui,
        "panel_title",
        _hex_to_rgb_floats(panel_title_hex),
        _hex_to_rgba_floats(panel_title_hex),
    )
    _set_theme_color_property(
        theme_ui,
        "panel_text",
        _hex_to_rgb_floats(panel_text_hex),
        _hex_to_rgba_floats(panel_text_hex),
    )
    _set_theme_color_property(theme_ui, "panel_outline", background_rgb, background_rgba)

    # Keep the older nested panelcolors path for compatibility with older
    # Blender theme layouts that still expose it.
    panel = getattr(theme_ui, "panel", None)
    if panel is not None:
        _set_theme_color_property(
            panel,
            "header",
            headers_rgb,
            headers_rgba,
        )
        _set_theme_color_property(
            panel,
            "active",
            headers_rgb,
            headers_rgba,
        )
        _set_theme_color_property(
            panel,
            "back",
            background_rgb,
            background_rgba,
        )
        _set_theme_color_property(
            panel,
            "sub_back",
            background_rgb,
            background_rgba,
        )


def _apply_theme_editor_colors(theme_section, role_hexes, section_name: str = ""):
    if theme_section is None:
        return
    tabs_hex = role_hexes["tabs_hex"]
    tabs_text_hex = role_hexes["tabs_text_hex"]
    headers_hex = role_hexes["headers_hex"]
    header_text_hex = role_hexes["header_text_hex"]
    background_role_key = "scene_hex" if section_name == "outliner" else "editor_background_hex"
    fill_role_key = "scene_hex" if section_name == "outliner" else "section_fill_hex"
    editor_background_hex = role_hexes[background_role_key]
    section_fill_hex = role_hexes[fill_role_key]
    row_alt_hex = role_hexes[fill_role_key] if section_name == "outliner" else role_hexes["row_alt_hex"]
    controls_hex = role_hexes["controls_hex"]
    borders_hex = role_hexes["borders_hex"]
    darks_hex = role_hexes["darks_hex"]
    highlights_hex = role_hexes["highlights_hex"]

    tabs_rgb = _hex_to_rgb_floats(tabs_hex)
    tabs_rgba = _hex_to_rgba_floats(tabs_hex)
    headers_rgb = _hex_to_rgb_floats(headers_hex)
    headers_rgba = _hex_to_rgba_floats(headers_hex)
    editor_background_rgb = _hex_to_rgb_floats(editor_background_hex)
    editor_background_rgba = _hex_to_rgba_floats(editor_background_hex)
    section_fill_rgb = _hex_to_rgb_floats(section_fill_hex)
    section_fill_rgba = _hex_to_rgba_floats(section_fill_hex)
    row_alt_rgb = _hex_to_rgb_floats(row_alt_hex)
    row_alt_rgba = _hex_to_rgba_floats(row_alt_hex)
    controls_rgb = _hex_to_rgb_floats(controls_hex)
    controls_rgba = _hex_to_rgba_floats(controls_hex)
    borders_rgb = _hex_to_rgb_floats(borders_hex)
    borders_rgba = _hex_to_rgba_floats(borders_hex)
    darks_rgb = _hex_to_rgb_floats(darks_hex)
    darks_rgba = _hex_to_rgba_floats(darks_hex)
    highlights_rgb = _hex_to_rgb_floats(highlights_hex)
    highlights_rgba = _hex_to_rgba_floats(highlights_hex)

    _set_theme_color_property(
        theme_section, "back", editor_background_rgb, editor_background_rgba
    )
    _set_theme_color_property(theme_section, "sub_back", darks_rgb, darks_rgba)
    _set_theme_color_property(theme_section, "list", section_fill_rgb, section_fill_rgba)
    _set_theme_color_property(theme_section, "row_alternate", row_alt_rgb, row_alt_rgba)

    for attribute in ("list_text",):
        _set_theme_text_property(theme_section, attribute, role_hexes, "general")

    for attribute in ("header", "title"):
        _set_theme_color_property(theme_section, attribute, headers_rgb, headers_rgba)
    for attribute in ("navigation_bar",):
        _set_theme_color_property(theme_section, attribute, headers_rgb, headers_rgba)
    for attribute in ("tab_back", "tab_active"):
        _set_theme_color_property(theme_section, attribute, tabs_rgb, tabs_rgba)
    for attribute in ("button",):
        _set_theme_color_property(theme_section, attribute, controls_rgb, controls_rgba)
    _set_theme_color_property(
        theme_section,
        "button_title",
        _hex_to_rgb_floats(role_hexes["accent_text_hex"]),
        _hex_to_rgba_floats(role_hexes["accent_text_hex"]),
    )
    for attribute in ("execution_buts",):
        _set_theme_color_property(theme_section, attribute, controls_rgb, controls_rgba)

    for attribute in ("header_text", "header_text_hi"):
        _set_theme_text_property(theme_section, attribute, role_hexes, "general")
    for attribute in ("text", "text_hi"):
        _set_theme_text_property(theme_section, attribute, role_hexes, "general")
    for attribute in ("tab_text", "tab_text_hi"):
        _set_theme_text_property(theme_section, attribute, role_hexes, "general")
    for attribute in ("button_text", "button_text_hi"):
        _set_theme_text_property(theme_section, attribute, role_hexes, "general")

    for attribute in ("tab_inactive", "menu_back"):
        _set_theme_color_property(theme_section, attribute, darks_rgb, darks_rgba)
    for attribute in ("tab_outline", "menu_item", "separator", "outline"):
        _set_theme_color_property(theme_section, attribute, borders_rgb, borders_rgba)

    for attribute in (
        "edge_select",
        "face_select",
        "vertex_select",
        "active",
        "grid",
        "selected_highlight",
    ):
        _set_theme_color_property(theme_section, attribute, highlights_rgb, highlights_rgba)

    for attribute in ("button_animated", "button_key"):
        _set_theme_color_property(theme_section, attribute, controls_rgb, controls_rgba)
    for attribute in ("button_key_sel",):
        _set_theme_color_property(theme_section, attribute, highlights_rgb, highlights_rgba)

    panel = getattr(theme_section, "panelcolors", None)
    if panel is not None:
        _apply_theme_panel_colors(panel, role_hexes)
    space_panel = getattr(getattr(theme_section, "space", None), "panelcolors", None)
    if space_panel is not None and space_panel is not panel:
        _apply_theme_panel_colors(space_panel, role_hexes)

    _apply_theme_space_colors(getattr(theme_section, "space", None), role_hexes)
    _apply_theme_text_sweep(theme_section, role_hexes, "general")
    _apply_theme_text_sweep(getattr(theme_section, "space", None), role_hexes, "general")


def _apply_theme_outliner_colors(theme_outliner, role_hexes, visual_mode: str = "dark"):
    if theme_outliner is None:
        return
    accent_rgb = _hex_to_rgb_floats(role_hexes["accent_text_hex"])
    accent_rgba = _hex_to_rgba_floats(role_hexes["accent_text_hex"])
    highlights_rgb = _hex_to_rgb_floats(role_hexes["highlights_hex"])
    highlights_rgba = _hex_to_rgba_floats(role_hexes["highlights_hex"])
    active_highlight_hex = "#FFFFFF" if visual_mode == "light" else "#000000"
    active_highlight_rgb = _hex_to_rgb_floats(active_highlight_hex)
    active_highlight_rgba = _hex_to_rgba_floats(active_highlight_hex)

    for attribute in ("match", "active_object", "selected_object"):
        _set_theme_color_property(theme_outliner, attribute, accent_rgb, accent_rgba)
    _set_theme_color_property(
        theme_outliner, "active", active_highlight_rgb, active_highlight_rgba
    )
    _set_theme_color_property(
        theme_outliner, "selected_highlight", highlights_rgb, highlights_rgba
    )
    for attribute in ("back", "list", "row_alternate"):
        _set_theme_color_property(
            theme_outliner,
            attribute,
            _hex_to_rgb_floats(role_hexes["scene_hex"]),
            _hex_to_rgba_floats(role_hexes["scene_hex"]),
        )
    _apply_theme_text_sweep(theme_outliner, role_hexes, "outliner")


def _apply_theme_user_interface(theme_ui, role_hexes):
    if theme_ui is None:
        return
    tabs_hex = role_hexes["tabs_hex"]
    headers_hex = role_hexes["headers_hex"]
    section_fill_hex = role_hexes["section_fill_hex"]
    editor_background_hex = role_hexes["editor_background_hex"]
    controls_hex = role_hexes["controls_hex"]
    borders_hex = role_hexes["borders_hex"]
    darks_hex = role_hexes["darks_hex"]
    highlights_hex = role_hexes["highlights_hex"]

    for widget_name in _iter_theme_ui_widget_names(theme_ui):
        widget = getattr(theme_ui, widget_name, None)
        if widget is None:
            continue
        if widget_name == "wcol_state":
            _apply_theme_widget_state_colors(widget, role_hexes)
            continue
        fill_hex = (
            controls_hex
            if widget_name
            not in ("wcol_box", "wcol_menu_back", "wcol_tooltip", "wcol_menu", "wcol_menu_item")
            else darks_hex
        )
        if widget_name in ("wcol_tab", "wcol_toolbar_item"):
            fill_hex = tabs_hex
        if widget_name in ("wcol_option", "wcol_radio", "wcol_toggle", "wcol_progress"):
            fill_hex = highlights_hex
        if widget_name == "wcol_list_item":
            fill_hex = darks_hex
        _set_theme_widget_colors(widget_name, widget, fill_hex, borders_hex, role_hexes)
        _apply_theme_text_sweep(widget, role_hexes, "widget", context_name=widget_name)
        if widget_name in ("wcol_option", "wcol_radio", "wcol_toggle", "wcol_progress"):
            _set_theme_color_property(
                widget, "inner_sel", _hex_to_rgb_floats(highlights_hex), _hex_to_rgba_floats(highlights_hex)
            )
        _set_theme_color_property(
            widget, "outline", _hex_to_rgb_floats(borders_hex), _hex_to_rgba_floats(borders_hex)
        )

    panel = getattr(theme_ui, "panel", None)
    if panel is not None:
        _apply_theme_panel_colors(panel, role_hexes)

    _apply_theme_text_sweep(theme_ui, role_hexes, "general")


def _absorb_current_theme(context):
    theme = _ctx(context).preferences.themes[0]

    tabs_hex = _sample_theme_hex_from_paths(
        theme,
        [
            ("user_interface", "tab_back"),
            ("user_interface", "tab_active"),
            ("user_interface.wcol_tab", "inner"),
            ("user_interface.wcol_tab", "text"),
        ],
    )

    headers_hex = _sample_theme_hex_from_paths(
        theme,
        [
            ("user_interface", "panel_header"),
            ("user_interface", "panel_active"),
            ("user_interface", "header"),
            ("user_interface", "title"),
            ("user_interface", "navigation_bar"),
            ("user_interface", "panel_title"),
        ],
    )

    text_hex = _sample_theme_hex_from_paths(
        theme,
        [
            ("user_interface", "text"),
            ("user_interface", "text_hi"),
            ("user_interface", "panel_text"),
            ("user_interface.wcol_text", "text"),
            ("user_interface.wcol_text", "text_hi"),
            ("user_interface.wcol_tooltip", "text"),
        ],
    )

    control_text_hex = _sample_theme_hex_from_paths(
        theme,
        [
            ("user_interface", "item"),
            ("user_interface", "button_title"),
            ("user_interface.wcol_regular", "text"),
            ("user_interface.wcol_regular", "text_hi"),
            ("user_interface.wcol_tool", "text"),
            ("user_interface.wcol_tooltip", "text_hi"),
        ],
    )

    accent_text_hex = _sample_theme_hex_from_paths(
        theme,
        [
            ("user_interface", "panel_title"),
            ("user_interface", "button_title"),
            ("user_interface.wcol_pie_menu", "text"),
            ("user_interface.wcol_option", "text"),
        ],
    )

    tabs_text_hex = _sample_theme_hex_from_paths(
        theme,
        [
            ("user_interface.wcol_tab", "text"),
            ("user_interface.panel", "header"),  # legacy compatibility
        ],
    )

    header_text_hex = _sample_theme_hex_from_paths(
        theme,
        [
            ("user_interface", "header_text"),
            ("user_interface", "header_text_hi"),
            ("user_interface", "panel_text"),
        ],
    )

    editor_background_hex = _sample_theme_hex_from_paths(
        theme,
        [
            ("user_interface", "back"),
            ("user_interface", "sub_back"),
            ("user_interface", "panel_back"),
            ("user_interface", "panel_sub_back"),
        ],
    )

    scene_hex = _sample_theme_hex_from_paths(
        theme,
        [
            ("outliner", "back"),
            ("outliner", "list"),
            ("outliner", "scene"),
            ("view_3d", "back"),
            ("view_3d", "list"),
            ("properties", "back"),
        ],
    )

    section_fill_hex = _sample_theme_hex_from_paths(
        theme,
        [
            ("user_interface", "list"),
            ("user_interface", "item"),
            ("user_interface.wcol_list_item", "item"),
        ],
    )

    controls_hex = _sample_theme_hex_from_paths(
        theme,
        [
            ("user_interface", "button"),
            ("user_interface", "button_title"),
            ("user_interface", "execution_buts"),
            ("user_interface.wcol_regular", "item"),
            ("user_interface.wcol_regular", "inner"),
            ("user_interface.wcol_box", "inner"),
        ],
    )

    row_alt_hex = _sample_theme_hex_from_paths(
        theme,
        [
            ("user_interface", "row_alternate"),
            ("user_interface", "row_alt"),
            ("user_interface.wcol_list_item", "inner_sel"),
        ],
    )

    highlights_hex = _sample_theme_hex_from_paths(
        theme,
        [
            ("user_interface", "selected_highlight"),
            ("user_interface", "active"),
            ("user_interface.wcol_state", "inner_sel"),
            ("user_interface.wcol_state", "item"),
        ],
    )

    borders_hex = _sample_theme_hex_from_paths(
        theme,
        [
            ("user_interface", "outline"),
            ("user_interface", "separator"),
            ("user_interface", "menu_item"),
            ("user_interface.wcol_regular", "outline"),
            ("user_interface.wcol_box", "outline"),
            ("user_interface.wcol_state", "outline"),
        ],
    )

    darks_hex = _sample_theme_hex_from_paths(
        theme,
        [
            ("user_interface", "sub_back"),
            ("user_interface", "menu_back"),
            ("user_interface", "back"),
        ],
    )

    misc_hex = _sample_theme_hex_from_paths(
        theme,
        [
            ("user_interface", "panel_back"),
            ("user_interface", "panel_sub_back"),
            ("user_interface", "outline"),
        ],
    )

    viewport_gradients = _safe_theme_path_value(theme, "view_3d.space.gradients")
    sampled_viewport_background = _current_theme_rgb(viewport_gradients, "gradient")
    sampled_viewport_highlight = _current_theme_rgb(viewport_gradients, "high_gradient")
    viewport_background_hex = (
        _rgb_to_hex(sampled_viewport_background)
        if sampled_viewport_background is not None
        else None
    )
    viewport_gradient_hex = (
        _rgb_to_hex(sampled_viewport_highlight)
        if sampled_viewport_highlight is not None
        else None
    )
    viewport_gradient_enabled = bool(
        _safe_theme_path_value(viewport_gradients, "show_grad")
    ) if viewport_gradients is not None else False

    return _result(
        "Blender theme sampled from current settings.",
        tabs_hex=tabs_hex,
        tabs_text_hex=tabs_text_hex,
        headers_hex=headers_hex,
        header_text_hex=header_text_hex,
        text_hex=text_hex,
        control_text_hex=control_text_hex,
        accent_text_hex=accent_text_hex,
        editor_background_hex=editor_background_hex,
        scene_hex=scene_hex,
        section_fill_hex=section_fill_hex,
        row_alt_hex=row_alt_hex,
        controls_hex=controls_hex,
        borders_hex=borders_hex,
        darks_hex=darks_hex,
        misc_hex=misc_hex,
        highlights_hex=highlights_hex,
        viewport_background_hex=viewport_background_hex,
        viewport_gradient_enabled=viewport_gradient_enabled,
        viewport_gradient_hex=viewport_gradient_hex,
    )


def _apply_theme_from_photo_manual_colors(context, payload):
    visual_mode = _read_string(payload, "visual_mode", "dark").lower()
    role_hexes = {
        "tabs_hex": _normalize_hex_color_with_fallback(payload, "tabs_hex", "headers_hex"),
        "tabs_text_hex": _normalize_hex_color_with_fallback(
            payload, "tabs_text_hex", "text_hex"
        ),
        "headers_hex": _normalize_hex_color(payload, "headers_hex"),
        "header_text_hex": _normalize_hex_color_with_fallback(
            payload, "header_text_hex", "text_hex"
        ),
        "text_hex": _normalize_hex_color(payload, "text_hex"),
        "control_text_hex": _normalize_hex_color_with_fallback(
            payload, "control_text_hex", "text_hex"
        ),
        "accent_text_hex": _normalize_hex_color_with_fallback(
            payload, "accent_text_hex", "highlights_hex"
        ),
        "editor_background_hex": _normalize_hex_color_with_fallback(
            payload, "editor_background_hex", "darks_hex"
        ),
        "scene_hex": _normalize_hex_color_with_fallback(
            payload, "scene_hex", "section_fill_hex"
        ),
        "section_fill_hex": _normalize_hex_color(payload, "section_fill_hex"),
        "row_alt_hex": _normalize_hex_color_with_fallback(
            payload, "row_alt_hex", "darks_hex"
        ),
        "controls_hex": _normalize_hex_color(payload, "controls_hex"),
        "borders_hex": _normalize_hex_color_with_fallback(
            payload, "borders_hex", "misc_hex"
        ),
        "darks_hex": _normalize_hex_color(payload, "darks_hex"),
        "highlights_hex": _normalize_hex_color(payload, "highlights_hex"),
        "viewport_background_hex": _normalize_hex_color(
            payload, "viewport_background_hex"
        ),
        "viewport_gradient_hex": _normalize_hex_color(payload, "viewport_gradient_hex"),
    }
    role_hexes["borders_hex"] = role_hexes["editor_background_hex"]
    role_hexes["darks_hex"] = role_hexes["editor_background_hex"]
    viewport_gradient_enabled = bool(payload.get("viewport_gradient_enabled", False))

    theme = _ctx(context).preferences.themes[0]
    _apply_theme_user_interface(getattr(theme, "user_interface", None), role_hexes)

    for section_name in THEME_EDITOR_SECTION_NAMES:
        _apply_theme_editor_colors(getattr(theme, section_name, None), role_hexes, section_name)
    _apply_theme_outliner_colors(getattr(theme, "outliner", None), role_hexes, visual_mode)

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

    # Reassert the exact User Interface > Panel swatches after the broader
    # section/theme-space pass so Header/Background stay owned by the intended
    # buckets even if another theme sub-structure overlaps them.
    _apply_exact_user_interface_panel_paths(theme, role_hexes)

    _tag_redraw_view3d()
    return _result(
        "Blender UI theme updated from sampled photo colors.",
        tabs_hex=role_hexes["tabs_hex"],
        tabs_text_hex=role_hexes["tabs_text_hex"],
        headers_hex=role_hexes["headers_hex"],
        header_text_hex=role_hexes["header_text_hex"],
        text_hex=role_hexes["text_hex"],
        control_text_hex=role_hexes["control_text_hex"],
        accent_text_hex=role_hexes["accent_text_hex"],
        editor_background_hex=role_hexes["editor_background_hex"],
        scene_hex=role_hexes["scene_hex"],
        section_fill_hex=role_hexes["section_fill_hex"],
        row_alt_hex=role_hexes["row_alt_hex"],
        controls_hex=role_hexes["controls_hex"],
        borders_hex=role_hexes["borders_hex"],
        darks_hex=role_hexes["darks_hex"],
        highlights_hex=role_hexes["highlights_hex"],
        viewport_background_hex=role_hexes["viewport_background_hex"],
        viewport_gradient_enabled=viewport_gradient_enabled,
        viewport_gradient_hex=role_hexes["viewport_gradient_hex"],
        text_corrected=False,
    )


def run_flowcell_action(context=None, data=None):
    payload = data or {}
    command = _read_string(payload, "command", "apply_all").lower()
    if command == "apply_theme_from_photo_manual_colors":
        return _apply_theme_from_photo_manual_colors(context, payload)
    if command == "absorb_theme":
        return _absorb_current_theme(context)

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
