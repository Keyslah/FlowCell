#target illustrator

(function () {
    var CONTEXT_PATH = Folder.temp.fsName + "/FlowCell_Selected_Litho_PNG_Context.txt";
    var DEFAULT_IMAGES_FOLDER_PATH = Folder.temp.fsName + "/FlowCell_Litho_Default_Images_Folder.txt";

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
        if (!file.open("w")) {
            throw new Error("Could not open the litho context file for writing.");
        }
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

    function readDefaultImagesFolder() {
        var file = new File(DEFAULT_IMAGES_FOLDER_PATH);
        var text;

        if (!file.exists) {
            return null;
        }

        try {
            file.encoding = "UTF-8";
            if (!file.open("r")) {
                return null;
            }
            text = file.read();
            file.close();
        } catch (ignore) {
            try {
                file.close();
            } catch (ignoreClose) {
            }
            return null;
        }

        text = safeString(text).replace(/^\s+|\s+$/g, "");
        if (text === "") {
            return null;
        }

        return new Folder(text);
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

    function isClippingPath(item) {
        try {
            return !!item.clipping;
        } catch (ignore) {
            return false;
        }
    }

    function findClippingPathInGroup(groupItem) {
        var i;
        var child;
        var nested;

        if (!groupItem) {
            return null;
        }

        try {
            for (i = 0; i < groupItem.pageItems.length; i += 1) {
                child = groupItem.pageItems[i];
                if (!child) {
                    continue;
                }
                if (isClippingPath(child)) {
                    return child;
                }
                if (child.typename === "GroupItem") {
                    nested = findClippingPathInGroup(child);
                    if (nested) {
                        return nested;
                    }
                }
            }
        } catch (ignoreWalk) {
        }

        return null;
    }

    function findClippingPathForItem(item) {
        var current = item;
        var candidate;

        if (isClippingPath(item)) {
            return item;
        }

        while (current) {
            try {
                if (current.typename === "GroupItem") {
                    candidate = findClippingPathInGroup(current);
                    if (candidate) {
                        return candidate;
                    }
                }
                current = current.parent;
            } catch (ignoreParent) {
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

    function sanitizeFileName(name) {
        var cleaned = safeString(name).replace(/[\\\/:*?"<>|]/g, "_");
        cleaned = cleaned.replace(/^\s+|\s+$/g, "");
        return cleaned !== "" ? cleaned : "selection";
    }

    function isSystemRootName(name) {
        if (!name) {
            return false;
        }

        name = safeString(name);
        return name === "Live" || name === "Snapshots" || name === "Trash" || name === "Archive";
    }

    function resolveExportName(selection, doc) {
        var layerRef = getNamingLayer(selection[0], doc);

        if (layerRef && layerRef.name && !isSystemRootName(layerRef.name)) {
            return sanitizeFileName(layerRef.name);
        }

        try {
            if (selection[0].name && selection[0].name !== "") {
                return sanitizeFileName(selection[0].name);
            }
        } catch (ignore) {
        }

        return "selection";
    }

    function getBoundsForItem(item) {
        var bounds = null;
        var clippingPath = findClippingPathForItem(item);

        if (clippingPath) {
            try {
                bounds = clippingPath.geometricBounds;
            } catch (ignoreClipGeometric) {
                bounds = null;
            }
            if (bounds) {
                return bounds;
            }
            try {
                bounds = clippingPath.visibleBounds;
            } catch (ignoreClipVisible) {
                bounds = null;
            }
            if (bounds) {
                return bounds;
            }
        }

        try {
            bounds = item.geometricBounds;
        } catch (ignoreGeometric) {
            bounds = null;
        }

        if (bounds) {
            return bounds;
        }

        try {
            bounds = item.visibleBounds;
        } catch (ignoreVisible) {
            bounds = null;
        }

        return bounds;
    }

    function getCombinedSelectionBounds(items) {
        var left = null;
        var top = null;
        var right = null;
        var bottom = null;
        var i;
        var bounds;

        for (i = 0; i < items.length; i += 1) {
            bounds = getBoundsForItem(items[i]);
            if (!bounds) {
                continue;
            }

            if (left === null || bounds[0] < left) {
                left = bounds[0];
            }
            if (top === null || bounds[1] > top) {
                top = bounds[1];
            }
            if (right === null || bounds[2] > right) {
                right = bounds[2];
            }
            if (bottom === null || bounds[3] < bottom) {
                bottom = bounds[3];
            }
        }

        if (left === null) {
            throw new Error("Could not read selection bounds.");
        }

        return [left, top, right, bottom];
    }

    function pointsToMillimeters(pointsValue) {
        return Math.abs(pointsValue) * 25.4 / 72;
    }

    function formatDecimal(value) {
        var text = Number(value).toFixed(3);
        text = text.replace(/0+$/g, "");
        text = text.replace(/\.$/g, "");
        return text;
    }

    function buildSizedExportName(baseName, widthMm, heightMm) {
        return baseName + "__fcsize_" + formatDecimal(widthMm) + "x" + formatDecimal(heightMm) + "mm";
    }

    if (app.documents.length === 0) {
        fail("Open an Illustrator document first.");
        return;
    }

    try {
        var doc = app.activeDocument;
        var selection = normalizeSelection(doc.selection);
        var srcRoot;
        var imagesFolder;
        var documentFolder = null;
        var baseExportName;
        var clipBounds;
        var widthMm;
        var heightMm;
        var exportName;

        if (selection.length === 0) {
            throw new Error("Select artwork to export first.");
        }

        try {
            if (doc.saved) {
                documentFolder = doc.fullName.parent;
            }
        } catch (ignoreFullName) {
            documentFolder = null;
        }

        if (documentFolder) {
            srcRoot = findSrcRoot(documentFolder);
        } else {
            srcRoot = null;
        }

        if (srcRoot) {
            imagesFolder = ensureFolder(new Folder(srcRoot.fsName + "/04 assets/01 images"));
        } else {
            imagesFolder = readDefaultImagesFolder();
            if (!imagesFolder) {
                throw new Error("Save the Illustrator file first, or keep the target Blender project open.");
            }
            imagesFolder = ensureFolder(imagesFolder);
        }

        baseExportName = resolveExportName(selection, doc);
        clipBounds = getCombinedSelectionBounds(selection);
        widthMm = pointsToMillimeters(clipBounds[2] - clipBounds[0]);
        heightMm = pointsToMillimeters(clipBounds[1] - clipBounds[3]);
        exportName = buildSizedExportName(baseExportName, widthMm, heightMm);

        writeContext({
            Status: "Ready",
            AssetFolder: imagesFolder.fsName,
            AssetName: exportName,
            BaseName: baseExportName,
            WidthMm: String(widthMm),
            HeightMm: String(heightMm)
        });
    } catch (err) {
        fail(err && err.message ? err.message : err);
    }
}());
