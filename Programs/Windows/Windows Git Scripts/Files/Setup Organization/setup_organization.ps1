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
$script:ProfileFormat = 'flowcell.windows.setup-organization.profile.v1'
$script:StageFormat = 'flowcell.windows.setup-organization.stage.v1'
$script:MaximumScanEntries = 5000

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

function Get-ProfilesRoot {
    return Join-Path (Get-ProgramDataRoot) 'profiles'
}

function Get-StagingRoot {
    return Join-Path (Get-ProgramDataRoot) 'staging'
}

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
        throw 'The selected root must be an absolute Windows folder path.'
    }
    $resolved = [System.IO.Path]::GetFullPath($candidate)
    if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
        throw "The selected root folder does not exist: $resolved"
    }
    Assert-NotReparsePoint -Path $resolved -Label 'The selected root'
    $volumeRoot = [System.IO.Path]::GetPathRoot($resolved)
    if ($resolved.Equals($volumeRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $volumeRoot
    }
    return $resolved.TrimEnd([char[]]@('\', '/'))
}

function Normalize-RelativeFolder {
    param(
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $normalized = $RelativePath.Trim().Replace('\', '/').Trim('/')
    if ([string]::IsNullOrWhiteSpace($normalized) -or $normalized -eq '.') {
        throw "$Label must name a folder below the selected root."
    }
    if ([System.IO.Path]::IsPathRooted($normalized)) {
        throw "$Label must be relative to the selected root."
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

function Resolve-DescendantFolder {
    param(
        [Parameter(Mandatory = $true)][string]$RootPath,
        [Parameter(Mandatory = $true)][string]$RelativePath,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $root = Resolve-ExistingRoot -RootPath $RootPath
    $relative = Normalize-RelativeFolder -RelativePath $RelativePath -Label $Label
    $candidate = $root
    foreach ($segment in $relative.Split('/')) {
        $candidate = Join-Path $candidate $segment
        if (Test-Path -LiteralPath $candidate) {
            Assert-NotReparsePoint -Path $candidate -Label $Label
        }
    }
    $resolved = [System.IO.Path]::GetFullPath($candidate)
    $prefix = $root.TrimEnd([char[]]@('\', '/')) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label resolves outside the selected root."
    }
    return [pscustomobject]@{ RootPath = $root; RelativePath = $relative; Path = $resolved }
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
        throw 'A scanned path resolved outside the selected root.'
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

    $trimmed = $ProfileId.Trim().ToLowerInvariant()
    if ($AllowEmpty -and [string]::IsNullOrWhiteSpace($trimmed)) {
        return ''
    }
    $parsed = [guid]::Empty
    if (-not [guid]::TryParseExact($trimmed, 'D', [ref]$parsed)) {
        throw 'profileId must be a lowercase hyphenated GUID.'
    }
    return $parsed.ToString('D')
}

function ConvertTo-NormalizedExtensions {
    param([Parameter(Mandatory = $true)]$Values)

    if ($null -eq $Values -or $Values -is [string]) {
        throw 'Rule extensions must be an array of strings.'
    }
    $seen = @{}
    $result = [System.Collections.Generic.List[string]]::new()
    foreach ($entry in @($Values)) {
        if ($entry -isnot [string]) {
            throw 'Rule extensions must contain only strings.'
        }
        $extension = ([string]$entry).Trim().ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($extension)) {
            continue
        }
        if (-not $extension.StartsWith('.')) {
            $extension = ".$extension"
        }
        if ($extension.Length -gt 32 -or $extension -notmatch '^\.[a-z0-9][a-z0-9._+-]*$') {
            throw "Rule extension '$extension' is invalid."
        }
        if (-not $seen.ContainsKey($extension)) {
            $seen[$extension] = $true
            $result.Add($extension)
        }
    }
    return @($result | Sort-Object)
}

function ConvertTo-ValidatedRule {
    param(
        [Parameter(Mandatory = $true)]$Rule,
        [Parameter(Mandatory = $true)][int]$Index
    )

    $label = "rules[$Index]"
    Assert-ObjectProperties -Object $Rule `
        -Allowed @('ruleId', 'name', 'targetFolder', 'extensions', 'nameContains', 'matchAll', 'enabled') `
        -Required @('ruleId', 'name', 'targetFolder', 'extensions', 'nameContains', 'matchAll', 'enabled') `
        -Label $label
    $ruleId = Get-RequiredString -Object $Rule -Name 'ruleId' -Label $label -MaximumLength 128
    if ($ruleId -notmatch '^[a-zA-Z0-9._-]+$') {
        throw "$label.ruleId contains unsupported characters."
    }
    $name = Get-RequiredString -Object $Rule -Name 'name' -Label $label -MaximumLength 120
    $targetFolder = Normalize-RelativeFolder `
        -RelativePath (Get-RequiredString -Object $Rule -Name 'targetFolder' -Label $label -MaximumLength 520) `
        -Label "$label.targetFolder"
    $extensions = @(ConvertTo-NormalizedExtensions -Values $Rule.extensions)
    $nameContains = Get-RequiredString -Object $Rule -Name 'nameContains' -Label $label -MaximumLength 120 -AllowEmpty
    $matchAll = Get-RequiredBoolean -Object $Rule -Name 'matchAll' -Label $label
    $enabled = Get-RequiredBoolean -Object $Rule -Name 'enabled' -Label $label
    if (-not $matchAll -and $extensions.Count -eq 0 -and [string]::IsNullOrWhiteSpace($nameContains)) {
        throw "$label must declare an extension, a filename fragment, or matchAll."
    }
    return [pscustomobject][ordered]@{
        ruleId = $ruleId
        name = $name
        targetFolder = $targetFolder
        extensions = $extensions
        nameContains = $nameContains
        matchAll = $matchAll
        enabled = $enabled
    }
}

function ConvertTo-ValidatedProfile {
    param([Parameter(Mandatory = $true)]$Profile)

    Assert-ObjectProperties -Object $Profile `
        -Allowed @('schemaVersion', 'format', 'profileId', 'name', 'rules', 'createdAt', 'updatedAt') `
        -Required @('schemaVersion', 'format', 'profileId', 'name', 'rules', 'createdAt', 'updatedAt') `
        -Label 'Profile'
    if ([int]$Profile.schemaVersion -ne 1 -or [string]$Profile.format -ne $script:ProfileFormat) {
        throw 'Profile format is not supported by this Setup Organization package.'
    }
    $profileId = Validate-ProfileId -ProfileId ([string]$Profile.profileId)
    $name = Get-RequiredString -Object $Profile -Name 'name' -Label 'Profile' -MaximumLength 120
    if ($null -eq $Profile.rules -or $Profile.rules -is [string]) {
        throw 'Profile.rules must be an array.'
    }
    $rules = [System.Collections.Generic.List[object]]::new()
    $ruleIds = @{}
    $index = 0
    foreach ($rule in @($Profile.rules)) {
        $validated = ConvertTo-ValidatedRule -Rule $rule -Index $index
        $normalizedRuleId = ([string]$validated.ruleId).ToLowerInvariant()
        if ($ruleIds.ContainsKey($normalizedRuleId)) {
            throw "Profile contains duplicate ruleId '$($validated.ruleId)'."
        }
        $ruleIds[$normalizedRuleId] = $true
        $rules.Add($validated)
        $index += 1
    }
    $createdAt = Get-RequiredString -Object $Profile -Name 'createdAt' -Label 'Profile' -MaximumLength 64
    $updatedAt = Get-RequiredString -Object $Profile -Name 'updatedAt' -Label 'Profile' -MaximumLength 64
    return [ordered]@{
        schemaVersion = 1
        format = $script:ProfileFormat
        profileId = $profileId
        name = $name
        rules = $rules.ToArray()
        createdAt = $createdAt
        updatedAt = $updatedAt
    }
}

function Get-ProfilePath {
    param([Parameter(Mandatory = $true)][string]$ProfileId)

    $safeId = Validate-ProfileId -ProfileId $ProfileId
    return Join-Path (Get-ProfilesRoot) "$safeId.json"
}

function Read-Profile {
    param([Parameter(Mandatory = $true)][string]$ProfileId)

    $path = Get-ProfilePath -ProfileId $ProfileId
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Saved profile '$ProfileId' was not found."
    }
    Assert-NotReparsePoint -Path $path -Label 'Saved profile'
    try {
        $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "Saved profile '$ProfileId' is invalid JSON: $($_.Exception.Message)"
    }
    return ConvertTo-ValidatedProfile -Profile $raw
}

function Write-AtomicJsonFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $parent = Split-Path -Parent $Path
    [System.IO.Directory]::CreateDirectory($parent) | Out-Null
    $temporary = Join-Path $parent ('.{0}.{1}.tmp' -f ([System.IO.Path]::GetFileName($Path)), [guid]::NewGuid().ToString('N'))
    try {
        $body = ($Value | ConvertTo-Json -Depth 16) + [Environment]::NewLine
        [System.IO.File]::WriteAllText($temporary, $body, [System.Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $temporary -Destination $Path -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporary) {
            Remove-Item -LiteralPath $temporary -Force
        }
    }
}

function Invoke-ScanRoot {
    param([Parameter(Mandatory = $true)]$Request)

    Assert-ObjectProperties -Object $Request -Allowed @('operation', 'rootPath') -Required @('operation', 'rootPath') -Label 'scan-root request'
    $root = Resolve-ExistingRoot -RootPath (Get-RequiredString -Object $Request -Name 'rootPath' -Label 'scan-root request' -MaximumLength 32767)
    $folders = [System.Collections.Generic.List[object]]::new()
    $files = [System.Collections.Generic.List[object]]::new()
    $folders.Add([ordered]@{ relativePath = '.'; name = [System.IO.Path]::GetFileName($root.TrimEnd('\')) })
    $pending = [System.Collections.Generic.Stack[string]]::new()
    $pending.Push($root)
    while ($pending.Count -gt 0) {
        $directory = $pending.Pop()
        $entries = @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction Stop | Sort-Object -Property Name)
        foreach ($entry in $entries) {
            if (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                continue
            }
            if ($entry.PSIsContainer) {
                if ($folders.Count -ge $script:MaximumScanEntries) {
                    throw "The root contains more than $($script:MaximumScanEntries) folders; choose a narrower root."
                }
                $relative = ConvertTo-RelativePath -RootPath $root -Path $entry.FullName
                $folders.Add([ordered]@{ relativePath = $relative; name = $entry.Name })
                $pending.Push($entry.FullName)
            }
            elseif ($directory.Equals($root, [System.StringComparison]::OrdinalIgnoreCase)) {
                if ($files.Count -ge $script:MaximumScanEntries) {
                    throw "The root contains more than $($script:MaximumScanEntries) loose files; choose a narrower root."
                }
                $extension = [System.IO.Path]::GetExtension($entry.Name).ToLowerInvariant()
                $files.Add([ordered]@{
                    relativePath = $entry.Name
                    name = $entry.Name
                    extension = $extension
                    size = [double]$entry.Length
                })
            }
        }
    }
    return [ordered]@{
        rootPath = $root
        folders = @($folders.ToArray() | Sort-Object { $_.relativePath.ToLowerInvariant() })
        files = @($files.ToArray() | Sort-Object { $_.name.ToLowerInvariant() })
    }
}

function Invoke-ListProfiles {
    param([Parameter(Mandatory = $true)]$Request)

    Assert-ObjectProperties -Object $Request -Allowed @('operation') -Required @('operation') -Label 'list-profiles request'
    $profilesRoot = Get-ProfilesRoot
    if (-not (Test-Path -LiteralPath $profilesRoot -PathType Container)) {
        return [ordered]@{ profiles = @() }
    }
    Assert-NotReparsePoint -Path $profilesRoot -Label 'Profiles directory'
    $profiles = [System.Collections.Generic.List[object]]::new()
    foreach ($entry in @(Get-ChildItem -LiteralPath $profilesRoot -Filter '*.json' -File -Force | Sort-Object -Property Name)) {
        if (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Saved profile cannot be a symbolic link or reparse point: $($entry.FullName)"
        }
        $profile = Read-Profile -ProfileId $entry.BaseName
        $profiles.Add([ordered]@{
            profileId = $profile.profileId
            name = $profile.name
            updatedAt = $profile.updatedAt
            ruleCount = [int]$profile.rules.Count
        })
    }
    return [ordered]@{ profiles = @($profiles.ToArray() | Sort-Object { $_.name.ToLowerInvariant() }) }
}

function Invoke-LoadProfile {
    param([Parameter(Mandatory = $true)]$Request)

    Assert-ObjectProperties -Object $Request -Allowed @('operation', 'profileId') -Required @('operation', 'profileId') -Label 'load-profile request'
    $profileId = Get-RequiredString -Object $Request -Name 'profileId' -Label 'load-profile request' -MaximumLength 36
    return [ordered]@{ profile = Read-Profile -ProfileId $profileId }
}

function Invoke-SaveProfile {
    param([Parameter(Mandatory = $true)]$Request)

    Assert-ObjectProperties -Object $Request `
        -Allowed @('operation', 'profileId', 'name', 'rules') `
        -Required @('operation', 'profileId', 'name', 'rules') `
        -Label 'save-profile request'
    $requestedId = Get-RequiredString -Object $Request -Name 'profileId' -Label 'save-profile request' -MaximumLength 36 -AllowEmpty
    $profileId = Validate-ProfileId -ProfileId $requestedId -AllowEmpty
    if ([string]::IsNullOrWhiteSpace($profileId)) {
        $profileId = [guid]::NewGuid().ToString('D')
    }
    $name = Get-RequiredString -Object $Request -Name 'name' -Label 'save-profile request' -MaximumLength 120
    if ($null -eq $Request.rules -or $Request.rules -is [string]) {
        throw 'save-profile request.rules must be an array.'
    }
    $rules = [System.Collections.Generic.List[object]]::new()
    $ruleIds = @{}
    $index = 0
    foreach ($rule in @($Request.rules)) {
        $validated = ConvertTo-ValidatedRule -Rule $rule -Index $index
        $key = ([string]$validated.ruleId).ToLowerInvariant()
        if ($ruleIds.ContainsKey($key)) {
            throw "save-profile request contains duplicate ruleId '$($validated.ruleId)'."
        }
        $ruleIds[$key] = $true
        $rules.Add($validated)
        $index += 1
    }
    $path = Get-ProfilePath -ProfileId $profileId
    $now = [DateTimeOffset]::UtcNow.ToString('o')
    $createdAt = $now
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        $existing = Read-Profile -ProfileId $profileId
        $createdAt = $existing.createdAt
    }
    $profile = [ordered]@{
        schemaVersion = 1
        format = $script:ProfileFormat
        profileId = $profileId
        name = $name
        rules = $rules.ToArray()
        createdAt = $createdAt
        updatedAt = $now
    }
    $validatedProfile = ConvertTo-ValidatedProfile -Profile ([pscustomobject]$profile)
    Write-AtomicJsonFile -Path $path -Value $validatedProfile
    return [ordered]@{ profile = $validatedProfile }
}

function Test-RuleMatch {
    param(
        [Parameter(Mandatory = $true)]$Rule,
        [Parameter(Mandatory = $true)][System.IO.FileInfo]$File
    )

    if (-not [bool]$Rule.enabled) {
        return $false
    }
    if ([bool]$Rule.matchAll) {
        return $true
    }
    $extensionMatches = $Rule.extensions.Count -eq 0 -or $Rule.extensions -contains $File.Extension.ToLowerInvariant()
    $nameMatches = [string]::IsNullOrWhiteSpace([string]$Rule.nameContains) -or
        $File.Name.IndexOf([string]$Rule.nameContains, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    return $extensionMatches -and $nameMatches
}

function Invoke-ApplyProfile {
    param([Parameter(Mandatory = $true)]$Request)

    Assert-ObjectProperties -Object $Request -Allowed @('operation', 'profileId', 'rootPath') -Required @('operation', 'profileId', 'rootPath') -Label 'apply-profile request'
    $profileId = Get-RequiredString -Object $Request -Name 'profileId' -Label 'apply-profile request' -MaximumLength 36
    $root = Resolve-ExistingRoot -RootPath (Get-RequiredString -Object $Request -Name 'rootPath' -Label 'apply-profile request' -MaximumLength 32767)
    $profile = Read-Profile -ProfileId $profileId
    $targets = @{}
    foreach ($rule in @($profile.rules)) {
        if (-not [bool]$rule.enabled) {
            continue
        }
        $resolved = Resolve-DescendantFolder -RootPath $root -RelativePath ([string]$rule.targetFolder) -Label 'Profile target folder'
        if (-not (Test-Path -LiteralPath $resolved.Path)) {
            [System.IO.Directory]::CreateDirectory($resolved.Path) | Out-Null
        }
        Assert-NotReparsePoint -Path $resolved.Path -Label 'Profile target folder'
        $targets[[string]$rule.ruleId] = $resolved.Path
    }
    $moved = 0
    $skipped = 0
    $unmatched = 0
    foreach ($file in @(Get-ChildItem -LiteralPath $root -File -Force | Sort-Object -Property Name)) {
        if (($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            $skipped += 1
            continue
        }
        $matchedRule = $null
        foreach ($rule in @($profile.rules)) {
            if (Test-RuleMatch -Rule $rule -File $file) {
                $matchedRule = $rule
                break
            }
        }
        if ($null -eq $matchedRule) {
            $unmatched += 1
            continue
        }
        $destination = Join-Path $targets[[string]$matchedRule.ruleId] $file.Name
        if (Test-Path -LiteralPath $destination) {
            $skipped += 1
            continue
        }
        Move-Item -LiteralPath $file.FullName -Destination $destination
        $moved += 1
    }
    return [ordered]@{
        profileId = $profile.profileId
        rootPath = $root
        foldersEnsured = [int]$targets.Count
        moved = $moved
        skipped = $skipped
        unmatched = $unmatched
    }
}

function Invoke-CreateFolder {
    param([Parameter(Mandatory = $true)]$Request)

    Assert-ObjectProperties -Object $Request -Allowed @('operation', 'rootPath', 'relativePath') -Required @('operation', 'rootPath', 'relativePath') -Label 'create-folder request'
    $resolved = Resolve-DescendantFolder `
        -RootPath (Get-RequiredString -Object $Request -Name 'rootPath' -Label 'create-folder request' -MaximumLength 32767) `
        -RelativePath (Get-RequiredString -Object $Request -Name 'relativePath' -Label 'create-folder request' -MaximumLength 520) `
        -Label 'Folder path'
    $created = -not (Test-Path -LiteralPath $resolved.Path)
    if ($created) {
        [System.IO.Directory]::CreateDirectory($resolved.Path) | Out-Null
    }
    Assert-NotReparsePoint -Path $resolved.Path -Label 'Created folder'
    return [ordered]@{ created = $created; path = $resolved.Path; relativePath = $resolved.RelativePath }
}

function Invoke-RecycleFolder {
    param([Parameter(Mandatory = $true)]$Request)

    Assert-ObjectProperties -Object $Request -Allowed @('operation', 'rootPath', 'relativePath') -Required @('operation', 'rootPath', 'relativePath') -Label 'recycle-folder request'
    $resolved = Resolve-DescendantFolder `
        -RootPath (Get-RequiredString -Object $Request -Name 'rootPath' -Label 'recycle-folder request' -MaximumLength 32767) `
        -RelativePath (Get-RequiredString -Object $Request -Name 'relativePath' -Label 'recycle-folder request' -MaximumLength 520) `
        -Label 'Folder path'
    if (-not (Test-Path -LiteralPath $resolved.Path -PathType Container)) {
        throw "The exact folder does not exist: $($resolved.Path)"
    }
    Assert-NotReparsePoint -Path $resolved.Path -Label 'Recycled folder'
    Add-Type -AssemblyName Microsoft.VisualBasic
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
        $resolved.Path,
        [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
        [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
    )
    return [ordered]@{ recycled = $true; path = $resolved.Path; relativePath = $resolved.RelativePath }
}

function Send-FileToRecycleBin {
    param([Parameter(Mandatory = $true)][string]$Path)

    Assert-NotReparsePoint -Path $Path -Label 'Legacy sidecar'
    Add-Type -AssemblyName Microsoft.VisualBasic
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
        $Path,
        [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
        [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
    )
}

function Send-EmptyDirectoryToRecycleBin {
    param([Parameter(Mandatory = $true)][string]$Path)

    Assert-NotReparsePoint -Path $Path -Label 'Legacy metadata directory'
    if (@(Get-ChildItem -LiteralPath $Path -Force -ErrorAction Stop).Count -ne 0) {
        return $false
    }
    Add-Type -AssemblyName Microsoft.VisualBasic
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
        $Path,
        [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
        [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
    )
    return $true
}

function Invoke-RecycleLegacySidecars {
    param([Parameter(Mandatory = $true)]$Request)

    Assert-ObjectProperties -Object $Request `
        -Allowed @('operation', 'rootPath') `
        -Required @('operation', 'rootPath') `
        -Label 'recycle-legacy-sidecars request'
    $root = Resolve-ExistingRoot -RootPath (Get-RequiredString -Object $Request -Name 'rootPath' -Label 'recycle-legacy-sidecars request' -MaximumLength 32767)
    $recycled = [System.Collections.Generic.List[string]]::new()
    $directEntries = @(Get-ChildItem -LiteralPath $root -Force -ErrorAction Stop)
    foreach ($entry in $directEntries) {
        if ($entry.PSIsContainer) {
            continue
        }
        $name = $entry.Name
        $isExactProfile = $name.Equals('organize-folder.profile.json', [System.StringComparison]::OrdinalIgnoreCase)
        $isExactRunSidecar = $name -match '^(?i:organize-folder|new-organization)(?: \([1-9][0-9]*\))?\.(?:log\.txt|undo\.json)$'
        if ($isExactProfile -or $isExactRunSidecar) {
            Send-FileToRecycleBin -Path $entry.FullName
            $recycled.Add($name)
        }
    }

    $metadataDirectories = @(
        $directEntries |
            Where-Object { $_.PSIsContainer -and $_.Name.Equals('.flowcell', [System.StringComparison]::OrdinalIgnoreCase) }
    )
    if ($metadataDirectories.Count -gt 1) {
        throw 'The selected root contains multiple case-insensitive .flowcell directory matches.'
    }
    if ($metadataDirectories.Count -eq 1) {
        $metadataDirectory = $metadataDirectories[0]
        Assert-NotReparsePoint -Path $metadataDirectory.FullName -Label 'Legacy metadata directory'
        $metadataEntries = @(Get-ChildItem -LiteralPath $metadataDirectory.FullName -Force -ErrorAction Stop)
        foreach ($entry in $metadataEntries) {
            if (-not $entry.PSIsContainer -and
                $entry.Name.Equals('organization-profile.json', [System.StringComparison]::OrdinalIgnoreCase)) {
                Send-FileToRecycleBin -Path $entry.FullName
                $recycled.Add("$($metadataDirectory.Name)/$($entry.Name)")
            }
        }
        if (Send-EmptyDirectoryToRecycleBin -Path $metadataDirectory.FullName) {
            $recycled.Add($metadataDirectory.Name)
        }
    }
    return [ordered]@{ rootPath = $root; recycledPaths = $recycled.ToArray() }
}

function Get-CurrentPanelName {
    param(
        [Parameter(Mandatory = $true)][string]$WindowsProgramRoot,
        [Parameter(Mandatory = $true)][string[]]$Panels
    )

    $sourceRoot = ConvertFrom-ExtendedWindowsPath -Path ([System.IO.Path]::GetFullPath($PSScriptRoot))
    $ownerRoot = Split-Path -Parent $sourceRoot
    $ownerId = Split-Path -Leaf $ownerRoot
    $panelsRoot = Join-Path $WindowsProgramRoot 'Panels'
    foreach ($panel in $Panels) {
        $panelRoot = Join-Path $panelsRoot $panel
        foreach ($recordPath in @(Get-ChildItem -LiteralPath $panelRoot -Filter '*.flowcell-source.json' -File -Force -ErrorAction SilentlyContinue)) {
            try {
                $record = Get-Content -LiteralPath $recordPath.FullName -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
                if ([string]$record.ownerButtonId -eq $ownerId -and
                    [string]$record.programName -eq 'Windows' -and
                    $Panels -contains [string]$record.panelName) {
                    return [string]$record.panelName
                }
            }
            catch {
                continue
            }
        }
    }
    return ''
}

function Invoke-ListPanels {
    param([Parameter(Mandatory = $true)]$Request)

    Assert-ObjectProperties -Object $Request -Allowed @('operation') -Required @('operation') -Label 'list-panels request'
    $windowsProgramRoot = Join-Path (Resolve-FlowCellRoot) 'Programs\Windows'
    $panelsRoot = Join-Path $windowsProgramRoot 'Panels'
    if (-not (Test-Path -LiteralPath $panelsRoot -PathType Container)) {
        throw 'The Windows Panels directory is missing.'
    }
    Assert-NotReparsePoint -Path $panelsRoot -Label 'Windows Panels directory'
    $panels = @(
        Get-ChildItem -LiteralPath $panelsRoot -Directory -Force |
            Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0 } |
            ForEach-Object { $_.Name } |
            Where-Object { $_ -ne '.' -and $_ -ne '..' -and $_ -notmatch '[\\/]' } |
            Sort-Object -Unique
    )
    if ($panels.Count -eq 0) {
        throw 'No Windows panels are available for generated profile Buttons.'
    }
    $currentPanel = Get-CurrentPanelName -WindowsProgramRoot $windowsProgramRoot -Panels $panels
    $defaultPanel = if (-not [string]::IsNullOrWhiteSpace($currentPanel)) {
        $currentPanel
    }
    elseif ($panels -contains 'Files') {
        'Files'
    }
    else {
        [string]$panels[0]
    }
    return [ordered]@{ panels = @($panels); defaultPanel = $defaultPanel; currentPanel = $currentPanel }
}

function Remove-ExpiredStages {
    $stagingRoot = Get-StagingRoot
    if (-not (Test-Path -LiteralPath $stagingRoot -PathType Container)) {
        return
    }
    Assert-NotReparsePoint -Path $stagingRoot -Label 'Staging directory'
    $cutoff = [DateTime]::UtcNow.AddDays(-1)
    foreach ($entry in @(Get-ChildItem -LiteralPath $stagingRoot -Directory -Force)) {
        if (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            continue
        }
        if ($entry.LastWriteTimeUtc -lt $cutoff -and $entry.Name -match '^[0-9a-f]{8}-[0-9a-f-]{27}$') {
            Remove-Item -LiteralPath $entry.FullName -Recurse -Force
        }
    }
}

function Invoke-StageGeneratedButton {
    param([Parameter(Mandatory = $true)]$Request)

    Assert-ObjectProperties -Object $Request -Allowed @('operation', 'profileId') -Required @('operation', 'profileId') -Label 'stage-generated-button request'
    $profileId = Validate-ProfileId -ProfileId (Get-RequiredString -Object $Request -Name 'profileId' -Label 'stage-generated-button request' -MaximumLength 36)
    $profile = Read-Profile -ProfileId $profileId
    Remove-ExpiredStages
    $stageToken = [guid]::NewGuid().ToString('D')
    $stageRoot = Join-Path (Get-StagingRoot) $stageToken
    $sourceRoot = Join-Path $stageRoot 'source'
    if (Test-Path -LiteralPath $stageRoot) {
        throw 'A generated Button staging collision occurred.'
    }
    [System.IO.Directory]::CreateDirectory($sourceRoot) | Out-Null
    try {
        $installedSourceRoot = ConvertFrom-ExtendedWindowsPath -Path ([System.IO.Path]::GetFullPath($PSScriptRoot))
        $templatePath = Join-Path $installedSourceRoot 'templates\apply_profile.ps1.template'
        if (-not (Test-Path -LiteralPath $templatePath -PathType Leaf)) {
            throw 'The generated profile Button template is missing from its installed owner.'
        }
        Assert-NotReparsePoint -Path $templatePath -Label 'Generated profile Button template'
        $template = Get-Content -LiteralPath $templatePath -Raw -Encoding UTF8
        $token = '__FLOWCELL_PROFILE_ID__'
        if ([regex]::Matches($template, [regex]::Escape($token)).Count -ne 1) {
            throw 'The generated profile Button template has an invalid profile identity token.'
        }
        $scriptBody = $template.Replace($token, $profileId)
        $scriptPath = Join-Path $sourceRoot 'apply_profile.ps1'
        [System.IO.File]::WriteAllText($scriptPath, $scriptBody, [System.Text.UTF8Encoding]::new($false))
        $packageId = "windows.setup-organization-profile.$profileId"
        $manifest = [ordered]@{
            schemaVersion = 1
            id = $packageId
            label = $profile.name
            tooltip = "Apply the saved '$($profile.name)' Setup Organization profile to the clipboard folder."
            program = 'Windows'
            source = 'apply_profile.ps1'
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
            metadata = [ordered]@{
                profileId = $profileId
            }
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

try {
    if ($FlowCellCapability -ne $script:CapabilityId) {
        throw "Unsupported Windows capability '$FlowCellCapability'."
    }
    $request = Read-Request
    Assert-ObjectProperties -Object $request `
        -Allowed @('operation', 'rootPath', 'relativePath', 'profileId', 'name', 'rules') `
        -Required @('operation') `
        -Label 'Capability request'
    $operation = Get-RequiredString -Object $request -Name 'operation' -Label 'Capability request' -MaximumLength 64
    $response = switch ($operation) {
        'scan-root' { Invoke-ScanRoot -Request $request; break }
        'list-profiles' { Invoke-ListProfiles -Request $request; break }
        'load-profile' { Invoke-LoadProfile -Request $request; break }
        'save-profile' { Invoke-SaveProfile -Request $request; break }
        'apply-profile' { Invoke-ApplyProfile -Request $request; break }
        'create-folder' { Invoke-CreateFolder -Request $request; break }
        'recycle-folder' { Invoke-RecycleFolder -Request $request; break }
        'recycle-legacy-sidecars' { Invoke-RecycleLegacySidecars -Request $request; break }
        'list-panels' { Invoke-ListPanels -Request $request; break }
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
