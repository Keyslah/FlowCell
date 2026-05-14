/**
 * Evenly Distribute Copies Around Active Artboard Center (True Pivot)
 * - Prompts for number of copies (NOT including the original)
 * - Orbits around active artboard center (not object center)
 * - Handles single or multiple selections (multi grouped temporarily)
 */

(function () {
    if (app.documents.length === 0) {
        alert("Open a document first.");
        return;
    }
    var doc = app.activeDocument;

    if (!doc.selection || doc.selection.length === 0) {
        alert("Select at least one object.");
        return;
    }

    // Ask for number of copies (not including original)
    var input = prompt("How many copies? (evenly spaced with the original around 360°)", "11");
    if (input === null) { return; }
    var copies = Math.floor(Number(input));
    if (!isFinite(copies) || copies < 1) {
        alert("Enter a whole number ≥ 1.");
        return;
    }

    // Step angle so original + copies fill the circle
    var stepAngleDeg = 360 / (copies + 1);
    var stepAngleRad = stepAngleDeg * Math.PI / 180;

    // Get active artboard center
    var abIndex = doc.artboards.getActiveArtboardIndex();
    var abRect = doc.artboards[abIndex].artboardRect; // [left, top, right, bottom]
    var abLeft = abRect[0], abTop = abRect[1], abRight = abRect[2], abBottom = abRect[3];
    var cx = (abLeft + abRight) / 2;
    var cy = (abTop + abBottom) / 2;

    // Work in artboard coordinate system for predictable math
    var prevCS = app.coordinateSystem;
    app.coordinateSystem = CoordinateSystem.ARTBOARDCOORDINATESYSTEM;

    // Snapshot selection
    var sel = [];
    for (var s = 0; s < doc.selection.length; s++) sel.push(doc.selection[s]);

    // If multiple selected, group so we treat them as one unit
    var source;
    if (sel.length === 1) {
        source = sel[0];
    } else {
        var g = doc.groupItems.add();
        for (var i = 0; i < sel.length; i++) {
            try {
                sel[i].move(g, ElementPlacement.PLACEATEND);
            } catch (e) {
                var d = sel[i].duplicate(g, ElementPlacement.PLACEATEND);
                try { sel[i].remove(); } catch (_) {}
            }
        }
        source = g;
        doc.selection = [g];
    }

    // Helper: center of a pageItem from geometricBounds
    function itemCenter(item) {
        var b = item.geometricBounds; // [L, T, R, B]
        return { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 };
    }

    // Helper: set an item's center to (nx, ny)
    function setItemCenter(item, nx, ny) {
        var b = item.geometricBounds; // [L, T, R, B]
        var w = b[2] - b[0];
        var h = b[1] - b[3]; // top - bottom
        // Illustrator's position is [left, top]
        item.position = [nx - w / 2, ny + h / 2];
    }

    // Original center and vector from artboard center → original center
    var c0 = itemCenter(source);
    var dx = c0.x - cx;
    var dy = c0.y - cy;

    // Create evenly spaced orbiting copies
    for (var k = 1; k <= copies; k++) {
        var ang = stepAngleRad * k;

        // Rotate vector (dx, dy) by ang
        var cosA = Math.cos(ang), sinA = Math.sin(ang);
        var rdx = dx * cosA - dy * sinA;
        var rdy = dx * sinA + dy * cosA;

        // Target center for this copy
        var nx = cx + rdx;
        var ny = cy + rdy;

        // Duplicate, place its center on the orbit point, then rotate for visual alignment
        var dup = source.duplicate();
        setItemCenter(dup, nx, ny);

        // Spin the duplicate by the same step so it "faces" around the circle.
        // Rotate around its own center (this does NOT change orbit pivot).
        dup.rotate(stepAngleDeg * k, true, true, true, true, Transformation.CENTER);
    }

    // Restore coord system
    app.coordinateSystem = prevCS;

    alert("Done! Created " + copies + " copies around the active artboard center.");
})();
