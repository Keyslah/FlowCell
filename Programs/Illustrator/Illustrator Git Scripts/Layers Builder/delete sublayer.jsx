// FlowCell Layers Builder catalog source.
// Directly deletes the FlowCell-highlighted layers/sublayers (works on empty,
// locked, or hidden layers), instead of the selection-driven original.
#target illustrator

(function () {
    if (app.documents.length === 0) { return; }
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

    function unlockTree(layer) {
        try { layer.locked = false; } catch (e1) {}
        try { layer.visible = true; } catch (e2) {}
        for (var i = 0; i < layer.layers.length; i += 1) { unlockTree(layer.layers[i]); }
    }

    function resolveLayerByKey(key) {
        var segments = String(key).split('.');
        var collection = doc.layers;
        var layer = null;
        for (var i = 0; i < segments.length; i += 1) {
            var index = parseInt(segments[i], 10);
            if (isNaN(index) || index < 0 || index >= collection.length) { return null; }
            layer = collection[index];
            try { layer.locked = false; } catch (eAnc1) {}
            try { layer.visible = true; } catch (eAnc2) {}
            collection = layer.layers;
        }
        return layer;
    }

    var keys = readHighlightKeys();
    var doomed = [];
    for (var k = 0; k < keys.length; k += 1) {
        var resolved = resolveLayerByKey(keys[k]);
        if (resolved) { doomed.push(resolved); }
    }
    // Resolve to references first, then remove (index shifts do not matter).
    for (var d = 0; d < doomed.length; d += 1) {
        try {
            unlockTree(doomed[d]);
            doomed[d].remove();
        } catch (removeError) {}
    }
    try { app.redraw(); } catch (redrawError) {}
}());
