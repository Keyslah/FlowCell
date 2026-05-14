// Description: Change every Nth object in the selection to white, avoiding adjacent selections
// Requirements: Adobe Illustrator CS6 or later

// Prompt for N input
var dialog = new Window("dialog", "Nth Object to White");
dialog.orientation = "row";
dialog.alignChildren = "center";

dialog.add("statictext", undefined, "N:");
var nthInput = dialog.add("edittext", undefined, "2");
nthInput.characters = 5;
nthInput.active = true;

var okButton = dialog.add("button", undefined, "OK");
var cancelButton = dialog.add("button", undefined, "Cancel");

okButton.onClick = function() {
    changeNthObjectToWhite(parseInt(nthInput.text));
    dialog.close();
};

cancelButton.onClick = function() {
    dialog.close();
};

dialog.show();

// Function to change every Nth object to white
function changeNthObjectToWhite(n) {
    if (isNaN(n) || n < 1) {
        alert("Invalid value for N. Please enter a positive integer.");
        return;
    }

    var doc = app.activeDocument;
    var sel = doc.selection;
    var len = sel.length;

    if (len === 0) {
        alert("No objects selected. Please select objects to apply the script.");
        return;
    }

    var count = 0;
    var lastChangedIndex = -1;
    var whiteColor = new RGBColor();
    whiteColor.red = 255;
    whiteColor.green = 255;
    whiteColor.blue = 255;

    for (var i = 0; i < len; i++) {
        count++;
        if (count === n) {
            // Skip if it's the next object
            if (lastChangedIndex === (i - 1)) {
                continue;
            }

            if (sel[i].typename === "PathItem" || sel[i].typename === "CompoundPathItem" || sel[i].typename === "TextFrame") {
                sel[i].fillColor = whiteColor;
            }

            lastChangedIndex = i;
            count = 0;
        }
    }
}
