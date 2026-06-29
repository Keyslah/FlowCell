// FlowCell Layers Builder button (GENERATED - do not edit by hand).
// Regenerate with SupportScripts/New-IllustratorLayersBuilderPanel.ps1.
// Runs the original Layers script "empty trash" against the
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
// Description: Delete all contents currently stored in Trash.


#target illustrator

/*
 * Deletes everything inside the top-level Trash layer after confirmation,
 * while leaving the Trash layer itself in place.
 */
(function () {
    if (app.documents.length === 0) {
        return;
    }

    var ROOT_LIVE = "Live";
    var ROOT_SNAPSHOTS = "Snapshots";
    var ROOT_TRASH = "Trash";
    var ROOT_ARCHIVE = "Archive";

    var doc = app.activeDocument;
    var originalActiveLayer = doc.activeLayer;
    var roots = null;

    try {
        roots = ensureRootLayers(doc);
        roots.trash.visible = true;
        roots.trash.locked = false;
        clearLayerContents(roots.trash);
    } catch (err) {
        writeDebug("Empty Trash failed: " + err);
    } finally {
        if (roots) {
            setSystemLayerState(roots.trash, false, true);
            setSystemLayerState(roots.archive, false, true);
        }
        restoreActiveLayer(doc, originalActiveLayer);
    }

    function ensureRootLayers(documentRef) {
        return {
            live: ensureRootLayer(documentRef, ROOT_LIVE),
            snapshots: ensureRootLayer(documentRef, ROOT_SNAPSHOTS),
            trash: ensureRootLayer(documentRef, ROOT_TRASH),
            archive: ensureRootLayer(documentRef, ROOT_ARCHIVE)
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

    function captureBranchState(rootLayer) {
        var state = {
            layers: [],
            items: []
        };

        captureLayerStatesRecursive(rootLayer, state.layers);
        captureItemStates(rootLayer, state.items);
        return state;
    }

    function captureLayerStatesRecursive(layer, store) {
        var i;
        store.push({
            ref: layer,
            locked: layer.locked,
            visible: layer.visible
        });

        for (i = 0; i < layer.layers.length; i += 1) {
            captureLayerStatesRecursive(layer.layers[i], store);
        }
    }

    function captureItemStates(rootLayer, store) {
        var i;
        for (i = 0; i < rootLayer.pageItems.length; i += 1) {
            store.push({
                ref: rootLayer.pageItems[i],
                locked: rootLayer.pageItems[i].locked,
                hidden: rootLayer.pageItems[i].hidden
            });
        }
    }

    function unlockBranchFromState(state) {
        var i;
        for (i = 0; i < state.layers.length; i += 1) {
            try {
                state.layers[i].ref.visible = true;
                state.layers[i].ref.locked = false;
            } catch (ignore1) {}
        }

        for (i = 0; i < state.items.length; i += 1) {
            try {
                state.items[i].ref.hidden = false;
                state.items[i].ref.locked = false;
            } catch (ignore2) {}
        }
    }

    function clearLayerContents(layer) {
        var state = captureBranchState(layer);
        unlockBranchFromState(state);

        while (layer.pageItems.length > 0) {
            layer.pageItems[0].remove();
        }

        while (layer.layers.length > 0) {
            layer.layers[0].remove();
        }

        layer.visible = true;
        layer.locked = false;
    }

    function restoreActiveLayer(documentRef, layerRef) {
        try {
            if (layerRef) {
                documentRef.activeLayer = layerRef;
            }
        } catch (ignore) {}
    }

    function writeDebug(message) {
        try {
            $.writeln("[06_Empty_Trash] " + message);
        } catch (ignore) {}
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
