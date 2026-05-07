#target illustrator

(function () {
    if (app.documents.length === 0) {
        return;
    }

    var doc = app.activeDocument;
    var payload = {
        documentKey: getDocumentKey(doc),
        entries: captureLayerState(doc, "visible", true)
    };

    writeStateFile("visibility", payload);

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
        file.encoding = "UTF-8";
        file.open("w");
        file.write(payload.toSource());
        file.close();
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
