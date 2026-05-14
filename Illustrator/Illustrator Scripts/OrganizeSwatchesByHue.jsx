// OrganizeSwatchesByHue.jsx
#target illustrator

//@include "tinycolor.js"

function organizeSwatches() {
    var doc = app.activeDocument;
    var selection = doc.selection;

    if (selection.length === 0) {
        alert("No objects selected. Exiting script.");
        return;
    }

    // Get colors from selected objects
    var selectedColors = [];
    for (var i = 0; i < selection.length; i++) {
        var fillColor = selection[i].fillColor;
        if (fillColor.typename == "RGBColor" || fillColor.typename == "CMYKColor") {
            selectedColors.push(fillColor);
        }
    }

    // Convert colors to HSL and sort by hue
    var hslColors = selectedColors.map(function (color) {
        var tinycolor = new tinycolor(color);
        return tinycolor.toHsl();
    });

    hslColors.sort(function (a, b) {
        return a.h - b.h;
    });

    // Create a new color group with swatches sorted by hue
    var organizedColorGroup = doc.swatchGroups.add();
    organizedColorGroup.name = "Organized Swatches - Hue";

    for (var i = 0; i < hslColors.length; i++) {
        var hslColor = hslColors[i];
        var newSwatch = doc.swatches.add();
        newSwatch.color = new tinycolor(hslColor).toRgb();
        newSwatch.name = "Color " + (i + 1);
        organizedColorGroup.addSwatch(newSwatch);
    }
}

organizeSwatches();
