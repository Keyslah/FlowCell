// FlowCell Layers Builder bridge action.
// Scans and mutates the document layer/sublayer tree and returns the fresh tree
// as JSON so FlowCell can render a live tree without depending on Illustrator's
// native (non-scriptable) Layers panel. Driven by FLOWCELL_ARGS = { op, ... }.
//
// Layer addressing ("key"): a dot path of layer indices from the document root.
//   "0"     -> doc.layers[0]
//   "0.2"   -> doc.layers[0].layers[2]
//   "0.2.1" -> doc.layers[0].layers[2].layers[1]
// Keys are recomputed on every scan, so they are stable within one
// scan -> operate -> rescan cycle (FlowCell rescans after each operation).

#target illustrator

(function () {
    function jsonString(value) {
        value = String(value);
        var out = '"';
        for (var i = 0; i < value.length; i += 1) {
            var ch = value.charAt(i);
            var code = value.charCodeAt(i);
            if (ch === '"') {
                out += '\\"';
            } else if (ch === '\\') {
                out += '\\\\';
            } else if (code < 32) {
                out += '\\u' + ('0000' + code.toString(16)).slice(-4);
            } else {
                out += ch;
            }
        }
        return out + '"';
    }

    function fail(message) {
        return '{"ok":false,"error":' + jsonString(message) + '}';
    }

    if (app.documents.length === 0) {
        return fail('No open Illustrator document.');
    }

    var doc = app.activeDocument;
    var args = (typeof FLOWCELL_ARGS !== 'undefined' && FLOWCELL_ARGS) ? FLOWCELL_ARGS : {};
    var op = args.op ? String(args.op) : 'scan';

    function resolveLayerByKey(key) {
        if (key === '' || key === null || typeof key === 'undefined') {
            return null;
        }
        var segments = String(key).split('.');
        var collection = doc.layers;
        var layer = null;
        for (var i = 0; i < segments.length; i += 1) {
            var index = parseInt(segments[i], 10);
            if (isNaN(index) || index < 0 || index >= collection.length) {
                return null;
            }
            layer = collection[index];
            collection = layer.layers;
        }
        return layer;
    }

    function keyForLayer(target) {
        // Walks the tree to find the dot-path key whose layer is the given object.
        function search(collection, prefix) {
            for (var i = 0; i < collection.length; i += 1) {
                var current = collection[i];
                var currentKey = prefix === '' ? String(i) : prefix + '.' + i;
                if (current === target) {
                    return currentKey;
                }
                var nested = search(current.layers, currentKey);
                if (nested !== null) {
                    return nested;
                }
            }
            return null;
        }
        try {
            return search(doc.layers, '');
        } catch (e) {
            return null;
        }
    }

    function uniqueChildName(parentLayers, baseName) {
        function exists(name) {
            for (var i = 0; i < parentLayers.length; i += 1) {
                if (parentLayers[i].name === name) {
                    return true;
                }
            }
            return false;
        }
        var candidate = baseName;
        var suffix = 2;
        while (exists(candidate)) {
            candidate = baseName + ' ' + suffix;
            suffix += 1;
        }
        return candidate;
    }

    function nextDuplicateLayerName(parentLayers, sourceName) {
        function exists(name) {
            for (var i = 0; i < parentLayers.length; i += 1) {
                if (parentLayers[i].name === name) {
                    return true;
                }
            }
            return false;
        }
        var source = String(sourceName);
        var numbered = source.match(/^(.*?)(\d+)$/);
        var baseName = numbered ? numbered[1] : source;
        var suffix = numbered ? parseInt(numbered[2], 10) + 1 : 1;
        var candidate = baseName + suffix;
        while (exists(candidate)) {
            suffix += 1;
            candidate = baseName + suffix;
        }
        return candidate;
    }

    function rememberLayerState(layer, bucket) {
        for (var i = 0; i < bucket.length; i += 1) {
            if (bucket[i].layer === layer) {
                return;
            }
        }
        var depth = 0;
        var current = layer;
        while (current && current.parent && current.parent.typename === 'Layer') {
            depth += 1;
            current = current.parent;
        }
        bucket.push({
            layer: layer,
            locked: layer.locked ? true : false,
            visible: layer.visible ? true : false,
            depth: depth
        });
    }

    function openAncestors(layer, states) {
        var current = layer;
        while (current && current.typename === 'Layer') {
            rememberLayerState(current, states);
            try { current.locked = false; } catch (e1) {}
            try { current.visible = true; } catch (e2) {}
            current = (current.parent && current.parent.typename === 'Layer') ? current.parent : null;
        }
    }

    function openSubtree(layer, states) {
        rememberLayerState(layer, states);
        try { layer.locked = false; } catch (e1) {}
        try { layer.visible = true; } catch (e2) {}
        for (var i = 0; i < layer.layers.length; i += 1) {
            openSubtree(layer.layers[i], states);
        }
    }

    function collectPageItems(layer, bucket, states) {
        var i;
        for (i = 0; i < layer.pageItems.length; i += 1) {
            var item = layer.pageItems[i];
            var remembered = false;
            for (var s = 0; s < states.length; s += 1) {
                if (states[s].item === item) {
                    remembered = true;
                    break;
                }
            }
            if (!remembered) {
                states.push({
                    item: item,
                    locked: item.locked ? true : false,
                    hidden: item.hidden ? true : false
                });
            }
            try { if (item.locked) { item.locked = false; } } catch (e1) {}
            try { if (item.hidden) { item.hidden = false; } } catch (e2) {}
            bucket.push(item);
        }
        for (i = 0; i < layer.layers.length; i += 1) {
            collectPageItems(layer.layers[i], bucket, states);
        }
    }

    function restorePageItemStates(states) {
        for (var i = states.length - 1; i >= 0; i -= 1) {
            try { states[i].item.hidden = states[i].hidden; } catch (e1) {}
            try { states[i].item.locked = states[i].locked; } catch (e2) {}
        }
    }

    function restoreLayerStates(states) {
        for (var i = 0; i < states.length; i += 1) {
            try {
                states[i].layer.locked = false;
                states[i].layer.visible = true;
                var depth = 0;
                var current = states[i].layer;
                while (current && current.parent && current.parent.typename === 'Layer') {
                    depth += 1;
                    current = current.parent;
                }
                states[i].depth = depth;
            } catch (openError) {}
        }
        states.sort(function (left, right) { return right.depth - left.depth; });
        for (var j = 0; j < states.length; j += 1) {
            try { states[j].layer.visible = states[j].visible; } catch (e1) {}
            try { states[j].layer.locked = states[j].locked; } catch (e2) {}
        }
    }

    function nodeJson(layer, key, depth) {
        var children = [];
        for (var j = 0; j < layer.layers.length; j += 1) {
            children.push(nodeJson(layer.layers[j], key + '.' + j, depth + 1));
        }
        var itemCount = 0;
        try {
            itemCount = layer.pageItems.length;
        } catch (e) {
            itemCount = 0;
        }
        return '{' +
            '"key":' + jsonString(key) + ',' +
            '"name":' + jsonString(layer.name) + ',' +
            '"locked":' + (layer.locked ? 'true' : 'false') + ',' +
            '"hidden":' + (layer.visible ? 'false' : 'true') + ',' +
            '"depth":' + depth + ',' +
            '"itemCount":' + itemCount + ',' +
            '"children":[' + children.join(',') + ']' +
            '}';
    }

    function buildTree() {
        var parts = [];
        for (var i = 0; i < doc.layers.length; i += 1) {
            parts.push(nodeJson(doc.layers[i], String(i), 0));
        }
        return '[' + parts.join(',') + ']';
    }

    function successSnapshot() {
        var activeKey = keyForLayer(doc.activeLayer);
        return '{"ok":true,"active":' + jsonString(activeKey === null ? '' : activeKey) +
            ',"tree":' + buildTree() + '}';
    }

    function asKeyList(value) {
        if (!value) {
            return [];
        }
        if (typeof value.length === 'number' && typeof value !== 'string') {
            var list = [];
            for (var i = 0; i < value.length; i += 1) {
                list.push(String(value[i]));
            }
            return list;
        }
        return [String(value)];
    }

    function resolvedLayerTargets(value) {
        var keys = asKeyList(value);
        var unique = {};
        var targets = [];
        for (var i = 0; i < keys.length; i += 1) {
            var layer = resolveLayerByKey(keys[i]);
            if (!layer) {
                throw new Error('Layer was not found: ' + keys[i]);
            }
            var canonicalKey = keyForLayer(layer);
            if (canonicalKey === null) {
                throw new Error('Layer key could not be resolved: ' + keys[i]);
            }
            if (!unique[canonicalKey]) {
                unique[canonicalKey] = true;
                targets.push({ key: canonicalKey, layer: layer });
            }
        }
        return targets;
    }

    function normalizedLayerTargets(value) {
        var targets = resolvedLayerTargets(value);
        targets.sort(function (left, right) {
            var leftDepth = left.key.split('.').length;
            var rightDepth = right.key.split('.').length;
            if (leftDepth !== rightDepth) {
                return leftDepth - rightDepth;
            }
            return left.key < right.key ? -1 : (left.key > right.key ? 1 : 0);
        });
        var normalized = [];
        for (var t = 0; t < targets.length; t += 1) {
            var nested = false;
            for (var p = 0; p < normalized.length; p += 1) {
                if (targets[t].key.indexOf(normalized[p].key + '.') === 0) {
                    nested = true;
                    break;
                }
            }
            if (!nested) {
                normalized.push(targets[t]);
            }
        }
        return normalized;
    }

    function normalizedSelection(value) {
        var selected = [];
        if (!value) {
            return selected;
        }
        // PathItem and TextRange can both expose a numeric length. A selection
        // object must be recognized before treating array-like values as lists.
        try {
            if (value.typename) {
                selected.push(value);
                return selected;
            }
        } catch (typenameError) {}
        if (typeof value.length === 'number') {
            for (var i = 0; i < value.length; i += 1) {
                if (value[i]) {
                    selected.push(value[i]);
                }
            }
            if (selected.length > 0) {
                return selected;
            }
        }
        return selected;
    }

    function owningLayerForSelectedObject(item) {
        try {
            if (item.layer && item.layer.typename === 'Layer') {
                return item.layer;
            }
        } catch (layerError) {}
        var current = item;
        for (var depth = 0; current && depth < 64; depth += 1) {
            try {
                if (current.typename === 'Layer') {
                    return current;
                }
            } catch (typenameError) {}
            try {
                current = current.parent;
            } catch (parentError) {
                current = null;
            }
        }
        return null;
    }

    function selectedObjectLayerKeys() {
        var selection = normalizedSelection(doc.selection);
        var keys = [];
        var unique = {};
        for (var i = 0; i < selection.length; i += 1) {
            var itemType = '';
            try {
                itemType = String(selection[i].typename);
            } catch (typenameError) {}
            if (itemType === 'InsertionPoint' || itemType === 'TextRange') {
                continue;
            }
            var layer = owningLayerForSelectedObject(selection[i]);
            if (!layer) {
                throw new Error('A selected Illustrator object does not belong to a layer.');
            }
            var key = keyForLayer(layer);
            if (key === null) {
                throw new Error('A selected Illustrator object layer could not be resolved.');
            }
            if (!unique[key]) {
                unique[key] = true;
                keys.push(key);
            }
        }
        return keys;
    }

    function selectedOrHighlightedLayerTargets(value) {
        var selectedKeys = selectedObjectLayerKeys();
        if (selectedKeys.length > 0) {
            return normalizedLayerTargets(selectedKeys);
        }
        var highlightedTargets = normalizedLayerTargets(value);
        if (highlightedTargets.length === 0) {
            throw new Error('Select Illustrator objects or highlight one or more Layer Tree rows.');
        }
        return highlightedTargets;
    }

    function highlightedLayerTargets(value) {
        var highlightedTargets = normalizedLayerTargets(value);
        if (highlightedTargets.length === 0) {
            throw new Error('Highlight one or more Layer Tree rows to duplicate.');
        }
        return highlightedTargets;
    }

    function containsObjectReference(items, candidate) {
        for (var i = 0; i < items.length; i += 1) {
            if (items[i] === candidate) {
                return true;
            }
        }
        return false;
    }

    function normalizedArtworkItems(value) {
        var selection = normalizedSelection(value);
        var candidates = [];
        var i;
        for (i = 0; i < selection.length; i += 1) {
            var itemType = '';
            try { itemType = String(selection[i].typename); } catch (typenameError) {}
            if (itemType === 'InsertionPoint' || itemType === 'TextRange') {
                continue;
            }
            if (!containsObjectReference(candidates, selection[i])) {
                candidates.push(selection[i]);
            }
        }

        // Illustrator can expose both a selected container and one of its
        // descendants. Moving the container already carries that descendant.
        var topmost = [];
        for (i = 0; i < candidates.length; i += 1) {
            var current = null;
            try { current = candidates[i].parent; } catch (parentError) {}
            var nestedSelection = false;
            for (var depth = 0; current && depth < 64; depth += 1) {
                if (containsObjectReference(candidates, current)) {
                    nestedSelection = true;
                    break;
                }
                try { current = current.parent; } catch (ancestorError) { current = null; }
            }
            if (!nestedSelection) {
                topmost.push(candidates[i]);
            }
        }
        return topmost;
    }

    function selectedArtworkItems() {
        return normalizedArtworkItems(doc.selection);
    }

    function layerArtworkPlan(layer) {
        var items = [];
        var positions = [];
        var anchors = [];

        function collect(currentLayer) {
            var localAnchors = [];
            var i;
            for (i = currentLayer.layers.length - 1; i >= 0; i -= 1) {
                var childLayer = currentLayer.layers[i];
                var sourceAnchor = currentLayer.groupItems.add();
                var anchorRecord = {
                    sourceLayer: childLayer,
                    sourceAnchor: sourceAnchor
                };
                anchors.push(anchorRecord);
                localAnchors.push(anchorRecord);
                sourceAnchor.move(childLayer, ElementPlacement.PLACEBEFORE);
            }

            var directItems = directPageItems(currentLayer);
            var entries = [];
            for (i = 0; i < directItems.length; i += 1) {
                var anchor = findLayerAnchor(localAnchors, directItems[i]);
                entries.push(anchor ? anchor.sourceLayer : directItems[i]);
            }
            for (i = 0; i < entries.length; i += 1) {
                if (entries[i].typename === 'Layer') {
                    collect(entries[i]);
                } else {
                    items.push(entries[i]);
                    positions.push({
                        item: entries[i],
                        parent: currentLayer,
                        previousSibling: i > 0 ? entries[i - 1] : null,
                        nextSibling: i + 1 < entries.length ? entries[i + 1] : null
                    });
                }
            }
        }

        var collectionError = null;
        var cleanupError = null;
        try {
            collect(layer);
        } catch (planError) {
            collectionError = planError;
        }
        for (var i = anchors.length - 1; i >= 0; i -= 1) {
            try {
                anchors[i].sourceAnchor.remove();
            } catch (anchorCleanupError) {
                if (!cleanupError) {
                    cleanupError = anchorCleanupError;
                }
            }
        }
        if (collectionError) {
            if (cleanupError) {
                throw new Error(
                    String(collectionError) +
                    ' Temporary artwork-order marker cleanup also failed: ' +
                    String(cleanupError)
                );
            }
            throw collectionError;
        }
        if (cleanupError) {
            throw new Error(
                'Temporary artwork-order marker cleanup failed: ' + String(cleanupError)
            );
        }
        // Each directPageItems() pass is parent-filtered and each child Layer is
        // visited once, so this plan is already unique and topmost in visual order.
        return { items: items, positions: positions };
    }

    function clearArtworkSelection() {
        var previousSelection = normalizedArtworkItems(doc.selection);
        try { doc.selection = null; } catch (clearSelectionError) {}
        for (var i = 0; i < previousSelection.length; i += 1) {
            try { previousSelection[i].selected = false; } catch (clearItemError) {}
        }
        for (var j = 0; j < previousSelection.length; j += 1) {
            try {
                if (previousSelection[j].selected) {
                    return false;
                }
            } catch (readClearedItemError) {
                return false;
            }
        }
        return normalizedArtworkItems(doc.selection).length === 0;
    }

    function selectArtworkItems(items) {
        if (!clearArtworkSelection()) {
            return -1;
        }
        var selectedCount = 0;
        for (var i = 0; i < items.length; i += 1) {
            try {
                items[i].selected = true;
                if (items[i].selected) {
                    selectedCount += 1;
                }
            } catch (selectItemError) {}
        }
        return selectedCount;
    }

    function artworkItemCanRemainSelected(item) {
        try {
            if (item.hidden || item.locked) {
                return false;
            }
        } catch (itemStateError) {
            return false;
        }
        var layer = owningLayerForSelectedObject(item);
        while (layer && layer.typename === 'Layer') {
            try {
                if (layer.locked || !layer.visible) {
                    return false;
                }
            } catch (layerStateError) {
                return false;
            }
            layer = (layer.parent && layer.parent.typename === 'Layer') ? layer.parent : null;
        }
        return true;
    }

    function selectedArtworkItemCount(items) {
        var selectedCount = 0;
        for (var i = 0; i < items.length; i += 1) {
            try {
                if (items[i].selected) {
                    selectedCount += 1;
                }
            } catch (readSelectionError) {}
        }
        return selectedCount;
    }

    function rememberArtworkState(item, plannedPosition) {
        var state = {
            item: item,
            parent: null,
            previousSibling: null,
            nextSibling: null,
            locked: false,
            hidden: false
        };
        if (plannedPosition) {
            state.parent = plannedPosition.parent;
            state.previousSibling = plannedPosition.previousSibling;
            state.nextSibling = plannedPosition.nextSibling;
        } else {
            try { state.parent = item.parent; } catch (parentError) {}
        }
        try { state.locked = item.locked ? true : false; } catch (lockedError) {}
        try { state.hidden = item.hidden ? true : false; } catch (hiddenError) {}
        try {
            if (plannedPosition) {
                return state;
            }
            if (state.parent && state.parent.pageItems) {
                var directItems = [];
                for (var i = 0; i < state.parent.pageItems.length; i += 1) {
                    if (state.parent.pageItems[i].parent === state.parent) {
                        directItems.push(state.parent.pageItems[i]);
                    }
                }
                for (var d = 0; d < directItems.length; d += 1) {
                    if (directItems[d] === item) {
                        state.previousSibling = d > 0 ? directItems[d - 1] : null;
                        state.nextSibling = d + 1 < directItems.length ? directItems[d + 1] : null;
                        break;
                    }
                }
            }
        } catch (siblingsError) {}
        return state;
    }

    function openArtworkItem(state) {
        try { state.item.locked = false; } catch (lockedError) {}
        try { state.item.hidden = false; } catch (hiddenError) {}
    }

    function restoreArtworkState(state) {
        try { state.item.hidden = state.hidden; } catch (hiddenError) {}
        try { state.item.locked = state.locked; } catch (lockedError) {}
    }

    function restoreArtworkParent(state) {
        var previousAvailable = false;
        var nextAvailable = false;
        try {
            previousAvailable = state.previousSibling && state.previousSibling.parent === state.parent;
        } catch (previousError) {}
        try {
            nextAvailable = state.nextSibling && state.nextSibling.parent === state.parent;
        } catch (nextError) {}
        if (nextAvailable) {
            state.item.move(state.nextSibling, ElementPlacement.PLACEBEFORE);
        } else if (previousAvailable) {
            state.item.move(state.previousSibling, ElementPlacement.PLACEAFTER);
        } else {
            state.item.move(state.parent, ElementPlacement.PLACEATBEGINNING);
        }
    }

    function findRememberedLayerState(states, layer) {
        for (var i = 0; i < states.length; i += 1) {
            if (states[i].layer === layer) {
                return states[i];
            }
        }
        return null;
    }

    function findRememberedPageItemState(states, item) {
        for (var i = 0; i < states.length; i += 1) {
            if (states[i].item === item) {
                return states[i];
            }
        }
        return null;
    }

    function directPageItems(layer) {
        var items = [];
        for (var i = 0; i < layer.pageItems.length; i += 1) {
            if (layer.pageItems[i].parent === layer) {
                items.push(layer.pageItems[i]);
            }
        }
        return items;
    }

    function applyCopiedLayerProperties(sourceLayer, targetLayer, rememberedState) {
        var properties = [
            'artworkKnockout',
            'blendingMode',
            'color',
            'dimPlacedImages',
            'opacity',
            'preview',
            'printable',
            'sliced'
        ];
        for (var i = 0; i < properties.length; i += 1) {
            try {
                targetLayer[properties[i]] = sourceLayer[properties[i]];
            } catch (propertyError) {}
        }
        try {
            targetLayer.visible = rememberedState ? rememberedState.visible : sourceLayer.visible;
        } catch (visibleError) {}
        try {
            targetLayer.locked = rememberedState ? rememberedState.locked : sourceLayer.locked;
        } catch (lockedError) {}
    }

    function copyPageItem(sourceItem, targetLayer, itemStates) {
        var copiedItem = sourceItem.duplicate(targetLayer, ElementPlacement.PLACEATBEGINNING);
        var rememberedState = findRememberedPageItemState(itemStates, sourceItem);
        if (rememberedState) {
            try { copiedItem.hidden = rememberedState.hidden; } catch (hiddenError) {}
            try { copiedItem.locked = rememberedState.locked; } catch (lockedError) {}
        }
        return copiedItem;
    }

    function findLayerAnchor(records, sourceItem) {
        for (var i = 0; i < records.length; i += 1) {
            if (records[i].sourceAnchor === sourceItem) {
                return records[i];
            }
        }
        return null;
    }

    function copyLayerContents(sourceLayer, targetLayer, layerStates, itemStates) {
        var anchors = [];
        var i;
        try {
            for (i = sourceLayer.layers.length - 1; i >= 0; i -= 1) {
                var sourceChild = sourceLayer.layers[i];
                var sourceAnchor = sourceLayer.groupItems.add();
                var anchorRecord = {
                    sourceLayer: sourceChild,
                    sourceAnchor: sourceAnchor,
                    targetAnchor: null
                };
                anchors.push(anchorRecord);
                sourceAnchor.move(sourceChild, ElementPlacement.PLACEBEFORE);
            }

            var items = directPageItems(sourceLayer);
            for (i = items.length - 1; i >= 0; i -= 1) {
                var copiedItem = copyPageItem(items[i], targetLayer, itemStates);
                var anchor = findLayerAnchor(anchors, items[i]);
                if (anchor) {
                    anchor.targetAnchor = copiedItem;
                }
            }

            for (i = 0; i < anchors.length; i += 1) {
                if (!anchors[i].targetAnchor) {
                    throw new Error('Layer copy anchor could not be resolved.');
                }
                var targetChild = targetLayer.layers.add();
                targetChild.name = anchors[i].sourceLayer.name;
                targetChild.visible = true;
                targetChild.locked = false;
                copyLayerContents(
                    anchors[i].sourceLayer,
                    targetChild,
                    layerStates,
                    itemStates
                );
                targetChild.move(anchors[i].targetAnchor, ElementPlacement.PLACEAFTER);
                applyCopiedLayerProperties(
                    anchors[i].sourceLayer,
                    targetChild,
                    findRememberedLayerState(layerStates, anchors[i].sourceLayer)
                );
                anchors[i].targetAnchor.remove();
                anchors[i].targetAnchor = null;
            }
        } finally {
            for (i = anchors.length - 1; i >= 0; i -= 1) {
                try {
                    if (anchors[i].targetAnchor) {
                        anchors[i].targetAnchor.remove();
                    }
                } catch (targetAnchorError) {}
                try { anchors[i].sourceAnchor.remove(); } catch (sourceAnchorError) {}
            }
        }
    }

    function duplicateLayerTree(sourceLayer, layerStates, itemStates) {
        var parent = sourceLayer.parent;
        if (!parent || !parent.layers) {
            throw new Error('Layer parent could not receive a duplicate.');
        }
        var copiedName = nextDuplicateLayerName(parent.layers, sourceLayer.name);
        var copiedLayer = parent.layers.add();
        try {
            copiedLayer.name = copiedName;
            copiedLayer.visible = true;
            copiedLayer.locked = false;
            copiedLayer.move(sourceLayer, ElementPlacement.PLACEBEFORE);
            copyLayerContents(sourceLayer, copiedLayer, layerStates, itemStates);
            applyCopiedLayerProperties(
                sourceLayer,
                copiedLayer,
                findRememberedLayerState(layerStates, sourceLayer)
            );
            return copiedLayer;
        } catch (copyError) {
            try { copiedLayer.remove(); } catch (cleanupError) {}
            throw copyError;
        }
    }

    function layerOrAncestorIsClosed(layer) {
        var current = layer;
        while (current && current.typename === 'Layer') {
            if (current.locked || !current.visible) {
                return true;
            }
            current = (current.parent && current.parent.typename === 'Layer') ? current.parent : null;
        }
        return false;
    }

    try {
        if (op === 'scan') {
            // No mutation; fall through to return the tree.
        } else if (op === 'create') {
            var parentLayer = resolveLayerByKey(args.parentKey);
            if (args.parentKey && !parentLayer) {
                return fail('Parent layer was not found.');
            }
            var requestedName = args.name ? String(args.name) : 'Layer';
            var hostLayers;
            var createStates = [];
            if (parentLayer) {
                openAncestors(parentLayer, createStates);
                hostLayers = parentLayer.layers;
            } else {
                hostLayers = doc.layers;
            }
            var createdName = uniqueChildName(hostLayers, requestedName);
            try {
                var created = hostLayers.add();
                created.name = createdName;
                created.visible = true;
                created.locked = false;
                doc.activeLayer = created;
            } finally {
                restoreLayerStates(createStates);
            }
        } else if (op === 'rename') {
            var renameTarget = resolveLayerByKey(args.key);
            if (!renameTarget) {
                return fail('Layer to rename was not found.');
            }
            var renameStates = [];
            openAncestors(renameTarget, renameStates);
            try {
                renameTarget.name = args.name ? String(args.name) : renameTarget.name;
            } finally {
                restoreLayerStates(renameStates);
            }
        } else if (op === 'delete') {
            var force = args.force ? true : false;
            var doomed = selectedOrHighlightedLayerTargets(args.keys);
            var topLevelCount = 0;
            for (var d = 0; d < doomed.length; d += 1) {
                if (doomed[d].key.indexOf('.') < 0) {
                    topLevelCount += 1;
                }
                if (!force && layerOrAncestorIsClosed(doomed[d].layer)) {
                    return fail('Layer is locked or hidden. Use force delete.');
                }
            }
            if (topLevelCount >= doc.layers.length) {
                return fail('Illustrator requires at least one top-level layer.');
            }
            var deleteStates = [];
            try {
                for (var r = 0; r < doomed.length; r += 1) {
                    if (force) {
                        openAncestors(doomed[r].layer, deleteStates);
                    }
                    doomed[r].layer.remove();
                }
            } finally {
                restoreLayerStates(deleteStates);
            }
        } else if (op === 'duplicate') {
            var dupTargets = highlightedLayerTargets(args.keys);
            var duplicateStates = [];
            var duplicateItemStates = [];
            var duplicateItems = [];
            var duplicatedRoots = [];
            var duplicatePreviousActiveLayer = doc.activeLayer;
            try {
                for (var u = 0; u < dupTargets.length; u += 1) {
                    openAncestors(dupTargets[u].layer, duplicateStates);
                    openSubtree(dupTargets[u].layer, duplicateStates);
                    collectPageItems(
                        dupTargets[u].layer,
                        duplicateItems,
                        duplicateItemStates
                    );
                }
                for (var v = 0; v < dupTargets.length; v += 1) {
                    duplicatedRoots.push(
                        duplicateLayerTree(
                            dupTargets[v].layer,
                            duplicateStates,
                            duplicateItemStates
                        )
                    );
                }
                doc.activeLayer = duplicatedRoots[duplicatedRoots.length - 1];
            } catch (duplicateError) {
                var rollbackFailed = false;
                for (var w = duplicatedRoots.length - 1; w >= 0; w -= 1) {
                    try {
                        openSubtree(duplicatedRoots[w], []);
                        duplicatedRoots[w].remove();
                    } catch (rollbackError) {
                        rollbackFailed = true;
                    }
                }
                try { doc.activeLayer = duplicatePreviousActiveLayer; } catch (activeRestoreError) {}
                if (rollbackFailed) {
                    throw new Error(
                        String(duplicateError) +
                        ' Duplicate rollback could not remove every completed layer copy.'
                    );
                }
                throw duplicateError;
            } finally {
                restorePageItemStates(duplicateItemStates);
                restoreLayerStates(duplicateStates);
            }
        } else if (op === 'setlock') {
            var lockTargets = resolvedLayerTargets(args.keys);
            var lockValue = args.locked ? true : false;
            for (var l = 0; l < lockTargets.length; l += 1) {
                lockTargets[l].layer.locked = lockValue;
            }
        } else if (op === 'setvis') {
            var visTargets = resolvedLayerTargets(args.keys);
            var visValue = args.visible ? true : false;
            for (var v = 0; v < visTargets.length; v += 1) {
                visTargets[v].layer.visible = visValue;
            }
        } else if (op === 'activate') {
            // The Layer Tree row body maps to Illustrator's native active layer
            // only. It must not replace the user's artwork selection; the
            // right-side target controls remain the explicit select-artwork path.
            var activateLayer = resolveLayerByKey(args.key);
            if (!activateLayer) {
                return fail('Layer to activate was not found.');
            }
            var activateLayerStates = [];
            try {
                openAncestors(activateLayer, activateLayerStates);
                doc.activeLayer = activateLayer;
            } finally {
                restoreLayerStates(activateLayerStates);
            }
        } else if (op === 'select') {
            // Illustrator-style "target" click: select all artwork on the layer
            // (and its sublayers), temporarily unlocking/unhiding so it can be
            // selected, and make it the active layer.
            var selectLayer = resolveLayerByKey(args.key);
            if (!selectLayer) {
                return fail('Layer to select was not found.');
            }
            var selectLayerStates = [];
            var selectItemStates = [];
            var selectItems = [];
            try {
                openAncestors(selectLayer, selectLayerStates);
                openSubtree(selectLayer, selectLayerStates);
                collectPageItems(selectLayer, selectItems, selectItemStates);
                selectItems = normalizedArtworkItems(selectItems);
                if (selectArtworkItems(selectItems) !== selectItems.length) {
                    throw new Error('Illustrator did not select every layer artwork item.');
                }
                try { doc.activeLayer = selectLayer; } catch (setActive) {}
            } finally {
                restorePageItemStates(selectItemStates);
                restoreLayerStates(selectLayerStates);
            }
            if (
                selectItems.length > 0 &&
                selectedArtworkItemCount(selectItems) !== selectItems.length
            ) {
                selectArtworkItems([]);
                throw new Error(
                    'Illustrator could not retain the complete layer artwork selection.'
                );
            }
        } else if (op === 'placeartwork') {
            var artworkSourceKey = args.sourceKey ? String(args.sourceKey) : '';
            var artworkSourceLayer = artworkSourceKey
                ? resolveLayerByKey(artworkSourceKey)
                : null;
            if (artworkSourceKey && !artworkSourceLayer) {
                return fail('Artwork source layer was not found.');
            }
            var artworkTargetKey = args.targetKey ? String(args.targetKey) : '';
            var artworkTargetLayer = resolveLayerByKey(artworkTargetKey);
            if (!artworkTargetLayer) {
                return fail('Artwork target layer was not found.');
            }
            var sameArtworkLayer = artworkSourceKey !== '' &&
                artworkSourceKey === artworkTargetKey;
            var copyArtwork = args.copy ? true : false;
            if (sameArtworkLayer && !copyArtwork) {
                return successSnapshot();
            }
            var artworkPreviousActiveLayer = doc.activeLayer;
            var artworkLayerStates = [];
            var artworkStates = [];
            var completedArtwork = [];
            var copiedArtworkSelection = [];
            var placedArtworkSelection = [];
            var artworkItems = [];
            var artworkPositions = [];
            var artworkIndex;
            try {
                if (artworkSourceLayer) {
                    openAncestors(artworkSourceLayer, artworkLayerStates);
                    openSubtree(artworkSourceLayer, artworkLayerStates);
                    var artworkPlan = layerArtworkPlan(artworkSourceLayer);
                    artworkItems = artworkPlan.items;
                    artworkPositions = artworkPlan.positions;
                } else {
                    artworkItems = selectedArtworkItems();
                }
                if (artworkItems.length === 0) {
                    throw new Error(
                        artworkSourceLayer
                            ? 'The dragged layer does not contain artwork.'
                            : 'Select one or more Illustrator objects before dragging the selection square.'
                    );
                }
                for (artworkIndex = 0; artworkIndex < artworkItems.length; artworkIndex += 1) {
                    var artworkState = rememberArtworkState(
                        artworkItems[artworkIndex],
                        artworkSourceLayer ? artworkPositions[artworkIndex] : null
                    );
                    if (!artworkState.parent) {
                        throw new Error('A selected Illustrator object does not have a movable parent.');
                    }
                    artworkStates.push(artworkState);
                }
                for (artworkIndex = 0; artworkIndex < artworkItems.length; artworkIndex += 1) {
                    var itemSourceLayer = owningLayerForSelectedObject(artworkItems[artworkIndex]);
                    if (itemSourceLayer) {
                        openAncestors(itemSourceLayer, artworkLayerStates);
                    }
                }
                openAncestors(artworkTargetLayer, artworkLayerStates);
                try {
                    // PLACEATBEGINNING reverses each insertion, so walk the
                    // source artwork backward to retain its visual order in the target layer.
                    for (artworkIndex = artworkStates.length - 1; artworkIndex >= 0; artworkIndex -= 1) {
                        var currentArtworkState = artworkStates[artworkIndex];
                        openArtworkItem(currentArtworkState);
                        if (copyArtwork) {
                            var copiedArtwork = currentArtworkState.item.duplicate(
                                artworkTargetLayer,
                                ElementPlacement.PLACEATBEGINNING
                            );
                            completedArtwork.push({
                                item: copiedArtwork,
                                state: currentArtworkState,
                                copied: true
                            });
                            copiedArtworkSelection.unshift(copiedArtwork);
                            try { copiedArtwork.hidden = currentArtworkState.hidden; } catch (copyHiddenError) {}
                            try { copiedArtwork.locked = currentArtworkState.locked; } catch (copyLockedError) {}
                        } else {
                            if (
                                owningLayerForSelectedObject(currentArtworkState.item) === artworkTargetLayer
                            ) {
                                continue;
                            }
                            currentArtworkState.item.move(
                                artworkTargetLayer,
                                ElementPlacement.PLACEATBEGINNING
                            );
                            completedArtwork.push({
                                item: currentArtworkState.item,
                                state: currentArtworkState,
                                copied: false
                            });
                        }
                    }
                    placedArtworkSelection = copyArtwork ? copiedArtworkSelection : artworkItems;
                    try { doc.activeLayer = artworkTargetLayer; } catch (activeLayerError) {}
                } catch (artworkError) {
                    var artworkRollbackFailed = false;
                    for (var rollbackIndex = completedArtwork.length - 1; rollbackIndex >= 0; rollbackIndex -= 1) {
                        try {
                            completedArtwork[rollbackIndex].item.locked = false;
                        } catch (rollbackUnlockError) {}
                        try {
                            completedArtwork[rollbackIndex].item.hidden = false;
                        } catch (rollbackShowError) {}
                        try {
                            if (completedArtwork[rollbackIndex].copied) {
                                completedArtwork[rollbackIndex].item.remove();
                            } else {
                                restoreArtworkParent(completedArtwork[rollbackIndex].state);
                            }
                        } catch (artworkRollbackError) {
                            artworkRollbackFailed = true;
                        }
                    }
                    try { doc.activeLayer = artworkPreviousActiveLayer; } catch (rollbackActiveLayerError) {}
                    if (artworkRollbackFailed) {
                        throw new Error(
                            String(artworkError) +
                            ' Artwork rollback could not restore every completed item.'
                        );
                    }
                    throw artworkError;
                }
            } finally {
                for (var restoreArtworkIndex = 0;
                    restoreArtworkIndex < artworkStates.length;
                    restoreArtworkIndex += 1) {
                    restoreArtworkState(artworkStates[restoreArtworkIndex]);
                }
                restoreLayerStates(artworkLayerStates);
            }
            var selectableArtwork = [];
            for (artworkIndex = 0; artworkIndex < placedArtworkSelection.length; artworkIndex += 1) {
                if (artworkItemCanRemainSelected(placedArtworkSelection[artworkIndex])) {
                    selectableArtwork.push(placedArtworkSelection[artworkIndex]);
                }
            }
            if (selectArtworkItems(selectableArtwork) !== selectableArtwork.length) {
                clearArtworkSelection();
            }
        } else if (op === 'move') {
            var moveLayer = resolveLayerByKey(args.key);
            if (!moveLayer) {
                return fail('Layer to move was not found.');
            }
            var requestedTargetKey = args.targetKey ? String(args.targetKey) : '';
            var moveTarget = resolveLayerByKey(requestedTargetKey);
            if (requestedTargetKey && !moveTarget) {
                return fail('Move target layer was not found.');
            }
            var canonicalMoveKey = keyForLayer(moveLayer);
            var canonicalTargetKey = moveTarget ? keyForLayer(moveTarget) : null;
            if (
                canonicalMoveKey !== null && canonicalTargetKey !== null &&
                (canonicalTargetKey === canonicalMoveKey ||
                    canonicalTargetKey.indexOf(canonicalMoveKey + '.') === 0)
            ) {
                return fail('A layer cannot be moved into itself or one of its descendants.');
            }
            var moveStates = [];
            try {
                openAncestors(moveLayer, moveStates);
                if (moveTarget) {
                    openAncestors(moveTarget, moveStates);
                    moveLayer.move(moveTarget, ElementPlacement.PLACEATBEGINNING);
                } else {
                    // No target -> promote to a top-level layer.
                    moveLayer.move(doc, ElementPlacement.PLACEATBEGINNING);
                }
            } finally {
                restoreLayerStates(moveStates);
            }
        } else {
            return fail('Unknown layers op: ' + op);
        }

        app.redraw();

        return successSnapshot();
    } catch (error) {
        return fail(error && error.message ? error.message : String(error));
    }
}());
