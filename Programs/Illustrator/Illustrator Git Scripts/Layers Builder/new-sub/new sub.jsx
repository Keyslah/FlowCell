// FlowCell Layers Builder catalog source.
// Creates a direct child under exactly one FlowCell-highlighted layer.
#target illustrator

#include "flowcell-layer-tree-selection.jsxinc"

var FLOWCELL_LB_TARGETS = FlowCellLayersBuilderSelection.resolveTargets();

try {
// Description: Create a direct child under exactly one highlighted Layer Tree layer.

#target illustrator

(function () {
    if (FLOWCELL_LB_TARGETS.layers.length !== 1) {
        throw new Error("FlowCell New Sub: highlight exactly one layer in Layer Tree.");
    }

    var doc = FLOWCELL_LB_TARGETS.document;
    var parentLayer = FLOWCELL_LB_TARGETS.layers[0];
    var defaultName = uniqueChildLayerName(parentLayer, "Sublayer");
    var requestedName = prompt("Name for the new sublayer:", defaultName, "Create New Sublayer");
    var newLayer;

    if (requestedName === null) {
        return;
    }

    requestedName = trimText(requestedName);
    if (requestedName === "") {
        requestedName = defaultName;
    }

    newLayer = parentLayer.layers.add();
    newLayer.name = uniqueChildLayerName(parentLayer, requestedName);
    newLayer.visible = true;
    newLayer.locked = false;
    doc.activeLayer = newLayer;

    function uniqueChildLayerName(parent, baseName) {
        var candidate = baseName;
        var suffix = 2;

        while (childLayerNameExists(parent, candidate)) {
            candidate = baseName + " " + suffix;
            suffix += 1;
        }

        return candidate;
    }

    function childLayerNameExists(parent, name) {
        var i;

        for (i = 0; i < parent.layers.length; i += 1) {
            if (parent.layers[i].name === name) {
                return true;
            }
        }

        return false;
    }

    function trimText(value) {
        return String(value).replace(/^\s+|\s+$/g, "");
    }
}());

} finally {
    FlowCellLayersBuilderSelection.restore(FLOWCELL_LB_TARGETS.restore);
    try { app.redraw(); } catch (redrawError) {}
}
