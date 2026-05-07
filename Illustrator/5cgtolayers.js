// Adobe Illustrator script to apply the last five color groups to layers in reverse order

#target illustrator

function applyColorsToLayers() {
    var doc = app.activeDocument;

    // Get the color groups
    var colorGroups = doc.swatchGroups;
    $.writeln('Total color groups: ' + colorGroups.length);

    // Get the last five color groups using a loop
    var lastFiveColorGroups = [];
    for (var i = Math.max(colorGroups.length - 5, 0); i < colorGroups.length; i++) {
        lastFiveColorGroups.push(colorGroups[i]);
    }
    $.writeln('Last five color groups: ' + lastFiveColorGroups.length);

    // Iterate through layers in reverse order
    for (var layerIndex = doc.layers.length - 1; layerIndex >= 0; layerIndex--) {
        var layer = doc.layers[layerIndex];
        $.writeln('Processing layer: ' + layer.name);

        // Check if the layer is unlocked and visible
        if (!layer.locked && layer.visible) {
            // Check if there are any color groups left
            if (lastFiveColorGroups.length > 0) {
                // Get the last color group
                var colorGroup = lastFiveColorGroups[lastFiveColorGroups.length - 1];

                // Apply the colors to the layer
                applyColorGroupToLayer(colorGroup, layer);

                // Remove the color group
                lastFiveColorGroups.pop();
            } else {
                // No more color groups, exit the loop
                break;
            }
        }
    }
}

function applyColorGroupToLayer(colorGroup, layer) {
    var colorIndex = 0;
    var swatches = colorGroup.getAllSwatches();

    for (var itemIndex = 0; itemIndex < layer.pageItems.length; itemIndex++) {
        var item = layer.pageItems[itemIndex];

        // Apply the color from the color group to the item
        if (item.typename === "PathItem" && !item.locked && !item.hidden) {
            if (swatches[colorIndex] !== undefined) {
                item.fillColor = swatches[colorIndex].color;
            }
            colorIndex = (colorIndex + 1) % swatches.length;
        }
    }
}

applyColorsToLayers();
