"""Run with Blender --background --factory-startup --python-exit-code 1 --python <this file>."""

import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

import bpy


PACKAGE = Path(__file__).resolve().parents[1] / "Blender Git Scripts/Toolsets/theme"
SPEC = importlib.util.spec_from_file_location("flowcell_theme_bucket_probe", PACKAGE / "theme.py")
THEME = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(THEME)
CONFIG = json.loads((PACKAGE / "flowcell.script.json").read_text(encoding="utf-8-sig"))["page"]["config"]
FIELDS = {field["id"]: field["defaultValue"] for field in CONFIG["fields"] if "defaultValue" in field}
DEFAULTS = {key: FIELDS[field_id] for key, field_id in CONFIG["payloadMaps"]["theme"].items()}
COLORS = {
    "search_field_text_hex": "#13579B",
    "outliner_active_hex": "#123456",
    "outliner_active_text_hex": "#FEDCBA",
    "outliner_selected_hex": "#654321",
    "outliner_selected_text_hex": "#ABCDEF",
}


class ThemeBucketTests(unittest.TestCase):
    def setUp(self):
        self.theme = bpy.context.preferences.themes[0]
        self.payload = {**DEFAULTS, **COLORS}
        self.persistence = patch.object(THEME, "_set_project_theme_state_from_role_hexes")
        self.persist = self.persistence.start()
        self.addCleanup(self.persistence.stop)

    def assert_colors(self, expected):
        ui = self.theme.user_interface
        outliner = self.theme.outliner
        for key, value in {
            "search_field_text_hex": ui.wcol_text.text,
            "outliner_active_hex": outliner.active,
            "outliner_active_text_hex": outliner.active_object,
            "outliner_selected_hex": outliner.selected_highlight,
            "outliner_selected_text_hex": outliner.selected_object,
        }.items():
            self.assertEqual(THEME._rgb_to_hex(value), expected[key], key)
        self.assertEqual(THEME._rgb_to_hex(ui.wcol_text.text_sel), expected["search_field_text_hex"])

    def test_full_apply_and_absorb_use_actual_blender_rna(self):
        THEME._apply_theme_from_photo_manual_colors(bpy.context, self.payload, persist_project_state=False)
        self.assert_colors(COLORS)
        absorbed = THEME._absorb_current_theme(bpy.context)["fieldPatch"]
        self.assertEqual({key: absorbed[key] for key in COLORS}, COLORS)
        self.assertNotEqual(THEME._rgb_to_hex(self.theme.user_interface.wcol_num.text), COLORS["search_field_text_hex"])
        self.persist.assert_not_called()

    def test_each_bucket_keeps_the_other_independent_colors(self):
        for key in COLORS:
            with self.subTest(bucket=key):
                result = THEME._apply_theme_bucket(bpy.context, {
                    **self.payload, "bucket": key, "bucket_hex": "#C0FFEE",
                })
                self.assertEqual(result["bucket"], key)
                self.assert_colors({**COLORS, key: "#C0FFEE"})

    def test_legacy_themes_keep_the_previous_color_sources(self):
        for mode in ("dark", "light"):
            with self.subTest(mode=mode):
                legacy = {key: value for key, value in DEFAULTS.items() if key not in COLORS}
                legacy.update(visual_mode=mode, control_text_hex="#F0E0D0", accent_text_hex="#FFA8D4", highlights_hex="#EDEDED")
                THEME._apply_theme_from_photo_manual_colors(bpy.context, legacy, persist_project_state=False)
                self.assert_colors({
                    "search_field_text_hex": "#F0E0D0",
                    "outliner_active_hex": "#FFFFFF" if mode == "light" else "#000000",
                    "outliner_active_text_hex": "#FFA8D4",
                    "outliner_selected_hex": "#EDEDED",
                    "outliner_selected_text_hex": "#FFA8D4",
                })
                legacy.pop("control_text_hex")
                legacy.pop("accent_text_hex")
                roles = THEME._read_theme_role_hexes(legacy)
                self.assertEqual(roles["search_field_text_hex"], legacy["text_hex"])
                self.assertEqual(roles["outliner_selected_text_hex"], legacy["highlights_hex"])

    def test_explicit_colors_are_not_replaced_by_contrast_correction(self):
        exact = {key: "#778899" for key in COLORS}
        THEME._apply_theme_from_photo_manual_colors(bpy.context, {
            **self.payload, **exact, "controls_hex": "#778899", "highlights_hex": "#778899",
        }, persist_project_state=False)
        self.assert_colors(exact)

    def test_project_restore_payload_retains_all_five_buckets(self):
        roles = THEME._read_theme_role_hexes(self.payload)
        saved = THEME._theme_project_payload_from_role_hexes(roles, "dark", False)
        restored = THEME._normalize_project_theme_state({"format": THEME.PROJECT_THEME_STATE_FORMAT, "theme": saved})
        self.assertTrue(set(COLORS).issubset(THEME.PROJECT_THEME_STATE_THEME_KEYS))
        THEME._apply_theme_from_photo_manual_colors(bpy.context, restored["theme"], persist_project_state=False)
        self.assert_colors(COLORS)


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ThemeBucketTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise RuntimeError("Blender theme bucket regression failed")
