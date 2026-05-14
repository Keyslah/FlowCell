// Description: Runs delete sublayer.
#target illustrator

/*
 * Deletes the deepest eligible real sublayer for each selected item.
 * If a selected item lives directly on top-level Live with no real sublayer,
 * deletes the item itself instead.
 */
(function () {
    var SCRIPT_VERSION = "delete sublayer 2026-03-23";
    var LOG_PATH = Folder.temp.fsName + "/Illustrator_Delete_Sublayer_Debug.log";
    var ROOT_LIVE = "Live";
    var ROOT_SNAPSHOTS = "Snapshots";
    var ROOT_TRASH = "Trash";
    var ROOT_ARCHIVE = "Archive";

    if (app.documents.length === 0) {
        logLine("Run aborted: no open document.");
        return;
    }

    var doc = app.activeDocument;
    var originalActiveLayer = doc.activeLayer;

    try {
        resetLog(doc);

        var selection = normalizeSelection(doc.selection);
        var resolved = resolveTargets(selection);
        var targets = resolved.targets;
        var warnings = resolved.warnings;
        var deleted = [];
        var skipped = [];
        var i;

        logLine("Resolved target count: " + targets.length);

        if (selection.length === 0) {
            logLine("No selected objects were found.");
            return;
        }

        if (targets.length === 0) {
            warnings.push("No eligible real sublayers or Live object targets were resolved from the selection.");
            logWarnings(warnings);
            return;
        }

        for (i = targets.length - 1; i >= 0; i -= 1) {
            var target = targets[i];

            if (target.kind === "layer") {
                if (!layerExists(target.layer)) {
                    skipped.push(target.displayName + " (missing sublayer)");
                    logLine("Skipped missing layer target: " + target.displayName);
                    continue;
                }

                deleteLayerTarget(target);
                deleted.push(target.displayName);
                logLine("Deleted layer target: " + target.displayName);
                continue;
            }

            if (!itemExists(target.item)) {
                skipped.push(target.displayName + " (missing object)");
                logLine("Skipped missing item target: " + target.displayName);
                continue;
            }

            deleteItemTarget(target);
            deleted.push(target.displayName);
            logLine("Deleted item target: " + target.displayName);
        }

        if (deleted.length === 0) {
            logWarnings(warnings.concat(skipped));
            return;
        }

        var message = "Deleted:\n" + deleted.join("\n");
        if (skipped.length > 0) {
            message += "\nSkipped:\n" + skipped.join("\n");
        }
        if (warnings.length > 0) {
            message += "\nWarnings:\n" + warnings.join("\n");
        }
        message += "\nDebug log:\n" + LOG_PATH;
        logLine(message);
    } catch (err) {
        logLine("Exception: " + err);
    } finally {
        restoreActiveLayer(doc, originalActiveLayer);
    }

    function resolveTargets(selection) {
        var result = [];
        var warnings = [];
        var i;

        logLine("Normalized selection count: " + selection.length);

        for (i = 0; i < selection.length; i += 1) {
            logLine("Selection[" + i + "]: " + describeItem(selection[i]));
            addResolvedTarget(result, warnings, selection[i]);
        }

        return {
            targets: result,
            warnings: warnings
        };
    }

    function addResolvedTarget(targets, warnings, item) {
        var resolution = resolveTargetForItem(item);

        if (resolution.warning) {
            warnings.push(resolution.warning);
            logLine("Warning: " + resolution.warning);
        }

        if (!resolution.target) {
            logLine("No target resolved for: " + describeItem(item));
            return;
        }

        addUniqueTarget(targets, resolution.target);
        logLine("Resolved target: " + resolution.target.debugLabel);
    }

    function resolveTargetForItem(item) {
        var ownerLayer = getItemOwningLayer(item);
        var deletionLayer;
        var topLayer;

        if (!item) {
            return {
                target: null,
                warning: "Encountered an empty selection entry."
            };
        }

        if (!ownerLayer) {
            return {
                target: null,
                warning: "Selected item has no owning layer: " + describeItem(item)
            };
        }

        deletionLayer = getDeletionLayerForItem(item);
        if (deletionLayer) {
            return {
                target: makeLayerTarget(deletionLayer),
                warning: null
            };
        }

        topLayer = getTopLevelAncestor(ownerLayer);
        if (topLayer && topLayer.name === ROOT_LIVE && ownerLayer === topLayer) {
            return {
                target: makeItemTarget(item),
                warning: "Selected object is a direct child of Live, so only the object will be deleted: " + describeShortItem(item)
            };
        }

        return {
            target: null,
            warning: "Selected item is not inside a deletable Live or Snapshots sublayer: " + describeShortItem(item)
        };
    }

    function getDeletionLayerForItem(item) {
        var ownerLayer = getItemOwningLayer(item);
        var topLayer;
        var current;

        if (!ownerLayer) {
            return null;
        }

        topLayer = getTopLevelAncestor(ownerLayer);
        if (!topLayer) {
            return null;
        }

        if (topLayer.name === ROOT_LIVE) {
            if (ownerLayer === topLayer) {
                return null;
            }

            current = ownerLayer;
            while (current.parent && current.parent.typename === "Layer" && current.parent !== topLayer) {
                current = current.parent;
            }

            return current;
        }

        if (topLayer.name === ROOT_SNAPSHOTS) {
            if (ownerLayer === topLayer) {
                return null;
            }

            current = ownerLayer;
            while (current.parent && current.parent.typename === "Layer" && current.parent !== topLayer) {
                current = current.parent;
            }

            return current;
        }

        if (topLayer.name === ROOT_TRASH || topLayer.name === ROOT_ARCHIVE) {
            return null;
        }

        return null;
    }

    function isTopLevelLiveLayer(layer) {
        return !!layer &&
            layer.name === ROOT_LIVE &&
            !!layer.parent &&
            layer.parent.typename === "Document";
    }

    function isSystemRoot(layer) {
        if (!layer || !layer.parent || layer.parent.typename !== "Document") {
            return false;
        }

        return layer.name === ROOT_LIVE || layer.name === ROOT_SNAPSHOTS ||
            layer.name === ROOT_TRASH || layer.name === ROOT_ARCHIVE;
    }

    function deleteLayerTarget(target) {
        var state = captureBranchState(target.layer);
        var cleanupLayer = target.layer.parent && target.layer.parent.typename === "Layer" ? target.layer.parent : null;

        unlockBranchFromState(state);
        target.layer.remove();
        removeEmptyAncestors(cleanupLayer);
    }

    function deleteItemTarget(target) {
        var state = captureItemState(target.item);
        var cleanupLayer = getItemOwningLayer(target.item);

        unlockItemFromState(state);
        target.item.remove();
        removeEmptyAncestors(cleanupLayer);
    }

    function removeEmptyAncestors(layer) {
        var current = layer;
        var parentLayer;

        while (current && current.typename === "Layer" && !isSystemRoot(current)) {
            if (layerHasContent(current)) {
                break;
            }

            parentLayer = current.parent && current.parent.typename === "Layer" ? current.parent : null;
            current.remove();
            current = parentLayer;
        }
    }

    function makeLayerTarget(layer) {
        return {
            kind: "layer",
            key: "layer:" + getLayerPath(layer),
            name: layer.name,
            displayName: getLayerPath(layer),
            layer: layer,
            debugLabel: "layer target | " + getLayerPath(layer)
        };
    }

    function makeItemTarget(item) {
        var itemName = getItemDisplayName(item);

        return {
            kind: "item",
            key: "item:" + getItemKey(item),
            name: itemName,
            displayName: itemName,
            item: item,
            debugLabel: "item target | " + itemName
        };
    }

    function addUniqueTarget(targets, target) {
        var i;

        for (i = 0; i < targets.length; i += 1) {
            if (targets[i].key === target.key) {
                return;
            }
        }

        targets.push(target);
    }

    function getItemOwningLayer(item) {
        var current = item;

        while (current) {
            if (current.typename === "Layer") {
                return current;
            }

            try {
                current = current.parent;
            } catch (ignore) {
                current = null;
            }
        }

        return null;
    }

    function getTopLevelAncestor(layer) {
        var current = layer;

        while (current && current.parent && current.parent.typename === "Layer") {
            current = current.parent;
        }

        return current;
    }

    function captureBranchState(rootLayer) {
        var state = {
            layers: [],
            items: []
        };

        captureLayerStatesRecursive(rootLayer, state.layers);
        captureItemStates(rootLayer, state.items);
        return state;
    }

    function captureLayerStatesRecursive(layer, store) {
        var i;

        store.push({
            ref: layer,
            locked: safeRead(layer, "locked", false),
            visible: safeRead(layer, "visible", true)
        });

        for (i = 0; i < layer.layers.length; i += 1) {
            captureLayerStatesRecursive(layer.layers[i], store);
        }
    }

    function captureItemStates(rootLayer, store) {
        var i;

        for (i = 0; i < rootLayer.pageItems.length; i += 1) {
            store.push({
                ref: rootLayer.pageItems[i],
                locked: safeRead(rootLayer.pageItems[i], "locked", false),
                hidden: safeRead(rootLayer.pageItems[i], "hidden", false)
            });
        }
    }

    function captureItemState(item) {
        return {
            ref: item,
            locked: safeRead(item, "locked", false),
            hidden: safeRead(item, "hidden", false)
        };
    }

    function unlockBranchFromState(state) {
        var i;

        for (i = 0; i < state.layers.length; i += 1) {
            try {
                state.layers[i].ref.visible = true;
                state.layers[i].ref.locked = false;
            } catch (ignore1) {}
        }

        for (i = 0; i < state.items.length; i += 1) {
            try {
                state.items[i].ref.hidden = false;
                state.items[i].ref.locked = false;
            } catch (ignore2) {}
        }
    }

    function unlockItemFromState(state) {
        try {
            state.ref.hidden = false;
        } catch (ignore1) {}

        try {
            state.ref.locked = false;
        } catch (ignore2) {}
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

            if (result.length > 0) {
                return result;
            }
        }

        if (rawSelection.typename) {
            result.push(rawSelection);
        }

        return result;
    }

    function describeItem(item) {
        return [
            "typename=" + safeItemType(item),
            "name=" + getItemDisplayName(item),
            "item.layer=" + getSafeItemLayerPath(item),
            "parentChain=" + getParentChain(item)
        ].join(", ");
    }

    function describeShortItem(item) {
        return safeItemType(item) + " \"" + getItemDisplayName(item) + "\" on " + getSafeItemLayerPath(item);
    }

    function safeItemType(item) {
        try {
            return item.typename || "[unknown]";
        } catch (ignore) {
            return "[unknown]";
        }
    }

    function getItemDisplayName(item) {
        var name = "";

        try {
            name = item.name;
        } catch (ignore1) {}

        if (!name || name === "") {
            try {
                name = item.typename;
            } catch (ignore2) {
                name = "Selected Object";
            }
        }

        return sanitizeName(name);
    }

    function getSafeItemLayerPath(item) {
        try {
            return getLayerPath(item.layer);
        } catch (ignore) {
            return "[no layer]";
        }
    }

    function getParentChain(item) {
        var parts = [];
        var current = item;

        while (current) {
            try {
                if (current.typename === "Layer") {
                    parts.push("Layer(" + current.name + ")");
                } else {
                    parts.push(current.typename);
                }
                current = current.parent;
            } catch (ignore) {
                break;
            }
        }

        return parts.join(" -> ");
    }

    function getLayerPath(layer) {
        var parts = [];
        var current = layer;

        if (!layer) {
            return "[no layer]";
        }

        while (current && current.typename === "Layer") {
            parts.unshift(current.name);
            current = current.parent;
        }

        return parts.join(" / ");
    }

    function sanitizeName(name) {
        return String(name).replace(/[\\\/:*?"<>|]/g, "_");
    }

    function getItemKey(item) {
        var parts = [];

        try {
            parts.push(item.typename);
        } catch (ignore1) {}

        try {
            parts.push(item.name);
        } catch (ignore2) {}

        try {
            parts.push(item.uuid);
        } catch (ignore3) {}

        try {
            parts.push(item.left + "," + item.top + "," + item.width + "," + item.height);
        } catch (ignore4) {}

        return parts.join("|");
    }

    function layerExists(layer) {
        try {
            return !!layer && !!layer.parent;
        } catch (ignore) {
            return false;
        }
    }

    function itemExists(item) {
        try {
            return !!item && !!item.parent;
        } catch (ignore) {
            return false;
        }
    }

    function safeRead(obj, propertyName, fallbackValue) {
        try {
            return obj[propertyName];
        } catch (ignore) {
            return fallbackValue;
        }
    }

    function resetLog(documentRef) {
        var file = new File(LOG_PATH);

        if (file.exists) {
            try {
                file.remove();
            } catch (ignore) {}
        }

        logLine("Script version: " + SCRIPT_VERSION);
        logLine("Document: " + safeDocumentName(documentRef));
        logLine("Active layer: " + getLayerPath(documentRef.activeLayer));
        logLine("Root matrix constants: " + ROOT_LIVE + ", " + ROOT_SNAPSHOTS + ", " + ROOT_TRASH + ", " + ROOT_ARCHIVE);
    }

    function safeDocumentName(documentRef) {
        try {
            return documentRef.name;
        } catch (ignore) {
            return "[unknown document]";
        }
    }

    function logLine(message) {
        var file = new File(LOG_PATH);

        try {
            file.encoding = "UTF-8";
            file.open("a");
            file.writeln(message);
            file.close();
        } catch (ignore) {}
    }

    function restoreActiveLayer(documentRef, layerRef) {
        try {
            if (layerRef) {
                documentRef.activeLayer = layerRef;
            }
        } catch (ignore) {}
    }

    function logWarnings(warnings) {
        if (!warnings || warnings.length === 0) {
            return;
        }

        logLine("Warnings:");
        logLine(warnings.join("\n"));
        logLine("Debug log: " + LOG_PATH);
    }
}());
