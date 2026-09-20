$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Invoke-KritaLayers.ps1') -Action 'add_to_live'
