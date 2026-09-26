"""Opt-in in-process integration tests. Only disposable, newly created documents."""
import json
import traceback
import tempfile
from pathlib import Path
from krita import Krita
from .engine import Layers, ROOTS, family, key, walk, internal, ANNOTATION
from .svg_stencil import import_svg_stencil


def run():
    app = Krita.instance()
    original = app.activeDocument()
    reports = []

    def test(name, body):
        doc = app.createDocument(32, 32, "FlowCell test: " + name, "RGBA", "U8", "", 72.0)
        doc.setBatchmode(True)
        doc.setAutosave(False)
        try:
            # API-created documents start with a transparent background paint layer.
            for node in list(doc.rootNode().childNodes()):
                node.remove()
            app.activeWindow().addView(doc)
            def add(name, parent=None, visible=True, group=False):
                node = doc.createGroupLayer(name) if group else doc.createNode(name, "paintlayer")
                assert (parent or doc.rootNode()).addChildNode(node, None)
                node.setVisible(visible)
                return node
            body(doc, add)
            reports.append({"name": name, "ok": True})
        except Exception:
            reports.append({"name": name, "ok": False, "error": traceback.format_exc()})
        finally:
            doc.setModified(False)
            doc.close()

    def organize(doc, add):
        rose = add("Rose")
        copy = add("Rose copy 2", visible=False)
        unused = add("Unused", visible=False)
        group = add("Vases", group=True)
        child = add("Hidden Detail", group, False)
        engine = Layers(doc)
        engine.run("make_layers")
        assert [n.name() for n in reversed(doc.rootNode().childNodes())] == list(ROOTS)
        assert rose.parentNode().name() == "Live"
        assert group.parentNode().name() == "Live"
        assert child.parentNode().name() == "Vases" and not child.visible()
        assert engine.top(copy).name() == "Snapshots"
        assert engine.top(unused).name() == "Trash"
        ids = {key(n) for n in walk(doc.rootNode())}
        Layers(doc).run("make_layers")
        assert ids == {key(n) for n in walk(doc.rootNode())}
        assert not next(n for n in doc.rootNode().childNodes() if n.name() == "Snapshots").visible()
    test("Make Layers routing, root order, nested state and idempotence", organize)

    def ordering(doc, add):
        a, b, c = add("A"), add("B"), add("C")
        before = [n.name() for n in doc.rootNode().childNodes()]
        Layers(doc).run("make_layers")
        live = a.parentNode()
        assert [n.name() for n in live.childNodes()] == before
    test("Make Layers preserves stacking order", ordering)

    def repeat_sort(doc, add):
        a = add("A")
        Layers(doc).run("make_layers")
        a.setVisible(False)
        Layers(doc).run("make_layers")
        assert Layers(doc).top(a).name() == "Trash"
        new = add("Fresh")
        Layers(doc).run("make_layers")
        assert new.parentNode().name() == "Live"
        assert Layers(doc).top(a).name() == "Trash"
    test("Make Layers reroutes hidden Live and new incoming layers", repeat_sort)

    def ambiguity(doc, add):
        add("Rose")
        add("Rose copy")
        hidden = add("Rose copy 2", visible=False)
        Layers(doc).run("make_layers")
        assert Layers(doc).top(hidden).name() == "Trash"
        assert family("Rosebud") != family("Rose")
    test("Ambiguous families are never guessed", ambiguity)

    def creation(doc, add):
        parent = add("Flowers", group=True)
        chosen = add("Paint", parent)
        engine = Layers(doc, [chosen], lambda *_: "Petals")
        engine.run("make_group")
        group = next(n for n in parent.childNodes() if n.name() == "Petals")
        Layers(doc, [group], lambda *_: "Color").run("make_layer")
        assert group.childNodes()[0].name() == "Color"
        assert group.childNodes()[0].type() == "paintlayer"
        count = len(list(walk(doc.rootNode())))
        Layers(doc, [group], lambda *_: None).run("make_layer")
        assert count == len(list(walk(doc.rootNode())))
        Layers(doc, [group], lambda *_: "Color").run("make_layer")
        assert len({n.name() for n in group.childNodes()}) == 2
    test("Named group/layer nesting, cancellation and name collisions", creation)

    def snapshots(doc, add):
        node = add("Rose", group=True)
        paint = add("Paint", node)
        hidden = add("Hidden", node, False)
        paint.setPixelData(bytes([0, 0, 255, 255]) * 4, 0, 0, 2, 2)
        Layers(doc).run("make_layers")
        Layers(doc, [node]).run("snapshot")
        engine = Layers(doc)
        saved = next(n for n in walk(doc.rootNode()) if n.name() == "s1")
        assert len(saved.childNodes()) == 2
        assert not next(n for n in saved.childNodes() if n.name() == "Hidden").visible()
        saved_paint = next(n for n in saved.childNodes() if n.name() == "Paint")
        assert bytes(saved_paint.pixelData(0, 0, 2, 2)) == bytes(paint.pixelData(0, 0, 2, 2))
        assert node.parentNode().name() == "Live"
        assert engine.top(saved).name() == "Snapshots"
    test("Snapshots retain group children, masks/state and pixel data", snapshots)

    def cycling(doc, add):
        below, node, above = add("Below"), add("Rose"), add("Above")
        Layers(doc).run("make_layers")
        original_order = [n.name() for n in node.parentNode().childNodes()]
        Layers(doc, [node]).run("snapshot")
        Layers(doc, [node]).run("snapshot")
        original_ids = {key(n) for n in walk(doc.rootNode())}
        messages = []
        for _ in range(3):
            messages.append(Layers(doc, [node]).run("next_snapshot"))
            data = Layers(doc)
            node = data.live_node(data.records[key(node)]["family"])
            assert [n.name() for n in node.parentNode().childNodes()] == original_order
            assert not next(n for n in doc.rootNode().childNodes() if n.name() == "Snapshots").visible()
        assert messages == ["Rose — s1", "Rose — s2", "Rose — Live"], messages
        assert original_ids == {key(n) for n in walk(doc.rootNode())}
        assert Layers(doc, [node]).run("previous_snapshot") == "Rose — s2"
    test("Snapshot cycling wraps, preserves every version and Live stack position", cycling)

    def restore(doc, add):
        rose = add("Rose")
        Layers(doc).run("make_layers")
        Layers(doc, [rose]).run("snapshot")
        saved = next(n for n in walk(doc.rootNode()) if n.name() == "s1")
        Layers(doc, [saved]).run("restore")
        engine = Layers(doc)
        assert engine.top(rose).name() == "Trash"
        assert engine.top(saved).name() == "Snapshots"
        live = engine.live_node(engine.records[key(saved)]["family"])
        assert live and live.name() == "Rose"
        Layers(doc, [live]).run("back")
        assert Layers(doc).top(saved).name() == "Live"
        assert Layers(doc).top(live).name() == "Trash"
    test("Restore preserves source; Back consumes snapshot and trashes displaced version", restore)

    def storage(doc, add):
        node = add("Rose")
        Layers(doc).run("make_layers")
        Layers(doc, [node]).run("copy_archive")
        assert node.parentNode().name() == "Live"
        Layers(doc, [node]).run("archive")
        assert Layers(doc).top(node).name() == "Live"
        saved = next(n for n in walk(doc.rootNode()) if n.name() == "A1")
        Layers(doc, [saved]).run("add_to_live")
        assert Layers(doc).top(saved).name() == "Archive"
        live = next(n for n in doc.rootNode().childNodes() if n.name() == "Live")
        assert len(live.childNodes()) == 2
        Layers(doc, live.childNodes()).run("trash")
        engine = Layers(doc, confirm=lambda *_: False)
        engine.run("empty_trash")
        trash = next(n for n in doc.rootNode().childNodes() if n.name() == "Trash")
        assert trash.childNodes()
        Layers(doc, confirm=lambda *_: True).run("empty_trash")
        assert not trash.childNodes()
    test("Archive copies, Add to Live, Trash and confirmed emptying", storage)

    def storage_order(doc, add):
        nodes = [add(name) for name in ("Bottom", "Middle", "Top")]
        Layers(doc).run("make_layers")
        live = nodes[0].parentNode()
        expected = [n.name() for n in live.childNodes()]
        # Deliberately submit the opposite of Krita's child order.
        Layers(doc, list(reversed(nodes))).run("snapshot")
        for node in reversed(nodes):
            Layers(doc, [node]).run("copy_archive")
        roots = {n.name(): n for n in doc.rootNode().childNodes()}
        for name in ("Snapshots", "Archive"):
            assert [n.name() for n in roots[name].childNodes()] == expected, name
        # A changed Live stack must also reorder already-created family folders.
        Layers(doc).move(nodes[0], live)
        expected = [n.name() for n in live.childNodes()]
        Layers(doc, [nodes[0]]).run("snapshot")
        for name in ("Snapshots", "Archive"):
            assert [n.name() for n in roots[name].childNodes()] == expected, name
        # Separate Trash clicks keep the pre-move order despite shrinking Live.
        for node in reversed(live.childNodes()):
            Layers(doc, [node]).run("trash")
        assert [n.name() for n in roots["Trash"].childNodes()] == expected
        assert not live.childNodes()
    test("Snapshots, Archive and Trash follow Live across reverse clicks and reordering", storage_order)

    def delete(doc, add):
        group = add("Doomed", group=True)
        child = add("Child", group)
        other = add("Keep")
        group.setVisible(False)
        group.setLocked(True)
        Layers(doc, [group, child]).run("delete_highlighted")
        assert [n.name() for n in doc.rootNode().childNodes()] == ["Keep"]
        Layers(doc).run("make_layers")
        root = other.parentNode()
        try:
            Layers(doc, [root]).run("delete_highlighted")
            raise AssertionError("System root deletion was accepted")
        except ValueError:
            pass
    test("Highlighted deletion handles hidden/locked overlapping selections and protects roots", delete)

    def baselines(doc, add):
        a, b = add("A"), add("B", visible=False)
        b.setLocked(True)
        Layers(doc).run("baseline_visibility")
        Layers(doc).run("baseline_locks")
        a.setVisible(False)
        b.setVisible(True)
        b.setLocked(False)
        Layers(doc).run("restore_visibility")
        Layers(doc).run("restore_locks")
        assert a.visible() and not b.visible() and b.locked()
    test("Document-local persisted visibility and lock baselines", baselines)

    def misc(doc, add):
        group = add("Flowers", group=True)
        a, b = add("A", group), add("B", group)
        empty = add("Empty", group, group=True)
        Layers(doc, [a, b], lambda title, label, default: default + " renamed").run("rename_selected")
        assert a.name() == "A renamed" and b.name() == "B renamed"
        Layers(doc, [a]).run("duplicate_selected")
        assert len(group.childNodes()) == 4
        Layers(doc).run("empty_groups")
        assert len(group.childNodes()) == 3
        Layers(doc, [group]).run("collapse_groups")
        assert group.collapsed()
        Layers(doc, [group]).run("expand_groups")
        assert not group.collapsed()
        Layers(doc, [a]).run("cycle_group")
        assert sum(n.visible() for n in group.childNodes()) == 1
        Layers(doc).run("make_layers")
        Layers(doc, [group], lambda *_: "Variation").run("copy_live")
        assert not group.visible()
    test("Rename, duplicate, empty groups, expand/collapse, group cycling and Copy Live", misc)

    def masks_and_pixels(doc, add):
        bottom = add("Bottom")
        bottom.setPixelData(bytes([200, 100, 50, 255]) * 1024, 0, 0, 32, 32)
        group = add("Object", group=True)
        paint = add("Color", group)
        paint.setPixelData(bytes([40, 80, 120, 180]) * 1024, 0, 0, 32, 32)
        mask = doc.createNode("Mask", "transparencymask")
        paint.addChildNode(mask, None)
        group.setOpacity(180)
        doc.refreshProjection()
        doc.waitForDone()
        before = bytes(doc.pixelData(0, 0, 32, 32))
        Layers(doc).run("make_layers")
        doc.waitForDone()
        assert before == bytes(doc.pixelData(0, 0, 32, 32))
        assert mask.parentNode() and key(mask.parentNode()) == key(paint)
        Layers(doc, [group]).run("snapshot")
        Layers(doc, [group]).run("next_snapshot")
        doc.waitForDone()
        assert before == bytes(doc.pixelData(0, 0, 32, 32))
        assert len([n for n in walk(doc.rootNode()) if n.type() == "transparencymask"]) == 2
    test("Group masks and rendered pixels survive organization and cycling", masks_and_pixels)

    def persistence(doc, add):
        node = add("Persistent")
        Layers(doc).run("make_layers")
        Layers(doc, [node]).run("snapshot")
        Layers(doc).run("baseline_visibility")
        with tempfile.TemporaryDirectory(prefix="flowcell-krita-test-") as folder:
            path = str(Path(folder) / "roundtrip.kra")
            assert doc.saveAs(path)
            reopened = app.openDocument(path)
            try:
                assert reopened
                app.activeWindow().addView(reopened)
                engine = Layers(reopened)
                assert engine.data.get("baseline:visible")
                current = next(n for n in walk(reopened.rootNode()) if n.name() == "Persistent" and engine.top(n).name() == "Live")
                assert Layers(reopened, [current]).run("next_snapshot") == "Persistent — s1"
            finally:
                reopened.setModified(False)
                reopened.close()
    test("Saved KRA retains family identities, baselines and working snapshot cycle", persistence)

    def native_selection(doc, add):
        import importlib
        from . import plugin
        extension = importlib.reload(plugin).FlowCellLayers(app)
        node = add("Native Highlight", group=True)
        paint = add("Paint", node)
        paint.setPixelData(bytes([0, 0, 255, 255]) * 16, 0, 0, 4, 4)
        Layers(doc).run("make_layers")
        doc.setActiveNode(node)
        selected = app.activeWindow().activeView().selectedNodes()
        assert [key(n) for n in selected] == [key(node)]
        extension.execute("snapshot")
        from PyQt5.QtWidgets import QApplication
        doc.waitForDone()
        QApplication.processEvents()
        assert key(doc.activeNode()) == key(node)
        assert [key(n) for n in app.activeWindow().activeView().selectedNodes()] == [key(node)]
        extension.execute("copy_archive")
        doc.waitForDone()
        QApplication.processEvents()
        assert key(doc.activeNode()) == key(node)
        assert node.parentNode().name() == "Live"
        extension.execute("next_snapshot")
        assert "s1" == Layers(doc).records[key(doc.activeNode())]["version"]
        from PyQt5.QtCore import QEventLoop, QTimer
        loop = QEventLoop()
        QTimer.singleShot(350, loop.quit)
        loop.exec_()
        try:
            extension.execute("flatten_selected")
        except ValueError as error:
            raise AssertionError(str(error) + "; active=" + doc.activeNode().name() + "/" + doc.activeNode().type()
                                 + "; selected=" + str([n.name() for n in app.activeWindow().activeView().selectedNodes()])
                                 + "; enabled=" + str({a: app.action(a).isEnabled() for a in ("flatten_layer", "merge_layer")}))
        doc.waitForDone()
        assert doc.activeNode().type() == "paintlayer"
    test("Real highlighted selection drives bridge snapshot/cycle and native flatten", native_selection)

    def decorations_wrapper(doc, add):
        from PyQt5.QtWidgets import QApplication
        from PyQt5.QtCore import QEventLoop, QTimer
        paint = add("Artwork")
        paint.setPixelData(bytes([20, 40, 60, 255]) * 1024, 0, 0, 32, 32)
        grid = app.action("view_grid")
        assert grid
        initial_grid = grid.isChecked()
        def settle():
            QApplication.processEvents()
            doc.waitForDone()
            loop = QEventLoop()
            QTimer.singleShot(150, loop.quit)
            loop.exec_()
        try:
            if not grid.isChecked():
                grid.trigger()
            settle()
            wrapper = next(n for n in doc.rootNode().childNodes() if n.name() == "decorations-wrapper-layer")
            assert wrapper.type() == "" and internal(wrapper)
            wrapper_id = key(wrapper)
            before = bytes(doc.pixelData(0, 0, 32, 32))
            for _ in range(2):
                Layers(doc).run("make_layers")
                assert key(wrapper.parentNode()) == key(doc.rootNode())
                assert wrapper_id not in Layers(doc).records
                assert grid.isChecked()
            engine = Layers(doc)
            engine.run("baseline_visibility")
            engine.run("baseline_locks")
            assert wrapper_id not in engine.data["baseline:visible"]
            assert wrapper_id not in engine.data["baseline:locked"]
            for action in ("snapshot", "delete_highlighted", "rename_selected", "duplicate_selected", "cycle_group"):
                try:
                    Layers(doc, [wrapper]).run(action)
                    raise AssertionError("Accepted internal helper: " + action)
                except ValueError as error:
                    assert "internal helpers" in str(error)
            # Reproduce the original misplaced helper, including its stale metadata.
            live = paint.parentNode()
            engine.move(wrapper, live, repair_internal=True)
            engine.register(wrapper)
            engine.save()
            assert engine.repair_internal_nodes() == 1
            engine.save()
            assert engine.repair_internal_nodes() == 0
            assert key(wrapper) == wrapper_id and key(wrapper.parentNode()) == key(doc.rootNode())
            assert wrapper_id not in engine.records
            Layers(doc, [paint]).run("snapshot")
            Layers(doc, [paint]).run("next_snapshot")
            doc.waitForDone()
            assert before == bytes(doc.pixelData(0, 0, 32, 32))
            assert len([n for n in walk(doc.rootNode()) if not n.type()]) == 1
            # An ordinary paint layer with the same name must still be organized.
            namesake = add("decorations-wrapper-layer")
            Layers(doc).run("make_layers")
            assert namesake.parentNode().name() == "Live"
            assert key(wrapper.parentNode()) == key(doc.rootNode())
        finally:
            if grid.isChecked() != initial_grid:
                grid.trigger()
                settle()
    test("Real decorations helper stays internal; misplaced helper repairs without artwork changes", decorations_wrapper)

    def svg_stencil(doc, add):
        existing = add("Existing artwork")
        before = key(existing)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "Stencil fixture.svg"
            path.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">'
                            '<path d="M 2 2 L 20 20" fill="none" stroke="#e63946"/></svg>',
                            encoding="utf-8-sig")
            import_svg_stencil(doc, path)
        doc.waitForDone()
        group = next(n for n in doc.rootNode().childNodes() if n.name() == "Stencil fixture")
        paint, vector = group.childNodes()
        assert [n.name() for n in group.childNodes()] == ["Paint Here", "SVG Stencil"]
        assert vector.type() == "vectorlayer" and len(vector.shapes()) > 0
        exported = vector.toSvg().lower()
        assert "#e63946" in exported and 'fill="none"' in exported, exported[:600]
        assert vector.colorLabel() == 1 and paint.type() == "paintlayer"
        assert key(doc.activeNode()) == key(paint)
        assert any(key(n) == before for n in doc.rootNode().childNodes())
    test("SVG Stencil imports native shapes above selected paint without changing existing layers", svg_stencil)

    if original:
        app.setActiveDocument(original)
    return {"passed": sum(r["ok"] for r in reports), "total": len(reports), "tests": reports}
