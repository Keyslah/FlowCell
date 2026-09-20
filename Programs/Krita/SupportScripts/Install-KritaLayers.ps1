param([string]$ResourceDirectory = (Join-Path $env:APPDATA 'krita'))
$ErrorActionPreference = 'Stop'
if (Get-Process krita -ErrorAction SilentlyContinue) { throw 'Close Krita normally before installing its FlowCell Layers plugin.' }
$configPath = Join-Path $env:LOCALAPPDATA 'kritarc'
$pluginRoot = Join-Path $ResourceDirectory 'pykrita'
$target = Join-Path $pluginRoot 'flowcell_layers'
$backupRoot = Join-Path $env:LOCALAPPDATA ('FlowCell\KritaLayers\backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination $backupRoot -Recurse }
if (Test-Path -LiteralPath $configPath) { Copy-Item -LiteralPath $configPath -Destination (Join-Path $backupRoot 'kritarc') }
New-Item -ItemType Directory -Path $target -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'flowcell_layers') -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $target $_.Name) -Force
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'flowcell_layers.desktop') -Destination (Join-Path $pluginRoot 'flowcell_layers.desktop') -Force
$config = if (Test-Path -LiteralPath $configPath) { [IO.File]::ReadAllText($configPath) } else { '' }
$pluginSetting = 'enable_flowcell_layers=true'
if ($config -match '(?m)^enable_flowcell_layers=.*$') {
    $config = [regex]::Replace($config, '(?m)^enable_flowcell_layers=.*$', $pluginSetting)
} elseif ($config -match '(?m)^\[python\]\s*$') {
    $config = [regex]::Replace($config, '(?m)^\[python\]\s*$', "[python]`r`n$pluginSetting")
} else {
    $config += "`r`n[python]`r`n$pluginSetting`r`n"
}
[IO.File]::WriteAllText($configPath, $config, (New-Object System.Text.UTF8Encoding($false)))
Get-ChildItem -LiteralPath $target -File | ForEach-Object {
    $source = Join-Path (Join-Path $PSScriptRoot 'flowcell_layers') $_.Name
    if (Test-Path -LiteralPath $source) {
        if ((Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $_.FullName).Hash) { throw "Copy verification failed: $($_.Name)" }
    }
}
Write-Output "Installed FlowCell Layers. Backup: $backupRoot. Open Krita to load it."
