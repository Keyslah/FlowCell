"""Native preset dialog and fixed-data handoff to regular FlowCell Buttons."""
import hashlib
import json
import math
import re
import uuid

from krita import Krita
from PyQt5.QtCore import QObject, QMetaObject, Qt, QTimer, pyqtSlot
from PyQt5.QtWidgets import QWidget, QDialog, QLineEdit


class BrushButtons(QObject):
    def __init__(self, bridge):
        super().__init__(bridge)
        self.bridge = bridge
        self.pending = None
        self.dialog = None

    def open_save(self, view):
        if self.pending:
            self.dialog.raise_()
            self.dialog.activateWindow()
            return "Finish saving the current brush first."
        window = view.window().qwindow()
        editor = window.findChild(QWidget, "KisPaintOpPresetsEditor")
        dialog = window.findChild(QDialog, "WdgSaveBrushPreset")
        if not editor or not dialog or not hasattr(dialog, "resourceSelected"):
            raise ValueError("This Krita window does not expose its preset save dialog.")
        if not view.currentBrushPreset():
            raise ValueError("Select a brush in Krita first.")
        size = view.brushSize()
        if not math.isfinite(size) or size <= 0:
            raise ValueError("The current brush size is invalid.")
        self.pending = {"view": view, "size": size}
        self.dialog = dialog
        # The native signal is emitted only after a successful resource save.
        # A zero-argument Qt slot avoids marshalling Krita's private KoResourceSP.
        dialog.resourceSelected.connect(self.saved)
        dialog.finished.connect(self.finished)
        try:
            QMetaObject.invokeMethod(editor, "slotSaveNewBrushPreset", Qt.DirectConnection)
            if not dialog.isVisible():
                raise ValueError("Krita did not open its preset save dialog.")
            window.raise_()
            dialog.raise_()
            dialog.activateWindow()
        except Exception:
            self.disconnect_dialog()
            raise
        return "Name your brush, choose its thumbnail, then Save."

    def disconnect_dialog(self):
        if self.dialog:
            for signal, slot in ((self.dialog.resourceSelected, self.saved),
                                 (self.dialog.finished, self.finished)):
                try:
                    signal.disconnect(slot)
                except (TypeError, RuntimeError):
                    pass
        self.pending = None
        self.dialog = None

    @pyqtSlot(int)
    def finished(self, _result):
        self.disconnect_dialog()

    @pyqtSlot()
    def saved(self):
        pending = self.pending
        if not pending:
            return
        field = self.dialog.findChild(QLineEdit, "newBrushNameTexField")
        expected_name = field.text() if field else None
        self.disconnect_dialog()
        # Resolve the saved resource after native signal delivery. Krita does not
        # always select it when its full brush editor was never opened.
        QTimer.singleShot(0, lambda: self.publish_saved(pending, expected_name))

    def publish_saved(self, pending, expected_name):
        try:
            matches = [r for r in Krita.instance().resources("preset").values()
                       if r.name() == expected_name]
            if len(matches) != 1:
                raise ValueError("The saved preset is ambiguous; no Button was created.")
            resource = matches[0]
            if not resource.filename():
                raise ValueError("The saved preset has no filename; no Button was created.")
            record = {
                "id": hashlib.sha256(resource.filename().encode("utf-8")).hexdigest(),
                "revision": str(uuid.uuid4()), "name": resource.name(),
                "filename": resource.filename(), "size": pending["size"],
            }
            directory = self.bridge.directory / "brush-buttons"
            directory.mkdir(parents=True, exist_ok=True)
            self.bridge.write_json(directory / (record["id"] + ".json"), record)
            pending["view"].setCurrentBrushPreset(resource)
            pending["view"].setBrushSize(pending["size"])
            self.bridge.notify("Saved brush. Adding its FlowCell button.")
        except Exception as error:
            self.bridge.notify(str(error))
            (self.bridge.directory / "last-brush-error.log").write_text(str(error), encoding="utf-8")

    def select(self, view, brush_id):
        if not isinstance(brush_id, str) or not re.fullmatch(r"[a-f0-9]{64}", brush_id):
            raise ValueError("Invalid brush Button identity.")
        path = self.bridge.directory / "brush-buttons" / (brush_id + ".json")
        record = json.loads(path.read_text(encoding="utf-8"))
        size = record["size"]
        if not isinstance(size, (int, float)) or not math.isfinite(size) or not 0 < size <= 1000000:
            raise ValueError("This brush Button has an invalid saved size.")
        matches = [r for r in Krita.instance().resources("preset").values()
                   if r.filename() == record["filename"]]
        if len(matches) != 1:
            raise ValueError("The saved brush is missing or ambiguous in Krita.")
        view.setCurrentBrushPreset(matches[0])
        view.setBrushSize(size)
        if view.currentBrushPreset().filename() != record["filename"] or abs(view.brushSize() - size) > 0.01:
            raise ValueError("Krita could not restore the saved brush and size.")
        return "{} · {:g} px".format(matches[0].name(), round(size, 2))
