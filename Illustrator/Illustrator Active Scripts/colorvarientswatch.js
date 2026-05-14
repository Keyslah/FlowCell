// Adobe Illustrator script to modify the first color group swatch by moving every other color a random number of spots (3 to 6) without moving a color twice and in either direction, preventing moving past the last swatch, and skipping the first 55 swatches

function modifyFirstSwatchGroup() {
    var doc = app.activeDocument;
    var swatchGroup = getFirstSwatchGroup();

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

modifyFirstSwatchGroup();

