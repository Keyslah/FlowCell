//@target illustrator
// Description: Open FlowCell Illustrator rotate controls for transform and radial distribution.
// FLOWCELL_KIND: illustrator_rotate_toolset
// FLOWCELL_CHILD: center_world | Art | Use the active artboard center as the rotation pivot.
// FLOWCELL_CHILD: center_cursor | Anchor | Use the stored FlowCell Illustrator anchor object as the rotation pivot.
// FLOWCELL_CHILD: preset_30 | 30 deg | Apply a 30 degree Illustrator rotation immediately.
// FLOWCELL_CHILD: preset_45 | 45 deg | Apply a 45 degree Illustrator rotation immediately.
// FLOWCELL_CHILD: preset_90 | 90 deg | Apply a 90 degree Illustrator rotation immediately.
// FLOWCELL_CHILD: mode_transform | Transform | Rotate the current selection.
// FLOWCELL_CHILD: mode_distribute | Distribute | Use the staged degree value to create rotated copies around the pivot.
// FLOWCELL_CHILD: apply_negative | Negative | Apply the staged Illustrator rotate values in the negative direction.
// FLOWCELL_CHILD: apply_positive | Positive | Apply the staged Illustrator rotate values in the positive direction.

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

    return $.evalFile(new File(findProgramRoot().fsName + "/HelperScripts/FlowCell_Illustrator_Rotate.jsx"));
}());
