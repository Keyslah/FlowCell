#target illustrator

(function () {
    var MARKER = "P3";
    var ROOT_3D = "3D";

    if (app.documents.length === 0) {
        return;
    }

    var doc = app.activeDocument;
    var root3D = findTopLevelLayerByName(doc, ROOT_3D);
    var markerLayer;

    if (!root3D) {
        throw new Error("Could not find the 3D root layer.");
    }

    markerLayer = findLayerByTemporaryMarker(root3D, MARKER);
    if (!markerLayer) {
        throw new Error("Could not find marker layer " + MARKER + " under 3D.");
    }

    clearSelectionHard(doc);
    ensureLayerPathVisibleUnlocked(markerLayer);
    unlockBranch(markerLayer);
    restoreActiveLayer(doc, markerLayer);
    try {
        app.redraw();
    } catch (ignore0) {}

    if (selectBranchItemsRecursive(markerLayer) === 0) {
        throw new Error("Marker layer " + MARKER + " has no visible objects to select.");
    }

    if (trimSelectionToLayer(doc, markerLayer) === 0) {
        throw new Error("Marker layer " + MARKER + " did not keep a clean copied-branch selection.");
    }

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

    function findLayerByTemporaryMarker(rootLayer, marker) {
        var i;
        var childResult;
        var expectedPrefix = "(" + marker + ")";

        if (!rootLayer) {
            return null;
        }

        if (String(rootLayer.name).indexOf(expectedPrefix) === 0) {
            return rootLayer;
        }

        for (i = 0; i < rootLayer.layers.length; i += 1) {
            childResult = findLayerByTemporaryMarker(rootLayer.layers[i], marker);
            if (childResult) {
                return childResult;
            }
        }

        return null;
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

    function trimSelectionToLayer(documentRef, allowedLayer) {
        var selection = normalizeSelection(documentRef.selection);
        var kept = 0;
        var i;

        for (i = 0; i < selection.length; i += 1) {
            if (isItemInsideLayerBranch(selection[i], allowedLayer)) {
                kept += 1;
                continue;
            }

            try {
                selection[i].selected = false;
            } catch (ignore4) {}
        }

        return kept;
    }

    function normalizeSelection(rawSelection) {
        var result = [];
        var i;

        if (!rawSelection) {
            return result;
        }

        if (typeof rawSelection.length === "number") {
            for (i = 0; i < rawSelection.length; i += 1) {
                if (rawSelection[i]) {
                    result.push(rawSelection[i]);
                }
            }

            if (result.length > 0) {
                return result;
            }
        }

        if (rawSelection.typename) {
            result.push(rawSelection);
        }

        return result;
    }

    function isItemInsideLayerBranch(item, allowedLayer) {
        var current = getItemOwningLayer(item);

        while (current && current.typename === "Layer") {
            if (current === allowedLayer) {
                return true;
            }

            current = current.parent;
        }

        return false;
    }

    function getItemOwningLayer(item) {
        var current = item;

        while (current) {
            if (current.typename === "Layer") {
                return current;
            }

            try {
                current = current.parent;
            } catch (ignore5) {
                current = null;
            }
        }

        return null;
    }

    function ensureLayerPathVisibleUnlocked(layerRef) {
        var current = layerRef;

        while (current && current.typename === "Layer") {
            try {
                current.visible = true;
                current.locked = false;
            } catch (ignore) {}

            current = current.parent;
        }
    }

    function unlockBranch(layerRef) {
        var i;
        var items;

        if (!layerRef) {
            return;
        }

        try {
            layerRef.visible = true;
            layerRef.locked = false;
        } catch (ignore1) {}

        items = getDirectPageItems(layerRef);
        for (i = 0; i < items.length; i += 1) {
            try {
                items[i].locked = false;
            } catch (ignore2) {}
        }

        for (i = 0; i < layerRef.layers.length; i += 1) {
            unlockBranch(layerRef.layers[i]);
        }
    }

    function restoreActiveLayer(documentRef, layerRef) {
        try {
            documentRef.activeLayer = layerRef;
        } catch (ignore) {}
    }

    function selectBranchItemsRecursive(layerRef) {
        var count = 0;
        var directItems = getDirectPageItems(layerRef);
        var i;

        if (!isLayerEffectivelyVisible(layerRef)) {
            return 0;
        }

        for (i = 0; i < directItems.length; i += 1) {
            try {
                if (!directItems[i].hidden) {
                    directItems[i].selected = true;
                    count += 1;
                }
            } catch (ignore1) {}
        }

        for (i = 0; i < layerRef.layers.length; i += 1) {
            count += selectBranchItemsRecursive(layerRef.layers[i]);
        }

        return count;
    }

    function getDirectPageItems(layerRef) {
        var result = [];
        var i;

        for (i = 0; i < layerRef.pageItems.length; i += 1) {
            if (layerRef.pageItems[i].layer === layerRef) {
                result.push(layerRef.pageItems[i]);
            }
        }

        return result;
    }

    function isLayerEffectivelyVisible(layerRef) {
        var current = layerRef;

        while (current && current.typename === "Layer") {
            if (!current.visible) {
                return false;
            }

            current = current.parent;
        }

        return true;
    }
}());
