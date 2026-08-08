import ast
import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


BLENDER_ROOT = Path(__file__).resolve().parent.parent
FILES_ROOT = BLENDER_ROOT / "Blender Git Scripts" / "Files"
ACTIONS_PATH = BLENDER_ROOT / "Blender Addons - Copy contents Into Blender" / "flowcell_actions.py"


def load_launcher(name: str):
    path = FILES_ROOT / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"flowcell_test_{name}", path)
    module = importlib.util.module_from_spec(spec)
    previous_bpy = sys.modules.get("bpy")
    sys.modules["bpy"] = types.SimpleNamespace()
    try:
        spec.loader.exec_module(module)
    finally:
        if previous_bpy is None:
            sys.modules.pop("bpy", None)
        else:
            sys.modules["bpy"] = previous_bpy
    return module


def write_orca_config(path: Path, enabled: bool, newline: str = "\r\n") -> bytes:
    payload = {
        "app": {
            "another_setting": "preserve me",
            "single_instance": enabled,
        },
        "recent": {"last_opened_folder": "D:\\Models"},
    }
    checksum_source = json.dumps(payload, indent="\t")
    checksum = hashlib.md5(checksum_source.encode("utf-8")).hexdigest().upper()
    native_json = checksum_source.replace("\n", newline)
    content = f"{native_json}{newline}# MD5 checksum {checksum}{newline}".encode("utf-8")
    path.write_bytes(content)
    return content


def load_action_helpers(*names: str) -> dict:
    tree = ast.parse(ACTIONS_PATH.read_text(encoding="utf-8-sig"), filename=str(ACTIONS_PATH))
    selected = [
        node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names
    ]
    missing = set(names) - {node.name for node in selected}
    if missing:
        raise AssertionError(f"Missing helpers in flowcell_actions.py: {sorted(missing)}")
    namespace = {"Path": Path, "os": os}
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(ACTIONS_PATH), "exec"), namespace)
    return namespace


class SlicerLauncherTests(unittest.TestCase):
    def test_cura_detection_selects_highest_installed_version(self):
        module = load_launcher("cura")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            older = root / "UltiMaker Cura 5.9.1" / "UltiMaker-Cura.exe"
            newest = root / "UltiMaker Cura 5.11.0" / "UltiMaker-Cura.exe"
            older.parent.mkdir(parents=True)
            newest.parent.mkdir(parents=True)
            older.touch()
            newest.touch()
            environment = {
                "ProgramW6432": str(root),
                "ProgramFiles": str(root),
                "ProgramFiles(x86)": str(root),
                "LOCALAPPDATA": str(root),
            }
            with mock.patch.dict(module.os.environ, environment):
                self.assertEqual(module._find_executable(), newest.resolve())

    def test_saved_executable_wins_and_runtime_fields_are_preserved(self):
        for launcher_name in ("orca", "cura", "slicer"):
            with self.subTest(launcher=launcher_name), tempfile.TemporaryDirectory() as temporary:
                module = load_launcher(launcher_name)
                root = Path(temporary)
                executable = root / "Selected Slicer.exe"
                executable.touch()
                settings_path = root / "runtime" / module.SLICER_SETTINGS_FILE_NAME
                settings_path.parent.mkdir()
                settings_path.write_text(
                    json.dumps({"executable": str(executable), "settingsConfirmed": True}),
                    encoding="utf-8",
                )
                with mock.patch.object(module, "_settings_path", return_value=settings_path):
                    self.assertEqual(module._resolve_executable(), executable)
                    module._write_saved_executable(executable)
                saved = json.loads(settings_path.read_text(encoding="utf-8"))
                self.assertIs(saved["settingsConfirmed"], True)

    def test_cancel_happens_before_export(self):
        for launcher_name in ("orca", "cura", "slicer"):
            with self.subTest(launcher=launcher_name):
                module = load_launcher(launcher_name)
                with mock.patch.object(module, "_resolve_executable", return_value=None), mock.patch.object(
                    module,
                    "_load_flowcell_bridge",
                    side_effect=AssertionError("export bridge must not run after picker cancellation"),
                ):
                    with self.assertRaisesRegex(ValueError, "canceled, so no file was exported or launched"):
                        module.run_flowcell_action()

    def test_launch_passes_every_existing_file_without_forcing_single_instance(self):
        for launcher_name in ("orca", "cura", "slicer"):
            with self.subTest(launcher=launcher_name), tempfile.TemporaryDirectory() as temporary:
                module = load_launcher(launcher_name)
                root = Path(temporary)
                executable = root / "Slicer Folder" / "slicer.exe"
                model_one = root / "Project Folder" / "part one.stl"
                model_two = root / "Project Folder" / "part two.stl"
                executable.parent.mkdir()
                model_one.parent.mkdir()
                executable.touch()
                model_one.touch()
                model_two.touch()
                with mock.patch.object(module.subprocess, "Popen") as popen:
                    message = module._launch(executable, [str(model_one), str(model_two)])
                command = popen.call_args.args[0]
                self.assertEqual(command, [str(executable), str(model_one), str(model_two)])
                self.assertNotIn("--single-instance", command)
                self.assertIn("Sent 2 model files", message)

    def test_launch_reports_missing_export_and_process_errors(self):
        module = load_launcher("slicer")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            executable = root / "slicer.exe"
            executable.touch()
            with self.assertRaisesRegex(ValueError, "Exported model file was not found"):
                module._launch(executable, [str(root / "missing.stl")])

            model = root / "model.stl"
            model.touch()
            with mock.patch.object(module.subprocess, "Popen", side_effect=OSError("launch denied")):
                with self.assertRaisesRegex(
                    ValueError,
                    "Failed to launch Slicer.*launch denied.*exported model files remain",
                ):
                    module._launch(executable, [str(model)])

    def test_orca_config_update_preserves_settings_checksum_and_backup(self):
        for launcher_name in ("orca", "slicer"):
            with self.subTest(launcher=launcher_name), tempfile.TemporaryDirectory() as temporary:
                module = load_launcher(launcher_name)
                config_path = Path(temporary) / "OrcaSlicer.conf"
                original = write_orca_config(config_path, enabled=True)
                with mock.patch.object(module, "_is_orca_running", return_value=False):
                    changed = module._write_orca_single_instance(False, config_path)
                self.assertTrue(changed)
                self.assertFalse(module._read_orca_single_instance(config_path))
                self.assertEqual(config_path.with_name("OrcaSlicer.conf.bak").read_bytes(), original)
                payload = json.loads(module._orca_config_parts(config_path)[2])
                self.assertEqual(payload["app"]["another_setting"], "preserve me")
                self.assertEqual(payload["recent"]["last_opened_folder"], "D:\\Models")

    def test_orca_config_change_is_refused_while_orca_is_running(self):
        module = load_launcher("orca")
        with tempfile.TemporaryDirectory() as temporary:
            config_path = Path(temporary) / "OrcaSlicer.conf"
            original = write_orca_config(config_path, enabled=True)
            with mock.patch.object(module, "_is_orca_running", return_value=True):
                with self.assertRaisesRegex(ValueError, "Close OrcaSlicer"):
                    module._write_orca_single_instance(False, config_path)
            self.assertEqual(config_path.read_bytes(), original)
            self.assertFalse(config_path.with_name("OrcaSlicer.conf.bak").exists())

    def test_orca_config_with_bad_checksum_is_not_modified(self):
        module = load_launcher("orca")
        with tempfile.TemporaryDirectory() as temporary:
            config_path = Path(temporary) / "OrcaSlicer.conf"
            original = write_orca_config(config_path, enabled=True).replace(b"MD5 checksum ", b"MD5 checksum 0")
            config_path.write_bytes(original)
            with self.assertRaisesRegex(ValueError, "invalid MD5 checksum"):
                module._write_orca_single_instance(False, config_path)
            self.assertEqual(config_path.read_bytes(), original)

    def test_first_orca_selection_prompts_once_and_persists_confirmation(self):
        for launcher_name in ("orca", "slicer"):
            with self.subTest(launcher=launcher_name), tempfile.TemporaryDirectory() as temporary:
                module = load_launcher(launcher_name)
                root = Path(temporary)
                executable = root / "orca-slicer.exe"
                executable.touch()
                settings_path = root / "runtime" / module.SLICER_SETTINGS_FILE_NAME
                with mock.patch.object(module, "_settings_path", return_value=settings_path), mock.patch.object(
                    module, "_read_orca_single_instance", return_value=True
                ), mock.patch.object(
                    module, "_prompt_orca_single_instance", return_value=False
                ) as prompt, mock.patch.object(
                    module, "_write_orca_single_instance", return_value=True
                ) as write_setting:
                    module._ensure_orca_settings_confirmed(executable)
                    module._ensure_orca_settings_confirmed(executable)
                prompt.assert_called_once_with(True)
                write_setting.assert_called_once_with(False)
                saved = json.loads(settings_path.read_text(encoding="utf-8"))
                self.assertIs(saved["settingsConfirmed"], True)
                self.assertEqual(saved["executable"], str(executable))

    def test_orca_option_uses_exact_user_facing_copy(self):
        for launcher_name in ("orca", "slicer"):
            module = load_launcher(launcher_name)
            self.assertEqual(module.ORCA_SINGLE_INSTANCE_LABEL, "Allow only one OrcaSlicer instance")
            self.assertEqual(
                module.ORCA_SINGLE_INSTANCE_DESCRIPTION,
                "If this is turned off, a new OrcaSlicer instance will be created every time you add a file.",
            )

    def test_orca_dialog_reflects_the_real_current_setting(self):
        for launcher_name in ("orca", "slicer"):
            with self.subTest(launcher=launcher_name):
                module = load_launcher(launcher_name)
                observed = []
                responses = iter((6, 7, 2))

                class FakeMessageBox:
                    argtypes = None
                    restype = None

                    def __call__(self, owner, content, title, flags):
                        observed.append((owner, content, title, flags))
                        return next(responses)

                fake_library = types.SimpleNamespace(MessageBoxW=FakeMessageBox())
                with mock.patch.object(module.ctypes, "WinDLL", return_value=fake_library):
                    self.assertTrue(module._prompt_orca_single_instance(True))
                    self.assertFalse(module._prompt_orca_single_instance(False))
                    self.assertIsNone(module._prompt_orca_single_instance(True))

                self.assertEqual(observed[0][0], None)
                self.assertIn("current setting is on", observed[0][1])
                self.assertIn("current setting is off", observed[1][1])
                self.assertEqual(observed[0][3] & 0x0100, 0)
                self.assertNotEqual(observed[1][3] & 0x0100, 0)
                self.assertEqual(observed[0][3] & 0x0003, 0x0003)
                self.assertEqual(observed[0][2], "FlowCell - OrcaSlicer settings")

    def test_unprofiled_saved_blend_uses_project_stl_folder(self):
        namespace = load_action_helpers("get_assets_3d_directory_from_current_file")
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary) / "Project"
            project.mkdir()
            namespace.update(
                {
                    "resolve_project_directory_for_extension": lambda extension: None,
                    "get_assets_subdirectory_from_current_file": mock.Mock(
                        side_effect=ValueError("not an organized project")
                    ),
                    "bpy": types.SimpleNamespace(
                        data=types.SimpleNamespace(filepath=str(project / "Project.blend"))
                    ),
                }
            )
            destination = namespace["get_assets_3d_directory_from_current_file"]()
            self.assertEqual(destination, project / "STL")
            self.assertTrue(destination.is_dir())

    def test_duplicate_export_stems_are_collision_safe_within_one_export(self):
        namespace = load_action_helpers(
            "get_overwrite_export_path",
            "get_collision_safe_overwrite_export_path",
        )
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            reserved = set()
            helper = namespace["get_collision_safe_overwrite_export_path"]
            paths = [helper(folder, "part", ".stl", reserved) for _ in range(3)]
            self.assertEqual(
                [path.name for path in paths],
                ["part.stl", "part_2.stl", "part_3.stl"],
            )


if __name__ == "__main__":
    unittest.main()
