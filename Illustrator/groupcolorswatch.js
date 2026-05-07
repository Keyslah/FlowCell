#target illustrator

function main() {
    var doc = app.activeDocument;
    var selection = doc.selection;
    var swatchGroup = getFirstSwatchGroup();

    if (!selection || selection.length === 0) {
        alert('Please select some objects before running this script.');
        return;
    }

    if (!swatchGroup || swatchGroup.typename !== "SwatchGroup") {
        alert("Unable to find the first color group swatch.");
        return;
    }

    var sortedSelection = sortSelectionByYPosition(selection);
    var swatches = swatchGroup.getAllSwatches();
    var objectsPerSwatch = Math.ceil(sortedSelection.length / swatches.length);

    for (var i = 0; i < sortedSelection.length; i++) {
        var swatchIndex = Math.floor(i / objectsPerSwatch);
        if (swatchIndex >= swatches.length) {
            swatchIndex = swatches.length - 1;
        }
        applySwatchToPathItem(sortedSelection[i], swatches[swatchIndex]);
    }
}

function sortSelectionByYPosition(selection) {
    var sortedSelection = Array.prototype.slice.call(selection);
    sortedSelection.sort(function (a, b) {
        return a.position[1] - b.position[1];
    });
    return sortedSelection;
}

function getFirstSwatchGroup() {
    var doc = app.activeDocument;
    var swatchGroups = doc.swatchGroups;

    if (swatchGroups.length > 1) {
        return swatchGroups[1];
    }
    return null;
