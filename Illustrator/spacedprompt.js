#target illustrator

function main() {
    var doc = app.activeDocument;
    var sel = doc.selection;
    var totalObjects = sel.length;

    if (totalObjects == 0) {
        alert("No objects selected.");
        return;
    }

    var dialog = new Window('dialog', 'Select Percentage');
    var dropdown = dialog.add('dropdownlist');
    for (var i = 1; i <= 100; i += 3) {
        dropdown.add('item', "" + i);
    }
    dropdown.selection = 0;
    dialog.add('button', undefined, 'OK', {name: 'ok'});
    dialog.add('button', undefined, 'Cancel', {name: 'cancel'});

    var result = dialog.show();

    if (result == 2) { // Cancel button clicked
        return;
    }

    var nPercent = parseInt(dropdown.selection.text) / 100;

    var numToFill = Math.round(totalObjects * nPercent);
    var numFilled = 0;

    if (doc.swatchGroups.length == 0) {
        alert("No color groups found.");
        return;
    }

    var lastColorGroup = doc.swatchGroups[doc.swatchGroups.length - 1];
    if (lastColorGroup.getAllSwatches().length == 0) {
        alert("No swatches in the last color group.");
        return;
    }

    var swatchToUse = lastColorGroup.getAllSwatches()[0];

    var step = Math.floor(totalObjects / numToFill);
    for (var i = 0; i < totalObjects; i += step) {
        if (numFilled >= numToFill) break;
        sel[i].fillColor = swatchToUse.color;
        numFilled++;
    }

    if (numFilled < numToFill) {
        for (var i = 0; i < totalObjects && numFilled < numToFill; i++) {
            if (sel[i].fillColor != swatchToUse.color) {
                sel[i].fillColor = swatchToUse.color;
                numFilled++;
            }
        }
    }

    alert(numFilled + " objects filled.");
}

main();
