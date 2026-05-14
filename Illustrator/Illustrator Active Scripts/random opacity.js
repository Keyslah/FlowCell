// This script randomly changes the opacity of selected objects in the range of 65% to 90%

// Check if there are selected objects
if (app.activeDocument.selection.length > 0) {
    var selectedObjects = app.activeDocument.selection;

    // Function to generate random opacity between 65% and 90%
    function randomOpacity() {
        return 65 + Math.random() * 25;
    }

    // Loop through selected objects and change their opacity
    for (var i = 0; i < selectedObjects.length; i++) {
        var obj = selectedObjects[i];
        obj.opacity = randomOpacity();
    }

    alert("Opacity of selected objects has been updated randomly.");
} else {
    alert("Please select some objects before running the script.");
}
