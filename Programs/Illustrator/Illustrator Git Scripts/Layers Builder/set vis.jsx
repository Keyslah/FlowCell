// FlowCell Layers Builder button (GENERATED - do not edit by hand).
// Regenerate with SupportScripts/New-IllustratorLayersBuilderPanel.ps1.
// Runs the original Layers script "set vis" against the
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
// Description: Restore layer visibility from the saved baseline.

#target illustrator

(function () {
    if (app.documents.length === 0) {
        return;
    }

    var doc = app.activeDocument;
    var payload = readStateFile("visibility", getDocumentKey(doc));
    var entries;
    var i;

    if (!payload || !payload.entries || !payload.entries.length) {
        return;
    }

    entries = resolveExistingEntries(doc, payload.entries);
    entries.sort(function (a, b) {
        return a.depth - b.depth;
    });

    for (i = 0; i < entries.length; i += 1) {
        try {
            entries[i].layer.visible = entries[i].value;
        } catch (ignore) {}
    }

    function resolveExistingEntries(documentRef, source) {
        var result = [];
        var i;
        var layer;

        for (i = 0; i < source.length; i += 1) {
            layer = resolveLayerBySegments(documentRef, source[i].segments);
            if (layer) {
                result.push({
                    layer: layer,
                    depth: source[i].depth,
                    value: source[i].value
                });
            }
        }

        return result;
    }

    function resolveLayerBySegments(documentRef, segments) {
        var siblings = documentRef.layers;
        var current = null;
        var segment;
        var i;

        for (i = 0; i < segments.length; i += 1) {
            segment = segments[i];
            current = findSiblingByOccurrence(siblings, segment.name, segment.occurrence);
            if (!current) {
                return null;
            }
            siblings = current.layers;
        }

        return current;
    }

    function findSiblingByOccurrence(layers, name, occurrence) {
        var count = 0;
        var i;

        for (i = 0; i < layers.length; i += 1) {
            if (layers[i].name !== name) {
                continue;
            }
            if (count === occurrence) {
                return layers[i];
            }
            count += 1;
        }

        return null;
    }

    function getDocumentKey(documentRef) {
        var source;

        try {
            source = documentRef.fullName.fsName;
        } catch (ignore) {
            source = documentRef.name;
        }

        return sanitizeToken(source);
    }

    function readStateFile(kind, documentKey) {
        var file = new File(Folder.temp.fsName + "/Illustrator_LayerState_" + kind + "_" + documentKey + ".txt");
        var text;

        if (!file.exists) {
            return null;
        }

        file.encoding = "UTF-8";
        file.open("r");
        text = file.read();
        file.close();

        return eval(text);
    }

    function sanitizeToken(value) {
        return String(value || "untitled").replace(/[^A-Za-z0-9._-]+/g, "_").substr(0, 120);
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
