#target illustrator

(function () {
    if (!app.documents.length) {
        alert("No document is open.");
        return;
    }

    var doc = app.activeDocument;

    if (!doc.selection || doc.selection.length === 0) {
        alert("Select at least one object first.");
        return;
    }

    var originalActiveLayer = doc.activeLayer;
    var selectedItems = doc.selection;
    var sourceLayers = getUniqueSelectedLayers(selectedItems);

    if (sourceLayers.length === 0) {
        alert("Could not determine layers from the current selection.");
        return;
    }

    for (var i = 0; i < sourceLayers.length; i++) {
        var sourceLayer = sourceLayers[i];
        var parentContainer = sourceLayer.parent;

        var dupLayer = createSiblingLayer(parentContainer);
        dupLayer.name = getNextCopyName(parentContainer, sourceLayer.name);

        copyLayerContents(sourceLayer, dupLayer);

        moveLayerToBottom(dupLayer, parentContainer);

        dupLayer.visible = false;
        dupLayer.locked = true;
    }

    try {
        doc.activeLayer = originalActiveLayer;
    } catch (e) {}

    try {
        doc.selection = null;
        for (var j = 0; j < selectedItems.length; j++) {
            selectedItems[j].selected = true;
        }
    } catch (e2) {}

    function getUniqueSelectedLayers(items) {
        var result = [];
        var seen = {};

        for (var i = 0; i < items.length; i++) {
            var lyr = items[i].layer;
            if (!lyr) continue;

            var key = getLayerKey(lyr);
            if (!seen[key]) {
                seen[key] = true;
                result.push(lyr);
            }
        }

        return result;
    }

    function getLayerKey(layerObj) {
        var parts = [];
        var current = layerObj;

        while (current && current.typename === "Layer") {
            parts.unshift(current.name);
            current = current.parent;
            if (!current || current.typename !== "Layer") break;
        }

        return parts.join(" / ");
    }

    function getSiblingLayers(container) {
        if (container.typename === "Document") return container.layers;
        if (container.typename === "Layer") return container.layers;
        return null;
    }

    function createSiblingLayer(container) {
        if (container.typename === "Document") {
            return container.layers.add();
        }
        if (container.typename === "Layer") {
            return container.layers.add();
        }
        throw new Error("Unsupported parent container for layer creation.");
    }

    function nameExistsInContainer(container, testName) {
        var siblings = getSiblingLayers(container);
        if (!siblings) return false;

        for (var i = 0; i < siblings.length; i++) {
            if (siblings[i].name === testName) return true;
        }
        return false;
    }

    function getNextCopyName(container, baseName) {
        var n = 1;
        while (true) {
            var candidate = baseName + " c" + n;
            if (!nameExistsInContainer(container, candidate)) {
                return candidate;
            }
            n++;
        }
    }

    function moveLayerToBottom(layerObj, container) {
        var siblings = getSiblingLayers(container);
        if (!siblings || siblings.length < 2) return;

        try {
            layerObj.zOrder(ZOrderMethod.SENDTOBACK);
        } catch (e) {
            try {
                var lastSibling = siblings[siblings.length - 1];
                if (lastSibling !== layerObj) {
                    layerObj.move(lastSibling, ElementPlacement.PLACEAFTER);
                }
            } catch (e2) {}
        }
    }

    function copyLayerContents(sourceLayer, targetLayer) {
        copyPageItems(sourceLayer, targetLayer);
        copySubLayers(sourceLayer, targetLayer);
    }

    function copyPageItems(sourceLayer, targetLayer) {
        var items = sourceLayer.pageItems;
        var copies = [];

        for (var i = 0; i < items.length; i++) {
            copies.push(items[i]);
        }

        for (var j = copies.length - 1; j >= 0; j--) {
            try {
                copies[j].duplicate(targetLayer, ElementPlacement.PLACEATBEGINNING);
            } catch (e) {}
        }
    }

    function copySubLayers(sourceLayer, targetLayer) {
        var sublayers = sourceLayer.layers;
        var refs = [];

        for (var i = 0; i < sublayers.length; i++) {
            refs.push(sublayers[i]);
        }

        for (var j = refs.length - 1; j >= 0; j--) {
            duplicateLayerRecursive(refs[j], targetLayer);
        }
    }

    function duplicateLayerRecursive(sourceLayer, parentContainer) {
        var newLayer = createSiblingLayer(parentContainer);
        newLayer.name = sourceLayer.name;
        newLayer.visible = sourceLayer.visible;
        newLayer.locked = false;
        newLayer.printable = sourceLayer.printable;

        copyPageItems(sourceLayer, newLayer);
        copySubLayers(sourceLayer, newLayer);

        return newLayer;
    }

})();