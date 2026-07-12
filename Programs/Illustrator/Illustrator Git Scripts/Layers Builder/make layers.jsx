// FlowCell Layers Builder catalog source.
// Runs the original Layers script "make layers" against the
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
// Description: Create and order the Live, Snapshots, 3D, Trash, and Archive root layers.

#target illustrator

/*
 * Ensures the top-level Live, Snapshots, 3D, Trash, and Archive layers exist,
 * then anchors those root layers top-to-bottom as Live, Snapshots, 3D, Trash,
 * Archive so 3D stays directly below Snapshots.
 */
(function () {
    var SCRIPT_VERSION = "2026-03-28 keep 3D below Snapshots";

    if (app.documents.length === 0) {
        return;
    }

    var doc = app.activeDocument;
    var rootLayers;
    var threeDLayer;
    var trashLayer;
    var archiveLayer;

    try {
        rootLayers = ensureRootLayers(doc);
        threeDLayer = rootLayers.threeD;
        trashLayer = rootLayers.trash;
        archiveLayer = rootLayers.archive;

        writeDebug("Run " + SCRIPT_VERSION + " on " + safeDocName(doc));
        orderRootLayers(rootLayers);
        setSystemLayerState(threeDLayer, true, false);
        setSystemLayerState(trashLayer, false, true);
        setSystemLayerState(archiveLayer, false, true);
    } catch (err) {
        writeDebug("Initialization failed: " + err);
    }

    function ensureRootLayers(documentRef) {
        return {
            live: ensureRootLayer(documentRef, "Live"),
            snapshots: ensureRootLayer(documentRef, "Snapshots"),
            threeD: ensureRootLayer(documentRef, "3D"),
            trash: ensureRootLayer(documentRef, "Trash"),
            archive: ensureRootLayer(documentRef, "Archive")
        };
    }

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
        var i;
        for (i = 0; i < documentRef.layers.length; i += 1) {
            if (documentRef.layers[i].name === layerName) {
                return documentRef.layers[i];
            }
        }
        return null;
    }

    function orderRootLayers(rootLayerMap) {
        var orderedLayers = [
            rootLayerMap.live,
            rootLayerMap.snapshots,
            rootLayerMap.threeD,
            rootLayerMap.trash,
            rootLayerMap.archive
        ];
        var i;

        for (i = orderedLayers.length - 1; i >= 0; i -= 1) {
            prepareLayerForMove(orderedLayers[i]);
            orderedLayers[i].zOrder(ZOrderMethod.BRINGTOFRONT);
        }

        moveLayerBeforeSibling(rootLayerMap.live, rootLayerMap.snapshots);
        moveLayerBeforeSibling(rootLayerMap.snapshots, rootLayerMap.threeD);
        moveLayerBeforeSibling(rootLayerMap.threeD, rootLayerMap.trash);
        moveLayerBeforeSibling(rootLayerMap.trash, rootLayerMap.archive);
        writeDebug("Root order anchored as Live > Snapshots > 3D > Trash > Archive");
    }

    function prepareLayerForMove(layer) {
        if (!layer) {
            return;
        }

        try {
            layer.visible = true;
        } catch (ignore1) {}

        try {
            layer.locked = false;
        } catch (ignore2) {}
    }

    function moveLayerBeforeSibling(layerToMove, siblingLayer) {
        if (!layerToMove || !siblingLayer || layerToMove === siblingLayer) {
            return;
        }

        prepareLayerForMove(layerToMove);
        prepareLayerForMove(siblingLayer);

        try {
            layerToMove.move(siblingLayer, ElementPlacement.PLACEBEFORE);
        } catch (err) {
            writeDebug("Move before sibling failed for " + safeLayerName(layerToMove) + " -> " + safeLayerName(siblingLayer) + ": " + err);
        }
    }

    function writeDebug(message) {
        try {
            $.writeln("[00_Init] " + message);
        } catch (ignore) {}
    }

    function safeDocName(documentRef) {
        try {
            return documentRef.name;
        } catch (ignore) {
            return "[unknown document]";
        }
    }

    function safeLayerName(layer) {
        try {
            return layer.name;
        } catch (ignore) {
            return "[unknown layer]";
        }
    }

    function setSystemLayerState(layer, visible, locked) {
        if (!layer) {
            return;
        }

        try {
            layer.visible = visible;
        } catch (ignore1) {}

        try {
            layer.locked = locked;
        } catch (ignore2) {}
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
