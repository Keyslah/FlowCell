// Adobe Illustrator script to create copies of a selected object

if (app.documents.length > 0) {
    var doc = app.activeDocument;

    if (doc.selection.length > 0) {
        var selectedItem = doc.selection[0];

        if (selectedItem) {
            // Prompt the user for the number of copies
            var copies = prompt("Enter the number of copies to make:", "1");

            if (copies !== null) {
                copies = parseInt(copies);

                if (!isNaN(copies) && copies > 0) {
                    // Duplicate the selected object
                    for (var i = 1; i <= copies; i++) {
                        selectedItem.duplicate();
                    }

                    alert(copies + " copies created successfully.");
                } else {
                    alert("Please enter a valid positive number.");
                }
            } else {
                alert("Copy operation canceled.");
            }
        } else {
            alert("No object selected to duplicate.");
        }
    } else {
        alert("Please select an object to duplicate.");
    }
} else {
    alert("No open document found.");
}
