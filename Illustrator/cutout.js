// Create a dialog box to get user input
var dialog = new Window("dialog", "Rotation Settings");

// Add text and input fields to the dialog
dialog.add("statictext", undefined, "Enter the number of rotations:");
var numberOfRotationsInput = dialog.add("edittext", undefined, "10");
dialog.add("statictext", undefined, "Enter the initial degree increment:");
var initialDegreesIncrementInput = dialog.add("edittext", undefined, "5");
dialog.add("statictext", undefined, "Enter the degree increment increase:");
var degreeIncrementIncreaseInput = dialog.add("edittext", undefined, "5");

dialog.add("button", undefined, "OK");
dialog.add("button", undefined, "Cancel");

// Define button actions
dialog.children[6].onClick = function() {
    var numberOfRotations = parseInt(numberOfRotationsInput.text);
    var initialDegreesIncrement = parseInt(initialDegreesIncrementInput.text);
    var degreeIncrementIncrease = parseInt(degreeIncrementIncreaseInput.text);
    
    if (!isNaN(numberOfRotations) && !isNaN(initialDegreesIncrement) && !isNaN(degreeIncrementIncrease)) {
        // Get the currently selected object(s)
        var selectedItems = app.activeDocument.selection;
        
        // Loop through selected items
        for (var i = 0; i < selectedItems.length; i++) {
            var currentItem = selectedItems[i];
            var degreesIncrement = initialDegreesIncrement;
            
            // Calculate the number of rotations needed for a full 360-degree rotation
            var fullRotationCount = Math.ceil(360 / degreesIncrement);
            
            // Create copies with rotations until a full 360-degree rotation is achieved
            for (var j = 0; j < fullRotationCount; j++) {
                var rotationAngle = degreesIncrement * j;
                var copiedItem = currentItem.duplicate();
                copiedItem.rotate(rotationAngle);
                
                degreesIncrement += degreeIncrementIncrease; // Increase the degree increment by user-specified value
            }
        }
        
        dialog.close();
    } else {
        alert("Please enter valid numeric values for N, the initial degree increment, and the degree increment increase.");
    }
};

dialog.children[7].onClick = function() {
    dialog.close();
};

// Display the dialog
dialog.show();
