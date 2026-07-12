// FlowCell Layers Builder catalog source.
// Runs the original Layers script "b lock" against the
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
// Description: Record the current layer lock states as the baseline.

#target illustrator

(function () {
    var SCRIPT_VERSION = "2026-06-15 11:20";
    var LOG_PATH = Folder.temp.fsName + "/Illustrator_LayerState_lock_Debug.log";

    if (app.documents.length === 0) {
        resetLog(null);
        logLine("No open document; lock baseline not saved.");
        return;
    }

    var doc = app.activeDocument;
    resetLog(doc);

    var payload = {
        documentKey: getDocumentKey(doc),
        entries: captureLayerState(doc, "locked", false)
    };

    if (writeStateFile("lock", payload)) {
        logLine("Saved lock baseline entries: " + payload.entries.length);
    }

    function captureLayerState(documentRef, propertyName, fallbackValue) {
        var state = [];
        var i;

        for (i = 0; i < documentRef.layers.length; i += 1) {
            collectLayerState(documentRef.layers[i], propertyName, fallbackValue, state);
        }

        return state;
    }

    function collectLayerState(layer, propertyName, fallbackValue, store) {
        var i;
        var segment = {
            name: layer.name,
            occurrence: getSiblingOccurrence(layer)
        };
        var segments = getSegments(layer, segment);

        store.push({
            segments: segments,
            depth: segments.length - 1,
            value: safeRead(layer, propertyName, fallbackValue)
        });

        for (i = 0; i < layer.layers.length; i += 1) {
            collectLayerState(layer.layers[i], propertyName, fallbackValue, store);
        }
    }

    function getSegments(layer, lastSegment) {
        var segments = [lastSegment];
        var current = layer.parent;

        while (current && current.typename === "Layer") {
            segments.unshift({
                name: current.name,
                occurrence: getSiblingOccurrence(current)
            });
            current = current.parent;
        }

        return segments;
    }

    function getSiblingOccurrence(layer) {
        var parent = layer.parent;
        var siblings = parent.layers;
        var occurrence = 0;
        var i;

        for (i = 0; i < siblings.length; i += 1) {
            if (siblings[i] === layer) {
                return occurrence;
            }

            if (siblings[i].name === layer.name) {
                occurrence += 1;
            }
        }

        return occurrence;
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

    function writeStateFile(kind, payload) {
        var file = new File(Folder.temp.fsName + "/Illustrator_LayerState_" + kind + "_" + payload.documentKey + ".txt");
        try {
            file.encoding = "UTF-8";
            file.open("w");
            file.write(payload.toSource());
            file.close();
            logLine("Wrote baseline file: " + file.fsName);
            return true;
        } catch (err) {
            logLine("Failed to write baseline file: " + err);
            return false;
        }
    }

    function resetLog(documentRef) {
        var file = new File(LOG_PATH);

        if (file.exists) {
            try {
                file.remove();
            } catch (ignore) {}
        }

        logLine("Baseline Lock version: " + SCRIPT_VERSION);
        if (documentRef) {
            logLine("Document: " + safeDocName(documentRef));
            logLine("Document key: " + getDocumentKey(documentRef));
        }
    }

    function logLine(message) {
        var file = new File(LOG_PATH);

        try {
            file.encoding = "UTF-8";
            file.open("a");
            file.writeln(message);
            file.close();
        } catch (ignore) {}
    }

    function safeDocName(documentRef) {
        try {
            return documentRef.name;
        } catch (ignore) {
            return "[unknown document]";
        }
    }

    function sanitizeToken(value) {
        return String(value || "untitled").replace(/[^A-Za-z0-9._-]+/g, "_").substr(0, 120);
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
