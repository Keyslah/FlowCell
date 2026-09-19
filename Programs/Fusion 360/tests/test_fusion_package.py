import ast
import json
import pathlib
import unittest


PROGRAM_ROOT = pathlib.Path(__file__).resolve().parents[1]


class FusionPackageTests(unittest.TestCase):
    def test_program_manifest_owns_three_default_toolsets(self):
        manifest = json.loads(
            (PROGRAM_ROOT / "flowcell.program.json").read_text(encoding="utf-8")
        )
        self.assertEqual(manifest["label"], "Fusion 360")
        self.assertEqual(manifest["runner"]["kind"], "fusion-bridge")
        self.assertEqual(
            [source["id"] for source in manifest["bundledSources"]],
            ["fusion-360.align", "fusion-360.rotate", "fusion-360.scale", "fusion-360.update-git-scripts"],
        )
        self.assertTrue(all(source["installOnAdd"] for source in manifest["bundledSources"]))
        for source in manifest["bundledSources"]:
            source_root = PROGRAM_ROOT / pathlib.Path(source["sourcePath"])
            manifest_name = "flowcell.toolset.json" if source["importKind"] == "tool-set" else "flowcell.script.json"
            self.assertTrue((source_root / manifest_name).is_file())
        updater = manifest["bundledSources"][-1]
        self.assertEqual(updater["panelName"], "Files")
        self.assertFalse(updater.get("installIfMissing", False))
        self.assertFalse(updater["required"])

    def test_managed_actions_have_the_constrained_bridge_entrypoint(self):
        toolsets_root = PROGRAM_ROOT / "Fusion Git Scripts" / "Toolsets"
        for folder_name in ("align", "rotate", "scale"):
            manifest = json.loads(
                (toolsets_root / folder_name / "flowcell.toolset.json").read_text(
                    encoding="utf-8"
                )
            )
            source_path = toolsets_root / folder_name / manifest["source"]
            tree = ast.parse(source_path.read_text(encoding="utf-8"), filename=str(source_path))
            functions = {
                node.name for node in tree.body if isinstance(node, ast.FunctionDef)
            }
            self.assertIn("run_flowcell_action", functions, source_path)
            self.assertEqual(manifest["program"], "Fusion 360")

    def test_addin_and_declared_adapters_are_shipped(self):
        manifest = json.loads(
            (PROGRAM_ROOT / "flowcell.program.json").read_text(encoding="utf-8")
        )
        addin_root = PROGRAM_ROOT / "Fusion AddIns" / "FlowCellFusionBridge"
        addin_manifest = json.loads(
            (addin_root / "FlowCellFusionBridge.manifest").read_text(encoding="utf-8")
        )
        self.assertEqual(addin_manifest["autodeskProduct"], "Fusion")
        self.assertTrue(addin_manifest["runOnStartup"])
        self.assertTrue((addin_root / "FlowCellFusionBridge.py").is_file())
        support_root = PROGRAM_ROOT / manifest["supportScriptsFolder"]
        self.assertTrue((support_root / manifest["runner"]["installScript"]).is_file())
        self.assertTrue((support_root / manifest["runner"]["deleteScript"]).is_file())


if __name__ == "__main__":
    unittest.main()
