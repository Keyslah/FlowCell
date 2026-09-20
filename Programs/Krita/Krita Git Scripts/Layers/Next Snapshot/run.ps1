$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Invoke-KritaLayers.ps1') -Action 'next_snapshot'
