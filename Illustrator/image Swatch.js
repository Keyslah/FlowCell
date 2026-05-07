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
    var swatchGroupName = 'Prominent Colors';
    
    createColorGroupSwatch(swatchGroupName, imageData.pixels);
}

function countColors(pixels) {
    var colorCounts = {};
    
    for (var i = 0; i < pixels.length; i++) {
        for (var j = 0; j < pixels[i].length; j++) {
            var color = pixels[i][j];
            var colorKey = color.toString();
            
            if (colorCounts.hasOwnProperty(colorKey)) {
                colorCounts[colorKey]++;
            } else {
                colorCounts[colorKey] = 1;
            }
        }
    }
    
    var countedColors = [];
    for (var key in colorCounts) {
        var colorArray = key.split(',');
        for (var i = 0; i < colorArray.length; i++) {
            colorArray[i] = parseInt(colorArray[i], 10);
        }
        colorArray.push(colorCounts[key]);
        countedColors.push(colorArray);
    }
    
    return countedColors;
}

function createColorGroupSwatch(swatchGroupName, pixels) {
    var doc = app.activeDocument;
    var swatchGroup = doc.swatchGroups.add();
    swatchGroup.name = swatchGroupName;

    var countedColors = countColors(pixels);
    
    // Sort the counted colors array by the count (the 4th element in each color entry)
    Array.prototype.sort.call(countedColors, function(a, b) {
        return b[3] - a[3]; // Descending order
    });

    // Select the top 20 colors
    var topColors = Array.prototype.slice.call(countedColors, 0, 100);

    for (var i = 0; i < topColors.length; i++) {
        var colorArray = topColors[i];
        var color = new RGBColor();
        color.red = colorArray[0];
        color.green = colorArray[1];
        color.blue = colorArray[2];

        var newSwatch = doc.swatches.add();
        newSwatch.color = color;
        newSwatch.name = 'Color ' + (i + 1);
        swatchGroup.addSwatch(newSwatch);
    }
}

main();
