// Description: Record the current layer lock states as the baseline.

#target illustrator

(function () {
    var SCRIPT_VERSION = "2026-06-15 11:20";
    var LOG_PATH = Folder.temp.fsName + "/Illustrator_LayerState_lock_Debug.log";

    if (app.documents.length === 0) {
        resetLog(null);
        logLine("No open document; lock baseline not saved.");
        return;
    }

    var doc = app.activeDocument;
    resetLog(doc);

    var payload = {
        documentKey: getDocumentKey(doc),
        entries: captureLayerState(doc, "locked", false)
    };

    if (writeStateFile("lock", payload)) {
        logLine("Saved lock baseline entries: " + payload.entries.length);
    }

    function captureLayerState(documentRef, propertyName, fallbackValue) {
        var state = [];
        var i;

        for (i = 0; i < documentRef.layers.length; i += 1) {
            collectLayerState(documentRef.layers[i], propertyName, fallbackValue, state);
        }

        return state;
    }

    function collectLayerState(layer, propertyName, fallbackValue, store) {
        var i;
        var segment = {
            name: layer.name,
            occurrence: getSiblingOccurrence(layer)
        };
        var segments = getSegments(layer, segment);

        store.push({
            segments: segments,
            depth: segments.length - 1,
            value: safeRead(layer, propertyName, fallbackValue)
        });

        for (i = 0; i < layer.layers.length; i += 1) {
            collectLayerState(layer.layers[i], propertyName, fallbackValue, store);
        }
    }

    function getSegments(layer, lastSegment) {
        var segments = [lastSegment];
        var current = layer.parent;

        while (current && current.typename === "Layer") {
            segments.unshift({
                name: current.name,
                occurrence: getSiblingOccurrence(current)
            });
            current = current.parent;
        }

        return segments;
    }

    function getSiblingOccurrence(layer) {
        var parent = layer.parent;
        var siblings = parent.layers;
        var occurrence = 0;
        var i;

        for (i = 0; i < siblings.length; i += 1) {
            if (siblings[i] === layer) {
                return occurrence;
            }

            if (siblings[i].name === layer.name) {
                occurrence += 1;
            }
        }

        return occurrence;
    }

    function getDocumentKey(documentRef) {
        var source;

        try {
            source = documentRef.fullName.fsName;
        } catch (ignore) {
            source = documentRef.name;
        }

        return sanitizeToken(source);
    }

    function writeStateFile(kind, payload) {
        var file = new File(Folder.temp.fsName + "/Illustrator_LayerState_" + kind + "_" + payload.documentKey + ".txt");
        try {
            file.encoding = "UTF-8";
            file.open("w");
            file.write(payload.toSource());
            file.close();
            logLine("Wrote baseline file: " + file.fsName);
            return true;
        } catch (err) {
            logLine("Failed to write baseline file: " + err);
            return false;
        }
    }

    function resetLog(documentRef) {
        var file = new File(LOG_PATH);

        if (file.exists) {
            try {
                file.remove();
            } catch (ignore) {}
        }

        logLine("Baseline Lock version: " + SCRIPT_VERSION);
        if (documentRef) {
            logLine("Document: " + safeDocName(documentRef));
            logLine("Document key: " + getDocumentKey(documentRef));
        }
    }

    function logLine(message) {
        var file = new File(LOG_PATH);

        try {
            file.encoding = "UTF-8";
            file.open("a");
            file.writeln(message);
            file.close();
        } catch (ignore) {}
    }

    function safeDocName(documentRef) {
        try {
            return documentRef.name;
        } catch (ignore) {
            return "[unknown document]";
        }
    }

    function sanitizeToken(value) {
        return String(value || "untitled").replace(/[^A-Za-z0-9._-]+/g, "_").substr(0, 120);
    }

    function safeRead(obj, propertyName, fallbackValue) {
        try {
            return obj[propertyName];
        } catch (ignore) {
            return fallbackValue;
        }
    }
}());
