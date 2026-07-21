// FlowCell Layers Builder catalog source.
// Directly deletes the FlowCell-highlighted layers/sublayers (works on empty,
// locked, or hidden layers) while protecting system roots and Archive/Trash.
#target illustrator
#include "flowcell-layer-tree-selection.jsxinc"

var FLOWCELL_LB_TARGETS = FlowCellLayersBuilderSelection.resolveTargets();

try {
(function () {
    var ROOT_LIVE = "Live";
    var ROOT_SNAPSHOTS = "Snapshots";
    var ROOT_3D = "3D";
    var ROOT_TRASH = "Trash";
    var ROOT_ARCHIVE = "Archive";

    function unlockTree(layer) {
        try { layer.locked = false; } catch (e1) {}
        try { layer.visible = true; } catch (e2) {}
        for (var i = 0; i < layer.layers.length; i += 1) { unlockTree(layer.layers[i]); }
    }

    var doomed = FLOWCELL_LB_TARGETS.layers;
    // Resolve to references first, then remove (index shifts do not matter).
    for (var d = 0; d < doomed.length; d += 1) {
        if (!isDeletableLayer(doomed[d])) {
            continue;
        }
        try {
            unlockTree(doomed[d]);
            doomed[d].remove();
        } catch (removeError) {}
    }
    try { app.redraw(); } catch (redrawError) {}

    function isDeletableLayer(layer) {
        var top = getTopLevelAncestor(layer);
        if (!top || isSystemRoot(layer)) {
            return false;
        }
        return top.name !== ROOT_TRASH && top.name !== ROOT_ARCHIVE;
    }

    function getTopLevelAncestor(layer) {
        var current = layer;
        while (current && current.parent && current.parent.typename === "Layer") {
            current = current.parent;
        }
        return current;
    }

    function isSystemRoot(layer) {
        if (!layer || !layer.parent || layer.parent.typename !== "Document") {
            return false;
        }
        return layer.name === ROOT_LIVE || layer.name === ROOT_SNAPSHOTS ||
            layer.name === ROOT_3D || layer.name === ROOT_TRASH ||
            layer.name === ROOT_ARCHIVE;
    }
}());
} finally {
    FlowCellLayersBuilderSelection.restore(FLOWCELL_LB_TARGETS.restore);
    try { app.redraw(); } catch (redrawError) {}
}
