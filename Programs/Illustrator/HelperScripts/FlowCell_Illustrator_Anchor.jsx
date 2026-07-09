//@target illustrator
// Description: FlowCell Illustrator anchor backend. Fast cached anchor path for set/snapshot/align.

(function () {
    var BOUNDS_MODE = "visibleBounds";
    var ANCHOR_BOUNDS_FILE = "illustrator_anchor_bounds.json";
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
        var folder = new Folder(findRepoRoot().fsName + "/flowcellbackend/local");
        if (!folder.exists) { folder.create(); }
        return new File(folder.fsName + "/" + name);
    }
    function logFile(name) {
        var folder = new Folder(findRepoRoot().fsName + "/flowcellbackend/local/logs");
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
        try {
            if (typeof JSON !== "undefined" && JSON.parse) {
                return JSON.parse(raw);
            }
        } catch (jsonError) {
            writeLog("json parse failed: " + String(jsonError));
        }
        try {
            return eval("(" + raw + ")");
        } catch (evalError) {
            writeLog("json parse failed: " + String(evalError));
            return null;
        }
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
    function boundsJson(b) {
        return "{\"left\":" + b.left + ",\"top\":" + b.top + ",\"right\":" + b.right + ",\"bottom\":" + b.bottom +
            ",\"centerX\":" + b.centerX + ",\"centerY\":" + b.centerY + "}";
    }
    function normalizeBounds(value) {
        if (!value) { return null; }
        var b = { left: Number(value.left), top: Number(value.top), right: Number(value.right), bottom: Number(value.bottom), centerX: Number(value.centerX), centerY: Number(value.centerY) };
        if (!finite(b.left) || !finite(b.top) || !finite(b.right) || !finite(b.bottom) || !finite(b.centerX) || !finite(b.centerY)) { return null; }
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
    function isPageItem(item) { try { return item && item.typename && item[BOUNDS_MODE] && item.translate; } catch (error) { return false; } }
    function boundsOf(item) {
        var r = item[BOUNDS_MODE];
        var left = Number(r[0]);
        var top = Number(r[1]);
        var right = Number(r[2]);
        var bottom = Number(r[3]);
        return { left: left, top: top, right: right, bottom: bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
    }
    function resolveAnchorBounds() {
        var stored = readAnchorBounds();
        if (stored) { return stored; }
        return null;
    }
    function setAnchor() {
        var doc = docOrNull();
        if (!doc) { return status("no document"); }
        var items = selectedItems(doc);
        if (items.length === 0) { return status("no selection"); }
        var b = items.length === 1 ? boundsOf(items[0]) : combinedBounds(items);
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
        var anchor = resolveAnchorBounds();
        if (!anchor) { return status("no anchor set"); }
        var items = selectedItems(doc);
        if (items.length === 0) { return status("no selection"); }
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
        var anchor = resolveAnchorBounds();
        if (!anchor) { return status("no anchor set"); }
        var items = selectedItems(doc);
        if (items.length === 0) { return status("no selection"); }
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
            if (command === "set_anchor") { return setAnchor(); }
            if (command === "align_axis") { return alignAxis(data); }
            if (command === "center_all") { return centerOnAnchor(data); }
            if (command === "center_artboard") { return centerOnArtboard(data); }
        } catch (error) { return status("anchor command failed: " + String(error)); }
        if (data.error) { return status("command payload error: " + data.error); }
        return status("Illustrator anchor backend ready; cached bounds mode is " + BOUNDS_MODE);
    }
    return main();
}());
