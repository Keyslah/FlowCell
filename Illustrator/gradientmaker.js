#target illustrator

function createSpiral() {
  var doc = app.activeDocument;

  // Set the parameters for the spiral
  var centerX = 200;
  var centerY = 200;
  var numRings = 100;
  var ringInterval = 2;
  var numSegments = 1;

  // Create the spiral using the Polar Grid Tool
  var polarGridTool = app.tool[0].polarGridTool; // Access the Polar Grid Tool
  var spiral = polarGridTool.createObject(centerX, centerY, numRings, ringInterval, numSegments);

  // Add the spiral to the document
  doc.pathItems.add(spiral);
}

createSpiral();
