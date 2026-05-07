#target illustrator

function applyLastBrushesToSelection() {
    var doc = app.activeDocument;
    var selection = doc.selection;

    if (selection.length === 0) {
        alert("No objects found. Please select some objects and try again.");
        return;
    }

    var brushes = getLastBrushes(4);

    if (brushes.length === 0) {
        alert("No brushes found. Please make sure there are at least four brushes in the document.");
        return;
    }

    selection = selection.slice().sort(function (a, b) {
        return a.geometricBounds[0] - b.geometricBounds[0];
    });

    for (var i = 0; i < selection.length; i++) {
        var item = selection[i];
        if (item.typename === "PathItem" || item.typename === "CompoundPathItem") {
            var brushIndex = i % brushes.length;
            item.strokeDashes = []; // Reset dashed strokes if any
            brushes[brushIndex].applyTo(item);
        }
    }
}

function getLastBrushes(count) {
    var doc = app.activeDocument;
    var brushes = doc.brushes;
    var lastBrushes = [];

    for (var i = Math.max(0, brushes.length - count); i < brushes.length; i++) {
        lastBrushes.push(brushes[i]);
    }

    return lastBrushes;
}

applyLastBrushesToSelection();
!4