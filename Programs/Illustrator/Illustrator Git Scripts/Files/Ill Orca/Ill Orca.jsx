#target illustrator

(function () {
    var TARGET_BUNDLED_SOURCE_ID = "illustrator.send-svg-to-blender";
    var POST_ACTION = "orca";
    var PROGRAM_MANIFEST_NAME = "flowcell.program.json";
    var SOURCE_MANIFEST_NAME = "flowcell.script.json";
    var ACTIVE_RECORD_SUFFIX = ".flowcell-source.json";

    function fail(message) {
        throw new Error("Ill Orca: " + message);
    }

    function safeString(value) {
        try {
            return String(value);
        } catch (ignore) {
            return "";
        }
    }

    function trim(value) {
        return safeString(value).replace(/^\s+|\s+$/g, "");
    }

    function isArray(value) {
        return value instanceof Array;
    }

    function isObject(value) {
        return value !== null && typeof value === "object" && !isArray(value);
    }

    function readText(fileRef, label) {
        var text = "";

        if (!fileRef || !fileRef.exists) {
            fail(label + " was not found.");
        }
        fileRef.encoding = "UTF-8";
        if (!fileRef.open("r")) {
            fail(label + " could not be opened.");
        }
        try {
            text = fileRef.read();
        } finally {
            fileRef.close();
        }
        if (text.length > 0 && text.charCodeAt(0) === 0xFEFF) {
            text = text.substring(1);
        }
        return text;
    }

    function parseJsonFallback(text, label) {
        var index = 0;

        function parseFailure(message) {
            fail(label + " is invalid JSON at character " + index + ": " + message);
        }

        function skipWhitespace() {
            while (index < text.length && /\s/.test(text.charAt(index))) {
                index += 1;
            }
        }

        function parseString() {
            var result = "";
            var character;
            var escape;
            var hex;

            if (text.charAt(index) !== '"') {
                parseFailure("expected a string");
            }
            index += 1;
            while (index < text.length) {
                character = text.charAt(index);
                index += 1;
                if (character === '"') {
                    return result;
                }
                if (character === "\\") {
                    if (index >= text.length) {
                        parseFailure("unterminated escape");
                    }
                    escape = text.charAt(index);
                    index += 1;
                    if (escape === '"' || escape === "\\" || escape === "/") {
                        result += escape;
                    } else if (escape === "b") {
                        result += "\b";
                    } else if (escape === "f") {
                        result += "\f";
                    } else if (escape === "n") {
                        result += "\n";
                    } else if (escape === "r") {
                        result += "\r";
                    } else if (escape === "t") {
                        result += "\t";
                    } else if (escape === "u") {
                        hex = text.substring(index, index + 4);
                        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
                            parseFailure("invalid unicode escape");
                        }
                        result += String.fromCharCode(parseInt(hex, 16));
                        index += 4;
                    } else {
                        parseFailure("invalid escape");
                    }
                } else {
                    if (character.charCodeAt(0) < 0x20) {
                        parseFailure("control character in string");
                    }
                    result += character;
                }
            }
            parseFailure("unterminated string");
        }

        function parseNumber() {
            var match = text.substring(index).match(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+\-]?[0-9]+)?/);
            if (!match) {
                parseFailure("invalid number");
            }
            index += match[0].length;
            return Number(match[0]);
        }

        function parseArray() {
            var result = [];
            index += 1;
            skipWhitespace();
            if (text.charAt(index) === "]") {
                index += 1;
                return result;
            }
            while (index < text.length) {
                result.push(parseValue());
                skipWhitespace();
                if (text.charAt(index) === "]") {
                    index += 1;
                    return result;
                }
                if (text.charAt(index) !== ",") {
                    parseFailure("expected ',' or ']'");
                }
                index += 1;
                skipWhitespace();
            }
            parseFailure("unterminated array");
        }

        function parseObject() {
            var result = {};
            var key;

            index += 1;
            skipWhitespace();
            if (text.charAt(index) === "}") {
                index += 1;
                return result;
            }
            while (index < text.length) {
                if (text.charAt(index) !== '"') {
                    parseFailure("expected an object key");
                }
                key = parseString();
                if (key === "__proto__" || key === "constructor" || key === "prototype") {
                    parseFailure("reserved object key");
                }
                skipWhitespace();
                if (text.charAt(index) !== ":") {
                    parseFailure("expected ':'");
                }
                index += 1;
                result[key] = parseValue();
                skipWhitespace();
                if (text.charAt(index) === "}") {
                    index += 1;
                    return result;
                }
                if (text.charAt(index) !== ",") {
                    parseFailure("expected ',' or '}'");
                }
                index += 1;
                skipWhitespace();
            }
            parseFailure("unterminated object");
        }

        function parseValue() {
            var character;

            skipWhitespace();
            character = text.charAt(index);
            if (character === '"') {
                return parseString();
            }
            if (character === "{") {
                return parseObject();
            }
            if (character === "[") {
                return parseArray();
            }
            if (text.substr(index, 4) === "true") {
                index += 4;
                return true;
            }
            if (text.substr(index, 5) === "false") {
                index += 5;
                return false;
            }
            if (text.substr(index, 4) === "null") {
                index += 4;
                return null;
            }
            if (character === "-" || /[0-9]/.test(character)) {
                return parseNumber();
            }
            parseFailure("expected a value");
        }

        var result = parseValue();
        skipWhitespace();
        if (index !== text.length) {
            parseFailure("unexpected trailing content");
        }
        return result;
    }

    function parseJson(text, label) {
        if (typeof JSON !== "undefined" && JSON && typeof JSON.parse === "function") {
            try {
                return JSON.parse(text);
            } catch (ignoreNativeJsonError) {
                fail(label + " is invalid JSON.");
            }
        }
        return parseJsonFallback(text, label);
    }

    function readJson(fileRef, label) {
        return parseJson(readText(fileRef, label), label);
    }

    function validateRelativePath(value, label) {
        var candidate = trim(value);
        var parts;
        var i;

        if (!candidate || /^[\\\/]/.test(candidate) || /^[A-Za-z]:/.test(candidate)) {
            fail(label + " must be a relative path.");
        }
        parts = candidate.replace(/\\/g, "/").split("/");
        for (i = 0; i < parts.length; i += 1) {
            if (!parts[i] || parts[i] === "." || parts[i] === "..") {
                fail(label + " contains an unsafe path segment.");
            }
        }
        return parts.join("/");
    }

    function normalizePath(value) {
        return safeString(value).replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
    }

    function samePath(left, right) {
        return normalizePath(left.fsName) === normalizePath(right.fsName);
    }

    function isInsidePath(child, parent) {
        var childPath = normalizePath(child.fsName);
        var parentPath = normalizePath(parent.fsName);
        return childPath.indexOf(parentPath + "\\") === 0;
    }

    function getGlobalHost() {
        try {
            if (typeof $ !== "undefined" && $.global) {
                return $.global;
            }
        } catch (ignoreGlobalHost) {
        }
        return this;
    }

    function owns(object, key) {
        return Object.prototype.hasOwnProperty.call(object, key);
    }

    function currentWrapperFile(globalHost) {
        var injectedPath = "";
        var injectedFile;
        var fallbackFile;

        if (globalHost && owns(globalHost, "FLOWCELL_SCRIPT_PATH")) {
            injectedPath = trim(globalHost.FLOWCELL_SCRIPT_PATH);
        }
        if (injectedPath) {
            injectedFile = new File(injectedPath);
            if (!injectedFile.exists) {
                fail("the injected wrapper source path does not exist: " + injectedFile.fsName);
            }
            return injectedFile;
        }

        fallbackFile = new File($.fileName);
        if (!fallbackFile.exists) {
            fail("the wrapper source path could not be resolved.");
        }
        return fallbackFile;
    }

    function findProgramRoot(wrapperFile) {
        var current = wrapperFile.parent;
        var manifest;
        var parent;
        var depth;

        for (depth = 0; depth < 16 && current; depth += 1) {
            manifest = new File(current.fsName + "/" + PROGRAM_MANIFEST_NAME);
            if (manifest.exists) {
                return current;
            }
            parent = current.parent;
            if (!parent || samePath(parent, current)) {
                break;
            }
            current = parent;
        }
        fail("the Illustrator program root could not be resolved from the installed wrapper.");
    }

    function readProgramManifest(programRoot) {
        var manifest = readJson(
            new File(programRoot.fsName + "/" + PROGRAM_MANIFEST_NAME),
            "Illustrator program manifest"
        );

        if (!isObject(manifest) ||
                manifest.schemaVersion !== 1 ||
                trim(manifest.programId).toLowerCase() !== "illustrator" ||
                trim(manifest.label).toLowerCase() !== "illustrator") {
            fail("the resolved program manifest is not Illustrator.");
        }
        validateRelativePath(manifest.panelsFolder, "panelsFolder");
        validateRelativePath(manifest.localScriptsFolder, "localScriptsFolder");
        return manifest;
    }

    function collectActiveRecordFiles(folderRef, records, depth) {
        var entries;
        var entry;
        var name;
        var i;

        if (depth > 16) {
            fail("the Illustrator Panels tree is too deep to inspect safely.");
        }
        try {
            entries = folderRef.getFiles();
        } catch (recordListError) {
            fail("the Illustrator Panels tree could not be inspected.");
        }

        for (i = 0; i < entries.length; i += 1) {
            entry = entries[i];
            if (entry instanceof Folder) {
                collectActiveRecordFiles(entry, records, depth + 1);
            } else if (entry instanceof File) {
                name = safeString(entry.name).toLowerCase();
                if (name.slice(-ACTIVE_RECORD_SUFFIX.length) === ACTIVE_RECORD_SUFFIX) {
                    records.push(entry);
                }
            }
        }
    }

    function validateOwnerId(value) {
        var ownerId = trim(value);
        if (!ownerId || ownerId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(ownerId)) {
            fail("the Send SVG active record has an invalid ownerButtonId.");
        }
        return ownerId;
    }

    function validateTargetRecord(recordFile, record, programRoot, programManifest) {
        var ownerId;
        var localScriptsRoot;
        var packageFolder;
        var expectedPackageFolder;
        var sourceRoot;
        var sourceFile;
        var sourceManifest;
        var declaredSource;
        var expectedSourceFile;

        if (!isObject(record) ||
                record.schemaVersion !== 1 ||
                trim(record.programId).toLowerCase() !== "illustrator" ||
                trim(record.programName).toLowerCase() !== "illustrator" ||
                trim(record.kind).toLowerCase() !== "script" ||
                trim(record.bundledSourceId).toLowerCase() !== TARGET_BUNDLED_SOURCE_ID) {
            fail("the Send SVG active record has an invalid generic script contract.");
        }

        ownerId = validateOwnerId(record.ownerButtonId);
        if (trim(record.installId) !== ownerId) {
            fail("the Send SVG active record has mismatched owner identifiers.");
        }
        if (safeString(recordFile.name).toLowerCase() !==
                (ownerId + ACTIVE_RECORD_SUFFIX).toLowerCase()) {
            fail("the Send SVG active record filename does not match its owner.");
        }

        localScriptsRoot = new Folder(
            programRoot.fsName + "/" +
            validateRelativePath(programManifest.localScriptsFolder, "localScriptsFolder")
        );
        packageFolder = new Folder(
            programRoot.fsName + "/" +
            validateRelativePath(record.localPackagePath, "localPackagePath")
        );
        expectedPackageFolder = new Folder(localScriptsRoot.fsName + "/" + ownerId);
        if (!localScriptsRoot.exists ||
                !packageFolder.exists ||
                !samePath(packageFolder, expectedPackageFolder) ||
                !samePath(packageFolder.parent, localScriptsRoot)) {
            fail("the Send SVG owner package is outside Illustrator Local Scripts.");
        }

        sourceRoot = new Folder(packageFolder.fsName + "/source");
        sourceFile = new File(
            programRoot.fsName + "/" +
            validateRelativePath(record.sourcePath, "sourcePath")
        );
        if (!sourceRoot.exists || !sourceFile.exists || !isInsidePath(sourceFile, sourceRoot)) {
            fail("the Send SVG source is outside its installed owner package.");
        }

        sourceManifest = readJson(
            new File(sourceRoot.fsName + "/" + SOURCE_MANIFEST_NAME),
            "installed Send SVG source manifest"
        );
        if (!isObject(sourceManifest) ||
                sourceManifest.schemaVersion !== 1 ||
                trim(sourceManifest.id).toLowerCase() !== TARGET_BUNDLED_SOURCE_ID ||
                trim(sourceManifest.program).toLowerCase() !== "illustrator") {
            fail("the installed Send SVG source manifest has the wrong package identity.");
        }
        declaredSource = validateRelativePath(sourceManifest.source, "Send SVG manifest source");
        expectedSourceFile = new File(sourceRoot.fsName + "/" + declaredSource);
        if (!expectedSourceFile.exists || !samePath(sourceFile, expectedSourceFile)) {
            fail("the Send SVG active source does not match its installed package manifest.");
        }

        return sourceFile;
    }

    function resolveInstalledSendSvgSource(globalHost) {
        var wrapperFile = currentWrapperFile(globalHost);
        var programRoot = findProgramRoot(wrapperFile);
        var programManifest = readProgramManifest(programRoot);
        var panelsFolder = new Folder(
            programRoot.fsName + "/" +
            validateRelativePath(programManifest.panelsFolder, "panelsFolder")
        );
        var recordFiles = [];
        var candidates = [];
        var record;
        var i;

        if (!panelsFolder.exists) {
            fail("the Illustrator Panels folder was not found.");
        }
        collectActiveRecordFiles(panelsFolder, recordFiles, 0);
        for (i = 0; i < recordFiles.length; i += 1) {
            record = readJson(recordFiles[i], "Illustrator active source record");
            if (isObject(record) &&
                    trim(record.bundledSourceId).toLowerCase() === TARGET_BUNDLED_SOURCE_ID) {
                candidates.push({ file: recordFiles[i], record: record });
            }
        }

        if (candidates.length === 0) {
            fail("the installed Send SVG to Blender owner was not found. Add or update that Button first.");
        }
        if (candidates.length > 1) {
            fail("more than one active Send SVG to Blender owner was found. Resolve the duplicate owners first.");
        }

        return validateTargetRecord(
            candidates[0].file,
            candidates[0].record,
            programRoot,
            programManifest
        );
    }

    function restoreGlobal(globalHost, key, existed, value) {
        if (existed) {
            globalHost[key] = value;
            return;
        }
        try {
            delete globalHost[key];
        } catch (ignoreDelete) {
            globalHost[key] = undefined;
        }
    }

    function delegateToInstalledSendSvg(sourceFile, globalHost) {
        var hadScriptPath = owns(globalHost, "FLOWCELL_SCRIPT_PATH");
        var previousScriptPath = globalHost.FLOWCELL_SCRIPT_PATH;
        var hadPostAction = owns(globalHost, "FLOWCELL_SEND_SVG_POST_ACTION");
        var previousPostAction = globalHost.FLOWCELL_SEND_SVG_POST_ACTION;

        try {
            globalHost.FLOWCELL_SCRIPT_PATH = sourceFile.fsName;
            globalHost.FLOWCELL_SEND_SVG_POST_ACTION = POST_ACTION;
            return $.evalFile(sourceFile);
        } finally {
            restoreGlobal(globalHost, "FLOWCELL_SEND_SVG_POST_ACTION", hadPostAction, previousPostAction);
            restoreGlobal(globalHost, "FLOWCELL_SCRIPT_PATH", hadScriptPath, previousScriptPath);
        }
    }

    var globalHost = getGlobalHost();
    if (globalHost && globalHost.__FLOWCELL_ILL_ORCA_TEST__ === true) {
        globalHost.__FLOWCELL_ILL_ORCA_TEST_API__ = {
            delegateToInstalledSendSvg: delegateToInstalledSendSvg,
            parseJsonFallback: parseJsonFallback
        };
        return;
    }

    return delegateToInstalledSendSvg(
        resolveInstalledSendSvgSource(globalHost),
        globalHost
    );
}());
