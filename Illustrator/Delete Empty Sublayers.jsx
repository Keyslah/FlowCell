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
