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
    var totalObjects = sortedSelection.length;

    var targetColor = new RGBColor();
    targetColor.red = 255;
    targetColor.green = 0;
    targetColor.blue = 0;

     for (var i = 0; i < totalObjects; i++) {
        var t = i / (totalObjects - 1);
        var whiteColor = makeColorWhite();
        var result = new RGBColor();
        result.red = whiteColor.red + t * (targetColor.red - whiteColor.red);
        result.green = whiteColor.green + t * (targetColor.green - whiteColor.green);
        result.blue = whiteColor.blue + t * (targetColor.blue - whiteColor.blue);
        sortedSelection[i].fillColor = result;
    }
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
