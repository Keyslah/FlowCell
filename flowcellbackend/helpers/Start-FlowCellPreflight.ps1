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
$script:RepairedLegacyBlenderWrapper = $false

function Write-PreflightLog {
    param([string]$Message)
    try {
        New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
        $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        Add-Content -LiteralPath $LogPath -Value "[$timestamp] $Message" -Encoding UTF8
    } catch {
    }
}

function Merge-DirectoryContents {
    param(
        [string]$Source,
        [string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Destination -PathType Container)) {
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    }

    Get-ChildItem -LiteralPath $Source -Force -ErrorAction SilentlyContinue | ForEach-Object {
        $target = Join-Path $Destination $_.Name
        if (-not (Test-Path -LiteralPath $target)) {
            Move-Item -LiteralPath $_.FullName -Destination $target
            Write-PreflightLog "Moved legacy payload item to $target"
        } elseif ($_.PSIsContainer -and (Test-Path -LiteralPath $target -PathType Container)) {
            Merge-DirectoryContents -Source $_.FullName -Destination $target
        } else {
            Write-PreflightLog "Preserved existing target and left conflicting legacy item at $($_.FullName)"
        }
    }
}

function Repair-ProgramPackageWrappers {
    $legacyBlenderPayload = Join-Path $ProgramsRoot 'FlowCell-Blender\Programs\Blender'
    if (-not (Test-Path -LiteralPath $legacyBlenderPayload -PathType Container)) {
        return
    }

    $target = Join-Path $ProgramsRoot 'Blender'
    if (-not (Test-Path -LiteralPath $target)) {
        Move-Item -LiteralPath $legacyBlenderPayload -Destination $target
        Write-PreflightLog "Moved legacy Blender payload to $target"
    } else {
        Merge-DirectoryContents -Source $legacyBlenderPayload -Destination $target
        Write-PreflightLog "Merged non-conflicting legacy Blender payload items into $target"
    }

    $script:RepairedLegacyBlenderWrapper = $true
}

function Move-EmptyDirectoryToRecycleBin {
    param([string]$Path)

    Add-Type -AssemblyName Microsoft.VisualBasic
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
        $Path,
        [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
        [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
    )
}

function Remove-EmptyAutoCreatedPanels {
    if (-not $script:RepairedLegacyBlenderWrapper) {
        return
    }

    $panelsRoot = Join-Path $ProgramsRoot 'Blender\Panels'
    if (-not (Test-Path -LiteralPath $panelsRoot -PathType Container)) {
        return
    }

    foreach ($panelName in @('Collections', 'Files', 'Utility', 'Layers')) {
        $panelPath = Join-Path $panelsRoot $panelName
        if (-not (Test-Path -LiteralPath $panelPath -PathType Container)) {
            continue
        }

        $children = @(Get-ChildItem -LiteralPath $panelPath -Force -ErrorAction SilentlyContinue)
        if ($children.Count -eq 0) {
            Move-EmptyDirectoryToRecycleBin -Path $panelPath
            Write-PreflightLog "Moved empty legacy auto-created panel to the Recycle Bin: $panelPath"
        }
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

function Set-CoreProgramRegistration {
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

function Ensure-CoreProgramStructure {
    New-Item -ItemType Directory -Path $ProgramsRoot -Force | Out-Null

    $windowsRoot = Join-Path $ProgramsRoot 'Windows'
    $windowsGitScripts = Join-Path $windowsRoot 'Windows Git Scripts'
    $windowsGitFiles = Join-Path $windowsGitScripts 'Files'
    $windowsLocalScripts = Join-Path $windowsRoot 'Windows Local Scripts'
    $windowsSupportScripts = Join-Path $windowsRoot 'SupportScripts'

    foreach ($path in @($windowsRoot, $windowsGitScripts, $windowsGitFiles, $windowsLocalScripts, $windowsSupportScripts)) {
        if (-not (Test-Path -LiteralPath $path -PathType Container)) {
            New-Item -ItemType Directory -Path $path -Force | Out-Null
            Write-PreflightLog "Created core Windows structure: $path"
        }
    }

    $document = Read-PreflightIni -Path $BindingsPath
    if (-not $document.Contains('Meta')) {
        $document['Meta'] = [ordered]@{}
    }

    Set-CoreProgramRegistration `
        -Document $document `
        -Label 'Windows' `
        -PreferredId 2 `
        -ScriptFolder $windowsGitScripts `
        -ProgramType 'generic' `
        -ExePath 'explorer.exe' `
        -RunMethod 'generic' `
        -AllowedScriptExtensions '.ps1|.cmd|.bat|.exe|.lnk|.vbs|.ahk' `
        -BridgeFolder '' `
        -RequiresRestart '0' `
        -DefaultPanels 'Files|Utility' `
        -ProcessNames 'explorer|dopus|dopusrt'

    $corePrograms = @(
        @{
            Label = 'Illustrator'
            PreferredId = 1
            ScriptFolderName = 'Illustrator Git Scripts'
            ProgramType = 'adobe_direct_script_runner'
            ExePath = ''
            RunMethod = 'illustrator_direct'
            AllowedScriptExtensions = '.jsx|.js'
            BridgeFolder = ''
            RequiresRestart = '0'
            DefaultPanels = 'Layers|Files|Utility'
            ProcessNames = 'illustrator'
        },
        @{
            Label = 'Blender'
            PreferredId = 3
            ScriptFolderName = 'Blender Git Scripts'
            ProgramType = 'bridge_runner'
            ExePath = ''
            RunMethod = 'blender_bridge'
            AllowedScriptExtensions = '.ps1|.py|.blend|.exe|.lnk'
            BridgeFolder = Join-Path $ProgramsRoot 'Blender'
            RequiresRestart = '0'
            DefaultPanels = 'Collections|Files|Utility'
            ProcessNames = 'blender|blender-launcher'
        },
        @{
            Label = 'Photoshop'
            PreferredId = 4
            ScriptFolderName = 'Photoshop Git Scripts'
            ProgramType = 'adobe_direct_script_runner'
            ExePath = ''
            RunMethod = 'photoshop_direct'
            AllowedScriptExtensions = '.jsx|.js'
            BridgeFolder = ''
            RequiresRestart = '0'
            DefaultPanels = 'Layers|Files|Utility'
            ProcessNames = 'photoshop'
        }
    )

    foreach ($program in $corePrograms) {
        $programRoot = Join-Path $ProgramsRoot $program.Label
        if (-not (Test-Path -LiteralPath $programRoot -PathType Container)) {
            continue
        }

        Set-CoreProgramRegistration `
            -Document $document `
            -Label $program.Label `
            -PreferredId $program.PreferredId `
            -ScriptFolder (Join-Path $programRoot $program.ScriptFolderName) `
            -ProgramType $program.ProgramType `
            -ExePath $program.ExePath `
            -RunMethod $program.RunMethod `
            -AllowedScriptExtensions $program.AllowedScriptExtensions `
            -BridgeFolder $program.BridgeFolder `
            -RequiresRestart $program.RequiresRestart `
            -DefaultPanels $program.DefaultPanels `
            -ProcessNames $program.ProcessNames
    }

    $programIds = @(Get-ProgramTabIdsFromDocument -Document $document)
    $document['Meta']['ProgramTabIds'] = ($programIds -join '|')
    $nextProgramId = 1
    if ($programIds.Count -gt 0) {
        $nextProgramId = ([int]($programIds | Measure-Object -Maximum).Maximum) + 1
    }
    $document['Meta']['ProgramTabNextId'] = [string]$nextProgramId
    $selectedProgramTabId = 0
    if (-not $document['Meta'].Contains('SelectedProgramTabId') -or -not [int]::TryParse([string]$document['Meta']['SelectedProgramTabId'], [ref]$selectedProgramTabId) -or -not (@($programIds) -contains $selectedProgramTabId)) {
        $document['Meta']['SelectedProgramTabId'] = [string]($programIds | Select-Object -First 1)
    }

    Write-PreflightIni -Path $BindingsPath -Document $document
}

try {
    Ensure-CoreProgramStructure
} catch {
    Write-PreflightLog "Core program repair failed: $($_.Exception.Message)"
    throw
}

try {
    Repair-ProgramPackageWrappers
} catch {
    Write-PreflightLog "Program wrapper repair failed: $($_.Exception.Message)"
}

if ($script:RepairedLegacyBlenderWrapper) {
    try {
        Remove-EmptyAutoCreatedPanels
    } catch {
        Write-PreflightLog "Legacy auto panel cleanup failed: $($_.Exception.Message)"
    }
}

Write-PreflightLog 'Startup preflight completed.'
