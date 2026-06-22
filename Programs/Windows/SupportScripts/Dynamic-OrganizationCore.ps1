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

$projectRoot = FullPath $ProjectPath
if (-not (Test-Path -LiteralPath $projectRoot -PathType Container)) { throw "Project folder does not exist: $projectRoot" }

if ([string]::IsNullOrWhiteSpace($ProfilePath)) { $ProfilePath = Join-Path $projectRoot '.flowcell\organization-profile.json' }

function New-StarterProfile {
    param([string]$Root)
    [PSCustomObject][ordered]@{
        profileVersion = 1
        projectRoot = $Root
        roles = @(
            [PSCustomObject][ordered]@{ roleId='project_root'; displayName='Project Root'; folder='.'; fileTypes=@(); preset=$true; description='The project root itself.' },
            [PSCustomObject][ordered]@{ roleId='unknown'; displayName='Unknown Files'; folder='Unknown Files'; fileTypes=@(); preset=$true; catchAllUnmatched=$true; description='Catches loose files whose file type does not match any other role.' },
            [PSCustomObject][ordered]@{ roleId='clean_stl'; displayName='Clean STL'; folder='Meshes\Clean STLs'; fileTypes=@() },
            [PSCustomObject][ordered]@{ roleId='dirty_stl'; displayName='Dirty STL'; folder='Meshes\Dirty STLs'; fileTypes=@() },
            [PSCustomObject][ordered]@{ roleId='svg_export'; displayName='SVG Export'; folder='Illustrator\SVG Exports'; fileTypes=@('.svg','.eps') },
            [PSCustomObject][ordered]@{ roleId='laser_svg'; displayName='Laser SVG'; folder='Illustrator\Laser SVG'; fileTypes=@() },
            [PSCustomObject][ordered]@{ roleId='gcode'; displayName='GCode'; folder='Orca\GCode'; fileTypes=@('.gcode','.nc','.tap') }
        )
        programFolders = @(
            [PSCustomObject][ordered]@{ programId='illustrator'; displayName='Illustrator'; folder='Illustrator'; createOnlyIfMatchingFilesOrRolesPresent=$true; roles=@('svg_export','laser_svg') },
            [PSCustomObject][ordered]@{ programId='meshes'; displayName='Meshes'; folder='Meshes'; createOnlyIfMatchingFilesOrRolesPresent=$true; roles=@('clean_stl','dirty_stl') },
            [PSCustomObject][ordered]@{ programId='orca'; displayName='Orca'; folder='Orca'; createOnlyIfMatchingFilesOrRolesPresent=$true; roles=@('gcode') }
        )
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
        foreach ($raw in @($role.fileTypes)) { $e = CleanExt ([string]$raw); if ($e -and $extSeen.Add($e)) { $exts.Add($e) | Out-Null } }
        $roles.Add([PSCustomObject][ordered]@{
            roleId = $id
            displayName = $(if ([string]::IsNullOrWhiteSpace([string]$role.displayName)) { $id } else { [string]$role.displayName })
            folder = $(if ([string]::IsNullOrWhiteSpace([string]$role.folder)) { $id } else { [string]$role.folder })
            fileTypes = @($exts)
            preset = [bool]$role.preset
            catchAllUnmatched = [bool]$role.catchAllUnmatched
            description = [string]$role.description
        }) | Out-Null
    }
    if (-not ($roles | Where-Object { $_.roleId -eq 'unknown' })) {
        $roles.Add([PSCustomObject][ordered]@{ roleId='unknown'; displayName='Unknown Files'; folder='Unknown Files'; fileTypes=@(); preset=$true; catchAllUnmatched=$true; description='Catches loose files whose file type does not match any other role.' }) | Out-Null
    }
    $Profile.roles = @($roles)
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

function MatchLooseFile([object]$Profile, [System.IO.FileInfo]$File) {
    $ext = ExtensionOf $File.Name
    $matches = @($Profile.roles | Where-Object { -not $_.catchAllUnmatched -and @($_.fileTypes) -contains $ext })
    if ($matches.Count -eq 1) { return [PSCustomObject]@{ status='resolved'; role=$matches[0]; reason='file-type'; choices=@() } }
    if ($matches.Count -gt 1) { return [PSCustomObject]@{ status='ambiguous'; role=$null; reason='multiple-file-type-roles'; choices=@($matches) } }
    $unknown = @($Profile.roles | Where-Object { $_.roleId -eq 'unknown' } | Select-Object -First 1)
    if ($unknown.Count) { return [PSCustomObject]@{ status='resolved'; role=$unknown[0]; reason='unknown-files-catch-all'; choices=@() } }
    return [PSCustomObject]@{ status='unresolved'; role=$null; reason='no-matching-role-and-no-unknown-role'; choices=@() }
}

$profile = Normalize-Profile (Read-Profile)

if ($Mode -eq 'InitProfile') {
    EnsureDir (Split-Path -Parent $ProfilePath)
    $profile | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $ProfilePath -Encoding UTF8
    $result = [PSCustomObject]@{ mode=$Mode; projectRoot=$projectRoot; profilePath=$ProfilePath; created=$true }
}
elseif ($Mode -eq 'ResolveRole') {
    $role = @($profile.roles | Where-Object { $_.roleId -eq (RoleId $RoleId) } | Select-Object -First 1)
    if (-not $role.Count) { $result = [PSCustomObject]@{ mode=$Mode; projectRoot=$projectRoot; profilePath=$ProfilePath; status='unresolved'; reason='role-not-found'; roleId=$RoleId } }
    else {
        $folder = RoleFolder $role[0]
        if ($CreateMissing) { EnsureDir $folder }
        $target = if ($FileName) { Join-Path $folder $FileName } else { $folder }
        $result = [PSCustomObject]@{ mode=$Mode; projectRoot=$projectRoot; profilePath=$ProfilePath; status='resolved'; roleId=$role[0].roleId; folder=$folder; targetPath=$target }
    }
}
else {
    $folderArgs = @{ LiteralPath=$projectRoot; File=$true; Force=$true; ErrorAction='SilentlyContinue' }
    if ($LooseFileSearchMode -eq 'Recursive') { $folderArgs.Recurse = $true }
    $files = @(Get-ChildItem @folderArgs | Where-Object { $_.FullName -notlike '*\.flowcell\*' })
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
    $result = [PSCustomObject]@{ mode=$Mode; projectRoot=$projectRoot; profilePath=$ProfilePath; filesScanned=$files.Count; moves=@($moves); ambiguous=@($ambiguous); unresolved=@($unresolved) }
}

if ($PassThruJson) { $result | ConvertTo-Json -Depth 12 } else { $result | Format-List | Out-String }
