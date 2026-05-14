// Tries to force Illustrator to properly select the layer before deleting, workaround for undo bugs

if (app.documents.length > 0) {
    var doc = app.activeDocument;
    var targetLayer = doc.activeLayer;

    if (doc.layers.length <= 1) {
        alert("Can't delete the last remaining layer!");
    } else if (targetLayer && targetLayer.typename === "Layer") {
        var layerName = targetLayer.name;
        var otherLayer = null;
        // Find a different layer to switch to
        for (var i = 0; i < doc.layers.length; i++) {
            if (doc.layers[i].name !== layerName) {
                otherLayer = doc.layers[i];
                break;
            }
        }
        if (otherLayer) {
            // Force Illustrator to switch away, then back
            doc.activeLayer = otherLayer;
            $.sleep(50); // Pause to try to force UI to update (sometimes helps)
            doc.activeLayer = targetLayer;
            $.sleep(50);
        }

        // Now, double-check the layer by name
        var foundLayer = null;
        for (var j = 0; j < doc.layers.length; j++) {
            if (doc.layers[j].name === layerName) {
                foundLayer = doc.layers[j];
                break;
            }
        }

        if (foundLayer) {
            foundLayer.locked = false;
            foundLayer.visible = true;
            foundLayer.remove();
        } else {
            alert("Couldn't find the layer. Try reselecting in the Layers panel.");
        }
    } else {
        alert("Please select a layer in the Layers panel.");
    }
}
