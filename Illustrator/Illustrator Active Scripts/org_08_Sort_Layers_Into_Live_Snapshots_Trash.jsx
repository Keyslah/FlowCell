// Description: Runs 08 Sort Layers Into Live Snapshots Trash.
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
    var SCRIPT_VERSION = "2026-03-23 15:45";
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

    try {
        resetLog(doc);
        roots = ensureRootLayers(doc);
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
        var liveLayer = ensureChildLayer(liveRoot, info.liveName);
        var state = captureBranchState(sourceLayer);

        logLine("Live <- " + sourceLayer.name + " => " + getLayerPath(liveLayer));

        unlockBranchFromState(state);
        moveLayerContents(sourceLayer, liveLayer);
        removeLayer(sourceLayer);
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
