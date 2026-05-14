#target illustrator

function copyFirstSwatchGroup(times) {
    var doc = app.activeDocument;
    var swatchGroup = getFirstSwatchGroup();

    if (!swatchGroup || swatchGroup.typename !== "SwatchGroup") {
        alert("Unable to find the first color group swatch.");
        return;
    }

    var copiedSwatchGroups = [];

    for (var i = 0; i < times; i++) {
        var newSwatchGroup = doc.swatchGroups.add();
        var swatchColors = swatchGroup.getAllSwatches();

        for (var j = 0; j < swatchColors.length; j++) {
            var newSwatch = doc.swatches.add();
            newSwatch.color = swatchColors[j].color;
            newSwatchGroup.addSwatch(newSwatch);
        }

        copiedSwatchGroups.push(newSwatchGroup);
    }

    return copiedSwatchGroups;
}

function processCopiedSwatchGroups() {
    var copiedSwatchGroups = copyFirstSwatchGroup(30);

    for (var i = 0; i < copiedSwatchGroups.length; i++) {
        modifySwatchGroup(copiedSwatchGroups[i]);
    }
}

function modifySwatchGroup(swatchGroup) {
    if (!swatchGroup || swatchGroup.typename !== "SwatchGroup") {
        alert("Unable to find the first color group swatch.");
        return;
    }

    var swatchColors = swatchGroup.getAllSwatches();
    var modifiedSwatchColors = swatchColors.slice();
    var movedColors = {};

    for (var i = 56; i < swatchColors.length; i++) {
        if (i % 2 === 0 || movedColors[i]) {
            continue;
        } else {
            var randomSpots = getRandomInt(3, 6);
            var direction = getRandomInt(0, 1) === 0 ? -1 : 1;
            var newIndex = (i + direction * randomSpots + swatchColors.length) % swatchColors.length;

            while (newIndex <= 55 || movedColors[newIndex]) {
                newIndex = (newIndex + direction + swatchColors.length) % swatchColors.length;
            }

            var tempColor = modifiedSwatchColors[newIndex];
            modifiedSwatchColors[newIndex] = swatchColors[i];
            modifiedSwatchColors[i] = tempColor;
            movedColors[newIndex] = true;
            movedColors[i] = true;
        }
    }

    applyModifiedColorsToSwatchGroup(swatchGroup, modifiedSwatchColors);
}

function getFirstSwatchGroup() {
    var doc = app.activeDocument;
    var swatchGroups = doc.swatchGroups;

    if (swatchGroups.length > 1) {
        return swatchGroups[1];
    }
    return null;
}

function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function applyModifiedColorsToSwatchGroup(swatchGroup, modifiedColors) {
    var originalSwatches = swatchGroup.getAllSwatches();

    for (var i = 56; i < originalSwatches.length; i++) {
        originalSwatches[i].color = modifiedColors[i].color;
    }
}

processCopiedSwatchGroups();


