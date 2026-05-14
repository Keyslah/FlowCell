// Description: Runs 07 Add Selected To Live.
#target illustrator

/*
 * Duplicates selected objects from outside Live into Live using a name derived
 * from the source target and version layer, for example:
 * Snapshots > now > s4           -> Live > now(s4)
 * Snapshots > now > s3 (blabla)  -> Live > now(s3) blabla
 */
(function () {
    var SCRIPT_VERSION = "2026-03-23 15:20";
    var LOG_PATH = Folder.temp.fsName + "/Illustrator_Add_Selected_To_Live_Debug.log";
    var ROOT_LIVE = "Live";
    var ROOT_SNAPSHOTS = "Snapshots";
    var ROOT_TRASH = "Trash";
    var ROOT_ARCHIVE = "Archive";

    if (app.documents.length === 0) {
        return;
    }

    var doc = app.activeDocument;
    var originalActiveLayer = doc.activeLayer;
    var roots = null;

    try {
        resetLog(doc);
        roots = ensureRootLayers(doc);
        roots.live.visible = true;
        roots.live.locked = false;

        var targets = resolveTargets(doc);
        var i;

        logLine("Resolved target count: " + targets.length);

        if (targets.length === 0) {
            return;
        }

        for (i = targets.length - 1; i >= 0; i -= 1) {
            addTargetToLive(roots.live, targets[i]);
        }
    } catch (err) {
        logLine("Exception: " + err);
    } finally {
        if (roots) {
            setSystemLayerState(roots.trash, false, true);
            setSystemLayerState(roots.archive, false, true);
            setSystemLayerState(roots.snapshots, true, false);
        }
        restoreActiveLayer(doc, originalActiveLayer);
    }

    function addTargetToLive(liveRoot, target) {
        var liveLayer = ensureChildLayer(liveRoot, target.liveName);
        var i;

        logLine("Add target: " + target.targetName + " [" + target.liveName + "] items=" + target.items.length);

        for (i = target.items.length - 1; i >= 0; i -= 1) {
            copyPageItemToLayer(target.items[i], liveLayer);
        }

        liveLayer.visible = true;
        liveLayer.locked = false;
    }

    function resolveTargets(documentRef) {
        var result = [];
        var selection = normalizeSelection(documentRef.selection);
        var i;

        logLine("Normalized selection count: " + selection.length);

        for (i = 0; i < selection.length; i += 1) {
            logLine("Selection[" + i + "]: " + describeItem(selection[i]));
            addResolvedTarget(result, selection[i]);
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

        key = buildTargetKey(resolved);
        for (i = 0; i < targets.length; i += 1) {
            if (targets[i].key === key) {
                addUniqueItem(targets[i].items, item);
                return;
            }
        }

        targets.push({
            key: key,
            targetName: resolved.targetName,
            versionToken: resolved.versionToken,
            versionNote: resolved.versionNote,
            liveName: formatLiveLayerName(resolved.targetName, resolved.versionToken, resolved.versionNote),
            items: [item]
        });

        logLine("Resolved source target: " + resolved.targetName +
            " version=" + (resolved.versionToken || "[none]") +
            " note=" + (resolved.versionNote || "[none]"));
    }

    function resolveSourceTarget(item) {
        var ownerLayer = getItemOwningLayer(item);
        var topLayer;
        var current;
        var versionLayer = null;
        var versionInfo;
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
            } catch (ignore1) {
                current = null;
            }
        }

        if (versionLayer) {
            current = versionLayer.parent;
            while (current && current !== topLayer) {
                if (!isOperationalLayerName(current.name)) {
                    targetName = getCanonicalTargetName(current.name);
                    break;
                }

                try {
                    current = current.parent;
                } catch (ignore2) {
                    current = null;
                }
            }

            if (!targetName) {
                targetName = getCanonicalTargetName(versionLayer.name);
            }

            versionInfo = parseVersionLayerName(versionLayer.name);
            return {
                targetName: sanitizeName(targetName),
                versionToken: versionInfo.token,
                versionNote: versionInfo.note
            };
        }

        current = ownerLayer;
        while (current && current !== topLayer) {
            if (!isOperationalLayerName(current.name)) {
                return {
                    targetName: sanitizeName(getCanonicalTargetName(current.name)),
                    versionToken: "",
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

    function buildTargetKey(resolved) {
        return [
            sanitizeName(resolved.targetName),
            (resolved.versionToken || "").toLowerCase(),
            resolved.versionNote || ""
        ].join("|");
    }

    function addUniqueItem(items, item) {
        var itemKey = getItemKey(item);
        var i;

        for (i = 0; i < items.length; i += 1) {
            if (getItemKey(items[i]) === itemKey) {
                return;
            }
        }

        items.push(item);
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

    function parseVersionLayerName(name) {
        var match = String(name).match(/^([sStTaA]\d+)(?:\s+(.+))?$/);
        var note = "";

        if (!match) {
            return {
                token: "",
                note: ""
            };
        }

        if (match[2]) {
            note = trimOuterParens(trimText(match[2]));
        }

        return {
            token: match[1].toLowerCase(),
            note: note
        };
    }

    function formatLiveLayerName(targetName, versionToken, versionNote) {
        var result = targetName;

        if (versionToken) {
            result += "(" + versionToken + ")";
        }

        if (versionNote) {
            result += " " + versionNote;
        }

        return result;
    }

    function copyPageItemToLayer(sourceItem, targetLayer) {
        var itemState = captureItemState(sourceItem);
        var duplicate;

        unlockItemFromState(itemState);
        duplicate = sourceItem.duplicate(targetLayer, ElementPlacement.PLACEATBEGINNING);

        try {
            duplicate.hidden = itemState.hidden;
        } catch (ignore1) {}

        try {
            duplicate.locked = itemState.locked;
        } catch (ignore2) {}

        restoreItemFromState(itemState);
    }

    function captureItemState(item) {
        return {
            ref: item,
            locked: safeRead(item, "locked", false),
            hidden: safeRead(item, "hidden", false)
        };
    }

    function unlockItemFromState(state) {
        try {
            state.ref.hidden = false;
        } catch (ignore1) {}

        try {
            state.ref.locked = false;
        } catch (ignore2) {}
    }

    function restoreItemFromState(state) {
        try {
            state.ref.hidden = state.hidden;
        } catch (ignore1) {}

        try {
            state.ref.locked = state.locked;
        } catch (ignore2) {}
    }

    function resetLog(documentRef) {
        var file = new File(LOG_PATH);

        if (file.exists) {
            try {
                file.remove();
            } catch (ignore) {}
        }

        logLine("Add Selected To Live version: " + SCRIPT_VERSION);
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

    function getCanonicalTargetName(name) {
        return String(name).replace(/\s+\([^()]*\)\s*$/, "");
    }

    function sanitizeName(name) {
        return String(name).replace(/[\\\/:*?"<>|]/g, "_");
    }

    function trimText(text) {
        return String(text).replace(/^\s+|\s+$/g, "");
    }

    function trimOuterParens(text) {
        var match = String(text).match(/^\((.*)\)$/);
        return match ? trimText(match[1]) : text;
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
