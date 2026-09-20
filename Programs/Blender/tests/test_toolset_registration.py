import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ToolsetRegistrationTests(unittest.TestCase):
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
