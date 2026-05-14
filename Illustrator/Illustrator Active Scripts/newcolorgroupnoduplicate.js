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
    var uniqueCount = 0;

    for (var i = 0; i < selection.length; i++) {
        var item = selection[i];
        if (item.typename === "PathItem") {
            var newColor = item.fillColor;
            var colorKey = colorToString(newColor);

            if (!uniqueColors[colorKey]) {
                uniqueColors[colorKey] = true;
                uniqueCount++;
                var newSwatch = doc.swatches.add();
                newSwatch.name = "Color_" + uniqueCount;
                newSwatch.color = newColor;
                newSwatchGroup.addSwatch(newSwatch);
            }
        }
    }
}

function colorToString(color) {
    if (color.typename === "RGBColor") {
        return "RGB_" + color.red + "_" + color.green + "_" + color.blue;
    } else if (color.typename === "CMYKColor") {
        return "CMYK_" + color.cyan + "_" + color.magenta + "_" + color.yellow + "_" + color.black;
    } else {
        return color.toString();
    }
}

createSwatchFromSelectedFills();
