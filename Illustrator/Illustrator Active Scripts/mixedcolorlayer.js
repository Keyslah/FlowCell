#target illustrator

function main() {
    var doc = app.activeDocument;
    var topLevelLayers = doc.layers;

    for (var l = topLevelLayers.length - 1; l >= 0; l--) {
        processLayer(topLevelLayers[l]);
    }
}

function processLayer(layer) {
    if (!layer.visible) return;

    if (layer.layers.length > 0) {
        for (var s = layer.layers.length - 1; s >= 0; s--) {
            processLayer(layer.layers[s]);
        }
    } else {
        applyScriptToLayer(layer);
    
}  }

function applyScriptToLayer(layer) {
    if (layer.locked) return;

    var selection = layer.pageItems;

    if (!selection || selection.length === 0) {
        return;
    }

    var sortedSelection = sortSelectionByYPosition(selection);
    var currentIdx = 0;
    // Rest of the provided script (Steps .3 to 4) goes here


    // Step .3
for (var i = 0; i < 1; i++) {
    var numObjectsStep3 = getRandomInt(10, 15);
    for (var j = 0; j < numObjectsStep3 && currentIdx < sortedSelection.length; j++) {
        currentIdx++;
    }
    if (currentIdx < sortedSelection.length) {
        sortedSelection[currentIdx].fillColor = makeColorWhite();
        currentIdx++; // skip one object
    } else {
        break;
    }
}

// Step .3
for (var i = 0; i < 3; i++) {
    var numObjectsStep3 = getRandomInt(3, 5);
    for (var j = 0; j < numObjectsStep3 && currentIdx < sortedSelection.length; j++) {
        currentIdx++;
    }
    if (currentIdx < sortedSelection.length) {
        sortedSelection[currentIdx].fillColor = makeColorWhite();
        currentIdx++; // skip one object
    } else {
        break;
    }
}
    
    // Step .3
for (var i = 0; i < 5; i++) {
    var numObjectsStep3 = getRandomInt(1, 3);
    for (var j = 0; j < numObjectsStep3 && currentIdx < sortedSelection.length; j++) {
        currentIdx++;
    }
    if (currentIdx < sortedSelection.length) {
        sortedSelection[currentIdx].fillColor = makeColorWhite();
        currentIdx++; // skip one object
    } else {
        break;
    }
}

    // Step 1
for (var i = 0; i < 20; i++) {
    if (currentIdx < sortedSelection.length) {
        sortedSelection[currentIdx].fillColor = makeColorWhite();
        currentIdx += 2;
    } else {
        break;
    }
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
    // ...
}

function sortSelectionByYPosition(selection) {
    var sortedSelection = Array.prototype.slice.call(selection);
    
    var filteredSelection = [];
    for (var i = 0; i < sortedSelection.length; i++) {
        if (!sortedSelection[i].locked) {
            filteredSelection.push(sortedSelection[i]);
        }
    }
    
    filteredSelection.sort(function (a, b) {
        return a.position[1] - b.position[1];
    });

    return filteredSelection;
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