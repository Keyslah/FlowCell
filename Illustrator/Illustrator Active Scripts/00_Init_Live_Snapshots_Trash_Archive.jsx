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
