"""Import an SVG as a labeled vector stencil above a new paint layer."""
from pathlib import Path

from krita import Krita
from PyQt5.QtWidgets import QFileDialog


STENCIL_COLOR_LABEL = 1


def import_svg_stencil(document=None, svg_path=None, parent=None):
    """Return a status string, leaving the document alone on cancel or failure."""
    if document is None:
        document = Krita.instance().activeDocument()
    if document is None:
        raise ValueError("Open or create a Krita document first.")

    if svg_path is None:
        svg_path, _ = QFileDialog.getOpenFileName(
            parent, "Choose SVG Stencil", "", "SVG Files (*.svg)")
    if not svg_path:
        return "SVG Stencil import canceled."

    source = Path(svg_path)
    try:
        svg_text = source.read_text(encoding="utf-8-sig")
    except Exception as error:
        raise ValueError("Could not read SVG: " + str(error)) from error

    vector = document.createVectorLayer("SVG Stencil")
    if vector is None:
        raise RuntimeError("Krita could not create the SVG Stencil vector layer.")
    try:
        shapes = vector.addShapesFromSvg(svg_text)
    except Exception as error:
        raise ValueError("Krita could not import the SVG shapes: " + str(error)) from error
    if not shapes:
        raise ValueError("The SVG opened, but Krita found no importable shapes.")

    group = document.createGroupLayer(source.stem)
    paint = document.createNode("Paint Here", "paintlayer")
    if group is None or paint is None:
        raise RuntimeError("Krita could not create the stencil group and paint layer.")
    vector.setColorLabel(STENCIL_COLOR_LABEL)
    if not group.addChildNode(paint, None) or not group.addChildNode(vector, paint):
        raise RuntimeError("Krita could not attach the stencil layers to their group.")
    if [node.name() for node in group.childNodes()] != ["Paint Here", "SVG Stencil"]:
        raise RuntimeError("Krita did not stack the stencil above the paint layer.")
    if not document.rootNode().addChildNode(group, None):
        raise RuntimeError("Krita could not add the stencil group to the document.")

    document.setActiveNode(paint)
    document.refreshProjection()
    return "Imported SVG Stencil from " + source.name
