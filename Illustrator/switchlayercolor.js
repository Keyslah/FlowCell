#target illustrator

function applyFirstSwatchGroupColorsToLayers() {
    var doc = app.activeDocument;
    var layers = doc.layers;
    var colors = getFirstSwatchGroupColors();

    if (colors.length === 0) {
        alert("Please make sure there is at least one color group swatch in the document.");
        return;
    }

    var colorIndex = 0;

    for (var i = 0; i < layers.length && colorIndex < colors.length; i++) {
        if (!layers[i].locked) {
            applyColorToLayer(layers[i], colors[colorIndex]);
            colorIndex++;
        }
    }
}

function getFirstSwatchGroupColors() {
    var doc = app.activeDocument;
    var swatchGroups = doc.swatchGroups;
    var colors = [];

    if (swatchGroups.length > 1) {
        var swatches = swatchGroups[1].getAllSwatches();
        for (var i = 0; i < swatches.length; i++) {
            colors.push(swatches[i].color);
        }
    }

    return colors;
}

function applyColorToLayer(layer, color) {
    for (var i = 0; i < layer.pageItems.length; i++) {
        var item = layer.pageItems[i];

        if (item.typename === "PathItem" || item.typename === "CompoundPathItem") {
            item.fillColor = color;
        }
    }
}

applyFirstSwatchGroupColorsToLayers();
