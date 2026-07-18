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
            var doomed = normalizedLayerTargets(args.keys);
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
            var dupTargets = normalizedLayerTargets(args.keys);
            var duplicateStates = [];
            try {
                for (var u = 0; u < dupTargets.length; u += 1) {
                    var duplicateLocked = dupTargets[u].layer.locked ? true : false;
                    var duplicateVisible = dupTargets[u].layer.visible ? true : false;
                    openAncestors(dupTargets[u].layer, duplicateStates);
                    var duplicatedLayer = dupTargets[u].layer.duplicate();
                    try { duplicatedLayer.visible = duplicateVisible; } catch (duplicateVisibleError) {}
                    try { duplicatedLayer.locked = duplicateLocked; } catch (duplicateLockedError) {}
                }
            } finally {
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
                try { doc.selection = null; } catch (clearSel) {}
                if (selectItems.length > 0) {
                    try { doc.selection = selectItems; } catch (setSel) {}
                }
                try { doc.activeLayer = selectLayer; } catch (setActive) {}
            } finally {
                restorePageItemStates(selectItemStates);
                restoreLayerStates(selectLayerStates);
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

        var activeKey = keyForLayer(doc.activeLayer);
        return '{"ok":true,"active":' + jsonString(activeKey === null ? '' : activeKey) +
            ',"tree":' + buildTree() + '}';
    } catch (error) {
        return fail(error && error.message ? error.message : String(error));
    }
}());
