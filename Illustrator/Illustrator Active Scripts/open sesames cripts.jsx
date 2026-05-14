// Adobe Illustrator Script: Open Other Script Dialog Automatically
// This script opens the "Other Script" dialog and sets the default folder to a specified path.

(function() {
    var folderPath = "C:/Program Files/Adobe/Adobe Illustrator 2025/Presets/en_US/Scripts";

    try {
        var scriptsFolder = new Folder(folderPath);

        if (!scriptsFolder.exists) {
            alert("The predefined folder does not exist: " + folderPath);
            return;
        }

        // Open the Other Script dialog with the specified folder as default
        var scriptFile = scriptsFolder.openDlg("Select a script to run", "*.jsx;*.js");

        if (scriptFile) {
            // Execute the selected script
            $.evalFile(scriptFile);
            alert("Script executed successfully: " + scriptFile.name);
        } else {
            alert("No script selected.");
        }
    } catch (e) {
        alert("An error occurred: " + e.message);
    }
})();
