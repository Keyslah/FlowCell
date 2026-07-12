// FlowCell Layers Builder catalog source.
// Runs the original Layers script "Sort" against the
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
// Description: Sort top-level layers into Live, Snapshots, and Trash.
#target illustrator

/*
 * Builds the standard root structure and redistributes top-level source layers:
 * - visible layers -> Live > [exact visible layer name]
 * - invisible layers whose family exists in Live -> Snapshots > [exact visible Live layer name] > sN
 * - everything else -> Trash > [base name] > Tn
 *
 * Hidden layers are never placed in Live. A visible layer becomes the live
 * original even if its name contains "copy".
 */
(function () {
    var SCRIPT_VERSION = "2026-06-15 10:35";
    var LOG_PATH = Folder.temp.fsName + "/Illustrator_Sort_Layers_Into_Live_Snapshots_Trash_Debug.log";
    var ROOT_LIVE = "Live";
    var ROOT_SNAPSHOTS = "Snapshots";
    var ROOT_TRASH = "Trash";
    var ROOT_ARCHIVE = "Archive";

    if (app.documents.length === 0) {
        return;
    }

    var doc = app.activeDocument;
    var originalActiveLayer = doc.activeLayer;
    var roots = null;
    var liveLockState = null;

    try {
        resetLog(doc);
        roots = ensureRootLayers(doc);
        liveLockState = captureLayerLockState(roots.live, false);
        prepareRoots(roots);

        var sourceLayers = collectSourceLayers(doc);
        var liveBaseLookup = collectLiveBaseLookup(sourceLayers);
        var i;

        logLine("Source layer count: " + sourceLayers.length);
        logLine("Visible base count for Live: " + countOwnKeys(liveBaseLookup));

        for (i = sourceLayers.length - 1; i >= 0; i -= 1) {
            routeSourceLayer(sourceLayers[i], roots, liveBaseLookup);
        }

        orderRootLayers([
            roots.live,
            roots.snapshots,
            roots.trash,
            roots.archive
        ]);
    } catch (err) {
        logLine("Exception: " + err);
    } finally {
        if (roots) {
            hideSnapshotDescendants(roots.snapshots);
            setSystemLayerState(roots.trash, false, true);
            setSystemLayerState(roots.archive, false, true);
            setSystemLayerState(roots.snapshots, true, false);
            restoreLayerLocksFromState(liveLockState);
        }
        restoreActiveLayer(doc, originalActiveLayer);
    }

    function routeSourceLayer(sourceLayer, rootsRef, liveBaseLookup) {
        var info = parseSourceLayerName(sourceLayer.name);

        if (sourceLayer.visible) {
            moveSourceToLive(sourceLayer, rootsRef.live, info);
            return;
        }

        if (!sourceLayer.visible && liveBaseLookup[getLookupKey(info.familyName)]) {
            moveSourceToSnapshots(sourceLayer, rootsRef.snapshots, info, liveBaseLookup[getLookupKey(info.familyName)]);
            return;
        }

        moveSourceToTrash(sourceLayer, rootsRef.trash, info);
    }

    function moveSourceToLive(sourceLayer, liveRoot, info) {
        var liveLayerExisted = !!findChildLayerByName(liveRoot, info.liveName);
        var liveLayer = ensureChildLayer(liveRoot, info.liveName);
        var state = captureBranchState(sourceLayer);
        var sourceLockState = captureLayerLockState(sourceLayer, true);
        var sourceLayerLocked = safeRead(sourceLayer, "locked", false);

        logLine("Live <- " + sourceLayer.name + " => " + getLayerPath(liveLayer));

        unlockBranchFromState(state);
        moveLayerContents(sourceLayer, liveLayer);
        removeLayer(sourceLayer);
        restoreLayerLocksFromState(sourceLockState);

        if (!liveLayerExisted) {
            setLayerLocked(liveLayer, sourceLayerLocked);
        }
    }

    function moveSourceToSnapshots(sourceLayer, snapshotsRoot, info, liveName) {
        var snapshotContainer = ensureChildLayer(snapshotsRoot, liveName);
        var snapshotEntry = snapshotContainer.layers.add();
        var snapshotName = formatVersionName(getNextNumberedName(snapshotContainer, "s"), info.note);
        var state = captureBranchState(sourceLayer);

        snapshotContainer.visible = true;
        snapshotContainer.locked = false;
        snapshotEntry.name = snapshotName;
        snapshotEntry.visible = true;
        snapshotEntry.locked = false;

        logLine("Snapshot <- " + sourceLayer.name + " => " + getLayerPath(snapshotEntry));

        unlockBranchFromState(state);
        moveLayerContents(sourceLayer, snapshotEntry);
        removeLayer(sourceLayer);

        snapshotEntry.visible = false;
        snapshotEntry.locked = false;
        snapshotContainer.visible = false;
        snapshotContainer.locked = false;
    }

    function moveSourceToTrash(sourceLayer, trashRoot, info) {
        var trashContainer = ensureChildLayer(trashRoot, info.trashName);
        var trashEntry = trashContainer.layers.add();
        var trashName = getNextNumberedName(trashContainer, "T");
        var state = captureBranchState(sourceLayer);

        trashContainer.visible = true;
        trashContainer.locked = false;
        trashEntry.name = trashName;
        trashEntry.visible = true;
        trashEntry.locked = false;

        logLine("Trash <- " + sourceLayer.name + " => " + getLayerPath(trashEntry));

        unlockBranchFromState(state);
        moveLayerContents(sourceLayer, trashEntry);
        removeLayer(sourceLayer);
    }

    function collectSourceLayers(documentRef) {
        var result = [];
        var i;

        for (i = 0; i < documentRef.layers.length; i += 1) {
            if (!isSystemRoot(documentRef.layers[i])) {
                result.push(documentRef.layers[i]);
                logLine("Source[" + result.length + "]: " + documentRef.layers[i].name +
                    " visible=" + safeRead(documentRef.layers[i], "visible", true));
            }
        }

        return result;
    }

    function collectLiveBaseLookup(sourceLayers) {
        var lookup = {};
        var i;
        var info;

        for (i = 0; i < sourceLayers.length; i += 1) {
            info = parseSourceLayerName(sourceLayers[i].name);
            if (safeRead(sourceLayers[i], "visible", true) && !lookup[getLookupKey(info.familyName)]) {
                lookup[getLookupKey(info.familyName)] = info.liveName;
            }
        }

        return lookup;
    }

    function parseSourceLayerName(name) {
        var originalName = String(name || "");
        var canonicalName = getCanonicalName(originalName);
        var note = getTrailingParenNote(originalName);
        var familyName = getFamilyName(canonicalName);

        return {
            originalName: originalName,
            canonicalName: canonicalName,
            familyName: sanitizeName(trimText(familyName)),
            liveName: sanitizeName(trimText(originalName)),
            trashName: sanitizeName(trimText(originalName)),
            note: note
        };
    }

    function getCanonicalName(name) {
        return String(name).replace(/\s+\([^()]*\)\s*$/, "");
    }

    function getFamilyName(name) {
        var match = String(name).match(/^(.*?)\s+copy(?:\b.*)?$/i);
        return match ? match[1] : String(name);
    }

    function getTrailingParenNote(name) {
        var match = String(name).match(/\s+\(([^()]*)\)\s*$/);
        return match ? trimText(match[1]) : "";
    }

    function formatVersionName(versionName, note) {
        return note ? versionName + " (" + note + ")" : versionName;
    }

    function getLookupKey(name) {
        return String(name).toLowerCase();
    }

    function ensureRootLayers(documentRef) {
        return {
            live: ensureRootLayer(documentRef, ROOT_LIVE),
            snapshots: ensureRootLayer(documentRef, ROOT_SNAPSHOTS),
            trash: ensureRootLayer(documentRef, ROOT_TRASH),
            archive: ensureRootLayer(documentRef, ROOT_ARCHIVE)
        };
    }

    function prepareRoots(rootLayers) {
        rootLayers.live.visible = true;
        rootLayers.live.locked = false;
        rootLayers.snapshots.visible = true;
        rootLayers.snapshots.locked = false;
        rootLayers.trash.visible = true;
        rootLayers.trash.locked = false;
        rootLayers.archive.visible = true;
        rootLayers.archive.locked = false;
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

    function isSystemRoot(layer) {
        if (!layer || !layer.parent || layer.parent.typename !== "Document") {
            return false;
        }

        return layer.name === ROOT_LIVE || layer.name === ROOT_SNAPSHOTS ||
            layer.name === ROOT_TRASH || layer.name === ROOT_ARCHIVE;
    }

    function ensureChildLayer(parentLayer, layerName) {
        var child = findChildLayerByName(parentLayer, layerName);
        if (child) {
            child.visible = true;
            child.locked = false;
            return child;
        }

        child = parentLayer.layers.add();
        child.name = layerName;
        child.visible = true;
        child.locked = false;
        return child;
    }

    function findChildLayerByName(parentLayer, layerName) {
        var i;

        if (!parentLayer) {
            return null;
        }

        for (i = 0; i < parentLayer.layers.length; i += 1) {
            if (parentLayer.layers[i].name === layerName) {
                return parentLayer.layers[i];
            }
        }

        return null;
    }

    function orderRootLayers(layersInTopToBottomOrder) {
        var i;

        for (i = layersInTopToBottomOrder.length - 1; i >= 0; i -= 1) {
            layersInTopToBottomOrder[i].visible = true;
            layersInTopToBottomOrder[i].locked = false;
            layersInTopToBottomOrder[i].zOrder(ZOrderMethod.BRINGTOFRONT);
        }
    }

    function getNextNumberedName(parentLayer, prefix) {
        var maxValue = 0;
        var i;

        for (i = 0; i < parentLayer.layers.length; i += 1) {
            var value = getNumberedLayerValue(parentLayer.layers[i].name, prefix);
            if (value > maxValue) {
                maxValue = value;
            }
        }

        return prefix + (maxValue + 1);
    }

    function getNumberedLayerValue(name, prefix) {
        var match;

        if (!name) {
            return 0;
        }

        match = String(name).match(new RegExp("^" + prefix + "(\\d+)(?:\\s.*)?$", "i"));
        if (!match) {
            return 0;
        }

        return parseInt(match[1], 10) || 0;
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

    function captureLayerLockState(rootLayer, includeRoot) {
        var state = [];
        var i;

        if (!rootLayer) {
            return state;
        }

        if (includeRoot) {
            captureLayerLockStateRecursive(rootLayer, state, 0);
            return state;
        }

        for (i = 0; i < rootLayer.layers.length; i += 1) {
            captureLayerLockStateRecursive(rootLayer.layers[i], state, 1);
        }

        return state;
    }

    function captureLayerLockStateRecursive(layer, store, depth) {
        var i;

        store.push({
            ref: layer,
            locked: safeRead(layer, "locked", false),
            depth: depth
        });

        for (i = 0; i < layer.layers.length; i += 1) {
            captureLayerLockStateRecursive(layer.layers[i], store, depth + 1);
        }
    }

    function restoreLayerLocksFromState(state) {
        var ordered;
        var i;

        if (!state || !state.length) {
            return;
        }

        ordered = state.slice(0);
        ordered.sort(function (a, b) {
            return a.depth - b.depth;
        });

        for (i = 0; i < ordered.length; i += 1) {
            setLayerLocked(ordered[i].ref, false);
        }

        ordered.sort(function (a, b) {
            return b.depth - a.depth;
        });

        for (i = 0; i < ordered.length; i += 1) {
            setLayerLocked(ordered[i].ref, ordered[i].locked);
        }
    }

    function setLayerLocked(layer, locked) {
        try {
            if (layer) {
                layer.locked = !!locked;
            }
        } catch (ignore) {}
    }

    function captureLayerStatesRecursive(layer, store) {
        var i;

        store.push({
            ref: layer,
            locked: safeRead(layer, "locked", false),
            visible: safeRead(layer, "visible", true)
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
                locked: safeRead(rootLayer.pageItems[i], "locked", false),
                hidden: safeRead(rootLayer.pageItems[i], "hidden", false)
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

    function getDirectPageItems(layer) {
        var result = [];
        var i;

        for (i = 0; i < layer.pageItems.length; i += 1) {
            if (layer.pageItems[i].parent === layer) {
                result.push(layer.pageItems[i]);
            }
        }

        return result;
    }

    function moveLayerContents(sourceLayer, targetLayer) {
        var childLayers = [];
        var directItems;
        var i;

        for (i = 0; i < sourceLayer.layers.length; i += 1) {
            childLayers.push(sourceLayer.layers[i]);
        }

        for (i = 0; i < childLayers.length; i += 1) {
            childLayers[i].move(targetLayer, ElementPlacement.PLACEATEND);
        }

        directItems = getDirectPageItems(sourceLayer);
        for (i = 0; i < directItems.length; i += 1) {
            directItems[i].move(targetLayer, ElementPlacement.PLACEATEND);
        }
    }

    function removeLayer(layer) {
        try {
            if (layer && layer.parent) {
                layer.remove();
            }
        } catch (ignore) {}
    }

    function hideSnapshotDescendants(rootLayer) {
        var i;

        if (!rootLayer) {
            return;
        }

        for (i = 0; i < rootLayer.layers.length; i += 1) {
            hideSnapshotBranch(rootLayer.layers[i]);
        }
    }

    function hideSnapshotBranch(layer) {
        var i;

        if (!layer) {
            return;
        }

        for (i = 0; i < layer.layers.length; i += 1) {
            hideSnapshotBranch(layer.layers[i]);
        }

        try {
            layer.visible = false;
        } catch (ignore1) {}

        try {
            layer.locked = false;
        } catch (ignore2) {}
    }

    function restoreActiveLayer(documentRef, layerRef) {
        try {
            if (layerRef) {
                documentRef.activeLayer = layerRef;
            }
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

    function resetLog(documentRef) {
        var file = new File(LOG_PATH);

        if (file.exists) {
            try {
                file.remove();
            } catch (ignore) {}
        }

        logLine("Sort Layers Into Live/Snapshots/Trash version: " + SCRIPT_VERSION);
        logLine("Document: " + safeDocName(documentRef));
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

    function getLayerPath(layer) {
        var parts = [];
        var current = layer;

        while (current && current.typename === "Layer") {
            parts.unshift(current.name);
            current = current.parent;
        }

        return parts.join(" / ");
    }

    function safeRead(obj, propertyName, fallbackValue) {
        try {
            return obj[propertyName];
        } catch (ignore) {
            return fallbackValue;
        }
    }

    function sanitizeName(name) {
        return String(name).replace(/[\\\/:*?"<>|]/g, "_");
    }

    function trimText(text) {
        return String(text).replace(/^\s+|\s+$/g, "");
    }

    function countOwnKeys(obj) {
        var count = 0;
        var key;
        for (key in obj) {
            if (obj.hasOwnProperty(key)) {
                count += 1;
            }
        }
        return count;
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
