// GradientOpacityByArea.jsx
// This script calculates each selected object's area using its path points,
// sorts the objects from smallest to largest,
// then assigns opacities on a gradient from minOpacity (10%) to maxOpacity (50%).

(function(){
    if (app.documents.length < 1) {
        alert("No documents open. Open a document and try again, genius.");
        return;
    }
    var doc = app.activeDocument;
    if (doc.selection.length < 1) {
        alert("Nothing selected. Select some objects and try again!");
        return;
    }
    var sel = doc.selection;
    var items = [];
    
    // Function to compute polygon area using the shoelace formula.
    // Assumes the path is closed.
    function polygonArea(pathItem) {
        var pts = pathItem.pathPoints;
        var n = pts.length;
        var area = 0;
        for (var i = 0; i < n; i++) {
            var curr = pts[i].anchor; // [x, y]
            var next = pts[(i + 1) % n].anchor;
            area += curr[0] * next[1] - next[0] * curr[1];
        }
        return Math.abs(area) / 2;
    }
    
    // Function to get the area of an item.
    // If it's a PathItem, use polygonArea.
    // If it's a CompoundPathItem, sum the areas of its subpaths.
    // Otherwise, fall back to the bounding box area.
    function getArea(item) {
        if (item.typename === "PathItem") {
            return polygonArea(item);
        } else if (item.typename === "CompoundPathItem") {
            var total = 0;
            for (var i = 0; i < item.pathItems.length; i++) {
                total += polygonArea(item.pathItems[i]);
            }
            return total;
        } else {
            // Fallback using visibleBounds: [top, left, bottom, right]
            var gb = item.visibleBounds;
            var width = Math.abs(gb[3] - gb[1]);
            var height = Math.abs(gb[0] - gb[2]);
            return width * height;
        }
    }
    
    // Populate the items array with each object and its computed area.
    for (var i = 0; i < sel.length; i++) {
        try {
            var area = getArea(sel[i]);
            items.push({ item: sel[i], area: area });
        } catch (e) {
            // If there was a problem (e.g., the object isn't a path), skip this item.
            $.writeln("Skipping an item: " + e);
        }
    }
    
    if (items.length === 0) {
        alert("No valid objects to process.");
        return;
    }
    
    // Sort objects from smallest to largest based on computed area.
    items.sort(function(a, b) {
        return a.area - b.area;
    });
    
    // Define the minimum and maximum opacity values.
    var minOpacity = 10;
    var maxOpacity = 50;
    
    // Determine the smallest and largest area.
    var minArea = items[0].area;
    var maxArea = items[items.length - 1].area;
    
    // If all objects have the same area, just assign the minimum opacity.
    if (minArea === maxArea) {
        for (var i = 0; i < items.length; i++) {
            items[i].item.opacity = minOpacity;
        }
        alert("All objects have the same area. Setting opacity to " + minOpacity + "% for each.");
    } else {
        // Assign opacities with a linear gradient:
        // smallest object gets minOpacity, largest gets maxOpacity.
        for (var i = 0; i < items.length; i++) {
            var norm = (items[i].area - minArea) / (maxArea - minArea); // normalized value in [0,1]
            var newOpacity = minOpacity + norm * (maxOpacity - minOpacity);
            items[i].item.opacity = Math.round(newOpacity);
        }
        alert("Script complete! Your objects are now sorted by area with a gradient opacity from " + minOpacity + "% (smallest) to " + maxOpacity + "% (largest).");
    }
})();
