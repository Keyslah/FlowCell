// Adobe Illustrator Script: Invert Opacity for Selected Objects

if (app.documents.length < 1) {
    alert("No documents open. Open a document and try again.");
} else {
    var doc = app.activeDocument;
    if (doc.selection.length < 1) {
        alert("Nothing selected. Select one or more objects and run the script again.");
    } else {
        var selection = doc.selection;
        for (var i = 0; i < selection.length; i++) {
            // Make sure the object has an opacity property.
            // (Almost all page items do, but we check to be safe.)
            if ("opacity" in selection[i]) {
                // Invert the opacity (e.g., 80 becomes 20, 30 becomes 70)
                selection[i].opacity = 100 - selection[i].opacity;
            }
        }
        alert("Inverted opacity on " + selection.length + " objects. Enjoy the new look!");
    }
}
