param(
    [ValidateSet('InitProfile','Scan','ResolveRole','OrganizeLooseFiles')]
    [string]$Mode = 'Scan',
    [Parameter(Mandatory=$true)]
    [string]$ProjectPath,
    [string]$ProfilePath = '',
    [string]$RoleId = '',
    [string]$FileName = '',
    [string[]]$RequestedRoles = @(),
    [ValidateSet('RootOnly','Recursive')]
    [string]$LooseFileSearchMode = 'RootOnly',
    [switch]$CreateMissing,
    [switch]$PassThruJson
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function FullPath([string]$Path) { return [System.IO.Path]::GetFullPath($Path) }
function ExtensionOf([string]$Name) { return ([System.IO.Path]::GetExtension($Name)).ToLowerInvariant() }
function EnsureDir([string]$Path) { if (-not (Test-Path -LiteralPath $Path -PathType Container)) { New-Item -ItemType Directory -Path $Path -Force | Out-Null } }
function RoleId([string]$Text) { return (($Text.Trim().ToLowerInvariant() -replace '[^a-z0-9._-]+','_').Trim('_.-')) }
function CleanExt([string]$Text) { $e = $Text.Trim().ToLowerInvariant(); if ($e -and -not $e.StartsWith('.')) { $e = '.' + $e }; return $e }
function PropertyValue([object]$Object, [string]$Name, $Default = $null) {
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $Default }
    return $property.Value
}
function RelPath([string]$Full, [string]$Root) {
    $rootUri = [System.Uri]((FullPath $Root).TrimEnd('\') + '\')
    $itemUri = [System.Uri](FullPath $Full)
    return [System.Uri]::UnescapeDataString($rootUri.MakeRelativeUri($itemUri).ToString()).Replace('/','\')
}
function UnderRoot([string]$Candidate, [string]$Root) {
    $c = (FullPath $Candidate).TrimEnd('\')
    $r = (FullPath $Root).TrimEnd('\')
    return $c.Equals($r, [System.StringComparison]::OrdinalIgnoreCase) -or $c.StartsWith($r + '\', [System.StringComparison]::OrdinalIgnoreCase)
}
function NormalizeProtectedFolder([string]$Text) {
    $folder = $Text.Trim().Replace('\','/').Trim('/')
    if ($folder.StartsWith('./')) { $folder = $folder.Substring(2) }
    if ([string]::IsNullOrWhiteSpace($folder) -or $folder -eq '.' -or $folder -match '(^|/)\.\.(/|$)') { return '' }
    return $folder
}

$projectRoot = FullPath $ProjectPath
if (-not (Test-Path -LiteralPath $projectRoot -PathType Container)) { throw "Project folder does not exist: $projectRoot" }

if ([string]::IsNullOrWhiteSpace($ProfilePath)) {
    # Profile is a single visible file at the project root. Fall back to the
    # legacy .flowcell location only for reading older setups.
    $newProfilePath = Join-Path $projectRoot 'organize-folder.profile.json'
    $legacyProfilePath = Join-Path $projectRoot '.flowcell\organization-profile.json'
    if ((Test-Path -LiteralPath $newProfilePath -PathType Leaf) -or -not (Test-Path -LiteralPath $legacyProfilePath -PathType Leaf)) {
        $ProfilePath = $newProfilePath
    } else {
        $ProfilePath = $legacyProfilePath
    }
}

function New-StarterProfile {
    param([string]$Root)
    [PSCustomObject][ordered]@{
        profileVersion = 1
        projectRoot = $Root
        roles = @(
            [PSCustomObject][ordered]@{ roleId='project_root'; displayName='Project Root'; folder='.'; fileTypes=@(); preset=$true; description='The project root itself.' },
            [PSCustomObject][ordered]@{ roleId='unknown'; displayName='Unknown Files'; folder=''; fileTypes=@(); preset=$true; catchAllUnmatched=$true; description='Unknown catches loose files whose file type does not match another role.' },
            [PSCustomObject][ordered]@{ roleId='images'; displayName='Images'; folder=''; fileTypes=@('.png','.jpg','.jpeg','.webp','.gif','.bmp','.tif','.tiff') },
            [PSCustomObject][ordered]@{ roleId='svg'; displayName='SVG'; folder=''; fileTypes=@('.svg','.eps') },
            [PSCustomObject][ordered]@{ roleId='3d'; displayName='3D'; folder=''; fileTypes=@('.stl','.obj','.fbx','.glb','.gltf','.3mf','.ply','.dae','.usd','.usdz','.abc','.x3d','.step','.stp','.iges','.igs') }
        )
        programFolders = @()
        protectedFolders = @()
        rememberedChoices = [PSCustomObject]@{}
    }
}

function Read-Profile {
    if (-not (Test-Path -LiteralPath $ProfilePath -PathType Leaf)) { return New-StarterProfile -Root $projectRoot }
    return Get-Content -LiteralPath $ProfilePath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Normalize-Profile([object]$Profile) {
    $roles = New-Object System.Collections.Generic.List[object]
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($role in @($Profile.roles)) {
        $id = RoleId ([string]$role.roleId)
        if (-not $id -or -not $seen.Add($id)) { continue }
        $exts = New-Object System.Collections.Generic.List[string]
        $extSeen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($raw in @(PropertyValue $role 'fileTypes' @())) {
            $e = CleanExt ([string]$raw)
            if ($id -eq '3d' -and $e -eq '.blend') { continue }
            if ($e -and $extSeen.Add($e)) { $exts.Add($e) | Out-Null }
        }
        $displayName = [string](PropertyValue $role 'displayName' $id)
        $folder = [string](PropertyValue $role 'folder' '')
        $roles.Add([PSCustomObject][ordered]@{
            roleId = $id
            displayName = $(if ([string]::IsNullOrWhiteSpace($displayName)) { $id } else { $displayName })
            folder = $(if ($id -eq 'unknown') { $folder.Trim() } elseif ([string]::IsNullOrWhiteSpace($folder)) { $id } else { $folder })
            fileTypes = $exts.ToArray()
            preset = [bool](PropertyValue $role 'preset' $false)
            catchAllUnmatched = [bool](PropertyValue $role 'catchAllUnmatched' $false)
            description = [string](PropertyValue $role 'description' '')
        }) | Out-Null
    }
    $projectRootRole = @($roles | Where-Object { $_.roleId -eq 'project_root' } | Select-Object -First 1)
    if (-not $projectRootRole.Count) {
        $roles.Insert(0, [PSCustomObject][ordered]@{ roleId='project_root'; displayName='Project Root'; folder='.'; fileTypes=@(); preset=$true; catchAllUnmatched=$false; description='The project root itself.' })
    }
    else {
        $projectRootRole[0].folder = '.'
        $projectRootRole[0].fileTypes = @()
        $projectRootRole[0].preset = $true
        $projectRootRole[0].catchAllUnmatched = $false
    }
    $unknownRole = @($roles | Where-Object { $_.roleId -eq 'unknown' } | Select-Object -First 1)
    if (-not $unknownRole.Count) {
        $roles.Add([PSCustomObject][ordered]@{ roleId='unknown'; displayName='Unknown Files'; folder=''; fileTypes=@(); preset=$true; catchAllUnmatched=$true; description='Unknown catches loose files whose file type does not match another role.' }) | Out-Null
    }
    else {
        $unknownRole[0].displayName = 'Unknown Files'
        $unknownRole[0].fileTypes = @()
        $unknownRole[0].preset = $true
        $unknownRole[0].catchAllUnmatched = $true
        $unknownRole[0].description = 'Unknown catches loose files whose file type does not match another role.'
    }
    $Profile.roles = $roles.ToArray()

    $programFolders = New-Object System.Collections.Generic.List[object]
    $programSeen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($program in @(PropertyValue $Profile 'programFolders' @())) {
        $programId = RoleId ([string](PropertyValue $program 'programId' ''))
        if (-not $programId -or -not $programSeen.Add($programId)) { continue }
        $programTypes = New-Object System.Collections.Generic.List[string]
        $programTypeSeen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($raw in @(PropertyValue $program 'fileTypes' @())) {
            $extension = CleanExt ([string]$raw)
            if ($extension -and $programTypeSeen.Add($extension)) { $programTypes.Add($extension) | Out-Null }
        }
        $programRoles = New-Object System.Collections.Generic.List[string]
        $programRoleSeen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($raw in @(PropertyValue $program 'roles' @())) {
            $programRoleId = RoleId ([string]$raw)
            if ($programRoleId -and $programRoleSeen.Add($programRoleId)) { $programRoles.Add($programRoleId) | Out-Null }
        }
        $displayName = [string](PropertyValue $program 'displayName' $programId)
        $folder = [string](PropertyValue $program 'folder' $displayName)
        $programFolders.Add([PSCustomObject][ordered]@{
            programId = $programId
            displayName = $(if ([string]::IsNullOrWhiteSpace($displayName)) { $programId } else { $displayName.Trim() })
            folder = $(if ([string]::IsNullOrWhiteSpace($folder)) { $displayName.Trim() } else { $folder.Trim() })
            fileTypes = $programTypes.ToArray()
            roles = $programRoles.ToArray()
            createOnlyIfMatchingFilesOrRolesPresent = [bool](PropertyValue $program 'createOnlyIfMatchingFilesOrRolesPresent' $true)
        }) | Out-Null
    }
    $Profile.programFolders = $programFolders.ToArray()

    $protectedFolders = New-Object System.Collections.Generic.List[string]
    $protectedSeen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($raw in @(PropertyValue $Profile 'protectedFolders' @())) {
        $folder = NormalizeProtectedFolder ([string]$raw)
        if ($folder -and $protectedSeen.Add($folder)) { $protectedFolders.Add($folder) | Out-Null }
    }
    $Profile | Add-Member -NotePropertyName protectedFolders -NotePropertyValue $protectedFolders.ToArray() -Force
    return $Profile
}

function RoleFolder([object]$Role) {
    $folder = ([string]$Role.folder).Trim()
    if (-not $folder -or $folder -eq '.') { return $projectRoot }
    if ([System.IO.Path]::IsPathRooted($folder)) { throw "Role folder must be relative: $folder" }
    $full = FullPath (Join-Path $projectRoot $folder)
    if (-not (UnderRoot $full $projectRoot)) { throw "Role folder escapes project root: $folder" }
    return $full
}

function ProtectedFolderRoots([object]$Profile) {
    $roots = New-Object System.Collections.Generic.List[string]
    foreach ($folder in @(PropertyValue $Profile 'protectedFolders' @())) {
        $normalized = NormalizeProtectedFolder ([string]$folder)
        if (-not $normalized) { continue }
        $full = FullPath (Join-Path $projectRoot ($normalized.Replace('/','\')))
        if (UnderRoot $full $projectRoot) { $roots.Add($full.TrimEnd('\','/')) | Out-Null }
    }
    return $roots.ToArray()
}

function IsInProtectedFolder([string]$FilePath, [object[]]$ProtectedRoots) {
    $full = (FullPath $FilePath)
    foreach ($root in @($ProtectedRoots)) {
        $protected = ([string]$root).TrimEnd('\','/')
        if ($full.Equals($protected, [System.StringComparison]::OrdinalIgnoreCase) -or $full.StartsWith($protected + '\', [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return $false
}

function MatchLooseFile([object]$Profile, [System.IO.FileInfo]$File) {
    $ext = ExtensionOf $File.Name
    $rememberedRoleId = ''
    if ($null -ne $Profile.rememberedChoices) {
        $rememberedProperty = $Profile.rememberedChoices.PSObject.Properties[$ext]
        if ($null -ne $rememberedProperty) {
            $rememberedChoice = $rememberedProperty.Value
            if ($rememberedChoice -is [string]) { $rememberedRoleId = $rememberedChoice }
            elseif ($null -ne $rememberedChoice) { $rememberedRoleId = [string]$rememberedChoice.roleId }
        }
    }
    if (-not [string]::IsNullOrWhiteSpace($rememberedRoleId)) {
        $rememberedRole = @($Profile.roles | Where-Object { $_.roleId -eq $rememberedRoleId } | Select-Object -First 1)
        if ($rememberedRole.Count) { return [PSCustomObject]@{ status='resolved'; role=$rememberedRole[0]; reason='remembered-choice'; choices=@() } }
    }
    $matches = @($Profile.roles | Where-Object { -not $_.catchAllUnmatched -and @($_.fileTypes) -contains $ext })
    if ($matches.Count -eq 1) { return [PSCustomObject]@{ status='resolved'; role=$matches[0]; reason='file-type'; choices=@() } }
    if ($matches.Count -gt 1) { return [PSCustomObject]@{ status='ambiguous'; role=$null; reason='multiple-file-type-roles'; choices=@($matches) } }
    $unknown = @($Profile.roles | Where-Object { $_.roleId -eq 'unknown' } | Select-Object -First 1)
    if ($unknown.Count -and -not [string]::IsNullOrWhiteSpace([string]$unknown[0].folder) -and ([string]$unknown[0].folder).Trim() -ne '.') {
        return [PSCustomObject]@{ status='resolved'; role=$unknown[0]; reason='unknown-files-catch-all'; choices=@() }
    }
    if ($unknown.Count) { return [PSCustomObject]@{ status='unresolved'; role=$null; reason='unknown-role-needs-folder'; choices=@() } }
    return [PSCustomObject]@{ status='unresolved'; role=$null; reason='no-matching-role-and-no-unknown-role'; choices=@() }
}

$profile = Normalize-Profile (Read-Profile)

if ($Mode -eq 'InitProfile') {
    # Always write the new single-file location, never the legacy .flowcell folder.
    $writeProfilePath = Join-Path $projectRoot 'organize-folder.profile.json'
    # UTF-8 without BOM so the Rust reader (serde_json) can parse it.
    $writeProfileJson = ($profile | ConvertTo-Json -Depth 12) + [Environment]::NewLine
    [System.IO.File]::WriteAllText($writeProfilePath, $writeProfileJson, (New-Object System.Text.UTF8Encoding $false))
    $result = [PSCustomObject]@{ mode=$Mode; projectRoot=$projectRoot; profilePath=$writeProfilePath; created=$true }
}
elseif ($Mode -eq 'ResolveRole') {
    $role = @($profile.roles | Where-Object { $_.roleId -eq (RoleId $RoleId) } | Select-Object -First 1)
    if (-not $role.Count) { $result = [PSCustomObject]@{ mode=$Mode; projectRoot=$projectRoot; profilePath=$ProfilePath; status='unresolved'; reason='role-not-found'; roleId=$RoleId } }
    elseif ($role[0].roleId -eq 'unknown' -and ([string]::IsNullOrWhiteSpace([string]$role[0].folder) -or ([string]$role[0].folder).Trim() -eq '.')) {
        $result = [PSCustomObject]@{ mode=$Mode; projectRoot=$projectRoot; profilePath=$ProfilePath; status='unresolved'; reason='unknown-role-needs-folder'; roleId=$RoleId }
    }
    else {
        $folder = RoleFolder $role[0]
        if ($CreateMissing) { EnsureDir $folder }
        $target = if ($FileName) { Join-Path $folder $FileName } else { $folder }
        $result = [PSCustomObject]@{ mode=$Mode; projectRoot=$projectRoot; profilePath=$ProfilePath; status='resolved'; roleId=$role[0].roleId; folder=$folder; targetPath=$target }
    }
}
else {
    $unknownRole = @($profile.roles | Where-Object { $_.roleId -eq 'unknown' } | Select-Object -First 1)
    if (-not $unknownRole.Count -or [string]::IsNullOrWhiteSpace([string]$unknownRole[0].folder) -or ([string]$unknownRole[0].folder).Trim() -eq '.') {
        throw 'Assign the Unknown role to a project folder before organizing loose files.'
    }
    $programResult = $null
    if ($Mode -eq 'OrganizeLooseFiles' -and @($profile.programFolders).Count -gt 0) {
        $applyCore = Join-Path $PSScriptRoot 'Apply-OrganizationProfileCore.ps1'
        if (-not (Test-Path -LiteralPath $applyCore -PathType Leaf)) {
            throw "Apply Organization Profile core not found: $applyCore"
        }
        $programJson = & $applyCore -ProfilePath $ProfilePath -ProjectPath $projectRoot -PassThruJson
        $programResult = $programJson | ConvertFrom-Json
    }
    $protectedFolderRoots = @(ProtectedFolderRoots $profile)
    $folderArgs = @{ LiteralPath=$projectRoot; File=$true; Force=$true; ErrorAction='SilentlyContinue' }
    if ($LooseFileSearchMode -eq 'Recursive') { $folderArgs.Recurse = $true }
    $files = @(Get-ChildItem @folderArgs | Where-Object {
        $_.FullName -notlike '*\.flowcell\*' -and
        $_.Name -notlike 'organize-folder.*' -and
        $_.FullName -notmatch '(?i)[\\/](?:01 live|02 snapshots|03 archive|04 trash)[\\/]' -and
        -not (IsInProtectedFolder -FilePath $_.FullName -ProtectedRoots $protectedFolderRoots)
    })
    $moves = New-Object System.Collections.Generic.List[object]
    $ambiguous = New-Object System.Collections.Generic.List[object]
    $unresolved = New-Object System.Collections.Generic.List[object]
    foreach ($file in $files) {
        $match = MatchLooseFile $profile $file
        if ($match.status -eq 'ambiguous') {
            $ambiguous.Add([PSCustomObject]@{ file=$file.FullName; extension=$file.Extension.ToLowerInvariant(); choices=@($match.choices | ForEach-Object { $_.roleId }) }) | Out-Null
            continue
        }
        if ($match.status -ne 'resolved') { $unresolved.Add([PSCustomObject]@{ file=$file.FullName; reason=$match.reason }) | Out-Null; continue }
        $destDir = RoleFolder $match.role
        if ($Mode -eq 'OrganizeLooseFiles') {
            EnsureDir $destDir
            $dest = Join-Path $destDir $file.Name
            if (-not (UnderRoot $dest $projectRoot)) { throw "Destination escaped root: $dest" }
            if ((FullPath $file.FullName) -ne (FullPath $dest)) {
                if (Test-Path -LiteralPath $dest) { $unresolved.Add([PSCustomObject]@{ file=$file.FullName; reason='destination-exists'; destination=$dest }) | Out-Null; continue }
                Move-Item -LiteralPath $file.FullName -Destination $dest
                $moves.Add([PSCustomObject]@{ source=$file.FullName; destination=$dest; roleId=$match.role.roleId; reason=$match.reason }) | Out-Null
            }
        }
    }
    $result = [PSCustomObject]@{ mode=$Mode; projectRoot=$projectRoot; profilePath=$ProfilePath; filesScanned=$files.Count; programOrganization=$programResult; moves=$moves.ToArray(); ambiguous=$ambiguous.ToArray(); unresolved=$unresolved.ToArray() }
}

if ($PassThruJson) { $result | ConvertTo-Json -Depth 12 } else { $result | Format-List | Out-String }
