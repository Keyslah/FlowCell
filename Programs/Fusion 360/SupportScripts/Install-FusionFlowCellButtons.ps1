[CmdletBinding()]
param(
    [string[]]$SelectedPaths = @(),
    [string]$SelectedPathsJson = '',
    [Parameter(Mandatory = $true)][string]$PanelName,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9_-]{1,128}$')][string]$OwnerButtonId,
    [string]$BridgeDataJson = '{}'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$layoutPath = Join-Path $PSScriptRoot 'FlowCellFusionBridgeLayout.ps1'
if (-not (Test-Path -LiteralPath $layoutPath -PathType Leaf)) {
    throw "Fusion bridge layout helper not found: $layoutPath"
}
. $layoutPath

function Resolve-SelectedPaths {
    if ([string]::IsNullOrWhiteSpace($SelectedPathsJson)) {
        return @($SelectedPaths)
    }
    try {
        $decoded = ConvertFrom-Json -InputObject $SelectedPathsJson -ErrorAction Stop
    }
    catch {
        throw 'Could not parse -SelectedPathsJson for Fusion Add Button.'
    }
    if ($null -eq $decoded) { return @() }
    if ($decoded -is [System.Array]) { return @($decoded | ForEach-Object { [string]$_ }) }
    return @([string]$decoded)
}

function Resolve-FusionActionSource {
    param([Parameter(Mandatory = $true)][string]$SelectedPath)
    if ([string]::IsNullOrWhiteSpace($SelectedPath)) {
        throw 'The selected Fusion source path is empty.'
    }
    $resolved = [System.IO.Path]::GetFullPath($SelectedPath)
    if (Test-Path -LiteralPath $resolved -PathType Container) {
        $manifestPath = Join-Path $resolved 'flowcell.toolset.json'
        if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
            throw "The selected Fusion toolset has no flowcell.toolset.json: $resolved"
        }
        $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
        $sourceName = [string]$manifest.source
        if ([string]::IsNullOrWhiteSpace($sourceName)) {
            throw "The selected Fusion toolset manifest has no source: $manifestPath"
        }
        $sourcePath = [System.IO.Path]::GetFullPath((Join-Path $resolved $sourceName))
        if (-not (Test-FlowCellPathUnderRoot -Path $sourcePath -Root $resolved)) {
            throw 'The Fusion toolset source escapes its manifest folder.'
        }
        $resolved = $sourcePath
    }
    elseif ((Split-Path -Leaf $resolved) -ieq 'flowcell.toolset.json') {
        $manifestRoot = Split-Path -Parent $resolved
        $manifest = Get-Content -LiteralPath $resolved -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
        $sourceName = [string]$manifest.source
        if ([string]::IsNullOrWhiteSpace($sourceName)) {
            throw "The selected Fusion toolset manifest has no source: $resolved"
        }
        $sourcePath = [System.IO.Path]::GetFullPath((Join-Path $manifestRoot $sourceName))
        if (-not (Test-FlowCellPathUnderRoot -Path $sourcePath -Root $manifestRoot)) {
            throw 'The Fusion toolset source escapes its manifest folder.'
        }
        $resolved = $sourcePath
    }

    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        throw "Fusion action source not found: $resolved"
    }
    if ([System.IO.Path]::GetExtension($resolved) -ine '.py') {
        throw 'Fusion action sources must be Python files.'
    }
    $sourceText = Get-Content -LiteralPath $resolved -Raw -Encoding UTF8
    if ($sourceText -notmatch '(?m)^def\s+run_flowcell_action\s*\(') {
        throw 'Fusion action sources must expose the top-level run_flowcell_action entrypoint.'
    }
    return $resolved
}

try {
    $selected = @(Resolve-SelectedPaths | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    if ($selected.Count -ne 1) {
        throw 'Fusion Add Button requires exactly one selected Python file or toolset folder.'
    }
    $sourcePath = Resolve-FusionActionSource -SelectedPath ([string]$selected[0])
    try {
        $bridgeData = if ([string]::IsNullOrWhiteSpace($BridgeDataJson)) { [pscustomobject]@{} } else { ConvertFrom-Json -InputObject $BridgeDataJson -ErrorAction Stop }
    }
    catch {
        throw 'Could not parse -BridgeDataJson for Fusion Add Button.'
    }

    $layout = Install-FlowCellFusionBridgeBundle
    $action = 'flowcell_button_{0}' -f $OwnerButtonId.ToLowerInvariant()
    $targetName = $action + '.py'
    $targetPath = Join-Path ([string]$layout.managedActionsRoot) $targetName
    $temporaryPath = '{0}.{1}.tmp' -f $targetPath, [Guid]::NewGuid().ToString('N')
    try {
        Copy-Item -LiteralPath $sourcePath -Destination $temporaryPath -Force
        Move-Item -LiteralPath $temporaryPath -Destination $targetPath -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }

    $registry = Read-FlowCellFusionRegistry -Path ([string]$layout.registryPath)
    $retained = @($registry.actions | Where-Object {
        [string]$_.action -ne $action -and [string]$_.ownerButtonId -ne $OwnerButtonId
    })
    $entry = [ordered]@{
        action = $action
        ownerButtonId = $OwnerButtonId
        source = ('ManagedActions/{0}' -f $targetName)
        entrypoint = 'run_flowcell_action'
        sourcePath = $sourcePath
        panelName = $PanelName
        bridgeData = $bridgeData
        installedUtc = [DateTime]::UtcNow.ToString('o')
    }
    $registry.actions = @($retained) + @([pscustomobject]$entry)
    Write-FlowCellFusionJsonFile -Path ([string]$layout.registryPath) -Value $registry

    [ordered]@{
        results = @([ordered]@{
            installed = $true
            action = $action
            ownerButtonId = $OwnerButtonId
            panelName = $PanelName
            sourcePath = $sourcePath
            targetPath = $targetPath
            addonRoot = [string]$layout.addonRoot
            reloadRequired = [bool]$layout.reloadRequired
            message = if ([bool]$layout.reloadRequired) {
                'Fusion action installed. Restart Fusion once to load the updated FlowCell bridge.'
            }
            else {
                'Fusion action installed. The running bridge reloads managed action code on request.'
            }
        })
    } | ConvertTo-Json -Depth 16 -Compress
    exit 0
}
catch {
    [ordered]@{
        results = @([ordered]@{
            installed = $false
            action = ('flowcell_button_{0}' -f $OwnerButtonId.ToLowerInvariant())
            ownerButtonId = $OwnerButtonId
            panelName = $PanelName
            message = $_.Exception.Message
        })
    } | ConvertTo-Json -Depth 8 -Compress
    exit 1
}
