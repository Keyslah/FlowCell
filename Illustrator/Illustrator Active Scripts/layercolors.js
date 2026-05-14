// Script to separate objects into different layers based on their fill color in Adobe Illustrator

function colorToString(color) {
    if (color.typename === "RGBColor") {
        return color.red.toFixed(0) + "_" + color.green.toFixed(0) + "_" + color.blue.toFixed(0);
    } else if (color.typename === "CMYKColor") {
        return color.cyan.toFixed(0) + "_" + color.magenta.toFixed(0) + "_" + color.yellow.toFixed(0) + "_" + color.black.toFixed(0);
    } else if (color.typename === "SpotColor") {
        return color.spot.name;
    } else if (color.typename === "GradientColor") {
        return "Gradient_" + color.gradient.name;
    } else {
        return "UnknownColorType";
    }
}

function separateObjectsByFillColor() {
    var doc = app.activeDocument; // Access the active document
    var selection = doc.selection; // Access the current selection

    if (selection.length === 0) {
        alert("No selection found. Please select some objects and try again.");
        return;
    }

    var colorLayers = {};

    for (var i = 0; i < selection.length; i++) {
        var item = selection[i];
        if (item.typename === "PathItem" && item.filled) {
            var colorKey = colorToString(item.fillColor);

            if (!colorLayers.hasOwnProperty(colorKey)) {
                var newLayer = doc.layers.add();
                newLayer.name = "Color_" + colorKey;
                colorLayers[colorKey] = newLayer;
            }

            item.move(colorLayers[colorKey], ElementPlacement.PLACEATEND);
        }
    }
}

separateObjectsByFillColor();
