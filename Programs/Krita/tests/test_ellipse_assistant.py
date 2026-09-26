"""Headless contract checks; these deliberately do not claim live Qt coverage."""
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

PROGRAM = Path(__file__).resolve().parents[1]


class EllipseAssistantTests(unittest.TestCase):
    def setUp(self):
        self.app = Mock()
        self.window = self.app.activeWindow.return_value
        self.button = self.window.qwindow.return_value.findChild.return_value
        self.button.isChecked.return_value = False
        self.app.action.return_value.trigger.side_effect = lambda: setattr(
            self.button.isChecked, "return_value", True)
        self.selector = Mock()
        # A translated label and arbitrary index must not affect ID selection.
        self.selector.findData.side_effect = lambda value: 7 if value == "ellipse" else -1
        self.selector.currentData.return_value = "perspective"
        self.selector.setCurrentIndex.side_effect = lambda index: setattr(
            self.selector.currentData, "return_value", "ellipse" if index == 7 else "ruler")
        self.window.qwindow.return_value.findChildren.return_value = [self.selector]
        krita = types.ModuleType("krita")
        krita.Krita = Mock()
        krita.Krita.instance.return_value = self.app
        qt = types.ModuleType("PyQt5.QtWidgets")
        qt.QAbstractButton = type("QAbstractButton", (), {})
        qt.QComboBox = type("QComboBox", (), {})
        self.modules = patch.dict(sys.modules, {"krita": krita, "PyQt5": types.ModuleType("PyQt5"),
                                              "PyQt5.QtWidgets": qt})
        self.modules.start()
        self.addCleanup(self.modules.stop)
        spec = importlib.util.spec_from_file_location("ellipse_toolbox_under_test",
            PROGRAM / "SupportScripts/flowcell_layers/toolbox.py")
        self.toolbox = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.toolbox)

    def test_native_tool_and_type_repeat_selection(self):
        for _ in range(2):
            self.assertEqual(self.toolbox.select_ellipse_assistant(), "Ellipse Assistant")
        self.app.action.assert_called_with("KisAssistantTool")
        self.app.action.return_value.trigger.assert_called_once()
        self.selector.setCurrentIndex.assert_called_with(7)

    def test_no_document_does_not_trigger(self):
        self.window.activeView.return_value = None
        with self.assertRaisesRegex(ValueError, "Open a document"):
            self.toolbox.select_ellipse_assistant()
        self.app.action.assert_not_called()

    def test_unavailable_tool_does_not_change_type(self):
        self.app.action.return_value.isEnabled.return_value = False
        with self.assertRaisesRegex(ValueError, "unavailable"):
            self.toolbox.select_ellipse_assistant()
        self.selector.setCurrentIndex.assert_not_called()

    def test_missing_or_ambiguous_selector_fails(self):
        for choices in ([], [self.selector, Mock()]):
            with self.subTest(count=len(choices)):
                self.window.qwindow.return_value.findChildren.return_value = choices
                with self.assertRaisesRegex(ValueError, "unavailable or ambiguous"):
                    self.toolbox.select_ellipse_assistant()
        self.selector.setCurrentIndex.assert_not_called()

    def test_missing_type_fails_without_changing_selector(self):
        self.selector.findData.side_effect = lambda value: -1
        with self.assertRaisesRegex(ValueError, "Ellipse assistant is unavailable"):
            self.toolbox.select_ellipse_assistant()
        self.selector.setCurrentIndex.assert_not_called()

    def test_failed_selection_is_not_reported_as_success(self):
        self.selector.setCurrentIndex.side_effect = None
        with self.assertRaisesRegex(ValueError, "did not select"):
            self.toolbox.select_ellipse_assistant()

    def test_package_and_panel_contract(self):
        manifest = json.loads((PROGRAM / "flowcell.program.json").read_text(encoding="utf-8-sig"))
        matches = [s for s in manifest["bundledSources"] if s["id"] == "plain-krita.tools.ellipse-assistant"]
        self.assertEqual(len(matches), 1)
        source = matches[0]
        self.assertEqual(source["panelName"], "Tools")
        self.assertIn("Tools", manifest["defaultPanels"])
        package = PROGRAM / source["sourcePath"]
        script = json.loads((package / "flowcell.script.json").read_text())
        self.assertEqual(script["id"], source["id"])
        self.assertIn("-Action 'ellipse_assistant'", (package / script["source"]).read_text())
        self.assertEqual((package / "Invoke-KritaLayers.ps1").read_bytes(),
                         (PROGRAM / "SupportScripts/Invoke-KritaLayers.ps1").read_bytes())


if __name__ == "__main__":
    unittest.main()
