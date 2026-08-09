#target illustrator

(function () {
    var REQUEST_FILE_NAME = "send-svg-to-blender.request.json";
    var STATUS_FILE_NAME = "send-svg-to-blender.status.txt";
    var HANDOFF_FILE_NAME = "Send-SVG-To-Blender.vbs";
    var STATUS_TIMEOUT_MS = 300000;
    var STATUS_POLL_MS = 250;
    var SVG_COORDINATE_PRECISION = 5;
    var SVG10_DOCTYPE = '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.0//EN" "http://www.w3.org/TR/2001/REC-SVG-20010904/DTD/svg10.dtd">';
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

    function parseExtrudeMillimeters(layerName) {
        var match = /^\(([0-9]+(?:\.[0-9]+)?)\)/.exec(safeString(layerName));
        var amount;

        if (!match) {
            return 1;
        }

        amount = Number(match[1]);
        if (!(amount > 0) || !isFinite(amount)) {
            return 1;
        }

        return amount;
    }

    function pointsToMillimeters(points) {
        return Number(points) * POINTS_TO_MILLIMETERS;
    }

    function requestedPostAction() {
        var value = "";

        try {
            if (typeof FLOWCELL_SEND_SVG_POST_ACTION !== "undefined") {
                value = trim(FLOWCELL_SEND_SVG_POST_ACTION).toLowerCase();
            }
        } catch (ignorePostAction) {
            value = "";
        }

        return value === "orca" ? "orca" : "none";
    }

    function sanitizeFileName(layerName) {
        var cleaned = safeString(layerName);

        cleaned = cleaned.replace(/[\x00-\x1f\\\/:*?"<>|]/g, "_");
        if (/^\s/.test(cleaned)) {
            cleaned = "_" + cleaned;
        }
        cleaned = cleaned.replace(/\s+$/g, "");
        cleaned = cleaned.replace(/[\. ]+$/g, "");

        if (cleaned === "") {
            cleaned = "Layer";
        }

        if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(cleaned)) {
            cleaned = "_" + cleaned;
        }

        return cleaned;
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

    function buildRequestJson(requestId, items, postAction) {
        var lines = [];
        var item;
        var i;

        lines.push("{");
        lines.push('  "schemaVersion": 1,');
        lines.push('  "requestId": ' + jsonQuote(requestId) + ",");
        lines.push('  "postAction": ' + jsonQuote(postAction === "orca" ? "orca" : "none") + ",");
        lines.push('  "items": [');

        for (i = 0; i < items.length; i += 1) {
            item = items[i];
            lines.push("    {");
            lines.push('      "filepath": ' + jsonQuote(item.filepath) + ",");
            lines.push('      "layerName": ' + jsonQuote(item.layerName) + ",");
            lines.push('      "extrudeMm": ' + String(item.extrudeMm) + ",");
            lines.push('      "widthMm": ' + String(item.widthMm) + ",");
            lines.push('      "heightMm": ' + String(item.heightMm) + ",");
            lines.push('      "offsetXmm": ' + String(item.offsetXmm) + ",");
            lines.push('      "offsetYmm": ' + String(item.offsetYmm));
            lines.push("    }" + (i + 1 < items.length ? "," : ""));
        }

        lines.push("  ]");
        lines.push("}");
        return lines.join("\n") + "\n";
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

    function cleanSvg10Markup(text) {
        var cleaned = safeString(text);

        cleaned = cleaned.replace(
            /\s+xmlns:(?:x|i|graph)\s*=\s*["']&(?:ns_extend|ns_ai|ns_graphs);["']/g,
            ""
        );
        cleaned = cleaned.replace(/<g>\s*<\/g>/g, "");
        if (!/<!DOCTYPE\s+svg\b/i.test(cleaned)) {
            if (/^\s*<\?xml[^>]*\?>/i.test(cleaned)) {
                cleaned = cleaned.replace(/^(\s*<\?xml[^>]*\?>)/i, "$1\n" + SVG10_DOCTYPE);
            } else {
                cleaned = SVG10_DOCTYPE + "\n" + cleaned;
            }
        }

        return cleaned;
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

    function isSelectablePageItem(value) {
        var typename;

        if (!value) {
            return false;
        }

        typename = safeString(value.typename);
        if (typename === "InsertionPoint" || typename === "TextRange") {
            return false;
        }

        try {
            return typeof value.duplicate === "function" && !!getNearestOwningLayer(value);
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
        var i;

        for (i = roots.length - 1; i >= 0; i -= 1) {
            if (roots[i] === candidate || isAncestorPageItem(roots[i], candidate)) {
                return;
            }
            if (isAncestorPageItem(candidate, roots[i])) {
                roots.splice(i, 1);
            }
        }

        roots.push(candidate);
    }

    function normalizeSelectedPageItems(rawSelection) {
        var candidates = [];
        var roots = [];
        var hasCollectionShape;
        var i;

        if (!rawSelection) {
            return roots;
        }

        hasCollectionShape = !rawSelection.typename && typeof rawSelection.length === "number";
        if (hasCollectionShape) {
            for (i = 0; i < rawSelection.length; i += 1) {
                candidates.push(rawSelection[i]);
            }
        } else {
            candidates.push(rawSelection);
        }

        for (i = 0; i < candidates.length; i += 1) {
            if (isSelectablePageItem(candidates[i])) {
                addSelectionRoot(roots, candidates[i]);
            }
        }

        return roots;
    }

    function getSelectedItemsVisibleBounds(items, groupName) {
        var bounds = null;
        var itemBounds;
        var left;
        var top;
        var right;
        var bottom;
        var i;

        for (i = 0; i < items.length; i += 1) {
            try {
                itemBounds = items[i].visibleBounds;
            } catch (ignoreItemBounds) {
                itemBounds = null;
            }
            if (!itemBounds || itemBounds.length !== 4) {
                continue;
            }
            left = Number(itemBounds[0]);
            top = Number(itemBounds[1]);
            right = Number(itemBounds[2]);
            bottom = Number(itemBounds[3]);
            if (!isFinite(left) || !isFinite(top) || !isFinite(right) || !isFinite(bottom)) {
                continue;
            }
            if (!bounds) {
                bounds = [left, top, right, bottom];
            } else {
                bounds[0] = Math.min(bounds[0], left);
                bounds[1] = Math.max(bounds[1], top);
                bounds[2] = Math.max(bounds[2], right);
                bounds[3] = Math.min(bounds[3], bottom);
            }
        }

        if (!bounds) {
            throw new Error("Could not determine the selected artwork bounds for layer " + groupName + ".");
        }
        return bounds;
    }

    function assignRelativeGroupOffsets(groups) {
        var combinedBounds = null;
        var bounds;
        var combinedCenterX;
        var combinedCenterY;
        var centerX;
        var centerY;
        var i;

        for (i = 0; i < groups.length; i += 1) {
            bounds = getSelectedItemsVisibleBounds(groups[i].items, groups[i].layerName);
            groups[i].sourceBounds = bounds;
            if (!combinedBounds) {
                combinedBounds = [bounds[0], bounds[1], bounds[2], bounds[3]];
            } else {
                combinedBounds[0] = Math.min(combinedBounds[0], bounds[0]);
                combinedBounds[1] = Math.max(combinedBounds[1], bounds[1]);
                combinedBounds[2] = Math.max(combinedBounds[2], bounds[2]);
                combinedBounds[3] = Math.min(combinedBounds[3], bounds[3]);
            }
        }

        combinedCenterX = (combinedBounds[0] + combinedBounds[2]) / 2;
        combinedCenterY = (combinedBounds[1] + combinedBounds[3]) / 2;
        for (i = 0; i < groups.length; i += 1) {
            bounds = groups[i].sourceBounds;
            centerX = (bounds[0] + bounds[2]) / 2;
            centerY = (bounds[1] + bounds[3]) / 2;
            groups[i].offsetXmm = pointsToMillimeters(centerX - combinedCenterX);
            groups[i].offsetYmm = pointsToMillimeters(centerY - combinedCenterY);
        }

        return groups;
    }

    function resolveExportGroups(rawSelection) {
        var selectedItems = normalizeSelectedPageItems(rawSelection);
        var groups = [];
        var fileKeys = {};
        var ownerLayer;
        var layerName;
        var fileName;
        var fileKey;
        var group;
        var i;
        var j;

        if (selectedItems.length === 0) {
            throw new Error("Select at least one Illustrator object. Text insertion points and text ranges are not export objects.");
        }

        for (i = 0; i < selectedItems.length; i += 1) {
            ownerLayer = getNearestOwningLayer(selectedItems[i]);
            if (!ownerLayer) {
                throw new Error("A selected object is not owned by an Illustrator layer.");
            }

            group = null;
            for (j = 0; j < groups.length; j += 1) {
                if (groups[j].layer === ownerLayer) {
                    group = groups[j];
                    break;
                }
            }

            if (!group) {
                layerName = safeString(ownerLayer.name);
                fileName = sanitizeFileName(layerName);
                fileKey = fileName.toLowerCase();

                if (fileKeys["$" + fileKey]) {
                    throw new Error(
                        "Selected owner layers produce the same SVG filename (case-insensitive): " +
                        fileName + ". Rename one of the layers and try again."
                    );
                }

                fileKeys["$" + fileKey] = true;
                group = {
                    layer: ownerLayer,
                    layerName: layerName,
                    fileName: fileName,
                    extrudeMm: parseExtrudeMillimeters(layerName),
                    items: []
                };
                groups.push(group);
            }

            group.items.push(selectedItems[i]);
        }

        return assignRelativeGroupOffsets(groups);
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
    if (testHost && testHost.__FLOWCELL_SEND_SVG_TO_BLENDER_TEST__ === true) {
        testHost.__FLOWCELL_SEND_SVG_TO_BLENDER_TEST_API__ = {
            parseExtrudeMillimeters: parseExtrudeMillimeters,
            pointsToMillimeters: pointsToMillimeters,
            requestedPostAction: requestedPostAction,
            sanitizeFileName: sanitizeFileName,
            cleanSvg10Markup: cleanSvg10Markup,
            buildRequestJson: buildRequestJson,
            parseStatusText: parseStatusText,
            normalizeSelectedPageItems: normalizeSelectedPageItems,
            resolveExportGroups: resolveExportGroups,
            assignRelativeGroupOffsets: assignRelativeGroupOffsets,
            validateVectorArtwork: validateVectorArtwork,
            closeOpenFilledPathsForUnite: closeOpenFilledPathsForUnite,
            validateNormalizedVectorArtwork: validateNormalizedVectorArtwork,
            uniteAndBakeVectorArtwork: uniteAndBakeVectorArtwork
        };
        return;
    }

    function getParentFolder(folderRef) {
        var parent;

        if (!folderRef) {
            return null;
        }

        try {
            parent = folderRef.parent;
            if (!parent || parent.fsName === folderRef.fsName) {
                return null;
            }
            return parent;
        } catch (ignoreParent) {
            return null;
        }
    }

    function ensureFolder(folderRef) {
        var parent;

        if (folderRef.exists) {
            return folderRef;
        }

        parent = getParentFolder(folderRef);
        if (parent && !parent.exists) {
            ensureFolder(parent);
        }

        if (!folderRef.create() && !folderRef.exists) {
            throw new Error("Could not create folder: " + folderRef.fsName);
        }

        return folderRef;
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
            sourceFolder: sourceFolder,
            packageFolder: packageFolder,
            runtimeFolder: runtimeFolder,
            exportFolder: new Folder(runtimeFolder.fsName + "/svg-exports"),
            requestFile: new File(runtimeFolder.fsName + "/" + REQUEST_FILE_NAME),
            statusFile: new File(runtimeFolder.fsName + "/" + STATUS_FILE_NAME),
            handoffFile: new File(sourceFolder.fsName + "/" + HANDOFF_FILE_NAME)
        };
    }

    function writeTextFile(fileRef, contents) {
        fileRef.encoding = "UTF-8";
        fileRef.lineFeed = "Windows";
        if (!fileRef.open("w")) {
            throw new Error("Could not write file: " + fileRef.fsName + ". " + safeString(fileRef.error));
        }
        try {
            fileRef.write(contents);
        } finally {
            fileRef.close();
        }
    }

    function readTextFile(fileRef) {
        var contents;

        if (!fileRef.exists) {
            return null;
        }

        fileRef.encoding = "UTF-8";
        if (!fileRef.open("r")) {
            return null;
        }
        try {
            contents = fileRef.read();
        } finally {
            fileRef.close();
        }
        return contents;
    }

    function snapshotSelection(rawSelection) {
        var result = [];
        var i;

        if (!rawSelection) {
            return null;
        }

        if (!rawSelection.typename && typeof rawSelection.length === "number") {
            for (i = 0; i < rawSelection.length; i += 1) {
                result.push(rawSelection[i]);
            }
            return result;
        }

        return rawSelection;
    }

    function restoreOriginalState(documentRef, activeLayer, selectionSnapshot) {
        var fallbackItems;
        var i;

        try {
            documentRef.activate();
        } catch (ignoreActivate) {
        }

        try {
            if (activeLayer) {
                documentRef.activeLayer = activeLayer;
            }
        } catch (ignoreActiveLayer) {
        }

        try {
            documentRef.selection = null;
            if (selectionSnapshot) {
                documentRef.selection = selectionSnapshot;
            }
            return;
        } catch (ignoreDirectSelectionRestore) {
        }

        fallbackItems = normalizeSelectedPageItems(selectionSnapshot);
        for (i = 0; i < fallbackItems.length; i += 1) {
            try {
                fallbackItems[i].selected = true;
            } catch (ignoreSelectedFlag) {
            }
        }
    }

    function removeTemporaryDocument(documents, documentRef) {
        var i;
        for (i = documents.length - 1; i >= 0; i -= 1) {
            if (documents[i] === documentRef) {
                documents.splice(i, 1);
                return;
            }
        }
    }

    function closeTemporaryDocument(documents, documentRef) {
        if (!documentRef) {
            return;
        }
        try {
            documentRef.close(SaveOptions.DONOTSAVECHANGES);
            removeTemporaryDocument(documents, documentRef);
        } catch (ignoreClose) {
        }
    }

    function closeAllTemporaryDocuments(documents) {
        var documentRef;
        while (documents.length > 0) {
            documentRef = documents.pop();
            try {
                documentRef.close(SaveOptions.DONOTSAVECHANGES);
            } catch (ignoreClose) {
            }
        }
    }

    function unlockTemporaryArtwork(documentRef) {
        var items = documentRef.pageItems;
        var layers = documentRef.layers;
        var i;

        for (i = 0; i < layers.length; i += 1) {
            try {
                layers[i].locked = false;
                layers[i].visible = true;
            } catch (ignoreLayerState) {
            }
        }

        for (i = 0; i < items.length; i += 1) {
            try {
                items[i].locked = false;
            } catch (ignoreItemLock) {
            }
        }
    }

    function isEffectivelyVisible(item) {
        var current = item;

        while (current) {
            try {
                if (safeString(current.typename) === "Layer") {
                    if (current.visible === false) {
                        return false;
                    }
                } else if (current.hidden === true) {
                    return false;
                }
                current = current.parent;
            } catch (ignoreVisibility) {
                return true;
            }
        }

        return true;
    }

    function outlineVisibleText(documentRef) {
        var frames = [];
        var i;

        for (i = 0; i < documentRef.textFrames.length; i += 1) {
            frames.push(documentRef.textFrames[i]);
        }

        for (i = frames.length - 1; i >= 0; i -= 1) {
            if (!isEffectivelyVisible(frames[i])) {
                continue;
            }
            try {
                frames[i].locked = false;
            } catch (ignoreTextLock) {
            }
            try {
                frames[i].createOutline();
            } catch (outlineError) {
                throw new Error("Could not outline selected text: " + safeString(outlineError.message || outlineError));
            }
        }
    }

    function clearSelection(documentRef) {
        try {
            documentRef.selection = null;
        } catch (ignoreClearSelection) {
        }
    }

    function selectTopLevelArtwork(documentRef) {
        var items = documentRef.pageItems;
        var selectedCount = 0;
        var parent;
        var i;

        clearSelection(documentRef);
        for (i = 0; i < items.length; i += 1) {
            try {
                parent = items[i].parent;
                if (parent && safeString(parent.typename) === "Layer" && isEffectivelyVisible(items[i])) {
                    items[i].selected = true;
                    selectedCount += 1;
                }
            } catch (ignoreSelect) {
            }
        }

        return selectedCount;
    }

    function executeVectorCleanup(documentRef, menuCommand) {
        documentRef.activate();
        if (app.activeDocument !== documentRef) {
            throw new Error("Illustrator did not activate the temporary export document.");
        }
        if (selectTopLevelArtwork(documentRef) === 0) {
            return false;
        }
        try {
            app.executeMenuCommand(menuCommand);
            return true;
        } catch (ignoreUnsupportedCleanup) {
            return false;
        }
    }

    function executeRequiredVectorCleanup(documentRef, menuCommand, description, layerName) {
        documentRef.activate();
        if (app.activeDocument !== documentRef) {
            throw new Error("Illustrator did not activate the temporary export document.");
        }
        try {
            app.executeMenuCommand(menuCommand);
        } catch (commandError) {
            throw new Error(
                "Layer " + layerName + " could not complete " + description + ": " +
                safeString(commandError.message || commandError)
            );
        }
    }

    function rejectVisibleClippingGroups(item, layerName) {
        var childItems;
        var childCount;
        var isClipped;
        var i;

        if (!isEffectivelyVisible(item) || safeString(item.typename) !== "GroupItem") {
            return;
        }

        try {
            isClipped = item.clipped === true;
        } catch (clipProbeError) {
            throw new Error(
                "Layer " + layerName + " contains a group whose clipping state could not be verified: " +
                safeString(clipProbeError.message || clipProbeError)
            );
        }
        if (isClipped) {
            throw new Error(
                "Layer " + layerName +
                " contains a visible clipping group. Convert the clipping mask into explicit closed filled paths before sending it to Blender."
            );
        }

        try {
            childItems = item.pageItems;
            childCount = childItems.length;
        } catch (groupProbeError) {
            throw new Error(
                "Layer " + layerName + " contains a group that could not be inspected before Pathfinder Unite: " +
                safeString(groupProbeError.message || groupProbeError)
            );
        }
        for (i = 0; i < childCount; i += 1) {
            rejectVisibleClippingGroups(childItems[i], layerName);
        }
    }

    function validateNoVisibleClippingGroups(documentRef, layerName) {
        var items = documentRef.pageItems;
        var parent;
        var i;

        for (i = 0; i < items.length; i += 1) {
            try {
                parent = items[i].parent;
            } catch (parentError) {
                throw new Error(
                    "Layer " + layerName + " contains artwork whose parent could not be inspected before Pathfinder Unite: " +
                    safeString(parentError.message || parentError)
                );
            }
            if (parent && safeString(parent.typename) === "Layer") {
                rejectVisibleClippingGroups(items[i], layerName);
            }
        }
    }

    function validateVectorArtwork(documentRef, layerName) {
        var items = documentRef.pageItems;
        var paths = documentRef.pathItems;
        var typename;
        var visibleVectorCount = 0;
        var unsupported = [];
        var seen = {};
        var hasVisibleStroke;
        var i;

        for (i = 0; i < items.length; i += 1) {
            if (!isEffectivelyVisible(items[i])) {
                continue;
            }

            typename = safeString(items[i].typename);
            if (typename === "PathItem" || typename === "CompoundPathItem") {
                try {
                    if (typename === "PathItem" && items[i].guides === true) {
                        continue;
                    }
                } catch (ignoreGuideProbe) {
                }
                visibleVectorCount += 1;
            } else if (typename !== "GroupItem" && !seen["$" + typename]) {
                seen["$" + typename] = true;
                unsupported.push(typename || "UnknownItem");
            }
        }

        if (unsupported.length > 0) {
            throw new Error(
                "Layer " + layerName + " still contains non-path artwork after cleanup: " +
                unsupported.join(", ") +
                ". PlacedItem, RasterItem, PluginItem, and other non-vector-only art cannot be sent."
            );
        }

        validateNoVisibleClippingGroups(documentRef, layerName);

        for (i = 0; i < paths.length; i += 1) {
            if (!isEffectivelyVisible(paths[i])) {
                continue;
            }
            hasVisibleStroke = false;
            try {
                hasVisibleStroke = paths[i].guides !== true && paths[i].stroked === true;
            } catch (ignoreStrokeProbe) {
                hasVisibleStroke = false;
            }
            if (hasVisibleStroke) {
                throw new Error(
                    "Layer " + layerName +
                    " still contains a visible stroke after cleanup. Expand or outline that stroke before sending it to Blender."
                );
            }
        }

        if (visibleVectorCount === 0) {
            throw new Error("Layer " + layerName + " has no visible vector paths to export.");
        }
    }

    function throwNormalizationError(layerName, message) {
        throw new Error("Layer " + layerName + " could not be normalized for Blender: " + message);
    }

    function closeOpenFilledVectorItem(item, layerName, summary) {
        var typename;
        var childItems;
        var childCount;
        var isGuide = false;
        var isFilled;
        var isStroked;
        var isClosed;
        var i;

        if (!isEffectivelyVisible(item)) {
            return;
        }

        typename = safeString(item.typename);
        if (typename === "PathItem") {
            try {
                isGuide = item.guides === true;
                isFilled = item.filled === true;
                isStroked = item.stroked === true;
                isClosed = item.closed === true;
            } catch (pathProbeError) {
                throwNormalizationError(
                    layerName,
                    "Illustrator could not inspect a path before Pathfinder Unite: " +
                    safeString(pathProbeError.message || pathProbeError)
                );
            }
            if (isGuide || !isFilled || isStroked || isClosed) {
                return;
            }

            try {
                item.closed = true;
                if (item.closed !== true) {
                    throw new Error("the path remained open");
                }
            } catch (closeError) {
                throwNormalizationError(
                    layerName,
                    "Illustrator could not close a filled path before Pathfinder Unite: " +
                    safeString(closeError.message || closeError)
                );
            }
            summary.closedPathCount += 1;
            return;
        }

        if (typename === "CompoundPathItem") {
            try {
                childItems = item.pathItems;
                childCount = childItems.length;
            } catch (compoundError) {
                throwNormalizationError(
                    layerName,
                    "Illustrator could not inspect a compound path before Pathfinder Unite: " +
                    safeString(compoundError.message || compoundError)
                );
            }
            for (i = 0; i < childCount; i += 1) {
                closeOpenFilledVectorItem(childItems[i], layerName, summary);
            }
            return;
        }

        if (typename === "GroupItem") {
            try {
                childItems = item.pageItems;
                childCount = childItems.length;
            } catch (groupError) {
                throwNormalizationError(
                    layerName,
                    "Illustrator could not inspect a group before Pathfinder Unite: " +
                    safeString(groupError.message || groupError)
                );
            }
            for (i = 0; i < childCount; i += 1) {
                closeOpenFilledVectorItem(childItems[i], layerName, summary);
            }
        }
    }

    function closeOpenFilledPathsForUnite(documentRef, layerName) {
        var items = documentRef.pageItems;
        var summary = {
            closedPathCount: 0
        };
        var parent;
        var i;

        for (i = 0; i < items.length; i += 1) {
            try {
                parent = items[i].parent;
            } catch (parentError) {
                throwNormalizationError(
                    layerName,
                    "Illustrator could not inspect artwork before Pathfinder Unite: " +
                    safeString(parentError.message || parentError)
                );
            }
            if (parent && safeString(parent.typename) === "Layer") {
                closeOpenFilledVectorItem(items[i], layerName, summary);
            }
        }

        return summary;
    }

    function requireNormalizedBoolean(item, propertyName, expectedValue, layerName, failureMessage) {
        var value;

        try {
            value = item[propertyName];
        } catch (propertyError) {
            throwNormalizationError(
                layerName,
                "Illustrator could not verify " + propertyName + " on a path: " +
                safeString(propertyError.message || propertyError)
            );
        }

        if (value !== expectedValue) {
            throwNormalizationError(layerName, failureMessage);
        }
    }

    function inspectNormalizedVectorItem(item, layerName, summary) {
        var typename;
        var childItems;
        var childCount;
        var isGuide = false;
        var isClipped;
        var i;

        if (!isEffectivelyVisible(item)) {
            return;
        }

        typename = safeString(item.typename);
        if (typename === "PathItem") {
            try {
                isGuide = item.guides === true;
            } catch (guideError) {
                throwNormalizationError(
                    layerName,
                    "Illustrator could not verify whether a path is a guide: " +
                    safeString(guideError.message || guideError)
                );
            }
            if (isGuide) {
                return;
            }

            requireNormalizedBoolean(
                item,
                "closed",
                true,
                layerName,
                "Pathfinder Unite left an open path. Close the source path and try again."
            );
            requireNormalizedBoolean(
                item,
                "filled",
                true,
                layerName,
                "Pathfinder Unite left an unfilled path. Only filled silhouettes can be extruded."
            );
            requireNormalizedBoolean(
                item,
                "stroked",
                false,
                layerName,
                "Pathfinder Unite left a stroked path instead of a filled outline."
            );
            requireNormalizedBoolean(
                item,
                "clipping",
                false,
                layerName,
                "Pathfinder Unite left a clipping path instead of baked geometry."
            );
            summary.pathCount += 1;
            return;
        }

        if (typename === "CompoundPathItem") {
            summary.compoundPathCount += 1;
            try {
                childItems = item.pathItems;
                childCount = childItems.length;
            } catch (compoundError) {
                throwNormalizationError(
                    layerName,
                    "Illustrator could not inspect a compound path: " +
                    safeString(compoundError.message || compoundError)
                );
            }
            if (childCount === 0) {
                throwNormalizationError(layerName, "Pathfinder Unite produced an empty compound path.");
            }
            for (i = 0; i < childCount; i += 1) {
                inspectNormalizedVectorItem(childItems[i], layerName, summary);
            }
            return;
        }

        if (typename === "GroupItem") {
            try {
                isClipped = item.clipped === true;
            } catch (clipGroupError) {
                throwNormalizationError(
                    layerName,
                    "Illustrator could not verify a group after Pathfinder Unite: " +
                    safeString(clipGroupError.message || clipGroupError)
                );
            }
            if (isClipped) {
                throwNormalizationError(
                    layerName,
                    "Pathfinder Unite left a clipping group instead of baked path geometry."
                );
            }
            try {
                childItems = item.pageItems;
                childCount = childItems.length;
            } catch (groupError) {
                throwNormalizationError(
                    layerName,
                    "Illustrator could not inspect a group after Pathfinder Unite: " +
                    safeString(groupError.message || groupError)
                );
            }
            for (i = 0; i < childCount; i += 1) {
                inspectNormalizedVectorItem(childItems[i], layerName, summary);
            }
            return;
        }

        throwNormalizationError(
            layerName,
            "Pathfinder Unite left unsupported live artwork: " + (typename || "UnknownItem") + "."
        );
    }

    function validateNormalizedVectorArtwork(documentRef, layerName) {
        var items = documentRef.pageItems;
        var summary = {
            pathCount: 0,
            compoundPathCount: 0
        };
        var parent;
        var i;

        for (i = 0; i < items.length; i += 1) {
            try {
                parent = items[i].parent;
            } catch (parentError) {
                throwNormalizationError(
                    layerName,
                    "Illustrator could not inspect the parent of normalized artwork: " +
                    safeString(parentError.message || parentError)
                );
            }
            if (parent && safeString(parent.typename) === "Layer") {
                inspectNormalizedVectorItem(items[i], layerName, summary);
            }
        }

        if (summary.pathCount === 0) {
            throwNormalizationError(layerName, "Pathfinder Unite produced no closed filled paths.");
        }

        return summary;
    }

    function uniteAndBakeVectorArtwork(documentRef, layerName) {
        var operandCount = selectTopLevelArtwork(documentRef);
        var groupedCount;

        if (operandCount === 0) {
            throwNormalizationError(layerName, "there is no visible artwork for Pathfinder Unite.");
        }

        if (operandCount > 1) {
            executeRequiredVectorCleanup(documentRef, "group", "Pathfinder grouping", layerName);
            groupedCount = selectTopLevelArtwork(documentRef);
            if (groupedCount !== 1) {
                throwNormalizationError(
                    layerName,
                    "Illustrator did not group all visible operands before Pathfinder Unite."
                );
            }
        }

        executeRequiredVectorCleanup(documentRef, "Live Pathfinder Add", "Pathfinder Unite", layerName);
        if (selectTopLevelArtwork(documentRef) === 0) {
            throwNormalizationError(layerName, "Pathfinder Unite produced no selectable result to expand.");
        }
        executeRequiredVectorCleanup(documentRef, "expandStyle", "Pathfinder result expansion", layerName);
        unlockTemporaryArtwork(documentRef);
        validateNormalizedVectorArtwork(documentRef, layerName);
    }

    function getVisibleBounds(documentRef, layerName) {
        var items = documentRef.pageItems;
        var bounds = null;
        var itemBounds;
        var parent;
        var left;
        var top;
        var right;
        var bottom;
        var i;

        for (i = 0; i < items.length; i += 1) {
            try {
                parent = items[i].parent;
                if (!parent || safeString(parent.typename) !== "Layer" || !isEffectivelyVisible(items[i])) {
                    continue;
                }
                itemBounds = items[i].visibleBounds;
                if (!itemBounds || itemBounds.length !== 4) {
                    continue;
                }
                if (!bounds) {
                    bounds = [itemBounds[0], itemBounds[1], itemBounds[2], itemBounds[3]];
                } else {
                    bounds[0] = Math.min(bounds[0], itemBounds[0]);
                    bounds[1] = Math.max(bounds[1], itemBounds[1]);
                    bounds[2] = Math.max(bounds[2], itemBounds[2]);
                    bounds[3] = Math.min(bounds[3], itemBounds[3]);
                }
            } catch (ignoreBounds) {
            }
        }

        if (!bounds) {
            throw new Error("Could not determine visible bounds for layer " + layerName + ".");
        }

        left = Number(bounds[0]);
        top = Number(bounds[1]);
        right = Number(bounds[2]);
        bottom = Number(bounds[3]);
        if (!isFinite(left) || !isFinite(top) || !isFinite(right) || !isFinite(bottom)) {
            throw new Error("Layer " + layerName + " has invalid visible bounds.");
        }

        if (right <= left) {
            right = left + 0.01;
        }
        if (top <= bottom) {
            top = bottom + 0.01;
        }

        return [left, top, right, bottom];
    }

    function makeSvgExportOptions() {
        var options = new ExportOptionsSVG();

        options.DTD = SVGDTDVersion.SVG1_0;
        options.cssProperties = SVGCSSPropertyLocation.PRESENTATIONATTRIBUTES;
        options.fontType = SVGFontType.OUTLINEFONT;
        options.embedRasterImages = false;
        options.preserveEditability = false;
        options.coordinatePrecision = SVG_COORDINATE_PRECISION;
        options.documentEncoding = SVGDocumentEncoding.UTF8;
        options.compressed = false;
        options.optimizeForSVGViewer = true;
        options.includeFileInfo = false;
        options.includeUnusedStyles = false;
        options.includeVariablesAndDatasets = false;
        options.slices = false;
        options.saveMultipleArtboards = false;
        options.artboardRange = "1";

        try {
            options.responsive = false;
        } catch (ignoreResponsiveOption) {
        }

        return options;
    }

    function validateExportedSvg(fileRef, layerName) {
        var svgText = readTextFile(fileRef);

        if (!svgText || !/<svg\b/i.test(svgText)) {
            throw new Error("Illustrator did not create a readable SVG for layer " + layerName + ".");
        }
        if (!/DTD\s+SVG\s+1\.0/i.test(svgText) && !/<svg\b[^>]*\bversion\s*=\s*["']1\.0["']/i.test(svgText)) {
            throw new Error("Illustrator did not create SVG 1.0 output for layer " + layerName + ".");
        }
        if (/<\s*(image|text|foreignObject)\b/i.test(svgText)) {
            throw new Error("Layer " + layerName + " exported unsupported raster or live text SVG content.");
        }
        if (/&(?:ns_extend|ns_ai|ns_graphs);/.test(svgText)) {
            throw new Error("Layer " + layerName + " retained unresolved Adobe namespace entities in its SVG.");
        }
    }

    function cleanExportedSvg(fileRef) {
        var original = readTextFile(fileRef);
        var cleaned = cleanSvg10Markup(original);

        if (cleaned !== original) {
            writeTextFile(fileRef, cleaned);
        }
    }

    function exportGroup(originalDocument, group, exportFolder, temporaryDocuments) {
        var temporaryDocument = null;
        var temporaryLayer;
        var targetFile;
        var duplicate;
        var exportBounds;
        var widthMm;
        var heightMm;
        var i;

        try {
            temporaryDocument = app.documents.add(originalDocument.documentColorSpace);
            temporaryDocuments.push(temporaryDocument);
            temporaryDocument.activate();
            temporaryLayer = temporaryDocument.layers[0];
            temporaryLayer.name = group.layerName;
            temporaryLayer.locked = false;
            temporaryLayer.visible = true;

            for (i = 0; i < group.items.length; i += 1) {
                try {
                    duplicate = group.items[i].duplicate(temporaryLayer, ElementPlacement.PLACEATEND);
                    duplicate.locked = false;
                } catch (duplicateError) {
                    throw new Error(
                        "Could not copy a selected object from layer " + group.layerName +
                        " into the temporary export document: " +
                        safeString(duplicateError.message || duplicateError)
                    );
                }
            }

            unlockTemporaryArtwork(temporaryDocument);
            outlineVisibleText(temporaryDocument);
            executeVectorCleanup(temporaryDocument, "expandStyle");
            outlineVisibleText(temporaryDocument);
            executeVectorCleanup(temporaryDocument, "Live Outline Stroke");
            executeVectorCleanup(temporaryDocument, "expandStyle");
            outlineVisibleText(temporaryDocument);
            validateVectorArtwork(temporaryDocument, group.layerName);
            closeOpenFilledPathsForUnite(temporaryDocument, group.layerName);
            uniteAndBakeVectorArtwork(temporaryDocument, group.layerName);

            exportBounds = getVisibleBounds(temporaryDocument, group.layerName);
            widthMm = pointsToMillimeters(exportBounds[2] - exportBounds[0]);
            heightMm = pointsToMillimeters(exportBounds[1] - exportBounds[3]);
            temporaryDocument.artboards[0].artboardRect = exportBounds;
            targetFile = new File(exportFolder.fsName + "/" + group.fileName + ".svg");

            if (targetFile.exists && !targetFile.remove()) {
                throw new Error("Could not overwrite existing SVG: " + targetFile.fsName);
            }

            temporaryDocument.exportFile(targetFile, ExportType.SVG, makeSvgExportOptions());
            if (!targetFile.exists) {
                throw new Error("Illustrator did not write the expected SVG: " + targetFile.fsName);
            }
            cleanExportedSvg(targetFile);
            validateExportedSvg(targetFile, group.layerName);

            return {
                filepath: targetFile.fsName,
                layerName: group.layerName,
                extrudeMm: group.extrudeMm,
                widthMm: widthMm,
                heightMm: heightMm,
                offsetXmm: group.offsetXmm,
                offsetYmm: group.offsetYmm
            };
        } finally {
            closeTemporaryDocument(temporaryDocuments, temporaryDocument);
        }
    }

    function makeRequestId() {
        return "illustrator-svg-" + String(new Date().getTime()) + "-" + String(Math.floor(Math.random() * 1000000));
    }

    function resetStatusFile(statusFile, requestId) {
        writeTextFile(
            statusFile,
            "RequestId=" + requestId + "\n" +
            "Status=Pending\n" +
            "Message=\n" +
            "ImportedCount=0\n"
        );
    }

    function waitForHandoff(statusFile, requestId, expectedCount) {
        var startedAt = new Date().getTime();
        var statusText;
        var status;
        var importedCount;
        var message;

        while (new Date().getTime() - startedAt < STATUS_TIMEOUT_MS) {
            $.sleep(STATUS_POLL_MS);
            statusText = readTextFile(new File(statusFile.fsName));
            if (!statusText) {
                continue;
            }

            status = parseStatusText(statusText);
            if (status.RequestId !== requestId) {
                continue;
            }

            if (status.Status === "Error") {
                message = trim(status.Message);
                throw new Error(message || "Blender could not import the exported SVG files.");
            }

            if (status.Status === "Ok") {
                importedCount = Number(status.ImportedCount);
                if (importedCount !== expectedCount) {
                    throw new Error(
                        "Blender reported success for " + importedCount +
                        " of " + expectedCount + " SVG files."
                    );
                }
                return {
                    requestId: requestId,
                    importedCount: importedCount,
                    message: trim(status.Message)
                };
            }
        }

        throw new Error("Timed out waiting for Blender to import the exported SVG files.");
    }

    if (app.documents.length === 0) {
        throw new Error("Open an Illustrator document and select one or more objects first.");
    }

    var originalDocument = app.activeDocument;
    var originalActiveLayer = null;
    var originalSelection = snapshotSelection(originalDocument.selection);
    var temporaryDocuments = [];
    var ownerPaths;
    var groups;
    var requestItems = [];
    var requestId;
    var postAction = requestedPostAction();
    var result;
    var caughtError = null;
    var i;

    try {
        try {
            originalActiveLayer = originalDocument.activeLayer;
        } catch (ignoreOriginalActiveLayer) {
            originalActiveLayer = null;
        }

        groups = resolveExportGroups(originalSelection);
        ownerPaths = resolveOwnerPaths();
        if (!ownerPaths.handoffFile.exists) {
            throw new Error("Missing same-source Blender handoff: " + ownerPaths.handoffFile.fsName);
        }

        ensureFolder(ownerPaths.runtimeFolder);
        ensureFolder(ownerPaths.exportFolder);

        for (i = 0; i < groups.length; i += 1) {
            requestItems.push(exportGroup(originalDocument, groups[i], ownerPaths.exportFolder, temporaryDocuments));
        }

        requestId = makeRequestId();
        writeTextFile(ownerPaths.requestFile, buildRequestJson(requestId, requestItems, postAction));
        resetStatusFile(ownerPaths.statusFile, requestId);

        if (!ownerPaths.handoffFile.execute()) {
            throw new Error("Windows could not start the Blender handoff: " + ownerPaths.handoffFile.fsName);
        }

        result = waitForHandoff(ownerPaths.statusFile, requestId, requestItems.length);
    } catch (error) {
        caughtError = error;
    } finally {
        closeAllTemporaryDocuments(temporaryDocuments);
        restoreOriginalState(originalDocument, originalActiveLayer, originalSelection);
    }

    if (caughtError) {
        throw caughtError;
    }

    return result;
}());
