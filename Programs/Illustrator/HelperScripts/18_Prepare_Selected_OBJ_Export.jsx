// Description: Runs 18 Prepare Selected OBJ Export.
#target illustrator

(function () {
    var CONTEXT_PATH = Folder.temp.fsName + "/FlowCell_Selected_OBJ_Export_Context.txt";

    function writeContext(values) {
        var file = new File(CONTEXT_PATH);
        var key;

        if (file.exists) {
            try {
                file.remove();
            } catch (ignoreRemove) {
            }
        }

        file.encoding = "UTF-8";
        file.open("w");
        for (key in values) {
            if (values.hasOwnProperty(key)) {
                file.writeln(key + "=" + values[key]);
            }
        }
        file.close();
    }

    function fail(message) {
        writeContext({
            Status: "Error",
            Message: safeString(message)
        });
    }

    function safeString(value) {
        try {
            return String(value);
        } catch (ignore) {
            return "";
        }
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

    function getParentFolder(folderRef) {
        if (!folderRef) {
            return null;
        }

        try {
            if (!folderRef.parent || folderRef.parent.fsName === folderRef.fsName) {
                return null;
            }
            return folderRef.parent;
        } catch (ignore) {
            return null;
        }
    }

    function findSrcRoot(startFolder) {
        var current = startFolder;
        var candidate;

        while (current) {
            if (current.name === "01 src") {
                return current;
            }
            current = getParentFolder(current);
        }

        current = startFolder;
        while (current) {
            candidate = new Folder(current.fsName + "/01 src");
            if (candidate.exists) {
                return candidate;
            }
            current = getParentFolder(current);
        }

        return null;
    }

    function ensureFolder(folderRef) {
        var parentFolder;

        if (folderRef.exists) {
            return folderRef;
        }

        parentFolder = getParentFolder(folderRef);
        if (parentFolder && !parentFolder.exists) {
            ensureFolder(parentFolder);
        }

        if (!folderRef.create() && !folderRef.exists) {
            throw new Error("Could not create folder:\n" + folderRef.fsName);
        }

        return folderRef;
    }

    function getOwningLayer(item) {
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

    function getNamingLayer(item, doc) {
        var layerRef = getOwningLayer(item);
        var current = item;

        while (current) {
            try {
                if (current.parent && current.parent.typename === "Layer") {
                    layerRef = current.parent;
                    break;
                }
                current = current.parent;
            } catch (ignoreWalk) {
                current = null;
            }
        }

        if (layerRef && layerRef.name) {
            return layerRef;
        }

        try {
            if (doc.activeLayer) {
                return doc.activeLayer;
            }
        } catch (ignore) {
        }

        return null;
    }

    function isDLayerName(name) {
        return /^d\d+(?:\s.*)?$/i.test(safeString(name));
    }

    function findClosestDLayer(layerRef) {
        var current = layerRef;

        while (current && current.typename === "Layer") {
            if (isDLayerName(current.name)) {
                return current;
            }
            current = current.parent;
        }

        return null;
    }

    function isSystemRootName(name) {
        if (!name) {
            return false;
        }

        name = safeString(name);
        return /^3d$/i.test(name)
            || name === "Live"
            || name === "Snapshots"
            || name === "Trash"
            || name === "Archive";
    }

    function resolveAssetLayerForItem(item, doc) {
        var current = getNamingLayer(item, doc);
        var candidate = null;
        var dLayer;

        while (current && current.typename === "Layer") {
            dLayer = findClosestDLayer(current);
            if (dLayer === current) {
                if (current.parent && current.parent.typename === "Layer") {
                    return current.parent;
                }
                return null;
            }

            if (current.name && !isSystemRootName(current.name)) {
                candidate = current;
            }

            current = current.parent;
        }

        return candidate;
    }

    function resolveSingleAssetLayer(selection, doc) {
        var resolved = null;
        var i;
        var assetLayer;

        for (i = 0; i < selection.length; i += 1) {
            assetLayer = resolveAssetLayerForItem(selection[i], doc);
            if (!assetLayer) {
                continue;
            }

            if (!resolved) {
                resolved = assetLayer;
                continue;
            }

            if (resolved !== assetLayer) {
                throw new Error("Select artwork from only one named asset layer at a time.");
            }
        }

        if (!resolved) {
            throw new Error("Select artwork inside a named asset layer first.");
        }

        return resolved;
    }

    function sanitizeFileName(name) {
        var cleaned = safeString(name).replace(/[\\\/:*?"<>|]/g, "_");
        cleaned = cleaned.replace(/^\s+|\s+$/g, "");
        return cleaned !== "" ? cleaned : "asset";
    }

    function getLayerPath(layerRef) {
        var parts = [];
        var current = layerRef;

        while (current && current.typename === "Layer") {
            parts.unshift(current.name);
            current = current.parent;
        }

        return parts.join(" / ");
    }

    if (app.documents.length === 0) {
        fail("Open an Illustrator document first.");
        return;
    }

    try {
        var doc = app.activeDocument;
        var selection = normalizeSelection(doc.selection);
        var assetLayer;
        var srcRoot;
        var assets3dFolder;
        var assetName;
        var documentFile = null;

        if (selection.length === 0) {
            throw new Error("Select the 3D object you want to export first.");
        }

        try {
            documentFile = doc.fullName;
        } catch (ignoreFullName) {
            documentFile = null;
        }

        if (!documentFile) {
            throw new Error("Save the Illustrator file into the project folder first.");
        }

        assetLayer = resolveSingleAssetLayer(selection, doc);
        if (!assetLayer || assetLayer.typename !== "Layer" || isSystemRootName(assetLayer.name)) {
            throw new Error("Select artwork inside a named asset layer, not directly under a system root.");
        }

        srcRoot = findSrcRoot(documentFile.parent);
        if (!srcRoot) {
            throw new Error("Could not find the project's 01 src folder from this Illustrator file.");
        }

        assets3dFolder = ensureFolder(new Folder(srcRoot.fsName + "/04 assets/03 3d"));
        assetName = sanitizeFileName(assetLayer.name);

        writeContext({
            Status: "Ready",
            AssetName: assetName,
            ExportPath: assets3dFolder.fsName + "/" + assetName + ".obj",
            AssetFolder: assets3dFolder.fsName,
            AssetLayerPath: getLayerPath(assetLayer),
            DocumentPath: documentFile.fsName
        });
    } catch (err) {
        fail(err && err.message ? err.message : err);
    }
}());
