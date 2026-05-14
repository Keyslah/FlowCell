function applyColorSwatch() {
    var doc = app.activeDocument;
    var selection = doc.selection;
    var colorGroups = doc.swatchGroups;

    if (colorGroups.length === 0) {
        alert("No color groups found. Please create a color group with swatches.");
        return;
    }

    var lastColorGroup = colorGroups[colorGroups.length - 1];
    var swatches = lastColorGroup.getAllSwatches();

    if (swatches.length === 0) {
        alert("No swatches found in the last color group. Please add swatches to the color group.");
        return;
    }

    var firstSwatch = swatches[0];

    if (selection.length === 0) {
        alert("No objects selected. Please select the objects you want to index and color.");
        return;
    }

    selection.sort(function(a, b) {
        return a.position[1] - b.position[1];
    });

    var totalObjects = selection.length;

    for (var i = 0; i < totalObjects; i++) {
        var obj = selection[i];
        var percentage = (i / totalObjects) * 100;

        if (percentage >= 20 && percentage < 30 && (i % 90) === 0) {
            obj.fillColor = firstSwatch.color;
        } else if (percentage >= 30 && percentage < 40 && (i % 30) === 0) {
            obj.fillColor = firstSwatch.color;
        } else if (percentage >= 40 && percentage < 50 && (i % 20) === 0) {
            obj.fillColor = firstSwatch.color;
        } else if (percentage >= 50 && percentage < 60 && (i % 10) === 0) {
            obj.fillColor = firstSwatch.color;
        } else if (percentage >= 60 && percentage < 70 && (i % 8) === 0) {
            obj.fillColor = firstSwatch.color;
        } else if (percentage >= 70 && percentage < 85 && (i % 5) === 0) {
            obj.fillColor = firstSwatch.color;
        } else if (percentage >= 85 && percentage < 95 && (i % 3) === 0) {
            obj.fillColor = firstSwatch.color;
        } else if (percentage >= 95 && percentage <= 100 && (i % 2) === 0) {
            obj.fillColor = firstSwatch.color;
        }
    }
}

applyColorSwatch();
