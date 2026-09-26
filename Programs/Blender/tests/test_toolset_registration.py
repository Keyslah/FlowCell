import ast
import json
import unittest
from types import SimpleNamespace
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ToolsetRegistrationTests(unittest.TestCase):
    def test_boolean_reopen_queries_current_operation_without_changing_it(self):
        package = ROOT / "Blender Git Scripts/Toolsets/boolean"
        manifest = json.loads((package / "flowcell.toolset.json").read_text(encoding="utf-8-sig"))
        query = manifest["stateQuery"]
        self.assertIn(query["slot"], [child["slot"] for child in manifest["children"]])
        self.assertEqual(query["payload"], {"command": "status", "action": "status"})
        tree = ast.parse((package / "boolean.py").read_text(encoding="utf-8-sig"))
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                     and node.name in {"_quick_boolean_state", "run_flowcell_action"}]
        namespace = {"_ensure_quick_boolean_scene_props": lambda: None}
        exec(compile(ast.Module(body=functions, type_ignores=[]), "boolean.py", "exec"), namespace)
        for operation in ("UNION", "INTERSECT", "DIFFERENCE"):
            scene = SimpleNamespace(qb_operation=operation, qb_solver="EXACT",
                                    qb_self_intersection=False, qb_hole_tolerant=True,
                                    qb_hide_cutter=True, qb_backup_active=False)
            before = vars(scene).copy()
            response = namespace["run_flowcell_action"](SimpleNamespace(scene=scene), query["payload"])
            self.assertEqual(response["fieldPatch"]["operation"], operation)
            self.assertEqual(vars(scene), before)

    def test_all_catalog_toolsets_are_available_in_add_everything(self):
        manifest = json.loads((ROOT / "flowcell.program.json").read_text(encoding="utf-8-sig"))
        self.assertIn("toolset", manifest["defaultPanels"])
        self.assertTrue(any(panel["label"] == "toolset" and panel["defaultSelected"] for panel in manifest["panels"]))
        toolsets = list((ROOT / "Blender Git Scripts/Toolsets").glob("*/flowcell.toolset.json"))
        self.assertTrue(toolsets)
        for toolset_path in toolsets:
            toolset = json.loads(toolset_path.read_text(encoding="utf-8-sig"))
            with self.subTest(toolset=toolset["id"]):
                matches = [source for source in manifest["bundledSources"] if source["id"] == toolset["id"]]
                self.assertEqual(len(matches), 1)
                source = matches[0]
                self.assertEqual(source["sourcePath"], toolset_path.relative_to(ROOT).as_posix())
                self.assertEqual(source["version"], toolset["version"])
                self.assertEqual(source["panelName"], "toolset")
                self.assertEqual(source["importKind"], "tool-set")
                self.assertEqual(source["sourceKind"], "tool-set")
                self.assertTrue(source["installOnAdd"])
                self.assertFalse(source["required"])


if __name__ == "__main__":
    unittest.main()
