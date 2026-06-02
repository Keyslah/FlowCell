//@target illustrator
// Description: FlowCell Illustrator anchor backend. Uses PageItem tags and visibleBounds.

(function () {
    var ANCHOR_TAG = "FLOWCELL_ANCHOR";
    var BOUNDS_MODE = "visibleBounds";
    var ANCHOR_BOUNDS_FILE = "illustrator_anchor_bounds.json";
    var MAX_ANCHOR_SCAN_ITEMS = 1500;
    var MAX_SELECTION_ITEMS = 250;

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
        var localFolder = new Folder(repoRoot.fsName + "/FlowCell/local");
        if (!localFolder.exists) {
            localFolder.create();
        }
        return new File(localFolder.fsName + "/" + fileName);
    }

    function writeLog(message) {
        try {
            var repoRoot = findRepoRoot();
            var logFolder = new Folder(repoRoot.fsName + "/FlowCell/local/logs");
            if (!logFolder.exists) {
                logFolder.create();
            }
            var logFile = new File(logFolder.fsName + "/illustrator-anchor.log");
            logFile.encoding = "UTF-8";
            if (logFile.open("a")) {
                logFile.writeln(nowStamp() + " | " + message);
                logFile.close();
            }
        } catch (ignored) {
        }
        try {
            $.writeln("[FlowCell Illustrator Anchor] " + message);
        } catch (ignoredToo) {
        }
    }

    function status(message) {
        writeLog(message);
        try {
            var statusFile = new File(findRepoRoot().fsName + "/FlowCell/local/logs/illustrator-anchor-status.txt");
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

    function readCommand() {
        if (typeof FLOWCELL_ILLUSTRATOR_ANCHOR_COMMAND !== "undefined" &&
                FLOWCELL_ILLUSTRATOR_ANCHOR_COMMAND) {
            var inlineCommand = FLOWCELL_ILLUSTRATOR_ANCHOR_COMMAND;
            try {
                FLOWCELL_ILLUSTRATOR_ANCHOR_COMMAND = null;
            } catch (ignored) {
            }
            return inlineCommand;
        }

        var commandFile = getLocalPath("illustrator_anchor_command.json");
        var raw = readTextFile(commandFile);
        if (!raw) {
            return { command: "status" };
        }
        try {
            commandFile.remove();
        } catch (ignoredRemove) {
        }

        try {
            return eval("(" + raw + ")");
        } catch (error) {
            return { command: "status", error: String(error) };
        }
    }

    function writeTextFile(file, text) {
        file.encoding = "UTF-8";
        if (!file.open("w")) {
            return false;
        }
        file.write(text);
        file.close();
        return true;
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

    function isFiniteNumber(value) {
        return typeof value === "number" && isFinite(value);
    }

    function escapeJsonString(value) {
        return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    }

    function serializeBounds(bounds) {
        var uuid = bounds.uuid ? ",\"uuid\":\"" + escapeJsonString(bounds.uuid) + "\"" : "";
        return "{" +
            "\"left\":" + String(bounds.left) + "," +
            "\"top\":" + String(bounds.top) + "," +
            "\"right\":" + String(bounds.right) + "," +
            "\"bottom\":" + String(bounds.bottom) + "," +
            "\"centerX\":" + String(bounds.centerX) + "," +
            "\"centerY\":" + String(bounds.centerY) +
            uuid +
            "}";
    }

    function normalizeBounds(value) {
        if (!value) {
            return null;
        }
        var bounds = {
            left: Number(value.left),
            top: Number(value.top),
            right: Number(value.right),
            bottom: Number(value.bottom),
            centerX: Number(value.centerX),
            centerY: Number(value.centerY)
        };
        if (!isFiniteNumber(bounds.left) || !isFiniteNumber(bounds.top) ||
                !isFiniteNumber(bounds.right) || !isFiniteNumber(bounds.bottom) ||
                !isFiniteNumber(bounds.centerX) || !isFiniteNumber(bounds.centerY)) {
            return null;
        }
        if (value.uuid) {
            bounds.uuid = String(value.uuid);
        }
        return bounds;
    }

    function writeAnchorBounds(bounds) {
        var anchorFile = getLocalPath(ANCHOR_BOUNDS_FILE);
        if (!writeTextFile(anchorFile, serializeBounds(bounds))) {
            writeLog("anchor bounds write failed");
        }
    }

    function readAnchorBounds() {
        return normalizeBounds(readJsonFile(getLocalPath(ANCHOR_BOUNDS_FILE)));
    }

    function getActiveDocumentOrNull() {
        if (app.documents.length < 1) {
            return null;
        }
        return app.activeDocument;
    }

    function getSelection(doc) {
        try {
            if (app.selection && app.selection.length > 0) {
                return app.selection;
            }
        } catch (error) {
        }
        try {
            if (doc.selection && doc.selection.length > 0) {
                return doc.selection;
            }
        } catch (docError) {
        }
        try {
            if (app.selection && app.selection.length === 0) {
                return app.selection;
            }
        } catch (emptyAppSelectionError) {
        }
        try {
            if (doc.selection && doc.selection.length === 0) {
                return doc.selection;
            }
        } catch (emptyDocSelectionError) {
        }
        return [];
    }

    function isPageItem(item) {
        try {
            return item && item.typename && item.tags && item[BOUNDS_MODE];
        } catch (error) {
            return false;
        }
    }

    function getTag(item, tagName) {
        if (!isPageItem(item)) {
            return null;
        }
        try {
            for (var i = item.tags.length - 1; i >= 0; i -= 1) {
                var tag = item.tags[i];
                if (tag && tag.name === tagName) {
                    return tag;
                }
            }
        } catch (error) {
        }
        return null;
    }

    function hasAnchorTag(item) {
        return getTag(item, ANCHOR_TAG) !== null;
    }

    function getItemUuid(item) {
        try {
            if (item && item.uuid) {
                return String(item.uuid);
            }
        } catch (error) {
        }
        return "";
    }

    function resolveAnchorByUuid(uuid) {
        if (!uuid) {
            return null;
        }
        try {
            if (app.getPageItemFromUuid) {
                var item = app.getPageItemFromUuid(String(uuid));
                if (isPageItem(item) && hasAnchorTag(item)) {
                    return item;
                }
            }
        } catch (error) {
            writeLog("anchor uuid lookup skipped: " + String(error));
        }
        return null;
    }

    function removeAnchorTag(item) {
        if (!isPageItem(item)) {
            return;
        }
        try {
            for (var i = item.tags.length - 1; i >= 0; i -= 1) {
                var tag = item.tags[i];
                if (tag && tag.name === ANCHOR_TAG) {
                    tag.remove();
                }
            }
        } catch (error) {
            writeLog("anchor tag removal skipped: " + String(error));
        }
    }

    function removePreviousAnchors(doc) {
        var count = 0;
        try {
            count = Number(doc.pageItems.length);
        } catch (error) {
            writeLog("previous anchor cleanup skipped: " + String(error));
            return;
        }
        if (count > MAX_ANCHOR_SCAN_ITEMS) {
            writeLog("previous anchor cleanup skipped for " + count + " page items");
            return;
        }
        for (var i = doc.pageItems.length - 1; i >= 0; i -= 1) {
            removeAnchorTag(doc.pageItems[i]);
        }
    }

    function setAnchorTag(item) {
        removeAnchorTag(item);
        var tag = item.tags.add();
        tag.name = ANCHOR_TAG;
        tag.value = "FlowCell anchor " + String(new Date().getTime());
    }

    function findAnchor(doc) {
        var count = 0;
        try {
            count = Number(doc.pageItems.length);
        } catch (error) {
            writeLog("anchor scan skipped: " + String(error));
            return null;
        }
        if (count > MAX_ANCHOR_SCAN_ITEMS) {
            writeLog("anchor scan skipped for " + count + " page items");
            return null;
        }
        for (var i = 0; i < count; i += 1) {
            var item = doc.pageItems[i];
            if (hasAnchorTag(item)) {
                return item;
            }
        }
        return null;
    }

    function findExistingAnchor(doc) {
        var storedBounds = readAnchorBounds();
        var anchor = resolveAnchorByUuid(storedBounds && storedBounds.uuid);
        if (anchor) {
            return anchor;
        }
        return findAnchor(doc);
    }

    function resolveAnchorBounds(doc) {
        var storedBounds = readAnchorBounds();
        var anchor = findExistingAnchor(doc);
        if (!anchor) {
            if (storedBounds) {
                writeLog("anchor live tag not found; using cached " + BOUNDS_MODE);
                return storedBounds;
            }
            return null;
        }

        var liveBounds = getBounds(anchor);
        liveBounds.uuid = getItemUuid(anchor) || (storedBounds && storedBounds.uuid) || "";
        writeAnchorBounds(liveBounds);
        return liveBounds;
    }

    function getBounds(item) {
        var bounds = item[BOUNDS_MODE];
        var left = Number(bounds[0]);
        var top = Number(bounds[1]);
        var right = Number(bounds[2]);
        var bottom = Number(bounds[3]);
        return {
            left: left,
            top: top,
            right: right,
            bottom: bottom,
            centerX: (left + right) / 2,
            centerY: (top + bottom) / 2,
            uuid: getItemUuid(item)
        };
    }

    function moveItemBy(item, dx, dy) {
        if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) {
            return;
        }
        item.translate(dx, dy);
    }

    function shouldReplaceAnchor(commandData) {
        if (!commandData || typeof commandData.replace === "undefined") {
            return true;
        }
        return !(commandData.replace === false || String(commandData.replace).toLowerCase() === "false");
    }

    function setAnchor(commandData) {
        var doc = getActiveDocumentOrNull();
        if (!doc) {
            return status("no document");
        }

        var selection = getSelection(doc);
        if (selection.length === 0) {
            return status("no selection");
        }
        if (selection.length > 1) {
            return status("multiple selection ignored");
        }

        var item = selection[0];
        if (!isPageItem(item)) {
            return status("selection is not a PageItem; anchor ignored");
        }

        if (!shouldReplaceAnchor(commandData)) {
            if (hasAnchorTag(item)) {
                writeAnchorBounds(getBounds(item));
                return status("anchor already set");
            }

            var existingAnchor = findExistingAnchor(doc);
            if (existingAnchor) {
                writeAnchorBounds(getBounds(existingAnchor));
                return status("anchor already set; hotkey ignored");
            }
        }

        removePreviousAnchors(doc);
        setAnchorTag(item);
        writeAnchorBounds(getBounds(item));
        return status("anchor set");
    }

    function selectedPageItems(doc) {
        var selection = getSelection(doc);
        var selectionLength = Number(selection.length);
        if (selectionLength > MAX_SELECTION_ITEMS) {
            throw new Error("selection too large (" + selectionLength + " items); select " + MAX_SELECTION_ITEMS + " or fewer");
        }
        var items = [];
        for (var i = 0; i < selectionLength; i += 1) {
            if (isPageItem(selection[i])) {
                items.push(selection[i]);
            }
        }
        return items;
    }

    function isAnchorItem(item, anchorBounds) {
        if (!item) {
            return false;
        }
        if (anchorBounds && anchorBounds.uuid) {
            return getItemUuid(item) === String(anchorBounds.uuid);
        }
        return hasAnchorTag(item);
    }

    function movablePageItems(items, anchorBounds) {
        var movableItems = [];
        for (var i = 0; i < items.length; i += 1) {
            if (!isAnchorItem(items[i], anchorBounds)) {
                movableItems.push(items[i]);
            }
        }
        return movableItems;
    }

    function isGroupMode(commandData) {
        var value = commandData && commandData.group;
        return value === true || String(value).toLowerCase() === "true";
    }

    function combinedBounds(items) {
        if (items.length === 0) {
            return null;
        }
        var firstBounds = getBounds(items[0]);
        var left = firstBounds.left;
        var top = firstBounds.top;
        var right = firstBounds.right;
        var bottom = firstBounds.bottom;
        for (var i = 1; i < items.length; i += 1) {
            var bounds = getBounds(items[i]);
            left = Math.min(left, bounds.left);
            top = Math.max(top, bounds.top);
            right = Math.max(right, bounds.right);
            bottom = Math.min(bottom, bounds.bottom);
        }
        return {
            left: left,
            top: top,
            right: right,
            bottom: bottom,
            centerX: (left + right) / 2,
            centerY: (top + bottom) / 2
        };
    }

    function moveItemsBy(items, dx, dy) {
        for (var i = 0; i < items.length; i += 1) {
            moveItemBy(items[i], dx, dy);
        }
        return items.length;
    }

    function alignmentDelta(axis, mode, modifier, bounds, anchorBounds) {
        var source = 0;
        var target = 0;
        if (axis === "X") {
            if (modifier === "SURFACE") {
                if (mode === "MIN") {
                    source = bounds.right;
                    target = anchorBounds.left;
                } else if (mode === "MAX") {
                    source = bounds.left;
                    target = anchorBounds.right;
                } else if (bounds.centerX <= anchorBounds.centerX) {
                    source = bounds.right;
                    target = anchorBounds.left;
                } else {
                    source = bounds.left;
                    target = anchorBounds.right;
                }
            } else if (mode === "MIN") {
                source = bounds.left;
                target = anchorBounds.left;
            } else if (mode === "MAX") {
                source = bounds.right;
                target = anchorBounds.right;
            } else {
                source = bounds.centerX;
                target = anchorBounds.centerX;
            }
            return { dx: target - source, dy: 0 };
        }
        if (axis === "Y") {
            if (modifier === "SURFACE") {
                if (mode === "MIN") {
                    source = bounds.top;
                    target = anchorBounds.bottom;
                } else if (mode === "MAX") {
                    source = bounds.bottom;
                    target = anchorBounds.top;
                } else if (bounds.centerY <= anchorBounds.centerY) {
                    source = bounds.top;
                    target = anchorBounds.bottom;
                } else {
                    source = bounds.bottom;
                    target = anchorBounds.top;
                }
            } else if (mode === "MIN") {
                source = bounds.bottom;
                target = anchorBounds.bottom;
            } else if (mode === "MAX") {
                source = bounds.top;
                target = anchorBounds.top;
            } else {
                source = bounds.centerY;
                target = anchorBounds.centerY;
            }
            return { dx: 0, dy: target - source };
        }
        return { dx: 0, dy: 0 };
    }

    function alignAxis(commandData) {
        var doc = getActiveDocumentOrNull();
        if (!doc) {
            return status("no document");
        }

        var anchorBounds = resolveAnchorBounds(doc);
        if (!anchorBounds) {
            return status("no anchor set");
        }

        var items = selectedPageItems(doc);
        if (items.length === 0) {
            return status("no selection");
        }

        var axis = String(commandData.axis || "X").toUpperCase();
        var mode = String(commandData.mode || "CENTER").toUpperCase();
        var modifier = String(commandData.modifier || "").toUpperCase();
        var movableItems = movablePageItems(items, anchorBounds);
        var moved = 0;

        if (movableItems.length === 0) {
            return status("only anchor selected; nothing moved");
        }

        if (isGroupMode(commandData)) {
            var groupBounds = combinedBounds(movableItems);
            var groupDelta = alignmentDelta(axis, mode, modifier, groupBounds, anchorBounds);
            moved = moveItemsBy(movableItems, groupDelta.dx, groupDelta.dy);
            return status("aligned group " + moved + " object(s) to anchor using " + BOUNDS_MODE);
        }

        for (var i = 0; i < movableItems.length; i += 1) {
            var item = movableItems[i];
            var bounds = getBounds(item);
            var delta = alignmentDelta(axis, mode, modifier, bounds, anchorBounds);
            moveItemBy(item, delta.dx, delta.dy);
            moved += 1;
        }

        if (moved === 0) {
            return status("only anchor selected; nothing moved");
        }
        return status("aligned " + moved + " object(s) to anchor using " + BOUNDS_MODE);
    }

    function centerOnAnchor(commandData) {
        var doc = getActiveDocumentOrNull();
        if (!doc) {
            return status("no document");
        }

        var anchorBounds = resolveAnchorBounds(doc);
        if (!anchorBounds) {
            return status("no anchor set");
        }

        var items = selectedPageItems(doc);
        if (items.length === 0) {
            return status("no selection");
        }

        var movableItems = movablePageItems(items, anchorBounds);
        if (movableItems.length === 0) {
            return status("only anchor selected; nothing moved");
        }

        if (isGroupMode(commandData)) {
            var groupBounds = combinedBounds(movableItems);
            var groupMoved = moveItemsBy(
                movableItems,
                anchorBounds.centerX - groupBounds.centerX,
                anchorBounds.centerY - groupBounds.centerY
            );
            return status("centered group " + groupMoved + " object(s) on anchor using " + BOUNDS_MODE);
        }

        var moved = 0;
        for (var i = 0; i < movableItems.length; i += 1) {
            var item = movableItems[i];
            var bounds = getBounds(item);
            moveItemBy(item, anchorBounds.centerX - bounds.centerX, anchorBounds.centerY - bounds.centerY);
            moved += 1;
        }

        if (moved === 0) {
            return status("only anchor selected; nothing moved");
        }
        return status("centered " + moved + " object(s) on anchor using " + BOUNDS_MODE);
    }

    function centerOnArtboard(commandData) {
        var doc = getActiveDocumentOrNull();
        if (!doc) {
            return status("no document");
        }

        var items = selectedPageItems(doc);
        if (items.length === 0) {
            return status("no selection");
        }

        var artboardIndex = doc.artboards.getActiveArtboardIndex();
        var artboardBounds = doc.artboards[artboardIndex].artboardRect;
        var centerX = (Number(artboardBounds[0]) + Number(artboardBounds[2])) / 2;
        var centerY = (Number(artboardBounds[1]) + Number(artboardBounds[3])) / 2;

        var anchorBounds = resolveAnchorBounds(doc);
        var movableItems = movablePageItems(items, anchorBounds);
        if (movableItems.length === 0) {
            return status("only anchor selected; nothing moved");
        }

        if (isGroupMode(commandData)) {
            var groupBounds = combinedBounds(movableItems);
            var groupMoved = moveItemsBy(movableItems, centerX - groupBounds.centerX, centerY - groupBounds.centerY);
            return status("centered group " + groupMoved + " object(s) on active artboard using " + BOUNDS_MODE);
        }

        var moved = 0;
        for (var i = 0; i < movableItems.length; i += 1) {
            var item = movableItems[i];
            var bounds = getBounds(item);
            moveItemBy(item, centerX - bounds.centerX, centerY - bounds.centerY);
            moved += 1;
        }
        if (moved === 0) {
            return status("only anchor selected; nothing moved");
        }
        return status("centered " + moved + " object(s) on active artboard using " + BOUNDS_MODE);
    }

    function main() {
        var commandData = readCommand();
        var command = String(commandData.command || "status").toLowerCase();
        writeLog("command requested: " + command);
        try {
            if (command === "set_anchor") {
                return setAnchor(commandData);
            }
            if (command === "align_axis") {
                return alignAxis(commandData);
            }
            if (command === "center_all") {
                return centerOnAnchor(commandData);
            }
            if (command === "center_artboard") {
                return centerOnArtboard(commandData);
            }
        } catch (error) {
            return status("anchor command failed: " + String(error));
        }
        if (commandData.error) {
            return status("command payload error: " + commandData.error);
        }
        return status("Illustrator anchor backend ready; bounds mode is " + BOUNDS_MODE);
    }

    return main();
}());
