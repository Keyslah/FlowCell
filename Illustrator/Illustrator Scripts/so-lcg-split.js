#target illustrator

function sortSelectedObjects() {
    var doc = app.activeDocument;
    var selectedItems = doc.selection;

    if (selectedItems.length == 0) {
        alert('Please select objects to sort.');
        return;
    }

    var objectsBounds = [];
    for (var i = 0; i < selectedItems.length; i++) {
        objectsBounds.push({
            item: selectedItems[i],
            y: selectedItems[i].geometricBounds[1]
        });
    }

    objectsBounds.sort(function (a, b) {
        return a.y - b.y;
    });

    var swatchGroups = doc.swatchGroups;
    if (swatchGroups.length < 2) {
        alert('No color group found. Please make sure there is a color group in the Swatches panel.');
        return;
    }

    var lastColorGroup = swatchGroups[swatchGroups.length - 1];
    var numOfSections = lastColorGroup.getAllSwatches().length;
    var sectionHeight = Math.abs(objectsBounds[0].y - objectsBounds[selectedItems.length - 1].y) / numOfSections;

    for (var i = 0; i < objectsBounds.length; i++) {
        var item = objectsBounds[i].item;
        var sectionIndex = Math.floor((objectsBounds.length - 1 - i) / (objectsBounds.length / numOfSections));

        if (sectionIndex < numOfSections) {
            item.fillColor = lastColorGroup.getAllSwatches()[sectionIndex].color;
        } else {
            item.fillColor = lastColorGroup.getAllSwatches()[numOfSections - 1].color;
        }
    }
}

sortSelectedObjects();
