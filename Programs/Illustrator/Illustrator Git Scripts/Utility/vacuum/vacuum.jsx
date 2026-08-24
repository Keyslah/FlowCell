#target illustrator

// Description: Move selected microscopic objects into Trash > vacuum bin.
(function () {
    var ROOT_TRASH = "Trash";
    var VACUUM_BIN = "vacuum bin";
    var POINTS_PER_INCH = 72;
    var MILLIMETERS_PER_INCH = 25.4;
    var VACUUM_THRESHOLD_POINTS = 0.1 * POINTS_PER_INCH / MILLIMETERS_PER_INCH;

    // __VACUUM_TEST_HOOK__

    if (app.documents.length === 0) {
        alert("Open a document first.");
        return;
    }

    var doc = app.activeDocument;
    var selectedItems = normalizeSelectedPageItems(doc.selection);
    var outcome;

    if (selectedItems.length === 0) {
        alert("Select one or more artwork objects first.");
        return;
    }

    outcome = runVacuum(doc, selectedItems);
    if (outcome.failed > 0) {
        alert("Vacuum could not move " + outcome.failed + " selected object" +
            (outcome.failed === 1 ? "." : "s."));
    }

    function safeString(value) {
        try {
            return String(value === null || value === undefined ? "" : value);
        } catch (ignore) {
            return "";
        }
    }

    function getNearestOwningLayer(item) {
        var current = item;

        while (current) {
            if (safeString(current.typename) === "Layer") {
                return current;
            }
            try {
                current = current.parent;
            } catch (ignoreParent) {
                current = null;
            }
        }

        return null;
    }

    function getTopLevelOwningLayer(item) {
        var current = item;
        var topLayer = null;

        while (current) {
            if (safeString(current.typename) === "Layer") {
                topLayer = current;
            }
            try {
                current = current.parent;
            } catch (ignoreParent) {
                current = null;
            }
        }

        return topLayer;
    }

    function isSelectablePageItem(value) {
        var typename;

        if (!value) {
            return false;
        }

        typename = safeString(value.typename);
        if (typename === "InsertionPoint" || typename === "TextRange" || typename === "Layer") {
            return false;
        }

        try {
            return typeof value.move === "function" && !!getNearestOwningLayer(value);
        } catch (ignorePageItemProbe) {
            return false;
        }
    }

    function isAncestorPageItem(ancestor, item) {
        var current;

        if (!ancestor || !item || ancestor === item) {
            return false;
        }

        try {
            current = item.parent;
        } catch (ignoreParent) {
            current = null;
        }

        while (current && safeString(current.typename) !== "Layer") {
            if (current === ancestor) {
                return true;
            }
            try {
                current = current.parent;
            } catch (ignoreNextParent) {
                current = null;
            }
        }

        return false;
    }

    function addSelectionRoot(roots, candidate) {
        var index;

        for (index = roots.length - 1; index >= 0; index -= 1) {
            if (roots[index] === candidate || isAncestorPageItem(roots[index], candidate)) {
                return;
            }
            if (isAncestorPageItem(candidate, roots[index])) {
                roots.splice(index, 1);
            }
        }

        roots.push(candidate);
    }

    function promoteProtectedContainer(item) {
        var current = item;
        var protectedItem = item;
        var parent;
        var typename;

        while (current) {
            try {
                parent = current.parent;
            } catch (ignoreParent) {
                parent = null;
            }
            if (!parent || safeString(parent.typename) === "Layer") {
                break;
            }

            typename = safeString(parent.typename);
            if (typename === "CompoundPathItem" ||
                    (typename === "GroupItem" && parent.clipped === true)) {
                protectedItem = parent;
            }
            current = parent;
        }

        return protectedItem;
    }

    function normalizeSelectedPageItems(rawSelection) {
        var candidates = [];
        var roots = [];
        var hasCollectionShape;
        var index;

        if (!rawSelection) {
            return roots;
        }

        hasCollectionShape = !rawSelection.typename && typeof rawSelection.length === "number";
        if (hasCollectionShape) {
            for (index = 0; index < rawSelection.length; index += 1) {
                candidates.push(rawSelection[index]);
            }
        } else {
            candidates.push(rawSelection);
        }

        for (index = 0; index < candidates.length; index += 1) {
            candidates[index] = promoteProtectedContainer(candidates[index]);
            if (isSelectablePageItem(candidates[index])) {
                addSelectionRoot(roots, candidates[index]);
            }
        }

        return roots;
    }

    function measureVisibleBounds(item) {
        var bounds;
        var left;
        var top;
        var right;
        var bottom;

        try {
            bounds = item.visibleBounds;
        } catch (ignoreBounds) {
            bounds = null;
        }

        if (!bounds || bounds.length !== 4) {
            return null;
        }

        left = Number(bounds[0]);
        top = Number(bounds[1]);
        right = Number(bounds[2]);
        bottom = Number(bounds[3]);
        if (!isFinite(left) || !isFinite(top) || !isFinite(right) || !isFinite(bottom)) {
            return null;
        }

        return {
            width: Math.abs(right - left),
            height: Math.abs(top - bottom)
        };
    }

    function isItemBelowVacuumThreshold(item) {
        var size = measureVisibleBounds(item);

        return isSizeBelowVacuumThreshold(size);
    }

    function isSizeBelowVacuumThreshold(size) {
        return !!size &&
            size.width < VACUUM_THRESHOLD_POINTS &&
            size.height < VACUUM_THRESHOLD_POINTS;
    }

    function isEditableForMove(item) {
        try {
            if (item.editable === false || item.locked === true || item.hidden === true) {
                return false;
            }
        } catch (ignoreState) {
            return false;
        }

        return true;
    }

    function classifyVacuumItems(items) {
        var result = {
            candidates: [],
            tooLarge: 0,
            invalidBounds: 0,
            uneditable: 0,
            alreadyInTrash: 0
        };
        var index;
        var item;
        var topLayer;
        var size;

        for (index = 0; index < items.length; index += 1) {
            item = items[index];
            topLayer = getTopLevelOwningLayer(item);
            if (topLayer && safeString(topLayer.name) === ROOT_TRASH) {
                result.alreadyInTrash += 1;
                continue;
            }
            if (!isEditableForMove(item)) {
                result.uneditable += 1;
                continue;
            }

            size = measureVisibleBounds(item);
            if (!size) {
                result.invalidBounds += 1;
                continue;
            }
            if (isSizeBelowVacuumThreshold(size)) {
                result.candidates.push(item);
            } else {
                result.tooLarge += 1;
            }
        }

        return result;
    }

    function findTopLevelLayerByName(documentRef, layerName) {
        var index;

        for (index = 0; index < documentRef.layers.length; index += 1) {
            if (documentRef.layers[index].name === layerName) {
                return documentRef.layers[index];
            }
        }

        return null;
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

    function findChildLayerByName(parentLayer, layerName) {
        var index;

        for (index = 0; index < parentLayer.layers.length; index += 1) {
            if (parentLayer.layers[index].name === layerName) {
                return parentLayer.layers[index];
            }
        }

        return null;
    }

    function ensureChildLayer(parentLayer, layerName) {
        var layer = findChildLayerByName(parentLayer, layerName);

        if (layer) {
            return layer;
        }

        layer = parentLayer.layers.add();
        layer.name = layerName;
        layer.visible = true;
        layer.locked = false;
        return layer;
    }

    function captureLayerState(layer) {
        return {
            visible: layer.visible,
            locked: layer.locked
        };
    }

    function restoreLayerState(layer, state) {
        try {
            layer.visible = state.visible;
        } catch (ignoreVisible) {}
        try {
            layer.locked = state.locked;
        } catch (ignoreLocked) {}
    }

    function safeActiveLayer(documentRef) {
        try {
            return documentRef.activeLayer;
        } catch (ignore) {
            return null;
        }
    }

    function restoreActiveLayer(documentRef, layer) {
        if (!layer) {
            return;
        }
        try {
            documentRef.activeLayer = layer;
        } catch (ignore) {}
    }

    function moveCandidatesToVacuumBin(documentRef, candidates) {
        var originalActiveLayer = safeActiveLayer(documentRef);
        var trashRoot = ensureRootLayer(documentRef, ROOT_TRASH);
        var existingVacuumBin = findChildLayerByName(trashRoot, VACUUM_BIN);
        var vacuumBinState = existingVacuumBin ? captureLayerState(existingVacuumBin) : null;
        var vacuumBin;
        var moved = 0;
        var failed = 0;
        var index;

        try {
            trashRoot.locked = false;
            trashRoot.visible = true;
            vacuumBin = ensureChildLayer(trashRoot, VACUUM_BIN);
            vacuumBin.locked = false;
            vacuumBin.visible = true;

            for (index = 0; index < candidates.length; index += 1) {
                try {
                    candidates[index].move(vacuumBin, ElementPlacement.PLACEATEND);
                    moved += 1;
                } catch (ignoreMove) {
                    failed += 1;
                }
            }
        } finally {
            if (vacuumBin && vacuumBinState) {
                restoreLayerState(vacuumBin, vacuumBinState);
            }
            try {
                trashRoot.visible = false;
            } catch (ignoreTrashVisible) {}
            try {
                trashRoot.locked = true;
            } catch (ignoreTrashLocked) {}
            restoreActiveLayer(documentRef, originalActiveLayer);
        }

        return { moved: moved, failed: failed };
    }

    function runVacuum(documentRef, items) {
        var classification = classifyVacuumItems(items);
        var moveResult = { moved: 0, failed: 0 };

        if (classification.candidates.length > 0) {
            moveResult = moveCandidatesToVacuumBin(documentRef, classification.candidates);
        }

        return {
            selected: items.length,
            eligible: classification.candidates.length,
            moved: moveResult.moved,
            failed: moveResult.failed,
            tooLarge: classification.tooLarge,
            invalidBounds: classification.invalidBounds,
            uneditable: classification.uneditable,
            alreadyInTrash: classification.alreadyInTrash
        };
    }

})();
