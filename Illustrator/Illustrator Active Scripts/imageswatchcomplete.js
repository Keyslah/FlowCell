#target illustrator

function main() {
    var doc = app.activeDocument;
    var jsonFile = File.openDialog('Select the JSON file with color data:', '*.json');
    
    if (jsonFile === null) {
        return;
    }
    
    jsonFile.open('r');
    var jsonContent = jsonFile.read();
    jsonFile.close();
    
    var imageData = eval('(' + jsonContent + ')');
    var swatchGroupName = 'All Colors';
    
    createColorGroupSwatch(swatchGroupName, imageData.pixels);
}

function createColorGroupSwatch(swatchGroupName, pixels) {
    var doc = app.activeDocument;
    var swatchGroup = doc.swatchGroups.add();
    swatchGroup.name = swatchGroupName;

    var colorIndex = 0;

    for (var i = 0; i < pixels.length; i++) {
        for (var j = 0; j < pixels[i].length; j++) {
            var colorArray = pixels[i][j];
            var color = new RGBColor();
            color.red = colorArray[0];
            color.green = colorArray[1];
            color.blue = colorArray[2];

            var newSwatch = doc.swatches.add();
            newSwatch.color = color;
            newSwatch.name = 'Color ' + (colorIndex + 1);
            swatchGroup.addSwatch(newSwatch);

            $.writeln("Color " + (colorIndex + 1) + ": R=" + color.red + " G=" + color.green + " B=" + color.blue);

            colorIndex++;
        }
    }
}
alert('your message')
main();
