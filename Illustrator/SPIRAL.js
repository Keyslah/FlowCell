#target illustrator

function createSpiral(centerX, centerY, numPoints, angleIncrement, radiusIncrement) {
    var doc = app.activeDocument;
    var path = doc.pathItems.add();
    var angle = 0;
    var radius = 0;
  
    for (var i = 0; i < numPoints; i++) {
        var x = centerX + radius * Math.cos(angle);
        var y = centerY + radius * Math.sin(angle);
        var anchor = [x, y];
        
        if (i === 0) {
            path.setEntirePath([anchor]);
        } else {
            path.pathPoints.add().anchor = anchor;
        }
        
        angle += angleIncrement;
        radius += radiusIncrement;
    }
}

var centerX = 200;
var centerY = 200;
var numPoints = 100;
var angleIncrement = Math.PI / 4; // Change this value to control the tightness of the spiral
var radiusIncrement = 5; // Change this value to control the distance between each point

createSpiral(centerX, centerY, numPoints, angleIncrement, radiusIncrement);
