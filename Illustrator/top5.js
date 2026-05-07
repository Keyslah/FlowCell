function applyColorSwatch() {
    var doc = app.activeDocument;
    var colorGroups = doc.swatchGroups;

    if (colorGroups.length === 0) {
        alert("No color groups found. Please create a color group with swatches.");
        return;
    }

    var lastColorGroup = colorGroups[colorGroups.length - 1];
    var swatches = lastColorGroup.getAllSwatches();

    if (swatches.length === 0) {
        alert("No swatches found in the last color group. Please add swatches to the color group.");
        return;
    }

    var layers = doc.layers;

    for (var l = 0; l < layers.length; l++) {
        var layer = layers[l];

        if (layer.locked || !layer.visible) {
            continue;
        }

        var swatchIndex = l % swatches.length;
        var currentSwatch = swatches[swatchIndex];

        var objectsInLayer = [];
        collectObjects(layer, objectsInLayer);

        if (objectsInLayer.length === 0) {
            continue;
        }

        objectsInLayer.sort(function(a, b) {
            return a.position[1] - b.position[1];
        });

        var totalObjects = objectsInLayer.length;

        for (var i = 0; i < totalObjects; i++) {
            var obj = objectsInLayer[i];
            var percentage = (i / totalObjects) * 100;

            if (percentage >= 30 && percentage < 40 && (i % 30) === 0) {
                obj.fillColor = currentSwatch.color;
            } else if (percentage >= 40 && percentage < 50 && (i % 20) === 0) {
                obj.fillColor = currentSwatch.color;
            } else if (percentage >= 50 && percentage < 60 && (i % 10) === 0) {
                obj.fillColor = currentSwatch.color;
            } else if (percentage >= 60 && percentage < 70 && (i % 7) === 0) {
                obj.fillColor = currentSwatch.color;
            } else if (percentage >= 70 && percentage < 90 && (i % 3) === 0) {
                obj.fillColor = currentSwatch.color;
            } else if (percentage >= 90 && percentage <= 100 && (i % 2) === 0) {
                obj.fillColor = currentSwatch.color;
            }
        }
    }
}

function collectObjects(layer, objects) {
    for (var i = 0; i < layer.pageItems.length; i++) {
        objects.push(layer.pageItems[i]);
    }

    for (var j = 0; j < layer.layers.length; j++) {
        collectObjects(layer.layers[j], objects);
    }
}

applyColorSwatch();
