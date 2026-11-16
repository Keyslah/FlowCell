; A screenshot destination belongs to the owned Button, never its panel.
class FlowCellTempShotsSettings {
    static OwnerId(launcherPath) {
        SplitPath launcherPath, , &sourceDirectory
        SplitPath sourceDirectory, &sourceName, &packageDirectory
        if StrLower(sourceName) != "source"
            return ""
        installPath := packageDirectory "\flowcell.install.json"
        if !FileExist(installPath)
            return ""
        try {
            install := FileRead(installPath, "UTF-8")
            if RegExMatch(install, '"ownerButtonId"\s*:\s*"([A-Za-z0-9_-]{1,128})"', &match)
                return match[1]
        }
        return ""
    }

    static FolderCachePath(launcherPath, localRoot) {
        root := RTrim(localRoot, "\/") "\windows\temp-shots"
        owner := launcherPath != "" ? this.OwnerId(launcherPath) : ""
        if owner = ""
            return root "\temp-shots.folder.txt"
        cache := RTrim(localRoot, "\/") "\button-inputs\" owner ".json"
        if FileExist(cache) || SubStr(owner, 1, 16) != "button-migrated-"
            return cache
        ; Preserve the original migrated Button's already selected destination.
        return root "\temp-shots.folder.txt"
    }

    static ReadFolder(launcherPath, localRoot) {
        cache := this.FolderCachePath(launcherPath, localRoot)
        try {
            raw := FileRead(cache, "UTF-8")
            if RegExMatch(cache, "i)\.json$") {
                if !RegExMatch(raw, '"configured"\s*:\s*true')
                    return ""
                folder := JsonStringValue(raw, "folder")
            } else {
                folder := Trim(raw, "`r`n`t " Chr(0xFEFF))
            }
            return folder != "" && DirExist(folder) ? folder : ""
        }
        return ""
    }
}
