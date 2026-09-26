"""Select only the native tools represented in Krita's Toolbox."""
import json
from pathlib import Path

from krita import Krita
from PyQt5.QtWidgets import QAbstractButton, QComboBox

TOOLS = json.loads((Path(__file__).parent / "tools.json").read_text(encoding="utf-8"))
TOOL_IDS = {tool["id"] for tool in TOOLS}


def select_tool(tool_id):
    if tool_id not in TOOL_IDS:
        raise ValueError("Unknown Toolbox tool.")
    app = Krita.instance()
    window = app.activeWindow()
    if not window or not window.activeView():
        raise ValueError("Open a document in Krita first.")
    action = app.action(tool_id)
    button = window.qwindow().findChild(QAbstractButton, tool_id)
    if not action or not button:
        raise ValueError("This Krita version does not provide the requested Toolbox tool.")
    if not action.isEnabled() or not button.isEnabled():
        raise ValueError("This tool is unavailable for the current document or layer.")
    if not button.isChecked():
        action.trigger()
    if not button.isChecked():
        raise ValueError("Krita did not select the requested tool.")
    return next(tool["label"] for tool in TOOLS if tool["id"] == tool_id)


def select_ellipse_assistant():
    """Select the native Assistant Tool and its untranslated ellipse type ID."""
    select_tool("KisAssistantTool")
    window = Krita.instance().activeWindow().qwindow()
    choices = window.findChildren(QComboBox, "availableAssistantsComboBox")
    if len(choices) != 1:
        raise ValueError("Krita's assistant type selector is unavailable or ambiguous.")
    selector = choices[0]
    index = selector.findData("ellipse")
    if index < 0 or not selector.isEnabled():
        raise ValueError("Krita's Ellipse assistant is unavailable.")
    selector.setCurrentIndex(index)
    if selector.currentData() != "ellipse":
        raise ValueError("Krita did not select the Ellipse assistant.")
    return "Ellipse Assistant"
