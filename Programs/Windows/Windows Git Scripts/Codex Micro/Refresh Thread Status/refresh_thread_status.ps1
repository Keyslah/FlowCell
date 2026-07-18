# Description: Return the current verified Codex state without changing it.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$CodexMicroAction = 'RefreshThreadStatus'

. (Join-Path $PSScriptRoot 'CodexMicroHelpers.ps1')

Invoke-CodexMicroAction -Action $CodexMicroAction
