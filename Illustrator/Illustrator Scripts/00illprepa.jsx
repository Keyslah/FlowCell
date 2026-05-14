// Illustrator: Expand Everything While Keeping Layers
var doc = app.activeDocument;

// Convert Text to Outlines Without Merging
function outlineText() {
    for (var i = doc.textFrames.length - 1; i >= 0; i--) {
        doc.textFrames[i].createOutline();
    }
}

// Expand Strokes and Appearance Without Merging
function expandEverything() {
    for (var i = 0; i < doc.layers.length; i++) {
        var layer = doc.layers[i];
        for (var j = layer.pageItems.length - 1; j >= 0; j--) {
            var item = layer.pageItems[j];

            // Expand strokes and effects only, not merging fills
            try {
                item.selected = true;
                app.executeMenuCommand("expandStyle"); // Expand strokes
                app.executeMenuCommand("expandAppearance"); // Expand effects
                item.selected = false;
            } catch (e) {}
        }
    }
}

// Remove Clipping Masks Without Merging Layers
function removeClippingMasks() {
    for (var i = doc.pageItems.length - 1; i >= 0; i--) {
        var item = doc.pageItems[i];
        if (item.clipping) {
            item.remove();
        }
    }
}

// Ungroup Everything but Maintain Layers
function ungroupAll() {
    for (var i = 0; i < doc.layers.length; i++) {
        var layer = doc.layers[i];
        try {
            while (layer.groupItems.length > 0) {
                layer.groupItems[0].ungroup();
            }
        } catch (e) {}
    }
}

// Run all functions while preserving layers
outlineText();
expandEverything();
removeClippingMasks();
ungroupAll();

alert("Illustrator file expanded while keeping layers intact. Ready for Photoshop!");
