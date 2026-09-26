/* Ill SVG: read-only Illustrator selection to physical-point SVG layer batches.
 * Setup: called by run.ps1 through an already-running Illustrator COM object.
 * Side effects: none in Illustrator; returns strings only. No selection, ruler,
 * layer, document, application coordinate system, file or preference is changed.
 * Limits: PathItem, CompoundPathItem and unclipped GroupItem geometry only.
 * Appearance, raster, text and clipping are not approximated. Nonstandard large
 * canvas scaleFactor is rejected until its physical-unit conversion is verified.
 * ES3-compatible core also exported for Node mocked-DOM regression tests.
 */
var IllSvgExporter = (function () {
    function fail(message) { throw new Error("Ill SVG: " + message); }
    function indexOf(items, value) {
        for (var i = 0; i < items.length; i++) if (items[i] === value) return i;
        return -1;
    }
    function number(value) {
        if (typeof value !== "number" || !isFinite(value) || Math.abs(value) > 100000000) {
            fail("A path contains an invalid or out-of-range point.");
        }
        return value;
    }
    function point(value) {
        if (!value || value.length !== 2) fail("A path point is incomplete.");
        return [number(value[0]), number(value[1])];
    }
    function same(a, b) { return a[0] === b[0] && a[1] === b[1]; }
    function xml(value) {
        return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
    }
    function quote(value) {
        return '"' + String(value).replace(/["\\\x00-\x1f]/g, function (c) {
            if (c === '"') return '\\"';
            if (c === '\\') return '\\\\';
            var code = c.charCodeAt(0).toString(16);
            return "\\u" + ("0000" + code).slice(-4);
        }) + '"';
    }
    function stringify(value) {
        if (value === null) return "null";
        if (typeof value === "string") return quote(value);
        if (typeof value === "boolean") return value ? "true" : "false";
        if (typeof value === "number") {
            if (!isFinite(value)) fail("Cannot serialize a nonfinite value.");
            return String(value);
        }
        var parts = [], key, i;
        if (Object.prototype.toString.call(value) === "[object Array]") {
            for (i = 0; i < value.length; i++) parts.push(stringify(value[i]));
            return "[" + parts.join(",") + "]";
        }
        for (key in value) if (Object.prototype.hasOwnProperty.call(value, key)) {
            parts.push(quote(key) + ":" + stringify(value[key]));
        }
        return "{" + parts.join(",") + "}";
    }
    function grow(bounds, p) {
        bounds[0] = Math.min(bounds[0], p[0]); bounds[1] = Math.min(bounds[1], p[1]);
        bounds[2] = Math.max(bounds[2], p[0]); bounds[3] = Math.max(bounds[3], p[1]);
    }
    function cubicAt(p0, p1, p2, p3, t) {
        var s = 1 - t;
        return s * s * s * p0 + 3 * s * s * t * p1 + 3 * s * t * t * p2 + t * t * t * p3;
    }
    function cubicBounds(bounds, a, b, c, d) {
        grow(bounds, a); grow(bounds, d);
        for (var axis = 0; axis < 2; axis++) {
            var qa = -a[axis] + 3 * b[axis] - 3 * c[axis] + d[axis];
            var qb = 2 * (a[axis] - 2 * b[axis] + c[axis]);
            var qc = b[axis] - a[axis], roots = [], discriminant;
            if (Math.abs(qa) < 1e-12) {
                if (Math.abs(qb) >= 1e-12) roots.push(-qc / qb);
            } else {
                discriminant = qb * qb - 4 * qa * qc;
                if (discriminant >= 0) {
                    roots.push((-qb + Math.sqrt(discriminant)) / (2 * qa));
                    roots.push((-qb - Math.sqrt(discriminant)) / (2 * qa));
                }
            }
            for (var i = 0; i < roots.length; i++) if (roots[i] > 0 && roots[i] < 1) {
                grow(bounds, [cubicAt(a[0], b[0], c[0], d[0], roots[i]),
                              cubicAt(a[1], b[1], c[1], d[1], roots[i])]);
            }
        }
    }
    function buildBatch(document) {
        if (!document || !document.selection || !document.selection.length) fail("Select vector artwork in the open Illustrator document first.");
        var scale = 1;
        try { if (typeof document.scaleFactor !== "undefined") scale = Number(document.scaleFactor); } catch (ignoredScale) {}
        if (!isFinite(scale) || scale !== 1) fail("Illustrator large-canvas scaleFactor " + scale + " is not supported; exact physical scale cannot yet be verified.");
        var artboards = document.artboards;
        if (!artboards || !artboards.length) fail("The document has no artboard coordinate reference.");
        var rect = artboards[artboards.getActiveArtboardIndex()].artboardRect;
        if (!rect || rect.length !== 4 || number(rect[0]) >= number(rect[2]) || number(rect[1]) === number(rect[3])) {
            fail("The artboard coordinate orientation is invalid.");
        }
        var yDown = rect[1] < rect[3];
        var layers = [], buckets = [], selected = [], visited = [], selection = document.selection;
        var bounds = [Infinity, Infinity, -Infinity, -Infinity], pathCount = 0, anchorCount = 0;
        function layerOrder(collection, depth) {
            if (depth > 64) fail("Layer nesting exceeds 64 levels.");
            for (var i = 0; i < collection.length; i++) {
                var layer = collection[i];
                layers.push(layer); buckets.push([]);
                if (layer.layers && layer.layers.length) layerOrder(layer.layers, depth + 1);
            }
        }
        layerOrder(document.layers, 0); // Illustrator Layers collection is top-to-bottom.
        if (!layers.length) fail("The document has no owning layers.");
        for (var si = 0; si < selection.length; si++) selected.push(selection[si]);
        function ownerIndex(item) {
            var parent = item.parent, depth = 0;
            while (parent && parent.typename !== "Layer") {
                if (++depth > 64) fail("Artwork nesting exceeds 64 levels.");
                parent = parent.parent;
            }
            var index = indexOf(layers, parent);
            if (index < 0) fail("Selected artwork is not owned by a layer in the active document.");
            return index;
        }
        function rejectClippingAncestors(item) {
            var parent = item, depth = 0;
            while (parent && parent !== document) {
                if (++depth > 128) fail("Artwork parent nesting exceeds the supported limit.");
                if ((parent.typename === "GroupItem" && parent.clipped) || (parent.typename === "PathItem" && parent.clipping)) {
                    fail("Clipped groups and clipping paths are unsupported; the source was left unchanged.");
                }
                parent = parent.parent;
            }
        }
        function readPath(path) {
            if (path.clipping || path.guides) fail("Clipping paths and Illustrator ruler guides are not supported stencil artwork.");
            var pp = path.pathPoints, points = [];
            if (!pp || pp.length < 2) fail("A selected path has fewer than two anchors.");
            pathCount++; anchorCount += pp.length;
            if (pathCount > 20000 || anchorCount > 200000) fail("Selection exceeds the bounded vector export limit.");
            for (var i = 0; i < pp.length; i++) points.push({a: point(pp[i].anchor), l: point(pp[i].leftDirection), r: point(pp[i].rightDirection)});
            var segments = path.closed ? points.length : points.length - 1;
            for (i = 0; i < segments; i++) {
                var first = points[i], last = points[(i + 1) % points.length];
                cubicBounds(bounds, first.a, first.r, last.l, last.a);
            }
            return {points: points, closed: !!path.closed, evenodd: !!path.evenodd};
        }
        function collect(item, depth) {
            if (!item || depth > 64) fail("Artwork nesting exceeds 64 levels.");
            if (indexOf(visited, item) >= 0) return;
            visited.push(item);
            rejectClippingAncestors(item);
            var type = item.typename, paths = [], i, layer;
            if (type === "GroupItem") {
                for (i = 0; i < item.pageItems.length; i++) {
                    // Some DOM collections expose descendants as well. Each
                    // direct child owns its recursion, preventing duplication.
                    if (item.pageItems[i].parent === item) collect(item.pageItems[i], depth + 1);
                }
                return;
            }
            layer = ownerIndex(item);
            if (type === "PathItem") paths.push(readPath(item));
            else if (type === "CompoundPathItem") {
                for (i = 0; i < item.pathItems.length; i++) paths.push(readPath(item.pathItems[i]));
                if (!paths.length) fail("An empty compound path is selected.");
                for (i = 1; i < paths.length; i++) if (paths[i].evenodd !== paths[0].evenodd) {
                    fail("A compound path has inconsistent fill rules; no geometry was approximated.");
                }
            } else fail("Unsupported selected item type: " + type + ". Select paths, compound paths or unclipped groups.");
            buckets[layer].push({name: String(item.name || "Path"), paths: paths, evenodd: paths[0].evenodd});
        }
        for (si = 0; si < selected.length; si++) {
            var ancestor = selected[si].parent, covered = false, steps = 0;
            while (ancestor && ancestor !== document) {
                if (++steps > 128) fail("Artwork parent nesting exceeds the supported limit.");
                if (indexOf(selected, ancestor) >= 0) { covered = true; break; }
                ancestor = ancestor.parent;
            }
            if (!covered) collect(selected[si], 0);
        }
        if (!pathCount || !isFinite(bounds[0])) fail("Selection contains no supported vector paths.");
        var width = Math.max(1, bounds[2] - bounds[0]), height = Math.max(1, bounds[3] - bounds[1]);
        function coordinate(p) {
            return String(p[0] - bounds[0]) + " " + String(yDown ? p[1] - bounds[1] : bounds[3] - p[1]);
        }
        function pathData(path) {
            var points = path.points, data = ["M" + coordinate(points[0].a)];
            var segments = path.closed ? points.length : points.length - 1;
            for (var i = 0; i < segments; i++) {
                var first = points[i], last = points[(i + 1) % points.length];
                if (same(first.a, first.r) && same(last.l, last.a)) data.push("L" + coordinate(last.a));
                else data.push("C" + coordinate(first.r) + " " + coordinate(last.l) + " " + coordinate(last.a));
            }
            if (path.closed) data.push("Z");
            return data.join(" ");
        }
        var result = {schemaVersion: 1, type: "krita-stencil-layers", name: String(document.name || "Illustrator selection").replace(/\.[^.]+$/, ""),
                      centerOnCanvas: true, layers: [], physicalUnits: "pt", scaleFactor: scale,
                      viewportPoints: [width, height], pathCount: pathCount, anchorCount: anchorCount};
        for (var li = 0; li < layers.length; li++) if (buckets[li].length) {
            var body = [], count = 0, layerAnchors = 0, nativeElements = 0;
            for (var bi = 0; bi < buckets[li].length; bi++) {
                var element = buckets[li][bi], data = [];
                for (var pi = 0; pi < element.paths.length; pi++) {
                    var path = element.paths[pi], segmentCount = path.closed ? path.points.length : path.points.length - 1;
                    data.push(pathData(path)); count++; layerAnchors += path.points.length;
                    nativeElements++; // The initial move-to.
                    for (var segment = 0; segment < segmentCount; segment++) {
                        var p0 = path.points[segment], p1 = path.points[(segment + 1) % path.points.length];
                        nativeElements += same(p0.a, p0.r) && same(p1.l, p1.a) ? 1 : 3;
                    }
                }
                body.push('<path fill="#000000" fill-rule="' + (element.evenodd ? "evenodd" : "nonzero") + '" d="' + data.join(" ") + '"/>');
            }
            result.layers.push({name: String(layers[li].name || "Layer"), pathCount: count,
                anchorCount: layerAnchors, nativeElementUpperBound: nativeElements,
                svg: '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + 'pt" height="' + height +
                     'pt" viewBox="0 0 ' + width + " " + height + '"><title>' + xml(layers[li].name || "Layer") +
                     '</title>' + body.join("") + '</svg>'});
        }
        if (result.layers.length > 128) fail("Selection exceeds 128 owning layers.");
        return result;
    }
    return {buildBatch: buildBatch, stringify: stringify};
}());
if (typeof module !== "undefined" && module.exports) module.exports = IllSvgExporter;
