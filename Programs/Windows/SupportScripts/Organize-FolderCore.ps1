param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectPath,

    [string]$LogPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-AbsolutePath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [System.IO.Path]::GetFullPath($Path)
}

function Compare-Path {
    param(
        [Parameter(Mandatory = $true)][string]$Left,
        [Parameter(Mandatory = $true)][string]$Right
    )

    return [string]::Equals(
        (Get-AbsolutePath -Path $Left),
        (Get-AbsolutePath -Path $Right),
        [System.StringComparison]::OrdinalIgnoreCase
    )
}

function Test-PathUnder {
    param(
        [Parameter(Mandatory = $true)][string]$Candidate,
        [Parameter(Mandatory = $true)][string]$Parent
    )

    $candidateFull = (Get-AbsolutePath -Path $Candidate).TrimEnd('\')
    $parentFull = (Get-AbsolutePath -Path $Parent).TrimEnd('\')
    return $candidateFull.StartsWith($parentFull + '\', [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-ProjectRelativePath {
    param(
        [Parameter(Mandatory = $true)][string]$FullPath,
        [Parameter(Mandatory = $true)][string]$RootPath
    )

    $rootUri = New-Object System.Uri((Get-AbsolutePath -Path $RootPath).TrimEnd('\') + '\')
    $itemUri = New-Object System.Uri((Get-AbsolutePath -Path $FullPath))
    $relative = $rootUri.MakeRelativeUri($itemUri).ToString()
    return [System.Uri]::UnescapeDataString($relative).Replace('/', '\')
}

function Test-DirectoryEmpty {
    param([Parameter(Mandatory = $true)][string]$DirectoryPath)
    return -not (Get-ChildItem -LiteralPath $DirectoryPath -Force -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Test-OrganizerLogFile {
    param([Parameter(Mandatory = $true)][string]$FullPath)

    $fileName = [System.IO.Path]::GetFileName($FullPath)
    return $fileName -match '^(organize-folder|fix-this-folder)(?: \(\d+\))?\.log\.txt$'
}

function Send-DirectoryToRecycleBin {
    param([Parameter(Mandatory = $true)][string]$DirectoryPath)

    Add-Type -AssemblyName Microsoft.VisualBasic -ErrorAction SilentlyContinue
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
        $DirectoryPath,
        [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
        [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin,
        [Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException
    )
}

function Recycle-EmptyDirectory {
    param([Parameter(Mandatory = $true)][string]$DirectoryPath)

    if (-not (Test-Path -LiteralPath $DirectoryPath -PathType Container)) {
        return $false
    }

    if (-not (Test-DirectoryEmpty -DirectoryPath $DirectoryPath)) {
        return $false
    }

    Send-DirectoryToRecycleBin -DirectoryPath $DirectoryPath
    $script:recycledDirectories.Add((Get-ProjectRelativePath -FullPath $DirectoryPath -RootPath $script:projectRoot)) | Out-Null
    return $true
}

function Get-DuplicateInfo {
    param([Parameter(Mandatory = $true)][string]$Stem)

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

    if ([string]::IsNullOrWhiteSpace($working)) {
        $working = $Stem.Trim()
    }

    return [PSCustomObject]@{
        Key          = $working.ToLowerInvariant()
        DisplayBase  = $working
        WasVersioned = $changed
    }
}

function Get-AvailableSnapshotPath {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [Parameter(Mandatory = $true)][string]$BaseName,
        [Parameter(Mandatory = $true)][string]$Extension
    )

    $index = 1
    while ($true) {
        $label = 'S{0:D2}' -f $index
        $candidatePath = Join-Path $Directory ('{0} ({1}){2}' -f $BaseName, $label, $Extension)
        if (-not (Test-Path -LiteralPath $candidatePath)) {
            return $candidatePath
        }
        $index++
    }
}

function Move-TrackedFile {
    param(
        [Parameter(Mandatory = $true)][System.IO.FileInfo]$File,
        [Parameter(Mandatory = $true)][string]$DestinationPath,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    $destinationFull = Get-AbsolutePath -Path $DestinationPath
    $destinationDir = Split-Path -Path $destinationFull -Parent
    $null = New-Item -ItemType Directory -Path $destinationDir -Force

    if (Compare-Path -Left $File.FullName -Right $destinationFull) {
        $script:verified.Add([PSCustomObject]@{
            Source      = $File.FullName
            Destination = $destinationFull
            Status      = 'Kept'
        }) | Out-Null
        return $destinationFull
    }

    if (Test-Path -LiteralPath $destinationFull) {
        $conflictMessage = '{0} -> {1} [{2}]' -f `
            (Get-ProjectRelativePath -FullPath $File.FullName -RootPath $script:projectRoot), `
            (Get-ProjectRelativePath -FullPath $destinationFull -RootPath $script:projectRoot), `
            $Reason
        $script:conflicts.Add($conflictMessage) | Out-Null
        $script:unresolved.Add($conflictMessage) | Out-Null
        return $null
    }

    Move-Item -LiteralPath $File.FullName -Destination $destinationFull

    if ((-not (Test-Path -LiteralPath $destinationFull)) -or (Test-Path -LiteralPath $File.FullName)) {
        throw "Move verification failed: $($File.FullName) -> $destinationFull"
    }

    $script:moves.Add([PSCustomObject]@{
        Source      = $File.FullName
        Destination = $destinationFull
        Reason      = $Reason
    }) | Out-Null

    $script:verified.Add([PSCustomObject]@{
        Source      = $File.FullName
        Destination = $destinationFull
        Status      = 'Moved'
    }) | Out-Null

    return $destinationFull
}

function Move-StructureDirectoryIfObvious {
    param(
        [Parameter(Mandatory = $true)][string]$LegacyPath,
        [Parameter(Mandatory = $true)][string]$CanonicalPath
    )

    if (-not (Test-Path -LiteralPath $LegacyPath -PathType Container)) {
        return
    }

    if (Compare-Path -Left $LegacyPath -Right $CanonicalPath) {
        return
    }

    if (-not (Test-Path -LiteralPath $CanonicalPath)) {
        Move-Item -LiteralPath $LegacyPath -Destination $CanonicalPath
        $script:renamedDirectories.Add(('{0} -> {1}' -f `
            (Get-ProjectRelativePath -FullPath $LegacyPath -RootPath $script:projectRoot), `
            (Get-ProjectRelativePath -FullPath $CanonicalPath -RootPath $script:projectRoot))) | Out-Null
        return
    }

    if (Recycle-EmptyDirectory -DirectoryPath $LegacyPath) {
        return
    }

    $script:unresolved.Add(('{0} [legacy structure collides with {1}]' -f `
        (Get-ProjectRelativePath -FullPath $LegacyPath -RootPath $script:projectRoot), `
        (Get-ProjectRelativePath -FullPath $CanonicalPath -RootPath $script:projectRoot))) | Out-Null
}

function Get-LeadingFolderNumber {
    param([Parameter(Mandatory = $true)][string]$Name)

    if ($Name -match '^(\d+)\s+') {
        return [int]$Matches[1]
    }

    return $null
}

function Get-UnnumberedFolderName {
    param([Parameter(Mandatory = $true)][string]$Name)
    return ([System.Text.RegularExpressions.Regex]::Replace($Name, '^\d+\s+', '')).Trim()
}

function Get-ProgramDefinitionForFile {
    param([Parameter(Mandatory = $true)][System.IO.FileInfo]$File)

    $extension = $File.Extension.ToLowerInvariant()
    foreach ($definition in $script:programDefinitions) {
        if ($definition.Extensions -contains $extension) {
            return $definition
        }
    }

    return $null
}

function Get-ExistingProgramRoot {
    param([Parameter(Mandatory = $true)][object]$Definition)

    if (-not (Test-Path -LiteralPath $paths.SrcRoot -PathType Container)) {
        return $null
    }

    $matches = Get-ChildItem -LiteralPath $paths.SrcRoot -Directory -Force | Where-Object {
        $name = Get-UnnumberedFolderName -Name $_.Name
        [string]::Equals($name, $Definition.Name, [System.StringComparison]::OrdinalIgnoreCase)
    } | Sort-Object `
        @{ Expression = { $number = Get-LeadingFolderNumber -Name $_.Name; if ($null -eq $number) { 9999 } else { $number } } }, `
        @{ Expression = { $_.Name } }

    $firstMatch = @($matches | Select-Object -First 1)
    if ($firstMatch.Count -eq 0) {
        return $null
    }

    return $firstMatch[0]
}

function Get-NextProgramFolderNumber {
    $numbers = @()
    if (Test-Path -LiteralPath $paths.SrcRoot -PathType Container) {
        foreach ($directory in Get-ChildItem -LiteralPath $paths.SrcRoot -Directory -Force) {
            if ($directory.Name -eq '00 assets') {
                continue
            }
            $number = Get-LeadingFolderNumber -Name $directory.Name
            if ($null -ne $number) {
                $numbers += $number
            }
        }
    }

    if (@($numbers).Count -eq 0) {
        return 1
    }

    return (($numbers | Measure-Object -Maximum).Maximum + 1)
}

function Ensure-ProgramSubfolders {
    param([Parameter(Mandatory = $true)][string]$ProgramRoot)

    $subfolders = @(
        @{ Legacy = 'live'; Canonical = '01 live' },
        @{ Legacy = 'snapshots'; Canonical = '02 snapshots' },
        @{ Legacy = 'archive'; Canonical = '03 archive' },
        @{ Legacy = 'trash'; Canonical = '04 trash' }
    )

    foreach ($subfolder in $subfolders) {
        $legacyPath = Join-Path $ProgramRoot $subfolder.Legacy
        $canonicalPath = Join-Path $ProgramRoot $subfolder.Canonical
        Move-StructureDirectoryIfObvious -LegacyPath $legacyPath -CanonicalPath $canonicalPath
        $null = New-Item -ItemType Directory -Path $canonicalPath -Force
    }
}

function Resolve-ProgramRoot {
    param([Parameter(Mandatory = $true)][object]$Definition)

    if ($script:programRoots.ContainsKey($Definition.Key)) {
        return $script:programRoots[$Definition.Key]
    }

    $existing = Get-ExistingProgramRoot -Definition $Definition
    if ($null -ne $existing) {
        $programRoot = $existing.FullName
        $script:usedProgramDirectories.Add((Get-ProjectRelativePath -FullPath $programRoot -RootPath $script:projectRoot)) | Out-Null
    }
    else {
        $nextNumber = Get-NextProgramFolderNumber
        $programRoot = Join-Path $paths.SrcRoot ('{0:D2} {1}' -f $nextNumber, $Definition.Name)
        $null = New-Item -ItemType Directory -Path $programRoot -Force
        $script:createdProgramDirectories.Add((Get-ProjectRelativePath -FullPath $programRoot -RootPath $script:projectRoot)) | Out-Null
    }

    Ensure-ProgramSubfolders -ProgramRoot $programRoot
    $script:programRoots[$Definition.Key] = $programRoot
    return $programRoot
}

function Get-LiveDirectoryForDefinition {
    param([Parameter(Mandatory = $true)][object]$Definition)
    return (Join-Path (Resolve-ProgramRoot -Definition $Definition) '01 live')
}

function Get-SnapshotsDirectoryForDefinition {
    param([Parameter(Mandatory = $true)][object]$Definition)
    return (Join-Path (Resolve-ProgramRoot -Definition $Definition) '02 snapshots')
}

function Get-DestinationDirectory {
    param([Parameter(Mandatory = $true)][System.IO.FileInfo]$File)

    $programDefinition = Get-ProgramDefinitionForFile -File $File
    if ($null -ne $programDefinition) {
        return Get-LiveDirectoryForDefinition -Definition $programDefinition
    }

    switch ($File.Extension.ToLowerInvariant()) {
        { $_ -in @('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.webp') } { return $paths.AssetsImages }
        '.svg' { return $paths.AssetsSvg }
        { $_ -in @('.obj', '.stl', '.mtl', '.3mf', '.fbx', '.dae', '.3ds', '.glb', '.gltf', '.abc', '.ply', '.x3d', '.usd', '.usda', '.usdc') } { return $paths.Assets3d }
        { $_ -in @('.exr', '.hdr', '.tga', '.dds', '.ktx', '.ktx2') } { return $paths.AssetsTextures }
        default { return $paths.AssetsUnknown }
    }
}

function Test-ExcludedSourceFile {
    param([Parameter(Mandatory = $true)][string]$FullPath)

    if (Compare-Path -Left $FullPath -Right $logFullPath) {
        return $true
    }

    if (Test-OrganizerLogFile -FullPath $FullPath) {
        return $true
    }

    foreach ($excludedRoot in $script:excludeRoots) {
        if ((Test-Path -LiteralPath $excludedRoot -PathType Container) -and
            ((Compare-Path -Left $FullPath -Right $excludedRoot) -or (Test-PathUnder -Candidate $FullPath -Parent $excludedRoot))) {
            return $true
        }
    }

    return $false
}

function Add-ProgramArchiveExclusions {
    param([Parameter(Mandatory = $true)][string]$ProgramRoot)

    foreach ($folderName in @('02 snapshots', '03 archive', '04 trash', 'snapshots', 'archive', 'trash')) {
        $script:excludeRoots += (Join-Path $ProgramRoot $folderName)
    }
}

function Add-PreservedStructureDirectory {
    param([Parameter(Mandatory = $true)][string]$DirectoryPath)

    if (Test-Path -LiteralPath $DirectoryPath -PathType Container) {
        $null = $script:structureDirectorySet.Add((Get-AbsolutePath -Path $DirectoryPath))
    }
}

function Stamp-StructureDirectories {
    $groups = @(
        @($paths.SrcRoot, $paths.Builds, $paths.Releases, $paths.RootArchive),
        @($paths.AssetsRoot, $paths.AssetsImages, $paths.AssetsSvg, $paths.Assets3d, $paths.AssetsTextures, $paths.AssetsUnknown)
    )

    if (Test-Path -LiteralPath $paths.SrcRoot -PathType Container) {
        $srcChildren = Get-ChildItem -LiteralPath $paths.SrcRoot -Directory -Force |
            Sort-Object @{ Expression = { $number = Get-LeadingFolderNumber -Name $_.Name; if ($null -eq $number) { 9999 } else { $number } } }, Name |
            Select-Object -ExpandProperty FullName
        $groups += ,@($srcChildren)
    }

    foreach ($programRoot in $script:programRoots.Values) {
        $groups += ,@(
            (Join-Path $programRoot '01 live'),
            (Join-Path $programRoot '02 snapshots'),
            (Join-Path $programRoot '03 archive'),
            (Join-Path $programRoot '04 trash')
        )
    }

    $minute = 0
    foreach ($group in $groups) {
        $existing = @($group | Where-Object { Test-Path -LiteralPath $_ -PathType Container })
        [array]::Reverse($existing)
        foreach ($directoryPath in $existing) {
            try {
                $item = Get-Item -LiteralPath $directoryPath
                $item.LastWriteTime = ([datetime]'2000-01-01T00:00:00').AddMinutes($minute)
                $minute++
            }
            catch {
                $script:unresolved.Add(('{0} [timestamp stamp failed: {1}]' -f `
                    (Get-ProjectRelativePath -FullPath $directoryPath -RootPath $script:projectRoot), `
                    $_.Exception.Message)) | Out-Null
            }
        }
    }
}

if (-not (Test-Path -LiteralPath $ProjectPath -PathType Container)) {
    throw "Project folder does not exist: $ProjectPath"
}

$script:projectRoot = (Get-Item -LiteralPath $ProjectPath).FullName

if ([string]::IsNullOrWhiteSpace($LogPath)) {
    $LogPath = Join-Path $script:projectRoot 'organize-folder.log.txt'
}

$logFullPath = Get-AbsolutePath -Path $LogPath
if (Test-Path -LiteralPath $logFullPath) {
    $counter = 2
    do {
        $candidate = Join-Path $script:projectRoot ('organize-folder ({0}).log.txt' -f $counter)
        $logFullPath = Get-AbsolutePath -Path $candidate
        $counter++
    } while (Test-Path -LiteralPath $logFullPath)
}

$paths = [ordered]@{
    SrcRoot        = Join-Path $script:projectRoot '01 src'
    AssetsRoot     = Join-Path $script:projectRoot '01 src\00 assets'
    AssetsImages   = Join-Path $script:projectRoot '01 src\00 assets\01 images'
    AssetsSvg      = Join-Path $script:projectRoot '01 src\00 assets\02 svg'
    Assets3d       = Join-Path $script:projectRoot '01 src\00 assets\03 3d'
    AssetsTextures = Join-Path $script:projectRoot '01 src\00 assets\04 textures'
    AssetsUnknown  = Join-Path $script:projectRoot '01 src\00 assets\05 unknown'
    Builds         = Join-Path $script:projectRoot '02 builds'
    Releases       = Join-Path $script:projectRoot '03 releases'
    RootArchive    = Join-Path $script:projectRoot '04 archive'
}

$script:programDefinitions = @(
    [PSCustomObject]@{ Key = 'blender'; Name = 'Blender'; Extensions = @('.blend') },
    [PSCustomObject]@{ Key = 'illustrator'; Name = 'Illustrator'; Extensions = @('.ai') },
    [PSCustomObject]@{ Key = 'photoshop'; Name = 'Photoshop'; Extensions = @('.psd', '.psb') }
)

$script:moves = New-Object System.Collections.Generic.List[object]
$script:duplicates = New-Object System.Collections.Generic.List[object]
$script:snapshots = New-Object System.Collections.Generic.List[object]
$script:conflicts = New-Object System.Collections.Generic.List[string]
$script:unresolved = New-Object System.Collections.Generic.List[string]
$script:renamedDirectories = New-Object System.Collections.Generic.List[string]
$script:recycledDirectories = New-Object System.Collections.Generic.List[string]
$script:createdProgramDirectories = New-Object System.Collections.Generic.List[string]
$script:usedProgramDirectories = New-Object System.Collections.Generic.List[string]
$script:verified = New-Object System.Collections.Generic.List[object]
$script:programRoots = @{}
$script:excludeRoots = @()
$script:structureDirectorySet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

Move-StructureDirectoryIfObvious -LegacyPath (Join-Path $script:projectRoot 'src') -CanonicalPath $paths.SrcRoot
Move-StructureDirectoryIfObvious -LegacyPath (Join-Path $script:projectRoot 'builds') -CanonicalPath $paths.Builds
Move-StructureDirectoryIfObvious -LegacyPath (Join-Path $script:projectRoot 'releases') -CanonicalPath $paths.Releases
Move-StructureDirectoryIfObvious -LegacyPath (Join-Path $script:projectRoot 'archive') -CanonicalPath $paths.RootArchive

foreach ($path in @($paths.SrcRoot, $paths.AssetsRoot, $paths.AssetsImages, $paths.AssetsSvg, $paths.Assets3d, $paths.AssetsTextures, $paths.AssetsUnknown, $paths.Builds, $paths.Releases, $paths.RootArchive)) {
    $null = New-Item -ItemType Directory -Path $path -Force
}

$initialSourceFiles = Get-ChildItem -LiteralPath $script:projectRoot -Recurse -File -Force | Where-Object {
    -not (Compare-Path -Left $_.FullName -Right $logFullPath) -and
    -not (Test-OrganizerLogFile -FullPath $_.FullName) -and
    -not (Test-PathUnder -Candidate $_.FullName -Parent $paths.Builds) -and
    -not (Test-PathUnder -Candidate $_.FullName -Parent $paths.Releases) -and
    -not (Test-PathUnder -Candidate $_.FullName -Parent $paths.RootArchive)
}

$detectedDefinitions = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([System.StringComparer]::OrdinalIgnoreCase)
foreach ($file in $initialSourceFiles) {
    $definition = Get-ProgramDefinitionForFile -File $file
    if ($null -ne $definition -and -not $detectedDefinitions.ContainsKey($definition.Key)) {
        $detectedDefinitions[$definition.Key] = $definition
    }
}

foreach ($definition in $detectedDefinitions.Values) {
    $null = Resolve-ProgramRoot -Definition $definition
}

$script:excludeRoots = @($paths.Builds, $paths.Releases, $paths.RootArchive)
foreach ($programRoot in $script:programRoots.Values) {
    Add-ProgramArchiveExclusions -ProgramRoot $programRoot
}

$sourceFiles = Get-ChildItem -LiteralPath $script:projectRoot -Recurse -File -Force | Where-Object {
    -not (Test-ExcludedSourceFile -FullPath $_.FullName)
}

$workFiles = $sourceFiles | Where-Object {
    $null -ne (Get-ProgramDefinitionForFile -File $_)
}

$processedSources = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

foreach ($definitionGroup in ($workFiles | Group-Object { (Get-ProgramDefinitionForFile -File $_).Key })) {
    $definition = $detectedDefinitions[$definitionGroup.Name]
    foreach ($extensionGroup in ($definitionGroup.Group | Group-Object Extension)) {
        $groupItems = foreach ($file in $extensionGroup.Group) {
            $info = Get-DuplicateInfo -Stem ([System.IO.Path]::GetFileNameWithoutExtension($file.Name))
            [PSCustomObject]@{
                File = $file
                Info = $info
            }
        }

        foreach ($duplicateGroup in ($groupItems | Group-Object { $_.Info.Key })) {
            if ($duplicateGroup.Count -lt 2) {
                continue
            }

            if (-not ($duplicateGroup.Group | Where-Object { $_.Info.WasVersioned })) {
                continue
            }

            $members = $duplicateGroup.Group | Sort-Object `
                @{ Expression = { $_.File.LastWriteTimeUtc }; Descending = $true }, `
                @{ Expression = { $_.File.Name }; Descending = $false }, `
                @{ Expression = { $_.File.FullName }; Descending = $false }

            $displayBase = ($members | Where-Object { -not $_.Info.WasVersioned } | Select-Object -First 1).Info.DisplayBase
            if ([string]::IsNullOrWhiteSpace($displayBase)) {
                $displayBase = $members[0].Info.DisplayBase
            }

            $liveMember = $members[0]
            $liveDestination = Join-Path (Get-LiveDirectoryForDefinition -Definition $definition) $liveMember.File.Name
            $liveResult = Move-TrackedFile -File $liveMember.File -DestinationPath $liveDestination -Reason 'duplicate-live'
            if ($null -eq $liveResult) {
                continue
            }

            $script:duplicates.Add([PSCustomObject]@{
                BaseName  = $displayBase
                Extension = $liveMember.File.Extension
                LiveFile  = $liveMember.File.Name
                Members   = ($members.File | Select-Object -ExpandProperty Name)
            }) | Out-Null

            $null = $processedSources.Add($liveMember.File.FullName)

            $snapshotMembers = $members | Select-Object -Skip 1 | Sort-Object `
                @{ Expression = { $_.File.LastWriteTimeUtc }; Descending = $false }, `
                @{ Expression = { $_.File.Name }; Descending = $false }, `
                @{ Expression = { $_.File.FullName }; Descending = $false }

            foreach ($snapshotMember in $snapshotMembers) {
                $snapshotDirectory = Get-SnapshotsDirectoryForDefinition -Definition $definition
                $snapshotDestination = Get-AvailableSnapshotPath -Directory $snapshotDirectory -BaseName $displayBase -Extension $snapshotMember.File.Extension
                $snapshotResult = Move-TrackedFile -File $snapshotMember.File -DestinationPath $snapshotDestination -Reason 'duplicate-snapshot'
                if ($null -ne $snapshotResult) {
                    $script:snapshots.Add([PSCustomObject]@{
                        Source      = $snapshotMember.File.Name
                        Destination = [System.IO.Path]::GetFileName($snapshotResult)
                    }) | Out-Null
                }

                $null = $processedSources.Add($snapshotMember.File.FullName)
            }
        }
    }
}

foreach ($file in $sourceFiles | Sort-Object FullName) {
    if ($processedSources.Contains($file.FullName)) {
        continue
    }

    $destinationDirectory = Get-DestinationDirectory -File $file
    $destinationPath = Join-Path $destinationDirectory $file.Name
    $null = Move-TrackedFile -File $file -DestinationPath $destinationPath -Reason 'sort'
    $null = $processedSources.Add($file.FullName)
}

foreach ($directoryPath in @($paths.SrcRoot, $paths.AssetsRoot, $paths.AssetsImages, $paths.AssetsSvg, $paths.Assets3d, $paths.AssetsTextures, $paths.AssetsUnknown, $paths.Builds, $paths.Releases, $paths.RootArchive)) {
    Add-PreservedStructureDirectory -DirectoryPath $directoryPath
}

if (Test-Path -LiteralPath $paths.SrcRoot -PathType Container) {
    foreach ($srcChild in Get-ChildItem -LiteralPath $paths.SrcRoot -Directory -Force) {
        Add-PreservedStructureDirectory -DirectoryPath $srcChild.FullName
        foreach ($knownSubfolder in @('01 live', '02 snapshots', '03 archive', '04 trash')) {
            Add-PreservedStructureDirectory -DirectoryPath (Join-Path $srcChild.FullName $knownSubfolder)
        }
    }
}

$unexpectedDirectories = Get-ChildItem -LiteralPath $script:projectRoot -Recurse -Directory -Force |
    Sort-Object { $_.FullName.Length } -Descending

foreach ($directory in $unexpectedDirectories) {
    if ($script:structureDirectorySet.Contains((Get-AbsolutePath -Path $directory.FullName))) {
        continue
    }

    if ((Test-PathUnder -Candidate $directory.FullName -Parent $paths.Builds) -or
        (Test-PathUnder -Candidate $directory.FullName -Parent $paths.Releases) -or
        (Test-PathUnder -Candidate $directory.FullName -Parent $paths.RootArchive)) {
        continue
    }

    if (Recycle-EmptyDirectory -DirectoryPath $directory.FullName) {
        continue
    }

    $remainingChildren = Get-ChildItem -LiteralPath $directory.FullName -Force | Select-Object -First 1
    if ($null -ne $remainingChildren) {
        $script:unresolved.Add(('{0} [unexpected directory retained]' -f
            (Get-ProjectRelativePath -FullPath $directory.FullName -RootPath $script:projectRoot))) | Out-Null
    }
}

Stamp-StructureDirectories

$remainingFilesOutsideSrc = Get-ChildItem -LiteralPath $script:projectRoot -Recurse -File -Force | Where-Object {
    -not (Compare-Path -Left $_.FullName -Right $logFullPath) -and
    -not (Test-OrganizerLogFile -FullPath $_.FullName) -and
    -not (Test-PathUnder -Candidate $_.FullName -Parent $paths.SrcRoot) -and
    -not (Test-PathUnder -Candidate $_.FullName -Parent $paths.Builds) -and
    -not (Test-PathUnder -Candidate $_.FullName -Parent $paths.Releases) -and
    -not (Test-PathUnder -Candidate $_.FullName -Parent $paths.RootArchive)
}

foreach ($leftover in $remainingFilesOutsideSrc) {
    $script:unresolved.Add(('{0} [left outside 01 src]' -f `
        (Get-ProjectRelativePath -FullPath $leftover.FullName -RootPath $script:projectRoot))) | Out-Null
}

$verificationPassed = ($script:conflicts.Count -eq 0 -and $script:unresolved.Count -eq 0)

$logLines = New-Object System.Collections.Generic.List[string]
$logLines.Add('Organize Folder Log') | Out-Null
$logLines.Add(('Project: {0}' -f $script:projectRoot)) | Out-Null
$logLines.Add(('Log: {0}' -f $logFullPath)) | Out-Null
$logLines.Add(('Verification: {0}' -f $(if ($verificationPassed) { 'PASSED' } else { 'ISSUES FOUND' }))) | Out-Null
$logLines.Add(('Generated: {0}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'))) | Out-Null
$logLines.Add('') | Out-Null

$sections = @(
    @{ Title = 'Program Directories Created'; Values = $script:createdProgramDirectories },
    @{ Title = 'Program Directories Used'; Values = $script:usedProgramDirectories },
    @{ Title = 'Structure Directories Renamed'; Values = $script:renamedDirectories },
    @{ Title = 'Empty Directories Moved To Recycle Bin'; Values = $script:recycledDirectories }
)

foreach ($section in $sections) {
    $logLines.Add($section.Title + ':') | Out-Null
    if ($section.Values.Count -eq 0) {
        $logLines.Add('  none') | Out-Null
    }
    else {
        foreach ($entry in $section.Values) {
            $logLines.Add(('  {0}' -f $entry)) | Out-Null
        }
    }
    $logLines.Add('') | Out-Null
}

$logLines.Add('Files Moved:') | Out-Null
if ($script:moves.Count -eq 0) {
    $logLines.Add('  none') | Out-Null
}
else {
    foreach ($move in $script:moves) {
        $logLines.Add(('  {0} -> {1} [{2}]' -f `
            (Get-ProjectRelativePath -FullPath $move.Source -RootPath $script:projectRoot), `
            (Get-ProjectRelativePath -FullPath $move.Destination -RootPath $script:projectRoot), `
            $move.Reason)) | Out-Null
    }
}

$logLines.Add('') | Out-Null
$logLines.Add('Duplicates Detected:') | Out-Null
if ($script:duplicates.Count -eq 0) {
    $logLines.Add('  none') | Out-Null
}
else {
    foreach ($duplicate in $script:duplicates) {
        $members = ($duplicate.Members -join ', ')
        $logLines.Add(('  {0}{1} -> live: {2}; members: {3}' -f `
            $duplicate.BaseName, `
            $duplicate.Extension, `
            $duplicate.LiveFile, `
            $members)) | Out-Null
    }
}

$logLines.Add('') | Out-Null
$logLines.Add('Snapshots Created:') | Out-Null
if ($script:snapshots.Count -eq 0) {
    $logLines.Add('  none') | Out-Null
}
else {
    foreach ($snapshot in $script:snapshots) {
        $logLines.Add(('  {0} -> {1}' -f $snapshot.Source, $snapshot.Destination)) | Out-Null
    }
}

$logLines.Add('') | Out-Null
$logLines.Add('Conflicts:') | Out-Null
if ($script:conflicts.Count -eq 0) {
    $logLines.Add('  none') | Out-Null
}
else {
    foreach ($conflict in $script:conflicts) {
        $logLines.Add(('  {0}' -f $conflict)) | Out-Null
    }
}

$logLines.Add('') | Out-Null
$logLines.Add('Unresolved Items:') | Out-Null
if ($script:unresolved.Count -eq 0) {
    $logLines.Add('  none') | Out-Null
}
else {
    foreach ($item in $script:unresolved) {
        $logLines.Add(('  {0}' -f $item)) | Out-Null
    }
}

[System.IO.File]::WriteAllLines($logFullPath, $logLines)

'Project: {0}' -f $script:projectRoot
'Log: {0}' -f $logFullPath
'Program directories created: {0}' -f $script:createdProgramDirectories.Count
'Program directories used: {0}' -f $script:usedProgramDirectories.Count
'Structure directories renamed: {0}' -f $script:renamedDirectories.Count
'Files moved: {0}' -f $script:moves.Count
'Duplicates detected: {0}' -f $script:duplicates.Count
'Snapshots created: {0}' -f $script:snapshots.Count
'Empty directories recycled: {0}' -f $script:recycledDirectories.Count
'Conflicts: {0}' -f $script:conflicts.Count
'Unresolved items: {0}' -f $script:unresolved.Count
'Verification: {0}' -f $(if ($verificationPassed) { 'PASSED' } else { 'ISSUES FOUND' })

if (-not $verificationPassed) {
    exit 1
}
