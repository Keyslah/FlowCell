// Dialog box for user input
var dlg = new Window('dialog', 'Fill Percentage');
dlg.orientation = 'column';
dlg.alignChildren = 'left';

dlg.add('statictext', undefined, 'Enter fill percentage:');
var percentageInput = dlg.add('edittext', undefined, '30');
percentageInput.characters = 5;

dlg.add('button', undefined, 'OK', {name: 'ok'});
dlg.add('button', undefined, 'Cancel', {name: 'cancel'});

var fillPercentage = 30;

if (dlg.show() == 1) {
    fillPercentage = parseInt(percentageInput.text);
    main(fillPercentage);
}

function main(fillPercentage) {

    // Get the active document
    var doc = app.activeDocument;

    // Get the selected items
    var selectedItems = doc.selection;

    // Calculate the number of items to fill
    var itemsToFill = Math.floor(selectedItems.length * fillPercentage / 100);

    // Get the first swatch from the last color group
    var colorGroup = doc.swatchGroups[doc.swatchGroups.length - 1];
    var swatchColor = colorGroup.getAllSwatches()[0].color;

    // Calculate the interval between filled items
    var fillInterval = Math.floor(selectedItems.length / itemsToFill);

    // Fill the items
    for (var i = 0, j = 0; i < selectedItems.length && j < itemsToFill; i += fillInterval, j++) {
        var item = selectedItems[i];
        if (item.typename == "PathItem") {
            item.fillColor = swatchColor;
        }
    }
}