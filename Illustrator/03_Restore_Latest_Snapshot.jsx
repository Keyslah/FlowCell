#target illustrator

/*
 * Replaces Live sublayers using the selected source sublayers from outside Live.
 * Current Live versions are moved into Trash before the incoming duplicate is
 * renamed into place.
 */
(function () {
    var SCRIPT_VERSION = "2026-03-23 16:05";
    var LOG_PATH = Folder.temp.fsName + "/Illustrator_Restore_Latest_Snapshot_Debug.log";
    var ROOT_LIVE = "Live";
    var ROOT_SNAPSHOTS = "Snapshots";
    var ROOT_TRASH = "Trash";
    var ROOT_ARCHIVE = "Archive";
    var TEMP_SUFFIX = "__incoming";

    if (app.documents.length === 0) {
        return;
    }

    var doc = app.activeDocument;
    var originalActiveLayer = doc.activeLayer;
    var roots = null;

    try {
        resetLog(doc);
        roots = ensureRootLayers(doc);
        roots.trash.visible = true;
        roots.trash.locked = false;

        var targets = resolveTargets(doc);
        var i;

        logLine("Resolved target count: " + targets.length);

        if (targets.length === 0) {
            return;
        }

        for (i = targets.length - 1; i >= 0; i -= 1) {
            replaceLiveLayer(roots, targets[i]);
        }
    } catch (err) {
        writeDebug("Restore Latest Snapshot failed: " + err);
    } finally {
        if (roots) {
            hideSnapshotDescendants(roots.snapshots);
            setSystemLayerState(roots.trash, false, true);
            setSystemLayerState(roots.archive, false, true);
            setSystemLayerState(roots.snapshots, true, false);
        }
        restoreActiveLayer(doc, originalActiveLayer);
    }

    function replaceLiveLayer(rootLayers, target) {
        var targetName = target.name;
        var existingLiveLayer = findLiveTargetLayer(rootLayers.live, targetName);
        var directLiveItems = findDirectItemsByTargetName(rootLayers.live, targetName);
        var incomingLayer;
        var liveDisplayName = formatLiveTargetName(targetName, target.versionNote);
        var sourceCleanupLayer = target.sourceLayer && target.sourceLayer.parent && target.sourceLayer.parent.typename === "Layer"
            ? target.sourceLayer.parent
            : null;

        if (!layerExists(target.sourceLayer)) {
            logLine("Skipped " + targetName + ": missing source layer");
            return;
        }

        removeIncomingLayers(rootLayers.live, targetName);
        incomingLayer = createIncomingLayer(rootLayers.live, targetName);
        copySourceLayerInto(target.sourceLayer, incomingLayer);
        removeEmptyAncestors(sourceCleanupLayer);

        if (existingLiveLayer) {
            moveLayerBeforeSibling(incomingLayer, existingLiveLayer);
            moveLayerToTrash(rootLayers.trash, targetName, existingLiveLayer);
        }

        if (directLiveItems.length > 0) {
            moveItemsToTrash(rootLayers.trash, targetName, directLiveItems);
        }

        incomingLayer.name = liveDisplayName;
        incomingLayer.visible = true;
        incomingLayer.locked = false;
        logLine("Restored target into Live/" + liveDisplayName);
    }

    function moveLayerBeforeSibling(layerToMove, siblingLayer) {
        try {
            layerToMove.move(siblingLayer, ElementPlacement.PLACEBEFORE);
            logLine("Moved incoming layer before " + siblingLayer.name);
        } catch (ignore) {}
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

    function ensureChildLayer(parentLayer, layerName) {
        var child = findChildLayerByName(parentLayer, layerName);
        if (child) {
            child.visible = true;
            child.locked = false;
            return child;
        }

        child = parentLayer.layers.add();
        child.name = layerName;
        child.visible = true;
        child.locked = false;
        return child;
    }

    function createIncomingLayer(parentLayer, targetName) {
        var child = parentLayer.layers.add();
        child.name = getIncomingLayerName(targetName);
        child.visible = true;
        child.locked = false;
        return child;
    }

    function resetLog(documentRef) {
        var file = new File(LOG_PATH);

        if (file.exists) {
            try {
                file.remove();
            } catch (ignore) {}
        }

        logLine("Restore Latest Snapshot version: " + SCRIPT_VERSION);
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

    function resolveTargets(documentRef) {
        var result = [];
        var selection = normalizeSelection(documentRef.selection);
        var i;

        for (i = 0; i < selection.length; i += 1) {
            addResolvedTarget(result, selection[i]);
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

    function addResolvedTarget(targets, item) {
        var resolved = resolveSourceTarget(item);
        var key;
        var i;

        if (!resolved) {
            return;
        }

        key = "restore:" + sanitizeName(getCanonicalTargetName(resolved.targetName));
        for (i = 0; i < targets.length; i += 1) {
            if (targets[i].key === key) {
                return;
            }
        }

        targets.push({
            key: key,
            name: sanitizeName(getCanonicalTargetName(resolved.targetName)),
            sourceLayer: resolved.sourceLayer,
            versionNote: resolved.versionNote || ""
        });

        logLine("Resolved source target: " + resolved.targetName + " -> " + getLayerPath(resolved.sourceLayer));
    }

    function resolveSourceTarget(item) {
        var ownerLayer = getItemOwningLayer(item);
        var topLayer;
        var current;
        var versionLayer = null;
        var contentLayer = null;
        var targetName = null;

        if (!ownerLayer) {
            return null;
        }

        topLayer = getTopLevelAncestor(ownerLayer);
        if (!topLayer || topLayer.name === ROOT_LIVE) {
            return null;
        }

        current = ownerLayer;
        while (current && current !== topLayer) {
            if (isOperationalLayerName(current.name)) {
                versionLayer = current;
                break;
            }

            try {
                current = current.parent;
            } catch (ignore) {
                current = null;
            }
        }

        if (versionLayer) {
            current = versionLayer.parent;
            while (current && current !== topLayer) {
                if (!isOperationalLayerName(current.name)) {
                    targetName = current.name;
                    break;
                }

                try {
                    current = current.parent;
                } catch (ignore2) {
                    current = null;
                }
            }

            if (!targetName) {
                targetName = versionLayer.name;
            }

            contentLayer = findPrimaryContentLayer(versionLayer, targetName);

            return {
                targetName: targetName,
                sourceLayer: contentLayer || versionLayer,
                versionNote: getVersionNote(versionLayer.name)
            };
        }

        current = ownerLayer;
        while (current && current !== topLayer) {
            if (!isOperationalLayerName(current.name)) {
                return {
                    targetName: current.name,
                    sourceLayer: current,
                    versionNote: ""
                };
            }

            try {
                current = current.parent;
            } catch (ignore3) {
                current = null;
            }
        }

        return null;
    }

    function findPrimaryContentLayer(versionLayer, targetName) {
        var i;

        if (!versionLayer) {
            return null;
        }

        for (i = 0; i < versionLayer.layers.length; i += 1) {
            if (!isOperationalLayerName(versionLayer.layers[i].name) &&
                    sanitizeName(getCanonicalTargetName(versionLayer.layers[i].name)) === sanitizeName(getCanonicalTargetName(targetName))) {
                return versionLayer.layers[i];
            }
        }

        for (i = 0; i < versionLayer.layers.length; i += 1) {
            if (!isOperationalLayerName(versionLayer.layers[i].name)) {
                return versionLayer.layers[i];
            }
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

    function isOperationalLayerName(name) {
        if (!name) {
            return false;
        }

        return /^(?:s\d+|t\d+|a\d+)(?:\s.*)?$/i.test(name);
    }

    function copySourceLayerInto(sourceLayer, targetLayer) {
        var state = captureBranchState(sourceLayer);

        unlockBranchFromState(state);
        copyLayerContents(sourceLayer, targetLayer, state);
        restoreBranchState(state);
    }

    function moveLayerToTrash(trashRoot, targetName, layer) {
        var trashContainer = ensureChildLayer(trashRoot, targetName);
        var trashName = getNextNumberedName(trashContainer, "T");
        var trashEntry = trashContainer.layers.add();
        var state = captureBranchState(layer);

        trashContainer.visible = true;
        trashContainer.locked = false;
        trashEntry.name = trashName;
        trashEntry.visible = true;
        trashEntry.locked = false;
        unlockBranchFromState(state);
        moveLayerContents(layer, trashEntry);
        restoreBranchState(state);
        removeLayer(layer);
        logLine("Moved Live/" + targetName + " to Trash/" + targetName + "/" + trashName);
    }

    function moveItemsToTrash(trashRoot, targetName, items) {
        var trashContainer = ensureChildLayer(trashRoot, targetName);
        var trashName = getNextNumberedName(trashContainer, "T");
        var trashEntry = trashContainer.layers.add();
        var itemStates = [];
        var i;

        if (!items || items.length === 0) {
            return;
        }

        trashContainer.visible = true;
        trashContainer.locked = false;
        trashEntry.name = trashName;
        trashEntry.visible = true;
        trashEntry.locked = false;

        for (i = 0; i < items.length; i += 1) {
            itemStates.push(captureItemState(items[i]));
        }

        for (i = 0; i < itemStates.length; i += 1) {
            unlockItemFromState(itemStates[i]);
        }

        for (i = items.length - 1; i >= 0; i -= 1) {
            try {
                items[i].move(trashEntry, ElementPlacement.PLACEATEND);
            } catch (ignore) {}
        }

        logLine("Moved direct Live objects for " + targetName + " to Trash/" + targetName + "/" + trashName);
    }

    function removeIncomingLayers(parentLayer, targetName) {
        var incomingName = getIncomingLayerName(targetName);
        var i;

        for (i = parentLayer.layers.length - 1; i >= 0; i -= 1) {
            if (parentLayer.layers[i].name === incomingName) {
                removeLayer(parentLayer.layers[i]);
            }
        }
    }

    function getIncomingLayerName(targetName) {
        return targetName + TEMP_SUFFIX;
    }

    function findLiveTargetLayer(parentLayer, targetName) {
        var i;

        if (!parentLayer) {
            return null;
        }

        for (i = 0; i < parentLayer.layers.length; i += 1) {
            if (sanitizeName(getCanonicalTargetName(parentLayer.layers[i].name)) === sanitizeName(getCanonicalTargetName(targetName))) {
                return parentLayer.layers[i];
            }
        }

        return null;
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

    function layerExists(layer) {
        try {
            return !!layer && !!layer.parent;
        } catch (ignore) {
            return false;
        }
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

    function unlockItemFromState(state) {
        try {
            state.ref.hidden = false;
        } catch (ignore1) {}

        try {
            state.ref.locked = false;
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
        return !!layer && (layer.layers.length > 0 || getDirectPageItems(layer).length > 0);
    }

    function findDirectItemsByTargetName(layer, targetName) {
        var result = [];
        var directItems = getDirectPageItems(layer);
        var i;

        for (i = 0; i < directItems.length; i += 1) {
            if (sanitizeName(getItemSnapshotName(directItems[i])) === sanitizeName(targetName)) {
                result.push(directItems[i]);
            }
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

    function writeDebug(message) {
        try {
            $.writeln("[03_Restore_Latest_Snapshot] " + message);
        } catch (ignore) {}

        logLine(message);
    }
}());
