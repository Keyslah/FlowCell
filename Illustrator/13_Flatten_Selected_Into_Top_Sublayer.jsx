#target illustrator

/*
 * Resolves selected objects to their deepest real sublayer when possible,
 * falls back to direct items under a root layer, flattens everything into the
 * topmost selected real sublayer, and removes emptied source layers.
 */
(function () {
    var SCRIPT_VERSION = "2026-03-25c";
    var LOG_PATH = Folder.temp.fsName + "/Illustrator_Flatten_Selected_Into_Top_Sublayer.log";
    var ROOT_LIVE = "Live";
    var ROOT_SNAPSHOTS = "Snapshots";
    var ROOT_TRASH = "Trash";
    var ROOT_ARCHIVE = "Archive";

    if (app.documents.length === 0) {
        alert("Open a document and select the objects you want to flatten first.");
        return;
    }

    var doc = app.activeDocument;
    var originalActiveLayer = doc.activeLayer;
    var selection = normalizeSelection(doc.selection);
    var resolvedTargets;
    var destinationTarget;
    var destinationState = null;
    var movedLayers = 0;
    var movedItems = 0;
    var prunedLayers = [];
    var warnings = [];

    resetLog();

    if (selection.length === 0) {
        alert("Select the objects you want to flatten first.");
        return;
    }

    try {
        resolvedTargets = resolveTargetsFromSelection(selection, warnings);
        destinationTarget = getTopmostLayerTarget(resolvedTargets);

        if (!destinationTarget) {
            logWarnings(warnings);
            alert("Select objects that belong to at least one real sublayer.");
            return;
        }

        destinationState = captureBranchState(destinationTarget.layer);
        unlockBranchFromState(destinationState);
        logLine("Destination layer: " + getLayerPath(destinationTarget.layer));

        moveTargetsIntoDestination(resolvedTargets, destinationTarget.layer);

        doc.activeLayer = destinationTarget.layer;
        restoreBranchState(destinationState);
        restoreActiveLayer(doc, destinationTarget.layer);

        logLine("Moved layers: " + movedLayers);
        logLine("Moved direct items: " + movedItems);
        logLine("Pruned layers: " + prunedLayers.length);
        logWarnings(warnings);
    } catch (err) {
        if (destinationState) {
            restoreBranchState(destinationState);
        }
        restoreActiveLayer(doc, originalActiveLayer);
        logLine("Exception: " + err);
        alert("Flatten into top sublayer failed. See log:\n" + LOG_PATH);
        return;
    }

    function moveTargetsIntoDestination(targets, destinationLayer) {
        var ordered = [];
        var i;
        var target;

        for (i = 0; i < targets.length; i += 1) {
            if (targets[i].kind === "layer" && targets[i].layer !== destinationLayer) {
                ordered.push(targets[i]);
            }
        }

        ordered.sort(compareTargetsDescending);

        for (i = 0; i < ordered.length; i += 1) {
            target = ordered[i];
            if (!layerExists(target.layer)) {
                warnings.push("Skipped missing source layer: " + target.displayName);
                continue;
            }

            moveLayerTargetIntoDestination(target, destinationLayer);
        }

        for (i = 0; i < targets.length; i += 1) {
            target = targets[i];

            if (target.kind !== "item") {
                continue;
            }

            if (!itemExists(target.item)) {
                warnings.push("Skipped missing direct item: " + target.displayName);
                continue;
            }

            moveItemTargetIntoDestination(target, destinationLayer);
        }
    }

    function moveLayerTargetIntoDestination(target, destinationLayer) {
        var sourceState = captureBranchState(target.layer);
        var cleanupStart = target.layer.parent && target.layer.parent.typename === "Layer" ? target.layer.parent : null;

        unlockBranchFromState(sourceState);
        logLine("Move layer target: " + target.displayName + " -> " + getLayerPath(destinationLayer));
        moveLayerContents(target.layer, destinationLayer);
        target.layer.remove();
        restoreBranchState(sourceState);
        movedLayers += 1;

        pruneEmptyAncestors(cleanupStart, destinationLayer);
    }

    function moveItemTargetIntoDestination(target, destinationLayer) {
        var itemState = captureItemState(target.item);

        unlockItemFromState(itemState);
        logLine("Move direct item: " + target.displayName + " -> " + getLayerPath(destinationLayer));
        target.item.move(destinationLayer, ElementPlacement.PLACEATEND);
        restoreItemState(itemState);
        movedItems += 1;
    }

    function resolveTargetsFromSelection(items, warningStore) {
        var targets = [];
        var i;
        var target;

        for (i = 0; i < items.length; i += 1) {
            logLine("Selection[" + i + "]: " + describeItem(items[i]));
            target = resolveTargetForItem(items[i], warningStore);
            if (!target) {
                continue;
            }

            addUniqueTarget(targets, target);
            logLine("Resolved target: " + target.debugLabel);
        }

        return targets;
    }

    function resolveTargetForItem(item, warningStore) {
        var ownerLayer = getItemOwningLayer(item);
        var realLayer = getDeepestRealSublayer(ownerLayer);

        if (!ownerLayer) {
            warningStore.push("Skipped item with no owning layer: " + describeShortItem(item));
            return null;
        }

        if (realLayer) {
            return makeLayerTarget(realLayer);
        }

        if (isDirectChildOfRootLayer(item, ownerLayer)) {
            return makeItemTarget(item);
        }

        warningStore.push("Skipped item with no real sublayer and no direct root parent: " + describeShortItem(item));
        return null;
    }

    function getTopmostLayerTarget(targets) {
        var candidate = null;
        var i;

        for (i = 0; i < targets.length; i += 1) {
            if (targets[i].kind !== "layer") {
                continue;
            }

            if (candidate === null || compareLayerOrder(targets[i].layer, candidate.layer) < 0) {
                candidate = targets[i];
            }
        }

        return candidate;
    }

    function getDeepestRealSublayer(ownerLayer) {
        if (!ownerLayer) {
            return null;
        }

        if (isRealSublayer(ownerLayer)) {
            return ownerLayer;
        }

        return null;
    }

    function isRealSublayer(layer) {
        return !!layer &&
            !isSystemRoot(layer);
    }

    function isDirectChildOfRootLayer(item, ownerLayer) {
        if (!item || !ownerLayer || !isSystemRoot(ownerLayer)) {
            return false;
        }

        try {
            return item.parent === ownerLayer;
        } catch (ignore) {
            return false;
        }
    }

    function makeLayerTarget(layer) {
        return {
            kind: "layer",
            layer: layer,
            displayName: getLayerPath(layer),
            debugLabel: "layer:" + getLayerPath(layer)
        };
    }

    function makeItemTarget(item) {
        return {
            kind: "item",
            item: item,
            displayName: describeShortItem(item),
            debugLabel: "item:" + describeItem(item)
        };
    }

    function addUniqueTarget(store, target) {
        var i;

        for (i = 0; i < store.length; i += 1) {
            if (target.kind === "layer" && store[i].kind === "layer" && store[i].layer === target.layer) {
                return;
            }

            if (target.kind === "item" && store[i].kind === "item" && store[i].item === target.item) {
                return;
            }
        }

        store.push(target);
    }

    function compareTargetsDescending(targetA, targetB) {
        if (targetA.kind !== "layer" || targetB.kind !== "layer") {
            return 0;
        }

        return compareLayerOrder(targetB.layer, targetA.layer);
    }

    function compareLayerOrder(layerA, layerB) {
        var pathA = getLayerIndexPath(layerA);
        var pathB = getLayerIndexPath(layerB);
        var length = Math.min(pathA.length, pathB.length);
        var i;

        for (i = 0; i < length; i += 1) {
            if (pathA[i] !== pathB[i]) {
                return pathA[i] - pathB[i];
            }
        }

        return pathA.length - pathB.length;
    }

    function getLayerIndexPath(layer) {
        var result = [];
        var current = layer;

        while (current && current.typename === "Layer") {
            result.unshift(getLayerIndex(current));
            current = current.parent && current.parent.typename === "Layer" ? current.parent : null;
        }

        return result;
    }

    function getLayerIndex(layer) {
        var siblings = getSiblingLayers(layer);
        var i;

        for (i = 0; i < siblings.length; i += 1) {
            if (siblings[i] === layer) {
                return i;
            }
        }

        return 999999;
    }

    function getSiblingLayers(layer) {
        var result = [];
        var parentRef;
        var i;

        if (!layer || !layer.parent || !layer.parent.layers) {
            return result;
        }

        parentRef = layer.parent;
        for (i = 0; i < parentRef.layers.length; i += 1) {
            result.push(parentRef.layers[i]);
        }

        return result;
    }

    function moveLayerContents(sourceLayer, targetLayer) {
        var childLayers = [];
        var directItems;
        var i;

        for (i = 0; i < sourceLayer.layers.length; i += 1) {
            childLayers.push(sourceLayer.layers[i]);
        }

        for (i = 0; i < childLayers.length; i += 1) {
            childLayers[i].move(targetLayer, ElementPlacement.PLACEATEND);
        }

        directItems = getDirectPageItems(sourceLayer);
        for (i = 0; i < directItems.length; i += 1) {
            directItems[i].move(targetLayer, ElementPlacement.PLACEATEND);
        }
    }

    function getDirectPageItems(layer) {
        var result = [];
        var i;

        for (i = 0; i < layer.pageItems.length; i += 1) {
            if (layer.pageItems[i].parent === layer) {
                result.push(layer.pageItems[i]);
            }
        }

        return result;
    }

    function pruneEmptyAncestors(startLayer, destinationLayer) {
        var current = startLayer;
        var parentLayer;

        while (current && current.typename === "Layer" && current !== destinationLayer) {
            if (!layerExists(current) || isProtectedLayer(current, destinationLayer) || !isLayerEmpty(current)) {
                break;
            }

            parentLayer = current.parent && current.parent.typename === "Layer" ? current.parent : null;
            logLine("Removing empty layer: " + getLayerPath(current));
            prunedLayers.push(getLayerPath(current));
            current.remove();
            current = parentLayer;
        }
    }

    function isLayerEmpty(layer) {
        return layer.layers.length === 0 && getDirectPageItems(layer).length === 0;
    }

    function isProtectedLayer(layer, destinationLayer) {
        if (!layer || layer === destinationLayer) {
            return true;
        }

        if (isSystemRoot(layer)) {
            return true;
        }

        return false;
    }

    function isSystemRoot(layer) {
        if (!layer || !layer.parent || layer.parent.typename !== "Document") {
            return false;
        }

        return layer.name === ROOT_LIVE ||
            layer.name === ROOT_SNAPSHOTS ||
            layer.name === ROOT_TRASH ||
            layer.name === ROOT_ARCHIVE;
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

    function restoreItemState(state) {
        try {
            if (state.ref && state.ref.parent) {
                state.ref.hidden = state.hidden;
            }
        } catch (ignore1) {}

        try {
            if (state.ref && state.ref.parent) {
                state.ref.locked = state.locked;
            }
        } catch (ignore2) {}
    }

    function restoreBranchState(state) {
        var i;

        for (i = state.layers.length - 1; i >= 0; i -= 1) {
            try {
                if (state.layers[i].ref && state.layers[i].ref.parent) {
                    state.layers[i].ref.visible = state.layers[i].visible;
                }
            } catch (ignore1) {}

            try {
                if (state.layers[i].ref && state.layers[i].ref.parent) {
                    state.layers[i].ref.locked = state.layers[i].locked;
                }
            } catch (ignore2) {}
        }

        for (i = 0; i < state.items.length; i += 1) {
            try {
                if (state.items[i].ref && state.items[i].ref.parent) {
                    state.items[i].ref.hidden = state.items[i].hidden;
                }
            } catch (ignore3) {}

            try {
                if (state.items[i].ref && state.items[i].ref.parent) {
                    state.items[i].ref.locked = state.items[i].locked;
                }
            } catch (ignore4) {}
        }
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

    function safeRead(target, propertyName, fallbackValue) {
        try {
            return target[propertyName];
        } catch (ignore) {
            return fallbackValue;
        }
    }

    function layerExists(layer) {
        try {
            return !!(layer && layer.parent);
        } catch (ignore) {
            return false;
        }
    }

    function itemExists(item) {
        try {
            return !!(item && item.parent);
        } catch (ignore) {
            return false;
        }
    }

    function getLayerPath(layer) {
        var names = [];
        var current = layer;

        while (current && current.typename === "Layer") {
            names.unshift(current.name || "<unnamed>");
            current = current.parent && current.parent.typename === "Layer" ? current.parent : null;
        }

        return names.join(" > ");
    }

    function describeItem(item) {
        var parts = [];

        if (!item) {
            return "[null item]";
        }

        try {
            parts.push("typename=" + item.typename);
        } catch (ignore1) {}

        try {
            parts.push("name=" + item.name);
        } catch (ignore2) {}

        try {
            parts.push("layer=" + getLayerPath(item.layer));
        } catch (ignore3) {}

        parts.push("parentChain=" + getParentChain(item));
        return parts.join(", ");
    }

    function describeShortItem(item) {
        var label = "";
        var ownerLayer = getItemOwningLayer(item);

        try {
            label = item.name || "";
        } catch (ignore1) {}

        return item.typename + (label ? ' "' + label + '"' : "") + (ownerLayer ? " on " + getLayerPath(ownerLayer) : "");
    }

    function getParentChain(item) {
        var parts = [];
        var current = item;

        while (current) {
            try {
                if (current.typename === "Layer") {
                    parts.push("Layer(" + current.name + ")");
                } else {
                    parts.push(current.typename + (current.name ? "(" + current.name + ")" : ""));
                }
                current = current.parent;
            } catch (ignore) {
                break;
            }
        }

        return parts.join(" -> ");
    }

    function resetLog() {
        var file = new File(LOG_PATH);

        if (file.exists) {
            try {
                file.remove();
            } catch (ignore) {}
        }

        logLine("Flatten Selected Into Top Sublayer version: " + SCRIPT_VERSION);
        logLine("Document: " + doc.name);
    }

    function logWarnings(store) {
        var i;

        for (i = 0; i < store.length; i += 1) {
            logLine("Warning: " + store[i]);
        }
    }

    function logLine(message) {
        var file = new File(LOG_PATH);

        if (!file.open("a")) {
            return;
        }

        file.writeln(message);
        file.close();
    }

    function restoreActiveLayer(documentRef, layerRef) {
        try {
            if (layerRef) {
                documentRef.activeLayer = layerRef;
            }
        } catch (ignore) {}
    }
}());
