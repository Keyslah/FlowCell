import ast
import json
import os
import tempfile
import time
import types
import unittest
from pathlib import Path


BRIDGE_PATH = Path(__file__).resolve().parents[1] / "Blender Addons - Copy contents Into Blender" / "flowcell_bridge.py"


class BridgeRuntimeStatusTests(unittest.TestCase):
    def writer(self, directory, background):
        tree = ast.parse(BRIDGE_PATH.read_text(encoding="utf-8-sig"))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_write_runtime_status")
        namespace = {
            "bpy": types.SimpleNamespace(app=types.SimpleNamespace(background=background)),
            "get_runtime_status_path": lambda: directory / "status.json",
            "get_bridge_root_directory": lambda: directory,
            "LIVE_TOOL_REGISTRY": {},
            "json": json, "os": os, "time": time,
        }
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(BRIDGE_PATH), "exec"), namespace)
        return namespace["_write_runtime_status"]

    def test_background_job_preserves_live_window_status(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            status = directory / "status.json"
            original = b'{"last_event":{"pid":1234},"events":[]}'
            status.write_bytes(original)
            self.writer(directory, True)("live_tool_registered", tool_id="smart_axis_lock")
            self.assertEqual(status.read_bytes(), original)

    def test_background_job_does_not_claim_a_missing_status_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            self.writer(directory, True)("live_tool_registered")
            self.assertFalse((directory / "status.json").exists())

    def test_windowed_blender_still_publishes_its_runtime_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            self.writer(directory, False)("live_tool_registered", tool_id="smart_axis_lock")
            status = json.loads((directory / "status.json").read_text(encoding="utf-8"))
            self.assertEqual(status["last_event"]["pid"], os.getpid())
            self.assertEqual(status["last_event"]["event"], "live_tool_registered")
            self.assertEqual(len(status["events"]), 1)


if __name__ == "__main__":
    unittest.main()
