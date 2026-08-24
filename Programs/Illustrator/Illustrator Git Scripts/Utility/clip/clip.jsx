/*
===============================================================================
CLIP STROKES TO CLOSED CUTTER
Adobe Illustrator ExtendScript (.jsx)

PURPOSE
-------
Destructively trims selected stroked paths so that only the portions located
inside one selected closed cutter remain.

The surviving artwork remains REAL EDITABLE STROKES. This script does NOT
Outline Stroke, Expand the artwork, convert strokes into filled shapes, or use
a clipping mask.

SELECTION / SETUP
-----------------
Select one closed cutter as the topmost selected object, with the stroked paths
to trim beneath it. If the cutter has no fill, the script applies the document's
current default fill temporarily and removes it when trimming finishes.

BEHAVIOR
--------
- Uses the topmost selected object as the closed cutter and temporarily fills it when needed.
- Finds where each selected stroke crosses the cutter boundary.
- Splits the underlying Bézier path at those intersections.
- Keeps only Bézier segments whose center lies inside the cutter.
- Deletes the original affected stroke after its surviving pieces are created.
- Preserves stroke width, color, cap, join, dash settings, opacity and other
  basic stroke appearance properties.
- Keeps each result in its source stroke's existing group or sublayer.
- Leaves the cutter object intact and restores its original fill state.
- Does NOT create outlined strokes.
- Does NOT leave hidden outside artwork behind.

IMPORTANT
---------
This operation is DESTRUCTIVE for the selected strokes. Undo immediately with
Ctrl+Z if the result is not what you want.

Illustrator does not provide a native scripting command that destructively
crops centerline strokes while preserving them as strokes, so this script
calculates intersections geometrically. The actual surviving Bézier geometry
is retained as Bézier geometry; only the exact boundary-intersection position
is numerically approximated.

The INTERSECTION_TOLERANCE setting below controls calculation precision.
Smaller values increase precision but require more processing.

===============================================================================
*/

#target illustrator

(function () {

    // ------------------------------------------------------------------------
    // USER-EDITABLE SETTINGS
    // ------------------------------------------------------------------------

    // Precision in Illustrator points.
    // 0.25 pt is a good balance between accuracy and speed.
    var INTERSECTION_TOLERANCE = 0.25;

    // Maximum Bézier subdivision depth used while locating intersections.
    var MAX_SUBDIVISION_DEPTH = 12;

    // Leave the cutter in the document after trimming.
    var KEEP_CUTTER = true;

    // ------------------------------------------------------------------------
    // START
    // ------------------------------------------------------------------------

    if (app.documents.length === 0) {
        alert("Open an Illustrator document first.");
        return;
    }

    var doc = app.activeDocument;
    var originalSelection = doc.selection;

    if (!originalSelection || originalSelection.length < 2) {
        alert("Select one closed cutter and at least one stroked path.");
        return;
    }

    // Copy selection because Illustrator's live selection collection can change.
    var selected = [];
    var i;

    for (i = 0; i < originalSelection.length; i++) {
        selected.push(originalSelection[i]);
    }

    // ------------------------------------------------------------------------
    // FIND TOPMOST CUTTER
    // ------------------------------------------------------------------------

    var cutter = topSelectedCutter(selected);

    if (!cutter) {
        alert("The top selected object must be a closed cutter.");
        return;
    }

    // ------------------------------------------------------------------------
    // BUILD CUTTER GEOMETRY
    // ------------------------------------------------------------------------

    var cutterPaths = getCutterPaths(cutter);

    if (cutterPaths.length === 0) {
        alert("The cutter does not contain a usable closed path.");
        return;
    }

    var flattenedBoundary = [];

    for (i = 0; i < cutterPaths.length; i++) {
        var flattened = flattenClosedPath(
            cutterPaths[i],
            INTERSECTION_TOLERANCE,
            MAX_SUBDIVISION_DEPTH
        );

        if (flattened.length >= 3) {
            flattenedBoundary.push(flattened);
        }
    }

    if (flattenedBoundary.length === 0) {
        alert("Could not calculate the cutter boundary.");
        return;
    }

    // ------------------------------------------------------------------------
    // COLLECT TARGET STROKES
    // ------------------------------------------------------------------------

    var targetPaths = [];

    for (i = 1; i < selected.length; i++) {
        collectStrokedPaths(selected[i], targetPaths);
    }

    if (targetPaths.length === 0) {
        alert("No stroked paths were found in the selection.");
        return;
    }

    var cutterFillState = beginTemporaryCutterFill(cutter, doc);

    if (!cutterFillState.success) {
        alert("Could not add a fill to the cutter.");
        return;
    }

    // ------------------------------------------------------------------------
    // PROCESS STROKES
    // ------------------------------------------------------------------------

    var createdPaths = [];
    var processedCount = 0;
    var removedCount = 0;
    var cutterFillRestored = true;

    try {
        for (i = 0; i < targetPaths.length; i++) {

            var source = targetPaths[i];

            if (!isUsableStroke(source)) {
                continue;
            }

            var result = trimStrokeToBoundary(
                source,
                flattenedBoundary,
                INTERSECTION_TOLERANCE,
                MAX_SUBDIVISION_DEPTH
            );

            if (!result.success) {
                continue;
            }

            processedCount++;

            for (var r = 0; r < result.items.length; r++) {
                createdPaths.push(result.items[r]);
            }

            try {
                source.remove();
                removedCount++;
            } catch (removeError) {
            }
        }
    } finally {
        cutterFillRestored = restoreTemporaryCutterFill(
            cutterFillState
        );
    }

    if (!cutterFillRestored) {
        alert("Could not restore the cutter's original fill state.");
    }

    // ------------------------------------------------------------------------
    // OPTIONAL CUTTER REMOVAL
    // ------------------------------------------------------------------------

    if (!KEEP_CUTTER) {
        try {
            cutter.remove();
        } catch (cutterRemoveError) {
        }
    }

    // ------------------------------------------------------------------------
    // SELECT RESULTS
    // ------------------------------------------------------------------------

    doc.selection = null;

    for (i = 0; i < createdPaths.length; i++) {
        try {
            createdPaths[i].selected = true;
        } catch (selectionError) {
        }
    }

    app.redraw();

    if (processedCount === 0) {
        alert(
            "No strokes were trimmed.\n\n" +
            "Make sure the selected artwork contains normal stroked PathItems."
        );
    }

    // =========================================================================
    // CUTTER DETECTION
    // =========================================================================

    function topSelectedCutter(selection) {

        if (!selection || selection.length === 0) {
            return null;
        }

        return isClosedCutter(selection[0]) ? selection[0] : null;
    }


    function isClosedCutter(item) {

        if (!item) {
            return false;
        }

        if (item.typename === "PathItem") {
            return item.closed && !item.clipping;
        }

        if (item.typename === "CompoundPathItem") {

            if (item.pathItems.length === 0) {
                return false;
            }

            var hasPath = false;

            for (var j = 0; j < item.pathItems.length; j++) {

                var p = item.pathItems[j];

                if (!p.closed || p.clipping) {
                    return false;
                }

                hasPath = true;
            }

            return hasPath;
        }

        return false;
    }


    function getCutterPaths(item) {

        var paths = [];

        if (item.typename === "PathItem") {

            if (item.closed && !item.clipping) {
                paths.push(item);
            }

            return paths;
        }

        if (item.typename === "CompoundPathItem") {

            for (var j = 0; j < item.pathItems.length; j++) {

                if (
                    item.pathItems[j].closed &&
                    !item.pathItems[j].clipping
                ) {
                    paths.push(item.pathItems[j]);
                }
            }
        }

        return paths;
    }


    function beginTemporaryCutterFill(item, document) {

        var paths = getCutterPaths(item);
        var state = {
            success: true,
            changes: []
        };
        var needsFill = false;
        var i;

        for (i = 0; i < paths.length; i++) {
            if (!hasUsableFill(paths[i])) {
                needsFill = true;
                break;
            }
        }

        if (!needsFill) {
            return state;
        }

        var fillColor = resolveAutomaticFillColor(document);

        if (!fillColor) {
            state.success = false;
            return state;
        }

        for (i = 0; i < paths.length; i++) {

            if (hasUsableFill(paths[i])) {
                continue;
            }

            var change = {
                path: paths[i],
                filled: false,
                hasFillColor: false,
                fillColor: null
            };

            try {
                change.filled = !!paths[i].filled;
            } catch (filledReadError) {
            }

            try {
                change.fillColor = paths[i].fillColor;
                change.hasFillColor = true;
            } catch (fillColorReadError) {
            }

            state.changes.push(change);

            try {
                paths[i].fillColor = fillColor;
                paths[i].filled = true;
            } catch (fillError) {
                state.success = false;
                restoreTemporaryCutterFill(state);
                return state;
            }
        }

        return state;
    }


    function restoreTemporaryCutterFill(state) {

        if (!state || !state.changes) {
            return false;
        }

        var restored = true;

        for (var i = state.changes.length - 1; i >= 0; i--) {

            var change = state.changes[i];

            try {
                if (change.hasFillColor) {
                    change.path.fillColor = change.fillColor;
                }

                change.path.filled = change.filled;
            } catch (restoreError) {
                restored = false;

                try {
                    change.path.filled = change.filled;
                } catch (filledRestoreError) {
                }
            }
        }

        return restored;
    }


    function hasUsableFill(path) {

        if (!path || !path.filled) {
            return false;
        }

        try {
            return (
                path.fillColor &&
                path.fillColor.typename !== "NoColor"
            );
        } catch (fillReadError) {
            return false;
        }
    }


    function resolveAutomaticFillColor(document) {

        try {
            var defaultFill = document.defaultFillColor;

            if (
                defaultFill &&
                defaultFill.typename !== "NoColor"
            ) {
                return defaultFill;
            }
        } catch (defaultFillError) {
        }

        try {
            var fallbackFill = new GrayColor();
            fallbackFill.gray = 0;
            return fallbackFill;
        } catch (fallbackFillError) {
            return null;
        }
    }


    // =========================================================================
    // TARGET COLLECTION
    // =========================================================================

    function collectStrokedPaths(item, output) {

        if (!item) {
            return;
        }

        if (item.typename === "PathItem") {

            if (isUsableStroke(item)) {
                output.push(item);
            }

            return;
        }

        if (item.typename === "GroupItem") {

            for (var j = 0; j < item.pageItems.length; j++) {
                collectStrokedPaths(item.pageItems[j], output);
            }

            return;
        }

        if (item.typename === "CompoundPathItem") {

            for (var k = 0; k < item.pathItems.length; k++) {

                if (isUsableStroke(item.pathItems[k])) {
                    output.push(item.pathItems[k]);
                }
            }
        }
    }


    function isUsableStroke(path) {

        if (!path || path.typename !== "PathItem") {
            return false;
        }

        if (path.clipping) {
            return false;
        }

        if (!path.stroked) {
            return false;
        }

        if (path.pathPoints.length < 2) {
            return false;
        }

        return true;
    }


    // =========================================================================
    // MAIN STROKE TRIMMING
    // =========================================================================

    function trimStrokeToBoundary(
        source,
        boundary,
        tolerance,
        maxDepth
    ) {

        var sourceSegments = pathToCubics(source);

        if (sourceSegments.length === 0) {
            return {
                success: false,
                items: []
            };
        }

        var keptCubics = [];
        var currentChain = [];

        for (var s = 0; s < sourceSegments.length; s++) {

            var cubic = sourceSegments[s];

            var intersections = findCubicBoundaryIntersections(
                cubic,
                boundary,
                tolerance,
                maxDepth
            );

            var cuts = [0];

            for (var c = 0; c < intersections.length; c++) {

                var intersectionT = intersections[c];

                if (
                    intersectionT > 0.000001 &&
                    intersectionT < 0.999999
                ) {
                    cuts.push(intersectionT);
                }
            }

            cuts.push(1);

            cuts.sort(numberSort);
            cuts = uniqueNumbers(cuts, 0.00001);

            for (var q = 0; q < cuts.length - 1; q++) {

                var t0 = cuts[q];
                var t1 = cuts[q + 1];

                if (t1 - t0 < 0.000001) {
                    continue;
                }

                var middleT = (t0 + t1) / 2;
                var middlePoint = cubicPoint(cubic, middleT);

                var inside = pointInsideBoundary(
                    middlePoint,
                    boundary
                );

                if (inside) {

                    var section = cubicSubsegment(
                        cubic,
                        t0,
                        t1
                    );

                    if (currentChain.length === 0) {

                        currentChain.push(section);

                    } else {

                        var previous =
                            currentChain[currentChain.length - 1];

                        if (
                            pointsNear(
                                previous.p3,
                                section.p0,
                                tolerance * 2
                            )
                        ) {

                            currentChain.push(section);

                        } else {

                            keptCubics.push(currentChain);
                            currentChain = [section];
                        }
                    }

                } else {

                    if (currentChain.length > 0) {
                        keptCubics.push(currentChain);
                        currentChain = [];
                    }
                }
            }
        }

        if (currentChain.length > 0) {
            keptCubics.push(currentChain);
        }

        var created = [];

        for (var chainIndex = 0;
             chainIndex < keptCubics.length;
             chainIndex++) {

            var newPath = createPathFromCubics(
                source,
                keptCubics[chainIndex]
            );

            if (newPath) {
                created.push(newPath);
            }
        }

        return {
            success: true,
            items: created
        };
    }


    // =========================================================================
    // PATH -> CUBIC SEGMENTS
    // =========================================================================

    function pathToCubics(path) {

        var cubics = [];
        var points = path.pathPoints;
        var count = points.length;

        if (count < 2) {
            return cubics;
        }

        var segmentCount = path.closed ? count : count - 1;

        for (var i = 0; i < segmentCount; i++) {

            var current = points[i];
            var next = points[(i + 1) % count];

            cubics.push({
                p0: copyPoint(current.anchor),
                p1: copyPoint(current.rightDirection),
                p2: copyPoint(next.leftDirection),
                p3: copyPoint(next.anchor)
            });
        }

        return cubics;
    }


    // =========================================================================
    // CREATE REAL ILLUSTRATOR STROKE FROM CUBIC CHAIN
    // =========================================================================

    function createPathFromCubics(source, cubics) {

        if (!cubics || cubics.length === 0) {
            return null;
        }

        // Create beside this specific source so selections spanning sublayers
        // retain each stroke's existing container instead of using activeLayer.
        var sourceParent = source.parent;
        var newPath;

        try {
            newPath = sourceParent.pathItems.add();
        } catch (e) {
            // source.layer is the source stroke's own containing sublayer.
            newPath = source.layer.pathItems.add();
        }

        newPath.closed = false;
        newPath.filled = false;

        var pointCount = cubics.length + 1;

        for (var i = 0; i < pointCount; i++) {

            var pp = newPath.pathPoints.add();

            if (i === 0) {

                pp.anchor = copyPoint(cubics[0].p0);
                pp.leftDirection = copyPoint(cubics[0].p0);
                pp.rightDirection = copyPoint(cubics[0].p1);

            } else if (i === pointCount - 1) {

                var last = cubics[cubics.length - 1];

                pp.anchor = copyPoint(last.p3);
                pp.leftDirection = copyPoint(last.p2);
                pp.rightDirection = copyPoint(last.p3);

            } else {

                var previous = cubics[i - 1];
                var next = cubics[i];

                pp.anchor = copyPoint(previous.p3);
                pp.leftDirection = copyPoint(previous.p2);
                pp.rightDirection = copyPoint(next.p1);
            }

            try {
                pp.pointType = PointType.SMOOTH;
            } catch (pointTypeError) {
            }
        }

        copyStrokeAppearance(source, newPath);

        try {
            newPath.move(
                source,
                ElementPlacement.PLACEBEFORE
            );
        } catch (moveError) {
        }

        return newPath;
    }


    // =========================================================================
    // COPY STROKE APPEARANCE
    // =========================================================================

    function copyStrokeAppearance(source, destination) {

        destination.filled = false;
        destination.stroked = true;

        try {
            destination.strokeColor = source.strokeColor;
        } catch (e1) {
        }

        try {
            destination.strokeWidth = source.strokeWidth;
        } catch (e2) {
        }

        try {
            destination.strokeCap = source.strokeCap;
        } catch (e3) {
        }

        try {
            destination.strokeJoin = source.strokeJoin;
        } catch (e4) {
        }

        try {
            destination.strokeMiterLimit =
                source.strokeMiterLimit;
        } catch (e5) {
        }

        try {
            destination.strokeDashes =
                source.strokeDashes;
        } catch (e6) {
        }

        try {
            destination.strokeDashOffset =
                source.strokeDashOffset;
        } catch (e7) {
        }

        try {
            destination.strokeOverprint =
                source.strokeOverprint;
        } catch (e8) {
        }

        try {
            destination.opacity = source.opacity;
        } catch (e9) {
        }

        try {
            destination.blendingMode =
                source.blendingMode;
        } catch (e10) {
        }

        try {
            destination.hidden = source.hidden;
        } catch (e11) {
        }

        try {
            destination.locked = false;
        } catch (e12) {
        }

        try {
            destination.name = source.name;
        } catch (e13) {
        }

        try {
            destination.note = source.note;
        } catch (e14) {
        }
    }


    // =========================================================================
    // FIND CUBIC / CUTTER INTERSECTIONS
    // =========================================================================

    function findCubicBoundaryIntersections(
        cubic,
        boundary,
        tolerance,
        maxDepth
    ) {

        var samples = flattenCubicWithT(
            cubic,
            tolerance,
            maxDepth
        );

        var intersections = [];

        for (var s = 0; s < samples.length - 1; s++) {

            var a = samples[s];
            var b = samples[s + 1];

            for (var p = 0; p < boundary.length; p++) {

                var polygon = boundary[p];

                for (var j = 0;
                     j < polygon.length - 1;
                     j++) {

                    var hit = lineIntersection(
                        a.point,
                        b.point,
                        polygon[j],
                        polygon[j + 1]
                    );

                    if (hit) {

                        var approximateT =
                            a.t +
                            ((b.t - a.t) * hit.ua);

                        intersections.push(
                            approximateT
                        );
                    }
                }
            }
        }

        intersections.sort(numberSort);

        return uniqueNumbers(
            intersections,
            0.00005
        );
    }


    // =========================================================================
    // FLATTEN CUTTER PATHS
    // =========================================================================

    function flattenClosedPath(
        path,
        tolerance,
        maxDepth
    ) {

        var cubics = pathToCubics(path);
        var output = [];

        if (cubics.length === 0) {
            return output;
        }

        output.push(copyPoint(cubics[0].p0));

        for (var i = 0; i < cubics.length; i++) {

            flattenCubicPointsRecursive(
                cubics[i].p0,
                cubics[i].p1,
                cubics[i].p2,
                cubics[i].p3,
                tolerance,
                maxDepth,
                0,
                output
            );
        }

        if (
            output.length > 0 &&
            !pointsNear(
                output[0],
                output[output.length - 1],
                0.0001
            )
        ) {
            output.push(copyPoint(output[0]));
        }

        return output;
    }


    function flattenCubicWithT(
        cubic,
        tolerance,
        maxDepth
    ) {

        var output = [{
            point: copyPoint(cubic.p0),
            t: 0
        }];

        flattenCubicTRecursive(
            cubic.p0,
            cubic.p1,
            cubic.p2,
            cubic.p3,
            0,
            1,
            tolerance,
            maxDepth,
            0,
            output
        );

        return output;
    }


    function flattenCubicPointsRecursive(
        p0,
        p1,
        p2,
        p3,
        tolerance,
        maxDepth,
        depth,
        output
    ) {

        if (
            depth >= maxDepth ||
            cubicFlatEnough(
                p0,
                p1,
                p2,
                p3,
                tolerance
            )
        ) {

            output.push(copyPoint(p3));
            return;
        }

        var split = splitCubicPoints(
            p0,
            p1,
            p2,
            p3,
            0.5
        );

        flattenCubicPointsRecursive(
            split.left.p0,
            split.left.p1,
            split.left.p2,
            split.left.p3,
            tolerance,
            maxDepth,
            depth + 1,
            output
        );

        flattenCubicPointsRecursive(
            split.right.p0,
            split.right.p1,
            split.right.p2,
            split.right.p3,
            tolerance,
            maxDepth,
            depth + 1,
            output
        );
    }


    function flattenCubicTRecursive(
        p0,
        p1,
        p2,
        p3,
        t0,
        t1,
        tolerance,
        maxDepth,
        depth,
        output
    ) {

        if (
            depth >= maxDepth ||
            cubicFlatEnough(
                p0,
                p1,
                p2,
                p3,
                tolerance
            )
        ) {

            output.push({
                point: copyPoint(p3),
                t: t1
            });

            return;
        }

        var split = splitCubicPoints(
            p0,
            p1,
            p2,
            p3,
            0.5
        );

        var tm = (t0 + t1) / 2;

        flattenCubicTRecursive(
            split.left.p0,
            split.left.p1,
            split.left.p2,
            split.left.p3,
            t0,
            tm,
            tolerance,
            maxDepth,
            depth + 1,
            output
        );

        flattenCubicTRecursive(
            split.right.p0,
            split.right.p1,
            split.right.p2,
            split.right.p3,
            tm,
            t1,
            tolerance,
            maxDepth,
            depth + 1,
            output
        );
    }


    // =========================================================================
    // POINT-IN-FILLED-BOUNDARY TEST
    // =========================================================================

    function pointInsideBoundary(point, boundary) {

        var inside = false;

        for (var p = 0; p < boundary.length; p++) {

            if (
                pointInsidePolygon(
                    point,
                    boundary[p]
                )
            ) {
                inside = !inside;
            }
        }

        return inside;
    }


    function pointInsidePolygon(point, polygon) {

        var x = point[0];
        var y = point[1];
        var inside = false;

        var j = polygon.length - 1;

        for (var i = 0;
             i < polygon.length;
             i++) {

            var xi = polygon[i][0];
            var yi = polygon[i][1];

            var xj = polygon[j][0];
            var yj = polygon[j][1];

            var intersects =
                ((yi > y) !== (yj > y)) &&
                (
                    x <
                    ((xj - xi) *
                    (y - yi) /
                    (yj - yi)) +
                    xi
                );

            if (intersects) {
                inside = !inside;
            }

            j = i;
        }

        return inside;
    }


    // =========================================================================
    // LINE INTERSECTION
    // =========================================================================

    function lineIntersection(
        p1,
        p2,
        p3,
        p4
    ) {

        var x1 = p1[0];
        var y1 = p1[1];

        var x2 = p2[0];
        var y2 = p2[1];

        var x3 = p3[0];
        var y3 = p3[1];

        var x4 = p4[0];
        var y4 = p4[1];

        var denominator =
            ((y4 - y3) * (x2 - x1)) -
            ((x4 - x3) * (y2 - y1));

        if (Math.abs(denominator) < 0.0000001) {
            return null;
        }

        var ua =
            (
                ((x4 - x3) * (y1 - y3)) -
                ((y4 - y3) * (x1 - x3))
            ) /
            denominator;

        var ub =
            (
                ((x2 - x1) * (y1 - y3)) -
                ((y2 - y1) * (x1 - x3))
            ) /
            denominator;

        var epsilon = 0.000001;

        if (
            ua < -epsilon ||
            ua > 1 + epsilon ||
            ub < -epsilon ||
            ub > 1 + epsilon
        ) {
            return null;
        }

        return {
            ua: ua,
            ub: ub
        };
    }


    // =========================================================================
    // CUBIC BÉZIER MATH
    // =========================================================================

    function cubicPoint(cubic, t) {

        var mt = 1 - t;

        var a = mt * mt * mt;
        var b = 3 * mt * mt * t;
        var c = 3 * mt * t * t;
        var d = t * t * t;

        return [
            (a * cubic.p0[0]) +
            (b * cubic.p1[0]) +
            (c * cubic.p2[0]) +
            (d * cubic.p3[0]),

            (a * cubic.p0[1]) +
            (b * cubic.p1[1]) +
            (c * cubic.p2[1]) +
            (d * cubic.p3[1])
        ];
    }


    function cubicSubsegment(
        cubic,
        t0,
        t1
    ) {

        if (
            t0 <= 0.0000001 &&
            t1 >= 0.9999999
        ) {
            return copyCubic(cubic);
        }

        var firstSplit =
            splitCubic(
                cubic,
                t1
            );

        if (t0 <= 0.0000001) {
            return firstSplit.left;
        }

        var relativeT = t0 / t1;

        var secondSplit =
            splitCubic(
                firstSplit.left,
                relativeT
            );

        return secondSplit.right;
    }


    function splitCubic(cubic, t) {

        return splitCubicPoints(
            cubic.p0,
            cubic.p1,
            cubic.p2,
            cubic.p3,
            t
        );
    }


    function splitCubicPoints(
        p0,
        p1,
        p2,
        p3,
        t
    ) {

        var p01 = lerpPoint(p0, p1, t);
        var p12 = lerpPoint(p1, p2, t);
        var p23 = lerpPoint(p2, p3, t);

        var p012 = lerpPoint(
            p01,
            p12,
            t
        );

        var p123 = lerpPoint(
            p12,
            p23,
            t
        );

        var p0123 = lerpPoint(
            p012,
            p123,
            t
        );

        return {
            left: {
                p0: copyPoint(p0),
                p1: p01,
                p2: p012,
                p3: p0123
            },

            right: {
                p0: p0123,
                p1: p123,
                p2: p23,
                p3: copyPoint(p3)
            }
        };
    }


    // =========================================================================
    // FLATNESS TEST
    // =========================================================================

    function cubicFlatEnough(
        p0,
        p1,
        p2,
        p3,
        tolerance
    ) {

        var d1 =
            distancePointToLine(
                p1,
                p0,
                p3
            );

        var d2 =
            distancePointToLine(
                p2,
                p0,
                p3
            );

        return (
            d1 <= tolerance &&
            d2 <= tolerance
        );
    }


    function distancePointToLine(
        point,
        lineStart,
        lineEnd
    ) {

        var dx =
            lineEnd[0] -
            lineStart[0];

        var dy =
            lineEnd[1] -
            lineStart[1];

        var lengthSquared =
            (dx * dx) +
            (dy * dy);

        if (lengthSquared === 0) {

            return distanceBetween(
                point,
                lineStart
            );
        }

        var t =
            (
                ((point[0] - lineStart[0]) * dx) +
                ((point[1] - lineStart[1]) * dy)
            ) /
            lengthSquared;

        var projection = [
            lineStart[0] + (t * dx),
            lineStart[1] + (t * dy)
        ];

        return distanceBetween(
            point,
            projection
        );
    }


    // =========================================================================
    // GENERAL HELPERS
    // =========================================================================

    function lerpPoint(a, b, t) {

        return [
            a[0] + ((b[0] - a[0]) * t),
            a[1] + ((b[1] - a[1]) * t)
        ];
    }


    function copyPoint(point) {

        return [
            point[0],
            point[1]
        ];
    }


    function copyCubic(cubic) {

        return {
            p0: copyPoint(cubic.p0),
            p1: copyPoint(cubic.p1),
            p2: copyPoint(cubic.p2),
            p3: copyPoint(cubic.p3)
        };
    }


    function distanceBetween(a, b) {

        var dx = a[0] - b[0];
        var dy = a[1] - b[1];

        return Math.sqrt(
            (dx * dx) +
            (dy * dy)
        );
    }


    function pointsNear(
        a,
        b,
        tolerance
    ) {

        return (
            distanceBetween(a, b) <=
            tolerance
        );
    }


    function numberSort(a, b) {
        return a - b;
    }


    function uniqueNumbers(
        values,
        tolerance
    ) {

        if (values.length === 0) {
            return [];
        }

        var result = [
            values[0]
        ];

        for (var i = 1;
             i < values.length;
             i++) {

            if (
                Math.abs(
                    values[i] -
                    result[result.length - 1]
                ) > tolerance
            ) {
                result.push(values[i]);
            }
        }

        return result;
    }

})();
