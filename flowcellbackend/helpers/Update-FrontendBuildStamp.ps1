# Refreshes the FlowCell frontend build-freshness stamps after a manual
# `npm run tauri build`. The launcher (Start-FlowCellFrontend.ps1) rebuilds the
# Tauri frontend on startup whenever these two files in src-tauri\target\release
# do not match the current source:
#   .flowcell_frontend_source_commit  -> git rev-parse HEAD
#   .flowcell_frontend_source_stamp   -> hash of source file sizes + mtimes
# It only writes them after its OWN build, so a manual build leaves them stale and
# the next launch rebuilds again. Running this after a manual build registers the
# build so the next launch starts instantly.
#
# This duplicates the source-root list and stamp format from
# Start-FlowCellFrontend.ps1 (Get-FlowCellFrontendSourceRoots /
# Get-FlowCellFrontendSourceStamp). Keep them in sync. If they ever drift the only
# cost is one extra startup rebuild (the launcher's existing behavior), so this is
# safe to fail.

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $projectRoot
$frontendRoot = Join-Path $repoRoot 'FlowCellFrontend'
$releaseDir = Join-Path $frontendRoot 'src-tauri\target\release'
$exePath = Join-Path $releaseDir 'flowcell_frontend.exe'
$commitPath = Join-Path $releaseDir '.flowcell_frontend_source_commit'
$stampPath = Join-Path $releaseDir '.flowcell_frontend_source_stamp'

if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
    Write-Warning "No release build found at $exePath. Run 'npm run tauri build' first; skipping stamp refresh."
    return
}

$sourceRoots = @(
    (Join-Path $frontendRoot 'src'),
    (Join-Path $frontendRoot 'src-tauri\src'),
    (Join-Path $frontendRoot 'src-tauri\capabilities'),
    (Join-Path $frontendRoot 'src-tauri\icons'),
    (Join-Path $frontendRoot 'src-tauri\Cargo.toml'),
    (Join-Path $frontendRoot 'src-tauri\Cargo.lock'),
    (Join-Path $frontendRoot 'src-tauri\build.rs'),
    (Join-Path $frontendRoot 'src-tauri\tauri.conf.json'),
    (Join-Path $frontendRoot 'package.json'),
    (Join-Path $frontendRoot 'vite.config.ts'),
    (Join-Path $frontendRoot 'index.html'),
    (Join-Path $frontendRoot 'tsconfig.json')
)

$entries = [System.Collections.Generic.List[string]]::new()
foreach ($sourceRoot in $sourceRoots) {
    if (-not (Test-Path -LiteralPath $sourceRoot)) { continue }
    $rootItem = Get-Item -LiteralPath $sourceRoot
    if (-not $rootItem.PSIsContainer) {
        $entries.Add(('{0}|{1}|{2}' -f $rootItem.FullName.Substring($frontendRoot.Length), $rootItem.Length, $rootItem.LastWriteTimeUtc.Ticks))
        continue
    }
    foreach ($file in (Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -ErrorAction SilentlyContinue)) {
        $entries.Add(('{0}|{1}|{2}' -f $file.FullName.Substring($frontendRoot.Length), $file.Length, $file.LastWriteTimeUtc.Ticks))
    }
}
$sourceStamp = [string]::Join("`n", ($entries | Sort-Object))

$sourceCommit = $null
try {
    Push-Location $repoRoot
    $sourceCommit = (& git rev-parse HEAD) 2>$null
    if ($LASTEXITCODE -ne 0) { $sourceCommit = $null }
}
catch { $sourceCommit = $null }
finally { Pop-Location }

if (-not [string]::IsNullOrWhiteSpace($sourceCommit)) {
    Set-Content -LiteralPath $commitPath -Value $sourceCommit.Trim() -Encoding UTF8
}
Set-Content -LiteralPath $stampPath -Value $sourceStamp -Encoding UTF8

Write-Output "FlowCell frontend build stamps refreshed; next launch will skip the rebuild."
