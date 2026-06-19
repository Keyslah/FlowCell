[CmdletBinding()]
param(
    [string]$Root = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-FlowCellPackageRoot {
    param([string]$RequestedRoot)

    if (-not [string]::IsNullOrWhiteSpace($RequestedRoot)) {
        return (Resolve-Path -LiteralPath $RequestedRoot).Path.TrimEnd('\')
    }

    $flowCellRoot = Split-Path -Parent $PSScriptRoot
    return (Split-Path -Parent $flowCellRoot).TrimEnd('\')
}

function Write-Utf8NoBomFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text
    )

    $parent = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

$packageRoot = Resolve-FlowCellPackageRoot -RequestedRoot $Root
$blenderProgramRoot = Join-Path $packageRoot 'Programs\Blender'
if (-not (Test-Path -LiteralPath $blenderProgramRoot -PathType Container)) {
    return
}

$installScriptPath = Join-Path $blenderProgramRoot 'SupportScripts\Install-FlowCellBlenderAddon.ps1'
if (-not (Test-Path -LiteralPath $installScriptPath -PathType Leaf)) {
    Write-Warning "Blender setup button was not created because the installer script was not found: $installScriptPath"
    return
}

$panelRoot = Join-Path $blenderProgramRoot 'Panels\Utility'
$recordedActionsRoot = Join-Path $packageRoot 'FlowCell\local\recorded_actions'
New-Item -ItemType Directory -Path $panelRoot -Force | Out-Null
New-Item -ItemType Directory -Path $recordedActionsRoot -Force | Out-Null

$macroId = 'flowcell_blender_install_repair_addon'
$label = 'Install / Repair Blender Add-on'
$macroPath = Join-Path $recordedActionsRoot "$macroId.ini"
$panelItemPath = Join-Path $panelRoot 'install_repair_blender_addon.flowcell-panel-item.json'
$timestamp = (Get-Date).ToString('o')

$macroText = @"
[Action]
CreatedAt=$timestamp
Id=$macroId
Label=$label
Owner=flowcell_frontend
ProgramName=Blender
PanelName=Utility
SchemaVersion=2
UpdatedAt=$timestamp

[Step_001]
DelayMs=0
ScriptPath=$installScriptPath
Type=Script
"@
Write-Utf8NoBomFile -Path $macroPath -Text $macroText

$panelItem = [ordered]@{
    label = $label
    tooltip = "Copy FlowCell's Blender bridge files into Blender's user add-ons folder and enable the FlowCell add-on. Restart Blender after it finishes."
    kind = 'macro'
    sourcePath = ''
    executionTarget = ''
    bridgeAction = ''
    children = @()
    macroId = $macroId
}
$panelJson = $panelItem | ConvertTo-Json -Depth 8
Write-Utf8NoBomFile -Path $panelItemPath -Text ($panelJson + "`r`n")
