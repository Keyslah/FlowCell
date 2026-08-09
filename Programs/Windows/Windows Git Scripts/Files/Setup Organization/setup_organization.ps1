[CmdletBinding()]
param(
    [Parameter()]
    [string]$FlowCellCapability = '',

    [Parameter()]
    [string]$ArgsJson = '{}'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:CapabilityId = 'windows.setup-organization'
$script:ProfileFormat = 'flowcell.windows.setup-organization.profile.v3'
$script:FileGroupsFormat = 'flowcell.windows.setup-organization.custom-file-groups.v1'
$script:StageFormat = 'flowcell.windows.setup-organization.stage.v1'
$script:MaximumFolders = 5000
$script:DefaultFolderCap = 12

function Write-JsonResponse {
    param([Parameter(Mandatory = $true)]$Value)

    $json = $Value | ConvertTo-Json -Depth 16 -Compress
    [Console]::Out.WriteLine($json)
}

function Test-ObjectProperty {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Name
    )

    return $null -ne $Object.PSObject.Properties[$Name]
}

function Assert-ObjectProperties {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string[]]$Allowed,
        [Parameter(Mandatory = $true)][string[]]$Required,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if ($null -eq $Object -or $Object -is [string] -or $Object -is [System.Array]) {
        throw "$Label must be an object."
    }
    foreach ($property in @($Object.PSObject.Properties.Name)) {
        if ($Allowed -notcontains $property) {
            throw "$Label contains unsupported property '$property'."
        }
    }
    foreach ($property in $Required) {
        if (-not (Test-ObjectProperty -Object $Object -Name $property)) {
            throw "$Label is missing required property '$property'."
        }
    }
}

function Get-RequiredString {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Label,
        [int]$MaximumLength = 260,
        [switch]$AllowEmpty
    )

    if (-not (Test-ObjectProperty -Object $Object -Name $Name) -or $Object.$Name -isnot [string]) {
        throw "$Label.$Name must be a string."
    }
    $value = ([string]$Object.$Name).Trim()
    if (-not $AllowEmpty -and [string]::IsNullOrWhiteSpace($value)) {
        throw "$Label.$Name cannot be empty."
    }
    if ($value.Length -gt $MaximumLength) {
        throw "$Label.$Name cannot exceed $MaximumLength characters."
    }
    return $value
}

function Get-RequiredBoolean {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if (-not (Test-ObjectProperty -Object $Object -Name $Name) -or $Object.$Name -isnot [bool]) {
        throw "$Label.$Name must be a boolean."
    }
    return [bool]$Object.$Name
}

function ConvertFrom-ExtendedWindowsPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ($Path.StartsWith('\\?\UNC\', [System.StringComparison]::OrdinalIgnoreCase)) {
        return '\\' + $Path.Substring(8)
    }
    if ($Path.StartsWith('\\?\', [System.StringComparison]::OrdinalIgnoreCase)) {
        return $Path.Substring(4)
    }
    return $Path
}

function Resolve-FlowCellRoot {
    $current = ConvertFrom-ExtendedWindowsPath -Path ([System.IO.Path]::GetFullPath($PSScriptRoot))
    while (-not [string]::IsNullOrWhiteSpace($current)) {
        $backend = Join-Path $current 'flowcellbackend'
        $windowsProgram = Join-Path $current 'Programs\Windows'
        if ((Test-Path -LiteralPath $backend -PathType Container) -and
            (Test-Path -LiteralPath $windowsProgram -PathType Container)) {
            return $current
        }
        $parent = Split-Path -Parent $current
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current) {
            break
        }
        $current = $parent
    }
    throw 'Could not locate the FlowCell root from the installed Button source.'
}

function Get-ProgramDataRoot {
    $flowCellRoot = Resolve-FlowCellRoot
    return Join-Path $flowCellRoot 'flowcellbackend\local\program-data\windows\setup-organization'
}

function Get-ProfilesRoot { return Join-Path (Get-ProgramDataRoot) 'profiles' }
function Get-StagingRoot { return Join-Path (Get-ProgramDataRoot) 'staging' }
function Get-FileGroupsPath { return Join-Path (Get-ProgramDataRoot) 'file-groups.json' }

function Assert-NotReparsePoint {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Label cannot be a symbolic link or reparse point: $Path"
    }
}

function Resolve-ExistingRoot {
    param([Parameter(Mandatory = $true)][string]$RootPath)

    $candidate = $RootPath.Trim().Trim('"')
    if ([string]::IsNullOrWhiteSpace($candidate) -or -not [System.IO.Path]::IsPathRooted($candidate)) {
        throw 'The selected folder must be an absolute Windows folder path.'
    }
    $resolved = [System.IO.Path]::GetFullPath($candidate)
    if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
        throw "The selected folder does not exist: $resolved"
    }
    Assert-NotReparsePoint -Path $resolved -Label 'The selected folder'
    $volumeRoot = [System.IO.Path]::GetPathRoot($resolved)
    if ($resolved.Equals($volumeRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $volumeRoot
    }
    return $resolved.TrimEnd([char[]]@('\', '/'))
}

function Test-PathEqualsOrWithinRoot {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $rootValue = [System.IO.Path]::GetFullPath($Root).TrimEnd([char[]]@('\', '/'))
    $pathValue = [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
    if ($pathValue.Equals($rootValue, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    $prefix = $rootValue + [System.IO.Path]::DirectorySeparatorChar
    return $pathValue.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-NoReparsePointInPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $resolved = [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
    $volumeRoot = ([System.IO.Path]::GetPathRoot($resolved)).TrimEnd([char[]]@('\', '/'))
    $current = $resolved
    while (-not $current.Equals($volumeRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        if (-not (Test-Path -LiteralPath $current)) {
            throw "$Label contains a path that no longer exists: $current"
        }
        Assert-NotReparsePoint -Path $current -Label $Label
        $parent = [System.IO.Directory]::GetParent($current)
        if ($null -eq $parent) { throw "$Label could not be validated safely: $Path" }
        $current = $parent.FullName.TrimEnd([char[]]@('\', '/'))
    }
}

function Resolve-NewProjectRoot {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)

    $candidate = $ProjectRoot.Trim().Trim('"')
    if ([string]::IsNullOrWhiteSpace($candidate) -or -not [System.IO.Path]::IsPathRooted($candidate)) {
        throw 'prepare-target projectRoot must be an absolute Windows folder path.'
    }
    $resolved = [System.IO.Path]::GetFullPath($candidate).TrimEnd([char[]]@('\', '/'))
    $volumeRoot = ([System.IO.Path]::GetPathRoot($resolved)).TrimEnd([char[]]@('\', '/'))
    if ($resolved.Equals($volumeRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'prepare-target will not use a drive or share root.'
    }
    if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
        throw "prepare-target projectRoot does not exist: $resolved"
    }
    Assert-NoReparsePointInPath -Path $resolved -Label 'prepare-target projectRoot'
    if (@(Get-ChildItem -LiteralPath $resolved -Force -ErrorAction Stop | Select-Object -First 1).Count -gt 0) {
        throw 'prepare-target requires a newly created empty projectRoot; existing project content was left untouched.'
    }
    return $resolved
}

function Normalize-RelativeFolder {
    param(
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][string]$Label,
        [switch]$AllowRoot
    )

    $normalized = $RelativePath.Trim().Replace('\', '/').Trim('/')
    # '.' is the project root itself: a profile may assign file types to it.
    if ($AllowRoot -and ($normalized -eq '.' -or [string]::IsNullOrWhiteSpace($normalized))) {
        return '.'
    }
    if ([string]::IsNullOrWhiteSpace($normalized) -or $normalized -eq '.') {
        throw "$Label must name a folder below the project root."
    }
    if ([System.IO.Path]::IsPathRooted($normalized)) {
        throw "$Label must be relative to the project root."
    }
    $invalid = [System.IO.Path]::GetInvalidFileNameChars()
    $segments = @($normalized.Split('/') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($segments.Count -eq 0) {
        throw "$Label cannot be empty."
    }
    foreach ($segment in $segments) {
        if ($segment -eq '.' -or $segment -eq '..' -or $segment.IndexOfAny($invalid) -ge 0) {
            throw "$Label contains an unsafe path component."
        }
    }
    return ($segments -join '/')
}

function ConvertTo-RelativePath {
    param(
        [Parameter(Mandatory = $true)][string]$RootPath,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $prefix = $RootPath.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    if ($Path.Equals($RootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        return '.'
    }
    if (-not $Path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'A scanned path resolved outside the selected folder.'
    }
    return $Path.Substring($prefix.Length).Replace('\', '/')
}

function Read-Request {
    if ([string]::IsNullOrWhiteSpace($ArgsJson)) {
        throw 'Capability arguments cannot be empty.'
    }
    try {
        $request = $ArgsJson | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "Capability arguments are not valid JSON: $($_.Exception.Message)"
    }
    if ($null -eq $request -or $request -is [System.Array] -or $request -is [string]) {
        throw 'Capability arguments must contain a JSON object.'
    }
    return $request
}

function Validate-ProfileId {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$ProfileId,
        [switch]$AllowEmpty
    )

    $value = $ProfileId.Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($value)) {
        if ($AllowEmpty) { return '' }
        throw 'profileId is required.'
    }
    $parsed = [guid]::Empty
    if (-not [guid]::TryParseExact($value, 'D', [ref]$parsed)) {
        throw 'profileId must be a lowercase hyphenated GUID.'
    }
    return $value
}

function Validate-GroupId {
    param([Parameter(Mandatory = $true)][string]$GroupId)

    $value = $GroupId.Trim()
    if ([string]::IsNullOrWhiteSpace($value)) { throw 'groupId cannot be empty.' }
    if ($value.Length -gt 128 -or $value -notmatch '^[A-Za-z0-9._-]+$') {
        throw 'groupId may only contain letters, digits, dot, underscore, and hyphen.'
    }
    return $value
}

function ConvertTo-NormalizedExtensions {
    param(
        [Parameter(Mandatory = $true)][AllowNull()]$Values,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $result = [System.Collections.Generic.List[string]]::new()
    $seen = @{}
    foreach ($raw in @($Values)) {
        if ($null -eq $raw) { continue }
        if ($raw -isnot [string]) { throw "$Label must contain only strings." }
        $value = ([string]$raw).Trim().ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($value)) { continue }
        if (-not $value.StartsWith('.')) { $value = ".$value" }
        if ($value.Length -gt 32 -or $value -notmatch '^\.[a-z0-9][a-z0-9._+\-]*$') {
            throw "$Label contains an unsupported file type '$value'."
        }
        if ($seen.ContainsKey($value)) { continue }
        $seen[$value] = $true
        $result.Add($value)
    }
    return @($result.ToArray())
}

function ConvertTo-UniqueGroupIds {
    param(
        [Parameter(Mandatory = $true)][AllowNull()]$Values,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $result = [System.Collections.Generic.List[string]]::new()
    $seen = @{}
    foreach ($raw in @($Values)) {
        if ($null -eq $raw) { continue }
        if ($raw -isnot [string]) { throw "$Label must contain only strings." }
        $value = Validate-GroupId -GroupId ([string]$raw)
        $key = $value.ToLowerInvariant()
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true
        $result.Add($value)
    }
    return @($result.ToArray())
}

function Write-AtomicJsonFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $directory = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($directory) -and -not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    $json = $Value | ConvertTo-Json -Depth 16
    $temporary = "$Path.tmp"
    [System.IO.File]::WriteAllText($temporary, $json, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

# ---------------------------------------------------------------- file groups

function Read-FileGroups {
    $path = Get-FileGroupsPath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return @() }
    try {
        $document = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "The shared file group file is not valid JSON: $path"
    }
    if ($null -eq $document -or -not (Test-ObjectProperty -Object $document -Name 'groups')) { return @() }

    $groups = [System.Collections.Generic.List[object]]::new()
    foreach ($entry in @($document.groups)) {
        if ($null -eq $entry) { continue }
        try {
            $groupId = Validate-GroupId -GroupId ([string]$entry.groupId)
            $label = ([string]$entry.label).Trim()
            if ([string]::IsNullOrWhiteSpace($label)) { continue }
            $fileTypes = @(ConvertTo-NormalizedExtensions -Values $entry.fileTypes -Label 'group.fileTypes')
            $isProgram = $false
            if (Test-ObjectProperty -Object $entry -Name 'isProgram') { $isProgram = [bool]$entry.isProgram }
        }
        catch {
            continue
        }
        $groups.Add([ordered]@{
            groupId = $groupId
            label = $label
            fileTypes = $fileTypes
            isProgram = $isProgram
            createdAt = if (Test-ObjectProperty -Object $entry -Name 'createdAt') { [string]$entry.createdAt } else { '' }
            updatedAt = if (Test-ObjectProperty -Object $entry -Name 'updatedAt') { [string]$entry.updatedAt } else { '' }
        })
    }
    return @($groups.ToArray())
}

function Write-FileGroups {
    param([Parameter(Mandatory = $true)][AllowNull()]$Groups)

    $document = [ordered]@{
        schemaVersion = 1
        format = $script:FileGroupsFormat
        groups = @($Groups)
    }
    Write-AtomicJsonFile -Path (Get-FileGroupsPath) -Value $document
}

function Invoke-ListFileGroups {
    return [ordered]@{ groups = @(Read-FileGroups | Sort-Object { $_.label.ToLowerInvariant() }) }
}

function Invoke-SaveFileGroup {
    param([Parameter(Mandatory = $true)]$Request)

    Assert-ObjectProperties -Object $Request `
        -Allowed @('operation', 'groupId', 'label', 'fileTypes', 'isProgram') `
        -Required @('operation', 'groupId', 'label', 'fileTypes') `
        -Label 'save-file-group request'

    $groupId = Validate-GroupId -GroupId (Get-RequiredString -Object $Request -Name 'groupId' -Label 'save-file-group request' -MaximumLength 128)
    $label = Get-RequiredString -Object $Request -Name 'label' -Label 'save-file-group request' -MaximumLength 120
    $fileTypes = @(ConvertTo-NormalizedExtensions -Values $Request.fileTypes -Label 'save-file-group request.fileTypes')
    if ($fileTypes.Count -eq 0) { throw 'A file group needs at least one file type.' }
    $isProgram = if (Test-ObjectProperty -Object $Request -Name 'isProgram') {
        Get-RequiredBoolean -Object $Request -Name 'isProgram' -Label 'save-file-group request'
    } else { $false }

    $timestamp = [DateTimeOffset]::UtcNow.ToString('o')
    $existing = @(Read-FileGroups)
    $next = [System.Collections.Generic.List[object]]::new()
    $replaced = $false
    foreach ($group in $existing) {
        if ($group.groupId.Equals($groupId, [System.StringComparison]::OrdinalIgnoreCase)) {
            $next.Add([ordered]@{
                groupId = $groupId
                label = $label
                fileTypes = $fileTypes
                isProgram = $isProgram
                createdAt = if ([string]::IsNullOrWhiteSpace([string]$group.createdAt)) { $timestamp } else { [string]$group.createdAt }
                updatedAt = $timestamp
            })
            $replaced = $true
            continue
        }
        $next.Add($group)
    }
    if (-not $replaced) {
        $next.Add([ordered]@{
            groupId = $groupId
            label = $label
            fileTypes = $fileTypes
            isProgram = $isProgram
            createdAt = $timestamp
            updatedAt = $timestamp
        })
    }
    Write-FileGroups -Groups @($next.ToArray())
    return [ordered]@{ group = @($next.ToArray() | Where-Object { $_.groupId -eq $groupId })[0] }
}

function Invoke-DeleteFileGroup {
    param([Parameter(Mandatory = $true)]$Request)

    Assert-ObjectProperties -Object $Request `
        -Allowed @('operation', 'groupId') -Required @('operation', 'groupId') -Label 'delete-file-group request'
    $groupId = Validate-GroupId -GroupId (Get-RequiredString -Object $Request -Name 'groupId' -Label 'delete-file-group request' -MaximumLength 128)

    $existing = @(Read-FileGroups)
    $next = @($existing | Where-Object { -not $_.groupId.Equals($groupId, [System.StringComparison]::OrdinalIgnoreCase) })
    Write-FileGroups -Groups $next
    return [ordered]@{ deleted = ($next.Count -lt $existing.Count) }
}

# ------------------------------------------------------------------- profiles

function ConvertTo-ValidatedFolderEntry {
    param(
        [Parameter(Mandatory = $true)]$Entry,
        [Parameter(Mandatory = $true)][string]$Label
    )

    Assert-ObjectProperties -Object $Entry `
        -Allowed @('path', 'groupIds', 'fileTypes', 'ignored', 'catchAll') `
        -Required @('path') -Label $Label

    $path = Normalize-RelativeFolder -RelativePath (Get-RequiredString -Object $Entry -Name 'path' -Label $Label -MaximumLength 520) -Label "$Label.path" -AllowRoot
    $groupIds = @(if (Test-ObjectProperty -Object $Entry -Name 'groupIds') {
        ConvertTo-UniqueGroupIds -Values $Entry.groupIds -Label "$Label.groupIds"
    } else { @() })
    $fileTypes = @(if (Test-ObjectProperty -Object $Entry -Name 'fileTypes') {
        ConvertTo-NormalizedExtensions -Values $Entry.fileTypes -Label "$Label.fileTypes"
    } else { @() })
    $ignored = if (Test-ObjectProperty -Object $Entry -Name 'ignored') {
        Get-RequiredBoolean -Object $Entry -Name 'ignored' -Label $Label
    } else { $false }
    $catchAll = if (Test-ObjectProperty -Object $Entry -Name 'catchAll') {
        Get-RequiredBoolean -Object $Entry -Name 'catchAll' -Label $Label
    } else { $false }
    if ($catchAll -and $ignored) {
        throw "$Label cannot both collect other files and be ignored."
    }
    if ($ignored -and $path -eq '.') {
        throw "$Label cannot ignore the project root: nothing would be organized."
    }

    return [ordered]@{
        path = $path
        groupIds = $groupIds
        fileTypes = $fileTypes
        ignored = $ignored
        catchAll = $catchAll
    }
}

function Resolve-EffectiveExtensions {
    <#
        Group references plus directly assigned types, for one folder entry.
        Groups are resolved at read time so editing a group changes routing
        everywhere it is used.
    #>
    param(
        [Parameter(Mandatory = $true)]$Folder,
        [Parameter(Mandatory = $true)][AllowNull()]$GroupsById
    )

    $result = [System.Collections.Generic.List[string]]::new()
    $seen = @{}
    foreach ($groupId in @($Folder.groupIds)) {
        $key = ([string]$groupId).ToLowerInvariant()
        if (-not $GroupsById.ContainsKey($key)) { continue }
        foreach ($extension in @($GroupsById[$key].fileTypes)) {
            if ($seen.ContainsKey($extension)) { continue }
            $seen[$extension] = $true
            $result.Add($extension)
        }
    }
    foreach ($extension in @($Folder.fileTypes)) {
        if ($seen.ContainsKey($extension)) { continue }
        $seen[$extension] = $true
        $result.Add($extension)
    }
    return @($result.ToArray())
}

function Assert-NoDuplicateExtensionClaims {
    param([Parameter(Mandatory = $true)][AllowNull()]$Folders)

    $groupsById = @{}
    foreach ($group in @(Read-FileGroups)) { $groupsById[$group.groupId.ToLowerInvariant()] = $group }

    $owners = @{}
    foreach ($folder in @($Folders)) {
        if ($folder.ignored) { continue }
        foreach ($extension in @(Resolve-EffectiveExtensions -Folder $folder -GroupsById $groupsById)) {
            if ($owners.ContainsKey($extension)) {
                throw "File type $extension is assigned to both '$($owners[$extension])' and '$($folder.path)'. Assign it to one folder."
            }
            $owners[$extension] = $folder.path
        }
    }
}

function ConvertTo-ValidatedProgramFolder {
    param(
        [Parameter(Mandatory = $true)]$Entry,
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][AllowNull()]$ProgramGroupsById
    )

    Assert-ObjectProperties -Object $Entry `
        -Allowed @('groupId', 'createInRoot', 'profileId') `
        -Required @('groupId') -Label $Label

    $groupId = Validate-GroupId -GroupId (Get-RequiredString -Object $Entry -Name 'groupId' -Label $Label -MaximumLength 128)
    if (-not $ProgramGroupsById.ContainsKey($groupId.ToLowerInvariant())) {
        throw "$Label references '$groupId', which is not a program file group."
    }
    $createInRoot = if (Test-ObjectProperty -Object $Entry -Name 'createInRoot') {
        Get-RequiredBoolean -Object $Entry -Name 'createInRoot' -Label $Label
    } else { $false }
    $profileId = if (Test-ObjectProperty -Object $Entry -Name 'profileId') {
        Validate-ProfileId -ProfileId (Get-RequiredString -Object $Entry -Name 'profileId' -Label $Label -MaximumLength 36 -AllowEmpty) -AllowEmpty
    } else { '' }

    return [ordered]@{
        groupId = $groupId
        createInRoot = $createInRoot
        profileId = $profileId
    }
}

function ConvertTo-ValidatedProfileRecord {
    param(
        [Parameter(Mandatory = $true)]$Record,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $profileId = Validate-ProfileId -ProfileId ([string]$Record.profileId)
    $name = ([string]$Record.name).Trim()
    if ([string]::IsNullOrWhiteSpace($name) -or $name.Length -gt 120) {
        throw "$Label.name must be 1-120 characters."
    }
    $recycleOtherFolders = if (Test-ObjectProperty -Object $Record -Name 'recycleOtherFolders') {
        Get-RequiredBoolean -Object $Record -Name 'recycleOtherFolders' -Label $Label
    } else { $false }
    $recyclePreviousIgnoredFolders = if (Test-ObjectProperty -Object $Record -Name 'recyclePreviousIgnoredFolders') {
        Get-RequiredBoolean -Object $Record -Name 'recyclePreviousIgnoredFolders' -Label $Label
    } else { $false }
    if ($recyclePreviousIgnoredFolders -and -not $recycleOtherFolders) {
        throw "$Label.recyclePreviousIgnoredFolders requires recycleOtherFolders."
    }

    $folders = [System.Collections.Generic.List[object]]::new()
    $seenPaths = @{}
    $index = 0
    foreach ($entry in @($Record.folders)) {
        if ($null -eq $entry) { continue }
        $folder = ConvertTo-ValidatedFolderEntry -Entry $entry -Label "$Label.folders[$index]"
        $key = $folder.path.ToLowerInvariant()
        if ($seenPaths.ContainsKey($key)) {
            throw "$Label lists the folder '$($folder.path)' more than once."
        }
        $seenPaths[$key] = $true
        $folders.Add($folder)
        $index += 1
    }
    if ($folders.Count -gt $script:MaximumFolders) {
        throw "A profile cannot contain more than $($script:MaximumFolders) folders."
    }
    # Unmatched files have exactly one destination, so the catch-all is single.
    $programGroupsById = @{}
    foreach ($group in @(Read-FileGroups)) {
        if ($group.isProgram) { $programGroupsById[$group.groupId.ToLowerInvariant()] = $group }
    }
    $programFolders = [System.Collections.Generic.List[object]]::new()
    $seenProgramGroups = @{}
    $programIndex = 0
    if (Test-ObjectProperty -Object $Record -Name 'programFolders') {
        foreach ($entry in @($Record.programFolders)) {
            if ($null -eq $entry) { continue }
            $programFolder = ConvertTo-ValidatedProgramFolder -Entry $entry `
                -Label "$Label.programFolders[$programIndex]" -ProgramGroupsById $programGroupsById
            $key = $programFolder.groupId.ToLowerInvariant()
            if ($seenProgramGroups.ContainsKey($key)) {
                throw "$Label lists the program group '$($programFolder.groupId)' more than once."
            }
            $seenProgramGroups[$key] = $true
            # A program folder pointing at itself would recurse forever.
            if ($programFolder.profileId -eq $profileId -and -not [string]::IsNullOrWhiteSpace($programFolder.profileId)) {
                throw "$Label cannot use itself as the profile inside its own program folder."
            }
            $programFolders.Add($programFolder)
            $programIndex += 1
        }
    }

    $catchAllFolders = @($folders.ToArray() | Where-Object { $_.catchAll })
    if ($catchAllFolders.Count -gt 1) {
        $names = (@($catchAllFolders | ForEach-Object { $_.path }) -join ', ')
        throw "Only one folder can collect all other files, but $($catchAllFolders.Count) do: $names"
    }

    $createdAt = if ((Test-ObjectProperty -Object $Record -Name 'createdAt') -and
        -not [string]::IsNullOrWhiteSpace([string]$Record.createdAt)) {
        [string]$Record.createdAt
    } else { [DateTimeOffset]::UtcNow.ToString('o') }

    return [ordered]@{
        schemaVersion = 3
        format = $script:ProfileFormat
        profileId = $profileId
        name = $name
        recycleOtherFolders = $recycleOtherFolders
        recyclePreviousIgnoredFolders = $recyclePreviousIgnoredFolders
        folders = @($folders.ToArray())
        programFolders = @($programFolders.ToArray())
        createdAt = $createdAt
        updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    }
}

function Get-ProfilePath {
    param([Parameter(Mandatory = $true)][string]$ProfileId)

    return Join-Path (Get-ProfilesRoot) "$ProfileId.json"
}

function Read-ProfileRecord {
    param([Parameter(Mandatory = $true)][string]$Path)

    try {
        $document = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        return $null
    }
    if ($null -eq $document) { return $null }
    if (-not (Test-ObjectProperty -Object $document -Name 'format')) { return $null }
    if ([string]$document.format -ne $script:ProfileFormat) { return $null }
    try {
        return ConvertTo-ValidatedProfileRecord -Record $document -Label 'profile'
    }
    catch {
        return $null
    }
}

function Read-Profile {
    param([Parameter(Mandatory = $true)][string]$ProfileId)

    $path = Get-ProfilePath -ProfileId $ProfileId
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "The saved profile no longer exists: $ProfileId"
    }
    $record = Read-ProfileRecord -Path $path
    if ($null -eq $record) {
        throw "The saved profile is not a valid $($script:ProfileFormat) file: $ProfileId"
    }
    return $record
}

function Resolve-SelectedProfile {
    param([Parameter(Mandatory = $true)]$Request)

    $hasProfileId = Test-ObjectProperty -Object $Request -Name 'profileId'
    $hasProfilePath = Test-ObjectProperty -Object $Request -Name 'profilePath'
    if ($hasProfileId -eq $hasProfilePath) {
        throw 'prepare-target requires exactly one of profileId or profilePath.'
    }

    if ($hasProfileId) {
        $profileId = Validate-ProfileId -ProfileId (Get-RequiredString -Object $Request `
            -Name 'profileId' -Label 'prepare-target request' -MaximumLength 36)
        $record = Read-Profile -ProfileId $profileId
        $profilePath = [System.IO.Path]::GetFullPath((Get-ProfilePath -ProfileId $profileId))
        Assert-NoReparsePointInPath -Path $profilePath -Label 'The selected organization profile'
        return [pscustomobject]@{ Path = $profilePath; Record = $record }
    }

    $rawPath = Get-RequiredString -Object $Request -Name 'profilePath' `
        -Label 'prepare-target request' -MaximumLength 1024
    if (-not [System.IO.Path]::IsPathRooted($rawPath)) {
        throw 'prepare-target profilePath must be an absolute Windows file path.'
    }
    $profilePath = [System.IO.Path]::GetFullPath($rawPath)
    if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf)) {
        throw "The selected organization profile does not exist: $profilePath"
    }
    Assert-NoReparsePointInPath -Path $profilePath -Label 'The selected organization profile'
    $record = Read-ProfileRecord -Path $profilePath
    if ($null -eq $record) {
        throw "The selected file is not a valid $($script:ProfileFormat) profile: $profilePath"
    }
    $expectedPath = [System.IO.Path]::GetFullPath((Get-ProfilePath -ProfileId ([string]$record.profileId)))
    if (-not $profilePath.Equals($expectedPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'prepare-target accepts only a saved Setup Organization profile from the shared profiles folder.'
    }
    return [pscustomobject]@{ Path = $profilePath; Record = $record }
}

function Invoke-OrganizerEngine {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string]$ProfileId,
        [Parameter(Mandatory = $true)][string]$PlannedExtension
    )

    $templatePath = Join-Path $PSScriptRoot 'templates\organize_folder.ps1.template'
    if (-not (Test-Path -LiteralPath $templatePath -PathType Leaf)) {
        throw 'The organizer engine template is missing from the installed package.'
    }
    Assert-NotReparsePoint -Path $templatePath -Label 'The organizer engine template'
    $template = Get-Content -LiteralPath $templatePath -Raw -Encoding UTF8
    $profileToken = '{{PROFILE_ID}}'
    if (-not $template.Contains($profileToken)) {
        throw 'The organizer engine template has an invalid profile token.'
    }

    $stageRoot = Join-Path (Get-StagingRoot) ("prepare-" + ([guid]::NewGuid()).ToString('N'))
    $scriptPath = Join-Path $stageRoot 'organize_folder.ps1'
    $stdoutPath = Join-Path $stageRoot 'stdout.txt'
    $stderrPath = Join-Path $stageRoot 'stderr.txt'
    try {
        New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
        $scriptBody = $template.Replace($profileToken, $ProfileId)
        [System.IO.File]::WriteAllText($scriptPath, $scriptBody, [System.Text.UTF8Encoding]::new($false))

        $hostName = if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh.exe' } else { 'powershell.exe' }
        $hostPath = Join-Path $PSHOME $hostName
        if (-not (Test-Path -LiteralPath $hostPath -PathType Leaf)) {
            throw "Could not locate the PowerShell host required by the organizer engine: $hostPath"
        }
        $arguments = @(
            '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', ('"' + $scriptPath + '"'),
            '-TargetPath', ('"' + $ProjectRoot + '"'),
            '-PlannedExtension', $PlannedExtension
        )
        $process = Start-Process -FilePath $hostPath -ArgumentList $arguments -Wait -PassThru `
            -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
        $stdout = if (Test-Path -LiteralPath $stdoutPath -PathType Leaf) {
            Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue
        } else { '' }
        $stderr = if (Test-Path -LiteralPath $stderrPath -PathType Leaf) {
            Get-Content -LiteralPath $stderrPath -Raw -ErrorAction SilentlyContinue
        } else { '' }
        if ($process.ExitCode -ne 0) {
            $detail = ([string]$stderr).Trim()
            if ([string]::IsNullOrWhiteSpace($detail)) { $detail = ([string]$stdout).Trim() }
            if ([string]::IsNullOrWhiteSpace($detail)) { $detail = "exit code $($process.ExitCode)" }
            throw "The organizer engine could not prepare the project: $detail"
        }
        try {
            $engineResponse = ([string]$stdout).Trim() | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            throw "The organizer engine returned an invalid response: $($_.Exception.Message)"
        }
        if ($null -eq $engineResponse -or
            -not (Test-ObjectProperty -Object $engineResponse -Name 'profileId') -or
            [string]$engineResponse.profileId -ne $ProfileId) {
            throw 'The organizer engine returned a response for the wrong profile.'
        }
    }
    finally {
        if (Test-Path -LiteralPath $stageRoot) {
            $stagingRoot = [System.IO.Path]::GetFullPath((Get-StagingRoot)).TrimEnd([char[]]@('\', '/'))
            $stageResolved = [System.IO.Path]::GetFullPath($stageRoot).TrimEnd([char[]]@('\', '/'))
            if (Test-PathEqualsOrWithinRoot -Root $stagingRoot -Path $stageResolved) {
                Remove-Item -LiteralPath $stageResolved -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

function Resolve-PreparedDestination {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string]$ProfileId,
        [Parameter(Mandatory = $true)][string]$PlannedExtension
    )

    $markerPath = Join-Path $ProjectRoot '.flowcell-project.json'
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
        throw 'The organizer engine did not write the project marker.'
    }
    Assert-NotReparsePoint -Path $markerPath -Label 'The prepared project marker'
    try {
        $marker = Get-Content -LiteralPath $markerPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "The prepared project marker is not valid JSON: $($_.Exception.Message)"
    }
    if ($null -eq $marker -or
        -not (Test-ObjectProperty -Object $marker -Name 'format') -or
        [string]$marker.format -ne 'flowcell.project.v1' -or
        -not (Test-ObjectProperty -Object $marker -Name 'profileId') -or
        [string]$marker.profileId -ne $ProfileId -or
        -not (Test-ObjectProperty -Object $marker -Name 'where') -or
        -not (Test-ObjectProperty -Object $marker -Name 'catchAll')) {
        throw 'The prepared project marker does not match the selected profile.'
    }

    $relative = 'Blender'
    $route = $marker.where.PSObject.Properties[$PlannedExtension]
    if ($null -ne $route) {
        if ($route.Value -isnot [string]) { throw 'The prepared project marker contains an invalid planned-file route.' }
        $relative = Normalize-RelativeFolder -RelativePath ([string]$route.Value) `
            -Label 'The prepared planned-file route' -AllowRoot
    }
    elseif ($marker.catchAll -is [string] -and -not [string]::IsNullOrWhiteSpace([string]$marker.catchAll)) {
        $relative = Normalize-RelativeFolder -RelativePath ([string]$marker.catchAll) `
            -Label 'The prepared catch-all route' -AllowRoot
    }

    $destination = if ($relative -eq '.') {
        $ProjectRoot
    } else {
        [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $relative.Replace('/', '\')))
    }
    if (-not (Test-PathEqualsOrWithinRoot -Root $ProjectRoot -Path $destination)) {
        throw 'The prepared destination resolves outside projectRoot.'
    }
    if (-not (Test-Path -LiteralPath $destination -PathType Container)) {
        throw "The organizer engine did not create the prepared destination: $destination"
    }
    Assert-NoReparsePointInPath -Path $destination -Label 'The prepared destination'
    return [pscustomobject]@{
        MarkerPath = $markerPath
        RelativePath = $relative
        Directory = $destination
    }
}

function Resolve-ExistingPrepareTargetRoot {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)

    $candidate = $ProjectRoot.Trim().Trim('"')
    if ([string]::IsNullOrWhiteSpace($candidate) -or -not [System.IO.Path]::IsPathRooted($candidate)) {
        throw 'prepare-existing-target projectRoot must be an absolute Windows folder path.'
    }
    $resolved = [System.IO.Path]::GetFullPath($candidate).TrimEnd([char[]]@('\', '/'))
    $volumeRoot = ([System.IO.Path]::GetPathRoot($resolved)).TrimEnd([char[]]@('\', '/'))
    if ($resolved.Equals($volumeRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'prepare-existing-target will not use a drive or share root.'
    }
    if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
        throw "prepare-existing-target projectRoot does not exist: $resolved"
    }
    Assert-NoReparsePointInPath -Path $resolved -Label 'prepare-existing-target projectRoot'
    return $resolved
}

function Test-JsonObject {
    param([AllowNull()]$Value)

    return $null -ne $Value -and $Value -is [System.Management.Automation.PSCustomObject]
}

function Read-ValidatedExistingProjectMarker {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)

    $markerPath = Join-Path $ProjectRoot '.flowcell-project.json'
    if (-not (Test-Path -LiteralPath $markerPath)) {
        return $null
    }
    $markerItem = Get-Item -LiteralPath $markerPath -Force -ErrorAction Stop
    if ($markerItem.PSIsContainer -or
        ($markerItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "The existing project marker is not a regular file: $markerPath"
    }
    try {
        $marker = Get-Content -LiteralPath $markerPath -Raw -Encoding UTF8 -ErrorAction Stop |
            ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "The existing project marker is invalid and was left untouched: $($_.Exception.Message)"
    }
    if (-not (Test-JsonObject -Value $marker)) {
        throw 'The existing project marker must be one JSON object.'
    }

    $required = @(
        'schemaVersion', 'format', 'profileId', 'profileName', 'organizedAt',
        'where', 'catchAll', 'programFolders', 'ignored')
    $actual = @($marker.PSObject.Properties.Name)
    if ($actual.Count -ne $required.Count) {
        throw 'The existing project marker does not match the FlowCell project-marker v1 contract.'
    }
    foreach ($name in $required) {
        if ($actual -cnotcontains $name) {
            throw 'The existing project marker does not match the FlowCell project-marker v1 contract.'
        }
    }
    if ((($marker.schemaVersion -isnot [int]) -and ($marker.schemaVersion -isnot [long])) -or
        [long]$marker.schemaVersion -ne 1 -or
        $marker.format -isnot [string] -or [string]$marker.format -ne 'flowcell.project.v1' -or
        $marker.profileId -isnot [string] -or
        [string]$marker.profileId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -or
        $marker.profileName -isnot [string] -or
        [string]::IsNullOrEmpty([string]$marker.profileName) -or
        ([string]$marker.profileName).Length -gt 120 -or
        $marker.organizedAt -isnot [string] -or
        -not (Test-JsonObject -Value $marker.where) -or
        $marker.catchAll -isnot [string] -or
        -not (Test-JsonObject -Value $marker.programFolders) -or
        $marker.ignored -isnot [System.Array]) {
        throw 'The existing project marker does not match the FlowCell project-marker v1 contract.'
    }
    $organizedAt = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse(
        [string]$marker.organizedAt,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::RoundtripKind,
        [ref]$organizedAt)) {
        throw 'The existing project marker has an invalid organizedAt timestamp.'
    }
    foreach ($property in @($marker.where.PSObject.Properties)) {
        $extension = [string]$property.Name
        if ($extension.Length -gt 32 -or $extension -notmatch '^\.[a-z0-9][a-z0-9._+\-]*$' -or
            $property.Value -isnot [string]) {
            throw 'The existing project marker contains an invalid file destination.'
        }
        [void](Normalize-RelativeFolder -RelativePath ([string]$property.Value) `
            -Label "The existing project marker destination for '$extension'" -AllowRoot)
    }
    if (-not [string]::IsNullOrEmpty([string]$marker.catchAll)) {
        [void](Normalize-RelativeFolder -RelativePath ([string]$marker.catchAll) `
            -Label 'The existing project marker catch-all folder' -AllowRoot)
    }
    foreach ($property in @($marker.programFolders.PSObject.Properties)) {
        if ($property.Value -isnot [string]) {
            throw 'The existing project marker contains an invalid program folder.'
        }
        [void](Normalize-RelativeFolder -RelativePath ([string]$property.Value) `
            -Label "The existing project marker program folder '$($property.Name)'" -AllowRoot)
    }
    foreach ($ignored in @($marker.ignored)) {
        if ($ignored -isnot [string]) {
            throw 'The existing project marker contains an invalid ignored folder.'
        }
        [void](Normalize-RelativeFolder -RelativePath ([string]$ignored) `
            -Label 'The existing project marker ignored folder')
    }
    return [pscustomobject]@{ Path = $markerPath; Record = $marker }
}

function Try-ReadCanonicalProfileForExistingTarget {
    param([Parameter(Mandatory = $true)][string]$ProfileId)

    try {
        $path = [System.IO.Path]::GetFullPath((Get-ProfilePath -ProfileId $ProfileId))
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
        Assert-NoReparsePointInPath -Path $path -Label 'The saved organization profile'
        $record = Read-ProfileRecord -Path $path
        if ($null -eq $record -or [string]$record.profileId -ne $ProfileId) { return $null }
        return [pscustomobject]@{ Path = $path; Record = $record }
    }
    catch {
        return $null
    }
}

function Normalize-ExistingProgramFolderName {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Name)

    $candidate = $Name.Trim().Trim('.')
    if ([string]::IsNullOrWhiteSpace($candidate) -or $candidate.Length -gt 120) { return '' }
    if ($candidate -eq '.' -or $candidate -eq '..' -or
        $candidate.IndexOfAny([System.IO.Path]::GetInvalidFileNameChars()) -ge 0) {
        return ''
    }
    return $candidate
}

function Resolve-ExistingProfileDestination {
    param(
        [Parameter(Mandatory = $true)]$Profile,
        [Parameter(Mandatory = $true)][string]$PlannedExtension
    )

    try {
        $groups = @(Read-FileGroups)
    }
    catch {
        return '.'
    }
    $groupsById = @{}
    foreach ($group in $groups) { $groupsById[$group.groupId.ToLowerInvariant()] = $group }

    $programMatches = [System.Collections.Generic.List[object]]::new()
    foreach ($programFolder in @($Profile.programFolders)) {
        if (-not [bool]$programFolder.createInRoot) { continue }
        $groupKey = ([string]$programFolder.groupId).ToLowerInvariant()
        if (-not $groupsById.ContainsKey($groupKey)) { continue }
        $group = $groupsById[$groupKey]
        if (-not [bool]$group.isProgram -or @($group.fileTypes) -notcontains $PlannedExtension) { continue }
        $programRelative = Normalize-ExistingProgramFolderName -Name ([string]$group.label)
        if ([string]::IsNullOrWhiteSpace($programRelative)) { continue }
        $programMatches.Add([pscustomobject]@{
            GroupKey = $groupKey
            Relative = $programRelative
            NestedProfileId = [string]$programFolder.profileId
        })
    }
    if ($programMatches.Count -gt 1) {
        throw "The saved profile has conflicting program routes for $PlannedExtension."
    }
    if ($programMatches.Count -eq 1) {
        $match = $programMatches[0]
        $destination = [string]$match.Relative
        if (-not [string]::IsNullOrWhiteSpace([string]$match.NestedProfileId)) {
            $nestedSelection = Try-ReadCanonicalProfileForExistingTarget -ProfileId ([string]$match.NestedProfileId)
            if ($null -ne $nestedSelection) {
                $nestedMatches = [System.Collections.Generic.List[string]]::new()
                foreach ($folder in @($nestedSelection.Record.folders)) {
                    if ([bool]$folder.ignored) { continue }
                    $groupIds = @($folder.groupIds | ForEach-Object { ([string]$_).ToLowerInvariant() })
                    if ($groupIds -notcontains [string]$match.GroupKey) { continue }
                    $nestedRelative = Normalize-RelativeFolder -RelativePath ([string]$folder.path) `
                        -Label 'The nested planned-file destination'
                    $nestedMatches.Add("$($match.Relative)/$nestedRelative")
                }
                if ($nestedMatches.Count -gt 1) {
                    throw "The nested saved profile has conflicting routes for $PlannedExtension."
                }
                if ($nestedMatches.Count -eq 1) { $destination = $nestedMatches[0] }
            }
        }
        return $destination
    }

    $staticMatches = [System.Collections.Generic.List[string]]::new()
    foreach ($folder in @($Profile.folders)) {
        if ([bool]$folder.ignored) { continue }
        $extensions = @(Resolve-EffectiveExtensions -Folder $folder -GroupsById $groupsById)
        if ($extensions -contains $PlannedExtension) {
            $staticMatches.Add([string]$folder.path)
        }
    }
    if ($staticMatches.Count -gt 1) {
        throw "The saved profile has conflicting folder routes for $PlannedExtension."
    }
    if ($staticMatches.Count -eq 1) { return $staticMatches[0] }

    $catchAll = @($Profile.folders | Where-Object { -not [bool]$_.ignored -and [bool]$_.catchAll })
    if ($catchAll.Count -gt 0) { return [string]$catchAll[0].path }
    return 'Blender'
}

function Ensure-ExistingPreparedDestination {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string]$RelativePath
    )

    $relative = Normalize-RelativeFolder -RelativePath $RelativePath `
        -Label 'The prepared planned-file destination' -AllowRoot
    if ($relative -eq '.') { return $ProjectRoot }

    $destination = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $relative.Replace('/', '\')))
    if (-not (Test-PathEqualsOrWithinRoot -Root $ProjectRoot -Path $destination)) {
        throw 'The prepared destination resolves outside projectRoot.'
    }
    $current = $ProjectRoot
    foreach ($segment in @($relative.Split('/'))) {
        $current = Join-Path $current $segment
        if (-not (Test-Path -LiteralPath $current)) { continue }
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (-not $item.PSIsContainer -or
            ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "The prepared destination contains a file or reparse point: $current"
        }
    }
    $current = $ProjectRoot
    foreach ($segment in @($relative.Split('/'))) {
        $current = Join-Path $current $segment
        if (-not (Test-Path -LiteralPath $current -PathType Container)) {
            [void][System.IO.Directory]::CreateDirectory($current)
        }
        Assert-NotReparsePoint -Path $current -Label 'The prepared destination'
    }
    Assert-NoReparsePointInPath -Path $destination -Label 'The prepared destination'
    return $destination
}

function Invoke-PrepareExistingTarget {
    param([Parameter(Mandatory = $true)]$Request)

    Assert-ObjectProperties -Object $Request `
        -Allowed @('operation', 'projectRoot', 'plannedExtension') `
        -Required @('operation', 'projectRoot', 'plannedExtension') `
        -Label 'prepare-existing-target request'
    $projectRoot = Resolve-ExistingPrepareTargetRoot -ProjectRoot (Get-RequiredString -Object $Request `
        -Name 'projectRoot' -Label 'prepare-existing-target request' -MaximumLength 1024)
    $plannedExtension = (Get-RequiredString -Object $Request -Name 'plannedExtension' `
        -Label 'prepare-existing-target request' -MaximumLength 32).ToLowerInvariant()
    if ($plannedExtension -ne '.blend') {
        throw "prepare-existing-target currently supports only the .blend plannedExtension. Received: $plannedExtension"
    }

    $markerSelection = Read-ValidatedExistingProjectMarker -ProjectRoot $projectRoot
    $profileId = ''
    $profileName = ''
    $profilePath = ''
    $markerPath = ''
    $relative = 'Blender'
    if ($null -ne $markerSelection) {
        $marker = $markerSelection.Record
        $profileId = [string]$marker.profileId
        $profileName = [string]$marker.profileName
        $markerPath = [string]$markerSelection.Path
        $profileSelection = Try-ReadCanonicalProfileForExistingTarget -ProfileId $profileId
        if ($null -ne $profileSelection) { $profilePath = [string]$profileSelection.Path }

        $existingRoute = $marker.where.PSObject.Properties[$plannedExtension]
        if ($null -ne $existingRoute) {
            $relative = Normalize-RelativeFolder -RelativePath ([string]$existingRoute.Value) `
                -Label 'The existing planned-file destination' -AllowRoot
        }
        elseif ($null -ne $profileSelection) {
            $relative = Resolve-ExistingProfileDestination -Profile $profileSelection.Record `
                -PlannedExtension $plannedExtension
        }
    }
    $destination = Ensure-ExistingPreparedDestination -ProjectRoot $projectRoot -RelativePath $relative

    return [ordered]@{
        prepared = $true
        projectRoot = $projectRoot
        profileId = $profileId
        profileName = $profileName
        profilePath = $profilePath
        plannedExtension = $plannedExtension
        markerPath = $markerPath
        destinationRelativePath = $relative
        destinationDirectory = $destination
    }
}

function Get-AllProfileRecords {
    $root = Get-ProfilesRoot
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { return @() }
    $records = [System.Collections.Generic.List[object]]::new()
    foreach ($file in @(Get-ChildItem -LiteralPath $root -Filter '*.json' -File -ErrorAction SilentlyContinue)) {
        $record = Read-ProfileRecord -Path $file.FullName
        if ($null -ne $record) { $records.Add($record) }
    }
    return @($records.ToArray())
}

function Invoke-ListProfiles {
    $summaries = foreach ($record in @(Get-AllProfileRecords)) {
        [ordered]@{
            profileId = $record.profileId
            name = $record.name
            updatedAt = $record.updatedAt
            folderCount = @($record.folders).Count
            assignedCount = @($record.folders | Where-Object {
                -not $_.ignored -and (@($_.groupIds).Count -gt 0 -or @($_.fileTypes).Count -gt 0)
            }).Count
        }
    }
    return [ordered]@{ profiles = @(@($summaries) | Sort-Object { $_.name.ToLowerInvariant() }) }
}

function Invoke-LoadProfile {
    param([Parameter(Mandatory = $true)]$Request)

    Assert-ObjectProperties -Object $Request -Allowed @('operation', 'profileId') -Required @('operation', 'profileId') -Label 'load-profile request'
    $profileId = Validate-ProfileId -ProfileId (Get-RequiredString -Object $Request -Name 'profileId' -Label 'load-profile request' -MaximumLength 36)
    return [ordered]@{ profile = (Read-Profile -ProfileId $profileId) }
}

function Invoke-PrepareTarget {
    param([Parameter(Mandatory = $true)]$Request)

    Assert-ObjectProperties -Object $Request `
        -Allowed @('operation', 'projectRoot', 'plannedExtension', 'profileId', 'profilePath') `
        -Required @('operation', 'projectRoot', 'plannedExtension') `
        -Label 'prepare-target request'
    $projectRoot = Resolve-NewProjectRoot -ProjectRoot (Get-RequiredString -Object $Request `
        -Name 'projectRoot' -Label 'prepare-target request' -MaximumLength 1024)
    $plannedExtension = (Get-RequiredString -Object $Request -Name 'plannedExtension' `
        -Label 'prepare-target request' -MaximumLength 32).ToLowerInvariant()
    if ($plannedExtension -ne '.blend') {
        throw "prepare-target currently supports only the .blend plannedExtension. Received: $plannedExtension"
    }
    $selection = Resolve-SelectedProfile -Request $Request
    $profileId = [string]$selection.Record.profileId

    # This is the same generated organizer engine used by installed profile
    # Buttons. A planned extension participates only in program-route activation;
    # no placeholder file is created or moved.
    Invoke-OrganizerEngine -ProjectRoot $projectRoot -ProfileId $profileId `
        -PlannedExtension $plannedExtension
    $destination = Resolve-PreparedDestination -ProjectRoot $projectRoot `
        -ProfileId $profileId -PlannedExtension $plannedExtension

    return [ordered]@{
        prepared = $true
        projectRoot = $projectRoot
        profileId = $profileId
        profileName = [string]$selection.Record.name
        profilePath = [string]$selection.Path
        plannedExtension = $plannedExtension
        markerPath = [string]$destination.MarkerPath
        destinationRelativePath = [string]$destination.RelativePath
        destinationDirectory = [string]$destination.Directory
    }
}

function Invoke-SaveProfile {
    param([Parameter(Mandatory = $true)]$Request)

    Assert-ObjectProperties -Object $Request `
        -Allowed @('operation', 'profileId', 'name', 'recycleOtherFolders', 'recyclePreviousIgnoredFolders', 'folders', 'programFolders') `
        -Required @('operation', 'name', 'folders') -Label 'save-profile request'

    $profileId = if (Test-ObjectProperty -Object $Request -Name 'profileId') {
        Validate-ProfileId -ProfileId (Get-RequiredString -Object $Request -Name 'profileId' -Label 'save-profile request' -MaximumLength 36 -AllowEmpty) -AllowEmpty
    } else { '' }
    if ([string]::IsNullOrWhiteSpace($profileId)) {
        $profileId = ([guid]::NewGuid()).ToString('D').ToLowerInvariant()
    }
    $name = Get-RequiredString -Object $Request -Name 'name' -Label 'save-profile request' -MaximumLength 120

    # The profile name becomes the generated Button's label, so it has to be
    # unique: two identically named Buttons on one panel would be indistinguishable.
    foreach ($existing in @(Get-AllProfileRecords)) {
        if ($existing.profileId -eq $profileId) { continue }
        if ($existing.name.Equals($name, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Another profile is already named '$name'. Profile names must be unique because they name the installed Button."
        }
    }

    $previous = $null
    $existingPath = Get-ProfilePath -ProfileId $profileId
    if (Test-Path -LiteralPath $existingPath -PathType Leaf) {
        $previous = Read-ProfileRecord -Path $existingPath
    }
    $draft = [pscustomobject]@{
        profileId = $profileId
        name = $name
        recycleOtherFolders = if (Test-ObjectProperty -Object $Request -Name 'recycleOtherFolders') {
            $Request.recycleOtherFolders
        } elseif ($null -ne $previous) { $previous.recycleOtherFolders } else { $false }
        recyclePreviousIgnoredFolders = if (Test-ObjectProperty -Object $Request -Name 'recyclePreviousIgnoredFolders') {
            $Request.recyclePreviousIgnoredFolders
        } elseif ($null -ne $previous) { $previous.recyclePreviousIgnoredFolders } else { $false }
        folders = $Request.folders
        programFolders = if (Test-ObjectProperty -Object $Request -Name 'programFolders') { $Request.programFolders } else { @() }
        createdAt = if ($null -ne $previous) { [string]$previous.createdAt } else { '' }
    }

    $record = ConvertTo-ValidatedProfileRecord -Record $draft -Label 'save-profile request'
    Assert-NoDuplicateExtensionClaims -Folders $record.folders
    foreach ($programFolder in @($record.programFolders)) {
        if ([string]::IsNullOrWhiteSpace($programFolder.profileId)) { continue }
        $nestedPath = Get-ProfilePath -ProfileId $programFolder.profileId
        if (-not (Test-Path -LiteralPath $nestedPath -PathType Leaf)) {
            throw "The profile assigned to the '$($programFolder.groupId)' folder no longer exists."
        }
    }
    Write-AtomicJsonFile -Path (Get-ProfilePath -ProfileId $profileId) -Value $record
    return [ordered]@{ profile = $record }
}

function Invoke-DeleteProfile {
    param([Parameter(Mandatory = $true)]$Request)

    Assert-ObjectProperties -Object $Request -Allowed @('operation', 'profileId') -Required @('operation', 'profileId') -Label 'delete-profile request'
    $profileId = Validate-ProfileId -ProfileId (Get-RequiredString -Object $Request -Name 'profileId' -Label 'delete-profile request' -MaximumLength 36)

    # An installed Button holds only a reference; deleting the profile out from
    # under it would leave a Button that fails on press.
    foreach ($other in @(Get-AllProfileRecords)) {
        if ($other.profileId -eq $profileId) { continue }
        foreach ($programFolder in @($other.programFolders)) {
            if ($programFolder.profileId -eq $profileId) {
                throw "The profile '$($other.name)' uses this profile inside its '$($programFolder.groupId)' folder. Detach it first."
            }
        }
    }

    $owners = @(Get-InstalledProfileButtons | Where-Object { $_.profileId -eq $profileId })
    if ($owners.Count -gt 0) {
        $labels = (@($owners | ForEach-Object { $_.label }) -join ', ')
        throw "This profile is still used by installed Button(s): $labels. Delete those Buttons first."
    }

    $path = Get-ProfilePath -ProfileId $profileId
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        return [ordered]@{ deleted = $false }
    }
    Send-PathToRecycleBin -Path $path
    return [ordered]@{ deleted = $true }
}

function Send-PathToRecycleBin {
    param([Parameter(Mandatory = $true)][string]$Path)

    Add-Type -AssemblyName Microsoft.VisualBasic -ErrorAction Stop
    if (Test-Path -LiteralPath $Path -PathType Container) {
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
            $Path,
            [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
            [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
        return
    }
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
        $Path,
        [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
        [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
}

# --------------------------------------------------------------- folder trees

function Invoke-LoadFolderTree {
    <#
        Copy the folder structure of a real folder into the editor. Reads only:
        nothing in the source folder is created, renamed, moved, or deleted.
        Fills breadth-first so a cap keeps the useful shallow structure instead
        of one deep spine.
    #>
    param([Parameter(Mandatory = $true)]$Request)

    Assert-ObjectProperties -Object $Request `
        -Allowed @('operation', 'rootPath', 'maxFolders') -Required @('operation', 'rootPath') -Label 'load-folder-tree request'

    $root = Resolve-ExistingRoot -RootPath (Get-RequiredString -Object $Request -Name 'rootPath' -Label 'load-folder-tree request' -MaximumLength 32767)
    $cap = $script:DefaultFolderCap
    if (Test-ObjectProperty -Object $Request -Name 'maxFolders') {
        if ($Request.maxFolders -isnot [int] -and $Request.maxFolders -isnot [long] -and $Request.maxFolders -isnot [double]) {
            throw 'load-folder-tree request.maxFolders must be a number.'
        }
        $cap = [int]$Request.maxFolders
    }
    if ($cap -lt 0) { $cap = 0 }
    if ($cap -eq 0 -or $cap -gt $script:MaximumFolders) { $cap = $script:MaximumFolders }

    $folders = [System.Collections.Generic.List[string]]::new()
    $queue = [System.Collections.Generic.Queue[string]]::new()
    $queue.Enqueue($root)
    $totalFound = 0

    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        $children = @()
        try {
            $children = @(Get-ChildItem -LiteralPath $current -Directory -Force -ErrorAction Stop |
                Sort-Object Name)
        }
        catch {
            continue
        }
        foreach ($child in $children) {
            if (($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
            $totalFound += 1
            if ($folders.Count -ge $cap) { continue }
            $folders.Add((ConvertTo-RelativePath -RootPath $root -Path $child.FullName))
            $queue.Enqueue($child.FullName)
        }
        if ($totalFound -gt $script:MaximumFolders) { break }
    }

    return [ordered]@{
        rootPath = $root
        folders = @($folders.ToArray())
        totalFound = $totalFound
        capped = ($totalFound -gt $folders.Count)
    }
}

# ------------------------------------------------------- panels and installing

function Get-WindowsProgramRoot {
    return Join-Path (Resolve-FlowCellRoot) 'Programs\Windows'
}

function Invoke-ListPanels {
    $panelsRoot = Join-Path (Get-WindowsProgramRoot) 'Panels'
    $panels = @()
    if (Test-Path -LiteralPath $panelsRoot -PathType Container) {
        $panels = @(Get-ChildItem -LiteralPath $panelsRoot -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name | ForEach-Object { $_.Name })
    }
    $defaultPanel = if ($panels -contains 'Files') { 'Files' } elseif ($panels.Count -gt 0) { $panels[0] } else { 'Files' }
    return [ordered]@{
        panels = @($panels)
        defaultPanel = $defaultPanel
        currentPanel = $defaultPanel
    }
}

function Get-InstalledProfileButtons {
    <#
        Generated organizer Buttons carry their profile ID in their own manifest.
        Reading them back is what lets the page report a renamed profile whose
        Button label went stale, and refuse a delete that would orphan a Button.
    #>
    $localScripts = Join-Path (Get-WindowsProgramRoot) 'Windows Local Scripts'
    if (-not (Test-Path -LiteralPath $localScripts -PathType Container)) { return @() }

    $profilesByIdentity = @{}
    foreach ($record in @(Get-AllProfileRecords)) { $profilesByIdentity[$record.profileId] = $record }

    $buttons = [System.Collections.Generic.List[object]]::new()
    foreach ($owner in @(Get-ChildItem -LiteralPath $localScripts -Directory -ErrorAction SilentlyContinue)) {
        $manifestPath = Join-Path $owner.FullName 'source\flowcell.script.json'
        if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { continue }
        try {
            $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            continue
        }
        if ($null -eq $manifest -or -not (Test-ObjectProperty -Object $manifest -Name 'source')) { continue }
        if (([string]$manifest.source).Trim() -ne 'organize_folder.ps1') { continue }

        $scriptPath = Join-Path $owner.FullName 'source\organize_folder.ps1'
        if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { continue }
        $scriptBody = Get-Content -LiteralPath $scriptPath -Raw -Encoding UTF8
        $match = [regex]::Match($scriptBody, "\`$script:ProfileId\s*=\s*'([0-9a-fA-F-]{36})'")
        if (-not $match.Success) { continue }
        $profileId = $match.Groups[1].Value.Trim().ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($profileId)) { continue }

        $label = if (Test-ObjectProperty -Object $manifest -Name 'label') { [string]$manifest.label } else { $owner.Name }
        $profileName = ''
        $profileMissing = $true
        if ($profilesByIdentity.ContainsKey($profileId)) {
            $profileName = $profilesByIdentity[$profileId].name
            $profileMissing = $false
        }
        $buttons.Add([ordered]@{
            ownerButtonId = $owner.Name
            label = $label
            profileId = $profileId
            profileName = $profileName
            profileMissing = $profileMissing
            labelStale = (-not $profileMissing -and -not $label.Equals($profileName, [System.StringComparison]::Ordinal))
        })
    }
    return @($buttons.ToArray())
}

function Invoke-ListInstalledButtons {
    return [ordered]@{ buttons = @(Get-InstalledProfileButtons | Sort-Object { $_.label.ToLowerInvariant() }) }
}

function Invoke-StageGeneratedButton {
    param([Parameter(Mandatory = $true)]$Request)

    Assert-ObjectProperties -Object $Request -Allowed @('operation', 'profileId') -Required @('operation', 'profileId') -Label 'stage-generated-button request'
    $profileId = Validate-ProfileId -ProfileId (Get-RequiredString -Object $Request -Name 'profileId' -Label 'stage-generated-button request' -MaximumLength 36)
    $profile = Read-Profile -ProfileId $profileId

    $templatePath = Join-Path $PSScriptRoot 'templates\organize_folder.ps1.template'
    if (-not (Test-Path -LiteralPath $templatePath -PathType Leaf)) {
        throw 'The organizer Button template is missing from the installed package.'
    }
    $template = Get-Content -LiteralPath $templatePath -Raw -Encoding UTF8
    $profileToken = '{{PROFILE_ID}}'
    if (-not $template.Contains($profileToken)) {
        throw 'The organizer Button template has an invalid profile token.'
    }

    $stageToken = ([guid]::NewGuid()).ToString('D').ToLowerInvariant()
    $stageRoot = Join-Path (Get-StagingRoot) $stageToken
    $sourceRoot = Join-Path $stageRoot 'source'
    New-Item -ItemType Directory -Path $sourceRoot -Force | Out-Null

    try {
        $scriptBody = $template.Replace($profileToken, $profileId)
        $scriptPath = Join-Path $sourceRoot 'organize_folder.ps1'
        [System.IO.File]::WriteAllText($scriptPath, $scriptBody, [System.Text.UTF8Encoding]::new($false))

        $packageId = "windows.setup-organization-profile.$profileId"
        $manifest = [ordered]@{
            schemaVersion = 1
            id = $packageId
            label = $profile.name
            tooltip = "Organize the clipboard folder with the '$($profile.name)' Setup Organization profile."
            program = 'Windows'
            source = 'organize_folder.ps1'
        }
        $manifestPath = Join-Path $sourceRoot 'flowcell.script.json'
        Write-AtomicJsonFile -Path $manifestPath -Value $manifest

        $stageManifest = [ordered]@{
            schemaVersion = 1
            format = $script:StageFormat
            namespace = 'windows.setup-organization'
            stageToken = $stageToken
            createdAt = [DateTimeOffset]::UtcNow.ToString('o')
            programName = 'Windows'
            importKind = 'script'
            packageId = $packageId
            sourceManifestRelativePath = 'source/flowcell.script.json'
            sourceManifestSha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
            scriptSha256 = (Get-FileHash -LiteralPath $scriptPath -Algorithm SHA256).Hash.ToLowerInvariant()
            metadata = [ordered]@{ profileId = $profileId }
        }
        Write-AtomicJsonFile -Path (Join-Path $stageRoot 'stage.json') -Value $stageManifest

        return [ordered]@{
            stageToken = $stageToken
            stagedSourcePath = $manifestPath
            profileId = $profileId
            label = $profile.name
        }
    }
    catch {
        if (Test-Path -LiteralPath $stageRoot) {
            Remove-Item -LiteralPath $stageRoot -Recurse -Force
        }
        throw
    }
}

# -------------------------------------------------------------------- dispatch

try {
    if ($FlowCellCapability -ne $script:CapabilityId) {
        throw "Unsupported Windows capability '$FlowCellCapability'."
    }
    $request = Read-Request
    Assert-ObjectProperties -Object $request `
        -Allowed @('operation', 'rootPath', 'maxFolders', 'projectRoot', 'plannedExtension', 'profileId', 'profilePath', 'name', 'recycleOtherFolders', 'recyclePreviousIgnoredFolders', 'folders', 'programFolders', 'groupId', 'label', 'fileTypes', 'isProgram') `
        -Required @('operation') `
        -Label 'Capability request'
    $operation = Get-RequiredString -Object $request -Name 'operation' -Label 'Capability request' -MaximumLength 64
    $response = switch ($operation) {
        'load-folder-tree' { Invoke-LoadFolderTree -Request $request; break }
        'list-profiles' { Invoke-ListProfiles; break }
        'load-profile' { Invoke-LoadProfile -Request $request; break }
        'prepare-target' { Invoke-PrepareTarget -Request $request; break }
        'prepare-existing-target' { Invoke-PrepareExistingTarget -Request $request; break }
        'save-profile' { Invoke-SaveProfile -Request $request; break }
        'delete-profile' { Invoke-DeleteProfile -Request $request; break }
        'list-file-groups' { Invoke-ListFileGroups; break }
        'save-file-group' { Invoke-SaveFileGroup -Request $request; break }
        'delete-file-group' { Invoke-DeleteFileGroup -Request $request; break }
        'list-panels' { Invoke-ListPanels; break }
        'list-installed-buttons' { Invoke-ListInstalledButtons; break }
        'stage-generated-button' { Invoke-StageGeneratedButton -Request $request; break }
        default { throw "Unsupported Setup Organization operation '$operation'." }
    }
    Write-JsonResponse -Value $response
    exit 0
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
