"""Exercise Place Picture grid behavior without starting Blender or touching artwork."""

import ast
import contextlib
import math
import types
import unittest
from pathlib import Path


SOURCE = Path(__file__).resolve().parents[1] / "Blender Git Scripts/Toolsets/theme/theme.py"
TREE = ast.parse(SOURCE.read_text(encoding="utf-8-sig"))
FUNCTIONS = {node.name: node for node in TREE.body if isinstance(node, ast.FunctionDef)}


def load_functions(*names, **overrides):
    namespace = {"math": math}
    for node in TREE.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
            continue
        try:
            namespace[node.targets[0].id] = ast.literal_eval(node.value)
        except (ValueError, TypeError):
            pass
    namespace.update(overrides)
    exec(compile(ast.Module(body=[FUNCTIONS[name] for name in names], type_ignores=[]), str(SOURCE), "exec"), namespace)
    return namespace


class FakeGpuState:
    def __init__(self):
        self.blend = "ADDITIVE"
        self.depth = "GREATER"
        self.mask = True
        self.width = 3.5
        self.viewport = (5, 10, 640, 480)

    def viewport_get(self):
        return self.viewport

    def viewport_set(self, *value):
        self.viewport = value

    def blend_get(self):
        return self.blend

    def blend_set(self, value):
        self.blend = value

    def depth_test_get(self):
        return self.depth

    def depth_test_set(self, value):
        self.depth = value

    def depth_mask_get(self):
        return self.mask

    def depth_mask_set(self, value):
        self.mask = value

    def line_width_get(self):
        return self.width

    def line_width_set(self, value):
        self.width = value

    def snapshot(self):
        return self.blend, self.depth, self.mask, self.width


class FakeGpuMatrix:
    def __init__(self):
        self.loaded = []
        self.projection_depth = 0
        self.view = "initial-view"
        self.projection = "initial-projection"
        self.projection_stack = []

    @contextlib.contextmanager
    def push_pop(self):
        previous = self.view
        try:
            yield
        finally:
            self.view = previous

    def push_projection(self):
        self.projection_depth += 1
        self.projection_stack.append(self.projection)

    def pop_projection(self):
        self.projection_depth -= 1
        self.projection = self.projection_stack.pop()

    def load_matrix(self, matrix):
        self.loaded.append(("view", matrix))
        self.view = matrix

    def load_projection_matrix(self, matrix):
        self.loaded.append(("projection", matrix))
        self.projection = matrix


def registered_overlay():
    state = {}
    handlers = {}
    removed = []
    gpu_state = FakeGpuState()
    gpu_matrix = FakeGpuMatrix()
    draws = []
    region = types.SimpleNamespace(width=640, height=480, as_pointer=lambda: 17)
    rv3d = types.SimpleNamespace(view_matrix="world-view", window_matrix="world-projection")

    def add_handler(callback, args, region_type, stage):
        handle = f"handle-{len(handlers)}"
        handlers[handle] = {"callback": callback, "args": args, "region": region_type, "stage": stage}
        return handle

    def shader(name):
        return types.SimpleNamespace(name=name, bind=lambda: None, uniform_sampler=lambda *args: None)

    def batch(shader, *args, **kwargs):
        return types.SimpleNamespace(draw=lambda active: draws.append((active.name, gpu_state.snapshot(), gpu_matrix.view, gpu_matrix.projection)))

    namespace = load_functions(
        "_register_viewport_overlay_from_resolved_path", "_remove_place_picture_draw_handlers",
        "_place_picture_overlay_is_current", "_remove_viewport_overlay_handler", "_remove_place_picture_grid",
        "_free_native_view_caches",
        _overlay_state=lambda: state,
        _disable_camera_background_images=lambda: None,
        _snapshot_place_picture_viewports=lambda: [],
        _apply_place_picture_viewport_settings=lambda enabled=False: None,
        _set_native_grid_visibility=lambda enabled: None,
        _restore_place_picture_viewports=lambda state: None,
        _bump_place_picture_generation=lambda: 1,
        _register_place_picture_modal_operator=lambda: None,
        _start_place_picture_modal_operator=lambda: None,
        _tag_redraw_view3d=lambda: None,
        _set_project_place_picture_state=lambda *args, **kwargs: None,
        _result=lambda message, **payload: payload,
        _get_current_3d_context=lambda: (region, rv3d, object()),
        _build_native_view_shader=lambda: shader("native"),
        _native_view_signature=lambda context, region, rv3d, space, state: state.get("scene_revision", 0),
        _refresh_native_view_cache=lambda state, generation: draws.append(("refresh", generation)),
        _fitted_rect=lambda width, height, *args: (0, 0, width, height),
        _ensure_overlay_texture=lambda *args: object(),
        _draw_fake_gizmos_2d=lambda *args: draws.append(("gizmos", gpu_state.snapshot(), gpu_matrix.view, gpu_matrix.projection)),
        _pixel_projection=lambda *args: "pixel-projection",
        Matrix=types.SimpleNamespace(Identity=lambda size: "identity"),
        batch_for_shader=batch,
        gpu=types.SimpleNamespace(state=gpu_state, matrix=gpu_matrix, shader=types.SimpleNamespace(from_builtin=shader)),
        bpy=types.SimpleNamespace(
            context=object(),
            types=types.SimpleNamespace(SpaceView3D=types.SimpleNamespace(
                draw_handler_add=add_handler, draw_handler_remove=lambda handle, region: removed.append((handle, region)),
            )),
            data=types.SimpleNamespace(images=types.SimpleNamespace(load=lambda path, **kwargs: types.SimpleNamespace(filepath=path, size=(64, 64), pixels=[1.0]))),
            ops=types.SimpleNamespace(wm=types.SimpleNamespace(redraw_timer=lambda **kwargs: None)),
        ),
    )
    namespace["bpy"].app = types.SimpleNamespace(
        driver_namespace={namespace["VIEWPORT_OVERLAY_NAMESPACE_KEY"]: state},
        handlers=types.SimpleNamespace(depsgraph_update_post=[]),
    )
    return namespace, state, handlers, removed, gpu_state, gpu_matrix, draws


def native_cache_fixture():
    state = {"enabled": True, "grid_enabled": True, "image": object(), "generation": 2, "scene_revision": 0}
    gpu_state = FakeGpuState()
    allocations, renders, redraws = [], [], []
    region = types.SimpleNamespace(type="WINDOW", width=640, height=480, as_pointer=lambda: 17)
    rv3d = types.SimpleNamespace(view_matrix=((1, 0), (0, 1)), window_matrix=((2, 0), (0, 2)))
    space = types.SimpleNamespace(
        shading=types.SimpleNamespace(type="SOLID", light="STUDIO", color_type="MATERIAL",
                                      single_color=[0.8, 0.8, 0.8], show_xray=False, xray_alpha=0.5, show_cavity=False),
        overlay=types.SimpleNamespace(show_overlays=True, show_floor=True, show_ortho_grid=True,
                                      show_axis_x=True, show_axis_y=True, show_axis_z=False,
                                      grid_scale=1.0, grid_subdivisions=10, show_wireframes=False),
    )
    context = types.SimpleNamespace(
        scene=types.SimpleNamespace(
            as_pointer=lambda: 21,
            view_settings=types.SimpleNamespace(gamma=1.0, view_transform="AgX"),
            display_settings=types.SimpleNamespace(display_device="sRGB"),
            unit_settings=types.SimpleNamespace(system="NONE", scale_length=1.0),
        ),
        preferences=types.SimpleNamespace(themes=[types.SimpleNamespace(
            view_3d=types.SimpleNamespace(grid=[0.3, 0.3, 0.3]),
            user_interface=types.SimpleNamespace(axis_x=[0.6, 0.2, 0.2]),
        )]),
        view_layer=types.SimpleNamespace(as_pointer=lambda: 22),
        area=types.SimpleNamespace(type="VIEW_3D", regions=[region], tag_redraw=lambda: redraws.append(True)),
        object=None, selected_objects=[],
    )
    context.window_manager = types.SimpleNamespace(windows=[types.SimpleNamespace(screen=types.SimpleNamespace(areas=[context.area]))])
    theme = context.preferences.themes[0]
    for settings in (space.overlay, space.shading, theme.view_3d, theme.user_interface,
                     context.scene.view_settings, context.scene.display_settings, context.scene.unit_settings):
        properties = [types.SimpleNamespace(identifier=name, type="FLOAT" if isinstance(value, (float, list)) else
                     "BOOLEAN" if isinstance(value, bool) else "INT" if isinstance(value, int) else "ENUM",
                     is_array=isinstance(value, list)) for name, value in vars(settings).items()]
        properties.append(types.SimpleNamespace(identifier="unread_pointer", type="POINTER"))
        settings.bl_rna = types.SimpleNamespace(properties=properties)

    class Offscreen:
        def __init__(self, width, height, **options):
            self.size, self.options, self.frees, self.fail = (width, height), options, 0, False
            allocations.append(self)

        def draw_view3d(self, *args, **kwargs):
            renders.append((self, args, kwargs))
            gpu_state.viewport_set(0, 0, 1, 1)
            gpu_state.blend_set("NONE")
            gpu_state.depth_test_set("NONE")
            gpu_state.depth_mask_set(False)
            if self.fail:
                raise RuntimeError("native render failed")

        def free(self):
            self.frees += 1

    namespace = load_functions(
        "_refresh_native_view_cache", "_native_view_signature", "_native_view_appearance", "_place_picture_overlay_is_current",
        _get_current_3d_context=lambda: (region, rv3d, space),
        gpu=types.SimpleNamespace(state=gpu_state, types=types.SimpleNamespace(GPUOffScreen=Offscreen)),
        bpy=types.SimpleNamespace(context=context, app=types.SimpleNamespace(driver_namespace={})),
    )
    namespace["bpy"].app.driver_namespace[namespace["VIEWPORT_OVERLAY_NAMESPACE_KEY"]] = state
    return namespace, state, region, rv3d, space, gpu_state, allocations, renders, redraws


class ThemeGridDefaultsTests(unittest.TestCase):
    def test_new_and_legacy_project_states_default_off_but_explicit_choice_survives(self):
        namespace = load_functions("_empty_project_theme_state", "_normalize_project_theme_state")
        empty = namespace["_empty_project_theme_state"]()
        self.assertFalse(empty["place_picture"]["grid_enabled"])
        normalize = namespace["_normalize_project_theme_state"]
        legacy = {"format": empty["format"], "place_picture": {"enabled": True, "path": "photo.png"}}
        self.assertFalse(normalize(legacy)["place_picture"]["grid_enabled"])
        for enabled in (True, False):
            with self.subTest(enabled=enabled):
                legacy["place_picture"]["grid_enabled"] = enabled
                self.assertIs(normalize(legacy)["place_picture"]["grid_enabled"], enabled)

    def test_runtime_startup_capture_does_not_invent_a_grid(self):
        state = {"enabled": True, "path": "photo.png"}
        namespace = load_functions(
            "_startup_place_picture_state_from_runtime",
            _overlay_state=lambda: state,
            _project_relative_path=lambda path: "//" + path,
        )
        capture = namespace["_startup_place_picture_state_from_runtime"]
        self.assertFalse(capture()["grid_enabled"])
        state["grid_enabled"] = True
        self.assertTrue(capture()["grid_enabled"])
        state["enabled"] = False
        self.assertFalse(capture()["grid_enabled"])

    def test_saving_startup_for_a_new_image_does_not_enable_grid(self):
        state = {"enabled": True, "path": "old.png", "grid_enabled": True}
        namespace = load_functions(
            "_set_startup_place_picture_state",
            _overlay_state=lambda: state,
            _resolve_optional_image_path=lambda path: path,
            _read_string=lambda payload, key, default: payload.get(key, default),
            _read_grid_settings=lambda payload: (1.0, 5.0, 2.0),
            _read_owner_runtime_theme_state=lambda: {},
            _write_owner_runtime_theme_state=lambda value: value,
            _project_relative_path=lambda path: "//" + path,
            _startup_state_payload=lambda value: {},
            _result=lambda message, **payload: payload,
        )
        save = namespace["_set_startup_place_picture_state"]
        self.assertFalse(save(None, {"static_background_path": "new.png"})["grid_enabled"])
        self.assertTrue(save(None, {"static_background_path": "old.png"})["grid_enabled"])

    def test_place_picture_is_default_off_while_explicit_grid_action_enables_it(self):
        calls = []
        state = {"path": "photo.png"}

        def register(path, **options):
            calls.append((path, options))
            return path

        namespace = load_functions(
            "_place_picture_image", "_apply_grid_spacing",
            _overlay_state=lambda: state,
            _read_grid_settings=lambda payload: (1.0, 5.0, 2.0),
            _set_runtime_grid_settings=lambda *args: None,
            _resolve_optional_image_path=lambda path: path,
            _read_string=lambda payload, key, default: payload.get(key, default),
            _register_viewport_overlay_from_resolved_path=register,
            _set_saved_overlay_path=lambda path: None,
            _set_project_place_picture_state=lambda *args, **kwargs: None,
            _result=lambda message, **payload: payload,
        )
        place = namespace["_place_picture_image"]
        place(None, {"static_background_path": "photo.png"})
        self.assertFalse(calls[-1][1]["grid_enabled"])
        place(None, {"static_background_path": "photo.png", "grid_enabled": True})
        self.assertTrue(calls[-1][1]["grid_enabled"])
        result = namespace["_apply_grid_spacing"](None, {})
        self.assertTrue(calls[-1][1]["grid_enabled"])
        self.assertTrue(result["grid_enabled"])

    def test_no_missing_grid_flag_falls_back_to_true(self):
        fallbacks = [node for node in ast.walk(TREE)
                     if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                     and node.func.attr == "get" and len(node.args) >= 2
                     and isinstance(node.args[0], ast.Constant) and node.args[0].value == "grid_enabled"
                     and isinstance(node.args[1], ast.Constant) and node.args[1].value is True]
        self.assertEqual([node.lineno for node in fallbacks], [])


class ThemeGridViewportTests(unittest.TestCase):
    def test_retired_overlay_state_cannot_draw_when_a_new_owner_reuses_its_generation(self):
        active = {"enabled": True, "generation": 2}
        retired = {"enabled": True, "generation": 2}
        driver_namespace = {}
        namespace = load_functions(
            "_place_picture_overlay_is_current",
            bpy=types.SimpleNamespace(app=types.SimpleNamespace(driver_namespace=driver_namespace)),
        )
        driver_namespace[namespace["VIEWPORT_OVERLAY_NAMESPACE_KEY"]] = active
        is_current = namespace["_place_picture_overlay_is_current"]
        self.assertTrue(is_current(active, 2))
        self.assertFalse(is_current(retired, 2), "equal generation values must not revive a retired overlay")
        self.assertFalse(is_current(active, 1))
        active["enabled"] = False
        self.assertFalse(is_current(active, 2))
        active["enabled"] = True
        driver_namespace.clear()
        self.assertFalse(is_current(active, 2))

    def test_native_cache_refreshes_after_view_and_before_pixel_gizmos(self):
        namespace, state, handlers, _removed, gpu_state, matrices, draws = registered_overlay()
        namespace["_register_viewport_overlay_from_resolved_path"]("photo.png", grid_enabled=True)
        self.assertEqual(handlers[state["background_handler"]]["stage"], "POST_VIEW")
        self.assertIsNone(state["grid_handler"], "native grid rendering must not register a synthetic grid callback")
        self.assertEqual(handlers[state["native_view_handler"]]["stage"], "POST_PIXEL")
        self.assertEqual(handlers[state["overlay_handler"]]["stage"], "POST_PIXEL")
        self.assertLess(list(handlers).index(state["native_view_handler"]), list(handlers).index(state["overlay_handler"]))
        before = gpu_state.snapshot()
        handlers[state["native_view_handler"]]["callback"]()
        self.assertEqual(draws, [("refresh", state["generation"])])
        handlers[state["overlay_handler"]]["callback"]()
        self.assertEqual(draws[-1], ("gizmos", ("ALPHA", "NONE", False, 3.5), "identity", "pixel-projection"))
        self.assertEqual(gpu_state.snapshot(), before)
        self.assertEqual((matrices.view, matrices.projection, matrices.projection_depth), ("initial-view", "initial-projection", 0))

    def test_cached_native_view_composites_over_fixed_picture_and_restores_draw_state(self):
        namespace, state, handlers, _removed, gpu_state, matrices, draws = registered_overlay()
        namespace["_register_viewport_overlay_from_resolved_path"]("photo.png", grid_enabled=True)
        callback = handlers[state["background_handler"]]["callback"]
        before = gpu_state.snapshot()
        callback()
        self.assertEqual([entry[0] for entry in draws], ["IMAGE"])
        self.assertEqual(draws[-1][1][1:3], ("LESS_EQUAL", False), "before the first cache, the picture stays behind scene depth")
        state["native_view_caches"][17] = {"ready": True, "size": (640, 480), "signature": 0, "offscreen": types.SimpleNamespace(texture_color=object())}
        draws.clear()
        callback()
        self.assertEqual([entry[0] for entry in draws], ["IMAGE", "native"])
        self.assertEqual(draws[0][1][1:3], ("NONE", False))
        self.assertEqual(draws[1][1], ("ALPHA_PREMULT", "NONE", False, 3.5))
        self.assertEqual(gpu_state.snapshot(), before)
        self.assertEqual((matrices.view, matrices.projection, matrices.projection_depth), ("initial-view", "initial-projection", 0))

        def fail_draw(*args):
            raise RuntimeError("batch failed")

        namespace["batch_for_shader"] = lambda *args, **kwargs: types.SimpleNamespace(draw=fail_draw)
        with self.assertRaisesRegex(RuntimeError, "batch failed"):
            callback()
        self.assertEqual(gpu_state.snapshot(), before)
        self.assertEqual((matrices.view, matrices.projection, matrices.projection_depth), ("initial-view", "initial-projection", 0))

    def test_stale_native_geometry_is_not_presented_over_current_view(self):
        namespace, state, handlers, _removed, _gpu_state, _matrices, draws = registered_overlay()
        namespace["_register_viewport_overlay_from_resolved_path"]("photo.png", grid_enabled=True)
        state["native_view_caches"][17] = {"ready": True, "size": (640, 480), "signature": 0, "offscreen": types.SimpleNamespace(texture_color=object())}
        state["scene_revision"] = 1
        handlers[state["background_handler"]]["callback"]()
        self.assertEqual([entry[0] for entry in draws], ["IMAGE"])
        self.assertEqual(draws[0][1][1:3], ("LESS_EQUAL", False), "stale cached geometry must fall back to the picture behind current scene depth")

    def test_default_registration_has_no_native_render_and_clear_retires_callbacks(self):
        namespace, state, handlers, removed, _gpu_state, _matrices, draws = registered_overlay()
        namespace["_register_viewport_overlay_from_resolved_path"]("photo.png")
        self.assertIsNone(state["native_view_handler"])
        self.assertIsNone(state["grid_handler"])
        self.assertEqual(namespace["bpy"].app.handlers.depsgraph_update_post, [])
        picture_callback = handlers[state["background_handler"]]["callback"]
        gizmo_callback = handlers[state["overlay_handler"]]["callback"]
        picture_callback()
        gizmo_callback()
        self.assertEqual([entry[0] for entry in draws], ["IMAGE", "gizmos"])
        namespace["_remove_viewport_overlay_handler"]()
        self.assertEqual(len(removed), 2)
        self.assertEqual(state, {})
        count = len(draws)
        picture_callback()
        gizmo_callback()
        self.assertEqual(len(draws), count, "removed callbacks must no longer draw")

    def test_scene_update_callback_only_invalidates_its_current_owner(self):
        namespace, state, _handlers, _removed, _gpu_state, _matrices, _draws = registered_overlay()
        namespace["_register_viewport_overlay_from_resolved_path"]("photo.png", grid_enabled=True)
        callback = state["native_view_update_handler"]
        callback(None, None)
        self.assertEqual(state["scene_revision"], 1)
        namespace["bpy"].app.driver_namespace[namespace["VIEWPORT_OVERLAY_NAMESPACE_KEY"]] = dict(state)
        callback(None, None)
        self.assertEqual(state["scene_revision"], 1, "retired dependency-graph callbacks must not affect another owner")

    def test_native_grid_floor_and_axes_restore_exactly_on_clear(self):
        overlay = types.SimpleNamespace(
            show_overlays=False, show_floor=True, show_ortho_grid=True,
            show_axis_x=False, show_axis_y=True, show_axis_z=False, show_extras=False,
        )
        shading = types.SimpleNamespace(
            type="MATERIAL", show_xray=True, show_xray_wireframe=True,
            background_type="WORLD", use_compositor="ALWAYS",
        )
        space = types.SimpleNamespace(
            overlay=overlay, shading=shading, show_gizmo=False,
            show_gizmo_object_translate=True, show_gizmo_object_rotate=False, show_gizmo_object_scale=True,
        )
        before = (vars(overlay).copy(), vars(shading).copy(), {key: value for key, value in vars(space).items() if key not in ("overlay", "shading")})
        state = {}
        namespace = load_functions(
            "_snapshot_place_picture_viewports", "_apply_place_picture_viewport_settings",
            "_restore_place_picture_viewports", "_remove_viewport_overlay_handler", "_set_native_grid_visibility",
            _iter_view3d_spaces=lambda: [space],
            _safe_set=lambda obj, attr, value: setattr(obj, attr, value),
            _overlay_state=lambda: state,
            _bump_place_picture_generation=lambda: 1,
            _remove_place_picture_draw_handlers=lambda value: None,
            _tag_redraw_view3d=lambda: None,
        )
        state["viewport_snapshots"] = namespace["_snapshot_place_picture_viewports"]()
        namespace["_apply_place_picture_viewport_settings"]()
        for flag in ("show_floor", "show_ortho_grid", "show_axis_x", "show_axis_y", "show_axis_z"):
            self.assertFalse(getattr(overlay, flag), flag)
        namespace["_apply_place_picture_viewport_settings"](grid_enabled=True)
        for flag in ("show_floor", "show_ortho_grid", "show_axis_x", "show_axis_y"):
            self.assertTrue(getattr(overlay, flag), flag)
        self.assertFalse(overlay.show_axis_z)
        namespace["_remove_viewport_overlay_handler"]()
        self.assertEqual(vars(overlay), before[0])
        self.assertEqual(vars(shading), before[1])
        self.assertEqual({key: value for key, value in vars(space).items() if key not in ("overlay", "shading")}, before[2])
        self.assertEqual(state, {})

    def test_cleanup_removes_grid_handler_and_each_shared_handle_once(self):
        removed = []
        owned_update = lambda *args: None
        unrelated_update = lambda *args: None
        update_handlers = [unrelated_update, owned_update]

        def remove(handle, region):
            removed.append((handle, region))
            if handle == "background":
                raise RuntimeError("already removed")

        namespace = load_functions(
            "_remove_place_picture_draw_handlers", "_free_native_view_caches",
            bpy=types.SimpleNamespace(
                types=types.SimpleNamespace(SpaceView3D=types.SimpleNamespace(draw_handler_remove=remove)),
                app=types.SimpleNamespace(handlers=types.SimpleNamespace(depsgraph_update_post=update_handlers)),
            ),
        )
        state = {"enabled": True, "handler": "background", "background_handler": "background", "grid_handler": "grid", "overlay_handler": "gizmo", "native_view_handler": "native", "native_view_update_handler": owned_update}
        namespace["_remove_place_picture_draw_handlers"](state)
        self.assertEqual(set(removed), {("background", "WINDOW"), ("grid", "WINDOW"), ("gizmo", "WINDOW"), ("native", "WINDOW")})
        self.assertEqual(len(removed), 4)
        self.assertFalse(state["enabled"])
        self.assertEqual(update_handlers, [unrelated_update])


class NativeGridCacheTests(unittest.TestCase):
    def test_theme_color_management_and_units_invalidate_pending_followup(self):
        namespace, state, _region, _rv3d, _space, _gpu_state, _allocations, renders, _redraws = native_cache_fixture()
        context = namespace["bpy"].context
        refresh = namespace["_refresh_native_view_cache"]
        refresh(state, 2)
        changes = (
            (context.preferences.themes[0].view_3d, "grid", [0.7, 0.1, 0.5]),
            (context.preferences.themes[0].user_interface, "axis_x", [1.0, 0.0, 0.0]),
            (context.scene.view_settings, "gamma", 1.5),
            (context.scene.display_settings, "display_device", "Display P3"),
            (context.scene.unit_settings, "system", "METRIC"),
            (context.scene.unit_settings, "scale_length", 0.01),
        )
        for index, (settings, name, value) in enumerate(changes, start=2):
            with self.subTest(setting=name):
                setattr(settings, name, value)
                refresh(state, 2)
                self.assertEqual(len(renders), index, "appearance changes must invalidate the presentation-only redraw")
        self.assertEqual(state["scene_revision"], 0, "these changes do not rely on a depsgraph update")

    def test_appearance_changes_invalidate_followup_and_capture_array_values(self):
        namespace, state, _region, _rv3d, space, _gpu_state, _allocations, renders, _redraws = native_cache_fixture()
        refresh = namespace["_refresh_native_view_cache"]
        refresh(state, 2)
        original = state["native_view_caches"][17]["signature"]
        space.shading.show_cavity = True
        refresh(state, 2)
        self.assertEqual(len(renders), 2)
        space.overlay.show_wireframes = True
        refresh(state, 2)
        self.assertEqual(len(renders), 3)
        space.shading.single_color[0] = 0.1
        refresh(state, 2)
        self.assertEqual(len(renders), 4)
        self.assertNotEqual(original, state["native_view_caches"][17]["signature"])
        space.shading.show_cavity = False
        space.overlay.show_wireframes = False
        self.assertNotEqual(original, namespace["_native_view_signature"](namespace["bpy"].context, _region, _rv3d, space, state), "the saved signature must own a copy of mutable RNA arrays")

    def test_refresh_reuses_cache_and_skips_only_one_unchanged_followup(self):
        namespace, state, _region, _rv3d, _space, gpu_state, allocations, renders, redraws = native_cache_fixture()
        refresh = namespace["_refresh_native_view_cache"]
        before = gpu_state.snapshot(), gpu_state.viewport
        refresh(state, 2)
        self.assertEqual(len(allocations), 1)
        self.assertEqual(allocations[0].size, (640, 480))
        self.assertEqual(renders[0][2], {"do_color_management": True, "draw_background": False})
        self.assertTrue(state["native_view_caches"][17]["ready"])
        self.assertEqual(len(redraws), 1)
        self.assertEqual((gpu_state.snapshot(), gpu_state.viewport), before)
        refresh(state, 2)
        self.assertEqual(len(renders), 1, "the presentation-only followup must not render recursively forever")
        refresh(state, 2)
        self.assertEqual(len(renders), 2, "a later native frame must refresh without allocating again")
        self.assertEqual(len(allocations), 1)

    def test_scene_or_view_changes_during_followup_render_immediately(self):
        namespace, state, _region, rv3d, space, _gpu_state, _allocations, renders, _redraws = native_cache_fixture()
        refresh = namespace["_refresh_native_view_cache"]
        refresh(state, 2)
        state["scene_revision"] += 1
        refresh(state, 2)
        self.assertEqual(len(renders), 2)
        rv3d.view_matrix = ((1, 0), (0, 2))
        refresh(state, 2)
        self.assertEqual(len(renders), 3)
        space.overlay.grid_scale = 2.0
        refresh(state, 2)
        self.assertEqual(len(renders), 4)

    def test_resize_frees_old_cache_and_another_region_gets_independent_allocation(self):
        namespace, state, region, _rv3d, _space, _gpu_state, allocations, renders, _redraws = native_cache_fixture()
        refresh = namespace["_refresh_native_view_cache"]
        refresh(state, 2)
        region.width = 800
        refresh(state, 2)
        self.assertEqual(allocations[0].frees, 1)
        self.assertEqual(allocations[1].size, (800, 480))
        self.assertIs(state["native_view_caches"][17]["offscreen"], allocations[1])
        namespace["bpy"].context.area.regions.append(types.SimpleNamespace(type="WINDOW", as_pointer=lambda: 17))
        region.as_pointer = lambda: 18
        refresh(state, 2)
        self.assertEqual(len(allocations), 3)
        self.assertEqual(set(state["native_view_caches"]), {17, 18})
        self.assertEqual(len(renders), 3)
        namespace["bpy"].context.area.regions.pop()
        refresh(state, 2)
        self.assertEqual(allocations[1].frees, 1, "closing a region must release its unused GPU allocation")
        self.assertEqual(set(state["native_view_caches"]), {18})

    def test_failed_native_render_invalidates_cache_and_restores_gpu_state(self):
        namespace, state, _region, _rv3d, _space, gpu_state, allocations, _renders, _redraws = native_cache_fixture()
        refresh = namespace["_refresh_native_view_cache"]
        refresh(state, 2)
        allocations[0].fail = True
        state["scene_revision"] += 1
        before = gpu_state.snapshot(), gpu_state.viewport
        refresh(state, 2)
        self.assertFalse(state["native_view_caches"][17]["ready"])
        self.assertEqual(state["native_view_error"], "native render failed")
        self.assertEqual((gpu_state.snapshot(), gpu_state.viewport), before)
        allocations[0].fail = False
        refresh(state, 2)
        self.assertTrue(state["native_view_caches"][17]["ready"])
        self.assertNotIn("native_view_error", state)

    def test_inactive_disabled_grid_missing_image_or_context_never_allocates(self):
        namespace, state, _region, _rv3d, _space, _gpu_state, allocations, renders, _redraws = native_cache_fixture()
        refresh = namespace["_refresh_native_view_cache"]
        for key, value in (("enabled", False), ("grid_enabled", False), ("image", None), ("generation", 3)):
            previous = state[key]
            state[key] = value
            refresh(state, 2)
            state[key] = previous
        namespace["_get_current_3d_context"] = lambda: (None, None, None)
        refresh(state, 2)
        self.assertEqual(allocations, [])
        self.assertEqual(renders, [])

    def test_visibility_toggle_uses_native_floor_orthographic_grid_and_xy_axes_only(self):
        overlay = types.SimpleNamespace(show_floor=False, show_ortho_grid=False, show_axis_x=False, show_axis_y=False, show_axis_z=True)
        namespace = load_functions(
            "_set_native_grid_visibility",
            _iter_view3d_spaces=lambda: [types.SimpleNamespace(overlay=overlay)],
            _safe_set=lambda obj, attr, value: setattr(obj, attr, value),
        )
        for enabled in (True, False, True):
            namespace["_set_native_grid_visibility"](enabled)
            self.assertEqual((overlay.show_floor, overlay.show_ortho_grid, overlay.show_axis_x, overlay.show_axis_y), (enabled,) * 4)
            self.assertFalse(overlay.show_axis_z)

    def test_cache_cleanup_frees_each_allocation_once_and_continues_after_errors(self):
        freed = []
        first = types.SimpleNamespace(free=lambda: freed.append("first"))
        last = types.SimpleNamespace(free=lambda: freed.append("last"))

        def free_broken():
            freed.append("broken")
            raise RuntimeError("GPU context already closed")

        broken = types.SimpleNamespace(free=free_broken)
        state = {"native_view_caches": {
            1: {"offscreen": first}, 2: {"offscreen": broken}, 3: {"offscreen": last},
        }, "path": "photo.png", "enabled": True}
        cleanup = load_functions("_free_native_view_caches")["_free_native_view_caches"]
        cleanup(state)
        cleanup(state)
        self.assertCountEqual(freed, ["first", "broken", "last"])
        self.assertFalse(state.get("native_view_caches"))
        self.assertEqual(state["path"], "photo.png")
        self.assertTrue(state["enabled"])

    def test_remove_grid_disables_native_visibility_and_frees_cache_without_clearing_picture(self):
        freed, visibility, saved = [], [], []
        state = {"enabled": True, "path": "photo.png", "grid_enabled": True,
                 "background_handler": "picture", "overlay_handler": "gizmos",
                 "native_view_caches": {1: {"offscreen": types.SimpleNamespace(free=lambda: freed.append(1))}}}
        namespace = load_functions(
            "_remove_place_picture_grid", "_free_native_view_caches",
            _overlay_state=lambda: state,
            _set_native_grid_visibility=lambda enabled: visibility.append(enabled),
            _set_project_place_picture_state=lambda *args, **kwargs: saved.append(kwargs),
            _tag_redraw_view3d=lambda: None,
            _result=lambda message, **payload: payload,
        )
        result = namespace["_remove_place_picture_grid"]()
        self.assertFalse(result["grid_enabled"])
        self.assertEqual(visibility, [False])
        self.assertEqual(freed, [1])
        self.assertEqual(state["path"], "photo.png")
        self.assertTrue(state["enabled"])
        self.assertEqual((state["background_handler"], state["overlay_handler"]), ("picture", "gizmos"))
        self.assertFalse(saved[-1]["grid_enabled"])


if __name__ == "__main__":
    unittest.main()
