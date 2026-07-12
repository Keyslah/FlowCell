// FlowCell Layers Builder catalog source.
// Runs the original Layers script "empty sublayers" against the
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
// Description: Remove empty sublayers from the active layer structure.

#target illustrator

(function () {
    if (app.documents.length === 0) {
        alert("Open a document before running this script.");
        return;
    }

    var doc = app.activeDocument;
    var deletedCount = 0;

    function withUnlockedVisibleLayer(layer, fn) {
        var previousLocked = layer.locked;
        var previousVisible = layer.visible;

        if (previousLocked) {
            layer.locked = false;
        }
        if (!previousVisible) {
            layer.visible = true;
        }

        try {
            return fn();
        } finally {
            layer.locked = previousLocked;
            layer.visible = previousVisible;
        }
    }

    function layerIsEmpty(layer) {
        return layer.layers.length === 0 &&
            layer.pageItems.length === 0 &&
            layer.compoundPathItems.length === 0 &&
            layer.groupItems.length === 0 &&
            layer.pathItems.length === 0 &&
            layer.textFrames.length === 0 &&
            layer.placedItems.length === 0 &&
            layer.rasterItems.length === 0 &&
            layer.meshItems.length === 0 &&
            layer.pluginItems.length === 0 &&
            layer.symbolItems.length === 0 &&
            layer.graphItems.length === 0 &&
            layer.nonNativeItems.length === 0;
    }

    function removeEmptyChildren(parentLayer) {
        for (var i = parentLayer.layers.length - 1; i >= 0; i--) {
            var child = parentLayer.layers[i];

            withUnlockedVisibleLayer(child, function () {
                removeEmptyChildren(child);
            });

            withUnlockedVisibleLayer(child, function () {
                if (layerIsEmpty(child)) {
                    child.remove();
                    deletedCount++;
                }
            });
        }
    }

    for (var i = doc.layers.length - 1; i >= 0; i--) {
        withUnlockedVisibleLayer(doc.layers[i], function () {
            removeEmptyChildren(doc.layers[i]);
        });
    }

    alert("Deleted " + deletedCount + " empty sublayer" + (deletedCount === 1 ? "" : "s") + ".");
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
