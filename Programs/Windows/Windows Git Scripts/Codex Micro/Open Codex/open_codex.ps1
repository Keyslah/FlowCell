# Description: Open or restore the installed Codex desktop app.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$CodexMicroAction = 'OpenCodex'

. (Join-Path $PSScriptRoot 'CodexMicroHelpers.ps1')

Invoke-CodexMicroAction -Action $CodexMicroAction
