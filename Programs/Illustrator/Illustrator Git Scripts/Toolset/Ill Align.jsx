//@target illustrator
// Description: Open FlowCell Illustrator anchor alignment controls using visibleBounds.
// FLOWCELL_KIND: illustrator_alignment_toolset
// FLOWCELL_CHILD: x_min | X Min | Align selected object left edges to the FlowCell anchor left edge.
// FLOWCELL_CHILD: x_center | X Center | Align selected object horizontal centers to the FlowCell anchor center.
// FLOWCELL_CHILD: x_max | X Max | Align selected object right edges to the FlowCell anchor right edge.
// FLOWCELL_CHILD: x_surface | X Surface | Toggle X surface alignment against the FlowCell anchor.
// FLOWCELL_CHILD: x_geo | X Origin | Align selected object centers to the FlowCell anchor center on X.
// FLOWCELL_CHILD: y_min | Y Min | Align selected object bottom edges to the FlowCell anchor bottom edge.
// FLOWCELL_CHILD: y_center | Y Center | Align selected object vertical centers to the FlowCell anchor center.
// FLOWCELL_CHILD: y_max | Y Max | Align selected object top edges to the FlowCell anchor top edge.
// FLOWCELL_CHILD: y_surface | Y Surface | Toggle Y surface alignment against the FlowCell anchor.
// FLOWCELL_CHILD: y_geo | Y Origin | Align selected object centers to the FlowCell anchor center on Y.
// FLOWCELL_CHILD: center_artboard | Art | Center selected objects on the active artboard.
// FLOWCELL_CHILD: center_everything | Anchor | Center selected objects on the stored FlowCell anchor.
// FLOWCELL_CHILD: toggle_group | Group | Toggle virtual group movement for selected objects.

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
