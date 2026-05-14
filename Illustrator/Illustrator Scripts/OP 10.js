// This script adjusts the opacity of selected objects based on their horizontal position,
// with darker objects in the middle and lighter objects on the far left or right,
// while introducing some random variation and using opacity percentages in increments of 10%

// Check if there are selected objects
if (app.activeDocument.selection.length > 0) {
    var selectedObjects = app.activeDocument.selection;
    var boundingBox = selectedObjects[0].geometricBounds;
    
    // Calculate the bounding box containing all selected objects
    for (var i = 1; i < selectedObjects.length; i++) {
        var objBounds = selectedObjects[i].geometricBounds;
        
        boundingBox[0] = Math.min(boundingBox[0], objBounds[0]);
        boundingBox[1] = Math.max(boundingBox[1], objBounds[1]);
        boundingBox[2] = Math.max(boundingBox[2], objBounds[2]);
        boundingBox[3] = Math.min(boundingBox[3], objBounds[3]);
    }

    // Determine the center of the bounding box
    var centerX = (boundingBox[0] + boundingBox[2]) / 2;

    // Function to calculate opacity based on the object's distance from the center
    function opacityFromDistance(distance, maxDistance) {
        var ratio = 1 - (distance / maxDistance);
        var baseOpacity = 65 + ratio * 25;
        var randomVariation = 5; // Adjust this value to control the random variation
        var randomOffset = (Math.random() * 2 - 1) * randomVariation;
        var opacity = baseOpacity + randomOffset;
        
        // Round the opacity to the nearest increment of 10%
        return Math.round(opacity / 10) * 10;
    }

    // Loop through selected objects and adjust their opacity based on their position
    for (var i = 0; i < selectedObjects.length; i++) {
        var obj = selectedObjects[i];
        var objCenterX = (obj.geometricBounds[0] + obj.geometricBounds[2]) / 2;
        var distance = Math.abs(centerX - objCenterX);
        var maxDistance = (boundingBox[2] - boundingBox[0]) / 2;

        obj.opacity = opacityFromDistance(distance, maxDistance);
    }

    alert("Opacity of selected objects has been updated based on their horizontal position with random variation and increments of 10%.");
} else {
    alert("Please select some objects before running the script.");
}
