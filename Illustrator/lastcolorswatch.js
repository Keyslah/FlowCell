// Script to fill a selection of objects from top to bottom with the colors of the first swatch group in Adobe Illustrator

function applySwatchColorsToSelection(swatchGroup) {
    var doc = app.activeDocument; // Access the active document
    var selection = doc.selection; // Access the current selection

    if (selection.length === 0) {
        alert("No objects found. Please select some objects and try again.");
        return;
    }

    if (!swatchGroup || swatchGroup.typename !== "SwatchGroup") {
        alert("Unable to find the first color group swatch.");
        return;
    }

    // Sort the selected objects by their top position (reverse order)
    selection = selection.slice().sort(function (a, b) {
        return b.geometricBounds[1] - a.geometricBounds[1];
    });

    var swatchColors = swatchGroup.getAllSwatches();

    for (var i = 0; i < selection.length; i++) {
        var item = selection[i];
        if (item.typename === "PathItem") {
            var colorIndex = i % swatchColors.length;
            item.fillColor = swatchColors[colorIndex].color;
        }
    }
}

function getLastSwatchGroup() {
    var doc = app.activeDocument; // Access the active document
    var swatchGroups = doc.swatchGroups;

    if (swatchGroups.length > 1) {
        return swatchGroups[swatchGroups.length - 1];
    }

    return null;
}

var lastSwatchGroup = getLastSwatchGroup();
applySwatchColorsToSelection(lastSwatchGroup);
