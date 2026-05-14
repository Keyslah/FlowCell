// Description: Runs 02 Back From Previous Snapshot.
#target illustrator

/*
 * Moves current live content for selected real sublayers, or selected named
 * objects directly under Live, into Trash and restores the latest saved
 * snapshot from Snapshots > [target name] > the highest sN, removing that
 * snapshot entry so repeated runs step backward through the stack.
 */
(function () {
    var SCRIPT_VERSION = "2026-03-23 14:54";
    var LOG_PATH = Folder.temp.fsName + "/Illustrator_Back_From_Previous_Snapshot_Debug.log";

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
        var targets = resolveTargets(doc, roots.live);
        var restored = [];
        var skipped = [];
        var i;

        if (targets.length === 0) {
            logLine("No eligible targets resolved.");
            return;
        }

        logLine("Resolved target count: " + targets.length);

        roots.snapshots.visible = true;
        roots.snapshots.locked = false;
        roots.trash.visible = true;
        roots.trash.locked = false;

        for (i = targets.length - 1; i >= 0; i -= 1) {
            try {
                var target = targets[i];
                var targetName = getTargetName(target);
                var snapshotContainer = findChildLayerByName(roots.snapshots, targetName);
                var latestSnapshot = getHighestNumberedChild(snapshotContainer, "s");
                var latestSnapshotName = latestSnapshot ? latestSnapshot.name : "[none]";
                var latestSnapshotNote = latestSnapshot ? getVersionNote(latestSnapshot.name) : "";
                var layerDestination;

                logLine("Target: " + describeTarget(target));
                logLine("Snapshot container: " + targetName + " -> " + (snapshotContainer ? getLayerPath(snapshotContainer) : "[missing]"));
                logLine("Latest snapshot chosen: " + latestSnapshotName);

                if (!latestSnapshot) {
                    skipped.push(targetName + " (no snapshot)");
                    continue;
                }

                if (target.kind === "layer") {
                    layerDestination = getRestoreDestinationLayerForTarget(target, roots.live);

                    if (layerHasContent(layerDestination)) {
                        var trashContainer = ensureChildLayer(roots.trash, targetName);
                        var trashEntry;
                        var trashName;
                        var liveState = captureBranchState(layerDestination);

                        trashContainer.visible = true;
                        trashContainer.locked = false;
                        trashEntry = trashContainer.layers.add();
                        trashName = getNextNumberedName(trashContainer, "T");
                        trashEntry.name = trashName;
                        trashEntry.visible = true;
                        trashEntry.locked = false;

                        unlockBranchFromState(liveState);
                        moveLayerContents(layerDestination, trashEntry);
                        restoreBranchState(liveState);
                    }

                    clearLayerContents(layerDestination);

                    var layerSnapshotState = captureBranchState(latestSnapshot);
                    var snapshotCleanupLayer = latestSnapshot.parent && latestSnapshot.parent.typename === "Layer" ? latestSnapshot.parent : null;
                    unlockBranchFromState(layerSnapshotState);
                    copyLayerContents(latestSnapshot, layerDestination, layerSnapshotState);
                    removeLayer(latestSnapshot);
                    removeEmptyAncestors(snapshotCleanupLayer);

                    if (layerDestination.parent === roots.live) {
                        layerDestination.name = formatLiveTargetName(targetName, latestSnapshotNote);
                    }
                    layerDestination.visible = true;
                    layerDestination.locked = false;
                    restored.push(targetName + " <- " + latestSnapshotName);
                    continue;
                }

                if (!itemExists(target.item)) {
                    skipped.push(targetName + " (missing object)");
                    continue;
                }

                var itemTrashContainer = ensureChildLayer(roots.trash, targetName);
                var itemTrashEntry;
                var itemTrashName;
                var destinationLayer = getRestoreDestinationLayer(target.item, roots.live);
                var itemState = captureItemState(target.item);

                itemTrashContainer.visible = true;
                itemTrashContainer.locked = false;
                itemTrashEntry = itemTrashContainer.layers.add();
                itemTrashName = getNextNumberedName(itemTrashContainer, "T");
                itemTrashEntry.name = itemTrashName;
                itemTrashEntry.visible = true;
                itemTrashEntry.locked = false;

                unlockItemFromState(itemState);
                target.item.move(itemTrashEntry, ElementPlacement.PLACEATEND);
                restoreItemFromState(itemState);

                var itemSnapshotState = captureBranchState(latestSnapshot);
                var itemSnapshotCleanupLayer = latestSnapshot.parent && latestSnapshot.parent.typename === "Layer" ? latestSnapshot.parent : null;
                unlockBranchFromState(itemSnapshotState);
                copyLayerContents(latestSnapshot, destinationLayer, itemSnapshotState);
                removeLayer(latestSnapshot);
                removeEmptyAncestors(itemSnapshotCleanupLayer);

                destinationLayer.visible = true;
                destinationLayer.locked = false;
                restored.push(targetName + " <- " + latestSnapshotName);
            } catch (targetErr) {
                logLine("Target exception: " + targetErr);
                skipped.push(getTargetName(targets[i]) + " (" + targetErr + ")");
            }
        }

        logLine("Restored: " + restored.join(" | "));
        if (skipped.length > 0) {
            logLine("Skipped: " + skipped.join(" | "));
        }

        if (restored.length === 0) {
            return;
        }
    } catch (err) {
        logLine("Exception: " + err);
        writeDebug("Back From Previous Snapshot failed: " + err + " | log: " + LOG_PATH);
    } finally {
        if (roots) {
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

        logLine("Back From Previous Snapshot version: " + SCRIPT_VERSION);
        logLine("Document: " + safeDocName(documentRef));
        logLine("Active layer: " + getLayerPath(documentRef.activeLayer));
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

    function findChildLayerByName(parentLayer, layerName) {
        var i;
        if (!parentLayer) {
            return null;
        }

        for (i = 0; i < parentLayer.layers.length; i += 1) {
            if (parentLayer.layers[i].name === layerName) {
                return parentLayer.layers[i];
            }
        }
        return null;
    }

    function resolveTargets(documentRef, liveRoot) {
        var result = [];
        var selection = normalizeSelection(documentRef.selection);
        var i;

        logLine("Normalized selection count: " + selection.length);

        if (liveRoot) {
            collectDeepestSelectedLayerTargets(liveRoot, result);
            if (result.length > 0) {
                logLine("Resolved Live-layer target count: " + result.length);
            }
        }

        for (i = 0; i < selection.length; i += 1) {
            logLine("Selection[" + i + "]: " + describeItem(selection[i]));

            if (liveRoot && isDirectChildOfLayer(selection[i], liveRoot)) {
                logLine("Resolved direct Live item target: " + describeItem(selection[i]));
                addUniqueTarget(result, makeItemTarget(selection[i]));
                continue;
            }

            if (result.length === 0) {
                addPreferredItemTarget(result, selection[i]);
            }
        }

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

        if (isEligibleTargetLayer(layer) && layerHasSelectedArtwork(layer)) {
            addUniqueTarget(targets, makeLayerTarget(layer));
            return true;
        }

        return false;
    }

    function addPreferredItemTarget(targets, item) {
        var ownerLayer = getDeepestEligibleLayerForItem(item);
        var externalContainerLayer;

        if (ownerLayer) {
            logLine("Resolved layer target from item: " + getLayerPath(ownerLayer));
            addUniqueTarget(targets, makeLayerTarget(ownerLayer));
            return;
        }

        externalContainerLayer = getExternalContainerLayerForItem(item);
        if (externalContainerLayer) {
            logLine("Resolved external container target from item: " + getLayerPath(externalContainerLayer));
            addUniqueTarget(targets, makeLayerTarget(externalContainerLayer));
            return;
        }

        if (isSnapshotEligibleItem(item)) {
            logLine("Resolved direct item target: " + describeItem(item));
            addUniqueTarget(targets, makeItemTarget(item));
        }
    }

    function isDirectChildOfLayer(item, layer) {
        if (!item || !layer) {
            return false;
        }

        try {
            return item.layer === layer && item.parent === layer;
        } catch (ignore) {
            return false;
        }
    }

    function getDeepestEligibleLayerForItem(item) {
        var ownerLayer = getItemOwningLayer(item);
        var topLayer;
        var resolvedLayer;

        if (!ownerLayer) {
            return null;
        }

        if (isEligibleTargetLayer(ownerLayer)) {
            return ownerLayer;
        }

        topLayer = getTopLevelAncestor(ownerLayer);
        resolvedLayer = findDeepestContainingEligibleLayer(topLayer, item);
        if (resolvedLayer) {
            return resolvedLayer;
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

    function makeLayerTarget(layer) {
        return {
            kind: "layer",
            key: "layer:" + getLayerPath(layer),
            name: layer.name,
            layer: layer,
            rootName: getTopLevelAncestor(layer).name
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
        return sanitizeName(getCanonicalTargetName(target.name));
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

    function getRestoreDestinationLayerForTarget(target, liveRoot) {
        if (target.kind === "layer" && target.rootName === ROOT_LIVE) {
            return target.layer;
        }

        return ensureChildLayer(liveRoot, getTargetName(target));
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

    function getExternalContainerLayerForItem(item) {
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

        if (topLayer.name !== ROOT_TRASH && topLayer.name !== ROOT_ARCHIVE && topLayer.name !== ROOT_SNAPSHOTS) {
            return null;
        }

        current = ownerLayer;
        while (current.parent && current.parent.typename === "Layer" && current.parent !== topLayer) {
            current = current.parent;
        }

        return current;
    }

    function isOperationalLayerName(name) {
        if (!name) {
            return false;
        }

        return /^(?:T\d+|A\d+|s\d+)(?:\s.*)?$/i.test(name);
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

        while (current && current.typename === "Layer") {
            parts.unshift(current.name);
            current = current.parent;
        }

        return parts.join(" / ");
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

    function sanitizeName(name) {
        return String(name).replace(/[\\\/:*?"<>|]/g, "_");
    }

    function getCanonicalTargetName(name) {
        return String(name).replace(/\s+\([^()]*\)\s*$/, "");
    }

    function getVersionNote(name) {
        var rawMatch = String(name).match(/^[sStTaA]\d+\s+(.+)$/);
        var wrappedMatch;
        var rawNote;

        if (!rawMatch) {
            return "";
        }

        rawNote = trimText(rawMatch[1]);
        wrappedMatch = rawNote.match(/^\((.*)\)$/);
        if (wrappedMatch) {
            return trimText(wrappedMatch[1]);
        }

        return rawNote;
    }

    function formatLiveTargetName(targetName, note) {
        return note ? targetName + " (" + note + ")" : targetName;
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

    function getHighestNumberedChild(parentLayer, prefix) {
        var highestLayer = null;
        var highestValue = -1;
        var i;

        if (!parentLayer) {
            return null;
        }

        for (i = 0; i < parentLayer.layers.length; i += 1) {
            var value = getNumberedLayerValue(parentLayer.layers[i].name, prefix);
            if (value > highestValue) {
                highestValue = value;
                highestLayer = parentLayer.layers[i];
            }
        }

        return highestLayer;
    }

    function getPreviousNumberedChild(parentLayer, prefix) {
        var ranked = [];
        var i;

        if (!parentLayer) {
            return null;
        }

        for (i = 0; i < parentLayer.layers.length; i += 1) {
            var value = getNumberedLayerValue(parentLayer.layers[i].name, prefix);
            if (value > 0) {
                ranked.push({
                    layer: parentLayer.layers[i],
                    value: value
                });
            }
        }

        if (ranked.length < 2) {
            return null;
        }

        ranked.sort(function (a, b) {
            return b.value - a.value;
        });

        return ranked[1].layer;
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

    function layerHasContent(layer) {
        return layer.layers.length > 0 || getDirectPageItems(layer).length > 0;
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

    function clearLayerContents(layer) {
        var state = captureBranchState(layer);
        unlockBranchFromState(state);

        while (layer.pageItems.length > 0) {
            layer.pageItems[0].remove();
        }

        while (layer.layers.length > 0) {
            layer.layers[0].remove();
        }

        layer.visible = true;
        layer.locked = false;
    }

    function removeLayer(layer) {
        var state;

        if (!layerExists(layer)) {
            return;
        }

        state = captureBranchState(layer);
        unlockBranchFromState(state);

        try {
            layer.remove();
        } catch (ignore) {}
    }

    function removeEmptyAncestors(layer) {
        var current = layer;
        var parentLayer;

        while (current && current.typename === "Layer" && !isSystemRoot(current)) {
            if (layerHasContent(current)) {
                break;
            }

            parentLayer = current.parent && current.parent.typename === "Layer" ? current.parent : null;
            removeLayer(current);
            current = parentLayer;
        }
    }

    function copyLayerContents(sourceLayer, targetLayer, sourceState) {
        var childLayers = [];
        var directItems = getDirectPageItems(sourceLayer);
        var i;

        for (i = sourceLayer.layers.length - 1; i >= 0; i -= 1) {
            childLayers.push(sourceLayer.layers[i]);
        }

        for (i = 0; i < childLayers.length; i += 1) {
            copyChildLayer(childLayers[i], targetLayer, sourceState);
        }

        for (i = directItems.length - 1; i >= 0; i -= 1) {
            copyPageItem(directItems[i], targetLayer, sourceState);
        }
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

    function getRestoreDestinationLayer(item, liveRoot) {
        try {
            if (item && item.layer && getTopLevelAncestor(item.layer).name === ROOT_LIVE) {
                return item.layer;
            }
        } catch (ignore) {}

        return liveRoot;
    }

    function itemExists(item) {
        try {
            return !!item && !!item.parent;
        } catch (ignore) {
            return false;
        }
    }

    function layerExists(layer) {
        try {
            return !!layer && !!layer.parent;
        } catch (ignore) {
            return false;
        }
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

    function safeRead(obj, propertyName, fallbackValue) {
        try {
            return obj[propertyName];
        } catch (ignore) {
            return fallbackValue;
        }
    }

    function restoreActiveLayer(documentRef, layerRef) {
        try {
            if (layerRef) {
                documentRef.activeLayer = layerRef;
            }
        } catch (ignore) {}
    }

    function writeDebug(message) {
        try {
            $.writeln("[02_Back_From_Previous_Snapshot] " + message);
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

    function isSystemRoot(layer) {
        if (!layer || !layer.parent || layer.parent.typename !== "Document") {
            return false;
        }

        return layer.name === ROOT_LIVE || layer.name === ROOT_SNAPSHOTS ||
            layer.name === ROOT_TRASH || layer.name === ROOT_ARCHIVE;
    }
}());
