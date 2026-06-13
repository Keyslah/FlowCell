//@target illustrator
// Description: FlowCell Illustrator anchor backend. Fast cached anchor path for set/snapshot/align.

(function () {
    var ANCHOR_TAG = "FLOWCELL_ANCHOR";
    var BOUNDS_MODE = "visibleBounds";
    var ANCHOR_BOUNDS_FILE = "illustrator_anchor_bounds.json";
    var MAX_ANCHOR_SCAN_ITEMS = 1500;
    var MAX_SELECTION_ITEMS = 250;

    function pad(value) { return value < 10 ? "0" + value : String(value); }
    function nowStamp() {
        var date = new Date();
        return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) +
            " " + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
    }
    function findProgramRoot() {
        var folder = new File($.fileName).parent;
        for (var i = 0; i < 8 && folder; i += 1) {
            if (new Folder(folder.fsName + "/HelperScripts").exists && new Folder(folder.fsName + "/Panels").exists) {
                return folder;
            }
            folder = folder.parent;
        }
        return new File($.fileName).parent.parent;
    }
    function findRepoRoot() {
        var programRoot = findProgramRoot();
        return programRoot && programRoot.parent && programRoot.parent.parent ? programRoot.parent.parent : programRoot;
    }
    function localFile(name) {
        var folder = new Folder(findRepoRoot().fsName + "/FlowCell/local");
        if (!folder.exists) { folder.create(); }
        return new File(folder.fsName + "/" + name);
    }
    function logFile(name) {
        var folder = new Folder(findRepoRoot().fsName + "/FlowCell/local/logs");
        if (!folder.exists) { folder.create(); }
        return new File(folder.fsName + "/" + name);
    }
    function writeText(file, text, append) {
        file.encoding = "UTF-8";
        if (!file.open(append ? "a" : "w")) { return false; }
        file.write(text);
        file.close();
        return true;
    }
    function readText(file) {
        if (!file.exists || !file.open("r")) { return ""; }
        file.encoding = "UTF-8";
        var text = file.read();
        file.close();
        return text;
    }
    function writeLog(message) {
        try { writeText(logFile("illustrator-anchor.log"), nowStamp() + " | " + message + "\n", true); } catch (ignored) {}
        try { $.writeln("[FlowCell Illustrator Anchor] " + message); } catch (ignoredToo) {}
    }
    function status(message) {
        writeLog(message);
        try { writeText(logFile("illustrator-anchor-status.txt"), message + "\n", false); } catch (ignored) {}
        return message;
    }
    function parseJson(raw) {
        if (!raw) { return null; }
        try { return JSON.parse(raw); } catch (error) { writeLog("json parse failed: " + String(error)); return null; }
    }
    function readCommand() {
        if (typeof FLOWCELL_ILLUSTRATOR_ANCHOR_COMMAND !== "undefined" && FLOWCELL_ILLUSTRATOR_ANCHOR_COMMAND) {
            var inlineCommand = FLOWCELL_ILLUSTRATOR_ANCHOR_COMMAND;
            try { FLOWCELL_ILLUSTRATOR_ANCHOR_COMMAND = null; } catch (ignored) {}
            return inlineCommand;
        }
        var file = localFile("illustrator_anchor_command.json");
        var raw = readText(file);
        if (!raw) { return { command: "status" }; }
        try { file.remove(); } catch (ignoredRemove) {}
        return parseJson(raw) || { command: "status", error: "invalid json" };
    }
    function finite(value) { return typeof value === "number" && isFinite(value); }
    function esc(value) { return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\""); }
    function boundsJson(b) {
        return "{\"left\":" + b.left + ",\"top\":" + b.top + ",\"right\":" + b.right + ",\"bottom\":" + b.bottom +
            ",\"centerX\":" + b.centerX + ",\"centerY\":" + b.centerY +
            (b.uuid ? ",\"uuid\":\"" + esc(b.uuid) + "\"" : "") +
            (b.anchorId ? ",\"anchorId\":\"" + esc(b.anchorId) + "\"" : "") + "}";
    }
    function normalizeBounds(value) {
        if (!value) { return null; }
        var b = { left: Number(value.left), top: Number(value.top), right: Number(value.right), bottom: Number(value.bottom), centerX: Number(value.centerX), centerY: Number(value.centerY) };
        if (!finite(b.left) || !finite(b.top) || !finite(b.right) || !finite(b.bottom) || !finite(b.centerX) || !finite(b.centerY)) { return null; }
        if (value.uuid) { b.uuid = String(value.uuid); }
        if (value.anchorId) { b.anchorId = String(value.anchorId); }
        return b;
    }
    function readAnchorBounds() { return normalizeBounds(parseJson(readText(localFile(ANCHOR_BOUNDS_FILE)))); }
    function writeAnchorBounds(bounds) { writeText(localFile(ANCHOR_BOUNDS_FILE), boundsJson(bounds), false); }
    function docOrNull() { return app.documents.length < 1 ? null : app.activeDocument; }
    function selectionOf(doc) {
        try { if (app.selection && app.selection.length >= 0) { return app.selection; } } catch (ignored) {}
        try { if (doc.selection && doc.selection.length >= 0) { return doc.selection; } } catch (ignoredDoc) {}
        return [];
    }
    function isPageItem(item) { try { return item && item.typename && item.tags && item[BOUNDS_MODE]; } catch (error) { return false; } }
    function tagValue(item) {
        if (!isPageItem(item)) { return ""; }
        try {
            for (var i = item.tags.length - 1; i >= 0; i -= 1) {
                var tag = item.tags[i];
                if (tag && tag.name === ANCHOR_TAG && tag.value) { return String(tag.value); }
            }
        } catch (ignored) {}
        return "";
    }
    function hasAnchorTag(item) { return tagValue(item) !== ""; }
    function uuidOf(item) { try { return item && item.uuid ? String(item.uuid) : ""; } catch (ignored) { return ""; } }
    function byUuid(uuid) {
        if (!uuid) { return null; }
        try {
            if (app.getPageItemFromUuid) {
                var item = app.getPageItemFromUuid(String(uuid));
                if (isPageItem(item)) { return item; }
            }
        } catch (error) { writeLog("uuid lookup skipped: " + String(error)); }
        return null;
    }
    function boundsOf(item) {
        var r = item[BOUNDS_MODE];
        var left = Number(r[0]);
        var top = Number(r[1]);
        var right = Number(r[2]);
        var bottom = Number(r[3]);
        var b = { left: left, top: top, right: right, bottom: bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2, uuid: uuidOf(item) };
        var id = tagValue(item);
        if (id) { b.anchorId = id; }
        return b;
    }
    function removeAnchorTag(item) {
        if (!isPageItem(item)) { return; }
        try {
            for (var i = item.tags.length - 1; i >= 0; i -= 1) {
                if (item.tags[i] && item.tags[i].name === ANCHOR_TAG) { item.tags[i].remove(); }
            }
        } catch (error) { writeLog("tag removal skipped: " + String(error)); }
    }
    function scanAnchorByTag(doc) {
        var count = 0;
        try { count = Number(doc.pageItems.length); } catch (error) { writeLog("anchor scan skipped: " + String(error)); return null; }
        if (count > MAX_ANCHOR_SCAN_ITEMS) { writeLog("anchor scan skipped for " + count + " page items"); return null; }
        for (var i = 0; i < count; i += 1) { if (hasAnchorTag(doc.pageItems[i])) { return doc.pageItems[i]; } }
        return null;
    }
    function resolveAnchorBounds(doc) {
        var stored = readAnchorBounds();
        if (stored) {
            var live = byUuid(stored.uuid);
            if (live) {
                var liveBounds = boundsOf(live);
                liveBounds.anchorId = liveBounds.anchorId || stored.anchorId || "";
                writeAnchorBounds(liveBounds);
                return liveBounds;
            }
            writeLog("using cached anchor bounds without document scan");
            return stored;
        }
        var scanned = scanAnchorByTag(doc);
        if (!scanned) { return null; }
        var scannedBounds = boundsOf(scanned);
        writeAnchorBounds(scannedBounds);
        return scannedBounds;
    }
    function shouldReplace(commandData) {
        if (!commandData || typeof commandData.replace === "undefined") { return true; }
        return !(commandData.replace === false || String(commandData.replace).toLowerCase() === "false");
    }
    function setAnchor(commandData) {
        var doc = docOrNull();
        if (!doc) { return status("no document"); }
        var sel = selectionOf(doc);
        if (sel.length === 0) { return status("no selection"); }
        if (sel.length > 1) { return status("multiple selection ignored"); }
        var item = sel[0];
        if (!isPageItem(item)) { return status("selection is not a PageItem; anchor ignored"); }
        if (!shouldReplace(commandData)) {
            if (hasAnchorTag(item)) { writeAnchorBounds(boundsOf(item)); return status("anchor already set"); }
            if (readAnchorBounds()) { return status("anchor already set; hotkey ignored"); }
        }
        var old = readAnchorBounds();
        var oldItem = old ? byUuid(old.uuid) : null;
        if (oldItem) { removeAnchorTag(oldItem); }
        removeAnchorTag(item);
        var anchorId = "FlowCell anchor " + new Date().getTime() + "-" + Math.floor(Math.random() * 1000000);
        var tag = item.tags.add();
        tag.name = ANCHOR_TAG;
        tag.value = anchorId;
        var b = boundsOf(item);
        b.uuid = uuidOf(item) || b.uuid || "";
        b.anchorId = anchorId;
        writeAnchorBounds(b);
        return status("anchor set");
    }
    function selectedItems(doc) {
        var sel = selectionOf(doc);
        var n = Number(sel.length);
        if (n > MAX_SELECTION_ITEMS) { throw new Error("selection too large (" + n + " items); select " + MAX_SELECTION_ITEMS + " or fewer"); }
        var out = [];
        for (var i = 0; i < n; i += 1) { if (isPageItem(sel[i])) { out.push(sel[i]); } }
        return out;
    }
    function sameBounds(a, b) { return a && b && Math.abs(a.left - b.left) < 0.01 && Math.abs(a.top - b.top) < 0.01 && Math.abs(a.right - b.right) < 0.01 && Math.abs(a.bottom - b.bottom) < 0.01; }
    function isAnchorItem(item, anchor) {
        if (!item || !anchor) { return false; }
        var uuid = uuidOf(item);
        if (anchor.uuid && uuid && uuid === String(anchor.uuid)) { return true; }
        if (anchor.anchorId && tagValue(item) === String(anchor.anchorId)) { return true; }
        return !anchor.uuid && sameBounds(boundsOf(item), anchor);
    }
    function movable(items, anchor) {
        var out = [];
        for (var i = 0; i < items.length; i += 1) { if (!isAnchorItem(items[i], anchor)) { out.push(items[i]); } }
        return out;
    }
    function groupMode(data) { var v = data && data.group; return v === true || String(v).toLowerCase() === "true"; }
    function combinedBounds(items) {
        if (items.length === 0) { return null; }
        var b = boundsOf(items[0]);
        var left = b.left, top = b.top, right = b.right, bottom = b.bottom;
        for (var i = 1; i < items.length; i += 1) {
            b = boundsOf(items[i]);
            left = Math.min(left, b.left); top = Math.max(top, b.top); right = Math.max(right, b.right); bottom = Math.min(bottom, b.bottom);
        }
        return { left: left, top: top, right: right, bottom: bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
    }
    function moveBy(item, dx, dy) { if (Math.abs(dx) >= 0.0001 || Math.abs(dy) >= 0.0001) { item.translate(dx, dy); } }
    function moveAll(items, dx, dy) { for (var i = 0; i < items.length; i += 1) { moveBy(items[i], dx, dy); } return items.length; }
    function delta(axis, mode, mod, b, a) {
        if (axis === "X") {
            if (mod === "SURFACE") {
                if (mode === "MIN") { return { dx: a.left - b.right, dy: 0 }; }
                if (mode === "MAX") { return { dx: a.right - b.left, dy: 0 }; }
                return b.centerX <= a.centerX ? { dx: a.left - b.right, dy: 0 } : { dx: a.right - b.left, dy: 0 };
            }
            if (mode === "MIN") { return { dx: a.left - b.left, dy: 0 }; }
            if (mode === "MAX") { return { dx: a.right - b.right, dy: 0 }; }
            return { dx: a.centerX - b.centerX, dy: 0 };
        }
        if (mod === "SURFACE") {
            if (mode === "MIN") { return { dx: 0, dy: a.bottom - b.top }; }
            if (mode === "MAX") { return { dx: 0, dy: a.top - b.bottom }; }
            return b.centerY <= a.centerY ? { dx: 0, dy: a.bottom - b.top } : { dx: 0, dy: a.top - b.bottom };
        }
        if (mode === "MIN") { return { dx: 0, dy: a.bottom - b.bottom }; }
        if (mode === "MAX") { return { dx: 0, dy: a.top - b.top }; }
        return { dx: 0, dy: a.centerY - b.centerY };
    }
    function alignAxis(commandData) {
        var doc = docOrNull();
        if (!doc) { return status("no document"); }
        var anchor = resolveAnchorBounds(doc);
        if (!anchor) { return status("no anchor set"); }
        var items = movable(selectedItems(doc), anchor);
        if (items.length === 0) { return status("only anchor selected; nothing moved"); }
        var axis = String(commandData.axis || "X").toUpperCase();
        var mode = String(commandData.mode || "CENTER").toUpperCase();
        var mod = String(commandData.modifier || "").toUpperCase();
        if (groupMode(commandData)) {
            var g = combinedBounds(items);
            var gd = delta(axis, mode, mod, g, anchor);
            return status("aligned group " + moveAll(items, gd.dx, gd.dy) + " object(s) to anchor using " + BOUNDS_MODE);
        }
        for (var i = 0; i < items.length; i += 1) { var d = delta(axis, mode, mod, boundsOf(items[i]), anchor); moveBy(items[i], d.dx, d.dy); }
        return status("aligned " + items.length + " object(s) to anchor using " + BOUNDS_MODE);
    }
    function centerOnAnchor(commandData) {
        var doc = docOrNull();
        if (!doc) { return status("no document"); }
        var anchor = resolveAnchorBounds(doc);
        if (!anchor) { return status("no anchor set"); }
        var items = movable(selectedItems(doc), anchor);
        if (items.length === 0) { return status("only anchor selected; nothing moved"); }
        if (groupMode(commandData)) {
            var g = combinedBounds(items);
            return status("centered group " + moveAll(items, anchor.centerX - g.centerX, anchor.centerY - g.centerY) + " object(s) on anchor using " + BOUNDS_MODE);
        }
        for (var i = 0; i < items.length; i += 1) { var b = boundsOf(items[i]); moveBy(items[i], anchor.centerX - b.centerX, anchor.centerY - b.centerY); }
        return status("centered " + items.length + " object(s) on anchor using " + BOUNDS_MODE);
    }
    function centerOnArtboard(commandData) {
        var doc = docOrNull();
        if (!doc) { return status("no document"); }
        var items = selectedItems(doc);
        if (items.length === 0) { return status("no selection"); }
        var r = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
        var cx = (Number(r[0]) + Number(r[2])) / 2;
        var cy = (Number(r[1]) + Number(r[3])) / 2;
        if (groupMode(commandData)) {
            var g = combinedBounds(items);
            return status("centered group " + moveAll(items, cx - g.centerX, cy - g.centerY) + " object(s) on active artboard using " + BOUNDS_MODE);
        }
        for (var i = 0; i < items.length; i += 1) { var b = boundsOf(items[i]); moveBy(items[i], cx - b.centerX, cy - b.centerY); }
        return status("centered " + items.length + " object(s) on active artboard using " + BOUNDS_MODE);
    }
    function main() {
        var data = readCommand();
        var command = String(data.command || "status").toLowerCase();
        writeLog("command requested: " + command);
        try {
            if (command === "set_anchor") { return setAnchor(data); }
            if (command === "align_axis") { return alignAxis(data); }
            if (command === "center_all") { return centerOnAnchor(data); }
            if (command === "center_artboard") { return centerOnArtboard(data); }
        } catch (error) { return status("anchor command failed: " + String(error)); }
        if (data.error) { return status("command payload error: " + data.error); }
        return status("Illustrator anchor backend ready; cached bounds mode is " + BOUNDS_MODE);
    }
    return main();
}());
