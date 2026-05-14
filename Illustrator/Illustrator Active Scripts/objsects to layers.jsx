#target illustrator

function placeObjectsOnSeparateLayers() {
    var doc = app.activeDocument;
    var selection = doc.selection;

    if (selection.length === 0) {
        alert("Please select at least one object.");
        return;
    }

    for (var i = 0; i < selection.length; i++) {
        var obj = selection[i];
        var newLayer = doc.layers.add();
        newLayer.name = "Object_" + (i + 1);

        obj.move(newLayer, ElementPlacement.PLACEATBEGINNING);
    }

    alert("Objects have been placed on separate layers.");
}

placeObjectsOnSeparateLayers();
