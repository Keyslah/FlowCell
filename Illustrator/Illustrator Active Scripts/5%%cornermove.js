// Move a random corner with an angle less than 110 degrees of selected objects
// 5% towards the center in Adobe Illustrator
(function () {
    function cornerAngle(point1, point2, point3) {
        var angle = (Math.atan2(point3[1] - point1[1], point3[0] - point1[0]) - Math.atan2(point2[1] - point1[1], point2[0] - point1[0])) * (180 / Math.PI);
        if (angle < 0) {
            angle += 360;
        }
        return angle;
    }

    if (app.documents.length === 0 || app.activeDocument.selection.length === 0) {
        alert("Please select the objects you want to modify.");
        return;
    }

    var selection = app.activeDocument.selection;
    var movePercent = 0.05; // Move 5% towards the center

    for (var i = 0; i < selection.length; i++) {
        var obj = selection[i];

        if (obj.typename === "PathItem" && obj.pathPoints.length > 2) {
            // Get the object's center point
            var centerX = obj.position[0] + obj.width / 2;
            var centerY = obj.position[1] - obj.height / 2;

            // Get the corners with angles less than 110 degrees
            var corners = [];
            for (var j = 0; j < obj.pathPoints.length; j++) {
                var prevPoint = obj.pathPoints[(j - 1 + obj.pathPoints.length) % obj.pathPoints.length].anchor;
                var currPoint = obj.pathPoints[j].anchor;
                var nextPoint = obj.pathPoints[(j + 1) % obj.pathPoints.length].anchor;
                var angle = cornerAngle(prevPoint, currPoint, nextPoint);

                if (angle < 110) {
                    corners.push(j);
                }
            }

            if (corners.length > 0) {
                // Randomly select a corner
                var randomIndex = Math.floor(Math.random() * corners.length);
                var corner = obj.pathPoints[corners[randomIndex]];

                // Calculate the new corner position
                var newX = corner.anchor[0] + (centerX - corner.anchor[0]) * movePercent;
                var newY = corner.anchor[1] + (centerY - corner.anchor[1]) * movePercent;

                // Move the corner towards the center
                corner.anchor = [newX, newY];
                corner.leftDirection = [newX, newY];
                corner.rightDirection = [newX, newY];
            }
        } else {
            alert("Object " + (i + 1) + " is not a valid path. Please select only path objects with more than two points.");
        }
    }
})();
