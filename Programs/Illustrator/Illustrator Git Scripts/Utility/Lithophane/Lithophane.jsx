#target illustrator

(function () {
    var REQUEST_FILE_NAME = "lithophane.request.json";
    var STATUS_FILE_NAME = "lithophane.status.txt";
    var HANDOFF_FILE_NAME = "Send-Lithophane-To-Blender.vbs";
    var STATUS_TIMEOUT_MS = 300000;
    var STATUS_POLL_MS = 250;
    var POINTS_TO_MILLIMETERS = 25.4 / 72;

    function safeString(value) {
        try {
            return String(value);
        } catch (ignore) {
            return "";
        }
    }

    function trim(value) {
        return safeString(value).replace(/^\s+|\s+$/g, "");
    }

    function isFiniteNumber(value) {
        var number = Number(value);
        return !isNaN(number) && isFinite(number);
    }

    function pointsToMillimeters(points) {
        return Number(points) * POINTS_TO_MILLIMETERS;
    }

    function normalizeSelection(rawSelection) {
        var result = [];
        var hasCollectionShape;
        var i;

        if (!rawSelection) {
            return result;
        }

        hasCollectionShape = !rawSelection.typename && typeof rawSelection.length === "number";
        if (hasCollectionShape) {
            for (i = 0; i < rawSelection.length; i += 1) {
                if (rawSelection[i]) {
                    result.push(rawSelection[i]);
                }
            }
            return result;
        }

        if (rawSelection.typename) {
            result.push(rawSelection);
        }
        return result;
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

    function readOwningLayerName(item) {
        var ownerLayer = getNearestOwningLayer(item);
        var ownerName;

        if (!ownerLayer) {
            throw new Error("The selected PNG is not owned by an Illustrator layer.");
        }
        ownerName = safeString(ownerLayer.name);
        if (trim(ownerName) === "") {
            throw new Error("The selected PNG's owning Illustrator layer has no name.");
        }
        return ownerName;
    }

    function isClippingPath(item) {
        try {
            return !!item && item.typename === "PathItem" && item.clipping === true;
        } catch (ignore) {
            return false;
        }
    }

    function findDirectClippingPathInGroup(groupItem) {
        var child;
        var i;

        if (!groupItem || groupItem.typename !== "GroupItem") {
            return null;
        }
        try {
            if (groupItem.clipped !== true) {
                return null;
            }
        } catch (ignoreClippedState) {
            return null;
        }

        try {
            for (i = 0; i < groupItem.pageItems.length; i += 1) {
                child = groupItem.pageItems[i];
                if (isClippingPath(child)) {
                    return child;
                }
            }
        } catch (ignoreWalk) {
        }
        return null;
    }

    function findClippingPathForItem(item) {
        var current = item;
        var candidate;

        while (current) {
            try {
                if (current.typename === "GroupItem") {
                    candidate = findDirectClippingPathInGroup(current);
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

    function requiresAppearanceCapture(item) {
        var matrix;
        var a;
        var b;
        var c;
        var d;
        var epsilon = 0.00000001;

        try {
            matrix = item.matrix;
        } catch (ignoreMatrix) {
            return true;
        }
        if (!matrix) {
            return true;
        }

        a = Number(matrix.mValueA);
        b = Number(matrix.mValueB);
        c = Number(matrix.mValueC);
        d = Number(matrix.mValueD);
        if (!isFiniteNumber(a) || !isFiniteNumber(b) ||
                !isFiniteNumber(c) || !isFiniteNumber(d)) {
            return true;
        }

        return Math.abs(b) > epsilon || Math.abs(c) > epsilon || a <= 0 || d <= 0;
    }

    function validateGeometricBounds(bounds, label) {
        var left;
        var top;
        var right;
        var bottom;

        if (!bounds || bounds.length !== 4) {
            throw new Error(label + " does not expose four Illustrator geometric bounds.");
        }

        left = Number(bounds[0]);
        top = Number(bounds[1]);
        right = Number(bounds[2]);
        bottom = Number(bounds[3]);
        if (!isFiniteNumber(left) || !isFiniteNumber(top) ||
                !isFiniteNumber(right) || !isFiniteNumber(bottom) ||
                right <= left || top <= bottom) {
            throw new Error(label + " has invalid or zero-size Illustrator geometric bounds.");
        }
        return [left, top, right, bottom];
    }

    function readOwnGeometricBounds(item, label) {
        var bounds;
        try {
            bounds = item.geometricBounds;
        } catch (boundsError) {
            throw new Error("Could not read " + label + " Illustrator geometric bounds.");
        }
        return validateGeometricBounds(bounds, label);
    }

    function readGeometricBounds(item) {
        var clippingPath = findClippingPathForItem(item);
        return readOwnGeometricBounds(clippingPath || item, "The selected PNG");
    }

    function inspectPngSource(item) {
        var itemType = safeString(item && item.typename);
        var fileRef;
        var filePath;
        var fileName;
        var embedded = false;

        if (itemType !== "PlacedItem" && itemType !== "RasterItem") {
            throw new Error("Select exactly one PNG PlacedItem or RasterItem.");
        }

        if (itemType === "RasterItem") {
            try {
                embedded = item.embedded === true;
            } catch (ignoreEmbeddedState) {
                embedded = true;
            }
        }

        if (!embedded) {
            try {
                fileRef = item.file;
            } catch (fileError) {
                fileRef = null;
            }
        }
        if (fileRef) {
            filePath = trim(fileRef.fsName);
            fileName = trim(fileRef.name || filePath.replace(/^.*[\\\/]/, ""));
            if (fileName !== "" && !/\.png$/i.test(fileName)) {
                throw new Error("The selected image must be a PNG, not " + fileName + ".");
            }
            if (fileRef.exists && filePath !== "") {
                return {
                    kind: "linked",
                    imagePath: filePath,
                    fileName: fileName
                };
            }
            if (itemType === "PlacedItem" && fileName === "") {
                throw new Error("Illustrator cannot verify that the unavailable placed image is a PNG.");
            }
        }
        if (itemType === "PlacedItem" && !fileRef) {
            throw new Error("Illustrator cannot verify that the unavailable placed image is a PNG.");
        }

        return {
            kind: "export",
            imagePath: "",
            fileName: fileName || safeString(item.name) || "selection"
        };
    }

    function resolveSelectedPng(rawSelection) {
        var selection = normalizeSelection(rawSelection);
        var item;
        var bounds;
        var widthMm;
        var heightMm;

        if (selection.length !== 1) {
            throw new Error("Select exactly one PNG PlacedItem or RasterItem.");
        }

        item = selection[0];
        bounds = readGeometricBounds(item);
        widthMm = pointsToMillimeters(bounds[2] - bounds[0]);
        heightMm = pointsToMillimeters(bounds[1] - bounds[3]);
        if (!isFiniteNumber(widthMm) || widthMm <= 0 ||
                !isFiniteNumber(heightMm) || heightMm <= 0) {
            throw new Error("The selected PNG does not have positive physical X/Y dimensions.");
        }

        return {
            item: item,
            source: inspectPngSource(item),
            clippingPath: findClippingPathForItem(item),
            captureAppearance: requiresAppearanceCapture(item),
            objectName: readOwningLayerName(item),
            itemBounds: readOwnGeometricBounds(item, "The selected PNG"),
            imagePath: "",
            widthMm: widthMm,
            heightMm: heightMm,
            bounds: bounds
        };
    }

    function jsonQuote(value) {
        var input = safeString(value);
        var result = '"';
        var character;
        var code;
        var hex;
        var i;

        for (i = 0; i < input.length; i += 1) {
            character = input.charAt(i);
            code = input.charCodeAt(i);
            if (character === '"') {
                result += '\\"';
            } else if (character === "\\") {
                result += "\\\\";
            } else if (character === "\b") {
                result += "\\b";
            } else if (character === "\f") {
                result += "\\f";
            } else if (character === "\n") {
                result += "\\n";
            } else if (character === "\r") {
                result += "\\r";
            } else if (character === "\t") {
                result += "\\t";
            } else if (code < 32) {
                hex = code.toString(16);
                while (hex.length < 4) {
                    hex = "0" + hex;
                }
                result += "\\u" + hex;
            } else {
                result += character;
            }
        }
        return result + '"';
    }

    function buildRequestJson(requestId, selectedPng) {
        return [
            "{",
            '  "schemaVersion": 1,',
            '  "requestId": ' + jsonQuote(requestId) + ",",
            '  "imagePath": ' + jsonQuote(selectedPng.imagePath) + ",",
            '  "objectName": ' + jsonQuote(selectedPng.objectName) + ",",
            '  "widthMm": ' + String(selectedPng.widthMm) + ",",
            '  "heightMm": ' + String(selectedPng.heightMm),
            "}",
            ""
        ].join("\n");
    }

    function parseStatusText(text) {
        var normalized = safeString(text).replace(/^\ufeff/, "");
        var lines = normalized.split(/\r\n|\n|\r/);
        var result = {};
        var separatorIndex;
        var key;
        var i;

        for (i = 0; i < lines.length; i += 1) {
            separatorIndex = lines[i].indexOf("=");
            if (separatorIndex <= 0) {
                continue;
            }
            key = trim(lines[i].substring(0, separatorIndex));
            result[key] = lines[i].substring(separatorIndex + 1);
        }
        return result;
    }

    function getTestHost() {
        try {
            if (typeof $ !== "undefined" && $.global) {
                return $.global;
            }
        } catch (ignoreTestHost) {
        }
        return null;
    }

    var testHost = getTestHost();
    if (testHost && testHost.__FLOWCELL_ILLUSTRATOR_LITHOPHANE_TEST__ === true) {
        testHost.__FLOWCELL_ILLUSTRATOR_LITHOPHANE_TEST_API__ = {
            normalizeSelection: normalizeSelection,
            getNearestOwningLayer: getNearestOwningLayer,
            readOwningLayerName: readOwningLayerName,
            findClippingPathForItem: findClippingPathForItem,
            requiresAppearanceCapture: requiresAppearanceCapture,
            validateGeometricBounds: validateGeometricBounds,
            readOwnGeometricBounds: readOwnGeometricBounds,
            readGeometricBounds: readGeometricBounds,
            inspectPngSource: inspectPngSource,
            resolveSelectedPng: resolveSelectedPng,
            mapAuthorityBoundsToDuplicate: mapAuthorityBoundsToDuplicate,
            pointsToMillimeters: pointsToMillimeters,
            buildRequestJson: buildRequestJson,
            parseStatusText: parseStatusText
        };
        return;
    }

    function ensureFolder(folderRef) {
        if (folderRef.exists) {
            return folderRef;
        }
        if (!folderRef.create() && !folderRef.exists) {
            throw new Error("Could not create Lithophane runtime folder: " + folderRef.fsName);
        }
        return folderRef;
    }

    function sanitizeFileName(value) {
        var cleaned = trim(value).replace(/[\x00-\x1f\\\/:*?"<>|]/g, "_");
        cleaned = cleaned.replace(/[\. ]+$/g, "");
        return cleaned || "selection";
    }

    function closeTemporaryDocument(documentRef, originalDocument) {
        if (documentRef) {
            try {
                documentRef.close(SaveOptions.DONOTSAVECHANGES);
            } catch (ignoreClose) {
            }
        }
        try {
            originalDocument.activate();
        } catch (ignoreReactivate) {
        }
    }

    function mapAuthorityBoundsToDuplicate(selectedPng, duplicateBounds) {
        var originalBounds = selectedPng.itemBounds;
        var authorityBounds = selectedPng.bounds;
        var originalWidth = originalBounds[2] - originalBounds[0];
        var originalHeight = originalBounds[1] - originalBounds[3];
        var duplicateWidth = duplicateBounds[2] - duplicateBounds[0];
        var duplicateHeight = duplicateBounds[1] - duplicateBounds[3];
        var scaleX = duplicateWidth / originalWidth;
        var scaleY = duplicateHeight / originalHeight;

        return validateGeometricBounds([
            duplicateBounds[0] + (authorityBounds[0] - originalBounds[0]) * scaleX,
            duplicateBounds[1] + (authorityBounds[1] - originalBounds[1]) * scaleY,
            duplicateBounds[0] + (authorityBounds[2] - originalBounds[0]) * scaleX,
            duplicateBounds[1] + (authorityBounds[3] - originalBounds[1]) * scaleY
        ], "The temporary PNG capture");
    }

    function exportSelectedPng(originalDocument, selectedPng, exportFolder, requestId) {
        var temporaryDocument = null;
        var temporaryLayer;
        var duplicate;
        var duplicateBounds;
        var captureBounds;
        var captureOptions;
        var baseName = sanitizeFileName(selectedPng.source.fileName.replace(/\.png$/i, ""));
        var outputName = baseName + "-" + requestId;
        var outputStem = new File(exportFolder.fsName + "/" + outputName);
        var expectedOutput = new File(exportFolder.fsName + "/" + outputName + ".png");
        var rawOutput = new File(exportFolder.fsName + "/" + outputName);

        if (expectedOutput.exists || rawOutput.exists) {
            throw new Error("A unique temporary Lithophane PNG export path already exists.");
        }

        try {
            temporaryDocument = app.documents.add(originalDocument.documentColorSpace);
            temporaryLayer = temporaryDocument.layers[0];
            temporaryLayer.locked = false;
            temporaryLayer.visible = true;
            try {
                duplicate = selectedPng.item.duplicate(temporaryLayer, ElementPlacement.PLACEATEND);
            } catch (duplicateError) {
                throw new Error(
                    "Illustrator could not copy the selected embedded or unavailable PNG into a temporary document: " +
                    safeString(duplicateError.message || duplicateError)
                );
            }

            duplicateBounds = readOwnGeometricBounds(duplicate, "The temporary PNG copy");
            captureBounds = mapAuthorityBoundsToDuplicate(selectedPng, duplicateBounds);
            captureOptions = new ImageCaptureOptions();
            captureOptions.antiAliasing = true;
            captureOptions.transparency = true;
            captureOptions.matte = false;
            captureOptions.resolution = 300;
            temporaryDocument.imageCapture(outputStem, captureBounds, captureOptions);

            if (!expectedOutput.exists && rawOutput.exists) {
                if (!rawOutput.rename(expectedOutput.name)) {
                    throw new Error("Illustrator created the PNG without its extension and could not rename it.");
                }
            }
            if (!expectedOutput.exists) {
                throw new Error("Illustrator did not create the temporary transparent PNG.");
            }
            return expectedOutput.fsName;
        } finally {
            closeTemporaryDocument(temporaryDocument, originalDocument);
        }
    }

    function resolveImagePath(originalDocument, selectedPng, exportFolder, requestId) {
        if (selectedPng.source.kind === "linked" &&
                !selectedPng.clippingPath && !selectedPng.captureAppearance) {
            return selectedPng.source.imagePath;
        }
        return exportSelectedPng(originalDocument, selectedPng, exportFolder, requestId);
    }

    function resolveOwnerPaths() {
        var installedScriptPath = "";
        var scriptFile;
        var sourceFolder;
        var packageFolder;
        var runtimeFolder;

        try {
            if (typeof FLOWCELL_SCRIPT_PATH !== "undefined") {
                installedScriptPath = trim(FLOWCELL_SCRIPT_PATH);
            }
        } catch (ignoreInjectedScriptPath) {
            installedScriptPath = "";
        }

        scriptFile = new File(installedScriptPath || $.fileName);
        sourceFolder = scriptFile.parent;
        packageFolder = sourceFolder;
        if (safeString(sourceFolder.name).toLowerCase() === "source") {
            packageFolder = sourceFolder.parent;
        }
        runtimeFolder = new Folder(packageFolder.fsName + "/runtime");

        return {
            runtimeFolder: runtimeFolder,
            exportFolder: new Folder(runtimeFolder.fsName + "/png-exports"),
            requestFile: new File(runtimeFolder.fsName + "/" + REQUEST_FILE_NAME),
            statusFile: new File(runtimeFolder.fsName + "/" + STATUS_FILE_NAME),
            handoffFile: new File(sourceFolder.fsName + "/" + HANDOFF_FILE_NAME)
        };
    }

    function writeTextFile(fileRef, contents) {
        fileRef.encoding = "UTF-8";
        fileRef.lineFeed = "Windows";
        if (!fileRef.open("w")) {
            throw new Error("Could not write Lithophane request file: " + fileRef.fsName + ".");
        }
        try {
            fileRef.write(contents);
        } finally {
            fileRef.close();
        }
    }

    function readTextFile(fileRef) {
        var text;
        if (!fileRef.exists) {
            return null;
        }
        fileRef.encoding = "UTF-8";
        if (!fileRef.open("r")) {
            return null;
        }
        try {
            text = fileRef.read();
        } finally {
            fileRef.close();
        }
        return text;
    }

    function makeRequestId() {
        return "illustrator-lithophane-" + String(new Date().getTime()) + "-" + String(Math.floor(Math.random() * 1000000));
    }

    function resetStatusFile(statusFile, requestId) {
        writeTextFile(
            statusFile,
            "RequestId=" + requestId + "\n" +
            "Status=Pending\n" +
            "Message=Waiting for Blender.\n" +
            "ChangedCount=0\n"
        );
    }

    function waitForHandoff(statusFile, requestId) {
        var deadline = new Date().getTime() + STATUS_TIMEOUT_MS;
        var statusText;
        var status;
        var changedCount;
        var message;

        while (new Date().getTime() < deadline) {
            $.sleep(STATUS_POLL_MS);
            statusText = readTextFile(statusFile);
            if (!statusText) {
                continue;
            }
            status = parseStatusText(statusText);
            if (status.RequestId !== requestId) {
                continue;
            }
            if (status.Status === "Error") {
                message = trim(status.Message);
                throw new Error(message || "Blender could not create the lithophane.");
            }
            if (status.Status === "Ok") {
                changedCount = Number(status.ChangedCount);
                if (changedCount !== 1) {
                    throw new Error("Blender completed the Lithophane request without reporting exactly one changed object.");
                }
                return {
                    requestId: requestId,
                    changedCount: changedCount,
                    message: trim(status.Message)
                };
            }
        }
        throw new Error("Timed out waiting for Blender to create the lithophane.");
    }

    if (app.documents.length === 0) {
        throw new Error("Open an Illustrator document and select one PNG first.");
    }

    var originalDocument = app.activeDocument;
    var selectedPng = resolveSelectedPng(originalDocument.selection);
    var ownerPaths = resolveOwnerPaths();
    var requestId = makeRequestId();

    if (!ownerPaths.handoffFile.exists) {
        throw new Error("Missing same-package Blender handoff: " + ownerPaths.handoffFile.fsName);
    }
    ensureFolder(ownerPaths.runtimeFolder);
    ensureFolder(ownerPaths.exportFolder);
    selectedPng.imagePath = resolveImagePath(
        originalDocument,
        selectedPng,
        ownerPaths.exportFolder,
        requestId
    );
    writeTextFile(ownerPaths.requestFile, buildRequestJson(requestId, selectedPng));
    resetStatusFile(ownerPaths.statusFile, requestId);

    if (!ownerPaths.handoffFile.execute()) {
        throw new Error("Windows could not start the Lithophane Blender handoff.");
    }

    return waitForHandoff(ownerPaths.statusFile, requestId);
}());
