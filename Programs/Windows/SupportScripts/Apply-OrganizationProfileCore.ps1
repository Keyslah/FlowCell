param(
    [string]$ProfileName = '',
    [string]$ProfilePath = '',
    [Parameter(Mandatory = $true)][string]$ProjectPath,
    [switch]$PassThruJson
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Find-FlowCellRoot([string]$StartPath) {
    $current = [System.IO.Path]::GetFullPath($StartPath)
    while (-not [string]::IsNullOrWhiteSpace($current) -and (Test-Path -LiteralPath $current -PathType Container)) {
        if ((Test-Path -LiteralPath (Join-Path $current 'PROGRAM_SUMMARY.txt') -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path $current 'FlowCell') -PathType Container)) { return $current }
        $parent = Split-Path -Parent $current
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current) { break }
        $current = $parent
    }
    throw 'Could not locate the FlowCell repository root from this script location.'
}

$repo = Find-FlowCellRoot -StartPath $PSScriptRoot
$profilesRoot = Join-Path $repo 'FlowCell\local\Folder Tree Profiles'
$treesRoot = Join-Path $repo 'FlowCell\local\Folder Trees'

$savedProfilePath = ''
$skeleton = ''
if (-not [string]::IsNullOrWhiteSpace($ProfilePath)) {
    $savedProfilePath = [System.IO.Path]::GetFullPath($ProfilePath)
    if (-not (Test-Path -LiteralPath $savedProfilePath -PathType Leaf)) {
        throw "Organization profile not found: $savedProfilePath"
    }
    if ([string]::IsNullOrWhiteSpace($ProfileName)) {
        $ProfileName = [System.IO.Path]::GetFileNameWithoutExtension($savedProfilePath)
    }
}
elseif (-not [string]::IsNullOrWhiteSpace($ProfileName)) {
    $savedProfilePath = Join-Path $profilesRoot ($ProfileName + '.json')
    if (-not (Test-Path -LiteralPath $savedProfilePath -PathType Leaf)) {
        throw "Saved profile not found: $ProfileName. Save it in Setup Organization first."
    }
    $skeleton = Join-Path $treesRoot $ProfileName
}
else {
    throw 'ProfileName or ProfilePath is required.'
}

$target = [System.IO.Path]::GetFullPath($ProjectPath)
if (-not (Test-Path -LiteralPath $target -PathType Container)) {
    throw "Target folder does not exist: $target"
}

$profile = Get-Content -LiteralPath $savedProfilePath -Raw -Encoding UTF8 | ConvertFrom-Json

function Get-ProfilePropertyValue {
    param([object]$Object, [string]$Name, [object]$Default = $null)
    if ($null -eq $Object) { return $Default }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $Default }
    return $property.Value
}

function Normalize-Extension([string]$Value) {
    $extension = $Value.Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($extension)) { return '' }
    if (-not $extension.StartsWith('.')) { $extension = '.' + $extension }
    return $extension
}

function Get-UnnumberedFolderName([string]$Name) {
    return ([System.Text.RegularExpressions.Regex]::Replace($Name, '^\d+\s+', '')).Trim()
}

function Get-DuplicateInfo([string]$Stem) {
    $working = $Stem.Trim()
    $changed = $false
    $patterns = @(
        '(?i)(?:[\s._-]+copy(?:\s*\(\d+\)|\s+\d+)?)$',
        '(?i)(?:[\s._-]+final(?:\s+\d+)?)$',
        '(?i)(?:[\s._-]+v(?:er(?:sion)?)?[\s._-]*\d+)$'
    )
    do {
        $previous = $working
        foreach ($pattern in $patterns) {
            $updated = [System.Text.RegularExpressions.Regex]::Replace($working, $pattern, '')
            if ($updated -ne $working) {
                $working = $updated.Trim(' ', '.', '_', '-')
                $changed = $true
            }
        }
    } while ($working -ne $previous)
    if ([string]::IsNullOrWhiteSpace($working)) { $working = $Stem.Trim() }
    return [PSCustomObject]@{
        Key = $working.ToLowerInvariant()
        DisplayBase = $working
        WasVersioned = $changed
    }
}

function Get-NextProgramFolderNumber([string]$SrcRoot) {
    $numbers = @()
    if (Test-Path -LiteralPath $SrcRoot -PathType Container) {
        foreach ($directory in Get-ChildItem -LiteralPath $SrcRoot -Directory -Force) {
            if ($directory.Name -eq '00 assets') { continue }
            if ($directory.Name -match '^(\d+)\s+') { $numbers += [int]$Matches[1] }
        }
    }
    if ($numbers.Count -eq 0) { return 1 }
    return (($numbers | Measure-Object -Maximum).Maximum + 1)
}

function Resolve-ProgramRoot([string]$SrcRoot, [string]$Name) {
    $existing = @(
        Get-ChildItem -LiteralPath $SrcRoot -Directory -Force -ErrorAction SilentlyContinue |
            Where-Object {
                [string]::Equals(
                    (Get-UnnumberedFolderName -Name $_.Name),
                    $Name,
                    [System.StringComparison]::OrdinalIgnoreCase
                )
            } |
            Sort-Object Name |
            Select-Object -First 1
    )
    if ($existing.Count -gt 0) { return $existing[0].FullName }
    $number = Get-NextProgramFolderNumber -SrcRoot $SrcRoot
    return (Join-Path $SrcRoot ('{0:D2} {1}' -f $number, $Name))
}

function Get-AvailableSnapshotPath([string]$Directory, [string]$BaseName, [string]$Extension) {
    $index = 1
    while ($true) {
        $candidate = Join-Path $Directory ('{0} (S{1:D2}){2}' -f $BaseName, $index, $Extension)
        if (-not (Test-Path -LiteralPath $candidate)) { return $candidate }
        $index++
    }
}

function Test-SamePath([string]$Left, [string]$Right) {
    return [string]::Equals(
        [System.IO.Path]::GetFullPath($Left),
        [System.IO.Path]::GetFullPath($Right),
        [System.StringComparison]::OrdinalIgnoreCase
    )
}

$moves = New-Object System.Collections.Generic.List[object]
$snapshots = New-Object System.Collections.Generic.List[object]
$programFoldersCreated = New-Object System.Collections.Generic.List[string]
$programFoldersUsed = New-Object System.Collections.Generic.List[string]
$conflicts = New-Object System.Collections.Generic.List[string]

function Move-ProfileFile {
    param(
        [Parameter(Mandatory = $true)][System.IO.FileInfo]$File,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][string]$Reason
    )
    if (Test-SamePath -Left $File.FullName -Right $Destination) { return $Destination }
    if (Test-Path -LiteralPath $Destination) {
        $conflicts.Add(('{0} -> {1} [{2}; destination exists]' -f $File.FullName, $Destination, $Reason)) | Out-Null
        return $null
    }
    $destinationDirectory = Split-Path -Parent $Destination
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    Move-Item -LiteralPath $File.FullName -Destination $Destination
    if ((Test-Path -LiteralPath $File.FullName) -or -not (Test-Path -LiteralPath $Destination -PathType Leaf)) {
        throw "Move verification failed: $($File.FullName) -> $Destination"
    }
    $moves.Add([PSCustomObject][ordered]@{
        source = $File.FullName
        destination = $Destination
        reason = $Reason
    }) | Out-Null
    return $Destination
}

function Get-ProgramDefinitions([object]$Profile) {
    $rolesById = @{}
    foreach ($role in @(Get-ProfilePropertyValue $Profile 'roles' @())) {
        $roleId = ([string](Get-ProfilePropertyValue $role 'roleId' '')).Trim().ToLowerInvariant()
        if (-not [string]::IsNullOrWhiteSpace($roleId)) { $rolesById[$roleId] = $role }
    }

    $definitions = New-Object System.Collections.Generic.List[object]
    foreach ($program in @(Get-ProfilePropertyValue $Profile 'programFolders' @())) {
        $programId = ([string](Get-ProfilePropertyValue $program 'programId' '')).Trim().ToLowerInvariant()
        $displayName = ([string](Get-ProfilePropertyValue $program 'displayName' $programId)).Trim()
        if ([string]::IsNullOrWhiteSpace($programId) -or [string]::IsNullOrWhiteSpace($displayName)) { continue }
        if ($displayName -in @('.', '..') -or $displayName.IndexOfAny([System.IO.Path]::GetInvalidFileNameChars()) -ge 0) {
            throw "Program folder name is not a valid Windows folder name: $displayName"
        }

        $extensions = New-Object System.Collections.Generic.List[string]
        $extensionSet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($raw in @(Get-ProfilePropertyValue $program 'fileTypes' @())) {
            $extension = Normalize-Extension ([string]$raw)
            if ($extension -and $extensionSet.Add($extension)) { $extensions.Add($extension) | Out-Null }
        }
        foreach ($roleIdValue in @(Get-ProfilePropertyValue $program 'roles' @())) {
            $roleId = ([string]$roleIdValue).Trim().ToLowerInvariant()
            if (-not $rolesById.ContainsKey($roleId)) { continue }
            foreach ($raw in @(Get-ProfilePropertyValue $rolesById[$roleId] 'fileTypes' @())) {
                $extension = Normalize-Extension ([string]$raw)
                if ($extension -and $extensionSet.Add($extension)) { $extensions.Add($extension) | Out-Null }
            }
        }
        $definitions.Add([PSCustomObject][ordered]@{
            ProgramId = $programId
            Name = $displayName
            Extensions = $extensions.ToArray()
            Conditional = [bool](Get-ProfilePropertyValue $program 'createOnlyIfMatchingFilesOrRolesPresent' $true)
        }) | Out-Null
    }
    return $definitions.ToArray()
}

# Recreate the saved folder structure inside the target root (additive only;
# existing files are never touched).
$foldersCreated = 0
if (-not [string]::IsNullOrWhiteSpace($skeleton) -and (Test-Path -LiteralPath $skeleton -PathType Container)) {
    $skeletonFull = (Get-Item -LiteralPath $skeleton).FullName
    foreach ($directory in (Get-ChildItem -LiteralPath $skeleton -Recurse -Directory -Force)) {
        $relative = $directory.FullName.Substring($skeletonFull.Length).Trim('\', '/')
        if ([string]::IsNullOrWhiteSpace($relative)) { continue }
        $destination = Join-Path $target $relative
        if (-not (Test-Path -LiteralPath $destination -PathType Container)) {
            New-Item -ItemType Directory -Path $destination -Force | Out-Null
            $foldersCreated++
        }
    }
}

# Write the profile into the target root so the dynamic organizer can use it.
# Write UTF-8 *without* a BOM so the Rust reader (serde_json) can parse it.
$profile | Add-Member -NotePropertyName projectRoot -NotePropertyValue $target -Force
$profileOut = Join-Path $target 'organize-folder.profile.json'
$profileJson = ($profile | ConvertTo-Json -Depth 12) + [Environment]::NewLine
[System.IO.File]::WriteAllText($profileOut, $profileJson, (New-Object System.Text.UTF8Encoding $false))

# Program folders are conditional working-file destinations. They live beside
# 00 assets under 01 src and always receive the four standard lifecycle folders.
$srcRoot = Join-Path $target '01 src'
$assetsRoot = Join-Path $srcRoot '00 assets'
$programDefinitions = @(Get-ProgramDefinitions -Profile $profile)

$allFiles = @(
    Get-ChildItem -LiteralPath $target -Recurse -File -Force | Where-Object {
        -not $_.Name.ToLowerInvariant().StartsWith('organize-folder.') -and
        $_.FullName -notmatch '(?i)[\\/](?:02 snapshots|03 archive|04 trash)[\\/]'
    }
)

$extensionOwners = @{}
foreach ($definition in $programDefinitions) {
    foreach ($extension in @($definition.Extensions)) {
        if (-not $extensionOwners.ContainsKey($extension)) {
            $extensionOwners[$extension] = New-Object System.Collections.Generic.List[object]
        }
        $extensionOwners[$extension].Add($definition) | Out-Null
    }
}

foreach ($extension in @($extensionOwners.Keys)) {
    if ($extensionOwners[$extension].Count -gt 1) {
        $owners = @($extensionOwners[$extension] | ForEach-Object { $_.Name }) -join ', '
        $conflicts.Add(("Program file type {0} is assigned to multiple program folders: {1}" -f $extension, $owners)) | Out-Null
    }
}

foreach ($definition in $programDefinitions) {
    $ownedExtensions = @($definition.Extensions | Where-Object { $extensionOwners[$_].Count -eq 1 })
    $matchingFiles = @($allFiles | Where-Object { $ownedExtensions -contains $_.Extension.ToLowerInvariant() })
    if ($matchingFiles.Count -eq 0 -and $definition.Conditional) { continue }

    New-Item -ItemType Directory -Path $assetsRoot -Force | Out-Null
    $programRoot = Resolve-ProgramRoot -SrcRoot $srcRoot -Name $definition.Name
    $programExisted = Test-Path -LiteralPath $programRoot -PathType Container
    $liveDirectory = Join-Path $programRoot '01 live'
    $snapshotsDirectory = Join-Path $programRoot '02 snapshots'
    foreach ($directory in @($liveDirectory, $snapshotsDirectory, (Join-Path $programRoot '03 archive'), (Join-Path $programRoot '04 trash'))) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    if ($programExisted) { $programFoldersUsed.Add($programRoot) | Out-Null }
    else { $programFoldersCreated.Add($programRoot) | Out-Null }

    $items = @($matchingFiles | ForEach-Object {
        [PSCustomObject]@{
            File = $_
            Info = Get-DuplicateInfo -Stem ([System.IO.Path]::GetFileNameWithoutExtension($_.Name))
        }
    })
    $processed = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($extensionGroup in ($items | Group-Object { $_.File.Extension.ToLowerInvariant() })) {
        foreach ($family in ($extensionGroup.Group | Group-Object { $_.Info.Key })) {
            $members = @($family.Group)
            if ($members.Count -lt 2 -or -not ($members | Where-Object { $_.Info.WasVersioned })) { continue }
            $members = @($members | Sort-Object @{ Expression = { $_.File.LastWriteTimeUtc }; Descending = $true }, @{ Expression = { $_.File.FullName } })
            $displayBase = @($members | Where-Object { -not $_.Info.WasVersioned } | Select-Object -First 1).Info.DisplayBase
            if ([string]::IsNullOrWhiteSpace([string]$displayBase)) { $displayBase = $members[0].Info.DisplayBase }

            $liveMember = $members[0]
            $liveDestination = Join-Path $liveDirectory $liveMember.File.Name
            if ($null -ne (Move-ProfileFile -File $liveMember.File -Destination $liveDestination -Reason 'program-live')) {
                $null = $processed.Add($liveMember.File.FullName)
                foreach ($snapshotMember in @($members | Select-Object -Skip 1 | Sort-Object @{ Expression = { $_.File.LastWriteTimeUtc } }, @{ Expression = { $_.File.FullName } })) {
                    $snapshotDestination = Get-AvailableSnapshotPath -Directory $snapshotsDirectory -BaseName $displayBase -Extension $snapshotMember.File.Extension
                    if ($null -ne (Move-ProfileFile -File $snapshotMember.File -Destination $snapshotDestination -Reason 'program-snapshot')) {
                        $snapshots.Add([PSCustomObject][ordered]@{
                            source = $snapshotMember.File.FullName
                            destination = $snapshotDestination
                        }) | Out-Null
                    }
                    $null = $processed.Add($snapshotMember.File.FullName)
                }
            }
        }
    }

    foreach ($file in ($matchingFiles | Sort-Object FullName)) {
        if ($processed.Contains($file.FullName)) { continue }
        $null = Move-ProfileFile -File $file -Destination (Join-Path $liveDirectory $file.Name) -Reason 'program-live'
    }
}

$result = [PSCustomObject]@{
    profileName    = $ProfileName
    projectRoot    = $target
    profilePath    = $profileOut
    foldersCreated = $foldersCreated
    programFoldersCreated = $programFoldersCreated.ToArray()
    programFoldersUsed = $programFoldersUsed.ToArray()
    filesMoved = $moves.Count
    snapshotsCreated = $snapshots.Count
    conflicts = $conflicts.ToArray()
}

if ($PassThruJson) { $result | ConvertTo-Json -Depth 6 } else { $result | Format-List | Out-String }
