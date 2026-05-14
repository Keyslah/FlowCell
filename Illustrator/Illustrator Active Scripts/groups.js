// Script to split a selection of objects spatially from top to bottom into N layers in Adobe Illustrator

function splitObjectsIntoLayers(n) {
    var doc = app.activeDocument; // Access the active document
    var selection = doc.selection; // Access the current selection

    if (selection.length === 0) {
        alert("No selection found. Please select some objects and try again.");
        return;
    }

    if (n <= 0) {
        alert("Invalid value for n. Please use a positive integer.");
        return;
    }

    // Sort the selected objects by their top position (reverse order)
    selection = selection.slice().sort(function (a, b) {
        return b.geometricBounds[1] - a.geometricBounds[1];
    });

    var layers = [];
    for (var i = 0; i < n; i++) {
        layers.push(doc.layers.add());
    }

    for (var j = 0; j < selection.length; j++) {
        var item = selection[j];
        var layerIndex = j % n;
        item.move(layers[layerIndex], ElementPlacement.PLACEATEND);
    }
}

function displayNValueDialog() {
    var dialog = new Window('dialog', 'Enter N Value');
    dialog.nValueGroup = dialog.add('group');
    dialog.nValueGroup.add('statictext', undefined, 'Split objects from top to bottom into N layers:');
    dialog.nValueGroup.nValueInput = dialog.nValueGroup.add('edittext', undefined, '3');
    dialog.nValueGroup.nValueInput.characters = 5;

    dialog.buttons = dialog.add('group');
    dialog.buttons.okButton = dialog.buttons.add('button', undefined, 'OK', { name: 'ok' });
    dialog.buttons.cancelButton = dialog.buttons.add('button', undefined, 'Cancel', { name: 'cancel' });

    dialog.buttons.okButton.onClick = function () {
        var n = parseInt(dialog.nValueGroup.nValueInput.text);
        if (isNaN(n) || n <= 0) {
            alert("Invalid value for n. Please use a positive integer.");
        } else {
            splitObjectsIntoLayers(n);
            dialog.close();
        }
    };

    dialog.buttons.cancelButton.onClick = function () {
        dialog.close();
    };

    dialog.show();
}

displayNValueDialog();

