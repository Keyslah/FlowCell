#target illustrator

(function () {
    if (app.documents.length === 0) return;

    var doc = app.activeDocument;

    function deleteInvisibleLayers(layerGroup) {
        for (var i = layerGroup.layers.length - 1; i >= 0; i--) {
            var layer = layerGroup.layers[i];

            // First check and clean sublayers
            deleteInvisibleLayers(layer);

            if (!layer.visible && doc.layers.length > 1) {
                layer.locked = false;
                layer.visible = true; // must be visible to delete
                layer.remove();
            }
        }
    }

    deleteInvisibleLayers(doc);

    
})();
