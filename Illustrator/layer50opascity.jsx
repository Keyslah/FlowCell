//@target illustrator

// Check if there's an open document
if (app.documents.length > 0) {
    var doc = app.activeDocument;
    var activeLayer = doc.activeLayer;

    // Set the opacity of all items in the active layer
    for (var i = 0; i < activeLayer.pageItems.length; i++) {
        activeLayer.pageItems[i].opacity = 50; // Change to desired opacity (0-100)
    }
} else {
    alert("No document open.");
}
