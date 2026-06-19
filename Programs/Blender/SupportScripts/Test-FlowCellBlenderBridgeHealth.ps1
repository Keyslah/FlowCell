param(
    [string]$ConfigPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$localConfigPath = Join-Path $repoRoot 'FlowCell\local\private\blender.config.local.json'
$repoConfigPath = Join-Path $repoRoot 'Programs\Blender\config.json'
$legacyConfigPath = Join-Path $repoRoot 'Blender\config.json'
$layoutPath = Join-Path $PSScriptRoot 'FlowCellBlenderBridgeLayout.ps1'

if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = if (Test-Path -LiteralPath $localConfigPath -PathType Leaf) {
        $localConfigPath
    }
    elseif (Test-Path -LiteralPath $repoConfigPath -PathType Leaf) {
        $repoConfigPath
    }
    else {
        $legacyConfigPath
    }
}

$ConfigPath = [System.IO.Path]::GetFullPath($ConfigPath)
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "Blender config not found: $ConfigPath"
}
if (-not (Test-Path -LiteralPath $layoutPath -PathType Leaf)) {
    throw "Blender bridge layout helper not found: $layoutPath"
}

. $layoutPath

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if (-not $config.PSObject.Properties['automation'] -or $null -eq $config.automation) {
    $config | Add-Member -MemberType NoteProperty -Name automation -Value ([pscustomobject]@{}) -Force
}
$resolution = Resolve-FlowCellBlenderBridgeFolder -Config $config -IncludeDiagnostics
$bridgeFolder = [string]$resolution.BridgeFolder
$addonRoot = if ([string]::IsNullOrWhiteSpace($bridgeFolder)) { '' } else { Split-Path -Parent $bridgeFolder }
$applicationDataRoot = [string]$env:APPDATA
if ([string]::IsNullOrWhiteSpace($applicationDataRoot)) {
    $applicationDataRoot = [Environment]::GetFolderPath('ApplicationData')
}
$blenderAppDataRoot = Join-Path $applicationDataRoot 'Blender Foundation\Blender'
$activeVersionNames = @(Get-FlowCellRunningBlenderVersionNames)
$detectedVersionFolders = if (Test-Path -LiteralPath $blenderAppDataRoot -PathType Container) {
    @(
        Get-ChildItem -LiteralPath $blenderAppDataRoot -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { Get-FlowCellBlenderVersionSortRecord -Directory $_ -ActiveVersionNames $activeVersionNames } |
            Sort-Object @{ Expression = { $_.IsActive }; Descending = $true },
                @{ Expression = { $_.Major }; Descending = $true },
                @{ Expression = { $_.Minor }; Descending = $true },
                @{ Expression = { $_.Patch }; Descending = $true },
                @{ Expression = { $_.Revision }; Descending = $true } |
            ForEach-Object { $_.Directory.FullName }
    )
}
else {
    @()
}
$blenderProcessIds = @(Get-Process blender -ErrorAction SilentlyContinue | Sort-Object Id | ForEach-Object { [int]$_.Id })

function Format-FlowCellHealthList([object[]]$Values) {
    if (@($Values).Count -eq 0) { return '(none)' }
    return (@($Values) -join '; ')
}

Write-Output ('Repo root: {0}' -f $repoRoot)
Write-Output ('Config path read: {0}' -f $ConfigPath)
Write-Output ('Resolved bridge folder: {0}' -f $(if ([string]::IsNullOrWhiteSpace($bridgeFolder)) { '(unresolved)' } else { $bridgeFolder }))
Write-Output ('Bridge folder source: {0}' -f [string]$resolution.Source)
Write-Output ('Detected Blender version folders: {0}' -f (Format-FlowCellHealthList -Values $detectedVersionFolders))
Write-Output ('Detected Blender process IDs: {0}' -f (Format-FlowCellHealthList -Values $blenderProcessIds))
Write-Output ('flowcell_actions.py exists: {0}' -f [bool]$(-not [string]::IsNullOrWhiteSpace($addonRoot) -and (Test-Path -LiteralPath (Join-Path $addonRoot 'flowcell_actions.py') -PathType Leaf)))
Write-Output ('flowcell_bridge.py exists: {0}' -f [bool]$(-not [string]::IsNullOrWhiteSpace($addonRoot) -and (Test-Path -LiteralPath (Join-Path $addonRoot 'flowcell_bridge.py') -PathType Leaf)))
Write-Output ('flowcell_custom_actions.json exists: {0}' -f [bool]$(-not [string]::IsNullOrWhiteSpace($bridgeFolder) -and (Test-Path -LiteralPath (Join-Path $bridgeFolder 'flowcell_custom_actions.json') -PathType Leaf)))
Write-Output ('ManagedActions exists: {0}' -f [bool]$(-not [string]::IsNullOrWhiteSpace($bridgeFolder) -and (Test-Path -LiteralPath (Join-Path $bridgeFolder 'ManagedActions') -PathType Container)))
Write-Output ('Paths checked: {0}' -f (Format-FlowCellHealthList -Values @($resolution.CheckedPaths)))

if ([string]::IsNullOrWhiteSpace($bridgeFolder)) {
    exit 1
}

exit 0


