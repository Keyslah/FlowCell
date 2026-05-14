#target illustrator

/*
 * Moves the current live contents of the active layer and selected-object
 * layers into Trash, then restores the highest existing snapshot for each one.
 * Illustrator exposes only one active highlighted layer, so that plus selected
 * object layers is the closest reliable scope available in JSX.
 */
(function () {
    if (app.documents.length === 0) {
        alert("Open a document first.");
        return;
    }

    var ROOT_LIVE = "Live";
    var ROOT_SNAPSHOTS = "Snapshots";
    var ROOT_TRASH = "Trash";
    var ROOT_ARCHIVE = "Archive";

    var doc = app.activeDocument;
    var originalActiveLayer = doc.activeLayer;

    try {
        var roots = ensureRootLayers(doc);
        var targets = resolveTargetLayers(doc, false);
        var restored = [];
        var skipped = [];
        var i;

        if (targets.length === 0) {
            alert("No eligible target layers were found from the active layer or selection.");
            return;
        }

        for (i = 0; i < targets.length; i += 1) {
            var liveLayer = targets[i];
            var snapshotContainer = findChildLayerByName(roots.snapshots, liveLayer.name);
            var previousSnapshot = getHighestNumberedChild(snapshotContainer, "s");

            // Illustrator does not expose a snapshot cursor, so the highest
            // existing snapshot is treated as the previous reliable step.
            if (!previousSnapshot) {
                skipped.push(liveLayer.name + " (no previous snapshot)");
                continue;
            }

            if (layerHasContent(liveLayer)) {
                var trashContainer = ensureChildLayer(roots.trash, liveLayer.name);
                var trashEntry = trashContainer.layers.add();
                var trashName = getNextNumberedName(trashContainer, "T");
                var liveState = captureBranchState(liveLayer);

                trashEntry.name = trashName;
                trashEntry.visible = true;
                trashEntry.locked = false;

                unlockBranchFromState(liveState);
                moveLayerContents(liveLayer, trashEntry);
                restoreBranchState(liveState);
            }

            clearLayerContents(liveLayer);

            var snapshotState = captureBranchState(previousSnapshot);
            unlockBranchFromState(snapshotState);
            copyLayerContents(previousSnapshot, liveLayer, snapshotState);
            restoreBranchState(snapshotState);

            liveLayer.visible = true;
            liveLayer.locked = false;
            restored.push(liveLayer.name + " <- " + previousSnapshot.name);
        }

        if (restored.length === 0) {
            alert("Nothing was restored.\n" + skipped.join("\n"));
            return;
        }

        var message = "Restored from previous snapshot(s):\n" + restored.join("\n");
        if (skipped.length > 0) {
            message += "\n\nSkipped:\n" + skipped.join("\n");
        }
        alert(message);
    } catch (err) {
        alert("Back From Previous Snapshot failed: " + err);
    } finally {
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

    function resolveTargetLayers(documentRef, useActiveLayerOnlyWhenNeeded) {
        var result = [];
        var selection = documentRef.selection;
        var i;

        if (!useActiveLayerOnlyWhenNeeded) {
            addUniqueLayer(result, documentRef.activeLayer);
        }

        if (selection && selection.length > 0) {
            for (i = 0; i < selection.length; i += 1) {
                addUniqueLayer(result, selection[i].layer);
            }
        } else if (useActiveLayerOnlyWhenNeeded) {
            addUniqueLayer(result, documentRef.activeLayer);
        }

        return result;
    }

    function addUniqueLayer(targets, layer) {
        var i;
        if (!isEligibleTargetLayer(layer)) {
            return;
        }

        for (i = 0; i < targets.length; i += 1) {
            if (targets[i] === layer) {
                return;
            }
        }

        targets.push(layer);
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

    function getNextNumberedName(parentLayer, prefix) {
        var maxValue = 0;
        var matcher = new RegExp("^" + prefix + "(\\d+)$");
        var i;

        for (i = 0; i < parentLayer.layers.length; i += 1) {
            var match = parentLayer.layers[i].name.match(matcher);
            if (match) {
                var value = parseInt(match[1], 10);
                if (value > maxValue) {
                    maxValue = value;
                }
            }
        }

        return prefix + (maxValue + 1);
    }

    function getHighestNumberedChild(parentLayer, prefix) {
        var highestLayer = null;
        var highestValue = -1;
        var matcher = new RegExp("^" + prefix + "(\\d+)$");
        var i;

        if (!parentLayer) {
            return null;
        }

        for (i = 0; i < parentLayer.layers.length; i += 1) {
            var match = parentLayer.layers[i].name.match(matcher);
            if (match) {
                var value = parseInt(match[1], 10);
                if (value > highestValue) {
                    highestValue = value;
                    highestLayer = parentLayer.layers[i];
                }
            }
        }

        return highestLayer;
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

    // Illustrator layer duplication can be unreliable, so copy direct items and
    // sublayers recursively instead of duplicating the layer container itself.
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

    function restoreActiveLayer(documentRef, layerRef) {
        try {
            if (layerRef) {
                documentRef.activeLayer = layerRef;
            }
        } catch (ignore) {}
    }
}());
