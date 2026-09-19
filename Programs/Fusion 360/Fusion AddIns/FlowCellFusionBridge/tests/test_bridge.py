from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path


def _install_fake_adsk():
    adsk = types.ModuleType("adsk")
    core = types.ModuleType("adsk.core")

    class CustomEventHandler:
        pass

    class Application:
        @staticmethod
        def get():
            return None

    core.CustomEventHandler = CustomEventHandler
    core.Application = Application
    adsk.core = core
    sys.modules["adsk"] = adsk
    sys.modules["adsk.core"] = core


def _load_bridge_module():
    _install_fake_adsk()
    source = Path(__file__).resolve().parents[1] / "FlowCellFusionBridge.py"
    spec = importlib.util.spec_from_file_location("flowcell_fusion_bridge_test", source)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.bridge = _load_bridge_module()

    def test_action_result_is_merged_into_top_level_response(self):
        response = self.bridge._merge_response(
            {"requestId": "req-1", "action": "flowcell_button_owner"},
            {"status": "FINISHED", "fieldPatch": {"x": 12.5}},
        )
        self.assertEqual("req-1", response["requestId"])
        self.assertEqual({"x": 12.5}, response["fieldPatch"])
        self.assertTrue(response["ok"])

    def test_registered_managed_action_executes_and_returns_field_patch(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            managed = root / "ManagedActions"
            managed.mkdir()
            source = managed / "flowcell_button_owner.py"
            source.write_text(
                "def run_flowcell_action(context=None, data=None):\n"
                "    return {'status': 'FINISHED', 'fieldPatch': {'x': data['x']}}\n",
                encoding="utf-8",
            )
            registry = root / "flowcell_fusion_actions.json"
            registry.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "actions": [
                            {
                                "action": "flowcell_button_owner",
                                "ownerButtonId": "owner",
                                "source": "ManagedActions/flowcell_button_owner.py",
                                "entrypoint": "run_flowcell_action",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            self.bridge._addin_root = str(root)
            self.bridge._managed_actions_root = str(managed)
            self.bridge._registry_path = str(registry)
            self.bridge._module_cache = {}

            response = self.bridge._process_request(
                {"requestId": "req-2", "action": "flowcell_button_owner", "payload": {"x": 9.25}}
            )
            self.assertEqual({"x": 9.25}, response["fieldPatch"])
            self.assertEqual("FINISHED", response["status"])

    def test_registry_source_cannot_escape_managed_actions(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            managed = root / "ManagedActions"
            managed.mkdir()
            registry = root / "flowcell_fusion_actions.json"
            registry.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "actions": [
                            {
                                "action": "flowcell_button_owner",
                                "source": "../escape.py",
                                "entrypoint": "run_flowcell_action",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            self.bridge._addin_root = str(root)
            self.bridge._managed_actions_root = str(managed)
            self.bridge._registry_path = str(registry)
            with self.assertRaisesRegex(ValueError, "escapes ManagedActions"):
                self.bridge._resolve_registry_entry("flowcell_button_owner")

    def test_existing_response_id_can_be_marked_processed_without_deleting_files(self):
        self.bridge._processed_request_ids = []
        self.bridge._remember_processed("req-existing")
        self.assertIn("req-existing", self.bridge._processed_request_ids)


if __name__ == "__main__":
    unittest.main()
