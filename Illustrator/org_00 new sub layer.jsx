// Description: Runs 00 new sub layer.
#target illustrator

(function () {
    if (app.documents.length === 0) {
        app.documents.add();
    }

    var doc = app.activeDocument;
    var parentLayer = resolveParentLayer(doc);
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

    if (parentLayer.locked) {
        parentLayer.locked = false;
    }

    if (!parentLayer.visible) {
        parentLayer.visible = true;
    }

    newLayer = parentLayer.layers.add();
    newLayer.name = uniqueChildLayerName(parentLayer, requestedName);
    newLayer.visible = true;
    newLayer.locked = false;
    doc.activeLayer = newLayer;

    function resolveParentLayer(documentRef) {
        var selection = normalizeSelection(documentRef.selection);

        if (selection.length > 0) {
            try {
                if (selection[0].layer) {
                    return selection[0].layer;
                }
            } catch (ignore) {}
        }

        return documentRef.activeLayer || documentRef.layers[0] || documentRef.layers.add();
    }

    function normalizeSelection(rawSelection) {
        var result = [];
        var i;

        if (!rawSelection) {
            return result;
        }

        if (typeof rawSelection.length === "number") {
            for (i = 0; i < rawSelection.length; i += 1) {
                if (rawSelection[i]) {
                    result.push(rawSelection[i]);
                }
            }
            return result;
        }

        result.push(rawSelection);
        return result;
    }

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
