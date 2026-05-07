// Description: Runs 12 Set Lock.
#target illustrator

(function () {
    if (app.documents.length === 0) {
        return;
    }

    var doc = app.activeDocument;
    var payload = readStateFile("lock", getDocumentKey(doc));
    var entries;
    var i;

    if (!payload || !payload.entries || !payload.entries.length) {
        return;
    }

    entries = resolveExistingEntries(doc, payload.entries);

    entries.sort(function (a, b) {
        return a.depth - b.depth;
    });
    for (i = 0; i < entries.length; i += 1) {
        try {
            entries[i].layer.locked = false;
        } catch (ignore1) {}
    }

    entries.sort(function (a, b) {
        return b.depth - a.depth;
    });
    for (i = 0; i < entries.length; i += 1) {
        try {
            entries[i].layer.locked = entries[i].value;
        } catch (ignore2) {}
    }

    function resolveExistingEntries(documentRef, source) {
        var result = [];
        var i;
        var layer;

        for (i = 0; i < source.length; i += 1) {
            layer = resolveLayerBySegments(documentRef, source[i].segments);
            if (layer) {
                result.push({
                    layer: layer,
                    depth: source[i].depth,
                    value: source[i].value
                });
            }
        }

        return result;
    }

    function resolveLayerBySegments(documentRef, segments) {
        var siblings = documentRef.layers;
        var current = null;
        var segment;
        var i;

        for (i = 0; i < segments.length; i += 1) {
            segment = segments[i];
            current = findSiblingByOccurrence(siblings, segment.name, segment.occurrence);
            if (!current) {
                return null;
            }
            siblings = current.layers;
        }

        return current;
    }

    function findSiblingByOccurrence(layers, name, occurrence) {
        var count = 0;
        var i;

        for (i = 0; i < layers.length; i += 1) {
            if (layers[i].name !== name) {
                continue;
            }
            if (count === occurrence) {
                return layers[i];
            }
            count += 1;
        }

        return null;
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

    function readStateFile(kind, documentKey) {
        var file = new File(Folder.temp.fsName + "/Illustrator_LayerState_" + kind + "_" + documentKey + ".txt");
        var text;

        if (!file.exists) {
            return null;
        }

        file.encoding = "UTF-8";
        file.open("r");
        text = file.read();
        file.close();

        return eval(text);
    }

    function sanitizeToken(value) {
        return String(value || "untitled").replace(/[^A-Za-z0-9._-]+/g, "_").substr(0, 120);
    }
}());
