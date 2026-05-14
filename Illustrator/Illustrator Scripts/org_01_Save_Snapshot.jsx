// Description: Runs 01 Save Snapshot.
#target illustrator

/*
 * Saves the current contents of the deepest sublayers containing the selected
 * objects into Snapshots > [sublayer name] > sN.
 */
(function () {
    var SCRIPT_VERSION = "2026-03-25 01:34";
    var LOG_PATH = Folder.temp.fsName + "/Illustrator_Save_Snapshot_Debug.log";

    if (app.documents.length === 0) {
        logLine("Run " + SCRIPT_VERSION + " aborted: no open document.");
        return;
    }

    var ROOT_LIVE = "Live";
    var ROOT_SNAPSHOTS = "Snapshots";
    var ROOT_TRASH = "Trash";
    var ROOT_ARCHIVE = "Archive";

    var doc = app.activeDocument;
    var originalActiveLayer = doc.activeLayer;
    var roots = null;

    try {
        resetLog(doc);
        roots = ensureRootLayers(doc);
        var targets = resolveTargets(doc);
        var report = [];
        var i;

        logLine("Resolved target count: " + targets.length);

        roots.snapshots.visible = true;
        roots.snapshots.locked = false;

        if (targets.length === 0) {
            logLine("No eligible target layers found. Checking existing Snapshots order only.");
        } else {
            for (i = targets.length - 1; i >= 0; i -= 1) {
                var target = targets[i];
                var snapshotContainer = ensureChildLayer(roots.snapshots, getTargetName(target));
                var snapshotEntry;
                var snapshotName;
                var sourceState;

                snapshotContainer.visible = true;
                snapshotContainer.locked = false;
                snapshotEntry = snapshotContainer.layers.add();
                snapshotName = formatVersionName(getNextNumberedName(snapshotContainer, "s"), getTargetDisplayNote(target.name));
                snapshotEntry.name = snapshotName;
                snapshotEntry.visible = true;
                snapshotEntry.locked = false;

                if (target.kind === "layer") {
                    sourceState = captureBranchState(target.layer);
                    unlockBranchFromState(sourceState);
                    copyLayerContents(target.layer, snapshotEntry, sourceState);
                    restoreBranchState(sourceState);
                } else if (target.kind === "item") {
                    sourceState = captureItemState(target.item);
                    unlockItemFromState(sourceState);
                    copySingleItem(target.item, snapshotEntry, sourceState);
                    restoreItemFromState(sourceState);
                } else {
                    throw new Error("Unsupported target kind: " + target.kind);
                }

                snapshotEntry.visible = false;
                snapshotEntry.locked = false;
                snapshotContainer.visible = false;
                snapshotContainer.locked = false;
                logLine("Saved snapshot: " + describeTarget(target) + " -> " + snapshotName);
                report.push(getTargetName(target) + " -> " + snapshotName);
            }
        }

        syncSnapshotOrderToLive(roots.snapshots, roots.live);

        roots.snapshots.visible = true;
        roots.snapshots.locked = false;
        logLine("Saved snapshot report: " + report.join(" | "));
    } catch (err) {
        logLine("Exception: " + err);
    } finally {
        if (roots) {
            hideSnapshotDescendants(roots.snapshots);
            setSystemLayerState(roots.trash, false, true);
            setSystemLayerState(roots.archive, false, true);
            setSystemLayerState(roots.snapshots, true, false);
        }
        restoreActiveLayer(doc, originalActiveLayer);
    }

    function resetLog(documentRef) {
        var file = new File(LOG_PATH);

        if (file.exists) {
            try {
                file.remove();
            } catch (ignore) {}
        }

        logLine("Save Snapshot version: " + SCRIPT_VERSION);
        logLine("Document: " + safeDocName(documentRef));
        logLine("Active layer: " + getLayerPath(documentRef.activeLayer));
        logLine("Raw selection type: " + describeValue(documentRef.selection));
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

    function safeDocName(documentRef) {
        try {
            return documentRef.name;
        } catch (ignore) {
            return "[unknown document]";
        }
    }

    function describeValue(value) {
        var parts = [];

        if (value === null) {
            return "null";
        }

        if (typeof value === "undefined") {
            return "undefined";
        }

        try {
            if (value.typename) {
                parts.push("typename=" + value.typename);
            }
        } catch (ignore1) {}

        try {
            if (typeof value.length === "number") {
                parts.push("length=" + value.length);
            }
        } catch (ignore2) {}

        if (parts.length === 0) {
            parts.push(typeof value);
        }

        return parts.join(", ");
    }

    function ensureRootLayers(documentRef) {
        return {
            live: ensureRootLayer(documentRef, ROOT_LIVE),
            snapshots: ensureRootLayer(documentRef, ROOT_SNAPSHOTS),
            trash: ensureRootLayer(documentRef, ROOT_TRASH),
            archive: ensureRootLayer(documentRef, ROOT_ARCHIVE)
        };
    }

    function ensureRootLayer(documentRef, layerName) {
        var layer = findTopLevelLayerByName(documentRef, layerName);
        if (layer) {
            return layer;
        }

        layer = documentRef.layers.add();
        layer.name = layerName;
        layer.visible = true;
        layer.locked = false;
        return layer;
    }

    function findTopLevelLayerByName(documentRef, layerName) {
        var i;
        for (i = 0; i < documentRef.layers.length; i += 1) {
            if (documentRef.layers[i].name === layerName) {
                return documentRef.layers[i];
            }
        }
        return null;
    }

    function ensureChildLayer(parentLayer, layerName) {
        var child = findChildLayerByName(parentLayer, layerName);
        if (child) {
            return child;
        }

        child = parentLayer.layers.add();
        child.name = layerName;
        child.visible = true;
        child.locked = false;
        return child;
    }

    function syncSnapshotOrderToLive(snapshotsRoot, liveRoot) {
        var liveOrder = collectLiveSnapshotOrder(liveRoot);
        var snapshotLayers = [];
        var currentOrder = [];
        var i;
        var desiredOrder = [];
        var fallbackOrder = [];
        var orderedLayers = [];

        if (!snapshotsRoot || !liveRoot) {
            return;
        }

        for (i = 0; i < snapshotsRoot.layers.length; i += 1) {
            snapshotLayers.push(snapshotsRoot.layers[i]);
            currentOrder.push(snapshotsRoot.layers[i].name);
        }

        logLine("Live order: " + liveOrder.join(" | "));
        logLine("Current snapshot order: " + currentOrder.join(" | "));

        for (i = 0; i < snapshotLayers.length; i += 1) {
            var liveIndex = getLiveOrderIndex(liveOrder, snapshotLayers[i].name);

            if (liveIndex >= 0) {
                desiredOrder.push({
                    layer: snapshotLayers[i],
                    liveIndex: liveIndex
                });
            } else {
                fallbackOrder.push(snapshotLayers[i]);
            }
        }

        desiredOrder.sort(function (a, b) {
            return a.liveIndex - b.liveIndex;
        });

        for (i = 0; i < desiredOrder.length; i += 1) {
            orderedLayers.push(desiredOrder[i].layer);
        }

        for (i = 0; i < fallbackOrder.length; i += 1) {
            orderedLayers.push(fallbackOrder[i]);
        }

        logLine("Desired snapshot order: " + getLayerNameList(orderedLayers).join(" | "));

        if (layerOrderMatches(currentOrder, orderedLayers)) {
            logLine("Snapshot containers already match Live order.");
            return;
        }

        reorderChildLayersTopToBottom(orderedLayers);
        logLine("Snapshot containers reordered to match Live.");
    }

    function layerOrderMatches(currentOrder, orderedLayers) {
        var i;

        if (currentOrder.length !== orderedLayers.length) {
            return false;
        }

        for (i = 0; i < orderedLayers.length; i += 1) {
            if (getSnapshotContainerKey(currentOrder[i]) !== getSnapshotContainerKey(orderedLayers[i].name)) {
                return false;
            }
        }

        return true;
    }

    function collectLiveSnapshotOrder(liveRoot) {
        var result = [];
        var i;

        if (!liveRoot) {
            return result;
        }

        for (i = 0; i < liveRoot.layers.length; i += 1) {
            collectEligibleLiveTargetNames(liveRoot.layers[i], result);
        }

        return result;
    }

    function collectEligibleLiveTargetNames(layer, store) {
        var i;
        var normalizedLayer;

        normalizedLayer = normalizeTargetLayer(layer) || layer;
        if (isEligibleTargetLayer(normalizedLayer)) {
            addUniqueName(store, getTargetName(makeLayerTarget(normalizedLayer)));
        }

        for (i = 0; i < layer.layers.length; i += 1) {
            collectEligibleLiveTargetNames(layer.layers[i], store);
        }
    }

    function addUniqueName(store, name) {
        var i;

        for (i = 0; i < store.length; i += 1) {
            if (store[i] === name) {
                return;
            }
        }

        store.push(name);
    }

    function getLiveOrderIndex(order, layerName) {
        var i;
        var targetKey = getSnapshotContainerKey(layerName);

        for (i = 0; i < order.length; i += 1) {
            if (getSnapshotContainerKey(order[i]) === targetKey) {
                return i;
            }
        }

        return -1;
    }

    function reorderChildLayersTopToBottom(layersInTopToBottomOrder) {
        var i;

        for (i = layersInTopToBottomOrder.length - 1; i >= 0; i -= 1) {
            prepareLayerForMove(layersInTopToBottomOrder[i]);
            bringLayerToFront(layersInTopToBottomOrder[i]);
        }
    }

    function prepareLayerForMove(layer) {
        if (!layer) {
            return;
        }

        try {
            layer.visible = true;
        } catch (ignore1) {}

        try {
            layer.locked = false;
        } catch (ignore2) {}
    }

    function bringLayerToFront(layer) {
        try {
            layer.zOrder(ZOrderMethod.BRINGTOFRONT);
        } catch (ignore) {}
    }

    function moveLayerBeforeSibling(layerToMove, siblingLayer) {
        try {
            layerToMove.move(siblingLayer, ElementPlacement.PLACEBEFORE);
        } catch (ignore) {}
    }

    function getLayerNameList(layers) {
        var result = [];
        var i;

        for (i = 0; i < layers.length; i += 1) {
            result.push(layers[i].name);
        }

        return result;
    }

    function findChildLayerByName(parentLayer, layerName) {
        var i;
        var targetKey = getSnapshotContainerKey(layerName);
        for (i = 0; i < parentLayer.layers.length; i += 1) {
            if (getSnapshotContainerKey(parentLayer.layers[i].name) === targetKey) {
                return parentLayer.layers[i];
            }
        }
        return null;
    }

    function resolveTargets(documentRef) {
        var result = [];
        var selection = normalizeSelection(documentRef.selection);
        var i;

        logLine("Normalized selection count: " + selection.length);

        for (i = 0; i < selection.length; i += 1) {
            logLine("Selection[" + i + "]: " + describeItem(selection[i]));
        }

        for (i = 0; i < selection.length; i += 1) {
            addPreferredItemTarget(result, selection[i]);
        }

        logLine("Target count after selection resolution: " + result.length);
        return result;
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

    function addPreferredItemTarget(targets, item) {
        var ownerLayer = getDeepestEligibleLayerForItem(item);

        if (ownerLayer) {
            logLine("Resolved layer for item: " + getLayerPath(ownerLayer));
            addUniqueTarget(targets, makeLayerTarget(ownerLayer));
            return;
        }

        if (isSnapshotEligibleItem(item)) {
            logLine("Falling back to direct item target: " + describeItem(item));
            addUniqueTarget(targets, makeItemTarget(item));
            return;
        }

        logLine("Could not resolve a layer for item: " + describeItem(item));
    }

    function collectDeepestSelectedLayerTargets(container, targets) {
        var layers = container.layers;
        var i;

        for (i = 0; i < layers.length; i += 1) {
            collectDeepestSelectedLayerTargetsFromLayer(layers[i], targets);
        }
    }

    function collectDeepestSelectedLayerTargetsFromLayer(layer, targets) {
        var childMatched = false;
        var i;

        for (i = 0; i < layer.layers.length; i += 1) {
            if (collectDeepestSelectedLayerTargetsFromLayer(layer.layers[i], targets)) {
                childMatched = true;
            }
        }

        if (childMatched) {
            return true;
        }

        if (layerHasSelectedArtwork(layer)) {
            var normalizedLayer = normalizeTargetLayer(layer);
            if (normalizedLayer && isEligibleTargetLayer(normalizedLayer)) {
                logLine("Deepest selected layer found: " + getLayerPath(layer) + " -> normalized to " + getLayerPath(normalizedLayer));
                addUniqueTarget(targets, makeLayerTarget(normalizedLayer));
                return true;
            }
        }

        return false;
    }

    function normalizeTargetLayer(layer) {
        var current = layer;

        while (current && current.parent && current.parent.typename === "Layer" && isOperationalLayerName(current.name)) {
            current = current.parent;
        }

        if (current && isOperationalLayerName(current.name) && current.parent && current.parent.typename === "Layer") {
            current = current.parent;
        }

        if (current && isEligibleTargetLayer(current)) {
            return current;
        }

        return null;
    }

    function isOperationalLayerName(name) {
        if (!name) {
            return false;
        }

        return /^(?:T\d+|A\d+|s\d+)(?:\s.*)?$/i.test(name);
    }

    function getDeepestEligibleLayerForItem(item) {
        var ownerLayer = getItemOwningLayer(item);
        var topLayer;
        var resolvedLayer;

        if (!ownerLayer) {
            return null;
        }

        ownerLayer = normalizeTargetLayer(ownerLayer) || ownerLayer;

        if (isEligibleTargetLayer(ownerLayer)) {
            return ownerLayer;
        }

        topLayer = getTopLevelAncestor(ownerLayer);
        resolvedLayer = findDeepestContainingEligibleLayer(topLayer, item);
        if (resolvedLayer) {
            return normalizeTargetLayer(resolvedLayer) || resolvedLayer;
        }

        return null;
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

    function layerHasSelectedArtwork(layer) {
        var i;

        try {
            if (layer.hasSelectedArtwork) {
                return true;
            }
        } catch (ignore1) {}

        for (i = 0; i < layer.pageItems.length; i += 1) {
            try {
                if (layer.pageItems[i].selected) {
                    return true;
                }
            } catch (ignore2) {}
        }

        return false;
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

    function findDeepestContainingEligibleLayer(layer, item) {
        var i;
        var childResult;

        if (!layerContainsItem(layer, item)) {
            return null;
        }

        for (i = 0; i < layer.layers.length; i += 1) {
            childResult = findDeepestContainingEligibleLayer(layer.layers[i], item);
            if (childResult) {
                return childResult;
            }
        }

        if (isEligibleTargetLayer(layer)) {
            return layer;
        }

        return null;
    }

    function layerContainsItem(layer, item) {
        var i;

        if (!layer) {
            return false;
        }

        for (i = 0; i < layer.pageItems.length; i += 1) {
            if (layer.pageItems[i] === item) {
                return true;
            }
        }

        return false;
    }

    function makeLayerTarget(layer) {
        return {
            kind: "layer",
            key: "layer:" + getLayerPath(layer),
            name: layer.name,
            layer: layer
        };
    }

    function makeItemTarget(item) {
        return {
            kind: "item",
            key: "item:" + getItemKey(item),
            name: getItemSnapshotName(item),
            item: item
        };
    }

    function addUniqueTarget(targets, target) {
        var i;
        if (!target) {
            return;
        }

        for (i = 0; i < targets.length; i += 1) {
            if (targets[i].key === target.key) {
                return;
            }
        }

        targets.push(target);
    }

    function getTargetName(target) {
        return sanitizeSnapshotName(getCanonicalTargetName(target.name));
    }

    function describeTarget(target) {
        if (target.kind === "layer") {
            return "layer:" + getLayerPath(target.layer);
        }

        if (target.kind === "item") {
            return "item:" + describeItem(target.item);
        }

        return "[unknown target]";
    }

    function isEligibleTargetLayer(layer) {
        var top;
        if (!layer) {
            return false;
        }

        top = getTopLevelAncestor(layer);
        if (!top) {
            return false;
        }

        if (top.name === ROOT_SNAPSHOTS || top.name === ROOT_TRASH || top.name === ROOT_ARCHIVE) {
            return false;
        }

        if (layer.parent && layer.parent.typename === "Document" &&
                (layer.name === ROOT_LIVE || layer.name === ROOT_SNAPSHOTS ||
                 layer.name === ROOT_TRASH || layer.name === ROOT_ARCHIVE)) {
            return false;
        }

        return true;
    }

    function getTopLevelAncestor(layer) {
        var current = layer;
        while (current.parent && current.parent.typename === "Layer") {
            current = current.parent;
        }
        return current;
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

    function getNextNumberedName(parentLayer, prefix) {
        var maxValue = 0;
        var i;

        for (i = 0; i < parentLayer.layers.length; i += 1) {
            var value = getNumberedLayerValue(parentLayer.layers[i].name, prefix);
            if (value > maxValue) {
                maxValue = value;
            }
        }

        return prefix + (maxValue + 1);
    }

    function getNumberedLayerValue(name, prefix) {
        var match;

        if (!name) {
            return 0;
        }

        match = String(name).match(new RegExp("^" + prefix + "(\\d+)(?:\\s.*)?$", "i"));
        if (!match) {
            return 0;
        }

        return parseInt(match[1], 10) || 0;
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

    function captureItemState(item) {
        return {
            ref: item,
            locked: safeRead(item, "locked", false),
            hidden: safeRead(item, "hidden", false)
        };
    }

    function captureLayerStatesRecursive(layer, store) {
        var i;
        store.push({
            ref: layer,
            locked: layer.locked,
            visible: layer.visible
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
                locked: rootLayer.pageItems[i].locked,
                hidden: rootLayer.pageItems[i].hidden
            });
        }
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

    function restoreBranchState(state) {
        var i;
        for (i = 0; i < state.items.length; i += 1) {
            try {
                state.items[i].ref.hidden = state.items[i].hidden;
                state.items[i].ref.locked = state.items[i].locked;
            } catch (ignore1) {}
        }

        for (i = state.layers.length - 1; i >= 0; i -= 1) {
            try {
                state.layers[i].ref.visible = state.layers[i].visible;
                state.layers[i].ref.locked = state.layers[i].locked;
            } catch (ignore2) {}
        }
    }

    function restoreItemFromState(state) {
        try {
            state.ref.hidden = state.hidden;
        } catch (ignore1) {}

        try {
            state.ref.locked = state.locked;
        } catch (ignore2) {}
    }

    function findLayerState(state, layerRef) {
        var i;
        for (i = 0; i < state.layers.length; i += 1) {
            if (state.layers[i].ref === layerRef) {
                return state.layers[i];
            }
        }
        return null;
    }

    function findItemState(state, itemRef) {
        var i;
        for (i = 0; i < state.items.length; i += 1) {
            if (state.items[i].ref === itemRef) {
                return state.items[i];
            }
        }
        return null;
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

    // Illustrator layer duplication can be unreliable, so copy direct items and
    // sublayers recursively instead of duplicating the layer container itself.
    function copyLayerContents(sourceLayer, targetLayer, sourceState) {
        var childLayers = [];
        var directItems = getDirectPageItems(sourceLayer);
        var i;

        for (i = sourceLayer.layers.length - 1; i >= 0; i -= 1) {
            if (!shouldSkipChildLayer(sourceLayer.layers[i])) {
                childLayers.push(sourceLayer.layers[i]);
            }
        }

        for (i = 0; i < childLayers.length; i += 1) {
            copyChildLayer(childLayers[i], targetLayer, sourceState);
        }

        for (i = directItems.length - 1; i >= 0; i -= 1) {
            copyPageItem(directItems[i], targetLayer, sourceState);
        }
    }

    function shouldSkipChildLayer(layer) {
        if (!layer) {
            return true;
        }

        if (isOperationalLayerName(layer.name)) {
            return true;
        }

        return false;
    }

    function copyChildLayer(sourceChild, targetParent, sourceState) {
        var desiredState = findLayerState(sourceState, sourceChild);
        var targetChild = targetParent.layers.add();

        targetChild.name = sourceChild.name;
        targetChild.visible = true;
        targetChild.locked = false;

        copyLayerContents(sourceChild, targetChild, sourceState);

        if (desiredState) {
            targetChild.visible = desiredState.visible;
            targetChild.locked = desiredState.locked;
        }
    }

    function copyPageItem(sourceItem, targetLayer, sourceState) {
        var desiredState = findItemState(sourceState, sourceItem);
        var duplicate = sourceItem.duplicate(targetLayer, ElementPlacement.PLACEATBEGINNING);

        if (desiredState) {
            try {
                duplicate.hidden = desiredState.hidden;
            } catch (ignore1) {}
            try {
                duplicate.locked = desiredState.locked;
            } catch (ignore2) {}
        }
    }

    function copySingleItem(sourceItem, targetLayer, sourceState) {
        var duplicate = sourceItem.duplicate(targetLayer, ElementPlacement.PLACEATBEGINNING);

        try {
            duplicate.hidden = sourceState.hidden;
        } catch (ignore1) {}

        try {
            duplicate.locked = sourceState.locked;
        } catch (ignore2) {}
    }

    function isSnapshotEligibleItem(item) {
        var layer;
        var top;

        if (!item) {
            return false;
        }

        try {
            layer = item.layer;
        } catch (ignore1) {
            layer = null;
        }

        if (!layer) {
            return false;
        }

        top = getTopLevelAncestor(layer);
        return top && top.name === ROOT_LIVE;
    }

    function getItemSnapshotName(item) {
        var baseName = "";

        try {
            baseName = item.name;
        } catch (ignore1) {}

        if (!baseName || baseName === "") {
            try {
                baseName = item.typename;
            } catch (ignore2) {
                baseName = "Selected Object";
            }
        }

        return baseName;
    }

    function sanitizeSnapshotName(name) {
        return String(name).replace(/[\\\/:*?"<>|]/g, "_");
    }

    function getSnapshotContainerKey(name) {
        return sanitizeSnapshotName(getCanonicalTargetName(name)).toLowerCase();
    }

    function getCanonicalTargetName(name) {
        return String(name).replace(/\s+\([^()]*\)\s*$/, "");
    }

    function getTargetDisplayNote(name) {
        var match = String(name).match(/\s+\(([^()]*)\)\s*$/);
        return match ? trimText(match[1]) : "";
    }

    function formatVersionName(versionName, note) {
        return note ? versionName + " (" + note + ")" : versionName;
    }

    function trimText(text) {
        return String(text).replace(/^\s+|\s+$/g, "");
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

    function safeRead(obj, propertyName, fallbackValue) {
        try {
            return obj[propertyName];
        } catch (ignore) {
            return fallbackValue;
        }
    }

    function hideSnapshotDescendants(rootLayer) {
        var i;

        if (!rootLayer) {
            return;
        }

        for (i = 0; i < rootLayer.layers.length; i += 1) {
            hideSnapshotBranch(rootLayer.layers[i]);
        }
    }

    function hideSnapshotBranch(layer) {
        var i;

        if (!layer) {
            return;
        }

        for (i = 0; i < layer.layers.length; i += 1) {
            hideSnapshotBranch(layer.layers[i]);
        }

        try {
            layer.visible = false;
        } catch (ignore1) {}

        try {
            layer.locked = false;
        } catch (ignore2) {}
    }

    function restoreActiveLayer(documentRef, layerRef) {
        try {
            if (layerRef) {
                documentRef.activeLayer = layerRef;
            }
        } catch (ignore) {}
    }

    function setSystemLayerState(layer, visible, locked) {
        if (!layer) {
            return;
        }

        try {
            layer.visible = visible;
        } catch (ignore1) {}

        try {
            layer.locked = locked;
        } catch (ignore2) {}
    }
}());
