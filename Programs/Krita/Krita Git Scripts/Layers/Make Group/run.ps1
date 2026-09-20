$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Invoke-KritaLayers.ps1') -Action 'make_group'
