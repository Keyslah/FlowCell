var doc = app.activeDocument;
var activeLayer = doc.activeLayer;
var sublayers = activeLayer.layers;
var sel = doc.selection;
var selectedLayers = [];

// Loop through all sublayers and check if they contain any selected art
for (var i = 0; i < sublayers.length; i++) {
  var sublayer = sublayers[i];
  var containsSelected = false;
  for (var j = 0; j < sublayer.pageItems.length; j++) {
    var item = sublayer.pageItems[j];
    if (sel.indexOf(item) != -1) {
      containsSelected = true;
      selectedLayers.push(sublayer);
      break;
    }
  }
  if (!containsSelected) {
    sublayer.locked = true;
  }
}

// Unlock all selected sublayers
for (var i = 0; i < selectedLayers.length; i++) {
  var sublayer = selectedLayers[i];
  sublayer.locked = false;
}
