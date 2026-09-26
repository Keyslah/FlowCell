"""Run this file in Krita Scripter to export the installed Toolbox's actual icons."""
import json
from pathlib import Path
from krita import Krita
from PyQt5.QtWidgets import QAbstractButton

support = Path(__file__).resolve().parent
tools = json.loads((support / "flowcell_layers/tools.json").read_text(encoding="utf-8"))
output = support / "toolbox-icons"
output.mkdir(exist_ok=True)
window = Krita.instance().activeWindow()
if not window:
    raise ValueError("Open a Krita window first.")
for tool in tools:
    button = window.qwindow().findChild(QAbstractButton, tool["id"])
    if not button:
        raise ValueError("Missing native tool: " + tool["id"])
    pixmap = button.icon().pixmap(64, 64)
    if pixmap.isNull() or not pixmap.save(str(output / (tool["slug"] + ".png")), "PNG"):
        raise ValueError("Could not export native icon: " + tool["id"])
print("Exported %d native Krita icons." % len(tools))
