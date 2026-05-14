#target illustrator

function main() {
    var doc = app.activeDocument;
    var selection = doc.selection;

    if (!selection || selection.length === 0) {
        alert('Please select some objects before running this script.');
        return;
    }

    var sortedSelection = sortSelectionByYPosition(selection);
    deselectAll(doc);
    selectEveryOther(sortedSelection);
}

function sortSelectionByYPosition(selection) {
    var sortedSelection = Array.prototype.slice.call(selection);
    sortedSelection.sort(function (a, b) {
        return a.position[1] - b.position[1];
    });
    return sortedSelection;
}

function deselectAll(doc) {
    doc.selection = null;
}

function selectEveryOther(sortedSelection) {
    for (var i = 0; i < sortedSelection.length; i += 2) {
        sortedSelection[i].selected = true;
    }
}

main();
