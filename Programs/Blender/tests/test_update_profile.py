"""Cover the preference decision before the updater writes the Blender bridge."""
import os
from pathlib import Path
import runpy
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch


PROFILE_SCRIPT = (Path(__file__).resolve().parents[3] / "FlowCellFrontend" / "src-tauri"
                  / "src" / "commands" / "prepare_update_profile.py")


class UpdateProfileTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.profile = Path(temp.name)
        self.preferences = self.profile / "config" / "userpref.blend"
        self.preferences.parent.mkdir()
        blender = Mock()
        blender.app.version_string = "5.3.0"
        blender.utils.user_resource.side_effect = lambda kind: str(self.profile / kind.lower())
        self.copy_previous = blender.ops.preferences.copy_prev
        self.copy_previous.poll.return_value = True
        self.save = blender.ops.wm.save_userpref
        with patch.dict(sys.modules, {"bpy": blender}):
            self.prepare = runpy.run_path(str(PROFILE_SCRIPT))["prepare_profile"]

    def test_wait_for_choice_without_writing(self):
        self.assertTrue(self.prepare({})["needsPreferenceChoice"])
        self.copy_previous.assert_not_called()
        self.save.assert_not_called()

    def test_import_once_and_preserve_existing_preferences_on_retry(self):
        def import_previous():
            self.preferences.write_bytes(b"previous preferences")
            return {"FINISHED"}
        self.copy_previous.side_effect = import_previous
        for choice in ("import", "defaults"):
            self.assertNotIn("needsPreferenceChoice", self.prepare({"preferenceChoice": choice}))
        self.copy_previous.assert_called_once()
        self.save.assert_not_called()
        self.assertEqual(self.preferences.read_bytes(), b"previous preferences")

    def test_defaults_finish_first_run(self):
        def save_defaults():
            self.preferences.write_bytes(b"defaults")
            return {"FINISHED"}
        self.save.side_effect = save_defaults
        self.assertNotIn("needsPreferenceChoice", self.prepare({"preferenceChoice": "defaults"}))
        self.copy_previous.assert_not_called()
        self.assertTrue(self.preferences.is_file())

    def test_cancelled_import_open_host_and_version_mismatch_stop_sync(self):
        self.copy_previous.return_value = {"CANCELLED"}
        with patch.dict(os.environ, FLOWCELL_TARGET_BLENDER_OPEN="1"), self.assertRaises(RuntimeError):
            self.prepare({"preferenceChoice": "import"})
        with self.assertRaises(ValueError):
            self.prepare({"expectedVersion": "5.1.0", "preferenceChoice": "import"})
        self.copy_previous.assert_not_called()
        with self.assertRaises(RuntimeError):
            self.prepare({"preferenceChoice": "import"})
        self.save.assert_not_called()


if __name__ == "__main__":
    unittest.main()
