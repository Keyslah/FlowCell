// Select the image you want to halftone
var img = app.selection[0];

// Check if an image is selected
if (img == null || img.typename != "RasterItem") {
    alert("Please select an image first.");
} else {
    // Get image dimensions
    var imgWidth = img.width;
    var imgHeight = img.height;

    // Create a new layer for the halftone
    var halftoneLayer = app.activeDocument.layers.add();
    halftoneLayer.name = "Halftone";

    // Halftone parameters
    var dotSize = 10; // Diameter of the halftone dots
    var dotSpacing = dotSize * 1.5; // Spacing between the dots

    // Calculate the number of rows and columns
    var numRows = Math.ceil(imgHeight / dotSpacing);
    var numCols = Math.ceil(imgWidth / dotSpacing);

    // Loop through rows and columns to create halftone dots
    for (var row = 0; row < numRows; row++) {
        for (var col = 0; col < numCols; col++) {
            // Calculate dot position
            var x = col * dotSpacing;
            var y = row * dotSpacing;

            // Get the color of the corresponding pixel in the image
            var pixelColor = img.getPixel(x, y);

            // Calculate dot radius based on color intensity
            var colorIntensity = (pixelColor.red + pixelColor.green + pixelColor.blue) / (255 * 3);
            var dotRadius = dotSize / 2 * colorIntensity;

            // Create the halftone dot
            var dot = halftoneLayer.pathItems.ellipse(y + dotRadius, x - dotRadius, dotRadius * 2, dotRadius * 2);
            dot.fillColor = pixelColor;
            dot.stroked = false;
        }
    }

    // Hide the original image
    img.visible = false;
}