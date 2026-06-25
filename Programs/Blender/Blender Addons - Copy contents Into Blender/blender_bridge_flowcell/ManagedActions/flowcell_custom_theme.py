# Description: Set Blender UI theme and HDRI values, plus Place Picture fake gizmos and fake grid over a background image.


# FLOWCELL_CHILD: browse_theme | Browse | Choose a theme source image to sample colors from.
# FLOWCELL_CHILD: absorb_theme | Absorb Theme | Pull the current Blender theme values back into the tool fields.
# FLOWCELL_CHILD: save_theme | Save Theme | Save the currently staged Blender theme preset.
# FLOWCELL_CHILD: load_theme | Load Theme | Load a saved Blender theme preset into the tool fields.
# FLOWCELL_CHILD: dark_theme | Dark Theme | Stage the sampled palette as a dark Blender theme.
# FLOWCELL_CHILD: light_theme | Light Theme | Stage the sampled palette as a light Blender theme.
# FLOWCELL_CHILD: apply_theme | Apply | Apply the currently visible Blender theme role colors.
# FLOWCELL_CHILD: apply_background_pic | Place Picture | Creates fake gizmos and a fake grid on top of a background image.
# FLOWCELL_CHILD: apply_grid | Grid | Apply near and far grid spacing using the world-origin distance threshold.
# FLOWCELL_CHILD: browse_background_pic | Browse | Choose the Place Picture background image path.
# FLOWCELL_CHILD: startup_background_pic | Startup | Save the current Place Picture image so Blender restores it on startup.
# FLOWCELL_CHILD: clear_background_pic | Clear | Remove the Place Picture fake background, grid, and gizmos while keeping the path field.
# FLOWCELL_CHILD: apply_hdri | HDRI Apply | Apply the HDRI path in the field.
# FLOWCELL_CHILD: clear_world | Clear | Reset the current file to a plain world without the staged HDRI.
# FLOWCELL_CHILD: reset_world | Reset | Rebuild a clean world and reapply the staged HDRI values.
# FLOWCELL_CHILD: browse_hdri | HDRI Browse | Choose the HDRI file path.
# FLOWCELL_CHILD: apply_rotation_z | Z | Apply the staged Z rotation value.
# FLOWCELL_CHILD: apply_rotation_y | Y | Apply the staged Y rotation value.
# FLOWCELL_CHILD: apply_rotation_x | X | Apply the staged X rotation value.
# FLOWCELL_CHILD: apply_world_strength | WS | Apply the staged world strength value.

import colorsys
import importlib
import json
import math
import time
from pathlib import Path

import bpy
import gpu
from bpy.app.handlers import persistent
from bpy_extras import view3d_utils
from gpu_extras.batch import batch_for_shader
from mathutils import Matrix, Vector


DEFAULT_HDRI_PATH = ""
DEFAULT_ROTATION_X_DEGREES = 90.0
DEFAULT_ROTATION_Y_DEGREES = 0.0
DEFAULT_ROTATION_Z_DEGREES = 30.0
DEFAULT_WORLD_STRENGTH = 0.25
DEFAULT_STATIC_BACKGROUND_PATH = ""
STATIC_BACKGROUND_FIT_MODE = "COVER"
STATIC_BACKGROUND_USE_ALPHA = False
STATIC_BACKGROUND_FLIP_Y = False
VIEWPORT_OVERLAY_NAMESPACE_KEY = "flowcell_hdri_world_viewport_overlay"
VIEWPORT_OVERLAY_LOAD_HANDLER_KEY = "flowcell_hdri_world_viewport_overlay_load_post"
VIEWPORT_OVERLAY_PATH_KEY = "flowcell_hdri_world_static_background_path"
PLACE_PICTURE_GENERATION_KEY = "flowcell_place_picture_fake_gizmo_generation"
PLACE_PICTURE_GRID_SPACING_KEY = "flowcell_place_picture_grid_spacing_m"
PLACE_PICTURE_GRID_DISTANCE_KEY = "flowcell_place_picture_grid_distance_m"
PLACE_PICTURE_GRID_FAR_SPACING_KEY = "flowcell_place_picture_grid_far_spacing_m"
PROJECT_THEME_STATE_KEY = "flowcell_theme_project_state_v1"
PROJECT_THEME_STATE_FORMAT = "flowcell-blender-theme-project-state-v1"
GLOBAL_THEME_STATE_FILE_NAME = "flowcell_theme_startup_state_v1.json"
PROJECT_THEME_STATE_THEME_KEYS = (
    "visual_mode",
    "tabs_hex",
    "tabs_text_hex",
    "headers_hex",
    "header_text_hex",
    "text_hex",
    "control_text_hex",
    "accent_text_hex",
    "editor_background_hex",
    "scene_hex",
    "controls_hex",
    "borders_hex",
    "darks_hex",
    "misc_hex",
    "highlights_hex",
    "viewport_background_hex",
    "viewport_gradient_enabled",
    "viewport_gradient_hex",
)

PLACE_PICTURE_ENABLE_BACKGROUND = True
PLACE_PICTURE_ENABLE_FAKE_GRID = True
PLACE_PICTURE_ENABLE_FAKE_GIZMOS = True
PLACE_PICTURE_ENABLE_MOVE_GIZMO = True
PLACE_PICTURE_ENABLE_MOVE_AXIS_HANDLES = True
PLACE_PICTURE_ENABLE_MOVE_PLANE_HANDLES = True
PLACE_PICTURE_ENABLE_ROTATE_GIZMO = True
PLACE_PICTURE_ENABLE_ROTATE_AXIS_RINGS = True
PLACE_PICTURE_ENABLE_FREE_ROTATE_RING = True
PLACE_PICTURE_ENABLE_SCALE_GIZMO = True
PLACE_PICTURE_ENABLE_SCALE_AXIS_HANDLES = True
PLACE_PICTURE_ENABLE_SCALE_PLANE_HANDLES = True
PLACE_PICTURE_ENABLE_UNIFORM_SCALE_HANDLE = True
PLACE_PICTURE_ENABLE_COMBINED_TRANSFORM_GIZMO = True

DEFAULT_PLACE_PICTURE_GRID_SPACING_M = 1.0
DEFAULT_PLACE_PICTURE_GRID_DISTANCE_M = 5.0
DEFAULT_PLACE_PICTURE_GRID_FAR_SPACING_M = 1.0
PLACE_PICTURE_GRID_ALPHA = 0.42
PLACE_PICTURE_GRID_MAJOR_ALPHA = 0.62
PLACE_PICTURE_AXIS_ALPHA = 0.98
PLACE_PICTURE_GRID_MINOR_WIDTH = 1.1
PLACE_PICTURE_GRID_MAJOR_WIDTH = 1.5
PLACE_PICTURE_AXIS_WIDTH = 2.8
PLACE_PICTURE_TARGET_GRID_LINES = 34
PLACE_PICTURE_MAX_GRID_LINES_PER_AXIS = 90
PLACE_PICTURE_MIN_GRID_SPACING_M = 0.001
PLACE_PICTURE_DRAW_SCREEN_GRID_FALLBACK = True

PLACE_PICTURE_GIZMO_DISPLAY_MODE = "ACTIVE_TOOL"
PLACE_PICTURE_GIZMO_ORIENTATION = "GLOBAL"
PLACE_PICTURE_ONLY_DRAW_GIZMOS_FOR_SELECTED_OBJECT = True
PLACE_PICTURE_HIDE_REAL_BLENDER_TRANSFORM_GIZMOS = True

PLACE_PICTURE_MOVE_PIXEL_LENGTH = 86
PLACE_PICTURE_MOVE_LINE_WIDTH = 4.0
PLACE_PICTURE_MOVE_ARROW_SIZE = 15
PLACE_PICTURE_MOVE_CENTER_DOT_SIZE = 7
PLACE_PICTURE_MOVE_HIT_RADIUS = 14
PLACE_PICTURE_MOVE_DRAG_SENSITIVITY = 1.0

PLACE_PICTURE_ROTATE_PIXEL_RADIUS = 82
PLACE_PICTURE_ROTATE_LINE_WIDTH = 3.0
PLACE_PICTURE_ROTATE_SEGMENTS = 96
PLACE_PICTURE_ROTATE_HIT_RADIUS = 11
PLACE_PICTURE_ROTATE_DRAG_SENSITIVITY = 1.0

PLACE_PICTURE_SCALE_PIXEL_LENGTH = 78
PLACE_PICTURE_SCALE_LINE_WIDTH = 3.4
PLACE_PICTURE_SCALE_BOX_SIZE = 12
PLACE_PICTURE_SCALE_CENTER_BOX_SIZE = 10
PLACE_PICTURE_SCALE_HIT_RADIUS = 15
PLACE_PICTURE_SCALE_DRAG_PIXEL_FACTOR = 130.0

PLACE_PICTURE_PLANE_HANDLE_OFFSET = 38
PLACE_PICTURE_PLANE_HANDLE_SIZE = 20
PLACE_PICTURE_PLANE_HIT_RADIUS = 18
PLACE_PICTURE_PLANE_FILL_ALPHA = 0.58
PLACE_PICTURE_PLANE_EDGE_ALPHA = 0.96
PLACE_PICTURE_PLANE_DRAG_SENSITIVITY = 1.0

PLACE_PICTURE_FREE_ROTATE_PIXEL_RADIUS = 104
PLACE_PICTURE_FREE_ROTATE_LINE_WIDTH = 2.8
PLACE_PICTURE_FREE_ROTATE_HIT_RADIUS = 12
PLACE_PICTURE_FREE_ROTATE_DRAG_SENSITIVITY = 1.0

PLACE_PICTURE_COMBINED_MOVE_PIXEL_LENGTH = 74
PLACE_PICTURE_COMBINED_SCALE_PIXEL_LENGTH = 56
PLACE_PICTURE_COMBINED_ROTATE_PIXEL_RADIUS = 88
PLACE_PICTURE_COMBINED_FREE_ROTATE_PIXEL_RADIUS = 112

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
    return _flowcell_script_root()


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
    new_world = bpy.data.worlds.new("FlowCell Clean World")
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
    new_world = bpy.data.worlds.new("FlowCell HDRI World")
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


def _read_grid_spacing_m(payload) -> float:
    spacing_m = _read_float(
        payload or {},
        "grid_spacing_m",
        DEFAULT_PLACE_PICTURE_GRID_SPACING_M,
    )
    if not math.isfinite(spacing_m) or spacing_m <= 0.0:
        raise ValueError("Grid spacing must be a positive number of meters.")
    return spacing_m


def _read_positive_grid_value(payload, key: str, default: float, label: str) -> float:
    value = _read_float(payload or {}, key, default)
    if not math.isfinite(value) or value <= 0.0:
        raise ValueError(f"{label} must be a positive number of meters.")
    return value


def _read_grid_settings(payload):
    return (
        _read_grid_spacing_m(payload),
        _read_positive_grid_value(
            payload,
            "grid_distance_m",
            DEFAULT_PLACE_PICTURE_GRID_DISTANCE_M,
            "Grid distance",
        ),
        _read_positive_grid_value(
            payload,
            "grid_far_spacing_m",
            DEFAULT_PLACE_PICTURE_GRID_FAR_SPACING_M,
            "Far grid spacing",
        ),
    )


def _grid_spacing_blender_units(spacing_m: float) -> float:
    scene = getattr(bpy.context, "scene", None)
    unit_settings = getattr(scene, "unit_settings", None)
    scale_length = float(getattr(unit_settings, "scale_length", 1.0) or 1.0)
    if not math.isfinite(scale_length) or scale_length <= 0.0:
        scale_length = 1.0
    return max(float(spacing_m) / scale_length, 0.000001)


def _set_runtime_grid_settings(spacing_m: float, distance_m: float, far_spacing_m: float):
    namespace = bpy.app.driver_namespace
    state = _overlay_state()
    namespace[PLACE_PICTURE_GRID_SPACING_KEY] = float(spacing_m)
    namespace[PLACE_PICTURE_GRID_DISTANCE_KEY] = float(distance_m)
    namespace[PLACE_PICTURE_GRID_FAR_SPACING_KEY] = float(far_spacing_m)
    state["grid_spacing_m"] = float(spacing_m)
    state["grid_distance_m"] = float(distance_m)
    state["grid_far_spacing_m"] = float(far_spacing_m)
    _tag_redraw_view3d()


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

    if candidate.startswith("//"):
        path = Path(bpy.path.abspath(candidate))
    else:
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


def _bump_place_picture_generation():
    namespace = bpy.app.driver_namespace
    try:
        generation = int(namespace.get(PLACE_PICTURE_GENERATION_KEY, 0)) + 1
    except Exception:
        generation = 1
    namespace[PLACE_PICTURE_GENERATION_KEY] = generation
    return generation


def _place_picture_overlay_is_current(state, generation):
    try:
        return bool(state.get("enabled", False)) and int(state.get("generation", -1)) == int(generation)
    except Exception:
        return False


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
    if window_manager is not None and VIEWPORT_OVERLAY_PATH_KEY in window_manager:
        saved_path = str(window_manager[VIEWPORT_OVERLAY_PATH_KEY] or "").strip()
        if saved_path:
            return saved_path

    global_place_picture_state = _read_global_theme_state().get("place_picture", {})
    if (
        isinstance(global_place_picture_state, dict)
        and bool(global_place_picture_state.get("enabled"))
    ):
        return str(
            global_place_picture_state.get("path")
            or global_place_picture_state.get("relative_path")
            or ""
        ).strip()

    place_picture_state = _read_project_theme_state().get("place_picture", {})
    if isinstance(place_picture_state, dict) and bool(place_picture_state.get("enabled")):
        return str(
            place_picture_state.get("relative_path")
            or place_picture_state.get("path")
            or ""
        ).strip()
    return ""


def _set_saved_overlay_path(path: str):
    window_manager = getattr(bpy.context, "window_manager", None)
    if window_manager is None:
        return
    normalized = str(path or "").strip()
    if normalized:
        window_manager[VIEWPORT_OVERLAY_PATH_KEY] = normalized
    elif VIEWPORT_OVERLAY_PATH_KEY in window_manager:
        del window_manager[VIEWPORT_OVERLAY_PATH_KEY]


def _project_scene(context=None):
    active_context = _ctx(context)
    scene = getattr(active_context, "scene", None)
    if scene is None:
        scene = getattr(bpy.context, "scene", None)
    return scene


def _empty_project_theme_state():
    return {
        "format": PROJECT_THEME_STATE_FORMAT,
        "theme": {"enabled": False},
        "place_picture": {
            "enabled": False,
            "path": "",
            "relative_path": "",
            "grid_spacing_m": DEFAULT_PLACE_PICTURE_GRID_SPACING_M,
            "grid_distance_m": DEFAULT_PLACE_PICTURE_GRID_DISTANCE_M,
            "grid_far_spacing_m": DEFAULT_PLACE_PICTURE_GRID_FAR_SPACING_M,
        },
    }


def _normalize_project_theme_state(value):
    state = _empty_project_theme_state()
    if not isinstance(value, dict):
        return state
    if value.get("format") != PROJECT_THEME_STATE_FORMAT:
        return state

    theme_state = value.get("theme", {})
    if isinstance(theme_state, dict):
        state["theme"].update(theme_state)
        state["theme"]["enabled"] = bool(theme_state.get("enabled"))

    place_picture_state = value.get("place_picture", {})
    if isinstance(place_picture_state, dict):
        state["place_picture"].update(place_picture_state)
        state["place_picture"]["enabled"] = bool(place_picture_state.get("enabled"))
        state["place_picture"]["path"] = str(place_picture_state.get("path") or "")
        state["place_picture"]["relative_path"] = str(
            place_picture_state.get("relative_path") or ""
        )
        spacing_m = place_picture_state.get(
            "grid_spacing_m",
            DEFAULT_PLACE_PICTURE_GRID_SPACING_M,
        )
        try:
            spacing_m = float(spacing_m)
        except (TypeError, ValueError):
            spacing_m = DEFAULT_PLACE_PICTURE_GRID_SPACING_M
        state["place_picture"]["grid_spacing_m"] = (
            spacing_m
            if math.isfinite(spacing_m) and spacing_m > 0.0
            else DEFAULT_PLACE_PICTURE_GRID_SPACING_M
        )

    return state


def _read_project_theme_state(context=None):
    scene = _project_scene(context)
    if scene is None or PROJECT_THEME_STATE_KEY not in scene:
        return _empty_project_theme_state()
    try:
        parsed = json.loads(str(scene.get(PROJECT_THEME_STATE_KEY) or ""))
    except Exception:
        return _empty_project_theme_state()
    return _normalize_project_theme_state(parsed)


def _global_theme_state_path() -> Path:
    config_root = bpy.utils.user_resource("CONFIG", path="", create=True)
    if not config_root:
        config_root = str(Path.home())
    return Path(config_root) / GLOBAL_THEME_STATE_FILE_NAME


def _read_global_theme_state():
    path = _global_theme_state_path()
    if not path.is_file():
        return _empty_project_theme_state()
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return _empty_project_theme_state()
    return _normalize_project_theme_state(parsed)


def _global_theme_state_exists() -> bool:
    return _global_theme_state_path().is_file()


def _write_global_theme_state(state):
    normalized = _normalize_project_theme_state(
        {
            **(state if isinstance(state, dict) else {}),
            "format": PROJECT_THEME_STATE_FORMAT,
        }
    )
    normalized["updated_at"] = time.time()
    path = _global_theme_state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(normalized, indent=2, sort_keys=True), encoding="utf-8")
    _ensure_project_theme_restore_handler_registered_from_action()
    return normalized


def _ensure_project_theme_restore_handler_registered_from_action() -> bool:
    try:
        import flowcell_actions

        ensure_handler = getattr(
            flowcell_actions,
            "_ensure_flowcell_project_theme_restore_handler_registered",
            None,
        )
        for key, default in (
            ("grid_distance_m", DEFAULT_PLACE_PICTURE_GRID_DISTANCE_M),
            ("grid_far_spacing_m", DEFAULT_PLACE_PICTURE_GRID_FAR_SPACING_M),
        ):
            try:
                value = float(place_picture_state.get(key, default))
            except (TypeError, ValueError):
                value = default
            state["place_picture"][key] = (
                value if math.isfinite(value) and value > 0.0 else default
            )
        if not callable(ensure_handler):
            flowcell_actions = importlib.reload(flowcell_actions)
            ensure_handler = getattr(
                flowcell_actions,
                "_ensure_flowcell_project_theme_restore_handler_registered",
                None,
            )
        if callable(ensure_handler):
            ensure_handler()
            return True
    except Exception:
        return False
    return False


def _project_theme_restore_handler_registered() -> bool:
    for handler in getattr(bpy.app.handlers, "load_post", []) or []:
        if getattr(handler, "__name__", "") == "_restore_flowcell_project_theme_on_load":
            return True
    return False


def _write_project_theme_state(context, state):
    scene = _project_scene(context)
    if scene is None:
        raise RuntimeError("No active Blender scene is available for FlowCell project theme state.")
    normalized = _normalize_project_theme_state(
        {
            **(state if isinstance(state, dict) else {}),
            "format": PROJECT_THEME_STATE_FORMAT,
        }
    )
    normalized["updated_at"] = time.time()
    scene[PROJECT_THEME_STATE_KEY] = json.dumps(normalized, sort_keys=True)
    try:
        scene.update_tag()
    except Exception:
        pass
    _ensure_project_theme_restore_handler_registered_from_action()
    return normalized


def _write_theme_state(context, state):
    normalized = _write_project_theme_state(context, state)
    _write_global_theme_state(normalized)
    return normalized


def _project_relative_path(path: str) -> str:
    normalized = str(path or "").strip()
    if not normalized or not getattr(bpy.data, "filepath", ""):
        return ""
    try:
        relative_path = bpy.path.relpath(normalized)
    except Exception:
        return ""
    return relative_path if str(relative_path).startswith("//") else ""


def _set_project_place_picture_state(
    context,
    resolved_path: str,
    grid_spacing_m: float = DEFAULT_PLACE_PICTURE_GRID_SPACING_M,
    grid_distance_m: float = DEFAULT_PLACE_PICTURE_GRID_DISTANCE_M,
    grid_far_spacing_m: float = DEFAULT_PLACE_PICTURE_GRID_FAR_SPACING_M,
):
    state = _read_project_theme_state(context)
    normalized_path = str(resolved_path or "").strip()
    state["place_picture"] = {
        "enabled": bool(normalized_path),
        "path": normalized_path,
        "relative_path": _project_relative_path(normalized_path),
        "grid_spacing_m": float(grid_spacing_m),
        "grid_distance_m": float(grid_distance_m),
        "grid_far_spacing_m": float(grid_far_spacing_m),
    }
    return _write_theme_state(context, state)


def _set_startup_place_picture_state(context, payload):
    resolved_path = _resolve_optional_image_path(
        _read_string(payload, "static_background_path", DEFAULT_STATIC_BACKGROUND_PATH)
    )
    spacing_m, distance_m, far_spacing_m = _read_grid_settings(payload)
    state = _read_global_theme_state()
    state["place_picture"] = {
        "enabled": True,
        "path": resolved_path,
        "relative_path": _project_relative_path(resolved_path),
        "grid_spacing_m": spacing_m,
        "grid_distance_m": distance_m,
        "grid_far_spacing_m": far_spacing_m,
    }
    normalized = _write_global_theme_state(state)
    return _result(
        f"Place Picture startup image saved from {resolved_path}.",
        static_background_path=resolved_path,
        grid_spacing_m=spacing_m,
        grid_distance_m=distance_m,
        grid_far_spacing_m=far_spacing_m,
        **_startup_state_payload(normalized),
    )


def _read_place_picture_runtime_state(context=None):
    state = _overlay_state()
    namespace = bpy.app.driver_namespace
    image = state.get("image")
    runtime_path = str(state.get("path") or "")
    image_path = str(getattr(image, "filepath", "") or "") if image is not None else ""
    return _result(
        "FlowCell Place Picture runtime state read.",
        place_picture_runtime_enabled=bool(state.get("enabled")),
        place_picture_runtime_path=runtime_path,
        place_picture_runtime_image_path=image_path,
        place_picture_runtime_has_background_handler=state.get("background_handler") is not None,
        place_picture_runtime_has_overlay_handler=state.get("overlay_handler") is not None,
        place_picture_runtime_has_view3d=any(True for _ in (_iter_view3d_spaces() or [])),
        grid_spacing_m=float(
            state.get("grid_spacing_m", DEFAULT_PLACE_PICTURE_GRID_SPACING_M)
        ),
        grid_distance_m=float(
            state.get("grid_distance_m", DEFAULT_PLACE_PICTURE_GRID_DISTANCE_M)
        ),
        grid_far_spacing_m=float(
            state.get(
                "grid_far_spacing_m",
                DEFAULT_PLACE_PICTURE_GRID_FAR_SPACING_M,
            )
        ),
        saved_overlay_path=_get_saved_overlay_path(),
        startup_poll_restore_done=bool(namespace.get("flowcell_project_theme_poll_restore_done")),
        startup_poll_restore_attempts=int(namespace.get("flowcell_project_theme_poll_restore_attempts", 0) or 0),
        startup_poll_restore_next_time=float(namespace.get("flowcell_project_theme_poll_restore_next_time", 0.0) or 0.0),
    )


def _project_state_payload(state):
    theme_state = state.get("theme", {}) if isinstance(state, dict) else {}
    place_picture_state = state.get("place_picture", {}) if isinstance(state, dict) else {}
    return {
        "project_state": state,
        "has_project_theme_state": bool(
            isinstance(theme_state, dict) and theme_state.get("enabled")
        ),
        "has_project_place_picture_state": bool(
            isinstance(place_picture_state, dict) and place_picture_state.get("enabled")
        ),
    }


def _startup_state_payload(global_state):
    theme_state = global_state.get("theme", {}) if isinstance(global_state, dict) else {}
    place_picture_state = (
        global_state.get("place_picture", {}) if isinstance(global_state, dict) else {}
    )
    return {
        "startup_state": global_state,
        "startup_state_path": str(_global_theme_state_path()),
        "has_startup_theme_state": bool(
            isinstance(theme_state, dict) and theme_state.get("enabled")
        ),
        "has_startup_place_picture_state": bool(
            isinstance(place_picture_state, dict) and place_picture_state.get("enabled")
        ),
    }


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


def _safe_set(obj, attr, value):
    if obj is None or not hasattr(obj, attr):
        return
    try:
        setattr(obj, attr, value)
    except Exception:
        pass


def _get_current_3d_context():
    region = getattr(bpy.context, "region", None)
    rv3d = getattr(bpy.context, "region_data", None)
    space = getattr(bpy.context, "space_data", None)
    if region is None or rv3d is None or space is None:
        return None, None, None
    if getattr(region, "type", "") != "WINDOW":
        return None, None, None
    if getattr(space, "type", "") != "VIEW_3D":
        return None, None, None
    return region, rv3d, space


def _find_first_3d_view_context():
    window_manager = getattr(bpy.context, "window_manager", None)
    if window_manager is None:
        return None
    for window in window_manager.windows:
        screen = getattr(window, "screen", None)
        if screen is None:
            continue
        for area in screen.areas:
            if area.type != "VIEW_3D":
                continue
            space = area.spaces.active
            if space is None or getattr(space, "type", "") != "VIEW_3D":
                continue
            region = next((item for item in area.regions if item.type == "WINDOW"), None)
            if region is None:
                continue
            return {
                "window": window,
                "screen": screen,
                "area": area,
                "region": region,
                "space_data": space,
                "region_data": space.region_3d,
            }
    return None


def _snapshot_place_picture_viewports():
    snapshots = []
    for space in _iter_view3d_spaces() or []:
        shading = getattr(space, "shading", None)
        overlay = getattr(space, "overlay", None)
        snapshot = {
            "space": space,
            "space_attrs": {},
            "shading": shading,
            "shading_attrs": {},
            "overlay": overlay,
            "overlay_attrs": {},
        }
        for attr in (
            "show_gizmo",
            "show_gizmo_object_translate",
            "show_gizmo_object_rotate",
            "show_gizmo_object_scale",
        ):
            if hasattr(space, attr):
                try:
                    snapshot["space_attrs"][attr] = getattr(space, attr)
                except Exception:
                    pass
        for attr in (
            "type",
            "show_xray",
            "show_xray_wireframe",
            "background_type",
            "use_compositor",
        ):
            if shading is not None and hasattr(shading, attr):
                try:
                    snapshot["shading_attrs"][attr] = getattr(shading, attr)
                except Exception:
                    pass
        for attr in (
            "show_overlays",
            "show_floor",
            "show_axis_x",
            "show_axis_y",
            "show_axis_z",
            "show_extras",
        ):
            if overlay is not None and hasattr(overlay, attr):
                try:
                    snapshot["overlay_attrs"][attr] = getattr(overlay, attr)
                except Exception:
                    pass
        snapshots.append(snapshot)
    return snapshots


def _restore_place_picture_viewports(state):
    for snapshot in state.get("viewport_snapshots", []) or []:
        for attr, value in snapshot.get("space_attrs", {}).items():
            _safe_set(snapshot.get("space"), attr, value)
        for attr, value in snapshot.get("shading_attrs", {}).items():
            _safe_set(snapshot.get("shading"), attr, value)
        for attr, value in snapshot.get("overlay_attrs", {}).items():
            _safe_set(snapshot.get("overlay"), attr, value)


def _apply_place_picture_viewport_settings():
    for space in _iter_view3d_spaces() or []:
        shading = getattr(space, "shading", None)
        overlay = getattr(space, "overlay", None)
        if shading is not None:
            if hasattr(shading, "use_compositor"):
                try:
                    shading.use_compositor = "DISABLED"
                except Exception:
                    _safe_set(shading, "use_compositor", False)
            _safe_set(shading, "type", "SOLID")
            _safe_set(shading, "show_xray", False)
            _safe_set(shading, "show_xray_wireframe", False)
            _safe_set(shading, "background_type", "THEME")
        if overlay is not None:
            _safe_set(overlay, "show_overlays", True)
            _safe_set(overlay, "show_floor", True)
            _safe_set(overlay, "show_axis_x", True)
            _safe_set(overlay, "show_axis_y", True)
            _safe_set(overlay, "show_axis_z", True)
            _safe_set(overlay, "show_extras", True)
        _safe_set(space, "show_gizmo", True)
        if PLACE_PICTURE_HIDE_REAL_BLENDER_TRANSFORM_GIZMOS:
            _safe_set(space, "show_gizmo_object_translate", False)
            _safe_set(space, "show_gizmo_object_rotate", False)
            _safe_set(space, "show_gizmo_object_scale", False)


def _nice_step_from_raw(raw):
    raw = max(float(raw), 0.000001)
    base = 10.0 ** math.floor(math.log10(raw))
    for multiplier in (1.0, 2.0, 5.0, 10.0):
        step = base * multiplier
        if step >= raw:
            return step
    return base * 10.0


def _world_units_per_pixel_at(region, rv3d, depth_location, center_2d):
    try:
        p0 = view3d_utils.region_2d_to_location_3d(
            region, rv3d, (center_2d.x, center_2d.y), depth_location
        )
        p1 = view3d_utils.region_2d_to_location_3d(
            region, rv3d, (center_2d.x + 20.0, center_2d.y), depth_location
        )
        length = (p1 - p0).length / 20.0
        if math.isfinite(length) and length > 0.00000001:
            return length
    except Exception:
        pass
    view_distance = max(float(getattr(rv3d, "view_distance", 10.0)), 0.1)
    return view_distance / max(float(region.width), 1.0)


def _draw_2d_lines(shader, points, color, width):
    if not points or len(points) < 2:
        return
    batch = batch_for_shader(
        shader,
        "LINES",
        {"pos": [(float(point.x), float(point.y), 0.0) for point in points]},
    )
    try:
        gpu.state.line_width_set(width)
    except Exception:
        pass
    shader.bind()
    shader.uniform_float("color", color)
    batch.draw(shader)
    try:
        gpu.state.line_width_set(1.0)
    except Exception:
        pass


def _draw_2d_triangles(shader, points, color):
    if not points or len(points) < 3:
        return
    batch = batch_for_shader(
        shader,
        "TRIS",
        {"pos": [(float(point.x), float(point.y), 0.0) for point in points]},
    )
    shader.bind()
    shader.uniform_float("color", color)
    batch.draw(shader)


def _make_circle_triangles(center, radius, segments=28):
    triangles = []
    for index in range(segments):
        angle_a = (index / segments) * math.tau
        angle_b = ((index + 1) / segments) * math.tau
        triangles.extend(
            (
                center,
                center + Vector((math.cos(angle_a) * radius, math.sin(angle_a) * radius)),
                center + Vector((math.cos(angle_b) * radius, math.sin(angle_b) * radius)),
            )
        )
    return triangles


def _make_square_triangles(center, size):
    half = size * 0.5
    p0 = center + Vector((-half, -half))
    p1 = center + Vector((half, -half))
    p2 = center + Vector((half, half))
    p3 = center + Vector((-half, half))
    return [p0, p1, p2, p0, p2, p3]


def _make_quad_triangles(quad):
    return [quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]]


def _make_circle_lines(center, radius, segments=96):
    points = []
    previous = None
    for index in range(segments + 1):
        angle = (index / segments) * math.tau
        point = center + Vector((math.cos(angle) * radius, math.sin(angle) * radius))
        if previous is not None:
            points.extend((previous, point))
        previous = point
    return points


def _make_arrowhead(tip, direction, size):
    if direction.length <= 0.0001:
        return []
    normalized = direction.normalized()
    perpendicular = Vector((-normalized.y, normalized.x))
    base = tip - normalized * size
    return [tip, base + perpendicular * (size * 0.55), base - perpendicular * (size * 0.55)]


def _distance_to_segment_2d(point, start, end):
    segment = end - start
    denominator = segment.length_squared
    if denominator <= 0.000001:
        return (point - start).length
    t = max(0.0, min(1.0, (point - start).dot(segment) / denominator))
    return (point - (start + segment * t)).length


def _reject_far_offscreen_line(p0, p1, width, height):
    margin = max(width, height) * 4.0
    return (
        (p0.x < -margin and p1.x < -margin)
        or (p0.x > width + margin and p1.x > width + margin)
        or (p0.y < -margin and p1.y < -margin)
        or (p0.y > height + margin and p1.y > height + margin)
    )


def _line_overlaps_viewport(p0, p1, width, height, margin=12.0):
    return (
        max(p0.x, p1.x) >= -margin
        and min(p0.x, p1.x) <= width + margin
        and max(p0.y, p1.y) >= -margin
        and min(p0.y, p1.y) <= height + margin
    )


def _point_in_convex_quad(point, quad):
    sign = None
    for index in range(4):
        a = quad[index]
        b = quad[(index + 1) % 4]
        cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
        if abs(cross) <= 0.000001:
            continue
        current = cross > 0.0
        if sign is None:
            sign = current
        elif sign != current:
            return False
    return True


def _distance_to_quad_edges(point, quad):
    return min(_distance_to_segment_2d(point, quad[i], quad[(i + 1) % 4]) for i in range(4))


def _make_plane_handle_quad(origin_2d, dir_a, dir_b, offset, size):
    if dir_a is None or dir_b is None or dir_a.length <= 0.001 or dir_b.length <= 0.001:
        return None
    axis_a = dir_a.normalized()
    axis_b = dir_b.normalized()
    center = origin_2d + axis_a * offset + axis_b * offset
    half = size * 0.5
    return [
        center - axis_a * half - axis_b * half,
        center + axis_a * half - axis_b * half,
        center + axis_a * half + axis_b * half,
        center - axis_a * half + axis_b * half,
    ]


def _get_active_tool_kind():
    try:
        tool = bpy.context.workspace.tools.from_space_type(
            "VIEW_3D", mode=bpy.context.mode, create=False
        )
        if tool is None:
            return "NONE"
        idname = str(tool.idname).lower()
        if "transform" in idname:
            return "ALL"
        if "rotate" in idname:
            return "ROTATE"
        if "scale" in idname:
            return "SCALE"
        if "move" in idname or "translate" in idname:
            return "MOVE"
    except Exception:
        pass
    return "NONE"


def _should_draw_gizmo_kind(kind):
    if not PLACE_PICTURE_ENABLE_FAKE_GIZMOS:
        return False
    mode = PLACE_PICTURE_GIZMO_DISPLAY_MODE.upper().strip()
    kind = kind.upper().strip()
    if mode == "ALL":
        return True
    if mode == "ACTIVE_TOOL":
        active_kind = _get_active_tool_kind()
        if active_kind == "ALL":
            return PLACE_PICTURE_ENABLE_COMBINED_TRANSFORM_GIZMO
        return active_kind == kind
    return mode == kind


def _get_active_gizmo_object():
    obj = bpy.context.view_layer.objects.active
    if obj is None:
        selected = list(getattr(bpy.context, "selected_objects", []) or [])
        if selected:
            obj = selected[0]
    if obj is None:
        return None
    if PLACE_PICTURE_ONLY_DRAW_GIZMOS_FOR_SELECTED_OBJECT:
        try:
            if not obj.select_get():
                return None
        except Exception:
            return None
    return obj


def _get_transform_objects():
    selected = list(getattr(bpy.context, "selected_objects", []) or [])
    if not selected:
        obj = _get_active_gizmo_object()
        if obj is not None:
            selected = [obj]
    usable = []
    for obj in selected:
        if obj is None or getattr(obj, "type", None) is None:
            continue
        try:
            if obj.hide_viewport:
                continue
        except Exception:
            pass
        usable.append(obj)
    return usable


def _get_axis_vectors(obj):
    if PLACE_PICTURE_GIZMO_ORIENTATION.upper().strip() == "LOCAL" and obj is not None:
        matrix = obj.matrix_world.to_3x3()
        return [
            (matrix @ Vector((1.0, 0.0, 0.0))).normalized(),
            (matrix @ Vector((0.0, 1.0, 0.0))).normalized(),
            (matrix @ Vector((0.0, 0.0, 1.0))).normalized(),
        ]
    return [
        Vector((1.0, 0.0, 0.0)),
        Vector((0.0, 1.0, 0.0)),
        Vector((0.0, 0.0, 1.0)),
    ]


def _get_plane_specs(axes):
    return [
        {"label": "XY", "axis_indices": (0, 1), "axes": (axes[0], axes[1]), "normal": axes[2], "color": (1.0, 0.88, 0.05, 1.0)},
        {"label": "XZ", "axis_indices": (0, 2), "axes": (axes[0], axes[2]), "normal": axes[1], "color": (1.0, 0.10, 0.95, 1.0)},
        {"label": "YZ", "axis_indices": (1, 2), "axes": (axes[1], axes[2]), "normal": axes[0], "color": (0.10, 0.95, 1.0, 1.0)},
    ]


def _project_world_point(region, rv3d, world_point):
    try:
        projected = view3d_utils.location_3d_to_region_2d(region, rv3d, world_point)
    except Exception:
        return None
    return None if projected is None else Vector((projected.x, projected.y))


def _projected_axis_direction(region, rv3d, origin, axis, center_2d):
    axis = axis.normalized()
    test_length = max(float(getattr(rv3d, "view_distance", 10.0)), 0.1) * 0.25
    projected = view3d_utils.location_3d_to_region_2d(region, rv3d, origin + axis * test_length)
    if projected is None:
        return None
    direction = Vector((projected.x - center_2d.x, projected.y - center_2d.y))
    if direction.length < 2.0:
        return None
    return direction.normalized()


def _axis_plane_basis(axis):
    normal = axis.normalized()
    temp = Vector((0.0, 0.0, 1.0)) if abs(normal.dot(Vector((0.0, 0.0, 1.0)))) < 0.92 else Vector((0.0, 1.0, 0.0))
    u = normal.cross(temp).normalized()
    v = normal.cross(u).normalized()
    return u, v


def _ray_from_mouse(region, rv3d, mouse):
    try:
        origin = view3d_utils.region_2d_to_origin_3d(region, rv3d, (mouse.x, mouse.y))
        direction = view3d_utils.region_2d_to_vector_3d(region, rv3d, (mouse.x, mouse.y)).normalized()
        return origin, direction
    except Exception:
        return None, None


def _ray_plane_intersection(region, rv3d, mouse, plane_point, plane_normal):
    origin, direction = _ray_from_mouse(region, rv3d, mouse)
    if origin is None or direction is None:
        return None
    normal = plane_normal.normalized()
    denominator = direction.dot(normal)
    if abs(denominator) < 0.000001:
        return None
    t = (plane_point - origin).dot(normal) / denominator
    if not math.isfinite(t):
        return None
    return origin + direction * t


def _screen_view_axis(rv3d):
    try:
        return (rv3d.view_rotation @ Vector((0.0, 0.0, 1.0))).normalized()
    except Exception:
        return Vector((0.0, 0.0, 1.0))


def _xy_grid_grazing_factor(rv3d) -> float:
    try:
        axis = _screen_view_axis(rv3d)
        return max(0.0, min(1.0, 1.0 - min(abs(float(axis.z)), 1.0)))
    except Exception:
        return 0.0


def _ray_hit_xy_plane(region, rv3d, coord):
    try:
        origin = view3d_utils.region_2d_to_origin_3d(region, rv3d, coord)
        direction = view3d_utils.region_2d_to_vector_3d(region, rv3d, coord).normalized()
    except Exception:
        return None
    if abs(direction.z) < 0.0000001:
        return None
    t = -origin.z / direction.z
    if t < 0.0:
        return None
    point = origin + direction * t
    if not all(math.isfinite(value) for value in (point.x, point.y, point.z)):
        return None
    return point


def _get_visible_xy_grid_bounds(region, rv3d):
    width = float(region.width)
    height = float(region.height)
    grazing = _xy_grid_grazing_factor(rv3d)
    # A light, fixed probe set is enough now that grid lines are clipped to the
    # camera plane in 3D; dense screen sampling is no longer needed for speed.
    samples = (
        (0.0, 0.0), (width, 0.0), (0.0, height), (width, height),
        (width * 0.5, height * 0.5),
        (width * 0.5, 0.0), (width * 0.5, height),
        (0.0, height * 0.5), (width, height * 0.5),
        (width * 0.25, height * 0.25), (width * 0.75, height * 0.25),
        (width * 0.25, height * 0.75), (width * 0.75, height * 0.75),
    )
    hits = [hit for hit in (_ray_hit_xy_plane(region, rv3d, coord) for coord in samples) if hit is not None]
    center = getattr(rv3d, "view_location", Vector((0.0, 0.0, 0.0)))
    try:
        view_distance = max(float(getattr(rv3d, "view_distance", 10.0) or 10.0), 0.1)
    except Exception:
        view_distance = 10.0
    # Cap how far the grid is generated. A grazing/horizon view sees an
    # effectively infinite plane; without this cap the line count explodes and
    # the viewport stalls. The cap scales with zoom so it still reaches far when
    # you scroll back to frame large parts.
    max_radius = view_distance * (14.0 + grazing * 46.0)
    if len(hits) >= 2:
        center_x = float(center.x)
        center_y = float(center.y)
        min_x = max(min(point.x for point in hits), center_x - max_radius)
        max_x = min(max(point.x for point in hits), center_x + max_radius)
        min_y = max(min(point.y for point in hits), center_y - max_radius)
        max_y = min(max(point.y for point in hits), center_y + max_radius)
        extent = max(max_x - min_x, max_y - min_y)
        if extent > 0.000001 and math.isfinite(extent) and max_x > min_x and max_y > min_y:
            step = _nice_step_from_raw(extent / PLACE_PICTURE_TARGET_GRID_LINES)
            pad = step * 2.0
            return min_x - pad, max_x + pad, min_y - pad, max_y + pad, step
    half = max_radius
    step = _nice_step_from_raw(view_distance / 8.0)
    return center.x - half, center.x + half, center.y - half, center.y + half, step


def _make_screen_projector(region, rv3d):
    # Fetch the world->clip matrix once per frame. location_3d_to_region_2d does
    # this work internally on every single call, which is far too slow for a grid
    # of hundreds of lines redrawn continuously while dragging the view. Reusing
    # one matrix lets us project and near-clip every line with C-level math.
    try:
        perspective_matrix = rv3d.perspective_matrix.copy()
    except Exception:
        return None
    return (
        perspective_matrix,
        float(region.width) * 0.5,
        float(region.height) * 0.5,
        float(region.width),
        float(region.height),
    )


def _append_projected_line(bucket, proj, p0, p1):
    if proj is None:
        return False
    perspective_matrix, half_w, half_h, width, height = proj
    try:
        a = perspective_matrix @ Vector((p0[0], p0[1], p0[2], 1.0))
        b = perspective_matrix @ Vector((p1[0], p1[1], p1[2], 1.0))
    except Exception:
        return False
    eps = 0.00001
    a_in = a.w > eps
    b_in = b.w > eps
    if not a_in and not b_in:
        return False
    if not (a_in and b_in):
        # Clip against the near plane (w == eps) in homogeneous clip space. The
        # divide is linear there, so a 4D lerp yields the exact crossing point.
        denominator = a.w - b.w
        if abs(denominator) < 1e-12:
            return False
        t = (a.w - eps) / denominator
        if a_in:
            b = a.lerp(b, t)
        else:
            a = a.lerp(b, t)
    aw = a.w
    bw = b.w
    if aw == 0.0 or bw == 0.0:
        return False
    sx0 = half_w + half_w * (a.x / aw)
    sy0 = half_h + half_h * (a.y / aw)
    sx1 = half_w + half_w * (b.x / bw)
    sy1 = half_h + half_h * (b.y / bw)
    if (
        (sx0 < -12.0 and sx1 < -12.0)
        or (sx0 > width + 12.0 and sx1 > width + 12.0)
        or (sy0 < -12.0 and sy1 < -12.0)
        or (sy0 > height + 12.0 and sy1 > height + 12.0)
    ):
        return False
    bucket.append(Vector((sx0, sy0)))
    bucket.append(Vector((sx1, sy1)))
    return True


def _grid_spacing_for_view(rv3d, bounds=None) -> float:
    # Keep the threshold literal: only the view/camera distance from world origin
    # decides near versus far spacing. The optional bounds argument is accepted
    # for older callers but must not affect grid size.
    state = _overlay_state()
    namespace = bpy.app.driver_namespace
    near_spacing_m = float(
        state.get(
            "grid_spacing_m",
            namespace.get(
                PLACE_PICTURE_GRID_SPACING_KEY,
                DEFAULT_PLACE_PICTURE_GRID_SPACING_M,
            ),
        )
    )
    distance_m = float(
        state.get(
            "grid_distance_m",
            namespace.get(
                PLACE_PICTURE_GRID_DISTANCE_KEY,
                DEFAULT_PLACE_PICTURE_GRID_DISTANCE_M,
            ),
        )
    )
    far_spacing_m = float(
        state.get(
            "grid_far_spacing_m",
            namespace.get(
                PLACE_PICTURE_GRID_FAR_SPACING_KEY,
                DEFAULT_PLACE_PICTURE_GRID_FAR_SPACING_M,
            ),
        )
    )
    try:
        view_position = rv3d.view_matrix.inverted().translation
        distance_from_origin = view_position.length
    except Exception:
        distance_from_origin = max(
            float(getattr(rv3d, "view_distance", 0.0) or 0.0),
            0.0,
        )
    threshold = _grid_spacing_blender_units(distance_m)
    return far_spacing_m if distance_from_origin > threshold else near_spacing_m


def _project_world_axis_to_viewport(region, rv3d, axis):
    origin_2d = _project_world_point(region, rv3d, Vector((0.0, 0.0, 0.0)))
    if origin_2d is None:
        return None

    test_length = max(float(getattr(rv3d, "view_distance", 10.0)), 1.0) * 8.0
    directions = []
    for sign in (-1.0, 1.0):
        projected = _project_world_point(
            region,
            rv3d,
            Vector((0.0, 0.0, 0.0)) + axis * test_length * sign,
        )
        if projected is None:
            continue
        direction = projected - origin_2d
        if direction.length > 0.001:
            directions.append(direction.normalized())

    if not directions:
        return None
    direction = directions[0]
    width = float(region.width)
    height = float(region.height)
    intersections = []
    if abs(direction.x) > 0.000001:
        for x in (0.0, width):
            t = (x - origin_2d.x) / direction.x
            y = origin_2d.y + direction.y * t
            if -0.5 <= y <= height + 0.5:
                intersections.append(Vector((x, min(max(y, 0.0), height))))
    if abs(direction.y) > 0.000001:
        for y in (0.0, height):
            t = (y - origin_2d.y) / direction.y
            x = origin_2d.x + direction.x * t
            if -0.5 <= x <= width + 0.5:
                intersections.append(Vector((min(max(x, 0.0), width), y)))

    unique = []
    for point in intersections:
        if not any((point - existing).length < 0.5 for existing in unique):
            unique.append(point)
    if len(unique) < 2:
        return None

    best_pair = None
    best_distance = -1.0
    for first_index in range(len(unique)):
        for second_index in range(first_index + 1, len(unique)):
            distance = (unique[first_index] - unique[second_index]).length_squared
            if distance > best_distance:
                best_distance = distance
                best_pair = (unique[first_index], unique[second_index])
    return best_pair


def _draw_screen_grid_fallback(shader, region):
    width = float(region.width)
    height = float(region.height)
    if width <= 2.0 or height <= 2.0:
        return
    step = max(min(width, height) / 14.0, 16.0)
    minor = []
    major = []
    center_x = width * 0.5
    center_y = height * 0.5
    x = center_x
    index = 0
    while x <= width:
        (major if index % 5 == 0 else minor).extend((Vector((x, 0.0)), Vector((x, height))))
        x += step
        index += 1
    x = center_x - step
    index = 1
    while x >= 0.0:
        (major if index % 5 == 0 else minor).extend((Vector((x, 0.0)), Vector((x, height))))
        x -= step
        index += 1
    y = center_y
    index = 0
    while y <= height:
        (major if index % 5 == 0 else minor).extend((Vector((0.0, y)), Vector((width, y))))
        y += step
        index += 1
    y = center_y - step
    index = 1
    while y >= 0.0:
        (major if index % 5 == 0 else minor).extend((Vector((0.0, y)), Vector((width, y))))
        y -= step
        index += 1
    _draw_2d_lines(shader, minor, (0.55, 0.55, 0.55, PLACE_PICTURE_GRID_ALPHA * 0.75), PLACE_PICTURE_GRID_MINOR_WIDTH)
    _draw_2d_lines(shader, major, (0.68, 0.68, 0.68, PLACE_PICTURE_GRID_MAJOR_ALPHA * 0.75), PLACE_PICTURE_GRID_MAJOR_WIDTH)
    _draw_2d_lines(shader, [Vector((0.0, center_y)), Vector((width, center_y))], (1.0, 0.05, 0.035, PLACE_PICTURE_AXIS_ALPHA * 0.75), PLACE_PICTURE_AXIS_WIDTH)
    _draw_2d_lines(shader, [Vector((center_x, 0.0)), Vector((center_x, height))], (0.05, 0.95, 0.08, PLACE_PICTURE_AXIS_ALPHA * 0.75), PLACE_PICTURE_AXIS_WIDTH)


def _draw_fake_grid_2d(shader, region, rv3d):
    if not PLACE_PICTURE_ENABLE_FAKE_GRID:
        return
    # Adaptive spacing: the grid step follows the zoom so the on-screen line
    # count stays bounded -- and the draw stays fast -- at every distance. The
    # cell refines as you zoom in, down to a 1 mm floor, then coarsens in nice
    # metric steps as you pull back. It never tries to tile a fixed tiny spacing
    # across a huge area, which is what used to stall the viewport.
    min_x, max_x, min_y, max_y, step = _get_visible_xy_grid_bounds(region, rv3d)
    if not (step > 0.0) or not math.isfinite(step):
        return
    min_step = _grid_spacing_blender_units(PLACE_PICTURE_MIN_GRID_SPACING_M)
    if step < min_step:
        step = min_step
    line_count_x = abs((max_x - min_x) / step)
    line_count_y = abs((max_y - min_y) / step)
    while (
        line_count_x > PLACE_PICTURE_MAX_GRID_LINES_PER_AXIS
        or line_count_y > PLACE_PICTURE_MAX_GRID_LINES_PER_AXIS
    ):
        step = _nice_step_from_raw(step * 2.1)
        line_count_x = abs((max_x - min_x) / step)
        line_count_y = abs((max_y - min_y) / step)
    start_x = math.floor(min_x / step) * step
    end_x = math.ceil(max_x / step) * step
    start_y = math.floor(min_y / step) * step
    end_y = math.ceil(max_y / step) * step
    eps = step * 0.0001
    minor = []
    major = []
    x_axis = []
    y_axis = []
    projected_count = 0
    proj = _make_screen_projector(region, rv3d)
    for index in range(int(max(0, round((end_x - start_x) / step))) + 1):
        x = start_x + index * step
        if abs(x) < eps:
            projected_count += int(_append_projected_line(y_axis, proj, (0.0, start_y, 0.0), (0.0, end_y, 0.0)))
            continue
        bucket = major if int(round(x / step)) % 10 == 0 else minor
        projected_count += int(_append_projected_line(bucket, proj, (x, start_y, 0.0), (x, end_y, 0.0)))
    for index in range(int(max(0, round((end_y - start_y) / step))) + 1):
        y = start_y + index * step
        if abs(y) < eps:
            projected_count += int(_append_projected_line(x_axis, proj, (start_x, 0.0, 0.0), (end_x, 0.0, 0.0)))
            continue
        bucket = major if int(round(y / step)) % 10 == 0 else minor
        projected_count += int(_append_projected_line(bucket, proj, (start_x, y, 0.0), (end_x, y, 0.0)))
    projected_x_axis = _project_world_axis_to_viewport(
        region, rv3d, Vector((1.0, 0.0, 0.0))
    )
    projected_y_axis = _project_world_axis_to_viewport(
        region, rv3d, Vector((0.0, 1.0, 0.0))
    )
    if projected_x_axis is not None:
        x_axis = list(projected_x_axis)
    if projected_y_axis is not None:
        y_axis = list(projected_y_axis)

    if projected_count <= 0:
        return
    grazing = _xy_grid_grazing_factor(rv3d)
    grid_shadow_alpha = 0.25 + grazing * 0.22
    minor_alpha = min(0.82, PLACE_PICTURE_GRID_ALPHA * (1.0 + grazing * 0.9))
    major_alpha = min(0.95, PLACE_PICTURE_GRID_MAJOR_ALPHA * (1.0 + grazing * 0.7))
    minor_width = PLACE_PICTURE_GRID_MINOR_WIDTH + grazing * 0.55
    major_width = PLACE_PICTURE_GRID_MAJOR_WIDTH + grazing * 0.75
    _draw_2d_lines(shader, minor, (0.0, 0.0, 0.0, minor_alpha * grid_shadow_alpha), minor_width + 1.8)
    _draw_2d_lines(shader, major, (0.0, 0.0, 0.0, major_alpha * grid_shadow_alpha), major_width + 1.8)
    _draw_2d_lines(shader, minor, (0.55, 0.55, 0.55, minor_alpha), minor_width)
    _draw_2d_lines(shader, major, (0.68, 0.68, 0.68, major_alpha), major_width)
    _draw_2d_lines(shader, x_axis, (0.0, 0.0, 0.0, PLACE_PICTURE_AXIS_ALPHA * 0.28), PLACE_PICTURE_AXIS_WIDTH + 2.0)
    _draw_2d_lines(shader, y_axis, (0.0, 0.0, 0.0, PLACE_PICTURE_AXIS_ALPHA * 0.28), PLACE_PICTURE_AXIS_WIDTH + 2.0)
    _draw_2d_lines(shader, x_axis, (1.0, 0.05, 0.035, PLACE_PICTURE_AXIS_ALPHA), PLACE_PICTURE_AXIS_WIDTH)
    _draw_2d_lines(shader, y_axis, (0.05, 0.95, 0.08, PLACE_PICTURE_AXIS_ALPHA), PLACE_PICTURE_AXIS_WIDTH)


def _make_rotate_ring_segments(region, rv3d, origin, axis, radius_world):
    axis = axis.normalized()
    u, v = _axis_plane_basis(axis)
    segments = []
    previous_2d = None
    for index in range(PLACE_PICTURE_ROTATE_SEGMENTS + 1):
        angle = (index / PLACE_PICTURE_ROTATE_SEGMENTS) * math.tau
        world_point = origin + (u * math.cos(angle) + v * math.sin(angle)) * radius_world
        p2d = _project_world_point(region, rv3d, world_point)
        if p2d is not None and previous_2d is not None:
            if not _reject_far_offscreen_line(previous_2d, p2d, float(region.width), float(region.height)):
                segments.extend((previous_2d, p2d))
        previous_2d = p2d
    return segments


def _axis_colors():
    return [(1.0, 0.05, 0.035, 1.0), (0.05, 0.95, 0.08, 1.0), (0.20, 0.45, 1.0, 1.0)]


def _get_axis_screen_dirs(region, rv3d, origin, origin_2d, axes):
    return [_projected_axis_direction(region, rv3d, origin, axis, origin_2d) for axis in axes]


def _current_move_length():
    return PLACE_PICTURE_COMBINED_MOVE_PIXEL_LENGTH if _get_active_tool_kind() == "ALL" else PLACE_PICTURE_MOVE_PIXEL_LENGTH


def _current_scale_length():
    return PLACE_PICTURE_COMBINED_SCALE_PIXEL_LENGTH if _get_active_tool_kind() == "ALL" else PLACE_PICTURE_SCALE_PIXEL_LENGTH


def _current_rotate_radius():
    return PLACE_PICTURE_COMBINED_ROTATE_PIXEL_RADIUS if _get_active_tool_kind() == "ALL" else PLACE_PICTURE_ROTATE_PIXEL_RADIUS


def _current_free_rotate_radius():
    return PLACE_PICTURE_COMBINED_FREE_ROTATE_PIXEL_RADIUS if _get_active_tool_kind() == "ALL" else PLACE_PICTURE_FREE_ROTATE_PIXEL_RADIUS


def _draw_plane_handle(shader, quad, color, fill_alpha, edge_width):
    if quad is None:
        return
    _draw_2d_triangles(shader, _make_quad_triangles(quad), (0.0, 0.0, 0.0, 0.46))
    center = Vector((0.0, 0.0))
    for point in quad:
        center += point
    center /= 4.0
    inner = [center + (point - center) * 0.90 for point in quad]
    _draw_2d_triangles(shader, _make_quad_triangles(inner), (color[0], color[1], color[2], fill_alpha))
    outline = []
    for index in range(4):
        outline.extend((quad[index], quad[(index + 1) % 4]))
    _draw_2d_lines(shader, outline, (color[0], color[1], color[2], PLACE_PICTURE_PLANE_EDGE_ALPHA), edge_width)


def _draw_fake_move_gizmo_2d(shader, region, rv3d, obj, origin_2d, axes):
    if not (PLACE_PICTURE_ENABLE_MOVE_GIZMO and PLACE_PICTURE_ENABLE_MOVE_AXIS_HANDLES and _should_draw_gizmo_kind("MOVE")):
        return
    origin = obj.matrix_world.translation.copy()
    dirs = _get_axis_screen_dirs(region, rv3d, origin, origin_2d, axes)
    colors = _axis_colors()
    _draw_2d_triangles(shader, _make_circle_triangles(origin_2d, PLACE_PICTURE_MOVE_CENTER_DOT_SIZE + 3), (0.0, 0.0, 0.0, 0.72))
    _draw_2d_triangles(shader, _make_circle_triangles(origin_2d, PLACE_PICTURE_MOVE_CENTER_DOT_SIZE), (1.0, 1.0, 1.0, 0.95))
    for axis_index, direction in enumerate(dirs):
        if direction is None:
            continue
        tip = origin_2d + direction * _current_move_length()
        line_end = tip - direction * (PLACE_PICTURE_MOVE_ARROW_SIZE * 0.45)
        _draw_2d_lines(shader, [origin_2d, line_end], (0.0, 0.0, 0.0, 0.72), PLACE_PICTURE_MOVE_LINE_WIDTH + 3.0)
        _draw_2d_lines(shader, [origin_2d, line_end], colors[axis_index], PLACE_PICTURE_MOVE_LINE_WIDTH)
        _draw_2d_triangles(shader, _make_arrowhead(tip, direction, PLACE_PICTURE_MOVE_ARROW_SIZE + 4), (0.0, 0.0, 0.0, 0.72))
        _draw_2d_triangles(shader, _make_arrowhead(tip, direction, PLACE_PICTURE_MOVE_ARROW_SIZE), colors[axis_index])


def _draw_fake_move_plane_handles_2d(shader, region, rv3d, obj, origin_2d, axes):
    if not (PLACE_PICTURE_ENABLE_MOVE_GIZMO and PLACE_PICTURE_ENABLE_MOVE_PLANE_HANDLES and _should_draw_gizmo_kind("MOVE")):
        return
    origin = obj.matrix_world.translation.copy()
    dirs = _get_axis_screen_dirs(region, rv3d, origin, origin_2d, axes)
    for spec in _get_plane_specs(axes):
        ia, ib = spec["axis_indices"]
        _draw_plane_handle(
            shader,
            _make_plane_handle_quad(origin_2d, dirs[ia], dirs[ib], PLACE_PICTURE_PLANE_HANDLE_OFFSET, PLACE_PICTURE_PLANE_HANDLE_SIZE),
            spec["color"],
            PLACE_PICTURE_PLANE_FILL_ALPHA,
            1.6,
        )


def _draw_fake_scale_gizmo_2d(shader, region, rv3d, obj, origin_2d, axes):
    if not (PLACE_PICTURE_ENABLE_SCALE_GIZMO and PLACE_PICTURE_ENABLE_SCALE_AXIS_HANDLES and _should_draw_gizmo_kind("SCALE")):
        return
    origin = obj.matrix_world.translation.copy()
    dirs = _get_axis_screen_dirs(region, rv3d, origin, origin_2d, axes)
    colors = _axis_colors()
    if PLACE_PICTURE_ENABLE_UNIFORM_SCALE_HANDLE:
        _draw_2d_triangles(shader, _make_square_triangles(origin_2d, PLACE_PICTURE_SCALE_CENTER_BOX_SIZE + 5), (0.0, 0.0, 0.0, 0.70))
        _draw_2d_triangles(shader, _make_square_triangles(origin_2d, PLACE_PICTURE_SCALE_CENTER_BOX_SIZE), (1.0, 1.0, 1.0, 0.90))
    for axis_index, direction in enumerate(dirs):
        if direction is None:
            continue
        tip = origin_2d + direction * _current_scale_length()
        line_end = tip - direction * (PLACE_PICTURE_SCALE_BOX_SIZE * 0.25)
        _draw_2d_lines(shader, [origin_2d, line_end], (0.0, 0.0, 0.0, 0.72), PLACE_PICTURE_SCALE_LINE_WIDTH + 3.0)
        _draw_2d_lines(shader, [origin_2d, line_end], colors[axis_index], PLACE_PICTURE_SCALE_LINE_WIDTH)
        _draw_2d_triangles(shader, _make_square_triangles(tip, PLACE_PICTURE_SCALE_BOX_SIZE + 5), (0.0, 0.0, 0.0, 0.72))
        _draw_2d_triangles(shader, _make_square_triangles(tip, PLACE_PICTURE_SCALE_BOX_SIZE), colors[axis_index])


def _draw_fake_scale_plane_handles_2d(shader, region, rv3d, obj, origin_2d, axes):
    if not (PLACE_PICTURE_ENABLE_SCALE_GIZMO and PLACE_PICTURE_ENABLE_SCALE_PLANE_HANDLES and _should_draw_gizmo_kind("SCALE")):
        return
    origin = obj.matrix_world.translation.copy()
    dirs = _get_axis_screen_dirs(region, rv3d, origin, origin_2d, axes)
    for spec in _get_plane_specs(axes):
        ia, ib = spec["axis_indices"]
        _draw_plane_handle(
            shader,
            _make_plane_handle_quad(origin_2d, dirs[ia], dirs[ib], PLACE_PICTURE_PLANE_HANDLE_OFFSET + 10.0, max(PLACE_PICTURE_PLANE_HANDLE_SIZE - 3.0, 8.0)),
            spec["color"],
            max(0.25, PLACE_PICTURE_PLANE_FILL_ALPHA * 0.70),
            2.4,
        )


def _draw_fake_rotate_gizmo_2d(shader, region, rv3d, obj, origin_2d, axes):
    if not (PLACE_PICTURE_ENABLE_ROTATE_GIZMO and PLACE_PICTURE_ENABLE_ROTATE_AXIS_RINGS and _should_draw_gizmo_kind("ROTATE")):
        return
    origin = obj.matrix_world.translation.copy()
    radius_world = _world_units_per_pixel_at(region, rv3d, origin, origin_2d) * _current_rotate_radius()
    if not math.isfinite(radius_world) or radius_world <= 0.0:
        return
    colors = _axis_colors()
    for axis_index, axis in enumerate(axes):
        ring_segments = _make_rotate_ring_segments(region, rv3d, origin, axis, radius_world)
        if not ring_segments:
            continue
        _draw_2d_lines(shader, ring_segments, (0.0, 0.0, 0.0, 0.72), PLACE_PICTURE_ROTATE_LINE_WIDTH + 3.0)
        _draw_2d_lines(shader, ring_segments, colors[axis_index], PLACE_PICTURE_ROTATE_LINE_WIDTH)


def _draw_free_rotate_ring_2d(shader, obj, origin_2d):
    if not (PLACE_PICTURE_ENABLE_ROTATE_GIZMO and PLACE_PICTURE_ENABLE_FREE_ROTATE_RING and _should_draw_gizmo_kind("ROTATE")):
        return
    ring = _make_circle_lines(origin_2d, _current_free_rotate_radius(), segments=PLACE_PICTURE_ROTATE_SEGMENTS)
    _draw_2d_lines(shader, ring, (0.0, 0.0, 0.0, 0.68), PLACE_PICTURE_FREE_ROTATE_LINE_WIDTH + 3.0)
    _draw_2d_lines(shader, ring, (1.0, 1.0, 1.0, 0.88), PLACE_PICTURE_FREE_ROTATE_LINE_WIDTH)


def _draw_fake_gizmos_2d(shader, region, rv3d):
    if not PLACE_PICTURE_ENABLE_FAKE_GIZMOS:
        return
    obj = _get_active_gizmo_object()
    if obj is None:
        return
    origin = obj.matrix_world.translation.copy()
    origin_2d = _project_world_point(region, rv3d, origin)
    if origin_2d is None:
        return
    axes = _get_axis_vectors(obj)
    _draw_fake_rotate_gizmo_2d(shader, region, rv3d, obj, origin_2d, axes)
    _draw_free_rotate_ring_2d(shader, obj, origin_2d)
    _draw_fake_scale_gizmo_2d(shader, region, rv3d, obj, origin_2d, axes)
    _draw_fake_scale_plane_handles_2d(shader, region, rv3d, obj, origin_2d, axes)
    _draw_fake_move_gizmo_2d(shader, region, rv3d, obj, origin_2d, axes)
    _draw_fake_move_plane_handles_2d(shader, region, rv3d, obj, origin_2d, axes)


def _hit_quad_handle(mouse, quad):
    if quad is None:
        return None
    distance = 0.0 if _point_in_convex_quad(mouse, quad) else _distance_to_quad_edges(mouse, quad)
    return distance if distance <= PLACE_PICTURE_PLANE_HIT_RADIUS else None


def _hit_test_move(region, rv3d, obj, mouse):
    if not (PLACE_PICTURE_ENABLE_MOVE_GIZMO and _should_draw_gizmo_kind("MOVE")):
        return None
    origin = obj.matrix_world.translation.copy()
    origin_2d = _project_world_point(region, rv3d, origin)
    if origin_2d is None:
        return None
    axes = _get_axis_vectors(obj)
    dirs = _get_axis_screen_dirs(region, rv3d, origin, origin_2d, axes)
    best = None
    if PLACE_PICTURE_ENABLE_MOVE_AXIS_HANDLES:
        for axis_index, direction in enumerate(dirs):
            if direction is None:
                continue
            tip = origin_2d + direction * _current_move_length()
            line_end = tip - direction * (PLACE_PICTURE_MOVE_ARROW_SIZE * 0.45)
            distance = min(_distance_to_segment_2d(mouse, origin_2d, line_end), (mouse - tip).length)
            if distance <= PLACE_PICTURE_MOVE_HIT_RADIUS and (best is None or distance < best["distance"]):
                best = {"kind": "MOVE", "axis_index": axis_index, "axis": axes[axis_index].normalized(), "screen_dir": direction.normalized(), "distance": distance, "origin": origin, "origin_2d": origin_2d}
    if PLACE_PICTURE_ENABLE_MOVE_PLANE_HANDLES:
        for spec in _get_plane_specs(axes):
            ia, ib = spec["axis_indices"]
            distance = _hit_quad_handle(mouse, _make_plane_handle_quad(origin_2d, dirs[ia], dirs[ib], PLACE_PICTURE_PLANE_HANDLE_OFFSET, PLACE_PICTURE_PLANE_HANDLE_SIZE))
            if distance is not None and (best is None or distance < best["distance"]):
                best = {
                    "kind": "MOVE_PLANE",
                    "plane": spec["label"],
                    "plane_axes": spec["axes"],
                    "plane_normal": spec["normal"].normalized(),
                    "distance": distance,
                    "origin": origin,
                    "origin_2d": origin_2d,
                    "plane_start": _ray_plane_intersection(region, rv3d, mouse, origin, spec["normal"]),
                }
    return best


def _hit_test_scale(region, rv3d, obj, mouse):
    if not (PLACE_PICTURE_ENABLE_SCALE_GIZMO and _should_draw_gizmo_kind("SCALE")):
        return None
    origin = obj.matrix_world.translation.copy()
    origin_2d = _project_world_point(region, rv3d, origin)
    if origin_2d is None:
        return None
    axes = _get_axis_vectors(obj)
    dirs = _get_axis_screen_dirs(region, rv3d, origin, origin_2d, axes)
    best = None
    if PLACE_PICTURE_ENABLE_UNIFORM_SCALE_HANDLE and (mouse - origin_2d).length <= PLACE_PICTURE_SCALE_HIT_RADIUS:
        best = {"kind": "SCALE", "axis_index": -1, "axis": None, "screen_dir": Vector((0.0, 1.0)), "distance": (mouse - origin_2d).length, "origin": origin, "origin_2d": origin_2d, "uniform": True}
    if PLACE_PICTURE_ENABLE_SCALE_AXIS_HANDLES:
        for axis_index, direction in enumerate(dirs):
            if direction is None:
                continue
            tip = origin_2d + direction * _current_scale_length()
            line_end = tip - direction * (PLACE_PICTURE_SCALE_BOX_SIZE * 0.25)
            distance = min(_distance_to_segment_2d(mouse, origin_2d, line_end), (mouse - tip).length)
            if distance <= PLACE_PICTURE_SCALE_HIT_RADIUS and (best is None or distance < best["distance"]):
                best = {"kind": "SCALE", "axis_index": axis_index, "axis": axes[axis_index].normalized(), "screen_dir": direction.normalized(), "distance": distance, "origin": origin, "origin_2d": origin_2d, "uniform": False}
    if PLACE_PICTURE_ENABLE_SCALE_PLANE_HANDLES:
        for spec in _get_plane_specs(axes):
            ia, ib = spec["axis_indices"]
            quad = _make_plane_handle_quad(origin_2d, dirs[ia], dirs[ib], PLACE_PICTURE_PLANE_HANDLE_OFFSET + 10.0, max(PLACE_PICTURE_PLANE_HANDLE_SIZE - 3.0, 8.0))
            distance = _hit_quad_handle(mouse, quad)
            if distance is None:
                continue
            screen_dir = Vector((0.0, 1.0))
            if dirs[ia] is not None and dirs[ib] is not None:
                combined = dirs[ia] + dirs[ib]
                if combined.length > 0.001:
                    screen_dir = combined.normalized()
            if best is None or distance < best["distance"]:
                best = {"kind": "SCALE_PLANE", "plane": spec["label"], "axis_indices": spec["axis_indices"], "plane_axes": spec["axes"], "screen_dir": screen_dir, "distance": distance, "origin": origin, "origin_2d": origin_2d}
    return best


def _hit_test_rotate(region, rv3d, obj, mouse):
    if not (PLACE_PICTURE_ENABLE_ROTATE_GIZMO and _should_draw_gizmo_kind("ROTATE")):
        return None
    origin = obj.matrix_world.translation.copy()
    origin_2d = _project_world_point(region, rv3d, origin)
    if origin_2d is None:
        return None
    axes = _get_axis_vectors(obj)
    radius_world = _world_units_per_pixel_at(region, rv3d, origin, origin_2d) * _current_rotate_radius()
    if not math.isfinite(radius_world) or radius_world <= 0.0:
        return None
    best = None
    if PLACE_PICTURE_ENABLE_ROTATE_AXIS_RINGS:
        for axis_index, axis in enumerate(axes):
            ring_segments = _make_rotate_ring_segments(region, rv3d, origin, axis, radius_world)
            if not ring_segments:
                continue
            closest_distance = min(_distance_to_segment_2d(mouse, ring_segments[i], ring_segments[i + 1]) for i in range(0, len(ring_segments), 2))
            if closest_distance <= PLACE_PICTURE_ROTATE_HIT_RADIUS and (best is None or closest_distance < best["distance"]):
                best = {
                    "kind": "ROTATE",
                    "axis_index": axis_index,
                    "axis": axis.normalized(),
                    "distance": closest_distance,
                    "origin": origin,
                    "origin_2d": origin_2d,
                    "angle_start": math.atan2(mouse.y - origin_2d.y, mouse.x - origin_2d.x),
                }
    if PLACE_PICTURE_ENABLE_FREE_ROTATE_RING:
        free_distance = abs((mouse - origin_2d).length - _current_free_rotate_radius())
        if free_distance <= PLACE_PICTURE_FREE_ROTATE_HIT_RADIUS and (best is None or free_distance < best["distance"]):
            best = {
                "kind": "ROTATE_FREE",
                "axis_index": -1,
                "axis": _screen_view_axis(rv3d),
                "distance": free_distance,
                "origin": origin,
                "origin_2d": origin_2d,
                "angle_start": math.atan2(mouse.y - origin_2d.y, mouse.x - origin_2d.x),
            }
    return best


def _hit_test_fake_gizmo(region, rv3d, mouse):
    obj = _get_active_gizmo_object()
    if obj is None:
        return None
    active_tool = _get_active_tool_kind()
    mode = PLACE_PICTURE_GIZMO_DISPLAY_MODE.upper().strip()
    if mode == "ACTIVE_TOOL":
        if active_tool == "MOVE":
            order = ["MOVE"]
        elif active_tool == "ROTATE":
            order = ["ROTATE"]
        elif active_tool == "SCALE":
            order = ["SCALE"]
        elif active_tool == "ALL" and PLACE_PICTURE_ENABLE_COMBINED_TRANSFORM_GIZMO:
            order = ["MOVE", "SCALE", "ROTATE"]
        else:
            return None
    elif mode in {"MOVE", "ROTATE", "SCALE"}:
        order = [mode]
    else:
        order = ["MOVE", "SCALE", "ROTATE"]
    for kind in order:
        hit = _hit_test_move(region, rv3d, obj, mouse) if kind == "MOVE" else _hit_test_rotate(region, rv3d, obj, mouse) if kind == "ROTATE" else _hit_test_scale(region, rv3d, obj, mouse)
        if hit is not None:
            hit["object"] = obj
            return hit
    return None


def _wrap_angle_radians(angle):
    while angle > math.pi:
        angle -= math.tau
    while angle < -math.pi:
        angle += math.tau
    return angle


def _axis_scale_matrix(axis, factor):
    axis = axis.normalized()
    matrix = Matrix.Identity(4)
    offset = factor - 1.0
    for row in range(3):
        for column in range(3):
            matrix[row][column] += offset * axis[row] * axis[column]
    return matrix


def _apply_modal_transform(drag, mouse):
    kind = drag["kind"]
    pivot = drag["origin"]
    if kind == "MOVE":
        delta_pixels = (mouse - drag["mouse_start"]).dot(drag["screen_dir"])
        transform = Matrix.Translation(drag["axis"] * delta_pixels * drag["units_per_pixel"] * PLACE_PICTURE_MOVE_DRAG_SENSITIVITY)
    elif kind == "MOVE_PLANE":
        current = None
        if drag.get("region") is not None and drag.get("rv3d") is not None and drag.get("plane_normal") is not None:
            current = _ray_plane_intersection(drag["region"], drag["rv3d"], mouse, pivot, drag["plane_normal"])
        if drag.get("plane_start") is not None and current is not None:
            delta_world = (current - drag["plane_start"]) * PLACE_PICTURE_PLANE_DRAG_SENSITIVITY
        else:
            axis_a, axis_b = drag.get("plane_axes", (Vector((1.0, 0.0, 0.0)), Vector((0.0, 1.0, 0.0))))
            delta = mouse - drag["mouse_start"]
            delta_world = (axis_a.normalized() * delta.x + axis_b.normalized() * delta.y) * drag["units_per_pixel"] * PLACE_PICTURE_PLANE_DRAG_SENSITIVITY
        transform = Matrix.Translation(delta_world)
    elif kind in {"ROTATE", "ROTATE_FREE"}:
        angle_now = math.atan2(mouse.y - drag["origin_2d"].y, mouse.x - drag["origin_2d"].x)
        delta_angle = _wrap_angle_radians(angle_now - drag["angle_start"])
        delta_angle *= PLACE_PICTURE_FREE_ROTATE_DRAG_SENSITIVITY if kind == "ROTATE_FREE" else PLACE_PICTURE_ROTATE_DRAG_SENSITIVITY
        transform = Matrix.Translation(pivot) @ Matrix.Rotation(delta_angle, 4, drag["axis"]) @ Matrix.Translation(-pivot)
    elif kind == "SCALE":
        if drag.get("uniform", False):
            factor = math.exp((mouse.y - drag["mouse_start"].y) / PLACE_PICTURE_SCALE_DRAG_PIXEL_FACTOR)
            scale_matrix = Matrix.Diagonal((factor, factor, factor, 1.0))
        else:
            delta_pixels = (mouse - drag["mouse_start"]).dot(drag["screen_dir"])
            factor = max(0.01, 1.0 + (delta_pixels / PLACE_PICTURE_SCALE_DRAG_PIXEL_FACTOR))
            scale_matrix = _axis_scale_matrix(drag["axis"], factor)
        transform = Matrix.Translation(pivot) @ scale_matrix @ Matrix.Translation(-pivot)
    elif kind == "SCALE_PLANE":
        delta_pixels = (mouse - drag["mouse_start"]).dot(drag.get("screen_dir", Vector((0.0, 1.0))))
        factor = max(0.01, 1.0 + (delta_pixels / PLACE_PICTURE_SCALE_DRAG_PIXEL_FACTOR))
        scale_matrix = Matrix.Identity(4)
        for axis in drag.get("plane_axes", ()):
            scale_matrix = _axis_scale_matrix(axis, factor) @ scale_matrix
        transform = Matrix.Translation(pivot) @ scale_matrix @ Matrix.Translation(-pivot)
    else:
        return
    for obj, matrix_start in drag["objects"]:
        if obj is not None and bpy.data.objects.get(obj.name) is not None:
            obj.matrix_world = transform @ matrix_start


class VIEW3D_OT_flowcell_place_picture_fake_gizmo_modal(bpy.types.Operator):
    bl_idname = "view3d.flowcell_place_picture_fake_gizmo_modal"
    bl_label = "FlowCell Place Picture Fake Gizmo Modal"
    bl_options = {"REGISTER", "UNDO"}

    def invoke(self, context, event):
        state = bpy.app.driver_namespace.get(VIEWPORT_OVERLAY_NAMESPACE_KEY, {})
        if not isinstance(state, dict) or not state.get("enabled", False):
            return {"CANCELLED"}
        self.generation = state.get("generation", 0)
        self.drag = None
        context.window_manager.modal_handler_add(self)
        return {"RUNNING_MODAL"}

    def modal(self, context, event):
        state = bpy.app.driver_namespace.get(VIEWPORT_OVERLAY_NAMESPACE_KEY, {})
        if not isinstance(state, dict) or not state.get("enabled", False):
            return {"FINISHED"}
        if state.get("generation", 0) != getattr(self, "generation", None):
            return {"FINISHED"}
        region = context.region
        rv3d = context.region_data
        space = context.space_data
        if region is None or rv3d is None or space is None:
            return {"PASS_THROUGH"}
        if region.type != "WINDOW" or getattr(space, "type", None) != "VIEW_3D":
            return {"PASS_THROUGH"}
        mouse = Vector((float(event.mouse_region_x), float(event.mouse_region_y)))
        if event.type in {"ESC", "RIGHTMOUSE"}:
            if self.drag is not None:
                for obj, matrix_start in self.drag["objects"]:
                    if obj is not None and bpy.data.objects.get(obj.name) is not None:
                        obj.matrix_world = matrix_start
                self.drag = None
                _tag_redraw_view3d()
                return {"RUNNING_MODAL"}
            return {"PASS_THROUGH"}
        if event.type == "LEFTMOUSE" and event.value == "PRESS":
            hit = _hit_test_fake_gizmo(region, rv3d, mouse)
            if hit is None:
                return {"PASS_THROUGH"}
            objects = _get_transform_objects()
            if not objects:
                return {"PASS_THROUGH"}
            self.drag = {
                "kind": hit["kind"],
                "axis_index": hit.get("axis_index", None),
                "axis": hit.get("axis", None),
                "screen_dir": hit.get("screen_dir", Vector((0.0, 1.0))),
                "origin": hit["origin"].copy(),
                "origin_2d": hit["origin_2d"].copy(),
                "angle_start": hit.get("angle_start", 0.0),
                "mouse_start": mouse.copy(),
                "units_per_pixel": _world_units_per_pixel_at(region, rv3d, hit["origin"], hit["origin_2d"]),
                "uniform": hit.get("uniform", False),
                "plane": hit.get("plane", None),
                "plane_axes": hit.get("plane_axes", None),
                "plane_normal": hit.get("plane_normal", None),
                "plane_start": hit.get("plane_start", None),
                "axis_indices": hit.get("axis_indices", None),
                "region": region,
                "rv3d": rv3d,
                "objects": [(obj, obj.matrix_world.copy()) for obj in objects],
            }
            return {"RUNNING_MODAL"}
        if event.type == "MOUSEMOVE":
            if self.drag is not None:
                _apply_modal_transform(self.drag, mouse)
                _tag_redraw_view3d()
                return {"RUNNING_MODAL"}
            return {"PASS_THROUGH"}
        if event.type == "LEFTMOUSE" and event.value == "RELEASE":
            if self.drag is not None:
                self.drag = None
                try:
                    bpy.ops.ed.undo_push(message="FlowCell Place Picture Fake Gizmo Transform")
                except Exception:
                    pass
                _tag_redraw_view3d()
                return {"RUNNING_MODAL"}
            return {"PASS_THROUGH"}
        return {"PASS_THROUGH"}


def _register_place_picture_modal_operator():
    existing = getattr(bpy.types, "VIEW3D_OT_flowcell_place_picture_fake_gizmo_modal", None)
    if existing is not None:
        try:
            bpy.utils.unregister_class(existing)
        except Exception:
            pass
    try:
        bpy.utils.register_class(VIEW3D_OT_flowcell_place_picture_fake_gizmo_modal)
    except Exception as exc:
        print(f"Could not register Place Picture fake gizmo modal operator: {exc}")


def _start_place_picture_modal_operator():
    override = _find_first_3d_view_context()
    if not override:
        print("Could not find a 3D View to start Place Picture fake gizmo handler.")
        return
    try:
        with bpy.context.temp_override(**override):
            bpy.ops.view3d.flowcell_place_picture_fake_gizmo_modal("INVOKE_DEFAULT")
    except Exception as exc:
        print(f"Could not start Place Picture fake gizmo modal handler: {exc}")


def _remove_place_picture_draw_handlers(state):
    state["enabled"] = False
    handles = []
    for handle_name in ("handler", "background_handler", "overlay_handler"):
        handle = state.get(handle_name)
        if handle is not None and handle not in handles:
            handles.append(handle)
    for handle in handles:
        try:
            bpy.types.SpaceView3D.draw_handler_remove(handle, "WINDOW")
        except Exception:
            pass


def _remove_viewport_overlay_handler():
    state = _overlay_state()
    _bump_place_picture_generation()
    _remove_place_picture_draw_handlers(state)
    _restore_place_picture_viewports(state)
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


def _register_viewport_overlay_from_resolved_path(
    resolved_path: str,
    grid_only: bool = False,
) -> str:
    state = _overlay_state()
    _remove_place_picture_draw_handlers(state)
    _disable_camera_background_images()

    if not resolved_path and not grid_only:
        _restore_place_picture_viewports(state)
        state.clear()
        _tag_redraw_view3d()
        return ""

    image = None
    if resolved_path:
        image = bpy.data.images.load(resolved_path, check_existing=True)
        image.use_fake_user = True
        try:
            _ = image.size[:]
            _ = image.pixels[0]
        except Exception:
            pass

    if not state.get("viewport_snapshots"):
        state["viewport_snapshots"] = _snapshot_place_picture_viewports()

    _apply_place_picture_viewport_settings()

    image_shader = gpu.shader.from_builtin("IMAGE") if image is not None else None
    color_shader = gpu.shader.from_builtin("UNIFORM_COLOR")
    generation = _bump_place_picture_generation()

    state["image"] = image
    state["path"] = resolved_path
    state["texture"] = None
    state["texture_path"] = ""
    state["image_shader"] = image_shader
    state["color_shader"] = color_shader
    state["enabled"] = True
    state["generation"] = generation

    def draw_background_image():
        if not _place_picture_overlay_is_current(state, generation):
            return
        if image is None or not PLACE_PICTURE_ENABLE_BACKGROUND:
            return
        region, _rv3d, _space = _get_current_3d_context()
        if region is None:
            return
        image_size = getattr(image, "size", None)
        if not image_size or image_size[0] <= 0 or image_size[1] <= 0:
            return
        region_width = max(float(region.width), 1.0)
        region_height = max(float(region.height), 1.0)
        x, y, draw_width, draw_height = _fitted_rect(
            region_width, region_height, float(image_size[0]), float(image_size[1])
        )
        z = 0.99999976
        vertices = (
            (x, y, z),
            (x + draw_width, y, z),
            (x + draw_width, y + draw_height, z),
            (x, y + draw_height, z),
        )
        tex_coords = (
            ((0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0))
            if STATIC_BACKGROUND_FLIP_Y
            else ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0))
        )
        try:
            texture = _ensure_overlay_texture(state, image)
        except Exception:
            return
        batch = batch_for_shader(
            image_shader,
            "TRIS",
            {"pos": vertices, "texCoord": tex_coords},
            indices=((0, 1, 2), (0, 2, 3)),
        )
        old_blend = gpu.state.blend_get() if hasattr(gpu.state, "blend_get") else None
        old_depth_test = gpu.state.depth_test_get() if hasattr(gpu.state, "depth_test_get") else None
        old_depth_mask = gpu.state.depth_mask_get() if hasattr(gpu.state, "depth_mask_get") else None
        try:
            if hasattr(gpu.state, "depth_test_set"):
                gpu.state.depth_test_set("LESS_EQUAL")
            if hasattr(gpu.state, "depth_mask_set"):
                gpu.state.depth_mask_set(False)
            gpu.state.blend_set("ALPHA" if STATIC_BACKGROUND_USE_ALPHA else "NONE")
            with gpu.matrix.push_pop():
                gpu.matrix.push_projection()
                try:
                    gpu.matrix.load_matrix(Matrix.Identity(4))
                    gpu.matrix.load_projection_matrix(_pixel_projection(region.width, region.height))
                    image_shader.bind()
                    image_shader.uniform_sampler("image", texture)
                    batch.draw(image_shader)
                finally:
                    gpu.matrix.pop_projection()
        finally:
            if old_blend is not None:
                gpu.state.blend_set(old_blend)
            if old_depth_test is not None and hasattr(gpu.state, "depth_test_set"):
                gpu.state.depth_test_set(old_depth_test)
            if old_depth_mask is not None and hasattr(gpu.state, "depth_mask_set"):
                gpu.state.depth_mask_set(old_depth_mask)

    def draw_grid_and_gizmo_overlay():
        if not _place_picture_overlay_is_current(state, generation):
            return
        region, rv3d, _space = _get_current_3d_context()
        if region is None:
            return
        old_blend = gpu.state.blend_get() if hasattr(gpu.state, "blend_get") else None
        old_depth_test = gpu.state.depth_test_get() if hasattr(gpu.state, "depth_test_get") else None
        old_depth_mask = gpu.state.depth_mask_get() if hasattr(gpu.state, "depth_mask_get") else None
        try:
            gpu.state.blend_set("ALPHA")
            if hasattr(gpu.state, "depth_test_set"):
                gpu.state.depth_test_set("NONE")
            if hasattr(gpu.state, "depth_mask_set"):
                gpu.state.depth_mask_set(False)
            with gpu.matrix.push_pop():
                gpu.matrix.push_projection()
                try:
                    gpu.matrix.load_matrix(Matrix.Identity(4))
                    gpu.matrix.load_projection_matrix(_pixel_projection(region.width, region.height))
                    _draw_fake_grid_2d(color_shader, region, rv3d)
                    _draw_fake_gizmos_2d(color_shader, region, rv3d)
                finally:
                    gpu.matrix.pop_projection()
        finally:
            if old_blend is not None:
                gpu.state.blend_set(old_blend)
            if old_depth_test is not None and hasattr(gpu.state, "depth_test_set"):
                gpu.state.depth_test_set(old_depth_test)
            if old_depth_mask is not None and hasattr(gpu.state, "depth_mask_set"):
                gpu.state.depth_mask_set(old_depth_mask)

    state["draw_background_image"] = draw_background_image
    state["draw_grid_and_gizmo_overlay"] = draw_grid_and_gizmo_overlay
    state["background_handler"] = (
        bpy.types.SpaceView3D.draw_handler_add(
            draw_background_image,
            (),
            "WINDOW",
            "POST_VIEW",
        )
        if image is not None
        else None
    )
    state["overlay_handler"] = bpy.types.SpaceView3D.draw_handler_add(
        draw_grid_and_gizmo_overlay,
        (),
        "WINDOW",
        "POST_PIXEL",
    )

    _register_place_picture_modal_operator()
    _start_place_picture_modal_operator()
    _tag_redraw_view3d()
    try:
        bpy.ops.wm.redraw_timer(type="DRAW_WIN_SWAP", iterations=2)
    except Exception:
        pass
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


def _apply_grid_spacing(context, payload):
    spacing_m, distance_m, far_spacing_m = _read_grid_settings(payload)
    _set_runtime_grid_settings(spacing_m, distance_m, far_spacing_m)
    state = _overlay_state()
    runtime_path = str(state.get("path") or "").strip()
    _register_viewport_overlay_from_resolved_path(
        runtime_path,
        grid_only=not bool(runtime_path),
    )
    if runtime_path:
        _set_project_place_picture_state(
            context,
            runtime_path,
            spacing_m,
            distance_m,
            far_spacing_m,
        )
    return _result(
        f"Grid set to {spacing_m:g} m up to {distance_m:g} m from world origin, then {far_spacing_m:g} m.",
        grid_spacing_m=spacing_m,
        grid_distance_m=distance_m,
        grid_far_spacing_m=far_spacing_m,
        grid_enabled=True,
    )


def _place_picture_image(context, payload, persist_project_state=True):
    spacing_m, distance_m, far_spacing_m = _read_grid_settings(payload)
    _set_runtime_grid_settings(spacing_m, distance_m, far_spacing_m)
    resolved_path = _resolve_optional_image_path(
        _read_string(payload, "static_background_path", DEFAULT_STATIC_BACKGROUND_PATH)
    )
    applied_path = _register_viewport_overlay_from_resolved_path(resolved_path)
    _set_saved_overlay_path(applied_path)
    if persist_project_state:
        _set_project_place_picture_state(
            context,
            applied_path,
            spacing_m,
            distance_m,
            far_spacing_m,
        )
    return applied_path


def _set_static_background_image(context, payload):
    return _place_picture_image(context, payload)


def _clear_place_picture_overlay(context=None, persist_project_state=True):
    _remove_viewport_overlay_handler()
    _disable_camera_background_images()
    _set_saved_overlay_path("")
    if persist_project_state:
        _set_project_place_picture_state(context, "")
    namespace = bpy.app.driver_namespace
    existing = namespace.get(VIEWPORT_OVERLAY_LOAD_HANDLER_KEY)
    if existing in bpy.app.handlers.load_post:
        try:
            bpy.app.handlers.load_post.remove(existing)
        except Exception:
            pass
    if _clear_viewport_overlay_on_blend_load in bpy.app.handlers.load_post:
        try:
            bpy.app.handlers.load_post.remove(_clear_viewport_overlay_on_blend_load)
        except Exception:
            pass
    namespace.pop(VIEWPORT_OVERLAY_LOAD_HANDLER_KEY, None)
    _tag_redraw_view3d()


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


def _contrast_safe_text_hex(text_hex: str, background_hex: str):
    if _contrast_ratio(text_hex, background_hex) >= 4.5:
        return text_hex, False
    black = "#0C0C0C"
    white = "#F4F4F4"
    if _contrast_ratio(black, background_hex) >= _contrast_ratio(
        white, background_hex
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
    role_fallback_keys = ["editor_background_hex", "controls_hex"]

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
        role_fallback_keys = ["tabs_hex", "editor_background_hex"]
    elif context_name.startswith("wcol_"):
        preferred_attributes = ["inner", "item", "back", "outline"]
        role_fallback_keys = ["controls_hex", "editor_background_hex"]
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


def _read_theme_role_hexes(payload):
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
            payload, "scene_hex", "editor_background_hex"
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
    return role_hexes


def _theme_project_payload_from_role_hexes(
    role_hexes, visual_mode: str, viewport_gradient_enabled: bool
):
    editor_background_hex = role_hexes["editor_background_hex"]
    return {
        "enabled": True,
        "visual_mode": str(visual_mode or "dark").lower(),
        "tabs_hex": role_hexes["tabs_hex"],
        "tabs_text_hex": role_hexes["tabs_text_hex"],
        "headers_hex": role_hexes["headers_hex"],
        "header_text_hex": role_hexes["header_text_hex"],
        "text_hex": role_hexes["text_hex"],
        "control_text_hex": role_hexes["control_text_hex"],
        "accent_text_hex": role_hexes["accent_text_hex"],
        "editor_background_hex": editor_background_hex,
        "scene_hex": role_hexes["scene_hex"],
        "controls_hex": role_hexes["controls_hex"],
        "borders_hex": role_hexes.get("borders_hex", editor_background_hex),
        "darks_hex": role_hexes.get("darks_hex", editor_background_hex),
        "misc_hex": role_hexes.get("misc_hex", editor_background_hex),
        "highlights_hex": role_hexes["highlights_hex"],
        "viewport_background_hex": role_hexes["viewport_background_hex"],
        "viewport_gradient_enabled": bool(viewport_gradient_enabled),
        "viewport_gradient_hex": role_hexes["viewport_gradient_hex"],
    }


def _set_project_theme_state_from_role_hexes(
    context, payload, role_hexes, viewport_gradient_enabled=None
):
    visual_mode = _read_string(payload or {}, "visual_mode", "dark").lower()
    if viewport_gradient_enabled is None:
        viewport_gradient_enabled = bool((payload or {}).get("viewport_gradient_enabled", False))
    state = _read_project_theme_state(context)
    state["theme"] = _theme_project_payload_from_role_hexes(
        role_hexes,
        visual_mode,
        bool(viewport_gradient_enabled),
    )
    return _write_theme_state(context, state)


def _project_theme_payload_for_restore(theme_state):
    if not isinstance(theme_state, dict) or not bool(theme_state.get("enabled")):
        return None
    payload = {
        key: theme_state[key]
        for key in PROJECT_THEME_STATE_THEME_KEYS
        if key in theme_state
    }
    editor_background_hex = str(payload.get("editor_background_hex") or "").strip()
    if editor_background_hex:
        payload.setdefault("borders_hex", editor_background_hex)
        payload.setdefault("darks_hex", editor_background_hex)
        payload.setdefault("misc_hex", editor_background_hex)
    payload.setdefault("visual_mode", "dark")
    payload.setdefault("viewport_gradient_enabled", False)
    return payload


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
    editor_background_hex = (
        role_hexes["scene_hex"] if section_name == "outliner" else role_hexes["editor_background_hex"]
    )
    editor_fill_hex = editor_background_hex
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
    editor_fill_rgb = _hex_to_rgb_floats(editor_fill_hex)
    editor_fill_rgba = _hex_to_rgba_floats(editor_fill_hex)
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
    _set_theme_color_property(theme_section, "list", editor_fill_rgb, editor_fill_rgba)
    _set_theme_color_property(theme_section, "row_alternate", editor_fill_rgb, editor_fill_rgba)

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


def _set_theme_hex_property(target, attribute: str, hex_value: str) -> int:
    if _set_theme_color_property(
        target,
        attribute,
        _hex_to_rgb_floats(hex_value),
        _hex_to_rgba_floats(hex_value),
    ):
        return 1
    return 0


def _set_theme_hex_attributes(target, attributes, hex_value: str) -> int:
    changed = 0
    for attribute in attributes:
        changed += _set_theme_hex_property(target, attribute, hex_value)
    return changed


def _iter_theme_sections(theme):
    for section_name in THEME_EDITOR_SECTION_NAMES:
        section = getattr(theme, section_name, None)
        if section is not None:
            yield section_name, section


def _apply_theme_bucket(context, payload):
    bucket = _read_string(payload, "bucket", "").lower().replace("-", "_")
    bucket_aliases = {
        "tab_fill": "tabs_hex",
        "tabs": "tabs_hex",
        "header": "headers_hex",
        "headers": "headers_hex",
        "random_text": "text_hex",
        "text": "text_hex",
        "tool_text": "control_text_hex",
        "control_text": "control_text_hex",
        "scene_header_text": "accent_text_hex",
        "accent_text": "accent_text_hex",
        "panel": "editor_background_hex",
        "editor_background": "editor_background_hex",
        "collection_row": "scene_hex",
        "scene": "scene_hex",
        "control_fill": "controls_hex",
        "controls": "controls_hex",
        "highlights": "highlights_hex",
        "viewport_bg": "viewport_background_hex",
        "viewport_background": "viewport_background_hex",
        "gradient_2": "viewport_gradient_hex",
        "viewport_gradient": "viewport_gradient_hex",
    }
    bucket_key = bucket_aliases.get(bucket, bucket)
    role_hexes = _read_theme_role_hexes(payload)
    if payload.get("bucket_hex") is not None and bucket_key in role_hexes:
        role_hexes[bucket_key] = _normalize_hex_color(payload, "bucket_hex")

    theme = _ctx(context).preferences.themes[0]
    theme_ui = getattr(theme, "user_interface", None)
    changed = 0

    if bucket_key == "tabs_hex":
        hex_value = role_hexes["tabs_hex"]
        for widget_name in ("wcol_tab", "wcol_toolbar_item"):
            widget = getattr(theme_ui, widget_name, None) if theme_ui is not None else None
            changed += _set_theme_hex_attributes(
                widget, ("inner", "inner_sel", "outline_sel"), hex_value
            )
        for _, section in _iter_theme_sections(theme):
            changed += _set_theme_hex_attributes(section, ("tab_back", "tab_active"), hex_value)
        message = "Applied Tab Fill bucket."
    elif bucket_key == "headers_hex":
        hex_value = role_hexes["headers_hex"]
        changed += _set_theme_hex_attributes(
            theme_ui,
            ("panel_header", "panel_active", "header", "title", "navigation_bar"),
            hex_value,
        )
        widget = getattr(theme_ui, "wcol_box", None) if theme_ui is not None else None
        changed += _set_theme_hex_attributes(widget, ("inner_sel", "outline_sel"), hex_value)
        panel = getattr(theme_ui, "panel", None) if theme_ui is not None else None
        changed += _set_theme_hex_attributes(panel, ("header", "active"), hex_value)
        for _, section in _iter_theme_sections(theme):
            changed += _set_theme_hex_attributes(section, ("header", "title", "navigation_bar"), hex_value)
            changed += _set_theme_hex_attributes(getattr(section, "space", None), ("header", "title", "navigation_bar"), hex_value)
            changed += _set_theme_hex_attributes(getattr(section, "panelcolors", None), ("header", "active"), hex_value)
            changed += _set_theme_hex_attributes(
                getattr(getattr(section, "space", None), "panelcolors", None),
                ("header", "active"),
                hex_value,
            )
        message = "Applied Header bucket."
    elif bucket_key == "editor_background_hex":
        hex_value = role_hexes["editor_background_hex"]
        changed += _set_theme_hex_attributes(
            theme_ui,
            ("back", "sub_back", "menu_back", "panel_back", "panel_sub_back", "panel_outline"),
            hex_value,
        )
        for widget_name in ("wcol_box", "wcol_menu_back", "wcol_menu", "wcol_menu_item"):
            widget = getattr(theme_ui, widget_name, None) if theme_ui is not None else None
            changed += _set_theme_hex_attributes(widget, ("inner", "outline"), hex_value)
        panel = getattr(theme_ui, "panel", None) if theme_ui is not None else None
        changed += _set_theme_hex_attributes(panel, ("back", "sub_back", "outline"), hex_value)
        for section_name, section in _iter_theme_sections(theme):
            if section_name == "outliner":
                continue
            changed += _set_theme_hex_attributes(
                section, ("back", "sub_back", "list", "row_alternate"), hex_value
            )
            changed += _set_theme_hex_attributes(getattr(section, "space", None), ("back",), hex_value)
            changed += _set_theme_hex_attributes(
                getattr(section, "panelcolors", None),
                ("back", "sub_back", "outline"),
                hex_value,
            )
            changed += _set_theme_hex_attributes(
                getattr(getattr(section, "space", None), "panelcolors", None),
                ("back", "sub_back", "outline"),
                hex_value,
            )
        message = "Applied Panel bucket."
    elif bucket_key == "scene_hex":
        hex_value = role_hexes["scene_hex"]
        outliner = getattr(theme, "outliner", None)
        changed += _set_theme_hex_attributes(outliner, ("back", "list", "row_alternate"), hex_value)
        widget = getattr(theme_ui, "wcol_list_item", None) if theme_ui is not None else None
        changed += _set_theme_hex_attributes(widget, ("inner", "inner_sel"), hex_value)
        message = "Applied Collection Row bucket."
    elif bucket_key == "controls_hex":
        hex_value = role_hexes["controls_hex"]
        skipped_widgets = {
            "wcol_box",
            "wcol_list_item",
            "wcol_menu",
            "wcol_menu_back",
            "wcol_menu_item",
            "wcol_option",
            "wcol_pie_menu",
            "wcol_progress",
            "wcol_radio",
            "wcol_state",
            "wcol_tab",
            "wcol_toolbar_item",
            "wcol_toggle",
            "wcol_tooltip",
        }
        if theme_ui is not None:
            for widget_name in _iter_theme_ui_widget_names(theme_ui):
                if widget_name in skipped_widgets:
                    continue
                changed += _set_theme_hex_attributes(
                    getattr(theme_ui, widget_name, None),
                    ("inner", "inner_sel"),
                    hex_value,
                )
        changed += _set_theme_hex_attributes(theme_ui, ("button", "execution_buts"), hex_value)
        for _, section in _iter_theme_sections(theme):
            changed += _set_theme_hex_attributes(
                section,
                ("button", "execution_buts", "button_animated", "button_key"),
                hex_value,
            )
            changed += _set_theme_hex_attributes(
                getattr(section, "space", None),
                ("button", "execution_buts"),
                hex_value,
            )
        message = "Applied Control Fill bucket."
    elif bucket_key == "highlights_hex":
        hex_value = role_hexes["highlights_hex"]
        changed += _set_theme_hex_attributes(theme_ui, ("active", "selected_highlight"), hex_value)
        for widget_name in ("wcol_option", "wcol_radio", "wcol_toggle", "wcol_progress"):
            widget = getattr(theme_ui, widget_name, None) if theme_ui is not None else None
            changed += _set_theme_hex_attributes(
                widget, ("inner", "inner_sel", "outline_sel"), hex_value
            )
        state_widget = getattr(theme_ui, "wcol_state", None) if theme_ui is not None else None
        changed += _set_theme_hex_attributes(
            state_widget,
            (
                "error",
                "inner_anim_sel",
                "inner_changed_sel",
                "inner_driven_sel",
                "inner_key_sel",
                "inner_overridden_sel",
                "inner_red_alert",
                "inner_red_alert_sel",
            ),
            hex_value,
        )
        for _, section in _iter_theme_sections(theme):
            changed += _set_theme_hex_attributes(
                section,
                (
                    "edge_select",
                    "face_select",
                    "vertex_select",
                    "active",
                    "grid",
                    "selected_highlight",
                    "button_key_sel",
                ),
                hex_value,
            )
        message = "Applied Highlights bucket."
    elif bucket_key == "viewport_background_hex":
        hex_value = role_hexes["viewport_background_hex"]
        view3d_space = getattr(getattr(theme, "view_3d", None), "space", None)
        gradients = getattr(view3d_space, "gradients", None) if view3d_space else None
        changed += _set_theme_hex_property(gradients, "gradient", hex_value)
        message = "Applied Viewport BG bucket."
    elif bucket_key == "viewport_gradient_hex":
        hex_value = role_hexes["viewport_gradient_hex"]
        view3d_space = getattr(getattr(theme, "view_3d", None), "space", None)
        gradients = getattr(view3d_space, "gradients", None) if view3d_space else None
        changed += _set_theme_hex_property(gradients, "high_gradient", hex_value)
        message = "Applied Gradient 2 bucket."
    elif bucket_key == "text_hex":
        hex_value = role_hexes["text_hex"]
        changed += _set_theme_hex_attributes(theme_ui, ("text", "text_hi", "panel_text"), hex_value)
        for widget_name in ("wcol_text", "wcol_tooltip"):
            widget = getattr(theme_ui, widget_name, None) if theme_ui is not None else None
            changed += _set_theme_hex_attributes(widget, ("text", "text_sel"), hex_value)
        for _, section in _iter_theme_sections(theme):
            changed += _set_theme_hex_attributes(section, ("text", "text_hi", "list_text"), hex_value)
            changed += _set_theme_hex_attributes(getattr(section, "space", None), ("text", "text_hi"), hex_value)
        message = "Applied Random Text bucket."
    elif bucket_key == "control_text_hex":
        hex_value = role_hexes["control_text_hex"]
        if theme_ui is not None:
            for widget_name in _iter_theme_ui_widget_names(theme_ui):
                if widget_name in ("wcol_tab", "wcol_toolbar_item", "wcol_pie_menu", "wcol_tooltip"):
                    continue
                changed += _set_theme_hex_attributes(
                    getattr(theme_ui, widget_name, None),
                    ("text", "text_sel"),
                    hex_value,
                )
        for _, section in _iter_theme_sections(theme):
            changed += _set_theme_hex_attributes(section, ("button_text", "button_text_hi"), hex_value)
            changed += _set_theme_hex_attributes(
                getattr(section, "space", None),
                ("button_text", "button_text_hi"),
                hex_value,
            )
        message = "Applied Tool Text bucket."
    elif bucket_key == "accent_text_hex":
        hex_value = role_hexes["accent_text_hex"]
        changed += _set_theme_hex_attributes(theme_ui, ("button_title", "panel_title"), hex_value)
        for widget_name in ("wcol_pie_menu", "wcol_option"):
            widget = getattr(theme_ui, widget_name, None) if theme_ui is not None else None
            changed += _set_theme_hex_attributes(widget, ("text", "text_sel"), hex_value)
        for _, section in _iter_theme_sections(theme):
            changed += _set_theme_hex_attributes(section, ("button_title",), hex_value)
            changed += _set_theme_hex_attributes(getattr(section, "space", None), ("button_title",), hex_value)
        outliner = getattr(theme, "outliner", None)
        changed += _set_theme_hex_attributes(
            outliner, ("match", "active_object", "selected_object"), hex_value
        )
        message = "Applied Scene/Header Text bucket."
    elif bucket_key == "tabs_text_hex":
        hex_value = role_hexes["tabs_text_hex"]
        for widget_name in ("wcol_tab", "wcol_toolbar_item"):
            widget = getattr(theme_ui, widget_name, None) if theme_ui is not None else None
            changed += _set_theme_hex_attributes(widget, ("text", "text_sel"), hex_value)
        for _, section in _iter_theme_sections(theme):
            changed += _set_theme_hex_attributes(section, ("tab_text", "tab_text_hi"), hex_value)
        message = "Applied Tab Text bucket."
    elif bucket_key == "header_text_hex":
        hex_value = role_hexes["header_text_hex"]
        changed += _set_theme_hex_attributes(
            theme_ui, ("header_text", "header_text_hi", "panel_text"), hex_value
        )
        for _, section in _iter_theme_sections(theme):
            changed += _set_theme_hex_attributes(section, ("header_text", "header_text_hi"), hex_value)
        message = "Applied Header Text bucket."
    else:
        raise ValueError(f"Unsupported theme bucket: {bucket or '[blank]'}")

    if changed <= 0:
        raise ValueError(f"Theme bucket did not match any Blender theme fields: {bucket_key}")

    _set_project_theme_state_from_role_hexes(context, payload, role_hexes)
    _tag_redraw_view3d()
    return _result(message, bucket=bucket_key, applied_count=changed)


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
            ("outliner", "row_alternate"),
            ("outliner", "list"),
            ("outliner", "back"),
            ("user_interface.wcol_list_item", "inner"),
            ("user_interface.wcol_list_item", "inner_sel"),
            ("view_3d", "back"),
            ("view_3d", "list"),
            ("properties", "back"),
        ],
    )

    controls_hex = _sample_theme_hex_from_paths(
        theme,
        [
            ("user_interface.wcol_regular", "inner"),
            ("user_interface.wcol_num", "inner"),
            ("user_interface.wcol_numslider", "inner"),
            ("user_interface.wcol_tool", "inner"),
            ("user_interface.wcol_regular", "item"),
            ("user_interface.wcol_box", "inner"),
            ("user_interface", "button"),
            ("user_interface", "button_title"),
            ("user_interface", "execution_buts"),
        ],
    )

    highlights_hex = _sample_theme_hex_from_paths(
        theme,
        [
            ("view_3d", "selected_highlight"),
            ("preferences", "selected_highlight"),
            ("outliner", "selected_highlight"),
            ("user_interface", "selected_highlight"),
            ("user_interface", "active"),
            ("user_interface.wcol_option", "inner_sel"),
            ("user_interface.wcol_radio", "inner_sel"),
            ("user_interface.wcol_toggle", "inner_sel"),
            ("user_interface.wcol_progress", "inner_sel"),
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
        controls_hex=controls_hex,
        borders_hex=borders_hex,
        darks_hex=darks_hex,
        misc_hex=misc_hex,
        highlights_hex=highlights_hex,
        viewport_background_hex=viewport_background_hex,
        viewport_gradient_enabled=viewport_gradient_enabled,
        viewport_gradient_hex=viewport_gradient_hex,
    )


def _apply_theme_from_photo_manual_colors(context, payload, persist_project_state=True):
    visual_mode = _read_string(payload, "visual_mode", "dark").lower()
    role_hexes = _read_theme_role_hexes(payload)
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

    if persist_project_state:
        _set_project_theme_state_from_role_hexes(
            context,
            payload,
            role_hexes,
            viewport_gradient_enabled=viewport_gradient_enabled,
        )
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
        controls_hex=role_hexes["controls_hex"],
        borders_hex=role_hexes["borders_hex"],
        darks_hex=role_hexes["darks_hex"],
        highlights_hex=role_hexes["highlights_hex"],
        viewport_background_hex=role_hexes["viewport_background_hex"],
        viewport_gradient_enabled=viewport_gradient_enabled,
        viewport_gradient_hex=role_hexes["viewport_gradient_hex"],
        text_corrected=False,
    )


def _read_project_startup_state(context):
    _ensure_project_theme_restore_handler_registered_from_action()
    state = _read_project_theme_state(context)
    global_state = _read_global_theme_state()
    return _result(
        "FlowCell project startup state read.",
        restore_handler_registered=_project_theme_restore_handler_registered(),
        **_project_state_payload(state),
        **_startup_state_payload(global_state),
    )


def _resolve_project_place_picture_path(place_picture_state, prefer_absolute=False):
    if not isinstance(place_picture_state, dict) or not bool(place_picture_state.get("enabled")):
        return "", ""

    relative_path = str(place_picture_state.get("relative_path") or "").strip()
    absolute_path = str(place_picture_state.get("path") or "").strip()
    candidates = (
        [absolute_path, relative_path]
        if prefer_absolute
        else [relative_path, absolute_path]
    )
    last_error = ""
    seen = set()
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        try:
            return _resolve_optional_image_path(candidate), ""
        except Exception as exc:
            last_error = str(exc)

    return "", last_error or "No saved Place Picture path was available."


def _restore_state_for_startup(context):
    project_state = _read_project_theme_state(context)
    global_state_exists = _global_theme_state_exists()
    global_state = _read_global_theme_state()
    project_theme = project_state.get("theme", {})
    project_place_picture = project_state.get("place_picture", {})
    global_theme = global_state.get("theme", {})
    global_place_picture = global_state.get("place_picture", {})

    theme_state = global_theme if global_state_exists else project_theme
    place_picture_state = (
        global_place_picture if global_state_exists else project_place_picture
    )
    return project_state, global_state, theme_state, place_picture_state, global_state_exists


def _restore_project_startup_state(context):
    _ensure_project_theme_restore_handler_registered_from_action()
    (
        state,
        global_state,
        theme_state,
        place_picture_state,
        global_state_exists,
    ) = _restore_state_for_startup(context)
    warnings = []
    restored_theme = False
    restored_place_picture = False

    theme_payload = _project_theme_payload_for_restore(theme_state)
    if theme_payload:
        try:
            _apply_theme_from_photo_manual_colors(
                context,
                theme_payload,
                persist_project_state=False,
            )
            restored_theme = True
        except Exception as exc:
            warnings.append(f"Theme restore failed: {exc}")

    resolved_picture_path, picture_warning = _resolve_project_place_picture_path(
        place_picture_state,
        prefer_absolute=global_state_exists,
    )
    if resolved_picture_path:
        try:
            _place_picture_image(
                context,
                {
                    "static_background_path": resolved_picture_path,
                    "grid_spacing_m": place_picture_state.get(
                        "grid_spacing_m",
                        DEFAULT_PLACE_PICTURE_GRID_SPACING_M,
                    ),
                    "grid_distance_m": place_picture_state.get(
                        "grid_distance_m",
                        DEFAULT_PLACE_PICTURE_GRID_DISTANCE_M,
                    ),
                    "grid_far_spacing_m": place_picture_state.get(
                        "grid_far_spacing_m",
                        DEFAULT_PLACE_PICTURE_GRID_FAR_SPACING_M,
                    ),
                },
                persist_project_state=False,
            )
            restored_place_picture = True
        except Exception as exc:
            warnings.append(f"Place Picture restore failed: {exc}")
    elif picture_warning:
        warnings.append(f"Place Picture restore skipped: {picture_warning}")

    if restored_theme and restored_place_picture:
        message = "FlowCell project theme and Place Picture restored."
    elif restored_theme:
        message = "FlowCell project theme restored."
    elif restored_place_picture:
        message = "FlowCell project Place Picture restored."
    elif warnings:
        message = "FlowCell project startup restore completed with warnings."
    else:
        message = "No FlowCell project startup state to restore."

    return _result(
        message,
        restored_theme=restored_theme,
        restored_place_picture=restored_place_picture,
        warnings=warnings,
        **_project_state_payload(state),
        **_startup_state_payload(global_state),
    )


def run_flowcell_action(context=None, data=None):
    payload = data or {}
    command = _read_string(payload, "command", "apply_all").lower()
    if command == "read_project_startup_state":
        return _read_project_startup_state(context)
    if command == "restore_project_startup_state":
        return _restore_project_startup_state(context)
    if command == "read_startup_state":
        return _read_project_startup_state(context)
    if command == "restore_startup_state":
        return _restore_project_startup_state(context)
    if command == "read_place_picture_runtime_state":
        return _read_place_picture_runtime_state(context)
    if command == "apply_theme_from_photo_manual_colors":
        return _apply_theme_from_photo_manual_colors(context, payload)
    if command == "apply_theme_bucket":
        return _apply_theme_bucket(context, payload)
    if command == "absorb_theme":
        return _absorb_current_theme(context)
    if command == "set_grid_spacing":
        return _apply_grid_spacing(context, payload)
    if command == "place_picture":
        resolved_path = _place_picture_image(context, payload)
        if resolved_path:
            return _result(
                f"Place Picture installed from {resolved_path}.",
                static_background_path=resolved_path,
            )
        return _result("Place Picture cleared.", static_background_path="")
    if command == "set_place_picture_startup":
        return _set_startup_place_picture_state(context, payload)
    if command == "set_static_background_image":
        resolved_path = _set_static_background_image(context, payload)
        if resolved_path:
            return _result(
                f"Place Picture installed from {resolved_path}.",
                static_background_path=resolved_path,
            )
        return _result("Place Picture cleared.", static_background_path="")
    if command == "clear_place_picture":
        _clear_place_picture_overlay(context)
        return _result("Place Picture cleared.", static_background_path="")

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
        return _result(f"HDRI {axis_label} rotation set to {degrees:.2f} degrees.")

    if command == "set_world_strength":
        _ensure_hdri_image_if_missing(env, payload)
        strength = _read_float(payload, "world_strength", DEFAULT_WORLD_STRENGTH)
        _set_world_strength(background, strength)
        return _result(f"HDRI world strength set to {strength:.3f}.")

    if command == "apply_all":
        resolved_path = _apply_hdri_image(env, payload)
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
        )

    raise ValueError(f"Unsupported HDRI world command: {command}")
