# Shared support for FlowCell role-based organization profiles.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Find-FlowCellRoot([string]$StartPath) {
    $currentPath = [System.IO.Path]::GetFullPath($StartPath)
    while (-not [string]::IsNullOrWhiteSpace($currentPath) -and (Test-Path -LiteralPath $currentPath -PathType Container)) {
        $summaryPath = Join-Path $currentPath 'PROGRAM_SUMMARY.txt'
        $flowCellPath = Join-Path $currentPath 'FlowCell'
        if ((Test-Path -LiteralPath $summaryPath -PathType Leaf) -and (Test-Path -LiteralPath $flowCellPath -PathType Container)) {
            return $currentPath
        }

        $parentPath = Split-Path -Parent $currentPath
        if ([string]::IsNullOrWhiteSpace($parentPath) -or $parentPath -eq $currentPath) {
            break
        }
        $currentPath = $parentPath
    }

    throw 'Could not locate the FlowCell repository root from this script location.'
}

function Get-AbsolutePath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [System.IO.Path]::GetFullPath($Path)
}

if (-not (Get-Variable -Name FlowCellRepoRoot -Scope Script -ErrorAction SilentlyContinue)) {
    $script:FlowCellRepoRoot = Find-FlowCellRoot -StartPath $PSScriptRoot
}

function Get-FlowCellLocalRoot {
    return (Join-Path $script:FlowCellRepoRoot 'flowcellbackend\local')
}

function Get-OrganizationRoot {
    return (Join-Path (Get-FlowCellLocalRoot) 'organization')
}

function Get-OrganizationProfilesRoot {
    return (Join-Path (Get-OrganizationRoot) 'profiles')
}

function Get-OrganizationActiveProfilePath {
    return (Join-Path (Get-OrganizationRoot) 'active_profile.json')
}

function Write-FlowCellStatus([string]$Message) {
    $statusPath = Join-Path (Get-FlowCellLocalRoot) 'logs\last_action_status.txt'
    $directory = Split-Path -Parent $statusPath
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    Set-Content -LiteralPath $statusPath -Value $Message -Encoding UTF8
}

function ConvertTo-OrganizationProfileId([string]$Value) {
    $candidate = $Value.Trim().ToLowerInvariant() -replace '[^a-z0-9._-]+', '-'
    $candidate = $candidate.Trim([char[]]'-_.')
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        throw 'Profile ID cannot be empty.'
    }
    return $candidate
}

function ConvertTo-OrganizationRoleId([string]$Value) {
    $candidate = $Value.Trim().ToLowerInvariant() -replace '[^a-z0-9._-]+', '_'
    $candidate = $candidate.Trim([char[]]'_.-')
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        throw 'Role ID cannot be empty.'
    }
    return $candidate
}

function Normalize-OrganizationExtension([string]$Value) {
    $extension = $Value.Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($extension)) {
        return ''
    }
    if (-not $extension.StartsWith('.')) {
        $extension = '.' + $extension
    }
    return $extension
}

function Split-OrganizationExtensions([string]$Value) {
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $extensions = New-Object System.Collections.Generic.List[string]
    foreach ($token in ($Value -split '[,;\s]+')) {
        $extension = Normalize-OrganizationExtension -Value $token
        if ([string]::IsNullOrWhiteSpace($extension)) {
            continue
        }
        if ($seen.Add($extension)) {
            $extensions.Add($extension) | Out-Null
        }
    }
    return @($extensions)
}

function Compare-OrganizationPath {
    param(
        [Parameter(Mandatory = $true)][string]$Left,
        [Parameter(Mandatory = $true)][string]$Right
    )
    return [string]::Equals((Get-AbsolutePath -Path $Left), (Get-AbsolutePath -Path $Right), [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-PathUnderOrganizationRoot {
    param(
        [Parameter(Mandatory = $true)][string]$Candidate,
        [Parameter(Mandatory = $true)][string]$Parent
    )
    $candidateFull = (Get-AbsolutePath -Path $Candidate).TrimEnd('\')
    $parentFull = (Get-AbsolutePath -Path $Parent).TrimEnd('\')
    return $candidateFull.StartsWith($parentFull + '\', [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-OrganizationRelativePath {
    param(
        [Parameter(Mandatory = $true)][string]$FullPath,
        [Parameter(Mandatory = $true)][string]$RootPath
    )
    $rootUri = New-Object System.Uri((Get-AbsolutePath -Path $RootPath).TrimEnd('\') + '\')
    $itemUri = New-Object System.Uri((Get-AbsolutePath -Path $FullPath))
    $relative = $rootUri.MakeRelativeUri($itemUri).ToString()
    return [System.Uri]::UnescapeDataString($relative).Replace('/', '\')
}

function Get-UniqueOrganizationLogPath {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string]$BaseName
    )
    $candidate = Join-Path $ProjectRoot $BaseName
    if (-not (Test-Path -LiteralPath $candidate)) {
        return $candidate
    }
    $stem = [System.IO.Path]::GetFileNameWithoutExtension([System.IO.Path]::GetFileNameWithoutExtension($BaseName))
    $suffix = $BaseName.Substring($stem.Length)
    $counter = 2
    do {
        $candidate = Join-Path $ProjectRoot ('{0} ({1}){2}' -f $stem, $counter, $suffix)
        $counter++
    } while (Test-Path -LiteralPath $candidate)
    return $candidate
}

function Resolve-OrganizationProfilePath([string]$ProfileId) {
    $profileId = ConvertTo-OrganizationProfileId -Value $ProfileId
    return (Join-Path (Get-OrganizationProfilesRoot) ($profileId + '.json'))
}

function Get-OrganizationProfiles {
    $profilesRoot = Get-OrganizationProfilesRoot
    if (-not (Test-Path -LiteralPath $profilesRoot -PathType Container)) {
        return @()
    }
    $profiles = New-Object System.Collections.Generic.List[object]
    foreach ($file in (Get-ChildItem -LiteralPath $profilesRoot -File -Filter '*.json' -Force | Sort-Object Name)) {
        try {
            $profile = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
            if (-not [string]::IsNullOrWhiteSpace([string]$profile.profileId)) {
                $profiles.Add($profile) | Out-Null
            }
        }
        catch {
            # Ignore malformed profile files in the picker; the explicit load path still reports errors.
        }
    }
    return @($profiles)
}

function Get-ActiveOrganizationProfileId {
    $activePath = Get-OrganizationActiveProfilePath
    if (-not (Test-Path -LiteralPath $activePath -PathType Leaf)) {
        return ''
    }
    try {
        $document = Get-Content -LiteralPath $activePath -Raw -Encoding UTF8 | ConvertFrom-Json
        return [string]$document.activeProfileId
    }
    catch {
        return ''
    }
}

function Set-ActiveOrganizationProfile([string]$ProfileId) {
    $profileId = ConvertTo-OrganizationProfileId -Value $ProfileId
    $activePath = Get-OrganizationActiveProfilePath
    $directory = Split-Path -Parent $activePath
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $document = [ordered]@{
        format          = 'flowcell-active-organization-profile-v1'
        activeProfileId = $profileId
        updatedAt       = (Get-Date).ToString('o')
    }
    Set-Content -LiteralPath $activePath -Value ($document | ConvertTo-Json -Depth 4) -Encoding UTF8
}

function Read-OrganizationProfile {
    param([string]$ProfileId = '')
    $profileIdToLoad = $ProfileId.Trim()
    if ([string]::IsNullOrWhiteSpace($profileIdToLoad)) {
        $profileIdToLoad = Get-ActiveOrganizationProfileId
    }
    if ([string]::IsNullOrWhiteSpace($profileIdToLoad)) {
        throw 'No organization profile is active. Run Setup Organization first, then Save + Active.'
    }
    $profilePath = Resolve-OrganizationProfilePath -ProfileId $profileIdToLoad
    if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf)) {
        throw "Organization profile was not found: $profilePath"
    }
    $profile = Get-Content -LiteralPath $profilePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace([string]$profile.profileId)) {
        throw "Organization profile is missing profileId: $profilePath"
    }
    return $profile
}

function Save-OrganizationProfileDocument {
    param(
        [Parameter(Mandatory = $true)][object]$Profile,
        [switch]$SetActive
    )
    $profileId = ConvertTo-OrganizationProfileId -Value ([string]$Profile.profileId)
    $profilePath = Resolve-OrganizationProfilePath -ProfileId $profileId
    $directory = Split-Path -Parent $profilePath
    New-Item -ItemType Directory -Path $directory -Force | Out-Null

    $existingCreatedAt = ''
    if (Test-Path -LiteralPath $profilePath -PathType Leaf) {
        try {
            $existing = Get-Content -LiteralPath $profilePath -Raw -Encoding UTF8 | ConvertFrom-Json
            $existingCreatedAt = [string]$existing.createdAt
        }
        catch {
            $existingCreatedAt = ''
        }
    }

    if ([string]::IsNullOrWhiteSpace([string]$Profile.createdAt)) {
        $Profile | Add-Member -NotePropertyName createdAt -NotePropertyValue $(if ($existingCreatedAt) { $existingCreatedAt } else { (Get-Date).ToString('o') }) -Force
    }
    $Profile | Add-Member -NotePropertyName updatedAt -NotePropertyValue (Get-Date).ToString('o') -Force
    $Profile | Add-Member -NotePropertyName format -NotePropertyValue 'flowcell-organization-profile-v1' -Force
    $Profile | Add-Member -NotePropertyName profileId -NotePropertyValue $profileId -Force

    $json = $Profile | ConvertTo-Json -Depth 10
    Set-Content -LiteralPath $profilePath -Value $json -Encoding UTF8
    if ($SetActive) {
        Set-ActiveOrganizationProfile -ProfileId $profileId
    }
    return $profilePath
}

function Resolve-OrganizationRoleFolderPath {
    param(
        [Parameter(Mandatory = $true)][string]$RootPath,
        [string]$RelativeFolder
    )
    $folder = ([string]$RelativeFolder).Trim()
    if ([string]::IsNullOrWhiteSpace($folder) -or $folder -eq '.') {
        return (Get-AbsolutePath -Path $RootPath)
    }
    if ([System.IO.Path]::IsPathRooted($folder)) {
        throw "Role folder must be relative to the project root, not absolute: $folder"
    }
    $candidate = Get-AbsolutePath -Path (Join-Path $RootPath $folder)
    $rootFull = Get-AbsolutePath -Path $RootPath
    if (-not ((Compare-OrganizationPath -Left $candidate -Right $rootFull) -or (Test-PathUnderOrganizationRoot -Candidate $candidate -Parent $rootFull))) {
        throw "Role folder escapes the project root: $folder"
    }
    return $candidate
}

function Get-NormalizedOrganizationRoles {
    param([Parameter(Mandatory = $true)][object]$Profile)
    $rootPath = [string]$Profile.rootPath
    if ([string]::IsNullOrWhiteSpace($rootPath)) {
        throw 'Organization profile is missing rootPath.'
    }
    if (-not (Test-Path -LiteralPath $rootPath -PathType Container)) {
        throw "Organization profile root folder does not exist: $rootPath"
    }

    $roles = New-Object System.Collections.Generic.List[object]
    foreach ($role in @($Profile.roles)) {
        $roleId = ConvertTo-OrganizationRoleId -Value ([string]$role.roleId)
        $label = [string]$role.label
        if ([string]::IsNullOrWhiteSpace($label)) {
            $label = $roleId
        }
        $extensions = @($role.extensions | ForEach-Object { Normalize-OrganizationExtension -Value ([string]$_) } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        if ($extensions.Count -eq 0) {
            continue
        }
        $folder = [string]$role.folder
        $folderFullPath = Resolve-OrganizationRoleFolderPath -RootPath $rootPath -RelativeFolder $folder
        $roles.Add([PSCustomObject][ordered]@{
            roleId         = $roleId
            label          = $label
            extensions     = @($extensions)
            folder         = $folder
            folderFullPath = $folderFullPath
        }) | Out-Null
    }
    if ($roles.Count -eq 0) {
        throw 'Organization profile has no roles with file types.'
    }
    return @($roles)
}

function Test-OrganizationGeneratedFile {
    param([Parameter(Mandatory = $true)][string]$FullPath)
    $name = [System.IO.Path]::GetFileName($FullPath)
    return $name -match '^new-organization(?: \(\d+\))?\.(?:log\.txt|undo\.json)$'
}

function Invoke-OrganizationProfile {
    param([Parameter(Mandatory = $true)][object]$Profile)

    $rootPath = Get-AbsolutePath -Path ([string]$Profile.rootPath)
    $roles = @(Get-NormalizedOrganizationRoles -Profile $Profile)
    $logPath = Get-UniqueOrganizationLogPath -ProjectRoot $rootPath -BaseName 'new-organization.log.txt'
    $undoPath = [System.IO.Path]::ChangeExtension($logPath, '.undo.json')

    $extensionRoles = @{}
    foreach ($role in $roles) {
        foreach ($extension in @($role.extensions)) {
            if (-not $extensionRoles.ContainsKey($extension)) {
                $extensionRoles[$extension] = New-Object System.Collections.Generic.List[object]
            }
            $extensionRoles[$extension].Add($role) | Out-Null
        }
    }

    $destinationFoldersToSkip = @($roles | ForEach-Object { $_.folderFullPath } | Where-Object { -not (Compare-OrganizationPath -Left $_ -Right $rootPath) } | Sort-Object -Unique)
    $moves = New-Object System.Collections.Generic.List[object]
    $kept = New-Object System.Collections.Generic.List[string]
    $skippedAlreadyOrganized = New-Object System.Collections.Generic.List[string]
    $unmapped = New-Object System.Collections.Generic.List[string]
    $ambiguous = New-Object System.Collections.Generic.List[string]
    $conflicts = New-Object System.Collections.Generic.List[string]

    $files = Get-ChildItem -LiteralPath $rootPath -Recurse -File -Force | Where-Object {
        -not (Compare-OrganizationPath -Left $_.FullName -Right $logPath) -and
        -not (Compare-OrganizationPath -Left $_.FullName -Right $undoPath) -and
        -not (Test-OrganizationGeneratedFile -FullPath $_.FullName)
    }

    foreach ($file in ($files | Sort-Object FullName)) {
        $relativeSource = Get-OrganizationRelativePath -FullPath $file.FullName -RootPath $rootPath
        $alreadyOrganized = $false
        foreach ($destinationFolder in $destinationFoldersToSkip) {
            if (Test-PathUnderOrganizationRoot -Candidate $file.FullName -Parent $destinationFolder) {
                $alreadyOrganized = $true
                break
            }
        }
        if ($alreadyOrganized) {
            $skippedAlreadyOrganized.Add($relativeSource) | Out-Null
            continue
        }

        $extension = Normalize-OrganizationExtension -Value $file.Extension
        if (-not $extensionRoles.ContainsKey($extension)) {
            $unmapped.Add($relativeSource) | Out-Null
            continue
        }
        $matchingRoles = @($extensionRoles[$extension])
        if ($matchingRoles.Count -gt 1) {
            $ambiguous.Add(('{0} [{1} matches roles: {2}]' -f $relativeSource, $extension, (($matchingRoles | ForEach-Object { $_.roleId }) -join ', '))) | Out-Null
            continue
        }

        $role = $matchingRoles[0]
        New-Item -ItemType Directory -Path $role.folderFullPath -Force | Out-Null
        $destinationPath = Join-Path $role.folderFullPath $file.Name
        $relativeDestination = Get-OrganizationRelativePath -FullPath $destinationPath -RootPath $rootPath

        if (Compare-OrganizationPath -Left $file.FullName -Right $destinationPath) {
            $kept.Add(('{0} [{1}]' -f $relativeSource, $role.roleId)) | Out-Null
            continue
        }
        if (Test-Path -LiteralPath $destinationPath) {
            $conflicts.Add(('{0} -> {1} [{2}; destination exists]' -f $relativeSource, $relativeDestination, $role.roleId)) | Out-Null
            continue
        }

        Move-Item -LiteralPath $file.FullName -Destination $destinationPath
        if ((-not (Test-Path -LiteralPath $destinationPath -PathType Leaf)) -or (Test-Path -LiteralPath $file.FullName)) {
            throw "Move verification failed: $($file.FullName) -> $destinationPath"
        }
        $moves.Add([PSCustomObject][ordered]@{
            sourceRelative      = $relativeSource
            destinationRelative = $relativeDestination
            sourceFull          = Get-AbsolutePath -Path $file.FullName
            destinationFull     = Get-AbsolutePath -Path $destinationPath
            roleId              = $role.roleId
        }) | Out-Null
    }

    $undo = [ordered]@{
        format    = 'flowcell-new-organization-undo-v1'
        profileId = [string]$Profile.profileId
        rootPath  = $rootPath
        createdAt = (Get-Date).ToString('o')
        moves     = @($moves)
        note      = 'Move destinationFull back to sourceFull only if destinationFull exists and sourceFull is free.'
    }
    Set-Content -LiteralPath $undoPath -Value ($undo | ConvertTo-Json -Depth 8) -Encoding UTF8

    $logLines = New-Object System.Collections.Generic.List[string]
    $logLines.Add('New Organization Log') | Out-Null
    $logLines.Add(('Profile: {0}' -f [string]$Profile.profileId)) | Out-Null
    $logLines.Add(('Root: {0}' -f $rootPath)) | Out-Null
    $logLines.Add(('Generated: {0}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'))) | Out-Null
    $logLines.Add(('Files moved: {0}' -f $moves.Count)) | Out-Null
    $logLines.Add(('Kept in place: {0}' -f $kept.Count)) | Out-Null
    $logLines.Add(('Skipped already organized: {0}' -f $skippedAlreadyOrganized.Count)) | Out-Null
    $logLines.Add(('Unmapped items: {0}' -f $unmapped.Count)) | Out-Null
    $logLines.Add(('Ambiguous items: {0}' -f $ambiguous.Count)) | Out-Null
    $logLines.Add(('Conflicts: {0}' -f $conflicts.Count)) | Out-Null
    $logLines.Add(('Log: {0}' -f $logPath)) | Out-Null
    $logLines.Add(('Undo manifest: {0}' -f $undoPath)) | Out-Null
    $logLines.Add('') | Out-Null

    foreach ($section in @(
        @{ Title = 'Moves'; Values = @($moves | ForEach-Object { '{0} -> {1} [{2}]' -f $_.sourceRelative, $_.destinationRelative, $_.roleId }) },
        @{ Title = 'Ambiguous'; Values = $ambiguous },
        @{ Title = 'Conflicts'; Values = $conflicts },
        @{ Title = 'Unmapped'; Values = $unmapped }
    )) {
        $logLines.Add($section.Title + ':') | Out-Null
        if (@($section.Values).Count -eq 0) {
            $logLines.Add('  none') | Out-Null
        }
        else {
            foreach ($value in @($section.Values)) {
                $logLines.Add(('  {0}' -f $value)) | Out-Null
            }
        }
        $logLines.Add('') | Out-Null
    }

    Set-Content -LiteralPath $logPath -Value $logLines -Encoding UTF8

    return [PSCustomObject][ordered]@{
        ProfileId               = [string]$Profile.profileId
        RootPath                = $rootPath
        FilesMoved              = $moves.Count
        Kept                    = $kept.Count
        SkippedAlreadyOrganized = $skippedAlreadyOrganized.Count
        Unmapped                = $unmapped.Count
        Ambiguous               = $ambiguous.Count
        Conflicts               = $conflicts.Count
        LogPath                 = $logPath
        UndoPath                = $undoPath
    }
}
