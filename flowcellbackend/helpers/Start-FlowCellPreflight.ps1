[CmdletBinding()]
param(
    [switch]$DefinitionsOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$FlowCellRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ProgramsRoot = Join-Path $FlowCellRoot 'Programs'
$LocalRoot = Join-Path $FlowCellRoot 'flowcellbackend\local'
$LogRoot = Join-Path $LocalRoot 'logs'
$LogPath = Join-Path $LogRoot 'startup-preflight.log'
$BindingsPath = Join-Path $LocalRoot 'bindings.ini'

function Write-PreflightLog {
    param([string]$Message)
    try {
        New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
        $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        Add-Content -LiteralPath $LogPath -Value "[$timestamp] $Message" -Encoding UTF8
    } catch {
    }
}

function Resolve-ManifestRelativePath {
    param(
        [string]$Root,
        [AllowEmptyString()][string]$Value,
        [string]$Field,
        [switch]$AllowEmpty
    )

    $trimmed = ([string]$Value).Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        if ($AllowEmpty) {
            return ''
        }
        throw "Program manifest field '$Field' cannot be empty."
    }
    if ([System.IO.Path]::IsPathRooted($trimmed)) {
        throw "Program manifest field '$Field' must be relative to its program package."
    }

    $parts = @($trimmed -split '[\\/]' | Where-Object { $_ -ne '' -and $_ -ne '.' })
    if ($parts.Count -eq 0 -or @($parts | Where-Object { $_ -eq '..' }).Count -gt 0) {
        throw "Program manifest field '$Field' must not contain parent traversal."
    }
    $normalized = [string]$parts[0]
    for ($index = 1; $index -lt $parts.Count; $index++) {
        $normalized = Join-Path $normalized ([string]$parts[$index])
    }

    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $rootFull $normalized))
    $rootPrefix = $rootFull + [System.IO.Path]::DirectorySeparatorChar
    if (-not $candidate.Equals($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -and
        -not $candidate.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Program manifest field '$Field' resolves outside '$rootFull'."
    }

    $resolvedRoot = (Resolve-Path -LiteralPath $rootFull -ErrorAction Stop).Path.TrimEnd('\', '/')
    $existingBoundary = $candidate
    while (-not (Test-Path -LiteralPath $existingBoundary)) {
        $parent = Split-Path -Parent $existingBoundary
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $existingBoundary) {
            throw "Program manifest field '$Field' has no resolvable package ancestor."
        }
        $existingBoundary = $parent
    }
    $resolvedBoundary = (Resolve-Path -LiteralPath $existingBoundary -ErrorAction Stop).Path.TrimEnd('\', '/')
    $resolvedPrefix = $resolvedRoot + [System.IO.Path]::DirectorySeparatorChar
    if (-not $resolvedBoundary.Equals($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
        -not $resolvedBoundary.StartsWith($resolvedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Program manifest field '$Field' resolves outside '$resolvedRoot'."
    }
    return $candidate
}

function Read-PreflightIni {
    param([string]$Path)

    $document = [ordered]@{}
    $currentSection = ''
    $document[$currentSection] = [ordered]@{}

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $document
    }

    foreach ($line in (Get-Content -LiteralPath $Path -ErrorAction Stop)) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith(';') -or $trimmed.StartsWith('#')) {
            continue
        }
        if ($trimmed.StartsWith('[') -and $trimmed.EndsWith(']') -and $trimmed.Length -ge 2) {
            $currentSection = $trimmed.Substring(1, $trimmed.Length - 2).Trim()
            if (-not $document.Contains($currentSection)) {
                $document[$currentSection] = [ordered]@{}
            }
            continue
        }
        $separatorIndex = $trimmed.IndexOf('=')
        if ($separatorIndex -lt 0) {
            continue
        }
        $key = $trimmed.Substring(0, $separatorIndex).Trim()
        $value = $trimmed.Substring($separatorIndex + 1).Trim()
        $document[$currentSection][$key] = $value
    }

    return $document
}

function Write-PreflightIni {
    param(
        [string]$Path,
        [System.Collections.IDictionary]$Document
    )

    $sections = @($Document.Keys) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }
    $sections = $sections | Sort-Object {
        $section = [string]$_
        if ($section -ieq 'Meta') { '000_' + $section }
        elseif ($section -ieq 'ActionHotkeys') { '001_' + $section }
        elseif ($section -like 'ProgramTab_*') { '002_' + $section }
        elseif ($section -like 'Binding_*') { '003_' + $section }
        else { '999_' + $section }
    }

    $blocks = New-Object System.Collections.Generic.List[string]
    foreach ($section in $sections) {
        $lines = New-Object System.Collections.Generic.List[string]
        $lines.Add("[$section]") | Out-Null
        $keys = @($Document[$section].Keys) | Sort-Object
        foreach ($key in $keys) {
            $lines.Add(('{0}={1}' -f $key, $Document[$section][$key])) | Out-Null
        }
        $blocks.Add(($lines -join "`r`n")) | Out-Null
    }

    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $content = (($blocks -join "`r`n`r`n") + "`r`n")
    $leaf = Split-Path -Leaf $Path
    $token = [guid]::NewGuid().ToString('N')
    $staged = Join-Path $parent ('.{0}.{1}.writing' -f $leaf, $token)
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($content)
    $stream = [System.IO.File]::Open($staged, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    }
    finally {
        $stream.Dispose()
    }
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $backup = Join-Path $parent ('.{0}.{1}.backup' -f $leaf, $token)
        [System.IO.File]::Replace($staged, $Path, $backup, $true)
    }
    else {
        [System.IO.File]::Move($staged, $Path)
    }
}

function Restore-PendingBindingsAtomicWrite {
    param([string]$Path)

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        return
    }
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        return
    }
    $leaf = Split-Path -Leaf $Path
    $artifacts = @(Get-ChildItem -LiteralPath $parent -File -ErrorAction SilentlyContinue)
    $candidate = $artifacts |
        Where-Object { $_.Name -eq ".$leaf.backup" -or ($_.Name.StartsWith(".$leaf.") -and $_.Name.EndsWith('.backup')) } |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if (-not $candidate) {
        $candidate = $artifacts |
            Where-Object { $_.Name.StartsWith(".$leaf.") -and $_.Name.EndsWith('.writing') } |
            Sort-Object LastWriteTimeUtc -Descending |
            Select-Object -First 1
    }
    if ($candidate) {
        [System.IO.File]::Move($candidate.FullName, $Path)
        Write-PreflightLog "Recovered bindings from interrupted atomic write: $($candidate.Name)"
    }
}

function Get-ProgramTabIdsFromDocument {
    param([System.Collections.IDictionary]$Document)

    $ids = New-Object System.Collections.Generic.List[int]
    foreach ($section in @($Document.Keys)) {
        $name = [string]$section
        if (-not $name.StartsWith('ProgramTab_')) {
            continue
        }
        $rawId = $name.Substring('ProgramTab_'.Length)
        $id = 0
        if ([int]::TryParse($rawId, [ref]$id) -and $id -gt 0) {
            $ids.Add($id) | Out-Null
        }
    }
    return @($ids | Sort-Object -Unique)
}

function Get-ProgramTabSectionNameByLabel {
    param(
        [System.Collections.IDictionary]$Document,
        [string]$Label
    )

    foreach ($sectionName in @($Document.Keys)) {
        $name = [string]$sectionName
        if (-not $name.StartsWith('ProgramTab_')) {
            continue
        }

        $section = $Document[$name]
        if ($section.Contains('Label') -and [string]::Equals([string]$section['Label'], $Label, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $name
        }
    }

    return $null
}

function New-ProgramTabSectionName {
    param(
        [System.Collections.IDictionary]$Document,
        [int]$PreferredId
    )

    $preferredSectionName = "ProgramTab_$PreferredId"
    if (-not $Document.Contains($preferredSectionName)) {
        return $preferredSectionName
    }

    $existingIds = @(Get-ProgramTabIdsFromDocument -Document $Document)
    $nextId = 1
    if ($existingIds.Count -gt 0) {
        $nextId = ([int]($existingIds | Measure-Object -Maximum).Maximum) + 1
    }
    while ($Document.Contains("ProgramTab_$nextId")) {
        $nextId++
    }

    return "ProgramTab_$nextId"
}

function Set-ManifestProgramRegistration {
    param(
        [System.Collections.IDictionary]$Document,
        [string]$Label,
        [int]$PreferredId,
        [string]$ScriptFolder,
        [string]$ProgramType,
        [string]$ExePath,
        [string]$RunMethod,
        [string]$AllowedScriptExtensions,
        [string]$BridgeFolder,
        [string]$RequiresRestart,
        [string]$DefaultPanels,
        [string]$ProcessNames
    )

    $sectionName = Get-ProgramTabSectionNameByLabel -Document $Document -Label $Label
    if ([string]::IsNullOrWhiteSpace($sectionName)) {
        $sectionName = New-ProgramTabSectionName -Document $Document -PreferredId $PreferredId
        $Document[$sectionName] = [ordered]@{}
        Write-PreflightLog "Registered built-in $Label program as $sectionName"
    }

    $section = $Document[$sectionName]
    $section['AllowedScriptExtensions'] = $AllowedScriptExtensions
    if (-not [string]::IsNullOrWhiteSpace($BridgeFolder) -or -not $section.Contains('BridgeFolder')) {
        $section['BridgeFolder'] = $BridgeFolder
    }
    $section['DefaultPanels'] = $DefaultPanels
    if (-not [string]::IsNullOrWhiteSpace($ExePath) -or -not $section.Contains('ExePath') -or [string]::IsNullOrWhiteSpace([string]$section['ExePath'])) {
        $section['ExePath'] = $ExePath
    }
    $section['Label'] = $Label
    $section['NormalizedName'] = $Label.ToLowerInvariant()
    $section['ProcessNames'] = $ProcessNames
    $section['ProgramType'] = $ProgramType
    $section['RequiresRestart'] = $RequiresRestart
    $section['RunMethod'] = $RunMethod
    $section['ScriptFolder'] = $ScriptFolder
}

function Ensure-ManifestProgramStructure {
    New-Item -ItemType Directory -Path $ProgramsRoot -Force | Out-Null
    $programRenameRoot = Join-Path $LocalRoot 'program-rename-transactions'
    $pendingProgramRename = @(
        Get-ChildItem -LiteralPath $programRenameRoot -Directory -ErrorAction SilentlyContinue
    ).Count -gt 0
    if ($pendingProgramRename) {
        Write-PreflightLog 'Pending program rename transaction found; deferred all bindings inspection and mutation until native recovery.'
        return
    }
    Restore-PendingBindingsAtomicWrite -Path $BindingsPath
    $document = Read-PreflightIni -Path $BindingsPath
    if (-not $document.Contains('Meta')) {
        $document['Meta'] = [ordered]@{}
    }

    $usedIds = @(Get-ProgramTabIdsFromDocument -Document $document)
    foreach ($programDirectory in @(Get-ChildItem -LiteralPath $ProgramsRoot -Directory -ErrorAction Stop | Sort-Object Name)) {
        $manifestPath = Join-Path $programDirectory.FullName 'flowcell.program.json'
        $existingSection = Get-ProgramTabSectionNameByLabel -Document $document -Label $programDirectory.Name
        if ([string]::IsNullOrWhiteSpace($existingSection)) {
            Write-PreflightLog "Program package is available but not added: $($programDirectory.Name)"
            continue
        }
        if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
            throw "Registered program package is missing its manifest: $manifestPath"
        }
        try {
            $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            throw "Program manifest is invalid: $manifestPath. $($_.Exception.Message)"
        }
        if ([int]$manifest.schemaVersion -ne 1 -or [string]::IsNullOrWhiteSpace([string]$manifest.programId) -or [string]::IsNullOrWhiteSpace([string]$manifest.label)) {
            throw "Program manifest requires schemaVersion 1, programId, and label: $manifestPath"
        }
        if (-not ([string]$manifest.label).Equals($programDirectory.Name, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Program manifest label '$($manifest.label)' does not match folder '$($programDirectory.Name)'."
        }

        $gitScripts = Resolve-ManifestRelativePath -Root $programDirectory.FullName -Value ([string]$manifest.gitScriptsFolder) -Field 'gitScriptsFolder'
        $localScripts = Resolve-ManifestRelativePath -Root $programDirectory.FullName -Value ([string]$manifest.localScriptsFolder) -Field 'localScriptsFolder'
        $panels = Resolve-ManifestRelativePath -Root $programDirectory.FullName -Value ([string]$manifest.panelsFolder) -Field 'panelsFolder'
        $supportScripts = Resolve-ManifestRelativePath -Root $programDirectory.FullName -Value ([string]$manifest.supportScriptsFolder) -Field 'supportScriptsFolder'
        foreach ($requiredFolder in @(
            @{ Path = $gitScripts; Field = 'gitScriptsFolder' },
            @{ Path = $supportScripts; Field = 'supportScriptsFolder' }
        )) {
            if (-not (Test-Path -LiteralPath $requiredFolder.Path -PathType Container)) {
                throw "Registered program manifest field '$($requiredFolder.Field)' must name an existing directory: $($requiredFolder.Path)"
            }
        }
        $installScript = Resolve-ManifestRelativePath -Root $supportScripts -Value ([string]$manifest.runner.installScript) -Field 'runner.installScript' -AllowEmpty
        $deleteScript = Resolve-ManifestRelativePath -Root $supportScripts -Value ([string]$manifest.runner.deleteScript) -Field 'runner.deleteScript' -AllowEmpty
        foreach ($requiredScript in @(
            @{ Path = $installScript; Field = 'runner.installScript' },
            @{ Path = $deleteScript; Field = 'runner.deleteScript' }
        )) {
            if (-not [string]::IsNullOrWhiteSpace([string]$requiredScript.Path) -and
                -not (Test-Path -LiteralPath $requiredScript.Path -PathType Leaf)) {
                throw "Registered program manifest field '$($requiredScript.Field)' must name an existing file: $($requiredScript.Path)"
            }
        }

        $runnerKind = [string]$manifest.runner.kind
        if ($runnerKind -eq 'blender-bridge' -and ([string]::IsNullOrWhiteSpace($installScript) -or [string]::IsNullOrWhiteSpace($deleteScript))) {
            throw "Blender program manifest requires runner.installScript and runner.deleteScript: $manifestPath"
        }

        foreach ($requiredPath in @($localScripts, $panels)) {
            if (-not (Test-Path -LiteralPath $requiredPath -PathType Container)) {
                New-Item -ItemType Directory -Path $requiredPath -Force | Out-Null
                Write-PreflightLog "Created manifest-owned program structure: $requiredPath"
            }
        }

        $preferredId = 1
        if (-not [string]::IsNullOrWhiteSpace($existingSection) -and $existingSection -match '^ProgramTab_(\d+)$') {
            $preferredId = [int]$matches[1]
        }
        elseif ($usedIds.Count -gt 0) {
            $preferredId = ([int]($usedIds | Measure-Object -Maximum).Maximum) + 1
        }
        $usedIds += $preferredId

        $runMethod = switch ($runnerKind) {
            'windows-script' { 'windows_generic' }
            'illustrator-direct' { 'illustrator_direct' }
            'photoshop-direct' { 'photoshop_direct' }
            'blender-bridge' { 'blender_bridge' }
            default { throw "Unsupported runner kind '$runnerKind' in $manifestPath" }
        }
        $allowedExtensions = @($manifest.allowedScriptExtensions | ForEach-Object {
            $value = ([string]$_).Trim()
            if ($value -ne '' -and -not $value.StartsWith('.')) { '.' + $value } else { $value }
        } | Where-Object { $_ -ne '' }) -join '|'
        $defaultPanels = @($manifest.defaultPanels | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -ne '' }) -join '|'
        if ([string]::IsNullOrWhiteSpace($defaultPanels)) {
            $defaultPanels = @(Get-ChildItem -LiteralPath $panels -Directory -ErrorAction SilentlyContinue | ForEach-Object Name) -join '|'
        }
        $processNames = @($manifest.processNames | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -ne '' }) -join '|'
        $exePath = if ($manifest.PSObject.Properties['exePath']) { [string]$manifest.exePath } else { '' }
        $bridgeFolder = if ($runnerKind -eq 'blender-bridge') { $programDirectory.FullName } else { '' }

        Set-ManifestProgramRegistration `
            -Document $document `
            -Label ([string]$manifest.label) `
            -PreferredId $preferredId `
            -ScriptFolder $localScripts `
            -ProgramType ([string]$manifest.programType) `
            -ExePath $exePath `
            -RunMethod $runMethod `
            -AllowedScriptExtensions $allowedExtensions `
            -BridgeFolder $bridgeFolder `
            -RequiresRestart '0' `
            -DefaultPanels $defaultPanels `
            -ProcessNames $processNames
    }

    $programIds = @(Get-ProgramTabIdsFromDocument -Document $document)
    $document['Meta']['ProgramTabIds'] = ($programIds -join '|')
    $document['Meta']['ProgramTabNextId'] = [string]$(if ($programIds.Count -gt 0) { ([int]($programIds | Measure-Object -Maximum).Maximum) + 1 } else { 1 })
    $selectedProgramTabId = 0
    if (-not $document['Meta'].Contains('SelectedProgramTabId') -or -not [int]::TryParse([string]$document['Meta']['SelectedProgramTabId'], [ref]$selectedProgramTabId) -or -not (@($programIds) -contains $selectedProgramTabId)) {
        $document['Meta']['SelectedProgramTabId'] = [string]($programIds | Select-Object -First 1)
    }
    Write-PreflightIni -Path $BindingsPath -Document $document
}

if ($DefinitionsOnly) {
    return
}

try {
    Ensure-ManifestProgramStructure
} catch {
    Write-PreflightLog "Manifest program repair failed: $($_.Exception.Message)"
    throw
}

Write-PreflightLog 'Startup preflight completed.'
