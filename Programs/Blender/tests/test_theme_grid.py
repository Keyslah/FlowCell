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
    region = types.SimpleNamespace(width=640, height=480)
    rv3d = types.SimpleNamespace(view_matrix="world-view", window_matrix="world-projection")

    def add_handler(callback, args, region_type, stage):
        handle = f"handle-{len(handlers)}"
        handlers[handle] = {"callback": callback, "args": args, "region": region_type, "stage": stage}
        return handle

    namespace = load_functions(
        "_register_viewport_overlay_from_resolved_path", "_remove_place_picture_draw_handlers",
        "_place_picture_overlay_is_current", "_remove_viewport_overlay_handler", "_remove_place_picture_grid",
        _overlay_state=lambda: state,
        _disable_camera_background_images=lambda: None,
        _snapshot_place_picture_viewports=lambda: [],
        _apply_place_picture_viewport_settings=lambda: None,
        _restore_place_picture_viewports=lambda state: None,
        _bump_place_picture_generation=lambda: 1,
        _register_place_picture_modal_operator=lambda: None,
        _start_place_picture_modal_operator=lambda: None,
        _tag_redraw_view3d=lambda: None,
        _set_project_place_picture_state=lambda *args, **kwargs: None,
        _result=lambda message, **payload: payload,
        _get_current_3d_context=lambda: (region, rv3d, object()),
        _draw_fake_grid_3d=lambda *args: draws.append(("grid", gpu_state.snapshot(), gpu_matrix.view, gpu_matrix.projection)),
        _draw_fake_gizmos_2d=lambda *args: draws.append(("gizmos", gpu_state.snapshot(), gpu_matrix.view, gpu_matrix.projection)),
        _pixel_projection=lambda *args: "pixel-projection",
        Matrix=types.SimpleNamespace(Identity=lambda size: "identity"),
        gpu=types.SimpleNamespace(state=gpu_state, matrix=gpu_matrix, shader=types.SimpleNamespace(from_builtin=lambda name: object())),
        bpy=types.SimpleNamespace(
            types=types.SimpleNamespace(SpaceView3D=types.SimpleNamespace(
                draw_handler_add=add_handler, draw_handler_remove=lambda handle, region: removed.append((handle, region)),
            )),
            data=types.SimpleNamespace(images=types.SimpleNamespace(load=lambda path, **kwargs: types.SimpleNamespace(filepath=path, size=(64, 64), pixels=[1.0]))),
            ops=types.SimpleNamespace(wm=types.SimpleNamespace(redraw_timer=lambda **kwargs: None)),
        ),
    )
    namespace["bpy"].app = types.SimpleNamespace(driver_namespace={namespace["VIEWPORT_OVERLAY_NAMESPACE_KEY"]: state})
    return namespace, state, handlers, removed, gpu_state, gpu_matrix, draws


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

    def test_grid_uses_world_draw_stage_and_scene_depth_while_gizmos_stay_in_pixels(self):
        namespace, state, handlers, _removed, gpu_state, matrices, draws = registered_overlay()
        namespace["_register_viewport_overlay_from_resolved_path"]("photo.png", grid_enabled=True)
        self.assertEqual(handlers[state["background_handler"]]["stage"], "POST_VIEW")
        self.assertEqual(handlers[state["grid_handler"]]["stage"], "POST_VIEW")
        self.assertEqual(handlers[state["overlay_handler"]]["stage"], "POST_PIXEL")
        before = gpu_state.snapshot()
        handlers[state["grid_handler"]]["callback"]()
        self.assertEqual(draws, [("grid", ("ALPHA", "LESS_EQUAL", False, 3.5), "world-view", "world-projection")])
        self.assertEqual(gpu_state.snapshot(), before)
        self.assertEqual((matrices.view, matrices.projection, matrices.projection_depth), ("initial-view", "initial-projection", 0))
        handlers[state["overlay_handler"]]["callback"]()
        self.assertEqual(draws[-1], ("gizmos", ("ALPHA", "NONE", False, 3.5), "identity", "pixel-projection"))
        self.assertEqual([entry[0] for entry in draws], ["grid", "gizmos"], "POST_PIXEL must never draw the grid")
        self.assertEqual(gpu_state.snapshot(), before)

    def test_grid_callback_restores_gpu_and_matrix_state_when_drawing_raises(self):
        namespace, state, handlers, _removed, gpu_state, matrices, _draws = registered_overlay()
        namespace["_register_viewport_overlay_from_resolved_path"]("", grid_only=True, grid_enabled=True)

        def fail_draw(*args):
            raise RuntimeError("batch failed")

        namespace["_draw_fake_grid_3d"] = fail_draw
        before = gpu_state.snapshot()
        with self.assertRaisesRegex(RuntimeError, "batch failed"):
            handlers[state["grid_handler"]]["callback"]()
        self.assertEqual(gpu_state.snapshot(), before)
        self.assertEqual((matrices.view, matrices.projection, matrices.projection_depth), ("initial-view", "initial-projection", 0))

    def test_default_registration_and_remove_grid_leave_picture_and_gizmos_available(self):
        namespace, state, handlers, removed, _gpu_state, _matrices, draws = registered_overlay()
        namespace["_register_viewport_overlay_from_resolved_path"]("photo.png")
        grid_callback = handlers[state["grid_handler"]]["callback"]
        gizmo_callback = handlers[state["overlay_handler"]]["callback"]
        grid_callback()
        self.assertEqual(draws, [])
        gizmo_callback()
        self.assertEqual(draws[-1][0], "gizmos")
        state["grid_enabled"] = True
        grid_callback()
        self.assertEqual(draws[-1][0], "grid")
        namespace["_remove_place_picture_grid"]()
        count = len(draws)
        grid_callback()
        self.assertEqual(len(draws), count)
        self.assertEqual(state["path"], "photo.png")
        self.assertTrue(state["enabled"])
        self.assertEqual(removed, [])
        gizmo_callback()
        self.assertEqual(draws[-1][0], "gizmos")
        namespace["_remove_viewport_overlay_handler"]()
        self.assertEqual(len(removed), 3)
        self.assertEqual(state, {})
        count = len(draws)
        grid_callback()
        gizmo_callback()
        self.assertEqual(len(draws), count, "removed callbacks must no longer draw")

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
            "_restore_place_picture_viewports", "_remove_viewport_overlay_handler",
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
        namespace["_remove_viewport_overlay_handler"]()
        self.assertEqual(vars(overlay), before[0])
        self.assertEqual(vars(shading), before[1])
        self.assertEqual({key: value for key, value in vars(space).items() if key not in ("overlay", "shading")}, before[2])
        self.assertEqual(state, {})

    def test_cleanup_removes_grid_handler_and_each_shared_handle_once(self):
        removed = []

        def remove(handle, region):
            removed.append((handle, region))
            if handle == "background":
                raise RuntimeError("already removed")

        namespace = load_functions(
            "_remove_place_picture_draw_handlers",
            bpy=types.SimpleNamespace(types=types.SimpleNamespace(SpaceView3D=types.SimpleNamespace(draw_handler_remove=remove))),
        )
        state = {"enabled": True, "handler": "background", "background_handler": "background", "grid_handler": "grid", "overlay_handler": "gizmo"}
        namespace["_remove_place_picture_draw_handlers"](state)
        self.assertEqual(set(removed), {("background", "WINDOW"), ("grid", "WINDOW"), ("gizmo", "WINDOW")})
        self.assertEqual(len(removed), 3)
        self.assertFalse(state["enabled"])


class ThemeGridGeometryTests(unittest.TestCase):
    def test_grid_segments_remain_on_world_xy_plane_and_line_count_is_bounded(self):
        for bounds in ((-2.0, 2.0, -3.0, 3.0, 1.0), (-100000.0, 100000.0, -200000.0, 200000.0, 0.001)):
            with self.subTest(bounds=bounds):
                batches = []
                namespace = load_functions(
                    "_draw_fake_grid_3d", "_nice_step_from_raw",
                    _get_visible_xy_grid_bounds=lambda *args: bounds,
                    _grid_spacing_blender_units=lambda value: value,
                    _xy_grid_grazing_factor=lambda rv3d: 0,
                    _draw_world_lines=lambda shader, points, color, width: batches.append(tuple(points)),
                )
                namespace["_draw_fake_grid_3d"](object(), object(), object())
                lines = set()
                for points in batches:
                    self.assertEqual(len(points) % 2, 0)
                    for first, second in zip(points[::2], points[1::2]):
                        self.assertEqual(len(first), 3)
                        self.assertEqual(len(second), 3)
                        self.assertEqual((first[2], second[2]), (0.0, 0.0))
                        self.assertTrue(first[0] == second[0] or first[1] == second[1])
                        self.assertTrue(all(math.isfinite(value) for point in (first, second) for value in point))
                        lines.add((first, second))
                self.assertTrue(lines)
                self.assertLessEqual(len(lines), 2 * (namespace["PLACE_PICTURE_MAX_GRID_LINES_PER_AXIS"] + 3))
                self.assertTrue(any(first[0] == second[0] == 0.0 for first, second in lines), "world Y axis is present")
                self.assertTrue(any(first[1] == second[1] == 0.0 for first, second in lines), "world X axis is present")
                if bounds[-1] == 1.0:
                    self.assertIn(((-2.0, -3.0, 0.0), (-2.0, 3.0, 0.0)), lines)

    def test_world_batch_preserves_z_and_restores_line_width_after_failure(self):
        gpu_state = FakeGpuState()
        captured = []
        shader = types.SimpleNamespace(bind=lambda: None, uniform_float=lambda *args: None)

        def create_batch(_shader, mode, data):
            captured.append((mode, data))

            def draw(_shader):
                self.assertEqual(gpu_state.width, 2.0)
                raise RuntimeError("world batch failed")

            return types.SimpleNamespace(draw=draw)

        namespace = load_functions("_draw_world_lines", gpu=types.SimpleNamespace(state=gpu_state), batch_for_shader=create_batch)
        points = [(1.0, 2.0, 3.0), (4.0, 5.0, 6.0)]
        with self.assertRaisesRegex(RuntimeError, "world batch failed"):
            namespace["_draw_world_lines"](shader, points, (1.0, 1.0, 1.0, 1.0), 2.0)
        self.assertEqual(captured, [("LINES", {"pos": points})])
        self.assertEqual(gpu_state.width, 3.5)


if __name__ == "__main__":
    unittest.main()
