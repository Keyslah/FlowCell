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

    function unlockAndShow(layer) {
        // Highlighting locked/hidden rows is allowed; operations temporarily clear
        // those flags on the target (and its ancestors) so the edit can proceed.
        if (layer.locked) {
            layer.locked = false;
        }
        if (!layer.visible) {
            layer.visible = true;
        }
    }

    function openAncestors(layer) {
        var current = layer;
        while (current && current.typename === 'Layer') {
            try { current.locked = false; } catch (e1) {}
            try { current.visible = true; } catch (e2) {}
            current = (current.parent && current.parent.typename === 'Layer') ? current.parent : null;
        }
    }

    function openSubtree(layer) {
        try { layer.locked = false; } catch (e1) {}
        try { layer.visible = true; } catch (e2) {}
        for (var i = 0; i < layer.layers.length; i += 1) {
            openSubtree(layer.layers[i]);
        }
    }

    function collectPageItems(layer, bucket) {
        var i;
        for (i = 0; i < layer.pageItems.length; i += 1) {
            var item = layer.pageItems[i];
            try { if (item.locked) { item.locked = false; } } catch (e1) {}
            try { if (item.hidden) { item.hidden = false; } } catch (e2) {}
            bucket.push(item);
        }
        for (i = 0; i < layer.layers.length; i += 1) {
            collectPageItems(layer.layers[i], bucket);
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

    try {
        if (op === 'scan') {
            // No mutation; fall through to return the tree.
        } else if (op === 'create') {
            var parentLayer = resolveLayerByKey(args.parentKey);
            var requestedName = args.name ? String(args.name) : 'Layer';
            var hostLayers;
            if (parentLayer) {
                unlockAndShow(parentLayer);
                hostLayers = parentLayer.layers;
            } else {
                hostLayers = doc.layers;
            }
            var created = hostLayers.add();
            created.name = uniqueChildName(hostLayers, requestedName);
            created.visible = true;
            created.locked = false;
            doc.activeLayer = created;
        } else if (op === 'rename') {
            var renameTarget = resolveLayerByKey(args.key);
            if (!renameTarget) {
                return fail('Layer to rename was not found.');
            }
            var wasLocked = renameTarget.locked;
            if (wasLocked) {
                renameTarget.locked = false;
            }
            renameTarget.name = args.name ? String(args.name) : renameTarget.name;
            renameTarget.locked = wasLocked;
        } else if (op === 'delete') {
            var deleteKeys = asKeyList(args.keys);
            var force = args.force ? true : false;
            var doomed = [];
            for (var d = 0; d < deleteKeys.length; d += 1) {
                var doomedLayer = resolveLayerByKey(deleteKeys[d]);
                if (doomedLayer) {
                    doomed.push(doomedLayer);
                }
            }
            // Resolve to references first, then remove, so index shifts do not matter.
            for (var r = 0; r < doomed.length; r += 1) {
                if (force) {
                    unlockAndShow(doomed[r]);
                }
                try {
                    doomed[r].remove();
                } catch (removeError) {
                    if (!force) {
                        return fail('Layer is locked or hidden. Use force delete.');
                    }
                    throw removeError;
                }
            }
        } else if (op === 'duplicate') {
            var dupKeys = asKeyList(args.keys);
            var dupTargets = [];
            for (var u = 0; u < dupKeys.length; u += 1) {
                var dupLayer = resolveLayerByKey(dupKeys[u]);
                if (dupLayer) {
                    dupTargets.push(dupLayer);
                }
            }
            for (var t = 0; t < dupTargets.length; t += 1) {
                dupTargets[t].duplicate();
            }
        } else if (op === 'setlock') {
            var lockKeys = asKeyList(args.keys);
            var lockValue = args.locked ? true : false;
            for (var l = 0; l < lockKeys.length; l += 1) {
                var lockLayer = resolveLayerByKey(lockKeys[l]);
                if (lockLayer) {
                    lockLayer.locked = lockValue;
                }
            }
        } else if (op === 'setvis') {
            var visKeys = asKeyList(args.keys);
            var visValue = args.visible ? true : false;
            for (var v = 0; v < visKeys.length; v += 1) {
                var visLayer = resolveLayerByKey(visKeys[v]);
                if (visLayer) {
                    visLayer.visible = visValue;
                }
            }
        } else if (op === 'select') {
            // Illustrator-style "target" click: select all artwork on the layer
            // (and its sublayers), temporarily unlocking/unhiding so it can be
            // selected, and make it the active layer.
            var selectLayer = resolveLayerByKey(args.key);
            if (!selectLayer) {
                return fail('Layer to select was not found.');
            }
            openAncestors(selectLayer);
            openSubtree(selectLayer);
            var selectItems = [];
            collectPageItems(selectLayer, selectItems);
            try { doc.selection = null; } catch (clearSel) {}
            if (selectItems.length > 0) {
                try { doc.selection = selectItems; } catch (setSel) {}
            }
            try { doc.activeLayer = selectLayer; } catch (setActive) {}
        } else if (op === 'move') {
            var moveLayer = resolveLayerByKey(args.key);
            if (!moveLayer) {
                return fail('Layer to move was not found.');
            }
            var moveTarget = resolveLayerByKey(args.targetKey);
            unlockAndShow(moveLayer);
            if (moveTarget) {
                unlockAndShow(moveTarget);
                moveLayer.move(moveTarget, ElementPlacement.PLACEATBEGINNING);
            } else {
                // No target -> promote to a top-level layer.
                moveLayer.move(doc, ElementPlacement.PLACEATBEGINNING);
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
