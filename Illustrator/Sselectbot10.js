// Select Bottom 10% Objects from Selection.jsx
// Adobe Illustrator Script

function main() {
    var doc = app.activeDocument;
    var selectedItems = app.selection;
    var validItems = [];

    // Iterate through all selected objects
    for (var i = 0; i < selectedItems.length; i++) {
        var item = selectedItems[i];
        validItems.push(item);
    }

    // Sort the items by their position on the Y-axis
    validItems.sort(function (a, b) {
        return a.position[1] - b.position[1]; // Change the order to sort from bottom to top
    });

    // Calculate the index for the bottom 10% of objects
    var bottomTenIndex = Math.floor(validItems.length * 0.1);

    // Deselect all objects
    app.selection = null;

    // Select the bottom 10% of objects
    for (var i = 0; i < bottomTenIndex; i++) {
        validItems[i].selected = true;
    }
}

main();
