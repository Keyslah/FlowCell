import importlib.util
import sys
import types
import unittest
from pathlib import Path


SCRIPT_PATH = (
    Path(__file__).resolve().parent.parent
    / "Blender Git Scripts"
    / "Collections"
    / "restore.py"
)


def load_module():
    fallback_context = types.SimpleNamespace()
    fake_bpy = types.SimpleNamespace(context=fallback_context)
    spec = importlib.util.spec_from_file_location("flowcell_restore_test", SCRIPT_PATH)
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
    return module, fallback_context


def fake_context(roots, *selected):
    return types.SimpleNamespace(
        scene=types.SimpleNamespace(
            collection=types.SimpleNamespace(
                children={name: root for name, root in roots.items() if name != "Live"}
            )
        ),
        selected_objects=list(selected),
    )


class FakeActions:
    def __init__(self):
        self.calls = []
        self.roots = {
            "Live": object(),
            "Snapshots": object(),
            "Trash": object(),
            "Archive": object(),
        }

    def build_collection_parent_map(self, _scene_root):
        return {}

    def object_is_in_root(self, obj, root, _parent_map):
        return bool(getattr(obj, "eligible", False)) and root is self.roots["Snapshots"]

    def perform_restore(self, context):
        self.calls.append(context)
        return "Restored 1 object(s) into Live."


class RestoreScriptTests(unittest.TestCase):
    def setUp(self):
        self.module, self.fallback_context = load_module()

    def _run_with_actions(self, actions, *, context):
        previous_actions = sys.modules.get("flowcell_actions")
        sys.modules["flowcell_actions"] = actions
        try:
            return self.module.run_flowcell_action(context=context, data={})
        finally:
            if previous_actions is None:
                sys.modules.pop("flowcell_actions", None)
            else:
                sys.modules["flowcell_actions"] = previous_actions

    def test_valid_restore_calls_actions_directly(self):
        actions = FakeActions()
        context = fake_context(actions.roots, types.SimpleNamespace(eligible=True))

        result = self._run_with_actions(actions, context=context)

        self.assertEqual(result, {"message": "Restored 1 object(s) into Live."})
        self.assertEqual(actions.calls, [context])

    def test_live_or_unrelated_selection_cancels_without_mutation(self):
        actions = FakeActions()
        context = fake_context(actions.roots, types.SimpleNamespace(eligible=False))

        result = self._run_with_actions(actions, context=context)

        self.assertEqual(
            result,
            {
                "message": (
                    "Restore cancelled: select only objects from Snapshots, Trash, or Archive."
                )
            },
        )
        self.assertEqual(actions.calls, [])

    def test_empty_selection_returns_without_creating_restore_roots(self):
        actions = FakeActions()
        context = fake_context(actions.roots)

        result = self._run_with_actions(actions, context=context)

        self.assertEqual(result, {"message": "No selected objects to restore."})
        self.assertEqual(actions.calls, [])

    def test_restore_source_never_reloads_or_redispatches_the_live_bridge(self):
        source = SCRIPT_PATH.read_text(encoding="utf-8")

        self.assertNotIn("importlib.reload", source)
        self.assertNotIn("flowcell_bridge", source)


if __name__ == "__main__":
    unittest.main()
