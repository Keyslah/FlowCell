[CmdletBinding()]
param([string]$FusionExePath = '')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$layoutPath = Join-Path $PSScriptRoot 'FlowCellFusionBridgeLayout.ps1'
if (-not (Test-Path -LiteralPath $layoutPath -PathType Leaf)) {
    throw "Fusion bridge layout helper not found: $layoutPath"
}
. $layoutPath

try {
    $layout = Install-FlowCellFusionBridgeBundle
    $result = [ordered]@{
        installed = $true
        addonRoot = [string]$layout.addonRoot
        registryPath = [string]$layout.registryPath
        reloadRequired = [bool]$layout.reloadRequired
        fusionExePath = [string]$FusionExePath
        message = if ([bool]$layout.reloadRequired) {
            'FlowCell Fusion bridge installed. Restart Fusion once to load the updated add-in.'
        }
        else {
            'FlowCell Fusion bridge is already current.'
        }
    }
    $result | ConvertTo-Json -Depth 8 -Compress
    exit 0
}
catch {
    [ordered]@{
        installed = $false
        message = $_.Exception.Message
    } | ConvertTo-Json -Depth 8 -Compress
    exit 1
}
