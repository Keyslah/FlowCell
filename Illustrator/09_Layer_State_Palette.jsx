#target illustrator

(function () {
    var PANEL_KEY = "__illLayersStatePalette";
    var VIS_KEY = "__illLayersVisibilityState";
    var LOCK_KEY = "__illLayersLockState";

    if (!$.global[VIS_KEY]) {
        $.global[VIS_KEY] = [];
    }

    if (!$.global[LOCK_KEY]) {
        $.global[LOCK_KEY] = [];
    }

    if ($.global[PANEL_KEY] && isWindowUsable($.global[PANEL_KEY])) {
        try {
            $.global[PANEL_KEY].show();
            $.global[PANEL_KEY].active = true;
        } catch (ignore) {}
        return;
    }

    var win = new Window("palette", "Layer State", undefined, { resizeable: false });
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.spacing = 6;
    win.margins = 10;

    var btnBaselineVisibility = win.add("button", undefined, "Baseline Visibility");
    var btnSetVisibility = win.add("button", undefined, "Set Visibility");
    var btnBaselineLock = win.add("button", undefined, "Baseline Lock");
    var btnSetLock = win.add("button", undefined, "Set Lock");

    btnBaselineVisibility.onClick = function () {
        withDocument(function (doc) {
            $.global[VIS_KEY] = captureLayerState(doc, "visible");
        });
    };

    btnSetVisibility.onClick = function () {
        withDocument(function () {
            applyVisibilityState($.global[VIS_KEY]);
        });
    };

    btnBaselineLock.onClick = function () {
        withDocument(function (doc) {
            $.global[LOCK_KEY] = captureLayerState(doc, "locked");
        });
    };

    btnSetLock.onClick = function () {
        withDocument(function () {
            applyLockState($.global[LOCK_KEY]);
        });
    };

    win.onClose = function () {
        $.global[PANEL_KEY] = null;
    };

    $.global[PANEL_KEY] = win;
    win.center();
    win.show();

    function withDocument(callback) {
        if (app.documents.length === 0) {
            return;
        }

        callback(app.activeDocument);
    }

    function captureLayerState(documentRef, propertyName) {
        var state = [];
        var i;

        for (i = 0; i < documentRef.layers.length; i += 1) {
            collectLayerState(documentRef.layers[i], propertyName, 0, state);
        }

        return state;
    }

    function collectLayerState(layer, propertyName, depth, store) {
        var i;

        store.push({
            layer: layer,
            depth: depth,
            value: safeRead(layer, propertyName, propertyName === "visible")
        });

        for (i = 0; i < layer.layers.length; i += 1) {
            collectLayerState(layer.layers[i], propertyName, depth + 1, store);
        }
    }

    function applyVisibilityState(state) {
        var entries = collectExistingEntries(state);
        var i;

        sortByDepthAscending(entries);

        for (i = 0; i < entries.length; i += 1) {
            try {
                entries[i].layer.visible = entries[i].value;
            } catch (ignore) {}
        }
    }

    function applyLockState(state) {
        var entries = collectExistingEntries(state);
        var i;

        sortByDepthAscending(entries);
        for (i = 0; i < entries.length; i += 1) {
            try {
                entries[i].layer.locked = false;
            } catch (ignore1) {}
        }

        sortByDepthDescending(entries);
        for (i = 0; i < entries.length; i += 1) {
            try {
                entries[i].layer.locked = entries[i].value;
            } catch (ignore2) {}
        }
    }

    function collectExistingEntries(state) {
        var result = [];
        var i;

        if (!state || !state.length) {
            return result;
        }

        for (i = 0; i < state.length; i += 1) {
            if (layerExists(state[i].layer)) {
                result.push(state[i]);
            }
        }

        return result;
    }

    function sortByDepthAscending(entries) {
        entries.sort(function (a, b) {
            return a.depth - b.depth;
        });
    }

    function sortByDepthDescending(entries) {
        entries.sort(function (a, b) {
            return b.depth - a.depth;
        });
    }

    function layerExists(layer) {
        try {
            return !!layer && !!layer.parent;
        } catch (ignore) {
            return false;
        }
    }

    function safeRead(obj, propertyName, fallbackValue) {
        try {
            return obj[propertyName];
        } catch (ignore) {
            return fallbackValue;
        }
    }

    function isWindowUsable(windowRef) {
        try {
            return !!windowRef && typeof windowRef.show === "function";
        } catch (ignore) {
            return false;
        }
    }
}());
