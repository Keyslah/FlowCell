#target illustrator

function main() {
    var doc = app.activeDocument;
    var selectedItems = doc.selection;
    var colorGroups = doc.swatchGroups;

    if (selectedItems.length === 0 || colorGroups.length === 0) {
        alert("Please select some objects and ensure there's at least one color group in the Swatches panel.");
        return;
    }

    var lastColorGroup = colorGroups[colorGroups.length - 1];
    var colorSwatches = lastColorGroup.getAllSwatches();

    if (colorSwatches.length < 5) {
        alert("The last color group should have at least 5 swatches.");
        return;
    }

    selectedItems.sort(function (a, b) {
        return a.position[1] - b.position[1];
    });

    var sectionSize = Math.ceil(selectedItems.length / 5);

    for (var i = 0; i < selectedItems.length; i++) {
        var sectionIndex = Math.floor(i / sectionSize);
        var swatch = colorSwatches[sectionIndex];
        applySwatchToItem(selectedItems[i], swatch);
    }
}

function applySwatchToItem(item, swatch) {
    if (item.typename === "PathItem" || item.typename === "CompoundPathItem") {
        item.fillColor = swatch.color;
    } else if (item.typename === "GroupItem") {
        for (var i = 0; i < item.pageItems.length; i++) {
            applySwatchToItem(item.pageItems[i], swatch);
        }
    }
}

main();
