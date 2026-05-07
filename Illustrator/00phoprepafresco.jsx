#target photoshop
app.activeDocument.suspendHistory("Prepare for Fresco", "prepareForFresco()");

function prepareForFresco() {
    var doc = app.activeDocument;

    function processLayer(layer) {
        try {
            // Unlock any locked layers
            if (layer.allLocked || layer.pixelLocked) {
                layer.allLocked = false;
                layer.pixelLocked = false;
            }

            // Rasterize all non-pixel layers safely
            if (layer.typename === "ArtLayer" && layer.kind !== LayerKind.NORMAL) {
                layer.rasterize(RasterizeType.ENTIRELAYER);
            }

            // Process Groups (Layer Sets) Safely
            if (layer.typename === "LayerSet") {
                var subLayers = layer.layers;
                for (var i = subLayers.length - 1; i >= 0; i--) {
                    processLayer(subLayers[i]);
                }
            }
        } catch (e) {
            alert("Error processing layer: " + layer.name);
        }
    }

    // Process all layers safely
    for (var i = doc.layers.length - 1; i >= 0; i--) {
        processLayer(doc.layers[i]);
    }

    alert("Photoshop file is fully prepared for Fresco!");
}
