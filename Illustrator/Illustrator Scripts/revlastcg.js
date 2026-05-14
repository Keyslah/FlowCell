// Reverse the order of the swatches in the last color group swatch

#target illustrator

function reverseFirstColorGroupSwatch() {
  if (app.documents.length == 0) {
    alert("No open documents.");
    return;
  }

  var doc = app.activeDocument;
  var colorGroups = doc.swatchGroups;
  if (colorGroups.length <= 1) {
    alert("No color groups found.");
    return;
  }

  var lastColorGroup = colorGroups[colorGroups.length - 1];
  var swatches = lastColorGroup.getAllSwatches();
  var swatchesLength = swatches.length;

  for (var i = 0; i < swatchesLength / 2; i++) {
    var swatchA = swatches[i];
    var swatchB = swatches[swatchesLength - 1 - i];

    var tempColor = swatchA.color;
    swatchA.color = swatchB.color;
    swatchB.color = tempColor;
  }

  
}

reverseFirstColorGroupSwatch();
