// Sorts selected objects from top to bottom based on their Y position.
function sortObjectsFromTopToBottom(selection) {
  return selection.sort(function(a, b) {
    var yPosA = a.position[1];
    var yPosB = b.position[1];
    return yPosA - yPosB;
  });
}

function applyColorRule(selection, index, total, color1, color2) {
  var percentage = (index / (total - 1)) * 100;

  if (percentage <= 30) {
    selection[index].fillColor = color1;
  } else if (percentage > 30 && percentage <= 50 && index % 20 === 0) {
    selection[index].fillColor = color2;
  } else if (percentage > 50 && percentage <= 70 && index % 10 === 0) {
    selection[index].fillColor = color2;
  } else if (percentage > 70 && percentage <= 80 && index % 7 === 0) {
    selection[index].fillColor = color2;
  } else if (percentage > 80 && percentage <= 90 && index % 3 === 0) {
    selection[index].fillColor = color2;
  } else if (percentage > 90 && index % 2 === 0) {
    selection[index].fillColor = color2;
  }
}

function main() {
  var doc = app.activeDocument;
  var selection = doc.selection;
  var totalObjects = selection.length;

  if (totalObjects === 0) {
    alert("No objects selected. Please select objects to apply the color rules.");
    return;
  }

  var sortedSelection = sortObjectsFromTopToBottom(selection);

  var colorGroups = doc.swatchGroups;
  if (colorGroups.length === 0) {
    alert("No color groups found. Please create a color group with at least two color swatches.");
    return;
  }

  var lastColorGroup = colorGroups[colorGroups.length - 1];
  var lastColorGroupSwatches = lastColorGroup.getAllSwatches();
  if (lastColorGroupSwatches.length < 2) {
    alert("The last color group must have at least two color swatches.");
    return;
  }

  var color1 = lastColorGroupSwatches[0].color;
  var color2 = lastColorGroupSwatches[1].color;

  for (var i = 0; i < totalObjects; i++) {
    applyColorRule(sortedSelection, i, totalObjects, color1, color2);
  }
}

main();
