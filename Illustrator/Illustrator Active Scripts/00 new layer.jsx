//@target illustrator

// Check if there's an open document
if (app.documents.length > 0) {
    var doc = app.activeDocument;
    // Add a new layer; Illustrator will automatically assign it a generic name (e.g., "Layer 2")
    var newLayer = doc.layers.add();
} else {
    // If no document is open, create one silently to avoid prompts.
    var doc = app.documents.add();
    var newLayer = doc.layers.add();
}
