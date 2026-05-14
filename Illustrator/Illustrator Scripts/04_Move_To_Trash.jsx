#target illustrator

/*
 * Moves selected real sublayers, or selected named objects directly under
 * Live, into Trash > [target name] > TN.
 */
(function () {
    var SCRIPT_VERSION = "2026-03-23 16:18";
    var LOG_PATH = Folder.temp.fsName + "/Illustrator_Move_To_Trash_Debug.log";

    if (app.documents.length === 0) {
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
        var moved = [];
        var skipped = [];
        var i;

        if (targets.length === 0) {
            return;
        }

        roots.trash.visible = true;
        roots.trash.locked = false;
        roots.snapshots.visible = true;
        roots.snapshots.locked = false;
        roots.archive.visible = true;
        roots.archive.locked = false;

        for (i = targets.length - 1; i >= 0; i -= 1) {
            var target = targets[i];
            var targetName = getTargetName(target);
            var trashContainer = ensureChildLayer(roots.trash, targetName);
            var trashEntry;
            var trashName;
            var cleanupStartLayer;

            if (target.kind === "layer") {
                if (!layerHasContent(target.layer)) {
                    skipped.push(targetName + " (no content)");
                    logLine("Skipped empty layer target: " + getLayerPath(target.layer));
                    continue;
                }

                trashName = getNextNumberedName(trashContainer, "T");

                var layerState = captureBranchState(target.layer);
                cleanupStartLayer = target.layer.parent && target.layer.parent.typename === "Layer" ? target.layer.parent : null;
                unlockBranchFromState(layerState);
                unlockAncestorLayers(target.layer);
                unlockAncestorLayers(trashContainer);
                target.layer.move(trashContainer, ElementPlacement.PLACEATBEGINNING);
                target.layer.name = trashName;
                restoreBranchState(layerState);
                removeEmptyAncestors(cleanupStartLayer);
                moved.push(targetName + " -> " + trashName);
                logLine("Moved layer target: " + targetName + " -> Trash/" + targetName + "/" + trashName);
                continue;
            }

            if (!itemExists(target.item)) {
                skipped.push(targetName + " (missing object)");
                continue;
            }

            trashEntry = trashContainer.layers.add();
            trashName = getNextNumberedName(trashContainer, "T");
            trashEntry.name = trashName;
            trashEntry.visible = true;
            trashEntry.locked = false;

            var itemState = captureItemState(target.item);
            cleanupStartLayer = getItemOwningLayer(target.item);
            unlockItemFromState(itemState);
            unlockAncestorLayers(trashEntry);
            target.item.move(trashEntry, ElementPlacement.PLACEATEND);
            restoreItemFromState(itemState);
            removeEmptyAncestors(cleanupStartLayer);
            moved.push(targetName + " -> " + trashName);
            logLine("Moved item target: " + targetName + " -> Trash/" + targetName + "/" + trashName);
        }

        if (moved.length === 0) {
            logLine("No targets moved.");
            return;
        }
        logLine("Moved: " + moved.join(" | "));
    } catch (err) {
        logLine("Exception: " + err);
        writeDebug("Move To Trash failed: " + err);
    } finally {
        if (roots) {
            setSystemLayerState(roots.trash, false, true);
            setSystemLayerState(roots.archive, false, true);
        }
        restoreActiveLayer(doc, originalActiveLayer);
    }

    function ensureRootLayers(documentRef) {
        return {
            live: ensureRootLayer(documentRef, ROOT_LIVE),
            snapshots: ensureRootLayer(documentRef, ROOT_SNAPSHOTS),
            trash: ensureRootLayer(documentRef, ROOT_TRASH),
            archive: ensureRootLayer(documentRef, ROOT_ARCHIVE)
        };
    }

    function resetLog(documentRef) {
        var file = new File(LOG_PATH);

        if (file.exists) {
            try {
                file.remove();
            } catch (ignore) {}
        }

        logLine("Move To Trash version: " + SCRIPT_VERSION);
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

    function resolveTargets(documentRef) {
        var result = [];
        var selection = normalizeSelection(documentRef.selection);
        var i;

        for (i = 0; i < selection.length; i += 1) {
            addPreferredItemTarget(result, selection[i]);
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
        var externalTarget;

        if (ownerLayer) {
            addUniqueTarget(targets, makeLayerTarget(ownerLayer));
            return;
        }

        externalTarget = getExternalLayerTargetForItem(item);
        if (externalTarget) {
            addUniqueTarget(targets, externalTarget);
            return;
        }

        if (isSnapshotEligibleItem(item)) {
            addUniqueTarget(targets, makeItemTarget(item));
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
            layer: layer
        };
    }

    function makeNamedLayerTarget(layer, targetName) {
        return {
            kind: "layer",
            key: "layer:" + getLayerPath(layer),
            name: targetName,
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
        return sanitizeName(getCanonicalTargetName(target.name));
    }

    function getExternalLayerTargetForItem(item) {
        var ownerLayer = getItemOwningLayer(item);
        var topLayer;
        var current;
        var versionLayer = null;
        var containerLayer = null;

        if (!ownerLayer) {
            return null;
        }

        topLayer = getTopLevelAncestor(ownerLayer);
        if (!topLayer || (topLayer.name !== ROOT_SNAPSHOTS && topLayer.name !== ROOT_ARCHIVE && topLayer.name !== ROOT_TRASH)) {
            return null;
        }

        current = ownerLayer;
        while (current && current !== topLayer) {
            if (isOperationalLayerName(current.name) && !versionLayer) {
                versionLayer = current;
            }

            if (current.parent === topLayer) {
                containerLayer = current;
            }

            try {
                current = current.parent;
            } catch (ignore) {
                current = null;
            }
        }

        if (versionLayer && containerLayer) {
            return makeNamedLayerTarget(versionLayer, containerLayer.name);
        }

        if (containerLayer) {
            return makeNamedLayerTarget(containerLayer, containerLayer.name);
        }

        return null;
    }

    function isOperationalLayerName(name) {
        if (!name) {
            return false;
        }

        return /^(?:T\d+|A\d+|s\d+)(?:\s.*)?$/i.test(name);
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

    function getTopLevelAncestor(layer) {
        var current = layer;
        while (current.parent && current.parent.typename === "Layer") {
            current = current.parent;
        }
        return current;
    }

    function unlockAncestorLayers(layer) {
        var current = layer;

        while (current && current.typename === "Layer") {
            try {
                current.visible = true;
            } catch (ignore1) {}

            try {
                current.locked = false;
            } catch (ignore2) {}

            current = current.parent;
        }
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

    function removeLayer(layer) {
        try {
            if (layer && layer.parent) {
                layer.remove();
            }
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

    function restoreActiveLayer(documentRef, layerRef) {
        try {
            if (layerRef) {
                documentRef.activeLayer = layerRef;
            }
        } catch (ignore) {}
    }

    function writeDebug(message) {
        try {
            $.writeln("[04_Move_To_Trash] " + message);
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
