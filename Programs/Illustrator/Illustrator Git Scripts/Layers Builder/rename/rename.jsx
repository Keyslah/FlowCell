// FlowCell Layers Builder catalog source.
// Renames the distinct layers containing Illustrator's selected objects.
#target illustrator

(function () {
    if (app.documents.length === 0) {
        alert("Open a document first.");
        return;
    }

    var doc = app.activeDocument;
    var selection = normalizedSelection(doc.selection);
    var layers = [];
    var i;
    for (i = 0; i < selection.length; i += 1) {
        var itemType = "";
        try { itemType = String(selection[i].typename); } catch (typeError) {}
        if (itemType === "InsertionPoint" || itemType === "TextRange") {
            continue;
        }
        var layer = owningLayer(selection[i]);
        if (!layer) {
            throw new Error("A selected Illustrator object does not belong to a layer.");
        }
        if (!containsLayer(layers, layer)) {
            layers.push(layer);
        }
    }
    if (layers.length === 0) {
        alert("Select one or more Illustrator objects first.");
        return;
    }

    var newNames = showRenameDialog(layers);
    if (newNames === null) return;

    var states = [];
    var previousNames = [];
    try {
        for (i = 0; i < layers.length; i += 1) {
            if (!newNames[i] || newNames[i] === String(layers[i].name)) continue;
            previousNames.push({ layer: layers[i], name: String(layers[i].name) });
            openAncestors(layers[i], states);
            layers[i].name = newNames[i];
        }
    } catch (renameError) {
        for (i = previousNames.length - 1; i >= 0; i -= 1) {
            try { previousNames[i].layer.name = previousNames[i].name; } catch (rollbackError) {}
        }
        throw renameError;
    } finally {
        restoreLayerStates(states);
    }
    try { app.redraw(); } catch (redrawError) {}

    function showRenameDialog(targets) {
        var dialog = new Window("dialog", "Rename Layers");
        dialog.orientation = "column";
        dialog.alignChildren = "fill";
        dialog.add("statictext", undefined, "Enter a new name beside each layer. Blank keeps the current name.");
        var header = dialog.add("group");
        header.add("statictext", undefined, "Current layer").preferredSize.width = 240;
        header.add("statictext", undefined, "New name").preferredSize.width = 220;
        var body = dialog.add("group");
        body.orientation = "row";
        var rows = body.add("group");
        rows.orientation = "column";
        rows.alignChildren = "fill";
        var visibleCount = Math.min(targets.length, 8);
        var fields = [];
        var names = [];
        var offset = 0;
        var rowIndex;
        for (rowIndex = 0; rowIndex < targets.length; rowIndex += 1) names.push("");
        for (rowIndex = 0; rowIndex < visibleCount; rowIndex += 1) {
            var row = rows.add("group");
            var current = row.add("statictext", undefined, "");
            current.preferredSize.width = 240;
            var input = row.add("edittext", undefined, "");
            input.preferredSize.width = 220;
            fields.push({ current: current, input: input });
        }
        var scroll = null;
        if (targets.length > visibleCount) {
            scroll = body.add("scrollbar", undefined, 0, 0, targets.length - visibleCount);
            scroll.preferredSize.height = visibleCount * 28;
        }
        var range = dialog.add("statictext", undefined, "");
        var buttons = dialog.add("group");
        buttons.alignment = "right";
        var cancel = buttons.add("button", undefined, "Cancel");
        var accept = buttons.add("button", undefined, "Rename");
        function saveVisible() {
            for (var index = 0; index < fields.length; index += 1) {
                names[offset + index] = String(fields[index].input.text);
            }
        }
        function showVisible(nextOffset) {
            offset = nextOffset;
            for (var index = 0; index < fields.length; index += 1) {
                var target = targets[offset + index];
                fields[index].current.text = layerPath(target);
                fields[index].current.helpTip = layerPath(target);
                fields[index].input.text = names[offset + index];
                fields[index].input.helpTip = "New name for " + layerPath(target);
            }
            range.text = (offset + 1) + "-" + (offset + fields.length) + " of " + targets.length;
        }
        if (scroll) {
            scroll.onChanging = scroll.onChange = function () {
                var nextOffset = Math.max(0, Math.min(targets.length - visibleCount, Math.round(scroll.value)));
                if (nextOffset !== offset) {
                    saveVisible();
                    showVisible(nextOffset);
                }
            };
        }
        cancel.onClick = function () { dialog.close(0); };
        accept.onClick = function () { saveVisible(); dialog.close(1); };
        showVisible(0);
        if (dialog.show() !== 1) return null;
        for (rowIndex = 0; rowIndex < names.length; rowIndex += 1) {
            names[rowIndex] = String(names[rowIndex]).replace(/^\s+|\s+$/g, "");
        }
        return names;
    }

    function layerPath(layer) {
        var names = [];
        var current = layer;
        while (current && current.typename === "Layer") {
            names.unshift(String(current.name));
            current = current.parent && current.parent.typename === "Layer" ? current.parent : null;
        }
        return names.join(" / ");
    }

    function normalizedSelection(value) {
        var items = [];
        if (!value) return items;
        try {
            if (value.typename) {
                items.push(value);
                return items;
            }
        } catch (typeError) {}
        if (typeof value.length === "number") {
            for (var index = 0; index < value.length; index += 1) {
                if (value[index]) items.push(value[index]);
            }
        }
        return items;
    }

    function owningLayer(item) {
        try {
            if (item.layer && item.layer.typename === "Layer") return item.layer;
        } catch (layerError) {}
        var current = item;
        for (var depth = 0; current && depth < 64; depth += 1) {
            try { if (current.typename === "Layer") return current; } catch (typeError) {}
            try { current = current.parent; } catch (parentError) { current = null; }
        }
        return null;
    }

    function containsLayer(items, candidate) {
        for (var index = 0; index < items.length; index += 1) {
            if (items[index] === candidate) return true;
        }
        return false;
    }

    function openAncestors(layer, states) {
        var current = layer;
        while (current && current.typename === "Layer") {
            if (!containsState(states, current)) {
                states.push({ layer: current, locked: current.locked, visible: current.visible, depth: layerDepth(current) });
            }
            current.locked = false;
            current.visible = true;
            current = current.parent && current.parent.typename === "Layer" ? current.parent : null;
        }
    }

    function containsState(states, layer) {
        for (var index = 0; index < states.length; index += 1) {
            if (states[index].layer === layer) return true;
        }
        return false;
    }

    function layerDepth(layer) {
        var depth = 0;
        var current = layer;
        while (current.parent && current.parent.typename === "Layer") {
            depth += 1;
            current = current.parent;
        }
        return depth;
    }

    function restoreLayerStates(states) {
        states.sort(function (left, right) { return right.depth - left.depth; });
        for (var index = 0; index < states.length; index += 1) {
            try { states[index].layer.visible = states[index].visible; } catch (visibleError) {}
            try { states[index].layer.locked = states[index].locked; } catch (lockedError) {}
        }
    }
}());
