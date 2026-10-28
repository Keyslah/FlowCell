# Refreshes the FlowCell frontend build-freshness stamps after a manual
# `npm run tauri build`. The launcher (Start-FlowCellFrontend.ps1) rebuilds the
# Tauri frontend on startup whenever these two files in src-tauri\target\release
# do not match the current source:
#   .flowcell_frontend_source_commit  -> git rev-parse HEAD
#   .flowcell_frontend_source_stamp   -> path|size|mtime of every file the launcher watches
# It only writes them after its OWN build, so a manual build leaves them stale and
# the next launch rebuilds again. Running this after a manual build registers the
# build so the next launch starts instantly.
#
# The launcher writes the stamps itself (-RefreshBuildStampOnly builds and launches
# nothing), so they always match its startup check; never compute them here. It runs
# in its own Windows PowerShell, the way run.cmd and run_hidden.vbs start it, so its
# development environment variables stay out of the caller's session.

$ErrorActionPreference = 'Stop'

$windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$launcherPath = Join-Path $PSScriptRoot 'Start-FlowCellFrontend.ps1'
& $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $launcherPath -RefreshBuildStampOnly
exit $LASTEXITCODE
