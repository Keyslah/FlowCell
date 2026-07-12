//@target illustrator
// Description: Open FlowCell Illustrator anchor alignment controls using visibleBounds.

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

    return $.evalFile(new File(findProgramRoot().fsName + "/HelperScripts/FlowCell_Illustrator_Anchor.jsx"));
}());
