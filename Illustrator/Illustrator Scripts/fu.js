// Sort objects from bottom to top and color every other object white
// Adobe Illustrator script

#target illustrator

function main() {
    if (app.documents.length === 0) {
        alert("No open documents. Please open a document and try again.");
        return;
    }

    var doc = app.activeDocument;
    var allLayers = collectUnlockedVisibleLayers(doc.layers);
    for (var i = 0; i < allLayers.length; i++) {
        processLayer(allLayers[i]);
    }
}

function collectUnlockedVisibleLayers(layers, result) {
    result = result || [];
    for (var i = 0; i < layers.length; i++) {
        var layer = layers[i];
        if (!layer.locked && layer.visible) {
            result.push(layer);
            collectUnlockedVisibleLayers(layer.layers, result);
        }
    }
    return result;
}

function processLayer(layer) {
    var items = layer.pageItems;
    var unlockedItems = filterUnlockedItems(items);
    var sortedItems = sortItems(unlockedItems);
    for (var i = 0; i < sortedItems.length; i++) {
        var item = sortedItems[i];
        if (i % 2 === 1) {
            item.fillColor = makeWhite();
        }
    }
}

function filterUnlockedItems(items) {
    var result = [];
    for (var i = 0; i < items.length; i++) {
        if (!items[i].locked) {
            result.push(items[i]);
        }
    }
    return result;
}

function sortItems(items) {
    var itemList = [];
    for (var i = 0; i < items.length; i++) {
        itemList.push(items[i]);
    }
    itemList.sort(function (a, b) {
        return a.position[1] - b.position[1];
    });
    return itemList;
}

function makeWhite() {
    var whiteColor = new RGBColor();
    whiteColor.red = 255;
    whiteColor.green = 255;
    whiteColor.blue = 255;
    return whiteColor;
}

main();
