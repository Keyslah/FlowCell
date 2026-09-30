import ast
import unittest
from types import SimpleNamespace
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
ACTIONS_PATH = (
    REPO_ROOT
    / "Programs"
    / "Blender"
    / "Blender Addons - Copy contents Into Blender"
    / "flowcell_actions.py"
)


class BridgeUndoContractTests(unittest.TestCase):
    def test_legacy_bridge_commands_keep_their_results_in_the_single_dispatcher(self):
        tree = ast.parse(ACTIONS_PATH.read_text(encoding="utf-8-sig"))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                        and node.name == "_execute_bridge_operator_direct")
        namespace = {
            "bpy": SimpleNamespace(context=SimpleNamespace(view_layer=SimpleNamespace(update=lambda: None))),
            "execute_custom_action": lambda action, data: None,
        }
        def set_result(message, display=""):
            namespace["LAST_BRIDGE_MESSAGE"] = message
            namespace["LAST_BRIDGE_DISPLAY"] = display
        namespace["set_bridge_result"] = set_result
        commands = ("sort_live", "baseline_visibility", "restore_visibility", "cycle_collection_hover_save_visibility",
                    "cycle_collection_hover_clear_visibility", "cycle_collection_hover_restore_visibility", "cursor_center_hole")
        for command in commands:
            namespace["perform_" + command] = lambda context, command=command: command + " done"
        namespace["perform_render_active_object_png_to_images_result"] = lambda context: {"message": "rendered", "output": "image.png"}
        namespace["perform_save_selected_stl_to_assets_result"] = lambda context, name: {"message": "exported", "exported_paths": [name]}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(ACTIONS_PATH), "exec"), namespace)
        run = namespace["_execute_bridge_operator_direct"]
        for command in commands:
            self.assertEqual(run(command, {})["message"], command + " done")
        self.assertEqual(run("render_active_object_png_to_images", {})["output"], "image.png")
        self.assertEqual(run("save_selected_stl_to_assets", {"file_name": "part.stl"})["exported_paths"], ["part.stl"])

    def test_bridge_wrapper_requests_python_operator_undo(self):
        tree = ast.parse(ACTIONS_PATH.read_text(encoding="utf-8-sig"))
        calls = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "flowcell_bridge_undoable_action"
        ]

        self.assertEqual(len(calls), 1)
        self.assertGreaterEqual(len(calls[0].args), 2)
        self.assertIsInstance(calls[0].args[1], ast.Constant)
        self.assertIs(calls[0].args[1].value, True)


if __name__ == "__main__":
    unittest.main()
