"""Document mutation contracts for the SVG Stencil bridge action."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch


SOURCE = Path(__file__).resolve().parents[1] / "SupportScripts/flowcell_layers/svg_stencil.py"


class Node:
    def __init__(self, name):
        self._name = name
        self.children = []
        self.label = None
        self.svg = None

    def name(self):
        return self._name

    def addChildNode(self, node, above):
        index = self.children.index(above) + 1 if above else 0
        self.children.insert(index, node)
        return True

    def childNodes(self):
        return self.children

    def setColorLabel(self, label):
        self.label = label

    def addShapesFromSvg(self, svg):
        self.svg = svg
        return [object()] if "<path " in svg else []


class SvgStencilTests(unittest.TestCase):
    def setUp(self):
        qt = types.ModuleType("PyQt5.QtWidgets")
        qt.QFileDialog = Mock()
        krita = types.ModuleType("krita")
        krita.Krita = Mock()
        modules = patch.dict(sys.modules, {"krita": krita, "PyQt5": types.ModuleType("PyQt5"),
                                           "PyQt5.QtWidgets": qt})
        modules.start()
        self.addCleanup(modules.stop)
        spec = importlib.util.spec_from_file_location("svg_stencil_under_test", SOURCE)
        self.importer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.importer)
        self.root = Node("root")
        self.root.addChildNode(Node("existing artwork"), None)
        self.doc = Mock()
        self.doc.rootNode.return_value = self.root
        self.doc.createVectorLayer.side_effect = lambda name: Node(name)
        self.doc.createGroupLayer.side_effect = lambda name: Node(name)
        self.doc.createNode.side_effect = lambda name, kind: Node(name)

    def test_bom_styling_and_group_order(self):
        svg = '<svg><path fill="none" stroke="#e63946" d="M 0 0 L 4 4"/></svg>'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cutout.svg"
            path.write_text(svg, encoding="utf-8-sig")
            self.importer.import_svg_stencil(self.doc, path)
        self.assertEqual({node.name() for node in self.root.children},
                         {"existing artwork", "cutout"})
        group = next(node for node in self.root.children if node.name() == "cutout")
        paint, vector = group.children
        self.assertEqual([paint.name(), vector.name()], ["Paint Here", "SVG Stencil"])
        self.assertEqual(vector.svg, svg)
        self.assertEqual(vector.label, 1)
        self.doc.setActiveNode.assert_called_once_with(paint)

    def test_empty_svg_does_not_add_group_or_change_selection(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "empty.svg"
            path.write_text("<svg/>", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "no importable shapes"):
                self.importer.import_svg_stencil(self.doc, path)
        self.assertEqual([node.name() for node in self.root.children], ["existing artwork"])
        self.doc.setActiveNode.assert_not_called()

    def test_cancel_does_not_add_group(self):
        self.assertIn("canceled", self.importer.import_svg_stencil(self.doc, ""))
        self.assertEqual([node.name() for node in self.root.children], ["existing artwork"])
        self.doc.createVectorLayer.assert_not_called()


if __name__ == "__main__":
    unittest.main()
