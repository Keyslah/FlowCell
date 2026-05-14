#target illustrator

function processSublayers(layer) {
    if (layer.locked) {
        return;
    }

    for (var i = layer.layers.length - 1; i >= 0; i--) {
        var sublayer = layer.layers[i];
        if (!sublayer.locked) {
            sublayer.hasSelectedArtwork = true;
            applySwatchColorsToSelection(getFirstSwatchGroup());
            sublayer.hasSelectedArtwork = false;
        }
    }
}

function applySwatchColorsToSelection(swatchGroup) {
    var doc = app.activeDocument;
    var selection = doc.selection;

    if (selection.length === 0) {
        return;
    }

    if (!swatchGroup || swatchGroup.typename !== "SwatchGroup") {
        return;
    }

    selection = selection.slice().sort(function (a, b) {
        return a.geometricBounds[1] - b.geometricBounds[1];
    });

    var swatchColors = swatchGroup.getAllSwatches();
    var whiteColor = new RGBColor();
    whiteColor.red = 255;
    whiteColor.green = 255;
    whiteColor.blue = 255;

    for (var i = 0; i < selection.length; i++) {
        var item = selection[i];
        if (item.typename === "PathItem") {
            if (i < swatchColors.length) {
                var colorIndex = i % swatchColors.length;
                item.fillColor = swatchColors[colorIndex].color;
            } else {
                item.fillColor = whiteColor;
            }
        }
    }
}

function getFirstSwatchGroup() {
    var doc = app.activeDocument;
    var swatchGroups = doc.swatchGroups;

    if (swatchGroups.length > 1) {
        return swatchGroups[1];
    }

    return null;
}

var doc = app.activeDocument;
for (var i = 0; i < doc.layers.length; i++) {
    processSublayers(doc.layers[i]);
}
