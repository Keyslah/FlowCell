#target illustrator

/*
 * Saves selected Live targets into 3D > [name] > dN, hides the matching
 * Live targets, and makes the new 3D entries visible and editable.
 */
(function () {
    var SCRIPT_VERSION = "2026-03-25 3D hide old/live";
    var LOG_PATH = Folder.temp.fsName + "/Illustrator_Save_3D_Debug.log";

    if (app.documents.length === 0) {
        logLine("Run " + SCRIPT_VERSION + " aborted: no open document.");
        return;
    }

    var ROOT_LIVE = "Live";
    var ROOT_SNAPSHOTS = "Snapshots";
    var ROOT_3D = "3D";
    var ROOT_TRASH = "Trash";
    var ROOT_ARCHIVE = "Archive";

    var doc = app.activeDocument;
    var originalActiveLayer = doc.activeLayer;
    var activatedLayer = null;
    var roots = null;

    try {
        resetLog(doc);
        roots = ensureRootLayers(doc);
        var targets = resolveTargets(doc);
        var report = [];
        var i;

        logLine("Resolved target count: " + targets.length);

        roots.threeD.visible = true;
        roots.threeD.locked = false;

        for (i = targets.length - 1; i >= 0; i -= 1) {
            var target = targets[i];
            var targetName = getTargetName(target);
            var targetNote = getTargetDisplayNote(target.name);
            var threeDContainer = ensureChildLayer(roots.threeD, targetName);
            var threeDEntry = threeDContainer.layers.add();
            var versionName = getNextNumberedName(threeDContainer, "d");
            var sourceState;

            threeDContainer.visible = true;
            threeDContainer.locked = false;
            threeDEntry.name = formatVersionName(versionName, targetNote);
            threeDEntry.visible = true;
            threeDEntry.locked = false;

            if (target.kind === "layer") {
                sourceState = captureBranchState(target.layer);
                unlockBranchFromState(sourceState);
                copyLayerContents(target.layer, threeDEntry, sourceState);
                restoreBranchState(sourceState);
                unlockBranch(threeDEntry);
                hideLiveTargetLayer(target.layer);
            } else if (target.kind === "item") {
                sourceState = captureItemState(target.item);
                unlockItemFromState(sourceState);
                copySingleItem(target.item, threeDEntry, sourceState);
                restoreItemFromState(sourceState);
                unlockBranch(threeDEntry);
                hideLiveTargetItem(target.item);
            } else {
                throw new Error("Unsupported target kind: " + target.kind);
            }

            hidePrevious3DVersions(threeDContainer, threeDEntry);

            activatedLayer = threeDEntry;
            report.push(targetName + " -> " + threeDEntry.name);
            logLine("Saved 3D branch: " + targetName + " -> " + threeDEntry.name);
        }

        syncContainerOrderToLive(roots.threeD, roots.live);

        if (targets.length > 0) {
            hideSourceLayer(roots.live);
        }
    } catch (err) {
        logLine("Exception: " + err);
    } finally {
        if (roots) {
            setSystemLayerState(roots.trash, false, true);
            setSystemLayerState(roots.archive, false, true);
            setSystemLayerState(roots.threeD, true, false);
        }

        if (activatedLayer) {
            restoreActiveLayer(doc, activatedLayer);
        } else {
            restoreActiveLayer(doc, originalActiveLayer);
        }
    }

    function resetLog(documentRef) {
        var file = new File(LOG_PATH);

        if (file.exists) {
            try {
                file.remove();
            } catch (ignore) {}
        }

        logLine("Save 3D version: " + SCRIPT_VERSION);
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
            threeD: ensureRootLayer(documentRef, ROOT_3D),
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
        var targetKey = getContainerKey(layerName);

        if (!parentLayer) {
            return null;
        }

        for (i = 0; i < parentLayer.layers.length; i += 1) {
            if (getContainerKey(parentLayer.layers[i].name) === targetKey) {
                return parentLayer.layers[i];
            }
        }

        return null;
    }

    function syncContainerOrderToLive(threeDRoot, liveRoot) {
        var liveOrder = collectLiveTargetOrder(liveRoot);
        var containerLayers = [];
        var preferred = [];
        var fallback = [];
        var orderedLayers = [];
        var i;

        if (!threeDRoot || !liveRoot) {
            return;
        }

        for (i = 0; i < threeDRoot.layers.length; i += 1) {
            containerLayers.push(threeDRoot.layers[i]);
        }

        for (i = 0; i < containerLayers.length; i += 1) {
            var liveIndex = getLiveOrderIndex(liveOrder, containerLayers[i].name);

            if (liveIndex >= 0) {
                preferred.push({
                    layer: containerLayers[i],
                    liveIndex: liveIndex
                });
            } else {
                fallback.push(containerLayers[i]);
            }
        }

        preferred.sort(function (a, b) {
            return a.liveIndex - b.liveIndex;
        });

        for (i = 0; i < preferred.length; i += 1) {
            orderedLayers.push(preferred[i].layer);
        }

        for (i = 0; i < fallback.length; i += 1) {
            orderedLayers.push(fallback[i]);
        }

        reorderChildLayersTopToBottom(orderedLayers);
    }

    function collectLiveTargetOrder(liveRoot) {
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
        var normalizedLayer;
        var i;

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
        var targetKey = getContainerKey(layerName);

        for (i = 0; i < order.length; i += 1) {
            if (getContainerKey(order[i]) === targetKey) {
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

    function addPreferredItemTarget(targets, item) {
        var ownerLayer = getDeepestEligibleLayerForItem(item);

        if (ownerLayer) {
            addUniqueTarget(targets, makeLayerTarget(ownerLayer));
            return;
        }

        if (isLiveEligibleItem(item)) {
            addUniqueTarget(targets, makeItemTarget(item));
        }
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

        return /^(?:T\d+|A\d+|s\d+|d\d+)(?:\s.*)?$/i.test(name);
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
            name: getItemTargetName(item),
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

    function isEligibleTargetLayer(layer) {
        var top;

        if (!layer) {
            return false;
        }

        top = getTopLevelAncestor(layer);
        if (!top || top.name !== ROOT_LIVE) {
            return false;
        }

        if (layer.parent && layer.parent.typename === "Document" && layer.name === ROOT_LIVE) {
            return false;
        }

        return true;
    }

    function isLiveEligibleItem(item) {
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
        return top && top.name === ROOT_LIVE && layer === top;
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

    function copyLayerContents(sourceLayer, targetLayer, sourceState) {
        var childLayers = [];
        var directItems = getDirectPageItems(sourceLayer);
        var i;

        for (i = 0; i < sourceLayer.layers.length; i += 1) {
            if (!shouldSkipChildLayer(sourceLayer.layers[i])) {
                childLayers.push(sourceLayer.layers[i]);
            }
        }

        for (i = 0; i < childLayers.length; i += 1) {
            copyChildLayer(childLayers[i], targetLayer, sourceState);
        }

        for (i = 0; i < directItems.length; i += 1) {
            copyPageItem(directItems[i], targetLayer, sourceState);
        }
    }

    function shouldSkipChildLayer(layer) {
        if (!layer) {
            return true;
        }

        return isOperationalLayerName(layer.name);
    }

    function copyChildLayer(sourceChild, targetParent, sourceState) {
        var desiredState = findLayerState(sourceState, sourceChild);
        var targetChild = targetParent.layers.add();

        targetChild.name = sourceChild.name;
        targetChild.visible = true;
        targetChild.locked = false;

        try {
            targetChild.move(targetParent, ElementPlacement.PLACEATEND);
        } catch (ignore1) {}

        copyLayerContents(sourceChild, targetChild, sourceState);

        if (desiredState) {
            targetChild.visible = desiredState.visible;
            targetChild.locked = desiredState.locked;
        }
    }

    function copyPageItem(sourceItem, targetLayer, sourceState) {
        var desiredState = findItemState(sourceState, sourceItem);
        var duplicate = sourceItem.duplicate(targetLayer, ElementPlacement.PLACEATEND);

        if (desiredState) {
            try {
                duplicate.hidden = desiredState.hidden;
            } catch (ignore2) {}

            try {
                duplicate.locked = desiredState.locked;
            } catch (ignore3) {}
        }
    }

    function copySingleItem(sourceItem, targetLayer, sourceState) {
        var duplicate = sourceItem.duplicate(targetLayer, ElementPlacement.PLACEATEND);

        try {
            duplicate.hidden = sourceState.hidden;
        } catch (ignore1) {}

        try {
            duplicate.locked = sourceState.locked;
        } catch (ignore2) {}
    }

    function unlockBranch(rootLayer) {
        var i;

        if (!rootLayer) {
            return;
        }

        try {
            rootLayer.visible = true;
        } catch (ignore1) {}

        try {
            rootLayer.locked = false;
        } catch (ignore2) {}

        for (i = 0; i < rootLayer.pageItems.length; i += 1) {
            try {
                rootLayer.pageItems[i].hidden = false;
            } catch (ignore3) {}

            try {
                rootLayer.pageItems[i].locked = false;
            } catch (ignore4) {}
        }

        for (i = 0; i < rootLayer.layers.length; i += 1) {
            unlockBranch(rootLayer.layers[i]);
        }
    }

    function hidePrevious3DVersions(containerLayer, visibleLayer) {
        var i;

        if (!containerLayer) {
            return;
        }

        for (i = 0; i < containerLayer.layers.length; i += 1) {
            if (containerLayer.layers[i] === visibleLayer) {
                continue;
            }

            hideSourceLayer(containerLayer.layers[i]);
        }
    }

    function hideLiveTargetLayer(layer) {
        var liveBranch = getTopLevelLiveChild(layer);

        if (liveBranch) {
            hideSourceLayer(liveBranch);
            return;
        }

        hideSourceLayer(layer);
    }

    function hideLiveTargetItem(item) {
        var liveBranch;
        var itemLayer = getItemOwningLayer(item);

        if (itemLayer) {
            liveBranch = getTopLevelLiveChild(itemLayer);
            if (liveBranch && liveBranch !== itemLayer) {
                hideSourceLayer(liveBranch);
                return;
            }
        }

        hideSourceItem(item);
    }

    function getTopLevelLiveChild(layer) {
        var current = layer;

        if (!layer) {
            return null;
        }

        while (current.parent && current.parent.typename === "Layer") {
            if (current.parent.name === ROOT_LIVE) {
                return current;
            }

            current = current.parent;
        }

        return null;
    }

    function hideSourceLayer(layer) {
        try {
            layer.visible = false;
        } catch (ignore1) {}

        try {
            layer.locked = false;
        } catch (ignore2) {}
    }

    function hideSourceItem(item) {
        try {
            item.hidden = true;
        } catch (ignore1) {}

        try {
            item.locked = false;
        } catch (ignore2) {}
    }

    function getItemTargetName(item) {
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

    function getContainerKey(name) {
        return sanitizeName(getCanonicalTargetName(name)).toLowerCase();
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
