#target illustrator

function processSublayers(layer) {
    if (layer.locked) {
        return;
    }

    var swatchGroups = getFirstFiveSwatchGroups();

    for (var i = layer.layers.length - 1; i >= 0; i--) {
        var sublayer = layer.layers[i];
        if (!sublayer.locked) {
            var swatchGroup = swatchGroups[i % swatchGroups.length];
            sublayer.hasSelectedArtwork = true;
            applySwatchColorsToSelection(swatchGroup);
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

function getFirstFiveSwatchGroups() {
    var doc = app.activeDocument;
    var swatchGroups = doc.swatchGroups;
    var firstFiveSwatchGroups = [];

    if (swatchGroups.length > 1) {
        for (var i = 1; i < swatchGroups.length && firstFiveSwatchGroups.length < 30; i++) {
            firstFiveSwatchGroups.push(swatchGroups[i]);
        }
    }

    return firstFiveSwatchGroups;
}

var doc = app.activeDocument;
for (var i = 0; i < doc.layers.length; i++) {
    processSublayers(doc.layers[i]);
}
