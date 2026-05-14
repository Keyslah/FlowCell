#target illustrator

/*
 * Relinks placed images in the active document by matching filenames against
 * files found inside the project's fixed assets folder.
 */
(function () {
    var SCRIPT_NAME = "relink";
    var ASSETS_RELATIVE_PATH = "01 src/04 assets";
    var IMAGES_RELATIVE_PATH = "01 src/04 assets/01 images";
    var LOG_FILE_NAME = "relink.log.txt";
    var MAX_ASCENT = 12;

    if (app.documents.length === 0) {
        alert("Open a document first.");
        return;
    }

    var doc = app.activeDocument;
    var docFolder;
    var projectRoot;
    var assetsFolder;
    var logFile;
    var summaryText;
    var fileIndex;
    var placedEntries;
    var relinked = [];
    var missing = [];
    var ambiguous = [];
    var errors = [];
    var i;

    try {
        docFolder = getDocumentFolder(doc);
    } catch (err) {
        alert("Save the document first so " + SCRIPT_NAME + " can find the project folder.");
        return;
    }

    projectRoot = findProjectRoot(docFolder);
    if (!projectRoot) {
        alert("Could not find the project root from:\n" + docFolder.fsName);
        return;
    }

    assetsFolder = getPreferredAssetsFolder(projectRoot);
    if (!assetsFolder.exists) {
        alert("Could not find the assets folder at:\n" + assetsFolder.fsName);
        return;
    }

    logFile = new File(projectRoot.fsName + "/" + LOG_FILE_NAME);
    fileIndex = buildFileIndex(assetsFolder);
    placedEntries = buildPlacedEntries(doc);
    if (placedEntries.length === 0) {
        summaryText = buildSummary(projectRoot, assetsFolder, relinked, missing, ambiguous, errors, placedEntries.length);
        writeLog(logFile, summaryText);
        alert(summaryText);
        return;
    }

    for (i = 0; i < placedEntries.length; i += 1) {
        relinkPlacedItem(placedEntries[i], fileIndex, relinked, missing, ambiguous, errors);
    }

    summaryText = buildSummary(projectRoot, assetsFolder, relinked, missing, ambiguous, errors, placedEntries.length);
    writeLog(logFile, summaryText);
    alert(summaryText);

    function getDocumentFolder(documentRef) {
        return documentRef.fullName.parent;
    }

    function findProjectRoot(startFolder) {
        var current = startFolder;
        var depth = 0;

        while (current && depth < MAX_ASCENT) {
            if (isProjectRoot(current)) {
                return current;
            }

            if (!current.parent || current.parent.fsName === current.fsName) {
                break;
            }

            current = current.parent;
            depth += 1;
        }

        return null;
    }

    function isProjectRoot(folderRef) {
        return folderExists(folderRef, "01 src") &&
            folderExists(folderRef, "02 builds") &&
            folderExists(folderRef, "03 releases") &&
            folderExists(folderRef, "04 archive");
    }

    function folderExists(parentFolder, childName) {
        return new Folder(parentFolder.fsName + "/" + childName).exists;
    }

    function getPreferredAssetsFolder(projectRootFolder) {
        var imagesFolder = new Folder(projectRootFolder.fsName + "/" + IMAGES_RELATIVE_PATH);
        if (imagesFolder.exists) {
            return imagesFolder;
        }

        return new Folder(projectRootFolder.fsName + "/" + ASSETS_RELATIVE_PATH);
    }

    function buildFileIndex(rootFolder) {
        var index = {
            exact: {},
            loose: {},
            extension: {}
        };

        indexFilesRecursive(rootFolder, index);
        return index;
    }

    function buildPlacedEntries(documentRef) {
        var manifestRefs = readManifestReferences(documentRef);
        var entries = [];
        var i;

        for (i = 0; i < documentRef.placedItems.length; i += 1) {
            entries.push({
                item: documentRef.placedItems[i],
                manifestRef: i < manifestRefs.length ? manifestRefs[i] : null
            });
        }

        return entries;
    }

    function readManifestReferences(documentRef) {
        var refs = [];
        var xmp;
        var count;
        var i;
        var xpath;
        var prop;

        ensureXmpLibrary();
        xmp = new XMPMeta(documentRef.XMPString);
        count = xmp.countArrayItems(XMPConst.NS_XMP_MM, "Manifest");

        for (i = 1; i <= count; i += 1) {
            xpath = "xmpMM:Manifest[" + i + "]/stMfs:reference/stRef:filePath";
            prop = xmp.getProperty(XMPConst.NS_XMP_MM, xpath);

            if (prop && prop.value) {
                refs.push(createManifestReference(prop.value));
            }
        }

        return refs;
    }

    function ensureXmpLibrary() {
        if (ExternalObject.AdobeXMPScript === undefined) {
            ExternalObject.AdobeXMPScript = new ExternalObject("lib:AdobeXMPScript");
        }
    }

    function createManifestReference(rawPath) {
        var fileRef = new File(rawPath);

        return {
            rawPath: rawPath,
            file: fileRef,
            fileName: decodeFileName(fileRef.name || rawPath)
        };
    }

    function indexFilesRecursive(folderRef, index) {
        var children = folderRef.getFiles();
        var i;
        var exactKey;
        var looseKey;
        var extKey;

        for (i = 0; i < children.length; i += 1) {
            if (children[i] instanceof Folder) {
                indexFilesRecursive(children[i], index);
            } else if (children[i] instanceof File) {
                exactKey = normalizeKey(children[i].name);
                looseKey = buildLooseKey(children[i].name);
                extKey = getExtensionKey(children[i].name);

                pushIndexedFile(index.exact, exactKey, children[i]);
                pushIndexedFile(index.loose, looseKey, children[i]);
                pushIndexedFile(index.extension, extKey, children[i]);
            }
        }
    }

    function pushIndexedFile(bucket, key, fileRef) {
        if (!key) {
            return;
        }

        if (!bucket[key]) {
            bucket[key] = [];
        }

        if (containsFile(bucket[key], fileRef)) {
            return;
        }

        bucket[key].push(fileRef);
    }

    function containsFile(items, fileRef) {
        var i;
        for (i = 0; i < items.length; i += 1) {
            if (items[i].fsName === fileRef.fsName) {
                return true;
            }
        }

        return false;
    }

    function relinkPlacedItem(entry, index, relinkedList, missingList, ambiguousList, errorList) {
        var placedItem = entry.item;
        var sourceFile;
        var lookupName;
        var matches;

        try {
            sourceFile = placedItem.file;
        } catch (err1) {
            sourceFile = null;
        }

        lookupName = sourceFile ? decodeFileName(sourceFile.name) : getManifestFileName(entry.manifestRef);

        if (!lookupName) {
            errorList.push(describePlacedItem(placedItem) + " (no filename available for relink)");
            return;
        }

        matches = resolveMatches(index, lookupName);

        if (matches.length === 1) {
            var restoreState;

            try {
                restoreState = unlockForRelink(placedItem);
                placedItem.relink(matches[0]);
                relinkedList.push(lookupName + " -> " + matches[0].fsName);
            } catch (err2) {
                errorList.push(lookupName + " (relink failed: " + err2 + ")");
            } finally {
                restoreUnlockedState(restoreState);
            }
            return;
        }

        if (matches.length > 1) {
            ambiguousList.push(lookupName);
            return;
        }

        missingList.push(lookupName);
    }

    function getManifestFileName(manifestRef) {
        if (!manifestRef) {
            return "";
        }

        return manifestRef.fileName || "";
    }

    function unlockForRelink(item) {
        var state = [];
        var current = item;

        while (current) {
            state.push(captureObjectState(current));
            prepareObjectForRelink(current);
            current = getUnlockableParent(current);
        }

        return state;
    }

    function captureObjectState(obj) {
        return {
            ref: obj,
            locked: readProperty(obj, "locked"),
            hidden: readProperty(obj, "hidden"),
            visible: readProperty(obj, "visible")
        };
    }

    function prepareObjectForRelink(obj) {
        writeProperty(obj, "locked", false);
        writeProperty(obj, "hidden", false);
        writeProperty(obj, "visible", true);
    }

    function restoreUnlockedState(state) {
        var i;
        var entry;

        if (!state) {
            return;
        }

        for (i = 0; i < state.length; i += 1) {
            entry = state[i];
            writeProperty(entry.ref, "visible", entry.visible);
            writeProperty(entry.ref, "hidden", entry.hidden);
            writeProperty(entry.ref, "locked", entry.locked);
        }
    }

    function getUnlockableParent(obj) {
        if (!obj || !obj.parent) {
            return null;
        }

        if (obj.parent.typename === "Document") {
            return null;
        }

        return obj.parent;
    }

    function readProperty(obj, propertyName) {
        try {
            return obj[propertyName];
        } catch (ignore) {
            return undefined;
        }
    }

    function writeProperty(obj, propertyName, value) {
        if (typeof value === "undefined") {
            return;
        }

        try {
            obj[propertyName] = value;
        } catch (ignore) {}
    }

    function describePlacedItem(placedItem) {
        try {
            if (placedItem.name) {
                return placedItem.name;
            }
        } catch (ignore) {}

        return "[unnamed placed item]";
    }

    function normalizeKey(value) {
        return extractFileName(value).toLowerCase();
    }

    function decodeFileName(value) {
        try {
            return decodeURI(String(value));
        } catch (ignore) {
            return String(value);
        }
    }

    function extractFileName(value) {
        var decoded = decodeFileName(value);
        var parts = decoded.split(/[\/\\]/);
        return parts[parts.length - 1];
    }

    function buildLooseKey(value) {
        var fileName = extractFileName(value);
        var ext = getExtensionKey(fileName);
        var stem;

        if (!fileName) {
            return "";
        }

        stem = fileName.replace(/\.[^\.]+$/, "");
        stem = stem.toLowerCase();
        stem = stem.replace(/%20/g, " ");
        stem = stem.replace(/[\s\-_()]+/g, "");
        stem = stem.replace(/[^a-z0-9]/g, "");
        return stem + "|" + ext;
    }

    function getExtensionKey(value) {
        var fileName = extractFileName(value);
        var match = /\.([^.]+)$/.exec(fileName);

        if (!match) {
            return "";
        }

        return match[1].toLowerCase();
    }

    function resolveMatches(index, lookupName) {
        var exactMatches = index.exact[normalizeKey(lookupName)] || [];
        var looseMatches;
        var extMatches;

        if (exactMatches.length > 0) {
            return exactMatches;
        }

        looseMatches = index.loose[buildLooseKey(lookupName)] || [];
        if (looseMatches.length > 0) {
            return looseMatches;
        }

        extMatches = index.extension[getExtensionKey(lookupName)] || [];
        if (extMatches.length === 1) {
            return extMatches;
        }

        return [];
    }

    function buildSummary(projectFolder, targetAssetsFolder, relinkedList, missingList, ambiguousList, errorList, placedCount) {
        var lines = [];

        lines.push("Project root: " + projectFolder.fsName);
        lines.push("Assets folder: " + targetAssetsFolder.fsName);
        lines.push("Placed entries seen: " + placedCount);
        lines.push("Log: " + projectFolder.fsName + "/" + LOG_FILE_NAME);
        lines.push("");
        lines.push("Relinked: " + relinkedList.length);
        if (relinkedList.length > 0) {
            lines = lines.concat(limitList(relinkedList, 12));
        }

        lines.push("");
        lines.push("Missing matches: " + missingList.length);
        if (missingList.length > 0) {
            lines = lines.concat(limitList(missingList, 12));
        }

        lines.push("");
        lines.push("Ambiguous matches: " + ambiguousList.length);
        if (ambiguousList.length > 0) {
            lines = lines.concat(limitList(ambiguousList, 12));
        }

        lines.push("");
        lines.push("Errors: " + errorList.length);
        if (errorList.length > 0) {
            lines = lines.concat(limitList(errorList, 12));
        }

        return lines.join("\n");
    }

    function writeLog(logFileRef, text) {
        if (!logFileRef) {
            return;
        }

        try {
            logFileRef.encoding = "UTF-8";
            logFileRef.lineFeed = "Unix";
            logFileRef.open("w");
            logFileRef.write(text);
            logFileRef.close();
        } catch (ignore) {
            try {
                if (logFileRef.opened) {
                    logFileRef.close();
                }
            } catch (ignoreClose) {}
        }
    }

    function limitList(items, maxCount) {
        var lines = [];
        var count = Math.min(items.length, maxCount);
        var i;

        for (i = 0; i < count; i += 1) {
            lines.push("- " + items[i]);
        }

        if (items.length > maxCount) {
            lines.push("- ...and " + (items.length - maxCount) + " more");
        }

        return lines;
    }
}());
