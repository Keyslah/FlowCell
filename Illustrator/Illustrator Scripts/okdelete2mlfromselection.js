// DeleteSmallObjectsAtAngles.jsx
// Removes selected objects with a width or length less than 2 millimeters at various angles
// use direct select on small parts at a time
// Set the minimum size in millimeters
var minSize = 2;

// Convert millimeters to points (1 mm = 2.83465 points)
var minSizeInPoints = minSize * 2.83465;

// Get the active document
var doc = app.activeDocument;

// Get the selection
var selection = doc.selection;

// Loop through the selected objects
for (var i = selection.length - 1; i >= 0; i--) {
  var obj = selection[i];
  var shouldDelete = false;

  // Check the object's width and height at different angles
  for (var angle = 0; angle < 360; angle += 15) {
    // Duplicate the object and rotate it
    var rotatedObj = obj.duplicate();
    rotatedObj.rotate(angle, true, true, true, true, Transformation.CENTER);

    // Get the rotated object's dimensions
    var objWidth = rotatedObj.width;
    var objHeight = rotatedObj.height;

    // Check if the rotated object's width or height is less than the minimum size in points
    if (objWidth < minSizeInPoints || objHeight < minSizeInPoints) {
      shouldDelete = true;
    }

    // Delete the rotated duplicate
    rotatedObj.remove();

    // If the object should be deleted, break the loop
    if (shouldDelete) {
      break;
    }
  }

  // Delete the original object if necessary
  if (shouldDelete) {
    obj.remove();
  }
}

// Display a message to inform the user that the script has completed
alert("Objects with a width or length less than " + minSize + " millimeters at various angles have been deleted.");
