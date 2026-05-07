// Filename: DivideObjectsIntoLayers_v3.jsx
// Description: Adobe Illustrator script to make 4 copies of a layer and divide selected objects into five sections from top to bottom, leaving just one section in each layer, while preserving sub-layers.

function divideObjectsIntoLayers() {
    if (app.documents.length === 0) {
        alert("No document is open. Please open a document and try again.");
        return;
    }

    var doc = app.activeDocument;
    var sel = doc.selection;

    if (sel.length === 0) {
        alert("No objects are selected. Please select the objects you want to divide and try again.");
        return;
    }

    var originalLayer = doc.activeLayer;
    var layers = [];
    layers.push(originalLayer);

    for (var i = 0; i < 5; i++) {
        var newLayer = doc.layers.add();
        newLayer.name = "Copy " + (i + 1);
        copySubLayers(originalLayer, newLayer);
        layers.push(newLayer);
    }

    var objectsBounds = [];
    for (var i = 0; i < sel.length; i++) {
        objectsBounds.push(sel[i].geometricBounds);
    }

    var minY = objectsBounds[0][1];
    var maxY = objectsBounds[0][3];

    for (var i = 1; i < objectsBounds.length; i++) {
        minY = Math.min(minY, objectsBounds[i][1]);
        maxY = Math.max(maxY, objectsBounds[i][3]);
    }

    var sectionHeight = (maxY - minY) / 5;

        for (var layerIndex = 1; layerIndex < layers.length; layerIndex++) {
        var currentLayer = layers[layerIndex];
        var numSubLayers = currentLayer.layers.length;

        for (var subLayerIndex = 0; subLayerIndex < numSubLayers; subLayerIndex++) {
            var currentSubLayer = currentLayer.layers[subLayerIndex];
            var numSubLayerItems = currentSubLayer.pageItems.length;

            for (var itemIndex = numSubLayerItems - 1; itemIndex >= 0; itemIndex--) {
                var currentItem = currentSubLayer.pageItems[itemIndex];
                var currentItemBounds = currentItem.geometricBounds;
                var currentItemY = (currentItemBounds[1] + currentItemBounds[3]) / 2;
                var section = Math.floor((currentItemY - minY) / sectionHeight);

                if (section !== layerIndex - 1) {
                    currentItem.remove();
                }
            }
        }
    }

    for (var i = 1; i < layers.length; i++) {
        layers[i].visible = false;
    }
}

function copySubLayers(sourceLayer, destinationLayer) {
    for (var i = 0; i < sourceLayer.layers.length; i++) {
        var sourceSubLayer = sourceLayer.layers[i];
        var newSubLayer = destinationLayer.layers.add();
        newSubLayer.name = sourceSubLayer.name;

        for (var j = 0; j < sourceSubLayer.pageItems.length; j++) {
            sourceSubLayer.pageItems[j].duplicate(newSubLayer, ElementPlacement.PLACEATEND);
        }

        if (sourceSubLayer.layers.length > 0) {
            copySubLayers(sourceSubLayer, newSubLayer);
        }
    }
}

divideObjectsIntoLayers();
