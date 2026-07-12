// FlowCell Layers Builder catalog source.
// Runs the original Layers script "new sub" against the
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
// Description: Create a new sublayer for the current selection.

#target illustrator

(function () {
    if (app.documents.length === 0) {
        app.documents.add();
    }

    var doc = app.activeDocument;
    var parentLayer = resolveParentLayer(doc);
    var defaultName = uniqueChildLayerName(parentLayer, "Sublayer");
    var requestedName = prompt("Name for the new sublayer:", defaultName, "Create New Sublayer");
    var newLayer;

    if (requestedName === null) {
        return;
    }

    requestedName = trimText(requestedName);
    if (requestedName === "") {
        requestedName = defaultName;
    }

    if (parentLayer.locked) {
        parentLayer.locked = false;
    }

    if (!parentLayer.visible) {
        parentLayer.visible = true;
    }

    newLayer = parentLayer.layers.add();
    newLayer.name = uniqueChildLayerName(parentLayer, requestedName);
    newLayer.visible = true;
    newLayer.locked = false;
    doc.activeLayer = newLayer;

    function resolveParentLayer(documentRef) {
        var selection = normalizeSelection(documentRef.selection);

        if (selection.length > 0) {
            try {
                if (selection[0].layer) {
                    return selection[0].layer;
                }
            } catch (ignore) {}
        }

        return documentRef.activeLayer || documentRef.layers[0] || documentRef.layers.add();
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
            return result;
        }

        result.push(rawSelection);
        return result;
    }

    function uniqueChildLayerName(parent, baseName) {
        var candidate = baseName;
        var suffix = 2;

        while (childLayerNameExists(parent, candidate)) {
            candidate = baseName + " " + suffix;
            suffix += 1;
        }

        return candidate;
    }

    function childLayerNameExists(parent, name) {
        var i;

        for (i = 0; i < parent.layers.length; i += 1) {
            if (parent.layers[i].name === name) {
                return true;
            }
        }

        return false;
    }

    function trimText(value) {
        return String(value).replace(/^\s+|\s+$/g, "");
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
