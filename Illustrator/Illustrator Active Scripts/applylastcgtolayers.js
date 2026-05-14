#target illustrator

function main() {
    var doc = app.activeDocument;
    var colorGroups = doc.swatchGroups;

    if (colorGroups.length === 0) {
        alert("Please ensure there's at least one color group in the Swatches panel.");
        return;
    }

    var lastColorGroup = colorGroups[colorGroups.length - 1];
    var colorSwatches = lastColorGroup.getAllSwatches();

    if (colorSwatches.length === 0) {
        alert("The last color group should have at least one swatch.");
        return;
    }

    var swatchIndex = 0;

    for (var i = 0; i < doc.layers.length; i++) {
        var layer = doc.layers[i];

        if (layer.locked || !layer.visible) {
            continue;
        }

        applySwatchToLayer(layer, colorSwatches[swatchIndex]);
        swatchIndex = (swatchIndex + 1) % colorSwatches.length;
    }
}

function applySwatchToLayer(layer, swatch) {
    for (var i = 0; i < layer.pageItems.length; i++) {
        applySwatchToItem(layer.pageItems[i], swatch);
    }
}

function applySwatchToItem(item, swatch) {
    if (item.typename === "PathItem" || item.typename === "CompoundPathItem") {
        item.fillColor = swatch.color;
    } else if (item.typename === "GroupItem") {
        for (var i = 0; i < item.pageItems.length; i++) {
            applySwatchToItem(item.pageItems[i], swatch);
        }
    }
}

main();
