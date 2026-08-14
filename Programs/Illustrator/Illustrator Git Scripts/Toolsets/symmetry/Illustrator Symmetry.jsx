//@target illustrator
// Description: Loads the package-owned FlowCell Illustrator symmetry core.

(function () {
    function installedSourceFile() {
        try {
            if (typeof FLOWCELL_SCRIPT_PATH !== "undefined" && FLOWCELL_SCRIPT_PATH) {
                return new File(String(FLOWCELL_SCRIPT_PATH));
            }
        } catch (ignored) {
        }
        return new File($.fileName);
    }

    var folder = installedSourceFile().parent;
    var names = [
        "Illustrator Symmetry Core 1.jsxinc",
        "Illustrator Symmetry Core 2.jsxinc",
        "Illustrator Symmetry Core 3.jsxinc",
        "Illustrator Symmetry Core 4.jsxinc"
    ];
    var code = "";
    for (var i = 0; i < names.length; i += 1) {
        var file = new File(folder.fsName + "/" + names[i]);
        file.encoding = "UTF-8";
        if (!file.exists || !file.open("r")) {
            throw new Error("Illustrator Symmetry package file is missing: " + file.fsName);
        }
        code += file.read();
        file.close();
    }
    return eval(code);
}());
