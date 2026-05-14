function createSwatchFromSelectedFills() {
    var doc = app.activeDocument; // Access the active document
    var selection = doc.selection; // Access the current selection

    if (selection.length === 0) {
        alert("No objects found. Please select some objects and try again.");
        return;
    }

    // Sort the selected objects by their top position (reverse order)
    selection = selection.slice().sort(function (a, b) {
        return b.geometricBounds[1] - a.geometricBounds[1];
    });

    var newSwatchGroup = doc.swatchGroups.add();
    newSwatchGroup.name = "GeneratedSwatchGroup";

    var uniqueColors = {};

    for (var i = 0; i < selection.length; i++) {
        var item = selection[i];
        if (item.typename === "PathItem") {
            var newColor = item.fillColor;
            var colorKey = newColor.red + "_" + newColor.green + "_" + newColor.blue;

            if (!uniqueColors[colorKey]) {
                uniqueColors[colorKey] = true;
                var newSwatch = doc.swatches.add();
                newSwatch.name = "Color_" + (Object.keys(uniqueColors).length);
                newSwatch.color = newColor;
                newSwatchGroup.addSwatch(newSwatch);
            }
        }
    }
}

createSwatchFromSelectedFills();
