// Description: Runs 3D Macro Cleanup.
#target illustrator

(function () {
    var ROOT_3D = "3D";

    if (app.documents.length === 0) {
        return;
    }

    var doc = app.activeDocument;
    var root3D = findTopLevelLayerByName(doc, ROOT_3D);

    if (!root3D) {
        return;
    }

    stripTemporaryMarkersInBranch(root3D);
    clearSelectionHard(doc);
    app.redraw();

    function findTopLevelLayerByName(documentRef, layerName) {
        var i;

        for (i = 0; i < documentRef.layers.length; i += 1) {
            if (documentRef.layers[i].name === layerName) {
                return documentRef.layers[i];
            }
        }

        return null;
    }

    function stripTemporaryMarkersInBranch(rootLayer) {
        var i;

        if (!rootLayer) {
            return;
        }

        try {
            rootLayer.name = removeTemporaryMarkerPrefix(rootLayer.name);
        } catch (ignore1) {}

        for (i = 0; i < rootLayer.layers.length; i += 1) {
            stripTemporaryMarkersInBranch(rootLayer.layers[i]);
        }
    }

    function removeTemporaryMarkerPrefix(layerName) {
        return String(layerName).replace(/^\(P\d+\)/i, "");
    }

    function clearSelection(documentRef) {
        try {
            documentRef.selection = null;
        } catch (ignore1) {}

        try {
            app.selection = null;
        } catch (ignore2) {}
    }

    function clearSelectionHard(documentRef) {
        var i;

        clearSelection(documentRef);
        for (i = 0; i < documentRef.pageItems.length; i += 1) {
            try {
                documentRef.pageItems[i].selected = false;
            } catch (ignore3) {}
        }
        clearSelection(documentRef);
    }
}());
