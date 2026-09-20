# Enable only the requested contributions; startup uses FlowCell's ordinary installer.
$ErrorActionPreference = 'Stop'
$programRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $programRoot)
$registrationPath = Join-Path $repoRoot 'flowcellbackend\local\program-registration\plain-krita.json'
$manifest = Get-Content -LiteralPath (Join-Path $programRoot 'flowcell.program.json') -Raw | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $registrationPath)) { throw 'Register Krita in FlowCell before enabling this panel.' }
$original = [IO.File]::ReadAllText($registrationPath)
$registration = $original | ConvertFrom-Json
if ($registration.programId -ne $manifest.programId) { throw 'Krita registration identity mismatch.' }
$sources = @($manifest.bundledSources | Where-Object { $_.id.StartsWith('plain-krita.layers.') })
foreach ($source in $sources) {
    $package = Join-Path $programRoot $source.sourcePath
    if (-not (Test-Path -LiteralPath (Join-Path $package 'flowcell.script.json'))) { throw "Missing package: $package" }
}
$enabled = @($registration.enabledSources)
foreach ($source in $sources) {
    if (-not ($enabled | Where-Object { $_.sourceId -eq $source.id })) {
        $enabled += [PSCustomObject]@{ sourceId=$source.id; panelName='Layers'; version=$source.version }
    }
}
$registration.enabledSources = $enabled
$backupRoot = Join-Path $repoRoot 'flowcellbackend\local\backups\krita-layers'
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
Copy-Item -LiteralPath $registrationPath -Destination (Join-Path $backupRoot ('registration-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json'))
New-Item -ItemType Directory -Path (Join-Path $programRoot 'Panels\Layers') -Force | Out-Null
if ([IO.File]::ReadAllText($registrationPath) -ne $original) { throw 'Registration changed during preparation; nothing published.' }
[IO.File]::WriteAllText($registrationPath, ($registration | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))
Write-Output "Enabled $($sources.Count) Layers contributions. Restart FlowCell to install through its normal source lifecycle."
