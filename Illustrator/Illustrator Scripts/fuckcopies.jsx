// Adobe Illustrator Script: Convert Scripts to Actions
// This script lists all the scripts in the Scripts folder and creates an action for each script so they can be executed with one click.

(function() {
    var scriptsFolder = new Folder(Folder.startup + '/Scripts');
    var actionsSetName = "ScriptsActions";

    if (!scriptsFolder.exists) {
        alert("Scripts folder not found.");
        return;
    }

    var scripts = scriptsFolder.getFiles("*.jsx");

    if (scripts.length === 0) {
        alert("No scripts found in the Scripts folder.");
        return;
    }

    // Create an action set file
    var actionsFile = new File(Folder.desktop + '/' + actionsSetName + ".aia");
    actionsFile.open("w");

    actionsFile.writeln("/version 3");
    actionsFile.writeln("/name [" + actionsSetName.length + "]");
    actionsFile.writeln(actionsSetName);
    actionsFile.writeln("/isOpen 1");

    for (var i = 0; i < scripts.length; i++) {
        var script = scripts[i];
        var scriptName = decodeURIComponent(script.name.replace(/\.jsx$/, ""));

        actionsFile.writeln("/action-1");
        actionsFile.writeln("\t/name [" + scriptName.length + "]");
        actionsFile.writeln("\t" + scriptName);
        actionsFile.writeln("\t/eventCount 1");
        actionsFile.writeln("\t/event-1");
        actionsFile.writeln("\t\t/internalName (ai_command)");
        actionsFile.writeln("\t\t/localizedName [11]");
        actionsFile.writeln("\t\tInsert Menu Item");
        actionsFile.writeln("\t\t/isOn 1");
        actionsFile.writeln("\t\t/parameterCount 1");
        actionsFile.writeln("\t\t/parameter-1");
        actionsFile.writeln("\t\t\t/key 1835363957");
        actionsFile.writeln("\t\t\t/type (ustring)");
        actionsFile.writeln("\t\t\t/value [" + script.fullName.length + "]");
        actionsFile.writeln("\t\t\t" + script.fullName);
    }

    actionsFile.close();

    // Load the action set into Illustrator
    app.loadAction(actionsFile);

    alert("Actions created successfully for all scripts in the Scripts folder. You can now find them under the '" + actionsSetName + "' action set.");
})();
