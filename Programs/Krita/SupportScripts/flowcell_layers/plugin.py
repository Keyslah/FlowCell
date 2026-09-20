"""Main-thread Krita bridge: fixed actions only, per-process expiring requests."""
import json
import os
from pathlib import Path
import time
import traceback
import uuid

from krita import Extension, Krita
from PyQt5.QtCore import QTimer
from PyQt5.QtGui import QIcon
from PyQt5.QtWidgets import QApplication, QInputDialog, QLineEdit, QMessageBox
from .engine import Layers, key
from .brushes import BrushButtons

ACTIONS = json.loads((Path(__file__).parent / "actions.json").read_text(encoding="utf-8"))


class FlowCellLayers(Extension):
    def setup(self):
        self.directory = Path(os.environ["LOCALAPPDATA"]) / "FlowCell" / "KritaLayers"
        self.directory.mkdir(parents=True, exist_ok=True)
        self.session = str(uuid.uuid4())
        self.busy = False
        self.brushes = BrushButtons(self)
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.poll)
        self.timer.start(100)
        self.publish_ready()

    def publish_ready(self):
        self.write_json(self.directory / "ready.json", {
            "version": "1.0.0", "session": self.session, "pid": os.getpid(),
            "actions": [a[0] for a in ACTIONS] + ["save_new_brush", "select_brush"], "time": time.time(),
        })

    @staticmethod
    def write_json(path, value):
        pending = path.with_suffix(".pending")
        pending.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        os.replace(str(pending), str(path))

    def createActions(self, window):
        for name, label, tooltip in ACTIONS:
            action = window.createAction("flowcell_layers_" + name, label, "tools/scripts/flowcell_layers")
            action.setToolTip(tooltip)
            action.triggered.connect(lambda checked=False, name=name: self.menu_action(name))

    def parent_window(self):
        window = Krita.instance().activeWindow()
        return window.qwindow() if window else None

    def prompt(self, title, label, default):
        parent = self.parent_window()
        if parent:
            parent.raise_()
            parent.activateWindow()
        value, accepted = QInputDialog.getText(parent, title, label, QLineEdit.Normal, default)
        return value if accepted else None

    def confirm(self, title, label):
        return QMessageBox.question(self.parent_window(), title, label,
                                    QMessageBox.Yes | QMessageBox.No, QMessageBox.No) == QMessageBox.Yes

    def execute(self, action, brush_id=None):
        app = Krita.instance()
        window = app.activeWindow()
        view = window.activeView() if window else None
        doc = view.document() if view else None
        if not doc:
            raise ValueError("Open a document in Krita first.")
        if QApplication.activeModalWidget():
            raise ValueError("Close the current Krita dialog before using a Layers button.")
        if action == "save_new_brush":
            return self.brushes.open_save(view)
        if action == "select_brush":
            return self.brushes.select(view, brush_id)
        engine = Layers(doc, view.selectedNodes(), self.prompt, self.confirm)
        if action == "flatten_selected":
            if engine.repair_internal_nodes():
                engine.save()
            targets = engine.targets()
            if any(engine.top(n).name() in ("Snapshots", "Trash", "Archive") for n in targets):
                raise ValueError("Highlight working layers to flatten.")
            # Krita uses merge_layer for a single group ("Merge Group") as
            # well as multiple layers; flatten_layer is for a non-group's masks.
            action_id = "merge_layer" if len(targets) > 1 or targets[0].type() == "grouplayer" else "flatten_layer"
            # Selection-driven QAction enablement is queued after setActiveNode.
            doc.waitForDone()
            QApplication.processEvents()
            native = app.action(action_id)
            if not native or not native.isEnabled():
                raise ValueError("Krita cannot merge/flatten this selection.")
            native.trigger()
            return "Applied Krita's native merge/flatten to the highlighted selection."
        if action not in {a[0] for a in ACTIONS}:
            raise ValueError("Unknown Layers action.")
        return engine.run(action)

    def menu_action(self, name):
        if self.busy:
            return
        self.busy = True
        try:
            self.notify(self.execute(name))
        except Exception as error:
            QMessageBox.warning(self.parent_window(), "FlowCell Layers", str(error))
        finally:
            self.busy = False

    def notify(self, message):
        window = Krita.instance().activeWindow()
        if window and window.activeView():
            window.activeView().showFloatingMessage(message, QIcon(), 3000, 1)

    def poll(self):
        if self.busy:
            return
        requests = sorted(self.directory.glob("*.request.json"))
        if not requests:
            return
        self.busy = True
        path = requests[0]
        request = None
        try:
            if path.stat().st_size > 8192:
                raise ValueError("Invalid request size.")
            request = json.loads(path.read_text(encoding="utf-8-sig"))
            # Remove only this transient bridge request, never user artwork/files.
            path.unlink()
            if request.get("session") != self.session or float(request.get("expires", 0)) < time.time():
                raise ValueError("Expired request; click the button again.")
            action = request.get("action")
            if action == "status":
                app = Krita.instance()
                result = {"version": "1.0.0", "documents": [
                    {"name": d.name(), "modified": d.modified(), "layers": len(list(d.rootNode().childNodes()))}
                    for d in app.documents()]}
            elif action == "self_test" and os.environ.get("FLOWCELL_KRITA_TEST") == "1":
                import importlib
                from . import engine, selftest
                importlib.reload(engine)
                importlib.reload(selftest)
                global Layers
                Layers = engine.Layers
                result = selftest.run()
            else:
                result = self.execute(action, request.get("brushId"))
                self.notify(result)
            response = {"ok": True, "result": result}
        except Exception as error:
            response = {"ok": False, "error": str(error)}
            self.notify("FlowCell Layers: " + str(error))
            (self.directory / "last-error.log").write_text(traceback.format_exc(), encoding="utf-8")
        finally:
            self.write_json(path.with_name(path.name.replace(".request.json", ".response.json")), response)
            self.busy = False
