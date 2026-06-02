//@target illustrator
// Description: FlowCell Illustrator anchor capture for the V hotkey.
// FLOWCELL_REQUIRES_ACTIVE_ILLUSTRATOR: true

(function () {
    function findProgramRoot() {
        var folder = new File($.fileName).parent;
        for (var i = 0; i < 8 && folder; i += 1) {
            var helper = new Folder(folder.fsName + "/HelperScripts");
            var panels = new Folder(folder.fsName + "/Panels");
            if (helper.exists && panels.exists) {
                return folder;
            }
            folder = folder.parent;
        }
        return new File($.fileName).parent.parent;
    }

    FLOWCELL_ILLUSTRATOR_ANCHOR_COMMAND = { command: "set_anchor" };
    return $.evalFile(new File(findProgramRoot().fsName + "/HelperScripts/FlowCell_Illustrator_Anchor.jsx"));
}());
