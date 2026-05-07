var doc = app.activeDocument;
var sel = doc.selection;

if (sel.length == 1 && sel[0].typename == 'PathItem' && sel[0].pathPoints.length > 1) {

    // Prompt the user to enter the offset distance
    var offsetDist = prompt('Enter the offset distance in inches:', '0.25');
    if (offsetDist == null) {
        return;
    }
    offsetDist = parseFloat(offsetDist) * 72; // Convert inches to points

    // Create a new path item for the offset line
    var offsetPath = sel[0].duplicate();
    offsetPath.guides = false; // Make sure it's not a guide

    // Get the first path point of the original line
    var startPoint = sel[0].pathPoints[0];

    // Loop through the path points of the original line and set the position of the corresponding points on the offset line
    for (var i = 0; i < sel[0].pathPoints.length; i++) {
        var pt = sel[0].pathPoints[i];
        var offsetPt = offsetPath.pathPoints[i];

        // Calculate the offset point position based on the distance and direction from the original point
        var dx = pt.anchor[0] - startPoint.anchor[0];
        var dy = pt.anchor[1] - startPoint.anchor[1];
        var angle = Math.atan2(dy, dx);
        var offsetDx = offsetDist * Math.sin(angle);
        var offsetDy = offsetDist * Math.cos(angle);
        offsetPt.anchor = [pt.anchor[0] + offsetDx, pt.anchor[1] - offsetDy];
        offsetPt.leftDirection = [pt.leftDirection[0] + offsetDx, pt.leftDirection[1] - offsetDy];
        offsetPt.rightDirection = [pt.rightDirection[0] + offsetDx, pt.rightDirection[1] - offsetDy];
    }

    // Deselect the original line and select the offset line
    sel[0].selected = false;
    offsetPath.selected = true;

} else {
    alert('Please select a single curved line with more than one point.');
}
