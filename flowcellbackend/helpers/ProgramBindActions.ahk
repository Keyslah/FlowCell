; Package-declared bind-only actions. Metadata is data; no package AHK is included.
class ProgramBindActions {
    static ReadDeclaration(path, maximumBytes := 65536) {
        if FileGetSize(path) > maximumBytes
            throw Error("Package declaration exceeds its size limit.")
        bytes := FileRead(path, "RAW")
        if bytes.Size > maximumBytes
            throw Error("Package declaration changed beyond its size limit.")
        loop bytes.Size {
            if NumGet(bytes, A_Index - 1, "UChar") = 0
                throw Error("Package declarations must not contain NUL bytes.")
        }
        text := StrGet(bytes, bytes.Size, "UTF-8")
        return SubStr(text, 1, 1) = Chr(0xFEFF) ? SubStr(text, 2) : text
    }

    static ResolveFile(root, relative) {
        if relative = "" || relative != Trim(relative) || StrLen(relative) > 1024
            throw Error("A package action requires a plain relative file path.")
        relative := StrReplace(relative, "/", "\")
        for part in StrSplit(relative, "\") {
            if part = "" || part = "." || part = ".." || RegExMatch(part, '[\x00-\x1f\x7f<>:"|?*\[\]]')
                || RegExMatch(part, "[. ]$")
                throw Error("A package action file escapes its program package or has an unsafe name.")
        }
        path := FlowCellBackendIdentity.NormalizeRoot(root) "\" relative
        cursor := path
        loop {
            attributes := DllCall("GetFileAttributesW", "Str", cursor, "UInt")
            if attributes = 0xFFFFFFFF || (attributes & 0x400)
                throw Error("A package action file is missing or uses a reparse point.", , cursor)
            SplitPath cursor, , &parent
            if parent = "" || parent = cursor
                break
            cursor := parent
        }
        if InStr(FileExist(path), "D")
            throw Error("A package action source must be a file.")
        return path
    }

    static Parse(contents) {
        if StrPut(contents, "UTF-8") - 1 > 65536
            throw Error("Package bind action declarations exceed 64 KiB.")
        sections := Map()
        sectionNames := Map()
        current := ""
        for raw in StrSplit(StrReplace(contents, "`r", ""), "`n") {
            line := Trim(raw)
            if line = "" || SubStr(line, 1, 1) = ";" || SubStr(line, 1, 1) = "#"
                continue
            if RegExMatch(line, "^\[(.+)\]$", &match) {
                current := match[1]
                if sectionNames.Has(StrLower(current))
                    throw Error("Duplicate package bind action section.")
                sectionNames[StrLower(current)] := true
                sections[current] := Map()
                continue
            }
            separator := InStr(line, "=")
            if !sections.Has(current) || separator <= 1
                throw Error("Invalid package bind action declaration.")
            key := Trim(SubStr(line, 1, separator - 1))
            value := Trim(SubStr(line, separator + 1))
            if key = "" || RegExMatch(value, "[\x00-\x1f\x7f]")
                throw Error("Invalid package bind action value.")
            for existingKey, _ in sections[current] {
                if StrLower(existingKey) = StrLower(key)
                    throw Error("Duplicate package bind action field.")
            }
            sections[current][key] := value
        }
        if !sections.Has("Meta") || sections["Meta"].Count != 1
            || !sections["Meta"].Has("SchemaVersion") || sections["Meta"]["SchemaVersion"] != "1"
            throw Error("Package bind actions require SchemaVersion=1.")
        sections.Delete("Meta")
        if sections.Count > 64
            throw Error("Program packages permit at most 64 bind actions.")
        allowed := Map("Label", true, "Panel", true, "Source", true, "PassThrough", true,
            "SuccessReturnValue", true, "SuccessNote", true, "FailureNote", true)
        actions := []
        for section, fields in sections {
            if !RegExMatch(section, "^Action_([A-Za-z0-9_.-]{1,128})$", &match)
                throw Error("Invalid package bind action ID.")
            for key, value in fields {
                if !allowed.Has(key) || value = ""
                    throw Error("Unknown or empty package bind action field.")
            }
            for key, _ in allowed {
                if !fields.Has(key)
                    throw Error("Missing package bind action field.", , key)
            }
            if fields["PassThrough"] != "0" && fields["PassThrough"] != "1"
                throw Error("Package actions require PassThrough=0 or PassThrough=1.")
            if !RegExMatch(fields["Source"], "i)\.(jsx|js)$")
                throw Error("Foreground package actions require a direct host script.")
            if RegExMatch(fields["Panel"], '[\x00-\x1f\x7f<>:"/\\|?*]')
                || fields["Panel"] = "." || fields["Panel"] = ".." || RegExMatch(fields["Panel"], "[. ]$")
                throw Error("Invalid package bind action panel.")
            actions.Push({ id: match[1], fields: fields })
        }
        return actions
    }

    static Load(app) {
        global flowCellProgramsRoot, flowCellBindingsPath
        actions := []
        ids := Map()
        duplicates := Map()
        if !FileExist(flowCellBindingsPath)
            return actions
        for section in StrSplit(IniRead(flowCellBindingsPath), "`n", "`r") {
            if !RegExMatch(section, "^ProgramTab_([1-9][0-9]*)$", &match)
                continue
            try {
                config := app.GetProgramTabConfig(Integer(match[1]))
                if config.label = "" || RegExMatch(config.label, "[/\\]") || config.processNames.Length = 0
                    continue
                root := FlowCellBackendIdentity.NormalizeRoot(flowCellProgramsRoot) "\" config.label
                manifest := this.ResolveFile(flowCellProgramsRoot, config.label "\flowcell.program.json")
                if FileGetSize(manifest) > 8388608
                    throw Error("Program manifest is too large.")
                relative := JsonStringValue(this.ReadDeclaration(manifest, 8388608), "bindActionsFile")
                if relative = ""
                    continue
                if !RegExMatch(config.runMethod, "i)^(illustrator|illustrator_automation|illustrator_direct|illustrator_process|photoshop|photoshop_direct)$")
                    throw Error("Foreground package bind actions require a direct script runner.")
                declaration := this.ResolveFile(root, relative)
                if FileGetSize(declaration) > 65536
                    throw Error("Package bind action declarations exceed 64 KiB.")
                pending := []
                for entry in this.Parse(this.ReadDeclaration(declaration)) {
                    this.ResolveFile(root, entry.fields["Source"])
                    pending.Push(ProgramBindAction(app, config, root, relative, entry))
                }
                for action in pending {
                    key := StrLower(action.Id)
                    if ids.Has(key)
                        duplicates[key] := true
                    ids[key] := true
                    actions.Push(action)
                }
            } catch as err {
                app.logger.Warn("Package bind actions were not loaded. Section=" section " | Error=" err.Message)
            }
        }
        unique := []
        for action in actions {
            if !duplicates.Has(StrLower(action.Id))
                unique.Push(action)
        }
        return unique
    }
}

class ProgramBindAction {
    __New(app, config, root, declaration, entry) {
        this.app := app
        this.config := config
        this.root := root
        this.declaration := declaration
        this.fields := entry.fields
        this.Id := entry.id
        this.Label := entry.fields["Label"]
        this.RequiresExactLayersScan := false
        this.RunFromHotkeyDirect := true
        this.PassThroughHotkey := entry.fields["PassThrough"] = "1"
        this.HotIfCallback := ObjBindMethod(this, "IsForeground")
    }

    IsForeground(*) {
        global flowCellBindingsPath
        try {
            if IniRead(flowCellBindingsPath, "ProgramTab_" this.config.id, "Label", "") != this.config.label
                return false
            if !FileExist(this.root "\flowcell.program.json") || !FileExist(this.root "\" this.declaration)
                return false
            processName := StrLower(WinGetProcessName("A"))
            for name in this.config.processNames {
                name := StrLower(Trim(name))
                if !RegExMatch(name, "\.exe$")
                    name .= ".exe"
                if processName = name
                    return true
            }
        } catch {
        }
        return false
    }

    Run(scanResult) {
        if !this.IsForeground()
            throw Error("The owning program must be foreground to use this package action.")
        ProgramBindActions.ResolveFile(this.root, "flowcell.program.json")
        ProgramBindActions.ResolveFile(this.root, this.declaration)
        source := ProgramBindActions.ResolveFile(this.root, this.fields["Source"])
        ; Same-thread direct dispatch preserves the selection belonging to this keypress.
        result := this.app.RunBoundScript(source, this.Label, this.config.id, this.config.label, true)
        confirmed := result.succeeded && result.HasOwnProp("returnValue")
            && result.returnValue == this.fields["SuccessReturnValue"]
        return {
            attempted: result.attempted,
            deliverySucceeded: result.succeeded,
            effectConfirmed: confirmed,
            method: result.method,
            detail: result.detail,
            note: confirmed ? this.fields["SuccessNote"] : this.fields["FailureNote"]
        }
    }
}
