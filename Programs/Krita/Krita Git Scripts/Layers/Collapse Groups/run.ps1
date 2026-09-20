$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Invoke-KritaLayers.ps1') -Action 'collapse_groups'
