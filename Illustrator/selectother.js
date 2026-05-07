// Script to select every nth object in the current selection in Adobe Illustrator (left to right)

function selectNthObjectsLeftToRight(n) {
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

    // Sort the selected objects by their left position
    selection = selection.slice().sort(function (a, b) {
        return a.geometricBounds[0] - b.geometricBounds[0];
    });

    // Deselect all objects
    doc.selection = null;

    // Select every nth object
    for (var i = 0; i < selection.length; i++) {
        if ((i + 1) % n === 0) { // Check if it's an nth object
            selection[i].selected = true;
        }
    }
}

function displayNValueDialog() {
    var dialog = new Window('dialog', 'Enter N Value');
    dialog.nValueGroup = dialog.add('group');
    dialog.nValueGroup.add('statictext', undefined, 'Select every nth object (left to right):');
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
            selectNthObjectsLeftToRight(n);
            dialog.close();
        }
    };

    dialog.buttons.cancelButton.onClick = function () {
        dialog.close();
    };

    dialog.show();
}

displayNValueDialog();
