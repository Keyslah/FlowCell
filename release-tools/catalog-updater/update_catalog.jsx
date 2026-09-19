/* Purpose: Illustrator-owned Update Git Scripts entry, executed through the normal runner.
 * Context: Installed Local Scripts package; no inputs and no artwork changes.
 * Writes: Adjacent launcher starts the packaged catalog-only helper.
 * Conflicts/deletions: Helper preserves local edits and recycles unchanged deletions.
 * Constraints: No Windows program package, developer checkout, Git, or login required.
 */
(function () {
    var launcher = new File(new File($.fileName).parent.fsName + "/launch_updater.vbs");
    if (!launcher.exists || !launcher.execute()) {
        throw new Error("The installed catalog updater launcher is missing or could not start.");
    }
}());
