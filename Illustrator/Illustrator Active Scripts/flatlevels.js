#target illustrator

function main() {
    var doc = app.activeDocument;
    var selection = doc.selection;

    if (!selection || selection.length === 0) {
        alert('Please select some objects before running this script.');
        return;
    }

    var sortedSelection = sortSelectionByYPosition(selection);
    var currentIdx = 0;

    // Step 1
    for (var i = 0; i < 20; i++) {
        sortedSelection[currentIdx].fillColor = makeColorWhite();
        currentIdx += 2;
    }

    // Step 2
    for (var i = 0; i < 10; i++) {
        var numberOfObjects = getRandomInt(1, 2);
        for (var j = 0; j < numberOfObjects && currentIdx < sortedSelection.length; j++) {
            sortedSelection[currentIdx].fillColor = makeColorWhite();
            currentIdx++;
        }
        currentIdx++; // skip one object
    }

    // Step 3
    for (var i = 0; i < 5; i++) {
        var numObjectsStep3 = getRandomInt(3, 5);
        for (var j = 0; j < numObjectsStep3 && currentIdx < sortedSelection.length; j++) {
            sortedSelection[currentIdx].fillColor = makeColorWhite();
            currentIdx++;
        }
        currentIdx++; // skip one object
    }

	// Step 3.5
    for (var i = 0; i < 5; i++) {
        var numObjectsStep3 = getRandomInt(4, 7);
        for (var j = 0; j < numObjectsStep3 && currentIdx < sortedSelection.length; j++) {
            sortedSelection[currentIdx].fillColor = makeColorWhite();
            currentIdx++;
        }
        currentIdx++; // skip one object
    }

	// Step 3.75
    for (var i = 0; i < 5; i++) {
        var numObjectsStep3 = getRandomInt(10, 15);
        for (var j = 0; j < numObjectsStep3 && currentIdx < sortedSelection.length; j++) {
            sortedSelection[currentIdx].fillColor = makeColorWhite();
            currentIdx++;
        }
        currentIdx++; // skip one object
    }

    // Step 4
    while (currentIdx < sortedSelection.length) {
        var numObjectsStep4 = getRandomInt(20, 30);
        for (var i = 0; i < numObjectsStep4 && currentIdx < sortedSelection.length; i++) {
            sortedSelection[currentIdx].fillColor = makeColorWhite();
            currentIdx++;
        }
        currentIdx++; // skip one object
    }
}

function sortSelectionByYPosition(selection) {
    var sortedSelection = Array.prototype.slice.call(selection);
    sortedSelection.sort(function (a, b) {
        return a.position[1] - b.position[1];
    });
    return sortedSelection;
}

function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeColorWhite() {
    var whiteColor = new RGBColor();
    whiteColor.red = 255;
    whiteColor.green = 255;
    whiteColor.blue = 255;
    return whiteColor;
}

main();

