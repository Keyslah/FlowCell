#target illustrator

(function () {
    var LOG_PATH = Folder.temp.fsName + "/Illustrator_Save_Selected_PNG_By_Sublayer.log";

    function resetLog() {
        try {
            var file = new File(LOG_PATH);
            if (file.exists) {
                file.remove();
            }
        } catch (ignore) {
        }
    }

    function logLine(message) {
        try {
            var file = new File(LOG_PATH);
            file.encoding = "UTF-8";
            file.open("a");
            file.writeln(message);
            file.close();
        } catch (ignore) {
        }
    }

    function fail(message) {
        logLine("FAIL: " + message);
        alert("Save PNG failed:\n" + message);
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

    function getCombinedVisibleBounds(items) {
        var left = null;
        var top = null;
        var right = null;
        var bottom = null;
        var i;
        var bounds;

        for (i = 0; i < items.length; i += 1) {
            try {
                bounds = items[i].visibleBounds;
            } catch (ignore) {
                bounds = null;
            }

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

    resetLog();

    if (app.documents.length === 0) {
        fail("Open an Illustrator document first.");
        return;
    }

    var doc = app.activeDocument;
    var selection = normalizeSelection(doc.selection);
    var srcRoot;
    var imagesFolder;
    var exportName;
    var exportStem;
    var expectedOutput;
    var rawOutput;
    var clipBounds;
    var captureOptions;

    logLine("Document: " + safeString(doc.name));
    logLine("Selection count: " + selection.length);

    if (selection.length === 0) {
        fail("Select artwork to save as a PNG.");
        return;
    }

    if (!doc.saved) {
        fail("Save the Illustrator file first.");
        return;
    }

    try {
        srcRoot = findSrcRoot(doc.fullName.parent);
        if (!srcRoot) {
            throw new Error("Could not find the project's 01 src folder from this Illustrator file.");
        }

        imagesFolder = ensureFolder(new Folder(srcRoot.fsName + "/04 assets/01 images"));
        exportName = resolveExportName(selection, doc);
        exportStem = new File(imagesFolder.fsName + "/" + exportName);
        expectedOutput = new File(imagesFolder.fsName + "/" + exportName + ".png");
        rawOutput = new File(imagesFolder.fsName + "/" + exportName);
        clipBounds = getCombinedVisibleBounds(selection);

        logLine("Export name: " + exportName);
        logLine("Clip bounds: " + clipBounds.join(", "));
        logLine("Output path: " + expectedOutput.fsName);

        if (expectedOutput.exists) {
            try {
                expectedOutput.remove();
            } catch (ignoreRemove) {
            }
        }
        if (rawOutput.exists) {
            try {
                rawOutput.remove();
            } catch (ignoreRemoveRaw) {
            }
        }

        captureOptions = new ImageCaptureOptions();
        captureOptions.antiAliasing = true;
        captureOptions.transparency = true;
        captureOptions.matte = false;
        captureOptions.resolution = 300;

        doc.imageCapture(exportStem, clipBounds, captureOptions);

        if (!expectedOutput.exists && rawOutput.exists) {
            try {
                rawOutput.rename(expectedOutput.name);
            } catch (renameError) {
                throw new Error("Illustrator created the export without a .png extension, and renaming failed.");
            }
        }

        if (!expectedOutput.exists) {
            throw new Error("Illustrator reported success but did not create the PNG file.");
        }

        logLine("SUCCESS");
        alert("Saved PNG:\n" + expectedOutput.fsName);
    } catch (err) {
        fail(safeString(err.message || err));
    }
}());
