#target illustrator

/*
 * Prepares exactly three selected Live targets into one 3D > [name] > dN
 * copy, appends (P1)/(P2)/(P3) markers to the copied targets, then leaves
 * only P1 selected so the next recorded macro step can act on it.
 */
(function () {
    var SCRIPT_VERSION = "2026-03-27 3D macro setup";
    var LOG_PATH = Folder.temp.fsName + "/Illustrator_3D_Macro_Setup_Debug.log";

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
    var markedCopiedLayers = [];

    try {
        resetLog(doc);
        roots = ensureRootLayers(doc);
        var targets = sortTargetsTopToBottom(resolveTargets(doc), roots.live);
        var branchLayer;
        var branchName;
        var branchNote;
        var threeDContainer;
        var threeDEntry;
        var versionName;
        var sourceState;
        var i;

        ensureExactlyThreeTargets(targets);
        branchLayer = resolveSingleBranchLayer(targets);
        branchName = getTargetName(makeLayerTarget(branchLayer));
        branchNote = getTargetDisplayNote(branchLayer.name);

        logLine("Resolved target count: " + targets.length);
        logLine("Resolved branch layer: " + getLayerPath(branchLayer));

        roots.threeD.visible = true;
        roots.threeD.locked = false;
        stripTemporaryMarkersInBranch(roots.threeD);
        hideAll3DContent(roots.threeD);

        threeDContainer = ensureChildLayer(roots.threeD, branchName);
        threeDEntry = threeDContainer.layers.add();
        versionName = getNextNumberedName(threeDContainer, "d");

        threeDContainer.visible = true;
        threeDContainer.locked = false;
        threeDEntry.name = formatVersionName(versionName, branchNote);
        threeDEntry.visible = true;
        threeDEntry.locked = false;

        sourceState = captureBranchState(branchLayer);
        unlockBranchFromState(sourceState);
        copyLayerContents(branchLayer, threeDEntry, sourceState);
        restoreBranchState(sourceState);
        unlockBranch(threeDEntry);

        for (i = 0; i < targets.length; i += 1) {
            var target = targets[i];
            var copiedTarget = resolveCopiedTarget(branchLayer, threeDEntry, target);
            var marker = "P" + (i + 1);

            appendTemporaryMarkerToLayer(copiedTarget.layer, marker);
            markedCopiedLayers.push({
                marker: marker,
                layer: copiedTarget.layer,
                sourceTarget: target
            });
        }

        hideLiveTargetLayer(branchLayer);
        lockLayerBranchRecursive(branchLayer);
        hidePrevious3DVersions(threeDContainer, threeDEntry);
        selectBranchContents(doc, markedCopiedLayers[0].layer);
        activatedLayer = markedCopiedLayers[0].layer;
        logLine("Prepared 3D macro branch: " + branchName + " -> " + threeDEntry.name + " | Active marker=P1");

    } catch (err) {
        logLine("Exception: " + err);
        if (markedCopiedLayers.length > 0) {
            stripTemporaryMarkers(markedCopiedLayers);
        }
        clearSelection(doc);
        alert("3D macro setup failed: " + (err && err.message ? err.message : err));
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

    function ensureExactlyThreeTargets(targets) {
        if (targets.length !== 3) {
            throw new Error("Select exactly 3 Live targets before running 3D test.");
        }
    }

    function hideAll3DContent(rootLayer) {
        if (!rootLayer) {
            return;
        }

        hideLayerBranchRecursive(rootLayer);
        rootLayer.visible = true;
        rootLayer.locked = false;
    }

    function hideLayerBranchRecursive(layerRef) {
        var i;

        if (!layerRef) {
            return;
        }

        for (i = 0; i < layerRef.layers.length; i += 1) {
            hideLayerBranchRecursive(layerRef.layers[i]);
        }

        if (layerRef.name !== ROOT_3D) {
            hideSourceLayer(layerRef);
        }
    }

    function sortTargetsTopToBottom(targets, liveRoot) {
        var order = collectLiveTargetOrder(liveRoot);
        var sorted = targets.slice(0);

        sorted.sort(function (a, b) {
            return getLiveOrderIndex(order, getTargetName(a)) - getLiveOrderIndex(order, getTargetName(b));
        });

        return sorted;
    }

    function getMacroPlanForTargetIndex(index) {
        if (index === 0) {
            return {
                label: "3p5mm",
                wrapperPath: THREE_P5_WRAPPER,
                signalPath: THREE_P5_SIGNAL
            };
        }

        return {
            label: "p5mm",
            wrapperPath: P5_WRAPPER,
            signalPath: P5_SIGNAL
        };
    }

    function resolveSingleBranchLayer(targets) {
        var branchLayer = null;
        var i;

        for (i = 0; i < targets.length; i += 1) {
            var currentBranchLayer = getBranchLayerForTarget(targets[i]);

            if (!currentBranchLayer) {
                throw new Error("Could not resolve the shared Live branch for " + getTargetName(targets[i]) + ".");
            }

            if (!branchLayer) {
                branchLayer = currentBranchLayer;
                continue;
            }

            if (branchLayer !== currentBranchLayer) {
                throw new Error("The selected targets must belong to the same top-level Live branch.");
            }
        }

        if (!branchLayer) {
            throw new Error("No Live branch was resolved for the selected targets.");
        }

        return branchLayer;
    }

    function getBranchLayerForTarget(target) {
        var ownerLayer;

        if (!target) {
            return null;
        }

        if (target.kind === "layer") {
            ownerLayer = target.layer;
        } else if (target.kind === "item") {
            ownerLayer = getItemOwningLayer(target.item);
        } else {
            return null;
        }

        return getTopLevelLiveChild(ownerLayer) || ownerLayer;
    }

    function resolveCopiedTarget(sourceBranchLayer, copiedBranchLayer, target) {
        var relativePath;
        var copiedLayer;

        if (!target || target.kind !== "layer") {
            throw new Error("3D test currently requires layer-based targets inside the selected branch.");
        }

        relativePath = getRelativeLayerPath(sourceBranchLayer, target.layer);
        copiedLayer = findLayerByRelativePath(copiedBranchLayer, relativePath);

        if (!copiedLayer) {
            throw new Error("Could not find the copied layer for " + getLayerPath(target.layer) + ".");
        }

        return {
            kind: "layer",
            layer: copiedLayer
        };
    }

    function getRelativeLayerPath(rootLayer, targetLayer) {
        var parts = [];
        var current = targetLayer;

        while (current && current !== rootLayer && current.parent && current.parent.typename === "Layer") {
            parts.unshift(current.name);
            current = current.parent;
        }

        if (current !== rootLayer) {
            throw new Error("The selected layer is not inside the expected parent branch.");
        }

        return parts;
    }

    function findLayerByRelativePath(rootLayer, relativePath) {
        var current = rootLayer;
        var i;

        for (i = 0; i < relativePath.length; i += 1) {
            current = findExactChildLayerByName(current, relativePath[i]);
            if (!current) {
                return null;
            }
        }

        return current;
    }

    function findExactChildLayerByName(parentLayer, layerName) {
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

    function appendTemporaryMarkerToLayer(layerRef, marker) {
        if (!layerRef || !marker) {
            return;
        }

        layerRef.name = buildTemporaryMarkerName(layerRef.name, marker);
    }

    function buildTemporaryMarkerName(layerName, marker) {
        return "(" + marker + ")" + layerName;
    }

    function stripTemporaryMarkers(markedLayers) {
        var i;

        for (i = 0; i < markedLayers.length; i += 1) {
            if (!markedLayers[i] || !markedLayers[i].layer) {
                continue;
            }

            try {
                markedLayers[i].layer.name = removeTemporaryMarkerPrefix(markedLayers[i].layer.name);
            } catch (ignore) {}
        }
    }

    function stripTemporaryMarkersInBranch(rootLayer) {
        var i;

        if (!rootLayer) {
            return;
        }

        try {
            rootLayer.name = removeTemporaryMarkerPrefix(rootLayer.name);
        } catch (ignore1) {}

        for (i = 0; i < rootLayer.layers.length; i += 1) {
            stripTemporaryMarkersInBranch(rootLayer.layers[i]);
        }
    }

    function removeTemporaryMarkerPrefix(layerName) {
        return String(layerName).replace(/^\(P\d+\)/i, "");
    }

    function runMacroPlanOnMarker(documentRef, branchRootLayer, marker, plan) {
        var markedLayer;

        if (!branchRootLayer || !marker || !plan) {
            return;
        }

        markedLayer = findLayerByTemporaryMarker(branchRootLayer, marker);
        if (!markedLayer) {
            throw new Error("Could not find copied marker layer " + marker + ".");
        }

        selectBranchContents(documentRef, markedLayer);
        sleepForMacro(MACRO_PREP_SETTLE_MS);
        runRecordedMacro(plan);
        sleepForMacro(MACRO_POST_SETTLE_MS);
        clearSelection(documentRef);
    }

    function findLayerByTemporaryMarker(rootLayer, marker) {
        var i;
        var childResult;
        var expectedPrefix = "(" + marker + ")";

        if (!rootLayer) {
            return null;
        }

        if (String(rootLayer.name).indexOf(expectedPrefix) === 0) {
            return rootLayer;
        }

        for (i = 0; i < rootLayer.layers.length; i += 1) {
            childResult = findLayerByTemporaryMarker(rootLayer.layers[i], marker);
            if (childResult) {
                return childResult;
            }
        }

        return null;
    }

    function runRecordedMacro(plan) {
        var wrapper = new File(plan.wrapperPath);
        var signalFile = new File(plan.signalPath);
        var start = new Date().getTime();
        var result;

        if (!wrapper.exists) {
            throw new Error("Macro wrapper not found for " + plan.label + ": " + plan.wrapperPath);
        }

        try {
            if (signalFile.exists) {
                signalFile.remove();
            }
        } catch (ignore1) {}

        if (!wrapper.execute()) {
            throw new Error("Failed to launch macro wrapper for " + plan.label + ".");
        }

        while ((new Date().getTime() - start) < MACRO_TIMEOUT_MS) {
            if (signalFile.exists) {
                result = readSignalFile(signalFile);
                if (result && result.ready) {
                    if (result.exitCode !== 0) {
                        throw new Error(plan.label + " failed. " + result.message);
                    }

                    logLine("Macro completed: " + plan.label);
                    return;
                }
            }

            $.sleep(MACRO_POLL_MS);
        }

        throw new Error("Timed out waiting for macro " + plan.label + ".");
    }

    function readSignalFile(signalFile) {
        var contents;
        var lines;
        var result = {
            ready: false,
            exitCode: 1,
            message: ""
        };
        var i;
        var parts;
        var key;
        var value;

        try {
            signalFile.encoding = "UTF-8";
            signalFile.open("r");
            contents = signalFile.read();
            signalFile.close();
        } catch (ignore1) {
            try {
                signalFile.close();
            } catch (ignore2) {}
            return result;
        }

        if (!contents || contents === "") {
            return result;
        }

        lines = contents.split(/\r?\n/);
        for (i = 0; i < lines.length; i += 1) {
            parts = lines[i].split("=");
            if (parts.length < 2) {
                continue;
            }

            key = parts.shift().replace(/^\uFEFF/, "");
            value = parts.join("=");

            if (key === "ExitCode") {
                result.exitCode = parseInt(value, 10);
                if (isNaN(result.exitCode)) {
                    result.exitCode = 1;
                }
                result.ready = true;
            } else if (key === "Message") {
                result.message = value;
            }
        }

        return result;
    }

    function selectBranchContents(documentRef, layerRef) {
        var selectedCount;

        clearSelectionHard(documentRef);
        restoreActiveLayer(documentRef, layerRef);
        unlockBranchForMacro(layerRef);
        try {
            app.redraw();
        } catch (ignore1) {}
        selectedCount = selectBranchItemsRecursive(layerRef);
        selectedCount = trimSelectionToLayer(documentRef, layerRef);

        if (selectedCount < 1) {
            throw new Error("Nothing was copied into " + getLayerPath(layerRef) + " for macro processing.");
        }

        try {
            app.redraw();
        } catch (ignore2) {}
    }

    function selectBranchItemsRecursive(layerRef) {
        var count = 0;
        var directItems = getDirectPageItems(layerRef);
        var i;

        if (!isLayerEffectivelyVisible(layerRef)) {
            return 0;
        }

        for (i = 0; i < directItems.length; i += 1) {
            try {
                if (!directItems[i].hidden) {
                    directItems[i].selected = true;
                    count += 1;
                }
            } catch (ignore1) {}
        }

        for (i = 0; i < layerRef.layers.length; i += 1) {
            count += selectBranchItemsRecursive(layerRef.layers[i]);
        }

        return count;
    }

    function clearSelection(documentRef) {
        try {
            documentRef.selection = null;
        } catch (ignore1) {}

        try {
            app.selection = null;
        } catch (ignore2) {}
    }

    function clearSelectionHard(documentRef) {
        var i;

        clearSelection(documentRef);

        for (i = 0; i < documentRef.pageItems.length; i += 1) {
            try {
                documentRef.pageItems[i].selected = false;
            } catch (ignore3) {}
        }

        clearSelection(documentRef);
    }

    function trimSelectionToLayer(documentRef, allowedLayer) {
        var selection = normalizeSelection(documentRef.selection);
        var kept = 0;
        var i;

        for (i = 0; i < selection.length; i += 1) {
            if (isItemInsideLayerBranch(selection[i], allowedLayer)) {
                kept += 1;
                continue;
            }

            try {
                selection[i].selected = false;
            } catch (ignore1) {}
        }

        return kept;
    }

    function isItemInsideLayerBranch(item, allowedLayer) {
        var current = getItemOwningLayer(item);

        while (current && current.typename === "Layer") {
            if (current === allowedLayer) {
                return true;
            }

            current = current.parent;
        }

        return false;
    }

    function sleepForMacro(delayMs) {
        if (!(delayMs > 0)) {
            return;
        }

        try {
            app.redraw();
        } catch (ignore1) {}

        $.sleep(delayMs);

        try {
            app.redraw();
        } catch (ignore2) {}
    }

    function isLayerEffectivelyVisible(layerRef) {
        var current = layerRef;

        while (current && current.typename === "Layer") {
            if (!current.visible) {
                return false;
            }

            current = current.parent;
        }

        return true;
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

    function unlockBranchForMacro(rootLayer) {
        var i;

        if (!rootLayer) {
            return;
        }

        try {
            rootLayer.locked = false;
        } catch (ignore1) {}

        for (i = 0; i < rootLayer.pageItems.length; i += 1) {
            try {
                rootLayer.pageItems[i].locked = false;
            } catch (ignore2) {}
        }

        for (i = 0; i < rootLayer.layers.length; i += 1) {
            unlockBranchForMacro(rootLayer.layers[i]);
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
        hideSourceLayer(layer);
    }

    function lockLayerBranchRecursive(layer) {
        var i;

        if (!layer) {
            return;
        }

        try {
            layer.locked = true;
        } catch (ignore1) {}

        for (i = 0; i < layer.pageItems.length; i += 1) {
            try {
                layer.pageItems[i].selected = false;
            } catch (ignore2) {}
            try {
                layer.pageItems[i].locked = true;
            } catch (ignore3) {}
        }

        for (i = 0; i < layer.layers.length; i += 1) {
            lockLayerBranchRecursive(layer.layers[i]);
        }
    }

    function hideLiveTargetItem(item) {
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
