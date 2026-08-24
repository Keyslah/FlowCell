//@target illustrator
// Description: FlowCell Illustrator rotate backend. Uses visibleBounds and FlowCell toolset commands.

(function () {
    var TOOLSET_COMMAND_FILE = "illustrator_rotate_command.json";
    var ANCHOR_BOUNDS_FILE = "illustrator_anchor_bounds.json";
    var MAX_SELECTION_ITEMS = 250;
    var MAX_DISTRIBUTE_POSITIONS = 72;
    var MAX_COMMAND_AGE_MS = 15000;

    function nowStamp() {
        var date = new Date();
        function pad(value) {
            return value < 10 ? "0" + value : String(value);
        }
        return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) +
            " " + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
    }

    function findProgramRoot() {
        var folder = new File($.fileName).parent;
        for (var i = 0; i < 8 && folder; i += 1) {
            var helper = new Folder(folder.fsName + "/HelperScripts");
            var panels = new Folder(folder.fsName + "/Panels");
            if (helper.exists && panels.exists) {
                return folder;
            }
            folder = folder.parent;
        }
        return new File($.fileName).parent.parent;
    }

    function findRepoRoot() {
        var programRoot = findProgramRoot();
        if (programRoot && programRoot.parent && programRoot.parent.parent) {
            return programRoot.parent.parent;
        }
        return programRoot;
    }

    function getLocalPath(fileName) {
        var repoRoot = findRepoRoot();
        var localFolder = new Folder(repoRoot.fsName + "/flowcellbackend/local");
        if (!localFolder.exists) {
            localFolder.create();
        }
        return new File(localFolder.fsName + "/" + fileName);
    }

    function writeLog(message) {
        try {
            var repoRoot = findRepoRoot();
            var logFolder = new Folder(repoRoot.fsName + "/flowcellbackend/local/logs");
            if (!logFolder.exists) {
                logFolder.create();
            }
            var logFile = new File(logFolder.fsName + "/illustrator-rotate.log");
            logFile.encoding = "UTF-8";
            if (logFile.open("a")) {
                logFile.writeln(nowStamp() + " | " + message);
                logFile.close();
            }
        } catch (ignored) {
        }
        try {
            $.writeln("[FlowCell Illustrator Rotate] " + message);
        } catch (ignoredToo) {
        }
    }

    function status(message) {
        writeLog(message);
        try {
            var statusFile = new File(findRepoRoot().fsName + "/flowcellbackend/local/logs/illustrator-rotate-status.txt");
            statusFile.encoding = "UTF-8";
            if (statusFile.open("w")) {
                statusFile.writeln(message);
                statusFile.close();
            }
        } catch (ignored) {
        }
        return message;
    }

    function readTextFile(file) {
        if (!file.exists || !file.open("r")) {
            return "";
        }
        file.encoding = "UTF-8";
        var text = file.read();
        file.close();
        return text;
    }

    function readJsonFile(file) {
        var raw = readTextFile(file);
        if (!raw) {
            return null;
        }
        try {
            return eval("(" + raw + ")");
        } catch (error) {
            writeLog("json read failed for " + file.fsName + ": " + String(error));
            return null;
        }
    }

    function readCommand() {
        var commandFile = getLocalPath(TOOLSET_COMMAND_FILE);
        var raw = readTextFile(commandFile);
        if (!raw) {
            return { command: "status", payload: {} };
        }
        try {
            commandFile.remove();
        } catch (ignoredRemove) {
        }

        var record = null;
        try {
            record = eval("(" + raw + ")");
        } catch (error) {
            return { command: "status", payload: {}, error: String(error) };
        }
        writeLog("command requested: " + String(record && record.command ? record.command : "status"));

        var payload = record && record.payload ? record.payload : {};
        if (record && record.createdAtMs) {
            var commandAgeMs = new Date().getTime() - Number(record.createdAtMs);
            if (isFiniteNumber(commandAgeMs) && commandAgeMs > MAX_COMMAND_AGE_MS) {
                return { command: "status", payload: {}, error: "stale rotate command ignored" };
            }
        } else if (record && record.command && String(record.command).toLowerCase() !== "status") {
            return { command: "status", payload: {}, error: "undated rotate command ignored" };
        }
        return {
            command: record && record.command ? String(record.command) : "status",
            payload: payload
        };
    }

    function isFiniteNumber(value) {
        return typeof value === "number" && isFinite(value);
    }

    function finiteNumber(value, fallback) {
        var nextValue = Number(value);
        return isFiniteNumber(nextValue) ? nextValue : fallback;
    }

    function payloadValue(payload, camelName, snakeName, fallback) {
        if (payload && typeof payload[camelName] !== "undefined" && payload[camelName] !== null) {
            return payload[camelName];
        }
        if (payload && typeof payload[snakeName] !== "undefined" && payload[snakeName] !== null) {
            return payload[snakeName];
        }
        return fallback;
    }

    function getActiveDocument() {
        if (app.documents.length < 1) {
            throw new Error("Open an Illustrator document first.");
        }
        return app.activeDocument;
    }

    function isPageItem(item) {
        try {
            return item && item.typename && item.visibleBounds && item.rotate && item.translate;
        } catch (error) {
            return false;
        }
    }

    function isMovablePageItem(item) {
        if (!isPageItem(item)) {
            return false;
        }
        try {
            if (item.locked || item.hidden) {
                return false;
            }
        } catch (ignored) {
        }
        try {
            if (item.layer && (item.layer.locked || !item.layer.visible)) {
                return false;
            }
        } catch (ignoredLayer) {
        }
        return true;
    }

    function selectedPageItems(doc) {
        var items = [];
        try {
            if (!doc.selection || doc.selection.length < 1) {
                return items;
            }
            for (var i = 0; i < doc.selection.length && items.length < MAX_SELECTION_ITEMS; i += 1) {
                if (isMovablePageItem(doc.selection[i])) {
                    items.push(doc.selection[i]);
                }
            }
        } catch (error) {
            return [];
        }
        return items;
    }

    function boundsForItem(item) {
        var raw = item.visibleBounds;
        var left = finiteNumber(raw[0], 0);
        var top = finiteNumber(raw[1], 0);
        var right = finiteNumber(raw[2], 0);
        var bottom = finiteNumber(raw[3], 0);
        var normalizedLeft = Math.min(left, right);
        var normalizedRight = Math.max(left, right);
        var normalizedTop = Math.max(top, bottom);
        var normalizedBottom = Math.min(top, bottom);
        return {
            left: normalizedLeft,
            top: normalizedTop,
            right: normalizedRight,
            bottom: normalizedBottom,
            centerX: (normalizedLeft + normalizedRight) / 2,
            centerY: (normalizedTop + normalizedBottom) / 2
        };
    }

    function unionBounds(items) {
        if (!items || items.length < 1) {
            return null;
        }
        var bounds = boundsForItem(items[0]);
        for (var i = 1; i < items.length; i += 1) {
            var itemBounds = boundsForItem(items[i]);
            bounds.left = Math.min(bounds.left, itemBounds.left);
            bounds.top = Math.max(bounds.top, itemBounds.top);
            bounds.right = Math.max(bounds.right, itemBounds.right);
            bounds.bottom = Math.min(bounds.bottom, itemBounds.bottom);
        }
        bounds.centerX = (bounds.left + bounds.right) / 2;
        bounds.centerY = (bounds.top + bounds.bottom) / 2;
        return bounds;
    }

    function normalizeCachedBounds(value) {
        if (!value) {
            return null;
        }
        var bounds = {
            left: finiteNumber(value.left, NaN),
            top: finiteNumber(value.top, NaN),
            right: finiteNumber(value.right, NaN),
            bottom: finiteNumber(value.bottom, NaN),
            centerX: finiteNumber(value.centerX, NaN),
            centerY: finiteNumber(value.centerY, NaN)
        };
        if (!isFiniteNumber(bounds.left) || !isFiniteNumber(bounds.top) ||
                !isFiniteNumber(bounds.right) || !isFiniteNumber(bounds.bottom) ||
                !isFiniteNumber(bounds.centerX) || !isFiniteNumber(bounds.centerY)) {
            return null;
        }
        return bounds;
    }

    function readAnchorBounds() {
        return normalizeCachedBounds(readJsonFile(getLocalPath(ANCHOR_BOUNDS_FILE)));
    }

    function resolveAnchorBounds() {
        var cachedBounds = readAnchorBounds();
        if (cachedBounds) {
            return cachedBounds;
        }
        return null;
    }

    function activeArtboardCenter(doc) {
        var artboardIndex = doc.artboards.getActiveArtboardIndex();
        var rect = doc.artboards[artboardIndex].artboardRect;
        var left = finiteNumber(rect[0], 0);
        var top = finiteNumber(rect[1], 0);
        var right = finiteNumber(rect[2], 0);
        var bottom = finiteNumber(rect[3], 0);
        return {
            kind: "fixed",
            x: (left + right) / 2,
            y: (top + bottom) / 2
        };
    }

    function resolvePivot(doc, items, centerMode, anchorBounds) {
        var mode = String(centerMode || "GEOMETRY").toUpperCase();
        if (mode === "ORIGIN") {
            return { kind: "each" };
        }
        if (mode === "WORLD" || mode === "ARTBOARD") {
            return activeArtboardCenter(doc);
        }
        if (mode === "CURSOR" || mode === "ANCHOR") {
            if (!anchorBounds) {
                throw new Error("Set Illustrator Anchor before using Anchor pivot.");
            }
            return { kind: "fixed", x: anchorBounds.centerX, y: anchorBounds.centerY };
        }
        if (mode === "OBJECT") {
            if (!items || items.length < 1) {
                throw new Error("Select an object before using Object pivot.");
            }
            var objectBounds = boundsForItem(items[0]);
            return { kind: "fixed", x: objectBounds.centerX, y: objectBounds.centerY };
        }

        var selectionBounds = unionBounds(items);
        if (!selectionBounds) {
            throw new Error("Select at least one object.");
        }
        return { kind: "fixed", x: selectionBounds.centerX, y: selectionBounds.centerY };
    }

    function pivotForItem(item, pivot) {
        if (pivot.kind !== "each") {
            return pivot;
        }
        var bounds = boundsForItem(item);
        return { kind: "fixed", x: bounds.centerX, y: bounds.centerY };
    }

    function rotationMatrixAboutPivot(pivot, angleDeg) {
        var matrix = app.getRotationMatrix(angleDeg);
        matrix.mValueTX = pivot.x - (matrix.mValueA * pivot.x + matrix.mValueC * pivot.y);
        matrix.mValueTY = pivot.y - (matrix.mValueB * pivot.x + matrix.mValueD * pivot.y);
        return matrix;
    }

    function transformItem(item, pivot, angleDeg) {
        var itemPivot = pivotForItem(item, pivot);
        item.transform(
            rotationMatrixAboutPivot(itemPivot, angleDeg),
            true,
            true,
            true,
            true,
            100,
            Transformation.DOCUMENTORIGIN
        );
    }

    function applyTransform(doc, items, pivot, angleDeg, copySelection) {
        if (!copySelection) {
            for (var i = 0; i < items.length; i += 1) {
                transformItem(items[i], pivot, angleDeg);
            }
            return "Rotated " + items.length + " selected object(s) " + angleDeg.toFixed(3) + " degrees.";
        }

        var duplicates = [];
        try {
            duplicateItems(items, duplicates);
            for (var duplicateIndex = 0; duplicateIndex < duplicates.length; duplicateIndex += 1) {
                transformItem(duplicates[duplicateIndex], pivot, angleDeg);
            }
            selectItems(doc, duplicates, true);
        } catch (error) {
            removeItems(duplicates);
            selectItems(doc, items, false);
            throw error;
        }
        return "Copied and rotated " + duplicates.length + " selected object(s) " +
            angleDeg.toFixed(3) + " degrees.";
    }

    function duplicateItems(items, destination) {
        var duplicates = destination || [];
        for (var i = 0; i < items.length; i += 1) {
            duplicates.push(items[i].duplicate());
        }
        return duplicates;
    }

    function removeItems(items) {
        for (var i = items.length - 1; i >= 0; i -= 1) {
            try {
                items[i].remove();
            } catch (error) {
                writeLog("copy cleanup skipped: " + String(error));
            }
        }
    }

    function selectItems(doc, items, failOnError) {
        try {
            doc.selection = null;
            doc.selection = items;
        } catch (error) {
            writeLog("selection update skipped: " + String(error));
            if (failOnError) {
                throw error;
            }
        }
    }

    function applyDistribute(doc, items, pivot, directionSign, distributeCount) {
        var totalPositions = Math.floor(Math.abs(finiteNumber(distributeCount, 0)));
        if (totalPositions < 2) {
            throw new Error("Enter a Distribute count of 2 or more.");
        }
        if (totalPositions > MAX_DISTRIBUTE_POSITIONS) {
            throw new Error("Distribute count is capped at " + MAX_DISTRIBUTE_POSITIONS + " positions.");
        }
        var allItems = [];
        for (var s = 0; s < items.length; s += 1) {
            allItems.push(items[s]);
        }

        var stepAngle = directionSign * (360 / totalPositions);
        for (var positionIndex = 1; positionIndex < totalPositions; positionIndex += 1) {
            var duplicates = duplicateItems(items);
            var angle = stepAngle * positionIndex;
            for (var i = 0; i < duplicates.length; i += 1) {
                transformItem(duplicates[i], pivot, angle);
                allItems.push(duplicates[i]);
            }
        }
        selectItems(doc, allItems);
        return "Distributed " + items.length + " selected object(s) into " +
            totalPositions + " total positions.";
    }

    function runRotateCommand(commandRecord) {
        if (commandRecord.error) {
            return status("Illustrator Rotate command parse failed: " + commandRecord.error);
        }

        var command = String(commandRecord.command || "status").toLowerCase();
        if (command === "status") {
            return status("Illustrator Rotate is waiting for a FlowCell rotate command.");
        }
        var presetAngle = null;
        if (command === "preset_30") {
            presetAngle = 30;
        } else if (command === "preset_45") {
            presetAngle = 45;
        } else if (command === "preset_90") {
            presetAngle = 90;
        }
        if (command.indexOf("center_") === 0 || command.indexOf("mode_") === 0) {
            return status("Stage rotate values in the FlowCell popout, then press Negative or Positive.");
        }
        if (presetAngle === null && command !== "apply_negative" &&
                command !== "apply_positive" && command !== "apply") {
            throw new Error("Unsupported Illustrator rotate command: " + command);
        }

        var doc = getActiveDocument();
        var items = selectedPageItems(doc);
        if (items.length < 1) {
            throw new Error("Select at least one unlocked Illustrator object.");
        }
        if (items.length >= MAX_SELECTION_ITEMS) {
            writeLog("selection was capped at " + MAX_SELECTION_ITEMS + " items");
        }

        var payload = commandRecord.payload || {};
        var operationMode = presetAngle === null
            ? String(payloadValue(payload, "operationMode", "operation_mode", "TRANSFORM")).toUpperCase()
            : "TRANSFORM";
        var centerMode = String(payloadValue(payload, "centerMode", "center_mode", "GEOMETRY")).toUpperCase();
        var defaultValue = operationMode === "DISTRIBUTE" ? 3 : 90;
        var sharedValue = finiteNumber(payloadValue(payload, "value", "value", defaultValue), defaultValue);
        var angleBase = presetAngle === null
            ? Math.abs(finiteNumber(payloadValue(payload, "angleDeg", "angle_deg", sharedValue), sharedValue))
            : presetAngle;
        var distributeCount = finiteNumber(payloadValue(payload, "distributeCount", "distribute_count", sharedValue), sharedValue);
        var copySelection = payloadValue(payload, "copySelection", "copy_selection", false) === true;
        if (operationMode === "DISTRIBUTE" && copySelection) {
            throw new Error("Copy is only available in Transform mode.");
        }
        // The retired Rotate toolbox dispatched its instant presets through
        // apply_positive. Preserve that exact Illustrator sign so their visible
        // direction stays unchanged.
        var directionSign = command === "apply_negative" ? -1 : 1;
        var usesAnchor = centerMode === "CURSOR" || centerMode === "ANCHOR";
        var anchorBounds = usesAnchor ? resolveAnchorBounds() : null;
        if (usesAnchor) {
            if (!anchorBounds) {
                throw new Error("Set Illustrator Anchor before using Anchor pivot.");
            }
        }
        var pivot = resolvePivot(doc, items, centerMode, anchorBounds);

        if (operationMode === "DISTRIBUTE") {
            return status(applyDistribute(
                doc,
                items,
                pivot,
                directionSign,
                distributeCount
            ));
        }
        if (operationMode !== "TRANSFORM") {
            throw new Error("Unsupported Illustrator rotate mode: " + operationMode);
        }

        return status(applyTransform(doc, items, pivot, directionSign * angleBase, copySelection));
    }

    var previousCoordinateSystem = null;
    try {
        previousCoordinateSystem = app.coordinateSystem;
        app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
    } catch (ignoredCoordinateSystem) {
    }

    try {
        return runRotateCommand(readCommand());
    } catch (error) {
        return status("Illustrator Rotate failed: " + String(error));
    } finally {
        try {
            if (previousCoordinateSystem !== null) {
                app.coordinateSystem = previousCoordinateSystem;
            }
        } catch (ignoredRestore) {
        }
    }
}());
