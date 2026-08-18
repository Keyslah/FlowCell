import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path


SCRIPT_PATH = (
    Path(__file__).resolve().parent.parent
    / "Blender Git Scripts"
    / "Collections"
    / "rename selected.py"
)


class FakeTimers:
    def __init__(self):
        self.callbacks = []

    def register(self, callback, first_interval=0.0):
        self.callbacks.append((callback, first_interval))


def load_module(scripts_root):
    timers = FakeTimers()
    fake_bpy = types.SimpleNamespace(
        app=types.SimpleNamespace(driver_namespace={}, timers=timers),
        context=types.SimpleNamespace(),
        utils=types.SimpleNamespace(
            user_resource=lambda _kind: str(scripts_root),
        ),
    )
    spec = importlib.util.spec_from_file_location("flowcell_rename_selected_test", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    previous_bpy = sys.modules.get("bpy")
    sys.modules["bpy"] = fake_bpy
    try:
        spec.loader.exec_module(module)
    finally:
        if previous_bpy is None:
            sys.modules.pop("bpy", None)
        else:
            sys.modules["bpy"] = previous_bpy
    return module, timers


class FakeProcess:
    def __init__(self):
        self.running = True

    def poll(self):
        return None if self.running else 0


class RenameSelectedTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.scripts_root = Path(self.temp_dir.name)
        self.module, self.timers = load_module(self.scripts_root)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_prompt_result_waits_for_process_exit_before_reading_or_cleanup(self):
        input_path = self.scripts_root / "input.json"
        output_path = self.scripts_root / "output.json"
        script_path = self.scripts_root / "prompt.ps1"
        for path in (input_path, script_path):
            path.write_text("temporary", encoding="utf-8")
        output_path.write_text('{"cancelled": true}', encoding="utf-8")

        state = {"phase": "scheduled"}
        self.module.bpy.app.driver_namespace[self.module._PROMPT_STATE_KEY] = state
        process = FakeProcess()
        applied = []
        self.module._apply_prompt_result = lambda path: applied.append(Path(path))

        self.module._watch_prompt_process(
            state,
            process,
            input_path,
            output_path,
            script_path,
        )
        poll_callback = self.timers.callbacks[-1][0]

        self.assertEqual(poll_callback(), self.module._PROMPT_POLL_SECONDS)
        self.assertEqual(applied, [])
        self.assertTrue(output_path.exists())
        self.assertIs(
            self.module.bpy.app.driver_namespace[self.module._PROMPT_STATE_KEY],
            state,
        )

        process.running = False
        self.assertIsNone(poll_callback())
        self.assertEqual(applied, [output_path])
        self.assertFalse(input_path.exists())
        self.assertFalse(output_path.exists())
        self.assertFalse(script_path.exists())
        self.assertNotIn(
            self.module._PROMPT_STATE_KEY,
            self.module.bpy.app.driver_namespace,
        )

    def test_prompted_rename_reenters_registered_action_for_an_undo_step(self):
        calls = []
        action_name = "flowcell_button_button-migrated-test"
        fake_actions = types.SimpleNamespace(
            load_custom_actions_registry=lambda: [
                {
                    "action": action_name,
                    "pythonPath": str(SCRIPT_PATH),
                    "sourcePythonPath": str(SCRIPT_PATH),
                }
            ],
            resolve_custom_action_script_path=lambda path: Path(path),
            execute_bridge_operator=lambda action, data: calls.append((action, data))
            or {"message": "Renamed 2 object(s)."},
        )
        previous_actions = sys.modules.get("flowcell_actions")
        sys.modules["flowcell_actions"] = fake_actions
        try:
            items = [
                {"current_name": "Cube", "new_name": "Part"},
                {"current_name": "Sphere", "new_name": "Part1"},
            ]
            message = self.module._perform_prompted_rename(items)
        finally:
            if previous_actions is None:
                sys.modules.pop("flowcell_actions", None)
            else:
                sys.modules["flowcell_actions"] = previous_actions

        self.assertEqual(message, "Renamed 2 object(s).")
        self.assertEqual(calls, [(action_name, {"items": items})])

    def test_direct_items_apply_immediately_without_scheduling_a_prompt(self):
        calls = []
        fake_actions = types.SimpleNamespace(
            perform_batch_rename_selected_objects=lambda context, items: calls.append(
                (context, items)
            )
            or "Renamed 1 object(s).",
        )
        previous_actions = sys.modules.get("flowcell_actions")
        sys.modules["flowcell_actions"] = fake_actions
        try:
            context = types.SimpleNamespace()
            items = [{"current_name": "Cube", "new_name": "Part"}]
            result = self.module.run_flowcell_action(context=context, data={"items": items})
        finally:
            if previous_actions is None:
                sys.modules.pop("flowcell_actions", None)
            else:
                sys.modules["flowcell_actions"] = previous_actions

        self.assertEqual(result, {"message": "Renamed 1 object(s)."})
        self.assertEqual(calls, [(context, items)])
        self.assertEqual(self.timers.callbacks, [])

    def test_second_click_does_not_schedule_another_prompt(self):
        items = [{"current_name": "Cube", "new_name": "Cube"}]

        first = self.module._open_prompt_later(items)
        second = self.module._open_prompt_later(items)

        self.assertEqual(first, "Opening Rename Selected prompt.")
        self.assertEqual(second, "Rename Selected prompt is already open.")
        self.assertEqual(len(self.timers.callbacks), 1)


if __name__ == "__main__":
    unittest.main()
