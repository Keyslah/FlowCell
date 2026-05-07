// Script to separate the selection into N groups in Adobe Illustrator

function separateSelectionIntoGroups(n) {
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

    var groups = [];
    for (var i = 0; i < n; i++) {
        groups.push(doc.groupItems.add());
    }

    for (var j = 0; j < selection.length; j++) {
        var item = selection[j];
        var groupIndex = j % n;
        item.move(groups[groupIndex], ElementPlacement.PLACEATEND);
    }
}

function displayNValueDialog() {
    var dialog = new Window('dialog', 'Enter N Value');
    dialog.nValueGroup = dialog.add('group');
    dialog.nValueGroup.add('statictext', undefined, 'Separate selection into N groups:');
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
            separateSelectionIntoGroups(n);
            dialog.close();
        }
    };

    dialog.buttons.cancelButton.onClick = function () {
        dialog.close();
    };

    dialog.show();
}

displayNValueDialog();
