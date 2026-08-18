import ast
import unittest
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
