#target illustrator

function main() {
    var doc = app.activeDocument;
    var selection = doc.selection;
    var numObjects = selection.length;

    if (numObjects === 0) {
        alert("No objects selected. Please select objects and run the script again.");
        return;
    }

    selection = sortObjects(selection);

    var bottomPercentage = 0.1;
    var topPercentage = 0.1;
    var bottomIndex = Math.floor(numObjects * bottomPercentage);
    var topIndex = Math.floor(numObjects * topPercentage);

    for (var i = 0; i < numObjects; i++) {
        var currentPercentage = i / numObjects;
        var currentN = calculateN(currentPercentage);

        if (i % currentN !== 0) {
            selection[i].fillColor = makeColor(255, 255, 255);
        }
    }
}

function sortObjects(selection) {
    return selection.sort(function (a, b) {
        return a.position[1] - b.position[1];
    });
}

function calculateN(percentage) {
    if (percentage <= 0.1) {
        return 2;
    } else if (percentage <= 0.2) {
        return 3;
    } else if (percentage <= 0.3) {
        return 5;
    } else if (percentage <= 0.4) {
        return 8;
    } else if (percentage <= 0.5) {
        return 12;
    } else if (percentage <= 0.6) {
        return 16;
    } else if (percentage <= 0.7) {
        return 22;
    } else if (percentage <= 0.8) {
        return 40;
    } else if (percentage <= 0.9) {
        return 70;
    } else {
        return 100;
    }
}

function makeColor(r, g, b) {
    var color = new RGBColor();
    color.red = r;
    color.green = g;
    color.blue = b;
    return color;
}

main();
