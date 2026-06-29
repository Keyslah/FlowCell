// FlowCell Layers Builder button (GENERATED - do not edit by hand).
// Regenerate with SupportScripts/New-IllustratorLayersBuilderPanel.ps1.
// Runs the original Layers script "copy live" against the
// FlowCell-highlighted layers.
#target illustrator

var FLOWCELL_LB_RESTORE = (function () {
    var restoreList = [];
    if (app.documents.length === 0) { return restoreList; }
    var doc = app.activeDocument;

    function readHighlightKeys() {
        var file = new File(Folder.temp.fsName + '/flowcell-illustrator-layers-highlight.json');
        if (!file.exists) { return []; }
        file.encoding = 'UTF-8';
        if (!file.open('r')) { return []; }
        var text = file.read();
        file.close();
        if (!text) { return []; }
        var parsed;
        try { parsed = eval('(' + text + ')'); } catch (e) { return []; }
        if (!parsed || !parsed.keys || typeof parsed.keys.length !== 'number') { return []; }
        var keys = [];
        for (var i = 0; i < parsed.keys.length; i += 1) { keys.push(String(parsed.keys[i])); }
        return keys;
    }

    function rememberAndOpen(layer) {
        restoreList.push({ layer: layer, locked: layer.locked, visible: layer.visible });
        if (layer.locked) { layer.locked = false; }
        if (!layer.visible) { layer.visible = true; }
    }

    function resolveLayerByKey(key) {
        var segments = String(key).split('.');
        var collection = doc.layers;
        var layer = null;
        for (var i = 0; i < segments.length; i += 1) {
            var index = parseInt(segments[i], 10);
            if (isNaN(index) || index < 0 || index >= collection.length) { return null; }
            layer = collection[index];
            rememberAndOpen(layer);
            collection = layer.layers;
        }
        return layer;
    }

    function collectItems(layer, bucket) {
        var i;
        for (i = 0; i < layer.pageItems.length; i += 1) {
            var item = layer.pageItems[i];
            try {
                if (item.locked) { item.locked = false; }
                if (item.hidden) { item.hidden = false; }
            } catch (flagError) {}
            bucket.push(item);
        }
        for (i = 0; i < layer.layers.length; i += 1) { collectItems(layer.layers[i], bucket); }
    }

    var keys = readHighlightKeys();
    var items = [];
    for (var k = 0; k < keys.length; k += 1) {
        var targetLayer = resolveLayerByKey(keys[k]);
        if (targetLayer) { collectItems(targetLayer, items); }
    }
    try { doc.selection = null; } catch (clearError) {}
    if (items.length > 0) { try { doc.selection = items; } catch (selectError) {} }
    return restoreList;
}());

try {
// Description: Copy the selected item into a new Live sublayer.
#target illustrator

(function () {
    var ROOT_LIVE = "Live";

    if (app.documents.length === 0) {
        alert("Open a document first.");
        return;
    }

    var doc = app.activeDocument;
    var selection = normalizeSelection(doc.selection);
    var liveRoot;
    var defaultName;
    var requestedName;
    var targetLayer;
    var itemsToCopy;
    var sourceLayersToHide;
    var i;

    if (selection.length === 0) {
        alert("Select one or more objects first.");
        return;
    }

    liveRoot = ensureRootLayer(doc, ROOT_LIVE);
    liveRoot.visible = true;
    liveRoot.locked = false;

    defaultName = uniqueChildLayerName(liveRoot, "Live Copy");
    requestedName = prompt("Name for the new Live sublayer:", defaultName, "Copy Selection To Live");

    if (requestedName === null) {
        return;
    }

    requestedName = trimText(requestedName);
    if (requestedName === "") {
        requestedName = defaultName;
    }

    targetLayer = liveRoot.layers.add();
    targetLayer.name = uniqueChildLayerName(liveRoot, requestedName);
    targetLayer.visible = true;
    targetLayer.locked = false;

    itemsToCopy = collectTopLevelSelection(selection);
    sourceLayersToHide = collectSourceLayersToHide(selection, liveRoot, targetLayer);

    for (i = 0; i < itemsToCopy.length; i += 1) {
        duplicateItemToLayer(itemsToCopy[i], resolveDestinationLayer(targetLayer, itemsToCopy[i]));
    }

    for (i = 0; i < sourceLayersToHide.length; i += 1) {
        hideLayer(sourceLayersToHide[i]);
    }

    doc.activeLayer = targetLayer;

    function ensureRootLayer(documentRef, layerName) {
        var layer = findTopLevelLayerByName(documentRef, layerName);

        if (layer) {
            return layer;
        }

        layer = documentRef.layers.add();
        layer.name = layerName;
        layer.visible = true;
        layer.locked = false;
        return layer;
    }

    function findTopLevelLayerByName(documentRef, layerName) {
        var index;

        for (index = 0; index < documentRef.layers.length; index += 1) {
            if (documentRef.layers[index].name === layerName) {
                return documentRef.layers[index];
            }
        }

        return null;
    }

    function normalizeSelection(rawSelection) {
        var result = [];
        var index;

        if (!rawSelection) {
            return result;
        }

        if (typeof rawSelection.length === "number") {
            for (index = 0; index < rawSelection.length; index += 1) {
                if (rawSelection[index]) {
                    result.push(rawSelection[index]);
                }
            }

            return result;
        }

        result.push(rawSelection);
        return result;
    }

    function collectTopLevelSelection(items) {
        var result = [];
        var index;

        for (index = 0; index < items.length; index += 1) {
            if (!hasSelectedAncestor(items[index], items)) {
                result.push(items[index]);
            }
        }

        return result;
    }

    function collectSourceLayersToHide(items, liveRootLayer, destinationLayer) {
        var result = [];
        var index;
        var ownerLayer;

        for (index = 0; index < items.length; index += 1) {
            ownerLayer = getItemOwningLayer(items[index]);
            if (!ownerLayer) {
                continue;
            }

            if (ownerLayer === destinationLayer || ownerLayer === liveRootLayer) {
                continue;
            }

            if (ownerLayer.parent && ownerLayer.parent.typename === "Document") {
                continue;
            }

            addUniqueLayer(result, ownerLayer);
        }

        return result;
    }

    function hasSelectedAncestor(item, selectedItems) {
        var current = item;
        var index;

        while (current) {
            try {
                current = current.parent;
            } catch (ignore1) {
                current = null;
            }

            if (!current) {
                return false;
            }

            for (index = 0; index < selectedItems.length; index += 1) {
                if (selectedItems[index] === current) {
                    return true;
                }
            }
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
            } catch (ignore) {
                current = null;
            }
        }

        return null;
    }

    function resolveDestinationLayer(rootDestinationLayer, sourceItem) {
        var sourceLayer = getItemOwningLayer(sourceItem);
        var layerPath = [];
        var current = sourceLayer;
        var index;
        var destination = rootDestinationLayer;

        if (!sourceLayer) {
            return rootDestinationLayer;
        }

        while (current && current.parent && current.parent.typename === "Layer") {
            layerPath.unshift(current.name);

            try {
                current = current.parent;
            } catch (ignore1) {
                current = null;
            }
        }

        for (index = 0; index < layerPath.length; index += 1) {
            destination = ensureChildLayer(destination, layerPath[index]);
        }

        return destination;
    }

    function addUniqueLayer(store, layer) {
        var index;

        for (index = 0; index < store.length; index += 1) {
            if (store[index] === layer) {
                return;
            }
        }

        store.push(layer);
    }

    function ensureChildLayer(parentLayer, layerName) {
        var index;
        var childLayer;

        for (index = 0; index < parentLayer.layers.length; index += 1) {
            if (parentLayer.layers[index].name === layerName) {
                childLayer = parentLayer.layers[index];
                childLayer.visible = true;
                childLayer.locked = false;
                return childLayer;
            }
        }

        childLayer = parentLayer.layers.add();
        childLayer.name = layerName;
        childLayer.visible = true;
        childLayer.locked = false;
        return childLayer;
    }

    function duplicateItemToLayer(sourceItem, destinationLayer) {
        var lockedState = safeRead(sourceItem, "locked", false);
        var hiddenState = safeRead(sourceItem, "hidden", false);
        var duplicate;

        try {
            sourceItem.locked = false;
        } catch (ignore1) {}

        try {
            sourceItem.hidden = false;
        } catch (ignore2) {}

        duplicate = sourceItem.duplicate(destinationLayer, ElementPlacement.PLACEATEND);

        try {
            duplicate.locked = lockedState;
        } catch (ignore3) {}

        try {
            duplicate.hidden = hiddenState;
        } catch (ignore4) {}

        try {
            sourceItem.locked = lockedState;
        } catch (ignore5) {}

        try {
            sourceItem.hidden = hiddenState;
        } catch (ignore6) {}
    }

    function hideLayer(layer) {
        try {
            layer.locked = false;
        } catch (ignore1) {}

        try {
            layer.visible = false;
        } catch (ignore2) {}
    }

    function uniqueChildLayerName(parentLayer, baseName) {
        var candidate = baseName;
        var suffix = 2;

        while (childLayerNameExists(parentLayer, candidate)) {
            candidate = baseName + " " + suffix;
            suffix += 1;
        }

        return candidate;
    }

    function childLayerNameExists(parentLayer, layerName) {
        var index;

        for (index = 0; index < parentLayer.layers.length; index += 1) {
            if (parentLayer.layers[index].name === layerName) {
                return true;
            }
        }

        return false;
    }

    function trimText(value) {
        return String(value).replace(/^\s+|\s+$/g, "");
    }

    function safeRead(obj, propertyName, fallbackValue) {
        try {
            return obj[propertyName];
        } catch (ignore) {
            return fallbackValue;
        }
    }
}());

} finally {
    (function () {
        if (!FLOWCELL_LB_RESTORE) { return; }
        for (var r = FLOWCELL_LB_RESTORE.length - 1; r >= 0; r -= 1) {
            var entry = FLOWCELL_LB_RESTORE[r];
            try {
                entry.layer.locked = entry.locked;
                entry.layer.visible = entry.visible;
            } catch (restoreError) {}
        }
        try { app.redraw(); } catch (redrawError) {}
    }());
}
