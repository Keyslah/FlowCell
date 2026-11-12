"""Exercise the bundled host transaction without starting Blender or loading assets."""

import ast
import types
import unittest
from pathlib import Path


SOURCE = Path(__file__).resolve().parents[1] / "theme.py"
TREE = ast.parse(SOURCE.read_text(encoding="utf-8-sig"))
BUNDLE = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == "_apply_theme_bundle")


def host(**overrides):
    calls = []
    clock = types.SimpleNamespace(now=1.0)
    world = {"env": "env", "mapping": "mapping", "background": "background"}

    def record(name, result=None):
        def callback(*args):
            calls.append((name, args[-1] if args else None))
            return result
        return callback

    namespace = {
        "time": types.SimpleNamespace(time=lambda: clock.now),
        "DEFAULT_WORLD_STRENGTH": 1.0,
        "_result": lambda message: {"message": message},
        "_read_float": lambda payload, key, default: float(payload.get(key, default)),
        "_resolve_hdri_path": record("validate_environment"),
        "_resolve_optional_image_path": record("validate_picture"),
        "_ensure_world_state": record("world", world),
        "_clear_world_state": record("clear_world"),
        "_apply_hdri_image": record("environment"),
        "_ensure_hdri_image_if_missing": record("ensure_image"),
        "_set_rotation": record("rotation"),
        "_set_world_strength": record("strength"),
        "_place_picture_image": record("picture"),
        "_clear_place_picture_overlay": record("clear_picture"),
        "_apply_grid_spacing": record("grid"),
        "_remove_place_picture_grid": record("remove_grid"),
        "_apply_theme_from_photo_manual_colors": record("theme"),
    }
    namespace.update(overrides)
    exec(compile(ast.Module(body=[BUNDLE], type_ignores=[]), str(SOURCE), "exec"), namespace)
    return namespace["_apply_theme_bundle"], calls, clock


class ThemeBundleTests(unittest.TestCase):
    def test_orders_environment_picture_then_theme_snapshot_with_one_world_setup(self):
        apply, calls, _ = host()
        environment = {"hdri_path": "sky.hdr", "rotation_x_deg": 1, "rotation_y_deg": 2, "rotation_z_deg": 3, "world_strength": 2.5}
        picture = {"mode": "replace", "static_background_path": "picture.png", "grid_enabled": True}
        result = apply(None, {"environment": environment, "picture": picture, "theme": {"tabs_hex": "#123456"}})
        self.assertEqual([name for name, _ in calls], ["validate_environment", "validate_picture", "world", "environment",
            "ensure_image", "rotation", "ensure_image", "rotation", "ensure_image", "rotation", "ensure_image", "strength", "picture", "theme"])
        self.assertEqual(result, {"message": "Blender theme bundle applied."})

    def test_omitted_groups_and_noop_do_not_touch_world_or_picture(self):
        apply, calls, _ = host()
        apply(None, {"theme": {"tabs_hex": "#123456"}})
        self.assertEqual([name for name, _ in calls], ["theme"])
        calls.clear()
        apply(None, {})
        self.assertEqual(calls, [])

    def test_clear_environment_restores_picture_before_theme_without_default_hdri(self):
        apply, calls, _ = host()
        apply(None, {"environment": {"hdri_path": "", "world_strength": 2.5},
            "picture": {"mode": "replace", "static_background_path": "keep.png", "grid_enabled": False}, "theme": {}})
        self.assertEqual([name for name, _ in calls], ["validate_picture", "clear_world", "picture", "theme"])

    def test_empty_picture_restores_explicit_grid_and_grid_only_preserves_picture(self):
        for enabled in (False, True):
            apply, calls, _ = host()
            picture = {"mode": "replace", "static_background_path": "", "grid_enabled": enabled}
            apply(None, {"picture": picture})
            self.assertEqual([name for name, _ in calls], ["clear_picture", "grid" if enabled else "remove_grid"])
            calls.clear()
            apply(None, {"picture": {**picture, "mode": "grid", "static_background_path": "keep.png"}})
            self.assertEqual([name for name, _ in calls], ["grid" if enabled else "remove_grid"])

    def test_missing_asset_fails_before_any_host_mutation(self):
        def missing(_path):
            raise ValueError("missing picture")
        apply, calls, _ = host(_resolve_optional_image_path=missing)
        with self.assertRaisesRegex(ValueError, "missing picture"):
            apply(None, {"environment": {"hdri_path": "sky.hdr"},
                "picture": {"mode": "replace", "static_background_path": "missing.png"}})
        self.assertEqual([name for name, _ in calls], ["validate_environment"])

    def test_clear_requires_picture_restore_and_failure_stops_later_sections(self):
        apply, calls, _ = host()
        with self.assertRaisesRegex(ValueError, "requires its picture/grid restore"):
            apply(None, {"environment": {"hdri_path": ""}})
        self.assertEqual(calls, [])
        def fail(*_args):
            raise RuntimeError("picture failed")
        apply, calls, _ = host(_place_picture_image=fail)
        with self.assertRaisesRegex(RuntimeError, "picture failed"):
            apply(None, {"picture": {"mode": "replace", "static_background_path": "image.png"}, "theme": {}})
        self.assertEqual([name for name, _ in calls], ["validate_picture"])

    def test_expired_deadline_prevents_late_execution_and_later_host_steps(self):
        apply, calls, clock = host()
        with self.assertRaisesRegex(RuntimeError, "FLOWCELL_THEME_OUTCOME_UNKNOWN"):
            apply(None, {"__flowcell_theme_deadline_ms": 1000, "theme": {}})
        self.assertEqual(calls, [])
        def slow_picture(*_args):
            clock.now = 3.0
        apply, calls, clock = host(_place_picture_image=slow_picture)
        with self.assertRaisesRegex(RuntimeError, "FLOWCELL_THEME_OUTCOME_UNKNOWN"):
            apply(None, {"__flowcell_theme_deadline_ms": 2000,
                "picture": {"mode": "replace", "static_background_path": "image.png"}, "theme": {}})
        self.assertEqual([name for name, _ in calls], ["validate_picture"])


if __name__ == "__main__":
    unittest.main()
