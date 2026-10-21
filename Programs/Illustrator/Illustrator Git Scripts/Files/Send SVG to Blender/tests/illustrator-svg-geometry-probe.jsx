#target illustrator
// Run through Illustrator COM with $.global.__FLOWCELL_SVG_PROBE_OUTPUT__ set
// to a disposable output directory. Only disposable documents are changed.
(function () {
    var original = app.documents.length ? app.activeDocument : null;
    var documentCount = app.documents.length;
    var output = new Folder($.global.__FLOWCELL_SVG_PROBE_OUTPUT__);
    var source = new File(new File($.fileName).parent.parent.fsName + "/18_Prepare_Selected_OBJ_Export.jsx");
    var doc = null, items = [], report = [], expected = [], api;
    function rectangle(parent, left, bottom, width, height) {
        var path = parent.pathItems.add();
        path.setEntirePath([[left,bottom],[left+width,bottom],[left+width,bottom+height],[left,bottom+height]]);
        path.closed = true; path.filled = true; path.stroked = false;
        return path;
    }
    function ring(parent) {
        var compound = parent.compoundPathItems.add();
        rectangle(compound,0,0,100,100).evenodd = true;
        rectangle(compound,30,30,40,40).evenodd = true;
        return compound;
    }
    function clip(group, left, bottom, width, height) {
        var mask = rectangle(group,left,bottom,width,height);
        mask.zOrder(ZOrderMethod.BRINGTOFRONT);
        mask.clipping = true; group.clipped = true;
    }
    function write(name, text) {
        var file = new File(output.fsName + "/" + name);
        file.encoding = "UTF-8"; if (!file.open("w")) throw new Error("Cannot write " + file.fsName);
        file.write(text); file.close();
    }
    try {
        if (!output.exists) output.create();
        $.global.__FLOWCELL_SEND_SVG_TO_BLENDER_TEST__ = true;
        $.evalFile(source);
        api = $.global.__FLOWCELL_SEND_SVG_TO_BLENDER_TEST_API__;
        var cases = ["evenodd-ring", "cropped-ring", "compound-mask", "nested-mask", "hole-with-island", "overlapping-solids"];
        var areas = [8400,6400,8400,4800,8500,10000];
        for (var i=0;i<cases.length;i++) {
            doc = app.documents.add(DocumentColorSpace.RGB);
            var layer = doc.layers[0], group = layer.groupItems.add();
            if (cases[i] === "compound-mask") {
                rectangle(group,-10,-10,120,120);
                var mask = ring(group); mask.zOrder(ZOrderMethod.BRINGTOFRONT);
                doc.selection = null; group.selected = true;
                app.executeMenuCommand("makeMask");
            } else if (cases[i] === "nested-mask") {
                var nested = group.groupItems.add(); ring(nested); clip(nested,0,0,80,100); clip(group,0,0,100,80);
            } else if (cases[i] === "overlapping-solids") {
                rectangle(group,0,0,100,100); rectangle(group,30,30,40,40);
            } else {
                ring(group);
                if (cases[i] === "cropped-ring") clip(group,0,0,80,100);
                if (cases[i] === "hole-with-island") rectangle(group,45,45,10,10);
            }
            app.redraw();
            var before = doc.pageItems.length;
            var result = api.exportGroup(doc, {items:[group],layerName:cases[i],fileName:cases[i],extrudeMm:2,offsetXmm:0,offsetYmm:0}, output, []);
            if (doc.pageItems.length !== before) throw new Error("Source document changed: before="+before+" after="+doc.pageItems.length+" doc="+doc.name+" active="+app.activeDocument.name);
            items.push(result); expected.push('"' + cases[i] + '":' + areas[i]);
            report.push(cases[i]+" OK width="+result.widthMm+" height="+result.heightMm);
            doc.close(SaveOptions.DONOTSAVECHANGES); doc = null;
        }
        write("geometry-request.json", api.buildRequestJson("geometry-probe", items, "none", ""));
        write("geometry-areas.json", "{" + expected.join(",") + "}");
        report.push("ILLUSTRATOR_SVG_GEOMETRY_PROBE_OK");
    } catch (error) {
        report.push("ERROR " + error + " line=" + error.line);
        throw error;
    } finally {
        if (doc) doc.close(SaveOptions.DONOTSAVECHANGES);
        if (original) original.activate();
        delete $.global.__FLOWCELL_SEND_SVG_TO_BLENDER_TEST__;
        delete $.global.__FLOWCELL_SEND_SVG_TO_BLENDER_TEST_API__;
        if (app.documents.length !== documentCount) report.push("ERROR document count changed");
        write("illustrator-geometry-probe.txt", report.join("\n"));
    }
    return report.join("\n");
})();
