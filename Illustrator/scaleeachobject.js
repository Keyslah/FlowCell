#target illustrator

function scaleSelectedItems() {
    // Check if there is a valid selection
    if (!app.activeDocument.selection.length) {
        alert('No objects selected. Please select one or more objects.');
        return;
    }

    // Create dialog
    var dialog = new Window('dialog', 'Scale Objects');
    
    dialog.minGroup = dialog.add('group');
    dialog.minGroup.add('statictext', undefined, 'Minimum scale percentage:');
    dialog.minScaleInput = dialog.minGroup.add('edittext', undefined, '50');
    dialog.minScaleInput.characters = 5;
    
    dialog.maxGroup = dialog.add('group');
    dialog.maxGroup.add('statictext', undefined, 'Maximum scale percentage:');
    dialog.maxScaleInput = dialog.maxGroup.add('edittext', undefined, '150');
    dialog.maxScaleInput.characters = 5;
    
    dialog.buttonsGroup = dialog.add('group');
    dialog.okButton = dialog.buttonsGroup.add('button', undefined, 'OK');
    dialog.cancelButton = dialog.buttonsGroup.add('button', undefined, 'Cancel');

    // If OK button is clicked
    dialog.okButton.onClick = function() {
        var minScalePercent = Number(dialog.minScaleInput.text);
        var maxScalePercent = Number(dialog.maxScaleInput.text);
        
        // Check for invalid input
        if (isNaN(minScalePercent) || minScalePercent <= 0 || isNaN(maxScalePercent) || maxScalePercent <= 0) {
            alert('Invalid scale percentage. Please enter a positive number.');
            return;
        }

        // Convert scale percentages to decimals
        var minScaleDecimal = minScalePercent / 100;
        var maxScaleDecimal = maxScalePercent / 100;

        // Loop over all selected objects
        for (var i = 0; i < app.activeDocument.selection.length; i++) {
            var item = app.activeDocument.selection[i];

            // Generate a random scale decimal within the range
            var randomScaleDecimal = minScaleDecimal + Math.random() * (maxScaleDecimal - minScaleDecimal);

            // Scale the item
            item.resize(randomScaleDecimal * 100, randomScaleDecimal * 100, true, true, true, true, randomScaleDecimal, Transformation.CENTER);
        }
        
        dialog.close();
    }

    // If Cancel button is clicked
    dialog.cancelButton.onClick = function() {
        dialog.close();
    }

    // Show dialog
    dialog.show();
}

scaleSelectedItems();
