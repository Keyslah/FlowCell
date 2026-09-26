"""Run in Krita Scripter: exercise tool selection only on a disposable document."""
from krita import Krita
from PyQt5.QtWidgets import QApplication, QAbstractButton
from .toolbox import TOOLS, select_tool


def run():
    app = Krita.instance()
    window = app.activeWindow()
    original = app.activeDocument()
    original_tool = next((tool["id"] for tool in TOOLS
                          if window.qwindow().findChild(QAbstractButton, tool["id"]).isChecked()), None)
    original_states = [(doc, doc.modified()) for doc in app.documents()]
    doc = app.createDocument(32, 32, "FlowCell Toolbox verification", "RGBA", "U8", "", 72.0)
    doc.setBatchmode(True)
    doc.setAutosave(False)
    results = []
    try:
        window.addView(doc)
        QApplication.processEvents()
        pixels = bytes(doc.pixelData(0, 0, 32, 32))
        for tool in TOOLS:
            try:
                result = select_tool(tool["id"])
                assert result == tool["label"]
                # Repeated selection must not toggle the active tool off.
                assert select_tool(tool["id"]) == result
                results.append({"id": tool["id"], "ok": True})
            except Exception as error:
                results.append({"id": tool["id"], "ok": False, "error": str(error)})
        try:
            select_tool("file_save")
            raise AssertionError("Non-tool action accepted")
        except ValueError:
            pass
        assert pixels == bytes(doc.pixelData(0, 0, 32, 32)), "Tool selection changed pixels"
    finally:
        doc.setModified(False)
        doc.close()
        if original:
            app.setActiveDocument(original)
        if original_tool:
            select_tool(original_tool)
    assert all(doc.modified() == modified for doc, modified in original_states)
    return {"passed": sum(row["ok"] for row in results), "total": len(results),
            "tests": results, "originalDocumentsPreserved": True}
