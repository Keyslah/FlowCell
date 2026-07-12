[CmdletBinding()]
param()

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

    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    Set-Content -LiteralPath $Path -Value (($blocks -join "`r`n`r`n") + "`r`n") -Encoding UTF8
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
    $document = Read-PreflightIni -Path $BindingsPath
    if (-not $document.Contains('Meta')) {
        $document['Meta'] = [ordered]@{}
    }

    $usedIds = @(Get-ProgramTabIdsFromDocument -Document $document)
    foreach ($programDirectory in @(Get-ChildItem -LiteralPath $ProgramsRoot -Directory -ErrorAction Stop | Sort-Object Name)) {
        $manifestPath = Join-Path $programDirectory.FullName 'flowcell.program.json'
        if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
            continue
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

        $localScripts = Join-Path $programDirectory.FullName ([string]$manifest.localScriptsFolder)
        $panels = Join-Path $programDirectory.FullName ([string]$manifest.panelsFolder)
        foreach ($requiredPath in @($localScripts, $panels)) {
            if (-not (Test-Path -LiteralPath $requiredPath -PathType Container)) {
                New-Item -ItemType Directory -Path $requiredPath -Force | Out-Null
                Write-PreflightLog "Created manifest-owned program structure: $requiredPath"
            }
        }

        $existingSection = Get-ProgramTabSectionNameByLabel -Document $document -Label ([string]$manifest.label)
        $preferredId = 1
        if (-not [string]::IsNullOrWhiteSpace($existingSection) -and $existingSection -match '^ProgramTab_(\d+)$') {
            $preferredId = [int]$matches[1]
        }
        elseif ($usedIds.Count -gt 0) {
            $preferredId = ([int]($usedIds | Measure-Object -Maximum).Maximum) + 1
        }
        $usedIds += $preferredId

        $runnerKind = [string]$manifest.runner.kind
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

try {
    Ensure-ManifestProgramStructure
} catch {
    Write-PreflightLog "Manifest program repair failed: $($_.Exception.Message)"
    throw
}

Write-PreflightLog 'Startup preflight completed.'
