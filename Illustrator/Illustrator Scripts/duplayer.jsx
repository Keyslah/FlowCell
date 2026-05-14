//@target illustrator

// Check if there's an open document
if (app.documents.length > 0) {
    var doc = app.activeDocument;
    var activeLayer = doc.activeLayer;

    // Create a new layer
    var newLayer = doc.layers.add();
    newLayer.name = activeLayer.name + " Copy"; // Appends " Copy" to the duplicated layer name

    // Loop through all items in the active layer and duplicate them into the new layer
    for (var i = 0; i < activeLayer.pageItems.length; i++) {
        var item = activeLayer.pageItems[i];
        var duplicatedItem = item.duplicate(newLayer, ElementPlacement.PLACEATEND);
    }
} else {
    alert("No document open.");
}
