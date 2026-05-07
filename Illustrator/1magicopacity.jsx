// Adobe Illustrator Script: Blend Scaling with Opacity (Combined Prompt Version)

// Polyfill for String.prototype.trim if it doesn't exist
if (!String.prototype.trim) {
    String.prototype.trim = function() {
        return this.replace(/^\s+|\s+$/g, '');
    };
}

// Make sure a document is open
if (app.documents.length < 1) {
    alert("No documents open. Open a document and try again.");
} else {
    var doc = app.activeDocument;
    if (doc.selection.length < 1) {
        alert("Please select an object to blend.");
    } else {
        // Use the first selected object
        var original = doc.selection[0];

        // Single prompt for both final size and number of copies.
        // Format: "10,8" (10 inches and 8 copies)
        var input = prompt("Enter final size (in inches) and number of copies, separated by a comma (e.g. 10,8):", "10,8");
        if (input === null) exit();  // User cancelled

        // Split the input into parts
        var parts = input.split(",");
        if (parts.length < 2) {
            alert("Please enter both a final size and a number of copies, separated by a comma.");
            exit();
        }

        // Parse and validate the final size (in inches)
        var finalSizeInches = parseFloat(parts[0].trim());
        if (isNaN(finalSizeInches) || finalSizeInches <= 0) {
            alert("Invalid final size entered.");
            exit();
        }

        // Parse and validate the number of copies
        var copies = parseInt(parts[1].trim(), 10);
        if (isNaN(copies) || copies <= 0) {
            alert("Invalid number of copies entered.");
            exit();
        }
        
        // Total objects: original + copies
        var totalObjects = copies + 1;
        
        // Conversion factor: 72 points per inch
        var inchToPt = 72;
        var finalSizePts = finalSizeInches * inchToPt;

        // Get the original object's width from its geometric bounds.
        // The bounds are returned as [top, left, bottom, right].
        var gb = original.geometricBounds;
        var origWidth = Math.abs(gb[3] - gb[1]);

        // Calculate the incremental width increase per copy.
        var sizeIncrement = (finalSizePts - origWidth) / copies;

        // Calculate the opacity value (80 divided by the number of copies)
        var opacityVal = 80 / copies; // e.g., for 8 copies, opacity=10%

        // Set the original object's opacity.
        original.opacity = opacityVal;

        // Duplicate and scale copies.
        for (var i = 1; i <= copies; i++) {
            var newWidth = origWidth + (sizeIncrement * i);
            var scaleFactor = (newWidth / origWidth) * 100;  // Percentage scale

            // Duplicate the original object.
            var dup = original.duplicate();
            
            // Try using the 8-argument version with AnchorPosition.CENTER.
            // If that fails, fall back to the 7-argument version.
            try {
                dup.resize(scaleFactor, scaleFactor, true, true, true, true, true, AnchorPosition.CENTER);
            } catch(e) {
                dup.resize(scaleFactor, scaleFactor, true, true, true, true, true);
            }
            
            dup.opacity = opacityVal;
        }
        
        alert("Done! Created " + totalObjects + " objects with a size blend from " +
              (origWidth/inchToPt).toFixed(2) + " to " + finalSizeInches + " inches, each at " +
              opacityVal.toFixed(2) + "% opacity. Enjoy the magic (and forgive the minor hassle)!");
    }
}
